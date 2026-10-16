"""Builds, caches and serves the daily AI summaries (site and fleet).

For each request: load the rows the facts need (`victron/insight_facts.py`),
write the summary (`victron/insight_ai.py` — a model when allowed, the plain
template otherwise), and keep ONE current row per key in `vrm.ai_summaries`.
A cached row is served for `TTL`; a daily job (`POST /v1/insights/generate-daily`)
refreshes everything ahead of the morning so viewers rarely wait.

Switch: `INSIGHTS_AI` = off (default: nothing is produced or shown) | template
(deterministic text only — no model, no cost) | on (model with template fallback).

Best-effort for callers: a failure here must never break a page; the web app
treats "no summary" as "show nothing".
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from database.supabase_client import get_client
from victron import insight_ai, insight_facts
from vrm_api import forecast_service

logger = logging.getLogger("vrm_api.insights")

_MODES = ("off", "template", "on")
LANGS = ("en", "es")
TTL = timedelta(hours=6)
# A summary is also rewritten as soon as what is true RIGHT NOW changes (a site went offline or came back,
# an alert opened or closed, a storm appeared), but never more often than this — a site flapping online/offline
# must not turn into a model call every few minutes.
MIN_REFRESH = timedelta(minutes=5)
ENERGY_LOOKBACK_DAYS = 21


def insights_mode() -> str:
    mode = os.environ.get("INSIGHTS_AI", "off").strip().lower()
    return mode if mode in _MODES else "off"


def _t(name: str):
    return get_client().schema("vrm").table(name)


def _parse(value) -> datetime | None:
    return insight_facts._parse_ts(value)


# ── loading ──────────────────────────────────────────────────────────────────

def _active_sites(*, site_id: str | None = None, customer_id: str | None = None) -> list[dict]:
    query = (_t("sites").select("site_id, display_name, system_type, pv_kwp, battery_usable_kwh, customer_id, timezone, latitude, longitude, reserve_soc_pct")
             .eq("source", "vrm_api").eq("active", True))
    if site_id:
        query = query.eq("site_id", site_id)
    if customer_id:
        query = query.eq("customer_id", customer_id)
    return query.execute().data or []


def _forecasts_for(sites: list[dict], now: datetime, *, build: bool = True) -> dict[str, dict]:
    """Compact forecast figures per site, when forecasts are switched on: built now, or — with `build=False`,
    for a summary written while someone waits — only what is already stored (the forecast panel and the daily
    job keep those fresh), so a page view never waits on the weather service or VRM.
    A site whose forecast fails simply has none — the summary then says nothing about tomorrow."""
    if forecast_service.forecast_mode() != "on":
        return {}
    out: dict[str, dict] = {}
    for site in sites:
        try:
            compact = forecast_service.compact(forecast_service.get_forecast(site["site_id"], now=now, cached_only=not build))
        except Exception:  # noqa: BLE001
            logger.warning("insights: no forecast for %s", site["site_id"], exc_info=True)
            continue
        if compact:
            out[site["site_id"]] = compact
    return out


def configured_floor(site: dict, from_system: float | None) -> float | None:
    """The minimum state of charge this site is set to keep while the grid is up. A value stated on the
    site (`reserve_soc_pct`) wins: it is for systems where something other than ESS holds the battery
    back (e.g. a VE.Bus Virtual Switch assistant), which VRM cannot see."""
    manual = site.get("reserve_soc_pct")
    if isinstance(manual, (int, float)) and 0 <= manual <= 100:
        return float(manual)
    return from_system


def site_facts_for(sites: list[dict], now: datetime, *, build_forecasts: bool = True) -> dict[str, dict]:
    """Facts for every site in `sites`, with one query per table for the batch."""
    if not sites:
        return {}
    forecasts = _forecasts_for(sites, now, build=build_forecasts)
    ids = [s["site_id"] for s in sites]
    since = (now - timedelta(days=ENERGY_LOOKBACK_DAYS)).date().isoformat()

    energy: dict[str, dict[str, dict]] = {}
    for row in (_t("energy_daily").select("id, site_id, date, pv_kwh, load_kwh, grid_kwh, grid_export_kwh, min_soc, max_soc, outage_minutes, "
                                          "outage_count, complete_day, battery_reached_float")
                .in_("site_id", ids).gte("date", since).execute().data or []):
        # Several dump types can hold the same date: the newest row wins.
        by_date = energy.setdefault(row["site_id"], {})
        if row["date"] not in by_date or (row.get("id") or 0) > (by_date[row["date"]].get("id") or 0):
            by_date[row["date"]] = row

    health: dict[tuple[str, str], dict] = {}
    columns = ("site_id, date, system_score, grid_score, system_breakdown, grid_breakdown", "site_id, date, system_score, grid_score")
    for cols in columns:  # the breakdown columns arrived with sql/vrm_health_breakdown.sql
        try:
            rows = _t("daily_health").select(cols).in_("site_id", ids).gte("date", since).execute().data or []
            health = {(r["site_id"], str(r["date"])): r for r in rows}
            break
        except Exception:  # noqa: BLE001
            continue

    anomalies: dict[str, list[dict]] = {}
    for row in (_t("site_anomalies").select("site_id, anomaly_type, detected_at").in_("site_id", ids).is_("cleared_at", "null").execute().data or []):
        anomalies.setdefault(row["site_id"], []).append(row)
    alerts: dict[str, list[dict]] = {}
    try:
        for row in (_t("alerts").select("site_id, kind, severity, opened_at, detail").in_("site_id", ids).eq("status", "open").execute().data or []):
            alerts.setdefault(row["site_id"], []).append(row)
    except Exception:  # noqa: BLE001 — alerts table may not exist yet
        logger.info("insights: could not read vrm.alerts")
    floors: dict[str, float] = {}
    try:    # the configured minimum state of charge, read by the sweep (vrm.site_devices)
        for row in _t("site_devices").select("site_id, metrics").in_("site_id", ids).eq("kind", "inverter").execute().data or []:
            value = (row.get("metrics") or {}).get("ess_min_soc_pct")
            if isinstance(value, (int, float)):
                floors[row["site_id"]] = float(value)
    except Exception:  # noqa: BLE001 — table not created yet
        logger.info("insights: could not read vrm.site_devices")
    snapshots = {r["site_id"]: r for r in (_t("site_snapshots").select("site_id, captured_at, soc_pct, pv_power_w, load_power_w")
                                           .in_("site_id", ids).execute().data or [])}

    out: dict[str, dict] = {}
    for site in sites:
        sid = site["site_id"]
        rows = list(energy.get(sid, {}).values())
        latest = insight_facts.latest_day(rows)
        out[sid] = insight_facts.build_site_facts(
            site=site, energy_rows=rows, health_row=health.get((sid, str(latest["date"]))) if latest else None,
            anomalies=anomalies.get(sid, []), alerts_open=alerts.get(sid, []), snapshot=snapshots.get(sid), now=now,
            forecast=forecasts.get(sid), soc_floor_pct=configured_floor(site, floors.get(sid)))
    return out


# ── what is true right now ───────────────────────────────────────────────────

def signature_from_facts(facts: dict) -> list[str]:
    """The live-dependent findings a summary was written from: offline, open alerts and anomalies, a storm.
    The day's own figures are fixed once the day is over, so only these can make a cached text wrong."""
    out: set[str] = set()
    for o in facts.get("observations") or []:
        code = o["code"]
        if code in ("offline", "offline_days"):
            out.add("offline")
        elif code.startswith(("alert_", "anomaly_")):
            out.add(code)
        elif code == "storm_ahead":
            out.add("storm")
    return sorted(out)


def live_signatures(sites: list[dict], now: datetime) -> dict[str, list[str]]:
    """The same signature, read straight from the database as it is now — four small batched queries,
    no model and no forecast built."""
    ids = [s["site_id"] for s in sites]
    sig: dict[str, set[str]] = {i: set() for i in ids}
    if not ids:
        return {}
    for row in _t("site_snapshots").select("site_id, captured_at").in_("site_id", ids).execute().data or []:
        seen = _parse(row.get("captured_at"))
        if seen is not None and now - seen > insight_facts.OFFLINE_AFTER and row["site_id"] in sig:
            sig[row["site_id"]].add("offline")
    try:
        for row in _t("alerts").select("site_id, kind").in_("site_id", ids).eq("status", "open").execute().data or []:
            if row["kind"] != "site_offline" and row["site_id"] in sig:
                sig[row["site_id"]].add(f"alert_{row['kind']}")
    except Exception:  # noqa: BLE001 — alerts table may not exist yet
        pass
    for row in _t("site_anomalies").select("site_id, anomaly_type").in_("site_id", ids).is_("cleared_at", "null").execute().data or []:
        if row.get("anomaly_type") and row["site_id"] in sig:
            sig[row["site_id"]].add(f"anomaly_{row['anomaly_type']}")
    if forecast_service.forecast_mode() == "on":
        try:
            for row in _t("site_forecasts").select("site_id, result").in_("site_id", ids).execute().data or []:
                advice = {a.get("code") for a in (row.get("result") or {}).get("advice") or []}
                if "storm" in advice and row["site_id"] in sig:
                    sig[row["site_id"]].add("storm")
        except Exception:  # noqa: BLE001
            pass
    return {k: sorted(v) for k, v in sig.items()}


def _is_current(row: dict | None, sites: list[dict], now: datetime, *, fleet: bool) -> bool:
    """Is this cached summary still fresh AND still true of what is happening now?"""
    created = _parse(row.get("created_at")) if row else None
    if not row or not created or now - created >= TTL:
        return False
    if now - created < MIN_REFRESH:
        return True
    stored = (row.get("facts") or {}).get("live_signature")
    if stored is None:
        return False                      # written before signatures existed: rewrite it once
    current = live_signatures(sites, now)
    return stored == (current if fleet else current.get(sites[0]["site_id"], [])) if sites else True


# ── cache ────────────────────────────────────────────────────────────────────

def _key(scope: str, site_id: str | None, customer_id: str | None, lang: str) -> dict:
    return {"scope": scope, "site_id": site_id, "customer_id": customer_id, "lang": lang}


def _cached(scope: str, site_id: str | None, customer_id: str | None, lang: str) -> dict | None:
    query = _t("ai_summaries").select("*").eq("scope", scope).eq("lang", lang)
    query = query.eq("site_id", site_id) if site_id else query.is_("site_id", "null")
    query = query.eq("customer_id", customer_id) if customer_id else query.is_("customer_id", "null")
    rows = query.execute().data or []
    return rows[0] if rows else None


def _store(scope: str, site_id: str | None, customer_id: str | None, lang: str, facts: dict, summary: dict, now: datetime) -> dict:
    day = (facts.get("day") or {}).get("date")
    row = {**_key(scope, site_id, customer_id, lang), "facts_date": day, "headline": summary["headline"], "points": summary["points"],
           "suggestion": summary.get("suggestion"), "source": summary["source"], "model": summary.get("model"),
           "facts": facts, "created_at": now.isoformat()}
    existing = _cached(scope, site_id, customer_id, lang)
    if existing:
        _t("ai_summaries").update(row).eq("id", existing["id"]).execute()
    else:
        _t("ai_summaries").insert(row).execute()
    return row


def _present(row: dict) -> dict:
    return {"enabled": True, "headline": row["headline"], "points": row.get("points") or [], "suggestion": row.get("suggestion"),
            "source": row["source"], "date": row.get("facts_date"), "generated_at": row.get("created_at")}


def _write(facts: dict, lang: str, scope: str, now: datetime, mode: str) -> dict:
    today = now.date().isoformat()
    if mode == "on":
        return insight_ai.generate(facts, lang, scope, today=today)
    return {**insight_ai.render_template(facts, lang, scope, today=today), "source": "template", "model": None}


# ── public ───────────────────────────────────────────────────────────────────

def site_summary(site_id: str, lang: str, *, now: datetime | None = None, force: bool = False, mode: str | None = None,
                 prefetched: dict | None = None) -> dict | None:
    """The summary for one site, from cache when fresh. None = no such VRM site."""
    mode = mode or insights_mode()
    if mode == "off":
        return {"enabled": False}
    lang = lang if lang in LANGS else "en"
    now = now or datetime.now(timezone.utc)
    sites = _active_sites(site_id=site_id)
    if not sites:
        return None
    if not force and _is_current(_cached("site", site_id, None, lang), sites, now, fleet=False):
        return _present(_cached("site", site_id, None, lang))
    facts = (prefetched or site_facts_for(sites, now, build_forecasts=False))[site_id]
    facts["live_signature"] = signature_from_facts(facts)
    return _present(_store("site", site_id, None, lang, facts, _write(facts, lang, "site", now, mode), now))


def fleet_summary(customer_id: str | None, lang: str, *, now: datetime | None = None, force: bool = False, mode: str | None = None,
                  prefetched: dict | None = None) -> dict:
    """A fleet's summary: that customer's sites, or every site when `customer_id` is None."""
    mode = mode or insights_mode()
    if mode == "off":
        return {"enabled": False}
    lang = lang if lang in LANGS else "en"
    now = now or datetime.now(timezone.utc)
    sites = _active_sites(customer_id=customer_id)
    if not force and _is_current(_cached("fleet", None, customer_id, lang), sites, now, fleet=True):
        return _present(_cached("fleet", None, customer_id, lang))
    by_site = prefetched if prefetched is not None else site_facts_for(sites, now, build_forecasts=False)
    members = [by_site[s["site_id"]] for s in sites if s["site_id"] in by_site]
    name = "All sites" if customer_id is None else "Your sites"
    facts = insight_facts.build_fleet_facts(site_facts=members, name=name, now=now)
    facts["live_signature"] = {m["site"]["id"]: signature_from_facts(m) for m in members}
    return _present(_store("fleet", None, customer_id, lang, facts, _write(facts, lang, "fleet", now, mode), now))


def generate_daily(*, now: datetime | None = None, mode: str | None = None) -> dict:
    """Refresh every site, every customer's fleet and the admin fleet, in both
    languages. One site's failure never stops the rest."""
    mode = mode or insights_mode()
    counts = {"mode": mode, "sites": 0, "fleets": 0, "failed": 0}
    if mode == "off":
        return counts
    now = now or datetime.now(timezone.utc)
    sites = _active_sites()
    by_site = site_facts_for(sites, now)
    for site in sites:
        for lang in LANGS:
            try:
                site_summary(site["site_id"], lang, now=now, force=True, mode=mode, prefetched=by_site)
                counts["sites"] += 1
            except Exception:  # noqa: BLE001
                counts["failed"] += 1
                logger.exception("insights: could not summarise site %s", site["site_id"])
    owners = {None, *(s["customer_id"] for s in sites if s.get("customer_id"))}
    for customer_id in owners:
        for lang in LANGS:
            try:
                fleet_summary(customer_id, lang, now=now, force=True, mode=mode, prefetched=by_site)
                counts["fleets"] += 1
            except Exception:  # noqa: BLE001
                counts["failed"] += 1
                logger.exception("insights: could not summarise fleet %s", customer_id)
    return counts

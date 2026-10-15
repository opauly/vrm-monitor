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
    query = (_t("sites").select("site_id, display_name, system_type, pv_kwp, battery_usable_kwh, customer_id, timezone")
             .eq("source", "vrm_api").eq("active", True))
    if site_id:
        query = query.eq("site_id", site_id)
    if customer_id:
        query = query.eq("customer_id", customer_id)
    return query.execute().data or []


def _forecasts_for(sites: list[dict], now: datetime) -> dict[str, dict]:
    """Compact forecast figures per site (cached, or built now), when forecasts are switched on.
    A site whose forecast fails simply has none — the summary then says nothing about tomorrow."""
    if forecast_service.forecast_mode() != "on":
        return {}
    out: dict[str, dict] = {}
    for site in sites:
        try:
            compact = forecast_service.compact(forecast_service.get_forecast(site["site_id"], now=now))
        except Exception:  # noqa: BLE001
            logger.warning("insights: no forecast for %s", site["site_id"], exc_info=True)
            continue
        if compact:
            out[site["site_id"]] = compact
    return out


def site_facts_for(sites: list[dict], now: datetime) -> dict[str, dict]:
    """Facts for every site in `sites`, with one query per table for the batch."""
    if not sites:
        return {}
    forecasts = _forecasts_for(sites, now)
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
            forecast=forecasts.get(sid))
    return out


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
    if not force:
        row = _cached("site", site_id, None, lang)
        created = _parse(row.get("created_at")) if row else None
        if row and created and now - created < TTL:
            return _present(row)
    sites = _active_sites(site_id=site_id)
    if not sites:
        return None
    facts = (prefetched or site_facts_for(sites, now))[site_id]
    return _present(_store("site", site_id, None, lang, facts, _write(facts, lang, "site", now, mode), now))


def fleet_summary(customer_id: str | None, lang: str, *, now: datetime | None = None, force: bool = False, mode: str | None = None,
                  prefetched: dict | None = None) -> dict:
    """A fleet's summary: that customer's sites, or every site when `customer_id` is None."""
    mode = mode or insights_mode()
    if mode == "off":
        return {"enabled": False}
    lang = lang if lang in LANGS else "en"
    now = now or datetime.now(timezone.utc)
    if not force:
        row = _cached("fleet", None, customer_id, lang)
        created = _parse(row.get("created_at")) if row else None
        if row and created and now - created < TTL:
            return _present(row)
    sites = _active_sites(customer_id=customer_id)
    by_site = prefetched if prefetched is not None else site_facts_for(sites, now)
    members = [by_site[s["site_id"]] for s in sites if s["site_id"] in by_site]
    name = "All sites" if customer_id is None else "Your sites"
    facts = insight_facts.build_fleet_facts(site_facts=members, name=name, now=now)
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

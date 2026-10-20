"""Insight notices: the day's outlook, a great solar day ahead, a storm with a low battery, unusually high use.

Rules live in `victron/insight_notices.py`; this applies them once per refresh sweep and delivers what they produce.

  `run_pass()`   — works out which notices hold for each site (only for customers who switched that kind on: every
                   insight kind is off until the customer enables it in their alert settings), and stores new ones in
                   `vrm.insight_notices`. A notice is stored once per (customer, key) however many sweeps see it.
  `deliver()`    — sends what is stored and unsent, by email and/or phone notification, per the customer's channel
                   choices for that kind. Anything that has waited too long to still be useful is dropped, not sent late.

Switches: `INSIGHT_NOTICES` = off | on (default on; with every kind off by default nothing is sent until a customer
opts in) for the generating pass; delivery follows the alert switches (`ALERTS_EMAIL`, `ALERTS_PUSH`). Best effort:
the caller wraps everything, a failure here never costs a snapshot sweep.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from database.supabase_client import get_client
from victron import email_i18n
from victron import insight_ai
from victron import insight_notices as rules
from victron.mailer import MailerError
from victron.mailer import send as mailer_send
from victron.vrm_series import DEFAULT_TZ_NAME
from vrm_api import alerts_push, forecast_service
from vrm_api.alerts_delivery import _stamp, email_mode
from vrm_api.alerts_service import eligible_customer_ids, forced_customer_ids, load_preferences

logger = logging.getLogger("vrm_api.insight_notices")

FORECAST_MAX_AGE = timedelta(hours=3)
MAX_FORECAST_BUILDS = 4                  # per pass: a sweep must stay short
MAX_NON_BRIEFING_PER_DAY = 3             # per customer
MAX_AGE = timedelta(hours=3)             # an unsent notice older than this is dropped, not sent late
MAX_INDIVIDUAL_PUSHES = 3
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PRIORITY = [rules.STORM_BATTERY, rules.HIGH_USAGE, rules.USAGE_DAY, rules.SOLAR_DAY, rules.DAILY_BRIEFING]


def notices_mode() -> str:
    return "off" if os.environ.get("INSIGHT_NOTICES", "on").strip().lower() == "off" else "on"


def _t(name: str):
    return get_client().schema("vrm").table(name)


def _parse(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _local(now: datetime, tz_name: str | None) -> datetime:
    try:
        zone = ZoneInfo(tz_name or DEFAULT_TZ_NAME)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo(DEFAULT_TZ_NAME)
    return now.astimezone(zone).replace(tzinfo=None)


def _enabled_kinds(prefs: dict, customer_id: str) -> set[str]:
    return {k for k in rules.KINDS if prefs.get((customer_id, k), {}).get("enabled", False)}


# ── generating ───────────────────────────────────────────────────────────
def _site_details(site_ids: list[str]) -> dict[str, dict]:
    """`{site_id: {display_name, latitude, longitude, property_id}}`. `property_id` is left out when the properties SQL has not been run."""
    if not site_ids:
        return {}
    for columns in ("site_id, display_name, latitude, longitude, property_id", "site_id, display_name, latitude, longitude"):
        try:
            rows = _t("sites").select(columns).in_("site_id", site_ids).execute().data or []
            return {r["site_id"]: r for r in rows}
        except Exception:  # noqa: BLE001
            continue
    return {}


def _property_names(property_ids: set) -> dict[str, str]:
    if not property_ids:
        return {}
    try:
        return {r["id"]: r["name"] for r in _t("properties").select("id, name").in_("id", sorted(property_ids)).execute().data or []}
    except Exception:  # noqa: BLE001
        return {}


def _group_key(site: dict, info: dict | None) -> str:
    """Which sites share weather: the property they are in, else the ~1 km square they sit in, else the site alone."""
    info = info or {}
    if info.get("property_id"):
        return f"p:{info['property_id']}"
    lat, lon = info.get("latitude"), info.get("longitude")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return f"l:{round(lat, 2)},{round(lon, 2)}"
    return f"s:{site['site_id']}"



def run_pass(*, sites: list[dict], fetched: list[tuple[str, dict | None]], previous_by_site: dict[str, dict],
             now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    summary = {"stored": 0, "skipped_cap": 0}
    customer_ids = sorted({s["customer_id"] for s in sites})
    if not customer_ids:
        return summary
    eligible = eligible_customer_ids(customer_ids)
    prefs = load_preferences(customer_ids)
    enabled = {c: _enabled_kinds(prefs, c) for c in customer_ids if c in eligible}
    active = [(s, snap if status == "ok" else None) for s, (status, snap) in zip(sites, fetched)
              if s["customer_id"] in enabled and enabled[s["customer_id"]]]
    if not active:
        return summary

    ids = [s["site_id"] for s, _ in active]
    forecasts = {r["site_id"]: r for r in (_t("site_forecasts").select("site_id, generated_at, result, load_profile").in_("site_id", ids).execute().data or [])}
    energy: dict[str, list[dict]] = {}
    if any(rules.USAGE_DAY in enabled[s["customer_id"]] for s, _ in active):
        since = (now - timedelta(days=10)).date().isoformat()
        for r in _t("energy_daily").select("site_id, date, load_kwh, complete_day").in_("site_id", ids).gte("date", since).execute().data or []:
            energy.setdefault(r["site_id"], []).append(r)
    recent = _t("insight_notices").select("customer_id, kind, dedupe_key, created_at").in_("customer_id", sorted(enabled)).gte(
        "created_at", (now - timedelta(days=2)).isoformat()).execute().data or []
    seen = {(r["customer_id"], r["dedupe_key"]) for r in recent}
    used_today = {}
    for r in recent:
        made = _parse(r["created_at"])
        if r["kind"] != rules.DAILY_BRIEFING and made and now - made < timedelta(days=1):
            used_today[r["customer_id"]] = used_today.get(r["customer_id"], 0) + 1

    details = _site_details(ids)
    property_names = _property_names({d["property_id"] for d in details.values() if d.get("property_id")})

    builds = 0
    rows: list[dict] = []
    forecast_of: dict[str, dict | None] = {}
    profile_of: dict[str, list | None] = {}
    for site, snapshot in active:
        site_id, customer_id = site["site_id"], site["customer_id"]
        kinds = enabled[customer_id]
        local = _local(now, site.get("timezone"))
        row = forecasts.get(site_id)
        forecast = (row or {}).get("result")
        made = _parse((row or {}).get("generated_at"))
        fresh = bool(forecast) and made is not None and now - made <= FORECAST_MAX_AGE \
            and str(forecast.get("generated_for", ""))[:10] == local.date().isoformat()
        if not fresh and kinds & {rules.DAILY_BRIEFING, rules.SOLAR_DAY, rules.STORM_BATTERY} and builds < MAX_FORECAST_BUILDS:
            builds += 1
            try:
                forecast = forecast_service.get_forecast(site_id, now=now) or forecast
                row = (_t("site_forecasts").select("site_id, generated_at, result, load_profile").eq("site_id", site_id).execute().data or [row])[0]
            except Exception:  # noqa: BLE001 — a forecast that cannot be made just means no forecast-based notice this time
                logger.warning("insight notices: could not build the forecast for %s", site_id)
        forecast_of[site_id] = forecast
        profile_of[site_id] = ((row or {}).get("load_profile") or {}).get("load_w")

    def add(customer_id: str, site_id: str, notice: rules.Notice) -> None:
        if (customer_id, notice.key) not in seen:
            rows.append({"customer_id": customer_id, "site_id": site_id, "kind": notice.kind, "dedupe_key": notice.key,
                         "severity": notice.severity, "detail": notice.detail})

    # What is about one site's own load stays per site.
    for site, snapshot in active:
        site_id, customer_id = site["site_id"], site["customer_id"]
        try:
            for notice in rules.evaluate(site=site, now_local=_local(now, site.get("timezone")), snapshot=snapshot, previous=previous_by_site.get(site_id),
                                         load_profile_w=profile_of.get(site_id), energy_rows=energy.get(site_id), kinds=enabled[customer_id]):
                add(customer_id, site_id, notice)
        except Exception:  # noqa: BLE001 — one odd site must not cost the others
            logger.exception("insight notices: could not evaluate site %s", site_id)

    # Weather is shared by everything in one place: said once per property, or per group of sites that share a location.
    groups: dict[tuple[str, str], list[tuple[dict, dict | None]]] = {}
    for site, snapshot in active:
        groups.setdefault((site["customer_id"], _group_key(site, details.get(site["site_id"]))), []).append((site, snapshot))
    for (customer_id, key), members in groups.items():
        first = members[0][0]
        info = details.get(first["site_id"]) or {}
        names = [(details.get(m["site_id"]) or {}).get("display_name") or m["site_id"] for m, _ in members]
        name = property_names.get(info.get("property_id")) or rules.group_name(names)
        try:
            found = rules.evaluate_group(
                key=key, name=name, now_local=_local(now, first.get("timezone")), kinds=enabled[customer_id], property_id=info.get("property_id"),
                members=[rules.Member(site={**m, "display_name": names[i]}, forecast=forecast_of.get(m["site_id"]), snapshot=snap)
                         for i, (m, snap) in enumerate(members)])
        except Exception:  # noqa: BLE001
            logger.exception("insight notices: could not evaluate group %s", key)
            continue
        for notice in found:
            add(customer_id, first["site_id"], notice)

    rows.sort(key=lambda r: _PRIORITY.index(r["kind"]))
    keep = []
    for r in rows:
        if r["kind"] != rules.DAILY_BRIEFING:
            if used_today.get(r["customer_id"], 0) >= MAX_NON_BRIEFING_PER_DAY:
                summary["skipped_cap"] += 1
                continue
            used_today[r["customer_id"]] = used_today.get(r["customer_id"], 0) + 1
        keep.append(r)
        seen.add((r["customer_id"], r["dedupe_key"]))
    if keep:
        _t("insight_notices").upsert(keep, on_conflict="customer_id,dedupe_key", ignore_duplicates=True).execute()
        summary["stored"] = len(keep)
    return summary


# ── wording ──────────────────────────────────────────────────────────────
def _fill(template: str, **values) -> str:
    for key, value in values.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def _briefing_body(d: dict, t: dict, lang: str) -> str:
    parts = []
    if d.get("kwh") is not None:
        if d.get("direction") and d.get("typical"):
            parts.append(_fill(t[f"insight_brief_solar_{d['direction']}"], kwh=d["kwh"], pct=d.get("pct"), typical=d["typical"]))
        else:
            parts.append(_fill(t["insight_brief_solar_only"], kwh=d["kwh"]))
    if d.get("windows"):
        parts.append(_fill(t["insight_brief_storm"], when=insight_ai.storm_when(d["windows"], lang)))
    low, high = d.get("soc_min"), d.get("soc_max")
    if low is not None:
        parts.append(_fill(t["insight_brief_battery"], soc=low) if low == high else _fill(t["insight_brief_battery_range"], low=low, high=high))
    if d.get("charge_first"):
        parts.append(t["insight_brief_tip_storm"])
    elif d.get("direction") == "above":
        parts.append(t["insight_brief_tip_midday"])
    return " ".join(parts)


def _low_list(low: list[dict], limit: int = 3) -> str:
    shown = ", ".join(f"{x['name']} {x['soc']}%" for x in low[:limit])
    return shown + (f" (+{len(low) - limit})" if len(low) > limit else "")


def describe(notice: dict, *, site_name: str, strings: dict, lang: str, site_url: str | None, admin: bool = False) -> dict:
    """One notice as a card for the email and the phone notification. A weather notice about a group of sites is named for the
    group (`detail.name`) and links to the property's fleet view when it has one."""
    kind, d = notice["kind"], notice.get("detail") or {}
    name = d.get("name") or site_name
    if d.get("property_id"):
        path = f"/admin/fleet?property={d['property_id']}" if admin else f"/app/dashboard?property={d['property_id']}"
    else:
        path = f"/admin/fleet/{notice.get('site_id')}" if admin else f"/app/dashboard/{notice.get('site_id')}"
    base = (site_url or "").rstrip("/")
    values = {"site": name}
    many = (d.get("sites") or 1) > 1
    if kind == rules.DAILY_BRIEFING:
        body = _briefing_body(d, strings, lang)
        title, push = _fill(strings["insight_briefing_title"], site=name), strings["insight_briefing_push"]
    elif kind == rules.SOLAR_DAY:
        key = "insight_solar_day_body_many" if many else "insight_solar_day_body"
        body = _fill(strings[key], kwh=d.get("kwh"), pct=d.get("pct"), typical=d.get("typical"), n=d.get("sites"))
        title, push = _fill(strings["insight_solar_day_title"], **values), strings["insight_solar_day_push"]
    elif kind == rules.STORM_BATTERY:
        when = insight_ai.storm_when(d.get("windows") or [], lang)
        if many and d.get("low"):
            body = _fill(strings["insight_storm_battery_body_many"], when=when, low=_low_list(d["low"]))
        else:
            body = _fill(strings["insight_storm_battery_body"], when=when, soc=d.get("soc_pct"))
        title, push = _fill(strings["insight_storm_battery_title"], **values), _fill(strings["insight_storm_battery_push"], soc=d.get("soc_pct"))
    elif kind == rules.HIGH_USAGE:
        body = _fill(strings["insight_high_usage_body"], kw=d.get("kw"), factor=d.get("factor"), usual_kw=d.get("usual_kw"))
        title, push = _fill(strings["insight_high_usage_title"], **values), strings["insight_high_usage_push"]
    else:
        body = _fill(strings["insight_usage_day_body"], kwh=d.get("kwh"), pct=d.get("pct"), average_kwh=d.get("average_kwh"))
        title, push = _fill(strings["insight_usage_day_title"], **values), strings["insight_usage_day_push"]
    severity = notice.get("severity") if notice.get("severity") in ("ok", "warning") else "ok"
    return {"title": title, "body": body, "severity": severity, "severity_label": "", "url": f"{base}{path}" if base else None,
            "path": path, "button_label": strings["alert_view_site"], "site": name, "push_title": push}


def _push_payloads(items: list[tuple[dict, dict]], strings: dict, *, admin: bool) -> list[dict]:
    if len(items) > MAX_INDIVIDUAL_PUSHES:
        return [{"title": _fill(strings["insight_multi_subject"], n=len(items)),
                 "body": " · ".join(f"{c['push_title']}: {c['site']}" for _, c in items[:3]),
                 "url": "/admin/fleet/alerts" if admin else "/app/alerts", "tag": "insights-summary", "severity": "warning"}]
    return [{"title": c["push_title"], "body": f"{c['site']} — {c['body']}" if c["site"] and c["body"] else (c["site"] or c["body"]),
             "url": c["path"], "tag": f"insight-{n['id']}", "severity": c["severity"]} for n, c in items]


# ── delivering ───────────────────────────────────────────────────────────
def deliver(*, now: datetime | None = None, mode: str | None = None, push: bool | None = None, site_url: str | None = None) -> dict:
    mode = mode or email_mode()
    push_on = alerts_push.push_enabled() if push is None else push
    summary = {"sent": 0, "pushed": 0, "dropped": 0, "failed": 0, "customers": 0}
    test_to = (os.environ.get("ALERTS_EMAIL_TEST_TO") or "").strip()
    email_active = mode == "on" or (mode == "test" and bool(_EMAIL_RE.match(test_to)))
    if not email_active and not push_on:
        return summary

    now = now or datetime.now(timezone.utc)
    site_url = site_url if site_url is not None else os.environ.get("SITE_URL")
    stamp = now.isoformat()
    table = _t("insight_notices")
    pending = table.select("*").is_("notified_at", "null").execute().data or []
    if not pending:
        return summary

    prefs = load_preferences(sorted({n["customer_id"] for n in pending}))

    def pref(n: dict, channel: str) -> bool:
        p = prefs.get((n["customer_id"], n["kind"]), {})
        return bool(p.get("enabled", False)) and bool(p.get(channel, True))

    stale = [n for n in pending if now - (_parse(n.get("created_at")) or now) > MAX_AGE or not (pref(n, "email") or pref(n, "push"))]
    if stale:
        _stamp(table, [n["id"] for n in stale], notified_at=stamp)
        summary["dropped"] += len(stale)
    live = [n for n in pending if n not in stale]
    if not live:
        return summary

    from jinja2 import Environment, FileSystemLoader, select_autoescape
    env = Environment(
        loader=FileSystemLoader(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "victron", "templates")),
        autoescape=select_autoescape(["html"]))
    sites = {s["site_id"]: s for s in (_t("sites").select("site_id, display_name").in_("site_id", sorted({n["site_id"] for n in live if n.get("site_id")})).execute().data or [])}
    customers = {c["id"]: c for c in (_t("customers").select("id, contact_email, auth_email, ui_language")
                                      .in_("id", sorted({n["customer_id"] for n in live})).execute().data or [])}
    forced = forced_customer_ids()

    by_customer: dict[str, list[dict]] = {}
    for n in live:
        by_customer.setdefault(n["customer_id"], []).append(n)

    for customer_id, notices in by_customer.items():
        customer = customers.get(customer_id) or {}
        recipient = customer.get("contact_email") or customer.get("auth_email")
        recipient_ok = bool(recipient and _EMAIL_RE.match(recipient))
        email_to = (test_to if mode == "test" else recipient) if email_active and (mode == "test" or recipient_ok) else None
        devices: list[dict] = []
        if push_on:
            try:
                devices = alerts_push.destinations(customer_id=customer_id, include_admin_devices=customer_id in forced)
            except Exception:  # noqa: BLE001
                logger.warning("insight notices: could not read push subscriptions for customer %s", customer_id)
        reachable = [n for n in notices if (email_to is not None and pref(n, "email")) or (devices and pref(n, "push"))]
        if not reachable:
            continue
        claimed = {r["id"] for r in _stamp(table, [n["id"] for n in reachable], notified_at=stamp)}
        mine = [n for n in reachable if n["id"] in claimed]
        if not mine:
            continue

        lang = (customer.get("ui_language") or "en").lower()
        strings = email_i18n.get(lang)
        admin_view = customer_id in forced

        def card(n, admin=False):
            name = (sites.get(n.get("site_id") or "") or {}).get("display_name") or n.get("site_id") or ""
            return describe(n, site_name=name, strings=strings, lang=lang, site_url=site_url, admin=admin)

        email_ok = False
        email_cards = [card(n, admin_view) for n in mine if pref(n, "email")]
        if email_to is not None and email_cards:
            subject = email_cards[0]["title"] if len(email_cards) == 1 else _fill(strings["insight_multi_subject"], n=len(email_cards))
            if mode == "test":
                subject = f"[TEST → {recipient if recipient_ok else 'no email on file'}] {subject}"
            try:
                html = env.get_template("alert_email.html").render(
                    lang=lang, t={**strings, "alert_footer": strings["insight_footer"], "alert_manage": strings["insight_manage"]}, subject=subject,
                    sections=[{"heading": strings["insight_section"], "cards": email_cards}],
                    settings_url=f"{site_url.rstrip('/')}/app/alerts" if site_url else None)
                mailer_send(email_to, subject, html)
                email_ok = True
                summary["sent"] += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("insight notices: could not email customer %s: %s", customer_id, exc if isinstance(exc, MailerError) else type(exc).__name__)

        push_ok = False
        for group, to_admin in (([d for d in devices if d.get("admin_email")], True), ([d for d in devices if not d.get("admin_email")], False)):
            items = [(n, card(n, to_admin)) for n in mine if pref(n, "push")]
            if not group or not items:
                continue
            try:
                result = alerts_push.deliver(group, _push_payloads(items, strings, admin=to_admin), urgency="normal", now=now)
                push_ok = push_ok or result["delivered"] > 0
                summary["pushed"] += result["delivered"]
            except Exception:  # noqa: BLE001
                logger.exception("insight notices: push delivery failed for customer %s", customer_id)

        if not (email_ok or push_ok):
            table.update({"notified_at": None}).in_("id", list(claimed)).execute()      # nothing got through: retry next sweep
            summary["failed"] += 1
            continue
        summary["customers"] += 1
    return summary

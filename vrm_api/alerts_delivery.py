"""Emails the alerts that `alerts_service` has opened and resolved.

Runs at the end of a refresh sweep (after the alert pass) and sends at most
ONE email per customer per run: new alerts first, then anything that is back
to normal. Controlled by `ALERTS_EMAIL`:

  off   (default) send nothing
  test  send everything to `ALERTS_EMAIL_TEST_TO` instead of the customer,
        subject prefixed "[TEST → real address]" — to see real emails before
        any customer does. Still marks alerts as notified.
  on    send to the customer (`contact_email`, else the login email)

Rows are chosen by two columns on `vrm.alerts`: `notified_at IS NULL` on an
open alert means "owes an opened notice", and `resolved_notified_at IS NULL`
on a resolved alert that WAS notified means "owes a back-to-normal notice".

Guards, because this is the first code that can message customers:

  * Backlog: an alert whose underlying event began more than MAX_NOTIFY_AGE
    ago (for a site that went silent, when its data stopped — not when we
    first noticed) when emailing is first switched on, or after downtime, is stamped as handled
    WITHOUT sending, so nobody gets a surprise email about a months-old
    offline site. Both stamps are set, so no "back to normal" notice follows
    for something that was never announced.
  * Cooldown: an alert that reopens within COOLDOWN of the last notice for
    the same site and kind is suppressed the same way — a reading that flaps
    around a threshold cannot produce an email every 15 minutes.
  * Claim before send: rows are claimed with a conditional UPDATE
    (`... WHERE notified_at IS NULL`) and released if the send fails, so two
    overlapping sweeps cannot send the same notice twice.

Best-effort from the sweep's point of view; the caller catches everything.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from database.supabase_client import get_client
from victron import alerts as rules
from victron import email_i18n
from victron.mailer import MailerError
from victron.mailer import send as mailer_send
from victron.vrm_series import DEFAULT_TZ_NAME
from vrm_api.alerts_service import load_preferences

logger = logging.getLogger("vrm_api.alerts_delivery")

MAX_NOTIFY_AGE = timedelta(hours=6)
COOLDOWN = timedelta(hours=2)
_MODES = ("off", "test", "on")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def email_mode() -> str:
    mode = os.environ.get("ALERTS_EMAIL", "off").strip().lower()
    return mode if mode in _MODES else "off"


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


def _local(value, tz_name: str | None) -> str:
    moment = _parse(value)
    if moment is None:
        return "—"
    try:
        zone = ZoneInfo(tz_name or DEFAULT_TZ_NAME)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo(DEFAULT_TZ_NAME)
    return moment.astimezone(zone).strftime("%Y-%m-%d %H:%M")


def _fill(template: str, **values) -> str:
    for key, value in values.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def _event_time(alert: dict, now: datetime) -> datetime:
    """When the underlying event actually began, for the backlog check.

    An alert row's `opened_at` is when OUR engine first saw the condition, which
    for something already long-standing (a site that has been silent for 77
    days, the first time alerts are switched on) is "just now" — so measuring
    the backlog from it would let a months-old offline site through as news.
    A site-offline alert knows better: `detail.last_seen` is when data stopped.
    """
    if alert.get("kind") == rules.SITE_OFFLINE:
        seen = _parse((alert.get("detail") or {}).get("last_seen"))
        if seen is not None:
            return seen
    return _parse(alert.get("opened_at")) or now


def describe(alert: dict, *, resolved: bool, site_name: str, tz_name: str | None,
             strings: dict, site_url: str | None) -> dict:
    """One alert as a card for the email template."""
    t = strings
    kind, detail = alert["kind"], alert.get("detail") or {}
    base = (site_url or "").rstrip("/")
    link_target = "/app/sites" if kind == rules.VRM_LINK_BROKEN else f"/app/dashboard/{alert.get('site_id')}"
    url = f"{base}{link_target}" if base else None
    button = t["alert_reconnect"] if kind == rules.VRM_LINK_BROKEN else t["alert_view_site"]

    if resolved:
        return {"title": _fill(t[f"alert_{kind}_resolved"], site=site_name), "body": "", "severity": "ok",
                "severity_label": "", "url": url, "button_label": button}

    severity = alert.get("severity") or rules.WARNING
    title_key, body_key = f"alert_{kind}_title", f"alert_{kind}_body"
    values: dict = {"site": site_name}
    if kind == rules.SITE_OFFLINE:
        values.update(since=_local(detail.get("last_seen"), tz_name), minutes=detail.get("minutes_silent", "—"))
    elif kind == rules.GRID_OUTAGE:
        soc = detail.get("soc_pct")
        values["soc_phrase"] = _fill(t["alert_grid_outage_soc_phrase"], soc=round(soc)) if isinstance(soc, (int, float)) else ""
    elif kind == rules.LOW_BATTERY:
        soc = detail.get("soc_pct")
        values["soc"] = round(soc) if isinstance(soc, (int, float)) else "—"
        if severity == rules.CRITICAL:
            title_key, body_key = "alert_low_battery_critical_title", "alert_low_battery_critical_body"
    elif kind == rules.SYSTEM_ALARM:
        names = [t.get(f"alert_alarm_{k}", k) for k in detail.get("alarms", [])]
        values["alarms"] = ", ".join(names) or "—"

    return {"title": _fill(t[title_key], **values), "body": _fill(t[body_key], **values), "severity": severity,
            "severity_label": t["alert_severity_critical" if severity == rules.CRITICAL else "alert_severity_warning"],
            "url": url, "button_label": button}


def _stamp(table, ids: list, **columns) -> list:
    """Conditional claim: sets `columns` only on rows where each is still NULL."""
    query = table.update(columns).in_("id", ids)
    for column in columns:
        query = query.is_(column, "null")
    return query.execute().data or []


def deliver_pending(*, now: datetime | None = None, mode: str | None = None, site_url: str | None = None) -> dict:
    mode = mode or email_mode()
    summary = {"mode": mode, "sent": 0, "suppressed": 0, "failed": 0, "customers": 0}
    if mode == "off":
        return summary
    test_to = (os.environ.get("ALERTS_EMAIL_TEST_TO") or "").strip()
    if mode == "test" and not _EMAIL_RE.match(test_to):
        logger.warning("alerts_delivery: ALERTS_EMAIL=test needs a valid ALERTS_EMAIL_TEST_TO — sending nothing")
        return summary

    now = now or datetime.now(timezone.utc)
    site_url = site_url if site_url is not None else os.environ.get("SITE_URL")
    stamp = now.isoformat()
    alerts = _t("alerts")

    opens = alerts.select("*").eq("status", "open").is_("notified_at", "null").execute().data or []
    resolves = (alerts.select("*").eq("status", "resolved").is_("resolved_notified_at", "null")
                .not_.is_("notified_at", "null").execute().data or [])
    if not opens and not resolves:
        return summary

    # Cooldown reference: what was announced recently for the same site + kind.
    recent = (alerts.select("id, customer_id, site_id, kind, notified_at")
              .gte("notified_at", (now - COOLDOWN).isoformat()).execute().data or [])

    def key(a):
        return (a["customer_id"], a.get("site_id") or "", a["kind"])

    def suppress(rows: list[dict]) -> None:
        if rows:
            _stamp(alerts, [r["id"] for r in rows], notified_at=stamp)
            alerts.update({"resolved_notified_at": stamp}).in_("id", [r["id"] for r in rows]).execute()
            summary["suppressed"] += len(rows)

    # "Show in the app but don't email me" (vrm.alert_preferences.email = false):
    # handled like any other suppressed notice, both stamps set.
    prefs = load_preferences(sorted({a["customer_id"] for a in opens + resolves}))

    def emailable(a: dict) -> bool:
        return prefs.get((a["customer_id"], a["kind"]), {}).get("email", True)

    keep_opens: list[dict] = []
    drop: list[dict] = []
    for a in opens:
        opened = _event_time(a, now)
        flapping = any(key(r) == key(a) and r["id"] != a["id"] for r in recent)
        (drop if (now - opened > MAX_NOTIFY_AGE or flapping or not emailable(a)) else keep_opens).append(a)
    suppress(drop)

    keep_resolves = [a for a in resolves if now - (_parse(a.get("resolved_at")) or now) <= MAX_NOTIFY_AGE and emailable(a)]
    stale = [a for a in resolves if a not in keep_resolves]
    if stale:
        alerts.update({"resolved_notified_at": stamp}).in_("id", [a["id"] for a in stale]).execute()
        summary["suppressed"] += len(stale)

    by_customer: dict[str, dict[str, list[dict]]] = {}
    for a in keep_opens:
        by_customer.setdefault(a["customer_id"], {"new": [], "resolved": []})["new"].append(a)
    for a in keep_resolves:
        by_customer.setdefault(a["customer_id"], {"new": [], "resolved": []})["resolved"].append(a)
    if not by_customer:
        return summary

    from jinja2 import Environment, FileSystemLoader, select_autoescape
    env = Environment(
        loader=FileSystemLoader(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "victron", "templates")),
        autoescape=select_autoescape(["html"]),
    )

    site_ids = sorted({a["site_id"] for g in by_customer.values() for a in g["new"] + g["resolved"] if a.get("site_id")})
    sites = {s["site_id"]: s for s in (_t("sites").select("site_id, display_name, timezone").in_("site_id", site_ids).execute().data or [])} if site_ids else {}
    customers = {c["id"]: c for c in (_t("customers").select("id, contact_email, auth_email, ui_language")
                                      .in_("id", list(by_customer)).execute().data or [])}

    for customer_id, groups in by_customer.items():
        customer = customers.get(customer_id) or {}
        recipient = customer.get("contact_email") or customer.get("auth_email")
        if not recipient or not _EMAIL_RE.match(recipient):
            logger.warning("alerts_delivery: customer %s has no valid email — leaving %d alert(s) unsent",
                           customer_id, len(groups["new"]) + len(groups["resolved"]))
            continue

        new_ids = [a["id"] for a in groups["new"]]
        res_ids = [a["id"] for a in groups["resolved"]]
        claimed_new = {r["id"] for r in _stamp(alerts, new_ids, notified_at=stamp)} if new_ids else set()
        claimed_res = {r["id"] for r in _stamp(alerts, res_ids, resolved_notified_at=stamp)} if res_ids else set()
        new = [a for a in groups["new"] if a["id"] in claimed_new]
        resolved = [a for a in groups["resolved"] if a["id"] in claimed_res]
        if not new and not resolved:
            continue  # another sweep claimed them first

        lang = (customer.get("ui_language") or "en").lower()
        strings = email_i18n.get(lang)

        def card(a, is_resolved):
            site = sites.get(a.get("site_id") or "", {})
            return describe(a, resolved=is_resolved, site_name=site.get("display_name") or a.get("site_id") or "",
                            tz_name=site.get("timezone"), strings=strings, site_url=site_url)

        cards_new = [card(a, False) for a in new]
        cards_resolved = [card(a, True) for a in resolved]
        sections = [s for s in (
            {"heading": strings["alert_section_new"], "cards": cards_new} if cards_new else None,
            {"heading": strings["alert_section_resolved"], "cards": cards_resolved} if cards_resolved else None,
        ) if s]
        total = len(cards_new) + len(cards_resolved)
        subject = (cards_new + cards_resolved)[0]["title"] if total == 1 else _fill(strings["alert_multi_subject"], n=total)
        to = recipient
        if mode == "test":
            subject = f"[TEST → {recipient}] {subject}"
            to = test_to

        try:
            html = env.get_template("alert_email.html").render(
                lang=lang, t=strings, subject=subject, sections=sections,
                settings_url=f"{site_url.rstrip('/')}/app/alerts" if site_url else None)
            mailer_send(to, subject, html)
        except Exception as exc:  # noqa: BLE001 — release the claim so the next sweep retries
            logger.warning("alerts_delivery: could not email customer %s: %s", customer_id, exc if isinstance(exc, MailerError) else type(exc).__name__)
            if claimed_new:
                alerts.update({"notified_at": None}).in_("id", list(claimed_new)).execute()
            if claimed_res:
                alerts.update({"resolved_notified_at": None}).in_("id", list(claimed_res)).execute()
            summary["failed"] += 1
            continue
        summary["sent"] += 1
        summary["customers"] += 1

    return summary

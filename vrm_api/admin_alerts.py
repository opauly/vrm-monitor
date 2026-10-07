"""Applies and delivers the admin fleet-health alerts (`victron/admin_alerts.py`).

Evaluated in two places so a dead sweep cannot hide itself:

  * at the end of every `vrm-fleet/refresh-snapshots` sweep (`run_sweep_pass`):
    many sites silent at once, and most reads failing;
  * by a watchdog (`run_watchdog_pass`, `POST /v1/alerts/admin-check`) that does
    NOT depend on the sweep: whether snapshots are still arriving at all, and
    whether the daily history sync is still adding days. Point a second
    scheduler job at that endpoint every ~15 minutes to catch a dead sweep
    quickly; the daily anomaly job calls it too, as a free fallback.

Switch: `ALERTS_ADMIN` = off (default) | dry_run (evaluate and log only) | on
(persist to `vrm.admin_alerts` and notify). Notification goes to the admin by
email (`ADMIN_ALERTS_EMAIL`, default info@paulyco.com; language
`ADMIN_ALERTS_LANG`, default en) and, when `ALERTS_PUSH=on`, to the admin's
registered phones.

Notice guards, as for customer alerts: a condition must still hold
`NOTIFY_AFTER[kind]` after it opened (one noisy sweep is not news — two in a row
is), an alert that reopens within COOLDOWN of the last notice for its kind is
suppressed, rows are claimed with a conditional UPDATE before sending and
released if nothing got through.

Everything is best-effort from the caller's point of view: callers catch
exceptions so this can never cost a snapshot refresh.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone

from database.supabase_client import get_client
from victron import admin_alerts as rules
from victron import email_i18n
from victron.mailer import MailerError
from victron.mailer import send as mailer_send
from vrm_api import alerts_push

logger = logging.getLogger("vrm_api.admin_alerts")

_MODES = ("off", "dry_run", "on")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
COOLDOWN = timedelta(hours=2)
# How long a condition must have been open before it is announced.
NOTIFY_AFTER = {
    rules.FLEET_OFFLINE: timedelta(minutes=10),
    rules.FETCH_FAILING: timedelta(minutes=10),
    rules.SWEEP_STALE: timedelta(0),
    rules.HISTORY_STALE: timedelta(0),
}
DEFAULT_ADMIN_EMAIL = "info@paulyco.com"


def admin_mode() -> str:
    mode = os.environ.get("ALERTS_ADMIN", "off").strip().lower()
    return mode if mode in _MODES else "off"


def _t(name: str):
    return get_client().schema("vrm").table(name)


def _parse(value) -> datetime | None:
    return rules._parse_ts(value)


# ── evaluation + persistence ─────────────────────────────────────────────────

def _load_open(mode: str) -> list[dict]:
    try:
        return _t("admin_alerts").select("*").eq("status", "open").execute().data or []
    except Exception:  # noqa: BLE001
        if mode == "dry_run":
            logger.info("admin_alerts[dry_run]: vrm.admin_alerts is not readable yet (migration not run?) — treating as empty")
            return []
        raise


def _apply(table, transitions: rules.Transitions, now: datetime) -> dict:
    stamp = now.isoformat()
    counts = {"opened": 0, "escalated": 0, "updated": 0, "resolved": 0, "errors": 0}

    def run(label: str, op) -> None:
        try:
            op()
            counts[label] += 1
        except Exception:  # noqa: BLE001 — e.g. the unique index catching a concurrent run
            counts["errors"] += 1
            logger.exception("admin_alerts: could not %s an alert", label)

    for c in transitions.opened:
        run("opened", lambda c=c: table.insert({"kind": c.kind, "severity": c.severity, "status": "open",
                                                "opened_at": stamp, "detail": c.detail}).execute())
    for existing, c in transitions.escalated:
        run("escalated", lambda e=existing, c=c: table.update({"severity": c.severity, "detail": c.detail,
                                                               "notified_at": None, "updated_at": stamp}).eq("id", e["id"]).execute())
    for existing, c in transitions.updated:
        run("updated", lambda e=existing, c=c: table.update({"detail": c.detail, "updated_at": stamp}).eq("id", e["id"]).execute())
    for existing in transitions.resolved:
        run("resolved", lambda e=existing: table.update({"status": "resolved", "resolved_at": stamp,
                                                         "updated_at": stamp}).eq("id", e["id"]).execute())
    return counts


def _persist(conditions: list[rules.Condition], *, mode: str, now: datetime, open_alerts: list[dict]) -> dict:
    transitions = rules.reconcile(conditions, open_alerts)
    summary = {"mode": mode, "opened": len(transitions.opened), "escalated": len(transitions.escalated),
               "updated": len(transitions.updated), "resolved": len(transitions.resolved)}
    if mode == "dry_run":
        for c in transitions.opened:
            logger.info("admin_alerts[dry_run]: would OPEN %s [%s] %s", c.kind, c.severity, c.detail)
        for _, c in transitions.escalated:
            logger.info("admin_alerts[dry_run]: would ESCALATE %s -> %s", c.kind, c.severity)
        for a in transitions.resolved:
            logger.info("admin_alerts[dry_run]: would RESOLVE %s", a["kind"])
        return summary
    summary["applied"] = _apply(_t("admin_alerts"), transitions, now)
    return summary


def _fleet_reading(site_ids: list[str] | None = None) -> tuple[list[dict], str | None, str | None]:
    """(per-site snapshot ages, newest snapshot write time, newest energy_daily day)."""
    sites_q = _t("sites").select("site_id, display_name").eq("source", "vrm_api").eq("active", True)
    sites = {s["site_id"]: s for s in (sites_q.execute().data or [])}
    ids = site_ids if site_ids is not None else list(sites)
    snapshots = (_t("site_snapshots").select("site_id, captured_at, updated_at").in_("site_id", ids).execute().data or []) if ids else []
    per_site = [{"site_id": r["site_id"], "name": (sites.get(r["site_id"]) or {}).get("display_name"), "captured_at": r.get("captured_at")}
                for r in snapshots]
    written = [w for w in (_parse(r.get("updated_at")) for r in snapshots) if w is not None]
    newest_written = max(written).isoformat() if written else None
    newest_day = None
    try:
        latest = _t("energy_daily").select("date").order("date", desc=True).limit(1).execute().data or []
        newest_day = latest[0]["date"] if latest else None
    except Exception:  # noqa: BLE001 — freshness of history is best-effort
        logger.warning("admin_alerts: could not read the newest energy_daily day")
    return per_site, newest_written, newest_day


def run_sweep_pass(*, fetched: list[tuple[str, dict | None]], site_ids: list[str], mode: str | None = None,
                   now: datetime | None = None) -> dict:
    """End-of-sweep checks. `fetched` is each site's `(status, snapshot)`."""
    mode = mode or admin_mode()
    if mode == "off":
        return {"mode": mode}
    now = now or datetime.now(timezone.utc)
    open_alerts = _load_open(mode)
    open_kinds = {a["kind"] for a in open_alerts}

    attempted = sum(1 for status, _ in fetched if status in ("ok", "failed"))
    failed = sum(1 for status, _ in fetched if status == "failed")
    per_site, newest_written, newest_day = _fleet_reading(site_ids)

    conditions = (
        rules.evaluate_fleet_offline(sites=per_site, now=now, open_kinds=open_kinds)
        + rules.evaluate_fetch_failing(attempted=attempted, failed=failed, open_kinds=open_kinds)
        + rules.evaluate_freshness(newest_snapshot_at=newest_written, newest_energy_date=newest_day, now=now, open_kinds=open_kinds)
    )
    return _persist(conditions, mode=mode, now=now, open_alerts=open_alerts)


def run_watchdog_pass(*, mode: str | None = None, now: datetime | None = None) -> dict:
    """Checks that do not rely on the sweep having just run."""
    mode = mode or admin_mode()
    if mode == "off":
        return {"mode": mode}
    now = now or datetime.now(timezone.utc)
    open_alerts = _load_open(mode)
    open_kinds = {a["kind"] for a in open_alerts}
    per_site, newest_written, newest_day = _fleet_reading()
    conditions = (
        rules.evaluate_fleet_offline(sites=per_site, now=now, open_kinds=open_kinds)
        + rules.evaluate_freshness(newest_snapshot_at=newest_written, newest_energy_date=newest_day, now=now, open_kinds=open_kinds)
    )
    return _persist(conditions, mode=mode, now=now, open_alerts=open_alerts)


# ── delivery ─────────────────────────────────────────────────────────────────

def _fill(template: str, **values) -> str:
    for key, value in values.items():
        template = template.replace("{" + key + "}", str(value))
    return template


def describe(alert: dict, *, resolved: bool, strings: dict, site_url: str | None) -> dict:
    kind, detail = alert["kind"], alert.get("detail") or {}
    base = (site_url or "").rstrip("/")
    path = "/admin/fleet/alerts"
    url = f"{base}{path}" if base else None
    if resolved:
        return {"title": strings[f"admin_alert_{kind}_resolved"], "body": "", "severity": "ok", "severity_label": "",
                "url": url, "path": path, "button_label": strings["admin_alert_open"]}
    severity = alert.get("severity") or rules.WARNING
    values = {"offline": detail.get("offline", "—"), "total": detail.get("total", "—"),
              "sites": ", ".join(detail.get("sites") or []) or "—",
              "failed": detail.get("failed", "—"), "attempted": detail.get("attempted", "—"),
              "minutes": detail.get("minutes_ago", "—"), "day": detail.get("newest_day", "—"), "days": detail.get("days_behind", "—")}
    return {"title": _fill(strings[f"admin_alert_{kind}_title"], **values), "body": _fill(strings[f"admin_alert_{kind}_body"], **values),
            "severity": severity, "severity_label": strings["alert_severity_critical" if severity == rules.CRITICAL else "alert_severity_warning"],
            "url": url, "path": path, "button_label": strings["admin_alert_open"]}


def _stamp(table, ids: list, **columns) -> list:
    query = table.update(columns).in_("id", ids)
    for column in columns:
        query = query.is_(column, "null")
    return query.execute().data or []


def deliver_pending(*, now: datetime | None = None, mode: str | None = None, push: bool | None = None,
                    site_url: str | None = None) -> dict:
    mode = mode or admin_mode()
    summary = {"mode": mode, "sent": 0, "pushed": 0, "suppressed": 0, "failed": 0}
    if mode != "on":
        return summary
    now = now or datetime.now(timezone.utc)
    site_url = site_url if site_url is not None else os.environ.get("SITE_URL")
    push_on = alerts_push.push_enabled() if push is None else push
    to = (os.environ.get("ADMIN_ALERTS_EMAIL") or DEFAULT_ADMIN_EMAIL).strip()
    email_active = bool(_EMAIL_RE.match(to))
    stamp = now.isoformat()
    table = _t("admin_alerts")

    opens = [a for a in (table.select("*").eq("status", "open").is_("notified_at", "null").execute().data or [])
             if now - (_parse(a.get("opened_at")) or now) >= NOTIFY_AFTER.get(a["kind"], timedelta(0))]
    resolves = (table.select("*").eq("status", "resolved").is_("resolved_notified_at", "null")
                .not_.is_("notified_at", "null").execute().data or [])
    if not opens and not resolves:
        return summary

    recent = (table.select("id, kind, notified_at").gte("notified_at", (now - COOLDOWN).isoformat()).execute().data or [])
    flapping = [a for a in opens if any(r["kind"] == a["kind"] and r["id"] != a["id"] for r in recent)]
    if flapping:
        ids = [a["id"] for a in flapping]
        _stamp(table, ids, notified_at=stamp)
        table.update({"resolved_notified_at": stamp}).in_("id", ids).execute()
        summary["suppressed"] += len(flapping)
        opens = [a for a in opens if a not in flapping]
    if not opens and not resolves:
        return summary

    claimed_new = {r["id"] for r in _stamp(table, [a["id"] for a in opens], notified_at=stamp)} if opens else set()
    claimed_res = {r["id"] for r in _stamp(table, [a["id"] for a in resolves], resolved_notified_at=stamp)} if resolves else set()
    new = [a for a in opens if a["id"] in claimed_new]
    resolved = [a for a in resolves if a["id"] in claimed_res]
    if not new and not resolved:
        return summary

    lang = (os.environ.get("ADMIN_ALERTS_LANG") or "en").strip().lower()
    strings = {**email_i18n.get(lang), "alert_footer": email_i18n.get(lang)["admin_alert_footer"]}
    new_cards = [(a, describe(a, resolved=False, strings=strings, site_url=site_url)) for a in new]
    res_cards = [(a, describe(a, resolved=True, strings=strings, site_url=site_url)) for a in resolved]

    email_ok = False
    if email_active:
        sections = [s for s in (
            {"heading": strings["alert_section_new"], "cards": [c for _, c in new_cards]} if new_cards else None,
            {"heading": strings["alert_section_resolved"], "cards": [c for _, c in res_cards]} if res_cards else None,
        ) if s]
        total = len(new_cards) + len(res_cards)
        subject = (new_cards + res_cards)[0][1]["title"] if total == 1 else _fill(strings["admin_alert_multi_subject"], n=total)
        try:
            from jinja2 import Environment, FileSystemLoader, select_autoescape
            env = Environment(
                loader=FileSystemLoader(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "victron", "templates")),
                autoescape=select_autoescape(["html"]))
            html = env.get_template("alert_email.html").render(lang=lang, t=strings, subject=f"[VRM Monitor] {subject}",
                                                               sections=sections, settings_url=None)
            mailer_send(to, f"[VRM Monitor] {subject}", html)
            email_ok = True
            summary["sent"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("admin_alerts: could not email the admin: %s", exc if isinstance(exc, MailerError) else type(exc).__name__)

    push_ok = False
    if push_on:
        try:
            devices = alerts_push.destinations(include_admin_devices=True)
            items = new_cards + res_cards
            if devices and items:
                if len(items) > alerts_push.MAX_INDIVIDUAL_PUSHES:
                    payloads = [{"title": _fill(strings["admin_alert_multi_subject"], n=len(items)),
                                 "body": " · ".join(c["title"] for _, c in items[:3]), "url": "/admin/fleet/alerts",
                                 "tag": "admin-alerts-summary", "severity": "warning"}]
                else:
                    payloads = [{"title": c["title"], "body": c["body"] or "", "url": c["path"], "tag": f"admin-alert-{a['id']}",
                                 "severity": c["severity"]} for a, c in items]
                urgent = any(c["severity"] == "critical" for _, c in new_cards)
                result = alerts_push.deliver(devices, payloads, urgency="high" if urgent else "normal", now=now)
                push_ok = result["delivered"] > 0
                summary["pushed"] += result["delivered"]
        except Exception:  # noqa: BLE001
            logger.exception("admin_alerts: push delivery failed")

    if not (email_ok or push_ok):
        if claimed_new:
            table.update({"notified_at": None}).in_("id", list(claimed_new)).execute()
        if claimed_res:
            table.update({"resolved_notified_at": None}).in_("id", list(claimed_res)).execute()
        summary["failed"] += 1
    return summary

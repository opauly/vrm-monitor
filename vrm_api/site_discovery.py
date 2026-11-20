"""New systems in a VRM account: find them, tell the right person, and add one as a site in one step.

`run_pass()` reads the installation list of the admin's own VRM account and of every customer who connected
theirs, and keeps a `vrm.new_installations` row (sql/vrm_new_installations.sql) for each installation created in
the last `RECENT` days that has no site yet. Older unmonitored installations are left alone: they are already
listed on the admin's "Link installations" page, and announcing them all at once would be noise.

"No site yet" depends on whose account it is:
  admin account     no site anywhere for that installation (the admin decides which customer it goes to)
  a customer's      no site for it under THAT customer

`deliver()` sends one push (and, for the admin, one email) per new row. `add()` creates the site from the
wizard's values and starts its first import: the daily totals and the 15-minute readings from the day the
system was created, so a site commissioned this morning shows its first hours right away.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from database.supabase_client import get_client
from victron import email_i18n
from victron import ingest as victron_ingest
from victron import site_prefill
from victron.vrm_remote import VrmRemoteClient
from vrm_api import alerts_push, secrets

logger = logging.getLogger(__name__)

SCHEMA = "vrm"
RECENT = timedelta(days=14)        # only installations created this recently are announced
MAX_BACKFILL_DAYS = 31             # the first import never reaches further back than the usual first sync
ADMIN_KEY = None                   # customer_id of a row found in the admin's own account


def _t(name: str):
    return get_client().schema(SCHEMA).table(name)


def _epoch(value) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc) if value else None
    except (TypeError, ValueError, OverflowError):
        return None


def _accounts() -> list[tuple[str | None, str]]:
    """(customer_id or None for the admin, token) for every VRM account we can read."""
    out: list[tuple[str | None, str]] = []
    admin = (os.environ.get("VRM_ADMIN_TOKEN") or "").strip()
    if admin:
        out.append((ADMIN_KEY, admin))
    rows = (_t("customers").select("id").not_.is_("vrm_token_secret_id", "null").is_("vrm_token_revoked_at", "null")
            .execute().data or [])
    for row in rows:
        try:
            token = secrets.read_customer_vrm_token(row["id"])
        except Exception:  # noqa: BLE001 — one unreadable token must not stop the others
            logger.warning("site_discovery: could not read the VRM token of customer %s", row["id"])
            continue
        if token:
            out.append((row["id"], token))
    return out


def _prefill(client, record: dict) -> dict:
    """What VRM says about the equipment. Best effort: with nothing readable, the wizard simply asks for more."""
    overview = diagnostics = None
    try:
        overview = client.get_system_overview(record["idSite"])
    except Exception:  # noqa: BLE001
        logger.warning("site_discovery: no system overview for installation %s", record.get("idSite"))
    try:
        diagnostics = client.get_diagnostics(record["idSite"])
    except Exception:  # noqa: BLE001
        logger.warning("site_discovery: no diagnostics for installation %s", record.get("idSite"))
    return site_prefill.prefill(record, overview or {}, diagnostics or {})


def run_pass(*, now: datetime | None = None, client_factory=VrmRemoteClient, accounts: list | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    summary = {"accounts": 0, "found": 0, "closed": 0, "failed": 0}
    sites = _t("sites").select("site_id, customer_id, vrm_installation_id").not_.is_("vrm_installation_id", "null").execute().data or []
    site_of_any: dict[int, str] = {}
    site_of: dict[tuple[str, int], str] = {}
    for s in sites:
        iid = int(s["vrm_installation_id"])
        site_of_any.setdefault(iid, s["site_id"])
        site_of[(s["customer_id"], iid)] = s["site_id"]
    known = {(r.get("customer_id"), int(r["vrm_installation_id"])): r
             for r in (_t("new_installations").select("id, customer_id, vrm_installation_id, status").execute().data or [])}

    def linked(customer_id, iid) -> str | None:
        return site_of_any.get(iid) if customer_id is ADMIN_KEY else site_of.get((customer_id, iid))

    # A waiting row whose installation got a site some other way (the old link page, a customer connecting) is closed.
    for (customer_id, iid), row in known.items():
        site_id = linked(customer_id, iid)
        if row["status"] == "new" and site_id:
            _t("new_installations").update({"status": "added", "site_id": site_id, "closed_at": now.isoformat()}).eq("id", row["id"]).execute()
            summary["closed"] += 1

    for customer_id, token in (accounts if accounts is not None else _accounts()):
        summary["accounts"] += 1
        try:
            client = client_factory(token)
            user_id = (client.get_me().get("user") or {}).get("id")
            records = (client.list_installations(user_id, extended=True).get("records") or []) if user_id is not None else []
        except Exception:  # noqa: BLE001 — an expired token or a VRM hiccup costs this account only
            logger.warning("site_discovery: could not list the installations of %s", customer_id or "the admin account")
            summary["failed"] += 1
            continue
        for record in records:
            if not isinstance(record, dict) or record.get("idSite") is None:
                continue
            iid = int(record["idSite"])
            created = _epoch(record.get("syscreated"))
            if (customer_id, iid) in known or linked(customer_id, iid) or created is None or now - created > RECENT:
                continue
            row = {"customer_id": customer_id, "vrm_installation_id": iid, "name": (record.get("name") or "").strip() or None,
                   "vrm_created_at": created.isoformat(), "prefill": _prefill(client, record)}
            try:
                _t("new_installations").insert(row).execute()
                known[(customer_id, iid)] = {"status": "new"}
                summary["found"] += 1
            except Exception:  # noqa: BLE001 — e.g. a concurrent pass inserted it first
                logger.warning("site_discovery: could not record installation %s", iid, exc_info=True)
    return summary


# ── telling people ───────────────────────────────────────────────────────

def _fill(template: str, **values) -> str:
    out = template
    for k, v in values.items():
        out = out.replace("{" + k + "}", str(v))
    return out


def _cards(rows: list[dict], strings: dict, *, admin: bool, site_url: str | None) -> list[dict]:
    path = "/admin/vrm-fleet" if admin else "/app/sites"
    url = f"{site_url.rstrip('/')}{path}" if site_url else None
    return [{"title": _fill(strings["new_site_found_title"], name=r.get("name") or r["vrm_installation_id"]),
             "body": strings["new_site_found_body"], "severity": "info", "severity_label": "", "url": url, "path": path,
             "button_label": strings["new_site_found_button"], "name": r.get("name") or str(r["vrm_installation_id"])} for r in rows]


def _push(rows_cards: list[dict], strings: dict) -> list[dict]:
    names = ", ".join(c["name"] for c in rows_cards)
    title = strings["new_site_found_push"] if len(rows_cards) == 1 else _fill(strings["new_sites_found_push"], n=len(rows_cards))
    return [{"title": title, "body": f"{names} — {strings['new_site_found_push_body']}", "url": rows_cards[0]["path"],
             "tag": "new-installations", "severity": "info"}]


def _email(to: str, cards: list[dict], strings: dict, lang: str) -> None:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
    from victron.mailer import send as mailer_send
    env = Environment(loader=FileSystemLoader(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "victron", "templates")),
                      autoescape=select_autoescape(["html"]))
    subject = cards[0]["title"] if len(cards) == 1 else _fill(strings["new_sites_found_push"], n=len(cards))
    html = env.get_template("alert_email.html").render(lang=lang, t=strings, subject=f"[VRM Monitor] {subject}",
                                                       sections=[{"heading": "", "cards": cards}], settings_url=None)
    mailer_send(to, f"[VRM Monitor] {subject}", html)


def deliver(*, now: datetime | None = None, push: bool | None = None, email: bool | None = None, site_url: str | None = None) -> dict:
    """One message per account for everything found since the last one. A row is marked told once ANY channel reached
    someone; with no channel at all it stays untold, and the in-app banner still shows it."""
    from vrm_api import alerts_delivery
    now = now or datetime.now(timezone.utc)
    push_on = alerts_push.push_enabled() if push is None else push
    email_on = alerts_delivery.email_mode() != "off" if email is None else email
    site_url = site_url if site_url is not None else os.environ.get("SITE_URL")
    summary = {"accounts": 0, "pushed": 0, "emailed": 0}
    rows = _t("new_installations").select("*").eq("status", "new").is_("notified_at", "null").execute().data or []
    by_account: dict[str | None, list[dict]] = {}
    for r in rows:
        by_account.setdefault(r.get("customer_id"), []).append(r)
    customers = {}
    ids = [c for c in by_account if c]
    if ids:
        customers = {c["id"]: c for c in (_t("customers").select("id, contact_email, auth_email, ui_language").in_("id", ids).execute().data or [])}

    for customer_id, group in by_account.items():
        admin = customer_id is None
        customer = customers.get(customer_id) or {}
        lang = ((os.environ.get("ADMIN_ALERTS_LANG") or "en") if admin else (customer.get("ui_language") or "en")).strip().lower()
        strings = {**email_i18n.get(lang), "alert_footer": email_i18n.get(lang)["new_site_found_footer"]}
        cards = _cards(group, strings, admin=admin, site_url=site_url)
        reached = False
        if push_on:
            try:
                devices = alerts_push.destinations(include_admin_devices=True) if admin else alerts_push.destinations(customer_id=customer_id)
                if devices:
                    result = alerts_push.deliver(devices, _push(cards, strings), urgency="normal", now=now)
                    summary["pushed"] += result["delivered"]
                    reached = reached or result["delivered"] > 0
            except Exception:  # noqa: BLE001
                logger.exception("site_discovery: push failed for %s", customer_id or "the admin")
        if email_on:
            if alerts_delivery.email_mode() == "test":
                to = (os.environ.get("ALERTS_EMAIL_TEST_TO") or "").strip()
            elif admin:
                from vrm_api.admin_alerts import DEFAULT_ADMIN_EMAIL   # same address as the fleet-health alerts
                to = (os.environ.get("ADMIN_ALERTS_EMAIL") or DEFAULT_ADMIN_EMAIL).strip()
            else:
                to = (customer.get("contact_email") or customer.get("auth_email") or "").strip()
            if to and "@" in to:
                try:
                    _email(to, cards, strings, lang)
                    summary["emailed"] += 1
                    reached = True
                except Exception:  # noqa: BLE001
                    logger.exception("site_discovery: email failed for %s", customer_id or "the admin")
        if reached:
            _t("new_installations").update({"notified_at": now.isoformat()}).in_("id", [r["id"] for r in group]).execute()
            summary["accounts"] += 1
    return summary


# ── acting on one ────────────────────────────────────────────────────────

class NotFound(Exception):
    pass


def get_open(row_id: str, *, customer_id: str | None) -> dict:
    """The waiting row `row_id`, as seen by this customer (None = the admin, who may act on any row)."""
    rows = _t("new_installations").select("*").eq("id", row_id).limit(1).execute().data or []
    row = rows[0] if rows else None
    if not row or row["status"] != "new" or (customer_id is not None and row.get("customer_id") != customer_id):
        raise NotFound(row_id)
    return row


def dismiss(row_id: str, *, customer_id: str | None, now: datetime | None = None) -> None:
    row = get_open(row_id, customer_id=customer_id)
    _t("new_installations").update({"status": "dismissed", "closed_at": (now or datetime.now(timezone.utc)).isoformat()}).eq("id", row["id"]).execute()


def first_import_window(row: dict, tz_name: str | None, now: datetime) -> tuple[str, str]:
    """From the local day the system was created (at most MAX_BACKFILL_DAYS back) through today: a site created this
    morning gets its first hours, and the nightly sync re-reads today once it is over."""
    try:
        tz = ZoneInfo(tz_name) if tz_name else timezone.utc
    except ZoneInfoNotFoundError:
        tz = timezone.utc
    today = now.astimezone(tz).date()
    created = datetime.fromisoformat(row["vrm_created_at"]).astimezone(tz).date() if row.get("vrm_created_at") else today
    start = max(created, today - timedelta(days=MAX_BACKFILL_DAYS))
    return start.isoformat(), today.isoformat()


def create_site(row: dict, *, customer: dict, site_fields: dict, shared: bool, now: datetime | None = None) -> dict:
    """The site for `row` under `customer`, from the wizard's values. Marks the row added. Returns the site row."""
    now = now or datetime.now(timezone.utc)
    fields = dict(site_fields)
    display_name = (fields.pop("display_name", None) or row.get("name") or str(row["vrm_installation_id"])).strip()
    site_id = victron_ingest.make_site_id(customer["slug"], display_name)
    if _t("sites").select("site_id").eq("site_id", site_id).limit(1).execute().data:
        site_id = victron_ingest.make_site_id(customer["slug"], f"{display_name} {row['vrm_installation_id']}")
    fields.update({"vrm_installation_id": row["vrm_installation_id"], "source": "vrm_api", "vrm_sync_enabled": True, "active": True,
                   "report_schedule": customer.get("default_report_schedule") or "off"})
    if row.get("vrm_created_at") and not fields.get("commissioned_at"):
        fields["commissioned_at"] = row["vrm_created_at"][:10]
    if shared:
        fields["is_shared"] = True
    site = victron_ingest.upsert_site(customer["id"], site_id, display_name, **fields)
    _t("new_installations").update({"status": "added", "site_id": site_id, "closed_at": now.isoformat()}).eq("id", row["id"]).execute()
    return site


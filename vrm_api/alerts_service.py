"""Applies the fleet alert rules (`victron/alerts.py`) to the database.

Called once per `vrm-fleet/refresh-snapshots` sweep with the readings that
sweep just fetched. Three modes via the `ALERTS_MODE` environment variable:

  off      (default) do nothing at all — the sweep is exactly what it was
  dry_run  evaluate and LOG what would be opened / escalated / resolved;
           writes nothing, tolerates `vrm.alerts` not existing yet
  live     persist the changes to `vrm.alerts`

Everything here is best-effort from the sweep's point of view: the caller
wraps it so an alerting failure can never cost a snapshot refresh.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from database.supabase_client import get_client
from victron import alerts as rules

logger = logging.getLogger("vrm_api.alerts")

_MODES = ("off", "dry_run", "live")

# Mirrors `lib/server/db/fleetDashboard.ts:isEntitled()` — alerts are part of
# the live-monitoring tier, so they follow the same rule as the live dashboard:
# the plan allows it (`plan_limits.live_dashboard`) AND the account is active,
# provisioned and not in a lapsed billing state.
_NOT_ENTITLED_STATUSES = {"incomplete", "unpaid", "canceled", "trial_expired", "beta_ended"}


def alerts_mode() -> str:
    mode = os.environ.get("ALERTS_MODE", "off").strip().lower()
    return mode if mode in _MODES else "off"


def _t(name: str):
    return get_client().schema("vrm").table(name)


def forced_customer_ids() -> set[str]:
    """Customers that get alerts regardless of plan — `ALERTS_FORCE_CUSTOMER_IDS`
    (comma-separated). For Pauly & Co's own portfolio account, which sits on the
    `trial` plan (no live dashboard) but whose sites are exactly the ones
    to watch. An explicit list, not a name match or a plan special-case."""
    return {x.strip() for x in os.environ.get("ALERTS_FORCE_CUSTOMER_IDS", "").split(",") if x.strip()}


def eligible_customer_ids(customer_ids: list[str]) -> set[str]:
    """Which of these customers are entitled to alerts."""
    if not customer_ids:
        return set()
    plans = {r["plan_key"]: bool(r.get("live_dashboard")) for r in (_t("plan_limits").select("plan_key, live_dashboard").execute().data or [])}
    default_allowed = plans.get("default", False)
    rows = (_t("customers").select("id, plan, active, provisioning_state, billing_status").in_("id", customer_ids).execute().data or [])
    eligible = set()
    for c in rows:
        entitled = bool(c.get("active")) and c.get("provisioning_state") == "active" \
            and c.get("billing_status") not in _NOT_ENTITLED_STATUSES
        if entitled and plans.get(c.get("plan") or "default", default_allowed):
            eligible.add(c["id"])
    return eligible | (forced_customer_ids() & set(customer_ids))


def load_preferences(customer_ids: list[str]) -> dict[tuple[str, str], dict]:
    """`{(customer_id, kind): {"enabled": bool, "email": bool, "push": bool}}` for
    saved rows only; a missing row means the defaults (everything on). A missing
    table (migration not run yet) is treated the same way, so deploying ahead of
    the SQL is safe — and so is a table that predates the `push` column: the
    columns that exist are still honoured (a saved "don't email me" must never be
    lost just because the push migration has not been applied)."""
    if not customer_ids:
        return {}
    rows = None
    for columns in ("customer_id, kind, enabled, email, push", "customer_id, kind, enabled, email"):
        try:
            rows = _t("alert_preferences").select(columns).in_("customer_id", customer_ids).execute().data or []
            break
        except Exception:  # noqa: BLE001
            continue
    if rows is None:
        logger.info("alerts: vrm.alert_preferences is not readable yet — using defaults")
        return {}
    return {(r["customer_id"], r["kind"]): {"enabled": r["enabled"], "email": r["email"], "push": r.get("push", True)} for r in rows}


def _grid_imported_recently(rows: list[dict], now: datetime) -> bool:
    cutoff = (now - timedelta(days=rules.GRID_SEEN_WITHIN_DAYS)).date().isoformat()
    return any((r.get("grid_kwh") or 0) > 0 for r in rows if str(r.get("date") or "") >= cutoff)


def _load_open_alerts(customer_ids: list[str], mode: str) -> list[dict]:
    try:
        return (_t("alerts").select("*").eq("status", "open").in_("customer_id", customer_ids).execute().data or [])
    except Exception:  # noqa: BLE001
        if mode == "dry_run":
            logger.info("alerts[dry_run]: vrm.alerts is not readable yet (migration not run?) — treating as empty")
            return []
        raise


def apply_transitions(table, transitions: rules.Transitions, now: datetime) -> dict:
    """Persist `transitions`. One failing row never blocks the others."""
    stamp = now.isoformat()
    counts = {"opened": 0, "escalated": 0, "updated": 0, "resolved": 0, "errors": 0}

    def run(label: str, op) -> None:
        try:
            op()
            counts[label] += 1
        except Exception:  # noqa: BLE001 — e.g. the unique index catching a concurrent sweep
            counts["errors"] += 1
            logger.exception("alerts: could not %s an alert", label)

    for c in transitions.opened:
        run("opened", lambda c=c: table.insert({
            "customer_id": c.customer_id, "site_id": c.site_id, "kind": c.kind,
            "severity": c.severity, "status": "open", "opened_at": stamp, "detail": c.detail,
        }).execute())
    for existing, c in transitions.escalated:
        # notified_at cleared so the delivery step treats it as unsent again.
        run("escalated", lambda e=existing, c=c: table.update({
            "severity": c.severity, "detail": c.detail, "notified_at": None, "updated_at": stamp,
        }).eq("id", e["id"]).execute())
    for existing, c in transitions.updated:
        run("updated", lambda e=existing, c=c: table.update({
            "detail": c.detail, "updated_at": stamp,
        }).eq("id", e["id"]).execute())
    for existing in transitions.resolved:
        run("resolved", lambda e=existing: table.update({
            "status": "resolved", "resolved_at": stamp, "updated_at": stamp,
        }).eq("id", e["id"]).execute())
    return counts


def run_alert_pass(*, sites: list[dict], fetched: list[tuple[str, dict | None]],
                   previous_by_site: dict[str, dict], energy_by_site: dict[str, list[dict]],
                   mode: str | None = None, now: datetime | None = None) -> dict:
    """Evaluate every site (and each customer's VRM link) and reconcile with
    the open alerts. `fetched[i]` is `(status, snapshot)` for `sites[i]`."""
    mode = mode or alerts_mode()
    if mode == "off":
        return {"mode": mode}
    now = now or datetime.now(timezone.utc)

    customer_ids = sorted({s["customer_id"] for s in sites})
    open_alerts = _load_open_alerts(customer_ids, mode) if customer_ids else []
    open_kinds: dict[str, set[str]] = {}
    for a in open_alerts:
        if a.get("site_id"):
            open_kinds.setdefault(a["site_id"], set()).add(a["kind"])

    eligible = eligible_customer_ids(customer_ids)
    prefs = load_preferences(customer_ids)

    def allowed(customer_id: str, kind: str) -> bool:
        return customer_id in eligible and prefs.get((customer_id, kind), {}).get("enabled", True)

    # Open alerts that should no longer exist at all (customer lost the tier, or
    # switched that alert type off): closed silently below — no email either way.
    silent_close = [a for a in open_alerts if not allowed(a["customer_id"], a["kind"])]
    open_alerts = [a for a in open_alerts if allowed(a["customer_id"], a["kind"])]

    conditions: list[rules.Condition] = []
    for site, (status, snapshot) in zip(sites, fetched):
        conditions += rules.evaluate_site(
            site=site,
            snapshot=snapshot if status == "ok" else None,
            previous=previous_by_site.get(site["site_id"]),
            open_kinds=open_kinds.get(site["site_id"], set()),
            grid_imported_recently=_grid_imported_recently(energy_by_site.get(site["site_id"], []), now),
            now=now,
        )

    if customer_ids:
        customers = (_t("customers").select("id, vrm_token_secret_id, vrm_token_revoked_at, vrm_token_last_error")
                     .in_("id", customer_ids).execute().data or [])
        for customer in customers:
            link = rules.evaluate_customer(customer=customer)
            if link is not None:
                conditions.append(link)

    conditions = [c for c in conditions if allowed(c.customer_id, c.kind)]
    transitions = rules.reconcile(conditions, open_alerts)
    summary = {
        "mode": mode, "closed_silently": len(silent_close),
        "opened": len(transitions.opened), "escalated": len(transitions.escalated),
        "updated": len(transitions.updated), "resolved": len(transitions.resolved),
    }

    if mode == "dry_run":
        for c in transitions.opened:
            logger.info("alerts[dry_run]: would OPEN %s [%s] site=%s customer=%s %s", c.kind, c.severity, c.site_id, c.customer_id, c.detail)
        for _, c in transitions.escalated:
            logger.info("alerts[dry_run]: would ESCALATE %s -> %s site=%s", c.kind, c.severity, c.site_id)
        for a in transitions.resolved:
            logger.info("alerts[dry_run]: would RESOLVE %s site=%s", a["kind"], a.get("site_id"))
        return summary

    summary["applied"] = apply_transitions(_t("alerts"), transitions, now)
    if silent_close:
        stamp = now.isoformat()
        try:
            _t("alerts").update({"status": "resolved", "resolved_at": stamp, "updated_at": stamp,
                                 "notified_at": stamp, "resolved_notified_at": stamp}) \
                .in_("id", [a["id"] for a in silent_close]).execute()
        except Exception:  # noqa: BLE001
            logger.exception("alerts: could not close %d disabled/ineligible alert(s)", len(silent_close))
    return summary

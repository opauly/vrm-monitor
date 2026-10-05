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


def alerts_mode() -> str:
    mode = os.environ.get("ALERTS_MODE", "off").strip().lower()
    return mode if mode in _MODES else "off"


def _t(name: str):
    return get_client().schema("vrm").table(name)


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

    transitions = rules.reconcile(conditions, open_alerts)
    summary = {
        "mode": mode,
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
    return summary

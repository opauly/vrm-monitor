from __future__ import annotations
"""
Pulls individual grid-outage events from Victron's VRM cloud for the small
subset of `monitoring`-schema sites that are real Victron hardware with a
known VRM installation (2026-09-27) — currently the 3 Vista Atenas sites;
Oscar confirmed directly that the other 13 `monitoring` sites are
non-Victron gear with no VRM installation to pull from at all, so this sync
simply never has anything to do for them (`vrm_installation_id` stays NULL
on those rows by design, not as a gap to fill later).

── Why this exists alongside Node-RED's own grid_events writes, not instead
   of them ────────────────────────────────────────────────────────────────
Node-RED's GRID_LOST_STARTED/GRID_RESTORED flow logic (victron-monitor/
node-red/victron_monitor_v1p8.json) is correct — it keeps state in Node-RED's
own `flow` context and writes a real duration on restore. The problem is
exactly WHERE that state lives: a grid outage is precisely the kind of event
that can power-cycle the gateway itself, wiping that in-memory context
before the closing event gets written. Caught live, 2026-09-27: a real,
independently-confirmed 135-minute outage on vista-atenas-lp-m3
(2026-09-23) that VRM's own cloud telemetry (`victron/vrm_series.py`,
the exact mapper the `vrm`-schema CSV/API path already uses) reconstructed
exactly — `monitoring.grid_events` for that day held only a stray
INITIAL_STATE boot marker with a null duration. VRM's cloud side has no
dependency on the local gateway's own volatile state, so this sync is a
targeted improvement for outage detection specifically — it does NOT
re-ingest energy_daily/alarm_events/daily_health for these sites, which
Node-RED already writes directly and does that job fine day to day. Building
a full second ingest path for data Node-RED already handles correctly would
just create two writers fighting over the same rows.

── Sync strategy: full-window replace, not incremental ─────────────────────
Every run re-pulls `_LOOKBACK_DAYS` and deletes+reinserts this sync's own
rows (`started_at IS NOT NULL`) for that window before writing fresh ones —
same idempotent-replace discipline `victron/ingest.py` already uses for
`vrm.alarm_events`/`critical_alerts`. No "last synced" bookkeeping needed: a
missed or doubled-up run just re-derives the same rows. The delete is scoped
to `started_at IS NOT NULL` specifically so it can never touch a legitimate
Node-RED-written row (which always has `started_at` NULL — see
`database/vrm_report_db.py:get_outage_events()`'s own comment on how the two
kinds of rows coexist in one table).

Meant to run once a day, not on `scheduled-reports.yml`'s hourly cadence —
unlike `vrm-fleet/detect-anomalies-daily` (cheap local recomputation, safe to
over-call), this makes a real VRM API request per linked site every time it
runs, so it gets its own daily workflow
(`.github/workflows/monitoring-outage-sync.yml`) rather than piggybacking on
the hourly one.
"""
import logging
import os
from datetime import date, timedelta

from fastapi import APIRouter, Depends

from database.supabase_client import get_client
from victron.vrm_remote import VrmRemoteClient
from victron.vrm_series import DEFAULT_TZ_NAME, fetch_and_map

from vrm_api.deps import require_pipeline_key
from vrm_api.schemas import MonitoringOutageSyncOut

logger = logging.getLogger("vrm_api.monitoring_sync")

router = APIRouter(prefix="/v1/monitoring-sync", tags=["monitoring-sync"],
                   dependencies=[Depends(require_pipeline_key)])

SCHEMA = "monitoring"


def _t(name: str):
    return get_client().schema(SCHEMA).table(name)


def _admin_token() -> str:
    """Same platform-wide `VRM_ADMIN_TOKEN` `vrm_api/routers/vrm_fleet.py`
    already reads — Oscar's own VRM credential, not a per-customer one (see
    that module's own docstring on why this token model is safe)."""
    token = os.environ.get("VRM_ADMIN_TOKEN")
    if not token:
        raise RuntimeError("VRM_ADMIN_TOKEN is not set in the environment.")
    return token


# Wide enough to comfortably re-cover a missed tick or two, without needing
# this endpoint to track its own "last synced" date — see the module
# docstring's "full-window replace" section.
_LOOKBACK_DAYS = 10


@router.post("/grid-events", response_model=MonitoringOutageSyncOut)
def post_sync_grid_events() -> MonitoringOutageSyncOut:
    sites = (_t("sites").select("site_id, vrm_installation_id, pv_kwp, battery_usable_kwh, timezone")
            .not_.is_("vrm_installation_id", "null")
            .eq("active", True).execute().data or [])
    if not sites:
        return MonitoringOutageSyncOut(synced=0, events_written=0, failed=0)

    client = VrmRemoteClient(_admin_token())
    end = date.today()
    start = end - timedelta(days=_LOOKBACK_DAYS)

    synced = events_written = failed = 0
    for site in sites:
        site_id = site["site_id"]
        try:
            result = fetch_and_map(
                client, int(site["vrm_installation_id"]), site_id, start, end,
                pv_kwp=site.get("pv_kwp"), battery_usable_kwh=site.get("battery_usable_kwh"),
                tz=site.get("timezone") or DEFAULT_TZ_NAME,
            )
            events = [dict(e) for e in result.get("outages", [])]
            for e in events:
                e["site_id"] = site_id

            (_t("grid_events").delete()
             .eq("site_id", site_id)
             .not_.is_("started_at", "null")
             .gte("started_at", f"{start.isoformat()}T00:00:00")
             .execute())
            for e in events:
                _t("grid_events").insert(e).execute()

            synced += 1
            events_written += len(events)
        except Exception:  # noqa: BLE001 — one site's failure must not stop the sweep
            logger.exception("monitoring-sync grid-events: failed for site %s", site_id)
            failed += 1

    return MonitoringOutageSyncOut(synced=synced, events_written=events_written, failed=failed)

"""Per-device health, stored by the refresh sweep (rules: `victron/devices.py`).

`run_pass()` takes the diagnostics the sweep already fetched for each site, works out
every battery / inverter / solar charger's status, and upserts one `vrm.site_devices`
row per device. It returns the stored rows per site so the alert pass can raise a
`device_fault` alert from them. Never raises into the sweep: the caller logs and moves on.

`DEVICES` = off | on (default on). A site whose diagnostics could not be fetched is not
touched at all — a failed read must not look like "every device disappeared".
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from database.supabase_client import get_client
from victron import devices
from victron.vrm_series import DEFAULT_TZ_NAME

logger = logging.getLogger("vrm_api.devices")


def devices_mode() -> str:
    return "off" if os.environ.get("DEVICES", "on").strip().lower() == "off" else "on"


def _t(name: str):
    return get_client().schema("vrm").table(name)


def _local(now: datetime, tz_name: str | None) -> datetime:
    try:
        zone = ZoneInfo(tz_name or DEFAULT_TZ_NAME)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo(DEFAULT_TZ_NAME)
    return now.astimezone(zone).replace(tzinfo=None)


def _newest_record(diagnostics) -> datetime | None:
    stamps = [r.get("timestamp") for r in devices._records(diagnostics) if isinstance(r.get("timestamp"), (int, float))]
    return datetime.fromtimestamp(max(stamps), tz=timezone.utc) if stamps else None


def run_pass(sites: list[dict], diagnostics_by_site: dict[str, dict], *, now: datetime | None = None) -> dict[str, list[dict]]:
    now = now or datetime.now(timezone.utc)
    site_ids = [s["site_id"] for s in sites if s["site_id"] in diagnostics_by_site]
    if not site_ids:
        return {}
    stored: dict[str, list[dict]] = {}
    for row in _t("site_devices").select("*").in_("site_id", site_ids).execute().data or []:
        stored.setdefault(row["site_id"], []).append(row)

    out: dict[str, list[dict]] = {}
    writes: list[dict] = []
    for site in sites:
        site_id = site["site_id"]
        diagnostics = diagnostics_by_site.get(site_id)
        if diagnostics is None:
            continue
        try:
            parsed = devices.parse(diagnostics)
            if not parsed and not stored.get(site_id):
                continue    # nothing recognisable here, nothing remembered: leave the site alone
            rows = devices.evaluate(parsed, stored.get(site_id, []), now=now, local=_local(now, site.get("timezone")),
                                    reference=_newest_record(diagnostics), site_type=site.get("system_type"),
                                    reserve_set_by_hand=isinstance((site.get("health_thresholds") or {}).get("socFloorPct"), (int, float)))
        except Exception:  # noqa: BLE001 — one odd site must not cost the others
            logger.exception("devices: could not evaluate site %s", site_id)
            continue
        out[site_id] = [{"site_id": site_id, **row} for row in rows]
        writes += out[site_id]
    if writes:
        _t("site_devices").upsert(writes, on_conflict="site_id,device_key").execute()
    return out

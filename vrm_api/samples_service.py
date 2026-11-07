from __future__ import annotations
"""
The stored 15-minute copy of a site's VRM readings: filling it, and serving charts from it.

Flow: fetch from Victron -> store in `vrm.site_samples` -> read from the copy.

  * `sync_window()` — the daily sync (`routers/vrm_sync.py`) stores every day it re-reads.
  * `site_shape()` — the hour-of-day chart. Reads the copy; first tops it up from Victron when it is behind (a refresh at
    most every 15 minutes per site) or does not reach back to the start of the window (once per few hours).
    Whatever goes wrong — tables not created yet, Victron unreachable — it falls back to reading Victron live, exactly as
    before the copy existed, so a chart is never blocked by it.
"""
import logging
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd

from victron import samples_store, vrm_daily, vrm_samples
from victron.vrm_series import DEFAULT_TZ_NAME
from victron.vrm_shape import _EMPTY_SHAPE, RANGE_DAYS, fetch_site_shape, shape_from_frame

logger = logging.getLogger("vrm_api.samples")

FRESH_FOR = timedelta(minutes=45)       # the sweep stores every ~15 minutes; only a copy this behind is topped up by a page view
RETRY_AFTER_S = 5 * 60                  # a site that is offline is not asked again on every page view
HEAD_RETRY_S = 6 * 3600                 # nor is a window start Victron has no data for (a young site)
HEAD_SLACK = timedelta(hours=26)        # the copy may begin up to this much after the window start
_TAIL_TRIED: dict[str, float] = {}
_HEAD_TRIED: dict[str, float] = {}


def _utc(epoch_s: int) -> datetime:
    return datetime.fromtimestamp(epoch_s, tz=timezone.utc)


def window_for(range_key: str, tz: str | None, now: datetime) -> tuple[int, int]:
    """The same window `vrm_shape.fetch_site_shape` reads: local midnight for "today", else the last N days."""
    if range_key == "today":
        try:
            zone = ZoneInfo(tz or DEFAULT_TZ_NAME)
        except ZoneInfoNotFoundError:
            zone = ZoneInfo(DEFAULT_TZ_NAME)
        local = now.astimezone(zone).replace(hour=0, minute=0, second=0, microsecond=0)
        return int(local.astimezone(timezone.utc).timestamp()), int(now.timestamp())
    return int((now - timedelta(days=RANGE_DAYS[range_key])).timestamp()), int(now.timestamp())


def fetch_and_store(client, site: dict, start_s: int, end_s: int):
    """Read `[start_s, end_s)` from Victron and store it. Returns the frame that was stored (empty if Victron had nothing)."""
    frame = vrm_samples.fetch_samples(client, site["vrm_installation_id"], start_s, end_s)
    rows = vrm_samples.to_rows(site["site_id"], frame)
    if rows:
        samples_store.store_samples(rows)
    return frame


def daily_peaks(frame, tz: str | None) -> dict[str, tuple[float, str]]:
    """Each local day's highest 15-minute load in a stored frame: `{"2026-11-04": (1804.0, "2026-11-04T14:15:00")}`, the time
    being the START of that slot in the site's own time. The same rule as always (`vrm_daily.peak_power_at`): a reading
    counts only with a neighbour within 30 minutes before it, ties go to the earliest."""
    if frame.empty:
        return {}
    try:
        zone = ZoneInfo(tz or DEFAULT_TZ_NAME)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo(DEFAULT_TZ_NAME)
    load = pd.to_numeric(frame["load_w"], errors="coerce").dropna()
    load.index = load.index.tz_localize("UTC").tz_convert(zone).tz_localize(None)
    out: dict[str, tuple[float, str]] = {}
    for day, group in load.groupby(load.index.date):
        peak = vrm_daily.peak_power_at(group, group.index, max_gap_s=1800)
        if peak:
            out[day.isoformat()] = (round(peak[0], 1), peak[1].strftime("%Y-%m-%dT%H:%M:%S"))
    return out


def store_daily_peaks(site_id: str, frame, tz: str | None) -> int:
    """Put each day's peak, taken from the stored readings, on its daily row. Returns the days offered."""
    peaks = daily_peaks(frame, tz)
    for day, (watts, at) in peaks.items():
        samples_store.set_daily_peak(site_id, day, watts, at)
    return len(peaks)


def sync_window(client, site: dict, start, end) -> int:
    """Store the 15-minute readings for local dates `start`..`end` (inclusive) and set those days' peak load from them.
    Best effort: the daily totals the sync just wrote do not depend on it, so a failure here is logged and returns 0."""
    try:
        start_s, end_s = vrm_samples.window_epochs(start, end, site.get("timezone"))
        frame = fetch_and_store(client, site, start_s, min(end_s, vrm_samples.now_epoch()))
        store_daily_peaks(site["site_id"], frame, site.get("timezone"))
        return len(frame)
    except Exception:  # noqa: BLE001
        logger.warning("samples: could not store the 15-minute readings for %s", site.get("site_id"), exc_info=True)
        return 0


def keep_fresh(client, site: dict, diagnostics: dict | None = None, now: datetime | None = None) -> int:
    """Store a site's newest 15-minute readings (from a little before the newest stored slot, which was part-way through when
    read). With nothing stored in the last 3 days it starts 6 hours back: older days are the daily sync's and the backfill's.
    `diagnostics` reuses a call the sweep already made. Returns the slots stored."""
    now = now or datetime.now(timezone.utc)
    have = samples_store.coverage(site["site_id"], now - timedelta(days=3), now)
    start = int(have[1].timestamp()) - 3600 if have else int((now - timedelta(hours=6)).timestamp())
    frame = vrm_samples.fetch_samples(client, site["vrm_installation_id"], start, int(now.timestamp()), diagnostics=diagnostics)
    rows = vrm_samples.to_rows(site["site_id"], frame)
    return samples_store.store_samples(rows) if rows else 0


def _top_up(client, site: dict, start_s: int, end_s: int, now: datetime) -> None:
    site_id = site["site_id"]
    clock = time.monotonic()
    if client is None:          # nothing to ask Victron with: serve what is stored
        return
    have = samples_store.coverage(site_id, _utc(start_s), _utc(end_s))
    if have is None:
        if clock - _TAIL_TRIED.get(site_id, float("-inf")) >= RETRY_AFTER_S:
            _TAIL_TRIED[site_id] = clock
            fetch_and_store(client, site, start_s, end_s)
        return
    first, last = have
    if now - last > FRESH_FOR and clock - _TAIL_TRIED.get(site_id, float("-inf")) >= RETRY_AFTER_S:
        _TAIL_TRIED[site_id] = clock
        # From a slot or two back: the newest stored slot was only part-way through when it was read.
        fetch_and_store(client, site, int(last.timestamp()) - 3600, end_s)
    if first - _utc(start_s) > HEAD_SLACK and clock - _HEAD_TRIED.get(site_id, float("-inf")) >= HEAD_RETRY_S:
        _HEAD_TRIED[site_id] = clock
        fetch_and_store(client, site, start_s, int(first.timestamp()))


def site_shape(client, site: dict, range_key: str, *, now: datetime | None = None) -> dict:
    """The hour-of-day shape for a site, read from the stored copy (topped up first), or live from Victron if the copy
    cannot be used."""
    tz = site.get("timezone") or DEFAULT_TZ_NAME
    now = now or datetime.now(timezone.utc)
    start_s, end_s = window_for(range_key, tz, now)
    try:
        try:
            _top_up(client, site, start_s, end_s, now)
        except Exception:  # noqa: BLE001 — Victron slow or down: serve what is already stored
            logger.warning("samples: could not top up %s, serving what is stored", site.get("site_id"), exc_info=True)
        frame = samples_store.load_samples(site["site_id"], _utc(start_s), _utc(end_s))
        if not frame.empty:
            return shape_from_frame(frame, range_key, tz)
    except Exception:  # noqa: BLE001 — never block a chart on the copy
        logger.warning("samples: serving %s live, the stored copy could not be used", site.get("site_id"), exc_info=True)
    if client is None:
        return dict(_EMPTY_SHAPE)
    return fetch_site_shape(client, site["vrm_installation_id"], range_key=range_key, tz=tz)

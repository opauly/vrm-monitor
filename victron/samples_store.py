from __future__ import annotations
"""
Reads and writes `vrm.site_samples` (15-minute readings) and `vrm.weather_hourly` (migration 056).

Every function raises `SamplesUnavailable` when the tables are not there yet (migration not run), so a caller can fall
back to what it did before the tables existed instead of failing a page.
"""
import logging
from datetime import datetime, timezone

import pandas as pd

from database.supabase_client import get_client
from victron.vrm_samples import READINGS

logger = logging.getLogger("victron.samples_store")

_CHUNK = 1000
_PAGE = 1000


class SamplesUnavailable(RuntimeError):
    """The sample tables cannot be used (not created yet, or the database is unreachable)."""


def _t(name: str):
    return get_client().schema("vrm").table(name)


def _wrap(exc: Exception) -> SamplesUnavailable:
    text = str(exc)
    if "PGRST205" in text or "42P01" in text or "site_samples" in text or "weather_hourly" in text:
        return SamplesUnavailable("site_samples/weather_hourly not available — run migration 056")
    return SamplesUnavailable(text[:200])


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _upsert(table: str, rows: list[dict], conflict: str) -> int:
    written = 0
    try:
        for i in range(0, len(rows), _CHUNK):
            chunk = rows[i:i + _CHUNK]
            _t(table).upsert(chunk, on_conflict=conflict).execute()
            written += len(chunk)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    return written


def store_samples(rows: list[dict]) -> int:
    """Upsert 15-minute rows (idempotent: a re-fetched slot overwrites itself). Returns how many were written."""
    return _upsert("site_samples", rows, "site_id,ts")


def coverage(site_id: str, start: datetime, end: datetime) -> tuple[datetime, datetime] | None:
    """(first, last) stored slot of a site inside `[start, end]`, or None when nothing is stored there."""
    try:
        def edge(desc: bool):
            res = (_t("site_samples").select("ts").eq("site_id", site_id).gte("ts", _iso(start)).lte("ts", _iso(end))
                   .order("ts", desc=desc).limit(1).execute().data)
            return res[0]["ts"] if res else None
        first, last = edge(False), edge(True)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    if first is None or last is None:
        return None
    parse = lambda v: datetime.fromisoformat(v.replace("Z", "+00:00"))  # noqa: E731
    return parse(first), parse(last)


def load_samples(site_id: str, start: datetime, end: datetime) -> pd.DataFrame:
    """A site's stored slots in `[start, end]` as a frame indexed by naive-UTC slot start; gap rows included."""
    rows: list[dict] = []
    try:
        offset = 0
        while True:
            page = (_t("site_samples").select("ts," + ",".join(READINGS) + ",generator_on,gap").eq("site_id", site_id)
                    .gte("ts", _iso(start)).lte("ts", _iso(end)).order("ts").range(offset, offset + _PAGE - 1).execute().data or [])
            rows.extend(page)
            if len(page) < _PAGE:
                break
            offset += _PAGE
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    frame = pd.DataFrame(rows, columns=["ts", *READINGS, "generator_on", "gap"])
    if frame.empty:
        return frame.set_index(pd.DatetimeIndex([]))
    frame["ts"] = pd.to_datetime(frame["ts"], utc=True).dt.tz_localize(None)
    for name in READINGS:
        frame[name] = pd.to_numeric(frame[name], errors="coerce")
    return frame.set_index("ts")


def store_weather(rows: list[dict]) -> int:
    """Upsert hourly weather rows (see `weather_store.hourly_rows`)."""
    return _upsert("weather_hourly", rows, "lat,lon,ts")


def store_weather_days(rows: list[dict]) -> int:
    """Upsert sunrise/sunset rows (`lat`, `lon`, `date`, `sunrise`, `sunset`, `fetched_at`)."""
    return _upsert("weather_daily", rows, "lat,lon,date")


def weather_fetched_at(lat: float, lon: float) -> datetime | None:
    """When this place's weather was last refreshed, or None if it never was."""
    try:
        res = (_t("weather_hourly").select("fetched_at").eq("lat", lat).eq("lon", lon).order("fetched_at", desc=True).limit(1).execute().data)
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    return datetime.fromisoformat(res[0]["fetched_at"].replace("Z", "+00:00")) if res else None


def load_weather(lat: float, lon: float, start: datetime, end: datetime) -> list[dict]:
    """A place's stored hours with `start <= ts < end`, oldest first (`ts` is an ISO UTC string)."""
    rows: list[dict] = []
    try:
        offset = 0
        while True:
            page = (_t("weather_hourly").select("ts,ghi_wm2,cloud_pct,temp_c,rain_mm,sunshine_s,rain_prob_pct,weather_code")
                    .eq("lat", lat).eq("lon", lon).gte("ts", _iso(start)).lt("ts", _iso(end)).order("ts")
                    .range(offset, offset + _PAGE - 1).execute().data or [])
            rows.extend(page)
            if len(page) < _PAGE:
                break
            offset += _PAGE
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc
    return rows


def load_weather_days(lat: float, lon: float, start: datetime, end: datetime) -> list[dict]:
    """A place's sunrise/sunset rows whose UTC day lies within `[start, end]`."""
    try:
        return (_t("weather_daily").select("date,sunrise,sunset").eq("lat", lat).eq("lon", lon)
                .gte("date", start.date().isoformat()).lte("date", end.date().isoformat()).order("date").execute().data or [])
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc


def set_daily_peak(site_id: str, day: str, peak_w: float, peak_at: str) -> None:
    """Write a day's peak load and its slot onto the daily row — only a COMPLETE day that came from the VRM API (a CSV
    day keeps its own figures)."""
    try:
        (_t("energy_daily").update({"peak_load_w": peak_w, "peak_load_at": peak_at})
         .eq("site_id", site_id).eq("date", day).eq("dump_type", "vrm_api").eq("complete_day", True).execute())
    except Exception as exc:  # noqa: BLE001
        raise _wrap(exc) from exc

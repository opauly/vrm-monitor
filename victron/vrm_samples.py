from __future__ import annotations
"""
One site's 15-minute VRM readings as rows for `vrm.site_samples` (migration 056).

The same signals the live snapshot and the hour-of-day shape already trust (`vrm_live.py`, `vrm_shape.py`), fetched
for a window and kept slot by slot instead of reduced to a day's totals:

  pv_w            PVP, every solar charger summed (`vrm_live.fetch_pv_power_series`)
  load_w          a1 + a2 (AC consumption L1 + L2)
  battery_w       bp, positive = charging
  soc_pct         SOC
  grid_w          g1+g2+g3 when the site has a grid meter, else IP1+IP2+IP3 (the inverter's own AC input). Positive = import
  ac_in_v         IV1, or IV2 when IV1 is not published
  inverter_state  S, raw and undecoded (no label is invented)
  batt_v, batt_temp_c   V, BT
  generator_on    Gt is a lifetime run-time counter: the generator ran in a slot when the counter moved since the slot before
  gap             Victron returned nothing for the slot (every reading NULL) — a hole, not a zero

A reading a site does not publish is NULL: no data over fabricated data, like everywhere else in this pipeline.

Timestamps are the START of the 15-minute slot in UTC. Victron lays its buckets out from the `start` of the request, so
a request that does not start on a quarter hour returns slots like 17:40:05; `slot_start()` aligns every window.
"""
import logging
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np
import pandas as pd

from victron.vrm_live import (
    AC_INPUT_VOLTAGE_CODES,
    BATTERY_POWER_CODE,
    GRID_POWER_CODES,
    INVERTER_INPUT_CODES,
    INVERTER_STATE_CODE,
    LOAD_CODES,
    PV_POWER_CODE,
    SOC_CODE,
    fetch_pv_power_series,
)
from victron.vrm_series import DEFAULT_TZ_NAME, GENERATOR_CODE, _available_codes, _local_midnight_epoch_s, _series_to_pandas

logger = logging.getLogger("victron.vrm_samples")

SLOT_S = 900
UTC = ZoneInfo("UTC")
BATT_VOLTAGE_CODE = "V"
BATT_TEMP_CODE = "BT"

# Reading columns, in table order (everything but `ts`, `site_id`, `generator_on`, `gap`).
READINGS = ("pv_w", "load_w", "battery_w", "soc_pct", "grid_w", "ac_in_v", "inverter_state", "batt_v", "batt_temp_c")
_DECIMALS = {"pv_w": 1, "load_w": 1, "battery_w": 1, "soc_pct": 1, "grid_w": 1, "ac_in_v": 2, "inverter_state": 2, "batt_v": 2, "batt_temp_c": 1}


def slot_start(epoch_s: int | float) -> int:
    """Epoch seconds floored to the quarter hour."""
    return int(epoch_s) // SLOT_S * SLOT_S


def window_epochs(start, end, tz: str | None) -> tuple[int, int]:
    """`[local midnight of start, local midnight after end)` as epoch seconds — the same window `vrm_series.fetch_and_map` reads."""
    try:
        zone = ZoneInfo(tz or DEFAULT_TZ_NAME)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo(DEFAULT_TZ_NAME)
    s = start if isinstance(start, date) else date.fromisoformat(str(start)[:10])
    e = end if isinstance(end, date) else date.fromisoformat(str(end)[:10])
    return _local_midnight_epoch_s(s, zone), _local_midnight_epoch_s(e + timedelta(days=1), zone)


def _on_grid(series: pd.Series) -> pd.Series:
    """Index floored to the quarter hour, one value per slot (the last if two land together)."""
    if series.empty:
        return series
    out = series.copy()
    out.index = out.index.floor("15min")
    return out[~out.index.duplicated(keep="last")].sort_index()


def _sum(parts: list[pd.Series]) -> pd.Series:
    parts = [p for p in parts if not p.empty]
    return pd.concat(parts, axis=1).sum(axis=1, min_count=1) if parts else pd.Series(dtype=float)


def build_frame(raw: dict[str, pd.Series], pv: pd.Series, grid_codes: tuple[str, ...]) -> pd.DataFrame:
    """The 15-minute frame (naive-UTC index, one row per slot from the first to the last Victron answered) from the
    per-code series. Slots in between that Victron did not answer are kept as `gap` rows."""
    raw = {code: _on_grid(s) for code, s in raw.items()}
    pv = _on_grid(pv)
    series = {
        "pv_w": pv,
        "load_w": _sum([raw.get(c, pd.Series(dtype=float)) for c in LOAD_CODES]),
        "battery_w": raw.get(BATTERY_POWER_CODE, pd.Series(dtype=float)),
        "soc_pct": raw.get(SOC_CODE, pd.Series(dtype=float)),
        "grid_w": _sum([raw.get(c, pd.Series(dtype=float)) for c in grid_codes]),
        "ac_in_v": raw.get(AC_INPUT_VOLTAGE_CODES[0], pd.Series(dtype=float)),
        "inverter_state": raw.get(INVERTER_STATE_CODE, pd.Series(dtype=float)),
        "batt_v": raw.get(BATT_VOLTAGE_CODE, pd.Series(dtype=float)),
        "batt_temp_c": raw.get(BATT_TEMP_CODE, pd.Series(dtype=float)),
    }
    if series["ac_in_v"].empty and len(AC_INPUT_VOLTAGE_CODES) > 1:
        series["ac_in_v"] = raw.get(AC_INPUT_VOLTAGE_CODES[1], pd.Series(dtype=float))
    present = [s.index for s in series.values() if not s.empty]
    if not present:
        return pd.DataFrame(columns=[*READINGS, "generator_on", "gap"], index=pd.DatetimeIndex([]))
    grid = pd.date_range(min(i.min() for i in present), max(i.max() for i in present), freq="15min")
    frame = pd.DataFrame({name: s.reindex(grid) if not s.empty else np.nan for name, s in series.items()}, index=grid)

    gen = raw.get(GENERATOR_CODE, pd.Series(dtype=float))
    if gen.empty:
        frame["generator_on"] = pd.array([pd.NA] * len(grid), dtype="boolean")
    else:
        delta = gen.reindex(grid).diff()
        delta = delta.where(delta >= 0)     # a counter reset is unknown, not "off"
        frame["generator_on"] = (delta > 0).astype("boolean").where(delta.notna())
    frame["gap"] = frame[list(READINGS)].isna().all(axis=1)
    return frame


def fetch_samples(client, id_site, start_s: int, end_s: int, *, diagnostics: dict | None = None) -> pd.DataFrame:
    """The frame for `[start_s, end_s)` (epoch seconds), empty when the installation published nothing in it.
    Raises whatever the VRM client raises (the caller decides what a failed fetch means)."""
    start_s = slot_start(start_s)
    if diagnostics is None:
        diagnostics = client.get_diagnostics(id_site)
    available = _available_codes(diagnostics)
    if not available:
        return build_frame({}, pd.Series(dtype=float), ())

    if any(c in available for c in GRID_POWER_CODES):
        grid_codes = GRID_POWER_CODES
    elif any(c in available for c in INVERTER_INPUT_CODES):
        grid_codes = INVERTER_INPUT_CODES
    else:
        grid_codes = ()
    wanted = (*LOAD_CODES, BATTERY_POWER_CODE, SOC_CODE, *grid_codes, *AC_INPUT_VOLTAGE_CODES, INVERTER_STATE_CODE,
              BATT_VOLTAGE_CODE, BATT_TEMP_CODE, GENERATOR_CODE)
    requested = sorted({c for c in wanted if c in available})

    raw: dict[str, pd.Series] = {}
    if requested:
        body = client.get_stats(id_site, type="custom", interval="15mins", start=start_s, end=int(end_s), attribute_codes=requested)
        records = body.get("records", body) if isinstance(body, dict) else {}
        for code in requested:
            raw[code] = _series_to_pandas(records.get(code, False) if isinstance(records, dict) else False, UTC)
    pv = (fetch_pv_power_series(client, id_site, interval="15mins", start=start_s, end=int(end_s), zone=UTC)
          if PV_POWER_CODE in available else pd.Series(dtype=float))
    return build_frame(raw, pv, grid_codes)


def _clean(value, decimals: int):
    if value is None or pd.isna(value) or not np.isfinite(value):
        return None
    return round(float(value), decimals)


def to_rows(site_id: str, frame: pd.DataFrame) -> list[dict]:
    """`vrm.site_samples` rows (UTC ISO timestamps, NaN -> None) for a frame from `build_frame()`."""
    rows = []
    for ts, r in frame.iterrows():
        row = {"site_id": site_id, "ts": ts.strftime("%Y-%m-%dT%H:%M:%S+00:00")}
        for name in READINGS:
            row[name] = _clean(r[name], _DECIMALS[name])
        row["generator_on"] = None if pd.isna(r["generator_on"]) else bool(r["generator_on"])
        row["gap"] = bool(r["gap"])
        rows.append(row)
    return rows


def now_epoch() -> int:
    return int(datetime.now(timezone.utc).timestamp())

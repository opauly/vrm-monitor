"""Tonight / tomorrow forecast for one site, from weather plus the site's own history.

Pure functions — weather rows, history and the current state in, a plain dict
out; no network, database or clock of their own (`now` is passed in, as LOCAL
naive time in the site's timezone, the same convention Open-Meteo's hourly rows
use). `victron/open_meteo.py` fetches the weather; `vrm_api/forecast_service.py`
gathers the inputs and caches the result.

How the numbers are made
  * SOLAR. A site's output follows the sunlight reaching it. From the last two
    weeks we measure how many kWh THIS site made per kWh/m² of sunlight (its
    "response", `k`) — which folds in panel size, tilt, shading, dirt and
    inverter limits without having to know any of them — and apply it to the
    forecast sunlight. The spread of that ratio across days gives the range.
    With too little history, a rough `kWp x 0.75` stands in.
  * LOAD. The site's usual hour-of-day usage (a week's average, from VRM).
  * BATTERY. Stepped hour by hour: stored energy plus solar, minus usual load,
    capped at full. That gives how long the battery would carry the usual load
    from now with no grid ("backup"), where it will stand at sunrise, and whether
    it fills tomorrow. It deliberately assumes the grid is not helping, so it is
    equally the answer for an outage and for an off-grid home.

Everything is an ESTIMATE and is labelled as such where it is shown.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from statistics import median

MIN_CALIBRATION_DAYS = 5
MIN_GHI_KWH_M2 = 1.0          # ignore days too dark to calibrate against
FALLBACK_PERFORMANCE = 0.75   # kWh per kWp per kWh/m² when there is no history yet
FULL_PCT = 98.0
STORM_CODES = {95, 96, 99}


def _dt(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _r(value, digits: int = 1):
    return None if value is None else round(float(value), digits)


def _quantile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    pos = (len(ordered) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


# ── weather by day ───────────────────────────────────────────────────────────

def daily_weather(weather: dict) -> dict[str, dict]:
    """Per local date: sunlight total (kWh/m²), daytime cloud, max temp, rain, storm flag."""
    sun = {d["date"]: (_dt(d.get("sunrise")), _dt(d.get("sunset"))) for d in weather.get("daily", [])}
    days: dict[str, dict] = {}
    for row in weather.get("hourly", []):
        t = _dt(row["time"])
        if t is None:
            continue
        day = days.setdefault(t.date().isoformat(), {"ghi_wh": 0.0, "ghi_hours": 0, "cloud": [], "temp": [], "rain_prob": [], "rain_mm": 0.0, "storm": False})
        if row.get("ghi") is not None:
            day["ghi_wh"] += row["ghi"]
            day["ghi_hours"] += 1
        rise, sset = sun.get(t.date().isoformat(), (None, None))
        if row.get("cloud") is not None and (rise is None or sset is None or rise <= t <= sset):
            day["cloud"].append(row["cloud"])
        if row.get("temp") is not None:
            day["temp"].append(row["temp"])
        if row.get("rain_prob") is not None:
            day["rain_prob"].append(row["rain_prob"])
        day["rain_mm"] += row.get("rain_mm") or 0.0
        if row.get("code") in STORM_CODES:
            day["storm"] = True
    out = {}
    for date, d in days.items():
        out[date] = {
            "ghi_kwh_m2": _r(d["ghi_wh"] / 1000, 2) if d["ghi_hours"] >= 20 else None,   # a partial day's total is not a day's total
            "cloud_pct": _r(sum(d["cloud"]) / len(d["cloud"]), 0) if d["cloud"] else None,
            "temp_max_c": _r(max(d["temp"]), 0) if d["temp"] else None,
            "rain_prob_pct": _r(max(d["rain_prob"]), 0) if d["rain_prob"] else None,
            "rain_mm": _r(d["rain_mm"]), "storm": d["storm"],
        }
    return out


def storm_ahead(weather: dict, now: datetime) -> bool:
    """A thunderstorm hour between now and the end of tomorrow (a storm that has
    already passed is not advice)."""
    end = datetime.combine(now.date() + timedelta(days=2), datetime.min.time())
    return any(r.get("code") in STORM_CODES and (t := _dt(r["time"])) is not None and now <= t < end for r in weather.get("hourly", []))


def storm_windows(weather: dict, now: datetime) -> list[dict]:
    """When the thunderstorm hours fall, from now to the end of tomorrow: `[{day: "today"|"tomorrow", from: "15:00",
    to: "18:00"}]`, one entry per run of consecutive hours. `to` is the end of the last stormy hour."""
    first = now.replace(minute=0, second=0, microsecond=0)
    tomorrow = (now.date() + timedelta(days=1))
    end = datetime.combine(now.date() + timedelta(days=2), datetime.min.time())
    hours = sorted(t for r in weather.get("hourly", []) if r.get("code") in STORM_CODES and (t := _dt(r["time"])) is not None and first <= t < end)
    runs: list[list[datetime]] = []
    for t in hours:
        if runs and t - runs[-1][-1] == timedelta(hours=1) and t.date() == runs[-1][-1].date():
            runs[-1].append(t)
        else:
            runs.append([t])
    return [{"day": "tomorrow" if run[0].date() == tomorrow else "today", "from": run[0].strftime("%H:00"),
             "to": (run[-1] + timedelta(hours=1)).strftime("%H:00") if run[-1].hour < 23 else "24:00"} for run in runs]


def sky(day: dict) -> str:
    """One word for the day: storm | rain | cloudy | partly | sunny."""
    if day.get("storm"):
        return "storm"
    if (day.get("rain_prob_pct") or 0) >= 60 or (day.get("rain_mm") or 0) >= 5:
        return "rain"
    cloud = day.get("cloud_pct")
    if cloud is None:
        return "partly"
    return "cloudy" if cloud >= 70 else "partly" if cloud >= 30 else "sunny"


# ── solar response ───────────────────────────────────────────────────────────

def calibrate(history: list[dict], day_weather: dict[str, dict], *, today: str, pv_kwp: float | None) -> dict:
    """`{k, low, high, days, source}`: kWh made per kWh/m² of sunlight, and its spread."""
    ratios, produced = [], []
    for row in history:
        date, pv = str(row.get("date")), row.get("pv_kwh")
        if date >= today or pv is None or pv <= 0.2:
            continue
        produced.append(float(pv))
        ghi = (day_weather.get(date) or {}).get("ghi_kwh_m2")
        if ghi and ghi >= MIN_GHI_KWH_M2:
            ratios.append(float(pv) / ghi)
    typical = _r(median(produced[-14:]), 1) if produced else None
    if len(ratios) >= MIN_CALIBRATION_DAYS:
        k = median(ratios)
        return {"k": k, "low": _quantile(ratios, 0.25), "high": _quantile(ratios, 0.75), "days": len(ratios), "source": "history", "typical_pv_kwh": typical}
    if pv_kwp:
        k = pv_kwp * FALLBACK_PERFORMANCE
        return {"k": k, "low": k * 0.75, "high": k * 1.15, "days": len(ratios), "source": "size", "typical_pv_kwh": typical}
    return {"k": None, "low": None, "high": None, "days": len(ratios), "source": None, "typical_pv_kwh": typical}


# ── battery ──────────────────────────────────────────────────────────────────

def _hour_steps(start: datetime, end: datetime):
    """(hour_start, fraction_of_hour_inside_[start,end]) for each hour touched."""
    t = start.replace(minute=0, second=0, microsecond=0)
    while t < end:
        nxt = t + timedelta(hours=1)
        lo, hi = max(t, start), min(nxt, end)
        frac = (hi - lo).total_seconds() / 3600
        if frac > 0:
            yield t, frac
        t = nxt


def _ghi_by_hour(weather: dict) -> dict[str, float]:
    return {r["time"][:13]: r["ghi"] for r in weather.get("hourly", []) if r.get("ghi") is not None}


def simulate(*, start: datetime, end: datetime, energy_kwh: float, capacity_kwh: float, k: float | None,
             ghi: dict[str, float], load_w: list[float]) -> dict:
    """Step the battery from `start` to `end`. Returns the energy at the end and when it
    emptied / filled, if it did."""
    energy, empty_at, full_at, peak = energy_kwh, None, None, energy_kwh
    for hour, frac in _hour_steps(start, end):
        sun_wh = ghi.get(hour.strftime("%Y-%m-%dT%H"), 0.0)
        pv = (k * sun_wh / 1000 * frac) if k else 0.0
        use = load_w[hour.hour] / 1000 * frac
        before = energy
        energy = min(energy + pv - use, capacity_kwh)
        peak = max(peak, energy)
        if energy <= 0:
            if empty_at is None:
                drain = use - pv
                spent = hour + timedelta(hours=frac * (before / drain if drain > 0 else 1))
                empty_at = min(spent, hour + timedelta(hours=frac))
            energy = 0.0
        if full_at is None and energy >= capacity_kwh * FULL_PCT / 100:
            full_at = hour + timedelta(hours=frac)
    return {"energy_kwh": energy, "empty_at": empty_at, "full_at": full_at, "peak_kwh": peak}


def usually_fills(history: list[dict], *, today: str) -> bool:
    """Has this site's battery regularly reached a full charge lately? (>= half of the
    last 14 recorded days, with at least 5 of them recorded.)"""
    flags = [r.get("battery_reached_float") for r in sorted(history, key=lambda r: str(r.get("date")))
             if str(r.get("date")) < today and r.get("battery_reached_float") is not None][-14:]
    return len(flags) >= 5 and sum(1 for f in flags if f) / len(flags) >= 0.5


# ── the forecast ─────────────────────────────────────────────────────────────

def build_forecast(*, weather: dict, now: datetime, pv_history: list[dict], load_profile_w: list[float] | None,
                   soc_pct: float | None, battery_kwh: float | None, pv_kwp: float | None, system_type: str | None) -> dict:
    """`now` = local naive time at the site. `load_profile_w` = 24 usual-hour load figures (W)."""
    today = now.date().isoformat()
    tomorrow = (now.date() + timedelta(days=1)).isoformat()
    day_weather = daily_weather(weather)
    calib = calibrate(pv_history, day_weather, today=today, pv_kwp=pv_kwp)
    k = calib["k"]
    ghi = _ghi_by_hour(weather)
    typical = calib.get("typical_pv_kwh")

    def solar_for(date: str) -> dict | None:
        total = (day_weather.get(date) or {}).get("ghi_kwh_m2")
        if k is None or total is None:
            return None
        pv = k * total
        pct = round((pv / typical - 1) * 100) if typical else None
        return {"kwh": _r(pv), "low_kwh": _r(calib["low"] * total), "high_kwh": _r(calib["high"] * total), "vs_typical_pct": pct}

    def day_card(date: str) -> dict:
        w = day_weather.get(date) or {}
        return {"date": date, "sky": sky(w) if w else None, "cloud_pct": w.get("cloud_pct"), "temp_max_c": w.get("temp_max_c"),
                "rain_prob_pct": w.get("rain_prob_pct"), "storm": bool(w.get("storm")), "solar": solar_for(date)}

    storm = storm_ahead(weather, now)
    result: dict = {
        "generated_for": now.isoformat(timespec="minutes"),
        "calibration": {"source": calib["source"], "days": calib["days"], "typical_pv_kwh": typical},
        "tomorrow": day_card(tomorrow), "today": day_card(today),
        "storm_ahead": storm, "storm_windows": storm_windows(weather, now) if storm else [], "backup": None, "tomorrow_battery": None, "advice": [],
    }

    # Battery: only with a battery, a state of charge and a usual-load profile.
    has_battery = bool(battery_kwh) and system_type != "grid_zero"
    if has_battery and soc_pct is not None and load_profile_w and len(load_profile_w) == 24:
        capacity = float(battery_kwh)
        energy0 = max(min(soc_pct, 100.0), 0.0) / 100 * capacity
        sunrise = next((_dt(d["sunrise"]) for d in weather.get("daily", []) if _dt(d.get("sunrise")) and _dt(d["sunrise"]) > now), None)
        if sunrise is not None:
            night = simulate(start=now, end=sunrise, energy_kwh=energy0, capacity_kwh=capacity, k=k, ghi=ghi, load_w=load_profile_w)
            result["backup"] = {
                "until_sunrise": sunrise.isoformat(timespec="minutes"),
                "reaches_sunrise": night["empty_at"] is None,
                "empty_at": night["empty_at"].isoformat(timespec="minutes") if night["empty_at"] else None,
                "hours": _r(((night["empty_at"] or sunrise) - now).total_seconds() / 3600),
                "soc_at_sunrise_pct": _r(night["energy_kwh"] / capacity * 100, 0),
            }
            sunset = next((_dt(d["sunset"]) for d in weather.get("daily", []) if _dt(d.get("sunset")) and _dt(d["sunset"]) > sunrise), None)
            if sunset is not None and k is not None:
                day_sim = simulate(start=sunrise, end=sunset, energy_kwh=night["energy_kwh"], capacity_kwh=capacity, k=k, ghi=ghi, load_w=load_profile_w)
                result["tomorrow_battery"] = {
                    "full_by": day_sim["full_at"].isoformat(timespec="minutes") if day_sim["full_at"] else None,
                    "peak_pct": _r(day_sim["peak_kwh"] / capacity * 100, 0),
                    "soc_at_sunset_pct": _r(day_sim["energy_kwh"] / capacity * 100, 0),
                    # "May only reach X%" assumes no grid help, so it only means something for a
                    # home with no grid, or one whose battery normally does fill. On a grid-tied site
                    # that never fills (its usual load outweighs its solar) it would be a false alarm.
                    "show_peak": system_type == "off_grid" or usually_fills(pv_history, today=today),
                }

    result["advice"] = advice(result, typical=typical)
    return result


def advice(result: dict, *, typical: float | None) -> list[dict]:
    out: list[dict] = []
    if result.get("storm_ahead"):
        out.append({"code": "storm", "params": {}})
    backup = result.get("backup")
    if backup and not backup["reaches_sunrise"]:
        out.append({"code": "backup_short", "params": {"hours": backup["hours"]}})
    solar = result["tomorrow"].get("solar")
    if solar and typical and typical >= 2:
        if solar["kwh"] <= 0.6 * typical:
            out.append({"code": "low_solar_tomorrow", "params": {"kwh": solar["kwh"], "typical": typical}})
        elif solar["kwh"] >= 1.15 * typical and solar["kwh"] >= typical + 2:
            out.append({"code": "high_solar_tomorrow", "params": {"kwh": solar["kwh"], "typical": typical}})
    # Only a DULL day is news: a site whose usual load outweighs its solar never fills
    # the battery on any day, and saying so every morning would just be noise.
    tb = result.get("tomorrow_battery")
    if tb and tb.get("show_peak") and tb["peak_pct"] < 95 and solar and (solar.get("vs_typical_pct") or 0) <= -20:
        out.append({"code": "battery_wont_fill", "params": {"peak_pct": tb["peak_pct"]}})
    return out

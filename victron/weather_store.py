from __future__ import annotations
"""
Weather kept per place in `vrm.weather_hourly` / `vrm.weather_daily` (migrations 056, 057), from Open-Meteo
(`open_meteo.fetch_weather`), and read back from there by the PDF reports and the forecast.

Flow, as for the 15-minute readings: fetch from Open-Meteo -> store -> read from the copy.

  * Each refresh stores the recent past AND the next three days. A row whose hour had not yet started when it was
    fetched (`ts > fetched_at`) is a forecast; the next refresh overwrites it with the later figure, so an hour ends up
    holding what the weather actually did.
  * `forecast_weather()` — the forecast's input: the last 14 days and the next 3, in the site's local time. Refreshed
    from Open-Meteo when the copy is over an hour old.
  * `period_summary()` — the report's weather block for a period (sunshine, rainy days, cloud, sunlight).
  * Both return None / raise `SamplesUnavailable` when the copy cannot answer, and the caller falls back to calling
    Open-Meteo directly, as before the copy existed.

A place is the site's latitude/longitude rounded to 0.01 degree (about 1 km): sites at the same spot share rows and
cost one request, the same grid `forecast_service` has always used for its cache.
"""
import logging
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from victron import open_meteo, samples_store

logger = logging.getLogger("victron.weather_store")

REFRESH_PAST_DAYS = 3
FORECAST_DAYS = 3
REFRESH_EVERY_S = 6 * 3600           # the scheduled sweep
FORECAST_TTL = timedelta(minutes=60)  # a forecast read refreshes a copy older than this
RETRY_AFTER_S = 5 * 60               # an unreachable weather service is not asked again on every call
ENOUGH = 0.85                        # share of a period's hours that must be stored before a report trusts the copy
_LAST_REFRESH: dict[tuple[float, float], float] = {}
_FAILED_AT: dict[tuple[float, float], float] = {}

_HOURLY = {"ghi": "ghi_wm2", "cloud": "cloud_pct", "temp": "temp_c", "rain_mm": "rain_mm", "sunshine_s": "sunshine_s",
           "rain_prob": "rain_prob_pct", "code": "weather_code"}


def place(lat, lon) -> tuple[float, float]:
    return round(float(lat), 2), round(float(lon), 2)


def _zone(tz: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def hourly_rows(weather: dict, lat: float, lon: float, *, now: datetime | None = None) -> list[dict]:
    """`vrm.weather_hourly` rows for every hour in `weather` (Open-Meteo asked in UTC); hours with no figure at all are dropped."""
    fetched_at = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    rows = []
    for r in weather.get("hourly", []):
        t = str(r.get("time") or "")[:16]
        if not t:
            continue
        values = {col: r.get(key) for key, col in _HOURLY.items()}
        if all(v is None for v in values.values()):
            continue
        rows.append({"lat": lat, "lon": lon, "ts": f"{t}:00+00:00", **values, "fetched_at": fetched_at})
    return rows


def daily_rows(weather: dict, lat: float, lon: float, *, now: datetime | None = None) -> list[dict]:
    """`vrm.weather_daily` rows (sunrise/sunset, UTC)."""
    fetched_at = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    stamp = lambda v: f"{str(v)[:16]}:00+00:00" if v else None  # noqa: E731
    return [{"lat": lat, "lon": lon, "date": d["date"], "sunrise": stamp(d.get("sunrise")), "sunset": stamp(d.get("sunset")), "fetched_at": fetched_at}
            for d in weather.get("daily", []) if d.get("date")]


def refresh_place(lat, lon, *, past_days: int = REFRESH_PAST_DAYS, forecast_days: int = FORECAST_DAYS, force: bool = False) -> int:
    """Fetch and store one place's weather. Returns the hourly rows written (0 when skipped or the service was unreachable)."""
    key = place(lat, lon)
    clock = time.monotonic()
    if not force and clock - _LAST_REFRESH.get(key, float("-inf")) < REFRESH_EVERY_S:
        return 0
    if clock - _FAILED_AT.get(key, float("-inf")) < RETRY_AFTER_S:
        return 0
    weather = open_meteo.fetch_weather(key[0], key[1], "UTC", past_days=min(past_days, 92), forecast_days=forecast_days)
    if weather is None:
        _FAILED_AT[key] = clock
        return 0
    now = datetime.now(timezone.utc)
    rows = hourly_rows(weather, key[0], key[1], now=now)
    written = samples_store.store_weather(rows) if rows else 0
    days = daily_rows(weather, key[0], key[1], now=now)
    if days:
        samples_store.store_weather_days(days)
    _LAST_REFRESH[key] = clock
    return written


def refresh_sites(sites: list[dict]) -> int:
    """One refresh per distinct place among `sites` (rows with latitude/longitude). Never raises: weather is an extra."""
    places = {place(s["latitude"], s["longitude"]) for s in sites if s.get("latitude") is not None and s.get("longitude") is not None}
    total = 0
    for lat, lon in sorted(places):
        try:
            total += refresh_place(lat, lon)
        except Exception:  # noqa: BLE001
            logger.warning("weather_store: could not refresh %s,%s", lat, lon, exc_info=True)
    return total


# ── the forecast reads the copy ──────────────────────────────────────────────

def forecast_weather(lat, lon, tz: str | None, now: datetime, *, force: bool = False) -> dict | None:
    """The forecast's weather input — `{"hourly": [{time, ghi, cloud, temp, rain_prob, rain_mm, code}], "daily": [{date,
    sunrise, sunset}]}` with site-local naive ISO times, the last 14 days plus the next 3 — read from the copy, which is
    refreshed first when it is over an hour old. None when there is nothing to answer with. Raises `SamplesUnavailable`
    when the tables cannot be used (the caller then asks Open-Meteo directly)."""
    key = place(lat, lon)
    fetched = samples_store.weather_fetched_at(*key)
    if force or fetched is None or now - fetched > FORECAST_TTL:
        refresh_place(key[0], key[1], past_days=14, forecast_days=FORECAST_DAYS, force=True)
    zone = _zone(tz)
    start, end = now - timedelta(days=14), now + timedelta(days=FORECAST_DAYS)
    hours = samples_store.load_weather(key[0], key[1], start, end)
    if not hours:
        return None
    local = lambda v: _utc(v).astimezone(zone).replace(tzinfo=None).isoformat(timespec="minutes")  # noqa: E731
    hourly = [{"time": local(r["ts"]), "ghi": r.get("ghi_wm2"), "cloud": r.get("cloud_pct"), "temp": r.get("temp_c"),
               "rain_prob": r.get("rain_prob_pct"), "rain_mm": r.get("rain_mm"), "code": r.get("weather_code")} for r in hours]
    daily = []
    for d in samples_store.load_weather_days(key[0], key[1], start - timedelta(days=1), end):
        if d.get("sunrise") is None:
            continue
        sunrise = local(d["sunrise"])
        daily.append({"date": sunrise[:10], "sunrise": sunrise, "sunset": local(d["sunset"]) if d.get("sunset") else None})
    return {"hourly": hourly, "daily": daily}


# ── the report's weather block reads the copy ────────────────────────────────

def summarise(hours: list[dict], zone: ZoneInfo, days: int) -> dict:
    """The report figures from hourly rows: average sunshine hours per day, days with over 5 mm of rain, average cloud
    cover, and total sunlight on a horizontal surface (kWh/m2)."""
    per_day: dict[date, dict] = {}
    for r in hours:
        d = per_day.setdefault(_utc(r["ts"]).astimezone(zone).date(), {"sun": 0.0, "rain": 0.0, "cloud": [], "ghi": 0.0})
        d["sun"] += r.get("sunshine_s") or 0.0
        d["rain"] += r.get("rain_mm") or 0.0
        d["ghi"] += r.get("ghi_wm2") or 0.0
        if r.get("cloud_pct") is not None:
            d["cloud"].append(r["cloud_pct"])
    n = max(days, 1)
    return {
        "avgSunshineHrs": round(sum(d["sun"] for d in per_day.values()) / n / 3600, 1),
        "rainyDays": len([d for d in per_day.values() if d["rain"] > 5]),
        "avgCloudPct": round(sum(sum(d["cloud"]) / len(d["cloud"]) for d in per_day.values() if d["cloud"]) / n),
        "totalIrradianceKwh": round(sum(d["ghi"] for d in per_day.values()) / 1000, 1),
    }


def period_summary(lat, lon, start, end, tz: str | None, *, now: datetime | None = None) -> dict | None:
    """The report's weather block for local dates `start`..`end` (inclusive), from the copy; the copy is filled from
    Open-Meteo first when it holds under 85% of the period's hours. None when it still cannot (a period older than
    Open-Meteo's 92 days of recent history that was never stored): the caller then uses the archive service."""
    now = now or datetime.now(timezone.utc)
    key = place(lat, lon)
    zone = _zone(tz)
    s = start if isinstance(start, date) else date.fromisoformat(str(start)[:10])
    e = end if isinstance(end, date) else date.fromisoformat(str(end)[:10])
    start_utc = datetime(s.year, s.month, s.day, tzinfo=zone).astimezone(timezone.utc)
    end_utc = datetime(e.year, e.month, e.day, tzinfo=zone).astimezone(timezone.utc) + timedelta(days=1)
    expected = max((min(end_utc, now.replace(minute=0, second=0, microsecond=0)) - start_utc).total_seconds() / 3600, 0)
    if expected <= 0:
        return None
    hours = samples_store.load_weather(key[0], key[1], start_utc, end_utc)
    if len(hours) < ENOUGH * expected:
        back = (now - start_utc).days + 2
        if back <= 92:
            refresh_place(key[0], key[1], past_days=back, forecast_days=1, force=True)
            hours = samples_store.load_weather(key[0], key[1], start_utc, end_utc)
    if len(hours) < ENOUGH * expected:
        return None
    return summarise(hours, zone, (e - s).days + 1)

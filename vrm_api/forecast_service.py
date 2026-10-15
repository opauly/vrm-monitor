"""The tonight / tomorrow forecast for a site: inputs, cache, serving.

Gathers a site's coordinates, recent solar history, live battery state and usual
hourly load; gets the weather (`victron/open_meteo.py`); runs the model
(`victron/forecast.py`); and keeps ONE cached row per site in
`vrm.site_forecasts`, rebuilt at most hourly. The usual-load profile comes from
VRM (the same hour-by-hour data the Site shape chart draws) and is refreshed
about once a day, so a page view never waits on VRM.

Switch: `FORECAST` = off (default) | on. Everything is best-effort: a site with
no coordinates, an unreachable weather service or no solar history yields
`{"available": false, "reason": ...}` or a partial forecast — never an error page.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from database.supabase_client import get_client
from victron import forecast, open_meteo
from victron.vrm_remote import VrmRemoteClient
from victron.vrm_series import DEFAULT_TZ_NAME
from victron.vrm_shape import fetch_site_shape
from vrm_api import secrets

logger = logging.getLogger("vrm_api.forecast")

TTL = timedelta(minutes=60)
PROFILE_TTL = timedelta(hours=24)
HISTORY_DAYS = 20
OFFLINE_AFTER = timedelta(minutes=45)

# One weather request per place, not per site: several sites often share a spot (the
# three Vista Atenas systems), and separate requests could succeed for one and time out
# for another, giving the same hillside different forecasts. Keyed by place rounded to
# ~1 km; kept for as long as a forecast is.
_WEATHER: dict[tuple, tuple[datetime, dict]] = {}


def forecast_mode() -> str:
    return "on" if os.environ.get("FORECAST", "off").strip().lower() == "on" else "off"


def _t(name: str):
    return get_client().schema("vrm").table(name)


def _parse(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _local_now(tz_name: str | None, now_utc: datetime) -> datetime:
    try:
        zone = ZoneInfo(tz_name or DEFAULT_TZ_NAME)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo(DEFAULT_TZ_NAME)
    return now_utc.astimezone(zone).replace(tzinfo=None)


def _weather_for(site: dict, tz: str, now: datetime, *, force: bool = False) -> dict | None:
    key = (round(float(site["latitude"]), 2), round(float(site["longitude"]), 2), tz)
    hit = _WEATHER.get(key)
    if hit and not force and now - hit[0] < TTL:
        return hit[1]
    weather = open_meteo.fetch_weather(site["latitude"], site["longitude"], tz)
    if weather is not None:
        _WEATHER[key] = (now, weather)
    return weather


def _vrm_client(site: dict) -> VrmRemoteClient | None:
    token = None
    try:
        token = secrets.read_customer_vrm_token(site["customer_id"])
    except Exception:  # noqa: BLE001 — fall back to the admin token, like the sweep does
        logger.warning("forecast: could not read the VRM token for customer %s", site.get("customer_id"))
    token = token or os.environ.get("VRM_ADMIN_TOKEN")
    return VrmRemoteClient(token) if token else None


def usual_load_profile(site: dict) -> list[float] | None:
    """The site's usual load by hour of day (24 W figures), from last week's VRM data."""
    client = _vrm_client(site)
    if client is None or site.get("vrm_installation_id") is None:
        return None
    try:
        shape = fetch_site_shape(client, site["vrm_installation_id"], range_key="week", tz=site.get("timezone") or DEFAULT_TZ_NAME)
    except Exception:  # noqa: BLE001
        logger.warning("forecast: could not read the load profile for %s", site["site_id"])
        return None
    values = shape.get("load") or []
    present = [v for v in values if v is not None]
    if len(values) != 24 or not present:
        return None
    mean = sum(present) / len(present)
    return [float(v) if v is not None else float(mean) for v in values]


def _history(site_id: str, now_utc: datetime) -> list[dict]:
    since = (now_utc - timedelta(days=HISTORY_DAYS)).date().isoformat()
    rows = (_t("energy_daily").select("id, date, pv_kwh, battery_reached_float, complete_day").eq("site_id", site_id).gte("date", since).execute().data or [])
    by_date: dict[str, dict] = {}
    for row in rows:
        if row.get("complete_day") is False:
            continue
        if row["date"] not in by_date or (row.get("id") or 0) > (by_date[row["date"]].get("id") or 0):
            by_date[row["date"]] = row
    return list(by_date.values())


def _soc(site_id: str, now_utc: datetime) -> float | None:
    rows = _t("site_snapshots").select("captured_at, soc_pct").eq("site_id", site_id).execute().data or []
    if not rows:
        return None
    seen = _parse(rows[0].get("captured_at"))
    soc = rows[0].get("soc_pct")
    return float(soc) if seen is not None and now_utc - seen <= OFFLINE_AFTER and isinstance(soc, (int, float)) else None


def get_forecast(site_id: str, *, now: datetime | None = None, force: bool = False, mode: str | None = None) -> dict | None:
    """The forecast for one site. None = no such VRM site; `{"available": False, ...}` = cannot make one."""
    mode = mode or forecast_mode()
    if mode == "off":
        return {"available": False, "reason": "off"}
    now = now or datetime.now(timezone.utc)

    cached = (_t("site_forecasts").select("*").eq("site_id", site_id).execute().data or [None])[0]
    if cached and not force:
        made = _parse(cached.get("generated_at"))
        # Also stale once the site's calendar day has turned: "tomorrow" in a forecast made
        # at 23:50 is today at 00:20.
        old = cached.get("result") or {}
        same_day = str(old.get("generated_for", ""))[:10] == _local_now(old.get("timezone"), now).date().isoformat()
        if made is not None and now - made < TTL and same_day:
            return cached["result"]

    sites = (_t("sites").select("site_id, customer_id, latitude, longitude, timezone, pv_kwp, battery_usable_kwh, system_type, vrm_installation_id")
             .eq("site_id", site_id).eq("source", "vrm_api").eq("active", True).execute().data or [])
    if not sites:
        return None
    site = sites[0]
    if site.get("latitude") is None or site.get("longitude") is None:
        return {"available": False, "reason": "no_location"}

    tz = site.get("timezone") or DEFAULT_TZ_NAME
    weather = _weather_for(site, tz, now, force=force)
    if weather is None:
        return cached["result"] if cached else {"available": False, "reason": "weather_unavailable"}

    profile = (cached or {}).get("load_profile") or {}
    profile_at = _parse(profile.get("updated_at"))
    if not profile.get("load_w") or profile_at is None or now - profile_at > PROFILE_TTL:
        fresh = usual_load_profile(site)
        profile = {"load_w": fresh, "updated_at": now.isoformat()} if fresh else profile    # keep the old one if VRM is down

    result = forecast.build_forecast(
        weather=weather, now=_local_now(tz, now), pv_history=_history(site_id, now), load_profile_w=profile.get("load_w"),
        soc_pct=_soc(site_id, now), battery_kwh=site.get("battery_usable_kwh"), pv_kwp=site.get("pv_kwp"), system_type=site.get("system_type"))
    result = {"available": True, "generated_at": now.isoformat(), "source": "open-meteo", "timezone": tz, **result}

    row = {"site_id": site_id, "generated_at": now.isoformat(), "load_profile": profile or None, "result": result}
    if cached:
        _t("site_forecasts").update(row).eq("site_id", site_id).execute()
    else:
        _t("site_forecasts").insert(row).execute()
    return result


def compact(result: dict | None) -> dict | None:
    """The few forecast figures the daily AI summary may mention."""
    if not result or not result.get("available"):
        return None
    tomorrow, backup, advice = result.get("tomorrow") or {}, result.get("backup"), {a["code"] for a in result.get("advice") or []}
    solar = tomorrow.get("solar") or {}
    return {
        "tomorrow_sky": tomorrow.get("sky"), "tomorrow_pv_kwh": solar.get("kwh"), "tomorrow_vs_typical_pct": solar.get("vs_typical_pct"),
        "typical_pv_kwh": (result.get("calibration") or {}).get("typical_pv_kwh"),
        "storm": "storm" in advice,
        "backup_hours": backup.get("hours") if backup else None, "backup_reaches_sunrise": backup.get("reaches_sunrise") if backup else None,
        "soc_at_sunrise_pct": backup.get("soc_at_sunrise_pct") if backup else None,
    }

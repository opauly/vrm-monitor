"""Weather from Open-Meteo for the tonight / tomorrow forecast.

One request returns both the last two weeks (what the sun actually delivered,
used to calibrate a site's own solar response) and the next three days (what to
expect), as hourly figures in the SITE's local time:

  shortwave_radiation  W/m²  sunlight on a horizontal surface (the PV driver)
  cloud_cover          %
  temperature_2m       °C
  precipitation_probability %, precipitation mm
  weather_code         WMO code (95-99 = thunderstorm)

plus each day's sunrise and sunset.

Free tier: https://api.open-meteo.com (non-commercial use). Commercial use needs
Open-Meteo's paid plan: set `OPEN_METEO_API_KEY` and requests go to
https://customer-api.open-meteo.com with the key; `OPEN_METEO_BASE_URL`
overrides the host (tests, a proxy).

Fail-soft like the other external lookups here: any problem returns None and the
caller simply shows no forecast.
"""
from __future__ import annotations

import logging
import os

import requests

logger = logging.getLogger("victron.open_meteo")

FREE_URL = "https://api.open-meteo.com/v1/forecast"
PAID_URL = "https://customer-api.open-meteo.com/v1/forecast"
HOURLY = ("shortwave_radiation", "cloud_cover", "temperature_2m", "precipitation_probability", "precipitation", "weather_code")
DAILY = ("sunrise", "sunset")
TIMEOUT_S = 10


def _url() -> str:
    override = (os.environ.get("OPEN_METEO_BASE_URL") or "").strip()
    if override:
        return override
    return PAID_URL if (os.environ.get("OPEN_METEO_API_KEY") or "").strip() else FREE_URL


def fetch_weather(lat: float, lon: float, tz: str, *, past_days: int = 14, forecast_days: int = 3, http_get=None) -> dict | None:
    """`{"hourly": [{time, ghi, cloud, temp, rain_prob, rain_mm, code}, ...], "daily": [{date, sunrise, sunset}, ...]}`
    with local-naive ISO times, or None if the service could not be read."""
    params = {
        "latitude": round(float(lat), 4), "longitude": round(float(lon), 4), "timezone": tz or "auto",
        "hourly": ",".join(HOURLY), "daily": ",".join(DAILY), "past_days": past_days, "forecast_days": forecast_days,
    }
    key = (os.environ.get("OPEN_METEO_API_KEY") or "").strip()
    if key:
        params["apikey"] = key
    get = http_get or requests.get
    try:
        response = get(_url(), params=params, timeout=TIMEOUT_S)
        response.raise_for_status()
        body = response.json()
        return normalise(body)
    except Exception:  # noqa: BLE001 — a forecast is an extra; never break a page for it
        logger.warning("open_meteo: could not fetch the forecast", exc_info=True)
        return None


def normalise(body: dict) -> dict:
    hourly = body["hourly"]
    times = hourly["time"]

    def col(name: str) -> list:
        values = hourly.get(name) or []
        return list(values) + [None] * (len(times) - len(values))

    ghi, cloud, temp = col("shortwave_radiation"), col("cloud_cover"), col("temperature_2m")
    prob, mm, code = col("precipitation_probability"), col("precipitation"), col("weather_code")
    rows = [{"time": times[i], "ghi": ghi[i], "cloud": cloud[i], "temp": temp[i], "rain_prob": prob[i], "rain_mm": mm[i], "code": code[i]}
            for i in range(len(times))]
    daily = body.get("daily") or {}
    days = [{"date": d, "sunrise": (daily.get("sunrise") or [None] * len(daily.get("time", [])))[i],
             "sunset": (daily.get("sunset") or [None] * len(daily.get("time", [])))[i]} for i, d in enumerate(daily.get("time", []))]
    return {"hourly": rows, "daily": days}

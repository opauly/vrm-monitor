"""Heads-ups worth sending even though nothing is wrong: the day's outlook, a great solar day coming, a storm while the
battery is low, unusually high use. Pure rules over data the sweep already has; the service
(`vrm_api/insight_notices_service.py`) gathers the inputs, stores what these return and delivers it.

These are not alerts. An alert is a problem with a start and an end. A notice is said once and is over, so it lives in its own
table (`vrm.insight_notices`) and every kind is something the customer switches on. Rules keep it from becoming noise:

  * each kind has a time of day it may be said in (the morning outlook is not sent at 3 a.m.), in the SITE's own clock;
  * each says a thing once per day/event (`key`), however many sweeps see the same condition;
  * the service caps how many non-briefing notices one customer gets in a day.

Kinds: daily_briefing, solar_day, storm_battery, high_usage, usage_day.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

DAILY_BRIEFING = "daily_briefing"
SOLAR_DAY = "solar_day"
STORM_BATTERY = "storm_battery"
HIGH_USAGE = "high_usage"
USAGE_DAY = "usage_day"
KINDS = (DAILY_BRIEFING, SOLAR_DAY, STORM_BATTERY, HIGH_USAGE, USAGE_DAY)

# Local-time windows [from, to) a kind may be generated in.
BRIEFING_HOURS = (7, 11)
USAGE_DAY_HOURS = (7, 11)
SOLAR_DAY_HOURS = (18, 21)
AWAKE_HOURS = (7, 21)                    # storms and high use: never overnight

STORM_LEAD_HOURS = 8                     # warn when a storm is this close or closer
STORM_SOC_LOW_PCT = 60.0                 # "battery low" for a storm, grid-tied
STORM_SOC_LOW_OFF_GRID_PCT = 70.0        # an off-grid battery is all the backup there is

SOLAR_DAY_MIN_RATIO, SOLAR_DAY_MIN_EXTRA_KWH = 1.15, 2.0          # same bar the daily summary uses
HIGH_USAGE_FACTOR = 2.0                  # now vs usual for this hour
HIGH_USAGE_SUSTAINED_FACTOR = 1.5        # and the reading before it was already well above usual
HIGH_USAGE_MIN_W = 1500.0
HIGH_USAGE_MIN_EXTRA_W = 1000.0
HIGH_USAGE_COOLDOWN_HOURS = 6            # one per 6-hour block of the day
USAGE_DAY_FACTOR, USAGE_DAY_MIN_EXTRA_KWH, USAGE_DAY_MIN_DAYS = 1.3, 3.0, 4


@dataclass(frozen=True)
class Notice:
    kind: str
    key: str                              # said once per (customer, key)
    severity: str                         # 'ok' | 'warning', the card colour
    detail: dict = field(default_factory=dict)


def _in(hour: int, window: tuple[int, int]) -> bool:
    return window[0] <= hour < window[1]


def _num(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _solar(card: dict | None) -> dict | None:
    solar = (card or {}).get("solar")
    return solar if isinstance(solar, dict) and _num(solar.get("kwh")) is not None else None


def _direction(pct: float) -> str:
    return "above" if pct >= 5 else "below" if pct <= -5 else "near"


def _storm_in_reach(forecast: dict | None, now_local: datetime) -> dict | None:
    """The first thunderstorm window that has not started yet but starts within STORM_LEAD_HOURS."""
    for window in (forecast or {}).get("storm_windows") or []:
        try:
            start = int(str(window["from"])[:2])
        except (KeyError, ValueError):
            continue
        ahead = start - now_local.hour + (24 if window.get("day") == "tomorrow" else 0)
        if 0 < ahead <= STORM_LEAD_HOURS:
            return window
    return None


def evaluate(*, site: dict, now_local: datetime, forecast: dict | None, snapshot: dict | None, previous: dict | None,
             load_profile_w: list | None, energy_rows: list[dict] | None, kinds: set[str] | None = None) -> list[Notice]:
    """Notices that hold for one site right now. `kinds` limits the work to kinds somebody has switched on."""
    want = set(KINDS) if kinds is None else set(kinds)
    hour, today = now_local.hour, now_local.date()
    out: list[Notice] = []
    soc = _num((snapshot or {}).get("soc_pct"))
    off_grid = site.get("system_type") == "off_grid"
    available = bool(forecast and forecast.get("available", True))

    if DAILY_BRIEFING in want and _in(hour, BRIEFING_HOURS) and available:
        card = (forecast or {}).get("today") or {}
        solar = _solar(card)
        windows = [w for w in (forecast or {}).get("storm_windows") or [] if w.get("day") == "today" and int(str(w.get("from", "00"))[:2]) >= hour]
        if solar or windows:
            pct = _num(solar.get("vs_typical_pct")) if solar else None
            out.append(Notice(DAILY_BRIEFING, f"briefing:{today}", "ok", {
                "date": str(today), "sky": card.get("sky"),
                **({"kwh": solar["kwh"], "typical": (forecast.get("calibration") or {}).get("typical_pv_kwh"),
                    "pct": abs(round(pct)), "direction": _direction(pct)} if solar and pct is not None else
                   {"kwh": solar["kwh"]} if solar else {}),
                **({"windows": windows} if windows else {}), **({"soc_pct": round(soc)} if soc is not None else {}),
                "charge_first": bool(windows and soc is not None and soc < 80)}))

    if SOLAR_DAY_HOURS[0] <= hour < SOLAR_DAY_HOURS[1] and SOLAR_DAY in want and available:
        solar = _solar((forecast or {}).get("tomorrow"))
        typical = _num(((forecast or {}).get("calibration") or {}).get("typical_pv_kwh"))
        if solar and typical and typical >= 2 and solar["kwh"] >= SOLAR_DAY_MIN_RATIO * typical and solar["kwh"] >= typical + SOLAR_DAY_MIN_EXTRA_KWH:
            tomorrow = today + timedelta(days=1)
            out.append(Notice(SOLAR_DAY, f"solar_day:{tomorrow}", "ok", {
                "date": str(tomorrow), "kwh": solar["kwh"], "typical": typical, "pct": abs(round((solar["kwh"] / typical - 1) * 100))}))

    if STORM_BATTERY in want and _in(hour, AWAKE_HOURS) and available and soc is not None:
        window = _storm_in_reach(forecast, now_local)
        limit = STORM_SOC_LOW_OFF_GRID_PCT if off_grid else STORM_SOC_LOW_PCT
        if window and soc < limit:
            when = today + timedelta(days=1 if window.get("day") == "tomorrow" else 0)
            out.append(Notice(STORM_BATTERY, f"storm:{when}:{window.get('from')}", "warning", {
                "windows": [window], "soc_pct": round(soc)}))

    if HIGH_USAGE in want and _in(hour, AWAKE_HOURS):
        usual = _num(load_profile_w[hour]) if load_profile_w and len(load_profile_w) == 24 else None
        load = _num((snapshot or {}).get("load_power_w"))
        before = _num((previous or {}).get("load_power_w"))
        if usual is not None and usual > 0 and load is not None and before is not None:
            if (load >= HIGH_USAGE_FACTOR * usual and load >= HIGH_USAGE_MIN_W and load - usual >= HIGH_USAGE_MIN_EXTRA_W
                    and before >= HIGH_USAGE_SUSTAINED_FACTOR * usual and before - usual >= HIGH_USAGE_MIN_EXTRA_W / 2):
                out.append(Notice(HIGH_USAGE, f"high_usage:{today}:{hour // HIGH_USAGE_COOLDOWN_HOURS}", "warning", {
                    "kw": round(load / 1000, 1), "usual_kw": round(usual / 1000, 1), "factor": round(load / usual, 1)}))

    if USAGE_DAY in want and _in(hour, USAGE_DAY_HOURS) and energy_rows:
        yesterday = str(today - timedelta(days=1))
        by_date = {str(r.get("date")): r for r in energy_rows if r.get("complete_day") is not False and _num(r.get("load_kwh")) is not None}
        if yesterday in by_date:
            earlier = [_num(r["load_kwh"]) for d, r in by_date.items() if d < yesterday][-7:]
            if len(earlier) >= USAGE_DAY_MIN_DAYS:
                average, load = sum(earlier) / len(earlier), _num(by_date[yesterday]["load_kwh"])
                if average >= 1 and load >= USAGE_DAY_FACTOR * average and load >= average + USAGE_DAY_MIN_EXTRA_KWH:
                    out.append(Notice(USAGE_DAY, f"usage_day:{yesterday}", "warning", {
                        "date": yesterday, "kwh": round(load, 1), "average_kwh": round(average, 1), "pct": round((load / average - 1) * 100)}))
    return out

"""Heads-ups worth sending even though nothing is wrong: the day's outlook, a great solar day coming, a storm while the
battery is low, unusually high use. Pure rules over data the sweep already has; the service
(`vrm_api/insight_notices_service.py`) gathers the inputs, stores what these return and delivers it.

These are not alerts. An alert is a problem with a start and an end. A notice is said once and is over, so it lives in its own
table (`vrm.insight_notices`) and every kind is something the customer switches on. Rules keep it from becoming noise:

  * each kind has a time of day it may be said in (the morning outlook is not sent at 3 a.m.), in the SITE's own clock;
  * each says a thing once per day/event (`key`), however many sweeps see the same condition;
  * the service caps how many non-briefing notices one customer gets in a day.

Kinds: daily_briefing, solar_day, storm_battery, high_usage, usage_day.

Weather is shared by every site in one place, so the weather-driven kinds (daily_briefing, solar_day, storm_battery) are said ONCE
per group of sites, not once per site: a property if the sites are in one, else the sites that share a location. The solar figures
of a group are summed over its sites (one site crossing a threshold by a hair while its neighbours do not is not a different day),
and the batteries are reported as a range or by name. high_usage and usage_day stay per site: they are about that site's own load.
"""
from __future__ import annotations

import re
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


@dataclass(frozen=True)
class Member:
    """One site of a group, with what the rules need of it."""
    site: dict
    forecast: dict | None
    snapshot: dict | None


def group_name(names: list[str]) -> str:
    """"Vista Atenas LP" from "Vista Atenas LP M1 (Houses)" and its siblings: the words their names share."""
    def base(n: str) -> list[str]:
        return re.sub(r"\s*\(.*?\)\s*", " ", n).split()
    words = [base(n) for n in names if n]
    if not words:
        return ""
    common: list[str] = []
    for i, w in enumerate(words[0]):
        if all(len(o) > i and o[i].lower() == w.lower() for o in words):
            common.append(w)
        else:
            break
    while len(common) > 1 and re.fullmatch(r"[A-Za-z]?\d+", common[-1]):
        common.pop()
    return " ".join(common) or " ".join(words[0])


def _day_total(members: list[Member], day: str) -> tuple[float, float, int] | None:
    """`(expected kWh, typical kWh, sites counted)` for `day` ("today" / "tomorrow") summed over the members that have both figures."""
    kwh = typical = 0.0
    n = 0
    for m in members:
        solar = _solar(((m.forecast or {}).get(day)))
        t = _num(((m.forecast or {}).get("calibration") or {}).get("typical_pv_kwh"))
        if solar and t:
            kwh, typical, n = kwh + solar["kwh"], typical + t, n + 1
    return (kwh, typical, n) if n else None


def _windows(members: list[Member], day: str | None = None) -> list[dict]:
    """The group's storm windows, the same one counted once however many sites report it."""
    seen, out = set(), []
    for m in members:
        for w in (m.forecast or {}).get("storm_windows") or []:
            key = (w.get("day"), w.get("from"), w.get("to"))
            if key not in seen and (day is None or w.get("day") == day):
                seen.add(key)
                out.append(w)
    return out


def evaluate_group(*, key: str, name: str, members: list[Member], now_local: datetime, kinds: set[str] | None = None,
                   property_id: str | None = None) -> list[Notice]:
    """The weather-driven notices for one group of sites (a property, or the sites that share a place)."""
    want = set(KINDS) if kinds is None else set(kinds)
    hour, today = now_local.hour, now_local.date()
    usable = [m for m in members if m.forecast and m.forecast.get("available", True)]
    socs = [(m.site.get("display_name") or m.site.get("site_id"), _num((m.snapshot or {}).get("soc_pct")), m) for m in members]
    socs = [(n, round(v), m) for n, v, m in socs if v is not None]
    where = {"name": name, "group": key, "sites": len(members), **({"property_id": property_id} if property_id else {})}
    out: list[Notice] = []

    if DAILY_BRIEFING in want and _in(hour, BRIEFING_HOURS) and usable:
        total = _day_total(usable, "today")
        windows = [w for w in _windows(usable, "today") if int(str(w.get("from", "00"))[:2]) >= hour]
        if total or windows:
            detail: dict = {**where, "date": str(today), "sky": ((usable[0].forecast or {}).get("today") or {}).get("sky")}
            if total:
                kwh, typical, _ = total
                pct = (kwh / typical - 1) * 100 if typical else 0.0
                detail.update(kwh=round(kwh, 1), typical=round(typical, 1), pct=abs(round(pct)), direction=_direction(pct))
            if windows:
                detail["windows"] = windows
            if socs:
                detail.update(soc_min=min(v for _, v, _ in socs), soc_max=max(v for _, v, _ in socs))
            detail["charge_first"] = bool(windows and socs and detail["soc_min"] < 80)
            out.append(Notice(DAILY_BRIEFING, f"briefing:{key}:{today}", "ok", detail))

    if SOLAR_DAY in want and SOLAR_DAY_HOURS[0] <= hour < SOLAR_DAY_HOURS[1] and usable:
        total = _day_total(usable, "tomorrow")
        if total:
            kwh, typical, _ = total
            if typical >= 2 and kwh >= SOLAR_DAY_MIN_RATIO * typical and kwh >= typical + SOLAR_DAY_MIN_EXTRA_KWH:
                tomorrow = today + timedelta(days=1)
                out.append(Notice(SOLAR_DAY, f"solar_day:{key}:{tomorrow}", "ok", {
                    **where, "date": str(tomorrow), "kwh": round(kwh, 1), "typical": round(typical, 1), "pct": abs(round((kwh / typical - 1) * 100))}))

    if STORM_BATTERY in want and _in(hour, AWAKE_HOURS) and usable and socs:
        window = next((w for w in _windows(usable) if _storm_in_reach({"storm_windows": [w]}, now_local)), None)
        if window:
            low = [(n, v) for n, v, m in socs
                   if v < (STORM_SOC_LOW_OFF_GRID_PCT if m.site.get("system_type") == "off_grid" else STORM_SOC_LOW_PCT)]
            if low:
                when = today + timedelta(days=1 if window.get("day") == "tomorrow" else 0)
                out.append(Notice(STORM_BATTERY, f"storm:{key}:{when}:{window.get('from')}", "warning", {
                    **where, "windows": [window], "soc_pct": min(v for _, v in low), "low": [{"name": n, "soc": v} for n, v in sorted(low, key=lambda x: x[1])]}))
    return out


def evaluate(*, site: dict, now_local: datetime, snapshot: dict | None, previous: dict | None,
             load_profile_w: list | None, energy_rows: list[dict] | None, kinds: set[str] | None = None) -> list[Notice]:
    """The notices about ONE site's own load: unusually high use right now, and a high-use day yesterday."""
    want = set(KINDS) if kinds is None else set(kinds)
    hour, today = now_local.hour, now_local.date()
    out: list[Notice] = []

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

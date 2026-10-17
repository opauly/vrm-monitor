"""Victron's own alarm log, read as events.

`GET /installations/{id}/alarm-log` is what the VRM portal's "Alarms" page shows: one record per
alarm, with when it started and cleared. Two things come out of it that the 15-minute sweep cannot
see for itself:

  * **An overload that really tripped.** A VE.Bus inverter tolerates an overload for a while (the live
    value reads "Warning", 1) and only raises the official alarm (2) once that time runs out, then shuts
    down. The alarm lasts about 30 seconds in the log, far shorter than a sweep interval, so the sweep
    almost never catches it live. `recent_overload()` reads it from the log instead.
  * **Warnings that keep coming back.** Charger terminal overheating, repeated high charge current, a
    battery that keeps dropping out of BMS contact: each one clears by itself, none is worth a message
    on its own, and a pattern of them is how equipment fails. `patterns()` counts the repeats and the
    site pages / reports show them quietly. They never open an alert and never touch a health score.

Only a record whose state is "Alarm" counts; the log's rare "Warning" rows (the tolerated stage) are
ignored. Pure functions: nothing here calls the network or the database.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

# Alarms this close together are one episode (a trip and its immediate retry).
EPISODE_GAP_S = 10 * 60

# The alert: an overload alarm that began within this long ago (three sweeps), or is still active.
OVERLOAD_ALERT_WINDOW_MIN = 50

# category -> (episodes needed, within how many days) before it counts as a repeat.
THRESHOLDS: dict[str, tuple[int, int]] = {
    "overload": (3, 14),
    "temperature": (2, 14),
    "high_current": (3, 14),
    "low_battery": (2, 14),
    "battery_voltage": (2, 14),
    "bms": (2, 14),
    "grid_input": (3, 14),
    "vebus_error": (2, 14),
    "internal_failure": (2, 14),
    "charger_error": (2, 14),
}
WINDOW_DAYS = max(days for _, days in THRESHOLDS.values())

_ERROR_NUMBER = re.compile(r"^#\s*(\d+)")
_TEMPERATURE_ERRORS = {"26"}   # charger: "terminal overheated"
_BMS_ERRORS = {"67"}           # charger: "no BMS"


@dataclass(frozen=True)
class Event:
    id: int
    category: str
    detail: str            # the log's own wording for the state ("#26 - Charger terminal overheated"), when it adds anything
    device: str
    started: datetime
    cleared: datetime | None
    active: bool

    @property
    def seconds(self) -> int | None:
        return int((self.cleared - self.started).total_seconds()) if self.cleared else None


def _at(value) -> datetime | None:
    return datetime.fromtimestamp(value, tz=timezone.utc) if isinstance(value, (int, float)) and value > 0 else None


def classify(description: str, state: str) -> str | None:
    """Which kind of event a log record is, or None when it is not one we track."""
    d, s = (description or "").strip().lower(), (state or "").strip()
    if d == "error code":
        match = _ERROR_NUMBER.match(s)
        number = match.group(1) if match else None
        if number in _TEMPERATURE_ERRORS:
            return "temperature"
        if number in _BMS_ERRORS:
            return "bms"
        return "charger_error" if number else None
    if d == "ac-input":
        return "grid_input" if s.lower() == "not available" else None
    if d == "grid alarm":
        return "grid_input" if s.lower() == "grid lost" else None
    if d == "ve.bus error":
        return "vebus_error"
    if s != "Alarm":
        return None        # "Warning" rows and plain state changes ("State of charge", "No data alarm")
    if d.startswith("overload"):
        return "overload"
    if d == "low battery":
        return "low_battery"
    if d.startswith("temperature") or ("temperature" in d and "high" in d):
        return "temperature"
    if "current" in d and ("high" in d):
        return "high_current"
    if "voltage" in d:
        return "battery_voltage"
    if d == "bms lost":
        return "bms"
    if d == "internal failure":
        return "internal_failure"
    return None


def parse(response) -> list[Event]:
    """The log's records as events, newest first. Anything unusable is skipped."""
    records = response.get("records") if isinstance(response, dict) else response
    out: list[Event] = []
    for r in records or []:
        if not isinstance(r, dict):
            continue
        started = _at(r.get("started"))
        category = classify(str(r.get("description") or ""), str(r.get("nameEnum") or ""))
        if started is None or category is None:
            continue
        state = str(r.get("nameEnum") or "")
        out.append(Event(
            id=int(r.get("idAlarm") or 0), category=category,
            detail="" if state in ("Alarm", "Not available", "Grid lost") else state,
            device=str(r.get("customName") or r.get("device") or ""),
            started=started, cleared=_at(r.get("cleared")), active=bool(r.get("isActive")),
        ))
    out.sort(key=lambda e: e.started, reverse=True)
    return out


def recent_overload(events: list[Event], now: datetime) -> dict | None:
    """The overload alarm worth an alert, if one just happened: `{at, seconds, count}`, else None."""
    cutoff = now - timedelta(minutes=OVERLOAD_ALERT_WINDOW_MIN)
    recent = [e for e in events if e.category == "overload" and (e.active or (e.cleared or e.started) >= cutoff)]
    if not recent:
        return None
    latest = recent[0]
    return {"at": latest.started.isoformat(), "seconds": latest.seconds, "count": len(recent)}


def _episodes(events: list[Event]) -> list[list[Event]]:
    """Events of one category grouped into episodes, oldest first."""
    groups: list[list[Event]] = []
    for e in sorted(events, key=lambda e: e.started):
        if groups and (e.started - (groups[-1][-1].cleared or groups[-1][-1].started)).total_seconds() <= EPISODE_GAP_S:
            groups[-1].append(e)
        else:
            groups.append([e])
    return groups


def patterns(events: list[Event], now: datetime, *, off_grid: bool = False) -> list[dict]:
    """Categories that have repeated enough lately to be worth a quiet note, most frequent first.

    Each: `{category, count, window_days, first_at, last_at, active, device, detail}` where `count` is episodes in the window.
    An off-grid site has no grid to lose, so its AC-input events (a generator being started and stopped) are not counted.
    """
    out: list[dict] = []
    for category, (needed, days) in THRESHOLDS.items():
        if category == "grid_input" and off_grid:
            continue
        cutoff = now - timedelta(days=days)
        mine = [e for e in events if e.category == category and e.started >= cutoff]
        episodes = _episodes(mine)
        if len(episodes) < needed:
            continue
        flat = [e for group in episodes for e in group]
        latest = max(flat, key=lambda e: e.started)
        devices = [e.device for e in flat if e.device]
        details = [e.detail for e in flat if e.detail]
        out.append({
            "category": category, "count": len(episodes), "window_days": days,
            "first_at": min(e.started for e in flat).isoformat(), "last_at": latest.started.isoformat(),
            "active": any(e.active for e in flat),
            "device": max(set(devices), key=devices.count) if devices else "",
            "detail": max(set(details), key=details.count) if details else "",
        })
    out.sort(key=lambda p: (-p["count"], p["category"]))
    return out

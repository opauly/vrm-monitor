"""Per-device health: the batteries, inverters and solar chargers behind a site.

The 15-minute sweep already fetches each installation's VRM diagnostics (one
record per device attribute). This module turns that into one row per physical
device — status `ok` / `warn` / `bad`, a short note code with its numbers, and the
few figures the Devices table shows — and keeps the little history the checks need.
Pure functions: no database, no clock of their own (`tests/test_devices.py`);
persistence is `vrm_api/devices_service.py`.

What is checked (note codes in brackets):

  charger   an error code or Fault state                      [charger_error]  bad
            not reporting for 45+ minutes                      [not_reporting]  bad
            near-zero yield while its siblings produce         [no_output]      bad
            yield far below its own normal while its siblings
            are normal (day 1 = warn, day 2 in a row = bad)    [low_output]     warn/bad
  battery   modules offline, or fewer than ever seen           [modules_offline] bad
            internal failure alarm                             [battery_failure] bad
            modules blocking charge/discharge, battery not full [blocking]      warn
  inverter  a grid-connected battery site with no outage reserve: the
            system is not an ESS one, or its minimum SOC is under 30%  [reserve_not_enforced / reserve_low]  warn
            a VE.Bus error                                     [inverter_error]  bad
            fewer units than ever seen                         [units_missing]   bad
            a unit's warning flags set                         [inverter_warning] warn
  any       gone from the diagnostics for 2 sweeps             [missing]        bad

Chargers on a weather day: when EVERY charger at a site is low it is cloud, not a
fault — only a charger that falls behind its siblings is flagged. A single-charger
site gets the fault checks only (whole-site underperformance is the anomaly job's).

Yield history: a charger moves a finished day into "yield yesterday" when it shuts down at dusk
(not at midnight), so a day's total is filed when "yield today" falls back, under the last day it
was still climbing. A charger that never closes a day its siblings did counts as 0 for it.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from statistics import median

OK, WARN, BAD = "ok", "warn", "bad"
RANK = {OK: 0, WARN: 1, BAD: 2}

STALE_AFTER = timedelta(minutes=45)
MISSING_SWEEPS = 2
HISTORY_DAYS = 21
BAD_SWEEPS_KEPT_DAYS = 45
MIN_HISTORY_DAYS = 5       # own days needed before a charger is judged against itself
NO_OUTPUT_KWH = 0.1
NO_OUTPUT_PEAK_W = 50
SIBLING_MIN_KWH = 1.0      # the others must have really produced for "no output" to mean anything
LOW_RATIO = 0.3
NORMAL_RATIO = 0.7
SOC_FULL_PCT = 90          # a BMS blocks charge near full on purpose
MIN_RESERVE_PCT = 30       # a grid-connected battery should hold back at least this much for an outage

_BATTERY_MAKERS = {"PYLON": "Pylontech"}


def _records(diagnostics) -> list[dict]:
    recs = diagnostics.get("records", diagnostics) if isinstance(diagnostics, dict) else diagnostics
    return [r for r in recs if isinstance(r, dict)] if isinstance(recs, list) else []


def _num(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _by_instance(records: list[dict]) -> dict[tuple[str, int], dict[str, dict]]:
    out: dict[tuple[str, int], dict[str, dict]] = {}
    for r in records:
        kind = {"Solar Charger": "charger", "VE.Bus System": "inverter", "Battery Monitor": "battery"}.get(r.get("Device"))
        if kind and r.get("instance") is not None and r.get("code"):
            out.setdefault((kind, int(r["instance"])), {})[r["code"]] = r
    return out


def _raw(rec: dict, code: str):
    r = rec.get(code)
    return None if r is None else r.get("rawValue")


def _text(rec: dict, code: str) -> str | None:
    r = rec.get(code)
    return None if r is None else r.get("formattedValue")


def _ts(rec: dict, codes: tuple[str, ...]) -> datetime | None:
    stamps = [_num(rec[c].get("timestamp")) for c in codes if c in rec]
    stamps = [s for s in stamps if s is not None]
    return datetime.fromtimestamp(max(stamps), tz=timezone.utc) if stamps else None


def _system_type(records: list[dict]) -> str | None:
    for r in records:
        if r.get("code") == "st":
            return str(r.get("formattedValue") or r.get("rawValue") or "") or None
    return None


def ess_floor(records: list[dict]) -> float | None:
    """The state of charge the grid-connected system will not discharge below (while the grid is
    up) — what the installer set as ESS "Minimum SOC (unless grid fails)". When Battery Life is
    managing the limit, the *active* limit is the real floor (it can sit above the setting).

    Only an ESS system enforces it. A "Hub-1" system still carries a stored value (a default of 10%),
    but nothing holds the battery back, so there is no floor to take into account."""
    if (_system_type(records) or "").upper() not in ("ESS", "HUB-4"):
        return None
    by_code = {r.get("code"): _num(r.get("rawValue")) for r in records if r.get("code") in ("ssl", "H4ms")}
    value = by_code.get("ssl") if by_code.get("ssl") is not None else by_code.get("H4ms")
    return value if value is not None and 0 <= value <= 100 else None


def _ess_setting(records: list[dict]) -> float | None:
    for r in records:
        if r.get("code") == "H4ms":
            return _num(r.get("rawValue"))
    return None


def parse(diagnostics) -> list[dict]:
    """One dict per device: `key`, `kind`, `label`, `metrics`, `seen` (when it last reported)
    and `faults` — the hard problems readable from a single reading, as `(code, params)`."""
    records = _records(diagnostics)
    devices: list[dict] = []
    for (kind, instance), rec in sorted(_by_instance(records).items()):
        key = f"{kind}:{instance}"
        faults: list[tuple[str, dict]] = []
        if kind == "charger":
            if "ScS" not in rec and "PVP" not in rec:
                continue
            error = _raw(rec, "ScERR")
            if _num(error) not in (None, 0):
                faults.append(("charger_error", {"error": _text(rec, "ScERR")}))
            elif _num(_raw(rec, "ScS")) == 2:
                faults.append(("charger_error", {"error": "Fault"}))
            devices.append({
                "key": key, "kind": kind, "instance": instance, "label": _text(rec, "ScM") or "", "faults": faults,
                "seen": _ts(rec, ("ScS", "PVP", "YT")),
                "metrics": {"yield_today_kwh": _num(_raw(rec, "YT")), "yield_yesterday_kwh": _num(_raw(rec, "YY")),
                            "peak_yesterday_w": _num(_raw(rec, "MCPY")), "pv_w": _num(_raw(rec, "PVP")), "state": _text(rec, "ScS")},
            })
        elif kind == "battery":
            if "mon" not in rec:
                continue    # a battery monitor without module counts (e.g. a shunt) has nothing to check here
            online, offline = _num(_raw(rec, "mon")) or 0, _num(_raw(rec, "mof")) or 0
            if _num(_raw(rec, "AIE")) not in (None, 0):
                faults.append(("battery_failure", {}))
            maker = str(_text(rec, "Bm") or "").strip()
            devices.append({
                "key": key, "kind": kind, "instance": instance, "label": _BATTERY_MAKERS.get(maker.upper(), maker.title()), "faults": faults,
                "seen": _ts(rec, ("mon", "SOC", "V")),
                "metrics": {"modules_online": int(online), "modules_offline": int(offline),
                            "blocking_charge": int(_num(_raw(rec, "mbc")) or 0), "blocking_discharge": int(_num(_raw(rec, "mbd")) or 0),
                            "soc_pct": _num(_raw(rec, "SOC")), "soh_pct": _num(_raw(rec, "SOH"))},
            })
        elif kind == "inverter":
            serial_slots = sorted(int(m.group(1)) for c in rec if (m := re.fullmatch(r"vs(\d)", c)))
            if not serial_slots and "S" not in rec:
                continue
            if _num(_raw(rec, "ERR")) not in (None, 0):
                faults.append(("inverter_error", {"error": _text(rec, "ERR")}))
            warning_units = [slot + 1 for slot in serial_slots if _num(_raw(rec, f"wf{slot}")) not in (None, 0)]
            devices.append({
                "key": key, "kind": kind, "instance": instance, "label": "Multi / Quattro", "faults": faults,
                "seen": _ts(rec, ("S", "ERR")), "warning_units": warning_units,
                "metrics": {"units": len(serial_slots), "state": _text(rec, "S"), "ess_min_soc_pct": ess_floor(records),
                            "vrm_system_type": _system_type(records), "ess_setting_pct": _ess_setting(records)},
            })
    totals: dict[str, int] = {}
    for d in devices:
        totals[d["kind"]] = totals.get(d["kind"], 0) + 1
    seen_so_far: dict[str, int] = {}
    for d in devices:     # "Solar charger 2 of 3" — numbered in instance order, which is stable
        seen_so_far[d["kind"]] = seen_so_far.get(d["kind"], 0) + 1
        d["metrics"]["n"], d["metrics"]["of"] = seen_so_far[d["kind"]], totals[d["kind"]]
    return devices


def _count_bad_sweep(state: dict, status: str, today: date) -> None:
    """Remember how many sweeps found this device bad on each local day — what the daily
    health score reads (`vrm.compute_daily_health`: a device counts against a day once it was
    bad in 4+ sweeps, about an hour, so a one-sweep glitch costs nothing)."""
    if status != BAD:
        return
    counts = dict(state.get("bad_sweeps") or {})
    key = _iso_date(today)
    counts[key] = int(counts.get(key, 0)) + 1
    cutoff = _iso_date(today - timedelta(days=BAD_SWEEPS_KEPT_DAYS))
    state["bad_sweeps"] = {k: v for k, v in counts.items() if k >= cutoff}


def _worse(a: str, b: str) -> str:
    return a if RANK[a] >= RANK[b] else b


def _iso_date(d: date) -> str:
    return d.isoformat()


HISTORY_VERSION = 2


def _record_yield_history(device: dict, state: dict, *, today: date) -> tuple[dict[str, float], dict | None]:
    """The charger's daily totals, keyed by the day they were made, and the day in progress.

    A Victron charger does NOT roll over at midnight: when it shuts down at dusk it moves the finished
    day into "yield yesterday" and starts "yield today" from zero. So the total of a day is only known
    once "today" drops back — at that moment "yesterday" holds it, and the day it belongs to is the
    last day "today" was still climbing (`run`). History written before this (version 1) assumed a
    midnight rollover and filed totals under the wrong days; it is discarded."""
    current = state.get("daily_v") == HISTORY_VERSION
    daily = dict(state.get("daily") or {}) if current else {}
    run = state.get("run") if current else None
    m = device["metrics"]
    yt, yy = m.get("yield_today_kwh"), m.get("yield_yesterday_kwh")
    if yt is not None:
        if run and yt < run["max"] - 0.05:                 # "today" fell back: the finished day moved to "yesterday"
            if yy is not None:
                daily[run["date"]] = yy
            run = None
        if run is None:
            # A charger that has produced nothing yet has not been "climbing" today.
            run = {"date": _iso_date(today) if yt > 0 else _iso_date(today - timedelta(days=1)), "max": yt}
        elif yt > run["max"]:
            run = {"date": _iso_date(today), "max": yt}    # the day it belongs to = the latest day it was still climbing
    cutoff = _iso_date(today - timedelta(days=HISTORY_DAYS))
    return {k: v for k, v in daily.items() if k >= cutoff}, run


def _judge_chargers(devices: list[dict], states: dict[str, dict]) -> dict[str, tuple[str, dict | None, str | None]]:
    """charger key -> (status, note, the day judged). Only chargers that have a sibling to be compared with."""
    chargers = [d for d in devices if d["kind"] == "charger" and d.get("reporting", True)]
    if len(chargers) < 2:
        return {}
    # The newest day that at least half of the chargers have closed out.
    need = (len(chargers) + 1) // 2
    counts: dict[str, int] = {}
    for d in chargers:
        for k in (states[d["key"]].get("daily") or {}):
            counts[k] = counts.get(k, 0) + 1
    closed = sorted((k for k, n in counts.items() if n >= need), reverse=True)
    if not closed:
        return {}
    day = closed[0]
    values: dict[str, float | None] = {}
    for d in chargers:
        st = states[d["key"]]
        got = (st.get("daily") or {}).get(day)
        if got is None:
            # Not closed out. Still climbing on that day -> its total just has not been filed yet (unknown);
            # otherwise it did nothing that day.
            pending = (st.get("run") or {}).get("date", "") >= day
            got = None if pending else 0.0
        values[d["key"]] = got
    out: dict[str, tuple[str, dict | None, str | None]] = {}
    ratios: dict[str, float] = {}
    for d in chargers:
        own = [v for k, v in (states[d["key"]].get("daily") or {}).items() if k != day and v is not None]
        if len(own) >= MIN_HISTORY_DAYS and values[d["key"]] is not None and median(own) > 0:
            ratios[d["key"]] = values[d["key"]] / median(own)
    for d in chargers:
        key, value = d["key"], values[d["key"]]
        if value is None:
            continue
        others = [values[o["key"]] for o in chargers if o["key"] != key and values[o["key"]] is not None]
        if value < NO_OUTPUT_KWH and others and median(others) >= SIBLING_MIN_KWH:
            out[key] = (BAD, {"code": "no_output", "params": {"kwh": round(value, 2), "others_kwh": round(median(others), 1)}}, day)
            continue
        other_ratios = [r for k, r in ratios.items() if k != key]
        if key in ratios and ratios[key] < LOW_RATIO and other_ratios and median(other_ratios) >= NORMAL_RATIO:
            out[key] = (WARN, {"code": "low_output", "params": {"kwh": round(value, 2), "pct_below": round((1 - ratios[key]) * 100)}}, day)
        else:
            out[key] = (OK, None, day)
    return out


def evaluate(parsed: list[dict], existing: list[dict], *, now: datetime, local: datetime, reference: datetime | None,
             site_type: str | None = None, reserve_set_by_hand: bool = False) -> list[dict]:
    """The rows to store for one site. `existing` are the stored rows (any order); `now` is UTC,
    `local` the same instant in the site's time zone, `reference` the newest record time in the
    diagnostics (what "this device stopped reporting" is measured against). `site_type` is the
    site's system type (hybrid / off_grid / ...): the outage-reserve check is for hybrid sites, and is
    skipped when `reserve_set_by_hand` (the site says its reserve is held by something VRM cannot
    see, e.g. a Virtual Switch assistant)."""
    prior = {row["device_key"]: row for row in existing}
    today = local.date()
    states: dict[str, dict] = {}
    for d in parsed:
        old = dict((prior.get(d["key"]) or {}).get("state") or {})
        d["reporting"] = d["seen"] is None or reference is None or reference - d["seen"] <= STALE_AFTER
        if d["kind"] == "charger":
            old["daily"], old["run"] = _record_yield_history(d, old, today=today)
            old["daily_v"] = HISTORY_VERSION
        elif d["kind"] == "battery":
            old["max_modules"] = max(int(old.get("max_modules") or 0), d["metrics"]["modules_online"] + d["metrics"]["modules_offline"])
        elif d["kind"] == "inverter":
            old["max_units"] = max(int(old.get("max_units") or 0), d["metrics"]["units"])
        states[d["key"]] = old

    yield_verdict = _judge_chargers(parsed, states)

    rows: list[dict] = []
    stamp = now.isoformat()
    for d in parsed:
        key, state, m = d["key"], states[d["key"]], d["metrics"]
        status, note = OK, None

        def raise_to(level: str, code: str, **params) -> None:
            nonlocal status, note
            if RANK[level] > RANK[status]:
                status, note = level, {"code": code, "params": params}

        if not d["reporting"]:
            raise_to(BAD, "not_reporting", minutes=int((reference - d["seen"]).total_seconds() // 60))
        for code, params in d["faults"]:
            raise_to(BAD, code, **params)
        if d["kind"] == "battery":
            total = m["modules_online"] + m["modules_offline"]
            if m["modules_offline"] > 0 or m["modules_online"] < state.get("max_modules", 0):
                raise_to(BAD, "modules_offline", online=m["modules_online"], total=max(total, state.get("max_modules", 0)))
            soc = m.get("soc_pct")
            if (m["blocking_charge"] or m["blocking_discharge"]) and soc is not None and soc < SOC_FULL_PCT:
                raise_to(WARN, "blocking", charge=m["blocking_charge"], discharge=m["blocking_discharge"])
        elif d["kind"] == "inverter":
            if m["units"] < state.get("max_units", 0):
                raise_to(BAD, "units_missing", units=m["units"], expected=state.get("max_units"))
            if d.get("warning_units"):
                raise_to(WARN, "inverter_warning", unit=d["warning_units"][0])
            if site_type == "hybrid" and not reserve_set_by_hand and any(x["kind"] == "battery" for x in parsed):
                if str(m.get("vrm_system_type") or "").upper() not in ("ESS", "HUB-4"):
                    raise_to(WARN, "reserve_not_enforced", system=m.get("vrm_system_type") or "?")
                elif m.get("ess_min_soc_pct") is not None and m["ess_min_soc_pct"] < MIN_RESERVE_PCT:
                    raise_to(WARN, "reserve_low", floor=m["ess_min_soc_pct"], recommended=MIN_RESERVE_PCT)
        elif d["kind"] == "charger" and key in yield_verdict:
            verdict, vnote, day = yield_verdict[key]
            streak = int(state.get("low_streak") or 0)
            if state.get("eval_day") != day:     # one verdict per day, however many sweeps see it
                streak = streak + 1 if verdict != OK else 0
                state["eval_day"], state["low_streak"] = day, streak
            if verdict == BAD:
                raise_to(BAD, vnote["code"], **vnote["params"])
            elif verdict == WARN:
                raise_to(BAD if streak >= 2 else WARN, vnote["code"], **vnote["params"])
        _count_bad_sweep(state, status, today)
        if d["kind"] == "charger":      # the last full production day — what the charger itself calls "yesterday"
            m = {**m, "last_kwh": m.get("yield_yesterday_kwh")}
        prior_row = prior.get(d["key"]) or {}
        rows.append({
            "device_key": key, "kind": d["kind"], "label": d["label"], "status": status, "note": note,
            "metrics": m, "state": state, "missing_sweeps": 0,
            "first_seen": prior_row.get("first_seen") or stamp, "last_seen": stamp, "updated_at": stamp,
        })

    # Devices that were there before and are not now.
    present = {d["key"] for d in parsed}
    for key, row in prior.items():
        if key in present:
            continue
        missing = int(row.get("missing_sweeps") or 0) + 1
        gone = {**row, "missing_sweeps": missing, "updated_at": stamp}
        if missing >= MISSING_SWEEPS:
            gone_state = dict(row.get("state") or {})
            _count_bad_sweep(gone_state, BAD, today)
            gone.update(status=BAD, note={"code": "missing", "params": {}}, state=gone_state)
        rows.append(gone)
    return rows


def worst(rows: list[dict]) -> str:
    level = OK
    for row in rows:
        level = _worse(level, row.get("status") or OK)
    return level


def describe_devices(strings: dict, detail: dict) -> str:
    """"Solar charger 2 made almost nothing (0.01 kWh) while the others made 3.9 kWh." for an
    equipment alert's `detail` — wording from `victron/email_i18n.py` (`alert_device_*`)."""
    def fill(template: str, values: dict) -> str:
        for key, value in values.items():
            template = template.replace("{" + key + "}", str(value))
        return template

    lines = []
    for d in detail.get("devices") or []:
        if d.get("kind") == "charger":
            name = fill(strings["alert_device_name_charger"], {"n": d.get("n")}) if (d.get("of") or 1) > 1 else strings["alert_device_name_charger_single"]
        else:
            name = strings.get(f"alert_device_name_{d.get('kind')}", str(d.get("kind") or "Device"))
        template = strings.get(f"alert_device_note_{d.get('code')}")
        if template:
            lines.append(f"{name} {fill(template, d.get('params') or {})}")
    extra = (detail.get("count") or len(lines)) - len(lines)
    text = "; ".join(lines) or "—"
    return f"{text} (+{extra})" if extra > 0 else f"{text}."

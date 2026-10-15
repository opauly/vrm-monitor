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
  inverter  a VE.Bus error                                     [inverter_error]  bad
            fewer units than ever seen                         [units_missing]   bad
            a unit's warning flags set                         [inverter_warning] warn
  any       gone from the diagnostics for 2 sweeps             [missing]        bad

Chargers on a weather day: when EVERY charger at a site is low it is cloud, not a
fault — only a charger that falls behind its siblings is flagged. A single-charger
site gets the fault checks only (whole-site underperformance is the anomaly job's).

Yield history: a charger reports "yield today", and the day only rolls over when it
wakes up, so the daily figure is the highest "today" value seen after 18:00 local
(by then the day's sun is over). "Yield yesterday" seeds an empty history.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from statistics import median

OK, WARN, BAD = "ok", "warn", "bad"
RANK = {OK: 0, WARN: 1, BAD: 2}

STALE_AFTER = timedelta(minutes=45)
MISSING_SWEEPS = 2
FINAL_HOUR = 18            # local hour from which "yield today" counts as the day's total
HISTORY_DAYS = 21
MIN_HISTORY_DAYS = 5       # own days needed before a charger is judged against itself
NO_OUTPUT_KWH = 0.1
NO_OUTPUT_PEAK_W = 50
SIBLING_MIN_KWH = 1.0      # the others must have really produced for "no output" to mean anything
LOW_RATIO = 0.3
NORMAL_RATIO = 0.7
SOC_FULL_PCT = 90          # a BMS blocks charge near full on purpose

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
                "metrics": {"units": len(serial_slots), "state": _text(rec, "S")},
            })
    totals: dict[str, int] = {}
    for d in devices:
        totals[d["kind"]] = totals.get(d["kind"], 0) + 1
    seen_so_far: dict[str, int] = {}
    for d in devices:     # "Solar charger 2 of 3" — numbered in instance order, which is stable
        seen_so_far[d["kind"]] = seen_so_far.get(d["kind"], 0) + 1
        d["metrics"]["n"], d["metrics"]["of"] = seen_so_far[d["kind"]], totals[d["kind"]]
    return devices


def _worse(a: str, b: str) -> str:
    return a if RANK[a] >= RANK[b] else b


def _iso_date(d: date) -> str:
    return d.isoformat()


def _record_yield_history(device: dict, state: dict, *, today: date, local_hour: int) -> dict[str, float]:
    daily = {k: v for k, v in (state.get("daily") or {}).items()}
    m = device["metrics"]
    seed = m.get("yield_yesterday_kwh")
    yesterday = _iso_date(today - timedelta(days=1))
    if seed is not None and yesterday not in daily and not daily:
        daily[yesterday] = seed        # an empty history starts from the charger's own "yesterday"
    if local_hour >= FINAL_HOUR and m.get("yield_today_kwh") is not None:
        key = _iso_date(today)
        daily[key] = max(daily.get(key, 0.0), m["yield_today_kwh"])
    cutoff = _iso_date(today - timedelta(days=HISTORY_DAYS))
    return {k: v for k, v in daily.items() if k >= cutoff}


def _judge_chargers(devices: list[dict], states: dict[str, dict], *, today: date, local_hour: int) -> dict[str, tuple[str, dict | None, str | None]]:
    """charger key -> (status, note, evaluated date). Only chargers that can be compared with a sibling."""
    chargers = [d for d in devices if d["kind"] == "charger" and d.get("reporting", True)]
    if len(chargers) < 2:
        return {}
    day = _iso_date(today if local_hour >= FINAL_HOUR else today - timedelta(days=1))
    values = {d["key"]: (states[d["key"]].get("daily") or {}).get(day) for d in chargers}
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
        peak = d["metrics"].get("peak_yesterday_w")
        if value < NO_OUTPUT_KWH and others and median(others) >= SIBLING_MIN_KWH and (peak is None or peak < NO_OUTPUT_PEAK_W or day == _iso_date(today)):
            out[key] = (BAD, {"code": "no_output", "params": {"kwh": round(value, 2), "others_kwh": round(median(others), 1)}}, day)
            continue
        other_ratios = [r for k, r in ratios.items() if k != key]
        if key in ratios and ratios[key] < LOW_RATIO and other_ratios and median(other_ratios) >= NORMAL_RATIO:
            out[key] = (WARN, {"code": "low_output", "params": {"kwh": round(value, 2), "pct_below": round((1 - ratios[key]) * 100)}}, day)
        else:
            out[key] = (OK, None, day)
    return out


def evaluate(parsed: list[dict], existing: list[dict], *, now: datetime, local: datetime, reference: datetime | None) -> list[dict]:
    """The rows to store for one site. `existing` are the stored rows (any order); `now` is UTC,
    `local` the same instant in the site's time zone, `reference` the newest record time in the
    diagnostics (what "this device stopped reporting" is measured against)."""
    prior = {row["device_key"]: row for row in existing}
    today, hour = local.date(), local.hour
    states: dict[str, dict] = {}
    for d in parsed:
        old = dict((prior.get(d["key"]) or {}).get("state") or {})
        d["reporting"] = d["seen"] is None or reference is None or reference - d["seen"] <= STALE_AFTER
        if d["kind"] == "charger":
            old["daily"] = _record_yield_history(d, old, today=today, local_hour=hour)
        elif d["kind"] == "battery":
            old["max_modules"] = max(int(old.get("max_modules") or 0), d["metrics"]["modules_online"] + d["metrics"]["modules_offline"])
        elif d["kind"] == "inverter":
            old["max_units"] = max(int(old.get("max_units") or 0), d["metrics"]["units"])
        states[d["key"]] = old

    yield_verdict = _judge_chargers(parsed, states, today=today, local_hour=hour)

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
        if d["kind"] == "charger":      # the last full day's yield, what the table shows
            offset = 0 if hour >= FINAL_HOUR else 1
            m = {**m, "last_kwh": state["daily"].get(_iso_date(today - timedelta(days=offset))), "last_day_offset": offset}
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
            gone.update(status=BAD, note={"code": "missing", "params": {}})
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

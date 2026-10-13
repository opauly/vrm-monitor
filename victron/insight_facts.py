"""The facts behind a site's or a fleet's daily AI summary.

Everything the summary may say is computed HERE, in plain code, from rows the
system already stores — nothing is left for a language model to work out. The
model only turns these facts into readable sentences (`victron/insight_ai.py`),
and what it writes is rejected if it contains a number that is not in them.
That is the same discipline the anomaly checks follow: deterministic findings,
narrated.

Pure functions: rows in, dicts out, no database and no clock of their own
(`now` is passed in), so every rule is tested with plain dicts
(`tests/test_insight_facts.py`).

A site's facts describe its latest complete day (the day the stored daily
figures cover) compared with the days before it, plus its state right now
(live reading, open alerts, open anomalies). `observations` is the short,
ordered list of things worth saying about it — each a code plus numbers, so the
template text, the AI and the tests all speak about the same findings.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

OFFLINE_AFTER = timedelta(minutes=45)  # same freshness the dashboard and alerts use

# Observation severities, most urgent first.
ATTENTION, GOOD, INFO = "attention", "good", "info"

_ORDER = [
    "offline", "offline_days", "alert_", "storm_ahead", "outage_deep", "tonight_short", "anomaly_", "battery_low", "solar_below",
    "tomorrow_low_solar", "import_high", "outage_held", "load_above", "no_float", "export", "solar_above", "tomorrow_high_solar",
    "load_below", "self_sufficient",
]


def _num(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _r(value, digits: int = 1):
    return None if value is None else round(float(value), digits)


def _parse_ts(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def latest_day(energy_rows: list[dict]) -> dict | None:
    """The most recent COMPLETE day's row (a partial day's totals are a fraction
    of a day, which would read as a collapse); the newest row if none is complete."""
    rows = [r for r in energy_rows if r.get("date")]
    if not rows:
        return None
    complete = [r for r in rows if r.get("complete_day") is not False]
    return max(complete or rows, key=lambda r: str(r["date"]))


def _day_figures(row: dict) -> dict:
    pv, load = _num(row.get("pv_kwh")), _num(row.get("load_kwh"))
    imp, exp = _num(row.get("grid_kwh")), _num(row.get("grid_export_kwh"))
    consumed = None if pv is None else max(pv - (exp or 0.0), 0.0)
    total_load = None if consumed is None or imp is None else consumed + imp
    return {
        "date": str(row["date"]),
        "pv_kwh": _r(pv), "load_kwh": _r(load), "grid_import_kwh": _r(imp), "grid_export_kwh": _r(exp),
        "self_sufficiency_pct": _r((1 - imp / total_load) * 100) if total_load and imp is not None else None,
        "self_consumption_pct": _r(consumed / pv * 100) if pv and consumed is not None else None,
        "min_soc_pct": _r(_num(row.get("min_soc"))), "max_soc_pct": _r(_num(row.get("max_soc"))),
        "outage_minutes": _r(_num(row.get("outage_minutes")), 0), "outage_count": int(_num(row.get("outage_count")) or 0),
        "reached_full_charge": row.get("battery_reached_float"),
    }


def _mean(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return sum(present) / len(present) if present else None


def _pct_change(now_value: float | None, baseline: float | None) -> float | None:
    if now_value is None or baseline is None or baseline <= 0:
        return None
    return round((now_value - baseline) / baseline * 100)


def build_site_facts(*, site: dict, energy_rows: list[dict], health_row: dict | None, anomalies: list[dict],
                     alerts_open: list[dict], snapshot: dict | None, now: datetime, forecast: dict | None = None) -> dict:
    """One site's facts. `energy_rows` = recent `energy_daily` rows (any order),
    `health_row` = that latest day's `daily_health` row, `anomalies`/`alerts_open`
    = this site's open `site_anomalies` / `alerts` rows, `snapshot` = its live row."""
    facts: dict = {
        "site": {"id": site["site_id"], "name": site.get("display_name") or site["site_id"],
                 "system_type": site.get("system_type"), "pv_kwp": _r(_num(site.get("pv_kwp"))),
                 "battery_kwh": _r(_num(site.get("battery_usable_kwh")))},
    }

    # ── the latest complete day, and the days before it ──────────────────
    row = latest_day(energy_rows)
    day = _day_figures(row) if row else None
    facts["day"] = day
    if row:
        before = sorted((r for r in energy_rows if str(r.get("date")) < str(row["date"]) and r.get("complete_day") is not False),
                        key=lambda r: str(r["date"]), reverse=True)[:7]
        base = {
            "days": len(before),
            "pv_kwh": _r(_mean([_num(r.get("pv_kwh")) for r in before])),
            "load_kwh": _r(_mean([_num(r.get("load_kwh")) for r in before])),
            "grid_import_kwh": _r(_mean([_num(r.get("grid_kwh")) for r in before])),
            "outage_minutes_total": _r(sum(_num(r.get("outage_minutes")) or 0 for r in before), 0),
        }
        facts["previous_days"] = base
        facts["vs_previous_pct"] = {
            "pv": _pct_change(day["pv_kwh"], base["pv_kwh"]),
            "load": _pct_change(day["load_kwh"], base["load_kwh"]),
            "grid_import": _pct_change(day["grid_import_kwh"], base["grid_import_kwh"]),
        } if base["days"] >= 3 else None
        if site.get("pv_kwp") and day["pv_kwh"] is not None and _num(site["pv_kwp"]):
            facts["day"]["yield_kwh_per_kwp"] = _r(day["pv_kwh"] / _num(site["pv_kwp"]), 2)

    if health_row:
        facts["scores"] = {"system": health_row.get("system_score"), "grid": health_row.get("grid_score"),
                           "system_reasons": [{"code": i.get("code"), "points": i.get("points")} for i in (health_row.get("system_breakdown") or []) if i.get("points")],
                           "grid_reasons": [{"code": i.get("code"), "points": i.get("points")} for i in (health_row.get("grid_breakdown") or []) if i.get("points")]}

    # ── right now ─────────────────────────────────────────────────────────
    seen = _parse_ts((snapshot or {}).get("captured_at"))
    online = seen is not None and now - seen <= OFFLINE_AFTER
    facts["live"] = {
        "online": online, "last_seen": seen.isoformat() if seen else None,
        "minutes_since_reading": None if seen is None else int((now - seen).total_seconds() // 60),
        "soc_pct": _r(_num((snapshot or {}).get("soc_pct"))) if online else None,
        "pv_w": _r(_num((snapshot or {}).get("pv_power_w")), 0) if online else None,
        "load_w": _r(_num((snapshot or {}).get("load_power_w")), 0) if online else None,
    }
    facts["forecast"] = forecast
    facts["open_alerts"] = [{"kind": a["kind"], "severity": a.get("severity"), "since": a.get("opened_at")} for a in alerts_open]
    facts["open_anomalies"] = [{"type": a.get("anomaly_type"), "since": a.get("detected_at")} for a in anomalies]

    facts["observations"] = observations(facts, system_type=site.get("system_type"))
    return facts


def observations(facts: dict, *, system_type: str | None) -> list[dict]:
    """The ordered findings worth saying. Each: {code, severity, params}."""
    out: list[dict] = []

    def add(code: str, severity: str, **params):
        out.append({"code": code, "severity": severity, "params": params})

    live = facts.get("live") or {}
    if live.get("last_seen") and not live.get("online"):
        minutes = live.get("minutes_since_reading") or 0
        if minutes >= 2 * 24 * 60:
            add("offline_days", ATTENTION, days=minutes // (24 * 60))
        else:
            add("offline", ATTENTION, minutes=minutes)
    for alert in facts.get("open_alerts") or []:
        if alert["kind"] != "site_offline":
            add(f"alert_{alert['kind']}", ATTENTION)
    for anomaly in facts.get("open_anomalies") or []:
        if anomaly.get("type"):
            add(f"anomaly_{anomaly['type']}", ATTENTION)

    ahead = facts.get("forecast") or {}
    if ahead.get("storm"):
        add("storm_ahead", ATTENTION)
    if ahead.get("backup_reaches_sunrise") is False:
        add("tonight_short", ATTENTION, hours=ahead.get("backup_hours"))
    pct = ahead.get("tomorrow_vs_typical_pct")
    if pct is not None and ahead.get("tomorrow_pv_kwh") is not None and ahead.get("typical_pv_kwh"):
        params = {"pv": ahead["tomorrow_pv_kwh"], "typical": ahead["typical_pv_kwh"], "change_pct": pct}
        if pct <= -30:
            add("tomorrow_low_solar", INFO, **params)
        elif pct >= 20 and ahead["tomorrow_pv_kwh"] >= ahead["typical_pv_kwh"] + 2:
            add("tomorrow_high_solar", GOOD, **params)

    day = facts.get("day")
    if not day:
        return _ordered(out)
    vs = facts.get("vs_previous_pct") or {}
    prev = facts.get("previous_days") or {}
    grid_system = system_type != "off_grid"

    if day["outage_minutes"]:
        low = day["min_soc_pct"] is not None and day["min_soc_pct"] < 20
        add("outage_deep" if low else "outage_held", ATTENTION if low else GOOD,
            minutes=day["outage_minutes"], count=day["outage_count"], min_soc=day["min_soc_pct"])
    elif day["min_soc_pct"] is not None and day["min_soc_pct"] < 30 and (facts["site"].get("battery_kwh") or system_type in ("off_grid", "hybrid")):
        add("battery_low", ATTENTION, min_soc=day["min_soc_pct"])

    pv, avg_pv = day["pv_kwh"], prev.get("pv_kwh")
    if pv is not None and avg_pv and avg_pv >= 1 and vs.get("pv") is not None:
        if pv < 0.7 * avg_pv:
            add("solar_below", ATTENTION, pv=pv, average=avg_pv, change_pct=vs["pv"])
        elif pv > 1.2 * avg_pv:
            add("solar_above", GOOD, pv=pv, average=avg_pv, change_pct=vs["pv"])
    load, avg_load = day["load_kwh"], prev.get("load_kwh")
    if load is not None and avg_load and avg_load >= 1 and vs.get("load") is not None:
        if load >= 1.25 * avg_load:
            add("load_above", INFO, load=load, average=avg_load, change_pct=vs["load"])
        elif load <= 0.75 * avg_load:
            add("load_below", INFO, load=load, average=avg_load, change_pct=vs["load"])

    if grid_system and day["load_kwh"] and day["grid_import_kwh"] is not None and day["load_kwh"] > 0:
        share = round(day["grid_import_kwh"] / day["load_kwh"] * 100)
        if share >= 50:
            add("import_high", ATTENTION, share_pct=share, import_kwh=day["grid_import_kwh"])
    exp, pv_total = day["grid_export_kwh"], day["pv_kwh"]
    if exp and pv_total and exp >= 0.3 * pv_total:
        add("export", GOOD, export_kwh=exp, share_pct=round(exp / pv_total * 100))
    # The open "battery not filling" anomaly already says this (and says it better).
    already_said = any(a.get("type") == "incomplete_charging" for a in facts.get("open_anomalies") or [])
    if day.get("reached_full_charge") is False and not already_said and (facts["site"].get("battery_kwh") or system_type in ("off_grid", "hybrid")):
        add("no_float", INFO)
    if day["self_sufficiency_pct"] is not None and day["self_sufficiency_pct"] >= 90:
        add("self_sufficient", GOOD, pct=day["self_sufficiency_pct"])
    return _ordered(out)


def _ordered(items: list[dict]) -> list[dict]:
    def rank(item: dict) -> int:
        for i, prefix in enumerate(_ORDER):
            if item["code"] == prefix or (prefix.endswith("_") and item["code"].startswith(prefix)):
                return i
        return len(_ORDER)
    return sorted(items, key=rank)


# ── fleet ────────────────────────────────────────────────────────────────

def build_fleet_facts(*, site_facts: list[dict], name: str, now: datetime) -> dict:
    """A fleet's facts from its sites' facts (same latest day per site; sites whose
    newest day is older than the fleet's newest are counted but not summed, so
    totals always add up one day)."""
    with_day = [f for f in site_facts if f.get("day")]
    newest = max((f["day"]["date"] for f in with_day), default=None)
    same_day = [f for f in with_day if f["day"]["date"] == newest]

    def total(key: str) -> float | None:
        values = [f["day"][key] for f in same_day if f["day"].get(key) is not None]
        return _r(sum(values)) if values else None

    online = [f for f in site_facts if f["live"]["online"]]
    # "Silent" = went quiet recently. A site dark for over a week is a standing
    # condition (its own page and alert say so), not news in a daily fleet summary.
    silent = [f for f in site_facts if f["live"]["last_seen"] and not f["live"]["online"]
              and (f["live"]["minutes_since_reading"] or 0) <= 7 * 24 * 60]
    long_silent = [f for f in site_facts if f["live"]["last_seen"] and not f["live"]["online"]
                   and (f["live"]["minutes_since_reading"] or 0) > 7 * 24 * 60]
    pv_total, load_total, imp_total, exp_total = total("pv_kwh"), total("load_kwh"), total("grid_import_kwh"), total("grid_export_kwh")
    consumed = None if pv_total is None else max(pv_total - (exp_total or 0.0), 0.0)
    all_load = None if consumed is None or imp_total is None else consumed + imp_total

    needs_attention = []
    for f in site_facts:
        severe = [o for o in f["observations"] if o["severity"] == ATTENTION and o["code"] != "offline_days"]
        if severe:
            needs_attention.append({"site": f["site"]["name"], "reasons": [o["code"] for o in severe][:3], "count": len(severe)})
    needs_attention.sort(key=lambda s: -s["count"])

    yields = sorted(((f["site"]["name"], f["day"]["yield_kwh_per_kwp"]) for f in same_day if f["day"].get("yield_kwh_per_kwp") is not None),
                    key=lambda t: t[1], reverse=True)
    scores = [f["scores"]["system"] for f in site_facts if f.get("scores") and f["scores"].get("system") is not None]

    facts = {
        "fleet": {"name": name, "sites": len(site_facts), "online": len(online), "silent": len(silent), "long_silent": len(long_silent)},
        "day": None if newest is None else {
            "date": newest, "sites_counted": len(same_day), "pv_kwh": pv_total, "load_kwh": load_total,
            "grid_import_kwh": imp_total, "grid_export_kwh": exp_total,
            "self_sufficiency_pct": _r((1 - imp_total / all_load) * 100) if all_load and imp_total is not None else None,
        },
        "needs_attention": needs_attention[:5],
        "best_yield": {"site": yields[0][0], "kwh_per_kwp": yields[0][1]} if len(yields) >= 2 else None,
        "lowest_yield": {"site": yields[-1][0], "kwh_per_kwp": yields[-1][1]} if len(yields) >= 2 else None,
        "average_system_score": _r(sum(scores) / len(scores), 0) if scores else None,
    }
    obs: list[dict] = []
    storm_sites = [f["site"]["name"] for f in site_facts if (f.get("forecast") or {}).get("storm")]
    if storm_sites:
        obs.append({"code": "fleet_storm", "severity": ATTENTION, "params": {"count": len(storm_sites), "sites": storm_sites[:4]}})
    if silent:
        obs.append({"code": "fleet_silent", "severity": ATTENTION, "params": {"count": len(silent), "sites": [f["site"]["name"] for f in silent][:4]}})
    if needs_attention:
        obs.append({"code": "fleet_attention", "severity": ATTENTION, "params": {"count": len(needs_attention)}})
    if not obs and online:
        obs.append({"code": "fleet_ok", "severity": GOOD, "params": {"online": len(online)}})
    facts["observations"] = obs
    return facts

"""One report for a whole property: its sites' report windows merged into one.

A property is a group of sites that belong together (the houses, studios and pool at one address). Its report reuses the
single-site pipeline end to end: each site's window is fetched as usual (`database/vrm_report_db.fetch_report_window`),
and `merge_windows()` folds them into ONE window of the same shape, as if the property were a single big system. Nothing in
`weekly_report.build_report_data()` needs to know the difference. What a merged window gets right, and why:

  * Energy adds up: solar, use, grid, battery in and out, export.
  * Grid events are one event, not N: the sites share a grid, so outage counts and minutes take the largest, and the list of
    outages is the union.
  * Battery levels are weighted by each battery's size, so a small battery cannot drag the property's picture around.
  * "Reached a full charge" is true only when every site with a battery got there.
  * Health is the average of the sites' scores per day (the status is the worst one's), equipment is left to the per-site
    table the report adds, because "Solar charger 2" means nothing without saying whose.

A site with no data in the window is left out of the sums (and says so in `sites`), never counted as zero.
"""
from __future__ import annotations

from datetime import date

_SUM = ("pv_kwh", "grid_kwh", "load_kwh", "battery_charge_kwh", "battery_discharge_kwh", "grid_export_kwh", "battery_kwh_snapshot",
        "pv_kwp_snapshot", "pv_yield_kwh_mppt", "pv_yield_kwh_sc0", "pv_yield_kwh_sc1", "generator_hours")
_MAX = ("outage_count", "outage_minutes", "max_grid_freq", "max_grid_v_l1", "max_grid_v_l2", "max_temperature", "max_voltage",
        "hours_covered", "ac_in_minutes", "grid_dropout_minutes")
_MIN = ("min_grid_freq", "min_grid_v_l1", "min_grid_v_l2", "min_temperature", "min_voltage")
_WEIGHTED = ("min_soc", "max_soc", "avg_soc", "avg_temperature")


def _num(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _present(values):
    return [v for v in (_num(x) for x in values) if v is not None]


def _weight(row: dict, site: dict) -> float:
    return _num(row.get("battery_kwh_snapshot")) or _num(site.get("battery_usable_kwh")) or 1.0


def merge_day(rows: list[tuple[dict, dict]]) -> dict:
    """One merged energy_daily-shaped row from the same date's rows of several sites: `[(site, row), ...]`."""
    base = dict(rows[0][1])
    for key in _SUM:
        values = _present(r.get(key) for _, r in rows)
        base[key] = round(sum(values), 3) if values else None
    for key in _MAX:
        values = _present(r.get(key) for _, r in rows)
        base[key] = max(values) if values else None
    for key in _MIN:
        values = _present(r.get(key) for _, r in rows)
        base[key] = min(values) if values else None
    for key in _WEIGHTED:
        pairs = [(_num(r.get(key)), _weight(r, s)) for s, r in rows if _num(r.get(key)) is not None]
        total = sum(w for _, w in pairs)
        base[key] = round(sum(v * w for v, w in pairs) / total, 2) if total else None
    floats = [r.get("battery_reached_float") for _, r in rows if r.get("battery_reached_float") is not None]
    base["battery_reached_float"] = all(floats) if floats else None
    base["complete_day"] = all(r.get("complete_day") is not False for _, r in rows)
    base["grid_data_available"] = any(r.get("grid_data_available") for _, r in rows)
    base["grid_meter"] = next((r.get("grid_meter") for _, r in rows if r.get("grid_meter")), None)
    return base


def _merge_days(per_site: list[tuple[dict, list[dict]]]) -> list[dict]:
    by_date: dict[str, list[tuple[dict, dict]]] = {}
    for site, rows in per_site:
        for row in rows:
            by_date.setdefault(str(row["date"]), []).append((site, row))
    return [merge_day(by_date[d]) for d in sorted(by_date)]


def _merge_health(per_site: list[list[dict]]) -> list[dict]:
    by_date: dict[str, list[dict]] = {}
    for rows in per_site:
        for row in rows:
            by_date.setdefault(str(row["date"]), []).append(row)
    out = []
    for d in sorted(by_date):
        rows = by_date[d]
        worst = min(rows, key=lambda r: _num(r.get("system_score") if r.get("system_score") is not None else r.get("health_score")) or 0)
        merged = dict(worst)
        for key in ("health_score", "system_score"):
            values = _present(r.get(key) for r in rows)
            merged[key] = round(sum(values) / len(values)) if values else None
        merged["alarms_count"] = sum(int(r.get("alarms_count") or 0) for r in rows)
        merged["outage_count"] = max((int(r.get("outage_count") or 0) for r in rows), default=0)
        merged["outage_minutes"] = max(_present(r.get("outage_minutes") for r in rows) or [0.0])
        out.append(merged)
    return out


def _merge_trend(per_site: list[tuple[dict, list[dict]]]) -> list[dict]:
    n = max((len(t) for _, t in per_site), default=0)
    out = []
    for i in range(n):
        buckets = [(s, t[i]) for s, t in per_site if i < len(t)]
        base = dict(buckets[0][1])
        for key in ("pv", "load", "grid", "discharge"):
            base[key] = round(sum(_num(b.get(key)) or 0.0 for _, b in buckets), 1)
        base["days"] = max(int(b.get("days") or 0) for _, b in buckets)
        for key in ("min_soc", "max_soc"):
            pairs = [(_num(b.get(key)), _num(s.get("battery_usable_kwh")) or 1.0) for s, b in buckets if _num(b.get(key)) is not None]
            total = sum(w for _, w in pairs)
            base[key] = round(sum(v * w for v, w in pairs) / total, 1) if total else None
        out.append(base)
    return out


def _sum_dicts(dicts: list[dict]) -> dict:
    out: dict = {}
    for d in dicts:
        for key, value in (d or {}).items():
            out[key] = out.get(key, 0) + (value or 0)
    return out


def _system_type(sites: list[dict]) -> str:
    kinds = {s.get("system_type") or "hybrid" for s in sites}
    return next(iter(kinds)) if len(kinds) == 1 else "hybrid"


def _merge_patterns(per_site: list[list[dict]]) -> list[dict]:
    by_cat: dict[str, dict] = {}
    for rows in per_site:
        for p in rows:
            cur = by_cat.setdefault(p["category"], {**p, "count": 0})
            cur["count"] += int(p.get("count") or 0)
            cur["last_at"] = max(str(cur.get("last_at") or ""), str(p.get("last_at") or ""))
    return sorted(by_cat.values(), key=lambda p: -p["count"])


def merge_windows(prop: dict, windows: list[dict]) -> dict:
    """The property's window, in the exact shape `fetch_report_window()` returns for one site.

    `prop` is `{id, name}`; `windows` are the per-site windows (sites with no day of data may be included: they only appear in
    the `sites` list the caller builds, not in the sums). Raises `ValueError` when no site has any data."""
    with_data = [w for w in windows if w["days"]]
    if not with_data:
        raise ValueError(f"No energy_daily rows for any site of property {prop.get('name')!r} in this period")
    sites = [w["site"] for w in with_data]
    first = with_data[0]
    merged_site = {
        **sites[0],
        "site_id": f"property:{prop['id']}", "display_name": prop["name"],
        "system_type": _system_type(sites),
        "pv_kwp": sum(_num(s.get("pv_kwp")) or 0.0 for s in sites) or None,
        "battery_usable_kwh": sum(_num(s.get("battery_usable_kwh")) or 0.0 for s in sites) or None,
        "exports_to_grid": any(s.get("exports_to_grid") for s in sites),
    }
    pairs = [(w["site"], w["days"]) for w in with_data]
    return {
        "schema": first["schema"], "site": merged_site,
        "period_start": first["period_start"], "period_end": first["period_end"], "is_overview": first["is_overview"],
        "days": _merge_days(pairs),
        "previous_days": _merge_days([(w["site"], w["previous_days"]) for w in with_data]),
        "trend": _merge_trend([(w["site"], w["trend"]) for w in with_data]),
        "health": _merge_health([w["health"] for w in with_data]),
        "longest_outage_minutes": max((_num(w.get("longest_outage_minutes")) or 0.0 for w in with_data), default=0.0),
        # The sites share one grid: the same outage seen by several of them is one event (same start, to the minute).
        "outage_events": sorted({str(e.get("started_at"))[:16]: e for w in with_data for e in w["outage_events"]}.values(),
                                key=lambda e: str(e.get("started_at"))),
        "low_battery_shutdown_count": (sum(int(w.get("low_battery_shutdown_count") or 0) for w in with_data)
                                       if any(w.get("low_battery_shutdown_count") is not None for w in with_data) else None),
        "alarm_episode_counts_by_category": _sum_dicts([w.get("alarm_episode_counts_by_category") for w in with_data]),
        "critical_alert_counts_by_category": _sum_dicts([w.get("critical_alert_counts_by_category") for w in with_data]),
        "devices": [],
        "alarm_patterns": _merge_patterns([w.get("alarm_patterns") or [] for w in with_data]),
        "expected_days": first["expected_days"],
        "missing_days": first["expected_days"] - len(_merge_days(pairs)),
    }


def site_summary_rows(windows: list[dict]) -> list[dict]:
    """One line per site for the report's "sites in this property" block: `{name, pv, load, grid, health, devices_bad, days}`.

    `health` is the site's average System score over the period (None without scores), `devices_bad` how many of its devices are
    flagged right now, `days` how many days of data it has in the period."""
    rows = []
    for w in windows:
        site, days = w["site"], w["days"]
        scores = _present((h.get("system_score") if h.get("system_score") is not None else h.get("health_score")) for h in w.get("health") or [])
        rows.append({
            "name": site.get("display_name") or site.get("site_id"), "days": len(days),
            "pv": round(sum(_present(d.get("pv_kwh") for d in days)), 1), "load": round(sum(_present(d.get("load_kwh") for d in days)), 1),
            "grid": round(sum(_present(d.get("grid_kwh") for d in days)), 1),
            "health": round(sum(scores) / len(scores)) if scores else None,
            "devices_bad": sum(1 for dev in w.get("devices") or [] if dev.get("status") == "bad"),
            "off_grid": site.get("system_type") == "off_grid",
        })
    return rows

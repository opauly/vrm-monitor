"""victron/insight_facts.py — the deterministic facts behind the daily summaries."""
from datetime import datetime, timedelta, timezone

from victron import insight_facts as F

NOW = datetime(2026, 10, 6, 15, 0, tzinfo=timezone.utc)
SITE = {"site_id": "s1", "display_name": "El Encino", "system_type": "hybrid", "pv_kwp": 5.0, "battery_usable_kwh": 10.0}


def day(date, pv=20.0, load=15.0, grid=3.0, export=0.0, min_soc=60.0, outage=0, **kw):
    return {"date": date, "pv_kwh": pv, "load_kwh": load, "grid_kwh": grid, "grid_export_kwh": export, "min_soc": min_soc,
            "max_soc": 100.0, "outage_minutes": outage, "outage_count": 1 if outage else 0, "complete_day": True,
            "battery_reached_float": True, **kw}


def history(**latest):
    rows = [day(f"2026-09-{28 + i:02d}" if i < 3 else f"2026-10-{i - 2:02d}") for i in range(7)]   # 09-28 .. 10-04
    rows.append(day("2026-10-05", **latest))
    return rows


def build(rows=None, snapshot=None, alerts=None, anomalies=None, site=SITE, **kw):
    snap = snapshot if snapshot is not None else {"captured_at": (NOW - timedelta(minutes=5)).isoformat(), "soc_pct": 80.0, "pv_power_w": 1200.0, "load_power_w": 600.0}
    return F.build_site_facts(site=site, energy_rows=rows if rows is not None else history(), health_row=kw.get("health"), forecast=kw.get("forecast"),
                              anomalies=anomalies or [], alerts_open=alerts or [], snapshot=snap, now=NOW)


def codes(facts):
    return [o["code"] for o in facts["observations"]]


def test_uses_the_latest_complete_day_not_a_partial_one():
    rows = history()
    rows.append(day("2026-10-06", pv=1.0, complete_day=False))
    assert build(rows)["day"]["date"] == "2026-10-05"


def test_day_figures_and_self_sufficiency_use_the_dashboards_formulas():
    f = build(history(pv=20.0, grid=3.0, export=5.0))["day"]
    # consumed on site = 20 - 5 = 15; total load = 15 + 3 = 18; 1 - 3/18 = 83.3%; self-consumption 15/20 = 75%
    assert f["self_sufficiency_pct"] == 83.3 and f["self_consumption_pct"] == 75.0 and f["yield_kwh_per_kwp"] == 4.0


def test_a_normal_day_has_nothing_to_flag():
    assert codes(build()) == []


def test_solar_well_below_the_recent_average_is_flagged_with_the_numbers():
    f = build(history(pv=8.0))
    o = next(o for o in f["observations"] if o["code"] == "solar_below")
    assert o["params"]["pv"] == 8.0 and o["params"]["average"] == 20.0 and o["params"]["change_pct"] == -60


def test_solar_above_and_usage_changes():
    assert "solar_above" in codes(build(history(pv=26.0)))
    assert "load_above" in codes(build(history(load=20.0)))
    assert "load_below" in codes(build(history(load=10.0)))


def test_needs_a_few_previous_days_before_comparing():
    f = build([day("2026-10-04"), day("2026-10-05", pv=2.0)])
    assert f["vs_previous_pct"] is None and "solar_below" not in codes(f)


def test_outage_held_versus_outage_deep():
    held = build(history(outage=95, min_soc=55.0))
    assert "outage_held" in codes(held) and held["observations"][0]["params"] == {"minutes": 95.0, "count": 1, "min_soc": 55.0}
    assert "outage_deep" in codes(build(history(outage=95, min_soc=12.0)))


def test_low_battery_without_an_outage():
    assert "battery_low" in codes(build(history(min_soc=22.0)))
    assert "battery_low" not in codes(build(history(min_soc=22.0), site={**SITE, "system_type": "grid_zero", "battery_usable_kwh": None}))


def test_mostly_on_the_grid_is_flagged_except_for_off_grid():
    assert "import_high" in codes(build(history(load=10.0, grid=6.0)))
    assert "import_high" not in codes(build(history(load=10.0, grid=6.0), site={**SITE, "system_type": "off_grid"}))


def test_export_and_self_sufficiency_are_good_news():
    f = build(history(pv=20.0, load=15.0, grid=0.5, export=8.0))
    assert {"export", "self_sufficient"} <= set(codes(f))
    assert {o["severity"] for o in f["observations"] if o["code"] in ("export", "self_sufficient")} == {"good"}


def test_offline_leads_and_hides_the_stale_live_figures():
    f = build(snapshot={"captured_at": (NOW - timedelta(hours=3)).isoformat(), "soc_pct": 40.0, "pv_power_w": 100.0})
    assert codes(f)[0] == "offline" and f["live"]["online"] is False and f["live"]["soc_pct"] is None
    assert f["observations"][0]["params"]["minutes"] == 180


def test_open_alerts_and_anomalies_come_before_the_days_figures():
    f = build(history(pv=8.0), alerts=[{"kind": "grid_outage", "severity": "warning", "opened_at": "x"}, {"kind": "site_offline", "severity": "warning", "opened_at": "x"}],
              anomalies=[{"anomaly_type": "quiet_drift", "detected_at": "x"}])
    assert codes(f)[:3] == ["alert_grid_outage", "anomaly_quiet_drift", "solar_below"]       # site_offline is covered by "offline"


def test_score_reasons_carry_the_stored_points():
    h = {"system_score": 90, "grid_score": 95, "system_breakdown": [{"code": "no_float", "points": -5}, {"code": "partial_day", "points": 0}],
         "grid_breakdown": None}
    s = build(health=h)["scores"]
    assert s["system"] == 90 and s["system_reasons"] == [{"code": "no_float", "points": -5}] and s["grid_reasons"] == []


def test_no_energy_rows_still_gives_live_facts():
    f = build(rows=[])
    assert f["day"] is None and f["live"]["online"] is True and f["observations"] == []


# ── fleet ────────────────────────────────────────────────────────────────

def site_facts(name, **kw):
    return build(site={**SITE, "site_id": name, "display_name": name}, **kw)


def test_fleet_totals_cover_one_day_and_count_silent_sites():
    a = site_facts("A", rows=history(pv=10.0, load=8.0, grid=2.0))
    b = site_facts("B", rows=history(pv=30.0, load=20.0, grid=4.0))
    c = site_facts("C", snapshot={"captured_at": (NOW - timedelta(days=1)).isoformat()})
    fleet = F.build_fleet_facts(site_facts=[a, b, c], name="All", now=NOW)
    assert fleet["fleet"] == {"name": "All", "sites": 3, "online": 2, "silent": 1, "long_silent": 0}
    assert fleet["day"]["pv_kwh"] == 10.0 + 30.0 + 20.0 and fleet["day"]["sites_counted"] == 3
    assert fleet["observations"][0]["code"] == "fleet_silent" and fleet["observations"][0]["params"]["sites"] == ["C"]


def test_fleet_attention_list_ranks_sites_by_how_many_problems():
    a = site_facts("A", rows=history(pv=2.0, min_soc=15.0, outage=60))
    b = site_facts("B")
    c = site_facts("C", rows=history(pv=2.0))
    fleet = F.build_fleet_facts(site_facts=[a, b, c], name="All", now=NOW)
    assert [s["site"] for s in fleet["needs_attention"]] == ["A", "C"]


def test_fleet_best_and_lowest_yield_and_an_all_ok_fleet():
    a = site_facts("A", rows=history(pv=10.0))
    b = site_facts("B", rows=history(pv=22.0))
    fleet = F.build_fleet_facts(site_facts=[a, b], name="All", now=NOW)
    assert fleet["best_yield"]["site"] == "B" and fleet["lowest_yield"]["site"] == "A" and fleet["observations"][0]["code"] in ("fleet_ok", "fleet_attention")
    ok = F.build_fleet_facts(site_facts=[site_facts("A"), site_facts("B")], name="All", now=NOW)
    assert ok["observations"][0]["code"] == "fleet_ok"


def test_a_site_dark_for_weeks_is_not_daily_fleet_news():
    ok = site_facts("A")
    dead = site_facts("Z", snapshot={"captured_at": (NOW - timedelta(days=40)).isoformat()})
    fleet = F.build_fleet_facts(site_facts=[ok, dead], name="All", now=NOW)
    assert fleet["fleet"]["silent"] == 0 and fleet["fleet"]["long_silent"] == 1 and fleet["observations"][0]["code"] == "fleet_ok"
    assert fleet["needs_attention"] == []                                    # its own page still says it, in days
    own = build(snapshot={"captured_at": (NOW - timedelta(days=40)).isoformat()})
    assert own["observations"][0] == {"code": "offline_days", "severity": "attention", "params": {"days": 40}}


def test_the_battery_not_filling_anomaly_replaces_the_plain_no_full_charge_note():
    rows = history()
    rows[-1]["battery_reached_float"] = False
    assert "no_float" in codes(build(rows))
    f = build(rows, anomalies=[{"anomaly_type": "incomplete_charging", "detected_at": "x"}])
    assert "no_float" not in codes(f) and "anomaly_incomplete_charging" in codes(f)


# ── forecast ─────────────────────────────────────────────────────────────

AHEAD = {"tomorrow_sky": "sunny", "tomorrow_pv_kwh": 20.0, "tomorrow_vs_typical_pct": 0, "typical_pv_kwh": 20.0, "storm": False,
         "backup_hours": 8.0, "backup_reaches_sunrise": True, "soc_at_sunrise_pct": 40.0}


def test_a_normal_forecast_adds_nothing():
    assert codes(build(forecast=AHEAD)) == []


def test_forecast_findings_are_reported_with_their_numbers():
    f = build(forecast={**AHEAD, "storm": True, "backup_reaches_sunrise": False, "backup_hours": 5.3, "tomorrow_pv_kwh": 8.0, "tomorrow_vs_typical_pct": -60})
    assert codes(f) == ["storm_ahead", "tonight_short", "tomorrow_low_solar"]
    assert f["observations"][1]["params"] == {"hours": 5.3} and f["observations"][2]["params"] == {"pv": 8.0, "typical": 20.0, "change_pct": -60}
    assert f["forecast"]["storm"] is True


def test_a_bright_day_needs_a_real_margin_to_be_news():
    assert "tomorrow_high_solar" in codes(build(forecast={**AHEAD, "tomorrow_pv_kwh": 26.0, "tomorrow_vs_typical_pct": 30}))
    assert "tomorrow_high_solar" not in codes(build(forecast={**AHEAD, "tomorrow_pv_kwh": 3.5, "typical_pv_kwh": 2.5, "tomorrow_vs_typical_pct": 40}))


def test_fleet_names_the_sites_with_a_storm_coming():
    a = site_facts("A", forecast={**AHEAD, "storm": True})
    b = site_facts("B", forecast=AHEAD)
    fleet = F.build_fleet_facts(site_facts=[a, b], name="All", now=NOW)
    assert fleet["observations"][0] == {"code": "fleet_storm", "severity": "attention", "params": {"count": 1, "sites": ["A"]}}

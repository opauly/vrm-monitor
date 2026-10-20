"""One report for a property: its sites' windows merged as if it were one big system."""
import pytest

from victron import property_report as P
from victron import report_i18n, report_svg as S

PROP = {"id": "p1", "name": "El Encino"}


def day(date, **kw):
    base = {"date": date, "pv_kwh": 10.0, "load_kwh": 8.0, "grid_kwh": 1.0, "grid_export_kwh": 0.0, "battery_charge_kwh": 4.0,
            "battery_discharge_kwh": 3.0, "min_soc": 40.0, "max_soc": 90.0, "avg_soc": 60.0, "battery_kwh_snapshot": 10.0,
            "battery_reached_float": True, "complete_day": True, "outage_count": 0, "outage_minutes": 0.0, "grid_data_available": True,
            "min_grid_freq": 60.0, "max_grid_freq": 60.3, "id": 1}
    return {**base, **kw}


def window(name, days, *, battery=10.0, devices=None, health=None, **kw):
    site = {"site_id": name.lower(), "display_name": name, "system_type": "hybrid", "pv_kwp": 5.0, "battery_usable_kwh": battery, "exports_to_grid": False}
    return {"schema": "vrm", "site": site, "period_start": "2026-10-12", "period_end": "2026-10-13", "is_overview": False, "days": days,
            "previous_days": [], "trend": [{"label": "10-12", "pv": 20.0, "load": 16.0, "grid": 2.0, "discharge": 6.0, "min_soc": 40.0, "max_soc": 90.0, "days": 2}],
            "health": health or [], "longest_outage_minutes": 0.0, "outage_events": [], "low_battery_shutdown_count": None,
            "alarm_episode_counts_by_category": {}, "critical_alert_counts_by_category": {}, "devices": devices or [], "alarm_patterns": [],
            "expected_days": 2, "missing_days": 0, **kw}


def test_energy_adds_up_and_the_property_looks_like_one_site():
    a = window("Casona", [day("2026-10-12"), day("2026-10-13")])
    b = window("Casita", [day("2026-10-12", pv_kwh=20.0, load_kwh=15.0, grid_kwh=0.0), day("2026-10-13", pv_kwh=20.0)], battery=30.0)
    m = P.merge_windows(PROP, [a, b])
    assert m["site"]["display_name"] == "El Encino" and m["site"]["site_id"] == "property:p1"
    assert m["site"]["pv_kwp"] == 10.0 and m["site"]["battery_usable_kwh"] == 40.0 and m["site"]["system_type"] == "hybrid"
    first = m["days"][0]
    assert (first["pv_kwh"], first["load_kwh"], first["grid_kwh"], first["battery_discharge_kwh"]) == (30.0, 23.0, 1.0, 6.0)
    assert [d["date"] for d in m["days"]] == ["2026-10-12", "2026-10-13"]


def test_battery_levels_weigh_by_battery_size_and_a_full_charge_needs_every_battery():
    a = window("Small", [day("2026-10-12", min_soc=20.0, battery_kwh_snapshot=10.0, battery_reached_float=True)])
    b = window("Big", [day("2026-10-12", min_soc=80.0, battery_kwh_snapshot=30.0, battery_reached_float=False)], battery=30.0)
    d = P.merge_windows(PROP, [a, b])["days"][0]
    assert d["min_soc"] == 65.0                       # (20*10 + 80*30) / 40
    assert d["battery_reached_float"] is False


def test_the_sites_share_one_grid_so_an_outage_is_one_event_and_the_longest_is_the_longest():
    event = {"started_at": "2026-10-12T14:03:10+00:00", "duration_minutes": 20.0, "sustained": True}
    a = window("A", [day("2026-10-12", outage_count=1, outage_minutes=20.0)], outage_events=[event], longest_outage_minutes=20.0)
    b = window("B", [day("2026-10-12", outage_count=1, outage_minutes=18.0)], outage_events=[{**event, "started_at": "2026-10-12T14:03:40+00:00"}], longest_outage_minutes=18.0)
    m = P.merge_windows(PROP, [a, b])
    assert m["days"][0]["outage_count"] == 1 and m["days"][0]["outage_minutes"] == 20.0
    assert len(m["outage_events"]) == 1 and m["longest_outage_minutes"] == 20.0


def test_health_is_the_average_with_the_worst_status_and_alarms_add_up():
    h = lambda score, status, alarms: [{"date": "2026-10-12", "system_score": score, "health_score": score, "system_status": status, "alarms_count": alarms}]
    a = window("A", [day("2026-10-12")], health=h(100, "Excellent", 0), alarm_episode_counts_by_category={"Overload Alarm": 1})
    b = window("B", [day("2026-10-12")], health=h(80, "Good", 2), alarm_episode_counts_by_category={"Overload Alarm": 2, "Low Battery Alarm": 1})
    m = P.merge_windows(PROP, [a, b])
    assert m["health"][0]["system_score"] == 90 and m["health"][0]["system_status"] == "Good" and m["health"][0]["alarms_count"] == 2
    assert m["alarm_episode_counts_by_category"] == {"Overload Alarm": 3, "Low Battery Alarm": 1}


def test_a_site_with_no_data_is_left_out_of_the_sums_and_a_property_with_none_raises():
    m = P.merge_windows(PROP, [window("A", [day("2026-10-12")]), window("Empty", [])])
    assert m["days"][0]["pv_kwh"] == 10.0
    with pytest.raises(ValueError):
        P.merge_windows(PROP, [window("Empty", [])])


def test_a_mixed_property_is_called_hybrid_and_an_all_off_grid_one_stays_off_grid():
    off = lambda n: {**window(n, [day("2026-10-12")]), "site": {**window(n, [])["site"], "system_type": "off_grid"}}
    assert P.merge_windows(PROP, [off("A"), off("B")])["site"]["system_type"] == "off_grid"
    assert P.merge_windows(PROP, [off("A"), window("B", [day("2026-10-12")])])["site"]["system_type"] == "hybrid"


def test_the_site_table_has_one_row_per_site_and_flags_equipment_and_empty_sites():
    health = [{"date": "2026-10-12", "system_score": 90}, {"date": "2026-10-13", "system_score": 80}]
    rows = P.site_summary_rows([window("A", [day("2026-10-12"), day("2026-10-13")], health=health, devices=[{"status": "bad"}, {"status": "ok"}]), window("Empty", [])])
    assert rows[0] == {"name": "A", "days": 2, "pv": 20.0, "load": 16.0, "grid": 2.0, "health": 85, "devices_bad": 1, "off_grid": False}
    assert rows[1]["days"] == 0 and rows[1]["health"] is None
    for lang in ("en", "es"):
        svg = S.property_sites_svg(rows, report_i18n.get(lang))
        assert "A" in svg and "85" in svg and "—" in svg and "{" not in svg
    assert S.property_sites_svg([], report_i18n.get("en")) == ""

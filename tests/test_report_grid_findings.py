"""A ~90 s grid dropout inside a 15-min average must not read as '54 Hz / 108 V', and the report must say what
actually happened: the brief interruption, the equipment fault, and 'day' vs 'days'."""
import sys
import types

import pandas as pd

from victron import report_i18n, vrm_daily, weekly_report as wr


def freq_series(values, start="2026-10-15 12:00"):
    index = pd.date_range(start, periods=len(values), freq="15min")
    return pd.Series(values, index=index, dtype=float)


def test_a_bucket_averaged_with_a_dropout_is_split_off_and_timed():
    f = freq_series([60.3, 60.3, 53.96, 60.3, 60.3])           # 53.96 = 90% of 60: ~10% of a 15-min bucket
    mask, minutes = vrm_daily.split_grid_dropouts(f)
    assert list(mask) == [False, False, True, False, False]
    assert 1.4 < minutes < 1.6


def test_a_normal_day_and_a_50hz_grid_are_left_alone():
    assert not vrm_daily.split_grid_dropouts(freq_series([60.3, 60.1, 59.9, 60.0, 60.2]))[0].any()
    mask, _ = vrm_daily.split_grid_dropouts(freq_series([50.0, 50.1, 49.9, 45.0, 50.0]))
    assert list(mask) == [False, False, False, True, False]
    assert not vrm_daily.split_grid_dropouts(freq_series([60.0, 60.0]))[0].any()      # too few samples to judge


def day(**kw):
    return {"min_grid_freq": 60.29, "max_grid_freq": 60.31, "min_grid_v_l1": 115.0, "min_grid_v_l2": 115.0, "grid_dropout_minutes": 0.0, **kw}


def test_ranges_ignore_a_dip_that_old_rows_still_carry_but_not_a_real_one():
    legacy = day(min_grid_freq=53.96, min_grid_v_l1=108.6, min_grid_v_l2=107.0, grid_dropout_minutes=None)
    rows, minutes = wr._grid_ranges_source([legacy, day()])
    assert rows[0]["min_grid_freq"] is None and rows[0]["min_grid_v_l1"] is None and rows[1]["min_grid_freq"] == 60.29
    assert 1.4 < minutes < 1.6
    already_clean = day(min_grid_v_l1=110.0, grid_dropout_minutes=1.5)          # a genuine 110 V sag with normal frequency
    rows, minutes = wr._grid_ranges_source([already_clean])
    assert rows[0]["min_grid_v_l1"] == 110.0 and minutes == 1.5


def dev(kind, status, code=None, bad=None, n=1, of=1):
    return {"kind": kind, "status": status, "note": {"code": code} if code else None, "metrics": {"n": n, "of": of}, "state": {"bad_sweeps": bad or {}}}


def test_equipment_findings_name_what_was_wrong_and_whether_it_is_fixed():
    lines = wr._equipment_findings([
        dev("battery", "ok", bad={"2026-10-15": 9}),
        dev("charger", "bad", "no_output", n=2, of=2),
        dev("inverter", "ok"),
    ], "2026-10-15", "2026-10-15")
    assert lines == ["Battery: flagged on 1 day(s) of this period; right now working again",
                     "Solar charger 2: right now a solar charger producing almost nothing while its siblings produced"]


def stats():
    return {"site": "S", "periodStart": "2026-10-15", "periodEnd": "2026-10-15", "pv": 28.5, "load": 24.1, "grid": 3.6, "gridIndependencePct": 85.1,
            "healthScore": 75, "healthStatus": "Watch", "minSoc": 38, "batteryCycles": 0.47, "daysFullCharge": 0, "totalDays": 1, "outageCount": 0,
            "outageMinutes": 0, "longestOutageMinutes": 0, "batteryProtectedDuringOutage": False, "alarmEpisodes": 1, "bestDay": "28.5", "worstDay": "28.5",
            "gridQualityScore": 100, "gridQualityStatus": "Stable", "systemType": "hybrid",
            "briefDropoutMinutes": 2, "equipment": ["Battery: flagged on 1 day(s) of this period; right now working again"]}


def test_the_ai_paragraph_is_told_about_the_brief_interruption_and_the_equipment(monkeypatch):
    seen = {}

    class Client:
        def __init__(self, api_key): pass
        class messages:
            @staticmethod
            def create(**kw):
                seen["prompt"] = kw["messages"][0]["content"]
                return types.SimpleNamespace(content=[types.SimpleNamespace(text="ok")])

    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=Client))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    wr.generate_narrative(stats(), "en")
    assert "Brief grid interruptions: about 2 minutes" in seen["prompt"] and "not as outages" in seen["prompt"]
    assert "Equipment findings" in seen["prompt"] and "Battery: flagged on 1 day(s)" in seen["prompt"]


def test_one_day_reads_as_a_singular_in_both_languages():
    for lang, one, many in (("en", "1 day (>5mm)", "2 days (>5mm)"), ("es", "1 día (>5mm)", "2 días (>5mm)")):
        t = report_i18n.get(lang)
        assert t["rainDaysOne"].format(n=1) == one and t["rainDaysMany"].format(n=2) == many
        assert t["equipmentDayOne"].format(n=1).endswith(("day", "día")) and t["equipmentDayMany"].format(n=3).endswith(("days", "días"))


def test_generator_running_time_is_the_share_of_buckets_the_ac_input_was_live():
    # an hour and a half: two full buckets, one 40%, then nothing
    v = freq_series([0, 0, 118, 118, 118, 118, 118, 118, 47, 0], start="2026-10-08 21:00")
    assert 86 < vrm_daily.ac_input_minutes(v) < 100            # ~6 full buckets (90 min) + 0.4 of one
    assert vrm_daily.ac_input_minutes(freq_series([0, 0, 0, 0])) == 0.0
    assert vrm_daily.ac_input_minutes(freq_series([5, 8, 0, 3])) == 0.0   # noise on a dead input is not a generator


def _prompt(monkeypatch, **extra):
    seen = {}

    class Client:
        def __init__(self, api_key): pass
        class messages:
            @staticmethod
            def create(**kw):
                seen["prompt"] = kw["messages"][0]["content"]
                return types.SimpleNamespace(content=[types.SimpleNamespace(text="ok")])

    monkeypatch.setitem(sys.modules, "anthropic", types.SimpleNamespace(Anthropic=Client))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    wr.generate_narrative({**stats(), **extra}, "en")
    return seen["prompt"]


def test_alarm_episodes_are_framed_as_brief_events_not_faults(monkeypatch):
    prompt = _prompt(monkeypatch, alarmEpisodes=3, alarmBreakdown="overload 3")
    assert "Alarm episodes: 3 (overload 3)" in prompt
    assert "not outages and not equipment faults" in prompt and "Never say they need a technician" in prompt
    assert "Alarm episodes: 0" in _prompt(monkeypatch, alarmEpisodes=0) and "equipment faults" not in _prompt(monkeypatch, alarmEpisodes=0)


def test_repeated_warnings_are_a_quiet_watch_item_apart_from_equipment_findings(monkeypatch):
    prompt = _prompt(monkeypatch, repeatedWarnings=["inverter overloads: 4 times in the last 14 days"])
    assert "Repeated warnings (quiet watch-items" in prompt and "did not change the health score" in prompt
    assert "inverter overloads: 4 times in the last 14 days" in prompt
    assert "inverter overloads" not in prompt.split("Repeated warnings")[0]          # not filed under the findings that lowered the score
    assert "Repeated warnings" not in _prompt(monkeypatch)


def test_the_energy_mix_counts_solar_stored_in_the_battery_once_and_draws_without_errors():
    from victron import report_i18n, report_svg as S
    t = report_i18n.get("en")
    d = {"systemType": "hybrid", "totals": {"pv": 28.4, "grid": 1.7, "charge": 9.5, "discharge": 12.3, "batteryKwhAvailable": True}}
    mix = S._energy_mix(d, t)
    assert (mix["solar_pct"], mix["batt_pct"], mix["grid_pct"]) == (57, 38, 5)
    assert [(label, round(kwh, 1)) for label, _c, _p, kwh in mix["legend"]] == [("Solar", 18.9), ("Battery", 12.3), ("Grid", 1.7)]
    assert "counts as battery" in mix["sub"]
    for draw in (lambda: S.row1_svg(d, t, []), lambda: S.energy_mix_full_svg_3way(d, t)):
        svg = draw()
        assert "57.4%" in svg and "18.9" in svg and "12.3" in svg
    # No battery energy reported: solar is everything generated, the battery slice is left out.
    d["totals"].update(batteryKwhAvailable=False, charge=0.0, discharge=0.0)
    mix = S._energy_mix(d, t)
    assert (mix["solar_pct"], mix["batt_pct"]) == (94, 0) and mix["legend"][1][2] is None and "counts as battery" not in mix["sub"]
    assert "94.4%" in S.row1_svg(d, t, [])


def test_a_property_report_tells_the_ai_it_is_one_property_with_per_site_lines(monkeypatch):
    rows = [{"name": "Casona", "pv": 80.0, "load": 60.0, "grid": 5.0, "health": 95, "devices_bad": 0, "off_grid": False},
            {"name": "Casita", "pv": 50.0, "load": 70.0, "grid": 30.0, "health": 70, "devices_bad": 1, "off_grid": False}]
    prompt = _prompt(monkeypatch, propertySites=rows)
    assert "ONE PROPERTY made of 2 sites" in prompt and "Casona: solar 80.0 kWh, use 60.0 kWh, grid 5.0 kWh, system score 95" in prompt
    assert "Casita: solar 50.0 kWh, use 70.0 kWh, grid 30.0 kWh, system score 70, 1 device(s) flagged" in prompt
    assert "ONE PROPERTY" not in _prompt(monkeypatch)

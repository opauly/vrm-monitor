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

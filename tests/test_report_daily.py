"""A one-day report must not read like a week: the narrative's frame, the single-point SoC chart, and the
"best day" / "0/1 days" leftovers."""
import sys
import types

from victron import report_i18n, weekly_report as wr


def stats(total_days):
    return {"site": "S", "periodStart": "2026-10-14", "periodEnd": "2026-10-14", "pv": 23.3, "load": 23.8, "grid": 6.3,
            "gridIndependencePct": 73.3, "healthScore": 75, "healthStatus": "Watch", "minSoc": 38, "batteryCycles": 0.47,
            "daysFullCharge": 0, "totalDays": total_days, "outageCount": 0, "outageMinutes": 0, "longestOutageMinutes": 0,
            "batteryProtectedDuringOutage": False, "alarmEpisodes": 1, "bestDay": "23.3", "worstDay": "23.3",
            "gridQualityScore": 100, "gridQualityStatus": "Stable", "systemType": "hybrid"}


def capture_prompt(monkeypatch, total_days):
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
    wr.generate_narrative(stats(total_days), "en")
    return seen["prompt"]


def test_a_single_day_is_framed_as_a_day_not_a_week(monkeypatch):
    p = capture_prompt(monkeypatch, 1)
    assert "covering a day" in p and "ONE single day" in p and "never as a week" in p
    assert "Battery reached full charge that day: no" in p
    assert "Best production day" not in p and "Days battery reached full charge" not in p


def test_a_week_keeps_its_original_frame(monkeypatch):
    p = capture_prompt(monkeypatch, 7)
    assert "covering a week" in p and "Best production day" in p and "Days battery reached full charge: 0 of 7" in p and "ONE single day" not in p


def test_a_single_day_says_whether_it_reached_full_charge_instead_of_0_of_1_days():
    d = {"t": report_i18n.get("en", 1), "isDaily": True, "dailyGrouped": [1], "totals": {"daysFullCharge": 0, "daysNoGridData": 0}}
    assert wr._full_charge_row(d)["label"] == "Battery Reached Full Charge" and wr._full_charge_row(d)["value"] == "No"
    d["totals"]["daysFullCharge"] = 1
    assert wr._full_charge_row(d)["value"] == "Yes" and wr._grid_data_rows(d) == []
    week = {"t": report_i18n.get("en", 7), "dailyGrouped": [1] * 7, "totals": {"daysFullCharge": 5, "daysNoGridData": 1}}
    assert wr._full_charge_row(week)["value"] == "5 / 7 days" and wr._grid_data_rows(week)[0]["value"] == "6 / 7"

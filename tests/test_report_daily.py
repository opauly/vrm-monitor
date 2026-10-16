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


def test_a_side_by_side_pair_of_blocks_is_drawn_at_one_height():
    import re
    from victron import report_svg as S
    short = [{"label": "a", "value": "1"}, {"label": "b", "value": "2"}]
    tall = short + [{"label": "c", "value": "3"}, {"label": "d", "value": "4"}]
    svg = S.two_block_row_svg("Left", tall, "sub", "Right", short, "sub")
    heights = {float(h) for h in re.findall(r"<rect[^>]*height='([\d.]+)'[^>]*rx='8'", svg)}
    assert len(heights) == 1, heights


def test_the_energy_mix_calls_an_off_grid_sites_ac_input_a_generator_and_leaves_room_for_the_longer_label():
    from victron import report_svg as S
    assert S._grid_source_label({"systemType": "off_grid"}, report_i18n.get("es")) == "Generador"
    assert S._grid_source_label({"systemType": "hybrid"}, report_i18n.get("es")) == "Red"
    short = [("Solar", "#0", "90", 1), ("Grid", "#1", "10", 1)]
    longer = [("Solar", "#0", "90", 1), ("Generador", "#1", "10", 1)]
    assert S._legend_value_dx(short) == 55 and S._legend_value_dx(longer) > 55


def test_generator_use_reads_as_days_hours_and_kwh_only_for_off_grid_sites_that_ran_one():
    t = report_i18n.get("en")
    d = {"t": t, "systemType": "off_grid", "totals": {"generatorDays": 2, "acInMinutes": 180, "grid": 9.64}}
    assert wr._generator_use_value(d) == "2 days · ~3.0 h · 9.6 kWh"
    d["totals"].update(generatorDays=1, acInMinutes=0, grid=4.84)
    assert wr._generator_use_value(d) == "4.8 kWh"
    d["totals"]["generatorDays"] = 0
    assert wr._generator_use_value(d) is None and wr._generator_use_value({**d, "systemType": "hybrid", "totals": {"generatorDays": 3, "acInMinutes": 0, "grid": 5}}) is None

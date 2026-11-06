"""peak_load_w on vrm.energy_daily: the highest AC load of a COMPLETE day, never taken across a monitoring gap."""
import numpy as np
import pandas as pd

from victron import vrm_daily

COLUMNS = ["pv_w", "load_w", "grid_import_w", "grid_export_w", "batt_charge_w", "batt_discharge_w", "soc_pct", "batt_v",
           "batt_temp_c", "grid_freq", "grid_v_l1", "grid_v_l2"]


def frame(load, start="2026-10-14 00:00", freq="15min"):
    index = pd.date_range(start, periods=len(load), freq=freq)
    df = pd.DataFrame({c: np.zeros(len(load)) for c in COLUMNS}, index=index)
    df["load_w"] = np.array(load, dtype=float)
    return df


def rows_for(df, max_gap_s=1800):
    return vrm_daily.to_energy_daily_rows(df, "site", max_gap_s=max_gap_s, dump_type="vrm_api")


def full_day(peak=None):
    load = np.full(96, 800.0)            # 24 h of 15-minute samples
    load[40] = peak if peak is not None else 800.0
    return load


def test_a_complete_day_reports_its_highest_load():
    (row,) = rows_for(frame(full_day(peak=3200.0)))
    assert row["complete_day"] is True and row["peak_load_w"] == 3200.0


def test_a_partial_day_has_no_peak_instead_of_a_fake_low_one():
    (row,) = rows_for(frame(np.full(40, 5000.0)))            # 10 h of data only
    assert row["complete_day"] is False and row["peak_load_w"] is None


def test_a_reading_stranded_after_a_gap_cannot_set_the_peak():
    load = full_day()
    df = frame(load)
    df = df.drop(df.index[50:70])                           # 5 h without data
    df.loc[df.index[50], "load_w"] = 9000.0                 # first sample after the gap: its interval is not integrable
    (row,) = rows_for(df)
    assert row["peak_load_w"] == 800.0


def test_all_nan_samples_are_ignored_and_an_all_nan_day_has_no_peak():
    load = full_day(peak=2500.0)
    load[10:20] = np.nan
    (row,) = rows_for(frame(load))
    assert row["peak_load_w"] == 2500.0
    (empty,) = rows_for(frame(np.full(96, np.nan)))
    assert empty["complete_day"] is True and empty["peak_load_w"] is None


def test_peak_power_matches_integrate_s_sample_rule():
    s = pd.Series([100.0, 400.0, np.nan, 900.0], index=pd.to_datetime(["2026-10-14 00:00", "2026-10-14 00:10", "2026-10-14 00:20", "2026-10-14 03:00"]))
    assert vrm_daily.peak_power(s, s.index, max_gap_s=900) == 400.0       # NaN skipped; 900 W sits after a ~2.7 h gap
    assert vrm_daily.peak_power(pd.Series([np.nan, np.nan], index=s.index[:2]), s.index[:2], max_gap_s=900) is None



def test_a_reading_after_a_long_stretch_of_empty_rows_cannot_set_the_peak():
    load = full_day()
    load[10] = 1000.0
    load[30:60] = np.nan                                   # 7.5 h of rows with no reading
    load[60] = 9000.0                                      # the first real reading afterwards
    (row,) = rows_for(frame(load))
    assert row["peak_load_w"] == 1000.0


# ── the moment of the peak, and how the report words it ─────────────────────────────────────────────────────────────
def test_the_peak_carries_the_time_it_happened():
    (row,) = rows_for(frame(full_day(peak=3200.0)))
    assert row["peak_load_at"] == "2026-10-14T10:00:00"            # sample 40 of a 15-minute day


def test_a_tie_keeps_the_earliest_sample_and_an_incomplete_day_has_no_time():
    load = full_day()
    load[10] = load[70] = 4000.0
    (row,) = rows_for(frame(load))
    assert row["peak_load_at"] == "2026-10-14T02:30:00"
    (partial,) = rows_for(frame(np.full(40, 5000.0)))
    assert partial["peak_load_at"] is None


def _report(**over):
    from victron import report_i18n
    d = {"t": report_i18n.get("en", 1), "isDaily": True, "peakLoadW": 6240.0, "peakLoadDate": "2026-10-15",
         "peakLoadAt": "2026-10-15T14:15:00", "peakLoadSlot": True}
    d.update(over)
    return d


def test_report_picks_the_highest_day_and_its_time():
    from victron.weekly_report import _peak_load
    days = [{"date": "2026-10-13", "peak_load_w": 2000, "peak_load_at": "2026-10-13T08:00:00", "dump_type": "csv_upload"},
            {"date": "2026-10-14", "peak_load_w": None},
            {"date": "2026-10-15", "peak_load_w": 6240, "peak_load_at": "2026-10-15T14:15:00", "dump_type": "vrm_api"},
            {"date": "2026-10-16", "peak_load_w": 6240, "peak_load_at": "2026-10-16T09:00:00"}]
    got = _peak_load(days)
    assert got["peakLoadW"] == 6240.0 and got["peakLoadDate"] == "2026-10-15" and got["peakLoadAt"].endswith("14:15:00")
    assert got["peakLoadSlot"] is True
    assert _peak_load([{"date": "2026-10-14", "peak_load_w": None}])["peakLoadW"] is None


def test_one_day_report_shows_just_the_time_and_a_week_shows_day_date_and_time():
    from victron.weekly_report import _peak_load_row
    day = _peak_load_row(_report())
    assert day == [{"label": "Peak load", "value": "6.2 kW · 14:15–14:30"}]
    week = _peak_load_row(_report(isDaily=False))
    assert week[0]["value"] == "6.2 kW · Thu 15/10, 14:15–14:30"


def test_report_degrades_cleanly_without_time_or_data():
    from victron.weekly_report import _peak_load_row
    no_time = _peak_load_row(_report(isDaily=False, peakLoadAt=None))
    assert no_time == [{"label": "Peak load", "value": "6.2 kW · Thu 15/10"}]
    assert _peak_load_row(_report(peakLoadW=None)) == []
    assert _peak_load_row(_report(peakLoadW=850.0))[0]["value"] == "850 W · 14:15–14:30"
    assert _peak_load_row(_report(peakLoadSlot=False))[0]["value"] == "6.2 kW · 14:15"          # a CSV reading, not a slot
    assert _peak_load_row(_report(peakLoadAt="2026-10-15T23:45:00"))[0]["value"] == "6.2 kW · 23:45–00:00"

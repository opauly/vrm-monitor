"""The stored 15-minute copy: victron/vrm_samples.py, victron/weather_store.py, vrm_api/samples_service.py."""
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from victron import samples_store, vrm_samples, weather_store
from victron.vrm_samples import build_frame, to_rows
from vrm_api import samples_service


def ser(values, start="2026-11-05 12:00", step_min=15):
    idx = pd.date_range(start, periods=len(values), freq=f"{step_min}min")
    return pd.Series(values, index=idx, dtype=float)


# ── building the frame ───────────────────────────────────────────────────────

def test_a_slot_is_one_row_with_every_reading_and_the_load_is_l1_plus_l2():
    raw = {"a1": ser([200, 210]), "a2": ser([100, 90]), "bp": ser([-50, 30]), "SOC": ser([99, 100]),
           "g1": ser([150, 0]), "g2": ser([60, 0]), "IV1": ser([119, 120]), "S": ser([9, 9]),
           "V": ser([55.1, 55.2]), "BT": ser([23.4, 23.5])}
    f = build_frame(raw, ser([0, 800]), ("g1", "g2", "g3"))
    assert list(f.index) == [pd.Timestamp("2026-11-05 12:00"), pd.Timestamp("2026-11-05 12:15")]
    first = f.iloc[0]
    assert (first.pv_w, first.load_w, first.battery_w, first.soc_pct, first.grid_w) == (0, 300, -50, 99, 210)
    assert (first.ac_in_v, first.inverter_state, first.batt_v, first.batt_temp_c) == (119, 9, 55.1, 23.4)
    assert f.iloc[1].pv_w == 800 and not f.gap.any()


def test_a_signal_the_site_does_not_publish_is_null_not_zero():
    f = build_frame({"a1": ser([200]), "SOC": ser([80])}, pd.Series(dtype=float), ())
    r = f.iloc[0]
    assert r.load_w == 200 and r.soc_pct == 80
    assert np.isnan(r.pv_w) and np.isnan(r.grid_w) and np.isnan(r.batt_temp_c) and pd.isna(r.generator_on)


def test_a_missing_slot_in_the_middle_is_kept_as_a_gap_row():
    s = ser([100, 120, 140]).drop(pd.Timestamp("2026-11-05 12:15"))
    f = build_frame({"a1": s, "SOC": s}, pd.Series(dtype=float), ())
    assert len(f) == 3
    hole = f.loc[pd.Timestamp("2026-11-05 12:15")]
    assert bool(hole.gap) and np.isnan(hole.load_w) and np.isnan(hole.soc_pct)
    assert f.gap.sum() == 1


def test_victron_timestamps_off_the_quarter_hour_land_on_the_slot():
    s = ser([100, 110], start="2026-11-05 12:00:05")
    f = build_frame({"a1": s}, pd.Series(dtype=float), ())
    assert list(f.index) == [pd.Timestamp("2026-11-05 12:00"), pd.Timestamp("2026-11-05 12:15")]


def test_ac_input_voltage_falls_back_to_l2_when_l1_is_not_published():
    f = build_frame({"a1": ser([1]), "IV2": ser([121.0])}, pd.Series(dtype=float), ())
    assert f.iloc[0].ac_in_v == 121.0


def test_generator_is_on_when_its_runtime_counter_moved_and_unknown_when_it_cannot_be_told():
    gt = ser([1000, 1000, 1900, 3600, 100])          # idle, idle, ran, ran, counter reset
    f = build_frame({"a1": ser([1] * 5), "Gt": gt}, pd.Series(dtype=float), ())
    assert [None if pd.isna(v) else bool(v) for v in f.generator_on] == [None, False, True, True, None]


# ── rows ─────────────────────────────────────────────────────────────────────

def test_rows_carry_utc_timestamps_and_none_for_missing_values():
    f = build_frame({"a1": ser([200.04]), "SOC": ser([80.0])}, pd.Series(dtype=float), ())
    row = to_rows("site-a", f)[0]
    assert row["site_id"] == "site-a" and row["ts"] == "2026-11-05T12:00:00+00:00"
    assert row["load_w"] == 200.0 and row["soc_pct"] == 80.0
    assert row["pv_w"] is None and row["generator_on"] is None and row["gap"] is False


def test_the_window_is_the_sites_own_local_days():
    start, end = vrm_samples.window_epochs("2026-11-05", "2026-11-05", "America/Costa_Rica")
    assert end - start == 86400
    assert datetime.fromtimestamp(start, tz=timezone.utc) == datetime(2026, 11, 5, 6, 0, tzinfo=timezone.utc)   # CR = UTC-6


# ── fetching ─────────────────────────────────────────────────────────────────

class Client:
    def __init__(self, codes):
        self.codes = codes
    def get_diagnostics(self, id_site):
        return {"records": [{"code": c} for c in self.codes]}
    def get_stats(self, id_site, **kw):
        self.kw = kw
        base = int(kw["start"]) * 1000
        return {"records": {c: [[base + 900_000 * i, 10.0 + i] for i in range(3)] for c in kw["attribute_codes"]}}


def test_the_request_starts_on_a_quarter_hour_and_asks_only_for_codes_the_site_has(monkeypatch):
    monkeypatch.setattr(vrm_samples, "fetch_pv_power_series", lambda *a, **k: pd.Series(dtype=float))
    client = Client({"a1", "a2", "SOC", "IP1", "IP2", "S"})
    frame = vrm_samples.fetch_samples(client, 1, 1_000_000_065, 1_000_003_000)      # 65 s past a quarter hour
    assert client.kw["start"] % 900 == 0
    assert set(client.kw["attribute_codes"]) == {"a1", "a2", "SOC", "IP1", "IP2", "S"}
    assert len(frame) == 3 and frame.iloc[0].grid_w == 20.0        # no meter: the inverter's own AC input (IP1+IP2)


def test_an_installation_with_no_diagnostics_gives_an_empty_frame():
    assert vrm_samples.fetch_samples(Client(set()), 1, 0, 900).empty


# ── the chart reads the copy ─────────────────────────────────────────────────

def stored(times_utc, load):
    idx = pd.DatetimeIndex([f"2026-11-05 {t}" for t in times_utc])
    cols = {c: np.nan for c in vrm_samples.READINGS}
    return pd.DataFrame({**cols, "load_w": load, "generator_on": None, "gap": False}, index=idx)


def test_the_shape_reads_hours_in_the_sites_own_time():
    from victron.vrm_shape import shape_from_frame
    shape = shape_from_frame(stored(["18:00", "18:15", "18:30"], [500.0, 800.0, 600.0]), "today", "America/Costa_Rica")    # 18:00 UTC = 12:00 in Costa Rica
    assert shape["load"][12] == 633.3 and shape["peak_load_w"] == 800.0
    assert shape["peak_load_at"] == "2026-11-05T12:15:00"
    assert shape["grid"] == [None] * 24 and shape["solar"] == [None] * 24


NOW = datetime(2026, 11, 5, 20, 0, tzinfo=timezone.utc)
SITE = {"site_id": "s1", "vrm_installation_id": 7, "timezone": "America/Costa_Rica"}


def test_a_chart_is_served_from_the_copy_and_topped_up_when_it_is_behind(monkeypatch):
    fetched = []
    monkeypatch.setattr(samples_service, "_TAIL_TRIED", {})
    monkeypatch.setattr(samples_service, "_HEAD_TRIED", {})
    monkeypatch.setattr(samples_store, "coverage", lambda *a: (datetime(2026, 11, 5, 6, tzinfo=timezone.utc), datetime(2026, 11, 5, 18, tzinfo=timezone.utc)))
    monkeypatch.setattr(samples_service, "fetch_and_store", lambda client, site, s, e: fetched.append((s, e)) or 4)
    monkeypatch.setattr(samples_store, "load_samples", lambda *a: stored(["18:00", "18:15", "18:30"], [500.0, 800.0, 600.0]))
    shape = samples_service.site_shape(object(), SITE, "today", now=NOW)
    assert shape["load"][12] == 633.3
    assert len(fetched) == 1 and fetched[0][0] < int(datetime(2026, 11, 5, 18, tzinfo=timezone.utc).timestamp())


def test_a_fresh_copy_is_not_topped_up(monkeypatch):
    monkeypatch.setattr(samples_service, "_TAIL_TRIED", {})
    monkeypatch.setattr(samples_store, "coverage", lambda *a: (datetime(2026, 11, 5, 6, tzinfo=timezone.utc), datetime(2026, 11, 5, 19, 50, tzinfo=timezone.utc)))
    monkeypatch.setattr(samples_service, "fetch_and_store", lambda *a: pytest.fail("fetched although the copy is fresh"))
    monkeypatch.setattr(samples_store, "load_samples", lambda *a: stored(["18:00", "18:15", "18:30"], [500.0, 800.0, 600.0]))
    assert samples_service.site_shape(object(), SITE, "today", now=NOW)["load"][12] == 633.3


def test_without_the_tables_the_chart_is_read_live_as_before(monkeypatch):
    def boom(*a, **k):
        raise samples_store.SamplesUnavailable("run migration 056")
    monkeypatch.setattr(samples_store, "coverage", boom)
    monkeypatch.setattr(samples_store, "load_samples", boom)
    monkeypatch.setattr(samples_service, "fetch_site_shape", lambda client, id_site, **kw: {"live": True, "range": kw["range_key"]})
    assert samples_service.site_shape(object(), SITE, "week", now=NOW) == {"live": True, "range": "week"}


def test_a_failed_top_up_still_serves_what_is_stored(monkeypatch):
    monkeypatch.setattr(samples_service, "_TAIL_TRIED", {})
    monkeypatch.setattr(samples_store, "coverage", lambda *a: (datetime(2026, 11, 5, 6, tzinfo=timezone.utc), datetime(2026, 11, 5, 12, tzinfo=timezone.utc)))
    def down(*a, **k):
        raise RuntimeError("Victron unreachable")
    monkeypatch.setattr(samples_service, "fetch_and_store", down)
    monkeypatch.setattr(samples_store, "load_samples", lambda *a: stored(["18:00", "18:15", "18:30"], [500.0, 800.0, 600.0]))
    assert samples_service.site_shape(object(), SITE, "today", now=NOW)["load"][12] == 633.3


def test_the_sync_never_fails_because_of_the_copy(monkeypatch):
    def down(*a, **k):
        raise RuntimeError("boom")
    monkeypatch.setattr(samples_service, "fetch_and_store", down)
    assert samples_service.sync_window(object(), SITE, "2026-11-04", "2026-11-04") == 0


# ── weather ──────────────────────────────────────────────────────────────────

def test_every_hour_is_stored_with_its_refresh_time_and_empty_hours_are_dropped():
    weather = {"hourly": [
        {"time": "2026-11-05T10:00", "ghi": 600.0, "cloud": 20, "temp": 24.5, "rain_mm": 0.0, "sunshine_s": 3600, "rain_prob": None, "code": 1},
        {"time": "2026-11-05T11:00", "ghi": None, "cloud": None, "temp": None, "rain_mm": None},
        {"time": "2026-11-05T13:00", "ghi": 650.0, "cloud": 30, "temp": 27.0, "rain_mm": 0.0, "sunshine_s": 1800, "rain_prob": 40, "code": 95},   # a forecast hour
    ]}
    now = datetime(2026, 11, 5, 12, 40, tzinfo=timezone.utc)
    rows = weather_store.hourly_rows(weather, 9.93, -84.08, now=now)
    assert [r["ts"] for r in rows] == ["2026-11-05T10:00:00+00:00", "2026-11-05T13:00:00+00:00"]
    assert rows[0] == {"lat": 9.93, "lon": -84.08, "ts": "2026-11-05T10:00:00+00:00", "ghi_wm2": 600.0, "cloud_pct": 20, "temp_c": 24.5,
                       "rain_mm": 0.0, "sunshine_s": 3600, "rain_prob_pct": None, "weather_code": 1, "fetched_at": "2026-11-05T12:40:00+00:00"}
    assert rows[1]["rain_prob_pct"] == 40 and rows[1]["weather_code"] == 95      # ts after fetched_at = a forecast


def test_sunrise_and_sunset_are_stored_per_day():
    rows = weather_store.daily_rows({"daily": [{"date": "2026-11-05", "sunrise": "2026-11-05T11:20", "sunset": "2026-11-05T23:10"}]}, 9.93, -84.08,
                                    now=datetime(2026, 11, 5, 12, tzinfo=timezone.utc))
    assert rows == [{"lat": 9.93, "lon": -84.08, "date": "2026-11-05", "sunrise": "2026-11-05T11:20:00+00:00", "sunset": "2026-11-05T23:10:00+00:00",
                     "fetched_at": "2026-11-05T12:00:00+00:00"}]


def test_sites_at_the_same_place_cost_one_weather_request(monkeypatch):
    calls = []
    monkeypatch.setattr(weather_store, "_LAST_REFRESH", {})
    monkeypatch.setattr(weather_store.open_meteo, "fetch_weather", lambda lat, lon, tz, **kw: calls.append((lat, lon, tz)) or {"hourly": []})
    weather_store.refresh_sites([{"latitude": 9.9301, "longitude": -84.0801}, {"latitude": 9.9299, "longitude": -84.0799}, {"latitude": None, "longitude": None}])
    assert calls == [(9.93, -84.08, "UTC")]


# ── the daily peak comes from the stored readings ────────────────────────────

def test_each_local_days_peak_is_its_highest_slot_in_the_sites_own_time():
    idx = pd.date_range("2026-11-05 04:00", periods=4, freq="15min")                 # 22:00-22:45 on 4 Nov, Costa Rica
    idx = idx.append(pd.date_range("2026-11-05 06:00", periods=3, freq="15min"))    # 00:00-00:30 on 5 Nov
    frame = pd.DataFrame({"load_w": [300, 900, 500, 400, 200, 1500, 700]}, index=idx)
    assert samples_service.daily_peaks(frame, "America/Costa_Rica") == {
        "2026-11-04": (900.0, "2026-11-04T22:15:00"), "2026-11-05": (1500.0, "2026-11-05T00:15:00")}


def test_a_day_without_a_load_reading_has_no_peak():
    frame = pd.DataFrame({"load_w": [np.nan, np.nan]}, index=pd.date_range("2026-11-05 12:00", periods=2, freq="15min"))
    assert samples_service.daily_peaks(frame, "America/Costa_Rica") == {}


def test_the_sync_sets_the_peak_on_the_daily_rows_and_survives_a_failure(monkeypatch):
    frame = pd.DataFrame({"load_w": [500, 900, 600]}, index=pd.date_range("2026-11-05 15:00", periods=3, freq="15min"))
    monkeypatch.setattr(samples_service, "fetch_and_store", lambda *a: frame)
    written = []
    monkeypatch.setattr(samples_store, "set_daily_peak", lambda site_id, day, w, at: written.append((site_id, day, w, at)))
    assert samples_service.sync_window(object(), SITE, "2026-11-05", "2026-11-05") == 3
    assert written == [("s1", "2026-11-05", 900.0, "2026-11-05T09:15:00")]


# ── the forecast reads the stored weather ────────────────────────────────────

HOURS = [
    {"ts": "2026-11-05T17:00:00+00:00", "ghi_wm2": 500.0, "cloud_pct": 40, "temp_c": 25.0, "rain_mm": 0.0, "sunshine_s": 3000, "rain_prob_pct": 10, "weather_code": 3},
    {"ts": "2026-11-05T18:00:00+00:00", "ghi_wm2": 600.0, "cloud_pct": 20, "temp_c": 26.0, "rain_mm": 2.0, "sunshine_s": 3600, "rain_prob_pct": None, "weather_code": 95},
]
FORECAST_NOW = datetime(2026, 11, 5, 18, 30, tzinfo=timezone.utc)


def test_the_forecast_gets_local_hours_and_sunrise_from_the_copy_without_calling_open_meteo(monkeypatch):
    monkeypatch.setattr(samples_store, "weather_fetched_at", lambda *a: FORECAST_NOW - timedelta(minutes=10))
    monkeypatch.setattr(samples_store, "load_weather", lambda *a: HOURS)
    monkeypatch.setattr(samples_store, "load_weather_days", lambda *a: [{"date": "2026-11-06", "sunrise": "2026-11-06T11:30:00+00:00", "sunset": "2026-11-06T23:15:00+00:00"}])
    monkeypatch.setattr(weather_store.open_meteo, "fetch_weather", lambda *a, **k: pytest.fail("asked Open-Meteo although the copy is fresh"))
    w = weather_store.forecast_weather(9.93, -84.08, "America/Costa_Rica", FORECAST_NOW)
    assert w["hourly"][0] == {"time": "2026-11-05T11:00", "ghi": 500.0, "cloud": 40, "temp": 25.0, "rain_prob": 10, "rain_mm": 0.0, "code": 3}
    assert w["hourly"][1]["code"] == 95 and w["hourly"][1]["rain_prob"] is None
    assert w["daily"] == [{"date": "2026-11-06", "sunrise": "2026-11-06T05:30", "sunset": "2026-11-06T17:15"}]


def test_a_copy_over_an_hour_old_is_refreshed_first(monkeypatch):
    refreshed = []
    monkeypatch.setattr(samples_store, "weather_fetched_at", lambda *a: FORECAST_NOW - timedelta(hours=2))
    monkeypatch.setattr(weather_store, "refresh_place", lambda lat, lon, **kw: refreshed.append((lat, lon, kw["past_days"], kw["forecast_days"])) or 5)
    monkeypatch.setattr(samples_store, "load_weather", lambda *a: HOURS)
    monkeypatch.setattr(samples_store, "load_weather_days", lambda *a: [])
    weather_store.forecast_weather(9.93, -84.08, "America/Costa_Rica", FORECAST_NOW)
    assert refreshed == [(9.93, -84.08, 14, 3)]


def test_with_nothing_stored_and_nothing_fetched_there_is_no_weather(monkeypatch):
    monkeypatch.setattr(samples_store, "weather_fetched_at", lambda *a: None)
    monkeypatch.setattr(weather_store, "refresh_place", lambda *a, **k: 0)
    monkeypatch.setattr(samples_store, "load_weather", lambda *a: [])
    assert weather_store.forecast_weather(9.93, -84.08, "America/Costa_Rica", FORECAST_NOW) is None


def test_the_forecast_asks_open_meteo_directly_when_the_tables_cannot_be_used(monkeypatch):
    from vrm_api import forecast_service as svc
    def boom(*a, **k):
        raise samples_store.SamplesUnavailable("run migration 057")
    monkeypatch.setattr(samples_store, "weather_fetched_at", boom)
    monkeypatch.setattr(svc, "_WEATHER", {})
    monkeypatch.setattr(svc.open_meteo, "fetch_weather", lambda lat, lon, tz, **k: {"hourly": [], "daily": [], "live": True})
    assert svc._weather_for({"latitude": 9.93, "longitude": -84.08}, "America/Costa_Rica", FORECAST_NOW)["live"] is True


# ── the report reads the stored weather ──────────────────────────────────────

def day_hours(day, ghi, cloud, rain_per_hour, sun_s):
    return [{"ts": f"{day}T{h:02d}:00:00+00:00", "ghi_wm2": ghi if 12 <= h < 24 else 0.0, "cloud_pct": cloud, "temp_c": 25.0,
             "rain_mm": rain_per_hour, "sunshine_s": sun_s if 12 <= h < 24 else 0, "rain_prob_pct": None, "weather_code": 1} for h in range(24)]


def test_the_report_figures_match_what_the_archive_service_gave():
    # Costa Rica = UTC-6: the local day 4 Nov runs 06:00 UTC on the 4th to 06:00 UTC on the 5th.
    hours = [h for h in day_hours("2026-11-04", 500.0, 30, 0.0, 3000) + day_hours("2026-11-05", 400.0, 50, 0.5, 2000)
             if "2026-11-04T06" <= h["ts"][:13] < "2026-11-06T06"]
    zone = weather_store._zone("America/Costa_Rica")
    out = weather_store.summarise(hours, zone, 2)
    assert out == {
        "totalIrradianceKwh": 10.8,     # (500 + 400 W/m2) x 12 sunny hours
        "avgSunshineHrs": 8.3,          # (12 x 3000 s + 12 x 2000 s) over 2 days
        "avgCloudPct": 42,              # local 4 Nov averages 35 (its last 6 hours belong to the 5th UTC), local 5 Nov 50
        "rainyDays": 1,                 # only local 5 Nov exceeds 5 mm: 9 mm in its 18 hours
    }


def test_the_report_uses_the_copy_and_only_asks_for_more_when_the_period_is_not_in_it(monkeypatch):
    now = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)
    hours = [{"ts": (datetime(2026, 11, 3, 6, tzinfo=timezone.utc) + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00:00+00:00"), "ghi_wm2": 300.0,
              "cloud_pct": 30, "temp_c": 25.0, "rain_mm": 0.0, "sunshine_s": 1800, "rain_prob_pct": None, "weather_code": 1} for i in range(24 * 7)]
    monkeypatch.setattr(samples_store, "load_weather", lambda *a: hours)
    monkeypatch.setattr(weather_store, "refresh_place", lambda *a, **k: pytest.fail("refreshed although the copy holds the period"))
    out = weather_store.period_summary(9.93, -84.08, "2026-11-03", "2026-11-09", "America/Costa_Rica", now=now)
    assert out["totalIrradianceKwh"] == round(300.0 * 24 * 7 / 1000, 1) and out["avgCloudPct"] == 30 and out["avgSunshineHrs"] == 12.0

    refreshed = []
    monkeypatch.setattr(samples_store, "load_weather", lambda *a: [])
    monkeypatch.setattr(weather_store, "refresh_place", lambda *a, **k: refreshed.append(k) or 0)
    assert weather_store.period_summary(9.93, -84.08, "2026-11-03", "2026-11-09", "America/Costa_Rica", now=now) is None
    assert refreshed and refreshed[0]["force"] is True


def test_a_period_beyond_open_meteos_recent_history_goes_to_the_archive_service(monkeypatch):
    monkeypatch.setattr(samples_store, "load_weather", lambda *a: [])
    monkeypatch.setattr(weather_store, "refresh_place", lambda *a, **k: pytest.fail("cannot refresh a period this old"))
    old = datetime(2027, 6, 1, tzinfo=timezone.utc)
    assert weather_store.period_summary(9.93, -84.08, "2026-11-03", "2026-11-09", "America/Costa_Rica", now=old) is None


def test_the_report_falls_back_to_the_archive_service_when_the_copy_cannot_answer(monkeypatch):
    from victron import weekly_report as W
    monkeypatch.setattr(weather_store, "period_summary", lambda *a, **k: None)
    assert W._stored_weather(9.93, -84.08, "2026-11-03", "2026-11-09", "America/Costa_Rica") is None
    def boom(*a, **k):
        raise samples_store.SamplesUnavailable("run migration 057")
    monkeypatch.setattr(weather_store, "period_summary", boom)
    assert W._stored_weather(9.93, -84.08, "2026-11-03", "2026-11-09", "America/Costa_Rica") is None


# ── the sweep keeps the copy fresh; pages read it ────────────────────────────

def test_the_sweep_stores_from_a_little_before_the_newest_stored_slot(monkeypatch):
    seen = {}
    last = datetime(2026, 11, 5, 19, 45, tzinfo=timezone.utc)
    monkeypatch.setattr(samples_store, "coverage", lambda *a: (last - timedelta(hours=5), last))
    def fetch(client, id_site, start, end, diagnostics=None):
        seen.update(start=start, end=end, diagnostics=diagnostics)
        return build_frame({"a1": ser([100.0])}, pd.Series(dtype=float), ())
    monkeypatch.setattr(samples_service.vrm_samples, "fetch_samples", fetch)
    stored_rows = []
    monkeypatch.setattr(samples_store, "store_samples", lambda rows: stored_rows.extend(rows) or len(rows))
    diag = {"records": [{"code": "a1"}]}
    assert samples_service.keep_fresh(object(), SITE, diag, now=NOW) == 1
    assert seen["start"] == int(last.timestamp()) - 3600 and seen["end"] == int(NOW.timestamp()) and seen["diagnostics"] is diag   # no second diagnostics call


def test_a_site_with_nothing_recent_stored_starts_six_hours_back(monkeypatch):
    seen = {}
    monkeypatch.setattr(samples_store, "coverage", lambda *a: None)
    monkeypatch.setattr(samples_service.vrm_samples, "fetch_samples", lambda c, i, start, end, diagnostics=None: seen.update(start=start) or build_frame({}, pd.Series(dtype=float), ()))
    samples_service.keep_fresh(object(), SITE, None, now=NOW)
    assert seen["start"] == int((NOW - timedelta(hours=6)).timestamp())


def test_without_a_vrm_token_the_chart_serves_what_is_stored_and_never_calls_victron(monkeypatch):
    monkeypatch.setattr(samples_store, "coverage", lambda *a: pytest.fail("no client, so no top-up check"))
    monkeypatch.setattr(samples_store, "load_samples", lambda *a: stored(["18:00", "18:15", "18:30"], [500.0, 800.0, 600.0]))
    monkeypatch.setattr(samples_service, "fetch_site_shape", lambda *a, **k: pytest.fail("called Victron without a client"))
    assert samples_service.site_shape(None, SITE, "today", now=NOW)["peak_load_w"] == 800.0


def test_without_a_token_and_nothing_stored_the_shape_is_empty_not_live(monkeypatch):
    monkeypatch.setattr(samples_store, "load_samples", lambda *a: stored([], []))
    monkeypatch.setattr(samples_service, "fetch_site_shape", lambda *a, **k: pytest.fail("called Victron without a client"))
    shape = samples_service.site_shape(None, SITE, "today", now=NOW)
    assert shape["load"] == [None] * 24 and shape["peak_load_w"] is None


def test_the_forecasts_usual_load_comes_from_the_stored_copy(monkeypatch):
    from vrm_api import forecast_service as svc
    monkeypatch.setattr(svc, "_vrm_client", lambda site: None)           # no VRM token at all
    monkeypatch.setattr(samples_store, "load_samples", lambda *a: stored(["18:00", "18:15", "18:30"], [500.0, 800.0, 600.0]))
    profile = svc.usual_load_profile({"site_id": "s1", "vrm_installation_id": 7, "timezone": "America/Costa_Rica"})
    assert profile is not None and len(profile) == 24 and profile[12] == 633.3


def test_one_sites_failure_does_not_stop_the_sweeps_storing_step(monkeypatch):
    from vrm_api.routers import vrm_fleet as F
    monkeypatch.setattr(F.secrets, "read_customer_vrm_token", lambda cid: "token")
    calls = []
    def keep(client, site, diagnostics=None):
        calls.append(site["site_id"])
        if site["site_id"] == "bad":
            raise RuntimeError("Victron down")
    monkeypatch.setattr(F.samples_service, "keep_fresh", keep)
    sites = [{"site_id": "bad", "customer_id": "c", "vrm_installation_id": 1}, {"site_id": "good", "customer_id": "c", "vrm_installation_id": 2},
             {"site_id": "no-install", "customer_id": "c", "vrm_installation_id": None}]
    F._keep_samples_fresh(sites, None, {})
    assert sorted(calls) == ["bad", "good"]

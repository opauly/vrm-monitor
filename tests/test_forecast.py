"""victron/forecast.py — the tonight / tomorrow model, on synthetic weather."""
import math
from datetime import datetime, timedelta

from victron import forecast as F

NOW = datetime(2026, 10, 8, 19, 0)            # local naive, 7 pm
FIRST_DAY = datetime(2026, 9, 26)


def bell(hour, peak):
    """Sunlight in W/m² for an hour of the day (sun up 6-17)."""
    return 0.0 if hour < 6 or hour > 17 else peak * math.sin(math.pi * (hour - 5.5) / 12.0) ** 2


def weather(peaks: dict[str, float] | None = None, default_peak=900.0, storm_on=None, days=17, cloud=15, storm_hour=15):
    """Hourly rows for `days` days from 2026-09-26; `peaks` overrides a date's peak sunlight;
    `storm_on` puts a thunderstorm code at `storm_hour` of that date."""
    peaks = peaks or {}
    rows, daily = [], []
    for d in range(days):
        day = FIRST_DAY + timedelta(days=d)
        date = day.date().isoformat()
        daily.append({"date": date, "sunrise": f"{date}T05:25", "sunset": f"{date}T17:22"})
        for h in range(24):
            rows.append({"time": f"{date}T{h:02d}:00", "ghi": bell(h, peaks.get(date, default_peak)), "cloud": cloud, "temp": 24.0 + (6 if 10 <= h <= 15 else 0),
                         "rain_prob": 10, "rain_mm": 0.0, "code": 95 if storm_on == date and h == storm_hour else 1})
    return {"hourly": rows, "daily": daily}


def history(w, k=4.0, upto="2026-10-07"):
    """Daily PV the site 'made' = k x that day's sunlight."""
    dw = F.daily_weather(w)
    return [{"date": d, "pv_kwh": round(k * v["ghi_kwh_m2"], 2)} for d, v in sorted(dw.items()) if d <= upto and v["ghi_kwh_m2"]]


def run(w=None, soc=80.0, battery=10.0, load=500.0, **kw):
    w = w or weather()
    return F.build_forecast(weather=w, now=NOW, pv_history=history(w), load_profile_w=[load] * 24, soc_pct=soc, battery_kwh=battery,
                            pv_kwp=5.0, system_type="hybrid", **kw)


# ── weather by day ───────────────────────────────────────────────────────────

def test_daily_totals_use_only_full_days_and_flag_storms():
    w = weather(storm_on="2026-10-09")
    dw = F.daily_weather(w)
    assert 5.0 < dw["2026-10-01"]["ghi_kwh_m2"] < 7.0 and dw["2026-10-09"]["storm"] and not dw["2026-10-08"]["storm"]
    w["hourly"] = [r for r in w["hourly"] if not r["time"].startswith("2026-10-10T") or r["time"] < "2026-10-10T08"]   # only 8 hours of the last day
    assert F.daily_weather(w)["2026-10-10"]["ghi_kwh_m2"] is None


def test_cloud_cover_is_for_daylight_hours_only():
    w = weather(cloud=40)
    for r in w["hourly"]:
        if not (6 <= int(r["time"][11:13]) <= 17):
            r["cloud"] = 100                  # clouds at night must not count
    assert F.daily_weather(w)["2026-10-01"]["cloud_pct"] == 40


def test_sky_words():
    assert F.sky({"storm": True}) == "storm" and F.sky({"rain_prob_pct": 80}) == "rain"
    assert F.sky({"cloud_pct": 85}) == "cloudy" and F.sky({"cloud_pct": 45}) == "partly" and F.sky({"cloud_pct": 10}) == "sunny"


# ── solar response ───────────────────────────────────────────────────────────

def test_calibration_recovers_the_sites_own_response():
    w = weather(peaks={f"2026-10-0{i}": 500 for i in (2, 4)})
    c = F.calibrate(history(w, k=4.0), F.daily_weather(w), today="2026-10-08", pv_kwp=5.0)
    assert c["source"] == "history" and abs(c["k"] - 4.0) < 0.05 and c["days"] >= 10


def test_too_little_history_falls_back_to_the_size_and_then_to_nothing():
    w = weather()
    short = history(w)[-3:]
    c = F.calibrate(short, F.daily_weather(w), today="2026-10-08", pv_kwp=5.0)
    assert c["source"] == "size" and c["k"] == 5.0 * F.FALLBACK_PERFORMANCE
    assert F.calibrate(short, F.daily_weather(w), today="2026-10-08", pv_kwp=None)["k"] is None


def test_todays_own_row_is_not_used_to_calibrate():
    w = weather()
    rows = history(w, upto="2026-10-07") + [{"date": "2026-10-08", "pv_kwh": 99.0}]
    assert F.calibrate(rows, F.daily_weather(w), today="2026-10-08", pv_kwp=5)["k"] < 5


# ── tomorrow ─────────────────────────────────────────────────────────────────

def test_a_sunny_tomorrow_matches_a_typical_day():
    f = run()
    s = f["tomorrow"]["solar"]
    assert abs(s["vs_typical_pct"]) <= 2 and f["tomorrow"]["sky"] == "sunny" and s["low_kwh"] <= s["kwh"] <= s["high_kwh"]
    assert not any(a["code"] in ("low_solar_tomorrow", "high_solar_tomorrow") for a in f["advice"])


def test_a_dull_tomorrow_is_flagged_with_the_numbers():
    f = run(weather(peaks={"2026-10-09": 300}))
    a = next(a for a in f["advice"] if a["code"] == "low_solar_tomorrow")
    assert f["tomorrow"]["solar"]["vs_typical_pct"] < -50 and a["params"]["kwh"] < a["params"]["typical"]


def test_a_brighter_than_usual_tomorrow_is_good_news():
    f = run(weather(peaks={"2026-10-09": 1300}))
    assert any(a["code"] == "high_solar_tomorrow" for a in f["advice"])


def test_a_storm_still_to_come_is_advised_but_one_that_has_passed_is_not():
    assert any(a["code"] == "storm" for a in run(weather(storm_on="2026-10-09"))["advice"])                      # tomorrow afternoon
    assert any(a["code"] == "storm" for a in run(weather(storm_on="2026-10-08", storm_hour=22))["advice"])      # tonight, after 7 pm
    assert not any(a["code"] == "storm" for a in run(weather(storm_on="2026-10-08", storm_hour=15))["advice"])  # this afternoon, over
    assert not any(a["code"] == "storm" for a in run(weather(storm_on="2026-10-11"))["advice"])                  # beyond tomorrow
    assert not any(a["code"] == "storm" for a in run()["advice"])
    assert run(weather(storm_on="2026-10-09"))["storm_ahead"] is True


# ── battery ──────────────────────────────────────────────────────────────────

def test_a_light_load_carries_the_battery_to_sunrise():
    b = run(load=300.0)["backup"]
    assert b["reaches_sunrise"] and b["empty_at"] is None and b["until_sunrise"] == "2026-10-09T05:25"
    assert b["soc_at_sunrise_pct"] == round((8.0 - 0.3 * 10.4167) / 10 * 100)      # 8 kWh less 7pm-5:25am at 300 W


def test_a_heavy_load_empties_it_and_says_when():
    f = run(load=1500.0)
    b = f["backup"]
    assert not b["reaches_sunrise"] and b["empty_at"] == "2026-10-09T00:20" and b["hours"] == 5.3 and b["soc_at_sunrise_pct"] == 0
    assert any(a["code"] == "backup_short" for a in f["advice"])


def test_a_site_that_never_fills_its_battery_is_not_told_so_every_day():
    heavy = run(load=2500.0)                               # usual load outweighs the solar on every day
    assert heavy["tomorrow_battery"]["peak_pct"] < 95 and not any(a["code"] == "battery_wont_fill" for a in heavy["advice"])


def test_tomorrows_battery_fills_when_the_sun_is_good_and_reports_a_peak_when_it_is_not():
    sunny = run(load=400.0)["tomorrow_battery"]
    assert sunny["full_by"] is not None and sunny["peak_pct"] >= 98
    dull = run(weather(peaks={"2026-10-09": 250}), load=400.0)
    assert dull["tomorrow_battery"]["full_by"] is None and dull["tomorrow_battery"]["peak_pct"] < 95
    assert any(a["code"] == "battery_wont_fill" for a in dull["advice"])


def test_no_battery_no_profile_or_no_soc_means_no_backup_section():
    w = weather()
    base = dict(weather=w, now=NOW, pv_history=history(w), pv_kwp=5.0, system_type="hybrid")
    assert F.build_forecast(**base, load_profile_w=[500.0] * 24, soc_pct=80, battery_kwh=None)["backup"] is None
    assert F.build_forecast(**base, load_profile_w=None, soc_pct=80, battery_kwh=10)["backup"] is None
    assert F.build_forecast(**base, load_profile_w=[500.0] * 24, soc_pct=None, battery_kwh=10)["backup"] is None
    assert F.build_forecast(**{**base, "system_type": "grid_zero"}, load_profile_w=[500.0] * 24, soc_pct=80, battery_kwh=10)["backup"] is None
    assert F.build_forecast(**base, load_profile_w=None, soc_pct=None, battery_kwh=None)["tomorrow"]["solar"] is not None


def test_without_any_way_to_size_the_solar_there_is_no_solar_forecast():
    w = weather()
    f = F.build_forecast(weather=w, now=NOW, pv_history=[], load_profile_w=None, soc_pct=None, battery_kwh=None, pv_kwp=None, system_type="hybrid")
    assert f["tomorrow"]["solar"] is None and f["tomorrow"]["sky"] == "sunny" and f["calibration"]["source"] is None


def test_the_battery_never_charges_above_full():
    sim = F.simulate(start=datetime(2026, 10, 9, 6), end=datetime(2026, 10, 9, 17), energy_kwh=9.5, capacity_kwh=10.0, k=4.0,
                     ghi={f"2026-10-09T{h:02d}": bell(h, 900) for h in range(24)}, load_w=[100.0] * 24)
    assert sim["energy_kwh"] == 10.0 and sim["full_at"] is not None

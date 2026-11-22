"""victron/export_policy.py and its use: a site that may not export holds its solar back once the battery is full."""
from victron import export_policy as E
from victron import forecast as F
from test_forecast import run, weather


def diag(mfp=-1, dc=None, ac=None, mppt=True, pvinv=False):
    recs = [{"Device": "Gateway", "code": "mfp", "rawValue": mfp, "formattedValue": f"{mfp} W"}]
    if dc is not None:
        recs.append({"Device": "Gateway", "code": "H4of", "rawValue": 1 if dc else 0, "formattedValue": "On" if dc else "Off"})
    if ac is not None:
        recs.append({"Device": "Gateway", "code": "H4pf", "rawValue": 1 if ac else 0, "formattedValue": "On" if ac else "Off"})
    if mppt:
        recs.append({"Device": "Solar Charger", "code": "PVP", "rawValue": 100})
    if pvinv:
        recs.append({"Device": "PV Inverter", "code": "pP1", "rawValue": 100})
    return {"records": recs}


def test_fleet_combinations():
    # Kame House: Fronius on AC-out, export allowed by the switch but capped at 0 W.
    assert E.read(diag(mfp=0, dc=False, ac=True, mppt=False, pvinv=True)) == {"mode": "none", "limit_w": 0}
    # El Encino: DC solar may export, no cap.
    assert E.read(diag(mfp=-1, dc=True, ac=False)) == {"mode": "free", "limit_w": None}
    # Vista Atenas M1: only solar chargers, and they may not export.
    assert E.read(diag(mfp=-1, dc=False, ac=True)) == {"mode": "none", "limit_w": 0}
    # Pacuare Hidros: export up to 5 kW.
    assert E.read(diag(mfp=5000, dc=True, ac=True)) == {"mode": "limited", "limit_w": 5000}
    # Nothing readable, and off-grid.
    assert E.read({"records": []}) is None
    assert E.read({"records": []}, system_type="off_grid")["mode"] == "none"


def test_a_capped_site_forecasts_only_the_solar_it_can_use():
    free = run(battery=10.0, soc=90.0, load=300.0)
    assert "potential_kwh" not in free["tomorrow"]["solar"] and free["export"]["capped"] is False
    used = run(battery=10.0, soc=90.0, load=300.0, export_limit_w=0)["tomorrow"]["solar"]
    assert used["capped"] is True and used["kwh"] < used["potential_kwh"]   # a full battery and a light load cannot take a sunny day
    lots = run(battery=10.0, soc=90.0, load=300.0, export_limit_w=100000)["tomorrow"]["solar"]
    assert lots["kwh"] == lots["potential_kwh"]                             # a generous limit takes it all


def test_held_back_days_do_not_calibrate_a_capped_site():
    w = weather()
    hist = [{"date": "2026-10-0%d" % d, "pv_kwh": 5.0, "max_soc": 100.0} for d in range(1, 8)]
    c = F.calibrate(hist, F.daily_weather(w), today="2026-10-08", pv_kwp=5.0, capped=True)
    assert c["source"] == "size"

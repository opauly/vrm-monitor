"""AC-coupled solar (a Fronius on the inverter's AC output) counts as solar, live and in the 15-minute series."""
import time
from zoneinfo import ZoneInfo

from victron import vrm_live

NOW = time.time()


def rec(code, value, desc, device="System overview"):
    return {"code": code, "rawValue": value, "description": desc, "Device": device, "timestamp": NOW}


DIAG = {"records": [
    rec("P", 132, "PV - AC-coupled on output L1"),
    rec("P2", 132, "PV - AC-coupled on output L2"),
    rec("Pc", 0.01, "PV to consumers"),
    rec("pP1", 132, "L1 Power", device="PV Inverter"),
]}


def test_ac_pv_codes_found_by_description():
    assert vrm_live.ac_pv_codes(DIAG) == ["P", "P2"]


def test_live_total_includes_ac_coupled_pv():
    total, _, chargers = vrm_live._pv_power_from_diagnostics(DIAG)
    assert total == 264 and chargers == []


def test_live_total_adds_chargers_and_ac_pv():
    diag = {"records": DIAG["records"] + [rec("PVP", 500, "PV power", device="Solar Charger")]}
    assert vrm_live._pv_power_from_diagnostics(diag)[0] == 764


def test_series_sums_ac_phases():
    class Client:
        def get_stats(self, *a, attribute_codes, **kw):
            t = int(NOW) * 1000
            return {"records": {"P": [[t, 100]], "P2": [[t, 120]]}}
    s = vrm_live.fetch_pv_power_series(Client(), 1, interval="15mins", start=0, end=1, zone=ZoneInfo("UTC"),
                                       dc=False, ac_codes=["P", "P2"])
    assert list(s.values) == [220]

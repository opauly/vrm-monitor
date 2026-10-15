from datetime import datetime, timezone

from test_devices import battery, charger, inverter  # noqa: F401  (record builders)
from vrm_api import devices_service as svc

NOW = datetime(2026, 10, 15, 3, 0, tzinfo=timezone.utc)


class Fake:
    def __init__(self):
        self.rows = []
        self.writes = []

    def __call__(self, name):
        assert name == "site_devices"
        return self

    def select(self, *_):
        return self

    def in_(self, *_):
        return self

    def execute(self):
        class R: pass
        r = R()
        r.data = list(self.rows)
        return r

    def upsert(self, rows, on_conflict=None):
        assert on_conflict == "site_id,device_key"
        self.writes = rows
        self.rows = [{**row} for row in rows]
        return self


def test_a_pass_stores_one_row_per_device_and_returns_them_per_site(monkeypatch):
    fake = Fake()
    monkeypatch.setattr(svc, "_t", fake)
    sites = [{"site_id": "s1", "timezone": "America/Costa_Rica"}, {"site_id": "s2", "timezone": None}]
    out = svc.run_pass(sites, {"s1": charger(0, today=3.0, yesterday=3.0) + battery() + inverter()}, now=NOW)
    assert set(out) == {"s1"} and {r["device_key"] for r in out["s1"]} == {"charger:0", "battery:512", "inverter:274"}
    assert len(fake.writes) == 3 and all(w["site_id"] == "s1" for w in fake.writes)


def test_a_site_whose_diagnostics_failed_is_left_alone(monkeypatch):
    fake = Fake()
    monkeypatch.setattr(svc, "_t", fake)
    assert svc.run_pass([{"site_id": "s1"}], {}, now=NOW) == {} and fake.writes == []


def test_the_next_pass_remembers_what_the_last_one_saw(monkeypatch):
    fake = Fake()
    monkeypatch.setattr(svc, "_t", fake)
    sites = [{"site_id": "s1", "timezone": "America/Costa_Rica"}]
    svc.run_pass(sites, {"s1": battery(online=3)}, now=NOW)
    out = svc.run_pass(sites, {"s1": battery(online=2)}, now=NOW)
    assert out["s1"][0]["status"] == "bad" and out["s1"][0]["note"]["code"] == "modules_offline"

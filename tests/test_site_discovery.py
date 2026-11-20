"""New-system discovery: what VRM says about the equipment (victron/site_prefill.py) and the hourly pass
(vrm_api/site_discovery.py) against an in-memory fake of the Supabase builder."""
from datetime import datetime, timedelta, timezone

import pytest

from victron import site_prefill
from vrm_api import site_discovery as sd

NOW = datetime(2026, 11, 20, 15, 0, tzinfo=timezone.utc)


def diag(*rows):
    return {"records": [{"Device": d, "code": c, "formattedValue": f, "rawValue": r, "instance": 0} for d, c, f, r in rows]}


KAME_OVERVIEW = {"records": {"devices": [
    {"name": "Gateway", "productName": "Ekrano GX"},
    {"name": "VE.Bus System", "productName": "MultiPlus-II 48/5000/70-95 120V",
     "vid": {"enumValue": "Two units configured as split-phase", "devicesPerPhase": {"L1": 1, "L2": 1, "L3": 0}}},
    {"name": "Battery Monitor", "productName": "Pylontech battery"},
    {"name": "PV Inverter", "productName": "Fronius PV Inverter"},
    {"name": "Grid meter", "productName": "Energy Meter VM-3P75CT"},
]}}
KAME_DIAG = diag(("Gateway", "si1", "Grid", None), ("Gateway", "H4ms", "40.0 %", 40.0), ("System overview", "st", "ESS", "ESS"),
                 ("Battery Monitor", "Bm", "PYLON", "PYLON"), ("Battery Monitor", "mon", "4", 4))


def test_prefill_reads_inverter_battery_grid_and_reserve():
    p = site_prefill.prefill({"name": "Kame House", "timezone": "America/Guatemala", "hasMains": 1}, KAME_OVERVIEW, KAME_DIAG)
    f, eq = p["fields"], p["equipment"]
    assert f["display_name"] == "Kame House" and f["system_type"] == "hybrid" and f["timezone"] == "America/Guatemala"
    assert f["inverter_nominal_kw"] == 8.0                   # two 5000 VA units at 80%
    assert eq["inverter"]["units"] == 2 and eq["inverter"]["battery_voltage"] == 48
    assert eq["battery"]["maker"] == "Pylontech" and eq["battery"]["modules"] == 4 and eq["battery"]["chemistry"] == "lithium"
    assert f["battery_nominal_kwh"] is None and f["battery_dod_pct"] == 90.0   # module size is never reported
    assert f["reserve_soc_pct"] == 40.0
    assert eq["pv_inverters"] == [{"model": "Fronius PV Inverter", "count": 1}]
    assert p["ask"] == ["pv_kwp", "battery_nominal_kwh", "latitude"]


def test_prefill_off_grid_has_no_reserve_and_reads_a_shunt_capacity():
    overview = {"records": {"devices": [{"name": "VE.Bus System", "productName": "Quattro 48/10000/140-100/100 230V"},
                                        {"name": "Battery Monitor", "productName": "SmartShunt 500A/50mV"},
                                        {"name": "Solar Charger", "productName": "SmartSolar MPPT 250/100"},
                                        {"name": "Solar Charger", "productName": "SmartSolar MPPT 250/100"}]}}
    d = diag(("Gateway", "si1", "Generator", None), ("Gateway", "H4ms", "10.0 %", 10.0),
             ("Battery Monitor", "C", "400 Ah", 400), )
    d["records"][-1]["description"] = "Installed capacity"
    p = site_prefill.prefill({"name": "Finca", "hasMains": 0, "hasGenerator": 1}, overview, d)
    assert p["fields"]["system_type"] == "off_grid" and p["fields"]["reserve_soc_pct"] is None
    assert p["equipment"]["has_generator"] is True
    assert p["fields"]["inverter_nominal_kw"] == 8.0 and p["fields"]["battery_nominal_kwh"] == 19.2
    assert p["equipment"]["chargers"] == [{"model": "SmartSolar MPPT 250/100", "count": 2}]


def test_prefill_with_nothing_readable_asks_for_everything():
    p = site_prefill.prefill({"name": "X"}, {}, {})
    assert p["fields"]["system_type"] is None and p["equipment"]["battery"] is None
    assert p["ask"] == ["pv_kwp", "inverter_nominal_kw", "system_type", "latitude"]


# ── the pass ─────────────────────────────────────────────────────────────

class Result:
    def __init__(self, data):
        self.data = data


class Table:
    def __init__(self, store, name):
        self.store, self.name, self.op, self.filters, self.payload = store, name, "select", [], None

    def select(self, *_): return self
    def eq(self, c, v): self.filters.append(lambda r: r.get(c) == v); return self
    def in_(self, c, vs): self.filters.append(lambda r: r.get(c) in vs); return self
    def is_(self, c, v): self.filters.append(lambda r: r.get(c) is None); return self
    def limit(self, *_): return self

    @property
    def not_(self):
        outer = self

        class Neg:
            def is_(self, c, v): outer.filters.append(lambda r: r.get(c) is not None); return outer
        return Neg()

    def insert(self, p): self.op, self.payload = "insert", p; return self
    def update(self, p): self.op, self.payload = "update", p; return self

    def execute(self):
        rows = self.store.setdefault(self.name, [])
        if self.op == "insert":
            row = {"id": f"r{len(rows) + 1}", "status": "new", "notified_at": None, **self.payload}
            rows.append(row)
            return Result([row])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
        return Result(hit)


class Client:
    def __init__(self, records):
        self.records = records

    def get_me(self): return {"user": {"id": 7}}
    def list_installations(self, uid, extended=True): return {"records": self.records}
    def get_system_overview(self, iid): return KAME_OVERVIEW
    def get_diagnostics(self, iid): return KAME_DIAG


def inst(iid, name, days_ago):
    return {"idSite": iid, "name": name, "syscreated": int((NOW - timedelta(days=days_ago)).timestamp()), "hasMains": 1}


@pytest.fixture
def store(monkeypatch):
    s = {"sites": [{"site_id": "p-emtec", "customer_id": "c1", "vrm_installation_id": 997979}], "new_installations": []}
    monkeypatch.setattr(sd, "_t", lambda name: Table(s, name))
    return s


def run(store, accounts, records):
    return sd.run_pass(now=NOW, accounts=accounts, client_factory=lambda token: Client(records[token]))


def test_admin_account_finds_only_recent_unlinked_systems(store):
    out = run(store, [(None, "admin")], {"admin": [inst(1068118, "Kame House", 1), inst(997979, "Emtec", 1), inst(855465, "Old", 60)]})
    assert out["found"] == 1
    row = store["new_installations"][0]
    assert row["customer_id"] is None and row["vrm_installation_id"] == 1068118 and row["name"] == "Kame House"
    assert row["prefill"]["fields"]["inverter_nominal_kw"] == 8.0


def test_a_second_pass_does_not_record_it_again(store):
    accounts, records = [(None, "admin")], {"admin": [inst(1068118, "Kame House", 1)]}
    run(store, accounts, records)
    assert run(store, accounts, records)["found"] == 0 and len(store["new_installations"]) == 1


def test_customer_account_counts_only_its_own_sites(store):
    # Emtec has a site, but under another customer: for customer c2 it is still new.
    out = run(store, [("c2", "tok")], {"tok": [inst(997979, "Emtec", 2)]})
    assert out["found"] == 1 and store["new_installations"][0]["customer_id"] == "c2"


def test_a_waiting_row_closes_once_a_site_exists(store):
    run(store, [(None, "admin")], {"admin": [inst(1068118, "Kame House", 1)]})
    store["sites"].append({"site_id": "p-kame", "customer_id": "c1", "vrm_installation_id": 1068118})
    out = run(store, [(None, "admin")], {"admin": [inst(1068118, "Kame House", 1)]})
    row = store["new_installations"][0]
    assert out["closed"] == 1 and row["status"] == "added" and row["site_id"] == "p-kame"


def test_one_failing_account_does_not_stop_the_others(store):
    def factory(token):
        if token == "bad":
            raise RuntimeError("expired")
        return Client([inst(1068118, "Kame House", 1)])
    out = sd.run_pass(now=NOW, accounts=[("c9", "bad"), (None, "admin")], client_factory=factory)
    assert out["failed"] == 1 and out["found"] == 1


def test_customer_cannot_act_on_another_accounts_row(store):
    run(store, [(None, "admin")], {"admin": [inst(1068118, "Kame House", 1)]})
    with pytest.raises(sd.NotFound):
        sd.get_open("r1", customer_id="c1")
    assert sd.get_open("r1", customer_id=None)["name"] == "Kame House"


def test_first_import_starts_the_day_the_system_was_created():
    row = {"vrm_created_at": (NOW - timedelta(hours=20)).isoformat()}
    assert sd.first_import_window(row, "America/Costa_Rica", NOW) == ("2026-11-19", "2026-11-20")
    old = {"vrm_created_at": (NOW - timedelta(days=90)).isoformat()}
    assert sd.first_import_window(old, "America/Costa_Rica", NOW)[0] == "2026-10-20"


def test_deliver_tells_the_admin_once(store, monkeypatch):
    run(store, [(None, "admin")], {"admin": [inst(1068118, "Kame House", 1)]})
    sent = []
    monkeypatch.setattr(sd.alerts_push, "destinations", lambda **kw: [{"id": "d1"}])
    monkeypatch.setattr(sd.alerts_push, "deliver", lambda devices, payloads, **kw: sent.append(payloads) or {"delivered": 1})
    out = sd.deliver(now=NOW, push=True, email=False)
    assert out["pushed"] == 1 and sent[0][0]["title"] == "New system found in VRM" and sent[0][0]["body"].startswith("Kame House")
    assert sd.deliver(now=NOW, push=True, email=False)["pushed"] == 0

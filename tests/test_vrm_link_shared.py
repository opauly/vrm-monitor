"""An installation another account already has is flagged "shared" when someone else connects it."""
from vrm_api import tenancy
from vrm_api.routers import vrm_link as L
from vrm_api.schemas import VrmLinkConnectRequest, VrmLinkValidateRequest


class Sites:
    def __init__(self, rows):
        self.rows, self.f = rows, []

    def select(self, *_): return self
    def neq(self, col, val): self.f.append(lambda r: r.get(col) != val); return self
    def in_(self, col, vals): self.f.append(lambda r: r.get(col) in vals); return self

    def execute(self):
        class R: pass
        out = R(); out.data = [r for r in self.rows if all(f(r) for f in self.f)]
        return out


ROWS = [{"customer_id": "oscar", "vrm_installation_id": 156868}, {"customer_id": "oscar", "vrm_installation_id": 844477}, {"customer_id": "fer", "vrm_installation_id": 385423}]
INSTALLATIONS = {"records": [{"idSite": 156868, "name": "Ukiyo"}, {"idSite": 385423, "name": "Aaron Giani"}, {"idSite": 999, "name": "New"}]}


def test_only_installations_another_customer_has_count(monkeypatch):
    monkeypatch.setattr(tenancy, "_t", lambda name: Sites(ROWS))
    assert tenancy.installations_registered_elsewhere("fer", [156868, 385423, 999]) == {156868}
    assert tenancy.installations_registered_elsewhere("oscar", [156868]) == set()
    assert tenancy.installations_registered_elsewhere("fer", []) == set()


def test_validate_tells_the_mapping_screen_which_installations_are_shared(monkeypatch):
    monkeypatch.setattr(tenancy, "_t", lambda name: Sites(ROWS))
    monkeypatch.setattr(L.tenancy, "get_customer", lambda cid: {"id": cid})
    monkeypatch.setattr(L, "_whoami", lambda token: ("53586", "f@x.co", INSTALLATIONS))
    out = L.post_validate(VrmLinkValidateRequest(customer_id="fer", token="t"))
    assert {i.id_site: i.registered_elsewhere for i in out.installations} == {156868: True, 385423: False, 999: False}


def test_the_live_sweep_skips_shared_sites_so_nothing_is_alerted_twice(monkeypatch):
    from vrm_api.routers import vrm_fleet as F

    rows = [{"site_id": "mine", "is_shared": False}, {"site_id": "copy", "is_shared": True}, {"site_id": "old", "is_shared": None}]

    class T:
        def select(self, cols):
            if "is_shared" not in cols and missing:
                return self
            if "is_shared" in cols and missing:
                raise RuntimeError("column is_shared does not exist")
            return self
        def eq(self, *_): return self
        def execute(self):
            class R: pass
            out = R(); out.data = [{k: v for k, v in r.items() if not missing or k != "is_shared"} for r in rows]
            return out

    missing = False
    monkeypatch.setattr(F, "_t", lambda name: T())
    assert [s["site_id"] for s in F._sweep_sites()] == ["mine", "old"]
    missing = True                                              # the SQL has not been run: every site is polled, as before
    assert [s["site_id"] for s in F._sweep_sites()] == ["mine", "copy", "old"]

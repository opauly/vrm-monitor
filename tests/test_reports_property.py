"""A report requested for a property goes through the property builder and is stored under the property, not a site."""
from vrm_api.routers import reports as R
from vrm_api.schemas import ReportRequest


def data():
    return {"siteName": "El Encino", "startStr": "2026-10-12", "endStr": "2026-10-18", "schema": "vrm", "systemType": "hybrid",
            "totals": {"pv": 10.0, "load": 8.0, "grid": 1.0, "discharge": 3.0, "charge": 4.0, "outageCount": 0, "outageMinutes": 0, "batteryKwhAvailable": True},
            "gridIndependencePct": 90, "avgHealth": 95, "healthStatus": "Good", "batteryCycles": 0.3, "battStressLabel": "Normal", "battStressColor": "#0a0",
            "gridQualityScore": 100, "gridQualityStatus": "Stable", "gridQualityColor": "#0a0", "weatherErrors": [], "missingDays": 0, "dailyGrouped": [1],
            "isOverview": False, "exportsToGrid": False, "longestOutageMinutes": 0, "alarmEpisodesTotal": 0}


def test_a_property_request_builds_the_merged_report_and_stores_it_under_the_property(monkeypatch):
    calls = {}
    monkeypatch.setattr(R.tenancy, "get_customer", lambda cid: {"id": cid})
    monkeypatch.setattr(R, "resolve_branding", lambda customer: None)
    monkeypatch.setattr(R, "resolve_report_modules", lambda customer, site: {"energy_mix"})
    monkeypatch.setattr(R.weekly_report, "build_property_report_data", lambda pid, s, e, branding=None: calls.setdefault("property", pid) and data())
    monkeypatch.setattr(R.weekly_report, "build_report_data", lambda *a, **k: calls.setdefault("site", True) and data())
    monkeypatch.setattr(R.weekly_report, "render_pdf", lambda d, selected: b"%PDF")
    monkeypatch.setattr(R.storage, "upload_report_pdf", lambda sid, s, e, b: calls.setdefault("stored_as", sid) and f"reports/{sid}/{s}_{e}.pdf")
    out = R._do_report("", "2026-10-12", "2026-10-18", "vrm", "c1", site={"report_modules": None}, property_id="p1")
    assert calls == {"property": "p1", "stored_as": "property-p1"} and out["storage_path"] == "reports/property-p1/2026-10-12_2026-10-18.pdf"
    assert out["summary"]["siteName"] == "El Encino"


def test_a_site_request_still_builds_a_single_site_report(monkeypatch):
    calls = {}
    monkeypatch.setattr(R.tenancy, "get_customer", lambda cid: {"id": cid})
    monkeypatch.setattr(R, "resolve_branding", lambda customer: None)
    monkeypatch.setattr(R, "resolve_report_modules", lambda customer, site: {"energy_mix"})
    monkeypatch.setattr(R.weekly_report, "build_property_report_data", lambda *a, **k: calls.setdefault("property", True) and data())
    monkeypatch.setattr(R.weekly_report, "build_report_data", lambda sid, *a, **k: calls.setdefault("site", sid) and data())
    monkeypatch.setattr(R.weekly_report, "render_pdf", lambda d, selected: b"%PDF")
    monkeypatch.setattr(R.storage, "upload_report_pdf", lambda sid, s, e, b: calls.setdefault("stored_as", sid) and "p.pdf")
    R._do_report("s1", "2026-10-12", "2026-10-18", "vrm", "c1", site={"site_id": "s1"})
    assert calls == {"site": "s1", "stored_as": "s1"}


def test_the_request_takes_a_property_with_no_site():
    body = ReportRequest(customer_id="c1", property_id="p1", start="2026-10-12", end="2026-10-18", schema="vrm", actor="customer")
    assert body.site_id == "" and body.property_id == "p1"

"""POST /v1/alerts/push-test — validation, auth, and that it only ever targets the caller's own devices."""
import pytest
from fastapi.testclient import TestClient

from vrm_api import alerts_push as ap
from vrm_api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def pipeline_key(monkeypatch):
    monkeypatch.setenv("PIPELINE_API_KEY", "secret-key")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "PRIV")


def post(body, key="secret-key"):
    return client.post("/v1/alerts/push-test", json=body, headers={"Authorization": f"Bearer {key}"})


def test_rejects_a_missing_or_wrong_key():
    assert client.post("/v1/alerts/push-test", json={"customer_id": "c1"}).status_code in (401, 403)
    assert post({"customer_id": "c1"}, key="nope").status_code in (401, 403)


@pytest.mark.parametrize("body", [{}, {"customer_id": "c1", "admin_email": "a@x.com"}])
def test_requires_exactly_one_owner(body):
    r = post(body)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "exactly_one_owner_required"


def test_unconfigured_push_is_reported_not_silent(monkeypatch):
    monkeypatch.delenv("VAPID_PRIVATE_KEY")
    r = post({"customer_id": "c1"})
    assert r.status_code == 503 and r.json()["detail"]["code"] == "push_not_configured"


def test_no_devices_is_a_clean_zero(monkeypatch):
    monkeypatch.setattr(ap, "destinations", lambda **kw: [])
    assert post({"customer_id": "c1"}).json() == {"devices": 0, "delivered": 0, "removed": 0, "failed": 0}


def test_customer_test_only_targets_that_customers_devices(monkeypatch):
    seen = {}
    monkeypatch.setattr(ap, "destinations", lambda **kw: seen.update(kw) or [{"id": 1}])
    monkeypatch.setattr(ap, "deliver", lambda devices, payloads, **kw: seen.update(payloads=payloads) or
                        {"devices": 1, "delivered": 1, "removed": 0, "failed": 0})
    r = post({"customer_id": "c1", "lang": "es"})
    assert r.json()["delivered"] == 1
    assert seen["customer_id"] == "c1" and seen.get("admin_email") is None and not seen.get("include_admin_devices")
    p = seen["payloads"][0]
    assert p["title"] == "Notificación de prueba" and p["url"] == "/app/alerts" and p["tag"] == "alert-test"


def test_admin_test_targets_that_admins_devices_and_links_to_the_fleet(monkeypatch):
    seen = {}
    monkeypatch.setattr(ap, "destinations", lambda **kw: seen.update(kw) or [{"id": 1}])
    monkeypatch.setattr(ap, "deliver", lambda devices, payloads, **kw: seen.update(payloads=payloads) or
                        {"devices": 1, "delivered": 1, "removed": 0, "failed": 0})
    post({"admin_email": "me@x.com"})
    assert seen["admin_email"] == "me@x.com" and seen.get("customer_id") is None
    assert seen["payloads"][0]["url"] == "/admin/fleet" and seen["payloads"][0]["title"] == "Test notification"


# ── POST /v1/alerts/admin-check ──────────────────────────────────────────────

def admin_check(key="secret-key"):
    return client.post("/v1/alerts/admin-check", headers={"Authorization": f"Bearer {key}"})


def test_admin_check_needs_the_key():
    assert client.post("/v1/alerts/admin-check").status_code in (401, 403)
    assert admin_check(key="nope").status_code in (401, 403)


def test_admin_check_is_a_noop_while_switched_off(monkeypatch):
    from vrm_api import admin_alerts
    monkeypatch.delenv("ALERTS_ADMIN", raising=False)
    monkeypatch.setattr(admin_alerts, "run_watchdog_pass", lambda **k: pytest.fail("must not run while off"))
    r = admin_check()
    assert r.status_code == 200 and r.json() == {"mode": "off", "checks": {}, "notifications": None}


def test_admin_check_runs_the_watchdog_then_delivers(monkeypatch):
    from vrm_api import admin_alerts
    monkeypatch.setenv("ALERTS_ADMIN", "on")
    monkeypatch.setattr(admin_alerts, "run_watchdog_pass", lambda **k: {"mode": "on", "opened": 1})
    monkeypatch.setattr(admin_alerts, "deliver_pending", lambda **k: {"mode": "on", "sent": 1})
    r = admin_check()
    assert r.json() == {"mode": "on", "checks": {"mode": "on", "opened": 1}, "notifications": {"mode": "on", "sent": 1}}


def test_admin_check_in_dry_run_does_not_deliver(monkeypatch):
    from vrm_api import admin_alerts
    monkeypatch.setenv("ALERTS_ADMIN", "dry_run")
    monkeypatch.setattr(admin_alerts, "run_watchdog_pass", lambda **k: {"mode": "dry_run"})
    monkeypatch.setattr(admin_alerts, "deliver_pending", lambda **k: pytest.fail("dry_run must not deliver"))
    assert admin_check().json()["notifications"] is None

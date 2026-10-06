"""vrm_api/alerts_service.py against an in-memory fake of the Supabase builder."""
from datetime import datetime, timezone

import pytest

from victron import alerts as A
from vrm_api import alerts_service as svc

NOW = datetime(2026, 10, 5, 18, 0, tzinfo=timezone.utc)
SITE = {"site_id": "s1", "customer_id": "c1", "system_type": "hybrid"}


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeTable:
    """Just enough of supabase-py's builder: select/eq/in_/insert/update/execute."""
    def __init__(self, store, name, fail_inserts_for=()):
        self.store, self.name, self.fail_inserts_for = store, name, set(fail_inserts_for)
        self._op, self._filters, self._payload = "select", [], None

    def select(self, *_): self._op = "select"; return self
    def eq(self, col, val): self._filters.append(lambda r: r.get(col) == val); self._eq_id = val if col == "id" else getattr(self, "_eq_id", None); return self
    def in_(self, col, vals): self._filters.append(lambda r: r.get(col) in vals); return self
    def insert(self, payload): self._op, self._payload = "insert", payload; return self
    def update(self, payload): self._op, self._payload = "update", payload; return self

    def execute(self):
        rows = self.store.setdefault(self.name, [])
        if self._op == "insert":
            if self._payload["kind"] in self.fail_inserts_for:
                raise RuntimeError("unique violation")
            rows.append({"id": len(rows) + 1, **self._payload})
            return FakeResult([self._payload])
        matched = [r for r in rows if all(f(r) for f in self._filters)]
        if self._op == "update":
            for r in matched:
                r.update(self._payload)
        return FakeResult(matched)


def customer(**kw):
    return {"id": "c1", "plan": "growth", "active": True, "provisioning_state": "active", "billing_status": "active",
            "vrm_token_secret_id": "sec", "vrm_token_revoked_at": None, "vrm_token_last_error": None, **kw}


PLAN_LIMITS = [{"plan_key": "default", "live_dashboard": False}, {"plan_key": "trial", "live_dashboard": False},
               {"plan_key": "starter", "live_dashboard": False}, {"plan_key": "growth", "live_dashboard": True},
               {"plan_key": "fleet", "live_dashboard": True}]


@pytest.fixture
def db(monkeypatch):
    store = {"customers": [customer()], "plan_limits": [dict(r) for r in PLAN_LIMITS]}
    monkeypatch.setattr(svc, "_t", lambda name: FakeTable(store, name))
    monkeypatch.delenv("ALERTS_FORCE_CUSTOMER_IDS", raising=False)
    return store


def snap(minutes_ago=5, soc=80.0, v=120.0, critical=None):
    from datetime import timedelta
    return {"captured_at": (NOW - timedelta(minutes=minutes_ago)).isoformat(), "soc_pct": soc,
            "raw": {"IV1": v, "alarms": {}, "critical_alerts": critical or {}}}


def go(db, mode, snapshot, previous=None, energy=None):
    return svc.run_alert_pass(
        sites=[SITE], fetched=[("ok", snapshot)], previous_by_site={"s1": previous} if previous else {},
        energy_by_site={"s1": energy if energy is not None else [{"date": "2026-10-04", "grid_kwh": 5}]},
        mode=mode, now=NOW)


def test_mode_defaults_to_off_and_rejects_garbage(monkeypatch):
    monkeypatch.delenv("ALERTS_MODE", raising=False)
    assert svc.alerts_mode() == "off"
    monkeypatch.setenv("ALERTS_MODE", "LIVE ")
    assert svc.alerts_mode() == "live"
    monkeypatch.setenv("ALERTS_MODE", "yes please")
    assert svc.alerts_mode() == "off"


def test_off_touches_nothing(db):
    assert go(db, "off", snap(soc=5)) == {"mode": "off"}
    assert "alerts" not in db


def test_dry_run_reports_but_writes_nothing(db):
    out = go(db, "dry_run", snap(soc=5))
    assert out["opened"] == 1 and "applied" not in out
    assert db.get("alerts", []) == []


def test_dry_run_survives_a_missing_table(monkeypatch, db):
    def broken(name):
        if name == "alerts":
            raise RuntimeError("relation vrm.alerts does not exist")
        return FakeTable(db, name)
    monkeypatch.setattr(svc, "_t", broken)
    assert go(None, "dry_run", snap(soc=5))["opened"] == 1


def test_live_missing_table_is_an_error_not_silent(monkeypatch, db):
    monkeypatch.setattr(svc, "_t", lambda name: (_ for _ in ()).throw(RuntimeError("no table")) if name == "alerts" else FakeTable(db, name))
    with pytest.raises(RuntimeError):
        go(None, "live", snap(soc=5))


def test_live_opens_then_keeps_then_resolves(db):
    out = go(db, "live", snap(soc=8))
    assert out["applied"]["opened"] == 1
    row = db["alerts"][0]
    assert (row["kind"], row["severity"], row["status"], row["detail"]) == (A.LOW_BATTERY, A.CRITICAL, "open", {"soc_pct": 8.0})

    again = go(db, "live", snap(soc=8))                       # same condition: nothing new
    assert again["opened"] == 0 and again["applied"]["opened"] == 0 and len(db["alerts"]) == 1

    go(db, "live", snap(soc=60))                              # recovered
    assert db["alerts"][0]["status"] == "resolved" and db["alerts"][0]["resolved_at"] == NOW.isoformat()


def test_escalation_clears_notified_at_so_it_is_sent_again(db):
    go(db, "live", snap(soc=18))                              # warning
    db["alerts"][0]["notified_at"] = "2026-10-05T17:00:00+00:00"
    go(db, "live", snap(soc=9))                               # now critical
    row = db["alerts"][0]
    assert row["severity"] == A.CRITICAL and row["notified_at"] is None


def test_offline_site_does_not_resolve_other_open_alerts(db):
    go(db, "live", snap(soc=8))
    go(db, "live", snap(minutes_ago=90, soc=60))              # stale reading says 60%, but it is stale
    kinds = {(r["kind"], r["status"]) for r in db["alerts"]}
    assert (A.LOW_BATTERY, "open") in kinds and (A.SITE_OFFLINE, "open") in kinds


def test_one_failing_row_does_not_block_the_others(monkeypatch, db):
    monkeypatch.setattr(svc, "_t", lambda name: FakeTable(db, name, fail_inserts_for={A.LOW_BATTERY}))
    out = go(db, "live", snap(soc=8, critical={"temp_fault": True}))
    assert out["applied"]["errors"] == 1 and out["applied"]["opened"] == 1
    assert [r["kind"] for r in db["alerts"]] == [A.SYSTEM_ALARM]


def test_vrm_link_broken_is_customer_level(db):
    db["customers"][0].update(vrm_token_revoked_at="2026-10-01T00:00:00Z", vrm_token_last_error="auth failed")
    go(db, "live", snap())
    link = [r for r in db["alerts"] if r["kind"] == A.VRM_LINK_BROKEN]
    assert len(link) == 1 and link[0]["site_id"] is None and link[0]["severity"] == A.CRITICAL


# ── who gets alerts, and what they switched off ─────────────────────────
def test_starter_plan_gets_no_alerts(db):
    db["customers"][0]["plan"] = "starter"
    assert go(db, "live", snap(soc=5))["opened"] == 0 and db.get("alerts", []) == []


@pytest.mark.parametrize("status", ["canceled", "unpaid", "trial_expired", "beta_ended", "incomplete"])
def test_lapsed_billing_gets_no_alerts(db, status):
    db["customers"][0]["billing_status"] = status
    assert go(db, "live", snap(soc=5))["opened"] == 0


def test_inactive_or_pending_account_gets_no_alerts(db):
    db["customers"][0]["active"] = False
    assert go(db, "live", snap(soc=5))["opened"] == 0
    db["customers"][0].update(active=True, provisioning_state="pending_subscription")
    assert go(db, "live", snap(soc=5))["opened"] == 0


def test_beta_free_tier_counts_as_entitled(db):
    db["customers"][0]["billing_status"] = "beta"
    assert go(db, "live", snap(soc=5))["opened"] == 1


def test_force_list_lets_an_otherwise_ineligible_customer_through(db, monkeypatch):
    db["customers"][0]["plan"] = "trial"
    assert go(db, "live", snap(soc=5))["opened"] == 0
    monkeypatch.setenv("ALERTS_FORCE_CUSTOMER_IDS", "x, c1 ,y")
    assert go(db, "live", snap(soc=5))["opened"] == 1


def test_a_disabled_alert_type_is_never_raised(db):
    db["alert_preferences"] = [{"customer_id": "c1", "kind": A.LOW_BATTERY, "enabled": False, "email": True}]
    out = go(db, "live", snap(soc=5, critical={"temp_fault": True}))
    assert [r["kind"] for r in db["alerts"]] == [A.SYSTEM_ALARM] and out["opened"] == 1


def test_disabling_an_alert_type_closes_the_open_one_silently(db):
    go(db, "live", snap(soc=5))
    db["alerts"][0]["notified_at"] = "2026-10-05T17:00:00+00:00"
    db["alert_preferences"] = [{"customer_id": "c1", "kind": A.LOW_BATTERY, "enabled": False, "email": True}]
    out = go(db, "live", snap(soc=5))
    row = db["alerts"][0]
    assert out["closed_silently"] == 1 and row["status"] == "resolved"
    assert row["resolved_notified_at"] == NOW.isoformat()         # so no "back to normal" email follows
    assert out["resolved"] == 0                                    # not counted as a normal resolution


def test_losing_the_tier_closes_open_alerts_silently(db):
    go(db, "live", snap(soc=5))
    db["customers"][0]["plan"] = "starter"
    assert go(db, "live", snap(soc=5))["closed_silently"] == 1 and db["alerts"][0]["status"] == "resolved"


def test_email_off_alone_does_not_stop_the_alert_being_raised(db):
    db["alert_preferences"] = [{"customer_id": "c1", "kind": A.LOW_BATTERY, "enabled": True, "email": False}]
    assert go(db, "live", snap(soc=5))["opened"] == 1


def test_missing_preferences_table_means_defaults(monkeypatch, db):
    def maybe(name):
        if name == "alert_preferences":
            raise RuntimeError("relation does not exist")
        return FakeTable(db, name)
    monkeypatch.setattr(svc, "_t", maybe)
    assert go(db, "live", snap(soc=5))["opened"] == 1

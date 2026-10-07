"""vrm_api/admin_alerts.py (persistence + delivery) against an in-memory fake Supabase."""
from datetime import datetime, timedelta, timezone

import pytest

from victron import admin_alerts as A
from vrm_api import admin_alerts as svc
from vrm_api import alerts_push as ap

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)


def ago(**kw):
    return (NOW - timedelta(**kw)).isoformat()


class Result:
    def __init__(self, data): self.data = data


class Query:
    def __init__(self, store, name):
        self.store, self.rows, self.name = store, store.setdefault(name, []), name
        self.checks, self.op, self.payload, self._order, self._limit = [], "select", None, None, None

    @property
    def not_(self):
        outer = self
        class Neg:
            def is_(self, col, val): outer.checks.append(lambda r: r.get(col) is not None); return outer
        return Neg()

    def select(self, *_): self.op = "select"; return self
    def insert(self, payload): self.op, self.payload = "insert", payload; return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, c, v): self.checks.append(lambda r: r.get(c) == v); return self
    def in_(self, c, vs): self.checks.append(lambda r: r.get(c) in vs); return self
    def is_(self, c, v): self.checks.append(lambda r: r.get(c) is None); return self
    def gte(self, c, v): self.checks.append(lambda r: r.get(c) is not None and str(r.get(c)) >= v); return self
    def order(self, c, desc=False): self._order = (c, desc); return self
    def limit(self, n): self._limit = n; return self

    def execute(self):
        if self.op == "insert":
            row = {"id": len(self.rows) + 1, "notified_at": None, "resolved_notified_at": None, "resolved_at": None, **self.payload}
            self.rows.append(row)
            return Result([row])
        matched = [r for r in self.rows if all(f(r) for f in self.checks)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
        elif self.op == "delete":
            for r in matched:
                self.rows.remove(r)
        if self._order:
            matched = sorted(matched, key=lambda r: r.get(self._order[0]) or "", reverse=self._order[1])
        if self._limit:
            matched = matched[: self._limit]
        return Result([dict(r) for r in matched])


class Table:
    def __init__(self, store, name): self.store, self.name = store, name
    def select(self, *a): return Query(self.store, self.name).select(*a)
    def insert(self, p): return Query(self.store, self.name).insert(p)
    def update(self, p): return Query(self.store, self.name).update(p)
    def delete(self): return Query(self.store, self.name).delete()


@pytest.fixture
def env(monkeypatch):
    store = {
        "admin_alerts": [],
        "sites": [{"site_id": f"s{i}", "display_name": f"Site {i}", "source": "vrm_api", "active": True} for i in range(10)],
        "site_snapshots": [{"site_id": f"s{i}", "captured_at": ago(minutes=5), "updated_at": ago(minutes=5)} for i in range(10)],
        "energy_daily": [{"date": "2026-10-05"}],
    }
    sent = []
    monkeypatch.setattr(svc, "_t", lambda name: Table(store, name))
    monkeypatch.setattr(ap, "_t", lambda name: Table(store, name))
    monkeypatch.setattr(svc, "mailer_send", lambda to, subject, html, **kw: sent.append({"to": to, "subject": subject, "html": html}))
    monkeypatch.delenv("ADMIN_ALERTS_EMAIL", raising=False)
    monkeypatch.delenv("ADMIN_ALERTS_LANG", raising=False)
    monkeypatch.delenv("ALERTS_ADMIN", raising=False)
    return store, sent


def silence(store, count, minutes=120):
    for i in range(count):
        store["site_snapshots"][i]["captured_at"] = ago(minutes=minutes)


def kinds(store, status="open"):
    return sorted(a["kind"] for a in store["admin_alerts"] if a["status"] == status)


def test_mode_defaults_off_and_rejects_garbage(monkeypatch):
    assert svc.admin_mode() == "off"
    monkeypatch.setenv("ALERTS_ADMIN", " ON ")
    assert svc.admin_mode() == "on"
    monkeypatch.setenv("ALERTS_ADMIN", "sure")
    assert svc.admin_mode() == "off"


def test_off_does_nothing(env):
    store, _ = env
    silence(store, 6)
    assert svc.run_watchdog_pass(mode="off", now=NOW) == {"mode": "off"}
    assert store["admin_alerts"] == []


def test_healthy_fleet_opens_nothing(env):
    store, _ = env
    out = svc.run_watchdog_pass(mode="on", now=NOW)
    assert out["opened"] == 0 and store["admin_alerts"] == []


def test_watchdog_opens_fleet_offline_and_is_idempotent(env):
    store, _ = env
    silence(store, 4)
    svc.run_watchdog_pass(mode="on", now=NOW)
    svc.run_watchdog_pass(mode="on", now=NOW)
    assert kinds(store) == [A.FLEET_OFFLINE]
    assert store["admin_alerts"][0]["detail"]["offline"] == 4


def test_dead_sweep_is_caught_by_the_watchdog(env):
    store, _ = env
    for r in store["site_snapshots"]:
        r["updated_at"] = ago(hours=4)
        r["captured_at"] = ago(hours=4)
    svc.run_watchdog_pass(mode="on", now=NOW)
    assert A.SWEEP_STALE in kinds(store)
    assert next(a for a in store["admin_alerts"] if a["kind"] == A.SWEEP_STALE)["severity"] == "critical"


def test_stale_history_is_caught(env):
    store, _ = env
    store["energy_daily"] = [{"date": "2026-10-02"}]
    svc.run_watchdog_pass(mode="on", now=NOW)
    assert kinds(store) == [A.HISTORY_STALE]


def test_dry_run_logs_and_writes_nothing(env):
    store, _ = env
    silence(store, 5)
    out = svc.run_watchdog_pass(mode="dry_run", now=NOW)
    assert out["opened"] == 1 and store["admin_alerts"] == []


def test_sweep_pass_flags_failed_reads_and_resolves_them(env):
    store, _ = env
    ids = [f"s{i}" for i in range(10)]
    bad = [("failed", None)] * 6 + [("ok", {})] * 4
    svc.run_sweep_pass(fetched=bad, site_ids=ids, mode="on", now=NOW)
    assert kinds(store) == [A.FETCH_FAILING]
    good = [("ok", {})] * 10
    svc.run_sweep_pass(fetched=good, site_ids=ids, mode="on", now=NOW)
    assert kinds(store) == [] and kinds(store, "resolved") == [A.FETCH_FAILING]


def test_skipped_sites_are_not_failures(env):
    store, _ = env
    ids = [f"s{i}" for i in range(10)]
    svc.run_sweep_pass(fetched=[("skipped", None)] * 8 + [("ok", {})] * 2, site_ids=ids, mode="on", now=NOW)
    assert store["admin_alerts"] == []


# ── delivery ─────────────────────────────────────────────────────────────────

def alert(store, kind=A.SWEEP_STALE, status="open", opened=None, **kw):
    row = {"id": len(store["admin_alerts"]) + 1, "kind": kind, "severity": "warning", "status": status,
           "opened_at": opened or ago(minutes=30), "resolved_at": None, "detail": {"minutes_ago": 90},
           "notified_at": None, "resolved_notified_at": None, **kw}
    store["admin_alerts"].append(row)
    return row


def deliver(**kw):
    return svc.deliver_pending(now=NOW, mode=kw.pop("mode", "on"), push=kw.pop("push", False), site_url="https://vrm.example.com", **kw)


def test_delivery_emails_the_admin_once(env):
    store, sent = env
    row = alert(store)
    assert deliver()["sent"] == 1
    assert sent[0]["to"] == "info@paulyco.com" and "[VRM Monitor]" in sent[0]["subject"]
    assert "90 minutes ago" in sent[0]["html"] and "https://vrm.example.com/admin/fleet/alerts" in sent[0]["html"]
    assert row["notified_at"] == NOW.isoformat()
    deliver()
    assert len(sent) == 1


def test_recipient_and_language_come_from_the_environment(env, monkeypatch):
    store, sent = env
    monkeypatch.setenv("ADMIN_ALERTS_EMAIL", "ops@example.com")
    monkeypatch.setenv("ADMIN_ALERTS_LANG", "es")
    alert(store)
    deliver()
    assert sent[0]["to"] == "ops@example.com" and "se detuvo" in sent[0]["subject"]


def test_off_and_dry_run_send_nothing(env):
    store, sent = env
    alert(store)
    assert deliver(mode="off")["sent"] == 0 and deliver(mode="dry_run")["sent"] == 0 and not sent


def test_a_condition_must_persist_before_it_is_announced(env):
    store, sent = env
    fresh = alert(store, kind=A.FLEET_OFFLINE, opened=ago(minutes=3))      # a single noisy sweep
    deliver()
    assert not sent and fresh["notified_at"] is None
    fresh["opened_at"] = ago(minutes=12)                                    # still open a sweep later
    deliver()
    assert len(sent) == 1


def test_back_to_normal_notice_only_follows_a_real_notice(env):
    store, sent = env
    never = alert(store, status="resolved", resolved_at=ago(minutes=5))      # resolved before it was ever announced
    deliver()
    assert not sent and never["resolved_notified_at"] is None
    told = alert(store, kind=A.HISTORY_STALE, status="resolved", resolved_at=ago(minutes=5), notified_at=ago(hours=1))
    deliver()
    assert len(sent) == 1 and "up to date" in sent[0]["subject"]
    assert told["resolved_notified_at"] == NOW.isoformat()


def test_cooldown_suppresses_a_flapping_alert(env):
    store, sent = env
    alert(store, status="resolved", notified_at=ago(minutes=50), resolved_at=ago(minutes=40), resolved_notified_at=ago(minutes=39))
    again = alert(store)
    out = deliver()
    assert out["suppressed"] == 1 and not sent and again["notified_at"] == NOW.isoformat()


def test_claim_is_released_when_nothing_gets_through(env, monkeypatch):
    store, sent = env
    row = alert(store)
    def boom(*a, **k): raise RuntimeError("smtp down")
    monkeypatch.setattr(svc, "mailer_send", boom)
    assert deliver()["failed"] == 1 and row["notified_at"] is None
    monkeypatch.setattr(svc, "mailer_send", lambda to, subject, html, **kw: sent.append(subject))
    assert deliver()["sent"] == 1


def test_push_goes_to_admin_devices_when_enabled(env, monkeypatch):
    store, sent = env
    store["push_subscriptions"] = [{"id": 1, "endpoint": "https://fcm.googleapis.com/x", "p256dh": "k", "auth": "a",
                                    "failure_count": 0, "admin_email": "me@example.com", "customer_id": None}]
    pushes = []
    monkeypatch.setattr(ap, "send_one", lambda sub, payload, urgency="normal": pushes.append(payload) or "ok")
    alert(store, kind=A.SWEEP_STALE, severity="critical")
    out = deliver(push=True)
    assert out["pushed"] == 1 and pushes[0]["url"] == "/admin/fleet/alerts" and pushes[0]["severity"] == "critical"

"""vrm_api/alerts_push.py — endpoint safety, send outcomes, bookkeeping. No network, no pywebpush."""
import json
from datetime import datetime, timezone

import pytest

from vrm_api import alerts_push as ap

NOW = datetime(2026, 10, 5, 18, 0, tzinfo=timezone.utc)


# ── endpoint allow-list (SSRF guard) ────────────────────────────────────
@pytest.mark.parametrize("url", [
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://fcm.googleapis.com/wp/xyz",
    "https://web.push.apple.com/QAbc",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
    "https://api.push.apple.com/3/device/abc",
])
def test_real_push_services_are_allowed(url):
    assert ap.endpoint_allowed(url)


@pytest.mark.parametrize("url", [
    "", "not a url", "http://fcm.googleapis.com/fcm/send/x",             # not https
    "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.5/x", "https://evil.com/x",
    "https://fcm.googleapis.com.evil.com/x",                              # lookalike suffix
    "https://evilfcm.googleapis.com.attacker.io/x",
    "https://fcm.googleapis.com@evil.com/x",                              # userinfo trick: real host is evil.com
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://notpush.apple.com.evil.com/x",
])
def test_everything_else_is_refused(url):
    assert not ap.endpoint_allowed(url)


def test_a_suffix_must_be_a_real_subdomain_boundary():
    assert ap.endpoint_allowed("https://x.notify.windows.com/x")
    assert not ap.endpoint_allowed("https://fakenotify.windows.com/x")        # ends with the text but is not a subdomain
    assert not ap.endpoint_allowed("https://evilnotify.windows.com.example/x")


# ── configuration ───────────────────────────────────────────────────────
def test_push_is_off_unless_switched_on(monkeypatch):
    monkeypatch.delenv("ALERTS_PUSH", raising=False)
    assert not ap.push_enabled()
    monkeypatch.setenv("ALERTS_PUSH", " ON ")
    assert ap.push_enabled()
    monkeypatch.setenv("ALERTS_PUSH", "true")
    assert not ap.push_enabled()


def test_vapid_config(monkeypatch):
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    assert ap.vapid_config() is None
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "  KEY  ")
    monkeypatch.delenv("VAPID_SUBJECT", raising=False)
    assert ap.vapid_config() == ("KEY", "mailto:info@paulyco.com")
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:ops@example.com")
    assert ap.vapid_config() == ("KEY", "mailto:ops@example.com")


# ── send_one outcomes ───────────────────────────────────────────────────
class FakeWebPushException(Exception):
    def __init__(self, status):
        super().__init__(f"status {status}")
        self.response = type("R", (), {"status_code": status})() if status else None


SUB = {"id": 7, "endpoint": "https://fcm.googleapis.com/fcm/send/abc", "p256dh": "PUB", "auth": "AUTH"}


@pytest.fixture
def lib(monkeypatch):
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "PRIV")
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:ops@example.com")
    calls = []
    behaviour = {"raise": None}

    def fake_webpush(**kw):
        calls.append(kw)
        if behaviour["raise"]:
            raise behaviour["raise"]

    monkeypatch.setattr(ap, "_load_pywebpush", lambda: (fake_webpush, FakeWebPushException))
    return calls, behaviour


def test_a_successful_send_is_signed_and_encrypted_for_the_device(lib):
    calls, _ = lib
    assert ap.send_one(SUB, {"title": "Hi"}, urgency="high") == "ok"
    kw = calls[0]
    assert kw["subscription_info"] == {"endpoint": SUB["endpoint"], "keys": {"p256dh": "PUB", "auth": "AUTH"}}
    assert json.loads(kw["data"]) == {"title": "Hi"}
    assert kw["vapid_private_key"] == "PRIV" and kw["vapid_claims"] == {"sub": "mailto:ops@example.com"}
    assert kw["headers"] == {"Urgency": "high"} and kw["ttl"] == ap.TTL_SECONDS


@pytest.mark.parametrize("status,expected", [(410, "gone"), (404, "gone"), (500, "error"), (429, "error"), (None, "error")])
def test_push_service_status_decides_gone_or_retry(lib, status, expected):
    _, behaviour = lib
    behaviour["raise"] = FakeWebPushException(status)
    assert ap.send_one(SUB, {}) == expected


def test_any_other_exception_is_an_error_not_a_crash(lib):
    _, behaviour = lib
    behaviour["raise"] = TimeoutError("slow")
    assert ap.send_one(SUB, {}) == "error"


def test_a_disallowed_endpoint_is_never_contacted(lib):
    calls, _ = lib
    assert ap.send_one({**SUB, "endpoint": "https://169.254.169.254/x"}, {}) == "gone"
    assert calls == []


def test_missing_vapid_key_is_an_error_and_sends_nothing(lib, monkeypatch):
    calls, _ = lib
    monkeypatch.delenv("VAPID_PRIVATE_KEY")
    assert ap.send_one(SUB, {}) == "error" and calls == []


def test_missing_library_is_an_error(monkeypatch):
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "PRIV")
    def boom():
        raise ImportError("no pywebpush")
    monkeypatch.setattr(ap, "_load_pywebpush", boom)
    assert ap.send_one(SUB, {}) == "error"


# ── bookkeeping around deliver() ────────────────────────────────────────
class Q:
    def __init__(self, store, name): self.rows, self.checks, self.op, self.payload = store.setdefault(name, []), [], "select", None
    @property
    def not_(self):
        outer = self
        class N:
            def is_(self, c, v): outer.checks.append(lambda r: r.get(c) is not None); return outer
        return N()
    def select(self, *_): return self
    def update(self, p): self.op, self.payload = "update", p; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, c, v): self.checks.append(lambda r: r.get(c) == v); return self
    def execute(self):
        hit = [r for r in self.rows if all(f(r) for f in self.checks)]
        if self.op == "update":
            [r.update(self.payload) for r in hit]
        elif self.op == "delete":
            for r in hit: self.rows.remove(r)
        return type("Res", (), {"data": [dict(r) for r in hit]})()


class T:
    def __init__(self, store, name): self.s, self.n = store, name
    def select(self, *a): return Q(self.s, self.n).select(*a)
    def update(self, p): return Q(self.s, self.n).update(p)
    def delete(self): return Q(self.s, self.n).delete()


@pytest.fixture
def subs(monkeypatch):
    store = {"push_subscriptions": [
        {"id": 1, "customer_id": "c1", "admin_email": None, "endpoint": "e1", "p256dh": "p", "auth": "a", "failure_count": 0},
        {"id": 2, "customer_id": "c1", "admin_email": None, "endpoint": "e2", "p256dh": "p", "auth": "a", "failure_count": 3},
        {"id": 3, "customer_id": None, "admin_email": "me@x.com", "endpoint": "e3", "p256dh": "p", "auth": "a", "failure_count": 0},
        {"id": 4, "customer_id": "c9", "admin_email": None, "endpoint": "e4", "p256dh": "p", "auth": "a", "failure_count": 0},
    ]}
    monkeypatch.setattr(ap, "_t", lambda name: T(store, name))
    return store


def test_destinations_are_scoped_and_deduplicated(subs):
    assert {d["id"] for d in ap.destinations(customer_id="c1")} == {1, 2}
    assert {d["id"] for d in ap.destinations(customer_id="c1", include_admin_devices=True)} == {1, 2, 3}
    assert {d["id"] for d in ap.destinations(admin_email="me@x.com")} == {3}
    assert {d["id"] for d in ap.destinations(customer_id="c1", admin_email="me@x.com", include_admin_devices=True)} == {1, 2, 3}
    assert ap.destinations() == []


def devices(subs, *ids): return [r for r in subs["push_subscriptions"] if r["id"] in ids]


def test_success_records_it_and_resets_the_failure_count(subs):
    out = ap.deliver(devices(subs, 2), [{"t": 1}], sender=lambda d, p, urgency: "ok", now=NOW)
    row = subs["push_subscriptions"][1]
    assert out["delivered"] == 1 and row["failure_count"] == 0 and row["last_success_at"] == NOW.isoformat()


def test_a_dead_subscription_is_deleted(subs):
    out = ap.deliver(devices(subs, 1), [{}], sender=lambda d, p, urgency: "gone", now=NOW)
    assert out["removed"] == 1 and all(r["id"] != 1 for r in subs["push_subscriptions"])


def test_transient_errors_count_up_then_eventually_drop_the_device(subs):
    out = ap.deliver(devices(subs, 2), [{}], sender=lambda d, p, urgency: "error", now=NOW)
    row = subs["push_subscriptions"][1]
    assert out["failed"] == 1 and row["failure_count"] == 4 and row["last_failure_at"] == NOW.isoformat()
    subs["push_subscriptions"][1]["failure_count"] = ap.MAX_CONSECUTIVE_FAILURES - 1
    out = ap.deliver(devices(subs, 2), [{}], sender=lambda d, p, urgency: "error", now=NOW)
    assert out["removed"] == 1 and all(r["id"] != 2 for r in subs["push_subscriptions"])


def test_a_device_counts_as_delivered_if_any_message_got_through(subs):
    results = iter(["error", "ok"])
    out = ap.deliver(devices(subs, 1), [{"a": 1}, {"b": 2}], sender=lambda d, p, urgency: next(results), now=NOW)
    assert out["delivered"] == 1 and out["failed"] == 0


def test_one_bad_device_does_not_stop_the_others(subs):
    outcomes = {1: "gone", 2: "ok"}
    out = ap.deliver(devices(subs, 1, 2), [{}], sender=lambda d, p, urgency: outcomes[d["id"]], now=NOW)
    assert (out["delivered"], out["removed"]) == (1, 1)

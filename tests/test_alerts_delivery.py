"""vrm_api/alerts_delivery.py against an in-memory fake of the Supabase builder."""
from datetime import datetime, timedelta, timezone

import pytest

from victron import alerts as A
from vrm_api import alerts_delivery as ad
from vrm_api import alerts_service as svc

NOW = datetime(2026, 10, 5, 18, 0, tzinfo=timezone.utc)


def ago(**kw):
    return (NOW - timedelta(**kw)).isoformat()


class Result:
    def __init__(self, data): self.data = data


class Query:
    def __init__(self, store, name):
        self.rows, self.name = store.setdefault(name, []), name
        self.checks, self.op, self.payload = [], "select", None

    @property
    def not_(self):
        outer = self
        class Neg:
            def is_(self, col, val): outer.checks.append(lambda r: r.get(col) is not None); return outer
        return Neg()

    def select(self, *_): self.op = "select"; return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def eq(self, c, v): self.checks.append(lambda r: r.get(c) == v); return self
    def in_(self, c, vs): self.checks.append(lambda r: r.get(c) in vs); return self
    def is_(self, c, v): self.checks.append(lambda r: r.get(c) is None); return self
    def gte(self, c, v): self.checks.append(lambda r: r.get(c) is not None and str(r.get(c)) >= v); return self

    def execute(self):
        matched = [r for r in self.rows if all(f(r) for f in self.checks)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
        return Result([dict(r) for r in matched])


class Table:
    def __init__(self, store, name): self.store, self.name = store, name
    def select(self, *a): return Query(self.store, self.name).select(*a)
    def update(self, p): return Query(self.store, self.name).update(p)


@pytest.fixture
def env(monkeypatch):
    store = {
        "alerts": [], "sites": [{"site_id": "s1", "display_name": "El Encino", "timezone": "America/Costa_Rica"}],
        "customers": [{"id": "c1", "contact_email": "owner@example.com", "auth_email": "login@example.com", "ui_language": "en"}],
    }
    sent = []
    monkeypatch.setattr(ad, "_t", lambda name: Table(store, name))
    monkeypatch.setattr(svc, "_t", lambda name: Table(store, name))          # load_preferences() reads through the service module
    monkeypatch.setattr(ad, "mailer_send", lambda to, subject, html, **kw: sent.append({"to": to, "subject": subject, "html": html}))
    monkeypatch.setenv("ALERTS_EMAIL_TEST_TO", "")
    return store, sent


_ids = iter(range(1, 1000))
def alert(store, kind=A.LOW_BATTERY, status="open", site="s1", severity="warning", detail=None, **kw):
    row = {"id": next(_ids), "customer_id": "c1", "site_id": site, "kind": kind, "severity": severity, "status": status,
           "opened_at": ago(minutes=30), "resolved_at": None, "detail": detail or {"soc_pct": 18.0},
           "notified_at": None, "resolved_notified_at": None, **kw}
    store["alerts"].append(row)
    return row


def run(mode="on", **kw):
    return ad.deliver_pending(now=NOW, mode=mode, site_url="https://vrm.example.com", **kw)


def test_off_sends_nothing(env):
    store, sent = env
    alert(store)
    assert run("off")["sent"] == 0 and not sent


def test_sends_one_email_with_the_site_and_a_deep_link(env):
    store, sent = env
    row = alert(store)
    out = run()
    assert out["sent"] == 1 and len(sent) == 1
    assert sent[0]["to"] == "owner@example.com" and sent[0]["subject"] == "Low battery at El Encino"
    assert "Battery charge is 18%." in sent[0]["html"] and "https://vrm.example.com/app/dashboard/s1" in sent[0]["html"]
    assert row["notified_at"] == NOW.isoformat()


def test_second_run_does_not_resend(env):
    store, sent = env
    alert(store)
    run(); run()
    assert len(sent) == 1


def test_spanish_customer_gets_spanish(env):
    store, sent = env
    store["customers"][0]["ui_language"] = "es"
    alert(store, kind=A.GRID_OUTAGE, detail={"soc_pct": 62.0})
    run()
    assert sent[0]["subject"] == "Corte de red en El Encino"
    assert "(carga: 62%)" in sent[0]["html"]


def test_critical_battery_uses_the_critical_wording(env):
    store, sent = env
    alert(store, severity="critical", detail={"soc_pct": 7.0})
    run()
    assert sent[0]["subject"] == "Battery critically low at El Encino" and "may shut down" in sent[0]["html"]


def test_one_email_per_customer_groups_new_and_resolved(env):
    store, sent = env
    alert(store, kind=A.LOW_BATTERY)
    alert(store, kind=A.SYSTEM_ALARM, detail={"alarms": ["dc_ripple", "overload"]}, severity="critical")
    alert(store, kind=A.SITE_OFFLINE, status="resolved", notified_at=ago(hours=1), resolved_at=ago(minutes=5))
    out = run()
    assert len(sent) == 1 and out["sent"] == 1
    assert sent[0]["subject"] == "3 updates on your systems"
    html = sent[0]["html"]
    assert "New alerts" in html and "Back to normal" in html and "DC ripple, overload" in html and "El Encino is reporting again" in html


def test_resolved_notice_only_if_the_open_was_announced(env):
    store, sent = env
    alert(store, status="resolved", notified_at=None, resolved_at=ago(minutes=5))
    run()
    assert not sent


def test_old_open_alerts_are_marked_handled_without_emailing(env):
    store, sent = env
    row = alert(store, kind=A.SITE_OFFLINE, opened_at=ago(days=77), detail={"last_seen": ago(days=77), "minutes_silent": 111000})
    out = run()
    assert not sent and out["suppressed"] == 1
    assert row["notified_at"] and row["resolved_notified_at"]       # so no "back to normal" follows either
    row.update(status="resolved", resolved_at=ago(minutes=1))
    run()
    assert not sent


def test_flapping_alert_is_suppressed_inside_the_cooldown(env):
    store, sent = env
    alert(store, status="resolved", notified_at=ago(minutes=40), resolved_notified_at=ago(minutes=20), resolved_at=ago(minutes=30))
    alert(store, opened_at=ago(minutes=10))
    out = run()
    assert not sent and out["suppressed"] == 1


def test_cooldown_does_not_apply_to_a_different_site_or_kind(env):
    store, sent = env
    alert(store, kind=A.SITE_OFFLINE, notified_at=ago(minutes=40))
    alert(store, kind=A.LOW_BATTERY)
    run()
    assert len(sent) == 1


def test_failed_send_releases_the_claim_for_retry(env, monkeypatch):
    store, sent = env
    row = alert(store)
    def boom(*a, **k): raise RuntimeError("resend down")
    monkeypatch.setattr(ad, "mailer_send", boom)
    out = run()
    assert out["failed"] == 1 and row["notified_at"] is None
    monkeypatch.setattr(ad, "mailer_send", lambda to, subject, html, **kw: sent.append(to))
    assert run()["sent"] == 1 and row["notified_at"]


def test_overlapping_sweep_that_loses_the_claim_sends_nothing(env, monkeypatch):
    store, sent = env
    alert(store)
    monkeypatch.setattr(ad, "_stamp", lambda *a, **k: [])
    assert run()["sent"] == 0 and not sent


def test_customer_without_a_valid_email_is_left_unsent(env):
    store, sent = env
    store["customers"][0].update(contact_email=None, auth_email="not-an-email")
    row = alert(store)
    run()
    assert not sent and row["notified_at"] is None


def test_contact_email_wins_over_login_email_and_falls_back(env):
    store, sent = env
    store["customers"][0]["contact_email"] = None
    alert(store)
    run()
    assert sent[0]["to"] == "login@example.com"


def test_test_mode_redirects_and_labels(env, monkeypatch):
    store, sent = env
    monkeypatch.setenv("ALERTS_EMAIL_TEST_TO", "me@example.com")
    alert(store)
    run("test")
    assert sent[0]["to"] == "me@example.com" and sent[0]["subject"].startswith("[TEST → owner@example.com] ")


def test_test_mode_without_an_address_sends_nothing(env):
    store, sent = env
    row = alert(store)
    assert run("test")["sent"] == 0 and not sent and row["notified_at"] is None


def test_vrm_link_alert_links_to_my_sites_with_reconnect_button(env):
    store, sent = env
    alert(store, kind=A.VRM_LINK_BROKEN, site=None, severity="critical", detail={})
    run()
    html = sent[0]["html"]
    assert "https://vrm.example.com/app/sites" in html and "Reconnect VRM" in html
    assert sent[0]["subject"] == "Your Victron VRM connection stopped working"


def test_site_offline_time_is_shown_in_site_local_time(env):
    store, sent = env
    alert(store, kind=A.SITE_OFFLINE, detail={"last_seen": "2026-10-05T16:00:00+00:00", "minutes_silent": 120})
    run()
    assert "2026-10-05 10:00" in sent[0]["html"] and "120 minutes" in sent[0]["html"]   # UTC-6


def test_every_kind_has_text_in_both_languages():
    from victron import email_i18n
    for lang in ("en", "es"):
        t = email_i18n.get(lang)
        for kind in A.KINDS:
            assert t[f"alert_{kind}_title"] and t[f"alert_{kind}_resolved"]


# ── email preference + manage link ──────────────────────────────────────
def test_email_off_for_a_kind_suppresses_that_kind_only(env):
    store, sent = env
    store["alert_preferences"] = [{"customer_id": "c1", "kind": A.LOW_BATTERY, "enabled": True, "email": False}]
    muted = alert(store, kind=A.LOW_BATTERY)
    alert(store, kind=A.SITE_OFFLINE, detail={"last_seen": ago(minutes=60), "minutes_silent": 60})
    out = run()
    assert len(sent) == 1 and sent[0]["subject"] == "El Encino stopped reporting"
    assert out["suppressed"] == 1 and muted["notified_at"] and muted["resolved_notified_at"]


def test_email_off_also_silences_the_back_to_normal_notice(env):
    store, sent = env
    store["alert_preferences"] = [{"customer_id": "c1", "kind": A.LOW_BATTERY, "enabled": True, "email": False}]
    alert(store, status="resolved", notified_at=ago(hours=1), resolved_at=ago(minutes=3))
    run()
    assert not sent


def test_email_links_to_the_alert_settings(env):
    store, sent = env
    alert(store)
    run()
    assert 'href="https://vrm.example.com/app/alerts"' in sent[0]["html"] and "Choose which alerts you get" in sent[0]["html"]


def test_a_long_silent_site_first_seen_just_now_is_not_news(env):
    """The real Proyecto JR case: the alert row is brand new, the site has been dark for months."""
    store, sent = env
    row = alert(store, kind=A.SITE_OFFLINE, opened_at=ago(minutes=1),
                detail={"last_seen": ago(days=77), "minutes_silent": 111442})
    out = run()
    assert not sent and out["suppressed"] == 1 and row["notified_at"] and row["resolved_notified_at"]


def test_a_site_that_just_went_quiet_is_still_announced(env):
    store, sent = env
    alert(store, kind=A.SITE_OFFLINE, opened_at=ago(minutes=1), detail={"last_seen": ago(minutes=50), "minutes_silent": 50})
    assert run()["sent"] == 1

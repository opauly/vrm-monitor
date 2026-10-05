"""Rule tests for victron/alerts.py — plain dicts, no database, no clock."""
from datetime import datetime, timedelta, timezone

from victron import alerts as A

NOW = datetime(2026, 10, 5, 18, 0, tzinfo=timezone.utc)
SITE = {"site_id": "s1", "customer_id": "c1", "system_type": "hybrid"}


def snap(minutes_ago=5, soc=80.0, v=120.0, alarms=None, critical=None):
    return {
        "captured_at": (NOW - timedelta(minutes=minutes_ago)).isoformat(),
        "soc_pct": soc,
        "raw": {"IV1": v, "alarms": alarms or {}, "critical_alerts": critical or {}},
    }


def run(snapshot, previous=None, open_kinds=(), site=SITE, imported=True):
    return {c.kind: c for c in A.evaluate_site(
        site=site, snapshot=snapshot, previous=previous, open_kinds=set(open_kinds),
        grid_imported_recently=imported, now=NOW)}


# ── offline ──────────────────────────────────────────────────────────────
def test_never_reported_says_nothing():
    assert A.evaluate_site(site=SITE, snapshot=None, previous=None, open_kinds=set(),
                           grid_imported_recently=True, now=NOW) == []

def test_fresh_site_clears_offline():
    assert run(snap(10))[A.SITE_OFFLINE].active is False

def test_stale_site_raises_offline_only():
    got = run(snap(46, soc=5.0, v=0.0, critical={"temp_fault": True}))
    assert list(got) == [A.SITE_OFFLINE] and got[A.SITE_OFFLINE].active
    assert got[A.SITE_OFFLINE].detail["minutes_silent"] == 46

def test_failed_fetch_falls_back_to_previous_reading_age():
    got = run(None, previous=snap(120))
    assert got[A.SITE_OFFLINE].active

def test_failed_fetch_with_recent_previous_is_not_offline():
    assert run(None, previous=snap(10))[A.SITE_OFFLINE].active is False


# ── low battery ──────────────────────────────────────────────────────────
def test_low_battery_opens_at_threshold_and_is_critical_at_10():
    assert run(snap(soc=20.0))[A.LOW_BATTERY].severity == A.WARNING
    assert run(snap(soc=10.0))[A.LOW_BATTERY].severity == A.CRITICAL
    assert run(snap(soc=21.0))[A.LOW_BATTERY].active is False

def test_low_battery_hysteresis_holds_until_25():
    assert run(snap(soc=23.0), open_kinds={A.LOW_BATTERY})[A.LOW_BATTERY].active is True
    assert run(snap(soc=26.0), open_kinds={A.LOW_BATTERY})[A.LOW_BATTERY].active is False
    assert run(snap(soc=23.0))[A.LOW_BATTERY].active is False  # not open: needs <=20

def test_no_soc_means_unknown():
    assert A.LOW_BATTERY not in run(snap(soc=None))


# ── grid outage ──────────────────────────────────────────────────────────
def test_grid_outage_needs_recent_grid_import():
    assert A.GRID_OUTAGE not in run(snap(v=0.0), imported=False)   # never-grid site: dead input is normal
    assert run(snap(v=0.0), imported=True)[A.GRID_OUTAGE].active

def test_off_grid_sites_never_alert_on_grid():
    assert A.GRID_OUTAGE not in run(snap(v=0.0), site={**SITE, "system_type": "off_grid"})

def test_grid_back_resolves():
    assert run(snap(v=121.0))[A.GRID_OUTAGE].active is False

def test_input_relay_open_but_voltage_present_is_not_an_outage():
    # the Vista Atenas M1/M2 case: AI=240 (relay open) while the grid is live
    s = snap(v=122.0)
    s["raw"]["AI"] = 240.0
    assert run(s)[A.GRID_OUTAGE].active is False

def test_partial_bucket_hysteresis():
    assert A.GRID_OUTAGE not in run(snap(v=80.0))                                  # dip, not an outage
    assert run(snap(v=59.0))[A.GRID_OUTAGE].active
    assert run(snap(v=80.0), open_kinds={A.GRID_OUTAGE})[A.GRID_OUTAGE].active     # holds in the band
    assert run(snap(v=101.0), open_kinds={A.GRID_OUTAGE})[A.GRID_OUTAGE].active is False

def test_second_leg_counts():
    s = snap(v=0.0)
    s["raw"]["IV2"] = 118.0
    assert run(s)[A.GRID_OUTAGE].active is False   # one leg still live

def test_no_voltage_signal_means_unknown():
    s = snap()
    del s["raw"]["IV1"]
    assert A.GRID_OUTAGE not in run(s)

def test_grid_outage_detail_carries_soc():
    assert run(snap(v=0.0, soc=62.0))[A.GRID_OUTAGE].detail["soc_pct"] == 62.0


# ── system alarms ────────────────────────────────────────────────────────
def test_critical_alert_is_raised_immediately():
    got = run(snap(critical={"temp_fault": True}))[A.SYSTEM_ALARM]
    assert got.active and got.severity == A.CRITICAL and got.detail["alarms"] == ["temp_fault"]

def test_overload_needs_two_consecutive_sweeps():
    assert A.SYSTEM_ALARM not in run(snap(alarms={"overload": True}), previous=snap(20))
    got = run(snap(alarms={"overload": True}), previous=snap(20, alarms={"overload": True}))[A.SYSTEM_ALARM]
    assert got.active and got.severity == A.WARNING

def test_open_alarm_stays_open_on_single_sighting():
    assert run(snap(alarms={"overload": True}), previous=snap(20), open_kinds={A.SYSTEM_ALARM})[A.SYSTEM_ALARM].active

def test_vrm_low_battery_alarm_is_ignored_in_favour_of_soc_rule():
    assert run(snap(alarms={"low_battery": True}))[A.SYSTEM_ALARM].active is False

def test_all_clear_resolves_alarms():
    assert run(snap())[A.SYSTEM_ALARM].active is False


# ── vrm link ─────────────────────────────────────────────────────────────
def cust(**kw):
    return {"id": "c1", "vrm_token_secret_id": "sec", "vrm_token_revoked_at": None, "vrm_token_last_error": None, **kw}

def test_link_broken_requires_revoked_and_error():
    assert A.evaluate_customer(customer=cust(vrm_token_revoked_at="2026-10-01T00:00:00Z",
                                             vrm_token_last_error="auth")).active
    # deliberate Disconnect: revoked but no recorded failure
    assert not A.evaluate_customer(customer=cust(vrm_token_revoked_at="2026-10-01T00:00:00Z")).active
    assert not A.evaluate_customer(customer=cust()).active

def test_customer_without_vrm_token_is_not_evaluated():
    assert A.evaluate_customer(customer=cust(vrm_token_secret_id=None)) is None


# ── reconcile ────────────────────────────────────────────────────────────
def C(kind, active=True, sev=A.WARNING, **detail):
    return A.Condition(kind, "c1", "s1", active, sev, detail)

def open_row(kind, sev=A.WARNING, **detail):
    return {"customer_id": "c1", "site_id": "s1", "kind": kind, "severity": sev, "detail": detail}

def test_reconcile_opens_resolves_escalates_updates():
    t = A.reconcile(
        [C(A.LOW_BATTERY, soc_pct=8), C(A.SITE_OFFLINE, active=False), C(A.GRID_OUTAGE, soc_pct=50),
         C(A.SYSTEM_ALARM, sev=A.CRITICAL, alarms=["x"]), C(A.VRM_LINK_BROKEN, active=False)],
        [open_row(A.SITE_OFFLINE), open_row(A.GRID_OUTAGE, soc_pct=60), open_row(A.SYSTEM_ALARM, alarms=["x"])],
    )
    assert [c.kind for c in t.opened] == [A.LOW_BATTERY]
    assert [r["kind"] for r in t.resolved] == [A.SITE_OFFLINE]
    assert [c.kind for _, c in t.updated] == [A.GRID_OUTAGE]
    assert [c.kind for _, c in t.escalated] == [A.SYSTEM_ALARM]

def test_reconcile_leaves_unmentioned_open_alerts_alone():
    t = A.reconcile([], [open_row(A.LOW_BATTERY)])
    assert not (t.opened or t.resolved or t.updated or t.escalated)

def test_customer_level_key_has_empty_site():
    c = A.Condition(A.VRM_LINK_BROKEN, "c1", None, True)
    assert A.reconcile([c], [{"customer_id": "c1", "site_id": None, "kind": A.VRM_LINK_BROKEN,
                              "severity": A.WARNING, "detail": {}}]).opened == []

"""victron/admin_alerts.py — the admin fleet-health rules (pure)."""
from datetime import datetime, timedelta, timezone

from victron import admin_alerts as A

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)


def site(name, minutes_ago):
    return {"site_id": name, "name": name, "captured_at": (NOW - timedelta(minutes=minutes_ago)).isoformat()}


def fleet(offline, online=8, standing=0):
    return ([site(f"off{i}", 120) for i in range(offline)] + [site(f"on{i}", 5) for i in range(online)]
            + [site(f"dead{i}", 60 * 24 * 30) for i in range(standing)])


def one(conds, kind):
    return next((c for c in conds if c.kind == kind), None)


# ── fleet_offline ────────────────────────────────────────────────────────────

def test_few_silent_sites_are_not_a_fleet_event():
    c = one(A.evaluate_fleet_offline(sites=fleet(offline=2), now=NOW, open_kinds=set()), A.FLEET_OFFLINE)
    assert c.active is False


def test_many_silent_at_once_opens_with_names():
    c = one(A.evaluate_fleet_offline(sites=fleet(offline=4), now=NOW, open_kinds=set()), A.FLEET_OFFLINE)
    assert c.active and c.severity == A.WARNING
    assert c.detail["offline"] == 4 and c.detail["total"] == 12 and c.detail["sites"][0] == "off0"


def test_half_the_fleet_is_critical():
    c = one(A.evaluate_fleet_offline(sites=fleet(offline=6, online=5), now=NOW, open_kinds=set()), A.FLEET_OFFLINE)
    assert c.active and c.severity == A.CRITICAL


def test_long_dead_sites_are_a_standing_condition_not_an_event():
    # Three abandoned installs + a healthy fleet: nothing to announce.
    c = one(A.evaluate_fleet_offline(sites=fleet(offline=0, online=8, standing=3), now=NOW, open_kinds=set()), A.FLEET_OFFLINE)
    assert c.active is False


def test_hysteresis_keeps_it_open_until_clearly_better():
    # 2 of 12 silent (17%) — below the open threshold but above resolve: stays open.
    held = one(A.evaluate_fleet_offline(sites=fleet(offline=2), now=NOW, open_kinds={A.FLEET_OFFLINE}), A.FLEET_OFFLINE)
    assert held.active
    gone = one(A.evaluate_fleet_offline(sites=fleet(offline=1), now=NOW, open_kinds={A.FLEET_OFFLINE}), A.FLEET_OFFLINE)
    assert gone.active is False


def test_tiny_fleets_say_nothing():
    assert A.evaluate_fleet_offline(sites=fleet(offline=2, online=0), now=NOW, open_kinds=set()) == []


# ── fetch_failing ────────────────────────────────────────────────────────────

def test_fetch_failing_needs_enough_attempts():
    assert A.evaluate_fetch_failing(attempted=3, failed=3, open_kinds=set()) == []


def test_fetch_failing_opens_at_half_and_resolves_below_a_quarter():
    assert A.evaluate_fetch_failing(attempted=10, failed=5, open_kinds=set())[0].active
    assert not A.evaluate_fetch_failing(attempted=10, failed=4, open_kinds=set())[0].active
    # Open already: 3 of 10 (30%) holds, 2 of 10 resolves.
    assert A.evaluate_fetch_failing(attempted=10, failed=3, open_kinds={A.FETCH_FAILING})[0].active
    assert not A.evaluate_fetch_failing(attempted=10, failed=2, open_kinds={A.FETCH_FAILING})[0].active
    assert A.evaluate_fetch_failing(attempted=10, failed=9, open_kinds=set())[0].severity == A.CRITICAL


# ── freshness ────────────────────────────────────────────────────────────────

def fresh(snapshot_minutes_ago=5, energy_day="2026-10-05", open_kinds=frozenset()):
    return A.evaluate_freshness(
        newest_snapshot_at=(NOW - timedelta(minutes=snapshot_minutes_ago)).isoformat() if snapshot_minutes_ago is not None else None,
        newest_energy_date=energy_day, now=NOW, open_kinds=set(open_kinds))


def test_healthy_fleet_raises_nothing():
    conds = fresh()
    assert not one(conds, A.SWEEP_STALE).active and not one(conds, A.HISTORY_STALE).active


def test_dead_sweep_warns_then_goes_critical():
    assert one(fresh(snapshot_minutes_ago=50), A.SWEEP_STALE).severity == A.WARNING
    c = one(fresh(snapshot_minutes_ago=4 * 60), A.SWEEP_STALE)
    assert c.active and c.severity == A.CRITICAL and c.detail["minutes_ago"] == 240


def test_one_missed_run_is_not_a_dead_sweep():
    assert not one(fresh(snapshot_minutes_ago=32), A.SWEEP_STALE).active


def test_sweep_stale_resolves_only_once_clearly_recent():
    assert one(fresh(snapshot_minutes_ago=40, open_kinds={A.SWEEP_STALE}), A.SWEEP_STALE).active
    assert not one(fresh(snapshot_minutes_ago=10, open_kinds={A.SWEEP_STALE}), A.SWEEP_STALE).active


def test_history_waits_for_the_morning_sync():
    # Before the day's sync the newest day is already 2 days old: not an alarm.
    assert not one(fresh(energy_day="2026-10-04"), A.HISTORY_STALE).active
    c = one(fresh(energy_day="2026-10-03"), A.HISTORY_STALE)
    assert c.active and c.detail == {"newest_day": "2026-10-03", "days_behind": 3}


def test_unknown_data_leaves_alerts_alone():
    assert A.evaluate_freshness(newest_snapshot_at=None, newest_energy_date=None, now=NOW, open_kinds={A.SWEEP_STALE}) == []


# ── reconcile ────────────────────────────────────────────────────────────────

def test_reconcile_opens_escalates_updates_resolves():
    open_rows = [{"id": 1, "kind": A.SWEEP_STALE, "severity": "warning", "detail": {"minutes_ago": 50}},
                 {"id": 2, "kind": A.HISTORY_STALE, "severity": "warning", "detail": {}},
                 {"id": 3, "kind": A.FETCH_FAILING, "severity": "warning", "detail": {"failed": 5, "attempted": 8}}]
    conds = [A.Condition(A.SWEEP_STALE, True, A.CRITICAL, {"minutes_ago": 300}),
             A.Condition(A.HISTORY_STALE, False),
             A.Condition(A.FETCH_FAILING, True, A.WARNING, {"failed": 6, "attempted": 8}),
             A.Condition(A.FLEET_OFFLINE, True, A.WARNING, {"offline": 4})]
    t = A.reconcile(conds, open_rows)
    assert [c.kind for c in t.opened] == [A.FLEET_OFFLINE]
    assert [e["id"] for e, _ in t.escalated] == [1]
    assert [e["id"] for e, _ in t.updated] == [3]
    assert [r["id"] for r in t.resolved] == [2]

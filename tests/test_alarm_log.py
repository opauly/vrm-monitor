"""Victron's alarm log: which records count, the overload alert, and the repeated-warning patterns."""
from datetime import datetime, timedelta, timezone

from victron import alarm_log as L
from victron import alerts as A
from victron.vrm_live import check_live_alarms
from vrm_api import alarm_log_service as svc

NOW = datetime(2026, 10, 15, 18, 0, tzinfo=timezone.utc)


def rec(description, state="Alarm", *, ago_min=0, seconds=30, device="VE.Bus System", active=0, id_=None):
    started = int((NOW - timedelta(minutes=ago_min)).timestamp())
    return {"idAlarm": id_ or started, "description": description, "nameEnum": state, "started": started,
            "cleared": None if active else started + seconds, "isActive": active, "device": device, "customName": ""}


def days(n, **kw):
    return rec(kw.pop("description"), ago_min=n * 1440, **kw)


# ── what counts ──────────────────────────────────────────────────────────
def test_classification():
    c = L.classify
    assert c("Overload L1", "Alarm") == "overload" and c("Overload L2", "Alarm") == "overload"
    assert c("Overload L1", "Warning") is None                  # the tolerated stage is not an alarm
    assert c("Error code", "#26 - Charger terminal overheated") == "temperature"
    assert c("Error code", "#67 - No BMS") == "bms"
    assert c("Error code", "#2 - Battery voltage too high") == "charger_error"
    assert c("AC-Input", "Not available") == "grid_input" and c("Grid alarm", "Grid lost") == "grid_input"
    assert c("VE.Bus Error", "VE.Bus Error 10: System time synchronisation problem occurred") == "vebus_error"
    assert c("Low battery", "Alarm") == "low_battery" and c("Temperature L1", "Alarm") == "temperature"
    assert c("High charge current alarm", "Alarm") == "high_current" and c("Module0 High Discharge Current", "Alarm") == "high_current"
    assert c("Module0 Low Voltage", "Alarm") == "battery_voltage" and c("BMS lost", "Alarm") == "bms"
    assert c("State of charge", None) is None and c("No data alarm, last data received on 2026-09-16", None) is None


def test_parse_reads_newest_first_and_skips_noise():
    events = L.parse({"records": [rec("Overload L1", ago_min=500), rec("State of charge", None, ago_min=100), rec("Overload L1", ago_min=5)]})
    assert [e.category for e in events] == ["overload", "overload"] and events[0].started > events[1].started
    assert events[0].seconds == 30 and L.parse({"records": None}) == [] and L.parse(None) == []


# ── the overload alert ───────────────────────────────────────────────────
def test_a_recent_overload_alarm_is_reported_an_old_one_is_not():
    now = L.recent_overload(L.parse({"records": [rec("Overload L1", ago_min=20, seconds=32)]}), NOW)
    assert now and now["seconds"] == 32 and now["count"] == 1
    assert L.recent_overload(L.parse({"records": [rec("Overload L1", ago_min=300)]}), NOW) is None
    assert L.recent_overload(L.parse({"records": [rec("Overload L1", ago_min=300, active=1)]}), NOW) is not None   # still going


SITE = {"site_id": "s1", "customer_id": "c1", "system_type": "hybrid"}


def evaluate(events, **kw):
    snap = {"captured_at": (NOW - timedelta(minutes=5)).isoformat(), "soc_pct": 80.0, "raw": {"IV1": 120.0, "alarms": {}, "critical_alerts": {}}}
    return {c.kind: c for c in A.evaluate_site(site=SITE, snapshot=snap, previous=snap, open_kinds=set(), grid_imported_recently=True,
                                               now=NOW, alarm_events=events, **kw)}


def test_overload_in_the_official_log_opens_a_system_alarm_with_the_details():
    got = evaluate(L.parse({"records": [rec("Overload L1", ago_min=12, seconds=31)]}))[A.SYSTEM_ALARM]
    assert got.active and got.detail["alarms"] == ["overload"] and got.detail["overload_log"]["seconds"] == 31


def test_no_overload_in_the_log_means_no_alarm():
    assert evaluate(L.parse({"records": [rec("Overload L1", ago_min=600)]}))[A.SYSTEM_ALARM].active is False
    assert evaluate(None)[A.SYSTEM_ALARM].active is False


def test_other_log_alarms_never_open_an_alert():
    got = evaluate(L.parse({"records": [rec("Error code", "#26 - Charger terminal overheated", ago_min=5), rec("Low battery", ago_min=5)]}))
    assert got[A.SYSTEM_ALARM].active is False


# ── the live reading: only the Alarm state counts ───────────────────────
def test_a_live_overload_warning_is_not_an_alarm():
    def live(value):
        return check_live_alarms({"records": [{"code": "eO1", "rawValue": value}, {"code": "eO2", "rawValue": 0}]})["overload"]["active"]
    assert live(0) is False and live(1) is False and live(2) is True


# ── repeated warnings ────────────────────────────────────────────────────
def test_three_overloads_in_two_weeks_is_a_pattern_two_is_not():
    two = L.parse({"records": [days(1, description="Overload L1"), days(5, description="Overload L1")]})
    three = L.parse({"records": [days(1, description="Overload L1"), days(5, description="Overload L2"), days(9, description="Overload L1")]})
    assert L.patterns(two, NOW) == []
    got = L.patterns(three, NOW)
    assert [(p["category"], p["count"], p["window_days"]) for p in got] == [("overload", 3, 14)]


def test_alarms_minutes_apart_are_one_episode_and_old_ones_fall_out():
    burst = [rec("Overload L1", ago_min=1440 * 3 + 10), rec("Overload L1", ago_min=1440 * 3 + 6), rec("Overload L1", ago_min=1440 * 3)]
    assert L.patterns(L.parse({"records": burst}), NOW) == []                         # one episode
    old = [days(20, description="Overload L1"), days(21, description="Overload L1"), days(22, description="Overload L1")]
    assert L.patterns(L.parse({"records": old}), NOW) == []                           # outside the window


def test_overheating_needs_only_two_and_keeps_victrons_wording():
    events = L.parse({"records": [days(2, description="Error code", state="#26 - Charger terminal overheated", device="Solar Charger"),
                                  days(6, description="Error code", state="#26 - Charger terminal overheated", device="Solar Charger")]})
    got = L.patterns(events, NOW)
    assert got[0]["category"] == "temperature" and got[0]["device"] == "Solar Charger" and "overheated" in got[0]["detail"]


def test_an_off_grid_site_does_not_count_its_generator_as_grid_dropouts():
    events = L.parse({"records": [days(n, description="AC-Input", state="Not available") for n in (1, 3, 5, 7)]})
    assert [p["category"] for p in L.patterns(events, NOW)] == ["grid_input"]
    assert L.patterns(events, NOW, off_grid=True) == []


# ── the stored side ──────────────────────────────────────────────────────
class Fake:
    def __init__(self, rows=None):
        self.rows, self.upserts, self.deleted, self._op = rows or [], [], [], None

    def __call__(self, name):
        assert name == "site_alarm_patterns"
        return self

    def select(self, *_): self._op = "select"; return self
    def in_(self, *_): return self
    def delete(self): self._op = "delete"; self._where = {}; return self
    def eq(self, column, value): self._where[column] = value; return self
    def upsert(self, rows, on_conflict=None): self.upserts = rows; return self

    def execute(self):
        if self._op == "delete":
            self.deleted.append(dict(self._where))
        class R: pass
        r = R(); r.data = list(self.rows) if self._op == "select" else []
        return r


def test_a_pass_stores_patterns_and_removes_ones_that_stopped(monkeypatch):
    fake = Fake(rows=[{"site_id": "s1", "category": "bms"}])
    monkeypatch.setattr(svc, "_t", fake)
    log = {"records": [days(1, description="Overload L1"), days(5, description="Overload L1"), days(9, description="Overload L1")]}
    events = svc.run_pass([{"site_id": "s1"}, {"site_id": "s2"}], {"s1": log}, now=NOW)
    assert set(events) == {"s1"} and [r["category"] for r in fake.upserts] == ["overload"]
    assert fake.deleted == [{"site_id": "s1", "category": "bms"}]


def test_a_missing_table_still_returns_the_events(monkeypatch):
    def broken(_name):
        raise RuntimeError("relation does not exist")
    monkeypatch.setattr(svc, "_t", broken)
    assert len(svc.run_pass([{"site_id": "s1"}], {"s1": {"records": [rec("Overload L1")]}}, now=NOW)["s1"]) == 1


# ── what the health score and the report count ──────────────────────────
from zoneinfo import ZoneInfo

ZONE = ZoneInfo("America/Guatemala")
LABELS = {"low_battery": "Low Battery Alarm", "overload": "Overload Alarm"}


def scored(records, start=datetime(2026, 10, 10, tzinfo=ZONE), end=datetime(2026, 10, 16, tzinfo=ZONE)):
    return L.scored_events(L.parse({"records": records}), site_id="s1", labels=LABELS, zone=ZONE, start=start, end=end)


def test_only_real_alarms_are_scored_and_a_trip_with_its_retry_is_one_episode():
    got = scored([rec("Overload L1", ago_min=1440 * 3 + 4), rec("Overload L1", ago_min=1440 * 3),     # a trip and its retry
                  rec("Overload L1", "Warning", ago_min=1440 * 2),                                    # the tolerated stage: not scored
                  rec("Low battery", ago_min=1440, seconds=19),
                  rec("Error code", "#26 - Charger terminal overheated", ago_min=1440 * 2)])           # a repeat-warning kind, never scored
    assert [(e["alarm"], e["severity"]) for e in got] == [("Overload Alarm", "WARNING"), ("Overload Alarm", "CLEARED"),
                                                          ("Low Battery Alarm", "WARNING"), ("Low Battery Alarm", "CLEARED")]
    assert all(e["site_id"] == "s1" and e["source"] in ("overload", "low_battery") for e in got)
    assert got[0]["timestamp"].endswith("-06:00")                                  # the site's own clock, as the series path stored it


def test_alarms_outside_the_window_and_still_active_ones():
    assert scored([days(30, description="Overload L1")]) == []
    active = scored([rec("Low battery", ago_min=30, active=1)])
    assert [e["severity"] for e in active] == ["WARNING"]                           # no CLEARED while it is still going

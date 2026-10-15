"""vrm_api/insights_service.py and /v1/insights against an in-memory fake Supabase."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from victron import insight_ai
from vrm_api import insights_service as svc
from vrm_api.main import app

NOW = datetime(2026, 10, 6, 15, 0, tzinfo=timezone.utc)


class Result:
    def __init__(self, data): self.data = data


class Query:
    def __init__(self, store, name):
        self.rows, self.checks, self.op, self.payload = store.setdefault(name, []), [], "select", None

    def select(self, *_): self.op = "select"; return self
    def insert(self, p): self.op, self.payload = "insert", p; return self
    def update(self, p): self.op, self.payload = "update", p; return self
    def eq(self, c, v): self.checks.append(lambda r: r.get(c) == v); return self
    def in_(self, c, vs): self.checks.append(lambda r: r.get(c) in vs); return self
    def gte(self, c, v): self.checks.append(lambda r: str(r.get(c)) >= v); return self
    def is_(self, c, v): self.checks.append(lambda r: r.get(c) is None); return self

    def execute(self):
        if self.op == "insert":
            self.rows.append({"id": len(self.rows) + 1, **self.payload})
            return Result([self.payload])
        matched = [r for r in self.rows if all(f(r) for f in self.checks)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
        return Result([dict(r) for r in matched])


def day(date, pv=20.0):
    return {"id": 1, "site_id": "s1", "date": date, "pv_kwh": pv, "load_kwh": 15.0, "grid_kwh": 3.0, "grid_export_kwh": 0.0, "min_soc": 60.0,
            "max_soc": 100.0, "outage_minutes": 0, "outage_count": 0, "complete_day": True, "battery_reached_float": True}


@pytest.fixture
def db(monkeypatch):
    store = {
        "sites": [{"site_id": "s1", "display_name": "El Encino", "system_type": "hybrid", "pv_kwp": 5.0, "battery_usable_kwh": 10.0,
                   "customer_id": "c1", "timezone": "America/Costa_Rica", "source": "vrm_api", "active": True},
                  {"site_id": "s2", "display_name": "Other", "system_type": "hybrid", "pv_kwp": 5.0, "battery_usable_kwh": 10.0,
                   "customer_id": "c2", "timezone": None, "source": "vrm_api", "active": True}],
        "energy_daily": [day(f"2026-10-0{i}") for i in range(1, 5)] + [day("2026-10-05", pv=8.0)],
        "daily_health": [], "site_anomalies": [], "alerts": [],
        "site_snapshots": [{"site_id": "s1", "captured_at": (NOW - timedelta(minutes=3)).isoformat(), "soc_pct": 80.0},
                           {"site_id": "s2", "captured_at": (NOW - timedelta(minutes=3)).isoformat(), "soc_pct": 70.0}],
        "ai_summaries": [],
    }
    monkeypatch.setattr(svc, "_t", lambda name: Query(store, name))
    monkeypatch.delenv("INSIGHTS_AI", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    return store


def test_off_by_default_and_rejects_garbage(monkeypatch):
    assert svc.insights_mode() == "off"
    monkeypatch.setenv("INSIGHTS_AI", " ON ")
    assert svc.insights_mode() == "on"
    monkeypatch.setenv("INSIGHTS_AI", "maybe")
    assert svc.insights_mode() == "off"


def test_off_produces_and_stores_nothing(db):
    assert svc.site_summary("s1", "en", now=NOW, mode="off") == {"enabled": False}
    assert svc.fleet_summary(None, "en", now=NOW, mode="off") == {"enabled": False}
    assert db["ai_summaries"] == [] and svc.generate_daily(now=NOW, mode="off")["sites"] == 0


def test_template_mode_writes_the_plain_summary_and_stores_it_with_its_facts(db):
    out = svc.site_summary("s1", "en", now=NOW, mode="template")
    assert out["enabled"] and out["source"] == "template" and out["headline"].startswith("Yesterday: 8 kWh of solar")
    assert out["points"][0].startswith("Solar made 8 kWh") and out["date"] == "2026-10-05"
    row = db["ai_summaries"][0]
    assert row["scope"] == "site" and row["site_id"] == "s1" and row["facts"]["day"]["pv_kwh"] == 8.0


def test_a_fresh_cached_summary_is_served_without_recomputing(db, monkeypatch):
    svc.site_summary("s1", "en", now=NOW, mode="template")
    monkeypatch.setattr(svc, "site_facts_for", lambda *a, **k: pytest.fail("should have served the cache"))
    assert svc.site_summary("s1", "en", now=NOW + timedelta(hours=2), mode="template")["enabled"]
    assert len(db["ai_summaries"]) == 1


def test_a_stale_one_is_regenerated_in_place_and_languages_are_separate(db):
    svc.site_summary("s1", "en", now=NOW, mode="template")
    svc.site_summary("s1", "es", now=NOW, mode="template")
    assert len(db["ai_summaries"]) == 2
    svc.site_summary("s1", "en", now=NOW + timedelta(hours=7), mode="template")
    assert len(db["ai_summaries"]) == 2 and db["ai_summaries"][0]["created_at"] == (NOW + timedelta(hours=7)).isoformat()
    assert svc.site_summary("s1", "es", now=NOW, mode="template", force=True)["headline"].startswith("Ayer")


def test_unknown_or_non_vrm_site_is_none(db):
    assert svc.site_summary("nope", "en", now=NOW, mode="template") is None
    db["sites"][0]["source"] = "csv_upload"
    assert svc.site_summary("s1", "en", now=NOW, mode="template") is None


def test_fleet_summaries_are_scoped_to_the_customer_or_all_sites(db):
    db["energy_daily"] += [{**day(f"2026-10-0{i}"), "id": 10 + i, "site_id": "s2"} for i in range(1, 6)]
    mine = svc.fleet_summary("c1", "en", now=NOW, mode="template")
    everyone = svc.fleet_summary(None, "en", now=NOW, mode="template")
    assert mine["headline"].startswith("1 sites made 8 kWh") and everyone["headline"].startswith("2 sites made")
    assert {(r["scope"], r["customer_id"]) for r in db["ai_summaries"]} == {("fleet", "c1"), ("fleet", None)}


def test_on_mode_uses_the_model_text_only_when_it_passes_the_guard(db, monkeypatch):
    good = {"headline": "Yesterday: 8 kWh of solar and 15 kWh used.", "points": [], "suggestion": None}
    monkeypatch.setattr(insight_ai, "generate", lambda facts, lang, scope, today=None: {**good, "source": "ai", "model": "m"})
    out = svc.site_summary("s1", "en", now=NOW, mode="on")
    assert out["source"] == "ai" and db["ai_summaries"][0]["model"] == "m"


def test_daily_job_covers_every_site_customer_and_the_admin_fleet_in_both_languages(db):
    counts = svc.generate_daily(now=NOW, mode="template")
    assert counts == {"mode": "template", "sites": 4, "fleets": 6, "failed": 0}     # 2 sites x 2 langs; (c1, c2, all) x 2 langs
    assert len(db["ai_summaries"]) == 10


def test_one_failing_site_does_not_stop_the_rest(db, monkeypatch):
    real = svc.site_summary
    def flaky(site_id, lang, **kw):
        if site_id == "s1":
            raise RuntimeError("boom")
        return real(site_id, lang, **kw)
    monkeypatch.setattr(svc, "site_summary", flaky)
    counts = svc.generate_daily(now=NOW, mode="template")
    assert counts["failed"] == 2 and counts["sites"] == 2


# ── router ───────────────────────────────────────────────────────────────

client = TestClient(app)


@pytest.fixture
def key(monkeypatch):
    monkeypatch.setenv("PIPELINE_API_KEY", "secret-key")
    return {"Authorization": "Bearer secret-key"}


def test_router_needs_the_pipeline_key():
    assert client.get("/v1/insights/site?site_id=s1").status_code in (401, 403)
    assert client.post("/v1/insights/generate-daily").status_code in (401, 403)


def test_router_returns_the_service_result(db, key, monkeypatch):
    monkeypatch.setenv("INSIGHTS_AI", "template")
    r = client.get("/v1/insights/site?site_id=s1&lang=es", headers=key)
    assert r.status_code == 200 and r.json()["enabled"] and "8 kWh de solar" in r.json()["headline"] and r.json()["source"] == "template"
    assert client.get("/v1/insights/site?site_id=nope", headers=key).status_code == 404
    assert client.get("/v1/insights/fleet?lang=en&customer_id=c1", headers=key).json()["enabled"]
    db["ai_summaries"].clear()
    assert client.post("/v1/insights/generate-daily", headers=key).json() == {"mode": "template", "started": True}
    assert len(db["ai_summaries"]) == 10                               # the background task has run by the time the client returns


def test_daily_endpoint_does_nothing_when_off(db, key):
    assert client.post("/v1/insights/generate-daily", headers=key).json() == {"mode": "off", "started": False} and db["ai_summaries"] == []


def test_router_says_disabled_when_off(db, key):
    assert client.get("/v1/insights/site?site_id=s1", headers=key).json() == {
        "enabled": False, "headline": None, "points": [], "suggestion": None, "source": None, "date": None, "generated_at": None}


def test_a_floor_set_by_hand_on_the_site_wins_over_what_the_system_reports():
    assert svc.configured_floor({"health_thresholds": {"socFloorPct": 40}}, 10.0) == 40.0
    assert svc.configured_floor({"health_thresholds": {"socFloorPct": "x"}}, 25.0) == 25.0
    assert svc.configured_floor({"health_thresholds": None}, None) is None

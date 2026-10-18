"""vrm_api/forecast_service.py and /v1/forecast against an in-memory fake Supabase."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from vrm_api import forecast_service as svc
from vrm_api.main import app

# 2026-10-09 01:00 UTC = 2026-10-08 19:00 in Costa Rica (UTC-6): "7 pm" for the model.
NOW = datetime(2026, 10, 9, 1, 0, tzinfo=timezone.utc)


class Result:
    def __init__(self, data): self.data = data


class Query:
    def __init__(self, store, name):
        self.rows, self.checks, self.op, self.payload = store.setdefault(name, []), [], "select", None

    def select(self, *_): self.op = "select"; return self
    def insert(self, p): self.op, self.payload = "insert", p; return self
    def update(self, p): self.op, self.payload = "update", p; return self
    def eq(self, c, v): self.checks.append(lambda r: r.get(c) == v); return self
    def gte(self, c, v): self.checks.append(lambda r: str(r.get(c)) >= v); return self

    def execute(self):
        if self.op == "insert":
            self.rows.append(dict(self.payload))
            return Result([self.payload])
        matched = [r for r in self.rows if all(f(r) for f in self.checks)]
        if self.op == "update":
            for r in matched:
                r.update(self.payload)
        return Result([dict(r) for r in matched])


def weather():
    from test_forecast import weather as w
    return w()


def history():
    from test_forecast import history as h, weather as w
    return [{"id": i, "date": row["date"], "pv_kwh": row["pv_kwh"], "complete_day": True} for i, row in enumerate(h(w()))]


@pytest.fixture
def db(monkeypatch):
    store = {
        "sites": [{"site_id": "s1", "customer_id": "c1", "latitude": 9.9, "longitude": -84.1, "timezone": "America/Costa_Rica", "pv_kwp": 5.0,
                   "battery_usable_kwh": 10.0, "system_type": "hybrid", "vrm_installation_id": 123, "source": "vrm_api", "active": True},
                  {"site_id": "nolocation", "customer_id": "c1", "latitude": None, "longitude": None, "timezone": None, "pv_kwp": 5.0,
                   "battery_usable_kwh": None, "system_type": "hybrid", "vrm_installation_id": 1, "source": "vrm_api", "active": True}],
        "energy_daily": [{"site_id": "s1", **row} for row in history()],
        "site_snapshots": [{"site_id": "s1", "captured_at": (NOW - timedelta(minutes=4)).isoformat(), "soc_pct": 80.0}],
        "site_forecasts": [],
    }
    calls = {"weather": 0, "profile": 0}

    def fake_weather(*a, **k):
        calls["weather"] += 1
        return weather()

    def fake_profile(site):
        calls["profile"] += 1
        return [500.0] * 24

    monkeypatch.setattr(svc, "_t", lambda name: Query(store, name))
    monkeypatch.setattr(svc.open_meteo, "fetch_weather", fake_weather)
    monkeypatch.setattr(svc, "usual_load_profile", fake_profile)
    monkeypatch.delenv("FORECAST", raising=False)
    svc._WEATHER.clear()
    store["calls"] = calls
    return store


def test_off_by_default(db):
    assert svc.forecast_mode() == "off"
    assert svc.get_forecast("s1", now=NOW) == {"available": False, "reason": "off"} and db["calls"]["weather"] == 0


def test_builds_a_forecast_from_the_sites_own_state_and_stores_it(db):
    r = svc.get_forecast("s1", now=NOW, mode="on")
    assert r["available"] and r["source"] == "open-meteo" and r["calibration"]["source"] == "history"
    assert r["tomorrow"]["solar"]["kwh"] > 0 and r["backup"]["reaches_sunrise"] and r["backup"]["until_sunrise"] == "2026-10-09T05:25"
    row = db["site_forecasts"][0]
    assert row["site_id"] == "s1" and row["load_profile"]["load_w"] == [500.0] * 24 and row["result"] == r


def test_a_fresh_cache_is_served_without_new_requests(db):
    svc.get_forecast("s1", now=NOW, mode="on")
    again = svc.get_forecast("s1", now=NOW + timedelta(minutes=30), mode="on")
    assert again["available"] and db["calls"] == {"weather": 1, "profile": 1}


def test_a_stale_one_refetches_weather_but_reuses_the_daily_load_profile(db):
    svc.get_forecast("s1", now=NOW, mode="on")
    svc.get_forecast("s1", now=NOW + timedelta(hours=2), mode="on")
    assert db["calls"] == {"weather": 2, "profile": 1} and len(db["site_forecasts"]) == 1
    svc.get_forecast("s1", now=NOW + timedelta(hours=30), mode="on", force=True)
    assert db["calls"]["profile"] == 2


def test_a_site_without_coordinates_cannot_be_forecast(db):
    assert svc.get_forecast("nolocation", now=NOW, mode="on") == {"available": False, "reason": "no_location"}
    assert db["calls"]["weather"] == 0


def test_unknown_site_is_none(db):
    assert svc.get_forecast("nope", now=NOW, mode="on") is None


def test_when_the_weather_service_is_down_the_last_forecast_is_kept(db, monkeypatch):
    first = svc.get_forecast("s1", now=NOW, mode="on")
    monkeypatch.setattr(svc.open_meteo, "fetch_weather", lambda *a, **k: None)
    assert svc.get_forecast("s1", now=NOW + timedelta(hours=3), mode="on") == first
    db["site_forecasts"].clear()
    assert svc.get_forecast("s1", now=NOW, mode="on", force=True) == {"available": False, "reason": "weather_unavailable"}


def test_an_offline_battery_site_still_gets_the_solar_forecast_but_no_backup(db):
    db["site_snapshots"][0]["captured_at"] = (NOW - timedelta(hours=3)).isoformat()
    r = svc.get_forecast("s1", now=NOW, mode="on")
    assert r["tomorrow"]["solar"] is not None and r["backup"] is None


def test_a_down_vrm_does_not_stop_the_forecast(db, monkeypatch):
    monkeypatch.setattr(svc, "usual_load_profile", lambda site: None)
    r = svc.get_forecast("s1", now=NOW, mode="on")
    assert r["available"] and r["backup"] is None and r["tomorrow"]["solar"] is not None


def test_compact_keeps_only_what_the_summary_may_say(db):
    r = svc.get_forecast("s1", now=NOW, mode="on")
    c = svc.compact(r)
    assert set(c) == {"tomorrow_sky", "tomorrow_pv_kwh", "tomorrow_vs_typical_pct", "typical_pv_kwh", "storm", "storm_windows", "backup_hours", "backup_reaches_sunrise", "soc_at_sunrise_pct"}
    assert svc.compact({"available": False}) is None and svc.compact(None) is None


# ── router ───────────────────────────────────────────────────────────────

client = TestClient(app)


def test_router_needs_the_pipeline_key_and_returns_the_forecast(db, monkeypatch):
    real = svc.get_forecast
    monkeypatch.setattr(svc, "get_forecast", lambda site_id, **kw: real(site_id, now=NOW, **kw))     # the synthetic weather is dated; don't depend on today's date
    assert client.get("/v1/forecast/site?site_id=s1").status_code in (401, 403)
    monkeypatch.setenv("PIPELINE_API_KEY", "k")
    monkeypatch.setenv("FORECAST", "on")
    ok = client.get("/v1/forecast/site?site_id=s1", headers={"Authorization": "Bearer k"})
    assert ok.status_code == 200 and ok.json()["available"] and ok.json()["tomorrow"]["solar"]["kwh"] > 0
    assert client.get("/v1/forecast/site?site_id=nope", headers={"Authorization": "Bearer k"}).status_code == 404


def test_sites_in_the_same_place_share_one_weather_request(db):
    db["sites"].append({**db["sites"][0], "site_id": "s2", "vrm_installation_id": 124})
    db["energy_daily"] += [{**row, "site_id": "s2"} for row in db["energy_daily"] if row["site_id"] == "s1"]
    db["site_snapshots"].append({**db["site_snapshots"][0], "site_id": "s2"})
    svc.get_forecast("s1", now=NOW, mode="on")
    svc.get_forecast("s2", now=NOW, mode="on")
    assert db["calls"]["weather"] == 1


def test_a_forecast_made_before_midnight_is_not_served_after_it(db):
    svc.get_forecast("s1", now=NOW, mode="on")
    after_midnight = NOW + timedelta(hours=6)      # NOW is 19:00 on the 8th in Costa Rica, so this is 01:00 on the 9th
    made_for = db["site_forecasts"][0]["result"]["generated_for"][:10]
    db["site_forecasts"][0]["generated_at"] = (after_midnight - timedelta(minutes=10)).isoformat()    # fresh by age, but made on the previous local day
    assert svc.get_forecast("s1", now=after_midnight, mode="on")["generated_for"][:10] != made_for


def test_cached_only_serves_what_is_stored_however_old_and_builds_nothing(db):
    assert svc.get_forecast("s1", now=NOW, mode="on", cached_only=True) is None and db["calls"]["weather"] == 0
    first = svc.get_forecast("s1", now=NOW, mode="on")
    again = svc.get_forecast("s1", now=NOW + timedelta(days=3), mode="on", cached_only=True)
    assert again == first and db["calls"] == {"weather": 1, "profile": 1}

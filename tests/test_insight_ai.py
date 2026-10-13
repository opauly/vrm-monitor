"""victron/insight_ai.py — template text, and the guard that keeps AI text honest."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from victron import insight_ai as AI
from victron import insight_facts as F

NOW = datetime(2026, 10, 6, 15, 0, tzinfo=timezone.utc)
SITE = {"site_id": "s1", "display_name": "El Encino", "system_type": "hybrid", "pv_kwp": 5.0, "battery_usable_kwh": 10.0}


def day(date, pv=20.0, load=15.0, grid=3.0, export=0.0, min_soc=60.0, outage=0):
    return {"date": date, "pv_kwh": pv, "load_kwh": load, "grid_kwh": grid, "grid_export_kwh": export, "min_soc": min_soc, "max_soc": 100.0,
            "outage_minutes": outage, "outage_count": 1 if outage else 0, "complete_day": True, "battery_reached_float": True}


def facts(**latest):
    rows = [day(f"2026-10-{i:02d}") for i in range(1, 5)] + [day("2026-10-05", **latest)]
    return F.build_site_facts(site=SITE, energy_rows=rows, health_row=None, anomalies=[], alerts_open=[],
                              snapshot={"captured_at": (NOW - timedelta(minutes=5)).isoformat(), "soc_pct": 80.0}, now=NOW)


class FakeClient:
    def __init__(self, reply=None, boom=False):
        self.reply, self.boom, self.calls = reply, boom, []
        self.messages = self
    def create(self, **kw):
        self.calls.append(kw)
        if self.boom:
            raise RuntimeError("api down")
        return type("M", (), {"content": [type("T", (), {"text": self.reply})()]})()


GOOD = {"headline": "Yesterday: 8 kWh of solar and 15 kWh used.", "points": ["Solar made 8 kWh, well below the recent average of 20 kWh."], "suggestion": None}


# ── template ─────────────────────────────────────────────────────────────

def test_template_headline_says_yesterday_and_lists_findings_in_both_languages():
    f = facts(pv=8.0)
    en = AI.render_template(f, "en", "site", today="2026-10-06")
    assert en["headline"].startswith("Yesterday: 8 kWh of solar, 15 kWh used")
    assert en["points"] == ["Solar made 8 kWh, well below the recent average of 20 kWh."]
    assert en["suggestion"] == "If this keeps up, check the panels for dirt or shade."
    es = AI.render_template(f, "es", "site", today="2026-10-06")
    assert es["headline"].startswith("Ayer: 8 kWh de solar") and "20 kWh" in es["points"][0]


def test_template_uses_the_date_when_it_is_not_yesterday_and_handles_no_data():
    assert AI.render_template(facts(), "en", "site", today="2026-10-09")["headline"].startswith("On 2026-10-05:")
    empty = F.build_site_facts(site=SITE, energy_rows=[], health_row=None, anomalies=[], alerts_open=[], snapshot=None, now=NOW)
    assert AI.render_template(empty, "en", "site")["headline"] == "No complete day of data yet."


def test_a_normal_day_has_a_headline_and_no_noise():
    out = AI.render_template(facts(), "en", "site")
    assert out["points"] == [] and out["suggestion"] is None


def test_fleet_template_lists_silent_and_attention_sites():
    ok = F.build_site_facts(site={**SITE, "site_id": "a", "display_name": "A"}, energy_rows=[day("2026-10-05", pv=2.0)] + [day(f"2026-10-0{i}") for i in range(1, 5)],
                            health_row=None, anomalies=[], alerts_open=[], snapshot={"captured_at": (NOW - timedelta(minutes=1)).isoformat()}, now=NOW)
    silent = F.build_site_facts(site={**SITE, "site_id": "b", "display_name": "B"}, energy_rows=[day("2026-10-05")], health_row=None, anomalies=[], alerts_open=[],
                                snapshot={"captured_at": (NOW - timedelta(days=2)).isoformat()}, now=NOW)
    fleet = F.build_fleet_facts(site_facts=[ok, silent], name="All", now=NOW)
    out = AI.render_template(fleet, "en", "fleet")
    assert out["headline"].startswith("2 sites made") and out["points"][0] == "1 site has stopped reporting: B."
    assert any(p.startswith("A: solar well below normal") for p in out["points"])


# ── the guard ────────────────────────────────────────────────────────────

def test_numbers_must_come_from_the_facts():
    f = facts(pv=8.0)
    assert AI.numbers_ok(["Solar made 8 kWh against an average of 20 kWh"], f)
    assert AI.numbers_ok(["Hizo 8,0 kWh"], f)                       # Spanish decimal comma
    assert not AI.numbers_ok(["Solar made 9 kWh"], f)               # not a fact
    assert not AI.numbers_ok(["That is 12 kWh more than usual"], f)  # a derived number the model computed itself


def test_ai_text_is_used_when_it_passes():
    client = FakeClient(json.dumps(GOOD))
    out = AI.generate(facts(pv=8.0), "en", "site", today="2026-10-06", client=client)
    assert out["source"] == "ai" and out["headline"] == GOOD["headline"] and out["model"] == AI.DEFAULT_MODEL
    assert "FACTS" in client.calls[0]["messages"][0]["content"] and "DRAFT" in client.calls[0]["messages"][0]["content"]
    assert "Spanish" not in client.calls[0]["system"]


def test_spanish_is_requested_in_the_prompt():
    client = FakeClient(json.dumps(GOOD))
    AI.generate(facts(pv=8.0), "es", "site", client=client)
    assert "Spanish" in client.calls[0]["system"]


@pytest.mark.parametrize("reply", [
    "I could not do that",                                                                     # not JSON
    json.dumps({"headline": "Yesterday: 9 kWh of solar", "points": [], "suggestion": None}),   # a number that is not a fact
    json.dumps({"headline": "x" * 200, "points": [], "suggestion": None}),                     # too long
    json.dumps({"headline": "ok", "points": ["a", "b", "c", "d"], "suggestion": None}),        # too many points
    json.dumps({"headline": "", "points": [], "suggestion": None}),                            # empty
])
def test_a_bad_reply_falls_back_to_the_template(reply):
    out = AI.generate(facts(pv=8.0), "en", "site", today="2026-10-06", client=FakeClient(reply))
    assert out["source"] == "template" and out["model"] is None and out["headline"].startswith("Yesterday")


def test_an_api_error_or_a_missing_key_falls_back(monkeypatch):
    assert AI.generate(facts(pv=8.0), "en", "site", client=FakeClient(boom=True))["source"] == "template"
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert AI.generate(facts(pv=8.0), "en", "site")["source"] == "template"


def test_fenced_json_is_accepted():
    out = AI.generate(facts(pv=8.0), "en", "site", client=FakeClient("```json\n" + json.dumps(GOOD) + "\n```"))
    assert out["source"] == "ai"


def test_forecast_findings_have_text_and_a_suggestion_in_both_languages():
    f = facts()
    f["forecast"] = {"storm": True, "backup_reaches_sunrise": False, "backup_hours": 5.3, "tomorrow_pv_kwh": 8.0, "typical_pv_kwh": 20.0, "tomorrow_vs_typical_pct": -60}
    f["observations"] = F.observations(f, system_type="hybrid")
    en = AI.render_template(f, "en", "site")
    assert en["points"][:3] == ["A thunderstorm is forecast in the next day and a half.",
                                "At your usual evening use, the battery is expected to run out about 5.3 hours from now, before sunrise.",
                                "Tomorrow looks dull: about 8 kWh of solar expected, against a typical 20 kWh."]
    assert en["suggestion"] == "Keeping the battery topped up before a storm gives you more backup time."
    es = AI.render_template(f, "es", "site")
    assert es["points"][0].startswith("Se pronostica una tormenta") and "8 kWh" in es["points"][2] and es["suggestion"]
    assert AI.numbers_ok(en["points"], f)

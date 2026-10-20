"""Insight notices: the rules, the wording, and the stored/delivered side with in-memory tables."""
from datetime import datetime, timedelta, timezone

from victron import email_i18n
from victron import insight_notices as R
from vrm_api import insight_notices_service as svc

SITE = {"site_id": "s1", "customer_id": "c1", "system_type": "hybrid", "timezone": "America/Costa_Rica"}
FORECAST = {"available": True, "calibration": {"typical_pv_kwh": 23.6},
            "today": {"sky": "sunny", "solar": {"kwh": 26.2, "vs_typical_pct": 11}},
            "tomorrow": {"sky": "sunny", "solar": {"kwh": 31.0, "vs_typical_pct": 31}},
            "storm_windows": [{"day": "today", "from": "15:00", "to": "18:00"}]}


def at(hour, day=19):
    return datetime(2026, 10, day, hour, 5)


def run(hour, **kw):
    args = dict(site=SITE, now_local=at(hour), forecast=FORECAST, snapshot={"soc_pct": 52.0, "load_power_w": 600}, previous=None,
                load_profile_w=None, energy_rows=None)
    return {n.kind: n for n in R.evaluate(**{**args, **kw})}


# ── rules ────────────────────────────────────────────────────────────────
def test_the_morning_outlook_says_solar_storm_and_battery_once_a_day_and_only_in_the_morning():
    n = run(8)[R.DAILY_BRIEFING]
    assert n.key == "briefing:2026-10-19" and n.detail["kwh"] == 26.2 and n.detail["direction"] == "above"
    assert n.detail["windows"] == [{"day": "today", "from": "15:00", "to": "18:00"}] and n.detail["soc_pct"] == 52 and n.detail["charge_first"] is True
    assert R.DAILY_BRIEFING not in run(12) and R.DAILY_BRIEFING not in run(3)
    assert R.DAILY_BRIEFING not in run(8, forecast={"available": False})


def test_nothing_is_generated_for_a_kind_nobody_switched_on():
    assert run(8, kinds={R.SOLAR_DAY}) == {}


def test_a_great_solar_day_tomorrow_is_announced_in_the_evening_only_when_it_beats_typical_clearly():
    n = run(19)[R.SOLAR_DAY]
    assert n.key == "solar_day:2026-10-20" and n.detail["kwh"] == 31.0 and n.detail["pct"] == 31
    assert R.SOLAR_DAY not in run(14)
    ordinary = {**FORECAST, "tomorrow": {"solar": {"kwh": 26.0, "vs_typical_pct": 10}}}
    assert R.SOLAR_DAY not in run(19, forecast=ordinary)


def test_a_storm_with_a_low_battery_is_a_warning_only_when_close_and_awake_hours():
    n = run(12)[R.STORM_BATTERY]
    assert n.severity == "warning" and n.detail["soc_pct"] == 52 and n.key == "storm:2026-10-19:15:00"
    assert R.STORM_BATTERY not in run(12, snapshot={"soc_pct": 75.0})                       # battery is fine
    assert R.STORM_BATTERY not in run(5)                                                     # asleep
    assert R.STORM_BATTERY not in run(16)                                                    # already started
    assert R.STORM_BATTERY in run(12, snapshot={"soc_pct": 65.0}, site={**SITE, "system_type": "off_grid"})   # an off-grid battery is all the backup
    far = {**FORECAST, "storm_windows": [{"day": "tomorrow", "from": "15:00", "to": "17:00"}]}
    assert R.STORM_BATTERY not in run(12, forecast=far)


def test_high_use_needs_to_be_well_above_usual_and_to_have_lasted():
    profile = [500.0] * 24
    hot = {"load_power_w": 2600}
    n = run(14, snapshot=hot, previous={"load_power_w": 2200}, load_profile_w=profile)[R.HIGH_USAGE]
    assert n.detail == {"kw": 2.6, "usual_kw": 0.5, "factor": 5.2} and n.key == "high_usage:2026-10-19:2"
    assert R.HIGH_USAGE not in run(14, snapshot=hot, previous={"load_power_w": 600}, load_profile_w=profile)      # a spike, not a pattern
    assert R.HIGH_USAGE not in run(14, snapshot={"load_power_w": 1200}, previous={"load_power_w": 1200}, load_profile_w=profile)
    assert R.HIGH_USAGE not in run(14, snapshot=hot, previous=None, load_profile_w=profile)


def test_a_high_use_day_is_compared_with_the_week_before():
    rows = [{"date": f"2026-10-{d:02d}", "load_kwh": 20.0, "complete_day": True} for d in range(11, 18)] + [{"date": "2026-10-18", "load_kwh": 31.0, "complete_day": True}]
    n = run(8, energy_rows=rows)[R.USAGE_DAY]
    assert n.key == "usage_day:2026-10-18" and n.detail == {"date": "2026-10-18", "kwh": 31.0, "average_kwh": 20.0, "pct": 55}
    assert R.USAGE_DAY not in run(8, energy_rows=rows[:3] + rows[-1:])                       # too little history to call it high
    rows[-1]["load_kwh"] = 24.0
    assert R.USAGE_DAY not in run(8, energy_rows=rows)


# ── wording ──────────────────────────────────────────────────────────────
def card(kind, detail, lang="en", **kw):
    return svc.describe({"id": 1, "kind": kind, "site_id": "s1", "severity": "ok", "detail": detail, **kw}, site_name="Vista Atenas LP M2",
                        strings=email_i18n.get(lang), lang=lang, site_url="https://x")


def test_the_outlook_reads_as_plain_sentences_in_both_languages():
    detail = {"kwh": 26.2, "typical": 23.6, "pct": 11, "direction": "above", "windows": [{"day": "today", "from": "15:00", "to": "18:00"}], "soc_pct": 52, "charge_first": True}
    en = card(R.DAILY_BRIEFING, detail)
    assert en["body"] == ("Solar looks strong today: about 26.2 kWh expected, 11% above your typical 23.6 kWh. "
                          "Thunderstorms are possible today between 15:00 and 18:00. The battery is at 52%. "
                          "A well-charged battery before then gives you the most backup time if the power cuts out.")
    assert en["title"] == "Today at Vista Atenas LP M2" and en["path"] == "/app/dashboard/s1" and en["url"] == "https://x/app/dashboard/s1"
    es = card(R.DAILY_BRIEFING, detail, "es")
    assert "hoy entre las 15:00 y las 18:00" in es["body"] and "{" not in es["body"] and es["title"].startswith("Hoy en")


def test_every_kind_has_a_card_without_unfilled_placeholders_in_both_languages():
    details = {R.SOLAR_DAY: {"kwh": 31.0, "typical": 23.6, "pct": 31}, R.STORM_BATTERY: {"windows": [{"day": "tomorrow", "from": "06:00", "to": "08:00"}], "soc_pct": 40},
               R.HIGH_USAGE: {"kw": 2.6, "usual_kw": 0.5, "factor": 5.2}, R.USAGE_DAY: {"kwh": 31.0, "average_kwh": 20.0, "pct": 55}}
    for lang in ("en", "es"):
        for kind, detail in details.items():
            c = card(kind, detail, lang)
            assert c["title"] and c["body"] and c["push_title"] and "{" not in c["title"] + c["body"] + c["push_title"], (lang, kind)
    assert card(R.STORM_BATTERY, details[R.STORM_BATTERY], admin=False)["push_title"] == "Storm ahead, battery at 40%"


# ── stored and delivered ─────────────────────────────────────────────────
class Table:
    def __init__(self, rows=None):
        self.rows, self.filters, self.op, self.payload, self.kw = rows if rows is not None else [], [], "select", None, {}

    def _copy(self, op, payload=None, **kw):
        t = Table(self.rows); t.op, t.payload, t.kw = op, payload, kw
        return t

    def select(self, *_): return self._copy("select")
    def update(self, values): return self._copy("update", values)
    def upsert(self, rows, on_conflict=None, ignore_duplicates=False): return self._copy("upsert", rows, on_conflict=on_conflict)

    def _f(self, fn):
        self.filters.append(fn); return self

    def in_(self, col, vals): return self._f(lambda r: r.get(col) in vals)
    def eq(self, col, val): return self._f(lambda r: r.get(col) == val)
    def gte(self, col, val): return self._f(lambda r: str(r.get(col)) >= str(val))
    def is_(self, col, _null): return self._f(lambda r: r.get(col) is None)

    def execute(self):
        class R_: pass
        out = R_()
        match = [r for r in self.rows if all(f(r) for f in self.filters)]
        if self.op == "upsert":
            keys = {tuple(r.get(c) for c in self.kw["on_conflict"].split(",")) for r in self.rows}
            new = [dict(r, id=len(self.rows) + i + 1, created_at=datetime.now(timezone.utc).isoformat(), notified_at=None) for i, r in enumerate(self.payload)
                   if tuple(r.get(c) for c in self.kw["on_conflict"].split(",")) not in keys]
            self.rows.extend(new); out.data = new
        elif self.op == "update":
            for r in match:
                r.update(self.payload)
            out.data = match
        else:
            out.data = match
        return out


class DB:
    def __init__(self, **tables): self.tables = {k: Table(v) for k, v in tables.items()}
    def __call__(self, name): return self.tables[name]


NOW = datetime(2026, 10, 19, 14, 5, tzinfo=timezone.utc)      # 08:05 in Costa Rica


def pass_(monkeypatch, enabled=("daily_briefing",), tables=None, forecast=FORECAST, snapshot=None, previous=None):
    prefs = {("c1", k): {"enabled": True, "email": True, "push": True} for k in enabled}
    db = DB(**{"site_forecasts": [{"site_id": "s1", "generated_at": NOW.isoformat(), "result": {**forecast, "generated_for": "2026-10-19T08:00"}, "load_profile": {"load_w": [500.0] * 24}}],
               "energy_daily": [], "insight_notices": [], **(tables or {})})
    monkeypatch.setattr(svc, "_t", db)
    monkeypatch.setattr(svc, "eligible_customer_ids", lambda ids: set(ids))
    monkeypatch.setattr(svc, "load_preferences", lambda ids: prefs)
    out = svc.run_pass(sites=[SITE], fetched=[("ok", snapshot or {"soc_pct": 52.0, "load_power_w": 600})], previous_by_site={"s1": previous} if previous else {}, now=NOW)
    return out, db.tables["insight_notices"].rows


def test_a_pass_stores_the_outlook_once_and_nothing_for_a_customer_who_switched_everything_off(monkeypatch):
    out, rows = pass_(monkeypatch)
    assert out["stored"] == 1 and [(r["kind"], r["dedupe_key"]) for r in rows] == [("daily_briefing", "briefing:2026-10-19")]
    out, rows = pass_(monkeypatch, enabled=())
    assert out["stored"] == 0 and rows == []


def test_the_same_notice_is_not_stored_twice(monkeypatch):
    seen = [{"customer_id": "c1", "kind": "daily_briefing", "dedupe_key": "briefing:2026-10-19", "created_at": NOW.isoformat()}]
    out, rows = pass_(monkeypatch, tables={"insight_notices": seen})
    assert out["stored"] == 0 and len(rows) == 1


def test_a_customer_gets_at_most_three_non_outlook_notices_a_day(monkeypatch):
    used = [{"customer_id": "c1", "kind": "high_usage", "dedupe_key": f"high_usage:2026-10-18:{i}", "created_at": NOW.isoformat()} for i in range(3)]
    out, rows = pass_(monkeypatch, enabled=("high_usage", "daily_briefing"), tables={"insight_notices": used},
                      snapshot={"soc_pct": 52.0, "load_power_w": 2600}, previous={"load_power_w": 2200})
    assert [r["kind"] for r in rows[3:]] == ["daily_briefing"] and out["skipped_cap"] == 1       # the briefing is exempt, the fourth high-use notice is not


def deliver(monkeypatch, notices, *, pushes=None, prefs=None, now=NOW):
    db = DB(insight_notices=notices, sites=[{"site_id": "s1", "display_name": "Vista Atenas LP M2"}],
            customers=[{"id": "c1", "contact_email": "a@b.co", "auth_email": None, "ui_language": "en"}])
    monkeypatch.setattr(svc, "_t", db)
    monkeypatch.setattr(svc, "load_preferences", lambda ids: prefs if prefs is not None else {("c1", n["kind"]): {"enabled": True, "email": True, "push": True} for n in notices})
    monkeypatch.setattr(svc, "forced_customer_ids", lambda: set())
    monkeypatch.setattr(svc.alerts_push, "destinations", lambda **kw: [{"id": 1, "endpoint": "e"}])
    sent = {"mail": [], "push": []}
    monkeypatch.setattr(svc, "mailer_send", lambda to, subject, html: sent["mail"].append((to, subject, html)))
    monkeypatch.setattr(svc.alerts_push, "deliver", lambda devices, payloads, **kw: sent["push"].append(payloads) or {"delivered": 1})
    out = svc.deliver(now=now, mode="on", push=True, site_url="https://x")
    return out, sent, db.tables["insight_notices"].rows


def notice(**kw):
    return {"id": 1, "customer_id": "c1", "site_id": "s1", "kind": "solar_day", "dedupe_key": "k", "severity": "ok", "created_at": NOW.isoformat(), "notified_at": None,
            "detail": {"kwh": 31.0, "typical": 23.6, "pct": 31}, **kw}


def test_a_stored_notice_goes_out_by_email_and_phone_and_is_marked_done(monkeypatch):
    out, sent, rows = deliver(monkeypatch, [notice()])
    assert out["sent"] == 1 and out["pushed"] == 1 and rows[0]["notified_at"] is not None
    to, subject, html = sent["mail"][0]
    assert to == "a@b.co" and subject == "A great solar day tomorrow at Vista Atenas LP M2" and "31.0 kWh" in html and "insight notifications" in html
    assert sent["push"][0][0]["title"] == "Great solar day ahead" and sent["push"][0][0]["body"].startswith("Vista Atenas LP M2 — ")


def test_a_notice_that_waited_too_long_or_whose_kind_was_switched_off_is_dropped_not_sent(monkeypatch):
    old = notice(created_at=(NOW - timedelta(hours=5)).isoformat())
    out, sent, rows = deliver(monkeypatch, [old])
    assert out["dropped"] == 1 and sent == {"mail": [], "push": []} and rows[0]["notified_at"] is not None
    out, sent, rows = deliver(monkeypatch, [notice()], prefs={("c1", "solar_day"): {"enabled": False, "email": True, "push": True}})
    assert out["dropped"] == 1 and sent == {"mail": [], "push": []}


def test_each_channel_follows_the_customers_choice_for_that_kind(monkeypatch):
    out, sent, _ = deliver(monkeypatch, [notice()], prefs={("c1", "solar_day"): {"enabled": True, "email": False, "push": True}})
    assert sent["mail"] == [] and len(sent["push"]) == 1
    out, sent, _ = deliver(monkeypatch, [notice()], prefs={("c1", "solar_day"): {"enabled": True, "email": True, "push": False}})
    assert len(sent["mail"]) == 1 and sent["push"] == []


def test_several_notices_collapse_into_one_summary_push_and_one_email(monkeypatch):
    many = [notice(id=i, dedupe_key=f"k{i}") for i in range(1, 5)]
    out, sent, _ = deliver(monkeypatch, many)
    assert len(sent["mail"]) == 1 and sent["mail"][0][1] == "4 insights about your systems"
    assert len(sent["push"][0]) == 1 and sent["push"][0][0]["title"] == "4 insights about your systems"

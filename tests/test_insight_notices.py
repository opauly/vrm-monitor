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


def member(name="Casona", soc=52.0, forecast=FORECAST, system_type="hybrid"):
    return R.Member(site={**SITE, "display_name": name, "system_type": system_type}, forecast=forecast, snapshot={"soc_pct": soc, "load_power_w": 600})


def run(hour, members=None, **kw):
    """The weather-driven notices of one group."""
    return {n.kind: n for n in R.evaluate_group(key="p:1", name=kw.pop("name", "Casona"), members=members or [member()], now_local=at(hour), **kw)}


def run_site(hour, **kw):
    args = dict(site=SITE, now_local=at(hour), snapshot={"soc_pct": 52.0, "load_power_w": 600}, previous=None, load_profile_w=None, energy_rows=None)
    return {n.kind: n for n in R.evaluate(**{**args, **kw})}


# ── rules ────────────────────────────────────────────────────────────────
def test_the_morning_outlook_says_solar_storm_and_battery_once_a_day_and_only_in_the_morning():
    n = run(8)[R.DAILY_BRIEFING]
    assert n.key == "briefing:p:1:2026-10-19" and n.detail["kwh"] == 26.2 and n.detail["direction"] == "above"
    assert n.detail["windows"] == [{"day": "today", "from": "15:00", "to": "18:00"}] and n.detail["soc_min"] == 52 and n.detail["charge_first"] is True
    assert R.DAILY_BRIEFING not in run(12) and R.DAILY_BRIEFING not in run(3)
    assert R.DAILY_BRIEFING not in run(8, members=[member(forecast={"available": False})])


def test_nothing_is_generated_for_a_kind_nobody_switched_on():
    assert run(8, kinds={R.SOLAR_DAY}) == {}


def test_a_great_solar_day_tomorrow_is_announced_in_the_evening_only_when_it_beats_typical_clearly():
    n = run(19)[R.SOLAR_DAY]
    assert n.key == "solar_day:p:1:2026-10-20" and n.detail["kwh"] == 31.0 and n.detail["pct"] == 31
    assert R.SOLAR_DAY not in run(14)
    ordinary = {**FORECAST, "tomorrow": {"solar": {"kwh": 26.0, "vs_typical_pct": 10}}}
    assert R.SOLAR_DAY not in run(19, members=[member(forecast=ordinary)])


def test_sites_sharing_a_place_are_judged_together_not_one_by_one():
    # Two sites with the same sun: one is 30% above its own typical, the other 12%. Alone only the first would be told;
    # together they are 18% above and it is one notice for the place.
    a = {**FORECAST, "calibration": {"typical_pv_kwh": 20.0}, "tomorrow": {"solar": {"kwh": 26.0}}}
    b = {**FORECAST, "calibration": {"typical_pv_kwh": 40.0}, "tomorrow": {"solar": {"kwh": 44.8}}}
    assert R.SOLAR_DAY in run(19, members=[member("M2", forecast=a)])
    assert R.SOLAR_DAY not in run(19, members=[member("M3", forecast=b)])
    n = run(19, members=[member("M2", forecast=a), member("M3", forecast=b)], name="Vista Atenas LP")[R.SOLAR_DAY]
    assert n.detail["kwh"] == 70.8 and n.detail["typical"] == 60.0 and n.detail["pct"] == 18 and n.detail["sites"] == 2 and n.detail["name"] == "Vista Atenas LP"
    # a site with no figures does not count as zero
    assert run(19, members=[member("M2", forecast=a), member("New", forecast={"available": True})])[R.SOLAR_DAY].detail["kwh"] == 26.0


def test_a_storm_with_a_low_battery_is_a_warning_only_when_close_and_awake_hours():
    n = run(12)[R.STORM_BATTERY]
    assert n.severity == "warning" and n.detail["soc_pct"] == 52 and n.key == "storm:p:1:2026-10-19:15:00"
    assert R.STORM_BATTERY not in run(12, members=[member(soc=75.0)])                       # battery is fine
    assert R.STORM_BATTERY not in run(5)                                                     # asleep
    assert R.STORM_BATTERY not in run(16)                                                    # already started
    assert R.STORM_BATTERY in run(12, members=[member(soc=65.0, system_type="off_grid")])  # an off-grid battery is all the backup
    far = {**FORECAST, "storm_windows": [{"day": "tomorrow", "from": "15:00", "to": "17:00"}]}
    assert R.STORM_BATTERY not in run(12, members=[member(forecast=far)])


def test_a_storm_over_a_property_names_the_sites_whose_battery_is_low_and_says_it_once():
    members = [member("Casona", soc=45.0), member("Casita", soc=80.0), member("Cabaña", soc=58.0)]
    n = run(12, members=members, name="El Encino")[R.STORM_BATTERY]
    assert n.detail["low"] == [{"name": "Casona", "soc": 45}, {"name": "Cabaña", "soc": 58}] and n.detail["soc_pct"] == 45 and n.detail["sites"] == 3
    assert R.STORM_BATTERY not in run(12, members=[member("Casona", soc=80.0), member("Casita", soc=90.0)])


def test_the_outlook_for_a_property_reports_the_batteries_as_a_range_and_the_weather_once():
    n = run(8, members=[member("A", soc=40.0), member("B", soc=70.0)], name="Vista Atenas LP")[R.DAILY_BRIEFING]
    assert (n.detail["soc_min"], n.detail["soc_max"]) == (40, 70) and n.detail["windows"] == [{"day": "today", "from": "15:00", "to": "18:00"}]
    assert n.detail["kwh"] == 52.4 and n.detail["typical"] == 47.2


def test_group_names_come_from_what_the_sites_names_share():
    assert R.group_name(["Vista Atenas LP M1 (Houses)", "Vista Atenas LP M2 (Studios)", "Vista Atenas LP M3 (2 Floor & Pool)"]) == "Vista Atenas LP"
    assert R.group_name(["El Encino (Casona)", "El Encino (Casita)"]) == "El Encino" and R.group_name(["Rancho DuliLa"]) == "Rancho DuliLa"


def test_high_use_needs_to_be_well_above_usual_and_to_have_lasted():
    profile = [500.0] * 24
    hot = {"load_power_w": 2600}
    n = run_site(14, snapshot=hot, previous={"load_power_w": 2200}, load_profile_w=profile)[R.HIGH_USAGE]
    assert n.detail == {"kw": 2.6, "usual_kw": 0.5, "factor": 5.2} and n.key == "high_usage:2026-10-19:2"
    assert R.HIGH_USAGE not in run_site(14, snapshot=hot, previous={"load_power_w": 600}, load_profile_w=profile)      # a spike, not a pattern
    assert R.HIGH_USAGE not in run_site(14, snapshot={"load_power_w": 1200}, previous={"load_power_w": 1200}, load_profile_w=profile)
    assert R.HIGH_USAGE not in run_site(14, snapshot=hot, previous=None, load_profile_w=profile)


def test_a_high_use_day_is_compared_with_the_week_before():
    rows = [{"date": f"2026-10-{d:02d}", "load_kwh": 20.0, "complete_day": True} for d in range(11, 18)] + [{"date": "2026-10-18", "load_kwh": 31.0, "complete_day": True}]
    n = run_site(8, energy_rows=rows)[R.USAGE_DAY]
    assert n.key == "usage_day:2026-10-18" and n.detail == {"date": "2026-10-18", "kwh": 31.0, "average_kwh": 20.0, "pct": 55}
    assert R.USAGE_DAY not in run_site(8, energy_rows=rows[:3] + rows[-1:])                       # too little history to call it high
    rows[-1]["load_kwh"] = 24.0
    assert R.USAGE_DAY not in run_site(8, energy_rows=rows)


# ── wording ──────────────────────────────────────────────────────────────
def card(kind, detail, lang="en", **kw):
    return svc.describe({"id": 1, "kind": kind, "site_id": "s1", "severity": "ok", "detail": detail, **kw}, site_name="Vista Atenas LP M2",
                        strings=email_i18n.get(lang), lang=lang, site_url="https://x")


def test_the_outlook_reads_as_plain_sentences_in_both_languages():
    detail = {"kwh": 26.2, "typical": 23.6, "pct": 11, "direction": "above", "windows": [{"day": "today", "from": "15:00", "to": "18:00"}], "soc_min": 52, "soc_max": 52, "charge_first": True}
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

    @property
    def not_(self):
        outer = self
        class Neg:
            def is_(self, col, _val): outer._f(lambda r: r.get(col) is not None); return outer
        return Neg()

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
    assert out["stored"] == 1 and [(r["kind"], r["dedupe_key"]) for r in rows] == [("daily_briefing", "briefing:s:s1:2026-10-19")]
    out, rows = pass_(monkeypatch, enabled=())
    assert out["stored"] == 0 and rows == []


def test_the_same_notice_is_not_stored_twice(monkeypatch):
    seen = [{"customer_id": "c1", "kind": "daily_briefing", "dedupe_key": "briefing:s:s1:2026-10-19", "created_at": NOW.isoformat()}]
    out, rows = pass_(monkeypatch, tables={"insight_notices": seen})
    assert out["stored"] == 0 and len(rows) == 1


def test_a_customer_gets_at_most_three_non_outlook_notices_a_day(monkeypatch):
    used = [{"customer_id": "c1", "kind": "high_usage", "dedupe_key": f"high_usage:2026-10-18:{i}", "created_at": NOW.isoformat()} for i in range(3)]
    out, rows = pass_(monkeypatch, enabled=("high_usage", "daily_briefing"), tables={"insight_notices": used},
                      snapshot={"soc_pct": 52.0, "load_power_w": 2600}, previous={"load_power_w": 2200})
    assert [r["kind"] for r in rows[3:]] == ["daily_briefing"] and out["skipped_cap"] == 1       # the briefing is exempt, the fourth high-use notice is not


def deliver(monkeypatch, notices, *, pushes=None, prefs=None, now=NOW, sites=None, recipients=None, devices=None):
    db = DB(insight_notices=notices, sites=sites or [{"site_id": "s1", "display_name": "Vista Atenas LP M2"}], property_recipients=recipients or [],
            customers=[{"id": "c1", "contact_email": "a@b.co", "auth_email": None, "ui_language": "en"}])
    monkeypatch.setattr(svc, "_t", db)
    monkeypatch.setattr(svc.alert_routing, "_t", db)
    monkeypatch.setattr(svc, "load_preferences", lambda ids: prefs if prefs is not None else {("c1", n["kind"]): {"enabled": True, "email": True, "push": True} for n in notices})
    monkeypatch.setattr(svc, "forced_customer_ids", lambda: set())
    monkeypatch.setattr(svc.alerts_push, "destinations", lambda **kw: devices if devices is not None else [{"id": 1, "endpoint": "e"}])
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


# ── groups: one notice for sites that share weather ─────────────────────
NOW_EVENING = datetime(2026, 10, 20, 1, 5, tzinfo=timezone.utc)      # 19:05 in Costa Rica


def group_pass(monkeypatch, details, members, *, enabled=("solar_day",), property_names=None):
    prefs = {("c1", k): {"enabled": True, "email": True, "push": True} for k in enabled}
    result = {**FORECAST, "generated_for": "2026-10-19T19:00"}
    db = DB(**{"site_forecasts": [{"site_id": m["site_id"], "generated_at": NOW_EVENING.isoformat(), "result": result, "load_profile": {"load_w": [500.0] * 24}} for m in members],
               "energy_daily": [], "insight_notices": [], "sites": details, "properties": property_names or []})
    monkeypatch.setattr(svc, "_t", db)
    monkeypatch.setattr(svc, "eligible_customer_ids", lambda ids: set(ids))
    monkeypatch.setattr(svc, "load_preferences", lambda ids: prefs)
    out = svc.run_pass(sites=members, fetched=[("ok", {"soc_pct": 60.0, "load_power_w": 600})] * len(members), previous_by_site={}, now=NOW_EVENING)
    return out, db.tables["insight_notices"].rows


def _members(*names):
    return [{**SITE, "site_id": n.lower(), "display_name": n} for n in names]


def test_sites_at_one_location_get_one_solar_notice_named_for_what_their_names_share(monkeypatch):
    members = _members("Vista Atenas LP M1 (Houses)", "Vista Atenas LP M2 (Studios)", "Vista Atenas LP M3 (2 Floor & Pool)")
    details = [{"site_id": m["site_id"], "display_name": m["display_name"], "latitude": 9.979, "longitude": -84.377, "property_id": None} for m in members]
    out, rows = group_pass(monkeypatch, details, members)
    assert out["stored"] == 1 and len(rows) == 1
    assert rows[0]["dedupe_key"] == "solar_day:l:9.98,-84.38:2026-10-20" and rows[0]["detail"]["name"] == "Vista Atenas LP" and rows[0]["detail"]["sites"] == 3


def test_a_property_is_one_group_and_its_name_is_the_propertys(monkeypatch):
    members = _members("Casona", "Casita")
    details = [{"site_id": m["site_id"], "display_name": m["display_name"], "latitude": None, "longitude": None, "property_id": "prop-1"} for m in members]
    out, rows = group_pass(monkeypatch, details, members, property_names=[{"id": "prop-1", "name": "El Encino"}])
    assert [(r["dedupe_key"], r["detail"]["name"], r["detail"]["property_id"]) for r in rows] == [("solar_day:p:prop-1:2026-10-20", "El Encino", "prop-1")]


def test_sites_in_different_properties_are_told_separately_even_at_one_place(monkeypatch):
    members = _members("A", "B")
    details = [{"site_id": "a", "display_name": "A", "latitude": 9.9, "longitude": -84.3, "property_id": "p1"}, {"site_id": "b", "display_name": "B", "latitude": 9.9, "longitude": -84.3, "property_id": "p2"}]
    out, rows = group_pass(monkeypatch, details, members)
    assert out["stored"] == 2 and {r["dedupe_key"] for r in rows} == {"solar_day:p:p1:2026-10-20", "solar_day:p:p2:2026-10-20"}


def test_without_the_properties_sql_the_sites_still_group_by_place(monkeypatch):
    class Missing(DB):
        def __call__(self, name):
            table = super().__call__(name)
            if name == "sites":
                real = table.select
                table.select = lambda cols: (_ for _ in ()).throw(RuntimeError("column property_id does not exist")) if "property_id" in cols else real(cols)
            return table
    members = _members("El Encino (Casona)", "El Encino (Casita)")
    details = [{"site_id": m["site_id"], "display_name": m["display_name"], "latitude": 9.95, "longitude": -84.31} for m in members]
    prefs = {("c1", "solar_day"): {"enabled": True, "email": True, "push": True}}
    db = Missing(**{"site_forecasts": [{"site_id": m["site_id"], "generated_at": NOW_EVENING.isoformat(), "result": {**FORECAST, "generated_for": "2026-10-19T19:00"}, "load_profile": None} for m in members],
                    "energy_daily": [], "insight_notices": [], "sites": details})
    monkeypatch.setattr(svc, "_t", db)
    monkeypatch.setattr(svc, "eligible_customer_ids", lambda ids: set(ids))
    monkeypatch.setattr(svc, "load_preferences", lambda ids: prefs)
    out = svc.run_pass(sites=members, fetched=[("ok", {"soc_pct": 60.0})] * 2, previous_by_site={}, now=NOW_EVENING)
    assert out["stored"] == 1 and db.tables["insight_notices"].rows[0]["detail"]["name"] == "El Encino"


def test_group_notices_read_naturally_and_link_to_the_property(monkeypatch):
    for lang in ("en", "es"):
        solar = card(R.SOLAR_DAY, {"name": "El Encino", "sites": 4, "kwh": 90.0, "typical": 75.0, "pct": 20, "property_id": "p1"}, lang)
        storm = card(R.STORM_BATTERY, {"name": "El Encino", "sites": 4, "windows": [{"day": "today", "from": "15:00", "to": "17:00"}], "soc_pct": 41,
                                       "low": [{"name": "Casona", "soc": 41}, {"name": "Casita", "soc": 55}], "property_id": "p1"}, lang)
        brief = card(R.DAILY_BRIEFING, {"name": "El Encino", "sites": 4, "kwh": 90.0, "typical": 75.0, "pct": 20, "direction": "above", "soc_min": 41, "soc_max": 78}, lang)
        for c in (solar, storm, brief):
            assert "El Encino" in c["title"] and "{" not in c["body"] + c["title"]
            assert c["path"] == "/app/dashboard?property=p1" if c is not brief else True
        assert "4" in solar["body"] and "Casona 41%, Casita 55%" in storm["body"] and "41%" in brief["body"] and "78%" in brief["body"]
    admin = svc.describe({"id": 1, "kind": R.SOLAR_DAY, "site_id": "casona", "severity": "ok", "detail": {"name": "El Encino", "sites": 2, "kwh": 1, "typical": 1, "pct": 1, "property_id": "p1"}},
                         site_name="Casona", strings=email_i18n.get("en"), lang="en", site_url="https://x", admin=True)
    assert admin["path"] == "/admin/fleet?property=p1" and admin["site"] == "El Encino"


# ── by property ──────────────────────────────────────────────────────────
PROP_SITE = [{"site_id": "s1", "display_name": "Vista Atenas LP M2", "property_id": "p1"}]


def test_a_propertys_owner_gets_its_notices_by_email_even_when_the_account_has_email_off(monkeypatch):
    prefs = {("c1", "solar_day"): {"enabled": True, "email": False, "push": True}}
    out, sent, _ = deliver(monkeypatch, [notice()], prefs=prefs, sites=PROP_SITE, recipients=[{"property_id": "p1", "email": "Owner@Villa.com"}])
    assert [m[0] for m in sent["mail"]] == ["owner@villa.com"] and len(sent["push"]) == 1


def test_a_property_recipient_does_not_get_a_kind_the_account_has_switched_off(monkeypatch):
    prefs = {("c1", "solar_day"): {"enabled": False, "email": True, "push": True}}
    out, sent, _ = deliver(monkeypatch, [notice()], prefs=prefs, sites=PROP_SITE, recipients=[{"property_id": "p1", "email": "owner@villa.com"}])
    assert sent["mail"] == [] and out["dropped"] == 1


def test_a_phone_scoped_to_another_property_is_not_sent_this_notice(monkeypatch):
    devices = [{"id": 1, "endpoint": "e1", "property_ids": ["p2"]}, {"id": 2, "endpoint": "e2", "property_ids": ["p1"]}, {"id": 3, "endpoint": "e3"}]
    sent_to = []
    monkeypatch.setattr(svc.alerts_push, "deliver", lambda ds, payloads, **kw: sent_to.append([d["id"] for d in ds]) or {"delivered": len(ds)})
    db = DB(insight_notices=[notice()], sites=PROP_SITE, property_recipients=[], customers=[{"id": "c1", "contact_email": "a@b.co", "auth_email": None, "ui_language": "en"}])
    monkeypatch.setattr(svc, "_t", db)
    monkeypatch.setattr(svc.alert_routing, "_t", db)
    monkeypatch.setattr(svc, "load_preferences", lambda ids: {("c1", "solar_day"): {"enabled": True, "email": True, "push": True}})
    monkeypatch.setattr(svc, "forced_customer_ids", lambda: set())
    monkeypatch.setattr(svc.alerts_push, "destinations", lambda **kw: devices)
    monkeypatch.setattr(svc, "mailer_send", lambda *a, **k: None)
    svc.deliver(now=NOW, mode="on", push=True, site_url="https://x")
    assert sorted(sorted(g) for g in sent_to) == [[2, 3]]


# ── the app can show what was said ──────────────────────────────────────
def test_a_stored_notice_carries_its_wording_in_both_languages(monkeypatch):
    members = _members("Vista Atenas LP M1 (Houses)", "Vista Atenas LP M2 (Studios)")
    details = [{"site_id": m["site_id"], "display_name": m["display_name"], "latitude": 9.979, "longitude": -84.377, "property_id": None} for m in members]
    out, rows = group_pass(monkeypatch, details, members)
    text = rows[0]["text"]
    assert text["en"]["title"] == "A great solar day tomorrow at Vista Atenas LP" and "kWh of solar expected tomorrow" in text["en"]["body"]
    assert text["es"]["title"] == "Un gran día solar mañana en Vista Atenas LP" and "kWh" in text["es"]["body"] and "{" not in text["en"]["body"] + text["es"]["body"]


def test_without_the_text_column_the_notice_is_still_stored(monkeypatch):
    members = _members("Casona")
    details = [{"site_id": "casona", "display_name": "Casona", "latitude": None, "longitude": None, "property_id": None}]

    class NoText(Table):
        def upsert(self, rows, on_conflict=None, ignore_duplicates=False):
            if any("text" in r for r in rows):
                raise RuntimeError('column "text" does not exist')
            return super().upsert(rows, on_conflict, ignore_duplicates)

    class DBNoText(DB):
        def __init__(self, **tables):
            self.tables = {k: (NoText(v) if k == "insight_notices" else Table(v)) for k, v in tables.items()}

    prefs = {("c1", "solar_day"): {"enabled": True, "email": True, "push": True}}
    db = DBNoText(site_forecasts=[{"site_id": "casona", "generated_at": NOW_EVENING.isoformat(), "result": {**FORECAST, "generated_for": "2026-10-19T19:00"}, "load_profile": None}],
                  energy_daily=[], insight_notices=[], sites=details, properties=[])
    monkeypatch.setattr(svc, "_t", db)
    monkeypatch.setattr(svc, "eligible_customer_ids", lambda ids: set(ids))
    monkeypatch.setattr(svc, "load_preferences", lambda ids: prefs)
    out = svc.run_pass(sites=members, fetched=[("ok", {"soc_pct": 60.0})], previous_by_site={}, now=NOW_EVENING)
    assert out["stored"] == 1 and "text" not in db.tables["insight_notices"].rows[0]


def test_the_summary_push_opens_the_insights_list():
    cards = [({"id": i}, {"push_title": "Storm", "site": "El Encino", "body": "b", "path": "/x", "severity": "warning"}) for i in range(4)]
    assert svc._push_payloads(cards, email_i18n.get("en"), admin=False)[0]["url"] == "/app/alerts?tab=insights"
    assert svc._push_payloads(cards, email_i18n.get("en"), admin=True)[0]["url"] == "/admin/fleet/alerts?tab=insights"


def test_in_test_mode_another_customers_insights_are_not_emailed_to_the_admin(monkeypatch):
    monkeypatch.setenv("ALERTS_EMAIL_TEST_TO", "me@test.com")
    monkeypatch.delenv("ALERTS_EMAIL_TEST_ALL", raising=False)
    db = DB(insight_notices=[notice()], sites=[{"site_id": "s1", "display_name": "X"}], property_recipients=[], customers=[{"id": "c1", "contact_email": "a@b.co", "auth_email": None, "ui_language": "en"}])
    monkeypatch.setattr(svc, "_t", db)
    monkeypatch.setattr(svc.alert_routing, "_t", db)
    monkeypatch.setattr(svc.alerts_push, "destinations", lambda **kw: [])
    monkeypatch.setattr(svc, "load_preferences", lambda ids: {("c1", "solar_day"): {"enabled": True, "email": True, "push": True}})
    monkeypatch.setattr(svc, "forced_customer_ids", lambda: set())
    mails = []
    monkeypatch.setattr(svc, "mailer_send", lambda to, subject, html: mails.append(to))
    svc.deliver(now=NOW, mode="test", push=False, site_url="https://x")
    assert mails == []
    monkeypatch.setenv("ALERTS_EMAIL_TEST_ALL", "on")
    db.tables["insight_notices"].rows[0]["notified_at"] = None
    svc.deliver(now=NOW, mode="test", push=False, site_url="https://x")
    assert mails == ["me@test.com"]


# ── "the sunniest hours" instead of a generic midday ─────────────────────
def test_a_great_solar_day_names_the_real_sunniest_hours_when_the_forecast_has_them():
    forecast = {**FORECAST, "tomorrow": {"solar": {"kwh": 31.0, "vs_typical_pct": 31}, "best_window": {"from": "10:00", "to": "15:00"}}}
    n = run(19, members=[member(forecast=forecast)])[R.SOLAR_DAY]
    assert n.detail["window"] == {"from": "10:00", "to": "15:00"}
    en = card(R.SOLAR_DAY, n.detail)["body"]
    assert "sunniest hours are expected 10:00 to 15:00" in en and "around midday" not in en and en.endswith("a good time to run heavy loads.")
    es = card(R.SOLAR_DAY, n.detail, "es")["body"]
    assert "de 10:00 a 15:00" in es and "mediodía" not in es and "{" not in es


def test_without_hourly_sunlight_it_still_says_midday():
    n = run(19)[R.SOLAR_DAY]
    assert "window" not in n.detail and "around midday" in card(R.SOLAR_DAY, n.detail)["body"]


def test_the_outlook_tip_uses_the_sunniest_hours_too():
    forecast = {**FORECAST, "today": {**FORECAST["today"], "best_window": {"from": "09:00", "to": "14:00"}}, "storm_windows": []}
    d = run(8, members=[member(forecast=forecast)])[R.DAILY_BRIEFING].detail
    assert "The sunniest hours are 09:00 to 14:00" in card(R.DAILY_BRIEFING, d)["body"]


def test_the_summary_push_counts_each_kind_and_says_to_tap():
    items = [({"id": i}, {"push_title": "Today's outlook", "site": f"Site {i}", "body": "b", "path": "/x", "severity": "ok"}) for i in range(3)]
    items += [({"id": 10 + i}, {"push_title": "Storm ahead, battery at 35%", "head": "Storm ahead", "site": f"Storm {i}", "body": "b", "path": "/x",
                                "severity": "warning"}) for i in range(2)]
    push = svc._push_payloads(items, email_i18n.get("en"), admin=False)[0]
    assert push["title"] == "5 insights about your systems"
    assert push["body"] == "Today's outlook (3) · Storm ahead (2). Tap to see them."
    assert svc._push_payloads(items, email_i18n.get("es"), admin=False)[0]["body"].endswith("Toca para verlos.")


def test_the_summary_push_stays_the_same_size_with_forty_sites():
    items = [({"id": i}, {"push_title": "Today's outlook", "site": f"A rather long site name {i}", "body": "b", "path": "/x", "severity": "ok"}) for i in range(40)]
    push = svc._push_payloads(items, email_i18n.get("en"), admin=False)[0]
    assert push["title"] == "40 insights about your systems" and push["body"] == "Today's outlook (40). Tap to see them."


# ── the kind of system, and keeping today's outlook current ──────────────
def test_an_off_grid_site_is_never_told_about_power_cuts():
    off = [member(system_type="off_grid")]
    brief = run(8, members=off)[R.DAILY_BRIEFING]
    assert brief.detail["backup"] == "off_grid"
    for lang in ("en", "es"):
        body = card(R.DAILY_BRIEFING, brief.detail, lang)["body"]
        assert "power cut" not in body and "corte" not in body and "se va la luz" not in body and "respaldo" not in body
    storm = run(10, members=[member(soc=65.0, system_type="off_grid")])[R.STORM_BATTERY]
    assert storm.detail["backup"] == "off_grid"
    text = card(R.STORM_BATTERY, storm.detail)["body"]
    assert "power cut" not in text and "backup" not in text and "heavy loads while the sun is out" in text


def test_a_grid_connected_site_keeps_the_power_cut_advice_and_a_mixed_property_gets_neutral_words():
    assert run(8)[R.DAILY_BRIEFING].detail["backup"] == "grid"
    assert "power cuts out" in card(R.DAILY_BRIEFING, run(8)[R.DAILY_BRIEFING].detail)["body"]
    mixed = run(8, members=[member("A"), member("B", system_type="off_grid")])[R.DAILY_BRIEFING]
    assert mixed.detail["backup"] == "mixed" and "reserve" in card(R.DAILY_BRIEFING, mixed.detail)["body"]


def test_a_full_battery_does_not_bring_any_storm_advice():
    full = run(8, members=[member(soc=95.0, system_type="off_grid")])[R.DAILY_BRIEFING]
    assert not full.detail["charge_first"] and "backup" not in full.detail


def test_the_outlook_is_worked_out_again_after_the_morning_only_when_it_was_already_said():
    assert R.DAILY_BRIEFING not in run(15)
    assert R.DAILY_BRIEFING in run(15, refresh=True) and R.DAILY_BRIEFING not in run(20, refresh=True)


def test_a_refreshed_outlook_drops_what_is_already_over():
    forecast = {**FORECAST, "today": {**FORECAST["today"], "best_window": {"from": "10:00", "to": "13:00"}}}
    morning = run(8, members=[member(forecast=forecast)])[R.DAILY_BRIEFING]
    assert morning.detail["window"] == {"from": "10:00", "to": "13:00"}
    later = run(16, members=[member(forecast=forecast)], refresh=True)[R.DAILY_BRIEFING]
    assert "window" not in later.detail and "windows" not in later.detail and later.detail["charge_first"] is False


def _said_today(monkeypatch, **extra):
    said = [{"id": 7, "customer_id": "c1", "kind": "daily_briefing", "dedupe_key": "briefing:s:s1:2026-10-19",
             "created_at": (NOW - timedelta(hours=3)).isoformat(), "text": {"en": {"title": "old", "body": "old"}}, "detail": {}, **extra}]
    return pass_(monkeypatch, tables={"insight_notices": said})


def test_todays_outlook_is_rewritten_in_place_without_a_second_push(monkeypatch):
    out, rows = _said_today(monkeypatch)
    assert out["stored"] == 0 and out["refreshed"] == 1 and len(rows) == 1
    assert rows[0]["text"]["en"]["body"] != "old" and rows[0]["detail"]["refreshed_at"] == NOW.isoformat() and "notified_at" not in rows[0]


def test_the_outlook_is_not_rewritten_again_within_the_hour(monkeypatch):
    out, rows = _said_today(monkeypatch, detail={"refreshed_at": (NOW - timedelta(minutes=20)).isoformat()})
    assert out["refreshed"] == 0 and rows[0]["text"]["en"]["body"] == "old"

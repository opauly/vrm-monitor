from datetime import datetime, timedelta, timezone

from victron import devices as dev

NOW = datetime(2026, 10, 15, 3, 0, tzinfo=timezone.utc)        # 21:00 on the 14th in Costa Rica
LOCAL = datetime(2026, 10, 14, 21, 0)
TS = int(NOW.timestamp())


def rec(device, instance, code, raw, text=None, ts=TS):
    return {"Device": device, "instance": instance, "code": code, "rawValue": raw, "formattedValue": str(raw if text is None else text), "timestamp": ts}


def charger(instance, *, today, yesterday, peak=2000, error=0, state=0, ts=TS, model="a115"):
    d = "Solar Charger"
    return [rec(d, instance, "ScM", model, ts=ts), rec(d, instance, "ScS", state, ts=ts), rec(d, instance, "PVP", 0, ts=ts),
            rec(d, instance, "YT", today, ts=ts), rec(d, instance, "YY", yesterday, ts=ts), rec(d, instance, "MCPY", peak, ts=ts),
            rec(d, instance, "ScERR", error, "No error" if error == 0 else f"Error {error}", ts=ts)]


def battery(online=3, offline=0, blocking=0, soc=60, failure=0):
    d = "Battery Monitor"
    return [rec(d, 512, "mon", online), rec(d, 512, "mof", offline), rec(d, 512, "mbc", blocking), rec(d, 512, "mbd", 0), rec(d, 512, "SOC", soc),
            rec(d, 512, "Bm", "PYLON"), rec(d, 512, "AIE", failure)]


def inverter(units=2, error=0, warn_slot=None):
    d = "VE.Bus System"
    slots = [0, 1, 3, 4][:units]
    out = [rec(d, 274, "S", 9, "Inverting"), rec(d, 274, "ERR", error, "No error" if error == 0 else "VE.Bus Error 4")]
    for s in slots:
        out += [rec(d, 274, f"vs{s}", f"HQ{s}"), rec(d, 274, f"wf{s}", 5 if s == warn_slot else 0)]
    return out


def run(records, existing=None, *, local=LOCAL, now=NOW, reference=None):
    parsed = dev.parse(records)
    ref = reference or max(datetime.fromtimestamp(r["timestamp"], tz=timezone.utc) for r in records)
    return {r["device_key"]: r for r in dev.evaluate(parsed, existing or [], now=now, local=local, reference=ref)}


def test_a_healthy_site_has_every_device_ok():
    rows = run(charger(0, today=3.0, yesterday=3.2) + battery() + inverter())
    assert {k: r["status"] for k, r in rows.items()} == {"charger:0": "ok", "battery:512": "ok", "inverter:274": "ok"}
    assert rows["battery:512"]["label"] == "Pylontech" and rows["battery:512"]["metrics"]["modules_online"] == 3
    assert rows["inverter:274"]["metrics"]["units"] == 2     # slot numbers skip 2 on a four-unit stack; the count is what matters


def test_a_charger_error_is_bad_and_a_single_charger_site_still_gets_the_fault_check():
    rows = run(charger(0, today=3.0, yesterday=3.0, error=2))
    assert rows["charger:0"]["status"] == "bad" and rows["charger:0"]["note"]["code"] == "charger_error"


def test_a_charger_that_stopped_reporting_is_bad():
    old = TS - 3 * 3600
    rows = run(charger(0, today=3.0, yesterday=3.0, ts=old) + charger(1, today=3.0, yesterday=3.0) + battery(),
               reference=NOW)
    assert rows["charger:0"]["status"] == "bad" and rows["charger:0"]["note"]["code"] == "not_reporting"
    assert rows["charger:1"]["status"] == "ok"


def test_battery_modules_offline_or_fewer_than_ever_seen_is_bad():
    assert run(battery(online=2, offline=1))["battery:512"]["note"]["code"] == "modules_offline"
    first = run(battery(online=3))
    dropped = run(battery(online=2), list(first.values()), now=NOW + timedelta(minutes=15))
    assert dropped["battery:512"]["status"] == "bad" and dropped["battery:512"]["note"]["params"] == {"online": 2, "total": 3}


def test_blocking_is_only_a_warning_and_not_when_the_battery_is_full():
    assert run(battery(blocking=1, soc=50))["battery:512"]["status"] == "warn"
    assert run(battery(blocking=1, soc=100))["battery:512"]["status"] == "ok"


def test_inverter_error_missing_unit_and_warning_flags():
    assert run(inverter(error=4))["inverter:274"]["note"]["code"] == "inverter_error"
    first = run(inverter(units=4))
    assert run(inverter(units=3), list(first.values()))["inverter:274"]["note"]["code"] == "units_missing"
    assert run(inverter(warn_slot=1))["inverter:274"]["status"] == "warn"


def test_a_device_gone_from_the_list_is_bad_only_after_two_sweeps():
    first = run(charger(0, today=3.0, yesterday=3.0) + battery())
    one = run(charger(0, today=3.0, yesterday=3.0), list(first.values()))
    assert one["battery:512"]["status"] == "ok" and one["battery:512"]["missing_sweeps"] == 1
    two = run(charger(0, today=3.0, yesterday=3.0), list(one.values()))
    assert two["battery:512"]["status"] == "bad" and two["battery:512"]["note"]["code"] == "missing"


def test_bad_sweeps_are_counted_per_local_day_for_the_health_score():
    first = run(battery(online=3))
    bad = run(battery(online=2), list(first.values()))
    again = run(battery(online=2), list(bad.values()))
    assert again["battery:512"]["state"]["bad_sweeps"] == {"2026-10-14": 2}
    healthy = run(battery(online=3), list(again.values()))
    assert healthy["battery:512"]["state"]["bad_sweeps"] == {"2026-10-14": 2}      # an OK sweep does not add


def test_a_missing_device_keeps_counting_while_it_is_gone():
    first = run(battery())
    one = run(charger(0, today=3.0, yesterday=3.0), list(first.values()))
    two = run(charger(0, today=3.0, yesterday=3.0), list(one.values()))
    three = run(charger(0, today=3.0, yesterday=3.0), list(two.values()))
    assert three["battery:512"]["state"]["bad_sweeps"] == {"2026-10-14": 2}


def ess(system="ESS"):
    return [rec("System", 0, "st", system)]


def test_the_ess_minimum_soc_is_read_for_an_ess_system_and_the_active_limit_wins():
    base = inverter() + ess()
    floor = [rec("System", 0, "H4ms", 40.0)]
    assert run(base + floor)["inverter:274"]["metrics"]["ess_min_soc_pct"] == 40.0
    with_active = floor + [rec("System", 0, "ssl", 65)]
    assert run(base + with_active)["inverter:274"]["metrics"]["ess_min_soc_pct"] == 65
    assert run(base)["inverter:274"]["metrics"]["ess_min_soc_pct"] is None


def test_a_hub1_system_has_a_stored_minimum_but_no_floor_to_respect():
    m = run(inverter() + ess("Hub-1") + [rec("System", 0, "H4ms", 40.0)])["inverter:274"]["metrics"]
    assert m["ess_min_soc_pct"] is None and m["ess_setting_pct"] == 40.0 and m["vrm_system_type"] == "Hub-1"


def run_site(records, site_type="hybrid"):
    parsed = dev.parse(records)
    ref = max(datetime.fromtimestamp(r["timestamp"], tz=timezone.utc) for r in records)
    return {r["device_key"]: r for r in dev.evaluate(parsed, [], now=NOW, local=LOCAL, reference=ref, site_type=site_type)}


def test_a_hybrid_site_without_an_outage_reserve_is_flagged_but_only_as_a_warning():
    hub1 = run_site(inverter() + ess("Hub-1") + battery())["inverter:274"]
    assert hub1["status"] == "warn" and hub1["note"]["code"] == "reserve_not_enforced"
    low = run_site(inverter() + ess() + [rec("System", 0, "H4ms", 10.0)] + battery())["inverter:274"]
    assert low["status"] == "warn" and low["note"] == {"code": "reserve_low", "params": {"floor": 10.0, "recommended": 30}}
    ok = run_site(inverter() + ess() + [rec("System", 0, "H4ms", 40.0)] + battery())["inverter:274"]
    assert ok["status"] == "ok"


def test_the_reserve_check_is_only_for_hybrid_sites_with_a_battery():
    assert run_site(inverter() + ess("Hub-1") + battery(), site_type="off_grid")["inverter:274"]["status"] == "ok"
    assert run_site(inverter() + ess("Hub-1"), site_type="hybrid")["inverter:274"]["status"] == "ok"      # no battery device
    bad = run_site(inverter(error=4) + ess("Hub-1") + battery())["inverter:274"]
    assert bad["status"] == "bad" and bad["note"]["code"] == "inverter_error"                              # a real fault outranks it


def test_a_reserve_held_by_something_vrm_cannot_see_silences_the_reserve_warning():
    records = inverter() + ess("Hub-1") + battery()
    parsed = dev.parse(records)
    ref = max(datetime.fromtimestamp(r["timestamp"], tz=timezone.utc) for r in records)
    rows = {r["device_key"]: r for r in dev.evaluate(parsed, [], now=NOW, local=LOCAL, reference=ref, site_type="hybrid", reserve_set_by_hand=True)}
    assert rows["inverter:274"]["status"] == "ok"


# ── charger yield history (a charger closes its day at dusk, not at midnight) ─────────────────────
DAY14 = datetime(2026, 10, 14, 15, 0)        # local, afternoon of the 14th
NIGHT14 = datetime(2026, 10, 14, 22, 0)      # local, after the chargers shut down
DAY15 = datetime(2026, 10, 15, 15, 0)


def sweep(records, existing, local):
    parsed = dev.parse(records)
    ref = max(datetime.fromtimestamp(r["timestamp"], tz=timezone.utc) for r in records)
    return {r["device_key"]: r for r in dev.evaluate(parsed, list(existing.values()), now=NOW, local=local, reference=ref)}


def a_day(rows, local_day, local_night, totals, *, peaks=None):
    """One production day for chargers 0..n-1: a daytime sweep with 'today' climbing, then a night sweep after the
    chargers closed the day (today back to 0, yesterday = the day's total)."""
    day_records, night_records = [], []
    for i, total in enumerate(totals):
        day_records += charger(i, today=total, yesterday=0.0)
        night_records += charger(i, today=0.0, yesterday=total)
    rows = sweep(day_records, rows, local_day)
    return sweep(night_records, rows, local_night)


def test_a_days_total_is_filed_when_today_falls_back_under_the_day_it_was_climbing():
    rows = a_day({}, DAY14, NIGHT14, [3.9, 4.1])
    assert rows["charger:0"]["state"]["daily"] == {"2026-10-14": 3.9} and rows["charger:1"]["state"]["daily"] == {"2026-10-14": 4.1}
    assert rows["charger:0"]["metrics"]["last_kwh"] == 3.9          # the table shows what the charger calls "yesterday"


def test_history_written_by_the_old_midnight_rule_is_discarded():
    old = {"charger:0": {"device_key": "charger:0", "state": {"daily": {"2026-10-13": 1.04, "2026-10-14": 0.0}}}}
    rows = sweep(charger(0, today=2.0, yesterday=1.04), old, DAY15)
    assert rows["charger:0"]["state"]["daily"] == {} and rows["charger:0"]["state"]["daily_v"] == 2


def test_a_charger_that_closed_no_day_while_its_sibling_produced_is_bad_straight_away():
    rows = {}
    rows = sweep(charger(0, today=3.9, yesterday=0.0) + charger(1, today=0.0, yesterday=0.01, peak=2, model="a058"), rows, DAY14)
    rows = sweep(charger(0, today=0.0, yesterday=3.9) + charger(1, today=0.0, yesterday=0.01, peak=2, model="a058"), rows, NIGHT14)
    assert rows["charger:1"]["status"] == "bad" and rows["charger:1"]["note"]["code"] == "no_output"
    assert rows["charger:0"]["status"] == "ok"


def test_a_sibling_that_has_not_filed_its_day_yet_is_not_blamed():
    rows = sweep(charger(0, today=3.9, yesterday=0.0) + charger(1, today=4.1, yesterday=0.0), {}, DAY14)
    rows = sweep(charger(0, today=0.0, yesterday=3.9) + charger(1, today=4.1, yesterday=0.0), rows, NIGHT14)     # 1 has not rolled yet
    assert rows["charger:1"]["status"] == "ok" and rows["charger:0"]["status"] == "ok"


def test_when_every_charger_is_low_it_is_the_weather_not_a_fault():
    rows = {}
    for d in range(5, 12):
        rows = a_day(rows, datetime(2026, 10, d, 15), datetime(2026, 10, d, 22), [10.0, 10.0])
    rows = a_day(rows, DAY14, NIGHT14, [2.0, 2.0])
    assert rows["charger:0"]["status"] == "ok" and rows["charger:1"]["status"] == "ok"


def test_a_charger_far_below_its_own_normal_while_the_other_is_normal_is_warn_then_bad():
    rows = {}
    for d in range(5, 12):
        rows = a_day(rows, datetime(2026, 10, d, 15), datetime(2026, 10, d, 22), [10.0, 10.0])
    rows = a_day(rows, DAY14, NIGHT14, [10.0, 1.5])
    assert rows["charger:1"]["status"] == "warn" and rows["charger:1"]["note"]["code"] == "low_output"
    again = sweep(charger(0, today=0.0, yesterday=10.0) + charger(1, today=0.0, yesterday=1.5), rows, datetime(2026, 10, 14, 23, 0))
    assert again["charger:1"]["status"] == "warn"                    # the same day seen again is still day one
    rows = a_day(again, DAY15, datetime(2026, 10, 15, 22), [10.0, 1.2])
    assert rows["charger:1"]["status"] == "bad"

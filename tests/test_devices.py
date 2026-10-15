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


def test_a_charger_that_made_nothing_while_its_sibling_produced_is_bad_straight_away():
    rows = run(charger(0, today=1.04, yesterday=3.94) + charger(288, today=0.0, yesterday=0.01, peak=2, model="a058"), local=datetime(2026, 10, 14, 10, 0))
    assert rows["charger:288"]["status"] == "bad" and rows["charger:288"]["note"]["code"] == "no_output"
    assert rows["charger:0"]["status"] == "ok"


def test_when_every_charger_is_low_it_is_the_weather_not_a_fault():
    history = {"daily": {f"2026-10-{d:02d}": 10.0 for d in range(5, 12)}}
    existing = [{"device_key": f"charger:{i}", "state": history} for i in (0, 1)]
    rows = run(charger(0, today=2.0, yesterday=2.0) + charger(1, today=2.0, yesterday=2.0), existing)
    assert rows["charger:0"]["status"] == "ok" and rows["charger:1"]["status"] == "ok"


def test_a_charger_far_below_its_own_normal_while_the_other_is_normal_is_warn_then_bad():
    history = {"daily": {f"2026-10-{d:02d}": 10.0 for d in range(5, 12)}}
    existing = [{"device_key": "charger:0", "state": dict(history)}, {"device_key": "charger:1", "state": dict(history)}]
    first = run(charger(0, today=10.0, yesterday=10.0) + charger(1, today=1.5, yesterday=10.0), existing)
    assert first["charger:1"]["status"] == "warn" and first["charger:1"]["note"]["code"] == "low_output"
    # the same day seen again by the next sweep is still day one
    again = run(charger(0, today=10.0, yesterday=10.0) + charger(1, today=1.5, yesterday=10.0), list(first.values()), now=NOW + timedelta(minutes=15))
    assert again["charger:1"]["status"] == "warn"
    # the next evening it is still low: bad
    next_day = run(charger(0, today=10.0, yesterday=10.0) + charger(1, today=1.2, yesterday=1.5), list(again.values()),
                   local=datetime(2026, 10, 15, 21, 0), now=NOW + timedelta(days=1))
    assert next_day["charger:1"]["status"] == "bad"


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


def test_yield_history_is_seeded_from_yesterday_and_kept_from_the_evening_total():
    morning = run(charger(0, today=0.2, yesterday=3.9), local=datetime(2026, 10, 14, 9, 0))
    assert morning["charger:0"]["state"]["daily"] == {"2026-10-13": 3.9}           # "today" is not a total yet
    evening = run(charger(0, today=4.1, yesterday=3.9), list(morning.values()))
    assert evening["charger:0"]["state"]["daily"]["2026-10-14"] == 4.1
    later = run(charger(0, today=4.0, yesterday=3.9), list(evening.values()))
    assert later["charger:0"]["state"]["daily"]["2026-10-14"] == 4.1               # the highest value of the evening wins

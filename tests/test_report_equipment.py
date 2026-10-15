from victron import report_i18n, weekly_report as wr


def d(devices, lang="en"):
    return {"t": report_i18n.get(lang), "devices": devices, "periodStartIso": "2026-10-07", "periodEndIso": "2026-10-13"}


def dev(key, kind, status, n=1, of=1, bad=None):
    return {"device_key": key, "kind": kind, "status": status, "metrics": {"n": n, "of": of}, "state": {"bad_sweeps": bad or {}}}


def test_equipment_rows_put_problems_first_and_count_the_flagged_days_in_the_period():
    rows = wr._equipment_rows(d([
        dev("battery:512", "battery", "ok"),
        dev("charger:0", "charger", "ok", n=1, of=2),
        dev("charger:288", "charger", "bad", n=2, of=2, bad={"2026-10-09": 30, "2026-10-10": 12, "2026-10-11": 3, "2026-09-30": 50}),
    ]))
    assert [(r["label"], r["value"]) for r in rows] == [
        ("Solar charger 2", "Needs attention · 2 day(s)"), ("Solar charger 1", "Working"), ("Battery", "Working")]


def test_a_site_with_no_checked_devices_has_no_equipment_block():
    assert wr._equipment_rows(d([])) == []
    assert wr._equipment_rows(d([dev("charger:0", "charger", "ok")], "es"))[0]["label"] == "Cargador solar"

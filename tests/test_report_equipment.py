from victron import report_i18n, weekly_report as wr


def d(devices, lang="en"):
    return {"t": report_i18n.get(lang), "devices": devices, "periodStartIso": "2026-10-07", "periodEndIso": "2026-10-13"}


def dev(key, kind, status, n=1, of=1, bad=None):
    return {"device_key": key, "kind": kind, "status": status, "metrics": {"n": n, "of": of}, "state": {"bad_sweeps": bad or {}}}


def test_equipment_block_is_a_summary_plus_a_row_for_each_device_that_is_not_fine():
    rows = wr._equipment_rows(d([
        dev("battery:512", "battery", "ok"),
        dev("charger:0", "charger", "ok", n=1, of=2),
        dev("charger:288", "charger", "bad", n=2, of=2, bad={"2026-10-09": 30, "2026-10-10": 12, "2026-10-11": 3, "2026-09-30": 50}),
        dev("inverter:274", "inverter", "ok", bad={"2026-10-12": 9}),       # recovered, but was flagged inside the period
    ]))
    assert [(r["label"], r["value"]) for r in rows] == [
        ("Devices working", "3 / 4"), ("Solar charger 2", "Needs attention · 2 day(s)"), ("Inverter", "Working · 1 day(s)")]


def test_a_healthy_site_costs_one_row_and_one_without_devices_none():
    rows = wr._equipment_rows(d([dev("charger:0", "charger", "ok"), dev("battery:512", "battery", "ok")], "es"))
    assert [(r["label"], r["value"]) for r in rows] == [("Equipos funcionando", "2 / 2")]
    assert wr._equipment_rows(d([])) == []

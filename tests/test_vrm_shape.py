"""victron/vrm_shape.py — the day's lowest battery charge, reported with the hourly shape."""
from datetime import datetime, timezone

import pandas as pd
import pytest

from victron import vrm_shape


class Client:
    def __init__(self, records):
        self.records = records
    def get_diagnostics(self, id_site):
        return {"records": [{"code": c} for c in self.records]}
    def get_stats(self, id_site, **kw):
        self.requested = kw["attribute_codes"]
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        return {"records": {c: [[now_ms - 900_000 * i, v] for i, v in enumerate(vals)] for c, vals in self.records.items() if c in kw["attribute_codes"]}}


@pytest.fixture(autouse=True)
def no_pv(monkeypatch):
    monkeypatch.setattr(vrm_shape, "fetch_pv_power_series", lambda *a, **k: pd.Series(dtype=float))


def test_today_reports_the_lowest_fifteen_minute_soc():
    client = Client({"bp": [-500.0, -300.0], "SOC": [91.0, 77.4, 84.0]})
    shape = vrm_shape.fetch_site_shape(client, 1, range_key="today")
    assert shape["soc_min"] == 77.4 and "SOC" in client.requested


def test_other_ranges_do_not_fetch_or_report_soc():
    client = Client({"bp": [-500.0], "SOC": [50.0]})
    shape = vrm_shape.fetch_site_shape(client, 1, range_key="week")
    assert shape["soc_min"] is None and "SOC" not in client.requested


def test_a_site_without_soc_reports_none_and_still_returns_a_shape():
    shape = vrm_shape.fetch_site_shape(Client({"bp": [-500.0]}), 1, range_key="today")
    assert shape["soc_min"] is None and len(shape["battery"]) == 24


def test_an_unreadable_site_keeps_the_empty_shape_with_the_new_field():
    shape = vrm_shape.fetch_site_shape(Client({}), 1, range_key="today")
    assert shape["soc_min"] is None and shape["solar"] == [None] * 24

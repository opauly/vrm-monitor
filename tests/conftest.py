"""Tests never touch the real database through the stored 15-minute / weather copy.

`samples_store` is the only door to `vrm.site_samples`, `vrm.weather_hourly` and `vrm.weather_daily`. Without this, a test
that reaches a code path using it would read (and could WRITE fake rows into) the live project, because the local
environment holds real credentials. A test that needs the store replaces the functions it uses, as the tests here do.
"""
import pytest

from victron import samples_store


@pytest.fixture(autouse=True)
def no_real_sample_store(monkeypatch):
    def blocked(name):
        raise RuntimeError(f"tests must not use the real database ({name})")
    monkeypatch.setattr(samples_store, "_t", blocked)

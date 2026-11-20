"""What VRM already tells us about a new installation, turned into a starting point for the new-site wizard.

Pure functions (`tests/test_site_prefill.py`). Inputs are three VRM reads the discovery job makes once per new
installation: the installation record (from the user's installation list), `system-overview` (one row per device,
with Victron's own product name) and `diagnostics` (one row per device attribute).

What can be read, and how well:

  inverter        product name ("MultiPlus-II 48/5000/70-95 120V") and how many units → size. The continuous
                  power is taken as 80% of the VA rating, which is what Victron's datasheets give for the
                  MultiPlus-II / Quattro-II family (48/5000 → 4 kW).
  battery         maker and number of modules. The capacity is only known when a battery monitor reports its
                  installed capacity; otherwise the wizard asks, showing the module count.
  system type     a grid on the AC input → hybrid; no grid (none, or only a generator) → off-grid.
  reserve         the ESS "minimum SOC (unless grid fails)", read the same way the device checks read it.
  solar           which chargers / PV inverters there are. The panels' kWp is never reported, so it is asked.
  time zone       the GX device's own setting.

Nothing here is ever saved on its own: it fills the wizard, and the person confirms every value.
"""
from __future__ import annotations

import re

from victron import devices

# Continuous AC power as a share of the VA rating (MultiPlus-II 48/5000 → 4 kW; see the site form's own hint).
CONTINUOUS_SHARE = 0.8

# Usual usable share by chemistry, offered as the default depth of discharge.
LITHIUM_DOD_PCT = 90.0
LEAD_DOD_PCT = 50.0
_LITHIUM_MAKERS = ("PYLON", "BYD", "VICTRON", "FREEDOM", "DYNESS", "HUBBLE", "SOLARK", "DISCOVER", "BSL", "FORTRESS", "LG", "SHOTO")

_VA_RE = re.compile(r"\b(?:12|24|48)/(\d{3,5})\b")
_VOLT_RE = re.compile(r"\b(12|24|48)/\d{3,5}\b")


def _records(diagnostics) -> list[dict]:
    recs = diagnostics.get("records", diagnostics) if isinstance(diagnostics, dict) else diagnostics
    return [r for r in recs if isinstance(r, dict)] if isinstance(recs, list) else []


def _overview_devices(overview) -> list[dict]:
    recs = overview.get("records", overview) if isinstance(overview, dict) else overview
    if isinstance(recs, dict):
        recs = recs.get("devices")
    return [d for d in recs if isinstance(d, dict)] if isinstance(recs, list) else []


def _code(records: list[dict], code: str, device: str | None = None):
    for r in records:
        if r.get("code") == code and (device is None or r.get("Device") == device):
            return r
    return None


def _num(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _count_by_name(items: list[dict]) -> list[dict]:
    out: dict[str, int] = {}
    for d in items:
        name = (d.get("productName") or d.get("name") or "").strip()
        if name:
            out[name] = out.get(name, 0) + 1
    return [{"model": k, "count": v} for k, v in out.items()]


def _inverter(devs: list[dict], records: list[dict]) -> dict | None:
    vebus = [d for d in devs if d.get("name") == "VE.Bus System"]
    if not vebus:
        return None
    d = vebus[0]
    model = (d.get("productName") or "").strip()
    per_phase = ((d.get("vid") or {}).get("devicesPerPhase") or {}) if isinstance(d.get("vid"), dict) else {}
    units = sum(int(v) for v in per_phase.values() if isinstance(v, (int, float)))
    if not units:
        units = len([r for r in records if r.get("Device") == "VE.Bus System" and re.fullmatch(r"vs\d", r.get("code") or "")]) or 1
    layout = (d.get("vid") or {}).get("enumValue") if isinstance(d.get("vid"), dict) else None
    m = _VA_RE.search(model)
    va_each = float(m.group(1)) if m else None
    kw_total = round(va_each * units * CONTINUOUS_SHARE / 1000, 1) if va_each else None
    volt = _VOLT_RE.search(model)
    return {"model": model, "units": units, "layout": layout, "va_each": va_each, "kw_total": kw_total,
            "battery_voltage": int(volt.group(1)) if volt else None}


def _battery(devs: list[dict], records: list[dict], system_voltage: int | None) -> dict | None:
    has_monitor = any(d.get("name") == "Battery Monitor" for d in devs) or any(r.get("Device") == "Battery Monitor" for r in records)
    if not has_monitor:
        return None
    maker_raw = str((_code(records, "Bm", "Battery Monitor") or {}).get("formattedValue") or "").strip()
    product = next((d.get("productName") for d in devs if d.get("name") == "Battery Monitor"), None)
    modules = _num((_code(records, "mon", "Battery Monitor") or {}).get("rawValue"))
    kwh = None
    # A shunt / battery monitor with a configured capacity (Ah): the bank is that × the system voltage. A BMS-managed
    # battery (Pylontech and the like) reports its module count but not the module size, so it is asked.
    for r in records:
        if r.get("Device") == "Battery Monitor" and "capacity" in str(r.get("description") or "").lower():
            ah = _num(r.get("rawValue"))
            if ah and ah > 0 and system_voltage:
                kwh = round(ah * system_voltage / 1000, 2)
                break
    label = devices._BATTERY_MAKERS.get(maker_raw.upper(), maker_raw.title()) if maker_raw else (product or "")
    lithium = any(maker_raw.upper().startswith(m) for m in _LITHIUM_MAKERS) or "lithium" in (product or "").lower()
    return {"maker": label or None, "product": product, "modules": int(modules) if modules else None, "kwh": kwh,
            "chemistry": "lithium" if lithium else None, "dod_pct": LITHIUM_DOD_PCT if lithium else None}


def _has_grid(installation: dict, records: list[dict]) -> bool | None:
    inputs = [str((_code(records, c) or {}).get("formattedValue") or "").strip().lower() for c in ("si1", "si2")]
    if any(i == "grid" or i == "shore" for i in inputs):
        return True
    ait = str((_code(records, "AIT") or {}).get("formattedValue") or "").strip().lower()
    if ait == "grid":
        return True
    if installation.get("hasMains") in (1, True):
        return True
    if any(inputs) or installation.get("hasMains") in (0, False):
        return False
    return None


def prefill(installation: dict, overview, diagnostics) -> dict:
    """The wizard's starting point. Every value may be None (not readable); `ask` lists what the person must give."""
    records = _records(diagnostics)
    devs = _overview_devices(overview)
    inverter = _inverter(devs, records)
    battery = _battery(devs, records, (inverter or {}).get("battery_voltage"))
    grid = _has_grid(installation, records)
    generator = bool(installation.get("hasGenerator")) or any(
        str((_code(records, c) or {}).get("formattedValue") or "").strip().lower() == "generator" for c in ("si1", "si2"))
    system_type = "hybrid" if grid else "off_grid" if grid is False else None
    tz = installation.get("timezone") or (_code(records, "tz", "Gateway") or {}).get("formattedValue")
    chargers = _count_by_name([d for d in devs if d.get("name") in ("Solar Charger", "Solar charger")])
    pv_inverters = _count_by_name([d for d in devs if d.get("name") == "PV Inverter"])
    reserve = devices.ess_floor(records) if grid else None

    fields = {
        "display_name": (installation.get("name") or "").strip() or None,
        "system_type": system_type,
        "timezone": tz or None,
        "inverter_nominal_kw": (inverter or {}).get("kw_total"),
        "battery_nominal_kwh": (battery or {}).get("kwh"),
        "battery_dod_pct": (battery or {}).get("dod_pct"),
        "reserve_soc_pct": reserve,
        "pv_kwp": None,          # never reported by VRM
        "latitude": None, "longitude": None,
    }
    ask = [k for k in ("pv_kwp", "battery_nominal_kwh", "inverter_nominal_kw", "system_type", "latitude") if fields.get(k) is None]
    if battery is None and "battery_nominal_kwh" in ask:
        ask.remove("battery_nominal_kwh")      # no battery at all: nothing to size
    return {
        "fields": fields,
        "equipment": {
            "gateway": next((d.get("productName") for d in devs if d.get("name") == "Gateway"), None),
            "inverter": inverter,
            "battery": battery,
            "chargers": chargers,
            "pv_inverters": pv_inverters,
            "grid_meter": next((d.get("productName") for d in devs if d.get("name") == "Grid meter"), None),
            "has_grid": grid,
            "has_generator": generator,
        },
        "ask": ask,
    }

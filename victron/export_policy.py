"""May this site send solar to the grid, and how much? Read from the GX's own ESS settings in VRM diagnostics.

A site that may not export (or only up to a limit) cannot use more solar than its loads, its battery and that
limit take: once the battery is full, the panels are held back on purpose (a Fronius shows "Running (Throttled)",
an MPPT backs off). The forecast and the daily summary use this so a capped day is not read as poor solar.

The settings (Gateway device in diagnostics, checked across the fleet 2026-11-21):
  mfp    "Maximum configured feed-in power": -1 = no limit, 0 = no export, N = up to N W
  H4of   "Feed excess DC-coupled PV into the grid" (solar chargers): On / Off
  H4pf   "Feed AC-coupled PV into the grid" (PV inverters such as a Fronius): On / Off

A path whose switch is Off cannot export at all; with every path present Off, nothing can. A grid meter that sits
on a main panel rather than at the utility (Kame House) is handled by the same settings: mfp 0 is what keeps the
site from feeding the grid. The PV inverter's own "Throttled" status is NOT used: one site shows it at a 10 kW
limit, i.e. not held back at all.
"""
from __future__ import annotations

NONE, LIMITED, FREE = "none", "limited", "free"


def _records(diagnostics) -> list[dict]:
    records = diagnostics.get("records", diagnostics) if isinstance(diagnostics, dict) else diagnostics
    return [r for r in records if isinstance(r, dict)] if isinstance(records, list) else []


def _gateway(records: list[dict], code: str):
    for r in records:
        if r.get("code") == code and r.get("Device") in ("Gateway", None):
            return r
    return None


def _switch(rec: dict | None) -> bool | None:
    if rec is None:
        return None
    raw, text = rec.get("rawValue"), str(rec.get("formattedValue") or "").strip().lower()
    if text in ("on", "off"):
        return text == "on"
    try:
        return float(raw) != 0
    except (TypeError, ValueError):
        return None


def read(diagnostics, *, system_type: str | None = None) -> dict | None:
    """`{"mode": "none"|"limited"|"free", "limit_w": 0|N|None}`, or None when the GX does not say (no ESS settings in
    diagnostics). An off-grid site has nowhere to export: mode none."""
    if system_type == "off_grid":
        return {"mode": NONE, "limit_w": 0}
    records = _records(diagnostics)
    devices = {r.get("Device") for r in records}
    has_dc = "Solar Charger" in devices or any(r.get("code") == "PVP" for r in records)
    has_ac = "PV Inverter" in devices or any(str(r.get("description") or "").lower().startswith("pv - ac-coupled") for r in records)
    dc_on, ac_on = _switch(_gateway(records, "H4of")), _switch(_gateway(records, "H4pf"))
    mfp_rec = _gateway(records, "mfp")
    try:
        mfp = float(mfp_rec.get("rawValue")) if mfp_rec is not None else None
    except (TypeError, ValueError):
        mfp = None
    if mfp is None and dc_on is None and ac_on is None:
        return None

    paths = [on for present, on in ((has_dc, dc_on), (has_ac, ac_on)) if present]
    if paths and all(on is False for on in paths):
        return {"mode": NONE, "limit_w": 0}
    if mfp is not None and mfp == 0:
        return {"mode": NONE, "limit_w": 0}
    if mfp is not None and mfp > 0:
        return {"mode": LIMITED, "limit_w": round(mfp)}
    return {"mode": FREE, "limit_w": None}


def capped(policy: dict | None) -> bool:
    return bool(policy) and policy.get("mode") in (NONE, LIMITED)

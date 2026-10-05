"""Fleet alert rules — which conditions are worth telling a customer about.

Pure functions only: they take a site's latest live snapshot (the dict
`victron/vrm_live.py:fetch_live_snapshot()` returns, or the stored
`vrm.site_snapshots` row) plus a little context, and say which alert
conditions are active, cleared, or unknown. Nothing here touches the
database, sends mail or reads the clock on its own, so every rule is
testable with plain dicts (`tests/test_alerts.py`). Persisting open/resolved
state and delivering notifications live in `vrm_api/alerts_service.py`.

Five alert kinds (PLAN: first notification set, 2026-10-05):

  site_offline    no fresh reading for 45+ minutes
  grid_outage     the AC input voltage is gone on a grid-connected site
  low_battery     state of charge at or under a threshold
  system_alarm    overload, DC ripple, temperature fault, cell imbalance
  vrm_link_broken the customer's VRM token stopped working (customer-level)

A rule returns a `Condition` with `active=True` (raise / keep it open),
`active=False` (it is definitely fine now — resolve an open alert), or
returns nothing for that kind (we cannot tell right now — leave any open alert
exactly as it is). That third state matters: while a site is offline its
other readings are stale, so they must neither raise nor clear anything.

Thresholds use hysteresis (open at one level, resolve at a higher one) so a
reading hovering around a limit does not open and close an alert every
15-minute sweep.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

SITE_OFFLINE = "site_offline"
GRID_OUTAGE = "grid_outage"
LOW_BATTERY = "low_battery"
SYSTEM_ALARM = "system_alarm"
VRM_LINK_BROKEN = "vrm_link_broken"
KINDS = (SITE_OFFLINE, GRID_OUTAGE, LOW_BATTERY, SYSTEM_ALARM, VRM_LINK_BROKEN)

WARNING = "warning"
CRITICAL = "critical"

# Same 45-minute freshness `fleetOverviewCore.ts:_ONLINE_WITHIN_MS` uses for
# "Online" on the dashboard (3x the 15-minute sweep, tolerating one missed run)
# so an alert and the dashboard badge can never disagree.
OFFLINE_AFTER = timedelta(minutes=45)

LOW_BATTERY_OPEN_PCT = 20.0
LOW_BATTERY_CRITICAL_PCT = 10.0
LOW_BATTERY_RESOLVE_PCT = 25.0

# Grid outage = AC INPUT VOLTAGE absence (`IV1`/`IV2`), exactly the signal the
# historical outage detector trusts (`victron/vrm_daily.py:_grid_outages()`).
# NOT the inverter's "active input" flag (`AI`, 240 = disconnected): found
# live 2026-10-05 that Vista Atenas M1/M2 — which import grid power every day
# and have no recorded outages — read AI=240 while grid voltage was present
# (the inverter opens its input relay while solar and battery carry the load),
# so `AI` would have raised a false outage on them.
#
# The stats API returns a 15-minute AVERAGE, and Costa Rica is 120/240 V split
# phase (~120 V per leg), so a voltage under 60 V means the input was dead for
# at least half of the bucket (~8 minutes or more); back above 100 V is
# clearly restored. In between, an open alert stays open.
GRID_V_OPEN = 60.0
GRID_V_RESOLVE = 100.0

# A site only counts as "grid-connected" for outage purposes if it actually
# imported from the grid in the last few days — an off-grid or genset-only
# site has a dead AC input as its normal state (the same exclusion
# `_grid_outages()` makes with `_GRID_SITE_MIN_V`).
GRID_SEEN_WITHIN_DAYS = 7

# Non-critical alarms (overload) flicker on load spikes; require them in two
# consecutive sweeps. Critical alerts are rare and serious: raised at once.
# VRM's own `low_battery` alarm is deliberately excluded — the LOW_BATTERY rule
# above says the same thing from the SOC, with hysteresis and severity.
_DEBOUNCED_ALARMS = ("overload",)
_CRITICAL_ALERT_KEYS = ("dc_ripple", "temp_fault", "cell_imbalance")


@dataclass(frozen=True)
class Condition:
    kind: str
    customer_id: str
    site_id: str | None
    active: bool
    severity: str = WARNING
    detail: dict = field(default_factory=dict)

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.customer_id, self.site_id or "", self.kind)


def _parse_ts(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _num(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _grid_voltage(raw: dict) -> float | None:
    """Highest AC-input voltage across both legs (phase 2 is absent on
    single-phase sites), or None if the snapshot has neither."""
    values = [v for v in (_num(raw.get("IV1")), _num(raw.get("IV2"))) if v is not None]
    return max(values) if values else None


def _raw(snapshot: dict | None) -> dict:
    raw = (snapshot or {}).get("raw")
    return raw if isinstance(raw, dict) else {}


def _active_alarm_keys(snapshot: dict | None) -> tuple[list[str], list[str]]:
    """(debounced non-critical keys, critical keys) currently true."""
    raw = _raw(snapshot)
    alarms = raw.get("alarms") if isinstance(raw.get("alarms"), dict) else {}
    critical = raw.get("critical_alerts") if isinstance(raw.get("critical_alerts"), dict) else {}
    return (
        [k for k in _DEBOUNCED_ALARMS if alarms.get(k) is True],
        [k for k in _CRITICAL_ALERT_KEYS if critical.get(k) is True],
    )


def evaluate_site(
    *,
    site: dict,
    snapshot: dict | None,
    previous: dict | None,
    open_kinds: set[str],
    grid_imported_recently: bool,
    now: datetime,
) -> list[Condition]:
    """Conditions for one site.

    `site` needs `site_id`, `customer_id`, `system_type`. `snapshot` is the
    reading this sweep just fetched (None if the fetch failed or returned
    nothing); `previous` is the stored row from before this sweep. `open_kinds`
    is which alert kinds are currently open for this site (drives the
    hysteresis). `grid_imported_recently` is whether `energy_daily` shows
    grid import in the last GRID_SEEN_WITHIN_DAYS days.
    """
    customer_id, site_id = site["customer_id"], site["site_id"]

    def cond(kind: str, active: bool, severity: str = WARNING, **detail) -> Condition:
        return Condition(kind, customer_id, site_id, active, severity, detail)

    reading = snapshot or previous
    last_seen = _parse_ts((reading or {}).get("captured_at"))
    if last_seen is None:
        return []  # never reported: nothing to say yet, not an outage

    age = now - last_seen
    if age > OFFLINE_AFTER:
        # Everything else is stale — report only the offline alert and leave
        # any other open alert untouched until the site is back.
        return [cond(SITE_OFFLINE, True, WARNING, last_seen=last_seen.isoformat(),
                     minutes_silent=int(age.total_seconds() // 60))]

    out = [cond(SITE_OFFLINE, False)]
    raw = _raw(reading)

    # ── low battery ───────────────────────────────────────────────────────
    soc = _num((reading or {}).get("soc_pct"))
    if soc is not None:
        limit = LOW_BATTERY_RESOLVE_PCT if LOW_BATTERY in open_kinds else LOW_BATTERY_OPEN_PCT
        if soc <= limit:
            out.append(cond(LOW_BATTERY, True, CRITICAL if soc <= LOW_BATTERY_CRITICAL_PCT else WARNING,
                            soc_pct=round(soc, 1)))
        else:
            out.append(cond(LOW_BATTERY, False))

    # ── grid outage ───────────────────────────────────────────────────────
    # Unknown (no condition) when the snapshot carries no AC-input voltage,
    # same as the historical path where outages "cannot be detected".
    grid_v = _grid_voltage(raw)
    if site.get("system_type") != "off_grid" and grid_v is not None:
        soc_detail = None if soc is None else round(soc, 1)
        if grid_v >= GRID_V_RESOLVE:
            out.append(cond(GRID_OUTAGE, False))
        elif grid_v < GRID_V_OPEN and grid_imported_recently:
            out.append(cond(GRID_OUTAGE, True, WARNING, soc_pct=soc_detail, ac_input_v=round(grid_v)))
        elif GRID_OUTAGE in open_kinds:
            # Hysteresis band (60-100 V), or a site that stopped importing:
            # an alert that is already open stays open until clearly restored.
            out.append(cond(GRID_OUTAGE, True, WARNING, soc_pct=soc_detail, ac_input_v=round(grid_v)))

    # ── system alarms ─────────────────────────────────────────────────────
    soft_now, critical_now = _active_alarm_keys(reading)
    soft_before, _ = _active_alarm_keys(previous) if snapshot is not None else ([], [])
    soft_confirmed = [k for k in soft_now if k in soft_before or SYSTEM_ALARM in open_kinds]
    active_keys = critical_now + soft_confirmed
    if active_keys:
        out.append(cond(SYSTEM_ALARM, True, CRITICAL if critical_now else WARNING, alarms=active_keys))
    elif not soft_now:
        out.append(cond(SYSTEM_ALARM, False))
    # else: an unconfirmed first sighting of a debounced alarm — unknown.

    return out


def evaluate_customer(*, customer: dict) -> Condition | None:
    """Customer-level condition: the stored VRM token stopped working.

    Mirrors `VrmConnectionBanner` (the in-app banner): not connected AND an
    auth failure was recorded. `vrm_token_last_error` is only ever set by a
    failed sync, whereas `vrm_token_revoked_at` is also stamped by a deliberate
    Disconnect — so requiring BOTH means a customer who disconnects on purpose
    is never told their link "broke".
    """
    if not customer.get("vrm_token_secret_id"):
        return None
    broken = bool(customer.get("vrm_token_revoked_at")) and bool(customer.get("vrm_token_last_error"))
    return Condition(VRM_LINK_BROKEN, customer["id"], None, broken, CRITICAL if broken else WARNING, {})


@dataclass
class Transitions:
    opened: list[Condition] = field(default_factory=list)
    escalated: list[tuple[dict, Condition]] = field(default_factory=list)
    updated: list[tuple[dict, Condition]] = field(default_factory=list)
    resolved: list[dict] = field(default_factory=list)


def reconcile(conditions: list[Condition], open_alerts: list[dict]) -> Transitions:
    """Compare what the rules say now with what is currently open.

    `open_alerts` are `vrm.alerts` rows with status 'open'. Returns what to
    open, what to resolve, and which open ones changed (`escalated` = warning
    became critical, worth telling the customer again; `updated` = same
    severity, fresher detail only).
    """
    by_key = {(a["customer_id"], a.get("site_id") or "", a["kind"]): a for a in open_alerts}
    result = Transitions()
    for c in conditions:
        existing = by_key.get(c.key)
        if c.active and existing is None:
            result.opened.append(c)
        elif c.active and existing is not None:
            if c.severity == CRITICAL and existing.get("severity") != CRITICAL:
                result.escalated.append((existing, c))
            elif c.detail != (existing.get("detail") or {}):
                result.updated.append((existing, c))
        elif not c.active and existing is not None:
            result.resolved.append(existing)
    return result

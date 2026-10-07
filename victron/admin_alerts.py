"""Fleet-health alerts for the ADMIN — "is the monitor itself working?"

`victron/alerts.py` tells a customer about THEIR site. These rules watch the
system that produces those alerts, because when it breaks nobody is told
anything: customers see stale numbers and the admin finds out by chance.

Four kinds:

  fleet_offline   many sites went quiet at the same time — almost never forty
                  coincidences, nearly always VRM, a credential, or our servers
  fetch_failing   most of the sites this sweep tried to read could not be read
  sweep_stale     the ~15-minute snapshot sweep has stopped running
  history_stale   the daily history sync has stopped (no new `energy_daily` day)

Pure functions, like the customer rules: plain values in, `Condition`s out, no
database, mail or clock. Persistence and delivery are `vrm_api/admin_alerts.py`.
The same three states apply — active (raise / keep open), inactive (resolve),
nothing returned (cannot tell right now: leave any open alert as it is) — and
thresholds use hysteresis so a figure hovering at a limit doesn't flap.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

FLEET_OFFLINE = "fleet_offline"
FETCH_FAILING = "fetch_failing"
SWEEP_STALE = "sweep_stale"
HISTORY_STALE = "history_stale"
KINDS = (FLEET_OFFLINE, FETCH_FAILING, SWEEP_STALE, HISTORY_STALE)

WARNING = "warning"
CRITICAL = "critical"

# A site counts as silent after the same 45 minutes the customer alerts and the
# dashboard use. Sites silent far longer than a day are a standing condition
# (an abandoned install), not an event, so they are left out of the fleet count
# — otherwise one dead site would permanently count toward "many offline".
OFFLINE_AFTER = timedelta(minutes=45)
STANDING_OFFLINE_AFTER = timedelta(days=2)

# "Many": at least this many sites AND at least this share of the fleet.
FLEET_OFFLINE_MIN_SITES = 3
FLEET_OFFLINE_OPEN_SHARE = 0.30
FLEET_OFFLINE_RESOLVE_SHARE = 0.15
FLEET_OFFLINE_CRITICAL_SHARE = 0.50

# Fetch failures: judged on the sites this sweep actually tried (skipped ones —
# no token, nothing published — were never attempted).
FETCH_MIN_ATTEMPTED = 4
FETCH_OPEN_SHARE = 0.50
FETCH_RESOLVE_SHARE = 0.25

# The sweep runs every 15 minutes: three missed runs is a warning, a few hours
# is serious. Resolves once a run is clearly recent again.
SWEEP_STALE_AFTER = timedelta(minutes=45)
SWEEP_CRITICAL_AFTER = timedelta(hours=3)
SWEEP_RESOLVE_WITHIN = timedelta(minutes=30)

# The history sync adds yesterday each morning, so before it has run the newest
# day is already two days old. Three or more behind means a sync was really
# missed; back to two or fewer means it caught up.
HISTORY_STALE_DAYS = 3
HISTORY_RESOLVE_DAYS = 2


@dataclass(frozen=True)
class Condition:
    kind: str
    active: bool
    severity: str = WARNING
    detail: dict = field(default_factory=dict)


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


def evaluate_fleet_offline(*, sites: list[dict], now: datetime, open_kinds: set[str]) -> list[Condition]:
    """`sites`: [{"site_id", "name", "captured_at"}] — the latest snapshot time
    per active site (None = never reported, which is not an event)."""
    reporting = [s for s in sites if _parse_ts(s.get("captured_at")) is not None]
    if len(reporting) < FLEET_OFFLINE_MIN_SITES:
        return []
    recently_silent = []
    for s in reporting:
        age = now - _parse_ts(s["captured_at"])
        if OFFLINE_AFTER < age <= STANDING_OFFLINE_AFTER:
            recently_silent.append(s)
    total = len(reporting)
    count = len(recently_silent)
    share = count / total
    already_open = FLEET_OFFLINE in open_kinds

    opens = count >= FLEET_OFFLINE_MIN_SITES and share >= FLEET_OFFLINE_OPEN_SHARE
    stays = already_open and count >= 2 and share >= FLEET_OFFLINE_RESOLVE_SHARE
    if opens or stays:
        names = sorted((s.get("name") or s["site_id"]) for s in recently_silent)
        return [Condition(FLEET_OFFLINE, True, CRITICAL if share >= FLEET_OFFLINE_CRITICAL_SHARE else WARNING,
                          {"offline": count, "total": total, "sites": names[:6]})]
    return [Condition(FLEET_OFFLINE, False)]


def evaluate_fetch_failing(*, attempted: int, failed: int, open_kinds: set[str]) -> list[Condition]:
    """`attempted` = sites this sweep tried to read (fetched ok or failed)."""
    if attempted < FETCH_MIN_ATTEMPTED:
        return []
    share = failed / attempted
    limit = FETCH_RESOLVE_SHARE if FETCH_FAILING in open_kinds else FETCH_OPEN_SHARE
    if share >= limit:
        return [Condition(FETCH_FAILING, True, CRITICAL if share >= 0.9 else WARNING, {"failed": failed, "attempted": attempted})]
    return [Condition(FETCH_FAILING, False)]


def evaluate_freshness(*, newest_snapshot_at, newest_energy_date, now: datetime, open_kinds: set[str]) -> list[Condition]:
    """Is data still arriving? `newest_*` are the most recent snapshot time and
    `energy_daily` date across the whole fleet; None = nothing to judge by."""
    out: list[Condition] = []

    newest = _parse_ts(newest_snapshot_at)
    if newest is not None:
        age = now - newest
        if age > SWEEP_STALE_AFTER or (SWEEP_STALE in open_kinds and age > SWEEP_RESOLVE_WITHIN):
            out.append(Condition(SWEEP_STALE, True, CRITICAL if age > SWEEP_CRITICAL_AFTER else WARNING,
                                 {"last_run": newest.isoformat(), "minutes_ago": int(age.total_seconds() // 60)}))
        else:
            out.append(Condition(SWEEP_STALE, False))

    if isinstance(newest_energy_date, str) and newest_energy_date:
        try:
            behind = (now.date() - datetime.fromisoformat(newest_energy_date[:10]).date()).days
        except ValueError:
            behind = None
        if behind is not None:
            if behind >= HISTORY_STALE_DAYS or (HISTORY_STALE in open_kinds and behind > HISTORY_RESOLVE_DAYS):
                out.append(Condition(HISTORY_STALE, True, WARNING, {"newest_day": newest_energy_date[:10], "days_behind": behind}))
            else:
                out.append(Condition(HISTORY_STALE, False))
    return out


@dataclass
class Transitions:
    opened: list[Condition] = field(default_factory=list)
    escalated: list[tuple[dict, Condition]] = field(default_factory=list)
    updated: list[tuple[dict, Condition]] = field(default_factory=list)
    resolved: list[dict] = field(default_factory=list)


def reconcile(conditions: list[Condition], open_alerts: list[dict]) -> Transitions:
    """What to open / escalate / update / resolve, given the open
    `vrm.admin_alerts` rows. One open alert per kind."""
    by_kind = {a["kind"]: a for a in open_alerts}
    result = Transitions()
    for c in conditions:
        existing = by_kind.get(c.kind)
        if c.active and existing is None:
            result.opened.append(c)
        elif c.active:
            if c.severity == CRITICAL and existing.get("severity") != CRITICAL:
                result.escalated.append((existing, c))
            elif c.detail != (existing.get("detail") or {}):
                result.updated.append((existing, c))
        elif existing is not None:
            result.resolved.append(existing)
    return result

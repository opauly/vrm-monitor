"""Victron's alarm log, read by the refresh sweep (rules: `victron/alarm_log.py`).

`run_pass()` takes the alarm-log response the sweep fetched for each site and
  * returns the parsed events per site, which the alert pass uses to raise an overload alert when a
    real (official "Alarm") overload just happened, and
  * stores which kinds of alarm keep repeating in `vrm.site_alarm_patterns`, which the site page and the
    reports show as quiet warnings (never alerts, never part of a score).

Never raises into the sweep: the caller logs and moves on. `ALARM_LOG` = off | on (default on). A site whose
log could not be fetched is left alone, so a failed read does not look like "the warnings went away". A
missing table (SQL not run yet) only skips the storing; the alert half still works.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from database.supabase_client import get_client
from victron import alarm_log

logger = logging.getLogger("vrm_api.alarm_log")


def alarm_log_mode() -> str:
    return "off" if os.environ.get("ALARM_LOG", "on").strip().lower() == "off" else "on"


def _t(name: str):
    return get_client().schema("vrm").table(name)


def run_pass(sites: list[dict], logs_by_site: dict[str, dict], *, now: datetime | None = None) -> dict[str, list[alarm_log.Event]]:
    now = now or datetime.now(timezone.utc)
    events_by_site: dict[str, list[alarm_log.Event]] = {}
    patterns_by_site: dict[str, list[dict]] = {}
    for site in sites:
        site_id = site["site_id"]
        response = logs_by_site.get(site_id)
        if response is None:
            continue
        try:
            events = alarm_log.parse(response)
            events_by_site[site_id] = events
            patterns_by_site[site_id] = alarm_log.patterns(events, now, off_grid=site.get("system_type") == "off_grid")
        except Exception:  # noqa: BLE001 — one odd log must not cost the others
            logger.exception("alarm log: could not read site %s", site_id)
    try:
        _store(patterns_by_site, now)
    except Exception:  # noqa: BLE001 — e.g. the table does not exist yet
        logger.warning("alarm log: could not store the repeated-warning patterns (vrm_alarm_patterns.sql not run?)", exc_info=True)
    return events_by_site


def _store(patterns_by_site: dict[str, list[dict]], now: datetime) -> None:
    if not patterns_by_site:
        return
    site_ids = list(patterns_by_site)
    stored = _t("site_alarm_patterns").select("site_id, category").in_("site_id", site_ids).execute().data or []
    stamp = now.isoformat()
    rows = [{"site_id": site_id, "category": p["category"], "count": p["count"], "window_days": p["window_days"],
             "first_at": p["first_at"], "last_at": p["last_at"], "active": p["active"],
             "device": p["device"], "detail": p["detail"], "updated_at": stamp}
            for site_id, patterns in patterns_by_site.items() for p in patterns]
    if rows:
        _t("site_alarm_patterns").upsert(rows, on_conflict="site_id,category").execute()
    current = {(r["site_id"], r["category"]) for r in rows}
    for row in stored:
        if (row["site_id"], row["category"]) not in current:
            _t("site_alarm_patterns").delete().eq("site_id", row["site_id"]).eq("category", row["category"]).execute()

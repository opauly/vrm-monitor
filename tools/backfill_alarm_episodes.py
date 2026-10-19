"""Re-count past alarm episodes from Victron's official alarm log, then re-score those days.

Until now a site's alarm episodes came from 15-minute averages of the alarm signals, which cannot tell a tolerated
"Warning" (the inverter carrying on) from the real Alarm that shuts it down. The history sync now reads the official log
instead (`victron/alarm_log.py:scored_events`), but days synced earlier still hold the old counts. This replaces them.

  python -m tools.backfill_alarm_episodes                     dry run, last 31 days, every active VRM-API site: prints old vs new
  python -m tools.backfill_alarm_episodes --days 60
  python -m tools.backfill_alarm_episodes --site <site_id>
  python -m tools.backfill_alarm_episodes --apply             writes: replaces vrm.alarm_events in the window, re-scores the days

Only `vrm.alarm_events` (kinds the log calls Overload / Low battery) and each day's health score change. Safe to re-run.
The log is capped (about the last 1000 entries); a window older than its oldest entry is skipped, not zeroed.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from database.supabase_client import get_client
from victron import alarm_log, vrm_series
from vrm_api import forecast_service as fs   # builds the per-customer VRM client


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=31)
    ap.add_argument("--site")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db = get_client().schema("vrm")
    query = db.table("sites").select("site_id, display_name, vrm_installation_id, timezone, customer_id").eq("source", "vrm_api").eq("active", True)
    if args.site:
        query = query.eq("site_id", args.site)
    end = date.today()
    start = end - timedelta(days=args.days - 1)
    labels = {source: label for source, (label, _codes) in vrm_series.ALARM_CATEGORIES.items()}

    for site in query.execute().data or []:
        zone = ZoneInfo(site.get("timezone") or vrm_series.DEFAULT_TZ_NAME)
        try:
            response = fs._vrm_client(site).get_alarm_log(site["vrm_installation_id"], count=1000)
        except Exception as exc:  # noqa: BLE001
            print(f"{site['display_name']:36} skipped: could not read the alarm log ({str(exc)[:60]})")
            continue
        events = alarm_log.parse(response)
        window_start = datetime.combine(start, datetime.min.time(), tzinfo=zone)
        window_end = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=zone)
        records = response.get("records") or []
        capped = len(records) >= 1000 and min((r.get("started") or 0) for r in records) > window_start.timestamp()
        if capped:
            print(f"{site['display_name']:36} skipped: the log is capped and does not reach back {args.days} days")
            continue
        new = alarm_log.scored_events(events, site_id=site["site_id"], labels=labels, zone=zone, start=window_start, end=window_end)
        old = (db.table("alarm_events").select("severity").eq("site_id", site["site_id"])
               .gte("timestamp", window_start.isoformat()).lt("timestamp", window_end.isoformat()).execute().data or [])
        old_n = sum(1 for e in old if e["severity"] in ("WARNING", "ALARM"))
        new_n = sum(1 for e in new if e["severity"] == "WARNING")
        print(f"{site['display_name']:36} episodes {old_n:3} -> {new_n:3}")
        if not args.apply:
            continue
        (db.table("alarm_events").delete().eq("site_id", site["site_id"])
         .gte("timestamp", window_start.isoformat()).lt("timestamp", window_end.isoformat()).execute())
        for i in range(0, len(new), 200):
            db.table("alarm_events").insert(new[i:i + 200]).execute()
        rescored = db.rpc("recompute_health", {"p_site_id": site["site_id"], "p_from": start.isoformat(), "p_to": end.isoformat()}).execute().data
        print(f"{'':36} re-scored {rescored} day(s)")

    if not args.apply:
        print("\nDry run — nothing written. Add --apply to replace the counts and re-score.")


if __name__ == "__main__":
    main()

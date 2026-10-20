"""Re-read the last N days of every VRM-API site from Victron and re-ingest them — the same thing "Sync now" does, for
all sites at once. Use it after a change to how history is mapped (for example battery energy, which used to be left
empty and is now measured from the battery's own power reading).

  python -m tools.resync_history                 dry run, last 31 days, every active VRM-API site: prints what would change
  python -m tools.resync_history --days 14
  python -m tools.resync_history --site <site_id>
  python -m tools.resync_history --apply         writes: energy_daily upserts, alarm events replaced, days re-scored

Only the days up to yesterday are touched (today is still in progress). Safe to re-run.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta

from database.supabase_client import get_client
from victron import ingest as victron_ingest
from victron import vrm_series
from vrm_api import forecast_service as fs   # builds the per-customer VRM client


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=31)
    ap.add_argument("--site")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db = get_client().schema("vrm")
    query = (db.table("sites").select("site_id, display_name, vrm_installation_id, timezone, pv_kwp, battery_usable_kwh, customer_id")
             .eq("source", "vrm_api").eq("active", True))
    if args.site:
        query = query.eq("site_id", args.site)
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=args.days - 1)

    for site in query.execute().data or []:
        try:
            parsed = vrm_series.fetch_and_map(
                fs._vrm_client(site), site["vrm_installation_id"], site["site_id"], start, end,
                pv_kwp=site.get("pv_kwp"), battery_usable_kwh=site.get("battery_usable_kwh"),
                tz=site.get("timezone") or vrm_series.DEFAULT_TZ_NAME)
        except Exception as exc:  # noqa: BLE001
            print(f"{site['display_name']:36} skipped: {str(exc)[:70]}")
            continue
        rows = parsed["rows"]
        measured = [r for r in rows if r.get("battery_discharge_kwh") is not None]
        print(f"{site['display_name']:36} {len(rows):3} days, battery energy measured on {len(measured):3}, "
              f"alarm episodes {sum(1 for e in parsed['alarm_events'] if e['severity'] == 'WARNING')}")
        if args.apply:
            summary = victron_ingest.ingest_parsed(parsed, site["site_id"], source="vrm_api", triggered_by="admin")
            print(f"{'':36} wrote {summary.get('rows_written')} day(s)")

    if not args.apply:
        print("\nDry run — nothing written. Add --apply to re-ingest.")


if __name__ == "__main__":
    main()

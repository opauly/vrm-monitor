"""Fill `vrm.energy_daily.peak_load_w` and `peak_load_at` for days ingested before those columns existed.

Re-reads each VRM-API site's history from Victron, computes only the day's peak AC load and the moment it happened with
the shared daily core (`vrm_daily.peak_power_at`, same rule as new ingestion), and UPDATES those two columns. Nothing
else on the row is touched — unlike `tools.resync_history`, which re-writes every figure. Needs migration 055
(`peak_load_at`) to have been run.

  python -m tools.backfill_peak_load                       dry run, last 90 days, every active VRM-API site
  python -m tools.backfill_peak_load --days 98 --apply     writes
  python -m tools.backfill_peak_load --site <site_id>

Only days up to yesterday, only days that are COMPLETE, only rows whose peak value or peak time is still empty, and only rows that came from
the VRM API (a day that was a CSV upload keeps its own figures). Days Victron no longer returns stay NULL — nothing is
estimated. Safe to re-run.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta

from database.supabase_client import get_client
from victron import vrm_series
from vrm_api import forecast_service as fs   # builds the per-customer VRM client


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=90)
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

    total = 0
    for site in query.execute().data or []:
        existing = {r["date"]: r for r in (db.table("energy_daily").select("date, dump_type, peak_load_w, peak_load_at")
                                           .eq("site_id", site["site_id"]).gte("date", start.isoformat())
                                           .lte("date", end.isoformat()).execute().data or [])}
        wanted = {d for d, r in existing.items() if r["dump_type"] == "vrm_api" and (r["peak_load_w"] is None or r["peak_load_at"] is None)}
        if not wanted:
            print(f"{site['display_name']:36} nothing to fill")
            continue
        try:
            parsed = vrm_series.fetch_and_map(
                fs._vrm_client(site), site["vrm_installation_id"], site["site_id"], start, end,
                pv_kwp=site.get("pv_kwp"), battery_usable_kwh=site.get("battery_usable_kwh"),
                tz=site.get("timezone") or vrm_series.DEFAULT_TZ_NAME)
        except Exception as exc:  # noqa: BLE001
            print(f"{site['display_name']:36} skipped: {str(exc)[:70]}")
            continue
        fills = [(r["date"], r["peak_load_w"], r["peak_load_at"]) for r in parsed["rows"]
                 if r["date"] in wanted and r.get("complete_day") and r.get("peak_load_w") is not None
                 and r.get("peak_load_at") is not None]
        print(f"{site['display_name']:36} {len(fills):3} of {len(wanted):3} empty day(s) can be filled")
        total += len(fills)
        if args.apply:
            for day, peak, at in fills:
                (db.table("energy_daily").update({"peak_load_w": peak, "peak_load_at": at})
                 .eq("site_id", site["site_id"]).eq("date", day).eq("dump_type", "vrm_api").execute())

    print(f"\n{total} day(s) {'written' if args.apply else 'would be written'}.")
    if not args.apply:
        print("Dry run — nothing written. Add --apply to write.")


if __name__ == "__main__":
    main()

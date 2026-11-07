"""Store the 15-minute VRM readings (`vrm.site_samples`) and hourly weather (`vrm.weather_hourly`) for past days.

New days are kept by the daily sync from now on; this reads back what Victron and Open-Meteo still return for the days
before the tables existed. Needs migration 056. Safe to re-run: slots are upserted by (site, time).

  python -m tools.backfill_samples                          dry run: reads Victron, counts, writes nothing
  python -m tools.backfill_samples --days 90 --apply        writes
  python -m tools.backfill_samples --site <site_id> --apply
  python -m tools.backfill_samples --no-weather             readings only

Also sets each complete day's peak load from the stored readings.
Days Victron no longer returns stay empty — nothing is estimated. Today is left to the live top-up.
Needs migrations 056 and 057.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta

from database.supabase_client import get_client
from victron import samples_store, vrm_samples, weather_store
from vrm_api import samples_service
from vrm_api import forecast_service as fs   # builds the per-customer VRM client

CHUNK_DAYS = 30        # one Victron request per month of 15-minute data


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--site")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--no-weather", action="store_true")
    args = ap.parse_args()

    db = get_client().schema("vrm")
    query = (db.table("sites").select("site_id, display_name, vrm_installation_id, timezone, latitude, longitude, customer_id")
             .eq("source", "vrm_api").eq("active", True))
    if args.site:
        query = query.eq("site_id", args.site)
    sites = query.execute().data or []
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=args.days - 1)

    total = 0
    for site in sites:
        client = fs._vrm_client(site)
        if client is None:
            print(f"{site['display_name']:36} skipped: no VRM token")
            continue
        count, failed, peak_days = 0, None, 0
        chunk_start = start
        while chunk_start <= end and failed is None:
            chunk_end = min(chunk_start + timedelta(days=CHUNK_DAYS - 1), end)
            try:
                s, e = vrm_samples.window_epochs(chunk_start, chunk_end, site.get("timezone"))
                frame = vrm_samples.fetch_samples(client, site["vrm_installation_id"], s, e)
                rows = vrm_samples.to_rows(site["site_id"], frame)
                count += len(rows)
                if args.apply and rows:
                    samples_store.store_samples(rows)
                    peak_days += samples_service.store_daily_peaks(site["site_id"], frame, site.get("timezone"))
            except Exception as exc:  # noqa: BLE001
                failed = str(exc)[:70]
            chunk_start = chunk_end + timedelta(days=1)
        note = f"skipped: {failed}" if failed else f"{count:6} slot(s)" + (f", {peak_days} day peak(s) set" if args.apply else "")
        print(f"{site['display_name']:36} {note}")
        total += count

    print(f"\n{total} slot(s) {'written' if args.apply else 'would be written'}.")

    if not args.no_weather:
        places = {weather_store.place(s["latitude"], s["longitude"]) for s in sites
                  if s.get("latitude") is not None and s.get("longitude") is not None}
        written = 0
        for lat, lon in sorted(places):
            weather = weather_store.open_meteo.fetch_weather(lat, lon, "UTC", past_days=min(args.days, 92), forecast_days=weather_store.FORECAST_DAYS)
            rows = weather_store.hourly_rows(weather, lat, lon) if weather else []
            written += len(rows)
            if args.apply and rows:
                samples_store.store_weather(rows)
                samples_store.store_weather_days(weather_store.daily_rows(weather, lat, lon))
        print(f"{written} weather hour(s) for {len(places)} place(s) {'written' if args.apply else 'would be written'}.")
    if not args.apply:
        print("Dry run — nothing written. Add --apply to write.")


if __name__ == "__main__":
    main()

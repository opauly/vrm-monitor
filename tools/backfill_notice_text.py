"""Write the wording of insight notices that were sent before it was stored with them.

`vrm.insight_notices.text` ({"en": {"title", "body"}, "es": {...}}) is what the app's Insights tab shows; new notices get it when
the sweep creates them. Older ones have only their numbers (`detail`), which is enough to word them again exactly as the push and
email did. Only rows with no text are touched, and only that column.

  python -m tools.backfill_notice_text            dry run: says how many it would fill
  python -m tools.backfill_notice_text --apply
"""
from __future__ import annotations

import argparse

from database.supabase_client import get_client
from vrm_api import insight_notices_service as svc


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db = get_client().schema("vrm")
    rows = db.table("insight_notices").select("id, site_id, kind, severity, detail, text").is_("text", "null").execute().data or []
    site_ids = sorted({r["site_id"] for r in rows if r.get("site_id")})
    details = {s["site_id"]: s for s in (db.table("sites").select("site_id, display_name").in_("site_id", site_ids).execute().data or [])} if site_ids else {}
    print(f"{len(rows)} notice(s) without wording")
    for r in rows:
        text = svc._texts(r, details)
        print(f"  #{r['id']} {r['kind']:14} {text['en']['title']}")
        if args.apply:
            db.table("insight_notices").update({"text": text}).eq("id", r["id"]).execute()
    print("done" if args.apply else "\nDry run: nothing written. Add --apply.")


if __name__ == "__main__":
    main()

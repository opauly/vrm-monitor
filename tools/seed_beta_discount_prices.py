"""
Seed the beta-program discount catalog into `vrm.plans` in TEST mode
(PLAN_BETA_PROGRAM.md §2.4/§4.2/§11 Q7), against REAL ONVO price objects
created live via `POST /v1/prices` under each base plan's EXISTING
`onvo_product_id` — no new product is created, unlike `seed_onvo_plans.py`
(which this script mirrors closely; it lives in the Dimensionador repo, not
here, since that's where the base catalog itself is seeded from).

For every currently-sellable base row (`price_variant='standard'`,
`self_serve=true`, `active=true`, `mode='test'`) in `PLAN_KEYS` below, this
creates 9 discount rows at 10/20/.../90% off (§2.4's fixed step size — an
arbitrary percentage was considered and rejected as needlessly complex,
since it would require minting a new ONVO price per invite instead of a
small, enumerable, pre-seeded matrix). Each discount row:
  - shares plan_key/billing_interval/currency/mode/site_limit/account_types
    with its base row,
  - self_serve=false (never shown on the public /signup form or the
    default plan picker — only a customer holding the matching active
    vrm.beta_grants.price_variant may ever see or buy it, per
    get_plans()/_validate_target_plan() in vrm_api/routers/billing.py),
  - price_variant = f"beta_pct_{pct}" (e.g. "beta_pct_30") — SHARED across
    every grant at that discount level for that base plan, not unique per
    grant.

Idempotent the same way `seed_onvo_plans.py` is: checks for an existing
active row per (plan_key, billing_interval, currency, mode, price_variant)
first and skips creating a new ONVO price if one is already seeded, so this
is safe to re-run — e.g. after a new base plan/interval is added to
PLAN_KEYS, to backfill just its discount rows.

Safety discipline, same as `seed_onvo_plans.py`/`onvo_probe.py`:
  - ONVO_SECRET_KEY is never printed, logged, or included in any exception
    message.
  - Refuses to run unless ONVO_MODE == 'test' AND the secret key itself
    looks like a test key — this script must never create a live-mode
    price.
  - Writes vrm.plans rows via `database.supabase_client.get_client()`,
    this repo's established Supabase access pattern
    (SUPABASE_SERVICE_ROLE_KEY).

Usage:
    python -m tools.seed_beta_discount_prices
"""
from __future__ import annotations

import os
import sys
import time

import requests
from dotenv import load_dotenv

load_dotenv()

from database.supabase_client import get_client

BASE_URL = "https://api.onvopay.com/v1"

MODE = os.environ.get("ONVO_MODE")
SECRET_KEY = os.environ.get("ONVO_SECRET_KEY")

if not SECRET_KEY:
    print("ONVO_SECRET_KEY not set in the environment. Aborting.", file=sys.stderr)
    sys.exit(1)

if MODE != "test" or not SECRET_KEY.startswith("onvo_test_secret_key_"):
    print(
        "ONVO_MODE is not 'test', or ONVO_SECRET_KEY does not look like a test key. "
        "Refusing to run — this script must never create a live-mode price.",
        file=sys.stderr,
    )
    sys.exit(1)

HEADERS = {"Authorization": f"Bearer {SECRET_KEY}", "Content-Type": "application/json"}

# The base (plan_key, billing_interval) pairs to seed discount rows for.
# Kept as an explicit list, not "every row in vrm.plans", so adding a new
# base plan/interval to the real catalog doesn't silently also add it here
# — re-run this script with the new pair added once that plan is ready to
# be offered at a discount too (§10 risk: "re-seeding when the catalog
# changes").
PLAN_KEYS = [
    ("starter", "month"),
    ("starter", "year"),
    ("growth", "month"),
    ("growth", "year"),
]

# Fixed 10% steps, 10..90 — §2.4. 0% (= the standard price) and 100% (a
# real $0 subscription, a poor fit since apply_entitlements() still
# requires a card on file) are deliberately not offered; use a plain invite
# or the free_lifetime/free_until tier instead.
DISCOUNT_PERCENTAGES = list(range(10, 100, 10))


def _post(path: str, payload: dict) -> dict:
    r = requests.post(f"{BASE_URL}{path}", headers=HEADERS, json=payload, timeout=30)
    if r.status_code not in (200, 201):
        # Never let the secret key leak into an exception message — it isn't
        # in the response body/headers we're printing here, but keep this
        # explicit rather than assuming.
        raise RuntimeError(f"ONVO {path} -> {r.status_code}: {r.text[:500]}")
    return r.json()


def main() -> None:
    db = get_client()
    vrm = db.schema("vrm")

    print(f"ONVO_MODE={MODE!r}. Seeding beta-program discount rows against REAL test-mode ONVO prices.\n")

    created: list[dict] = []
    skipped_no_base = 0

    for plan_key, billing_interval in PLAN_KEYS:
        base_rows = (
            vrm.table("plans")
            .select("id, plan_key, billing_interval, currency, amount_minor, mode, "
                    "onvo_product_id, site_limit, account_types")
            .eq("plan_key", plan_key)
            .eq("billing_interval", billing_interval)
            .eq("price_variant", "standard")
            .eq("mode", "test")
            .eq("active", True)
            .execute()
            .data
        )
        if not base_rows:
            print(f"  SKIP  {plan_key}/{billing_interval}: no active standard row found in test mode "
                  f"— seed the base catalog first.")
            skipped_no_base += 1
            continue

        base = base_rows[0]
        print(f"── {plan_key} / {billing_interval} (base ${base['amount_minor'] / 100:.2f}) " + "─" * 20)

        for pct in DISCOUNT_PERCENTAGES:
            price_variant = f"beta_pct_{pct}"

            existing = (
                vrm.table("plans")
                .select("id, onvo_price_id")
                .eq("plan_key", plan_key)
                .eq("billing_interval", billing_interval)
                .eq("currency", base["currency"])
                .eq("mode", "test")
                .eq("price_variant", price_variant)
                .eq("active", True)
                .limit(1)
                .execute()
                .data
            )
            if existing:
                print(f"  SKIP  {price_variant}: already seeded "
                      f"(vrm.plans.id={existing[0]['id']}, onvo_price_id={existing[0]['onvo_price_id']})")
                continue

            discounted_amount_minor = round(base["amount_minor"] * (100 - pct) / 100)

            # ONVO's price-creation schema does not accept `description` at
            # all (confirmed live when the base catalog was seeded) — only
            # products do, and this reuses the base plan's existing product,
            # so no product name/description is created here either.
            price = _post("/prices", {
                "productId": base["onvo_product_id"],
                "currency": base["currency"],
                "unitAmount": discounted_amount_minor,
                "type": "recurring",
                "recurring": {"interval": billing_interval, "intervalCount": 1},
            })
            price_id = price["id"]
            print(f"  OK    created ONVO price {price_id} "
                  f"({price_variant}, unitAmount={discounted_amount_minor})")
            time.sleep(0.3)

            row = (
                vrm.table("plans")
                .insert({
                    "plan_key": plan_key,
                    "billing_interval": billing_interval,
                    "currency": base["currency"],
                    "amount_minor": discounted_amount_minor,
                    "mode": "test",
                    "onvo_product_id": base["onvo_product_id"],
                    "onvo_price_id": price_id,
                    "site_limit": base["site_limit"],
                    "account_types": base["account_types"],
                    "self_serve": False,
                    "price_variant": price_variant,
                    "active": True,
                    "sort_order": 0,
                })
                .execute()
                .data[0]
            )
            print(f"  OK    inserted vrm.plans row {row['id']}")
            created.append({
                "plan_key": plan_key, "billing_interval": billing_interval, "price_variant": price_variant,
                "amount_minor": discounted_amount_minor, "onvo_price_id": price_id, "vrm_plans_id": row["id"],
            })

        print()

    print("═" * 68)
    if created:
        print(f"Created {len(created)} vrm.plans discount row(s) this run:")
        for c in created:
            print(f"  {c['plan_key']:<8} {c['billing_interval']:<6} {c['price_variant']:<14} "
                  f"${c['amount_minor'] / 100:>7.2f}  onvo_price_id={c['onvo_price_id']}  "
                  f"vrm.plans.id={c['vrm_plans_id']}")
    else:
        print("Nothing new created this run.")
    if skipped_no_base:
        print(f"{skipped_no_base} (plan_key, billing_interval) pair(s) had no base row and were skipped.")

    all_rows = (
        db.schema("vrm").table("plans")
        .select("plan_key, billing_interval, currency, amount_minor, price_variant, self_serve, active")
        .eq("mode", "test")
        .neq("price_variant", "standard")
        .order("plan_key")
        .order("billing_interval")
        .order("price_variant")
        .execute()
        .data
    )
    print(f"\nAll beta discount rows in mode='test' after this run ({len(all_rows)}):")
    for r in all_rows:
        print(f"  {r}")
    print("═" * 68)


if __name__ == "__main__":
    main()

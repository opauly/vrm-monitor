-- ────────────────────────────────────────────────────────────
-- vrm.beta_grants — one row per beta-tester grant + vrm.plans.price_variant
-- ────────────────────────────────────────────────────────────
-- PLAN_BETA_PROGRAM.md §4.1/§4.2/§11. An admin invites a specific person as
-- a beta tester on one of three tiers: `free_lifetime` (never expires),
-- `free_until` (expires on a date), or `discounted` (a real ONVO
-- subscription at a reduced, pre-seeded price — see §2.4/§4.2 below). A
-- customer can accumulate grant history over time (e.g. a free grant that
-- later converts to paid), but has at most one `active` grant, enforced by
-- the partial unique index below.
--
-- Entitlement for `free_lifetime`/`free_until` is enforced entirely inside
-- vrm_api/billing.py:apply_entitlements() (§5's new branch), the SAME
-- single writer that already owns vrm.customers.plan/site_limit/
-- billing_status/provisioning_state for every other customer — this table
-- never writes those columns itself. `discounted` grants run through the
-- EXISTING ONVO subscribe/entitlement path unchanged; this table only
-- records which price_variant that tester is allowed to buy.
--
-- Invite pending/accepted state is deliberately NOT stored here — it's
-- derived (§4.4) from vrm.customers.invited_at/activated_at, the same
-- columns every other admin-created customer already has. Storing a
-- second copy of that state would just be a place for it to drift.
--
-- Writers: Next.js admin (lib/server/db/admin.ts) inserts, revokes, and
-- edits a grant. Python (vrm_api/billing.py) only transitions
-- active -> expired / active -> converted and stamps the two
-- *_sent_at reminder gates. Nothing else writes to this table.
--
-- `billing_interval` (below) was added after this table's first version
-- already ran once in production with zero rows in it (Phase 2 testing
-- caught the gap before any real grant ever existed) — the block below
-- backfills it onto an already-created table; CREATE TABLE IF NOT EXISTS
-- further down is a no-op against a table that already exists, so the new
-- column/constraint need their own idempotent statements here too.
ALTER TABLE vrm.beta_grants
  ADD COLUMN IF NOT EXISTS billing_interval text CHECK (billing_interval IN ('month', 'year'));

DO $$
BEGIN
  ALTER TABLE vrm.beta_grants
    ADD CONSTRAINT beta_grants_discounted_needs_interval
    CHECK (
      (tier = 'discounted'  AND billing_interval IS NOT NULL) OR
      (tier <> 'discounted' AND billing_interval IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS vrm.beta_grants (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id             uuid        NOT NULL REFERENCES vrm.customers(id) ON DELETE CASCADE,
  tier                    text        NOT NULL
                                        CHECK (tier IN ('free_lifetime', 'free_until', 'discounted')),
  -- Free tiers: the plan whose plan_limits features apply, copied into
  -- vrm.customers.plan while the grant is active. Discounted: informational
  -- only (the real plan comes from the ONVO subscription's own price row).
  access_plan_key         text        NOT NULL,
  -- Free tiers: sites granted, NULL = unlimited (same convention as
  -- vrm.customers.site_limit). Ignored for `discounted`.
  site_limit              int,
  -- Required iff tier = 'free_until' (a lifetime/discounted grant has no
  -- expiry of its own — a discounted subscription's lifecycle is the
  -- subscription's, not the grant's).
  expires_at              timestamptz,
  -- Required iff tier = 'discounted'. 'month' | 'year' — WHICH of the base
  -- plan's two intervals this discount applies to. Added after the first
  -- version of this table shipped with no way to tell apart "30% off
  -- Growth Monthly" from "30% off Growth Annual" (found live, Phase 2
  -- testing, 2026-09-29: price_variant alone is shared across EVERY
  -- plan_key/interval at that discount level — see the next column's own
  -- comment — so without this column a grant for one specific plan+interval
  -- would silently also let the customer buy any other plan/interval at
  -- the same percentage). Together with access_plan_key and price_variant,
  -- this triple is what actually identifies the one vrm.plans row a
  -- discounted grant is for.
  billing_interval        text CHECK (billing_interval IN ('month', 'year')),
  -- Required iff tier = 'discounted'. Matches vrm.plans.price_variant
  -- (§4.2) — one of the pre-seeded 'beta_pct_NN' rows. NOT unique to one
  -- plan_key/interval by itself (every base plan/interval gets its own row
  -- at the same NN) — access_plan_key + billing_interval + price_variant
  -- together are what pin down the exact vrm.plans row (§2.4).
  price_variant           text,
  CHECK (
    (tier = 'discounted'  AND billing_interval IS NOT NULL) OR
    (tier <> 'discounted' AND billing_interval IS NULL)
  ),
  CHECK (
    (tier = 'free_until'  AND expires_at     IS NOT NULL) OR
    (tier <> 'free_until' AND expires_at     IS NULL)
  ),
  CHECK (
    (tier = 'discounted'  AND price_variant  IS NOT NULL) OR
    (tier <> 'discounted' AND price_variant  IS NULL)
  ),
  -- Grant state. 'converted' means a beta-linked subscription is now the
  -- entitlement source of truth (§5 rows 1/5) — the grant itself no longer
  -- grants anything, it's kept only as history.
  status                  text        NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active', 'expired', 'revoked', 'converted')),
  -- The acting admin (AdminSession.email), same convention as
  -- vrm.customers.notes-adjacent admin-attribution columns elsewhere.
  invited_by_email        text        NOT NULL,
  notes                   text,
  -- CAS gates for the two reminder emails (§ Phase 3), same pattern as
  -- vrm.subscriptions.trial_reminder_sent_at (migration 030).
  expiry_reminder_sent_at timestamptz,
  ended_notice_sent_at    timestamptz,
  expired_at              timestamptz,
  revoked_at              timestamptz,
  converted_at            timestamptz,
  revoked_by_email        text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- A customer has at most one active grant at a time — the next invite for
-- someone already on an active grant must revoke/convert it first, not
-- silently stack a second one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vrm_beta_grants_one_active_per_customer
  ON vrm.beta_grants (customer_id)
  WHERE status = 'active';

-- What the daily beta sweep (vrm_api/billing.py:run_beta_sweep()) scans.
CREATE INDEX IF NOT EXISTS idx_vrm_beta_grants_status_expires
  ON vrm.beta_grants (status, expires_at);

ALTER TABLE vrm.beta_grants ENABLE ROW LEVEL SECURITY;
GRANT ALL ON vrm.beta_grants TO service_role;

COMMENT ON TABLE vrm.beta_grants IS
  'One row per beta-tester grant (PLAN_BETA_PROGRAM.md §4.1). At most one active row per customer_id (partial unique index). free_lifetime/free_until entitlement is applied ONLY by vrm_api/billing.py:apply_entitlements() (§5) — never read this table directly to decide access; read vrm.customers.billing_status (''beta''/''beta_ended''). discounted grants record which pre-seeded vrm.plans row (access_plan_key + billing_interval + price_variant TOGETHER) a customer may buy; the real entitlement for that tier comes from the resulting vrm.subscriptions row, same as any other paid customer.';
COMMENT ON COLUMN vrm.beta_grants.status IS
  'active -> expired (free_until past expires_at) | active -> revoked (admin action, any tier) | active -> converted (a real, entitled ONVO subscription now exists — §5 rows 1/5). expired/revoked are terminal for that grant but a new grant can be created later; converted means the grant is now just history.';
COMMENT ON COLUMN vrm.beta_grants.price_variant IS
  'Matches vrm.plans.price_variant for a beta_pct_NN row (§4.2/§2.4). NOT unique to one plan_key/interval by itself — every base plan/interval has its own row at the same NN. access_plan_key + billing_interval + price_variant together identify the exact vrm.plans row this grant is for.';
COMMENT ON COLUMN vrm.beta_grants.billing_interval IS
  'Required iff tier=''discounted'' — which of the base plan''s two intervals (month/year) this discount applies to. Added 2026-09-29 (Phase 2 testing, before any real grant existed) after price_variant alone was found to be ambiguous across plan_key/interval — see that column''s own comment.';


-- ────────────────────────────────────────────────────────────
-- vrm.plans.price_variant — the pre-seeded discount catalog (§2.4/§4.2)
-- ────────────────────────────────────────────────────────────
-- Every existing plan row becomes price_variant = 'standard' (the default),
-- so nothing about the current sellable catalog changes. A discount row is
-- price_variant = 'beta_pct_NN' (NN in 10..90, step 10 — §2.4) for the same
-- (plan_key, billing_interval, currency, mode) as some standard row, at a
-- REAL, separately-created ONVO price under that plan's existing
-- onvo_product_id (see tools/seed_beta_discount_prices.py, run by hand the
-- same way the base catalog itself was seeded — never created live from
-- the admin UI at invite time).
--
-- idx_vrm_plans_sellable (migration 025) is a partial UNIQUE index on
-- (plan_key, billing_interval, currency, mode) WHERE active — a second
-- active row for the same four columns at a different price_variant would
-- violate it as-is, so it must be rebuilt to include price_variant. The
-- DROP + CREATE below run as one statement pair in the same implicit
-- transaction as the rest of this file — there is no window where a
-- duplicate sellable row could be inserted, and the existing data already
-- satisfies the wider index (every current row already has
-- price_variant = 'standard').
ALTER TABLE vrm.plans
  ADD COLUMN IF NOT EXISTS price_variant text NOT NULL DEFAULT 'standard';

DROP INDEX IF EXISTS vrm.idx_vrm_plans_sellable;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vrm_plans_sellable
  ON vrm.plans (plan_key, billing_interval, currency, mode, price_variant)
  WHERE active;

COMMENT ON COLUMN vrm.plans.price_variant IS
  'Beta-program discount catalog (PLAN_BETA_PROGRAM.md §2.4/§4.2). ''standard'' for the normal sellable catalog (default, and every pre-existing row). ''beta_pct_NN'' (NN=10..90 step 10) for a pre-seeded, self_serve=false discount row sharing the base row''s plan_key/billing_interval/currency/mode/site_limit/account_types, at a separately-created ONVO price under the SAME onvo_product_id. A discounted vrm.beta_grants row references one of these by name; get_plans()/_validate_target_plan() (vrm_api/routers/billing.py) must only ever surface a non-standard row to the customer holding the matching active grant.';

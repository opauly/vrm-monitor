# PLAN — Beta-tester program (invites with free/discounted access) + in-app feedback

Status: **DECISIONS RECORDED (2026-09-29) — see §11. Ready for Phase 1.** Planning only; nothing in
this document has been built. §8 is kept as a historical record of the questions asked; §11 is the
authoritative answer set and supersedes any default in §3/§8 it disagrees with.

---

## 1. Goal

"Done" means:

1. An admin can invite a specific person from `/admin` as a beta tester on one of three tiers:
   **free lifetime**, **free until a date**, or **discounted price**. The invite email is bilingual
   (EN/ES) and reuses the existing activation-link flow.
2. Entitlement for those tiers is enforced by the same single writer that already enforces paid
   access (`vrm_api/billing.py:apply_entitlements()`). Free access expires on time, gets a warning
   email first, and degrades the same way an expired trial already does.
3. Beta testers can submit bug reports and suggestions from inside the portal. Admins can triage
   them at `/admin/feedback`, and Pauly & Co gets an email for each submission.
4. Every new UI string and email exists in both EN and ES, following the existing conventions (§7).

---

## 2. What the codebase already does (the facts this plan is built on)

These points come from reading the code, not from the brief. Several of them change the design.

### 2.1 Free access already exists in practice
- `lib/server/db/admin.ts:createCustomer()` inserts a `vrm.customers` row with any `plan` and
  `site_limit`. The migration-025 defaults (`provisioning_state='active'`, `origin='admin'`,
  `site_limit_source='manual'`) apply, `billing_status` starts NULL, and no ONVO objects exist.
- `vrm_api/billing.py:NOT_ENTITLED_BILLING_STATUSES` is a **denylist**
  (`incomplete, unpaid, canceled, trial_expired`). `billing_status` values `'none'` and NULL are
  therefore fully entitled. Every hand-created customer today is already a free, non-expiring
  tenant.
- **Conclusion:** "free lifetime" needs no ONVO involvement and no synthetic subscription. What's
  missing is a record that the customer is a beta tester, plus expiry, revocation, and reporting.

### 2.2 The trap for time-bounded free access
- `apply_entitlements()` handles the `subscription is None` case by unconditionally writing
  `billing_status='none'` (billing.py ~line 555), and it never touches `plan`/`site_limit` there.
- So if expiry were enforced from outside (a separate sweep writing `billing_status='beta_ended'`),
  **the next `reconcile_customer()` call would silently reset it to `'none'` and re-grant access.**
  That call can come from a billing-page load, `/admin` "Refresh", a webhook, or a subscribe attempt.
- **Conclusion:** beta expiry must be a branch inside `apply_entitlements()`. The module docstring
  already names it as the only writer of `plan`/`site_limit`/`billing_status`/`provisioning_state`
  alongside `admin.ts`. This plan keeps that invariant.

### 2.3 `apply_entitlements()` rarely runs for customers without billing
- `routers/billing.py:_needs_staleness_refresh()` returns False when there is no
  `vrm.billing_customers` row. `post_reconcile_due()` only scans `vrm.subscriptions` rows.
- A free beta customer is therefore never reconciled unless something triggers it. This plan adds
  that trigger: a daily beta sweep plus a lazy check in `get_status()`.

### 2.4 Discounted pricing and ONVO — RESOLVED: fixed 10% steps, pre-seeded like the existing catalog
- **Decision (§11 Q7, revised mid-session):** the admin picks a percentage in **10% increments**
  (10/20/…/90 — see the note on 0% and 100% below), not an arbitrary value. A step size this coarse
  makes the whole discount catalog **finite and enumerable up front** — 9 levels × however many
  sellable (`plan_key`, `billing_interval`) combos exist today (currently Starter/Growth ×
  monthly/annual = 4, so 36 rows) — which removes the need for any *live*, per-invite ONVO API call.
  This is materially simpler than the arbitrary-percentage design it replaces, and needs no new
  runtime ONVO integration at all.
- **In the code:** `create_subscription()` sends `customerId`, `items[{priceId, quantity}]`,
  `paymentMethodId`, `trialPeriodDays`, `paymentBehavior`, `description`, `metadata`. Plan change is
  cancel-and-restart (`post_subscription_change`, "no in-place price change"). The price comes only
  from `vrm.plans.onvo_price_id`, validated by `_validate_target_plan()`. This resolution path needs
  **no changes** under the pre-seeded design — a discount row is just another `vrm.plans` row.
- **Confirmed via the sibling repo:** `../Dimensionador/Claude/tools/seed_onvo_plans.py` already
  creates real ONVO objects this same way — `POST /v1/products` then `POST /v1/prices`
  (`{productId, currency, unitAmount, type:"recurring", recurring:{interval, intervalCount}}`) —
  successfully in test mode, then inserts the matching `vrm.plans` row. The discount catalog reuses
  this exact pattern and script (extended, not replaced — see Phase 1).
- **Design: a fixed discount matrix, seeded once (or re-run when a new base plan/interval is added).**
  A new/extended seeding script, run by hand the same way `seed_onvo_plans.py` is today:
  1. For each existing sellable base row (`self_serve=true`, `price_variant='standard'`) and each of
     the 9 percentages, compute `discounted_amount_minor = round(base.amount_minor * (100 - pct) /
     100)`.
  2. `POST /prices` under that base plan's **existing** `onvo_product_id` (no new product needed).
  3. Insert one `vrm.plans` row per (base plan, pct): same `plan_key`/`billing_interval`/
     `currency`/`mode`/`site_limit`/`account_types`, `self_serve=false`,
     `price_variant='beta_pct_' || pct` (e.g. `'beta_pct_30'` — shared across every grant at that
     discount level for that base plan, the same shared-variant shape the very first draft of this
     plan used, just with 9 levels instead of 2). `_resolve_plan_row()` needs no change.
  4. Idempotent the same way the original script is: skip a `(plan_key, billing_interval, currency,
     mode, price_variant)` combination that already exists.
  Re-run whenever a new base plan or interval is added, so its discount rows exist too.
- **Admin invite flow (Phase 4) just picks from what's already seeded:** a percentage dropdown
  (10–90%) plus the base plan/interval, resolved to an existing `price_variant` — no runtime ONVO
  call, no idempotency-per-grant concern, no mode-safety check on the request path (the seeding
  script's own existing test/live guard covers it once, offline).
- **Changing a discount later (§11 Q7, "until I change it"):** just point the grant at a different
  already-seeded `price_variant` for the same base plan/interval. If the customer already has a live
  subscription on the old variant, moving them is a normal plan change — the existing
  cancel-and-restart path, not an in-place edit. Surface that in the admin UI copy.
- **0% and 100%, if offered:** 0% is identical to the standard price (no reason to seed it — the
  admin should just use the `free_lifetime`/`free_until` tier or a plain invite instead). 100% is a
  real $0 subscription, which is a poor fit anyway since `apply_entitlements()` requires a card on
  file for any entitled subscription — a "100% discount" that still demands a card is confusing UX.
  **Recommendation: the dropdown only offers 10–90%**, and anything below/above that is handled by
  the `free_lifetime`/`free_until` tiers instead. This is a UI/copy decision, not a technical one —
  flag it back to the user if they want 100% to be a real selectable option.
- **Free tiers still bypass ONVO entirely** (unchanged from the original finding): only the
  `discounted` tier ever touches ONVO.

### 2.5 Other facts the coder needs
- **vrm-schema migrations are not in this repo.** Migrations 012–041 live in
  `../Dimensionador/Claude/database/migrations/` (e.g. `025_billing.sql`, `030_trial_reminders.sql`,
  `041_dashboard_entitlement.sql`). Since the 2026-09-16 split, new vrm SQL goes under
  `victron-monitor/sql/vrm_*.sql` (e.g. `vrm_grid_events.sql`), stays idempotent, and is run by
  hand in the Supabase SQL Editor. This plan follows that post-split convention.
- `vrm.plans` has a partial unique index
  `idx_vrm_plans_sellable ON (plan_key, billing_interval, currency, mode) WHERE active` (migration
  025). A second active `growth/month/USD` row at a beta price **violates it**, so the index must be
  rebuilt to include `price_variant`.
- `routers/billing.py:get_plans()` lists every active plan in the current mode for the customer's
  `account_type`, and filters by `self_serve` only for `pending_subscription` customers. **Without a
  change here, a restricted beta price would be shown to every active customer.**
- The not-entitled denylist is duplicated in **four** places: Python
  `NOT_ENTITLED_BILLING_STATUSES` (`vrm_api/billing.py`), plus TS copies in
  `lib/server/db/sites.ts`, `lib/server/db/branding.ts`, and `lib/server/db/fleetDashboard.ts`. All
  four must change together.
- Invite plumbing: `lib/server/invites.ts:sendInvite()` → `createOrLinkAuthUser()` →
  `finishSendInvite()`, which hardcodes the `email_invite_*` keys. `resendInvite()` also hardcodes
  them. `/activate` supports a `next` param (`app/(auth)/activate/actions.ts`).
- Upload pattern for a screenshot: `app/api/branding/logo-sign/route.ts` (signed upload URL into
  bucket `vrm-monitor`, UUID path per upload) + `lib/uploadClient.ts:uploadFileToSignedUrl()` +
  `lib/server/storage.ts` (signed read URLs).
- Scheduling: `.github/workflows/billing-reconcile.yml` runs daily at 09:00 UTC and curls
  `vrm_api` endpoints. New sweeps get added as new steps there.
- Rate limiting: `lib/server/ratelimit.ts:checkRateLimit(bucket, key, windowSeconds, max)` over
  `vrm.rate_limits`.
- There is no automated test suite. Verification means `npm run lint`, `npm run typecheck`, and
  `npm run build` in `victron-monitor/web`, plus targeted manual/SQL checks against **ONVO test
  mode** and a throwaway customer.

---

## 3. Assumptions — RESOLVED by §11 where marked

| # | Assumption | Resolution |
|---|---|---|
| A1 | Who gets invited | New people only (no existing `vrm.customers` row). §11 Q9: **confirmed**, new invites only, v1. |
| A2 | When the customer row is created | At invite time, the same as today's admin create+invite, not on acceptance like self-serve signup. The admin already vetted this person, and `sendInvite()` needs a customer row. |
| A3 | Free-tier features | Admin picks the plan whose features apply (`access_plan_key`, default `growth` for installers, `starter` for owners) and a site limit (defaults from `lib/plans.ts:planSiteLimit()`). |
| A4 | Expiry enforcement lag | Daily sweep plus a lazy check on billing-status reads. Up to ~24h of lag on report/dashboard gates is acceptable. |
| A5 | What happens at expiry | §11 Q5: **confirmed**, same as `trial_expired` today — login still works, data/sites kept, reports/dashboard/branding blocked (`plan→'trial'`, `site_limit→0`), billing page offers plans, no extra grace period. |
| A6 | Reminder emails | §11 Q12: **confirmed**, one at 7 days before expiry and one "beta access ended" email at expiry/revocation. |
| A7 | Paying early / reactivating after expiry | §11 Q6 + Q13, **both resolved and stricter than the original default**: remaining free days are forfeited, AND the new subscription is charged **immediately today** — no standard 7-day ONVO trial. This applies to both (a) an active free/discounted tester who subscribes early, and (b) an expired/revoked tester who comes back and subscribes. See new rule in §5 and Phase 2. |
| A8 | Discount shape | §11 Q7, **revised mid-session to 10% increments (10–90%) for simplicity** — a fixed, pre-seeded catalog, not a live per-invite ONVO call. Locked for the life of the subscription until the admin explicitly picks a different pre-seeded level (a normal plan-change, not an in-place edit). See revised §2.4/§4.2. Monthly vs. annual follows whichever base plan/interval the admin picked for that invite. |
| A9 | Feedback audience | §11 Q10: **resolved as EVERY customer**, not beta-only. This removes the audience gate originally planned for Phase 6 — see revised Phase 6. |
| A10 | Screenshots | §11 Q4: **confirmed**, optional manual file/screenshot attach. Built in its own phase (7) so it can be dropped without blocking the rest. |
| A11 | Feedback notification | §11 Q11: **resolved** — one email per submission to `info@paulyco.com`, **editable from the admin panel** (not just an env var). This needs a small persisted setting — see new §4.6 `vrm.app_settings`. The env var becomes only the bootstrap default before an admin ever sets it. |
| A12 | Revocation | §11 Q3: **confirmed**, every tier including lifetime can be revoked from admin (soft: data kept), and revoked/ended testers get the "ended" email (A6). |
| A13 | Beta badge | §11 Q1: **confirmed**, shown for free-tier testers (§8 Q1 default: free tiers only — the discounted tier is a real paying customer at a lower price, not visually flagged). |
| A14 | Billing UI visibility | §11 Q8: **resolved, stricter than the original default** — a 100%-free tester sees **no payment/upgrade UI at all** while active (not even a secondary "Subscribe now"). Only a customer with an active **discounted** grant sees billing UI (their own discounted-price checkout). See revised Phase 5. |
| A15 | Invite cap | §11 Q2: **confirmed**, no cap. |
| A16 | Tester visibility of feedback status | §11 Q14: **resolved**, admins only — no "My feedback" status page for the submitter (drops the optional item in the original Phase 6). |

---

## 4. Data model

### 4.1 `vrm.beta_grants` (new) — `victron-monitor/sql/vrm_beta_program.sql`

One row per grant. A customer can accumulate history, but has at most one `active` grant.

| column | type | notes |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `customer_id` | uuid NOT NULL → `vrm.customers(id)` ON DELETE CASCADE | |
| `tier` | text NOT NULL CHECK in (`free_lifetime`,`free_until`,`discounted`) | |
| `access_plan_key` | text NOT NULL | Free tiers: the plan whose `plan_limits` features apply (copied into `customers.plan`). Discounted: which base plan the discount is on (see `billing_interval`/`price_variant`). |
| `site_limit` | int NULL | Free tiers: sites granted (NULL = unlimited, the same convention as `customers.site_limit`). Ignored for discounted. |
| `expires_at` | timestamptz NULL | Required iff `tier='free_until'` (CHECK). |
| `billing_interval` | text NULL CHECK in (`month`,`year`) | **Added during Phase 2 testing, 2026-09-29** (before any real grant existed — caught live, not by inspection). Required iff `tier='discounted'` (CHECK). `price_variant` alone is NOT unique to one plan_key/interval — every base plan/interval gets its own row at the same discount level (§2.4) — so a grant naming only `price_variant='beta_pct_30'` would ambiguously apply to Growth Monthly AND Starter Annual AND every other plan/interval at 30% off. `access_plan_key` + `billing_interval` + `price_variant` together are what actually identify the one `vrm.plans` row this grant is for. |
| `price_variant` | text NULL | Required iff `tier='discounted'` (CHECK). Matches `vrm.plans.price_variant` — NOT unique to one plan_key/interval by itself, see `billing_interval` above. |
| `status` | text NOT NULL default `'active'` CHECK in (`active`,`expired`,`revoked`,`converted`) | This is grant state. Invite pending/accepted is **derived** (§4.4), not stored. |
| `invited_by_email` | text NOT NULL | The acting admin (`AdminSession.email`). |
| `notes` | text NULL | Admin-only. |
| `expiry_reminder_sent_at` | timestamptz NULL | CAS gate, same pattern as `subscriptions.trial_reminder_sent_at`. |
| `ended_notice_sent_at` | timestamptz NULL | CAS gate for the "ended" email. |
| `expired_at`, `revoked_at`, `converted_at` | timestamptz NULL | |
| `revoked_by_email` | text NULL | |
| `created_at`, `updated_at` | timestamptz NOT NULL default now() | |

Indexes and constraints:
- `CREATE UNIQUE INDEX ... ON vrm.beta_grants (customer_id) WHERE status = 'active'`
- `(status, expires_at)` for the sweep.
- `ENABLE ROW LEVEL SECURITY; GRANT ALL ... TO service_role` (house style, migration 025).
- A header comment block explaining the reasoning, matching house style.

**Writers of `beta_grants`** (document this in the table COMMENT):
- Next.js admin (`lib/server/db/admin.ts`): insert, revoke, extend/edit.
- Python (`vrm_api/billing.py`): the `active→expired` and `active→converted` transitions, and the
  two `*_sent_at` stamps.

Nothing else writes to this table.

### 4.2 `vrm.plans` change — same SQL file

- `ADD COLUMN IF NOT EXISTS price_variant text NOT NULL DEFAULT 'standard'`. Every existing row
  becomes `'standard'`, so behaviour is unchanged.
- `DROP INDEX IF EXISTS vrm.idx_vrm_plans_sellable;` then recreate it as
  `ON (plan_key, billing_interval, currency, mode, price_variant) WHERE active`.
- Discount rows use `self_serve=false` and `price_variant='beta_pct_' || pct` (e.g. `'beta_pct_30'`)
  — one row per (base plan, interval, currency, mode, percentage), **shared across every grant** at
  that level, per the revised §2.4 design (fixed 10% steps, pre-seeded offline, no runtime ONVO
  call).

### 4.3 `vrm.customers` — no new columns

- `billing_status` has no CHECK, so two new local-only values are documented:
  - `'beta'` = free-tier grant active. Entitled, because it is not in the denylist.
  - `'beta_ended'` = free grant expired or revoked, with no entitled subscription. Added to all
    four denylist copies.
- `origin` stays `'admin'`. Its CHECK allows only `admin`/`self_serve`, and the grant table is the
  beta marker, so there's no reason to widen the CHECK.
- Tier to customer-row state at invite time:

| tier | `plan` | `site_limit` | `site_limit_source` | `provisioning_state` | ONVO |
|---|---|---|---|---|---|
| `free_lifetime` / `free_until` | `access_plan_key` | grant `site_limit` | `'plan'` (so a later paid subscription raises the limit) | `'active'` | none |
| `discounted` | `'trial'` | `0` | `'plan'` | `'pending_subscription'` (goes through the existing card + subscribe path, restricted to its variant) | normal subscription on a variant price |

### 4.4 Derived invite status (UI only, never stored)

- `revoked` if `grant.status='revoked'`
- `expired` if `grant.status='expired'`
- `accepted` if `customers.activated_at` is set
- `pending` if `customers.invited_at` is set and `activated_at` is NULL
- `not_sent` if `invited_at` is NULL (the send failed)

Note: Supabase activation-link expiry is separate. An expired link is fixed with "Resend invite",
the same as today.

### 4.5 `vrm.feedback` (new) — `victron-monitor/sql/vrm_feedback.sql`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `customer_id` | uuid NULL → `vrm.customers(id)` ON DELETE SET NULL | Feedback outlives a deleted customer. |
| `auth_user_id` | uuid NULL | |
| `submitter_email` | text NOT NULL | From the session. |
| `kind` | text NOT NULL CHECK in (`bug`,`suggestion`) | |
| `severity` | text NULL CHECK in (`low`,`medium`,`high`,`blocker`) | Bug only; NULL for suggestions (app-level rule). |
| `title` | text NOT NULL CHECK `char_length` 1–200 | |
| `body` | text NOT NULL CHECK `char_length` 1–5000 | |
| `page_path` | text NULL | Pathname only, **query string stripped**, ≤500 chars. |
| `site_id` | text NULL | Only stored after `assertOwnsSite()` passes; otherwise NULL. |
| `ui_language` | text NULL | `en`/`es`. |
| `user_agent` | text NULL | Truncated to 200 (same rule as `signup.ts:clientMeta()`). |
| `app_version` | text NULL | `process.env.VERCEL_GIT_COMMIT_SHA` if set. |
| `screenshot_path` | text NULL | Must start with `feedback/{customer_id}/` (server-checked). |
| `status` | text NOT NULL default `'new'` CHECK in (`new`,`triaged`,`in_progress`,`resolved`,`wont_fix`,`duplicate`) | Admin-owned. |
| `admin_priority` | text NULL CHECK in (`p1`,`p2`,`p3`) | Admin-owned, separate from the user's severity. |
| `admin_notes` | text NULL | |
| `created_at`, `updated_at`, `resolved_at` | timestamptz | |

Indexes: `(status, created_at DESC)` and `(customer_id, created_at DESC)`. RLS enabled,
`service_role` grant.

### 4.6 `vrm.app_settings` (new) — same file as §4.5, or its own `vrm_app_settings.sql`

Needed for §11 Q11: the feedback-notification address must be admin-editable, not just an env var.
Minimal key/value shape rather than a single-purpose column, so the next setting doesn't need a
migration:

| column | type | notes |
|---|---|---|
| `key` | text PK | e.g. `'feedback_notify_email'`. |
| `value` | text NOT NULL | |
| `updated_at` | timestamptz NOT NULL default now() | |
| `updated_by_email` | text NULL | |

- RLS enabled, `service_role` grant, house-style header comment.
- Seed one row: `('feedback_notify_email', 'info@paulyco.com')`.
- Reader: `notifyFeedback()` (Phase 6) reads this row first; if the row is missing, falls back to
  `process.env.FEEDBACK_NOTIFY_EMAIL`, then a hardcoded `info@paulyco.com` as a last resort — so a
  missing row or unset env var never breaks feedback submission.
- Writer: a small settings action on `/admin/feedback` (Phase 8), `requireAdmin()`-gated, Zod email
  validation, logs `admin.setting_changed key=… by=…`.

---

## 5. Entitlement design — the `apply_entitlements()` beta branch

Add `_beta_grant_for(customer_id)` to `vrm_api/billing.py`. It returns the `active` grant if one
exists, else the most recent grant row, else None.

Define "entitled subscription with a card" (**S_ok**) exactly as the existing code does: the current
mirror subscription classifies as `entitled` **and** `default_payment_method_id` is set.

New logic runs **before** the existing `if subscription is None` branch:

| # | Condition | Action |
|---|---|---|
| 1 | Active grant, tier free, and not past `expires_at` (or lifetime), **and S_ok** | Mark grant `converted` (`converted_at=now`). Fall through to the **existing** subscription logic unchanged. |
| 2 | Active grant, tier free, not expired, **not S_ok** | `_set` `billing_status='beta'`, `plan=access_plan_key`, `site_limit=grant.site_limit` (regardless of `site_limit_source`: the grant is the source of truth while active), `provisioning_state='active'` if pending. **Return** (skip the existing branches, so a lapsed old subscription can't demote an active beta tester). |
| 3 | Active grant, tier `free_until`, `now ≥ expires_at` | Mark grant `expired` (`expired_at=now`), then evaluate as row 4. |
| 4 | Most recent grant is free-tier with status `expired`/`revoked`, **and not S_ok** | `billing_status='beta_ended'`, `plan='trial'`, `site_limit=0`. Never touch `provisioning_state` (one-way rule 8). **Return.** This row is what stops the `'none'` clobber from §2.2. |
| 5 | Active grant, tier `discounted` | No entitlement effect; run the existing logic. If S_ok **and** the subscription's `vrm.plans.price_variant == grant.price_variant`, mark grant `converted`. |
| 6 | No grant, or a grant that is `converted`, or any case not caught above | Existing logic, unchanged. |

Rules for the coder:
- **No standard ONVO trial on a beta-linked conversion (§11 Q6 + Q13):** wherever the subscribe path
  calls `onvo.create_subscription(..., trialPeriodDays=…)`, check for any grant row (active, expired,
  or revoked) for that customer first. If one exists, pass `trialPeriodDays=0` — charged today,
  regardless of whether this is an early conversion during an active free/discounted grant or a
  reactivation after expiry/revocation. This is a new branch alongside the existing default
  `trialPeriodDays` used for a normal self-serve signup; find every call site (`grep -n
  trialPeriodDays vrm_api`) rather than assuming there is only one.
- Keep all writes in the single `updates` dict and the single `_t("customers").update(...)` call
  at the end. Keep the `billing.entitlement_changed` log line. Add
  `billing.beta_grant_transition customer_id=… grant=… old→new` log lines for grant-status writes.
- Grant-status writes must be conditional on the current status (`.eq("status","active")`), the
  same CAS style as the trial-reminder gate. Two concurrent reconciles must not double-transition.
- `NOT_ENTITLED_BILLING_STATUSES` gets `'beta_ended'`. Mirror that in `sites.ts`, `branding.ts`,
  and `fleetDashboard.ts` in the same phase. Grep for `trial_expired` to find every place a status
  label or badge map needs the two new values.

---

## 6. Phases

Each phase ends with a check the coder runs before moving on. Web checks always include
`npm run lint && npm run typecheck && npm run build` in `victron-monitor/web`.

### Phase 0 — Decisions and the ONVO confirmation (no code)
- The user answers §8, or explicitly accepts the §3 defaults.
- Someone (the user) asks ONVO support three questions:
  1. Can a coupon/discount be applied to a **subscription** (`POST /v1/subscriptions`), and for how
     many periods?
  2. What is the minimum `unitAmount` for a recurring price (is 0 allowed)?
  3. Is `invoice.originalTotal` vs `total` a discount mechanism on renewals?
- **If ONVO confirms subscription coupons,** revisit §4.2. A coupon-based variant could replace
  restricted prices, and would also enable "discount for N months". Everything else in this plan
  stays the same.
- **Exit:** decisions recorded at the bottom of this file.

### Phase 1 — Schema
- Create `victron-monitor/sql/vrm_beta_program.sql` (§4.1 + §4.2), `victron-monitor/sql/
  vrm_feedback.sql` (§4.5), and `victron-monitor/sql/vrm_app_settings.sql` (§4.6). All idempotent,
  with house-style header comments and `COMMENT ON` for the new tables, columns, and
  billing_status values.
- Write (or extend) a discount-seeding script following `seed_onvo_plans.py`'s exact shape (same
  test/live mode guard, same `_post()` helper, same skip-if-exists check) that, for every existing
  sellable base `vrm.plans` row, creates 9 ONVO prices (10–90%, §2.4) under that row's existing
  `onvo_product_id` and inserts the matching `price_variant='beta_pct_N'` rows. Where this script
  lives is a coder decision — either ported into this repo under `tools/` (this repo currently has
  no such script; `seed_onvo_plans.py` itself lives in the Dimensionador repo) or added there
  alongside the original, whichever keeps ONVO-seeding scripts in one place.
- Extend TS row types in `lib/server/db/types.ts`: `BetaGrantRecord`, `FeedbackRecord`, `AppSetting`,
  and (if surfaced) `price_variant`.
- **Verify:** run each SQL file twice in the Supabase SQL Editor (idempotent). Run the seeding
  script twice in test mode — confirm 36 new rows the first time (4 base rows × 9 percentages) and
  zero the second. Confirm `SELECT price_variant, count(*) FROM vrm.plans GROUP BY 1` shows
  `standard` plus exactly the expected `beta_pct_*` rows. Try inserting two `active` grants for one
  customer and confirm it's rejected. Try a `free_until` grant without `expires_at` and confirm it's
  rejected.

### Phase 2 — Entitlement writer and billing router (Python)
- `vrm_api/billing.py`:
  - Add `_beta_grant_for()` and the §5 branch (including the no-trial rule).
  - Add `'beta_ended'` to `NOT_ENTITLED_BILLING_STATUSES`.
  - Update the `_BILLING_STATUS…` docstring vocabulary.
  - Extend `_billing_state()` to include a small `beta` summary (`tier`, `status`, `expires_at`,
    `price_variant`).
  - No new ONVO calls needed here — the discount catalog is fully pre-seeded (Phase 1), so creating
    a `discounted` grant is just an insert referencing an existing `price_variant`.
- `vrm_api/routers/billing.py`:
  - `get_plans()`: return only `price_variant='standard'` rows by default. If the customer has an
    active `discounted` grant, return that variant's rows **instead of** the standard rows for the
    same `(plan_key, interval, currency)` — scoped by matching the grant's OWN `access_plan_key` +
    `billing_interval` + `price_variant` together, not `price_variant` alone (§4.1's own note on why:
    the same discount level exists for every base plan/interval, so filtering on `price_variant` by
    itself would hand a customer their discount across the entire catalog).
  - `_validate_target_plan()`: a non-standard variant row is buyable **only** by a customer with an
    active discounted grant matching that row's `plan_key` + `billing_interval` + `price_variant` all
    three — not `price_variant` alone (same reasoning as `get_plans()` above). That customer is
    exempt from the `self_serve` requirement for pending customers **for that variant only**. Every
    other customer is refused (`plan_not_available`) for any non-standard row.
  - `get_status()`: if an active `free_until` grant is past `expires_at`, reconcile before
    responding (the lazy check).
  - `_status_response()`: report `status='beta'`/`'beta_ended'` the same way `trial_expired`
    overrides the raw ONVO status, and add the `beta` summary.
- `vrm_api/schemas.py`: add an optional `beta` sub-model to `BillingStatusOut`, and add
  `BillingBetaSweepOut`.
- New endpoint `POST /v1/billing/beta-sweep`. Its logic lives in
  `billing.run_beta_sweep()`:
  - (a) For every `active` `free_until` grant past `expires_at`, and every expired/revoked grant
    whose customer isn't yet `'beta_ended'`: call `reconcile_customer()`. One failure never aborts
    the sweep (same posture as `post_reconcile_due`).
  - (b) Reminder and ended emails (Phase 3).
  - Return counts.
- Mirror the TS type in `lib/server/pipeline.ts` (`BillingStatusOut.beta`).
- **Verify (ONVO test mode, throwaway customers inserted by SQL):**
  - A free_until grant expiring in the past: call `POST /v1/billing/refresh` →
    `billing_status='beta_ended'`, `plan='trial'`, `site_limit=0`, grant `expired`. Refresh again
    and nothing changes (idempotent, no clobber back to `'none'`).
  - Free_lifetime → `'beta'` with the grant's plan and limit.
  - Revoked → `'beta_ended'`.
  - Existing non-beta customer → no change in `billing_status` (regression check).
  - `GET /v1/billing/plans` for a normal customer never lists a `beta_pct_*` row.
  - Discounted-grant customer: sees only their own `price_variant` row and can subscribe to it.
  - A non-grant customer calling subscribe with a `beta_pct_*` `plan_id` → 403.
  - The subscribe path for a customer with any grant row (active, expired, or revoked) sends
    `trialPeriodDays=0` — confirm the created ONVO subscription's first invoice is today, not after
    a 7-day trial.

### Phase 3 — Beta emails (Python) and cron
- `victron/email_i18n.py`: new keys in both `EN` and `ES`:
  - `beta_ending_title`, `beta_ending_body1` (`{date}`), `beta_ending_body2`, `beta_ending_footer`
  - `beta_ended_title`, `beta_ended_body1`, `beta_ended_body2`, `beta_ended_footer`
  - Spanish uses the same voseo register as the existing trial copy.
- New templates `victron/templates/beta_ending_email.html` and `beta_ended_email.html`, modeled on
  `trial_ending_no_card_email.html` and rendered with `lang` + `t` exactly like
  `send_trial_ending_reminders()`.
- `run_beta_sweep()` sends reminders:
  - Ending reminder: grant `active`, `free_until`, `expires_at` within 7 days, and
    `expiry_reminder_sent_at IS NULL`.
  - Ended notice: grant `expired`/`revoked` and `ended_notice_sent_at IS NULL`.
  - Stamp with a CAS update. Recipient = `contact_email or auth_email`. Language =
    `customer.ui_language`.
  - Mirror `send_trial_ending_reminders()`'s never-raise-per-row structure.
- `.github/workflows/billing-reconcile.yml`: add a "Beta sweep" step calling
  `POST /v1/billing/beta-sweep`, placed **before** "Reconcile every due subscription". Update the
  header comment.
- **Verify:** call the endpoint by hand in test mode with a grant expiring in 3 days → one EN or ES
  email, `expiry_reminder_sent_at` stamped. Call again → none sent. Check an ES customer gets the
  Spanish copy.

### Phase 4 — Admin: invite and manage beta testers (Next.js)
- `lib/server/db/admin.ts` (admin-only, unscoped):
  - `createBetaCustomer(fields, grant)`: inserts the customer with the §4.3 column values, then
    inserts the grant. If the grant insert fails, delete the customer row (mirror
    `signup.ts:deleteSelfServeCustomer` rollback style).
  - `listBetaGrants()`: joined with customer name, `auth_email`, `invited_at`, `activated_at`, plan,
    `billing_status`, and a feedback count once Phase 6 lands.
  - `revokeBetaGrant(grantId, adminEmail)`.
  - `updateBetaGrant(grantId, {expires_at?, site_limit?, access_plan_key?, notes?})`: extending an
    `expired` free_until grant re-activates it, provided there is no other active grant.
- `lib/server/invites.ts`:
  - Add an optional `variant: 'standard' | 'beta'` param to `sendInvite()`, `finishSendInvite()`,
    and `resendInvite()` (default `'standard'`, so existing callers are unchanged).
  - The beta variant picks `email_beta_invite_*` keys and a tier-specific intro, and passes
    `next=/app/billing` in the activation URL for the discounted tier.
  - `resendInviteAction` in `app/(admin)/admin/customers/actions.ts` must pick the beta variant
    automatically when the customer has a grant, so "Resend invite" from either admin page sends
    beta copy.
- New route `app/(admin)/admin/beta/`, following the `/admin/customers` structure and components
  (`Button`, `Field`, `Input`, `Select` from `@/components/ui`; a CSS module; `useActionState`):
  - `page.tsx`: `requireAdmin()` first.
  - `BetaManager.tsx`: table with filters by tier and derived status, row actions (resend, extend,
    revoke with `window.confirm` like `CustomerBillingPanel`).
  - `InviteBetaForm.tsx`: the `CreateCustomerForm` fields plus tier, access plan + billing interval,
    site limit, expiry date (free_until only), and — for `discounted` — a plain `<Select>` of
    10/20/…/90% (§2.4's fixed steps), resolved client-side to the matching pre-seeded
    `price_variant` for the chosen plan/interval (a lookup against Phase 1's seeded rows, not a new
    price). Uses the same success/`inviteWarning` handling as `CreateCustomerForm`.
  - `actions.ts`: every action starts with `requireAdmin()`. Zod shape checks.
    `createBetaInviteAction`, when `tier==='discounted'`, resolves the chosen (plan, interval, pct)
    to an existing `price_variant` server-side too (never trusts the client's resolved value alone)
    and 400s if that combination hasn't been seeded yet (Phase 1 must be re-run for a new base plan
    before it can be offered here).
    `updateBetaGrantDiscountAction` (editing an existing discounted grant's %): just points the grant
    at a different pre-seeded `price_variant` for the same base plan/interval — and, if the customer
    already has a live subscription on the old variant, runs it through the existing
    cancel-and-restart plan-change path (§2.4), not an in-place edit. Surface this in the UI as "this
    will restart their billing cycle today," since it isn't a silent price tweak.
    After any grant change, call `billingRefresh(customerId)` from `lib/server/pipeline.ts` so
    `apply_entitlements()` applies it immediately. Log `admin.beta_* customer_id=… admin=…` lines
    like `promoteToActiveAction`.
  - `beta.module.css`.
- `app/(admin)/admin/layout.tsx`: add a nav item `{ href: '/admin/beta', label: t(lang,
  'admin_nav_beta') }`.
- `/admin/customers` (`CustomersManager.tsx`, `EditCustomerForm.tsx`):
  - Add a "Beta" badge and a beta filter. `listCustomers()` needs a grant lookup, the same shape as
    its existing `subscriptions` join.
  - For a customer with an **active free grant**, show a note that plan and site limit are managed
    from `/admin/beta`, and disable those two inputs. Otherwise the next reconcile silently
    overwrites an edit (rule 2 of §5).
- Revoking a grant whose invite was **never accepted** also calls `setActive(customerId, false)`.
  Otherwise the still-valid Supabase link lets them in.
- Optionally fire `captureServerEvent` events `beta_invite_sent` and `beta_grant_revoked`
  (`lib/server/analytics.ts`).
- **Verify:**
  - Invite one tester per tier in test mode (EN and ES). Each email arrives in the right language
    with the right tier line.
  - Free testers land on `/app` with full `access_plan_key` features.
  - The discounted tester lands on `/app/billing` seeing only variant prices, completes card +
    subscribe, and is promoted by the existing path. The grant becomes `converted`.
  - Revoke a free tester → the next page load shows ended state.
  - Resend from `/admin/customers` sends beta copy.

### Phase 5 — Portal beta surfaces
- `app/(portal)/app/billing/BillingManager.tsx`:
  - **§11 Q8, resolved stricter than the original default:** when `status.beta?.status === 'active'`
    **and the tier is free** (`free_lifetime`/`free_until`), render a "Beta access" panel
    ("Free — no expiry" / "Free until {date}") with **no plan picker, no "Subscribe now," no
    upgrade affordance at all** — the page shows status only. This replaces the default-open plan
    picker (today `panel` opens `'plans'` when `status.status === null`).
  - When the active grant's tier is `discounted`, the page behaves like a normal
    `pending_subscription`/active-subscription customer — it shows the plan picker or current
    subscription as usual, scoped to their own `price_variant` row (§ Phase 2's `get_plans()`
    filtering). This is the **only** beta state that ever sees billing UI.
  - For `'beta_ended'` (expired or revoked, no live subscription), show the "Renew/Subscribe"
    treatment (reusing `isNotEntitledSubscription`-style UI) — this is the one path back to billing
    for a free-tier tester, once their free access has actually ended, not while it's active.
  - Add `beta`/`beta_ended` to `STATUS_LABEL_KEY` and `statusBadgeClass`.
- `app/(portal)/app/profile/page.tsx`: add the two status label mappings.
- `components/app/BillingBanners/BillingBanners.tsx`: add a "beta ends in N days" banner inside
  the 7-day window.
- Optional BETA badge in `components/app/AppShell/AppShell.tsx` (§8 Q1). If built, add a
  `badge?: string` prop computed in `app/(portal)/app/layout.tsx` and **pre-translated with `t()`**.
- **Verify:** load the billing and profile pages for each tester state in EN and ES. No raw keys
  or English leaking into ES. Existing paid, trial, and pending customers look identical to before
  (regression).

### Phase 6 — Feedback: submission and notification
- **§11 Q10, resolved:** feedback is open to **every** customer, not beta-only. This drops the
  audience gate the original draft planned here — no grant lookup needed before showing the widget
  or accepting a submission.
- `lib/server/db/feedback.ts` (tenant-scoped; takes `customerId` from the session, never from input):
  - `createFeedback(customerId, input)`: validates `site_id` with `sites.ts:assertOwnsSite()` and
    the `screenshot_path` prefix.
  - Export through `lib/server/db/index.ts`. (No `listOwnFeedback()` — §11 Q14 resolved
    admin-only visibility; see A16.)
- `app/(portal)/app/feedback/actions.ts`: `submitFeedbackAction`.
  - Uses `requireCustomerAllowPending()`, so a pending discounted tester stuck on billing can still
    report. No other gate — every authenticated customer can submit.
  - `checkRateLimit('feedback_customer', customerId, 3600, 20)`.
  - Zod: kind, severity (bug only), title, body, `page_path` (strip `?…`), optional `site_id`,
    optional `screenshot_path`.
  - After insert, calls `notifyFeedback()`.
- `lib/server/feedbackNotify.ts`: sends an email via `resend.ts:sendEmail()` with `replyTo` set to
  the submitter.
  - **§11 Q11, resolved:** recipient is read from `vrm.app_settings` key `'feedback_notify_email'`
    (§4.6), falling back to `process.env.FEEDBACK_NOTIFY_EMAIL`, then a hardcoded
    `info@paulyco.com` if neither is set. One email per submission (not a digest).
  - Rendered with `renderActivationEmail()` (heading = kind + severity; intro = a one-line summary
    with customer name and page; CTA = "Open in admin" → `/admin/feedback?id=…`).
  - Language from a new `FEEDBACK_NOTIFY_LANG` env (default `en`), because admin has no stored
    language. The body is not included in the email; the admin link is.
  - Failures are logged and swallowed.
- `components/app/FeedbackWidget/` (Client Component):
  - A header button (label from `t()`), rendered by `AppShell` for every customer — no
    `showFeedback` gate needed now that the audience is everyone. Never renders for admin.
  - Opens a modal with kind toggle, severity (bugs), title, body, and a site select (pre-filled
    from `/app/dashboard/[site_id]` via `usePathname()`; the options list is passed from the
    layout).
  - Shows a success state after submit.
- No "My feedback" page (§11 Q14 dropped it — admin-only visibility, A16).
- Docs: add `FEEDBACK_NOTIFY_LANG` to `victron-monitor/web/README.md`'s env var list, noting
  `FEEDBACK_NOTIFY_EMAIL` is now only the bootstrap default before an admin sets the real one.
- **Verify:**
  - Submit a bug and a suggestion in EN and ES → rows correct, notification email received at the
    `vrm.app_settings` address.
  - A forged `site_id` from another tenant is stored as NULL or rejected.
  - The 21st submission in an hour is refused with a translated message.
  - Every customer (paid, trial, pending, beta) sees the button and can submit.
  - Changing the notify address in `/admin/feedback` (Phase 8) changes where the next submission's
    email goes.

### Phase 7 — Feedback screenshot (optional, can be dropped per §8 Q4)
- `app/api/feedback/screenshot-sign/route.ts`:
  - Copy of `branding/logo-sign/route.ts`, using `requireCustomerForRouteAllowPending()`, a 5 MB
    cap, `.png/.jpg/.jpeg` only, and path `feedback/{customerId}/{uuid}.{ext}`.
  - Add `FEEDBACK_SCREENSHOT_MAX_BYTES` and allowed extensions to `lib/uploadLimits.ts`.
- The widget uploads with `uploadFileToSignedUrl()` before submitting and passes `path`.
- Orphan cleanup (abandoned uploads) is a non-goal, the same accepted debt the logo route
  documents.
- **Verify:** attach an image → the object exists at the expected path and the row stores it.
  Oversized or wrong-type files are refused with translated copy. A tampered `screenshot_path` for
  another customer's prefix is rejected by `createFeedback()`.

### Phase 8 — Admin feedback triage + the notify-email setting
- `lib/server/db/admin.ts`: `listFeedback(filters)` (unscoped, with customer name) and
  `updateFeedback(id, {status, admin_priority, admin_notes})`. The latter sets `resolved_at` when
  status becomes `resolved`/`wont_fix`/`duplicate`. Also `getAppSetting(key)`/
  `setAppSetting(key, value, adminEmail)` (§4.6), generic enough for future settings.
- New route `app/(admin)/admin/feedback/`:
  - `page.tsx` with `requireAdmin()`.
  - `FeedbackManager.tsx`: filters (kind, status, severity, customer, text search, following the
    `CustomersManager` filter row pattern) and expandable rows following the
    `ActivityTable.tsx`-style detail toggle, showing body, page, site, UA, version, and a
    screenshot via `storage.ts` signed URL (add `createFeedbackScreenshotUrl`, 120s TTL).
  - A small "Notification email" field at the top of the page (current `vrm.app_settings` value,
    Zod email validation, `requireAdmin()`-gated save action) — §11 Q11's editable-from-admin
    requirement. Not a whole separate settings page for one field.
  - `actions.ts`, `feedback.module.css`.
- Nav item `admin_nav_feedback` in `app/(admin)/admin/layout.tsx`. Optionally show a "new" count.
- **Verify:** triage flow end to end in EN and ES admin (toggle `AdminLangSwitcher`), status
  changes persist, the screenshot opens, and editing the notify email actually changes where Phase
  6's emails go (confirmed by submitting feedback before and after the change).

### Phase 9 — End-to-end pass
- A full scenario in ONVO test mode:
  - Invite one tester of each tier.
  - Activate each.
  - Submit feedback.
  - Fast-forward the free_until grant's `expires_at` by SQL.
  - Run `beta-sweep` → reminder, then ended email, then demotion.
  - Subscribe the ended tester through the normal path and confirm restoration.
  - Revoke the lifetime tester.
- Final `lint`/`typecheck`/`build`. Run a string-parity check (every new `en` key has an `es`
  counterpart in `strings.ts`, and every new `EN` key has an `ES` override in `email_i18n.py`).

---

## 7. Bilingual (EN/ES) rules for every phase

- **Web UI and TS-rendered emails:** every literal goes through `t(lang, key)` from
  `lib/i18n/strings.ts`. Add each key to **both** `STRINGS.en` and `STRINGS.es` in the same commit.
  `StringKey` is typed from `en`, so a missing `es` entry silently falls back to English at runtime.
  The type system won't catch it; the parity check in Phase 9 will.
- **Which `lang` to use:**
  - Portal: `session.uiLanguage`.
  - Admin: `session.uiLanguage` (from the `admin_lang` cookie).
  - Customer emails: the recipient's `customer.ui_language` (as `sendInvite` does).
  - Admin-notification email: `FEEDBACK_NOTIFY_LANG`.
- **Key prefixes:** `admin_beta_*`, `admin_feedback_*`, `admin_nav_beta`, `admin_nav_feedback`,
  `beta_*` (portal), `feedback_*` (portal widget/page), `email_beta_invite_*`, `email_feedback_*`,
  `billing_status_beta`, `billing_status_beta_ended`.
- **Interpolation:** `{token}` + `.replace()` in both runtimes (no `.format()`).
- **Dates:** `lib/dates.ts:formatDate()` with `en-US` / `es-CR` (as `BillingManager` does).
- **Python emails:** keys in `victron/email_i18n.py` `EN` + an explicit `ES` override for every
  key. `ES = dict(EN, …)` means a forgotten ES key silently ships English. Templates receive
  `lang` and `t` like the trial templates.
- **Spanish register:** Costa Rican voseo, matching existing copy ("Recibís", "Hacé", "Agregá").
- **User-submitted feedback text** is stored and shown verbatim. It is not translated.

---

## 8. Open questions (business/product decisions for the user)

1. **BETA badge:** should beta testers see a "BETA" badge in the portal header? Default: yes,
   small, free tiers only.
2. **Invite cap:** is there a hard cap on outstanding or active beta invites? Default: no cap. It
   can be a single constant if wanted.
3. **Lifetime revocability:** can "free lifetime" be revoked? Default: yes (soft revoke, data
   kept). Also, should revoked or ended testers get the "ended" email?
4. **Screenshots:** should feedback support screenshot upload? Default: yes, optional manual
   attach (Phase 7, droppable).
5. **Free period ending:** what happens when a free period ends? Default: the same as an expired
   trial (login works, data kept, features blocked, prompt to subscribe), no extra grace period.
   Alternatives: a grace period of N days, or a hard cutoff (deactivate).
6. **Paying early:** if a free tester subscribes before expiry, do they forfeit remaining free
   days (default), or should paid start only after the free period ends? The second option is
   significantly more complex with ONVO.
7. **Discount shape:** which discount levels (e.g. 30% and 50%)? Monthly and annual? Locked for
   life of the subscription (default), or only for N months (needs ONVO subscription-coupon
   support, still unconfirmed)?
8. **Billing UI for beta testers:** should active free beta testers see billing/upgrade UI at all?
   Default: the billing page shows their beta status with a secondary "Subscribe now". The
   alternative is to hide plans entirely until expiry.
9. **Existing customers:** can existing customers (e.g. current payers) be enrolled as beta
   testers or receive a discount? Default: no, new invitees only in v1.
10. **Feedback audience:** beta testers only (default) or every customer?
11. **Feedback notifications:** email per submission (default), a daily digest, or dashboard only?
    Which address receives them?
12. **Reminder timing:** is one reminder 7 days before expiry plus an "ended" notice right?
13. **Expired-beta 7-day ONVO trial:** should an expired beta tester who subscribes still get the
    standard 7-day ONVO trial (default: yes, unchanged), or be charged immediately?
14. **Tester visibility of status:** should testers see their feedback's triage status ("My
    feedback" page)? Default: yes.

---

## 9. Explicit non-goals

- Arbitrary-percentage discounts — resolved to fixed 10% steps (§2.4), which is what makes the
  pre-seeded, no-runtime-ONVO-call design possible.
- Creating ONVO prices/coupons live from the admin UI at invite time (the discount catalog is
  pre-seeded offline instead, §2.4/Phase 1).
- Time-limited discounts ("50% off for 3 months then full price") — a discount level is locked for
  the life of the subscription until the admin picks a different pre-seeded level (§11 Q7).
- Converting an existing customer into a beta tester (§11 Q9: new invites only, v1).
- Automatic screenshots or page capture, console-log capture, or session replay (manual attach only,
  §11 Q4).
- Public roadmap/voting, comment threads on feedback, a tester-facing feedback-status page (§11
  Q14: admin-only), or emailing testers when their feedback's status changes.
- Orphaned screenshot cleanup.
- Any change to the `monitoring` schema, the PDF reports, or the marketing site.
- Changing `vrm.customers.origin`'s CHECK or adding columns to `vrm.customers`.
- A dedicated settings page for `vrm.app_settings` — v1 exposes only the one field it needs, inline
  on `/admin/feedback` (§4.6/Phase 8).

---

## 10. Risks and tradeoffs

- **Single-writer discipline:** `plan`/`site_limit`/`billing_status` for active free testers are
  owned by `apply_entitlements()` via the grant. Admin edits to those fields on `/admin/customers`
  would be overwritten, which is why Phase 4 disables them there. Missing that step produces a
  confusing "my edit didn't stick" bug.
- **Denylist drift:** four copies of the not-entitled list. Missing one means an ended tester keeps
  one feature (e.g. branding). Phase 2 must grep them all. Consolidating the TS copies into one
  shared constant is a worthwhile small refactor inside Phase 2.
- **Expiry lag:** up to ~24h on Next.js-side gates (reads `billing_status`) between `expires_at`
  and the sweep, narrowed by the lazy `get_status()` check. Acceptable for a beta; tighten only if
  the user objects.
- **`idx_vrm_plans_sellable` rebuild:** this modifies an existing live index. The `DROP` +
  `CREATE` must run in one transaction in the SQL Editor so there is no window where duplicate
  sellable rows could be inserted. The current data already satisfies the new, wider index.
- **Variant price leakage:** if `get_plans()`/`_validate_target_plan()` filtering is wrong,
  discounted prices become visible or buyable by everyone. Phase 2 verification tests this
  explicitly.
- **Discount catalog is shared, not per-grant:** because `price_variant='beta_pct_N'` rows are
  shared across every grant at that level (§2.4), `_validate_target_plan()` must check the
  requesting customer's *own* active discounted grant matches the row's variant — never "any
  `beta_pct_*` row is buyable by any discounted-tier customer." Getting this ownership check wrong
  would let one discounted tester buy a deeper discount than they were actually offered.
  Phase 2 verification must test this specifically (a customer with a `beta_pct_20` grant
  attempting to subscribe to a `beta_pct_50` row → 403), not just "any variant vs. any non-grant
  customer."
- **Found live during Phase 2 verification (2026-09-29), not by inspection:** the risk above
  actually manifested one level worse than described — `price_variant` alone isn't even unique to
  one **plan_key/interval**, only to a discount *level*. A test granting a customer 30% off Growth
  Monthly found they could ALSO buy Starter Monthly and Starter Annual at 30% off, because every
  base plan/interval gets its own `beta_pct_30` row (Phase 1 seeds all 4 base rows × 9 levels). Fixed
  by adding `beta_grants.billing_interval` (§4.1) and scoping every comparison — `get_plans()`,
  `_validate_target_plan()`, and `apply_entitlements()`'s row-5 conversion check — on
  `access_plan_key` + `billing_interval` + `price_variant` together, never `price_variant` alone.
  The table had zero real rows when this was caught, so the fix is a plain `ALTER TABLE ADD COLUMN`,
  not a backfill. Recorded here as a reminder that "the discount is shared across grants" (the risk
  above) and "the discount is shared across PLANS" (this one) are two separate gaps — fixing one
  does not fix the other.
- **Re-seeding when the catalog changes:** adding a new base plan or interval later requires
  re-running the discount-seeding script before that plan can be offered at a discount — a step
  that's easy to forget. Phase 4's server-side re-validation (400 on an unseeded combination) is the
  safety net, not a substitute for remembering to re-seed.
- **ONVO scope, resolved not deferred:** switching to fixed 10% steps means this plan depends on no
  unconfirmed ONVO behavior at all (§2.4) — the earlier open question about subscription coupons is
  moot; the cost is a slightly larger, but fully known, one-time seeded catalog (9 rows per base
  plan/interval), and discounts can't be time-limited.
- **Migration location:** vrm migrations 012–041 live in the Dimensionador repo. New files here
  follow the post-split `victron-monitor/sql/` convention. The user should confirm this is where
  they want vrm DDL to live going forward.
- **Revoking an unaccepted invite:** the Supabase activation link stays valid until it expires.
  Phase 4 deactivates the customer on revoke-before-accept to close that gap.
- **Feedback PII:** free text can contain customer data. It's stored in `vrm` (service-role only,
  RLS on) and never emailed in full.

---

## 11. Decisions log (2026-09-29, resolves §8)

| Q | Answer (verbatim intent) | Where applied |
|---|---|---|
| 1 | Yes, BETA badge. | A13, Phase 5 — free-tier only, not shown for discounted (real paying) testers. |
| 2 | No cap — "I handle all that I want." | A15 — no invite-count limit anywhere in the design. |
| 3 | Yes, revocable (including lifetime), and revoked/ended testers get an email. | A6, A12, Phase 3/4. |
| 4 | Yes, option to add screenshots **or files** to feedback reports. | A10, Phase 7 — kept generic ("file attach," not just images; Phase 7's extension list should include PDF alongside PNG/JPG). |
| 5 | Same as an expired trial. | A5, unchanged from the original default. |
| 6 | Forfeit remaining free days; new charge date is today. | A7 — combined with Q13 into one "no ONVO trial on any beta-linked conversion" rule, §5. |
| 7 | Admin chooses the discount %, locked for life until changed; monthly/annual follows whichever subscription was given. **Revised mid-session to fixed 10% increments** for a simpler, pre-seeded, no-runtime-ONVO-call design (§2.4). | A8, §2.4, §4.2, Phase 1/2/4 — all rewritten around the fixed-catalog design. |
| 8 | Free (100%) testers see **no** payment UI. Only discounted testers see billing UI. | A14, Phase 5 — stricter than the original default (which still showed a "Subscribe now" to free testers). |
| 9 | No — new invites only. | A1, unchanged from the original default. |
| 10 | Every customer, not just beta testers. | A9, Phase 6 — removes the audience gate the first draft planned. |
| 11 | Email per submission to `info@paulyco.com`, editable from the admin panel. | A11, new §4.6 `vrm.app_settings`, Phase 6/8. |
| 12 | Yes (7-day-before reminder + an end notice). | A6, unchanged from the original default. |
| 13 | Charged immediately (no standard trial) on reactivation after expiry. | A7 — merged with Q6 into the single no-trial rule, §5/Phase 2. |
| 14 | No — admins only see feedback status. | A16, Phase 6 — drops the optional "My feedback" page from the original draft. |

**Net effect on the plan's shape:** the biggest change from the first draft is Q7 — arbitrary
percentages would have required live, per-grant ONVO price creation (a real but more complex
design, briefly drafted and then discarded in this same session); fixed 10% steps make the whole
discount catalog enumerable and pre-seedable, which removed an entire runtime ONVO integration
(`onvo.create_price()`, a `POST /v1/billing/beta-price` endpoint, and per-grant idempotency/mode
guards) from Phases 1, 2, and 4. Q6+Q13 together produced one new cross-cutting rule (§5) rather
than two separate ones. Q8 and Q10 each remove scope from where the original defaults had it
(less billing UI shown, more customers eligible for feedback) rather than adding any.

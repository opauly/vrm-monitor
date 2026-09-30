import 'server-only';

// ══════════════════════════════════════════════════════════════════════
// ADMIN-ONLY — nothing in this module is tenant-scoped.
//
// Only code under `app/(admin)/admin/**` may import this file. That is a
// convention enforced by this comment and code review, the same way
// `vrm_portal/admin_db.py`'s module docstring enforced it in the Streamlit
// original (PLAN_PHASE13.md §1.6) — there is no build-time mechanism (an
// ESLint boundary rule, a separate package) stopping `app/(portal)/app/**`
// from importing it too. Being honest about that here rather than
// implying a guarantee that doesn't exist: every function below takes NO
// `customerId` argument and returns cross-customer data by design, so an
// accidental import into the customer surface is a real tenant-isolation
// bug, not a lint nit — read `lib/server/db/sites.ts` / `customers.ts`
// instead for anything reachable from `/app/*`.
// ══════════════════════════════════════════════════════════════════════
import { getSupabaseAdmin } from '@/lib/server/supabase';
import { slugify } from '@/lib/slug';
import { planSiteLimit } from '@/lib/plans';
import type {
  AccountType,
  BetaGrantRecord,
  BetaGrantTier,
  BillingEventRecord,
  CustomerRecord,
  FeedbackPriority,
  FeedbackRecord,
  FeedbackStatus,
  Lang,
  SiteRecord,
  IngestionLogRecord,
  SignupRequestRecord,
} from './types';
import type { ReportRunRecord } from './reportRuns';
import { buildFleetOverview, FLEET_SITE_SELECT_FIELDS } from './fleetOverviewCore';
import type {
  FleetConnectionStatus,
  SiteAnomalyRow,
  FleetOverviewRow,
  FleetOverview,
  BatteryStress,
  PeriodIndicators,
  FleetSiteInput,
} from './fleetOverviewCore';
export type { FleetConnectionStatus, SiteAnomalyRow, FleetOverviewRow, FleetOverview, BatteryStress, PeriodIndicators };

export type AdminCustomerRow = CustomerRecord & {
  siteCount: number;
  lastUploadAt: string | null;
  /** From the customer's current LIVE `vrm.subscriptions` row
   * (`canceled_at IS NULL`) — `null` for a customer with no live
   * subscription (never subscribed, or fully lapsed). Distinct from
   * `CustomerRecord.billing_status`, which is the entitlement writer's own
   * cache and carries no date (PLAN_PHASE16.md §8 Step 6: "plan, billing
   * status, next renewal date, whether a cancellation is pending"). */
  nextRenewalAt: string | null;
  /** `vrm.subscriptions.cancel_at_period_end` for the current live
   * subscription — `false` (not `null`) when there is no live subscription
   * at all, since "no cancellation is pending" is the correct reading of
   * that case too. */
  cancelPending: boolean;
  /** This customer's ACTIVE `vrm.beta_grants` row, if any — `null` for the
   * overwhelming majority of customers who have never been a beta tester
   * (PLAN_BETA_PROGRAM.md § Phase 4: "the same shape as its existing
   * subscriptions join"). Drives the "Beta" badge/filter on
   * `/admin/customers` and `EditCustomerForm.tsx`'s plan/site-limit
   * disable — while this is set, `apply_entitlements()`'s §5 row 2 owns
   * those two fields, and an edit here would just be silently overwritten
   * on the next reconcile. */
  activeBetaGrant: { id: string; tier: BetaGrantTier } | null;
};

/**
 * Every customer, with the derived figures every admin list in
 * `pages/06_vrm_monitor.py`'s `tab_sites()` shows inline (site count) or
 * that Step 7's `/admin/customers` needs ("last upload"), plus — as of
 * PLAN_PHASE16.md §8 Step 6 — each customer's current live subscription's
 * renewal date / cancel-pending flag. Computed here, once, rather than N+1
 * queries per row from the page.
 */
export async function listCustomers(): Promise<AdminCustomerRow[]> {
  const admin = getSupabaseAdmin();

  const { data: customers, error: customersError } = await admin
    .schema('vrm')
    .from('customers')
    .select('*')
    .order('name');
  if (customersError) throw customersError;

  const { data: sites, error: sitesError } = await admin.schema('vrm').from('sites').select('site_id, customer_id');
  if (sitesError) throw sitesError;

  const siteRows = (sites ?? []) as { site_id: string; customer_id: string }[];
  const customerIdBySite = new Map(siteRows.map((s) => [s.site_id, s.customer_id]));
  const siteCountByCustomer = new Map<string, number>();
  for (const s of siteRows) {
    siteCountByCustomer.set(s.customer_id, (siteCountByCustomer.get(s.customer_id) ?? 0) + 1);
  }

  // `ingestion_log` has no `customer_id` column (see `ingestions.ts`'s own
  // comment) — map through `site_id` the same way, then keep only the
  // newest timestamp seen per customer instead of loading full history.
  const { data: logs, error: logsError } = await admin
    .schema('vrm')
    .from('ingestion_log')
    .select('site_id, uploaded_at')
    .order('uploaded_at', { ascending: false });
  if (logsError) throw logsError;

  const lastUploadByCustomer = new Map<string, string>();
  for (const log of (logs ?? []) as { site_id: string; uploaded_at: string }[]) {
    const customerId = customerIdBySite.get(log.site_id);
    if (!customerId) continue;
    // Rows arrived newest-first, so the first one seen per customer is the
    // most recent — no need to compare timestamps.
    if (!lastUploadByCustomer.has(customerId)) lastUploadByCustomer.set(customerId, log.uploaded_at);
  }

  // The current LIVE subscription per customer only (`canceled_at IS
  // NULL`) — migration 025's own partial unique index means there is at
  // most one, so no "most recent wins" tie-break is needed here the way
  // `vrm_api/billing.py:_current_mirror_subscription()` needs one for its
  // broader "current, possibly lapsed" reading.
  const { data: subs, error: subsError } = await admin
    .schema('vrm')
    .from('subscriptions')
    .select('customer_id, current_period_end, cancel_at_period_end')
    .is('canceled_at', null);
  if (subsError) throw subsError;

  const liveSubByCustomer = new Map(
    ((subs ?? []) as { customer_id: string; current_period_end: string | null; cancel_at_period_end: boolean }[]).map(
      (s) => [s.customer_id, s],
    ),
  );

  // PLAN_BETA_PROGRAM.md § Phase 4 — at most one `active` row per
  // customer_id (the partial unique index), so no tie-break needed here.
  const { data: activeGrants, error: grantsError } = await admin
    .schema('vrm')
    .from('beta_grants')
    .select('id, customer_id, tier')
    .eq('status', 'active');
  if (grantsError) throw grantsError;
  const activeGrantByCustomer = new Map(
    ((activeGrants ?? []) as { id: string; customer_id: string; tier: BetaGrantTier }[]).map((g) => [
      g.customer_id,
      { id: g.id, tier: g.tier },
    ]),
  );

  return ((customers ?? []) as CustomerRecord[]).map((c) => {
    const liveSub = liveSubByCustomer.get(c.id);
    return {
      ...c,
      siteCount: siteCountByCustomer.get(c.id) ?? 0,
      lastUploadAt: lastUploadByCustomer.get(c.id) ?? null,
      nextRenewalAt: liveSub?.current_period_end ?? null,
      cancelPending: liveSub?.cancel_at_period_end ?? false,
      activeBetaGrant: activeGrantByCustomer.get(c.id) ?? null,
    };
  });
}

export type CreateCustomerFields = {
  name: string;
  /** Defaults to `slugify(name)` — see `lib/slug.ts`. Only pass this to
   * override the derived slug (e.g. a name collision Oscar wants to
   * disambiguate by hand). */
  slug?: string;
  accountType: AccountType;
  plan: string;
  /** Overrides `lib/plans.ts:planSiteLimit(plan)`'s default for a
   * hand-negotiated deal — same "value on the row, not a recompute from
   * `plan` every time" reasoning migration 021's own comment gives. */
  siteLimit?: number | null;
  contactName?: string | null;
  contactEmail?: string | null;
  country?: string | null;
  uiLanguage?: Lang;
  /** The login email the create-customer form collects (PLAN_PHASE14.md
   * §2 Step 7: "login email" is one of the create-form's own fields,
   * separate from `contactEmail`). Written to `auth_email` at creation
   * time — NOT `auth_user_id`/`invited_at`, which stay null until
   * `lib/server/invites.ts:sendInvite()` actually generates and sends a
   * link. Storing the intended login email up front (rather than only
   * once an invite is sent) is what lets migration 021's own
   * case-insensitive unique index on `auth_email` catch a duplicate login
   * address at creation time, before Oscar has clicked "Enviar
   * invitación" and possibly confused two customers for a moment. */
  authEmail?: string | null;
  /** PLAN_BETA_PROGRAM.md §4.3 — a beta-created customer's `site_limit_source`
   * is always `'plan'` (not the column's own `'manual'` default), so a
   * later REAL paid subscription can still raise their limit rather than
   * being permanently frozen at whatever the grant handed them. Every
   * other `createCustomer()` caller leaves this `undefined` and gets the
   * column's own default. */
  siteLimitSource?: 'manual' | 'plan';
  /** PLAN_BETA_PROGRAM.md §4.3 — only a `discounted` beta invite needs this
   * set to `'pending_subscription'` at creation (it has no entitlement
   * until it actually subscribes, same as a self-serve signup); every
   * other caller, including free-tier beta invites, leaves this
   * `undefined` and gets the column's own `'active'` default. */
  provisioningState?: 'pending_subscription' | 'active';
};

/**
 * Creates a `vrm.customers` row. Deliberately does NOT touch
 * `auth_user_id`/`invited_at`/`activated_at` — those are invite-flow state,
 * stamped by `lib/server/invites.ts` (Step 7) once an email actually goes
 * out (or a password is actually set), not at row-creation time. A
 * customer can exist here with no login yet; that is the normal state
 * between "Oscar created the account" and "Oscar sent the invite." (Its own
 * `auth_email` — the *intended* login address — is the one exception; see
 * `CreateCustomerFields.authEmail`'s own comment.)
 */
export async function createCustomer(fields: CreateCustomerFields): Promise<CustomerRecord> {
  const slug = fields.slug ? slugify(fields.slug) : slugify(fields.name);
  const siteLimit = fields.siteLimit !== undefined ? fields.siteLimit : planSiteLimit(fields.plan);

  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('customers')
    .insert({
      name: fields.name,
      slug,
      account_type: fields.accountType,
      plan: fields.plan,
      site_limit: siteLimit,
      contact_name: fields.contactName ?? null,
      contact_email: fields.contactEmail ?? null,
      country: fields.country ?? null,
      ui_language: fields.uiLanguage ?? 'en',
      auth_email: fields.authEmail ?? null,
      ...(fields.siteLimitSource !== undefined ? { site_limit_source: fields.siteLimitSource } : {}),
      ...(fields.provisioningState !== undefined ? { provisioning_state: fields.provisioningState } : {}),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as CustomerRecord;
}

// Everything an admin may legitimately change about a customer record
// after creation — the mirror image of `customers.ts:PROFILE_WHITELIST`,
// but wider on purpose (this is the surface *only* `/admin/*` reaches).
// Still excludes `slug` (the site_id namespace — changing it after sites
// exist would orphan every `site_id` already minted from it) and
// `auth_user_id`/`auth_email`/`invited_at`/`activated_at` (invite-flow
// state Step 7's `lib/server/invites.ts` owns, not a generic field edit).
const ADMIN_CUSTOMER_WHITELIST = [
  'name',
  'contact_name',
  'contact_email',
  'country',
  'ui_language',
  'account_type',
  'plan',
  'site_limit',
  'active',
  'notes',
  // PLAN_PHASE17.md §4.5 — so Oscar can set a Fleet customer's branding by
  // hand during onboarding. Untiered on purpose: an admin write bypasses
  // getBrandingAccess() entirely (this whitelist is the only gate on this
  // path), the same way every other admin override in this file already
  // does for site_limit/plan.
  'branding',
] as const;

export type AdminCustomerUpdateFields = Partial<Pick<CustomerRecord, (typeof ADMIN_CUSTOMER_WHITELIST)[number]>>;

export async function updateCustomer(
  customerId: string,
  fields: AdminCustomerUpdateFields,
): Promise<CustomerRecord> {
  const allowed = new Set<string>(ADMIN_CUSTOMER_WHITELIST);
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    if (allowed.has(key)) payload[key] = (fields as Record<string, unknown>)[key];
  }
  if (Object.keys(payload).length === 0) {
    const { data, error } = await getSupabaseAdmin().schema('vrm').from('customers').select('*').eq('id', customerId).single();
    if (error) throw error;
    return data as CustomerRecord;
  }
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('customers')
    .update(payload)
    .eq('id', customerId)
    .select('*')
    .single();
  if (error) throw error;
  return data as CustomerRecord;
}

/** Deactivating a customer must not require deleting their auth user
 * (PLAN_PHASE13.md §1.5) — `resolveRole()` already rejects an inactive
 * customer at the same clean-rejection branch as an unlinked one, so
 * flipping this one column is the entire "revoke access" operation. */
export async function setActive(customerId: string, active: boolean): Promise<CustomerRecord> {
  return updateCustomer(customerId, { active });
}

export async function listAllSites(): Promise<SiteRecord[]> {
  const { data, error } = await getSupabaseAdmin().schema('vrm').from('sites').select('*').order('display_name');
  if (error) throw error;
  return (data ?? []) as SiteRecord[];
}

// ══════════════════════════════════════════════════════════════════════
// Fleet overview (admin ops dashboard, 2026-08-30) — informed by a UCR
// capstone project's own requirements doc (a separate, standalone project
// Oscar is sponsoring with the same idea), built independently and now,
// against data this pipeline already computes. Every field below is read
// from an EXISTING table — no new migration, no new vrm_api endpoint.
//
// The row shape and indicator math (health score selection, battery-cycle
// estimate, self-sufficiency/self-consumption/DoD) live in
// `fleetOverviewCore.ts` (2026-09-03) — shared with the customer-facing
// `/app/dashboard` (`fleetDashboard.ts`), so both dashboards can never
// silently compute the same number two different ways. This function's own
// job is the one thing that must stay admin-only: the unscoped `vrm.sites`
// query below has no `customer_id` filter, by design.
// ══════════════════════════════════════════════════════════════════════

/** Every `source='vrm_api'` site's current status in one call — connection
 * freshness, latest health score, open alarm/critical-alert counts, and
 * open `vrm.site_anomalies` rows, across EVERY customer (the unscoped
 * `vrm.sites` query below is this function's entire reason to live in
 * `admin.ts` rather than a tenant-scoped file). `monitoring`-schema
 * (Node-RED) sites are deliberately excluded: they have no `vrm.daily_health`
 * row shaped the same way, and mixing the two would make "average fleet
 * health" mean two different things silently. */
export async function getFleetOverview(): Promise<FleetOverview> {
  const { data: sites, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('sites')
    .select(FLEET_SITE_SELECT_FIELDS)
    .eq('source', 'vrm_api')
    .eq('active', true)
    .order('display_name');
  if (error) throw error;
  return buildFleetOverview((sites ?? []) as unknown as FleetSiteInput[]);
}


/** The single-site version of `getFleetOverview()`'s own row shape, for
 * `/admin/fleet/[site_id]`. Reuses that function outright rather than
 * restating its five-way parallel query and indicator math for one row —
 * at fleet sizes this dashboard is built for (single digits today), fetching
 * every site to serve one page is negligible cost for guaranteeing the
 * drill-down and the table can never compute the same indicator two
 * different ways. Worth splitting into a real single-site query if the
 * fleet grows enough for that assumption to stop holding. `null` (not a
 * throw) when `siteId` doesn't match any `source='vrm_api'` site — the
 * caller's own job to decide that's a 404. */
export async function getFleetSiteDetail(siteId: string): Promise<FleetOverviewRow | null> {
  const overview = await getFleetOverview();
  return overview.sites.find((s) => s.site_id === siteId) ?? null;
}

// Same field whitelist as `sites.ts:SITE_WHITELIST`, restated here rather
// than imported — that module's constant is a local, unexported `const`
// (each tenancy file in this directory keeps its own whitelist + its own
// `pickWhitelisted`, rather than sharing one; see `customers.ts`'s own
// comment on why the runtime filter matters independently of the type).
// Still excludes `customer_id`/`site_id` — reassignment is its own function
// below (`reassignSite`), a deliberate, explicit action rather than one
// more field in a generic update, the same "setActive() vs. a generic field
// edit" split this file already uses for `active`.
// The four schedule columns plus recipients joined this whitelist so an
// admin can see and fix a customer's own schedule directly, instead of
// walking them through re-doing it themselves — the same five columns
// `sites.ts:SITE_WHITELIST` carries, restated here for the same reason the
// rest of this whitelist is restated rather than imported (see this
// constant's own header comment above).
const ADMIN_SITE_WHITELIST = [
  'display_name',
  'pv_kwp',
  'battery_nominal_kwh',
  'battery_dod_pct',
  'system_type',
  'report_language',
  'location',
  'timezone',
  'latitude',
  'longitude',
  'country',
  'savings_rate',
  'savings_currency',
  'exports_to_grid',
  'active',
  'report_schedule',
  'report_schedule_weekday',
  'report_schedule_day_of_month',
  'report_schedule_hour',
  'report_recipients',
  'report_modules',
] as const;

// PLAN_PHASE18.md's Decisions section (originally 9 ids) plus §7's Phase 2
// additions — same 13 ids `sites.ts:REPORT_MODULES`,
// `victron/weekly_report.py:ALL_MODULES`, and migration 029's widened CHECK
// constraint use.
const ADMIN_REPORT_MODULES = new Set([
  'energy_mix', 'battery_health', 'grid_quality', 'events',
  'soc_chart', 'solar_performance', 'weather', 'trend', 'savings',
  'critical_alerts', 'grid_meter_detail', 'generator_runtime', 'tank_level',
]);

export type AdminSiteUpdateFields = Partial<Pick<SiteRecord, (typeof ADMIN_SITE_WHITELIST)[number]>>;

function pickWhitelisted<T extends Record<string, unknown>>(fields: T, allowed: readonly (keyof T)[]): Partial<T> {
  const allowedSet = new Set<keyof T>(allowed);
  const out: Partial<T> = {};
  for (const key of Object.keys(fields) as (keyof T)[]) {
    if (allowedSet.has(key)) out[key] = fields[key];
  }
  return out;
}

// Same rule as `sites.ts:ScheduleRequiresVrmApi` / `sanitizeRecipients()` —
// restated here rather than imported (same reasoning as the whitelist
// above). This isn't a tenant-trust check being loosened for admin: a
// `source='csv_upload'` site has no live connection for a schedule to ever
// fire against, migration 026's own CHECK constraint rejects the write at
// the database level regardless of which app surface sent it, and an admin
// bypassing that here would just trade a clear error message for a raw
// Postgres constraint violation instead of actually enabling anything.
export class AdminScheduleRequiresVrmApi extends Error {
  constructor() {
    super('A report schedule can only be set on a site connected via the VRM API.');
    this.name = 'AdminScheduleRequiresVrmApi';
  }
}

const ADMIN_MAX_REPORT_RECIPIENTS = 5;
const ADMIN_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function sanitizeRecipients(payload: Record<string, unknown>): void {
  if (!('report_recipients' in payload)) return;
  const raw = payload.report_recipients;
  const list = Array.isArray(raw) ? raw : [];
  payload.report_recipients = list
    .filter((e): e is string => typeof e === 'string' && ADMIN_EMAIL_RE.test(e.trim()))
    .map((e) => e.trim())
    .slice(0, ADMIN_MAX_REPORT_RECIPIENTS);
}

// Deliberately NO tier/entitlement check here, unlike
// `sites.ts:sanitizeReportModules()` — same "the admin write path is
// separate and untiered" precedent `branding.ts`'s own header comment
// states for branding (Oscar setting a Fleet customer's selection by hand,
// or a hand-negotiated exception, during onboarding or support). Only known
// module ids are validated; an empty result is stored as `null` (falls back
// to "every module on" when resolved), same as the customer-facing path.
function sanitizeReportModules(payload: Record<string, unknown>): void {
  if (!('report_modules' in payload)) return;
  const raw = payload.report_modules;
  const list = Array.isArray(raw) ? raw : [];
  const valid = list.filter((m): m is string => typeof m === 'string' && ADMIN_REPORT_MODULES.has(m));
  payload.report_modules = valid.length > 0 ? valid : null;
}

export async function getAnySite(siteId: string): Promise<SiteRecord> {
  const { data, error } = await getSupabaseAdmin().schema('vrm').from('sites').select('*').eq('site_id', siteId).single();
  if (error) throw error;
  return data as SiteRecord;
}

/** Cross-customer site edit — the admin-side counterpart of
 * `sites.ts:updateSite()`, minus the `assertOwnsSite()` call (there is no
 * "owns" check for an admin session; `/admin/sites` is allowed to touch any
 * customer's site by design). */
export async function updateAnySite(siteId: string, fields: AdminSiteUpdateFields): Promise<SiteRecord> {
  const payload = pickWhitelisted(fields as Record<string, unknown>, ADMIN_SITE_WHITELIST as readonly string[]);
  if (Object.keys(payload).length === 0) return getAnySite(siteId);
  sanitizeRecipients(payload);
  sanitizeReportModules(payload);

  if ('report_schedule' in payload && payload.report_schedule !== 'off') {
    const { data: sourceRow, error: sourceError } = await getSupabaseAdmin()
      .schema('vrm')
      .from('sites')
      .select('source')
      .eq('site_id', siteId)
      .single();
    if (sourceError) throw sourceError;
    if (sourceRow.source !== 'vrm_api') throw new AdminScheduleRequiresVrmApi();
  }

  const { data, error } = await getSupabaseAdmin().schema('vrm').from('sites').update(payload).eq('site_id', siteId).select('*').single();
  if (error) throw error;
  return data as SiteRecord;
}

/**
 * Moves a site to a different customer — the one write `/admin/sites`
 * needs that has no customer-facing equivalent at all (§1.12 rule 1: a
 * customer must never create OR rename a tenant; reassigning a site to a
 * different tenant is the same class of action). `site_id` stays exactly as
 * it was minted (`<old-customer-slug>-<site-slug>`) — reassignment does not
 * re-namespace it, so `vrm.energy_daily`/`vrm.ingestion_log` history keeps
 * resolving to the same `site_id` after the move; only the ownership
 * pointer changes.
 */
export async function reassignSite(siteId: string, newCustomerId: string): Promise<SiteRecord> {
  // Fails loudly (not a silent FK violation surfaced as a generic Postgres
  // error) if `newCustomerId` doesn't name a real customer — same "must be
  // real" contract every other cross-entity write in this app enforces
  // before touching anything.
  const { data: customerRows, error: customerError } = await getSupabaseAdmin()
    .schema('vrm')
    .from('customers')
    .select('id')
    .eq('id', newCustomerId)
    .limit(1);
  if (customerError) throw customerError;
  if (!customerRows || customerRows.length === 0) {
    throw new Error(`No such customer ${newCustomerId}.`);
  }

  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('sites')
    .update({ customer_id: newCustomerId })
    .eq('site_id', siteId)
    .select('*')
    .single();
  if (error) throw error;
  return data as SiteRecord;
}

export async function listAllIngestions(limit = 100): Promise<IngestionLogRecord[]> {
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('ingestion_log')
    .select('*')
    .order('uploaded_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as IngestionLogRecord[];
}

/**
 * `vrm.billing_events`, newest first (PLAN_PHASE16.md §3.5 / §8 Step 6) —
 * `/admin/activity`'s "Billing events" section, the only place in this
 * product an attempted webhook forgery (`secret_ok=false`) is ever visible
 * to a human (§7's failure-modes table, same row). Direct Postgres read,
 * same reasoning as `listCustomers()`'s new subscription join above — no
 * `vrm_api` bulk-read endpoint exists for this and none is needed.
 */
export async function listBillingEvents(limit = 100): Promise<BillingEventRecord[]> {
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('billing_events')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as BillingEventRecord[];
}

export type AdminSignupRow = SignupRequestRecord & {
  /** Computed HERE, once, server-side at read time — not by
   * `RecentSignupsPanel.tsx` itself, which is a Client Component and would
   * otherwise need to call `Date.now()` directly inside its render body (an
   * impure call React's own purity rule, `react-hooks/purity`, correctly
   * rejects — the same "derived figure computed once in this module"
   * pattern `listCustomers()`'s own `siteCount`/`lastUploadAt` already
   * use, for the same reason). `false` once `consumed_at` is set — an
   * already-redeemed row is never "expired," it succeeded. */
  expired: boolean;
};

/**
 * `vrm.signup_requests`, newest first (PLAN_PHASE16.md §3.7 / §8 Step 6) —
 * `/admin/activity`'s "Recent signups" panel, "the only place a signup
 * spam wave is visible before it shows up in the Resend bill" (§8 Step 6's
 * own framing). Deliberately never selects `token_hash` — that column
 * exists so a database dump is never a set of working account-creation
 * links (migration 025's own comment on that column), and this admin view
 * has no legitimate use for it either.
 */
export async function listRecentSignups(limit = 50): Promise<AdminSignupRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('signup_requests')
    .select('id, email, name, account_type, created_at, expires_at, consumed_at, customer_id')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const now = Date.now();
  return ((data ?? []) as SignupRequestRecord[]).map((row) => ({
    ...row,
    expired: !row.consumed_at && new Date(row.expires_at).getTime() < now,
  }));
}

/**
 * `vrm.report_runs`, newest first (PLAN_PHASE17.md §5.2 / §8 Step 7) —
 * `/admin/activity`'s recent-runs panel, the detection surface for "the
 * scheduled-reports cron silently stopped" (§0.5/§3.7). Same "no bulk
 * `vrm_api` endpoint exists for this and none is needed" reasoning
 * `listBillingEvents()` above already states for a different table — every
 * write to this table happens exclusively in `vrm_api/report_runs.py`,
 * nothing here ever inserts or updates a row.
 */
export async function listAllReportRuns(limit = 100): Promise<ReportRunRecord[]> {
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('report_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ReportRunRecord[];
}

// ══════════════════════════════════════════════════════════════════════
// Beta program (PLAN_BETA_PROGRAM.md §4.1/Phase 4) — /admin/beta
// ══════════════════════════════════════════════════════════════════════

function onvoMode(): string {
  return process.env.ONVO_MODE ?? 'test';
}

export type AdminBetaGrantRow = BetaGrantRecord & {
  customerName: string;
  customerSlug: string;
  customerActive: boolean;
  authEmail: string | null;
  invitedAt: string | null;
  activatedAt: string | null;
  /** The customer's CURRENT `vrm.customers.plan` — not necessarily the
   * same as `access_plan_key` once a grant has expired/converted (see
   * `apply_entitlements()`'s own §5 branch). */
  plan: string;
  billingStatus: string | null;
};

/** Every `vrm.beta_grants` row, newest first, joined with just enough of
 * its customer row for `/admin/beta`'s table — the same "joined once here,
 * not N+1 queries per row" reasoning `listCustomers()` above already
 * follows. */
export async function listBetaGrants(): Promise<AdminBetaGrantRow[]> {
  const admin = getSupabaseAdmin();

  const { data: grants, error: grantsError } = await admin
    .schema('vrm')
    .from('beta_grants')
    .select('*')
    .order('created_at', { ascending: false });
  if (grantsError) throw grantsError;

  const customerIds = [...new Set((grants ?? []).map((g) => g.customer_id as string))];
  if (customerIds.length === 0) return [];

  const { data: customers, error: customersError } = await admin
    .schema('vrm')
    .from('customers')
    .select('id, name, slug, active, auth_email, invited_at, activated_at, plan, billing_status')
    .in('id', customerIds);
  if (customersError) throw customersError;

  type CustomerJoinRow = {
    id: string;
    name: string;
    slug: string;
    active: boolean;
    auth_email: string | null;
    invited_at: string | null;
    activated_at: string | null;
    plan: string;
    billing_status: string | null;
  };
  const customerById = new Map(((customers ?? []) as CustomerJoinRow[]).map((c) => [c.id, c]));

  return ((grants ?? []) as BetaGrantRecord[]).map((g) => {
    const c = customerById.get(g.customer_id);
    return {
      ...g,
      customerName: c?.name ?? '—',
      customerSlug: c?.slug ?? '',
      customerActive: c?.active ?? false,
      authEmail: c?.auth_email ?? null,
      invitedAt: c?.invited_at ?? null,
      activatedAt: c?.activated_at ?? null,
      plan: c?.plan ?? '—',
      billingStatus: c?.billing_status ?? null,
    };
  });
}

/** The customer's own `active` grant, if any — used by `/admin/customers`'
 * badge/disabled-fields logic and by `resendInviteAction` to decide
 * whether a resend should carry beta copy (PLAN_BETA_PROGRAM.md § Phase 4:
 * "must pick the beta variant automatically when the customer has a
 * grant"). Deliberately only the ACTIVE grant — an expired/revoked/
 * converted one is history, not something a resend or the customers-page
 * badge should react to. */
export async function getActiveBetaGrant(customerId: string): Promise<BetaGrantRecord | null> {
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('beta_grants')
    .select('*')
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .limit(1);
  if (error) throw error;
  return (data?.[0] as BetaGrantRecord | undefined) ?? null;
}

export type CreateBetaGrantFields = {
  tier: BetaGrantTier;
  access_plan_key: string;
  site_limit?: number | null;
  expires_at?: string | null;
  billing_interval?: 'month' | 'year' | null;
  price_variant?: string | null;
  notes?: string | null;
};

/**
 * Inserts the customer row (§4.3's column values are the caller's job —
 * see `app/(admin)/admin/beta/actions.ts` — this function just carries
 * whatever `CreateCustomerFields` it's given straight through
 * `createCustomer()`), then the grant. If the grant insert fails, the
 * customer row is rolled back — mirrors `lib/server/db/signup.ts:
 * deleteSelfServeCustomer()`'s own rollback style (best-effort, logged,
 * never masks the original error).
 */
export async function createBetaCustomer(
  customerFields: CreateCustomerFields,
  grantFields: CreateBetaGrantFields,
  invitedByEmail: string,
): Promise<{ customer: CustomerRecord; grant: BetaGrantRecord }> {
  const customer = await createCustomer(customerFields);

  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('beta_grants')
    .insert({
      customer_id: customer.id,
      tier: grantFields.tier,
      access_plan_key: grantFields.access_plan_key,
      site_limit: grantFields.site_limit ?? null,
      expires_at: grantFields.expires_at ?? null,
      billing_interval: grantFields.billing_interval ?? null,
      price_variant: grantFields.price_variant ?? null,
      notes: grantFields.notes ?? null,
      invited_by_email: invitedByEmail,
    })
    .select('*')
    .single();

  if (error) {
    const { error: rollbackError } = await getSupabaseAdmin().schema('vrm').from('customers').delete().eq('id', customer.id);
    if (rollbackError) {
      console.error('createBetaCustomer: rollback delete failed after grant insert error', rollbackError);
    }
    throw error;
  }

  return { customer, grant: data as BetaGrantRecord };
}

/** Revoke, CAS-guarded on `status='active'` — the same discipline
 * `vrm_api/billing.py`'s own grant transitions use, so a double-click or a
 * concurrent admin tab can't revoke twice. Throws if the grant is no
 * longer active (already expired/revoked/converted) — the caller maps
 * that to a translated "already handled" message rather than a raw
 * Postgres error reaching the admin UI. */
export async function revokeBetaGrant(grantId: string, adminEmail: string): Promise<BetaGrantRecord> {
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('beta_grants')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by_email: adminEmail })
    .eq('id', grantId)
    .eq('status', 'active')
    .select('*')
    .single();
  if (error) throw error;
  return data as BetaGrantRecord;
}

export type UpdateBetaGrantFields = {
  expires_at?: string | null;
  site_limit?: number | null;
  access_plan_key?: string;
  notes?: string | null;
};

/**
 * Edits an existing grant's free-tier fields. PLAN_BETA_PROGRAM.md § Phase
 * 4: "extending an `expired` `free_until` grant re-activates it, provided
 * there is no other active grant" — handled here as the one special case:
 * setting a new `expires_at` on an already-`expired` `free_until` grant
 * flips it back to `active` (and clears `expired_at`), but only after
 * confirming the customer doesn't ALREADY have a different active grant
 * (the partial unique index would reject it anyway; this check turns that
 * into a clear error instead of a raw constraint violation).
 */
export async function updateBetaGrant(grantId: string, fields: UpdateBetaGrantFields): Promise<BetaGrantRecord> {
  const { data: existingRows, error: fetchError } = await getSupabaseAdmin()
    .schema('vrm')
    .from('beta_grants')
    .select('*')
    .eq('id', grantId)
    .limit(1);
  if (fetchError) throw fetchError;
  const existing = existingRows?.[0] as BetaGrantRecord | undefined;
  if (!existing) throw new Error('beta grant not found');

  const payload: Record<string, unknown> = { ...fields };

  if (existing.status === 'expired' && existing.tier === 'free_until' && fields.expires_at) {
    const { data: activeRows, error: activeError } = await getSupabaseAdmin()
      .schema('vrm')
      .from('beta_grants')
      .select('id')
      .eq('customer_id', existing.customer_id)
      .eq('status', 'active')
      .neq('id', grantId);
    if (activeError) throw activeError;
    if (activeRows && activeRows.length > 0) {
      throw new Error('customer already has another active grant');
    }
    payload.status = 'active';
    payload.expired_at = null;
  }

  const { data, error } = await getSupabaseAdmin().schema('vrm').from('beta_grants').update(payload).eq('id', grantId).select('*').single();
  if (error) throw error;
  return data as BetaGrantRecord;
}

/**
 * Resolves an admin's (base plan, interval, discount %) choice to one of
 * Phase 1's pre-seeded `vrm.plans` rows — NEVER trusts a client-resolved
 * `price_variant` string alone (PLAN_BETA_PROGRAM.md § Phase 4:
 * "resolves ... server-side too"). Returns `null` if that combination
 * hasn't been seeded yet (a new base plan/interval added since
 * `tools/seed_beta_discount_prices.py` last ran) — the caller 400s on
 * `null` rather than inventing a variant that doesn't exist.
 */
export async function resolveBetaDiscountPriceVariant(
  planKey: string,
  billingInterval: 'month' | 'year',
  discountPct: number,
): Promise<{ priceVariant: string; planRowId: string } | null> {
  const priceVariant = `beta_pct_${discountPct}`;
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('plans')
    .select('id')
    .eq('plan_key', planKey)
    .eq('billing_interval', billingInterval)
    .eq('price_variant', priceVariant)
    .eq('mode', onvoMode())
    .eq('active', true)
    .limit(1);
  if (error) throw error;
  const row = data?.[0] as { id: string } | undefined;
  return row ? { priceVariant, planRowId: row.id } : null;
}

// ══════════════════════════════════════════════════════════════════════
// Feedback triage + app settings (PLAN_BETA_PROGRAM.md § Phase 8) —
// /admin/feedback
// ══════════════════════════════════════════════════════════════════════

export type AdminFeedbackRow = FeedbackRecord & {
  customerName: string;
};

/** Every `vrm.feedback` row, newest first, joined with the customer's own
 * name — same "fetch everything once, filter client-side" shape
 * `listCustomers()`/`listBetaGrants()` above already use; `/admin/feedback`
 * filters (kind, status, severity, customer, text search) all run in
 * `FeedbackManager.tsx`, not here. */
export async function listFeedback(): Promise<AdminFeedbackRow[]> {
  const admin = getSupabaseAdmin();

  const { data: rows, error: rowsError } = await admin
    .schema('vrm')
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false });
  if (rowsError) throw rowsError;

  const customerIds = [...new Set((rows ?? []).map((r) => r.customer_id as string | null).filter((id): id is string => id !== null))];
  const customerNameById = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: customers, error: customersError } = await admin.schema('vrm').from('customers').select('id, name').in('id', customerIds);
    if (customersError) throw customersError;
    for (const c of (customers ?? []) as { id: string; name: string }[]) customerNameById.set(c.id, c.name);
  }

  return ((rows ?? []) as FeedbackRecord[]).map((r) => ({
    ...r,
    // A deleted customer (ON DELETE SET NULL, §4.5) leaves `customer_id`
    // NULL — the feedback text itself is what outlives them, so this
    // renders as a plain "—" rather than hiding or erroring the row.
    customerName: r.customer_id ? (customerNameById.get(r.customer_id) ?? '—') : '—',
  }));
}

export type UpdateFeedbackFields = {
  status?: FeedbackStatus;
  admin_priority?: FeedbackPriority | null;
  admin_notes?: string | null;
};

const FEEDBACK_TERMINAL_STATUSES = new Set<FeedbackStatus>(['resolved', 'wont_fix', 'duplicate']);

/** Edits the admin-owned half of a feedback row. `resolved_at` is stamped
 * automatically the moment `status` moves INTO one of the three terminal
 * values — never settable directly, and never cleared back to `null` if
 * the status later moves again (a real, one-time "when was this closed"
 * fact, not a live-editable field). */
export async function updateFeedback(id: string, fields: UpdateFeedbackFields): Promise<FeedbackRecord> {
  const payload: Record<string, unknown> = { ...fields };
  if (fields.status && FEEDBACK_TERMINAL_STATUSES.has(fields.status)) {
    payload.resolved_at = new Date().toISOString();
  }
  const { data, error } = await getSupabaseAdmin().schema('vrm').from('feedback').update(payload).eq('id', id).select('*').single();
  if (error) throw error;
  return data as FeedbackRecord;
}

/** `null` if the key has never been set — every reader (e.g.
 * `lib/server/feedbackNotify.ts`) already has its own hardcoded/env-var
 * fallback for exactly that case, per `vrm.app_settings`'s own migration
 * comment ("a missing key is not an error"). */
export async function getAppSetting(key: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().schema('vrm').from('app_settings').select('value').eq('key', key).limit(1);
  if (error) throw error;
  const row = data?.[0] as { value: string } | undefined;
  return row?.value ?? null;
}

/** Upsert, not update-only — the first time an admin ever sets a given key
 * (or a fresh environment where the seed row was never inserted), there is
 * no existing row to update yet. */
export async function setAppSetting(key: string, value: string, adminEmail: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by_email: adminEmail });
  if (error) throw error;
}

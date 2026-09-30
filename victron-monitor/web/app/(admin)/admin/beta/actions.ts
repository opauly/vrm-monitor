'use server';

import 'server-only';

// Server Actions for `/admin/beta` (PLAN_BETA_PROGRAM.md § Phase 4).
// `requireAdmin()` first in every one — same discipline
// `app/(admin)/admin/customers/actions.ts` follows, never inferred from
// `AdminLayout` already having called it.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/auth';
import {
  createBetaCustomer,
  getActiveBetaGrant,
  resolveBetaDiscountPriceVariant,
  revokeBetaGrant,
  setActive,
  updateBetaGrant,
  type CreateBetaGrantFields,
  type CreateCustomerFields,
} from '@/lib/server/db/admin';
import { sendInvite, resendInvite, findOtherCustomerByEmail, type BetaInviteContext } from '@/lib/server/invites';
import { billingRefresh } from '@/lib/server/pipeline';
import { captureServerEvent } from '@/lib/server/analytics';
import { t } from '@/lib/i18n/strings';

const stringOrNull = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null), z.string().nullable());
const numberOrNull = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}, z.number().nullable());

// The only two base plans Phase 1's seeding script actually creates
// discount rows for — see tools/seed_beta_discount_prices.py's own
// PLAN_KEYS constant. Offering any other plan_key for `discounted` would
// always 400 at the resolve step below; refusing it in the Zod shape
// itself gives a clearer error sooner.
const DISCOUNT_PLAN_KEYS = ['starter', 'growth'] as const;
const DISCOUNT_PERCENTAGES = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

const baseSchema = z.object({
  name: z.string().trim().min(1),
  accountType: z.enum(['owner', 'installer']),
  contactName: stringOrNull,
  contactEmail: stringOrNull,
  country: stringOrNull,
  authEmail: z.string().trim().email(),
  uiLanguage: z.enum(['en', 'es']),
  tier: z.enum(['free_lifetime', 'free_until', 'discounted']),
  accessPlanKey: z.string().trim().min(1),
  siteLimit: numberOrNull,
  expiresAt: stringOrNull,
  billingInterval: z.enum(['month', 'year']).nullable().optional(),
  discountPct: numberOrNull,
});

export type CreateBetaInviteState = {
  error?: string;
  success?: boolean;
  /** Same distinction `CreateCustomerState.inviteWarning` makes — the
   * customer + grant were created, but the invite email itself didn't go
   * out. */
  inviteWarning?: string;
};

export async function createBetaInviteAction(_prevState: CreateBetaInviteState, formData: FormData): Promise<CreateBetaInviteState> {
  const admin = await requireAdmin();

  const parsed = baseSchema.safeParse({
    name: formData.get('name'),
    accountType: formData.get('accountType'),
    contactName: formData.get('contactName'),
    contactEmail: formData.get('contactEmail'),
    country: formData.get('country'),
    authEmail: formData.get('authEmail'),
    uiLanguage: formData.get('uiLanguage'),
    tier: formData.get('tier'),
    accessPlanKey: formData.get('accessPlanKey'),
    siteLimit: formData.get('siteLimit'),
    expiresAt: formData.get('expiresAt'),
    billingInterval: formData.get('billingInterval') || null,
    discountPct: formData.get('discountPct'),
  });
  if (!parsed.success) {
    return { error: t(admin.uiLanguage, 'admin_beta_err_check_fields') };
  }
  const fields = parsed.data;

  // Cross-field checks Zod's flat shape above doesn't express — same
  // "Zod only checks the shape" division of labor
  // app/(admin)/admin/customers/actions.ts's own updateSchema comment
  // states, extended to this tier-conditional form.
  if (fields.tier === 'free_until' && !fields.expiresAt) {
    return { error: t(admin.uiLanguage, 'admin_beta_err_expiry_required') };
  }
  if (fields.tier === 'discounted') {
    if (!fields.billingInterval || fields.discountPct === null) {
      return { error: t(admin.uiLanguage, 'admin_beta_err_discount_fields_required') };
    }
    if (!(DISCOUNT_PLAN_KEYS as readonly string[]).includes(fields.accessPlanKey)) {
      return { error: t(admin.uiLanguage, 'admin_beta_err_discount_plan_invalid') };
    }
    if (!(DISCOUNT_PERCENTAGES as readonly number[]).includes(fields.discountPct)) {
      return { error: t(admin.uiLanguage, 'admin_beta_err_discount_pct_invalid') };
    }
  }

  // Checked up front, not just left to the DB's unique index + the catch
  // block below — that combination was surfacing the generic
  // "could not create" message instead of naming the actual conflict, since
  // by the time the insert fails the admin has no idea *which* existing
  // customer already owns this login email. Same lookup `sendInvite()`'s
  // own "already_linked_elsewhere" ladder already uses, just run earlier,
  // before anything is created.
  const existingByEmail = await findOtherCustomerByEmail(fields.authEmail);
  if (existingByEmail) {
    return { error: t(admin.uiLanguage, 'admin_beta_err_duplicate_named').replace('{name}', existingByEmail.name) };
  }

  let priceVariant: string | null = null;
  if (fields.tier === 'discounted') {
    // Never trusts a client-resolved variant string — re-resolved here
    // against the live catalog (PLAN_BETA_PROGRAM.md § Phase 4).
    const resolved = await resolveBetaDiscountPriceVariant(fields.accessPlanKey, fields.billingInterval!, fields.discountPct!);
    if (!resolved) {
      return { error: t(admin.uiLanguage, 'admin_beta_err_discount_not_seeded') };
    }
    priceVariant = resolved.priceVariant;
  }

  // PLAN_BETA_PROGRAM.md §4.3's own column-value table.
  const customerFields: CreateCustomerFields = {
    name: fields.name,
    accountType: fields.accountType,
    plan: fields.tier === 'discounted' ? 'trial' : fields.accessPlanKey,
    siteLimit: fields.tier === 'discounted' ? 0 : fields.siteLimit,
    siteLimitSource: 'plan',
    provisioningState: fields.tier === 'discounted' ? 'pending_subscription' : 'active',
    contactName: fields.contactName,
    contactEmail: fields.contactEmail,
    country: fields.country,
    uiLanguage: fields.uiLanguage,
    authEmail: fields.authEmail,
  };
  const grantFields: CreateBetaGrantFields = {
    tier: fields.tier,
    access_plan_key: fields.accessPlanKey,
    site_limit: fields.tier === 'discounted' ? null : fields.siteLimit,
    expires_at: fields.tier === 'free_until' ? fields.expiresAt : null,
    billing_interval: fields.tier === 'discounted' ? fields.billingInterval : null,
    price_variant: priceVariant,
  };

  let customerId: string;
  try {
    const created = await createBetaCustomer(customerFields, grantFields, admin.email);
    customerId = created.customer.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/duplicate key|unique/i.test(message)) {
      return { error: t(admin.uiLanguage, 'admin_beta_err_duplicate') };
    }
    return { error: t(admin.uiLanguage, 'admin_beta_err_create_generic') };
  }

  revalidatePath('/admin/beta');
  revalidatePath('/admin/customers');

  // apply_entitlements() applies the grant immediately, before the invite
  // email even goes out — so a tester who signs in a moment after
  // activating never has to wait for a later reconcile to see it.
  try {
    await billingRefresh(customerId);
  } catch (err) {
    console.error(`admin.beta_invite_refresh_failed customer_id=${customerId}`, err);
  }

  const betaContext: BetaInviteContext = { tier: fields.tier, expiresAt: fields.expiresAt };
  const inviteResult = await sendInvite(customerId, betaContext);

  console.info(`admin.beta_invite_sent customer_id=${customerId} tier=${fields.tier} admin=${admin.email}`);
  captureServerEvent(fields.authEmail, 'beta_invite_sent', { customer_id: customerId, tier: fields.tier });

  if (inviteResult.ok) return { success: true };
  const inviteWarning =
    inviteResult.reason === 'already_linked_elsewhere'
      ? t(admin.uiLanguage, 'admin_customers_warn_invite_linked_elsewhere').replace(
          '{other}',
          inviteResult.otherCustomerName ?? t(admin.uiLanguage, 'admin_customers_other_customer_fallback'),
        )
      : inviteResult.reason === 'no_login_email'
        ? t(admin.uiLanguage, 'admin_customers_warn_invite_no_email')
        : t(admin.uiLanguage, 'admin_customers_warn_invite_send_failed');
  return { success: true, inviteWarning };
}

export type BetaRowActionState = { ok?: boolean; error?: string };

/** Revoke — CAS-guarded in `revokeBetaGrant()` itself. If the invite was
 * never accepted, also deactivates the customer (PLAN_BETA_PROGRAM.md §
 * Phase 4: "Otherwise the still-valid Supabase link lets them in"). */
export async function revokeBetaGrantAction(grantId: string, customerId: string, activatedAt: string | null): Promise<BetaRowActionState> {
  const admin = await requireAdmin();
  try {
    await revokeBetaGrant(grantId, admin.email);
  } catch {
    return { error: t(admin.uiLanguage, 'admin_beta_err_revoke_generic') };
  }
  if (!activatedAt) {
    await setActive(customerId, false);
  }
  try {
    await billingRefresh(customerId);
  } catch (err) {
    console.error(`admin.beta_revoke_refresh_failed customer_id=${customerId}`, err);
  }
  console.info(`admin.beta_grant_revoked grant_id=${grantId} customer_id=${customerId} admin=${admin.email}`);
  captureServerEvent(admin.email, 'beta_grant_revoked', { customer_id: customerId, grant_id: grantId });
  revalidatePath('/admin/beta');
  revalidatePath('/admin/customers');
  return { ok: true };
}

const extendSchema = z.object({
  expiresAt: z.string().trim().min(1),
});

/** Extends a `free_until` grant's expiry — re-activates it if it had
 * already expired (`updateBetaGrant()`'s own "provided there is no other
 * active grant" guard). */
export async function extendBetaGrantAction(
  grantId: string,
  customerId: string,
  _prevState: BetaRowActionState,
  formData: FormData,
): Promise<BetaRowActionState> {
  const admin = await requireAdmin();
  const parsed = extendSchema.safeParse({ expiresAt: formData.get('expiresAt') });
  if (!parsed.success) return { error: t(admin.uiLanguage, 'admin_beta_err_check_fields') };

  try {
    await updateBetaGrant(grantId, { expires_at: parsed.data.expiresAt });
  } catch {
    return { error: t(admin.uiLanguage, 'admin_beta_err_extend_generic') };
  }
  try {
    await billingRefresh(customerId);
  } catch (err) {
    console.error(`admin.beta_extend_refresh_failed customer_id=${customerId}`, err);
  }
  console.info(`admin.beta_grant_extended grant_id=${grantId} customer_id=${customerId} admin=${admin.email}`);
  revalidatePath('/admin/beta');
  revalidatePath('/admin/customers');
  return { ok: true };
}

/** "Resend invite" from `/admin/beta` — always carries beta copy (the
 * customer necessarily has an active grant to appear on this page's
 * table at all), unlike `/admin/customers`' own resend button, which must
 * first check whether one exists. */
export async function resendBetaInviteAction(customerId: string): Promise<BetaRowActionState> {
  const admin = await requireAdmin();
  const grant = await getActiveBetaGrant(customerId);
  const beta: BetaInviteContext | undefined = grant ? { tier: grant.tier, expiresAt: grant.expires_at } : undefined;
  const result = await resendInvite(customerId, beta);
  revalidatePath('/admin/beta');
  if (!result.ok) {
    return {
      error:
        result.reason === 'no_login_email'
          ? t(admin.uiLanguage, 'admin_customers_err_no_login_email')
          : t(admin.uiLanguage, 'admin_customers_err_resend_generic'),
    };
  }
  return { ok: true };
}

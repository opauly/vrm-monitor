import 'server-only';

// Invite / activation-link mechanics (PLAN_PHASE14.md §1.9, §2 Step 7).
//
// `generateLink()` -> `hashed_token` -> `{SITE_URL}/activate?token_hash=...&
// type=...` -> render + send via Resend -> stamp `invited_at`/`auth_user_id`/
// `auth_email` on the `vrm.customers` row. Re-sends and "forgot password"
// use `type: 'recovery'` through the same `/activate` page.
//
// This module is admin-only in practice (only `/admin/customers` and
// `/forgot` call it) but is not gated the way `lib/server/db/admin.ts` is —
// `sendPasswordReset()` is deliberately callable from an unauthenticated
// route (`/forgot`), since asking for a password reset is, by definition,
// something a not-yet-signed-in visitor does.
import { getSupabaseAdmin } from './supabase';
import { getCustomer } from './db/customers';
import { sendEmail } from './resend';
import { renderActivationEmail } from './emailTemplates';
import { SITE_URL } from '@/lib/site';
import { t, type Lang } from '@/lib/i18n/strings';
import type { BetaGrantTier } from './db/types';

export type LinkType = 'invite' | 'recovery' | 'magiclink';

function buildActivationUrl(tokenHash: string, type: LinkType, next?: string): string {
  const url = new URL('/activate', SITE_URL);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', type);
  if (next) url.searchParams.set('next', next);
  return url.toString();
}

/**
 * PLAN_BETA_PROGRAM.md § Phase 4 — carried by `sendInvite()`/`resendInvite()`
 * to pick beta-specific email copy and (for `discounted`) land the tester
 * straight on `/app/billing`. Deliberately a small, self-contained context
 * rather than this module looking up `vrm.beta_grants` itself — `invites.ts`
 * is used from `/forgot` (unauthenticated) too, and has no business knowing
 * that table exists; the caller (an admin action, which already has the
 * grant row in hand) passes exactly what's needed.
 */
export type BetaInviteContext = {
  tier: BetaGrantTier;
  /** Only meaningful for `tier: 'free_until'` — ISO date/timestamp, used to
   * fill `{date}` in the tier-specific intro copy. */
  expiresAt?: string | null;
};

function betaInviteCopy(lang: Lang, beta: BetaInviteContext): { heading: string; intro: string; footer: string; subject: string; next?: string } {
  const heading = t(lang, 'email_beta_invite_heading');
  const intro =
    beta.tier === 'free_lifetime'
      ? t(lang, 'email_beta_invite_intro_free_lifetime')
      : beta.tier === 'free_until'
        ? t(lang, 'email_beta_invite_intro_free_until').replace('{date}', beta.expiresAt ? beta.expiresAt.slice(0, 10) : '')
        : t(lang, 'email_beta_invite_intro_discounted');
  return {
    heading,
    intro,
    footer: t(lang, 'email_beta_invite_footer'),
    subject: t(lang, 'email_beta_invite_subject'),
    // Only the discounted tier has a real destination worth jumping
    // straight to — a free tester's first stop is just `/app` (the
    // `sanitizeNextPath()` default in `app/(auth)/activate/page.tsx`).
    next: beta.tier === 'discounted' ? '/app/billing' : undefined,
  };
}

/**
 * Sets `vrm.customers.invited_at`/`auth_user_id`/`auth_email` directly —
 * NOT through `lib/server/db/admin.ts:updateCustomer()`'s whitelist, which
 * explicitly excludes these three columns as "invite-flow state ... stamped
 * by `lib/server/invites.ts`" (see that file's own comment on
 * `ADMIN_CUSTOMER_WHITELIST`). This is the one place in the app allowed to
 * write them, matching `createCustomer()`'s own comment that it deliberately
 * does NOT touch them at row-creation time.
 *
 * Exported (PLAN_PHASE16.md §5.5 step 2) so `app/(auth)/signup/verify/
 * route.ts` can call it too, once it has created the `vrm.customers` row
 * `createOrLinkAuthUser()` below just linked an auth user to — the same
 * "one place allowed to write these three columns" comment now has a
 * second sanctioned caller, not a second implementation.
 */
export async function stampInvited(customerId: string, authUserId: string, authEmail: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('customers')
    .update({ auth_user_id: authUserId, auth_email: authEmail, invited_at: new Date().toISOString() })
    .eq('id', customerId);
  if (error) throw error;
}

/** Stamped once, on the first successful `/activate` password-set — see
 * `app/(auth)/activate/actions.ts`. Looked up by `auth_user_id` (the
 * session established by `verifyOtp`), not `customerId`, since the
 * activation page has no session-independent way to know which customer it
 * is until that lookup resolves. */
export async function markActivated(authUserId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('customers')
    .update({ activated_at: new Date().toISOString() })
    .eq('auth_user_id', authUserId);
  if (error) throw error;
}

/** The customer row `authUserId` resolves to, or `null` if none links to it
 * — used by the activation flow immediately after `verifyOtp()` succeeds,
 * before `markActivated()`/redirecting into `/app`. */
export async function getCustomerByAuthUserId(authUserId: string): Promise<{ id: string } | null> {
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('customers')
    .select('id')
    .eq('auth_user_id', authUserId)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as { id: string } | undefined) ?? null;
}

/**
 * `excludeCustomerId` is optional so `createOrLinkAuthUser()` can be called
 * for a customer row that doesn't exist yet at the time of the call (the
 * public signup verify handler creates its `vrm.customers` row FIRST, then
 * calls this — see that function's own comment on why the exclusion
 * matters there specifically, not just for `sendInvite()`'s existing
 * customer).
 */
export async function findOtherCustomerByEmail(email: string, excludeCustomerId?: string): Promise<{ id: string; name: string } | null> {
  let query = getSupabaseAdmin().schema('vrm').from('customers').select('id, name').ilike('auth_email', email).limit(1);
  if (excludeCustomerId) query = query.neq('id', excludeCustomerId);
  const { data, error } = await query;
  if (error) throw error;
  return (data?.[0] as { id: string; name: string } | undefined) ?? null;
}

/**
 * Linear scan of `listUsers()` for a case-insensitive email match.
 * supabase-js's Admin API has no `getUserByEmail()` — only paginated
 * `listUsers()` — so this is the only way to answer "does an auth user with
 * this email already exist, unlinked to any customer." One page (200) is
 * generous headroom for this product's actual scale (a handful of
 * customers plus Oscar's own admin account); if the user base ever grows
 * past that, this needs real pagination, not a bigger single page.
 */
async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const match = data.users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
  return match ? { id: match.id } : null;
}

function isEmailExistsError(err: { code?: string; status?: number; message?: string }): boolean {
  // 'email_exists' is the typed code (@supabase/auth-js's ErrorCode union).
  // The message-substring fallback is defensive, not the primary check —
  // Supabase's own copy for this case has read "already been registered"
  // across the versions this repo has seen, but a typed code should never
  // be second-guessed by a string match when it's present.
  if (err.code === 'email_exists') return true;
  return /already.*(registered|exists)/i.test(err.message ?? '');
}

export type CreateOrLinkAuthUserResult =
  | { ok: true; userId: string; hashedToken: string; linkType: LinkType; linkedExistingLogin: boolean }
  | { ok: false; reason: 'already_linked_elsewhere'; otherCustomerName?: string }
  | { ok: false; reason: 'send_failed' };

/**
 * The "email already exists" ladder (PLAN_PHASE14.md §2 Step 7) — lifted
 * out of `sendInvite()` (PLAN_PHASE16.md §5.5 step 2) so BOTH `sendInvite()`
 * (an already-invited customer, Oscar's own flow — see its call site below)
 * and `app/(auth)/signup/verify/route.ts` (a stranger's self-serve signup)
 * get identical behaviour for the same underlying case instead of two
 * independent copies drifting apart. `generateLink({type:'invite'})` ->
 * `email_exists` -> `findOtherCustomerByEmail` -> `findAuthUserByEmail` ->
 * `generateLink({type:'recovery'})`, exactly as before.
 *
 * Deliberately does NOT send an email or touch `vrm.customers` — it only
 * creates/links the Supabase Auth user and mints a `generateLink()`
 * `hashed_token`. Each caller decides what to do with that token:
 * `sendInvite()` emails it and calls `stampInvited()`; the signup verify
 * route redirects straight into `/activate` with it (no second email) and
 * calls `stampInvited()` itself.
 *
 * `excludeCustomerId` is the customer that should never be reported back
 * as "another customer already claims this email" — `sendInvite()` passes
 * its own customer's id (unchanged behaviour); the signup verify route
 * passes the `vrm.customers` row IT JUST INSERTED (with this same
 * `auth_email`), because without that exclusion `findOtherCustomerByEmail`
 * would find that brand-new row itself and every self-serve signup would
 * incorrectly roll back as "already linked elsewhere."
 */
export async function createOrLinkAuthUser(email: string, excludeCustomerId?: string): Promise<CreateOrLinkAuthUserResult> {
  const admin = getSupabaseAdmin();
  const first = await admin.auth.admin.generateLink({ type: 'invite', email });

  if (!first.error) {
    const hashedToken = first.data.properties?.hashed_token;
    const userId = first.data.user?.id;
    if (!hashedToken || !userId) return { ok: false, reason: 'send_failed' };
    return { ok: true, userId, hashedToken, linkType: 'invite', linkedExistingLogin: false };
  }

  if (!isEmailExistsError(first.error)) return { ok: false, reason: 'send_failed' };

  // "Email already registered" — PLAN_PHASE14.md §2 Step 7's explicit
  // handling: a DIFFERENT customer already claims this login email ->
  // refuse with a clear message; an unlinked auth user (no vrm.customers
  // row points at it — leftover from Phase 13's Streamlit testing, or a
  // customer Oscar deleted and is now re-creating under the same address)
  // -> link it to this customer instead of erroring.
  const other = await findOtherCustomerByEmail(email, excludeCustomerId);
  if (other) return { ok: false, reason: 'already_linked_elsewhere', otherCustomerName: other.name };

  const existingAuthUser = await findAuthUserByEmail(email);
  if (!existingAuthUser) return { ok: false, reason: 'send_failed' };

  // The existing auth user is already confirmed (it had to exist for
  // 'invite' to reject it as a duplicate) — 'invite' only works for
  // brand-new, unconfirmed users, so linking uses 'recovery' instead,
  // exactly the mechanism `resendInvite()` uses for a returning customer.
  const second = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (second.error) return { ok: false, reason: 'send_failed' };
  const hashedToken = second.data.properties?.hashed_token;
  const userId = second.data.user?.id;
  if (!hashedToken || !userId) return { ok: false, reason: 'send_failed' };
  return { ok: true, userId, hashedToken, linkType: 'recovery', linkedExistingLogin: true };
}

export type SendInviteResult =
  | { ok: true; linkedExistingLogin: boolean; messageId: string }
  | { ok: false; reason: 'no_login_email' | 'already_linked_elsewhere'; otherCustomerName?: string }
  | { ok: false; reason: 'send_failed' };

/**
 * First invite for a customer that has a login email set (`auth_email`,
 * captured on the create-customer form) but no Supabase Auth user yet
 * (`auth_user_id` still null). `createOrLinkAuthUser()` above does the
 * actual `generateLink()`-plus-fallback work; this function's own job is
 * just the customer lookup, the email send, and stamping the result.
 */
export async function sendInvite(customerId: string, beta?: BetaInviteContext): Promise<SendInviteResult> {
  const customer = await getCustomer(customerId);
  if (!customer.auth_email) return { ok: false, reason: 'no_login_email' };
  const email = customer.auth_email;
  const lang: Lang = customer.ui_language === 'es' ? 'es' : 'en';

  const result = await createOrLinkAuthUser(email, customerId);
  if (!result.ok) return result;

  return finishSendInvite(customerId, email, result.userId, result.hashedToken, result.linkType, result.linkedExistingLogin, lang, beta);
}

async function finishSendInvite(
  customerId: string,
  email: string,
  userId: string,
  hashedToken: string,
  linkType: LinkType,
  linkedExistingLogin: boolean,
  lang: Lang,
  beta?: BetaInviteContext,
): Promise<SendInviteResult> {
  const copy = beta
    ? betaInviteCopy(lang, beta)
    : {
        heading: t(lang, 'email_invite_heading'),
        intro: t(lang, 'email_invite_intro'),
        footer: t(lang, 'email_invite_footer'),
        subject: t(lang, 'email_invite_subject'),
        next: undefined as string | undefined,
      };
  const ctaUrl = buildActivationUrl(hashedToken, linkType, copy.next);
  const html = renderActivationEmail({
    heading: copy.heading,
    intro: copy.intro,
    ctaLabel: t(lang, 'email_invite_cta'),
    ctaUrl,
    footerNote: copy.footer,
    lang,
  });

  let messageId: string;
  try {
    messageId = await sendEmail({ to: email, subject: copy.subject, html });
  } catch {
    return { ok: false, reason: 'send_failed' };
  }

  await stampInvited(customerId, userId, email);
  // Resend's own message id — the concrete, checkable evidence that the
  // send was actually accepted (PLAN_PHASE14.md §2 Step 7's validation:
  // "confirm via Resend's own API response that the send succeeded —
  // message id / status"), not just "no exception was thrown."
  return { ok: true, linkedExistingLogin, messageId };
}

export type ResendInviteResult = { ok: true } | { ok: false; reason: 'no_login_email' | 'send_failed' };

/**
 * Re-send for a customer that already has a Supabase Auth user
 * (`auth_user_id` set — whether or not they ever finished activating).
 * Uses `type: 'recovery'`, per PLAN_PHASE14.md §1.9.
 *
 * ── The empirical question this closes ──────────────────────────────────
 * Does `generateLink({type: 'recovery'})` work for a user who was invited
 * but never activated (an unconfirmed email)? Tested directly against this
 * project's Supabase instance during this step's validation with a
 * throwaway address (create via `type: 'invite'`, immediately request
 * `type: 'recovery'` on the same still-unconfirmed user, never click
 * either link) — see this step's coder report / `README.md` for the
 * recorded result. This function falls back to `type: 'magiclink'` if
 * `recovery` errors, so the answer being "no" doesn't leave a customer with
 * no way back in.
 */
export async function resendInvite(customerId: string, beta?: BetaInviteContext): Promise<ResendInviteResult> {
  const customer = await getCustomer(customerId);
  if (!customer.auth_email) return { ok: false, reason: 'no_login_email' };
  const email = customer.auth_email;
  const lang: Lang = customer.ui_language === 'es' ? 'es' : 'en';

  const admin = getSupabaseAdmin();
  let linkType: LinkType = 'recovery';
  let result = await admin.auth.admin.generateLink({ type: 'recovery', email });
  if (result.error) {
    linkType = 'magiclink';
    result = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  }
  if (result.error) return { ok: false, reason: 'send_failed' };

  const hashedToken = result.data.properties?.hashed_token;
  if (!hashedToken) return { ok: false, reason: 'send_failed' };

  // A beta resend reuses the SAME tier-specific intro as the original
  // invite (no separate "beta resend" copy) — simpler, and a returning
  // tester re-reading "you've been invited free" is not confusing the way
  // a standard customer re-reading a first-invite intro on a resend would
  // be (which is why the non-beta branch below keeps its own dedicated
  // `email_resend_intro`).
  const copy = beta
    ? betaInviteCopy(lang, beta)
    : {
        heading: t(lang, 'email_invite_heading'),
        intro: t(lang, 'email_resend_intro'),
        footer: t(lang, 'email_invite_footer'),
        subject: t(lang, 'email_resend_subject'),
        next: undefined as string | undefined,
      };
  const ctaUrl = buildActivationUrl(hashedToken, linkType, copy.next);
  const html = renderActivationEmail({
    heading: copy.heading,
    intro: copy.intro,
    ctaLabel: t(lang, 'email_invite_cta'),
    ctaUrl,
    footerNote: copy.footer,
    lang,
  });

  try {
    await sendEmail({ to: email, subject: copy.subject, html });
  } catch {
    return { ok: false, reason: 'send_failed' };
  }

  // Bumping invited_at on every resend keeps "Invitado <date>" (the
  // /admin/customers status column) showing the most recent send, not the
  // original one — the same reasoning `updated_at`-style columns exist for
  // elsewhere in this schema.
  const { error } = await getSupabaseAdmin().schema('vrm').from('customers').update({ invited_at: new Date().toISOString() }).eq('id', customerId);
  if (error) throw error;
  return { ok: true };
}

/**
 * The `/forgot` flow's only entry point. Deliberately returns nothing that
 * distinguishes "no such login" from "email sent" — the caller
 * (`app/(auth)/forgot/actions.ts`) shows the exact same neutral copy either
 * way, regardless of what this function actually did internally. That is
 * the whole security property `/forgot` exists to provide (no account
 * enumeration via response difference), so it is enforced here, at the one
 * place that knows the real answer, rather than trusted to every future
 * caller to remember not to leak it.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) return;

  // Only a customer with an already-linked login is a real "forgot
  // password" case — an `auth_email` with no `auth_user_id` yet is a
  // customer Oscar created but never invited, which is `sendInvite()`'s
  // job, not this one, and silently doing nothing for that row is exactly
  // the "no observable difference" behaviour this function promises.
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('customers')
    .select('id, auth_user_id, active, ui_language')
    .ilike('auth_email', trimmed)
    .limit(1);
  if (error) throw error;
  const customer = (data?.[0] as { id: string; auth_user_id: string | null; active: boolean; ui_language: string | null } | undefined) ?? undefined;
  if (!customer || !customer.auth_user_id || !customer.active) return;
  const lang: Lang = customer.ui_language === 'es' ? 'es' : 'en';

  const admin = getSupabaseAdmin();
  let linkType: LinkType = 'recovery';
  let result = await admin.auth.admin.generateLink({ type: 'recovery', email: trimmed });
  if (result.error) {
    linkType = 'magiclink';
    result = await admin.auth.admin.generateLink({ type: 'magiclink', email: trimmed });
  }
  if (result.error) return; // Nothing more this function can do — and nothing the caller should surface differently either way.

  const hashedToken = result.data.properties?.hashed_token;
  if (!hashedToken) return;

  const ctaUrl = buildActivationUrl(hashedToken, linkType);
  const html = renderActivationEmail({
    heading: t(lang, 'email_reset_heading'),
    intro: t(lang, 'email_reset_intro'),
    ctaLabel: t(lang, 'email_reset_cta'),
    ctaUrl,
    footerNote: t(lang, 'email_reset_footer'),
    lang,
  });

  try {
    await sendEmail({ to: trimmed, subject: t(lang, 'email_reset_subject'), html });
  } catch {
    // Swallowed on purpose — see the function docstring. A Resend outage
    // must not turn into a response difference an attacker could probe for.
  }
}

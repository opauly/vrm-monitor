import 'server-only';

// PLAN_BETA_PROGRAM.md § Phase 6 — one email per feedback submission
// (§11 Q11: "email per submission," not a digest), to the address stored
// in `vrm.app_settings` (admin-editable from `/admin/feedback`, Phase 8),
// falling back to `FEEDBACK_NOTIFY_EMAIL` and then a hardcoded address so
// a missing setting/env var never breaks a submission.
//
// Reads `vrm.app_settings` directly here rather than through
// `lib/server/db/admin.ts` — this is called from the PORTAL's own feedback
// action (`app/(portal)/app/feedback/actions.ts`), and `admin.ts` is
// admin-only by convention (its own header comment: "only code under
// app/(admin)/admin/** may import this file"). `vrm.app_settings` is a
// small system-config table, not tenant data, so a direct read here isn't
// a tenant-isolation concern the way importing admin.ts's CUSTOMER reads
// would be.
import { getSupabaseAdmin } from './supabase';
import { sendEmail, MailerError } from './resend';
import { renderActivationEmail } from './emailTemplates';
import { SITE_URL } from '@/lib/site';
import { t, type Lang } from '@/lib/i18n/strings';
import type { FeedbackRecord } from './db/types';

const DEFAULT_NOTIFY_EMAIL = 'info@paulyco.com';

async function getFeedbackNotifyEmail(): Promise<string> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .schema('vrm')
      .from('app_settings')
      .select('value')
      .eq('key', 'feedback_notify_email')
      .limit(1);
    if (error) throw error;
    const row = data?.[0] as { value: string } | undefined;
    if (row?.value) return row.value;
  } catch (err) {
    console.error('feedbackNotify: could not read vrm.app_settings.feedback_notify_email', err);
  }
  return process.env.FEEDBACK_NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL;
}

/**
 * Never throws — a failed notification must not fail the feedback
 * submission itself (the row is already saved by the time this is
 * called; the customer's own success state doesn't depend on this).
 */
export async function notifyFeedback(feedback: FeedbackRecord, customerName: string): Promise<void> {
  // Admin has no stored language of its own (this notification isn't tied
  // to any one admin's session) — a dedicated env var, default 'en', per
  // the plan's own wording.
  const lang: Lang = (process.env.FEEDBACK_NOTIFY_LANG === 'es' ? 'es' : 'en');

  const kindLabel = t(lang, feedback.kind === 'bug' ? 'email_feedback_heading_bug' : 'email_feedback_heading_suggestion');
  const severityLabel = feedback.severity ? t(lang, `email_feedback_severity_${feedback.severity}` as const) : null;
  const heading = severityLabel ? `${kindLabel} (${severityLabel})` : kindLabel;

  const intro = t(lang, 'email_feedback_intro')
    .replace('{customer}', customerName)
    .replace('{page}', feedback.page_path || '—');

  const ctaUrl = new URL('/admin/feedback', SITE_URL);
  ctaUrl.searchParams.set('id', feedback.id);

  const html = renderActivationEmail({
    heading,
    intro,
    ctaLabel: t(lang, 'email_feedback_cta'),
    ctaUrl: ctaUrl.toString(),
    footerNote: t(lang, 'email_feedback_footer'),
    lang,
  });

  const to = await getFeedbackNotifyEmail();
  try {
    await sendEmail({ to, subject: heading, html, replyTo: feedback.submitter_email });
  } catch (err) {
    // MailerError already carries a safe, non-sensitive message
    // (resend.ts's own comment) — logged either way, never rethrown.
    if (err instanceof MailerError) {
      console.error(`feedbackNotify: could not email feedback ${feedback.id} — ${err.message}`);
    } else {
      console.error(`feedbackNotify: unexpected error notifying feedback ${feedback.id}`, err);
    }
  }
}

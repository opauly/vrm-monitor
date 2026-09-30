'use server';

import 'server-only';

// Server Action behind the feedback widget (PLAN_BETA_PROGRAM.md § Phase
// 6). `requireCustomerAllowPending()`, not `requireCustomer()` — a pending
// discounted tester stuck on `/app/billing` can still report a bug (§11
// Q10: open to every customer, no other gate). Imported directly by
// `components/app/FeedbackWidget/FeedbackWidget.tsx` (a shared component,
// not co-located with this route) via the `@/app/...` alias — same
// cross-boundary import shape `components/marketing/DashboardPreview.tsx`
// already uses for `@/app/(admin)/admin/fleet/ShapeChart`, not a new
// pattern.
import { headers } from 'next/headers';
import { z } from 'zod';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { createFeedback, getCustomer } from '@/lib/server/db';
import { checkRateLimit } from '@/lib/server/ratelimit';
import { notifyFeedback } from '@/lib/server/feedbackNotify';
import { t } from '@/lib/i18n/strings';

const stringOrNull = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null), z.string().nullable());

// Matches vrm.feedback's own CHECK constraints (title/body length) — Zod
// only checks the shape; `lib/server/db/feedback.ts:createFeedback()`'s
// site_id/screenshot_path validation is the real control, per this
// codebase's usual "Zod is shape, the DB layer is the guard" split.
const feedbackSchema = z.object({
  kind: z.enum(['bug', 'suggestion']),
  severity: z.enum(['low', 'medium', 'high', 'blocker']).nullable(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  pagePath: stringOrNull,
  siteId: stringOrNull,
  screenshotPath: stringOrNull,
});

export type SubmitFeedbackState = { error?: string; success?: boolean };

export async function submitFeedbackAction(_prevState: SubmitFeedbackState, formData: FormData): Promise<SubmitFeedbackState> {
  const session = await requireCustomerAllowPending();

  const parsed = feedbackSchema.safeParse({
    kind: formData.get('kind'),
    severity: formData.get('severity') || null,
    title: formData.get('title'),
    body: formData.get('body'),
    pagePath: formData.get('pagePath'),
    siteId: formData.get('siteId'),
    screenshotPath: formData.get('screenshotPath'),
  });
  if (!parsed.success) {
    return { error: t(session.uiLanguage, 'feedback_err_check_fields') };
  }
  const fields = parsed.data;

  const allowed = await checkRateLimit('feedback_customer', session.customerId, 3600, 20);
  if (!allowed) {
    return { error: t(session.uiLanguage, 'feedback_err_rate_limited') };
  }

  const h = await headers();
  const userAgent = h.get('user-agent');

  // Never trusts a client-sent query string — stripped here, same "the
  // dropdown is UI; the guard is the control" discipline `sites.ts`'s own
  // header comment states for this whole layer.
  const pagePath = fields.pagePath ? fields.pagePath.split('?')[0].slice(0, 500) : null;

  let customerName = session.email;
  try {
    const customer = await getCustomer(session.customerId);
    customerName = customer.name;
  } catch {
    // Non-fatal — the notification email just falls back to the login
    // email if the customer row can't be read for some reason.
  }

  let feedback;
  try {
    feedback = await createFeedback(session.customerId, {
      submitterEmail: session.email,
      authUserId: session.userId,
      kind: fields.kind,
      severity: fields.kind === 'bug' ? fields.severity : null,
      title: fields.title,
      body: fields.body,
      pagePath,
      siteId: fields.siteId,
      uiLanguage: session.uiLanguage,
      userAgent,
      appVersion: process.env.VERCEL_GIT_COMMIT_SHA || null,
      screenshotPath: fields.screenshotPath,
    });
  } catch {
    return { error: t(session.uiLanguage, 'feedback_err_submit_generic') };
  }

  await notifyFeedback(feedback, customerName);

  return { success: true };
}

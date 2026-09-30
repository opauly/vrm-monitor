import 'server-only';

// Feedback half of the tenant-scoping choke point (PLAN_BETA_PROGRAM.md
// §4.5/Phase 6). Open to every customer, not just beta testers (§11 Q10) —
// `createFeedback()` takes `customerId` from the session (its caller,
// `app/(portal)/app/feedback/actions.ts`, never trusts a client-sent one),
// same "the dropdown is UI; the guard is the control" discipline
// `sites.ts`'s own header comment states. No `listOwnFeedback()` — §11 Q14
// resolved admin-only visibility (the submitter never reads status/
// admin_notes back); `lib/server/db/admin.ts:listFeedback()` (Phase 8) is
// the only reader.
import { getSupabaseAdmin } from '@/lib/server/supabase';
import { assertOwnsSite } from './sites';
import type { FeedbackKind, FeedbackRecord, FeedbackSeverity, Lang } from './types';

export type CreateFeedbackFields = {
  submitterEmail: string;
  authUserId: string | null;
  kind: FeedbackKind;
  /** Bug only — dropped (stored NULL) for a suggestion regardless of what
   * the client sent, same belt-and-suspenders the Zod shape in `actions.ts`
   * already enforces at the form-validation layer. */
  severity: FeedbackSeverity | null;
  title: string;
  body: string;
  pagePath: string | null;
  /** Validated against `assertOwnsSite()` below — never trusted as-is. */
  siteId: string | null;
  uiLanguage: Lang | null;
  userAgent: string | null;
  appVersion: string | null;
  /** Validated against the `feedback/{customerId}/` prefix below — never
   * trusted as-is (Phase 7). */
  screenshotPath: string | null;
};

/**
 * Inserts one `vrm.feedback` row. A forged/foreign `site_id` or a
 * `screenshot_path` outside this customer's own prefix is silently
 * dropped (stored NULL) rather than failing the whole submission — the
 * feedback text itself is what matters; losing it over a bad site
 * reference the customer didn't consciously choose would be a worse
 * outcome than just not tagging it to a site.
 */
export async function createFeedback(customerId: string, fields: CreateFeedbackFields): Promise<FeedbackRecord> {
  let siteId: string | null = null;
  if (fields.siteId) {
    try {
      await assertOwnsSite(customerId, fields.siteId);
      siteId = fields.siteId;
    } catch {
      siteId = null;
    }
  }

  const screenshotPath =
    fields.screenshotPath && fields.screenshotPath.startsWith(`feedback/${customerId}/`) ? fields.screenshotPath : null;

  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('feedback')
    .insert({
      customer_id: customerId,
      auth_user_id: fields.authUserId,
      submitter_email: fields.submitterEmail,
      kind: fields.kind,
      severity: fields.kind === 'bug' ? fields.severity : null,
      title: fields.title,
      body: fields.body,
      page_path: fields.pagePath,
      site_id: siteId,
      ui_language: fields.uiLanguage,
      user_agent: fields.userAgent,
      app_version: fields.appVersion,
      screenshot_path: screenshotPath,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as FeedbackRecord;
}

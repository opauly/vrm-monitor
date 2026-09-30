import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { listFeedback, getAppSetting } from '@/lib/server/db/admin';
import { t } from '@/lib/i18n/strings';
import { FeedbackManager } from './FeedbackManager';

export const metadata: Metadata = {
  title: 'Feedback — Admin',
};

// `/admin/feedback` (PLAN_BETA_PROGRAM.md § Phase 8) — triage every
// submission, and edit the notification address (§4.6/§11 Q11).
// `requireAdmin()` first, per the same convention every other `/admin/*`
// page follows even though `AdminLayout` already called it.
export default async function AdminFeedbackPage() {
  const session = await requireAdmin();
  const lang = session.uiLanguage;
  const [feedback, notifyEmail] = await Promise.all([listFeedback(), getAppSetting('feedback_notify_email')]);

  return (
    <div>
      <h1>{t(lang, 'admin_feedback_title')}</h1>
      <p className="mono page-desc">{t(lang, 'admin_feedback_desc')}</p>
      <FeedbackManager feedback={feedback} notifyEmail={notifyEmail ?? ''} lang={lang} />
    </div>
  );
}

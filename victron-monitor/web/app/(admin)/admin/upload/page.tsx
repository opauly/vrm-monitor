import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { listCustomers } from '@/lib/server/db/admin';
import { t } from '@/lib/i18n/strings';
import { AdminUploadManager } from './AdminUploadManager';

export const metadata: Metadata = {
  title: 'Upload CSV — Admin',
};

// `/admin/upload` (PLAN_PHASE14.md §2 Step 7) — same upload UX as
// `/app/upload`, but with a customer picker first: the one legitimate
// admin-session path to "upload on behalf of a chosen customer," reachable
// only from `requireAdmin()`.
export default async function AdminUploadPage() {
  const session = await requireAdmin();
  const lang = session.uiLanguage;
  // Deactivated customers (QA fixtures, cancelled trials) never belong in a
  // live picker regardless of origin — `/admin/customers` is where Oscar
  // still manages/reactivates them. The admin-vs-self-serve distinction
  // itself is a filter inside AdminUploadManager, not a hard exclusion here,
  // since Oscar's own admin-linked installations are still real customer
  // records he may need to pick.
  const customers = (await listCustomers()).filter((c) => c.active);

  return (
    <div>
      <h1>{t(lang, 'admin_upload_title')}</h1>
      <p className="mono page-desc">{t(lang, 'admin_upload_desc')}</p>
      <AdminUploadManager customers={customers} lang={lang} />
    </div>
  );
}

import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { listAllSites, listCustomers } from '@/lib/server/db/admin';
import { t } from '@/lib/i18n/strings';
import { AdminReportsManager } from './AdminReportsManager';

export const metadata: Metadata = {
  title: 'Reports — Admin',
};

// `/admin/reports` (PLAN_PHASE14.md §2 Step 7) — like `/app`'s report
// generation, but both `vrm` and `monitoring` schemas selectable, with
// `actor: "admin"` set on every call (`app/api/admin/pipeline/reports`).
// `vrmSites` comes straight from `listAllSites()` (already built, Step 4)
// rather than a round trip through `vrm_api`'s new `GET /v1/sites` — that
// endpoint's real reason to exist is `monitoring`, which has no
// `vrm.customers`-backed table to read here (see
// `lib/server/pipeline.ts:listSitesForSchema()`'s own comment).
export default async function AdminReportsPage() {
  const session = await requireAdmin();
  const lang = session.uiLanguage;
  const [vrmSites, allCustomers] = await Promise.all([listAllSites(), listCustomers()]);
  // Same active-only filter as `/admin/upload` — see that page's own
  // comment. The admin-vs-self-serve split is a togglable filter inside
  // AdminReportsManager, not a hard exclusion, so a report can still be
  // generated for one of Oscar's own admin-linked installations.
  const customers = allCustomers.filter((c) => c.active);

  return (
    <div>
      <h1>{t(lang, 'admin_reports_title')}</h1>
      <p className="mono page-desc">
        {t(lang, 'admin_reports_desc_1')} <code>vrm</code> {t(lang, 'admin_reports_desc_2')} <code>monitoring</code>{' '}
        {t(lang, 'admin_reports_desc_3')}
      </p>
      <AdminReportsManager vrmSites={vrmSites} customers={customers} lang={lang} />
    </div>
  );
}

import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { listBetaGrants } from '@/lib/server/db/admin';
import { t } from '@/lib/i18n/strings';
import { BetaManager } from './BetaManager';

export const metadata: Metadata = {
  title: 'Beta program — Admin',
};

// `/admin/beta` (PLAN_BETA_PROGRAM.md § Phase 4) — invite and manage beta
// testers. `requireAdmin()` first, per the same convention every other
// `/admin/*` page follows even though `AdminLayout` already called it.
export default async function AdminBetaPage() {
  const session = await requireAdmin();
  const lang = session.uiLanguage;
  const grants = await listBetaGrants();

  return (
    <div>
      <h1>{t(lang, 'admin_beta_title')}</h1>
      <p className="mono page-desc">{t(lang, 'admin_beta_desc')}</p>
      <BetaManager grants={grants} lang={lang} />
    </div>
  );
}

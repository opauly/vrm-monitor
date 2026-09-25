import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { listAllSites, listCustomers } from '@/lib/server/db/admin';
import { t } from '@/lib/i18n/strings';
import { AdminSitesManager } from './AdminSitesManager';

export const metadata: Metadata = {
  title: 'Sites — Admin',
};

// `/admin/sites` (PLAN_PHASE14.md §2 Step 7) — cross-customer sites table,
// mirroring `pages/06_vrm_monitor.py:tab_sites()`'s own "Clientes y
// sitios" view, plus a customer-reassignment control that view never
// needed (the Streamlit tool only ever wrote sites through
// `ingest.upsert_site()`, never moved one between customers).
export default async function AdminSitesPage() {
  const session = await requireAdmin();
  const lang = session.uiLanguage;
  const [sites, customers] = await Promise.all([listAllSites(), listCustomers()]);

  return (
    <div>
      <h1>{t(lang, 'admin_sites_title')}</h1>
      <p className="mono page-desc">
        {t(lang, 'admin_sites_desc_1')} <code>vrm</code> {t(lang, 'admin_sites_desc_2')}
      </p>
      <AdminSitesManager sites={sites} customers={customers} lang={lang} />
    </div>
  );
}

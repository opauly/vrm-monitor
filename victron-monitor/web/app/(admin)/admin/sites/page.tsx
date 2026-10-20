import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { listAllSites, listCustomers } from '@/lib/server/db/admin';
import { listAllProperties } from '@/lib/server/db';
import { PropertiesManager } from '@/components/app';
import { t } from '@/lib/i18n/strings';
import { AdminSitesManager } from './AdminSitesManager';
import {
  applyPropertyGroupsAction, assignSitePropertyAction, createPropertyAction, deletePropertyAction, renamePropertyAction, suggestPropertyGroupsAction,
} from './propertyActions';

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
  const [sites, customers, properties] = await Promise.all([listAllSites(), listCustomers(), listAllProperties().catch(() => [])]);
  // One block per customer with two or more active sites: properties group a customer's own sites.
  const groups = customers
    .map((c) => ({
      customerId: c.id,
      customerName: c.name,
      properties: properties.filter((p) => p.customer_id === c.id).map((p) => ({ id: p.id, name: p.name })),
      sites: sites.filter((s) => s.customer_id === c.id && s.active).map((s) => ({ site_id: s.site_id, display_name: s.display_name, property_id: s.property_id ?? null })),
    }))
    .filter((g) => g.sites.length >= 2);

  return (
    <div>
      <h1>{t(lang, 'admin_sites_title')}</h1>
      <p className="mono page-desc">
        {t(lang, 'admin_sites_desc_1')} <code>vrm</code> {t(lang, 'admin_sites_desc_2')}
      </p>
      <AdminSitesManager sites={sites} customers={customers} lang={lang} />
      <PropertiesManager
        lang={lang}
        groups={groups}
        actions={{
          create: createPropertyAction, rename: renamePropertyAction, remove: deletePropertyAction,
          assign: assignSitePropertyAction, suggest: suggestPropertyGroupsAction, apply: applyPropertyGroupsAction,
        }}
      />
    </div>
  );
}

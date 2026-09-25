import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { listCustomers } from '@/lib/server/db/admin';
import { t } from '@/lib/i18n/strings';
import { CustomersManager } from './CustomersManager';

export const metadata: Metadata = {
  title: 'Customers — Admin',
};

// `/admin/customers` (PLAN_PHASE14.md §2 Step 7) — the admin dashboard's
// landing page. Cross-customer by design: `listCustomers()` is
// `lib/server/db/admin.ts`'s own unscoped read, only importable from
// `/admin/*` (that file's own header comment). `requireAdmin()` first, per
// §3, even though `AdminLayout` already called it.
export default async function AdminCustomersPage() {
  const session = await requireAdmin();
  const lang = session.uiLanguage;
  const customers = await listCustomers();

  return (
    <div>
      <h1>{t(lang, 'admin_customers_title')}</h1>
      <p className="mono page-desc">
        {t(lang, 'admin_customers_desc_1')} <code>clients</code> {t(lang, 'admin_customers_desc_2')} <code>monitoring</code>{' '}
        {t(lang, 'admin_customers_desc_3')}
      </p>
      <CustomersManager customers={customers} lang={lang} />
    </div>
  );
}

import type { Metadata } from 'next';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { canAddSite, getCustomer, getReportModulesAccess, getVrmLinkStatus, listSites } from '@/lib/server/db';
import { t } from '@/lib/i18n/strings';
import { PendingSubscriptionUpsell, VrmConnectionBanner } from '@/components/app';
import { SitesManager } from './SitesManager';
import { VrmLinkPanel } from './VrmLinkPanel';
import styles from './sites.module.css';

export const metadata: Metadata = {
  title: 'My Sites',
};

// `app/(portal)/app/sites` (PLAN_PHASE14.md §2 Step 4; PLAN_PHASE15.md §3.1
// / §8 Step 5) — Server Component: fetches this customer's own sites, the
// add-site gate, and now the Victron VRM connection state, then hands all
// of it to the client-side `SitesManager`/`VrmLinkPanel` for the
// interactive table/forms. `requireCustomerAllowPending()` first, per §3,
// even though the layout above already called it — "never inferred from
// layout nesting." See `app/(portal)/app/page.tsx`'s own comment for why
// this is `…AllowPending` now, not plain `requireCustomer()`.
export default async function SitesPage() {
  const session = await requireCustomerAllowPending();
  if (session.provisioningState !== 'active') {
    return (
      <div>
        <h1>{t(session.uiLanguage, 'sites_title')}</h1>
        <PendingSubscriptionUpsell lang={session.uiLanguage} />
      </div>
    );
  }

  // `listSites`/`canAddSite`/`getVrmLinkStatus` all take only
  // `session.customerId` — there is no `site_id` or `customer_id` anywhere
  // in this page that came from a query param or a form; every site (and
  // every fact about the VRM connection) this page can possibly show is
  // already scoped before it reaches the client.
  const [sites, canAdd, customer, vrmStatus] = await Promise.all([
    listSites(session.customerId),
    canAddSite(session.customerId),
    getCustomer(session.customerId),
    getVrmLinkStatus(session.customerId),
  ]);
  // PLAN_PHASE18.md §5 — resolved once, here, same "Server Component
  // decides, client just renders what it's told" shape `canAdd`/`siteLimit`
  // already use. `SiteForm.tsx` never calls this itself (it's a Client
  // Component; the function is server-only regardless).
  const moduleSelectionAllowed = await getReportModulesAccess(customer);

  return (
    <div>
      <h1>{t(session.uiLanguage, 'sites_title')}</h1>
      <p className={styles.intro}>{t(session.uiLanguage, 'sites_intro')}</p>
      <VrmConnectionBanner status={vrmStatus} lang={session.uiLanguage} />
      <VrmLinkPanel status={vrmStatus} sites={sites} lang={session.uiLanguage} canAdd={canAdd} siteLimit={customer.site_limit} />
      <SitesManager
        sites={sites}
        lang={session.uiLanguage}
        canAdd={canAdd}
        siteLimit={customer.site_limit}
        moduleSelectionAllowed={moduleSelectionAllowed}
      />
    </div>
  );
}

import type { Metadata } from 'next';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { getBillingStatus, getVrmLinkStatus, listReportRuns, listSites } from '@/lib/server/db';
import { t } from '@/lib/i18n/strings';
import { BillingBanners, PendingSubscriptionUpsell, VrmConnectionBanner } from '@/components/app';
import { ReportHistory } from './ReportHistory';
import { ReportManager } from './ReportManager';

export const metadata: Metadata = {
  title: 'Reports',
};

// `app/(portal)/app` (Reports — the dashboard's actual landing page,
// PLAN_PHASE14.md §2 Step 6) — replaces Step 3's placeholder. Server
// Component: fetches this customer's own sites (never more), hands them to
// the client-side `ReportManager` for the range picker / job polling /
// summary rendering. `requireCustomerAllowPending()` first, per §3, even
// though the layout above already called it — "never inferred from layout
// nesting."
//
// `…AllowPending`, not plain `requireCustomer()` (2026-09-21, Oscar's own
// report) — this used to hard-redirect a `pending_subscription` customer
// straight to `/app/billing`, which is exactly right as a CONTROL but read
// as a bug as UX: clicking "Reports" (this is the landing page every nav
// tab except Billing/Profile/Help used to bounce from) produced a blank
// flash mid-navigation with zero explanation before landing on Billing.
// `PendingSubscriptionUpsell` below is the same access decision rendered
// IN PLACE instead — see that component's own header comment.
export default async function ReportsPage() {
  const session = await requireCustomerAllowPending();
  if (session.provisioningState !== 'active') {
    return (
      <div>
        <h1>{t(session.uiLanguage, 'reports_title')}</h1>
        <PendingSubscriptionUpsell lang={session.uiLanguage} />
      </div>
    );
  }
  // `getVrmLinkStatus()` alongside `listSites()` — the same connection-state
  // read `/app/sites` already makes, added here so a broken VRM connection
  // (PLAN_PHASE15.md §8 Step 6 / §9) is visible from the moment a customer
  // lands on the dashboard, not only if they happen to visit "My Sites".
  // `getBillingStatus()` alongside them (PLAN_PHASE16.md §7/§8 Step 6) — a
  // `past_due`/over-limit banner is visible from the same landing page, not
  // only on `/app/billing`. The `provisioningState !== 'active'` guard
  // above (not `requireCustomer()`'s own redirect anymore) is what still
  // guarantees every read below this point is for an already-`active`
  // customer — a pending signup never reaches here.
  const [sites, vrmStatus, billingStatus, reportRuns] = await Promise.all([
    listSites(session.customerId),
    getVrmLinkStatus(session.customerId),
    getBillingStatus(session.customerId),
    listReportRuns(session.customerId),
  ]);

  return (
    <div>
      <h1>{t(session.uiLanguage, 'reports_title')}</h1>
      <p>{t(session.uiLanguage, 'reports_intro')}</p>
      <VrmConnectionBanner status={vrmStatus} lang={session.uiLanguage} />
      <BillingBanners status={billingStatus} lang={session.uiLanguage} />
      <ReportManager sites={sites} lang={session.uiLanguage} />
      <ReportHistory runs={reportRuns} sites={sites} lang={session.uiLanguage} />
    </div>
  );
}

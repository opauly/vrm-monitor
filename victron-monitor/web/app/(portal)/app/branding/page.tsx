import type { Metadata } from 'next';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { getBranding, getBrandingAccess, getCustomer } from '@/lib/server/db';
import { createBrandingLogoUrl } from '@/lib/server/storage';
import { t } from '@/lib/i18n/strings';
import { Panel, Button } from '@/components/ui';
import { PendingSubscriptionUpsell } from '@/components/app';
import { BrandingForm } from './BrandingForm';
import styles from './branding.module.css';

export const metadata: Metadata = {
  title: 'Branding',
};

// `app/(portal)/app/branding` (PLAN_PHASE17.md §4.5, §8 Step 5) — its own
// page rather than a section of `/app/profile`: a logo uploader plus a
// colour picker plus a live preview isn't a compact form, and
// `/app/profile`'s own pattern is "compact status card + link", which is
// exactly what THAT page gets for this feature instead (a one-line
// branding status card pointing here, matching how it already handles VRM
// connection and billing).
//
// `…AllowPending`, not plain `requireCustomer()` (2026-09-21, corrected —
// see `app/(portal)/app/page.tsx`'s own comment for the full "why"). A
// `pending_subscription` customer still has no plan/entitlement for
// branding to be gated ON — that part of this comment's original reasoning
// stands — but "nothing here for them" used to mean a silent redirect
// instead of the explicit `PendingSubscriptionUpsell` branch below.
export default async function BrandingPage() {
  const session = await requireCustomerAllowPending();
  const lang = session.uiLanguage;
  if (session.provisioningState !== 'active') {
    return (
      <div>
        <h1>{t(lang, 'branding_title')}</h1>
        <PendingSubscriptionUpsell lang={lang} />
      </div>
    );
  }
  const customer = await getCustomer(session.customerId);
  const allowed = await getBrandingAccess(customer);

  if (!allowed) {
    // An `owner` account has no third party for a report to be "branded"
    // at — telling them to upgrade would be a real dead end (PLAN_PHASE17.md
    // §4.2 rule 0, added 2026-08-21 from live testing), so this gets its
    // own copy and no "upgrade" CTA, distinct from the tier/entitlement
    // upsell an `installer` on Starter sees below.
    if (customer.account_type !== 'installer') {
      return (
        <div>
          <h1>{t(lang, 'branding_title')}</h1>
          <Panel className={styles.upsell}>
            <h2>{t(lang, 'branding_owner_unavailable_title')}</h2>
            <p>{t(lang, 'branding_owner_unavailable_body')}</p>
          </Panel>
        </div>
      );
    }
    return (
      <div>
        <h1>{t(lang, 'branding_title')}</h1>
        <Panel className={styles.upsell}>
          <h2>{t(lang, 'branding_upsell_title')}</h2>
          <p>{t(lang, 'branding_upsell_body')}</p>
          <Button href="/app/billing">{t(lang, 'branding_upsell_cta')}</Button>
        </Panel>
      </div>
    );
  }

  const branding = await getBranding(session.customerId);
  const existingLogoUrl = branding.logo_storage_path ? await createBrandingLogoUrl(branding.logo_storage_path) : null;

  return (
    <div>
      <h1>{t(lang, 'branding_title')}</h1>
      <p className={styles.intro}>{t(lang, 'branding_intro')}</p>
      <BrandingForm branding={branding} existingLogoUrl={existingLogoUrl} lang={lang} />
    </div>
  );
}

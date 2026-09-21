import { Panel, Button } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './PendingSubscriptionUpsell.module.css';

// The in-place body for a `pending_subscription` customer landing on
// Reports/Upload/My Sites/Dashboard/Branding (2026-09-21, Oscar's own
// report) — those pages used to call plain `requireCustomer()`, which
// server-side `redirect()`s straight to `/app/billing` with no explanation.
// Clicking any nav tab other than Billing/Profile/Help then looked like a
// bug: a blank flash mid-navigation, landing on Billing with no context for
// why. Each of those pages now calls `requireCustomerAllowPending()`
// instead and renders THIS in place of its real content when
// `provisioningState !== 'active'` — same "navigation-level gating is UX,
// never the control" rule `AppShellProps`' own comment already states
// (`requireCustomerAllowPending()` still runs; this is what fills the page
// body instead of a redirect, not a replacement for the gate itself).
export function PendingSubscriptionUpsell({ lang }: { lang: Lang }) {
  return (
    <Panel variant="card" className={styles.upsell}>
      <h2>{t(lang, 'pending_subscription_title')}</h2>
      <p>{t(lang, 'pending_subscription_body')}</p>
      <Button href="/app/billing">{t(lang, 'pending_subscription_cta')}</Button>
    </Panel>
  );
}

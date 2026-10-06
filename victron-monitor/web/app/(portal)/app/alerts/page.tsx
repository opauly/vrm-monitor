import type { Metadata } from 'next';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { getCustomer, getDashboardAccess } from '@/lib/server/db';
import { Panel, Button } from '@/components/ui';
import { PendingSubscriptionUpsell } from '@/components/app';
import { t } from '@/lib/i18n/strings';
import { AlertsView } from './AlertsView';
import { saveAlertSettingsAction } from './actions';
import { sendTestPushAction, subscribePushAction, unsubscribePushAction } from './pushActions';
import dashboardStyles from '../dashboard/dashboard.module.css';

export const metadata: Metadata = { title: 'Alerts' };

// `/app/alerts` — what needs attention right now, what was resolved lately,
// and which alerts this customer wants (vrm.alert_preferences). Alerts are
// part of the live-monitoring tier, so this page uses the exact gate
// `/app/dashboard` does: `getDashboardAccess()` (plan allows it AND the
// account is entitled), otherwise an upsell. The body is `AlertsView`, shared
// with the admin's `/admin/fleet/alerts`.
export default async function AlertsPage() {
  const session = await requireCustomerAllowPending();
  const lang = session.uiLanguage;

  if (session.provisioningState !== 'active') {
    return (
      <div>
        <h1>{t(lang, 'alerts_title')}</h1>
        <PendingSubscriptionUpsell lang={lang} />
      </div>
    );
  }

  const customer = await getCustomer(session.customerId);
  if (!(await getDashboardAccess(customer))) {
    return (
      <div>
        <h1>{t(lang, 'alerts_title')}</h1>
        <Panel className={dashboardStyles.upsell}>
          <h2>{t(lang, 'alerts_upsell_title')}</h2>
          <p>{t(lang, 'alerts_upsell_body')}</p>
          <Button href="/app/billing">{t(lang, 'alerts_upsell_cta')}</Button>
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <h1>{t(lang, 'alerts_title')}</h1>
      <AlertsView
        lang={lang}
        customerId={session.customerId}
        email={customer.contact_email || customer.auth_email || session.email}
        links={{ site: (id) => `/app/dashboard/${encodeURIComponent(id)}`, vrmLink: '/app/sites' }}
        saveAction={saveAlertSettingsAction}
        onSubscribe={subscribePushAction}
        onUnsubscribe={unsubscribePushAction}
        onTest={sendTestPushAction}
      />
    </div>
  );
}

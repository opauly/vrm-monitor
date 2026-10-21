import type { Metadata } from 'next';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { getCustomer, getDashboardAccess, listOwnerDevices, listProperties, listPropertyRecipients } from '@/lib/server/db';
import { Panel, Button } from '@/components/ui';
import { PendingSubscriptionUpsell, PropertyRouting } from '@/components/app';
import { t, type Lang } from '@/lib/i18n/strings';
import { AlertsTabs, AlertsView, parseAlertsTab } from './AlertsView';
import { saveAlertSettingsAction } from './actions';
import { sendTestPushAction, subscribePushAction, unsubscribePushAction } from './pushActions';
import { addRecipientAction, removeRecipientAction, setDeviceScopeAction } from './routingActions';
import dashboardStyles from '../dashboard/dashboard.module.css';

export const metadata: Metadata = { title: 'Alerts' };

// `/app/alerts` — what needs attention right now, what was resolved lately,
// and which alerts this customer wants (vrm.alert_preferences). Alerts are
// part of the live-monitoring tier, so this page uses the exact gate
// `/app/dashboard` does: `getDashboardAccess()` (plan allows it AND the
// account is entitled), otherwise an upsell. The body is `AlertsView`, shared
// with the admin's `/admin/fleet/alerts`.
async function buildRouting(customerId: string, lang: Lang) {
  const [properties, recipients, devices] = await Promise.all([listProperties(customerId), listPropertyRecipients(customerId), listOwnerDevices({ customerId })]);
  if (properties.length === 0) return null;
  return (
    <PropertyRouting
      lang={lang}
      properties={properties.map((p) => ({ id: p.id, name: p.name }))}
      recipients={recipients}
      devices={devices}
      actions={{ addRecipient: addRecipientAction, removeRecipient: removeRecipientAction, setDeviceScope: setDeviceScopeAction }}
    />
  );
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireCustomerAllowPending();
  const tab = parseAlertsTab((await searchParams).tab);
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

  // "Who gets what, by property" (only on the Notifications tab, and only for a customer that has properties).
  const routing = tab === 'notifications' ? await buildRouting(session.customerId, lang) : null;

  return (
    <div>
      <h1>{t(lang, 'alerts_title')}</h1>
      <AlertsTabs lang={lang} basePath="/app/alerts" tab={tab} />
      <AlertsView
        lang={lang}
        tab={tab}
        routing={routing}
        customerId={session.customerId}
        email={customer.contact_email || customer.auth_email || session.email}
        links={{ site: (id) => `/app/dashboard/${encodeURIComponent(id)}`, vrmLink: '/app/sites', property: (id) => `/app/dashboard?property=${encodeURIComponent(id)}` }}
        saveAction={saveAlertSettingsAction}
        onSubscribe={subscribePushAction}
        onUnsubscribe={unsubscribePushAction}
        onTest={sendTestPushAction}
      />
    </div>
  );
}

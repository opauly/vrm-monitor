import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/server/auth';
import { fleetAlertCustomerId } from '@/lib/server/fleetAlertCustomer';
import { getCustomer, listOwnerDevices, listProperties, listPropertyRecipients } from '@/lib/server/db';
import { PropertyRouting } from '@/components/app';
import { addRecipientAction, removeRecipientAction, setDeviceScopeAction } from './routingActions';
import { Panel } from '@/components/ui';
import { t } from '@/lib/i18n/strings';
import { AdminHealthSection } from './AdminHealthSection';
import { AlertsTabs, AlertsView, parseAlertsTab } from '@/app/(portal)/app/alerts/AlertsView';
import { sendAdminTestPushAction, subscribeAdminPushAction, unsubscribeAdminPushAction } from '../pushActions';
import { saveFleetAlertSettingsAction } from './actions';
import styles from '../[site_id]/site.module.css';
import alertStyles from '@/app/(portal)/app/alerts/alerts.module.css';

export const metadata: Metadata = { title: 'Fleet alerts' };

// `/admin/fleet/alerts` — the customer's alerts page, for the admin's own
// fleet: the internal account named by ALERTS_FORCE_CUSTOMER_IDS. Same view,
// same settings and phone panel (the device registered is the admin's own);
// only the account, the links and the save action differ.
export default async function AdminFleetAlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireAdmin();
  const tab = parseAlertsTab((await searchParams).tab);
  const lang = admin.uiLanguage;
  const customerId = fleetAlertCustomerId();

  const customer = customerId ? await getCustomer(customerId).catch(() => null) : null;

  // "Who gets what, by property": the fleet account's properties, with the admin's own phones.
  let routing = null;
  if (tab === 'notifications' && customerId && customer) {
    const [properties, recipients, devices] = await Promise.all([listProperties(customerId), listPropertyRecipients(customerId), listOwnerDevices({ adminEmail: admin.email })]);
    if (properties.length > 0) {
      routing = (
        <PropertyRouting
          lang={lang}
          properties={properties.map((p) => ({ id: p.id, name: p.name }))}
          recipients={recipients}
          devices={devices}
          actions={{ addRecipient: addRecipientAction, removeRecipient: removeRecipientAction, setDeviceScope: setDeviceScopeAction }}
        />
      );
    }
  }

  return (
    <div>
      <div className={styles.crumb}>
        <Link href="/admin/fleet">{t(lang, 'admin_fleet_title')}</Link> / <span>{t(lang, 'admin_fleet_alerts_title')}</span>
      </div>
      <h1>{t(lang, 'admin_fleet_alerts_title')}</h1>
      <AlertsTabs lang={lang} basePath="/admin/fleet/alerts" tab={tab} />
      {tab === 'log' && <AdminHealthSection lang={lang} />}
      {tab === 'log' && <h2 className={alertStyles.sectionLabel}>{t(lang, 'admin_alerts_sites_title')}</h2>}
      {!customerId || !customer ? (
        <Panel>
          <p>{t(lang, 'admin_fleet_alerts_not_configured')}</p>
        </Panel>
      ) : (
        <AlertsView
          lang={lang}
          tab={tab}
          routing={routing}
          customerId={customerId}
          email={customer.contact_email || customer.auth_email || admin.email}
          intro={t(lang, 'admin_fleet_alerts_intro').replace('{name}', customer.name ?? '')}
          pushIntro={t(lang, 'push_intro_admin')}
          links={{ site: (id) => `/admin/fleet/${encodeURIComponent(id)}`, vrmLink: '/admin/vrm-fleet' }}
          saveAction={saveFleetAlertSettingsAction}
          onSubscribe={subscribeAdminPushAction}
          onUnsubscribe={unsubscribeAdminPushAction}
          onTest={sendAdminTestPushAction}
        />
      )}
    </div>
  );
}

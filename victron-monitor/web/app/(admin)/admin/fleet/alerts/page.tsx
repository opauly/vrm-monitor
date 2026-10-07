import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/server/auth';
import { fleetAlertCustomerId } from '@/lib/server/fleetAlertCustomer';
import { getCustomer } from '@/lib/server/db';
import { Panel } from '@/components/ui';
import { t } from '@/lib/i18n/strings';
import { AdminHealthSection } from './AdminHealthSection';
import { AlertsView } from '@/app/(portal)/app/alerts/AlertsView';
import { sendAdminTestPushAction, subscribeAdminPushAction, unsubscribeAdminPushAction } from '../pushActions';
import { saveFleetAlertSettingsAction } from './actions';
import styles from '../[site_id]/site.module.css';
import alertStyles from '@/app/(portal)/app/alerts/alerts.module.css';

export const metadata: Metadata = { title: 'Fleet alerts' };

// `/admin/fleet/alerts` — the customer's alerts page, for the admin's own
// fleet: the internal account named by ALERTS_FORCE_CUSTOMER_IDS. Same view,
// same settings and phone panel (the device registered is the admin's own);
// only the account, the links and the save action differ.
export default async function AdminFleetAlertsPage() {
  const admin = await requireAdmin();
  const lang = admin.uiLanguage;
  const customerId = fleetAlertCustomerId();

  const customer = customerId ? await getCustomer(customerId).catch(() => null) : null;

  return (
    <div>
      <div className={styles.crumb}>
        <Link href="/admin/fleet">{t(lang, 'admin_fleet_title')}</Link> / <span>{t(lang, 'admin_fleet_alerts_title')}</span>
      </div>
      <h1>{t(lang, 'admin_fleet_alerts_title')}</h1>
      <AdminHealthSection lang={lang} />
      <h2 className={alertStyles.sectionLabel}>{t(lang, 'admin_alerts_sites_title')}</h2>
      {!customerId || !customer ? (
        <Panel>
          <p>{t(lang, 'admin_fleet_alerts_not_configured')}</p>
        </Panel>
      ) : (
        <AlertsView
          lang={lang}
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

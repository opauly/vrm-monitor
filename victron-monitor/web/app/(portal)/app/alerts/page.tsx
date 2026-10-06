import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import {
  ALERT_KINDS,
  getAlertPreferences,
  getCustomer,
  getDashboardAccess,
  listOpenAlerts,
  listRecentResolvedAlerts,
  type AlertWithSite,
} from '@/lib/server/db';
import { Panel, Button } from '@/components/ui';
import { PendingSubscriptionUpsell } from '@/components/app';
import { formatDateTimeInZone } from '@/lib/dates';
import { describeAlert } from '@/lib/alertText';
import { t, type Lang } from '@/lib/i18n/strings';
import { AlertSettingsForm } from './AlertSettingsForm';
import dashboardStyles from '../dashboard/dashboard.module.css';
import styles from './alerts.module.css';

export const metadata: Metadata = { title: 'Alerts' };

// `/app/alerts` — what needs attention right now, what was resolved lately,
// and which alerts this customer wants (vrm.alert_preferences). Alerts are
// part of the live-monitoring tier, so this page uses the exact gate
// `/app/dashboard` does: `getDashboardAccess()` (plan allows it AND the
// account is entitled), otherwise an upsell.
function AlertCard({ alert, lang, resolved }: { alert: AlertWithSite; lang: Lang; resolved: boolean }) {
  const { title, body } = describeAlert(lang, alert);
  const stamp = resolved ? alert.resolved_at : alert.opened_at;
  const when = stamp ? formatDateTimeInZone(stamp, alert.site_timezone, 'en-US') : '—';
  const href = alert.kind === 'vrm_link_broken' ? '/app/sites' : alert.site_id ? `/app/dashboard/${encodeURIComponent(alert.site_id)}` : null;
  const tone = resolved ? styles.cardResolved : alert.severity === 'critical' ? styles.cardCritical : styles.cardWarning;

  return (
    <article className={`${styles.card} ${tone}`}>
      {!resolved && (
        <div className={styles.severity}>{t(lang, alert.severity === 'critical' ? 'alerts_severity_critical' : 'alerts_severity_warning')}</div>
      )}
      <h3 className={styles.cardTitle}>{title}</h3>
      {!resolved && <p className={styles.cardBody}>{body}</p>}
      <div className={styles.meta}>
        <span>{t(lang, resolved ? 'alerts_resolved_at' : 'alerts_since').replace('{time}', when)}</span>
        {href && (
          <Link href={href} className={styles.cardLink}>
            {t(lang, alert.kind === 'vrm_link_broken' ? 'alerts_reconnect' : 'alerts_view_site')} →
          </Link>
        )}
      </div>
    </article>
  );
}

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

  const [open, recent, prefs] = await Promise.all([
    listOpenAlerts(session.customerId),
    listRecentResolvedAlerts(session.customerId),
    getAlertPreferences(session.customerId),
  ]);

  return (
    <div>
      <h1>{t(lang, 'alerts_title')}</h1>
      <p className={styles.intro}>{t(lang, 'alerts_intro')}</p>

      <h2 className={styles.sectionLabel}>{t(lang, 'alerts_active_title')}</h2>
      {open.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'alerts_active_empty')}</p>
      ) : (
        <div className={styles.cards}>
          {open.map((a) => (
            <AlertCard key={a.id} alert={a} lang={lang} resolved={false} />
          ))}
        </div>
      )}

      <h2 className={styles.sectionLabel}>{t(lang, 'alerts_recent_title')}</h2>
      {recent.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'alerts_recent_empty')}</p>
      ) : (
        <div className={styles.cards}>
          {recent.map((a) => (
            <AlertCard key={a.id} alert={a} lang={lang} resolved />
          ))}
        </div>
      )}

      <h2 className={styles.sectionLabel}>{t(lang, 'alerts_settings_title')}</h2>
      <Panel>
        <p className={styles.settingsIntro}>{t(lang, 'alerts_settings_intro')}</p>
        <AlertSettingsForm lang={lang} kinds={ALERT_KINDS} initial={prefs} email={customer.contact_email || customer.auth_email || session.email} />
      </Panel>
    </div>
  );
}

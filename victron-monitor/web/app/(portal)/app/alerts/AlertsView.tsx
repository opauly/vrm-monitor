import Link from 'next/link';
import {
  ALERT_KINDS,
  getAlertPreferences,
  listOpenAlerts,
  listRecentResolvedAlerts,
  type AlertWithSite,
} from '@/lib/server/db';
import { Panel } from '@/components/ui';
import { PushPanel } from '@/components/app';
import { formatDateTimeInZone } from '@/lib/dates';
import { describeAlert } from '@/lib/alertText';
import { t, type Lang } from '@/lib/i18n/strings';
import type { PushActionResult, PushSubscriptionInput, PushTestResult } from '@/lib/push';
import { AlertSettingsForm } from './AlertSettingsForm';
import type { AlertSettingsState } from './actions';
import styles from './alerts.module.css';

// The body of the alerts page — open alerts, recent ones, the phone panel and
// the settings — shared by `/app/alerts` (a customer's own) and
// `/admin/fleet/alerts` (the admin's internal fleet). Callers decide WHOSE
// alerts these are (`customerId`, always from a session or server config),
// where a card's link goes, and which server actions save and subscribe.

export type AlertLinks = {
  /** Where "View site" goes for a given site id. */
  site: (siteId: string) => string;
  /** Where "Reconnect" goes for a broken VRM link. */
  vrmLink: string;
};

export type AlertsViewProps = {
  lang: Lang;
  customerId: string;
  /** Shown under the settings: where emailed alerts go. */
  email: string;
  links: AlertLinks;
  intro?: string;
  pushIntro?: string;
  saveAction: (prev: AlertSettingsState, formData: FormData) => Promise<AlertSettingsState>;
  onSubscribe: (subscription: PushSubscriptionInput) => Promise<PushActionResult>;
  onUnsubscribe: (endpoint: string) => Promise<PushActionResult>;
  onTest: () => Promise<PushTestResult>;
};

function AlertCard({ alert, lang, resolved, links }: { alert: AlertWithSite; lang: Lang; resolved: boolean; links: AlertLinks }) {
  const { title, body } = describeAlert(lang, alert);
  const stamp = resolved ? alert.resolved_at : alert.opened_at;
  const when = stamp ? formatDateTimeInZone(stamp, alert.site_timezone, 'en-US') : '—';
  const href = alert.kind === 'vrm_link_broken' ? links.vrmLink : alert.site_id ? links.site(alert.site_id) : null;
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

export async function AlertsView({ lang, customerId, email, links, intro, pushIntro, saveAction, onSubscribe, onUnsubscribe, onTest }: AlertsViewProps) {
  const [open, recent, prefs] = await Promise.all([
    listOpenAlerts(customerId),
    listRecentResolvedAlerts(customerId),
    getAlertPreferences(customerId),
  ]);

  return (
    <div>
      <p className={styles.intro}>{intro ?? t(lang, 'alerts_intro')}</p>

      <h2 className={styles.sectionLabel}>{t(lang, 'alerts_active_title')}</h2>
      {open.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'alerts_active_empty')}</p>
      ) : (
        <div className={styles.cards}>
          {open.map((a) => (
            <AlertCard key={a.id} alert={a} lang={lang} resolved={false} links={links} />
          ))}
        </div>
      )}

      <h2 className={styles.sectionLabel}>{t(lang, 'alerts_recent_title')}</h2>
      {recent.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'alerts_recent_empty')}</p>
      ) : (
        <div className={styles.cards}>
          {recent.map((a) => (
            <AlertCard key={a.id} alert={a} lang={lang} resolved links={links} />
          ))}
        </div>
      )}

      <PushPanel
        lang={lang}
        vapidPublicKey={process.env.VAPID_PUBLIC_KEY?.trim() || null}
        intro={pushIntro}
        onSubscribe={onSubscribe}
        onUnsubscribe={onUnsubscribe}
        onTest={onTest}
      />

      <h2 className={styles.sectionLabel}>{t(lang, 'alerts_settings_title')}</h2>
      <Panel>
        <p className={styles.settingsIntro}>{t(lang, 'alerts_settings_intro')}</p>
        <AlertSettingsForm lang={lang} kinds={ALERT_KINDS} initial={prefs} email={email} action={saveAction} />
      </Panel>
    </div>
  );
}

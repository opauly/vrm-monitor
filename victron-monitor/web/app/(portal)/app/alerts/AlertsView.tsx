import Link from 'next/link';
import {
  ALERT_KINDS,
  INSIGHT_KINDS,
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

/** The page has two tabs: what has happened (the log) and how you hear about it (phone and email settings). */
export type AlertsTab = 'log' | 'notifications';

export function parseAlertsTab(value: string | undefined): AlertsTab {
  return value === 'notifications' ? 'notifications' : 'log';
}

// Plain links (`?tab=notifications`), so a tab can be bookmarked and shared and no client state is needed.
export function AlertsTabs({ lang, basePath, tab }: { lang: Lang; basePath: string; tab: AlertsTab }) {
  const items: { id: AlertsTab; href: string; label: string }[] = [
    { id: 'log', href: basePath, label: t(lang, 'alerts_tab_log') },
    { id: 'notifications', href: `${basePath}?tab=notifications`, label: t(lang, 'alerts_tab_notifications') },
  ];
  return (
    <nav className={styles.tabs} aria-label={t(lang, 'alerts_title')}>
      {items.map((item) => (
        <Link key={item.id} href={item.href} className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`} aria-current={tab === item.id ? 'page' : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export type AlertsViewProps = {
  lang: Lang;
  /** Which tab to show (`parseAlertsTab` of `?tab=`). */
  tab: AlertsTab;
  /** "Who gets what, by property" (recipients and phone scope), built by the page that knows whose it is; shown on the Notifications tab. */
  routing?: React.ReactNode;
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

type ResolvedGroup = { key: string; alert: AlertWithSite; items: AlertWithSite[] };

// The same problem resolving again and again (an equipment fault that comes back every morning) is one line with a count, not a card
// each time; the individual resolutions open from it. Newest first, as the list already is.
function groupResolved(alerts: AlertWithSite[]): ResolvedGroup[] {
  const groups = new Map<string, ResolvedGroup>();
  for (const a of alerts) {
    const key = `${a.kind}:${a.site_id ?? ''}`;
    const group = groups.get(key);
    if (group) group.items.push(a);
    else groups.set(key, { key, alert: a, items: [a] });
  }
  return [...groups.values()];
}

function stampOf(a: AlertWithSite): string {
  return a.resolved_at ? formatDateTimeInZone(a.resolved_at, a.site_timezone, 'en-US') : '—';
}

function ResolvedRow({ group, lang, links }: { group: ResolvedGroup; lang: Lang; links: AlertLinks }) {
  const { title } = describeAlert(lang, group.alert);
  const href = group.alert.kind === 'vrm_link_broken' ? links.vrmLink : group.alert.site_id ? links.site(group.alert.site_id) : null;
  const many = group.items.length > 1;
  const summary = (
    <>
      <span className={styles.resolvedTitle}>{title}</span>
      <span className={styles.resolvedMeta}>
        {many
          ? `${t(lang, 'alerts_resolved_times').replace('{n}', String(group.items.length))} · ${t(lang, 'alerts_resolved_last').replace('{time}', stampOf(group.items[0]))}`
          : t(lang, 'alerts_resolved_at').replace('{time}', stampOf(group.items[0]))}
      </span>
    </>
  );
  const link = href && (
    <Link href={href} className={styles.cardLink}>
      {t(lang, group.alert.kind === 'vrm_link_broken' ? 'alerts_reconnect' : 'alerts_view_site')} →
    </Link>
  );
  if (!many) {
    return (
      <div className={styles.resolvedRow}>
        <div className={styles.resolvedSummary}>{summary}{link}</div>
      </div>
    );
  }
  return (
    <details className={styles.resolvedRow}>
      <summary className={styles.resolvedSummary}>{summary}{link}</summary>
      <ul className={styles.resolvedDates}>
        {group.items.map((a) => (
          <li key={a.id}>{t(lang, 'alerts_resolved_at').replace('{time}', stampOf(a))}</li>
        ))}
      </ul>
    </details>
  );
}

export async function AlertsView({ lang, tab, routing, customerId, email, links, intro, pushIntro, saveAction, onSubscribe, onUnsubscribe, onTest }: AlertsViewProps) {
  if (tab === 'notifications') {
    const prefs = await getAlertPreferences(customerId);
    return (
      <div>
        <PushPanel
          lang={lang}
          vapidPublicKey={process.env.VAPID_PUBLIC_KEY?.trim() || null}
          intro={pushIntro}
          onSubscribe={onSubscribe}
          onUnsubscribe={onUnsubscribe}
          onTest={onTest}
        />

        <h2 id="settings" className={styles.sectionLabel}>{t(lang, 'alerts_settings_title')}</h2>
        <Panel>
          <p className={styles.settingsIntro}>{t(lang, 'alerts_settings_intro')}</p>
          <AlertSettingsForm
            lang={lang}
            groups={[
              { title: t(lang, 'alerts_group_alerts'), description: t(lang, 'alerts_group_alerts_desc'), kinds: ALERT_KINDS },
              { title: t(lang, 'alerts_group_insights'), description: t(lang, 'alerts_group_insights_desc'), kinds: INSIGHT_KINDS },
            ]}
            initial={prefs}
            email={email}
            action={saveAction}
          />
        </Panel>

        {routing}
      </div>
    );
  }

  const [open, recent] = await Promise.all([listOpenAlerts(customerId), listRecentResolvedAlerts(customerId)]);

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

      {recent.length === 0 ? (
        <>
          <h2 className={styles.sectionLabel}>{t(lang, 'alerts_recent_title')}</h2>
          <p className={styles.empty}>{t(lang, 'alerts_recent_empty')}</p>
        </>
      ) : (
        // Closed until asked for: what is open now is what matters; the history is one click away.
        <details className={styles.resolvedBlock}>
          <summary className={styles.resolvedHead}>
            <span className={styles.sectionLabelInline}>{t(lang, 'alerts_recent_title')}</span>
            <span className={styles.resolvedCount}>{t(lang, 'alerts_recent_count').replace('{n}', String(recent.length))}</span>
          </summary>
          <div className={styles.resolvedList}>
            {groupResolved(recent).map((g) => (
              <ResolvedRow key={g.key} group={g} lang={lang} links={links} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

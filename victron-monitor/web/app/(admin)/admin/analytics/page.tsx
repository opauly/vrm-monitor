import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { Panel } from '@/components/ui';
import { t } from '@/lib/i18n/strings';
import styles from './analytics.module.css';

export const metadata: Metadata = {
  title: 'Analytics — Admin',
};

// `/admin/analytics` (2026-09-19, Oscar's own request: "visits, from
// where, where they click, how many subscribe, how many unsubscribe...
// under admin panel"). Two independent layers, both PostHog:
//
//   1. Collection — already wired up regardless of whether this page has
//      anything to show yet: components/analytics/PostHogProvider.tsx
//      (pageviews + click autocapture, client-side) and
//      lib/server/analytics.ts's captureServerEvent() (the funnel events
//      listed below, server-side, at their real success points).
//   2. Display — this page. Rather than reimplementing chart rendering
//      against PostHog's own Query API (a real project on its own, and
//      one this app has no other need for), it embeds a PostHog
//      dashboard's public share link — same numbers, inside /admin
//      instead of a separate tab, with none of the query-building work.
//      `POSTHOG_DASHBOARD_URL` is unset until Oscar creates that
//      dashboard in PostHog and shares it — see the setup card below,
//      which is what renders instead until then.
export default async function AdminAnalyticsPage() {
  const session = await requireAdmin();
  const lang = session.uiLanguage;

  const dashboardUrl = process.env.POSTHOG_DASHBOARD_URL;
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
  const projectConfigured = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

  return (
    <div>
      <h1>{t(lang, 'admin_analytics_title')}</h1>
      <p className="mono page-desc">{t(lang, 'admin_analytics_desc')}</p>

      <div className={styles.eventList}>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>$pageview</span>
          <span className={styles.eventDesc}>{t(lang, 'admin_analytics_event_pageview_desc')}</span>
        </div>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>$autocapture</span>
          <span className={styles.eventDesc}>{t(lang, 'admin_analytics_event_autocapture_desc')}</span>
        </div>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>signup_request_submitted</span>
          <span className={styles.eventDesc}>{t(lang, 'admin_analytics_event_signup_desc')}</span>
        </div>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>trial_started</span>
          <span className={styles.eventDesc}>{t(lang, 'admin_analytics_event_trial_desc')}</span>
        </div>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>subscription_started</span>
          <span className={styles.eventDesc}>{t(lang, 'admin_analytics_event_sub_started_desc')}</span>
        </div>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>subscription_cancelled</span>
          <span className={styles.eventDesc}>{t(lang, 'admin_analytics_event_sub_cancelled_desc')}</span>
        </div>
      </div>

      {!projectConfigured ? (
        <Panel variant="card" className={styles.setupCard}>
          <h2>{t(lang, 'admin_analytics_not_connected_title')}</h2>
          <ol>
            <li>
              {t(lang, 'admin_analytics_step1_a')} <code>posthog.com</code> {t(lang, 'admin_analytics_step1_b')}
            </li>
            <li>
              {t(lang, 'admin_analytics_step2_a')} <code>Project API key</code> {t(lang, 'admin_analytics_step2_b')}{' '}
              <code>NEXT_PUBLIC_POSTHOG_KEY</code> {t(lang, 'admin_analytics_step2_c')} <b>{t(lang, 'admin_analytics_step2_two')}</b>{' '}
              {t(lang, 'admin_analytics_step2_d')} <code>victron-monitor/web/.env.local</code> {t(lang, 'admin_analytics_step2_e')}{' '}
              <code>subscription_started</code> {t(lang, 'admin_analytics_step2_f')}{' '}
              <code>NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com</code> {t(lang, 'admin_analytics_step2_g')}
            </li>
            <li>{t(lang, 'admin_analytics_step3')}</li>
            <li>{t(lang, 'admin_analytics_step4')}</li>
          </ol>
        </Panel>
      ) : !dashboardUrl ? (
        <Panel variant="card" className={styles.setupCard}>
          <h2>{t(lang, 'admin_analytics_collecting_title')}</h2>
          <p>
            {t(lang, 'admin_analytics_collecting_body_1')} <b>Share</b> {t(lang, 'admin_analytics_collecting_body_2')}{' '}
            <code>POSTHOG_DASHBOARD_URL</code> {t(lang, 'admin_analytics_collecting_body_3')}
          </p>
          <a className={styles.externalLink} href={posthogHost} target="_blank" rel="noopener noreferrer">
            {t(lang, 'admin_analytics_open_posthog')} &rarr;
          </a>
        </Panel>
      ) : (
        <div className={styles.frameWrap}>
          <iframe src={dashboardUrl} className={styles.frame} title="PostHog dashboard" />
        </div>
      )}
    </div>
  );
}

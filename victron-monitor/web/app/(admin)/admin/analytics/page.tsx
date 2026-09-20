import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/server/auth';
import { Panel } from '@/components/ui';
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
  await requireAdmin();

  const dashboardUrl = process.env.POSTHOG_DASHBOARD_URL;
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
  const projectConfigured = Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

  return (
    <div>
      <h1>Analytics</h1>
      <p className="mono page-desc">Visits, referrers, clicks, and the signup/trial/cancellation funnel — via PostHog.</p>

      <div className={styles.eventList}>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>$pageview</span>
          <span className={styles.eventDesc}>Every page view, with referrer and geography — automatic.</span>
        </div>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>$autocapture</span>
          <span className={styles.eventDesc}>Every click, on every page — automatic, no extra code per button/link.</span>
        </div>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>signup_request_submitted</span>
          <span className={styles.eventDesc}>The /signup form was submitted (lib/server/signup.ts).</span>
        </div>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>trial_started</span>
          <span className={styles.eventDesc}>The verification link was clicked and a real account was created.</span>
        </div>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>subscription_started</span>
          <span className={styles.eventDesc}>
            Promoted to a real paying subscription, captured from vrm_api&apos;s own billing reconciliation
            (Python) — the one funnel step this app can&apos;t see happen.
          </span>
        </div>
        <div className={styles.eventRow}>
          <span className={styles.eventName}>subscription_cancelled</span>
          <span className={styles.eventDesc}>A customer cancelled from /app/billing (app/api/billing/cancel).</span>
        </div>
      </div>

      {!projectConfigured ? (
        <Panel variant="card" className={styles.setupCard}>
          <h2>Not connected yet</h2>
          <ol>
            <li>
              Create a free project at <code>posthog.com</code> (US or EU region — either works, just note which).
            </li>
            <li>
              Copy its <code>Project API key</code> and add it as <code>NEXT_PUBLIC_POSTHOG_KEY</code> in{' '}
              <b>two</b> places: <code>victron-monitor/web/.env.local</code> (and Vercel&apos;s env vars, for
              production) for this app, and vrm_api&apos;s own environment (Render) for the{' '}
              <code>subscription_started</code> event below, which is captured from there, not from here. If you
              picked the EU region, also set <code>NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com</code> in both
              places.
            </li>
            <li>Redeploy both — collection (pageviews, clicks, and every event below) starts immediately.</li>
            <li>
              Come back here once you&apos;ve set up a dashboard in PostHog (next step below) to see it rendered
              inside this page instead of on posthog.com.
            </li>
          </ol>
        </Panel>
      ) : !dashboardUrl ? (
        <Panel variant="card" className={styles.setupCard}>
          <h2>Collecting data — no dashboard embedded yet</h2>
          <p>
            Tracking is live. To see it here instead of switching to posthog.com: in PostHog, build a dashboard with
            the insights you want (visits over time, top referrers/countries, top-clicked elements, and the three
            funnel events above), then use its <b>Share</b> button to create a public link, and set{' '}
            <code>POSTHOG_DASHBOARD_URL</code> to that link&apos;s URL.
          </p>
          <a className={styles.externalLink} href={posthogHost} target="_blank" rel="noopener noreferrer">
            Open PostHog &rarr;
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

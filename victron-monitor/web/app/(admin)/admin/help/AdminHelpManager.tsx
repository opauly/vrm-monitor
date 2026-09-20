'use client';

// Topic-card switcher for `/admin/help` — same pattern as the customer
// side's own `app/(portal)/app/help/HelpManager.tsx`, English-only inline
// literals throughout (no `lib/i18n/strings.ts` keys), matching every
// other `/admin/**` page's convention.
//
// Rebuilt 2026-09-19 (Oscar's own audit request) from three static
// Panels — all three about VRM Fleet, nothing else — into one topic per
// real admin nav item: Customers, Sites, Upload, Reports, Activity,
// Analytics, VRM Fleet. The original VRM Fleet content (linking a site,
// reading the table, removing one) is carried over near-verbatim into
// its own tab here, not rewritten — it was already accurate.
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Panel } from '@/components/ui';
import { DataSourceDiagram, ScoreLegend } from '@/components/app';
import styles from './help.module.css';

type Topic = {
  id: string;
  nav: string;
  title: string;
  lead: ReactNode;
  steps?: ReactNode[];
  bullets?: ReactNode[];
  diagram?: 'dataSource' | 'scoreLegend';
  links: { href: string; label: string }[];
};

const TOPICS: Topic[] = [
  {
    id: 'customers',
    nav: 'Customers',
    title: 'Managing customers',
    lead: 'The full roster of external VRM Monitor customers — separate from Pauly & Co’s own installations (see VRM Fleet for those).',
    steps: [
      <>
        Click <strong>New customer</strong> to create one — name, account type (Owner/Installer), dashboard
        language, plan, site limit (blank means unlimited), login email, country, and optional contact info.
        Submitting sends the first invite email automatically, in one step.
      </>,
      <>
        Click <strong>Edit</strong> on a row to change any of those fields — except the login email, which is
        fixed once set.
      </>,
      <>
        Click <strong>Billing</strong> on a row to act on that customer&apos;s real ONVO subscription directly:{' '}
        <strong>Refresh</strong> (reconcile against ONVO), <strong>Cancel at period end</strong>,{' '}
        <strong>Cancel immediately</strong>, or — only for a customer stuck pending signup —{' '}
        <strong>Promote to active</strong>. No card entry happens anywhere in this panel.
      </>,
    ],
    bullets: [
      <>
        <strong>Resend invite</strong> re-sends the portal activation email; <strong>Activate</strong>/
        <strong>Deactivate</strong> moves a customer between the active table and a separate deactivated one below
        it.
      </>,
      <>
        <strong>Disconnect VRM</strong> revokes a customer&apos;s VRM link without deleting anything already imported.
      </>,
      'Filter the list by Origin (Admin vs. Self-serve) and Provisioning state (Active vs. Pending signup).',
    ],
    links: [{ href: '/admin/customers', label: 'Customers' }],
  },
  {
    id: 'sites',
    nav: 'Sites',
    title: 'Managing sites across every customer',
    lead: 'Every site, for every customer, in one table — a customer’s own My Sites only ever shows their own.',
    steps: [
      <>
        Click <strong>Edit</strong> on any site to change its full configuration — PV size, battery specs,
        location/timezone/country, savings rate and currency, report schedule (cadence/day/hour), report
        recipients, which report modules are included, and its active/grid-export flags.
      </>,
      <>
        Use the customer dropdown + <strong>Reassign</strong> to move a site to a different customer — customers
        themselves never have this option.
      </>,
    ],
    bullets: [
      'Filter by Origin (Admin vs. Self-serve).',
      'Data source, last VRM sync, and active status are all visible per row at a glance.',
    ],
    diagram: 'dataSource',
    links: [
      { href: '/admin/sites', label: 'Sites' },
      { href: '/admin/vrm-fleet', label: 'VRM Fleet — link an installation' },
    ],
  },
  {
    id: 'upload',
    nav: 'Upload',
    title: 'Uploading a CSV on a customer’s behalf',
    lead: 'The same import pipeline as a customer’s own Upload CSV page, with one addition: you pick the customer first.',
    steps: [
      'Pick a customer (filterable by Origin).',
      'Pick one of their existing sites, or create a new one inline — PV size, battery, location, timezone, currency.',
      'Upload the VRM CSV file and review the preview (rows parsed, alarm events, outages, warnings).',
      'Click Import to commit the previewed data.',
    ],
    bullets: ['That customer’s own upload history — file, period, days imported, alarms — is listed below the form.'],
    diagram: 'dataSource',
    links: [{ href: '/admin/upload', label: 'Upload' }],
  },
  {
    id: 'reports',
    nav: 'Reports',
    title: 'Generating a report for any customer',
    lead: 'The same generator customers use themselves, but able to target any customer or site, and read from either data source.',
    steps: [
      <>
        Choose a <strong>Source</strong> — <code>vrm</code> (external customers, CSV/VRM-API-based) or{' '}
        <code>monitoring</code> (Pauly & Co&apos;s own Cerbo GX/Node-RED fleet) — a toggle customers never see.
      </>,
      'Pick a customer and a site, then a date range, and click Generate report.',
      'Review the summary (generation, consumption, independence %, health score, coverage warnings) and click Download PDF.',
    ],
    bullets: [
      <>
        This is a one-off generate-and-download flow, not an archive — for report <strong>history</strong> across
        every customer, see Activity instead.
      </>,
    ],
    links: [
      { href: '/admin/reports', label: 'Reports' },
      { href: '/admin/activity', label: 'Activity — report run history' },
    ],
  },
  {
    id: 'activity',
    nav: 'Activity',
    title: 'The cross-customer activity log',
    lead: 'One place to see everything that happened across every customer, most recent first — not just whichever one you’re currently looking at.',
    bullets: [
      'The CSV upload log — every ingestion, from any customer, admin or self-serve.',
      'Billing events — every ONVO webhook delivery received, including a rejected-secret attempt.',
      'Recent signups — the self-serve funnel exactly as it happens, in real time.',
      'Every scheduled or on-demand report run, across every customer.',
    ],
    links: [{ href: '/admin/activity', label: 'Activity' }],
  },
  {
    id: 'analytics',
    nav: 'Analytics',
    title: 'Visits, clicks, and the signup funnel',
    lead: 'Traffic and conversion for the marketing site and the app, via PostHog — pageviews and clicks are automatic; the funnel below is captured at each real success point.',
    bullets: [
      <>
        <code>$pageview</code> / <code>$autocapture</code> — every page view and every click, on every page,
        automatically.
      </>,
      <>
        <code>signup_request_submitted</code> &rarr; <code>trial_started</code> &rarr;{' '}
        <code>subscription_started</code> &rarr; <code>subscription_cancelled</code> — the real funnel, in order.{' '}
        <code>subscription_started</code> is captured from <code>vrm_api</code>&apos;s own billing reconciliation
        (Python), not from this app — the one step that can&apos;t be seen from a single Next.js route.
      </>,
      'Not connected yet? The Analytics page itself shows the exact setup steps — a PostHog project key is all it needs.',
    ],
    links: [{ href: '/admin/analytics', label: 'Analytics' }],
  },
  {
    id: 'fleet',
    nav: 'VRM Fleet',
    title: 'Monitor a site live',
    lead: (
      <>
        VRM Fleet only shows sites connected through the <strong>VRM API</strong> — a site that only ever receives
        CSV uploads has no live connection to poll, so it never appears there, no matter how many reports it has.
      </>
    ),
    steps: [
      <>
        <strong>Customer connects their own installation.</strong> The customer goes to their Sites page and uses
        the VRM Link panel to enter their own VRM installation and personal access token. Once connected, the
        site&apos;s <code>source</code> flips to <code>vrm_api</code> automatically — no separate step needed to
        make it show up on VRM Fleet.
      </>,
      <>
        <strong>You link it directly, as admin.</strong> From the VRM Fleet dashboard, click{' '}
        <em>+ Link a new installation</em> (this is your own VRM account, not a customer&apos;s). Pick the
        installation from the list, attach it to an existing customer or create a new one, then give it a site
        name.
      </>,
    ],
    bullets: [
      <>
        Once linked and active: a live sweep refreshes PV/load/battery/grid/SOC every ~15 minutes (the only
        requirement is <code>source = &apos;vrm_api&apos;</code> and <code>active = true</code> — no separate
        enrollment), and the site&apos;s existing daily report pipeline keeps computing System score, Grid score,
        self-sufficiency, self-consumption, DoD, and yield the same way it always did.
      </>,
      <>
        <strong>Connection</strong> (Online/Stale) reflects the last ~15-minute live sweep; the &quot;Report
        data: &hellip;&quot; line underneath is the separate daily sync&apos;s own last-completed date — the two
        can genuinely disagree for days, by design.
      </>,
      <>
        <strong>Grid</strong> prefers a dedicated meter when one exists, falling back to the inverter&apos;s own
        AC input reading otherwise — the two are not the same number.
      </>,
      <>
        No one-click &quot;unmonitor&quot; yet — setting a site&apos;s <code>active</code> column to{' '}
        <code>false</code> removes it from VRM Fleet immediately without deleting history. Genuinely deleting a
        site is still not self-service.
      </>,
    ],
    diagram: 'scoreLegend',
    links: [
      { href: '/admin/fleet', label: 'VRM Fleet' },
      { href: '/admin/vrm-fleet', label: 'Link a new installation' },
    ],
  },
];

export function AdminHelpManager() {
  const [activeId, setActiveId] = useState(TOPICS[0].id);
  const active = TOPICS.find((topic) => topic.id === activeId) ?? TOPICS[0];

  return (
    <div>
      <div className={styles.topicGrid} role="tablist">
        {TOPICS.map((topic) => (
          <button
            key={topic.id}
            type="button"
            role="tab"
            aria-selected={topic.id === activeId}
            className={topic.id === activeId ? styles.topicCardActive : styles.topicCard}
            onClick={() => setActiveId(topic.id)}
          >
            {topic.nav}
          </button>
        ))}
      </div>

      <Panel className={styles.section}>
        <h2>{active.title}</h2>
        <p>{active.lead}</p>
        {active.steps && (
          <ol className={styles.stepList}>
            {active.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
        {active.diagram === 'dataSource' && <DataSourceDiagram />}
        {active.diagram === 'scoreLegend' && <ScoreLegend />}
        {active.bullets && (
          <ul className={styles.bulletList}>
            {active.bullets.map((bullet, i) => (
              <li key={i}>{bullet}</li>
            ))}
          </ul>
        )}
        <div className={styles.linkRow}>
          {active.links.map((link) => (
            <Link key={link.href} href={link.href} className={styles.pageLink}>
              {link.label} &rarr;
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}

'use client';

// Topic-card switcher for `/admin/help` — same pattern as the customer
// side's own `app/(portal)/app/help/HelpManager.tsx`. Bilingual (2026-09-24,
// along with the rest of the admin panel) — `TOPICS` is built by
// `getTopics(lang)` rather than a static array, since its `lead`/`steps`/
// `bullets` are ReactNode (some with embedded `<strong>`/`<code>` tags
// around a translated sentence, not just a translated string).
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
import { t, type Lang } from '@/lib/i18n/strings';
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

function getTopics(lang: Lang): Topic[] {
  const click = t(lang, 'admin_help_word_click');
  return [
    {
      id: 'customers',
      nav: t(lang, 'admin_nav_customers'),
      title: t(lang, 'admin_help_customers_title'),
      lead: t(lang, 'admin_help_customers_lead'),
      steps: [
        <>
          {click} <strong>{t(lang, 'admin_customers_new_button')}</strong> {t(lang, 'admin_help_customers_step1_post')}
        </>,
        <>
          {click} <strong>{t(lang, 'admin_customers_edit_button')}</strong> {t(lang, 'admin_help_customers_step2_post')}
        </>,
        <>
          {click} <strong>{t(lang, 'admin_customers_billing_button')}</strong> {t(lang, 'admin_help_customers_step3_post')}
        </>,
      ],
      bullets: [
        <>
          <strong>{t(lang, 'admin_customers_resend_invite')}</strong> {t(lang, 'admin_help_customers_bullet1_post')}
        </>,
        <>
          <strong>{t(lang, 'admin_customers_disconnect_vrm')}</strong> {t(lang, 'admin_help_customers_bullet2_post')}
        </>,
        t(lang, 'admin_help_customers_bullet3'),
      ],
      links: [{ href: '/admin/customers', label: t(lang, 'admin_nav_customers') }],
    },
    {
      id: 'sites',
      nav: t(lang, 'admin_nav_sites'),
      title: t(lang, 'admin_help_sites_title'),
      lead: t(lang, 'admin_help_sites_lead'),
      steps: [
        <>
          {click} <strong>{t(lang, 'admin_customers_edit_button')}</strong> {t(lang, 'admin_help_sites_step1_post')}
        </>,
        <>
          {t(lang, 'admin_help_sites_step2_pre')} <strong>{t(lang, 'admin_sites_reassign_button')}</strong>{' '}
          {t(lang, 'admin_help_sites_step2_post')}
        </>,
      ],
      bullets: [t(lang, 'admin_help_sites_bullet1'), t(lang, 'admin_help_sites_bullet2')],
      diagram: 'dataSource',
      links: [
        { href: '/admin/sites', label: t(lang, 'admin_nav_sites') },
        { href: '/admin/vrm-fleet', label: t(lang, 'admin_help_sites_vrmfleet_link') },
      ],
    },
    {
      id: 'upload',
      nav: t(lang, 'admin_nav_upload'),
      title: t(lang, 'admin_help_upload_title'),
      lead: t(lang, 'admin_help_upload_lead'),
      steps: [
        t(lang, 'admin_help_upload_step1'),
        t(lang, 'admin_help_upload_step2'),
        t(lang, 'admin_help_upload_step3'),
        t(lang, 'admin_help_upload_step4'),
      ],
      bullets: [t(lang, 'admin_help_upload_bullet1')],
      diagram: 'dataSource',
      links: [{ href: '/admin/upload', label: t(lang, 'admin_nav_upload') }],
    },
    {
      id: 'reports',
      nav: t(lang, 'admin_nav_reports'),
      title: t(lang, 'admin_help_reports_title'),
      lead: t(lang, 'admin_help_reports_lead'),
      steps: [
        <>
          {t(lang, 'admin_help_reports_step1_a')} <strong>{t(lang, 'admin_reports_field_source')}</strong> — <code>vrm</code>{' '}
          {t(lang, 'admin_help_reports_step1_c')} <code>monitoring</code> {t(lang, 'admin_help_reports_step1_d')}
        </>,
        t(lang, 'admin_help_reports_step2'),
        t(lang, 'admin_help_reports_step3'),
      ],
      bullets: [
        <>
          {t(lang, 'admin_help_reports_bullet1_pre')} <strong>{t(lang, 'admin_help_word_history')}</strong>{' '}
          {t(lang, 'admin_help_reports_bullet1_post')}
        </>,
      ],
      links: [
        { href: '/admin/reports', label: t(lang, 'admin_nav_reports') },
        { href: '/admin/activity', label: t(lang, 'admin_help_reports_activity_link') },
      ],
    },
    {
      id: 'activity',
      nav: t(lang, 'admin_nav_activity'),
      title: t(lang, 'admin_help_activity_title'),
      lead: t(lang, 'admin_help_activity_lead'),
      bullets: [
        t(lang, 'admin_help_activity_bullet1'),
        t(lang, 'admin_help_activity_bullet2'),
        t(lang, 'admin_help_activity_bullet3'),
        t(lang, 'admin_help_activity_bullet4'),
      ],
      links: [{ href: '/admin/activity', label: t(lang, 'admin_nav_activity') }],
    },
    {
      id: 'analytics',
      nav: t(lang, 'admin_nav_analytics'),
      title: t(lang, 'admin_help_analytics_title'),
      lead: t(lang, 'admin_help_analytics_lead'),
      bullets: [
        <>
          <code>$pageview</code> / <code>$autocapture</code> {t(lang, 'admin_help_analytics_bullet1_post')}
        </>,
        <>
          <code>signup_request_submitted</code> &rarr; <code>trial_started</code> &rarr; <code>subscription_started</code> &rarr;{' '}
          <code>subscription_cancelled</code> {t(lang, 'admin_help_analytics_bullet2_a')} <code>subscription_started</code>{' '}
          {t(lang, 'admin_help_analytics_bullet2_b')} <code>vrm_api</code>
          {t(lang, 'admin_help_analytics_bullet2_c')}
        </>,
        t(lang, 'admin_help_analytics_bullet3'),
      ],
      links: [{ href: '/admin/analytics', label: t(lang, 'admin_nav_analytics') }],
    },
    {
      id: 'fleet',
      nav: t(lang, 'admin_nav_fleet'),
      title: t(lang, 'admin_help_fleet_title'),
      lead: (
        <>
          {t(lang, 'admin_help_fleet_lead_pre')} <strong>{t(lang, 'admin_help_word_vrm_api')}</strong> —{' '}
          {t(lang, 'admin_help_fleet_lead_post')}
        </>
      ),
      steps: [
        <>
          <strong>{t(lang, 'admin_help_fleet_step1_bold')}</strong> {t(lang, 'admin_help_fleet_step1_post1')} <code>source</code>{' '}
          {t(lang, 'admin_help_fleet_step1_post2')} <code>vrm_api</code> {t(lang, 'admin_help_fleet_step1_post3')}
        </>,
        <>
          <strong>{t(lang, 'admin_help_fleet_step2_bold')}</strong> {t(lang, 'admin_help_fleet_step2_post1')}{' '}
          <em>{t(lang, 'admin_fleet_link_new')}</em> {t(lang, 'admin_help_fleet_step2_post2')}
        </>,
      ],
      bullets: [
        <>
          {t(lang, 'admin_help_fleet_bullet1_pre')} <code>source = &apos;vrm_api&apos;</code> {t(lang, 'admin_help_fleet_bullet1_mid')}{' '}
          <code>active = true</code> {t(lang, 'admin_help_fleet_bullet1_post')}
        </>,
        <>
          <strong>{t(lang, 'admin_fleet_col_connection')}</strong> {t(lang, 'admin_help_fleet_bullet2_post')}
        </>,
        <>
          <strong>{t(lang, 'admin_fleetsite_kpi_grid')}</strong> {t(lang, 'admin_help_fleet_bullet3_post')}
        </>,
        <>
          {t(lang, 'admin_help_fleet_bullet4_pre')} <code>active</code> {t(lang, 'admin_help_fleet_bullet4_mid')}{' '}
          <code>false</code> {t(lang, 'admin_help_fleet_bullet4_post')}
        </>,
      ],
      diagram: 'scoreLegend',
      links: [
        { href: '/admin/fleet', label: t(lang, 'admin_fleet_title') },
        { href: '/admin/vrm-fleet', label: t(lang, 'admin_help_link_new_installation') },
      ],
    },
  ];
}

export function AdminHelpManager({ lang }: { lang: Lang }) {
  const topics = getTopics(lang);
  const [activeId, setActiveId] = useState(topics[0].id);
  const active = topics.find((topic) => topic.id === activeId) ?? topics[0];

  return (
    <div>
      <div className={styles.topicGrid} role="tablist">
        {topics.map((topic) => (
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
        {active.diagram === 'dataSource' && <DataSourceDiagram lang={lang} />}
        {active.diagram === 'scoreLegend' && <ScoreLegend lang={lang} />}
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

'use client';

// Topic-card switcher for `/app/help` — the only client state on this page
// is "which topic is active," same shape as `SitesManager.tsx`'s own
// "which row is being edited" (a plain useState, data itself is static
// content baked into this file, not fetched). Split out of `page.tsx`
// (a Server Component) for the same reason `ReportManager`/`ReportHistory`
// are split out of `app/(portal)/app/page.tsx` — everything that doesn't
// need interactivity (the FAQ list, the contact card) stays server-rendered
// there instead of being dragged into this client bundle for no reason.
//
// 2026-09-19 audit (Oscar's own request: "every step should be clear...
// using tabs, cards, images, charts, bullets, links to the mentioned
// sections"). Three topics added (Reports, Upload, Dashboard — the three
// nav pages that had zero coverage here before), every topic now carries
// a real `links` row instead of a page name in plain text, and two shared
// illustrative diagrams (components/app/HelpDiagrams) replace what used
// to be pure prose for the CSV-vs-VRM fork and the score bands. Topic
// order now mirrors the actual sidebar nav order (`app/(portal)/app/
// layout.tsx`) top to bottom, not an arbitrary "onboarding narrative"
// order — a reader scanning the sidebar and scanning these tabs should
// see the same sequence.
import { useState } from 'react';
import Link from 'next/link';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import { Panel } from '@/components/ui';
import { DataSourceDiagram, ScoreLegend } from '@/components/app';
import styles from './help.module.css';

type TopicLink = { href: string; labelKey: StringKey };

type Topic = {
  id: string;
  navKey: StringKey;
  titleKey: StringKey;
  leadKey: StringKey;
  steps?: StringKey[];
  bullets?: StringKey[];
  diagram?: 'dataSource' | 'scoreLegend';
  links: TopicLink[];
};

const TOPICS: Topic[] = [
  {
    id: 'reports',
    navKey: 'help_nav_reports',
    titleKey: 'help_section_reports_title',
    leadKey: 'help_section_reports_lead',
    steps: ['help_reports_step_1', 'help_reports_step_2', 'help_reports_step_3'],
    bullets: ['help_reports_bullet_history', 'help_reports_bullet_scheduled'],
    links: [{ href: '/app', labelKey: 'nav_reports' }],
  },
  {
    id: 'upload',
    navKey: 'help_nav_upload',
    titleKey: 'help_section_upload_title',
    leadKey: 'help_section_upload_lead',
    steps: ['help_upload_step_1', 'help_upload_step_2', 'help_upload_step_3'],
    bullets: ['help_upload_bullet_history', 'help_upload_bullet_limit'],
    diagram: 'dataSource',
    links: [{ href: '/app/upload', labelKey: 'nav_upload' }],
  },
  {
    id: 'sites',
    navKey: 'help_nav_sites',
    titleKey: 'help_section_sites_title',
    leadKey: 'help_section_sites_lead',
    steps: ['help_sites_step_1', 'help_sites_step_2'],
    bullets: ['help_sites_bullet_reconnect'],
    diagram: 'dataSource',
    links: [{ href: '/app/sites', labelKey: 'nav_my_sites' }],
  },
  {
    id: 'schedule',
    navKey: 'help_nav_schedule',
    titleKey: 'help_section_schedule_title',
    leadKey: 'help_section_schedule_lead',
    steps: ['help_schedule_step_1', 'help_schedule_step_2', 'help_schedule_step_3', 'help_schedule_step_4', 'help_schedule_step_5'],
    bullets: ['help_schedule_bullet_recipients', 'help_schedule_bullet_cap', 'help_schedule_bullet_bulk'],
    links: [{ href: '/app/sites', labelKey: 'nav_my_sites' }],
  },
  {
    id: 'dashboard',
    navKey: 'help_nav_dashboard',
    titleKey: 'help_section_dashboard_title',
    leadKey: 'help_section_dashboard_lead',
    bullets: ['help_dashboard_bullet_scores', 'help_dashboard_bullet_insights', 'help_dashboard_bullet_upgrade'],
    diagram: 'scoreLegend',
    links: [
      { href: '/app/dashboard', labelKey: 'nav_dashboard' },
      { href: '/app/billing', labelKey: 'nav_billing' },
    ],
  },
  {
    id: 'branding',
    navKey: 'help_nav_branding',
    titleKey: 'help_section_branding_title',
    leadKey: 'help_section_branding_lead',
    bullets: ['help_branding_bullet_who', 'help_branding_bullet_what', 'help_branding_bullet_where'],
    links: [{ href: '/app/branding', labelKey: 'nav_branding' }],
  },
  {
    id: 'billing',
    navKey: 'help_nav_billing',
    titleKey: 'help_section_billing_title',
    leadKey: 'help_section_billing_lead',
    bullets: ['help_billing_bullet_plan', 'help_billing_bullet_limit', 'help_billing_bullet_upgrade'],
    links: [{ href: '/app/billing', labelKey: 'nav_billing' }],
  },
  {
    id: 'account',
    navKey: 'help_nav_account',
    titleKey: 'help_section_account_title',
    leadKey: 'help_section_account_lead',
    bullets: ['help_account_bullet_password', 'help_account_bullet_language'],
    links: [{ href: '/app/profile', labelKey: 'nav_profile' }],
  },
];

export function HelpManager({ lang }: { lang: Lang }) {
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
            {t(lang, topic.navKey)}
          </button>
        ))}
      </div>

      <Panel className={styles.section}>
        <h2>{t(lang, active.titleKey)}</h2>
        <p>{t(lang, active.leadKey)}</p>
        {active.steps && (
          <ol className={styles.stepList}>
            {active.steps.map((key) => (
              <li key={key}>{t(lang, key)}</li>
            ))}
          </ol>
        )}
        {active.diagram === 'dataSource' && <DataSourceDiagram lang={lang} />}
        {active.diagram === 'scoreLegend' && <ScoreLegend lang={lang} />}
        {active.bullets && (
          <ul className={styles.bulletList}>
            {active.bullets.map((key) => (
              <li key={key}>{t(lang, key)}</li>
            ))}
          </ul>
        )}
        <div className={styles.linkRow}>
          {active.links.map((link) => (
            <Link key={link.href} href={link.href} className={styles.pageLink}>
              {t(lang, link.labelKey)} &rarr;
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}

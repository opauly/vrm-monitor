import Link from 'next/link';
import { Panel, SectionHead } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './CapabilitiesTeaser.module.css';

// Replaces two separate homepage sections, ModuleTeaser ("What's inside" —
// the report's own 3-card teaser) and LiveDashboard ("Live dashboard" — the
// insight-list + DashboardPreview panel), 2026-09-21 (Oscar's own audit):
// a first-time visitor hit two full sections before ever reaching Pricing,
// each pitching one half of the product on its own — which read as two
// separate features rather than the one two-way product they actually are.
// This is one short section instead: two columns, side by side, then a
// single link out to /whats-inside for the full breakdown (every dashboard
// signal, every report section, the real rendered PDF and the real live
// chart) — the explicit, unsummarized version of both halves lives there
// now, not here.
export function CapabilitiesTeaser({ lang }: { lang: Lang }) {
  const base = lang === 'es' ? '/es' : '';
  return (
    <section id="capabilities" className="band">
      <div className="wrap">
        <SectionHead eyebrow={t(lang, 'marketing_capabilities_eyebrow')} lede={t(lang, 'marketing_capabilities_lede')}>
          {t(lang, 'marketing_capabilities_title_a')}
          <br />
          {t(lang, 'marketing_capabilities_title_b')}
        </SectionHead>

        <div className={styles.grid}>
          <Panel className={styles.card} variant="card" interactive led>
            <span className={styles.tag}>{t(lang, 'marketing_capabilities_tag_now')}</span>
            <h3>{t(lang, 'marketing_capabilities_dash_title')}</h3>
            <ul className={styles.list}>
              <li>{t(lang, 'marketing_capabilities_dash_li1')}</li>
              <li>{t(lang, 'marketing_capabilities_dash_li2')}</li>
              <li>{t(lang, 'marketing_capabilities_dash_li3')}</li>
            </ul>
          </Panel>

          <Panel className={styles.card} variant="card" interactive led>
            <span className={styles.tag}>{t(lang, 'marketing_capabilities_tag_period')}</span>
            <h3>{t(lang, 'marketing_capabilities_report_title')}</h3>
            <ul className={styles.list}>
              <li>{t(lang, 'marketing_capabilities_report_li1')}</li>
              <li>{t(lang, 'marketing_capabilities_report_li2')}</li>
              <li>{t(lang, 'marketing_capabilities_report_li3')}</li>
            </ul>
          </Panel>
        </div>

        <Link href={`${base}/whats-inside`} className={styles.cta}>
          {t(lang, 'marketing_capabilities_cta')}
          <span aria-hidden="true"> →</span>
        </Link>
      </div>
    </section>
  );
}

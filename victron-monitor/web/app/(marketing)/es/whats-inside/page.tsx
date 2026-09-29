import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, Panel, SectionHead } from '@/components/ui';
import { DashboardPreview, Footer, ModuleGrid, Nav, ReportPreview } from '@/components/marketing';
import { FIXED_MODULE_ICONS, REPORT_MODULE_ICONS } from '@/lib/reportModuleThumbnails';
import { t } from '@/lib/i18n/strings';
import styles from '../../whats-inside/whats-inside.module.css';

// Spanish counterpart of app/(marketing)/whats-inside/page.tsx (2026-09-27
// rollout) — its own literal route; see that file's own header comment for
// why this page exists and how its sections were arrived at.
export const metadata: Metadata = {
  title: t('es', 'marketing_whatsinside_meta_title'),
  description: t('es', 'marketing_whatsinside_meta_description'),
  alternates: {
    canonical: '/es/whats-inside',
    languages: { 'en-US': '/whats-inside', 'es-CR': '/es/whats-inside', 'x-default': '/whats-inside' },
  },
};

const lang = 'es' as const;

const FAQS = [
  { q: t(lang, 'marketing_whatsinside_faq_q1'), a: t(lang, 'marketing_whatsinside_faq_a1') },
  { q: t(lang, 'marketing_whatsinside_faq_q2'), a: t(lang, 'marketing_whatsinside_faq_a2') },
  { q: t(lang, 'marketing_whatsinside_faq_q3'), a: t(lang, 'marketing_whatsinside_faq_a3') },
  { q: t(lang, 'marketing_whatsinside_faq_q4'), a: t(lang, 'marketing_whatsinside_faq_a4') },
  { q: t(lang, 'marketing_whatsinside_faq_q5'), a: t(lang, 'marketing_whatsinside_faq_a5') },
  { q: t(lang, 'marketing_whatsinside_faq_q6'), a: t(lang, 'marketing_whatsinside_faq_a6') },
];

export default function WhatsInsidePageEs() {
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <Nav lang={lang} toggle={{ kind: 'href', href: '/whats-inside' }} />

      <header className={`wrap ${styles.intro}`}>
        <Link href="/es/#capabilities" className={styles.backLink}>
          {t(lang, 'marketing_legal_back')}
        </Link>
        <SectionHead eyebrow={t(lang, 'marketing_capabilities_eyebrow')}>{t(lang, 'marketing_whatsinside_h1')}</SectionHead>
        <div className={styles.introBody}>
          <p>
            {t(lang, 'marketing_whatsinside_intro_1')}
            <b>{t(lang, 'marketing_whatsinside_intro_live_dashboard')}</b>
            {t(lang, 'marketing_whatsinside_intro_2')}
            <b>{t(lang, 'marketing_whatsinside_intro_pdf_report')}</b>
            {t(lang, 'marketing_whatsinside_intro_3')}
            <a href="https://www.victronenergy.com/blog/2024/12/04/introducing-our-new-software-integrator-program/" target="_blank" rel="noopener noreferrer">
              {t(lang, 'marketing_whatsinside_intro_integrator')}
            </a>
            {t(lang, 'marketing_whatsinside_intro_4')}
          </p>
        </div>
      </header>

      <section className="band">
        <div className="wrap">
          <SectionHead eyebrow={t(lang, 'marketing_whatsinside_live_eyebrow')} lede={t(lang, 'marketing_whatsinside_live_lede')}>
            {t(lang, 'marketing_whatsinside_live_title')}
          </SectionHead>
          <div className={styles.signalGrid}>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{FIXED_MODULE_ICONS.kpi}</span>
              <span className={styles.signalTag}>{t(lang, 'marketing_tag_score')}</span>
              <h3>{t(lang, 'marketing_whatsinside_signal1_title')}</h3>
              <p className={styles.signalBody}>{t(lang, 'marketing_whatsinside_signal1_body')}</p>
            </Panel>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{REPORT_MODULE_ICONS.grid_quality}</span>
              <span className={styles.signalTag}>{t(lang, 'marketing_tag_score')}</span>
              <h3>{t(lang, 'marketing_whatsinside_signal2_title')}</h3>
              <p className={styles.signalBody}>{t(lang, 'marketing_whatsinside_signal2_body')}</p>
            </Panel>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{REPORT_MODULE_ICONS.critical_alerts}</span>
              <span className={styles.signalTag}>{t(lang, 'marketing_tag_ai_insight')}</span>
              <h3>{t(lang, 'marketing_whatsinside_signal3_title')}</h3>
              <p className={styles.signalBody}>{t(lang, 'marketing_whatsinside_signal3_body')}</p>
            </Panel>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{REPORT_MODULE_ICONS.trend}</span>
              <span className={styles.signalTag}>{t(lang, 'marketing_tag_ai_insight')}</span>
              <h3>{t(lang, 'marketing_whatsinside_signal4_title')}</h3>
              <p className={styles.signalBody}>{t(lang, 'marketing_whatsinside_signal4_body')}</p>
            </Panel>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{REPORT_MODULE_ICONS.solar_performance}</span>
              <span className={styles.signalTag}>{t(lang, 'marketing_tag_ai_insight')}</span>
              <h3>{t(lang, 'marketing_whatsinside_signal5_title')}</h3>
              <p className={styles.signalBody}>{t(lang, 'marketing_whatsinside_signal5_body')}</p>
            </Panel>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{REPORT_MODULE_ICONS.battery_health}</span>
              <span className={styles.signalTag}>{t(lang, 'marketing_tag_ai_insight')}</span>
              <h3>{t(lang, 'marketing_whatsinside_signal6_title')}</h3>
              <p className={styles.signalBody}>{t(lang, 'marketing_whatsinside_signal6_body')}</p>
            </Panel>
          </div>

          <div className={styles.dashboardPreviewWrap}>
            <DashboardPreview lang={lang} />
          </div>
        </div>
      </section>

      <ReportPreview lang={lang} />

      <ModuleGrid lang={lang} />

      <section className="band">
        <div className="wrap">
          <SectionHead eyebrow={t(lang, 'marketing_whatsinside_faq_eyebrow')}>{t(lang, 'marketing_whatsinside_faq_title')}</SectionHead>
          <div className={styles.faqList}>
            {FAQS.map((item) => (
              <div className={styles.faqItem} key={item.q}>
                <h3>{item.q}</h3>
                <p>{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className={`wrap ${styles.ctaBand}`}>
        <h2>{t(lang, 'marketing_whatsinside_cta_title')}</h2>
        <p>{t(lang, 'marketing_pricing_trial_banner')}</p>
        <Button href="/signup" arrow>
          {t(lang, 'marketing_cta_get_started')}
        </Button>
      </div>

      <Footer lang={lang} />
    </>
  );
}

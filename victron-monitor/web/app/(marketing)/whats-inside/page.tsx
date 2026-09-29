import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, Panel, SectionHead } from '@/components/ui';
import { DashboardPreview, Footer, ModuleGrid, Nav, ReportPreview } from '@/components/marketing';
import { FIXED_MODULE_ICONS, REPORT_MODULE_ICONS } from '@/lib/reportModuleThumbnails';
import { t } from '@/lib/i18n/strings';
import styles from './whats-inside.module.css';

// A dedicated, indexable deep-dive page (2026-09-19) for two reasons at
// once:
//   1. The home page's own ModuleGrid — all 16 report sections, in full —
//      was asked to carry the whole "what do you actually get" case before
//      a first-time visitor ever reached Pricing. Oscar's own read: that
//      diluted the pitch rather than supporting it. ModuleGrid moved here
//      unchanged; the home page keeps a short teaser instead
//      (`CapabilitiesTeaser`) that links here.
//   2. This is also the fix for the "AI SEO" content gap flagged in the
//      landing-page diagnosis: a single product-pitch page has nothing an
//      answer engine can cite. This page is written to directly answer
//      real questions ("what is a Victron Recommended Software
//      Integrator," "how often does the dashboard update") in plain,
//      quotable sentences — not just move a component. The FAQ section's
//      JSON-LD (`FAQPage`) is the same content in the schema.org shape
//      both classic rich results and LLM crawlers look for.
//
// 2026-09-20 (Oscar's own audit of this page): `ReportPreview` (the real
// rendered PDF screenshot) moved off the home page entirely and lives here
// now, right before `ModuleGrid`'s own full section-by-section breakdown.
// Same audit flagged this page as almost pure prose for a section
// literally titled "in detail" — `DashboardPreview` (the sample-fleet
// panel + the REAL `ShapeChart` component, extracted out of the
// since-retired `LiveDashboard.tsx` so both pages share one
// implementation) now backs that claim with an actual visual instead of
// describing it.
//
// 2026-09-21 (Oscar's own follow-up): the home page's `ModuleTeaser` and
// `LiveDashboard` sections — each pitching one half of the product on its
// own — merged into one `CapabilitiesTeaser` section, which is what links
// here now (nav's own "How it works" dropdown no longer does — see
// `Nav.tsx`'s own header comment). This page's own intro and "live
// dashboard, in detail" text were trimmed at the same time — Oscar's own
// read: they read as two separate features in prose rather than the one
// two-way product the visuals below them (`DashboardPreview`,
// `ReportPreview`, `ModuleGrid`) already prove.
//
// 2026-09-22 (Oscar's own audit): the "~15 minutes" refresh cadence was
// stated three times before a reader even reached the FAQ (intro,
// SectionHead lede, and again inside the dashboard-detail prose) — now
// stated exactly once, in the SectionHead lede right where it's relevant;
// the FAQ's own answers keep it, since each is meant to stand alone as an
// independently-citable fact for an answer engine, not read top-to-bottom.
// The former two-column bullet list for "every dashboard signal" is now a
// 6-card grid — the same icon+tag+title+body shape `ModuleGrid` already
// uses for "every report section," so the two "everything this computes"
// blocks on this page read as one pattern instead of two different
// treatments. `ReportPreview`'s own title/copy were also normalized here
// (see that component's own header comment).
export const metadata: Metadata = {
  title: "What's Inside",
  description:
    "Every report section and every live-dashboard signal VRM Monitor computes, in detail — plus what a Victron Recommended Software Integrator actually is.",
  alternates: {
    canonical: '/whats-inside',
    languages: { 'en-US': '/whats-inside', 'es-CR': '/es/whats-inside', 'x-default': '/whats-inside' },
  },
};

const lang = 'en' as const;

const FAQS = [
  { q: t(lang, 'marketing_whatsinside_faq_q1'), a: t(lang, 'marketing_whatsinside_faq_a1') },
  { q: t(lang, 'marketing_whatsinside_faq_q2'), a: t(lang, 'marketing_whatsinside_faq_a2') },
  { q: t(lang, 'marketing_whatsinside_faq_q3'), a: t(lang, 'marketing_whatsinside_faq_a3') },
  { q: t(lang, 'marketing_whatsinside_faq_q4'), a: t(lang, 'marketing_whatsinside_faq_a4') },
  { q: t(lang, 'marketing_whatsinside_faq_q5'), a: t(lang, 'marketing_whatsinside_faq_a5') },
  { q: t(lang, 'marketing_whatsinside_faq_q6'), a: t(lang, 'marketing_whatsinside_faq_a6') },
];

export default function WhatsInsidePage() {
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
      {/* Static JSON-LD built from the FAQS constant above, not user
          input — a plain <script> tag, per Next.js's own documented
          pattern for structured data (next/script's dedup/strategy
          machinery is for third-party/interactive scripts, not needed
          for inert, server-rendered JSON). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <Nav lang={lang} toggle={{ kind: 'href', href: '/es/whats-inside' }} />

      <header className={`wrap ${styles.intro}`}>
        <Link href="/#capabilities" className={styles.backLink}>
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

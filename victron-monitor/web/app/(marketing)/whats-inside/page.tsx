import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, Panel, SectionHead } from '@/components/ui';
import { DashboardPreview, Footer, ModuleGrid, Nav, ReportPreview } from '@/components/marketing';
import { FIXED_MODULE_ICONS, REPORT_MODULE_ICONS } from '@/lib/reportModuleThumbnails';
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
  alternates: { canonical: '/whats-inside' },
};

const FAQS = [
  {
    q: 'What is VRM Monitor?',
    a: "VRM Monitor is a live dashboard and a weekly, AI-narrated PDF report for any Victron Energy solar or hybrid system. It reads data your equipment is already generating — from Victron's own VRM Portal, via CSV export or the VRM API — and turns it into a live view that updates every ~15 minutes, and a branded report a homeowner or an installer's customer actually reads. It's built by Pauly & Co., a Victron Recommended Software Integrator.",
  },
  {
    q: 'What is a Victron Recommended Software Integrator?',
    a: "It's Victron Energy's own program recognizing software companies it has directly vetted to build on top of the VRM API, Node-RED, and Venus OS. Victron connects recommended integrators with its own distributor and installer network rather than leaving customers to guess which third-party tools are trustworthy. Pauly & Co. was accepted into the program in September 2026.",
  },
  {
    q: 'Do I need to change my Node-RED setup or reflash my Cerbo GX?',
    a: 'No. VRM Monitor reads data your equipment is already generating and sending to the VRM Portal — no changes to an existing Node-RED flow, and no re-flashing a Cerbo GX.',
  },
  {
    q: 'How often does the live dashboard update?',
    a: "Every ~15 minutes, pulled from the same VRM API your Cerbo GX already reports to — the same live power readings and battery state of charge you'd see in the VRM Portal itself, alongside a health score that's always current instead of only refreshed once a week.",
  },
  {
    q: "What's the difference between the live dashboard and the weekly report?",
    a: "The live dashboard shows you right now: real-time solar, load, battery, and grid power, refreshed every ~15 minutes. The report tells the story of the period that just ended — a branded PDF with an AI-written narrative, delivered automatically by email every week (or every month, past 31 days). Same underlying data, two different jobs.",
  },
  {
    q: 'Can I use this for a single home, or a whole installer fleet?',
    a: "Both. Starter is built around the weekly/monthly report for a single system. Growth and Fleet add the live dashboard, AI Insights, and per-site report customization for an installer managing a whole customer fleet from one account.",
  },
] as const;

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
      <Nav />

      <header className={`wrap ${styles.intro}`}>
        <Link href="/#capabilities" className={styles.backLink}>
          &larr; Back to VRM Monitor
        </Link>
        <SectionHead eyebrow="What's inside">What&apos;s inside VRM Monitor.</SectionHead>
        <div className={styles.introBody}>
          <p>
            VRM Monitor is two connected views of one Victron system: a <b>live dashboard</b> and an automated,
            AI-narrated <b>PDF report</b> delivered on its own schedule &mdash; personalized to each site, built by
            Pauly &amp; Co., a{' '}
            <a href="https://www.victronenergy.com/blog/2024/12/04/introducing-our-new-software-integrator-program/" target="_blank" rel="noopener noreferrer">
              Victron Recommended Software Integrator
            </a>
            . Both read data your equipment already generates &mdash; no Node-RED changes, no Cerbo reflash.
          </p>
        </div>
      </header>

      <section className="band">
        <div className="wrap">
          <SectionHead eyebrow="Live, right now" lede="Refreshed every ~15 minutes, straight from the VRM API — the same feed your Cerbo GX already reports to.">
            The live dashboard, in detail.
          </SectionHead>
          <div className={styles.signalGrid}>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{FIXED_MODULE_ICONS.kpi}</span>
              <span className={styles.signalTag}>Score</span>
              <h3>System score</h3>
              <p className={styles.signalBody}>Alarms, SOC, cycling, temperature, voltage &mdash; one number, always current.</p>
            </Panel>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{REPORT_MODULE_ICONS.grid_quality}</span>
              <span className={styles.signalTag}>Score</span>
              <h3>Grid score</h3>
              <p className={styles.signalBody}>Outage time, and how much load came from the grid instead of solar or battery.</p>
            </Panel>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{REPORT_MODULE_ICONS.critical_alerts}</span>
              <span className={styles.signalTag}>AI Insight</span>
              <h3>Unexpected silence</h3>
              <p className={styles.signalBody}>A real zero during hours this site has historically produced.</p>
            </Panel>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{REPORT_MODULE_ICONS.trend}</span>
              <span className={styles.signalTag}>AI Insight</span>
              <h3>Quiet drift</h3>
              <p className={styles.signalBody}>Trending down versus this site&apos;s own recent baseline.</p>
            </Panel>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{REPORT_MODULE_ICONS.solar_performance}</span>
              <span className={styles.signalTag}>AI Insight</span>
              <h3>Underperformance</h3>
              <p className={styles.signalBody}>Solar output below what this site&apos;s installed size should deliver.</p>
            </Panel>
            <Panel className={styles.signalCard} variant="card" interactive led>
              <span className={styles.signalIcon} aria-hidden="true">{REPORT_MODULE_ICONS.battery_health}</span>
              <span className={styles.signalTag}>AI Insight</span>
              <h3>Incomplete charging</h3>
              <p className={styles.signalBody}>Battery hasn&apos;t reached full charge in 5 or more of the last 7 days.</p>
            </Panel>
          </div>

          <div className={styles.dashboardPreviewWrap}>
            <DashboardPreview />
          </div>
        </div>
      </section>

      <ReportPreview />

      <ModuleGrid />

      <section className="band">
        <div className="wrap">
          <SectionHead eyebrow="Questions">Frequently asked.</SectionHead>
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
        <h2>See it on your own system.</h2>
        <p>Every plan starts with a 7-day free trial &mdash; cancel before it ends and you won&apos;t be charged.</p>
        <Button href="/signup" arrow>
          Get started
        </Button>
      </div>

      <Footer />
    </>
  );
}

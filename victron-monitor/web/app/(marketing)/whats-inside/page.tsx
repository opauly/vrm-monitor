import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, SectionHead } from '@/components/ui';
import { Footer, ModuleGrid, Nav } from '@/components/marketing';
import styles from './whats-inside.module.css';

// A dedicated, indexable deep-dive page (2026-09-19) for two reasons at
// once:
//   1. The home page's own ModuleGrid — all 16 report sections, in full —
//      was asked to carry the whole "what do you actually get" case before
//      a first-time visitor ever reached Pricing. Oscar's own read: that
//      diluted the pitch rather than supporting it. ModuleGrid moved here
//      unchanged; the home page keeps a 3-card teaser instead
//      (ModuleTeaser) that links here.
//   2. This is also the fix for the "AI SEO" content gap flagged in the
//      landing-page diagnosis: a single product-pitch page has nothing an
//      answer engine can cite. This page is written to directly answer
//      real questions ("what is a Victron Recommended Software
//      Integrator," "how often does the dashboard update") in plain,
//      quotable sentences — not just move a component. The FAQ section's
//      JSON-LD (`FAQPage`) is the same content in the schema.org shape
//      both classic rich results and LLM crawlers look for.
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
        <Link href="/#modules" className={styles.backLink}>
          &larr; Back to VRM Monitor
        </Link>
        <SectionHead eyebrow="What's inside">What&apos;s inside VRM Monitor.</SectionHead>
        <div className={styles.introBody}>
          <p>
            VRM Monitor is a live dashboard and a weekly, AI-narrated PDF report for any Victron Energy solar or
            hybrid system &mdash; built by Pauly & Co., a{' '}
            <a href="https://www.victronenergy.com/blog/2024/12/04/introducing-our-new-software-integrator-program/" target="_blank" rel="noopener noreferrer">
              Victron Recommended Software Integrator
            </a>
            . It reads data your equipment is already generating, straight from Victron&apos;s own VRM Portal &mdash;
            via CSV export or the VRM API &mdash; no changes to an existing Node-RED flow, no re-flashing a Cerbo GX.
          </p>
          <p>
            One homeowner watching a single system and an installer managing a hundred customer sites are reading
            the exact same numbers, computed the exact same way &mdash; just at different scale. Below is every
            signal the live dashboard tracks, and every section a report can contain.
          </p>
        </div>
      </header>

      <section className="band">
        <div className="wrap">
          <SectionHead eyebrow="Live, right now" lede="Refreshed every ~15 minutes, straight from the VRM API — the same feed your Cerbo GX already reports to.">
            The live dashboard, in detail.
          </SectionHead>
          <div className={styles.detailGrid}>
            <div>
              <h3>Two scores, not one</h3>
              <p>
                Every site gets a <b>System score</b> and a <b>Grid score</b>, computed separately &mdash; not one
                blended number that hides which one actually needs attention.
              </p>
              <ul>
                <li>
                  <b>System</b> &mdash; equipment health: alarm events, battery SOC, cycling, temperature, voltage,
                  and whether the battery reached a full charge. A low SOC isn&apos;t penalized when a real grid
                  outage explains it &mdash; a battery discharging to cover the load while the grid is down is the
                  system working as designed, not a fault.
                </li>
                <li>
                  <b>Grid</b> &mdash; grid reliability: how long and how often the grid was out, and how much of the
                  load came from the grid instead of solar or battery. Not shown for an off-grid system with no grid
                  connection to score.
                </li>
              </ul>
            </div>
            <div>
              <h3>AI Insights</h3>
              <p>Four deterministic checks against each site&apos;s own history &mdash; not a model, not a guess.</p>
              <ul>
                <li>
                  <b>Unexpected silence</b> &mdash; a real zero during hours this site has historically produced.
                </li>
                <li>
                  <b>Quiet drift</b> &mdash; trending down versus this site&apos;s own recent baseline.
                </li>
                <li>
                  <b>Underperformance</b> &mdash; solar output below what this site&apos;s installed size should
                  deliver, checked against modeled irradiance for its own location.
                </li>
                <li>
                  <b>Incomplete charging</b> &mdash; battery hasn&apos;t reached full charge in 5 or more of the
                  last 7 days.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

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

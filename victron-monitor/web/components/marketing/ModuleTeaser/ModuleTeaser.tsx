import Link from 'next/link';
import { Panel, SectionHead } from '@/components/ui';
import { FIXED_MODULE_ICONS, REPORT_MODULE_ICONS } from '@/lib/reportModuleThumbnails';
import styles from './ModuleTeaser.module.css';

// Homepage stand-in for the full ModuleGrid (2026-09-19) — Oscar's own
// read on the page: a first-time visitor was asked to scan all 16 report
// sections before ever reaching Pricing, which diluted the actual pitch
// rather than supporting it. ModuleGrid itself moved to /whats-inside,
// unchanged, for anyone who wants the full breakdown; this is three of
// its own cards (same copy, not a rewrite) plus a link, not a
// replacement feature.
export function ModuleTeaser() {
  return (
    <section id="modules">
      <div className="wrap">
        <SectionHead
          eyebrow="What's inside"
          lede="Sixteen sections, computed once and grouped into scoring, solar, battery, grid, and safety — Growth and Fleet installers choose exactly which ones appear on each site's report."
        >
          Every section a report
          <br />
          can contain.
        </SectionHead>

        <div className={styles.grid}>
          <Panel className={styles.card} variant="card" interactive led>
            <span className={styles.icon} aria-hidden="true">{FIXED_MODULE_ICONS.kpi}</span>
            <span className={styles.tag}>Scoring</span>
            <h3>Health score</h3>
            <p className={styles.body}>
              0–100, alongside solar generation, grid independence, and events for the period — one number a
              homeowner can actually track over time.
            </p>
          </Panel>

          <Panel className={styles.card} variant="card" interactive led>
            <span className={styles.icon} aria-hidden="true">{FIXED_MODULE_ICONS.narrative}</span>
            <span className={styles.tag}>Narrative</span>
            <h3>AI narrative</h3>
            <p className={styles.body}>
              A short paragraph explaining what happened this period — plain language, not a wall of numbers.
            </p>
          </Panel>

          <Panel className={styles.card} variant="card" interactive led>
            <span className={styles.icon} aria-hidden="true">{REPORT_MODULE_ICONS.battery_health}</span>
            <span className={styles.tag}>Battery</span>
            <h3>Battery health</h3>
            <p className={styles.body}>
              Tracks how well your batteries charged and discharged throughout this period — cycling stress, float
              days, voltage range.
            </p>
          </Panel>
        </div>

        <Link href="/whats-inside" className={styles.cta}>
          See everything a report and the live dashboard can show you
          <span aria-hidden="true"> →</span>
        </Link>
      </div>
    </section>
  );
}

import Link from 'next/link';
import { Panel, SectionHead } from '@/components/ui';
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
export function CapabilitiesTeaser() {
  return (
    <section id="capabilities" className="band">
      <div className="wrap">
        <SectionHead
          eyebrow="What's inside"
          lede="Two connected views of the same Victron system — watch it update in real time, or get the story of the week in your inbox automatically."
        >
          Live dashboard.
          <br />
          Weekly report.
        </SectionHead>

        <div className={styles.grid}>
          <Panel className={styles.card} variant="card" interactive led>
            <span className={styles.tag}>Right now</span>
            <h3>Live dashboard</h3>
            <ul className={styles.list}>
              <li>Real-time solar, load, battery &amp; grid — every ~15 minutes</li>
              <li>System &amp; Grid health scores, always current</li>
              <li>AI Insights: 4 automatic checks per site</li>
            </ul>
          </Panel>

          <Panel className={styles.card} variant="card" interactive led>
            <span className={styles.tag}>Every period</span>
            <h3>Weekly report</h3>
            <ul className={styles.list}>
              <li>Branded PDF with an AI-written narrative</li>
              <li>16 possible sections — scoring, solar, battery, grid, safety</li>
              <li>Delivered automatically, weekly or monthly</li>
            </ul>
          </Panel>
        </div>

        <Link href="/whats-inside" className={styles.cta}>
          See every signal and every report section
          <span aria-hidden="true"> →</span>
        </Link>
      </div>
    </section>
  );
}

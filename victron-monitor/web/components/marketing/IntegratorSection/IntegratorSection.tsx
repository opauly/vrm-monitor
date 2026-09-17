import { Panel, SectionHead } from '@/components/ui';
import styles from './IntegratorSection.module.css';

// Pauly & Co was accepted into Victron Energy's "Recommended Software
// Integrator" program on 2026-09-01 (Costa Rica) — a real, Victron-reviewed
// credential, not a self-declared badge. Links out to Victron's own public
// announcement rather than rendering any Victron logo/badge graphic here:
// no such asset has been provided yet, and that's a trademark, not
// something to improvise (see IntegratorBadge for the compact version of
// the same claim, in the Hero).
const ANNOUNCEMENT_URL =
  'https://www.victronenergy.com/blog/2024/12/04/introducing-our-new-software-integrator-program/';

const POINTS = [
  {
    title: 'Direct VRM API access',
    body: "VRM Monitor connects straight into Victron's own Remote Monitoring infrastructure through the VRM API — not a scraped feed or a third-party workaround.",
  },
  {
    title: 'Vetted, not self-declared',
    body: 'Victron accepts a limited number of software integrators, reviewed on real project work — not an open badge anyone can claim.',
  },
  {
    title: "Backed by Victron's own network",
    body: "Access to Victron's developer resources, distributor network, and Latin America sales & training team, for every install this platform supports.",
  },
] as const;

export function IntegratorSection() {
  return (
    <section id="integrator" className="band">
      <div className="wrap">
        <SectionHead
          eyebrow="Recognized by Victron Energy"
          lede="Pauly & Co. was accepted into Victron Energy's Recommended Software Integrator Program — Victron's invite-only network for software experts building custom integrations on its own products and VRM API."
        >
          A Victron Recommended Software Integrator
        </SectionHead>

        <div className={styles.grid}>
          {POINTS.map((point) => (
            <Panel key={point.title} variant="card">
              <h3>{point.title}</h3>
              <p className={styles.body}>{point.body}</p>
            </Panel>
          ))}
        </div>

        <a className={styles.link} href={ANNOUNCEMENT_URL} target="_blank" rel="noopener noreferrer">
          Read Victron&apos;s official announcement →
        </a>
      </div>
    </section>
  );
}

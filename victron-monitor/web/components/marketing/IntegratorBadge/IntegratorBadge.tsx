import styles from './IntegratorBadge.module.css';

// Pauly & Co's real acceptance into Victron Energy's "Recommended Software
// Integrator" program (2026-09-01, Costa Rica) — links out to Victron's own
// public announcement as the verifiable source. No Victron-issued badge or
// logo asset exists yet to render here; don't fabricate one, this is a
// trademark, not a decoration to improvise (see IntegratorSection for the
// fuller writeup).
const ANNOUNCEMENT_URL =
  'https://www.victronenergy.com/blog/2024/12/04/introducing-our-new-software-integrator-program/';

export function IntegratorBadge({ className }: { className?: string }) {
  const classes = [styles.badge, className].filter(Boolean).join(' ');
  return (
    <a className={classes} href={ANNOUNCEMENT_URL} target="_blank" rel="noopener noreferrer">
      <span className={styles.dot} aria-hidden="true" />
      Victron Recommended Software Integrator — Costa Rica
    </a>
  );
}

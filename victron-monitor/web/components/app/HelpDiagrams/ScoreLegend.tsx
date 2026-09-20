import styles from './HelpDiagrams.module.css';

// Same 4-tier thresholds/colors every score badge in the app already uses
// (fleet/page.tsx's own healthClass(), vrm.compute_daily_health()'s
// status bands) — restated here as a plain legend, not reimplemented,
// since Help has no live score of its own to color. Shared between the
// customer Dashboard topic and the admin Analytics/VRM Fleet topics.
const BANDS = [
  { label: 'Excellent', range: '90–100', color: 'var(--good)' },
  { label: 'Good', range: '80–89', color: 'var(--victron-glow)' },
  { label: 'Watch', range: '70–79', color: 'var(--signal)' },
  { label: 'Attention', range: '< 70', color: '#e37b7b' },
] as const;

export function ScoreLegend() {
  return (
    <div className={styles.legendRow} role="img" aria-label="Score bands: 90 to 100 is Excellent, 80 to 89 is Good, 70 to 79 is Watch, and below 70 is Attention.">
      {BANDS.map((band) => (
        <span className={styles.legendChip} key={band.label}>
          <span className={styles.legendSwatch} style={{ background: band.color }} aria-hidden="true" />
          {band.label} ({band.range})
        </span>
      ))}
    </div>
  );
}

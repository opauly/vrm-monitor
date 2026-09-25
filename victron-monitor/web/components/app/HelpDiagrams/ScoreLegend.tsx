import { t, type Lang } from '@/lib/i18n/strings';
import styles from './HelpDiagrams.module.css';

// Same 4-tier thresholds/colors every score badge in the app already uses
// (fleet/page.tsx's own healthClass(), vrm.compute_daily_health()'s
// status bands) — restated here as a plain legend, not reimplemented,
// since Help has no live score of its own to color. Shared between the
// customer Dashboard topic and the admin Analytics/VRM Fleet topics.
function bands(lang: Lang) {
  return [
    { labelKey: 'help_legend_excellent', range: '90–100', color: 'var(--good)' },
    { labelKey: 'help_legend_good', range: '80–89', color: 'var(--victron-glow)' },
    { labelKey: 'help_legend_watch', range: '70–79', color: 'var(--signal)' },
    { labelKey: 'help_legend_attention', range: '< 70', color: '#e37b7b' },
  ].map((b) => ({ ...b, label: t(lang, b.labelKey as Parameters<typeof t>[1]) }));
}

export function ScoreLegend({ lang = 'en' }: { lang?: Lang }) {
  return (
    <div className={styles.legendRow} role="img" aria-label={t(lang, 'help_legend_aria')}>
      {bands(lang).map((band) => (
        <span className={styles.legendChip} key={band.labelKey}>
          <span className={styles.legendSwatch} style={{ background: band.color }} aria-hidden="true" />
          {band.label} ({band.range})
        </span>
      ))}
    </div>
  );
}

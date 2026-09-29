import { Eyebrow, Gauge, Panel, Stat } from '@/components/ui';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './Readout.module.css';

// The hero's "instrument readout" module — landing_template.html's
// .readout, with real (synthetic) sample numbers standing in for a live
// site. Listed as its own component in PLAN_PHASE14.md §1.7 rather than
// folded into Hero, since it is exactly the shape the customer dashboard's
// KPI readout reuses later (Steps 4/6) — a real usage of the "extract
// components/ui/* from the marketing markup first" ordering that §1.7
// argues for.
export function Readout({ lang }: { lang: Lang }) {
  return (
    <Panel variant="readout" hairline role="img" aria-label={t(lang, 'marketing_readout_aria')}>
      <div className={styles.head}>
        <span className={styles.site}>
          {t(lang, 'marketing_readout_site_label')} <b>· {t(lang, 'marketing_readout_period')}</b>
        </span>
        <Eyebrow amber className={styles.liveEyebrow}>
          {t(lang, 'marketing_readout_live')}
        </Eyebrow>
      </div>
      <div className={styles.stats}>
        <Stat label={t(lang, 'marketing_readout_stat_health')} value={84} unit={t(lang, 'marketing_readout_stat_health_unit')} good />
        <Stat label={t(lang, 'marketing_readout_stat_solar')} value={429} unit="kWh" />
        <Stat label={t(lang, 'marketing_readout_stat_independence')} value={96.1} unit="%" />
        <Stat label={t(lang, 'marketing_readout_stat_alarms')} value={3} unit={t(lang, 'marketing_readout_stat_alarms_unit')} />
      </div>
      <p className={styles.narr}>&quot;{t(lang, 'marketing_readout_narrative')}&quot;</p>

      {/* Added 2026-09-05 (Oscar's request, seeing the real per-site
         dashboard's own gauge card) — the readout was all report numbers;
         this row is what the LIVE half of the new "Your system, live"
         headline actually looks like. Same colors the real page uses:
         self-sufficiency/good, self-consumption/victron-glow, depth of
         discharge/signal (admin/fleet/[site_id]/page.tsx's own Gauge
         color choices). */}
      <div className={styles.gaugeRow}>
        <Gauge pct={96.3} color="var(--good)" label={t(lang, 'marketing_readout_gauge_self_sufficiency')} compact />
        <Gauge pct={91} color="var(--victron-glow)" label={t(lang, 'marketing_readout_gauge_self_consumption')} compact />
        <Gauge pct={42} color="var(--signal)" label={t(lang, 'marketing_readout_gauge_dod')} compact />
      </div>
    </Panel>
  );
}

'use client';

// This week / This month toggle for the per-site drill-down's stats panel.
// No fetch on toggle — unlike ShapeChart's Today/7-day/30-day (real VRM API
// calls, genuinely expensive to redo per click), both windows here are
// cheap SQL sums already computed server-side in
// `lib/server/db/admin.ts:getFleetOverview()` and handed down as props;
// switching is just picking which of the two to render.
import { useState } from 'react';
import type { BatteryStress, PeriodIndicators } from '@/lib/server/db/fleetOverviewCore';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './[site_id]/site.module.css';

type Period = 'week' | 'month';

function stressLabel(stress: BatteryStress, lang: Lang): string {
  if (stress === 'high_stress') return t(lang, 'admin_fleet_stress_high');
  if (stress === 'working_hard') return t(lang, 'admin_fleet_stress_working');
  if (stress === 'no_data') return t(lang, 'admin_fleet_stress_no_data');
  return t(lang, 'admin_fleet_stress_normal');
}

export function PeriodStatsPanel({ week, month, lang }: { week: PeriodIndicators; month: PeriodIndicators; lang: Lang }) {
  const [period, setPeriod] = useState<Period>('week');
  const d = period === 'week' ? week : month;

  return (
    <div className={styles.weekCard}>
      <div className={styles.weekCardHead}>
        <h2>{period === 'week' ? t(lang, 'admin_fleet_period_this_week') : t(lang, 'admin_fleet_period_this_month')}</h2>
        <div className={styles.periodToggle} role="tablist">
          <button
            type="button"
            className={period === 'week' ? styles.periodBtnActive : styles.periodBtn}
            onClick={() => setPeriod('week')}
          >
            {t(lang, 'admin_fleet_period_week')}
          </button>
          <button
            type="button"
            className={period === 'month' ? styles.periodBtnActive : styles.periodBtn}
            onClick={() => setPeriod('month')}
          >
            {t(lang, 'admin_fleet_period_month')}
          </button>
        </div>
      </div>
      <div className={styles.cardSub}>
        {t(lang, 'admin_fleet_period_sub_1')} {period === 'week' ? '7' : '30'} {t(lang, 'admin_fleet_period_sub_2')}{' '}
        <code>vrm.energy_daily</code> {t(lang, 'admin_fleet_period_sub_3')}
      </div>
      <div className={styles.weekStats}>
        <div className={styles.weekStat}>
          <span className={styles.weekStatLabel}>{t(lang, 'admin_fleet_stat_battery_cycles')}</span>
          <span className={styles.weekStatValue}>{d.batteryCycles ?? '—'}</span>
          <span className={`${styles.stressBadge} ${styles[`stress_${d.batteryStress}`]}`}>
            {stressLabel(d.batteryStress, lang)}
          </span>
          {d.batteryCyclesEstimated && (
            <span className={styles.weekStatSub}>{t(lang, 'admin_fleet_stat_battery_estimated')}</span>
          )}
        </div>
        <div className={styles.weekStat}>
          <span className={styles.weekStatLabel}>{t(lang, 'admin_fleet_stat_outages')}</span>
          <span className={styles.weekStatValue}>
            {/* `d.daysWithData === 0` means no energy_daily rows exist in this
                window at all (e.g. a site that stopped syncing weeks ago) —
                "0" there would misreport "no outages" as fact when it's
                really "no data," the same distinction every other stat in
                this panel already makes. */}
            {d.daysWithData === 0 ? '—' : d.outageCount > 0 ? `${d.outageCount} (${d.outageMinutes} min)` : '0'}
          </span>
        </div>
        <div className={styles.weekStat}>
          <span className={styles.weekStatLabel}>{t(lang, 'admin_fleet_stat_soc_range')}</span>
          <span className={styles.weekStatValue}>
            {d.minSoc !== null && d.maxSoc !== null ? `${d.minSoc}–${d.maxSoc}%` : '—'}
          </span>
          {d.avgSoc !== null && <span className={styles.weekStatSub}>{t(lang, 'admin_fleet_stat_avg').replace('{pct}', String(d.avgSoc))}</span>}
        </div>
        <div className={styles.weekStat}>
          <span className={styles.weekStatLabel}>{t(lang, 'admin_fleet_stat_days_self_sufficient')}</span>
          <span className={styles.weekStatValue}>{d.daysWithData > 0 ? `${d.daysSelfSufficient} / ${d.daysWithData}` : '—'}</span>
        </div>
      </div>
    </div>
  );
}

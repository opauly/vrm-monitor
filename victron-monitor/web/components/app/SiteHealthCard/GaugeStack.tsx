import { Gauge } from '@/app/(admin)/admin/fleet/Gauge';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import styles from './SiteHealthCard.module.css';

// The three energy-source gauges. Pure presentation (usable from server and
// client components). The third shows the battery's LOWEST state of charge in the
// period (stored as depth of discharge = 100 minus it, hence `dod`); `dodScope`
// only changes the wording — what time frame "lowest" refers to.

export type Gauges = { selfSufficiency: number | null; selfConsumption: number | null; dod: number | null };
export type DodScope = 'day' | 'average' | 'today';

const SOC_KEY: Record<DodScope, StringKey> = {
  day: 'gauge_soc_latest',
  average: 'gauge_soc_avg',
  today: 'gauge_soc_today',
};

export function GaugeStack({ lang, gauges, dodScope }: { lang: Lang; gauges: Gauges; dodScope: DodScope }) {
  const missing = t(lang, 'admin_fleetsite_gauge_not_enough_data');
  const low = gauges.dod === null ? null : Math.round((100 - gauges.dod) * 10) / 10;
  return (
    <div className={styles.gauges}>
      <Gauge
        pct={gauges.selfSufficiency}
        color="var(--good)"
        label={t(lang, 'admin_fleet_card_self_sufficiency_label')}
        desc={gauges.selfSufficiency === null ? missing : t(lang, 'admin_fleetsite_gauge_self_suff_desc').replace('{pct}', String(gauges.selfSufficiency))}
      />
      <Gauge
        pct={gauges.selfConsumption}
        color="var(--victron-glow)"
        label={t(lang, 'admin_fleet_card_self_consumption_label')}
        desc={gauges.selfConsumption === null ? missing : t(lang, 'admin_fleetsite_gauge_self_cons_desc').replace('{pct}', String(gauges.selfConsumption))}
      />
      <Gauge
        pct={low}
        color="var(--signal)"
        label={t(lang, 'gauge_soc_label')}
        desc={low === null ? missing : t(lang, SOC_KEY[dodScope]).replace('{low}', String(low))}
      />
    </div>
  );
}

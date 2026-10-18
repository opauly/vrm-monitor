'use client';

import { PeriodPane, PeriodSwitch, useToday } from '@/components/app/PeriodView/PeriodView';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import styles from './EnergyCard.module.css';

// The site page's Energy card. Today is live — the day so far, from the shared
// "today" fetch in PeriodProvider (the same hour-by-hour VRM data the Site shape
// chart draws, so it loads on demand); 7 and 30 days are per-day averages from
// the stored daily totals.

export type EnergyTotals = { pv: number | null; load: number | null; gridImport: number | null; gridExport: number | null };

const ROWS: { field: keyof EnergyTotals; label: StringKey }[] = [
  { field: 'pv', label: 'site_live_energy_solar' },
  { field: 'load', label: 'site_live_energy_load' },
  { field: 'gridImport', label: 'site_live_energy_import' },
  { field: 'gridExport', label: 'site_live_energy_export' },
];

// An off-grid site has no grid: what comes in through its AC input is a generator, and nothing can be sent back.
function rowsFor(totals: EnergyTotals, generator: boolean) {
  return ROWS.filter((row) => totals[row.field] !== null && !(generator && row.field === 'gridExport')).map((row) =>
    generator && row.field === 'gridImport' ? { ...row, label: 'site_live_energy_import_generator' as StringKey } : row,
  );
}

function Totals({ lang, totals, generator }: { lang: Lang; totals: EnergyTotals; generator: boolean }) {
  const rows = rowsFor(totals, generator);
  if (rows.length === 0) return <div className={styles.note}>{t(lang, 'site_energy_none')}</div>;
  return (
    <div className={styles.grid}>
      {rows.map((row) => (
        <div key={row.field}>
          <div className={styles.value}>
            {(totals[row.field] as number).toFixed(1)} <span className={styles.unit}>kWh</span>
          </div>
          <div className={styles.note}>{t(lang, row.label)}</div>
        </div>
      ))}
    </div>
  );
}

export function EnergyCard({ lang, week, month, generator = false }: { lang: Lang; week: EnergyTotals; month: EnergyTotals; generator?: boolean }) {
  const today = useToday();
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <div className={styles.label}>{t(lang, 'site_live_energy_title')}</div>
        <PeriodSwitch lang={lang} />
      </div>
      <PeriodPane period="today">
        <div className={styles.note}>{t(lang, 'site_energy_sub_today')}</div>
        {today.status === 'loading' ? (
          <div className={styles.note}>{t(lang, 'site_energy_loading')}</div>
        ) : today.status === 'error' ? (
          <div className={styles.note}>{t(lang, 'site_energy_unavailable')}</div>
        ) : (
          <Totals lang={lang} totals={today.totals} generator={generator} />
        )}
      </PeriodPane>
      <PeriodPane period="week">
        <div className={styles.note}>{t(lang, 'site_energy_sub_week')}</div>
        <Totals lang={lang} totals={week} generator={generator} />
      </PeriodPane>
      <PeriodPane period="month">
        <div className={styles.note}>{t(lang, 'site_energy_sub_month')}</div>
        <Totals lang={lang} totals={month} generator={generator} />
      </PeriodPane>
    </div>
  );
}

'use client';

import { PeriodPane, PeriodSwitch, useToday } from '@/components/app/PeriodView/PeriodView';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import styles from './EnergyCard.module.css';

// The site page's Energy card. Today is live — the day so far, from the shared
// "today" fetch in PeriodProvider (the same hour-by-hour VRM data the Site shape
// chart draws, so it loads on demand); 7 and 30 days are per-day averages from
// the stored daily totals.

/** Highest load (W) in a window, with the day it happened (stored days only; "today" has no date). */
export type PeakLoad = { w: number | null; date?: string | null };

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

function dayLabel(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'es' ? 'es-CR' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

// The window's highest load, as kW.
// It is the peak of 15-minute averages, so it can understate a short spike — the sub-line says so.
function Peak({ lang, peak, today }: { lang: Lang; peak: PeakLoad; today?: boolean }) {
  if (peak.w === null) return null;
  const kw = peak.w / 1000;
  const sub =
    today || !peak.date
      ? t(lang, 'site_live_energy_peak_sub_today')
      : t(lang, 'site_live_energy_peak_sub_period').replace('{date}', dayLabel(peak.date, lang));
  return (
    <div className={styles.peak}>
      <div className={styles.value}>
        {kw.toFixed(1)} <span className={styles.unit}>kW</span>
      </div>
      <div className={styles.note}>{t(lang, 'site_live_energy_peak')}</div>
      <div className={styles.note}>{sub}</div>
    </div>
  );
}

export function EnergyCard({
  lang,
  week,
  month,
  generator = false,
  weekPeak = { w: null },
  monthPeak = { w: null },
}: {
  lang: Lang;
  week: EnergyTotals;
  month: EnergyTotals;
  generator?: boolean;
  weekPeak?: PeakLoad;
  monthPeak?: PeakLoad;
}) {
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
          <>
            <Totals lang={lang} totals={today.totals} generator={generator} />
            <Peak lang={lang} peak={{ w: today.totals.peakLoadW }} today />
          </>
        )}
      </PeriodPane>
      <PeriodPane period="week">
        <div className={styles.note}>{t(lang, 'site_energy_sub_week')}</div>
        <Totals lang={lang} totals={week} generator={generator} />
        <Peak lang={lang} peak={weekPeak} />
      </PeriodPane>
      <PeriodPane period="month">
        <div className={styles.note}>{t(lang, 'site_energy_sub_month')}</div>
        <Totals lang={lang} totals={month} generator={generator} />
        <Peak lang={lang} peak={monthPeak} />
      </PeriodPane>
    </div>
  );
}

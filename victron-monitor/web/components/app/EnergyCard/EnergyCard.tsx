'use client';

import { useEffect, useRef, useState } from 'react';
import { PeriodPane, PeriodSwitch, usePeriod } from '@/components/app/PeriodView/PeriodView';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import styles from './EnergyCard.module.css';

// The site page's Energy card. Today is live — the day so far, added up from
// the same hour-by-hour VRM data the Site shape chart draws (so it loads on
// demand, like that chart); 7 and 30 days are per-day averages from the stored
// daily totals.

export type EnergyTotals = { pv: number | null; load: number | null; gridImport: number | null; gridExport: number | null };

type ShapeData = { solar: (number | null)[]; load: (number | null)[]; grid: (number | null)[] };

const sumKwh = (values: (number | null)[], pick: (v: number) => number = (v) => v): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((total, v) => total + pick(v), 0) / 1000; // hourly average W ≈ Wh in that hour
};

function fromShape(shape: ShapeData): EnergyTotals {
  return {
    pv: sumKwh(shape.solar),
    load: sumKwh(shape.load),
    gridImport: sumKwh(shape.grid, (v) => Math.max(v, 0)),
    gridExport: sumKwh(shape.grid, (v) => Math.max(-v, 0)),
  };
}

const ROWS: { field: keyof EnergyTotals; label: StringKey }[] = [
  { field: 'pv', label: 'site_live_energy_solar' },
  { field: 'load', label: 'site_live_energy_load' },
  { field: 'gridImport', label: 'site_live_energy_import' },
  { field: 'gridExport', label: 'site_live_energy_export' },
];

function Totals({ lang, totals }: { lang: Lang; totals: EnergyTotals }) {
  const rows = ROWS.filter((row) => totals[row.field] !== null);
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

export function EnergyCard({
  lang,
  siteId,
  apiBasePath,
  week,
  month,
}: {
  lang: Lang;
  siteId: string;
  /** Where `site-shape` lives for this audience (admin vs customer routes). */
  apiBasePath: string;
  week: EnergyTotals;
  month: EnergyTotals;
}) {
  const period = usePeriod();
  const [today, setToday] = useState<EnergyTotals | 'loading' | 'error'>('loading');
  const requested = useRef(false);

  // Today is only fetched once someone looks at it.
  useEffect(() => {
    if (period !== 'today' || requested.current) return;
    requested.current = true;
    fetch(`${apiBasePath}/site-shape?siteId=${encodeURIComponent(siteId)}&range=today`)
      .then((r) => (r.ok ? (r.json() as Promise<ShapeData>) : Promise.reject(new Error('fetch failed'))))
      .then((shape) => setToday(fromShape(shape)))
      .catch(() => setToday('error'));
  }, [period, apiBasePath, siteId]);

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <div className={styles.label}>{t(lang, 'site_live_energy_title')}</div>
        <PeriodSwitch lang={lang} />
      </div>
      <PeriodPane period="today">
        <div className={styles.note}>{t(lang, 'site_energy_sub_today')}</div>
        {today === 'loading' ? (
          <div className={styles.note}>{t(lang, 'site_energy_loading')}</div>
        ) : today === 'error' ? (
          <div className={styles.note}>{t(lang, 'site_energy_unavailable')}</div>
        ) : (
          <Totals lang={lang} totals={today} />
        )}
      </PeriodPane>
      <PeriodPane period="week">
        <div className={styles.note}>{t(lang, 'site_energy_sub_week')}</div>
        <Totals lang={lang} totals={week} />
      </PeriodPane>
      <PeriodPane period="month">
        <div className={styles.note}>{t(lang, 'site_energy_sub_month')}</div>
        <Totals lang={lang} totals={month} />
      </PeriodPane>
    </div>
  );
}

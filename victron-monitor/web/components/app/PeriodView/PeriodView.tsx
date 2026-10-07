'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { t, type Lang } from '@/lib/i18n/strings';
import { todayTotals, type ShapeToday, type TodayTotals } from '@/lib/todayTotals';
import styles from './PeriodView.module.css';

// One Today / 7 days / 30 days choice shared by every card on a site page that
// has something to say per period (the scores card, the Energy card): flip it
// on one and the others follow. The cards stay server-rendered — each hands its
// per-period content to a <PeriodPane>, and this only decides which one shows.

export type Period = 'today' | 'week' | 'month';

export type TodayState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; totals: TodayTotals };

type PeriodContextValue = { period: Period; setPeriod: (next: Period) => void; today: TodayState };

const PeriodContext = createContext<PeriodContextValue | null>(null);

/**
 * `siteId` + `apiBasePath` let the cards read "so far today" once, from the same
 * hour-by-hour VRM data the Site shape chart draws (loaded on demand, the first
 * time Today is showing) — the Energy card and the gauges share that one fetch.
 */
export function PeriodProvider({ children, siteId, apiBasePath }: { children: ReactNode; siteId: string; apiBasePath: string }) {
  const [period, setPeriod] = useState<Period>('today');
  const [today, setToday] = useState<TodayState>({ status: 'loading' });
  const requested = useRef(false);

  useEffect(() => {
    if (period !== 'today' || requested.current) return;
    requested.current = true;
    fetch(`${apiBasePath}/site-shape?siteId=${encodeURIComponent(siteId)}&range=today`)
      .then((r) => (r.ok ? (r.json() as Promise<ShapeToday>) : Promise.reject(new Error('fetch failed'))))
      .then((shape) => setToday({ status: 'ready', totals: todayTotals(shape) }))
      .catch(() => setToday({ status: 'error' }));
  }, [period, apiBasePath, siteId]);

  return <PeriodContext.Provider value={{ period, setPeriod, today }}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): Period {
  return useContext(PeriodContext)?.period ?? 'today';
}

export function useToday(): TodayState {
  return useContext(PeriodContext)?.today ?? { status: 'error' };
}

export function PeriodSwitch({ lang }: { lang: Lang }) {
  const ctx = useContext(PeriodContext);
  if (!ctx) return null;
  const options: { key: Period; label: string }[] = [
    { key: 'today', label: t(lang, 'site_period_today') },
    { key: 'week', label: t(lang, 'site_period_week') },
    { key: 'month', label: t(lang, 'site_period_month') },
  ];
  return (
    <div className={styles.switch} role="group" aria-label={t(lang, 'site_period_label')}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`${styles.option} ${ctx.period === option.key ? styles.active : ''}`}
          aria-pressed={ctx.period === option.key}
          onClick={() => ctx.setPeriod(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PeriodPane({ period, children }: { period: Period; children: ReactNode }) {
  return usePeriod() === period ? <>{children}</> : null;
}

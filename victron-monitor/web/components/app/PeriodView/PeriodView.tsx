'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './PeriodView.module.css';

// One Today / 7 days / 30 days choice shared by every card on a site page that
// has something to say per period (the scores card, the Energy card): flip it
// on one and the others follow. The cards stay server-rendered — each hands its
// per-period content to a <PeriodPane>, and this only decides which one shows.

export type Period = 'today' | 'week' | 'month';

const PeriodContext = createContext<{ period: Period; setPeriod: (next: Period) => void } | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<Period>('today');
  return <PeriodContext.Provider value={{ period, setPeriod }}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): Period {
  return useContext(PeriodContext)?.period ?? 'today';
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

'use client';

import type { ReactNode } from 'react';
import { useToday } from '@/components/app/PeriodView/PeriodView';
import { t, type Lang } from '@/lib/i18n/strings';
import { GaugeStack } from './GaugeStack';
import styles from './SiteHealthCard.module.css';

// The gauges under "Today": figures for the day SO FAR, from the shared live
// fetch (PeriodProvider) — unlike the scores above them, which can only be
// computed once a day is complete. If today's data can't be read, the latest
// scored day's gauges (`fallback`, rendered on the server) stand in, labelled as such.

export function TodayGauges({ lang, fallback }: { lang: Lang; fallback: ReactNode }) {
  const today = useToday();

  if (today.status === 'loading') {
    return (
      <div className={styles.gaugeSection}>
        <div className={styles.caption}>{t(lang, 'score_gauges_today_caption')}</div>
        <div className={styles.sub}>{t(lang, 'score_gauges_loading')}</div>
      </div>
    );
  }
  if (today.status === 'error') {
    return (
      <div className={styles.gaugeSection}>
        <div className={styles.caption}>{t(lang, 'score_gauges_latest_caption')}</div>
        {fallback}
      </div>
    );
  }
  const { totals } = today;
  return (
    <div className={styles.gaugeSection}>
      <div className={styles.caption}>{t(lang, 'score_gauges_today_caption')}</div>
      <GaugeStack
        lang={lang}
        dodScope="today"
        gauges={{ selfSufficiency: totals.selfSufficiencyPct, selfConsumption: totals.selfConsumptionPct, dod: totals.dodPct }}
      />
    </div>
  );
}

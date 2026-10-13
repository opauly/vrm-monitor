'use client';

import { useEffect, useState } from 'react';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import type { ForecastOut } from '@/lib/server/pipeline';
import styles from './ForecastPanel.module.css';

// "Tonight & tomorrow" on a site page: how long the battery should last tonight,
// what tomorrow's weather means for solar, and a few practical tips. Everything
// shown is an ESTIMATE from a weather forecast plus this system's own history
// (see victron/forecast.py) and is labelled so. Fetched client-side because a stale
// forecast is rebuilt on demand; when there is nothing to show (switched off, no
// location for the site, weather unreachable) nothing is rendered.

type Available = Extract<ForecastOut, { available: true }>;
type State = { status: 'loading' } | { status: 'hidden' } | { status: 'ready'; forecast: Available };

const hhmm = (iso: string) => iso.slice(11, 16);
const fill = (text: string, values: Record<string, string | number | null | undefined>) =>
  Object.entries(values).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, v === null || v === undefined ? '—' : String(v)), text);

export function ForecastPanel({ lang, endpoint }: { lang: Lang; endpoint: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    fetch(endpoint)
      .then((r) => (r.ok ? (r.json() as Promise<ForecastOut>) : Promise.reject(new Error('fetch failed'))))
      .then((data) => active && setState(data.available ? { status: 'ready', forecast: data } : { status: 'hidden' }))
      .catch(() => active && setState({ status: 'hidden' }));
    return () => {
      active = false;
    };
  }, [endpoint]);

  if (state.status === 'hidden') return null;
  if (state.status === 'loading') {
    return (
      <section className={styles.card} aria-busy="true">
        <div className={styles.label}>{t(lang, 'forecast_title')}</div>
        <div className={styles.muted}>{t(lang, 'forecast_loading')}</div>
      </section>
    );
  }

  const { forecast } = state;
  const { tomorrow, backup, tomorrow_battery: battery } = forecast;
  const solar = tomorrow.solar;
  const vs = solar?.vs_typical_pct ?? null;
  const updated = new Date(forecast.generated_at).toLocaleTimeString(lang === 'es' ? 'es-CR' : 'en-US', { hour: '2-digit', minute: '2-digit' });

  return (
    <section className={styles.card}>
      <div className={styles.label}>{t(lang, 'forecast_title')}</div>
      <div className={styles.columns}>
        {backup && (
          <div className={styles.block}>
            <div className={styles.blockTitle}>{t(lang, 'forecast_tonight')}</div>
            <div className={`${styles.big} ${backup.reaches_sunrise ? '' : styles.warn}`}>
              {backup.reaches_sunrise
                ? fill(t(lang, 'forecast_backup_ok'), { time: hhmm(backup.until_sunrise), soc: backup.soc_at_sunrise_pct })
                : fill(t(lang, 'forecast_backup_short'), { time: backup.empty_at ? hhmm(backup.empty_at) : '—', hours: backup.hours })}
            </div>
            <div className={styles.muted}>{t(lang, 'forecast_backup_note')}</div>
          </div>
        )}
        <div className={styles.block}>
          <div className={styles.blockTitle}>{t(lang, 'forecast_tomorrow')}</div>
          <div className={styles.big}>
            {tomorrow.sky ? t(lang, `forecast_sky_${tomorrow.sky}` as StringKey) : '—'}
            {tomorrow.temp_max_c !== null ? ` · ${tomorrow.temp_max_c}°C` : ''}
          </div>
          {solar && solar.kwh !== null && (
            <div className={styles.line}>
              {fill(t(lang, 'forecast_solar'), { kwh: solar.kwh, low: solar.low_kwh, high: solar.high_kwh })}
              {vs !== null && (
                <span className={styles.muted}>
                  {' · '}
                  {Math.abs(vs) < 5 ? t(lang, 'forecast_vs_typical') : fill(t(lang, vs < 0 ? 'forecast_vs_below' : 'forecast_vs_above'), { pct: Math.abs(vs) })}
                </span>
              )}
            </div>
          )}
          {battery && (battery.full_by || battery.show_peak) && (
            <div className={styles.line}>
              {battery.full_by ? fill(t(lang, 'forecast_full_by'), { time: hhmm(battery.full_by) }) : fill(t(lang, 'forecast_peak'), { pct: battery.peak_pct })}
            </div>
          )}
        </div>
      </div>

      {forecast.advice.length > 0 && (
        <ul className={styles.advice}>
          {forecast.advice.map((item) => (
            <li key={item.code}>{fill(t(lang, `forecast_advice_${item.code}` as StringKey), item.params)}</li>
          ))}
        </ul>
      )}
      <div className={styles.footer}>
        {t(lang, 'forecast_footer')} · {fill(t(lang, 'forecast_updated'), { time: updated })}
      </div>
    </section>
  );
}

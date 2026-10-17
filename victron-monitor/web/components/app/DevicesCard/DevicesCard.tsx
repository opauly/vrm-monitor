import { deviceName, deviceNote, fill } from '@/lib/deviceText';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import type { SiteAlarmPattern, SiteDevice } from '@/lib/server/db';
import styles from './DevicesCard.module.css';

// "Equipment" on a site page: one table, one row per battery / inverter / solar charger,
// problems first. The checks behind it run in the background on every sweep
// (victron/devices.py); this only shows the result — a dot, one current figure, and a note
// that appears only when something is odd. No devices stored (the SQL not run, or a site VRM
// reports nothing for) renders nothing.

function nowText(lang: Lang, device: SiteDevice): string {
  const m = device.metrics;
  if (device.kind === 'charger') {
    if (m.last_kwh === null || m.last_kwh === undefined) return t(lang, 'devices_now_charger_none');
    return fill(t(lang, 'devices_now_charger_last'), { kwh: m.last_kwh < 1 ? m.last_kwh.toFixed(2) : m.last_kwh.toFixed(1) });
  }
  if (device.kind === 'battery') {
    const online = m.modules_online ?? 0;
    return fill(t(lang, 'devices_now_battery'), { online, total: online + (m.modules_offline ?? 0) });
  }
  const units = m.units ?? 1;
  return units === 1 ? t(lang, 'devices_now_inverter_one') : fill(t(lang, 'devices_now_inverter_many'), { n: units });
}

const PATTERN_CATEGORIES = ['overload', 'temperature', 'high_current', 'low_battery', 'battery_voltage', 'bms', 'grid_input', 'vebus_error', 'internal_failure', 'charger_error'];

// "Inverter overload" + "3 times in the last 14 days · latest Oct 12 · VE.Bus System".
function patternName(lang: Lang, p: SiteAlarmPattern): string {
  const base = PATTERN_CATEGORIES.includes(p.category) ? t(lang, `alarmpat_cat_${p.category}` as StringKey) : p.category;
  return (p.category === 'charger_error' || p.category === 'vebus_error') && p.detail ? `${base} (${p.detail})` : base;
}

function patternSub(lang: Lang, p: SiteAlarmPattern, timeZone: string | null | undefined): string {
  const date = new Date(p.last_at).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric', timeZone: timeZone || undefined });
  return [
    fill(t(lang, 'alarmpat_times'), { n: p.count, days: p.window_days }),
    fill(t(lang, 'alarmpat_latest'), { date }),
    p.active ? t(lang, 'alarmpat_active') : '',
    p.device,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function DevicesCard({ lang, devices, patterns = [], timeZone }: { lang: Lang; devices: SiteDevice[]; patterns?: SiteAlarmPattern[]; timeZone?: string | null }) {
  if (devices.length === 0 && patterns.length === 0) return null;
  const attention = devices.filter((d) => d.status !== 'ok').length;
  const summary = attention === 0 ? t(lang, 'devices_summary_ok') : attention === 1 ? t(lang, 'devices_summary_one') : fill(t(lang, 'devices_summary_many'), { n: attention });

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <div className={styles.title}>{t(lang, 'devices_title')}</div>
        {devices.length > 0 && <div className={`${styles.summary} ${attention > 0 ? styles.summaryWarn : ''}`}>{summary}</div>}
      </div>
      {devices.length > 0 && (
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th aria-hidden="true" />
              <th>{t(lang, 'devices_col_device')}</th>
              <th>{t(lang, 'devices_col_now')}</th>
              <th>{t(lang, 'devices_col_note')}</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.device_key}>
                <td className={styles.dotCell}>
                  <span className={`${styles.dot} ${styles[`dot_${d.status}`]}`} role="img" aria-label={t(lang, `devices_status_${d.status}`)} />
                </td>
                <td>
                  <span className={styles.name}>{deviceName(lang, d.kind, d.metrics.n, d.metrics.of)}</span>
                  {d.label && <span className={styles.model}>{d.label}</span>}
                </td>
                <td className={styles.now}>{nowText(lang, d)}</td>
                <td className={d.status === 'bad' ? styles.noteBad : styles.note}>{d.note ? deviceNote(lang, d.note.code, d.note.params) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {patterns.length > 0 && (
        <div className={styles.patterns}>
          <div className={styles.patternsTitle}>{t(lang, 'alarmpat_title')}</div>
          <div className={styles.patternsHint}>{t(lang, 'alarmpat_hint')}</div>
          <ul className={styles.patternList}>
            {patterns.map((p) => (
              <li key={p.category} className={styles.pattern}>
                <span className={`${styles.dot} ${styles.dot_warn}`} aria-hidden="true" />
                <span>
                  <span className={styles.name}>{patternName(lang, p)}</span>
                  <span className={styles.patternSub}>{patternSub(lang, p, timeZone)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

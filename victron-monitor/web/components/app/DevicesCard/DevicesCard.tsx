import { deviceName, deviceNote, fill } from '@/lib/deviceText';
import { t, type Lang } from '@/lib/i18n/strings';
import type { SiteDevice } from '@/lib/server/db';
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

export function DevicesCard({ lang, devices }: { lang: Lang; devices: SiteDevice[] }) {
  if (devices.length === 0) return null;
  const attention = devices.filter((d) => d.status !== 'ok').length;
  const summary = attention === 0 ? t(lang, 'devices_summary_ok') : attention === 1 ? t(lang, 'devices_summary_one') : fill(t(lang, 'devices_summary_many'), { n: attention });

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <div className={styles.title}>{t(lang, 'devices_title')}</div>
        <div className={`${styles.summary} ${attention > 0 ? styles.summaryWarn : ''}`}>{summary}</div>
      </div>
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
    </section>
  );
}

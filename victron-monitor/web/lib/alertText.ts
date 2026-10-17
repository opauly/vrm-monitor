// Human wording for a fleet alert, shared by `/app/alerts` (and mirrored in
// Python by `vrm_api/alerts_delivery.py:describe()` for the email — same
// sentences, so the app and the inbox never disagree).
import { formatDateTimeInZone } from '@/lib/dates';
import { t, type Lang } from '@/lib/i18n/strings';
import { deviceName, deviceNote } from '@/lib/deviceText';
import type { AlertWithSite } from '@/lib/server/db';

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, String(v)), template);
}

const ALARM_KEYS = ['overload', 'dc_ripple', 'temp_fault', 'cell_imbalance'] as const;
type AlarmKey = (typeof ALARM_KEYS)[number];

export function describeAlert(lang: Lang, alert: AlertWithSite): { title: string; body: string } {
  const site = alert.site_name ?? '';
  const detail = alert.detail ?? {};
  const soc = typeof detail.soc_pct === 'number' ? Math.round(detail.soc_pct) : null;

  switch (alert.kind) {
    case 'site_offline': {
      const lastSeen = typeof detail.last_seen === 'string' ? formatDateTimeInZone(detail.last_seen, alert.site_timezone, 'en-US') : '—';
      return {
        title: fill(t(lang, 'alerts_text_site_offline_title'), { site }),
        body: fill(t(lang, 'alerts_text_site_offline_body'), { since: lastSeen, minutes: typeof detail.minutes_silent === 'number' ? detail.minutes_silent : '—' }),
      };
    }
    case 'grid_outage':
      return {
        title: fill(t(lang, 'alerts_text_grid_outage_title'), { site }),
        body: fill(t(lang, 'alerts_text_grid_outage_body'), {
          soc_phrase: soc === null ? '' : fill(t(lang, 'alerts_text_grid_outage_soc'), { soc }),
        }),
      };
    case 'low_battery': {
      const critical = alert.severity === 'critical';
      return {
        title: fill(t(lang, critical ? 'alerts_text_low_battery_critical_title' : 'alerts_text_low_battery_title'), { site }),
        body: fill(t(lang, critical ? 'alerts_text_low_battery_critical_body' : 'alerts_text_low_battery_body'), { soc: soc ?? '—' }),
      };
    }
    case 'system_alarm': {
      const keys = Array.isArray(detail.alarms) ? (detail.alarms as unknown[]) : [];
      const names = keys.map((k) => ((ALARM_KEYS as readonly string[]).includes(k as string) ? t(lang, `alerts_alarm_${k as AlarmKey}`) : String(k)));
      // Raised from Victron's own alarm log: say when it happened and for how long, not "active".
      const log = detail.overload_log as { at?: string; seconds?: number | null; count?: number } | undefined;
      if (log && typeof log.at === 'string' && keys.length === 1 && keys[0] === 'overload') {
        const count = log.count ?? 1;
        return {
          title: fill(t(lang, 'alerts_text_system_alarm_title'), { site }),
          body: fill(t(lang, 'alerts_text_system_alarm_overload_body'), {
            time: formatDateTimeInZone(log.at, alert.site_timezone, 'en-US'),
            lasted: typeof log.seconds === 'number' ? fill(t(lang, 'alerts_text_system_alarm_overload_lasted'), { seconds: log.seconds }) : '',
            repeats: count > 1 ? fill(t(lang, 'alerts_text_system_alarm_overload_repeats'), { count }) : '',
          }),
        };
      }
      return {
        title: fill(t(lang, 'alerts_text_system_alarm_title'), { site }),
        body: fill(t(lang, 'alerts_text_system_alarm_body'), { alarms: names.join(', ') || '—' }),
      };
    }
    case 'device_fault': {
      const listed = Array.isArray(detail.devices) ? (detail.devices as { kind?: string; code?: string; n?: number; of?: number; params?: Record<string, string | number> }[]) : [];
      const lines = listed
        .map((d) => {
          const note = deviceNote(lang, d.code, d.params);
          return note ? `${deviceName(lang, d.kind ?? '', d.n, d.of)}: ${note}` : '';
        })
        .filter(Boolean);
      const more = typeof detail.count === 'number' ? detail.count - lines.length : 0;
      return {
        title: fill(t(lang, 'alerts_text_device_fault_title'), { site }),
        body: fill(t(lang, 'alerts_text_device_fault_body'), { devices: (lines.join(' ') || '—') + (more > 0 ? ` (+${more})` : '') }),
      };
    }
    case 'generator_use':
      return {
        title: fill(t(lang, 'alerts_text_generator_use_title'), { site }),
        body: fill(t(lang, 'alerts_text_generator_use_body'), { soc_phrase: soc === null ? '' : fill(t(lang, 'alerts_text_generator_use_soc'), { soc }) }),
      };
    case 'vrm_link_broken':
      return { title: t(lang, 'alerts_text_vrm_link_broken_title'), body: t(lang, 'alerts_text_vrm_link_broken_body') };
  }
}

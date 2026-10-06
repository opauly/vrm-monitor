// Human wording for a fleet alert, shared by `/app/alerts` (and mirrored in
// Python by `vrm_api/alerts_delivery.py:describe()` for the email — same
// sentences, so the app and the inbox never disagree).
import { formatDateTimeInZone } from '@/lib/dates';
import { t, type Lang } from '@/lib/i18n/strings';
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
      return {
        title: fill(t(lang, 'alerts_text_system_alarm_title'), { site }),
        body: fill(t(lang, 'alerts_text_system_alarm_body'), { alarms: names.join(', ') || '—' }),
      };
    }
    case 'vrm_link_broken':
      return { title: t(lang, 'alerts_text_vrm_link_broken_title'), body: t(lang, 'alerts_text_vrm_link_broken_body') };
  }
}

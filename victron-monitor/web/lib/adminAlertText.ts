// Human wording for an admin fleet-health alert, shown on `/admin/fleet/alerts`
// and mirrored in Python (`victron/email_i18n.py` admin_alert_* keys, used by
// the email and the push) — same sentences, so the page and the inbox agree.
import { t, type Lang } from '@/lib/i18n/strings';
import type { AdminAlert } from '@/lib/server/db';

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, String(v)), template);
}

const num = (value: unknown) => (typeof value === 'number' ? value : '—');

export function describeAdminAlert(lang: Lang, alert: AdminAlert): { title: string; body: string } {
  const d = alert.detail ?? {};
  switch (alert.kind) {
    case 'fleet_offline':
      return {
        title: fill(t(lang, 'admin_alerts_fleet_offline_title'), { offline: num(d.offline), total: num(d.total) }),
        body: fill(t(lang, 'admin_alerts_fleet_offline_body'), {
          sites: Array.isArray(d.sites) ? (d.sites as unknown[]).map(String).join(', ') || '—' : '—',
        }),
      };
    case 'fetch_failing':
      return {
        title: fill(t(lang, 'admin_alerts_fetch_failing_title'), { failed: num(d.failed), attempted: num(d.attempted) }),
        body: fill(t(lang, 'admin_alerts_fetch_failing_body'), { failed: num(d.failed), attempted: num(d.attempted) }),
      };
    case 'sweep_stale':
      return { title: t(lang, 'admin_alerts_sweep_stale_title'), body: fill(t(lang, 'admin_alerts_sweep_stale_body'), { minutes: num(d.minutes_ago) }) };
    case 'history_stale':
      return {
        title: t(lang, 'admin_alerts_history_stale_title'),
        body: fill(t(lang, 'admin_alerts_history_stale_body'), { day: typeof d.newest_day === 'string' ? d.newest_day : '—', days: num(d.days_behind) }),
      };
  }
}

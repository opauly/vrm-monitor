import 'server-only';

// Customer-scoped reads/writes for `/app/alerts` (fleet alerts, Phase 3).
// Every function takes `customerId` from the session — never from the client.
// The alerts themselves are written by the Python sweep, not here: this module
// only reads them and saves the customer's own preferences.
//
// Tolerates the tables not existing yet (SQL not run): reads return "nothing /
// defaults" so deploying the web app ahead of the migration cannot break
// every page that calls `countOpenAlerts()` (the nav badge, on every /app
// page). A SAVE against a missing table still fails loudly.
import { getSupabaseAdmin } from '@/lib/server/supabase';
import type { AlertKind, AlertPreference, AlertRecord, AlertWithSite } from './types';

export const ALERT_KINDS: readonly AlertKind[] = ['site_offline', 'grid_outage', 'low_battery', 'system_alarm', 'vrm_link_broken'];

const DEFAULT_PREFERENCE: AlertPreference = { enabled: true, email: true };

// 42P01 = Postgres "undefined_table"; PGRST205 = PostgREST "not in schema cache".
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

async function attachSites(customerId: string, alerts: AlertRecord[]): Promise<AlertWithSite[]> {
  const siteIds = [...new Set(alerts.map((a) => a.site_id).filter((id): id is string => !!id))];
  const sites = new Map<string, { display_name: string; timezone: string | null }>();
  if (siteIds.length > 0) {
    const { data, error } = await getSupabaseAdmin()
      .schema('vrm')
      .from('sites')
      .select('site_id, display_name, timezone')
      .eq('customer_id', customerId)
      .in('site_id', siteIds);
    if (error) throw error;
    for (const s of data ?? []) sites.set(s.site_id as string, { display_name: s.display_name as string, timezone: (s.timezone as string | null) ?? null });
  }
  return alerts.map((a) => ({
    ...a,
    site_name: a.site_id ? (sites.get(a.site_id)?.display_name ?? a.site_id) : null,
    site_timezone: a.site_id ? (sites.get(a.site_id)?.timezone ?? null) : null,
  }));
}

/** Open alerts, most severe then most recent first. */
export async function listOpenAlerts(customerId: string): Promise<AlertWithSite[]> {
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('alerts')
    .select('id, customer_id, site_id, kind, severity, status, opened_at, resolved_at, detail')
    .eq('customer_id', customerId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  const rows = (data ?? []) as AlertRecord[];
  rows.sort((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical'));
  return attachSites(customerId, rows);
}

/** Alerts resolved within the last `days` days, newest first. */
export async function listRecentResolvedAlerts(customerId: string, days = 14, limit = 30): Promise<AlertWithSite[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('alerts')
    .select('id, customer_id, site_id, kind, severity, status, opened_at, resolved_at, detail')
    .eq('customer_id', customerId)
    .eq('status', 'resolved')
    .gte('resolved_at', since)
    .order('resolved_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return attachSites(customerId, (data ?? []) as AlertRecord[]);
}

/** Number of open alerts — the nav badge. Never throws: a badge is not worth
 * breaking a page over. */
export async function countOpenAlerts(customerId: string): Promise<number> {
  try {
    const { count, error } = await getSupabaseAdmin()
      .schema('vrm')
      .from('alerts')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('status', 'open');
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** One entry per kind; kinds with no saved row get the defaults (everything on). */
export async function getAlertPreferences(customerId: string): Promise<Record<AlertKind, AlertPreference>> {
  const result = Object.fromEntries(ALERT_KINDS.map((k) => [k, { ...DEFAULT_PREFERENCE }])) as Record<AlertKind, AlertPreference>;
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('alert_preferences')
    .select('kind, enabled, email')
    .eq('customer_id', customerId);
  if (error) {
    if (isMissingTable(error)) return result;
    throw error;
  }
  for (const row of data ?? []) {
    if ((ALERT_KINDS as readonly string[]).includes(row.kind as string)) {
      result[row.kind as AlertKind] = { enabled: row.enabled as boolean, email: row.email as boolean };
    }
  }
  return result;
}

/** Saves every kind in one upsert (the form always submits all five). */
export async function saveAlertPreferences(customerId: string, prefs: Record<AlertKind, AlertPreference>): Promise<void> {
  const now = new Date().toISOString();
  const rows = ALERT_KINDS.map((kind) => ({
    customer_id: customerId,
    kind,
    enabled: prefs[kind].enabled,
    email: prefs[kind].email,
    updated_at: now,
  }));
  const { error } = await getSupabaseAdmin().schema('vrm').from('alert_preferences').upsert(rows, { onConflict: 'customer_id,kind' });
  if (error) throw error;
}

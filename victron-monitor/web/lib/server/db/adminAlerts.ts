import 'server-only';

// Reads of `vrm.admin_alerts` — the admin's fleet-health alerts, written by the
// Python sweep / watchdog (`vrm_api/admin_alerts.py`). Admin pages only.
//
// Like the customer alert reads, these tolerate the table not existing yet (SQL
// not run) by returning nothing, so deploying ahead of the migration cannot
// break /admin/fleet.
import { getSupabaseAdmin } from '@/lib/server/supabase';
import type { AdminAlert } from './types';

const COLUMNS = 'id, kind, severity, status, opened_at, resolved_at, detail';

function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

/** Open fleet-health alerts, most severe then most recent first. */
export async function listOpenAdminAlerts(): Promise<AdminAlert[]> {
  const { data, error } = await getSupabaseAdmin().schema('vrm').from('admin_alerts').select(COLUMNS).eq('status', 'open');
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return ((data ?? []) as AdminAlert[]).sort(
    (a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical') || b.opened_at.localeCompare(a.opened_at),
  );
}

/** Fleet-health alerts that cleared in the last `days`, newest first. */
export async function listRecentResolvedAdminAlerts(days = 14, limit = 20): Promise<AdminAlert[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('admin_alerts')
    .select(COLUMNS)
    .eq('status', 'resolved')
    .gte('resolved_at', since)
    .order('resolved_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as AdminAlert[];
}

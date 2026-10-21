import 'server-only';

// The heads-ups and tips the sweep sent (`vrm.insight_notices`), for the "Insights" tab on the alerts page: a push or an email says
// "6 insights about your systems" and this is where to read them. Read-only here; the Python sweep writes them, with their wording
// in both languages (`text`). Tolerates the table or the `text` column not existing yet.
import { getSupabaseAdmin } from '@/lib/server/supabase';

export type InsightNoticeRecord = {
  id: number;
  site_id: string | null;
  kind: string;
  severity: 'ok' | 'warning';
  detail: Record<string, unknown>;
  created_at: string;
  text: { en?: { title: string; body: string }; es?: { title: string; body: string } } | null;
  site_name: string | null;
  site_timezone: string | null;
};

function isMissing(error: { code?: string } | null): boolean {
  return ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error?.code ?? '');
}

export async function listRecentInsightNotices(customerId: string, days = 14, limit = 80): Promise<InsightNoticeRecord[]> {
  const db = getSupabaseAdmin().schema('vrm');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const run = (columns: string) => db.from('insight_notices').select(columns).eq('customer_id', customerId).gte('created_at', since).order('created_at', { ascending: false }).limit(limit);
  let { data, error } = await run('id, site_id, kind, severity, detail, created_at, text');
  if (error && isMissing(error)) ({ data, error } = await run('id, site_id, kind, severity, detail, created_at'));
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const rows = (data ?? []) as unknown as Omit<InsightNoticeRecord, 'site_name' | 'site_timezone' | 'text'>[] & { text?: InsightNoticeRecord['text'] }[];
  const siteIds = [...new Set(rows.map((r) => r.site_id).filter((id): id is string => !!id))];
  const sites = new Map<string, { display_name: string; timezone: string | null }>();
  if (siteIds.length > 0) {
    const { data: siteRows } = await db.from('sites').select('site_id, display_name, timezone').eq('customer_id', customerId).in('site_id', siteIds);
    for (const s of siteRows ?? []) sites.set(s.site_id as string, { display_name: s.display_name as string, timezone: (s.timezone as string | null) ?? null });
  }
  return rows.map((r) => ({
    ...(r as InsightNoticeRecord),
    text: (r as { text?: InsightNoticeRecord['text'] }).text ?? null,
    site_name: r.site_id ? (sites.get(r.site_id)?.display_name ?? r.site_id) : null,
    site_timezone: r.site_id ? (sites.get(r.site_id)?.timezone ?? null) : null,
  }));
}

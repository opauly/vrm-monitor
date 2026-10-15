import 'server-only';

// One site's equipment for the "Equipment" card on the site pages. Written by the
// Python refresh sweep; read-only here. The caller has already authorised the site
// (admin, or the customer who owns it), so this takes a plain site id. A missing table
// (SQL not run yet) reads as "no devices" so the page simply omits the card.
import { getSupabaseAdmin } from '@/lib/server/supabase';
import type { SiteDevice } from './types';

const KIND_ORDER = { charger: 0, battery: 1, inverter: 2 } as const;
const STATUS_ORDER = { bad: 0, warn: 1, ok: 2 } as const;

export async function getSiteDevices(siteId: string): Promise<SiteDevice[]> {
  const { data, error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('site_devices')
    .select('device_key, kind, label, status, note, metrics, last_seen')
    .eq('site_id', siteId);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return [];
    throw error;
  }
  const rows = (data ?? []) as SiteDevice[];
  // Problems first, then chargers, battery, inverter, each in its own numbering.
  return rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.metrics.n ?? 0) - (b.metrics.n ?? 0),
  );
}

// One summary per property for the all-sites view, from the rows the fleet overview already built. Pure: no database.
import type { FleetOverviewRow } from '@/lib/server/db';

export type PropertySummary = {
  /** `null` = the sites not in any property. */
  id: string | null;
  name: string;
  siteCount: number;
  online: number;
  /** Lowest System score among its sites with one, or null. */
  lowestScore: number | null;
  /** Open alarms, anomalies and equipment problems across its sites. */
  attention: number;
  /** Live solar power right now, W, over its online sites; null when none reported. */
  pvNowW: number | null;
  /** Sum of the sites' latest SoC readings averaged, or null. */
  avgSoc: number | null;
};

export function summariseProperties(
  sites: FleetOverviewRow[],
  properties: { id: string; name: string }[],
  propertyOf: Record<string, string>,
): PropertySummary[] {
  const buckets = new Map<string | null, FleetOverviewRow[]>();
  for (const p of properties) buckets.set(p.id, []);
  for (const s of sites) {
    const id = propertyOf[s.site_id];
    const key = id && buckets.has(id) ? id : null;
    buckets.set(key, [...(buckets.get(key) ?? []), s]);
  }
  const out: PropertySummary[] = [];
  for (const [id, rows] of buckets) {
    if (rows.length === 0) continue;
    const online = rows.filter((r) => r.connection_status === 'online');
    const scores = rows.map((r) => r.system_score).filter((v): v is number => v !== null);
    const pv = online.map((r) => r.live_pv_power_w).filter((v): v is number => v !== null);
    const soc = online.map((r) => r.live_soc_pct).filter((v): v is number => v !== null);
    out.push({
      id,
      name: id === null ? '' : (properties.find((p) => p.id === id)?.name ?? ''),
      siteCount: rows.length,
      online: online.length,
      lowestScore: scores.length > 0 ? Math.min(...scores) : null,
      attention: rows.reduce((n, r) => n + r.active_alarms + r.active_critical_alerts + r.active_anomalies.length + r.devices_attention.bad, 0),
      pvNowW: pv.length > 0 ? pv.reduce((a, b) => a + b, 0) : null,
      avgSoc: soc.length > 0 ? Math.round(soc.reduce((a, b) => a + b, 0) / soc.length) : null,
    });
  }
  // Properties by name, the ungrouped sites last.
  return out.sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name)));
}

// The few facts a site row needs, shared by the finder at the top of a fleet page and the
// compact list at its bottom. Built on the server from the fleet overview rows.
import type { FleetOverviewRow } from '@/lib/server/db/admin';

export type SiteItem = {
  id: string;
  name: string;
  /** Customer (admin) or nothing; searched as well as shown. */
  sub: string | null;
  status: 'online' | 'stale' | 'never_synced';
  soc: number | null;
  pvW: number | null;
  /** Open critical alerts + active alarms: a red mark on the row when above 0. */
  attention: number;
  href: string;
};

export function siteItems(sites: FleetOverviewRow[], hrefBase: string, withCustomer: boolean): SiteItem[] {
  return sites.map((s) => ({
    id: s.site_id,
    name: s.display_name,
    sub: withCustomer ? s.customer_name ?? null : null,
    status: s.connection_status,
    soc: s.connection_status === 'online' ? s.live_soc_pct : null,
    pvW: s.connection_status === 'online' ? s.live_pv_power_w : null,
    attention: (s.active_critical_alerts ?? 0) + (s.active_alarms ?? 0),
    href: `${hrefBase}${encodeURIComponent(s.site_id)}`,
  }));
}

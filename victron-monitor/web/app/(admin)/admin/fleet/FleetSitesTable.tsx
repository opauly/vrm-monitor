'use client';

// The per-site table at the bottom of `/admin/fleet` — split out into its
// own Client Component (2026-09-26, Oscar's own request) purely to host a
// live search box; every other piece of that page (rollup cards, flow
// diagram, shape chart) stays server-rendered and fleet-wide, unaffected
// by this table's own search — typing here narrows which SITES are listed
// below, not the totals above, so "why did my total solar change while I
// was searching" can't happen. `row()`/`connectionLabel()`/`healthClass()`/
// `formatWatts()` are moved here verbatim from `page.tsx` (own copies, not
// imported back — same "restated per file" precedent every other admin
// list in this app already follows); `connectionLabel`/`connectionClass`
// still have their own separate copy in `page.tsx` too, for the rollup
// cards' own breakdown lists, which this component never touches.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Input, Table } from '@/components/ui';
import { formatDateTime, formatDateTimeInZone } from '@/lib/dates';
import type { FleetConnectionStatus, FleetOverviewRow } from '@/lib/server/db/admin';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './fleet.module.css';

function connectionLabel(status: FleetConnectionStatus, lang: Lang): string {
  if (status === 'online') return t(lang, 'admin_fleet_status_online');
  if (status === 'stale') return t(lang, 'admin_fleet_status_stale');
  return t(lang, 'admin_fleet_status_never');
}

function connectionClass(status: FleetConnectionStatus): string {
  if (status === 'online') return styles.dotOnline;
  if (status === 'stale') return styles.dotStale;
  return styles.dotNever;
}

function healthClass(score: number | null): string {
  if (score === null) return styles.healthNone;
  if (score >= 90) return styles.healthExcellent;
  if (score >= 80) return styles.healthGood;
  if (score >= 70) return styles.healthFair;
  return styles.healthPoor;
}

function formatWatts(w: number | null): string {
  if (w === null) return '—';
  return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)}kW` : `${Math.round(w)}W`;
}

function row(site: FleetOverviewRow, lang: Lang) {
  return (
    <tr key={site.site_id}>
      <td>
        <div>{site.display_name}</div>
        <div className={`${styles.sub} ${styles.nowrap}`}>{site.customer_name}</div>
      </td>
      <td>
        <span className={`${styles.dot} ${connectionClass(site.connection_status)}`} aria-hidden="true" />
        {connectionLabel(site.connection_status, lang)}
        <div className={`${styles.sub} ${styles.nowrap}`}>
          {t(lang, 'admin_fleet_report_data')} {site.vrm_last_synced_at ? formatDateTime(site.vrm_last_synced_at, 'en-US') : t(lang, 'admin_fleet_never')}
        </div>
      </td>
      <td>
        <div className={styles.scorePair}>
          <span
            className={`${styles.healthBadge} ${styles.nowrap} ${healthClass(site.system_score)}`}
            title={site.system_notes ? site.system_notes.split(';').map((n) => n.trim()).filter(Boolean).join('\n') : undefined}
          >
            {t(lang, 'admin_fleet_badge_sys')} {site.system_score === null ? '—' : `${site.system_score}/100`}
          </span>
          <span
            className={`${styles.healthBadge} ${styles.nowrap} ${healthClass(site.grid_score)}`}
            title={site.grid_notes ? site.grid_notes.split(';').map((n) => n.trim()).filter(Boolean).join('\n') : undefined}
          >
            {t(lang, 'admin_fleet_badge_grid')} {site.grid_score === null ? '—' : `${site.grid_score}/100`}
          </span>
        </div>
        {site.health_date && (
          <div className={`${styles.sub} ${styles.nowrap}`}>{t(lang, 'admin_fleet_as_of').replace('{date}', site.health_date)}</div>
        )}
      </td>
      <td>{site.active_alarms > 0 ? <span className={styles.alarmCount}>{site.active_alarms}</span> : '0'}</td>
      <td>{site.active_critical_alerts > 0 ? <span className={styles.alarmCount}>{site.active_critical_alerts}</span> : '0'}</td>
      <td>
        {site.live_captured_at ? (
          <>
            <div className={styles.nowrap}>
              {t(lang, 'admin_fleet_pv_load').replace('{pv}', formatWatts(site.live_pv_power_w)).replace('{load}', formatWatts(site.live_load_power_w))}
            </div>
            <div className={`${styles.sub} ${styles.nowrap}`}>
              {t(lang, 'admin_fleet_batt_soc')
                .replace('{batt}', formatWatts(site.live_battery_power_w))
                .replace('{soc}', site.live_soc_pct === null ? '—' : `${site.live_soc_pct}%`)}
            </div>
            <div className={`${styles.sub} ${styles.nowrap}`}>
              {t(lang, 'admin_fleet_as_of').replace('{date}', formatDateTimeInZone(site.live_captured_at, site.timezone, 'en-US'))}
            </div>
          </>
        ) : (
          <span className={styles.sub}>{t(lang, 'admin_fleet_no_live_reading')}</span>
        )}
      </td>
      <td>
        {site.specific_yield_kwh_per_kwp === null ? (
          <span className={styles.sub}>—</span>
        ) : (
          <span className={styles.yield}>{site.specific_yield_kwh_per_kwp} kWh/kWp</span>
        )}
      </td>
      <td className={`${styles.sub} ${styles.nowrap}`}>{site.system_type}</td>
      <td>
        <Link href={`/admin/fleet/${encodeURIComponent(site.site_id)}`} className={styles.viewLive}>
          {t(lang, 'admin_fleet_view_live')} →
        </Link>
      </td>
    </tr>
  );
}

export function FleetSitesTable({ sites, lang }: { sites: FleetOverviewRow[]; lang: Lang }) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const filteredSites = useMemo(() => {
    if (!normalizedQuery) return sites;
    return sites.filter((s) => {
      const haystack = [s.display_name, s.customer_name, s.site_id, s.system_type].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [sites, normalizedQuery]);

  // Recomputed from `filteredSites`, not the full fleet — "lowest SOC right
  // now" means "among what you're currently looking at" once a search is
  // active, same as every other number this table itself shows.
  const lowestSoc = useMemo(() => {
    const withSoc = filteredSites.filter((s) => s.connection_status === 'online' && s.live_soc_pct !== null);
    return withSoc.length > 0
      ? withSoc.reduce((min, s) => ((s.live_soc_pct ?? 0) < (min.live_soc_pct ?? 0) ? s : min))
      : null;
  }, [filteredSites]);

  return (
    <>
      <div className={styles.filtersRow}>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, 'admin_search_placeholder')}
          className={styles.searchBox}
        />
        <span className={styles.filterCount}>
          {t(lang, 'admin_sites_filter_count').replace('{n}', String(filteredSites.length)).replace('{m}', String(sites.length))}
        </span>
      </div>

      {filteredSites.length === 0 ? (
        <p className={styles.empty}>{t(lang, 'admin_search_no_results')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t(lang, 'admin_sites_col_site')}</th>
              <th>{t(lang, 'admin_fleet_col_connection')}</th>
              <th>{t(lang, 'admin_reports_stat_health')}</th>
              <th>{t(lang, 'admin_upload_col_hist_alarms')}</th>
              <th>{t(lang, 'admin_fleet_col_critical_alerts')}</th>
              <th>{t(lang, 'admin_fleet_col_live')}</th>
              <th>{t(lang, 'admin_fleet_col_yield')}</th>
              <th>{t(lang, 'admin_customers_col_type')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>{filteredSites.map((s) => row(s, lang))}</tbody>
        </Table>
      )}

      {lowestSoc && (
        <p className={styles.sub} style={{ marginTop: 10 }}>
          {t(lang, 'admin_fleet_lowest_soc').replace('{pct}', String(lowestSoc.live_soc_pct)).replace('{name}', lowestSoc.display_name)}
        </p>
      )}
    </>
  );
}

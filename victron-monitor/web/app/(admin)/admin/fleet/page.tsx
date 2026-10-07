import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/server/auth';
import { listOpenAlerts } from '@/lib/server/db';
import { fleetAlertCustomerId } from '@/lib/server/fleetAlertCustomer';
import { getFleetOverview, type FleetConnectionStatus, type FleetOverviewRow } from '@/lib/server/db/admin';
import { InfoTooltip } from '@/components/ui';
import { formatDateTime, isWithinLastHours } from '@/lib/dates';
import { systemScoreInfo, gridScoreInfo } from '@/lib/healthScoreInfo';
import { t, type Lang } from '@/lib/i18n/strings';
import { FleetFreshness } from './FleetFreshness';
import { FleetSitesTable } from './FleetSitesTable';
import { FleetLiveSection } from './FleetLiveSection';
import { ShapeChart } from './ShapeChart';
import styles from './fleet.module.css';

export const metadata: Metadata = {
  title: 'VRM Fleet — Admin',
};

// `/admin/fleet` — the ops overview a UCR capstone project's own
// requirements doc calls "Dashboard de flota" (Oscar is sponsoring that
// project separately with the same idea; this is built independently now,
// against this product's own real data, not tied to that project's
// timeline). Admin-only by design (confirmed with Oscar, 2026-08-30) — no
// entitlement/tenancy gating, same as every other `/admin/**` page.
//
// Phase 2.5 (2026-08-30) built this out from a plain table into: expandable
// KPI cards (native <details>, no client JS needed for that alone), a
// virtual-plant flow diagram, per-site specific yield, and a "View live →"
// link into `/admin/fleet/[site_id]`. The interactive shape chart is the
// one piece that genuinely needs a Client Component (`ShapeChart.tsx`) —
// everything else on this page stays server-rendered.
function connectionLabel(status: FleetConnectionStatus, lang: Lang): string {
  if (status === 'online') return t(lang, 'admin_fleet_status_online');
  if (status === 'stale') return t(lang, 'admin_fleet_status_stale');
  return t(lang, 'admin_fleet_status_never');
}

// Every rollup card's breakdown list, sorted by whatever value that card
// itself displays (2026-09-03, Oscar's own request) — highest first, `null`
// (nothing to rank) always last, and alphabetical by display_name as the
// tiebreaker for equal or absent values. Never mutates the input array.
function sortedByValue(sites: FleetOverviewRow[], valueFn: (s: FleetOverviewRow) => number | null): FleetOverviewRow[] {
  return [...sites].sort((a, b) => {
    const va = valueFn(a);
    const vb = valueFn(b);
    if (va === null && vb === null) return a.display_name.localeCompare(b.display_name);
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va !== vb) return vb - va;
    return a.display_name.localeCompare(b.display_name);
  });
}

// Worst-first rank for the two cards that only have a categorical (not
// numeric) value to show — surfaces the sites actually worth looking at
// instead of an arbitrary DB-fetch order, without pretending "Online" vs
// "Stale" is a continuous quantity.
const _CONNECTION_RANK: Record<FleetConnectionStatus, number> = { never_synced: 2, stale: 1, online: 0 };

function sortedAlphabetically(sites: FleetOverviewRow[]): FleetOverviewRow[] {
  return [...sites].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export default async function AdminFleetPage() {
  const session = await requireAdmin();
  const lang = session.uiLanguage;
  const overview = await getFleetOverview();
  // Open alerts on the admin's own fleet, for the button's badge. A failure here
  // must not take the dashboard down; the button just shows without a count.
  const fleetAlertsOwner = fleetAlertCustomerId();
  const openAlertCount = fleetAlertsOwner ? await listOpenAlerts(fleetAlertsOwner).then((a) => a.length).catch(() => null) : null;

  const sites = overview.sites;
  // A stale site's last snapshot still has real (once-live) readings sitting
  // in its row — e.g. a site last seen at 10:42am with sun out still shows
  // "370W PV" 44 days later at 11pm with none. Gating on `connection_status
  // === 'online'` (the same ~45-minute freshness `_connectionStatus()`
  // already computes) keeps these fleet-wide "live" totals actually live,
  // instead of quietly summing months-old readings as if they were current.
  const onlineSites = sites.filter((s) => s.connection_status === 'online');
  const meteredSites = onlineSites.filter((s) => s.has_grid_meter);
  const socSites = onlineSites.filter((s) => s.live_soc_pct !== null);

  const avgSoc = socSites.length > 0 ? Math.round((socSites.reduce((a, s) => a + (s.live_soc_pct ?? 0), 0) / socSites.length) * 10) / 10 : null;

  // "History Sync" — the DAILY report-data pipeline's own freshness
  // (vrm_last_synced_at), deliberately separate from "Online" above (the
  // LIVE ~15-min snapshot's own freshness) — see the Help tab for why the
  // two are independent pipelines that can genuinely disagree. 24h, not
  // the per-site "Online" badge's 45-minute window: this is a daily-grade
  // signal, checking "did today's sync actually run," not "is it live."
  const historySyncedSites = sites.filter((s) => s.vrm_last_synced_at !== null && isWithinLastHours(s.vrm_last_synced_at, 24));

  // Outages this week — from the same real energy_daily-derived figures
  // the per-site "This week" panel already shows, not a live signal (an
  // outage is inherently a past event by the time it's counted).
  const outageSites = sites.filter((s) => s.week.outageCount > 0);

  // Per-type anomaly counts (Fleet Dashboard Phase 3a/3b/3c) — computed here
  // from each site's own `active_anomalies` rather than adding three more
  // rollup fields to getFleetOverview(): the full per-anomaly detail
  // (including `anomaly_type`) already travels with every site, so slicing
  // it three ways client-side is enough, no new server-side aggregation
  // needed.
  const allActiveAnomalies = sites.flatMap((s) => s.active_anomalies);
  const silenceCount = allActiveAnomalies.filter((a) => a.anomaly_type === 'unexpected_silence').length;
  const driftCount = allActiveAnomalies.filter((a) => a.anomaly_type === 'quiet_drift').length;
  const underperformanceCount = allActiveAnomalies.filter((a) => a.anomaly_type === 'underperformance').length;
  const incompleteChargingCount = allActiveAnomalies.filter((a) => a.anomaly_type === 'incomplete_charging').length;

  // Fleet averages for the three IE-0499 §4 daily-indicator formulas —
  // same per-site numbers `_dailyIndicators()` already computes, averaged
  // only over sites that actually have a value today (never treating a
  // missing denominator as a 0%).
  const avgOf = (values: (number | null)[]) => {
    const real = values.filter((v): v is number => v !== null);
    return real.length > 0 ? Math.round((real.reduce((a, b) => a + b, 0) / real.length) * 10) / 10 : null;
  };
  const avgSelfSufficiency = avgOf(sites.map((s) => s.self_sufficiency_pct));
  const avgSelfConsumption = avgOf(sites.map((s) => s.self_consumption_pct));
  const avgGridDependency = avgOf(sites.map((s) => s.grid_dependency_pct));

  // The fleet-wide "how fresh is this" badge is about the VIEWER's own
  // clock, not any one site's — computed here (server-side, cheap: just a
  // max over already-fetched rows) and handed to `FleetFreshness`, the one
  // Client Component on this page, to actually render in the browser's
  // own timezone.
  const capturedTimestamps = sites.map((s) => s.live_captured_at).filter((v): v is string => v !== null);
  const mostRecentCapturedAt = capturedTimestamps.length > 0
    ? capturedTimestamps.reduce((latest, ts) => (ts > latest ? ts : latest))
    : null;

  return (
    <div>
      <div className={styles.pageHead}>
        <h1>{t(lang, 'admin_fleet_title')}</h1>
        <div className={styles.headActions}>
          <Link href="/admin/fleet/alerts" className={styles.alertsButton}>
            {t(lang, 'admin_fleet_alerts_link')}
            {openAlertCount !== null && (
              <span className={`${styles.alertsCount} ${openAlertCount > 0 ? styles.alertsCountOpen : ''}`}>{openAlertCount}</span>
            )}
          </Link>
          {mostRecentCapturedAt && (
            <div className={styles.liveBadge}>
              <span className={styles.pulse} />
              <FleetFreshness mostRecentCapturedAt={mostRecentCapturedAt} lang={lang} />
            </div>
          )}
        </div>
      </div>
      <Link href="/admin/vrm-fleet" className={styles.manageLink}>
        {t(lang, 'admin_fleet_link_new')} →
      </Link>
      <p className="mono page-desc">
        {t(lang, 'admin_fleet_desc_1')} <code>source=&apos;vrm_api&apos;</code> {t(lang, 'admin_fleet_desc_2')}{' '}
        <code>vrm.daily_health</code>/<code>vrm.energy_daily</code> {t(lang, 'admin_fleet_desc_3')}{' '}
        <code>vrm-fleet/refresh-snapshots</code>. {t(lang, 'admin_fleet_desc_4')}
      </p>

      {sites.length > 0 && (
        <FleetLiveSection sites={sites} lang={lang} loadLabel={t(lang, 'admin_fleet_flow_load_label')} siteHrefBase="/admin/fleet/" />
      )}

      <p className={styles.rollupHint}>{t(lang, 'admin_fleet_rollup_hint')}</p>

      <h2 className={styles.rollupGroupLabel}>{t(lang, 'admin_fleet_group_connectivity')}</h2>
      <div className={styles.rollupRow}>
        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_sites_label')}</span>
            <span className={styles.rollupValue}>{overview.rollup.site_count}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_sites_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedAlphabetically(sites).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{connectionLabel(s.connection_status, lang)}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_online_label')}</span>
            <span className={styles.rollupValue}>
              {overview.rollup.online_count} / {overview.rollup.site_count}
            </span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_online_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => _CONNECTION_RANK[s.connection_status]).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{connectionLabel(s.connection_status, lang)}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_grid_reading_label')}</span>
            <span className={styles.rollupValue}>
              {meteredSites.length}/{sites.length}
            </span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_grid_reading_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedAlphabetically(sites).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>
                  {s.live_grid_source === 'meter' ? t(lang, 'admin_fleet_grid_source_meter')
                    : s.live_grid_source === 'inverter' ? t(lang, 'admin_fleet_grid_source_inverter')
                    : t(lang, 'admin_fleet_grid_source_none')}
                </span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_history_sync_label')}</span>
            <span className={styles.rollupValue}>
              {historySyncedSites.length}/{sites.length}
            </span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_history_sync_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {/* Oldest/never-synced first — a negated epoch so "never"
               (null) sorts as the largest, most-concerning value via the
               same descending numeric sort every other card uses. */}
            {sortedByValue(sites, (s) => (s.vrm_last_synced_at ? -new Date(s.vrm_last_synced_at).getTime() : Infinity)).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.vrm_last_synced_at ? formatDateTime(s.vrm_last_synced_at, 'en-US') : t(lang, 'admin_fleet_never')}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      <h2 className={styles.rollupGroupLabel}>{t(lang, 'admin_fleet_group_health')}</h2>
      <div className={styles.rollupRow}>
        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>
              {t(lang, 'admin_fleet_card_avg_system_label')}
              <InfoTooltip label={t(lang, 'score_info_system_tooltip_label')}>{systemScoreInfo(lang)}</InfoTooltip>
            </span>
            <span className={styles.rollupValue}>{overview.rollup.avg_system_score === null ? '—' : `${overview.rollup.avg_system_score}/100`}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_avg_system_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.system_score).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.system_score === null ? '—' : `${s.system_score}/100`}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>
              {t(lang, 'admin_fleet_card_avg_grid_label')}
              <InfoTooltip label={t(lang, 'score_info_grid_tooltip_label')}>{gridScoreInfo(lang)}</InfoTooltip>
            </span>
            <span className={styles.rollupValue}>{overview.rollup.avg_grid_score === null ? '—' : `${overview.rollup.avg_grid_score}/100`}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_avg_grid_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.grid_score).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.grid_score === null ? '—' : `${s.grid_score}/100`}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_alarms_combined_label')}</span>
            <span className={styles.rollupValue}>
              {overview.rollup.total_active_alarms} / {overview.rollup.total_active_critical_alerts}
            </span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_alarms_combined_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_alarms + s.active_critical_alerts).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>
                  {t(lang, 'admin_fleet_alarms_breakdown')
                    .replace('{alarms}', String(s.active_alarms))
                    .replace('{critical}', String(s.active_critical_alerts))}
                </span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_outages_label')}</span>
            <span className={styles.rollupValue}>
              {outageSites.length}/{sites.length}
            </span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_outages_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => (s.week.daysWithData === 0 ? null : s.week.outageMinutes)).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.week.daysWithData === 0 ? '—' : s.week.outageCount > 0 ? `${s.week.outageCount} (${s.week.outageMinutes} min)` : '0'}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      <h2 className={styles.rollupGroupLabel}>{t(lang, 'admin_fleet_group_energy')}</h2>
      <div className={styles.rollupRow}>
        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_avg_soc_label')}</span>
            <span className={styles.rollupValue}>{avgSoc === null ? '—' : `${avgSoc}%`}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_avg_soc_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.live_soc_pct).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.live_soc_pct === null ? '—' : `${s.live_soc_pct}%`}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_self_sufficiency_label')}</span>
            <span className={styles.rollupValue}>{avgSelfSufficiency === null ? '—' : `${avgSelfSufficiency}%`}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_self_sufficiency_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.self_sufficiency_pct).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.self_sufficiency_pct === null ? '—' : `${s.self_sufficiency_pct}%`}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_self_consumption_label')}</span>
            <span className={styles.rollupValue}>{avgSelfConsumption === null ? '—' : `${avgSelfConsumption}%`}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_self_consumption_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.self_consumption_pct).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.self_consumption_pct === null ? '—' : `${s.self_consumption_pct}%`}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_grid_dependency_label')}</span>
            <span className={styles.rollupValue}>{avgGridDependency === null ? '—' : `${avgGridDependency}%`}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_grid_dependency_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.grid_dependency_pct).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.grid_dependency_pct === null ? '—' : `${s.grid_dependency_pct}%`}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      <h2 className={styles.rollupGroupLabel}>{t(lang, 'admin_fleet_group_ai')}</h2>
      <p className={styles.sub}>{t(lang, 'admin_fleet_ai_desc')}</p>
      <div className={styles.rollupRow}>
        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_silence_label')}</span>
            <span className={styles.rollupValue}>{silenceCount}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_silence_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_anomalies.filter((a) => a.anomaly_type === 'unexpected_silence').length).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.active_anomalies.filter((a) => a.anomaly_type === 'unexpected_silence').length}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_drift_label')}</span>
            <span className={styles.rollupValue}>{driftCount}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_drift_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_anomalies.filter((a) => a.anomaly_type === 'quiet_drift').length).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.active_anomalies.filter((a) => a.anomaly_type === 'quiet_drift').length}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_underperf_label')}</span>
            <span className={styles.rollupValue}>{underperformanceCount}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_underperf_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_anomalies.filter((a) => a.anomaly_type === 'underperformance').length).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.active_anomalies.filter((a) => a.anomaly_type === 'underperformance').length}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_incomplete_label')}</span>
            <span className={styles.rollupValue}>{incompleteChargingCount}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_incomplete_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_anomalies.filter((a) => a.anomaly_type === 'incomplete_charging').length).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/admin/fleet/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.active_anomalies.filter((a) => a.anomaly_type === 'incomplete_charging').length}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      {sites.length === 0 ? (
        <p className={styles.sub}>{t(lang, 'admin_fleet_no_sites')}</p>
      ) : (
        <>
          <ShapeChart
            siteIds={sites.map((s) => s.site_id)}
            title={t(lang, 'admin_fleet_shape_title')}
            cardSub={t(lang, 'admin_fleet_shape_sub')}
            lang={lang}
          />

          <FleetSitesTable sites={sites} lang={lang} />
        </>
      )}
    </div>
  );
}

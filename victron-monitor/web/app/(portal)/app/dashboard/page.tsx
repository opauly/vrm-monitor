import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { getCustomer, getDashboardAccess, getCustomerFleetOverview, type FleetConnectionStatus, type FleetOverviewRow } from '@/lib/server/db';
import { Table, Panel, Button, InfoTooltip } from '@/components/ui';
import { PendingSubscriptionUpsell } from '@/components/app';
import { formatDateTime, formatDateTimeInZone } from '@/lib/dates';
import { systemScoreInfo, gridScoreInfo } from '@/lib/healthScoreInfo';
import { t, type Lang } from '@/lib/i18n/strings';
import { FleetFreshness } from '../../../(admin)/admin/fleet/FleetFreshness';
import { FlowDiagram } from '../../../(admin)/admin/fleet/FlowDiagram';
import { ShapeChart } from '../../../(admin)/admin/fleet/ShapeChart';
import styles from './dashboard.module.css';

export const metadata: Metadata = {
  title: 'Dashboard',
};

// `/app/dashboard` — the customer-facing counterpart of the admin-only
// `/admin/fleet` (2026-09-03, Oscar's decision to offer the same live
// health/AI-Insights view to real Growth/Fleet subscribers). Reuses
// `admin/fleet`'s own presentational components (FlowDiagram/ShapeChart/
// FleetFreshness — pure, no admin coupling) and its exact indicator math
// (`fleetOverviewCore.ts`, via `getCustomerFleetOverview()`), but never
// imports `lib/server/db/admin.ts` itself — this file's data comes from
// `lib/server/db`'s tenant-scoped barrel only, same rule every other
// `/app/**` page follows.
//
// Rollup card labels/descriptions were left in English for the first
// version (2026-09-03) — now routed through `t()` too (2026-09-25, Oscar's
// own request, once the identical `/admin/fleet` cards had already been
// translated), reusing those exact same admin_fleet_* keys wherever the
// English text is identical rather than duplicating them.
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

const _CONNECTION_RANK: Record<FleetConnectionStatus, number> = { never_synced: 2, stale: 1, online: 0 };

function sortedAlphabetically(sites: FleetOverviewRow[]): FleetOverviewRow[] {
  return [...sites].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export default async function CustomerDashboardPage() {
  const session = await requireCustomerAllowPending();
  const lang = session.uiLanguage;
  // `…AllowPending`, not plain `requireCustomer()` (2026-09-21) — see
  // `app/(portal)/app/page.tsx`'s own comment for why. Checked BEFORE
  // `getCustomer()`/`getDashboardAccess()` below: a `pending_subscription`
  // customer has no real plan for the tier-gated upsell branch further
  // down to meaningfully distinguish from, so this short-circuits first.
  if (session.provisioningState !== 'active') {
    return (
      <div>
        <h1>{t(lang, 'dashboard_title')}</h1>
        <PendingSubscriptionUpsell lang={lang} />
      </div>
    );
  }
  const customer = await getCustomer(session.customerId);
  const allowed = await getDashboardAccess(customer);

  if (!allowed) {
    return (
      <div>
        <h1>{t(lang, 'dashboard_title')}</h1>
        <Panel className={styles.upsell}>
          <h2>{t(lang, 'dashboard_upsell_title')}</h2>
          <p>{t(lang, 'dashboard_upsell_body')}</p>
          <Button href="/app/billing">{t(lang, 'dashboard_upsell_cta')}</Button>
        </Panel>
      </div>
    );
  }

  const overview = await getCustomerFleetOverview(session.customerId);
  const sites = overview.sites;

  const row = (site: FleetOverviewRow) => (
    <tr key={site.site_id}>
      <td>
        <div>{site.display_name}</div>
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
        <Link href={`/app/dashboard/${encodeURIComponent(site.site_id)}`} className={styles.viewLive}>
          {t(lang, 'dashboard_view_site')}
        </Link>
      </td>
    </tr>
  );

  const onlineSites = sites.filter((s) => s.connection_status === 'online');
  const solarSites = onlineSites.filter((s) => s.live_pv_power_w !== null);
  const loadSites = onlineSites.filter((s) => s.live_load_power_w !== null);
  const batterySites = onlineSites.filter((s) => s.live_battery_power_w !== null);
  const meteredSites = onlineSites.filter((s) => s.has_grid_meter);
  const socSites = onlineSites.filter((s) => s.live_soc_pct !== null);

  const totalSolar = solarSites.reduce((a, s) => a + (s.live_pv_power_w ?? 0), 0);
  const totalLoad = loadSites.reduce((a, s) => a + (s.live_load_power_w ?? 0), 0);
  const totalBattery = batterySites.reduce((a, s) => a + (s.live_battery_power_w ?? 0), 0);
  const totalGrid = meteredSites.reduce((a, s) => a + (s.live_grid_power_w ?? 0), 0);
  const avgSoc = socSites.length > 0 ? Math.round((socSites.reduce((a, s) => a + (s.live_soc_pct ?? 0), 0) / socSites.length) * 10) / 10 : null;
  const lowestSoc = socSites.length > 0 ? socSites.reduce((min, s) => ((s.live_soc_pct ?? 0) < (min.live_soc_pct ?? 0) ? s : min)) : null;

  const now = Date.now();
  const historySyncedSites = sites.filter((s) => {
    if (!s.vrm_last_synced_at) return false;
    return now - new Date(s.vrm_last_synced_at).getTime() <= 24 * 60 * 60 * 1000;
  });

  const outageSites = sites.filter((s) => s.week.outageCount > 0);

  const allActiveAnomalies = sites.flatMap((s) => s.active_anomalies);
  const silenceCount = allActiveAnomalies.filter((a) => a.anomaly_type === 'unexpected_silence').length;
  const driftCount = allActiveAnomalies.filter((a) => a.anomaly_type === 'quiet_drift').length;
  const underperformanceCount = allActiveAnomalies.filter((a) => a.anomaly_type === 'underperformance').length;
  const incompleteChargingCount = allActiveAnomalies.filter((a) => a.anomaly_type === 'incomplete_charging').length;

  const avgOf = (values: (number | null)[]) => {
    const real = values.filter((v): v is number => v !== null);
    return real.length > 0 ? Math.round((real.reduce((a, b) => a + b, 0) / real.length) * 10) / 10 : null;
  };
  const avgSelfSufficiency = avgOf(sites.map((s) => s.self_sufficiency_pct));
  const avgSelfConsumption = avgOf(sites.map((s) => s.self_consumption_pct));
  const avgGridDependency = avgOf(sites.map((s) => s.grid_dependency_pct));

  const capturedTimestamps = sites.map((s) => s.live_captured_at).filter((v): v is string => v !== null);
  const mostRecentCapturedAt = capturedTimestamps.length > 0
    ? capturedTimestamps.reduce((latest, ts) => (ts > latest ? ts : latest))
    : null;

  return (
    <div>
      <div className={styles.pageHead}>
        <div className={styles.titleRow}>
          <h1>{t(lang, 'dashboard_title')}</h1>
        </div>
        {mostRecentCapturedAt && (
          <div className={styles.liveBadge}>
            <span className={styles.pulse} />
            <FleetFreshness mostRecentCapturedAt={mostRecentCapturedAt} lang={lang} />
          </div>
        )}
      </div>
      <p className={`mono ${styles.pageDesc}`}>{t(lang, 'dashboard_intro')}</p>

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
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
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
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
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
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
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
            {sortedByValue(sites, (s) => (s.vrm_last_synced_at ? -new Date(s.vrm_last_synced_at).getTime() : Infinity)).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
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
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
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
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.grid_score === null ? '—' : `${s.grid_score}/100`}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_active_alarms_label')}</span>
            <span className={styles.rollupValue}>{overview.rollup.total_active_alarms}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_active_alarms_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_alarms).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.active_alarms}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'admin_fleet_card_critical_alerts_label')}</span>
            <span className={styles.rollupValue}>{overview.rollup.total_active_critical_alerts}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_critical_alerts_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_critical_alerts).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.active_critical_alerts}</span>
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
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
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
            <span className={styles.rollupDesc}>{t(lang, 'dashboard_card_avg_soc_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.live_soc_pct).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
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
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
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
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
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
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.grid_dependency_pct === null ? '—' : `${s.grid_dependency_pct}%`}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      <h2 className={styles.rollupGroupLabel}>
        {t(lang, 'dashboard_ai_insights_title')} <span className={styles.betaBadge}>{t(lang, 'dashboard_beta_badge')}</span>
      </h2>
      <p className={styles.sub}>{t(lang, 'dashboard_ai_insights_intro')}</p>
      <div className={styles.rollupRow}>
        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'dashboard_anomaly_unexpected_silence')}</span>
            <span className={styles.rollupValue}>{silenceCount}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_silence_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_anomalies.filter((a) => a.anomaly_type === 'unexpected_silence').length).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.active_anomalies.filter((a) => a.anomaly_type === 'unexpected_silence').length}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'dashboard_anomaly_quiet_drift')}</span>
            <span className={styles.rollupValue}>{driftCount}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_drift_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_anomalies.filter((a) => a.anomaly_type === 'quiet_drift').length).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.active_anomalies.filter((a) => a.anomaly_type === 'quiet_drift').length}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'dashboard_anomaly_underperformance')}</span>
            <span className={styles.rollupValue}>{underperformanceCount}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_underperf_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_anomalies.filter((a) => a.anomaly_type === 'underperformance').length).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.active_anomalies.filter((a) => a.anomaly_type === 'underperformance').length}</span>
              </div>
            ))}
          </div>
        </details>

        <details className={styles.rollupCard}>
          <summary>
            <span className={styles.rollupLabel}>{t(lang, 'dashboard_anomaly_incomplete_charging')}</span>
            <span className={styles.rollupValue}>{incompleteChargingCount}</span>
            <span className={styles.rollupDesc}>{t(lang, 'admin_fleet_card_incomplete_desc')}</span>
          </summary>
          <div className={styles.rollupBreakdown}>
            {sortedByValue(sites, (s) => s.active_anomalies.filter((a) => a.anomaly_type === 'incomplete_charging').length).map((s) => (
              <div key={s.site_id} className={styles.rollupBreakdownRow}>
                <Link href={`/app/dashboard/${encodeURIComponent(s.site_id)}`} className={styles.rollupBreakdownLink}>{s.display_name}</Link>
                <span>{s.active_anomalies.filter((a) => a.anomaly_type === 'incomplete_charging').length}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      {sites.length === 0 ? (
        <p className={styles.sub}>{t(lang, 'dashboard_no_sites')}</p>
      ) : (
        <>
          <FlowDiagram
            solarW={solarSites.length > 0 ? totalSolar : null}
            solarNote={t(lang, 'admin_fleet_flow_note_of_sites').replace('{n}', String(solarSites.length)).replace('{m}', String(sites.length))}
            loadW={loadSites.length > 0 ? totalLoad : null}
            loadLabel={t(lang, 'dashboard_flow_load_label')}
            batteryW={batterySites.length > 0 ? totalBattery : null}
            batteryNote={t(lang, 'admin_fleet_flow_battery_note')}
            gridW={totalGrid}
            hasGridMeter={meteredSites.length > 0}
            gridNote={t(lang, 'admin_fleet_flow_note_of_sites').replace('{n}', String(meteredSites.length)).replace('{m}', String(sites.length))}
          />

          <ShapeChart
            siteIds={sites.map((s) => s.site_id)}
            title={t(lang, 'admin_fleet_shape_title')}
            cardSub={t(lang, 'admin_fleet_shape_sub')}
            apiBasePath="/api/pipeline/vrm-fleet"
            lang={lang}
          />

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
            <tbody>{sites.map(row)}</tbody>
          </Table>

          {lowestSoc && (
            <p className={styles.sub} style={{ marginTop: 10 }}>
              {t(lang, 'admin_fleet_lowest_soc').replace('{pct}', String(lowestSoc.live_soc_pct)).replace('{name}', lowestSoc.display_name)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

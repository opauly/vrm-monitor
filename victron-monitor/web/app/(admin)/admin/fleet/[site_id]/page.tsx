import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/server/auth';
import { getFleetSiteDetail, type SiteAnomalyRow } from '@/lib/server/db/admin';
import { formatDateTimeInZone } from '@/lib/dates';
import { InfoTooltip } from '@/components/ui';
import { systemScoreInfo, gridScoreInfo } from '@/lib/healthScoreInfo';
import { t, type Lang } from '@/lib/i18n/strings';
import { FlowDiagram } from '../FlowDiagram';
import { Gauge } from '../Gauge';
import { PeriodStatsPanel } from '../PeriodStatsPanel';
import { ShapeChart } from '../ShapeChart';
import styles from './site.module.css';

// `/admin/fleet/[site_id]` — the "Vista de proyecto" drill-down IE-0499's
// own requirements doc calls for (§9), reached from the "View live →" link
// on `/admin/fleet`'s table (Fleet Dashboard Phase 2.5). Same data source
// as the fleet table (`getFleetSiteDetail()`, itself built on
// `getFleetOverview()`) — this page never computes an indicator the fleet
// table doesn't already compute the same way, by construction.
export async function generateMetadata({ params }: { params: Promise<{ site_id: string }> }): Promise<Metadata> {
  const { site_id } = await params;
  const site = await getFleetSiteDetail(site_id);
  return { title: site ? `${site.display_name} — VRM Fleet` : 'Site not found — VRM Fleet' };
}

function formatWatts(w: number | null): string {
  if (w === null) return '—';
  return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)}kW` : `${Math.round(w)}W`;
}

// Same 4-tier thresholds as fleet/page.tsx's own healthClass() — a health
// score must read the same way everywhere it's shown.
function healthClass(score: number | null): string {
  if (score === null) return styles.healthNone;
  if (score >= 90) return styles.healthExcellent;
  if (score >= 80) return styles.healthGood;
  if (score >= 70) return styles.healthFair;
  return styles.healthPoor;
}

// `vrm.compute_daily_health()` (migration 012) joins its reasons with
// "; " — split back into a list so "High grid dependency; Low battery
// voltage (45.2V)" reads as two distinct, scannable points instead of one
// run-on sentence.
function healthNotesList(notes: string | null): string[] {
  if (!notes) return [];
  return notes.split(';').map((n) => n.trim()).filter(Boolean);
}

// "America/Costa_Rica" -> "Costa Rica" — the site's own configured
// timezone (its Cerbo's local time), shown so it's clear this timestamp is
// NOT the viewer's own clock, unlike the fleet-wide badge on `/admin/fleet`.
function tzLabel(tz: string | null): string {
  if (!tz) return 'CR';
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
}

// Fleet Dashboard Phase 3 (2026-09-03) — `vrm.site_anomalies.anomaly_type`'s
// full vocabulary (migration 038/040). All four now write real rows: 3b
// (unexpected_silence, ~15-min live sweep), 3a (quiet_drift), 3c
// (underperformance), and 3d (incomplete_charging) (all three daily checks
// wired into `POST /v1/vrm-fleet/detect-anomalies-daily`).
//
// `incomplete_charging` was missing from this function until 2026-09-03
// (found while building the customer-facing `/app/dashboard` counterpart,
// which needed the same label mapping and exposed the gap) — it fell
// through to the raw `type` string (`"incomplete_charging"`, unreadable)
// instead of a real label. Fixed here and added fresh in the customer
// version at the same time.
function anomalyTypeLabel(type: string, lang: Lang): string {
  if (type === 'unexpected_silence') return t(lang, 'admin_fleet_card_silence_label');
  if (type === 'quiet_drift') return t(lang, 'admin_fleet_card_drift_label');
  if (type === 'underperformance') return t(lang, 'admin_fleet_card_underperf_label');
  if (type === 'incomplete_charging') return t(lang, 'admin_fleet_card_incomplete_label');
  return type;
}

// `detail`'s shape is anomaly_type-specific (the migration's own COMMENT ON
// COLUMN) — each known anomaly_type has its own keys
// (victron/anomaly_silence.py:_build_detail() for unexpected_silence;
// victron/anomaly_drift.py's own detail dicts for quiet_drift/
// underperformance); any other/unknown shape falls back to raw JSON rather
// than showing nothing.
// Plain calendar dates in `detail` (e.g. "2026-08-30") come from Python's
// `date.isoformat()` — no time-of-day, no timezone component. Running them
// through `formatDateTimeInZone` (built for real timestamps) would parse
// the bare date as UTC midnight and could shift the displayed day by one
// depending on the site's own timezone, so this is a separate, deliberately
// UTC-pinned formatter for date-only values.
function formatPlainDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// Natural-language summary for a non-technical reader, with the real
// numbers a support conversation would actually need attached — not just a
// derived ratio. Every field read here is optional (typeof-guarded): a
// `detail` shape from an older row, or a partial update, must not crash
// this page, same "one bad field can't break the render" posture the rest
// of this pipeline's live-data code already takes.
function anomalyDetailSummary(a: SiteAnomalyRow, lang: Lang): string {
  const detail = a.detail ?? {};
  if (a.anomaly_type === 'unexpected_silence') {
    const minutes = typeof detail.minutes_silent === 'number' ? Math.round(detail.minutes_silent) : null;
    const window = typeof detail.expected_window_local === 'string' ? detail.expected_window_local : null;
    const validDays = typeof detail.window_basis_valid_days === 'number' ? detail.window_basis_valid_days : null;
    const productiveDays = typeof detail.window_basis_productive_days === 'number' ? detail.window_basis_productive_days : null;
    const parts: string[] = [];
    if (minutes !== null) parts.push(t(lang, 'admin_fleetsite_anomaly_silence_minutes').replace('{minutes}', String(minutes)));
    if (window) parts.push(t(lang, 'admin_fleetsite_anomaly_silence_window').replace('{window}', window));
    if (validDays !== null && productiveDays !== null) {
      parts.push(
        t(lang, 'admin_fleetsite_anomaly_silence_basis').replace('{productive}', String(productiveDays)).replace('{valid}', String(validDays)),
      );
    }
    return parts.length > 0 ? parts.join(' ') : t(lang, 'admin_fleetsite_anomaly_no_detail');
  }
  if (a.anomaly_type === 'quiet_drift') {
    const recent = typeof detail.recent_mean_kwh_adj === 'number' ? detail.recent_mean_kwh_adj : null;
    const baseline = typeof detail.baseline_mean_kwh_adj === 'number' ? detail.baseline_mean_kwh_adj : null;
    const ratio = typeof detail.ratio_recent_to_baseline === 'number' ? detail.ratio_recent_to_baseline : null;
    const days = typeof detail.days_flagged === 'number' ? detail.days_flagged : null;
    const window = typeof detail.recent_window_days === 'number' ? detail.recent_window_days : null;
    const parts: string[] = [];
    if (recent !== null && baseline !== null) {
      parts.push(
        t(lang, 'admin_fleetsite_anomaly_drift_rate').replace('{recent}', recent.toFixed(1)).replace('{baseline}', baseline.toFixed(1)),
      );
    }
    if (ratio !== null) parts.push(t(lang, 'admin_fleetsite_anomaly_drift_ratio').replace('{ratio}', String(Math.round(ratio * 100))));
    if (days !== null && window !== null) {
      parts.push(t(lang, 'admin_fleetsite_anomaly_drift_days').replace('{days}', String(days)).replace('{window}', String(window)));
    }
    return parts.length > 0 ? parts.join(' ') : t(lang, 'admin_fleetsite_anomaly_no_detail');
  }
  if (a.anomaly_type === 'underperformance') {
    const pvKwh = typeof detail.best_recent_pv_kwh === 'number' ? detail.best_recent_pv_kwh : null;
    const expectedKwh = typeof detail.best_recent_expected_kwh === 'number' ? detail.best_recent_expected_kwh : null;
    const pr = typeof detail.best_recent_pr === 'number' ? detail.best_recent_pr : null;
    const pvKwp = typeof detail.pv_kwp === 'number' ? detail.pv_kwp : null;
    const date = typeof detail.best_recent_date === 'string' ? formatPlainDate(detail.best_recent_date) : null;
    const parts: string[] = [];
    if (pvKwh !== null && expectedKwh !== null) {
      parts.push(
        t(lang, 'admin_fleetsite_anomaly_underperf_rate').replace('{pv}', pvKwh.toFixed(1)).replace('{expected}', expectedKwh.toFixed(1)),
      );
    }
    if (pvKwp !== null) parts.push(t(lang, 'admin_fleetsite_anomaly_underperf_system').replace('{kwp}', String(pvKwp)));
    if (pr !== null) parts.push(t(lang, 'admin_fleetsite_anomaly_underperf_pr').replace('{pr}', String(Math.round(pr * 100))));
    if (date) parts.push(t(lang, 'admin_fleetsite_anomaly_underperf_date').replace('{date}', date));
    return parts.length > 0 ? parts.join(' ') : t(lang, 'admin_fleetsite_anomaly_no_detail');
  }
  if (a.anomaly_type === 'incomplete_charging') {
    const incompleteDays = typeof detail.incomplete_days === 'number' ? detail.incomplete_days : null;
    const validDays = typeof detail.valid_days_checked === 'number' ? detail.valid_days_checked : null;
    const windowDays = typeof detail.window_days === 'number' ? detail.window_days : null;
    const parts: string[] = [];
    if (incompleteDays !== null && validDays !== null) {
      parts.push(
        t(lang, 'admin_fleetsite_anomaly_incomplete_days').replace('{incomplete}', String(incompleteDays)).replace('{valid}', String(validDays)),
      );
    }
    if (windowDays !== null) parts.push(t(lang, 'admin_fleetsite_anomaly_incomplete_window').replace('{window}', String(windowDays)));
    return parts.length > 0 ? parts.join(' ') : t(lang, 'admin_fleetsite_anomaly_no_detail');
  }
  return JSON.stringify(detail);
}

export default async function AdminFleetSitePage({ params }: { params: Promise<{ site_id: string }> }) {
  const session = await requireAdmin();
  const lang = session.uiLanguage;
  const { site_id } = await params;
  const site = await getFleetSiteDetail(site_id);
  if (!site) notFound();

  return (
    <div>
      <div className={styles.crumb}>
        <Link href="/admin/fleet">{t(lang, 'admin_fleet_title')}</Link> / <span>{site.display_name}</span>
      </div>
      <div className={styles.pagehead}>
        <div>
          <h1>{site.display_name}</h1>
          <div className={styles.sub}>
            {site.customer_name} · {site.system_type} {t(lang, 'admin_fleetsite_system_label')}
          </div>
        </div>
        {site.live_captured_at && (
          <div className={styles.live}>
            <span className={styles.pulse} />
            {t(lang, 'admin_fleetsite_live_prefix')
              .replace('{date}', formatDateTimeInZone(site.live_captured_at, site.timezone, 'en-US'))
              .replace('{tz}', tzLabel(site.timezone))}
          </div>
        )}
      </div>

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>
            <span className={styles.swatch} style={{ background: 'var(--signal)' }} />
            {t(lang, 'admin_fleetsite_kpi_solar')}
          </div>
          <div className={styles.kpiValue}>{formatWatts(site.live_pv_power_w)}</div>
          {site.live_pv_chargers && site.live_pv_chargers.length > 1 && (
            <details className={styles.chargerBreakdown}>
              <summary>{t(lang, 'admin_fleetsite_chargers_count').replace('{count}', String(site.live_pv_chargers.length))}</summary>
              <ul>
                {site.live_pv_chargers.map((c) => (
                  <li key={c.instance}>
                    {t(lang, 'admin_fleetsite_charger_label').replace('{n}', String(c.instance + 1)).replace('{watts}', formatWatts(c.power_w))}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>
            <span className={styles.swatch} style={{ background: 'var(--paper-dim)' }} />
            {t(lang, 'admin_fleetsite_kpi_load')}
          </div>
          <div className={styles.kpiValue}>{formatWatts(site.live_load_power_w)}</div>
          {site.live_load_phases && site.live_load_phases.length > 1 && (
            <details className={styles.chargerBreakdown}>
              <summary>{t(lang, 'admin_fleetsite_phases_count').replace('{count}', String(site.live_load_phases.length))}</summary>
              <ul>
                {site.live_load_phases.map((p) => (
                  <li key={p.phase}>
                    {p.phase}: {formatWatts(p.power_w)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>
            <span className={styles.swatch} style={{ background: 'var(--good)' }} />
            {t(lang, 'admin_fleetsite_kpi_battery')}
          </div>
          <div className={styles.kpiValue}>
            {site.live_battery_power_w === null
              ? '—'
              : `${site.live_battery_power_w >= 0 ? '+' : ''}${formatWatts(site.live_battery_power_w)}`}
          </div>
          {site.live_battery_power_w !== null && (
            <div className={styles.kpiDelta}>
              {site.live_battery_power_w >= 0 ? t(lang, 'admin_fleetsite_charging') : t(lang, 'admin_fleetsite_discharging')}
            </div>
          )}
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>
            <span className={styles.swatch} style={{ background: 'var(--mute)' }} />
            {t(lang, 'admin_fleetsite_kpi_grid')}
          </div>
          <div className={styles.kpiValue}>{site.has_grid_meter ? formatWatts(site.live_grid_power_w) : '—'}</div>
          {site.live_grid_source === 'inverter' && (
            <div className={styles.kpiDelta}>{t(lang, 'admin_fleetsite_via_inverter_note')}</div>
          )}
          {site.live_grid_source === null && <div className={styles.kpiDelta}>{t(lang, 'admin_fleetsite_no_grid_reading')}</div>}
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>
            <span className={styles.swatch} style={{ background: 'var(--victron-glow)' }} />
            {t(lang, 'admin_fleetsite_kpi_soc')}
          </div>
          <div className={styles.kpiValue}>{site.live_soc_pct === null ? '—' : `${site.live_soc_pct}%`}</div>
        </div>
      </div>

      <div className={styles.split}>
        <div className={styles.flowCard}>
          <h2>{t(lang, 'admin_fleetsite_flow_title')}</h2>
          <div className={styles.cardSub}>{t(lang, 'admin_fleetsite_flow_sub')}</div>
          <FlowDiagram
            solarW={site.live_pv_power_w}
            loadW={site.live_load_power_w}
            batteryW={site.live_battery_power_w}
            batteryNote={site.live_soc_pct === null ? undefined : `${site.live_soc_pct}%`}
            gridW={site.live_grid_power_w}
            hasGridMeter={site.has_grid_meter}
          />
        </div>

        <div className={styles.gaugeCard}>
          <h2>
            {site.health_metrics_date
              ? t(lang, 'admin_fleetsite_as_of_date').replace('{date}', site.health_metrics_date)
              : t(lang, 'admin_fleetsite_today_glance')}
          </h2>
          <div className={styles.cardSub}>
            {t(lang, 'admin_fleetsite_gauge_sub_1')} <code>vrm.energy_daily</code> / <code>vrm.daily_health</code>{' '}
            {t(lang, 'admin_fleetsite_gauge_sub_2')}
          </div>

          {/* Split into System (equipment: alarms, SOC, cycling, temperature,
              voltage, float charge) and Grid (outages, grid dependency)
              scores, 2026-09-18 — a covered outage the battery held fine no
              longer drags down a single blended number that reads as
              "something's wrong" when nothing actually is. */}
          <div className={styles.scoreBlockRow}>
            <div className={styles.scoreBlock}>
              <div className={styles.scoreBlockLabel}>
                {t(lang, 'admin_fleetsite_score_system_label')}
                <InfoTooltip label={t(lang, 'score_info_system_tooltip_label')}>{systemScoreInfo(lang)}</InfoTooltip>
              </div>
              <div className={styles.healthRow}>
                <span className={`${styles.healthBadge} ${healthClass(site.system_score)}`}>
                  {site.system_score === null ? '—' : `${site.system_score}/100`}
                </span>
                {site.system_status && <span className={styles.healthStatus}>{site.system_status}</span>}
              </div>
              {site.system_score !== null && (
                <ul className={styles.healthNotes}>
                  {healthNotesList(site.system_notes).map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className={styles.scoreBlock}>
              <div className={styles.scoreBlockLabel}>
                {t(lang, 'admin_fleetsite_kpi_grid')}
                <InfoTooltip label={t(lang, 'score_info_grid_tooltip_label')}>{gridScoreInfo(lang)}</InfoTooltip>
              </div>
              {site.grid_score === null ? (
                <div className={styles.sub}>{t(lang, 'admin_fleetsite_no_grid_connection')}</div>
              ) : (
                <>
                  <div className={styles.healthRow}>
                    <span className={`${styles.healthBadge} ${healthClass(site.grid_score)}`}>
                      {site.grid_score}/100
                    </span>
                    {site.grid_status && <span className={styles.healthStatus}>{site.grid_status}</span>}
                  </div>
                  <ul className={styles.healthNotes}>
                    {healthNotesList(site.grid_notes).map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          <Gauge
            pct={site.self_sufficiency_pct}
            color="var(--good)"
            label={t(lang, 'admin_fleet_card_self_sufficiency_label')}
            desc={
              site.self_sufficiency_pct === null
                ? t(lang, 'admin_fleetsite_gauge_not_enough_data')
                : t(lang, 'admin_fleetsite_gauge_self_suff_desc').replace('{pct}', String(site.self_sufficiency_pct))
            }
          />
          <Gauge
            pct={site.self_consumption_pct}
            color="var(--victron-glow)"
            label={t(lang, 'admin_fleet_card_self_consumption_label')}
            desc={
              site.self_consumption_pct === null
                ? t(lang, 'admin_fleetsite_gauge_not_enough_data')
                : t(lang, 'admin_fleetsite_gauge_self_cons_desc').replace('{pct}', String(site.self_consumption_pct))
            }
          />
          <Gauge
            pct={site.dod_pct}
            color="var(--signal)"
            label={t(lang, 'admin_fleetsite_gauge_dod_label')}
            desc={
              site.dod_pct === null
                ? t(lang, 'admin_fleetsite_gauge_not_enough_data')
                : t(lang, 'admin_fleetsite_gauge_dod_desc').replace('{pct}', String(site.dod_pct))
            }
          />
        </div>
      </div>

      <div className={styles.gaugeCard} style={{ marginBottom: 24 }}>
        <h2>{t(lang, 'admin_fleetsite_anomalies_title')}</h2>
        <div className={styles.cardSub}>{t(lang, 'admin_fleetsite_anomalies_sub')}</div>
        {site.active_anomalies.length === 0 ? (
          <p className={styles.sub}>{t(lang, 'admin_fleetsite_no_anomalies')}</p>
        ) : (
          <ul className={styles.healthNotes}>
            {site.active_anomalies.map((a) => (
              <li key={a.id}>
                <strong>{anomalyTypeLabel(a.anomaly_type, lang)}</strong> — {anomalyDetailSummary(a, lang)}{' '}
                {t(lang, 'admin_fleetsite_anomaly_since').replace('{date}', formatDateTimeInZone(a.detected_at, site.timezone, 'en-US'))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <PeriodStatsPanel week={site.week} month={site.month} lang={lang} />

      <ShapeChart
        siteIds={[site.site_id]}
        title={t(lang, 'admin_fleetsite_shape_title')}
        cardSub={t(lang, 'admin_fleetsite_shape_sub')}
        lang={lang}
      />

      <div className={styles.metaRow}>
        {site.specific_yield_kwh_per_kwp !== null && (
          <span>{t(lang, 'admin_fleetsite_meta_yield').replace('{value}', String(site.specific_yield_kwh_per_kwp))}</span>
        )}
        {site.grid_dependency_pct !== null && (
          <span>{t(lang, 'admin_fleetsite_meta_grid_dep').replace('{value}', String(site.grid_dependency_pct))}</span>
        )}
        {site.pv_kwp !== null && <span>{t(lang, 'admin_fleetsite_meta_installed').replace('{value}', String(site.pv_kwp))}</span>}
        {site.battery_usable_kwh !== null && (
          <span>{t(lang, 'admin_fleetsite_meta_usable_batt').replace('{value}', String(site.battery_usable_kwh))}</span>
        )}
      </div>
    </div>
  );
}

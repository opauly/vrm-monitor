'use client';

// Admin report generation (PLAN_PHASE14.md §2 Step 7) — the admin-side
// counterpart of `app/(portal)/app/ReportManager.tsx`, extended with a
// schema toggle (`vrm` / `monitoring`) and a customer picker. Copy is
// English, inline (admin views went English-only 2026-08-19). No report
// math happens here — same §1.11 reasoning as the customer version: every
// number comes back inside a `report` job's `result.summary`, computed
// once, in `vrm_api`.
import { startTransition, useEffect, useState } from 'react';
import { Select, Stat } from '@/components/ui';
import { JobProgress, type JobProgressJob } from '@/components/app';
import type { SiteRecord } from '@/lib/server/db';
import type { AdminCustomerRow } from '@/lib/server/db/admin';
import type { Schema, SiteSummary } from '@/lib/server/pipeline';
import { t, type Lang } from '@/lib/i18n/strings';
import { getAvailableDatesForAdminAction, getReportLimitsAction, listMonitoringSitesAction } from './actions';
import styles from './reports.module.css';

type ReportSummary = {
  siteName: string;
  startStr: string;
  endStr: string;
  systemType: string;
  totals: {
    pv: number;
    load: number;
    grid: number;
    discharge: number;
    charge: number;
    outageCount: number;
    outageMinutes: number;
    // `false` when battery_charge_kwh/battery_discharge_kwh are unavailable
    // (VRM-API-ingested sites, PLAN_PHASE15.md §4.6) — `discharge`/`charge`
    // above are then a fabrication-safe 0.0, not a real reading. Typed here
    // for shape-accuracy even though this admin view has no energy-mix bar
    // of its own to gate on it (see `ReportManager.tsx`'s `EnergyMixBar`
    // for the customer-facing fix that actually needed this field).
    batteryKwhAvailable: boolean;
  };
  gridIndependencePct: number;
  avgHealth: number | string;
  healthStatus: string;
  // `null` for a site whose battery_charge_kwh/battery_discharge_kwh are
  // unavailable (e.g. VRM-API-ingested sites, PLAN_PHASE15.md §4.6) —
  // `weekly_report.py` distinguishes "no data" from "genuinely zero" rather
  // than fabricating 0.
  batteryCycles: number | null;
  battStressLabel: string;
  battStressColor: string;
  gridQualityScore: number;
  gridQualityStatus: string;
  gridQualityColor: string;
  weatherErrors: string[];
  missingDays: number;
  daysWithData: number;
  isOverview: boolean;
};

// Same admin/self-serve distinction `/admin/customers` filters by (its own
// `origin` column).
type OriginFilter = 'all' | 'admin' | 'self_serve';

function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

export function AdminReportsManager({
  vrmSites,
  customers,
  lang,
}: {
  vrmSites: SiteRecord[];
  customers: AdminCustomerRow[];
  lang: Lang;
}) {
  const [schema, setSchema] = useState<Schema>('vrm');
  const [customerId, setCustomerId] = useState<string>(customers[0]?.id ?? '');
  const [monitoringSites, setMonitoringSites] = useState<SiteSummary[] | null>(null);

  // Same admin/self-serve distinction `/admin/customers` filters by — Oscar's
  // own admin-linked installations vs. real signed-up subscribers. Only
  // meaningful for `schema === 'vrm'` (see below).
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const originFilteredCustomers = originFilter === 'all' ? customers : customers.filter((c) => c.origin === originFilter);

  // `monitoring.sites` has no `customer_id` FK at all (this schema predates
  // `vrm.customers` — it's Oscar's own Node-RED-monitored fleet, a single
  // tenant in every practical sense). Bug fix 2026-09-27: this used to try
  // matching `monitoring.sites.owner` text against `vrm.customers.name`,
  // which only ever matched one real customer by coincidence and silently
  // fell back to the FULL `vrm.customers` list otherwise — the exact same
  // list the `vrm` tab shows, which is what read as "switching Source does
  // nothing." Worse, since a customer was then almost always "selected"
  // (from that fallback list), the site list below filtered by owner-name
  // against it too, and usually matched nothing — a monitoring report could
  // silently have zero sites to pick from depending on which customer
  // happened to be selected. Every monitoring report is nominally Oscar's
  // own job regardless of which physical site, so there is no real choice
  // to offer here: lock it to the Pauly & Co Portfolio tenant (the same
  // shared admin-portfolio customer `victron/ingest.py`'s
  // `get_or_create_admin_portfolio_customer()` already uses) and show every
  // monitoring site unconditionally.
  const portfolioCustomer = customers.find((c) => c.slug === 'pauly-co-portfolio') ?? null;

  if (schema === 'monitoring' && portfolioCustomer && customerId !== portfolioCustomer.id) {
    setCustomerId(portfolioCustomer.id);
  }
  if (schema === 'vrm' && originFilteredCustomers.length > 0 && !originFilteredCustomers.some((c) => c.id === customerId)) {
    setCustomerId(originFilteredCustomers[0].id);
  }

  const sites: SiteSummary[] =
    schema === 'vrm'
      ? vrmSites
          .filter((s) => s.customer_id === customerId)
          .map((s) => ({ site_id: s.site_id, display_name: s.display_name, owner: null }))
      : (monitoringSites ?? []);

  const [siteId, setSiteId] = useState<string>('');
  const [limits, setLimits] = useState<{ max_custom_range_days: number; max_overview_range_days: number } | null>(null);
  const [dates, setDates] = useState<string[] | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Same "adjust state during render, not in an effect" shape
  // `ReportManager.tsx`'s own `trackedSiteId` comment documents — resets
  // everything downstream the instant `schema`/`customerId` change.
  const [trackedKey, setTrackedKey] = useState(`${schema}:${customerId}`);
  const currentKey = `${schema}:${customerId}`;
  if (currentKey !== trackedKey) {
    setTrackedKey(currentKey);
    setSiteId('');
    setDates(null);
    setSummary(null);
    setError(null);
    setStart('');
    setEnd('');
  }

  useEffect(() => {
    startTransition(async () => {
      const l = await getReportLimitsAction();
      setLimits(l);
    });
  }, []);

  useEffect(() => {
    if (schema !== 'monitoring') return;
    startTransition(async () => {
      const s = await listMonitoringSitesAction();
      setMonitoringSites(s);
    });
  }, [schema]);

  useEffect(() => {
    if (!siteId || !customerId) return;
    let cancelled = false;
    startTransition(async () => {
      const d = await getAvailableDatesForAdminAction(siteId, customerId, schema);
      if (cancelled) return;
      setDates(d);
      if (d.length > 0) {
        setStart(d[Math.max(0, d.length - 7)]);
        setEnd(d[d.length - 1]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [siteId, customerId, schema]);

  const numDays = start && end ? daysBetween(start, end) : 0;
  const isOverviewRange = !!limits && numDays > limits.max_custom_range_days;
  const tooLong = !!limits && numDays > limits.max_overview_range_days;
  const covered = dates && start && end ? dates.filter((d) => d >= start && d <= end).length : 0;

  async function handleGenerate() {
    setError(null);
    setSummary(null);
    setGenerating(true);
    try {
      const res = await fetch('/api/admin/pipeline/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, siteId, start, end, schema }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; maxDays?: number } | null;
        if (body?.error === 'range_too_long') {
          setError(t(lang, 'admin_reports_err_range_too_long').replace('{days}', String(numDays)).replace('{max}', String(body.maxDays ?? '—')));
        } else if (body?.error === 'not_authorized') {
          setError(t(lang, 'admin_reports_err_not_authorized'));
        } else {
          setError(t(lang, 'admin_reports_err_generate_generic'));
        }
        setGenerating(false);
        return;
      }
      const { job_id } = (await res.json()) as { job_id: string };
      setJobId(job_id);
    } catch {
      setError(t(lang, 'admin_reports_err_unreachable'));
      setGenerating(false);
    }
  }

  function handleJobDone(job: JobProgressJob) {
    const result = job.result as { summary?: ReportSummary } | null;
    setSummary(result?.summary ?? null);
    setGenerating(false);
  }

  function handleJobFailed(message: string) {
    setError(message);
    setGenerating(false);
  }

  async function handleDownload() {
    if (!jobId) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/admin/pipeline/reports/${encodeURIComponent(jobId)}/download`);
      if (!res.ok) {
        setError(t(lang, 'admin_reports_err_download_prep'));
        return;
      }
      const { url } = (await res.json()) as { url: string; filename: string };
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(t(lang, 'admin_reports_err_download_prep'));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className={styles.controls}>
        {schema === 'vrm' && (
          <label className={styles.controlField}>
            <span className={styles.controlLabel}>{t(lang, 'admin_customers_filter_origin')}</span>
            <Select value={originFilter} onChange={(e) => setOriginFilter(e.target.value as OriginFilter)}>
              <option value="all">{t(lang, 'admin_common_all')}</option>
              <option value="admin">{t(lang, 'admin_upload_origin_admin_note')}</option>
              <option value="self_serve">{t(lang, 'admin_upload_origin_self_serve_note')}</option>
            </Select>
          </label>
        )}
        <label className={styles.controlField}>
          <span className={styles.controlLabel}>{t(lang, 'admin_reports_field_source')}</span>
          <Select value={schema} onChange={(e) => setSchema(e.target.value as Schema)}>
            <option value="vrm">{t(lang, 'admin_reports_source_vrm')}</option>
            <option value="monitoring">{t(lang, 'admin_reports_source_monitoring')}</option>
          </Select>
        </label>
        <label className={styles.controlField}>
          <span className={styles.controlLabel}>
            {t(lang, 'admin_upload_field_customer')} {schema === 'monitoring' ? t(lang, 'admin_reports_customer_job_ref_only') : ''}
          </span>
          {schema === 'monitoring' ? (
            <Select value={customerId} disabled>
              {portfolioCustomer && <option value={portfolioCustomer.id}>{portfolioCustomer.name}</option>}
            </Select>
          ) : (
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {originFilteredCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </label>
        <label className={styles.controlField}>
          <span className={styles.controlLabel}>{t(lang, 'admin_sites_col_site')}</span>
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">{t(lang, 'admin_reports_choose_site_placeholder')}</option>
            {sites.map((s) => (
              <option key={s.site_id} value={s.site_id}>
                {s.display_name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {schema === 'monitoring' && (
        <p className={styles.caption}>
          <code>monitoring</code> {t(lang, 'admin_reports_monitoring_notice_1')} <code>owner</code>{' '}
          {t(lang, 'admin_reports_monitoring_notice_2')} <code>vrm.jobs.customer_id</code>
          {t(lang, 'admin_reports_monitoring_notice_3')}
        </p>
      )}

      {sites.length === 0 && <p className={styles.emptyPanel}>{t(lang, 'admin_reports_no_sites').replace('{schema}', schema)}</p>}

      {dates && dates.length === 0 && siteId && <p className={styles.emptyPanel}>{t(lang, 'admin_reports_no_data_yet')}</p>}

      {dates && dates.length > 0 && (
        <div className={styles.panel}>
          <p className={styles.caption}>
            {t(lang, 'admin_reports_available_data')
              .replace('{start}', dates[0])
              .replace('{end}', dates[dates.length - 1])
              .replace('{count}', String(dates.length))}
          </p>
          <div className={styles.controls}>
            <label className={styles.controlField}>
              <span className={styles.controlLabel}>{t(lang, 'admin_reports_field_start_date')}</span>
              <input type="date" className={styles.dateInput} value={start} min={dates[0]} max={end || dates[dates.length - 1]} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className={styles.controlField}>
              <span className={styles.controlLabel}>{t(lang, 'admin_reports_field_end_date')}</span>
              <input type="date" className={styles.dateInput} value={end} min={start || dates[0]} max={dates[dates.length - 1]} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>

          {limits && numDays > 0 && !tooLong && (
            <p className={styles.caption}>
              {isOverviewRange
                ? t(lang, 'admin_reports_overview_range').replace('{days}', String(numDays))
                : t(lang, 'admin_reports_detailed_range').replace('{days}', String(numDays))}
            </p>
          )}
          {tooLong && limits && (
            <p className={styles.error}>
              {t(lang, 'admin_reports_range_too_long').replace('{days}', String(numDays)).replace('{max}', String(limits.max_overview_range_days))}
            </p>
          )}
          {!tooLong && numDays > 0 && covered < numDays && (
            <p className={styles.warning}>
              {t(lang, 'admin_reports_partial_coverage')
                .replace('{start}', start)
                .replace('{end}', end)
                .replace('{covered}', String(covered))
                .replace('{total}', String(numDays))}
            </p>
          )}

          {error && <p className={styles.error}>{error}</p>}

          {!generating && (
            <button type="button" className={styles.generateButton} onClick={handleGenerate} disabled={!start || !end || tooLong}>
              {t(lang, 'admin_reports_generate_button')}
            </button>
          )}
          {generating && jobId && (
            <JobProgress
              jobId={jobId}
              endpoint="/api/admin/pipeline/jobs"
              runningLabel={t(lang, 'admin_reports_generating_label')}
              genericFailedLabel={t(lang, 'admin_upload_generic_failed')}
              unreachableLabel={t(lang, 'admin_reports_err_unreachable')}
              onDone={handleJobDone}
              onFailed={handleJobFailed}
            />
          )}
        </div>
      )}

      {summary && (
        <div className={styles.panel}>
          <div className={styles.statGrid}>
            <Stat label={t(lang, 'admin_reports_stat_solar')} value={summary.totals.pv.toFixed(1)} unit="kWh" />
            <Stat label={t(lang, 'admin_reports_stat_consumption')} value={summary.totals.load.toFixed(1)} unit="kWh" />
            <Stat label={t(lang, 'admin_reports_stat_independence')} value={summary.gridIndependencePct} unit="%" />
            <Stat label={t(lang, 'admin_reports_stat_health')} value={summary.avgHealth} unit={`/100 · ${summary.healthStatus}`} good />
          </div>

          {/* Reorganized 2026-08-19 at Oscar's request, mirroring the same
             change in pages/06_vrm_monitor.py's tab_report() and
             ReportManager.tsx: this panel is a quick "did this run
             correctly" glance before downloading, not a second copy of the
             report — grid quality, outages, and battery-stress cycle count
             are all already their own dedicated PDF sections
             (report_svg.py's Grid Quality block, Events block, and SALUD DE
             LA BATERÍA block). Kept: the four Stat cards above, system
             type/data coverage (genuine "is this the right site/window"
             context, not a restated PDF stat), and the
             weather-fetch-failure warning (not a duplicated number — a
             heads-up that a PDF section came out silently empty because an
             external call failed). */}
          <div className={styles.chipRow}>
            <span className={styles.chip}>{summary.systemType}</span>
            <span className={styles.chip}>
              {t(lang, 'admin_reports_days_with_data')
                .replace('{covered}', String(summary.daysWithData))
                .replace('{total}', String(summary.daysWithData + summary.missingDays))}
            </span>
          </div>

          <p className={styles.caption}>
            {t(lang, 'admin_reports_period_caption')
              .replace('{start}', summary.startStr)
              .replace('{end}', summary.endStr)
              .replace('{days}', String(summary.daysWithData))}
          </p>

          {summary.weatherErrors.length > 0 && <p className={styles.warning}>{t(lang, 'admin_reports_weather_error')}</p>}

          <button type="button" className={styles.generateButton} onClick={handleDownload} disabled={downloading}>
            {downloading ? t(lang, 'admin_reports_preparing') : t(lang, 'admin_reports_download_button')}
          </button>
        </div>
      )}
    </div>
  );
}

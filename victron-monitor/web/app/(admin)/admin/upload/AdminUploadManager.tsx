'use client';

// Admin upload flow (PLAN_PHASE14.md §2 Step 7) — the admin-side
// counterpart of `app/(portal)/app/upload/UploadManager.tsx`, with a
// customer picker in front of it. Copy is English, inline (admin views went
// English-only 2026-08-19; only the customer dashboard goes through
// `lib/i18n/strings.ts`). Same two-step parse -> preview -> confirm shape,
// against the admin proxy routes (`/api/admin/uploads/sign`,
// `/api/admin/pipeline/ingest/*`) instead of the customer ones.
import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Select, Table } from '@/components/ui';
import { JobProgress, type JobProgressJob } from '@/components/app';
import { COUNTRIES, DEFAULT_COUNTRY } from '@/lib/countries';
import { SUPPORTED_FLAT_CURRENCIES } from '@/lib/currencies';
import { listTimezones, DEFAULT_TIMEZONE } from '@/lib/timezones';
import { MAX_UPLOAD_BYTES, formatBytes } from '@/lib/uploadLimits';
import { uploadFileToSignedUrl } from '@/lib/uploadClient';
import { formatDateTime } from '@/lib/dates';
import type { AdminCustomerRow } from '@/lib/server/db/admin';
import type { SiteRecord } from '@/lib/server/db';
import { t, type Lang } from '@/lib/i18n/strings';
import { getCustomerUploadContextAction, type AdminUploadContext } from './actions';
import styles from './upload.module.css';

type SiteFieldsState = {
  displayName: string;
  pvKwp: string;
  battNominal: string;
  battDod: string;
  systemType: 'hybrid' | 'off_grid' | 'grid_zero';
  reportLanguage: 'en' | 'es';
  latitude: string;
  longitude: string;
  location: string;
  timezone: string;
  country: string;
  savingsRate: string;
  savingsCurrency: string;
  exportsToGrid: boolean;
};

const NEW_SITE_VALUE = '__new__';

// Same admin/self-serve distinction `/admin/customers` filters by (its own
// `origin` column) — Oscar's own admin-linked installations vs. real signed-up
// subscribers. A togglable filter here, not a hard exclusion, so either
// population stays reachable.
type OriginFilter = 'all' | 'admin' | 'self_serve';

function emptyFields(): SiteFieldsState {
  return {
    displayName: '',
    pvKwp: '',
    battNominal: '',
    battDod: '',
    systemType: 'hybrid',
    reportLanguage: 'en',
    latitude: '',
    longitude: '',
    location: '',
    timezone: DEFAULT_TIMEZONE,
    country: DEFAULT_COUNTRY,
    savingsRate: '',
    savingsCurrency: 'USD',
    exportsToGrid: false,
  };
}

function fieldsFromSite(site: SiteRecord): SiteFieldsState {
  return {
    displayName: site.display_name,
    pvKwp: site.pv_kwp?.toString() ?? '',
    battNominal: site.battery_nominal_kwh?.toString() ?? '',
    battDod: site.battery_dod_pct?.toString() ?? '',
    systemType: site.system_type,
    reportLanguage: site.report_language,
    latitude: site.latitude?.toString() ?? '',
    longitude: site.longitude?.toString() ?? '',
    location: site.location ?? '',
    timezone: site.timezone,
    country: site.country ?? DEFAULT_COUNTRY,
    savingsRate: site.savings_rate?.toString() ?? '',
    savingsCurrency: site.savings_currency ?? 'USD',
    exportsToGrid: site.exports_to_grid,
  };
}

function toNumberOrNull(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

type Phase = 'form' | 'signing' | 'uploading' | 'previewing' | 'preview_ready' | 'committing' | 'done' | 'error';

type PreviewResult = {
  site_id: string;
  site_is_existing: boolean;
  site_name: string;
  storage_path: string;
  site_fields: Record<string, unknown>;
  parsed: {
    installation_id: string | number | null;
    timezone_label: string;
    sample_count: number;
    period_start: string;
    period_end: string;
    rows: Array<{
      date: string;
      pv_kwh: number;
      load_kwh: number;
      grid_kwh: number;
      battery_charge_kwh: number;
      battery_discharge_kwh: number;
      min_soc: number | null;
      max_soc: number | null;
      outage_count: number;
      outage_minutes: number;
      complete_day: boolean;
    }>;
    alarm_events: unknown[];
    outages: unknown[];
    warnings: string[];
  };
};

type CommitResult = { site_id: string; rows_written: number; alarm_events_written: number };

const TIMEZONES = listTimezones();
const COUNTRY_CODES = Object.keys(COUNTRIES);

export function AdminUploadManager({ customers, lang }: { customers: AdminCustomerRow[]; lang: Lang }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const visibleCustomers = originFilter === 'all' ? customers : customers.filter((c) => c.origin === originFilter);

  const [customerId, setCustomerId] = useState<string>(visibleCustomers[0]?.id ?? '');
  const [context, setContext] = useState<AdminUploadContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  const [siteSelection, setSiteSelection] = useState<string>('');
  const [fields, setFields] = useState<SiteFieldsState>(emptyFields());
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [uploadPct, setUploadPct] = useState(0);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [commitJobId, setCommitJobId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function resetUploadState() {
    setFile(null);
    setPhase('form');
    setPreviewJobId(null);
    setCommitJobId(null);
    setPreview(null);
    setCommitResult(null);
    setErrorMessage(null);
  }

  // Flipping the Origin filter can leave `customerId` pointing at a
  // customer the new filter hides — same render-time correction
  // `AdminReportsManager.tsx`'s own Origin/Source narrowing uses, so the
  // Select never shows a value that isn't one of its own options.
  if (customerId && visibleCustomers.length > 0 && !visibleCustomers.some((c) => c.id === customerId)) {
    setCustomerId(visibleCustomers[0].id);
  }

  // "Adjusting state when a prop/state change happens" during render, not
  // in an effect — same pattern (and the same reason:
  // `react-hooks/set-state-in-effect`) `ReportManager.tsx`'s own
  // `trackedSiteId` comment documents. `loadingContext`/`context`/the
  // upload-flow state all reset the instant `customerId` changes, in the
  // same render pass that noticed the change, rather than as a side effect
  // one tick later.
  const [trackedCustomerId, setTrackedCustomerId] = useState(customerId);
  if (customerId !== trackedCustomerId) {
    setTrackedCustomerId(customerId);
    setContext(null);
    setLoadingContext(true);
    setSiteSelection('');
    setFields(emptyFields());
    resetUploadState();
  }

  // The actual side effect (fetching this customer's sites/uploads) still
  // belongs in an effect — this is the "Subscribe for updates ... calling
  // setState in a callback" shape the lint rule's own message endorses, not
  // the synchronous-at-the-top-of-the-effect shape it flags.
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    startTransition(async () => {
      const ctx = await getCustomerUploadContextAction(customerId);
      if (cancelled) return;
      setContext(ctx);
      setLoadingContext(false);
      setSiteSelection(ctx.sites[0]?.site_id ?? (ctx.canAdd.ok ? NEW_SITE_VALUE : ''));
      setFields(ctx.sites[0] ? fieldsFromSite(ctx.sites[0]) : emptyFields());
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // File inputs are uncontrolled — clearing a previously-picked file when
  // the customer changes has to go through the DOM node directly, which is
  // a ref write and therefore effect-only (JobProgress.tsx's own comment on
  // why a ref is never mutated during render applies here too).
  useEffect(() => {
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [customerId]);

  const usableKwh = useMemo(() => {
    const n = Number(fields.battNominal);
    const d = Number(fields.battDod);
    if (!fields.battNominal || !fields.battDod || !Number.isFinite(n) || !Number.isFinite(d)) return null;
    return Math.round(((n * d) / 100) * 100) / 100;
  }, [fields.battNominal, fields.battDod]);

  function handleSiteSelectionChange(value: string) {
    setSiteSelection(value);
    if (value === NEW_SITE_VALUE) {
      setFields(emptyFields());
    } else {
      const site = context?.sites.find((s) => s.site_id === value);
      if (site) setFields(fieldsFromSite(site));
    }
  }

  function buildSiteFields(): Record<string, unknown> {
    return {
      display_name: fields.displayName.trim(),
      pv_kwp: toNumberOrNull(fields.pvKwp),
      battery_nominal_kwh: toNumberOrNull(fields.battNominal),
      battery_dod_pct: toNumberOrNull(fields.battDod),
      system_type: fields.systemType,
      report_language: fields.reportLanguage,
      location: fields.location.trim() || null,
      timezone: fields.timezone,
      latitude: toNumberOrNull(fields.latitude),
      longitude: toNumberOrNull(fields.longitude),
      country: fields.country,
      savings_rate: toNumberOrNull(fields.savingsRate),
      savings_currency: fields.savingsRate ? fields.savingsCurrency : null,
      exports_to_grid: fields.exportsToGrid,
    };
  }

  async function handleProcessClick() {
    setErrorMessage(null);
    if (!customerId || !file || !fields.displayName.trim()) {
      setErrorMessage(t(lang, 'admin_upload_err_choose_all'));
      return;
    }

    try {
      setPhase('signing');
      const signRes = await fetch('/api/admin/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, filename: file.name, sizeBytes: file.size }),
      });
      if (signRes.status === 413) {
        setErrorMessage(t(lang, 'admin_upload_err_file_too_large').replace('{limit}', formatBytes(MAX_UPLOAD_BYTES)));
        setPhase('form');
        return;
      }
      if (!signRes.ok) {
        setErrorMessage(t(lang, 'admin_upload_err_process_generic'));
        setPhase('form');
        return;
      }
      const { uploadUrl, path } = (await signRes.json()) as { uploadUrl: string; path: string };

      setPhase('uploading');
      setUploadPct(0);
      await uploadFileToSignedUrl(uploadUrl, file, setUploadPct);

      setPhase('previewing');
      const previewRes = await fetch('/api/admin/pipeline/ingest/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          siteSelection === NEW_SITE_VALUE
            ? { siteSelection: 'new', customerId, newSiteName: fields.displayName.trim(), storagePath: path, filename: file.name, siteFields: buildSiteFields() }
            : { siteSelection: 'existing', customerId, siteId: siteSelection, storagePath: path, filename: file.name, siteFields: buildSiteFields() },
        ),
      });
      if (!previewRes.ok) {
        setErrorMessage(t(lang, 'admin_upload_err_process_generic'));
        setPhase('error');
        return;
      }
      const { job_id } = (await previewRes.json()) as { job_id: string };
      setPreviewJobId(job_id);
    } catch {
      setErrorMessage(t(lang, 'admin_upload_err_unreachable_moment'));
      setPhase('error');
    }
  }

  function handlePreviewJobDone(job: JobProgressJob) {
    setPreview(job.result as unknown as PreviewResult);
    setPhase('preview_ready');
  }

  function handlePreviewJobFailed(message: string) {
    setErrorMessage(message);
    setPhase('error');
  }

  async function handleConfirmClick() {
    if (!previewJobId) return;
    setErrorMessage(null);
    try {
      setPhase('committing');
      const res = await fetch('/api/admin/pipeline/ingest/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: previewJobId }),
      });
      if (!res.ok) {
        setErrorMessage(t(lang, 'admin_upload_err_import_generic'));
        setPhase('error');
        return;
      }
      const { job_id } = (await res.json()) as { job_id: string };
      setCommitJobId(job_id);
    } catch {
      setErrorMessage(t(lang, 'admin_upload_err_unreachable_moment'));
      setPhase('error');
    }
  }

  function handleCommitJobDone(job: JobProgressJob) {
    setCommitResult(job.result as unknown as CommitResult);
    setPhase('done');
    router.refresh();
    // Re-fetch this customer's context so the new site/upload history shows
    // up without switching customers and back.
    startTransition(async () => {
      const ctx = await getCustomerUploadContextAction(customerId);
      setContext(ctx);
    });
  }

  function handleCommitJobFailed(message: string) {
    setErrorMessage(message);
    setPhase('error');
  }

  const formDisabled = phase !== 'form' && phase !== 'error';

  return (
    <div>
      <div className={styles.panel}>
        <div className={styles.fieldRow}>
          <Field label={t(lang, 'admin_customers_filter_origin')} htmlFor="admin-upload-origin">
            <Select id="admin-upload-origin" value={originFilter} onChange={(e) => setOriginFilter(e.target.value as OriginFilter)} disabled={formDisabled}>
              <option value="all">{t(lang, 'admin_common_all')}</option>
              <option value="admin">{t(lang, 'admin_upload_origin_admin_note')}</option>
              <option value="self_serve">{t(lang, 'admin_upload_origin_self_serve_note')}</option>
            </Select>
          </Field>
          <Field label={t(lang, 'admin_upload_field_customer')} htmlFor="admin-upload-customer">
            <Select id="admin-upload-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={formDisabled}>
              {visibleCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {loadingContext && <p className={styles.status}>{t(lang, 'admin_upload_loading')}</p>}

      {context && phase !== 'done' && (
        <div className={styles.panel}>
          <div className={styles.fieldRow}>
            <Field label={t(lang, 'admin_upload_field_site')} htmlFor="admin-upload-site">
              <Select id="admin-upload-site" value={siteSelection} onChange={(e) => handleSiteSelectionChange(e.target.value)} disabled={formDisabled}>
                {context.sites.map((s) => (
                  <option key={s.site_id} value={s.site_id}>
                    {s.display_name}
                  </option>
                ))}
                {context.canAdd.ok && <option value={NEW_SITE_VALUE}>{t(lang, 'admin_upload_new_site_option')}</option>}
              </Select>
            </Field>
            <Field
              label={siteSelection === NEW_SITE_VALUE ? t(lang, 'admin_upload_field_new_site_name') : t(lang, 'admin_upload_field_site_name')}
              htmlFor="admin-upload-site-name"
              required
            >
              <Input
                id="admin-upload-site-name"
                value={fields.displayName}
                onChange={(e) => setFields((f) => ({ ...f, displayName: e.target.value }))}
                disabled={formDisabled}
                required
              />
            </Field>
          </div>

          {!context.canAdd.ok && context.sites.length === 0 && <p className={styles.error}>{t(lang, 'admin_upload_err_site_limit')}</p>}

          <div className={styles.fieldRow}>
            <Field label={t(lang, 'sites_field_pv_kwp')} htmlFor="admin-upload-kwp">
              <Input
                id="admin-upload-kwp"
                type="number"
                step="0.1"
                min="0"
                value={fields.pvKwp}
                onChange={(e) => setFields((f) => ({ ...f, pvKwp: e.target.value }))}
                disabled={formDisabled}
              />
            </Field>
            <Field label={t(lang, 'sites_field_system_type')} htmlFor="admin-upload-type">
              <Select
                id="admin-upload-type"
                value={fields.systemType}
                onChange={(e) => setFields((f) => ({ ...f, systemType: e.target.value as SiteFieldsState['systemType'] }))}
                disabled={formDisabled}
              >
                <option value="hybrid">{t(lang, 'system_type_hybrid')}</option>
                <option value="off_grid">{t(lang, 'system_type_off_grid')}</option>
                <option value="grid_zero">{t(lang, 'system_type_grid_zero')}</option>
              </Select>
            </Field>
            <Field label={t(lang, 'sites_field_report_language')} htmlFor="admin-upload-lang">
              <Select
                id="admin-upload-lang"
                value={fields.reportLanguage}
                onChange={(e) => setFields((f) => ({ ...f, reportLanguage: e.target.value as 'en' | 'es' }))}
                disabled={formDisabled}
              >
                <option value="en">{t(lang, 'lang_en')}</option>
                <option value="es">{t(lang, 'lang_es')}</option>
              </Select>
            </Field>
          </div>

          <div className={styles.fieldRow}>
            <Field label={t(lang, 'admin_sites_field_battery_nominal')} htmlFor="admin-upload-batt-nominal">
              <Input
                id="admin-upload-batt-nominal"
                type="number"
                step="0.1"
                min="0"
                value={fields.battNominal}
                onChange={(e) => setFields((f) => ({ ...f, battNominal: e.target.value }))}
                disabled={formDisabled}
              />
            </Field>
            <Field label={t(lang, 'sites_field_battery_dod')} htmlFor="admin-upload-batt-dod">
              <Input
                id="admin-upload-batt-dod"
                type="number"
                step="1"
                min="0"
                max="100"
                value={fields.battDod}
                onChange={(e) => setFields((f) => ({ ...f, battDod: e.target.value }))}
                disabled={formDisabled}
              />
            </Field>
          </div>
          {usableKwh !== null && (
            <p className={styles.caption}>{t(lang, 'sites_field_battery_usable_caption').replace('{value}', usableKwh.toFixed(2))}</p>
          )}

          <div className={styles.fieldRow}>
            <Field label={t(lang, 'sites_field_latitude')} htmlFor="admin-upload-lat">
              <Input
                id="admin-upload-lat"
                type="number"
                step="0.000001"
                value={fields.latitude}
                onChange={(e) => setFields((f) => ({ ...f, latitude: e.target.value }))}
                disabled={formDisabled}
              />
            </Field>
            <Field label={t(lang, 'sites_field_longitude')} htmlFor="admin-upload-lng">
              <Input
                id="admin-upload-lng"
                type="number"
                step="0.000001"
                value={fields.longitude}
                onChange={(e) => setFields((f) => ({ ...f, longitude: e.target.value }))}
                disabled={formDisabled}
              />
            </Field>
            <Field label={t(lang, 'sites_field_location')} htmlFor="admin-upload-loc">
              <Input
                id="admin-upload-loc"
                value={fields.location}
                onChange={(e) => setFields((f) => ({ ...f, location: e.target.value }))}
                disabled={formDisabled}
              />
            </Field>
          </div>

          <div className={styles.fieldRow}>
            <Field label={t(lang, 'sites_field_timezone')} htmlFor="admin-upload-tz">
              <Select id="admin-upload-tz" value={fields.timezone} onChange={(e) => setFields((f) => ({ ...f, timezone: e.target.value }))} disabled={formDisabled}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t(lang, 'sites_field_country')} htmlFor="admin-upload-country">
              <Select id="admin-upload-country" value={fields.country} onChange={(e) => setFields((f) => ({ ...f, country: e.target.value }))} disabled={formDisabled}>
                {COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {COUNTRIES[code]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className={styles.fieldRow}>
            <Field label={t(lang, 'admin_upload_field_rate')} htmlFor="admin-upload-rate">
              <Input
                id="admin-upload-rate"
                type="number"
                step="0.0001"
                min="0"
                value={fields.savingsRate}
                onChange={(e) => setFields((f) => ({ ...f, savingsRate: e.target.value }))}
                disabled={formDisabled}
              />
            </Field>
            <Field label={t(lang, 'sites_field_savings_currency')} htmlFor="admin-upload-currency">
              <Select
                id="admin-upload-currency"
                value={fields.savingsCurrency}
                onChange={(e) => setFields((f) => ({ ...f, savingsCurrency: e.target.value }))}
                disabled={formDisabled}
              >
                {SUPPORTED_FLAT_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={fields.exportsToGrid}
              onChange={(e) => setFields((f) => ({ ...f, exportsToGrid: e.target.checked }))}
              disabled={formDisabled}
            />
            {t(lang, 'sites_field_exports_to_grid')}
          </label>

          <div className={styles.fileRow}>
            <Field label={t(lang, 'admin_upload_field_file')} htmlFor="admin-upload-file">
              <input
                ref={fileInputRef}
                id="admin-upload-file"
                type="file"
                accept=".csv"
                className={styles.fileInput}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={formDisabled}
              />
            </Field>
          </div>
          <p className={styles.caption}>{t(lang, 'admin_upload_limit_caption').replace('{limit}', formatBytes(MAX_UPLOAD_BYTES))}</p>

          {errorMessage && phase !== 'preview_ready' && <p className={styles.error}>{errorMessage}</p>}

          {phase === 'form' || phase === 'error' ? (
            <Button type="button" onClick={handleProcessClick} disabled={!file || !siteSelection}>
              {t(lang, 'admin_upload_process_button')}
            </Button>
          ) : null}

          {phase === 'signing' && <p className={styles.status}>{t(lang, 'admin_upload_preparing')}</p>}
          {phase === 'uploading' && <p className={styles.status}>{t(lang, 'admin_upload_uploading').replace('{pct}', String(uploadPct))}</p>}
          {phase === 'previewing' && previewJobId && (
            <JobProgress
              jobId={previewJobId}
              endpoint="/api/admin/pipeline/jobs"
              runningLabel={t(lang, 'admin_upload_processing_label')}
              genericFailedLabel={t(lang, 'admin_upload_generic_failed')}
              unreachableLabel={t(lang, 'admin_upload_unreachable')}
              onDone={handlePreviewJobDone}
              onFailed={handlePreviewJobFailed}
            />
          )}
        </div>
      )}

      {preview && (phase === 'preview_ready' || phase === 'committing') && (
        <div className={styles.panel}>
          <h3>{t(lang, 'admin_upload_preview_title')}</h3>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryStat}>
              <div className={styles.summaryLbl}>{t(lang, 'admin_upload_stat_days')}</div>
              <div className={styles.summaryVal}>{preview.parsed.rows.length}</div>
            </div>
            <div className={styles.summaryStat}>
              <div className={styles.summaryLbl}>{t(lang, 'admin_upload_stat_samples')}</div>
              <div className={styles.summaryVal}>{preview.parsed.sample_count.toLocaleString()}</div>
            </div>
            <div className={styles.summaryStat}>
              <div className={styles.summaryLbl}>{t(lang, 'admin_upload_stat_alarms')}</div>
              <div className={styles.summaryVal}>{preview.parsed.alarm_events.length}</div>
            </div>
            <div className={styles.summaryStat}>
              <div className={styles.summaryLbl}>{t(lang, 'admin_upload_stat_outages')}</div>
              <div className={styles.summaryVal}>{preview.parsed.outages.length}</div>
            </div>
          </div>
          <p className={styles.caption}>
            {t(lang, 'admin_upload_preview_caption')
              .replace('{id}', String(preview.parsed.installation_id ?? '—'))
              .replace('{start}', preview.parsed.period_start.slice(0, 10))
              .replace('{end}', preview.parsed.period_end.slice(0, 10))
              .replace('{tz}', preview.parsed.timezone_label)}
          </p>

          {preview.parsed.warnings.length > 0 && (
            <div className={styles.warnings}>
              <strong>{t(lang, 'admin_upload_warnings_label')}</strong>
              <ul>
                {preview.parsed.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.tableScroll}>
            <Table>
              <thead>
                <tr>
                  <th>{t(lang, 'admin_upload_col_date')}</th>
                  <th>{t(lang, 'admin_upload_col_pv')}</th>
                  <th>{t(lang, 'admin_upload_col_load')}</th>
                  <th>{t(lang, 'admin_upload_col_grid')}</th>
                  <th>{t(lang, 'admin_upload_col_charge')}</th>
                  <th>{t(lang, 'admin_upload_col_discharge')}</th>
                  <th>{t(lang, 'admin_upload_col_min_soc')}</th>
                  <th>{t(lang, 'admin_upload_col_max_soc')}</th>
                  <th>{t(lang, 'admin_upload_col_outages')}</th>
                  <th>{t(lang, 'admin_upload_col_outage_min')}</th>
                  <th>{t(lang, 'admin_upload_col_complete')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.parsed.rows.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td>{r.pv_kwh}</td>
                    <td>{r.load_kwh}</td>
                    <td>{r.grid_kwh}</td>
                    <td>{r.battery_charge_kwh}</td>
                    <td>{r.battery_discharge_kwh}</td>
                    <td>{r.min_soc ?? '—'}</td>
                    <td>{r.max_soc ?? '—'}</td>
                    <td>{r.outage_count}</td>
                    <td>{r.outage_minutes}</td>
                    <td>{r.complete_day ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {errorMessage && <p className={styles.error}>{errorMessage}</p>}

          {phase === 'preview_ready' && (
            <Button type="button" onClick={handleConfirmClick}>
              {t(lang, 'admin_upload_import_button')}
            </Button>
          )}
          {phase === 'committing' && commitJobId && (
            <JobProgress
              jobId={commitJobId}
              endpoint="/api/admin/pipeline/jobs"
              runningLabel={t(lang, 'admin_upload_writing_label')}
              genericFailedLabel={t(lang, 'admin_upload_generic_failed')}
              unreachableLabel={t(lang, 'admin_upload_unreachable')}
              onDone={handleCommitJobDone}
              onFailed={handleCommitJobFailed}
            />
          )}
        </div>
      )}

      {phase === 'done' && commitResult && (
        <div className={styles.panel}>
          <p className={styles.success}>
            {t(lang, 'admin_upload_success')
              .replace('{days}', String(commitResult.rows_written))
              .replace('{alarms}', String(commitResult.alarm_events_written))
              .replace('{site}', commitResult.site_id)}
          </p>
          <div className={styles.formActions}>
            <Button type="button" onClick={resetUploadState}>
              {t(lang, 'admin_upload_another_button')}
            </Button>
          </div>
        </div>
      )}

      {context && (
        <>
          <h2 className={styles.historyTitle}>{t(lang, 'admin_upload_history_title')}</h2>
          {context.ingestions.length === 0 ? (
            <p className={styles.intro}>{t(lang, 'admin_upload_no_uploads')}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>{t(lang, 'admin_upload_col_hist_site')}</th>
                  <th>{t(lang, 'admin_upload_col_hist_file')}</th>
                  <th>{t(lang, 'admin_upload_col_hist_period')}</th>
                  <th>{t(lang, 'admin_upload_col_hist_days')}</th>
                  <th>{t(lang, 'admin_upload_col_hist_alarms')}</th>
                  <th>{t(lang, 'admin_upload_col_hist_uploaded')}</th>
                </tr>
              </thead>
              <tbody>
                {context.ingestions.map((log) => {
                  const site = context.sites.find((s) => s.site_id === log.site_id);
                  return (
                    <tr key={log.id}>
                      <td>{site?.display_name ?? log.site_id}</td>
                      <td>{log.filename ?? '—'}</td>
                      <td>
                        {log.period_start?.slice(0, 10) ?? '—'} → {log.period_end?.slice(0, 10) ?? '—'}
                      </td>
                      <td>{log.rows_written ?? '—'}</td>
                      <td>{log.alarm_events_written ?? '—'}</td>
                      <td>{formatDateTime(log.uploaded_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}

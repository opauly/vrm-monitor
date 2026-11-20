'use client';

// "New system found in VRM": a banner per waiting system, and the wizard that turns one into a monitored site.
// Used on the customer's Sites page (systems found in their own VRM account) and on the admin's Link installations
// page (systems in the admin's account, where the admin also picks the customer). What VRM already reports
// (inverter, battery modules, solar equipment, system type, reserve) arrives filled in; the wizard only asks for
// what VRM cannot know — the panels' kWp, the battery size when modules don't say it, and where the site is.
// After "Add", the first import runs (from the day the system was created) and a short checklist follows.
import { useMemo, useState } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { JobProgress } from '@/components/app/JobProgress/JobProgress';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import { listTimezones, DEFAULT_TIMEZONE } from '@/lib/timezones';
import { SUPPORTED_FLAT_CURRENCIES } from '@/lib/currencies';
import type { NewInstallation } from '@/lib/server/db/newInstallations';
import type { NewSiteWizardValues } from '@/lib/server/newSiteWizard';
import styles from './NewSites.module.css';

type AddResult = { ok: true; siteId: string; jobId: string } | { ok: false; error: 'invalid' | 'limit' | 'gone' | 'linked' | 'failed'; field?: string };

export type NewSitesCustomer = { id: string; name: string; slug: string };

export type NewSitesProps = {
  items: NewInstallation[];
  lang: Lang;
  mode: 'customer' | 'admin';
  /** Admin only: who the site can go to. The Pauly & Co Portfolio account is offered first. */
  customers?: NewSitesCustomer[];
  /** Customer only: false when the plan's site limit is reached. */
  canAdd?: boolean;
  add: (id: string, values: NewSiteWizardValues, target: { customerId: string | null; newCustomerName: string | null }) => Promise<AddResult>;
  dismiss: (id: string) => Promise<{ ok: boolean }>;
  check?: () => Promise<{ ok: boolean; found: number }>;
};

// A few common module sizes, so "4 modules" becomes a bank size in one tap. Any other battery is typed in.
const MODULE_PRESETS: { label: string; kwh: number }[] = [
  { label: 'Pylontech US2000C', kwh: 2.4 },
  { label: 'Pylontech US3000C', kwh: 3.55 },
  { label: 'Pylontech US5000', kwh: 4.8 },
  { label: 'Pylontech UP5000', kwh: 4.8 },
];

const TIMEZONES = listTimezones();

type Step = 'found' | 'system' | 'place' | 'review' | 'importing' | 'done';

type Form = {
  displayName: string;
  systemType: 'hybrid' | 'off_grid' | 'grid_zero';
  pvKwp: string;
  panelCount: string;
  panelWatts: string;
  inverterKw: string;
  batteryKwh: string;
  moduleKwh: string;
  batteryDod: string;
  reserve: string;
  coords: string;
  timezone: string;
  reportLanguage: 'en' | 'es';
  savingsRate: string;
  savingsCurrency: string;
  exportsToGrid: boolean;
  customerChoice: string;      // a customer id, or NEW
  newCustomerName: string;
};

const NEW = '__new__';

function num(s: string): number | null {
  const n = Number(String(s).replace(',', '.').trim());
  return String(s).trim() !== '' && Number.isFinite(n) ? n : null;
}

/** "9.9281, -84.0907", "9.9281 -84.0907" or a Google Maps link → [lat, lng]. */
export function parseCoords(s: string): [number, number] | null {
  const at = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const m = at ?? s.match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

function initialForm(item: NewInstallation, lang: Lang, customers: NewSitesCustomer[] | undefined): Form {
  const f = item.prefill?.fields;
  const tz = f?.timezone && TIMEZONES.includes(f.timezone) ? f.timezone : DEFAULT_TIMEZONE;
  const portfolio = customers?.find((c) => c.slug === 'pauly-co-portfolio');
  return {
    displayName: f?.display_name ?? item.name ?? '',
    systemType: f?.system_type ?? 'hybrid',
    pvKwp: f?.pv_kwp != null ? String(f.pv_kwp) : '',
    panelCount: '',
    panelWatts: '',
    inverterKw: f?.inverter_nominal_kw != null ? String(f.inverter_nominal_kw) : '',
    batteryKwh: f?.battery_nominal_kwh != null ? String(f.battery_nominal_kwh) : '',
    moduleKwh: '',
    batteryDod: f?.battery_dod_pct != null ? String(f.battery_dod_pct) : '',
    reserve: f?.reserve_soc_pct != null ? String(f.reserve_soc_pct) : '',
    coords: f?.latitude != null && f?.longitude != null ? `${f.latitude}, ${f.longitude}` : '',
    timezone: tz,
    reportLanguage: lang,
    savingsRate: '',
    savingsCurrency: 'CRC',
    exportsToGrid: false,
    customerChoice: portfolio?.id ?? customers?.[0]?.id ?? NEW,
    newCustomerName: '',
  };
}

function equipmentLines(item: NewInstallation, lang: Lang): string[] {
  const eq = item.prefill?.equipment;
  if (!eq) return [];
  const lines: string[] = [];
  if (eq.inverter) {
    lines.push(eq.inverter.units > 1
      ? t(lang, 'newsite_eq_inverter_many').replace('{n}', String(eq.inverter.units)).replace('{model}', eq.inverter.model)
      : eq.inverter.model);
  }
  if (eq.battery) {
    const name = eq.battery.maker || eq.battery.product || t(lang, 'newsite_eq_battery');
    lines.push(eq.battery.modules ? t(lang, 'newsite_eq_modules').replace('{n}', String(eq.battery.modules)).replace('{maker}', name) : name);
  }
  for (const c of [...eq.chargers, ...eq.pv_inverters]) lines.push(c.count > 1 ? `${c.count} × ${c.model}` : c.model);
  if (eq.grid_meter) lines.push(eq.grid_meter);
  if (eq.gateway) lines.push(eq.gateway);
  return lines;
}

function Wizard({ item, lang, mode, customers, add, onClose }: {
  item: NewInstallation; lang: Lang; mode: 'customer' | 'admin'; customers?: NewSitesCustomer[];
  add: NewSitesProps['add']; onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('found');
  const [form, setForm] = useState<Form>(() => initialForm(item, lang, customers));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<{ jobId: string; siteId: string } | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const eq = item.prefill?.equipment ?? null;
  const hasBattery = !!eq?.battery || eq == null;
  const modules = eq?.battery?.modules ?? null;
  const offGrid = form.systemType === 'off_grid';
  const coords = parseCoords(form.coords);
  const lines = equipmentLines(item, lang);

  const fromPanels = num(form.panelCount) && num(form.panelWatts) ? Math.round((num(form.panelCount)! * num(form.panelWatts)!) / 10) / 100 : null;
  const pvKwp = num(form.pvKwp) ?? fromPanels;
  const fromModules = modules && num(form.moduleKwh) ? Math.round(modules * num(form.moduleKwh)! * 100) / 100 : null;
  const batteryKwh = num(form.batteryKwh) ?? fromModules;

  const systemReady = !!form.displayName.trim() && pvKwp != null && pvKwp > 0 && (!hasBattery || (batteryKwh != null && batteryKwh > 0));
  const placeReady = coords != null && (mode === 'customer' || (form.customerChoice !== NEW || !!form.newCustomerName.trim()));

  const values = useMemo<NewSiteWizardValues | null>(() => {
    if (!coords || pvKwp == null) return null;
    return {
      displayName: form.displayName.trim(),
      systemType: form.systemType,
      pvKwp,
      inverterKw: num(form.inverterKw),
      batteryKwh: hasBattery ? batteryKwh : null,
      batteryDodPct: hasBattery ? num(form.batteryDod) : null,
      reserveSocPct: hasBattery && !offGrid ? num(form.reserve) : null,
      latitude: coords[0],
      longitude: coords[1],
      timezone: form.timezone,
      reportLanguage: form.reportLanguage,
      savingsRate: offGrid ? null : num(form.savingsRate),
      savingsCurrency: offGrid ? null : form.savingsCurrency,
      exportsToGrid: !offGrid && form.exportsToGrid,
    };
  }, [form, coords, pvKwp, batteryKwh, hasBattery, offGrid]);

  async function submit() {
    if (!values) return;
    setBusy(true);
    setError(null);
    const target = mode === 'admin'
      ? { customerId: form.customerChoice === NEW ? null : form.customerChoice, newCustomerName: form.customerChoice === NEW ? form.newCustomerName : null }
      : { customerId: null, newCustomerName: null };
    const res = await add(item.id, values, target);
    setBusy(false);
    if (res.ok) {
      setJob({ jobId: res.jobId, siteId: res.siteId });
      setStep('importing');
    } else {
      setError(t(lang, `newsite_err_${res.error}` as StringKey));
    }
  }

  const siteHref = job ? (mode === 'admin' ? `/admin/fleet/${encodeURIComponent(job.siteId)}` : `/app/dashboard/${encodeURIComponent(job.siteId)}`) : '#';
  const steps: Step[] = ['found', 'system', 'place', 'review'];
  const stepIndex = steps.indexOf(step);

  return (
    <div className={styles.wizard} role="region" aria-label={t(lang, 'newsite_wizard_title').replace('{name}', item.name ?? '')}>
      <div className={styles.wizardHead}>
        <h3 className={styles.wizardTitle}>{t(lang, 'newsite_wizard_title').replace('{name}', item.name ?? String(item.vrm_installation_id))}</h3>
        {stepIndex >= 0 && (
          <ol className={styles.progress} aria-label={t(lang, 'newsite_steps')}>
            {steps.map((s, i) => (
              <li key={s} className={i === stepIndex ? styles.progressOn : i < stepIndex ? styles.progressDone : undefined}>
                {t(lang, `newsite_step_${s}` as StringKey)}
              </li>
            ))}
          </ol>
        )}
      </div>

      {step === 'found' && (
        <div className={styles.body}>
          <p className={styles.lead}>{t(lang, 'newsite_found_lead')}</p>
          {lines.length > 0 ? (
            <ul className={styles.equipment}>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
          ) : (
            <p className={styles.muted}>{t(lang, 'newsite_found_none')}</p>
          )}
          <p className={styles.muted}>{t(lang, 'newsite_found_ask')}</p>
          <div className={styles.actions}>
            <Button variant="ghost" type="button" onClick={onClose}>{t(lang, 'newsite_cancel')}</Button>
            <Button type="button" onClick={() => setStep('system')} arrow>{t(lang, 'newsite_start')}</Button>
          </div>
        </div>
      )}

      {step === 'system' && (
        <div className={styles.body}>
          <div className={styles.grid}>
            <Field label={t(lang, 'newsite_name')} htmlFor={`ns-name-${item.id}`} required>
              <Input id={`ns-name-${item.id}`} value={form.displayName} onChange={(e) => set('displayName', e.target.value)} />
            </Field>
            <Field label={t(lang, 'newsite_type')} htmlFor={`ns-type-${item.id}`} required>
              <Select id={`ns-type-${item.id}`} value={form.systemType} onChange={(e) => set('systemType', e.target.value as Form['systemType'])}>
                <option value="hybrid">{t(lang, 'newsite_type_hybrid')}</option>
                <option value="off_grid">{t(lang, 'newsite_type_off_grid')}</option>
                <option value="grid_zero">{t(lang, 'newsite_type_grid_zero')}</option>
              </Select>
            </Field>
          </div>
          {eq?.has_grid != null && <p className={styles.fromVrm}>{t(lang, eq.has_grid ? 'newsite_from_vrm_grid' : 'newsite_from_vrm_no_grid')}</p>}

          <h4 className={styles.groupTitle}>{t(lang, 'newsite_solar')}</h4>
          <div className={styles.grid}>
            <Field label={t(lang, 'newsite_pv_kwp')} htmlFor={`ns-kwp-${item.id}`} required>
              <Input id={`ns-kwp-${item.id}`} inputMode="decimal" value={form.pvKwp} placeholder={fromPanels != null ? String(fromPanels) : ''}
                onChange={(e) => set('pvKwp', e.target.value)} />
            </Field>
            <div className={styles.inline}>
              <Field label={t(lang, 'newsite_panels')} htmlFor={`ns-pc-${item.id}`}>
                <Input id={`ns-pc-${item.id}`} inputMode="numeric" value={form.panelCount} onChange={(e) => set('panelCount', e.target.value)} />
              </Field>
              <span className={styles.times} aria-hidden="true">×</span>
              <Field label={t(lang, 'newsite_panel_w')} htmlFor={`ns-pw-${item.id}`}>
                <Input id={`ns-pw-${item.id}`} inputMode="numeric" value={form.panelWatts} onChange={(e) => set('panelWatts', e.target.value)} />
              </Field>
            </div>
          </div>
          <p className={styles.hint}>
            {fromPanels != null && !form.pvKwp ? t(lang, 'newsite_pv_from_panels').replace('{kwp}', String(fromPanels)) : t(lang, 'newsite_pv_hint')}
          </p>

          <h4 className={styles.groupTitle}>{t(lang, 'newsite_inverter')}</h4>
          <div className={styles.grid}>
            <Field label={t(lang, 'newsite_inverter_kw')} htmlFor={`ns-inv-${item.id}`}>
              <Input id={`ns-inv-${item.id}`} inputMode="decimal" value={form.inverterKw} onChange={(e) => set('inverterKw', e.target.value)} />
            </Field>
          </div>
          {eq?.inverter?.kw_total != null && (
            <p className={styles.fromVrm}>{t(lang, 'newsite_from_vrm_inverter').replace('{units}', String(eq.inverter.units)).replace('{model}', eq.inverter.model).replace('{kw}', String(eq.inverter.kw_total))}</p>
          )}

          {hasBattery && (
            <>
              <h4 className={styles.groupTitle}>{t(lang, 'newsite_battery')}</h4>
              {modules != null && eq?.battery?.kwh == null && (
                <>
                  <p className={styles.fromVrm}>{t(lang, 'newsite_from_vrm_modules').replace('{n}', String(modules)).replace('{maker}', eq?.battery?.maker ?? '')}</p>
                  <div className={styles.chips} role="group" aria-label={t(lang, 'newsite_module_size')}>
                    {MODULE_PRESETS.filter((p) => !eq?.battery?.maker || p.label.toLowerCase().startsWith(eq.battery.maker.toLowerCase())).map((p) => (
                      <button key={p.label} type="button" className={num(form.moduleKwh) === p.kwh && !form.batteryKwh ? styles.chipOn : styles.chip}
                        onClick={() => setForm((f) => ({ ...f, moduleKwh: String(p.kwh), batteryKwh: '' }))}>
                        {p.label} · {p.kwh} kWh
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className={styles.grid}>
                <Field label={t(lang, 'newsite_battery_kwh')} htmlFor={`ns-bat-${item.id}`} required>
                  <Input id={`ns-bat-${item.id}`} inputMode="decimal" value={form.batteryKwh} placeholder={fromModules != null ? String(fromModules) : ''}
                    onChange={(e) => set('batteryKwh', e.target.value)} />
                </Field>
                <Field label={t(lang, 'newsite_battery_dod')} htmlFor={`ns-dod-${item.id}`}>
                  <Input id={`ns-dod-${item.id}`} inputMode="numeric" value={form.batteryDod} onChange={(e) => set('batteryDod', e.target.value)} />
                </Field>
                {!offGrid && (
                  <Field label={t(lang, 'newsite_reserve')} htmlFor={`ns-res-${item.id}`}>
                    <Input id={`ns-res-${item.id}`} inputMode="numeric" value={form.reserve} onChange={(e) => set('reserve', e.target.value)} />
                  </Field>
                )}
              </div>
              {fromModules != null && !form.batteryKwh && <p className={styles.hint}>{t(lang, 'newsite_battery_from_modules').replace('{kwh}', String(fromModules))}</p>}
              {!offGrid && eq?.battery && item.prefill?.fields.reserve_soc_pct != null && (
                <p className={styles.fromVrm}>{t(lang, 'newsite_from_vrm_reserve').replace('{pct}', String(item.prefill.fields.reserve_soc_pct))}</p>
              )}
            </>
          )}

          <div className={styles.actions}>
            <Button variant="ghost" type="button" onClick={() => setStep('found')}>{t(lang, 'newsite_back')}</Button>
            <Button type="button" onClick={() => setStep('place')} disabled={!systemReady} arrow>{t(lang, 'newsite_next')}</Button>
          </div>
        </div>
      )}

      {step === 'place' && (
        <div className={styles.body}>
          {mode === 'admin' && (
            <div className={styles.grid}>
              <Field label={t(lang, 'newsite_customer')} htmlFor={`ns-cust-${item.id}`} required>
                <Select id={`ns-cust-${item.id}`} value={form.customerChoice} onChange={(e) => set('customerChoice', e.target.value)}>
                  {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value={NEW}>{t(lang, 'newsite_customer_new')}</option>
                </Select>
              </Field>
              {form.customerChoice === NEW && (
                <Field label={t(lang, 'newsite_customer_new_name')} htmlFor={`ns-custname-${item.id}`} required>
                  <Input id={`ns-custname-${item.id}`} value={form.newCustomerName} onChange={(e) => set('newCustomerName', e.target.value)} />
                </Field>
              )}
            </div>
          )}
          <div className={styles.grid}>
            <Field label={t(lang, 'newsite_coords')} htmlFor={`ns-coords-${item.id}`} required>
              <Input id={`ns-coords-${item.id}`} value={form.coords} placeholder="9.9281, -84.0907" onChange={(e) => set('coords', e.target.value)} />
            </Field>
            <Field label={t(lang, 'newsite_timezone')} htmlFor={`ns-tz-${item.id}`} required>
              <Select id={`ns-tz-${item.id}`} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </Select>
            </Field>
          </div>
          <p className={styles.hint}>{form.coords && !coords ? t(lang, 'newsite_coords_bad') : t(lang, 'newsite_coords_hint')}</p>
          <div className={styles.grid}>
            <Field label={t(lang, 'newsite_language')} htmlFor={`ns-lang-${item.id}`}>
              <Select id={`ns-lang-${item.id}`} value={form.reportLanguage} onChange={(e) => set('reportLanguage', e.target.value as 'en' | 'es')}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </Select>
            </Field>
            {!offGrid && (
              <div className={styles.inline}>
                <Field label={t(lang, 'newsite_rate')} htmlFor={`ns-rate-${item.id}`} optional optionalLabel={` ${t(lang, 'newsite_optional')}`}>
                  <Input id={`ns-rate-${item.id}`} inputMode="decimal" value={form.savingsRate} onChange={(e) => set('savingsRate', e.target.value)} />
                </Field>
                <Field label={t(lang, 'newsite_currency')} htmlFor={`ns-cur-${item.id}`}>
                  <Select id={`ns-cur-${item.id}`} value={form.savingsCurrency} onChange={(e) => set('savingsCurrency', e.target.value)}>
                    {SUPPORTED_FLAT_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
              </div>
            )}
          </div>
          {!offGrid && (
            <label className={styles.check} htmlFor={`ns-exp-${item.id}`}>
              <input id={`ns-exp-${item.id}`} type="checkbox" checked={form.exportsToGrid} onChange={(e) => set('exportsToGrid', e.target.checked)} />
              {t(lang, 'newsite_exports')}
            </label>
          )}
          <div className={styles.actions}>
            <Button variant="ghost" type="button" onClick={() => setStep('system')}>{t(lang, 'newsite_back')}</Button>
            <Button type="button" onClick={() => setStep('review')} disabled={!placeReady} arrow>{t(lang, 'newsite_next')}</Button>
          </div>
        </div>
      )}

      {step === 'review' && values && (
        <div className={styles.body}>
          <dl className={styles.review}>
            {mode === 'admin' && (
              <><dt>{t(lang, 'newsite_customer')}</dt><dd>{form.customerChoice === NEW ? form.newCustomerName : customers?.find((c) => c.id === form.customerChoice)?.name}</dd></>
            )}
            <dt>{t(lang, 'newsite_name')}</dt><dd>{values.displayName}</dd>
            <dt>{t(lang, 'newsite_type')}</dt><dd>{t(lang, `newsite_type_${values.systemType}` as StringKey)}</dd>
            <dt>{t(lang, 'newsite_pv_kwp')}</dt><dd>{values.pvKwp} kWp</dd>
            {values.inverterKw != null && <><dt>{t(lang, 'newsite_inverter_kw')}</dt><dd>{values.inverterKw} kW</dd></>}
            {values.batteryKwh != null && (
              <><dt>{t(lang, 'newsite_battery')}</dt>
                <dd>{values.batteryKwh} kWh{values.batteryDodPct != null ? ` · ${t(lang, 'newsite_review_usable').replace('{pct}', String(values.batteryDodPct))}` : ''}{values.reserveSocPct != null ? ` · ${t(lang, 'newsite_review_reserve').replace('{pct}', String(values.reserveSocPct))}` : ''}</dd></>
            )}
            <dt>{t(lang, 'newsite_coords')}</dt><dd>{values.latitude}, {values.longitude} · {values.timezone}</dd>
            {values.savingsRate != null && <><dt>{t(lang, 'newsite_rate')}</dt><dd>{values.savingsRate} {values.savingsCurrency}/kWh</dd></>}
          </dl>
          <p className={styles.muted}>{t(lang, 'newsite_review_note')}</p>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <Button variant="ghost" type="button" onClick={() => setStep('place')} disabled={busy}>{t(lang, 'newsite_back')}</Button>
            <Button type="button" onClick={submit} disabled={busy} arrow>{busy ? t(lang, 'newsite_adding') : t(lang, 'newsite_add')}</Button>
          </div>
        </div>
      )}

      {step === 'importing' && job && (
        <div className={styles.body}>
          <JobProgress
            jobId={job.jobId}
            endpoint={mode === 'admin' ? '/api/admin/pipeline/jobs' : '/api/pipeline/jobs'}
            runningLabel={t(lang, 'newsite_importing')}
            genericFailedLabel={t(lang, 'newsite_import_failed')}
            unreachableLabel={t(lang, 'newsite_import_failed')}
            onDone={(j) => {
              const r = j.result as { rows_written?: number; samples_stored?: number } | null;
              setImported(r?.samples_stored ?? null);
              setStep('done');
            }}
            onFailed={() => setStep('done')}
          />
        </div>
      )}

      {step === 'done' && job && (
        <div className={styles.body}>
          <ul className={styles.checklist}>
            <li className={styles.checkDone}>{t(lang, 'newsite_done_created')}</li>
            <li className={imported != null ? styles.checkDone : styles.checkTodo}>
              {imported != null ? t(lang, 'newsite_done_imported').replace('{n}', String(imported)) : t(lang, 'newsite_done_import_later')}
            </li>
            <li className={styles.checkDone}>{t(lang, 'newsite_done_watch')}</li>
            <li className={styles.checkTodo}>{t(lang, mode === 'admin' ? 'newsite_done_next_admin' : 'newsite_done_next')}</li>
          </ul>
          <div className={styles.actions}>
            <Button variant="ghost" type="button" onClick={onClose}>{t(lang, 'newsite_close')}</Button>
            <Button href={siteHref} arrow>{t(lang, 'newsite_open_site')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function NewSites({ items, lang, mode, customers, canAdd = true, add, dismiss, check }: NewSitesProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const visible = items.filter((i) => !hidden.has(i.id) || i.id === openId);

  async function onDismiss(id: string) {
    if (!window.confirm(t(lang, 'newsite_dismiss_confirm'))) return;
    const res = await dismiss(id);
    if (res.ok) setHidden((h) => new Set(h).add(id));
  }

  async function onCheck() {
    if (!check) return;
    setChecking(true);
    const res = await check();
    setChecking(false);
    setCheckNote(!res.ok ? t(lang, 'newsite_check_failed') : res.found > 0 ? t(lang, 'newsite_check_found').replace('{n}', String(res.found)) : t(lang, 'newsite_check_none'));
  }

  if (visible.length === 0 && !check) return null;

  return (
    <section className={styles.wrap} aria-label={t(lang, 'newsite_section')}>
      {check && (
        <div className={styles.checkRow}>
          <span className={styles.muted}>{checkNote ?? t(lang, 'newsite_check_hint')}</span>
          <Button variant="ghost" type="button" onClick={onCheck} disabled={checking}>{checking ? t(lang, 'newsite_checking') : t(lang, 'newsite_check')}</Button>
        </div>
      )}
      {visible.map((item) => (
        <div key={item.id} className={styles.card}>
          {openId === item.id ? (
            <Wizard item={item} lang={lang} mode={mode} customers={customers} add={add}
              onClose={() => { setOpenId(null); setHidden((h) => new Set(h).add(item.id)); }} />
          ) : (
            <div className={styles.banner}>
              <div>
                <p className={styles.bannerTitle}>{t(lang, 'newsite_banner_title').replace('{name}', item.name ?? String(item.vrm_installation_id))}</p>
                <p className={styles.muted}>
                  {item.vrm_created_at ? t(lang, 'newsite_banner_created').replace('{date}', new Date(item.vrm_created_at).toLocaleDateString(lang === 'es' ? 'es-CR' : 'en-US', { day: 'numeric', month: 'short' })) : ''}
                  {equipmentLines(item, lang).slice(0, 2).length > 0 ? ` · ${equipmentLines(item, lang).slice(0, 2).join(' · ')}` : ''}
                </p>
                {!canAdd && <p className={styles.error}>{t(lang, 'newsite_err_limit')}</p>}
              </div>
              <div className={styles.bannerActions}>
                <Button variant="ghost" type="button" onClick={() => onDismiss(item.id)}>{t(lang, 'newsite_dismiss')}</Button>
                <Button type="button" onClick={() => setOpenId(item.id)} disabled={!canAdd} arrow>{t(lang, 'newsite_add_cta')}</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

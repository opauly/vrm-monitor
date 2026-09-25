'use client';

// Cross-customer site edit form for `/admin/sites` (PLAN_PHASE14.md §2
// Step 7) — same field set as `app/(portal)/app/sites/SiteForm.tsx`, minus
// the customer-facing reverse-geocode helper (an admin editing another
// customer's site by hand is an infrequent correction, not the primary
// data-entry path `pages/06_vrm_monitor.py:tab_upload()`'s own geocode
// button optimizes for) — kept intentionally simpler rather than
// duplicating that client-side geocoding flow for a rarely-used surface.
import { useActionState, useEffect, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { listTimezones } from '@/lib/timezones';
import { COUNTRIES } from '@/lib/countries';
import { SUPPORTED_FLAT_CURRENCIES } from '@/lib/currencies';
import type { SiteRecord } from '@/lib/server/db';
import { REPORT_MODULE_ICONS } from '@/lib/reportModuleThumbnails';
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
import { updateAnySiteAction, type AdminSiteFormState } from './actions';
import styles from './sites.module.css';

const TIMEZONES = listTimezones();
const COUNTRY_CODES = Object.keys(COUNTRIES);
// ISO weekday order (1 = Monday) — keys into the same `sites_weekday_1..7`
// table `app/(portal)/app/sites/SiteForm.tsx` already uses, not a second
// English-only copy (this file used to keep its own, back when admin was
// English-only; see `lib/i18n/strings.ts`'s `FORCE_LANG` history).
const WEEKDAY_KEYS: StringKey[] = [
  'sites_weekday_1', 'sites_weekday_2', 'sites_weekday_3', 'sites_weekday_4',
  'sites_weekday_5', 'sites_weekday_6', 'sites_weekday_7',
];
const MAX_REPORT_RECIPIENTS = 5;
// Same 13 ids `sites.ts:REPORT_MODULES` / `victron/weekly_report.py:
// ALL_MODULES` / migration 029's widened CHECK constraint use, keyed into
// the same `sites_module_*`/`sites_module_desc_*` table SiteForm.tsx uses —
// this file used to restate its own English copy here (see WEEKDAY_KEYS'
// comment above for why that's no longer true). `desc` (2026-08-29, Oscar's
// own instruction) pairs with a static thumbnail icon
// (lib/reportModuleThumbnails.tsx) for the same "preview + description per
// checkbox" this file's customer-facing counterpart (SiteForm.tsx) shows.
const REPORT_MODULES: Array<{ id: string; labelKey: StringKey; descKey: StringKey }> = [
  { id: 'energy_mix', labelKey: 'sites_module_energy_mix', descKey: 'sites_module_desc_energy_mix' },
  { id: 'battery_health', labelKey: 'sites_module_battery_health', descKey: 'sites_module_desc_battery_health' },
  { id: 'grid_quality', labelKey: 'sites_module_grid_quality', descKey: 'sites_module_desc_grid_quality' },
  { id: 'events', labelKey: 'sites_module_events', descKey: 'sites_module_desc_events' },
  { id: 'soc_chart', labelKey: 'sites_module_soc_chart', descKey: 'sites_module_desc_soc_chart' },
  { id: 'solar_performance', labelKey: 'sites_module_solar_performance', descKey: 'sites_module_desc_solar_performance' },
  { id: 'weather', labelKey: 'sites_module_weather', descKey: 'sites_module_desc_weather' },
  { id: 'trend', labelKey: 'sites_module_trend', descKey: 'sites_module_desc_trend' },
  { id: 'savings', labelKey: 'sites_module_savings', descKey: 'sites_module_desc_savings' },
  { id: 'critical_alerts', labelKey: 'sites_module_critical_alerts', descKey: 'sites_module_desc_critical_alerts' },
  { id: 'grid_meter_detail', labelKey: 'sites_module_grid_meter_detail', descKey: 'sites_module_desc_grid_meter_detail' },
  { id: 'generator_runtime', labelKey: 'sites_module_generator_runtime', descKey: 'sites_module_desc_generator_runtime' },
  { id: 'tank_level', labelKey: 'sites_module_tank_level', descKey: 'sites_module_desc_tank_level' },
];
// Same set `victron/weekly_report.py:DEFAULT_MODULES` treats as "no
// customization yet" — the original 9 plus critical_alerts, NOT the 3
// hardware-conditional modules most sites have no hardware for. See
// SiteForm.tsx's own DEFAULT_REPORT_MODULES for the full reasoning.
const DEFAULT_REPORT_MODULES = [
  'energy_mix', 'battery_health', 'grid_quality', 'events',
  'soc_chart', 'solar_performance', 'weather', 'trend', 'savings',
  'critical_alerts',
];
// The report's fixed spine (PLAN_PHASE18.md's Decisions section) — never
// selectable, shown alongside REPORT_MODULES as always-checked/disabled.
const FIXED_MODULE_KEYS: StringKey[] = ['sites_module_fixed_kpi', 'sites_module_fixed_narrative', 'sites_module_fixed_bar_chart'];

/** Plain-language summary of a schedule choice, shown before it's saved —
 * same purpose as `SiteForm.tsx`'s own confirmation copy. */
function describeSchedule(lang: Lang, schedule: string, weekday: number, dayOfMonth: number, hour: number): string {
  if (schedule === 'off') return t(lang, 'admin_sites_desc_schedule_off');
  const hourLabel = `${String(hour).padStart(2, '0')}:00`;
  if (schedule === 'daily') return t(lang, 'admin_sites_desc_schedule_daily').replace('{hour}', hourLabel);
  if (schedule === 'weekly') {
    return t(lang, 'admin_sites_desc_schedule_weekly').replace('{weekday}', t(lang, WEEKDAY_KEYS[weekday - 1])).replace('{hour}', hourLabel);
  }
  return t(lang, 'admin_sites_desc_schedule_monthly').replace('{day}', String(dayOfMonth)).replace('{hour}', hourLabel);
}

function describeModules(lang: Lang, mode: 'default' | 'custom', selected: Set<string>): string {
  if (mode === 'default') return t(lang, 'admin_sites_desc_modules_default');
  if (selected.size === REPORT_MODULES.length) return t(lang, 'admin_sites_desc_modules_all');
  if (selected.size === 0) return t(lang, 'admin_sites_desc_modules_none');
  return t(lang, 'admin_sites_desc_modules_count').replace('{count}', String(selected.size)).replace('{total}', String(REPORT_MODULES.length));
}

export function AdminSiteEditForm({ site, lang, onDone }: { site: SiteRecord; lang: Lang; onDone: () => void }) {
  const boundAction = updateAnySiteAction.bind(null, site.site_id);
  const [state, formAction, pending] = useActionState<AdminSiteFormState, FormData>(boundAction, {});

  const [nominal, setNominal] = useState(site.battery_nominal_kwh?.toString() ?? '');
  const [dod, setDod] = useState(site.battery_dod_pct?.toString() ?? '');
  const usableKwh = (() => {
    const n = Number(nominal);
    const d = Number(dod);
    if (!nominal || !dod || !Number.isFinite(n) || !Number.isFinite(d)) return null;
    return Math.round(((n * d) / 100) * 100) / 100;
  })();

  // Only ever a real editor for a `source='vrm_api'` site — same rule
  // `SiteForm.tsx` enforces (client-side UX; `updateAnySite()`'s
  // `AdminScheduleRequiresVrmApi` is the actual control, see that file).
  const [reportSchedule, setReportSchedule] = useState<string>(site.report_schedule);
  const [scheduleWeekday, setScheduleWeekday] = useState(String(site.report_schedule_weekday));
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(String(site.report_schedule_day_of_month));
  const [scheduleHour, setScheduleHour] = useState(String(site.report_schedule_hour));
  const [recipients, setRecipients] = useState((site.report_recipients ?? []).join('\n'));
  const recipientCount = recipients.split('\n').map((s) => s.trim()).filter(Boolean).length;

  // PLAN_PHASE18.md §5/§7. `NULL` in the database means DEFAULT_REPORT_MODULES
  // (the original 9 plus critical_alerts, NOT the 3 hardware-conditional
  // modules) — same initial-state rule `SiteForm.tsx` uses.
  const initialModules = new Set<string>(
    site.report_modules && site.report_modules.length > 0 ? site.report_modules : DEFAULT_REPORT_MODULES,
  );
  const [selectedModules, setSelectedModules] = useState<Set<string>>(initialModules);
  // Default/Custom mode — see SiteForm.tsx's own comment for the full
  // reasoning. Switching to "Default" and saving submits the sentinel with
  // no report_modules values, which sanitizeReportModules() (admin.ts)
  // already turns into `null`.
  const initialModuleMode: 'default' | 'custom' = site.report_modules && site.report_modules.length > 0 ? 'custom' : 'default';
  const [moduleMode, setModuleMode] = useState<'default' | 'custom'>(initialModuleMode);
  function toggleModule(id: string) {
    setSelectedModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const modulesChanged =
    moduleMode !== initialModuleMode ||
    (moduleMode === 'custom' &&
      (selectedModules.size !== initialModules.size || [...selectedModules].some((m) => !initialModules.has(m))));

  // A real change to the SCHEDULE itself (cadence/day/hour) — not
  // recipients, not any other field — shows a plain-language summary of
  // what's about to be applied (Oscar's own request: "a prior confirmation
  // message"). Originally gated Save behind a separate "confirm this"
  // click before the button would even work — found confusing in a real
  // live test (2026-08-28) and simplified: the summary is shown, the
  // button is relabeled to say what it's about to do, and clicking it
  // both confirms and saves in one action.
  const scheduleChanged =
    reportSchedule !== site.report_schedule ||
    (reportSchedule === 'weekly' && Number(scheduleWeekday) !== site.report_schedule_weekday) ||
    (reportSchedule === 'monthly' && Number(scheduleDayOfMonth) !== site.report_schedule_day_of_month) ||
    (reportSchedule !== 'off' && Number(scheduleHour) !== site.report_schedule_hour);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone intentionally excluded, see SiteForm.tsx's own precedent
  }, [state.success]);

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.fieldRow}>
        <Field label={t(lang, 'sites_field_name')} htmlFor={`as-name-${site.site_id}`} required>
          <Input id={`as-name-${site.site_id}`} name="display_name" defaultValue={site.display_name} required disabled={pending} />
        </Field>
        <Field label={t(lang, 'sites_field_system_type')} htmlFor={`as-type-${site.site_id}`}>
          <Select id={`as-type-${site.site_id}`} name="system_type" defaultValue={site.system_type} disabled={pending}>
            <option value="hybrid">{t(lang, 'system_type_hybrid')}</option>
            <option value="off_grid">{t(lang, 'system_type_off_grid')}</option>
            <option value="grid_zero">{t(lang, 'system_type_grid_zero')}</option>
          </Select>
        </Field>
      </div>

      <div className={styles.fieldRow}>
        <Field label={t(lang, 'sites_field_pv_kwp')} htmlFor={`as-kwp-${site.site_id}`}>
          <Input id={`as-kwp-${site.site_id}`} name="pv_kwp" type="number" step="0.1" min="0" defaultValue={site.pv_kwp ?? ''} disabled={pending} />
        </Field>
        <Field label={t(lang, 'sites_field_report_language')} htmlFor={`as-lang-${site.site_id}`}>
          <Select id={`as-lang-${site.site_id}`} name="report_language" defaultValue={site.report_language} disabled={pending}>
            <option value="en">{t(lang, 'lang_en')}</option>
            <option value="es">{t(lang, 'lang_es')}</option>
          </Select>
        </Field>
      </div>

      <div className={styles.fieldRow}>
        <Field label={t(lang, 'admin_sites_field_battery_nominal')} htmlFor={`as-batt-nom-${site.site_id}`}>
          <Input
            id={`as-batt-nom-${site.site_id}`}
            name="battery_nominal_kwh"
            type="number"
            step="0.1"
            min="0"
            value={nominal}
            onChange={(e) => setNominal(e.target.value)}
            disabled={pending}
          />
        </Field>
        <Field label={t(lang, 'sites_field_battery_dod')} htmlFor={`as-batt-dod-${site.site_id}`}>
          <Input
            id={`as-batt-dod-${site.site_id}`}
            name="battery_dod_pct"
            type="number"
            step="1"
            min="0"
            max="100"
            value={dod}
            onChange={(e) => setDod(e.target.value)}
            disabled={pending}
          />
        </Field>
      </div>
      {usableKwh !== null && (
        <p className={styles.caption}>{t(lang, 'sites_field_battery_usable_caption').replace('{value}', usableKwh.toFixed(2))}</p>
      )}

      <div className={styles.fieldRow}>
        <Field label={t(lang, 'sites_field_location')} htmlFor={`as-loc-${site.site_id}`}>
          <Input id={`as-loc-${site.site_id}`} name="location" defaultValue={site.location ?? ''} disabled={pending} />
        </Field>
        <Field label={t(lang, 'sites_field_timezone')} htmlFor={`as-tz-${site.site_id}`}>
          <Select id={`as-tz-${site.site_id}`} name="timezone" defaultValue={site.timezone} disabled={pending}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t(lang, 'sites_field_country')} htmlFor={`as-country-${site.site_id}`}>
          <Select id={`as-country-${site.site_id}`} name="country" defaultValue={site.country ?? 'CR'} disabled={pending}>
            {COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {COUNTRIES[code]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className={styles.fieldRow}>
        <Field label={t(lang, 'sites_field_latitude')} htmlFor={`as-lat-${site.site_id}`}>
          <Input id={`as-lat-${site.site_id}`} name="latitude" type="number" step="0.000001" defaultValue={site.latitude ?? ''} disabled={pending} />
        </Field>
        <Field label={t(lang, 'sites_field_longitude')} htmlFor={`as-lng-${site.site_id}`}>
          <Input
            id={`as-lng-${site.site_id}`}
            name="longitude"
            type="number"
            step="0.000001"
            defaultValue={site.longitude ?? ''}
            disabled={pending}
          />
        </Field>
      </div>

      <div className={styles.fieldRow}>
        <Field label={t(lang, 'sites_field_savings_rate')} htmlFor={`as-rate-${site.site_id}`}>
          <Input
            id={`as-rate-${site.site_id}`}
            name="savings_rate"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={site.savings_rate ?? ''}
            disabled={pending}
          />
        </Field>
        <Field label={t(lang, 'sites_field_savings_currency')} htmlFor={`as-currency-${site.site_id}`}>
          <Select id={`as-currency-${site.site_id}`} name="savings_currency" defaultValue={site.savings_currency ?? 'USD'} disabled={pending}>
            {SUPPORTED_FLAT_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {site.source !== 'vrm_api' && <p className={styles.caption}>{t(lang, 'admin_sites_csv_notice')}</p>}
      {site.source === 'vrm_api' && (
        <>
          <div className={styles.fieldRow}>
            <Field label={t(lang, 'admin_sites_field_report_schedule')} htmlFor={`as-schedule-${site.site_id}`}>
              <Select
                id={`as-schedule-${site.site_id}`}
                name="report_schedule"
                value={reportSchedule}
                onChange={(e) => setReportSchedule(e.target.value)}
                disabled={pending}
              >
                <option value="off">{t(lang, 'admin_sites_schedule_off')}</option>
                <option value="daily">{t(lang, 'sites_schedule_daily')}</option>
                <option value="weekly">{t(lang, 'sites_schedule_weekly')}</option>
                <option value="monthly">{t(lang, 'sites_schedule_monthly')}</option>
              </Select>
            </Field>
            {reportSchedule === 'weekly' && (
              <Field label={t(lang, 'admin_sites_field_weekday')} htmlFor={`as-weekday-${site.site_id}`}>
                <Select
                  id={`as-weekday-${site.site_id}`}
                  name="report_schedule_weekday"
                  value={scheduleWeekday}
                  onChange={(e) => setScheduleWeekday(e.target.value)}
                  disabled={pending}
                >
                  {WEEKDAY_KEYS.map((key, i) => (
                    <option key={key} value={i + 1}>
                      {t(lang, key)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {reportSchedule === 'monthly' && (
              <Field label={t(lang, 'admin_sites_field_day_of_month')} htmlFor={`as-dom-${site.site_id}`}>
                <Input
                  id={`as-dom-${site.site_id}`}
                  name="report_schedule_day_of_month"
                  type="number"
                  min="1"
                  max="28"
                  value={scheduleDayOfMonth}
                  onChange={(e) => setScheduleDayOfMonth(e.target.value)}
                  disabled={pending}
                />
              </Field>
            )}
            {reportSchedule !== 'off' && (
              <Field label={t(lang, 'admin_sites_field_hour')} htmlFor={`as-hour-${site.site_id}`}>
                <Select
                  id={`as-hour-${site.site_id}`}
                  name="report_schedule_hour"
                  value={scheduleHour}
                  onChange={(e) => setScheduleHour(e.target.value)}
                  disabled={pending}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          {scheduleChanged && (
            <p className={styles.caption}>
              {t(lang, 'sites_schedule_review_notice')}{' '}
              {describeSchedule(lang, reportSchedule, Number(scheduleWeekday), Number(scheduleDayOfMonth), Number(scheduleHour))}
            </p>
          )}

          <Field label={t(lang, 'admin_sites_field_recipients')} htmlFor={`as-recipients-${site.site_id}`}>
            <Textarea
              id={`as-recipients-${site.site_id}`}
              name="report_recipients"
              rows={3}
              placeholder={t(lang, 'admin_sites_recipients_placeholder')}
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              disabled={pending}
            />
          </Field>
          <p className={recipientCount > MAX_REPORT_RECIPIENTS ? styles.error : styles.caption}>
            {t(lang, 'admin_sites_recipients_count').replace('{count}', String(recipientCount)).replace('{max}', String(MAX_REPORT_RECIPIENTS))}
          </p>

          {/* PLAN_PHASE18.md §5 — untiered on the admin side, unlike the
             customer-facing form (`updateAnySite()`'s `sanitizeReportModules()`
             has no entitlement check, same "admin write path is separate
             and untiered" precedent branding.ts states). Sentinel input is
             still needed here, for the same reason it is on the customer
             side: distinguishing "unchecked everything" from "this section
             never rendered" (a non-vrm_api site). */}
          <input type="hidden" name="report_modules_present" value="true" />
          <p className={styles.moduleCaption}>
            {t(lang, 'sites_modules_title')} — {describeModules(lang, moduleMode, selectedModules)}
          </p>
          <div className={styles.moduleModeRow}>
            <label className={styles.checkboxLabel}>
              <input type="radio" name="_module_mode" checked={moduleMode === 'default'} onChange={() => setModuleMode('default')} disabled={pending} />
              {t(lang, 'sites_modules_mode_default')}
            </label>
            <label className={styles.checkboxLabel}>
              <input type="radio" name="_module_mode" checked={moduleMode === 'custom'} onChange={() => setModuleMode('custom')} disabled={pending} />
              {t(lang, 'sites_modules_mode_custom')}
            </label>
          </div>
          {moduleMode === 'custom' && (
            <>
              {/* Always included, never selectable — on their own line above
                 the selectable grid, so the fixed spine reads as a distinct
                 group (real live-test feedback, 2026-08-29). No `name`:
                 display only, never submitted. */}
              <div className={styles.fixedModuleRow}>
                {FIXED_MODULE_KEYS.map((key) => (
                  <label key={key} className={styles.checkboxLabelDisabled}>
                    <input type="checkbox" checked disabled />
                    {t(lang, key)}
                  </label>
                ))}
              </div>
              <div className={styles.moduleGrid}>
              {REPORT_MODULES.map((m) => (
                <label key={m.id} className={styles.moduleCard}>
                  <div className={styles.moduleCardHeader}>
                    <input
                      type="checkbox"
                      name="report_modules"
                      value={m.id}
                      checked={selectedModules.has(m.id)}
                      onChange={() => toggleModule(m.id)}
                      disabled={pending}
                    />
                    <span className={styles.moduleThumb} aria-hidden="true">{REPORT_MODULE_ICONS[m.id]}</span>
                    <span>{t(lang, m.labelKey)}</span>
                  </div>
                  <p className={styles.moduleDesc}>{t(lang, m.descKey)}</p>
                </label>
              ))}
              </div>
            </>
          )}
          {modulesChanged && (
            <p className={styles.caption}>
              {t(lang, 'admin_sites_modules_review_notice')} {describeModules(lang, moduleMode, selectedModules)}
            </p>
          )}
        </>
      )}

      <div className={styles.checkboxRow}>
        <label className={styles.checkboxLabel}>
          <input type="checkbox" name="exports_to_grid" value="true" defaultChecked={site.exports_to_grid} disabled={pending} />
          {t(lang, 'sites_field_exports_to_grid')}
        </label>
        <label className={styles.checkboxLabel}>
          <input type="checkbox" name="active" value="true" defaultChecked={site.active} disabled={pending} />
          {t(lang, 'sites_field_active')}
        </label>
      </div>

      {state.error && <p className={styles.error}>{state.error}</p>}

      <div className={styles.formActions}>
        <Button type="submit" disabled={pending}>
          {pending
            ? t(lang, 'admin_common_saving')
            : scheduleChanged || modulesChanged
              ? t(lang, 'sites_schedule_confirm_save_button')
              : t(lang, 'admin_common_save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          {t(lang, 'admin_common_cancel')}
        </Button>
      </div>
    </form>
  );
}

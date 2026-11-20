import 'server-only';

// The new-site wizard's values, checked and completed on the server before vrm_api creates the site: numbers in
// range, coordinates turned into a place name and country. Shared by the customer and the admin actions.
import { z } from 'zod';
import { reverseGeocode } from '@/lib/server/geocode';
import { isKnownTimezone } from '@/lib/timezones';
import type { NewSiteFieldsIn } from '@/lib/server/pipeline';

export type NewSiteWizardValues = {
  displayName: string;
  systemType: 'hybrid' | 'off_grid' | 'grid_zero';
  pvKwp: number;
  inverterKw: number | null;
  batteryKwh: number | null;
  batteryDodPct: number | null;
  reserveSocPct: number | null;
  latitude: number;
  longitude: number;
  timezone: string;
  reportLanguage: 'en' | 'es';
  savingsRate: number | null;
  savingsCurrency: string | null;
  exportsToGrid: boolean;
};

const positive = z.number().finite().positive();
const optionalPositive = positive.nullable();
const pct = z.number().finite().min(0).max(100).nullable();

const schema = z.object({
  displayName: z.string().trim().min(1).max(120),
  systemType: z.enum(['hybrid', 'off_grid', 'grid_zero']),
  pvKwp: positive.max(10000),
  inverterKw: optionalPositive,
  batteryKwh: optionalPositive,
  batteryDodPct: pct,
  reserveSocPct: pct,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  timezone: z.string().refine(isKnownTimezone),
  reportLanguage: z.enum(['en', 'es']),
  savingsRate: optionalPositive,
  savingsCurrency: z.string().max(8).nullable(),
  exportsToGrid: z.boolean(),
});

export type WizardCheck = { ok: true; fields: NewSiteFieldsIn } | { ok: false; field: string };

export async function toSiteFields(values: NewSiteWizardValues): Promise<WizardCheck> {
  const parsed = schema.safeParse(values);
  if (!parsed.success) return { ok: false, field: String(parsed.error.issues[0]?.path[0] ?? 'form') };
  const v = parsed.data;
  const place = await reverseGeocode(v.latitude, v.longitude);
  const offGrid = v.systemType === 'off_grid';
  return {
    ok: true,
    fields: {
      display_name: v.displayName,
      system_type: v.systemType,
      pv_kwp: v.pvKwp,
      inverter_nominal_kw: v.inverterKw,
      battery_nominal_kwh: v.batteryKwh,
      battery_dod_pct: v.batteryKwh ? v.batteryDodPct : null,
      reserve_soc_pct: offGrid || !v.batteryKwh ? null : v.reserveSocPct,
      latitude: v.latitude,
      longitude: v.longitude,
      location: place?.location ?? null,
      country: place?.countryCode ?? null,
      timezone: v.timezone,
      report_language: v.reportLanguage,
      savings_rate: offGrid ? null : v.savingsRate,
      savings_currency: offGrid || !v.savingsRate ? null : v.savingsCurrency,
      exports_to_grid: offGrid ? false : v.exportsToGrid,
    },
  };
}

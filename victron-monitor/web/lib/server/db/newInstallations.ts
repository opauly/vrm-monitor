import 'server-only';

// Systems found in a VRM account that have no site yet (`vrm.new_installations`, written by
// `vrm_api/site_discovery.py` about once an hour). Read here for the "New system found" banner and wizard; adding
// or dismissing one goes through vrm_api (`lib/server/pipeline.ts`). Tolerates the table not existing yet.
import { getSupabaseAdmin } from '@/lib/server/supabase';

export type NewInstallationEquipment = {
  gateway: string | null;
  inverter: { model: string; units: number; layout: string | null; va_each: number | null; kw_total: number | null; battery_voltage: number | null } | null;
  battery: { maker: string | null; product: string | null; modules: number | null; kwh: number | null; chemistry: string | null; dod_pct: number | null } | null;
  chargers: { model: string; count: number }[];
  pv_inverters: { model: string; count: number }[];
  grid_meter: string | null;
  has_grid: boolean | null;
  has_generator: boolean;
};

export type NewInstallationPrefill = {
  fields: {
    display_name: string | null;
    system_type: 'hybrid' | 'off_grid' | 'grid_zero' | null;
    timezone: string | null;
    inverter_nominal_kw: number | null;
    battery_nominal_kwh: number | null;
    battery_dod_pct: number | null;
    reserve_soc_pct: number | null;
    pv_kwp: number | null;
    latitude: number | null;
    longitude: number | null;
  };
  equipment: NewInstallationEquipment;
  ask: string[];
};

export type NewInstallation = {
  id: string;
  customer_id: string | null;
  vrm_installation_id: number;
  name: string | null;
  vrm_created_at: string | null;
  found_at: string;
  prefill: NewInstallationPrefill | null;
};

const COLUMNS = 'id, customer_id, vrm_installation_id, name, vrm_created_at, found_at, prefill';

function isMissing(error: { code?: string } | null): boolean {
  return ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error?.code ?? '');
}

function normalise(rows: unknown[]): NewInstallation[] {
  return (rows as NewInstallation[]).map((r) => {
    const p = r.prefill as NewInstallationPrefill | null;
    return { ...r, prefill: p && p.fields && p.equipment ? p : null };
  });
}

/** The waiting systems found in this customer's own VRM account. */
export async function listNewInstallations(customerId: string): Promise<NewInstallation[]> {
  const { data, error } = await getSupabaseAdmin().schema('vrm').from('new_installations').select(COLUMNS)
    .eq('customer_id', customerId).eq('status', 'new').order('found_at', { ascending: false });
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return normalise(data ?? []);
}

/** Admin: the waiting systems found in the admin's own VRM account. */
export async function listAdminNewInstallations(): Promise<NewInstallation[]> {
  const { data, error } = await getSupabaseAdmin().schema('vrm').from('new_installations').select(COLUMNS)
    .is('customer_id', null).eq('status', 'new').order('found_at', { ascending: false });
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return normalise(data ?? []);
}

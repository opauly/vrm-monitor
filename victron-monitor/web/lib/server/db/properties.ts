import 'server-only';

// Properties: groups of a customer's sites (an address, a farm, a building). A site is in one property or none.
// Every function that takes a `customerId` is scoped to it; the admin variants (`listAllProperties`, `adminSetSiteProperty`)
// still refuse to put a site into another customer's property. A database that has not had `vrm_properties.sql` run yet reads
// as "no properties" so deploying the web app first cannot break a page; a SAVE against a missing table fails loudly.
import { getSupabaseAdmin } from '@/lib/server/supabase';
import { suggestGroups, type SuggestedGroup } from '@/lib/propertyGroups';
import { NotAuthorized } from './errors';
import type { PropertyRecord, SiteRecord } from './types';

// 42P01 / PGRST205: the table is missing. 42703 / PGRST204: the column is missing.
function isMissing(error: { code?: string } | null): boolean {
  return ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error?.code ?? '');
}

const db = () => getSupabaseAdmin().schema('vrm');

export async function listProperties(customerId: string): Promise<PropertyRecord[]> {
  const { data, error } = await db().from('properties').select('id, customer_id, name, created_at').eq('customer_id', customerId).order('name');
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return (data ?? []) as PropertyRecord[];
}

/** Every customer's properties (admin). */
export async function listAllProperties(): Promise<PropertyRecord[]> {
  const { data, error } = await db().from('properties').select('id, customer_id, name, created_at').order('name');
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return (data ?? []) as PropertyRecord[];
}

async function getProperty(propertyId: string): Promise<PropertyRecord | null> {
  const { data, error } = await db().from('properties').select('id, customer_id, name, created_at').eq('id', propertyId).limit(1);
  if (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return ((data ?? [])[0] as PropertyRecord | undefined) ?? null;
}

/** Throws `NotAuthorized` unless `propertyId` is one of `customerId`'s properties; returns it. */
export async function assertOwnsProperty(customerId: string, propertyId: string): Promise<PropertyRecord> {
  const found = await getProperty(propertyId);
  if (!found || found.customer_id !== customerId) throw new NotAuthorized(`Customer ${customerId} does not own property ${propertyId}.`);
  return found;
}

function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw new Error('invalid_name');
  return trimmed;
}

export async function createProperty(customerId: string, name: string): Promise<PropertyRecord> {
  const { data, error } = await db().from('properties').insert({ customer_id: customerId, name: cleanName(name) }).select('id, customer_id, name, created_at').single();
  if (error) throw error;
  return data as PropertyRecord;
}

export async function renameProperty(customerId: string, propertyId: string, name: string): Promise<void> {
  await assertOwnsProperty(customerId, propertyId);
  const { error } = await db().from('properties').update({ name: cleanName(name) }).eq('id', propertyId).eq('customer_id', customerId);
  if (error) throw error;
}

/** Deleting a property un-groups its sites (the column is `ON DELETE SET NULL`); no site is touched otherwise. */
export async function deleteProperty(customerId: string, propertyId: string): Promise<void> {
  await assertOwnsProperty(customerId, propertyId);
  const { error } = await db().from('properties').delete().eq('id', propertyId).eq('customer_id', customerId);
  if (error) throw error;
}

/** Puts a site into one of the same customer's properties, or takes it out (`null`). Both must belong to `customerId`. */
export async function setSiteProperty(customerId: string, siteId: string, propertyId: string | null): Promise<void> {
  if (propertyId) await assertOwnsProperty(customerId, propertyId);
  const { data, error } = await db().from('sites').update({ property_id: propertyId }).eq('customer_id', customerId).eq('site_id', siteId).select('site_id');
  if (error) throw error;
  if (!data || data.length === 0) throw new NotAuthorized(`Customer ${customerId} does not own site ${siteId}.`);
}

/** Admin: the same, for whichever customer owns the site; a property of another customer is refused. */
export async function adminSetSiteProperty(siteId: string, propertyId: string | null): Promise<void> {
  const { data, error } = await db().from('sites').select('customer_id').eq('site_id', siteId).limit(1);
  if (error) throw error;
  const owner = (data ?? [])[0]?.customer_id as string | undefined;
  if (!owner) throw new NotAuthorized(`No site ${siteId}.`);
  await setSiteProperty(owner, siteId, propertyId);
}

/** `{site_id: property_id}` for the sites that are in one. Empty when the SQL has not been run. */
export async function getSitePropertyMap(siteIds: string[]): Promise<Record<string, string>> {
  if (siteIds.length === 0) return {};
  const { data, error } = await db().from('sites').select('site_id, property_id').in('site_id', siteIds).not('property_id', 'is', null);
  if (error) {
    if (isMissing(error)) return {};
    throw error;
  }
  return Object.fromEntries((data ?? []).map((r) => [r.site_id as string, r.property_id as string]));
}

/** First-guess groups among a customer's sites that are not in a property yet (see `lib/propertyGroups.ts`). */
export async function suggestPropertyGroups(customerId: string): Promise<SuggestedGroup[]> {
  // Only live (VRM) sites that are the customer's own: those are what fleet views and reports cover. A database without `is_shared` has none shared.
  const select = (columns: string) => db().from('sites').select(columns).eq('customer_id', customerId).eq('active', true).eq('source', 'vrm_api');
  type Row = Pick<SiteRecord, 'site_id' | 'display_name' | 'latitude' | 'longitude' | 'property_id' | 'is_shared'>;
  let { data, error } = await select('site_id, display_name, latitude, longitude, property_id, is_shared');
  if (error && isMissing(error)) ({ data, error } = await select('site_id, display_name, latitude, longitude, property_id'));
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return suggestGroups(((data ?? []) as unknown as Row[]).filter((s) => !s.is_shared));
}

/** Creates the suggested groups the customer accepted (re-validated here: only their own, not-yet-grouped sites). */
export async function applyPropertyGroups(customerId: string, groups: SuggestedGroup[]): Promise<number> {
  const existing = await listProperties(customerId);
  const taken = new Set(existing.map((p) => p.name.toLowerCase()));
  let created = 0;
  for (const group of groups) {
    const name = cleanName(group.name);
    if (taken.has(name.toLowerCase()) || group.site_ids.length < 2) continue;
    const property = await createProperty(customerId, name);
    taken.add(name.toLowerCase());
    for (const siteId of group.site_ids) {
      const { error } = await db().from('sites').update({ property_id: property.id }).eq('customer_id', customerId).eq('site_id', siteId).is('property_id', null);
      if (error) throw error;
    }
    created += 1;
  }
  return created;
}

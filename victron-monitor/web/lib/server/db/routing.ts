import 'server-only';

// Who hears about what, by property (`vrm.property_recipients`, `vrm.push_subscriptions.property_ids`; sql/vrm_property_routing.sql).
// A property can have extra email recipients, and a phone can be limited to some properties. The owner of every row always comes
// from the session in the calling Server Action. Reads tolerate the SQL not having been run; writes do not.
import { getSupabaseAdmin } from '@/lib/server/supabase';
import { NotAuthorized } from './errors';
import { assertOwnsProperty } from './properties';
import type { PushOwner } from './push';

export type PropertyRecipient = { id: number; property_id: string; email: string };
export type OwnerDevice = { id: number; user_agent: string | null; created_at: string; property_ids: string[] | null };

const MAX_RECIPIENTS_PER_PROPERTY = 10;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isMissing(error: { code?: string } | null): boolean {
  return ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error?.code ?? '');
}

const db = () => getSupabaseAdmin().schema('vrm');

export async function listPropertyRecipients(customerId: string): Promise<PropertyRecipient[]> {
  const { data, error } = await db().from('property_recipients').select('id, property_id, email').eq('customer_id', customerId).order('email');
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return (data ?? []) as PropertyRecipient[];
}

export async function addPropertyRecipient(customerId: string, propertyId: string, email: string): Promise<void> {
  await assertOwnsProperty(customerId, propertyId);
  const clean = email.trim().toLowerCase();
  if (clean.length > 200 || !EMAIL.test(clean)) throw new Error('invalid_email');
  const existing = await listPropertyRecipients(customerId);
  if (existing.filter((r) => r.property_id === propertyId).length >= MAX_RECIPIENTS_PER_PROPERTY) throw new Error('too_many');
  const { error } = await db().from('property_recipients').insert({ property_id: propertyId, customer_id: customerId, email: clean });
  if (error && error.code !== '23505') throw error; // 23505: already there — adding it twice is fine
}

export async function removePropertyRecipient(customerId: string, recipientId: number): Promise<void> {
  const { error } = await db().from('property_recipients').delete().eq('id', recipientId).eq('customer_id', customerId);
  if (error) throw error;
}

function ownerColumn(owner: PushOwner): { column: string; value: string } {
  return 'customerId' in owner ? { column: 'customer_id', value: owner.customerId } : { column: 'admin_email', value: owner.adminEmail };
}

/** The phones this owner registered, newest first, with the properties each is limited to (null = everything). */
export async function listOwnerDevices(owner: PushOwner): Promise<OwnerDevice[]> {
  const { column, value } = ownerColumn(owner);
  const run = (columns: string) => db().from('push_subscriptions').select(columns).eq(column, value).order('created_at', { ascending: false });
  let { data, error } = await run('id, user_agent, created_at, property_ids');
  if (error && isMissing(error)) ({ data, error } = await run('id, user_agent, created_at'));
  if (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown as Partial<OwnerDevice>[]).map((d) => ({ id: d.id as number, user_agent: d.user_agent ?? null, created_at: d.created_at as string, property_ids: d.property_ids ?? null }));
}

/** Limits one of this owner's phones to some properties, or (null) to everything. `allowed` = the property ids this owner may name. */
export async function setDeviceProperties(owner: PushOwner, deviceId: number, propertyIds: string[] | null, allowed: Set<string>): Promise<void> {
  if (propertyIds !== null && (propertyIds.length === 0 || propertyIds.some((id) => !allowed.has(id)))) throw new NotAuthorized('Unknown property.');
  const { column, value } = ownerColumn(owner);
  const { data, error } = await db().from('push_subscriptions').update({ property_ids: propertyIds }).eq(column, value).eq('id', deviceId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new NotAuthorized(`Not your device: ${deviceId}.`);
}

'use server';

import 'server-only';

// The admin's version of "Who gets what, by property": recipients belong to the internal-fleet account
// (ALERTS_FORCE_CUSTOMER_IDS), and the phones are the admin's own (owner = the session's email).
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/server/auth';
import { fleetAlertCustomerId } from '@/lib/server/fleetAlertCustomer';
import { addPropertyRecipient, listProperties, removePropertyRecipient, setDeviceProperties } from '@/lib/server/db';

type Result = { ok: boolean; error?: 'invalid_email' | 'too_many' | 'failed' };

async function guarded(job: (customerId: string, adminEmail: string) => Promise<void>): Promise<Result> {
  const admin = await requireAdmin();
  const customerId = fleetAlertCustomerId();
  if (!customerId) return { ok: false, error: 'failed' };
  try {
    await job(customerId, admin.email);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    return { ok: false, error: message === 'invalid_email' || message === 'too_many' ? message : 'failed' };
  }
  revalidatePath('/admin/fleet/alerts');
  return { ok: true };
}

export async function addRecipientAction(propertyId: string, email: string): Promise<Result> {
  return guarded((customerId) => addPropertyRecipient(customerId, propertyId, email));
}
export async function removeRecipientAction(recipientId: number): Promise<Result> {
  return guarded((customerId) => removePropertyRecipient(customerId, recipientId));
}
export async function setDeviceScopeAction(deviceId: number, propertyIds: string[] | null): Promise<Result> {
  return guarded(async (customerId, adminEmail) => {
    const allowed = new Set((await listProperties(customerId)).map((p) => p.id));
    await setDeviceProperties({ adminEmail }, deviceId, propertyIds, allowed);
  });
}

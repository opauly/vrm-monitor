'use server';

import 'server-only';

// Server Actions behind "Who gets what, by property" on `/app/alerts?tab=notifications`: extra email recipients for a property, and
// limiting one of the customer's phones to some properties. The customer always comes from the session, and every property and
// phone id is re-checked against it in `lib/server/db/routing.ts`.
import { revalidatePath } from 'next/cache';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { addPropertyRecipient, getCustomer, getDashboardAccess, listProperties, removePropertyRecipient, setDeviceProperties } from '@/lib/server/db';

type Result = { ok: boolean; error?: 'invalid_email' | 'too_many' | 'failed' };

async function guarded(job: (customerId: string) => Promise<void>): Promise<Result> {
  const session = await requireCustomerAllowPending();
  const customer = await getCustomer(session.customerId);
  if (session.provisioningState !== 'active' || !(await getDashboardAccess(customer))) return { ok: false, error: 'failed' };
  try {
    await job(session.customerId);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    return { ok: false, error: message === 'invalid_email' || message === 'too_many' ? message : 'failed' };
  }
  revalidatePath('/app/alerts');
  return { ok: true };
}

export async function addRecipientAction(propertyId: string, email: string): Promise<Result> {
  return guarded((customerId) => addPropertyRecipient(customerId, propertyId, email));
}
export async function removeRecipientAction(recipientId: number): Promise<Result> {
  return guarded((customerId) => removePropertyRecipient(customerId, recipientId));
}
export async function setDeviceScopeAction(deviceId: number, propertyIds: string[] | null): Promise<Result> {
  return guarded(async (customerId) => {
    const allowed = new Set((await listProperties(customerId)).map((p) => p.id));
    await setDeviceProperties({ customerId }, deviceId, propertyIds, allowed);
  });
}

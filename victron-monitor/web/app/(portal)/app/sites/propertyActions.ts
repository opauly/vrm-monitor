'use server';

import 'server-only';

// Server Actions behind the customer's "Properties" panel on `/app/sites`. The customer id always comes from the session —
// the `customerId` the panel passes is ignored — and every property/site id is re-checked against it in `lib/server/db/properties.ts`.
import { revalidatePath } from 'next/cache';
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { applyPropertyGroups, createProperty, deleteProperty, renameProperty, setSiteProperty, suggestPropertyGroups } from '@/lib/server/db';
import type { SuggestedGroup } from '@/lib/propertyGroups';

type Result = { ok: boolean; error?: string };

async function guarded(job: (customerId: string) => Promise<void>): Promise<Result> {
  const session = await requireCustomerAllowPending();
  if (session.provisioningState !== 'active') return { ok: false, error: 'not_active' };
  try {
    await job(session.customerId);
  } catch {
    return { ok: false, error: 'failed' };
  }
  revalidatePath('/app/sites');
  revalidatePath('/app/dashboard');
  return { ok: true };
}

export async function createPropertyAction(_customerId: string, name: string): Promise<Result> {
  return guarded(async (customerId) => void (await createProperty(customerId, name)));
}
export async function renamePropertyAction(_customerId: string, propertyId: string, name: string): Promise<Result> {
  return guarded((customerId) => renameProperty(customerId, propertyId, name));
}
export async function deletePropertyAction(_customerId: string, propertyId: string): Promise<Result> {
  return guarded((customerId) => deleteProperty(customerId, propertyId));
}
export async function assignSitePropertyAction(siteId: string, propertyId: string | null): Promise<Result> {
  return guarded((customerId) => setSiteProperty(customerId, siteId, propertyId));
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the panel passes a customer id; the session's is what counts
export async function suggestPropertyGroupsAction(_customerId: string): Promise<SuggestedGroup[]> {
  const session = await requireCustomerAllowPending();
  return session.provisioningState === 'active' ? suggestPropertyGroups(session.customerId) : [];
}
export async function applyPropertyGroupsAction(_customerId: string, groups: SuggestedGroup[]): Promise<Result & { created?: number }> {
  let created = 0;
  const result = await guarded(async (customerId) => {
    created = await applyPropertyGroups(customerId, groups);
  });
  return { ...result, created };
}

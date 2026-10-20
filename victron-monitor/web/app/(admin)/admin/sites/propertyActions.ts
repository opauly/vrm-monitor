'use server';

import 'server-only';

// The admin's "Properties" panel on `/admin/sites`: the same actions as a customer's, for whichever customer the panel block is
// about. `requireAdmin()` comes first; each function still refuses to mix customers (a site goes only into its own customer's property).
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/server/auth';
import { adminSetSiteProperty, applyPropertyGroups, createProperty, deleteProperty, renameProperty, suggestPropertyGroups } from '@/lib/server/db';
import type { SuggestedGroup } from '@/lib/propertyGroups';

type Result = { ok: boolean; error?: string };

async function guarded(job: () => Promise<void>): Promise<Result> {
  await requireAdmin();
  try {
    await job();
  } catch {
    return { ok: false, error: 'failed' };
  }
  revalidatePath('/admin/sites');
  revalidatePath('/admin/fleet');
  return { ok: true };
}

export async function createPropertyAction(customerId: string, name: string): Promise<Result> {
  return guarded(async () => void (await createProperty(customerId, name)));
}
export async function renamePropertyAction(customerId: string, propertyId: string, name: string): Promise<Result> {
  return guarded(() => renameProperty(customerId, propertyId, name));
}
export async function deletePropertyAction(customerId: string, propertyId: string): Promise<Result> {
  return guarded(() => deleteProperty(customerId, propertyId));
}
export async function assignSitePropertyAction(siteId: string, propertyId: string | null): Promise<Result> {
  return guarded(() => adminSetSiteProperty(siteId, propertyId));
}
export async function suggestPropertyGroupsAction(customerId: string): Promise<SuggestedGroup[]> {
  await requireAdmin();
  return suggestPropertyGroups(customerId);
}
export async function applyPropertyGroupsAction(customerId: string, groups: SuggestedGroup[]): Promise<Result & { created?: number }> {
  let created = 0;
  const result = await guarded(async () => {
    created = await applyPropertyGroups(customerId, groups);
  });
  return { ...result, created };
}

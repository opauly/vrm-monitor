'use server';

import 'server-only';

// The new-site wizard for a system found in the admin's own VRM account: the admin picks the customer it goes to
// (an existing one, or a new one by name). No site limit here: adding on a customer's behalf is the admin's call.
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/server/auth';
import { addNewInstallation, checkNewInstallations, dismissNewInstallation, PipelineError } from '@/lib/server/pipeline';
import { toSiteFields, type NewSiteWizardValues } from '@/lib/server/newSiteWizard';
import type { NewSiteAddResult } from '@/app/(portal)/app/sites/newSiteActions';

export async function adminAddNewSiteAction(
  id: string, values: NewSiteWizardValues, target: { customerId: string | null; newCustomerName: string | null },
): Promise<NewSiteAddResult> {
  await requireAdmin();
  const checked = await toSiteFields(values);
  if (!checked.ok) return { ok: false, error: 'invalid', field: checked.field };
  const newName = target.newCustomerName?.trim() || null;
  if (!!target.customerId === !!newName) return { ok: false, error: 'invalid', field: 'customer' };
  try {
    const out = await addNewInstallation(id, { customer_id: target.customerId, new_customer_name: newName, site_fields: checked.fields });
    revalidatePath('/admin/vrm-fleet');
    revalidatePath('/admin/fleet');
    return { ok: true, siteId: out.site_id, jobId: out.job_id };
  } catch (err) {
    if (err instanceof PipelineError && err.status === 404) return { ok: false, error: 'gone' };
    if (err instanceof PipelineError && err.status === 409) return { ok: false, error: 'linked' };
    return { ok: false, error: 'failed' };
  }
}

export async function adminDismissNewSiteAction(id: string): Promise<{ ok: boolean }> {
  await requireAdmin();
  try {
    await dismissNewInstallation(id, null);
  } catch {
    return { ok: false };
  }
  revalidatePath('/admin/vrm-fleet');
  return { ok: true };
}

export async function adminCheckNewSitesAction(): Promise<{ ok: boolean; found: number }> {
  await requireAdmin();
  try {
    const out = await checkNewInstallations();
    revalidatePath('/admin/vrm-fleet');
    return { ok: true, found: out.found?.found ?? 0 };
  } catch {
    return { ok: false, found: 0 };
  }
}

'use server';

import 'server-only';

// The new-site wizard for a system found in the customer's own VRM account. The site always goes under the signed-in
// customer (vrm_api checks the system was found in their account), and only while they are under their site limit.
import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/server/auth';
import { canAddSite } from '@/lib/server/db';
import { addNewInstallation, dismissNewInstallation, PipelineError } from '@/lib/server/pipeline';
import { toSiteFields, type NewSiteWizardValues } from '@/lib/server/newSiteWizard';

export type NewSiteAddResult = { ok: true; siteId: string; jobId: string } | { ok: false; error: 'invalid' | 'limit' | 'gone' | 'linked' | 'failed'; field?: string };

export async function addNewSiteAction(id: string, values: NewSiteWizardValues): Promise<NewSiteAddResult> {
  const session = await requireCustomer();
  const allowed = await canAddSite(session.customerId);
  if (!allowed.ok) return { ok: false, error: 'limit' };
  const checked = await toSiteFields(values);
  if (!checked.ok) return { ok: false, error: 'invalid', field: checked.field };
  try {
    const out = await addNewInstallation(id, { acting_customer_id: session.customerId, site_fields: checked.fields });
    revalidatePath('/app/sites');
    return { ok: true, siteId: out.site_id, jobId: out.job_id };
  } catch (err) {
    if (err instanceof PipelineError && err.status === 404) return { ok: false, error: 'gone' };
    if (err instanceof PipelineError && err.status === 409) return { ok: false, error: 'linked' };
    return { ok: false, error: 'failed' };
  }
}

export async function dismissNewSiteAction(id: string): Promise<{ ok: boolean }> {
  const session = await requireCustomer();
  try {
    await dismissNewInstallation(id, session.customerId);
  } catch {
    return { ok: false };
  }
  revalidatePath('/app/sites');
  return { ok: true };
}

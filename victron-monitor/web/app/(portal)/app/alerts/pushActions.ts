'use server';

import 'server-only';

// Server Actions behind the "Phone notifications" panel on `/app/alerts`.
// Same gate as the page: a customer without live monitoring has no alerts to
// be notified about, and the page hiding the panel is UX, not the control.
import { requireCustomerAllowPending } from '@/lib/server/auth';
import { getCustomer, getDashboardAccess } from '@/lib/server/db';
import { subscribeCore, unsubscribeCore, testCore } from '@/lib/server/pushActionCore';
import type { PushActionResult, PushTestResult } from '@/lib/push';
import { t } from '@/lib/i18n/strings';

async function ownerOrError() {
  const session = await requireCustomerAllowPending();
  const customer = await getCustomer(session.customerId);
  const allowed = session.provisioningState === 'active' && (await getDashboardAccess(customer));
  return { session, owner: { customerId: session.customerId }, allowed };
}

export async function subscribePushAction(input: unknown): Promise<PushActionResult> {
  const { session, owner, allowed } = await ownerOrError();
  if (!allowed) return { error: t(session.uiLanguage, 'push_error_generic') };
  return subscribeCore(owner, input, session.uiLanguage);
}

export async function unsubscribePushAction(endpoint: string): Promise<PushActionResult> {
  const { session, owner } = await ownerOrError();      // removing your own device is always allowed
  return unsubscribeCore(owner, endpoint, session.uiLanguage);
}

export async function sendTestPushAction(): Promise<PushTestResult> {
  const { session, owner, allowed } = await ownerOrError();
  if (!allowed) return { error: t(session.uiLanguage, 'push_error_generic') };
  return testCore(owner, session.uiLanguage);
}

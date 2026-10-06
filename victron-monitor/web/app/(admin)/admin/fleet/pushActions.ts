'use server';

import 'server-only';

// Server Actions behind the "Phone notifications" panel on `/admin/fleet` — the
// admin's own devices, which receive the alerts of the internal-fleet accounts
// (ALERTS_FORCE_CUSTOMER_IDS) that have no login of their own to subscribe from.
// `requireAdmin()` first, and the owner is the session's own email.
import { requireAdmin } from '@/lib/server/auth';
import { subscribeCore, unsubscribeCore, testCore } from '@/lib/server/pushActionCore';
import type { PushActionResult, PushTestResult } from '@/lib/push';

export async function subscribeAdminPushAction(input: unknown): Promise<PushActionResult> {
  const admin = await requireAdmin();
  return subscribeCore({ adminEmail: admin.email }, input, admin.uiLanguage);
}

export async function unsubscribeAdminPushAction(endpoint: string): Promise<PushActionResult> {
  const admin = await requireAdmin();
  return unsubscribeCore({ adminEmail: admin.email }, endpoint, admin.uiLanguage);
}

export async function sendAdminTestPushAction(): Promise<PushTestResult> {
  const admin = await requireAdmin();
  return testCore({ adminEmail: admin.email }, admin.uiLanguage);
}

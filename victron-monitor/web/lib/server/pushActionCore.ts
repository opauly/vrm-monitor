import 'server-only';

// The logic behind the push Server Actions, shared by the customer's
// (`app/(portal)/app/alerts/pushActions.ts`) and the admin's
// (`app/(admin)/admin/fleet/pushActions.ts`) so the two cannot drift. Those
// files do the authorisation (`requireCustomer…` / `requireAdmin`) and pass in
// the owner taken from the session; nothing here ever trusts an owner supplied
// by the client.
import { headers } from 'next/headers';
import { parsePushSubscription, type PushActionResult, type PushTestResult } from '@/lib/push';
import { deletePushSubscription, savePushSubscription, type PushOwner } from '@/lib/server/db';
import { PipelineError, sendPushTest } from '@/lib/server/pipeline';
import { checkRateLimit } from '@/lib/server/ratelimit';
import { t, type Lang } from '@/lib/i18n/strings';

export async function subscribeCore(owner: PushOwner, input: unknown, lang: Lang): Promise<PushActionResult> {
  const parsed = parsePushSubscription(input);
  if (!parsed) return { error: t(lang, 'push_error_generic') };
  const userAgent = (await headers()).get('user-agent')?.slice(0, 300) ?? null;
  try {
    await savePushSubscription(owner, { ...parsed, userAgent });
  } catch {
    return { error: t(lang, 'push_error_generic') };
  }
  return { ok: true };
}

export async function unsubscribeCore(owner: PushOwner, endpoint: unknown, lang: Lang): Promise<PushActionResult> {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) return { error: t(lang, 'push_error_generic') };
  try {
    await deletePushSubscription(owner, endpoint);
  } catch {
    return { error: t(lang, 'push_error_generic') };
  }
  return { ok: true };
}

export async function testCore(owner: PushOwner, lang: Lang): Promise<PushTestResult> {
  const key = 'customerId' in owner ? owner.customerId : owner.adminEmail;
  if (!(await checkRateLimit('push_test', key, 3600, 10))) return { error: t(lang, 'push_error_rate') };
  try {
    const result = await sendPushTest(owner, lang);
    return { ok: true, delivered: result.delivered, devices: result.devices };
  } catch (err) {
    if (err instanceof PipelineError && err.code === 'push_not_configured') return { error: t(lang, 'push_error_not_configured') };
    return { error: t(lang, 'push_error_generic') };
  }
}

import 'server-only';

// Push-device registry (`vrm.push_subscriptions`, sql/vrm_push.sql). A device
// belongs to exactly one owner: a customer (their alerts reach it) or an admin
// (it receives the internal-fleet alerts, whose "customer" has no login). The
// owner always comes from the session in the calling server action — never from
// the form — so one account can never register or remove another's device.
//
// Reads tolerate the table not existing yet (SQL not run); writes do not.
import { getSupabaseAdmin } from '@/lib/server/supabase';

export type PushOwner = { customerId: string } | { adminEmail: string };

function ownerColumns(owner: PushOwner): { customer_id: string | null; admin_email: string | null } {
  return 'customerId' in owner
    ? { customer_id: owner.customerId, admin_email: null }
    : { customer_id: null, admin_email: owner.adminEmail };
}

export async function savePushSubscription(
  owner: PushOwner,
  sub: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
): Promise<void> {
  // `endpoint` is unique per device: if this device is already registered (a
  // shared tablet, a re-login as someone else) it moves to the current owner.
  const { error } = await getSupabaseAdmin()
    .schema('vrm')
    .from('push_subscriptions')
    .upsert(
      { ...ownerColumns(owner), endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, user_agent: sub.userAgent, failure_count: 0 },
      { onConflict: 'endpoint' },
    );
  if (error) throw error;
}

export async function deletePushSubscription(owner: PushOwner, endpoint: string): Promise<void> {
  const column = 'customerId' in owner ? 'customer_id' : 'admin_email';
  const value = 'customerId' in owner ? owner.customerId : owner.adminEmail;
  const { error } = await getSupabaseAdmin().schema('vrm').from('push_subscriptions').delete().eq('endpoint', endpoint).eq(column, value);
  if (error) throw error;
}

import 'server-only';
import { PostHog } from 'posthog-node';

// Server-side half of analytics (2026-09-19) — the client-side snippet
// (components/analytics/PostHogProvider.tsx) only ever sees a browser
// event; "how many subscribe, how many unsubscribe" are backend actions
// with no page load of their own, so they're captured from here instead,
// at the exact point each one actually succeeds — see
// `lib/server/signup.ts` (signup_request_submitted) and
// `app/api/billing/cancel/route.ts` (subscription_cancelled).
//
// `subscription_started` is NOT captured from this app at all — that
// resolution happens inside vrm_api's billing reconciliation, which has
// no single clean call site in Next.js to hook (a webhook retry, the
// daily reconcile-due sweep, and a customer's own subscribe/cancel/
// change action all funnel through the same `reconcile_customer()`).
// It's captured from `vrm_api/billing.py:apply_entitlements()` instead
// (Python's own `posthog` SDK, `vrm_api/analytics.py`), at the one
// `provisioning_state` transition (`pending_subscription` -> `active`)
// that's structurally guaranteed to happen exactly once per customer —
// see that call site's own comment for the full reasoning.
//
// Module-level singleton, not one client per request — PostHog's own
// Node docs recommend this for exactly the reason `flushAt`/
// `flushInterval` below exist: a serverless function can be frozen or
// recycled between requests, so this also calls `.shutdown()` isn't
// wired up per-request (would defeat the singleton); `flushAt: 1` sends
// each event immediately instead of batching, trading a little latency
// for not losing events if the process is torn down before a batch
// flushes.
let client: PostHog | null | undefined;

export function getServerPostHog(): PostHog | null {
  if (client !== undefined) return client;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  client = key
    ? new PostHog(key, {
        host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        flushAt: 1,
        flushInterval: 0,
      })
    : null;
  return client;
}

/**
 * Fire-and-forget capture — every call site here is on a success path
 * that must never fail or delay because analytics is unreachable
 * (same "this is a side effect, not a dependency" rule the rest of this
 * app already applies to its own non-critical integrations). `distinctId`
 * is the customer's email, lowercased — the same identity `vrm.customers.
 * auth_email` uses, so a later `posthog.identify()` call (once a real
 * customer/session exists) merges into the same person instead of
 * creating a second, orphaned one.
 */
export function captureServerEvent(distinctId: string, event: string, properties?: Record<string, unknown>): void {
  const ph = getServerPostHog();
  if (!ph) return;
  try {
    ph.capture({ distinctId, event, properties });
  } catch (err) {
    console.error(`captureServerEvent: failed to capture "${event}"`, err);
  }
}

// Web Push helpers shared by the browser (PushPanel) and the server actions.
// No server-only imports here on purpose.

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushActionResult = { ok?: true; error?: string };
export type PushTestResult = { ok?: true; delivered?: number; devices?: number; error?: string };

// Mirror of `vrm_api/alerts_push.py:endpoint_allowed()` — keep the two lists in
// step. A push subscription's `endpoint` is a URL the API server will POST to,
// and it is chosen by whoever's browser submits it, so only the real push
// services are accepted (otherwise: server-side request forgery).
const ALLOWED_HOSTS = new Set(['fcm.googleapis.com', 'web.push.apple.com', 'updates.push.services.mozilla.com']);
const ALLOWED_SUFFIXES = ['.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com'];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port !== '' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.has(host) || ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Validates what a browser's `PushSubscription.toJSON()` produced. Anything
 * unexpected is rejected rather than stored. */
export function parsePushSubscription(input: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  if (typeof input !== 'object' || input === null) return null;
  const { endpoint, keys } = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || !isAllowedPushEndpoint(endpoint)) return null;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (typeof p256dh !== 'string' || p256dh.length < 20 || p256dh.length > 200 || !KEY_PATTERN.test(p256dh)) return null;
  if (typeof auth !== 'string' || auth.length < 8 || auth.length > 100 || !KEY_PATTERN.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

/** The VAPID public key arrives as base64url; `pushManager.subscribe` wants bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

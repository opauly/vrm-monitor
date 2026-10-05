// Content-Security-Policy builders — the single source of truth for which
// third-party hosts the site may talk to (ONVO for card entry, PostHog for
// analytics, Supabase for storage/auth). Imported by `next.config.ts` and
// `proxy.ts` with relative paths on purpose: next.config.ts runs before the
// `@/` alias exists.
//
// Two policies, because Next.js nonces require per-request (dynamic)
// rendering and the marketing pages are statically generated:
//
//  - `nonceCsp(nonce)` — strict: no `'unsafe-inline'` for scripts. Applied by
//    `proxy.ts` to every route that is already dynamic and that handles
//    sessions, forms or card entry (/app, /admin, /login, /signup, /forgot,
//    /activate, /unsubscribe). `'strict-dynamic'` lets the nonce-carrying
//    Next.js bootstrap load further scripts (the ONVO SDK via next/script,
//    PostHog's lazy-loaded modules) without each needing its own nonce; the
//    host entries are then only a fallback for browsers that ignore it.
//  - `baselineCsp` — the original allow-list policy (with
//    `'unsafe-inline'` scripts: Next's own inline hydration bootstrap needs
//    it when there is no nonce) for the static marketing pages, which carry
//    no session and take no card data.
//
// `style-src` stays loose for style ATTRIBUTES only (`style-src-attr`): this
// app uses React `style={{...}}` props widely and CSP gates rendered
// `style=""` attributes. <style> ELEMENTS (the injection-prone kind) require
// the nonce.

const SCRIPT_HOSTS = ['https://sdk.onvopay.com', 'https://us-assets.i.posthog.com', 'https://eu-assets.i.posthog.com'];

const SHARED = [
  // `blob:` is required for BrandingForm.tsx's instant local logo preview
  // (`URL.createObjectURL(file)`).
  "img-src 'self' data: blob: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co https://sdk.onvopay.com https://api.onvopay.com https://us.i.posthog.com https://eu.i.posthog.com https://us-assets.i.posthog.com https://eu-assets.i.posthog.com",
  // PostHog origins: /admin/analytics embeds the PostHog dashboard.
  'frame-src https://sdk.onvopay.com https://us.posthog.com https://eu.posthog.com',
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

const isDev = process.env.NODE_ENV === 'development';

export const baselineCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} ${SCRIPT_HOSTS.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  ...SHARED,
].join('; ');

export function nonceCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // React needs eval() only in development (callstack reconstruction).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''} ${SCRIPT_HOSTS.join(' ')}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    ...SHARED,
    // Would rewrite http://localhost subresources to https in development.
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** Path prefixes `proxy.ts` serves with `nonceCsp` — next.config.ts must NOT
 * also send the baseline policy there (two policies would intersect). */
export const NONCE_CSP_PREFIXES = ['app', 'admin', 'login', 'signup', 'forgot', 'activate', 'unsubscribe'] as const;

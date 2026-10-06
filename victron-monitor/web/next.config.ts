import type { NextConfig } from "next";
import { baselineCsp, NONCE_CSP_PREFIXES } from "./lib/csp";

// PLAN_PHASE14.md §2 Step 8 — security headers. The Content-Security-Policy
// is built in `lib/csp.ts` (single allow-list of ONVO / PostHog / Supabase
// hosts, with the history of why each is there). Two policies:
//
//  - Routes that handle sessions, forms and card entry (`NONCE_CSP_PREFIXES`)
//    get a strict, nonce-based policy from `proxy.ts` — no `'unsafe-inline'`
//    for scripts. A nonce needs a per-request render, which those routes
//    already have.
//  - Everything else (the statically generated marketing pages, which carry
//    no session or card data) keeps the baseline allow-list policy below,
//    since a static page has no request to mint a nonce from.
//
// The two must not overlap: when a response carries two policies the browser
// enforces both, and the baseline's looser rules would add nothing while
// making failures harder to read. Hence the path exclusion on the CSP entry.
//
// **After any change here, verify the ONVO card form still mounts on the live
// site (DevTools console: watch for "Refused to ..." CSP violations)** — it is
// the revenue path, and a third-party SDK's real origin list isn't something
// to infer from its embed snippet alone.
const nonceRoutes = NONCE_CSP_PREFIXES.join('|');

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // The service worker must always be fetched fresh: a cached copy would
        // keep an old push handler alive on every phone for days after a fix.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: `/((?!(?:${nonceRoutes})(?:/|$)).*)`,
        headers: [{ key: 'Content-Security-Policy', value: baselineCsp }],
      },
    ];
  },
};

export default nextConfig;

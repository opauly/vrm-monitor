import type { NextConfig } from "next";

// PLAN_PHASE14.md §2 Step 8 — never added until now, because there was
// never a real deployed host to add them for. `style-src` keeps
// `'unsafe-inline'`: this app uses React's `style={{...}}` prop
// extensively (every `app/(admin)/admin/**` page, for one), and CSP's
// style-src also gates the rendered `style=""` attribute, not just
// `<style>`/`<link>` tags — removing this would break real, working UI,
// not just a hypothetical one. `script-src` ALSO keeps `'unsafe-inline'` —
// confirmed live, not assumed: without it, Next.js's own hydration
// bootstrap (an inline `<script>` it emits itself, unrelated to this app's
// code) is blocked outright by Chrome's CSP enforcement, breaking every
// page. A nonce-based strict CSP is Next's own documented alternative, but
// is a real, separate piece of work (wiring a per-request nonce through
// `proxy.ts`) — not attempted here; this is a real, working baseline, not
// a maximally strict one. `connect-src`/`frame-src` allow
// `sdk.onvopay.com`/`api.onvopay.com` for the ONVO card-entry SDK
// (`app/(portal)/app/billing/PaymentMethodPanel.tsx`) — this is a REAL
// revenue path already verified working pre-CSP; **verify it still works
// against the live deployed site (DevTools console, watch for CSP
// violation warnings) before trusting this policy is complete**, since a
// third-party SDK's exact origin list isn't something to guess with
// confidence from reading its embed snippet alone.
//
// PostHog domains added 2026-09-21 — found live, both broken by the
// original policy: (1) PostHogProvider.tsx's own client-side SDK was
// silently failing every pageview/event (script-src/connect-src
// violations, console: "Refused to connect/load ... us(-assets).i.posthog
// .com"), and (2) /admin/analytics's embedded dashboard iframe
// (POSTHOG_DASHBOARD_URL) rendered as a blank "This content is blocked"
// placeholder — frame-src had no PostHog origin at all, only ONVO's. Both
// US and EU regions are listed since NEXT_PUBLIC_POSTHOG_HOST is a
// runtime env var this build-time CSP can't branch on.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://sdk.onvopay.com https://us-assets.i.posthog.com https://eu-assets.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  // `blob:` is required for BrandingForm.tsx's instant local logo preview
  // (`URL.createObjectURL(file)`, before the upload round trip completes) —
  // found missing 2026-08-28 from a real live test: the preview silently
  // failed to render the just-picked file with no console error, since a
  // blocked `blob:` <img> src fails quietly rather than throwing.
  "img-src 'self' data: blob: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co https://sdk.onvopay.com https://api.onvopay.com https://us.i.posthog.com https://eu.i.posthog.com https://us-assets.i.posthog.com https://eu-assets.i.posthog.com",
  "frame-src https://sdk.onvopay.com https://us.posthog.com https://eu.posthog.com",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;

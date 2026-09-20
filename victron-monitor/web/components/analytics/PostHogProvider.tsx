'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { PostHogPageview } from './PostHogPageview';

// Analytics setup (2026-09-19, Oscar's own request: "visits, from where,
// where they click, how many subscribe, how many unsubscribe"). PostHog
// over Vercel Analytics/Plausible specifically because it's the one
// option that covers all of that in one tool — pageviews + geography
// (built in), click tracking (autocapture, on by default, needs no extra
// code), AND custom funnel events (signup/cancel, captured server-side —
// see lib/server/analytics.ts) — without hand-rolling a click tracker or
// a separate events pipeline.
//
// Silently disabled (no script loads, `posthog.init` never runs) when
// `NEXT_PUBLIC_POSTHOG_KEY` is unset — this is deliberately a soft
// dependency: local dev and any deploy before the key is configured must
// keep working exactly as before, not throw or half-initialize.
//
// `capture_pageview: false` — the App Router has no built-in "page
// changed" event the way Pages Router's `next/router` did, so a plain
// `posthog.init()` with its own default pageview capture would only ever
// fire once, on the very first full page load, and never again on a
// client-side `<Link>` navigation. `PostHogPageview` below fires it
// manually on every path/search-param change instead — the standard
// PostHog-for-App-Router pattern.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false,
    });
  }, []);

  return (
    <PHProvider client={posthog}>
      <PostHogPageview />
      {children}
    </PHProvider>
  );
}

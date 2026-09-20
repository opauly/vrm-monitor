'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { usePostHog } from 'posthog-js/react';

// Fires `$pageview` on every route change — see PostHogProvider's own
// comment for why this can't just be `posthog.init()`'s built-in
// autocapture. `useSearchParams()` requires a <Suspense> boundary around
// any component that calls it (Next.js build-time requirement, or the
// page opts into fully dynamic rendering) — the inner/outer split here is
// exactly that boundary, not decorative.
function PostHogPageviewInner() {
  const posthog = usePostHog();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthog || !pathname) return;
    const query = searchParams.toString();
    posthog.capture('$pageview', { $current_url: query ? `${pathname}?${query}` : pathname });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `posthog` client instance is stable; re-running only on real navigation is the point.
  }, [pathname, searchParams]);

  return null;
}

export function PostHogPageview() {
  return (
    <Suspense fallback={null}>
      <PostHogPageviewInner />
    </Suspense>
  );
}

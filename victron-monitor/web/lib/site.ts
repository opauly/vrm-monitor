// Shared between app/robots.ts, app/sitemap.ts, and app/layout.tsx's own
// `metadataBase` — none of which can rely on request context (robots/
// sitemap are static-by-default special routes; metadataBase is resolved
// before any request exists at all). The real domain is decided
// (`monitor.paulyco.com`) — its DNS/Vercel wiring is a separate, pending,
// non-code gap (2026-09-19: it currently falls through to the main
// paulyco.com site instead of this app). `SITE_URL` lets local dev and
// any future domain change override this via env without touching any of
// the three call sites, and the fallback keeps `npm run build` producing
// a valid absolute URL today regardless.
//
// Normalized, not used raw (2026-09-19, live build failure): Vercel's own
// `SITE_URL` env var was found set to a bare hostname with no scheme
// (`dimensionador-fv.vercel.app` — also just plain the wrong project,
// someone else's Vercel URL, not even this app's own) — `new URL(raw)`
// in `app/layout.tsx`'s `metadataBase` threw on that immediately and took
// the ENTIRE production build down with it (`ERR_INVALID_URL`, failing
// `/_not-found`'s page-data collection along with everything else). A
// malformed value for a field that only ever affects OG images and
// canonical links must never be able to fail a build outright — this
// normalizes whatever's given (adding `https://` if a scheme is missing,
// falling back to the real domain if it's unparseable even then) and
// warns loudly instead, so a misconfigured env var is visible in the
// build log rather than fatal to it. Still fix the Vercel env var itself
// — this is a safety net, not a substitute for setting `SITE_URL`
// correctly (`https://monitor.paulyco.com`, not a bare host and
// certainly not another project's URL).
function normalizeSiteUrl(raw: string): string {
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    // `new URL(...).toString()` always adds a trailing "/" for a bare
    // origin (e.g. "https://x.com" -> "https://x.com/") — stripped back
    // off since every call site here does `${SITE_URL}/path`, not
    // `${SITE_URL}path`.
    return new URL(withScheme).toString().replace(/\/$/, '');
  } catch {
    console.warn(
      `lib/site.ts: SITE_URL env var (${JSON.stringify(raw)}) is not a valid URL even with "https://" ` +
        'prepended — falling back to https://monitor.paulyco.com. Fix the SITE_URL env var.',
    );
    return 'https://monitor.paulyco.com';
  }
}

export const SITE_URL = normalizeSiteUrl(process.env.SITE_URL ?? 'https://monitor.paulyco.com');

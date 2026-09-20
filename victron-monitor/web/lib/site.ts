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
export const SITE_URL = process.env.SITE_URL ?? 'https://monitor.paulyco.com';

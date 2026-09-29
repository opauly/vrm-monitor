import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// /login and /signup are forms, not content to index; /app and /admin are
// behind auth. Extended 2026-09-19 to include every other real, public
// marketing route that now exists — /whats-inside (the report/dashboard
// deep-dive, moved off the home page the same day), plus /terms and
// /privacy, both previously live but never listed here.
//
// Extended again 2026-09-27 for the /es Spanish counterparts — each is its
// own real, indexable route (not a cookie-switched render of the English
// one), so each gets its own sitemap entry and its own `alternates.languages`
// pair back to English on its own page.tsx (that's what actually links the
// two for search engines; being listed here just gets both URLs crawled).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/es`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/whats-inside`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/es/whats-inside`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/terms`,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/es/terms`,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/privacy`,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/es/privacy`,
      changeFrequency: 'yearly',
      priority: 0.2,
    },
  ];
}

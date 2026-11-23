'use client';

// "Find a site" at the top of a fleet page: type a few letters, tap the site. Matches show
// right under the box, so a phone never has to scroll past the fleet summaries to reach one.
// Enter opens the first match.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, type Lang } from '@/lib/i18n/strings';
import type { SiteItem } from './siteItems';
import { SiteRow } from './SiteRow';
import styles from './SiteFinder.module.css';

const MAX_RESULTS = 8;

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function SiteFinder({ sites, lang }: { sites: SiteItem[]; lang: Lang }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const q = fold(query.trim());
  const matches = useMemo(() => {
    if (!q) return [];
    const words = q.split(/\s+/);
    return sites.filter((s) => {
      const hay = fold(`${s.name} ${s.sub ?? ''} ${s.id}`);
      return words.every((w) => hay.includes(w));
    });
  }, [sites, q]);

  if (sites.length < 2) return null;

  return (
    <div className={styles.finder} role="search">
      <input
        id="site-finder"
        type="search"
        className={styles.input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) router.push(matches[0].href);
          if (e.key === 'Escape') setQuery('');
        }}
        placeholder={t(lang, 'site_finder_placeholder').replace('{n}', String(sites.length))}
        aria-label={t(lang, 'site_finder_label')}
        autoComplete="off"
        enterKeyHint="go"
      />
      {q && (
        <div className={styles.results}>
          {matches.length === 0 ? (
            <p className={styles.none}>{t(lang, 'admin_search_no_results')}</p>
          ) : (
            <div className={styles.list}>
              {matches.slice(0, MAX_RESULTS).map((s) => (
                <SiteRow key={s.id} site={s} />
              ))}
              {matches.length > MAX_RESULTS && (
                <p className={styles.more}>{t(lang, 'site_finder_more').replace('{n}', String(matches.length - MAX_RESULTS))}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

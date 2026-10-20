import Link from 'next/link';
import { t, type Lang } from '@/lib/i18n/strings';
import { formatWattsShort, type PropertySummary } from './format';
import styles from './Properties.module.css';

// `basePath?a=1&b=2`, so choosing a property keeps whatever else the page's link already says (the admin fleet's customer, say).
function href(basePath: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

// "All sites | El Encino | Vista Atenas": picks which property a fleet page shows, as plain links (`?property=<id>`), so a
// view can be bookmarked and shared and nothing needs client state. Rendered only when the customer has at least one property.
export function PropertySwitcher({ lang, basePath, properties, selectedId, keep = {} }: { lang: Lang; basePath: string; properties: { id: string; name: string }[]; selectedId: string | null; keep?: Record<string, string> }) {
  if (properties.length === 0) return null;
  return (
    <nav className={styles.switcher} aria-label={t(lang, 'properties_switcher_label')}>
      <Link href={href(basePath, keep)} className={`${styles.chip} ${selectedId === null ? styles.chipActive : ''}`} aria-current={selectedId === null ? 'page' : undefined}>
        {t(lang, 'properties_all_sites')}
      </Link>
      {properties.map((p) => (
        <Link
          key={p.id}
          href={href(basePath, { ...keep, property: p.id })}
          className={`${styles.chip} ${selectedId === p.id ? styles.chipActive : ''}`}
          aria-current={selectedId === p.id ? 'page' : undefined}
        >
          {p.name}
        </Link>
      ))}
    </nav>
  );
}

// The all-sites view's way into each property: one small card per property (and one for sites not in any), each linking to
// that property's own fleet view.
export function PropertyCards({ lang, basePath, summaries, keep = {} }: { lang: Lang; basePath: string; summaries: PropertySummary[]; keep?: Record<string, string> }) {
  if (summaries.length === 0) return null;
  return (
    <section className={styles.cards} aria-label={t(lang, 'properties_cards_label')}>
      {summaries.map((s) => {
        const body = (
          <>
            <div className={styles.cardName}>{s.id === null ? t(lang, 'properties_ungrouped') : s.name}</div>
            <div className={styles.cardMeta}>
              {t(lang, s.siteCount === 1 ? 'properties_sites_one' : 'properties_sites_many').replace('{n}', String(s.siteCount))} ·{' '}
              {t(lang, 'properties_online').replace('{online}', String(s.online)).replace('{total}', String(s.siteCount))}
            </div>
            <div className={styles.cardStats}>
              <span>{t(lang, 'properties_solar_now')} {formatWattsShort(s.pvNowW)}</span>
              {s.avgSoc !== null && <span>{t(lang, 'properties_battery')} {s.avgSoc}%</span>}
              <span className={s.attention > 0 ? styles.statWarn : styles.statOk}>
                {s.attention > 0 ? t(lang, 'properties_attention').replace('{n}', String(s.attention)) : t(lang, 'properties_all_fine')}
              </span>
              {s.lowestScore !== null && <span title={t(lang, 'properties_lowest_score')}>{t(lang, 'properties_score').replace('{n}', String(s.lowestScore))}</span>}
            </div>
          </>
        );
        return s.id === null ? (
          <div key="ungrouped" className={`${styles.card} ${styles.cardMuted}`}>{body}</div>
        ) : (
          <Link key={s.id} href={href(basePath, { ...keep, property: s.id })} className={styles.card}>
            {body}
          </Link>
        );
      })}
    </section>
  );
}

// Which customer's sites the admin fleet shows: the admin's own fleet account first, then each other customer with live sites, then all.
export function CustomerSwitcher({ lang, basePath, customers, selectedId }: { lang: Lang; basePath: string; customers: { id: string; name: string; siteCount: number }[]; selectedId: string | null }) {
  if (customers.length < 2) return null;
  return (
    <nav className={styles.switcher} aria-label={t(lang, 'fleet_customer_label')}>
      {customers.map((c) => (
        <Link key={c.id} href={href(basePath, { customer: c.id })} className={`${styles.chip} ${selectedId === c.id ? styles.chipActive : ''}`} aria-current={selectedId === c.id ? 'page' : undefined}>
          {c.name} ({c.siteCount})
        </Link>
      ))}
      <Link href={href(basePath, { customer: 'all' })} className={`${styles.chip} ${selectedId === null ? styles.chipActive : ''}`} aria-current={selectedId === null ? 'page' : undefined}>
        {t(lang, 'fleet_all_customers')}
      </Link>
    </nav>
  );
}

import Link from 'next/link';
import type { SiteItem } from './siteItems';
import styles from './SiteFinder.module.css';

function watts(w: number | null): string {
  if (w === null) return '';
  return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;
}

/** One tappable line: status dot, name (and customer), charge, solar now, arrow. */
export function SiteRow({ site }: { site: SiteItem }) {
  return (
    <Link href={site.href} className={styles.row}>
      <span className={`${styles.dot} ${styles[`dot_${site.status}`]}`} aria-hidden="true" />
      <span className={styles.name}>
        <span className={styles.nameText}>{site.name}</span>
        {site.sub && <span className={styles.sub}>{site.sub}</span>}
      </span>
      {site.attention > 0 && <span className={styles.attention}>{site.attention}</span>}
      <span className={styles.figures}>
        {site.soc !== null && <span>{Math.round(site.soc)}%</span>}
        {site.pvW !== null && <span className={styles.pv}>{watts(site.pvW)}</span>}
      </span>
      <span className={styles.arrow} aria-hidden="true">›</span>
    </Link>
  );
}

/** Every site as compact rows — the phone version of the fleet table. */
export function SiteRows({ sites }: { sites: SiteItem[] }) {
  return (
    <div className={styles.list}>
      {sites.map((s) => (
        <SiteRow key={s.id} site={s} />
      ))}
    </div>
  );
}

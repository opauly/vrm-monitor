'use client';

// The tab row under a page title when a menu item covers several pages (Reports: Reports / Import CSV / Branding). Each tab is
// its own page, so bookmarks and the browser's back button keep working; this only marks which one is open.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './SectionTabs.module.css';

export type SectionTab = { href: string; label: string; exact?: boolean };

export function TabLinks({ tabs }: { tabs: SectionTab[] }) {
  const pathname = usePathname();
  return (
    <nav className={styles.tabs}>
      {tabs.map((tab) => {
        const active = pathname === tab.href || (!tab.exact && pathname.startsWith(`${tab.href}/`));
        return (
          <Link key={tab.href} href={tab.href} className={`${styles.tab} ${active ? styles.tabActive : ''}`} aria-current={active ? 'page' : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

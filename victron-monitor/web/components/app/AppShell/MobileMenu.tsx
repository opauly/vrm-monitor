'use client';

// Phone-width menu for AppShell's header. On desktop this renders as nothing
// but its children (`.menuPanel` is `display: contents`, the toggle is
// hidden), so the header lays out exactly as before; on a phone the nav and
// account row collapse behind the toggle instead of wrapping into three or
// four rows of links above every page.
//
// Open state is keyed by the pathname it was opened on rather than a plain
// boolean, so navigating (tapping a nav link) closes the menu without an
// effect to reset it.
import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import styles from './AppShell.module.css';

export function MobileMenu({ label, children }: { label: string; children: ReactNode }) {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  return (
    <>
      <button
        type="button"
        className={styles.menuToggle}
        aria-expanded={open}
        aria-controls="app-menu-panel"
        aria-label={label}
        onClick={() => setOpenOn(open ? null : pathname)}
      >
        <span className={`${styles.menuBars} ${open ? styles.menuBarsOpen : ''}`} aria-hidden="true" />
      </button>
      <div id="app-menu-panel" className={`${styles.menuPanel} ${open ? styles.menuPanelOpen : ''}`}>
        {children}
      </div>
    </>
  );
}

'use client';

// A fleet-page section that folds behind its heading. Open on a wide screen (where the page
// has room), closed on a phone (where it would push the site list screens away). The reader's
// own open/close wins after that.
import { useEffect, useRef, type ReactNode } from 'react';
import styles from './SiteFinder.module.css';

const WIDE = '(min-width: 900px)';

export function Fold({ title, count, children }: { title: ReactNode; count?: number; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia(WIDE).matches) ref.current.open = true;
  }, []);
  return (
    <details ref={ref} className={styles.fold}>
      <summary className={styles.foldHead}>
        <span className={styles.foldTitle}>{title}</span>
        {count !== undefined && <span className={styles.foldCount}>{count}</span>}
        <span className={styles.foldChevron} aria-hidden="true" />
      </summary>
      <div className={styles.foldBody}>{children}</div>
    </details>
  );
}

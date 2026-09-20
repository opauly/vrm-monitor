import styles from './HelpDiagrams.module.css';

// Illustrative, not a screenshot — same "labeled diagram, not a live
// widget" convention the marketing site's own LiveDashboard.tsx chart
// already follows. Explains the one fork every new site actually goes
// through (My Sites' VRM connection vs. Upload's one-off CSV) and why
// they behave differently downstream — referenced from both the customer
// Sites/Upload help topics and the admin Sites/Upload/VRM Fleet ones,
// hence living in components/app (shared), not duplicated per surface.
export function DataSourceDiagram() {
  return (
    <svg viewBox="0 0 640 220" className={styles.diagram} role="img" aria-label="Diagram: a VRM API connection syncs automatically every ~15 minutes into live data, feeding both scheduled or on-demand reports and the live dashboard (Growth and Fleet only). A CSV export is a one-time upload that only ever produces a single one-off report, with no live dashboard and no scheduling.">
      <defs>
        <marker id="hd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className={styles.arrowHead} />
        </marker>
      </defs>

      {/* Row 1 — VRM API */}
      <rect x="10" y="18" width="150" height="56" rx="6" className={styles.boxLive} />
      <text x="85" y="42" textAnchor="middle" className={styles.boxLabel}>VRM API</text>
      <text x="85" y="58" textAnchor="middle" className={styles.boxSubLabel}>connect once</text>

      <line x1="164" y1="46" x2="222" y2="46" className={styles.arrow} markerEnd="url(#hd-arrow)" />
      <text x="193" y="36" textAnchor="middle" className={styles.arrowLabel}>~15 min</text>

      <rect x="226" y="18" width="120" height="56" rx="6" className={styles.boxLive} />
      <text x="286" y="42" textAnchor="middle" className={styles.boxLabel}>Live data</text>
      <text x="286" y="58" textAnchor="middle" className={styles.boxSubLabel}>synced, ongoing</text>

      <line x1="350" y1="46" x2="408" y2="46" className={styles.arrow} markerEnd="url(#hd-arrow)" />

      <rect x="412" y="8" width="220" height="76" rx="6" className={styles.boxLive} />
      <text x="522" y="32" textAnchor="middle" className={styles.boxLabel}>Reports</text>
      <text x="522" y="47" textAnchor="middle" className={styles.boxSubLabel}>scheduled or on-demand</text>
      <text x="522" y="62" textAnchor="middle" className={styles.boxLabel}>+ Live dashboard*</text>

      {/* Row 2 — CSV upload */}
      <rect x="10" y="128" width="150" height="56" rx="6" className={styles.box} />
      <text x="85" y="152" textAnchor="middle" className={styles.boxLabel}>CSV export</text>
      <text x="85" y="168" textAnchor="middle" className={styles.boxSubLabel}>from VRM, by hand</text>

      <line x1="164" y1="156" x2="222" y2="156" className={styles.arrow} markerEnd="url(#hd-arrow)" />
      <text x="193" y="146" textAnchor="middle" className={styles.arrowLabel}>one-time</text>

      <rect x="226" y="128" width="220" height="56" rx="6" className={styles.box} />
      <text x="336" y="152" textAnchor="middle" className={styles.boxLabel}>One-off report</text>
      <text x="336" y="168" textAnchor="middle" className={styles.boxSubLabel}>no schedule, no live dashboard</text>

      <text x="10" y="210" className={styles.footnote}>* Live dashboard available on Growth and Fleet.</text>
    </svg>
  );
}

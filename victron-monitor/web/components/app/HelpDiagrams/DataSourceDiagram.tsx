import { t, type Lang } from '@/lib/i18n/strings';
import styles from './HelpDiagrams.module.css';

// Illustrative, not a screenshot — the marketing site's own
// DashboardPreview.tsx chart went the other way (2026-09-20, it now embeds
// the real ShapeChart component instead of a labeled illustration), but
// that's real production data on a public page reading believable rather
// than an internal admin diagram, which is what this stays. Explains the
// one fork every new site actually goes through (My Sites' VRM connection
// vs. Upload's one-off CSV) and why
// they behave differently downstream — referenced from both the customer
// Sites/Upload help topics and the admin Sites/Upload/VRM Fleet ones,
// hence living in components/app (shared), not duplicated per surface.
export function DataSourceDiagram({ lang = 'en' }: { lang?: Lang }) {
  return (
    <svg viewBox="0 0 640 220" className={styles.diagram} role="img" aria-label={t(lang, 'help_diagram_aria')}>
      <defs>
        <marker id="hd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className={styles.arrowHead} />
        </marker>
      </defs>

      {/* Row 1 — VRM API */}
      <rect x="10" y="18" width="150" height="56" rx="6" className={styles.boxLive} />
      <text x="85" y="42" textAnchor="middle" className={styles.boxLabel}>{t(lang, 'help_diagram_vrm_api')}</text>
      <text x="85" y="58" textAnchor="middle" className={styles.boxSubLabel}>{t(lang, 'help_diagram_connect_once')}</text>

      <line x1="164" y1="46" x2="222" y2="46" className={styles.arrow} markerEnd="url(#hd-arrow)" />
      <text x="193" y="36" textAnchor="middle" className={styles.arrowLabel}>{t(lang, 'help_diagram_15min')}</text>

      <rect x="226" y="18" width="120" height="56" rx="6" className={styles.boxLive} />
      <text x="286" y="42" textAnchor="middle" className={styles.boxLabel}>{t(lang, 'help_diagram_live_data')}</text>
      <text x="286" y="58" textAnchor="middle" className={styles.boxSubLabel}>{t(lang, 'help_diagram_synced_ongoing')}</text>

      <line x1="350" y1="46" x2="408" y2="46" className={styles.arrow} markerEnd="url(#hd-arrow)" />

      <rect x="412" y="8" width="220" height="76" rx="6" className={styles.boxLive} />
      <text x="522" y="32" textAnchor="middle" className={styles.boxLabel}>{t(lang, 'help_diagram_reports')}</text>
      <text x="522" y="47" textAnchor="middle" className={styles.boxSubLabel}>{t(lang, 'help_diagram_scheduled_or_ondemand')}</text>
      <text x="522" y="62" textAnchor="middle" className={styles.boxLabel}>{t(lang, 'help_diagram_plus_live_dashboard')}</text>

      {/* Row 2 — CSV upload */}
      <rect x="10" y="128" width="150" height="56" rx="6" className={styles.box} />
      <text x="85" y="152" textAnchor="middle" className={styles.boxLabel}>{t(lang, 'help_diagram_csv_export')}</text>
      <text x="85" y="168" textAnchor="middle" className={styles.boxSubLabel}>{t(lang, 'help_diagram_from_vrm_by_hand')}</text>

      <line x1="164" y1="156" x2="222" y2="156" className={styles.arrow} markerEnd="url(#hd-arrow)" />
      <text x="193" y="146" textAnchor="middle" className={styles.arrowLabel}>{t(lang, 'help_diagram_one_time')}</text>

      <rect x="226" y="128" width="220" height="56" rx="6" className={styles.box} />
      <text x="336" y="152" textAnchor="middle" className={styles.boxLabel}>{t(lang, 'help_diagram_one_off_report')}</text>
      <text x="336" y="168" textAnchor="middle" className={styles.boxSubLabel}>{t(lang, 'help_diagram_no_schedule_no_live')}</text>

      <text x="10" y="210" className={styles.footnote}>{t(lang, 'help_diagram_footnote')}</text>
    </svg>
  );
}

import { Eyebrow, Panel } from '@/components/ui';
import { ShapeChart } from '@/app/(admin)/admin/fleet/ShapeChart';
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './DashboardPreview.module.css';

// The illustrative "sample fleet" panel, extracted from LiveDashboard.tsx
// (2026-09-20) so /whats-inside can show the same visual instead of
// describing the live dashboard in pure prose — see that page's own "The
// live dashboard, in detail" section. The site-list summary below is still
// illustrative (there's no real /app/dashboard screenshot to show, and a
// public marketing page is the wrong place for real-looking fleet data
// even if synthetic) — but the shape chart underneath it is not a mockup
// anymore: it's the REAL `ShapeChart.tsx`, the exact component every
// paying customer's dashboard renders, fed by `/api/marketing/
// dashboard-sample/*` (2026-09-20, Oscar's own request) — two routes that
// return fully fabricated telemetry in the real endpoint's own JSON shape,
// same "real pipeline, invented household" convention `ReportPreview.tsx`
// already uses for `sample_report.png`. "Casa Modelo" is the same
// household name that PDF uses — the two proofs are meant to read as the
// same fictional home, not two unrelated demos — which is also why the
// site list's first row below is renamed to it and given scores
// consistent with that PDF's own "86/100."
//
// 2026-09-22 (Oscar's own audit): this used to show one blended "health"
// number per site — found live, that's not how the real dashboard reads
// AT ALL (`app/(portal)/app/dashboard/page.tsx`'s own table shows System
// and Grid as two separate pill badges, per its own "not one blended
// number" design), and this section sits directly under /whats-inside's
// own "Two scores, not one" cards making exactly that point — the
// illustration was contradicting the copy right above it. `scoreTier()`/
// `.healthBadge` + tier classes below mirror that real page's own
// `healthClass()`/`.healthBadge` thresholds and colors exactly, not a
// new palette invented for this marketing panel.
type SampleSite = {
  name: string;
  status: 'online' | 'flagged';
  systemScore: number;
  gridScore: number;
  pv: string;
};

const SAMPLE_SITES: SampleSite[] = [
  { name: 'Casa Modelo', status: 'online', systemScore: 86, gridScore: 91, pv: '3.9kW' },
  { name: 'Finca El Roble', status: 'online', systemScore: 92, gridScore: 88, pv: '1.4kW' },
  { name: 'Bodega Central', status: 'flagged', systemScore: 76, gridScore: 84, pv: '0.6kW' },
];

// Same thresholds as `app/(portal)/app/dashboard/page.tsx`'s own
// `healthClass()` — excellent >=90, good >=80, fair >=70, else poor.
function scoreTier(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 70) return 'fair';
  return 'poor';
}

const TIER_CLASS: Record<ReturnType<typeof scoreTier>, string> = {
  excellent: styles.healthExcellent,
  good: styles.healthGood,
  fair: styles.healthFair,
  poor: styles.healthPoor,
};

export function DashboardPreview({ lang }: { lang: Lang }) {
  return (
    <>
      <Panel variant="readout" hairline role="img" aria-label={t(lang, 'marketing_dashboard_aria')}>
        <div className={styles.head}>
          <span className={styles.site}>
            {t(lang, 'marketing_dashboard_site_label')} <b>· {t(lang, 'marketing_dashboard_period')}</b>
          </span>
          <Eyebrow amber className={styles.liveEyebrow}>
            {t(lang, 'marketing_readout_live')}
          </Eyebrow>
        </div>
        <div className={styles.summaryRow}>
          <span>
            <b className={styles.summaryGood}>12/12</b> {t(lang, 'marketing_dashboard_sites_online')}
          </span>
          <span>
            {t(lang, 'marketing_dashboard_avg_system')} <b className={styles.summaryGood}>85/100</b>
          </span>
          <span>
            {t(lang, 'marketing_dashboard_avg_grid')} <b className={styles.summaryGood}>88/100</b>
          </span>
        </div>
        <ul className={styles.siteList}>
          {SAMPLE_SITES.map((site) => (
            <li key={site.name} className={styles.siteRow}>
              <span className={`${styles.dot} ${site.status === 'flagged' ? styles.dotFlag : styles.dotOnline}`} aria-hidden="true" />
              <span className={styles.siteName}>{site.name}</span>
              <span className={styles.scorePair}>
                <span className={`${styles.healthBadge} ${TIER_CLASS[scoreTier(site.systemScore)]}`}>Sys {site.systemScore}</span>
                <span className={`${styles.healthBadge} ${TIER_CLASS[scoreTier(site.gridScore)]}`}>Grid {site.gridScore}</span>
              </span>
              <span className={styles.pv}>{site.pv} PV</span>
            </li>
          ))}
        </ul>
        <p className={styles.narr}>{t(lang, 'marketing_dashboard_flagged_narrative')}</p>
      </Panel>

      <div className={styles.liveChartWrap}>
        <ShapeChart
          siteIds={['casa-modelo']}
          title="Casa Modelo"
          cardSub={t(lang, 'marketing_dashboard_chart_sub')}
          apiBasePath="/api/marketing/dashboard-sample"
        />
      </div>
    </>
  );
}

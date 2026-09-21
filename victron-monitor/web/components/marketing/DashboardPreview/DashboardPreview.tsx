import { Eyebrow, Panel } from '@/components/ui';
import { ShapeChart } from '@/app/(admin)/admin/fleet/ShapeChart';
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
// site list's first row below is renamed to it and given a health score
// consistent with that PDF's own "86/100."
type SampleSite = {
  name: string;
  status: 'online' | 'flagged';
  health: number;
  pv: string;
};

const SAMPLE_SITES: SampleSite[] = [
  { name: 'Casa Modelo', status: 'online', health: 86, pv: '3.9kW' },
  { name: 'Finca El Roble', status: 'online', health: 88, pv: '1.4kW' },
  { name: 'Bodega Central', status: 'flagged', health: 76, pv: '0.6kW' },
];

export function DashboardPreview() {
  return (
    <>
      <Panel
        variant="readout"
        hairline
        role="img"
        aria-label="Sample fleet dashboard listing three sites: Casa Modelo online at health score 86, Finca El Roble online at 88, and Bodega Central flagged for quiet drift at 76, each with a live solar reading"
      >
        <div className={styles.head}>
          <span className={styles.site}>
            SAMPLE FLEET <b>· LIVE VIEW</b>
          </span>
          <Eyebrow amber className={styles.liveEyebrow}>
            Live
          </Eyebrow>
        </div>
        <div className={styles.summaryRow}>
          <span>
            <b className={styles.summaryGood}>12/12</b> sites online
          </span>
          <span>
            avg health <b className={styles.summaryGood}>91/100</b>
          </span>
        </div>
        <ul className={styles.siteList}>
          {SAMPLE_SITES.map((site) => (
            <li key={site.name} className={styles.siteRow}>
              <span className={`${styles.dot} ${site.status === 'flagged' ? styles.dotFlag : styles.dotOnline}`} aria-hidden="true" />
              <span className={styles.siteName}>{site.name}</span>
              <span className={site.status === 'flagged' ? styles.healthFlag : styles.health}>{site.health}</span>
              <span className={styles.pv}>{site.pv} PV</span>
            </li>
          ))}
        </ul>
        <p className={styles.narr}>
          <b>Bodega Central</b> flagged for quiet drift — generating 18% below its own recent baseline.
        </p>
      </Panel>

      <div className={styles.liveChartWrap}>
        <ShapeChart
          siteIds={['casa-modelo']}
          title="Casa Modelo"
          cardSub="Sample site · the real live chart, not a mockup — powered by fabricated data, same component every customer's dashboard renders"
          apiBasePath="/api/marketing/dashboard-sample"
        />
      </div>
    </>
  );
}

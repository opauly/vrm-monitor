import type { SiteShapeOut, SiteSavingsOut } from './pipeline';

// Fabricated "Casa Modelo" telemetry, shared by the two
// `/api/marketing/dashboard-sample/*` routes those feed the REAL
// `ShapeChart.tsx` component on the marketing site (`DashboardPreview.tsx`)
// — 2026-09-20, Oscar's own request to make the live-dashboard demo as
// honest as `ReportPreview`'s own "real pipeline, invented household"
// convention, rather than the hand-drawn illustrative SVG it replaces.
// "Casa Modelo" is deliberately the SAME household name `sample_report.png`
// already uses (`ReportPreview.tsx`) — a visitor who looks at both proofs
// should read them as the same fictional home, not two unrelated demos.
// This file holds no real customer data and is queried by nothing else;
// it exists purely so both mock routes below share one fabricated dataset
// instead of drifting apart if edited separately.
//
// Numbers are hand-authored to *look* like real 15-minute-interval VRM
// telemetry rounded to the hour (solar bell curve, load baseline with
// morning/evening peaks, battery covering the gap, grid staying small to
// back up the report's own "94.0% grid independence" framing) — not
// energy-balanced to the watt, same "illustrative but plausible" standard
// the SVG mockup it replaces already used for its own PV_POINTS/LOAD_POINTS
// arrays. All three ranges (today/week/month) return this same "typical
// day" shape — this is a fixed demo dataset, not a live aggregation, so
// there's nothing for the three ranges to genuinely differ on.
const SOLAR_W: (number | null)[] = [
  0, 0, 0, 0, 0, 0, 100, 550, 1600, 2900, 3900, 4400, 4600, 4400, 3800, 2900, 1700, 650, 100, 0, 0, 0, 0, 0,
];
const LOAD_W: (number | null)[] = [
  750, 700, 680, 670, 690, 780, 1050, 1300, 1200, 1100, 1050, 1080, 1120, 1080, 1050, 1100, 1350, 1900, 2200, 2050, 1650, 1300, 1000, 850,
];
// Positive = discharging (covering load beyond what solar/grid supply),
// negative = charging from solar surplus.
const BATTERY_W: (number | null)[] = [
  680, 650, 630, 620, 640, 730, 900, 700, -380, -1750, -2800, -3000, -3000, -3000, -2700, -1750, -330, 1200, 2000, 1950, 1550, 1220, 930, 800,
];
// Positive = imported from the grid, negative = exported to it — kept
// small all day, matching the report's own "94.0% grid independence."
const GRID_W: (number | null)[] = [
  50, 40, 40, 40, 40, 40, 50, 50, -20, -50, -50, -320, -480, -320, -50, -50, -20, 50, 100, 100, 100, 80, 70, 50,
];

export const MARKETING_SAMPLE_SHAPE: SiteShapeOut = {
  solar: SOLAR_W,
  load: LOAD_W,
  battery: BATTERY_W,
  grid: GRID_W,
};

export const MARKETING_SAMPLE_SAVINGS: SiteSavingsOut = {
  amount: 18.75,
  currency: 'USD',
  basis_count: 6,
  days_with_data: 7,
};

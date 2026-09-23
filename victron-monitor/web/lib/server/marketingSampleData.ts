import type { SiteShapeOut, SiteSavingsOut, SiteShapeRange } from './pipeline';

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
// arrays.
//
// 2026-09-22 (Oscar's own audit, real live test): a visitor toggling
// Today/7-day avg/30-day avg saw the exact same chart and the exact same
// "Estimated savings" figure every time — the original version of this
// file deliberately returned one fixed shape for all three ranges ("this
// is a fixed demo dataset, not a live aggregation, so there's nothing for
// the three ranges to genuinely differ on" — that reasoning undersold what
// a first-time visitor actually expects: SOME visible response to a
// control they can see and click reads as broken when there's none at
// all). Three distinct shapes now — 7-day and 30-day averages scaled down
// from "today"'s own clear-sky peak, the same direction more cloud cover/
// Costa Rica's rainy season would actually pull a real average toward —
// and grid import grows slightly as solar shrinks, the same real
// trade-off the report's own AI narrative already describes elsewhere.
// Savings amounts follow `SiteSavingsOut`'s own real semantics
// (`compute_weekly_savings()`'s total across the requested window, not a
// per-day rate — that's what `days_with_data` is for) rather than
// repeating one number: today's total < the 7-day total < the 30-day
// total, in the same rough per-day ratio a real September/October (rainy
// season) month would show against one good day.
function shapeFor(peakSolar: number, gridScale: number): SiteShapeOut {
  const solarShape = [0, 0, 0, 0, 0, 0, 0.022, 0.12, 0.35, 0.63, 0.85, 0.96, 1, 0.96, 0.83, 0.63, 0.37, 0.14, 0.022, 0, 0, 0, 0, 0];
  const solar = solarShape.map((f) => Math.round(f * peakSolar));
  // Load stays close to flat across ranges — a household's own usage
  // pattern doesn't shift with weather the way solar output does.
  const load = [
    750, 700, 680, 670, 690, 780, 1050, 1300, 1200, 1100, 1050, 1080, 1120, 1080, 1050, 1100, 1350, 1900, 2200, 2050, 1650, 1300, 1000, 850,
  ];
  const battery: number[] = [];
  const grid: number[] = [];
  for (let i = 0; i < 24; i++) {
    const net = solar[i] - load[i]; // >0 = surplus (charges battery), <0 = deficit (battery/grid cover it)
    // A fixed small grid draw/export, scaled up as solar shrinks (less
    // self-sufficiency the cloudier the averaging window gets) — mirrors
    // GRID_W's own original small-all-day shape, not a new curve.
    const gridBase = [50, 40, 40, 40, 40, 40, 50, 50, -20, -50, -50, -320, -480, -320, -50, -50, -20, 50, 100, 100, 100, 80, 70, 50][i];
    const g = Math.round(gridBase * gridScale);
    grid.push(g);
    battery.push(Math.round(-(net - g)));
  }
  return { solar, load, battery, grid };
}

const SHAPES: Record<SiteShapeRange, SiteShapeOut> = {
  today: shapeFor(4600, 1),
  week: shapeFor(3800, 1.25),
  month: shapeFor(3000, 1.6),
};

const SAVINGS: Record<SiteShapeRange, SiteSavingsOut> = {
  today: { amount: 2.9, currency: 'USD', basis_count: 1, days_with_data: 1 },
  week: { amount: 18.75, currency: 'USD', basis_count: 6, days_with_data: 7 },
  month: { amount: 65.4, currency: 'USD', basis_count: 26, days_with_data: 30 },
};

export function marketingSampleShape(range: SiteShapeRange): SiteShapeOut {
  return SHAPES[range];
}

export function marketingSampleSavings(range: SiteShapeRange): SiteSavingsOut {
  return SAVINGS[range];
}

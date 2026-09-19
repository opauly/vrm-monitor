// Shared copy for the System/Grid score InfoTooltips — one definition,
// four call sites (customer dashboard + admin fleet, each with a fleet
// rollup card and a per-site detail block), so the explanation can't
// drift out of sync with `vrm.compute_daily_health()`/
// `monitoring.compute_daily_health()`'s actual logic (see
// victron-monitor/sql/vrm_compute_daily_health.sql) the way four
// hand-copied strings eventually would.
export const SYSTEM_SCORE_INFO = (
  <>
    <p>Starts at 100 and deducts for equipment issues that day: alarm events, low battery SOC, heavy cycling, high temperature, low voltage, and not reaching a full charge.</p>
    <p>A low SOC isn&apos;t penalized if a real grid outage explains it that day — the battery discharging to cover the load while the grid was down is the system working as designed, not a fault.</p>
  </>
);

export const GRID_SCORE_INFO = (
  <>
    <p>Starts at 100 and deducts for grid reliability that day: how long and how often the grid was out, and how much of the load came from the grid instead of solar/battery.</p>
    <p>Not shown (&mdash;) for an off-grid system with no grid connection at all &mdash; there&apos;s nothing to score, which is different from a perfect grid.</p>
  </>
);

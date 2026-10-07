// "So far today" figures from the site-shape response (`/vrm-fleet/site-shape`,
// range=today): 24 hourly averages per series, plus the lowest battery charge
// seen in the 15-minute readings. Pure, so the arithmetic is testable on its own.
//
// Each hourly figure is that hour's average power in watts, which is the energy
// of that hour in Wh, so a day-so-far total is the sum over the hours that have
// data. The gauge formulas are the same ones the stored daily figures use
// (`fleetOverviewCore.ts:_dailyIndicators`), so Today and the other days are
// directly comparable.

export type ShapeToday = {
  solar: (number | null)[];
  load: (number | null)[];
  grid: (number | null)[];
  soc_min?: number | null;
};

export type TodayTotals = {
  pv: number | null;
  load: number | null;
  gridImport: number | null;
  gridExport: number | null;
  selfSufficiencyPct: number | null;
  selfConsumptionPct: number | null;
  /** Lowest battery charge (%) so far today, and 100 minus it. */
  lowestSocPct: number | null;
  dodPct: number | null;
};

const kwh = (values: (number | null)[], pick: (v: number) => number = (v) => v): number | null => {
  const present = values.filter((v): v is number => typeof v === 'number');
  return present.length === 0 ? null : present.reduce((total, v) => total + pick(v), 0) / 1000;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function todayTotals(shape: ShapeToday): TodayTotals {
  const pv = kwh(shape.solar);
  const load = kwh(shape.load);
  const gridImport = kwh(shape.grid, (v) => Math.max(v, 0));
  const gridExport = kwh(shape.grid, (v) => Math.max(-v, 0));

  // Same as _dailyIndicators: what the solar made minus what was exported was
  // used on site, and that plus what came from the grid is the load.
  const consumed = pv === null ? null : Math.max(pv - (gridExport ?? 0), 0);
  const totalLoad = consumed !== null && gridImport !== null ? consumed + gridImport : null;
  const selfSufficiencyPct = totalLoad !== null && totalLoad > 0 && gridImport !== null ? round1((1 - gridImport / totalLoad) * 100) : null;
  const selfConsumptionPct = pv !== null && pv > 0 && consumed !== null ? round1((consumed / pv) * 100) : null;

  const lowest = typeof shape.soc_min === 'number' ? shape.soc_min : null;
  return {
    pv,
    load,
    gridImport,
    gridExport,
    selfSufficiencyPct,
    selfConsumptionPct,
    lowestSocPct: lowest,
    dodPct: lowest === null ? null : round1(100 - lowest),
  };
}

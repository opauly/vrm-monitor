// The points behind a daily health score, as stored by
// `vrm.compute_daily_health()` (victron-monitor/sql/vrm_health_breakdown.sql):
// one entry per reason, in the order they were applied. The stored entries
// always add up — 100 plus every `points` — to the stored score, so the UI
// shows the real arithmetic instead of re-deriving it.

export type HealthBreakdownItem = {
  /** Stable reason id, e.g. `alarm_events`, `grid_dependency_high`. */
  code: string;
  /** Negative = points taken off; 0 = informational; positive only for the outage-cap refund. */
  points: number;
  /** What was measured (alarms, %, minutes, °C, V, cycles…), when it applies. */
  value?: number;
  /** The threshold it was judged against, when it applies. */
  limit?: number;
  /** Battery cycling only: `value` is an estimate from the SOC swing, in %. */
  estimated?: boolean;
};

/** Reads the jsonb column defensively: anything that isn't a well-formed list is "no breakdown". */
export function parseBreakdown(raw: unknown): HealthBreakdownItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: HealthBreakdownItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.code !== 'string' || typeof e.points !== 'number') return null;
    items.push({
      code: e.code,
      points: e.points,
      ...(typeof e.value === 'number' ? { value: e.value } : {}),
      ...(typeof e.limit === 'number' ? { limit: e.limit } : {}),
      ...(e.estimated === true ? { estimated: true } : {}),
    });
  }
  return items;
}

// ── Over a period (last 7 / 30 days) ─────────────────────────────────────

/** One reason, across the days of a period it applied. */
export type AggregatedItem = {
  code: string;
  /** How many of the period's days this reason applied on. */
  days: number;
  /** Average points per day across the WHOLE period (days it didn't apply count as 0). */
  points: number;
  /** The most recent day's entry — supplies the measured value / limit shown. */
  latest: HealthBreakdownItem;
};

export type PeriodScore = {
  /** Mean of the daily scores, rounded. */
  score: number;
  /** Days this covers (those scored with a stored breakdown). */
  days: number;
  items: AggregatedItem[];
};

export function scoreBand(score: number): 'excellent' | 'good' | 'watch' | 'attention' {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 70) return 'watch';
  return 'attention';
}

/**
 * Folds several scored days into one period score. Only days that have a stored
 * breakdown count — older days were scored before the points were stored — so
 * the lines and the headline always describe the same set of days. `days` is
 * newest-first or any order; each reason's `latest` is chosen by `date`.
 */
export function aggregateScores(days: { date: string; score: number; items: HealthBreakdownItem[] | null }[]): PeriodScore | null {
  const usable = days.filter((d): d is { date: string; score: number; items: HealthBreakdownItem[] } => d.items !== null);
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a.date.localeCompare(b.date));

  const byCode = new Map<string, { days: number; points: number; latest: HealthBreakdownItem }>();
  for (const day of sorted) {
    for (const item of day.items) {
      const entry = byCode.get(item.code);
      byCode.set(item.code, { days: (entry?.days ?? 0) + 1, points: (entry?.points ?? 0) + item.points, latest: item });
    }
  }
  const items: AggregatedItem[] = [...byCode.entries()]
    .map(([code, e]) => ({ code, days: e.days, points: Math.round((e.points / usable.length) * 10) / 10, latest: e.latest }))
    // Biggest cost first; informational (0-point) reasons last.
    .sort((a, b) => a.points - b.points);

  const score = Math.round(usable.reduce((sum, d) => sum + d.score, 0) / usable.length);
  return { score, days: usable.length, items };
}

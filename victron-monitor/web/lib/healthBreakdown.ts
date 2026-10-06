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

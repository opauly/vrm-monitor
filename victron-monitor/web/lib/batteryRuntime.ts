// "How long will the battery last / how long until it is full", at the power it
// is drawing or taking right now. A snapshot estimate, not a forecast — solar
// coming back or the load changing moves it — which is why the tile says so.

/** Below this the battery is neither charging nor discharging in any useful sense. */
const IDLE_W = 10;

export type BatteryRuntime =
  | { kind: 'unknown' }
  | { kind: 'idle' }
  | { kind: 'left' | 'to_full'; hours: number };

export function batteryRuntime(socPct: number | null, usableKwh: number | null, batteryW: number | null): BatteryRuntime {
  if (socPct === null || batteryW === null || usableKwh === null || usableKwh <= 0) return { kind: 'unknown' };
  if (Math.abs(batteryW) < IDLE_W) return { kind: 'idle' };
  const soc = Math.min(Math.max(socPct, 0), 100);
  if (batteryW < 0) return { kind: 'left', hours: ((soc / 100) * usableKwh * 1000) / -batteryW };
  return { kind: 'to_full', hours: (((100 - soc) / 100) * usableKwh * 1000) / batteryW };
}

/** "45 min", "9.5 h", "48+ h" — one rounding rule for every language. */
export function formatHours(hours: number): string {
  if (hours >= 48) return '48+ h';
  if (hours < 1) return `${Math.max(Math.round(hours * 60), 1)} min`;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

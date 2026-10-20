export type { PropertySummary } from '@/lib/propertyOverview';

export function formatWattsShort(w: number | null): string {
  if (w === null) return '—';
  return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;
}

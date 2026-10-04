// Energy flow diagram — Solar/Grid/Home/Battery nodes with animated dashed
// connectors, shared by the fleet-wide rollup (aggregate values) and the
// per-site drill-down (one site's values). Pure presentational: every
// number is a prop, no data fetching, no client state — the CSS animation
// (dashed lines "flowing") is plain `@keyframes`, so this stays a Server
// Component like the rest of `/admin/fleet`.
//
// The connectors follow the data: each one flows in the direction its
// reading says (grid import vs export, battery charging vs discharging),
// speeds up and thickens with the size of the reading (log scale — a
// fleet's 10 kW and a single site's 300 W must both look alive), and goes
// still and dim when idle, instead of always animating the same way.
import { t, type Lang } from '@/lib/i18n/strings';
import styles from './flow-diagram.module.css';

function formatW(w: number | null): string {
  if (w === null) return '—';
  return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(1)}kW` : `${Math.round(w)}W`;
}

// Below this a reading is noise (an inverter's own AC-input measurement
// wobbles a few watts around zero), not a flow worth animating.
const DEADBAND_W = 10;

/** How many of `values` are flowing in each direction (outside the
 * deadband) — for the fleet roll-up, where the NET arrow alone can hide that
 * some sites are charging while others discharge. */
export type FlowSplit = { positive: number; negative: number };

export function splitCounts(values: (number | null)[]): FlowSplit {
  let positive = 0;
  let negative = 0;
  for (const v of values) {
    if (v === null) continue;
    if (v > DEADBAND_W) positive += 1;
    else if (v < -DEADBAND_W) negative += 1;
  }
  return { positive, negative };
}

type Line = { idle: boolean; reverse: boolean; style: React.CSSProperties };

// `forwardSign` is the sign of the reading for which the path's own drawn
// direction (its `d` start -> end) is the real flow direction.
function lineFor(w: number | null, forwardSign: 1 | -1): Line {
  if (w === null || Math.abs(w) < DEADBAND_W) return { idle: true, reverse: false, style: {} };
  const magnitude = Math.min(Math.max((Math.log10(Math.abs(w)) - 2) / 2, 0), 1);
  return {
    idle: false,
    reverse: w * forwardSign < 0,
    style: {
      ['--dur' as string]: `${(2.2 - 1.5 * magnitude).toFixed(2)}s`,
      ['--w' as string]: (2 + 1.5 * magnitude).toFixed(2),
    },
  };
}

const lineClass = (line: Line) => `${styles.path} ${line.idle ? styles.idle : ''} ${line.reverse ? styles.reverse : ''}`;

const SOC_RING_CIRCUMFERENCE = 2 * Math.PI * 31;
const MIX_RING_RADIUS = 40;
const MIX_RING_CIRCUMFERENCE = 2 * Math.PI * MIX_RING_RADIUS;

export function FlowDiagram({
  lang,
  solarW,
  solarNote,
  loadW,
  loadLabel = 'Home',
  batteryW,
  batteryNote,
  batterySplit,
  socPct = null,
  gridW,
  hasGridMeter,
  gridNote,
  gridSplit,
}: {
  lang: Lang;
  solarW: number | null;
  solarNote?: string;
  loadW: number | null;
  loadLabel?: string;
  batteryW: number | null;
  batteryNote?: string;
  /** Fleet roll-up only: positive = charging sites, negative = discharging. */
  batterySplit?: FlowSplit;
  /** Fills the battery ring; omitted/`null` leaves it a plain ring. */
  socPct?: number | null;
  gridW: number | null;
  hasGridMeter: boolean;
  gridNote?: string;
  /** Fleet roll-up only: positive = importing sites, negative = exporting. */
  gridSplit?: FlowSplit;
}) {
  const batteryCharging = batteryW !== null && batteryW >= 0;
  const batteryAmt = batteryW === null ? '—' : `${batteryCharging ? '+' : ''}${formatW(batteryW)}`;

  const solarLine = lineFor(solarW, 1);
  // Grid path is drawn grid -> home (import), battery path battery -> home
  // (discharge, which is the NEGATIVE sign convention VRM uses for `bp`).
  const gridLine = lineFor(gridW, 1);
  const batteryLine = lineFor(batteryW, -1);
  const gridExporting = !gridLine.idle && gridLine.reverse;

  const splitText = (split: FlowSplit, positiveKey: Parameters<typeof t>[1], negativeKey: Parameters<typeof t>[1]) => {
    const parts: string[] = [];
    if (split.positive > 0) parts.push(`${split.positive} ${t(lang, positiveKey)}`);
    if (split.negative > 0) parts.push(`${split.negative} ${t(lang, negativeKey)}`);
    return parts.length > 0 ? parts.join(' · ') : t(lang, 'flow_diagram_idle');
  };
  const netText = (w: number | null, positiveKey: Parameters<typeof t>[1], negativeKey: Parameters<typeof t>[1]) =>
    w === null ? null : Math.abs(w) < DEADBAND_W ? t(lang, 'flow_diagram_idle') : t(lang, w > 0 ? positiveKey : negativeKey);

  const gridState = !hasGridMeter
    ? null
    : gridSplit
      ? splitText(gridSplit, 'flow_diagram_importing', 'flow_diagram_exporting')
      : netText(gridW, 'flow_diagram_importing', 'flow_diagram_exporting');
  const batteryState = batterySplit
    ? splitText(batterySplit, 'flow_diagram_charging', 'flow_diagram_discharging')
    : netText(batteryW, 'flow_diagram_charging', 'flow_diagram_discharging');

  // Where the power at this instant comes from. Needs the grid reading to
  // mean anything — without it the "grid" share is unknown, not zero, and
  // the mix would overstate how self-powered the home is.
  const sources = {
    solar: Math.max(solarW ?? 0, 0),
    battery: Math.max(-(batteryW ?? 0), 0),
    grid: hasGridMeter ? Math.max(gridW ?? 0, 0) : 0,
  };
  const sourceTotal = sources.solar + sources.battery + sources.grid;
  const showMix = hasGridMeter && loadW !== null && sourceTotal >= DEADBAND_W;
  const share = {
    solar: showMix ? sources.solar / sourceTotal : 0,
    battery: showMix ? sources.battery / sourceTotal : 0,
    grid: showMix ? sources.grid / sourceTotal : 0,
  };
  const pct = (f: number) => Math.round(f * 100);
  const selfPoweredPct = showMix ? pct(share.solar + share.battery) : null;
  const mixSegments = [
    { key: 'solar', fraction: share.solar, color: 'var(--signal)' },
    { key: 'battery', fraction: share.battery, color: 'var(--good)' },
    { key: 'grid', fraction: share.grid, color: 'var(--mute)' },
  ].filter((segment) => segment.fraction > 0);
  let mixOffset = 0;

  const soc = socPct === null ? null : Math.min(Math.max(socPct, 0), 100);

  return (
    <div className={styles.flow}>
      <svg className={styles.lines} viewBox="0 0 400 440" preserveAspectRatio="none" aria-hidden="true">
        <path className={`${lineClass(solarLine)} ${styles.solarHome}`} style={solarLine.style} d="M 75 40 Q 180 55 195 120" />
        {/* Ends at 266, not the home node's exact text-bottom (110 + 82 ring +
           name + amt + state = ~256) — that left zero clearance, so the dashed
           line's own start dot sat right on top of the state text. */}
        <path className={`${lineClass(batteryLine)} ${styles.batteryHome}`} style={batteryLine.style} d="M 200 296 Q 200 281 200 266" />
        {hasGridMeter && (
          <path
            className={`${lineClass(gridLine)} ${gridExporting ? styles.gridExport : styles.gridHome}`}
            style={gridLine.style}
            d="M 325 40 Q 220 55 205 120"
          />
        )}
      </svg>

      <div className={`${styles.node} ${styles.solar}`}>
        <div className={styles.ring}>
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="var(--signal)" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
          </svg>
        </div>
        <div className={styles.name}>{t(lang, 'flow_diagram_solar')}</div>
        <div className={styles.amt}>{formatW(solarW)}</div>
        {solarNote && <div className={styles.footnote}>{solarNote}</div>}
      </div>

      <div className={`${styles.node} ${styles.grid}`}>
        <div className={styles.ring}>
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="var(--mute)" strokeWidth={1.8}>
            <path d="M6 21V10l6-6 6 6v11M9 21v-6h6v6" />
          </svg>
        </div>
        <div className={styles.name}>{t(lang, 'flow_diagram_grid')}</div>
        <div className={styles.amt} style={!hasGridMeter ? { color: 'var(--mute)' } : undefined}>
          {hasGridMeter ? formatW(gridW) : t(lang, 'flow_diagram_no_reading')}
        </div>
        {gridState && <div className={styles.state}>{gridState}</div>}
        {gridNote && <div className={styles.footnote}>{gridNote}</div>}
      </div>

      <div className={`${styles.node} ${styles.home}`}>
        <div className={`${styles.ring} ${showMix ? styles.mixRing : ''}`}>
          {showMix && (
            <svg
              className={styles.arc}
              viewBox="0 0 82 82"
              role="img"
              aria-label={t(lang, 'flow_diagram_mix_label')
                .replace('{solar}', String(pct(share.solar)))
                .replace('{battery}', String(pct(share.battery)))
                .replace('{grid}', String(pct(share.grid)))}
            >
              {mixSegments.map((segment) => {
                // A hairline gap between segments, only when there is more
                // than one — a lone 100% segment is just a full ring.
                const gap = mixSegments.length > 1 ? 2 : 0;
                const length = Math.max(segment.fraction * MIX_RING_CIRCUMFERENCE - gap, 0.5);
                const offset = -mixOffset * MIX_RING_CIRCUMFERENCE;
                mixOffset += segment.fraction;
                return (
                  <circle
                    key={segment.key}
                    cx="41"
                    cy="41"
                    r={MIX_RING_RADIUS}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth={3}
                    strokeDasharray={`${length} ${MIX_RING_CIRCUMFERENCE - length}`}
                    strokeDashoffset={offset}
                    transform="rotate(-90 41 41)"
                  />
                );
              })}
            </svg>
          )}
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={1.6}>
            <path d="M3 11l9-7 9 7" />
            <path d="M5 10v10h14V10" />
          </svg>
        </div>
        <div className={styles.name}>{loadLabel}</div>
        <div className={styles.amt}>{formatW(loadW)}</div>
        {selfPoweredPct !== null && (
          <div className={styles.state}>{t(lang, 'flow_diagram_self_powered').replace('{n}', String(selfPoweredPct))}</div>
        )}
      </div>

      <div className={`${styles.node} ${styles.battery}`}>
        <div className={`${styles.ring} ${soc !== null ? styles.socRing : ''}`}>
          {soc !== null && (
            <svg className={styles.arc} viewBox="0 0 64 64" role="img" aria-label={`${Math.round(soc)}%`}>
              <circle
                cx="32"
                cy="32"
                r="31"
                fill="none"
                stroke={soc < 25 ? 'var(--signal)' : 'var(--good)'}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={`${(soc / 100) * SOC_RING_CIRCUMFERENCE} ${SOC_RING_CIRCUMFERENCE}`}
                transform="rotate(-90 32 32)"
              />
            </svg>
          )}
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="var(--good)" strokeWidth={1.8}>
            <rect x="3" y="8" width="16" height="9" rx="1.5" />
            <path d="M19 11h2v3h-2M8 12v-1M11 12v-3M14 12v1" />
          </svg>
        </div>
        <div className={styles.name}>
          {t(lang, 'flow_diagram_battery')}
          {batteryNote ? `, ${batteryNote}` : ''}
        </div>
        <div className={styles.amt}>{batteryAmt}</div>
        {batteryState && <div className={styles.state}>{batteryState}</div>}
      </div>
    </div>
  );
}

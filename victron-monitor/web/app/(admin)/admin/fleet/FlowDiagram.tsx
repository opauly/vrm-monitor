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
import { t, type Lang, type StringKey } from '@/lib/i18n/strings';
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

/** Fleet roll-up only: what each side of the grid and battery actually carries.
 * A fleet has sites importing while others export (charging while others
 * discharge), so one net number — and one arrow direction — would mislead; with
 * this the diagram shows both directions, still lines, and a mix built from
 * every site's own contribution. Watts, all >= 0. */
export type GrossFlows = {
  gridImportW: number;
  gridImportSites: number;
  gridExportW: number;
  gridExportSites: number;
  batteryChargeW: number;
  batteryChargeSites: number;
  batteryDischargeW: number;
  batteryDischargeSites: number;
};

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

const lineClass = (line: Line, still = false) =>
  `${styles.path} ${line.idle ? styles.idle : ''} ${line.reverse ? styles.reverse : ''} ${still ? styles.still : ''}`;

// Where a segment's percentage sits on the home ring, as degrees clockwise
// from 12 o'clock. Two arcs of the ring are off-limits: the top (solar and
// grid connectors both enter there) and the bottom (the node's own name and
// the battery connector) — a label whose natural midpoint lands in one is
// pushed to the nearest edge of it, i.e. onto the left or right side.
function nudgeLabelAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  if (a < 35) return 35;
  if (a > 325) return 325;
  if (a > 130 && a < 230) return a < 180 ? 130 : 230;
  return a;
}
// Segments below this are too thin to carry a readable label.
const MIX_LABEL_MIN_SHARE = 0.04;
const MIX_LABEL_MIN_GAP_DEG = 24;

const SOC_RING_CIRCUMFERENCE = 2 * Math.PI * 31;
const MIX_RING_RADIUS = 40;
const MIX_RING_CIRCUMFERENCE = 2 * Math.PI * MIX_RING_RADIUS;

// One line per direction ("↓ 1.9kW imported · 4 sites"), only for directions
// that carry something, and the net as a quiet footnote — never as the headline.
function GrossRows({
  lang,
  rows,
  netW,
}: {
  lang: Lang;
  rows: { arrow: string; w: number; sites: number; labelKey: StringKey }[];
  netW: number | null;
}) {
  const active = rows.filter((row) => row.sites > 0);
  const sitesText = (n: number) => t(lang, n === 1 ? 'flow_fleet_site_one' : 'flow_fleet_sites_many').replace('{n}', String(n));
  return (
    <div className={styles.gross}>
      {active.length === 0 && <div className={styles.state}>{t(lang, 'flow_diagram_idle')}</div>}
      {active.map((row) => (
        <div key={row.labelKey} className={styles.grossRow}>
          <span className={styles.grossAmt}>
            {row.arrow} {formatW(row.w)}
          </span>
          <span className={styles.grossWhat}>
            {t(lang, row.labelKey)} · {sitesText(row.sites)}
          </span>
        </div>
      ))}
      {netW !== null && active.length > 1 && <div className={styles.grossNet}>{t(lang, 'flow_fleet_net').replace('{w}', `${netW > 0 ? '+' : ''}${formatW(netW)}`)}</div>}
    </div>
  );
}

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
  gross,
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
  /** Fleet roll-up: gross flows per direction (see GrossFlows). Replaces the
   * net-direction animation and the netted mix with per-direction figures. */
  gross?: GrossFlows;
}) {
  const batteryCharging = batteryW !== null && batteryW >= 0;
  const batteryAmt = batteryW === null ? '—' : `${batteryCharging ? '+' : ''}${formatW(batteryW)}`;

  // Where solar/grid connectors meet the home ring. Animated dashes can run on
  // under the ring edge; an arrowhead can't, so fleet mode stops just above it.
  const homeEndY = gross ? 106 : 120;

  const solarLine = lineFor(solarW, 1);
  // Grid path is drawn grid -> home (import), battery path battery -> home
  // (discharge, which is the NEGATIVE sign convention VRM uses for `bp`).
  // In a fleet roll-up the connectors don't move (no single direction is true);
  // their thickness follows the larger of the two directions instead.
  const gridLine = gross ? lineFor(Math.max(gross.gridImportW, gross.gridExportW), 1) : lineFor(gridW, 1);
  const batteryLine = gross ? lineFor(Math.max(gross.batteryChargeW, gross.batteryDischargeW), 1) : lineFor(batteryW, -1);

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
    battery: gross ? gross.batteryDischargeW : Math.max(-(batteryW ?? 0), 0),
    grid: hasGridMeter ? (gross ? gross.gridImportW : Math.max(gridW ?? 0, 0)) : 0,
  };
  const sourceTotal = sources.solar + sources.battery + sources.grid;
  const showMix = hasGridMeter && loadW !== null && sourceTotal >= DEADBAND_W;
  const share = {
    solar: showMix ? sources.solar / sourceTotal : 0,
    battery: showMix ? sources.battery / sourceTotal : 0,
    grid: showMix ? sources.grid / sourceTotal : 0,
  };
  const pct = (f: number) => Math.round(f * 100);
  const mixSegments = [
    { key: 'solar', fraction: share.solar, color: 'var(--signal)' },
    { key: 'battery', fraction: share.battery, color: 'var(--good)' },
    { key: 'grid', fraction: share.grid, color: 'var(--victron-glow)' },
  ] as const;
  const activeSegments = mixSegments.filter((segment) => segment.fraction > 0);
  const labelPlacements: { key: string; fraction: number; color: string; angle: number }[] = [];
  let labelCursor = 0;
  for (const segment of activeSegments) {
    const midpoint = labelCursor + segment.fraction / 2;
    labelCursor += segment.fraction;
    if (segment.fraction < MIX_LABEL_MIN_SHARE) continue;
    let angle = nudgeLabelAngle(midpoint * 360);
    const previous = labelPlacements[labelPlacements.length - 1];
    if (previous && angle - previous.angle < MIX_LABEL_MIN_GAP_DEG) angle = previous.angle + MIX_LABEL_MIN_GAP_DEG;
    labelPlacements.push({ key: segment.key, fraction: segment.fraction, color: segment.color, angle });
  }
  let mixOffset = 0;

  const soc = socPct === null ? null : Math.min(Math.max(socPct, 0), 100);

  const diagram = (
    <div className={styles.flow}>
      <svg className={styles.lines} viewBox="0 0 400 420" preserveAspectRatio="none" aria-hidden="true">
        {gross && (
          <defs>
            {(['solar', 'battery', 'grid'] as const).map((name) => (
              <marker key={name} id={`flow-arrow-${name}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M 1 1 L 9 5 L 1 9 Z" className={styles[`arrow_${name}`]} />
              </marker>
            ))}
          </defs>
        )}
        <path
          className={`${lineClass(solarLine, Boolean(gross))} ${styles.solarHome}`}
          style={solarLine.style}
          d={`M 75 40 Q 180 55 195 ${homeEndY}`}
          markerEnd={gross && !solarLine.idle ? 'url(#flow-arrow-solar)' : undefined}
        />
        {/* Ends at 248, not the home node's exact text-bottom (110 + 82 ring +
           name + amt = 236) — that left zero clearance, so the dashed line's
           own start dot sat right on top of the amount text. */}
        <path
          className={`${lineClass(batteryLine, Boolean(gross))} ${styles.batteryHome}`}
          style={batteryLine.style}
          d="M 200 276 Q 200 262 200 248"
          // Drawn battery -> home: discharging points at home (end), charging at the battery (start).
          markerEnd={gross && gross.batteryDischargeW > DEADBAND_W ? 'url(#flow-arrow-battery)' : undefined}
          markerStart={gross && gross.batteryChargeW > DEADBAND_W ? 'url(#flow-arrow-battery)' : undefined}
        />
        {hasGridMeter && (
          <path
            className={`${lineClass(gridLine, Boolean(gross))} ${styles.gridHome}`}
            style={gridLine.style}
            d={`M 325 40 Q 220 55 205 ${homeEndY}`}
            // Drawn grid -> home: importing points at home (end), exporting at the grid (start).
            markerEnd={gross && gross.gridImportW > DEADBAND_W ? 'url(#flow-arrow-grid)' : undefined}
            markerStart={gross && gross.gridExportW > DEADBAND_W ? 'url(#flow-arrow-grid)' : undefined}
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
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="var(--victron-glow)" strokeWidth={1.8}>
            <path d="M6 21V10l6-6 6 6v11M9 21v-6h6v6" />
          </svg>
        </div>
        <div className={styles.name}>{t(lang, 'flow_diagram_grid')}</div>
        {gross && hasGridMeter ? (
          <GrossRows
            lang={lang}
            rows={[
              { arrow: '↓', w: gross.gridImportW, sites: gross.gridImportSites, labelKey: 'flow_fleet_imported' },
              { arrow: '↑', w: gross.gridExportW, sites: gross.gridExportSites, labelKey: 'flow_fleet_exported' },
            ]}
            netW={gridW}
          />
        ) : (
          <>
            <div className={styles.amt} style={!hasGridMeter ? { color: 'var(--mute)' } : undefined}>
              {hasGridMeter ? formatW(gridW) : t(lang, 'flow_diagram_no_reading')}
            </div>
            {gridState && <div className={styles.state}>{gridState}</div>}
          </>
        )}
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
              {activeSegments.map((segment) => {
                // A hairline gap between segments, only when there is more
                // than one — a lone 100% segment is just a full ring.
                const gap = activeSegments.length > 1 ? 2 : 0;
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
          {showMix &&
            labelPlacements.map((label) => {
              const radians = (label.angle * Math.PI) / 180;
              const sin = Math.sin(radians);
              const cos = Math.cos(radians);
              // Ring radius (41) + a gap, plus however much of the label's own
              // half-width/half-height sticks out along this direction — in
              // design units, scaled by --u like everything else.
              const radius = 41 + 5 + Math.abs(sin) * 13 + Math.abs(cos) * 6;
              return (
                <span
                  key={label.key}
                  className={styles.mixLabel}
                  style={{ color: label.color, left: `calc(50% + ${(radius * sin).toFixed(1)} * var(--u))`, top: `calc(50% + ${(-radius * cos).toFixed(1)} * var(--u))` }}
                >
                  {pct(label.fraction)}%
                </span>
              );
            })}
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="var(--paper)" strokeWidth={1.6}>
            <path d="M3 11l9-7 9 7" />
            <path d="M5 10v10h14V10" />
          </svg>
        </div>
        <div className={styles.name}>{loadLabel}</div>
        <div className={styles.amt}>{formatW(loadW)}</div>
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
          {batteryNote && !gross ? `, ${batteryNote}` : ''}
        </div>
        {gross ? (
          <GrossRows
            lang={lang}
            rows={[
              { arrow: '↓', w: gross.batteryChargeW, sites: gross.batteryChargeSites, labelKey: 'flow_fleet_charging' },
              { arrow: '↑', w: gross.batteryDischargeW, sites: gross.batteryDischargeSites, labelKey: 'flow_fleet_discharging' },
            ]}
            netW={batteryW}
          />
        ) : (
          <>
            <div className={styles.amt}>{batteryAmt}</div>
            {batteryState && <div className={styles.state}>{batteryState}</div>}
          </>
        )}
      </div>
    </div>
  );

  // The frame is the size container `--u` is measured against (see the CSS).
  return <div className={styles.frame}>{diagram}</div>;
}

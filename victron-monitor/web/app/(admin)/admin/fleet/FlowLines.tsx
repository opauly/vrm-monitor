'use client';

// The connectors of the energy-flow diagram (see FlowDiagram.tsx). A Client
// Component only because the line ends depend on the frame's real width: it
// measures the frame and draws in px, so every line starts and ends exactly on
// its ring's edge and every arrowhead sits centred on its line. The geometry
// itself is lib/flowGeometry.ts.
import { useEffect, useRef, useState } from 'react';
import {
  DESIGN_H,
  DESIGN_W,
  arrowPoints,
  batteryConnector,
  curvedConnector,
  layoutFor,
  sideCurve,
  unitFor,
} from '@/lib/flowGeometry';
import styles from './flow-diagram.module.css';

export type FlowLineSpec = {
  idle: boolean;
  reverse: boolean;
  /** Animation duration / stroke width, set from the size of the reading. */
  dur?: string;
  w?: string;
  /** An arrowhead at the start / end of the path as drawn (fleet roll-up only). */
  arrowStart?: boolean;
  arrowEnd?: boolean;
};

type Colour = 'solar' | 'battery' | 'grid';

export function FlowLines({
  solar,
  battery,
  grid,
  still,
}: {
  solar: FlowLineSpec;
  battery: FlowLineSpec;
  /** `null` when the site has no grid meter, so there is no grid connector. */
  grid: FlowLineSpec | null;
  /** Fleet roll-up: solid lines instead of the flowing dashes. */
  still: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(DESIGN_W);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const measure = () => {
      const w = svg.getBoundingClientRect().width;
      if (w > 0) setWidth((previous) => (Math.abs(previous - w) < 0.25 ? previous : w));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const layout = layoutFor(width);
  const { u } = layout;

  const lines: { key: Colour; spec: FlowLineSpec; d: string; arrows: ReturnType<typeof batteryConnector>['arrows'] }[] = [];

  const solarCurve = sideCurve(layout.solar, layout.home, 'left');
  const solarConnector = curvedConnector(solarCurve, layout.solar, layout.home, { start: Boolean(solar.arrowStart), end: Boolean(solar.arrowEnd) }, u);
  lines.push({ key: 'solar', spec: solar, ...solarConnector });

  const batteryLine = batteryConnector(layout, { start: Boolean(battery.arrowStart), end: Boolean(battery.arrowEnd) });
  lines.push({ key: 'battery', spec: battery, ...batteryLine });

  if (grid) {
    const gridCurve = sideCurve(layout.grid, layout.home, 'right');
    const gridConnector = curvedConnector(gridCurve, layout.grid, layout.home, { start: Boolean(grid.arrowStart), end: Boolean(grid.arrowEnd) }, u);
    lines.push({ key: 'grid', spec: grid, ...gridConnector });
  }

  const pathClass = (key: Colour, spec: FlowLineSpec) =>
    [styles.path, spec.idle ? styles.idle : '', spec.reverse ? styles.reverse : '', still ? styles.still : '', styles[`line_${key}`]].filter(Boolean).join(' ');

  return (
    <svg
      ref={ref}
      className={styles.lines}
      viewBox={`0 0 ${width.toFixed(2)} ${(DESIGN_H * unitFor(width)).toFixed(2)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {lines.map(({ key, spec, d }) => (
        <path
          key={key}
          className={pathClass(key, spec)}
          style={spec.dur ? ({ ['--dur' as string]: spec.dur, ['--w' as string]: spec.w } as React.CSSProperties) : undefined}
          d={d}
        />
      ))}
      {/* Arrowheads last, so they sit on top of every line. */}
      {lines.map(({ key, arrows }) =>
        arrows.map((arrow, index) => <polygon key={`${key}-${index}`} className={styles[`arrow_${key}`]} points={arrowPoints(arrow)} />),
      )}
    </svg>
  );
}

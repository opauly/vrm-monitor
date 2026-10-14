// Geometry of the energy-flow diagram's connectors, in real pixels.
//
// The nodes are HTML boxes placed in design units (`--u`, see
// flow-diagram.module.css): solar and grid pinned to the frame's left/right
// edges, home and battery centred. The connectors used to be one SVG drawn in a
// fixed 400-unit viewBox and stretched to the frame, so on any frame that wasn't
// exactly that wide the line ends drifted off the rings. Here every ring centre
// is computed from the frame's measured width with the same rules the CSS uses,
// so a connector starts and ends exactly on its ring's edge at any width.

export const DESIGN_W = 420;
export const DESIGN_H = 420;

export type Pt = { x: number; y: number };
export type Ring = { c: Pt; r: number };

/** The size of one design unit in px — same clamp as `--u` in the CSS. */
export function unitFor(width: number): number {
  return Math.min(Math.max(width / DESIGN_W, 1), 1.15);
}

export type FlowLayout = {
  u: number;
  width: number;
  height: number;
  solar: Ring;
  grid: Ring;
  home: Ring;
  battery: Ring;
  /** Straight connector between the home node's text and the battery ring. */
  batteryLine: { x: number; top: number; bottom: number };
};

export function layoutFor(width: number): FlowLayout {
  const u = unitFor(width);
  return {
    u,
    width,
    height: DESIGN_H * u,
    solar: { c: { x: 54 * u, y: 36 * u }, r: 32 * u },
    grid: { c: { x: width - 54 * u, y: 36 * u }, r: 32 * u },
    home: { c: { x: width / 2, y: 151 * u }, r: 41 * u },
    battery: { c: { x: width / 2, y: 308 * u }, r: 32 * u },
    batteryLine: { x: width / 2, top: 248 * u, bottom: 276 * u },
  };
}

export type Quad = { s: Pt; c: Pt; e: Pt };

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function pointAt(q: Quad, t: number): Pt {
  return lerp(lerp(q.s, q.c, t), lerp(q.c, q.e, t), t);
}

/** Unit direction of travel at `t`. */
export function directionAt(q: Quad, t: number): Pt {
  const dx = 2 * ((1 - t) * (q.c.x - q.s.x) + t * (q.e.x - q.c.x));
  const dy = 2 * ((1 - t) * (q.c.y - q.s.y) + t * (q.e.y - q.c.y));
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** The part of a quadratic between `t0` and `t1`, as its own quadratic. */
export function slice(q: Quad, t0: number, t1: number): Quad {
  const a = pointAt(q, t0);
  const b = pointAt(q, t1);
  const k = t1 - t0;
  const dx = (1 - t0) * (q.c.x - q.s.x) + t0 * (q.e.x - q.c.x);
  const dy = (1 - t0) * (q.c.y - q.s.y) + t0 * (q.e.y - q.c.y);
  return { s: a, c: { x: a.x + k * dx, y: a.y + k * dy }, e: b };
}

const STEPS = 400;

/** First `t` at which the curve is at least `radius` from `centre` (leaving a ring). */
export function leaveT(q: Quad, centre: Pt, radius: number): number {
  for (let i = 0; i <= STEPS; i += 1) {
    const t = i / STEPS;
    if (dist(pointAt(q, t), centre) >= radius) return t;
  }
  return 0;
}

/** Last `t` at which the curve is still at least `radius` from `centre` (reaching a ring). */
export function reachT(q: Quad, centre: Pt, radius: number): number {
  for (let i = STEPS; i >= 0; i -= 1) {
    const t = i / STEPS;
    if (dist(pointAt(q, t), centre) >= radius) return t;
  }
  return 1;
}

/** Where on the home ring the solar / grid connectors arrive, in degrees off
 * the vertical. Small enough to read as "coming in from above", and clear of the
 * supply-mix percentages, which are kept at least 35 degrees away from the top. */
const HOME_ENTRY_DEG = 16;

/** A connector from a side ring's centre to the home ring, ending on a radius of
 * the home ring and arriving along it. Drawn from `from` toward home. */
export function sideCurve(from: Ring, home: Ring, side: 'left' | 'right'): Quad {
  const a = (HOME_ENTRY_DEG * Math.PI) / 180;
  const sign = side === 'left' ? -1 : 1;
  const e: Pt = { x: home.c.x + sign * home.r * Math.sin(a), y: home.c.y - home.r * Math.cos(a) };
  // Arrive heading inward along the radius (down and toward the middle).
  const inward: Pt = { x: -sign * Math.sin(a), y: Math.cos(a) };
  const m = 0.5 * dist(from.c, e);
  return { s: from.c, c: { x: e.x - inward.x * m, y: e.y - inward.y * m }, e };
}

export type Arrow = { tip: Pt; left: Pt; right: Pt };

/** An arrowhead whose tip is `tip` and which points along `dir`, centred on the line. */
export function arrowAt(tip: Pt, dir: Pt, length: number, halfWidth: number): Arrow {
  const base = { x: tip.x - dir.x * length, y: tip.y - dir.y * length };
  const nx = -dir.y;
  const ny = dir.x;
  return {
    tip,
    left: { x: base.x + nx * halfWidth, y: base.y + ny * halfWidth },
    right: { x: base.x - nx * halfWidth, y: base.y - ny * halfWidth },
  };
}

export type Connector = { d: string; arrows: Arrow[] };

const f = (n: number) => n.toFixed(2);
const quadPath = (q: Quad) => `M ${f(q.s.x)} ${f(q.s.y)} Q ${f(q.c.x)} ${f(q.c.y)} ${f(q.e.x)} ${f(q.e.y)}`;

export type ArrowSpec = { start: boolean; end: boolean };

/** A curved connector between two rings: trimmed to their edges, and — where an
 * arrowhead is wanted — shortened so the line stops at the head's base. */
export function curvedConnector(q: Quad, from: Ring, to: Ring, arrows: ArrowSpec, u: number): Connector {
  const length = 9 * u;
  const halfWidth = 4.8 * u;
  const touch = 1 * u;
  const lineFrom = leaveT(q, from.c, from.r + (arrows.start ? touch + length - 1 * u : 0));
  const lineTo = reachT(q, to.c, to.r + (arrows.end ? touch + length - 1 * u : 0));
  const heads: Arrow[] = [];
  if (arrows.start) {
    const t = leaveT(q, from.c, from.r + touch);
    const d = directionAt(q, t);
    heads.push(arrowAt(pointAt(q, t), { x: -d.x, y: -d.y }, length, halfWidth));
  }
  if (arrows.end) {
    const t = reachT(q, to.c, to.r + touch);
    heads.push(arrowAt(pointAt(q, t), directionAt(q, t), length, halfWidth));
  }
  return { d: quadPath(slice(q, lineFrom, Math.max(lineTo, lineFrom))), arrows: heads };
}

/** The short vertical connector between the home node and the battery ring.
 * Drawn battery -> home: `end` is the home side (discharging), `start` the battery. */
export function batteryConnector(layout: FlowLayout, arrows: ArrowSpec): Connector {
  const { x, top, bottom } = layout.batteryLine;
  const u = layout.u;
  const length = 9 * u;
  const halfWidth = 4.8 * u;
  const heads: Arrow[] = [];
  let from = bottom;
  let to = top;
  if (arrows.start) {
    heads.push(arrowAt({ x, y: bottom - 1 * u }, { x: 0, y: 1 }, length, halfWidth));
    from = bottom - 1 * u - length + 1 * u;
  }
  if (arrows.end) {
    heads.push(arrowAt({ x, y: top }, { x: 0, y: -1 }, length, halfWidth));
    to = top + length - 1 * u;
  }
  const mid = (from + to) / 2;
  return { d: `M ${f(x)} ${f(from)} Q ${f(x)} ${f(mid)} ${f(x)} ${f(to)}`, arrows: heads };
}

export function arrowPoints(a: Arrow): string {
  return `${f(a.tip.x)},${f(a.tip.y)} ${f(a.left.x)},${f(a.left.y)} ${f(a.right.x)},${f(a.right.y)}`;
}

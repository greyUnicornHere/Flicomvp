// Arrow routing: smooth curves normally; a detour around steps only when the curve would cross one.

export type Point = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };

const CLEARANCE = 18; // space kept between a detour and any step
const OUT = 30; // how far an arrow leaves its step before turning

export function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** Control points of the standard left-to-right curve. */
export function curvePoints(source: Point, target: Point): [Point, Point, Point, Point] {
  const dx = Math.max(Math.abs(target.x - source.x) / 2, 48);
  return [source, { x: source.x + dx, y: source.y }, { x: target.x - dx, y: target.y }, target];
}

const inside = (p: Point, b: Box, margin: number) =>
  p.x > b.left - margin && p.x < b.right + margin && p.y > b.top - margin && p.y < b.bottom + margin;

/** Does the standard curve pass over any of these steps? */
export function curveCrosses(source: Point, target: Point, boxes: Box[]): boolean {
  const [p0, p1, p2, p3] = curvePoints(source, target);
  const near = boxes.filter(
    (b) => b.right > Math.min(source.x, target.x) && b.left < Math.max(source.x, target.x) + 48,
  );
  for (let t = 0.04; t < 0.97; t += 0.03) {
    const p = cubic(p0, p1, p2, p3, t);
    if (near.some((b) => inside(p, b, 6))) return true;
  }
  return false;
}

const segmentClear = (x: number, y1: number, y2: number, boxes: Box[]) =>
  !boxes.some((b) => x > b.left - CLEARANCE / 2 && x < b.right + CLEARANCE / 2 && Math.max(y1, y2) > b.top - CLEARANCE / 2 && Math.min(y1, y2) < b.bottom + CLEARANCE / 2);

export type Detour = { out: number; back: number; lane: number };

/**
 * A route around the steps in the way: leave the source, turn into the nearest clear horizontal
 * lane, run along it, and come back in to the target from the left. Null when no detour applies
 * (e.g. the target is not to the right of the source).
 */
export function detour(source: Point, target: Point, boxes: Box[]): Detour | null {
  const out = source.x + OUT;
  const back = target.x - OUT;
  if (back < out + 24) return null;
  const band = boxes.filter((b) => b.right > out && b.left < back);
  const blocked = band.map((b) => [b.top - CLEARANCE, b.bottom + CLEARANCE] as const);
  const free = (y: number) => !blocked.some(([top, bottom]) => y > top && y < bottom);
  const middle = (source.y + target.y) / 2;
  const candidates = [middle, source.y, target.y, ...blocked.flat()].filter(free);
  const cost = (y: number) => Math.abs(y - source.y) + Math.abs(y - target.y);
  const ranked = [...new Set(candidates)].sort((a, b) => cost(a) - cost(b) || Math.abs(a - middle) - Math.abs(b - middle));
  const clean = ranked.find((y) => segmentClear(out, source.y, y, boxes) && segmentClear(back, y, target.y, boxes));
  const lane = clean ?? ranked[0];
  return lane === undefined ? null : { out, back, lane };
}

/** Polyline with rounded corners, for detours and repeat connections. */
export function roundedPath(points: Point[], radius = 18): string {
  const parts = [`M ${points[0]!.x},${points[0]!.y}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const corner = points[i]!;
    const next = points[i + 1]!;
    const r = Math.min(radius, dist(prev, corner) / 2, dist(corner, next) / 2);
    const a = towards(corner, prev, r);
    const b = towards(corner, next, r);
    parts.push(`L ${a.x},${a.y}`, `Q ${corner.x},${corner.y} ${b.x},${b.y}`);
  }
  const last = points[points.length - 1]!;
  parts.push(`L ${last.x},${last.y}`);
  return parts.join(' ');
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function towards(from: Point, to: Point, length: number): Point {
  const d = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) / d) * length, y: from.y + ((to.y - from.y) / d) * length };
}

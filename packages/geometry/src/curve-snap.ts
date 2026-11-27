import type { Point, Vector } from '@splash/document';
import { matrix, mapPoint } from './affine';
import { boundsIndex, type Bounds } from './bounds-index';
import { splitCubic, type Cubic } from './curve-fit';
import { cubicCrossings } from './cubic-crossings';
import { pathCommands } from './drawing';

const numericMargin = 64 * Number.EPSILON;
const finitePoint = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function bernsteinValue(values: number[], t: number): number {
  const row = [...values];
  for (let size = row.length - 1; size > 0; size--)
    for (let i = 0; i < size; i++) row[i] = mix(row[i], row[i + 1], t);
  return row[0];
}

/** Sign-changing interior roots, bracketed between resolved stationary values. */
function regularRoots(values: number[]): number[] {
  if (values.every(v => v > numericMargin) || values.every(v => v < -numericMargin) ||
      values.every(v => Math.abs(v) <= numericMargin)) return [];
  if (values.length === 2) {
    const root = values[0] / (values[0] - values[1]);
    return root > 0 && root < 1 ? [root] : [];
  }
  const cuts = [0, ...regularRoots(values.slice(1).map((v, i) => v - values[i])), 1];
  const roots: number[] = [];
  for (let i = 1; i < cuts.length; i++) {
    let low = cuts[i - 1], high = cuts[i];
    const start = bernsteinValue(values, low), end = bernsteinValue(values, high);
    if (Math.abs(start) <= numericMargin || Math.abs(end) <= numericMargin || Math.sign(start) === Math.sign(end)) continue;
    for (let step = 0; step < 52; step++) {
      const mid = (low + high) / 2;
      if (Math.sign(bernsteinValue(values, mid)) === Math.sign(start)) low = mid;
      else high = mid;
    }
    roots.push((low + high) / 2);
  }
  return roots;
}

/** A regular contact has (B(t) - anchor) × B'(t) = 0 and a resolved direction. */
export function cubicTangencies(anchor: Point, curve: Cubic): Point[] {
  if (![anchor, ...curve].every(finitePoint)) return [];
  const relative = curve.map(p => ({ x: p.x - anchor.x, y: p.y - anchor.y })) as Cubic;
  const scale = Math.max(...relative.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))));
  if (!(scale > 0 && Number.isFinite(scale))) return [];
  const controls = relative.map(p => ({ x: p.x / scale, y: p.y / scale })) as Cubic;
  const velocity = controls.slice(1).map((p, i) => ({ x: p.x - controls[i].x, y: p.y - controls[i].y }));
  const cross = (p: Point, q: Point) => p.x * q.y - p.y * q.x;
  const cubicWeights = [1, 3, 3, 1], quadraticWeights = [1, 2, 1], productWeights = [1, 5, 10, 10, 5, 1];
  const equation = productWeights.map(() => 0);
  for (const [i, p] of controls.entries()) for (const [j, d] of velocity.entries()) {
    equation[i + j] += cubicWeights[i] * quadraticWeights[j] / productWeights[i + j] * cross(p, d);
  }
  return regularRoots(equation).flatMap(t => {
    const { x, y } = splitCubic(controls, t)[0][3];
    const speed = { x: bernsteinValue(velocity.map(p => p.x), t), y: bernsteinValue(velocity.map(p => p.y), t) };
    const magnitude = Math.hypot(x, y) * Math.hypot(speed.x, speed.y);
    const point = { x: anchor.x + x * scale, y: anchor.y + y * scale };
    return magnitude > numericMargin && Math.abs(cross({ x, y }, speed)) <= numericMargin * magnitude &&
      finitePoint(point) && (point.x !== anchor.x || point.y !== anchor.y)
      ? [point] : [];
  });
}

/** Actual transverse crossings of a finite line with a cubic, in document coordinates. */
export function lineCubicCrossings(start: Point, end: Point, curve: Cubic): Point[] {
  return lineCubicHits(start, end, curve, false).map(hit => hit.point);
}

/** Cutting needs the original curve parameters, including boundary contacts. */
export function lineCubicCutTimes(start: Point, end: Point, curve: Cubic): number[] {
  return lineCubicHits(start, end, curve, true).map(hit => hit.t);
}
function lineCubicHits(start: Point, end: Point, curve: Cubic, contacts: boolean) {
  if (![start, end, ...curve].every(finitePoint)) return [];
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
  if (!(length > 0 && Number.isFinite(length))) return [];
  const ux = dx / length, uy = dy / length;
  const relative = curve.map(p => ({ x: p.x - start.x, y: p.y - start.y })) as Cubic;
  const scale = Math.max(length, ...relative.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))));
  if (!Number.isFinite(scale)) return [];
  const [a, b, c, d] = relative.map(p => ux * (p.y / scale) - uy * (p.x / scale));
  const value = (t: number) => {
    const u = 1 - t;
    return u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d;
  };
  // Split the signed-distance cubic into its monotone intervals at derivative roots.
  const v = b - a, w = c - b, z = d - c;
  const A = v - 2 * w + z, B = 2 * (w - v), C = v;
  const disc = B * B - 4 * A * C;
  const critical: number[] = [];
  if (!A) {
    if (B) critical.push(-C / B);
  } else if (disc >= 0) {
    const q = -(B + (B < 0 ? -1 : 1) * Math.sqrt(disc)) / 2;
    if (q) critical.push(q / A, C / q);
    else critical.push(-B / (2 * A));
  }
  const cuts = [0, ...critical.filter(t => t > 0 && t < 1).sort((x, y) => x - y), 1];
  const crossings: { point: Point; t: number }[] = [];
  const add = (t: number) => {
    const p = splitCubic(relative, t)[0][3];
    const along = p.x * ux + p.y * uy;
    const point = { x: start.x + p.x, y: start.y + p.y };
    const margin = contacts ? numericMargin * scale : 0;
    if (along >= -margin && along <= length + margin && finitePoint(point)) crossings.push({ point, t });
  };
  if (contacts)
    for (const t of cuts) if (Math.abs(value(t)) <= numericMargin) add(t);
  for (let i = 1; i < cuts.length; i++) {
    let low = cuts[i - 1], high = cuts[i];
    const before = value(low), after = value(high);
    if (Math.abs(before) <= numericMargin || Math.abs(after) <= numericMargin ||
        Math.sign(before) === Math.sign(after)) continue;
    for (let step = 0; step < 52; step++) {
      const middle = (low + high) / 2;
      if (Math.sign(value(middle)) === Math.sign(before)) low = middle;
      else high = middle;
    }
    add((low + high) / 2);
  }
  return crossings;
}

const bounds = (points: Point[]): Bounds => ({
  left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
  top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
});

/** Capture authored centerlines and boundaries once per source. Only nearby
 * pairs are tested at pickup. Exhausted searches leave ordinary snapping usable. */
export function indexCurveSnapTargets(shapes: readonly Vector[]) {
  const lines: [Point, Point][] = [], curves: Cubic[] = [];
  for (const shape of shapes) {
    const filled = shape.fillEnabled !== false && (shape.closed || ['rectangle', 'ellipse', 'polygon'].includes(shape.kind));
    if (['brush', 'text', 'symbol'].includes(shape.kind) || shape.opacity === 0 ||
        (!shape.strokeWidth && !filled)) continue;
    const basis = matrix(shape);
    const world = (x: number, y: number) => mapPoint(basis, { x, y });
    let first: Point | undefined, current: Point | undefined;
    for (const command of pathCommands(shape)) {
      if (command[0] === 'M') {
        current = first = world(command[1], command[2]);
      } else if (current) {
        if (command[0] === 'C') {
          const end = world(command[5], command[6]);
          const span: Cubic = [current, world(command[1], command[2]), world(command[3], command[4]), end];
          if (span.every(finitePoint)) curves.push(span);
          current = end;
        } else {
          const end = command[0] === 'Z' ? first! : world(command[1], command[2]);
          if (finitePoint(current) && finitePoint(end) && (current.x !== end.x || current.y !== end.y))
            lines.push([current, end]);
          current = end;
        }
      }
    }
  }
  const curveBoxes = curves.map(bounds), lineBoxes = lines.map(bounds);
  const lineIndex = boundsIndex(lineBoxes), curveIndex = boundsIndex(curveBoxes);
  let tangentAnchor: Point | undefined;
  const tangentCache = new Map<number, Point[]>();
  const crossingCache = new Map<string, Point[] | number>();
  return (point: Point, radius: number, anchor?: Point): { kind: 'crossing' | 'tangent'; point: Point } | undefined => {
    if (!finitePoint(point) || !(radius > 0 && Number.isFinite(radius))) return;
    const target = bounds([point]);
    const localCurves = curveIndex(target, radius);
    if (!localCurves.length) return;
    const localLines = lineIndex(target, radius);
    const pairCount = localLines.length * localCurves.length;
    if (pairCount > 4096) return;
    let hit: Point | undefined, distance = radius;
    const consider = (candidate: Point): Point | undefined => {
      const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (d < distance || (d === distance && (!hit || candidate.x < hit.x ||
          (candidate.x === hit.x && candidate.y < hit.y)))) {
        distance = d;
        return candidate;
      }
      return hit;
    };
    for (const i of localLines) for (const j of localCurves)
      for (const candidate of lineCubicCrossings(...lines[i], curves[j])) hit = consider(candidate);
    const lineHit = hit, lineDistance = distance, budget = { remaining: 4096 - pairCount };
    if (localCurves.length * (localCurves.length - 1) / 2 <= budget.remaining) {
      search: for (let i = 0; i < localCurves.length; i++) for (let j = i + 1; j < localCurves.length; j++) {
        const left = Math.min(localCurves[i], localCurves[j]), right = Math.max(localCurves[i], localCurves[j]);
        const key = `${left}:${right}`;
        let targets = crossingCache.get(key);
        const available = --budget.remaining;
        if (available >= 0 && (targets === undefined || (typeof targets === 'number' && available > targets))) {
          targets = cubicCrossings(curves[left], curves[right], budget) ?? available;
          if (crossingCache.size >= 4096) crossingCache.clear();
          crossingCache.set(key, targets);
        }
        if (available < 0 || typeof targets === 'number' || targets === undefined) {
          // An incomplete cubic search can't displace already resolved line snaps.
          hit = lineHit;
          distance = lineDistance;
          break search;
        }
        for (const candidate of targets) hit = consider(candidate);
      }
    }
    if (hit) return { kind: 'crossing', point: { ...hit } };
    if (!anchor || !finitePoint(anchor) || pairCount + localCurves.length > 4096) return;
    if (tangentAnchor?.x !== anchor.x || tangentAnchor?.y !== anchor.y) {
      tangentAnchor = { x: anchor.x, y: anchor.y };
      tangentCache.clear();
    }
    for (const j of localCurves) {
      let targets = tangentCache.get(j);
      if (!targets) {
        targets = cubicTangencies(tangentAnchor, curves[j]);
        tangentCache.set(j, targets);
      }
      for (const candidate of targets) hit = consider(candidate);
    }
    if (hit) return { kind: 'tangent', point: { ...hit } };
  };
}

import type { Vector } from '@splash/document';
import { matrix, mapPoint } from './affine';
import { localAuthoringBounds } from './authoring-box';
export { localAuthoringBounds } from './authoring-box';
export type Bounds = { left: number; top: number; right: number; bottom: number };
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export function authoringCorners(s: Vector) {
  const m = matrix(s);
  const { left, right, top, bottom } = localAuthoringBounds(s);
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ].map(([x, y]) => mapPoint(m, { x, y }));
}

/** Axis-aligned bounds of the rotated authoring box; excludes stroke overhang. */
export function objectBounds(s: Vector): Bounds {
  const points = authoringCorners(s);
  return {
    left: Math.min(...points.map((p) => p.x)),
    right: Math.max(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)),
    bottom: Math.max(...points.map((p) => p.y)),
  };
}
function layoutUnits(shapes: Vector[], depth: number) {
  const units = new Map<string, Vector[]>();
  for (const s of shapes) {
    const key = s.groups?.[depth] ?? s.id;
    if (!units.has(key)) units.set(key, []);
    units.get(key)!.push(s);
  }
  return [...units.values()].map((members) => ({
    members,
    bounds: unionBounds(members.map(objectBounds)),
  }));
}
function unionBounds(boxes: Bounds[]): Bounds {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}
export function alignVectors(shapes: Vector[], alignment: Alignment, stage?: Bounds, depth = 0) {
  if (!shapes.length) return;
  const units = layoutUnits(shapes, depth);
  const target = stage ?? unionBounds(units.map((u) => u.bounds));
  const coordinate = (b: Bounds) =>
    alignment === 'center'
      ? (b.left + b.right) / 2
      : alignment === 'middle'
        ? (b.top + b.bottom) / 2
        : b[alignment];
  const axis = ['left', 'center', 'right'].includes(alignment) ? 'x' : 'y';
  for (const u of units) {
    const delta = coordinate(target) - coordinate(u.bounds);
    for (const s of u.members) s[axis] += delta;
  }
}
/** Equal unit center spacing, keeping the outermost centers fixed. */
export function distributeVectors(shapes: Vector[], axis: 'x' | 'y', depth = 0) {
  const entries = layoutUnits(shapes, depth)
    .map((u) => ({
      ...u,
      center:
        axis === 'x' ? (u.bounds.left + u.bounds.right) / 2 : (u.bounds.top + u.bounds.bottom) / 2,
    }))
    .sort((a, b) => a.center - b.center);
  if (entries.length < 3) return;
  const start = entries[0].center,
    end = entries.at(-1)!.center;
  entries.forEach((entry, i) => {
    const delta = start + ((end - start) * i) / (entries.length - 1) - entry.center;
    for (const s of entry.members) s[axis] += delta;
  });
}

/** Equal signed gaps between authoring boxes. Groups at depth move as rigid units. */
export function distributeGaps(shapes: Vector[], axis: 'x' | 'y', depth = 0) {
  const units = layoutUnits(shapes, depth);
  if (units.length < 3) return;
  const entries = units
    .map(({ members, bounds }) => ({
      members,
      start: axis === 'x' ? bounds.left : bounds.top,
      end: axis === 'x' ? bounds.right : bounds.bottom,
    }))
    .sort((a, b) => a.start - b.start);
  // Keep the first and last units fixed, including when the available gap is negative.
  const gap =
    (entries.at(-1)!.start -
      entries[0].end -
      entries.slice(1, -1).reduce((sum, e) => sum + e.end - e.start, 0)) /
    (entries.length - 1);
  let cursor = entries[0].end + gap;
  for (const e of entries.slice(1, -1)) {
    const delta = cursor - e.start;
    for (const s of e.members) s[axis] += delta;
    cursor += e.end - e.start + gap;
  }
}

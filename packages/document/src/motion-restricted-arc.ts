import type { Point } from './index';
import { createCubicDistanceCorrespondence } from '../../geometry/src/cubic-distance';
/** Original relative cubic and absolute progress window. The actual half controls
 * remain on its group path; playback must bind them before using this timing. */
export type RestrictedMotionArc = {
  descriptor: {
    version: 1;
    cubic: readonly [Point, Point, Point, Point];
    from: number;
    to: number;
  };
  origin: Point;
};

export function validateRestrictedMotionArc(value: unknown): asserts value is RestrictedMotionArc {
  const record = (value: unknown, fields: readonly string[]) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length ||
      fields.some((k) => !Object.hasOwn(value, k))
    )
      throw Error('Restricted arc timing requires original explicit fields.');
    for (const d of Object.values(Object.getOwnPropertyDescriptors(value)))
      if (!d.enumerable || !('value' in d))
        throw Error('Restricted arc timing requires original data.');
    return value as Record<string, unknown>;
  };
  const point = (value: unknown) => {
    const p = record(value, ['x', 'y']);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
      throw Error('Restricted arc coordinates must be finite.');
    return p;
  };
  const timing = record(value, ['descriptor', 'origin']),
    d = record(timing.descriptor, ['version', 'cubic', 'from', 'to']);
  point(timing.origin);
  if (
    d.version !== 1 ||
    typeof d.from !== 'number' ||
    typeof d.to !== 'number' ||
    !Number.isFinite(d.from) ||
    !Number.isFinite(d.to) ||
    !(d.from >= 0 && d.from < d.to && d.to <= 1)
  )
    throw Error('Restricted arc timing requires a supported increasing original window.');
  const cubic = d.cubic;
  if (
    !Array.isArray(cubic) ||
    Object.getPrototypeOf(cubic) !== Array.prototype ||
    cubic.length !== 4 ||
    Reflect.ownKeys(cubic).some(
      (k) => !['0', '1', '2', '3', 'length'].includes(String(k)) || typeof k !== 'string',
    )
  )
    throw Error('Restricted arc timing requires four dense original controls.');
  for (let i = 0; i < 4; i++) {
    const entry = Object.getOwnPropertyDescriptor(cubic, String(i));
    if (!entry?.enumerable || !('value' in entry))
      throw Error('Restricted arc controls require original data.');
    point(entry.value);
  }
  if (cubic[0].x !== 0 || cubic[0].y !== 0)
    throw Error('Restricted arc controls require an exact zero relative origin.');
}

/** Migration preflight uses descriptors so old schemas cannot lose a forward
 * field to a clone, accessor or legacy normalizer. No authored getter is read. */
export function rejectUnversionedRestrictedArcs(value: unknown): void {
  const pending = [value],
    seen = new Set<object>();
  while (pending.length) {
    const row = pending.pop();
    if (!row || typeof row !== 'object' || seen.has(row)) continue;
    seen.add(row);
    if ('restrictedArc' in row) throw Error('Restricted original arc timing requires schema 57.');
    for (const key of Reflect.ownKeys(row)) {
      const d = Object.getOwnPropertyDescriptor(row, key)!;
      if ('value' in d) pending.push(d.value);
    }
  }
}

/** The document/save boundary must reject stale controls/endpoints even when
 * no animation sampler is requested. Same arithmetic/predicate as the binder. */
export function validateRestrictedMotionArcGeometry(
  timing: RestrictedMotionArc,
  actual: readonly Point[],
): void {
  validateRestrictedMotionArc(timing);
  const d = timing.descriptor,
    map = createCubicDistanceCorrespondence([d.cubic]);
  const first = map.parameter(d.from),
    last = map.parameter(d.to),
    mid = d.from + (d.to - d.from) / 2;
  if (
    !Number.isFinite(last - first) ||
    !(last > first) ||
    !(mid > d.from && mid < d.to) ||
    !(map.parameter(mid) > first && map.parameter(mid) < last)
  )
    throw Error('Restricted arc parameter window is numerically unresolved.');
  const mix = (a: Point, b: Point, t: number): Point => ({
    x: a.x * (1 - t) + b.x * t,
    y: a.y * (1 - t) + b.y * t,
  });
  const blossom = (a: number, b: number, c: number) => {
    const p = mix(d.cubic[0], d.cubic[1], a),
      q = mix(d.cubic[1], d.cubic[2], a),
      r = mix(d.cubic[2], d.cubic[3], a);
    return mix(mix(p, q, b), mix(q, r, b), c);
  };
  const expected = [
    blossom(first, first, first),
    blossom(first, first, last),
    blossom(first, last, last),
    blossom(last, last, last),
  ];
  const same = (a: number, b: number) =>
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= 32 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
  if (
    !same(timing.origin.x, expected[0].x) ||
    !same(timing.origin.y, expected[0].y) ||
    actual.length !== 4 ||
    actual.some(
      (p, i) =>
        !same(p.x, expected[i].x - expected[0].x) || !same(p.y, expected[i].y - expected[0].y),
    )
  )
    throw Error('Restricted arc controls, authored origin or member endpoint changed.');
}

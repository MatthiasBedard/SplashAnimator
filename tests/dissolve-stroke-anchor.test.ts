import { expect, it } from 'vitest';
import type { BezierNode, Point, Vector } from '../packages/document/src';
import { worldPoint } from '../packages/geometry/src';
import { dissolveAnchor } from '../packages/geometry/src/nodes';
import { dissolveStrokeAnchor } from '../packages/geometry/src/dissolve-stroke-anchor';
import { dissolveContourAnchor } from '../packages/geometry/src/simplify-contour-spans';

function stroke(): Vector {
  return {
    id: 'stroke', kind: 'bezier', x: 90000, y: -90000, width: 200, height: 30,
    rotation: 16, transform: [-1, 0.3, 0.2, 1], points: [],
    fill: '#000000', fillEnabled: false, stroke: '#ff0000', strokeWidth: 4,
    nodes: [
      { x: -40, y: 0 },
      { x: 0, y: 0, out: { x: 10, y: 15 } },
      { x: 60, y: 22.625, in: { x: 35, y: 22.625 }, out: { x: 85, y: 22.625 } },
      { x: 120, y: 0, in: { x: 110, y: 15 } },
      { x: 160, y: 0 },
    ],
  };
}

function sample(a: BezierNode, b: BezierNode, t: number): Point {
  const r = 1 - t, controls = [a, a.out ?? a, b.in ?? b, b];
  return controls.reduce((p, v, i) => {
    const w = [r ** 3, 3 * t * r ** 2, 3 * t ** 2 * r, t ** 3][i];
    return { x: p.x + v.x * w, y: p.y + v.y * w };
  }, { x: 0, y: 0 });
}

it('replaces a nonredundant smooth anchor with a bounded curve under a reflected affine map', () => {
  const shape = stroke(), before = structuredClone(shape);
  expect(dissolveAnchor(shape, 2)).toBe(false);
  expect(dissolveStrokeAnchor(shape, 2)).toBe(true);
  expect(shape).toEqual({ ...before, nodes: [
    before.nodes![0], { ...before.nodes![1], out: { x: 20, y: 30 } },
    { ...before.nodes![3], in: { x: 100, y: 30 } }, before.nodes![4],
  ] });
  let error = 0;
  for (let step = 0; step <= 200; step++) {
    const t = step / 200, side = t > 0.5 ? 1 : 0;
    const old = worldPoint(before, sample(before.nodes![1 + side], before.nodes![2 + side], t * 2 - side));
    const next = worldPoint(shape, sample(shape.nodes![1], shape.nodes![2], t));
    error = Math.max(error, Math.hypot(old.x - next.x, old.y - next.y));
  }
  expect(error).toBeGreaterThan(0.1);
  expect(error).toBeLessThan(0.25);
});

it.each(['end', 'corner', 'deviation', 'returned stroke', 'nonfinite'] as const)(
  'rejects an unsafe %s without changing any nodes',
  mode => {
    const shape = stroke();
    const join = shape.nodes![2];
    if (mode === 'corner') join.out!.y++;
    if (mode === 'deviation') { join.y++; join.in!.y++; join.out!.y++; }
    if (mode === 'returned stroke') shape.nodes![4].x = 50;
    if (mode === 'nonfinite') shape.nodes![4].x = Infinity;
    const before = structuredClone(shape);
    expect(dissolveStrokeAnchor(shape, mode === 'end' ? 0 : 2)).toBe(false);
    expect(shape).toEqual(before);
  },
);

it('dissolves a selected compound seam and protects the original other ring and paint', () => {
  const source = stroke(), [a, join, b] = source.nodes!.slice(1, 4);
  const ring = [join, b, { x: 120, y: -80 }, { x: 0, y: -80 }, a];
  const hole = [{ x: 20, y: -60 }, { x: 40, y: -60 }, { x: 40, y: -35 }, { x: 20, y: -35 }];
  delete source.nodes;
  Object.assign(source, { kind: 'polygon', fillEnabled: true, fillRule: 'evenodd', strokeWidth: 0, contours: [hole, ring] });
  const before = structuredClone(source);
  expect(dissolveAnchor(source, 4)).toBe(false);
  const out = dissolveContourAnchor(source, 4);
  expect(out).toEqual({ selected: 7, artwork: { ...before, contours: [hole, [
    { ...b, in: { x: 100, y: 30 } }, ...ring.slice(2, 4), { ...a, out: { x: 20, y: 30 } },
  ]] } });
  expect(source).toEqual(before);
  const closed: Vector = { ...source, kind: 'bezier', closed: true, nodes: ring };
  delete closed.contours;
  expect(dissolveContourAnchor(closed, 0)).toEqual({
    selected: 3, artwork: { ...closed, nodes: out!.artwork.contours![1] },
  });
  const near = structuredClone(source);
  // The join still meets the error bound, but the neighboring ring enters its hull.
  near.contours![0] = [{ x: 20, y: 20 }, { x: 25, y: 20 }, { x: 25, y: 21 }, { x: 20, y: 21 }];
  const protectedSource = structuredClone(near);
  expect(dissolveContourAnchor(near, 4)).toBeUndefined();
  expect(near).toEqual(protectedSource);
});

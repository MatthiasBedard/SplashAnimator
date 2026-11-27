import { expect, it } from 'vitest';
import type { Point, Vector } from '../packages/document/src';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { contains, mergeVectors, vectorPolygons } from '../packages/geometry/src/merge';

// Independent constant-round-nib reference: union of exact segment capsules.
function distance(points: Point[], p: Point) {
  let result = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
      : 0;
    result = Math.min(result, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return result;
}
const stroke = (points: Point[], transformed: boolean, fill = '#224488'): Vector => ({
  id: 'topology',
  kind: 'brush',
  x: 130,
  y: 80,
  width: 100,
  height: 100,
  rotation: transformed ? 23 : 0,
  transform: transformed ? [-1.4, 0.2, 0.35, 0.8] : undefined,
  fill,
  stroke: '#000000',
  strokeWidth: 12,
  brush: { pressure: false, minimum: 0.1, tilt: false, twist: false, aspect: 1, angle: 0 },
  points,
});
const paths = [
  [
    [20, 20],
    [80, 20],
    [80, 80],
    [20, 80],
    [20, 20],
  ],
  [
    [20, 20],
    [80, 80],
    [20, 80],
    [80, 20],
    [20, 20],
  ],
  [
    [20, 20],
    [80, 20],
    [20, 20],
    [20, 80],
    [80, 80],
  ],
].map((points) => points.map(([x, y]) => ({ x, y })));

it('preserves closed holes, crossings and retraced sweeps against an independent capsule oracle', () => {
  let samples = 0;
  for (const points of paths)
    for (const transformed of [false, true])
      for (const reverse of [false, true]) {
        const s = stroke(reverse ? [...points].reverse() : points, transformed),
          before = JSON.stringify(s);
        const direct = vectorPolygons(s),
          merged = mergeVectors([s]).map(shape => vectorPolygons(shape)),
          m = matrix(s);
        for (let y = 8; y <= 92; y += 2)
          for (let x = 8; x <= 92; x += 2) {
            const p = { x: x + 0.37, y: y + 0.19 },
              d = distance(points, p);
            // Exclude a local-unit band wider than the flattening tolerance under these transforms.
            if (Math.abs(d - 6) < 1) continue;
            const q = mapPoint(m, p),
              expected = d < 6;
            expect(contains(direct, q)).toBe(expected);
            expect(merged.some((poly) => contains(poly, q))).toBe(expected);
            samples++;
          }
        expect(JSON.stringify(s)).toBe(before);
      }
  expect(samples).toBeGreaterThan(15000);
});

it('keeps a narrow open gap and topmost paint through sequential affine merges', () => {
  for (const transformed of [false, true]) {
    const bottom = stroke(
      [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
      ],
      transformed,
    );
    const top = stroke(
      [
        { x: 20, y: 32.5 },
        { x: 80, y: 32.5 },
      ],
      transformed,
    );
    top.id = 'parallel';
    let shapes = mergeVectors([bottom, top]);
    const m = matrix(bottom),
      gap = mapPoint(m, { x: 50, y: 26.25 });
    expect(shapes.some((s) => contains(vectorPolygons(s), gap))).toBe(false);
    const bridge = stroke(
      [
        { x: 50, y: 10 },
        { x: 50, y: 45 },
      ],
      transformed,
      '#cc4411',
    );
    bridge.id = 'bridge';
    shapes = mergeVectors([...shapes, bridge]);
    const regions = shapes.map((s) => ({ fill: s.fill, poly: vectorPolygons(s) }));
    for (const p of [
      { x: 50, y: 20 },
      { x: 50, y: 26.25 },
      { x: 50, y: 32.5 },
    ])
      expect(regions.find((r) => contains(r.poly, mapPoint(m, p)))?.fill).toBe('#cc4411');
    expect(regions.find((r) => contains(r.poly, mapPoint(m, { x: 30, y: 20 })))?.fill).toBe(
      '#224488',
    );
    expect(regions.some((r) => contains(r.poly, mapPoint(m, { x: 30, y: 26.25 })))).toBe(false);
  }
});

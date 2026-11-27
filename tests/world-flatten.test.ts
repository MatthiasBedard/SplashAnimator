import { expect, it } from 'vitest';
import type { Point, Vector } from '../packages/document/src';
import { flattenCommands, pathCommands, worldPaths } from '../packages/geometry/src/drawing';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { worldStrokePolygons } from '../packages/geometry/src/strokes';
import { vectorPolygons } from '../packages/geometry/src/merge';
const shape = (): Vector => ({
  id: 'curve',
  kind: 'ellipse',
  x: 37,
  y: 19,
  width: 20,
  height: 10,
  rotation: 27,
  transform: [30, 2, 12, 18],
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
function distance(p: Point, ring: Point[]) {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1],
      b = ring[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      d = dx * dx + dy * dy,
      t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
  }
  return best;
}
it('keeps merged affine cubic outlines within document-space tolerance', () => {
  for (const transform of [
    [30, 2, 12, 18],
    [-30, 2, 12, 18],
    [0.1, 0, 0, 0.1],
  ] as Vector['transform'][]) {
    const s = shape();
    s.transform = transform;
    const before = JSON.stringify(s),
      m = matrix(s),
      ring = worldPaths(s, 0.25)[0];
    const merged = vectorPolygons(s)[0][0].map(([x, y]) => ({ x, y }));
    let start = { x: 0, y: 0 };
    for (const c of pathCommands(s)) {
      if (c[0] === 'M') start = { x: c[1], y: c[2] };
      if (c[0] !== 'C') continue;
      for (let j = 0; j <= 100; j++) {
        const t = j / 100,
          u = 1 - t,
          p = mapPoint(m, {
            x: u ** 3 * start.x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t ** 3 * c[5],
            y: u ** 3 * start.y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t ** 3 * c[6],
          });
        expect(distance(p, ring)).toBeLessThanOrEqual(0.250001);
        expect(distance(p, merged)).toBeLessThanOrEqual(0.250001);
      }
      start = { x: c[5], y: c[6] };
    }
    expect(JSON.stringify(s)).toBe(before);
  }
});
it('allocates curve segments by world size, preserving straight contour holes', () => {
  const s = shape(),
    coarse = flattenCommands(pathCommands(s), 0.25)[0];
  expect(worldPaths(s, 0.25)[0].length).toBeGreaterThan(coarse.length);
  s.transform = [0.1, 0, 0, 0.1];
  expect(worldPaths(s, 0.25)[0].length).toBeLessThan(coarse.length);
  s.kind = 'polygon';
  s.fillRule = 'evenodd';
  s.contours = [
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    [
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 5, y: 10 },
    ],
  ];
  expect(vectorPolygons(s)[0]).toHaveLength(2);
});
it('rejects invalid tolerances and unresolved subdivision instead of accepting coarse curves', () => {
  expect(() => flattenCommands([], 0)).toThrow('Invalid curve tolerance');
  expect(() => flattenCommands([], NaN)).toThrow('Invalid curve tolerance');
  expect(() =>
    flattenCommands(
      [
        ['M', 0, 0],
        ['C', 0, 1, 1, 1, 1, 0],
      ],
      1e-20,
    ),
  ).toThrow('Curve tolerance cannot be met');
});

it('keeps enlarged round stroke caps within the world-space sagitta target', () => {
  const s = shape();
  Object.assign(s, {
    kind: 'line',
    x: 0,
    y: 0,
    rotation: 0,
    transform: [40, 0, 0, 40],
    strokeWidth: 2,
    points: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ],
  });
  const ring = worldStrokePolygons(s)[0][0].map(([x, y]) => ({ x, y }));
  for (let j = 0; j <= 100; j++) {
    const a = Math.PI / 2 + (j * Math.PI) / 100;
    expect(distance({ x: 40 * Math.cos(a), y: 40 * Math.sin(a) }, ring)).toBeLessThanOrEqual(
      0.10001,
    );
  }
});

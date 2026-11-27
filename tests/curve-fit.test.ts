import { expect, it } from 'vitest';
import { fitPolyline, segmentError } from '../packages/geometry/src/curve-fit';
import { pathCommands } from '../packages/geometry/src/drawing';
import type { Vector, Point } from '../packages/document/src';
const distance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    n = dx * dx + dy * dy,
    t = n ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / n)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
it('compacts a closed smooth outline with a conservative error certificate and editable nodes', () => {
  const points = Array.from({ length: 256 }, (_, i) => ({
    x: 100 * Math.cos((i * Math.PI) / 128),
    y: 70 * Math.sin((i * Math.PI) / 128),
  }));
  const before = JSON.stringify(points),
    fit = fitPolyline(points, 0.25, true);
  console.log('Closed ellipse curve fit', {
    input: points.length,
    anchors: fit.nodes.length,
    maxError: fit.maxError,
    work: fit.work,
  });
  expect(fit.nodes.length).toBeLessThan(32);
  expect(fit.maxError).toBeLessThanOrEqual(0.25);
  // Independent dense cubic evaluation against the original polygon perimeter.
  for (const [a, b, c, d] of fit.curves)
    for (let j = 0; j <= 100; j++) {
      const t = j / 100,
        u = 1 - t,
        p = {
          x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
          y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
        };
      expect(
        Math.min(...points.map((a, i) => distance(p, a, points[(i + 1) % points.length]))),
      ).toBeLessThanOrEqual(0.250001);
    }
  const shape: Vector = {
    id: 'fit',
    kind: 'bezier',
    closed: true,
    x: 0,
    y: 0,
    width: 200,
    height: 140,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    nodes: fit.nodes,
  };
  expect(pathCommands(shape).filter((c) => c[0] === 'C')).toHaveLength(fit.curves.length);
  expect(JSON.stringify(points)).toBe(before);
});
it('preserves corners, open endpoints and duplicate/closed input conventions', () => {
  const corners = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const fit = fitPolyline([...corners, corners[0]], 0.25, true);
  expect(fit.nodes.map(({ x, y }) => ({ x, y }))).toEqual(corners);
  const open = fitPolyline(
    [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
    ],
    0.01,
  );
  expect(open.curves).toHaveLength(1);
  expect(open.nodes[0]).toMatchObject({ x: 0, y: 0 });
  expect(open.nodes.at(-1)).toMatchObject({ x: 40, y: 0 });
});
it('does not mistake matching endpoint samples for an accurate curve', () => {
  const a = { x: 0, y: 0 },
    b = { x: 10, y: 0 };
  expect(
    segmentError([a, { x: 0, y: 100 }, { x: 10, y: 100 }, b], a, b, 0, 1),
  ).toBeGreaterThanOrEqual(100);
});
it('honors world-coordinate tolerance and rejects invalid/oversized input', () => {
  const p = Array.from({ length: 80 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 15) * 20 }));
  const small = fitPolyline(p, 0.25),
    large = fitPolyline(
      p.map((p) => ({ x: p.x * 20, y: p.y * 20 })),
      0.25,
    );
  expect(large.nodes.length).toBeGreaterThanOrEqual(small.nodes.length);
  expect(large.maxError).toBeLessThanOrEqual(0.25);
  expect(() => fitPolyline(p, 0)).toThrow();
  expect(() => fitPolyline([{ x: NaN, y: 0 }])).toThrow();
  expect(() => fitPolyline(Array.from({ length: 8193 }, () => ({ x: 0, y: 0 })))).toThrow(
    'Too many',
  );
  expect(() =>
    fitPolyline([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]),
  ).toThrow('Not enough');
});

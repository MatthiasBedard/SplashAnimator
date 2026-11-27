import { expect, it } from 'vitest';
import { clone, newProject, validateProject, type Vector } from '../packages/document/src';
import { commitBrushPaint } from '../packages/geometry/src/brush-commit';
import { restorePaintCurves, restoreWorkerPaintCurves } from '../packages/geometry/src/paint-curves';
import { contains, vectorPolygons, mergeVectors } from '../packages/geometry/src/merge';
import { inversePoint, mapPoint, matrix } from '../packages/geometry/src/affine';
import { worldPaths } from '../packages/geometry/src/drawing';

const count = (shapes: Vector[]) =>
  shapes.reduce(
    (sum, s) => sum + (s.contours?.flat().length ?? s.nodes?.length ?? s.points.length),
    0,
  );
const brush = (i: number): Vector => ({
  id: `ink-${i}`,
  kind: 'brush',
  x: 100 + i * 50,
  y: 100,
  width: 180,
  height: 30,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#ff0000',
  strokeWidth: 14,
  fillEnabled: true,
  brush: { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 },
  points: Array.from({ length: 121 }, (_, k) => ({ x: k * 1.5, y: 25 * Math.sin(k / 45) })),
});
it('preserves fitted curves through successive overlapping optimized Brush merges', () => {
  let shapes: Vector[] = [];
  for (let i = 0; i < 4; i++) {
    const before = clone(shapes),
      ink = brush(i);
    const flattened = commitBrushPaint(shapes, {
      brush: ink,
      amount: 0,
      merge: true,
      mode: 'normal',
      selected: [],
      at: shapes.length,
    });
    const input = shapes;
    shapes = commitBrushPaint(input, {
      brush: ink,
      amount: 0,
      merge: true,
      mode: 'normal',
      selected: [],
      at: shapes.length,
      optimize: true,
    });
    expect(count(shapes)).toBeLessThan(count(flattened) * 0.3);
    expect(shapes.some((s) => s.contours?.some((r) => r.some((n) => n.in || n.out)))).toBe(true);
    expect(input).toEqual(before);
    expect(shapes).toHaveLength(1);
  }
  const p = newProject();
  p.layers[0].keys[0].shapes = shapes;
  validateProject(p);
});

const ring = (radius: number) => {
  const k = radius * 0.5522847498307936;
  return [
    { x: radius, y: 0, in: { x: radius, y: -k }, out: { x: radius, y: k } },
    { x: 0, y: radius, in: { x: k, y: radius }, out: { x: -k, y: radius } },
    { x: -radius, y: 0, in: { x: -radius, y: k }, out: { x: -radius, y: -k } },
    { x: 0, y: -radius, in: { x: -k, y: -radius }, out: { x: k, y: -radius } },
  ];
};
const paint = (): Vector => ({
  ...brush(0),
  id: 'paint',
  kind: 'polygon',
  x: 100,
  y: 100,
  width: 120,
  height: 120,
  points: [],
  strokeWidth: 0,
  fillRule: 'evenodd',
  drawingMode: 'merge',
  closed: true,
  contours: [ring(60)],
  pivot: { x: -70, y: 45 },
  opacity: 0.8,
});
function polygon(s: Vector) {
  const result = clone(s),
    m = matrix(s);
  result.contours = worldPaths(s, 0.25).map((r) => {
    const points = r.slice();
    while (
      points.length > 1 &&
      points[0].x === points.at(-1)!.x &&
      points[0].y === points.at(-1)!.y
    )
      points.pop();
    return points.map((p) => inversePoint(m, p));
  });
  return result;
}
function distance(p: { x: number; y: number }, path: { x: number; y: number }[]) {
  let result = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy) || 0),
    );
    result = Math.min(result, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return result;
}
for (const basis of [undefined, [1, 0.2, 0.3, 1], [-1, 0.2, 0.3, 1]] as const)
  for (const reverse of [false, true])
    it(`recovers original cubic spans across rotated seams/orientation with detached metadata ${basis}/${reverse}`, () => {
      const source = paint();
      if (basis) source.transform = [...basis];
      const flat = polygon(source);
      if (reverse) flat.contours![0].reverse();
      const r = flat.contours![0];
      r.push(...r.splice(0, 5));
      const before = structuredClone({ source, flat });
      const out = restorePaintCurves([flat], [source])[0];
      expect(count([out])).toBe(4);
      expect({ ...out, contours: undefined }).toEqual({ ...flat, contours: undefined });
      const exact = worldPaths(source, 0.001)[0],
        restored = worldPaths(out, 0.001)[0];
      for (const p of restored) expect(distance(p, exact)).toBeLessThan(0.002);
      for (const p of exact) expect(distance(p, restored)).toBeLessThan(0.002);
      expect({ source, flat }).toEqual(before);
      out.contours![0][0].out!.x += 10;
      expect({ source, flat }).toEqual(before);
    });

it('preserves holes and ring identities while recovering independent original spans', () => {
  const source = paint();
  source.contours!.push(ring(20));
  const flat = polygon(source),
    out = restorePaintCurves([flat], [source])[0];
  expect(out.contours!.map((r) => r.length)).toEqual([4, 4]);
  expect(contains(vectorPolygons(out), mapPoint(matrix(source), { x: 0, y: 0 }))).toBe(false);
  expect(contains(vectorPolygons(out), mapPoint(matrix(source), { x: 40, y: 0 }))).toBe(true);
});

it('restores uncut parts of clipped cubics without moving the Boolean intersection anchors', () => {
  const source = paint(),
    other: Vector = { ...paint(), id: 'other', x: 145 };
  const merged = mergeVectors([source, other]),
    before = clone(merged);
  const out = restorePaintCurves(merged, [source, other]);
  expect(count(out)).toBeLessThan(count(merged) * 0.3);
  const points = (shapes: Vector[]) => shapes.flatMap((s) => worldPaths(s, 0.25).flat());
  const originalVertices = points(merged);
  // Vertices absent from every source tessellation are actual clipping cuts.
  const samples = points([source, other]);
  const intersections = originalVertices.filter(
    (p) => !samples.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-8),
  );
  expect(intersections.length).toBeGreaterThanOrEqual(2);
  const restored = out.flatMap((s) => s.contours!.flat().map((n) => mapPoint(matrix(s), n)));
  for (const p of intersections)
    expect(restored.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-8)).toBe(true);
  // Earlier paint is not smoothed again: the untouched left anchor retains
  // both original world control handles, even though the right side was cut.
  const old = source.contours![0][2],
    oldWorld = mapPoint(matrix(source), old);
  const retained = out
    .flatMap((s) => s.contours!.flat().map((n) => ({ s, n })))
    .find(({ s, n }) => {
      const p = mapPoint(matrix(s), n);
      return Math.hypot(p.x - oldWorld.x, p.y - oldWorld.y) < 1e-8;
    })!;
  expect(retained).toBeDefined();
  for (const role of ['in', 'out'] as const) {
    const expected = mapPoint(matrix(source), old[role]!);
    const actual = mapPoint(matrix(retained.s), retained.n[role]!);
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
  }
  expect(merged).toEqual(before);
});

it('retains exact shared differently colored edges while preserving exterior curves', () => {
  const source = paint(),
    other = { ...paint(), id: 'other', x: 145, fill: '#0000ff' };
  const merged = mergeVectors([source, other]);
  expect(merged.length).toBeGreaterThan(1);
  const out = restorePaintCurves(merged, [source, other]);
  expect(count(out)).toBeLessThan(count(merged));
  const edges = (shapes: Vector[]) =>
    shapes.flatMap((s, shape) =>
      s.contours!.flatMap((r) =>
        r.map((n, i) => {
          const next = r[(i + 1) % r.length],
            m = matrix(s);
          return { shape, a: mapPoint(m, n), b: mapPoint(m, next), curved: !!(n.out || next.in) };
        }),
      ),
    );
  const before = edges(merged),
    after = edges(out),
    equal = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y) < 1e-8;
  const shared = before.filter((a) =>
    before.some((b) => a.shape !== b.shape && equal(a.a, b.b) && equal(a.b, b.a)),
  );
  expect(shared.length).toBeGreaterThan(4);
  for (const edge of shared)
    expect(
      after.some(
        (p) => p.shape === edge.shape && !p.curved && equal(p.a, edge.a) && equal(p.b, edge.b),
      ),
    ).toBe(true);
});

it('retains unmatched/crossing/over-budget results without discarding any paint', () => {
  const source = paint(),
    flat = polygon(source);
  flat.contours![0][4].y += 0.01;
  const out = restorePaintCurves([flat], [source]);
  const p = mapPoint(matrix(flat), flat.contours![0][4]);
  expect(
    out[0].contours![0].some(
      (n) =>
        Math.hypot(mapPoint(matrix(out[0]), n).x - p.x, mapPoint(matrix(out[0]), n).y - p.y) < 1e-8,
    ),
  ).toBe(true);
  const crossing = clone(polygon(source));
  crossing.contours!.push(clone(crossing.contours![0]));
  expect(restorePaintCurves([crossing], [source])).toEqual([crossing]);
  const dense = clone(flat);
  dense.contours = [
    Array.from({ length: 8200 }, (_, i) => ({
      x: 60 * Math.cos((i / 8200) * Math.PI * 2),
      y: 60 * Math.sin((i / 8200) * Math.PI * 2),
    })),
  ];
  expect(restorePaintCurves([dense], [source])).toEqual([dense]);
});

it('validates original numeric data and preserves omitted/false Optimize output exactly', () => {
  const source = paint(),
    flat = polygon(source),
    invalid = clone(source);
  invalid.contours![0][0].out!.x = NaN;
  expect(() => restorePaintCurves([flat], [invalid])).toThrow();
  expect(() => restoreWorkerPaintCurves([flat], [invalid])).toThrow('finite original values');
  const ink = brush(1),
    base = { brush: ink, amount: 0, merge: true, mode: 'normal' as const, selected: [], at: 1 };
  const geometry = (shapes: Vector[]) => shapes.map((s) => ({ ...s, id: undefined }));
  expect(geometry(commitBrushPaint([source], base))).toEqual(
    geometry(commitBrushPaint([source], { ...base, optimize: false })),
  );
});

it('exhausted trace work returns the complete original without partially restoring earlier spans', () => {
  const source = paint(),
    flat = polygon(source);
  const sources = Array.from({ length: 4000 }, (_, i) => ({ ...source, id: `source-${i}` }));
  const before = structuredClone({ flat, sources });
  expect(restorePaintCurves([flat], sources)).toEqual([flat]);
  const worker = restoreWorkerPaintCurves([flat], sources);
  expect(worker).toEqual([flat]);
  expect(worker[0].contours![0][0]).not.toBe(flat.contours![0][0]);
  expect({ flat, sources }).toEqual(before);
});

it('restores the same detached output when the Brush component includes straight contours', () => {
  const curved = paint(), flat = polygon(curved);
  const straight = { ...clone(flat), id: 'straight', x: flat.x + 400 };
  const sources = [straight, curved], merged = [flat, straight];
  const before = structuredClone({ sources, merged });
  const worker = restoreWorkerPaintCurves(merged, sources);
  const restored = restorePaintCurves(merged, sources);
  expect(worker).toEqual(restored);
  expect(worker[0].contours!.flat().some(n => !!n.out)).toBe(true);
  expect(worker[1].contours![0][0]).not.toBe(straight.contours![0][0]);
  restored[0].contours![0][0].x += 1;
  restored[1].contours![0][0].x += 1;
  expect({ sources, merged }).toEqual(before);
  const fallback = restoreWorkerPaintCurves([straight], [straight]);
  expect(fallback).toEqual([straight]);
  expect(fallback[0].contours![0][0]).not.toBe(straight.contours![0][0]);
});

it('retains the private pre-admission artwork when a reentrant callback aborts', () => {
  const source = paint(), flat = polygon(source), merged = [flat];
  const before = clone(merged);
  let reached = false;
  const fallback = restorePaintCurves(merged, [source], (piece) => {
    reached = true;
    piece.contours![0][0].x += 20;
    merged[0] = { ...piece, id: 'changed-by-caller' };
    throw Error('Reject candidate');
  });
  expect(reached).toBe(true);
  expect(fallback).toEqual(before);
  expect(fallback[0].contours![0][0]).not.toBe(flat.contours![0][0]);
});

it('large document origins never widen sample matching into geometry snapping', () => {
  const source = paint();
  source.x = 1e14;
  source.y = 1e14;
  const flat = polygon(source);
  flat.contours![0][4].y += 1;
  const out = restorePaintCurves([flat], [source]);
  const changed = mapPoint(matrix(flat), flat.contours![0][4]);
  expect(
    out[0].contours![0].some((n) => {
      const q = mapPoint(matrix(out[0]), n);
      return q.x === changed.x && q.y === changed.y;
    }),
  ).toBe(true);
});

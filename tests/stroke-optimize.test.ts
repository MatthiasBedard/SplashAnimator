import { expect, it } from 'vitest';
import { clone, newProject, validateProject, type Vector } from '../packages/document/src';
import { optimizeNewStroke, optimizeNewPaint } from '../packages/geometry/src/stroke-optimize';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { commitBrushPaint, type BrushCommit } from '../packages/geometry/src/brush-commit';
import { worldPaths } from '../packages/geometry/src/drawing';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { contains, vectorPolygons, mergeVectors } from '../packages/geometry/src/merge';
import { fitPencilStroke } from '../packages/geometry/src/pencil-fit';
import { drawnSymbolPencil } from '../packages/geometry/src/symbol-artwork';

const ink = (): Vector => ({
  id: 'ink',
  kind: 'path',
  x: 60,
  y: 70,
  width: 180,
  height: 30,
  rotation: 0,
  fill: '#ff0000',
  fillEnabled: false,
  stroke: '#ff0000',
  strokeWidth: 8,
  points: Array.from({ length: 241 }, (_, i) => ({
    x: i * 0.75,
    y: 25 * Math.sin(i / 90),
    pressure: 0.3 + i / 600,
    tiltX: 10,
    tiltY: 5,
    twist: 30,
  })),
  pivot: { x: -10, y: 15 },
  opacity: 0.8,
});
const count = (s: Vector) => s.contours?.flat().length ?? s.nodes?.length ?? s.points.length;
const nodes = (s: Vector) => s.contours?.flat() ?? s.nodes ?? [];
const valid = (shapes: Vector[]) => {
  const p = newProject();
  p.layers[0].keys[0].shapes = shapes;
  validateProject(p);
};
function distance(p: { x: number; y: number }, path: { x: number; y: number }[]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy) || 0),
    );
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}
function fidelity(a: Vector, b: Vector) {
  const before = worldPaths(a, 0.002),
    after = worldPaths(b, 0.002);
  expect(after).toHaveLength(before.length);
  for (let r = 0; r < before.length; r++) {
    expect(Math.max(...before[r].map((p) => distance(p, after[r])))).toBeLessThan(0.755);
    expect(Math.max(...after[r].map((p) => distance(p, before[r])))).toBeLessThan(0.755);
  }
}
for (const axis of ['x', 'y'] as const)
  it('reduces exact straight ' + axis + ' ink without fitting cubic handles', () => {
    const source = ink();
    source.points = [80, 60, 60, 20, 0].map((n, i) => ({
      x: axis === 'x' ? n : .125, y: axis === 'y' ? n : -.375, pressure: .25 + i / 8,
    }));
    const original = clone(source);
    const optimized = optimizeNewStroke(source);
    expect(optimized).toEqual({ ...source, points: [source.points[0], source.points[4]] });
    valid([optimized]);
    optimized.points[0].pressure = 1;
    expect(source).toEqual(original);
  });

it('does not shorten a retraced straight path to its endpoint chord', () => {
  const source = { ...ink(), points: [0, 80, 20, 60].map(x => ({ x, y: 6 })) };
  const optimized = optimizeNewStroke(source);
  const [path] = worldPaths(optimized, .002);
  expect(Math.max(...path.map(p => p.x))).toBeGreaterThan(139);
});

for (const basis of [undefined, [1, 0.2, 0.3, 1], [-1, 0.2, 0.3, 1]] as const)
  it(`reduces redundant new Pencil vertices to curves with exact endpoints/paint/pivot and bounded world error ${basis}`, () => {
    const source = ink();
    if (basis) source.transform = [...basis];
    const original = clone(source),
      out = optimizeNewStroke(source);
    expect(out.kind).toBe('bezier');
    expect(count(out)).toBeLessThan(20);
    expect(nodes(out).some((n) => n.in || n.out)).toBe(true);
    for (const i of [0, -1]) {
      const end = source.points.at(i)!,
        fitted = out.nodes!.at(i)!;
      expect(mapPoint(matrix(out), fitted)).toEqual(mapPoint(matrix(source), end));
      expect(fitted).toMatchObject(end);
    }
    expect({ ...out, kind: source.kind, nodes: undefined, points: source.points }).toEqual({
      ...source,
      nodes: undefined,
    });
    fidelity(source, out);
    valid([out]);
    out.nodes![0].x = 1000;
    expect(source).toEqual(original);
  });

for (const mode of ['ink', 'smooth', 'straight'] as const)
  for (const merge of [false, true])
    it(`keeps omitted/false Pencil optimization exactly compatible ${mode}/${merge}`, () => {
      const stroke = ink(),
        base = { stroke, mode, merge, smoothing: 50 };
      const a = preparePencilDrawing([], base),
        b = preparePencilDrawing([], { ...base, optimize: false });
      expect(a).toEqual(b);
      const out = preparePencilDrawing([], { ...base, optimize: true });
      expect(count(out.shape)).toBeLessThanOrEqual(count(a.shape));
      if (mode === 'straight') expect(out).toEqual(a);
      valid(merge ? out.shapes : [out.shape]);
    });

it('optimizes AFTER the selected smoothing rather than filtering the stroke twice', () => {
  const stroke = ink(),
    expected = optimizeNewStroke(fitPencilStroke(stroke, 75));
  expect(
    preparePencilDrawing([], {
      stroke,
      mode: 'smooth',
      merge: false,
      smoothing: 75,
      optimize: true,
    }).shape,
  ).toEqual(expected);
});

const brush = () => ({
  ...ink(),
  kind: 'brush' as const,
  fillEnabled: true,
  brush: { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 },
  strokeWidth: 14,
});
const request = (b: Vector, patch: Partial<BrushCommit> = {}): BrushCommit => ({
  brush: b,
  amount: 0,
  merge: true,
  mode: 'normal',
  selected: [],
  at: 0,
  ...patch,
});
it('fits the new merged Brush footprint to fewer editable cubic anchors without changing its paint', () => {
  const b = brush(),
    original = clone(b),
    legacy = commitBrushPaint([], request(b));
  const out = commitBrushPaint([], request(b, { optimize: true }));
  expect(out.reduce((n, s) => n + count(s), 0)).toBeLessThan(
    legacy.reduce((n, s) => n + count(s), 0),
  );
  expect(out.some((s) => nodes(s).some((n) => n.in || n.out))).toBe(true);
  fidelity(legacy[0], out[0]);
  valid(out);
  expect(b).toEqual(original);
});

it('preserves hole nesting and ring order while reducing compound paint, including reflected placement', () => {
  const s: Vector = {
    ...ink(),
    kind: 'polygon',
    fillEnabled: true,
    strokeWidth: 0,
    points: [],
    fillRule: 'evenodd',
    transform: [-1, 0.1, 0.2, 1],
    contours: [60, 20].map((radius) =>
      Array.from({ length: 181 }, (_, i) => ({
        x: 80 + radius * Math.cos((i / 181) * 2 * Math.PI),
        y: 80 + radius * Math.sin((i / 181) * 2 * Math.PI),
      })),
    ),
  };
  const out = optimizeNewPaint([s])[0];
  expect(out.contours).toHaveLength(2);
  expect(count(out)).toBeLessThan(count(s) / 2);
  fidelity(s, out);
  const m = matrix(out),
    polygons = vectorPolygons(out);
  expect(contains(polygons, mapPoint(m, { x: 80, y: 80 }))).toBe(false);
  expect(contains(polygons, mapPoint(m, { x: 120, y: 80 }))).toBe(true);
  valid([out]);
});

it('retains ambiguous touching compound geometry and complete over-budget strokes without discarding ink', () => {
  const b = brush(),
    painted = mergeVectors([b]);
  const same = clone(painted[0]);
  same.id = 'touching';
  expect(optimizeNewPaint([...painted, same])).toEqual([...painted, same]);
  const long = ink();
  long.points = Array.from({ length: 8200 }, (_, x) => ({ x: x / 50, y: Math.sin(x / 400) }));
  expect(optimizeNewStroke(long)).toEqual(long);
});

it('separate pressure Brush objects reduce only redundant center/radius samples and retain pen metadata', () => {
  const b = brush();
  b.brush.pressure = true;
  b.points = Array.from({ length: 101 }, (_, i) => ({
    x: i,
    y: 0,
    pressure: 0.2 + i * 0.005,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
  }));
  const result = commitBrushPaint([], request(b, { merge: false, optimize: true }))[0];
  expect(result.kind).toBe('brush');
  expect(result.points.length).toBeLessThan(b.points.length);
  expect(
    result.points.every((p) => b.points.some((q) => JSON.stringify(p) === JSON.stringify(q))),
  ).toBe(true);
  expect(result.brush).toEqual(b.brush);
  for (const patch of [{ tilt: true }, { twist: true }, { response: 2 }]) {
    const exact = { ...b, brush: { ...b.brush, ...patch } };
    expect(optimizeNewStroke(exact)).toEqual(exact);
  }
});

it('never optimizes old paint, including overlapped ink remote from the new footprint', () => {
  const b = brush(),
    old = mergeVectors([b]);
  const incoming = { ...brush(), id: 'new', x: 210 };
  const before = clone({ old, incoming });
  const out = commitBrushPaint(
    old,
    request(incoming, { at: old.length, optimize: true, amount: 1 }),
  );
  const remote = (shapes: Vector[]) =>
    [
      ...new Set(
        shapes
          .flatMap((s) => worldPaths(s, 0.25).flat())
          .filter((p) => p.x < 170)
          .map((p) => `${p.x.toFixed(7)},${p.y.toFixed(7)}`),
      ),
    ].sort();
  expect(remote(out)).toEqual(remote(old));
  expect({ old, incoming }).toEqual(before);
});

for (const bad of [null, 1, 'true', NaN])
  it(`rejects malformed optimize settings without touching artwork (${String(bad)})`, () => {
    const s = ink(),
      b = brush(),
      original = clone({ s, b });
    expect(() =>
      preparePencilDrawing([], {
        stroke: s,
        mode: 'ink',
        merge: false,
        optimize: bad as unknown as boolean,
      }),
    ).toThrow();
    expect(() =>
      commitBrushPaint([], request(b, { optimize: bad as unknown as boolean })),
    ).toThrow();
    expect({ s, b }).toEqual(original);
  });

it('rejects raw nonfinite coordinates before optional fitting fallback', () => {
  const source = ink();
  source.points[10].x = NaN;
  expect(() => optimizeNewStroke(source)).toThrow();
});

for (const mode of ['raw', 'smooth', 'straight'] as const)
  it(`isolated Pencil worker preserves its existing ${mode} finishing when optimization is off`, () => {
    const source = ink();
    const raw = drawnSymbolPencil(
      'symbol',
      source.points,
      'raw',
      source.stroke,
      source.strokeWidth,
    );
    const result = preparePencilDrawing([], {
      stroke: raw,
      mode: mode === 'raw' ? 'ink' : mode,
      merge: false,
      symbol: true,
      optimize: false,
    }).shape;
    const expected = drawnSymbolPencil(
      'symbol',
      source.points,
      mode,
      source.stroke,
      source.strokeWidth,
    );
    expect(result).toEqual(expected);
  });

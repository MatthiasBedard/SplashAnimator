import { expect, it } from 'vitest';
import { newProject, validateProject, type Vector } from '../packages/document/src';
import {
  artworkVertices as count,
  simplifyArtwork,
} from '../packages/geometry/src/artwork-simplify';
import { prepareSmoothSelection } from '../packages/geometry/src/smooth-selection';
import { prepareEditorPaintSelection } from '../packages/geometry/src/clip-paint';
import { optimizeNewStroke, optimizeNewPaint } from '../packages/geometry/src/stroke-optimize';
import { worldPaths } from '../packages/geometry/src/drawing';
import { contains, vectorPolygons, mergeVectors } from '../packages/geometry/src/merge';
import { fitPolyline } from '../packages/geometry/src/curve-fit';
import { compoundBrushPaint } from './compound-simplify-fixture';

function ink(): Vector {
  return {
    id: 'ink',
    kind: 'path',
    x: 60,
    y: 60,
    width: 300,
    height: 80,
    rotation: 0,
    fill: '#ff0000',
    fillEnabled: false,
    stroke: '#ff0000',
    strokeWidth: 6,
    points: Array.from({ length: 301 }, (_, i) => ({
      x: i,
      y: 25 * Math.sin(i / 25) + 1.5 * Math.sin(i / 2),
      pressure: 0.5,
    })),
    pivot: { x: -15, y: 10 },
    opacity: 0.8,
  };
}
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
function fidelity(a: Vector, b: Vector, tolerance: number) {
  const before = worldPaths(a, 0.005),
    after = worldPaths(b, 0.005);
  expect(after).toHaveLength(before.length);
  for (let i = 0; i < before.length; i++) {
    expect(Math.max(...before[i].map((p) => distance(p, after[i])))).toBeLessThan(tolerance + 0.02);
    expect(Math.max(...after[i].map((p) => distance(p, before[i])))).toBeLessThan(tolerance + 0.02);
  }
}
function valid(s: Vector) {
  const p = newProject();
  p.layers[0].keys[0].shapes = [s];
  validateProject(p);
}

it('each successful click removes vertices, preserving endpoints/styles and a bounded current-shape error', () => {
  let source = ink();
  const original = structuredClone(source),
    counts = [count(source)];
  for (let i = 0; i < 4; i++) {
    const out = simplifyArtwork(source);
    expect(count(out)).toBeLessThan(count(source));
    fidelity(source, out, 4);
    valid(out);
    expect([out.x, out.y, out.width, out.height, out.pivot, out.opacity, out.strokeWidth]).toEqual([
      source.x,
      source.y,
      source.width,
      source.height,
      source.pivot,
      source.opacity,
      source.strokeWidth,
    ]);
    expect(out.nodes![0].x).toBe(original.points[0].x);
    expect(out.nodes![0].y).toBe(original.points[0].y);
    expect(out.nodes!.at(-1)!.x).toBe(original.points.at(-1)!.x);
    expect(out.nodes!.at(-1)!.y).toBe(original.points.at(-1)!.y);
    counts.push(count(out));
    source = out;
  }
  expect(counts[1]).toBeLessThan(counts[0] / 3);
});

for (const basis of [
  [1, 0.2, 0.3, 1],
  [-1, 0.2, 0.3, 1],
] as const)
  it(`reduces already curved ${basis[0]} ink in document space`, () => {
    const s = ink();
    s.transform = [...basis];
    const a = simplifyArtwork(s),
      b = simplifyArtwork(a);
    expect(count(b)).toBeLessThan(count(a));
    fidelity(a, b, 4);
    expect(b.transform).toEqual(s.transform);
    expect(s.nodes).toBeUndefined();
  });

it('simplifies raw object Brush samples rather than merely shifting every sample', () => {
  const s = {
    ...ink(),
    kind: 'brush' as const,
    fillEnabled: true,
    brush: { pressure: false, minimum: 0.1, tilt: false, aspect: 1, angle: 0 },
  };
  const out = simplifyArtwork(s);
  expect(count(out)).toBeLessThan(count(s) / 3);
  expect(out.kind).toBe('brush');
  expect(out.points[0]).toEqual(s.points[0]);
  expect(out.points.at(-1)).toEqual(s.points.at(-1));
  expect(
    out.points.every((p) => s.points.some((q) => JSON.stringify(p) === JSON.stringify(q))),
  ).toBe(true);
  fidelity(
    { ...s, kind: 'path', fillEnabled: false },
    { ...out, kind: 'path', fillEnabled: false },
    4,
  );
  valid(out);
});

it('preserves holes and removes vertices again from the already fitted contours', () => {
  const s = {
    ...ink(),
    kind: 'polygon' as const,
    points: [],
    fillRule: 'evenodd' as const,
    fillEnabled: true,
    strokeWidth: 0,
    contours: [60, 20].map((radius) =>
      Array.from({ length: 160 }, (_, i) => {
        const a = (i / 160) * Math.PI * 2,
          r = radius + 0.1 * Math.sin(i * 2);
        return { x: 80 + r * Math.cos(a), y: 80 + r * Math.sin(a) };
      }),
    ),
  };
  const a = simplifyArtwork(s),
    b = simplifyArtwork(a);
  expect(count(a)).toBeLessThan(count(s) / 3);
  expect(count(b)).toBeLessThan(count(a));
  expect(b.contours).toHaveLength(2);
  fidelity(s, a, 4);
  fidelity(a, b, 4);
  expect(contains(vectorPolygons(b), { x: 140, y: 140 })).toBe(false);
  expect(contains(vectorPolygons(b), { x: 180, y: 140 })).toBe(true);
  valid(b);
});

it('simplifies a dense merged Brush loop beyond the old fitting window while keeping its hole', () => {
  const s: Vector = {
    ...ink(),
    kind: 'polygon',
    points: [],
    fillRule: 'evenodd',
    fillEnabled: true,
    strokeWidth: 0,
    contours: [9000, 2500].map((length, ring) =>
      Array.from({ length }, (_, i) => {
        const angle = (i / length) * Math.PI * 2;
        const radius = ring ? 48 : 70;
        return { x: 80 + radius * Math.cos(angle), y: 80 + radius * Math.sin(angle) };
      }),
    ),
  };
  const before = structuredClone(s);
  const out = simplifyArtwork(s);
  expect(count(out)).toBeLessThan(100);
  expect(out.contours).toHaveLength(2);
  expect(out.contours!.every((ring) => ring.some((node) => node.out))).toBe(true);
  expect(contains(vectorPolygons(out), { x: 140, y: 140 })).toBe(false);
  expect(contains(vectorPolygons(out), { x: 200, y: 140 })).toBe(true);
  fidelity(s, out, 0.5);
  expect(s).toEqual(before);
  valid(out);
});

it('partial reduction preserves the dense compound fill’s untouched curves and hole', () => {
  const source = compoundBrushPaint();
  const snapshot = structuredClone(source);
  const selection = prepareEditorPaintSelection([source], {
    current: [], mode: 'replace',
    polygon: [{ x: 165, y: 75 }, { x: 220, y: 75 }, { x: 220, y: 205 }, { x: 165, y: 205 }],
  }, [source.id]);
  const request = { selected: [], eligible: [source.id], simplify: true };
  expect(selection.footprint[0][0].length).toBeGreaterThan(800);
  expect(prepareSmoothSelection([source], { ...request, region: selection.footprint }))
    .toEqual({ changed: 0, artwork: [snapshot], selected: [], removed: 0 });
  const result = prepareSmoothSelection([source], { ...request, region: selection.mask });
  expect(result.selected).toHaveLength(1);
  const selected = result.artwork.find(piece => result.selected.includes(piece.id))!;
  expect(contains(vectorPolygons(selected), { x: 190, y: 140 })).toBe(true);
  expect(result.removed).toBeGreaterThan(300);
  const outside = result.artwork.find(piece => !result.selected.includes(piece.id))!;
  const far = outside.contours![0].find(node => node.x === 0 && node.y === 60);
  expect(far).toEqual(source.contours![0].at(-1));
  const paint = result.artwork.map(piece => vectorPolygons(piece));
  for (const [x, y, covered] of [[120, 140, false], [84, 140, true], [190, 140, true], [205, 140, false]] as const)
    expect(paint.some(piece => contains(piece, { x, y }))).toBe(covered);
  expect(source).toEqual(snapshot);
});

it('the selection result reports actual removed vertices and leaves unselected artwork exact', () => {
  const s = ink(),
    other = { ...ink(), id: 'other', x: 400 },
    original = structuredClone([s, other]);
  const out = prepareSmoothSelection([s, other], { selected: ['ink'], simplify: true });
  expect(out.removed).toBe(count(s) - count(out.artwork[0]));
  expect(out.removed).toBeGreaterThan(0);
  expect(out.artwork[1]).toEqual(other);
  expect(out.selected).toEqual(['ink']);
  expect([s, other]).toEqual(original);
});

it('continues removing remote brush anchors when a touching hole blocks the whole-contour fit', () => {
  const outer = [
    { x: 0, y: 0 },
    { x: 180, y: 0 },
    ...Array.from({ length: 10 }, (_, i) => ({ x: 180, y: 10 + 10 * i })),
    { x: 180, y: 120 },
    { x: 0, y: 120 },
  ];
  const hole = [
    { x: 0, y: 60 },
    { x: 22, y: 36 },
    { x: 42, y: 60 },
    { x: 22, y: 84 },
  ];
  const original: Vector = {
    ...ink(),
    kind: 'polygon',
    fillEnabled: true,
    fillRule: 'evenodd',
    strokeWidth: 0,
    points: [],
    contours: [outer, hole],
  };
  const snapshot = structuredClone(original);
  let current = original;
  for (let click = 0; click < 3; click++) {
    const result = prepareSmoothSelection([current], { selected: [current.id], simplify: true });
    expect(result.removed).toBeGreaterThan(0);
    const next = result.artwork[0];
    expect(count(next)).toBeLessThan(count(current));
    expect(next.contours![1]).toEqual(hole);
    expect(next.contours![0].some((n) => n.out)).toBe(true);
    fidelity(current, next, 0.5);
    valid(next);
    current = next;
  }
  for (let click = 0; click < outer.length && current.contours![0].length > 4; click++) {
    const next = simplifyArtwork(current);
    expect(count(next)).toBeLessThan(count(current));
    current = next;
  }
  expect(current.contours![0]).toHaveLength(4);
  expect(simplifyArtwork(current)).toEqual(current);
  expect(original).toEqual(snapshot);
  expect(contains(vectorPolygons(current), { x: 82, y: 120 })).toBe(false);
  expect(contains(vectorPolygons(current), { x: 170, y: 120 })).toBe(true);
});

it('does not rewrite minimal primitives or claim a reduction when none is possible', () => {
  for (const kind of ['line', 'rectangle', 'ellipse'] as const) {
    const s = { ...ink(), kind, points: [] };
    const out = prepareSmoothSelection([s], { selected: ['ink'], simplify: true });
    expect(out.artwork).toEqual([s]);
    expect(out.changed).toBe(0);
    expect(out.removed).toBe(0);
  }
});

it('whole stroked paint-region selections retain editable lines rather than becoming fills', () => {
  const s = ink();
  const region = [
    [
      [
        [0, 0],
        [500, 0],
        [500, 250],
        [0, 250],
        [0, 0],
      ],
    ],
  ] as [number, number][][][];
  const out = prepareSmoothSelection([s], {
    selected: [],
    region,
    eligible: ['ink'],
    simplify: true,
  });
  expect(out.changed).toBe(1);
  expect(out.removed).toBeGreaterThan(0);
  expect(out.artwork).toHaveLength(1);
  expect(out.artwork[0].kind).toBe('bezier');
  expect(out.artwork[0].fillEnabled).toBe(false);
  expect(out.artwork[0].strokeWidth).toBe(s.strokeWidth);
  valid(out.artwork[0]);
});

it('legacy fitting keeps exact corner behavior unless reduction is explicitly requested', () => {
  const points = ink().points;
  expect(fitPolyline(points, 0.25)).toEqual(fitPolyline(points, 0.25, false, 0));
  for (const value of [-1, NaN, Infinity, 0.5])
    expect(() => fitPolyline(points, 0.25, false, value)).toThrow(/corner allowance/);
});

it('stronger automatic optimization reduces tiny corner noise within its own .75-unit allowance', () => {
  const s = ink();
  s.points = Array.from({ length: 301 }, (_, i) => ({
    x: i * 0.2,
    y: (i % 2 ? 0.3 : -0.3) + 0.003 * i,
  }));
  const out = optimizeNewStroke(s);
  expect(count(out)).toBeLessThan(count(s) / 5);
  fidelity(s, out, 0.75);
});

it('keeps actual new merged Brush paint editable and substantially simpler', () => {
  const brush = {
    ...ink(),
    kind: 'brush' as const,
    fillEnabled: true,
    strokeWidth: 12,
    brush: { pressure: false, minimum: 0.1, tilt: false, aspect: 1, angle: 0 },
  };
  const paint = mergeVectors([brush]);
  const out = optimizeNewPaint(paint);
  expect(out.reduce((n, s) => n + count(s), 0)).toBeLessThan(
    paint.reduce((n, s) => n + count(s), 0),
  );
  out.forEach(valid);
});

it('rejects raw numeric/getter/invalid options before publication and retains uncertain topology', () => {
  const s = ink();
  s.points[0].x = NaN;
  expect(() => simplifyArtwork(s)).toThrow();
  const getter = ink();
  let reads = 0;
  Object.defineProperty(getter.points[0], 'x', {
    enumerable: true,
    get() {
      reads++;
      return 1;
    },
  });
  expect(() => simplifyArtwork(getter)).toThrow();
  expect(reads).toBe(0);
  expect(() =>
    prepareSmoothSelection([ink()], { selected: ['ink'], simplify: 1 as unknown as boolean }),
  ).toThrow();
});

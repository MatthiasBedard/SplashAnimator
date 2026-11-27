import { expect, it } from 'vitest';
import {
  newProject,
  validateProject,
  migrateProject,
  clone,
  type Vector,
} from '../packages/document/src';
import { pathCommands, normalizeVector, scaleVector } from '../packages/geometry/src/drawing';
import { moveAnchors } from '../packages/geometry/src/nodes';
import { vectorPolygons, contains, mergeVectors } from '../packages/geometry/src/merge';
const ring = (r: number) => {
  const k = 0.5522847498307936;
  return [
    { x: r, y: 0, in: { x: r, y: -k * r }, out: { x: r, y: k * r } },
    { x: 0, y: r, in: { x: k * r, y: r }, out: { x: -k * r, y: r } },
    { x: -r, y: 0, in: { x: -r, y: k * r }, out: { x: -r, y: -k * r } },
    { x: 0, y: -r, in: { x: -k * r, y: -r }, out: { x: k * r, y: -r } },
  ];
};
const shape = (): Vector => ({
  id: 'compound',
  kind: 'polygon',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
  closed: true,
  fillRule: 'evenodd',
  contours: [ring(50), ring(30), ring(10)],
});
it('validates schema 19 handles and keeps legacy contours straight without mutation', () => {
  const p = newProject();
  p.layers[0].keys[0].shapes = [shape()];
  expect(validateProject(p)).toEqual(p);
  const before = JSON.stringify(p),
    legacy = migrateProject({ ...p, schemaVersion: 18 });
  expect(legacy.layers[0].keys[0].shapes[0].contours![0][0].out).toBeUndefined();
  expect(JSON.stringify(p)).toBe(before);
  const bad = clone(p);
  bad.layers[0].keys[0].shapes[0].contours![0][0].out!.x = NaN;
  expect(() => validateProject(bad)).toThrow('polygon contours');
});
it('renders and flattens nested curved exterior/hole/island regions', () => {
  const s = shape(),
    commands = pathCommands(s);
  expect(commands.filter((c) => c[0] === 'C')).toHaveLength(12);
  const p = vectorPolygons(s);
  expect(contains(p, { x: 40, y: 0 })).toBe(true);
  expect(contains(p, { x: 20, y: 0 })).toBe(false);
  expect(contains(p, { x: 0, y: 0 })).toBe(true);
});
it('normalizes, resizes and moves contour handles with their anchors', () => {
  const s = shape();
  normalizeVector(s);
  expect(s.x).toBe(-50);
  expect(s.contours![0][0].out).toEqual({ x: 100, y: 50 + 50 * 0.5522847498307936 });
  const original = clone(s);
  scaleVector(s, 2, 0.5);
  expect(s.contours![0][0].out!.x).toBe(200);
  const scaled = clone(s);
  moveAnchors(s, scaled, [0], 3, 4);
  expect(s.contours![0][0].out!.x).toBe(203);
  expect(original.contours![0][0].x).toBe(100);
});

it('preserves even-odd islands after all handles are removed and ring order changes', () => {
  const s = shape();
  s.contours = s.contours!.map((r) => r.map(({ x, y }) => ({ x, y }))).reverse();
  s.contours[1].reverse();
  const before = clone(s);
  const result = mergeVectors([s]);
  for (const [x, expected] of [
    [0, true],
    [20, false],
    [40, true],
    [60, false],
  ] as const) {
    expect(contains(vectorPolygons(s), { x, y: 0 })).toBe(expected);
    expect(result.some((r) => contains(vectorPolygons(r), { x, y: 0 }))).toBe(expected);
  }
  expect(s).toEqual(before);
});
it('uses parity for overlapping straight rings rather than treating every later ring as a hole', () => {
  const s = shape();
  const square = (x: number) => [
    { x, y: 0 },
    { x: x + 20, y: 0 },
    { x: x + 20, y: 20 },
    { x, y: 20 },
  ];
  s.contours = [square(0), square(10)];
  const p = vectorPolygons(s);
  expect(contains(p, { x: 5, y: 10 })).toBe(true);
  expect(contains(p, { x: 15, y: 10 })).toBe(false);
  expect(contains(p, { x: 25, y: 10 })).toBe(true);
});

it('retains disjoint curved paint exactly through unrelated fill merges', () => {
  const a = shape();
  a.transform = [-1, 0.2, 0.3, 1];
  a.rotation = 20;
  const b: Vector = {
    ...shape(),
    id: 'brush',
    kind: 'brush',
    x: 300,
    y: 300,
    contours: undefined,
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
    ],
    strokeWidth: 20,
  };
  const before = clone(a),
    result = mergeVectors([a, b]);
  expect(result.find((s) => s.id === a.id)).toEqual({ ...before, drawingMode: 'merge' });
  expect(a).toEqual(before);
  result.find((s) => s.id === a.id)!.contours![0][0].out!.x++;
  expect(a).toEqual(before);
});
it('normalizes interacting curved fills and conservatively includes control-hull overshoot', () => {
  const a = shape(),
    b: Vector = {
      ...shape(),
      id: 'overlap',
      contours: undefined,
      kind: 'rectangle',
      x: 40,
      y: 0,
      width: 20,
      height: 20,
    };
  const merged = mergeVectors([a, b]);
  expect(merged.some((s) => s.contours?.some((r) => r.some((n) => n.in || n.out)))).toBe(false);
  const bent = shape();
  bent.contours![0][0].out = { x: 300, y: 0 };
  expect(mergeVectors([bent, { ...b, x: 200 }]).some((s) => s.id === bent.id)).toBe(false);
});

it('retains curved fill beside distant linework but normalizes thick nearby strokes', () => {
  const a = shape();
  const line: Vector = {
    ...shape(),
    id: 'line',
    kind: 'path',
    contours: undefined,
    closed: false,
    fillEnabled: false,
    x: 300,
    y: 0,
    points: [
      { x: 0, y: -10 },
      { x: 0, y: 10 },
    ],
    strokeWidth: 10,
  };
  expect(mergeVectors([a, line]).find((s) => s.id === a.id)).toEqual({
    ...a,
    drawingMode: 'merge',
  });
  const close = { ...line, x: 60, strokeWidth: 40 };
  expect(mergeVectors([a, close]).some((s) => s.id === a.id)).toBe(false);
  const miter = { ...line, x: 150, strokeJoin: 'miter' as const, strokeWidth: 50 };
  expect(mergeVectors([a, miter]).some((s) => s.id === a.id)).toBe(false);
});
it('includes affine stroke enlargement and never retains a stroked curved shape', () => {
  const a = shape();
  const line: Vector = {
    ...shape(),
    id: 'line',
    kind: 'path',
    contours: undefined,
    closed: false,
    fillEnabled: false,
    x: 80,
    y: 0,
    points: [
      { x: 0, y: -10 },
      { x: 0, y: 10 },
    ],
    strokeWidth: 10,
    transform: [10, 0, 0, 1],
    strokeCap: 'square',
  };
  expect(mergeVectors([a, line]).some((s) => s.id === a.id)).toBe(false);
  expect(mergeVectors([{ ...a, strokeWidth: 1 }]).some((s) => s.id === a.id)).toBe(false);
});

it('retains exact detached curves above the former 512-object preservation cutoff', () => {
  const input = Array.from({ length: 600 }, (_, i) => ({
    ...shape(),
    id: `curve-${i}`,
    x: i * 300,
    rotation: 20,
    transform: [-1, 0.2, 0.3, 1] as [number, number, number, number],
  }));
  const before = clone(input);
  const result = mergeVectors(input);
  expect(result).toEqual(before.map((s) => ({ ...s, drawingMode: 'merge' })));
  result[599].contours![0][0].out!.x++;
  expect(input).toEqual(before);
});

it('keeps distant curves exact in a large scene while normalizing interacting control hulls', () => {
  const input: Vector[] = Array.from({ length: 520 }, (_, i) => ({
    ...shape(),
    id: `curve-${i}`,
    x: i * 300,
  }));
  const overlay: Vector = {
    ...shape(),
    id: 'overlay',
    kind: 'rectangle',
    contours: undefined,
    x: 40,
    y: 0,
    width: 20,
    height: 20,
    fill: '#ff0000',
  };
  const before = clone(input);
  const result = mergeVectors([...input, overlay]);
  for (const source of before.slice(1))
    expect(result.find((s) => s.id === source.id)).toEqual({ ...source, drawingMode: 'merge' });
  expect(result.find((s) => s.id === 'curve-0')).toBeUndefined();
  expect(
    result.some((s) => s.fill === '#ff0000' && contains(vectorPolygons(s), { x: 50, y: 10 })),
  ).toBe(true);
  expect(input).toEqual(before);
});

it('preserves nonzero winding for nested same-direction and opposite-direction contours', () => {
  const square = (a: number, b: number) => [
    { x: a, y: a },
    { x: b, y: a },
    { x: b, y: b },
    { x: a, y: b },
  ];
  for (const reflected of [false, true]) {
    const s: Vector = {
      ...shape(),
      fillRule: 'nonzero',
      contours: [square(0, 40), square(5, 35), square(10, 30).reverse()],
      transform: reflected ? [-1, 0, 0, 1] : undefined,
    };
    const before = clone(s);
    const polygons = vectorPolygons(s);
    expect(s).toEqual(before);
    // Winding counts are 1, 2 and 1 (or their negatives after reflection).
    for (const n of [2, 7, 20])
      expect(contains(polygons, { x: reflected ? -n : n, y: n })).toBe(true);
    s.contours = [square(0, 40), square(5, 35).reverse(), square(10, 30)];
    const holes = vectorPolygons(s);
    expect(contains(holes, { x: reflected ? -7 : 7, y: 7 })).toBe(false);
    expect(contains(holes, { x: reflected ? -20 : 20, y: 20 })).toBe(true);
    s.contours = before.contours;
    expect(s).toEqual(before);
  }
});

it('resolves overlapping nonzero winding counts independently of contour order', () => {
  const rect = (x: number, width: number) => [
    { x, y: 0 },
    { x: x + width, y: 0 },
    { x: x + width, y: 20 },
    { x, y: 20 },
  ];
  const contours = [rect(0, 30), rect(10, 30), rect(20, 30).reverse(), rect(60, 10).reverse()];
  for (const ordered of [contours, [...contours].reverse()]) {
    const s: Vector = { ...shape(), fillRule: 'nonzero', contours: ordered };
    const before = clone(s),
      result = vectorPolygons(s);
    for (let x = 0.5; x < 75; x++) {
      const winding =
        Number(x < 30) +
        Number(x > 10 && x < 40) -
        Number(x > 20 && x < 50) -
        Number(x > 60 && x < 70);
      expect(contains(result, { x, y: 10 })).toBe(winding !== 0);
    }
    expect(s).toEqual(before);
  }
});

it('retains isolated narrow nonzero paint but rejects collapse in an interacting group', () => {
  const s: Vector = {
    ...shape(),
    fillRule: 'nonzero',
    contours: [
      [
        { x: 0, y: 0 },
        { x: 0.00001, y: 0 },
        { x: 0.00001, y: 20 },
        { x: 0, y: 20 },
      ],
    ],
  };
  s.contours!.push([
    { x: 30, y: 0 },
    { x: 40, y: 0 },
    { x: 30, y: 10 },
  ]);
  const isolated = clone(s);
  expect(contains(vectorPolygons(s), { x: 0.000005, y: 10 })).toBe(true);
  expect(s).toEqual(isolated);
  s.contours![1] = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 30 },
  ];
  const before = clone(s);
  expect(() => mergeVectors([s])).toThrow(/collapses.*precision/);
  expect(s).toEqual(before);
});

it.each(['nonzero', 'evenodd'] as const)(
  'retains both lobes of a zero-signed-area crossing contour (%s)',
  (fillRule) => {
    const s: Vector = {
      ...shape(),
      fillRule,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 40, y: 40 },
          { x: 0, y: 40 },
          { x: 40, y: 0 },
        ],
      ],
    };
    const before = clone(s),
      polygons = vectorPolygons(s);
    expect(contains(polygons, { x: 20, y: 5 })).toBe(true);
    expect(contains(polygons, { x: 20, y: 35 })).toBe(true);
    expect(contains(polygons, { x: 5, y: 20 })).toBe(false);
    expect(s).toEqual(before);
  },
);

it('keeps translated crossing lobes while rejecting collinear and below-area contours', () => {
  for (const origin of [-99900, 99900]) {
    const s: Vector = {
      ...shape(),
      x: origin,
      y: origin,
      fillRule: 'nonzero',
      contours: [
        [
          { x: 0, y: 0 },
          { x: 0.4, y: 0.4 },
          { x: 0, y: 0.4 },
          { x: 0.4, y: 0 },
        ],
      ],
    };
    const result = vectorPolygons(s);
    expect(contains(result, { x: origin + 0.2, y: origin + 0.05 })).toBe(true);
    expect(contains(result, { x: origin + 0.2, y: origin + 0.35 })).toBe(true);
  }
  for (const contours of [
    [
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 0, y: 0 },
      ],
    ],
    [
      [
        { x: 0, y: 0 },
        { x: 0.00001, y: 0 },
        { x: 0.00001, y: 0.00001 },
        { x: 0, y: 0.00001 },
      ],
    ],
  ])
    expect(vectorPolygons({ ...shape(), fillRule: 'nonzero', contours })).toEqual([]);
});

it('resolves many independent nonzero winding groups without quantizing isolated rings', () => {
  const square = (x: number, a: number, b: number) => [
    { x: x + a, y: a },
    { x: x + b, y: a },
    { x: x + b, y: b },
    { x: x + a, y: b },
  ];
  const contours = Array.from({ length: 180 }, (_, i) => [
    square(i * 50, 0, 40),
    square(i * 50, 5, 35),
    square(i * 50, 10, 30).reverse(),
  ]).flat();
  contours.push([
    { x: -10, y: 0 },
    { x: -9.99999, y: 0 },
    { x: -9.99999, y: 20 },
    { x: -10, y: 20 },
  ]);
  const s: Vector = { ...shape(), fillRule: 'nonzero', contours };
  const before = clone(s),
    result = vectorPolygons(s);
  for (let i = 0; i < 180; i++) {
    for (const n of [2, 7, 20]) expect(contains(result, { x: i * 50 + n, y: n })).toBe(true);
    expect(contains(result, { x: i * 50 + 45, y: 20 })).toBe(false);
  }
  expect(contains(result, { x: -9.999995, y: 10 })).toBe(true);
  expect(s).toEqual(before);
});

for (const fillRule of ['nonzero', 'evenodd'] as const)
  it(`resolves self-crossing star winding within one ring (${fillRule})`, () => {
    const vertices = Array.from({ length: 5 }, (_, i) => ({
      x: 50 + 40 * Math.cos((i * 2 * Math.PI) / 5),
      y: 50 + 40 * Math.sin((i * 2 * Math.PI) / 5),
    }));
    const s: Vector = { ...shape(), fillRule, contours: [[0, 2, 4, 1, 3].map((i) => vertices[i])] };
    const before = clone(s);
    expect(contains(vectorPolygons(s), { x: 50, y: 50 })).toBe(fillRule === 'nonzero');
    expect(contains(vectorPolygons(s), { x: 80, y: 50 })).toBe(true);
    const merged = mergeVectors([s]);
    expect(merged.some((r) => contains(vectorPolygons(r), { x: 50, y: 50 }))).toBe(
      fillRule === 'nonzero',
    );
    expect(s).toEqual(before);
  });

for (const origin of [0, -99900, 99900])
  it(`matches independent angular winding for overlapping self-crossing contours at ${origin}`, () => {
    const star = (x: number, reverse: boolean) => {
      const points = Array.from({ length: 7 }, (_, i) => {
        const angle = (((i * 3) % 7) * 2 * Math.PI) / 7;
        return { x: x + 40 * Math.cos(angle), y: 40 * Math.sin(angle) };
      });
      return reverse ? points.reverse() : points;
    };
    const contours = [star(0, false), star(22, true)];
    for (const fillRule of ['evenodd', 'nonzero'] as const) {
      const source: Vector = { ...shape(), x: origin, y: origin, fillRule, contours };
      const before = clone(source);
      const polygons = vectorPolygons(source);
      const merged = mergeVectors([source]).flatMap(vectorPolygons);
      for (let iy = 0; iy < 21; iy++)
        for (let ix = 0; ix < 27; ix++) {
          const p = { x: -45 + ix * 4.13, y: -43 + iy * 4.19 };
          // Integrate directed angle around the query instead of ray crossings.
          let angle = 0,
            near = false;
          for (const ring of contours)
            for (let i = 0; i < ring.length; i++) {
              const a = ring[i],
                b = ring[(i + 1) % ring.length];
              const dx = b.x - a.x,
                dy = b.y - a.y;
              const t = Math.max(
                0,
                Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
              );
              if (Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) < 0.01) near = true;
              const ax = a.x - p.x,
                ay = a.y - p.y,
                bx = b.x - p.x,
                by = b.y - p.y;
              angle += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
            }
          if (near) continue;
          const winding = Math.round(angle / (2 * Math.PI));
          const expected = fillRule === 'evenodd' ? Math.abs(winding) % 2 !== 0 : winding !== 0;
          const world = { x: p.x + origin, y: p.y + origin };
          expect(contains(polygons, world)).toBe(expected);
          expect(contains(merged, world)).toBe(expected);
        }
      expect(source).toEqual(before);
    }
  });

it('cancels twice-traced even-odd paint while retaining nonzero paint', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 30 },
    { x: 0, y: 30 },
  ];
  for (const fillRule of ['evenodd', 'nonzero'] as const) {
    const source: Vector = { ...shape(), fillRule, contours: [[...points, ...points]] };
    expect(contains(vectorPolygons(source), { x: 15, y: 15 })).toBe(fillRule === 'nonzero');
  }
});

it('applies self-crossing parity to point-based closed polygons too', () => {
  const points = Array.from({ length: 5 }, (_, i) => {
    const angle = (((i * 2) % 5) * 2 * Math.PI) / 5;
    return { x: 50 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) };
  });
  const source: Vector = { ...shape(), contours: undefined, points };
  expect(contains(vectorPolygons(source), { x: 50, y: 50 })).toBe(false);
  expect(contains(vectorPolygons(source), { x: 80, y: 50 })).toBe(true);
});

import { describe, expect, it } from 'vitest';
import { id, type Vector } from '../packages/document/src';
import { contains, mergeVectors, vectorPolygons } from '../packages/geometry/src/merge';
import { hit, worldPoint, transformVectors, around, localPoint } from '../packages/geometry/src';
import { worldStrokePolygons } from '../packages/geometry/src/strokes';
import { eraseVectors } from '../packages/geometry/src/erase';
const rect = (x: number, y: number, width: number, height: number, fill = '#ff0000'): Vector => ({
  id: id(),
  kind: 'rectangle',
  x,
  y,
  width,
  height,
  rotation: 0,
  fill,
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
const line = (x1: number, y1: number, x2: number, y2: number): Vector => ({
  ...rect(0, 0, 100, 100),
  kind: 'line',
  fillEnabled: false,
  strokeWidth: 2,
  points: [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ],
});
const surface = (s: Vector) =>
  vectorPolygons(s).reduce(
    (sum, poly) =>
      sum +
      poly.reduce((value, ring, index) => {
        const a = Math.abs(
          ring.reduce((n, p, i) => {
            const q = ring[(i + 1) % ring.length];
            return n + p[0] * q[1] - q[0] * p[1];
          }, 0) / 2,
        );
        return value + (index ? -a : a);
      }, 0),
    0,
  );
describe('planar merge drawing faces and stroke spans', () => {
  it('retains isolated strokes exactly while rebuilding and tracking a mixed component', () => {
    const paint = rect(0, 0, 30, 30);
    const crossing: Vector = { ...line(-5, 15, 35, 15), kind: 'path', drawingMode: 'merge' };
    const isolated: Vector = { ...crossing, id: id(), y: 100, groups: [] };
    const input = [paint, isolated, crossing];
    const original = structuredClone(input);
    const rebuilt = new Set<string>();
    const result = mergeVectors(input, undefined, true, {
      original: new Set([crossing.id, isolated.id]), rebuilt,
    });
    const final = result.at(-1)!;
    expect(final).toEqual({ ...isolated, drawingMode: 'merge' });
    expect(final.groups).not.toBe(isolated.groups);
    expect(result.filter(s => s.fillEnabled !== false)).toHaveLength(2);
    expect(result.filter(s => s.fillEnabled === false)).toHaveLength(4);
    expect(rebuilt).toEqual(new Set(result.filter(s => s.fillEnabled === false).map(s => s.id)));
    expect(input).toEqual(original);
  });

  it('retains different editable brightness on adjacent fills and connected Pencil spans', () => {
    const fills=mergeVectors([rect(0,0,10,10),{...rect(10,0,10,10),paintBrightness:-.5}]);
    expect(fills.map(s=>s.paintBrightness??0).sort()).toEqual([-.5,0]);
    const strokes=mergeVectors([line(0,0,10,0),{...line(10,0,20,0),paintBrightness:.5}]);
    expect(strokes.map(s=>s.paintBrightness??0).sort()).toEqual([0,.5]);
  });
  it('preserves affine gradient coordinates and pivots through repeated region rebuilding', () => {
    const s = rect(0, 0, 100, 100);
    s.gradient = {
      kind: 'radial',
      from: { x: 25, y: 25 },
      to: { x: 75, y: 25 },
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    s.pivot = { x: 50, y: 50 };
    transformVectors([s], around({ x: 0, y: 0 }, 2, 0.2, 0.7, 1));
    const sample = worldPoint(s, { x: 40, y: 30 });
    const result = mergeVectors(mergeVectors([s]));
    expect(result).toHaveLength(1);
    const out = result[0],
      p = localPoint(out, sample);
    expect(p.x - out.gradient!.from.x).toBeCloseTo(15);
    expect(p.y - out.gradient!.from.y).toBeCloseTo(5);
    expect(worldPoint(out, out.pivot!)).toEqual(worldPoint(s, s.pivot));
    expect(surface(out)).toBeCloseTo(surface(s));
  });
  it('retains affine stroke thickness and cap styles through repeated rebuilding', () => {
    const s = line(0, 0, 100, 0);
    s.strokeWidth = 20;
    s.strokeCap = 'square';
    transformVectors([s], around({ x: 0, y: 0 }, 2, 0, 0.5, 3));
    const result = mergeVectors(mergeVectors([s]));
    expect(result).toHaveLength(1);
    expect(result[0].strokeCap).toBe('square');
    expect(worldStrokePolygons(result[0])).toEqual(worldStrokePolygons(s));
  });
  it('splits intersecting affine stroke spans in their own coordinate systems', () => {
    const a = line(0, 0, 100, 0),
      b = line(0, 0, 0, 100);
    a.strokeWidth = 12;
    transformVectors([a], around({ x: 0, y: 0 }, 2, 0, 0.5, 3));
    b.x = 100;
    b.y = -50;
    const result = mergeVectors([a, b]);
    expect(result).toHaveLength(4);
    const spans = result.filter((s) => s.strokeWidth === 12);
    expect(spans).toHaveLength(2);
    expect(
      spans.every((s) =>
        s.points.some(
          (p) => Math.abs(worldPoint(s, p).x - 100) < 1e-6 && Math.abs(worldPoint(s, p).y) < 1e-6,
        ),
      ),
    ).toBe(true);
    const cut = eraseVectors(result, [{ x: 40, y: 15 }], 4, 'strokes');
    expect(cut.some((s) => hit(s, { x: 40, y: 15 }, 0))).toBe(false);
    expect(cut.some((s) => hit(s, { x: 40, y: 0 }, 0))).toBe(true);
    expect(cut.some((s) => hit(s, { x: 20, y: 0 }, 0))).toBe(true);
    expect(cut.every(s => s.strokeWidth > 0 && s.fillEnabled === false)).toBe(true);
  });
  it('unifies touching same-color fills rather than stacking two objects', () => {
    const result = mergeVectors([rect(0, 0, 100, 100), rect(50, 0, 100, 100)]);
    expect(result).toHaveLength(1);
    expect(surface(result[0])).toBeCloseTo(15000);
    expect(result[0].drawingMode).toBe('merge');
  });
  it('cuts the covered region out of an earlier differently-colored fill', () => {
    const result = mergeVectors([rect(0, 0, 100, 100), rect(50, 0, 100, 100, '#0000ff')]);
    const red = result.find((s) => s.fill === '#ff0000')!,
      blue = result.find((s) => s.fill === '#0000ff')!;
    expect(surface(red)).toBeCloseTo(5000);
    expect(surface(blue)).toBeCloseTo(10000);
    expect(hit(red, { x: 75, y: 50 }, 0)).toBe(false);
    expect(hit(blue, { x: 75, y: 50 }, 0)).toBe(true);
  });
  it('represents a surrounded fill as an actual hole in the older face', () => {
    const result = mergeVectors([rect(0, 0, 100, 100), rect(30, 30, 40, 40, '#0000ff')]);
    const red = result.find((s) => s.fill === '#ff0000')!;
    expect(red.contours).toHaveLength(2);
    expect(surface(red)).toBeCloseTo(8400);
    expect(hit(red, { x: 50, y: 50 }, 0)).toBe(false);
  });
  it('splits crossing strokes into independently selectable spans', () => {
    const result = mergeVectors([line(0, 50, 100, 50), line(50, 0, 50, 100)]);
    expect(result).toHaveLength(4);
    expect(result.every((s) => s.kind === 'path' && !s.fillEnabled)).toBe(true);
  });
  it('gives repeated cuts at one junction a single vertex and keeps each adjacent span', () => {
    const lines = [
      { ...line(0, 25, 100, 25), stroke: '#aa0000' },
      { ...line(50, 0, 50, 50), stroke: '#00aa00' },
      { ...line(0, 0, 100, 50), stroke: '#0000aa' },
      { ...line(75, 0, 75, 50), stroke: '#aaaa00' },
    ];
    const result = mergeVectors(lines);
    expect(result.every(s => s.kind === 'path' && s.fillEnabled === false)).toBe(true);
    const spans = (stroke: string) => result.filter(s => s.stroke === stroke).map(
      s => s.points.map(p => worldPoint(s, p)).map(p => `${p.x},${p.y}`).sort().join(':'),
    ).sort();
    expect(spans('#aa0000')).toEqual(['0,25:50,25', '100,25:75,25', '50,25:75,25']);
    expect(spans('#00aa00')).toEqual(['50,0:50,25', '50,25:50,50']);
    expect(spans('#0000aa')).toEqual(['0,0:50,25', '100,50:75,37.5', '50,25:75,37.5']);
    expect(spans('#aaaa00')).toEqual(['75,0:75,25', '75,25:75,37.5', '75,37.5:75,50']);
  });
  it('a crossing stroke divides a fill into independently selectable faces', () => {
    const result = mergeVectors([rect(0, 0, 100, 100), line(-20, 50, 120, 50)]);
    const faces = result.filter((s) => s.kind === 'polygon');
    expect(faces).toHaveLength(2);
    expect(faces.map(surface).sort()).toEqual([5000, 5000]);
    expect(result.filter((s) => s.kind === 'path')).toHaveLength(3);
  });
  it('keeps separated islands separate and survives rebuilding the resulting editable model', () => {
    const input = [rect(0, 0, 20, 20), rect(80, 0, 20, 20)];
    const result = mergeVectors(input);
    expect(result).toHaveLength(2);
    expect(mergeVectors(result).map(surface)).toEqual([400, 400]);
  });
});
describe('vector paint erasure', () => {
  it('cuts an actual editable hole while preserving the surrounding fill', () => {
    const s = rect(0, 0, 100, 100);
    const result = eraseVectors([s], [{ x: 50, y: 50 }], 10, 'fills');
    expect(result).toHaveLength(1);
    expect(result[0].contours).toHaveLength(2);
    expect(hit(result[0], { x: 50, y: 50 }, 0)).toBe(false);
    expect(hit(result[0], { x: 20, y: 50 }, 0)).toBe(true);
    expect(surface(result[0])).toBeGreaterThan(9680);
    expect(surface(result[0])).toBeLessThan(9700);
  });
  it('does not change unrelated geometry or stroke-only erasure of a fill', () => {
    const s = rect(0, 0, 100, 100);
    expect(eraseVectors([s], [{ x: 200, y: 200 }], 10, 'all')[0]).toBe(s);
    expect(eraseVectors([s], [{ x: 50, y: 50 }], 10, 'strokes')[0]).toBe(s);
  });
  it('cuts a pressure brush silhouette into two filled vector fragments', () => {
    const s: Vector = {
      ...rect(0, 0, 100, 10),
      kind: 'brush',
      strokeWidth: 20,
      points: [
        { x: 0, y: 50, pressure: 1 },
        { x: 100, y: 50, pressure: 1 },
      ],
      brush: { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 },
    };
    const result = eraseVectors(
      [s],
      [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      10,
      'all',
    );
    expect(result).toHaveLength(2);
    expect(result.every((v) => v.kind === 'polygon')).toBe(true);
    expect(result.some((v) => hit(v, { x: 50, y: 50 }, 0))).toBe(false);
  });
});

it('merges fill-only contours beyond the stroke-arrangement edge budget', () => {
  const circle: Vector = {
    ...rect(0, 0, 100, 100),
    kind: 'polygon',
    closed: true,
    contours: [
      Array.from({ length: 4200 }, (_, i) => ({
        x: 50 + 50 * Math.cos((i * Math.PI * 2) / 4200),
        y: 50 + 50 * Math.sin((i * Math.PI * 2) / 4200),
      })),
    ],
  };
  const result = mergeVectors([circle, rect(45, 45, 20, 20)]);
  expect(result).toHaveLength(1);
  expect(result[0].drawingMode).toBe('merge');
  expect(hit(result[0], { x: 50, y: 50 }, 0)).toBe(true);
});

it('coalesces adjacent paint runs without bridging an intervening color or opacity', () => {
  const input = [
    rect(0, 0, 100, 100),
    rect(20, 0, 100, 100),
    rect(30, 20, 50, 50, '#0000ff'),
    rect(60, 40, 50, 50),
    rect(100, 40, 40, 50),
  ];
  input[4].opacity = 0.5;
  const before = structuredClone(input),
    result = mergeVectors(input);
  for (const [x, y, color, opacity] of [
    [10, 10, '#ff0000', 1],
    [40, 30, '#0000ff', 1],
    [70, 50, '#ff0000', 1],
    [130, 50, '#ff0000', 0.5],
  ] as const) {
    const found = result.find((s) => hit(s, { x, y }, 0));
    expect(found?.fill).toBe(color);
    expect(found?.opacity ?? 1).toBe(opacity);
  }
  expect(input).toEqual(before);
});

it('merges dense paint with crossing linework beyond the former edge cap', () => {
  const count = 6000;
  const paint: Vector = {
    ...rect(0, 0, 200, 200),
    kind: 'polygon',
    closed: true,
    points: Array.from({ length: count }, (_, i) => ({
      x: 100 + 100 * Math.cos((i * 2 * Math.PI) / count),
      y: 100 + 100 * Math.sin((i * 2 * Math.PI) / count),
    })),
  };
  const input = [paint, line(-10, 100, 210, 100)];
  const before = JSON.stringify(input);
  const result = mergeVectors(input);
  expect(result.filter((s) => s.fillEnabled !== false)).toHaveLength(2);
  expect(result.filter((s) => s.strokeWidth)).toHaveLength(3);
  expect(result.reduce((sum, s) => sum + surface(s), 0)).toBeCloseTo(surface(paint), 4);
  expect(JSON.stringify(input)).toBe(before);
});

it.each([false, true])(
  'retains more than 20,000 line segments without an arrangement cap (vertical %s)',
  (vertical) => {
    const count = 21000;
    const shape: Vector = {
      ...line(0, 0, 1, 1),
      kind: 'path',
      points: Array.from({ length: count + 1 }, (_, i) =>
        vertical ? { x: i % 2, y: i } : { x: i, y: i % 2 },
      ),
    };
    const result = mergeVectors([shape]);
    expect(result).toHaveLength(1);
    expect(result[0].points).toHaveLength(count + 1);
    expect(result[0].strokeWidth).toBe(2);
    expect(result[0].fillEnabled).toBe(false);
  },
);

it('expands a long editable stroke beyond 4096 segments without losing its paint', () => {
  const shape: Vector = {
    ...line(0, 0, 6000, 0),
    kind: 'path',
    strokeCap: 'butt',
    strokeJoin: 'bevel',
    points: Array.from({ length: 6001 }, (_, x) => ({ x, y: 0 })),
  };
  const polygons = worldStrokePolygons(shape);
  expect(polygons).toHaveLength(1);
  const xs = polygons[0][0].map((p) => p[0]),
    ys = polygons[0][0].map((p) => p[1]);
  expect(Math.min(...xs)).toBe(0);
  expect(Math.max(...xs)).toBe(6000);
  expect(Math.min(...ys)).toBe(-1);
  expect(Math.max(...ys)).toBe(1);
});

it('retains small fill rings at large positive and negative document origins', () => {
  for (const origin of [0, 50000, -50000, 99900, -99900]) {
    const source = rect(origin, origin, 0.001, 0.001);
    const before = structuredClone(source);
    const polygons = vectorPolygons(source);
    expect(polygons, `origin ${origin}`).toHaveLength(1);
    const merged = mergeVectors([source]);
    expect(merged, `merged origin ${origin}`).toHaveLength(1);
    const ring = vectorPolygons(merged[0])[0][0];
    const xs = ring.map((p) => p[0] - origin),
      ys = ring.map((p) => p[1] - origin);
    expect(Math.min(...xs)).toBeCloseTo(0, 7);
    expect(Math.max(...xs)).toBeCloseTo(0.001, 7);
    expect(Math.min(...ys)).toBeCloseTo(0, 7);
    expect(Math.max(...ys)).toBeCloseTo(0.001, 7);
    expect(source).toEqual(before);
  }
});

it('preserves translated small holes and winding through merge normalization', () => {
  for (const origin of [0, -99900, 99900]) {
    const source = rect(origin, origin, 0.01, 0.01);
    source.kind = 'polygon';
    source.fillRule = 'evenodd';
    source.contours = [
      [
        { x: 0, y: 0 },
        { x: 0.01, y: 0 },
        { x: 0.01, y: 0.01 },
        { x: 0, y: 0.01 },
      ],
      [
        { x: 0.003, y: 0.003 },
        { x: 0.003, y: 0.007 },
        { x: 0.007, y: 0.007 },
        { x: 0.007, y: 0.003 },
      ],
    ];
    for (const reverse of [false, true]) {
      if (reverse) source.contours.forEach((r) => r.reverse());
      const polygons = vectorPolygons(source);
      expect(polygons).toHaveLength(1);
      expect(polygons[0]).toHaveLength(2);
      const merged = mergeVectors([source]);
      expect(merged).toHaveLength(1);
      expect(vectorPolygons(merged[0])[0]).toHaveLength(2);
    }
  }
});

it('splits tiny crossing strokes at their actual intersection instead of treating them as collinear', () => {
  for (const scale of [0.0001, 0.001, 1]) {
    const a = line(0, 0, scale, 0),
      b = line(0.25 * scale, -0.25 * scale, 0.75 * scale, 0.75 * scale);
    a.strokeWidth = b.strokeWidth = scale / 10;
    const result = mergeVectors([a, b]);
    expect(result, `scale ${scale}`).toHaveLength(4);
    const center = { x: 0.375 * scale, y: 0 };
    for (const span of result) {
      const points = span.points.map((p) => worldPoint(span, p));
      expect(points.some((p) => Math.hypot(p.x - center.x, p.y - center.y) < 1e-8)).toBe(true);
    }
  }
});

it('keeps parallel tiny strokes separate and partitions genuinely collinear overlap', () => {
  const a = line(0, 0, 0.0001, 0),
    b = line(0.000025, 0.00001, 0.000075, 0.00001);
  a.strokeWidth = b.strokeWidth = 0.000001;
  b.stroke = '#ff0000';
  const before = structuredClone([a, b]);
  const separate = mergeVectors([a, b]);
  expect(separate).toHaveLength(2);
  expect([a, b]).toEqual(before);
  b.points.forEach((p) => {
    p.y = 0;
  });
  const overlap = mergeVectors([a, b]);
  expect(overlap).toHaveLength(3);
  expect(overlap.filter((s) => s.stroke === '#ff0000')).toHaveLength(1);
});

it('retains narrow filled faces when unrelated linework requires arrangement normalization', () => {
  for (const height of [0.00001, 0.001, 1]) {
    const fill = rect(0, 0, 100, height);
    const result = mergeVectors([fill, line(200, 0, 200, 10)]);
    expect(
      result.filter((s) => s.fillEnabled !== false && s.strokeWidth === 0),
      `height ${height}`,
    ).toHaveLength(1);
  }
});

it('samples adjacent narrow faces without taking the neighboring paint at distant origins', () => {
  for (const origin of [0, 50000, -50000]) {
    const height = 0.00001;
    const red = rect(origin, origin, 100, height, '#ff0000');
    const blue = rect(origin, origin + height, 100, height, '#0000ff');
    const input = [red, blue, line(origin + 200, origin, origin + 200, origin + 10)];
    const before = structuredClone(input);
    const result = mergeVectors(input);
    for (const [y, color] of [
      [height / 2, '#ff0000'],
      [height * 1.5, '#0000ff'],
    ] as const) {
      const owners = result.filter((s) =>
        contains(vectorPolygons(s), { x: origin + 50, y: origin + y }),
      );
      expect(owners.map((s) => s.fill)).toEqual([color]);
    }
    expect(input).toEqual(before);
  }
});

it('resolves indexed face paint in source order while preserving holes and distant islands', () => {
  const islands = Array.from({ length: 160 }, (_, i) =>
    rect(i * 30, 0, 20, 20, i % 2 ? '#0000ff' : '#ff0000'),
  );
  const cover = rect(0, 0, 10, 10, '#00ff00');
  const donut: Vector = {
    ...rect(0, 0, 20, 20, '#ffff00'),
    kind: 'polygon',
    fillRule: 'evenodd',
    closed: true,
    contours: [
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      [
        { x: 4, y: 4 },
        { x: 4, y: 16 },
        { x: 16, y: 16 },
        { x: 16, y: 4 },
      ],
    ],
  };
  const input = [...islands, cover, donut, line(-10, -10, -5, -5)];
  const before = structuredClone(input);
  const result = mergeVectors(input);
  const paint = (x: number, y: number) =>
    result.filter((s) => contains(vectorPolygons(s), { x, y })).map((s) => s.fill);
  expect(paint(2, 2)).toEqual(['#ffff00']);
  expect(paint(6, 6)).toEqual(['#00ff00']);
  expect(paint(12, 12)).toEqual(['#ff0000']);
  expect(paint(25, 10)).toEqual([]);
  for (let i = 1; i < islands.length; i++)
    expect(paint(i * 30 + 10, 10)).toEqual([islands[i].fill]);
  expect(input).toEqual(before);
});

it('assigns nested same-paint holes to the nearest containing face among distant compounds', () => {
  const square = (low: number, high: number) => [
    { x: low, y: low },
    { x: high, y: low },
    { x: high, y: high },
    { x: low, y: high },
  ];
  const compound: Vector = {
    ...rect(0, 0, 100, 100),
    kind: 'polygon',
    fillRule: 'evenodd',
    closed: true,
    contours: [square(0, 100), square(10, 90), square(20, 80), square(30, 70), square(40, 60)],
  };
  const input = [
    ...Array.from({ length: 60 }, (_, i) => ({
      ...structuredClone(compound),
      id: 'nested-' + i,
      x: i * 120,
    })),
    line(-10, -10, -5, -5),
  ];
  const before = structuredClone(input);
  const result = mergeVectors(input);
  const polygons = result.filter((s) => s.fillEnabled !== false).map(shape => vectorPolygons(shape));
  for (let i = 0; i < 60; i++) {
    for (const [offset, expected] of [
      [5, true],
      [15, false],
      [25, true],
      [35, false],
      [50, true],
      [105, false],
    ] as const)
      expect(polygons.some((p) => contains(p, { x: i * 120 + offset, y: offset }))).toBe(expected);
  }
  expect(input).toEqual(before);
});

it('merges a long chain of adjacent same-paint faces without recursive stack exhaustion', () => {
  const input = Array.from({ length: 12000 }, (_, i) => rect(i, 0, 1, 1));
  input.push(line(-10, -10, -5, -5));
  const before = structuredClone(input);
  const result = mergeVectors(input);
  expect(input).toEqual(before);
  const fills = result.filter((s) => s.fillEnabled !== false);
  expect(fills).toHaveLength(1);
  expect(contains(vectorPolygons(fills[0]), { x: 0.5, y: 0.5 })).toBe(true);
  expect(contains(vectorPolygons(fills[0]), { x: 11999.5, y: 0.5 })).toBe(true);
}, 60000);

it('preserves pure-fill occlusion across distant alternating paints and overlapping holed runs', () => {
  const input = Array.from({ length: 160 }, (_, i) =>
    rect(i * 30, 0, 20, 20, i % 2 ? '#00ff00' : '#ff0000'),
  );
  const ring = (lo: number, hi: number) => [
    { x: lo, y: lo },
    { x: hi, y: lo },
    { x: hi, y: hi },
    { x: lo, y: hi },
  ];
  input.push({
    ...rect(0, 0, 20, 20, '#0000ff'),
    kind: 'polygon',
    closed: true,
    fillRule: 'evenodd',
    contours: [ring(0, 20), ring(5, 15)],
  });
  input.push(rect(10, 0, 25, 10, '#ffff00'));
  const before = structuredClone(input),
    result = mergeVectors(input);
  const paint = (x: number, y: number) =>
    result.filter((s) => contains(vectorPolygons(s), { x, y })).map((s) => s.fill);
  expect(paint(2, 2)).toEqual(['#0000ff']);
  expect(paint(7, 7)).toEqual(['#ff0000']);
  expect(paint(12, 7)).toEqual(['#ffff00']);
  expect(paint(32, 7)).toEqual(['#ffff00']);
  expect(paint(32, 15)).toEqual(['#00ff00']);
  expect(paint(25, 15)).toEqual([]);
  for (let i = 2; i < 160; i++) expect(paint(i * 30 + 10, 10)).toEqual([input[i].fill]);
  expect(input).toEqual(before);
});

it.each([0, -99900, 99900])(
  'matches analytic stacked rectangle/hole ownership at origin %s',
  (origin) => {
    let seed = 314159;
    const next = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
    const records = Array.from({ length: 72 }, (_, i) => ({
      x: next(36),
      y: next(36),
      w: 8 + next(20),
      h: 8 + next(20),
      hole: i % 3 === 0,
      fill: colors[Math.floor(i / 3) % colors.length],
    }));
    const input = records.map((r) => {
      const shape = rect(origin + r.x, origin + r.y, r.w, r.h, r.fill);
      if (!r.hole) return shape;
      const ring = (inset: number) => [
        { x: inset, y: inset },
        { x: r.w - inset, y: inset },
        { x: r.w - inset, y: r.h - inset },
        { x: inset, y: r.h - inset },
      ];
      return {
        ...shape,
        kind: 'polygon' as const,
        closed: true,
        fillRule: 'evenodd' as const,
        contours: [ring(0), ring(2)],
      };
    });
    const before = structuredClone(input);
    const result = mergeVectors(input);
    // Independent rectangular inequalities determine source paint; no clipping or
    // production point-in-polygon predicate participates in this oracle.
    for (const output of [result, mergeVectors(result)]) {
      const polygons = output.map((shape) => ({
        fill: shape.fill,
        polygons: vectorPolygons(shape),
      }));
      for (let y = 0.375; y < 64; y += 1)
        for (let x = 0.375; x < 64; x += 1) {
          let expected: string | undefined;
          for (const r of records) {
            const dx = x - r.x,
              dy = y - r.y;
            const inside = dx > 0 && dx < r.w && dy > 0 && dy < r.h;
            const hole = r.hole && dx > 2 && dx < r.w - 2 && dy > 2 && dy < r.h - 2;
            if (inside && !hole) expected = r.fill;
          }
          const actual = polygons
            .filter((p) => contains(p.polygons, { x: origin + x, y: origin + y }))
            .map((p) => p.fill);
          expect(actual, `paint at ${x}, ${y}`).toEqual(expected ? [expected] : []);
        }
    }
    expect(input).toEqual(before);
  },
);

it('joins adjacent visible paint from many nonconsecutive source runs once', () => {
  const input: Vector[] = [];
  for (let i = 0; i < 192; i++) {
    input.push(rect(i, 0, 1, 10));
    input.push(rect(i * 3, 30, 1, 1, '#0000ff'));
  }
  const before = structuredClone(input);
  const result = mergeVectors(input);
  const red = result.filter((shape) => shape.fill === '#ff0000');
  expect(red).toHaveLength(1);
  expect(surface(red[0])).toBeCloseTo(1920);
  for (let i = 0; i < 192; i++) {
    expect(contains(vectorPolygons(red[0]), { x: i + 0.5, y: 5 })).toBe(true);
    expect(
      result
        .filter((shape) => contains(vectorPolygons(shape), { x: i * 3 + 0.5, y: 30.5 }))
        .map((shape) => shape.fill),
    ).toEqual(['#0000ff']);
  }
  expect(input).toEqual(before);
});

it('unions a long consecutive paint run before applying later paint and holes', () => {
  const input = Array.from({ length: 513 }, (_, i) => rect(i, 0, 2, 20));
  const ring = (left: number, top: number, right: number, bottom: number) => [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  input.push({
    ...rect(0, 0, 514, 20, '#0000ff'),
    kind: 'polygon',
    closed: true,
    fillRule: 'evenodd',
    contours: [ring(200, 0, 300, 20), ring(210, 5, 290, 15)],
  });
  const before = structuredClone(input);
  const result = mergeVectors(input);
  const painted = result.map((shape) => ({ fill: shape.fill, polygons: vectorPolygons(shape) }));
  const paint = (x: number, y: number) =>
    painted.filter((p) => contains(p.polygons, { x, y })).map((p) => p.fill);
  for (let x = 0.5; x < 514; x++) {
    expect(paint(x, 2)).toEqual([x > 200 && x < 300 ? '#0000ff' : '#ff0000']);
    expect(paint(x, 10)).toEqual([
      x > 200 && x < 300 && !(x > 210 && x < 290) ? '#0000ff' : '#ff0000',
    ]);
  }
  expect(paint(514.5, 10)).toEqual([]);
  expect(input).toEqual(before);
});

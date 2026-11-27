import { createRequire } from 'node:module';
const floating = createRequire(new URL('../packages/geometry/package.json', import.meta.url))(
  'polygon-clipping',
) as Record<'union' | 'difference' | 'intersection' | 'xor', (...args: unknown[]) => unknown>;
import { expect, it, vi } from 'vitest';
import clipping, { CollapsedIntersectionContour, integerPaint, withSelectionClipping, evenOddPaint, nonzeroPaint } from '../packages/geometry/src/paint-clipping';
import { strokeToFill } from '../packages/geometry/src/strokes';
import { narrowFixtureBrush } from './narrow-arrangement-fixture';
import { mergeSelectedArtwork } from '../packages/geometry/src/merge-selection';
import { clipPaint, deletePaintRegion, selectPaintRegion } from '../packages/geometry/src/clip-paint';
import { contains, mergeVectors, vectorPolygons } from '../packages/geometry/src/merge';
import type { Vector } from '../packages/document/src';
type Polygon = [number, number][][];
const box = (a: number, b: number): Polygon => [
  [
    [a, a],
    [b, a],
    [b, b],
    [a, b],
    [a, a],
  ],
];
it('recovers the floating sweep consumed-segment null error during selection', () => {
  const failure = () => {
    function afterState() { throw new TypeError("Cannot read properties of null (reading 'length')"); }
    return afterState();
  };
  const spy = vi.spyOn(floating, 'intersection').mockImplementation(failure);
  try {
    const result = withSelectionClipping(() => clipping.intersection(box(0, 20), box(10, 30)));
    expect(contains(result, { x: 15, y: 15 })).toBe(true);
    expect(contains(result, { x: 5, y: 5 })).toBe(false);
    spy.mockImplementation(() => { throw new TypeError("Cannot read properties of null (reading 'length')"); });
    expect(() => withSelectionClipping(() => clipping.intersection(box(0, 20), box(10, 30)))).toThrow(TypeError);
  } finally { spy.mockRestore(); }
});
it('retries a sweep-state stack overflow with the selection budget and propagates unrelated stack errors', () => {
  function beforeState() { throw new RangeError('Maximum call stack size exceeded'); }
  const spy = vi.spyOn(floating, 'intersection').mockImplementation(beforeState);
  try {
    const result = withSelectionClipping(() => clipping.intersection(box(0, 20), box(10, 30)));
    expect(contains(result, { x: 15, y: 15 })).toBe(true);
    expect(contains(result, { x: 5, y: 5 })).toBe(false);
    const dense = [Array.from({ length: 2000 }, (_, i): [number, number] =>
      i % 2 ? [20 + i / 2000, 20] : [0, i / 2000])];
    expect(() => withSelectionClipping(() => clipping.intersection(dense, box(10, 30)))).toThrow(/smaller region/);
    spy.mockImplementation(() => { throw new RangeError('Maximum call stack size exceeded'); });
    expect(() => withSelectionClipping(() => clipping.intersection(box(0, 20), box(10, 30)))).toThrow(RangeError);
  } finally { spy.mockRestore(); }
});
it('uses a finer grid for a thin nonzero hole during selection without changing its winding', () => {
  const paint: Vector = { id: 'thin-hole', kind: 'polygon', x: 0, y: 0, rotation: 0,
    width: 100, height: 100, points: [], strokeWidth: 0, stroke: '#000000', fill: '#ff0000', fillRule: 'nonzero',
    contours: [box(0, 100)[0].slice(0, -1).map(([x, y]) => ({ x, y })),
      [{ x: 30, y: 20 }, { x: 30, y: 80 }, { x: 30.00002, y: 80 }, { x: 30.00002, y: 20 }]] };
  const original = structuredClone(paint);
  expect(() => vectorPolygons(paint)).toThrow('Nonzero paint contour collapses');
  const region = selectPaintRegion([paint], { mode: 'replace', current: [],
    polygon: box(-10, 110)[0].slice(0, -1).map(([x, y]) => ({ x, y })) }, [paint.id]);
  expect(contains(region, { x: 30.00001, y: 50 })).toBe(false);
  expect(contains(region, { x: 29.99, y: 50 })).toBe(true);
  expect(paint).toEqual(original);
  const unresolvable = structuredClone(paint);
  unresolvable.contours![1][2].x = unresolvable.contours![1][3].x = 30.00000003;
  // An exact shared edge is a resolvable notch. Crossing the exterior at
  // two distinct points still requires preserving the original narrow fill.
  unresolvable.contours![1][0].y = unresolvable.contours![1][3].y = -1;
  const crossing = deletePaintRegion([unresolvable], [box(5, 50)], [paint.id]);
  expect(crossing).toEqual({ changed: false, artwork: [unresolvable], preserved: 1 });
  expect(crossing.artwork[0]).toBe(unresolvable);
  expect(deletePaintRegion([unresolvable], [box(-10, 110)], [paint.id])).toEqual({ changed: true, artwork: [] });
});
it('recovers exact separated nonzero boundaries without treating nested same-winding rings as holes', () => {
  const narrow = (left: number, right: number, top: number, bottom: number): Polygon[number] =>
    [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]];
  const outer = box(0, 100)[0], hole = narrow(30, 30.00000008, 10, 90).reverse();
  const island = narrow(30.00000002, 30.00000006, 20, 80);
  const redundant = narrow(30.00000003, 30.00000005, 30, 70);
  const contours = [redundant, hole, outer, island];
  const before = structuredClone(contours);
  const recovered = withSelectionClipping(() => nonzeroPaint(contours));
  expect(recovered).toEqual([[outer, hole], [island]]);
  expect(recovered[0][1][0]).not.toBe(hole[0]);
  expect(contours).toEqual(before);
  const notch = withSelectionClipping(() => nonzeroPaint([outer, narrow(30, 30.00000008, 0, 90).reverse()]));
  expect(contains(notch, {x:30.00000004,y:50})).toBe(false);
  expect(contains(notch, {x:29.99,y:50})).toBe(true);
  expect(() => withSelectionClipping(() => nonzeroPaint([outer, narrow(30, 30.00000008, -1, 90).reverse()]))).toThrow(/collapses/);
});
it('retains holes and nested islands with either winding', () => {
  const hole = box(3, 7)[0];
  const result = integerPaint('union', [box(0, 10)[0].slice().reverse(), hole], box(4, 6));
  expect(contains(result, { x: 1, y: 1 })).toBe(true);
  expect(contains(result, { x: 3.5, y: 3.5 })).toBe(false);
  expect(contains(result, { x: 5, y: 5 })).toBe(true);
  expect(result).toHaveLength(2);
});
it('cuts paint without filling the cut, and handles empty input', () => {
  const result = integerPaint('difference', box(0, 10), box(3, 7));
  expect(result[0]).toHaveLength(2);
  expect(contains(result, { x: 5, y: 5 })).toBe(false);
  expect(integerPaint('union', [])).toEqual([]);
  expect(integerPaint('difference', box(0, 10), box(0, 10))).toEqual([]);
  expect(() =>
    integerPaint('union', [
      [
        [Infinity, 0],
        [0, 1],
        [1, 0],
      ],
    ]),
  ).toThrow(/precision/);
});

it('retries polygon ring recursion failures but propagates unrelated errors', () => {
  const spy = vi.spyOn(floating, 'union');
  try {
    const error = new RangeError('Maximum call stack size exceeded');
    error.stack =
      'RangeError: Maximum call stack size exceeded\n at RingOut.isExteriorRing (polygon-clipping.js:1:1)';
    spy.mockImplementationOnce(() => {
      throw error;
    });
    expect(contains(clipping.union(box(0, 10), box(4, 12)), { x: 11, y: 11 })).toBe(true);
    const unrelated = new RangeError('Maximum call stack size exceeded');
    unrelated.stack = 'at unrelatedFunction';
    spy.mockImplementationOnce(() => {
      throw unrelated;
    });
    expect(() => clipping.union(box(0, 10))).toThrow(unrelated);
  } finally {
    spy.mockRestore();
  }
});

it('batches parity without losing nested islands, overlapping rings or repeated rings across batches', () => {
  const rings = [
    box(0, 20),
    [box(3, 17)[0].slice().reverse()],
    box(6, 14),
    box(9, 11),
    box(15, 25),
  ];
  const oracle = rings.reduce(
    (r, p) => clipping.union(clipping.difference(r, p), clipping.difference(p, r)),
    [] as ReturnType<typeof evenOddPaint>,
  );
  const fast = evenOddPaint(rings);
  for (let x = 0.5; x < 26; x++)
    for (let y = 0.5; y < 26; y++)
      expect(contains(fast, { x, y })).toBe(contains(oracle, { x, y }));
  const repeated = Array.from({ length: 129 }, () => box(0, 10));
  expect(contains(evenOddPaint(repeated), { x: 5, y: 5 })).toBe(true);
  repeated.push(box(0, 10));
  expect(evenOddPaint(repeated)).toEqual([]);
  expect(evenOddPaint([])).toEqual([]);
});
it('falls back to sequential parity for recognized XOR faults without swallowing unrelated failures', () => {
  const spy = vi.spyOn(floating, 'xor');
  try {
    spy.mockImplementationOnce(() => {
      throw Error('Unable to complete output ring');
    });
    const out = evenOddPaint([box(0, 20), box(3, 17), box(6, 14)]);
    expect(contains(out, { x: 1, y: 1 })).toBe(true);
    expect(contains(out, { x: 4, y: 4 })).toBe(false);
    expect(contains(out, { x: 7, y: 7 })).toBe(true);
    spy.mockImplementationOnce(() => {
      throw Error('unrelated');
    });
    expect(() => evenOddPaint([box(0, 10)])).toThrow('unrelated');
  } finally {
    spy.mockRestore();
  }
});

it.each([0, -99900, 99900])(
  'preserves indexed paint ownership through forced integer fallback at %s',
  (origin) => {
    const rect = (
      id: string,
      x: number,
      y: number,
      width: number,
      height: number,
      fill: string,
    ): Vector => ({
      id,
      kind: 'rectangle',
      x: origin + x,
      y: origin + y,
      width,
      height,
      rotation: 0,
      fill,
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    });
    const input: Vector[] = [
      rect('base', 0, 0, 40, 40, '#ff0000'),
      rect('same', 20, 0, 40, 40, '#ff0000'),
      {
        ...rect('donut', 0, 0, 40, 40, '#0000ff'),
        kind: 'polygon',
        closed: true,
        fillRule: 'evenodd',
        contours: [box(5, 35)[0], box(10, 30)[0]].map((ring) => ring.map(([x, y]) => ({ x, y }))),
      },
      rect('top', 20, 0, 25, 20, '#00ff00'),
      rect('island', 12, 12, 4, 4, '#0000ff'),
    ];
    const before = structuredClone(input);
    const union = vi.spyOn(floating, 'union');
    const difference = vi.spyOn(floating, 'difference');
    try {
      const fail = () => {
        throw Error('Unable to complete output ring');
      };
      union.mockImplementation(fail);
      difference.mockImplementation(fail);
      const result = mergeVectors(input).map((shape) => ({
        fill: shape.fill,
        polygons: vectorPolygons(shape),
      }));
      expect(union).toHaveBeenCalled();
      expect(difference).toHaveBeenCalled();
      for (let y = 0.5; y < 42; y++)
        for (let x = 0.5; x < 62; x++) {
          let expected: string | undefined = x < 60 && y < 40 ? '#ff0000' : undefined;
          if (x > 5 && x < 35 && y > 5 && y < 35 && !(x > 10 && x < 30 && y > 10 && y < 30))
            expected = '#0000ff';
          if (x > 20 && x < 45 && y < 20) expected = '#00ff00';
          if (x > 12 && x < 16 && y > 12 && y < 16) expected = '#0000ff';
          expect(
            result
              .filter((p) => contains(p.polygons, { x: origin + x, y: origin + y }))
              .map((p) => p.fill),
          ).toEqual(expected ? [expected] : []);
        }
      expect(input).toEqual(before);
    } finally {
      union.mockRestore();
      difference.mockRestore();
    }
  },
);

it('keeps Bucket candidates within outward integer fallback rounding', () => {
  const shape: Vector = {
    id: 'rounding',
    kind: 'rectangle',
    x: 0.00012,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const spy = vi.spyOn(floating, 'union');
  try {
    spy.mockImplementation(() => {
      throw Error('Unable to complete output ring');
    });
    const result = mergeVectors([shape], { paint: shape, point: { x: 0.00006, y: 5 }, gap: 0 });
    expect(result).toHaveLength(1);
    expect(contains(vectorPolygons(result[0]), { x: 0.00006, y: 5 })).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

// More than one reduction level, with duplicate contours in different leaves.
it.each([0, -99900, 99900])(
  'retains analytic parity across a balanced reduction at %s',
  (origin) => {
    const rectangles = Array.from({ length: 513 }, (_, i) => ({
      x: (i * 17) % 71,
      y: (i * 23) % 67,
      w: 3 + (i % 13),
      h: 4 + (i % 11),
    }));
    const rings: Polygon[] = rectangles.map(({ x, y, w, h }, i) => {
      const ring: [number, number][] = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y],
      ];
      if (i % 2) ring.reverse();
      return [ring.map(([a, b]) => [origin + a, origin + b])];
    });
    rings.push(structuredClone(rings[0]), structuredClone(rings[128]));
    rectangles.push(rectangles[0], rectangles[128]);
    const before = structuredClone(rings);
    const result = evenOddPaint(rings);
    for (let y = 0.5; y < 82; y += 2)
      for (let x = 0.5; x < 86; x += 2) {
        const count = rectangles.filter(
          (r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h,
        ).length;
        expect(contains(result, { x: origin + x, y: origin + y })).toBe(count % 2 === 1);
      }
    expect(rings).toEqual(before);
  },
);

it('restarts parity from all source rings after an upper reduction level fails', () => {
  const original = floating.xor;
  const spy = vi.spyOn(floating, 'xor');
  let calls = 0;
  try {
    spy.mockImplementation((...args) => {
      if (++calls === 3) throw Error('Unable to complete output ring');
      return original(...args);
    });
    const rings = [...Array.from({ length: 128 }, () => box(0, 10)), box(2, 8)];
    const before = structuredClone(rings);
    const result = evenOddPaint(rings);
    expect(calls).toBe(3);
    expect(contains(result, { x: 1, y: 1 })).toBe(false);
    expect(contains(result, { x: 5, y: 5 })).toBe(true);
    expect(rings).toEqual(before);
  } finally {
    spy.mockRestore();
  }
});

it('retains within-ring parity after a recognized floating XOR failure', () => {
  const ring = Array.from({ length: 5 }, (_, i) => {
    const angle = (((i * 2) % 5) * 2 * Math.PI) / 5;
    return [50 + 40 * Math.cos(angle), 50 + 40 * Math.sin(angle)] as [number, number];
  });
  const before = structuredClone(ring);
  const spy = vi.spyOn(floating, 'xor').mockImplementationOnce(() => {
    throw new Error('Unable to complete output ring');
  });
  try {
    const result = evenOddPaint([[ring]]);
    expect(contains(result, { x: 50, y: 50 })).toBe(false);
    expect(contains(result, { x: 80, y: 50 })).toBe(true);
    expect(ring).toEqual(before);
  } finally {
    spy.mockRestore();
  }
});
it('retries recognized intersection failures with holes and islands without mutating inputs', () => {
  const spy = vi.spyOn(floating, 'intersection');
  try {
    for (const origin of [0, -99900, 99900]) {
      const shifted = (p: Polygon) =>
        p.map((r) => r.map(([x, y]) => [x + origin, y + origin] as [number, number]));
      const first = [shifted([box(0, 20)[0], box(5, 15)[0]]), shifted(box(8, 12))];
      const second = [shifted(box(10, 25)), shifted(box(-5, 2))];
      const before = structuredClone([first, second]);
      spy.mockImplementationOnce(() => {
        throw new Error('Unable to complete output ring');
      });
      const result = clipping.intersection(first, second);
      for (const [x, y, expected] of [
        [1, 1, true],
        [18, 18, true],
        [11, 11, true],
        [11, 6, false],
        [4, 4, false],
        [23, 23, false],
      ] as const)
        expect(contains(result, { x: origin + x, y: origin + y })).toBe(expected);
      expect([first, second]).toEqual(before);
    }
    for (const [first, second] of [
      [[], box(0, 10)],
      [box(0, 10), []],
    ] as [Polygon, Polygon][]) {
      spy.mockImplementationOnce(() => {
        throw new Error('SweepLine failure');
      });
      expect(clipping.intersection(first, second)).toEqual([]);
    }
    spy.mockImplementationOnce(() => {
      throw new Error('SweepLine failure');
    });
    const tiny = clipping.intersection(box(0, 10), box(1, 1.00001));
    expect(contains(tiny, { x: 1.000005, y: 1.000005 })).toBe(true);
    expect(contains(tiny, { x: 1.00002, y: 1.00002 })).toBe(false);
    const unrelated = new Error('Unrelated intersection failure');
    spy.mockImplementationOnce(() => {
      throw unrelated;
    });
    expect(() => clipping.intersection(box(0, 10), box(5, 15))).toThrow(unrelated);
  } finally {
    spy.mockRestore();
  }
});

it.each(['union', 'difference'] as const)(
  'resolves narrow %s fallback contours without losing paint or holes',
  (operation) => {
    const spy = vi.spyOn(floating, operation);
    try {
      spy.mockImplementation(() => {
        throw Error('Unable to complete output ring');
      });
      for (const origin of [0, -99900, 99900]) {
        const outer = box(origin, origin + 10);
        const narrow = box(origin + 1, origin + 1.00001);
        const before = structuredClone({ outer, narrow });
        // A dropped exterior loses paint; a dropped hole or cutter adds paint.
        const probe = { x: origin + 1.000005, y: origin + 1.000005 };
        const beside = { x: origin + 0.5, y: origin + 0.5 };
        const cut = clipping[operation](outer, narrow);
        expect(contains(cut, probe)).toBe(operation === 'union');
        expect(contains(cut, beside)).toBe(true);
        const holed = clipping[operation]([outer[0], narrow[0]]);
        expect(contains(holed, probe)).toBe(false);
        expect(contains(holed, beside)).toBe(true);
        expect(contains(clipping[operation](narrow, outer), probe)).toBe(operation === 'union');
        expect(contains(clipping[operation](narrow), probe)).toBe(true);
        expect(() => clipping[operation](outer, box(origin, origin))).toThrow(/collapses/);
        expect({ outer, narrow }).toEqual(before);
      }
    } finally {
      spy.mockRestore();
    }
  },
);

it('retains sub-grid holes and islands when intersecting mixed paint after a sweep failure', () => {
  const spy = vi.spyOn(floating, 'intersection').mockImplementation(() => {
    throw new Error('Unable to complete output ring');
  });
  try {
    for (const origin of [0, -99900, 99900]) {
      const outer = box(origin, origin + 10)[0];
      const hole = box(origin + 1, origin + 1.00008)[0];
      const island = box(origin + 1.00002, origin + 1.00004);
      const paint = [[outer, hole], island];
      const mask = box(origin + 0.5, origin + 5);
      const before = structuredClone(paint);
      for (const result of [clipping.intersection(paint, mask), clipping.intersection(mask, paint)]) {
        for (const [offset, painted] of [[0.25, false], [0.75, true], [1.00001, false],
          [1.00003, true], [1.00006, false], [2, true]] as const)
          expect(contains(result, { x: origin + offset, y: origin + offset })).toBe(painted);
      }
      expect(paint).toEqual(before);
    }
    expect(() => clipping.intersection(box(0, 10), box(1, 1))).toThrow(/collapses/);
    expect(() => clipping.intersection(box(1, 1), box(0, Infinity))).toThrow(/range/);
  } finally {
    spy.mockRestore();
  }
});

it('partitions a brush fill and keeps an enclosed pencil editable beside a sub-grid selection hole', () => {
  const brush = { ...narrowFixtureBrush(30), x: 0 };
  const pencil: Vector = { ...brush, id: 'line', kind: 'path', fillEnabled: false, strokeWidth: 2,
    x: 15, y: 30, width: 10, height: 0, points: [{x: 0, y: 0}, {x: 10, y: 0}] };
  const shapes = [brush, pencil], before = structuredClone(shapes);
  const hole: Polygon = [[[30, 27], [30.00008, 27], [30.00008, 33], [30, 33], [30, 27]]];
  const region = [[box(10, 40)[0], hole[0]]];
  const options = { region, preserveStrokes: true, eligible: shapes.map(s => s.id) };
  const spy = vi.spyOn(floating, 'intersection').mockImplementation(() => {
    throw Error('Unable to complete output ring');
  });
  try {
    const moved = clipPaint(shapes, { ...options, keep: 'inside' });
    const stationary = clipPaint(shapes, { ...options, keep: 'outside' });
    expect(moved).toContainEqual(pencil);
    expect(stationary.some(s => s.id === pencil.id)).toBe(false);
    const painted = (vectors: Vector[], q: number) => vectors.some(s =>
      contains(vectorPolygons(s), { x: q, y: 30 }));
    for (const [q, selected] of [[5, false], [20, true], [30.00004, false], [32, true]] as const) {
      expect(painted(moved, q)).toBe(selected);
      expect(painted(stationary, q)).toBe(!selected);
    }
    expect(shapes).toEqual(before);
  } finally {
    spy.mockRestore();
  }
});

it('recovers an intersection narrower than the local grid using the other sweep axis', () => {
  const skinny: Polygon = [[[1, 2], [1.000000001, 2], [1.000000001, 8], [1, 8], [1, 2]]];
  const spy = vi.spyOn(floating, 'intersection').mockImplementationOnce(() => {
    throw Error('Unable to complete output ring');
  });
  try {
    const result = clipping.intersection(skinny, box(0, 10));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result[0][0]).toHaveLength(5);
    expect(contains(result, { x: 1.0000000005, y: 5 })).toBe(true);
    expect(contains(result, { x: 1.000000003, y: 5 })).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

it.each(['union', 'difference', 'intersection'] as const)(
  'recovers selection %s when the bounded sweep and integer grid both fail', operation => {
    const limit = Error('Infinite loop when passing sweep line over endpoints (too many sweep line segments).');
    const skinny = box(1, 1.000000001);
    const outer = box(0, 10);
    const spy = vi.spyOn(floating, operation).mockImplementationOnce(() => { throw limit; });
    try {
      const paint = withSelectionClipping(() => clipping[operation](outer, skinny));
      expect(spy).toHaveBeenCalledTimes(2);
      expect(contains(paint, { x: 1.0000000005, y: 1.0000000005 })).toBe(operation !== 'difference');
      expect(contains(paint, { x: 2, y: 2 })).toBe(operation !== 'intersection');
    } finally { spy.mockRestore(); }
  },
);

it('charges a second bounded sweep against the original selection allowance', () => {
  const skinny = box(1, 1.000000001);
  const dense: Polygon = [Array.from({ length: 1150 }, (_, i): [number, number] =>
    i % 2 ? [20, 20 + i / 1150] : [0, i / 1150])];
  const limit = Error('Infinite loop when passing sweep line over endpoints (too many sweep line segments).');
  const spy = vi.spyOn(floating, 'union').mockImplementationOnce(() => { throw limit; });
  try {
    expect(() => withSelectionClipping(() => clipping.union(skinny, dense))).toThrow(/contour collapses/);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
});

it('settles moved paint through the planar map without the older ownership intersection', () => {
  const brush = narrowFixtureBrush(30);
  const pencil: Vector = { ...brush, id: 'pencil', kind: 'path', fillEnabled: false,
    strokeWidth: 2, points: [{x: 0, y: 0}, {x: 35, y: 2}] };
  const shapes = [brush, ...strokeToFill(pencil)], ids = shapes.map(s => s.id), before = structuredClone(shapes);
  const spy = vi.spyOn(clipping, 'intersection').mockImplementation(() => {
    throw new CollapsedIntersectionContour('Intersection paint contour collapses at the supported precision.');
  });
  try {
    // The planar map settles the drop itself, so the failing polygon intersection never runs.
    const moved = mergeSelectedArtwork(shapes, ids, true, true, ids);
    expect(spy).not.toHaveBeenCalled();
    expect(moved.retainedOverlap).toBeUndefined();
    expect(moved.selected.length).toBeGreaterThan(0);
    expect(moved.artwork[0]).not.toBe(brush);
    expect(shapes).toEqual(before);
  } finally {
    spy.mockRestore();
  }
});

it.each(['bevel', 'miter'] as const)('selects straight and retraced pencil spans with %s joins after a sweep failure', (strokeJoin) => {
  const pencil: Vector = { ...narrowFixtureBrush(30), id: 'pencil', kind: 'path',
    x: 0, y: 0, width: 30, height: 10, fillEnabled: false, closed: false,
    strokeWidth: 2, strokeJoin, strokeCap: 'butt', points: [
      { x: 0, y: 0 }, { x: 15, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 10 },
    ] };
  const before = structuredClone(pencil);
  const sweep = vi.spyOn(floating, 'union').mockImplementationOnce(() => {
    throw Error('Unable to complete output ring');
  });
  try {
    const selection = selectPaintRegion([pencil], { current: [], mode: 'replace',
      polygon: [{ x: 5, y: -3 }, { x: 26, y: -3 }, { x: 26, y: 15 }, { x: 5, y: 15 }],
    }, [pencil.id]);
    expect(contains(selection, { x: 25, y: 0 })).toBe(true);
    expect(contains(selection, { x: 15, y: 8 })).toBe(true);
    expect(contains(selection, { x: 3, y: 0 })).toBe(false);
    expect(contains(selection, { x: 20, y: 5 })).toBe(false);
    expect(pencil).toEqual(before);
  } finally {
    sweep.mockRestore();
  }
});

it('selects a pencil band thinner than the stroke construction snap grid', () => {
  const line: Vector = { ...narrowFixtureBrush(30), id: 'fine', kind: 'line', x: 0, y: 0,
    width: 20, height: 0, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
    strokeWidth: 0.000000008, strokeCap: 'butt', fillEnabled: false };
  const selection = selectPaintRegion([line], { current: [], mode: 'replace',
    polygon: [{ x: 2, y: -1 }, { x: 18, y: -1 }, { x: 18, y: 1 }, { x: 2, y: 1 }],
  }, [line.id]);
  expect(contains(selection, { x: 10, y: 0 })).toBe(true);
  expect(contains(selection, { x: 10, y: 1e-8 })).toBe(false);
});

it.each(['bevel', 'miter'] as const)('selects mixed paint when a shallow %s corner has coincident offset points', (strokeJoin) => {
  const brush = narrowFixtureBrush(106);
  const pencil: Vector = { ...brush, id: 'pencil', kind: 'path', x: 0, y: 0,
    width: 120, height: 101, fillEnabled: false, strokeWidth: 2, strokeJoin, strokeCap: 'butt',
    points: [{ x: 80, y: 100 }, { x: 100, y: 100 }, { x: 120, y: 100 + 2 ** -46 }] };
  const shapes = [pencil, brush], before = structuredClone(shapes);
  const sweep = vi.spyOn(floating, 'union').mockImplementationOnce(() => {
    throw Error('Unable to complete output ring');
  });
  try {
    const region = selectPaintRegion(shapes, { current: [], mode: 'replace',
      polygon: [{ x: 85, y: 96 }, { x: 115, y: 96 }, { x: 115, y: 115 }, { x: 85, y: 115 }],
    }, shapes.map(s => s.id));
    expect(contains(region, { x: 88, y: 100 })).toBe(true);
    expect(contains(region, { x: 110, y: 109 })).toBe(true);
    expect(contains(region, { x: 88, y: 97 })).toBe(false);
    expect(contains(region, { x: 116, y: 106 })).toBe(false);
    expect(shapes).toEqual(before);
  } finally {
    sweep.mockRestore();
  }
});

it('partitions paint through an exact zero-area ring while retaining narrow holes', () => {
  const line: Polygon = [[[1, 2], [1.5, 3], [2, 4], [1, 2]]];
  const narrowHole = box(4, 4.00008)[0];
  const subject = [box(0, 10)[0], line[0], narrowHole];
  const original = structuredClone(subject);
  const intersection = vi.spyOn(floating, 'intersection').mockImplementation(() => {
    throw Error('Unable to complete output ring');
  });
  try {
    withSelectionClipping(() => {
      const mask = box(0, 7);
      const inside = clipping.intersection(subject, mask);
      const outside = integerPaint('difference', subject, mask);
      for (const [x, expectedInside, expectedOutside] of [[2,true,false],[4.00004,false,false],[8,false,true]] as const) {
        expect(contains(inside, {x, y:x})).toBe(expectedInside);
        expect(contains(outside, {x, y:x})).toBe(expectedOutside);
      }
      expect(clipping.intersection(mask, line)).toEqual([]);
      expect(integerPaint('union', line)).toEqual([]);
      expect(integerPaint('difference', line, mask)).toEqual([]);
      expect(contains(integerPaint('difference', mask, line), {x:3,y:3})).toBe(true);
    });
    expect(subject).toEqual(original);
    expect(() => integerPaint('union', line)).toThrow(/collapses/);
  } finally { intersection.mockRestore(); }
});

it('cuts destination paint around a retraced bent contour after a sweep failure', () => {
  const spur: Polygon = [[[2, 2], [3, 3], [4, 2], [3, 3], [3, 4], [3, 3], [2, 2]]];
  const destination = [box(0, 10)[0], spur[0], box(7, 8)[0]];
  const before = structuredClone(destination);
  const sweep = vi.spyOn(floating, 'difference').mockImplementation(() => {
    throw Error('Unable to complete output ring');
  });
  try {
    const remaining = withSelectionClipping(() => clipping.difference(destination, box(0, 5)));
    expect(contains(remaining, { x: 2, y: 2 })).toBe(false);
    expect(contains(remaining, { x: 6, y: 6 })).toBe(true);
    expect(contains(remaining, { x: 7.5, y: 7.5 })).toBe(false);
    expect(destination).toEqual(before);
  } finally { sweep.mockRestore(); }
});

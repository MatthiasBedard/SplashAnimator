import { normalizeVector } from '../packages/geometry/src/drawing';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { it, expect } from 'vitest';
import {
  moveAnchors,
  moveTangent,
  deleteAnchors,
  dissolveAnchor,
  continueBezier,
  anchorsInBox,
  convertAnchors,
  insertAnchor,
  splitBezier,
  joinBezier,
} from '../packages/geometry/src/nodes';
import type { Vector } from '../packages/document/src';
const shape = (): Vector => ({
  id: 'a',
  kind: 'bezier',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 1,
  points: [],
  nodes: [
    { x: 0, y: 0, out: { x: 10, y: 0 } },
    { x: 50, y: 50, in: { x: 40, y: 50 } },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ],
});
it('moves a set and its handles from original coordinates without drift', () => {
  const original = shape(),
    target = structuredClone(original);
  moveAnchors(target, original, [0, 1], 10, 20);
  moveAnchors(target, original, [0, 1], 20, 30);
  expect(target.nodes![0]).toEqual({ x: 20, y: 30, out: { x: 30, y: 30 } });
  expect(target.nodes![1].in).toEqual({ x: 60, y: 80 });
  expect(target.nodes![2]).toEqual(original.nodes![2]);
  expect(original.nodes![0].x).toBe(0);
});
it('deletes atomically and protects closed contour minimums', () => {
  const s = shape();
  expect(deleteAnchors(s, [0, 1, 2])).toBe(false);
  expect(s.nodes).toHaveLength(4);
  expect(deleteAnchors(s, [0, 1])).toBe(true);
  expect(s.nodes).toHaveLength(2);
  const closed = shape();
  closed.closed = true;
  expect(deleteAnchors(closed, [0, 1])).toBe(false);
});

it('marquee selects affine anchors in either drag direction, excluding handles', () => {
  const s = shape();
  s.transform = [1, 0.5, 0.2, 1];
  expect(anchorsInBox(s, { x: 65, y: 80 }, { x: -1, y: -1 })).toEqual([0, 1]);
  expect(anchorsInBox(s, { x: 9, y: 4 }, { x: 11, y: 6 })).toEqual([]);
});

it('converts selected anchors with collinear handles while preserving other nodes', () => {
  const s = shape(),
    before = structuredClone(s);
  convertAnchors(s, [0, 1], 'smooth');
  expect(s.nodes![0].in).toBeUndefined();
  expect(s.nodes![0].out).toBeDefined();
  const n = s.nodes![1],
    a = n.in!,
    b = n.out!;
  expect((a.x - n.x) * (b.y - n.y) - (a.y - n.y) * (b.x - n.x)).toBeCloseTo(0);
  expect(s.nodes!.slice(2)).toEqual(before.nodes!.slice(2));
  expect(s.nodes!.map(({ x, y }) => ({ x, y }))).toEqual(
    before.nodes!.map(({ x, y }) => ({ x, y })),
  );
  convertAnchors(s, [0, 1], 'corner');
  expect(s.nodes![1].in).toBeUndefined();
  expect(s.nodes![1].out).toBeUndefined();
});
it('handles closed endpoints and coincident anchors without nonfinite geometry', () => {
  const s = shape();
  s.closed = true;
  convertAnchors(s, [0], 'smooth');
  expect(s.nodes![0].in).toBeDefined();
  s.nodes = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  convertAnchors(s, [0, 1, 2], 'smooth');
  expect(s.nodes).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);
});

it('splits a cubic exactly at an arbitrary parameter without changing unrelated handles', () => {
  const s = shape();
  const original = structuredClone(s);
  const t = 0.3;
  const cubic = (
    a: import('../packages/document/src').BezierNode,
    b: import('../packages/document/src').BezierNode,
    u: number,
  ) => {
    const c = a.out ?? a,
      d = b.in ?? b,
      v = 1 - u;
    return {
      x: v * v * v * a.x + 3 * v * v * u * c.x + 3 * v * u * u * d.x + u * u * u * b.x,
      y: v * v * v * a.y + 3 * v * v * u * c.y + 3 * v * u * u * d.y + u * u * u * b.y,
    };
  };
  expect(insertAnchor(s, 0, t)).toBe(1);
  for (let i = 0; i <= 20; i++) {
    const u = i / 20,
      expected = cubic(original.nodes![0], original.nodes![1], u);
    const actual =
      u <= t
        ? cubic(s.nodes![0], s.nodes![1], u / t)
        : cubic(s.nodes![1], s.nodes![2], (u - t) / (1 - t));
    expect(actual.x).toBeCloseTo(expected.x, 10);
    expect(actual.y).toBeCloseTo(expected.y, 10);
  }
  expect(s.nodes!.slice(3)).toEqual(original.nodes!.slice(2));
});
it('splits the closing segment and rejects invalid or terminal insertion without mutation', () => {
  const s = shape(),
    before = structuredClone(s);
  expect(insertAnchor(s, 3)).toBeUndefined();
  expect(insertAnchor(s, 0, NaN)).toBeUndefined();
  expect(insertAnchor(s, 0, 0)).toBeUndefined();
  expect(s).toEqual(before);
  s.closed = true;
  expect(insertAnchor(s, 3)).toBe(4);
  expect(s.nodes).toHaveLength(5);
  expect(s.nodes![0].in).toBeDefined();
});

it('splits open paths into independent objects retaining segment controls and paint', () => {
  const s = shape();
  s.groups = ['g'];
  s.transform = [1, 0.2, 0.3, 1];
  const before = structuredClone(s);
  const [a, b] = splitBezier(s, 1)!;
  expect(a.id).toBe(s.id);
  expect(b.id).not.toBe(s.id);
  expect(a.nodes).toHaveLength(2);
  expect(b.nodes).toHaveLength(3);
  expect(a.nodes![1].in).toEqual(s.nodes![1].in);
  expect(b.nodes![0].out).toEqual(s.nodes![1].out);
  expect(b.groups).toEqual(s.groups);
  expect(b.transform).toEqual(s.transform);
  expect(s).toEqual(before);
  b.nodes![0].x++;
  expect(a.nodes![1].x).toBe(s.nodes![1].x);
  expect(splitBezier(s, 0)).toBeUndefined();
});
it('opens a closed path at an anchor retaining the closing segment', () => {
  const s = shape();
  s.closed = true;
  const [out] = splitBezier(s, 2)!;
  expect(out.closed).toBe(false);
  expect(out.nodes).toHaveLength(5);
  expect(out.nodes!.map(({ x, y }) => ({ x, y }))).toEqual(
    [s.nodes![2], s.nodes![3], s.nodes![0], s.nodes![1], s.nodes![2]].map(({ x, y }) => ({ x, y })),
  );
  expect(out.nodes![0].in).toBeUndefined();
  expect(out.nodes!.at(-1)!.out).toBeUndefined();
});

it('rejoins split paths and preserves source curves without aliasing', () => {
  const s = shape(),
    [a, b] = splitBezier(s, 1)!;
  const joined = joinBezier(a, b)!;
  expect(joined.nodes).toEqual(s.nodes);
  expect(joined.id).toBe(a.id);
  joined.nodes![1].x++;
  expect(a.nodes![1].x).toBe(s.nodes![1].x);
  b.stroke = '#ff0000';
  expect(joinBezier(a, b)).toBeUndefined();
});
it('joins reversed translated endpoints and rejects gaps or incompatible bases', () => {
  const a = shape();
  a.nodes = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
  ];
  const b = shape();
  b.x = 100;
  b.nodes = [
    { x: 0, y: 0 },
    { x: -50, y: 0, in: { x: -40, y: 10 } },
  ];
  const joined = joinBezier(a, b)!;
  expect(joined.nodes).toHaveLength(3);
  expect(joined.nodes![1].out).toEqual({ x: 60, y: 10 });
  expect(joined.nodes![2].x).toBe(100);
  b.x++;
  expect(joinBezier(a, b)).toBeUndefined();
  b.x = 100;
  b.transform = [2, 0, 0, 1];
  expect(joinBezier(a, b)).toBeUndefined();
});

const compound = (): Vector => {
  const s = shape();
  s.kind = 'polygon';
  s.strokeWidth = 0;
  s.fillRule = 'evenodd';
  s.rotation = 23;
  s.transform = [-1, 0.2, 0.4, 1.3];
  s.contours = [
    structuredClone(s.nodes!),
    structuredClone(s.nodes!).map((n) => ({ ...n, x: n.x + 200 })),
  ];
  delete s.nodes;
  return s;
};
it('converts compound anchors within their own closed ring using flat selection indices', () => {
  const s = compound(),
    before = structuredClone(s);
  convertAnchors(s, [4, 7, 4, -1, 99, 1.5], 'smooth');
  expect(s.contours![0]).toEqual(before.contours![0]);
  expect(s.contours![1][0].in).toBeDefined();
  expect(s.contours![1][3].out).toBeDefined();
  for (let i = 0; i < 4; i++)
    expect({ x: s.contours![1][i].x, y: s.contours![1][i].y }).toEqual({
      x: before.contours![1][i].x,
      y: before.contours![1][i].y,
    });
  expect(s.contours![1][1]).toEqual(before.contours![1][1]);
  convertAnchors(s, [4, 7], 'corner');
  expect(s.contours![1][0].in).toBeUndefined();
  expect(s.contours![1][3].out).toBeUndefined();
  expect(s.contours![0]).toEqual(before.contours![0]);
});
it('inserts into a compound closing edge without crossing into another ring or changing paint', () => {
  const s = compound(),
    before = structuredClone(s);
  const a = before.contours![1][3],
    b = before.contours![1][0];
  const cubic = (
    a: NonNullable<Vector['nodes']>[number],
    b: NonNullable<Vector['nodes']>[number],
    t: number,
  ) => {
    const u = 1 - t,
      c = a.out ?? a,
      d = b.in ?? b;
    return {
      x: u ** 3 * a.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t ** 3 * b.x,
      y: u ** 3 * a.y + 3 * u * u * t * c.y + 3 * u * t * t * d.y + t ** 3 * b.y,
    };
  };
  expect(insertAnchor(s, 7, 0.3)).toBe(8);
  expect(s.contours![0]).toEqual(before.contours![0]);
  expect(s.contours![1]).toHaveLength(5);
  for (let i = 0; i <= 40; i++) {
    const t = i / 40,
      expected = cubic(a, b, t),
      r = s.contours![1];
    const actual = t <= 0.3 ? cubic(r[3], r[4], t / 0.3) : cubic(r[4], r[0], (t - 0.3) / 0.7);
    expect(actual.x).toBeCloseTo(expected.x, 10);
    expect(actual.y).toBeCloseTo(expected.y, 10);
  }
  expect({ ...s, contours: [] }).toEqual({ ...before, contours: [] });
  const snapshot = structuredClone(s);
  for (const index of [-1, 99, 1.5]) expect(insertAnchor(s, index)).toBeUndefined();
  expect(s).toEqual(snapshot);
});

it('rotates an opposite tangent at constant world length on affine compound artwork', () => {
  const original = compound();
  original.contours![1][0].in = { x: 170, y: 15 };
  const target = structuredClone(original),
    index = 4,
    base = original.contours![1][0],
    m = matrix(original);
  const anchor = mapPoint(m, base),
    old = mapPoint(m, base.in!);
  const radius = Math.hypot(old.x - anchor.x, old.y - anchor.y);
  for (const point of [
    { x: 240, y: 60 },
    { x: 260, y: -10 },
  ]) {
    moveTangent(target, original, index, 'out', point);
    const a = mapPoint(m, target.contours![1][0].in!),
      b = mapPoint(m, point);
    expect(Math.hypot(a.x - anchor.x, a.y - anchor.y)).toBeCloseTo(radius, 9);
    expect((a.x - anchor.x) * (b.y - anchor.y) - (a.y - anchor.y) * (b.x - anchor.x)).toBeCloseTo(
      0,
      9,
    );
    expect((a.x - anchor.x) * (b.x - anchor.x) + (a.y - anchor.y) * (b.y - anchor.y)).toBeLessThan(
      0,
    );
  }
  moveTangent(target, original, index, 'out', { x: 250, y: 20 }, true);
  expect(target.contours![1][0].in).toEqual(base.in);
  moveTangent(target, original, index, 'out', base);
  expect(target.contours![1][0].in).toEqual(base.in);
  expect(target.contours![0]).toEqual(original.contours![0]);
  expect(target.contours![1].slice(1)).toEqual(original.contours![1].slice(1));
});
it('tangent editing does not create missing endpoint handles and rejects nonfinite input', () => {
  const original = shape(),
    target = structuredClone(original);
  moveTangent(target, original, 0, 'out', { x: 30, y: 20 });
  expect(target.nodes![0].in).toBeUndefined();
  const before = structuredClone(target);
  moveTangent(target, original, 0, 'out', { x: NaN, y: 0 });
  expect(target).toEqual(before);
  expect(original.nodes![0].out).toEqual({ x: 10, y: 0 });
});

it('dissolves split cubic anchors at unequal parameters under affine transforms', () => {
  for (const t of [0.01, 0.13, 0.5, 0.82, 0.99]) {
    const s = shape();
    s.transform = [-1.5, 0.3, 0.8, 2];
    s.rotation = 27;
    s.x = 90000;
    const before = structuredClone(s),
      inserted = insertAnchor(s, 0, t)!;
    expect(dissolveAnchor(s, inserted)).toBe(true);
    expect(s.nodes).toHaveLength(before.nodes!.length);
    for (let i = 0; i < s.nodes!.length; i++) {
      const a = s.nodes![i],
        b = before.nodes![i];
      expect(a.x).toBe(b.x);
      expect(a.y).toBe(b.y);
      for (const part of ['in', 'out'] as const) {
        if (b[part]) {
          expect(a[part]!.x).toBeCloseTo(b[part]!.x, 8);
          expect(a[part]!.y).toBeCloseTo(b[part]!.y, 8);
        } else expect(a[part]).toBeUndefined();
      }
    }
    expect({ ...s, nodes: [] }).toEqual({ ...before, nodes: [] });
  }
});
it('dissolves a closing compound segment without changing other rings or paint', () => {
  const s = shape();
  s.kind = 'polygon';
  s.fillRule = 'evenodd';
  s.contours = [
    structuredClone(s.nodes!),
    structuredClone(s.nodes!).map((p) => ({ ...p, x: p.x + 200 })),
  ];
  delete s.nodes;
  const before = structuredClone(s),
    inserted = insertAnchor(s, 7, 0.35)!;
  expect(inserted).toBe(8);
  expect(dissolveAnchor(s, inserted)).toBe(true);
  expect(s.contours![0]).toEqual(before.contours![0]);
  expect(s.contours![1]).toHaveLength(4);
  // The originally handle-free closing span returns to endpoint control points.
  expect(s.contours![1][3].out!.x).toBeCloseTo(before.contours![1][3].x, 8);
  expect(s.contours![1][0].in!.x).toBeCloseTo(before.contours![1][0].x, 8);
});
it('rejects non-redundant joins, cusps, endpoints and too-small contours atomically', () => {
  const changed = shape();
  const i = insertAnchor(changed, 0, 0.3)!;
  changed.nodes![i].in!.y += 0.001;
  const cusp = shape();
  cusp.nodes![1].in = { ...cusp.nodes![1] };
  cusp.nodes![1].out = { ...cusp.nodes![1] };
  const triangle = shape();
  triangle.closed = true;
  triangle.nodes = triangle.nodes!.slice(0, 3);
  for (const [s, index] of [
    [changed, i],
    [cusp, 1],
    [shape(), 0],
    [shape(), 3],
    [triangle, 1],
    [shape(), -1],
  ] as const) {
    const before = structuredClone(s);
    expect(dissolveAnchor(s, index)).toBe(false);
    expect(s).toEqual(before);
  }
});

it('prepares detached continuation drafts from either endpoint with reversed handles and unchanged paint', () => {
  const s = shape();
  s.transform = [1, 0.2, 0.3, -1];
  s.opacity = 0.4;
  s.pivot = { x: 22, y: 33 };
  const before = structuredClone(s),
    end = continueBezier(s, 3)!,
    start = continueBezier(s, 0)!;
  expect(end).toEqual(s);
  expect(end).not.toBe(s);
  expect(end.nodes).not.toBe(s.nodes);
  expect(start.nodes!.map((n) => ({ x: n.x, y: n.y }))).toEqual(
    s.nodes!.map((n) => ({ x: n.x, y: n.y })).reverse(),
  );
  expect(start.nodes![2].out).toEqual(s.nodes![1].in);
  expect(start.nodes![3].in).toEqual(s.nodes![0].out);
  expect({ ...start, nodes: [] }).toEqual({ ...s, nodes: [] });
  expect(continueBezier(s, 1)).toBeUndefined();
  expect(continueBezier({ ...s, closed: true }, 0)).toBeUndefined();
  expect(s).toEqual(before);
});

it('joins independently normalized bitmap path pieces without changing their paint map', () => {
  const source = shape();
  source.rotation = 25;
  source.transform = [-1, 0.2, 0.4, 1.3];
  source.bitmap = {
    assetId: 'tile',
    x: -20,
    y: 15,
    width: 64,
    height: 32,
    repeat: true,
    transform: [1, 0.3, 0.2, 1],
  };
  const [a, b] = splitBezier(source, 1)!;
  normalizeVector(a);
  normalizeVector(b);
  const before = structuredClone([a, b]);
  const joined = joinBezier(a, b)!;
  expect(joined).toBeDefined();
  expect(joined.bitmap).toEqual(a.bitmap);
  expect(mapPoint(matrix(joined), joined.bitmap!)).toEqual(mapPoint(matrix(a), a.bitmap!));
  expect(joined.nodes).toHaveLength(source.nodes!.length);
  joined.bitmap!.transform![0] = 9;
  expect([a, b]).toEqual(before);
});

it('rejects joining different bitmap assets, maps, repeat modes or bitmap and solid paint', () => {
  const source = shape();
  source.bitmap = { assetId: 'tile', x: 0, y: 0, width: 64, height: 32 };
  const [a, base] = splitBezier(source, 1)!;
  for (const change of [
    (b: Vector) => {
      delete b.bitmap;
    },
    (b: Vector) => {
      b.bitmap!.assetId = 'other';
    },
    (b: Vector) => {
      b.bitmap!.x += 1;
    },
    (b: Vector) => {
      b.bitmap!.y += 1;
    },
    (b: Vector) => {
      b.bitmap!.width *= 2;
    },
    (b: Vector) => {
      b.bitmap!.height *= 2;
    },
    (b: Vector) => {
      b.bitmap!.repeat = true;
    },
    (b: Vector) => {
      b.bitmap!.transform = [1, 0.2, 0, 1];
    },
  ]) {
    const b = structuredClone(base);
    change(b);
    const before = structuredClone([a, b]);
    expect(joinBezier(a, b)).toBeUndefined();
    expect(joinBezier(b, a)).toBeUndefined();
    expect([a, b]).toEqual(before);
  }
  base.bitmap!.repeat = false;
  base.bitmap!.transform = [1, 0, 0, 1];
  expect(joinBezier(a, base)).toBeDefined();
});

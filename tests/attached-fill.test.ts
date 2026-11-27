import { expect, it, vi } from 'vitest';
import {
  clone,
  newProject,
  validateProject,
  type Vector,
  type BezierNode,
} from '../packages/document/src';
import { captureAttachedFillEdit } from '../packages/geometry/src/attached-fill';
import { bendEdge, editableEdgeOutline } from '../packages/geometry/src/edge-bend';
import { matrix, mapPoint, inversePoint } from '../packages/geometry/src/affine';
import { containsPoint, windingNumber, worldPaths } from '../packages/geometry/src/drawing';
import { boundaryContains } from '../packages/geometry/src/boundary-winding';
import { moveAnchors, moveTangent } from '../packages/geometry/src/nodes';
import { splitCubic, type Cubic } from '../packages/geometry/src/curve-fit';

const line = (): Vector => ({
  id: 'line',
  kind: 'bezier',
  x: 40,
  y: 60,
  width: 200,
  height: 0,
  rotation: 0,
  fill: '#000000',
  fillEnabled: false,
  stroke: '#223344',
  strokeWidth: 4,
  drawingMode: 'merge',
  points: [],
  nodes: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
  ],
});
const fill = (): Vector => ({
  ...line(),
  id: 'fill',
  kind: 'polygon',
  fill: '#ff0000',
  strokeWidth: 0,
  fillEnabled: true,
  closed: true,
  fillRule: 'evenodd',
  height: 100,
  pivot: { x: -15, y: 20 },
  nodes: undefined,
  contours: [
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
  ],
});
const all = (s: Vector): BezierNode[] => s.contours?.flat() ?? s.nodes ?? s.points;
it('dense attached anchors reuse captured point tables rather than flattening every source per link', () => {
  const source = line(),
    paint = fill(),
    size = 401;
  source.nodes = Array.from({ length: size }, (_, i) => ({ x: (i * 200) / (size - 1), y: 0 }));
  paint.contours = [[...clone(source.nodes), { x: 200, y: 100 }, { x: 0, y: 100 }]];
  const before = clone({ source, paint }),
    owner = captureAttachedFillEdit([paint, source], ['line']);
  expect(owner.targetIds).toEqual(['fill']);
  expect(Object.isFrozen(owner.targetIds)).toBe(true);
  const changed = clone(source);
  changed.nodes![0].y = -10;
  let expanded = 0;
  const flat = Array.prototype.flat;
  const spy = vi.spyOn(Array.prototype, 'flat').mockImplementation(function (
    this: unknown[],
    ...args: Parameters<typeof flat>
  ) {
    for (const item of this) if (Array.isArray(item)) expanded += item.length;
    return Reflect.apply(flat, this, args);
  });
  let result: Vector[];
  try {
    result = owner.prepare([changed]);
  } finally {
    spy.mockRestore();
  }
  expect(expanded).toBeLessThan(size * 4);
  expect(result![0].contours![0][0]).toEqual({ x: 0, y: -10 });
  expect(result![0].contours![0].slice(1)).toEqual(paint.contours[0].slice(1));
  expect({ source, paint }).toEqual(before);
});
const nodes = (s: Vector) =>
  all(s).map((n) => ({
    ...mapPoint(matrix(s), n),
    ...(n.in ? { in: mapPoint(matrix(s), n.in) } : {}),
    ...(n.out ? { out: mapPoint(matrix(s), n.out) } : {}),
  }));
const valid = (shapes: Vector[]) => {
  const p = newProject();
  p.layers[0].keys[0].shapes = shapes;
  validateProject(p);
};

it.each(['evenodd', 'nonzero'] as const)('keeps a dense shared Brush boundary editable with %s paint', (fillRule) => {
  const seam = Array.from({ length: 641 }, (_, i) => ({ x: i / 4, y: i % 2 ? 0.25 : 0 }));
  const shared = clone(seam).reverse();
  const far = [{ x: 0, y: -25, out: { x: 40, y: -30 } }, { x: 160, y: -25, in: { x: 120, y: -30 } }];
  const hole = [{ x: 60, y: -16 }, { x: 60, y: -9 }, { x: 90, y: -9 }, { x: 90, y: -16 }];
  const shape = (id: string, ring: BezierNode[], holes: BezierNode[][] = []): Vector =>
    fillRule === 'evenodd' ? { ...fill(), id, contours: [ring, ...holes] } :
      { ...fill(), id, kind: 'bezier', fillRule, contours: undefined, nodes: ring };
  const source = shape('fill', [...seam, { x: 160, y: 25 }, { x: 0, y: 25 }]);
  const neighbor = { ...shape('neighbor', [...shared, ...far], [hole]), fill: '#0000ff' };
  const unrelated = { ...fill(), id: 'unrelated', y: 200 };
  const before = clone([source, neighbor, unrelated]);
  valid(before);

  const edit = captureAttachedFillEdit([source, neighbor, unrelated], [source.id], true);
  expect(edit.targetIds).toEqual([neighbor.id]);
  expect(edit.ownsAnchor(source.id, 320)).toBe(true);
  const changed = clone(source);
  all(changed)[320].y = -4;
  const [attached] = edit.prepare([changed]);
  const expected = clone(neighbor);
  all(expected)[320].y = -4;
  expect(attached).toEqual(expected);
  expect([source, neighbor, unrelated]).toEqual(before);
  valid([changed, attached, unrelated]);
});

it.each([true, false])('indexed ray tests preserve the original crossing arithmetic (evenodd: %s)', (evenodd) => {
  const point = (x: number, y: number) => ({ x, y });
  const lobe = [point(-4, 0), point(4, 4), point(-4, 4), point(4, 0), point(-4, 0)];
  const ring = [point(0, 0), point(5, 0), point(5, 5), point(0, 5)];
  const overflow = [point(-1e308, 0), point(1e308, 2), point(1, 1)];
  const tiny = [point(0, 0), point(0.25, Number.MIN_VALUE * 2), point(-0.25, Number.MIN_VALUE * 4)];
  const probes = [-1e308, -5, -4, -1, -0.25, 0, 0.1, 0.25, 1, 2, 4, 5, 6, 1e308]
    .flatMap(x => [-1, 0, Number.MIN_VALUE, Number.MIN_VALUE * 2, 0.5, 1, 2, 3, 4, 5, 6].map(y => point(x, y)));
  for (const paths of [[lobe, ring, ring], [ring, ring.slice().reverse()], [overflow], [tiny]]) {
    const indexed = boundaryContains(paths, evenodd, () => {});
    for (const probe of probes) {
      const original = evenodd ? paths.reduce((inside, path) => inside !== containsPoint(path, probe), false)
        : paths.reduce((winding, path) => winding + windingNumber(path, probe), 0) !== 0;
      expect(indexed(probe)).toBe(original);
    }
  }
});

it('skips distant contour rings when probing a Brush with many separate islands', () => {
  const paths = Array.from({ length: 2000 }, (_, i) => {
    const x = i * 8;
    return [{ x, y: 0 }, { x: x + 5, y: 0 }, { x: x + 5, y: 5 }, { x, y: 5 }];
  });
  let work = 0;
  const contains = boundaryContains(paths, true, () => { work++; });
  work = 0;
  expect(contains({ x: 8001, y: 2 })).toBe(true);
  expect(contains({ x: 8006, y: 2 })).toBe(false);
  expect(work).toBeLessThan(12);
});

it('bends a shared fill curve from either side, including a shorter stored interval', () => {
  const under = fill();
  const whole: Cubic = [{ x: 0, y: 0 }, { x: 50, y: -25 }, { x: 145, y: -28 }, { x: 200, y: 0 }];
  const [start, rest] = splitCubic(whole, 0.25);
  const [shared, end] = splitCubic(rest, 2 / 3);
  Object.assign(under.contours![0][0], { out: whole[1] });
  Object.assign(under.contours![0][1], { in: whole[2] });
  const over: Vector = { ...fill(), id: 'over', fill: '#0000ff', contours: [[
    { ...shared[3], out: shared[2] }, { ...shared[0], in: shared[1] },
    { x: shared[0].x, y: -55 }, { x: shared[3].x, y: -55 },
  ]] };
  const fromLong = captureAttachedFillEdit([under, over], [under.id], true);
  expect(fromLong.targetIds).toEqual([over.id]);
  const [longBend] = fromLong.prepare([bendEdge(under, 0, 0.5, { x: 0, y: -10 })]);
  expect(longBend.contours![0]).toHaveLength(4);
  expect(longBend.contours![0][0].out!.y).toBeLessThan(over.contours![0][0].out!.y);

  const fromShort = captureAttachedFillEdit([under, over], [over.id], true);
  expect(fromShort.targetIds).toEqual([under.id]);
  expect(fromShort.prepare([over])).toEqual([under]);
  const bent = bendEdge(over, 0, 0.5, { x: 0, y: -10 });
  const [shortBend] = fromShort.prepare([bent]);
  const ring = shortBend.contours![0], [a, b] = bent.contours![0];
  expect(ring).toHaveLength(6);
  expect(ring[1].out).toEqual(b.in);
  expect(ring[2].in).toEqual(a.out);
  expect(ring[0].out).toEqual(start[1]);
  expect(ring[3].in?.x).toBeCloseTo(end[2].x, 10);
  expect(ring[3].in?.y).toBeCloseTo(end[2].y, 10);
  expect(ring.slice(-2)).toEqual(under.contours![0].slice(-2));
  expect(shortBend.fill).toBe(under.fill);
  valid([shortBend, bent]);
});

it('does not follow a fill that shares only one anchor, overlays the same side, or is drawn independently', () => {
  const source = fill();
  const corner = { ...fill(), id: 'corner', x: source.x + 200, y: source.y + 100 };
  const independent = { ...fill(), id: 'object', y: source.y + 100, drawingMode: 'object' as const };
  const overlap = { ...fill(), id: 'overlap', contours: [source.contours![0].slice().reverse()] };
  expect(captureAttachedFillEdit([source, corner, independent, overlap], [source.id], true).targetIds).toEqual([]);
});

it('moves the shared handle and anchor on both fills without changing unrelated anchors', () => {
  const under = fill();
  const [a, b] = under.contours![0];
  a.out = { x: 55, y: -20 };
  b.in = { x: 145, y: -25 };
  const over: Vector = { ...fill(), id: 'blue', fill: '#0000ff', contours: [[
    { x: b.x, y: b.y, out: { ...b.in } }, { x: a.x, y: a.y, in: { ...a.out } },
    { x: 0, y: -85 }, { x: 200, y: -85 },
  ]] };
  const capture = captureAttachedFillEdit([under, over], [under.id], true);
  const changed = clone(under);
  moveTangent(changed, under, 0, 'out', { x: 49, y: -15 }, true);
  const [tangent] = capture.prepare([changed]);
  expect(tangent.contours![0][1].in).toEqual(changed.contours![0][0].out);
  const moved = clone(under);
  moveAnchors(moved, under, [0], -5, 3);
  const [anchor] = capture.prepare([moved]);
  expect(anchor.contours![0][1]).toEqual({ x: -5, y: 3, in: { x: 50, y: -17 } });
  expect(anchor.contours![0].slice(2)).toEqual(over.contours![0].slice(2));
});

for (const reverse of [false, true])
  for (const basis of [undefined, [1, 0.2, 0.3, 1], [-1, 0.2, 0.3, 1]] as const)
    it(`an attached fill follows a bowed line without new vertices ${reverse}/${basis}`, () => {
      const source = line(),
        paint = fill();
      if (basis) {
        source.transform = [...basis];
        paint.transform = [...basis];
      }
      if (reverse) paint.contours![0].reverse();
      const before = structuredClone({ source, paint });
      const owner = captureAttachedFillEdit([paint, source], ['line']);
      const bent = bendEdge(editableEdgeOutline(source)!, 0, 0.5, { x: 0, y: -30 });
      const [out] = owner.prepare([bent]);
      expect(all(out)).toHaveLength(4);
      expect(out.id).toBe('fill');
      expect(out.pivot).toEqual(paint.pivot);
      expect(out.transform).toEqual(paint.transform);
      const edge = nodes(out),
        stroke = nodes(bent);
      const a = edge.find((n) => Math.hypot(n.x - stroke[0].x, n.y - stroke[0].y) < 1e-8)!;
      const b = edge.find((n) => Math.hypot(n.x - stroke[1].x, n.y - stroke[1].y) < 1e-8)!;
      for (const [actual, expected] of [
        [reverse ? a.in : a.out, stroke[0].out],
        [reverse ? b.out : b.in, stroke[1].in],
      ]) {
        expect(actual!.x).toBeCloseTo(expected!.x, 9);
        expect(actual!.y).toBeCloseTo(expected!.y, 9);
      }
      expect(owner.prepare([source])).toEqual([paint]);
      expect({ source, paint }).toEqual(before);
      valid([out, bent]);
    });

it('moving an attached endpoint moves the fill corner and keeps other corners fixed', () => {
  const source = line(),
    paint = fill(),
    changed = clone(source);
  const owner = captureAttachedFillEdit([paint, source], ['line']);
  moveAnchors(changed, source, [0], 20, -10);
  const [out] = owner.prepare([changed]);
  expect(nodes(out)[0]).toEqual({ x: 60, y: 50 });
  expect(nodes(out).slice(1)).toEqual(nodes(paint).slice(1));
  expect(all(out)).toHaveLength(4);
});

for (const reverse of [false, true])
  it(`keeps an exact non-dyadic cubic interval attached after repeated edits (reversed: ${reverse})`, () => {
    let source = line(), paint = fill();
    source.nodes![0].out = { x: 50, y: -15 };
    source.nodes![1].in = { x: 160, y: -55 };
    const cut = (stroke: Vector) => {
      const [a, b] = stroke.nodes!;
      const cubic: Cubic = [a, a.out!, b.in!, b];
      return splitCubic(splitCubic(cubic, 0.873)[0], 0.137 / 0.873)[1];
    };
    const part = cut(source);
    paint.contours = [[{ ...part[0], out: part[1] }, { ...part[3], in: part[2] },
      { x: part[3].x, y: 100 }, { x: part[0].x, y: 100 }]];
    if (reverse) paint.contours[0] = paint.contours[0].map(n => ({ x: n.x, y: n.y, in: n.out, out: n.in })).reverse();
    const near = clone(paint);
    near.id = 'near';
    const control = reverse ? near.contours![0][3].in! : near.contours![0][0].out!;
    control.y -= 0.00001;
    expect(captureAttachedFillEdit([near, source], [source.id]).ownsEdge(source.id, 0)).toBe(false);
    for (let i = 0; i < 2; i++) {
      const owner = captureAttachedFillEdit([paint, source], [source.id]);
      expect(owner.ownsEdge(source.id, 0)).toBe(true);
      expect(owner.ownsEdge(source.id, 1)).toBe(false);
      const bent = bendEdge(source, 0, 0.5, { x: 0, y: -15 });
      const [updated] = owner.prepare([bent]);
      const ring = updated.contours![0];
      const a = reverse ? ring[3] : ring[0], b = reverse ? ring[2] : ring[1];
      const actual = [a, reverse ? a.in! : a.out!, reverse ? b.out! : b.in!, b];
      cut(bent).forEach((p, index) => {
        expect(actual[index].x).toBeCloseTo(p.x, 10);
        expect(actual[index].y).toBeCloseTo(p.y, 10);
      });
      expect(ring.length).toBe(4);
      expect(updated.pivot).toEqual(paint.pivot);
      source = bent;
      paint = updated;
    }
  });

it('successive tangent and edge drags retain attachment to a tessellated fill without extra vertices', () => {
  let source = line();
  source.nodes![0].out = { x: 60, y: -30 };
  source.nodes![1].in = { x: 140, y: -30 };
  let paint = fill();
  paint.contours = [
    worldPaths(source, 0.25)[0]
      .map((p) => inversePoint(matrix(paint), p))
      .concat([
        { x: 200, y: 100 },
        { x: 0, y: 100 },
      ]),
  ];
  const count = all(paint).length;
  for (let i = 0; i < 3; i++) {
    const owner = captureAttachedFillEdit([paint, source], ['line']);
    const changed = i === 0 ? clone(source) : bendEdge(source, 0, 0.5, { x: 0, y: -10 });
    if (i === 0) moveTangent(changed, source, 0, 'out', { x: 60, y: -60 }, true);
    const [out] = owner.prepare([changed]);
    expect(out).not.toEqual(paint);
    expect(all(out)).toHaveLength(count);
    expect(all(out).slice(-2)).toEqual(all(paint).slice(-2));
    expect(all(out).some((n) => n.out && n.out.y < -30)).toBe(true);
    valid([out, changed]);
    paint = out;
    source = changed;
  }
});

it('a shared edge moves both neighboring fills, while independent objects/groups and near misses stay fixed', () => {
  const source = line(),
    paint = fill(),
    other = fill();
  other.id = 'other';
  other.contours![0] = [
    { x: 200, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: -100 },
    { x: 200, y: -100 },
  ];
  const separate = fill();
  separate.id = 'object';
  separate.drawingMode = 'object';
  const group = fill();
  group.id = 'group';
  group.groups = ['g'];
  const near = fill();
  near.id = 'near';
  near.y += 0.01;
  const [a, b] = captureAttachedFillEdit(
    [paint, other, separate, group, near, source],
    ['line'],
  ).prepare([bendEdge(source, 0, 0.5, { x: 0, y: -20 })]);
  expect(a.id).toBe('fill');
  expect(b.id).toBe('other');
  expect(nodes(a)[0].out).toEqual(nodes(b)[1].in);
  expect(
    captureAttachedFillEdit([paint, { ...source, drawingMode: 'object' }], ['line']).prepare([
      source,
    ]),
  ).toEqual([]);
});

it('a line touching only a fill corner carries that corner during an anchor drag', () => {
  const source = line();
  source.nodes![1] = { x: -70, y: -60 };
  const paint = fill(),
    changed = clone(source);
  moveAnchors(changed, source, [0], 10, 15);
  const [out] = captureAttachedFillEdit([paint, source], ['line']).prepare([changed]);
  expect(nodes(out)[0]).toEqual({ x: 50, y: 75 });
  expect(nodes(out).slice(1)).toEqual(nodes(paint).slice(1));
});

it('retains other compound rings and paint metadata and returns detached output', () => {
  const source = line(),
    paint = fill();
  paint.contours!.push([
    { x: 70, y: 40 },
    { x: 90, y: 40 },
    { x: 90, y: 60 },
    { x: 70, y: 60 },
  ]);
  paint.opacity = 0.6;
  paint.gradient = {
    kind: 'linear',
    from: { x: 0, y: 0 },
    to: { x: 200, y: 0 },
    stops: [
      { offset: 0, color: '#ff0000' },
      { offset: 1, color: '#0000ff' },
    ],
  };
  const before = clone(paint),
    owner = captureAttachedFillEdit([paint, source], ['line']);
  const [out] = owner.prepare([bendEdge(source, 0, 0.5, { x: 0, y: -20 })]);
  expect(out.contours![1]).toEqual(before.contours![1]);
  expect(out.gradient).toEqual(before.gradient);
  out.contours![0][0].x += 100;
  out.gradient!.stops[0].color = '#ffffff';
  expect(paint).toEqual(before);
});

it('rejects malformed or changed source topology without partial source edits', () => {
  const source = line(),
    paint = fill(),
    before = structuredClone({ source, paint });
  const owner = captureAttachedFillEdit([paint, source], ['line']);
  expect(() => owner.prepare([])).toThrow();
  const changed = clone(source);
  changed.nodes!.push({ x: 300, y: 0 });
  expect(() => owner.prepare([changed])).toThrow(/topology/);
  changed.nodes![0].x = NaN;
  expect(() => owner.prepare([changed])).toThrow();
  expect({ source, paint }).toEqual(before);
});

it('shared world edges follow the line when the fill uses a different affine basis', () => {
  const source = line(),
    paint = fill();
  source.transform = [-1, 0.2, 0.3, 1];
  paint.x = 0;
  paint.y = 0;
  paint.transform = [1, 0.1, 0.2, 1];
  const m = matrix(paint);
  paint.contours = fill().contours!.map((r) =>
    r.map((n) => inversePoint(m, mapPoint(matrix(source), n))),
  );
  const [out] = captureAttachedFillEdit([paint, source], ['line']).prepare([
    bendEdge(source, 0, 0.5, { x: 5, y: -25 }),
  ]);
  const bent = bendEdge(source, 0, 0.5, { x: 5, y: -25 });
  for (const [actual, expected] of [
    [nodes(out)[0].out!, nodes(bent)[0].out!],
    [nodes(out)[1].in!, nodes(bent)[1].in!],
  ]) {
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
  }
  expect(out.transform).toEqual(paint.transform);
  expect(out.pivot).toEqual(paint.pivot);
  valid([out, bent]);
});

it('conflicting attached endpoint edits reject the complete preparation without modifying either fill', () => {
  const source = line(),
    other = line(),
    paint = fill();
  other.id = 'second';
  other.nodes = [
    { x: 0, y: 0 },
    { x: -30, y: -30 },
  ];
  const a = clone(source),
    b = clone(other);
  moveAnchors(a, source, [0], 10, 0);
  moveAnchors(b, other, [0], 20, 0);
  const before = structuredClone({ source, other, paint });
  const owner = captureAttachedFillEdit([paint, source, other], ['line', 'second']);
  expect(() => owner.prepare([a, b])).toThrow(/disagree/);
  expect({ source, other, paint }).toEqual(before);
  expect(owner.prepare([source, other])).toEqual([paint]);
});

it('shared-corner conflicts use document coordinates even with a large fill basis', () => {
  const source = line(),
    other = line(),
    paint = fill();
  other.id = 'second';
  other.nodes = [
    { x: 0, y: 0 },
    { x: -30, y: -30 },
  ];
  paint.transform = [1000000, 0, 0, 1000000];
  paint.contours = paint.contours!.map((r) =>
    r.map((n) => ({ x: n.x / 1000000, y: n.y / 1000000 })),
  );
  const a = clone(source),
    b = clone(other);
  moveAnchors(a, source, [0], 0.01, 0);
  moveAnchors(b, other, [0], 0.02, 0);
  const owner = captureAttachedFillEdit([paint, source, other], ['line', 'second']);
  expect(() => owner.prepare([a, b])).toThrow(/disagree/);
  expect(owner.prepare([source, other])).toEqual([paint]);
});

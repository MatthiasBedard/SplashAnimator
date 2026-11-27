import { it, expect } from 'vitest';
import { newProject, validateProject, type Vector, type Point } from '../packages/document/src';
import { pickBendEdge, bendEdge, editableEdgeOutline } from '../packages/geometry/src/edge-bend';
import { worldPoint } from '../packages/geometry/src';
function fixture(kind = 'line'): Vector {
  return {
    id: 'art',
    kind: kind as Vector['kind'],
    x: 40,
    y: 50,
    width: 120,
    height: 80,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 3,
    points:
      kind === 'path'
        ? [
            { x: 0, y: 0 },
            { x: 120, y: 0 },
            { x: 120, y: 80 },
          ]
        : [],
    pivot: { x: 20, y: 10 },
  };
}
function cubic(a: Point, b: Point, c: Point, d: Point, t: number) {
  return {
    x: (1 - t) ** 3 * a.x + 3 * (1 - t) ** 2 * t * b.x + 3 * (1 - t) * t * t * c.x + t ** 3 * d.x,
    y: (1 - t) ** 3 * a.y + 3 * (1 - t) ** 2 * t * b.y + 3 * (1 - t) * t * t * c.y + t ** 3 * d.y,
  };
}
for (const kind of ['line', 'path', 'rectangle', 'ellipse', 'compound', 'bezier'])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`bends selected ${kind}/${basis} at the grabbed point while keeping anchors and paint`, () => {
      const s = fixture(kind);
      if (kind === 'compound') {
        s.kind = 'polygon';
        s.fillRule = 'evenodd';
        s.contours = [
          [
            { x: 0, y: 0 },
            { x: 120, y: 0 },
            { x: 120, y: 80 },
            { x: 0, y: 80 },
          ],
          [
            { x: 20, y: 20 },
            { x: 40, y: 20 },
            { x: 40, y: 40 },
          ],
        ];
      }
      if (kind === 'bezier') {
        s.nodes = [
          { x: 0, y: 0, out: { x: 30, y: 20 } },
          { x: 120, y: 0, in: { x: 90, y: 20 } },
          { x: 120, y: 80 },
        ];
      }
      if (basis !== 'plain') s.transform = [basis === 'reflected' ? -1.4 : 1.4, 0.2, 0.3, 1.1];
      const before = structuredClone(s),
        outline = editableEdgeOutline(s)!,
        lists = outline.contours ?? [outline.nodes!],
        ring = lists[0],
        a = ring[0],
        b = ring[1],
        t = 0.4;
      const point = worldPoint(outline, cubic(a, a.out ?? a, b.in ?? b, b, t));
      const hit = pickBendEdge(s, point, 3)!;
      expect(hit).toBeDefined();
      const result = bendEdge(hit.outline, hit.index, hit.t, { x: 12, y: -17 }),
        outRing = (result.contours ?? [result.nodes!])[0];
      const p = worldPoint(
        result,
        cubic(outRing[0], outRing[0].out!, outRing[1].in!, outRing[1], hit.t),
      );
      // A line's new linear parameter corresponds to its geometric grabbed point.
      expect(p.x).toBeCloseTo(point.x + 12, 3);
      expect(p.y).toBeCloseTo(point.y - 17, 3);
      expect({ ...outRing[0], out: undefined }).toEqual({ ...ring[0], out: undefined });
      expect({ ...outRing[1], in: undefined }).toEqual({ ...ring[1], in: undefined });
      expect(outRing.slice(2)).toEqual(ring.slice(2));
      if (result.contours) expect(result.contours.slice(1)).toEqual(s.contours!.slice(1));
      expect(result.pivot).toEqual(s.pivot);
      expect(result.transform).toEqual(s.transform);
      expect(result.x).toBe(s.x);
      expect(result.fill).toBe(s.fill);
      expect(s).toEqual(before);
      const project = newProject();
      project.layers[0].keys[0].shapes = [result];
      validateProject(project);
    });
it('rejects invalid targets and singular transforms without touching the source', () => {
  const s = editableEdgeOutline(fixture())!,
    before = structuredClone(s);
  for (const t of [NaN, 0, 1, -1]) expect(() => bendEdge(s, 0, t, { x: 5, y: 2 })).toThrow();
  expect(() => bendEdge(s, 0, 0.5, { x: Infinity, y: 0 })).toThrow();
  s.transform = [0, 0, 0, 0];
  expect(() => bendEdge(s, 0, 0.5, { x: 5, y: 2 })).toThrow(/inverted/);
  delete s.transform;
  expect(s).toEqual(before);
});
it('does not reinterpret raw Brush, text or symbol geometry as an editable edge', () => {
  for (const kind of ['brush', 'text', 'symbol'])
    expect(editableEdgeOutline(fixture(kind))).toBeUndefined();
});

it('bends a hole closing seam with ring-local ownership and leaves its outer ring exact', () => {
  const s = fixture('polygon');
  s.fillRule = 'evenodd';
  s.contours = [
    [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 80 },
      { x: 0, y: 80 },
    ],
    [
      { x: 20, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 40 },
    ],
  ];
  const before = structuredClone(s),
    hit = pickBendEdge(s, worldPoint(s, { x: 30, y: 30 }), 2)!;
  expect(hit.index).toBe(6);
  expect(hit.end).toBe(4);
  const result = bendEdge(hit.outline, hit.index, hit.t, { x: 0, y: 10 });
  expect(result.contours![0]).toEqual(s.contours[0]);
  expect(result.contours![1][2].out).toBeDefined();
  expect(result.contours![1][0].in).toBeDefined();
  expect(s).toEqual(before);
});

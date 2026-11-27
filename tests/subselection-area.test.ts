import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import {
  selectAnchorBox,
  prepareAnchorSetEdit,
  subselectionNodes,
} from '../apps/editor/src/subselection';
import {
  captureMergeNodeSets,
  restoreMergeNodeSets,
} from '../apps/editor/src/merge-node-selection';
import { worldPoint } from '../packages/geometry/src';

function artwork(): Vector[] {
  const a: Vector = {
    id: 'a',
    kind: 'bezier',
    x: 50,
    y: 60,
    width: 180,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    fillEnabled: false,
    stroke: '#223344',
    strokeWidth: 4,
    points: [],
    nodes: [
      { x: 0, y: 0, out: { x: 20, y: 0 } },
      { x: 80, y: 30, in: { x: 60, y: 30 } },
      { x: 180, y: 0 },
    ],
  };
  return [
    a,
    {
      ...structuredClone(a),
      id: 'b',
      x: 50,
      y: 150,
      transform: [1, 0.2, 0.2, 1],
      nodes: [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 160, y: 0 },
      ],
    },
  ];
}
it('box-selects only anchors across artwork and affine bases, without writes or tangent-only picks', () => {
  const art = artwork(),
    before = structuredClone(art);
  expect(selectAnchorBox(art, { x: 35, y: 45 }, { x: 145, y: 178 }, {}, 'replace')).toEqual({
    a: [0, 1],
    b: [0, 1],
  });
  expect(selectAnchorBox(art, { x: 69, y: 59 }, { x: 71, y: 61 }, {}, 'replace')).toEqual({});
  expect(art).toEqual(before);
});
for (const mode of ['add', 'subtract', 'intersect'] as const)
  it(`combines ${mode} anchor boxes across identities`, () => {
    const expected =
      mode === 'add'
        ? { a: [0, 1], b: [0, 2] }
        : mode === 'subtract'
          ? { a: [0, 1], b: [0] }
          : { b: [2] };
    expect(
      selectAnchorBox(
        artwork(),
        { x: 200, y: 175 },
        { x: 220, y: 190 },
        { a: [0, 1], b: [0, 2] },
        mode,
      ),
    ).toEqual(expected);
  });
for (const basis of [
  [1, 0.2, 0.2, 1],
  [-1, 0.2, 0.2, 1],
  [0.001, 0, 0, 1000],
] as const)
  it(`moves all selected anchors and their handles by one world displacement under ${basis}`, () => {
    const art = artwork();
    art[1].transform = [...basis];
    const before = structuredClone(art);
    const next = prepareAnchorSetEdit(art, { a: [0, 1], b: [0, 1] }, { x: 20, y: 15 });
    next.forEach((s, j) =>
      subselectionNodes(s).forEach((node, i) => {
        const original = subselectionNodes(art[j])[i],
          a = worldPoint(art[j], original),
          b = worldPoint(s, node);
        expect(b.x - a.x).toBeCloseTo(i < 2 ? 20 : 0, 7);
        expect(b.y - a.y).toBeCloseTo(i < 2 ? 15 : 0, 7);
        for (const part of ['in', 'out'] as const)
          if (original[part]) {
            const x = worldPoint(art[j], original[part]!),
              y = worldPoint(s, node[part]!);
            expect(y.x - x.x).toBeCloseTo(i < 2 ? 20 : 0, 7);
            expect(y.y - x.y).toBeCloseTo(i < 2 ? 15 : 0, 7);
          }
      }),
    );
    expect(art).toEqual(before);
  });
it('exposes primitive vertices without writes and promotes only an actual edit', () => {
  const s: Vector = {
      ...artwork()[0],
      kind: 'rectangle',
      nodes: undefined,
      points: [],
      width: 80,
      height: 60,
    },
    art = [s],
    before = structuredClone(art);
  expect(selectAnchorBox(art, { x: 45, y: 55 }, { x: 60, y: 70 }, {}, 'replace')).toEqual({
    a: [0],
  });
  expect(prepareAnchorSetEdit(art, { a: [0] }, { x: 0, y: 0 })).toEqual(before);
  const [next] = prepareAnchorSetEdit(art, { a: [0] }, { x: 10, y: 20 });
  expect(next.kind).toBe('bezier');
  expect(worldPoint(next, subselectionNodes(next)[0])).toEqual({ x: 60, y: 80 });
  expect(art).toEqual(before);
});
it('edits compound rings without crossing ring identities or moving other rings', () => {
  const s: Vector = {
    ...artwork()[0],
    kind: 'polygon',
    nodes: undefined,
    fillEnabled: true,
    fillRule: 'evenodd',
    contours: [
      [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 80 },
      ],
      [
        { x: 20, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 40 },
      ],
    ],
  };
  const [next] = prepareAnchorSetEdit([s], { a: [3] }, { x: 5, y: 7 });
  expect(next.contours![0]).toEqual(s.contours![0]);
  expect(next.contours![1][1]).toEqual(s.contours![1][1]);
  expect(next.contours![1][0]).toEqual({ x: 25, y: 27 });
});
it('rejects an invalid later deletion before changing any artwork', () => {
  const art = artwork();
  art[0].nodes!.push({ x: 200, y: 20 });
  const before = structuredClone(art);
  expect(() => prepareAnchorSetEdit(art, { a: [0], b: [0, 1] }, 'delete')).toThrow(/at least/);
  expect(art).toEqual(before);
});
for (const failure of ['stale', 'NaN', 'singular', 'overflow'] as const)
  it(`rejects ${failure} atomically`, () => {
    const art = artwork(),
      sets = failure === 'stale' ? { a: [0], b: [100] } : { a: [0], b: [0] };
    if (failure === 'singular') art[1].transform = [0, 0, 0, 0];
    const delta = {
      x: failure === 'NaN' ? NaN : failure === 'overflow' ? Number.MAX_VALUE : 20,
      y: 15,
    };
    if (failure === 'overflow') art[1].nodes![0].x = Number.MAX_VALUE;
    const before = structuredClone(art);
    expect(() => prepareAnchorSetEdit(art, sets, delta)).toThrow();
    expect(art).toEqual(before);
  });
it('restores anchor sets across detached/reordered merge output with new identities', () => {
  const art = artwork(),
    captures = captureMergeNodeSets(art, { a: [0, 1], b: [0, 1] }, 'b', {
      index: 1,
      part: 'anchor',
    });
  const output = structuredClone(art).reverse();
  output[0].id = 'new-b';
  output[1].id = 'new-a';
  const result = restoreMergeNodeSets(captures, output);
  expect(result.sets).toEqual({ 'new-a': [0, 1], 'new-b': [0, 1] });
  expect(result.focus?.id).toBe('new-b');
});

import { it, expect } from 'vitest';
import type { Vector } from '../packages/document/src';
import { worldPoint } from '../packages/geometry/src';
import { mergeVectors } from '../packages/geometry/src/merge';
import {
  captureMergeNodeSelection,
  restoreMergeNodeSelection,
} from '../apps/editor/src/merge-node-selection';

const path = (): Vector => ({
  id: 'original',
  kind: 'bezier',
  x: 50,
  y: 70,
  width: 160,
  height: 40,
  rotation: 0,
  fill: '#ff0000',
  fillEnabled: false,
  stroke: '#123456',
  strokeWidth: 4,
  points: [],
  nodes: [
    { x: 0, y: 0, out: { x: 20, y: -10 } },
    { x: 80, y: 40, in: { x: 50, y: 40 }, out: { x: 110, y: 40 } },
    { x: 160, y: 0, in: { x: 140, y: -10 } },
  ],
});
for (const basis of [
  [1, 0, 0, 1],
  [1, 0.2, 0.3, 0.8],
  [-1, 0.1, 0.2, 1],
] as const)
  it(`recovers original selected world anchors through actual merged curves ${basis}`, () => {
    const source = path();
    source.transform = [...basis];
    const before = structuredClone(source),
      capture = captureMergeNodeSelection(source, [0, 1], { index: 1, part: 'anchor' })!;
    const result = mergeVectors([source], undefined, true),
      output = structuredClone(result),
      restored = restoreMergeNodeSelection(capture, result)!;
    expect(restored.indices).toHaveLength(2);
    const shape = result.find((s) => s.id === restored.id)!;
    const target = worldPoint(source, source.nodes![1]),
      point = worldPoint(shape, (shape.nodes ?? shape.points)[restored.pick!.index]);
    expect(point.x).toBeCloseTo(target.x, 7);
    expect(point.y).toBeCloseTo(target.y, 7);
    expect(source).toEqual(before);
    expect(result).toEqual(output);
  });

it('reversed curve traversal preserves the actual selected tangent role', () => {
  const source = path(),
    capture = captureMergeNodeSelection(source, [1], { index: 1, part: 'out' })!,
    reversed = structuredClone(source);
  reversed.id = 'rebuilt';
  reversed.nodes = source
    .nodes!.slice()
    .reverse()
    .map((n) => ({ ...n, in: n.out, out: n.in }));
  const restored = restoreMergeNodeSelection(capture, [reversed])!;
  expect(restored).toEqual({ id: 'rebuilt', indices: [1], pick: { index: 1, part: 'in' } });
});

it('matches closing and additional contour indices after ring rotation', () => {
  const source = path();
  source.fillEnabled = true;
  source.strokeWidth = 0;
  source.nodes = undefined;
  source.contours = [
    [
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 160, y: 100 },
      { x: 0, y: 100 },
    ],
    [
      { x: 30, y: 30 },
      { x: 30, y: 60 },
      { x: 60, y: 60 },
      { x: 60, y: 30 },
    ],
  ];
  const capture = captureMergeNodeSelection(source, [4, 7], { index: 7, part: 'anchor' })!,
    changed = structuredClone(source);
  changed.id = 'rebuilt';
  changed.contours = changed.contours!.map((r) => [...r.slice(2), ...r.slice(0, 2)]);
  const restored = restoreMergeNodeSelection(capture, [changed])!;
  expect(restored.id).toBe('rebuilt');
  expect(new Set(restored.indices)).toEqual(new Set([6, 5]));
  expect(restored.pick).toEqual({ index: 5, part: 'anchor' });
});

it('does not select overlapping output of a different paint', () => {
  const source = path(),
    capture = captureMergeNodeSelection(source, [1], { index: 1, part: 'anchor' })!,
    other = structuredClone(source),
    same = structuredClone(source);
  other.id = 'wrong';
  other.stroke = '#ff0000';
  same.id = 'right';
  expect(restoreMergeNodeSelection(capture, [other, same])!.id).toBe('right');
});

it('keeps a surviving straight line without inventing a removed collinear anchor', () => {
  const source = path();
  source.kind = 'path';
  source.nodes = undefined;
  source.points = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 160, y: 0 },
  ];
  const capture = captureMergeNodeSelection(source, [1], { index: 1, part: 'anchor' })!,
    result = structuredClone(source);
  result.id = 'line';
  result.points = [source.points[0], source.points[2]];
  const before = structuredClone(result);
  expect(restoreMergeNodeSelection(capture, [result])).toEqual({
    id: 'line',
    indices: [],
    pick: null,
  });
  expect(result).toEqual(before);
});

it('does not restore an anchor that no longer contributes visible artwork', () => {
  const source = path(),
    capture = captureMergeNodeSelection(source, [1], { index: 1, part: 'anchor' })!;
  expect(restoreMergeNodeSelection(capture, [])).toBeUndefined();
  expect(captureMergeNodeSelection(source, [99], { index: 99, part: 'anchor' })).toBeUndefined();
});

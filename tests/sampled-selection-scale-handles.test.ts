import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import {
  sampledGroupScaleHandles,
  sampledSelectionScaleBounds,
  sampledSelectionScaleHandles,
} from '../apps/editor/src/sampled-scale-handles';

const shape: Vector = {
  id: 'a',
  kind: 'rectangle',
  x: 10,
  y: 20,
  width: 12,
  height: 8,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
  transform: [2, 0.5, 0.25, 1],
};
const members = [
  shape,
  {
    ...shape,
    id: 'b',
    x: 60,
    y: -5,
    width: 10,
    height: 20,
    transform: [-1, 0, 0.5, 2] as Vector['transform'],
  },
];
const view = {
  origin: { x: 100, y: 80 },
  zoom: 0.5,
  width: 400,
  height: 240,
  cssWidth: 300,
  cssHeight: 100,
};

it('derives complete original affine/reflected union bounds with independent corner coordinates and no writes', () => {
  const before = structuredClone(members);
  // Original corners: A (10,20),(34,26),(12,28),(36,34);
  // B (60,-5),(50,-5),(70,35),(60,35).
  expect(sampledSelectionScaleBounds(members)).toEqual({
    left: 10,
    right: 70,
    top: -5,
    bottom: 35,
  });
  expect(members).toEqual(before);
});
it('keeps an explicit off-view pivot and true document anchors while projecting independent CSS scales', () => {
  const box = sampledSelectionScaleBounds(members),
    pivot = { x: -400, y: 900 },
    before = structuredClone({ box, pivot });
  const h = sampledSelectionScaleHandles(box, pivot, view, { x: 1.5, y: 0.75 }).handles.find(
    (h) => h.id === 'se',
  )!;
  expect(h.anchor).toEqual({ x: 70, y: 35 });
  const x = -400 + 1.5 * (70 + 400),
    y = 900 + 0.75 * (35 - 900);
  expect(h.point).toEqual({ x: ((x * 0.5 + 100) * 300) / 400, y: ((y * 0.5 + 80) * 100) / 240 });
  expect({ box, pivot }).toEqual(before);
});
it('matches existing group display exactly when the explicitly captured pivot is its default union pivot', () => {
  const box = sampledSelectionScaleBounds(members),
    pivot = { x: 40, y: 15 };
  const legacy = sampledGroupScaleHandles(members, view, { x: 2, y: 0.5 });
  expect(legacy.pivot).toEqual(pivot);
  expect(
    sampledSelectionScaleHandles(box, pivot, view, { x: 2, y: 0.5 }).handles.map(
      ({ id, point }) => ({ id, point }),
    ),
  ).toEqual(legacy.handles);
});
it('preserves existing pivot viability and flat-box edge handles without inventing corners', () => {
  const box = { left: 10, right: 70, top: 20, bottom: 20 };
  expect(
    sampledSelectionScaleHandles(box, { x: 40, y: 20 }, view).handles.map((h) => h.id),
  ).toEqual(['scale-e', 'scale-w']);
  const ordinary = { ...box, top: 0 };
  expect(
    sampledSelectionScaleHandles(ordinary, { x: 10, y: 0 }, view).handles.map((h) => h.id),
  ).toEqual(['se', 'scale-e', 'scale-s']);
});
for (const kind of ['empty', 'bounds', 'pivot', 'factor', 'view'])
  it('rejects unresolved raw selection display geometry: ' + kind, () => {
    const box = sampledSelectionScaleBounds(members),
      pivot = { x: 40, y: 15 };
    expect(() => {
      if (kind === 'empty') sampledSelectionScaleBounds([]);
      else
        sampledSelectionScaleHandles(
          kind === 'bounds' ? { ...box, left: NaN } : box,
          kind === 'pivot' ? { x: Infinity, y: 15 } : pivot,
          kind === 'view' ? { ...view, cssWidth: 0 } : view,
          kind === 'factor' ? { x: Infinity, y: 1 } : { x: 1, y: 1 },
        );
    }).toThrow();
  });

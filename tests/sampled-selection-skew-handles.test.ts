import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { sampledSelectionScaleBounds } from '../apps/editor/src/sampled-scale-handles';

import {
  sampledSelectionSkewHandles,
  sampledGroupSkewHandles,
  sampledSkewAngle,
} from '../apps/editor/src/sampled-skew-handles';
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

for (const axis of ['x', 'y'] as const)
  it(
    'projects original anchors and an off-view shared pivot with independent CSS scales ' + axis,
    () => {
      const box = sampledSelectionScaleBounds(members),
        pivot = { x: -400, y: 900 },
        before = structuredClone({ box, pivot }),
        degrees = 25,
        k = Math.tan((degrees * Math.PI) / 180),
        h = sampledSelectionSkewHandles(box, pivot, view, axis, degrees);
      for (const p of h.handles) {
        const x = p.anchor.x + (axis === 'x' ? k * (p.anchor.y - pivot.y) : 0),
          y = p.anchor.y + (axis === 'y' ? k * (p.anchor.x - pivot.x) : 0);
        expect(p.point).toEqual({
          x: ((x * 0.5 + 100) * 300) / 400,
          y: ((y * 0.5 + 80) * 100) / 240,
        });
        expect(p.axis).toBe(p.id === 'skew-n' || p.id === 'skew-s' ? 'x' : 'y');
      }
      expect({ box, pivot }).toEqual(before);
    },
  );
it('matches the legacy complete-group display without changing its edge viability', () => {
  const box = sampledSelectionScaleBounds(members),
    pivot = { x: 40, y: 15 },
    legacy = sampledGroupSkewHandles(members, view, 'x', 20),
    actual = sampledSelectionSkewHandles(box, pivot, view, 'x', 20);
  expect(actual.handles.map(({ id, point }) => ({ id, point }))).toEqual(legacy.handles);
  expect(actual.outline).toEqual(legacy.outline);
  expect(
    sampledSelectionSkewHandles(
      { left: 10, right: 70, top: 20, bottom: 20 },
      { x: 40, y: 20 },
      view,
    ).handles.map((h) => h.id),
  ).toEqual(['skew-e', 'skew-w']);
});
for (const edge of ['skew-n', 'skew-e', 'skew-s', 'skew-w'])
  it('uses the original edge axis and Shift snapping ' + edge, () => {
    const box = { left: 10, right: 70, top: -5, bottom: 35 },
      pivot = { x: 40, y: 15 },
      h = sampledSelectionSkewHandles(box, pivot, view).handles.find((h) => h.id === edge)!,
      k = Math.tan((23 * Math.PI) / 180),
      end = {
        x: h.anchor.x + (h.axis === 'x' ? k * (h.anchor.y - pivot.y) : 0),
        y: h.anchor.y + (h.axis === 'y' ? k * (h.anchor.x - pivot.x) : 0),
      };
    expect(sampledSkewAngle(edge, box, pivot, h.anchor, end, false).degrees).toBeCloseTo(23, 12);
    const snapped = sampledSkewAngle(edge, box, pivot, h.anchor, end, true);
    expect(snapped.axis).toBe(h.axis);
    expect(snapped.degrees).toBeCloseTo(30, 12);
  });
for (const kind of ['bounds', 'pivot', 'view', 'angle', 'axis'])
  it('rejects unresolved display data ' + kind, () => {
    const box = sampledSelectionScaleBounds(members),
      pivot = { x: 40, y: 15 };
    expect(() =>
      sampledSelectionSkewHandles(
        kind === 'bounds' ? { ...box, left: NaN } : box,
        kind === 'pivot' ? { x: Infinity, y: 15 } : pivot,
        kind === 'view' ? { ...view, cssWidth: 0 } : view,
        kind === 'axis' ? ('z' as 'x') : 'x',
        kind === 'angle' ? 90 : 0,
      ),
    ).toThrow();
  });

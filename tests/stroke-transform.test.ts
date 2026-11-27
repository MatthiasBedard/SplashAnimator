import { expect, test } from 'vitest';
import type { Vector } from '../packages/document/src';
import { around, mapPoint, matrix, multiply } from '../packages/geometry/src/affine';
import { transformSelectionVectors } from '../packages/geometry/src/stroke-transform';

const identity = around({ x: 0, y: 0 }, 1, 0, 0, 1);
const shear = around({ x: 15, y: 40 }, 1, 0, 1.25, 1);
const ink: Vector = {
  id: 'ink', kind: 'bezier', x: 3, y: 5, width: 16, height: 20, rotation: 30,
  transform: [-2, .1, .2, 1.5], points: [],
  nodes: [{ x: 0, y: 0, out: { x: 6, y: 3 } }, { x: 16, y: 20, in: { x: 11, y: 8 } }],
  fill: '#ffffff', fillEnabled: false, stroke: '#000000', strokeWidth: 6,
  strokeCap: 'square', strokeJoin: 'bevel', pivot: { x: 4, y: 9 },
};

for (const combined of [false, true]) {
  test(`skew preserves the pen and maps every anchor, handle and pivot with combined scale ${combined}`, () => {
    const moved = structuredClone(ink);
    const pen = combined ? around({ x: 8, y: 4 }, 0, 2, -.5, 0) : identity;
    const operation = multiply(pen, shear);
    const fill: Vector = { ...ink, id: 'fill', kind: 'rectangle', strokeWidth: 0, nodes: undefined, fillEnabled: true };
    const fillPose = multiply(operation, matrix(fill));
    transformSelectionVectors([moved, fill], operation, pen);
    expect(matrix(moved).slice(0, 4)).toEqual(multiply(pen, matrix(ink)).slice(0, 4));
    expect(matrix(fill)).toEqual(fillPose);
    expect(moved).toMatchObject({ kind: 'bezier', strokeWidth: 6, strokeCap: 'square', strokeJoin: 'bevel' });
    if (!combined) expect(moved.rotation).toBe(ink.rotation);
    const from = [ink.nodes![0], ink.nodes![0].out!, ink.nodes![1], ink.nodes![1].in!, ink.pivot!];
    const to = [moved.nodes![0], moved.nodes![0].out!, moved.nodes![1], moved.nodes![1].in!, moved.pivot!];
    from.forEach((point, index) => {
      const expected = mapPoint(operation, mapPoint(matrix(ink), point));
      const actual = mapPoint(matrix(moved), to[index]);
      expect(actual.x).toBeCloseTo(expected.x, 10);
      expect(actual.y).toBeCloseTo(expected.y, 10);
    });
  });
}

test('a rejected later transform leaves every earlier member intact', () => {
  const originals = [ink, { ...ink, id: 'later', y: 100000 }];
  const selection = structuredClone(originals);
  expect(() => transformSelectionVectors(selection, shear, identity)).toThrow('geometry limits');
  expect(selection).toEqual(originals);
});

test('a line keeps both attachment points on a transformed fill', () => {
  const line: Vector = {
    ...ink, kind: 'line', points: [{x:0,y:0},{x:16,y:20}], nodes: undefined,
    rotation: 0, transform: undefined,
  };
  const fill: Vector = {...line,id:'fill',kind:'rectangle',fillEnabled:true,strokeWidth:0};
  transformSelectionVectors([line, fill], around({x:11,y:15},1,0,2,1), identity);
  expect(line.points.map(point=>mapPoint(matrix(line),point))).toEqual(
    [{x:0,y:0},{x:16,y:20}].map(point=>mapPoint(matrix(fill),point)),
  );
  expect(line.strokeWidth).toBe(6);
});

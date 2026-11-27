import { expect, it } from 'vitest';
import { newProject, type Vector } from '../packages/document/src';
import { multiFrameId } from '../packages/animation/src/multi-frame';
import { moveRangeAnchors } from '../apps/editor/src/multi-frame-anchor';

function scene() {
  const p = newProject(),
    layer = p.layers[0];
  layer.drawingMode = 'merge';
  const line: Vector = {
    id: 'line',
    kind: 'bezier',
    x: 20,
    y: 40,
    width: 80,
    height: 0,
    rotation: 0,
    points: [],
    nodes: [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
    ],
    fill: '#000000',
    fillEnabled: false,
    stroke: '#000000',
    strokeWidth: 2,
  };
  const paint: Vector = {
    ...line,
    id: 'fill',
    kind: 'polygon',
    fillEnabled: true,
    closed: true,
    strokeWidth: 0,
    height: 60,
    fillRule: 'evenodd',
    contours: [
      [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 60 },
        { x: 0, y: 60 },
      ],
    ],
  };
  delete paint.nodes;
  layer.keys[0].shapes = [paint, line];
  const move = (ids: string[], index: number) =>
    moveRangeAnchors(
      p,
      [layer.id],
      0,
      0,
      ids.map((id) => multiFrameId(layer.id, 0, id)),
      index,
      { x: 8, y: 4 },
    );
  return { p, move };
}

it('moving a fill endpoint carries the stroke and its intermediate boundary point', () => {
  const { p, move } = scene(),
    before = structuredClone(p);
  const [fill, line] = move(['fill'], 1).layers[0].keys[0].shapes;
  expect(line.nodes).toEqual([
    { x: 8, y: 4 },
    { x: 80, y: 0 },
  ]);
  expect(fill.contours![0]).toEqual([
    { x: 8, y: 4 },
    { x: 44, y: 2 },
    { x: 80, y: 0 },
    { x: 80, y: 60 },
    { x: 0, y: 60 },
  ]);
  expect(move(['line', 'fill'], 1).layers[0].keys[0].shapes).toEqual([fill, line]);
  expect(p).toEqual(before);
});
it('rejects a fill subdivision without a stroke anchor and still admits an independent corner', () => {
  const { p, move } = scene(),
    before = structuredClone(p);
  expect(() => move(['fill'], 2)).toThrow(/inside an attached stroke/);
  const [fill, line] = move(['fill'], 4).layers[0].keys[0].shapes;
  expect(fill.contours![0][3]).toEqual({ x: 88, y: 64 });
  expect(line).toEqual(before.layers[0].keys[0].shapes[1]);
  expect(p).toEqual(before);
});

import { expect, it } from 'vitest';
import { clone, newProject, type Vector } from '../packages/document/src';
import { createStageOpacityView } from '../packages/animation/src/stage-opacity';
import { evaluate } from '../packages/animation/src';
it('overlays held root opacity without modifying layer keys, artwork selection or clock origins', () => {
  const p = newProject();
  p.duration = 10;
  const l = p.layers[0],
    art: Vector = {
      id: 'art',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      opacity: 0.5,
    };
  p.symbols = [
    {
      id: 'sym',
      name: 'Graphic',
      width: 20,
      height: 20,
      shapes: [art],
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#00ff00' }] }] },
    },
  ];
  l.keys = [
    { frame: 0, shapes: [] },
    {
      frame: 1,
      shapes: [{ ...art, id: 'root', kind: 'symbol', symbolId: 'sym', opacity: 0 }, art],
    },
    { frame: 7, shapes: [] },
  ];
  p.opacityBindings = [
    {
      layerId: l.id,
      shapeId: 'root',
      start: 2,
      end: 5,
      keys: [
        { frame: 2, opacity: 1 },
        { frame: 4, opacity: 0 },
      ],
    },
  ];
  const before = clone(p),
    view = createStageOpacityView(p);
  expect(view(1)).toBe(p);
  expect(view(6)).toBe(p);
  const at = view(2);
  expect(at.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 7]);
  expect(at.layers[0].keys[1].shapes[1]).toBe(art);
  expect(evaluate(at, 2)[0]).toMatchObject({ fill: '#00ff00', opacity: 0.5 });
  expect(evaluate(view(3), 3)[0]).toMatchObject({ fill: '#ff0000', opacity: 0.25 });
  expect(p).toEqual(before);
});

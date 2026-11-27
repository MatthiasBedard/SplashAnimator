import { expect, it } from 'vitest';
import { clone, type SymbolDefinition } from '../packages/document/src';
import {
  symbolMultiFrameProject,
  symbolFromMultiFrameProject,
} from '../packages/animation/src/symbol-multi-frame';
import { translateMultiFrames, deleteMultiFrames } from '../packages/animation/src/multi-frame';
it('roundtrips edited base and additional tracks without losing symbol metadata, holds or identities', () => {
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const d: SymbolDefinition = {
    id: 'd',
    name: 'Draft',
    width: 100,
    height: 100,
    shapes: [art],
    timeline: {
      duration: 6,
      keys: [{ frame: 3, shapes: [{ ...art, x: 50 }] }],
      layers: [
        {
          id: 'extra',
          name: 'Extra',
          visible: true,
          locked: false,
          keys: [{ frame: 0, shapes: [{ ...art, id: 'other', x: 80 }] }],
        },
      ],
    },
  };
  const before = clone(d),
    p = symbolMultiFrameProject(d, [d], []);
  const moved = symbolFromMultiFrameProject(
    d,
    translateMultiFrames(p, ['@base', 'extra'], 1, 4, 5, 6),
  );
  expect(moved.shapes[0].x).toBe(15);
  expect(moved.timeline!.keys[0].shapes[0].x).toBe(55);
  expect(moved.timeline!.layers![0].keys[0].shapes[0].x).toBe(85);
  expect(moved.timeline!.keys[0].frame).toBe(3);
  expect(moved.name).toBe('Draft');
  expect(d).toEqual(before);
  const blank = symbolFromMultiFrameProject(d, deleteMultiFrames(p, ['@base'], 3, 4, null));
  expect(blank.shapes).toEqual(d.shapes);
  expect(blank.timeline!.keys).toEqual([{ frame: 3, shapes: [] }]);
  expect(blank.timeline!.layers).toEqual(d.timeline!.layers);
  p.layers[1].locked = true;
  expect(() => translateMultiFrames(p, ['@base', 'extra'], 0, 4, 1, 1)).toThrow('unlocked');
});

import { it, expect } from 'vitest';
import { newLayer, newProject } from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import {
  symbolEditContext,
  symbolTrackEditContext,
  nestedSymbolEditContext,
} from '../packages/geometry/src/symbol-context';
import { mapPoint, inversePoint } from '../packages/geometry/src/affine';
it('captures detached visible paint order and the full instance affine basis', () => {
  const p = newProject();
  const shape = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 40,
    height: 30,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const definition = { id: 'def', name: 'Static', width: 100, height: 50, shapes: [shape] };
  p.symbols = [definition];
  const instance = symbolInstance(definition, 200, 80);
  instance.width = 200;
  instance.height = 100;
  instance.transform = [-1, 0.2, 0.3, 1];
  p.layers[0].keys[0].shapes = [{ ...shape, id: 'under' }, instance, { ...shape, id: 'over' }];
  const c = symbolEditContext(p, p.layers[0].id, instance.id, 0);
  expect(c.under.map((s) => s.id)).toEqual(['under']);
  expect(c.over.map((s) => s.id)).toEqual(['over']);
  expect(mapPoint(c.matrix, { x: 10, y: 20 })).toEqual({ x: 192, y: 124 });
  const local = inversePoint(c.matrix, { x: 192, y: 124 });
  expect(local.x).toBeCloseTo(10);
  expect(local.y).toBeCloseTo(20);
  c.under[0].fill = '#000000';
  expect(p.layers[0].keys[0].shapes[0].fill).toBe('#ff0000');
  p.layers[0].locked = true;
  expect(() => symbolEditContext(p, p.layers[0].id, instance.id, 0)).toThrow('editable');
});

it('resolves graphic offsets and snapshots other local tracks at the edited frame', () => {
  const p = newProject();
  p.duration = 10;
  const art = {
    id: 'a',
    kind: 'rectangle' as const,
    x: 5,
    y: 10,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const def = {
    id: 'def',
    name: 'Timeline',
    width: 100,
    height: 100,
    shapes: [art],
    timeline: {
      duration: 4,
      keys: [],
      layers: [
        {
          id: 'top',
          name: 'Top',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [] },
            { frame: 2, shapes: [{ ...art, id: 'top-art' }] },
          ],
        },
      ],
    },
  };
  p.symbols = [def];
  const instance = symbolInstance(def, 100, 50);
  instance.symbolPlayback = { mode: 'once', firstFrame: 1 };
  p.layers[0].keys[0].shapes = [instance];
  const c = symbolEditContext(p, p.layers[0].id, instance.id, 7);
  expect(c.initialFrame).toBe(3);
  const local = symbolTrackEditContext(c, def, '@base', 3, p.symbols);
  expect(local.artworkFrame).toBe(3);
  expect(local.over[0]).toMatchObject({ x: 105, y: 60 });
  expect(local.under).toEqual([]);
  instance.symbolPlayback = { mode: 'loop', firstFrame: 1 };
  expect(symbolEditContext(p, p.layers[0].id, instance.id, 4).initialFrame).toBe(1);
  instance.symbolPlayback = { mode: 'single', firstFrame: 2 };
  expect(symbolEditContext(p, p.layers[0].id, instance.id, 7).initialFrame).toBe(2);
  instance.symbolPlayback = { mode: 'movie', firstFrame: 2 };
  expect(symbolEditContext(p, p.layers[0].id, instance.id, 7).initialFrame).toBe(2);
  expect(def.timeline.layers[0].keys[1].shapes[0].x).toBe(5);
  p.symbols[0].buttonStates = { up: 1, over: 2, down: 3, hit: 0 };
  expect(symbolEditContext(p, p.layers[0].id, instance.id, 7).initialFrame).toBe(1);
});

it('composes nested instance bases and surrounding paint without mutating definitions', () => {
  const p = newProject();
  const art = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const child = { id: 'child', name: 'Child', width: 50, height: 50, shapes: [art] };
  const nested = symbolInstance(child, 20, 10);
  nested.width = 100;
  nested.height = 100;
  nested.rotation = 90;
  const parent = {
    id: 'parent',
    name: 'Parent',
    width: 100,
    height: 100,
    shapes: [{ ...art, id: 'under' }, nested, { ...art, id: 'over' }],
  };
  p.symbols = [parent, child];
  const root = symbolInstance(parent, 300, 100);
  root.width = 200;
  root.height = 200;
  p.layers[0].keys[0].shapes = [root];
  const target = newLayer('Outside paint'), mask = newLayer('Outside mask');
  target.keys[0].shapes = [{ ...art, id: 'outside' }];
  mask.keys[0].shapes = [{ ...art, id: 'mask-art' }];
  p.layers.push(target, mask);
  p.layerMasks = [{ maskLayerId: mask.id, layerIds: [target.id] }];
  const context = symbolEditContext(p, p.layers[0].id, root.id, 0),
    next = nestedSymbolEditContext(context, parent, nested.id, p.symbols);
  const point = mapPoint(next.matrix, { x: 5, y: 6 });
  expect(point.x).toBeCloseTo(316);
  expect(point.y).toBeCloseTo(140);
  expect(next.under.map((s) => s.id)).toEqual(['under']);
  expect(next.over.map((s) => s.id)).toEqual(['over', 'outside', 'mask-art']);
  expect(next.referenceLayers).toEqual({
    root: p.layers[0].id, under: [null], over: [null, target.id, mask.id],
  });
  expect(next.under[0].x).toBe(300);
  expect(parent.shapes[0].x).toBe(0);
  expect(context.under).toEqual([]);
  const animatedChild = { ...child, timeline: { duration: 8, keys: [] } };
  nested.symbolPlayback = { mode: 'loop', firstFrame: 1 };
  const animatedParent = {
    ...parent,
    timeline: {
      duration: 10,
      keys: [],
      layers: [
        {
          id: 'track',
          name: 'Track',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [] },
            { frame: 2, shapes: [nested] },
          ],
        },
      ],
    },
  };
  const snapshot = JSON.stringify(animatedParent);
  const tracked = nestedSymbolEditContext(
    context,
    animatedParent,
    nested.id,
    [animatedParent, animatedChild],
    { layerId: 'track', frame: 5 },
  );
  expect(tracked.initialFrame).toBe(4);
  expect(tracked.matrix).toEqual(next.matrix);
  expect(tracked.under.map((s) => s.id)).toContain('under');
  expect(tracked.referenceLayers).toEqual({
    root: p.layers[0].id, under: [null, null, null], over: [target.id, mask.id],
  });
  expect(JSON.stringify(animatedParent)).toBe(snapshot);
  animatedParent.timeline.layers[0].locked = true;
  expect(() =>
    nestedSymbolEditContext(context, animatedParent, nested.id, [animatedParent, animatedChild], {
      layerId: 'track',
      frame: 5,
    }),
  ).toThrow('editable');
  animatedParent.timeline.layers[0].locked = false;
  expect(() =>
    nestedSymbolEditContext(context, animatedParent, nested.id, [animatedParent, animatedChild], {
      layerId: 'track',
      frame: 10,
    }),
  ).toThrow('frame');
});

import { prepareMaskedLayerPainter } from '../packages/stage/src/masked-layers';
import { it, expect, vi, afterEach } from 'vitest';
import { newProject, newLayer, type Vector } from '../packages/document/src';
import { evaluate, evaluateLayers } from '../packages/animation/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import {
  prepareLayerScene,
  withLayerScene,
  disposeLayerScene,
  type LayerArtwork,
  type PreparedLayerScene,
} from '../packages/animation/src/layer-scene';
import { admitMaskRaster, MASK_WORKING_PIXELS } from '../packages/stage/src/mask-budget';
const art = (id: string): Vector => ({
  id,
  kind: 'rectangle',
  x: 1,
  y: 2,
  width: 20,
  height: 30,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
function fixture() {
  const p = newProject();
  p.duration = 5;
  p.layers = [
    { ...newLayer('Target'), id: 'target', keys: [{ frame: 0, shapes: [art('a')] }] },
    { ...newLayer('Mask'), id: 'mask', keys: [{ frame: 0, shapes: [art('m')] }] },
  ];
  return p;
}
const masks = [{ maskLayerId: 'mask', layerIds: ['target'] }];
afterEach(() => vi.restoreAllMocks());
it('captures complete immutable private layers without source writes or forged handles', () => {
  const p = fixture(),
    before = structuredClone(p);
  let calls = 0;
  const scene = prepareLayerScene(p, 2, masks, (snapshot, f) => {
    calls++;
    return evaluateLayers(snapshot, f);
  });
  expect(calls).toBe(1);
  expect(scene).toEqual({ frame: 2, layerIds: ['target', 'mask'], maskSourceIds: ['mask'] });
  withLayerScene(scene, (data) => {
    expect(data.layers[0].shapes[0]).toEqual(before.layers[0].keys[0].shapes[0]);
    expect(data.layers[0].shapes[0]).not.toBe(p.layers[0].keys[0].shapes[0]);
    expect(Object.isFrozen(data.layers[0].shapes[0])).toBe(true);
  });
  expect(p).toEqual(before);
  expect(() => withLayerScene({ ...scene }, () => {})).toThrow(/stale/);
  disposeLayerScene(scene);
  expect(() => withLayerScene(scene, () => {})).toThrow(/disposed/);
});
it('layer evaluation exactly matches legacy flattening and forwards original movie namespace/frame values', () => {
  const p = fixture(),
    child = {
      id: 'child',
      name: 'Child',
      width: 40,
      height: 40,
      shapes: [art('inside')],
      timeline: { duration: 5, keys: [{ frame: 3, shapes: [{ ...art('inside'), x: 80 }] }] },
    };
  p.symbols = [child];
  const instance = {
    ...symbolInstance(child, 4, 5),
    id: 'instance',
    symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
  };
  p.layers[0].keys[0].shapes = [instance];
  for (const frame of [-2, 0, 2, 4, 20])
    for (const local of [0, 3, 8]) {
      const clocks = { 'target/instance/child': local };
      expect(evaluateLayers(p, frame, clocks).flatMap((l) => l.shapes)).toEqual(
        evaluate(p, frame, clocks),
      );
    }
  p.layers[0].visible = false;
  expect(evaluateLayers(p, 2)[0]).toEqual({ layerId: 'target', shapes: [] });
});
it('already-resolved host artwork never owns original layer membership', () => {
  const p = fixture(),
    before = structuredClone(p),
    display = [
      { layerId: 'target', shapes: [{ ...art('posed/child'), x: 77 }] },
      { layerId: 'mask', shapes: [art('m')] },
    ];
  const scene = prepareLayerScene(p, 1, masks, () => display);
  display[0].shapes[0].x = 99;
  withLayerScene(scene, (data) => expect(data.layers[0].shapes[0].x).toBe(77));
  expect(p).toEqual(before);
});
for (const change of [
  'missing',
  'reorder',
  'hidden',
  'symbol',
  'numeric',
  'snapshot',
  'source',
  'async',
] as const)
  it('rejects resolved ' + change + ' before publishing', () => {
    const p = fixture(),
      before = structuredClone(p);
    if (change === 'hidden') p.layers[0].visible = false;
    const resolve = (snapshot: typeof p) => {
      const output = evaluateLayers(snapshot, 0);
      if (change === 'missing') output.pop();
      if (change === 'reorder') output.reverse();
      if (change === 'hidden') output[0].shapes = [art('forged')];
      if (change === 'symbol')
        output[0].shapes = [{ ...art('x'), kind: 'symbol', symbolId: 'missing' }];
      if (change === 'numeric') output[0].shapes[0].x = NaN;
      if (change === 'snapshot') snapshot.background = '#00ff00';
      if (change === 'source') p.name = 'outside';
      return change === 'async' ? Promise.resolve(output) : output;
    };
    expect(() =>
      prepareLayerScene(p, 0, masks, resolve as (snapshot: typeof p) => LayerArtwork[]),
    ).toThrow();
    if (change === 'source') before.name = 'outside';
    if (change === 'hidden') before.layers[0].visible = false;
    expect(p).toEqual(before);
  });
for (const change of ['shape', 'metadata', 'revision', 'restore', 'dispose'] as const)
  it('observed ' + change + ' invalidates scene reuse permanently', () => {
    const p = fixture();
    let revision = 0,
      controlValue = 0;
    const scene = prepareLayerScene(p, 0, masks, evaluateLayers, {
      validate: () => {
        if (revision || controlValue !== 0) throw Error('revision');
      },
    });
    if (change === 'shape') p.layers[0].keys[0].shapes[0].x++;
    if (change === 'metadata') p.name = 'changed';
    if (change === 'revision') revision++;
    if (change === 'restore') {
      controlValue = 1;
      revision++;
      controlValue = 0;
      revision++;
    }
    if (change === 'dispose') disposeLayerScene(scene);
    expect(() => withLayerScene(scene, () => {})).toThrow();
    revision = 0;
    p.layers[0].keys[0].shapes[0].x = 1;
    p.name = 'Untitled';
    expect(() => withLayerScene(scene, () => {})).toThrow();
  });
it('swallowed preparation/read reentry and asynchronous reads reject', () => {
  const p = fixture();
  expect(() =>
    prepareLayerScene(p, 0, masks, () => {
      try {
        prepareLayerScene(p, 0, masks, evaluateLayers);
      } catch {
        /* swallowed */
      }
      return evaluateLayers(p, 0);
    }),
  ).toThrow(/changed/);
  const scene = prepareLayerScene(p, 0, masks, evaluateLayers);
  expect(() =>
    withLayerScene(scene, () => {
      try {
        withLayerScene(scene, () => {});
      } catch {
        /* swallowed */
      }
    }),
  ).toThrow();
  const fresh = prepareLayerScene(p, 0, masks, evaluateLayers);
  expect(() => withLayerScene(fresh, async () => {})).toThrow(/synchronous/);
});
it('rejects original accessors without invoking them and source clone tampering', () => {
  const p = fixture();
  let reads = 0;
  Object.defineProperty(p.layers[0].keys[0].shapes[0], 'x', {
    get() {
      reads++;
      return 1;
    },
  });
  expect(() => prepareLayerScene(p, 0, masks, evaluateLayers)).toThrow(/data/);
  expect(reads).toBe(0);
  const valid = fixture(),
    clone = structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const result = clone(value) as typeof valid;
    if (result.layers) result.background = '#00ff00';
    return result;
  }) as typeof structuredClone);
  expect(() => prepareLayerScene(valid, 0, masks, evaluateLayers)).toThrow(/cloning/);
});
it('decoded images and raster planning share the existing pixel budget', () => {
  expect(() => admitMaskRaster(4096, 4096)).not.toThrow();
  expect(() => admitMaskRaster(4096, 4096, 1)).toThrow();
  expect(() => admitMaskRaster(1, 1, MASK_WORKING_PIXELS - 4)).not.toThrow();
  expect(() => admitMaskRaster(1, 1, MASK_WORKING_PIXELS - 3)).toThrow();
  for (const width of [NaN, Infinity, -1, 0.5, 16385])
    expect(() => admitMaskRaster(width, 1)).toThrow();
});
it('disposal during original validation invalidates the admitted handle', () => {
  const p = fixture();
  let close = false;
  const scene: PreparedLayerScene = prepareLayerScene(p, 0, masks, evaluateLayers, {
    validate: () => {
      if (close) disposeLayerScene(scene);
    },
  });
  close = true;
  expect(() => withLayerScene(scene, () => {})).toThrow(/disposed/);
});

for (const frame of [-1, 0.5, NaN, 5])
  it('rejects original scene frame ' + frame, () => {
    const p = fixture();
    let calls = 0;
    expect(() =>
      prepareLayerScene(p, frame, masks, (p, f) => {
        calls++;
        return evaluateLayers(p, f);
      }),
    ).toThrow();
    expect(calls).toBe(0);
  });
it('later mask rejection happens before resolving any layer', () => {
  const p = fixture();
  let calls = 0;
  expect(() =>
    prepareLayerScene(
      p,
      0,
      [...masks, { maskLayerId: 'missing', layerIds: ['target'] }],
      (p, f) => {
        calls++;
        return evaluateLayers(p, f);
      },
    ),
  ).toThrow();
  expect(calls).toBe(0);
});
it('detached pose cloning cannot change approved artwork', () => {
  const p = fixture(),
    clone = structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const copy = clone(value);
    if (Array.isArray(copy) && copy[0]?.shapes) copy[0].shapes[0].x = 99;
    return copy;
  }) as typeof structuredClone);
  expect(() => prepareLayerScene(p, 0, masks, evaluateLayers)).toThrow(/cloning/);
});
it('validation callback captures once and asynchronous validation rejects', () => {
  const p = fixture();
  let reads = 0;
  prepareLayerScene(p, 0, masks, evaluateLayers, {
    get validate() {
      reads++;
      return () => {};
    },
  });
  expect(reads).toBe(1);
  expect(() =>
    prepareLayerScene(p, 0, masks, evaluateLayers, { validate: () => Promise.resolve() }),
  ).toThrow(/synchronous/);
});

it('resource preparation rechecks elapsed deadline after synchronous original validation', async () => {
  const p = fixture();
  let now = 0,
    armed = false;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const scene = prepareLayerScene(p, 0, masks, evaluateLayers, {
    validate: () => {
      if (armed) now = 20;
    },
  });
  armed = true;
  await expect(prepareMaskedLayerPainter(scene, { timeoutMs: 10 })).rejects.toThrow(/timed out/);
  disposeLayerScene(scene);
});

it('derived large world bases and namespaced groups preserve exact legacy placements without authored-coordinate caps', () => {
  const p = fixture(),
    child = {
      id: 'child',
      name: 'Child',
      width: 1,
      height: 1,
      shapes: [{ ...art('inside'), x: 1000, groups: ['inner'] }],
    };
  p.symbols = [child];
  const instance = {
    ...symbolInstance(child, 2, 3),
    id: 'instance',
    width: 1000000,
    height: 1000000,
  };
  p.layers[0].keys[0].shapes = [instance];
  const before = structuredClone(p),
    legacy = evaluateLayers(p, 0),
    scene = prepareLayerScene(p, 0, masks, evaluateLayers);
  withLayerScene(scene, (data) => {
    expect(data.layers[0].shapes).toEqual(legacy[0].shapes);
    expect(data.layers[0].shapes[0].x).toBe(1000000002);
    expect(data.layers[0].shapes[0].transform).toEqual([1000000, 0, 0, 1000000]);
    expect(data.layers[0].shapes[0].groups).toEqual(['instance/inner']);
  });
  expect(p).toEqual(before);
  disposeLayerScene(scene);
});
for (const transform of [
  [1, 0, 0, NaN],
  [1, 0, 0, Infinity],
  [1, 0, 0, 'bad'],
])
  it('resolved world basis rejects invalid original components ' + String(transform[3]), () => {
    const p = fixture();
    expect(() =>
      prepareLayerScene(p, 0, masks, (snapshot, f) =>
        evaluateLayers(snapshot, f).map((layer) => ({
          ...layer,
          shapes: layer.shapes.map((shape) => ({
            ...shape,
            transform: transform as Vector['transform'],
          })),
        })),
      ),
    ).toThrow();
  });

it('defaults to saved mask ownership and invalidates when saved membership changes',()=>{
  const p=fixture();p.layerMasks=structuredClone(masks);
  const scene=prepareLayerScene(p,2,[],evaluateLayers);
  withLayerScene(scene,data=>expect(data.masks).toEqual(masks));
  delete p.layerMasks;expect(()=>withLayerScene(scene,()=>{})).toThrow();disposeLayerScene(scene);
});

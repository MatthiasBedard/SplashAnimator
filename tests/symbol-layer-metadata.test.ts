import { it, expect } from 'vitest';
import {
  newProject,
  validateProject,
  migrateProject,
  newLayer,
  symbolLayers,
  type Vector,
} from '../packages/document/src';
import {
  symbolFrame,
  symbolInstance,
  updateSymbolTimeline,
} from '../packages/geometry/src/symbols';
import { saveProject, loadProject, type DirectoryStore } from '../packages/document/src/storage';
import { finishSymbolScene, prepareSymbolScene } from '../apps/editor/src/symbol-scene-scope';
import {
  symbolMultiFrameProject,
  symbolFromMultiFrameProject,
} from '../packages/animation/src/symbol-multi-frame';
function fixture() {
  const p = newProject();
  const shape: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 30,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'clip',
      name: 'Clip',
      width: 100,
      height: 80,
      shapes: [shape],
      baseLayer: {
        name: 'Drawing',
        visible: true,
        locked: false,
        outline: true,
        outlineColor: '#e0a000',
      },
    },
  ];
  p.layers[0].keys[0].shapes = [symbolInstance(p.symbols[0], 40, 30)];
  return p;
}
it('base layer metadata exposes the same original layer fields without changing default legacy artwork', () => {
  const p = fixture(),
    d = p.symbols![0],
    before = structuredClone(p);
  expect(symbolLayers(d)[0]).toMatchObject({
    id: '@base',
    name: 'Drawing',
    visible: true,
    locked: false,
    outline: true,
    outlineColor: '#e0a000',
  });
  expect(validateProject(p)).toEqual(p);
  expect(symbolFrame(d, 0)).toEqual(d.shapes);
  expect(p).toEqual(before);
  delete d.baseLayer;
  expect(symbolLayers(d)[0]).toMatchObject({ name: 'Artwork', visible: true, locked: false });
  expect(migrateProject({ ...p, schemaVersion: 58 })).toEqual(p);
});
it('hidden static and animated base tracks keep their source while visible additional tracks remain', () => {
  const p = fixture(),
    d = p.symbols![0];
  d.baseLayer!.visible = false;
  expect(symbolFrame(d, 0)).toEqual([]);
  d.timeline = {
    duration: 4,
    keys: [],
    layers: [
      {
        id: 'extra',
        name: 'Above',
        visible: true,
        locked: false,
        keys: [{ frame: 0, shapes: [{ ...d.shapes[0], id: 'other' }] }],
      },
    ],
  };
  expect(symbolFrame(d, 2).map((s) => s.id)).toEqual(['other']);
  expect(d.shapes).toHaveLength(1);
  expect(validateProject(p)).toEqual(p);
});
for (const patch of [
  { name: '' },
  { visible: 1 },
  { locked: 'no' },
  { outline: 'yes' },
  { outlineColor: 'bad' },
  { keys: [] },
])
  it('rejects malformed original base metadata ' + JSON.stringify(patch), () => {
    const p = fixture();
    Object.assign(p.symbols![0].baseLayer!, patch);
    expect(() => validateProject(p)).toThrow();
  });
it('rejects unversioned metadata rather than silently downgrading layer behavior', () => {
  const p = fixture();
  for (const version of [0, 40, 57, 58])
    expect(() => migrateProject({ ...p, schemaVersion: version })).toThrow('schema 59');
});
it('frame adapters preserve metadata and all original fields through detached replacement', () => {
  const p = fixture(),
    d = p.symbols![0];
  d.timeline = { duration: 6, keys: [] };
  const project = symbolMultiFrameProject(d, p.symbols!, p.assets);
  project.layers[0].keys.push({ frame: 4, shapes: structuredClone(d.shapes) });
  const out = symbolFromMultiFrameProject(d, project);
  expect(out.baseLayer).toEqual(d.baseLayer);
  expect(out.timeline!.keys[0].frame).toBe(4);
  expect(d.timeline.keys).toEqual([]);
  out.baseLayer!.name = 'Detached';
  expect(d.baseLayer!.name).toBe('Drawing');
});
it('persists explicit additional-track drawing modes while preserving legacy inference and artwork', () => {
  const p = fixture(), definition = p.symbols![0];
  definition.timeline = { duration: 2, keys: [], layers: [newLayer('Legacy'), { ...newLayer('Change'), drawingMode: 'object' }] };
  const scope = prepareSymbolScene(p, definition)!;
  scope.project.layers[2].drawingMode = 'merge';
  scope.project.layers.push({ ...newLayer('New Object'), drawingMode: 'object' });
  const saved = finishSymbolScene(definition, scope.original, scope.project);
  expect(saved.timeline!.layers!.map(layer => layer.drawingMode)).toEqual([undefined, 'merge', 'object']);
  expect(saved.shapes).toEqual(definition.shapes);
  const reopened = { ...p, symbols: [saved] };
  expect(validateProject(reopened)).toEqual(reopened);
  expect(prepareSymbolScene(reopened, saved)!.project.layers.slice(1).map(layer => layer.drawingMode))
    .toEqual(['merge', 'merge', 'object']);
});

it('checks original symbol drawing mode metadata and retains Merge artwork restrictions', () => {
  const p = fixture(), d = p.symbols![0], layer = newLayer('Drawing');
  d.timeline = { duration: 1, keys: [], layers: [layer] };
  let reads = 0;
  Object.defineProperty(layer, 'drawingMode', { enumerable: true, configurable: true, get() { reads++; return 'merge'; } });
  expect(() => validateProject(p)).toThrow('drawing mode');
  expect(reads).toBe(0);
  Object.defineProperty(layer, 'drawingMode', { enumerable: true, value: 'merge' });
  layer.keys[0].shapes = [{ ...d.shapes[0], groups: ['group'] }];
  expect(() => validateProject(p)).toThrow('groups require object drawing');
});
it('schema59 directory save/reopen preserves layer preferences and open tweens and rejects an older manifest wrapper', async () => {
  const files = new Map<string, string>();
  const store: DirectoryStore = {
    read: async (p) => files.get(p)!,
    exists: async (p) => files.has(p),
    writeNew: async (p, s) => {
      if (files.has(p)) throw Error('exists');
      files.set(p, s);
    },
    commit: async (p, s) => {
      files.set(p, s);
    },
  };
  const p = fixture();
  p.layers[0].keys[0].openMotionTween = { affine: true, ease: 'out' };
  p.symbols![0].openMotionTween = { affine: false, ease: 'in-out' };
  p.symbols![0].timeline = {
    duration: 1, keys: [], layers: [{ ...newLayer('Merged paint'), drawingMode: 'merge' }],
  };
  const raw = await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
  const manifest = JSON.parse(raw);
  expect(manifest.schemaVersion).toBe(59);
  manifest.schemaVersion = 58;
  files.set('project.json', JSON.stringify(manifest));
  await expect(loadProject(store)).rejects.toThrow('schema 59 manifest');
});

it('timeline publication copies edited base metadata into the original library definition', () => {
  const p = fixture();
  delete p.symbols![0].baseLayer;
  const draft = structuredClone(p.symbols![0]);
  draft.baseLayer = {
    name: 'Ink',
    visible: false,
    locked: true,
    outline: true,
    outlineColor: '#ff8800',
  };
  updateSymbolTimeline(p, 'clip', draft);
  expect(p.symbols![0].baseLayer).toEqual(draft.baseLayer);
  draft.baseLayer.name = 'Unpublished';
  expect(p.symbols![0].baseLayer!.name).toBe('Ink');
});

for (const field of ['baseLayer', 'name'] as const)
  it(`rejects ${field} getters before reading new metadata`, () => {
    const p = fixture();
    let reads = 0;
    const owner = field === 'baseLayer' ? p.symbols![0] : p.symbols![0].baseLayer!;
    Object.defineProperty(owner, field, {
      enumerable: true,
      get() {
        reads++;
        throw Error('must not read');
      },
    });
    expect(() => validateProject(p)).toThrow('symbol base layer');
    expect(reads).toBe(0);
  });
it('rejects inherited, nonenumerable and symbol-keyed base preferences before normalization', () => {
  for (const kind of ['prototype', 'hidden', 'symbol']) {
    const p = fixture(),
      b = p.symbols![0].baseLayer!;
    if (kind === 'prototype') Object.setPrototypeOf(b, { name: 'Inherited' });
    else if (kind === 'hidden')
      Object.defineProperty(b, 'outline', { value: true, enumerable: false });
    else Object.assign(b, { [Symbol('hidden')]: true });
    expect(() => validateProject(p)).toThrow('symbol base layer');
  }
});

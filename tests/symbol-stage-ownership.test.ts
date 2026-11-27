import { afterEach, expect, it, vi } from 'vitest';
import { admitSymbolStageContext as admit } from '../apps/editor/src/symbol-stage-ownership';
import { symbolStageSimplifyFixture as fixture } from './symbol-stage-simplify-fixture';
import {
  symbolEditContext,
  nestedSymbolEditContext,
} from '../packages/geometry/src/symbol-context';
import { keyAt, symbolLayers } from '../packages/document/src';
afterEach(() => vi.restoreAllMocks());
it('requires the complete captured group path for a grouped stage entry', () => {
  const f = fixture(), project = f.input.project;
  const layer = project.layers.find(layer => layer.id === f.path.layerId)!;
  const instance = keyAt(layer, f.path.frame).shapes.find(shape => shape.id === f.path.instanceId)!;
  instance.groups = ['outer', 'inner'];
  const context = symbolEditContext(project, f.path.layerId, f.path.instanceId, f.path.frame);
  const path = { ...f.path, groups: ['outer', 'inner'] };
  const before = structuredClone({ project, context, path });
  admit(project, path, 'art', context);
  expect({ project, context, path }).toEqual(before);
  for (const groups of [[], ['outer'], ['outer', 'other']])
    expect(() => admit(project, { ...path, groups }, 'art', context)).toThrow(/captured group/);
  const substitute = new Proxy(['outer', 'other'], {
    get(target, key, receiver) {
      if (key === 'every') return () => true;
      return key === '1' ? 'inner' : Reflect.get(target, key, receiver);
    },
  });
  expect(() => admit(project, { ...path, groups: substitute }, 'art', context)).toThrow(/captured group/);
  instance.groups[1] = 'moved';
  expect(() => admit(project, path, 'art', context)).toThrow(/captured group/);
});

it('checks grouped child ancestry on the original parent exposure', () => {
  const f = fixture(true), project = f.input.project;
  const parent = project.symbols!.find(symbol => symbol.id === 'parent')!;
  const step = f.path.children[0];
  const child = parent.shapes.find(shape => shape.id === step.instanceId)!;
  child.groups = ['outer', 'inner'];
  const outer = symbolEditContext(project, f.path.layerId, f.path.instanceId, f.path.frame);
  const context = nestedSymbolEditContext(outer, parent, child.id, project.symbols!);
  step.groups = ['outer', 'inner'];
  admit(project, f.path, 'art', context);
  step.groups.pop();
  expect(() => admit(project, f.path, 'art', context)).toThrow(/captured group/);
  step.groups.push('inner');
  child.groups[0] = 'moved';
  expect(() => admit(project, f.path, 'art', context)).toThrow(/captured group/);
});

for (const nested of [false, true])
  for (const animated of [false, true])
    it(`admits original ${nested ? 'nested reflected' : 'root'} ${animated ? 'timeline/button' : 'static'} ownership without writes`, () => {
      const f = fixture(nested, animated),
        before = structuredClone(f);
      admit(f.input.project, f.path, 'art', f.context);
      expect(f).toStrictEqual(before);
    });
for (const field of [
  'instance',
  'target',
  'matrix',
  'under',
  'over',
  'frame',
  'opacity',
  'missing-parent',
] as const)
  it(`rejects substituted original stage ${field}`, () => {
    const f = fixture(true);
    if (field === 'instance') f.path.children[0].instanceId = 'missing';
    if (field === 'matrix') f.context.matrix[4]++;
    if (field === 'under') f.context.under = structuredClone(f.context.over);
    if (field === 'over') f.context.over = [];
    if (field === 'frame') f.path.frame = 0.5;
    if (field === 'opacity') f.context.opacity = 0.5;
    if (field === 'missing-parent') f.path.children = [];
    expect(() =>
      admit(f.input.project, f.path, field === 'target' ? 'unrelated' : 'art', f.context),
    ).toThrow();
  });
it('validates the original timeline ancestor track and exposure before reaching a child', () => {
  const f = fixture(true),
    p = f.input.project,
    parent = p.symbols!.find((s) => s.id === 'parent')!;
  parent.timeline = {
    duration: 8,
    keys: [],
    layers: [
      {
        id: 'detail',
        name: 'Detail',
        visible: true,
        locked: false,
        keys: [{ frame: 0, shapes: parent.shapes }],
      },
    ],
  };
  f.path.children[0].location = { layerId: 'detail', frame: 3 };
  const outer = symbolEditContext(p, f.path.layerId, f.path.instanceId, 0),
    child = keyAt(symbolLayers(parent)[1], 3).shapes[0];
  const context = nestedSymbolEditContext(
    outer,
    parent,
    child.id,
    p.symbols!,
    f.path.children[0].location,
  );
  admit(p, f.path, 'art', context);
  parent.timeline.layers![0].locked = true;
  expect(() => admit(p, f.path, 'art', context)).toThrow();
});
it('rejects raw context getters without reading them', () => {
  const f = fixture(),
    get = vi.fn(() => 1);
  Object.defineProperty(f.context, 'opacity', { enumerable: true, get });
  expect(() => admit(f.input.project, f.path, 'art', f.context)).toThrow();
  expect(get).not.toHaveBeenCalled();
});
it('uses original frame descriptor values instead of a proxy substitute', () => {
  const f = fixture();
  f.path.frame = 0.5;
  const path = new Proxy(f.path, {
    get(target, key, receiver) {
      return key === 'frame' ? 0 : Reflect.get(target, key, receiver);
    },
  });
  expect(() => admit(f.input.project, path, 'art', f.context)).toThrow();
});
it('rejects source changes made while complete detached context is reconstructed', () => {
  const f = fixture(),
    native = JSON.stringify;
  vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown, ...args: unknown[]) => {
    const out = Reflect.apply(native, JSON, [value, ...args]);
    if (value && typeof value === 'object' && 'matrix' in value && 'under' in value)
      f.input.project.background = '#abcdef';
    return out;
  }) as typeof JSON.stringify);
  expect(() => admit(f.input.project, f.path, 'art', f.context)).toThrow();
});

it('admits a saved single-frame button without silently adding a timeline', () => {
  const f = fixture();
  f.input.project.symbols![0].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  admit(f.input.project, f.path, 'art', f.context);
  expect(f.input.project.symbols![0].timeline).toBeUndefined();
});

it('resolves multiple original ancestors before reaching a button frame editor', () => {
  const f = fixture(true, true, 2);
  expect(f.path.children).toHaveLength(2);
  admit(f.input.project, f.path, 'art', f.context);
});

import { afterEach, expect, it, vi } from 'vitest';
import {
  captureNewFrameSymbolSimplifyContext as capture,
  captureNewStaticSymbolSimplifyContext,
  type NewStaticSymbolSimplifySource,
} from '../apps/editor/src/new-symbol-simplify-context';
import { symbolSimplifyFixture } from './symbol-simplify-fixture';
import { prepareSymbolSimplifyRequest as reduce } from '../packages/geometry/src/symbol-simplify-request';
import { captureIsolatedSymbolSimplifyContext } from '../apps/editor/src/isolated-symbol-simplify-context';
import { isolateSymbolGroup } from '../packages/geometry/src/symbol-artwork';
import { validateProject } from '../packages/document/src';

afterEach(() => vi.restoreAllMocks());
function fixture(kind: 'movie' | 'button' = 'movie', basis = 'plain') {
  const f = symbolSimplifyFixture(basis),
    artwork = structuredClone(f.project.symbols![0].shapes.slice(0, 2));
  const source: NewStaticSymbolSimplifySource = {
    project: f.project,
    definition: {
      id: 'draft',
      name: 'New prop',
      width: 400,
      height: 240,
      shapes: [],
      timeline: { duration: kind === 'button' ? 1 : 12, keys: [] },
      ...(kind === 'movie'
        ? { defaultPlayback: 'movie' as const }
        : { buttonStates: { up: 0, over: 0, down: 0, hit: 0 } }),
    },
    history: {},
    session: {},
    revision: 1,
    context: 'new',
    folder: '',
    eligible: true,
  };
  return { source, artwork };
}
for (const kind of ['movie', 'button'] as const)
  for (const basis of ['plain', 'reflected'])
    it(`prepares only the original ${basis} ${kind} initial frame without publishing`, () => {
      const f = fixture(kind, basis),
        before = structuredClone(f),
        ctx = capture(() => f.source, f.artwork);
      expect(ctx.location).toEqual({ layerId: '@base', frame: 0 });
      expect(Object.isFrozen(ctx.location)).toBe(true);
      const out = reduce({
        project: ctx.project,
        symbolId: 'draft',
        selected: ['line'],
        location: ctx.location,
      });
      expect(out.removed).toBeGreaterThan(100);
      expect(out.project.symbols!.slice(0, 2)).toStrictEqual(before.source.project.symbols);
      const added = out.project.symbols!.at(-1)!;
      expect({ ...added, shapes: [] }).toStrictEqual(before.source.definition);
      expect(f).toStrictEqual(before);
      expect(added.shapes[0]).not.toBe(f.artwork[0]);
      expect(() => captureNewStaticSymbolSimplifyContext(() => f.source, f.artwork)).toThrow(
        /static/,
      );
      ctx.validate();
      validateProject(out.project);
      const again = capture(() => f.source, structuredClone(added.shapes));
      expect(again.project.symbols!.at(-1)!.id).toBe('draft');
    });

for (const change of [
  'static',
  'graphic',
  'keys',
  'layers',
  'motion',
  'embedded',
  'mapping',
  'nonfinite',
] as const)
  it(`rejects unsupported original pending ${change} data before fitting`, () => {
    const f = fixture('button');
    if (change === 'static') {
      delete f.source.definition.timeline;
      delete f.source.definition.buttonStates;
    }
    if (change === 'graphic') delete f.source.definition.buttonStates;
    if (change === 'keys') f.source.definition.timeline!.keys = [{ frame: 1, shapes: [] }];
    if (change === 'layers')
      f.source.definition.timeline!.layers = [
        {
          id: 'extra',
          name: 'Extra',
          visible: true,
          locked: false,
          keys: [{ frame: 0, shapes: [] }],
        },
      ];
    if (change === 'motion') Object.assign(f.source.definition.timeline!, { motionSpans: [{}] });
    if (change === 'embedded') f.source.definition.shapes = f.artwork;
    if (change === 'mapping') f.source.definition.buttonStates!.hit = 4;
    if (change === 'nonfinite') f.source.definition.timeline!.duration = NaN;
    const before = structuredClone(f.source.project);
    expect(() => capture(() => f.source, f.artwork)).toThrow();
    expect(f.source.project).toStrictEqual(before);
  });
for (const change of ['source', 'header', 'input', 'session'] as const)
  it(`rejects changed original movie ${change} after detached preparation`, () => {
    const f = fixture(),
      ctx = capture(() => f.source, f.artwork);
    if (change === 'source') f.source.project.background = '#abcdef';
    if (change === 'header') f.source.definition.timeline!.duration++;
    if (change === 'input') f.artwork[0].x++;
    if (change === 'session') f.source.session = {};
    expect(() => ctx.validate()).toThrow(/changed/);
  });
it('composes original initial-frame relative group ownership without altering button maps', () => {
  const f = fixture('button'),
    parent = structuredClone(f.artwork),
    group = isolateSymbolGroup(parent, 'line'),
    local = group.artwork;
  const state = {
    artwork: parent,
    source: parent,
    session: {},
    past: [],
    future: [],
    symbolId: 'draft',
    group: 'outer',
    selected: 'line',
    revision: 0,
    context: 'group',
    eligible: true,
  };
  const ctx = captureIsolatedSymbolSimplifyContext(
    () => state,
    local,
    (art) => capture(() => f.source, art),
  );
  const out = reduce({
    project: ctx.project,
    symbolId: 'draft',
    selected: ['line'],
    location: ctx.location,
    ancestry: [...ctx.ancestry!],
  });
  expect(out.removed).toBeGreaterThan(0);
  expect(ctx.extract!(out.project)[1]).toStrictEqual(local[1]);
  expect(out.project.symbols!.at(-1)!.buttonStates).toStrictEqual(f.source.definition.buttonStates);
  expect(f.source.project.symbols).toHaveLength(2);
});
it('rejects a late original movie header edit during detached copying', () => {
  const f = fixture(),
    native = structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
    const copy = native(value);
    f.source.definition.timeline!.duration++;
    return copy;
  });
  expect(() => capture(() => f.source, f.artwork)).toThrow(/changed/);
  expect(f.source.project.symbols).toHaveLength(2);
});

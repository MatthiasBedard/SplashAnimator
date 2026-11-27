import { afterEach, expect, it, vi } from 'vitest';
import {
  captureFrameSymbolSimplifyContext as capture,
  type FrameSymbolSimplifySource,
} from '../apps/editor/src/frame-symbol-simplify-context';
import { captureIsolatedSymbolSimplifyContext } from '../apps/editor/src/isolated-symbol-simplify-context';
import { symbolSimplifyFrameFixture } from './symbol-simplify-frame-fixture';
import { symbolSimplifyArtwork as artwork } from '../packages/geometry/src/symbol-simplify-artwork';
import { prepareSymbolSimplifyRequest } from '../packages/geometry/src/symbol-simplify-request';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(button = false) {
  const input = symbolSimplifyFrameFixture('reflected', button),
    definition = structuredClone(input.project.symbols![0]);
  const source: FrameSymbolSimplifySource = {
    project: input.project,
    definition,
    history: {},
    session: {},
    revision: 0,
    location: { layerId: 'detail', frame: 6 },
    context: 'original frame',
    eligible: true,
  };
  const shapes = structuredClone(artwork(definition, source.location));
  shapes[0].x += 5;
  return { source, shapes };
}
for (const button of [false, true])
  it(`prepares complete ${button ? 'button' : 'movie'} local frame data and extracts detached results`, () => {
    const { source, shapes } = fixture(button),
      before = structuredClone(source.project),
      draft = structuredClone(source.definition),
      ctx = capture(() => source, shapes);
    expect(ctx.location).toEqual(source.location);
    expect(Object.isFrozen(ctx.location)).toBe(true);
    expect(artwork(ctx.project.symbols![0], ctx.location)).toStrictEqual(shapes);
    const result = prepareSymbolSimplifyRequest({
      project: ctx.project,
      symbolId: 'art',
      location: ctx.location,
      selected: ['line'],
    });
    const out = ctx.extract!(result.project);
    expect(out[0].nodes!.length).toBeLessThan(241);
    expect(out[0].x).toBe(shapes[0].x);
    expect(source.project).toStrictEqual(before);
    expect(source.definition).toStrictEqual(draft);
    ctx.validate();
    out[0].nodes![0].x++;
    expect(ctx.extract!(result.project)[0]).not.toEqual(out[0]);
  });
for (const field of [
  'project',
  'definition',
  'history',
  'session',
  'revision',
  'location',
  'context',
  'eligible',
] as const)
  it(`rejects changed original ${field}`, () => {
    const { source, shapes } = fixture(),
      ctx = capture(() => source, shapes);
    if (field === 'project') source.project = structuredClone(source.project);
    if (field === 'definition') source.definition = structuredClone(source.definition);
    if (field === 'history') source.history = {};
    if (field === 'session') source.session = {};
    if (field === 'revision') source.revision++;
    if (field === 'location') source.location = { layerId: '@base', frame: 4 };
    if (field === 'context') source.context = 'new';
    if (field === 'eligible') source.eligible = false;
    expect(() => ctx.validate()).toThrow();
  });
it('admits neither changed original data nor changed actual local input', () => {
  const a = fixture(),
    ctx = capture(() => a.source, a.shapes);
  a.source.project.symbols![1].name = 'changed';
  expect(() => ctx.validate()).toThrow();
  const b = fixture(),
    other = capture(() => b.source, b.shapes);
  b.shapes[0].x++;
  expect(() => other.validate()).toThrow();
});
it('rejects raw getters and malformed discarded draft data before replacement', () => {
  const { source, shapes } = fixture(),
    get = vi.fn(() => source.project);
  const bad = { ...source };
  Object.defineProperty(bad, 'project', { enumerable: true, get });
  expect(() => capture(() => bad, shapes)).toThrow();
  expect(get).not.toHaveBeenCalled();
  source.definition.timeline!.keys[0].shapes[0].x = NaN;
  expect(() => capture(() => source, shapes)).toThrow();
});
it('rejects late clone/source changes and prepared-input mutations', () => {
  const { source, shapes } = fixture(),
    clone = structuredClone;
  let armed = true;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = clone(value);
    if (armed) {
      armed = false;
      source.definition.name = 'late';
    }
    return out;
  });
  expect(() => capture(() => source, shapes)).toThrow();
  vi.unstubAllGlobals();
  const b = fixture(),
    ctx = capture(() => b.source, b.shapes);
  ctx.project.symbols![1].name = 'mutated';
  expect(() => ctx.validate()).toThrow();
});
it('refuses returned changes outside the original frame', () => {
  const { source, shapes } = fixture(),
    ctx = capture(() => source, shapes),
    result = prepareSymbolSimplifyRequest({
      project: ctx.project,
      symbolId: 'art',
      location: ctx.location,
      selected: ['line'],
    });
  result.project.symbols![0].shapes[0].x++;
  expect(() => ctx.extract!(result.project)).toThrow(/Unrelated/);
});
it('composes original relative group ownership/extraction within an additional frame', () => {
  const { source } = fixture(true),
    parent = structuredClone(artwork(source.definition, source.location));
  const local = parent
    .filter((s) => s.groups?.[0] === 'outer')
    .map((s) => {
      const out = structuredClone(s);
      out.groups = s.groups!.slice(1);
      if (!out.groups.length) delete out.groups;
      return out;
    });
  const session = {},
    past: unknown[] = [],
    future: unknown[] = [];
  const ctx = captureIsolatedSymbolSimplifyContext(
    () => ({
      artwork: parent,
      source: parent,
      session,
      past,
      future,
      symbolId: 'art',
      group: 'outer',
      selected: 'line',
      revision: 0,
      context: 'frame group',
      eligible: true,
    }),
    local,
    (edited) => capture(() => source, edited),
  );
  expect(ctx.location).toEqual(source.location);
  expect(ctx.ancestry).toEqual(['outer']);
  const result = prepareSymbolSimplifyRequest({
    project: ctx.project,
    symbolId: 'art',
    location: ctx.location,
    ancestry: [...ctx.ancestry!],
    selected: ['line'],
  });
  const out = ctx.extract!(result.project);
  expect(out[0].nodes!.length).toBeLessThan(241);
  expect(out[0].groups).toEqual(['inner']);
  expect(out[1]).toStrictEqual(local[1]);
  ctx.validate();
});

it('rejects corruption of copied reduced output after host admission', () => {
  const { source, shapes } = fixture(),
    ctx = capture(() => source, shapes),
    result = prepareSymbolSimplifyRequest({
      project: ctx.project,
      symbolId: 'art',
      location: ctx.location,
      selected: ['line'],
    });
  const clone = structuredClone;
  let changed = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = clone(value),
      list = out as { nodes?: unknown[]; fill: string }[];
    if (Array.isArray(list) && list[0]?.nodes && list[0].nodes.length < 241) {
      changed = true;
      list[0].fill = '#00ff00';
    }
    return out;
  });
  expect(() => ctx.extract!(result.project)).toThrow(/changed/);
  expect(changed).toBe(true);
});

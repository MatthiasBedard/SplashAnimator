import { afterEach, expect, it, vi } from 'vitest';
import {
  captureIsolatedSymbolSimplifyContext as capture,
  replaceIsolatedSymbolGroup,
  type IsolatedSymbolSimplifySource,
} from '../apps/editor/src/isolated-symbol-simplify-context';
import {
  captureStaticSymbolSimplifyContext,
  type StaticSymbolSimplifyContext,
  type StaticSymbolSimplifySource,
} from '../apps/editor/src/symbol-simplify-context';
import { isolateSymbolGroup } from '../packages/geometry/src/symbol-artwork';
import { prepareSymbolSimplifyRequest as reduce } from '../packages/geometry/src/symbol-simplify-request';
import { symbolSimplifyFixture } from './symbol-simplify-fixture';
import { selectionTrajectoryStamp as stamp } from '../packages/animation/src/selection-trajectory';
import { validateProject, type Vector } from '../packages/document/src';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(basis = 'plain') {
  const input = symbolSimplifyFixture(basis),
    parent = JSON.parse(JSON.stringify(input.project.symbols![0].shapes)) as Vector[],
    root: StaticSymbolSimplifySource = {
      project: input.project,
      history: {},
      session: {},
      revision: 0,
      symbolId: 'art',
      context: 'root',
      eligible: true,
    },
    state: IsolatedSymbolSimplifySource = {
      artwork: parent,
      source: parent,
      session: {},
      past: [],
      future: [],
      symbolId: 'art',
      group: 'outer',
      selected: 'line',
      revision: 0,
      context: 'parent',
      eligible: true,
    },
    local = isolateSymbolGroup(parent, 'line').artwork,
    prepare = (art: Vector[]) => captureStaticSymbolSimplifyContext(() => root, art);
  return { root, state, local, prepare };
}
const run = (context: StaticSymbolSimplifyContext, selected = ['line']) =>
  reduce({ project: context.project, symbolId: 'art', selected, ancestry: [...context.ancestry!] });
for (const basis of ['plain', 'affine', 'reflected'])
  it(`overlays and extracts only original ${basis} isolated artwork without publishing`, () => {
    const f = fixture(basis),
      before = structuredClone(f.root.project),
      parent = structuredClone(f.state.artwork);
    f.local[0].x += 12;
    const context = capture(() => f.state, f.local, f.prepare),
      result = run(context),
      out = context.extract!(result.project);
    expect(context.ancestry).toEqual(['outer']);
    expect(result.selected).toEqual(['line']);
    expect(out.map((s) => s.id)).toEqual(['line', 'paint']);
    expect(out[0].groups).toEqual(['inner']);
    expect(out[1].groups).toBeUndefined();
    expect(out[0].x).toBe(f.local[0].x);
    expect(out[0].nodes!.length).toBeLessThan(f.local[0].points.length);
    expect(out[1]).toStrictEqual(f.local[1]);
    expect(result.project.symbols![0].shapes[2]).toStrictEqual(parent[2]);
    expect(f.state.artwork).toStrictEqual(parent);
    expect(f.root.project).toStrictEqual(before);
    context.validate();
    validateProject(result.project);
    out[0].nodes![0].x++;
    expect(context.extract!(result.project)).not.toEqual(out);
  });
it('composes nested isolation boundaries and retains complete enclosing parent drafts', () => {
  const f = fixture();
  f.state.artwork[2].x += 30;
  f.local[1].fill = '#0000ff';
  const nestedState: IsolatedSymbolSimplifySource = {
      ...f.state,
      artwork: f.local,
      source: f.local,
      group: 'inner',
      session: {},
      context: 'nested',
    },
    nested = isolateSymbolGroup(f.local, 'line').artwork,
    context = capture(
      () => nestedState,
      nested,
      (art) => capture(() => f.state, art, f.prepare),
    ),
    out = run(context),
    local = context.extract!(out.project);
  expect(context.ancestry).toEqual(['outer', 'inner']);
  expect(out.selected).toEqual(['line']);
  expect(local).toHaveLength(1);
  expect(local[0].groups).toBeUndefined();
  expect(out.project.symbols![0].shapes[1].fill).toBe('#0000ff');
  expect(out.project.symbols![0].shapes[2].x).toBe(f.state.artwork[2].x);
  expect(out.project.symbols![0].shapes[0].groups).toEqual(['outer', 'inner']);
});
it('keeps a minimal original isolated unit an exact detached no-op', () => {
  const f = fixture();
  f.state.artwork[2].groups = ['alone'];
  f.state.group = 'alone';
  f.state.selected = 'other';
  const local = isolateSymbolGroup(f.state.artwork, 'other').artwork,
    ctx = capture(() => f.state, local, f.prepare),
    result = run(ctx, ['other']);
  expect(result.removed).toBe(0);
  expect(ctx.extract!(result.project)).toStrictEqual(local);
});
for (const key of [
  'source',
  'session',
  'past',
  'future',
  'symbolId',
  'group',
  'selected',
  'revision',
  'context',
  'eligible',
  'artwork',
  'local',
  'library',
] as const)
  it(`rejects original ${key} changes before extract or publication`, () => {
    const f = fixture(),
      context = capture(() => f.state, f.local, f.prepare),
      out = run(context);
    if (['source', 'session', 'past', 'future'].includes(key)) f.state[key as 'source'] = {};
    if (key === 'symbolId') f.state.symbolId = 'other';
    if (key === 'group') f.state.group = 'inner';
    if (key === 'selected') f.state.selected = 'paint';
    if (key === 'revision') f.state.revision++;
    if (key === 'context') f.state.context = 'changed';
    if (key === 'eligible') f.state.eligible = false;
    if (key === 'artwork') f.state.artwork[2].x++;
    if (key === 'local') f.local[0].x++;
    if (key === 'library') f.root.project.symbols![1].name = 'changed';
    expect(() => context.validate()).toThrow();
    expect(() => context.extract!(out.project)).toThrow();
  });
it('admits new plain snapshots of the unchanged original parent reference', () => {
  const f = fixture(),
    ctx = capture(
      () => ({ ...f.state, artwork: structuredClone(f.state.artwork) }),
      f.local,
      f.prepare,
    );
  expect(ctx.extract!(run(ctx).project)[0].groups).toEqual(['inner']);
});
it('rejects changed-and-restored context revisions', () => {
  const f = fixture(),
    ctx = capture(() => f.state, f.local, f.prepare);
  f.state.selected = 'paint';
  f.state.revision++;
  f.state.selected = 'line';
  expect(() => ctx.validate()).toThrow();
});
for (const key of ['artwork', 'session', 'group'] as const)
  it(`rejects original ${key} getters without reading them`, () => {
    const f = fixture(),
      getter = vi.fn(() => f.state[key]);
    Object.defineProperty(f.state, key, { get: getter });
    expect(() => capture(() => f.state, f.local, f.prepare)).toThrow(/data/);
    expect(getter).not.toHaveBeenCalled();
  });
for (const value of [NaN, Infinity])
  it(`rejects raw local ${value} without altering parent artwork`, () => {
    const f = fixture(),
      before = structuredClone(f.state.artwork);
    f.local[0].x = value;
    expect(() => capture(() => f.state, f.local, f.prepare)).toThrow();
    expect(f.state.artwork).toStrictEqual(before);
  });
it('validates original parent values even when isolated edits would replace them', () => {
  const f = fixture();
  f.state.artwork[0].kind = 'invalid' as Vector['kind'];
  expect(() => capture(() => f.state, f.local, f.prepare)).toThrow();
});
for (const kind of ['sibling', 'library', 'order', 'groups', 'settings', 'missing'] as const)
  it(`rejects returned ${kind} changes outside original local authority`, () => {
    const f = fixture(),
      ctx = capture(() => f.state, f.local, f.prepare),
      result = run(ctx).project;
    if (kind === 'sibling') result.symbols![0].shapes[2].x++;
    if (kind === 'library') result.symbols![1].name = 'changed';
    if (kind === 'order') result.symbols![0].shapes.reverse();
    if (kind === 'groups') result.symbols![0].shapes[0].groups = ['outer', 'different'];
    if (kind === 'settings') result.width++;
    if (kind === 'missing') result.symbols![0].shapes.shift();
    expect(() => ctx.extract!(result)).toThrow();
  });
it('rechecks original parent source after the complete returned candidate has been copied', () => {
  const f = fixture(),
    ctx = capture(() => f.state, f.local, f.prepare),
    result = run(ctx).project,
    native = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = native(value);
    if (value === result && !fired) {
      fired = true;
      f.state.artwork[2].x++;
    }
    return out;
  });
  expect(() => ctx.extract!(result)).toThrow();
  expect(fired).toBe(true);
});
for (const kind of ['alias', 'changed', 'output'] as const)
  it(`rejects ${kind} extraction clones before any local write`, () => {
    const f = fixture(),
      ctx = capture(() => f.state, f.local, f.prepare),
      result = run(ctx).project,
      native = structuredClone;
    let fired = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value) as typeof result & Vector;
      if (
        !fired &&
        ((kind === 'output' && (value as Vector)?.id === 'line') ||
          ((kind === 'alias' || kind === 'changed') && value === result))
      ) {
        fired = true;
        if (kind === 'alias') return value;
        if (kind === 'changed') out.symbols![1].name = 'changed';
        if (kind === 'output') out.nodes![0].x++;
      }
      return out;
    });
    expect(() => ctx.extract!(result)).toThrow();
    expect(fired).toBe(true);
  });
it('poisons swallowed enclosing callback reentry', () => {
  const f = fixture(),
    holder: { ctx?: StaticSymbolSimplifyContext } = {};
  let active = false;
  holder.ctx = capture(
    () => f.state,
    f.local,
    (art) => {
      const parent = f.prepare(art);
      return {
        ...parent,
        validate: () => {
          if (active) {
            try {
              holder.ctx!.validate();
            } catch {}
          }
          parent.validate();
        },
      };
    },
  );
  active = true;
  expect(() => holder.ctx!.validate()).toThrow();
  active = false;
  expect(() => holder.ctx!.validate()).toThrow();
});
it('rejects asynchronous enclosing admission', () => {
  const f = fixture();
  expect(() =>
    capture(
      () => f.state,
      f.local,
      (art) => ({ ...f.prepare(art), validate: (() => Promise.resolve()) as () => void }),
    ),
  ).toThrow(/synchronous/);
});
it('permits a fresh source-valid context after a rejected returned candidate', () => {
  const f = fixture(),
    ctx = capture(() => f.state, f.local, f.prepare),
    bad = run(ctx).project;
  bad.symbols![1].name = 'changed';
  expect(() => ctx.extract!(bad)).toThrow();
  const fresh = capture(() => f.state, f.local, f.prepare);
  expect(fresh.extract!(run(fresh).project)[0].groups).toEqual(['inner']);
});

for (const key of ['project', 'validate', 'ancestry', 'extract'] as const)
  it(`rejects enclosing ${key} accessors without executing them`, () => {
    const f = fixture(),
      getter = vi.fn(() => undefined);
    expect(() =>
      capture(
        () => f.state,
        f.local,
        (art) => {
          const context = f.prepare(art);
          Object.defineProperty(context, key, { enumerable: true, get: getter });
          return context;
        },
      ),
    ).toThrow(/data/);
    expect(getter).not.toHaveBeenCalled();
  });

it('preserves exact primitive no-op layout and own-undefined metadata when restoring a boundary', () => {
  const f = fixture(),
    parent = f.state.artwork;
  parent[2].groups = ['alone'];
  parent[2].drawingMode = undefined;
  const local = isolateSymbolGroup(parent, 'other').artwork;
  local[0].drawingMode = undefined;
  const next = replaceIsolatedSymbolGroup(parent, 'alone', local);
  expect(next).toStrictEqual(parent);
  expect(stamp(next)).toBe(stamp(parent));
  expect(Object.hasOwn(next[2], 'drawingMode')).toBe(true);
  expect(next[2]).not.toBe(parent[2]);
});
it('retains original member layout while removing fields explicitly deleted in an isolated draft', () => {
  const f = fixture(),
    before = structuredClone(f.state.artwork);
  delete f.local[0].pivot;
  const next = replaceIsolatedSymbolGroup(f.state.artwork, 'outer', f.local);
  expect(next[0].pivot).toBeUndefined();
  expect(Object.hasOwn(next[0], 'pivot')).toBe(false);
  expect(next[0].groups).toEqual(['outer', 'inner']);
  expect(next[2]).toStrictEqual(before[2]);
  expect(f.state.artwork).toStrictEqual(before);
});

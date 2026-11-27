import { afterEach, expect, it, vi } from 'vitest';
import {
  captureNewStaticSymbolSimplifyContext as capture,
  type NewStaticSymbolSimplifySource,
} from '../apps/editor/src/new-symbol-simplify-context';
import { prepareSymbolSimplifyRequest as reduce } from '../packages/geometry/src/symbol-simplify-request';
import { captureIsolatedSymbolSimplifyContext } from '../apps/editor/src/isolated-symbol-simplify-context';
import { isolateSymbolGroup } from '../packages/geometry/src/symbol-artwork';
import { symbolSimplifyFixture } from './symbol-simplify-fixture';
import {
  MAX_SYMBOL_ARTWORK,
  validateProject,
  type Project,
  type Vector,
} from '../packages/document/src';
import { artworkVertices } from '../packages/geometry/src/artwork-simplify';
import { mapPoint, matrix } from '../packages/geometry/src/affine';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(basis = 'plain') {
  const input = symbolSimplifyFixture(basis),
    artwork = structuredClone(input.project.symbols![0].shapes.slice(0, 2));
  input.project.libraryFolders = [
    { id: 'parent', name: 'Props' },
    { id: 'destination', name: 'Drawing', parentId: 'parent' },
  ];
  input.project.libraryLinks = [{ kind: 'symbol', id: 'art', name: 'New_prop' }];
  const source: NewStaticSymbolSimplifySource = {
    project: input.project,
    definition: { id: 'draft', name: 'New prop', width: 400, height: 240, shapes: [] },
    history: {},
    session: {},
    revision: 3,
    folder: 'destination',
    context: 'original',
    eligible: true,
  };
  return { source, artwork };
}
for (const basis of ['plain', 'affine', 'reflected'])
  it(`prepares a detached complete ${basis} pending static definition with original folder/link policy`, () => {
    const f = fixture(basis),
      before = structuredClone(f.source.project),
      definition = structuredClone(f.source.definition),
      ctx = capture(() => f.source, f.artwork),
      candidate = ctx.project;
    expect(candidate.symbols).toHaveLength(3);
    expect(candidate.symbols!.slice(0, 2)).toStrictEqual(before.symbols);
    expect(candidate.symbols![2]).toStrictEqual({ ...definition, shapes: f.artwork });
    expect(candidate.libraryLinks).toEqual([
      ...before.libraryLinks!,
      { kind: 'symbol', id: 'draft', name: 'New_prop_2' },
    ]);
    expect(candidate.libraryItems).toEqual([
      { kind: 'symbol', id: 'draft', folderId: 'destination' },
    ]);
    expect(candidate.layers).toStrictEqual(before.layers);
    expect(candidate.assets).toStrictEqual(before.assets);
    const out = reduce({ project: candidate, symbolId: 'draft', selected: ['line'] });
    expect(out.removed).toBeGreaterThan(100);
    expect(out.project.symbols!.slice(0, 2)).toStrictEqual(before.symbols);
    f.artwork.forEach((s, i) => {
      const next = out.project.symbols![2].shapes[i];
      expect(artworkVertices(next)).toBeLessThan(artworkVertices(s));
      expect(matrix(next)).toEqual(matrix(s));
      expect(next.groups).toEqual(s.groups);
      expect(next.pivot).toEqual(s.pivot);
      if (i === 0)
        for (const index of [0, -1])
          expect(mapPoint(matrix(next), next.nodes!.at(index)!)).toEqual(
            mapPoint(matrix(s), s.points.at(index)!),
          );
    });
    expect(f.source.project).toStrictEqual(before);
    expect(f.source.definition).toStrictEqual(definition);
    ctx.validate();
    validateProject(out.project);
  });
it('allows a root folder without materializing an unnecessary location list', () => {
  const f = fixture();
  f.source.folder = '';
  const ctx = capture(() => f.source, f.artwork);
  expect(ctx.project.libraryItems).toBeUndefined();
  expect(f.source.project.libraryItems).toBeUndefined();
});
it('retains absent/own-undefined metadata and returns an exact minimal pending no-op', () => {
  const f = fixture();
  f.source.definition.multiFramePivot = undefined;
  const rect = structuredClone(f.source.project.symbols![0].shapes[2]);
  rect.groups = undefined;
  rect.drawingMode = undefined;
  const ctx = capture(() => f.source, [rect]),
    result = reduce({ project: ctx.project, symbolId: 'draft', selected: ['other'] });
  expect(result.removed).toBe(0);
  expect(result.project).toStrictEqual(ctx.project);
  expect(Object.hasOwn(ctx.project.symbols![2], 'multiFramePivot')).toBe(true);
  expect(Object.hasOwn(ctx.project.symbols![2].shapes[0], 'drawingMode')).toBe(true);
});
it('composes the separately qualified isolated adapter without adding the draft to the live library', () => {
  const f = fixture(),
    parent = JSON.parse(JSON.stringify(f.artwork)) as Vector[],
    local = isolateSymbolGroup(parent, 'line').artwork;
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
    ancestry: [...ctx.ancestry!],
  });
  expect(ctx.extract!(out.project)[1]).toStrictEqual(local[1]);
  expect(f.source.project.symbols).toHaveLength(2);
});
for (const field of [
  'project',
  'definition',
  'history',
  'session',
  'revision',
  'folder',
  'context',
  'eligible',
  'library',
  'header',
  'local',
] as const)
  it(`rejects original pending ${field} changes`, () => {
    const f = fixture(),
      ctx = capture(() => f.source, f.artwork);
    if (field === 'project') f.source.project = structuredClone(f.source.project);
    if (field === 'definition') f.source.definition = structuredClone(f.source.definition);
    if (field === 'history') f.source.history = {};
    if (field === 'session') f.source.session = {};
    if (field === 'revision') f.source.revision++;
    if (field === 'folder') f.source.folder = '';
    if (field === 'context') f.source.context = 'changed';
    if (field === 'eligible') f.source.eligible = false;
    if (field === 'library') f.source.project.symbols![0].name = 'changed';
    if (field === 'header') f.source.definition.width++;
    if (field === 'local') f.artwork[0].x++;
    expect(() => ctx.validate()).toThrow();
  });
for (const field of ['project', 'definition', 'folder'] as const)
  it(`rejects pending ${field} accessors without reads`, () => {
    const f = fixture(),
      getter = vi.fn(() => f.source[field]);
    Object.defineProperty(f.source, field, { get: getter });
    expect(() => capture(() => f.source, f.artwork)).toThrow(/data/);
    expect(getter).not.toHaveBeenCalled();
  });
for (const bad of [
  'empty',
  'collision',
  'timeline',
  'button',
  'embedded',
  'missingFolder',
  'invalidName',
  'invalidPlayback',
  'rawHeader',
  'rawArtwork',
  'original',
  'cycle',
] as const)
  it(`rejects ${bad} pending input before any source publication`, () => {
    const f = fixture(),
      before = structuredClone(f.source.project);
    if (bad === 'empty') f.artwork = [];
    if (bad === 'collision') f.source.definition.id = 'art';
    if (bad === 'timeline') f.source.definition.timeline = { duration: 1, keys: [] };
    if (bad === 'button') f.source.definition.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    if (bad === 'embedded') f.source.definition.shapes = structuredClone(f.artwork);
    if (bad === 'missingFolder') f.source.folder = 'missing';
    if (bad === 'invalidName') f.source.definition.name = ' ';
    if (bad === 'invalidPlayback') f.source.definition.defaultPlayback = 'once' as never;
    if (bad === 'rawHeader') f.source.definition.width = Infinity;
    if (bad === 'rawArtwork') f.artwork[1].contours![0][0].x = NaN;
    if (bad === 'original') f.source.project.symbols![0].shapes[0].x = Infinity;
    if (bad === 'cycle')
      f.artwork = [
        { ...f.source.project.layers[0].keys[0].shapes[0], id: 'self', symbolId: 'draft' },
      ];
    expect(() => capture(() => f.source, f.artwork)).toThrow();
    if (bad !== 'original') expect(f.source.project).toStrictEqual(before);
  });
for (const field of ['candidate', 'source', 'definition', 'local'] as const)
  it(`rejects real ${field} clone-time changes before returning a pending candidate`, () => {
    const f = fixture(),
      native = structuredClone,
      before = structuredClone(f.source.project);
    let fired = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value) as { project?: Project };
      if (!fired && out?.project) {
        fired = true;
        if (field === 'candidate') out.project.symbols![0].name = 'changed';
        if (field === 'source') f.source.project.name = 'independent edit';
        if (field === 'definition') f.source.definition.name = 'changed';
        if (field === 'local') f.artwork[0].x++;
      }
      return out;
    });
    expect(() => capture(() => f.source, f.artwork)).toThrow();
    expect(fired).toBe(true);
    expect(f.source.project).toEqual(
      field === 'source' ? { ...before, name: 'independent edit' } : before,
    );
  });
for (const alias of ['all', 'project', 'artwork'] as const)
  it(`rejects ${alias} snapshot aliases`, () => {
    const f = fixture(),
      native = structuredClone;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value) as { project: Project; artwork: Vector[] };
      if (alias === 'all') return value;
      if (alias === 'project') out.project = f.source.project;
      else out.artwork = f.artwork;
      return out;
    });
    expect(() => capture(() => f.source, f.artwork)).toThrow(/detached/);
  });
it('poisons swallowed source-read reentry', () => {
  const f = fixture(),
    holder: { ctx?: ReturnType<typeof capture> } = {};
  let active = false;
  holder.ctx = capture(() => {
    if (active) {
      try {
        holder.ctx!.validate();
      } catch {}
    }
    return f.source;
  }, f.artwork);
  active = true;
  expect(() => holder.ctx!.validate()).toThrow();
  active = false;
  expect(() => holder.ctx!.validate()).toThrow();
});
it('checks the complete returned pending project again without editing live source', () => {
  const f = fixture(),
    before = structuredClone(f.source.project),
    ctx = capture(() => f.source, f.artwork);
  ctx.project.symbols![2].shapes[0].x++;
  expect(() => ctx.validate()).toThrow(/pending/);
  expect(f.source.project).toStrictEqual(before);
});
it('reopens a fresh context after reduction, retaining the original pending header and current local vertices', () => {
  const f = fixture(),
    ctx = capture(() => f.source, f.artwork),
    out = reduce({ project: ctx.project, symbolId: 'draft', selected: ['line'] }),
    local = out.project.symbols![2].shapes,
    next = capture(() => f.source, local),
    second = reduce({ project: next.project, symbolId: 'draft', selected: ['line'] });
  expect(second.removed).toBeGreaterThan(0);
  expect(f.source.definition.shapes).toEqual([]);
  expect(f.source.project.symbols).toHaveLength(2);
});
it('admits exact aggregate capacity including the pending artwork and rejects one extra member', () => {
  const f = fixture(),
    template = f.source.project.symbols![1].shapes[0],
    existing = f.source.project.symbols![0].shapes.length;
  f.source.project.symbols![1].shapes = Array.from(
    { length: MAX_SYMBOL_ARTWORK - existing - f.artwork.length },
    (_, i) => ({ ...template, id: `stored-${i}`, points: [] }),
  );
  const ctx = capture(() => f.source, f.artwork);
  expect(ctx.project.symbols!.reduce((n, s) => n + s.shapes.length, 0)).toBe(MAX_SYMBOL_ARTWORK);
  expect(() =>
    capture(() => f.source, [...f.artwork, { ...structuredClone(template), id: 'overflow' }]),
  ).toThrow(/artwork budget/);
  expect(f.source.project.symbols!.reduce((n, s) => n + s.shapes.length, 0)).toBe(
    MAX_SYMBOL_ARTWORK - f.artwork.length,
  );
}, 180000);

for (const field of ['header', 'artwork'] as const)
  it(`rejects raw ${field} getters before cloning or reading them`, () => {
    const f = fixture(),
      getter = vi.fn(() => 1);
    Object.defineProperty(
      field === 'header' ? f.source.definition : f.artwork[0].points[0],
      field === 'header' ? 'width' : 'x',
      { enumerable: true, get: getter },
    );
    expect(() => capture(() => f.source, f.artwork)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

it('does not share new definition artwork or pivot metadata with copied original Library members', () => {
  const f = fixture();
  f.artwork = f.source.project.symbols![0].shapes.slice(0, 2);
  f.source.definition.multiFramePivot = f.source.project.symbols![0].shapes[0].pivot;
  const before = structuredClone(f.source.project),
    ctx = capture(() => f.source, f.artwork),
    old = ctx.project.symbols![0],
    next = ctx.project.symbols![2];
  expect(next.shapes[0]).not.toBe(old.shapes[0]);
  expect(next.multiFramePivot).not.toBe(old.shapes[0].pivot);
  next.shapes[0].x++;
  next.multiFramePivot!.x++;
  expect(old).toStrictEqual(before.symbols![0]);
  expect(f.source.project).toStrictEqual(before);
  expect(() => ctx.validate()).toThrow(/pending/);
});
it('rejects late edits to the separately detached pending payload without losing original Library data', () => {
  const f = fixture(),
    native = structuredClone,
    before = structuredClone(f.source.project);
  let fired = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const copy = native(value) as { definition?: unknown; project?: Project; artwork: Vector[] };
    if (!fired && copy?.definition && !copy.project) {
      fired = true;
      copy.artwork[0].x++;
    }
    return copy;
  });
  expect(() => capture(() => f.source, f.artwork)).toThrow(/copy/);
  expect(fired).toBe(true);
  expect(f.source.project).toStrictEqual(before);
});

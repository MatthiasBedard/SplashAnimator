import { afterEach, expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  migrateProject,
  validateProject,
  type Project,
} from '../packages/document/src';
import {
  captureSymbolArtworkSimplification as capture,
  prepareSymbolArtworkSimplification as prepare,
} from '../packages/geometry/src/symbol-simplify-owner';
import { artworkVertices } from '../packages/geometry/src/artwork-simplify';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { symbolSimplifyFixture } from './symbol-simplify-fixture';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(basis = 'plain') {
  const { project } = symbolSimplifyFixture(basis),
    shapes = project.symbols![0].shapes;
  shapes[0].groups = ['outer', 'inner', 'tips'];
  shapes.splice(1, 0, { ...structuredClone(shapes[0]), id: 'partner', y: 90 });
  validateProject(project);
  return project;
}
function operation(project = fixture(), path = ['outer'], ids = ['line']) {
  const scope = capture(() => ({ project, revision: 0 }));
  return { project, scope, owner: scope.resolveIsolated('art', path, ids) };
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const depth of [1, 2, 3])
    it(`owns only complete relative units at depth ${depth} under ${basis} bases`, () => {
      const op = operation(fixture(basis), ['outer', 'inner', 'tips'].slice(0, depth)),
        before = structuredClone(op.project),
        out = prepare(op.owner),
        chosen = depth < 3 ? ['line', 'partner'] : ['line'];
      expect(op.owner.ancestry).toEqual(['outer', 'inner', 'tips'].slice(0, depth));
      expect(op.owner.selected).toEqual(chosen);
      expect(out.selected).toEqual(chosen);
      let removed = 0;
      const prior = before.symbols![0].shapes,
        next = out.project.symbols![0].shapes;
      expect(next.map((s) => s.id)).toEqual(prior.map((s) => s.id));
      prior.forEach((s, i) => {
        if (!chosen.includes(s.id)) {
          expect(next[i]).toStrictEqual(s);
          return;
        }
        removed += artworkVertices(s) - artworkVertices(next[i]);
        expect(artworkVertices(next[i])).toBeLessThan(artworkVertices(s));
        expect(next[i].groups).toEqual(s.groups);
        expect(next[i].pivot).toEqual(s.pivot);
        expect(matrix(next[i])).toEqual(matrix(s));
        for (const index of [0, -1]) {
          const original = s.points.at(index)!,
            point = next[i].nodes!.at(index)!;
          expect(mapPoint(matrix(next[i]), point)).toEqual(mapPoint(matrix(s), original));
        }
        const metadata = (shape: typeof s) =>
          Object.fromEntries(
            Object.entries(shape).filter(
              ([key]) => !['points', 'nodes', 'kind', 'closed'].includes(key),
            ),
          );
        expect(metadata(next[i])).toStrictEqual(metadata(s));
      });
      expect(out.removed).toBe(removed);
      expect(removed).toBeGreaterThan(0);
      expect(out.project.layers).toEqual(before.layers);
      expect(out.project.assets).toEqual(before.assets);
      expect(out.project.symbols![1]).toStrictEqual(before.symbols![1]);
      expect(op.project).toStrictEqual(before);
      validateProject(out.project);
      op.scope.dispose();
    });

it('does not change the exact legacy root selection scope', () => {
  const op = operation(),
    root = op.scope.resolve('art', ['line']);
  expect(Object.keys(root)).toEqual(['symbolId', 'selected']);
  expect(root.selected).toEqual(['line', 'partner', 'paint']);
  expect(op.owner.selected).toEqual(['line', 'partner']);
  const isolated = prepare(op.owner),
    complete = prepare(root);
  expect(isolated.project.symbols![0].shapes[2]).toStrictEqual(op.project.symbols![0].shapes[2]);
  expect(artworkVertices(complete.project.symbols![0].shapes[2])).toBeLessThan(240);
});
it('selects multiple relative units in original paint order and retains compound holes', () => {
  const op = operation(fixture('reflected'), ['outer'], ['paint', 'line']),
    out = prepare(op.owner);
  expect(out.selected).toEqual(['line', 'partner', 'paint']);
  expect(out.project.symbols![0].shapes[2].contours).toHaveLength(2);
  expect(out.project.symbols![0].shapes[2].groups).toEqual(['outer']);
  expect(out.project.symbols![0].shapes[2].fillRule).toBe('evenodd');
  expect(out.project.symbols![0].shapes[3]).toStrictEqual(op.project.symbols![0].shapes[3]);
});
it('keeps a selected nested instance and its definition unchanged', () => {
  const p = fixture(),
    child = symbolInstance(p.symbols![1], 120, 100);
  child.id = 'child';
  child.groups = ['outer', 'inner', 'tips'];
  child.symbolPlayback = { mode: 'single', firstFrame: 0 };
  p.symbols![0].shapes.splice(2, 0, child);
  const op = operation(p),
    before = structuredClone(p),
    out = prepare(op.owner);
  expect(out.selected).toEqual(['line', 'partner', 'child']);
  expect(out.project.symbols![0].shapes[2]).toStrictEqual(child);
  expect(out.project.symbols![1]).toStrictEqual(before.symbols![1]);
  expect(p).toStrictEqual(before);
});
it('keeps a primitive-only isolated no-op exact and history-free', () => {
  const p = fixture();
  p.symbols![0].shapes[3].groups = ['alone'];
  const op = operation(p, ['alone'], ['other']),
    out = prepare(op.owner);
  expect(out.removed).toBe(0);
  expect(out.selected).toEqual(['other']);
  expect(out.project).toStrictEqual(p);
  expect(out.project).not.toBe(p);
});
it('reopens serialized narrow scopes and reduces current vertices without widening membership', () => {
  const op = operation(fixture(), ['outer', 'inner', 'tips']),
    a = prepare(op.owner),
    reopened = migrateProject(JSON.parse(JSON.stringify(a.project))),
    next = operation(reopened, ['outer', 'inner', 'tips']),
    b = prepare(next.owner);
  expect(b.removed).toBeGreaterThan(0);
  expect(b.selected).toEqual(['line']);
  expect(b.project.symbols![0].shapes.slice(1)).toStrictEqual(reopened.symbols![0].shapes.slice(1));
  expect(reopened).toEqual(a.project);
});
it('snapshots caller arrays and freezes public ownership without retargeting later input', () => {
  const path = ['outer'],
    ids = ['line'],
    op = operation(fixture(), path, ids);
  path[0] = 'elsewhere';
  ids[0] = 'other';
  expect(Object.isFrozen(op.owner)).toBe(true);
  expect(Object.isFrozen(op.owner.ancestry)).toBe(true);
  expect(Object.isFrozen(op.owner.selected)).toBe(true);
  expect(prepare(op.owner).selected).toEqual(['line', 'partner']);
  expect(() => prepare({ ...op.owner })).toThrow(/private/);
});
for (const bad of [
  'empty',
  'missing',
  'reordered',
  'tooDeep',
  'duplicate',
  'nonString',
  'notArray',
  'outside',
  'selectedEmpty',
  'selectedDuplicate',
  'selectedMissing',
  'selectedNaN',
  'noDefinition',
] as const)
  it(`rejects ${bad} original scope before publication`, () => {
    const p = fixture(),
      before = structuredClone(p),
      scope = capture(() => ({ project: p, revision: 0 }));
    let path: unknown = ['outer'],
      ids: unknown = ['line'],
      symbolId = 'art';
    if (bad === 'empty') path = [];
    if (bad === 'missing') path = ['missing'];
    if (bad === 'reordered') path = ['inner', 'outer'];
    if (bad === 'tooDeep') path = Array.from({ length: 33 }, (_, i) => `group-${i}`);
    if (bad === 'duplicate') path = ['outer', 'outer'];
    if (bad === 'nonString') path = ['outer', NaN];
    if (bad === 'notArray') path = 'outer';
    if (bad === 'outside') ids = ['other'];
    if (bad === 'selectedEmpty') ids = [];
    if (bad === 'selectedDuplicate') ids = ['line', 'line'];
    if (bad === 'selectedMissing') ids = ['missing'];
    if (bad === 'selectedNaN') ids = [NaN];
    if (bad === 'noDefinition') symbolId = 'missing';
    expect(() => scope.resolveIsolated(symbolId, path as string[], ids as string[])).toThrow();
    expect(p).toStrictEqual(before);
  });
for (const kind of ['timeline', 'button'] as const)
  it(`keeps ${kind} definitions outside static group authority`, () => {
    const p = fixture();
    if (kind === 'timeline') p.symbols![0].timeline = { duration: 2, keys: [] };
    else p.symbols![0].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    const scope = capture(() => ({ project: p, revision: 0 }));
    expect(() => scope.resolveIsolated('art', ['outer'], ['line'])).toThrow(/static/);
  });
for (const key of ['ancestry', 'selected'] as const)
  it(`rejects ${key} accessors without reading them`, () => {
    const p = fixture(),
      scope = capture(() => ({ project: p, revision: 0 })),
      path = ['outer'],
      ids = ['line'],
      getter = vi.fn(() => (key === 'ancestry' ? 'outer' : 'line'));
    Object.defineProperty(key === 'ancestry' ? path : ids, '0', { enumerable: true, get: getter });
    expect(() => scope.resolveIsolated('art', path, ids)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
for (const change of ['project', 'revision', 'ancestry', 'library', 'disposed', 'raw'] as const)
  it(`rejects stale ${change} before a narrow candidate can be published`, () => {
    let p = fixture(),
      revision = 0;
    const scope = capture(() => ({ project: p, revision })),
      owner = scope.resolveIsolated('art', ['outer'], ['line']);
    if (change === 'project') p = structuredClone(p);
    if (change === 'revision') revision++;
    if (change === 'ancestry') p.symbols![0].shapes[0].groups = ['changed'];
    if (change === 'library') p.symbols![1].name = 'changed';
    if (change === 'disposed') scope.dispose();
    if (change === 'raw') p.symbols![0].shapes[0].x = Infinity;
    expect(() => prepare(owner)).toThrow();
  });
it('rejects source-read edits of the original ancestry/selection request', () => {
  const p = fixture(),
    path = ['outer'],
    ids = ['line'];
  let mutate = false;
  const scope = capture(() => {
    if (mutate) path[0] = 'alone';
    return { project: p, revision: 0 };
  });
  mutate = true;
  expect(() => scope.resolveIsolated('art', path, ids)).toThrow();
});
it('poisons swallowed original-source read reentry', () => {
  const p = fixture(),
    holder: { scope?: ReturnType<typeof capture> } = {};
  let fire = false;
  holder.scope = capture(() => {
    if (fire) {
      try {
        holder.scope!.resolveIsolated('art', ['outer'], ['line']);
      } catch {}
    }
    return { project: p, revision: 0 };
  });
  fire = true;
  expect(() => holder.scope!.resolveIsolated('art', ['outer'], ['line'])).toThrow();
  fire = false;
  expect(() => holder.scope!.resolveIsolated('art', ['outer'], ['line'])).toThrow();
});
it('shares the per-project reentry guard with root preparation and permits a fresh retry', () => {
  const op = operation(),
    root = op.scope.resolve('art', ['paint']);
  let fired = false;
  expect(() =>
    prepare(op.owner, {
      validate: () => {
        if (!fired) {
          fired = true;
          try {
            prepare(root);
          } catch {}
        }
      },
    }),
  ).toThrow(/reenter/);
  expect(fired).toBe(true);
  expect(prepare(op.owner).removed).toBeGreaterThan(0);
});
for (const kind of ['input', 'candidate', 'output', 'source'] as const)
  it(`rejects ${kind} changes during complete preparation without source writes`, () => {
    const op = operation(),
      before = structuredClone(op.project),
      native = structuredClone;
    let fired = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const data = value as Project & { project?: Project },
        copy = native(value) as typeof data;
      if (!fired && (kind === 'output' || kind === 'source' ? !!data?.project : !!data?.layers)) {
        fired = true;
        if (kind === 'input') return value;
        if (kind === 'candidate') copy.symbols![1].name = 'unrelated changed';
        if (kind === 'output') copy.project!.symbols![0].shapes[2].x++;
        if (kind === 'source') op.project.name = 'independent edit';
      }
      return copy;
    });
    expect(() => prepare(op.owner)).toThrow();
    expect(fired).toBe(true);
    expect(op.project).toEqual(
      kind === 'source' ? { ...before, name: 'independent edit' } : before,
    );
  });
it('returns independent complete outputs and admits synchronous enclosing validation only', () => {
  const op = operation(),
    before = structuredClone(op.project);
  expect(() => prepare(op.owner, { validate: (() => Promise.resolve()) as () => void })).toThrow(
    /synchronous/,
  );
  const a = prepare(op.owner),
    b = prepare(op.owner);
  a.project.symbols![0].shapes[0].nodes![0].x++;
  expect(a).not.toEqual(b);
  expect(op.project).toStrictEqual(before);
});
it('admits the actual aggregate library capacity and rejects late output overflow atomically', () => {
  const p = fixture(),
    template = p.symbols![1].shapes[0];
  p.symbols![1].shapes = Array.from(
    { length: MAX_SYMBOL_ARTWORK - p.symbols![0].shapes.length },
    (_, i) => ({ ...template, id: `stored-${i}`, points: [] }),
  );
  const op = operation(p),
    out = prepare(op.owner),
    total = (p: Project) => p.symbols!.reduce((n, s) => n + s.shapes.length, 0);
  expect(total(out.project)).toBe(MAX_SYMBOL_ARTWORK);
  const native = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const copy = native(value),
      bundle = copy as { project?: Project };
    if (!fired && bundle?.project) {
      fired = true;
      bundle.project.symbols![1].shapes.push({ ...native(template), id: 'overflow', points: [] });
    }
    return copy;
  });
  expect(() => prepare(op.owner)).toThrow(/artwork budget/);
  expect(fired).toBe(true);
  expect(total(p)).toBe(MAX_SYMBOL_ARTWORK);
}, 120000);

it('admits the existing full 32-level group ancestry without an extra low geometry cap', () => {
  const p = fixture(),
    path = Array.from({ length: 32 }, (_, i) => `level-${i}`);
  for (const s of p.symbols![0].shapes.slice(0, 2)) s.groups = [...path];
  const op = operation(p, path),
    out = prepare(op.owner);
  expect(out.selected).toEqual(['line']);
  expect(out.removed).toBeGreaterThan(0);
  expect(out.project.symbols![0].shapes[0].groups).toEqual(path);
  expect(out.project.symbols![0].shapes.slice(1)).toStrictEqual(p.symbols![0].shapes.slice(1));
});

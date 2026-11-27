import { afterEach, expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  newProject,
  validateProject,
  migrateProject,
  type Project,
  type Vector,
} from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { artworkVertices } from '../packages/geometry/src/artwork-simplify';
import {
  captureSymbolArtworkSimplification as capture,
  prepareSymbolArtworkSimplification as prepare,
} from '../packages/geometry/src/symbol-simplify-owner';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(basis = 'plain') {
  const p = newProject();
  const line: Vector = {
    id: 'line',
    kind: 'path',
    x: 20,
    y: 60,
    width: 240,
    height: 70,
    rotation: 0,
    fill: '#ff0000',
    fillEnabled: false,
    stroke: '#ff0000',
    strokeWidth: 6,
    opacity: 0.8,
    points: Array.from({ length: 241 }, (_, i) => ({
      x: i,
      y: 25 * Math.sin(i / 25) + Math.sin(i / 2),
    })),
    groups: ['outer', 'inner'],
    pivot: { x: 40, y: -20 },
  };
  if (basis !== 'plain') line.transform = [basis === 'reflected' ? -1 : 1, 0.2, 0.3, 1];
  const paint: Vector = {
    ...structuredClone(line),
    id: 'paint',
    kind: 'polygon',
    points: [],
    groups: ['outer'],
    fillRule: 'evenodd',
    fillEnabled: true,
    strokeWidth: 0,
    contours: [40, 12].map((r) =>
      Array.from({ length: 120 }, (_, i) => ({
        x: 100 + r * Math.cos((i / 120) * Math.PI * 2),
        y: 100 + r * Math.sin((i / 120) * Math.PI * 2),
      })),
    ),
  };
  const other: Vector = {
    ...structuredClone(line),
    id: 'other',
    kind: 'rectangle',
    x: 350,
    groups: undefined,
    points: [],
    fill: '#0000ff',
    fillEnabled: true,
    strokeWidth: 0,
  };
  p.symbols = [
    {
      id: 'library',
      name: 'Original art',
      width: 400,
      height: 240,
      defaultPlayback: 'loop',
      shapes: [line, paint, other],
    },
    {
      id: 'untouched',
      name: 'Other definition',
      width: 400,
      height: 240,
      shapes: [structuredClone(other)],
    },
  ];
  p.layers[0].keys[0].shapes = [symbolInstance(p.symbols[0], 100, 50)];
  validateProject(p);
  return p;
}
function operation(p = fixture()) {
  const scope = capture(() => ({ project: p, revision: 0 }));
  return { p, scope, owner: scope.resolve('library', ['line']) };
}
const count = (p: Project) =>
  p.symbols![0].shapes.slice(0, 2).reduce((n, s) => n + artworkVertices(s), 0);

for (const basis of ['plain', 'affine', 'reflected'])
  it(`prepares complete ${basis} original outer membership and leaves instances/library/settings exact`, () => {
    const op = operation(fixture(basis)),
      before = structuredClone(op.p),
      out = prepare(op.owner);
    expect(op.owner.selected).toEqual(['line', 'paint']);
    expect(out.selected).toEqual(['line', 'paint']);
    expect(out.removed).toBe(count(op.p) - count(out.project));
    expect(out.removed).toBeGreaterThan(0);
    expect(out.project.layers).toEqual(op.p.layers);
    expect(out.project.assets).toEqual(op.p.assets);
    expect(out.project.symbols![1]).toEqual(op.p.symbols![1]);
    expect(out.project.symbols![0].shapes[2]).toStrictEqual(op.p.symbols![0].shapes[2]);
    expect(out.project.symbols![0].shapes[0].groups).toEqual(['outer', 'inner']);
    expect(out.project.symbols![0].shapes[0].pivot).toEqual(op.p.symbols![0].shapes[0].pivot);
    expect(out.project.symbols![0].shapes[1].contours).toHaveLength(2);
    expect(op.p).toEqual(before);
    validateProject(out.project);
    op.scope.dispose();
    const reopened = migrateProject(JSON.parse(JSON.stringify(out.project))),
      next = operation(reopened),
      second = prepare(next.owner);
    expect(second.removed).toBeGreaterThan(0);
    next.scope.dispose();
  });

it('returns a detached unchanged no-op for an already minimal original item', () => {
  const op = operation(),
    owner = op.scope.resolve('library', ['other']),
    out = prepare(owner);
  expect(out.removed).toBe(0);
  expect(out.project).toStrictEqual(op.p);
  expect(out.project).not.toBe(op.p);
  op.scope.dispose();
});
for (const bad of ['missing', 'duplicate', 'forged', 'timeline', 'button'] as const)
  it(`rejects ${bad} ownership without editing source`, () => {
    const p = fixture();
    if (bad === 'timeline') p.symbols![0].timeline = { duration: 2, keys: [] };
    if (bad === 'button') p.symbols![0].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    const before = structuredClone(p),
      scope = capture(() => ({ project: p, revision: 0 }));
    expect(() => {
      if (bad === 'forged') prepare({ ...scope.resolve('library', ['line']) });
      else
        scope.resolve(
          'library',
          bad === 'missing' ? ['missing'] : bad === 'duplicate' ? ['line', 'line'] : ['line'],
        );
    }).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
  });

for (const stale of ['source', 'revision', 'identity', 'disposed'])
  it(`rejects stale ${stale}`, () => {
    let p = fixture(),
      revision = 0;
    const scope = capture(() => ({ project: p, revision })),
      owner = scope.resolve('library', ['line']);
    if (stale === 'source') p.name = 'Independent edit';
    if (stale === 'revision') revision++;
    if (stale === 'identity') p = structuredClone(p);
    if (stale === 'disposed') scope.dispose();
    expect(() => prepare(owner)).toThrow();
    scope.dispose();
  });

it('reads no raw selected-ID or admission getters and permits a fresh valid request', () => {
  const op = operation();
  let reads = 0;
  const ids = ['line'];
  Object.defineProperty(ids, '0', {
    enumerable: true,
    get() {
      reads++;
      return 'line';
    },
  });
  expect(() => op.scope.resolve('library', ids)).toThrow();
  const options = Object.defineProperty({}, 'validate', {
    enumerable: true,
    get() {
      reads++;
      return () => {};
    },
  });
  expect(() => prepare(op.owner, options)).toThrow();
  expect(reads).toBe(0);
  expect(prepare(op.owner).removed).toBeGreaterThan(0);
  op.scope.dispose();
});

for (const value of [NaN, Infinity, -Infinity])
  it(`rejects original nonfinite ${value} before clone normalization`, () => {
    const p = fixture();
    p.symbols![0].shapes[0].points[0].x = value;
    expect(() => capture(() => ({ project: p, revision: 0 }))).toThrow();
    expect(Object.is(p.symbols![0].shapes[0].points[0].x, value)).toBe(true);
  });

for (const change of ['source', 'output', 'selection'] as const)
  it(`rejects late ${change} after the completed candidate bundle is cloned`, () => {
    const op = operation(),
      before = structuredClone(op.p),
      clone = structuredClone;
    let fired = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value),
        bundle = out as { project?: Project; removed?: number; selected?: string[] };
      if (!fired && bundle?.project && bundle.removed! > 0) {
        fired = true;
        if (change === 'source') op.p.name = 'Independent edit';
        if (change === 'output') bundle.project.symbols![0].shapes[0].fill = '#123456';
        if (change === 'selection') bundle.selected!.pop();
      }
      return out;
    });
    expect(() => prepare(op.owner)).toThrow();
    expect(fired).toBe(true);
    vi.unstubAllGlobals();
    expect(op.p).toEqual(change === 'source' ? { ...before, name: 'Independent edit' } : before);
    op.scope.dispose();
    const fresh = operation(op.p);
    expect(prepare(fresh.owner).removed).toBeGreaterThan(0);
    fresh.scope.dispose();
  });

it('poisons swallowed preparation reentry, retains source and permits a fresh operation', () => {
  const op = operation(),
    before = structuredClone(op.p);
  let fired = false;
  expect(() =>
    prepare(op.owner, {
      validate() {
        if (fired) return;
        fired = true;
        try {
          prepare(op.owner);
        } catch {
          /* The outer operation must also reject. */
        }
      },
    }),
  ).toThrow(/reenter/);
  expect(fired).toBe(true);
  expect(op.p).toEqual(before);
  expect(prepare(op.owner).removed).toBeGreaterThan(0);
  op.scope.dispose();
});

for (const alias of ['root', 'library', 'artwork', 'output'])
  it(`rejects ${alias} clone aliases before source writes`, () => {
    const op = operation(),
      before = structuredClone(op.p),
      clone = structuredClone;
    let fired = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const data = value as Project & { project?: Project },
        out = clone(value) as typeof data;
      if (!fired && data?.layers) {
        if (alias === 'root') {
          fired = true;
          return value;
        }
        if (alias === 'library') {
          fired = true;
          out.symbols = op.p.symbols;
        }
        if (alias === 'artwork') {
          fired = true;
          out.symbols![0].shapes = data.symbols![0].shapes;
        }
      }
      if (!fired && alias === 'output' && data?.project) {
        fired = true;
        return value;
      }
      return out;
    });
    expect(() => prepare(op.owner)).toThrow();
    expect(fired).toBe(true);
    expect(op.p).toEqual(before);
    op.scope.dispose();
  });

it('rejects asynchronous enclosing admission and preserves complete detached output', () => {
  const op = operation();
  expect(() => prepare(op.owner, { validate: (() => Promise.resolve()) as () => void })).toThrow(
    /synchronous/,
  );
  const a = prepare(op.owner),
    b = prepare(op.owner);
  expect(a).toEqual(b);
  a.project.symbols![0].shapes[0].nodes![0].x++;
  expect(a).not.toEqual(b);
  expect(op.p.symbols![0].shapes[0].nodes).toBeUndefined();
  op.scope.dispose();
});

for (const change of ['candidate', 'source'] as const)
  it(`rejects ${change} changes while selected original artwork is serialized for fitting`, () => {
    const op = operation(),
      before = structuredClone(op.p),
      clone = structuredClone,
      stringify = JSON.stringify;
    let candidate: Project | undefined,
      fired = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value),
        p = out as Project;
      if (p?.layers && p.symbols?.[0]?.id === 'library') candidate = p;
      return out;
    });
    vi.spyOn(JSON, 'stringify').mockImplementation(((...args: Parameters<typeof stringify>) => {
      const text = stringify(...args);
      if (!fired && candidate && args[0] === candidate.symbols![0].shapes) {
        fired = true;
        if (change === 'candidate') candidate.symbols![1].name = 'Unrelated mutation';
        else op.p.name = 'Independent edit';
      }
      return text;
    }) as typeof stringify);
    expect(() => prepare(op.owner)).toThrow();
    expect(fired).toBe(true);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    op.scope.dispose();
    expect(op.p).toEqual(change === 'source' ? { ...before, name: 'Independent edit' } : before);
  });

it('rejects swallowed source-read reentry and keeps the original project intact', () => {
  const p = fixture(),
    before = structuredClone(p);
  const holder: { scope?: ReturnType<typeof capture> } = {};
  let fired = false;
  holder.scope = capture(() => {
    if (holder.scope && !fired) {
      fired = true;
      try {
        holder.scope.resolve('library', ['line']);
      } catch {
        /* Original source read must remain poisoned. */
      }
    }
    return { project: p, revision: 0 };
  });
  expect(() => holder.scope!.resolve('library', ['line'])).toThrow();
  expect(fired).toBe(true);
  expect(p).toEqual(before);
  holder.scope.dispose();
});

it('admits the actual aggregate library capacity and rejects late complete-output overflow', () => {
  const p = fixture();
  const template = p.symbols![1].shapes[0];
  p.symbols![1].shapes = Array.from(
    { length: MAX_SYMBOL_ARTWORK - p.symbols![0].shapes.length },
    (_, i) => ({ ...template, id: `stored-${i}`, points: [] }),
  );
  const op = operation(p),
    out = prepare(op.owner);
  expect(out.project.symbols!.reduce((n, s) => n + s.shapes.length, 0)).toBe(MAX_SYMBOL_ARTWORK);
  const clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = clone(value),
      bundle = out as { project?: Project; removed?: number };
    if (!fired && bundle?.project && bundle.removed! > 0) {
      fired = true;
      bundle.project.symbols![1].shapes.push({ ...clone(template), id: 'overflow', points: [] });
    }
    return out;
  });
  expect(() => prepare(op.owner)).toThrow(/artwork budget/);
  expect(fired).toBe(true);
  expect(p.symbols!.reduce((n, s) => n + s.shapes.length, 0)).toBe(MAX_SYMBOL_ARTWORK);
  op.scope.dispose();
}, 120000);

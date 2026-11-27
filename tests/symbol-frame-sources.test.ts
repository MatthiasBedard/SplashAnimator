import { expect, it } from 'vitest';
import {
  newProject,
  clone,
  migrateProject,
  validateProject,
  setFrameScript,
  History,
  type Project,
  type Vector,
} from '../packages/document/src';
import {
  captureSymbolFrameSources,
  type SymbolFrameSourceRequest,
} from '../packages/document/src/symbol-frame-sources';
import { saveProject, loadProject, type DirectoryStore } from '../packages/document/src/storage';
import { updateSymbolTimeline } from '../packages/geometry/src/symbols';

function fixture(): Project {
  const p = newProject();
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 1,
    y: 2,
    width: 10,
    height: 12,
    rotation: 15,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 1,
    points: [],
  };
  p.symbols = [
    {
      id: 'a',
      name: 'Animated',
      width: 30,
      height: 40,
      shapes: [art],
      timeline: {
        duration: 4,
        keys: [{ frame: 2, shapes: [{ ...clone(art), x: 3 }] }],
        layers: [
          {
            id: 'extra',
            name: 'Extra',
            visible: false,
            locked: true,
            keys: [{ frame: 0, shapes: [] }],
          },
        ],
      },
    },
    {
      id: 'b',
      name: 'Button',
      width: 10,
      height: 12,
      shapes: [{ ...clone(art), id: 'b-art' }],
      timeline: { duration: 2, keys: [] },
      buttonStates: { up: 0, over: 1, down: 1, hit: 0 },
    },
    {
      id: 'static',
      name: 'Static',
      width: 10,
      height: 12,
      shapes: [{ ...clone(art), id: 'static-art' }],
    },
  ];
  return p;
}
const request = (source: string | null, frame = 0, symbolId = 'a'): SymbolFrameSourceRequest => ({
  symbolId,
  frame,
  source,
});
function memoryStore(): DirectoryStore {
  const files = new Map<string, string>();
  return {
    async read(path) {
      const value = files.get(path);
      if (value === undefined) throw new Error('Missing');
      return value;
    },
    async exists(path) {
      return files.has(path);
    },
    async writeNew(path, content) {
      if (files.has(path)) throw new Error('Exists');
      files.set(path, content);
    },
    async commit(path, content, expected) {
      if ((files.get(path) ?? null) !== expected) throw new Error('Conflict');
      files.set(path, content);
    },
  };
}

it('prepares sorted local sources without changing artwork, mappings, settings, main bodies or history', () => {
  const p = fixture();
  setFrameScript(p, 40, 'main');
  const before = clone(p),
    history = new History(),
    owner = captureSymbolFrameSources(() => ({ project: p, revision: 0 }));
  const result = owner.prepare([request('later', 3), request(''), request('button data', 1, 'b')]);
  const expected = clone(before);
  expected.symbols![0].timeline!.frameScripts = [
    { frame: 0, source: '' },
    { frame: 3, source: 'later' },
  ];
  expected.symbols![1].timeline!.frameScripts = [{ frame: 1, source: 'button data' }];
  expect(result).toEqual(expected);
  expect(p).toEqual(before);
  expect(history.undo(result)).toBeUndefined();
  history.record(p, 'Sources');
  const undone = history.undo(result)!;
  expect(undone).toEqual(before);
  expect(history.redo(undone)).toEqual(expected);
});
it('replaces/removes bodies, retains empty source, and does not invent an absent table for removals', () => {
  let p = fixture();
  const prepare = (requests: SymbolFrameSourceRequest[]) =>
    captureSymbolFrameSources(() => ({ project: p, revision: 0 })).prepare(requests);
  expect(prepare([request(null)])).toEqual(p);
  p = prepare([request('first'), request('later', 3)]);
  p = prepare([request('')]);
  expect(p.symbols![0].timeline!.frameScripts).toEqual([
    { frame: 0, source: '' },
    { frame: 3, source: 'later' },
  ]);
  p = prepare([request(null), request(null, 3)]);
  expect(Object.hasOwn(p.symbols![0].timeline!, 'frameScripts')).toBe(false);
});
it.each([-1, 4, 4.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
  'rejects local frame %s and permits a fresh valid request',
  (frame) => {
    const p = fixture(),
      before = clone(p),
      owner = captureSymbolFrameSources(() => ({ project: p, revision: 0 }));
    expect(() => owner.prepare([request('x', frame)])).toThrow();
    expect(p).toEqual(before);
    expect(owner.prepare([request('ok')]).symbols![0].timeline!.frameScripts![0].source).toBe('ok');
  },
);
it.each(['missing', 'static'])('requires an existing original timeline for %s', (symbolId) => {
  const p = fixture(),
    before = clone(p);
  expect(() =>
    captureSymbolFrameSources(() => ({ project: p, revision: 0 })).prepare([
      request('x', 0, symbolId),
    ]),
  ).toThrow(/existing original/);
  expect(p).toEqual(before);
});
it.each([42, undefined, {}, [], true])('rejects raw non-string source %s', (source) => {
  const p = fixture();
  expect(() =>
    captureSymbolFrameSources(() => ({ project: p, revision: 0 })).prepare([
      request(source as string),
    ]),
  ).toThrow();
  expect(p.symbols![0].timeline!.frameScripts).toBeUndefined();
});
it('rejects an entire mixed batch and duplicate target without partial changes', () => {
  const p = fixture(),
    before = clone(p),
    owner = captureSymbolFrameSources(() => ({ project: p, revision: 0 }));
  for (const requests of [
    [request('valid'), request('bad', 2, 'b')],
    [request('one'), request('two')],
    [],
  ])
    expect(() => owner.prepare(requests)).toThrow();
  expect(p).toEqual(before);
  expect(owner.prepare([request('good', 1)]).symbols![0].timeline!.frameScripts).toEqual([
    { frame: 1, source: 'good' },
  ]);
});
it('snapshots request getters once and rejects original mutation during reads', () => {
  const p = fixture(),
    owner = captureSymbolFrameSources(() => ({ project: p, revision: 0 }));
  let ids = 0,
    frames = 0,
    sources = 0;
  const input = {
    get symbolId() {
      ids++;
      return 'a';
    },
    get frame() {
      frames++;
      return 1;
    },
    get source() {
      sources++;
      return 'one';
    },
  };
  expect(owner.prepare([input]).symbols![0].timeline!.frameScripts).toEqual([
    { frame: 1, source: 'one' },
  ]);
  expect([ids, frames, sources]).toEqual([1, 1, 1]);
  const changed = {
    symbolId: 'a',
    frame: 0,
    get source() {
      p.name = 'external';
      return 'stale';
    },
  };
  expect(() => owner.prepare([changed])).toThrow(/changed/);
  expect(p.name).toBe('external');
  expect(p.symbols![0].timeline!.frameScripts).toBeUndefined();
});
it('rejects reentry and revision changes even when original source is restored', () => {
  const p = fixture();
  let revision = 0;
  const owner = captureSymbolFrameSources(() => ({ project: p, revision }));
  expect(() =>
    owner.prepare([
      {
        symbolId: 'a',
        frame: 0,
        get source() {
          owner.prepare([request('nested')]);
          return 'x';
        },
      },
    ]),
  ).toThrow(/reentered/);
  expect(owner.prepare([request('retry')]).symbols![0].timeline!.frameScripts![0].source).toBe(
    'retry',
  );
  revision++;
  expect(() => owner.prepare([request('stale')])).toThrow(/changed/);
});
it.each(['project', 'library', 'duration', 'artwork'])(
  'rejects actual later %s source edits',
  (kind) => {
    let p = fixture();
    const owner = captureSymbolFrameSources(() => ({ project: p, revision: 0 }));
    if (kind === 'project') p = clone(p);
    if (kind === 'library') p.symbols!.reverse();
    if (kind === 'duration') p.symbols![0].timeline!.duration = 5;
    if (kind === 'artwork') p.symbols![0].shapes[0].x++;
    expect(() => owner.prepare([request('stale')])).toThrow(/changed/);
  },
);
it('keeps returned candidates detached and permits explicit final admission/disposal', () => {
  const p = fixture(),
    owner = captureSymbolFrameSources(() => ({ project: p, revision: 0 })),
    first = owner.prepare([request('first')]);
  first.symbols![0].shapes[0].x = 900;
  first.symbols![0].timeline!.frameScripts![0].source = 'mutated';
  expect(owner.prepare([request('next')]).symbols![0].shapes[0].x).toBe(1);
  owner.assertCurrent();
  owner.dispose();
  expect(() => owner.assertCurrent()).toThrow();
  expect(() => owner.prepare([request('no')])).toThrow();
});
it.each(['NaN', 'getter', 'toJSON', 'sparse'])(
  'rejects original %s before normalization',
  (kind) => {
    const p = fixture();
    if (kind === 'NaN') p.symbols![0].timeline!.frameScripts = [{ frame: NaN, source: 'x' }];
    if (kind === 'getter')
      Object.defineProperty(p.symbols![0].timeline!, 'frameScripts', {
        enumerable: true,
        get() {
          throw new Error('must not read getter');
        },
      });
    if (kind === 'toJSON')
      Object.assign(p.symbols![0], {
        toJSON() {
          throw new Error('must not serialize');
        },
      });
    if (kind === 'sparse') p.symbols![0].timeline!.frameScripts = Array(1);
    expect(() => captureSymbolFrameSources(() => ({ project: p, revision: 0 }))).toThrow();
  },
);
it('shares exact UTF8 source capacity with main and all symbols, retaining BOM/CRLF and incomplete code', () => {
  let p = fixture();
  setFrameScript(p, 0, 'm');
  const source = '\uFEFF\r\né'.repeat(2) + '/*';
  const bytes = new TextEncoder().encode(source).byteLength;
  p = captureSymbolFrameSources(() => ({ project: p, revision: 0 })).prepare([
    request(source),
    request('x'.repeat(256 * 1024 - 1 - bytes), 0, 'b'),
  ]);
  expect(validateProject(p)).toEqual(p);
  expect(p.symbols![0].timeline!.frameScripts![0].source).toBe(source);
  const before = clone(p);
  expect(() => setFrameScript(p, 1, 'x')).toThrow(/budget/);
  expect(p).toEqual(before);
  const owner = captureSymbolFrameSources(() => ({ project: p, revision: 0 }));
  expect(() => owner.prepare([request(source + 'x')])).toThrow(/budget/);
  expect(p).toEqual(before);
  // One all-request replacement can transfer capacity; intermediate request order cannot reject it.
  const transferred = owner.prepare([request('x'.repeat(256 * 1024 - 1)), request(null, 0, 'b')]);
  expect(validateProject(transferred)).toEqual(transferred);
});
it('shares the exact 10000-body count without requiring nonempty text', () => {
  const p = fixture();
  p.duration = 10000;
  p.frameScripts = Array.from({ length: 9999 }, (_, frame) => ({ frame, source: '' }));
  const owner = captureSymbolFrameSources(() => ({ project: p, revision: 0 })),
    at = owner.prepare([request('')]);
  expect(validateProject(at)).toEqual(at);
  expect(() =>
    captureSymbolFrameSources(() => ({ project: at, revision: 0 })).prepare([request('', 1)]),
  ).toThrow(/count budget/);
  expect(() => setFrameScript(at, 9999, '')).toThrow(/count budget/);
});
it.each([0, 20, 40, 41, 53, 54])(
  'migrates schema %s without sources and rejects unversioned symbol tables',
  (version) => {
    const p = fixture(),
      old = { ...clone(p), schemaVersion: version };
    // This fixture uses symbol timelines introduced in schema21.
    if (version >= 21) expect(migrateProject(old)).toEqual(p);
    const invalid = clone(old);
    invalid.symbols![0].timeline!.frameScripts = [];
    expect(() => migrateProject(invalid)).toThrow(/schema 55/);
  },
);
it('roundtrips actual directory persistence, requires the new manifest and preserves legacy54 upgrade', async () => {
  const p = fixture(),
    store = memoryStore();
  const result = captureSymbolFrameSources(() => ({ project: p, revision: 0 })).prepare([
    request('\uFEFFlet x =\r\n'),
    request('', 1, 'b'),
  ]);
  const raw = await saveProject(store, result, null);
  expect(JSON.parse(raw).schemaVersion).toBe(59);
  expect((await loadProject(store)).project).toEqual(result);
  const downgraded = JSON.parse(raw);
  downgraded.schemaVersion = 54;
  await store.commit('project.json', JSON.stringify(downgraded), raw);
  await expect(loadProject(store)).rejects.toThrow(/schema 58 manifest/);
  const cleanStore = memoryStore(),
    clean = await saveProject(cleanStore, p, null),
    legacy = JSON.parse(clean);
  legacy.schemaVersion = 54;
  legacy.document.schemaVersion = 54;
  const old = JSON.stringify(legacy);
  await cleanStore.commit('project.json', old, clean);
  expect((await loadProject(cleanStore)).project).toEqual(p);
});
it('preserves sources during artwork-only symbol edits and rejects duration truncation atomically', () => {
  const source = fixture(),
    p = captureSymbolFrameSources(() => ({ project: source, revision: 0 })).prepare([
      request('local', 3),
    ]),
    before = clone(p),
    definition = clone(p.symbols![0]);
  definition.timeline!.duration = 3;
  expect(() => updateSymbolTimeline(p, 'a', definition)).toThrow();
  expect(p).toEqual(before);
  definition.timeline!.duration = 4;
  definition.shapes[0].x++;
  updateSymbolTimeline(p, 'a', definition);
  expect(p.symbols![0].timeline!.frameScripts).toEqual([{ frame: 3, source: 'local' }]);
});
it.each([
  null,
  [{ frame: -1, source: '' }],
  [{ frame: 4, source: '' }],
  [{ frame: 0, source: 4 }],
  [
    { frame: 1, source: '' },
    { frame: 0, source: '' },
  ],
])('validates raw symbol tables %j', (frameScripts) => {
  const p = fixture();
  Object.assign(p.symbols![0].timeline!, { frameScripts });
  expect(() => validateProject(p)).toThrow();
});
it.each(['source', 'revision', 'library'])(
  'rejects final %s changes after complete detached preparation',
  (kind) => {
    const p = fixture();
    let reads = 0,
      revision = 0;
    const owner = captureSymbolFrameSources(() => {
      reads++;
      if (reads === 5) {
        if (kind === 'source') p.name = 'late edit';
        if (kind === 'revision') revision++;
        if (kind === 'library') p.symbols![1].buttonStates!.down = 0;
      }
      return { project: p, revision };
    });
    expect(() => owner.prepare([request('prepared'), request('other', 1, 'b')])).toThrow(/changed/);
    expect(reads).toBe(5);
    expect(p.symbols!.every((s) => s.timeline?.frameScripts === undefined)).toBe(true);
  },
);
it('rejects original aggregate artwork overflow and retains original invalid numbers', () => {
  const p = fixture();
  p.symbols![0].shapes = Array.from({ length: 100001 }, (_, i) => ({
    ...p.symbols![0].shapes[0],
    id: String(i),
  }));
  expect(() => captureSymbolFrameSources(() => ({ project: p, revision: 0 }))).toThrow(/budget/);
  expect(p.symbols![0].shapes).toHaveLength(100001);
  const bad = fixture();
  bad.symbols![1].shapes[0].x = Infinity;
  expect(() => captureSymbolFrameSources(() => ({ project: bad, revision: 0 }))).toThrow();
  expect(bad.symbols![1].shapes[0].x).toBe(Infinity);
});
it('rejects sources placed on a definition instead of an existing local timeline', () => {
  const p = fixture();
  Object.assign(p.symbols![2], { frameScripts: [{ frame: 0, source: '' }] });
  expect(() => validateProject(p)).toThrow(/existing timeline/);
});
it('rejects disposal during a final enclosing admission read', () => {
  const p = fixture();
  let reads = 0;
  const owner = captureSymbolFrameSources(() => {
    if (++reads === 5) owner.dispose();
    return { project: p, revision: 0 };
  });
  expect(() => owner.prepare([request('unpublished')])).toThrow(/disposed/);
  expect(p.symbols![0].timeline!.frameScripts).toBeUndefined();
});

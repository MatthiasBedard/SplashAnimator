import { expect, it, vi, afterEach } from 'vitest';
import {
  newProject,
  History,
  symbolLayers,
  MAX_SYMBOL_ARTWORK,
  validateProject,
  type SymbolDefinition,
  type Vector,
} from '../packages/document/src';
import { type MotionEase } from '../packages/document/src/motion-ease';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
  setRememberedMotionOpacityEase as edit,
  editSymbolBasicMotionSpan,
  rememberedOpacitySummary,
} from '../packages/animation/src/motion-spans';

const cubic: MotionEase = { kind: 'cubic', x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 0 };
function fixture(kind: Vector['kind'] = 'rectangle', reflected = false) {
  const p = newProject();
  p.duration = 12;
  const a: Vector = {
    id: 'art',
    kind,
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    rotation: 30,
    transform: [reflected ? -2 : 2, 0.5, 1, 3],
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    opacity: 0.2,
    pivot: { x: 7, y: -3 },
  };
  if (kind === 'polygon') {
    a.fillRule = 'evenodd';
    a.contours = [
      [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 60 },
        { x: 0, y: 60 },
      ],
      [
        { x: 10, y: 10 },
        { x: 10, y: 20 },
        { x: 20, y: 10 },
      ],
    ];
  }
  if (kind === 'bezier')
    a.nodes = [
      { x: 0, y: 0, out: { x: 10, y: 20 } },
      { x: 80, y: 60, in: { x: 60, y: 80 } },
    ];
  const first = p.layers[0];
  first.id = 'a';
  first.drawingMode = 'object';
  first.keys = [
    { frame: 0, shapes: [a] },
    { frame: 8, shapes: [{ ...structuredClone(a), x: 90, opacity: 0.8 }] },
    { frame: 10, shapes: [] },
  ];
  p.layers.push({ ...structuredClone(first), id: 'b', name: 'Second' });
  createBasicMotionSpan(p, ['a', 'b'], 0, 8, 'in', { affine: true, pivots: true });
  return p;
}
const nonOpacity = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (key, value) =>
      key === 'opacity' || key === 'opacityEase' || key === 'baseline' ? undefined : value,
    ),
  );
afterEach(() => vi.restoreAllMocks());
it('saved opacity summaries canonicalize controls without confusing inheritance with explicit Linear', () => {
  const p = fixture();
  edit(p, ['a', 'b'], 0, 8, cubic);
  p.layers[1].motionSpans![0].opacityEase = { y2: 0, x2: 2 / 3, y1: 0, x1: 1 / 3, kind: 'cubic' };
  expect(rememberedOpacitySummary(p.layers, ['a', 'b'], 0, 8)).toContain(
    'Independent opacity cubic',
  );
  p.layers[1].motionSpans![0].opacityEase = { ...cubic, y1: NaN };
  expect(rememberedOpacitySummary(p.layers, ['a', 'b'], 0, 8)).toBe('Invalid saved opacity easing');
});
it('isolated opacity editing admits exact aggregate capacity without increasing artwork', () => {
  const s = symbolFixture(),
    count = symbolLayers(s).reduce(
      (n, l) => n + l.keys.reduce((m, k) => m + k.shapes.length, 0),
      0,
    );
  const extra: SymbolDefinition = {
    id: 'extra',
    name: 'Extra',
    width: 1,
    height: 1,
    shapes: Array.from({ length: MAX_SYMBOL_ARTWORK - count }, (_, i) => ({
      id: 'e' + i,
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    })),
  };
  const project = newProject();
  project.symbols = [s, extra];
  validateProject(project);
  const output = symbolEdit(s, 'out', [s, extra]);
  expect(
    symbolLayers(output).reduce((n, l) => n + l.keys.reduce((m, k) => m + k.shapes.length, 0), 0) +
      extra.shapes.length,
  ).toBe(MAX_SYMBOL_ARTWORK);
  for (const l of symbolLayers(output)) expect(l.keys[4].shapes[0].opacity).toBeCloseTo(0.65, 13);
}, 60000);
it('rejects original source accessors before invoking them', () => {
  const p = fixture();
  let reads = 0;
  Object.defineProperty(p, 'layers', {
    get() {
      reads++;
      throw Error('source getter');
    },
  });
  expect(() => edit(p, ['a'], 0, 8, 'out')).toThrow(/original data/);
  expect(reads).toBe(0);
});
it('rejects metadata clone tampering rather than publishing a different requested curve', () => {
  const p = fixture(),
    before = structuredClone(p),
    parse = JSON.parse;
  vi.spyOn(JSON, 'parse').mockImplementation(((...args: Parameters<typeof JSON.parse>) => {
    const result = parse(...args);
    if (result?.kind === 'cubic') result.y1 = 0.9;
    return result;
  }) as typeof JSON.parse);
  expect(() => edit(p, ['a', 'b'], 0, 8, cubic)).toThrow(/cloning/);
  expect(p).toEqual(before);
});
for (const field of ['name', 'opacity'] as const)
  it('isolated complete output rejects clone tampering in ' + field, () => {
    const s = symbolFixture(),
      before = structuredClone(s),
      parse = JSON.parse;
    let hit = false;
    vi.spyOn(JSON, 'parse').mockImplementation(((...args: Parameters<typeof JSON.parse>) => {
      const result = parse(...args);
      if (field === 'name' && result?.id === 's') {
        hit = true;
        result.name = 'forged';
      }
      if (field === 'opacity' && Array.isArray(result) && result[0]?.keys?.length) {
        hit = true;
        result[0].keys[4].shapes[0].opacity = 0.99;
      }
      return result;
    }) as typeof JSON.parse);
    expect(() => symbolEdit(s, 'out')).toThrow(/output changed/);
    expect(hit).toBe(true);
    expect(s).toEqual(before);
  });
it('isolated requests reject duplicate tracks rather than silently deduplicating', () => {
  const s = symbolFixture(),
    id = symbolLayers(s)[0].id;
  expect(() => editSymbolBasicMotionSpan(s, [id, id], 0, 8, 'clearOpacity', 'linear', [s])).toThrow(
    /distinct/,
  );
});
it('a source-valid rejected reentrant capture can retry freshly', () => {
  const p = fixture(),
    request = {
      ...cubic,
      get y1() {
        try {
          edit(p, ['a'], 0, 8, 'out');
        } catch {
          /* swallowed */
        }
        return 0;
      },
    };
  expect(() => edit(p, ['a'], 0, 8, request)).toThrow();
  edit(p, ['a'], 0, 8, 'out');
  expect(p.layers[0].keys[4].shapes[0].opacity).toBeCloseTo(0.65, 13);
});
it('explicit Linear still authors metadata when all endpoint opacity was absent', () => {
  const p = fixture();
  for (const layer of p.layers) {
    layer.keys = layer.keys.filter((k) => k.frame === 0 || k.frame === 8 || k.frame === 10);
    delete layer.motionSpans;
    for (const key of layer.keys) for (const shape of key.shapes) delete shape.opacity;
  }
  createBasicMotionSpan(p, ['a', 'b'], 0, 8, 'in', { affine: true, pivots: true });
  const ends = structuredClone([p.layers[0].keys[0], p.layers[0].keys[8]]);
  edit(p, ['a', 'b'], 0, 8, 'linear');
  expect(p.layers[0].motionSpans![0].opacityEase).toBe('linear');
  expect([p.layers[0].keys[0], p.layers[0].keys[8]]).toEqual(ends);
  expect(p.layers[0].keys[4].shapes[0].opacity ?? 1).toBe(1);
});
it('prepared history detects reentry during before-image cloning', () => {
  const p = newProject(),
    h = new History(),
    stringify = JSON.stringify;
  let hit = false;
  vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown, ...args: unknown[]) => {
    if (value === p && !hit) {
      hit = true;
      h.clear();
    }
    return stringify(value, ...(args as []));
  }) as typeof JSON.stringify);
  expect(() => h.prepareRecord(p, 'opacity')).toThrow(/History changed/);
  expect(hit).toBe(true);
  expect(h.undoLabel).toBeUndefined();
});
for (const kind of ['rectangle', 'bezier', 'polygon'] as const)
  for (const reflected of [false, true])
    it(`applies custom/removes while retaining exact non-opacity data in ${kind}/${reflected}`, () => {
      const p = fixture(kind, reflected),
        before = structuredClone(p),
        ends = p.layers.map((l) => [l.keys[0], l.keys[8], l.keys[9]]);
      const target = { ...cubic };
      edit(p, ['a', 'b'], 0, 8, target);
      target.y1 = 0.9;
      expect(nonOpacity(p)).toEqual(nonOpacity(before));
      p.layers.forEach((l, i) => {
        expect(l.keys[4].shapes[0].x).toBe(30);
        expect(l.keys[4].shapes[0].opacity).toBeCloseTo(0.275, 13);
        expect(l.motionSpans![0].opacityEase).toEqual(cubic);
        expect([l.keys[0], l.keys[8], l.keys[9]]).toEqual(ends[i]);
        expect(l.keys[0]).toBe(ends[i][0]);
      });
      const reopened = JSON.parse(JSON.stringify(p));
      edit(reopened, ['a', 'b'], 0, 8, null);
      expect(nonOpacity(reopened)).toEqual(nonOpacity(before));
      expect(reopened.layers[0].keys[4].shapes[0].opacity).toBeCloseTo(0.35, 13);
      expect(Object.hasOwn(reopened.layers[0].motionSpans![0], 'opacityEase')).toBe(false);
    });
for (const ease of ['linear', 'in', 'out', 'in-out', cubic] as MotionEase[])
  it('canonical explicit override ' + JSON.stringify(ease), () => {
    const p = fixture();
    edit(p, ['a'], 0, 8, ease);
    expect(p.layers[0].motionSpans![0].opacityEase).toEqual(ease);
    const expected =
      typeof ease === 'object' ? 0.275 : ease === 'in' ? 0.35 : ease === 'out' ? 0.65 : 0.5;
    expect(p.layers[0].keys[4].shapes[0].opacity).toBeCloseTo(expected, 13);
    refreshBasicMotionSpan(p, ['a'], 0, 8, 'out');
    expect(p.layers[0].keys[4].shapes[0].opacity).toBeCloseTo(expected, 13);
    edit(p, ['a'], 0, 8, null);
    expect(p.layers[0].keys[4].shapes[0].opacity).toBeCloseTo(0.65, 13);
  });
it('mixed batch preserves unchanged members and rejects all-member no-op atomically', () => {
  const p = fixture();
  edit(p, ['a'], 0, 8, 'linear');
  const a = p.layers[0].keys,
    spans = p.layers[0].motionSpans;
  expect(rememberedOpacitySummary(p.layers, ['a', 'b'], 0, 8)).toBe('Mixed opacity easing');
  edit(p, ['a', 'b'], 0, 8, 'linear');
  expect(p.layers[0].keys).toBe(a);
  expect(p.layers[0].motionSpans).toBe(spans);
  const before = structuredClone(p);
  expect(() => edit(p, ['a', 'b'], 0, 8, 'linear')).toThrow(/already/);
  expect(p).toEqual(before);
  expect(rememberedOpacitySummary(p.layers, ['a', 'b'], 0, 8)).toBe('Independent opacity: linear');
  edit(p, ['a', 'b'], 0, 8, null);
  expect(rememberedOpacitySummary(p.layers, ['a', 'b'], 0, 8)).toBe(
    'Opacity inherits global easing',
  );
});
for (const failure of [
  'endpoint',
  'generated',
  'missing',
  'hidden',
  'locked',
  'duplicate',
  'range',
  'nonfinite',
  'readonly',
] as const)
  it('rejects later-track ' + failure + ' without earlier-track publication', () => {
    const p = fixture(),
      b = p.layers[1];
    if (failure === 'endpoint') b.keys[8].shapes[0].opacity = 0.9;
    if (failure === 'generated') b.keys[4].shapes[0].x++;
    if (failure === 'missing') delete b.motionSpans;
    if (failure === 'hidden') b.visible = false;
    if (failure === 'locked') b.locked = true;
    if (failure === 'duplicate') b.motionSpans!.push({ ...b.motionSpans![0] });
    if (failure === 'nonfinite') b.keys[0].shapes[0].x = NaN;
    if (failure === 'readonly') Object.defineProperty(b, 'keys', { writable: false });
    const before = structuredClone(p),
      keys = p.layers[0].keys;
    expect(() => edit(p, ['a', 'b'], 0, failure === 'range' ? 7 : 8, 'out')).toThrow();
    expect(p).toEqual(before);
    expect(p.layers[0].keys).toBe(keys);
  });
it('requires explicit refresh for endpoint edits, then permits retry', () => {
  const p = fixture();
  p.layers[0].keys[8].shapes[0].opacity = 0.9;
  expect(() => edit(p, ['a'], 0, 8, 'out')).toThrow(/Refresh/);
  refreshBasicMotionSpan(p, ['a'], 0, 8);
  edit(p, ['a'], 0, 8, 'out');
  expect(p.layers[0].keys[4].shapes[0].opacity).toBeCloseTo(0.725, 13);
});
for (const request of [
  undefined,
  NaN,
  Infinity,
  'unknown',
  { ...cubic, y1: 2 },
  { ...cubic, x1: NaN },
])
  it('rejects raw request ' + JSON.stringify(request), () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => edit(p, ['a'], 0, 8, request as MotionEase)).toThrow();
    expect(p).toEqual(before);
  });
for (const phase of ['target', 'ids', 'callback', 'clone', 'reentry', 'async', 'freeze'] as const)
  it('rejects ' + phase + ' side effects and preserves separately authored source edits', () => {
    const p = fixture(),
      original = structuredClone(p);
    let request: MotionEase = 'out';
    const ids = ['a', 'b'];
    let validate: undefined | (() => unknown);
    if (phase === 'target')
      request = {
        ...cubic,
        get y1() {
          p.name = 'external';
          return 0;
        },
      };
    if (phase === 'ids')
      Object.defineProperty(ids, 0, {
        get() {
          ids.push('later');
          return 'a';
        },
      });
    if (phase === 'callback')
      validate = () => {
        p.name = 'external';
      };
    if (phase === 'clone') {
      const stringify = JSON.stringify;
      let hit = false;
      vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown, ...args: unknown[]) => {
        if (
          !hit &&
          value &&
          typeof value === 'object' &&
          'kind' in value &&
          (value as { kind: string }).kind === 'cubic'
        ) {
          hit = true;
          p.name = 'external';
        }
        return stringify(value, ...(args as []));
      }) as typeof JSON.stringify);
      request = cubic;
    }
    if (phase === 'reentry')
      request = {
        ...cubic,
        get y1() {
          try {
            edit(p, ['a'], 0, 8, 'out');
          } catch {
            /* swallowed by caller */
          }
          return 0;
        },
      };
    if (phase === 'async') validate = () => Promise.resolve();
    if (phase === 'freeze') {
      let calls = 0;
      validate = () => {
        if (++calls === 2) Object.defineProperty(p.layers[1], 'keys', { writable: false });
      };
    }
    expect(() => edit(p, ids, 0, 8, request, { validate: validate as () => void })).toThrow();
    if (['target', 'callback', 'clone'].includes(phase)) original.name = 'external';
    expect(p).toEqual(original);
  });
it('snapshots target controls once without invoking caller iterators', () => {
  const p = fixture();
  let reads = 0;
  const target = {
    ...cubic,
    get y1() {
      reads++;
      return 0;
    },
  };
  const ids = ['a', 'b'];
  ids[Symbol.iterator] = () => {
    throw Error('iterator');
  };
  edit(p, ids, 0, 8, target);
  expect(reads).toBe(1);
  expect(p.layers[0].motionSpans![0].opacityEase).toEqual(cubic);
});
function symbolFixture() {
  const p = fixture('polygon', true),
    a = p.layers[0],
    b = p.layers[1];
  const s: SymbolDefinition = {
    id: 's',
    name: 'Symbol',
    width: 160,
    height: 100,
    shapes: a.keys[0].shapes,
    multiFramePivot: { x: -3, y: 7 },
    timeline: { duration: 12, keys: a.keys.slice(1), motionSpans: a.motionSpans, layers: [b] },
  };
  return s;
}
function symbolEdit(s: SymbolDefinition, request: MotionEase | null, library = [s]) {
  return editSymbolBasicMotionSpan(
    s,
    symbolLayers(s).map((l) => l.id),
    0,
    8,
    request === null ? 'clearOpacity' : 'opacity',
    'linear',
    library,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    request ?? undefined,
  );
}
it('isolated base/additional preparation detaches outputs and retains full settings', () => {
  const s = symbolFixture(),
    before = structuredClone(s),
    output = symbolEdit(s, cubic);
  expect(s).toEqual(before);
  expect(nonOpacity(output)).toEqual(nonOpacity(before));
  for (const l of symbolLayers(output)) expect(l.keys[4].shapes[0].opacity).toBeCloseTo(0.275, 13);
  const reopen = symbolEdit(JSON.parse(JSON.stringify(output)), null);
  expect(nonOpacity(reopen)).toEqual(nonOpacity(before));
  output.shapes[0].x = 999;
  expect(s).toEqual(before);
});
it('isolated late clone mutation and swallowed reentry cannot return a stale candidate', () => {
  const s = symbolFixture(),
    before = structuredClone(s),
    stringify = JSON.stringify;
  let hit = false;
  vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown, ...args: unknown[]) => {
    if (!hit && value === s) {
      hit = true;
      s.name = 'external';
    }
    return stringify(value, ...(args as []));
  }) as typeof JSON.stringify);
  expect(() => symbolEdit(s, 'out')).toThrow(/source changed|output changed/);
  expect(hit).toBe(true);
  before.name = 'external';
  expect(s).toEqual(before);
  vi.restoreAllMocks();
  const request = {
    ...cubic,
    get y1() {
      try {
        symbolEdit(s, 'out');
      } catch {
        /* caller swallowed */
      }
      return 0;
    },
  };
  expect(() => symbolEdit(s, request)).toThrow(/source changed/);
});
it('rejects over-capacity original library without altering the isolated definition', () => {
  const s = symbolFixture(),
    before = structuredClone(s),
    extra = {
      id: 'extra',
      name: 'Extra',
      width: 1,
      height: 1,
      shapes: Array(MAX_SYMBOL_ARTWORK).fill({ ...s.shapes[0], id: 'extra-art' }),
    };
  expect(() => symbolEdit(s, 'out', [s, extra])).toThrow(/budget/);
  expect(s).toEqual(before);
});
it('prepared history is detached and single-use without altering history before admission', () => {
  const p = newProject(),
    h = new History(),
    commit = h.prepareRecord(p, 'opacity');
  expect(h.undoLabel).toBeUndefined();
  p.name = 'after';
  commit();
  expect(h.undo(p)!.name).not.toBe('after');
  expect(() => commit()).toThrow(/stale/);
});
for (const action of ['record', 'undo', 'redo', 'clear'] as const)
  it(
    'prepared history rejects after ' + action + ' even when the visible stack is restored',
    () => {
      const p = newProject(),
        h = new History();
      h.record(p, 'old');
      h.undo(p);
      const commit = h.prepareRecord(p, 'opacity');
      if (action === 'record') h.record(p, 'other');
      if (action === 'undo') {
        h.redo(p);
        h.undo(p);
      }
      if (action === 'redo') h.redo(p);
      if (action === 'clear') h.clear();
      expect(() => commit()).toThrow(/stale/);
      expect(h.undoLabel).not.toBe('opacity');
    },
  );

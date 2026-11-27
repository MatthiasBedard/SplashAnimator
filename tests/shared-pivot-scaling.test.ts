import { afterEach, expect, it, vi } from 'vitest';
import {
  newProject,
  symbolLayers,
  symbolArtworks,
  MAX_SYMBOL_ARTWORK,
  type Vector,
  type Point,
  type SymbolDefinition,
} from '../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import {
  scaleRememberedEndpoint,
  scaleSymbolRememberedEndpoint,
  rotateRememberedEndpoint,
  rotateSymbolRememberedEndpoint,
} from '../packages/animation/src/motion-junction';

afterEach(() => vi.restoreAllMocks());
function fixture(mode = 'plain') {
  const p = newProject();
  p.duration = 14;
  const ink = (id: string, x: number, y: number): Vector => ({
    id,
    kind: 'rectangle',
    x,
    y,
    width: 12,
    height: 9,
    rotation: 0,
    fill: '#e02030',
    stroke: '#111111',
    strokeWidth: 0,
    points: [],
    ...(id === 'other' ? {} : { groups: ['outer', ...(id === 'a' ? ['inner'] : [])] }),
  });
  if (mode.startsWith('nested-'))
    p.symbols = [
      {
        id: 'child',
        name: 'Child',
        width: 12,
        height: 9,
        shapes: [{ ...ink('other', 0, 0), id: 'kid' }],
      },
    ];
  p.layers = ['base', 'extra'].map((id, i) => ({
    id,
    name: id,
    visible: true,
    locked: false,
    drawingMode: 'object',
    keys: [...new Set([0, i ? 1 : 0, 4, i ? 10 : 8, 12])].map((frame) => ({
      frame,
      shapes:
        frame === 12
          ? []
          : [
              ink('a', 10 + frame * 7, i ? 120 : 20),
              ink('b', 40 + frame * 7, i ? 140 : 50),
              ink('other', 150, i ? 160 : 70),
            ],
    })),
  }));
  for (const layer of p.layers) {
    for (const key of layer.keys)
      for (const s of key.shapes) {
        if (mode === 'saved') s.pivot = { x: -3, y: 17 };
        if (mode.startsWith('nested-') && s.id === 'a') {
          s.kind = 'symbol';
          s.symbolId = 'child';
          s.symbolPlayback = {
            mode: mode.slice(7) as 'loop' | 'once' | 'single' | 'movie',
            firstFrame: 0,
          };
        }
        if (mode === 'rotated' || mode === 'affine' || mode === 'reflected') s.rotation = 23;
        if (mode === 'affine' || mode === 'reflected')
          s.transform = [mode === 'reflected' ? -1.3 : 1.3, 0.2, 0.4, 0.8];
        if (mode === 'compound' || mode === 'aligned') {
          s.kind = 'polygon';
          s.closed = true;
          s.fillRule = 'evenodd';
          s.contours = [
            [
              [0, 0],
              [12, 0],
              [12, 9],
              [0, 9],
            ],
            [
              [3, 3],
              [3, 5],
              [5, 3],
            ],
          ].map((r) => r.map(([x, y]) => ({ x, y })));
        }
      }
    const i = layer.id === 'extra' ? 1 : 0,
      rotation = {
        direction: 'shortest' as const,
        turns: 0,
        rigidGroups: true,
        axisGroupScale: true,
        axisGroupShear: true,
      };
    if (mode === 'aligned')
      for (const key of layer.keys)
        if (key.frame >= 4)
          for (const s of key.shapes)
            s.contours = [...s.contours!]
              .reverse()
              .map((r) => [r[1], r[0], ...r.slice(2).reverse()]);
    createBasicMotionSpan(
      p,
      [layer.id],
      i ? 1 : 0,
      4,
      'in',
      { affine: true, ...(mode === 'aligned' ? { nodes: true } : {}) },
      undefined,
      mode === 'aligned' ? undefined : rotation,
      mode === 'aligned' ? { order: [1, 0], start: [1, 1], reverse: [true, true] } : undefined,
    );
    createBasicMotionSpan(
      p,
      [layer.id],
      4,
      i ? 10 : 8,
      'out',
      { affine: true, ...(mode === 'aligned' ? { nodes: true } : {}) },
      undefined,
      mode === 'aligned' ? undefined : rotation,
    );
  }
  return p;
}
const picks = [
  { layerId: 'base', shapeIds: ['a', 'b'] },
  { layerId: 'extra', shapeIds: ['a', 'b'] },
];
const pivot = { x: -31, y: 83 };
function world(s: Vector, p: Point) {
  const r = (s.rotation * Math.PI) / 180,
    c = Math.cos(r),
    n = Math.sin(r),
    [a, b, u, d] = s.transform ?? [1, 0, 0, 1];
  return {
    x: s.x + c * (a * p.x + u * p.y) - n * (b * p.x + d * p.y),
    y: s.y + n * (a * p.x + u * p.y) + c * (b * p.x + d * p.y),
  };
}
function scaled(p: Point, center: Point, sx: number, sy: number) {
  return { x: center.x + sx * (p.x - center.x), y: center.y + sy * (p.y - center.y) };
}
function basis(s: Vector) {
  const r = (s.rotation * Math.PI) / 180,
    c = Math.cos(r),
    n = Math.sin(r),
    [a, b, u, d] = s.transform ?? [1, 0, 0, 1];
  return [c * a - n * b, n * a + c * b, c * u - n * d, n * u + c * d, s.x, s.y];
}
function metadata(s: Vector) {
  return Object.fromEntries(
    Object.entries(s).filter(([key]) => !['x', 'y', 'rotation', 'transform'].includes(key)),
  );
}
function settings(spans: NonNullable<ReturnType<typeof fixture>['layers'][number]['motionSpans']>) {
  return spans.map(({ baseline: _baseline, ...s }) => s);
}
function symbolFixture(mode = 'plain') {
  const p = fixture(mode),
    base = p.layers[0],
    definition: SymbolDefinition = {
      id: 'symbol',
      name: 'Shared scaling',
      width: 400,
      height: 300,
      buttonStates: { up: 0, over: 4, down: 8, hit: 12 },
      multiFramePivot: { x: -20, y: 30 },
      shapes: base.keys[0].shapes,
      timeline: {
        duration: p.duration,
        keys: base.keys.slice(1),
        motionSpans: base.motionSpans,
        layers: [p.layers[1]],
      },
    };
  return {
    definition,
    library: [...(p.symbols ?? []), definition],
    selection: [{ layerId: '@base', shapeIds: ['a', 'b'] }, picks[1]],
  };
}

for (const mode of [
  'plain',
  'saved',
  'rotated',
  'affine',
  'reflected',
  'compound',
  'aligned',
  'nested-loop',
  'nested-once',
  'nested-single',
  'nested-movie',
])
  for (const [sx, sy] of [
    [1.5, 0.75],
    [1.25, 1.25],
    [2, 1],
    [1, 1.2],
  ])
    it(
      'uses one explicit world pivot across different scaling track spans: ' +
        mode +
        ' ' +
        sx +
        ',' +
        sy,
      () => {
        const p = fixture(mode),
          before = structuredClone(p),
          outer = p.layers.map((l) =>
            l.keys.filter(
              (k) =>
                k.frame <= (l.id === 'extra' ? 1 : 0) || k.frame >= (l.id === 'extra' ? 10 : 8),
            ),
          ),
          siblings = p.layers.map((l) => l.keys.find((k) => k.frame === 4)!.shapes[2]);
        scaleRememberedEndpoint(p, 4, picks, sx, sy, pivot);
        for (let i = 0; i < 2; i++) {
          const l = p.layers[i],
            old = before.layers[i];
          expect(settings(l.motionSpans!)).toEqual(settings(old.motionSpans!));
          for (const key of outer[i]) expect(l.keys.find((k) => k.frame === key.frame)).toBe(key);
          expect(l.keys.find((k) => k.frame === 4)!.shapes[2]).toBe(siblings[i]);
          for (let j = 0; j < 2; j++) {
            const shape = l.keys.find((k) => k.frame === 4)!.shapes[j],
              original = old.keys.find((k) => k.frame === 4)!.shapes[j],
              m = basis(original),
              n = basis(shape);
            expect(metadata(shape)).toEqual(metadata(original));
            const expected = [
              sx * m[0],
              sy * m[1],
              sx * m[2],
              sy * m[3],
              pivot.x + sx * (m[4] - pivot.x),
              pivot.y + sy * (m[5] - pivot.y),
            ];
            n.forEach((value, k) => expect(value).toBeCloseTo(expected[k], 10));
            if (sx === 1) for (const k of [0, 2, 4]) expect(n[k]).toBe(m[k]);
            if (sy === 1) for (const k of [1, 3, 5]) expect(n[k]).toBe(m[k]);
            for (const point of [
              { x: 0, y: 0 },
              { x: 7, y: 3 },
              ...(original.contours ?? []).flat(),
            ]) {
              const actual = world(shape, point),
                wanted = scaled(world(original, point), pivot, sx, sy);
              expect(actual.x).toBeCloseTo(wanted.x, 9);
              expect(actual.y).toBeCloseTo(wanted.y, 9);
            }
          }
        }
        const reopened = JSON.parse(JSON.stringify(p));
        for (const layer of reopened.layers)
          for (const span of [...layer.motionSpans])
            refreshBasicMotionSpan(reopened, [layer.id], span.start, span.end);
        expect(reopened).toEqual(p);
        expect(p.duration).toBe(before.duration);
      },
    );
for (const mode of [
  'plain',
  'saved',
  'rotated',
  'affine',
  'reflected',
  'compound',
  'aligned',
  'nested-loop',
  'nested-once',
  'nested-single',
  'nested-movie',
])
  it('keeps omitted and explicit undefined legacy scaling exact: ' + mode, () => {
    const p = fixture(mode),
      q = structuredClone(p);
    scaleRememberedEndpoint(p, 4, picks, 1.5, 0.75);
    scaleRememberedEndpoint(q, 4, picks, 1.5, 0.75, undefined);
    expect(q).toEqual(p);
    const shared = fixture(mode);
    scaleRememberedEndpoint(shared, 4, picks, 1.5, 0.75, pivot);
    expect(shared.layers[0].keys).not.toEqual(p.layers[0].keys);
  });
for (const [sx, sy] of [
  [NaN, 1],
  [Infinity, 1],
  [-Infinity, 1],
  [0, 1],
  [1, 0],
  [-0, 1],
  [1, 1],
  [Number.MIN_VALUE, 1],
  [Number.MAX_VALUE, 1],
  [1, Number.MIN_VALUE],
  [1, Number.MAX_VALUE],
  [new Number(2), 1],
  ['2', 1],
])
  it('rejects invalid or unrepresentable shared scaling ' + sx + ',' + sy, () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => scaleRememberedEndpoint(p, 4, picks, sx as number, sy as number, pivot)).toThrow();
    expect(p).toEqual(before);
  });
for (const center of [
  null,
  {},
  { x: NaN, y: 0 },
  { x: 0, y: Infinity },
  { x: '0', y: 0 },
  { x: new Number(0), y: 0 },
])
  it('rejects malformed original explicit scaling pivots ' + JSON.stringify(center), () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => scaleRememberedEndpoint(p, 4, picks, 1.5, 0.75, center as Point)).toThrow();
    expect(p).toEqual(before);
  });
for (const reason of [
  'missing',
  'duplicate',
  'locked',
  'hidden',
  'merge',
  'stale-left',
  'stale-right',
  'overflow',
  'original',
  'frozen',
  'options',
])
  it('rejects a later scaling track atomically: ' + reason, () => {
    const p = fixture(),
      l = p.layers[1],
      input = structuredClone(picks);
    let center = pivot;
    if (reason === 'missing') input[1].shapeIds = ['absent'];
    if (reason === 'duplicate') input[1].shapeIds = ['a', 'a'];
    if (reason === 'locked') l.locked = true;
    if (reason === 'hidden') l.visible = false;
    if (reason === 'merge') l.drawingMode = 'merge';
    if (reason === 'stale-left' || reason === 'stale-right')
      l.keys.find((k) => k.frame === (reason === 'stale-left' ? 2 : 7))!.shapes[0].x++;
    if (reason === 'overflow') center = { x: 1e308, y: 1e308 };
    if (reason === 'original')
      l.keys.find((k) => k.frame === 4)!.shapes[2].pivot = { x: NaN, y: 0 };
    if (reason === 'frozen') Object.freeze(l);
    if (reason === 'options')
      for (const span of l.motionSpans!) span.rotation!.axisGroupScale = false;
    const before = structuredClone(p),
      keys = p.layers.map((l) => l.keys),
      spans = p.layers.map((l) => l.motionSpans);
    expect(() => scaleRememberedEndpoint(p, 4, input, 1.5, 0.75, center)).toThrow();
    expect(p).toEqual(before);
    p.layers.forEach((l, i) => {
      expect(l.keys).toBe(keys[i]);
      expect(l.motionSpans).toBe(spans[i]);
    });
  });
it('snapshots original pivot/request coordinates and identities once for shared scaling', () => {
  const p = fixture(),
    reads = { x: 0, y: 0, layer: 0, ids: 0, id: 0 },
    ids = ['a', 'b'];
  Object.defineProperty(ids, 0, {
    get() {
      reads.id++;
      return 'a';
    },
  });
  scaleRememberedEndpoint(
    p,
    4,
    [
      {
        get layerId() {
          reads.layer++;
          return 'base';
        },
        get shapeIds() {
          reads.ids++;
          return ids;
        },
      },
    ],
    1.5,
    0.75,
    {
      get x() {
        reads.x++;
        return pivot.x;
      },
      get y() {
        reads.y++;
        return pivot.y;
      },
    },
  );
  expect(reads).toEqual({ x: 1, y: 1, layer: 1, ids: 1, id: 1 });
});
for (const event of ['pivot', 'request', 'clone', 'reentry', 'cross-reentry'])
  it('rejects shared scaling original source changes around ' + event, () => {
    const p = fixture(),
      before = structuredClone(p);
    let seen = false,
      input = picks,
      center: Point = pivot;
    const change = () => {
      seen = true;
      p.layers[1].name = 'External edit';
    };
    if (event === 'pivot')
      center = {
        get x() {
          change();
          return pivot.x;
        },
        y: pivot.y,
      };
    if (event === 'request')
      input = [
        {
          get layerId() {
            change();
            return 'base';
          },
          shapeIds: ['a'],
        },
      ];
    if (event === 'clone') {
      const clone = structuredClone;
      vi.spyOn(globalThis, 'structuredClone').mockImplementation(((v: unknown) => {
        const out = clone(v);
        if (Array.isArray(v) && v[0]?.id === 'a') change();
        return out;
      }) as typeof structuredClone);
    }
    if (event === 'reentry' || event === 'cross-reentry')
      center = {
        get x() {
          seen = true;
          try {
            if (event === 'reentry') scaleRememberedEndpoint(p, 4, picks, 2, 1);
            else rotateRememberedEndpoint(p, 4, picks, 30);
          } catch {}
          return pivot.x;
        },
        y: pivot.y,
      };
    expect(() => scaleRememberedEndpoint(p, 4, input, 1.5, 0.75, center)).toThrow();
    expect(seen).toBe(true);
    if (!event.includes('reentry')) before.layers[1].name = 'External edit';
    expect(p).toEqual(before);
    vi.restoreAllMocks();
    expect(() => scaleRememberedEndpoint(p, 4, picks, 1.5, 0.75, pivot)).not.toThrow();
  });
for (const mode of [
  'plain',
  'saved',
  'affine',
  'reflected',
  'compound',
  'aligned',
  'nested-loop',
  'nested-once',
  'nested-single',
  'nested-movie',
])
  it('forwards shared scaling through detached symbol/library preparation ' + mode, () => {
    const { definition, library, selection } = symbolFixture(mode),
      before = structuredClone({ definition, library }),
      out = scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.5, 0.75, pivot);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const original = symbolLayers(definition)[i].keys.find((k) => k.frame === 4)!.shapes[j],
          shape = symbolLayers(out)[i].keys.find((k) => k.frame === 4)!.shapes[j],
          expected = scaled(world(original, { x: 7, y: 3 }), pivot, 1.5, 0.75),
          actual = world(shape, { x: 7, y: 3 });
        expect(actual.x).toBeCloseTo(expected.x, 9);
        expect(actual.y).toBeCloseTo(expected.y, 9);
        expect(metadata(shape)).toEqual(metadata(original));
      }
    expect(out.buttonStates).toEqual(definition.buttonStates);
    expect(out.multiFramePivot).toEqual(definition.multiFramePivot);
    expect(out.width).toBe(400);
    expect(out.height).toBe(300);
    expect(out.timeline!.duration).toBe(14);
    out.shapes[0].x = 999;
    expect({ definition, library }).toEqual(before);
    const a = scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.5, 0.75),
      b = scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.5, 0.75, undefined);
    expect(b).toEqual(a);
  });
for (const event of ['pivot', 'request', 'clone', 'library', 'reentry', 'cross-reentry'])
  it('retains isolated shared scaling source admission around ' + event, () => {
    const { definition, library, selection } = symbolFixture(),
      before = structuredClone(definition);
    let seen = false,
      center: Point = pivot,
      input = selection;
    const change = () => {
      seen = true;
      definition.name = 'External edit';
    };
    if (event === 'pivot')
      center = {
        get x() {
          change();
          return pivot.x;
        },
        y: pivot.y,
      };
    if (event === 'request')
      input = [
        {
          get layerId() {
            change();
            return '@base';
          },
          shapeIds: ['a'],
        },
      ];
    if (event === 'library')
      center = {
        get x() {
          seen = true;
          library.push({ id: 'new', name: 'New', width: 1, height: 1, shapes: [] });
          return pivot.x;
        },
        y: pivot.y,
      };
    if (event === 'clone') {
      const clone = structuredClone;
      vi.spyOn(globalThis, 'structuredClone').mockImplementation(((v: unknown) => {
        const out = clone(v);
        if ((v as SymbolDefinition)?.id === 'symbol') change();
        return out;
      }) as typeof structuredClone);
    }
    if (event.includes('reentry'))
      center = {
        get x() {
          seen = true;
          try {
            if (event === 'reentry')
              scaleSymbolRememberedEndpoint(definition, library, 4, selection, 2, 1);
            else rotateSymbolRememberedEndpoint(definition, library, 4, selection, 30);
          } catch {}
          return pivot.x;
        },
        y: pivot.y,
      };
    expect(() =>
      scaleSymbolRememberedEndpoint(definition, library, 4, input, 1.5, 0.75, center),
    ).toThrow();
    expect(seen).toBe(true);
    if (!['library', 'reentry', 'cross-reentry'].includes(event)) before.name = 'External edit';
    expect(definition).toEqual(before);
    vi.restoreAllMocks();
    expect(() =>
      scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.5, 0.75, pivot),
    ).not.toThrow();
  });
it('admits exact aggregate scaling capacity and rejects original overflow without artwork loss', () => {
  const { definition, selection } = symbolFixture(),
    own = symbolArtworks(definition).reduce((n, s) => n + s.length, 0),
    other = {
      id: 'other',
      name: 'Other',
      width: 1,
      height: 1,
      shapes: Array(MAX_SYMBOL_ARTWORK - own).fill(definition.shapes[0]),
    },
    library = [definition, other];
  const out = scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.5, 0.75, pivot);
  expect(symbolArtworks(out).reduce((n, s) => n + s.length, 0) + other.shapes.length).toBe(
    MAX_SYMBOL_ARTWORK,
  );
  other.shapes.push(definition.shapes[0]);
  const before = structuredClone(definition);
  expect(() =>
    scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.5, 0.75, pivot),
  ).toThrow(/artwork budget/);
  expect(definition).toEqual(before);
});
it('rechecks a later scaling track frozen during cloning before any writes', () => {
  const p = fixture(),
    before = structuredClone(p),
    keys = p.layers.map((l) => l.keys),
    clone = structuredClone;
  let seen = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const out = clone(value);
    if (Array.isArray(value) && value[0]?.id === 'a') {
      seen = true;
      Object.freeze(p.layers[1]);
    }
    return out;
  }) as typeof structuredClone);
  expect(() => scaleRememberedEndpoint(p, 4, picks, 1.5, 0.75, pivot)).toThrow(/atomic/);
  expect(seen).toBe(true);
  expect(p).toEqual(before);
  p.layers.forEach((l, i) => expect(l.keys).toBe(keys[i]));
});
for (const field of ['tracks', 'artwork'] as const)
  it('bounds raw scaling proxy request lengths before traversal: ' + field, () => {
    const p = fixture(),
      before = structuredClone(p);
    let reads = 0;
    const changing = <T extends unknown[]>(value: T) =>
      new Proxy(value, {
        get(target, key, receiver) {
          if (key === 'length') return ++reads === 1 ? value.length : Infinity;
          return Reflect.get(target, key, receiver);
        },
      });
    const input =
      field === 'tracks' ? changing(picks) : [{ layerId: 'base', shapeIds: changing(['a', 'b']) }];
    expect(() => scaleRememberedEndpoint(p, 4, input, 1.5, 0.75, pivot)).toThrow(/changed/);
    expect(reads).toBe(2);
    expect(p).toEqual(before);
  });
for (const factors of [
  [-1, 1],
  [1, -1],
  [-1, -1],
])
  it('retains grouped orientation/determinant rejection ' + factors, () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => scaleRememberedEndpoint(p, 4, picks, factors[0], factors[1], pivot)).toThrow();
    expect(p).toEqual(before);
  });

for (const origin of [0, 10000, -10000])
  it('preserves small local scaling geometry at translated origin ' + origin, () => {
    const p = fixture('compound');
    for (const l of p.layers) {
      l.keys = l.keys.filter((k) =>
        (l.id === 'extra' ? [0, 1, 4, 10, 12] : [0, 4, 8, 12]).includes(k.frame),
      );
      delete l.motionSpans;
      for (const k of l.keys)
        for (const shape of k.shapes) {
          shape.x = origin + shape.x * 0.001;
          shape.y = origin + shape.y * 0.001;
          shape.contours = shape.contours!.map((r) =>
            r.map((n) => ({ x: n.x * 1e-6, y: n.y * 1e-6 })),
          );
          shape.width *= 1e-6;
          shape.height *= 1e-6;
        }
      const extra = l.id === 'extra';
      createBasicMotionSpan(p, [l.id], extra ? 1 : 0, 4, 'linear', { affine: true });
      createBasicMotionSpan(p, [l.id], 4, extra ? 10 : 8, 'linear', { affine: true });
    }
    const before = structuredClone(p),
      center = { x: origin - 0.01, y: origin + 0.02 };
    scaleRememberedEndpoint(p, 4, picks, 1.5, 0.75, center);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const original = before.layers[i].keys.find((k) => k.frame === 4)!.shapes[j],
          shape = p.layers[i].keys.find((k) => k.frame === 4)!.shapes[j];
        expect(metadata(shape)).toEqual(metadata(original));
        for (const point of original.contours!.flat()) {
          const actual = world(shape, point),
            expected = scaled(world(original, point), center, 1.5, 0.75);
          expect(actual.x).toBeCloseTo(expected.x, 9);
          expect(actual.y).toBeCloseTo(expected.y, 9);
        }
      }
  });
it('invalidates an outer shared rotation when a swallowed scaling reentry targets its original source', () => {
  const p = fixture(),
    before = structuredClone(p);
  let seen = false;
  expect(() =>
    rotateRememberedEndpoint(p, 4, picks, 37, {
      get x() {
        seen = true;
        try {
          scaleRememberedEndpoint(p, 4, picks, 2, 1);
        } catch {}
        return pivot.x;
      },
      y: pivot.y,
    }),
  ).toThrow();
  expect(seen).toBe(true);
  expect(p).toEqual(before);
  expect(() => scaleRememberedEndpoint(p, 4, picks, 1.5, 0.75, pivot)).not.toThrow();
});
it('invalidates outer shared symbol rotation on swallowed symbol scaling reentry', () => {
  const { definition, library, selection } = symbolFixture(),
    before = structuredClone({ definition, library });
  let seen = false;
  expect(() =>
    rotateSymbolRememberedEndpoint(definition, library, 4, selection, 37, {
      get x() {
        seen = true;
        try {
          scaleSymbolRememberedEndpoint(definition, library, 4, selection, 2, 1);
        } catch {}
        return pivot.x;
      },
      y: pivot.y,
    }),
  ).toThrow();
  expect(seen).toBe(true);
  expect({ definition, library }).toEqual(before);
  expect(() =>
    scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.5, 0.75, pivot),
  ).not.toThrow();
});

it('retains an off-view scaling pivot beyond artwork-coordinate bounds without clamping', () => {
  const p = fixture('affine'),
    before = structuredClone(p),
    center = { x: 1000000, y: -2000000 },
    sx = 1.0001,
    sy = 0.9999;
  scaleRememberedEndpoint(p, 4, picks, sx, sy, center);
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const original = before.layers[i].keys.find((k) => k.frame === 4)!.shapes[j],
        shape = p.layers[i].keys.find((k) => k.frame === 4)!.shapes[j];
      expect(metadata(shape)).toEqual(metadata(original));
      const expected = scaled(world(original, { x: 7, y: 3 }), center, sx, sy),
        actual = world(shape, { x: 7, y: 3 });
      expect(actual.x).toBeCloseTo(expected.x, 9);
      expect(actual.y).toBeCloseTo(expected.y, 9);
    }
});
it('reads external symbol scaling pivot and identities once before detached preparation', () => {
  const { definition, library } = symbolFixture(),
    reads = { x: 0, y: 0, layer: 0, ids: 0, id: 0 },
    ids = ['a', 'b'];
  Object.defineProperty(ids, 0, {
    get() {
      reads.id++;
      return 'a';
    },
  });
  scaleSymbolRememberedEndpoint(
    definition,
    library,
    4,
    [
      {
        get layerId() {
          reads.layer++;
          return '@base';
        },
        get shapeIds() {
          reads.ids++;
          return ids;
        },
      },
    ],
    1.5,
    0.75,
    {
      get x() {
        reads.x++;
        return pivot.x;
      },
      get y() {
        reads.y++;
        return pivot.y;
      },
    },
  );
  expect(reads).toEqual({ x: 1, y: 1, layer: 1, ids: 1, id: 1 });
});
for (const event of ['definition', 'library'])
  it('rejects final complete scaled symbol clone source changes ' + event, () => {
    const { definition, library, selection } = symbolFixture(),
      before = structuredClone(definition),
      clone = structuredClone;
    let seen = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
      const out = clone(value),
        d = value as SymbolDefinition;
      if (
        d?.id === 'symbol' &&
        d.timeline?.keys.find((k) => k.frame === 4)?.shapes[0].transform?.[0] === 1.5
      ) {
        expect(
          d.timeline.layers!.find((l) => l.id === 'extra')!.keys.find((k) => k.frame === 4)!
            .shapes[0].transform![0],
        ).toBe(1.5);
        seen = true;
        if (event === 'definition') definition.name = 'Late external edit';
        else library.push({ id: 'late', name: 'Late', width: 1, height: 1, shapes: [] });
      }
      return out;
    }) as typeof structuredClone);
    expect(() =>
      scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.5, 0.75, pivot),
    ).toThrow();
    expect(seen).toBe(true);
    if (event === 'definition') before.name = 'Late external edit';
    expect(definition).toEqual(before);
    if (event === 'library') expect(library.map((s) => s.id)).toEqual(['symbol', 'late']);
    vi.restoreAllMocks();
    expect(() =>
      scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.5, 0.75, pivot),
    ).not.toThrow();
  });
for (const field of ['layers', 'keys', 'spans'])
  it('rejects equal-content replaced scaling source references ' + field, () => {
    const p = fixture(),
      before = structuredClone(p),
      keys = p.layers[0].keys,
      spans = p.layers[0].motionSpans;
    let external: unknown,
      seen = false;
    const center = {
      get x() {
        seen = true;
        if (field === 'layers') external = p.layers = [...p.layers];
        else if (field === 'keys') external = p.layers[1].keys = [...p.layers[1].keys];
        else external = p.layers[1].motionSpans = [...p.layers[1].motionSpans!];
        return pivot.x;
      },
      y: pivot.y,
    };
    expect(() => scaleRememberedEndpoint(p, 4, picks, 1.5, 0.75, center)).toThrow();
    expect(seen).toBe(true);
    expect(p).toEqual(before);
    expect(p.layers[0].keys).toBe(keys);
    expect(p.layers[0].motionSpans).toBe(spans);
    expect(
      field === 'layers' ? p.layers : field === 'keys' ? p.layers[1].keys : p.layers[1].motionSpans,
    ).toBe(external);
    expect(() => scaleRememberedEndpoint(p, 4, picks, 1.5, 0.75, pivot)).not.toThrow();
  });

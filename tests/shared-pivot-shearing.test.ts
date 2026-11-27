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
  skewRememberedEndpoint,
  skewSymbolRememberedEndpoint,
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
        if (mode === 'compound' || mode === 'aligned' || mode === 'curved') {
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
        if (mode === 'curved')
          for (const ring of s.contours!) {
            ring[0].out = { x: ring[0].x + 1, y: ring[0].y - 0.5 };
            ring[ring.length - 1].out = {
              x: ring[ring.length - 1].x - 0.5,
              y: ring[ring.length - 1].y + 0.25,
            };
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
function sheared(p: Point, center: Point, axis: 'x' | 'y', degrees: number) {
  const k = Math.tan((degrees * Math.PI) / 180);
  return axis === 'x'
    ? { x: p.x + k * (p.y - center.y), y: p.y }
    : { x: p.x, y: p.y + k * (p.x - center.x) };
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
      name: 'Shared shearing',
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

const modes = [
  'plain',
  'saved',
  'rotated',
  'affine',
  'reflected',
  'compound',
  'curved',
  'aligned',
  'nested-loop',
  'nested-once',
  'nested-single',
  'nested-movie',
];
for (const mode of modes)
  for (const axis of ['x', 'y'] as const)
    for (const degrees of [18, -12])
      it(`shares one original document shear across all tracks ${mode} ${axis} ${degrees}`, () => {
        const p = fixture(mode),
          before = structuredClone(p),
          keys = p.layers.map((l) =>
            l.keys.filter(
              (k) =>
                k.frame <= (l.id === 'extra' ? 1 : 0) || k.frame >= (l.id === 'extra' ? 10 : 8),
            ),
          ),
          siblings = p.layers.map((l) => l.keys.find((k) => k.frame === 4)!.shapes[2]);
        skewRememberedEndpoint(p, 4, picks, axis, degrees, pivot);
        const k = Math.tan((degrees * Math.PI) / 180);
        for (let i = 0; i < 2; i++) {
          const layer = p.layers[i],
            old = before.layers[i];
          expect(settings(layer.motionSpans!)).toEqual(settings(old.motionSpans!));
          for (const key of keys[i])
            expect(layer.keys.find((k) => k.frame === key.frame)).toBe(key);
          expect(layer.keys.find((k) => k.frame === 4)!.shapes[2]).toBe(siblings[i]);
          for (let j = 0; j < 2; j++) {
            const shape = layer.keys.find((k) => k.frame === 4)!.shapes[j],
              original = old.keys.find((k) => k.frame === 4)!.shapes[j],
              m = basis(original),
              n = basis(shape);
            const expected =
              axis === 'x'
                ? [m[0] + k * m[1], m[1], m[2] + k * m[3], m[3], m[4] + k * (m[5] - pivot.y), m[5]]
                : [m[0], m[1] + k * m[0], m[2], m[3] + k * m[2], m[4], m[5] + k * (m[4] - pivot.x)];
            n.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
            expect(metadata(shape)).toEqual(metadata(original));
            expect(axis === 'x' ? shape.y : shape.x).toBe(axis === 'x' ? original.y : original.x);
            for (const point of [
              { x: 0, y: 0 },
              { x: 7, y: 3 },
              ...(original.contours ?? []).flat(),
            ]) {
              const actual = world(shape, point),
                wanted = sheared(world(original, point), pivot, axis, degrees);
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
      });
for (const mode of modes)
  for (const axis of ['x', 'y'] as const)
    it(`retains exact omitted/undefined per-track shearing ${mode} ${axis}`, () => {
      const p = fixture(mode),
        q = structuredClone(p),
        shared = structuredClone(p);
      skewRememberedEndpoint(p, 4, picks, axis, 18);
      skewRememberedEndpoint(q, 4, picks, axis, 18, undefined);
      expect(q).toEqual(p);
      skewRememberedEndpoint(shared, 4, picks, axis, 18, pivot);
      expect(shared.layers[0].keys).not.toEqual(p.layers[0].keys);
    });
for (const mode of modes)
  for (const axis of ['x', 'y'] as const)
    it(`prepares detached library-aware shears ${mode} ${axis}`, () => {
      const { definition, library, selection } = symbolFixture(mode),
        before = structuredClone({ definition, library });
      const out = skewSymbolRememberedEndpoint(definition, library, 4, selection, axis, 18, pivot);
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const original = symbolLayers(definition)[i].keys.find((k) => k.frame === 4)!.shapes[j],
            shape = symbolLayers(out)[i].keys.find((k) => k.frame === 4)!.shapes[j];
          const expected = sheared(world(original, { x: 7, y: 3 }), pivot, axis, 18),
            actual = world(shape, { x: 7, y: 3 });
          expect(actual.x).toBeCloseTo(expected.x, 9);
          expect(actual.y).toBeCloseTo(expected.y, 9);
          expect(metadata(shape)).toEqual(metadata(original));
        }
      expect({ ...out, shapes: definition.shapes, timeline: definition.timeline }).toEqual(
        definition,
      );
      out.shapes[0].x = 999;
      expect({ definition, library }).toEqual(before);
      expect(
        skewSymbolRememberedEndpoint(definition, library, 4, selection, axis, 18, undefined),
      ).toEqual(skewSymbolRememberedEndpoint(definition, library, 4, selection, axis, 18));
    });
for (const axis of ['z', null, new String('x')])
  it('rejects raw invalid shear axes ' + String(axis), () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => skewRememberedEndpoint(p, 4, picks, axis as 'x', 18, pivot)).toThrow();
    expect(p).toEqual(before);
  });
for (const degrees of [
  NaN,
  Infinity,
  -Infinity,
  0,
  -0,
  180,
  360,
  90,
  270,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  new Number(18),
  '18',
])
  it('rejects raw/no-op/unresolved shear angles ' + String(degrees), () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => skewRememberedEndpoint(p, 4, picks, 'x', degrees as number, pivot)).toThrow();
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
  it('rejects raw invalid shear pivots ' + JSON.stringify(center), () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => skewRememberedEndpoint(p, 4, picks, 'x', 18, center as Point)).toThrow();
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
  it('rejects a later shearing track atomically: ' + reason, () => {
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
      for (const span of l.motionSpans!) span.rotation!.axisGroupShear = false;
    const before = structuredClone(p),
      keys = p.layers.map((l) => l.keys),
      spans = p.layers.map((l) => l.motionSpans);
    expect(() => skewRememberedEndpoint(p, 4, input, 'x', 18, center)).toThrow();
    expect(p).toEqual(before);
    p.layers.forEach((l, i) => {
      expect(l.keys).toBe(keys[i]);
      expect(l.motionSpans).toBe(spans[i]);
    });
  });
it('snapshots original pivot/request coordinates and identities once for shared shearing', () => {
  const p = fixture(),
    reads = { x: 0, y: 0, layer: 0, ids: 0, id: 0 },
    ids = ['a', 'b'];
  Object.defineProperty(ids, 0, {
    get() {
      reads.id++;
      return 'a';
    },
  });
  skewRememberedEndpoint(
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
    'x',
    18,
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
  it('rejects shared shearing original source changes around ' + event, () => {
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
            if (event === 'reentry') skewRememberedEndpoint(p, 4, picks, 'y', 12);
            else rotateRememberedEndpoint(p, 4, picks, 30);
          } catch {}
          return pivot.x;
        },
        y: pivot.y,
      };
    expect(() => skewRememberedEndpoint(p, 4, input, 'x', 18, center)).toThrow();
    expect(seen).toBe(true);
    if (!event.includes('reentry')) before.layers[1].name = 'External edit';
    expect(p).toEqual(before);
    vi.restoreAllMocks();
    expect(() => skewRememberedEndpoint(p, 4, picks, 'x', 18, pivot)).not.toThrow();
  });
for (const event of ['pivot', 'request', 'clone', 'library', 'reentry', 'cross-reentry'])
  it('retains isolated shared shearing source admission around ' + event, () => {
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
              skewSymbolRememberedEndpoint(definition, library, 4, selection, 'y', 12);
            else rotateSymbolRememberedEndpoint(definition, library, 4, selection, 30);
          } catch {}
          return pivot.x;
        },
        y: pivot.y,
      };
    expect(() =>
      skewSymbolRememberedEndpoint(definition, library, 4, input, 'x', 18, center),
    ).toThrow();
    expect(seen).toBe(true);
    if (!['library', 'reentry', 'cross-reentry'].includes(event)) before.name = 'External edit';
    expect(definition).toEqual(before);
    vi.restoreAllMocks();
    expect(() =>
      skewSymbolRememberedEndpoint(definition, library, 4, selection, 'x', 18, pivot),
    ).not.toThrow();
  });
it('admits exact aggregate shearing capacity and rejects original overflow without artwork loss', () => {
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
  const out = skewSymbolRememberedEndpoint(definition, library, 4, selection, 'x', 18, pivot);
  expect(symbolArtworks(out).reduce((n, s) => n + s.length, 0) + other.shapes.length).toBe(
    MAX_SYMBOL_ARTWORK,
  );
  other.shapes.push(definition.shapes[0]);
  const before = structuredClone(definition);
  expect(() =>
    skewSymbolRememberedEndpoint(definition, library, 4, selection, 'x', 18, pivot),
  ).toThrow(/artwork budget/);
  expect(definition).toEqual(before);
});
it('rechecks a later shearing track frozen during cloning before any writes', () => {
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
  expect(() => skewRememberedEndpoint(p, 4, picks, 'x', 18, pivot)).toThrow(/atomic/);
  expect(seen).toBe(true);
  expect(p).toEqual(before);
  p.layers.forEach((l, i) => expect(l.keys).toBe(keys[i]));
});
for (const field of ['tracks', 'artwork'] as const)
  it('bounds raw shearing proxy request lengths before traversal: ' + field, () => {
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
    expect(() => skewRememberedEndpoint(p, 4, input, 'x', 18, pivot)).toThrow(/changed/);
    expect(reads).toBe(2);
    expect(p).toEqual(before);
  });

it('reads external symbol shearing pivot and identities once before detached preparation', () => {
  const { definition, library } = symbolFixture(),
    reads = { x: 0, y: 0, layer: 0, ids: 0, id: 0 },
    ids = ['a', 'b'];
  Object.defineProperty(ids, 0, {
    get() {
      reads.id++;
      return 'a';
    },
  });
  skewSymbolRememberedEndpoint(
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
    'x',
    18,
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
  it('rejects final complete sheared symbol clone source changes ' + event, () => {
    const { definition, library, selection } = symbolFixture(),
      before = structuredClone(definition),
      clone = structuredClone;
    let seen = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
      const out = clone(value),
        d = value as SymbolDefinition;
      if (
        d?.id === 'symbol' &&
        d.timeline?.keys.find((k) => k.frame === 4)?.shapes[0].transform?.[2] ===
          Math.tan((18 * Math.PI) / 180)
      ) {
        expect(
          d.timeline.layers!.find((l) => l.id === 'extra')!.keys.find((k) => k.frame === 4)!
            .shapes[0].transform![2],
        ).toBe(Math.tan((18 * Math.PI) / 180));
        seen = true;
        if (event === 'definition') definition.name = 'Late external edit';
        else library.push({ id: 'late', name: 'Late', width: 1, height: 1, shapes: [] });
      }
      return out;
    }) as typeof structuredClone);
    expect(() =>
      skewSymbolRememberedEndpoint(definition, library, 4, selection, 'x', 18, pivot),
    ).toThrow();
    expect(seen).toBe(true);
    if (event === 'definition') before.name = 'Late external edit';
    expect(definition).toEqual(before);
    if (event === 'library') expect(library.map((s) => s.id)).toEqual(['symbol', 'late']);
    vi.restoreAllMocks();
    expect(() =>
      skewSymbolRememberedEndpoint(definition, library, 4, selection, 'x', 18, pivot),
    ).not.toThrow();
  });

for (const axis of ['x', 'y'] as const)
  for (const cross of [false, true])
    it(`prepares mixed root/group shear unions atomically ${axis} cross=${cross}`, () => {
      const p = fixture(),
        before = structuredClone(p),
        otherKeys = p.layers[1].keys;
      const requests = cross
        ? [{ layerId: 'base', shapeIds: ['other'] }, picks[1]]
        : [{ layerId: 'base', shapeIds: ['other', 'b', 'a'] }];
      skewRememberedEndpoint(p, 4, requests, axis, 18, pivot);
      for (const request of requests)
        for (const id of request.shapeIds) {
          const shape = p.layers
            .find((l) => l.id === request.layerId)!
            .keys.find((k) => k.frame === 4)!
            .shapes.find((s) => s.id === id)!;
          const original = before.layers
            .find((l) => l.id === request.layerId)!
            .keys.find((k) => k.frame === 4)!
            .shapes.find((s) => s.id === id)!;
          const wanted = sheared(world(original, { x: 7, y: 3 }), pivot, axis, 18),
            actual = world(shape, { x: 7, y: 3 });
          expect(actual.x).toBeCloseTo(wanted.x, 9);
          expect(actual.y).toBeCloseTo(wanted.y, 9);
          expect(metadata(shape)).toEqual(metadata(original));
        }
      if (!cross) expect(p.layers[1].keys).toBe(otherKeys);
    });
for (const op of ['rotation', 'scaling'] as const)
  for (const symbol of [false, true])
    it(`rejects swallowed shear reentry inside shared ${op} symbol=${symbol}`, () => {
      const p = fixture(),
        { definition, library, selection } = symbolFixture(),
        before = structuredClone({ p, definition, library });
      let seen = false;
      const center = {
        get x() {
          seen = true;
          try {
            if (symbol) skewSymbolRememberedEndpoint(definition, library, 4, selection, 'x', 18);
            else skewRememberedEndpoint(p, 4, picks, 'x', 18);
          } catch {}
          return pivot.x;
        },
        y: pivot.y,
      };
      expect(() =>
        symbol
          ? op === 'rotation'
            ? rotateSymbolRememberedEndpoint(definition, library, 4, selection, 25, center)
            : scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.2, 1.1, center)
          : op === 'rotation'
            ? rotateRememberedEndpoint(p, 4, picks, 25, center)
            : scaleRememberedEndpoint(p, 4, picks, 1.2, 1.1, center),
      ).toThrow();
      expect(seen).toBe(true);
      expect({ p, definition, library }).toEqual(before);
      expect(() =>
        symbol
          ? skewSymbolRememberedEndpoint(definition, library, 4, selection, 'x', 18, pivot)
          : skewRememberedEndpoint(p, 4, picks, 'x', 18, pivot),
      ).not.toThrow();
    });
for (const field of ['layers', 'keys', 'spans', 'library-member'] as const)
  it('rejects equal-content replaced original shearing references ' + field, () => {
    const p = fixture('nested-loop'),
      before = structuredClone(p),
      keys = p.layers[0].keys;
    let seen = false;
    const center = {
      get x() {
        seen = true;
        if (field === 'layers') p.layers = [...p.layers];
        else if (field === 'keys') p.layers[1].keys = [...p.layers[1].keys];
        else if (field === 'spans') p.layers[1].motionSpans = [...p.layers[1].motionSpans!];
        else p.symbols![0] = structuredClone(p.symbols![0]);
        return pivot.x;
      },
      y: pivot.y,
    };
    expect(() => skewRememberedEndpoint(p, 4, picks, 'x', 18, center)).toThrow();
    expect(seen).toBe(true);
    expect(p).toEqual(before);
    expect(p.layers[0].keys).toBe(keys);
    expect(() => skewRememberedEndpoint(p, 4, picks, 'x', 18, pivot)).not.toThrow();
  });
for (const axis of ['x', 'y'] as const)
  it('admits finite off-view pivots without clamping on ' + axis, () => {
    const p = fixture('affine'),
      before = structuredClone(p),
      center = { x: 1e6, y: -2e6 },
      angle = 0.001;
    skewRememberedEndpoint(p, 4, picks, axis, angle, center);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const original = before.layers[i].keys.find((k) => k.frame === 4)!.shapes[j],
          shape = p.layers[i].keys.find((k) => k.frame === 4)!.shapes[j];
        const expected = sheared(world(original, { x: 7, y: 3 }), center, axis, angle),
          actual = world(shape, { x: 7, y: 3 });
        expect(actual.x).toBeCloseTo(expected.x, 8);
        expect(actual.y).toBeCloseTo(expected.y, 8);
        expect(metadata(shape)).toEqual(metadata(original));
      }
  });
it('rejects a rounded-away shear before decomposition can manufacture a new basis', () => {
  const p = fixture('affine'),
    before = structuredClone(p);
  expect(() => skewRememberedEndpoint(p, 4, picks, 'x', 1e-300, pivot)).toThrow(/represented/);
  expect(p).toEqual(before);
});

for (const origin of [0, 10000, -10000])
  it('preserves small local shearing geometry at translated origin ' + origin, () => {
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
    skewRememberedEndpoint(p, 4, picks, 'x', 18, center);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const original = before.layers[i].keys.find((k) => k.frame === 4)!.shapes[j],
          shape = p.layers[i].keys.find((k) => k.frame === 4)!.shapes[j];
        expect(metadata(shape)).toEqual(metadata(original));
        for (const point of original.contours!.flat()) {
          const actual = world(shape, point),
            expected = sheared(world(original, point), center, 'x', 18);
          expect(actual.x).toBeCloseTo(expected.x, 9);
          expect(actual.y).toBeCloseTo(expected.y, 9);
        }
      }
  });

for (const field of ['base-keys', 'base-spans', 'tracks', 'track', 'keys', 'spans'] as const)
  it('rejects replaced original symbol shear ownership ' + field, () => {
    const { definition, library, selection } = symbolFixture(),
      before = structuredClone(definition);
    let seen = false;
    const center = {
      get x() {
        seen = true;
        const t = definition.timeline!;
        if (field === 'base-keys') t.keys = [...t.keys];
        else if (field === 'base-spans') t.motionSpans = [...t.motionSpans!];
        else if (field === 'tracks') t.layers = [...t.layers!];
        else if (field === 'track') t.layers![0] = { ...t.layers![0] };
        else if (field === 'keys') t.layers![0].keys = [...t.layers![0].keys];
        else t.layers![0].motionSpans = [...t.layers![0].motionSpans!];
        return pivot.x;
      },
      y: pivot.y,
    };
    expect(() =>
      skewSymbolRememberedEndpoint(definition, library, 4, selection, 'x', 18, center),
    ).toThrow();
    expect(seen).toBe(true);
    expect(definition).toEqual(before);
    expect(() =>
      skewSymbolRememberedEndpoint(definition, library, 4, selection, 'x', 18, pivot),
    ).not.toThrow();
  });
for (const symbol of [false, true])
  it('rejects swallowed scaling inside explicit shearing symbol=' + symbol, () => {
    const p = fixture(),
      { definition, library, selection } = symbolFixture(),
      before = structuredClone({ p, definition, library });
    let seen = false;
    const center = {
      get x() {
        seen = true;
        try {
          if (symbol) scaleSymbolRememberedEndpoint(definition, library, 4, selection, 1.2, 1.1);
          else scaleRememberedEndpoint(p, 4, picks, 1.2, 1.1);
        } catch {}
        return pivot.x;
      },
      y: pivot.y,
    };
    expect(() =>
      symbol
        ? skewSymbolRememberedEndpoint(definition, library, 4, selection, 'x', 18, center)
        : skewRememberedEndpoint(p, 4, picks, 'x', 18, center),
    ).toThrow();
    expect(seen).toBe(true);
    expect({ p, definition, library }).toEqual(before);
  });

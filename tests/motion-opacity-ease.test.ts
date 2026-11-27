import { expect, it } from 'vitest';
import {
  newProject,
  validateProject,
  migrateProject,
  symbolLayers,
  MAX_SYMBOL_ARTWORK,
  type Vector,
  type SymbolDefinition,
} from '../packages/document/src';
import { saveProject, loadProject, type DirectoryStore } from '../packages/document/src/storage';
import { captureOpacityEase, type MotionEase } from '../packages/document/src/motion-ease';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
  reverseBasicMotionSpan,
  splitBasicMotionSpan,
  retimeBasicMotionSpan,
  moveBasicMotionSpan,
  editSymbolBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import {
  sampleMotionFrame,
  createMotionFrameSampler,
  generateSymbolMotionFrames,
} from '../packages/animation/src/motion-frames';
import { captureRememberedPivotAuthoringFrame } from '../packages/animation/src/pivot-motion-owner';
import { captureSymbolRememberedAuthoringFrame } from '../packages/animation/src/symbol-motion-owner';
function fixture(kind = 'rectangle', basis = 'plain') {
  const p = newProject();
  p.duration = 16;
  const l = p.layers[0];
  l.id = 'track';
  l.drawingMode = 'object';
  const a: Vector = {
    id: 'art',
    kind: kind as Vector['kind'],
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    rotation: basis === 'plain' ? 0 : 30,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    opacity: 0.2,
    ...(basis === 'plain'
      ? {}
      : {
          transform: (basis === 'reflected' ? [-2, 0.5, 1, 3] : [2, 0.5, 1, 3]) as [
            number,
            number,
            number,
            number,
          ],
        }),
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
  l.keys = [
    { frame: 0, shapes: [a] },
    { frame: 8, shapes: [{ ...structuredClone(a), x: 90, opacity: 0.8 }] },
    { frame: 10, shapes: [] },
  ];
  return p;
}
function create(
  p: ReturnType<typeof fixture>,
  opacityEase?: MotionEase,
  global: MotionEase = 'in',
) {
  createBasicMotionSpan(
    p,
    ['track'],
    0,
    8,
    global,
    { affine: true, pivots: true, defaultPivots: true },
    undefined,
    undefined,
    undefined,
    opacityEase,
  );
}
const cubic: MotionEase = { kind: 'cubic', x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 0 };
for (const ease of ['linear', 'in', 'out', 'in-out', cubic] as MotionEase[])
  it('independent opacity oracle ' + JSON.stringify(ease), () => {
    const p = fixture();
    create(p, ease);
    const l = p.layers[0],
      span = l.motionSpans![0];
    expect(span.opacityEase).toEqual(ease);
    for (let frame = 1; frame < 8; frame++) {
      const raw = frame / 8,
        alpha =
          typeof ease === 'object'
            ? raw ** 3
            : ease === 'linear'
              ? raw
              : ease === 'in'
                ? raw ** 2
                : ease === 'out'
                  ? 1 - (1 - raw) ** 2
                  : raw < 0.5
                    ? 2 * raw ** 2
                    : 1 - 2 * (1 - raw) ** 2;
      const a = l.keys.find((k) => k.frame === frame)!.shapes[0],
        sample = sampleMotionFrame(p, 'track', span, frame)[0];
      expect(a.x).toBe(10 + 80 * raw ** 2);
      expect(a.opacity).toBeCloseTo(0.2 + 0.6 * alpha, 14);
      expect(sample).toEqual(a);
    }
    expect(sampleMotionFrame(p, 'track', span, 0)).toEqual(l.keys[0].shapes);
    expect(sampleMotionFrame(p, 'track', span, 8)).toEqual(l.keys[8].shapes);
    expect(l.keys.at(-1)).toEqual({ frame: 10, shapes: [] });
  });
for (const kind of ['rectangle', 'bezier', 'polygon'])
  for (const basis of ['affine', 'reflected'])
    it('changes only object opacity for ' + kind + ' ' + basis, () => {
      const original = fixture(kind, basis),
        p = structuredClone(original),
        legacy = structuredClone(original);
      create(p, 'out');
      create(legacy);
      const strip = (value: (typeof p.layers)[0]['keys']) =>
        value.map((k) => ({
          ...k,
          shapes: k.shapes.map((s) => {
            const next = { ...s };
            delete next.opacity;
            return next;
          }),
        }));
      expect(strip(p.layers[0].keys)).toEqual(strip(legacy.layers[0].keys));
      expect(p.layers[0].keys[4].shapes[0].opacity).not.toBe(
        legacy.layers[0].keys[4].shapes[0].opacity,
      );
    });
for (const ease of ['linear', 'in', 'out', 'in-out', cubic] as MotionEase[])
  it('refresh reverse preserved split and reopen ' + JSON.stringify(ease), () => {
    let p = fixture();
    create(p, ease, 'linear');
    p = migrateProject(JSON.parse(JSON.stringify(p)));
    const l = p.layers[0],
      before = structuredClone(l.keys),
      id = l.motionSpans![0].id;
    refreshBasicMotionSpan(p, ['track'], 0, 8);
    expect(l.keys).toEqual(before);
    reverseBasicMotionSpan(p, ['track'], 0, 8);
    for (let f = 0; f <= 8; f++)
      expect(l.keys.find((k) => k.frame === f)!.shapes[0].opacity).toBeCloseTo(
        before.find((k) => k.frame === 8 - f)!.shapes[0].opacity!,
        13,
      );
    refreshBasicMotionSpan(p, ['track'], 0, 8);
    reverseBasicMotionSpan(p, ['track'], 0, 8);
    expect(l.motionSpans![0].id).toBe(id);
    // Exact preserved subdivision starts from original authored direction; reversal
    // retains the existing floating-point reconstruction/refresh contract.
    p = fixture();
    create(p, ease, 'linear');
    const splitLayer = p.layers[0];
    splitBasicMotionSpan(p, ['track'], 0, 8, 4, true);
    expect(splitLayer.keys).toEqual(before);
    for (const span of p.layers[0].motionSpans!) {
      expect(span.opacityEase).toBeDefined();
      refreshBasicMotionSpan(p, ['track'], span.start, span.end);
    }
    for (let f = 0; f <= 8; f++)
      expect(p.layers[0].keys[f].shapes[0].opacity).toBeCloseTo(before[f].shapes[0].opacity!, 13);
  });
it('keeps omitted/default easing metadata and endpoints exact', () => {
  const p = fixture(),
    legacy = fixture();
  create(p);
  create(legacy, undefined);
  expect(p.layers[0].keys).toEqual(legacy.layers[0].keys);
  expect(Object.hasOwn(p.layers[0].motionSpans![0], 'opacityEase')).toBe(false);
  expect(p.layers[0].keys[4].shapes[0].opacity).toBe(0.2 + (0.8 - 0.2) * 0.25);
});
it('snapshots original cubic getters once and detaches sampler and saved metadata', () => {
  let reads = 0;
  const request = {
    kind: 'cubic' as const,
    get x1() {
      reads++;
      return 1 / 3;
    },
    get x2() {
      reads++;
      return 2 / 3;
    },
    get y1() {
      reads++;
      return 0;
    },
    get y2() {
      reads++;
      return 0;
    },
  };
  const p = fixture();
  create(p, request);
  expect(reads).toBe(4);
  const span = p.layers[0].motionSpans![0],
    sampler = createMotionFrameSampler(p, 'track', span),
    saved = sampler.sample(4);
  (span.opacityEase as { y1: number }).y1 = 1;
  expect(sampler.sample(4)).toEqual(saved);
  sampler.dispose();
  expect(() => sampler.sample(4)).toThrow(/disposed/);
  expect(captureOpacityEase('out')).toBe('out');
});
it('rejects raw original invalid overrides before clone and preserves all tracks', () => {
  for (const bad of [
    null,
    false,
    'bad',
    { kind: 'cubic', x1: NaN, y1: 0, x2: 1, y2: 1 },
    { kind: 'cubic', x1: 0, y1: Infinity, x2: 1, y2: 1 },
    { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: 2 },
  ]) {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => create(p, bad as MotionEase)).toThrow();
    expect(p).toEqual(before);
  }
  const p = fixture(),
    other = structuredClone(p.layers[0]);
  other.id = 'other';
  other.keys[1].shapes[0].x = Infinity;
  p.layers.push(other);
  const before = structuredClone(p);
  expect(() =>
    createBasicMotionSpan(
      p,
      ['track', 'other'],
      0,
      8,
      'linear',
      undefined,
      undefined,
      undefined,
      undefined,
      'out',
    ),
  ).toThrow();
  expect(p).toEqual(before);
});
it('separates global refresh from the saved opacity channel', () => {
  const p = fixture();
  create(p, 'out');
  const id = p.layers[0].motionSpans![0].id;
  refreshBasicMotionSpan(p, ['track'], 0, 8, 'linear');
  expect(p.layers[0].keys[4].shapes[0]).toMatchObject({ x: 50, opacity: 0.2 + (0.8 - 0.2) * 0.75 });
  expect(p.layers[0].motionSpans![0]).toMatchObject({ id, opacityEase: 'out', ease: 'linear' });
});
it('reauthors both halves explicitly and rejects unsupported preserved restriction atomically', () => {
  const p = fixture();
  create(p, 'in-out', 'linear');
  const before = structuredClone(p);
  expect(() => splitBasicMotionSpan(p, ['track'], 0, 8, 2, true)).toThrow(/Preserved/);
  expect(p).toEqual(before);
  splitBasicMotionSpan(p, ['track'], 0, 8, 4);
  expect(p.layers[0].motionSpans!.map((s) => s.opacityEase)).toEqual(['in-out', 'in-out']);
  for (const span of p.layers[0].motionSpans!)
    refreshBasicMotionSpan(p, ['track'], span.start, span.end);
});
it('retimes and moves remembered channels without changing identity or outside exposure', () => {
  const p = fixture();
  p.duration = 24;
  create(p, 'out', 'linear');
  const id = p.layers[0].motionSpans![0].id;
  retimeBasicMotionSpan(p, ['track'], 0, 8, 7);
  expect(p.layers[0].motionSpans![0]).toMatchObject({ id, start: 0, end: 6, opacityEase: 'out' });
  moveBasicMotionSpan(p, ['track'], 0, 6, 12);
  const span = p.layers[0].motionSpans![0];
  expect(span).toMatchObject({ id, start: 12, end: 18, opacityEase: 'out' });
  refreshBasicMotionSpan(p, ['track'], 12, 18);
  expect(p.layers[0].keys.find((k) => k.frame === 15)!.shapes[0].opacity).toBeCloseTo(0.65, 14);
});
it('current schema validates root and symbol channels and rejects forged older documents', () => {
  const p = fixture();
  create(p, cubic);
  expect(validateProject(p)).toEqual(p);
  for (const schemaVersion of [1, 40, 50, 51])
    expect(() => migrateProject({ ...p, schemaVersion })).toThrow(/schema 52/);
  const old = fixture();
  expect(migrateProject({ ...old, schemaVersion: 51 }).schemaVersion).toBe(59);
  expect(Object.hasOwn(migrateProject({ ...old, schemaVersion: 51 }), 'opacityEase')).toBe(false);
  const symbol = {
    id: 's',
    name: 's',
    width: 100,
    height: 100,
    shapes: p.layers[0].keys[0].shapes,
    timeline: {
      duration: p.duration,
      keys: p.layers[0].keys.slice(1),
      motionSpans: p.layers[0].motionSpans,
    },
  };
  const nested = fixture();
  nested.symbols = [symbol];
  expect(validateProject(nested)).toEqual(nested);
  expect(() => migrateProject({ ...nested, schemaVersion: 51 })).toThrow(/schema 52/);
  (symbol.timeline.motionSpans![0].opacityEase as { x1: number }).x1 = NaN;
  expect(() => validateProject(nested)).toThrow();
});
it('saves and loads exact channels and enforces manifest/document version agreement', async () => {
  const values = new Map<string, string>(),
    store: DirectoryStore = {
      async read(path) {
        return values.get(path)!;
      },
      async writeNew(path, value) {
        values.set(path, value);
      },
      async commit(path, value) {
        values.set(path, value);
      },
      async exists(path) {
        return values.has(path);
      },
    };
  const p = fixture();
  create(p, cubic);
  await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
  const manifest = JSON.parse(values.get('project.json')!);
  expect(manifest.schemaVersion).toBe(59);
  manifest.schemaVersion = 51;
  values.set('project.json', JSON.stringify(manifest));
  await expect(loadProject(store)).rejects.toThrow(new RegExp("schema "+p.schemaVersion,"i"));
});
it('private root pivot preparation retains detached two-sided opacity channels and stale rejection', () => {
  const p = fixture('polygon', 'reflected');
  create(p, 'out');
  const state = { project: p, revision: 0, frame: 4 },
    before = structuredClone(p),
    capture = captureRememberedPivotAuthoringFrame(() => state),
    candidate = capture.preparePivotPosition('track', 'art', { x: 100, y: -20 });
  expect(p).toEqual(before);
  expect(candidate.layers[0].motionSpans!.every((s) => s.opacityEase !== undefined)).toBe(true);
  expect(candidate.layers[0].keys[4].shapes[0].opacity).toBe(p.layers[0].keys[4].shapes[0].opacity);
  p.layers[0].motionSpans![0].opacityEase = 'in';
  expect(() => capture.preparePivotPosition('track', 'art', { x: 80, y: -10 })).toThrow(/changed/);
  capture.dispose();
});
it('isolated base/additional promotion preserves settings and channels without draft writes', () => {
  const p = fixture();
  create(p, 'out');
  const l = p.layers[0],
    extra = structuredClone(l);
  extra.id = 'extra';
  extra.motionSpans![0].id = 'extra-span';
  const definition: SymbolDefinition = {
    id: 'symbol',
    name: 's',
    width: 120,
    height: 80,
    multiFramePivot: { x: 4, y: 5 },
    shapes: l.keys[0].shapes,
    buttonStates: { up: 0, over: 4, down: 8, hit: 10 },
    timeline: {
      duration: p.duration,
      keys: l.keys.slice(1),
      motionSpans: l.motionSpans,
      layers: [extra],
    },
  };
  const state = { definition, symbols: [definition], revision: 0, frame: 4 },
    before = structuredClone(state),
    capture = captureSymbolRememberedAuthoringFrame(() => state);
  for (const id of ['@base', 'extra']) {
    const result = capture.preparePromotion(id, 'art', { x: 3, y: -2 });
    expect(
      symbolLayers(result)
        .find((l) => l.id === id)!
        .motionSpans!.every((s) => s.opacityEase !== undefined),
    ).toBe(true);
    expect(result.buttonStates).toEqual(definition.buttonStates);
    expect(result.multiFramePivot).toEqual(definition.multiFramePivot);
  }
  expect(state).toEqual(before);
  capture.dispose();
});
it('library-aware creation forwards explicit opacity without enabling motion options', () => {
  const p = fixture(),
    l = p.layers[0],
    definition: SymbolDefinition = {
      id: 'symbol',
      name: 's',
      width: 120,
      height: 80,
      shapes: l.keys[0].shapes,
      timeline: { duration: p.duration, keys: l.keys.slice(1) },
    };
  const result = editSymbolBasicMotionSpan(
    definition,
    ['@base'],
    0,
    8,
    'create',
    'in',
    [definition],
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
    'out',
  );
  expect(result.timeline!.motionSpans![0].opacityEase).toBe('out');
  expect(result.timeline!.motionSpans![0].options).toBeUndefined();
  expect(result.timeline!.keys.find((k) => k.frame === 4)!.shapes[0].opacity).toBeCloseTo(0.65, 14);
  expect(definition.timeline!.keys).toHaveLength(2);
});
it('preserves exact legacy admission against the actual symbol artwork budget', () => {
  const p = fixture(),
    l = p.layers[0],
    definition: SymbolDefinition = {
      id: 'symbol',
      name: 's',
      width: 120,
      height: 80,
      shapes: l.keys[0].shapes,
      timeline: { duration: p.duration, keys: l.keys.slice(1) },
    },
    other: SymbolDefinition = {
      id: 'other',
      name: 'other',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
        ...l.keys[0].shapes[0],
        id: 'other-' + i,
      })),
    };
  expect(() =>
    generateSymbolMotionFrames(
      definition,
      ['@base'],
      0,
      8,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      [definition, other],
      undefined,
      false,
      false,
      false,
      false,
      0,
      false,
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      'out',
    ),
  ).toThrow(/budget/);
  expect(definition.timeline!.keys).toHaveLength(2);
});

it('retains nested movie playback clocks and original endpoint settings', () => {
  const p = fixture(),
    l = p.layers[0],
    art = structuredClone(l.keys[0].shapes[0]);
  p.symbols = [
    {
      id: 'movie',
      name: 'movie',
      width: 40,
      height: 30,
      shapes: [art],
      timeline: { duration: 3, keys: [{ frame: 1, shapes: [{ ...art, fill: '#0000ff' }] }] },
    },
  ];
  for (const k of l.keys)
    for (const a of k.shapes) {
      a.kind = 'symbol';
      a.symbolId = 'movie';
      a.symbolPlayback = { mode: 'loop', firstFrame: 1 };
    }
  const legacy = structuredClone(p);
  create(p, 'out');
  create(legacy);
  for (const k of l.keys) {
    const old = legacy.layers[0].keys.find((key) => key.frame === k.frame)!;
    expect(k.shapes.map((a) => a.symbolPlayback)).toEqual(old.shapes.map((a) => a.symbolPlayback));
  }
  expect(p.symbols).toEqual(legacy.symbols);
});
it('rejects actual opacity source edits from target getters before private preparation writes', () => {
  const p = fixture();
  create(p, 'out');
  const state = { project: p, revision: 0, frame: 4 },
    capture = captureRememberedPivotAuthoringFrame(() => state),
    before = structuredClone(p);
  expect(() =>
    capture.preparePivotPosition('track', 'art', {
      get x() {
        p.layers[0].motionSpans![0].opacityEase = 'in';
        return 100;
      },
      y: 0,
    }),
  ).toThrow(/changed/);
  before.layers[0].motionSpans![0].opacityEase = 'in';
  expect(p).toEqual(before);
  capture.dispose();
});
it('retains strict reversal reconstruction rejection without adopting rounding drift', () => {
  const p = fixture();
  create(p, 'out', 'linear');
  reverseBasicMotionSpan(p, ['track'], 0, 8);
  const before = structuredClone(p);
  expect(() => reverseBasicMotionSpan(p, ['track'], 0, 8)).toThrow(/unchanged generated/);
  expect(p).toEqual(before);
  refreshBasicMotionSpan(p, ['track'], 0, 8);
  reverseBasicMotionSpan(p, ['track'], 0, 8);
  expect(p.layers[0].motionSpans![0].opacityEase).toBe('out');
});

for (const missing of ['start', 'end', 'both', 'equal'])
  it('retains authored opacity absence and defaults ' + missing, () => {
    const p = fixture(),
      l = p.layers[0];
    if (missing === 'start' || missing === 'both') delete l.keys[0].shapes[0].opacity;
    if (missing === 'end' || missing === 'both') delete l.keys[1].shapes[0].opacity;
    if (missing === 'equal') {
      l.keys[0].shapes[0].opacity = 0.25;
      l.keys[1].shapes[0].opacity = 0.25;
    }
    const endpoints = structuredClone([l.keys[0], l.keys[1]]),
      a = endpoints[0].shapes[0].opacity,
      b = endpoints[1].shapes[0].opacity;
    create(p, 'out');
    expect(l.keys[0]).toEqual(endpoints[0]);
    expect(l.keys[8]).toEqual(endpoints[1]);
    if (missing === 'both') expect(Object.hasOwn(l.keys[4].shapes[0], 'opacity')).toBe(false);
    else
      expect(l.keys[4].shapes[0].opacity).toBeCloseTo((a ?? 1) + ((b ?? 1) - (a ?? 1)) * 0.75, 14);
    expect(sampleMotionFrame(p, 'track', l.motionSpans![0], 0)).toEqual(endpoints[0].shapes);
  });
it('rejects finite opacity-difference overflow before any selected track writes', () => {
  const p = fixture(),
    other = structuredClone(p.layers[0]);
  other.id = 'other';
  other.keys[0].shapes[0].opacity = Number.MAX_VALUE;
  other.keys[1].shapes[0].opacity = -Number.MAX_VALUE;
  p.layers.push(other);
  const before = structuredClone(p);
  expect(() =>
    createBasicMotionSpan(
      p,
      ['track', 'other'],
      0,
      8,
      'linear',
      undefined,
      undefined,
      undefined,
      undefined,
      'out',
    ),
  ).toThrow(/invalid numeric/);
  expect(p).toEqual(before);
});

import { expect, it } from 'vitest';
import {
  newProject,
  validateProject,
  migrateProject,
  symbolLayers,
  MAX_SYMBOL_ARTWORK,
  type Vector,
  type MotionSpanOptions,
  type SymbolDefinition,
} from '../packages/document/src';
import { capturePaintEase, type MotionEase } from '../packages/document/src/motion-ease';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
  reverseBasicMotionSpan,
  splitBasicMotionSpan,
  retimeBasicMotionSpan,
  moveBasicMotionSpan,
  editSymbolBasicMotionSpan,
  setRememberedMotionOpacityEase,
} from '../packages/animation/src/motion-spans';
import {
  createMotionFrameSampler,
  sampleMotionFrame,
  generateSymbolMotionFrames,
} from '../packages/animation/src/motion-frames';
import { captureRememberedPivotAuthoringFrame } from '../packages/animation/src/pivot-motion-owner';
import { captureSymbolRememberedAuthoringFrame } from '../packages/animation/src/symbol-motion-owner';
import { saveProject, loadProject, type DirectoryStore } from '../packages/document/src/storage';

const cubic: MotionEase = { kind: 'cubic', x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 0 };
it('sampler snapshots cannot switch off required paint admission during option getter reads', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0].fill = '#000000';
  p.layers[0].keys[1].shapes[0].stroke = '#000000';
  create(p, 'out');
  const span = p.layers[0].motionSpans![0];
  let reads = 0;
  const request = {
    ...span,
    options: {
      ...span.options,
      get paint() {
        return ++reads === 1;
      },
    },
  };
  expect(() => createMotionFrameSampler(p, 'track', request)).toThrow(
    /requires paint interpolation/,
  );
  expect(reads).toBe(2);
});
it('new paint-channel creation admits exact aggregate capacity and rejects one extra projected artwork', () => {
  const p = fixture(),
    s = asSymbol(p),
    before = structuredClone(s);
  const other: SymbolDefinition = {
    id: 'other',
    name: 'Other',
    width: 1,
    height: 1,
    shapes: Array.from({ length: MAX_SYMBOL_ARTWORK - 18 }, (_, i) => ({
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
  const library = [s, other],
    original = newProject();
  original.symbols = library;
  validateProject(original);
  const generate = () =>
    editSymbolBasicMotionSpan(
      s,
      ['@base', 'extra'],
      0,
      8,
      'create',
      'in',
      library,
      undefined,
      false,
      { paint: true, affine: true },
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
      cubic,
    );
  const output = generate();
  expect(
    symbolLayers(output).reduce((n, l) => n + l.keys.reduce((m, k) => m + k.shapes.length, 0), 0) +
      other.shapes.length,
  ).toBe(MAX_SYMBOL_ARTWORK);
  expect(symbolLayers(output).every((l) => l.motionSpans![0].paintEase !== undefined)).toBe(true);
  expect(s).toEqual(before);
  other.shapes.push({ ...other.shapes[0], id: 'one-extra' });
  validateProject(original);
  expect(() => generate()).toThrow(/budget/);
  expect(s).toEqual(before);
  expect(other.shapes).toHaveLength(MAX_SYMBOL_ARTWORK - 17);
}, 60000);
it('finite opacity-difference overflow still rejects all tracks with a valid paint channel', () => {
  const p = fixture(),
    second = structuredClone(p.layers[0]);
  second.id = 'overflow';
  second.keys[0].shapes[0].opacity = 1e308;
  second.keys[1].shapes[0].opacity = -1e308;
  p.layers.push(second);
  const before = structuredClone(p);
  expect(() => create(p, cubic)).toThrow();
  expect(p).toEqual(before);
});
it('direct library-aware frame generation forwards paint progress and preserves unselected tracks', () => {
  const p = fixture(),
    s = asSymbol(p),
    before = structuredClone(s);
  const args: Parameters<typeof generateSymbolMotionFrames> = [
    s,
    ['@base'],
    0,
    8,
    'in',
    true,
    true,
    false,
    undefined,
    false,
    false,
    [s],
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
    true,
    false,
    'out',
    cubic,
  ];
  const output = generateSymbolMotionFrames(...args);
  expect(output.timeline!.keys.find((k) => k.frame === 4)!.shapes[0]).toMatchObject({
    fill: '#101010',
    stroke: '#101010',
    x: 30,
    opacity: 0.75,
  });
  expect(output.timeline!.layers).toEqual(s.timeline!.layers);
  expect(s).toEqual(before);
});
it('private target getter source mutation rejects stale paint metadata without preparation writes', () => {
  const p = fixture();
  create(p, 'in', 'linear', 'linear');
  const state = { project: p, revision: 0, frame: 4 },
    before = structuredClone(p),
    owner = captureRememberedPivotAuthoringFrame(() => state);
  let reads = 0;
  const target = {
    get x() {
      reads++;
      p.layers[0].motionSpans![0].paintEase = 'out';
      return 80;
    },
    y: -10,
  };
  expect(() => owner.preparePivotPosition('track', 'art', target)).toThrow(/changed/);
  expect(reads).toBe(1);
  before.layers[0].motionSpans![0].paintEase = 'out';
  expect(p).toEqual(before);
  owner.dispose();
});
it('preserved paint rounding failure on a later track keeps the entire batch unchanged', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0].fill = '#f0f0f0';
  const second = structuredClone(p.layers[0]);
  second.id = 'later';
  second.keys[1].shapes[0].fill = '#030303';
  p.layers.push(second);
  create(p, 'linear', 'linear', 'linear');
  const before = structuredClone(p);
  expect(() => splitBasicMotionSpan(p, ['track', 'later'], 0, 8, 4, true)).toThrow(/rounded paint/);
  expect(p).toEqual(before);
});
function fixture(kind: Vector['kind'] = 'rectangle', reflected = false) {
  const p = newProject();
  p.duration = 24;
  const l = p.layers[0];
  l.id = 'track';
  l.drawingMode = 'object';
  const a: Vector = {
    id: 'art',
    kind,
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    rotation: 30,
    transform: [reflected ? -2 : 2, 0.5, 1, 3],
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 2,
    points: [],
    opacity: 0,
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
  l.keys = [
    { frame: 0, shapes: [a] },
    {
      frame: 8,
      shapes: [{ ...structuredClone(a), x: 90, fill: '#808080', stroke: '#808080', opacity: 1 }],
    },
    { frame: 10, shapes: [] },
  ];
  return p;
}
function create(
  p: ReturnType<typeof fixture>,
  paintEase?: MotionEase,
  opacityEase: MotionEase = 'out',
  ease: MotionEase = 'in',
  options: MotionSpanOptions = { affine: true, paint: true, pivots: true },
) {
  createBasicMotionSpan(
    p,
    p.layers.map((l) => l.id),
    0,
    8,
    ease,
    options,
    undefined,
    undefined,
    undefined,
    opacityEase,
    paintEase,
  );
}
const stripPaint = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (key, value) =>
      ['fill', 'stroke', 'paintEase', 'baseline'].includes(key) ? undefined : value,
    ),
  );
for (const kind of ['rectangle', 'bezier', 'polygon'] as const)
  for (const reflected of [false, true])
    it(`independent color=t^3/geometry=t^2/opacity=Out oracle for ${kind}/${reflected}`, () => {
      const p = fixture(kind, reflected),
        legacy = structuredClone(p),
        ends = structuredClone(p.layers[0].keys);
      create(p, cubic);
      create(legacy);
      legacy.layers[0].motionSpans![0].id = p.layers[0].motionSpans![0].id;
      expect(stripPaint(p)).toEqual(stripPaint(legacy));
      for (let frame = 1; frame < 8; frame++) {
        const t = frame / 8,
          s = p.layers[0].keys[frame].shapes[0],
          gray = Math.round(128 * t ** 3)
            .toString(16)
            .padStart(2, '0');
        expect(s.x).toBe(10 + 80 * t * t);
        expect(s.opacity).toBeCloseTo(1 - (1 - t) ** 2, 13);
        expect(s.fill).toBe('#' + gray.repeat(3));
        expect(s.stroke).toBe(s.fill);
        expect(sampleMotionFrame(p, 'track', p.layers[0].motionSpans![0], frame)).toEqual([s]);
      }
      expect([p.layers[0].keys[0], p.layers[0].keys[8], p.layers[0].keys.at(-1)]).toEqual(ends);
    });
for (const ease of ['linear', 'in', 'out', 'in-out', cubic] as MotionEase[])
  it('saved paint channel remains independent after global refresh ' + JSON.stringify(ease), () => {
    const p = fixture();
    create(p, ease);
    const colors = p.layers[0].keys.map((k) => k.shapes[0]?.fill),
      id = p.layers[0].motionSpans![0].id;
    refreshBasicMotionSpan(p, ['track'], 0, 8, 'linear');
    expect(p.layers[0].keys.map((k) => k.shapes[0]?.fill)).toEqual(colors);
    expect(p.layers[0].keys[4].shapes[0].x).toBe(50);
    expect(p.layers[0].motionSpans![0]).toMatchObject({
      id,
      paintEase: ease,
      opacityEase: 'out',
      ease: 'linear',
    });
    const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
    refreshBasicMotionSpan(loaded, ['track'], 0, 8);
    expect(loaded).toEqual(p);
  });
for (const weighted of [false, true])
  it(
    'gradient color/stop opacity use paint time; geometry/offsets retain global time, premultiplied=' +
      weighted,
    () => {
      const p = fixture();
      for (const key of p.layers[0].keys.slice(0, 2)) {
        const end = key.frame > 0;
        key.shapes[0].gradient = {
          kind: 'linear',
          from: { x: end ? 9 : 1, y: 0 },
          to: { x: end ? 36 : 20, y: 0 },
          stops: [
            { offset: end ? 0.2 : 0, color: end ? '#0000ff' : '#ff0000', opacity: end ? 1 : 0 },
            { offset: 1, color: end ? '#ffffff' : '#000000', opacity: end ? 0.8 : 0.2 },
          ],
        };
      }
      create(p, cubic, 'out', 'in', {
        paint: true,
        affine: true,
        gradientGeometry: true,
        gradientPremultiplied: weighted,
      });
      const s = p.layers[0].keys[4].shapes[0],
        g = s.gradient!;
      expect(g.from.x).toBe(3);
      expect(g.to.x).toBe(24);
      expect(g.stops[0].offset).toBe(0.05);
      expect(g.stops[0].opacity).toBeCloseTo(0.125, 13);
      expect(g.stops[0].color).toBe(weighted ? '#0000ff' : '#df0020');
      expect(s.opacity).toBe(0.75);
      expect(g.stops[1].opacity).toBeCloseTo(0.275, 13);
    },
  );
it('matched gradient stop resampling retains explicit paint progress', () => {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2))
    key.shapes[0].gradient = {
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 20, y: 0 },
      stops: key.frame
        ? [
            { offset: 0, color: '#808080' },
            { offset: 0.5, color: '#808080' },
            { offset: 1, color: '#808080' },
          ]
        : [
            { offset: 0, color: '#000000' },
            { offset: 1, color: '#000000' },
          ],
    };
  create(p, cubic, 'out', 'in', { paint: true, gradientStops: true });
  expect(p.layers[0].keys[4].shapes[0].gradient!.stops.every((s) => s.color === '#101010')).toBe(
    true,
  );
  expect(p.layers[0].keys[0].shapes[0].gradient!.stops).toHaveLength(2);
  expect(p.layers[0].keys[8].shapes[0].gradient!.stops).toHaveLength(3);
});
it('omitted channel is byte-identical to legacy generation and remains absent after refresh', () => {
  const p = fixture(),
    q = structuredClone(p);
  create(p);
  create(q, undefined);
  expect(p.layers[0].keys).toEqual(q.layers[0].keys);
  expect(Object.hasOwn(p.layers[0].motionSpans![0], 'paintEase')).toBe(false);
  refreshBasicMotionSpan(p, ['track'], 0, 8);
  expect(Object.hasOwn(p.layers[0].motionSpans![0], 'paintEase')).toBe(false);
  expect(p.layers[0].keys[4].shapes[0].fill).toBe('#202020');
});
it('captures custom controls once and detaches the sampler from later channel edits', () => {
  const p = fixture();
  let reads = 0;
  const request = {
    ...cubic,
    get y1() {
      reads++;
      return 0;
    },
  };
  create(p, request);
  expect(reads).toBe(1);
  const span = p.layers[0].motionSpans![0],
    sampler = createMotionFrameSampler(p, 'track', span),
    before = sampler.sample(4);
  (span.paintEase as { y1: number }).y1 = 1;
  expect(sampler.sample(4)).toEqual(before);
  sampler.dispose();
  expect(() => sampler.sample(4)).toThrow(/disposed/);
});
for (const bad of [
  null,
  false,
  'bad',
  { ...cubic, x1: NaN },
  { ...cubic, y1: Infinity },
  { ...cubic, y2: 2 },
])
  it('rejects raw invalid paint easing before writes ' + JSON.stringify(bad), () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => create(p, bad as MotionEase)).toThrow();
    expect(p).toEqual(before);
  });
for (const paint of [undefined, false])
  it('does not silently enable paint option ' + paint, () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => create(p, 'out', 'out', 'in', { paint })).toThrow(/requires paint/);
    expect(p).toEqual(before);
    expect(() => capturePaintEase('out', paint as boolean)).toThrow();
  });
it('rejects a later invalid endpoint without earlier-track writes', () => {
  const p = fixture(),
    second = structuredClone(p.layers[0]);
  second.id = 'other';
  second.keys[1].shapes[0].fill = 'invalid';
  p.layers.push(second);
  const before = structuredClone(p);
  expect(() => create(p, cubic)).toThrow();
  expect(p).toEqual(before);
});
for (const paintEase of ['in', cubic] as MotionEase[])
  it(
    'reversal mirrors channels independently while retaining exact generated colors ' +
      JSON.stringify(paintEase),
    () => {
      const p = fixture();
      create(p, paintEase);
      const before = structuredClone(p.layers[0].keys);
      reverseBasicMotionSpan(p, ['track'], 0, 8);
      expect(p.layers[0].motionSpans![0]).toMatchObject({
        paintEase:
          typeof paintEase === 'object'
            ? {
                kind: 'cubic',
                x1: 1 - paintEase.x2,
                y1: 1 - paintEase.y2,
                x2: 1 - paintEase.x1,
                y2: 1 - paintEase.y1,
              }
            : 'out',
        opacityEase: 'in',
        ease: 'out',
      });
      for (let i = 0; i <= 8; i++)
        expect(p.layers[0].keys[i].shapes[0].fill).toBe(before[8 - i].shapes[0].fill);
    },
  );
it('preserved splits retain representable independent color restrictions through refresh/reopen', () => {
  const p = fixture();
  create(p, 'in', 'linear', 'linear');
  const before = structuredClone(p.layers[0].keys);
  splitBasicMotionSpan(p, ['track'], 0, 8, 4, true);
  expect(p.layers[0].keys).toEqual(before);
  expect(p.layers[0].motionSpans!.every((s) => s.paintEase !== undefined)).toBe(true);
  const q = migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(q, ['track'], 0, 4);
  refreshBasicMotionSpan(q, ['track'], 4, 8);
  expect(q.layers[0].keys.map((k) => k.shapes[0]?.fill)).toEqual(
    before.map((k) => k.shapes[0]?.fill),
  );
});
for (const mode of ['weighted', 'resampled'] as const)
  it(
    'independent ' +
      mode +
      ' gradient color restrictions retain integer poses through split/reopen/refresh',
    () => {
      const p = fixture();
      for (const key of p.layers[0].keys.slice(0, 2)) {
        const end = key.frame > 0;
        key.shapes[0].gradient = {
          kind: 'linear',
          from: { x: 0, y: 0 },
          to: { x: 20, y: 0 },
          stops:
            mode === 'weighted'
              ? [
                  { offset: 0, color: end ? '#0000ff' : '#ff0000', opacity: end ? 1 : 0 },
                  { offset: 1, color: '#00ff00', opacity: 1 },
                ]
              : end
                ? [
                    { offset: 0, color: '#808080' },
                    { offset: 0.5, color: '#808080' },
                    { offset: 1, color: '#808080' },
                  ]
                : [
                    { offset: 0, color: '#000000' },
                    { offset: 1, color: '#000000' },
                  ],
        };
      }
      create(p, 'in', 'linear', 'linear', {
        paint: true,
        affine: true,
        gradientPremultiplied: mode === 'weighted',
        gradientStops: mode === 'resampled',
      });
      const before = structuredClone(p.layers[0].keys);
      splitBasicMotionSpan(p, ['track'], 0, 8, 4, true);
      expect(p.layers[0].keys).toEqual(before);
      const q = migrateProject(JSON.parse(JSON.stringify(p)));
      refreshBasicMotionSpan(q, ['track'], 0, 4);
      refreshBasicMotionSpan(q, ['track'], 4, 8);
      q.layers[0].keys.forEach((key, i) =>
        key.shapes[0]?.gradient!.stops.forEach((stop, j) => {
          const original = before[i].shapes[0].gradient!.stops[j];
          expect(stop.color).toBe(original.color);
          expect(stop.offset).toBe(original.offset);
          expect(stop.opacity ?? 1).toBeCloseTo(original.opacity ?? 1, 13);
        }),
      );
    },
  );
it('unsupported preserved channel restriction rejects all tracks; default split reauthors explicitly', () => {
  const p = fixture();
  create(p, 'in-out', 'linear', 'linear');
  const before = structuredClone(p);
  expect(() => splitBasicMotionSpan(p, ['track'], 0, 8, 2, true)).toThrow(/Preserved/);
  expect(p).toEqual(before);
  splitBasicMotionSpan(p, ['track'], 0, 8, 4);
  expect(p.layers[0].motionSpans!.map((s) => s.paintEase)).toEqual(['in-out', 'in-out']);
});
it('retime/move retain channel and identity with unchanged outside holds', () => {
  const p = fixture();
  create(p, 'out', 'linear', 'linear');
  const id = p.layers[0].motionSpans![0].id,
    outside = structuredClone(p.layers[0].keys.at(-1));
  retimeBasicMotionSpan(p, ['track'], 0, 8, 7);
  moveBasicMotionSpan(p, ['track'], 0, 6, 12);
  const span = p.layers[0].motionSpans![0];
  expect(span).toMatchObject({ id, start: 12, end: 18, paintEase: 'out' });
  expect(p.layers[0].keys.find((k) => k.frame === 10)).toEqual(outside);
  refreshBasicMotionSpan(p, ['track'], 12, 18);
  expect(p.layers[0].keys.find((k) => k.frame === 15)!.shapes[0].fill).toBe('#606060');
});
it('existing opacity-only editing retains the saved paint recipe and every generated color', () => {
  const p = fixture();
  create(p, cubic);
  const colors = p.layers[0].keys.map((k) => k.shapes[0]?.fill);
  setRememberedMotionOpacityEase(p, ['track'], 0, 8, 'linear');
  expect(p.layers[0].keys.map((k) => k.shapes[0]?.fill)).toEqual(colors);
  expect(p.layers[0].motionSpans![0].paintEase).toEqual(cubic);
});
it('schema53 upgrades older absence but rejects forged paint fields in original old root/base/additional recipes', () => {
  const p = fixture();
  create(p, cubic);
  validateProject(p);
  for (const schemaVersion of [1, 41, 51, 52])
    expect(() => migrateProject({ ...p, schemaVersion })).toThrow(/schema 53/);
  const q = fixture();
  create(q);
  expect(migrateProject({ ...q, schemaVersion: 52 }).schemaVersion).toBe(59);
  expect(
    Object.hasOwn(
      migrateProject({ ...q, schemaVersion: 52 }).layers[0].motionSpans![0],
      'paintEase',
    ),
  ).toBe(false);
  const s = asSymbol(p),
    nested = fixture();
  nested.symbols = [s];
  for (const id of ['@base', 'extra']) {
    const bad = structuredClone(nested);
    if (id === '@base') delete bad.symbols![0].timeline!.layers;
    else delete bad.symbols![0].timeline!.motionSpans;
    expect(() => migrateProject({ ...bad, schemaVersion: 52 })).toThrow(/schema 53/);
  }
  const bad = structuredClone(p);
  bad.layers[0].motionSpans![0].options!.paint = false;
  expect(() => validateProject(bad)).toThrow(/paint interpolation/);
});
function asSymbol(p: ReturnType<typeof fixture>): SymbolDefinition {
  const l = p.layers[0],
    extra = structuredClone(l);
  extra.id = 'extra';
  extra.motionSpans?.forEach((s) => (s.id += '-extra'));
  return {
    id: 'symbol',
    name: 's',
    width: 120,
    height: 80,
    shapes: l.keys[0].shapes,
    multiFramePivot: { x: 4, y: 5 },
    timeline: {
      duration: p.duration,
      keys: l.keys.slice(1),
      motionSpans: l.motionSpans,
      layers: [extra],
    },
  };
}
it('private root and isolated preparation preserve channels/settings without source writes and reject stale sources', () => {
  const p = fixture();
  create(p, 'in', 'linear', 'linear');
  const source = { project: p, revision: 0, frame: 4 },
    snapshot = structuredClone(p),
    owner = captureRememberedPivotAuthoringFrame(() => source);
  const candidate = owner.preparePivotPosition('track', 'art', { x: 80, y: -10 });
  expect(candidate.layers[0].motionSpans!.every((s) => s.paintEase !== undefined)).toBe(true);
  expect(p).toEqual(snapshot);
  p.layers[0].motionSpans![0].paintEase = 'out';
  expect(() => owner.preparePivotPosition('track', 'art', { x: 90, y: -10 })).toThrow(/changed/);
  owner.dispose();
  const s = asSymbol(snapshot),
    state = { definition: s, symbols: [s], revision: 0, frame: 4 },
    before = structuredClone(state),
    isolated = captureSymbolRememberedAuthoringFrame(() => state);
  for (const id of ['@base', 'extra']) {
    const result = isolated.preparePromotion(id, 'art', { x: 3, y: -2 });
    expect(
      symbolLayers(result)
        .find((l) => l.id === id)!
        .motionSpans!.every((s) => s.paintEase !== undefined),
    ).toBe(true);
    expect(result.multiFramePivot).toEqual(s.multiFramePivot);
  }
  expect(state).toEqual(before);
  state.definition.timeline!.motionSpans![0].paintEase = 'out';
  expect(() => isolated.preparePromotion('@base', 'art', { x: 3, y: -2 })).toThrow(/changed/);
  isolated.dispose();
});
it('library-aware creation forwards both channels without changing settings or the original definition', () => {
  const p = fixture(),
    s = asSymbol(p),
    before = structuredClone(s);
  const result = editSymbolBasicMotionSpan(
    s,
    ['@base', 'extra'],
    0,
    8,
    'create',
    'in',
    [s],
    undefined,
    false,
    { paint: true, affine: true },
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
    cubic,
  );
  expect(s).toEqual(before);
  for (const l of symbolLayers(result)) {
    expect(l.motionSpans![0]).toMatchObject({ paintEase: cubic, opacityEase: 'out' });
    expect(l.keys[4].shapes[0].fill).toBe('#101010');
  }
});
it('directory roundtrips both channels and rejects downgraded manifests and nonfinite saves atomically', async () => {
  const files = new Map<string, string>();
  const store: DirectoryStore = {
    read: async (p) => files.get(p)!,
    exists: async (p) => files.has(p),
    writeNew: async (p, c) => {
      if (files.has(p)) throw Error('exists');
      files.set(p, c);
    },
    commit: async (p, c, expected) => {
      if ((files.get(p) ?? null) !== expected) throw Error('conflict');
      files.set(p, c);
    },
  };
  const p = fixture();
  create(p, cubic);
  p.symbols = [asSymbol(p)];
  const manifest = await saveProject(store, p, null);
  expect(JSON.parse(manifest).schemaVersion).toBe(59);
  expect((await loadProject(store)).project).toEqual(p);
  const old = JSON.parse(manifest);
  old.schemaVersion = 52;
  files.set('project.json', JSON.stringify(old));
  await expect(loadProject(store)).rejects.toThrow(`Schema ${p.schemaVersion} documents require a schema ${p.schemaVersion} manifest.`);
  files.set('project.json', manifest);
  const bad = structuredClone(p);
  (bad.layers[0].motionSpans![0].paintEase as { y1: number }).y1 = NaN;
  await expect(saveProject(store, bad, manifest)).rejects.toThrow();
  expect(files.get('project.json')).toBe(manifest);
});

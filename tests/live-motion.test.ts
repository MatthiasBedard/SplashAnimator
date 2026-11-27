import { expect, it, vi } from 'vitest';
import {
  newProject,
  newLayer,
  validateProject,
  migrateProject,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type Vector,
  type LiveMotionSpan,
} from '../packages/document/src';
import {
  prepareCreateLiveMotionSpans as create,
  prepareRemoveLiveMotionSpans as remove,
  captureLiveMotionTimeline as capture,
} from '../packages/animation/src/live-motion';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import { sampleMotionFrame } from '../packages/animation/src/motion-frames';
import { matrix } from '../packages/geometry/src/affine';

function fixture(): Project {
  const p = newProject();
  p.duration = 10;
  p.layers[0].id = 'track';
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 20,
    width: 40,
    height: 30,
    rotation: 0,
    opacity: 0.2,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art] },
    { frame: 4, shapes: [{ ...structuredClone(art), x: 80, rotation: 80, opacity: 1 }] },
    { frame: 8, shapes: [] },
  ];
  return p;
}
const recipe = (id = 'live'): LiveMotionSpan => ({ id, start: 0, end: 4, ease: 'linear' });
const request = (span = recipe(), layerId = 'track') => ({ layerId, span });
function sample(p: Project, at = 2) {
  const view = capture(() => ({ project: p, revision: 0 }));
  try {
    return view.sample(at);
  } finally {
    view.dispose();
  }
}

it('stores only an explicit recipe and exact authored keys, with independent outputs and no source writes', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[0].gradient = undefined;
  p.layers[0].keys[1].shapes[0].gradient = undefined;
  const before = structuredClone(p),
    input = request(),
    result = create(p, [input]);
  expect(p).toEqual(before);
  expect(result.layers[0].keys).toEqual(before.layers[0].keys);
  expect(Object.hasOwn(result.layers[0].keys[0].shapes[0], 'gradient')).toBe(true);
  expect(result.layers[0].motionSpans).toBeUndefined();
  expect(result.layers[0].liveMotionSpans).toEqual([input.span]);
  result.layers[0].keys[0].shapes[0].x = 15;
  result.layers[0].liveMotionSpans![0].ease = 'out';
  expect(p).toEqual(before);
  expect(input.span.ease).toBe('linear');
});
it('samples exact endpoints/holds/outside keys and independent intermediate geometry without generated keys', () => {
  const p = create(fixture(), [request()]),
    before = structuredClone(p),
    view = capture(() => ({ project: p, revision: 3 }));
  expect(view.sample(0)[0]).toEqual({ layerId: 'track', sampled: false, key: p.layers[0].keys[0] });
  const mid = view.sample(2)[0];
  expect(mid.sampled).toBe(true);
  expect(mid.spanId).toBe('live');
  expect(mid.key.shapes[0]).toMatchObject({ x: 40, rotation: 40 });
  expect(mid.key.shapes[0].opacity).toBeCloseTo(0.6);
  expect(view.sample(4)[0].key).toEqual(p.layers[0].keys[1]);
  expect(view.sample(6)[0].key).toEqual(p.layers[0].keys[1]);
  expect(view.sample(8)[0].key).toEqual(p.layers[0].keys[2]);
  mid.key.shapes[0].x = 999;
  expect(view.sample(2)[0].key.shapes[0].x).toBe(40);
  expect(p).toEqual(before);
  view.dispose();
  expect(() => view.sample(2)).toThrow(/disposed/);
});
it('keeps exactly two stored keys for a 100000-frame project and samples near both boundaries', () => {
  const p = fixture();
  p.duration = 100000;
  p.layers[0].keys = p.layers[0].keys.slice(0, 2);
  p.layers[0].keys[1].frame = 99999;
  const result = create(p, [request({ ...recipe(), end: 99999 })]);
  expect(result.layers[0].keys.map((k) => k.frame)).toEqual([0, 99999]);
  for (const f of [1, 12345, 50000, 99998])
    expect(sample(result, f)[0].key.shapes[0].x).toBeCloseTo((80 * f) / 99999, 9);
  expect(result.layers[0].keys.length).toBe(2);
});
it('fresh capture reads edited endpoint values immediately while prior captures reject unstamped edits', () => {
  const p = create(fixture(), [request()]),
    view = capture(() => ({ project: p, revision: 0 }));
  p.layers[0].keys[1].shapes[0].x = 120;
  expect(() => view.sample(2)).toThrow(/source changed/);
  expect(sample(p)[0].key.shapes[0].x).toBe(60);
  expect(p.layers[0].keys.length).toBe(3);
});
it('legacy stale generated keys still require Refresh and cannot be automatically converted', () => {
  const p = fixture();
  createBasicMotionSpan(p, ['track'], 0, 4, 'linear');
  const before = structuredClone(p);
  expect(() => create(p, [request()])).toThrow(/overlaps/);
  expect(p).toEqual(before);
  p.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x = 120;
  expect(p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].x).toBe(40);
  refreshBasicMotionSpan(p, ['track'], 0, 4);
  expect(p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].x).toBe(60);
  expect(p.layers[0].liveMotionSpans).toBeUndefined();
});
it('keeps explicit geometry/opacity/paint easing independent and exactly matches the shared interpolation kernel', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0].fill = '#808080';
  const span: LiveMotionSpan = {
      ...recipe(),
      ease: 'in',
      options: { paint: true },
      opacityEase: 'out',
      paintEase: 'linear',
    },
    result = create(p, [request(span)]);
  const art = sample(result)[0].key.shapes[0];
  expect(art.x).toBe(20);
  expect(art.opacity).toBeCloseTo(0.8);
  expect(art.fill).toBe('#404040');
  expect(sample(result)[0].key.shapes).toEqual(sampleMotionFrame(p, 'track', span, 2));
  expect(result.layers[0].liveMotionSpans![0]).toEqual(span);
});
for (const kind of ['bezier', 'polygon', 'ellipse'] as const)
  for (const reflected of [false, true])
    it(`samples ${reflected ? 'reflected' : 'affine'} ${kind} endpoints without topology or paint drift`, () => {
      const p = fixture();
      for (const key of p.layers[0].keys.slice(0, 2)) {
        const art = key.shapes[0];
        art.kind = kind;
        art.transform = [reflected ? -2 : 2, 0.25, 0.5, 3];
        art.pivot = { x: 7, y: -3 };
        if (kind === 'bezier') {
          art.nodes = [
            { x: 0, y: 0, out: { x: 10, y: 5 } },
            { x: 40, y: 30, in: { x: 30, y: 25 } },
          ];
          art.closed = false;
        }
        if (kind === 'polygon') {
          art.fillRule = 'evenodd';
          art.contours = [
            [
              { x: 0, y: 0 },
              { x: 40, y: 0 },
              { x: 40, y: 30 },
              { x: 0, y: 30 },
            ],
            [
              { x: 5, y: 5 },
              { x: 10, y: 5 },
              { x: 7, y: 10 },
            ],
          ];
        }
      }
      const span = {
          ...recipe(),
          options: { affine: true, nodes: kind !== 'ellipse', pivots: true },
        },
        result = create(p, [request(span)]);
      const actual = sample(result)[0].key.shapes;
      expect(actual).toEqual(sampleMotionFrame(p, 'track', span, 2));
      expect(result.layers[0].keys).toEqual(p.layers[0].keys);
      const expectedMatrix = matrix({ ...p.layers[0].keys[0].shapes[0], x: 40, rotation: 40 });
      matrix(actual[0]).forEach((v, i) => expect(v).toBeCloseTo(expectedMatrix[i], 10));
      expect(actual[0].pivot).toEqual({ x: 7, y: -3 });
    });
it('allows disjoint records sharing one exact authored boundary', () => {
  const p = fixture();
  p.layers[0].keys[2].shapes = [{ ...structuredClone(p.layers[0].keys[1].shapes[0]), x: 160 }];
  const result = create(p, [request(), request({ ...recipe('next'), start: 4, end: 8 })]);
  expect(sample(result, 6)[0].key.shapes[0].x).toBe(120);
  expect(sample(result, 4)[0].sampled).toBe(false);
  expect(result.layers[0].keys).toEqual(p.layers[0].keys);
});
for (const edit of [
  (p: Project) => {
    p.layers[0].keys.splice(1, 0, { frame: 2, shapes: [] });
  },
  (p: Project) => {
    p.layers[0].keys[1].shapes = [];
  },
  (p: Project) => {
    p.layers[0].keys[0].shapes[0].groups = ['group'];
  },
  (p: Project) => {
    p.layers[0].locked = true;
  },
  (p: Project) => {
    p.layers[0].visible = false;
  },
  (p: Project) => {
    p.layers[0].keys[1].shapes[0].fill = '#ff0000';
  },
])
  it('rejects unsupported/ambiguous original artwork or authoring scope atomically', () => {
    const p = fixture();
    edit(p);
    const before = structuredClone(p);
    expect(() => create(p, [request()])).toThrow();
    expect(p).toEqual(before);
  });
for (const patch of [
  { start: NaN },
  { end: Infinity },
  { start: -1 },
  { end: 1 },
  { end: 10 },
  { id: '' },
  { start: '0' },
  { baseline: '' },
  { autoRefresh: true },
  { extra: true },
  { paintEase: 'linear' },
  { options: { nodes: 'true' } },
  { rotation: { direction: 'shortest', turns: 0, rigidGroups: true } },
])
  it(`rejects malformed original recipe ${JSON.stringify(patch)}`, () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => create(p, [request({ ...recipe(), ...patch } as LiveMotionSpan)])).toThrow();
    expect(p).toEqual(before);
  });
it('rejects input accessors without invoking them', () => {
  let reads = 0;
  const span = {
    ...recipe(),
    get end() {
      reads++;
      return 4;
    },
  };
  expect(() => create(fixture(), [request(span)])).toThrow(/data fields/);
  expect(reads).toBe(0);
});
it('captures the callback once and rejects source mutation during its getter read', () => {
  const p = fixture();
  let reads = 0;
  expect(() =>
    create(p, [request()], {
      get validate() {
        reads++;
        p.background = '#00ff00';
        return () => {};
      },
    }),
  ).toThrow(/source/);
  expect(reads).toBe(1);
  expect(p.layers[0].liveMotionSpans).toBeUndefined();
});
for (const mode of ['source', 'input', 'reentry', 'async'])
  it(`rejects ${mode} admission without candidate publication`, () => {
    const p = fixture(),
      input = [request()];
    expect(() =>
      create(p, input, {
        validate: () => {
          if (mode === 'source') p.layers[0].keys[0].shapes[0].x++;
          if (mode === 'input') input[0].span.end = 8;
          if (mode === 'reentry') {
            try {
              create(p, [request(recipe('nested'))]);
            } catch {
              /* swallowed by host */
            }
          }
          if (mode === 'async') return Promise.resolve();
        },
      }),
    ).toThrow();
    expect(p.layers[0].liveMotionSpans).toBeUndefined();
  });
it('late original source changes after a complete detached live candidate reject publication', () => {
  const p = fixture(),
    clone = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const output = clone(v);
    if (
      !hit &&
      v &&
      typeof v === 'object' &&
      'layers' in v &&
      (v as Project).layers[0].liveMotionSpans
    ) {
      hit = true;
      p.layers[0].keys[0].shapes[0].x = 123;
    }
    return output;
  });
  try {
    expect(() => create(p, [request()])).toThrow(/source/);
    expect(hit).toBe(true);
    expect(p.layers[0].liveMotionSpans).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});
it('a later incompatible track rejects every requested record without writes', () => {
  const p = fixture(),
    second = { ...structuredClone(p.layers[0]), id: 'second' };
  second.keys[1].shapes[0].width = 100;
  p.layers.push(second);
  const before = structuredClone(p);
  expect(() => create(p, [request(), request(recipe('second'), 'second')])).toThrow();
  expect(p).toEqual(before);
});
it('read-only sampling admits locks and hidden records but returns only visible layers', () => {
  const p = fixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'second' });
  const result = create(p, [request(), request(recipe('second'), 'second')]);
  result.layers[0].locked = true;
  result.layers[1].visible = false;
  expect(sample(result).map((track) => track.layerId)).toEqual(['track']);
  expect(sample(result)[0].key.shapes[0].x).toBe(40);
});
it('removal preserves keys/settings, omits the last empty field and can recover incompatible endpoint geometry', () => {
  const p = create(fixture(), [request()]);
  p.layers[0].keys[1].shapes[0].width = 50;
  expect(() => capture(() => ({ project: p, revision: 0 }))).toThrow();
  const before = structuredClone(p),
    result = remove(p, [{ layerId: 'track', spanId: 'live' }]);
  expect(result.layers[0].keys).toEqual(before.layers[0].keys);
  expect(Object.hasOwn(result.layers[0], 'liveMotionSpans')).toBe(false);
  expect(p).toEqual(before);
});
it('a missing later removal leaves every source record exact', () => {
  const p = create(fixture(), [request()]),
    before = structuredClone(p);
  expect(() =>
    remove(p, [
      { layerId: 'track', spanId: 'live' },
      { layerId: 'track', spanId: 'missing' },
    ]),
  ).toThrow();
  expect(p).toEqual(before);
});
for (const mode of ['revision', 'replace', 'dispose', 'reentry'])
  it(`a ${mode} during sampling invalidates the capture even if the host swallows errors`, () => {
    let p = create(fixture(), [request()]),
      revision = 0,
      hook = false;
    const view = capture(() => {
      if (hook) {
        hook = false;
        if (mode === 'revision') revision++;
        if (mode === 'replace') p = structuredClone(p);
        if (mode === 'dispose') view.dispose();
        if (mode === 'reentry') {
          try {
            view.sample(2);
          } catch {
            /* intentionally swallowed */
          }
        }
      }
      return { project: p, revision };
    });
    hook = true;
    expect(() => view.sample(2)).toThrow();
    expect(() => view.sample(2)).toThrow();
  });
it('rejects source descriptor getters before they run', () => {
  let reads = 0;
  expect(() =>
    capture(() => ({
      get project() {
        reads++;
        return fixture();
      },
      revision: 0,
    })),
  ).toThrow(/data fields/);
  expect(reads).toBe(0);
});
for (const frame of [NaN, Infinity, -1, 0.5, 10])
  it(`rejects original sample frame ${frame}`, () => {
    const p = create(fixture(), [request()]),
      view = capture(() => ({ project: p, revision: 0 }));
    expect(() => view.sample(frame)).toThrow();
  });
it('original geometry beyond document bounds rejects without rewriting endpoint keys', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[0].x = -1e308;
  p.layers[0].keys[1].shapes[0].x = 1e308;
  const before = structuredClone(p);
  expect(() => {
    const result = create(p, [request()]);
    sample(result);
  }).toThrow();
  expect(p).toEqual(before);
});
it('admits the actual original symbol aggregate budget without projecting duration-sized artwork', () => {
  const p = fixture(),
    art = p.layers[0].keys[0].shapes[0];
  p.symbols = [
    {
      id: 'unused',
      name: 'Unused',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({ ...art, id: 's' + i })),
    },
  ];
  expect(create(p, [request()]).symbols![0].shapes.length).toBe(MAX_SYMBOL_ARTWORK);
  p.symbols[0].shapes.push({ ...art, id: 'over' });
  expect(() => create(p, [request()])).toThrow(/budget/);
}, 30000);
it('schema53 upgrades without materializing live metadata; forged older live records never silently migrate', () => {
  const p = fixture(),
    legacy = { ...p, schemaVersion: 53 };
  expect(migrateProject(legacy)).toEqual(p);
  expect(Object.hasOwn(migrateProject(legacy).layers[0], 'liveMotionSpans')).toBe(false);
  const live = create(p, [request()]);
  expect(() => migrateProject({ ...live, schemaVersion: 53 })).toThrow(/schema 54/);
  expect(validateProject(live)).toEqual(live);
});
for (const place of ['root', 'definition', 'timeline', 'child'])
  it(`rejects misplaced live records on ${place}`, () => {
    const p = fixture(),
      span = recipe();
    p.symbols = [
      {
        id: 'symbol',
        name: 'Symbol',
        width: 40,
        height: 30,
        shapes: structuredClone(p.layers[0].keys[0].shapes),
        timeline: { duration: 10, keys: [] },
      },
    ];
    const definition = p.symbols[0];
    if (place === 'root') Object.assign(p, { liveMotionSpans: [span] });
    if (place === 'definition') Object.assign(definition, { liveMotionSpans: [span] });
    if (place === 'timeline') Object.assign(definition.timeline!, { liveMotionSpans: [span] });
    if (place === 'child')
      definition.timeline!.layers = [{ ...newLayer('Child'), liveMotionSpans: [span] }];
    expect(() => validateProject(p)).toThrow(/root/);
  });

for (const mode of ['sourceClone', 'requestClone', 'endpointClone'])
  it(`rejects forged ${mode} preparation while originals remain exact`, () => {
    const p = fixture(),
      before = structuredClone(p),
      clone = structuredClone;
    let hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const output = clone(value);
      if (!hit && mode === 'sourceClone' && value === p) {
        hit = true;
        (output as Project).background = '#ff0000';
      }
      if (!hit && mode === 'requestClone' && Array.isArray(value) && value[0]?.span) {
        hit = true;
        (output as { span: LiveMotionSpan }[])[0].span.ease = 'out';
      }
      if (!hit && mode === 'endpointClone' && Array.isArray(value) && value[0]?.frame === 0) {
        hit = true;
        (output as Project['layers'][number]['keys'])[0].shapes[0].x = 123;
      }
      return output;
    });
    try {
      expect(() => create(p, [request()])).toThrow(/clone|endpoint/);
      expect(hit).toBe(true);
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
for (const mode of ['capture', 'validation', 'artwork'])
  it(`rejects forged ${mode} sampling clones without writing source keys`, () => {
    const p = create(fixture(), [request()]),
      before = structuredClone(p),
      clone = structuredClone;
    const view = mode === 'capture' ? undefined : capture(() => ({ project: p, revision: 0 }));
    let hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const output = clone(value);
      if (!hit && mode !== 'artwork' && value && typeof value === 'object' && 'layers' in value) {
        hit = true;
        (output as Project).layers[0].keys[0].shapes[0].x = 123;
      }
      if (
        !hit &&
        mode === 'artwork' &&
        value &&
        typeof value === 'object' &&
        'frame' in value &&
        'shapes' in value &&
        (value as { frame: number }).frame === 2
      ) {
        hit = true;
        (output as { shapes: Vector[] }).shapes[0].x = 123;
      }
      return output;
    });
    try {
      expect(() =>
        mode === 'capture' ? capture(() => ({ project: p, revision: 0 })) : view!.sample(2),
      ).toThrow(/clone|artwork/);
      expect(hit).toBe(true);
      expect(p).toEqual(before);
    } finally {
      view?.dispose();
      vi.unstubAllGlobals();
    }
  });
it('rejects real symbol endpoints instead of guessing their exposure clocks', () => {
  const p = fixture();
  p.symbols = [
    {
      id: 's',
      name: 'S',
      width: 40,
      height: 30,
      shapes: structuredClone(p.layers[0].keys[0].shapes),
    },
  ];
  for (const key of p.layers[0].keys.slice(0, 2))
    Object.assign(key.shapes[0], { kind: 'symbol', symbolId: 's' });
  validateProject(p);
  expect(() => create(p, [request()])).toThrow(/continuity/);
});
it('rejects conflicting opacity binding and duplicate/overlapping live records', () => {
  const p = fixture();
  p.opacityBindings = [
    { layerId: 'track', shapeId: 'art', start: 0, end: 4, keys: [{ frame: 0, opacity: 1 }] },
  ];
  expect(() => create(p, [request()])).toThrow(/opacity binding/);
  delete p.opacityBindings;
  expect(() => create(p, [request(), request()])).toThrow(/overlaps/);
});

for (const mode of ['getter', 'nonfinite'])
  it(`rejects ${mode} original artwork before transport`, () => {
    const p = fixture();
    let reads = 0;
    if (mode === 'getter')
      Object.defineProperty(p.layers[0].keys[0].shapes[0], 'x', {
        enumerable: true,
        configurable: true,
        get: () => {
          reads++;
          return 0;
        },
      });
    else p.layers[0].keys[0].shapes[0].x = NaN;
    expect(() => create(p, [request()])).toThrow(/data fields|nonfinite/);
    expect(reads).toBe(0);
    expect(p.layers[0].liveMotionSpans).toBeUndefined();
  });
it('a later overflowing presentation track returns no partial scene or source edits', () => {
  const p = fixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  const result = create(p, [
    request(),
    request(
      { ...recipe('later'), path: { startX: 0, startY: 30000000, endX: 0, endY: 30000000 } },
      'later',
    ),
  ]);
  const before = structuredClone(result);
  let output: unknown;
  const view = capture(() => ({ project: result, revision: 0 }));
  expect(() => {
    try {
      output = view.sample(2);
    } finally {
      view.dispose();
    }
  }).toThrow();
  expect(output).toBeUndefined();
  expect(result).toEqual(before);
});

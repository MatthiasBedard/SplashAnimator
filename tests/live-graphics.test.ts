import { symbolInstance } from '../packages/geometry/src/symbols';
import { expect, it, vi } from 'vitest';
import {
  validateProject,
  migrateProject,
  MAX_SYMBOL_ARTWORK,
  type Project,
} from '../packages/document/src';
import { liveGraphicFixture, createLiveGraphics as create } from './live-graphics-fixture';
import {
  captureLiveMotionTimeline,
  prepareCreateLiveMotionSpans,
  prepareRemoveLiveMotionSpans,
} from '../packages/animation/src/live-motion';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
import { evaluate } from '../packages/animation/src';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { captureLiveMotionAuthoringFrame } from '../packages/animation/src/live-motion-owner';
import { captureLiveCubicControls } from '../packages/animation/src/live-cubic-controls';
import { liveCreationIssue } from '../apps/editor/src/live-creation';

for (const mode of ['default', 'loop', 'once', 'single'])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`samples graphic ${mode}/${basis} exactly once through endpoints/wrap/hold`, async () => {
      const { p, span } = liveGraphicFixture(mode, basis),
        before = structuredClone(p),
        out = create(p, span),
        source = structuredClone(out),
        owner = captureLiveMotionTimeline(() => ({ project: out, revision: 0 }));
      expect(out.layers[0].liveMotionSpans).toEqual([span]);
      expect(out.layers[0].keys).toEqual(p.layers[0].keys);
      expect(out.symbols).toEqual(p.symbols);
      expect(p).toEqual(before);
      for (let frame = 0; frame < 14; frame++) {
        const row = owner.sample(frame)[0];
        if (frame < 2 || frame >= 12) {
          expect(row.key.shapes).toEqual([]);
          continue;
        }
        const age = frame - 2,
          first = mode === 'default' ? 0 : 1,
          clock =
            mode === 'single' ? 1 : mode === 'once' ? Math.min(first + age, 4) : (first + age) % 5;
        if (frame > 2 && frame < 10)
          expect(row.key.shapes[0].symbolPlayback).toEqual({
            mode: mode === 'default' ? 'loop' : mode,
            firstFrame: clock,
          });
        const render = await prepareLiveMotionFrameCapture(
            () => ({ project: out, revision: 0 }),
            frame,
          ),
          shapes = evaluate(render, frame);
        expect(shapes).toHaveLength(1);
        const actual = mapPoint(matrix(shapes[0]), { x: 1, y: 1 }),
          t = Math.min(age / 8, 1),
          angle = (t * Math.PI) / 2;
        const b = basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
          u = b[0] * (clock * 10 + 1) + b[2],
          v = b[1] * (clock * 10 + 1) + b[3];
        expect(actual.x).toBeCloseTo(20 + 80 * t + Math.cos(angle) * u - Math.sin(angle) * v, 9);
        expect(actual.y).toBeCloseTo(30 + 40 * t + Math.sin(angle) * u + Math.cos(angle) * v, 9);
      }
      expect(out).toEqual(source);
      owner.dispose();
      expect(migrateProject(JSON.parse(JSON.stringify(out)))).toEqual(out);
    });
it('recovers a saved-pivot graphic orbit and rejects an incompatible second member atomically', () => {
  const {p, span, definition} = liveGraphicFixture();
  span.rotation = {direction:'shortest', turns:0, rigidGroups:true, savedGroupPivots:true};
  for (const key of p.layers[0].keys) {
    const graphic = key.shapes[0];
    if (!graphic) continue;
    graphic.groups = ['outer'];
    graphic.pivot = {x:8,y:0};
    const end = key.frame === span.end;
    key.shapes.push({...definition.shapes[0], id:'member', groups:['outer'],
      x:graphic.x+(end ? 0 : 12), y:graphic.y+(end ? 12 : 0), rotation:graphic.rotation});
  }
  const saved = create(p,span);
  expect(migrateProject(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  p.layers[0].keys[2].shapes[1].y++;
  const before = structuredClone(p);
  expect(()=>create(p,span)).toThrow(/member offsets/);
  expect(p).toEqual(before);
});

for (const fault of ['none', 'drift', 'basis', 'orbit', 'clock', 'membership']) {
  it(`validates a reflected translating graphic group during creation and reopen: ${fault}`, () => {
    const { p, span, definition } = liveGraphicFixture('loop', 'reflected');
    span.rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
    for (const key of p.layers[0].keys) {
      const graphic = key.shapes[0];
      if (!graphic) continue;
      graphic.groups = ['outer'];
      graphic.rotation = 0;
      key.shapes.push({ ...definition.shapes[0], id: 'member', groups: ['outer'], x: graphic.x + 8, y: graphic.y });
    }
    const [graphic, member] = p.layers[0].keys[2].shapes;
    if (fault === 'drift') member.x++;
    if (fault === 'basis') graphic.transform![0] = 2;
    if (fault === 'orbit') span.rotation.turns = 1;
    if (fault === 'clock') graphic.symbolPlayback!.firstFrame = 0;
    if (fault === 'membership') member.groups = ['other'];
    const before = structuredClone(p);
    if (fault === 'none') {
      const saved = create(p, span);
      const plan = createMotionFrameSampler(migrateProject(JSON.parse(JSON.stringify(saved))), 'track', span);
      try {
        const [instance, neighbor] = plan.sample(6);
        expect(instance.symbolPlayback).toEqual({ mode: 'loop', firstFrame: 0 });
        expect(instance.transform).toEqual(graphic.transform);
        expect(neighbor.x - instance.x).toBe(8);
        expect(neighbor.y).toBe(instance.y);
      } finally { plan.dispose(); }
    } else {
      expect(() => create(p, span)).toThrow();
      if (fault !== 'clock') {
        const forged = structuredClone(p);
        forged.layers[0].liveMotionSpans = [span];
        expect(() => validateProject(forged)).toThrow();
      }
    }
    expect(p).toEqual(before);
  });
}

for (const value of [undefined, false, 'movie', 'all'])
  it(`keeps omitted/unsupported ${value} graphic admission rejected`, () => {
    const { p, span } = liveGraphicFixture();
    Object.assign(span, { symbolContinuity: value });
    const before = structuredClone(p);
    expect(() => create(p, span)).toThrow();
    expect(p).toEqual(before);
  });
for (const field of ['id', 'symbolId', 'kind', 'clock', 'mode', 'group', 'flag'])
  it(`rejects original endpoint ${field} mismatch`, () => {
    const { p, span } = liveGraphicFixture(),
      end = p.layers[0].keys[2].shapes[0];
    if (field === 'id') end.id = 'other';
    if (field === 'symbolId') end.symbolId = 'missing';
    if (field === 'kind') end.kind = 'rectangle';
    if (field === 'clock') end.symbolPlayback!.firstFrame = 2;
    if (field === 'mode') end.symbolPlayback!.mode = 'once';
    if (field === 'group') end.groups = ['outer'];
    if (field === 'flag') span.rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
    const before = structuredClone(p);
    expect(() => create(p, span)).toThrow();
    expect(p).toEqual(before);
  });
it('uses an authored playback cut only at the end key and round-trips it through project data', () => {
  const { p, span } = liveGraphicFixture('loop');
  const end = p.layers[0].keys[2].shapes[0];
  end.symbolPlayback = { mode: 'single', firstFrame: 3, keyframeCut: true };
  const source = create(p, span);
  const sampler = createMotionFrameSampler(migrateProject(JSON.parse(JSON.stringify(source))), p.layers[0].id, span);
  try {
    expect(sampler.sample(9)[0].symbolPlayback).toEqual({ mode: 'loop', firstFrame: 3 });
    expect(sampler.sample(10)[0]).toEqual(end);
  } finally {
    sampler.dispose();
  }
  Object.assign(end.symbolPlayback, { keyframeCut: false });
  expect(() => create(p, span)).toThrow();
});
for (const field of ['movie', 'button', 'descendantMovie', 'cycle', 'missing'])
  it(`rejects ${field} graphic graph boundaries`, () => {
    const { p, span, definition } = liveGraphicFixture();
    if (field === 'movie') {
      for (const key of [p.layers[0].keys[1], p.layers[0].keys[2]])
        key.shapes[0].symbolPlayback!.mode = 'movie';
    }
    if (field === 'button') definition.buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
    if (field === 'descendantMovie' || field === 'cycle' || field === 'missing') {
      const child = {
        ...structuredClone(p.layers[0].keys[1].shapes[0]),
        id: 'nested',
        symbolId: field === 'cycle' ? 'graphic' : field === 'missing' ? 'absent' : 'leaf',
        symbolPlayback: { mode: field === 'descendantMovie' ? 'movie' : 'loop', firstFrame: 0 },
      };
      definition.shapes = [child as (typeof definition.shapes)[number]];
      if (field === 'descendantMovie')
        p.symbols!.push({
          id: 'leaf',
          name: 'Leaf',
          width: 1,
          height: 1,
          shapes: [{ ...p.symbols![0].timeline!.keys[0].shapes[0] }],
        });
    }
    const before = structuredClone(p);
    expect(() => create(p, span)).toThrow();
    expect(p).toEqual(before);
  });
for (const field of [
  'libraryGetter',
  'playbackGetter',
  'markerGetter',
  'nan',
  'prototype',
  'hidden',
])
  it(`rejects raw ${field} before normalized transport`, () => {
    const { p, span } = liveGraphicFixture();
    p.layers[0].liveMotionSpans = [span];
    let reads = 0;
    if (field === 'libraryGetter')
      Object.defineProperty(p.symbols![0].timeline!, 'duration', {
        enumerable: true,
        get() {
          reads++;
          return 5;
        },
      });
    if (field === 'playbackGetter')
      Object.defineProperty(p.layers[0].keys[1].shapes[0].symbolPlayback!, 'mode', {
        enumerable: true,
        get() {
          reads++;
          return 'loop';
        },
      });
    if (field === 'markerGetter')
      Object.defineProperty(span, 'symbolContinuity', {
        enumerable: true,
        get() {
          reads++;
          return 'graphics';
        },
      });
    if (field === 'nan') p.layers[0].keys[1].shapes[0].symbolPlayback!.firstFrame = NaN;
    if (field === 'prototype')
      Object.setPrototypeOf(p.symbols![0].timeline!, {
        get extra() {
          reads++;
          return 3;
        },
      });
    if (field === 'hidden')
      Object.defineProperty(p.symbols![0], 'name', { value: 'Graphic', enumerable: false });
    expect(() => validateProject(p)).toThrow();
    expect(reads).toBe(0);
  });
it('keeps root split/cubic/create hints outside opted-in graphic authoring', () => {
  const { p, span } = liveGraphicFixture(),
    out = create(p, span);
  out.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 10, endX: 0, endY: 10 };
  const split = captureLiveMotionAuthoringFrame(() => ({ project: out, revision: 0, frame: 6 }));
  const curve = captureLiveCubicControls(() => ({ project: out, revision: 0, frame: 6 }));
  expect(split.choices).toEqual([]);
  expect(curve.choices).toEqual([]);
  expect(liveCreationIssue(p, 'track', 2, 10)).toContain('Symbol');
  curve.dispose();
  split.dispose();
});
it('rejects a later graphic request atomically while keeping original keys/options/library', () => {
  const { p, span } = liveGraphicFixture();
  const later = { ...structuredClone(p.layers[0]), id: 'later' };
  later.keys[2].shapes[0].symbolPlayback!.firstFrame = 2;
  p.layers.push(later);
  const before = structuredClone(p);
  expect(() =>
    prepareCreateLiveMotionSpans(p, [
      { layerId: 'track', span },
      { layerId: 'later', span: { ...span, id: 'laterLive' } },
    ]),
  ).toThrow(/clock/);
  expect(p).toEqual(before);
});
it('rechecks library duration on fresh captures and leaves failed recipes recoverable', () => {
  const { p, span } = liveGraphicFixture(),
    out = create(p, span),
    capture = captureLiveMotionTimeline(() => ({ project: out, revision: 0 }));
  out.symbols![0].timeline!.duration = 6;
  expect(() => capture.sample(6)).toThrow();
  expect(() => captureLiveMotionTimeline(() => ({ project: out, revision: 1 }))).toThrow(/clock/);
  capture.dispose();
  const removed = prepareRemoveLiveMotionSpans(out, [{ layerId: 'track', spanId: 'live' }]);
  expect(removed.layers[0].liveMotionSpans).toBeUndefined();
  expect(removed.layers[0].keys).toEqual(out.layers[0].keys);
});
it('direct marked samplers reject original nonfinite library data before cloning', () => {
  const { p, span } = liveGraphicFixture();
  p.symbols![0].timeline!.duration = NaN;
  expect(() => createMotionFrameSampler(p, 'track', span)).toThrow(/finite/);
});

for (const holes of [false, true])
  it(`nested pure graphics retain key exposure ages and blank reentry ${holes}`, async () => {
    const { p, span, definition } = liveGraphicFixture();
    const child = {
      ...symbolInstance(definition, 0, 0),
      id: 'nested',
      symbolPlayback: { mode: 'once' as const, firstFrame: 2 },
    };
    const wrapper = {
      id: 'wrapper',
      name: 'Wrapper',
      width: 60,
      height: 10,
      shapes: [child],
      timeline: {
        duration: 3,
        keys: holes
          ? [
              { frame: 1, shapes: [] },
              { frame: 2, shapes: [structuredClone(child)] },
            ]
          : [],
      },
    };
    p.symbols!.push(wrapper);
    for (const key of [p.layers[0].keys[1], p.layers[0].keys[2]])
      key.shapes[0].symbolId = 'wrapper';
    p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 0;
    const out = create(p, span),
      before = structuredClone(out);
    for (let frame = 3; frame < 10; frame++) {
      const phase = (1 + frame - 2) % 3,
        view = await prepareLiveMotionFrameCapture(() => ({ project: out, revision: 0 }), frame),
        shapes = evaluate(view, frame);
      if (holes && phase === 1) {
        expect(shapes).toEqual([]);
        continue;
      }
      expect(shapes).toHaveLength(1);
      const clock = holes ? 2 : Math.min(2 + phase, 4),
        t = (frame - 2) / 8,
        angle = (t * Math.PI) / 2,
        x = clock * 10 + 1,
        y = 1,
        world = mapPoint(matrix(shapes[0]), { x: 1, y: 1 });
      expect(world.x).toBeCloseTo(20 + 80 * t + Math.cos(angle) * x - Math.sin(angle) * y, 9);
      expect(world.y).toBeCloseTo(30 + 40 * t + Math.sin(angle) * x + Math.cos(angle) * y, 9);
    }
    expect(out).toEqual(before);
  });
for (const own of [false, true])
  it(`preserves default endpoint playback metadata (own undefined ${own})`, () => {
    const { p, span } = liveGraphicFixture('default');
    span.end = 7;
    p.layers[0].keys[2].frame = 7;
    for (const key of [p.layers[0].keys[1], p.layers[0].keys[2]]) {
      delete key.shapes[0].symbolPlayback;
      if (own) key.shapes[0].symbolPlayback = undefined;
    }
    const before = structuredClone(p),
      out = create(p, span),
      sampler = createMotionFrameSampler(out, 'track', span);
    for (const frame of [2, 7])
      expect(Object.hasOwn(sampler.sample(frame)[0], 'symbolPlayback')).toBe(own);
    expect(out.layers[0].keys).toEqual(before.layers[0].keys);
    sampler.dispose();
  });
for (const mode of ['loop', 'once', 'single'] as const)
  it(`uses authoring clamp semantics for large ${mode} first offsets`, async () => {
    const { p, span } = liveGraphicFixture(mode);
    p.layers[0].keys[1].shapes[0].symbolPlayback!.firstFrame = 9998;
    p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = mode === 'loop' ? 2 : 9998;
    const out = create(p, span),
      owner = captureLiveMotionTimeline(() => ({ project: out, revision: 0 }));
    expect(owner.sample(3)[0].key.shapes[0].symbolPlayback!.firstFrame).toBe(
      mode === 'loop' ? 0 : 4,
    );
    expect(out.layers[0].keys[1].shapes[0].symbolPlayback!.firstFrame).toBe(9998);
    owner.dispose();
  });
for (const depth of [8, 9])
  it(`retains existing graphic graph depth boundary ${depth}`, () => {
    const { p, span, definition } = liveGraphicFixture();
    let previous = definition;
    for (let i = 1; i < depth; i++) {
      const next = {
        id: 'g' + i,
        name: 'G' + i,
        width: 60,
        height: 10,
        shapes: [{ ...symbolInstance(previous, 0, 0), id: 'child' }],
      };
      p.symbols!.push(next);
      previous = next;
    }
    for (const key of [p.layers[0].keys[1], p.layers[0].keys[2]])
      key.shapes[0].symbolId = previous.id;
    if (depth === 8) expect(create(p, span).symbols).toEqual(p.symbols);
    else expect(() => create(p, span)).toThrow(/depth|nested symbol expansion budget/);
  });
it('preflights original graphic creation libraries before prototype getters or JSON normalization', () => {
  const { p, span } = liveGraphicFixture();
  let reads = 0;
  const timeline = p.symbols![0].timeline!;
  delete (timeline as Partial<typeof timeline>).duration;
  Object.setPrototypeOf(timeline, {
    get duration() {
      reads++;
      return 5;
    },
  });
  expect(() => create(p, span)).toThrow();
  expect(reads).toBe(0);
});
for (const kind of ['library', 'endpoint', 'output'])
  it(`rejects ${kind} mutations during graphic sampler or complete output cloning`, () => {
    const { p, span } = liveGraphicFixture(),
      before = structuredClone(p),
      clone = structuredClone;
    let hit = false;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v),
        q = v as Project;
      if (
        !hit &&
        kind === 'output' &&
        q?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity === 'graphics'
      ) {
        hit = true;
        (out as Project).layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 0;
      }
      if (
        !hit &&
        kind === 'endpoint' &&
        Array.isArray(out) &&
        out.length === 2 &&
        out[0]?.frame === 2 &&
        out[0]?.shapes?.[0]?.kind === 'symbol'
      ) {
        hit = true;
        out[0].shapes[0].symbolPlayback.firstFrame = 3;
      }
      if (
        !hit &&
        kind === 'library' &&
        (out as { start?: number; options?: unknown })?.start === 2 &&
        Object.hasOwn(out as object, 'options')
      ) {
        hit = true;
        p.symbols![0].timeline!.duration = 6;
      }
      return out;
    });
    try {
      expect(() => create(p, span)).toThrow();
      expect(hit).toBe(true);
      if (kind === 'library') before.symbols![0].timeline!.duration = 6;
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
it('fingerprints complete graphic candidates before validation serialization can mutate them', () => {
  const { p, span } = liveGraphicFixture(),
    before = structuredClone(p),
    stringify = JSON.stringify;
  let hit = false,
    validations = 0;
  vi.spyOn(JSON, 'stringify').mockImplementation(((...args: Parameters<typeof stringify>) => {
    const text = stringify(...args),
      q = args[0] as Project,
      stack = new Error().stack ?? '';
    if (
      !hit &&
      q?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity === 'graphics' &&
      stack.includes('prepareCreateLiveMotionSpans') &&
      ++validations === 2
    ) {
      hit = true;
      q.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 0;
    }
    return text;
  }) as typeof stringify);
  try {
    expect(() => create(p, span)).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.restoreAllMocks();
  }
  expect(create(p, span).layers[0].keys).toEqual(before.layers[0].keys);
});
it('admits mixed graphic/plain artwork while preserving original ordered identities and settings', () => {
  const { p, span } = liveGraphicFixture();
  for (const key of [p.layers[0].keys[1], p.layers[0].keys[2]])
    key.shapes.push({
      id: 'plain',
      kind: 'rectangle',
      x: 140,
      y: 90,
      width: 5,
      height: 5,
      rotation: 0,
      fill: '#0000ff',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    });
  const before = structuredClone(p),
    out = create(p, span),
    owner = captureLiveMotionTimeline(() => ({ project: out, revision: 0 }));
  expect(owner.sample(6)[0].key.shapes.map((s) => s.id)).toEqual(['instance', 'plain']);
  expect(out.layers[0].keys).toEqual(before.layers[0].keys);
  owner.dispose();
});
it('admits exact aggregate graphic artwork budget with shared definition inspection and rejects overflow', () => {
  const { p, span, definition } = liveGraphicFixture();
  const art = definition.shapes[0];
  definition.shapes = Array.from({ length: MAX_SYMBOL_ARTWORK - 4 }, (_, i) => ({
    ...art,
    id: 'art' + i,
    points: [],
  }));
  for (const key of [p.layers[0].keys[1], p.layers[0].keys[2]])
    key.shapes.push({ ...structuredClone(key.shapes[0]), id: 'repeated', x: key.shapes[0].x + 10 });
  const out = create(p, span);
  expect(out.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK - 4);
  definition.shapes.push({ ...art, id: 'overflow' });
  expect(() => create(p, span)).toThrow(/budget/);
}, 120000);

it('requires explicit pivoted graphic group ownership for independent movie descendants', () => {
  const {p,span} = liveGraphicFixture();
  const before = structuredClone(p);
  for (const flag of [true,false,1,null]) {
    const invalid = {...span,nestedGraphicMovies:flag} as typeof span;
    expect(()=>create(p,invalid)).toThrow();
    expect(()=>createMotionFrameSampler(p,p.layers[0].id,invalid)).toThrow();
    expect(p).toEqual(before);
  }
  let reads=0;
  const accessor=Object.defineProperty({...span,nestedGraphicMovies:true as const},'rotation',{
    enumerable:true,get(){reads++;throw Error('untrusted getter');},
  });
  expect(()=>createMotionFrameSampler(p,p.layers[0].id,accessor)).toThrow();
  expect(reads).toBe(0);
  const inherited = Object.assign(Object.create({nestedGraphicMovies:true}),span);
  expect(()=>createMotionFrameSampler(p,p.layers[0].id,inherited)).toThrow();
});

it('admits only explicit grouped movie placements with stable authored offsets', () => {
  const {p,span} = liveGraphicFixture();
  span.rotation={direction:'shortest',turns:0,rigidGroups:true,savedGroupPivots:true};
  span.nestedGraphicMovies='members-and-descendants';
  for (const key of p.layers[0].keys) {
    if (!key.shapes.length) continue;
    const graphic=key.shapes[0];
    Object.assign(graphic,{groups:['group'],pivot:{x:0,y:0},rotation:0});
    key.shapes.push({...structuredClone(graphic),id:'movie',x:graphic.x+10,symbolPlayback:{mode:'movie',firstFrame:2}});
  }
  const before=structuredClone(p);
  const result=create(p,span);
  const plan=createMotionFrameSampler(result,p.layers[0].id,span);
  try {expect(plan.sample(6)[1].symbolPlayback).toEqual({mode:'movie',firstFrame:2});}
  finally {plan.dispose();}
  expect(p).toEqual(before);
  expect(()=>create(p,{...span,nestedGraphicMovies:true})).toThrow();
  const target=p.layers[0].keys[2].shapes[1];
  target.symbolPlayback={mode:'movie',firstFrame:1};
  const changed=structuredClone(p);
  expect(()=>create(p,span)).toThrow(/offset/);
  expect(p).toEqual(changed);
  target.symbolPlayback={mode:'loop',firstFrame:2};
  expect(()=>create(p,span)).toThrow(/offset/);
  target.symbolPlayback={mode:'movie',firstFrame:2};
  target.symbolPlayback.keyframeCut=true;
  expect(()=>create(p,span)).toThrow();
  delete target.symbolPlayback.keyframeCut;
  for (const key of p.layers[0].keys) {
    if (key.shapes.length) delete key.shapes[1].groups;
  }
  expect(()=>create(p,span)).toThrow();
});

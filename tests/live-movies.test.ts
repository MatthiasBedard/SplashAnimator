import { afterEach, expect, it, vi } from 'vitest';
import { liveMovieFixture, createLiveMovies as create } from './live-movies-fixture';
import {
  validateProject,
  migrateProject,
  MAX_SYMBOL_ARTWORK,
  type Project,
} from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { evaluate } from '../packages/animation/src';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import {
  captureLiveMotionTimeline,
  prepareCreateLiveMotionSpans,
  prepareRemoveLiveMotionSpans,
} from '../packages/animation/src/live-motion';
import { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
import { captureMoviePoseClock } from '../packages/animation/src/movie-pose-clock';
import { captureLiveMotionAuthoringFrame } from '../packages/animation/src/live-motion-owner';
import { captureLiveCubicControls } from '../packages/animation/src/live-cubic-controls';
import { captureLiveGraphicMotionAuthoringFrame } from '../packages/animation/src/live-graphic-motion-owner';
import { liveCreationIssue } from '../apps/editor/src/live-creation';
afterEach(() => vi.restoreAllMocks());

for (const first of [0, 1, 9998])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`samples movie first${first}/${basis} without projecting graphic age or resetting movie lifetimes`, async () => {
      const { p, span } = liveMovieFixture(first, basis),
        before = structuredClone(p),
        out = create(p, span),
        owner = captureLiveMotionTimeline(() => ({ project: out, revision: 0 })),
        clocks = captureMoviePoseClock(() => ({ project: out, revision: 0 }));
      expect(out.layers[0].keys).toEqual(p.layers[0].keys);
      expect(out.layers[0].liveMotionSpans).toEqual([span]);
      expect(out.symbols).toEqual(p.symbols);
      for (let frame = 0; frame < 14; frame++) {
        const row = owner.sample(frame)[0],
          view = await prepareLiveMotionFrameCapture(() => ({ project: out, revision: 0 }), frame),
          pose = clocks.capture(view),
          time = clocks.replay(pose, frame);
        if (frame < 2 || frame >= 12) {
          expect(row.key.shapes).toEqual([]);
          expect(time.frames).toEqual({});
          continue;
        }
        const age = frame - 2,
          phase = (Math.min(first, 4) + age) % 5,
          t = Math.min(age / 8, 1),
          angle = (t * Math.PI) / 2,
          a = basis === 'reflected' ? -2 : basis === 'affine' ? 2 : 1,
          b = basis === 'plain' ? 0 : 0.25,
          c = basis === 'plain' ? 0 : 0.5,
          d = basis === 'plain' ? 1 : 3,
          x = phase * 10 + 1,
          y = 1,
          ink = evaluate(pose.project, frame, time.frames)[0],
          point = mapPoint(matrix(ink), { x: 1, y: 1 });
        expect(row.key.shapes[0].symbolPlayback).toEqual({ mode: 'movie', firstFrame: first });
        expect(time.frames).toEqual({ 'track/instance/graphic': age });
        expect(time.origins).toEqual({ 'track/instance/graphic': 2 / out.fps });
        expect(point.x).toBeCloseTo(
          20 + 80 * t + Math.cos(angle) * (a * x + c * y) - Math.sin(angle) * (b * x + d * y),
          10,
        );
        expect(point.y).toBeCloseTo(
          30 + 40 * t + Math.sin(angle) * (a * x + c * y) + Math.cos(angle) * (b * x + d * y),
          10,
        );
      }
      expect(p).toEqual(before);
      owner.dispose();
      clocks.dispose();
    });

it('retains an original birth before the recipe and does not restart on authored endpoints/holds', async () => {
  const { p, span } = liveMovieFixture();
  p.layers[0].keys.splice(1, 0, { frame: 1, shapes: structuredClone(p.layers[0].keys[1].shapes) });
  const out = create(p, span),
    clock = captureMoviePoseClock(() => ({ project: out, revision: 0 }));
  for (const frame of [1, 2, 6, 10, 11]) {
    const view = await prepareLiveMotionFrameCapture(() => ({ project: out, revision: 0 }), frame),
      time = clock.replay(clock.capture(view), frame);
    expect(time.frames['track/instance/graphic']).toBe(frame - 1);
    expect(time.origins['track/instance/graphic']).toBe(1 / p.fps);
  }
});

it.each(['loop', 'once', 'single'] as const)(
  'retains pure nested %s exposure clocks, blanks and reentry',
  async (mode) => {
    const { p, span, definition } = liveMovieFixture(1),
      leaf = { ...structuredClone(definition), id: 'leaf' },
      child = {
        ...symbolInstance(leaf, 0, 0),
        id: 'nested',
        symbolPlayback: { mode, firstFrame: 1 },
      };
    p.symbols!.push(leaf);
    definition.shapes = [child];
    definition.timeline = {
      duration: 6,
      keys: [
        { frame: 2, shapes: [] },
        { frame: 4, shapes: [child] },
      ],
    };
    const out = create(p, span),
      clock = captureMoviePoseClock(() => ({ project: out, revision: 0 }));
    for (let frame = 2; frame < 12; frame++) {
      const view = await prepareLiveMotionFrameCapture(
          () => ({ project: out, revision: 0 }),
          frame,
        ),
        pose = clock.capture(view),
        time = clock.replay(pose, frame),
        art = evaluate(view, frame, time.frames),
        local = (1 + frame - 2) % 6;
      expect(time.frames['track/instance/graphic']).toBe(frame - 2);
      if (local === 2 || local === 3) expect(art).toHaveLength(0);
      else {
        const age = local >= 4 ? local - 4 : local,
          phase = mode === 'single' ? 1 : mode === 'once' ? Math.min(1 + age, 4) : (1 + age) % 5,
          t = Math.min((frame - 2) / 8, 1),
          r = (t * Math.PI) / 2;
        const pt = mapPoint(matrix(art[0]), { x: 1, y: 1 });
        expect(pt.x).toBeCloseTo(20 + 80 * t + Math.cos(r) * (phase * 10 + 1) - Math.sin(r), 10);
        expect(pt.y).toBeCloseTo(30 + 40 * t + Math.sin(r) * (phase * 10 + 1) + Math.cos(r), 10);
      }
    }
  },
);

it.each([
  'offset',
  'mode',
  'graphic',
  'group',
  'id',
  'definition',
  'button',
  'nestedMovie',
  'nestedButton',
  'missing',
  'cycle',
  'plain',
])('rejects unsupported original %s atomically and retains plain recovery', (kind) => {
  const { p, span, definition } = liveMovieFixture(),
    start = p.layers[0].keys[1].shapes[0],
    end = p.layers[0].keys[2].shapes[0];
  if (kind === 'offset') end.symbolPlayback!.firstFrame++;
  if (kind === 'mode') end.symbolPlayback!.mode = 'loop';
  if (kind === 'graphic') start.symbolPlayback!.mode = end.symbolPlayback!.mode = 'single';
  if (kind === 'group') start.groups = end.groups = ['g'];
  if (kind === 'id') end.id = 'other';
  if (kind === 'definition') end.symbolId = 'other';
  if (kind === 'button') definition.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  if (['nestedMovie', 'nestedButton', 'cycle'].includes(kind)) {
    const child = { ...structuredClone(definition), id: 'nested' };
    p.symbols!.push(child);
    definition.shapes = [
      {
        ...symbolInstance(child, 0, 0),
        symbolPlayback: { mode: kind === 'nestedMovie' ? 'movie' : 'loop', firstFrame: 0 },
      },
    ];
    if (kind === 'nestedButton') child.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    if (kind === 'cycle') child.shapes = [symbolInstance(definition, 0, 0)];
  }
  if (kind === 'missing') start.symbolId = end.symbolId = 'missing';
  if (kind === 'plain')
    for (const key of p.layers[0].keys)
      for (let i = 0; i < key.shapes.length; i++)
        key.shapes[i] = { ...definition.shapes[0], id: 'art' };
  const before = structuredClone(p);
  expect(() => create(p, span)).toThrow();
  expect(p).toEqual(before);
});

it.each([undefined, 'graphics'] as const)(
  'keeps %s movie admission unchanged without explicit movies marker',
  (symbolContinuity) => {
    const { p, span } = liveMovieFixture();
    span.symbolContinuity = symbolContinuity;
    expect(() => create(p, span)).toThrow();
  },
);

it('reopens additive schema54 metadata, retains own undefined endpoints and permits source edits to resample', () => {
  const { p, span } = liveMovieFixture();
  p.layers[0].keys[2].shapes[0].pivot = undefined;
  const out = create(p, span),
    sampler = createMotionFrameSampler(out, 'track', span);
  expect(Object.hasOwn(sampler.sample(10)[0], 'pivot')).toBe(true);
  sampler.dispose();
  const reopened = migrateProject(JSON.parse(JSON.stringify(out)));
  validateProject(reopened);
  expect(reopened.schemaVersion).toBe(59);
  expect(reopened.layers[0].liveMotionSpans![0].symbolContinuity).toBe('movies');
  reopened.layers[0].keys[2].shapes[0].x = 140;
  const owner = captureLiveMotionTimeline(() => ({ project: reopened, revision: 0 }));
  expect(owner.sample(6)[0].key.shapes[0].x).toBe(80);
  expect(owner.sample(6)[0].key.shapes[0].symbolPlayback).toEqual({ mode: 'movie', firstFrame: 1 });
});

it('keeps root/cubic/graphic ownership and creation hints outside movie authoring', () => {
  const { p, span } = liveMovieFixture(),
    out = create(p, span),
    read = () => ({ project: out, revision: 0, frame: 6 });
  const owners = [
    captureLiveMotionAuthoringFrame(read),
    captureLiveCubicControls(read),
    captureLiveGraphicMotionAuthoringFrame(read),
  ];
  for (const owner of owners) {
    expect(owner.choices).toEqual([]);
    owner.dispose();
  }
  for (const mode of ['plain', 'groups', 'graphics'] as const)
    expect(liveCreationIssue(p, 'track', 2, 10, mode)).toBeTruthy();
});

it('rejects later requests before source writes and returns fresh detached complete candidates', () => {
  const { p, span } = liveMovieFixture(),
    later = { ...structuredClone(p.layers[0]), id: 'later' };
  later.keys[2].shapes[0].symbolPlayback!.firstFrame = 4;
  p.layers.push(later);
  const before = structuredClone(p);
  expect(() =>
    prepareCreateLiveMotionSpans(p, [
      { layerId: 'track', span },
      { layerId: 'later', span: { ...span, id: 'later' } },
    ]),
  ).toThrow();
  expect(p).toEqual(before);
  const out = create(p, span);
  out.symbols![0].shapes[0].x++;
  expect(p).toEqual(before);
});

it.each(['nan', 'getter', 'prototype', 'marker', 'sparse', 'hidden'])(
  'rejects raw original %s before reading/normalizing it',
  (kind) => {
    const { p, span } = liveMovieFixture();
    let reads = 0;
    if (kind === 'nan') p.layers[0].keys[1].shapes[0].symbolPlayback!.firstFrame = NaN;
    if (kind === 'getter')
      Object.defineProperty(p.symbols![0].shapes[0], 'x', {
        enumerable: true,
        get() {
          reads++;
          return 0;
        },
      });
    if (kind === 'prototype')
      Object.setPrototypeOf(p.symbols![0], {
        get extra() {
          reads++;
          return 0;
        },
      });
    if (kind === 'marker')
      Object.defineProperty(span, 'symbolContinuity', {
        enumerable: true,
        get() {
          reads++;
          return 'movies';
        },
      });
    if (kind === 'sparse') delete p.symbols![0].timeline!.keys[1];
    if (kind === 'hidden')
      Object.defineProperty(p.symbols![0], 'name', { value: 'Movie', enumerable: false });
    expect(() => create(p, span)).toThrow();
    expect(reads).toBe(0);
  },
);

it.each(['source', 'request', 'output'])(
  'rejects late %s changes during complete candidate cloning',
  (kind) => {
    const { p, span } = liveMovieFixture(),
      clone = structuredClone;
    let hit = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const out = clone(value, options);
      if ((value as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.symbolContinuity === 'movies') {
        hit = true;
        if (kind === 'source') p.layers[0].keys[1].shapes[0].x++;
        else if (kind === 'request') span.ease = 'in';
        else (out as Project).layers[0].keys[1].shapes[0].x++;
      }
      return out;
    });
    expect(() => create(p, span)).toThrow();
    expect(hit).toBe(true);
  },
);

it('retains independently recoverable metadata removal for a structurally valid unsupported graph', () => {
  const { p, span, definition } = liveMovieFixture(),
    out = create(p, span);
  out.symbols![0].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  validateProject(out);
  expect(() => captureLiveMotionTimeline(() => ({ project: out, revision: 0 }))).toThrow();
  const recovered = prepareRemoveLiveMotionSpans(out, [{ layerId: 'track', spanId: span.id }]);
  expect(recovered.layers[0].liveMotionSpans).toBeUndefined();
  expect(recovered.layers[0].keys).toEqual(p.layers[0].keys);
  expect(definition).toEqual(p.symbols![0]);
});

it.each([8, 9])(
  'retains original movie graph depth boundary %i with shared definition caching',
  (depth) => {
    const { p, span, definition } = liveMovieFixture();
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
  },
);

it('retains exact aggregate capacity with repeated movie instances and rejects the next stored shape', () => {
  const { p, span, definition } = liveMovieFixture(),
    art = definition.shapes[0];
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

it('keeps mixed plain/movie companions and multiple movie offsets independently editable without baking', () => {
  const { p, span, definition } = liveMovieFixture();
  for (const key of [p.layers[0].keys[1], p.layers[0].keys[2]]) {
    key.shapes.push({
      ...structuredClone(key.shapes[0]),
      id: 'second',
      symbolPlayback: { mode: 'movie', firstFrame: 3 },
    });
    key.shapes.push({
      ...structuredClone(definition.shapes[0]),
      id: 'plain',
      x: key.frame === 2 ? 0 : 80,
    });
  }
  const out = create(p, span),
    owner = captureLiveMotionTimeline(() => ({ project: out, revision: 0 })),
    pose = owner.sample(6);
  expect(pose[0].key.shapes.map((s) => s.id)).toEqual(['instance', 'second', 'plain']);
  expect(pose[0].key.shapes.map((s) => s.symbolPlayback)).toEqual([
    { mode: 'movie', firstFrame: 1 },
    { mode: 'movie', firstFrame: 3 },
    undefined,
  ]);
  expect(pose[0].key.shapes[2].x).toBe(40);
  expect(out.layers[0].keys).toHaveLength(4);
});

it('rejects swallowed recursive preparation and completes a fresh source-valid retry', () => {
  const { p, span } = liveMovieFixture();
  expect(() =>
    prepareCreateLiveMotionSpans(p, [{ layerId: 'track', span }], {
      validate() {
        try {
          create(p, span);
        } catch {
          /* outer guard must retain rejection */
        }
      },
    }),
  ).toThrow();
  expect(create(p, span).layers[0].liveMotionSpans).toEqual([span]);
});

it.each([-1, 0.5, 10000, Infinity])(
  'rejects original movie first offset %s before transport',
  (first) => {
    const { p, span } = liveMovieFixture(first);
    expect(() => create(p, span)).toThrow();
  },
);
it('rejects unequal original offsets even when both resolve to the same clamped first frame', () => {
  const { p, span } = liveMovieFixture(9998);
  p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 9999;
  expect(() => create(p, span)).toThrow(/offset/);
});

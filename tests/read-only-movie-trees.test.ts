import { afterEach, expect, it, vi } from 'vitest';
import {
  validateProject,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type SymbolDefinition,
} from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { evaluate } from '../packages/animation/src';
import { liveMovieFixture, createLiveMovies } from './live-movies-fixture';
import { qualifyLiveMovieMotion } from '../packages/animation/src/live-movies';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import {
  createReadOnlyMovieTreeFrameSampler as capture,
  type ReadOnlyMovieTreeRequest,
} from '../packages/animation/src/read-only-movie-tree-sampler';
import { captureMoviePoseClock } from '../packages/animation/src/movie-pose-clock';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';

afterEach(() => vi.restoreAllMocks());
function fixture(first = 1, basis = 'plain') {
  const { p, span, definition } = liveMovieFixture(first, basis);
  const leaf: SymbolDefinition = {
    ...structuredClone(definition),
    id: 'leaf',
    name: 'Leaf',
    timeline: {
      duration: 3,
      keys: [1, 2].map((frame) => ({
        frame,
        shapes: [{ ...structuredClone(definition.shapes[0]), x: frame * 10 }],
      })),
    },
  };
  const child = {
    ...symbolInstance(leaf, 7, 3),
    id: 'nested',
    symbolPlayback: { mode: 'movie' as const, firstFrame: 1 },
  };
  definition.shapes = [child];
  definition.timeline = { duration: 5, keys: [] };
  p.symbols!.push(leaf);
  const recipe = { start: span.start, end: span.end, ease: span.ease };
  const requests: ReadOnlyMovieTreeRequest[] = [{ layerId: 'track', recipe }];
  validateProject(p);
  return { p, span, definition, leaf, child, recipe, requests };
}

for (const first of [0, 1, 9998])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`read-only nested sampling first${first}/${basis} retains independent clocks and world geometry`, () => {
      const { p, requests } = fixture(first, basis),
        before = structuredClone(p),
        sampler = capture(p, requests),
        clock = captureMoviePoseClock(() => ({ project: p, revision: 0 }));
      for (const frame of [2, 3, 6, 9, 10]) {
        const view = sampler.sample(frame),
          time = clock.replay(clock.capture(view), frame),
          age = frame - 2;
        expect(view.symbols).toEqual(p.symbols);
        expect(view.layers[0].liveMotionSpans).toBeUndefined();
        expect(time.frames).toEqual({
          'track/instance/graphic': age,
          'track/instance/nested/leaf': age,
        });
        expect(time.origins).toEqual({
          'track/instance/graphic': 2 / p.fps,
          'track/instance/nested/leaf': 2 / p.fps,
        });
        const art = evaluate(view, frame, time.frames)[0],
          point = mapPoint(matrix(art), { x: 1, y: 1 }),
          t = age / 8,
          angle = (t * Math.PI) / 2,
          x = 8 + ((1 + age) % 3) * 10,
          y = 4,
          a = basis === 'reflected' ? -2 : basis === 'affine' ? 2 : 1,
          b = basis === 'plain' ? 0 : 0.25,
          c = basis === 'plain' ? 0 : 0.5,
          d = basis === 'plain' ? 1 : 3;
        expect(point.x).toBeCloseTo(
          20 + 80 * t + Math.cos(angle) * (a * x + c * y) - Math.sin(angle) * (b * x + d * y),
          10,
        );
        expect(point.y).toBeCloseTo(
          30 + 40 * t + Math.sin(angle) * (a * x + c * y) + Math.cos(angle) * (b * x + d * y),
          10,
        );
        expect(
          view.layers[0].keys.find((k) => k.frame === frame)!.shapes[0].symbolPlayback,
        ).toEqual({ mode: 'movie', firstFrame: first });
        expect(compileMovieClockPlan(view)).toEqual(compileMovieClockPlan(p));
      }
      expect(p).toEqual(before);
      sampler.dispose();
      clock.dispose();
    });

it('keeps movie age advancing while root placement is paused and through parent/project loops', () => {
  const { p, requests } = fixture(),
    sampler = capture(p, requests),
    clock = captureMoviePoseClock(() => ({ project: p, revision: 0 }));
  for (let frame = 0; frame < 6; frame++)
    clock.sample(clock.capture(frame < 2 ? p : sampler.sample(frame)), frame, frame / p.fps, frame);
  const pose = clock.capture(sampler.sample(6));
  for (let age = 0; age <= 25; age++) {
    const time = clock.sample(pose, 6, (6 + age) / p.fps, 6);
    expect(time.frames['track/instance/graphic']).toBe(age + 4);
    expect(time.frames['track/instance/nested/leaf']).toBe(age + 4);
    expect(evaluate(pose.project, 6, time.frames)).toHaveLength(1);
  }
  // Integer replay is independent of the already advanced preview.
  expect(clock.replay(pose, 6).frames['track/instance/nested/leaf']).toBe(4);
});

for (const mode of ['loop', 'once', 'single'] as const)
  it(`retains ${mode} graphic intermediary blank/reentry lifetimes under a looping movie`, () => {
    const { p, requests, definition, child } = fixture(0);
    const middle: SymbolDefinition = {
      id: 'middle',
      name: 'Middle',
      width: 60,
      height: 10,
      shapes: [child],
      timeline: {
        duration: 4,
        keys: [
          { frame: 2, shapes: [] },
          { frame: 3, shapes: [child] },
        ],
      },
    };
    definition.shapes = [
      { ...symbolInstance(middle, 0, 0), id: 'bridge', symbolPlayback: { mode, firstFrame: 0 } },
    ];
    p.symbols!.push(middle);
    const sampler = capture(p, requests),
      a = captureMoviePoseClock(() => ({ project: p, revision: 0 })),
      b = captureMoviePoseClock(() => ({ project: p, revision: 0 }));
    let birth = 2,
      previousVisible = false;
    for (let frame = 2; frame <= 10; frame++) {
      const view = sampler.sample(frame),
        expected = a.replay(a.capture(p), frame),
        actual = b.replay(b.capture(view), frame);
      expect(actual).toEqual(expected);
      const age = frame - 2,
        parent = age % 5,
        local = mode === 'single' ? 0 : mode === 'once' ? Math.min(parent, 3) : parent % 4;
      expect(Object.keys(actual.frames).some((k) => k.endsWith('/nested/leaf'))).toBe(local !== 2);
      if (local !== 2) {
        if (!previousVisible) birth = frame;
        const id = Object.keys(actual.frames).find((k) => k.endsWith('/nested/leaf'))!;
        expect(actual.frames[id]).toBe(frame - birth);
        expect(actual.origins[id]).toBeCloseTo(birth / p.fps, 12);
      }
      previousVisible = local !== 2;
      expect(evaluate(view, frame, actual.frames)).toHaveLength(local === 2 ? 0 : 1);
    }
  });

it('separates repeated definitions and sibling namespaces with independently authored offsets', () => {
  const { p, requests, definition, child } = fixture();
  definition.shapes.push({
    ...structuredClone(child),
    id: 'other',
    x: 40,
    symbolPlayback: { mode: 'movie', firstFrame: 2 },
  });
  for (const key of p.layers[0].keys)
    if (key.shapes.length)
      key.shapes.push({ ...structuredClone(key.shapes[0]), id: 'sibling', x: 150 });
  const sampler = capture(p, requests),
    clock = captureMoviePoseClock(() => ({ project: p, revision: 0 })),
    view = sampler.sample(6),
    time = clock.replay(clock.capture(view), 6);
  expect(Object.keys(time.frames)).toHaveLength(6);
  expect(new Set(Object.keys(time.frames)).size).toBe(6);
  expect(evaluate(view, 6, time.frames)).toHaveLength(4);
});

it('does not broaden persisted movies, generic marker admission or document/UI markers', () => {
  const { p, span, recipe } = fixture();
  expect(() => qualifyLiveMovieMotion(p, 'track', span)).toThrow();
  expect(() => createLiveMovies(p, span)).toThrow();
  expect(() =>
    createMotionFrameSampler(p, 'track', { ...recipe, symbolContinuity: 'movies' }),
  ).toThrow();
  expect(() =>
    createMotionFrameSampler(p, 'track', { ...recipe, symbolContinuity: 'unsupported-movie-trees' } as never),
  ).toThrow();
  const invalid = structuredClone(p);
  invalid.layers[0].liveMotionSpans = [{ ...span, symbolContinuity: 'unsupported-movie-trees' } as never];
  expect(() => validateProject(invalid)).toThrow();
});

for (const failure of ['button', 'missing', 'cycle', 'offset', 'mode', 'group', 'empty'] as const)
  it(`rejects unsupported original ${failure} atomically`, () => {
    const { p, requests, definition } = fixture();
    if (failure === 'button') definition.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    if (failure === 'missing') definition.shapes[0].symbolId = 'absent';
    if (failure === 'cycle') definition.shapes[0].symbolId = definition.id;
    if (failure === 'offset') p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 2;
    if (failure === 'mode') p.layers[0].keys[2].shapes[0].symbolPlayback!.mode = 'loop';
    if (failure === 'group')
      for (const k of p.layers[0].keys) for (const s of k.shapes) s.groups = ['group'];
    if (failure === 'empty') for (const k of p.layers[0].keys) k.shapes = [];
    const before = structuredClone(p);
    expect(() => capture(p, requests)).toThrow();
    expect(p).toEqual(before);
  });

it.each([NaN, Infinity, -1, 1.5, 1, 11])(
  'rejects invalid sample frame %s without consuming valid sampling',
  (frame) => {
    const { p, requests } = fixture(),
      sampler = capture(p, requests);
    expect(() => sampler.sample(frame)).toThrow();
    expect(sampler.sample(6).layers[0].keys.find((k) => k.frame === 6)).toBeDefined();
  },
);

it('prepares all tracks atomically and retains unrelated project/library data', () => {
  const { p, requests } = fixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'second' });
  const two = [...requests, { ...structuredClone(requests[0]), layerId: 'second' }],
    before = structuredClone(p),
    sampler = capture(p, two),
    view = sampler.sample(6);
  expect(view.layers.every((l) => l.keys.some((k) => k.frame === 6))).toBe(true);
  expect(view.symbols).toEqual(p.symbols);
  expect(p).toEqual(before);
  p.layers[1].keys[2].shapes[0].symbolPlayback!.firstFrame = 9;
  expect(() => capture(p, two)).toThrow();
  expect(() => sampler.sample(6)).toThrow();
});

it('returns detached outputs, exact endpoints, no metadata and rejects disposed/stale requests', () => {
  const { p, requests } = fixture(),
    sampler = capture(p, requests);
  expect(sampler.sample(2)).toEqual(p);
  expect(sampler.sample(10)).toEqual(p);
  const view = sampler.sample(6);
  view.symbols![0].name = 'changed';
  view.layers[0].keys[0].shapes = [];
  expect(sampler.sample(6).symbols).toEqual(p.symbols);
  requests[0].recipe.ease = 'in';
  expect(() => sampler.sample(6)).toThrow();
  requests[0].recipe.ease = 'linear';
  expect(sampler.sample(6)).toBeDefined();
  sampler.dispose();
  expect(() => sampler.sample(6)).toThrow();
});

it('rejects raw source/request accessors before reading them', () => {
  for (const target of ['source', 'request']) {
    const { p, requests } = fixture();
    let reads = 0;
    Object.defineProperty(
      target === 'source' ? p.symbols![1].shapes[0] : requests[0].recipe,
      target === 'source' ? 'x' : 'start',
      {
        enumerable: true,
        get() {
          reads++;
          return 2;
        },
      },
    );
    expect(() => capture(p, requests)).toThrow();
    expect(reads).toBe(0);
  }
});

it('rejects source changes and output corruption delivered by the completed output clone', () => {
  for (const type of ['source', 'output', 'reentry']) {
    const { p, requests } = fixture(),
      sampler = capture(p, requests),
      clone = globalThis.structuredClone;
    let hit = 0;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const result = clone(value, options);
      if (value && typeof value === 'object' && 'layers' in value && ++hit === 1) {
        if (type === 'source') p.name = 'Changed';
        if (type === 'output') (result as Project).symbols![0].name = 'Changed';
        if (type === 'reentry') {
          try {
            sampler.sample(6);
          } catch {
            /* outer must reject */
          }
        }
      }
      return result;
    });
    expect(() => sampler.sample(6)).toThrow();
    expect(hit).toBeGreaterThan(0);
    vi.restoreAllMocks();
  }
});

it.each(['NaN', 'infinity', 'sparse', 'inherited', 'hidden', 'duplicate', 'marker'])(
  'rejects original noncanonical %s requests without transport normalization',
  (type) => {
    const { p, requests } = fixture();
    if (type === 'NaN') requests[0].recipe.start = NaN;
    if (type === 'infinity') p.symbols![1].shapes[0].x = Infinity;
    if (type === 'sparse') delete requests[0];
    if (type === 'inherited') Object.setPrototypeOf(requests[0], { bad: 1 });
    if (type === 'hidden') Object.defineProperty(requests[0], 'hidden', { value: 1 });
    if (type === 'duplicate') requests.push(structuredClone(requests[0]));
    if (type === 'marker') Object.assign(requests[0].recipe, { symbolContinuity: 'movies' });
    expect(() => capture(p, requests)).toThrow();
  },
);

it('rejects nested buttons even after sharing the definition on another valid branch', () => {
  const { p, requests, definition, child, leaf } = fixture();
  const button = {
    ...structuredClone(leaf),
    id: 'button',
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
  };
  p.symbols!.push(button);
  definition.shapes.push({ ...structuredClone(child), id: 'bad', symbolId: 'button' });
  expect(() => capture(p, requests)).toThrow();
});

it('checks depth through cached shared definitions at a deeper ancestry', () => {
  const { p, requests, definition, child, leaf } = fixture();
  let next = leaf;
  for (let i = 0; i < 7; i++) {
    const wrapper: SymbolDefinition = {
      id: 'wrap' + i,
      name: 'Wrapper',
      width: 60,
      height: 10,
      shapes: [{ ...symbolInstance(next, 0, 0), id: 'child' }],
    };
    p.symbols!.push(wrapper);
    next = wrapper;
  }
  definition.shapes.push({ ...structuredClone(child), id: 'deep', symbolId: next.id });
  expect(() => capture(p, requests)).toThrow();
});

it('rejects a pose that would erase an original intervening movie lifetime', () => {
  const { p, requests } = fixture();
  p.layers[0].keys.splice(
    2,
    0,
    { frame: 4, shapes: [] },
    { frame: 7, shapes: structuredClone(p.layers[0].keys[1].shapes) },
  );
  const sampler = capture(p, requests),
    before = structuredClone(p);
  expect(() => sampler.sample(6)).toThrow(/lifetimes/);
  expect(p).toEqual(before);
  expect(sampler.sample(3)).toBeDefined();
});

it('retains exact original aggregate capacity and rejects the next stored shape', () => {
  const { p, requests, leaf } = fixture(),
    art = leaf.shapes[0];
  leaf.shapes = Array.from({ length: MAX_SYMBOL_ARTWORK - 3 }, (_, i) => ({
    ...art,
    id: 'a' + i,
    points: [],
  }));
  const sampler = capture(p, requests);
  sampler.dispose();
  leaf.shapes.push({ ...art, id: 'overflow' });
  expect(() => capture(p, requests)).toThrow(/budget/);
}, 120000);

it('rejects finite geometry whose shared motion arithmetic overflows', () => {
  const { p, requests } = fixture();
  p.layers[0].keys[1].shapes[0].x = -1e308;
  p.layers[0].keys[2].shapes[0].x = 1e308;
  expect(() => capture(p, requests)).toThrow();
});

it.each(['source', 'requests', 'reentry'])(
  'rejects %s changes during initial detached capture before returning a sampler',
  (type) => {
    const { p, requests } = fixture(),
      clone = globalThis.structuredClone;
    let hit = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const out = clone(value, options);
      if (value === p && !hit) {
        hit = true;
        if (type === 'source') p.name = 'Changed';
        if (type === 'requests') requests[0].recipe.ease = 'in';
        if (type === 'reentry') {
          try {
            capture(p, requests);
          } catch {
            /* cannot swallow admission */
          }
        }
      }
      return out;
    });
    expect(() => capture(p, requests)).toThrow();
    expect(hit).toBe(true);
  },
);

it('rejects privately captured request mutation despite unchanged public input', () => {
  const { p, requests } = fixture(),
    clone = globalThis.structuredClone;
  let privateInput: ReadOnlyMovieTreeRequest[] | undefined;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const out = clone(value, options);
    if (value === requests) privateInput = out as ReadOnlyMovieTreeRequest[];
    return out;
  });
  const sampler = capture(p, requests);
  vi.restoreAllMocks();
  expect(privateInput).toBeDefined();
  privateInput![0].recipe.ease = 'in';
  expect(requests[0].recipe.ease).toBe('linear');
  expect(() => sampler.sample(6)).toThrow();
});

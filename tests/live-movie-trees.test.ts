import { afterEach, expect, it, vi } from 'vitest';
import {
  migrateProject,
  validateProject,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type LiveMotionSpan,
} from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { evaluate } from '../packages/animation/src';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import {
  captureLiveMotionTimeline,
  prepareCreateLiveMotionSpans as create,
  prepareUpdateLiveMotionSpans as update,
  prepareRemoveLiveMotionSpans as remove,
} from '../packages/animation/src/live-motion';
import { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
import { captureMoviePoseClock } from '../packages/animation/src/movie-pose-clock';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import { captureLiveMotionAuthoringFrame } from '../packages/animation/src/live-motion-owner';
import { captureLiveMovieMotionAuthoringFrame } from '../packages/animation/src/live-movie-motion-owner';
import { captureLiveGraphicMotionAuthoringFrame } from '../packages/animation/src/live-graphic-motion-owner';
import { liveCreationIssue } from '../apps/editor/src/live-creation';
import { readOnlyMovieTreeFixture } from './read-only-movie-trees-fixture';

afterEach(() => vi.restoreAllMocks());
function fixture(first = 1, basis = 'plain') {
  const { p } = readOnlyMovieTreeFixture(basis);
  for (const k of p.layers[0].keys) for (const s of k.shapes) s.symbolPlayback!.firstFrame = first;
  const span: LiveMotionSpan = {
    id: 'tree',
    start: 2,
    end: 10,
    ease: 'linear',
    symbolContinuity: 'movie-trees',
  };
  return { p, span, request: { layerId: 'track', span } };
}

for (const first of [0, 1, 9998])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`persists and samples nested first${first}/${basis} with original clocks and exact sparse endpoints`, async () => {
      const { p, span, request } = fixture(first, basis),
        before = structuredClone(p),
        out = create(p, [request]);
      expect(out.layers[0].keys).toEqual(p.layers[0].keys);
      expect(out.symbols).toEqual(p.symbols);
      expect(out.layers[0].liveMotionSpans).toEqual([span]);
      expect(out.schemaVersion).toBe(p.schemaVersion);
      const owner = captureLiveMotionTimeline(() => ({ project: out, revision: 0 })),
        clock = captureMoviePoseClock(() => ({ project: out, revision: 0 }));
      for (const frame of [0, 2, 3, 6, 9, 10, 11, 12]) {
        const view = await prepareLiveMotionFrameCapture(
            () => ({ project: out, revision: 0 }),
            frame,
          ),
          time = clock.replay(clock.capture(view), frame);
        expect(compileMovieClockPlan(view)).toEqual(compileMovieClockPlan(p));
        expect(view.symbols).toEqual(p.symbols);
        expect(view.frameScripts).toEqual(p.frameScripts);
        if (frame < 2 || frame >= 12) {
          expect(time.frames).toEqual({});
          continue;
        }
        const age = frame - 2,
          t = Math.min(age / 8, 1),
          angle = (t * Math.PI) / 2,
          x = 8 + ((1 + age) % 3) * 10,
          y = 4,
          a = basis === 'reflected' ? -2 : basis === 'affine' ? 2 : 1,
          b = basis === 'plain' ? 0 : 0.25,
          c = basis === 'plain' ? 0 : 0.5,
          d = basis === 'plain' ? 1 : 3,
          point = mapPoint(matrix(evaluate(view, frame, time.frames)[0]), { x: 1, y: 1 });
        expect(time.frames).toEqual({
          'track/instance/graphic': age,
          'track/instance/nested/leaf': age,
        });
        expect(point.x).toBeCloseTo(
          160 + 20 * t + Math.cos(angle) * (a * x + c * y) - Math.sin(angle) * (b * x + d * y),
          10,
        );
        expect(point.y).toBeCloseTo(
          100 + 40 * t + Math.sin(angle) * (a * x + c * y) + Math.cos(angle) * (b * x + d * y),
          10,
        );
        expect(owner.sample(frame)[0].key.shapes[0].symbolPlayback).toEqual({
          mode: 'movie',
          firstFrame: first,
        });
      }
      const edited = update(out, [
        { layerId: 'track', spanId: 'tree', changes: { ease: 'in', opacityEase: 'out' } },
      ]);
      expect(edited.layers[0].keys).toEqual(p.layers[0].keys);
      expect(edited.symbols).toEqual(p.symbols);
      expect(edited.layers[0].liveMotionSpans).toEqual([
        { ...span, ease: 'in', opacityEase: 'out' },
      ]);
      expect(remove(edited, [{ layerId: 'track', spanId: 'tree' }])).toEqual(p);
      expect(p).toEqual(before);
      owner.dispose();
      clock.dispose();
    });

it('reopens exact metadata and later endpoint edits immediately affect both read-only consumers', async () => {
  const { p, request } = fixture(),
    out = create(p, [request]),
    reopened = migrateProject(JSON.parse(JSON.stringify(out)));
  expect(reopened).toEqual(out);
  validateProject(reopened);
  reopened.layers[0].keys[2].shapes[0].x += 40;
  const owner = captureLiveMotionTimeline(() => ({ project: reopened, revision: 1 })),
    view = await prepareLiveMotionFrameCapture(() => ({ project: reopened, revision: 1 }), 6);
  expect(owner.sample(6)[0].key.shapes[0].x).toBe(190);
  expect(view.layers[0].keys.find((k) => k.frame === 6)!.shapes[0].x).toBe(190);
  expect(reopened.layers[0].keys).toHaveLength(4);
});

it('offers explicit creation while keeping root/graphic/movie split ownership unavailable for nested recipes', () => {
  const { p, request } = fixture(),
    out = create(p, [request]);
  expect(liveCreationIssue(p, 'track', 2, 10, 'movie-trees')).toBeUndefined();
  expect(liveCreationIssue(p, 'track', 2, 10, 'movies')).toBeTruthy();
  for (const capture of [
    captureLiveMotionAuthoringFrame,
    captureLiveMovieMotionAuthoringFrame,
    captureLiveGraphicMotionAuthoringFrame,
  ]) {
    const owner = capture(() => ({ project: out, revision: 0, frame: 6 }));
    expect(owner.choices).toEqual([]);
    expect(() => owner.resolve('track', 'instance')).toThrow();
    owner.dispose();
  }
  expect(() =>
    create(p, [{ ...request, span: { ...request.span, symbolContinuity: 'movies' } }]),
  ).toThrow();
  expect(() =>
    create(p, [{ ...request, span: { ...request.span, symbolContinuity: 'graphics' } }]),
  ).toThrow();
});

it('retains explicit interpolation options and separate channel easing without enabling dependencies', () => {
  const { p, request } = fixture();
  request.span.options = { affine: true, paint: true };
  request.span.opacityEase = 'in';
  request.span.paintEase = 'out';
  const out = create(p, [request]);
  expect(out.layers[0].liveMotionSpans![0]).toEqual(request.span);
  expect(() =>
    update(out, [{ layerId: 'track', spanId: 'tree', changes: { options: {} } }]),
  ).toThrow();
  expect(out.layers[0].liveMotionSpans![0].options).toEqual({ affine: true, paint: true });
});

for (const failure of [
  'offset',
  'mode',
  'group',
  'button',
  'child-button',
  'missing',
  'cycle',
  'overflow',
] as const)
  it(`rejects original ${failure} without preparing any writes`, () => {
    const { p, request } = fixture();
    if (failure === 'offset') p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 9999;
    if (failure === 'mode') p.layers[0].keys[2].shapes[0].symbolPlayback!.mode = 'single';
    if (failure === 'group')
      for (const k of p.layers[0].keys) for (const s of k.shapes) s.groups = ['group'];
    if (failure === 'button' || failure === 'child-button')
      p.symbols![failure === 'button' ? 0 : 1].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    if (failure === 'missing') p.symbols![0].shapes[0].symbolId = 'missing';
    if (failure === 'cycle') p.symbols![0].shapes[0].symbolId = 'graphic';
    if (failure === 'overflow') {
      p.layers[0].keys[1].shapes[0].x = -1e308;
      p.layers[0].keys[2].shapes[0].x = 1e308;
    }
    const before = structuredClone(p);
    expect(() => create(p, [request])).toThrow();
    expect(p).toEqual(before);
  });

it('retains structural recovery for a now-incompatible nested recipe', () => {
  const { p, request } = fixture(),
    out = create(p, [request]);
  out.symbols![1].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  validateProject(out);
  expect(() => captureLiveMotionTimeline(() => ({ project: out, revision: 0 }))).toThrow();
  const recovered = remove(out, [{ layerId: 'track', spanId: 'tree' }]);
  expect(recovered.symbols).toEqual(out.symbols);
  expect(recovered.layers[0].keys).toEqual(out.layers[0].keys);
  expect(recovered.layers[0].liveMotionSpans).toBeUndefined();
});

it('samples repeated child definitions with separate namespaces and authored first offsets', async () => {
  const { p, request } = fixture();
  p.symbols![0].shapes.push({
    ...symbolInstance(p.symbols![1], 40, 3),
    id: 'sibling',
    symbolPlayback: { mode: 'movie', firstFrame: 2 },
  });
  const out = create(p, [request]),
    view = await prepareLiveMotionFrameCapture(() => ({ project: out, revision: 0 }), 6),
    clock = captureMoviePoseClock(() => ({ project: out, revision: 0 })),
    time = clock.replay(clock.capture(view), 6);
  expect(time.frames).toEqual({
    'track/instance/graphic': 4,
    'track/instance/nested/leaf': 4,
    'track/instance/sibling/leaf': 4,
  });
  expect(evaluate(view, 6, time.frames)).toHaveLength(2);
  expect(view.symbols).toEqual(p.symbols);
});

it('direct shared sampling keeps a private immutable topology and exact original metadata', () => {
  const { p, request } = fixture(),
    sampler = createMotionFrameSampler(p, 'track', request.span);
  const original = structuredClone(p.layers[0].keys[1].shapes[0]);
  p.symbols![0].name = 'Later source edit';
  p.layers[0].keys[1].shapes[0].x = 300;
  expect(sampler.sample(2)).toEqual([original]);
  expect(sampler.sample(6)[0].x).toBe(170);
  sampler.dispose();
  expect(() => sampler.sample(6)).toThrow();
});

it('admits all tracks together and rejects an invalid later track or request atomically', () => {
  const { p, request } = fixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'other' });
  const requests = [request, { ...structuredClone(request), layerId: 'other' }],
    before = structuredClone(p),
    out = create(p, requests);
  expect(out.layers.every((l) => l.liveMotionSpans?.[0].symbolContinuity === 'movie-trees')).toBe(
    true,
  );
  expect(p).toEqual(before);
  p.layers[1].keys[2].shapes[0].symbolPlayback!.firstFrame = 2;
  expect(() => create(p, requests)).toThrow();
  expect(out.layers[0].keys).toEqual(before.layers[0].keys);
  expect(() => create(before, [request, { ...request, layerId: 'missing' }])).toThrow();
});

for (const target of ['source', 'request', 'admission'])
  it(`rejects raw ${target} getters with zero reads`, () => {
    const { p, request } = fixture();
    let reads = 0;
    const options = {};
    Object.defineProperty(
      target === 'source' ? p.symbols![1].shapes[0] : target === 'request' ? request.span : options,
      target === 'source' ? 'x' : target === 'request' ? 'start' : 'validate',
      {
        enumerable: true,
        get() {
          reads++;
          return target === 'admission' ? () => {} : 2;
        },
      },
    );
    expect(() => create(p, [request], options)).toThrow();
    expect(reads).toBe(0);
  });

for (const type of ['source', 'request', 'reentry'] as const)
  it(`rejects late ${type} in synchronous enclosing admission with a fresh source-valid retry`, () => {
    const { p, request } = fixture();
    let calls = 0;
    expect(() =>
      create(p, [request], {
        validate() {
          if (++calls === 4) {
            if (type === 'source') p.name = 'Changed';
            if (type === 'request') request.span.ease = 'in';
            if (type === 'reentry') {
              try {
                create(p, [request]);
              } catch {
                /* outer rejects */
              }
            }
          }
        },
      }),
    ).toThrow();
    expect(calls).toBeGreaterThanOrEqual(4);
    expect(p.layers[0].liveMotionSpans).toBeUndefined();
    expect(create(p, [request]).layers[0].liveMotionSpans).toHaveLength(1);
  });

for (const type of ['candidate-library', 'output', 'captured-request'] as const)
  it(`rejects ${type} corruption during detached cloning`, () => {
    const { p, request } = fixture(),
      requests = [request],
      clone = globalThis.structuredClone;
    let hit = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const out = clone(value, options);
      if (
        !hit &&
        (type === 'captured-request'
          ? value === requests
          : value &&
            typeof value === 'object' &&
            'layers' in value &&
            (type === 'candidate-library'
              ? value === p
              : (value as Project).layers[0].liveMotionSpans?.[0]?.symbolContinuity ===
                'movie-trees'))
      ) {
        hit = true;
        if (type === 'captured-request') (out as typeof requests)[0].span.ease = 'in';
        else (out as Project).symbols![1].name = 'Changed';
      }
      return out;
    });
    expect(() => create(p, requests)).toThrow();
    expect(hit).toBe(true);
  });

it('rejects stale source/revision and late sampled key corruption in private timeline capture', () => {
  const { p, request } = fixture(),
    out = create(p, [request]);
  let revision = 0;
  const owner = captureLiveMotionTimeline(() => ({ project: out, revision }));
  revision++;
  expect(() => owner.sample(6)).toThrow();
  const fresh = captureLiveMotionTimeline(() => ({ project: out, revision })),
    clone = globalThis.structuredClone;
  let hit = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const output = clone(value, options);
    if (
      !hit &&
      value &&
      typeof value === 'object' &&
      'frame' in value &&
      (value as { frame: number }).frame === 6 &&
      'shapes' in value
    ) {
      hit = true;
      (
        output as { shapes: { symbolPlayback: { firstFrame: number } }[] }
      ).shapes[0].symbolPlayback.firstFrame = 99;
    }
    return output;
  });
  expect(() => fresh.sample(6)).toThrow();
  expect(hit).toBe(true);
});

it('admits the actual aggregate capacity without a lower nested recipe cap', () => {
  const { p, request } = fixture(),
    leaf = p.symbols![1],
    art = leaf.shapes[0];
  leaf.shapes = Array.from({ length: MAX_SYMBOL_ARTWORK - 3 }, (_, i) => ({
    ...art,
    id: 'a' + i,
    points: [],
  }));
  const out = create(p, [request]);
  expect(out.symbols![1].shapes).toHaveLength(MAX_SYMBOL_ARTWORK - 3);
  leaf.shapes.push({ ...art, id: 'overflow' });
  expect(() => create(p, [request])).toThrow(/budget/);
}, 120000);

for (const change of ['source', 'request', 'candidate', 'output', 'reentry'] as const)
  it(`rejects ${change} at the actual complete outer candidate/output clone`, () => {
    const { p, request } = fixture(),
      requests = [request],
      clone = globalThis.structuredClone;
    let candidate: Project | undefined,
      hits = 0;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const result = clone(value, options);
      if (value === p && !candidate) candidate = result as Project;
      if (
        value === candidate &&
        candidate?.layers[0].liveMotionSpans?.[0]?.symbolContinuity === 'movie-trees'
      ) {
        hits++;
        if (change === 'source') p.name = 'Late source';
        if (change === 'request') request.span.ease = 'in';
        if (change === 'candidate') candidate.layers[0].liveMotionSpans[0].ease = 'in';
        if (change === 'output') (result as Project).symbols![1].name = 'Late output';
        if (change === 'reentry') {
          try {
            create(p, requests);
          } catch {
            /* outer must reject */
          }
        }
      }
      return result;
    });
    expect(() => create(p, requests)).toThrow();
    expect(hits).toBe(1);
    expect(p.layers[0].liveMotionSpans).toBeUndefined();
    vi.restoreAllMocks();
    expect(create(p, requests).layers[0].liveMotionSpans).toHaveLength(1);
  });

for (const target of ['source', 'request', 'candidate', 'output'] as const)
  it(`rejects late noncanonical ${target} prototypes even when own-value signatures stay equal`, () => {
    const { p, request } = fixture(),
      requests = [request],
      clone = globalThis.structuredClone;
    let candidate: Project | undefined,
      hits = 0;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
      const result = clone(value, options);
      if (value === p && !candidate) candidate = result as Project;
      if (value === candidate && candidate?.layers[0].liveMotionSpans?.length) {
        hits++;
        const object =
          target === 'source'
            ? p.symbols![1].shapes[0]
            : target === 'request'
              ? request.span
              : target === 'candidate'
                ? candidate.symbols![1].shapes[0]
                : (result as Project).symbols![1].shapes[0];
        Object.setPrototypeOf(object, { injected: true });
      }
      return result;
    });
    expect(() => create(p, requests)).toThrow();
    expect(hits).toBe(1);
  });

it('rejects a late source layers getter before topology comparison can read it', () => {
  const { p, request } = fixture(),
    requests = [request],
    clone = globalThis.structuredClone;
  let candidate: Project | undefined,
    hits = 0,
    reads = 0;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const result = clone(value, options);
    if (value === p && !candidate) candidate = result as Project;
    if (value === candidate && candidate?.layers[0].liveMotionSpans?.length) {
      hits++;
      Object.defineProperty(p, 'layers', {
        enumerable: true,
        get() {
          reads++;
          return [];
        },
      });
    }
    return result;
  });
  expect(() => create(p, requests)).toThrow();
  expect(hits).toBe(1);
  expect(reads).toBe(0);
});

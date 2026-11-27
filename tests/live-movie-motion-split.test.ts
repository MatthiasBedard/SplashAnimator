import { expect, it, vi } from 'vitest';
import { liveMovieFixture as originalMovieFixture, createLiveMovies } from './live-movies-fixture';
import { splitLiveMovieMotionLayer as split } from '../packages/animation/src/live-movie-motion-split';
import { splitLiveMotionLayer as rootSplit } from '../packages/animation/src/live-motion-split';
import { splitLiveGroupMotionLayer as groupSplit } from '../packages/animation/src/live-group-motion-split';
import { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { evaluate } from '../packages/animation/src';
import { captureMoviePoseClock } from '../packages/animation/src/movie-pose-clock';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import * as clockPlans from '../packages/animation/src/movie-clock-plan';
import { splitLiveGraphicMotionLayer as graphicSplit } from '../packages/animation/src/live-graphic-motion-split';
import { liveGraphicFixture, createLiveGraphics } from './live-graphics-fixture';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { symbolInstance } from '../packages/geometry/src/symbols';
import {
  validateProject,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type Layer,
} from '../packages/document/src';
function liveMovieFixture(mode = 'one', basis = 'plain') {
  return originalMovieFixture(mode === 'zero' ? 0 : mode === 'clamped' ? 9998 : 1, basis);
}
function fixture(mode = 'one', basis = 'plain') {
  const { p, span } = liveMovieFixture(mode, basis);
  return createLiveMovies(p, span);
}
function operation(p: Project, at = 6, id = 'right') {
  return split(p, p.layers[0], p.layers[0].liveMotionSpans![0], at, id);
}
function projectWith(p: Project, layer: Layer) {
  return { ...p, layers: p.layers.map((l) => (l.id === layer.id ? layer : l)) };
}
async function rendered(p: Project, frame: number) {
  const clock = captureMoviePoseClock(() => ({ project: p, revision: 0 }));
  try {
    const view = await prepareLiveMotionFrameCapture(() => ({ project: p, revision: 0 }), frame),
      time = clock.replay(clock.capture(view), frame);
    return evaluate(view, frame, time.frames);
  } finally {
    clock.dispose();
  }
}
async function equivalent(p: Project, out: Project) {
  expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(p));
  const a = captureLiveMotionTimeline(() => ({ project: p, revision: 0 })),
    b = captureLiveMotionTimeline(() => ({ project: out, revision: 0 }));
  try {
    for (let f = 0; f < p.duration; f++) {
      expect(
        sameMotionArtwork(a.sample(f)[0].key.shapes, b.sample(f)[0].key.shapes),
        `frame ${f}`,
      ).toBe(true);
      const x = await rendered(p, f),
        y = await rendered(out, f);
      expect(y.length).toBe(x.length);
      for (let i = 0; i < x.length; i++) {
        const from = mapPoint(matrix(x[i]), { x: 1, y: 1 }),
          to = mapPoint(matrix(y[i]), { x: 1, y: 1 });
        expect(to.x).toBeCloseTo(from.x, 9);
        expect(to.y).toBeCloseTo(from.y, 9);
      }
    }
  } finally {
    a.dispose();
    b.dispose();
  }
}
it('splits keyed movie placement intervals while retaining the original movie age', async () => {
  const p = fixture(), span = p.layers[0].liveMotionSpans![0];
  Object.assign(span, {
    xKeys:[{offset:4,value:84}], xKeyEases:['in','out'],
    rotationKeys:[{offset:4,value:480}], rotation:{direction:'clockwise',turns:2},
    opacityKeys:[{offset:4,value:0.25}], scaleXKeys:[{offset:4,value:2}],
    scaleYKeys:[{offset:4,value:1.5}], shearKeys:[{offset:4,value:0.5}],
    options:{affine:true}
  });
  const source = structuredClone(p);
  for (const at of [4,6,8]) {
    const layer = operation(p,at);
    const shape = layer.keys.find(k=>k.frame===at)!.shapes[0];
    expect(shape.symbolPlayback).toEqual({mode:'movie',firstFrame:1});
    expect(shape.x).toBe(at===4?36:at===6?84:96);
    await equivalent(p, projectWith(p,layer));
  }
  expect(p).toEqual(source);
  span.path = {startX:0,startY:0,endX:0,endY:0};
  expect(()=>operation(p)).toThrow();
});

for (const mode of ['zero', 'one', 'clamped'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const at of [4, 6, 8])
      it(`restricts ${mode}/${basis} movies at ${at} without moving clocks or world artwork`, async () => {
        const p = fixture(mode, basis),
          before = structuredClone(p),
          layer = operation(p, at),
          out = projectWith(p, layer);
        validateProject(out);
        expect(p).toEqual(before);
        expect(layer.keys.map((k) => k.frame)).toEqual([0, 2, at, 10, 12]);
        expect(
          layer.liveMotionSpans!.map((s) => [s.id, s.start, s.end, s.symbolContinuity]),
        ).toEqual([
          ['live', 2, at, 'movies'],
          ['right', at, 10, 'movies'],
        ]);
        for (const k of before.layers[0].keys)
          expect(layer.keys.find((x) => x.frame === k.frame)).toEqual(k);
        await equivalent(p, out);
        await equivalent(p, JSON.parse(JSON.stringify(out)));
        // Independent oracle, not a comparison only against the original sampler.
        const pose = (await rendered(out, 6))[0],
          clock = ((mode === 'zero' ? 0 : mode === 'clamped' ? 4 : 1) + 4) % 5,
          b = basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
          u = b[0] * (clock * 10 + 1) + b[2],
          v = b[1] * (clock * 10 + 1) + b[3],
          point = mapPoint(matrix(pose), { x: 1, y: 1 });
        expect(point.x).toBeCloseTo(60 + (u - v) / Math.SQRT2, 9);
        expect(point.y).toBeCloseTo(50 + (u + v) / Math.SQRT2, 9);
        layer.keys[1].shapes[0].x++;
        layer.liveMotionSpans![0].ease = 'out';
        expect(p).toEqual(before);
      });
for (const ease of ['in', 'out', 'in-out'] as const)
  for (const at of [4, 8])
    it(`restricts ${ease} movie geometry independently from clocks at ${at}`, async () => {
      const p = fixture();
      p.layers[0].liveMotionSpans![0].ease = ease;
      if (ease === 'in-out') {
        const before = structuredClone(p);
        expect(() => operation(p, at)).toThrow(/midpoint/);
        expect(p).toEqual(before);
      } else await equivalent(p, projectWith(p, operation(p, at)));
    });
for (const holes of [false, true])
  it(`preserves nested pure graphic exposure/reentry ${holes}`, async () => {
    const { p, span, definition } = liveMovieFixture(),
      child = {
        ...symbolInstance(definition, 0, 0),
        id: 'child',
        symbolPlayback: { mode: 'once' as const, firstFrame: 2 },
      },
      wrapper = {
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
    for (const key of p.layers[0].keys) for (const s of key.shapes) s.symbolId = 'wrapper';
    p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 1;
    const source = createLiveMovies(p, span);
    const out = projectWith(source, operation(source, 4));
    await equivalent(source, out);
    for (let frame = 2; frame < 12; frame++) {
      const phase = (1 + frame - 2) % 3,
        shapes = await rendered(out, frame);
      if (holes && phase === 1) {
        expect(shapes).toEqual([]);
        continue;
      }
      const clock = holes ? 2 : Math.min(2 + phase, 4),
        t = Math.min((frame - 2) / 8, 1),
        angle = (t * Math.PI) / 2,
        point = mapPoint(matrix(shapes[0]), { x: 1, y: 1 }),
        x = clock * 10 + 1;
      expect(point.x).toBeCloseTo(20 + 80 * t + Math.cos(angle) * x - Math.sin(angle), 9);
      expect(point.y).toBeCloseTo(30 + 40 * t + Math.sin(angle) * x + Math.cos(angle), 9);
    }
  });
it('preserves high authored movie offsets after clamping without changing saved values', async () => {
  const p = fixture('clamped');
  await equivalent(p, projectWith(p, operation(p, 8)));
});
it('preserves absent and own undefined authored endpoint pivot metadata', async () => {
  const { p, span } = liveMovieFixture();
  span.end = 7;
  p.layers[0].keys[2].frame = 7;
  p.layers[0].keys[1].shapes[0].pivot = undefined;
  const source = createLiveMovies(p, span),
    layer = operation(source, 4);
  expect(Object.hasOwn(layer.keys.find((k) => k.frame === 2)!.shapes[0], 'pivot')).toBe(true);
  expect(Object.hasOwn(layer.keys.find((k) => k.frame === 7)!.shapes[0], 'pivot')).toBe(false);
  await equivalent(source, projectWith(source, layer));
});
it('preserves plain companions, pivots, options, settings and independently timed opacity', async () => {
  const { p, span } = liveMovieFixture();
  span.ease = 'in';
  span.opacityEase = 'out';
  span.options = { affine: false, paint: false };
  for (const key of p.layers[0].keys)
    if (key.shapes.length) {
      key.shapes[0].opacity = key.frame === 2 ? 0 : 1;
      key.shapes[0].pivot = { x: 2, y: -4 };
      key.shapes.push({
        id: 'plain',
        kind: 'rectangle',
        x: key.shapes[0].x,
        y: 100,
        width: 8,
        height: 8,
        rotation: 0,
        fill: '#0000ff',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
      });
    }
  const source = createLiveMovies(p, span),
    layer = operation(source, 4);
  expect(layer.liveMotionSpans!.map((s) => s.options)).toEqual([span.options, span.options]);
  await equivalent(source, projectWith(source, layer));
});
for (const path of ['cubic', 'straightDistance', 'curvedDistance'])
  it(`keeps existing ${path} restriction arithmetic`, async () => {
    const p = fixture(),
      s = p.layers[0].liveMotionSpans![0];
    s.path =
      path === 'cubic'
        ? { startX: 0, startY: 20, endX: 0, endY: 20 }
        : path === 'straightDistance'
          ? { startX: 80 / 3, startY: 40 / 3, endX: -80 / 3, endY: -40 / 3, distance: true }
          : { startX: 0, startY: 80, endX: 0, endY: -40, distance: true };
    const before = structuredClone(p);
    if (path === 'curvedDistance') expect(() => operation(p)).toThrow(/reproduce|unresolved/);
    else await equivalent(p, projectWith(p, operation(p)));
    expect(p).toEqual(before);
  });
for (const failure of [
  'clock',
  'button',
  'graphic',
  'plain',
  'foreignLayer',
  'foreignSpan',
  'occupied',
  'early',
  'fraction',
  'sameID',
])
  it(`rejects original ${failure} admission without writes`, () => {
    const p = fixture(),
      layer = p.layers[0],
      span = layer.liveMotionSpans![0];
    if (failure === 'clock') layer.keys[2].shapes[0].symbolPlayback!.firstFrame = 2;
    if (failure === 'button') p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
    if (failure === 'graphic') layer.keys[1].shapes[0].symbolPlayback!.mode = 'loop';
    if (failure === 'plain') delete span.symbolContinuity;
    if (failure === 'occupied') layer.keys.splice(2, 0, { frame: 6, shapes: [] });
    const before = structuredClone(p);
    expect(() =>
      split(
        p,
        failure === 'foreignLayer' ? structuredClone(layer) : layer,
        failure === 'foreignSpan' ? structuredClone(span) : span,
        failure === 'early' ? 3 : failure === 'fraction' ? 5.5 : 6,
        failure === 'sameID' ? 'live' : 'right',
      ),
    ).toThrow();
    expect(p).toEqual(before);
  });
it('keeps root/group split default scopes separate', () => {
  const p = fixture(),
    layer = p.layers[0],
    span = layer.liveMotionSpans![0];
  expect(() => rootSplit(p, layer, span, 6, 'right')).toThrow(/graphic/);
  expect(() => groupSplit(p, layer, span, 6, 'right')).toThrow(/group/);
});
for (const field of ['get', 'prototype', 'NaN', 'Infinity'])
  it(`rejects raw library ${field} before transport`, () => {
    const p = fixture();
    let reads = 0;
    if (field === 'get')
      Object.defineProperty(p.symbols![0].timeline, 'duration', {
        enumerable: true,
        get() {
          reads++;
          return 5;
        },
      });
    if (field === 'prototype')
      Object.setPrototypeOf(p.symbols![0], {
        get unknown() {
          reads++;
          return 1;
        },
      });
    if (field === 'NaN') p.symbols![0].shapes[0].x = NaN;
    if (field === 'Infinity') p.symbols![0].shapes[0].x = Infinity;
    expect(() => operation(p)).toThrow();
    expect(reads).toBe(0);
  });
for (const hook of ['source', 'output', 'candidate'])
  it(`rejects actual late ${hook} changes and preserves separate source edits`, () => {
    const p = fixture(),
      before = structuredClone(p),
      clone = structuredClone;
    let hit = false;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v),
        q = v as Layer;
      if (!hit && q?.liveMotionSpans?.length === 2 && q.liveMotionSpans[1].id === 'right') {
        hit = true;
        if (hook === 'source') p.symbols![0].name = 'Separate source edit';
        if (hook === 'output') (out as Layer).keys[2].shapes[0].x++;
        if (hook === 'candidate') q.keys[2].shapes[0].x++;
      }
      return out;
    });
    try {
      expect(() => operation(p)).toThrow();
      expect(hit).toBe(true);
      if (hook === 'source') before.symbols![0].name = 'Separate source edit';
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
it('admits the original aggregate library capacity and rejects overflow without per-frame duplication', () => {
  const { p, span, definition } = liveMovieFixture(),
    art = definition.shapes[0];
  definition.shapes = Array.from({ length: MAX_SYMBOL_ARTWORK - 4 }, (_, i) => ({
    ...art,
    id: 'art' + i,
    points: [],
  }));
  const source = createLiveMovies(p, span),
    layer = operation(source);
  expect(layer.keys.map((k) => k.frame)).toEqual([0, 2, 6, 10, 12]);
  source.symbols![0].shapes.push({ ...art, id: 'overflow' });
  expect(() => operation(source)).toThrow(/budget/);
}, 120000);

for (const scale of [1e-4, 1e4])
  it(`preserves relative movie geometry scale ${scale}`, async () => {
    const p = fixture();
    for (const key of p.layers[0].keys)
      for (const shape of key.shapes) {
        shape.x *= scale;
        shape.y *= scale;
        shape.transform = [scale, 0, 0, scale];
      }
    const layer = operation(p, 4),
      out = projectWith(p, layer);
    await equivalent(p, out);
    const shape = (await rendered(out, 6))[0],
      point = mapPoint(matrix(shape), { x: 1, y: 1 });
    for (const [actual, expected] of [
      [point.x, 60 * scale],
      [point.y, (50 + Math.SQRT2) * scale],
    ])
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
        32 * Number.EPSILON * Math.max(1, Math.abs(expected)),
      );
  });
for (const direction of ['clockwise', 'counterclockwise'] as const)
  it(`restricts directed movie ${direction} turns`, async () => {
    const p = fixture();
    p.layers[0].liveMotionSpans![0].rotation = { direction, turns: 1 };
    await equivalent(p, projectWith(p, operation(p)));
  });
it('preserves independent clocks on multiple original movie instances', async () => {
  const p = fixture();
  for (const key of p.layers[0].keys)
    if (key.shapes.length) {
      const other = structuredClone(key.shapes[0]);
      other.id = 'other';
      other.y += 20;
      other.symbolPlayback!.firstFrame = 2;
      key.shapes.push(other);
    }
  const layer = operation(p, 8);
  expect(layer.keys.find((k) => k.frame === 8)!.shapes.map((s) => s.id)).toEqual([
    'instance',
    'other',
  ]);
  await equivalent(p, projectWith(p, layer));
});
it('retains actual curved compound symbol artwork without flattening the library', async () => {
  const { p, span, definition } = liveMovieFixture('once');
  for (const artwork of [definition.shapes, ...definition.timeline!.keys.map((k) => k.shapes)])
    for (const shape of artwork) {
      shape.kind = 'polygon';
      shape.fillRule = 'evenodd';
      shape.contours = [
        [
          { x: 0, y: 0, out: { x: 2, y: -1 } },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
        ],
        [
          { x: 1, y: 1 },
          { x: 1, y: 3 },
          { x: 3, y: 3 },
          { x: 3, y: 1 },
        ],
      ];
    }
  const source = createLiveMovies(p, span),
    before = structuredClone(source),
    layer = operation(source, 8);
  await equivalent(source, projectWith(source, layer));
  expect(source).toEqual(before);
});
it('rejects genuine interpolation overflow without modifying source', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0].x = 1e308;
  p.layers[0].keys[2].shapes[0].x = -1e308;
  const before = structuredClone(p);
  expect(() => operation(p)).toThrow();
  expect(p).toEqual(before);
});
it('rejects a late complete-candidate validation mutation and allows a fresh retry', () => {
  const p = fixture(),
    before = structuredClone(p),
    stringify = JSON.stringify;
  let hit = false;
  vi.spyOn(JSON, 'stringify').mockImplementation(((...args: Parameters<typeof stringify>) => {
    const out = stringify(...args),
      q = args[0] as Project;
    if (!hit && q?.layers?.[0]?.liveMotionSpans?.length === 2) {
      hit = true;
      q.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 3;
    }
    return out;
  }) as typeof stringify);
  try {
    expect(() => operation(p)).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.restoreAllMocks();
  }
  expect(operation(p).keys.map((k) => k.frame)).toEqual([0, 2, 6, 10, 12]);
});

it('retains the original representable in-out midpoint restriction', async () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].ease = 'in-out';
  await equivalent(p, projectWith(p, operation(p, 6)));
});

for (const scale of [1e-6, 1e6])
  it(`retains existing document affine rejection for scale ${scale}`, () => {
    const p = fixture();
    for (const key of p.layers[0].keys)
      for (const shape of key.shapes) shape.transform = [scale, 0, 0, scale];
    const before = structuredClone(p);
    expect(() => operation(p)).toThrow(/affine transform/);
    expect(p).toEqual(before);
  });

it('keeps graphic, root and group kernel scopes separate in both directions', () => {
  const p = fixture(),
    layer = p.layers[0],
    span = layer.liveMotionSpans![0];
  expect(() => graphicSplit(p, layer, span, 6, 'right')).toThrow(/graphic/);
  const graphic = liveGraphicFixture(),
    source = createLiveGraphics(graphic.p, graphic.span);
  expect(() => operation(source)).toThrow(/movie/);
  const before = structuredClone(source);
  expect(() => rootSplit(p, layer, span, 6, 'right')).toThrow();
  expect(() => groupSplit(p, layer, span, 6, 'right')).toThrow();
  expect(source).toEqual(before);
});

it('preserves pre-span births, paused movie age, blanks/reentry and exact loop origins independently', async () => {
  const p = fixture();
  p.fps = 10;
  p.layers[0].keys.splice(1, 0, { frame: 1, shapes: structuredClone(p.layers[0].keys[1].shapes) });
  const before = structuredClone(p),
    out = projectWith(p, operation(p)),
    clock = captureMoviePoseClock(() => ({ project: p, revision: 0 }));
  let born: number | undefined,
    previous = -1;
  for (let tick = 0; tick < 42; tick++) {
    const position = tick <= 18 ? tick : tick <= 21 ? 18 : tick - 3,
      frame = position % 14;
    if (frame === 1 && position !== previous) born = tick;
    const view = await prepareLiveMotionFrameCapture(() => ({ project: out, revision: 0 }), frame),
      time = clock.sample(clock.capture(view), frame, tick / 10, position);
    if (frame >= 1 && frame < 12) {
      expect(time.frames).toEqual({ 'track/instance/graphic': tick - born! });
      expect(time.origins).toEqual({ 'track/instance/graphic': born! / 10 });
    } else {
      expect(time.frames).toEqual({});
      expect(time.origins).toEqual({});
    }
    previous = position;
  }
  expect(p).toEqual(before);
  expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(p));
  clock.dispose();
});

it('reopens and splits a preserved half again without baking or changing movie clocks', async () => {
  const p = fixture(),
    out = projectWith(p, operation(p)),
    reopened = JSON.parse(JSON.stringify(out)) as Project,
    next = split(
      reopened,
      reopened.layers[0],
      reopened.layers[0].liveMotionSpans![0],
      4,
      'quarter',
    );
  expect(next.keys.map((k) => k.frame)).toEqual([0, 2, 4, 6, 10, 12]);
  expect(next.liveMotionSpans!.map((s) => [s.id, s.start, s.end])).toEqual([
    ['live', 2, 4],
    ['quarter', 4, 6],
    ['right', 6, 10],
  ]);
  await equivalent(p, projectWith(reopened, next));
});

it('prepares multiple layers without publishing earlier output when a later split rejects', () => {
  const p = fixture(),
    later = { ...structuredClone(p.layers[0]), id: 'later' };
  p.layers.push(later);
  later.keys[2].shapes[0].width++;
  const before = structuredClone(p),
    first = operation(p),
    prepared = structuredClone(first);
  expect(() => split(p, later, later.liveMotionSpans![0], 6, 'later-right')).toThrow();
  expect(p).toEqual(before);
  expect(first).toEqual(prepared);
});

it('rejects swallowed split reentry after complete detached layer construction and permits fresh retry', () => {
  const p = fixture(),
    before = structuredClone(p),
    clone = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const output = clone(value),
      layer = value as Layer;
    if (!hit && layer?.liveMotionSpans?.length === 2) {
      hit = true;
      expect(() => operation(p)).toThrow(/reenter/);
    }
    return output;
  });
  try {
    expect(() => operation(p)).toThrow(/reenter/);
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
  }
  expect(operation(p).keys.map((k) => k.frame)).toEqual([0, 2, 6, 10, 12]);
});

for (const phase of [2, 3])
  it(`rejects altered compiled clock topology at admission phase${phase}`, () => {
    const p = fixture(),
      before = structuredClone(p),
      compile = clockPlans.compileMovieClockPlan;
    let calls = 0,
      hit = false;
    vi.spyOn(clockPlans, 'compileMovieClockPlan').mockImplementation((value) => {
      const plan = compile(value);
      if (++calls === phase) {
        hit = true;
        plan.layers[0].keys[1].frame++;
      }
      return plan;
    });
    try {
      expect(() => operation(p)).toThrow(/topology|lifetimes/);
      expect(hit).toBe(true);
      expect(p).toEqual(before);
    } finally {
      vi.restoreAllMocks();
    }
    expect(operation(p).keys).toHaveLength(5);
  });

for (const kind of [
  'nestedMovie',
  'nestedButton',
  'missingPlayback',
  'missingOffset',
  'unequalClampedOffsets',
  'group',
] as const)
  it(`rejects unsupported original movie split ${kind} without writes`, () => {
    const p = fixture(),
      root = p.layers[0].keys[1].shapes[0],
      end = p.layers[0].keys[2].shapes[0];
    if (kind === 'missingPlayback') delete root.symbolPlayback;
    if (kind === 'missingOffset')
      delete (root.symbolPlayback as { firstFrame?: number }).firstFrame;
    if (kind === 'unequalClampedOffsets') {
      root.symbolPlayback!.firstFrame = 9998;
      end.symbolPlayback!.firstFrame = 9999;
    }
    if (kind === 'group') root.groups = end.groups = ['outer'];
    if (kind === 'nestedMovie' || kind === 'nestedButton') {
      const leaf = { ...structuredClone(p.symbols![0]), id: 'leaf' };
      p.symbols!.push(leaf);
      p.symbols![0].shapes = [
        {
          ...symbolInstance(leaf, 0, 0),
          symbolPlayback: { mode: kind === 'nestedMovie' ? 'movie' : 'loop', firstFrame: 0 },
        },
      ];
      if (kind === 'nestedButton') leaf.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    }
    const before = structuredClone(p);
    expect(() => operation(p)).toThrow();
    expect(p).toEqual(before);
  });

it.each(['hidden', 'locked'] as const)(
  'rejects original %s movie tracks without source writes',
  (kind) => {
    const p = fixture();
    if (kind === 'hidden') p.layers[0].visible = false;
    else p.layers[0].locked = true;
    const before = structuredClone(p);
    expect(() => operation(p)).toThrow(/visible unlocked/);
    expect(p).toEqual(before);
  },
);
it.each([-1, NaN, Infinity, 6.5, 2, 10, Number.MAX_SAFE_INTEGER])(
  'rejects invalid exact split target %s without source writes',
  (at) => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => operation(p, at)).toThrow();
    expect(p).toEqual(before);
  },
);

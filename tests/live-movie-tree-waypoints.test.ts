import { afterEach, expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  validateProject,
  type Project,
  type Point,
  type Vector,
} from '../packages/document/src';
import { liveSplitFixture } from './live-motion-split-fixture';
import { liveTreeFixture, createLiveMovieTrees } from './live-tree-edit-fixture';
import { treeSplitFixture } from './live-tree-split-fixture';
import {
  captureLiveMovieTreeWaypoints as capture,
  prepareLiveMovieTreeWaypointPositions as prepare,
  type LiveMovieTreeWaypointOwner as Owner,
  type LiveMovieTreeWaypointRequest as Request,
} from '../packages/animation/src/live-movie-tree-waypoints';
import * as clockPlans from '../packages/animation/src/movie-clock-plan';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
import { captureMoviePoseClock } from '../packages/animation/src/movie-pose-clock';
import { evaluate } from '../packages/animation/src';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import {
  captureLiveWaypoints,
  prepareLiveWaypointPositions,
} from '../packages/animation/src/live-waypoints';
import {
  captureLiveMovieTreeCubicControls,
  prepareLiveMovieTreeCubicControlPositions,
} from '../packages/animation/src/live-movie-tree-cubic-controls';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const route = {
  startX: 3,
  startY: 7,
  endX: -2,
  endY: 6,
  waypoints: [
    { x: 20, y: 30 },
    { x: 60, y: 30 },
  ],
};
function fixture(two = false, basis = 'plain', first = 1) {
  const { p, span } = liveTreeFixture(first, basis);
  span.path = structuredClone(route);
  const out = createLiveMovieTrees(p, span);
  if (two) out.layers.push({ ...structuredClone(out.layers[0]), id: 'later' });
  return out;
}
function operation(p = fixture(), frame = 6, index = 0, shape = 'instance') {
  const scope = capture(() => ({ project: p, revision: 7, frame })),
    owner = scope.resolve('track', 'live', shape, index);
  return { scope, owner };
}
const target = (o: Owner): Point => ({ x: o.point.x + 10, y: o.point.y + 10 });
for (const first of [0, 1, 9998])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const index of [0, 1])
      it(`owns original nested ${first}/${basis}/slot${index} with independent world geometry and nested clocks`, async () => {
        const p = fixture(false, basis, first),
          before = structuredClone(p),
          { scope, owner } = operation(p, 6, index),
          out = prepare([{ owner, target: target(owner) }]),
          expected = structuredClone(p);
        expected.layers[0].liveMotionSpans![0].path!.waypoints!.map((q, i) => {
          if (i === index) {
            q.x += 10;
            q.y += 10;
          }
        });
        expect(owner.point).toEqual({ x: 40 + 40 * index, y: 60 });
        expect(owner.shapeIds).toEqual(['instance']);
        expect(out).toEqual(expected);
        expect(p).toEqual(before);
        expect(out.symbols).toEqual(p.symbols);
        expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(p));
        const timeline = captureLiveMotionTimeline(() => ({ project: out, revision: 0 })),
          clock = captureMoviePoseClock(() => ({ project: out, revision: 0 }));
        try {
          for (const f of [2, 4, 6, 8, 10]) {
            const t = (f - 2) / 8,
              part = Math.min(2, Math.floor(t * 3)),
              u = t * 3 - part;
            const points = [
              { x: 20, y: 30 },
              { x: 40 + (index === 0 ? 10 : 0), y: 60 + (index === 0 ? 10 : 0) },
              { x: 80 + (index === 1 ? 10 : 0), y: 60 + (index === 1 ? 10 : 0) },
              { x: 100, y: 70 },
            ];
            const pose = timeline.sample(f),
              root = pose[0].key.shapes[0];
            expect(root.x).toBeCloseTo(points[part].x * (1 - u) + points[part + 1].x * u, 9);
            expect(root.y).toBeCloseTo(points[part].y * (1 - u) + points[part + 1].y * u, 9);
            const render = await prepareLiveMotionFrameCapture(
                () => ({ project: out, revision: 0 }),
                f,
              ),
              time = clock.replay(clock.capture(render), f);
            const leaf = mapPoint(matrix(evaluate(render, f, time.frames)[0]), { x: 0, y: 0 }),
              wanted = mapPoint(matrix(root), { x: ((1 + f - 2) % 3) * 10, y: 0 });
            expect(leaf.x).toBeCloseTo(wanted.x, 9);
            expect(leaf.y).toBeCloseTo(wanted.y, 9);
          }
        } finally {
          timeline.dispose();
          clock.dispose();
          scope.dispose();
        }
      });

for (const f of [2, 3, 6, 9, 10])
  for (const index of [0, 1])
    it(`owns original slot ${index} at frame ${f} without promotion`, () => {
      const p = fixture(),
        { scope, owner } = operation(p, f, index),
        out = prepare([{ owner, target: target(owner) }]);
      expect(out.layers[0].keys).toEqual(p.layers[0].keys);
      expect(out.duration).toBe(p.duration);
      expect(Object.isFrozen(owner)).toBe(true);
      expect(Object.isFrozen(owner.point)).toBe(true);
      expect(Object.isFrozen(owner.shapeIds)).toBe(true);
      const hints = scope.choices;
      expect(hints).toEqual([
        { layerId: 'track', spanId: 'live', shapeId: 'instance', waypointCount: 2 },
      ]);
      hints[0].shapeId = 'forged';
      hints[0].waypointCount = 999;
      expect(scope.resolve('track', 'live', 'instance', index).point).toEqual(owner.point);
      scope.dispose();
      expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    });
for (const mode of ['curved', 'custom', 'distance', 'curved-distance', 'tangent', 'custom-tangent'])
  it(`preserves explicit ${mode} options through JSON reopen and later slot editing`, () => {
    const p = fixture(),
      path = p.layers[0].liveMotionSpans![0].path!;
    if (mode !== 'distance') path.curvedWaypoints = true;
    if (mode.includes('distance')) path.distance = true;
    if (mode.includes('custom')) {
      path.waypointTangents = [
        { x: 10, y: 5 },
        { x: 10, y: 5 },
        { x: 15, y: -5 },
        { x: 10, y: -5 },
      ];
      path.waypointIncoming = [
        { x: -20, y: -10 },
        { x: -30, y: 10 },
      ];
    }
    if (mode.includes('tangent'))
      Object.assign(path, { tangent: true, headingOffset: 10, headingOffsetEnd: 20 });
    const before = structuredClone(p),
      { scope, owner } = operation(p),
      out = prepare([{ owner, target: target(owner) }]),
      expected = structuredClone(p);
    (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[0] = { x: 30, y: 40 };
    expect(out).toEqual(expected);
    const reopened = JSON.parse(JSON.stringify(out)) as Project,
      fresh = operation(reopened, 6, 1),
      later = prepare([{ owner: fresh.owner, target: target(fresh.owner) }]);
    (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[1] = { x: 70, y: 40 };
    expect(later).toEqual(expected);
    expect(p).toEqual(before);
    expect(compileMovieClockPlan(later)).toEqual(compileMovieClockPlan(p));
    scope.dispose();
    fresh.scope.dispose();
  });
it('combines distinct shared slots from different original roots and tracks atomically', () => {
  const p = fixture(true);
  for (const layer of p.layers)
    for (const key of layer.keys)
      if (key.shapes.length)
        key.shapes.push({
          ...structuredClone(key.shapes[0]),
          id: 'other',
          x: key.shapes[0].x + 40,
          y: key.shapes[0].y + 30,
        });
  const before = structuredClone(p),
    { scope, owner } = operation(p),
    other = scope.resolve('track', 'live', 'other', 1),
    later = scope.resolve('later', 'live', 'instance', 0);
  expect(other.point).toEqual({ x: 120, y: 90 });
  expect(owner.shapeIds).toEqual(['instance', 'other']);
  const out = prepare([
      { owner, target: target(owner) },
      { owner: other, target: target(other) },
      { owner: later, target: target(later) },
    ]),
    expected = structuredClone(p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[]) = [
    { x: 30, y: 40 },
    { x: 70, y: 40 },
  ];
  (expected.layers[1].liveMotionSpans![0].path!.waypoints as Point[])[0] = { x: 30, y: 40 };
  expect(out).toEqual(expected);
  expect(p).toEqual(before);
  expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(p));
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: scope.resolve('track', 'live', 'other', 0), target: target(other) },
    ]),
  ).toThrow(/slot once/);
  expect(p).toEqual(before);
  scope.dispose();
});
for (const index of [-1, 0.5, 2, NaN, Infinity, '0', {}, null])
  it(`rejects original slot ${String(index)} without coercion`, () => {
    const { scope } = operation();
    expect(() => scope.resolve('track', 'live', 'instance', index as number)).toThrow();
    scope.dispose();
  });
for (const mode of [
  'NaN',
  'Infinity',
  'getter',
  'inherited',
  'nonenumerable',
  'extra',
  'unchanged',
])
  it(`rejects raw ${mode} targets without getter reads`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      r = { owner, target: target(owner) };
    let reads = 0;
    if (mode === 'NaN') r.target.x = NaN;
    if (mode === 'Infinity') r.target.y = Infinity;
    if (mode === 'getter')
      Object.defineProperty(r.target, 'x', {
        enumerable: true,
        get() {
          reads++;
          return 1;
        },
      });
    if (mode === 'inherited') {
      delete (r as Partial<typeof r>).target;
      Object.setPrototypeOf(r, {
        get target() {
          reads++;
          return { x: 1, y: 2 };
        },
      });
    }
    if (mode === 'nonenumerable')
      Object.defineProperty(r, 'target', { value: r.target, enumerable: false });
    if (mode === 'extra') Object.assign(r.target, { extra: true });
    if (mode === 'unchanged') r.target = { ...owner.point };
    expect(() => prepare([r])).toThrow();
    expect(reads).toBe(0);
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const mode of ['source', 'identity', 'frame', 'revision', 'dispose', 'reentry'])
  it(`rejects stale ${mode} source ownership`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let source = p,
      frame = 6,
      revision = 7,
      hook = () => {};
    const scope = capture(() => {
        hook();
        return { project: source, frame, revision };
      }),
      owner = scope.resolve('track', 'live', 'instance', 0);
    if (mode === 'source') p.name = 'independent source';
    if (mode === 'identity') source = structuredClone(p);
    if (mode === 'frame') frame++;
    if (mode === 'revision') revision++;
    if (mode === 'dispose') scope.dispose();
    if (mode === 'reentry') hook = () => scope.assertCurrent();
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    if (mode === 'source') before.name = p.name;
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const mode of ['json', 'copy', 'hint', 'root', 'cubic', 'scope'])
  it(`rejects ${mode} ownership substitution`, () => {
    const p = fixture(),
      { scope, owner } = operation(p);
    let fake: unknown = owner;
    if (mode === 'json') fake = JSON.parse(JSON.stringify(owner));
    if (mode === 'copy') fake = { ...owner };
    if (mode === 'hint') fake = scope.choices[0];
    if (mode === 'root')
      fake = {
        layerId: 'track',
        spanId: 'live',
        shapeId: 'instance',
        waypointIndex: 0,
        point: { x: 40, y: 60 },
      };
    if (mode === 'cubic') fake = { ...owner, role: 'start' };
    if (mode === 'scope') fake = operation(p).owner;
    if (mode === 'scope')
      expect(() =>
        prepare([
          { owner, target: target(owner) },
          { owner: fake as Owner, target: target(owner) },
        ]),
      ).toThrow();
    else expect(() => prepare([{ owner: fake as Owner, target: target(owner) }])).toThrow();
    expect(() =>
      prepareLiveWaypointPositions([{ owner: owner as never, target: target(owner) }]),
    ).toThrow();
    expect(() =>
      prepareLiveMovieTreeCubicControlPositions([{ owner: owner as never, target: target(owner) }]),
    ).toThrow();
    scope.dispose();
  });
for (const mode of [
  'input',
  'async',
  'callbackGetter',
  'lateCandidate',
  'lateReaderTarget',
  'lateReaderSource',
  'lateLibrary',
  'lateOutputClock',
])
  it(`rejects ${mode} after detached data exists and allows source-valid retry`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let rows: Request[] = [],
      candidate: Project | undefined,
      hit = false,
      once = true;
    const scope = capture(() => {
        const stack = new Error().stack ?? '';
        if (
          candidate &&
          !hit &&
          mode.startsWith('lateReader') &&
          stack.includes('prepareLiveMovieTreeWaypointPositions') &&
          !stack.includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          if (mode === 'lateReaderSource') p.name = 'independent late source';
          else rows[0].target.x++;
        }
        return { project: p, revision: 7, frame: 6 };
      }),
      owner = scope.resolve('track', 'live', 'instance', 0);
    rows = [{ owner, target: target(owner) }];
    const native = structuredClone;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value),
        q = out as Project;
      if (q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30) {
        if (
          candidate &&
          mode === 'lateOutputClock' &&
          !hit &&
          (new Error().stack ?? '').includes('prepareLiveMovieTreeWaypointPositions') &&
          !(new Error().stack ?? '').includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          q.symbols![0].timeline!.duration++;
        }
        candidate = q;
      }
      return out;
    });
    const options = {
      validate: () => {
        const stack = new Error().stack ?? '';
        if (
          candidate &&
          !hit &&
          ['lateCandidate', 'lateLibrary'].includes(mode) &&
          stack.includes('prepareLiveMovieTreeWaypointPositions') &&
          !stack.includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          if (mode === 'lateLibrary') candidate.symbols![0].name = 'tampered library';
          else candidate.layers[0].keys[1].shapes[0].x++;
        }
        if (!once) return;
        once = false;
        if (mode === 'input') {
          hit = true;
          rows[0].target.y++;
        }
        if (mode === 'async') {
          hit = true;
          return Promise.resolve() as unknown as void;
        }
      },
    };
    if (mode === 'callbackGetter')
      Object.defineProperty(options, 'validate', {
        get() {
          hit = true;
          throw Error('getter must not run');
        },
      });
    expect(() => prepare(rows, options)).toThrow(
      mode === 'lateOutputClock' ? /clock topology/ : undefined,
    );
    expect(hit).toBe(mode !== 'callbackGetter');
    if (mode === 'lateReaderSource') before.name = p.name;
    expect(p).toEqual(before);
    vi.unstubAllGlobals();
    const fresh = mode === 'lateReaderSource' ? operation(p) : undefined,
      o = fresh?.owner ?? owner;
    expect(
      prepare([{ owner: o, target: target(o) }]).layers[0].liveMotionSpans![0].path!.waypoints![0],
    ).toEqual({ x: 30, y: 40 });
    fresh?.scope.dispose();
    scope.dispose();
  });
for (const phase of ['callback', 'reader'])
  for (const cross of [false, true])
    it(`rejects swallowed ${phase} cross-scope ${cross} reentry before reader callbacks`, () => {
      const p = fixture(),
        before = structuredClone(p);
      let hook = () => {},
        hit = false;
      const scope = capture(() => {
          hook();
          return { project: p, revision: 7, frame: 6 };
        }),
        owner = scope.resolve('track', 'live', 'instance', 0),
        other = operation(p),
        rows = [{ owner, target: target(owner) }];
      const reenter = () => {
        if (hit) return;
        hit = true;
        try {
          prepare(cross ? [{ owner: other.owner, target: target(other.owner) }] : rows);
        } catch {}
      };
      if (phase === 'reader') hook = reenter;
      expect(() => prepare(rows, phase === 'callback' ? { validate: reenter } : {})).toThrow(
        /reenter|changed/,
      );
      expect(hit).toBe(true);
      expect(p).toEqual(before);
      hook = () => {};
      expect(prepare(rows).layers[0].keys).toEqual(p.layers[0].keys);
      scope.dispose();
      other.scope.dispose();
    });

for (const mode of ['hidden', 'locked', 'outside', 'missing', 'cubic'])
  it(`excludes original ${mode} roots without enabling scope`, () => {
    const p = fixture();
    if (mode === 'hidden') p.layers[0].visible = false;
    if (mode === 'locked') p.layers[0].locked = true;
    if (mode === 'cubic') delete p.layers[0].liveMotionSpans![0].path!.waypoints;
    const scope = capture(() => ({ project: p, revision: 7, frame: mode === 'outside' ? 11 : 6 }));
    if (mode !== 'missing') expect(scope.choices).toEqual([]);
    expect(() =>
      scope.resolve('track', 'live', mode === 'missing' ? 'missing' : 'instance', 0),
    ).toThrow();
    scope.dispose();
  });
for (const mode of [
  'projectGetter',
  'projectPrototype',
  'nonfinite',
  'hiddenField',
  'sourceGetter',
])
  it(`rejects original ${mode} before getter reads`, () => {
    const p = fixture();
    let reads = 0;
    const reader = () => ({ project: p, revision: 7, frame: 6 });
    if (mode === 'projectGetter')
      Object.defineProperty(p.symbols![0], 'shapes', {
        enumerable: true,
        get() {
          reads++;
          return [];
        },
      });
    if (mode === 'projectPrototype') Object.setPrototypeOf(p.symbols![0], { extra: 1 });
    if (mode === 'nonfinite') p.symbols![1].shapes[0].x = NaN;
    if (mode === 'hiddenField') Object.defineProperty(p.symbols![0], 'hidden', { value: 1 });
    const source = reader();
    if (mode === 'sourceGetter')
      Object.defineProperty(source, 'project', {
        enumerable: true,
        get() {
          reads++;
          return p;
        },
      });
    expect(() => capture(() => source)).toThrow();
    expect(reads).toBe(0);
  });
for (const when of ['first', 'current'])
  it(`poisons swallowed ${when} reader reentry`, () => {
    const p = fixture();
    let armed = when === 'first',
      scope: ReturnType<typeof capture> | undefined;
    const reader = () => {
      if (armed) {
        armed = false;
        try {
          if (scope) scope.assertCurrent();
          else capture(reader);
        } catch {}
      }
      return { project: p, revision: 7, frame: 6 };
    };
    if (when === 'first') expect(() => capture(reader)).toThrow(/reent/);
    else {
      scope = capture(reader);
      const owner = scope.resolve('track', 'live', 'instance', 0);
      armed = true;
      expect(() => prepare([{ owner, target: target(owner) }])).toThrow(/reent|changed/);
      scope.dispose();
    }
  });
for (const mode of ['holes', 'arrayPrototype', 'arrayExtra', 'ownerGetter'])
  it(`rejects raw ${mode} requests without reading source`, () => {
    const p = fixture(),
      { scope, owner } = operation(p);
    let reads = 0;
    const r = { owner, target: target(owner) },
      rows: Request[] = [r];
    if (mode === 'holes') rows.length = 2;
    if (mode === 'arrayPrototype') Object.setPrototypeOf(rows, Object.create(Array.prototype));
    if (mode === 'arrayExtra') Object.assign(rows, { extra: true });
    if (mode === 'ownerGetter')
      Object.defineProperty(r, 'owner', {
        enumerable: true,
        get() {
          reads++;
          return owner;
        },
      });
    expect(() => prepare(rows)).toThrow();
    expect(reads).toBe(0);
    scope.dispose();
  });
it('rejects later stationary and finite overflowing targets atomically and permits valid retry', () => {
  const p = fixture(true);
  for (const layer of p.layers)
    Object.assign(layer.liveMotionSpans![0].path!, { curvedWaypoints: true, tangent: true });
  const before = structuredClone(p),
    { scope, owner } = operation(p),
    later = scope.resolve('later', 'live', 'instance', 0);
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: later, target: { x: 20, y: 30 } },
    ]),
  ).toThrow();
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: later, target: { x: Number.MAX_VALUE, y: 60 } },
    ]),
  ).toThrow();
  expect(p).toEqual(before);
  expect(prepare([{ owner, target: target(owner) }]).layers[0].keys).toEqual(p.layers[0].keys);
  scope.dispose();
});
for (const mode of ['snapshot', 'hints'])
  it(`rejects detached ${mode} tampering without public ownership`, () => {
    const p = fixture(),
      before = structuredClone(p),
      native = structuredClone,
      old = mode === 'hints' ? operation(p) : undefined;
    let hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value);
      if (
        !hit &&
        (mode === 'snapshot' ? value === p : Array.isArray(out) && out[0]?.waypointCount)
      ) {
        hit = true;
        if (mode === 'snapshot') (out as Project).name = 'changed clone';
        else (out as { waypointCount: number }[])[0].waypointCount++;
      }
      return out;
    });
    expect(() =>
      mode === 'hints'
        ? old!.scope.choices
        : capture(() => ({ project: p, revision: 7, frame: 6 })),
    ).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
    vi.unstubAllGlobals();
    if (old) {
      expect(prepare([{ owner: old.owner, target: target(old.owner) }]).symbols).toEqual(p.symbols);
      old.scope.dispose();
    }
  });
for (const mode of ['loop', 'once', 'single'] as const)
  it(`retains original ${mode} intermediary blank/reentry clock structure`, async () => {
    const p = treeSplitFixture('reflected', mode);
    p.layers[0].liveMotionSpans![0].path = structuredClone(route);
    const before = structuredClone(p),
      { scope, owner } = operation(p),
      out = prepare([{ owner, target: target(owner) }]);
    expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(p));
    expect(out.layers[0].keys).toEqual(p.layers[0].keys);
    expect(out.symbols).toEqual(p.symbols);
    const a = captureMoviePoseClock(() => ({ project: p, revision: 0 })),
      b = captureMoviePoseClock(() => ({ project: out, revision: 0 }));
    try {
      for (const f of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const x = await prepareLiveMotionFrameCapture(() => ({ project: p, revision: 0 }), f),
          y = await prepareLiveMotionFrameCapture(() => ({ project: out, revision: 0 }), f);
        expect(b.replay(b.capture(y), f).frames).toEqual(a.replay(a.capture(x), f).frames);
      }
    } finally {
      a.dispose();
      b.dispose();
      scope.dispose();
    }
    expect(p).toEqual(before);
  });
it('keeps lazy original root/count hints without roots-times-waypoints expansion', () => {
  const p = fixture();
  for (const key of p.layers[0].keys)
    if (key.shapes.length) {
      const a = key.shapes[0];
      key.shapes = Array.from({ length: 64 }, (_, i) => ({
        ...structuredClone(a),
        id: 'root' + i,
        x: a.x + i,
      }));
    }
  p.layers[0].liveMotionSpans![0].path!.waypoints = Array.from({ length: 128 }, (_, i) => ({
    x: 20 + i,
    y: 30 + (i % 2),
  }));
  const scope = capture(() => ({ project: p, revision: 7, frame: 6 })),
    hints = scope.choices;
  expect(hints).toHaveLength(64);
  expect(hints.every((h) => h.waypointCount === 128 && !('point' in h))).toBe(true);
  const a = scope.resolve('track', 'live', 'root0', 0),
    b = scope.resolve('track', 'live', 'root63', 127);
  expect(a.shapeIds).toBe(b.shapeIds);
  expect(a.shapeIds).toHaveLength(64);
  expect(b.point).toEqual({ x: 230, y: 61 });
  scope.dispose();
});

it('retains exact original root/cubic scopes and rejects actual cross-brand handles', () => {
  const p = fixture(),
    nested = operation(p);
  const root = captureLiveWaypoints(() => ({ project: p, revision: 7, frame: 6 })),
    cubic = captureLiveMovieTreeCubicControls(() => ({ project: p, revision: 7, frame: 6 }));
  expect(root.choices).toEqual([]);
  expect(cubic.choices).toEqual([]);
  const q = liveSplitFixture((_p, span) => {
      span.path = structuredClone(route);
    }),
    r = captureLiveWaypoints(() => ({ project: q, revision: 0, frame: 4 })),
    o = r.resolve('track', 'live', 'art', 0);
  expect(() => prepare([{ owner: o as never, target: target(o) }])).toThrow();
  const c = fixture();
  delete c.layers[0].liveMotionSpans![0].path!.waypoints;
  const v = captureLiveMovieTreeCubicControls(() => ({ project: c, revision: 0, frame: 6 })),
    h = v.resolve('track', 'live', 'instance', 'start');
  expect(() =>
    prepare([{ owner: h as never, target: { x: h.point.x + 10, y: h.point.y + 10 } }]),
  ).toThrow();
  expect(capture(() => ({ project: q, revision: 0, frame: 4 })).choices).toEqual([]);
  expect(prepareLiveWaypointPositions([{ owner: o, target: target(o) }]).layers[0].keys).toEqual(
    q.layers[0].keys,
  );
  for (const scope of [nested.scope, root, cubic, r, v]) scope.dispose();
});
for (const phase of ['firstReader', 'editedReader'])
  it(`rejects admission callback replacement at ${phase} without calling replacement`, () => {
    const p = fixture();
    let armed = false,
      edited = false,
      hit = false;
    const replacement = vi.fn(),
      options: { validate?: () => void } = { validate: () => {} };
    const scope = capture(() => {
        if (armed && !hit && (phase === 'firstReader' || edited)) {
          hit = true;
          options.validate = replacement;
        }
        return { project: p, revision: 7, frame: 6 };
      }),
      owner = scope.resolve('track', 'live', 'instance', 0),
      native = structuredClone;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value);
      if ((out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30)
        edited = true;
      return out;
    });
    armed = true;
    expect(() => prepare([{ owner, target: target(owner) }], options)).toThrow(/callback changed/);
    expect(hit).toBe(true);
    expect(replacement).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    expect(prepare([{ owner, target: target(owner) }]).symbols).toEqual(p.symbols);
    scope.dispose();
  });
for (const mode of ['prototype', 'getter', 'sourceLibrary'])
  it(`rejects actual final output ${mode} mutation after clone without source loss`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      native = structuredClone;
    let hit = false,
      reads = 0;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value),
        q = out as Project,
        stack = new Error().stack ?? '';
      if (
        !hit &&
        q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30 &&
        stack.includes('prepareLiveMovieTreeWaypointPositions') &&
        !stack.includes('prepareUpdateLiveMotionSpans')
      ) {
        hit = true;
        if (mode === 'prototype')
          Object.setPrototypeOf(q.layers[0].keys[1].shapes[0], { extra: 1 });
        if (mode === 'getter')
          Object.defineProperty(q.layers[0].keys[1].shapes[0], 'x', {
            enumerable: true,
            get() {
              reads++;
              return 20;
            },
          });
        if (mode === 'sourceLibrary') p.symbols![0].name = 'actual independent library edit';
      }
      return out;
    });
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    expect(hit).toBe(true);
    expect(reads).toBe(0);
    if (mode === 'sourceLibrary') before.symbols![0].name = p.symbols![0].name;
    expect(p).toEqual(before);
    vi.unstubAllGlobals();
    const fresh = mode === 'sourceLibrary' ? operation(p) : undefined,
      o = fresh?.owner ?? owner;
    expect(prepare([{ owner: o, target: target(o) }]).symbols).toEqual(p.symbols);
    fresh?.scope.dispose();
    scope.dispose();
  });
it('allows off-view document targets without clamping or enabling recipe options', () => {
  const p = fixture(),
    before = structuredClone(p),
    { scope, owner } = operation(p),
    out = prepare([{ owner, target: { x: -300, y: 800 } }]),
    expected = structuredClone(p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[0] = { x: -320, y: 770 };
  expect(out).toEqual(expected);
  expect(p).toEqual(before);
  scope.dispose();
});
it('admits actual nested-owner aggregate capacity and rejects next original/output artwork', () => {
  const p = fixture(),
    a: Vector = {
      id: 'saved',
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
    };
  const count = (p: Project) =>
    p.symbols!.reduce(
      (n, d) =>
        n + d.shapes.length + (d.timeline?.keys.reduce((a, k) => a + k.shapes.length, 0) ?? 0),
      0,
    );
  p.symbols!.push({
    id: 'capacity',
    name: 'Capacity',
    width: 1,
    height: 1,
    shapes: Array.from({ length: MAX_SYMBOL_ARTWORK - count(p) }, (_, i) => ({
      ...a,
      id: 'saved' + i,
    })),
  });
  validateProject(p);
  expect(count(p)).toBe(MAX_SYMBOL_ARTWORK);
  const { scope, owner } = operation(p),
    out = prepare([{ owner, target: target(owner) }]);
  expect(out.symbols).toEqual(p.symbols);
  expect(out.layers[0].keys).toEqual(p.layers[0].keys);
  scope.dispose();
  p.symbols![p.symbols!.length - 1].shapes.push({ ...a, id: 'overflow' });
  expect(() => operation(p)).toThrow(/budget/);
  const q = fixture(),
    before = structuredClone(q),
    fresh = operation(q),
    native = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const output = native(value),
      edited = output as Project,
      stack = new Error().stack ?? '';
    if (
      !hit &&
      edited?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30 &&
      stack.includes('prepareLiveMovieTreeWaypointPositions') &&
      !stack.includes('prepareUpdateLiveMotionSpans')
    ) {
      hit = true;
      edited.symbols!.push({
        id: 'capacity',
        name: 'Capacity',
        width: 1,
        height: 1,
        shapes: Array.from({ length: MAX_SYMBOL_ARTWORK - count(edited) + 1 }, (_, i) => ({
          ...a,
          id: 'overflow' + i,
        })),
      });
      expect(count(edited)).toBe(MAX_SYMBOL_ARTWORK + 1);
    }
    return output;
  });
  expect(() => prepare([{ owner: fresh.owner, target: target(fresh.owner) }])).toThrow(/budget/);
  expect(hit).toBe(true);
  expect(q).toEqual(before);
  vi.unstubAllGlobals();
  expect(prepare([{ owner: fresh.owner, target: target(fresh.owner) }]).layers[0].keys).toEqual(
    q.layers[0].keys,
  );
  fresh.scope.dispose();
}, 180000);

it('detaches returned projects and library artwork from source, private capture and later preparations', () => {
  const p = fixture(),
    before = structuredClone(p),
    { scope, owner } = operation(p),
    out = prepare([{ owner, target: target(owner) }]);
  out.symbols![1].shapes[0].x = 999;
  out.layers[0].keys[1].shapes[0].x = 999;
  (out.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[0].x = 999;
  expect(p).toEqual(before);
  expect(scope.resolve('track', 'live', 'instance', 0).point).toEqual({ x: 40, y: 60 });
  const again = prepare([{ owner, target: target(owner) }]),
    expected = structuredClone(p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[0] = { x: 30, y: 40 };
  expect(again).toEqual(expected);
  scope.dispose();
});
for (const phase of [1, 2])
  it(`rejects independently corrupted candidate/output clock certification phase ${phase}`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      compile = clockPlans.compileMovieClockPlan;
    let count = 0,
      hit = false;
    vi.spyOn(clockPlans, 'compileMovieClockPlan').mockImplementation((project) => {
      const plan = compile(project),
        stack = new Error().stack ?? '';
      if (
        stack.includes('prepareLiveMovieTreeWaypointPositions') &&
        !stack.includes('prepareUpdateLiveMotionSpans') &&
        project.layers[0].liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30 &&
        ++count === phase
      ) {
        hit = true;
        Object.assign(plan, { corrupted: true });
      }
      return plan;
    });
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow(/topology/);
    expect(hit).toBe(true);
    expect(p).toEqual(before);
    vi.restoreAllMocks();
    expect(prepare([{ owner, target: target(owner) }]).symbols).toEqual(p.symbols);
    scope.dispose();
  });

it('rejects inherited callback admission before any original source reader runs', () => {
  const p = fixture(),
    reader = vi.fn(() => ({ project: p, revision: 7, frame: 6 })),
    scope = capture(reader),
    owner = scope.resolve('track', 'live', 'instance', 0);
  reader.mockClear();
  let reads = 0;
  const options = Object.create(
    Object.defineProperty({}, 'validate', {
      enumerable: true,
      get() {
        reads++;
        return () => {};
      },
    }),
  ) as { validate?: () => void };
  expect(() => prepare([{ owner, target: target(owner) }], options)).toThrow();
  expect(reads).toBe(0);
  expect(reader).not.toHaveBeenCalled();
  scope.dispose();
});
it('rejects changed callback prototype after validation without reading source', () => {
  const p = fixture(),
    before = structuredClone(p),
    reader = vi.fn(() => ({ project: p, revision: 7, frame: 6 })),
    scope = capture(reader),
    owner = scope.resolve('track', 'live', 'instance', 0);
  reader.mockClear();
  const options = {
    validate: () => {
      Object.setPrototypeOf(options, { external: true });
    },
  };
  expect(() => prepare([{ owner, target: target(owner) }], options)).toThrow();
  expect(reader).not.toHaveBeenCalled();
  expect(p).toEqual(before);
  scope.dispose();
});
it('preserves explicitly null-prototype original admission options', () => {
  const { scope, owner } = operation(),
    validate = vi.fn(),
    options = Object.assign(Object.create(null), { validate });
  expect(
    prepare([{ owner, target: target(owner) }], options).layers[0].liveMotionSpans![0].path!
      .waypoints![0],
  ).toEqual({ x: 30, y: 40 });
  expect(validate).toHaveBeenCalled();
  scope.dispose();
});

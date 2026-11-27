import { liveRotationFixture } from './live-motion-rotation-fixture';
import {
  captureLiveGroupCubicControls,
  prepareLiveGroupCubicControlPositions,
  type LiveGroupCubicControlOwner,
} from '../packages/animation/src/live-group-cubic-controls';
import { expect, it, vi } from 'vitest';
import {
  captureLiveMovieTreeCubicControls as capture,
  prepareLiveMovieTreeCubicControlPositions as prepare,
  type LiveMovieTreeCubicControlOwner as LiveCubicControlOwner,
  type LiveMovieTreeCubicControlRequest as LiveCubicControlRequest,
} from '../packages/animation/src/live-movie-tree-cubic-controls';
import {
  captureLiveCubicControls,
  prepareLiveCubicControlPositions,
  type LiveCubicControlOwner as LegacyOwner,
} from '../packages/animation/src/live-cubic-controls';
import {
  captureLiveMovieTreeMotionAuthoringFrame,
  prepareSplitLiveMovieTreeMotionSpans,
  type LiveMovieTreeOwner,
} from '../packages/animation/src/live-movie-tree-motion-owner';
import { liveTreeFixture, createLiveMovieTrees } from './live-tree-edit-fixture';
import { liveSplitFixture } from './live-motion-split-fixture';
import { treeSplitFixture } from './live-tree-split-fixture';
import { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import * as clockPlans from '../packages/animation/src/movie-clock-plan';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import { evaluate } from '../packages/animation/src';
import { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
import { captureMoviePoseClock } from '../packages/animation/src/movie-pose-clock';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { MAX_SYMBOL_ARTWORK, type Point, type Project } from '../packages/document/src';
const arch = { startX: 0, startY: 40, endX: 0, endY: 40 };
function fixture(two = false, basis = 'plain', first = 1) {
  const { p, span } = liveTreeFixture(first, basis);
  span.path = { ...arch };
  const out = createLiveMovieTrees(p, span);
  if (two) out.layers.push({ ...structuredClone(out.layers[0]), id: 'later' });
  return out;
}
function operation(p = fixture(), frame = 6, role: 'start' | 'end' = 'start', shape = 'instance') {
  const view = capture(() => ({ project: p, revision: 7, frame })),
    owner = view.resolve('track', 'live', shape, role);
  return { view, owner };
}
const target = (o: LiveCubicControlOwner): Point => ({ x: o.point.x + 10, y: o.point.y + 10 });
for (const first of [0, 1, 9998])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const role of ['start', 'end'] as const)
      it(`owns ${role}/${first}/${basis} original endpoint offsets and exact nested clocks`, async () => {
        const p = fixture(false, basis, first),
          before = structuredClone(p),
          { view, owner } = operation(p, 6, role),
          out = prepare([{ owner, target: target(owner) }]),
          want = structuredClone(p);
        const key = p.layers[0].keys.find((k) => k.frame === (role === 'start' ? 2 : 10))!,
          origin = key.shapes[0];
        expect(owner.point).toEqual({ x: origin.x, y: origin.y + 40 });
        Object.assign(
          want.layers[0].liveMotionSpans![0].path!,
          role === 'start' ? { startX: 10, startY: 50 } : { endX: 10, endY: 50 },
        );
        expect(out).toEqual(want);
        expect(p).toEqual(before);
        expect(out.symbols).toEqual(p.symbols);
        expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(p));
        const a = captureLiveMotionTimeline(() => ({ project: out, revision: 0 })),
          clock = captureMoviePoseClock(() => ({ project: out, revision: 0 }));
        try {
          for (const f of [2, 4, 6, 8, 10]) {
            const t = (f - 2) / 8,
              u = 1 - t,
              dx = role === 'start' ? 10 : 0,
              ex = role === 'end' ? 10 : 0,
              dy = role === 'start' ? 50 : 40,
              ey = role === 'end' ? 50 : 40,
              x =
                u * u * u * 20 +
                3 * u * u * t * (20 + dx) +
                3 * u * t * t * (100 + ex) +
                t * t * t * 100,
              y =
                u * u * u * 30 +
                3 * u * u * t * (30 + dy) +
                3 * u * t * t * (70 + ey) +
                t * t * t * 70,
              pose = a.sample(f);
            expect(pose[0].key.shapes[0].x).toBeCloseTo(x, 10);
            expect(pose[0].key.shapes[0].y).toBeCloseTo(y, 10);
            const root = pose[0].key.shapes[0],
              render = await prepareLiveMotionFrameCapture(
                () => ({ project: out, revision: 0 }),
                f,
              ),
              time = clock.replay(clock.capture(render), f),
              leaf = mapPoint(matrix(evaluate(render, f, time.frames)[0]), { x: 0, y: 0 });
            const pt = mapPoint(matrix(root), { x: ((1 + f - 2) % 3) * 10, y: 0 });
            expect(leaf.x).toBeCloseTo(pt.x, 9);
            expect(leaf.y).toBeCloseTo(pt.y, 9);
          }
        } finally {
          a.dispose();
          clock.dispose();
          view.dispose();
        }
        out.layers[0].liveMotionSpans![0].path!.startX = 900;
        expect(p).toEqual(before);
      });
for (const frame of [2, 3, 9, 10])
  for (const role of ['start', 'end'] as const)
    it(`owns existing ${role} at ${frame} without split-space restrictions`, () => {
      const { view, owner } = operation(fixture(), frame, role);
      expect(
        prepare([{ owner, target: target(owner) }]).layers[0].keys.map((k) => k.frame),
      ).toEqual([0, 2, 10, 12]);
      view.dispose();
      expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
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
  it(`rejects raw ${mode} targets without source writes`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { view, owner } = operation(p);
    let reads = 0;
    const r = { owner, target: target(owner) };
    if (mode === 'NaN') r.target.x = NaN;
    if (mode === 'Infinity') r.target.y = Infinity;
    if (mode === 'getter')
      Object.defineProperty(r.target, 'x', {
        enumerable: true,
        get() {
          reads++;
          return 18;
        },
      });
    if (mode === 'inherited') {
      delete (r as Partial<typeof r>).target;
      Object.setPrototypeOf(r, {
        get target() {
          reads++;
          return { x: 18, y: 62 };
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
    view.dispose();
  });

for (const mode of [
  'input',
  'async',
  'reentry',
  'callbackGetter',
  'lateCandidate',
  'lateReaderTarget',
  'lateReaderSource',
])
  it(`rejects asserted ${mode} admission and preserves valid source-owned retries`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let requests: LiveCubicControlRequest[] = [];
    let candidate: Project | undefined,
      hit = false,
      once = true;
    const view = capture(() => {
        const stack = new Error().stack ?? '';
        if (
          (mode === 'lateReaderTarget' || mode === 'lateReaderSource') &&
          candidate &&
          !hit &&
          stack.includes('prepareLiveMovieTreeCubicControlPositions') &&
          !stack.includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          if (mode === 'lateReaderSource') p.name = 'Separate late source edit';
          else requests[0].target.x++;
        }
        return { project: p, revision: 0, frame: 4 };
      }),
      owner = view.resolve('track', 'live', 'instance', 'start');
    requests = [{ owner, target: { x: 30, y: 90 } }];
    const clone = structuredClone;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v);
      if ((out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startY === 60)
        candidate = out as Project;
      return out;
    });
    const options = {
      validate: () => {
        const stack = new Error().stack ?? '';
        if (
          mode === 'lateCandidate' &&
          candidate &&
          !hit &&
          stack.includes('prepareLiveMovieTreeCubicControlPositions') &&
          !stack.includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          candidate.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].x = 900;
        }
        if (!once) return;
        once = false;
        if (mode === 'input') {
          hit = true;
          requests[0].target.y++;
        }
        if (mode === 'async') {
          hit = true;
          return Promise.resolve() as unknown as void;
        }
        if (mode === 'reentry') {
          hit = true;
          try {
            prepare(requests);
          } catch {
            /* swallowed reentry still poisons outer operation */
          }
        }
      },
    };
    if (mode === 'callbackGetter')
      Object.defineProperty(options, 'validate', {
        get() {
          hit = true;
          throw Error('Getter must not run');
        },
      });
    try {
      expect(() => prepare(requests, options)).toThrow();
      expect(hit).toBe(mode !== 'callbackGetter');
      if (mode === 'lateReaderSource') before.name = 'Separate late source edit';
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
    const fresh = mode === 'lateReaderSource' ? operation(p) : undefined;
    expect(
      prepare([{ owner: fresh?.owner ?? owner, target: { x: 30, y: 90 } }]).layers[0]
        .liveMotionSpans![0].path,
    ).toEqual({ ...arch, startX: 10, startY: 60 });
    fresh?.view.dispose();
    view.dispose();
  });

for (const mode of [
  'absent',
  'waypoints',
  'locked',
  'hidden',
  'outside',
  'role',
  'plain',
  'movies',
  'group',
] as const)
  it(`rejects unsupported ${mode} control ownership`, () => {
    const p = fixture();
    if (mode === 'absent') delete p.layers[0].liveMotionSpans![0].path;
    if (mode === 'waypoints') p.layers[0].liveMotionSpans![0].path!.waypoints = [];
    if (mode === 'locked') p.layers[0].locked = true;
    if (mode === 'hidden') p.layers[0].visible = false;
    if (mode === 'plain') delete p.layers[0].liveMotionSpans![0].symbolContinuity;
    if (mode === 'movies') p.layers[0].liveMotionSpans![0].symbolContinuity = 'movies';
    if (mode === 'group')
      for (const k of p.layers[0].keys) for (const shape of k.shapes) shape.groups = ['g'];
    expect(() => {
      const view = capture(() => ({ project: p, revision: 0, frame: mode === 'outside' ? 0 : 6 }));
      try {
        view.resolve('track', 'live', 'instance', mode === 'role' ? ('bad' as 'start') : 'start');
      } finally {
        view.dispose();
      }
    }).toThrow();
  });
for (const field of ['frame', 'revision', 'identity', 'source', 'library', 'dispose'] as const)
  it(`rejects stale ${field} ownership`, () => {
    const state = { project: fixture(), revision: 0, frame: 6 },
      view = capture(() => state),
      owner = view.resolve('track', 'live', 'instance', 'start');
    if (field === 'frame') state.frame++;
    if (field === 'revision') state.revision++;
    if (field === 'identity') state.project = structuredClone(state.project);
    if (field === 'source') state.project.name = 'changed';
    if (field === 'library') state.project.symbols![1].shapes[0].x++;
    if (field === 'dispose') view.dispose();
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    view.dispose();
  });
it('shares frozen complete membership across movie roots, never plain companions or public hints', () => {
  const p = fixture();
  for (const k of p.layers[0].keys)
    if (k.shapes.length) {
      k.shapes.push({ ...structuredClone(k.shapes[0]), id: 'other', x: k.shapes[0].x + 30 });
      k.shapes.push({ ...structuredClone(p.symbols![1].shapes[0]), id: 'plain', x: 200 });
    }
  const { view, owner } = operation(p),
    other = view.resolve('track', 'live', 'other', 'end');
  expect(other.shapeIds).toBe(owner.shapeIds);
  expect(Object.isFrozen(owner.shapeIds)).toBe(true);
  expect(owner.shapeIds).toEqual(['instance', 'other', 'plain']);
  expect(() => view.resolve('track', 'live', 'plain', 'start')).toThrow();
  const hints = view.choices;
  hints[0].point.x = 999;
  expect(view.choices[0].point.x).toBe(owner.point.x);
  expect(() => prepare([{ owner: { ...owner }, target: target(owner) }])).toThrow();
  expect(() =>
    prepare([{ owner: JSON.parse(JSON.stringify(owner)), target: target(owner) }]),
  ).toThrow();
  view.dispose();
});
it('prepares all tracks together and rejects duplicate/cross-scope requests atomically', () => {
  const p = fixture(true),
    before = structuredClone(p),
    { view, owner } = operation(p),
    other = view.resolve('later', 'live', 'instance', 'end'),
    out = prepare([
      { owner, target: target(owner) },
      { owner: other, target: target(other) },
    ]);
  expect(
    out.layers.every(
      (l) => l.liveMotionSpans![0].path!.startX === 10 || l.liveMotionSpans![0].path!.endX === 10,
    ),
  ).toBe(true);
  expect(p).toEqual(before);
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: other, target: { x: NaN, y: 0 } },
    ]),
  ).toThrow();
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner, target: target(owner) },
    ]),
  ).toThrow();
  const foreign = operation(p);
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: foreign.owner, target: target(foreign.owner) },
    ]),
  ).toThrow();
  view.dispose();
  foreign.view.dispose();
});
it('keeps legacy root and nested split brands separate in both directions', () => {
  const p = fixture(),
    { view, owner } = operation(p),
    legacySource = liveSplitFixture((_p, s) => (s.path = { ...arch })),
    legacy = captureLiveCubicControls(() => ({ project: legacySource, revision: 0, frame: 4 })),
    old = legacy.resolve('track', 'live', 'art', 'start'),
    split = captureLiveMovieTreeMotionAuthoringFrame(() => ({ project: p, revision: 0, frame: 6 })),
    pick = split.resolve('track', 'instance');
  expect(() =>
    prepare([{ owner: old as unknown as LiveCubicControlOwner, target: { x: 0, y: 0 } }]),
  ).toThrow();
  expect(() =>
    prepareLiveCubicControlPositions([
      { owner: owner as unknown as LegacyOwner, target: target(owner) },
    ]),
  ).toThrow();
  expect(() =>
    prepare([{ owner: pick as unknown as LiveCubicControlOwner, target: { x: 0, y: 0 } }]),
  ).toThrow();
  expect(() =>
    prepareSplitLiveMovieTreeMotionSpans([
      { owner: owner as unknown as LiveMovieTreeOwner, rightSpanId: 'right' },
    ]),
  ).toThrow();
  const unavailable = captureLiveCubicControls(() => ({ project: p, revision: 0, frame: 6 }));
  expect(unavailable.choices).toEqual([]);
  unavailable.dispose();
  expect(
    prepareLiveCubicControlPositions([{ owner: old, target: { x: 18, y: 62 } }]),
  ).toBeDefined();
  view.dispose();
  legacy.dispose();
  split.dispose();
});
it('reopens edited candidates and retains untouched path settings and saved source', () => {
  const p = fixture();
  Object.assign(p.layers[0].liveMotionSpans![0].path!, {
    distance: false,
    tangent: false,
    headingOffset: undefined,
  });
  const { view, owner } = operation(p),
    out = prepare([{ owner, target: target(owner) }]),
    reopened = JSON.parse(JSON.stringify(out)) as Project,
    next = operation(reopened, 6, 'end'),
    again = prepare([{ owner: next.owner, target: target(next.owner) }]);
  expect(again.layers[0].liveMotionSpans![0].path).toEqual({
    ...arch,
    startX: 10,
    startY: 50,
    endX: 10,
    endY: 50,
    distance: false,
    tangent: false,
    headingOffset: undefined,
  });
  expect(again.layers[0].keys).toEqual(p.layers[0].keys);
  view.dispose();
  next.view.dispose();
});
for (const when of ['first', 'current'] as const)
  it(`poisons swallowed ${when} reader reentry`, () => {
    const p = fixture();
    let armed = when === 'first',
      view: ReturnType<typeof capture> | undefined;
    const reader = () => {
      if (armed) {
        armed = false;
        try {
          if (view) view.assertCurrent();
          else capture(reader);
        } catch {}
      }
      return { project: p, revision: 0, frame: 6 };
    };
    if (when === 'first') expect(() => capture(reader)).toThrow(/reent/);
    else {
      view = capture(reader);
      const owner = view.resolve('track', 'live', 'instance', 'start');
      armed = true;
      expect(() => prepare([{ owner, target: target(owner) }])).toThrow(/reent|changed/);
      view.dispose();
    }
  });

for (const phase of ['capture', 'public', 'candidate', 'output'] as const)
  for (const damage of ['coordinate', 'prototype'] as const)
    it(`rejects ${phase} ${damage} clone corruption before private output escapes`, () => {
      const p = fixture(),
        before = structuredClone(p),
        clone = structuredClone;
      let hit = false;
      let op: ReturnType<typeof operation> | undefined;
      if (phase !== 'capture') op = operation(p);
      vi.stubGlobal('structuredClone', (value: unknown) => {
        const out = clone(value),
          project = out as Project;
        const scope =
          (phase === 'capture' && project?.layers !== undefined) ||
          (phase === 'public' &&
            Array.isArray(out) &&
            out.length > 0 &&
            out[0]?.point !== undefined) ||
          ((phase === 'candidate' || phase === 'output') &&
            project?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startY === 50 &&
            new Error().stack?.includes('prepareLiveMovieTreeCubicControlPositions') &&
            !new Error().stack?.includes('prepareUpdateLiveMotionSpans'));
        if (scope && !hit) {
          hit = true;
          const row =
            phase === 'public'
              ? (out as { point: Point }[])[0]
              : (phase === 'candidate' ? (value as Project) : project).layers[0];
          if (damage === 'prototype') Object.setPrototypeOf(row, { late: true });
          else if (phase === 'public') (row as { point: Point }).point.x++;
          else (row as Project['layers'][number]).name += ' corrupted';
        }
        return out;
      });
      try {
        expect(() => {
          if (phase === 'capture') operation(p);
          else if (phase === 'public') void op!.view.choices;
          else prepare([{ owner: op!.owner, target: target(op!.owner) }]);
        }).toThrow();
        expect(hit).toBe(true);
        expect(p).toEqual(before);
      } finally {
        vi.unstubAllGlobals();
        op?.view.dispose();
      }
      const fresh = operation(p);
      expect(prepare([{ owner: fresh.owner, target: target(fresh.owner) }])).toBeDefined();
      fresh.view.dispose();
    });
for (const change of ['inputPrototype', 'source', 'library', 'output', 'outputPrototype'] as const)
  it(`rejects asserted final ${change} after complete edited cloning`, () => {
    const p = fixture(),
      before = structuredClone(p),
      clone = structuredClone;
    let candidate: Project | undefined,
      hit = false;
    const { view, owner } = operation(p),
      requests = [{ owner, target: target(owner) }];
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v);
      if ((out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startY === 50)
        candidate = out as Project;
      return out;
    });
    try {
      expect(() =>
        prepare(requests, {
          validate: () => {
            const stack = new Error().stack ?? '';
            if (!candidate || hit || stack.includes('prepareUpdateLiveMotionSpans')) return;
            hit = true;
            if (change === 'inputPrototype') Object.setPrototypeOf(requests[0], { late: true });
            if (change === 'source') p.name = 'late source';
            if (change === 'library') p.symbols![1].shapes[0].x++;
            if (change === 'output') candidate.layers[0].name = 'late output';
            if (change === 'outputPrototype')
              Object.setPrototypeOf(candidate.layers[0], { late: true });
          },
        }),
      ).toThrow();
      expect(hit).toBe(true);
      if (change === 'source') before.name = 'late source';
      if (change === 'library') before.symbols![1].shapes[0].x++;
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
      view.dispose();
    }
    const fresh = operation(p);
    expect(prepare([{ owner: fresh.owner, target: target(fresh.owner) }])).toBeDefined();
    fresh.view.dispose();
  });
for (const inherited of [false, true])
  it(`rejects callback accessors with zero reads, inherited ${inherited}`, () => {
    const { view, owner } = operation();
    let reads = 0;
    const options = {} as { validate?: () => void };
    const descriptor = {
      get() {
        reads++;
        return () => {};
      },
      enumerable: true,
    };
    if (inherited)
      Object.setPrototypeOf(options, Object.defineProperty({}, 'validate', descriptor));
    else Object.defineProperty(options, 'validate', descriptor);
    expect(() => prepare([{ owner, target: target(owner) }], options)).toThrow();
    expect(reads).toBe(0);
    view.dispose();
  });
for (const kind of ['sparse', 'extra', 'getter'] as const)
  it(`rejects ${kind} request arrays without getter reads`, () => {
    const { view, owner } = operation();
    let reads = 0;
    const requests = [{ owner, target: target(owner) }];
    if (kind === 'sparse') requests.length = 2;
    if (kind === 'extra') Object.assign(requests, { unexpected: 1 });
    if (kind === 'getter')
      Object.defineProperty(requests, '0', {
        enumerable: true,
        get() {
          reads++;
          return { owner, target: target(owner) };
        },
      });
    expect(() => prepare(requests)).toThrow();
    expect(reads).toBe(0);
    view.dispose();
  });
it('preserves existing distance/tangent guards and rejects overflowing candidate preparation', () => {
  const p = fixture();
  Object.assign(p.layers[0].liveMotionSpans![0].path!, {
    distance: true,
    tangent: true,
    headingOffset: 10,
    headingOffsetEnd: 20,
  });
  const { view, owner } = operation(p),
    before = structuredClone(p);
  expect(() => prepare([{ owner, target: { x: Number.MAX_VALUE, y: owner.point.y } }])).toThrow();
  expect(p).toEqual(before);
  view.dispose();
});
it('admits the actual aggregate capacity and rejects its next stored artwork', () => {
  const p = fixture(),
    art = p.symbols![1].shapes[0];
  p.symbols!.push({
    id: 'capacity',
    name: 'Capacity',
    width: 4,
    height: 4,
    shapes: Array.from({ length: MAX_SYMBOL_ARTWORK - 4 }, (_, i) => ({
      ...art,
      id: 'art' + i,
      points: [],
    })),
  });
  const { view, owner } = operation(p),
    out = prepare([{ owner, target: target(owner) }]);
  expect(out.symbols).toEqual(p.symbols);
  expect(out.layers[0].keys).toEqual(p.layers[0].keys);
  view.dispose();
  p.symbols![1].shapes.push({ ...art, id: 'overflow' });
  expect(() => operation(p)).toThrow(/budget/);
}, 180000);

for (const bridge of ['loop', 'once', 'single'] as const)
  for (const role of ['start', 'end'] as const)
    it(`keeps independent ${bridge}/${role} intermediary blank and reentry lifetimes`, async () => {
      const p = treeSplitFixture('reflected', bridge);
      p.layers[0].liveMotionSpans![0].path = { ...arch };
      const before = structuredClone(p),
        { view, owner } = operation(p, 6, role),
        out = prepare([{ owner, target: target(owner) }]),
        clock = captureMoviePoseClock(() => ({ project: p, revision: 0 }));
      const visible = (f: number) => {
        const parent = (1 + f - 2) % 5,
          local = bridge === 'single' ? 0 : bridge === 'once' ? Math.min(parent, 3) : parent % 4;
        return f >= 2 && f < 12 && local !== 2;
      };
      let birth = 2,
        was = false;
      try {
        for (let f = 2; f <= 11; f++) {
          const yes = visible(f);
          if (yes && !was) birth = f;
          was = yes;
          const render = await prepareLiveMotionFrameCapture(
              () => ({ project: out, revision: 0 }),
              f,
            ),
            time = clock.replay(clock.capture(render), f),
            art = evaluate(render, f, time.frames);
          if (!yes) {
            expect(art).toHaveLength(0);
            continue;
          }
          expect(time.frames['track/instance/bridge-instance/nested/leaf']).toBe(f - birth);
          const timeline = captureLiveMotionTimeline(() => ({ project: out, revision: 0 }));
          try {
            const root = timeline.sample(f)[0].key.shapes[0],
              world = mapPoint(matrix(root), { x: ((1 + f - birth) % 3) * 10, y: 0 }),
              actual = mapPoint(matrix(art[0]), { x: 0, y: 0 });
            expect(actual.x).toBeCloseTo(world.x, 9);
            expect(actual.y).toBeCloseTo(world.y, 9);
          } finally {
            timeline.dispose();
          }
        }
      } finally {
        view.dispose();
        clock.dispose();
      }
      expect(p).toEqual(before);
      expect(out.symbols).toEqual(p.symbols);
    });

for (const phase of [1, 2])
  it(`rejects complete clock topology phase ${phase} without source writes`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { view, owner } = operation(p),
      compile = clockPlans.compileMovieClockPlan;
    let count = 0,
      hit = false;
    vi.spyOn(clockPlans, 'compileMovieClockPlan').mockImplementation((project) => {
      const plan = compile(project),
        stack = new Error().stack ?? '';
      if (
        stack.includes('prepareLiveMovieTreeCubicControlPositions') &&
        !stack.includes('prepareUpdateLiveMotionSpans') &&
        project.layers[0].liveMotionSpans?.[0].path?.startY === 50 &&
        ++count === phase
      ) {
        hit = true;
        Object.assign(plan, { corrupted: true });
      }
      return plan;
    });
    try {
      expect(() => prepare([{ owner, target: target(owner) }])).toThrow(/topology/);
      expect(hit).toBe(true);
      expect(p).toEqual(before);
    } finally {
      vi.restoreAllMocks();
    }
    expect(prepare([{ owner, target: target(owner) }])).toBeDefined();
    view.dispose();
  });

it('allows finite off-view controls without silently enabling options or imposing a coordinate cap', () => {
  const p = fixture(),
    { view, owner } = operation(p),
    before = structuredClone(p),
    out = prepare([{ owner, target: { x: 1e100, y: -1e100 } }]);
  expect(out.layers[0].liveMotionSpans![0].path).toEqual({
    ...arch,
    startX: 1e100,
    startY: -1e100,
  });
  expect(out.layers[0].keys).toEqual(before.layers[0].keys);
  expect(out.layers[0].liveMotionSpans![0].options).toEqual(
    before.layers[0].liveMotionSpans![0].options,
  );
  expect(p).toEqual(before);
  view.dispose();
});

it('retains independent complete-group cubic ownership and rejects cross-brand publication', () => {
  const { p } = liveRotationFixture('rigid', 'reflected', true);
  p.layers[0].liveMotionSpans![0].path = { ...arch };
  const group = captureLiveGroupCubicControls(() => ({ project: p, revision: 0, frame: 4 })),
    groupOwner = group.resolve('track', 'live', 'outer', 'start'),
    nested = operation();
  expect(() =>
    prepare([
      {
        owner: groupOwner as unknown as LiveCubicControlOwner,
        target: { x: groupOwner.point.x + 10, y: groupOwner.point.y + 10 },
      },
    ]),
  ).toThrow();
  expect(() =>
    prepareLiveGroupCubicControlPositions([
      {
        owner: nested.owner as unknown as LiveGroupCubicControlOwner,
        target: target(nested.owner),
      },
    ]),
  ).toThrow();
  const empty = capture(() => ({ project: p, revision: 0, frame: 4 }));
  expect(empty.choices).toEqual([]);
  empty.dispose();
  expect(
    prepareLiveGroupCubicControlPositions([
      { owner: groupOwner, target: { x: groupOwner.point.x + 10, y: groupOwner.point.y + 10 } },
    ]),
  ).toBeDefined();
  group.dispose();
  nested.view.dispose();
});

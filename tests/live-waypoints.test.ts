import { afterEach, expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  validateProject,
  type Project,
  type Point,
} from '../packages/document/src';
import { liveSplitFixture } from './live-motion-split-fixture';
import { liveGraphicFixture, createLiveGraphics } from './live-graphics-fixture';
import {
  captureLiveWaypoints as capture,
  prepareLiveWaypointPositions as prepare,
  type LiveWaypointOwner,
  type LiveWaypointRequest,
} from '../packages/animation/src/live-waypoints';
import {
  captureLiveCubicControls,
  prepareLiveCubicControlPositions,
  type LiveCubicControlOwner,
} from '../packages/animation/src/live-cubic-controls';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';

afterEach(() => vi.unstubAllGlobals());
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
function fixture(two = false) {
  const p = liveSplitFixture((_p, s) => {
    s.path = structuredClone(route);
  });
  if (two) p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  return p;
}
function operation(p = fixture(), frame = 4, index = 0, shape = 'art') {
  const scope = capture(() => ({ project: p, revision: 7, frame })),
    owner = scope.resolve('track', 'live', shape, index);
  return { scope, owner };
}
const target = (o: LiveWaypointOwner): Point => ({ x: o.point.x + 10, y: o.point.y + 10 });
for (const frame of [0, 1, 4, 7, 8])
  for (const index of [0, 1])
    it(`owns original stored waypoint ${index} at frame ${frame} without key promotion`, () => {
      const p = fixture(),
        before = structuredClone(p),
        { scope, owner } = operation(p, frame, index),
        request = [{ owner, target: target(owner) }],
        out = prepare(request),
        expected = structuredClone(p);
      (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[index] = {
        x: index ? 70 : 30,
        y: 40,
      };
      expect(owner.point).toEqual({ x: index ? 68 : 28, y: 42 });
      expect(owner.waypointIndex).toBe(index);
      expect(owner.shapeIds).toEqual(['art']);
      expect(out).toEqual(expected);
      expect(p).toEqual(before);
      expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
      expect(request[0].target).toEqual(target(owner));
      scope.dispose();
      expect(() => prepare(request)).toThrow();
    });
for (const basis of ['plain', 'affine', 'reflected'])
  for (const shape of ['art', 'second'])
    it(`uses original document origin for ${basis}/${shape} compound roots and complete membership`, () => {
      const p = fixture();
      for (const key of p.layers[0].keys.slice(0, 2)) {
        const a = key.shapes[0];
        Object.assign(a, {
          kind: 'polygon',
          fillRule: 'evenodd',
          points: [],
          contours: [
            [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
            [
              { x: 4, y: 4 },
              { x: 10, y: 4 },
              { x: 7, y: 10 },
            ],
          ],
          pivot: { x: -100, y: 200 },
        });
        if (basis !== 'plain')
          Object.assign(a, {
            rotation: 25,
            transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
          });
        key.shapes.push({ ...structuredClone(a), id: 'second', x: a.x + 40, y: a.y + 30 });
      }
      p.layers[0].liveMotionSpans![0].options = { affine: true, nodes: true };
      const before = structuredClone(p),
        { scope, owner } = operation(p, 4, 0, shape),
        out = prepare([{ owner, target: target(owner) }]);
      expect(owner.point).toEqual({ x: shape === 'art' ? 28 : 68, y: shape === 'art' ? 42 : 72 });
      expect(owner.shapeIds).toEqual(['art', 'second']);
      const expected = structuredClone(p);
      (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[0] = { x: 30, y: 40 };
      expect(out).toEqual(expected);
      const sampler = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]),
        pose = sampler.sample(4);
      expect(pose[0].x).toBeCloseTo(53, 9);
      expect(pose[0].y).toBeCloseTo(47, 9);
      expect(pose[1].x).toBeCloseTo(93, 9);
      expect(pose[1].y).toBeCloseTo(77, 9);
      sampler.dispose();
      expect(p).toEqual(before);
      scope.dispose();
    });
for (const mode of [
  'straight',
  'curved',
  'custom',
  'distance',
  'curved-distance',
  'tangent',
  'custom-tangent',
] as const)
  it(`preserves ${mode} route settings and independent path numerics`, () => {
    const p = fixture(),
      path = p.layers[0].liveMotionSpans![0].path!;
    if (mode !== 'straight' && mode !== 'distance') path.curvedWaypoints = true;
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
    const sampler = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]),
      pose = sampler.sample(4)[0];
    if (mode === 'straight') {
      expect(pose.x).toBeCloseTo(53, 9);
      expect(pose.y).toBeCloseTo(47, 9);
    }
    if (mode === 'curved' || mode === 'tangent') {
      expect(pose.x).toBeCloseTo(53.625, 9);
      expect(pose.y).toBeCloseTo(51.375, 9);
    }
    if (mode.includes('custom')) {
      expect(pose.x).toBeCloseTo(45.5, 9);
      expect(pose.y).toBeCloseTo(52.625, 9);
    }
    if (mode === 'distance') {
      const d = Math.hypot(30, 40),
        length = Math.hypot(30, -10),
        u = ((d + length + Math.hypot(20, -30)) / 2 - d) / length;
      expect(pose.x).toBeCloseTo(8 + 30 + 30 * u, 9);
      expect(pose.y).toBeCloseTo(12 + 40 - 10 * u, 9);
    }
    sampler.dispose();
    expect(p).toEqual(before);
    scope.dispose();
  });
it('composes distinct slots on one complete route and other tracks before returning one candidate', () => {
  const p = fixture(true),
    before = structuredClone(p),
    { scope, owner } = operation(p),
    last = scope.resolve('track', 'live', 'art', 1),
    later = scope.resolve('later', 'live', 'art', 0);
  const out = prepare([
      { owner, target: target(owner) },
      { owner: last, target: { x: 70, y: 20 } },
      { owner: later, target: { x: 18, y: 22 } },
    ]),
    expected = structuredClone(p);
  expected.layers[0].liveMotionSpans![0].path!.waypoints = [
    { x: 30, y: 40 },
    { x: 62, y: 8 },
  ];
  (expected.layers[1].liveMotionSpans![0].path!.waypoints as Point[])[0] = { x: 10, y: 10 };
  expect(out).toEqual(expected);
  expect(p).toEqual(before);
  out.layers[0].keys[0].shapes[0].x = 999;
  out.layers[1].liveMotionSpans![0].path!.waypoints![1].x = 999;
  expect(p).toEqual(before);
  scope.dispose();
});
it('rejects alias requests to one shared slot even when they use different root identities', () => {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2))
    key.shapes.push({ ...structuredClone(key.shapes[0]), id: 'second', x: key.shapes[0].x + 40 });
  const { scope, owner } = operation(p),
    alias = scope.resolve('track', 'live', 'second', 0);
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: alias, target: target(alias) },
    ]),
  ).toThrow(/slot/);
  expect(prepare([{ owner, target: target(owner) }]).layers[0].keys).toEqual(p.layers[0].keys);
  scope.dispose();
});
for (const index of [-1, 0.5, 2, NaN, Infinity, '0', {}, null])
  it(`rejects original raw index ${String(index)} without coercion`, () => {
    const p = fixture(),
      { scope } = operation(p);
    expect(() => scope.resolve('track', 'live', 'art', index as number)).toThrow();
    scope.dispose();
  });
for (const mode of ['json', 'copy', 'choice', 'cubic', 'crossScope'] as const)
  it(`rejects ${mode} ownership rather than public coordinates`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      other = operation(p),
      r: LiveWaypointRequest = { owner, target: target(owner) };
    if (mode === 'json') r.owner = JSON.parse(JSON.stringify(owner));
    if (mode === 'copy') r.owner = { ...owner };
    if (mode === 'choice') r.owner = scope.choices[0] as unknown as LiveWaypointOwner;
    const legacy = liveSplitFixture((_p, span) => {
      span.path = { startX: 0, startY: 40, endX: 0, endY: 40 };
    });
    const cubic = captureLiveCubicControls(() => ({ project: legacy, revision: 7, frame: 4 }));
    if (mode === 'cubic')
      r.owner = cubic.resolve('track', 'live', 'art', 'start') as unknown as LiveWaypointOwner;
    const rows = [r];
    if (mode === 'crossScope') rows.push({ owner: other.owner, target: target(other.owner) });
    expect(() => prepare(rows)).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
    other.scope.dispose();
    cubic.dispose();
  });
it('detaches public hints and output, freezes owner metadata and preserves exact cubic scope', () => {
  const p = fixture(),
    { scope, owner } = operation(p),
    hints = scope.choices;
  hints[0].waypointCount = 999;
  hints[0].shapeId = 'forged';
  expect(scope.resolve('track', 'live', 'art', 0).point).toEqual({ x: 28, y: 42 });
  expect(Object.isFrozen(owner)).toBe(true);
  expect(Object.isFrozen(owner.point)).toBe(true);
  expect(Object.isFrozen(owner.shapeIds)).toBe(true);
  const cubic = captureLiveCubicControls(() => ({ project: p, revision: 7, frame: 4 }));
  expect(cubic.choices).toEqual([]);
  expect(() => cubic.resolve('track', 'live', 'art', 'start')).toThrow();
  expect(() =>
    prepareLiveCubicControlPositions([
      { owner: owner as unknown as LiveCubicControlOwner, target: target(owner) },
    ]),
  ).toThrow();
  cubic.dispose();
  scope.dispose();
});
for (const mode of [
  'absent',
  'cubic',
  'hidden',
  'locked',
  'outside',
  'missing',
  'rigid',
  'continuity',
] as const)
  it(`keeps ${mode} contexts outside waypoint ownership`, () => {
    const p = fixture();
    if (mode === 'absent') delete p.layers[0].liveMotionSpans![0].path;
    if (mode === 'cubic') delete p.layers[0].liveMotionSpans![0].path!.waypoints;
    if (mode === 'hidden') p.layers[0].visible = false;
    if (mode === 'locked') p.layers[0].locked = true;
    if (mode === 'rigid')
      for (const key of p.layers[0].keys.slice(0, 2)) {
        key.shapes[0].groups = ['outer'];
        key.shapes.push({
          ...structuredClone(key.shapes[0]),
          id: 'member',
          x: key.shapes[0].x + 30,
        });
      }
    if (mode === 'rigid')
      p.layers[0].liveMotionSpans![0].rotation = {
        direction: 'shortest',
        turns: 0,
        rigidGroups: true,
      };
    if (mode === 'continuity') {
      const { p: graphic, span } = liveGraphicFixture();
      span.path = structuredClone(route);
      const source = createLiveGraphics(graphic, span),
        scope = capture(() => ({ project: source, revision: 7, frame: 4 }));
      expect(scope.choices).toEqual([]);
      expect(() => scope.resolve('track', 'live', 'instance', 0)).toThrow();
      scope.dispose();
      return;
    }
    const scope = capture(() => ({ project: p, revision: 7, frame: mode === 'outside' ? 9 : 4 }));
    expect(() =>
      scope.resolve('track', 'live', mode === 'missing' ? 'missing' : 'art', 0),
    ).toThrow();
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
] as const)
  it(`rejects raw ${mode} targets without running getters or writing source`, () => {
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
          return 38;
        },
      });
    if (mode === 'inherited') {
      delete (r as Partial<typeof r>).target;
      Object.setPrototypeOf(r, {
        get target() {
          reads++;
          return { x: 38, y: 52 };
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
for (const mode of ['source', 'identity', 'frame', 'revision', 'dispose', 'reentry'] as const)
  it(`expires original ${mode} ownership before any writes`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let source = p,
      frame = 4,
      revision = 7,
      reenter = false;
    const scope: ReturnType<typeof capture> = capture(() => {
      if (reenter) {
        reenter = false;
        try {
          scope.assertCurrent();
        } catch {}
      }
      return { project: source, frame, revision };
    });
    const owner = scope.resolve('track', 'live', 'art', 0);
    if (mode === 'source') p.name = 'actual source edit';
    if (mode === 'identity') source = structuredClone(p);
    if (mode === 'frame') frame++;
    if (mode === 'revision') revision++;
    if (mode === 'dispose') scope.dispose();
    if (mode === 'reentry') reenter = true;
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    if (mode === 'source') before.name = p.name;
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const mode of [
  'input',
  'async',
  'reentry',
  'callbackGetter',
  'lateCandidate',
  'lateReaderTarget',
  'lateReaderSource',
] as const)
  it(`rejects ${mode} admission after original data reads and permits valid fresh retries`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let rows: LiveWaypointRequest[] = [],
      candidate: Project | undefined,
      hit = false,
      once = true;
    const scope = capture(() => {
        const stack = new Error().stack ?? '';
        if (
          (mode === 'lateReaderTarget' || mode === 'lateReaderSource') &&
          candidate &&
          !hit &&
          stack.includes('prepareLiveWaypointPositions') &&
          !stack.includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          if (mode === 'lateReaderSource') p.name = 'independent late source';
          else rows[0].target.x++;
        }
        return { project: p, revision: 7, frame: 4 };
      }),
      owner = scope.resolve('track', 'live', 'art', 0);
    rows = [{ owner, target: target(owner) }];
    const native = structuredClone;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value);
      if ((out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30)
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
          stack.includes('prepareLiveWaypointPositions') &&
          !stack.includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          candidate.layers[0].keys[0].shapes[0].x = 999;
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
        if (mode === 'reentry') {
          hit = true;
          try {
            prepare(rows);
          } catch {}
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
      expect(() => prepare(rows, options)).toThrow();
      expect(hit).toBe(mode !== 'callbackGetter');
      if (mode === 'lateReaderSource') before.name = p.name;
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
    const fresh = mode === 'lateReaderSource' ? operation(p) : undefined;
    expect(
      prepare([{ owner: fresh?.owner ?? owner, target: target(owner) }]).layers[0]
        .liveMotionSpans![0].path!.waypoints![0],
    ).toEqual({ x: 30, y: 40 });
    fresh?.scope.dispose();
    scope.dispose();
  });
it('retains both adjacent original span identities at a shared endpoint', () => {
  const p = fixture();
  p.duration = 20;
  p.layers[0].keys[2] = {
    frame: 16,
    shapes: [{ ...structuredClone(p.layers[0].keys[1].shapes[0]), x: 168 }],
  };
  p.layers[0].keys.push({ frame: 18, shapes: [] });
  p.layers[0].liveMotionSpans!.push({
    id: 'next',
    start: 8,
    end: 16,
    ease: 'linear',
    path: structuredClone(route),
  });
  const { scope, owner } = operation(p, 8),
    next = scope.resolve('track', 'next', 'art', 0);
  expect(owner.point).toEqual({ x: 28, y: 42 });
  expect(next.point).toEqual({ x: 108, y: 42 });
  const out = prepare([{ owner: next, target: target(next) }]);
  expect(out.layers[0].liveMotionSpans![0]).toEqual(p.layers[0].liveMotionSpans![0]);
  expect(out.layers[0].liveMotionSpans![1].path!.waypoints![0]).toEqual({ x: 30, y: 40 });
  scope.dispose();
});
it('reopened candidates own fresh saved waypoint slots and preserve custom handles and outside exposures', () => {
  const p = fixture();
  Object.assign(p.layers[0].liveMotionSpans![0].path!, {
    curvedWaypoints: true,
    waypointTangents: [
      { x: 10, y: 5 },
      { x: 10, y: 5 },
      { x: 15, y: -5 },
      { x: 10, y: -5 },
    ],
    waypointIncoming: [
      { x: -20, y: -10 },
      { x: -30, y: 10 },
    ],
  });
  const { scope, owner } = operation(p),
    out = JSON.parse(JSON.stringify(prepare([{ owner, target: target(owner) }]))) as Project,
    fresh = operation(out, 4, 1);
  const edited = prepare([{ owner: fresh.owner, target: target(fresh.owner) }]);
  expect(edited.layers[0].liveMotionSpans![0].path!.waypoints).toEqual([
    { x: 30, y: 40 },
    { x: 70, y: 40 },
  ]);
  expect(edited.layers[0].keys).toEqual(p.layers[0].keys);
  expect(edited.layers[0].liveMotionSpans![0].path!.waypointIncoming).toEqual(
    p.layers[0].liveMotionSpans![0].path!.waypointIncoming,
  );
  scope.dispose();
  fresh.scope.dispose();
});
it('rejects original out-of-range geometry and finite overflowing route candidates without writes', () => {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2)) key.shapes[0].x = 1e308;
  expect(() => capture(() => ({ project: p, revision: 7, frame: 4 }))).toThrow(/shape geometry/);
  const q = fixture();
  Object.assign(q.layers[0].liveMotionSpans![0].path!, {
    curvedWaypoints: true,
    distance: true,
    tangent: true,
  });
  const before = structuredClone(q),
    { scope, owner } = operation(q);
  expect(() => prepare([{ owner, target: { x: Number.MAX_VALUE, y: 42 } }])).toThrow();
  expect(q).toEqual(before);
  expect(prepare([{ owner, target: target(owner) }]).layers[0].keys).toEqual(q.layers[0].keys);
  scope.dispose();
});
it('rejects a later stationary tangent route atomically and retains the valid original scope', () => {
  const p = fixture(true);
  for (const layer of p.layers)
    Object.assign(layer.liveMotionSpans![0].path!, { curvedWaypoints: true, tangent: true });
  const before = structuredClone(p),
    { scope, owner } = operation(p),
    later = scope.resolve('later', 'live', 'art', 0);
  // Automatic start derivative collapses when the first waypoint equals start.
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: later, target: { x: 8, y: 12 } },
    ]),
  ).toThrow();
  expect(p).toEqual(before);
  expect(
    prepare([{ owner, target: target(owner) }]).layers[0].liveMotionSpans![0].path!.waypoints![0],
  ).toEqual({ x: 30, y: 40 });
  scope.dispose();
});
it('admits the exact original symbol artwork budget and rejects original overflow', () => {
  const p = fixture(),
    a = p.layers[0].keys[0].shapes[0];
  p.symbols = [
    {
      id: 'unused',
      name: 'Unused',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({ ...a, id: 's' + i })),
    },
  ];
  validateProject(p);
  const { scope, owner } = operation(p),
    out = prepare([{ owner, target: target(owner) }]);
  expect(out.symbols).toEqual(p.symbols);
  scope.dispose();
  p.symbols[0].shapes.push({ ...a, id: 'overflow' });
  expect(() => capture(() => ({ project: p, revision: 7, frame: 4 }))).toThrow(/budget/);
}, 60000);

for (const mode of ['hint', 'snapshot'] as const)
  it(`rejects changed ${mode} clones without admitting public coordinates`, () => {
    const p = fixture(),
      before = structuredClone(p),
      native = structuredClone;
    let hit = false;
    const original = mode === 'hint' ? operation(p) : undefined;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value);
      if (
        !hit &&
        (mode === 'snapshot' ? value === p : Array.isArray(out) && out[0]?.waypointCount)
      ) {
        hit = true;
        if (mode === 'snapshot') (out as Project).name = 'forged snapshot';
        else (out as { waypointCount: number }[])[0].waypointCount = 999;
      }
      return out;
    });
    expect(() =>
      mode === 'hint'
        ? original!.scope.choices
        : capture(() => ({ project: p, revision: 7, frame: 4 })),
    ).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
    vi.unstubAllGlobals();
    if (original) {
      expect(
        prepare([{ owner: original.owner, target: target(original.owner) }]).layers[0].keys,
      ).toEqual(p.layers[0].keys);
      original.scope.dispose();
    }
  });
it('never coerces original index and identity objects or invokes their serialization getters', () => {
  const { scope } = operation();
  let reads = 0;
  const forged = {
    get toJSON() {
      reads++;
      return () => 0;
    },
    valueOf() {
      reads++;
      return 0;
    },
  };
  expect(() => scope.resolve('track', 'live', 'art', forged as unknown as number)).toThrow();
  expect(() => scope.resolve(forged as unknown as string, 'live', 'art', 0)).toThrow();
  expect(reads).toBe(0);
  scope.dispose();
});
it('lazily owns root and waypoint identities without a roots-times-slots hint expansion', () => {
  const p = fixture(),
    count = 256,
    slots = 1024;
  for (const key of p.layers[0].keys.slice(0, 2)) {
    const a = key.shapes[0];
    key.shapes = Array.from({ length: count }, (_, i) => ({
      ...a,
      id: 'art' + i,
      x: a.x + i * 20,
    }));
  }
  p.layers[0].liveMotionSpans![0].path!.waypoints = Array.from({ length: slots }, (_, i) => ({
    x: ((i + 1) * 80) / (slots + 1),
    y: 30,
  }));
  const scope = capture(() => ({ project: p, revision: 7, frame: 4 })),
    hints = scope.choices;
  expect(hints).toHaveLength(count);
  expect(hints.every((h) => h.waypointCount === slots && !Object.hasOwn(h, 'shapeIds'))).toBe(true);
  expect(JSON.stringify(hints).length).toBeLessThan(count * 150);
  const a = scope.resolve('track', 'live', 'art0', 0),
    b = scope.resolve('track', 'live', 'art255', slots - 1);
  expect(a.shapeIds).toBe(b.shapeIds);
  expect(a.point).toEqual({ x: 8 + 80 / (slots + 1), y: 42 });
  expect(b.point.x).toBeCloseTo(8 + 255 * 20 + (slots * 80) / (slots + 1), 9);
  scope.dispose();
});

it('composes different slots referenced through different original root origins', () => {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2))
    key.shapes.push({
      ...structuredClone(key.shapes[0]),
      id: 'second',
      x: key.shapes[0].x + 40,
      y: key.shapes[0].y + 30,
    });
  const { scope, owner } = operation(p),
    other = scope.resolve('track', 'live', 'second', 1),
    before = structuredClone(p),
    out = prepare([
      { owner, target: target(owner) },
      { owner: other, target: target(other) },
    ]);
  expect(out.layers[0].liveMotionSpans![0].path!.waypoints).toEqual([
    { x: 30, y: 40 },
    { x: 70, y: 40 },
  ]);
  expect(out.layers[0].keys).toEqual(p.layers[0].keys);
  expect(p).toEqual(before);
  scope.dispose();
});
it('public replaced methods cannot retire or bypass the original private source reader', () => {
  const p = fixture(),
    { scope, owner } = operation(p),
    dispose = scope.dispose;
  scope.assertCurrent = () => {};
  scope.dispose = () => {};
  p.name = 'separate source edit';
  expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
  dispose();
});
it('rejects original source accessors before reading them', () => {
  const p = fixture();
  let reads = 0;
  const source = Object.defineProperty({ frame: 4, revision: 7 }, 'project', {
    enumerable: true,
    get() {
      reads++;
      return p;
    },
  });
  expect(() =>
    capture(() => source as { project: Project; frame: number; revision: number }),
  ).toThrow();
  expect(reads).toBe(0);
});
it('rejects complete edited-clone aggregate overflow without consuming source-valid ownership', () => {
  const p = fixture(),
    before = structuredClone(p),
    { scope, owner } = operation(p),
    native = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = native(value),
      candidate = out as Project;
    if (!hit && candidate?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30) {
      hit = true;
      const a = candidate.layers[0].keys[0].shapes[0];
      candidate.symbols = [
        {
          id: 'overflow',
          name: 'Overflow',
          width: 1,
          height: 1,
          shapes: Array.from({ length: MAX_SYMBOL_ARTWORK + 1 }, (_, i) => ({
            ...a,
            id: 'extra' + i,
          })),
        },
      ];
    }
    return out;
  });
  try {
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow(/budget/);
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
  }
  expect(
    prepare([{ owner, target: target(owner) }]).layers[0].liveMotionSpans![0].path!.waypoints![0],
  ).toEqual({ x: 30, y: 40 });
  scope.dispose();
});

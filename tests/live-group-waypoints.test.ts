import { afterEach, expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  validateProject,
  type Project,
  type Point,
  type Vector,
} from '../packages/document/src';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import { liveSplitFixture } from './live-motion-split-fixture';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import {
  captureLiveGroupWaypoints as capture,
  prepareLiveGroupWaypointPositions as prepare,
  type LiveGroupWaypointOwner as LiveWaypointOwner,
  type LiveGroupWaypointRequest as LiveWaypointRequest,
} from '../packages/animation/src/live-group-waypoints';
import {
  captureLiveWaypoints as captureRoot,
  prepareLiveWaypointPositions as prepareRoot,
} from '../packages/animation/src/live-waypoints';
import {
  captureLiveGroupCubicControls as captureCubic,
  prepareLiveGroupCubicControlPositions as prepareCubic,
} from '../packages/animation/src/live-group-cubic-controls';
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
function fixture(two = false, mode = 'rigid', basis = 'plain') {
  const { p } = liveRotationFixture(mode, basis, true);
  p.layers[0].liveMotionSpans![0].path = structuredClone(route);
  if (two) secondRotationTrack(p);
  return p;
}
function operation(p = fixture(), frame = 4, index = 0, group = 'outer') {
  const scope = capture(() => ({ project: p, revision: 7, frame })),
    owner = scope.resolve('track', 'live', group, index);
  return { scope, owner };
}
const target = (o: LiveWaypointOwner): Point => ({ x: o.point.x + 10, y: o.point.y + 10 });
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
    const owner = scope.resolve('track', 'live', 'outer', 0);
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
          stack.includes('prepareLiveGroupWaypointPositions') &&
          !stack.includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          if (mode === 'lateReaderSource') p.name = 'independent late source';
          else rows[0].target.x++;
        }
        return { project: p, revision: 7, frame: 4 };
      }),
      owner = scope.resolve('track', 'live', 'outer', 0);
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
          stack.includes('prepareLiveGroupWaypointPositions') &&
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
    later = scope.resolve('later', 'live', 'outer', 0);
  // Automatic start derivative collapses when the first waypoint equals start.
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: later, target: { x: 0, y: 20 } },
    ]),
  ).toThrow();
  expect(p).toEqual(before);
  expect(
    prepare([{ owner, target: target(owner) }]).layers[0].liveMotionSpans![0].path!.waypoints![0],
  ).toEqual({ x: 30, y: 40 });
  scope.dispose();
});
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
  expect(() => scope.resolve('track', 'live', 'outer', forged as unknown as number)).toThrow();
  expect(() => scope.resolve(forged as unknown as string, 'live', 'outer', 0)).toThrow();
  expect(reads).toBe(0);
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
      const a: Vector = {
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
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const index of [0, 1])
      it(`prepares original shared waypoint ${mode}/${basis}/${index} with complete membership and independent sampled deltas`, () => {
        const p = fixture(false, mode, basis),
          before = structuredClone(p),
          { scope, owner } = operation(p, 4, index, 'second');
        expect(owner.groupId).toBe('second');
        expect(owner.shapeId).toBe('c');
        expect(owner.point).toEqual({ x: 160 + (index ? 60 : 20), y: 150 });
        expect(owner.groupShapeIds).toEqual(['c', 'd']);
        expect(owner.shapeIds).toEqual(['a', 'b', 'c', 'd', 'loose']);
        const out = prepare([{ owner, target: target(owner) }]),
          expected = structuredClone(p);
        (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[index] = {
          x: (index ? 60 : 20) + 10,
          y: 40,
        };
        expect(out).toEqual(expected);
        expect(p).toEqual(before);
        const original = createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0]),
          edited = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]);
        for (const frame of [0, 2, 4, 6, 8]) {
          const a = original.sample(frame),
            b = edited.sample(frame),
            t = frame / 8,
            segment = Math.min(2, Math.floor(t * 3)),
            u = t * 3 - segment;
          const delta =
            frame === 0 || frame === 8
              ? 0
              : segment === index
                ? 10 * u
                : segment === index + 1
                  ? 10 * (1 - u)
                  : 0;
          for (let i = 0; i < a.length; i++) {
            expect(b[i].x).toBeCloseTo(a[i].x + delta, 9);
            expect(b[i].y).toBeCloseTo(a[i].y + delta, 9);
            expect(b[i].transform).toEqual(a[i].transform);
            expect(b[i].groups).toEqual(a[i].groups);
          }
        }
        original.dispose();
        edited.dispose();
        scope.dispose();
      });
for (const frame of [0, 1, 4, 7, 8])
  for (const index of [0, 1])
    it(`owns ordered original group waypoint ${index} at frame ${frame} independently of sampled poses`, () => {
      const p = fixture(),
        { scope, owner } = operation(p, frame, index),
        hints = scope.choices;
      expect(hints).toHaveLength(2);
      expect(hints.every((h) => h.waypointCount === 2)).toBe(true);
      hints[0].waypointCount = 999;
      hints[0].groupId = 'forged';
      expect(scope.resolve('track', 'live', 'outer', index).point).toEqual({
        x: index ? 60 : 20,
        y: 50,
      });
      expect(owner.groupShapeIds).toEqual(['a', 'b']);
      expect(Object.isFrozen(owner)).toBe(true);
      expect(Object.isFrozen(owner.point)).toBe(true);
      expect(Object.isFrozen(owner.shapeIds)).toBe(true);
      expect(Object.isFrozen(owner.groupShapeIds)).toBe(true);
      expect(() => scope.resolve('track', 'live', 'inner', index)).toThrow();
      expect(() => scope.resolve('track', 'live', 'loose', index)).toThrow();
      scope.dispose();
      expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    });
for (const mode of ['curved', 'custom', 'distance', 'curved-distance', 'tangent', 'custom-tangent'])
  it(`preserves explicit group ${mode} settings and path controls through reopen/later-slot editing`, () => {
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
      fresh = operation(reopened, 4, 1, 'second'),
      later = prepare([{ owner: fresh.owner, target: target(fresh.owner) }]);
    (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[1] = { x: 70, y: 40 };
    expect(later).toEqual(expected);
    expect(p).toEqual(before);
    scope.dispose();
    fresh.scope.dispose();
  });
for (const index of [-1, 0.5, 2, NaN, Infinity, '0', {}, null])
  it(`rejects raw group slot ${String(index)} without coercion`, () => {
    const { scope } = operation();
    expect(() => scope.resolve('track', 'live', 'outer', index as number)).toThrow();
    scope.dispose();
  });
it('uses the actual first start-member, not sorted IDs, pivots, bounds or descendants', () => {
  const p = fixture(false, 'both', 'reflected');
  for (const key of p.layers[0].keys.slice(0, 2)) {
    key.shapes = [key.shapes[1], key.shapes[0], ...key.shapes.slice(2)];
    for (const a of key.shapes) a.pivot = { x: -400, y: 900 };
  }
  const { scope, owner } = operation(p);
  expect(owner.shapeId).toBe('b');
  expect(owner.groupShapeIds).toEqual(['b', 'a']);
  expect(owner.point).toEqual({ x: 60, y: 50 });
  const out = prepare([{ owner, target: { x: 55, y: 65 } }]);
  expect(out.layers[0].liveMotionSpans![0].path!.waypoints![0]).toEqual({ x: 15, y: 45 });
  scope.dispose();
});
it('composes distinct shared slots across group references/tracks and rejects same-slot aliases atomically', () => {
  const p = fixture(true),
    before = structuredClone(p),
    { scope, owner } = operation(p),
    second = scope.resolve('track', 'live', 'second', 1),
    later = scope.resolve('later', 'live', 'outer', 0),
    alias = scope.resolve('track', 'live', 'second', 0);
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: alias, target: target(alias) },
    ]),
  ).toThrow(/slot/);
  const out = prepare([
      { owner, target: target(owner) },
      { owner: second, target: target(second) },
      { owner: later, target: target(later) },
    ]),
    expected = structuredClone(p);
  expected.layers[0].liveMotionSpans![0].path!.waypoints = [
    { x: 30, y: 40 },
    { x: 70, y: 40 },
  ];
  expected.layers[1].liveMotionSpans![0].path!.waypoints = [
    { x: 30, y: 40 },
    { x: 60, y: 30 },
  ];
  expect(out).toEqual(expected);
  expect(p).toEqual(before);
  scope.dispose();
});
for (const mode of ['json', 'copy', 'hint', 'root', 'cubic', 'crossScope'] as const)
  it(`keeps ${mode} group waypoint ownership separate from public data and older brands`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      other = operation(p);
    const plain = liveSplitFixture((_p, s) => {
        s.path = structuredClone(route);
      }),
      root = captureRoot(() => ({ project: plain, revision: 7, frame: 4 }));
    const q = fixture();
    delete q.layers[0].liveMotionSpans![0].path!.waypoints;
    const cubic = captureCubic(() => ({ project: q, revision: 7, frame: 4 }));
    const row = { owner, target: target(owner) };
    if (mode === 'json') row.owner = JSON.parse(JSON.stringify(owner));
    if (mode === 'copy') row.owner = { ...owner };
    if (mode === 'hint') row.owner = scope.choices[0] as unknown as LiveWaypointOwner;
    if (mode === 'root')
      row.owner = root.resolve('track', 'live', 'art', 0) as unknown as LiveWaypointOwner;
    if (mode === 'cubic')
      row.owner = cubic.resolve('track', 'live', 'outer', 'start') as unknown as LiveWaypointOwner;
    const rows = [row];
    if (mode === 'crossScope') rows.push({ owner: other.owner, target: target(other.owner) });
    expect(() => prepare(rows)).toThrow();
    expect(() =>
      prepareRoot([
        {
          owner: owner as unknown as Parameters<typeof prepareRoot>[0][number]['owner'],
          target: target(owner),
        },
      ]),
    ).toThrow();
    expect(() =>
      prepareCubic([
        {
          owner: owner as unknown as Parameters<typeof prepareCubic>[0][number]['owner'],
          target: target(owner),
        },
      ]),
    ).toThrow();
    expect(root.choices).toHaveLength(1);
    expect(captureRoot(() => ({ project: p, revision: 7, frame: 4 })).choices).toEqual([]);
    expect(captureCubic(() => ({ project: p, revision: 7, frame: 4 })).choices).toEqual([]);
    expect(p).toEqual(before);
    scope.dispose();
    other.scope.dispose();
    root.dispose();
    cubic.dispose();
  });
for (const mode of [
  'absent',
  'cubic',
  'nonrigid',
  'hidden',
  'locked',
  'outside',
  'missing',
  'inner',
  'loose',
] as const)
  it(`rejects original unsupported ${mode} group waypoint scope`, () => {
    const p = fixture();
    if (mode === 'absent') delete p.layers[0].liveMotionSpans![0].path;
    if (mode === 'cubic') delete p.layers[0].liveMotionSpans![0].path!.waypoints;
    if (mode === 'nonrigid') {
      delete p.layers[0].liveMotionSpans![0].rotation!.rigidGroups;
      for (const key of p.layers[0].keys.slice(0, 2))
        for (const shape of key.shapes) delete shape.groups;
    }
    if (mode === 'hidden') p.layers[0].visible = false;
    if (mode === 'locked') p.layers[0].locked = true;
    const scope = capture(() => ({ project: p, revision: 7, frame: mode === 'outside' ? 9 : 4 }));
    expect(() =>
      scope.resolve(
        'track',
        'live',
        ['missing', 'inner', 'loose'].includes(mode) ? mode : 'outer',
        0,
      ),
    ).toThrow();
    scope.dispose();
  });
for (const action of ['target', 'callback', 'reentry', 'cross-scope reentry'] as const)
  it(`guards original first-reader ${action} before preparing a detached candidate`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let armed = false,
      hit = false;
    let rows: LiveWaypointRequest[] = [],
      other: ReturnType<typeof operation> | undefined;
    const options: { validate?: () => void } = { validate: () => {} };
    const scope = capture(() => {
      if (armed && !hit) {
        hit = true;
        if (action === 'target') rows[0].target.x++;
        if (action === 'callback') options.validate = () => {};
        if (action === 'reentry' || action === 'cross-scope reentry') {
          try {
            prepare([
              {
                owner: action === 'reentry' ? rows[0].owner : other!.owner,
                target: { x: 35, y: 65 },
              },
            ]);
          } catch {
            /* Poisoning must survive swallowed reentry. */
          }
        }
      }
      return { project: p, revision: 7, frame: 4 };
    });
    const owner = scope.resolve('track', 'live', 'outer', 0);
    rows = [{ owner, target: target(owner) }];
    if (action === 'cross-scope reentry') other = operation(p);
    armed = true;
    expect(() => prepare(rows, options)).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
    expect(prepare([{ owner, target: target(owner) }]).layers[0].keys).toEqual(p.layers[0].keys);
    scope.dispose();
    other?.scope.dispose();
  });
it('rejects an admission accessor before the first original source reader without evaluating it', () => {
  const p = fixture();
  let reads = 0;
  const scope = capture(() => {
      reads++;
      return { project: p, revision: 7, frame: 4 };
    }),
    owner = scope.resolve('track', 'live', 'outer', 0),
    initial = reads,
    getter = vi.fn(() => () => {});
  const options = Object.defineProperty({}, 'validate', { enumerable: true, get: getter });
  expect(() => prepare([{ owner, target: target(owner) }], options)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(reads).toBe(initial);
  scope.dispose();
});
it('rejects final admission callback replacement after complete edited data exists without consuming ownership', () => {
  const p = fixture(),
    before = structuredClone(p),
    { scope, owner } = operation(p),
    native = structuredClone;
  let complete = false,
    hit = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = native(value);
    if ((out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30)
      complete = true;
    return out;
  });
  const options = {
    validate: () => {
      if (
        complete &&
        !hit &&
        (new Error().stack ?? '').includes('prepareLiveGroupWaypointPositions') &&
        !(new Error().stack ?? '').includes('prepareUpdateLiveMotionSpans')
      ) {
        hit = true;
        options.validate = () => {};
      }
    },
  };
  expect(() => prepare([{ owner, target: target(owner) }], options)).toThrow(/callback/);
  expect(hit).toBe(true);
  expect(p).toEqual(before);
  expect(prepare([{ owner, target: target(owner) }]).layers[0].keys).toEqual(p.layers[0].keys);
  scope.dispose();
});
it('owns many groups and slots lazily with shared frozen complete/per-group membership', () => {
  const p = fixture(),
    count = 64,
    slots = 512;
  for (const key of p.layers[0].keys.slice(0, 2)) {
    const original = key.shapes.slice(0, 2);
    key.shapes = Array.from({ length: count }, (_, i) =>
      original.map((a, j) => ({
        ...structuredClone(a),
        id: `art${i}-${j}`,
        groups: [`group${i}`, 'inner' + i],
        x: a.x + i * 200,
      })),
    ).flat();
  }
  p.layers[0].liveMotionSpans![0].path!.waypoints = Array.from({ length: slots }, (_, i) => ({
    x: ((i + 1) * 80) / (slots + 1),
    y: 30,
  }));
  const scope = capture(() => ({ project: p, revision: 7, frame: 4 })),
    hints = scope.choices;
  expect(hints).toHaveLength(count);
  expect(
    hints.every(
      (h) =>
        h.waypointCount === slots && !Object.hasOwn(h, 'shapeIds') && !Object.hasOwn(h, 'point'),
    ),
  ).toBe(true);
  expect(JSON.stringify(hints).length).toBeLessThan(count * 170);
  const a = scope.resolve('track', 'live', 'group0', 0),
    b = scope.resolve('track', 'live', 'group63', slots - 1),
    c = scope.resolve('track', 'live', 'group0', slots - 1);
  expect(a.shapeIds).toBe(b.shapeIds);
  expect(a.groupShapeIds).toBe(c.groupShapeIds);
  expect(a.groupShapeIds).toEqual(['art0-0', 'art0-1']);
  expect(a.point).toEqual({ x: 80 / (slots + 1), y: 50 });
  expect(b.point.x).toBeCloseTo(63 * 200 + (slots * 80) / (slots + 1), 9);
  scope.dispose();
});
for (const scale of [1e-6, 1, 1000])
  it(`preserves relative group waypoint offsets at scale ${scale} and off-view targets`, () => {
    const p = fixture(false, 'shear', 'reflected');
    for (const key of p.layers[0].keys)
      for (const a of key.shapes) {
        a.x = 10000 + a.x * scale;
        a.y = -10000 + a.y * scale;
      }
    const path = p.layers[0].liveMotionSpans![0].path!;
    path.waypoints = route.waypoints.map((q) => ({ x: q.x * scale, y: q.y * scale }));
    const before = structuredClone(p),
      { scope, owner } = operation(p, 4, 1, 'second');
    const out = prepare([
      { owner, target: { x: owner.point.x - 10 * scale, y: owner.point.y + 20 * scale } },
    ]);
    expect(out.layers[0].liveMotionSpans![0].path!.waypoints![1].x).toBeCloseTo(50 * scale, 8);
    expect(out.layers[0].liveMotionSpans![0].path!.waypoints![1].y).toBeCloseTo(50 * scale, 8);
    expect(out.layers[0].keys).toEqual(p.layers[0].keys);
    expect(p).toEqual(before);
    scope.dispose();
  });
it('preserves compound geometry, absent/saved pivots and all paint with unclamped document targets', () => {
  const p = fixture(false, 'rigid', 'reflected');
  for (const key of p.layers[0].keys.slice(0, 2)) {
    Object.assign(key.shapes[0], {
      kind: 'polygon',
      fillRule: 'evenodd',
      points: [],
      contours: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 10, y: 20 },
        ],
        [
          { x: 4, y: 4 },
          { x: 6, y: 4 },
          { x: 5, y: 6 },
        ],
      ],
    });
    delete key.shapes[0].pivot;
  }
  const before = structuredClone(p),
    { scope, owner } = operation(p),
    out = prepare([{ owner, target: { x: -300, y: 800 } }]);
  const expected = structuredClone(p);
  (expected.layers[0].liveMotionSpans![0].path!.waypoints as Point[])[0] = { x: -300, y: 780 };
  expect(out).toEqual(expected);
  expect(p).toEqual(before);
  scope.dispose();
});
it('admits exact group-owner aggregate artwork capacity and rejects original overflow', () => {
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
  p.symbols = [
    {
      id: 'budget',
      name: 'Budget',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({ ...a, id: 'saved' + i })),
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
for (const mode of ['getter', 'nonfinite', 'parent', 'order', 'orbit', 'depth'] as const)
  it(`retains original group ${mode} validation before waypoint ownership escapes`, () => {
    const p = fixture();
    let reads = 0;
    if (mode === 'getter')
      Object.defineProperty(p.layers[0].keys[0].shapes[0], 'groups', {
        enumerable: true,
        get() {
          reads++;
          return ['outer'];
        },
      });
    if (mode === 'nonfinite') p.layers[0].keys[0].shapes[0].x = NaN;
    if (mode === 'parent') p.layers[0].keys[1].shapes[0].groups = ['different', 'inner'];
    if (mode === 'order') p.layers[0].keys[1].shapes.reverse();
    if (mode === 'orbit') p.layers[0].liveMotionSpans![0].rotation!.savedGroupPivots = true;
    if (mode === 'depth') p.layers[0].liveMotionSpans![0].rotation!.groupDepth = 1;
    expect(() => operation(p)).toThrow();
    expect(reads).toBe(0);
  });
for (const mode of ['source library', 'candidate library'] as const)
  it(`rejects late ${mode} changes after complete group waypoint data exists`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let candidate: Project | undefined,
      hit = false;
    const scope = capture(() => ({ project: p, revision: 7, frame: 4 })),
      owner = scope.resolve('track', 'live', 'outer', 0),
      native = structuredClone;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value);
      if ((out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypoints?.[0]?.x === 30)
        candidate = out as Project;
      return out;
    });
    expect(() =>
      prepare([{ owner, target: target(owner) }], {
        validate: () => {
          const stack = new Error().stack ?? '';
          if (
            candidate &&
            !hit &&
            stack.includes('prepareLiveGroupWaypointPositions') &&
            !stack.includes('prepareUpdateLiveMotionSpans')
          ) {
            hit = true;
            (mode === 'source library' ? p : candidate).symbols![0].name =
              'Actual late library change';
          }
        },
      }),
    ).toThrow();
    expect(hit).toBe(true);
    if (mode === 'source library') before.symbols![0].name = 'Actual late library change';
    expect(p).toEqual(before);
    const fresh = mode === 'source library' ? operation(p) : undefined;
    expect(
      prepare([{ owner: fresh?.owner ?? owner, target: target(fresh?.owner ?? owner) }]).layers[0]
        .keys,
    ).toEqual(p.layers[0].keys);
    fresh?.scope.dispose();
    scope.dispose();
  });

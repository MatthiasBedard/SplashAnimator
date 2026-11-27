import {
  prepareCreateLiveMotionSpans,
  prepareUpdateLiveMotionSpans,
  prepareRemoveLiveMotionSpans,
} from '../packages/animation/src/live-motion';
import { afterEach, expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  validateProject,
  type Project,
  type Point,
  type Vector,
} from '../packages/document/src';
import { liveSplitFixture } from './live-motion-split-fixture';
import {
  captureLiveWaypointTangents as capture,
  prepareLiveWaypointTangentPositions as prepare,
  type LiveWaypointTangentOwner as Owner,
  type LiveWaypointTangentRequest as Request,
  type LiveWaypointTangentRole as Role,
} from '../packages/animation/src/live-waypoint-tangents';
import { captureLiveWaypoints } from '../packages/animation/src/live-waypoints';
import { captureLiveCubicControls } from '../packages/animation/src/live-cubic-controls';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(two = false, basis = 'plain') {
  const p = liveSplitFixture((p, s) => {
    s.path = {
      startX: 3,
      startY: 7,
      endX: -2,
      endY: 6,
      curvedWaypoints: true,
      waypoints: [
        { x: 20, y: 30 },
        { x: 60, y: 30 },
      ],
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
    };
    for (const k of p.layers[0].keys.slice(0, 2)) {
      const a = k.shapes[0];
      if (basis !== 'plain')
        Object.assign(a, {
          rotation: 25,
          transform: [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
          pivot: { x: -100, y: 200 },
        });
      k.shapes.push({ ...structuredClone(a), id: 'second', x: a.x + 40, y: a.y + 30 });
    }
    if (basis !== 'plain') s.options = { affine: true };
  });
  if (two) p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  return p;
}
function operation(p = fixture(), index = 0, role: Role = 'outgoing', shape = 'art', frame = 4) {
  const scope = capture(() => ({ project: p, frame, revision: 7 }));
  return { scope, owner: scope.resolve('track', 'live', shape, index, role) };
}
const target = (o: Owner) => ({ x: o.point.x + 7, y: o.point.y - 3 });
function changed(p: Project, o: Owner, q = target(o)) {
  const out = structuredClone(p),
    path = out.layers
      .find((l) => l.id === o.layerId)!
      .liveMotionSpans!.find((s) => s.id === o.spanId)!.path!;
  const point = { x: q.x - o.anchor.x, y: q.y - o.anchor.y };
  if (o.role === 'incoming') (path.waypointIncoming as Point[])[o.waypointIndex] = point;
  else (path.waypointTangents as Point[])[o.waypointIndex + 1] = point;
  return out;
}
function cubic(a: Point, b: Point, c: Point, d: Point, u: number) {
  const v = 1 - u;
  return {
    x: v * v * v * a.x + 3 * v * v * u * b.x + 3 * v * u * u * c.x + u * u * u * d.x,
    y: v * v * v * a.y + 3 * v * v * u * b.y + 3 * v * u * u * c.y + u * u * u * d.y,
  };
}
function oracle(p: Project, frame: number, root = 0) {
  const layer = p.layers[0],
    span = layer.liveMotionSpans![0],
    path = span.path!,
    from = layer.keys[0].shapes[root],
    to = layer.keys[1].shapes[root];
  const points = [
    { x: from.x, y: from.y },
    ...path.waypoints!.map((o) => ({ x: from.x + o.x, y: from.y + o.y })),
    { x: to.x, y: to.y },
  ];
  const t = (frame / 8) * 3,
    i = Math.min(2, Math.floor(t)),
    u = t - i,
    a = points[i],
    d = points[i + 1];
  const out = path.waypointTangents![i],
    inc =
      i < 2
        ? path.waypointIncoming![i]
        : { x: -path.waypointTangents![3].x, y: -path.waypointTangents![3].y };
  return cubic(a, { x: a.x + out.x, y: a.y + out.y }, { x: d.x + inc.x, y: d.y + inc.y }, d, u);
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const shape of ['art', 'second'])
    for (const index of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        it(`owns independent signed ${basis}/${shape}/${index}/${role} controls and exact curve points`, () => {
          const p = fixture(false, basis),
            before = structuredClone(p),
            { scope, owner } = operation(p, index, role, shape),
            r = shape === 'second' ? 1 : 0;
          const anchor = { x: (r ? 48 : 8) + (index ? 60 : 20), y: (r ? 42 : 12) + 30 },
            h =
              role === 'incoming'
                ? index
                  ? { x: -30, y: 10 }
                  : { x: -20, y: -10 }
                : index
                  ? { x: 15, y: -5 }
                  : { x: 10, y: 5 };
          expect(owner.anchor).toEqual(anchor);
          expect(owner.point).toEqual({ x: anchor.x + h.x, y: anchor.y + h.y });
          const out = prepare([{ owner, target: target(owner) }]),
            expected = changed(before, owner);
          expect(out).toEqual(expected);
          expect(p).toEqual(before);
          expect(owner.shapeIds).toEqual(['art', 'second']);
          const sampler = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]);
          for (const frame of [0, 1, 2, 4, 6, 7, 8])
            for (const root of [0, 1]) {
              const actual = sampler.sample(frame)[root],
                q = oracle(expected, frame, root);
              expect(actual.x).toBeCloseTo(q.x, 9);
              expect(actual.y).toBeCloseTo(q.y, 9);
            }
          sampler.dispose();
          expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(before));
          scope.dispose();
          expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
        });
for (const frame of [0, 1, 4, 7, 8])
  it(`owns authored controls at frame ${frame} without promoting keys`, () => {
    const p = fixture(),
      { scope, owner } = operation(p, 0, 'incoming', 'art', frame);
    expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
    expect(owner.frame).toBe(frame);
    scope.dispose();
  });
for (const mode of ['distance', 'tangent', 'distance-tangent'])
  it(`retains explicit ${mode} settings and finite sampled output`, () => {
    const p = fixture(),
      path = p.layers[0].liveMotionSpans![0].path!;
    if (mode.includes('distance')) path.distance = true;
    if (mode.includes('tangent'))
      Object.assign(path, { tangent: true, headingOffset: 10, headingOffsetEnd: 20 });
    const before = structuredClone(p),
      { scope, owner } = operation(p),
      q = mode.includes('tangent')
        ? {
            x: owner.anchor.x + (owner.point.x - owner.anchor.x) * 1.1,
            y: owner.anchor.y + (owner.point.y - owner.anchor.y) * 1.1,
          }
        : target(owner),
      out = prepare([{ owner, target: q }]);
    expect(out).toEqual(changed(before, owner, q));
    const sampler = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]);
    for (const f of [0, 1, 4, 7, 8])
      for (const a of sampler.sample(f))
        expect([a.x, a.y, a.rotation].every(Number.isFinite)).toBe(true);
    sampler.dispose();
    scope.dispose();
  });
it('composes opposite roles, distinct slots and later tracks in one detached candidate', () => {
  const p = fixture(true),
    before = structuredClone(p),
    { scope, owner } = operation(p, 0, 'incoming'),
    b = scope.resolve('track', 'live', 'second', 0, 'outgoing'),
    c = scope.resolve('later', 'live', 'art', 1, 'incoming');
  const rows = [owner, b, c].map((owner) => ({ owner, target: target(owner) }));
  let expected = before;
  for (const r of rows) expected = changed(expected, r.owner, r.target);
  const out = prepare(rows);
  expect(out).toEqual(expected);
  expect(p).toEqual(before);
  out.layers[0].keys[0].shapes[0].x = 999;
  out.layers[0].liveMotionSpans![0].path!.waypointIncoming![1].x = 999;
  expect(prepare(rows)).toEqual(expected);
  expect(p).toEqual(before);
  scope.dispose();
});
it('rejects same stored role aliases across root references but admits opposite roles', () => {
  const p = fixture(),
    { scope, owner } = operation(p),
    alias = scope.resolve('track', 'live', 'second', 0, 'outgoing'),
    opposite = scope.resolve('track', 'live', 'second', 0, 'incoming');
  expect(() => prepare([owner, alias].map((owner) => ({ owner, target: target(owner) })))).toThrow(
    /slot/,
  );
  expect(prepare([owner, opposite].map((owner) => ({ owner, target: target(owner) })))).toEqual(
    changed(changed(p, owner), opposite),
  );
  scope.dispose();
});
for (const value of [-1, 0.5, 2, NaN, Infinity, '0', null])
  it(`rejects raw waypoint index ${String(value)}`, () => {
    const p = fixture(),
      scope = capture(() => ({ project: p, frame: 4, revision: 0 }));
    expect(() => scope.resolve('track', 'live', 'art', value as number, 'incoming')).toThrow();
    scope.dispose();
  });
for (const role of ['start', 'end', 'in', 'anchor', undefined, null, 0])
  it(`rejects missing or legacy cubic role ${String(role)}`, () => {
    const p = fixture(),
      scope = capture(() => ({ project: p, frame: 4, revision: 0 }));
    expect(() => scope.resolve('track', 'live', 'art', 0, role as Role)).toThrow();
    scope.dispose();
  });
for (const mode of [
  'automatic',
  'mirrored',
  'straight',
  'locked',
  'hidden',
  'outside',
  'rigid',
  'continuity',
])
  it(`keeps ${mode} paths out of explicit tangent ownership without altering them`, () => {
    const p = fixture(),
      s = p.layers[0].liveMotionSpans![0];
    if (mode === 'automatic') {
      delete s.path!.waypointTangents;
      delete s.path!.waypointIncoming;
    }
    if (mode === 'mirrored') delete s.path!.waypointIncoming;
    if (mode === 'straight') {
      delete s.path!.curvedWaypoints;
      delete s.path!.waypointTangents;
      delete s.path!.waypointIncoming;
    }
    if (mode === 'locked') p.layers[0].locked = true;
    if (mode === 'hidden') p.layers[0].visible = false;
    if (mode === 'rigid') {
      s.rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
    }
    if (mode === 'continuity') s.symbolContinuity = 'graphics';
    const before = structuredClone(p);
    if (mode === 'rigid' || mode === 'continuity') {
      expect(() => operation(p)).toThrow();
      expect(p).toEqual(before);
      return;
    }
    const scope = capture(() => ({ project: p, frame: mode === 'outside' ? 9 : 4, revision: 0 }));
    expect(scope.choices).toEqual([]);
    expect(() => scope.resolve('track', 'live', 'art', 0, 'outgoing')).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const value of [NaN, Infinity, -Infinity, '4', null, {}, undefined])
  it(`rejects finite target coercion ${String(value)}`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p);
    expect(() => prepare([{ owner, target: { x: value, y: 3 } as Point }])).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const field of ['owner', 'target', 'x', 'y'])
  it(`rejects ${field} getter with zero reads`, () => {
    const p = fixture(),
      { scope, owner } = operation(p),
      getter = vi.fn(() => {
        throw Error('getter ran');
      }),
      row = { owner, target: target(owner) };
    Object.defineProperty(field === 'x' || field === 'y' ? row.target : row, field, {
      get: getter,
      enumerable: true,
    });
    expect(() => prepare([row])).toThrow();
    expect(getter).not.toHaveBeenCalled();
    scope.dispose();
  });
for (const mode of ['copy', 'json', 'proxy', 'waypoint', 'cubic'])
  it(`rejects ${mode} public owner brands`, () => {
    const p = fixture(),
      { scope, owner } = operation(p);
    let foreign: unknown =
      mode === 'copy'
        ? { ...owner }
        : mode === 'json'
          ? JSON.parse(JSON.stringify(owner))
          : new Proxy(owner, {});
    const ordinary = captureLiveWaypoints(() => ({ project: p, frame: 4, revision: 7 }));
    const q = liveSplitFixture((_p, s) => {
        s.path = { startX: 20, startY: 30, endX: -20, endY: 30 };
      }),
      curve = captureLiveCubicControls(() => ({ project: q, frame: 4, revision: 7 }));
    if (mode === 'waypoint') foreign = ordinary.resolve('track', 'live', 'art', 0);
    if (mode === 'cubic') foreign = curve.resolve('track', 'live', 'art', 'start');
    expect(() => prepare([{ owner: foreign as Owner, target: target(owner) }])).toThrow();
    ordinary.dispose();
    curve.dispose();
    scope.dispose();
  });
it('keeps lazy detached root/count hints and original frozen public coordinates', () => {
  const p = fixture(),
    { scope, owner } = operation(p),
    hints = scope.choices;
  expect(hints).toHaveLength(2);
  expect(Object.keys(hints[0])).toEqual(['layerId', 'spanId', 'shapeId', 'waypointCount']);
  hints[0].shapeId = 'forged';
  expect(scope.choices[0].shapeId).toBe('art');
  expect(Object.isFrozen(owner)).toBe(true);
  expect(Object.isFrozen(owner.anchor)).toBe(true);
  expect(Object.isFrozen(owner.point)).toBe(true);
  expect(() => Object.assign(owner.point, { x: 999 })).toThrow();
  expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
  scope.dispose();
});
for (const mode of ['source', 'frame', 'revision', 'dispose', 'replacement'])
  it(`rejects ${mode} stale original ownership`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let q = p,
      frame = 4,
      revision = 1;
    const scope = capture(() => ({ project: q, frame, revision })),
      owner = scope.resolve('track', 'live', 'art', 0, 'incoming');
    if (mode === 'source') p.name = 'User source edit';
    if (mode === 'frame') frame++;
    if (mode === 'revision') revision++;
    if (mode === 'dispose') scope.dispose();
    if (mode === 'replacement') q = structuredClone(p);
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    if (mode === 'source') expect(p.name).toBe('User source edit');
    else expect(p).toEqual(before);
    scope.dispose();
  });
for (const phase of ['callback', 'reader'])
  for (const cross of [false, true])
    it(`rejects swallowed ${phase} same-source cross-scope ${cross} preparation reentry`, () => {
      const p = fixture();
      let hook = () => {};
      const reader = () => {
          hook();
          return { project: p, frame: 4, revision: 0 };
        },
        scope = capture(reader),
        owner = scope.resolve('track', 'live', 'art', 0, 'incoming'),
        other = cross ? capture(() => ({ project: p, frame: 4, revision: 0 })) : scope,
        alias = other.resolve('track', 'live', 'art', 1, 'outgoing');
      const rows = [{ owner, target: target(owner) }];
      let hit = false;
      const attack = () => {
        if (hit) return;
        hit = true;
        try {
          prepare([{ owner: alias, target: target(alias) }]);
        } catch {
          /* outer preparation must still reject */
        }
      };
      if (phase === 'reader') hook = attack;
      expect(() => prepare(rows, phase === 'callback' ? { validate: attack } : {})).toThrow(
        /reenter|changed/,
      );
      expect(hit).toBe(true);
      hook = () => {};
      scope.dispose();
      other.dispose();
    });
for (const phase of ['first', 'current'])
  it(`poisons swallowed ${phase} reader capture reentry`, () => {
    const p = fixture();
    let attack = phase === 'first',
      hit = false;
    const reader = (): { project: Project; frame: number; revision: number } => {
      if (attack && !hit) {
        hit = true;
        try {
          capture(reader);
        } catch {
          /* cannot swallow ownership failure */
        }
      }
      return { project: p, frame: 4, revision: 0 };
    };
    if (phase === 'first') expect(() => capture(reader)).toThrow(/reenter/);
    else {
      const scope = capture(reader);
      attack = true;
      expect(() => scope.choices).toThrow(/reenter/);
      scope.dispose();
    }
    expect(hit).toBe(true);
  });
for (const change of ['target', 'source', 'callback', 'prototype', 'async'])
  it(`rejects late ${change} admission and preserves retry/source history`, () => {
    const p = fixture(),
      { scope, owner } = operation(p),
      rows = [{ owner, target: target(owner) }],
      options: { validate?: () => void } = {};
    let hit = false;
    options.validate = () => {
      if (hit) return;
      hit = true;
      if (change === 'target') rows[0].target.x++;
      if (change === 'source') p.name = 'Separate source edit';
      if (change === 'callback') options.validate = () => {};
      if (change === 'prototype') Object.setPrototypeOf(options, {});
      if (change === 'async') return Promise.resolve() as unknown as void;
    };
    expect(() => prepare(rows, options)).toThrow();
    expect(hit).toBe(true);
    if (change === 'source') expect(p.name).toBe('Separate source edit');
    else expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
    scope.dispose();
  });
it('rejects overflowing and later stationary all-track requests atomically with recovery', () => {
  const p = fixture(true),
    path = p.layers[1].liveMotionSpans![0].path!;
  path.tangent = true;
  const before = structuredClone(p),
    { scope, owner } = operation(p),
    later = scope.resolve('later', 'live', 'art', 1, 'outgoing');
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: later, target: { ...later.anchor } },
    ]),
  ).toThrow();
  expect(p).toEqual(before);
  const overflow = fixture();
  overflow.layers[0].liveMotionSpans![0].path!.distance = true;
  const extreme = operation(overflow);
  expect(() =>
    prepare([{ owner: extreme.owner, target: { x: Number.MAX_VALUE, y: -Number.MAX_VALUE } }]),
  ).toThrow();
  extreme.scope.dispose();
  expect(p).toEqual(before);
  expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(before, owner));
  scope.dispose();
});
for (const phase of ['snapshot', 'hints', 'output'])
  it(`rejects actual changed ${phase} clones without consuming source or ownership`, () => {
    const p = fixture(),
      before = structuredClone(p),
      native = structuredClone;
    let hit = false;
    const op = phase === 'snapshot' ? undefined : operation(p);
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value),
        q = out as Project;
      if (
        !hit &&
        (phase === 'hints'
          ? Array.isArray(out) && out[0]?.waypointCount === 2
          : phase === 'snapshot'
            ? q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 10
            : q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 17)
      ) {
        hit = true;
        if (phase === 'hints') (out as { shapeId: string }[])[0].shapeId = 'forged';
        else q.name = 'Forged clone';
      }
      return out;
    });
    if (phase === 'snapshot') expect(() => operation(p)).toThrow();
    else if (phase === 'hints') expect(() => op!.scope.choices).toThrow();
    else expect(() => prepare([{ owner: op!.owner, target: target(op!.owner) }])).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
    vi.unstubAllGlobals();
    op?.scope.dispose();
  });
for (const scale of [1e-6, 1, 1e4])
  it(`preserves relative controls at scale ${scale} without clamping`, () => {
    const p = fixture();
    for (const k of p.layers[0].keys)
      for (const a of k.shapes) {
        a.x *= scale;
        a.y *= scale;
        a.width *= scale;
        a.height *= scale;
      }
    const path = p.layers[0].liveMotionSpans![0].path!;
    for (const a of [...path.waypoints!, ...path.waypointTangents!, ...path.waypointIncoming!]) {
      a.x *= scale;
      a.y *= scale;
    }
    const { scope, owner } = operation(p, 1, 'incoming'),
      q = { x: owner.point.x - 1000 * scale, y: owner.point.y + 2000 * scale },
      out = prepare([{ owner, target: q }]);
    expect(out).toEqual(changed(p, owner, q));
    scope.dispose();
  });
it('reopens detached saved recipes for later independent handle editing', () => {
  const p = fixture(),
    a = operation(p),
    out = prepare([{ owner: a.owner, target: target(a.owner) }]);
  a.scope.dispose();
  const saved = JSON.parse(JSON.stringify(out)) as Project,
    b = operation(saved, 1, 'incoming');
  expect(prepare([{ owner: b.owner, target: target(b.owner) }])).toEqual(changed(saved, b.owner));
  b.scope.dispose();
});
it('admits the actual aggregate artwork boundary and rejects original and replacement overflow', () => {
  const p = fixture(),
    a: Vector = {
      id: 'v',
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
      id: 'capacity',
      name: 'Capacity',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({ ...a, id: 'v' + i })),
    },
  ];
  validateProject(p);
  const { scope, owner } = operation(p),
    out = prepare([{ owner, target: target(owner) }]);
  expect(out.symbols).toEqual(p.symbols);
  scope.dispose();
  p.symbols![0].shapes.push({ ...a, id: 'overflow' });
  expect(() => operation(p)).toThrow(/budget/);
  const q = fixture(),
    before = structuredClone(q),
    fresh = operation(q),
    native = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = native(value),
      edited = out as Project;
    if (!hit && edited?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 17) {
      hit = true;
      edited.symbols = [
        {
          id: 'capacity',
          name: 'Capacity',
          width: 1,
          height: 1,
          shapes: Array.from({ length: MAX_SYMBOL_ARTWORK + 1 }, (_, i) => ({ ...a, id: 'v' + i })),
        },
      ];
    }
    return out;
  });
  expect(() => prepare([{ owner: fresh.owner, target: target(fresh.owner) }])).toThrow(/budget/);
  expect(hit).toBe(true);
  expect(q).toEqual(before);
  vi.unstubAllGlobals();
  expect(prepare([{ owner: fresh.owner, target: target(fresh.owner) }])).toEqual(
    changed(q, fresh.owner),
  );
  fresh.scope.dispose();
}, 180000);

for (const mode of ['tangent', 'distance-tangent'])
  it(`rejects independent ${mode} bearing changes but permits original-bearing radius edits`, () => {
    const p = fixture(),
      path = p.layers[0].liveMotionSpans![0].path!;
    path.tangent = true;
    if (mode.includes('distance')) path.distance = true;
    const before = structuredClone(p),
      { scope, owner } = operation(p);
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow(/join|tangent/);
    expect(p).toEqual(before);
    const q = {
      x: owner.anchor.x + (owner.point.x - owner.anchor.x) * 1.1,
      y: owner.anchor.y + (owner.point.y - owner.anchor.y) * 1.1,
    };
    expect(prepare([{ owner, target: q }])).toEqual(changed(before, owner, q));
    scope.dispose();
  });
for (const mode of [
  'unchanged',
  'missing',
  'inherited',
  'nonenumerable',
  'extra',
  'hole',
  'prototype',
])
  it(`rejects raw ${mode} request shapes without input coercion`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      rows: Request[] = [{ owner, target: target(owner) }];
    if (mode === 'unchanged') rows[0].target = { ...owner.point };
    if (mode === 'missing') delete (rows[0].target as Partial<Point>).y;
    if (mode === 'inherited') Object.setPrototypeOf(rows[0].target, {});
    if (mode === 'nonenumerable')
      Object.defineProperty(rows[0], 'owner', { value: owner, enumerable: false });
    if (mode === 'extra') Object.assign(rows[0].target, { extra: 1 });
    if (mode === 'hole') delete rows[0];
    if (mode === 'prototype') Object.setPrototypeOf(rows, {});
    expect(() => prepare(rows)).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const mode of ['getter', 'prototype'])
  it(`rejects final detached ${mode} output before consuming inherited or accessor artwork`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      native = structuredClone,
      getter = vi.fn(() => {
        throw Error('must not read getter');
      });
    let hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value),
        q = out as Project;
      if (!hit && q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 17) {
        hit = true;
        const a = q.layers[0].keys[0].shapes[0];
        if (mode === 'getter') Object.defineProperty(a, 'width', { get: getter, enumerable: true });
        else Object.setPrototypeOf(a, { forged: true });
      }
      return out;
    });
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    expect(hit).toBe(true);
    expect(getter).not.toHaveBeenCalled();
    expect(p).toEqual(before);
    vi.unstubAllGlobals();
    expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
    scope.dispose();
  });

for (const basis of ['plain', 'affine', 'reflected'])
  it(`preserves explicitly aligned compound ${basis} artwork and source mappings`, () => {
    const p = fixture(false, basis),
      s = p.layers[0].liveMotionSpans![0];
    for (const [index, key] of p.layers[0].keys.slice(0, 2).entries())
      for (const a of key.shapes) {
        const rings = [
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
        ];
        Object.assign(a, {
          kind: 'polygon',
          fillRule: 'evenodd',
          points: [],
          contours: index ? rings.reverse() : rings,
          pivot: { x: -100, y: 200 },
        });
      }
    s.options = { affine: true, nodes: true };
    s.correspondence = { order: [1, 0] };
    const before = structuredClone(p),
      { scope, owner } = operation(p, 1, 'incoming', 'second'),
      out = prepare([{ owner, target: target(owner) }]);
    expect(out).toEqual(changed(before, owner));
    expect(out.layers[0].keys).toEqual(before.layers[0].keys);
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const change of ['source', 'target', 'callback'] as const)
  it(`rejects actual ${change} after complete edited output exists`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      rows = [{ owner, target: target(owner) }],
      native = structuredClone;
    let edited = false,
      hit = false;
    const options: { validate?: () => void } = {
      validate: () => {
        if (!edited || hit) return;
        hit = true;
        if (change === 'source') p.name = 'Late source survives';
        if (change === 'target') rows[0].target.y++;
        if (change === 'callback') options.validate = () => {};
      },
    };
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value),
        q = out as Project;
      if (q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 17)
        edited = true;
      return out;
    });
    expect(() => prepare(rows, options)).toThrow();
    expect(edited).toBe(true);
    expect(hit).toBe(true);
    if (change === 'source') expect(p.name).toBe('Late source survives');
    else {
      expect(p).toEqual(before);
      vi.unstubAllGlobals();
      expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
    }
    scope.dispose();
  });

for (const command of ['create', 'update', 'remove'] as const)
  it(`shared ${command} rejects transported output accessors before ordinary validation`, () => {
    const p = fixture(),
      span = structuredClone(p.layers[0].liveMotionSpans![0]);
    if (command === 'create') delete p.layers[0].liveMotionSpans;
    const before = structuredClone(p),
      native = structuredClone,
      getter = vi.fn(() => {
        throw Error('transport accessor ran');
      });
    let hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value),
        q = out as Project,
        layer = q?.layers?.[0],
        path = layer?.liveMotionSpans?.[0]?.path;
      const match =
        !!layer &&
        (command === 'create'
          ? !!path
          : command === 'remove'
            ? !layer.liveMotionSpans?.length
            : path?.waypointTangents?.[1]?.x === 17);
      if (!hit && match) {
        hit = true;
        Object.defineProperty(layer.keys[0].shapes[0], 'width', { enumerable: true, get: getter });
      }
      return out;
    });
    const run = () => {
      if (command === 'create')
        return prepareCreateLiveMotionSpans(p, [{ layerId: 'track', span }]);
      if (command === 'remove')
        return prepareRemoveLiveMotionSpans(p, [{ layerId: 'track', spanId: 'live' }]);
      const path = structuredClone(span.path!);
      path.waypointTangents![1].x = 17;
      return prepareUpdateLiveMotionSpans(p, [
        { layerId: 'track', spanId: 'live', changes: { path } },
      ]);
    };
    expect(run).toThrow();
    expect(hit).toBe(true);
    expect(getter).not.toHaveBeenCalled();
    expect(p).toEqual(before);
    vi.unstubAllGlobals();
    expect(run()).toBeDefined();
    expect(p).toEqual(before);
  });

it('detaches returned library base/timeline artwork from source, private capture and later edits', () => {
  const p = fixture(),
    a = structuredClone(p.layers[0].keys[0].shapes[0]);
  p.symbols = [
    {
      id: 'unused',
      name: 'Unused',
      width: 20,
      height: 20,
      shapes: [a],
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...structuredClone(a), x: 30 }] }] },
    },
  ];
  const before = structuredClone(p),
    { scope, owner } = operation(p),
    out = prepare([{ owner, target: target(owner) }]);
  out.symbols![0].shapes[0].fill = '#0000ff';
  out.symbols![0].timeline!.keys[0].shapes[0].x = 777;
  expect(p).toEqual(before);
  expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(before, owner));
  scope.dispose();
});
for (const role of ['incoming', 'outgoing'] as const)
  it(`rejects selected ${role} metadata rather than stripping original trajectory data`, () => {
    const p = fixture(),
      path = p.layers[0].liveMotionSpans![0].path!;
    Object.assign(role === 'incoming' ? path.waypointIncoming![0] : path.waypointTangents![1], {
      pressure: 0.5,
    });
    const before = structuredClone(p),
      { scope, owner } = operation(p, 0, role);
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
  });

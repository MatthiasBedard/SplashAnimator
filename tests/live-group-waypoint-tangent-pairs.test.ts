import { afterEach, expect, it, vi } from 'vitest';
import { type Project, type Point } from '../packages/document/src';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import {
  captureLiveGroupWaypointTangents as capture,
  prepareLiveGroupWaypointTangentPositions as prepare,
  prepareLiveGroupWaypointTangentPairs as pair,
  type LiveGroupWaypointTangentOwner as Owner,
  type LiveGroupWaypointTangentRole as Role,
  type LiveGroupWaypointTangentPairOptions as Options,
} from '../packages/animation/src/live-group-waypoint-tangents';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(two = false, basis = 'plain', mode = 'rigid') {
  const { p } = liveRotationFixture(mode, basis, true);
  p.layers[0].liveMotionSpans![0].path = {
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
  if (two) secondRotationTrack(p);
  return p;
}
function operation(p = fixture(), index = 0, role: Role = 'outgoing', shape = 'outer', frame = 4) {
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
const pairedOptions: Options = { coupling: 'aligned' };
function pairedExpected(p: Project, o: Owner, q: Point) {
  const out = changed(p, o, q),
    before = p.layers
      .find((l) => l.id === o.layerId)!
      .liveMotionSpans!.find((s) => s.id === o.spanId)!.path!,
    after = out.layers
      .find((l) => l.id === o.layerId)!
      .liveMotionSpans!.find((s) => s.id === o.spanId)!.path!;
  const dx = q.x - o.anchor.x,
    dy = q.y - o.anchor.y,
    length = Math.hypot(dx, dy),
    original =
      o.role === 'incoming'
        ? before.waypointTangents![o.waypointIndex + 1]
        : before.waypointIncoming![o.waypointIndex],
    radius = Math.hypot(original.x, original.y),
    v = { ...original, x: (-dx / length) * radius, y: (-dy / length) * radius };
  if (o.role === 'incoming') {
    (after.waypointIncoming as Point[])[o.waypointIndex] = {
      ...before.waypointIncoming![o.waypointIndex],
      x: dx,
      y: dy,
    };
    (after.waypointTangents as Point[])[o.waypointIndex + 1] = v;
  } else {
    (after.waypointTangents as Point[])[o.waypointIndex + 1] = {
      ...before.waypointTangents![o.waypointIndex + 1],
      x: dx,
      y: dy,
    };
    (after.waypointIncoming as Point[])[o.waypointIndex] = v;
  }
  return out;
}
function pairTarget(o: Owner) {
  const sign = o.role === 'incoming' ? -1 : 1;
  return { x: o.anchor.x + 15 * sign, y: o.anchor.y - 20 * sign };
}
for (const role of ['incoming', 'outgoing'] as const)
  for (const index of [0, 1])
    it(`aligned pair admits tangent-bearing ${role}/${index} turns that independent editing rejects`, () => {
      const p = fixture(),
        path = p.layers[0].liveMotionSpans![0].path!;
      Object.assign(path, { tangent: true, headingOffset: 10, headingOffsetEnd: 20 });
      const before = structuredClone(p),
        { scope, owner } = operation(p, index, role),
        sign = role === 'incoming' ? -1 : 1,
        q = {
          x: owner.anchor.x + (index ? 16 : 15) * sign,
          y: owner.anchor.y + (index ? -5 : 10) * sign,
        };
      expect(() => prepare([{ owner, target: q }])).toThrow(/join|tangent/);
      const out = pair([{ owner, target: q }], pairedOptions);
      expect(p).toEqual(before);
      expect(out.layers[0].liveMotionSpans![0].path!.tangent).toBe(true);
      const a = out.layers[0].liveMotionSpans![0].path!.waypointTangents![index + 1],
        b = out.layers[0].liveMotionSpans![0].path!.waypointIncoming![index];
      expect(a.x * b.y - a.y * b.x).toBeCloseTo(0, 10);
      expect(a.x * b.x + a.y * b.y).toBeLessThan(0);
      scope.dispose();
    });
for (const scale of [1e-150, 1e-12, 1e-6, 1, 1e4])
  for (const translation of scale < 1e-6 ? [0] : [0, 1e6])
    it(`aligned pair uses relative radius at scale${scale}/translation${translation}`, () => {
      const p = fixture(),
        path = p.layers[0].liveMotionSpans![0].path!;
      for (const key of p.layers[0].keys.slice(0, 2))
        for (const a of key.shapes) {
          a.x = a.x * scale + translation;
          a.y = a.y * scale + translation;
          a.width *= scale;
          a.height *= scale;
        }
      for (const points of [path.waypoints!, path.waypointTangents!, path.waypointIncoming!])
        for (const q of points) {
          q.x *= scale;
          q.y *= scale;
        }
      for (const k of ['startX', 'startY', 'endX', 'endY'] as const) path[k] *= scale;
      const before = structuredClone(p),
        { scope, owner } = operation(p),
        q = { x: owner.anchor.x + 17 * scale, y: owner.anchor.y + 8 * scale },
        out = pair([{ owner, target: q }], pairedOptions),
        h = out.layers[0].liveMotionSpans![0].path!.waypointIncoming![0],
        radius = Math.hypot(path.waypointIncoming![0].x, path.waypointIncoming![0].y),
        dx = q.x - owner.anchor.x,
        dy = q.y - owner.anchor.y;
      expect(out.layers[0].liveMotionSpans![0].path!.waypointTangents![1]).toEqual({
        x: dx,
        y: dy,
      });
      expect(Math.abs(Math.hypot(h.x, h.y) - radius) / radius).toBeLessThan(2e-15);
      expect(
        Math.abs(
          (h.x / radius) * (dy / Math.hypot(dx, dy)) - (h.y / radius) * (dx / Math.hypot(dx, dy)),
        ),
      ).toBeLessThan(1e-15);
      expect(h.x * dx + h.y * dy).toBeLessThan(0);
      expect(p).toEqual(before);
      scope.dispose();
    });
for (const role of ['incoming', 'outgoing'] as const)
  it(`aligned pair ${role} preserves a real zero-length opposite without inventing a radius`, () => {
    const p = fixture(),
      path = p.layers[0].liveMotionSpans![0].path!;
    Object.assign(role === 'incoming' ? path.waypointTangents![1] : path.waypointIncoming![0], {
      x: 0,
      y: 0,
    });
    const { scope, owner } = operation(p, 0, role);
    const out = pair([{ owner, target: pairTarget(owner) }], pairedOptions),
      v =
        role === 'incoming'
          ? out.layers[0].liveMotionSpans![0].path!.waypointTangents![1]
          : out.layers[0].liveMotionSpans![0].path!.waypointIncoming![0];
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    scope.dispose();
  });
for (const mode of ['zero', 'no-op', 'NaN', 'Infinity'] as const)
  it(`aligned pair rejects ${mode} atomically and keeps a source-valid retry`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      q =
        mode === 'zero'
          ? { ...owner.anchor }
          : mode === 'no-op'
            ? { ...owner.point }
            : mode === 'NaN'
              ? { x: NaN, y: 10 }
              : { x: Infinity, y: 10 };
    expect(() => pair([{ owner, target: q }], pairedOptions)).toThrow();
    expect(p).toEqual(before);
    expect(pair([{ owner, target: pairTarget(owner) }], pairedOptions)).toEqual(
      pairedExpected(before, owner, pairTarget(owner)),
    );
    scope.dispose();
  });
for (const mode of ['same', 'opposite', 'root-alias'] as const)
  it(`aligned pair rejects overlapping ${mode} requests before publication`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      other = scope.resolve(
        'track',
        'live',
        mode === 'root-alias' ? 'second' : 'outer',
        0,
        mode === 'opposite' ? 'incoming' : 'outgoing',
      );
    expect(() =>
      pair(
        [
          { owner, target: pairTarget(owner) },
          { owner: other, target: pairTarget(other) },
        ],
        pairedOptions,
      ),
    ).toThrow(/once/);
    expect(p).toEqual(before);
    scope.dispose();
  });
it('aligned pair composes independent waypoint slots across tracks while preserving every unrequested value', () => {
  const p = fixture(true),
    before = structuredClone(p),
    { scope, owner } = operation(p),
    other = scope.resolve('track', 'live', 'outer', 1, 'incoming'),
    later = scope.resolve('later', 'live', 'second', 0, 'outgoing'),
    rows = [owner, other, later].map((owner) => ({ owner, target: pairTarget(owner) }));
  let expected = before;
  for (const r of rows) expected = pairedExpected(expected, r.owner, r.target);
  expect(pair(rows, pairedOptions)).toEqual(expected);
  expect(p).toEqual(before);
  scope.dispose();
});
it('aligned pair rejects an invalid later track without writing the earlier prepared pair', () => {
  const p = fixture(true),
    before = structuredClone(p),
    { scope, owner } = operation(p),
    later = scope.resolve('later', 'live', 'outer', 1, 'outgoing');
  expect(() =>
    pair(
      [
        { owner, target: pairTarget(owner) },
        { owner: later, target: { ...later.anchor } },
      ],
      pairedOptions,
    ),
  ).toThrow(/zero/);
  expect(p).toEqual(before);
  expect(pair([{ owner, target: pairTarget(owner) }], pairedOptions)).toEqual(
    pairedExpected(p, owner, pairTarget(owner)),
  );
  scope.dispose();
});
for (const mode of ['missing', 'false', 'unknown', 'getter', 'nonenumerable', 'extra'] as const)
  it(`aligned pair requires explicit original ${mode} coupling data`, () => {
    const p = fixture(),
      { scope, owner } = operation(p),
      get = vi.fn(() => 'aligned'),
      options: Record<string, unknown> = { coupling: 'aligned' };
    if (mode === 'missing') delete options.coupling;
    if (mode === 'false') options.coupling = false;
    if (mode === 'unknown') options.coupling = 'mirrored';
    if (mode === 'getter') Object.defineProperty(options, 'coupling', { get, enumerable: true });
    if (mode === 'nonenumerable')
      Object.defineProperty(options, 'coupling', { value: 'aligned', enumerable: false });
    if (mode === 'extra') options.silentlyEnable = true;
    expect(() => pair([{ owner, target: pairTarget(owner) }], options as Options)).toThrow();
    expect(get).not.toHaveBeenCalled();
    scope.dispose();
  });
for (const field of ['owner', 'target', 'x', 'y'] as const)
  it(`aligned pair rejects raw ${field} getters without reading them`, () => {
    const p = fixture(),
      { scope, owner } = operation(p),
      get = vi.fn(() => 1),
      row = { owner, target: pairTarget(owner) };
    Object.defineProperty(field === 'x' || field === 'y' ? row.target : row, field, {
      get,
      enumerable: true,
    });
    expect(() => pair([row], pairedOptions)).toThrow();
    expect(get).not.toHaveBeenCalled();
    scope.dispose();
  });
for (const mode of ['copy', 'json', 'proxy', 'disposed', 'source', 'frame', 'revision'] as const)
  it(`aligned pair rejects ${mode} owner/source lifetimes`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let frame = 4,
      revision = 7;
    const scope = capture(() => ({ project: p, frame, revision })),
      original = scope.resolve('track', 'live', 'outer', 0, 'outgoing');
    let owner = original;
    if (mode === 'copy') owner = { ...original };
    if (mode === 'json') owner = JSON.parse(JSON.stringify(original));
    if (mode === 'proxy') owner = new Proxy(original, {});
    if (mode === 'disposed') scope.dispose();
    if (mode === 'source') p.name = 'Independent user edit';
    if (mode === 'frame') frame++;
    if (mode === 'revision') revision++;
    expect(() => pair([{ owner, target: pairTarget(original) }], pairedOptions)).toThrow();
    if (mode === 'source') expect(p.name).toBe('Independent user edit');
    else expect(p).toEqual(before);
    scope.dispose();
  });
for (const mode of ['same-source', 'different-source'] as const)
  it(`aligned pair rejects mixed capture identity ${mode} before callback inspection`, () => {
    const p = fixture(),
      a = operation(p),
      b = operation(mode === 'same-source' ? p : fixture()),
      get = vi.fn(() => () => {}),
      options: Options = { coupling: 'aligned' };
    Object.defineProperty(options, 'validate', { get, enumerable: true });
    expect(() =>
      pair(
        [
          { owner: a.owner, target: pairTarget(a.owner) },
          { owner: b.owner, target: pairTarget(b.owner) },
        ],
        options,
      ),
    ).toThrow(/capture scope/);
    expect(get).not.toHaveBeenCalled();
    a.scope.dispose();
    b.scope.dispose();
  });
for (const mode of ['target', 'source', 'coupling', 'callback', 'prototype', 'async'] as const)
  it(`aligned pair rejects late ${mode} admission changes without writes`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      q = pairTarget(owner),
      rows = [{ owner, target: q }],
      options: Options = { coupling: 'aligned' };
    let first = true;
    options.validate = () => {
      if (!first) return;
      first = false;
      if (mode === 'target') q.x++;
      if (mode === 'source') p.name = 'User change';
      if (mode === 'coupling') (options as unknown as { coupling: string }).coupling = 'mirrored';
      if (mode === 'callback') options.validate = () => {};
      if (mode === 'prototype') Object.setPrototypeOf(options, {});
      if (mode === 'async') return Promise.resolve() as unknown as void;
    };
    expect(() => pair(rows, options)).toThrow();
    if (mode === 'source') expect(p.name).toBe('User change');
    else expect(p).toEqual(before);
    scope.dispose();
  });
for (const outer of ['pair', 'independent'] as const)
  for (const inner of ['pair', 'independent'] as const)
    it(`aligned pair shares ${outer}/${inner} preparation reentry poisoning`, () => {
      const p = fixture(),
        before = structuredClone(p),
        { scope, owner } = operation(p);
      let attack = true;
      const run = () => {
        if (!attack) return;
        attack = false;
        try {
          (inner === 'pair'
            ? () => pair([{ owner, target: pairTarget(owner) }], pairedOptions)
            : () => prepare([{ owner, target: pairTarget(owner) }]))();
        } catch {}
      };
      expect(() =>
        outer === 'pair'
          ? pair([{ owner, target: pairTarget(owner) }], { coupling: 'aligned', validate: run })
          : prepare([{ owner, target: pairTarget(owner) }], { validate: run }),
      ).toThrow(/reenter|reentered|changed/);
      expect(p).toEqual(before);
      expect(pair([{ owner, target: pairTarget(owner) }], pairedOptions)).toEqual(
        pairedExpected(p, owner, pairTarget(owner)),
      );
      scope.dispose();
    });
for (const phase of ['candidate', 'output'] as const)
  it(`aligned pair rejects actual late ${phase} source edits after controls exist`, () => {
    const p = fixture(),
      { scope, owner } = operation(p),
      native = structuredClone;
    let seen = 0,
      hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value),
        q = out as Project;
      if (q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 15) {
        seen++;
        if (!hit && seen >= (phase === 'candidate' ? 1 : 2)) {
          hit = true;
          p.name = 'Late user change';
        }
      }
      return out;
    });
    expect(() => pair([{ owner, target: pairTarget(owner) }], pairedOptions)).toThrow();
    expect(hit).toBe(true);
    expect(p.name).toBe('Late user change');
    scope.dispose();
  });
it('aligned pair detaches public hints/output/private source and reopens for a later independent edit', () => {
  const p = fixture(),
    before = structuredClone(p),
    { scope, owner } = operation(p),
    hints = scope.choices;
  hints[0].groupId = 'forged';
  const q = pairTarget(owner),
    out = pair([{ owner, target: q }], pairedOptions),
    saved = JSON.parse(JSON.stringify(out)) as Project;
  out.layers[0].keys[0].shapes[0].x = 999;
  out.layers[0].liveMotionSpans![0].path!.waypointTangents![1].x = 999;
  expect(pair([{ owner, target: q }], pairedOptions)).toEqual(pairedExpected(before, owner, q));
  expect(p).toEqual(before);
  scope.dispose();
  const next = operation(saved, 1, 'incoming');
  expect(prepare([{ owner: next.owner, target: target(next.owner) }])).toEqual(
    changed(saved, next.owner),
  );
  next.scope.dispose();
});
it('aligned pair cannot silently opt in through the independent method', () => {
  const p = fixture(),
    { scope, owner } = operation(p);
  expect(() => prepare([{ owner, target: pairTarget(owner) }], pairedOptions)).toThrow();
  expect(prepare([{ owner, target: pairTarget(owner) }])).toEqual(
    changed(p, owner, pairTarget(owner)),
  );
  scope.dispose();
});

it('aligned pair retains rejection of unsupported original trajectory metadata without discarding it', () => {
  const p = fixture(),
    path = p.layers[0].liveMotionSpans![0].path!;
  Object.assign(path.waypointTangents![1], { pressure: 0.6 });
  Object.assign(path.waypointIncoming![0], { pressure: 0.3 });
  const before = structuredClone(p),
    { scope, owner } = operation(p);
  expect(() => pair([{ owner, target: pairTarget(owner) }], pairedOptions)).toThrow(
    /trajectory point|original X\/Y data/,
  );
  expect(() => prepare([{ owner, target: pairTarget(owner) }])).toThrow(
    /trajectory point|original X\/Y data/,
  );
  expect(p).toEqual(before);
  scope.dispose();
});
for (const mode of ['distance', 'radius', 'subnormal'] as const)
  it(`aligned pair rejects ${mode} overflow/uncertainty without weakening numeric admission`, () => {
    const p = fixture(),
      path = p.layers[0].liveMotionSpans![0].path!;
    if (mode === 'distance') path.distance = true;
    if (mode === 'radius')
      Object.assign(path.waypointIncoming![0], { x: Number.MAX_VALUE, y: Number.MAX_VALUE });
    if (mode === 'subnormal')
      Object.assign(path.waypointIncoming![0], { x: Number.MIN_VALUE, y: 0 });
    const before = structuredClone(p),
      { scope, owner } = operation(p),
      q = mode === 'distance' ? { x: Number.MAX_VALUE, y: -Number.MAX_VALUE } : pairTarget(owner);
    expect(() => pair([{ owner, target: q }], pairedOptions)).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const method of ['pair', 'independent'] as const)
  it(`aligned pair rejects swallowed source-reader ${method} reentry and preserves retry`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let armed = false,
      hit = false;
    const scope = capture(() => {
      if (armed && !hit) {
        hit = true;
        try {
          if (method === 'pair') pair([{ owner, target: pairTarget(owner) }], pairedOptions);
          else prepare([{ owner, target: pairTarget(owner) }]);
        } catch {}
      }
      return { project: p, frame: 4, revision: 7 };
    });
    const owner = scope.resolve('track', 'live', 'outer', 0, 'outgoing');
    armed = true;
    expect(() => pair([{ owner, target: pairTarget(owner) }], pairedOptions)).toThrow(
      /reenter|reentered|changed/,
    );
    expect(hit).toBe(true);
    expect(p).toEqual(before);
    armed = false;
    expect(pair([{ owner, target: pairTarget(owner) }], pairedOptions)).toEqual(
      pairedExpected(p, owner, pairTarget(owner)),
    );
    scope.dispose();
  });
for (const mode of [
  'missing incoming',
  'missing outgoing',
  'automatic',
  'rigid',
  'hidden',
  'locked',
] as const)
  it(`aligned pair cannot invent or widen ${mode} original ownership`, () => {
    const p = fixture(),
      span = p.layers[0].liveMotionSpans![0];
    if (mode === 'missing incoming') delete span.path!.waypointIncoming;
    if (mode === 'missing outgoing') {
      delete span.path!.waypointIncoming;
      delete span.path!.waypointTangents;
    }
    if (mode === 'automatic') {
      delete span.path!.waypointIncoming;
      delete span.path!.waypointTangents;
    }
    if (mode === 'rigid') {
      span.rotation!.rigidGroups = false;
      for (const key of p.layers[0].keys.slice(0, 2))
        for (const shape of key.shapes) delete shape.groups;
    }
    if (mode === 'hidden') p.layers[0].visible = false;
    if (mode === 'locked') p.layers[0].locked = true;
    const scope = capture(() => ({ project: p, frame: 4, revision: 7 }));
    expect(scope.choices).toEqual([]);
    expect(() => scope.resolve('track', 'live', 'outer', 0, 'outgoing')).toThrow();
    scope.dispose();
  });
for (const mode of ['distance', 'distance-tangent'])
  for (const role of ['incoming', 'outgoing'] as const)
    it(`aligned pair preserves explicit ${mode}/${role} options and finite full-frame sampling`, () => {
      const p = fixture(),
        path = p.layers[0].liveMotionSpans![0].path!;
      path.distance = true;
      if (mode === 'distance-tangent')
        Object.assign(path, { tangent: true, headingOffset: 10, headingOffsetEnd: 20 });
      const before = structuredClone(p),
        { scope, owner } = operation(p, 0, role),
        sign = role === 'incoming' ? -1 : 1,
        q = { x: owner.anchor.x + 15 * sign, y: owner.anchor.y + 20 * sign },
        out = pair([{ owner, target: q }], pairedOptions);
      expect(out).toEqual(pairedExpected(p, owner, q));
      expect(p).toEqual(before);
      const sampler = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]);
      for (let f = 0; f <= 8; f++)
        for (const a of sampler.sample(f))
          expect([a.x, a.y, a.rotation].every(Number.isFinite)).toBe(true);
      sampler.dispose();
      scope.dispose();
    });
it('aligned pair retains detached library base/timeline data and fixed source settings', () => {
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
    q = pairTarget(owner),
    out = pair([{ owner, target: q }], pairedOptions);
  expect(out).toEqual(pairedExpected(p, owner, q));
  out.symbols![0].shapes[0].fill = '#0000ff';
  out.symbols![0].timeline!.keys[0].shapes[0].x = 999;
  expect(p).toEqual(before);
  expect(pair([{ owner, target: q }], pairedOptions)).toEqual(pairedExpected(p, owner, q));
  scope.dispose();
});
for (const prototype of [Object.prototype, null])
  it(`aligned pair snapshots supported callback prototype ${prototype === null ? 'null' : 'plain'}`, () => {
    const p = fixture(),
      { scope, owner } = operation(p),
      callback = vi.fn(),
      options = Object.assign(Object.create(prototype), {
        coupling: 'aligned',
        validate: callback,
      });
    expect(pair([{ owner, target: pairTarget(owner) }], options)).toEqual(
      pairedExpected(p, owner, pairTarget(owner)),
    );
    expect(callback).toHaveBeenCalled();
    scope.dispose();
  });
it('aligned pair checks callback identity again after actual reader callbacks', () => {
  const p = fixture();
  let armed = false,
    hit = false;
  const options: Options = { coupling: 'aligned', validate: () => {} },
    scope = capture(() => {
      if (armed && !hit) {
        hit = true;
        options.validate = () => {};
      }
      return { project: p, frame: 4, revision: 7 };
    });
  const owner = scope.resolve('track', 'live', 'outer', 0, 'outgoing');
  armed = true;
  expect(() => pair([{ owner, target: pairTarget(owner) }], options)).toThrow(/callback changed/);
  expect(hit).toBe(true);
  scope.dispose();
});
it('aligned pair rejects mixed scopes before even inspecting a callback descriptor trap', () => {
  const p = fixture(),
    a = operation(p),
    b = operation(p);
  let reads = 0;
  const options = new Proxy<Options>(
    { coupling: 'aligned', validate: () => {} },
    {
      getOwnPropertyDescriptor(t, k) {
        if (k === 'validate') reads++;
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
    },
  );
  expect(() =>
    pair(
      [
        { owner: a.owner, target: pairTarget(a.owner) },
        { owner: b.owner, target: pairTarget(b.owner) },
      ],
      options,
    ),
  ).toThrow(/capture scope/);
  expect(reads).toBe(0);
  a.scope.dispose();
  b.scope.dispose();
});

function weight(frame: number, index: number, role: Role) {
  const t = (frame / 8) * 3,
    segment = Math.floor(t),
    u = t - segment;
  return frame === 8 || segment !== (role === 'incoming' ? index : index + 1)
    ? 0
    : role === 'incoming'
      ? 3 * (1 - u) * u * u
      : 3 * (1 - u) * (1 - u) * u;
}
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const group of ['outer', 'second'])
      for (const index of [0, 1])
        for (const role of ['incoming', 'outgoing'] as const)
          it(`aligned group pair ${mode}/${basis}/${group}/${index}/${role} preserves original radius and all shared poses`, () => {
            const p = fixture(false, basis, mode),
              before = structuredClone(p),
              { scope, owner } = operation(p, index, role, group),
              q = pairTarget(owner),
              out = pair([{ owner, target: q }], pairedOptions),
              expected = pairedExpected(p, owner, q);
            const a = out.layers[0].liveMotionSpans![0].path!,
              b = before.layers[0].liveMotionSpans![0].path!,
              selected =
                role === 'incoming' ? a.waypointIncoming![index] : a.waypointTangents![index + 1],
              opposite =
                role === 'incoming' ? a.waypointTangents![index + 1] : a.waypointIncoming![index],
              originalOpposite =
                role === 'incoming' ? b.waypointTangents![index + 1] : b.waypointIncoming![index];
            expect(out).toEqual(expected);
            expect(Math.hypot(opposite.x, opposite.y)).toBeCloseTo(
              Math.hypot(originalOpposite.x, originalOpposite.y),
              12,
            );
            expect(selected.x * opposite.y - selected.y * opposite.x).toBeCloseTo(0, 10);
            expect(selected.x * opposite.x + selected.y * opposite.y).toBeLessThan(0);
            expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(before));
            const make = (p: Project) =>
                createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0]),
              prior = make(before),
              next = make(out);
            try {
              for (let frame = 0; frame <= 8; frame++) {
                const pa = prior.sample(frame),
                  pb = next.sample(frame),
                  wi = weight(frame, index, 'incoming'),
                  wo = weight(frame, index, 'outgoing'),
                  dx =
                    (a.waypointIncoming![index].x - b.waypointIncoming![index].x) * wi +
                    (a.waypointTangents![index + 1].x - b.waypointTangents![index + 1].x) * wo,
                  dy =
                    (a.waypointIncoming![index].y - b.waypointIncoming![index].y) * wi +
                    (a.waypointTangents![index + 1].y - b.waypointTangents![index + 1].y) * wo;
                expect(pb.map((s) => s.id)).toEqual(pa.map((s) => s.id));
                for (let i = 0; i < pa.length; i++) {
                  expect(pb[i].x - pa[i].x).toBeCloseTo(dx, 9);
                  expect(pb[i].y - pa[i].y).toBeCloseTo(dy, 9);
                  expect({ ...pb[i], x: pa[i].x, y: pa[i].y }).toEqual(pa[i]);
                }
              }
            } finally {
              prior.dispose();
              next.dispose();
              scope.dispose();
            }
            expect(p).toEqual(before);
          });

for (const first of ['incoming', 'outgoing'] as const)
  for (const second of ['incoming', 'outgoing'] as const)
    it(`aligned group aliases reserve both bank roles for ${first}/${second} across distinct groups`, () => {
      const p = fixture(),
        before = structuredClone(p),
        scope = capture(() => ({ project: p, frame: 4, revision: 7 })),
        a = scope.resolve('track', 'live', 'outer', 0, first),
        b = scope.resolve('track', 'live', 'second', 0, second);
      expect(() =>
        pair(
          [
            { owner: a, target: pairTarget(a) },
            { owner: b, target: pairTarget(b) },
          ],
          pairedOptions,
        ),
      ).toThrow(/once/);
      expect(p).toEqual(before);
      scope.dispose();
    });
for (const place of ['selected', 'opposite', 'untouched'] as const)
  it(`aligned group controls reject ${place} unsupported point metadata without stripping original values`, () => {
    const p = fixture(),
      path = p.layers[0].liveMotionSpans![0].path!,
      point =
        place === 'selected'
          ? path.waypointTangents![1]
          : place === 'opposite'
            ? path.waypointIncoming![0]
            : path.waypointIncoming![1];
    Object.assign(point, { pressure: 0.5 });
    const before = structuredClone(p),
      { scope, owner } = operation(p);
    expect(() => pair([{ owner, target: pairTarget(owner) }], pairedOptions)).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const basis of ['plain', 'affine', 'reflected'])
  it(`aligned group pairs keep fixed compound topology and nested hierarchy ${basis}`, () => {
    const p = fixture(false, basis);
    for (const key of p.layers[0].keys.slice(0, 2))
      for (const shape of key.shapes)
        Object.assign(shape, {
          kind: 'polygon',
          fillRule: 'evenodd',
          points: [],
          contours: [
            [
              { x: 0, y: 0 },
              { x: 24, y: 0 },
              { x: 24, y: 20 },
              { x: 0, y: 20 },
            ],
            [
              { x: 3, y: 4 },
              { x: 8, y: 9 },
              { x: 13, y: 4 },
            ],
          ],
        });
    const before = structuredClone(p),
      { scope, owner } = operation(p, 1, 'incoming', 'second'),
      q = pairTarget(owner),
      out = pair([{ owner, target: q }], pairedOptions);
    expect(out).toEqual(pairedExpected(p, owner, q));
    expect(out.layers[0].keys).toEqual(before.layers[0].keys);
    expect(p).toEqual(before);
    scope.dispose();
  });

it('group pair ownership never accepts a genuine plain-root handle or inspects caller options for it', async () => {
  const { captureLiveWaypointTangents } =
    await import('../packages/animation/src/live-waypoint-tangents');
  const p = fixture();
  p.layers[0].liveMotionSpans![0].rotation!.rigidGroups = false;
  for (const key of p.layers[0].keys.slice(0, 2))
    for (const shape of key.shapes) delete shape.groups;
  const scope = captureLiveWaypointTangents(() => ({ project: p, frame: 4, revision: 7 })),
    root = scope.resolve('track', 'live', 'a', 0, 'outgoing'),
    get = vi.fn(() => 'aligned'),
    options = {} as Options;
  Object.defineProperty(options, 'coupling', { enumerable: true, get });
  expect(() =>
    pair(
      [{ owner: root as unknown as Owner, target: { x: root.point.x + 4, y: root.point.y - 3 } }],
      options,
    ),
  ).toThrow(/ownership/);
  expect(get).not.toHaveBeenCalled();
  scope.dispose();
});

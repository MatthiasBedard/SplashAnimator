import { afterEach, expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  type Project,
  type Point,
  type Vector,
} from '../packages/document/src';
import { liveSplitFixture } from './live-motion-split-fixture';
import {
  captureLiveWaypointTangents as capture,
  prepareLiveWaypointTangentPositions as prepare,
  prepareLiveWaypointTangentPairs as pair,
  type LiveWaypointTangentOwner as Owner,
  type LiveWaypointTangentRole as Role,
  type LiveWaypointTangentPairOptions as Options,
} from '../packages/animation/src/live-waypoint-tangents';
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
for (const basis of ['plain', 'affine', 'reflected'])
  for (const root of ['art', 'second'])
    for (const index of [0, 1])
      for (const role of ['incoming', 'outgoing'] as const)
        it(`aligned pair ${basis}/${root}/${index}/${role} preserves radius, all keys and independent curve oracles`, () => {
          const p = fixture(false, basis);
          const before = structuredClone(p),
            { scope, owner } = operation(p, index, role, root),
            q = pairTarget(owner),
            out = pair([{ owner, target: q }], pairedOptions),
            expected = pairedExpected(before, owner, q);
          expect(out).toEqual(expected);
          expect(p).toEqual(before);
          expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(before));
          const sampler = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]);
          for (const frame of [0, 1, 2, 4, 6, 7, 8])
            for (const root of [0, 1]) {
              const a = sampler.sample(frame)[root],
                b = oracle(expected, frame, root);
              expect(a.x).toBeCloseTo(b.x, 9);
              expect(a.y).toBeCloseTo(b.y, 9);
            }
          sampler.dispose();
          scope.dispose();
        });
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
        mode === 'root-alias' ? 'second' : 'art',
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
    other = scope.resolve('track', 'live', 'art', 1, 'incoming'),
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
    later = scope.resolve('later', 'live', 'art', 1, 'outgoing');
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
      original = scope.resolve('track', 'live', 'art', 0, 'outgoing');
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
  hints[0].shapeId = 'forged';
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
    /trajectory point/,
  );
  expect(() => prepare([{ owner, target: pairTarget(owner) }])).toThrow(/trajectory point/);
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
    const owner = scope.resolve('track', 'live', 'art', 0, 'outgoing');
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
      span.rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
      for (const key of p.layers[0].keys.slice(0, 2))
        for (const shape of key.shapes) shape.groups = ['complete'];
    }
    if (mode === 'hidden') p.layers[0].visible = false;
    if (mode === 'locked') p.layers[0].locked = true;
    const scope = capture(() => ({ project: p, frame: 4, revision: 7 }));
    expect(scope.choices).toEqual([]);
    expect(() => scope.resolve('track', 'live', 'art', 0, 'outgoing')).toThrow();
    scope.dispose();
  });
it('aligned pair rejects a late replacement aggregate overflow with original values intact', () => {
  const p = fixture(),
    before = structuredClone(p),
    { scope, owner } = operation(p),
    native = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = native(value),
      q = out as Project;
    if (!hit && q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 15) {
      hit = true;
      const a: Vector = {
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
      q.symbols = [
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
  expect(() => pair([{ owner, target: pairTarget(owner) }], pairedOptions)).toThrow(/budget/);
  expect(hit).toBe(true);
  expect(p).toEqual(before);
  vi.unstubAllGlobals();
  expect(pair([{ owner, target: pairTarget(owner) }], pairedOptions)).toEqual(
    pairedExpected(p, owner, pairTarget(owner)),
  );
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
for (const basis of ['plain', 'affine', 'reflected'])
  it(`aligned pair preserves aligned compound ${basis} geometry/order/settings with independent curve coordinates`, () => {
    const p = fixture(false, basis),
      span = p.layers[0].liveMotionSpans![0];
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
        });
      }
    span.options = { affine: true, nodes: true };
    span.correspondence = { order: [1, 0] };
    const before = structuredClone(p),
      { scope, owner } = operation(p, 1, 'incoming', 'second'),
      q = pairTarget(owner),
      out = pair([{ owner, target: q }], pairedOptions),
      expected = pairedExpected(p, owner, q);
    expect(out).toEqual(expected);
    expect(out.layers[0].keys).toEqual(before.layers[0].keys);
    expect(p).toEqual(before);
    const sampler = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]);
    for (const frame of [1, 2, 4, 6, 7])
      for (const root of [0, 1]) {
        const a = sampler.sample(frame)[root],
          b = oracle(expected, frame, root);
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.y).toBeCloseTo(b.y, 9);
      }
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
  const owner = scope.resolve('track', 'live', 'art', 0, 'outgoing');
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

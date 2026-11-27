import { afterEach, expect, it, vi } from 'vitest';
import { MAX_SYMBOL_ARTWORK, newLayer, type Project, type Point } from '../packages/document/src';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import { liveSplitFixture } from './live-motion-split-fixture';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import {
  captureLiveGroupWaypointTangents as capture,
  prepareLiveGroupWaypointTangentPositions as prepare,
  type LiveGroupWaypointTangentOwner as Owner,
  type LiveGroupWaypointTangentRequest as Request,
  type LiveGroupWaypointTangentRole as Role,
} from '../packages/animation/src/live-group-waypoint-tangents';
import {
  captureLiveWaypointTangents as captureRoot,
  prepareLiveWaypointTangentPositions as prepareRoot,
} from '../packages/animation/src/live-waypoint-tangents';
import {
  captureLiveGroupWaypoints,
  prepareLiveGroupWaypointPositions,
} from '../packages/animation/src/live-group-waypoints';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(mode = 'rigid', basis = 'plain', two = false) {
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
function operation(
  p = fixture(),
  index = 0,
  role: Role = 'outgoing',
  group = 'outer',
  layer = 'track',
  frame = 4,
) {
  const scope = capture(() => ({ project: p, revision: 7, frame }));
  return { scope, owner: scope.resolve(layer, 'live', group, index, role) };
}
const target = (o: Owner) => ({ x: o.point.x + 7, y: o.point.y - 3 });
function changed(p: Project, o: Owner, q = target(o)) {
  const out = structuredClone(p),
    path = out.layers
      .find((l) => l.id === o.layerId)!
      .liveMotionSpans!.find((s) => s.id === o.spanId)!.path!,
    v = { x: q.x - o.anchor.x, y: q.y - o.anchor.y };
  if (o.role === 'incoming') (path.waypointIncoming as Point[])[o.waypointIndex] = v;
  else (path.waypointTangents as Point[])[o.waypointIndex + 1] = v;
  return out;
}
function weight(frame: number, index: number, role: Role) {
  if (frame === 8) return 0;
  const at = (frame / 8) * 3,
    segment = Math.floor(at),
    u = at - segment;
  if (segment !== (role === 'incoming' ? index : index + 1)) return 0;
  return role === 'incoming' ? 3 * (1 - u) * u * u : 3 * (1 - u) * (1 - u) * u;
}
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const group of ['outer', 'second'])
      for (const index of [0, 1])
        for (const role of ['incoming', 'outgoing'] as const)
          it(`group handles ${mode}/${basis}/${group}/${index}/${role} keep original membership and analytic shared pose deltas`, () => {
            const p = fixture(mode, basis),
              before = structuredClone(p),
              { scope, owner } = operation(p, index, role, group),
              path = p.layers[0].liveMotionSpans![0].path!,
              a = p.layers[0].keys[0].shapes.find((s) => s.groups?.[0] === group)!,
              w = path.waypoints![index],
              v =
                role === 'incoming'
                  ? path.waypointIncoming![index]
                  : path.waypointTangents![index + 1];
            expect(owner.groupId).toBe(group);
            expect(owner.groupShapeIds).toEqual(group === 'outer' ? ['a', 'b'] : ['c', 'd']);
            expect(owner.shapeIds).toEqual(['a', 'b', 'c', 'd', 'loose']);
            expect(owner.shapeId).toBe(a.id);
            expect(owner.anchor).toEqual({ x: a.x + w.x, y: a.y + w.y });
            expect(owner.point).toEqual({ x: a.x + w.x + v.x, y: a.y + w.y + v.y });
            expect(Object.isFrozen(owner)).toBe(true);
            expect(Object.isFrozen(owner.groupShapeIds)).toBe(true);
            const out = prepare([{ owner, target: target(owner) }]);
            expect(out).toEqual(changed(p, owner));
            expect(out.layers[0].keys).toEqual(p.layers[0].keys);
            expect(out.symbols).toEqual(p.symbols);
            expect(p).toEqual(before);
            expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(p));
            const base = createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0]),
              edited = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]);
            for (const frame of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
              const original = base.sample(frame),
                actual = edited.sample(frame),
                factor = weight(frame, index, role);
              for (let i = 0; i < actual.length; i++) {
                expect(actual[i].x).toBeCloseTo(original[i].x + 7 * factor, 9);
                expect(actual[i].y).toBeCloseTo(original[i].y - 3 * factor, 9);
                expect(actual[i].transform).toEqual(original[i].transform);
                expect(actual[i].rotation).toEqual(original[i].rotation);
                expect(actual[i].groups).toEqual(original[i].groups);
              }
            }
            base.dispose();
            edited.dispose();
            scope.dispose();
          });
it('uses original ordered first member rather than sorted IDs, pivots, bounds or nested descendants', () => {
  const p = fixture('both', 'reflected');
  for (const k of p.layers[0].keys.slice(0, 2)) {
    k.shapes = [k.shapes[1], k.shapes[0], ...k.shapes.slice(2)];
    for (const s of k.shapes) s.pivot = { x: -400, y: 900 };
  }
  const { scope, owner } = operation(p);
  expect(owner.shapeId).toBe('b');
  expect(owner.groupShapeIds).toEqual(['b', 'a']);
  expect(owner.anchor).toEqual({ x: 60, y: 50 });
  expect(owner.point).toEqual({ x: 70, y: 55 });
  expect(() => scope.resolve('track', 'live', 'inner', 0, 'outgoing')).toThrow();
  expect(() => scope.resolve('track', 'live', 'loose', 0, 'outgoing')).toThrow();
  expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
  scope.dispose();
});
it('keeps public hints detached and both existing root/group-waypoint brands exact', () => {
  const p = fixture(),
    { scope, owner } = operation(p),
    root = captureRoot(() => ({ project: p, frame: 4, revision: 7 })),
    legacy = captureLiveGroupWaypoints(() => ({ project: p, frame: 4, revision: 7 }));
  expect(root.choices).toEqual([]);
  expect(() => prepareRoot([{ owner, target: target(owner) }])).toThrow();
  expect(() => prepareLiveGroupWaypointPositions([{ owner, target: target(owner) }])).toThrow();
  const other = legacy.resolve('track', 'live', 'outer', 0);
  expect(() => prepare([{ owner: other as unknown as Owner, target: other.point }])).toThrow();
  const hints = scope.choices;
  expect(hints).toHaveLength(2);
  hints[0].groupId = 'inner';
  hints[0].shapeId = 'loose';
  hints[0].waypointCount = 999;
  expect(scope.choices[0]).toEqual({
    layerId: 'track',
    spanId: 'live',
    groupId: 'outer',
    shapeId: 'a',
    waypointCount: 2,
  });
  expect(scope.resolve('track', 'live', 'outer', 0, 'outgoing').point).toEqual(owner.point);
  scope.dispose();
  root.dispose();
  legacy.dispose();
});
for (const kind of [
  'duplicate',
  'other group',
  'public copy',
  'JSON',
  'proxy',
  'foreign scope',
  'foreign project',
] as const)
  it(`rejects ${kind} identities atomically and keeps public data unowned`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      foreign = kind === 'foreign project' ? structuredClone(p) : p,
      other = capture(() => ({
        project: foreign,
        frame: 4,
        revision: 7,
      }));
    let forged = owner;
    if (kind === 'other group') forged = scope.resolve('track', 'live', 'second', 0, 'outgoing');
    if (kind === 'public copy') forged = { ...owner };
    if (kind === 'JSON') forged = JSON.parse(JSON.stringify(owner));
    if (kind === 'proxy') forged = new Proxy(owner, {});
    if (kind.startsWith('foreign')) forged = other.resolve('track', 'live', 'outer', 1, 'incoming');
    const requests =
      kind === 'public copy' || kind === 'JSON' || kind === 'proxy'
        ? [{ owner: forged, target: target(owner) }]
        : [
            { owner, target: target(owner) },
            { owner: forged, target: target(forged) },
          ];
    expect(() => prepare(requests)).toThrow();
    expect(p).toEqual(before);
    expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
    scope.dispose();
    other.dispose();
  });
for (const mode of [
  'NaN',
  'Infinity',
  'string',
  'getter',
  'inherited',
  'nonenumerable',
  'extra',
  'unchanged',
] as const)
  it(`rejects raw ${mode} targets without coercion or getter reads`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      request: Request = { owner, target: target(owner) },
      get = vi.fn(() => 10);
    if (mode === 'NaN') request.target.x = NaN;
    if (mode === 'Infinity') request.target.y = Infinity;
    if (mode === 'string') Object.assign(request.target, { x: '10' });
    if (mode === 'getter') Object.defineProperty(request.target, 'x', { get, enumerable: true });
    if (mode === 'inherited') request.target = Object.create({ x: 1, y: 2 });
    if (mode === 'nonenumerable')
      Object.defineProperty(request, 'target', { value: request.target, enumerable: false });
    if (mode === 'extra') Object.assign(request.target, { pressure: 0.5 });
    if (mode === 'unchanged') request.target = { ...owner.point };
    expect(() => prepare([request])).toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const kind of [
  'automatic',
  'mirrored',
  'straight',
  'nonrigid',
  'no groups',
  'locked',
  'hidden',
  'outside',
] as const)
  it(`keeps ${kind} source scope unsupported without materializing controls`, () => {
    const p = fixture(),
      path = p.layers[0].liveMotionSpans![0].path!;
    if (kind === 'automatic') {
      delete path.waypointTangents;
      delete path.waypointIncoming;
    }
    if (kind === 'mirrored') delete path.waypointIncoming;
    if (kind === 'straight') {
      delete path.curvedWaypoints;
      delete path.waypointTangents;
      delete path.waypointIncoming;
    }
    if (kind === 'nonrigid') {
      delete p.layers[0].liveMotionSpans![0].rotation!.rigidGroups;
      for (const k of p.layers[0].keys) for (const a of k.shapes) delete a.groups;
    }
    if (kind === 'no groups')
      for (const k of p.layers[0].keys) for (const s of k.shapes) delete s.groups;
    if (kind === 'locked') p.layers[0].locked = true;
    if (kind === 'hidden') p.layers[0].visible = false;
    const before = structuredClone(p);
    if (kind === 'no groups') {
      expect(() => capture(() => ({ project: p, frame: 4, revision: 7 }))).toThrow(/group/);
      expect(p).toEqual(before);
      return;
    }
    const scope = capture(() => ({ project: p, frame: kind === 'outside' ? 9 : 4, revision: 7 }));
    expect(scope.choices).toEqual([]);
    expect(() => scope.resolve('track', 'live', 'outer', 0, 'outgoing')).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
  });
it('composes distinct roles/slots/groups/tracks in one detached candidate', () => {
  const p = fixture('both', 'reflected', true),
    before = structuredClone(p),
    scope = capture(() => ({ project: p, frame: 4, revision: 7 })),
    a = scope.resolve('track', 'live', 'outer', 0, 'incoming'),
    b = scope.resolve('track', 'live', 'second', 0, 'outgoing'),
    c = scope.resolve('later', 'live', 'outer', 1, 'incoming'),
    rows = [a, b, c].map((owner) => ({ owner, target: target(owner) }));
  const out = prepare(rows);
  let expected = p;
  for (const { owner, target: q } of rows) expected = changed(expected, owner, q);
  expect(out).toEqual(expected);
  expect(p).toEqual(before);
  scope.dispose();
});
for (const kind of ['target', 'duplicate', 'late source'] as const)
  it(`all-track ${kind} failure rejects every pending edit`, () => {
    const p = fixture('rigid', 'plain', true),
      before = structuredClone(p),
      scope = capture(() => ({ project: p, frame: 4, revision: 7 })),
      a = scope.resolve('track', 'live', 'outer', 0, 'outgoing'),
      b = scope.resolve('later', 'live', 'outer', 1, 'incoming'),
      rows = [
        { owner: a, target: target(a) },
        { owner: b, target: target(b) },
      ];
    if (kind === 'target') rows[1].target.y = NaN;
    if (kind === 'duplicate') rows.push({ owner: b, target: target(b) });
    let hit = false;
    expect(() =>
      prepare(rows, {
        validate: () => {
          if (kind === 'late source' && !hit) {
            hit = true;
            p.layers[1].name = 'Independent source';
          }
        },
      }),
    ).toThrow();
    if (kind === 'late source') expect(p.layers[1].name).toBe('Independent source');
    else expect(p).toEqual(before);
    scope.dispose();
  });
for (const kind of [
  'source',
  'identity',
  'frame',
  'revision',
  'dispose',
  'reader reentry',
] as const)
  it(`expires original ${kind} before preparing source-owned group controls`, () => {
    const p = fixture();
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
      }),
      owner = scope.resolve('track', 'live', 'outer', 0, 'outgoing');
    if (kind === 'source') p.name = 'Independent source';
    if (kind === 'identity') source = structuredClone(p);
    if (kind === 'frame') frame = 5;
    if (kind === 'revision') revision++;
    if (kind === 'dispose') scope.dispose();
    if (kind === 'reader reentry') reenter = true;
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    expect(() => scope.resolve('track', 'live', 'outer', 0, 'outgoing')).toThrow();
    scope.dispose();
  });
it('poisons first source-read reentry even when the reader swallows the inner failure', () => {
  const p = fixture();
  let nested = false;
  const reader = () => {
    if (!nested) {
      nested = true;
      try {
        capture(reader);
      } catch {}
    }
    return { project: p, frame: 4, revision: 7 };
  };
  expect(() => capture(reader)).toThrow(/reenter/);
  expect(operation(p).owner.groupId).toBe('outer');
});
for (const kind of [
  'getter',
  'nonenumerable',
  'NaN frame',
  'fractional revision',
  'raw NaN',
  'raw prototype',
] as const)
  it(`rejects original ${kind} data without invoking source getters`, () => {
    const p = fixture(),
      get = vi.fn(() => p),
      value = { project: p, frame: 4, revision: 7 };
    if (kind === 'getter') Object.defineProperty(value, 'project', { get, enumerable: true });
    if (kind === 'nonenumerable')
      Object.defineProperty(value, 'project', { value: p, enumerable: false });
    if (kind === 'NaN frame') value.frame = NaN;
    if (kind === 'fractional revision') value.revision = 0.5;
    if (kind === 'raw NaN') p.symbols![0].shapes[0].width = NaN;
    if (kind === 'raw prototype')
      Object.setPrototypeOf(p.layers[0].keys[0].shapes[0], { forged: true });
    const before = structuredClone(p);
    expect(() => capture(() => value)).toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(p).toEqual(before);
  });
for (const field of ['layer', 'span', 'group', 'index', 'role'] as const)
  it(`never coerces forged ${field} identities or invokes serialization methods`, () => {
    const { scope } = operation(),
      get = vi.fn(() => 0),
      forged = { valueOf: get, toJSON: get },
      args: unknown[] = ['track', 'live', 'outer', 0, 'outgoing'];
    args[['layer', 'span', 'group', 'index', 'role'].indexOf(field)] = forged;
    expect(() => Reflect.apply(scope.resolve, scope, args)).toThrow();
    expect(get).not.toHaveBeenCalled();
    scope.dispose();
  });
for (const kind of [
  'callback getter',
  'callback type',
  'extra option',
  'prototype',
  'async',
  'request mutation',
  'callback replacement',
  'prototype change',
  'reentry',
] as const)
  it(`rejects ${kind} callback admission atomically and preserves fresh retry`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { scope, owner } = operation(p),
      request = { owner, target: target(owner) },
      get = vi.fn(() => () => {});
    let hit = false;
    const options: { validate?: () => void; [k: string]: unknown } = {
      validate: () => {
        if (hit) return;
        hit = true;
        if (kind === 'request mutation') request.target.x++;
        if (kind === 'callback replacement') options.validate = () => {};
        if (kind === 'prototype change') Object.setPrototypeOf(options, null);
        if (kind === 'reentry') {
          try {
            prepare([{ owner, target: target(owner) }]);
          } catch {}
        }
      },
    };
    if (kind === 'callback getter')
      Object.defineProperty(options, 'validate', { get, enumerable: true });
    if (kind === 'callback type') Object.assign(options, { validate: 1 });
    if (kind === 'extra option') options.coupling = 'aligned';
    if (kind === 'prototype') Object.setPrototypeOf(options, { other: true });
    if (kind === 'async') options.validate = async () => {};
    expect(() => prepare([request], options)).toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(p).toEqual(before);
    expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
    scope.dispose();
  });
for (const different of [false, true])
  it(`mixed ${different ? 'foreign-project' : 'same-project'} capture scopes reject before callback metadata inspection`, () => {
    const p = fixture(),
      { scope, owner } = operation(p),
      foreign = different ? structuredClone(p) : p,
      other = capture(() => ({ project: foreign, frame: 4, revision: 7 })),
      b = other.resolve('track', 'live', 'second', 1, 'incoming');
    let reads = 0;
    const options = new Proxy(
      {},
      {
        getPrototypeOf() {
          reads++;
          return Object.prototype;
        },
        ownKeys() {
          reads++;
          return [];
        },
      },
    );
    expect(() =>
      prepare(
        [
          { owner, target: target(owner) },
          { owner: b, target: target(b) },
        ],
        options,
      ),
    ).toThrow(/scope/);
    expect(reads).toBe(0);
    scope.dispose();
    other.dispose();
  });
for (const kind of [
  'snapshot',
  'hints',
  'candidate getter',
  'candidate prototype',
  'candidate clock',
  'late source',
  'late request',
  'output',
] as const)
  it(`rejects ${kind} clone mutation with detached ownership and zero accessor reads`, () => {
    const p = fixture(),
      before = structuredClone(p),
      native = structuredClone,
      get = vi.fn(() => 12),
      existing = kind === 'snapshot' ? undefined : operation(p),
      request = existing ? { owner: existing.owner, target: target(existing.owner) } : undefined;
    let hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value),
        q = out as Project;
      const edited = q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 17;
      if (
        !hit &&
        (kind === 'snapshot'
          ? value === p
          : kind === 'hints'
            ? Array.isArray(out) && out[0]?.waypointCount
            : edited)
      ) {
        hit = true;
        if (kind === 'snapshot') (out as Project).name = 'Changed snapshot';
        if (kind === 'hints') (out as { groupId: string }[])[0].groupId = 'inner';
        if (kind === 'candidate getter')
          Object.defineProperty(q.layers[0].keys[0].shapes[0], 'width', { get, enumerable: true });
        if (kind === 'candidate prototype')
          Object.setPrototypeOf(q.layers[0].keys[0].shapes[0], { forged: true });
        if (kind === 'candidate clock') q.duration++;
        if (kind === 'late source') p.name = 'Late source';
        if (kind === 'late request') request!.target.y++;
        if (kind === 'output') q.layers[0].keys[0].shapes[0].fill = '#123456';
      }
      return out;
    });
    expect(() =>
      kind === 'snapshot'
        ? capture(() => ({ project: p, frame: 4, revision: 7 }))
        : kind === 'hints'
          ? existing!.scope.choices
          : prepare([request!]),
    ).toThrow();
    expect(hit).toBe(true);
    expect(get).not.toHaveBeenCalled();
    if (kind === 'late source') expect(p.name).toBe('Late source');
    else expect(p).toEqual(before);
    vi.stubGlobal('structuredClone', native);
    if (existing) {
      if (kind !== 'late source')
        expect(prepare([{ owner: existing.owner, target: target(existing.owner) }])).toEqual(
          changed(p, existing.owner),
        );
      existing.scope.dispose();
    }
  });
it('retains original private callback admission despite replaced public scope methods', () => {
  const p = fixture(),
    { scope, owner } = operation(p),
    dispose = scope.dispose;
  scope.assertCurrent = () => {};
  scope.dispose = () => {};
  p.name = 'Independent edit';
  expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
  dispose();
});
it('reopens detached output for a later independent role edit without touching prior candidates', () => {
  const p = fixture('both', 'reflected'),
    { scope, owner } = operation(p),
    out = prepare([{ owner, target: target(owner) }]),
    frozen = structuredClone(out),
    reopened = JSON.parse(JSON.stringify(out)) as Project,
    next = operation(reopened, 1, 'incoming', 'second'),
    later = prepare([{ owner: next.owner, target: target(next.owner) }]);
  expect(later).toEqual(changed(reopened, next.owner));
  expect(out).toEqual(frozen);
  expect(reopened).toEqual(out);
  expect(p.layers[0].liveMotionSpans![0].path!.waypointTangents![1]).toEqual({ x: 10, y: 5 });
  scope.dispose();
  next.scope.dispose();
});
for (const basis of ['plain', 'affine', 'reflected'])
  it(`compound ${basis} preserves fixed original rings during signed group edits`, () => {
    const p = fixture('both', basis);
    p.layers[0].liveMotionSpans![0].options = {
      ...p.layers[0].liveMotionSpans![0].options,
      affine: true,
    };
    for (const key of p.layers[0].keys.slice(0, 2))
      for (const s of key.shapes) {
        const rings = [
          [
            { x: 0, y: 0 },
            { x: 12, y: 0 },
            { x: 12, y: 10 },
            { x: 0, y: 10 },
          ],
          [
            { x: 2, y: 2 },
            { x: 5, y: 2 },
            { x: 3, y: 5 },
          ],
        ];
        Object.assign(s, {
          kind: 'polygon',
          fillRule: 'evenodd',
          points: [],
          contours: rings,
        });
      }
    const before = structuredClone(p),
      { scope, owner } = operation(p, 1, 'incoming', 'second'),
      out = prepare([{ owner, target: target(owner) }]);
    expect(out).toEqual(changed(p, owner));
    expect(out.layers[0].keys).toEqual(p.layers[0].keys);
    expect(p).toEqual(before);
    scope.dispose();
  });
for (const mode of ['original', 'replacement'] as const)
  it(`actual ${mode} aggregate overflow rejects without discarding source artwork`, () => {
    const p = fixture(),
      native = structuredClone;
    const oversized = () => ({
      id: 'overflow',
      name: 'Overflow',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK + 1 }, (_, i) => ({
        id: 'v' + i,
        kind: 'rectangle' as const,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rotation: 0,
        fill: '#000000',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
      })),
    });
    if (mode === 'original') {
      p.symbols = [oversized()];
      expect(() => capture(() => ({ project: p, frame: 4, revision: 7 }))).toThrow(/budget/);
      expect(p.symbols[0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK + 1);
      return;
    }
    const before = native(p),
      { scope, owner } = operation(p);
    let hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = native(value),
        q = out as Project;
      if (!hit && q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.waypointTangents?.[1]?.x === 17) {
        hit = true;
        q.symbols = [oversized()];
      }
      return out;
    });
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow(/budget/);
    expect(hit).toBe(true);
    expect(p).toEqual(before);
    vi.stubGlobal('structuredClone', native);
    expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
    scope.dispose();
  });
for (const mode of ['distance', 'tangent', 'distance tangent'])
  it(`retains explicit ${mode} group settings and conservative independent bearing rejection`, () => {
    const p = fixture(),
      path = p.layers[0].liveMotionSpans![0].path!;
    if (mode.includes('distance')) path.distance = true;
    if (mode.includes('tangent'))
      Object.assign(path, { tangent: true, headingOffset: 10, headingOffsetEnd: 20 });
    const before = structuredClone(p),
      { scope, owner } = operation(p),
      q = mode.includes('tangent')
        ? { x: owner.anchor.x + 12, y: owner.anchor.y + 6 }
        : target(owner);
    if (mode.includes('tangent'))
      expect(() => prepare([{ owner, target: target(owner) }])).toThrow(/tangent|join/);
    const out = prepare([{ owner, target: q }]);
    expect(out).toEqual(changed(p, owner, q));
    expect(p).toEqual(before);
    const sampler = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]);
    for (const frame of [0, 2, 4, 6, 8])
      for (const s of sampler.sample(frame))
        expect([s.x, s.y, s.rotation].every(Number.isFinite)).toBe(true);
    sampler.dispose();
    scope.dispose();
  });
for (const mode of [
  'node interpolation',
  'changed compound rings',
  'contour correspondence',
] as const)
  it(`preserves unsupported rigid ${mode} rejection without weakening admission`, () => {
    const p = fixture(),
      before = structuredClone(p);
    if (mode === 'node interpolation')
      p.layers[0].liveMotionSpans![0].options = {
        ...p.layers[0].liveMotionSpans![0].options,
        nodes: true,
      };
    else if (mode === 'contour correspondence')
      p.layers[0].liveMotionSpans![0].correspondence = { order: [0, 1] };
    else {
      for (const [i, k] of p.layers[0].keys.slice(0, 2).entries())
        for (const a of k.shapes)
          Object.assign(a, {
            kind: 'polygon',
            fillRule: 'evenodd',
            points: [],
            contours: i
              ? [
                  [
                    { x: 2, y: 2 },
                    { x: 5, y: 2 },
                    { x: 3, y: 5 },
                  ],
                  [
                    { x: 0, y: 0 },
                    { x: 12, y: 0 },
                    { x: 12, y: 10 },
                    { x: 0, y: 10 },
                  ],
                ]
              : [
                  [
                    { x: 0, y: 0 },
                    { x: 12, y: 0 },
                    { x: 12, y: 10 },
                    { x: 0, y: 10 },
                  ],
                  [
                    { x: 2, y: 2 },
                    { x: 5, y: 2 },
                    { x: 3, y: 5 },
                  ],
                ],
          });
    }
    const original = structuredClone(p),
      scope = capture(() => ({ project: p, frame: 4, revision: 7 }));
    expect(() => scope.resolve('track', 'live', 'outer', 0, 'outgoing')).toThrow();
    expect(p).toEqual(original);
    scope.dispose();
    const valid = operation(before);
    expect(prepare([{ owner: valid.owner, target: target(valid.owner) }])).toEqual(
      changed(before, valid.owner),
    );
    valid.scope.dispose();
  });
for (const [scale, origin] of [
  [1e-7, 0],
  [1, 1e6],
  [1e4, -1e6],
])
  it(`keeps relative group numerics at scale${scale}/origin${origin} with off-view targets`, () => {
    const p = fixture('rigid', 'reflected');
    for (const k of p.layers[0].keys.slice(0, 2))
      for (const a of k.shapes) {
        a.x = origin + a.x * scale;
        a.y = origin + a.y * scale;
        a.width *= scale;
        a.height *= scale;
        if (a.pivot) {
          a.pivot.x *= scale;
          a.pivot.y *= scale;
        }
      }
    const path = p.layers[0].liveMotionSpans![0].path!;
    path.startX *= scale;
    path.startY *= scale;
    path.endX *= scale;
    path.endY *= scale;
    path.waypoints = path.waypoints!.map((v) => ({ x: v.x * scale, y: v.y * scale }));
    path.waypointTangents = path.waypointTangents!.map((v) => ({ x: v.x * scale, y: v.y * scale }));
    path.waypointIncoming = path.waypointIncoming!.map((v) => ({ x: v.x * scale, y: v.y * scale }));
    const { scope, owner } = operation(p),
      q = { x: owner.point.x + 7 * scale, y: owner.point.y - 3 * scale },
      out = prepare([{ owner, target: q }]);
    expect(out).toEqual(changed(p, owner, q));
    const a = createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0]),
      b = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]);
    for (const frame of [0, 2, 4, 6, 8]) {
      const original = a.sample(frame),
        actual = b.sample(frame),
        w = weight(frame, 0, 'outgoing');
      for (let i = 0; i < actual.length; i++) {
        expect(Math.abs(actual[i].x - (original[i].x + 7 * scale * w))).toBeLessThanOrEqual(
          Number.EPSILON * 128 * Math.max(1, Math.abs(original[i].x), Math.abs(actual[i].x)),
        );
        expect(actual[i].transform).toEqual(original[i].transform);
      }
    }
    a.dispose();
    b.dispose();
    scope.dispose();
  });
it('rejects genuinely overflowing finite controls under explicit distance admission', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].path!.distance = true;
  const before = structuredClone(p),
    { scope, owner } = operation(p);
  expect(() =>
    prepare([{ owner, target: { x: Number.MAX_VALUE, y: -Number.MAX_VALUE } }]),
  ).toThrow();
  expect(p).toEqual(before);
  expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
  scope.dispose();
});
it('keeps lazy group/count hints and shared frozen complete IDs across a many-slot route', () => {
  const p = fixture(),
    first = p.layers[0].keys[0].shapes.slice(0, 2),
    last = p.layers[0].keys[1].shapes.slice(0, 2);
  for (const [i, k] of p.layers[0].keys.slice(0, 2).entries())
    k.shapes = Array.from({ length: 8 }, (_, g) =>
      (i ? last : first).map((a, j) => ({
        ...structuredClone(a),
        id: `g${g}v${j}`,
        groups: [`g${g}`, `child${g}`],
        x: a.x + g * 160,
        y: a.y + g * 100,
      })),
    ).flat();
  const path = p.layers[0].liveMotionSpans![0].path!;
  path.waypoints = Array.from({ length: 257 }, (_, i) => ({ x: ((i + 1) * 80) / 258, y: 30 }));
  path.waypointTangents = Array.from({ length: 259 }, () => ({ x: 1, y: 1 }));
  path.waypointIncoming = Array.from({ length: 257 }, () => ({ x: -1, y: -1 }));
  const scope = capture(() => ({ project: p, frame: 4, revision: 7 })),
    hints = scope.choices;
  expect(hints).toHaveLength(8);
  expect(
    hints.every(
      (h) =>
        h.waypointCount === 257 &&
        !Object.hasOwn(h, 'point') &&
        !Object.hasOwn(h, 'shapeIds') &&
        !Object.hasOwn(h, 'waypoints'),
    ),
  ).toBe(true);
  const a = scope.resolve('track', 'live', 'g0', 256, 'incoming'),
    b = scope.resolve('track', 'live', 'g0', 0, 'outgoing'),
    c = scope.resolve('track', 'live', 'g7', 0, 'incoming');
  expect(a.shapeIds).toBe(b.shapeIds);
  expect(a.shapeIds).toBe(c.shapeIds);
  expect(a.groupShapeIds).toBe(b.groupShapeIds);
  expect(a.groupShapeIds).not.toBe(c.groupShapeIds);
  expect(a.shapeIds).toHaveLength(16);
  scope.dispose();
  expect(() => prepare([{ owner: a, target: target(a) }])).toThrow();
});
it('keeps a genuine plain-root handle outside the new group ownership brand', () => {
  const p = fixture();
  for (const k of p.layers[0].keys) for (const a of k.shapes) delete a.groups;
  delete p.layers[0].liveMotionSpans![0].rotation!.rigidGroups;
  const root = captureRoot(() => ({ project: p, frame: 4, revision: 7 })),
    owner = root.resolve('track', 'live', 'a', 0, 'outgoing'),
    group = capture(() => ({ project: p, frame: 4, revision: 7 }));
  expect(group.choices).toEqual([]);
  expect(() =>
    prepare([{ owner: owner as Owner, target: { x: owner.point.x + 7, y: owner.point.y - 3 } }]),
  ).toThrow();
  expect(
    prepareRoot([{ owner, target: { x: owner.point.x + 7, y: owner.point.y - 3 } }]).layers[0].keys,
  ).toEqual(p.layers[0].keys);
  root.dispose();
  group.dispose();
});
for (const mode of ['loop', 'once', 'single', 'movie'] as const)
  it(`retains unsupported grouped ${mode} continuity rejection and original artwork`, () => {
    const p = fixture(),
      definition = p.symbols![0];
    definition.timeline = {
      duration: 5,
      keys: [{ frame: 2, shapes: [{ ...structuredClone(definition.shapes[0]), fill: '#0000ff' }] }],
    };
    p.layers[0].liveMotionSpans![0].symbolContinuity = mode === 'movie' ? 'movies' : 'graphics';
    for (const k of p.layers[0].keys.slice(0, 2))
      Object.assign(k.shapes[1], {
        kind: 'symbol',
        symbolId: definition.id,
        symbolPlayback: { mode, firstFrame: 3 },
      });
    const before = structuredClone(p);
    expect(() => capture(() => ({ project: p, frame: 4, revision: 7 }))).toThrow(
      /group continuity requires separate/,
    );
    expect(p).toEqual(before);
  });
for (const kind of ['request', 'callback', 'reentry'] as const)
  it(`rechecks ${kind} after the actual original source reader returns`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let hook = () => {};
    const scope = capture(() => {
        hook();
        return { project: p, frame: 4, revision: 7 };
      }),
      owner = scope.resolve('track', 'live', 'outer', 0, 'outgoing'),
      request = { owner, target: target(owner) },
      options = { validate: () => {} };
    let hit = false;
    hook = () => {
      if (hit) return;
      hit = true;
      if (kind === 'request') request.target.x++;
      if (kind === 'callback') options.validate = () => {};
      if (kind === 'reentry') {
        try {
          prepare([{ owner, target: target(owner) }]);
        } catch {}
      }
    };
    expect(() => prepare([request], options)).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
    hook = () => {};
    expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
    scope.dispose();
  });
for (const mode of ['loop', 'once', 'single', 'movie'] as const)
  it(`preserves unrelated ${mode} clocks and library metadata outside the edited group track`, () => {
    const p = fixture(),
      definition = p.symbols![0];
    definition.timeline = {
      duration: 5,
      keys: [{ frame: 2, shapes: [{ ...structuredClone(definition.shapes[0]), fill: '#0000ff' }] }],
    };
    const held = {
      ...structuredClone(p.layers[0].keys[0].shapes[1]),
      id: 'held',
      kind: 'symbol' as const,
      symbolId: definition.id,
      symbolPlayback: { mode, firstFrame: 3 },
    };
    delete held.groups;
    p.layers.push({
      ...newLayer('Held'),
      id: 'held',
      drawingMode: 'object',
      keys: [{ frame: 0, shapes: [held] }],
    });
    const before = structuredClone(p),
      { scope, owner } = operation(p),
      out = prepare([{ owner, target: target(owner) }]);
    expect(out).toEqual(changed(p, owner));
    expect(out.layers[1]).toEqual(p.layers[1]);
    expect(out.symbols).toEqual(p.symbols);
    expect(compileMovieClockPlan(out)).toEqual(compileMovieClockPlan(p));
    expect(p).toEqual(before);
    scope.dispose();
  });
it('preserves admitted correspondence on an unrelated plain track without enabling rigid morphs', () => {
  const p = fixture(),
    matched = structuredClone(liveSplitFixture().layers[0]);
  matched.id = 'matched';
  matched.liveMotionSpans![0].options = { nodes: true };
  matched.liveMotionSpans![0].correspondence = { order: [0, 1] };
  for (const k of matched.keys.slice(0, 2))
    for (const a of k.shapes)
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
      });
  p.layers.push(matched);
  const before = structuredClone(p),
    { scope, owner } = operation(p),
    out = prepare([{ owner, target: target(owner) }]);
  expect(out).toEqual(changed(p, owner));
  expect(out.layers[1]).toEqual(matched);
  expect(p).toEqual(before);
  const a = createMotionFrameSampler(p, 'matched', matched.liveMotionSpans![0]),
    b = createMotionFrameSampler(out, 'matched', out.layers[1].liveMotionSpans![0]);
  for (const frame of [0, 2, 4, 6, 8]) expect(b.sample(frame)).toEqual(a.sample(frame));
  a.dispose();
  b.dispose();
  scope.dispose();
});
it('does not strip unsupported original trajectory-control metadata to force an update', () => {
  const p = fixture();
  Object.assign(p.layers[0].liveMotionSpans![0].path!.waypointTangents![1], { pressure: 0.5 });
  const before = structuredClone(p),
    { scope, owner } = operation(p);
  expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
  expect(p).toEqual(before);
  scope.dispose();
});
for (const role of ['incoming', 'outgoing'] as const)
  it(`rejects selected ${role} metadata on a later track atomically without discarding originals`, () => {
    const p = fixture('rigid', 'plain', true),
      path = p.layers[1].liveMotionSpans![0].path!;
    Object.assign(role === 'incoming' ? path.waypointIncoming![0] : path.waypointTangents![1], {
      pressure: 0.5,
    });
    const before = structuredClone(p),
      scope = capture(() => ({ project: p, frame: 4, revision: 7 })),
      a = scope.resolve('track', 'live', 'outer', 0, 'outgoing'),
      b = scope.resolve('later', 'live', 'outer', 0, role);
    expect(() =>
      prepare([
        { owner: a, target: target(a) },
        { owner: b, target: target(b) },
      ]),
    ).toThrow(/metadata/);
    expect(p).toEqual(before);
    scope.dispose();
  });
it('rejects unsupported untouched control data without normalizing the shared bank', () => {
  const p = fixture();
  Object.assign(p.layers[0].liveMotionSpans![0].path!.waypointIncoming![1], { pressure: 0.25 });
  const before = structuredClone(p),
    { scope, owner } = operation(p);
  expect(() => prepare([{ owner, target: target(owner) }])).toThrow(/trajectory point data/);
  expect(p).toEqual(before);
  scope.dispose();
});
for (const basis of ['plain', 'affine', 'reflected'])
  it(`saved group pivots ${basis} retain existing live admission rejection and original authored data`, () => {
    const p = fixture('both', basis),
      first = p.layers[0].keys[0].shapes;
    p.layers[0].liveMotionSpans![0].rotation!.savedGroupPivots = true;
    for (const group of ['outer', 'second']) {
      const members = first.filter((a) => a.groups?.[0] === group),
        leader = members[0];
      for (const a of members) {
        const [xx, yx, xy, yy] = a.transform!,
          det = xx * yy - yx * xy,
          dx = leader.x + 20 - a.x,
          dy = leader.y + 20 - a.y,
          pivot = { x: (yy * dx - xy * dy) / det, y: (-yx * dx + xx * dy) / det };
        for (const k of p.layers[0].keys.slice(0, 2))
          k.shapes.find((s) => s.id === a.id)!.pivot = { ...pivot };
      }
    }
    const before = structuredClone(p);
    expect(() => capture(() => ({ project: p, frame: 4, revision: 7 }))).toThrow(
      /pivot or inner-depth/,
    );
    expect(p).toEqual(before);
    const recovered = structuredClone(p);
    delete recovered.layers[0].liveMotionSpans![0].rotation!.savedGroupPivots;
    const valid = operation(recovered);
    expect(valid.owner.anchor).toEqual({ x: 20, y: 50 });
    expect(prepare([{ owner: valid.owner, target: target(valid.owner) }])).toEqual(
      changed(recovered, valid.owner),
    );
    expect(p).toEqual(before);
    valid.scope.dispose();
  });
for (const frame of [0, 1, 7, 8])
  it(`frame ${frame} owns authored first-member handles rather than sampled group positions`, () => {
    const p = fixture(),
      { scope, owner } = operation(p, 0, 'incoming', 'outer', 'track', frame);
    expect(owner.frame).toBe(frame);
    expect(owner.revision).toBe(7);
    expect(owner.anchor).toEqual({ x: 20, y: 50 });
    expect(owner.point).toEqual({ x: 0, y: 40 });
    expect(prepare([{ owner, target: target(owner) }])).toEqual(changed(p, owner));
    scope.dispose();
  });

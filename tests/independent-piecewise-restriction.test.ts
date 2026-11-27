import { afterEach, expect, it, vi } from 'vitest';
import type { Point } from '../packages/document/src';
import type { MotionPath } from '../packages/document/src/motion-path';
import {
  createMotionPathSampler,
  splitPreservedMotionPath,
} from '../packages/animation/src/motion-path';
import {
  prepareIndependentPiecewiseRestriction as prepare,
  type IndependentPiecewiseRestriction as Input,
} from '../packages/animation/src/independent-piecewise-restriction';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const zero = { x: 0, y: 0 };
function original(delta: Point, shared: MotionPath, bank: MotionPath, t: number): Point {
  const points = [zero, ...shared.waypoints!, delta],
    count = points.length - 1,
    index = Math.min(count - 1, Math.floor(t * count)),
    u = t * count - index,
    a = points[index],
    b = points[index + 1],
    v = 1 - t;
  return {
    x:
      a.x * (1 - u) +
      b.x * u +
      3 * v * v * t * bank.startX +
      3 * v * t * t * (delta.x + bank.endX) +
      t * t * t * delta.x -
      delta.x * t,
    y:
      a.y * (1 - u) +
      b.y * u +
      3 * v * v * t * bank.startY +
      3 * v * t * t * (delta.y + bank.endY) +
      t * t * t * delta.y -
      delta.y * t,
  };
}
function fixture(progress = 0.25, count = 2, reference: Point = { x: 80, y: 16 }): Input {
  const delta = { x: 80, y: 16 },
    bank: MotionPath = {
      startX: 13,
      startY: -40,
      endX: -9,
      endY: -12,
      distance: false,
      tangent: false,
    },
    shared: MotionPath = {
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      waypoints: Array.from({ length: count - 1 }, (_, i) => ({
        x: (i + 1) * 17,
        y: i % 2 ? -25 : 50,
      })),
      curvedWaypoints: false,
      distance: false,
    };
  return {
    delta,
    bank,
    shared,
    progress,
    middle: original(delta, shared, bank, progress),
    sharedHalves: splitPreservedMotionPath(zero, reference, shared, progress),
  };
}
function composed(delta: Point, shared: MotionPath, bank: MotionPath, t: number) {
  const a = createMotionPathSampler(zero, delta, shared)(t),
    b = createMotionPathSampler(zero, delta, bank)(t);
  return { x: a.x + b.x - delta.x * t, y: a.y + b.y - delta.y * t };
}
function check(input: Input, parts: ReturnType<typeof prepare>) {
  for (let i = 0; i <= 128; i++) {
    const t = i / 128,
      side = t <= input.progress ? 0 : 1,
      u = side ? (t - input.progress) / (1 - input.progress) : t / input.progress,
      travel = side
        ? { x: input.delta.x - input.middle.x, y: input.delta.y - input.middle.y }
        : input.middle;
    const value = composed(travel, input.sharedHalves[side], parts[side], u),
      actual = side ? { x: value.x + input.middle.x, y: value.y + input.middle.y } : value,
      expected = original(input.delta, input.shared, input.bank, t);
    expect(actual.x, `x at ${t}`).toBeCloseTo(expected.x, 9);
    expect(actual.y, `y at ${t}`).toBeCloseTo(expected.y, 9);
  }
}
for (const count of [2, 3, 4, 5])
  for (const progress of [0.125, 0.25, 0.375, 0.5, 0.75, 0.875])
    it(`prepares exact detached compensation for ${count} segments at ${progress}`, () => {
      const input = fixture(progress, count),
        before = structuredClone(input),
        out = prepare(input);
      check(input, out);
      expect(input).toEqual(before);
      for (const p of out) {
        expect(p.distance).toBe(false);
        expect(p.tangent).toBe(false);
        if (p.waypoints) {
          expect(p.curvedWaypoints).toBe(true);
          expect(p.waypointTangents).toHaveLength(p.waypoints.length + 2);
          expect(p.waypointIncoming).toHaveLength(p.waypoints.length);
        }
      }
      out[1].startX += 7;
      expect(input).toEqual(before);
    });
for (const reference of [
  { x: -40, y: 25 },
  { x: 0, y: 0 },
  { x: 120, y: -32 },
])
  it(`compensates a shared reference displacement ${reference.x}/${reference.y} independently of group travel`, () => {
    const input = fixture(0.25, 3, reference);
    check(input, prepare(input));
  });
it('retains a true sharp shared corner instead of smoothing the shared route', () => {
  const input = fixture(0.25),
    out = prepare(input);
  check(input, out);
  expect(input.shared.curvedWaypoints).toBe(false);
  expect(out[1].curvedWaypoints).toBe(true);
  const a = composed(
      { x: input.delta.x - input.middle.x, y: input.delta.y - input.middle.y },
      input.sharedHalves[1],
      out[1],
      1 / 3 - 1e-5,
    ),
    b = composed(
      { x: input.delta.x - input.middle.x, y: input.delta.y - input.middle.y },
      input.sharedHalves[1],
      out[1],
      1 / 3,
    ),
    c = composed(
      { x: input.delta.x - input.middle.x, y: input.delta.y - input.middle.y },
      input.sharedHalves[1],
      out[1],
      1 / 3 + 1e-5,
    );
  expect((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)).not.toBe(0);
});
it('recursively restricts generated explicit banks after JSON reopening', () => {
  const input = fixture(0.25),
    bank = prepare(input),
    rightDelta = { x: input.delta.x - input.middle.x, y: input.delta.y - input.middle.y };
  const shared = JSON.parse(JSON.stringify(input.sharedHalves[1])) as MotionPath,
    rightBank = JSON.parse(JSON.stringify(bank[1])) as MotionPath,
    progress = 1 / 3;
  const next: Input = {
    delta: rightDelta,
    shared,
    bank: rightBank,
    progress,
    middle: composed(rightDelta, shared, rightBank, progress),
    sharedHalves: splitPreservedMotionPath(zero, rightDelta, shared, progress),
  };
  const parts = prepare(next);
  for (let i = 0; i <= 96; i++) {
    const u = i / 96,
      side = u <= progress ? 0 : 1,
      t = side ? (u - progress) / (1 - progress) : u / progress,
      delta = side
        ? { x: rightDelta.x - next.middle.x, y: rightDelta.y - next.middle.y }
        : next.middle;
    const q = composed(delta, next.sharedHalves[side], parts[side], t),
      actual = {
        x: q.x + input.middle.x + (side ? next.middle.x : 0),
        y: q.y + input.middle.y + (side ? next.middle.y : 0),
      },
      expected = original(
        input.delta,
        input.shared,
        input.bank,
        input.progress + (1 - input.progress) * u,
      );
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
  }
});
for (const origin of [-99000, 99000])
  it(`keeps relative controls with independent affine world oracle at ${origin}`, () => {
    const input = fixture(0.375, 3),
      out = prepare(input);
    for (let i = 0; i <= 64; i++) {
      const t = i / 64,
        side = t <= input.progress ? 0 : 1,
        u = side ? (t - input.progress) / (1 - input.progress) : t / input.progress,
        delta = side
          ? { x: input.delta.x - input.middle.x, y: input.delta.y - input.middle.y }
          : input.middle,
        q = composed(delta, input.sharedHalves[side], out[side], u),
        a = { x: q.x + (side ? input.middle.x : 0), y: q.y + (side ? input.middle.y : 0) },
        b = original(input.delta, input.shared, input.bank, t);
      expect(origin - 2 * a.x + 0.5 * a.y).toBeCloseTo(origin - 2 * b.x + 0.5 * b.y, 7);
      expect(origin + 0.25 * a.x + 3 * a.y).toBeCloseTo(origin + 0.25 * b.x + 3 * b.y, 7);
    }
  });
it('uses the existing 256-piece refinement boundary without resetting per algebra stage', () => {
  const input = fixture(1 / 256, 2),
    out = prepare(input);
  expect(out[0].waypoints).toBeUndefined();
  expect(out[1].waypoints).toHaveLength(254);
  check(input, out);
  const unresolved = {
    ...input,
    progress: 1 / 257,
    middle: original(input.delta, input.shared, input.bank, 1 / 257),
  };
  expect(() => prepare(unresolved)).toThrow(/subdivision budget/);
});
it('never snaps a near-corner progress to the original corner', () => {
  const input = fixture();
  input.progress = 0.5 + Number.EPSILON;
  expect(() => prepare(input)).toThrow(/subdivision budget/);
});
for (const raw of [
  'shared-distance',
  'bank-distance',
  'tangent',
  'implicit-shared',
  'implicit-bank',
  'straight-bank',
  'partition',
] as const)
  it(`rejects unqualified ${raw} inputs without changing their source`, () => {
    const input = fixture();
    if (raw === 'shared-distance') input.shared.distance = true;
    if (raw === 'bank-distance') input.bank.distance = true;
    if (raw === 'tangent') input.shared.tangent = true;
    if (raw === 'implicit-shared') input.shared.curvedWaypoints = true;
    if (raw === 'implicit-bank') {
      input.bank.waypoints = [{ x: 25, y: 10 }];
      input.bank.curvedWaypoints = true;
    }
    if (raw === 'straight-bank') input.bank.waypoints = [{ x: 25, y: 10 }];
    if (raw === 'partition') input.sharedHalves[1] = { startX: 1, startY: 1, endX: 1, endY: 1 };
    const before = structuredClone(input);
    expect(() => prepare(input)).toThrow();
    expect(input).toEqual(before);
  });
for (const path of ['shared', 'bank'] as const)
  it(`rejects raw ${path} control getters before evaluation or cloning`, () => {
    const input = fixture(),
      getter = vi.fn(() => 13),
      clone = vi.spyOn(globalThis, 'structuredClone');
    Object.defineProperty(input[path], 'startX', { get: getter, enumerable: true });
    expect(() => prepare(input)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(clone).not.toHaveBeenCalled();
  });
for (const numeric of [NaN, Infinity, -Infinity])
  it(`rejects original numeric ${numeric} before cloning`, () => {
    const input = fixture(),
      clone = vi.spyOn(globalThis, 'structuredClone');
    input.delta.x = numeric;
    expect(() => prepare(input)).toThrow();
    expect(clone).not.toHaveBeenCalled();
  });
it('rejects forged input snapshots and actual source changes while cloning', () => {
  for (const action of ['snapshot', 'source']) {
    const input = fixture(),
      clone = globalThis.structuredClone;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value) as Input;
      if (action === 'snapshot') out.bank.startX++;
      else input.shared.waypoints![0].x++;
      return out;
    });
    expect(() => prepare(input)).toThrow(/changed/);
    vi.unstubAllGlobals();
  }
});
it('rejects finite arithmetic overflow instead of returning incomplete output', () => {
  const input = fixture();
  input.delta = { x: Number.MAX_VALUE, y: 16 };
  input.bank.startX = Number.MAX_VALUE;
  expect(() => prepare(input)).toThrow();
});

it('does not impose the off-junction refinement limit on a larger original exact-junction route', () => {
  const input = fixture(0.5, 300),
    out = prepare(input);
  expect(out[0].waypoints).toHaveLength(149);
  expect(out[1].waypoints).toHaveLength(149);
  check(input, out);
});
it('preserves stationary shared pieces without inventing smoothing', () => {
  const input = fixture(0.25, 3);
  input.shared.waypoints = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  input.middle = original(input.delta, input.shared, input.bank, input.progress);
  input.sharedHalves = splitPreservedMotionPath(zero, input.delta, input.shared, input.progress);
  check(input, prepare(input));
});
it('rejects mismatched explicit bank timing partitions instead of expanding an unchecked common multiple', () => {
  const input = fixture(0.25, 3);
  input.bank = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    curvedWaypoints: true,
    waypoints: [{ x: 40, y: 10 }],
    waypointTangents: [
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
    ],
    waypointIncoming: [{ x: -10, y: 0 }],
  };
  const before = structuredClone(input);
  expect(() => prepare(input)).toThrow(/matching equal-time/);
  expect(input).toEqual(before);
});
it('detaches every outgoing incoming and route waypoint array in both returned halves', () => {
  const input = fixture(0.5, 3),
    before = structuredClone(input),
    out = prepare(input),
    right = structuredClone(out[1]);
  out[0].waypoints![0].x++;
  out[0].waypointTangents![0].y++;
  out[0].waypointIncoming![0].x++;
  expect(input).toEqual(before);
  expect(out[1]).toEqual(right);
});
it('retains explicit false cubic defaults when the restricted bank needs no waypoint representation', () => {
  const input = fixture(0.5, 2);
  input.bank.curvedWaypoints = false;
  const out = prepare(input);
  for (const p of out) {
    expect(p.curvedWaypoints).toBe(false);
    expect(p.distance).toBe(false);
    expect(p.tangent).toBe(false);
    expect(p.waypoints).toBeUndefined();
  }
  check(input, out);
});

for (const progress of [0.25, 0.75])
  it(`handles matching explicit control partitions at ${progress} with an independent polynomial oracle`, () => {
    const input = fixture(progress);
    input.shared = {
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      curvedWaypoints: true,
      waypoints: [{ x: 40, y: 30 }],
      waypointTangents: [
        { x: 10, y: 20 },
        { x: 15, y: -5 },
        { x: 5, y: 12 },
      ],
      waypointIncoming: [{ x: -10, y: -25 }],
    };
    input.bank = {
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      curvedWaypoints: true,
      waypoints: [{ x: 35, y: 7 }],
      waypointTangents: [
        { x: 5, y: -10 },
        { x: 8, y: 20 },
        { x: 9, y: -5 },
      ],
      waypointIncoming: [{ x: -12, y: 7 }],
      distance: false,
      tangent: false,
    };
    const sample = (path: MotionPath, t: number) => {
      const vertices = [zero, ...path.waypoints!, input.delta],
        n = vertices.length - 1,
        i = Math.min(n - 1, Math.floor(t * n)),
        u = t * n - i,
        v = 1 - u,
        a = vertices[i],
        d = vertices[i + 1],
        o = path.waypointTangents![i],
        end = path.waypointTangents![i + 1],
        incoming = path.waypointIncoming![i] ?? { x: -end.x, y: -end.y };
      return {
        x:
          v * v * v * a.x +
          3 * v * v * u * (a.x + o.x) +
          3 * v * u * u * (d.x + incoming.x) +
          u * u * u * d.x,
        y:
          v * v * v * a.y +
          3 * v * v * u * (a.y + o.y) +
          3 * v * u * u * (d.y + incoming.y) +
          u * u * u * d.y,
      };
    };
    const expected = (t: number) => {
      const a = sample(input.shared, t),
        b = sample(input.bank, t);
      return { x: a.x + b.x - input.delta.x * t, y: a.y + b.y - input.delta.y * t };
    };
    input.middle = expected(progress);
    input.sharedHalves = splitPreservedMotionPath(zero, input.delta, input.shared, progress);
    const out = prepare(input);
    for (let i = 0; i <= 128; i++) {
      const t = i / 128,
        side = t <= progress ? 0 : 1,
        u = side ? (t - progress) / (1 - progress) : t / progress,
        delta = side
          ? { x: input.delta.x - input.middle.x, y: input.delta.y - input.middle.y }
          : input.middle,
        q = composed(delta, input.sharedHalves[side], out[side], u),
        wanted = expected(t);
      expect(q.x + (side ? input.middle.x : 0)).toBeCloseTo(wanted.x, 9);
      expect(q.y + (side ? input.middle.y : 0)).toBeCloseTo(wanted.y, 9);
    }
  });

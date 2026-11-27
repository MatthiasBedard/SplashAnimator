import { afterEach, expect, it, vi } from 'vitest';
import {
  createCubicDistanceCorrespondence,
  captureCubicDistanceCorrespondence,
  createMotionPathSampler,
} from '../packages/animation/src/motion-path';
import { prepareIndependentDistanceRestriction as prepare } from '../packages/animation/src/independent-distance-restriction';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(height = 16, progress = 0.5) {
  const delta = { x: 96, y: 0 },
    path = { startX: 32, startY: height, endX: -32, endY: height, distance: true, tangent: false },
    middle = createMotionPathSampler({ x: 0, y: 0 }, delta, path)(progress);
  return { delta, path, middle, progress };
}
const curve = (points: readonly { x: number; y: number }[], t: number) => {
  const u = 1 - t;
  return {
    x:
      u * u * u * points[0].x +
      3 * u * u * t * points[1].x +
      3 * u * t * t * points[2].x +
      t * t * t * points[3].x,
    y:
      u * u * u * points[0].y +
      3 * u * u * t * points[1].y +
      3 * u * t * t * points[2].y +
      t * t * t * points[3].y,
  };
};
for (const h of [0, 1, 8, 16, 32])
  it(`certifies continuous original relative correspondence for height ${h}`, () => {
    const input = fixture(h),
      before = structuredClone(input),
      out = prepare(input),
      originalPoints = [
        { x: 0, y: 0 },
        { x: 32, y: h },
        { x: 64, y: h },
        { x: 96, y: 0 },
      ],
      original = createCubicDistanceCorrespondence([
        originalPoints as [
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
        ],
      ]);
    for (let i = 0; i <= 128; i++) {
      const t = i / 128,
        side = t <= 0.5 ? 0 : 1,
        local = side ? (t - 0.5) * 2 : t * 2,
        delta = side ? { x: 96 - input.middle.x, y: -input.middle.y } : input.middle,
        p = out[side],
        points = [
          { x: 0, y: 0 },
          { x: p.startX, y: p.startY },
          { x: delta.x + p.endX, y: delta.y + p.endY },
          delta,
        ] as [
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
        ],
        map = createCubicDistanceCorrespondence([points]),
        a = curve(points, map.parameter(local)),
        b = curve(originalPoints, original.parameter(t));
      expect(a.x + (side ? input.middle.x : 0)).toBeCloseTo(b.x, 10);
      expect(a.y + (side ? input.middle.y : 0)).toBeCloseTo(b.y, 10);
    }
    expect(input).toEqual(before);
    for (const p of out) {
      expect(p.distance).toBe(true);
      expect(p.tangent).toBe(false);
      expect(p.waypoints).toBeUndefined();
    }
    out[0].startX++;
    expect(input).toEqual(before);
  });
it('keeps legacy return shape and sampling exactly unchanged while exposing detached immutable knots separately', () => {
  const points = [
      { x: 0, y: 0 },
      { x: 32, y: 16 },
      { x: 64, y: 16 },
      { x: 96, y: 0 },
    ] as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ],
    legacy = createCubicDistanceCorrespondence([points]),
    captured = captureCubicDistanceCorrespondence([points]);
  expect(Object.keys(legacy)).toEqual(['parameter', 'fraction', 'total']);
  expect(legacy.total).toBe(captured.total);
  expect(Object.isFrozen(captured.knots)).toBe(true);
  expect(captured.knots.every(Object.isFrozen)).toBe(true);
  for (let i = 0; i <= 128; i++) {
    expect(captured.parameter(i / 128)).toBe(legacy.parameter(i / 128));
    expect(captured.fraction(i / 128)).toBe(legacy.fraction(i / 128));
  }
  const before = captured.parameter(0.25);
  points[1].x = 999;
  expect(captured.parameter(0.25)).toBe(before);
});
it('keeps stationary correspondence and split semantics without adding distance', () => {
  const delta = { x: 0, y: 0 },
    path = { startX: 0, startY: 0, endX: 0, endY: 0, distance: true },
    out = prepare({ delta, path, middle: delta, progress: 0.5 });
  expect(out).toEqual([path, path]);
  const captured = captureCubicDistanceCorrespondence([[delta, delta, delta, delta]]);
  expect(captured.total).toBe(0);
  expect(captured.knots.map((k) => k.progress)).toEqual([0, 1]);
  expect(captured.parameter(0.25)).toBe(0.25);
});
for (const height of [48, 64, 96])
  it(`rejects mismatched fresh-table correspondence for curved height ${height}`, () => {
    const input = fixture(height),
      before = structuredClone(input);
    expect(() => prepare(input)).toThrow(/arc correspondence/);
    expect(input).toEqual(before);
  });
for (const progress of [0, 1, NaN, Infinity])
  it(`rejects invalid original progress ${progress} without source writes`, () => {
    const input = fixture();
    input.progress = progress;
    expect(() => prepare(input)).toThrow();
  });
for (const field of ['distance', 'waypoints', 'tangent'] as const)
  it(`rejects unqualified ${field} policy`, () => {
    const input = fixture();
    if (field === 'distance') input.path.distance = false;
    if (field === 'tangent') input.path.tangent = true;
    if (field === 'waypoints') Object.assign(input.path, { waypoints: [{ x: 40, y: 20 }] });
    expect(() => prepare(input)).toThrow();
  });
it('rejects raw original getters without reading or cloning them', () => {
  const input = fixture(),
    getter = vi.fn(() => 32),
    clone = vi.spyOn(globalThis, 'structuredClone');
  Object.defineProperty(input.path, 'startX', { get: getter, enumerable: true });
  expect(() => prepare(input)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(clone).not.toHaveBeenCalled();
});
for (const action of ['snapshot', 'source', 'late-getter'] as const)
  it(`rejects ${action} changes during original input capture`, () => {
    const input = fixture(),
      clone = structuredClone,
      getter = vi.fn(() => 32);
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value) as typeof input;
      if (action === 'snapshot') out.path.startX++;
      else if (action === 'source') input.path.startX++;
      else Object.defineProperty(out.path, 'startX', { get: getter, enumerable: true });
      return out;
    });
    expect(() => prepare(input)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
it('rejects finite original arithmetic overflow', () => {
  const input = fixture();
  input.delta.x = Number.MAX_VALUE;
  input.path.endX = Number.MAX_VALUE;
  expect(() => prepare(input)).toThrow();
});

it('rejects unknown original route fields instead of copying unqualified metadata', () => {
  const input = fixture();
  Object.assign(input.path, { unqualified: true });
  expect(() => prepare(input)).toThrow(/Unsupported/);
});

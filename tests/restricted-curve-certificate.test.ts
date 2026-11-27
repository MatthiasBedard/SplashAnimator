import { expect, it } from 'vitest';
import {
  certifyRestrictedCurveGeometry as certify,
  certifyRestrictedOriginalCurve as original,
  certifyRestrictedLinearGeometry as linear,
} from '../packages/animation/src/restricted-curve-certificate';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
const curve = [
  { x: -100, y: 0 },
  { x: -100 / 3, y: 0 },
  { x: 100 / 3, y: 0 },
  { x: 100, y: 0 },
];
it('certifies unchanged linear roots with one counter for both halves', () => {
  const work = { visits: 0 };
  linear({ x: 280, y: 40 }, { x: 376, y: 64 }, { x: 328, y: 52 }, 0.5, work);
  expect(work.visits).toBe(2);
});
it('rejects a different linear promoted point without normalizing it', () => {
  expect(() => linear({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 60, y: 50 }, 0.5)).toThrow(
    /unresolved/,
  );
});
it('admits exact constant/straight and relative translated cubic nets', () => {
  for (const offset of [0, 1000, 1e9]) {
    const points = curve.map((p) => ({ x: p.x + offset, y: offset })),
      before = structuredClone(points);
    certify(points, structuredClone(points));
    expect(points).toEqual(before);
  }
});
it('rejects near-zero continuous differences even when each individual control passes relative comparison', () => {
  const actual = curve.map((p) => ({ ...p, x: p.x + 1e-13 }));
  expect(sameMotionArtwork(curve, actual)).toBe(true);
  expect(() => certify(curve, actual)).toThrow(/unresolved/);
});
it('admits small relative differences when complete polynomial hulls remain safely away from zero', () => {
  const expected = curve.map((p) => ({ ...p, x: p.x + 1000 })),
    actual = expected.map((p) => ({ ...p, x: p.x + 1e-13 }));
  certify(expected, actual);
});
it('includes original restriction arithmetic in the geometric certificate', () => {
  original(
    [
      { x: 0, y: 0 },
      { x: 32, y: -40 },
      { x: 64, y: 0 },
      { x: 96, y: 24 },
    ],
    0,
    0.5,
    { x: 0, y: 100 },
    [
      { x: 0, y: 100 },
      { x: 16, y: 80 },
      { x: 32, y: 80 },
      { x: 48, y: 88 },
    ],
  );
});
it('shares the exact existing-size visit capacity across subsequent half proofs', () => {
  const work = { visits: 131071 };
  certify(curve, curve, work);
  expect(work.visits).toBe(131072);
  expect(() => certify(curve, curve, work)).toThrow(/budget/);
});
for (const value of [NaN, Infinity, -Infinity])
  it(`rejects original nonfinite coordinate ${value}`, () => {
    expect(() =>
      certify(
        curve,
        curve.map((p) => ({ ...p, x: value })),
      ),
    ).toThrow();
  });
it('rejects finite difference overflow without mutating either net', () => {
  const expected = curve.map((p) => ({ ...p, x: -Number.MAX_VALUE })),
    actual = curve.map((p) => ({ ...p, x: Number.MAX_VALUE })),
    before = structuredClone(actual);
  expect(() => certify(expected, actual)).toThrow(/numeric/);
  expect(actual).toEqual(before);
});
it('rejects raw control/work getters and sparse data without reading them', () => {
  const actual = structuredClone(curve);
  let reads = 0;
  Object.defineProperty(actual[0], 'x', {
    enumerable: true,
    get() {
      reads++;
      return 0;
    },
  });
  expect(() => certify(curve, actual)).toThrow();
  const work = Object.defineProperty({}, 'visits', {
    enumerable: true,
    get() {
      reads++;
      return 0;
    },
  });
  expect(() => certify(curve, curve, work as { visits: number })).toThrow();
  expect(reads).toBe(0);
  expect(() => certify(curve, new Array(4))).toThrow();
});

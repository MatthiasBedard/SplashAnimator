import { afterEach, expect, it, vi } from 'vitest';
import { freezeSnapshot, isImmutableSnapshot } from '../packages/document/src/immutable-snapshot';
import {
  validateLiveGraphicData,
  validateLiveMotionData,
} from '../packages/document/src/live-motion';
import { selectionTrajectoryStamp } from '../packages/animation/src/selection-trajectory';

afterEach(() => vi.restoreAllMocks());
it('memoizes an exact lossless stamp only after recursively freezing all owned data', () => {
  const data = { a: [{ x: 3, out: undefined }], missing: undefined },
    expected = selectionTrajectoryStamp(data);
  const owned = freezeSnapshot(structuredClone(data));
  expect(isImmutableSnapshot(data)).toBe(false);
  expect(isImmutableSnapshot(owned.a[0])).toBe(true);
  expect(Object.isFrozen(owned.a)).toBe(true);
  const reads = vi.spyOn(Object, 'getOwnPropertyDescriptors');
  const first = selectionTrajectoryStamp(owned),
    firstReads = reads.mock.calls.length;
  reads.mockClear();
  const subsequent = Array.from({ length: 10 }, () => selectionTrajectoryStamp(owned));
  const repeatedReads = reads.mock.calls.length;
  reads.mockRestore();
  expect(first).toBe(expected);
  expect(firstReads).toBeGreaterThan(0);
  expect(subsequent).toEqual(Array(10).fill(expected));
  expect(repeatedReads).toBe(0);
  expect(() => {
    owned.a[0].x = 9;
  }).toThrow();
  expect(() => {
    delete (owned as { missing?: undefined }).missing;
  }).toThrow();
  expect(() => Object.setPrototypeOf(owned.a[0], {})).toThrow();
  expect(data.a[0].x).toBe(3);
});
it('does not trust shallow freezes, direct freezes or mutable public clones', () => {
  const p = Object.freeze({ a: { x: 3 } }),
    before = selectionTrajectoryStamp(p);
  expect(isImmutableSnapshot(p)).toBe(false);
  p.a.x = 4;
  expect(selectionTrajectoryStamp(p)).not.toBe(before);
  const frozen = freezeSnapshot({ a: { x: 3 } }),
    copy = structuredClone(frozen);
  expect(isImmutableSnapshot(copy)).toBe(false);
  copy.a.x = 8;
  expect(selectionTrajectoryStamp(copy)).not.toBe(selectionTrajectoryStamp(frozen));
});
it('retains missing/undefined, negative zero, array order and original insertion order semantics', () => {
  for (const value of [{ a: undefined }, {}, { a: -0, b: 2 }, { b: 2, a: 0 }, [undefined, 3, 1]])
    expect(selectionTrajectoryStamp(freezeSnapshot(structuredClone(value)))).toBe(
      selectionTrajectoryStamp(value),
    );
  expect(selectionTrajectoryStamp(freezeSnapshot({ a: undefined }))).not.toBe(
    selectionTrajectoryStamp(freezeSnapshot({})),
  );
});
it('permits repeated immutable children without retaining a cyclic graph', () => {
  const a = { x: 1 },
    p = freezeSnapshot({ a, b: a });
  expect(p.a).toBe(p.b);
  expect(selectionTrajectoryStamp(p)).toBe(selectionTrajectoryStamp({ a: { x: 1 }, b: { x: 1 } }));
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  expect(() => freezeSnapshot(cycle)).toThrow(/cycles/);
  expect(isImmutableSnapshot(cycle)).toBe(false);
});
for (const bad of [NaN, Infinity, () => {}, new Date(), Symbol('bad')])
  it(`rejects unsupported snapshot data ${String(bad)} before granting memoization`, () => {
    const p = { bad };
    expect(() => freezeSnapshot(p)).toThrow();
    expect(isImmutableSnapshot(p)).toBe(false);
  });
it('does not execute accessors while checking immutable data', () => {
  let reads = 0;
  const p = Object.defineProperty({}, 'x', {
    enumerable: true,
    get() {
      reads++;
      return 1;
    },
  });
  expect(() => freezeSnapshot(p)).toThrow(/data fields/);
  expect(reads).toBe(0);
});
it('retains graphic-specific dense-array checks after generic immutable data admission', () => {
  const p = freezeSnapshot({ sparse: Array(2) });
  validateLiveMotionData(p);
  expect(() => validateLiveGraphicData(p)).toThrow(/dense/);
  expect(() => validateLiveGraphicData(p)).toThrow(/dense/);
  const valid = freezeSnapshot({ nodes: [{ x: 3, out: undefined }] });
  validateLiveGraphicData(valid);
  validateLiveGraphicData(valid);
});

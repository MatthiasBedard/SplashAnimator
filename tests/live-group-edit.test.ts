import { it, expect } from 'vitest';
import {
  liveGroupHeaderChange as patch,
  type LiveGroupHeaderPatch,
} from '../apps/editor/src/live-group-edit';
import type { MotionRotation } from '../packages/document/src/motion-rotation';
import { liveRotationFixture } from './live-motion-rotation-fixture';
import { prepareUpdateLiveMotionSpans } from '../packages/animation/src/live-motion';
const original = () => ({
  direction: 'shortest' as const,
  turns: 0,
  rigidGroups: true,
  groupDepth: 0,
  uniformGroupScale: false,
  axisGroupScale: false,
  axisGroupShear: false,
  savedGroupPivots: false,
  rigidPivot: undefined,
});
it('preserves all unchosen own false/undefined/depth metadata and detaches frozen originals', () => {
  const source = Object.freeze(original()),
    out = patch(source, { direction: 'clockwise', turns: 1 });
  expect(out).toEqual({ ...source, direction: 'clockwise', turns: 1 });
  expect(Object.hasOwn(out, 'rigidPivot')).toBe(true);
  out.turns = 2;
  expect(source.turns).toBe(0);
});
for (const key of ['uniformGroupScale', 'axisGroupScale', 'axisGroupShear'] as const)
  for (const mode of ['enable', 'disable', 'remove'] as const)
    it(`${mode} changes only original ${key}`, () => {
      const source = original(),
        before = { ...source },
        out = patch(source, { [key]: mode }),
        expected = { ...source };
      if (mode === 'remove') delete expected[key];
      else expected[key] = mode === 'enable';
      expect(out).toEqual(expected);
      expect(source).toEqual(before);
    });
for (const value of [
  {},
  null,
  [],
  { extra: true },
  { turns: NaN },
  { turns: Infinity },
  { turns: 0.5 },
  { turns: -1 },
  { turns: Number.MAX_SAFE_INTEGER },
  { direction: 'invalid' },
  { axisGroupScale: 'unknown' },
  { axisGroupShear: undefined },
])
  it(`rejects raw patch ${JSON.stringify(value)} without changing original fields`, () => {
    const source = original(),
      before = { ...source };
    expect(() => patch(source, value as LiveGroupHeaderPatch)).toThrow();
    expect(source).toEqual(before);
  });
for (const role of ['source', 'patch'] as const)
  for (const key of ['direction', 'turns'] as const)
    it(`${role} ${key} getters reject with zero reads`, () => {
      const source = original(),
        changes: LiveGroupHeaderPatch = { direction: 'clockwise' };
      let reads = 0;
      Object.defineProperty(role === 'source' ? source : changes, key, {
        enumerable: true,
        get() {
          reads++;
          return 0;
        },
      });
      expect(() => patch(source, changes)).toThrow();
      expect(reads).toBe(0);
    });
for (const mode of ['plain', 'unknown', 'nonenumerable', 'inherited'] as const)
  it(`rejects unsupported ${mode} original header without metadata loss`, () => {
    const source: MotionRotation = original();
    let reads = 0;
    if (mode === 'plain') source.rigidGroups = false;
    if (mode === 'unknown') Object.assign(source, { extra: 'keep' });
    if (mode === 'nonenumerable')
      Object.defineProperty(source, 'turns', { enumerable: false, value: 0 });
    if (mode === 'inherited') {
      delete (source as Partial<MotionRotation>).turns;
      Object.setPrototypeOf(
        source,
        Object.create(null, {
          turns: {
            get() {
              reads++;
              return 0;
            },
          },
        }),
      );
    }
    expect(() => patch(source, { direction: 'clockwise' })).toThrow();
    expect(reads).toBe(0);
  });
it('does not silently fix incompatible dependencies or enable interpolation options', () => {
  const f = liveRotationFixture(),
    before = structuredClone(f.p),
    header = patch(f.p.layers[0].liveMotionSpans![0].rotation!, { uniformGroupScale: 'enable' });
  expect(() =>
    prepareUpdateLiveMotionSpans(f.p, [
      { layerId: 'track', spanId: 'live', changes: { rotation: header } },
    ]),
  ).toThrow();
  expect(f.p).toEqual(before);
});
it('null-prototype original data preserves its own raw header fields', () => {
  const source = Object.assign(Object.create(null), original()),
    out = patch(source, { direction: 'clockwise' });
  expect(Object.getPrototypeOf(out)).toBeNull();
  expect(out).toEqual({ ...original(), direction: 'clockwise' });
});

it('descriptor ownership checks do not consult inherited required group fields', () => {
  const source = { direction: 'shortest' as const, turns: 0 };
  let reads = 0,
    rejected = false;
  Object.defineProperty(Object.prototype, 'rigidGroups', {
    configurable: true,
    get() {
      reads++;
      throw Error('must not read');
    },
  });
  try {
    patch(source, { direction: 'clockwise' });
  } catch {
    rejected = true;
  } finally {
    Reflect.deleteProperty(Object.prototype, 'rigidGroups');
  }
  expect(rejected).toBe(true);
  expect(reads).toBe(0);
});

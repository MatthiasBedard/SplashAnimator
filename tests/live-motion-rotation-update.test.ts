import { expect, it, vi, afterEach } from 'vitest';
import { validateProject, MAX_SYMBOL_ARTWORK, type Project } from '../packages/document/src';
import type { MotionRotation } from '../packages/document/src/motion-rotation';
import {
  prepareUpdateLiveMotionSpans as update,
  captureLiveMotionTimeline as capture,
  prepareRemoveLiveMotionSpans as remove,
  type UpdateLiveMotionRequest,
} from '../packages/animation/src/live-motion';
import {
  liveRotationFixture as fixture,
  secondRotationTrack,
} from './live-motion-rotation-fixture';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const req = (rotation: MotionRotation | undefined, layerId = 'track'): UpdateLiveMotionRequest => ({
  layerId,
  spanId: 'live',
  changes: { rotation },
});
const clockwise: MotionRotation = Object.freeze({
  direction: 'clockwise',
  turns: 1,
  rigidGroups: true,
});
function sample(p: Project, frame = 4) {
  const c = capture(() => ({ project: p, revision: 0 }));
  try {
    return c.sample(frame)[0].key.shapes;
  } finally {
    c.dispose();
  }
}
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`replaces ${mode} ${basis} group direction with independent world oracles and exact authored data`, () => {
      const f = fixture(mode, basis, true),
        before = structuredClone(f.p),
        rotation = {
          ...f.p.layers[0].liveMotionSpans![0].rotation!,
          direction: 'clockwise' as const,
          turns: 1,
        },
        out = update(f.p, [req(rotation)]),
        expected = structuredClone(f.p);
      expected.layers[0].liveMotionSpans![0].rotation = rotation;
      expect(out).toEqual(expected);
      expect(f.p).toEqual(before);
      for (const frame of [1, 2, 4, 6, 7]) {
        const t = frame / 8,
          r = (t * 450 * Math.PI) / 180,
          c = Math.cos(r),
          s = Math.sin(r),
          actual = sample(out, frame);
        for (let i = 0; i < actual.length; i++) {
          const original = f.p.layers[0].keys[0].shapes[i],
            last = f.p.layers[0].keys[1].shapes[i],
            grouped = !!original.groups?.length,
            leader = f.p.layers[0].keys[0].shapes[i < 2 ? 0 : 2];
          const h = grouped
            ? [1 - t + f.h[0] * t, f.h[1] * t, f.h[2] * t, 1 - t + f.h[3] * t]
            : [1, 0, 0, 1];
          const dx = grouped ? original.x - leader.x : 0,
            dy = grouped ? original.y - leader.y : 0;
          const x = grouped
            ? leader.x + 80 * t + c * (h[0] * dx + h[2] * dy) - s * (h[1] * dx + h[3] * dy)
            : original.x + (last.x - original.x) * t;
          const y = grouped
            ? leader.y + s * (h[0] * dx + h[2] * dy) + c * (h[1] * dx + h[3] * dy)
            : original.y + (last.y - original.y) * t;
          for (const local of [
            { x: 0, y: 0 },
            { x: 6, y: 5 },
            { x: 12, y: 10 },
          ]) {
            const bx = f.b[0] * local.x + f.b[2] * local.y,
              by = f.b[1] * local.x + f.b[3] * local.y,
              u = h[0] * bx + h[2] * by,
              v = h[1] * bx + h[3] * by,
              world = mapPoint(matrix(actual[i]), local);
            expect(world.x).toBeCloseTo(x + c * u - s * v, 9);
            expect(world.y).toBeCloseTo(y + s * u + c * v, 9);
          }
        }
      }
      expect(sample(out, 0)).toEqual(before.layers[0].keys[0].shapes);
      expect(sample(out, 8)).toEqual(before.layers[0].keys[1].shapes);
      expect(sample(out, 9)).toEqual(before.layers[0].keys[1].shapes);
      expect(sample(out, 10)).toEqual([]);
      expect(validateProject(JSON.parse(JSON.stringify(out)))).toEqual(out);
    });
for (const header of [
  { direction: 'clockwise', turns: 1 },
  { direction: 'counterclockwise', turns: 0 },
  {
    direction: 'shortest',
    turns: 0,
    rigidGroups: false,
    uniformGroupScale: false,
    axisGroupScale: false,
    axisGroupShear: false,
    savedGroupPivots: false,
  },
] as MotionRotation[])
  it(`plain roots retain exact explicit header ${JSON.stringify(header)}`, () => {
    const f = fixture('rigid', 'reflected', false, true),
      before = structuredClone(f.p),
      out = update(f.p, [req(header)]),
      wanted = structuredClone(f.p);
    wanted.layers[0].liveMotionSpans![0].rotation = header;
    expect(out).toEqual(wanted);
    expect(f.p).toEqual(before);
    const delta =
      header.direction === 'clockwise' ? 450 : header.direction === 'counterclockwise' ? -270 : 90;
    expect(sample(out)[0].rotation).toBeCloseTo(delta / 2, 10);
  });
it('omission preserves every original false/undefined flag while explicit undefined clears only a plain header', () => {
  const f = fixture('rigid', 'plain', false, true),
    header = {
      direction: 'clockwise' as const,
      turns: 1,
      rigidGroups: false,
      axisGroupScale: false,
      axisGroupShear: false,
      savedGroupPivots: false,
      uniformGroupScale: undefined,
    };
  f.p.layers[0].liveMotionSpans![0].rotation = header;
  const kept = update(f.p, [{ layerId: 'track', spanId: 'live', changes: { ease: 'in' } }]);
  expect(kept.layers[0].liveMotionSpans![0].rotation).toEqual(header);
  expect(Object.hasOwn(kept.layers[0].liveMotionSpans![0].rotation!, 'uniformGroupScale')).toBe(
    true,
  );
  const out = update(f.p, [req(undefined)]),
    expected = structuredClone(f.p);
  delete expected.layers[0].liveMotionSpans![0].rotation;
  expect(out).toEqual(expected);
  expect(sample(out)[0].rotation).toBe(45);
  expect(update(out, [req(undefined)])).toEqual(out);
});
it('a supplied header is a whole explicit replacement, not a merge of old flags', () => {
  const f = fixture('rigid', 'plain', false, true);
  Object.assign(f.p.layers[0].liveMotionSpans![0].rotation!, {
    rigidGroups: false,
    uniformGroupScale: false,
  });
  const out = update(f.p, [req({ direction: 'clockwise', turns: 1 })]);
  expect(out.layers[0].liveMotionSpans![0].rotation).toEqual({ direction: 'clockwise', turns: 1 });
});
for (const operation of ['clear', 'disable', 'enablePlain'] as const)
  it(`rejects group scope ${operation} atomically`, () => {
    const f = fixture('rigid', 'plain', false, operation === 'enablePlain'),
      before = structuredClone(f.p);
    expect(() =>
      update(f.p, [
        req(
          operation === 'clear'
            ? undefined
            : operation === 'disable'
              ? { direction: 'shortest', turns: 0, rigidGroups: false }
              : clockwise,
        ),
      ]),
    ).toThrow();
    expect(f.p).toEqual(before);
  });
for (const value of [
  null,
  0,
  [],
  {},
  new Date(),
  { direction: 'shortest' },
  { turns: 0 },
  { direction: 'invalid', turns: 0 },
  { direction: 'shortest', turns: 1 },
  { direction: 'clockwise', turns: -1 },
  { direction: 'clockwise', turns: 0.5 },
  { direction: 'clockwise', turns: NaN },
  { direction: 'clockwise', turns: Infinity },
  { direction: 'clockwise', turns: Number.MAX_SAFE_INTEGER },
  { direction: 'clockwise', turns: 0, extra: true },
  { direction: 'clockwise', turns: 0, axisGroupShear: true },
  { direction: 'clockwise', turns: 0, uniformGroupScale: true },
  { ...clockwise, uniformGroupScale: true, axisGroupScale: true },
  { ...clockwise, groupDepth: 1 },
  { ...clockwise, savedGroupPivots: true },
  { ...clockwise, rigidPivot: { x: 0, y: 0 } },
  { ...clockwise, axisGroupScale: 'yes' },
])
  it(`rejects original malformed header ${JSON.stringify(value)} before source cloning`, () => {
    const f = fixture(),
      before = structuredClone(f.p),
      clone = vi.fn(structuredClone);
    vi.stubGlobal('structuredClone', clone);
    expect(() => update(f.p, [req(value as MotionRotation)])).toThrow();
    expect(clone).not.toHaveBeenCalled();
    expect(f.p).toEqual(before);
  });
for (const field of ['direction', 'turns', 'rigidGroups', 'axisGroupScale', 'extra'])
  it(`rejects original ${field} getter with zero reads`, () => {
    const f = fixture(),
      rotation = { ...clockwise };
    let reads = 0;
    Object.defineProperty(rotation, field, {
      enumerable: true,
      get() {
        reads++;
        return 0;
      },
    });
    const clone = vi.fn(structuredClone);
    vi.stubGlobal('structuredClone', clone);
    expect(() => update(f.p, [req(rotation)])).toThrow();
    expect(reads).toBe(0);
    expect(clone).not.toHaveBeenCalled();
  });
for (const mode of [
  'nonenumerable',
  'customPrototype',
  'inheritedRequired',
  'inheritedOptional',
] as const)
  it(`rejects ${mode} original header without executing inherited data`, () => {
    const f = fixture(),
      rotation = { ...clockwise };
    let reads = 0;
    if (mode === 'nonenumerable')
      Object.defineProperty(rotation, 'turns', { enumerable: false, value: 0 });
    if (mode === 'customPrototype') Object.setPrototypeOf(rotation, { tag: 'custom' });
    if (mode === 'inheritedRequired') {
      delete (rotation as Partial<MotionRotation>).turns;
      Object.setPrototypeOf(
        rotation,
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
    if (mode === 'inheritedOptional')
      Object.defineProperty(Object.prototype, 'axisGroupScale', {
        configurable: true,
        get() {
          reads++;
          return false;
        },
      });
    let rejected = false;
    try {
      update(f.p, [req(rotation)]);
    } catch {
      rejected = true;
    } finally {
      if (mode === 'inheritedOptional') Reflect.deleteProperty(Object.prototype, 'axisGroupScale');
    }
    expect(rejected).toBe(true);
    expect(reads).toBe(0);
  });
for (const change of [
  'missingAffine',
  'incompatibleScale',
  'innerDepth',
  'continuousDeterminant',
] as const)
  it(`retains shared ${change} geometry admission`, () => {
    const f = fixture(
        change === 'continuousDeterminant' ||
          change === 'missingAffine' ||
          change === 'incompatibleScale'
          ? 'axes'
          : 'rigid',
      ),
      before = structuredClone(f.p);
    if (change === 'continuousDeterminant')
      for (const shape of f.p.layers[0].keys[1].shapes) {
        const first = f.p.layers[0].keys[0].shapes.find((a) => a.id === shape.id)!;
        shape.transform = [-2, 1, 1, -2];
        shape.x = 80 - (first.x * 1 + (first.y - 20) * -2);
        shape.y = 20 + first.x * -2 + (first.y - 20);
      }
    const original = structuredClone(f.p),
      rotation = {
        ...clockwise,
        ...(change === 'continuousDeterminant'
          ? { axisGroupScale: true, axisGroupShear: true }
          : change === 'incompatibleScale'
            ? { uniformGroupScale: true }
            : change === 'innerDepth'
              ? { groupDepth: 1 }
              : { axisGroupScale: true }),
      };
    const request = req(rotation);
    if (change === 'missingAffine') request.changes.options = { paint: true };
    expect(() => update(f.p, [request])).toThrow();
    expect(f.p).toEqual(original);
    if (change !== 'continuousDeterminant') expect(f.p).toEqual(before);
  });
it('all chosen group and plain requests prepare together and later scope failure preserves everything', () => {
  const f = fixture(),
    later = secondRotationTrack(f.p);
  for (const k of later.keys) for (const s of k.shapes) delete s.groups;
  delete later.liveMotionSpans![0].rotation;
  const before = structuredClone(f.p),
    out = update(f.p, [req(clockwise), req({ direction: 'counterclockwise', turns: 0 }, 'later')]);
  expect(out.layers[0].keys).toEqual(before.layers[0].keys);
  expect(out.layers[1].keys).toEqual(before.layers[1].keys);
  expect(out.layers.map((l) => l.liveMotionSpans![0].rotation?.direction)).toEqual([
    'clockwise',
    'counterclockwise',
  ]);
  expect(f.p).toEqual(before);
  expect(() => update(f.p, [req(clockwise), req(clockwise, 'later')])).toThrow();
  expect(f.p).toEqual(before);
});
it('keeps original path/channels/settings while permitting explicit combined header and option admission', () => {
  const f = fixture('axes');
  f.p.layers[0].liveMotionSpans![0].path = {
    startX: 0,
    startY: 30,
    endX: 0,
    endY: 30,
    waypoints: [{ x: 40, y: 0 }],
    curvedWaypoints: true,
    waypointTangents: [
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
    ],
    waypointIncoming: [{ x: 10, y: 0 }],
    distance: true,
  };
  const before = structuredClone(f.p),
    r = req({ ...clockwise, axisGroupScale: true });
  r.changes.ease = 'in';
  r.changes.options = { ...f.p.layers[0].liveMotionSpans![0].options, affine: true };
  const out = update(f.p, [r]);
  expect(out.layers[0].keys).toEqual(before.layers[0].keys);
  expect(out.layers[0].liveMotionSpans![0].path).toEqual(before.layers[0].liveMotionSpans![0].path);
  expect(out.layers[0].liveMotionSpans![0].opacityEase).toBe('out');
  expect(out.layers[0].liveMotionSpans![0].paintEase).toBe('linear');
  expect(out.symbols).toEqual(before.symbols);
});
it('public output and request headers are detached and reopened endpoint edits need no Refresh', () => {
  const f = fixture(),
    r = req({ ...clockwise }),
    out = update(f.p, [r]);
  r.changes.rotation!.turns = 2;
  expect(out.layers[0].liveMotionSpans![0].rotation!.turns).toBe(1);
  const reopened = validateProject(JSON.parse(JSON.stringify(out)));
  for (const s of reopened.layers[0].keys[1].shapes) s.x += 20;
  expect(sample(reopened)[0].x).toBeCloseTo(sample(out)[0].x + 10);
  out.layers[0].liveMotionSpans![0].rotation!.turns = 3;
  expect(f.p.layers[0].liveMotionSpans![0].rotation!.turns).toBe(0);
});
for (const mode of ['source', 'input', 'enclosing', 'async', 'reentry'] as const)
  it(`rejects ${mode} admission and permits an independent fresh retry`, () => {
    const f = fixture(),
      r = [req({ ...clockwise })],
      before = structuredClone(f.p);
    let first = true,
      revision = 0;
    expect(() =>
      update(f.p, r, {
        validate: () => {
          if (revision) throw Error('Changed enclosing revision');
          if (!first) return;
          first = false;
          if (mode === 'source') f.p.name = 'Independent edit';
          if (mode === 'input') r[0].changes.rotation!.turns = 2;
          if (mode === 'enclosing') {
            revision++;
            throw Error('Changed enclosing revision');
          }
          if (mode === 'async') return Promise.resolve() as unknown as void;
          if (mode === 'reentry')
            try {
              update(f.p, r);
            } catch {
              /* swallowed reentry remains rejected */
            }
        },
      }),
    ).toThrow();
    expect(f.p.layers).toEqual(before.layers);
    expect(update(f.p, [req(clockwise)]).layers[0].liveMotionSpans![0].rotation).toEqual(clockwise);
  });
for (const mode of ['requestClone', 'outputClone', 'lateSource', 'lateCandidate'] as const)
  it(`rejects asserted ${mode} corruption after detached headers exist`, () => {
    const f = fixture(),
      before = structuredClone(f.p),
      clone = structuredClone;
    let candidate: Project | undefined,
      hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value),
        p = out as Project;
      if (value === f.p) candidate = p;
      if (!hit && mode === 'requestClone' && Array.isArray(out) && out[0]?.changes?.rotation) {
        hit = true;
        out[0].changes.rotation.turns = 2;
      }
      if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.rotation?.turns === 1) {
        hit = true;
        if (mode === 'outputClone') p.layers[0].liveMotionSpans![0].rotation!.turns = 2;
        if (mode === 'lateSource') f.p.name = 'Independent edit';
        if (mode === 'lateCandidate') candidate!.layers[0].liveMotionSpans![0].rotation!.turns = 2;
      }
      return out;
    });
    expect(() => update(f.p, [req(clockwise)])).toThrow();
    expect(hit).toBe(true);
    expect(f.p.layers).toEqual(before.layers);
  });
it('geometrically invalid records retain geometry-free removal recovery', () => {
  const f = fixture();
  f.p.layers[0].keys[1].shapes[1].x += 5;
  expect(() => update(f.p, [req(clockwise)])).toThrow();
  const recovered = remove(f.p, [{ layerId: 'track', spanId: 'live' }]);
  expect(recovered.layers[0].keys).toEqual(f.p.layers[0].keys);
  expect(recovered.layers[0].liveMotionSpans).toBeUndefined();
});
it('admits the original aggregate library capacity and rejects overflow without a smaller group cap', () => {
  const f = fixture(),
    art = f.p.symbols![0].shapes[0];
  f.p.symbols![0].shapes = Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
    ...art,
    id: 's' + i,
    points: [],
  }));
  expect(update(f.p, [req(clockwise)]).symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  f.p.symbols![0].shapes.push({ ...art, id: 'overflow' });
  expect(() => update(f.p, [req(clockwise)])).toThrow(/budget/);
}, 30000);

for (const [origin, unit] of [
  [0, 1e-6],
  [10000, 0.001],
] as const)
  it(`retains relative group numerics at ${origin} with unit ${unit}`, () => {
    const f = fixture();
    for (const key of f.p.layers[0].keys)
      for (const shape of key.shapes) {
        shape.x = origin + shape.x * unit;
        shape.y = origin + shape.y * unit;
        shape.width *= unit;
        shape.height *= unit;
      }
    const before = structuredClone(f.p),
      out = update(f.p, [req(clockwise)]),
      actual = sample(out),
      x = origin + 40 * unit,
      y = origin + 20 * unit;
    expect(Math.abs(actual[0].x - x)).toBeLessThan(unit * 1e-7);
    expect(Math.abs(actual[0].y - y)).toBeLessThan(unit * 1e-7);
    expect(Math.abs(actual[1].x - (x - (40 * unit) / Math.SQRT2))).toBeLessThan(unit * 1e-7);
    expect(Math.abs(actual[1].y - (y - (40 * unit) / Math.SQRT2))).toBeLessThan(unit * 1e-7);
    expect(f.p).toEqual(before);
  });

it('admits null-prototype original header data without requiring transport prototype identity', () => {
  const f = fixture(),
    header = Object.assign(Object.create(null), clockwise),
    out = update(f.p, [req(header)]);
  expect(out.layers[0].liveMotionSpans![0].rotation).toEqual(clockwise);
  expect(Object.getPrototypeOf(header)).toBeNull();
  header.turns = 2;
  expect(out.layers[0].liveMotionSpans![0].rotation!.turns).toBe(1);
});
it('null-prototype requests reject inherited transport flags before they can be materialized or read', () => {
  const f = fixture(),
    header = Object.assign(Object.create(null), clockwise),
    clone = vi.fn(structuredClone);
  vi.stubGlobal('structuredClone', clone);
  let reads = 0,
    rejected = false;
  Object.defineProperty(Object.prototype, 'axisGroupShear', {
    configurable: true,
    get() {
      reads++;
      return false;
    },
  });
  try {
    update(f.p, [req(header)]);
  } catch {
    rejected = true;
  } finally {
    Reflect.deleteProperty(Object.prototype, 'axisGroupShear');
  }
  expect(rejected).toBe(true);
  expect(reads).toBe(0);
  expect(clone).not.toHaveBeenCalled();
});
it('retains explicit false, outer depth zero and own undefined metadata on a complete group header', () => {
  const f = fixture(),
    header: MotionRotation = {
      ...clockwise,
      groupDepth: 0,
      uniformGroupScale: false,
      axisGroupScale: false,
      axisGroupShear: false,
      savedGroupPivots: false,
      rigidPivot: undefined,
    };
  const out = update(f.p, [req(header)]);
  expect(out.layers[0].liveMotionSpans![0].rotation).toEqual(header);
  expect(Object.hasOwn(out.layers[0].liveMotionSpans![0].rotation!, 'rigidPivot')).toBe(true);
});

for (const kind of ['data', 'getter'] as const)
  it(`inherited request changes ${kind} cannot own a rotation update or run before capture`, () => {
    const f = fixture(),
      clone = vi.fn(structuredClone);
    vi.stubGlobal('structuredClone', clone);
    let reads = 0;
    const request = Object.assign(
      Object.create(
        Object.create(null, {
          changes:
            kind === 'getter'
              ? {
                  get() {
                    reads++;
                    return { rotation: clockwise };
                  },
                }
              : { value: { rotation: clockwise } },
        }),
      ),
      { layerId: 'track', spanId: 'live' },
    );
    expect(() => update(f.p, [request])).toThrow(/own changes/);
    expect(reads).toBe(0);
    expect(clone).not.toHaveBeenCalled();
  });

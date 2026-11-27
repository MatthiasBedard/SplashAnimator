import { afterEach, expect, it, vi } from 'vitest';
import {
  captureIndependentGroupTrajectories as capture,
  type IndependentGroupTrajectory as Binding,
} from '../packages/animation/src/independent-group-trajectories';
import { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
afterEach(() => vi.unstubAllGlobals());
function fixture(basis = 'plain', shared = false, two = false) {
  const { p } = liveRotationFixture('rigid', basis, true);
  const layer = p.layers[0];
  layer.keys[1].shapes = layer.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 80,
    y: s.y + 16,
  }));
  if (shared) layer.liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  if (two) secondRotationTrack(p);
  return p;
}
const binding = (groupId = 'outer', layerId = 'track'): Binding => ({
  layerId,
  spanId: 'live',
  groupId,
  composition: 'additive',
  path: { startX: 0, startY: -40, endX: 0, endY: -40 },
});
function setup(p = fixture(), banks: Binding[] = [binding()]) {
  let revision = 4;
  const read = () => ({ project: p, revision });
  return { p, read, banks, scope: capture(read, banks), bump: () => revision++ };
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const shared of [false, true])
    for (const group of ['outer', 'second'])
      it(`adds only ${group}'s independent route with shared=${shared}/${basis}`, () => {
        const p = fixture(basis, shared),
          before = structuredClone(p),
          r = binding(group);
        const scope = capture(() => ({ project: p, revision: 0 }), [r]);
        const baseline = captureLiveMotionTimeline(() => ({ project: p, revision: 0 }));
        for (let f = 0; f < p.duration; f++) {
          const actual = scope.sample(f),
            original = baseline.sample(f);
          if (f === 0 || f >= 8) {
            expect(actual).toEqual(original);
            continue;
          }
          const t = f / 8;
          // Analytic cubic with (0,-40) start/end control offsets. Subtract
          // linear endpoint travel before composing with the shared route.
          const x = 80 * (3 * t * t - 2 * t * t * t) - 80 * t;
          const y = 16 * (3 * t * t - 2 * t * t * t) - 16 * t - 120 * t * (1 - t);
          for (let i = 0; i < 5; i++) {
            const a = actual[0].key.shapes[i],
              b = original[0].key.shapes[i];
            if (b.groups?.[0] !== group) expect(a).toEqual(b);
            else {
              expect(a.x).toBeCloseTo(b.x + x, 10);
              expect(a.y).toBeCloseTo(b.y + y, 10);
              expect({ ...a, x: b.x, y: b.y }).toEqual(b);
              const local = { x: 7, y: 3 },
                aWorld = mapPoint(matrix(a), local),
                bWorld = mapPoint(matrix(b), local);
              expect(aWorld.x).toBeCloseTo(bWorld.x + x, 10);
              expect(aWorld.y).toBeCloseTo(bWorld.y + y, 10);
            }
          }
        }
        expect(p).toEqual(before);
        scope.dispose();
        baseline.dispose();
      });
it('omitted and empty banks retain exact default poses without new metadata', () => {
  const p = fixture('reflected', true),
    a = capture(() => ({ project: p, revision: 0 })),
    b = capture(() => ({ project: p, revision: 0 }), []),
    old = captureLiveMotionTimeline(() => ({ project: p, revision: 0 }));
  for (let f = 0; f < p.duration; f++) {
    expect(a.sample(f)).toEqual(old.sample(f));
    expect(b.sample(f)).toEqual(old.sample(f));
  }
  a.dispose();
  b.dispose();
  old.dispose();
});
it('admits multiple independent groups on multiple tracks atomically', () => {
  const p = fixture('affine', true, true),
    banks = [binding(), binding('second'), binding('outer', 'later')];
  banks[1].path.startY = banks[1].path.endY = 20;
  const s = setup(p, banks),
    pose = s.scope.sample(4),
    old = captureLiveMotionTimeline(s.read),
    base = old.sample(4);
  expect(pose[0].key.shapes[0].y - base[0].key.shapes[0].y).toBe(-30);
  expect(pose[0].key.shapes[2].y - base[0].key.shapes[2].y).toBe(15);
  expect(pose[1].key.shapes[0].y - base[1].key.shapes[0].y).toBe(-30);
  expect(pose[1].key.shapes[2]).toEqual(base[1].key.shapes[2]);
  s.scope.dispose();
  old.dispose();
});
it('detaches original controls and every returned pose', () => {
  const s = setup();
  const first = s.scope.sample(4);
  s.banks[0].path.startY = 300;
  first[0].key.shapes[0].x = 999;
  first[0].key.shapes.length = 0;
  const next = s.scope.sample(4);
  expect(next[0].key.shapes).toHaveLength(5);
  expect(next[0].key.shapes[0].x).toBe(40);
  s.scope.dispose();
});
for (const mode of ['source', 'library', 'revision', 'dispose'])
  it(`rejects stale ${mode} before returning output`, () => {
    const s = setup();
    if (mode === 'source') s.p.layers[0].keys[0].shapes[0].x++;
    if (mode === 'library') s.p.symbols![0].name += ' changed';
    if (mode === 'revision') s.bump();
    if (mode === 'dispose') s.scope.dispose();
    expect(() => s.scope.sample(4)).toThrow();
  });
for (const mode of [
  'NaN',
  'Infinity',
  'getter',
  'prototype',
  'nonenumerable',
  'sparse',
  'extra',
  'missing',
  'composition',
  'duplicate',
  'group',
  'inner',
  'track',
  'tangent',
])
  it(`rejects original ${mode} banks without reads or source writes`, () => {
    const p = fixture(),
      before = structuredClone(p),
      banks = [binding()];
    let reads = 0;
    if (mode === 'NaN') banks[0].path.startX = NaN;
    if (mode === 'Infinity') banks[0].path.endY = Infinity;
    if (mode === 'getter')
      Object.defineProperty(banks[0].path, 'startX', {
        enumerable: true,
        get() {
          reads++;
          return 0;
        },
      });
    if (mode === 'prototype') Object.setPrototypeOf(banks[0], { path: binding().path });
    if (mode === 'nonenumerable')
      Object.defineProperty(banks[0], 'path', { enumerable: false, value: binding().path });
    if (mode === 'sparse') banks.length = 2;
    if (mode === 'extra') Object.assign(banks[0], { other: true });
    if (mode === 'missing') delete (banks[0] as Partial<Binding>).path;
    if (mode === 'composition') banks[0].composition = 'replace' as 'additive';
    if (mode === 'duplicate') banks.push(binding());
    if (mode === 'group') banks[0].groupId = 'loose';
    if (mode === 'inner') banks[0].groupId = 'inner';
    if (mode === 'track') banks[0].layerId = 'missing';
    if (mode === 'tangent') banks[0].path.tangent = true;
    expect(() => capture(() => ({ project: p, revision: 0 }), banks)).toThrow();
    expect(reads).toBe(0);
    expect(p).toEqual(before);
  });
for (const mode of ['rotation', 'basis', 'displacement', 'symbol', 'shared tangent', 'saved pivot'])
  it(`retains unsupported ${mode} admission`, () => {
    const p = fixture(),
      l = p.layers[0],
      span = l.liveMotionSpans![0];
    if (mode === 'rotation') l.keys[1].shapes[0].rotation = 90;
    if (mode === 'basis') l.keys[1].shapes[0].transform = [2, 0, 0, 2];
    if (mode === 'displacement') l.keys[1].shapes[1].x++;
    if (mode === 'symbol') {
      l.keys[0].shapes[0].kind = 'symbol';
      l.keys[0].shapes[0].symbolId = 'library';
    }
    if (mode === 'shared tangent')
      span.path = { startX: 1, startY: 1, endX: 1, endY: 1, tangent: true };
    if (mode === 'saved pivot') span.rotation!.savedGroupPivots = true;
    const before = structuredClone(p);
    expect(() => capture(() => ({ project: p, revision: 0 }), [binding()])).toThrow();
    expect(p).toEqual(before);
  });
it('later invalid group rejects the whole prepared bank and permits a fresh retry', () => {
  const p = fixture('plain', false, true),
    before = structuredClone(p);
  expect(() =>
    capture(() => ({ project: p, revision: 0 }), [binding(), binding('missing', 'later')]),
  ).toThrow();
  expect(p).toEqual(before);
  const s = setup(p);
  expect(s.scope.sample(4)).toHaveLength(2);
  s.scope.dispose();
});
for (const frame of [NaN, Infinity, -1, 0.5, 12])
  it(`rejects invalid frame ${frame} atomically`, () => {
    const s = setup();
    expect(() => s.scope.sample(frame)).toThrow();
    expect(() => s.scope.sample(4)).toThrow();
  });
it('ignores hidden-track output while preserving its captured bank', () => {
  const p = fixture('plain', false, true);
  p.layers[1].visible = false;
  const s = setup(p, [binding('outer', 'later')]);
  expect(s.scope.sample(4).map((t) => t.layerId)).toEqual(['track']);
  s.scope.dispose();
});
it('rejects late source edits during cloning and allows a fresh capture', () => {
  const p = fixture(),
    clone = structuredClone;
  let edits = 0;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const result = clone(value);
    if (!edits++ && value === p) p.symbols![0].name += ' changed';
    return result;
  });
  expect(() => capture(() => ({ project: p, revision: 0 }), [binding()])).toThrow(/source changed/);
  vi.unstubAllGlobals();
  const s = setup(p);
  expect(s.scope.sample(4)).toHaveLength(1);
  s.scope.dispose();
});
it('rejects a forged pose clone before all-track validation', () => {
  const s = setup(),
    clone = structuredClone;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v);
    const key = out as { frame?: number; shapes?: unknown[] };
    if (key.frame === 4 && key.shapes) key.shapes = [];
    return out;
  });
  expect(() => s.scope.sample(4)).toThrow(/clone changed|artwork changed/);
});

for (const kind of ['straight', 'curved', 'handles', 'distance'])
  it(`admits detached ${kind} waypoint banks with fixed compound artwork`, () => {
    const p = fixture('reflected', true);
    for (const key of p.layers[0].keys.slice(0, 2))
      Object.assign(key.shapes[0], {
        kind: 'polygon',
        fillRule: 'evenodd',
        points: [],
        contours: [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 10, y: 20 },
          ],
          [
            { x: 4, y: 4 },
            { x: 6, y: 4 },
            { x: 5, y: 6 },
          ],
        ],
      });
    const r = binding();
    r.path = {
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      waypoints: [{ x: 40, y: -50 }],
      ...(kind !== 'straight' ? { curvedWaypoints: true } : {}),
      ...(kind === 'handles'
        ? {
            waypointTangents: [
              { x: 5, y: 0 },
              { x: 10, y: 0 },
              { x: 5, y: 0 },
            ],
            waypointIncoming: [{ x: -10, y: 0 }],
          }
        : {}),
      ...(kind === 'distance' ? { distance: true } : {}),
    };
    const s = setup(p, [r]),
      base = captureLiveMotionTimeline(s.read),
      old = base.sample(4),
      now = s.scope.sample(4);
    expect(now[0].key.shapes[0].contours).toEqual(old[0].key.shapes[0].contours);
    if (kind !== 'distance') expect(now[0].key.shapes[0].y - old[0].key.shapes[0].y).toBe(-58);
    else expect(now[0].key.shapes[0].y).not.toBe(old[0].key.shapes[0].y);
    expect(now[0].key.shapes[2]).toEqual(old[0].key.shapes[2]);
    s.scope.dispose();
    base.dispose();
  });
it('uses geometry easing without changing independent opacity or paint channels', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].ease = 'in';
  const s = setup(p),
    old = captureLiveMotionTimeline(s.read),
    a = s.scope.sample(4),
    b = old.sample(4),
    t = 0.25;
  expect(a[0].key.shapes[0].x - b[0].key.shapes[0].x).toBeCloseTo(
    80 * (3 * t * t - 2 * t * t * t) - 80 * t,
    10,
  );
  expect(a[0].key.shapes[0].opacity).toBe(b[0].key.shapes[0].opacity);
  expect(a[0].key.shapes[0].fill).toEqual(b[0].key.shapes[0].fill);
  s.scope.dispose();
  old.dispose();
});
it('rejects overflow in later prepared routes without modifying any track', () => {
  const p = fixture('plain', false, true),
    before = structuredClone(p),
    a = binding(),
    b = binding('outer', 'later');
  b.path = {
    startX: Number.MAX_VALUE,
    startY: Number.MAX_VALUE,
    endX: Number.MAX_VALUE,
    endY: Number.MAX_VALUE,
    distance: true,
  };
  expect(() => capture(() => ({ project: p, revision: 0 }), [a, b])).toThrow();
  expect(p).toEqual(before);
});
it('poisons swallowed preparation reentry and permits a later fresh capture', () => {
  const p = fixture();
  let entered = false,
    armed = false;
  const read = () => {
    if (armed && !entered) {
      entered = true;
      try {
        capture(() => ({ project: p, revision: 0 }), [binding()]);
      } catch {
        /* Caller swallowing rejection cannot authorize the outer result. */
      }
    }
    return { project: p, revision: 0 };
  };
  const clone = structuredClone;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    armed = true;
    return clone(v);
  });
  expect(() => capture(read, [binding()])).toThrow();
  expect(entered).toBe(true);
  vi.unstubAllGlobals();
  const s = setup(p);
  expect(s.scope.sample(4)).toHaveLength(1);
  s.scope.dispose();
});
it('poisons swallowed sample reentry', () => {
  const p = fixture();
  let enter = false;
  const scope: ReturnType<typeof capture> = capture(() => {
    if (enter) {
      enter = false;
      try {
        scope.sample(4);
      } catch {
        /* Swallowed reentry is still stale. */
      }
    }
    return { project: p, revision: 0 };
  }, [binding()]);
  enter = true;
  expect(() => scope.sample(4)).toThrow();
  expect(() => scope.sample(4)).toThrow();
});
it('rejects actual source mutation after a detached independent member pose exists', () => {
  const s = setup(),
    clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      key = v as { frame?: number; shapes?: { y: number }[] };
    if (key.frame === 4 && key.shapes?.[0]?.y === -2) {
      fired = true;
      s.p.symbols![0].name += ' late';
    }
    return out;
  });
  expect(() => s.scope.sample(4)).toThrow(/source changed/);
  expect(fired).toBe(true);
  vi.unstubAllGlobals();
  const fresh = setup(s.p);
  expect(fresh.scope.sample(4)).toHaveLength(1);
  fresh.scope.dispose();
});

it('keeps the same original group routes separate across adjacent spans', () => {
  const p = fixture(),
    l = p.layers[0];
  l.keys[2].shapes = l.keys[1].shapes.map((s) => ({ ...structuredClone(s), x: s.x + 20 }));
  l.liveMotionSpans!.push({
    ...structuredClone(l.liveMotionSpans![0]),
    id: 'next',
    start: 8,
    end: 10,
  });
  const next = { ...binding(), spanId: 'next' };
  next.path.startY = next.path.endY = 20;
  const s = setup(p, [binding(), next]),
    old = captureLiveMotionTimeline(s.read);
  expect(s.scope.sample(4)[0].key.shapes[0].y - old.sample(4)[0].key.shapes[0].y).toBe(-30);
  expect(s.scope.sample(9)[0].key.shapes[0].y - old.sample(9)[0].key.shapes[0].y).toBe(15);
  expect(s.scope.sample(8)).toEqual(old.sample(8));
  s.scope.dispose();
  old.dispose();
});
it('rejects missing original path coordinates rather than materializing defaults', () => {
  const p = fixture(),
    r = binding();
  delete (r.path as Partial<typeof r.path>).startX;
  expect(() => capture(() => ({ project: p, revision: 0 }), [r])).toThrow(/own fields/);
});

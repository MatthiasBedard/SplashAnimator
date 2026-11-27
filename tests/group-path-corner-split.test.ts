import { afterEach, expect, it, vi } from 'vitest';
import {
  validateProject,
  migrateProject,
  type Project,
  type Layer,
} from '../packages/document/src';
import type { MotionEase } from '../packages/document/src/motion-ease';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import { splitLiveGroupMotionLayer as split } from '../packages/animation/src/live-group-motion-split';
import { createMotionFrameSampler, motionProgress } from '../packages/animation/src/motion-frames';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import {
  captureLiveGroupMotionAuthoringFrame as capture,
  prepareSplitLiveGroupMotionSpans as prepare,
} from '../packages/animation/src/live-group-motion-owner';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
afterEach(() => vi.unstubAllGlobals());
function fixture(basis = 'plain', groups = 'both', ease: MotionEase = 'linear') {
  const { p } = liveRotationFixture('rigid', basis, true),
    l = p.layers[0];
  l.keys[1].shapes = l.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 80,
    y: s.y + 16,
  }));
  const span = l.liveMotionSpans![0];
  span.ease = ease;
  span.path = {
    startX: 4,
    startY: 40,
    endX: -7,
    endY: 24,
    waypoints: [{ x: 30, y: 50 }],
    curvedWaypoints: false,
    distance: false,
  };
  span.groupPaths = (groups === 'both' ? ['outer', 'second'] : [groups]).map((groupId, i) => ({
    groupId,
    composition: 'additive',
    path: {
      startX: 13 + i * 7,
      startY: -40 + i * 5,
      endX: -9 + i * 2,
      endY: -12 - i * 3,
      distance: false,
      tangent: false,
    },
  }));
  return p;
}
function operation(p: Project, at = 4) {
  return split(p, p.layers[0], p.layers[0].liveMotionSpans![0], at, 'right');
}
function equivalent(p: Project, l: Layer) {
  const span = p.layers[0].liveMotionSpans![0],
    q = { ...p, layers: [l] },
    source = createMotionFrameSampler(p, l.id, span),
    plans = l.liveMotionSpans!.map((s) => createMotionFrameSampler(q, l.id, s));
  try {
    for (let f = 0; f <= 8; f++) {
      const s = l.liveMotionSpans!.findIndex((s) => s.start <= f && f <= s.end),
        actual = plans[s].sample(f),
        prior = source.sample(f),
        t = motionProgress(f / 8, span.ease),
        w = span.path!.waypoints![0];
      expect(sameMotionArtwork(prior, actual), `frame ${f}`).toBe(true);
      for (let i = 0; i < actual.length; i++) {
        const a = p.layers[0].keys[0].shapes[i],
          b = p.layers[0].keys[1].shapes[i],
          dx = b.x - a.x,
          dy = b.y - a.y,
          bank = span.groupPaths?.find((v) => v.groupId === a.groups?.[0])?.path;
        const shared = {
          x: t <= 0.5 ? w.x * 2 * t : w.x + (dx - w.x) * (2 * t - 1),
          y: t <= 0.5 ? w.y * 2 * t : w.y + (dy - w.y) * (2 * t - 1),
        };
        const u = 1 - t,
          independent = bank
            ? {
                x:
                  3 * u * u * t * bank.startX +
                  3 * u * t * t * (dx + bank.endX) +
                  t * t * t * dx -
                  dx * t,
                y:
                  3 * u * u * t * bank.startY +
                  3 * u * t * t * (dy + bank.endY) +
                  t * t * t * dy -
                  dy * t,
              }
            : { x: 0, y: 0 };
        const expected = {
          ...a,
          x: a.x + shared.x + independent.x,
          y: a.y + shared.y + independent.y,
        };
        const x = mapPoint(matrix(actual[i]), { x: 3, y: 4 }),
          y = mapPoint(matrix(expected), { x: 3, y: 4 });
        expect(x.x).toBeCloseTo(y.x, 7);
        expect(x.y).toBeCloseTo(y.y, 7);
      }
    }
  } finally {
    source.dispose();
    plans.forEach((s) => s.dispose());
  }
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of ['outer', 'second', 'both'])
    for (const ease of ['linear', 'in-out'] as const)
      it(`restricts one shared straight corner with ${basis}/${group}/${ease} bank controls and independent world oracles`, () => {
        const p = fixture(basis, group, ease),
          before = structuredClone(p),
          l = operation(p);
        equivalent(p, l);
        expect(p).toEqual(before);
        expect(l.keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
        expect(l.keys[0]).toEqual(before.layers[0].keys[0]);
        expect(l.keys[2]).toEqual(before.layers[0].keys[1]);
        expect(l.keys[3]).toEqual(before.layers[0].keys[2]);
        for (const s of l.liveMotionSpans!) {
          expect(s.path?.waypoints).toBeUndefined();
          expect(s.groupPaths!.map((b) => b.groupId)).toEqual(
            before.layers[0].liveMotionSpans![0].groupPaths!.map((b) => b.groupId),
          );
          for (const b of s.groupPaths!) {
            expect(b.path.waypoints).toBeUndefined();
            expect(b.path.distance).toBe(false);
            expect(b.path.tangent).toBe(false);
          }
          expect(s.options).toEqual(before.layers[0].liveMotionSpans![0].options);
        }
      });
for (const at of [2, 6])
  it(`restricts exact geometry midpoint with unequal time interval at ${at}`, () => {
    const ease: MotionEase = {
        kind: 'cubic',
        x1: at === 2 ? 0 : 2 / 3,
        y1: 0,
        x2: at === 2 ? 1 / 3 : 1,
        y2: 1,
      },
      p = fixture('reflected', 'both', ease);
    expect(motionProgress(at / 8, ease)).toBe(0.5);
    const l = operation(p, at);
    equivalent(p, l);
    expect(l.liveMotionSpans!.map((s) => [s.start, s.end])).toEqual([
      [0, at],
      [at, 8],
    ]);
  });
it('repeated cubic restriction and JSON reopening retain the original corner trajectory', () => {
  const p = fixture(),
    first = operation(p);
  let q = migrateProject(JSON.parse(JSON.stringify({ ...p, layers: [first] })));
  for (const at of [2, 6]) {
    const span = q.layers[0].liveMotionSpans!.find((s) => s.start < at && s.end > at)!;
    q = { ...q, layers: [split(q, q.layers[0], span, at, `part${at}`)] };
  }
  validateProject(q);
  equivalent(p, q.layers[0]);
  expect(q.layers[0].liveMotionSpans!.map((s) => [s.start, s.end])).toEqual([
    [0, 2],
    [2, 4],
    [4, 6],
    [6, 8],
  ]);
});
for (const all of [false, true])
  it(`retains distinct banked leader travel with all-banked reference ${all}`, () => {
    const p = fixture();
    for (const s of p.layers[0].keys[1].shapes)
      if (s.groups?.[0] === 'second') {
        s.x += 40;
        s.y -= 20;
      }
    if (all) for (const k of p.layers[0].keys) k.shapes = k.shapes.filter((s) => s.id !== 'loose');
    const l = operation(p);
    equivalent(p, l);
  });
for (const origin of [-99000, 99000])
  it(`keeps relative corner/bank geometry at document origin ${origin}`, () => {
    const p = fixture('reflected');
    for (const k of p.layers[0].keys)
      for (const s of k.shapes) {
        s.x += origin;
        s.y += origin;
      }
    equivalent(p, operation(p));
  });
it('preserves compound topology, absent pivots and independent paint/opacity channels', () => {
  const p = fixture('affine'),
    span = p.layers[0].liveMotionSpans![0];
  span.opacityEase = 'out';
  span.paintEase = 'in';
  for (const [i, k] of p.layers[0].keys.slice(0, 2).entries()) {
    const a = k.shapes[0];
    Object.assign(a, {
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
          { x: 6, y: 6 },
          { x: 4, y: 6 },
        ],
      ],
      fill: i ? '#808080' : '#000000',
      opacity: i ? 0.9 : 0.3,
    });
    delete a.pivot;
  }
  const l = operation(p);
  equivalent(p, l);
  expect(l.keys[1].shapes[0].contours).toEqual(p.layers[0].keys[0].shapes[0].contours);
  expect(l.keys[1].shapes[0].pivot).toBeUndefined();
});
for (const mode of ['curved', 'shared-distance', 'bank-distance', 'bank-waypoint'] as const)
  it(`retains conservative ${mode} restriction rejection and valid source playback`, () => {
    const p = fixture(),
      span = p.layers[0].liveMotionSpans![0];
    const at = 4;
    if (mode === 'curved') span.path!.curvedWaypoints = true;
    if (mode === 'shared-distance') span.path!.distance = true;
    if (mode === 'bank-distance') span.groupPaths![1].path.distance = true;
    if (mode === 'bank-waypoint') span.groupPaths![1].path.waypoints = [{ x: 30, y: 20 }];
    const before = structuredClone(p);
    expect(() => operation(p, at)).toThrow(/parametric cubic/);
    expect(p).toEqual(before);
    const sampler = createMotionFrameSampler(p, 'track', span);
    expect(sampler.sample(4)).toHaveLength(5);
    sampler.dispose();
  });
it('prepares detached all-track original corner owners while public membership hints remain detached', () => {
  const p = fixture(),
    before = structuredClone(p),
    other = secondRotationTrack(p);
  const scope = capture(() => ({ project: p, frame: 4, revision: 0 }));
  const scene = scope.scene;
  scene[0].key.shapes[0].x = 999;
  const requests = ['track', other.id].map((id) => ({
    owner: scope.resolve(id, 'outer'),
    rightSpanId: 'right',
  }));
  const q = prepare(requests);
  expect(p.layers[0]).toEqual(before.layers[0]);
  expect(q.layers[0]).not.toBe(p.layers[0]);
  equivalent(p, q.layers[0]);
  expect(q.layers[1].liveMotionSpans).toHaveLength(2);
  scope.dispose();
});
it('rejects a later unsupported track atomically after an admitted corner request', () => {
  const p = fixture(),
    other = secondRotationTrack(p);
  other.liveMotionSpans![0].path!.distance = true;
  const before = structuredClone(p),
    scope = capture(() => ({ project: p, frame: 4, revision: 0 }));
  expect(() =>
    prepare(
      ['track', other.id].map((id) => ({
        owner: scope.resolve(id, 'outer'),
        rightSpanId: 'right',
      })),
    ),
  ).toThrow(/parametric cubic/);
  expect(p).toEqual(before);
  scope.dispose();
});
it('rejects original source changes during complete edited corner candidate cloning', () => {
  const p = fixture(),
    scope = capture(() => ({ project: p, frame: 4, revision: 0 })),
    owner = scope.resolve('track', 'outer'),
    clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      l = v as Layer;
    if (!fired && l?.liveMotionSpans?.length === 2 && l.keys?.some((k) => k.frame === 4)) {
      fired = true;
      p.layers[0].name = 'Separate source';
    }
    return out;
  });
  expect(() => prepare([{ owner, rightSpanId: 'right' }])).toThrow(/source|changed|stale/i);
  expect(fired).toBe(true);
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  scope.dispose();
});

it('retains exact-pose rejection for channel values whose quantization changes under restriction', () => {
  const p = fixture(),
    span = p.layers[0].liveMotionSpans![0];
  span.paintEase = 'in';
  p.layers[0].keys[0].shapes[0].fill = '#ff0000';
  p.layers[0].keys[1].shapes[0].fill = '#0000ff';
  const before = structuredClone(p);
  expect(() => operation(p)).toThrow(/integer poses/);
  expect(p).toEqual(before);
});
it('rejects a forged detached restricted corner bank before returning an all-track candidate', () => {
  const p = fixture(),
    before = structuredClone(p),
    scope = capture(() => ({ project: p, frame: 4, revision: 0 })),
    owner = scope.resolve('track', 'outer'),
    clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      l = out as Layer;
    if (!fired && l?.liveMotionSpans?.length === 2 && l.keys?.some((k) => k.frame === 4)) {
      fired = true;
      l.liveMotionSpans[0].groupPaths![0].path.startX += 3;
    }
    return out;
  });
  expect(() => prepare([{ owner, rightSpanId: 'right' }])).toThrow(/clone|changed/i);
  expect(fired).toBe(true);
  expect(p).toEqual(before);
  scope.dispose();
});
for (const numeric of [NaN, Infinity])
  it(`rejects raw corner ${numeric} without publishing a promoted key`, () => {
    const p = fixture();
    p.layers[0].liveMotionSpans![0].path!.waypoints![0].x = numeric;
    expect(() => operation(p)).toThrow();
    expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  });
it('rejects original corner point getters without evaluating them', () => {
  const p = fixture(),
    getter = vi.fn(() => 30);
  Object.defineProperty(p.layers[0].liveMotionSpans![0].path!.waypoints![0], 'x', {
    get: getter,
    enumerable: true,
  });
  expect(() => operation(p)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
});

for (const waypoint of [
  { x: 0, y: 0 },
  { x: 80, y: 16 },
])
  it(`retains stationary shared half at corner ${waypoint.x}/${waypoint.y}`, () => {
    const p = fixture();
    p.layers[0].liveMotionSpans![0].path!.waypoints = [waypoint];
    equivalent(p, operation(p));
  });
it('preserves stationary authored endpoint excursions through both independent groups', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes = structuredClone(p.layers[0].keys[0].shapes);
  equivalent(p, operation(p));
});
it('retains exact legacy no-bank splitting without materializing independent routes', () => {
  const p = fixture();
  delete p.layers[0].liveMotionSpans![0].groupPaths;
  const l = operation(p);
  equivalent(p, l);
  for (const s of l.liveMotionSpans!) expect(Object.hasOwn(s, 'groupPaths')).toBe(false);
});

import { afterEach, expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  validateProject,
  migrateProject,
  type Project,
  type Layer,
} from '../packages/document/src';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import { splitLiveGroupMotionLayer as split } from '../packages/animation/src/live-group-motion-split';
import { createMotionFrameSampler, motionProgress } from '../packages/animation/src/motion-frames';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import {
  captureLiveGroupMotionAuthoringFrame as capture,
  prepareSplitLiveGroupMotionSpans as prepare,
} from '../packages/animation/src/live-group-motion-owner';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(count = 2, basis = 'plain', ease: 'linear' | 'in-out' = 'linear') {
  const { p } = liveRotationFixture('rigid', basis, true),
    l = p.layers[0];
  p.duration = 20;
  l.keys[1] = {
    frame: 16,
    shapes: l.keys[0].shapes.map((s) => ({ ...structuredClone(s), x: s.x + 80, y: s.y + 16 })),
  };
  l.keys[2].frame = 18;
  const s = l.liveMotionSpans![0];
  s.end = 16;
  s.ease = ease;
  s.path = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    waypoints: Array.from({ length: count - 1 }, (_, i) => ({
      x: (i + 1) * 17,
      y: i % 2 ? -24 : 32,
    })),
    curvedWaypoints: false,
    distance: false,
  };
  s.groupPaths = ['outer', 'second'].map((groupId, i) => ({
    groupId,
    composition: 'additive',
    path: {
      startX: 12 + i * 6,
      startY: -36 + i * 4,
      endX: -12 + i * 3,
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
  const sourceSpan = p.layers[0].liveMotionSpans![0],
    source = createMotionFrameSampler(p, l.id, sourceSpan),
    q = { ...p, layers: [l] },
    plans = l.liveMotionSpans!.map((s) => createMotionFrameSampler(q, l.id, s));
  try {
    for (let frame = 0; frame <= 16; frame++) {
      const t = motionProgress(frame / 16, sourceSpan.ease),
        sample = source.sample(frame),
        index = l.liveMotionSpans!.findIndex((s) => s.start <= frame && frame <= s.end),
        actual = plans[index].sample(frame);
      expect(sameMotionArtwork(sample, actual), `frame ${frame}`).toBe(true);
      for (let i = 0; i < actual.length; i++) {
        const a = p.layers[0].keys[0].shapes[i],
          b = p.layers[0].keys[1].shapes[i],
          delta = { x: b.x - a.x, y: b.y - a.y },
          points = [{ x: 0, y: 0 }, ...sourceSpan.path!.waypoints!, delta],
          count = points.length - 1,
          segment = Math.min(count - 1, Math.floor(t * count)),
          u = t * count - segment,
          v = 1 - t,
          from = points[segment],
          to = points[segment + 1],
          bank = sourceSpan.groupPaths!.find((x) => x.groupId === a.groups?.[0])?.path;
        const offset = bank
          ? {
              x:
                3 * v * v * t * bank.startX +
                3 * v * t * t * (delta.x + bank.endX) +
                t * t * t * delta.x -
                delta.x * t,
              y:
                3 * v * v * t * bank.startY +
                3 * v * t * t * (delta.y + bank.endY) +
                t * t * t * delta.y -
                delta.y * t,
            }
          : { x: 0, y: 0 };
        const expected = {
          ...a,
          x: a.x + from.x * (1 - u) + to.x * u + offset.x,
          y: a.y + from.y * (1 - u) + to.y * u + offset.y,
        };
        const x = mapPoint(matrix(actual[i]), { x: 3, y: 4 }),
          y = mapPoint(matrix(expected), { x: 3, y: 4 });
        expect(x.x).toBeCloseTo(y.x, 7);
        expect(x.y).toBeCloseTo(y.y, 7);
      }
    }
  } finally {
    source.dispose();
    plans.forEach((p) => p.dispose());
  }
}
for (const count of [2, 3, 4])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const at of [4, 6, 10, 12])
      it(`restricts ${count}-piece shared source/${basis} at ${at} with independent world-point oracles`, () => {
        const p = fixture(count, basis),
          before = structuredClone(p),
          l = operation(p, at);
        equivalent(p, l);
        expect(p).toEqual(before);
        expect(l.keys[0]).toEqual(before.layers[0].keys[0]);
        expect(l.keys[2]).toEqual(before.layers[0].keys[1]);
        expect(l.keys[3]).toEqual(before.layers[0].keys[2]);
        for (const s of l.liveMotionSpans!) {
          expect(s.options).toEqual(before.layers[0].liveMotionSpans![0].options);
          for (const bank of s.groupPaths!) {
            expect(bank.path.distance).toBe(false);
            expect(bank.path.tangent).toBe(false);
          }
        }
      });
for (const count of [2, 3, 4])
  it(`restricts original geometry progress with in-out easing/${count} shared pieces`, () => {
    const p = fixture(count, 'reflected', 'in-out');
    equivalent(p, operation(p, 8));
  });
it('recursively restricts generated explicit partitions after JSON reopening', () => {
  const p = fixture(2);
  for (const key of p.layers[0].keys.slice(0, 2))
    for (const group of ['outer', 'second']) {
      const members = key.shapes.filter((s) => s.groups?.[0] === group);
      members[1].x = members[0].x;
      members[1].y = members[0].y;
    }
  const first = operation(p, 4);
  let q = migrateProject(JSON.parse(JSON.stringify({ ...p, layers: [first] })));
  for (const at of [2, 8, 12]) {
    const s = q.layers[0].liveMotionSpans!.find((s) => s.start < at && s.end > at)!;
    q = { ...q, layers: [split(q, q.layers[0], s, at, `part${at}`)] };
    validateProject(q);
    equivalent(p, q.layers[0]);
  }
  expect(q.layers[0].liveMotionSpans!.map((s) => [s.start, s.end])).toEqual([
    [0, 2],
    [2, 4],
    [4, 8],
    [8, 12],
    [12, 16],
  ]);
});
for (const all of [false, true])
  it(`retains distinct leader/reference travel with all-banked source ${all}`, () => {
    const p = fixture(3);
    for (const s of p.layers[0].keys[1].shapes)
      if (s.groups?.[0] === 'second') {
        s.x += 40;
        s.y -= 20;
      }
    if (all) for (const k of p.layers[0].keys) k.shapes = k.shapes.filter((s) => s.id !== 'loose');
    equivalent(p, operation(p));
  });
for (const origin of [-99000, 99000])
  it(`retains relative geometry at origin ${origin}`, () => {
    const p = fixture(3, 'reflected');
    for (const k of p.layers[0].keys)
      for (const s of k.shapes) {
        s.x += origin;
        s.y += origin;
      }
    equivalent(p, operation(p));
  });
it('preserves complete compound topology and separate channels without new options', () => {
  const p = fixture(),
    s = p.layers[0].liveMotionSpans![0];
  s.opacityEase = 'out';
  s.paintEase = 'linear';
  for (const [i, k] of p.layers[0].keys.slice(0, 2).entries()) {
    Object.assign(k.shapes[0], {
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
    delete k.shapes[0].pivot;
  }
  const l = operation(p);
  equivalent(p, l);
  expect(l.keys[1].shapes[0].contours).toEqual(p.layers[0].keys[0].shapes[0].contours);
  expect(l.keys[1].shapes[0].pivot).toBeUndefined();
});
it('prepares detached all-track candidates from original owners and rejects later unsupported tracks atomically', () => {
  const p = fixture(3),
    later = secondRotationTrack(p),
    before = structuredClone(p),
    scope = capture(() => ({ project: p, frame: 4, revision: 0 })),
    requests = ['track', later.id].map((id) => ({
      owner: scope.resolve(id, 'outer'),
      rightSpanId: 'right',
    })),
    q = prepare(requests);
  expect(p).toEqual(before);
  equivalent(p, q.layers[0]);
  expect(q.layers[1].liveMotionSpans).toHaveLength(2);
  scope.dispose();
  later.liveMotionSpans![0].path!.distance = true;
  const next = structuredClone(p),
    rejected = capture(() => ({ project: p, frame: 4, revision: 0 }));
  expect(() =>
    prepare(
      ['track', later.id].map((id) => ({
        owner: rejected.resolve(id, 'outer'),
        rightSpanId: 'right',
      })),
    ),
  ).toThrow(/parametric/);
  expect(p).toEqual(next);
  rejected.dispose();
});
for (const kind of [
  'implicit-shared',
  'distance-shared',
  'distance-bank',
  'straight-bank',
  'implicit-bank',
  'mismatch',
] as const)
  it(`retains unqualified ${kind} rejection without source writes`, () => {
    const p = fixture(3),
      s = p.layers[0].liveMotionSpans![0];
    if (kind === 'implicit-shared') s.path!.curvedWaypoints = true;
    if (kind === 'distance-shared') s.path!.distance = true;
    if (kind === 'distance-bank') s.groupPaths![0].path.distance = true;
    if (kind === 'straight-bank' || kind === 'implicit-bank')
      s.groupPaths![0].path.waypoints = [{ x: 30, y: 10 }];
    if (kind === 'implicit-bank') s.groupPaths![0].path.curvedWaypoints = true;
    if (kind === 'mismatch')
      Object.assign(s.groupPaths![0].path, {
        curvedWaypoints: true,
        waypoints: [{ x: 30, y: 10 }],
        waypointTangents: [
          { x: 10, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 0 },
        ],
        waypointIncoming: [{ x: -10, y: 0 }],
      });
    const before = structuredClone(p);
    expect(() => operation(p)).toThrow();
    expect(p).toEqual(before);
  });

it('retains exact member-displacement rejection for unresolved nonbinary promoted group positions', () => {
  const p = fixture(3);
  p.layers[0].liveMotionSpans![0].path!.waypoints = [
    { x: 80 / 3, y: 32 },
    { x: 160 / 3, y: -24 },
  ];
  const before = structuredClone(p);
  expect(() => operation(p, 6)).toThrow(/equal member displacement/);
  expect(p).toEqual(before);
});
it('retains conservative rejection when a recursive promoted translation is not exactly shared by all members', () => {
  const p = fixture(2),
    l = operation(p),
    q = { ...p, layers: [l] },
    before = structuredClone(q);
  expect(() => split(q, l, l.liveMotionSpans![0], 2, 'next')).toThrow(/equal member displacement/);
  expect(q).toEqual(before);
  equivalent(p, l);
});
it('retains the existing nonmidpoint in-out easing guard without approximating time', () => {
  const p = fixture(3, 'plain', 'in-out'),
    before = structuredClone(p);
  expect(() => operation(p, 6)).toThrow(/Preserved splits support/);
  expect(p).toEqual(before);
});

for (const action of ['source', 'library', 'reentry', 'input-clone', 'output-clone'] as const)
  it(`rejects actual ${action} during detached piecewise preparation with source-valid recovery`, () => {
    const p = fixture(3),
      scope = capture(() => ({ project: p, frame: 4, revision: 0 })),
      requests = [{ owner: scope.resolve('track', 'outer'), rightSpanId: 'right' }],
      clone = structuredClone;
    let fired = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value),
        data = value as { bank?: unknown; sharedHalves?: unknown },
        project = value as Project;
      const hit =
        action === 'output-clone'
          ? project?.layers?.[0]?.liveMotionSpans?.length === 2 &&
            project.layers[0].keys.some((k) => k.frame === 4)
          : data?.bank && data?.sharedHalves;
      if (!fired && hit) {
        fired = true;
        if (action === 'source') p.layers[0].name = 'Separate source';
        if (action === 'library') p.symbols![0].name = 'Separate library';
        if (action === 'reentry')
          try {
            prepare(requests);
          } catch {
            /* Outer preparation must retain the swallowed reentry. */
          }
        if (action === 'input-clone') (out as { bank: { startX: number } }).bank.startX++;
        if (action === 'output-clone')
          (out as Project).layers[0].liveMotionSpans![0].groupPaths![0].path.waypointTangents![0]
            .x++;
      }
      return out;
    });
    expect(() => prepare(requests)).toThrow();
    expect(fired).toBe(true);
    expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 16, 18]);
    if (action === 'source' || action === 'library') scope.dispose();
    else {
      const q = prepare(requests);
      expect(q.layers[0].liveMotionSpans).toHaveLength(2);
      equivalent(p, q.layers[0]);
      scope.dispose();
    }
  });
for (const numeric of [NaN, Infinity])
  it(`rejects original waypoint ${numeric} atomically`, () => {
    const p = fixture(3);
    p.layers[0].liveMotionSpans![0].path!.waypoints![0].x = numeric;
    expect(() => operation(p)).toThrow();
    expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 16, 18]);
  });
it('retains original waypoint getter zero-read rejection', () => {
  const p = fixture(3),
    getter = vi.fn(() => 17);
  Object.defineProperty(p.layers[0].liveMotionSpans![0].path!.waypoints![0], 'x', {
    get: getter,
    enumerable: true,
  });
  expect(() => operation(p)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 16, 18]);
});
it('retains the original unresolved equal-time refinement budget and exact source keys', () => {
  const p = fixture(2);
  p.duration = 518;
  p.layers[0].keys[1].frame = 514;
  p.layers[0].keys[2].frame = 516;
  p.layers[0].liveMotionSpans![0].end = 514;
  const before = structuredClone(p);
  expect(() => operation(p, 2)).toThrow(/subdivision budget/);
  expect(p).toEqual(before);
});
it('admits the existing aggregate library artwork capacity and rejects original overflow', () => {
  const p = fixture(3),
    art = { ...p.symbols![0].shapes[0] };
  delete art.transform;
  delete art.pivot;
  delete art.opacity;
  p.symbols![0].shapes = Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
    ...art,
    id: `capacity${i}`,
    points: [],
  }));
  const scope = capture(() => ({ project: p, frame: 4, revision: 0 })),
    q = prepare([{ owner: scope.resolve('track', 'outer'), rightSpanId: 'right' }]);
  expect(q.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  expect(p.layers[0].keys).toHaveLength(3);
  scope.dispose();
  p.symbols![0].shapes.push({ ...art, id: 'overflow' });
  expect(() => capture(() => ({ project: p, frame: 4, revision: 0 }))).toThrow(/budget/);
}, 120000);

it('retains unrelated explicit shared-curve plus cubic-bank rejection while playback stays valid', () => {
  const p = fixture(3),
    s = p.layers[0].liveMotionSpans![0];
  Object.assign(s.path!, {
    curvedWaypoints: true,
    waypointTangents: [
      { x: 10, y: 20 },
      { x: 10, y: -20 },
      { x: 10, y: 20 },
      { x: 10, y: 0 },
    ],
    waypointIncoming: [
      { x: -10, y: 0 },
      { x: -10, y: 0 },
    ],
  });
  const before = structuredClone(p);
  expect(() => operation(p)).toThrow(/matching explicit/);
  expect(p).toEqual(before);
  const sampler = createMotionFrameSampler(p, 'track', s);
  expect(sampler.sample(4)).toHaveLength(5);
  sampler.dispose();
});

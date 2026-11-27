import { afterEach, expect, it, vi } from 'vitest';
import { MAX_SYMBOL_ARTWORK, validateProject, type Project } from '../packages/document/src';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import {
  captureLiveIndependentGroupCubicControls as capture,
  prepareLiveIndependentGroupCubicControlPositions as prepare,
} from '../packages/animation/src/live-independent-group-cubic-controls';
import {
  captureLiveGroupCubicControls as sharedCapture,
  prepareLiveGroupCubicControlPositions as sharedPrepare,
} from '../packages/animation/src/live-group-cubic-controls';
afterEach(() => vi.unstubAllGlobals());
function fixture(basis = 'plain', shared = true) {
  const { p } = liveRotationFixture('rigid', basis, true),
    l = p.layers[0];
  l.keys[1].shapes = l.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 80,
    y: s.y + 16,
  }));
  const span = l.liveMotionSpans![0];
  if (shared) span.path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  span.groupPaths = [
    {
      groupId: 'outer',
      composition: 'additive',
      path: { startX: 10, startY: 20, endX: -10, endY: 30, distance: false },
    },
    {
      groupId: 'second',
      composition: 'additive',
      path: { startX: -6, startY: -12, endX: 18, endY: 9 },
    },
  ];
  return p;
}
function operation(p = fixture(), group = 'outer', role: 'start' | 'end' = 'start') {
  const scope = capture(() => ({ project: p, revision: 7, frame: 4 })),
    owner = scope.resolve('track', 'live', group, role);
  return { p, scope, owner, target: { x: owner.point.x + 10, y: owner.point.y + 10 } };
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const shared of [false, true])
    for (const group of ['outer', 'second'])
      for (const role of ['start', 'end'] as const)
        it(`owns only independent ${group}/${role}/${basis}/shared${shared} controls`, () => {
          const p = fixture(basis, shared),
            before = structuredClone(p),
            s = operation(p, group, role),
            q = prepare([{ owner: s.owner, target: s.target }]);
          validateProject(q);
          const expected = structuredClone(p),
            path = expected.layers[0].liveMotionSpans![0].groupPaths!.find(
              (v) => v.groupId === group,
            )!.path;
          if (role === 'start') {
            path.startX += 10;
            path.startY += 10;
          } else {
            path.endX += 10;
            path.endY += 10;
          }
          expect(q).toEqual(expected);
          expect(p).toEqual(before);
          expect(s.owner.groupShapeIds).toEqual(group === 'outer' ? ['a', 'b'] : ['c', 'd']);
          expect(s.owner.shapeIds).toEqual(['a', 'b', 'c', 'd', 'loose']);
          expect(Object.isFrozen(s.owner)).toBe(true);
          expect(Object.isFrozen(s.owner.point)).toBe(true);
          const a = createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0]),
            b = createMotionFrameSampler(q, 'track', q.layers[0].liveMotionSpans![0]);
          for (let f = 0; f <= 8; f++) {
            const x = a.sample(f),
              y = b.sample(f),
              t = f / 8,
              d = 30 * (role === 'start' ? (1 - t) ** 2 * t : (1 - t) * t * t);
            for (let i = 0; i < x.length; i++)
              if (x[i].groups?.[0] === group) {
                expect(y[i].x).toBeCloseTo(x[i].x + d, 9);
                expect(y[i].y).toBeCloseTo(x[i].y + d, 9);
                expect({ ...y[i], x: x[i].x, y: x[i].y }).toEqual(x[i]);
              } else expect(y[i]).toEqual(x[i]);
          }
          a.dispose();
          b.dispose();
          s.scope.dispose();
        });
it('combines distinct original groups into one atomic bank update', () => {
  const p = fixture(),
    scope = capture(() => ({ project: p, revision: 0, frame: 4 })),
    a = scope.resolve('track', 'live', 'outer', 'start'),
    b = scope.resolve('track', 'live', 'second', 'end'),
    before = structuredClone(p);
  const q = prepare([
    { owner: a, target: { x: a.point.x + 10, y: a.point.y } },
    { owner: b, target: { x: b.point.x, y: b.point.y - 12 } },
  ]);
  const expected = structuredClone(p);
  expected.layers[0].liveMotionSpans![0].groupPaths![0].path.startX += 10;
  expected.layers[0].liveMotionSpans![0].groupPaths![1].path.endY -= 12;
  expect(q).toEqual(expected);
  expect(p).toEqual(before);
  scope.dispose();
});
it('prepares multiple tracks without changing authored keys, library or shared routes', () => {
  const p = fixture();
  secondRotationTrack(p);
  const before = structuredClone(p),
    scope = capture(() => ({ project: p, revision: 0, frame: 4 })),
    rows = ['track', 'later'].map((id) => {
      const owner = scope.resolve(id, 'live', 'outer', 'end');
      return { owner, target: { x: owner.point.x + 5, y: owner.point.y + 6 } };
    });
  const q = prepare(rows);
  for (let i = 0; i < 2; i++) {
    expect(q.layers[i].keys).toEqual(p.layers[i].keys);
    expect(q.layers[i].liveMotionSpans![0].path).toEqual(p.layers[i].liveMotionSpans![0].path);
  }
  expect(q.symbols).toEqual(p.symbols);
  expect(p).toEqual(before);
  scope.dispose();
});
it('public hints, proposed controls and returned candidates never own original picks', () => {
  const s = operation(),
    hints = s.scope.choices;
  hints[0].point.x = 900;
  expect(s.scope.resolve('track', 'live', 'outer', 'start').point).toEqual(s.owner.point);
  expect(() => prepare([{ owner: { ...s.owner }, target: s.target }])).toThrow(/private/);
  const q = prepare([{ owner: s.owner, target: s.target }]);
  q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 500;
  expect(s.p.layers[0].liveMotionSpans![0].groupPaths![0].path.startX).toBe(10);
  s.scope.dispose();
});
it('keeps shared and independent weak ownership brands separate', () => {
  const p = fixture(),
    s = operation(p),
    shared = sharedCapture(() => ({ project: p, revision: 7, frame: 4 })),
    owner = shared.resolve('track', 'live', 'outer', 'start');
  expect(() => prepare([{ owner, target: s.target }])).toThrow();
  expect(() => sharedPrepare([{ owner: s.owner, target: s.target }])).toThrow();
  shared.dispose();
  s.scope.dispose();
});
for (const mode of [
  'NaN',
  'Infinity',
  'getter',
  'prototype',
  'hidden',
  'missing',
  'extra',
  'no-op',
])
  it(`rejects raw ${mode} targets without source writes or getter reads`, () => {
    const s = operation(),
      before = structuredClone(s.p),
      target = { ...s.target };
    let reads = 0;
    if (mode === 'NaN') target.x = NaN;
    if (mode === 'Infinity') target.y = Infinity;
    if (mode === 'getter')
      Object.defineProperty(target, 'x', {
        enumerable: true,
        get() {
          reads++;
          return 40;
        },
      });
    if (mode === 'prototype') Object.setPrototypeOf(target, { x: 40 });
    if (mode === 'hidden') Object.defineProperty(target, 'x', { value: 40, enumerable: false });
    if (mode === 'missing') delete (target as Partial<typeof target>).y;
    if (mode === 'extra') Object.assign(target, { pressure: 1 });
    if (mode === 'no-op') Object.assign(target, s.owner.point);
    expect(() => prepare([{ owner: s.owner, target }])).toThrow();
    expect(reads).toBe(0);
    expect(s.p).toEqual(before);
    s.scope.dispose();
  });
for (const mode of ['source', 'library', 'revision', 'frame', 'dispose'])
  it(`rejects stale ${mode} ownership`, () => {
    const p = fixture();
    let revision = 0,
      frame = 4;
    const scope = capture(() => ({ project: p, revision, frame })),
      owner = scope.resolve('track', 'live', 'outer', 'start');
    if (mode === 'source') p.layers[0].keys[0].shapes[0].x++;
    if (mode === 'library') p.symbols![0].name += ' changed';
    if (mode === 'revision') revision++;
    if (mode === 'frame') frame++;
    if (mode === 'dispose') scope.dispose();
    expect(() =>
      prepare([{ owner, target: { x: owner.point.x + 1, y: owner.point.y } }]),
    ).toThrow();
    scope.dispose();
  });
for (const mode of ['missing bank', 'waypoints', 'locked', 'hidden', 'inner'])
  it(`does not offer an original control for ${mode}`, () => {
    const p = fixture();
    if (mode === 'missing bank') delete p.layers[0].liveMotionSpans![0].groupPaths;
    if (mode === 'waypoints')
      p.layers[0].liveMotionSpans![0].groupPaths![0].path.waypoints = [{ x: 40, y: 30 }];
    if (mode === 'locked') p.layers[0].locked = true;
    if (mode === 'hidden') p.layers[0].visible = false;
    const scope = capture(() => ({ project: p, revision: 0, frame: 4 }));
    expect(() =>
      scope.resolve('track', 'live', mode === 'inner' ? 'inner' : 'outer', 'start'),
    ).toThrow();
    scope.dispose();
  });
it('allows independent distance cubics and shared curved waypoint playback without changing their settings', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].groupPaths![0].path.distance = true;
  p.layers[0].liveMotionSpans![0].path = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    waypoints: [{ x: 40, y: 30 }],
    curvedWaypoints: true,
    distance: true,
  };
  const s = operation(p),
    q = prepare([{ owner: s.owner, target: s.target }]);
  expect(q.layers[0].liveMotionSpans![0].groupPaths![0].path.distance).toBe(true);
  expect(q.layers[0].liveMotionSpans![0].path).toEqual(p.layers[0].liveMotionSpans![0].path);
  expect(q.layers[0].keys).toEqual(p.layers[0].keys);
  s.scope.dispose();
});
it('rejects duplicate controls for one bank before any writes', () => {
  const s = operation(),
    end = s.scope.resolve('track', 'live', 'outer', 'end'),
    before = structuredClone(s.p);
  expect(() =>
    prepare([
      { owner: s.owner, target: s.target },
      { owner: end, target: { x: end.point.x + 1, y: end.point.y } },
    ]),
  ).toThrow(/once/);
  expect(s.p).toEqual(before);
  s.scope.dispose();
});
it('rejects crossed capture scopes', () => {
  const p = fixture(),
    a = operation(p),
    b = operation(p, 'second');
  expect(() =>
    prepare([
      { owner: a.owner, target: a.target },
      { owner: b.owner, target: b.target },
    ]),
  ).toThrow(/scope/);
  a.scope.dispose();
  b.scope.dispose();
});
it('poisons swallowed preparation reentry and permits a fresh retry', () => {
  const s = operation(),
    rows = [{ owner: s.owner, target: s.target }];
  let entered = false;
  expect(() =>
    prepare(rows, {
      validate() {
        if (!entered) {
          entered = true;
          try {
            prepare(rows);
          } catch {
            /* Rejection cannot be swallowed into a successful outer result. */
          }
        }
      },
    }),
  ).toThrow();
  expect(entered).toBe(true);
  const q = prepare(rows);
  expect(q.layers[0].keys).toEqual(s.p.layers[0].keys);
  s.scope.dispose();
});
it('rejects an actual library mutation after an edited independent bank candidate exists', () => {
  const s = operation(),
    clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      p = v as Project;
    if (p?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths?.[0].path.startX === 20 && !fired) {
      fired = true;
      s.p.symbols![0].name += ' late';
    }
    return out;
  });
  expect(() => prepare([{ owner: s.owner, target: s.target }])).toThrow(/source.*changed/);
  expect(fired).toBe(true);
  expect(s.p.layers[0].liveMotionSpans![0].groupPaths![0].path.startX).toBe(10);
  s.scope.dispose();
});
it('rejects original source accessors before creating public choices', () => {
  const p = fixture();
  let reads = 0;
  Object.defineProperty(p.layers[0].liveMotionSpans![0], 'groupPaths', {
    enumerable: true,
    get() {
      reads++;
      return [];
    },
  });
  expect(() => capture(() => ({ project: p, revision: 0, frame: 4 }))).toThrow();
  expect(reads).toBe(0);
});

for (const mode of ['other role', 'getter', 'prototype'])
  it(`rejects forged original-bank clones: ${mode}`, () => {
    const s = operation(),
      clone = structuredClone;
    let fired = false,
      reads = 0;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v);
      if (Array.isArray(out) && out[0]?.groupId && out[0]?.path && !fired) {
        fired = true;
        if (mode === 'other role') out[1].path.endX += 3;
        if (mode === 'getter')
          Object.defineProperty(out[1].path, 'endX', {
            enumerable: true,
            get() {
              reads++;
              return 20;
            },
          });
        if (mode === 'prototype') Object.setPrototypeOf(out[1], { extra: true });
      }
      return out;
    });
    expect(() => prepare([{ owner: s.owner, target: s.target }])).toThrow();
    expect(fired).toBe(true);
    expect(reads).toBe(0);
    expect(s.p.layers[0].liveMotionSpans![0].groupPaths![1].path.endX).toBe(18);
    s.scope.dispose();
  });
it('rejects a late authoritative target change after original bank cloning', () => {
  const s = operation(),
    clone = structuredClone,
    request = { owner: s.owner, target: { ...s.target } };
  let fired = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v);
    if (Array.isArray(out) && out[0]?.groupId && out[0]?.path && !fired) {
      fired = true;
      request.target.x++;
    }
    return out;
  });
  expect(() => prepare([request])).toThrow(/changed/);
  expect(fired).toBe(true);
  expect(s.p.layers[0].liveMotionSpans![0].groupPaths![0].path.startX).toBe(10);
  s.scope.dispose();
});
it('rejects later-track distance-table overflow atomically', () => {
  const p = fixture();
  secondRotationTrack(p).liveMotionSpans![0].groupPaths![0].path.distance = true;
  const before = structuredClone(p),
    scope = capture(() => ({ project: p, revision: 0, frame: 4 })),
    a = scope.resolve('track', 'live', 'outer', 'start'),
    b = scope.resolve('later', 'live', 'outer', 'end');
  expect(() =>
    prepare([
      { owner: a, target: { x: a.point.x + 2, y: a.point.y } },
      { owner: b, target: { x: Number.MAX_VALUE, y: Number.MAX_VALUE } },
    ]),
  ).toThrow(/numeric|finite|overflow/);
  expect(p).toEqual(before);
  scope.dispose();
});
it('keeps off-view document targets unclamped and supports reordered-bank reopen edits', () => {
  const p = fixture('reflected');
  p.layers[0].liveMotionSpans![0].groupPaths = [
    ...p.layers[0].liveMotionSpans![0].groupPaths!,
  ].reverse();
  const s = operation(p),
    q = prepare([{ owner: s.owner, target: { x: 10000, y: -15000 } }]);
  expect(q.layers[0].liveMotionSpans![0].groupPaths!.map((b) => b.groupId)).toEqual([
    'second',
    'outer',
  ]);
  expect(q.layers[0].liveMotionSpans![0].groupPaths![1].path.startX).toBe(10000);
  expect(q.layers[0].liveMotionSpans![0].groupPaths![1].path.startY).toBe(-15020);
  const reopened = JSON.parse(JSON.stringify(q)) as Project,
    fresh = operation(reopened, 'outer', 'end'),
    again = prepare([{ owner: fresh.owner, target: fresh.target }]);
  expect(again.layers[0].liveMotionSpans![0].groupPaths![0]).toEqual(
    q.layers[0].liveMotionSpans![0].groupPaths![0],
  );
  expect(again.layers[0].keys).toEqual(p.layers[0].keys);
  s.scope.dispose();
  fresh.scope.dispose();
});

it('admits the actual independent-control aggregate capacity and rejects original overflow', () => {
  const p = fixture(),
    art = {
      id: 'art',
      kind: 'rectangle' as const,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
  p.symbols![0].shapes = Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
    ...art,
    id: 'art-' + i,
  }));
  const s = operation(p),
    q = prepare([{ owner: s.owner, target: s.target }]);
  expect(q.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  expect(q.layers[0].keys).toEqual(p.layers[0].keys);
  expect(q.layers[0].liveMotionSpans![0].path).toEqual(p.layers[0].liveMotionSpans![0].path);
  s.scope.dispose();
  p.symbols![0].shapes.push({ ...art, id: 'overflow' });
  expect(() => operation(p)).toThrow(/budget/);
}, 120000);

for (const mode of ['getter', 'hidden', 'prototype', 'async', 'extra'])
  it(`rejects malformed original options: ${mode}`, () => {
    const s = operation(),
      options: { validate?: () => void; other?: boolean } = {};
    let reads = 0;
    if (mode === 'getter')
      Object.defineProperty(options, 'validate', {
        enumerable: true,
        get() {
          reads++;
          return () => {};
        },
      });
    if (mode === 'hidden')
      Object.defineProperty(options, 'validate', { value: () => {}, enumerable: false });
    if (mode === 'prototype')
      Object.setPrototypeOf(options, {
        validate: () => {
          reads++;
        },
      });
    if (mode === 'async') options.validate = async () => {};
    if (mode === 'extra') options.other = true;
    const before = structuredClone(s.p);
    expect(() => prepare([{ owner: s.owner, target: s.target }], options)).toThrow();
    expect(reads).toBe(0);
    expect(s.p).toEqual(before);
    s.scope.dispose();
  });
it('rejects a forged source snapshot accessor without evaluating it', () => {
  const p = fixture(),
    clone = structuredClone;
  let fired = false,
    reads = 0;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      q = out as Project;
    if (q?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths && !fired) {
      fired = true;
      Object.defineProperty(q.layers[0].liveMotionSpans[0].groupPaths[0].path, 'startX', {
        enumerable: true,
        get() {
          reads++;
          return 10;
        },
      });
    }
    return out;
  });
  expect(() => capture(() => ({ project: p, revision: 0, frame: 4 }))).toThrow();
  expect(fired).toBe(true);
  expect(reads).toBe(0);
});
it('rejects forged public hint coordinates and allows a fresh private resolve', () => {
  const s = operation(),
    clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v);
    if (Array.isArray(out) && out[0]?.groupId && out[0]?.point && !fired) {
      fired = true;
      out[0].point.x = 900;
    }
    return out;
  });
  expect(() => s.scope.choices).toThrow(/clone changed/);
  expect(fired).toBe(true);
  vi.unstubAllGlobals();
  expect(s.scope.resolve('track', 'live', 'outer', 'start').point).toEqual(s.owner.point);
  s.scope.dispose();
});

it('poisons swallowed initial-reader reentry and permits a fresh source capture', () => {
  const p = fixture();
  let entered = false;
  const read = () => {
    if (!entered) {
      entered = true;
      try {
        capture(read);
      } catch {
        /* Swallowed original read rejection must poison the outer capture. */
      }
    }
    return { project: p, revision: 0, frame: 4 };
  };
  expect(() => capture(read)).toThrow(/reenter/);
  expect(entered).toBe(true);
  const scope = capture(read);
  expect(scope.resolve('track', 'live', 'outer', 'start').point).toEqual({ x: 10, y: 40 });
  scope.dispose();
});

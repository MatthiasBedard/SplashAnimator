import { expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  validateProject,
  type Project,
  type Point,
} from '../packages/document/src';
import { liveSplitFixture } from './live-motion-split-fixture';
import {
  captureLiveCubicControls as capture,
  prepareLiveCubicControlPositions as prepare,
  type LiveCubicControlOwner,
  type LiveCubicControlRequest,
} from '../packages/animation/src/live-cubic-controls';
import {
  captureLiveMotionAuthoringFrame,
  prepareSplitLiveMotionSpans,
  type LiveRootOwner,
} from '../packages/animation/src/live-motion-owner';

const arch = { startX: 0, startY: 40, endX: 0, endY: 40 };
function fixture(two = false) {
  const p = liveSplitFixture((_p, s) => (s.path = { ...arch }));
  if (two) p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  return p;
}
function operation(p = fixture(), frame = 4, role: 'start' | 'end' = 'start', shape = 'art') {
  const view = capture(() => ({ project: p, revision: 7, frame })),
    owner = view.resolve('track', 'live', shape, role);
  return { view, owner };
}
const target = (o: LiveCubicControlOwner): Point => ({ x: o.point.x + 10, y: o.point.y + 10 });

for (const frame of [0, 1, 4, 7, 8])
  for (const role of ['start', 'end'] as const)
    it(`privately owns ${role} at frame ${frame} independently of split space`, () => {
      const p = fixture(),
        before = structuredClone(p),
        { view, owner } = operation(p, frame, role),
        input = [{ owner, target: target(owner) }],
        out = prepare(input),
        expected = structuredClone(p);
      const path = expected.layers[0].liveMotionSpans![0].path!;
      if (role === 'start') {
        path.startX = 10;
        path.startY = 50;
      } else {
        path.endX = 10;
        path.endY = 50;
      }
      expect(owner.point).toEqual({ x: role === 'start' ? 8 : 88, y: 52 });
      expect(owner.shapeIds).toEqual(['art']);
      expect(out).toEqual(expected);
      expect(p).toEqual(before);
      expect(input[0].target).toEqual(target(owner));
      expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
      view.dispose();
      expect(() => prepare(input)).toThrow();
    });

for (const reflected of [false, true])
  it(`uses original document origins for ${reflected ? 'reflected' : 'affine'} compound leaders and complete membership`, () => {
    const p = fixture();
    for (const k of p.layers[0].keys.slice(0, 2)) {
      Object.assign(k.shapes[0], {
        kind: 'polygon',
        fillRule: 'evenodd',
        transform: [reflected ? -2 : 2, 0.25, 0.5, 3],
        pivot: { x: -100, y: 200 },
        contours: [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 4, y: 4 },
            { x: 10, y: 4 },
            { x: 7, y: 10 },
          ],
        ],
      });
      k.shapes.push({
        ...structuredClone(k.shapes[0]),
        id: 'second',
        x: k.shapes[0].x + 30,
        y: 55,
      });
    }
    p.layers[0].liveMotionSpans![0].options = { affine: true, nodes: true };
    const before = structuredClone(p),
      { view, owner } = operation(p, 4, 'end', 'second');
    expect(owner.point).toEqual({ x: 118, y: 95 });
    expect(owner.shapeIds).toEqual(['art', 'second']);
    const out = prepare([{ owner, target: { x: 108, y: 100 } }]);
    expect(out.layers[0].liveMotionSpans![0].path).toEqual({ ...arch, endX: -10, endY: 45 });
    expect(out.layers[0].keys).toEqual(before.layers[0].keys);
    expect(p).toEqual(before);
    view.dispose();
  });

it('multiple tracks use one private scope and leave unrequested metadata exact', () => {
  const p = fixture(true);
  Object.assign(p.layers[0].liveMotionSpans![0], {
    opacityEase: 'out',
    rotation: { direction: 'clockwise', turns: 1 },
  });
  const before = structuredClone(p),
    { view, owner } = operation(p),
    later = view.resolve('later', 'live', 'art', 'end');
  const out = prepare([
    { owner, target: target(owner) },
    { owner: later, target: { x: 78, y: 42 } },
  ]);
  expect(out.layers[0].liveMotionSpans![0]).toEqual({
    ...before.layers[0].liveMotionSpans![0],
    path: { ...arch, startX: 10, startY: 50 },
  });
  expect(out.layers[1].liveMotionSpans![0].path).toEqual({ ...arch, endX: -10, endY: 30 });
  expect(p).toEqual(before);
  out.layers[0].keys[0].shapes[0].x = 900;
  out.layers[0].liveMotionSpans![0].path!.startY = 900;
  expect(p).toEqual(before);
  view.dispose();
});

it('shared endpoint contexts explicitly distinguish adjacent original span IDs', () => {
  const p = fixture();
  p.duration = 20;
  p.layers[0].keys[2] = {
    frame: 16,
    shapes: [{ ...structuredClone(p.layers[0].keys[1].shapes[0]), x: 168 }],
  };
  p.layers[0].keys.push({ frame: 18, shapes: [] });
  p.layers[0].liveMotionSpans!.push({
    id: 'next',
    start: 8,
    end: 16,
    ease: 'linear',
    path: { ...arch },
  });
  const { view, owner } = operation(p, 8, 'end'),
    next = view.resolve('track', 'next', 'art', 'start');
  expect(owner.point).toEqual(next.point);
  const out = prepare([{ owner: next, target: { x: 98, y: 62 } }]);
  expect(out.layers[0].liveMotionSpans![0]).toEqual(p.layers[0].liveMotionSpans![0]);
  expect(out.layers[0].liveMotionSpans![1].path).toEqual({ ...arch, startX: 10, startY: 50 });
  view.dispose();
});

for (const mode of ['json', 'copy', 'choices', 'legacy', 'duplicate', 'crossScope'])
  it(`rejects ${mode} ownership without accepting public coordinates as identity`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { view, owner } = operation(p),
      other = operation(p),
      legacy = captureLiveMotionAuthoringFrame(() => ({ project: p, revision: 7, frame: 4 }));
    const requests: LiveCubicControlRequest[] = [{ owner, target: target(owner) }];
    if (mode === 'json') requests[0].owner = JSON.parse(JSON.stringify(owner));
    if (mode === 'copy') requests[0].owner = { ...owner };
    if (mode === 'choices') requests[0].owner = view.choices[0] as unknown as LiveCubicControlOwner;
    if (mode === 'legacy')
      requests[0].owner = legacy.resolve('track', 'art') as unknown as LiveCubicControlOwner;
    if (mode === 'duplicate')
      requests.push({
        owner: view.resolve('track', 'live', 'art', 'end'),
        target: { x: 98, y: 62 },
      });
    if (mode === 'crossScope') requests.push({ owner: other.owner, target: target(other.owner) });
    expect(() => prepare(requests)).toThrow();
    expect(p).toEqual(before);
    view.dispose();
    other.view.dispose();
    legacy.dispose();
  });

it('public hints and replaced methods do not own private geometry or bypass source checks', () => {
  const p = fixture(),
    { view, owner } = operation(p),
    hints = view.choices;
  hints[0].point.x = 999;
  hints[0].shapeId = 'forged';
  expect(view.resolve('track', 'live', 'art', 'start').point).toEqual({ x: 8, y: 52 });
  expect(Object.isFrozen(owner.point)).toBe(true);
  expect(Object.isFrozen(owner.shapeIds)).toBe(true);
  view.assertCurrent = () => {};
  p.name = 'Actual source edit';
  expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
});

for (const mode of ['absent', 'waypoint', 'locked', 'hidden', 'outside', 'missing', 'role'])
  it(`keeps ${mode} contexts outside cubic ownership`, () => {
    const p = fixture();
    if (mode === 'absent') delete p.layers[0].liveMotionSpans![0].path;
    if (mode === 'waypoint')
      p.layers[0].liveMotionSpans![0].path = { ...arch, waypoints: [{ x: 40, y: 30 }] };
    if (mode === 'locked') p.layers[0].locked = true;
    if (mode === 'hidden') p.layers[0].visible = false;
    const frame = mode === 'outside' ? 9 : 4,
      view = capture(() => ({ project: p, revision: 0, frame }));
    expect(() =>
      view.resolve(
        'track',
        'live',
        mode === 'missing' ? 'missing' : 'art',
        mode === 'role' ? ('incoming' as 'start') : 'start',
      ),
    ).toThrow();
    view.dispose();
  });

it('retains exact legacy split scope and rejects new controls at its publication boundary', () => {
  const p = fixture(),
    { view, owner } = operation(p, 1),
    legacy = captureLiveMotionAuthoringFrame(() => ({ project: p, revision: 7, frame: 1 }));
  expect(legacy.choices).toEqual([]);
  expect(() => legacy.resolve('track', 'art')).toThrow();
  expect(() =>
    prepareSplitLiveMotionSpans([{ owner: owner as unknown as LiveRootOwner, rightSpanId: 'new' }]),
  ).toThrow();
  view.dispose();
  legacy.dispose();
});

for (const action of ['frame', 'revision', 'identity', 'source', 'dispose', 'reentry'])
  it(`observed ${action} changes permanently invalidate old controls even after restoration`, () => {
    let p = fixture(),
      frame = 4,
      revision = 0,
      armed = false;
    const original = p;
    const view: ReturnType<typeof capture> = capture(() => {
      if (armed) {
        armed = false;
        try {
          view.assertCurrent();
        } catch {
          /* host swallows recursive read */
        }
      }
      return { project: p, frame, revision };
    });
    const owner = view.resolve('track', 'live', 'art', 'start');
    if (action === 'frame') frame = 5;
    if (action === 'revision') revision = 1;
    if (action === 'identity') p = structuredClone(p);
    if (action === 'source') p.name = 'Changed';
    if (action === 'dispose') view.dispose();
    if (action === 'reentry') armed = true;
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
    p = original;
    frame = 4;
    revision = 0;
    expect(() => prepare([{ owner, target: target(owner) }])).toThrow();
  });

for (const mode of [
  'NaN',
  'Infinity',
  'getter',
  'inherited',
  'nonenumerable',
  'extra',
  'unchanged',
])
  it(`rejects raw ${mode} targets without source writes`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { view, owner } = operation(p);
    let reads = 0;
    const r = { owner, target: target(owner) };
    if (mode === 'NaN') r.target.x = NaN;
    if (mode === 'Infinity') r.target.y = Infinity;
    if (mode === 'getter')
      Object.defineProperty(r.target, 'x', {
        enumerable: true,
        get() {
          reads++;
          return 18;
        },
      });
    if (mode === 'inherited') {
      delete (r as Partial<typeof r>).target;
      Object.setPrototypeOf(r, {
        get target() {
          reads++;
          return { x: 18, y: 62 };
        },
      });
    }
    if (mode === 'nonenumerable')
      Object.defineProperty(r, 'target', { value: r.target, enumerable: false });
    if (mode === 'extra') Object.assign(r.target, { extra: true });
    if (mode === 'unchanged') r.target = { ...owner.point };
    expect(() => prepare([r])).toThrow();
    expect(reads).toBe(0);
    expect(p).toEqual(before);
    view.dispose();
  });

for (const mode of [
  'input',
  'async',
  'reentry',
  'callbackGetter',
  'lateCandidate',
  'lateReaderTarget',
  'lateReaderSource',
])
  it(`rejects asserted ${mode} admission and preserves valid source-owned retries`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let requests: LiveCubicControlRequest[] = [];
    let candidate: Project | undefined,
      hit = false,
      once = true;
    const view = capture(() => {
        const stack = new Error().stack ?? '';
        if (
          (mode === 'lateReaderTarget' || mode === 'lateReaderSource') &&
          candidate &&
          !hit &&
          stack.includes('prepareLiveCubicControlPositions') &&
          !stack.includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          if (mode === 'lateReaderSource') p.name = 'Separate late source edit';
          else requests[0].target.x++;
        }
        return { project: p, revision: 0, frame: 4 };
      }),
      owner = view.resolve('track', 'live', 'art', 'start');
    requests = [{ owner, target: { x: 18, y: 72 } }];
    const clone = structuredClone;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v);
      if ((out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startY === 60)
        candidate = out as Project;
      return out;
    });
    const options = {
      validate: () => {
        const stack = new Error().stack ?? '';
        if (
          mode === 'lateCandidate' &&
          candidate &&
          !hit &&
          stack.includes('prepareLiveCubicControlPositions') &&
          !stack.includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          candidate.layers[0].keys[0].shapes[0].x = 900;
        }
        if (!once) return;
        once = false;
        if (mode === 'input') {
          hit = true;
          requests[0].target.y++;
        }
        if (mode === 'async') {
          hit = true;
          return Promise.resolve() as unknown as void;
        }
        if (mode === 'reentry') {
          hit = true;
          try {
            prepare(requests);
          } catch {
            /* swallowed reentry still poisons outer operation */
          }
        }
      },
    };
    if (mode === 'callbackGetter')
      Object.defineProperty(options, 'validate', {
        get() {
          hit = true;
          throw Error('Getter must not run');
        },
      });
    try {
      expect(() => prepare(requests, options)).toThrow();
      expect(hit).toBe(mode !== 'callbackGetter');
      if (mode === 'lateReaderSource') before.name = 'Separate late source edit';
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
    const fresh = mode === 'lateReaderSource' ? operation(p) : undefined;
    expect(
      prepare([{ owner: fresh?.owner ?? owner, target: { x: 18, y: 72 } }]).layers[0]
        .liveMotionSpans![0].path,
    ).toEqual({ ...arch, startX: 10, startY: 60 });
    fresh?.view.dispose();
    view.dispose();
  });

it('preserves tangent/distance/heading settings and rejects overflowing candidate preparation', () => {
  const p = fixture();
  Object.assign(p.layers[0].liveMotionSpans![0].path!, {
    distance: true,
    tangent: true,
    headingOffset: 10,
    headingOffsetEnd: 20,
  });
  const before = structuredClone(p),
    { view, owner } = operation(p);
  expect(() => prepare([{ owner, target: { x: Number.MAX_VALUE, y: 72 } }])).toThrow();
  expect(p).toEqual(before);
  const out = prepare([{ owner, target: { x: 18, y: 62 } }]);
  expect(out.layers[0].liveMotionSpans![0].path).toEqual({
    ...before.layers[0].liveMotionSpans![0].path,
    startX: 10,
    startY: 50,
  });
  view.dispose();
});

it('checks original aggregate artwork budget without adding a lower control limit', () => {
  const p = fixture(),
    art = p.layers[0].keys[0].shapes[0];
  p.symbols = [
    {
      id: 'unused',
      name: 'Unused',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK + 1 }, (_, i) => ({ ...art, id: 's' + i })),
    },
  ];
  expect(() => capture(() => ({ project: p, revision: 0, frame: 4 }))).toThrow(/budget/);
  expect(p.layers[0].liveMotionSpans![0].path).toEqual(arch);
}, 30000);

it('reopened candidates resolve fresh original endpoints and preserve the untouched control', () => {
  const p = fixture(),
    { view, owner } = operation(p),
    out = prepare([{ owner, target: { x: 18, y: 72 } }]),
    reopened = validateProject(JSON.parse(JSON.stringify(out)));
  const next = operation(reopened, 7, 'end');
  expect(next.view.resolve('track', 'live', 'art', 'start').point).toEqual({ x: 18, y: 72 });
  expect(
    prepare([{ owner: next.owner, target: { x: 83, y: 57 } }]).layers[0].liveMotionSpans![0].path,
  ).toEqual({ ...arch, startX: 10, startY: 60, endX: -5, endY: 45 });
  expect(p.layers[0].liveMotionSpans![0].path).toEqual(arch);
  view.dispose();
  next.view.dispose();
});

it('corrupted public hint clones reject without changing private controls', () => {
  const p = fixture(),
    { view, owner } = operation(p),
    clone = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v);
    if (!hit && Array.isArray(out) && out[0]?.role) {
      hit = true;
      out[0].point.x = 999;
    }
    return out;
  });
  try {
    expect(() => view.choices).toThrow(/clone/);
    expect(hit).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
  expect(prepare([{ owner, target: target(owner) }]).layers[0].liveMotionSpans![0].path).toEqual({
    ...arch,
    startX: 10,
    startY: 50,
  });
  view.dispose();
});

it('capture snapshot corruption rejects before any owner can escape', () => {
  const p = fixture(),
    before = structuredClone(p),
    clone = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v);
    if (v === p && !hit) {
      hit = true;
      (out as Project).name = 'Forged snapshot';
    }
    return out;
  });
  try {
    expect(() => capture(() => ({ project: p, frame: 4, revision: 0 }))).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('raw resolve identities cannot execute serialization getters', () => {
  const { view } = operation();
  let reads = 0;
  const forged = {
    get toJSON() {
      reads++;
      return () => 'track';
    },
  };
  expect(() => view.resolve(forged as unknown as string, 'live', 'art', 'start')).toThrow();
  expect(reads).toBe(0);
  view.dispose();
});

it('complete edited clone aggregate overflow rejects and preserves fresh source-valid preparation', () => {
  const p = fixture(),
    before = structuredClone(p),
    { view, owner } = operation(p),
    clone = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      q = out as Project;
    if (!hit && q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startY === 60) {
      hit = true;
      const art = q.layers[0].keys[0].shapes[0];
      q.symbols = [
        {
          id: 'unused',
          name: 'Unused',
          width: 1,
          height: 1,
          shapes: Array.from({ length: MAX_SYMBOL_ARTWORK + 1 }, (_, i) => ({
            ...art,
            id: 's' + i,
          })),
        },
      ];
    }
    return out;
  });
  try {
    expect(() => prepare([{ owner, target: { x: 18, y: 72 } }])).toThrow(/budget/);
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
  }
  expect(prepare([{ owner, target: { x: 18, y: 72 } }]).layers[0].liveMotionSpans![0].path).toEqual(
    { ...arch, startX: 10, startY: 60 },
  );
  view.dispose();
}, 30000);

it('off-view document targets preserve default/saved pivots and exact false/undefined path settings', () => {
  const p = fixture(),
    span = p.layers[0].liveMotionSpans![0];
  span.options = { affine: true, pivots: true, defaultPivots: true };
  p.layers[0].keys[1].shapes[0].pivot = { x: 2, y: 3 };
  Object.assign(span.path!, {
    distance: false,
    tangent: false,
    headingOffset: undefined,
    waypoints: undefined,
  });
  const before = structuredClone(p),
    { view, owner } = operation(p);
  expect(owner.point).toEqual({ x: 8, y: 52 });
  const out = prepare([{ owner, target: { x: -200, y: 300 } }]);
  expect(out.layers[0].liveMotionSpans![0]).toEqual({
    ...before.layers[0].liveMotionSpans![0],
    path: { ...before.layers[0].liveMotionSpans![0].path, startX: -208, startY: 288 },
  });
  expect(Object.hasOwn(out.layers[0].liveMotionSpans![0].path!, 'headingOffset')).toBe(true);
  expect(out.layers[0].keys).toEqual(before.layers[0].keys);
  expect(p).toEqual(before);
  view.dispose();
});

it('a later stationary candidate rejects all controls and leaves valid original scope reusable', () => {
  const p = fixture(true);
  p.layers[1].liveMotionSpans![0].path!.tangent = true;
  const before = structuredClone(p),
    { view, owner } = operation(p),
    later = view.resolve('later', 'live', 'art', 'start');
  let output: Project | undefined;
  expect(() => {
    output = prepare([
      { owner, target: { x: 18, y: 62 } },
      { owner: later, target: { x: 168, y: 52 } },
    ]);
  }).toThrow(/tangent/);
  expect(output).toBeUndefined();
  expect(p).toEqual(before);
  expect(prepare([{ owner, target: { x: 18, y: 62 } }]).layers[1]).toEqual(before.layers[1]);
  view.dispose();
});

it('large root membership uses one frozen shared ID list and linear-sized public hints', () => {
  const p = fixture(),
    count = 2000;
  for (const k of p.layers[0].keys.slice(0, 2)) {
    const art = k.shapes[0];
    k.shapes = Array.from({ length: count }, (_, i) => ({
      ...structuredClone(art),
      id: 'art' + i,
    }));
  }
  let checks = 0;
  const find = Array.prototype.find,
    spy = vi.spyOn(Array.prototype, 'find').mockImplementation(function (
      this: unknown[],
      predicate: (v: unknown, i: number, a: unknown[]) => unknown,
      context?: unknown,
    ) {
      const tracked = this.length === count && (this[0] as { id?: string })?.id === 'art0';
      return find.call(this, (v: unknown, i: number, a: unknown[]) => {
        if (tracked) checks++;
        return predicate.call(context, v, i, a);
      });
    } as typeof Array.prototype.find);
  let view: ReturnType<typeof capture>;
  try {
    view = capture(() => ({ project: p, revision: 0, frame: 4 }));
    expect(checks).toBeLessThanOrEqual(count * 8);
  } finally {
    spy.mockRestore();
  }
  const hints = view.choices;
  expect(hints).toHaveLength(2 * count);
  expect(hints.every((h) => !Object.hasOwn(h, 'shapeIds'))).toBe(true);
  expect(JSON.stringify(hints).length).toBeLessThan(count * 1000);
  const a = view.resolve('track', 'live', 'art0', 'start'),
    b = view.resolve('track', 'live', 'art1', 'end');
  expect(a.shapeIds).toBe(b.shapeIds);
  expect(a.shapeIds).toHaveLength(count);
  expect(Object.isFrozen(a.shapeIds)).toBe(true);
  view.dispose();
}, 30000);

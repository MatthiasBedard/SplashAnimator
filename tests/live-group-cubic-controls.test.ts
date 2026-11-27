import { expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  validateProject,
  type Project,
  type Point,
} from '../packages/document/src';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import {
  captureLiveGroupCubicControls as capture,
  prepareLiveGroupCubicControlPositions as prepare,
  type LiveGroupCubicControlOwner as LiveCubicControlOwner,
  type LiveGroupCubicControlRequest as LiveCubicControlRequest,
} from '../packages/animation/src/live-group-cubic-controls';
import {
  captureLiveCubicControls as captureRoot,
  prepareLiveCubicControlPositions as prepareRoot,
} from '../packages/animation/src/live-cubic-controls';

const arch = { startX: 0, startY: 40, endX: 0, endY: 40 };
function fixture(mode = 'rigid', basis = 'plain', many = true) {
  const { p } = liveRotationFixture(mode, basis, many);
  p.layers[0].liveMotionSpans![0].path = { ...arch };
  return p;
}
function operation(p = fixture(), frame = 4, role: 'start' | 'end' = 'start', group = 'outer') {
  const view = capture(() => ({ project: p, revision: 7, frame })),
    owner = view.resolve('track', 'live', group, role);
  return { view, owner };
}
const target = (o: LiveCubicControlOwner): Point => ({ x: o.point.x + 10, y: o.point.y + 10 });

for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const role of ['start', 'end'] as const)
      it(`prepares shared ${role} offsets from original ${mode}/${basis} group references`, () => {
        const p = fixture(mode, basis),
          before = structuredClone(p),
          { view, owner } = operation(p, 4, role, 'second');
        expect(owner.point).toEqual({ x: role === 'start' ? 160 : 240, y: 160 });
        expect(owner.groupId).toBe('second');
        expect(owner.shapeId).toBe('c');
        expect(owner.groupShapeIds).toEqual(['c', 'd']);
        expect(owner.shapeIds).toEqual(['a', 'b', 'c', 'd', 'loose']);
        expect(Object.isFrozen(owner.groupShapeIds)).toBe(true);
        const out = prepare([{ owner, target: target(owner) }]);
        const expected = structuredClone(p);
        Object.assign(
          expected.layers[0].liveMotionSpans![0].path!,
          role === 'start' ? { startX: 10, startY: 50 } : { endX: 10, endY: 50 },
        );
        expect(out).toEqual(expected);
        expect(p).toEqual(before);
        const original = createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0]),
          edited = createMotionFrameSampler(out, 'track', out.layers[0].liveMotionSpans![0]);
        for (const f of [0, 2, 4, 6, 8]) {
          const a = original.sample(f),
            b = edited.sample(f),
            t = f / 8;
          const delta = 30 * (role === 'start' ? (1 - t) ** 2 * t : (1 - t) * t ** 2);
          for (let i = 0; i < a.length; i++) {
            expect(b[i].x).toBeCloseTo(a[i].x + delta, 9);
            expect(b[i].y).toBeCloseTo(a[i].y + delta, 9);
            expect(b[i].transform).toEqual(a[i].transform);
            expect(b[i].groups).toEqual(a[i].groups);
          }
          if (f === 4) {
            expect(b[0].x).toBeCloseTo(43.75, 9);
            expect(b[0].y).toBeCloseTo(53.75, 9);
            expect(b[4].x).toBeCloseTo(293.75, 9);
            expect(b[4].y).toBeCloseTo(93.75, 9);
          }
        }
        original.dispose();
        edited.dispose();
        view.dispose();
      });

for (const frame of [0, 1, 7, 8])
  it(`owns saved endpoint references at frame ${frame} independently of sampled positions`, () => {
    const p = fixture(),
      { view, owner } = operation(p, frame);
    expect(owner.point).toEqual({ x: 0, y: 60 });
    expect(view.choices).toHaveLength(4);
    const hint = view.choices[0];
    hint.point.x = 999;
    hint.groupId = 'forged';
    expect(view.resolve('track', 'live', 'outer', 'start').point).toEqual(owner.point);
    expect(() => view.resolve('track', 'live', 'inner', 'start')).toThrow();
    expect(() => view.resolve('track', 'live', 'loose', 'start')).toThrow();
    view.dispose();
  });

it('uses the actual ordered first member, not sorted IDs, bounds, local pivot or descendant groups', () => {
  const p = fixture('both', 'reflected');
  for (const k of p.layers[0].keys.slice(0, 2)) {
    k.shapes = [k.shapes[1], k.shapes[0], ...k.shapes.slice(2)];
    for (const shape of k.shapes) shape.pivot = { x: -400, y: 900 };
  }
  const { view, owner } = operation(p);
  expect(owner.shapeId).toBe('b');
  expect(owner.groupShapeIds).toEqual(['b', 'a']);
  expect(owner.point).toEqual({ x: 40, y: 60 });
  const out = prepare([{ owner, target: { x: 35, y: 65 } }]);
  expect(out.layers[0].liveMotionSpans![0].path).toEqual({ ...arch, startX: -5, startY: 45 });
  view.dispose();
});

it('keeps root and explicit group brands and legacy scopes separate', () => {
  const p = fixture(),
    { view, owner } = operation(p),
    root = captureRoot(() => ({ project: p, revision: 7, frame: 4 }));
  expect(root.choices).toEqual([]);
  expect(() => prepareRoot([{ owner, target: target(owner) }])).toThrow();
  const plain = fixture();
  for (const k of plain.layers[0].keys) for (const s of k.shapes) delete s.groups;
  delete plain.layers[0].liveMotionSpans![0].rotation!.rigidGroups;
  const groupPlain = capture(() => ({ project: plain, revision: 7, frame: 4 })),
    plainRoot = captureRoot(() => ({ project: plain, revision: 7, frame: 4 })),
    rootOwner = plainRoot.resolve('track', 'live', 'a', 'start');
  expect(groupPlain.choices).toEqual([]);
  expect(() =>
    prepare([{ owner: rootOwner as LiveCubicControlOwner, target: rootOwner.point }]),
  ).toThrow();
  view.dispose();
  root.dispose();
  groupPlain.dispose();
  plainRoot.dispose();
});

for (const mode of ['json', 'copy', 'choices', 'duplicate', 'differentGroup', 'crossScope'])
  it(`rejects ${mode} requests without giving public data shared path ownership`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { view, owner } = operation(p),
      other = operation(p);
    const rows: LiveCubicControlRequest[] = [{ owner, target: target(owner) }];
    if (mode === 'json') rows[0].owner = JSON.parse(JSON.stringify(owner));
    if (mode === 'copy') rows[0].owner = { ...owner };
    if (mode === 'choices') rows[0].owner = view.choices[0] as LiveCubicControlOwner;
    if (mode === 'duplicate' || mode === 'differentGroup') {
      const second = view.resolve(
        'track',
        'live',
        mode === 'duplicate' ? 'outer' : 'second',
        'end',
      );
      rows.push({ owner: second, target: target(second) });
    }
    if (mode === 'crossScope') rows.push({ owner: other.owner, target: target(other.owner) });
    expect(() => prepare(rows)).toThrow();
    expect(p).toEqual(before);
    view.dispose();
    other.view.dispose();
  });

for (const mode of ['absent', 'waypoint', 'locked', 'hidden', 'outside', 'missing', 'role'])
  it(`does not offer ${mode} group controls`, () => {
    const p = fixture();
    if (mode === 'absent') delete p.layers[0].liveMotionSpans![0].path;
    if (mode === 'waypoint')
      p.layers[0].liveMotionSpans![0].path = { ...arch, waypoints: [{ x: 40, y: 30 }] };
    if (mode === 'locked') p.layers[0].locked = true;
    if (mode === 'hidden') p.layers[0].visible = false;
    const view = capture(() => ({ project: p, revision: 0, frame: mode === 'outside' ? 9 : 4 }));
    expect(() =>
      view.resolve(
        'track',
        'live',
        mode === 'missing' ? 'bad' : 'outer',
        mode === 'role' ? ('incoming' as 'start') : 'start',
      ),
    ).toThrow();
    view.dispose();
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
    const owner = view.resolve('track', 'live', 'outer', 'start');
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
          stack.includes('prepareLiveGroupCubicControlPositions') &&
          !stack.includes('prepareUpdateLiveMotionSpans')
        ) {
          hit = true;
          if (mode === 'lateReaderSource') p.name = 'Separate late source edit';
          else requests[0].target.x++;
        }
        return { project: p, revision: 0, frame: 4 };
      }),
      owner = view.resolve('track', 'live', 'outer', 'start');
    requests = [{ owner, target: { x: 18, y: 72 } }];
    const clone = structuredClone;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v);
      if ((out as Project)?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startY === 52)
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
          stack.includes('prepareLiveGroupCubicControlPositions') &&
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
    ).toEqual({ ...arch, startX: 18, startY: 52 });
    fresh?.view.dispose();
    view.dispose();
  });

it('prepares multiple tracks atomically and preserves advanced single-cubic metadata through JSON reopen', () => {
  const p = fixture();
  secondRotationTrack(p);
  for (const layer of p.layers)
    Object.assign(layer.liveMotionSpans![0].path!, {
      distance: true,
      tangent: true,
      headingOffset: 10,
      headingOffsetEnd: 20,
    });
  const before = structuredClone(p),
    { view, owner } = operation(p),
    later = view.resolve('later', 'live', 'second', 'end');
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: later, target: { x: Number.MAX_VALUE, y: 60 } },
    ]),
  ).toThrow();
  expect(p).toEqual(before);
  const out = prepare([
    { owner, target: target(owner) },
    { owner: later, target: target(later) },
  ]);
  expect(out.layers[0].liveMotionSpans![0].path).toEqual({
    ...before.layers[0].liveMotionSpans![0].path,
    startX: 10,
    startY: 50,
  });
  expect(out.layers[1].liveMotionSpans![0].path).toEqual({
    ...before.layers[1].liveMotionSpans![0].path,
    endX: 10,
    endY: 50,
  });
  expect(out.layers.map((l) => l.keys)).toEqual(before.layers.map((l) => l.keys));
  expect(out.symbols).toEqual(before.symbols);
  validateProject(out);
  const reopened = JSON.parse(JSON.stringify(out)) as Project,
    fresh = operation(reopened, 6, 'end');
  expect(
    prepare([{ owner: fresh.owner, target: target(fresh.owner) }]).layers[0].liveMotionSpans![0]
      .path!.endY,
  ).toBe(50);
  out.layers[0].keys[0].shapes[0].x = 999;
  expect(p).toEqual(before);
  fresh.view.dispose();
  view.dispose();
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
  expect(() => view.resolve(forged as unknown as string, 'live', 'outer', 'start')).toThrow();
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
    if (!hit && q?.layers?.[0]?.liveMotionSpans?.[0]?.path?.startY === 52) {
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
    { ...arch, startX: 18, startY: 52 },
  );
  view.dispose();
}, 30000);

for (const scale of [1e-6, 1, 1000])
  it(`uses finite relative document offsets at scale ${scale}`, () => {
    const p = fixture('shear', 'reflected');
    for (const k of p.layers[0].keys)
      for (const shape of k.shapes) {
        shape.x = 10000 + shape.x * scale;
        shape.y = -10000 + shape.y * scale;
      }
    p.layers[0].liveMotionSpans![0].path = {
      startX: 0,
      startY: 40 * scale,
      endX: 0,
      endY: 40 * scale,
    };
    const { view, owner } = operation(p, 4, 'end', 'second'),
      before = structuredClone(p);
    expect(owner.point.x).toBe(10000 + 240 * scale);
    expect(owner.point.y).toBeCloseTo(-10000 + 160 * scale, 9);
    const next = { x: owner.point.x - 10 * scale, y: owner.point.y + 20 * scale };
    const out = prepare([{ owner, target: next }]);
    expect(out.layers[0].liveMotionSpans![0].path!.endX).toBeCloseTo(-10 * scale, 8);
    expect(out.layers[0].liveMotionSpans![0].path!.endY).toBeCloseTo(60 * scale, 8);
    expect(out.layers[0].keys).toEqual(before.layers[0].keys);
    expect(p).toEqual(before);
    view.dispose();
  });

it('preserves compound artwork and absent/saved pivots while editing off-view controls', () => {
  const p = fixture('rigid', 'reflected');
  for (const k of p.layers[0].keys.slice(0, 2)) {
    Object.assign(k.shapes[0], {
      kind: 'polygon',
      fillRule: 'evenodd',
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
    delete k.shapes[0].pivot;
  }
  Object.assign(p.layers[0].liveMotionSpans![0].path!, {
    distance: false,
    tangent: false,
    headingOffset: undefined,
  });
  const before = structuredClone(p),
    { view, owner } = operation(p);
  const out = prepare([{ owner, target: { x: -200, y: 300 } }]);
  expect(out.layers[0].liveMotionSpans![0].path).toEqual({
    ...before.layers[0].liveMotionSpans![0].path,
    startX: -200,
    startY: 280,
  });
  expect(Object.hasOwn(out.layers[0].liveMotionSpans![0].path!, 'headingOffset')).toBe(true);
  expect(out.layers[0].keys).toEqual(before.layers[0].keys);
  expect(p).toEqual(before);
  view.dispose();
});

it('invalid later continuous tangent preparation rejects every earlier request and allows a fresh valid request', () => {
  const p = fixture();
  secondRotationTrack(p);
  p.layers[1].liveMotionSpans![0].path!.tangent = true;
  const before = structuredClone(p),
    { view, owner } = operation(p),
    later = view.resolve('later', 'live', 'outer', 'start');
  expect(() =>
    prepare([
      { owner, target: target(owner) },
      { owner: later, target: { x: 160, y: 60 } },
    ]),
  ).toThrow(/tangent/);
  expect(p).toEqual(before);
  expect(prepare([{ owner, target: target(owner) }]).layers[1]).toEqual(before.layers[1]);
  view.dispose();
});

it('shares frozen complete membership and each outer-group member list without quadratic public hints', () => {
  const p = fixture(),
    count = 2000;
  for (const k of p.layers[0].keys.slice(0, 2)) {
    const art = k.shapes[0];
    k.shapes = Array.from({ length: count }, (_, i) => ({
      ...structuredClone(art),
      id: 'art' + i,
      groups: ['g' + Math.floor(i / 2), 'nested' + Math.floor(i / 2)],
    }));
  }
  const view = capture(() => ({ project: p, frame: 4, revision: 0 }));
  const hints = view.choices;
  expect(hints).toHaveLength(count);
  expect(
    hints.every((h) => !Object.hasOwn(h, 'shapeIds') && !Object.hasOwn(h, 'groupShapeIds')),
  ).toBe(true);
  expect(JSON.stringify(hints).length).toBeLessThan(count * 500);
  const a = view.resolve('track', 'live', 'g0', 'start'),
    b = view.resolve('track', 'live', 'g0', 'end'),
    c = view.resolve('track', 'live', 'g1', 'start');
  expect(a.shapeIds).toBe(b.shapeIds);
  expect(a.shapeIds).toBe(c.shapeIds);
  expect(a.groupShapeIds).toBe(b.groupShapeIds);
  expect(a.groupShapeIds).toEqual(['art0', 'art1']);
  expect(a.shapeIds).toHaveLength(count);
  view.dispose();
}, 30000);

it('admits the actual aggregate capacity and rejects one extra original artwork without changing control limits', () => {
  const p = fixture(),
    art = p.symbols![0].shapes[0];
  p.symbols![0].shapes = Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
    ...art,
    id: 's' + i,
  }));
  const { view, owner } = operation(p);
  expect(prepare([{ owner, target: target(owner) }]).symbols![0].shapes).toHaveLength(
    MAX_SYMBOL_ARTWORK,
  );
  view.dispose();
  p.symbols![0].shapes.push({ ...art, id: 'overflow' });
  expect(() => operation(p)).toThrow(/budget/);
}, 60000);

for (const mode of ['getter', 'nonfinite', 'parent', 'order', 'orbit', 'depth'])
  it(`rejects original ${mode} source before private group identity escapes`, () => {
    const p = fixture();
    let reads = 0;
    if (mode === 'getter')
      Object.defineProperty(p.layers[0].keys[0].shapes[0], 'groups', {
        enumerable: true,
        get() {
          reads++;
          return ['outer'];
        },
      });
    if (mode === 'nonfinite') p.layers[0].keys[0].shapes[0].x = NaN;
    if (mode === 'parent') p.layers[0].keys[1].shapes[0].groups = ['different', 'inner'];
    if (mode === 'order') p.layers[0].keys[1].shapes.reverse();
    if (mode === 'orbit') p.layers[0].liveMotionSpans![0].rotation!.savedGroupPivots = true;
    if (mode === 'depth') p.layers[0].liveMotionSpans![0].rotation!.groupDepth = 1;
    expect(() => operation(p)).toThrow();
    expect(reads).toBe(0);
  });

import { afterEach, expect, it, vi } from 'vitest';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import { MAX_SYMBOL_ARTWORK, validateProject, type Project } from '../packages/document/src';
import {
  captureLiveGroupMotionAuthoringFrame as capture,
  prepareLiveGroupRestrictedArcGeometry as prepare,
  prepareSplitLiveGroupMotionSpans as publishSplit,
  type LiveGroupOwner,
} from '../packages/animation/src/live-group-motion-owner';
import { bindRestrictedArcGeometry } from '../packages/animation/src/restricted-arc-geometry';
import { prepareIndependentGroupPath } from '../packages/animation/src/independent-group-path';
import { motionProgress } from '../packages/animation/src/motion-frames';
import type { MotionEase } from '../packages/document/src/motion-ease';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(basis = 'plain', coincident = true) {
  const { p } = liveRotationFixture('rigid', basis, true),
    layer = p.layers[0];
  for (const group of ['outer', 'second']) {
    const members = layer.keys[0].shapes.filter((s) => s.groups?.[0] === group);
    if (coincident) {
      members[1].x = members[0].x;
      members[1].y = members[0].y;
    }
  }
  layer.keys[1].shapes = layer.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 96,
    y: s.y + 24,
  }));
  const span = layer.liveMotionSpans![0];
  delete span.path;
  span.groupPaths = ['outer', 'second'].map((groupId) => ({
    groupId,
    composition: 'additive',
    path: { startX: 32, startY: -40, endX: -32, endY: -24, distance: true, tangent: false },
  }));
  return p;
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const frame of [2, 4, 6])
    it(`privately prepares asymmetric ${basis} geometry at frame ${frame} without publishing unsupported recipes`, () => {
      const p = fixture(basis),
        before = structuredClone(p),
        scope = capture(() => ({ project: p, frame, revision: 3 }));
      const owner = scope.resolve('track', 'outer'),
        output = prepare([owner]);
      expect(output).toHaveLength(1);
      expect(output[0].bindings).toHaveLength(2);
      for (const binding of output[0].bindings) {
        const span = p.layers[0].liveMotionSpans![0],
          bank = span.groupPaths!.find((b) => b.groupId === binding.groupId)!;
        const route = prepareIndependentGroupPath(p.layers[0], span, bank).route;
        for (const [side, half] of binding.halves.entries()) {
          const bound = bindRestrictedArcGeometry(JSON.parse(JSON.stringify(half)));
          for (let i = 0; i <= 32; i++) {
            const fraction = frame / 8,
              t = side ? fraction + ((1 - fraction) * i) / 32 : (fraction * i) / 32;
            const point = bound.sample(i / 32),
              expected = route(t);
            expect(point.x).toBeCloseTo(expected.x, 10);
            expect(point.y).toBeCloseTo(expected.y, 10);
          }
        }
      }
      expect(() => publishSplit([{ owner, rightSpanId: 'still-unsupported' }])).toThrow(
        /arc correspondence/,
      );
      expect(p).toEqual(before);
      scope.dispose();
    });
it('uses private membership/poses despite forged public scenes and keeps output detached', () => {
  const p = fixture(),
    scope = capture(() => ({ project: p, frame: 4, revision: 0 }));
  scope.scene[0].key.shapes[0].x += 999;
  const owner = scope.resolve('track', 'outer'),
    first = prepare([owner]);
  first[0].middle[0].fill = '#0000ff';
  first[0].bindings[0].halves[0].cubic[1].x++;
  const second = prepare([owner]);
  expect(second[0].middle[0].fill).toBe('#ff0000');
  expect(second[0].bindings[0].halves[0].cubic).not.toEqual(first[0].bindings[0].halves[0].cubic);
  expect(() => prepare([{ ...owner }])).toThrow(/private/);
  scope.dispose();
});
for (const ease of [
  'in',
  'out',
  'in-out',
  { kind: 'cubic', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
] satisfies MotionEase[])
  it(`checks every integer restricted route in original eased progress ${JSON.stringify(ease)}`, () => {
    const p = fixture('reflected');
    p.layers[0].liveMotionSpans![0].ease = ease;
    const before = structuredClone(p),
      scope = capture(() => ({ project: p, frame: 4, revision: 0 }));
    const out = prepare([scope.resolve('track', 'outer')]);
    expect(out[0].bindings[0].halves[0].descriptor.to).toBe(motionProgress(0.5, ease));
    expect(p).toEqual(before);
    scope.dispose();
  });
it('prepares all requested tracks together and rejects a later unsupported bank atomically', () => {
  const p = fixture();
  secondRotationTrack(p);
  let scope = capture(() => ({ project: p, frame: 4, revision: 0 }));
  expect(prepare([scope.resolve('track', 'outer'), scope.resolve('later', 'second')])).toHaveLength(
    2,
  );
  scope.dispose();
  p.layers[1].liveMotionSpans![0].groupPaths![1].path.waypoints = [{ x: 45, y: 20 }];
  validateProject(p);
  const before = structuredClone(p);
  scope = capture(() => ({ project: p, frame: 4, revision: 0 }));
  expect(() =>
    prepare([scope.resolve('track', 'outer'), scope.resolve('later', 'second')]),
  ).toThrow(/single independent/);
  expect(p).toEqual(before);
  scope.dispose();
});
it('rejects raw request/admission getters, missing owners and asynchronous admission', () => {
  const p = fixture(),
    scope = capture(() => ({ project: p, frame: 4, revision: 0 })),
    owner = scope.resolve('track', 'outer');
  let reads = 0;
  const options = Object.defineProperty({}, 'validate', {
    enumerable: true,
    get() {
      reads++;
      return () => {};
    },
  });
  expect(() => prepare([owner], options)).toThrow();
  expect(reads).toBe(0);
  const requests = new Array<LiveGroupOwner>(1);
  expect(() => prepare(requests)).toThrow();
  expect(() => prepare([owner], { validate: () => Promise.resolve() })).toThrow(/synchronously/);
  expect(prepare([owner])).toHaveLength(1);
  scope.dispose();
});
for (const change of ['frame', 'revision', 'dispose'] as const)
  it(`rejects an original owner after ${change} changes`, () => {
    const p = fixture(),
      before = structuredClone(p),
      state = { project: p, frame: 4, revision: 0 };
    const scope = capture(() => state),
      owner = scope.resolve('track', 'outer');
    if (change === 'dispose') scope.dispose();
    else state[change]++;
    expect(() => prepare([owner])).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
  });
it('rejects crossed capture scopes and duplicate tracks without consuming valid captures', () => {
  const p = fixture();
  secondRotationTrack(p);
  const a = capture(() => ({ project: p, frame: 4, revision: 0 })),
    b = capture(() => ({ project: p, frame: 4, revision: 0 }));
  const first = a.resolve('track', 'outer');
  expect(() => prepare([first, b.resolve('later', 'outer')])).toThrow(/scopes/);
  expect(() => prepare([first, first])).toThrow(/once/);
  expect(prepare([first, a.resolve('later', 'outer')])).toHaveLength(2);
  a.dispose();
  b.dispose();
});
it('retains exact promoted member-displacement rejection instead of normalizing original poses', () => {
  const p = fixture('reflected', false);
  for (const [i, shape] of p.layers[0].keys[1].shapes.entries())
    shape.y = p.layers[0].keys[0].shapes[i].y;
  for (const bank of p.layers[0].liveMotionSpans![0].groupPaths!) {
    bank.path.startY = 8;
    bank.path.endY = 8;
  }
  const before = structuredClone(p);
  let rejected = 0;
  for (const frame of [2, 4, 6]) {
    const scope = capture(() => ({ project: p, frame, revision: 0 }));
    const middle = scope.scene.find((s) => s.layerId === 'track')!.key.shapes;
    const first = p.layers[0].keys[0].shapes,
      last = p.layers[0].keys[1].shapes;
    const mismatch = ['outer', 'second'].some((group) => {
      const indices = first.flatMap((s, i) => (s.groups?.[0] === group ? [i] : [])),
        leader = indices[0];
      return indices.some(
        (i) =>
          middle[i].x - first[i].x !== middle[leader].x - first[leader].x ||
          middle[i].y - first[i].y !== middle[leader].y - first[leader].y ||
          last[i].x - middle[i].x !== last[leader].x - middle[leader].x ||
          last[i].y - middle[i].y !== last[leader].y - middle[leader].y,
      );
    });
    if (mismatch) {
      expect(() => prepare([scope.resolve('track', 'outer')])).toThrow(/member displacement/);
      rejected++;
    }
    scope.dispose();
  }
  expect(rejected).toBeGreaterThan(0);
  expect(p).toEqual(before);
});
it('shares reentry poisoning with the existing document-split preparer', () => {
  const p = fixture(),
    scope = capture(() => ({ project: p, frame: 4, revision: 0 })),
    owner = scope.resolve('track', 'outer');
  let called = false;
  expect(() =>
    prepare([owner], {
      validate() {
        if (!called) {
          called = true;
          try {
            publishSplit([{ owner, rightSpanId: 'right' }]);
          } catch {
            /* Reentry must poison the original transaction. */
          }
        }
      },
    }),
  ).toThrow(/reentered/);
  expect(called).toBe(true);
  expect(prepare([owner])).toHaveLength(1);
  scope.dispose();
});
it('rechecks private owner identity after source reads even when public owner fields stay identical', () => {
  const p = fixture();
  let armed = false,
    fired = false;
  let requests: LiveGroupOwner[] = [];
  const scope = capture(() => {
    if (armed) {
      armed = false;
      fired = true;
      requests[0] = replacement;
    }
    return { project: p, frame: 4, revision: 0 };
  });
  const owner = scope.resolve('track', 'outer');
  const replacement = scope.resolve('track', 'outer');
  requests = [owner];
  expect(() =>
    prepare(requests, {
      validate() {
        if (!fired) armed = true;
      },
    }),
  ).toThrow(/requests changed/);
  expect(fired).toBe(true);
  expect(requests[0]).toBe(replacement);
  expect(prepare([replacement])).toHaveLength(1);
  scope.dispose();
});
it('admits actual original aggregate library capacity without a lower staging cap and rejects original overflow', () => {
  const p = fixture(),
    layer = p.layers[0];
  for (const key of layer.keys) key.shapes = key.shapes.filter((s) => s.groups?.[0] === 'outer');
  layer.liveMotionSpans![0].groupPaths = [layer.liveMotionSpans![0].groupPaths![0]];
  const art = { ...p.symbols![0].shapes[0] };
  delete art.transform;
  delete art.pivot;
  delete art.opacity;
  p.symbols![0].shapes = Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
    ...art,
    id: `capacity${i}`,
    points: [],
  }));
  const scope = capture(() => ({ project: p, frame: 4, revision: 0 }));
  expect(prepare([scope.resolve('track', 'outer')])[0].middle).toHaveLength(2);
  expect(p.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  expect(layer.keys).toHaveLength(3);
  scope.dispose();
  p.symbols![0].shapes.push({ ...art, id: 'overflow', points: [] });
  expect(() => capture(() => ({ project: p, frame: 4, revision: 0 }))).toThrow(/budget/);
}, 120000);
for (const action of ['source', 'library', 'reentry', 'output', 'half', 'middle', 'probe'] as const)
  it(`rejects real late ${action} edits and retains source-valid retries`, () => {
    const p = fixture(),
      scope = capture(() => ({ project: p, frame: 4, revision: 0 })),
      owner = scope.resolve('track', 'outer');
    const clone = structuredClone;
    let fired = false,
      late = false,
      sawHalf = false;
    let half:
      import('../packages/animation/src/restricted-arc-geometry').RestrictedArcGeometry | undefined;
    let middle: Project['layers'][number]['keys'][number]['shapes'] | undefined,
      probe: Project | undefined;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value),
        data = value as { geometry?: unknown; middle?: unknown },
        rows = out as ReturnType<typeof prepare>;
      const g = value as typeof half;
      if (g?.descriptor && g.cubic && (g.descriptor.from > 0 || g.descriptor.to < 1)) {
        sawHalf = true;
        half ??= g;
      }
      if (!probe && (out as Project)?.layers) probe = out as Project;
      if (sawHalf && !middle && Array.isArray(out) && out[0]?.kind) middle = out;
      if (
        !fired &&
        (action === 'output'
          ? Array.isArray(rows) && rows[0]?.bindings
          : data?.geometry && data?.middle)
      ) {
        if (['source', 'library', 'reentry', 'output'].includes(action)) {
          fired = true;
          if (action === 'source') p.name = 'Separate source';
          if (action === 'library') p.symbols![0].name = 'Separate library';
          if (action === 'reentry') {
            try {
              prepare([owner]);
            } catch {
              /* Outer admission remembers swallowed reentry. */
            }
          }
          if (action === 'output') rows[0].middle[0].x++;
        }
      }
      return out;
    });
    const options = {
      validate() {
        if (late) return;
        if (action === 'half' && half) {
          fired = late = true;
          half.cubic[1].x++;
        }
        if (action === 'middle' && middle) {
          fired = late = true;
          middle[0].fill = '#0000ff';
        }
        if (action === 'probe' && probe && sawHalf) {
          fired = late = true;
          probe.name = 'Forged probe';
        }
      },
    };
    expect(() => prepare([owner], options)).toThrow();
    expect(fired).toBe(true);
    if (['half', 'middle', 'probe'].includes(action)) expect(late).toBe(true);
    expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
    if (!['source', 'library'].includes(action)) {
      vi.unstubAllGlobals();
      expect(prepare([owner])).toHaveLength(1);
    }
    scope.dispose();
  });

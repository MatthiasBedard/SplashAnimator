import { afterEach, expect, it, vi } from 'vitest';
import { recursiveRestrictedArcProject } from './recursive-restricted-arc-fixture';
import { motionProgress } from '../packages/animation/src/motion-frames';
import { restrictedArcProject } from './restricted-arc-project-fixture';
import {
  MAX_SYMBOL_ARTWORK,
  migrateProject,
  validateProject,
  type Project,
} from '../packages/document/src';
import {
  captureLiveGroupMotionAuthoringFrame as capture,
  prepareRestrictedArcLiveGroupMotionSpans as initial,
  prepareRecursiveRestrictedArcLiveGroupMotionSpans as recursive,
  prepareSplitLiveGroupMotionSpans as legacy,
  type LiveGroupSplitRequest,
} from '../packages/animation/src/live-group-motion-owner';
import { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { prepareIndependentGroupPath } from '../packages/animation/src/independent-group-path';

afterEach(() => vi.unstubAllGlobals());
function source(basis = 'plain', turning = false, offset = 0) {
  const { p } = restrictedArcProject(basis);
  // A separately authored monotone cubic with nonuniform distance timing.
  // The earlier turning curve remains an explicit unresolved-case fixture.
  if (!turning)
    for (const bank of p.layers[0].liveMotionSpans![0].groupPaths!)
      bank.path = { startX: 16, startY: 8, endX: -16, endY: -8, distance: true };
  for (const key of p.layers[0].keys) for (const shape of key.shapes) shape.y += offset;
  const op = operation(p, 4, 'initial-right');
  try {
    return { original: p, p: initial(op.requests) };
  } finally {
    op.scope.dispose();
  }
}
function operation(p: Project, frame: number, id = 'recursive-right') {
  const scope = capture(() => ({ project: p, revision: 0, frame }));
  const requests: LiveGroupSplitRequest[] = [
    { owner: scope.resolve('track', 'outer'), rightSpanId: id },
  ];
  return { scope, requests };
}
function equivalent(p: Project, q: Project) {
  const a = captureLiveMotionTimeline(() => ({ project: p, revision: 0 }));
  const b = captureLiveMotionTimeline(() => ({ project: q, revision: 0 }));
  try {
    for (let frame = 0; frame < p.duration; frame++)
      expect(
        sameMotionArtwork(
          a.sample(frame).map((t) => t.key.shapes),
          b.sample(frame).map((t) => t.key.shapes),
        ),
        `frame ${frame}`,
      ).toBe(true);
  } finally {
    a.dispose();
    b.dispose();
  }
}
it('rejects changing width without the saved option and invalid source widths', () => {
  const {p}=recursiveRestrictedArcProject('plain',{varyStroke:true,varyColor:true});
  const span=p.layers[0].liveMotionSpans![0];
  for(const [enabled,width] of [[false,18],[true,201]] as const) {
    span.options={...span.options,strokeWidth:enabled};
    p.layers[0].keys[1].shapes[0].strokeWidth=width;
    const before=structuredClone(p);
    expect(()=>{
      const op=operation(p,4);
      try { initial(op.requests); } finally { op.scope.dispose(); }
    }).toThrow();
    expect(p).toEqual(before);
  }
});

it('rejects a nonlinear paint clock before publishing a changing solid color', () => {
  const {p}=recursiveRestrictedArcProject('plain',{varyColor:true});
  p.layers[0].liveMotionSpans![0].paintEase='in';
  const source=structuredClone(p), op=operation(p,4);
  try {
    expect(()=>initial(op.requests)).toThrow(/linear paint timing/);
    expect(p).toEqual(source);
  } finally { op.scope.dispose(); }
});

for (const accelerate of [false,true]) it(`retains original fractional travel and fading opacity after cuts on both sides, acceleration ${accelerate}`, () => {
  const {p,r} = recursiveRestrictedArcProject('reflected',{fade:true,accelerate,varyStroke:true,varyColor:true});
  equivalent(p,r);
  const original=p.layers[0], layer=r.layers[0], span=original.liveMotionSpans![0];
  const route=prepareIndependentGroupPath(original,span,span.groupPaths![0]).route;
  for (const half of layer.liveMotionSpans!) {
    const first=layer.keys.find(k=>k.frame===half.start)!.shapes[0];
    const last=layer.keys.find(k=>k.frame===half.end)!.shapes[0];
    expect(half.options).toEqual(span.options);
    const halfRoute=prepareIndependentGroupPath(layer,half,half.groupPaths![0]).route;
    for(let i=0;i<=32;i++) {
      const t=i/32, u=(half.start+(half.end-half.start)*t)/8;
      const alpha=motionProgress(t,half.opacityEase!), from=first.opacity??1;
      expect(from+((last.opacity??1)-from)*alpha).toBeCloseTo(1-0.75*(2*u-u*u),10);
      const progress=motionProgress(t,half.ease), originalProgress=accelerate ? u*u : u;
      expect(first.strokeWidth+(last.strokeWidth-first.strokeWidth)*progress).toBeCloseTo(2+16*originalProgress,10);
      const startColor=layer.keys.find(k=>k.frame===half.start)!.shapes.find(s=>s.id==='loose')!;
      const endColor=layer.keys.find(k=>k.frame===half.end)!.shapes.find(s=>s.id==='loose')!;
      for(const field of ['fill','stroke'] as const) {
        const endpoints=[span.start,span.end].map(frame=>original.keys.find(k=>k.frame===frame)!.shapes.find(s=>s.id==='loose')![field]);
        for(const at of [1,3,5]) {
          const byte=(rgb:string)=>parseInt(rgb.slice(at,at+2),16);
          expect(Math.round(byte(startColor[field])*(1-t)+byte(endColor[field])*t))
            .toBe(Math.round(byte(endpoints[0])*(1-u)+byte(endpoints[1])*u));
        }
      }
      const a=route(originalProgress), b=halfRoute(progress);
      expect(first.x+b.x).toBeCloseTo(original.keys[0].shapes[0].x+a.x,9);
      expect(first.y+b.y).toBeCloseTo(original.keys[0].shapes[0].y+a.y,9);
    }
  }
  expect(layer.keys[0]).toEqual(original.keys[0]);
  expect(layer.keys.at(-1)).toEqual(original.keys.at(-1));
});

for (const basis of ['plain', 'affine', 'reflected'])
  for (const frame of [2, 6])
    it(`recursively prepares ${basis} persisted half at ${frame} with original descriptors and exact keys`, () => {
      const { original, p } = source(basis),
        before = structuredClone(p),
        op = operation(p, frame);
      const q = recursive(op.requests);
      op.scope.dispose();
      validateProject(q);
      equivalent(original, q);
      equivalent(p, q);
      expect(p).toEqual(before);
      expect(q.layers[0].keys.filter((k) => k.frame !== frame)).toEqual(p.layers[0].keys);
      expect(q.layers[0].liveMotionSpans).toHaveLength(3);
      expect(q.symbols).toEqual(p.symbols);
      expect(q.assets).toEqual(p.assets);
      const parentSpan = p.layers[0].liveMotionSpans!.find(
        (s) => frame > s.start && frame < s.end,
      )!;
      for (const child of q.layers[0].liveMotionSpans!.filter(
        (s) => s.start >= parentSpan.start && s.end <= parentSpan.end,
      )) {
        expect(child.options).toEqual(parentSpan.options);
        expect(child.rotation).toEqual(parentSpan.rotation);
        for (const [i, binding] of child.groupPaths!.entries()) {
          expect(binding.restrictedArc!.descriptor.cubic).toEqual(
            parentSpan.groupPaths![i].restrictedArc!.descriptor.cubic,
          );
          const parent = prepareIndependentGroupPath(
            p.layers[0],
            parentSpan,
            parentSpan.groupPaths![i],
          );
          const half = prepareIndependentGroupPath(q.layers[0], child, binding);
          const first = p.layers[0].keys
            .find((k) => k.frame === parentSpan.start)!
            .shapes.find((s) => s.id === parent.ids[0])!;
          const base = q.layers[0].keys
            .find((k) => k.frame === child.start)!
            .shapes.find((s) => s.id === half.ids[0])!;
          for (let j = 0; j <= 256; j++) {
            const t = j / 256,
              u =
                (child.start - parentSpan.start + t * (child.end - child.start)) /
                (parentSpan.end - parentSpan.start);
            const a = parent.route(u),
              b = half.route(t);
            expect(
              sameMotionArtwork(
                { x: first.x + a.x, y: first.y + a.y },
                { x: base.x + b.x, y: base.y + b.y },
              ),
            ).toBe(true);
          }
        }
      }
      equivalent(original, migrateProject(JSON.parse(JSON.stringify(q))));
    });

it('can split both reopened halves without changing the original absolute clock windows', () => {
  const { original, p } = source();
  const first = operation(p, 2);
  const q = recursive(first.requests);
  first.scope.dispose();
  const reopened = migrateProject(JSON.parse(JSON.stringify(q))),
    second = operation(reopened, 6, 'fourth');
  const out = recursive(second.requests);
  second.scope.dispose();
  expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 4, 6, 8, 10]);
  expect(
    out.layers[0].liveMotionSpans!.map((s) => [
      s.groupPaths![0].restrictedArc!.descriptor.from,
      s.groupPaths![0].restrictedArc!.descriptor.to,
    ]),
  ).toEqual([
    [0, 0.25],
    [0.25, 0.5],
    [0.5, 0.75],
    [0.75, 1],
  ]);
  equivalent(original, out);
});

for (const frame of [2, 6])
  it(`${frame === 2 ? 'rejects unresolved' : 'retains'} third-generation original clock window at ${frame} after reopen`, () => {
    const original = restrictedArcProject().p;
    original.duration = 20;
    original.layers[0].keys[1].frame = 16;
    original.layers[0].keys[2].frame = 18;
    original.layers[0].liveMotionSpans![0].end = 16;
    for (const bank of original.layers[0].liveMotionSpans![0].groupPaths!)
      bank.path = { startX: 16, startY: 8, endX: -16, endY: -8, distance: true };
    const a = operation(original, 8, 'half');
    const halves = initial(a.requests);
    a.scope.dispose();
    const b = operation(halves, 4, 'quarter');
    const quarters = recursive(b.requests);
    b.scope.dispose();
    const reopened = migrateProject(JSON.parse(JSON.stringify(quarters))),
      c = operation(reopened, frame, 'eighth');
    if (frame === 2) {
      const before = structuredClone(reopened);
      expect(() => recursive(c.requests)).toThrow(/Restricted arc controls/);
      expect(reopened).toEqual(before);
      c.scope.dispose();
      return;
    }
    const out = recursive(c.requests);
    c.scope.dispose();
    validateProject(out);
    equivalent(original, out);
    const rootSpan = original.layers[0].liveMotionSpans![0],
      root = prepareIndependentGroupPath(original.layers[0], rootSpan, rootSpan.groupPaths![0]);
    const origin = original.layers[0].keys[0].shapes[0];
    for (const span of out.layers[0].liveMotionSpans!) {
      const binding = span.groupPaths![0],
        plan = prepareIndependentGroupPath(out.layers[0], span, binding);
      expect(binding.restrictedArc!.descriptor.cubic).toEqual(
        halves.layers[0].liveMotionSpans![0].groupPaths![0].restrictedArc!.descriptor.cubic,
      );
      expect([
        binding.restrictedArc!.descriptor.from,
        binding.restrictedArc!.descriptor.to,
      ]).toEqual([span.start / 16, span.end / 16]);
      const base = out.layers[0].keys.find((k) => k.frame === span.start)!.shapes[0];
      for (let i = 0; i <= 256; i++) {
        const t = i / 256,
          expected = root.route((span.start + (span.end - span.start) * t) / 16),
          actual = plan.route(t);
        expect(
          sameMotionArtwork(
            { x: origin.x + expected.x, y: origin.y + expected.y },
            { x: base.x + actual.x, y: base.y + actual.y },
          ),
        ).toBe(true);
      }
    }
  });

it('retains legacy and first-generation API rejection of persisted timing and rejects ordinary sources on the new route', () => {
  const { p, original } = source(),
    a = operation(p, 2),
    b = operation(original, 4);
  expect(() => legacy(a.requests)).toThrow();
  expect(() => initial(a.requests)).toThrow();
  expect(() => recursive(b.requests)).toThrow(/persisted/);
  a.scope.dispose();
  b.scope.dispose();
});

for (const turning of [false, true])
  it(`retains unresolved translated ${turning ? 'turning' : 'monotone'} geometry and permits another original half`, () => {
    const { p } = source('plain', turning, 80),
      before = structuredClone(p),
      op = operation(p, 2);
    expect(() => recursive(op.requests)).toThrow(/Restricted arc controls/);
    expect(p).toEqual(before);
    op.scope.dispose();
    const fresh = operation(p, 6);
    const q = recursive(fresh.requests);
    fresh.scope.dispose();
    equivalent(p, q);
  });

for (const bad of ['mixed', 'shared', 'ease', 'artwork', 'symbol', 'overflow'] as const)
  it(`rejects original ${bad} without partial mutation`, () => {
    const { p } = source();
    const span = p.layers[0].liveMotionSpans![0];
    if (bad === 'mixed') delete span.groupPaths![1].restrictedArc;
    if (bad === 'shared') span.path = { startX: 0, startY: 10, endX: 0, endY: 10 };
    if (bad === 'ease') {
      // A longer saved half admits an interior cut away from the ease-in-out midpoint.
      p.duration *= 2;
      for (const key of p.layers[0].keys) key.frame *= 2;
      for (const recipe of p.layers[0].liveMotionSpans!) {
        recipe.start *= 2;
        recipe.end *= 2;
      }
      span.ease = 'in-out';
    }
    if (bad === 'artwork') p.layers[0].keys[1].shapes[0].fill = '#222222';
    if (bad === 'symbol') p.layers[0].keys[0].shapes[4].kind = 'symbol';
    if (bad === 'overflow') span.groupPaths![0].restrictedArc!.origin.x = Number.MAX_VALUE;
    const before = structuredClone(p);
    expect(() => {
      const op = operation(p, 2);
      try {
        recursive(op.requests);
      } finally {
        op.scope.dispose();
      }
    }).toThrow();
    expect(p).toEqual(before);
  });

it('prepares two original tracks atomically and rejects an inadmissible later request', () => {
  const { p } = source();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'later', name: 'Later' });
  const before = structuredClone(p),
    op = operation(p, 2);
  op.requests.push({ owner: op.scope.resolve('later', 'second'), rightSpanId: 'later-right' });
  const q = recursive(op.requests);
  expect(q.layers.every((l) => l.keys.some((k) => k.frame === 2))).toBe(true);
  expect(p).toEqual(before);
  equivalent(p, q);
  op.scope.dispose();
  p.layers[1].keys[1].shapes[0].fill = '#336699';
  const invalid = structuredClone(p),
    next = operation(p, 2);
  next.requests.push({ owner: next.scope.resolve('later', 'second'), rightSpanId: 'later-right' });
  expect(() => recursive(next.requests)).toThrow(/round a promoted color/);
  expect(p).toEqual(invalid);
  next.scope.dispose();
});

for (const bad of [NaN, Infinity, -Infinity])
  it(`rejects raw original nonfinite ${bad} without normalization`, () => {
    const { p } = source();
    p.layers[0].liveMotionSpans![0].groupPaths![0].restrictedArc!.descriptor.cubic[1].x = bad;
    expect(() => operation(p, 2)).toThrow();
    expect(
      Object.is(
        p.layers[0].liveMotionSpans![0].groupPaths![0].restrictedArc!.descriptor.cubic[1].x,
        bad,
      ),
    ).toBe(true);
  });

it('does not read raw request getters or consume original ownership after rejection', () => {
  const { p } = source(),
    op = operation(p, 2);
  let reads = 0;
  const bad = {
    owner: op.requests[0].owner,
    get rightSpanId() {
      reads++;
      return 'getter';
    },
  };
  expect(() => recursive([bad])).toThrow();
  expect(reads).toBe(0);
  expect(() => recursive([{ ...op.requests[0], owner: { ...op.requests[0].owner } }])).toThrow(
    /private/,
  );
  expect(recursive(op.requests).layers[0].liveMotionSpans).toHaveLength(3);
  op.scope.dispose();
});

for (const stale of ['revision', 'frame', 'source', 'disposed'] as const)
  it(`rejects ${stale} private ownership`, () => {
    let { p } = source(),
      revision = 0,
      frame = 2;
    const scope = capture(() => ({ project: p, revision, frame }));
    const request = { owner: scope.resolve('track', 'outer'), rightSpanId: 'late' };
    if (stale === 'revision') revision++;
    if (stale === 'frame') frame = 6;
    if (stale === 'source') p = structuredClone(p);
    if (stale === 'disposed') scope.dispose();
    expect(() => recursive([request])).toThrow();
    scope.dispose();
  });

for (const change of ['source', 'request', 'output'] as const)
  it(`rejects actual late ${change} after a complete recursive candidate exists`, () => {
    const { p } = source(),
      before = structuredClone(p),
      op = operation(p, 2),
      clone = structuredClone;
    let candidate: Project | undefined,
      fired = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value),
        q = out as Project;
      if (q?.layers?.[0]?.liveMotionSpans?.length === 3) candidate = q;
      return out;
    });
    expect(() =>
      recursive(op.requests, {
        validate() {
          if (!candidate || fired) return;
          fired = true;
          if (change === 'source') p.name = 'Independent edit';
          if (change === 'request') op.requests[0].rightSpanId = 'Changed input';
          if (change === 'output') candidate.layers[0].keys[1].shapes[0].fill = '#123456';
        },
      }),
    ).toThrow();
    expect(fired).toBe(true);
    vi.unstubAllGlobals();
    op.scope.dispose();
    expect(p).toEqual(change === 'source' ? { ...before, name: 'Independent edit' } : before);
    const fresh = operation(p, 2);
    expect(recursive(fresh.requests).layers[0].liveMotionSpans).toHaveLength(3);
    fresh.scope.dispose();
  });

for (const route of ['recursive', 'initial', 'legacy'] as const)
  it(`poisons swallowed recursive/${route} preparation reentry and permits a fresh operation`, () => {
    const { p } = source(),
      before = structuredClone(p),
      op = operation(p, 2);
    let fired = false;
    expect(() =>
      recursive(op.requests, {
        validate() {
          if (fired) return;
          fired = true;
          try {
            ({ recursive, initial, legacy })[route](op.requests);
          } catch {
            /* Outer preparation must also reject. */
          }
        },
      }),
    ).toThrow(/reenter|changed/);
    expect(fired).toBe(true);
    expect(p).toEqual(before);
    expect(recursive(op.requests).layers[0].liveMotionSpans).toHaveLength(3);
    op.scope.dispose();
  });

for (const alias of ['root', 'layers', 'artwork', 'output'] as const)
  it(`rejects ${alias} clone aliases without mutating the source`, () => {
    const { p } = source(),
      before = structuredClone(p),
      op = operation(p, 2),
      clone = structuredClone;
    let fired = false;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v),
        q = v as Project;
      if (q === p) {
        if (alias === 'root') {
          fired = true;
          return p;
        }
        if (alias === 'layers') {
          fired = true;
          (out as Project).layers = p.layers;
        }
        if (alias === 'artwork') {
          fired = true;
          (out as Project).layers[0].keys[0].shapes = p.layers[0].keys[0].shapes;
        }
      }
      if (alias === 'output' && q?.layers?.[0]?.liveMotionSpans?.length === 3) {
        fired = true;
        return v;
      }
      return out;
    });
    expect(() => recursive(op.requests)).toThrow();
    expect(fired).toBe(true);
    expect(p).toEqual(before);
    vi.unstubAllGlobals();
    op.scope.dispose();
  });

it('returns detached output, preserves current source and permits reopening for later edits', () => {
  const { p } = source(),
    before = structuredClone(p),
    op = operation(p, 2);
  const a = recursive(op.requests),
    b = recursive(op.requests);
  op.scope.dispose();
  expect(a).toEqual(b);
  a.layers[0].keys[1].shapes[0].points.push({ x: 10, y: 20 });
  expect(p).toEqual(before);
  expect(a).not.toEqual(b);
  const reopened = migrateProject(JSON.parse(JSON.stringify(b))),
    next = operation(reopened, 6, 'last');
  const out = recursive(next.requests);
  next.scope.dispose();
  equivalent(p, out);
});

for (const basis of ['plain', 'affine', 'reflected'])
  it(`retains ${basis} compound contours, absent pivots and private nested membership`, () => {
    const { p } = source(basis);
    for (const key of p.layers[0].keys)
      for (const s of key.shapes) {
        delete s.pivot;
        if (s.id === 'a')
          Object.assign(s, {
            kind: 'polygon',
            fillRule: 'evenodd',
            contours: [
              [
                { x: 0, y: 0 },
                { x: 12, y: 0 },
                { x: 12, y: 10 },
                { x: 0, y: 10 },
              ],
              [
                { x: 3, y: 3 },
                { x: 7, y: 3 },
                { x: 7, y: 7 },
                { x: 3, y: 7 },
              ],
            ],
          });
      }
    const before = structuredClone(p),
      op = operation(p, 2);
    op.scope.scene[0].key.shapes[0].x += 999;
    const q = recursive(op.requests);
    op.scope.dispose();
    expect(p).toEqual(before);
    equivalent(p, q);
    expect(q.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].contours).toEqual(
      p.layers[0].keys[0].shapes[0].contours,
    );
    expect(q.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].groups).toEqual([
      'outer',
      'inner',
    ]);
    expect(q.layers[0].keys.every((k) => k.shapes.every((s) => !Object.hasOwn(s, 'pivot')))).toBe(
      true,
    );
  });

it('admits the actual library artwork capacity and rejects a late completed recursive output overflow', () => {
  const { p } = source();
  p.symbols![0].shapes = Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
    id: `stored-${i}`,
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  }));
  const op = operation(p, 2),
    q = recursive(op.requests);
  expect(q.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  const clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = clone(value),
      data = out as Project;
    if (
      data?.layers?.[0]?.liveMotionSpans?.length === 3 &&
      data.symbols?.[0]?.shapes.length === MAX_SYMBOL_ARTWORK
    ) {
      fired = true;
      data.symbols[0].shapes.push({ ...data.symbols[0].shapes[0], id: 'overflow' });
    }
    return out;
  });
  expect(() => recursive(op.requests)).toThrow(/artwork budget/);
  expect(fired).toBe(true);
  expect(p.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  expect(p.layers[0].keys).toHaveLength(4);
  op.scope.dispose();
}, 120000);

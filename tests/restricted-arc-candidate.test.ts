import { afterEach, expect, it, vi } from 'vitest';
import { restrictedArcProject } from './restricted-arc-project-fixture';
import { secondRotationTrack } from './live-motion-rotation-fixture';
import {
  MAX_SYMBOL_ARTWORK,
  migrateProject,
  validateProject,
  type Project,
} from '../packages/document/src';
import {
  captureLiveGroupMotionAuthoringFrame as capture,
  prepareRestrictedArcLiveGroupMotionSpans as prepare,
  prepareSplitLiveGroupMotionSpans as legacy,
  type LiveGroupSplitRequest,
} from '../packages/animation/src/live-group-motion-owner';
import { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { prepareIndependentGroupPath } from '../packages/animation/src/independent-group-path';
import { splitRestrictedArcLiveGroupMotionLayer } from '../packages/animation/src/live-group-motion-split';

afterEach(() => vi.unstubAllGlobals());
function operation(p = restrictedArcProject().p, frame = 4) {
  const scope = capture(() => ({ project: p, revision: 0, frame })),
    requests: LiveGroupSplitRequest[] = [
      { owner: scope.resolve('track', 'outer'), rightSpanId: 'right' },
    ];
  return { p, scope, requests };
}
function equivalent(p: Project, q: Project) {
  const a = captureLiveMotionTimeline(() => ({ project: p, revision: 0 })),
    b = captureLiveMotionTimeline(() => ({ project: q, revision: 0 }));
  try {
    for (let f = 0; f < p.duration; f++)
      expect(
        sameMotionArtwork(
          a.sample(f).map((t) => t.key.shapes),
          b.sample(f).map((t) => t.key.shapes),
        ),
        `frame ${f}`,
      ).toBe(true);
  } finally {
    a.dispose();
    b.dispose();
  }
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const frame of [2, 4, 6])
    it(`prepares complete ${basis} two-sided original-clock Project at ${frame}`, () => {
      const { p } = restrictedArcProject(basis),
        offset = frame === 2 ? 80 : 0;
      if (offset)
        for (const key of p.layers[0].keys) for (const shape of key.shapes) shape.y += offset;
      const before = structuredClone(p),
        s = operation(p, frame),
        q = prepare(s.requests);
      validateProject(q);
      equivalent(p, q);
      expect(p).toEqual(before);
      expect(q.layers[0].keys.filter((k) => k.frame !== frame)).toEqual(before.layers[0].keys);
      expect(q.layers[0].liveMotionSpans!.map((s) => [s.id, s.start, s.end])).toEqual([
        ['live', 0, frame],
        ['right', frame, 8],
      ]);
      expect(
        q.layers[0].liveMotionSpans!.every((s) => s.groupPaths!.every((b) => !!b.restrictedArc)),
      ).toBe(true);
      expect(q.symbols).toEqual(before.symbols);
      expect(q.assets).toEqual(before.assets);
      expect(q.duration).toBe(before.duration);
      const reopened = migrateProject(JSON.parse(JSON.stringify(q)));
      equivalent(p, reopened);
      for (const [side, span] of q.layers[0].liveMotionSpans!.entries())
        for (const binding of span.groupPaths!) {
          const original = prepareIndependentGroupPath(
            p.layers[0],
            p.layers[0].liveMotionSpans![0],
            p.layers[0].liveMotionSpans![0].groupPaths!.find((b) => b.groupId === binding.groupId)!,
          );
          const half = prepareIndependentGroupPath(q.layers[0], span, binding),
            cut = frame / 8;
          const source = p.layers[0].keys[0].shapes.find((s) => s.id === original.ids[0])!;
          const base = q.layers[0].keys
            .find((k) => k.frame === span.start)!
            .shapes.find((s) => s.id === half.ids[0])!;
          for (let j = 0; j <= 256; j++) {
            const t = j / 256,
              a = half.route(t),
              b = original.route(side ? cut + (1 - cut) * t : cut * t);
            expect(
              sameMotionArtwork(
                { x: base.x + a.x, y: base.y + a.y },
                { x: source.x + b.x, y: source.y + b.y },
              ),
            ).toBe(true);
          }
        }
      expect(() => legacy(s.requests)).toThrow(/arc correspondence/);
      s.scope.dispose();
    });
it('prepares all tracks atomically and returns detached public candidates', () => {
  const { p } = restrictedArcProject();
  secondRotationTrack(p);
  const before = structuredClone(p),
    s = operation(p);
  s.requests.push({ owner: s.scope.resolve('later', 'second'), rightSpanId: 'later-right' });
  const q = prepare(s.requests);
  equivalent(p, q);
  expect(q.layers.every((l) => l.liveMotionSpans!.length === 2)).toBe(true);
  q.layers[0].keys[1].shapes[0].fill = '#123456';
  q.symbols![0].name = 'Public';
  expect(p).toEqual(before);
  s.scope.dispose();
});
it('preserves noncoincident nested member geometry and original membership', () => {
  const { p } = restrictedArcProject('reflected');
  for (const key of p.layers[0].keys.slice(0, 2))
    for (const group of ['outer', 'second']) {
      const members = key.shapes.filter((s) => s.groups?.[0] === group);
      members[1].x = members[0].x + 40;
    }
  const s = operation(p),
    q = prepare(s.requests);
  equivalent(p, q);
  expect(q.layers[0].keys[1].shapes.map((s) => s.groups)).toEqual(
    p.layers[0].keys[0].shapes.map((s) => s.groups),
  );
  s.scope.dispose();
});
it('keeps off-view document positions without clamping', () => {
  const { p } = restrictedArcProject();
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.y -= 64;
    }
  const before = structuredClone(p),
    s = operation(p),
    q = prepare(s.requests);
  equivalent(p, q);
  expect(p).toEqual(before);
  expect(q.layers[0].keys[0].shapes[0].y).toBe(-44);
  s.scope.dispose();
});
it('retains explicit rejection when legacy option derivation would change original settings', () => {
  const { p } = restrictedArcProject();
  for (const key of p.layers[0].keys.slice(0, 2))
    key.shapes[0].gradient = {
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 12, y: 0 },
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    };
  p.layers[0].liveMotionSpans![0].options = {
    paint: true,
    gradientGeometry: true,
    gradientStops: { pairs: 'auto' },
  };
  const s = operation(p),
    before = structuredClone(p);
  expect(() => prepare(s.requests)).toThrow(/options|properties/);
  expect(p).toEqual(before);
  s.scope.dispose();
});
it('preserves compound contours, static paint/options and absent member pivots', () => {
  const { p } = restrictedArcProject('affine');
  for (const key of p.layers[0].keys.slice(0, 2)) {
    const s = key.shapes[0];
    s.kind = 'polygon';
    s.fillRule = 'evenodd';
    s.points = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 10 },
      { x: 0, y: 10 },
    ];
    s.contours = [
      [
        { x: 3, y: 3 },
        { x: 6, y: 3 },
        { x: 4, y: 6 },
      ],
    ];
    delete s.pivot;
  }
  p.layers[0].liveMotionSpans![0].options = { paint: true, strokeWidth: false };
  const s = operation(p),
    q = prepare(s.requests);
  equivalent(p, q);
  expect(q.layers[0].keys[1].shapes[0].contours).toEqual(p.layers[0].keys[0].shapes[0].contours);
  expect(Object.hasOwn(q.layers[0].keys[1].shapes[0], 'pivot')).toBe(false);
  expect(q.layers[0].liveMotionSpans!.map((s) => s.options)).toEqual([
    p.layers[0].liveMotionSpans![0].options,
    p.layers[0].liveMotionSpans![0].options,
  ]);
  s.scope.dispose();
});
for (const what of [
  'ease',
  'paint',
  'strokeColor',
  'width',
  'pivot',
  'correspondence',
  'shared',
  'waypoints',
  'parametric',
  'persisted',
] as const)
  it(`retains conservative ${what} rejection without source writes`, () => {
    const f = restrictedArcProject(),
      p = what === 'persisted' ? f.q : f.p,
      l = p.layers[0],
      span = l.liveMotionSpans![0];
    if (what === 'ease') span.ease = 'in-out';
    if (what === 'paint') l.keys[1].shapes[0].fill = '#000000';
    if (what === 'strokeColor') l.keys[1].shapes[0].stroke = '#133557';
    if (what === 'width') {
      l.keys[1].shapes[0].width++;
      span.options = { ...span.options, primitives: true };
    }
    if (what === 'pivot') {
      l.keys[1].shapes[0].pivot!.x++;
      span.options = { ...span.options, affine: true, pivots: true };
    }
    if (what === 'correspondence') span.correspondence = { start: 0 };
    if (what === 'shared') span.path = { startX: 0, startY: 0, endX: 0, endY: 0 };
    if (what === 'waypoints') span.groupPaths![0].path.waypoints = [{ x: 45, y: 10 }];
    if (what === 'parametric') span.groupPaths![0].path.distance = false;
    const before = structuredClone(p),
      s =
        what === 'width' || what === 'pivot'
          ? undefined
          : operation(p, what === 'persisted' || what === 'ease' ? 2 : 4);
    if (!s) {
      expect(() => operation(p)).toThrow(/Disable scale\/skew/);
      expect(p).toEqual(before);
      return;
    }
    expect(() => prepare(s.requests)).toThrow();
    expect(p).toEqual(before);
    s.scope.dispose();
  });
it('does not let a later track publish earlier prepared halves', () => {
  const { p } = restrictedArcProject();
  secondRotationTrack(p);
  p.layers[1].keys[1].shapes[0].fill = '#336699';
  const before = structuredClone(p),
    s = operation(p);
  s.requests.push({ owner: s.scope.resolve('later', 'second'), rightSpanId: 'later-right' });
  expect(() => prepare(s.requests)).toThrow(/round a promoted color/);
  expect(p).toEqual(before);
  s.scope.dispose();
});
for (const change of ['source', 'request', 'output'] as const)
  it(`rejects actual late ${change} after complete edited Project cloning`, () => {
    const s = operation(),
      before = structuredClone(s.p),
      clone = structuredClone;
    let candidate: Project | undefined,
      fired = false;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v),
        p = out as Project;
      if (
        p?.layers?.[0]?.liveMotionSpans?.length === 2 &&
        p.layers[0].liveMotionSpans[0].groupPaths?.[0].restrictedArc
      )
        candidate = p;
      return out;
    });
    expect(() =>
      prepare(s.requests, {
        validate() {
          if (candidate && !fired) {
            fired = true;
            if (change === 'source') s.p.name = 'Separate source edit';
            if (change === 'request') s.requests[0].rightSpanId = 'Changed input';
            if (change === 'output') candidate.layers[0].keys[1].shapes[0].fill = '#123456';
          }
        },
      }),
    ).toThrow();
    expect(fired).toBe(true);
    vi.unstubAllGlobals();
    expect(s.p).toEqual(change === 'source' ? { ...before, name: 'Separate source edit' } : before);
    s.scope.dispose();
    const fresh = operation(s.p);
    expect(prepare(fresh.requests).layers[0].liveMotionSpans).toHaveLength(2);
    fresh.scope.dispose();
  });
for (const alias of ['root', 'layers', 'artwork', 'output'] as const)
  it(`rejects ${alias} clone aliases without source mutation`, () => {
    const s = operation(),
      before = structuredClone(s.p),
      clone = structuredClone;
    let fired = false;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v),
        p = v as Project;
      if (p === s.p) {
        fired = true;
        if (alias === 'root') return p;
        if (alias === 'layers') return { ...(out as Project), layers: p.layers };
        if (alias === 'artwork') {
          (out as Project).layers[0].keys[0].shapes = p.layers[0].keys[0].shapes;
        }
      }
      if (alias === 'output' && p?.layers?.[0]?.liveMotionSpans?.length === 2) {
        fired = true;
        return v;
      }
      return out;
    });
    expect(() => prepare(s.requests)).toThrow(/detached/);
    expect(fired).toBe(true);
    expect(s.p).toEqual(before);
    vi.unstubAllGlobals();
    expect(prepare(s.requests).layers[0].liveMotionSpans).toHaveLength(2);
    s.scope.dispose();
  });
for (const target of ['same', 'legacy'] as const)
  it(`poisons swallowed ${target} preparation reentry and permits fresh retry`, () => {
    const s = operation();
    let fired = false;
    expect(() =>
      prepare(s.requests, {
        validate() {
          if (!fired) {
            fired = true;
            try {
              (target === 'same' ? prepare : legacy)(s.requests);
            } catch {
              /* Outer admission must reject. */
            }
          }
        },
      }),
    ).toThrow(/reentered/);
    expect(fired).toBe(true);
    expect(prepare(s.requests).layers[0].liveMotionSpans).toHaveLength(2);
    s.scope.dispose();
  });
it('rejects unrepresentable promoted member displacement without normalization', () => {
  const { p } = restrictedArcProject('reflected');
  for (const key of p.layers[0].keys.slice(0, 2))
    for (const g of ['outer', 'second']) {
      const shapes = key.shapes.filter((s) => s.groups?.[0] === g);
      shapes[1].x = shapes[0].x + 40;
    }
  for (const b of p.layers[0].liveMotionSpans![0].groupPaths!) {
    b.path.startY = 8;
    b.path.endY = 8;
  }
  for (const [i, k] of p.layers[0].keys.slice(0, 2).entries())
    if (i)
      for (let j = 0; j < k.shapes.length; j++) k.shapes[j].y = p.layers[0].keys[0].shapes[j].y;
  const before = structuredClone(p),
    s = operation(p);
  expect(() => prepare(s.requests)).toThrow(/displacement/);
  expect(p).toEqual(before);
  s.scope.dispose();
});
it('uses private original picks rather than forged public owners/scenes', () => {
  const s = operation();
  s.scope.scene[0].key.shapes[0].x += 999;
  expect(() => prepare([{ ...s.requests[0], owner: { ...s.requests[0].owner } }])).toThrow(
    /private/,
  );
  equivalent(s.p, prepare(s.requests));
  s.scope.dispose();
});
it('keeps loose symbol exposure/clock qualification outside the new kernel', () => {
  const { p } = restrictedArcProject();
  for (const key of p.layers[0].keys.slice(0, 2))
    Object.assign(
      key.shapes.find((s) => s.id === 'loose')!,
      { kind: 'symbol', symbolId: 'library', symbolPlayback: { mode: 'loop', firstFrame: 0 } },
    );
  const before = structuredClone(p);
  expect(() =>
    splitRestrictedArcLiveGroupMotionLayer(
      p,
      p.layers[0],
      p.layers[0].liveMotionSpans![0],
      4,
      'right',
    ),
  ).toThrow(/symbol continuity/);
  expect(p).toEqual(before);
});
it('rejects unresolved low-origin continuous bounds without changing geometry and permits a fresh qualified cut', () => {
  const s = operation(restrictedArcProject().p, 2),
    before = structuredClone(s.p);
  expect(() => prepare(s.requests)).toThrow(/continuous geometry.*unresolved/);
  expect(s.p).toEqual(before);
  s.scope.dispose();
  const fresh = operation(s.p, 4);
  equivalent(s.p, prepare(fresh.requests));
  fresh.scope.dispose();
});
for (const change of ['frame', 'revision', 'dispose'] as const)
  it(`rejects stale ${change} ownership`, () => {
    const { p } = restrictedArcProject();
    let frame = 4,
      revision = 0;
    const scope = capture(() => ({ project: p, frame, revision })),
      owner = scope.resolve('track', 'outer');
    const before = structuredClone(p);
    if (change === 'frame') frame = 5;
    if (change === 'revision') revision++;
    if (change === 'dispose') scope.dispose();
    expect(() => prepare([{ owner, rightSpanId: 'right' }])).toThrow();
    expect(p).toEqual(before);
    scope.dispose();
  });
it('rejects sparse requests and raw getter inputs/admission before reading them', () => {
  const s = operation();
  let reads = 0;
  const request = Object.defineProperty({ owner: s.requests[0].owner }, 'rightSpanId', {
    enumerable: true,
    get() {
      reads++;
      return 'right';
    },
  });
  expect(() => prepare([request as LiveGroupSplitRequest])).toThrow();
  const options = Object.defineProperty({}, 'validate', {
    enumerable: true,
    get() {
      reads++;
      return () => {};
    },
  });
  expect(() => prepare(s.requests, options)).toThrow();
  expect(reads).toBe(0);
  expect(() => prepare(new Array<LiveGroupSplitRequest>(1))).toThrow();
  expect(prepare(s.requests).layers[0].liveMotionSpans).toHaveLength(2);
  s.scope.dispose();
});
it('admits actual original aggregate capacity and rejects late output overflow without source writes', () => {
  const { p } = restrictedArcProject();
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
  const s = operation(p),
    q = prepare(s.requests);
  expect(q.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  const clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = clone(value),
      data = out as Project;
    if (
      data?.layers?.[0]?.liveMotionSpans?.length === 2 &&
      data.symbols?.[0]?.shapes.length === MAX_SYMBOL_ARTWORK
    ) {
      fired = true;
      data.symbols[0].shapes.push({ ...data.symbols[0].shapes[0], id: 'overflow' });
    }
    return out;
  });
  expect(() => prepare(s.requests)).toThrow(/artwork budget/);
  expect(fired).toBe(true);
  expect(p.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  expect(p.layers[0].keys).toHaveLength(3);
  s.scope.dispose();
}, 120000);

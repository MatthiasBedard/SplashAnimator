import { expect, it, vi } from 'vitest';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import {
  newProject,
  validateProject,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type Vector,
  type LiveMotionSpan,
} from '../packages/document/src';
import {
  prepareCreateLiveMotionSpans as create,
  prepareRemoveLiveMotionSpans as remove,
  prepareUpdateLiveMotionSpans as update,
  captureLiveMotionTimeline as capture,
  type UpdateLiveMotionRequest,
} from '../packages/animation/src/live-motion';

function fixture(two = false): Project {
  const p = newProject();
  p.duration = 10;
  p.layers[0].id = 'track';
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 20,
    width: 40,
    height: 30,
    rotation: 0,
    opacity: 0.2,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art] },
    { frame: 4, shapes: [{ ...structuredClone(art), x: 80, opacity: 1 }] },
    { frame: 8, shapes: [] },
  ];
  p.layers[0].liveMotionSpans = [{ id: 'live', start: 0, end: 4, ease: 'linear' }];
  if (two) p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  return p;
}
const request = (
  changes: UpdateLiveMotionRequest['changes'] = { ease: 'in' },
  layerId = 'track',
  spanId = 'live',
): UpdateLiveMotionRequest => ({ layerId, spanId, changes });
function sample(p: Project, f = 2) {
  const c = capture(() => ({ project: p, revision: 0 }));
  try {
    return c.sample(f)[0].key.shapes[0];
  } finally {
    c.dispose();
  }
}

for (const ease of [
  'linear',
  'in',
  'out',
  'in-out',
  { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: 1 },
] as const)
  it(`updates ${JSON.stringify(ease)} with independent integer poses and exact authored data`, () => {
    const p = fixture(),
      before = structuredClone(p),
      r = [request({ ease })],
      out = update(p, r),
      expected = structuredClone(p);
    expected.layers[0].liveMotionSpans![0].ease = ease;
    expect(out).toEqual(expected);
    expect(p).toEqual(before);
    expect(r).toEqual([request({ ease })]);
    for (let f = 0; f <= 4; f++) {
      const t = f / 4,
        v =
          ease === 'in'
            ? t * t
            : ease === 'out'
              ? 1 - (1 - t) ** 2
              : ease === 'in-out'
                ? t < 0.5
                  ? 2 * t * t
                  : 1 - 2 * (1 - t) ** 2
                : t;
      expect(sample(out, f).x).toBeCloseTo(80 * v, 12);
    }
    expect(out.layers[0].keys).toEqual(before.layers[0].keys);
    expect(sample(out, 6)).toEqual(before.layers[0].keys[1].shapes[0]);
    expect(validateProject(JSON.parse(JSON.stringify(out)))).toEqual(out);
  });

it('custom cubic timing has a non-diagonal independent analytic midpoint', () => {
  const ease = { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: 0 } as const,
    p = update(fixture(), [request({ ease })]);
  // x(1/2)=1/2, y(1/2)=1/8, so x=10 independently of the shared evaluator.
  expect(sample(p).x).toBeCloseTo(10, 12);
  expect(sample(p).opacity).toBeCloseTo(0.3, 12);
});

for (const options of [
  undefined,
  {},
  { paint: false },
  { paint: true },
  { affine: false, paint: false },
])
  it(`retains exact explicit option replacement ${JSON.stringify(options)}`, () => {
    const p = fixture();
    p.layers[0].liveMotionSpans![0].options = { paint: true };
    const out = update(p, [request({ options })]),
      span = out.layers[0].liveMotionSpans![0];
    expect(span.options).toEqual(options);
    expect(Object.hasOwn(span, 'options')).toBe(options !== undefined);
    expect(p.layers[0].liveMotionSpans![0].options).toEqual({ paint: true });
  });

it('omitted options stay exact and explicit easing never changes independent channels or advanced data', () => {
  const p = fixture();
  for (const k of p.layers[0].keys.slice(0, 2))
    Object.assign(k.shapes[0], {
      kind: 'polygon',
      fillRule: 'evenodd',
      contours: [
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 30 },
          { x: 0, y: 30 },
        ],
      ],
    });
  const span = p.layers[0].liveMotionSpans![0];
  Object.assign(span, {
    options: { paint: true, nodes: true },
    opacityEase: 'out',
    paintEase: 'linear',
    path: { startX: 0, startY: 10, endX: 0, endY: 10 },
    rotation: { direction: 'clockwise', turns: 1 },
    correspondence: { start: 0, reverse: false },
  });
  p.layers[0].keys[1].shapes[0].fill = '#808080';
  const before = structuredClone(p),
    out = update(p, [request({ ease: 'in' })]),
    expected = structuredClone(p);
  expected.layers[0].liveMotionSpans![0].ease = 'in';
  expect(out).toEqual(expected);
  expect(p).toEqual(before);
  expect(sample(out).opacity).toBeCloseTo(0.8);
  expect(sample(out).fill).toBe('#404040');
  expect(sample(out).rotation).toBeCloseTo(90);
});

for (const mode of ['paint', 'primitives', 'affine', 'pivots', 'defaults', 'nodes'])
  it(`explicit ${mode} admission can repair incompatible geometry without baking`, () => {
    const p = fixture(),
      a = p.layers[0].keys[0].shapes[0],
      b = p.layers[0].keys[1].shapes[0];
    const options: NonNullable<LiveMotionSpan['options']> = {};
    if (mode === 'paint') {
      b.fill = '#808080';
      options.paint = true;
    }
    if (mode === 'primitives') {
      b.width = 80;
      options.primitives = true;
    }
    if (mode === 'affine') {
      b.transform = [2, 0, 0.5, 1];
      options.affine = true;
    }
    if (mode === 'pivots' || mode === 'defaults') {
      if (mode === 'pivots') a.pivot = { x: 0, y: 0 };
      b.pivot = { x: 20, y: 10 };
      options.affine = true;
      options.pivots = true;
      if (mode === 'defaults') options.defaultPivots = true;
    }
    if (mode === 'nodes')
      for (const [i, s] of [a, b].entries())
        Object.assign(s, {
          kind: 'polygon',
          fillRule: 'evenodd',
          contours: [
            [
              { x: 0, y: 0 },
              { x: 40 + i * 10, y: 0 },
              { x: 0, y: 30 },
            ],
          ],
        });
    if (mode === 'nodes') options.nodes = true;
    expect(() => sample(p)).toThrow();
    const before = structuredClone(p),
      out = update(p, [request({ options })]);
    expect(p).toEqual(before);
    expect(out.layers[0].keys).toEqual(before.layers[0].keys);
    const mid = sample(out);
    expect(mid.x).toBe(40);
    if (mode === 'paint') expect(mid.fill).toBe('#404040');
    if (mode === 'primitives') expect(mid.width).toBe(60);
    if (mode === 'nodes') expect(mid.contours![0][1].x).toBe(45);
    expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8]);
  });

it('fresh endpoint edits use persistent updated timing without Refresh and invalidate old captures', () => {
  const out = update(fixture(), [request()]),
    c = capture(() => ({ project: out, revision: 0 }));
  out.layers[0].keys[1].shapes[0].x = 120;
  expect(() => c.sample(2)).toThrow();
  c.dispose();
  expect(sample(out).x).toBe(30);
  const reopened = validateProject(JSON.parse(JSON.stringify(out)));
  expect(sample(reopened).x).toBe(30);
  expect(update(reopened, [request({ ease: 'out' })]).layers[0].keys).toEqual(out.layers[0].keys);
});

it('multiple tracks and disjoint records retain unrequested records and every source value', () => {
  const p = fixture(true);
  p.layers[0].keys[2].shapes = [{ ...structuredClone(p.layers[0].keys[1].shapes[0]), x: 160 }];
  p.layers[0].liveMotionSpans!.push({ id: 'next', start: 4, end: 8, ease: 'linear' });
  const before = structuredClone(p),
    out = update(p, [request(), request({ ease: 'out' }, 'later')]);
  expect(out.layers[0].liveMotionSpans![1]).toEqual(before.layers[0].liveMotionSpans![1]);
  expect(out.layers[1].liveMotionSpans![0].ease).toBe('out');
  expect(p).toEqual(before);
  out.layers[0].keys[0].shapes[0].x = 900;
  out.layers[1].liveMotionSpans![0].ease = 'linear';
  expect(p).toEqual(before);
});

for (const changes of [
  {},
  { ease: undefined },
  { ease: 'unknown' },
  { ease: { kind: 'cubic', x1: NaN, y1: 0, x2: 1, y2: 1 } },
  { ease: { kind: 'cubic', x1: 0, y1: Infinity, x2: 1, y2: 1 } },
  { options: { paint: 1 } },
  { options: { unknown: true } },
  { options: { defaultPivots: true } },
  { options: { gradientStops: true } },
  { id: 'forged' },
  { start: 1 },
  { path: {} },
  null,
  [],
])
  it(`rejects raw or unsupported change ${JSON.stringify(changes)} atomically`, () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => update(p, [request(changes as UpdateLiveMotionRequest['changes'])])).toThrow();
    expect(p).toEqual(before);
  });

for (const mode of ['missing', 'duplicate', 'locked', 'hidden', 'invalidSource', 'laterGeometry'])
  it(`later ${mode} rejects the whole request without consuming valid original state`, () => {
    const p = fixture(true),
      r = [request(), request({ ease: 'out' }, 'later')];
    if (mode === 'missing') r[1].spanId = 'missing';
    if (mode === 'duplicate') r[1] = structuredClone(r[0]);
    if (mode === 'locked') p.layers[1].locked = true;
    if (mode === 'hidden') p.layers[1].visible = false;
    if (mode === 'invalidSource') p.layers[1].liveMotionSpans![0].start = 0.5;
    if (mode === 'laterGeometry') p.layers[1].keys[1].shapes[0].width = 80;
    const before = structuredClone(p);
    expect(() => update(p, r)).toThrow();
    expect(p).toEqual(before);
    if (mode !== 'invalidSource')
      expect(update(p, [r[0]]).layers[0].liveMotionSpans![0].ease).toBe('in');
  });

for (const place of ['source', 'request', 'changes', 'callback'])
  it(`rejects original ${place} getters without executing them`, () => {
    const p = fixture(),
      r = [request()],
      options: { validate?: () => void } = {};
    let reads = 0;
    const target =
      place === 'source'
        ? p.layers[0].keys[0].shapes[0]
        : place === 'request'
          ? r[0]
          : place === 'changes'
            ? r[0].changes
            : options;
    Object.defineProperty(
      target,
      place === 'source'
        ? 'x'
        : place === 'request'
          ? 'spanId'
          : place === 'changes'
            ? 'ease'
            : 'validate',
      {
        enumerable: true,
        get() {
          reads++;
          return undefined;
        },
      },
    );
    expect(() => update(p, r, options)).toThrow();
    expect(reads).toBe(0);
  });

for (const mode of ['async', 'reentry', 'source', 'input', 'revision'])
  it(`rejects ${mode} admission and permits a valid fresh retry`, () => {
    const p = fixture(),
      r = [request()],
      before = structuredClone(p);
    let first = true,
      revision = 0;
    expect(() =>
      update(p, r, {
        validate: () => {
          if (mode === 'revision' && revision) throw Error('Enclosing revision changed.');
          if (!first) return;
          first = false;
          if (mode === 'async') return Promise.resolve() as unknown as void;
          if (mode === 'reentry') {
            try {
              update(p, r);
            } catch {
              /* swallowed host reentry remains invalid */
            }
          }
          if (mode === 'source') p.name = 'Independent source edit';
          if (mode === 'input') r[0].changes.ease = 'out';
          if (mode === 'revision') {
            p.name = 'temporary';
            p.name = before.name;
            revision++;
            throw Error('Enclosing revision changed.');
          }
        },
      }),
    ).toThrow();
    expect(p.layers).toEqual(before.layers);
    expect(update(p, [request()]).layers[0].liveMotionSpans![0].ease).toBe('in');
  });

for (const mode of ['sourceClone', 'requestClone', 'outputClone', 'lateSource', 'lateCandidate'])
  it(`rejects asserted ${mode} hooks after cloning without partial publication`, () => {
    const p = fixture(),
      r = [request()],
      before = structuredClone(p),
      clone = structuredClone;
    let hit = false,
      candidate: Project | undefined;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value),
        q = out as Project;
      if (value === p) {
        candidate = q;
        if (mode === 'sourceClone') {
          hit = true;
          q.background = '#ff0000';
        }
      }
      if (!hit && mode === 'requestClone' && Array.isArray(out) && out[0]?.changes) {
        hit = true;
        out[0].changes.ease = 'out';
      }
      if (!hit && q?.layers?.[0]?.liveMotionSpans?.[0]?.ease === 'in') {
        if (mode === 'outputClone') {
          hit = true;
          q.layers[0].keys[0].shapes[0].x = 999;
        }
        if (mode === 'lateSource') {
          hit = true;
          p.name = 'Independent source edit';
        }
        if (mode === 'lateCandidate') {
          hit = true;
          candidate!.layers[0].keys[0].shapes[0].x = 999;
        }
      }
      return out;
    });
    try {
      expect(() => update(p, r)).toThrow();
      expect(hit).toBe(true);
      expect(p.layers).toEqual(before.layers);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(update(p, r).layers[0].liveMotionSpans![0].ease).toBe('in');
  });

it('removing incompatible recipes remains independent of update compilation', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0].kind = 'ellipse';
  expect(() => update(p, [request()])).toThrow();
  const out = remove(p, [{ layerId: 'track', spanId: 'live' }]);
  expect(out.layers[0].keys).toEqual(p.layers[0].keys);
  expect(out.layers[0].liveMotionSpans).toBeUndefined();
});

it('retains legacy explicit creation and removal exactness around an updated record', () => {
  const p = fixture();
  delete p.layers[0].liveMotionSpans;
  const span: LiveMotionSpan = { id: 'live', start: 0, end: 4, ease: 'linear' },
    created = create(p, [{ layerId: 'track', span }]);
  expect(update(created, [request({ ease: 'linear' })])).toEqual(created);
  expect(remove(update(created, [request()]), [{ layerId: 'track', spanId: 'live' }])).toEqual(p);
});

it('admits the actual aggregate artwork boundary and rejects overflow without low caps', () => {
  const p = fixture(),
    art = p.layers[0].keys[0].shapes[0];
  p.symbols = [
    {
      id: 'unused',
      name: 'Unused',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({ ...art, id: 's' + i })),
    },
  ];
  expect(update(p, [request()]).symbols![0].shapes.length).toBe(MAX_SYMBOL_ARTWORK);
  p.symbols[0].shapes.push({ ...art, id: 'overflow' });
  expect(() => update(p, [request()])).toThrow(/budget/);
}, 30000);

for (const reflected of [false, true])
  it(`preserves ${reflected ? 'reflected' : 'affine'} compound world geometry with explicit easing updates`, () => {
    const p = fixture();
    for (const k of p.layers[0].keys.slice(0, 2))
      Object.assign(k.shapes[0], {
        kind: 'polygon',
        fillRule: 'evenodd',
        transform: [reflected ? -2 : 2, 0.25, 0.5, 3],
        pivot: { x: 7, y: -3 },
        contours: [
          [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 30 },
            { x: 0, y: 30 },
          ],
          [
            { x: 5, y: 5 },
            { x: 10, y: 5 },
            { x: 7, y: 10 },
          ],
        ],
      });
    const out = update(p, [request({ ease: 'in', options: { affine: true, nodes: true } })]),
      mid = sample(out),
      original = p.layers[0].keys[0].shapes[0];
    const expected = matrix({ ...original, x: 20 });
    for (const ring of original.contours!)
      for (const node of ring) {
        const actual = mapPoint(matrix(mid), node),
          want = mapPoint(expected, node);
        expect(actual.x).toBeCloseTo(want.x, 12);
        expect(actual.y).toBeCloseTo(want.y, 12);
      }
    expect(out.layers[0].keys).toEqual(p.layers[0].keys);
    expect(mid.contours).toEqual(original.contours);
  });

for (const mode of ['requiredGeometry', 'paintChannel'])
  it(`removing required options rejects ${mode} without dropping other recipe fields`, () => {
    const p = fixture(),
      span = p.layers[0].liveMotionSpans![0];
    span.options = { paint: true };
    p.layers[0].keys[1].shapes[0].fill = '#808080';
    if (mode === 'paintChannel') span.paintEase = 'out';
    const before = structuredClone(p);
    expect(() => update(p, [request({ options: undefined })])).toThrow();
    expect(p).toEqual(before);
    expect(remove(p, [{ layerId: 'track', spanId: 'live' }]).layers[0].keys).toEqual(
      before.layers[0].keys,
    );
  });

it('snapshots the original enclosing callback once even if that public property is replaced', () => {
  const p = fixture();
  let calls = 0,
    wrong = 0;
  const options = {
    validate: () => {
      calls++;
      options.validate = () => {
        wrong++;
        throw Error('Replaced callback');
      };
    },
  };
  expect(update(p, [request()], options).layers[0].liveMotionSpans![0].ease).toBe('in');
  expect(calls).toBeGreaterThan(1);
  expect(wrong).toBe(0);
});

for (const requests of [
  [],
  [{ layerId: 'track', spanId: 'missing', changes: { ease: 'in' } }],
  [{ layerId: 'track', spanId: 'live', changes: { ease: 'in' }, extra: true }],
  [null],
])
  it(`rejects malformed membership ${JSON.stringify(requests)} without source writes`, () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => update(p, requests as UpdateLiveMotionRequest[])).toThrow();
    expect(p).toEqual(before);
  });

it('large duration stays sparse after updated persistent timing', () => {
  const p = fixture();
  p.duration = 100000;
  p.layers[0].keys = p.layers[0].keys.slice(0, 2);
  p.layers[0].keys[1].frame = 99999;
  p.layers[0].liveMotionSpans![0].end = 99999;
  const out = update(p, [request()]);
  expect(out.layers[0].keys).toHaveLength(2);
  expect(sample(out, 50000).x).toBeCloseTo(80 * (50000 / 99999) ** 2, 10);
});

it('overflowing original values reject before normalization or partial replacement', () => {
  const p = fixture(true);
  p.layers[1].keys[0].shapes[0].x = -1e308;
  p.layers[1].keys[1].shapes[0].x = 1e308;
  const before = structuredClone(p);
  expect(() => update(p, [request(), request({ ease: 'out' }, 'later')])).toThrow();
  expect(p).toEqual(before);
});

for (const place of ['request', 'changes', 'options'])
  it(`nonenumerable ${place} data cannot disappear during update transport`, () => {
    const p = fixture(),
      r = [request({ ease: 'in', options: { paint: false } })],
      before = structuredClone(p);
    const target =
      place === 'request' ? r[0] : place === 'changes' ? r[0].changes : r[0].changes.options!;
    Object.defineProperty(target, 'unknown', { value: true, enumerable: false });
    expect(() => update(p, r)).toThrow(/enumerable/);
    expect(p).toEqual(before);
  });

it('a failing later option dependency leaves every changed recipe exact', () => {
  const p = fixture(true);
  p.layers[1].liveMotionSpans![0].options = { paint: true };
  p.layers[1].liveMotionSpans![0].paintEase = 'out';
  const before = structuredClone(p);
  expect(() => update(p, [request(), request({ options: undefined }, 'later')])).toThrow();
  expect(p).toEqual(before);
  expect(update(p, [request()]).layers[1]).toEqual(before.layers[1]);
});

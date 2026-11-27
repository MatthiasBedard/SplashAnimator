import { afterEach, expect, it, vi } from 'vitest';
import { newLayer, newProject, validateProject, type Vector } from '../packages/document/src';
import { validateMotionNodeMatching } from '../packages/document/src/motion-contour';
import { prepareAutomaticTimelineTween as convert } from '../apps/editor/src/timeline-tween-automatic';
import { prepareTimelineKeyframe } from '../apps/editor/src/timeline-keyframe';
import { prepareTimelineTween } from '../apps/editor/src/timeline-tween';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { matchShapeTweenArtwork } from '../packages/animation/src/motion-shape-morph';
import { pathCommands, worldPaths } from '../packages/geometry/src/drawing';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
  reverseBasicMotionSpan,
} from '../packages/animation/src/motion-spans';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const p = newProject();
  p.duration = 12;
  const a: Vector = {
    id: 'square',
    kind: 'rectangle',
    x: 20,
    y: 30,
    width: 80,
    height: 80,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 8, shapes: [{ ...a, id: 'new-circle', kind: 'ellipse', x: 100, fill: '#0000ff' }] },
    { frame: 10, shapes: [] },
  ];
  p.layers.push(newLayer('Untouched'));
  return p;
}
function sample(p: ReturnType<typeof fixture>, frame: number) {
  const plan = createMotionFrameSampler(p, p.layers[0].id, p.layers[0].liveMotionSpans![0]);
  try {
    return plan.sample(frame);
  } finally {
    plan.dispose();
  }
}
it('morphs independently drawn square/circle artwork through real intermediate cubic geometry and color', () => {
  const p = fixture(),
    before = structuredClone(p),
    q = convert(p, p.layers[0].id, 0, 'shape');
  expect(p).toEqual(before);
  expect(q.layers[0].keys).toEqual(p.layers[0].keys);
  expect(q.layers[1]).toEqual(p.layers[1]);
  expect(q.symbols).toEqual(p.symbols);
  expect(sample(q, 0)).toEqual(p.layers[0].keys[0].shapes);
  expect(sample(q, 8)).toEqual(p.layers[0].keys[1].shapes);
  const mid = sample(q, 4)[0];
  expect(mid.kind).toBe('bezier');
  expect(mid.closed).toBe(true);
  expect(mid.fill).toBe('#800080');
  expect(mid.x).toBe(60);
  expect(mid.y).toBe(30);
  expect(mid.nodes![0]).toMatchObject({ x: 40, y: 20 });
  expect(pathCommands(mid)).not.toEqual(pathCommands(p.layers[0].keys[0].shapes[0]));
  expect(sample(validateProject(JSON.parse(JSON.stringify(q))), 4)).toEqual([mid]);
  mid.nodes![0].x++;
  expect(sample(q, 4)[0].nodes![0].x).toBe(40);
});
for (const mode of ['merge', 'object'] as const)
  it(`morphs ${mode} unequal curved compound contours without changing authored holes or keys`, () => {
    const p = fixture(),
      a = p.layers[0].keys[0].shapes[0],
      b = p.layers[0].keys[1].shapes[0];
    Object.assign(a, {
      kind: 'polygon',
      drawingMode: mode,
      fillRule: 'evenodd',
      contours: [
        [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
          { x: 80, y: 80 },
          { x: 0, y: 80 },
        ],
        [
          { x: 20, y: 20 },
          { x: 60, y: 20 },
          { x: 40, y: 60 },
        ],
      ],
    });
    Object.assign(b, structuredClone(a), { id: 'new-paint', x: 100, width: 120, height: 90 });
    b.contours![0].splice(1, 0, { x: 40, y: -20, out: { x: 50, y: -10 } });
    const before = structuredClone(p),
      q = convert(p, p.layers[0].id, 0, 'shape');
    expect(q.layers[0].keys).toEqual(before.layers[0].keys);
    expect(p).toEqual(before);
    const mid = sample(q, 4)[0];
    expect(mid.contours).toHaveLength(2);
    expect(mid.fillRule).toBe('evenodd');
    expect(mid.contours![0].length).toBeGreaterThan(5);
    expect(mid.contours![1].length).toBe(3);
    expect(worldPaths(mid).length).toBe(2);
  });
it('matches independently drawn open Pencil paths and preserves stroke settings', () => {
  const p = fixture(),
    a = p.layers[0].keys[0].shapes[0],
    b = p.layers[0].keys[1].shapes[0];
  Object.assign(a, {
    kind: 'bezier',
    nodes: [
      { x: 0, y: 0, out: { x: 30, y: 0 } },
      { x: 80, y: 30 },
    ],
    fillEnabled: false,
    strokeWidth: 4,
  });
  Object.assign(b, {
    kind: 'bezier',
    nodes: [
      { x: 0, y: 0 },
      { x: 40, y: 60 },
      { x: 80, y: 0 },
    ],
    fillEnabled: false,
    strokeWidth: 8,
  });
  const q = convert(p, p.layers[0].id, 0, 'shape'),
    mid = sample(q, 4)[0];
  expect(mid.nodes).toHaveLength(3);
  expect(mid.strokeWidth).toBe(6);
  expect(mid.fillEnabled).toBe(false);
  expect(q.layers[0].keys).toEqual(p.layers[0].keys);
});
for (const transform of [undefined, [1.2, 0.2, 0.3, 0.9], [-1, 0.2, 0.3, 0.9]] as const)
  it(`preserves source geometry through detached cubic correspondence under ${JSON.stringify(transform)}`, () => {
    const p = fixture(),
      a = p.layers[0].keys[0].shapes[0],
      b = p.layers[0].keys[1].shapes[0];
    a.cornerRadius = 12;
    a.rotation = b.rotation = 30;
    if (transform) {
      a.transform = [...transform];
      b.transform = [...transform];
    }
    const before = structuredClone([a, b]),
      [x, y] = matchShapeTweenArtwork(a, b);
    expect([a, b]).toEqual(before);
    const distance = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y);
    for (const [original, normalized] of [
      [a, x],
      [b, y],
    ]) {
      const expected = worldPaths(original, 0.001)[0],
        actual = worldPaths(normalized, 0.001)[0];
      // Independent dense rendered-path oracle, insensitive to de Casteljau partitions.
      for (const point of expected)
        expect(Math.min(...actual.map((q) => distance(point, q)))).toBeLessThan(2);
    }
    x.nodes![0].x++;
    expect([a, b]).toEqual(before);
    const q = convert(p, p.layers[0].id, 0, 'shape');
    validateProject({
      ...q,
      layers: [
        { ...q.layers[0], liveMotionSpans: undefined, keys: [{ frame: 0, shapes: sample(q, 4) }] },
      ],
      duration: 1,
    });
  });
it('retains primitive dimension interpolation for independently drawn same-kind shapes', () => {
  const p = fixture();
  Object.assign(p.layers[0].keys[1].shapes[0], { kind: 'rectangle', width: 160, height: 120 });
  expect(sample(convert(p, p.layers[0].id, 0, 'shape'), 4)[0]).toMatchObject({
    kind: 'rectangle',
    width: 120,
    height: 100,
  });
});
it('retains existing nonnegative primitive dimensions, including a zero-size endpoint', () => {
  const p = fixture();
  Object.assign(p.layers[0].keys[1].shapes[0], { kind: 'rectangle', width: 0, height: 0 });
  expect(sample(convert(p, p.layers[0].id, 0, 'shape'), 4)[0]).toMatchObject({
    width: 40,
    height: 40,
  });
});
it('retains exact legacy matching for straight nonzero compound artwork', () => {
  const p = fixture(),
    a = p.layers[0].keys[0].shapes[0];
  Object.assign(a, {
    kind: 'polygon',
    fillRule: 'nonzero',
    contours: [
      [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 80 },
      ],
      [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
      ],
    ],
  });
  p.layers[0].keys[1].shapes = [{ ...structuredClone(a), id: 'new-paint', x: 100 }];
  const q = convert(p, p.layers[0].id, 0, 'shape');
  expect(sample(q, 4)[0]).toMatchObject({
    kind: 'polygon',
    fillRule: 'nonzero',
    contours: a.contours,
    x: 60,
  });
  expect(q.layers[0].keys).toEqual(p.layers[0].keys);
});
for (const at of [1, 4, 7])
  it(`inserts an editable exact sampled key at frame ${at} of a morph`, () => {
    const p = fixture(),
      q = convert(p, p.layers[0].id, 0, 'shape'),
      middle = sample(q, at);
    const split = prepareTimelineKeyframe(q, q.layers[0].id, at);
    expect(split.layers[0].keys.find((k) => k.frame === at)!.shapes).toEqual(middle);
    expect(split.layers[0].keys[0]).toEqual(p.layers[0].keys[0]);
    expect(split.layers[0].keys.find((k) => k.frame === 8)).toEqual(p.layers[0].keys[1]);
  });
for (const failure of ['group', 'brush', 'pressure', 'NaN', 'overflow'] as const)
  it(`rejects unsupported ${failure} without changing source or making a partial tween`, () => {
    const p = fixture(),
      a = p.layers[0].keys[0].shapes[0],
      b = p.layers[0].keys[1].shapes[0];
    if (failure === 'group') b.groups = ['g'];
    if (failure === 'brush') b.kind = 'brush';
    if (failure === 'pressure') {
      a.kind = 'path';
      a.points = [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 80, y: 80 },
      ];
    }
    if (failure === 'NaN') b.width = NaN;
    if (failure === 'overflow') b.x = Number.MAX_VALUE;
    const before = structuredClone(p);
    expect(() => convert(p, p.layers[0].id, 0, 'shape')).toThrow();
    expect(p).toEqual(before);
  });
it('does not enable shape identity matching in legacy motion recipes', () => {
  const p = fixture();
  expect(() => convert(p, p.layers[0].id, 0, 'motion')).toThrow();
  const strict = {
    start: 0,
    end: 8,
    ease: 'linear' as const,
    options: { nodes: true, primitives: true, affine: true, paint: true },
    correspondence: { nodes: { curves: true } },
  };
  expect(() => createMotionFrameSampler(p, p.layers[0].id, strict)).toThrow();
  expect(() => validateMotionNodeMatching({ shapes: true })).toThrow();
  expect(() => validateMotionNodeMatching({ curves: true, shapes: 'yes' })).toThrow();
});
it('upgrades existing ordinary shape spans, preserves their recipe identity, and remains idempotent', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0] = { ...p.layers[0].keys[0].shapes[0], x: 100 };
  const q = convert(p, p.layers[0].id, 0, 'shape'),
    span = q.layers[0].liveMotionSpans![0];
  delete (span.correspondence!.nodes as { shapes?: boolean }).shapes;
  const r = convert(q, q.layers[0].id, 0, 'shape');
  expect(r.layers[0].liveMotionSpans![0].id).toBe(span.id);
  expect(convert(r, r.layers[0].id, 0, 'shape')).toEqual(r);
});
it('converts a compatible shape span back to motion while preserving identity and all keys', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes = [{ ...p.layers[0].keys[0].shapes[0], x: 100 }];
  const q = convert(p, p.layers[0].id, 0, 'shape');
  const input = {
    start: 0,
    end: 8,
    kind: 'motion' as const,
    affine: true,
    ease: 'linear' as const,
    createEndpoints: true,
  };
  const r = prepareTimelineTween(q, q.layers[0].id, input);
  expect(r.layers[0].keys).toEqual(q.layers[0].keys);
  expect(r.layers[0].liveMotionSpans![0].id).toBe(q.layers[0].liveMotionSpans![0].id);
  expect(r.layers[0].liveMotionSpans![0].correspondence).toBeUndefined();
  expect(sample(r, 4)[0].x).toBe(60);
  q.layers[0].liveMotionSpans![0].correspondence!.nodes = {
    curves: true,
    shapes: true,
    hints: [[]],
  };
  expect(() => prepareTimelineTween(q, q.layers[0].id, input)).toThrow(
    /saved contour correspondence/,
  );
});
it('rejects actual late source changes after matching without overwriting the independent edit', () => {
  const p = fixture();
  let hit = false;
  const original = globalThis.structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
    const result = original(value);
    if (!hit && value && typeof value === 'object' && 'kind' in value && value.kind === 'ellipse') {
      hit = true;
      p.layers[1].name = 'User edit';
    }
    return result;
  });
  expect(() => convert(p, p.layers[0].id, 0, 'shape')).toThrow(/changed/);
  expect(hit).toBe(true);
  expect(p.layers[1].name).toBe('User edit');
  expect(p.layers[0].liveMotionSpans).toBeUndefined();
});

const square = (left: number, top: number, size: number) => [
  { x: left, y: top },
  { x: left + size, y: top },
  { x: left + size, y: top + size },
  { x: left, y: top + size },
];
for (const reverse of [false, true])
  for (const reversedOrder of [false, true])
    it(`grows or closes a real hole with unequal contour counts (${reverse}, ring order ${reversedOrder})`, () => {
      const p = fixture(),
        a = p.layers[0].keys[0].shapes[0],
        b = p.layers[0].keys[1].shapes[0];
      a.x = b.x = 0;
      a.y = b.y = 0;
      Object.assign(b, {
        kind: 'polygon',
        fillRule: 'evenodd',
        contours: [square(0, 0, 80), square(20, 20, 40)],
      });
      if (reversedOrder) b.contours!.reverse();
      if (reverse)
        [p.layers[0].keys[0].shapes, p.layers[0].keys[1].shapes] = [
          p.layers[0].keys[1].shapes,
          p.layers[0].keys[0].shapes,
        ];
      const before = structuredClone(p),
        q = convert(p, p.layers[0].id, 0, 'shape');
      expect(p).toEqual(before);
      expect(q.layers[0].keys).toEqual(before.layers[0].keys);
      for (const frame of [1, 2, 4, 6, 7]) {
        const mid = sample(q, frame)[0],
          hole = mid.contours![1],
          scale = reverse ? 1 - frame / 8 : frame / 8;
        expect(mid.contours).toHaveLength(2);
        for (const n of hole) {
          expect(Math.abs(n.x - 40)).toBeCloseTo(20 * scale, 8);
          expect(Math.abs(n.y - 40)).toBeCloseTo(20 * scale, 8);
        }
      }
      expect(sample(q, 0)).toEqual(before.layers[0].keys[0].shapes);
      expect(sample(q, 8)).toEqual(before.layers[0].keys[1].shapes);
      const reopened = validateProject(JSON.parse(JSON.stringify(q)));
      expect(sample(reopened, 4)).toEqual(sample(q, 4));
      const key = prepareTimelineKeyframe(q, q.layers[0].id, 4);
      expect(key.layers[0].keys.find((k) => k.frame === 4)!.shapes).toEqual(sample(q, 4));
    });
for (const reverse of [false, true])
  it(`grows or removes a disconnected island without discarding the enclosing contour (${reverse})`, () => {
    const p = fixture(),
      a = p.layers[0].keys[0].shapes[0],
      b = p.layers[0].keys[1].shapes[0];
    a.x = b.x = 0;
    a.y = b.y = 0;
    Object.assign(b, {
      kind: 'polygon',
      fillRule: 'evenodd',
      contours: [square(0, 0, 80), square(120, 20, 40)],
    });
    if (reverse)
      [p.layers[0].keys[0].shapes, p.layers[0].keys[1].shapes] = [
        p.layers[0].keys[1].shapes,
        p.layers[0].keys[0].shapes,
      ];
    const q = convert(p, p.layers[0].id, 0, 'shape'),
      mid = sample(q, 4)[0];
    expect(mid.contours).toHaveLength(2);
    expect(mid.contours![1].map((n) => n.x).sort((a, b) => a - b)).toEqual([95, 95, 115, 115]);
    expect(q.layers[0].keys).toEqual(p.layers[0].keys);
  });
for (const reverse of [false, true])
  it(`matches unequal artwork counts with detached fading/growing objects (${reverse})`, () => {
    const p = fixture();
    p.layers[0].keys[1].shapes.push({ ...p.layers[0].keys[1].shapes[0], id: 'extra', x: 220 });
    if (reverse)
      [p.layers[0].keys[0].shapes, p.layers[0].keys[1].shapes] = [
        p.layers[0].keys[1].shapes,
        p.layers[0].keys[0].shapes,
      ];
    const before = structuredClone(p),
      q = convert(p, p.layers[0].id, 0, 'shape'),
      mid = sample(q, 4);
    expect(mid).toHaveLength(2);
    expect(new Set(mid.map((s) => s.id)).size).toBe(2);
    expect(mid[1].opacity).toBe(0.5);
    expect(mid[1].x).toBeCloseTo(152, 8);
    expect(mid[1].width).toBe(40);
    expect(mid[1].height).toBe(40);
    expect(q.layers[0].keys).toEqual(before.layers[0].keys);
    expect(p).toEqual(before);
    const promoted = prepareTimelineKeyframe(q, q.layers[0].id, 4);
    expect(promoted.layers[0].keys.find((k) => k.frame === 4)!.shapes).toEqual(mid);
  });
for (const reverse of [false, true])
  it(`morphs open Pencil strokes to closed filled outlines (${reverse})`, () => {
    const p = fixture(),
      a = p.layers[0].keys[0].shapes[0];
    Object.assign(a, {
      kind: 'bezier',
      nodes: [
        { x: 0, y: 0, out: { x: 20, y: -20 } },
        { x: 80, y: 0, in: { x: 60, y: 20 } },
      ],
      fillEnabled: false,
      strokeWidth: 4,
    });
    if (reverse)
      [p.layers[0].keys[0].shapes, p.layers[0].keys[1].shapes] = [
        p.layers[0].keys[1].shapes,
        p.layers[0].keys[0].shapes,
      ];
    const before = structuredClone(p),
      q = convert(p, p.layers[0].id, 0, 'shape'),
      mid = sample(q, 4)[0];
    expect(mid.closed).toBe(true);
    expect(mid.nodes!.length).toBeGreaterThanOrEqual(4);
    expect(mid.gradient!.stops.every((s) => s.opacity === 0.5)).toBe(true);
    expect(mid.strokeWidth).toBe(2);
    expect(q.layers[0].keys).toEqual(before.layers[0].keys);
    expect(p).toEqual(before);
    validateProject({
      ...q,
      duration: 1,
      layers: [{ ...q.layers[0], liveMotionSpans: undefined, keys: [{ frame: 0, shapes: [mid] }] }],
    });
    const promoted = prepareTimelineKeyframe(q, q.layers[0].id, 4);
    expect(promoted.layers[0].keys.find((k) => k.frame === 4)!.shapes).toEqual([mid]);
  });
it('keeps transient object IDs distinct when a newly appearing target reuses a source ID', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes.push({ ...p.layers[0].keys[1].shapes[0], id: 'square', x: 220 });
  const q = convert(p, p.layers[0].id, 0, 'shape'),
    mid = sample(q, 4);
  expect(new Set(mid.map((s) => s.id)).size).toBe(2);
  expect(sample(validateProject(JSON.parse(JSON.stringify(q))), 4)).toEqual(mid);
});
it('keeps explicit continuous topology guards authoritative when contours are born', () => {
  const p = fixture(),
    b = p.layers[0].keys[1].shapes[0];
  Object.assign(b, {
    kind: 'polygon',
    fillRule: 'evenodd',
    contours: [square(0, 0, 80), square(20, 20, 40)],
  });
  const q = convert(p, p.layers[0].id, 0, 'shape');
  q.layers[0].liveMotionSpans![0].options!.contourAreas = true;
  const before = structuredClone(q);
  expect(() => sample(q, 4)).toThrow();
  expect(q).toEqual(before);
});

for (const reverse of [false, true])
  it(`morphs a separate pressure Brush object through its actual paint footprint (${reverse})`, () => {
    const p = fixture(),
      a = p.layers[0].keys[0].shapes[0];
    Object.assign(a, {
      kind: 'brush',
      strokeWidth: 16,
      brush: { pressure: true, minimum: 0.2, tilt: false, aspect: 1, angle: 0 },
      points: Array.from({ length: 41 }, (_, i) => ({
        x: i * 2,
        y: Math.sin(i / 20) * 8,
        pressure: 0.4 + i / 100,
      })),
    });
    if (reverse)
      [p.layers[0].keys[0].shapes, p.layers[0].keys[1].shapes] = [
        p.layers[0].keys[1].shapes,
        p.layers[0].keys[0].shapes,
      ];
    const before = structuredClone(p),
      q = convert(p, p.layers[0].id, 0, 'shape'),
      mid = sample(q, 4)[0];
    expect(mid.kind === 'bezier' || mid.kind === 'polygon').toBe(true);
    expect(mid.brush).toBeUndefined();
    expect(mid.strokeWidth).toBe(0);
    expect(q.layers[0].keys).toEqual(before.layers[0].keys);
    expect(p).toEqual(before);
    const promoted = prepareTimelineKeyframe(q, q.layers[0].id, 4);
    expect(promoted.layers[0].keys.find((k) => k.frame === 4)!.shapes).toEqual([mid]);
  });
it('keeps an enclosing boundary stable when the new compound uses reversed winding and a rotated start', () => {
  const p = fixture(),
    a = p.layers[0].keys[0].shapes[0],
    b = p.layers[0].keys[1].shapes[0];
  a.x = b.x = 0;
  a.y = b.y = 0;
  const outer = square(0, 0, 80).reverse();
  outer.push(outer.shift()!);
  Object.assign(b, { kind: 'polygon', fillRule: 'evenodd', contours: [square(20, 20, 40), outer] });
  const q = convert(p, p.layers[0].id, 0, 'shape'),
    mid = sample(q, 4)[0];
  for (const n of mid.contours![0]) expect([0, 80]).toContain(n.x);
  for (const n of mid.contours![0]) expect([0, 80]).toContain(n.y);
});
it('retains native closed two-anchor cubic outlines through private exact subdivision', () => {
  const p = fixture(),
    a = p.layers[0].keys[0].shapes[0];
  Object.assign(a, {
    kind: 'bezier',
    closed: true,
    nodes: [
      { x: 0, y: 40, in: { x: 0, y: 0 }, out: { x: 0, y: 80 } },
      { x: 80, y: 40, in: { x: 80, y: 80 }, out: { x: 80, y: 0 } },
    ],
  });
  const before = structuredClone(p),
    q = convert(p, p.layers[0].id, 0, 'shape');
  expect(sample(q, 4)[0].nodes!.length).toBeGreaterThanOrEqual(4);
  expect(q.layers[0].keys).toEqual(before.layers[0].keys);
  expect(p).toEqual(before);
});
it('matches equivalent primitive fill defaults without making them incompatible artwork', () => {
  const p = fixture(),
    a = p.layers[0].keys[0].shapes[0],
    b = p.layers[0].keys[1].shapes[0];
  b.kind = 'rectangle';
  b.fillEnabled = true;
  b.fillRule = 'nonzero';
  expect(a.fillEnabled).toBeUndefined();
  expect(sample(convert(p, p.layers[0].id, 0, 'shape'), 4)[0].fillEnabled).toBe(true);
});

it('prepares topology-changing remembered motion atomically across tracks and refreshes saved recipes', () => {
  const p = fixture(),
    b = p.layers[0].keys[1].shapes[0];
  Object.assign(b, {
    kind: 'polygon',
    fillRule: 'evenodd',
    contours: [square(0, 0, 80), square(20, 20, 40)],
  });
  const second = structuredClone(p.layers[0]);
  second.id = p.layers[1].id;
  second.locked = true;
  p.layers[1] = second;
  const before = structuredClone(p),
    ids = p.layers.map((l) => l.id),
    options = { nodes: true, primitives: true, paint: true, affine: true, strokeWidth: true },
    correspondence = { nodes: { curves: true, shapes: true } };
  expect(() =>
    createBasicMotionSpan(p, ids, 0, 8, 'linear', options, undefined, undefined, correspondence),
  ).toThrow();
  expect(p).toEqual(before);
  second.locked = false;
  createBasicMotionSpan(p, ids, 0, 8, 'linear', options, undefined, undefined, correspondence);
  const q = validateProject(JSON.parse(JSON.stringify(p))),
    keys = structuredClone(q.layers.map((l) => l.keys));
  refreshBasicMotionSpan(q, ids, 0, 8);
  expect(q.layers.map((l) => l.keys)).toEqual(keys);
  for (let i = 0; i < 2; i++) {
    expect(q.layers[i].keys[0]).toEqual(before.layers[i].keys[0]);
    expect(q.layers[i].keys.find((k) => k.frame === 8)).toEqual(before.layers[i].keys[1]);
    expect(q.layers[i].keys.find((k) => k.frame === 10)).toEqual(before.layers[i].keys[2]);
  }
});
for (const defaults of [false, true])
  it(`retains explicit saved/default pivot admission with unequal artwork counts (${defaults})`, () => {
    const p = fixture();
    p.layers[0].keys[1].shapes.push({ ...p.layers[0].keys[1].shapes[0], id: 'extra', x: 220 });
    if (!defaults)
      for (const key of p.layers[0].keys) for (const s of key.shapes) s.pivot = { x: 4, y: 10 };
    const q = convert(p, p.layers[0].id, 0, 'shape');
    q.layers[0].liveMotionSpans![0].options!.pivots = true;
    if (defaults) q.layers[0].liveMotionSpans![0].options!.defaultPivots = true;
    const mid = sample(q, 4);
    expect(mid).toHaveLength(2);
    expect(mid.every((s) => Number.isFinite(s.pivot!.x) && Number.isFinite(s.pivot!.y))).toBe(true);
    expect(q.layers[0].keys).toEqual(p.layers[0].keys);
  });
it('rejects original contour accessors before executing them during shape matching', () => {
  const p = fixture();
  let reads = 0;
  const b = p.layers[0].keys[1].shapes[0];
  Object.defineProperty(b, 'contours', {
    enumerable: true,
    get() {
      reads++;
      return [square(0, 0, 80), square(20, 20, 40)];
    },
  });
  expect(() => matchShapeTweenArtwork(p.layers[0].keys[0].shapes[0], b)).toThrow();
  expect(reads).toBe(0);
});

it('scopes overrides over legacy shared hints and rejects changed endpoint ownership',()=>{
  const p=fixture(), layer=p.layers[0];
  layer.keys.slice(0,2).forEach(key=>key.shapes.push({...key.shapes[0],id:'neighbor',x:200}));
  const q=convert(p,layer.id,0,'shape');
  const span=q.layers[0].liveMotionSpans![0], nodes=span.correspondence!.nodes;
  if (!nodes || typeof nodes !== 'object') throw Error('Expected shape matching');
  nodes.hints=[[[1,2]]];
  const before=structuredClone(q), original=sample(q,4);
  const edit={kind:'shape' as const,start:0,end:8,affine:false,ease:span.ease,createEndpoints:false,
    shapeHints:{spanId:span.id,text:'',pair:{sourceId:'neighbor',targetId:'neighbor'}}};
  const updated=prepareTimelineTween(q,layer.id,edit);
  const mid=sample(updated,4);
  expect(mid[0]).toEqual(original[0]); expect(mid[1]).not.toEqual(original[1]);
  expect(q).toEqual(before);
  const restored=prepareTimelineTween(updated,layer.id,{...edit,shapeHints:{...edit.shapeHints,text:'1:2'}});
  expect(restored).toEqual(before);
  updated.layers[0].keys[1].shapes.reverse();
  expect(()=>sample(updated,4)).toThrow(/original endpoint pair/);
  expect(()=>prepareTimelineTween(q,layer.id,{...edit,shapeHints:{...edit.shapeHints,
    pair:{sourceId:'square',targetId:'neighbor'}}})).toThrow(/original artwork/);
});
it('rejects malformed or duplicate artwork hint ownership before reading accessors',()=>{
  const entry={sourceId:'a',targetId:'b',hints:[[[1,2]]]};
  for (const entries of [[],[entry,entry],[{...entry,targetId:''}],[{...entry,hints:[[[1,2],[2,1]]]}]])
    expect(()=>validateMotionNodeMatching({curves:true,shapes:true,artworkHints:entries})).toThrow();
  const getter=vi.fn(()=>[entry]);
  const mode=Object.defineProperty({curves:true,shapes:true},'artworkHints',{get:getter,enumerable:true});
  expect(()=>validateMotionNodeMatching(mode)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it('reverses saved artwork-specific correspondence with the endpoint geometry',()=>{
  const p=fixture(), layer=p.layers[0];
  // Stable artwork identity permits the exact reconstruction required by reversal.
  const a=layer.keys[0].shapes[0];
  a.kind='bezier'; a.nodes=[{x:0,y:0},{x:20,y:12},{x:60,y:20}];
  const b=structuredClone(a);
  b.nodes!.splice(1,0,{x:10,y:4});
  layer.keys[1].shapes=[b];
  const nodes={curves:true,shapes:true,artworkHints:[{sourceId:a.id,targetId:b.id,hints:[[[1,2] as const]]}]};
  createBasicMotionSpan(p,[layer.id],0,8,'linear',{nodes:true},undefined,undefined,{nodes});
  const middle=structuredClone(layer.keys.find(key=>key.frame===4)?.shapes);
  reverseBasicMotionSpan(p,[layer.id],0,8);
  const reversed=layer.motionSpans![0].correspondence!.nodes;
  expect(typeof reversed==='object' && reversed.artworkHints?.[0].hints).toEqual([[[2,1]]]);
  expect(layer.keys.find(key=>key.frame===4)?.shapes).toEqual(middle);
});

it('keeps a hinted hole on its original authored ring after another contour grows past it', () => {
  const p = fixture(), layer = p.layers[0], outer = square(0,0,120);
  const originalHole = square(20,20,35);
  Object.assign(layer.keys[0].shapes[0], {kind:'polygon',fillRule:'evenodd',contours:[outer,originalHole]});
  Object.assign(layer.keys[1].shapes[0], {kind:'polygon',fillRule:'evenodd',
    contours:[square(80,80,6),outer,originalHole]});
  const live = convert(p,layer.id,0,'shape'), span = live.layers[0].liveMotionSpans![0];
  const edit = {kind:'shape' as const,start:0,end:8,affine:false,ease:span.ease,createEndpoints:false,
    shapeHints:{spanId:span.id,text:'; 1:2'}};
  const saved = prepareTimelineTween(live,layer.id,edit), original = sample(saved,4)[0];
  const reopened = validateProject(JSON.parse(JSON.stringify(saved)));
  const target = reopened.layers[0].keys[1].shapes[0];
  target.contours![0] = square(65,65,50);
  const pose = sample(reopened,4)[0];
  expect(pose.contours![1]).toEqual(original.contours![1]);
  expect(pose.contours![2]).not.toEqual(original.contours![2]);
  const pair = {sourceId:'square',targetId:'new-circle'};
  const clear = prepareTimelineTween(reopened,layer.id,{...edit,shapeHints:{...edit.shapeHints,pair,text:''}});
  expect(sample(clear,4)[0].contours![1]).not.toEqual(original.contours![1]);
  expect(reopened.layers[0].keys).toEqual(clear.layers[0].keys);
  target.contours!.pop();
  expect(()=>sample(reopened,4)).toThrow(/contour topology/);
});

it('rejects ambiguous or malformed saved contour ownership', () => {
  const entry = {sourceId:'a',targetId:'b',hints:[[[1,2]],[[1,1]]]};
  for (const contourOwners of [[[0,1]], [[0,1],[0,2]], [[0,1],[1,1]],
      [[0,-1],[1,2]], [[0,1],[1,NaN]], [null,[1,2]]]) {
    expect(()=>validateMotionNodeMatching({curves:true,shapes:true,
      artworkHints:[{...entry,contourOwners}]})).toThrow(/ownership|indices|finite original/);
  }
});

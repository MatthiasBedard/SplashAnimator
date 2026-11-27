import {
  validateMotionContourAreas,
  validateMotionContourEdges,
} from '../packages/animation/src/motion-nodes';
import { motionRotationDelta } from '../packages/animation/src/motion-rotation';
import { motionPathPosition, createMotionPathSampler } from '../packages/animation/src/motion-path';
import { expect, it } from 'vitest';
import {
  clone,
  newProject,
  newLayer,
  type Vector,
  type SymbolDefinition,
} from '../packages/document/src';
import {
  generateMotionFrames,
  generateSymbolMotionFrames,
  motionProgress,
  parseMotionGradientPairs,
  type MotionGradientStops,
  type MotionEase,
} from '../packages/animation/src/motion-frames';
const shape = (): Vector => ({
  id: 'a',
  kind: 'bezier',
  x: 0,
  y: 20,
  width: 100,
  height: 50,
  rotation: 350,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 2,
  points: [],
  nodes: [
    { x: 0, y: 0, out: { x: 20, y: 10 } },
    { x: 100, y: 50, in: { x: 80, y: 30 } },
  ],
  groups: ['outer'],
  transform: [1, 0.2, 0.3, 1],
});
function fixture() {
  const p = newProject();
  p.duration = 10;
  p.layers[0].drawingMode = 'object';
  const a = shape();
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 4, shapes: [{ ...clone(a), x: 80, y: 60, rotation: 10, opacity: 0.2 }] },
    { frame: 8, shapes: [] },
  ];
  return p;
}
it('generates detached motion keys with shortest rotation and exact endpoint/outside preservation', () => {
  const p = fixture(),
    before = clone(p);
  generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear');
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 2, 3, 4, 8]);
  const mid = p.layers[0].keys[2].shapes[0];
  expect(mid.x).toBe(40);
  expect(mid.y).toBe(40);
  expect(mid.rotation).toBe(360);
  expect(mid.opacity).toBeCloseTo(0.6);
  expect(mid.nodes).toEqual(shape().nodes);
  expect(mid.groups).toEqual(['outer']);
  expect(mid.transform).toEqual(shape().transform);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  expect(p.layers[0].keys[5]).toEqual(before.layers[0].keys[2]);
  mid.nodes![0].x = 25;
  expect(p.layers[0].keys[0].shapes[0].nodes![0].x).toBe(0);
  expect(p.duration).toBe(10);
});
it('uses four deterministic easing curves', () => {
  for (const [ease, quarter] of [
    ['linear', 0.25],
    ['in', 0.0625],
    ['out', 0.4375],
    ['in-out', 0.125],
  ] as const) {
    expect(motionProgress(0, ease)).toBe(0);
    expect(motionProgress(0.25, ease)).toBe(quarter);
    expect(motionProgress(1, ease)).toBe(1);
    const p = fixture();
    generateMotionFrames(p, [p.layers[0].id], 0, 4, ease);
    expect(p.layers[0].keys[1].shapes[0].x).toBe(80 * quarter);
  }
});
it('rejects protected or incompatible batches without partial writes', () => {
  for (const mode of [
    'locked',
    'hidden',
    'paint',
    'geometry',
    'identity',
    'symbol',
    'blank',
    'inside',
  ]) {
    const p = fixture(),
      second = newLayer('Other');
    second.keys = clone(p.layers[0].keys);
    p.layers.push(second);
    if (mode === 'locked') second.locked = true;
    if (mode === 'hidden') second.visible = false;
    const end = second.keys[1].shapes[0];
    if (mode === 'paint') end.fill = '#0000ff';
    if (mode === 'geometry') end.width++;
    if (mode === 'identity') end.id = 'other';
    if (mode === 'symbol') second.keys.forEach((k) => k.shapes.forEach((s) => (s.kind = 'symbol')));
    if (mode === 'blank') second.keys[1].shapes = [];
    if (mode === 'inside') second.keys.splice(1, 0, { frame: 2, shapes: [] });
    const before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        4,
        'linear',
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('rejects invalid ranges/easing and accepts endpoint field order differences', () => {
  const p = fixture(),
    before = clone(p);
  for (const [a, b] of [
    [0, 1],
    [-1, 4],
    [0, 10],
    [0, 2.5],
  ])
    expect(() => generateMotionFrames(p, [p.layers[0].id], a, b, 'linear')).toThrow();
  expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, 'wrong' as MotionEase)).toThrow();
  expect(p).toEqual(before);
  p.layers[0].keys[1].shapes[0] = Object.fromEntries(
    Object.entries(p.layers[0].keys[1].shapes[0]).reverse(),
  ) as Vector;
  generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear');
  expect(p.layers[0].keys).toHaveLength(6);
});
it('generates symbol keys without mutating source or fixed state mappings', () => {
  const p = fixture(),
    keys = p.layers[0].keys;
  const def: SymbolDefinition = {
    id: 's',
    name: 'Motion',
    width: 100,
    height: 100,
    shapes: keys[0].shapes,
    timeline: { duration: 10, keys: keys.slice(1) },
    buttonStates: { up: 0, over: 1, down: 4, hit: 8 },
  };
  const before = clone(def),
    result = generateSymbolMotionFrames(def, ['@base'], 0, 4, 'in-out');
  expect(def).toEqual(before);
  expect(result.buttonStates).toEqual(def.buttonStates);
  expect(result.timeline!.duration).toBe(10);
  expect(result.timeline!.keys.map((k) => k.frame)).toEqual([1, 2, 3, 4, 8]);
  expect(result.shapes).toEqual(def.shapes);
});

it('takes the shortest arc across negative and multiple-turn endpoint angles', () => {
  for (const [a, b, expected] of [
    [350, -350, 360],
    [-350, 350, -360],
    [710, -350, 720],
    [-710, 350, -720],
  ]) {
    const p = fixture();
    p.layers[0].keys[0].shapes[0].rotation = a;
    p.layers[0].keys[1].shapes[0].rotation = b;
    generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear');
    expect(p.layers[0].keys[2].shapes[0].rotation).toBe(expected);
  }
});

it('solves custom curve time before sampling progress, including flat tangents', () => {
  const curve = { kind: 'cubic' as const, x1: 0, x2: 0, y1: 1 / 3, y2: 2 / 3 };
  expect(motionProgress(0.125, curve)).toBeCloseTo(0.5, 12);
  expect(motionProgress(1e-12, curve)).toBeCloseTo(1e-4, 12);
  expect(motionProgress(0, curve)).toBe(0);
  expect(motionProgress(1, curve)).toBe(1);
  const p = fixture();
  generateMotionFrames(p, [p.layers[0].id], 0, 4, curve);
  expect(p.layers[0].keys[2].shapes[0].x).toBeCloseTo(80 * Math.cbrt(0.5), 10);
});
it('keeps bounded custom curves monotonic even with reversed time handles', () => {
  for (const curve of [
    { kind: 'cubic' as const, x1: 1, x2: 0, y1: 0, y2: 1 },
    { kind: 'cubic' as const, x1: 0, x2: 1, y1: 1, y2: 0 },
  ]) {
    let previous = 0;
    for (let i = 0; i <= 100; i++) {
      const value = motionProgress(i / 100, curve);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  }
});
it('rejects invalid custom controls atomically for main and symbol generation', () => {
  for (const key of ['x1', 'y1', 'x2', 'y2'])
    for (const value of [-0.01, 1.01, NaN, Infinity]) {
      const curve = { kind: 'cubic' as const, x1: 0, y1: 0, x2: 1, y2: 1, [key]: value };
      const p = fixture(),
        before = clone(p);
      expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, curve)).toThrow(
        'between 0 and 1',
      );
      expect(p).toEqual(before);
      const def: SymbolDefinition = {
        id: 's',
        name: 's',
        width: 100,
        height: 100,
        shapes: p.layers[0].keys[0].shapes,
        timeline: { duration: 10, keys: p.layers[0].keys.slice(1) },
      };
      const original = clone(def);
      expect(() => generateSymbolMotionFrames(def, ['@base'], 0, 4, curve)).toThrow(
        'between 0 and 1',
      );
      expect(def).toEqual(original);
    }
});

it('interpolates decomposed scale and shear with combined shortest rotation and unchanged geometry', () => {
  for (const reflection of [1, -1]) {
    const p = fixture();
    p.layers[0].keys[0].shapes[0].transform = [1, 0, 0, 2 * reflection];
    p.layers[0].keys[0].shapes[0].rotation = 10;
    p.layers[0].keys[1].shapes[0].transform = [0, 3, -4 * reflection, 2];
    p.layers[0].keys[1].shapes[0].rotation = 30;
    const before = clone(p);
    expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear')).toThrow();
    expect(p).toEqual(before);
    generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', true);
    const mid = p.layers[0].keys[2].shapes[0];
    expect(mid.transform).toEqual([2, 0, 1, 3 * reflection]);
    expect(mid.rotation).toBe(65);
    expect(mid.nodes).toEqual(before.layers[0].keys[0].shapes[0].nodes);
    expect(mid.groups).toEqual(['outer']);
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
    expect(p.layers[0].keys[5]).toEqual(before.layers[0].keys[2]);
  }
});
it('rotates through opposing bases without a collapsed intermediate transform', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[0].transform = [1, 0, 0, 1];
  p.layers[0].keys[1].shapes[0].transform = [-1, 0, 0, -1];
  p.layers[0].keys[0].shapes[0].rotation = 0;
  p.layers[0].keys[1].shapes[0].rotation = 0;
  generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', true);
  expect(p.layers[0].keys[2].shapes[0].rotation).toBe(-90);
  expect(p.layers[0].keys[2].shapes[0].transform).toEqual([1, 0, 0, 1]);
});
it('rejects reflection changes, singular and overflowing transforms across batches atomically', () => {
  for (const transform of [
    [1, 0, 0, -1],
    [1, 0, 0, 0],
    [0, 0, 1, 1],
    [Infinity, 0, 0, 1],
    [1e6, 0, 0, 1],
  ]) {
    const p = fixture(),
      second = newLayer('Other');
    second.keys = clone(p.layers[0].keys);
    second.keys[1].shapes[0].transform = transform as [number, number, number, number];
    p.layers.push(second);
    const before = structuredClone(p);
    expect(() =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        4,
        'linear',
        true,
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('uses easing for scale and skew in detached symbol drafts', () => {
  const p = fixture();
  delete p.layers[0].keys[0].shapes[0].transform;
  p.layers[0].keys[1].shapes[0].transform = [3, 0, 2, 5];
  const def: SymbolDefinition = {
    id: 's',
    name: 's',
    width: 100,
    height: 100,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 10, keys: p.layers[0].keys.slice(1) },
    buttonStates: { up: 0, over: 1, down: 4, hit: 8 },
  };
  const before = clone(def);
  const result = generateSymbolMotionFrames(def, ['@base'], 0, 4, 'in', true);
  expect(result.timeline!.keys[1].shapes[0].transform).toEqual([1.5, 0, 0.5, 2]);
  expect(result.buttonStates).toEqual(def.buttonStates);
  expect(def).toEqual(before);
});

it('interpolates RGB fill/stroke and matching gradient colors/opacity without changing paint geometry', () => {
  const p = fixture(),
    first = p.layers[0].keys[0].shapes[0],
    last = p.layers[0].keys[1].shapes[0];
  first.gradient = {
    kind: 'linear',
    from: { x: 0, y: 0 },
    to: { x: 100, y: 50 },
    transform: [1, 0.1, 0.2, 1],
    stops: [
      { offset: 0, color: '#FF0000' },
      { offset: 1, color: '#000000', opacity: 0.2 },
    ],
  };
  last.gradient = clone(first.gradient);
  last.fill = '#0000ff';
  last.stroke = '#00ff00';
  last.gradient.stops[0].color = '#0000ff';
  last.gradient.stops[0].opacity = 0;
  last.gradient.stops[1].color = '#ffffff';
  last.gradient.stops[1].opacity = 0.8;
  const before = clone(p);
  expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear')).toThrow();
  expect(p).toEqual(before);
  generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', false, true);
  const mid = p.layers[0].keys[2].shapes[0];
  expect(mid.fill).toBe('#800080');
  expect(mid.stroke).toBe('#008000');
  expect(mid.gradient).toEqual({
    ...first.gradient,
    stops: [
      { offset: 0, color: '#800080', opacity: 0.5 },
      { offset: 1, color: '#808080', opacity: 0.5 },
    ],
  });
  expect(mid.nodes).toEqual(first.nodes);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  mid.gradient!.from.x = 20;
  expect(p.layers[0].keys[1].shapes[0].gradient!.from.x).toBe(0);
});
it('rejects incompatible gradient geometry and invalid paint in an entire batch', () => {
  for (const mode of ['stop-count', 'offset', 'kind', 'transform', 'color', 'opacity']) {
    const p = fixture(),
      second = newLayer('Other');
    second.keys = clone(p.layers[0].keys);
    const first = second.keys[0].shapes[0],
      last = second.keys[1].shapes[0];
    first.gradient = {
      kind: 'radial',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    };
    last.gradient = clone(first.gradient);
    if (mode === 'stop-count') last.gradient.stops.pop();
    if (mode === 'offset') last.gradient.stops[0].offset = 0.2;
    if (mode === 'kind') last.gradient.kind = 'linear';
    if (mode === 'transform') last.gradient.transform = [2, 0, 0, 1];
    if (mode === 'color') last.stroke = '#abc';
    if (mode === 'opacity') last.gradient.stops[0].opacity = 2;
    p.layers.push(second);
    const before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        4,
        'linear',
        false,
        true,
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('combines eased paint and affine motion in a detached symbol draft', () => {
  const p = fixture();
  delete p.layers[0].keys[0].shapes[0].transform;
  Object.assign(p.layers[0].keys[1].shapes[0], {
    transform: [3, 0, 2, 5],
    fill: '#0000ff',
    stroke: '#00ff00',
  });
  const def: SymbolDefinition = {
    id: 's',
    name: 's',
    width: 100,
    height: 100,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 10, keys: p.layers[0].keys.slice(1) },
  };
  const before = clone(def);
  const result = generateSymbolMotionFrames(def, ['@base'], 0, 4, 'in', true, true);
  expect(result.timeline!.keys[1].shapes[0]).toMatchObject({
    fill: '#bf0040',
    stroke: '#004000',
    transform: [1.5, 0, 0.5, 2],
  });
  expect(def).toEqual(before);
});

it('interpolates ordered cubic anchors and handles without resampling or mutating endpoints', () => {
  const p = fixture(),
    last = p.layers[0].keys[1].shapes[0];
  last.nodes = [
    { x: 20, y: 40, out: { x: 60, y: 50 } },
    { x: 80, y: 10, in: { x: 40, y: 70 } },
  ];
  const before = clone(p);
  expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear')).toThrow();
  expect(p).toEqual(before);
  generateMotionFrames(p, [p.layers[0].id], 0, 4, 'in', false, false, true);
  const mid = p.layers[0].keys[2].shapes[0];
  expect(mid.nodes).toEqual([
    { x: 5, y: 10, out: { x: 30, y: 20 } },
    { x: 95, y: 40, in: { x: 70, y: 40 } },
  ]);
  expect(mid.transform).toEqual(before.layers[0].keys[0].shapes[0].transform);
  expect(mid.groups).toEqual(['outer']);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  expect(p.layers[0].keys[5]).toEqual(before.layers[0].keys[2]);
  mid.nodes![0].out!.x = 100;
  expect(p.layers[0].keys[1].shapes[0].nodes![0].out!.x).toBe(22.5);
});
it('interpolates compound contour coordinates in detached symbol drafts', () => {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2)) {
    const shape = key.shapes[0];
    shape.kind = 'polygon';
    delete shape.nodes;
    shape.fillRule = 'evenodd';
    shape.contours = [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      [
        { x: 20, y: 10 },
        { x: 40, y: 10 },
        { x: 40, y: 20 },
      ],
    ];
  }
  p.layers[0].keys[1].shapes[0].contours![1][0].x = 28;
  const def: SymbolDefinition = {
    id: 's',
    name: 's',
    width: 100,
    height: 100,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 10, keys: p.layers[0].keys.slice(1) },
  };
  const before = clone(def),
    result = generateSymbolMotionFrames(def, ['@base'], 0, 4, 'linear', false, false, true);
  expect(result.timeline!.keys[1].shapes[0].contours![1][0].x).toBe(24);
  expect(result.timeline!.keys[1].shapes[0].contours![0]).toEqual(def.shapes[0].contours![0]);
  expect(def).toEqual(before);
});
it('rejects mismatched node correspondence, metadata and nonfinite coordinates atomically', () => {
  for (const mode of ['count', 'handle', 'closed', 'metadata', 'nonfinite', 'brush']) {
    const p = fixture(),
      second = newLayer('Other');
    second.keys = clone(p.layers[0].keys);
    p.layers.push(second);
    const last = second.keys[1].shapes[0];
    if (mode === 'count') last.nodes!.push({ x: 1, y: 1 });
    if (mode === 'handle') delete last.nodes![0].out;
    if (mode === 'closed') last.closed = true;
    if (mode === 'metadata') last.nodes![0].pressure = 0.5;
    if (mode === 'nonfinite') last.nodes![0].x = Infinity;
    if (mode === 'brush') {
      for (const key of second.keys.slice(0, 2)) {
        key.shapes[0].kind = 'brush';
        delete key.shapes[0].nodes;
        key.shapes[0].points = [{ x: 0, y: 0, pressure: 1 }];
      }
      last.points[0].x = 1;
    }
    const before = structuredClone(p);
    expect(() =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        4,
        'linear',
        false,
        false,
        true,
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});

it('follows a cubic position path with exact endpoints and independent rotation', () => {
  const p = fixture(),
    before = clone(p),
    path = { startX: 0, startY: -40, endX: 0, endY: -40 };
  generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', false, false, false, path);
  expect(p.layers[0].keys[1].shapes[0]).toMatchObject({ x: 12.5, y: 3.75, rotation: 355 });
  expect(p.layers[0].keys[2].shapes[0]).toMatchObject({ x: 40, y: 10, rotation: 360 });
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
  expect(p.layers[0].keys[5]).toEqual(before.layers[0].keys[2]);
  const a = { x: 10, y: 20 },
    b = { x: 90, y: 60 };
  expect(motionPathPosition(a, b, 0, path)).toEqual(a);
  expect(motionPathPosition(a, b, 1, path)).toEqual(b);
});
it('uses easing on the cubic parameter and offsets relative to each object origin', () => {
  const p = fixture(),
    path = { startX: 20, startY: -40, endX: -20, endY: -40 };
  for (const key of p.layers[0].keys.slice(0, 2))
    key.shapes.push({
      ...clone(key.shapes[0]),
      id: 'b',
      x: key.shapes[0].x + 200,
      y: key.shapes[0].y + 100,
    });
  generateMotionFrames(p, [p.layers[0].id], 0, 4, 'in', false, false, false, path);
  const [a, b] = p.layers[0].keys[2].shapes;
  expect(a.x).toBe(18.125);
  expect(a.y).toBe(3.75);
  expect(b.x - a.x).toBe(200);
  expect(b.y - a.y).toBe(100);
});
it('rejects invalid path controls and overflowing control positions atomically', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const p = fixture(),
      before = clone(p);
    expect(() =>
      generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', false, false, false, {
        startX: value,
        startY: 0,
        endX: 0,
        endY: 0,
      }),
    ).toThrow('finite');
    expect(p).toEqual(before);
  }
  const p = fixture(),
    second = newLayer('Other');
  second.keys = clone(p.layers[0].keys);
  second.keys[0].shapes[0].x = Number.MAX_VALUE;
  p.layers.push(second);
  const before = clone(p);
  expect(() =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
      0,
      4,
      'linear',
      false,
      false,
      false,
      { startX: Number.MAX_VALUE, startY: 0, endX: 0, endY: 0 },
    ),
  ).toThrow('numeric limits');
  expect(p).toEqual(before);
});
it('generates a detached symbol path without changing state mappings', () => {
  const p = fixture(),
    def: SymbolDefinition = {
      id: 's',
      name: 's',
      width: 100,
      height: 100,
      shapes: p.layers[0].keys[0].shapes,
      timeline: { duration: 10, keys: p.layers[0].keys.slice(1) },
      buttonStates: { up: 0, over: 1, down: 4, hit: 8 },
    };
  const before = clone(def),
    result = generateSymbolMotionFrames(def, ['@base'], 0, 4, 'linear', false, false, false, {
      startX: 0,
      startY: -40,
      endX: 0,
      endY: -40,
    });
  expect(result.timeline!.keys[1].shapes[0].y).toBe(10);
  expect(result.buttonStates).toEqual(def.buttonStates);
  expect(def).toEqual(before);
});

it('maps distance on straight nonuniform cubic paths and preserves exact endpoints', () => {
  const a = { x: 0, y: 0 },
    b = { x: 100, y: 0 },
    path = { startX: 0, startY: 0, endX: -100, endY: 0, distance: true };
  const sample = createMotionPathSampler(a, b, path);
  for (const t of [0.01, 0.125, 0.25, 0.5, 0.75, 0.99]) {
    expect(sample(t).x).toBeCloseTo(t * 100, 2);
    expect(sample(t).y).toBe(0);
  }
  expect(sample(0)).toEqual(a);
  expect(sample(1)).toEqual(b);
  expect(motionPathPosition(a, b, 0.25, path).x).toBe(1.5625);
});
it('matches an independent dense arc-length reference on curved and returning paths', () => {
  for (const end of [
    { x: 120, y: 40 },
    { x: 0, y: 0 },
  ]) {
    const path = { startX: 90, startY: -160, endX: -80, endY: 120, distance: true };
    const sample = createMotionPathSampler({ x: 0, y: 0 }, end, path);
    const points = [{ x: 0, y: 0, length: 0 }];
    for (let i = 1; i <= 20000; i++) {
      const u = i / 20000,
        v = 1 - u;
      const x = 3 * v * v * u * 90 + 3 * v * u * u * (end.x - 80) + u * u * u * end.x;
      const y = 3 * v * v * u * -160 + 3 * v * u * u * (end.y + 120) + u * u * u * end.y;
      const prior = points[i - 1];
      points.push({ x, y, length: prior.length + Math.hypot(x - prior.x, y - prior.y) });
    }
    for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const wanted = points.at(-1)!.length * fraction,
        i = points.findIndex((p) => p.length >= wanted);
      const a = points[i - 1],
        b = points[i],
        t = (wanted - a.length) / (b.length - a.length),
        actual = sample(fraction);
      expect(
        Math.hypot(actual.x - (a.x + (b.x - a.x) * t), actual.y - (a.y + (b.y - a.y) * t)),
      ).toBeLessThan(0.005);
    }
  }
  const zero = createMotionPathSampler(
    { x: 4, y: 5 },
    { x: 4, y: 5 },
    { startX: 0, startY: 0, endX: 0, endY: 0, distance: true },
  );
  expect(zero(0.4)).toEqual({ x: 4, y: 5 });
});
it('applies easing to distance and rejects unrepresentable distance batches atomically', () => {
  const p = fixture();
  generateMotionFrames(p, [p.layers[0].id], 0, 4, 'in', false, false, false, {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    distance: true,
  });
  expect(p.layers[0].keys[2].shapes[0].x).toBeCloseTo(20, 2);
  expect(p.layers[0].keys[2].shapes[0].y).toBeCloseTo(30, 2);
  const bad = fixture(),
    before = clone(bad);
  expect(() =>
    generateMotionFrames(bad, [bad.layers[0].id], 0, 4, 'linear', false, false, false, {
      startX: Number.MAX_VALUE,
      startY: 0,
      endX: -Number.MAX_VALUE,
      endY: 0,
      distance: true,
    }),
  ).toThrow('numeric limits');
  expect(bad).toEqual(before);
});

it('interpolates primitive dimensions and authored corner radii only when enabled', () => {
  for (const kind of ['rectangle', 'ellipse'] as const) {
    const p = fixture();
    for (const key of p.layers[0].keys.slice(0, 2)) {
      key.shapes[0].kind = kind;
      delete key.shapes[0].nodes;
    }
    const target = p.layers[0].keys[1].shapes[0];
    target.width = 200;
    target.height = 10;
    if (kind === 'rectangle') target.cornerRadius = 100;
    const before = clone(p);
    expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, 'in')).toThrow(/same ordered/);
    expect(p).toEqual(before);
    generateMotionFrames(p, [p.layers[0].id], 0, 4, 'in', false, false, false, undefined, true);
    const mid = p.layers[0].keys[2].shapes[0];
    expect(mid.width).toBe(125);
    expect(mid.height).toBe(40);
    expect(mid.cornerRadius).toBe(kind === 'rectangle' ? 25 : undefined);
    expect(mid.transform).toEqual(before.layers[0].keys[0].shapes[0].transform);
    expect(mid.strokeWidth).toBe(2);
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
    expect(p.layers[0].keys[5]).toEqual(before.layers[0].keys[2]);
  }
});
it('rejects invalid primitive geometry in checked batches without partial writes', () => {
  for (const value of [-1, NaN, Infinity]) {
    const p = fixture();
    const other = clone(p.layers[0]);
    other.id = 'bad';
    for (const key of other.keys.slice(0, 2)) key.shapes[0].kind = 'rectangle';
    other.keys[1].shapes[0].cornerRadius = value;
    p.layers.push(other);
    const before = structuredClone(p);
    expect(() =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        4,
        'linear',
        false,
        false,
        false,
        undefined,
        true,
      ),
    ).toThrow(/finite and nonnegative/);
    expect(p).toEqual(before);
  }
});
it('keeps nonprimitive and contour-backed dimensions fixed', () => {
  for (const contours of [false, true]) {
    const p = fixture();
    if (contours)
      for (const key of p.layers[0].keys.slice(0, 2)) {
        key.shapes[0].kind = 'rectangle';
        key.shapes[0].contours = [
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 50 },
          ],
        ];
      }
    p.layers[0].keys[1].shapes[0].width = 200;
    const before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        false,
        false,
        false,
        undefined,
        true,
      ),
    ).toThrow(/same ordered/);
    expect(p).toEqual(before);
  }
});
it('generates detached primitive symbol geometry including zero-size endpoints', () => {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2)) key.shapes[0].kind = 'ellipse';
  p.layers[0].keys[1].shapes[0].width = 0;
  p.layers[0].keys[1].shapes[0].height = 0;
  const def: SymbolDefinition = {
    id: 's',
    name: 's',
    width: 100,
    height: 100,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 10, keys: p.layers[0].keys.slice(1) },
  };
  const before = clone(def);
  const result = generateSymbolMotionFrames(
    def,
    ['@base'],
    0,
    4,
    'linear',
    false,
    false,
    false,
    undefined,
    true,
  );
  expect(result.timeline!.keys[1].shapes[0].width).toBe(50);
  expect(result.timeline!.keys[1].shapes[0].height).toBe(25);
  result.timeline!.keys[1].shapes[0].width = 77;
  expect(def).toEqual(before);
});

function gradientGeometryFixture(kind: 'linear' | 'radial' = 'linear') {
  const p = fixture();
  const first = p.layers[0].keys[0].shapes[0],
    last = p.layers[0].keys[1].shapes[0];
  first.gradient = {
    kind,
    from: { x: 0, y: 0 },
    to: { x: 100, y: 50 },
    transform: [1, 0.1, 0.2, 1],
    stops: [
      { offset: 0, color: '#ff0000' },
      { offset: 1, color: '#0000ff' },
    ],
  };
  last.gradient = clone(first.gradient);
  last.gradient.from = { x: 20, y: 40 };
  last.gradient.to = { x: 60, y: 10 };
  last.gradient.stops[0].offset = 0.2;
  last.gradient.stops[1].offset = 0.8;
  return p;
}
it('eases gradient endpoints and corresponding offsets with fixed basis and detached data', () => {
  for (const kind of ['linear', 'radial'] as const) {
    const p = gradientGeometryFixture(kind),
      before = clone(p);
    expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, 'in')).toThrow(/same ordered/);
    expect(p).toEqual(before);
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'in',
      false,
      false,
      false,
      undefined,
      false,
      true,
    );
    const mid = p.layers[0].keys[2].shapes[0].gradient!;
    expect(mid).toEqual({
      kind,
      from: { x: 5, y: 10 },
      to: { x: 90, y: 40 },
      transform: [1, 0.1, 0.2, 1],
      stops: [
        { offset: 0.05, color: '#ff0000' },
        { offset: 0.95, color: '#0000ff' },
      ],
    });
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
    expect(p.layers[0].keys[5]).toEqual(before.layers[0].keys[2]);
    mid.from.x = 999;
    mid.stops[0].offset = 0.7;
    expect(p.layers[0].keys[1].shapes[0].gradient!.from.x).toBe(1.25);
    expect(before.layers[0].keys[0].shapes[0].gradient!.from.x).toBe(0);
  }
});
it('rejects invalid or incompatible gradient geometry across a batch atomically', () => {
  for (const mode of [
    'nan',
    'infinite',
    'negative',
    'unordered',
    'over-one',
    'basis',
    'count',
    'kind',
    'color',
  ]) {
    const p = gradientGeometryFixture();
    const other = clone(p.layers[0]);
    other.id = 'other';
    const g = other.keys[1].shapes[0].gradient!;
    if (mode === 'nan') g.from.x = NaN;
    if (mode === 'infinite') g.to.y = Infinity;
    if (mode === 'negative') g.stops[0].offset = -0.1;
    if (mode === 'unordered') g.stops[1].offset = 0.1;
    if (mode === 'over-one') g.stops[1].offset = 1.1;
    if (mode === 'basis') g.transform = [2, 0, 0, 1];
    if (mode === 'count') g.stops.pop();
    if (mode === 'kind') g.kind = 'radial';
    if (mode === 'color') g.stops[0].color = '#00ff00';
    p.layers.push(other);
    const before = structuredClone(p);
    expect(() =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        4,
        'linear',
        false,
        false,
        false,
        undefined,
        false,
        true,
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('combines gradient geometry with paint in detached symbol motion', () => {
  const p = gradientGeometryFixture('radial');
  const target = p.layers[0].keys[1].shapes[0].gradient!;
  target.from = { x: 0, y: 0 };
  target.to = { x: 0, y: 0 };
  target.stops[0].color = '#0000ff';
  target.stops[0].opacity = 0;
  const def: SymbolDefinition = {
    id: 's',
    name: 's',
    width: 100,
    height: 100,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 10, keys: p.layers[0].keys.slice(1) },
    buttonStates: { up: 0, over: 1, down: 4, hit: 8 },
  };
  const before = clone(def);
  const result = generateSymbolMotionFrames(
    def,
    ['@base'],
    0,
    4,
    'linear',
    false,
    true,
    false,
    undefined,
    false,
    true,
  );
  expect(result.timeline!.keys[1].shapes[0].gradient!.to).toEqual({ x: 50, y: 25 });
  expect(result.timeline!.keys[1].shapes[0].gradient!.stops[0]).toEqual({
    offset: 0.1,
    color: '#800080',
    opacity: 0.5,
  });
  expect(result.buttonStates).toEqual(def.buttonStates);
  expect(def).toEqual(before);
});

it('preflights the existing aggregate symbol artwork capacity before cloning geometry', () => {
  const a = shape();
  const def: SymbolDefinition = {
    id: 'motion',
    name: 'Motion',
    width: 100,
    height: 100,
    shapes: [a],
    timeline: { duration: 3, keys: [{ frame: 2, shapes: [clone(a)] }] },
  };
  const other: SymbolDefinition = {
    id: 'other',
    name: 'Other',
    width: 100,
    height: 100,
    shapes: Array(99997).fill(a),
  };
  const symbols = [def, other],
    before = clone(def);
  const result = generateSymbolMotionFrames(
    def,
    ['@base', '@base'],
    0,
    2,
    'linear',
    false,
    false,
    false,
    undefined,
    false,
    false,
    symbols,
  );
  expect(result.timeline!.keys.map((k) => k.frame)).toEqual([1, 2]);
  expect(def).toEqual(before);
  other.shapes.push(a);
  let geometryReads = 0;
  Object.defineProperty(a, 'nodes', {
    enumerable: true,
    get() {
      geometryReads++;
      throw new Error('geometry cloned before capacity check');
    },
  });
  expect(() =>
    generateSymbolMotionFrames(
      def,
      ['@base'],
      0,
      2,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      symbols,
    ),
  ).toThrow(/symbol artwork budget/);
  expect(geometryReads).toBe(0);
  expect(def.timeline!.keys).toHaveLength(1);
  expect(other.shapes).toHaveLength(99998);
});
it('counts draft artwork and all selected symbol tracks before generating a batch', () => {
  const a = shape();
  const def: SymbolDefinition = {
    id: 'motion',
    name: 'Motion',
    width: 100,
    height: 100,
    shapes: Array(10).fill(a),
    timeline: {
      duration: 6000,
      keys: [{ frame: 5999, shapes: Array(10).fill(a) }],
      layers: [
        {
          id: 'extra',
          name: 'Extra',
          visible: true,
          locked: false,
          drawingMode: 'object',
          keys: [
            { frame: 0, shapes: Array(10).fill(a) },
            { frame: 5999, shapes: Array(10).fill(a) },
          ],
        },
      ],
    },
  };
  const before = clone(def);
  expect(() => generateSymbolMotionFrames(def, ['@base', 'extra'], 0, 5999, 'linear')).toThrow(
    /symbol artwork budget/,
  );
  expect(def).toEqual(before);
});

it('supports directed rotations and full turns without changing endpoint keys', () => {
  for (const direction of ['clockwise', 'counterclockwise'] as const) {
    const p = fixture(),
      before = clone(p);
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      { direction, turns: 1 },
    );
    expect(p.layers[0].keys[2].shapes[0].rotation).toBe(direction === 'clockwise' ? 540 : 0);
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
    expect(p.layers[0].keys[5]).toEqual(before.layers[0].keys[2]);
  }
  expect(motionRotationDelta(-350, 350, { direction: 'clockwise', turns: 0 })).toBe(340);
  expect(motionRotationDelta(-350, 350, { direction: 'counterclockwise', turns: 0 })).toBe(-20);
  expect(motionRotationDelta(720, -720, { direction: 'clockwise', turns: 2 })).toBe(720);
  expect(motionRotationDelta(720, -720, { direction: 'counterclockwise', turns: 2 })).toBe(-720);
});
it('uses combined affine orientation and easing for directed symbol turns', () => {
  const p = fixture();
  const first = p.layers[0].keys[0].shapes[0],
    last = p.layers[0].keys[1].shapes[0];
  first.rotation = last.rotation = 0;
  first.transform = [1, 0, 0, 1];
  last.transform = [-1, 0, 0, -1];
  const def: SymbolDefinition = {
    id: 's',
    name: 's',
    width: 100,
    height: 100,
    shapes: [first],
    timeline: { duration: 10, keys: p.layers[0].keys.slice(1) },
  };
  const before = clone(def);
  const result = generateSymbolMotionFrames(
    def,
    ['@base'],
    0,
    4,
    'in',
    true,
    false,
    false,
    undefined,
    false,
    false,
    [def],
    { direction: 'clockwise', turns: 1 },
  );
  expect(result.timeline!.keys[1].shapes[0].rotation).toBe(135);
  expect(result.timeline!.keys[1].shapes[0].transform).toEqual([1, 0, 0, 1]);
  expect(def).toEqual(before);
});
it('rejects invalid turn settings atomically before generation', () => {
  for (const turns of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    const p = fixture(),
      before = clone(p);
    expect(() =>
      generateMotionFrames(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        false,
        false,
        false,
        undefined,
        false,
        false,
        { direction: 'clockwise', turns },
      ),
    ).toThrow(/extra turns/);
    expect(p).toEqual(before);
  }
  expect(() => motionRotationDelta(0, 0, { direction: 'shortest', turns: 1 })).toThrow(
    /zero extra turns/,
  );
});

it('optionally interpolates stroke width with easing, exact endpoints and detached geometry', () => {
  for (const ease of ['linear', 'in', 'out', 'in-out'] as const) {
    const p = fixture();
    p.layers[0].keys[0].shapes[0].strokeWidth = 0;
    p.layers[0].keys[1].shapes[0].strokeWidth = 200;
    const before = clone(p);
    expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, ease)).toThrow(/enabled motion/);
    expect(p).toEqual(before);
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      ease,
      false,
      false,
      false,
      undefined,
      false,
      false,
      undefined,
      true,
    );
    expect(p.layers[0].keys[1].shapes[0].strokeWidth).toBeCloseTo(200 * motionProgress(0.25, ease));
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
    expect(p.layers[0].keys[5]).toEqual(before.layers[0].keys[2]);
    expect(p.layers[0].keys[1].shapes[0].nodes).toEqual(before.layers[0].keys[0].shapes[0].nodes);
    expect(p.layers[0].keys[1].shapes[0].nodes).not.toBe(before.layers[0].keys[0].shapes[0].nodes);
  }
});
it('rejects invalid stroke widths on any checked track before committing keys', () => {
  for (const width of [-1, 201, NaN, Infinity]) {
    const p = fixture();
    const second = clone(p.layers[0]);
    second.id = 'second';
    second.keys[1].shapes[0].strokeWidth = width;
    p.layers.push(second);
    const before = structuredClone(p);
    expect(() =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        4,
        'linear',
        false,
        false,
        false,
        undefined,
        false,
        false,
        undefined,
        true,
      ),
    ).toThrow(/stroke widths/);
    expect(p).toEqual(before);
  }
});

function basisFixture(kind: 'linear' | 'radial' = 'linear') {
  const p = fixture();
  const gradient = {
    kind,
    from: { x: 0, y: 0 },
    to: { x: 20, y: 0 },
    stops: [
      { offset: 0, color: '#ff0000' },
      { offset: 1, color: '#0000ff' },
    ],
  };
  p.layers[0].keys[0].shapes[0].gradient = clone(gradient);
  p.layers[0].keys[1].shapes[0].gradient = { ...clone(gradient), transform: [0, 2, -3, 1] };
  return p;
}
const generateBasis = (p: ReturnType<typeof fixture>, ease: MotionEase = 'linear') =>
  generateMotionFrames(
    p,
    p.layers.map((l) => l.id),
    0,
    4,
    ease,
    false,
    false,
    false,
    undefined,
    false,
    false,
    undefined,
    false,
    true,
  );
it('interpolates gradient bases independently with shortest rotation, scale and shear', () => {
  for (const kind of ['linear', 'radial'] as const) {
    const p = basisFixture(kind),
      before = clone(p);
    expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear')).toThrow(
      'enabled motion properties',
    );
    generateBasis(p);
    const g = p.layers[0].keys[2].shapes[0].gradient!;
    const root = Math.SQRT1_2;
    [1.5 * root, 1.5 * root, -1.5 * root, 2.5 * root].forEach((v, i) =>
      expect(g.transform![i]).toBeCloseTo(v, 10),
    );
    expect(g.from).toEqual(before.layers[0].keys[0].shapes[0].gradient!.from);
    expect(g.stops).toEqual(before.layers[0].keys[0].shapes[0].gradient!.stops);
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
    expect(p.layers[0].keys[5]).toEqual(before.layers[0].keys[2]);
    g.transform![0] = 99;
    expect(p.layers[0].keys[1].shapes[0].gradient!.transform![0]).not.toBe(99);
    expect(before.layers[0].keys[0].shapes[0].gradient!.transform).toBeUndefined();
  }
});
it('eases mirrored gradient bases without changing handedness', () => {
  const p = basisFixture('radial');
  p.layers[0].keys[0].shapes[0].gradient!.transform = [1, 0, 0, -1];
  p.layers[0].keys[1].shapes[0].gradient!.transform = [0, 2, 3, 1];
  generateBasis(p, 'in');
  const [a, b, c, d] = p.layers[0].keys[2].shapes[0].gradient!.transform!;
  expect(Math.hypot(a, b)).toBeCloseTo(1.25, 10);
  expect((Math.atan2(b, a) * 180) / Math.PI).toBeCloseTo(22.5, 10);
  expect(a * d - b * c).toBeCloseTo(-1.875, 10);
});
it('rejects invalid gradient bases atomically across selected tracks', () => {
  for (const transform of [
    [1, 0, 0, -1],
    [0, 0, 0, 1],
    [NaN, 0, 0, 1],
    [1e6, 0, 0, 1],
  ]) {
    const p = basisFixture();
    const layer = clone(p.layers[0]);
    layer.id = 'other';
    p.layers.push(layer);
    layer.keys[1].shapes[0].gradient!.transform = transform as [number, number, number, number];
    const before = structuredClone(p);
    expect(() => generateBasis(p)).toThrow();
    expect(p).toEqual(before);
  }
});

it('rejects numerically collapsed reconstructed gradient bases before mutation', () => {
  const p = basisFixture();
  p.layers[0].keys[0].shapes[0].gradient!.transform = [100000, 0, 100000, 1e-15];
  p.layers[0].keys[1].shapes[0].gradient!.transform = [0, 100000, -1e-15, 100000];
  const before = clone(p);
  expect(() => generateBasis(p)).toThrow('gradient basis');
  expect(p).toEqual(before);
});

it('keeps opposing gradient rotations nonsingular instead of blending bases to zero', () => {
  const p = basisFixture();
  p.layers[0].keys[1].shapes[0].gradient!.transform = [-1, 0, 0, -1];
  generateBasis(p);
  const [a, b, c, d] = p.layers[0].keys[2].shapes[0].gradient!.transform!;
  expect(a).toBeCloseTo(0, 10);
  expect(b).toBeCloseTo(-1, 10);
  expect(c).toBeCloseTo(1, 10);
  expect(d).toBeCloseTo(0, 10);
  expect(a * d - b * c).toBeCloseTo(1, 10);
});

it('rejects reconstructed gradient handedness loss before committing any selected track', () => {
  const p = basisFixture();
  p.layers[0].keys[1].frame = 2;
  const other = clone(p.layers[0]);
  other.id = 'ill-conditioned-gradient';
  p.layers.push(other);
  other.keys[0].shapes[0].gradient!.transform = [
    1195.6485251369977, -6856.345093819651, 8107.5750076780905, -46492.201477268696,
  ];
  other.keys[1].shapes[0].gradient!.transform = [
    -2027.7983497209887, 2311.370251332907, -4034.997779971187, 4599.260983767429,
  ];
  for (const key of other.keys.slice(0, 2)) {
    const [a, b, c, d] = key.shapes[0].gradient!.transform!;
    expect(a * d - b * c).toBeGreaterThanOrEqual(1e-10);
  }
  const before = clone(p);
  expect(() =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
      0,
      2,
      'linear',
      false,
      false,
      false,
      undefined,
      false,
      false,
      undefined,
      false,
      true,
    ),
  ).toThrow('gradient basis');
  expect(p).toEqual(before);
});

it('adds analytic tangent heading to authored rotation while preserving endpoint keys', () => {
  for (const distance of [false, true]) {
    const p = fixture(),
      before = clone(p);
    generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', false, false, false, {
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      distance,
      tangent: true,
    });
    const mid = p.layers[0].keys[2].shapes[0];
    expect(mid.rotation).toBeCloseTo(360 + (Math.atan2(40, 80) * 180) / Math.PI, 10);
    expect(mid).not.toHaveProperty('tangentAngle');
    expect(mid.transform).toEqual(before.layers[0].keys[0].shapes[0].transform);
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
    expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
    expect(p.layers[0].keys[5]).toEqual(before.layers[0].keys[2]);
  }
});
it('samples tangent at the arc-length parameter and keeps position sampling unchanged', () => {
  const from = { x: 0, y: 0 },
    to = { x: 90, y: 40 };
  for (const distance of [false, true]) {
    const path = { startX: 140, startY: -80, endX: -40, endY: 150, distance };
    const positions = createMotionPathSampler(from, to, path);
    const oriented = createMotionPathSampler(from, to, { ...path, tangent: true });
    for (const t of [0.1, 0.25, 0.5, 0.8]) {
      const sample = oriented(t),
        plain = positions(t);
      expect({ x: sample.x, y: sample.y }).toEqual(plain);
      const before = positions(t - 1e-6),
        after = positions(t + 1e-6);
      const expected = (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI;
      const delta = sample.tangentAngle! - expected;
      expect(delta - 360 * Math.round(delta / 360)).toBeCloseTo(0, 3);
    }
  }
});
it('rejects stationary tangent and malformed tangent modes before any track mutation', () => {
  const p = fixture(),
    other = clone(p.layers[0]);
  other.id = 'stationary';
  other.keys[1].shapes[0].x = other.keys[0].shapes[0].x;
  other.keys[1].shapes[0].y = other.keys[0].shapes[0].y;
  p.layers.push(other);
  const before = clone(p);
  for (const tangent of [true, 'yes' as unknown as boolean]) {
    expect(() =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        4,
        'linear',
        false,
        false,
        false,
        { startX: 0, startY: 0, endX: 0, endY: 0, tangent },
      ),
    ).toThrow(/tangent/);
    expect(p).toEqual(before);
  }
  expect(() =>
    createMotionPathSampler(
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { startX: 10, startY: 0, endX: 10, endY: 0, tangent: true },
    ),
  ).toThrow(/tangent/);
});
it('combines symbol tangent offsets with affine pose and directed rotation using eased progress', () => {
  const p = fixture();
  const definition: SymbolDefinition = {
    id: 'tangent-symbol',
    name: 'Tangent',
    width: 100,
    height: 100,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 10, keys: p.layers[0].keys.slice(1) },
  };
  const before = clone(definition);
  const path = { startX: 0, startY: 0, endX: 0, endY: 0, distance: true };
  const rotation = { direction: 'clockwise' as const, turns: 1 };
  const plain = generateSymbolMotionFrames(
    definition,
    ['@base'],
    0,
    4,
    'in',
    true,
    false,
    false,
    path,
    false,
    false,
    [definition],
    rotation,
  );
  const oriented = generateSymbolMotionFrames(
    definition,
    ['@base'],
    0,
    4,
    'in',
    true,
    false,
    false,
    { ...path, tangent: true },
    false,
    false,
    [definition],
    rotation,
  );
  for (let i = 0; i < 3; i++) {
    const a = plain.timeline!.keys[i].shapes[0],
      b = oriented.timeline!.keys[i].shapes[0];
    expect(b.rotation - a.rotation).toBeCloseTo((Math.atan2(40, 80) * 180) / Math.PI, 10);
    expect(b.transform).toEqual(a.transform);
    expect(b.x).toEqual(a.x);
  }
  expect(definition).toEqual(before);
});

function stopFixture() {
  const p = fixture();
  p.layers[0].keys[0].shapes[0].gradient = {
    kind: 'linear',
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    stops: [
      { offset: 0, color: '#ff0000', opacity: 0.2 },
      { offset: 1, color: '#0000ff' },
    ],
  };
  p.layers[0].keys[1].shapes[0].gradient = {
    kind: 'linear',
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 0.5, color: '#00ff00', opacity: 0.4 },
      { offset: 1, color: '#ffffff' },
    ],
  };
  return p;
}
function matchedMotion(p: ReturnType<typeof fixture>, paint = true, ids = [p.layers[0].id]) {
  generateMotionFrames(
    p,
    ids,
    0,
    4,
    'linear',
    false,
    paint,
    false,
    undefined,
    false,
    false,
    undefined,
    false,
    false,
    true,
  );
}
it('matches unequal gradient ramps by combined offsets with exact endpoints and detached paint', () => {
  const p = stopFixture(),
    before = clone(p);
  expect(() => generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', false, true)).toThrow(
    /enabled motion/,
  );
  expect(p).toEqual(before);
  matchedMotion(p);
  const mid = p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].gradient!;
  expect(mid.stops).toEqual([
    { offset: 0, color: '#800000', opacity: 0.6 },
    { offset: 0.5, color: '#408040', opacity: 0.5 },
    { offset: 1, color: '#8080ff' },
  ]);
  for (const key of before.layers[0].keys)
    expect(p.layers[0].keys.find((k) => k.frame === key.frame)).toEqual(key);
  mid.stops[0].color = '#123456';
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[1].shapes[0].gradient!.stops[0].color).not.toBe('#123456');
});
it('rejects ambiguous, invalid or excessive matched stops atomically across tracks', () => {
  for (const mode of ['order', 'count', 'color', 'opacity', 'paint'] as const) {
    const p = stopFixture();
    const other = clone(p.layers[0]);
    other.id = 'other';
    p.layers.push(other);
    const g = other.keys[1].shapes[0].gradient!;
    if (mode === 'order') g.stops[2].offset = 0.25;
    if (mode === 'color') g.stops[1].color = 'red';
    if (mode === 'opacity') g.stops[1].opacity = NaN;
    if (mode === 'count')
      g.stops = Array.from({ length: 32 }, (_, i) => ({ offset: (i + 1) / 33, color: '#000000' }));
    const before = structuredClone(p);
    expect(() =>
      matchedMotion(
        p,
        mode !== 'paint',
        p.layers.map((l) => l.id),
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('matches gradient ramps with clamped outer colors and preserves existing 32-stop capacity', () => {
  const p = stopFixture();
  const from = p.layers[0].keys[0].shapes[0].gradient!,
    to = p.layers[0].keys[1].shapes[0].gradient!;
  from.stops = [
    { offset: 0.25, color: '#ff0000' },
    { offset: 0.75, color: '#0000ff' },
  ];
  to.stops = Array.from({ length: 32 }, (_, i) => ({ offset: i / 31, color: '#000000' }));
  from.stops[0].offset = 8 / 31;
  from.stops[1].offset = 23 / 31;
  matchedMotion(p);
  const stops = p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops;
  expect(stops).toHaveLength(32);
  expect(stops[0].color).toBe('#800000');
  expect(stops[31].color).toBe('#000080');
});
it('matches symbol stops without changing source definitions or endpoint keys', () => {
  const p = stopFixture();
  const definition: SymbolDefinition = {
    id: 'matched',
    name: 'Matched',
    width: 100,
    height: 100,
    shapes: clone(p.layers[0].keys[0].shapes),
    timeline: { duration: 10, keys: clone(p.layers[0].keys.slice(1)), layers: [] },
  };
  const before = clone(definition);
  const result = generateSymbolMotionFrames(
    definition,
    ['@base'],
    0,
    4,
    'linear',
    false,
    true,
    false,
    undefined,
    false,
    false,
    [definition],
    undefined,
    false,
    false,
    true,
  );
  expect(result.timeline!.keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops).toHaveLength(
    3,
  );
  expect(result.shapes).toEqual(before.shapes);
  expect(result.timeline!.keys.find((k) => k.frame === 4)).toEqual(before.timeline!.keys[0]);
  expect(definition).toEqual(before);
  definition.shapes[0].gradient!.stops[0].opacity = NaN;
  const invalid = structuredClone(definition);
  expect(() =>
    generateSymbolMotionFrames(
      definition,
      ['@base'],
      0,
      4,
      'linear',
      false,
      true,
      false,
      undefined,
      false,
      false,
      [definition],
      undefined,
      false,
      false,
      true,
    ),
  ).toThrow(/opacity/);
  expect(definition).toEqual(invalid);
});

it('composes stop matching with eased radial geometry and independent gradient basis', () => {
  const p = stopFixture();
  const first = p.layers[0].keys[0].shapes[0],
    last = p.layers[0].keys[1].shapes[0];
  first.gradient!.kind = last.gradient!.kind = 'radial';
  last.gradient!.from = { x: 40, y: 20 };
  last.gradient!.to = { x: 200, y: 40 };
  last.gradient!.transform = [2, 0, 0, 2];
  const before = structuredClone(p);
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'in',
    false,
    true,
    false,
    undefined,
    false,
    true,
    undefined,
    false,
    true,
    true,
  );
  const mid = p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].gradient!;
  expect(mid.from).toEqual({ x: 10, y: 5 });
  expect(mid.to).toEqual({ x: 125, y: 10 });
  expect(mid.transform).toEqual([1.25, 0, 0, 1.25]);
  expect(mid.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
  expect(mid.stops[1].color).toBe('#604060');
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys.find((k) => k.frame === 4)).toEqual(before.layers[0].keys[1]);
});

it('matches hard gradient edges with different multiplicities and fixed discontinuity offsets', () => {
  const p = stopFixture();
  const from = p.layers[0].keys[0].shapes[0].gradient!,
    to = p.layers[0].keys[1].shapes[0].gradient!;
  from.stops = [
    { offset: 0, color: '#ff0000' },
    { offset: 0.5, color: '#ff0000' },
    { offset: 0.5, color: '#0000ff' },
    { offset: 1, color: '#0000ff' },
  ];
  to.stops = [
    { offset: 0, color: '#000000' },
    { offset: 0.5, color: '#00ff00' },
    { offset: 0.5, color: '#ffffff' },
    { offset: 0.5, color: '#000000' },
    { offset: 1, color: '#000000' },
  ];
  const before = structuredClone(p);
  matchedMotion(p);
  expect(p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops).toEqual([
    { offset: 0, color: '#800000' },
    { offset: 0.5, color: '#808000' },
    { offset: 0.5, color: '#8080ff' },
    { offset: 0.5, color: '#000080' },
    { offset: 1, color: '#000080' },
  ]);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys.find((k) => k.frame === 4)).toEqual(before.layers[0].keys[1]);
});
it('duplicates a smooth ramp sample on both sides of an unmatched hard edge', () => {
  const p = stopFixture();
  p.layers[0].keys[1].shapes[0].gradient!.stops = [
    { offset: 0, color: '#000000' },
    { offset: 0.5, color: '#000000', opacity: 0 },
    { offset: 0.5, color: '#ffffff' },
    { offset: 1, color: '#ffffff' },
  ];
  matchedMotion(p);
  const stops = p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops;
  expect(stops[1]).toEqual({ offset: 0.5, color: '#400040', opacity: 0.3 });
  expect(stops[2]).toEqual({ offset: 0.5, color: '#c080c0', opacity: 0.8 });
});
it('counts repeated matched stops against capacity without partially writing keys', () => {
  const p = stopFixture();
  p.layers[0].keys[0].shapes[0].gradient!.stops = Array.from({ length: 17 }, () => ({
    offset: 0,
    color: '#000000',
  }));
  p.layers[0].keys[1].shapes[0].gradient!.stops = Array.from({ length: 16 }, () => ({
    offset: 1,
    color: '#ffffff',
  }));
  const before = structuredClone(p);
  expect(() => matchedMotion(p)).toThrow(/32-stop/);
  expect(p).toEqual(before);
  p.layers[0].keys[0].shapes[0].gradient!.stops.pop();
  matchedMotion(p);
  expect(p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops).toHaveLength(32);
});

it('rejects an off-sample stationary path atomically across motion tracks', () => {
  const p = fixture();
  const other = clone(p.layers[0]);
  other.id = 'return';
  other.keys[1].shapes[0].x = other.keys[0].shapes[0].x;
  other.keys[1].shapes[0].y = other.keys[0].shapes[0].y;
  p.layers.push(other);
  const before = clone(p);
  expect(() =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
      0,
      4,
      'linear',
      false,
      false,
      false,
      { startX: 10, startY: 0, endX: -10, endY: 0, tangent: true },
    ),
  ).toThrow(/tangent/);
  expect(p).toEqual(before);
});

function orderedStopFixture() {
  const p = stopFixture();
  p.layers[0].keys.forEach((key, i) => {
    if (!key.shapes.length || !key.shapes[0].gradient) return;
    key.shapes[0].gradient!.stops = [
      { offset: 0, color: '#000000' },
      { offset: i ? 0.8 : 0.2, color: '#000000' },
      ...(i ? [{ offset: 0.8, color: '#ffffff', opacity: 0.5 }] : []),
      { offset: 1, color: '#ffffff' },
    ];
  });
  return p;
}
function orderedMotion(p: ReturnType<typeof fixture>, geometry = true, paint = true) {
  generateMotionFrames(
    p,
    p.layers.map((l) => l.id),
    0,
    4,
    'in',
    false,
    paint,
    false,
    undefined,
    false,
    geometry,
    undefined,
    false,
    false,
    'ordered',
  );
}
it('moves ordered stop groups with easing and retains unequal hard-edge multiplicities', () => {
  const p = orderedStopFixture(),
    before = clone(p);
  orderedMotion(p);
  const mid = p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].gradient!;
  expect(mid.stops.map((s) => s.offset)).toEqual([0, 0.35000000000000003, 0.35000000000000003, 1]);
  expect(mid.stops[1].color).toBe('#000000');
  expect(mid.stops[2].color).toBe('#404040');
  expect(mid.stops[2].opacity).toBe(0.875);
  for (const key of before.layers[0].keys)
    expect(p.layers[0].keys.find((k) => k.frame === key.frame)).toEqual(key);
  mid.stops[1].color = '#abcdef';
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys.find((k) => k.frame === 1)!.shapes[0].gradient!.stops[1].color).toBe(
    '#000000',
  );
});
it('rejects ambiguous ordered groups and disabled prerequisites atomically', () => {
  for (const [geometry, paint] of [
    [false, true],
    [true, false],
  ]) {
    const p = orderedStopFixture(),
      before = clone(p);
    expect(() => orderedMotion(p, geometry, paint)).toThrow(/Enable/);
    expect(p).toEqual(before);
  }
  const p = orderedStopFixture();
  const other = clone(p.layers[0]);
  other.id = 'other';
  other.keys[1].shapes[0].gradient!.stops.splice(1, 0, { offset: 0.4, color: '#ffffff' });
  p.layers.push(other);
  const before = clone(p);
  expect(() => orderedMotion(p)).toThrow(/distinct stop groups/);
  expect(p).toEqual(before);
});
it('moves ordered groups in symbols while preserving exact source keys', () => {
  const p = orderedStopFixture();
  const definition: SymbolDefinition = {
    id: 'ordered',
    name: 'Ordered',
    width: 100,
    height: 100,
    shapes: clone(p.layers[0].keys[0].shapes),
    timeline: { duration: 10, keys: clone(p.layers[0].keys.slice(1)), layers: [] },
  };
  const before = clone(definition);
  const result = generateSymbolMotionFrames(
    definition,
    ['@base'],
    0,
    4,
    'in',
    false,
    true,
    false,
    undefined,
    false,
    true,
    [definition],
    undefined,
    false,
    false,
    'ordered',
  );
  expect(
    result.timeline!.keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops[1].offset,
  ).toBeCloseTo(0.35);
  expect(result.shapes).toEqual(before.shapes);
  expect(result.timeline!.keys.find((k) => k.frame === 4)).toEqual(before.timeline!.keys[0]);
  expect(definition).toEqual(before);
});

it('counts expanded ordered multiplicities against capacity before changing any keys', () => {
  const p = orderedStopFixture();
  p.layers[0].keys.slice(0, 2).forEach((key, side) => {
    key.shapes[0].gradient!.stops = Array.from({ length: 17 }, (_, i) =>
      Array.from({ length: i % 2 === side ? 2 : 1 }, () => ({ offset: i / 16, color: '#000000' })),
    ).flat();
  });
  const before = clone(p);
  expect(() => orderedMotion(p)).toThrow(/32-stop/);
  expect(p).toEqual(before);
});

function areaFixture() {
  const p = fixture();
  for (const [i, key] of p.layers[0].keys.slice(0, 2).entries()) {
    const scale = i ? -2 : 1;
    key.shapes[0] = {
      ...key.shapes[0],
      kind: 'polygon',
      nodes: undefined,
      closed: true,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 10 * scale, y: 0 },
          { x: 0, y: 10 * scale },
        ],
      ],
    };
  }
  return p;
}
function areaMotion(p: ReturnType<typeof fixture>, nodes = true) {
  generateMotionFrames(
    p,
    p.layers.map((l) => l.id),
    0,
    4,
    'linear',
    false,
    false,
    nodes,
    undefined,
    false,
    false,
    undefined,
    false,
    false,
    false,
    true,
  );
}
it('rejects an off-frame polygon collapse atomically while default node motion stays available', () => {
  const p = areaFixture(),
    before = clone(p);
  expect(() => areaMotion(p)).toThrow(/area collapses/);
  expect(p).toEqual(before);
  expect(() => areaMotion(p, false)).toThrow(/node interpolation/);
  expect(p).toEqual(before);
  generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', false, false, true);
  expect(p.layers[0].keys.filter((k) => k.frame > 0 && k.frame < 4)).toHaveLength(3);
});
it('checks contour quadratics across translation, scale, winding and hole rings', () => {
  for (const origin of [0, -99900, 99900])
    for (const scale of [0.01, 1, 100])
      for (const mirror of [-1, 1]) {
        const p = areaFixture();
        const a = p.layers[0].keys[0].shapes[0],
          b = p.layers[0].keys[1].shapes[0];
        for (const s of [a, b])
          s.contours = s.contours!.map((r) =>
            r.map((n) => ({ x: origin + n.x * scale * mirror, y: origin + n.y * scale })),
          );
        const before = structuredClone([a, b]);
        expect(() => validateMotionContourAreas(a, b)).toThrow(/area collapses/);
        const safe = clone(a);
        safe.contours = safe.contours!.map((r) => r.map((n) => ({ x: n.x + 5, y: n.y - 7 })));
        expect(() => validateMotionContourAreas(a, safe)).not.toThrow();
        const outer = [
          { x: origin - 1000, y: origin - 1000 },
          { x: origin + 1000, y: origin - 1000 },
          { x: origin, y: origin + 1000 },
        ];
        expect(() =>
          validateMotionContourAreas(
            { ...a, contours: [outer, ...a.contours!] },
            { ...b, contours: [outer, ...b.contours!] },
          ),
        ).toThrow(/area collapses/);
        expect([a, b]).toEqual(before);
      }
});
it('rejects polygon area failure before symbol cloning or checked-track mutation', () => {
  const p = areaFixture();
  const safe = clone(p.layers[0]);
  safe.id = 'safe';
  safe.keys[1].shapes = clone(safe.keys[0].shapes);
  p.layers.unshift(safe);
  const before = clone(p);
  expect(() => areaMotion(p)).toThrow(/area collapses/);
  expect(p).toEqual(before);
  const definition: SymbolDefinition = {
    id: 'area',
    name: 'Area',
    width: 100,
    height: 100,
    shapes: clone(p.layers[1].keys[0].shapes),
    timeline: { duration: 10, layers: [], keys: clone(p.layers[1].keys.slice(1)) },
  };
  const generate = () =>
    generateSymbolMotionFrames(
      definition,
      ['@base'],
      0,
      4,
      'linear',
      false,
      false,
      true,
      undefined,
      false,
      false,
      [definition],
      undefined,
      false,
      false,
      false,
      true,
    );
  expect(generate).toThrow(/area collapses/);
  definition.shapes[0].contours![0][0].x = NaN;
  const invalid = structuredClone(definition);
  expect(generate).toThrow(/finite coordinates/);
  expect(definition).toEqual(invalid);
});

it('accepts safe guarded generation and rejects reversed contours or invalid handles', () => {
  const p = areaFixture();
  p.layers[0].keys[1].shapes[0].contours = clone(p.layers[0].keys[0].shapes[0].contours);
  const before = clone(p);
  areaMotion(p);
  expect(p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].contours).toEqual(
    before.layers[0].keys[0].shapes[0].contours,
  );
  for (const key of before.layers[0].keys)
    expect(p.layers[0].keys.find((k) => k.frame === key.frame)).toEqual(key);
  const a = before.layers[0].keys[0].shapes[0],
    b = clone(a);
  b.contours![0].reverse();
  expect(() => validateMotionContourAreas(a, b)).toThrow(/area collapses/);
  b.contours![0][0].in = { x: NaN, y: 3 };
  expect(() => validateMotionContourAreas(a, b)).toThrow(/finite coordinates/);
});

function archShape(width: number, height: number): Vector {
  return {
    ...shape(),
    kind: 'bezier',
    closed: true,
    nodes: [
      { x: 0, y: 0, out: { x: 0, y: height } },
      { x: width, y: 0, in: { x: width, y: height } },
    ],
  };
}
it('integrates closed cubic arch area rather than its collinear anchor polygon', () => {
  // The arch enclosed by this cubic and its baseline has area 3*w*h/5.
  const accepted = archShape(1, 2e-7),
    rejected = archShape(1, 1.5e-7);
  expect(() => validateMotionContourAreas(accepted, accepted)).not.toThrow();
  expect(() => validateMotionContourAreas(rejected, rejected)).toThrow(/area collapses/);
  expect(() => validateMotionContourAreas({ ...rejected, closed: false }, rejected)).not.toThrow();
});
it('detects curved off-frame collapse and accepts translated curves across orientations', () => {
  for (const origin of [0, -99900, 99900])
    for (const scale of [0.01, 1, 100])
      for (const angle of [0, 1.2, 3.14]) {
        const make = (factor: number) => {
          const result = archShape(10, 8);
          for (const node of result.nodes!)
            for (const p of [node, node.in, node.out])
              if (p) {
                const x = p.x * scale * factor,
                  y = p.y * scale * factor;
                p.x = origin + x * Math.cos(angle) - y * Math.sin(angle);
                p.y = origin + x * Math.sin(angle) + y * Math.cos(angle);
              }
          return result;
        };
        const first = make(1),
          last = make(-2),
          before = structuredClone([first, last]);
        expect(() => validateMotionContourAreas(first, last)).toThrow(/area collapses/);
        const safe = clone(first);
        for (const n of safe.nodes!)
          for (const p of [n, n.in, n.out])
            if (p) {
              p.x += 4;
              p.y -= 2;
            }
        expect(() => validateMotionContourAreas(first, safe)).not.toThrow();
        expect([first, last]).toEqual(before);
        // Compound curved polygons use the same integral, including a repeated closure anchor.
        const compound = (s: Vector): Vector => ({
          ...s,
          kind: 'polygon',
          nodes: undefined,
          contours: [[...s.nodes!, { ...s.nodes![0] }]],
        });
        expect(() => validateMotionContourAreas(compound(first), compound(last))).toThrow(
          /area collapses/,
        );
        expect(() => validateMotionContourAreas(compound(first), compound(first))).not.toThrow();
      }
});
it('preflights Bezier handles before symbol cloning and preserves safe generated curves', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[0] = archShape(10, 8);
  p.layers[0].keys[1].shapes[0] = archShape(20, 12);
  const before = clone(p);
  areaMotion(p);
  expect(p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].nodes![0].out!.y).toBe(10);
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  const definition: SymbolDefinition = {
    id: 'arch',
    name: 'Arch',
    width: 100,
    height: 100,
    shapes: clone(before.layers[0].keys[0].shapes),
    timeline: { duration: 10, layers: [], keys: clone(before.layers[0].keys.slice(1)) },
  };
  definition.shapes[0].nodes![0].out!.x = NaN;
  const invalid = structuredClone(definition);
  expect(() =>
    generateSymbolMotionFrames(
      definition,
      ['@base'],
      0,
      4,
      'linear',
      false,
      false,
      true,
      undefined,
      false,
      false,
      [definition],
      undefined,
      false,
      false,
      false,
      true,
    ),
  ).toThrow(/finite coordinates/);
  expect(definition).toEqual(invalid);
});

function alphaMotion(
  p: ReturnType<typeof fixture>,
  weighted = true,
  matching: boolean | 'ordered' = false,
  paint = true,
) {
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    false,
    paint,
    false,
    undefined,
    false,
    matching === 'ordered',
    undefined,
    false,
    false,
    matching,
    false,
    0,
    false,
    undefined,
    weighted,
  );
}
function alphaFixture(a = 0, b = 1) {
  const p = fixture();
  for (const [i, key] of p.layers[0].keys.slice(0, 2).entries())
    key.shapes[0].gradient = {
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      stops: [0, 1].map((offset) => ({
        offset,
        color: i ? '#0000ff' : '#ff0000',
        opacity: i ? b : a,
      })),
    };
  return p;
}
it('weights gradient RGB by opacity while preserving default blend and exact keys', () => {
  for (const [a, b, expected] of [
    [0, 1, '#0000ff'],
    [1, 0, '#ff0000'],
    [0.25, 0.75, '#4000bf'],
    [0, 0, '#800080'],
  ] as const) {
    const p = alphaFixture(a, b),
      original = clone(p);
    alphaMotion(p);
    expect(p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops[0]).toEqual({
      offset: 0,
      color: expected,
      opacity: (a + b) / 2,
    });
    expect(p.layers[0].keys[0]).toEqual(original.layers[0].keys[0]);
    expect(p.layers[0].keys.find((k) => k.frame === 4)).toEqual(original.layers[0].keys[1]);
    const legacy = alphaFixture(a, b);
    alphaMotion(legacy, false);
    expect(legacy.layers[0].keys[2].shapes[0].gradient!.stops[0].color).toBe('#800080');
  }
});
it('uses opacity-weighted sampling when matching missing gradient stops', () => {
  const p = alphaFixture();
  p.layers[0].keys[0].shapes[0].gradient!.stops[1] = { offset: 1, color: '#0000ff', opacity: 1 };
  p.layers[0].keys[1].shapes[0].gradient!.stops.splice(1, 0, {
    offset: 0.5,
    color: '#0000ff',
    opacity: 1,
  });
  alphaMotion(p, true, true);
  expect(p.layers[0].keys[2].shapes[0].gradient!.stops[1]).toEqual({
    offset: 0.5,
    color: '#0000ff',
    opacity: 0.75,
  });
});
it('validates weighted symbol stops before cloning and preserves symbol sources', () => {
  const p = alphaFixture();
  const d: SymbolDefinition = {
    id: 'alpha',
    name: 'Alpha',
    width: 100,
    height: 100,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 6, keys: [p.layers[0].keys[1]], layers: [] },
  };
  const run = () =>
    generateSymbolMotionFrames(
      d,
      ['@base'],
      0,
      4,
      'linear',
      false,
      true,
      false,
      undefined,
      false,
      false,
      [d],
      undefined,
      false,
      false,
      false,
      false,
      0,
      false,
      undefined,
      true,
    );
  const before = clone(d),
    result = run();
  expect(result.timeline!.keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops[0].color).toBe(
    '#0000ff',
  );
  expect(d).toEqual(before);
  d.shapes[0].gradient!.stops[0].opacity = NaN;
  expect(run).toThrow(/opacity/);
  expect(Number.isNaN(d.shapes[0].gradient!.stops[0].opacity)).toBe(true);
  const main = alphaFixture(),
    original = clone(main);
  expect(() => alphaMotion(main, true, false, false)).toThrow(/Enable paint/);
  expect(main).toEqual(original);
});

it('composes weighted colors with ordered hard stops and missing opacity defaults', () => {
  const p = alphaFixture();
  for (const [index, key] of p.layers[0].keys.slice(0, 2).entries()) {
    const stops = key.shapes[0].gradient!.stops;
    stops.splice(
      1,
      0,
      { ...stops[0], offset: index ? 0.8 : 0.2 },
      { ...stops[1], offset: index ? 0.8 : 0.2 },
    );
    if (index) for (const stop of stops) delete stop.opacity;
  }
  alphaMotion(p, true, 'ordered');
  expect(p.layers[0].keys[2].shapes[0].gradient!.stops).toEqual(
    [0, 0.5, 0.5, 1].map((offset) => ({ offset, color: '#0000ff', opacity: 0.5 })),
  );
});

it('retains opacity-weighted color ratios at subnormal alpha scales', () => {
  for (const scale of [Number.MIN_VALUE, 1e-310, 1e-200, 0.25]) {
    const p = alphaFixture(scale, scale);
    alphaMotion(p);
    for (const [frame, color] of [
      [1, '#bf0040'],
      [2, '#800080'],
      [3, '#4000bf'],
    ] as const)
      expect(
        p.layers[0].keys.find((k) => k.frame === frame)!.shapes[0].gradient!.stops[0].color,
      ).toBe(color);
    const unequal = alphaFixture(scale, 2 * scale);
    alphaMotion(unequal);
    expect(unequal.layers[0].keys[2].shapes[0].gradient!.stops[0].color).toBe('#5500aa');
  }
});

it('rejects original symbol gradient geometry, basis and stroke numbers before cloning', () => {
  for (const bad of [NaN, Infinity, -Infinity])
    for (const mode of ['point', 'offset', 'basis', 'stroke', 'affine'] as const) {
      const p = alphaFixture();
      const shape = p.layers[0].keys[1].shapes[0];
      if (mode === 'point') shape.gradient!.from.x = bad;
      if (mode === 'offset') shape.gradient!.stops[0].offset = bad;
      if (mode === 'basis') shape.gradient!.transform = [1, bad, 0, 1];
      if (mode === 'stroke') shape.strokeWidth = bad;
      if (mode === 'affine') shape.transform = [1, bad, 0, 1];
      const d: SymbolDefinition = {
        id: 'invalid-original',
        name: 'Invalid',
        width: 100,
        height: 100,
        shapes: p.layers[0].keys[0].shapes,
        timeline: { duration: 6, keys: [p.layers[0].keys[1]], layers: [] },
      };
      const before = structuredClone(d);
      expect(() =>
        generateSymbolMotionFrames(
          d,
          ['@base'],
          0,
          4,
          'linear',
          mode === 'affine',
          true,
          false,
          undefined,
          false,
          mode === 'point' || mode === 'offset',
          [d],
          undefined,
          mode === 'stroke',
          mode === 'basis',
        ),
      ).toThrow();
      expect(d).toEqual(before);
    }
});

it('detaches unselected symbol tracks and retains originals after later-track preflight failure', () => {
  const p = alphaFixture();
  const other = { ...newLayer('Other'), keys: clone(p.layers[0].keys) };
  const d: SymbolDefinition = {
    id: 'originals',
    name: 'Originals',
    width: 100,
    height: 100,
    shapes: p.layers[0].keys[0].shapes,
    timeline: { duration: 10, keys: clone(p.layers[0].keys.slice(1)), layers: [other] },
  };
  const before = clone(d);
  const result = generateSymbolMotionFrames(d, ['@base'], 0, 4, 'linear', false, true);
  result.timeline!.layers![0].keys[0].shapes[0].gradient!.stops[0].color = '#abcdef';
  result.shapes[0].x = 999;
  expect(d).toEqual(before);
  other.keys[1].shapes[0].strokeWidth = NaN;
  const bad = structuredClone(d);
  expect(() =>
    generateSymbolMotionFrames(
      d,
      ['@base', other.id],
      0,
      4,
      'linear',
      false,
      true,
      false,
      undefined,
      false,
      false,
      [d],
      undefined,
      true,
    ),
  ).toThrow(/stroke widths/);
  expect(d).toEqual(bad);
});

function edgeFixture() {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2)) {
    const s = key.shapes[0];
    s.kind = 'polygon';
    delete s.nodes;
    s.contours = [
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    ];
  }
  const ring = p.layers[0].keys[1].shapes[0].contours![0];
  ring[0].x = 6;
  ring[1].x = 4;
  return p;
}
it('rejects off-frame edge collapse even when total contour area remains positive', () => {
  const p = edgeFixture(),
    before = clone(p);
  const a = p.layers[0].keys[0].shapes[0],
    b = p.layers[0].keys[1].shapes[0];
  expect(() => validateMotionContourAreas(a, b)).not.toThrow();
  expect(() =>
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'linear',
      false,
      false,
      true,
      undefined,
      false,
      false,
      undefined,
      false,
      false,
      false,
      'edges',
    ),
  ).toThrow(/segment collapses/);
  expect(p).toEqual(before);
  const d: SymbolDefinition = {
    id: 'edges',
    name: 'Edges',
    width: 100,
    height: 100,
    shapes: [a],
    timeline: { duration: 10, keys: [p.layers[0].keys[1]], layers: [] },
  };
  const original = clone(d);
  expect(() =>
    generateSymbolMotionFrames(
      d,
      ['@base'],
      0,
      4,
      'linear',
      false,
      false,
      true,
      undefined,
      false,
      false,
      [d],
      undefined,
      false,
      false,
      false,
      'edges',
    ),
  ).toThrow(/segment collapses/);
  expect(d).toEqual(original);
});
it('checks straight edges across scale and translation, accepting safe straight and curved motion', () => {
  for (const scale of [0.001, 1, 100])
    for (const origin of [-99900, 0, 99900]) {
      const p = edgeFixture(),
        [a, b] = p.layers[0].keys.slice(0, 2).map((k) => k.shapes[0]);
      for (const s of [a, b])
        for (const n of s.contours![0]) {
          n.x = n.x * scale + origin;
          n.y = n.y * scale + origin;
        }
      expect(() => validateMotionContourEdges(a, b)).toThrow(/segment collapses/);
      const safe = clone(a);
      for (const n of safe.contours![0]) {
        n.x += scale;
        n.y += scale;
      }
      expect(() => validateMotionContourEdges(a, safe)).not.toThrow();
    }
  const a = shape(),
    b = clone(a);
  expect(() => validateMotionContourEdges(a, b)).not.toThrow();
  a.nodes = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];
  b.nodes = [
    { x: 10, y: 0 },
    { x: 0, y: 0 },
  ];
  expect(() => validateMotionContourEdges(a, b)).toThrow(/segment collapses/);
  b.nodes = [
    { x: 0, y: 5 },
    { x: 10, y: 5 },
  ];
  expect(() => validateMotionContourEdges(a, b)).not.toThrow();
});

it('generates safe edge-guarded motion and rejects later tracks without partial keys', () => {
  const p = edgeFixture();
  const bad = { ...newLayer('Collapse'), keys: clone(p.layers[0].keys) };
  p.layers[0].keys[1].shapes[0].contours = clone(p.layers[0].keys[0].shapes[0].contours);
  p.layers.push(bad);
  const run = (ids: string[]) =>
    generateMotionFrames(
      p,
      ids,
      0,
      4,
      'in-out',
      false,
      false,
      true,
      undefined,
      false,
      false,
      undefined,
      false,
      false,
      false,
      'edges',
    );
  const before = clone(p);
  expect(() => run(p.layers.map((l) => l.id))).toThrow(/segment collapses/);
  expect(p).toEqual(before);
  run([p.layers[0].id]);
  expect(p.layers[0].keys[2].shapes[0].contours).toEqual(
    before.layers[0].keys[0].shapes[0].contours,
  );
  expect(p.layers[0].keys.find((k) => k.frame === 4)).toEqual(before.layers[0].keys[1]);
  expect(p.layers[1]).toEqual(before.layers[1]);
});

it('detects whole cubic segment collapse without rejecting coincident-anchor loops', () => {
  const p = edgeFixture(),
    [a, b] = p.layers[0].keys.slice(0, 2).map((k) => k.shapes[0]);
  for (const s of [a, b]) {
    s.fillRule = 'evenodd';
    const ring = s.contours![0],
      p = ring[0],
      q = ring[1];
    p.out = { x: p.x + (q.x - p.x) / 3, y: q.x - p.x };
    q.in = { x: p.x + (2 * (q.x - p.x)) / 3, y: q.x - p.x };
  }
  expect(() => validateMotionContourAreas(a, b)).not.toThrow();
  expect(() => validateMotionContourEdges(a, b)).toThrow(/segment collapses/);
  const loop = shape();
  loop.nodes = [
    { x: 0, y: 0, out: { x: 10, y: 20 } },
    { x: 0, y: 0, in: { x: -10, y: 20 } },
  ];
  expect(() => validateMotionContourEdges(loop, clone(loop))).not.toThrow();
  const translated = clone(loop);
  for (const n of translated.nodes!) {
    n.x += 5;
    n.y += 3;
    if (n.in) {
      n.in.x += 5;
      n.in.y += 3;
    }
    if (n.out) {
      n.out.x += 5;
      n.out.y += 3;
    }
  }
  expect(() => validateMotionContourEdges(loop, translated)).not.toThrow();
});

it('splits and merges explicitly paired unequal gradient groups with exact endpoints', () => {
  for (const merge of [false, true]) {
    const p = stopFixture();
    const a = p.layers[0].keys[0].shapes[0].gradient!,
      b = p.layers[0].keys[1].shapes[0].gradient!;
    a.stops = [
      { offset: 0, color: '#ff0000', opacity: 0 },
      { offset: 1, color: '#0000ff' },
    ];
    b.stops = [
      { offset: 0, color: '#000000' },
      { offset: 0.5, color: '#000000' },
      { offset: 0.5, color: '#ffffff' },
      { offset: 1, color: '#ffffff' },
    ];
    if (merge) [a.stops, b.stops] = [b.stops, a.stops];
    const mode = parseMotionGradientPairs(merge ? '0:0, 1:0, 2:1' : '0:0, 0:1, 1:2', true, true);
    const before = clone(p);
    const d: SymbolDefinition = {
      id: 'paired',
      name: 'Paired',
      width: 100,
      height: 100,
      shapes: clone(p.layers[0].keys[0].shapes),
      timeline: { duration: p.duration, keys: clone(p.layers[0].keys.slice(1)), layers: [] },
    };
    const original = clone(d);
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'linear',
      false,
      true,
      false,
      undefined,
      false,
      true,
      undefined,
      false,
      false,
      mode,
      false,
      0,
      false,
      undefined,
      true,
    );
    const result = generateSymbolMotionFrames(
      d,
      ['@base'],
      0,
      4,
      'linear',
      false,
      true,
      false,
      undefined,
      false,
      true,
      [d],
      undefined,
      false,
      false,
      mode,
      false,
      0,
      false,
      undefined,
      true,
    );
    const stops = p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops;
    expect(stops).toEqual([
      { offset: 0, color: '#000000', opacity: 0.5 },
      { offset: 0.25, color: '#000000', opacity: 0.5 },
      { offset: 0.25, color: '#ffffff', opacity: 0.5 },
      { offset: 1, color: '#8080ff' },
    ]);
    expect(result.timeline!.keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops).toEqual(
      stops,
    );
    for (const key of before.layers[0].keys)
      expect(p.layers[0].keys.find((k) => k.frame === key.frame)).toEqual(key);
    expect(d).toEqual(original);
    stops[1].color = '#abcdef';
    expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  }
});
it('rejects incomplete or excessive explicit gradient group pairings atomically', () => {
  for (const text of ['0:0,0:0', '1:0', '0:0,2:1', '0:0,1:1,0:2', '0:0,', '0:-1', '0:0.5'])
    expect(() => parseMotionGradientPairs(text, true, true)).toThrow(/group/);
  expect(() => parseMotionGradientPairs('0:0', true, false)).toThrow(/Enable/);
  const run = (p: ReturnType<typeof fixture>, mode: MotionGradientStops) =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
      0,
      4,
      'linear',
      false,
      true,
      false,
      undefined,
      false,
      true,
      undefined,
      false,
      false,
      mode,
    );
  const p = orderedStopFixture(),
    other = clone(p.layers[0]);
  other.id = 'later';
  other.keys[1].shapes[0].gradient!.stops.splice(1, 0, { offset: 0.4, color: '#000000' });
  p.layers.push(other);
  const before = clone(p);
  expect(() =>
    run(p, {
      pairs: [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
    }),
  ).toThrow(/group count/);
  expect(p).toEqual(before);
  const large = stopFixture();
  large.layers[0].keys[0].shapes[0].gradient!.stops = Array.from({ length: 17 }, () => ({
    offset: 0,
    color: '#000000',
  }));
  large.layers[0].keys[1].shapes[0].gradient!.stops = [
    { offset: 0, color: '#000000' },
    { offset: 1, color: '#ffffff' },
  ];
  const saved = clone(large);
  expect(() =>
    run(large, {
      pairs: [
        [0, 0],
        [0, 1],
      ],
    }),
  ).toThrow(/32-stop/);
  expect(large).toEqual(saved);
});

it.each([false, true])(
  'generates waypoint motion in main and symbols with exact endpoints and atomic tangent rejection (curved %s)',
  (curvedWaypoints) => {
    const p = fixture(),
      before = clone(p),
      path = {
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        waypoints: [
          { x: 30, y: 0 },
          { x: 30, y: 40 },
        ],
        curvedWaypoints,
        distance: !curvedWaypoints,
      };
    const d: SymbolDefinition = {
      id: 'waypoints',
      name: 'Waypoints',
      width: 100,
      height: 100,
      shapes: clone(p.layers[0].keys[0].shapes),
      timeline: { duration: p.duration, keys: clone(p.layers[0].keys.slice(1)), layers: [] },
    };
    expect(() =>
      generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', false, false, false, {
        ...path,
        curvedWaypoints: false,
        waypoints: [{ x: 0, y: 0 }],
        tangent: true,
      }),
    ).toThrow(/tangent/);
    expect(p).toEqual(before);
    expect(() =>
      generateSymbolMotionFrames(d, ['@base'], 0, 4, 'linear', false, false, false, {
        ...path,
        curvedWaypoints: false,
        waypoints: [{ x: 0, y: 0 }],
        tangent: true,
      }),
    ).toThrow(/tangent/);
    const original = clone(d);
    generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', false, false, false, path);
    const result = generateSymbolMotionFrames(
      d,
      ['@base'],
      0,
      4,
      'linear',
      false,
      false,
      false,
      path,
    );
    expect(d).toEqual(original);
    for (const key of before.layers[0].keys)
      expect(p.layers[0].keys.find((k) => k.frame === key.frame)).toEqual(key);
    for (const key of result.timeline!.keys)
      expect(key.shapes).toEqual(p.layers[0].keys.find((k) => k.frame === key.frame)!.shapes);
  },
);

it('rejects unresolved waypoint distances in main and symbol generation without changing keys', () => {
  const p = fixture();
  for (const key of p.layers[0].keys.slice(0, 2)) {
    key.shapes[0].x = 0;
    key.shapes[0].y = 0;
  }
  p.layers[0].keys[1].shapes[0].x = 2;
  p.layers[0].keys[1].shapes[0].y = 1e-20;
  const path = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    waypoints: [
      { x: 1, y: 0 },
      { x: 1, y: 1e-20 },
    ],
    distance: true,
  };
  const before = clone(p);
  const d: SymbolDefinition = {
    id: 'tiny',
    name: 'Tiny',
    width: 100,
    height: 100,
    shapes: clone(p.layers[0].keys[0].shapes),
    timeline: { duration: p.duration, keys: clone(p.layers[0].keys.slice(1)), layers: [] },
  };
  const original = clone(d);
  expect(() =>
    generateMotionFrames(p, [p.layers[0].id], 0, 4, 'linear', false, false, false, path),
  ).toThrow(/unresolved/);
  expect(p).toEqual(before);
  expect(() =>
    generateSymbolMotionFrames(d, ['@base'], 0, 4, 'linear', false, false, false, path),
  ).toThrow(/unresolved/);
  expect(d).toEqual(original);
});

it('automatically aligns unequal color groups deterministically in both directions', () => {
  expect(parseMotionGradientPairs(' AUTO ', true, true)).toEqual({ pairs: 'auto' });
  for (const merge of [false, true]) {
    const p = stopFixture(),
      a = p.layers[0].keys[0].shapes[0].gradient!,
      b = p.layers[0].keys[1].shapes[0].gradient!;
    a.stops = [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ];
    b.stops = [
      { offset: 0, color: '#000000' },
      { offset: 0.4, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ];
    if (merge) [a.stops, b.stops] = [b.stops, a.stops];
    const manual = clone(p),
      before = clone(p);
    const run = (project: typeof p, mode: MotionGradientStops) =>
      generateMotionFrames(
        project,
        [project.layers[0].id],
        0,
        4,
        'linear',
        false,
        true,
        false,
        undefined,
        false,
        true,
        undefined,
        false,
        false,
        mode,
      );
    run(p, { pairs: 'auto' });
    run(manual, {
      pairs: merge
        ? [
            [0, 0],
            [1, 0],
            [2, 1],
          ]
        : [
            [0, 0],
            [0, 1],
            [1, 2],
          ],
    });
    expect(p).toEqual(manual);
    for (const key of before.layers[0].keys)
      expect(p.layers[0].keys.find((k) => k.frame === key.frame)).toEqual(key);
    const d: SymbolDefinition = {
      id: 'auto',
      name: 'Auto',
      width: 100,
      height: 100,
      shapes: before.layers[0].keys[0].shapes,
      timeline: { duration: before.duration, keys: before.layers[0].keys.slice(1), layers: [] },
    };
    const original = clone(d);
    const result = generateSymbolMotionFrames(
      d,
      ['@base'],
      0,
      4,
      'linear',
      false,
      true,
      false,
      undefined,
      false,
      true,
      [d],
      undefined,
      false,
      false,
      { pairs: 'auto' },
    );
    expect(result.timeline!.keys).toEqual(p.layers[0].keys.slice(1));
    expect(d).toEqual(original);
  }
});
it('automatic matching respects hard-group multiplicity and the expanded stop limit', () => {
  const p = orderedStopFixture();
  p.layers[0].keys[0].shapes[0].gradient!.stops = Array.from({ length: 17 }, () => ({
    offset: 0,
    color: '#000000',
  }));
  p.layers[0].keys[1].shapes[0].gradient!.stops = [
    { offset: 0, color: '#000000' },
    { offset: 1, color: '#ffffff' },
  ];
  const before = clone(p);
  expect(() =>
    generateMotionFrames(
      p,
      [p.layers[0].id],
      0,
      4,
      'linear',
      false,
      true,
      false,
      undefined,
      false,
      true,
      undefined,
      false,
      false,
      { pairs: 'auto' },
    ),
  ).toThrow(/32-stop/);
  expect(p).toEqual(before);
});

it('automatic correspondence ignores hidden RGB while retaining opacity differences', () => {
  const p = stopFixture();
  p.layers[0].keys[0].shapes[0].gradient!.stops = [
    { offset: 0, color: '#ff0000', opacity: 0 },
    { offset: 1, color: '#00ff00', opacity: 1 },
  ];
  p.layers[0].keys[1].shapes[0].gradient!.stops = [
    { offset: 0, color: '#0000ff', opacity: 0 },
    { offset: 0.7, color: '#00ff00', opacity: 0 },
    { offset: 1, color: '#00ff00', opacity: 1 },
  ];
  const manual = clone(p);
  const run = (project: typeof p, mode: MotionGradientStops) =>
    generateMotionFrames(
      project,
      [project.layers[0].id],
      0,
      4,
      'linear',
      false,
      true,
      false,
      undefined,
      false,
      true,
      undefined,
      false,
      false,
      mode,
    );
  run(p, { pairs: 'auto' });
  run(manual, {
    pairs: [
      [0, 0],
      [0, 1],
      [1, 2],
    ],
  });
  expect(p).toEqual(manual);
});

it('finds a feasible automatic correspondence when the unconstrained color optimum exceeds capacity', () => {
  const p = orderedStopFixture();
  for (const [side, key] of p.layers[0].keys.slice(0, 2).entries())
    key.shapes[0].gradient!.stops = Array.from({ length: 16 }, (_, i) =>
      Array.from({ length: 2 }, () => ({
        offset: i / 15,
        color: (i + side) % 2 ? '#ffffff' : '#000000',
      })),
    ).flat();
  const before = clone(p);
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    false,
    true,
    false,
    undefined,
    false,
    true,
    undefined,
    false,
    false,
    { pairs: 'auto' },
  );
  const mid = p.layers[0].keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops;
  expect(mid).toHaveLength(32);
  expect(mid.every((s) => s.color === '#808080')).toBe(true);
  for (const key of before.layers[0].keys)
    expect(p.layers[0].keys.find((k) => k.frame === key.frame)).toEqual(key);
  const d: SymbolDefinition = {
    id: 'capacity-auto',
    name: 'Capacity',
    width: 100,
    height: 100,
    shapes: before.layers[0].keys[0].shapes,
    timeline: { duration: before.duration, keys: before.layers[0].keys.slice(1), layers: [] },
  };
  const original = clone(d);
  const result = generateSymbolMotionFrames(
    d,
    ['@base'],
    0,
    4,
    'linear',
    false,
    true,
    false,
    undefined,
    false,
    true,
    [d],
    undefined,
    false,
    false,
    { pairs: 'auto' },
  );
  expect(result.timeline!.keys.find((k) => k.frame === 2)!.shapes[0].gradient!.stops).toEqual(mid);
  expect(d).toEqual(original);
});

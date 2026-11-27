import { afterEach, expect, it, vi } from 'vitest';
import { liveRotationFixture } from './live-motion-rotation-fixture';
import { prepareIndependentGroupPath } from '../packages/animation/src/independent-group-path';
import { prepareRestrictedIndependentGroupPath as compile } from '../packages/animation/src/restricted-independent-group-path';
import {
  splitRestrictedArcGeometry,
  type RestrictedArcGeometry,
} from '../packages/animation/src/restricted-arc-geometry';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { createMotionPathSampler } from '../packages/animation/src/motion-path';

afterEach(() => vi.unstubAllGlobals());
function setup(basis = 'plain', cut = 0.5, scale = 1) {
  const { p } = liveRotationFixture('rigid', basis),
    layer = p.layers[0],
    span = layer.liveMotionSpans![0];
  layer.keys[0].shapes[1].x = layer.keys[0].shapes[0].x;
  for (const shape of layer.keys[0].shapes) {
    shape.x *= scale;
    shape.y *= scale;
  }
  layer.keys[1].shapes = layer.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 96 * scale,
    y: s.y + 24 * scale,
  }));
  const binding = {
    groupId: 'outer',
    composition: 'additive' as const,
    path: {
      startX: 32 * scale,
      startY: -40 * scale,
      endX: -32 * scale,
      endY: -24 * scale,
      distance: true,
    },
  };
  const original = prepareIndependentGroupPath(layer, span, binding);
  const cubic: RestrictedArcGeometry['cubic'] = [
    { x: 0, y: 0 },
    { x: 32 * scale, y: -40 * scale },
    { x: 64 * scale, y: 0 },
    { x: 96 * scale, y: 24 * scale },
  ];
  const geometry: RestrictedArcGeometry = {
    descriptor: { version: 1, cubic, from: 0, to: 1 },
    origin: { x: 0, y: 0 },
    cubic,
  };
  function part(geometry: RestrictedArcGeometry, start: number, end: number) {
    const first = layer.keys[0].shapes.map((s) => ({
      ...structuredClone(s),
      x: s.x + geometry.origin.x,
      y: s.y + geometry.origin.y,
    }));
    const last = first.map((s) => ({
      ...structuredClone(s),
      x: s.x + geometry.cubic[3].x,
      y: s.y + geometry.cubic[3].y,
    }));
    return {
      layer: {
        ...structuredClone(layer),
        keys: [
          { frame: start, shapes: first },
          { frame: end, shapes: last },
        ],
      },
      span: { ...structuredClone(span), start, end },
      binding: {
        ...structuredClone(binding),
        path: {
          ...binding.path,
          startX: geometry.cubic[1].x,
          startY: geometry.cubic[1].y,
          endX: geometry.cubic[2].x - geometry.cubic[3].x,
          endY: geometry.cubic[2].y - geometry.cubic[3].y,
        },
      },
      geometry: structuredClone(geometry),
    };
  }
  const halves = splitRestrictedArcGeometry({
    geometry,
    progress: cut,
    middle: original.route(cut),
  });
  return {
    original,
    geometry,
    part,
    halves,
    inputs: halves.map((g, i) => part(g, i ? 4 : 0, i ? 8 : 4)),
  };
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const cut of [0.25, 0.5, 0.75])
    it(`compiles actual ${basis} asymmetric halves at ${cut} from original timing`, () => {
      const f = setup(basis, cut);
      for (const [i, input] of f.inputs.entries()) {
        const before = structuredClone(input),
          plan = compile(input);
        for (let j = 0; j <= 128; j++) {
          const t = j / 128,
            actual = plan.route(t),
            expected = f.original.route(i ? cut + (1 - cut) * t : cut * t);
          expect(
            sameMotionArtwork(
              { x: actual.x + input.geometry.origin.x, y: actual.y + input.geometry.origin.y },
              { x: expected.x, y: expected.y },
            ),
          ).toBe(true);
        }
        expect(plan.route(0)).toMatchObject({ x: 0, y: 0 });
        expect(plan.route(1)).toMatchObject({ x: plan.dx, y: plan.dy });
        expect(plan.ids).toEqual(['a', 'b']);
        expect(input).toEqual(before);
      }
    });
it('retains original timing after recursive JSON-reopened geometry without rebuilding half timing', () => {
  const f = setup(),
    right = f.halves[1],
    plan = compile(f.inputs[1]);
  const middle = plan.route(0.5);
  const halves = splitRestrictedArcGeometry({
    geometry: JSON.parse(JSON.stringify(right)),
    progress: 0.5,
    middle: { x: right.origin.x + middle.x, y: right.origin.y + middle.y },
  });
  for (const [i, g] of halves.entries()) {
    const route = compile(f.part(JSON.parse(JSON.stringify(g)), i ? 6 : 4, i ? 8 : 6)).route;
    for (let j = 0; j <= 64; j++) {
      const t = j / 64,
        actual = route(t),
        expected = f.original.route(i ? 0.75 + 0.25 * t : 0.5 + 0.25 * t);
      expect(
        sameMotionArtwork(
          { x: actual.x + g.origin.x, y: actual.y + g.origin.y },
          { x: expected.x, y: expected.y },
        ),
      ).toBe(true);
    }
  }
  const fresh = createMotionPathSampler(
    { x: 0, y: 0 },
    { x: plan.dx, y: plan.dy },
    f.inputs[1].binding.path,
  );
  expect(sameMotionArtwork(fresh(0.3), plan.route(0.3))).toBe(false);
});
it('keeps compiled routes private after source/output mutation', () => {
  const input = setup().inputs[0],
    plan = compile(input),
    expected = plan.route(0.4);
  input.binding.path.startX += 100;
  input.geometry.descriptor.cubic[1].x += 100;
  input.layer.keys[0].shapes[0].x += 100;
  plan.ids.length = 0;
  expect(plan.route(0.4)).toEqual(expected);
});
for (const scale of [0.001, 1000])
  it(`retains relative geometry at scale ${scale}`, () => {
    const input = setup('reflected', 0.5, scale).inputs[1];
    const plan = compile(input);
    expect(plan.route(0)).toMatchObject({ x: 0, y: 0 });
    expect(plan.route(0.4).x).toBeGreaterThan(0);
  });
for (const what of [
  'start',
  'end',
  'target',
  'origin',
  'descriptor',
  'member',
  'basis',
  'symbol',
  'shared',
  'waypoints',
  'distance',
] as const)
  it(`rejects changed or unsupported original ${what}`, () => {
    const input = setup().inputs[0];
    if (what === 'start') input.binding.path.startX++;
    if (what === 'end') input.binding.path.endY++;
    if (what === 'target') for (const s of input.layer.keys[1].shapes) s.x++;
    if (what === 'origin') input.geometry.origin.y++;
    if (what === 'descriptor') input.geometry.descriptor.from = 0.1;
    if (what === 'member') input.layer.keys[1].shapes[1].x++;
    if (what === 'basis') input.layer.keys[1].shapes[0].transform![0]++;
    if (what === 'symbol') input.layer.keys[0].shapes[0].kind = 'symbol';
    if (what === 'shared') Object.assign(input.span, { path: { ...input.binding.path } });
    if (what === 'waypoints') Object.assign(input.binding.path, { waypoints: [{ x: 3, y: 4 }] });
    if (what === 'distance') input.binding.path.distance = false;
    const before = structuredClone(input);
    expect(() => compile(input)).toThrow();
    expect(input).toEqual(before);
  });
for (const progress of [NaN, Infinity, -0.1, 1.1])
  it(`rejects invalid progress ${progress}`, () => {
    const plan = compile(setup().inputs[0]);
    expect(() => plan.route(progress)).toThrow();
  });
it('rejects raw getters before reading and clone-time/late detached source corruption', () => {
  let input = setup().inputs[0],
    reads = 0;
  Object.defineProperty(input.binding.path, 'startX', {
    enumerable: true,
    get() {
      reads++;
      return 0;
    },
  });
  expect(() => compile(input)).toThrow();
  expect(reads).toBe(0);
  input = setup().inputs[0];
  const clone = structuredClone;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = clone(value);
    input.binding.path.endY++;
    return out;
  });
  expect(() => compile(input)).toThrow(/source changed/);
  vi.unstubAllGlobals();
  input = setup().inputs[0];
  let captured: typeof input | undefined;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = clone(value);
    if (value === input) captured = out as typeof input;
    else if (captured) captured.binding.path.endY++;
    return out;
  });
  expect(() => compile(input)).toThrow(/source changed/);
});
it('rejects aliased capture and numeric overflow without changing the source', () => {
  const input = setup().inputs[0];
  vi.stubGlobal('structuredClone', (value: unknown) => value);
  expect(() => compile(input)).toThrow(/detached/);
  vi.unstubAllGlobals();
  input.binding.path.endX = Number.MAX_VALUE;
  expect(() => compile(input)).toThrow();
});
it('retains the legacy stationary-cubic convention', () => {
  const input = setup().inputs[0];
  for (const key of input.layer.keys)
    for (const s of key.shapes) {
      s.x = 0;
      s.y = 0;
    }
  input.binding.path = { startX: 0, startY: 0, endX: 0, endY: 0, distance: true };
  const cubic: RestrictedArcGeometry['cubic'] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  input.geometry = {
    descriptor: { version: 1, cubic, from: 0.25, to: 0.75 },
    origin: { x: 0, y: 0 },
    cubic,
  };
  const plan = compile(input);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(plan.route(t)).toMatchObject({ x: 0, y: 0 });
});
it('rejects omitted, inherited and unknown wrapper fields', () => {
  const input = setup().inputs[0];
  expect(() => compile({ ...input, extra: true } as typeof input)).toThrow(/fields/);
  expect(() => compile(Object.create(input))).toThrow(/plain/);
  const { geometry, ...missing } = input;
  void geometry;
  expect(() => compile(missing as typeof input)).toThrow(/fields/);
});

import { afterEach, expect, it, vi } from 'vitest';
import { captureRememberedNodeAuthoringFrame } from '../packages/animation/src/node-motion-owner';
import {
  sampledAttachedFillFixture,
  isolatedSampledAttachedFillFixture,
} from './sampled-attached-fill-fixture';
import { worldPoint } from '../packages/geometry/src';
import { captureSymbolRememberedAuthoringFrame } from '../packages/animation/src/symbol-motion-owner';
import {
  promoteSampledMotionFrame,
  refreshBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import {
  moveRememberedEndpointNodes,
  moveRememberedEndpointTangents,
  moveSymbolRememberedEndpointNodes,
} from '../packages/animation/src/motion-junction';
import {
  MAX_SYMBOL_ARTWORK,
  symbolLayers,
  type Vector,
  type BezierNode,
} from '../packages/document/src';
import { inversePoint, matrix } from '../packages/geometry/src/affine';
afterEach(() => vi.restoreAllMocks());
const world = (s: Vector, n: BezierNode) => ({
  ...worldPoint(s, n),
  ...(n.in ? { in: worldPoint(s, n.in) } : {}),
  ...(n.out ? { out: worldPoint(s, n.out) } : {}),
});
it('sampled line anchor authoring carries an original attached paint corner before regeneration', () => {
  const state = sampledAttachedFillFixture(),
    capture = captureRememberedNodeAuthoringFrame(() => state);
  const candidate = capture.prepareNodePosition('base', 'line', 0, { x: 90, y: 50 }),
    shapes = candidate.layers[0].keys.find((k) => k.frame === 4)!.shapes;
  expect(worldPoint(shapes[0], shapes[0].contours![0][0])).toEqual({ x: 90, y: 50 });
  capture.dispose();
});
for (const kind of ['anchor', 'tangent'] as const)
  it(`both regenerated halves retain attached ${kind} geometry, options and original authored endpoints`, () => {
    const state = sampledAttachedFillFixture(kind === 'tangent'),
      before = structuredClone(state),
      cap = captureRememberedNodeAuthoringFrame(() => state);
    const candidate =
      kind === 'anchor'
        ? cap.prepareNodePosition('base', 'line', 0, { x: 90, y: 50 })
        : cap.prepareTangentPosition('base', 'line', 0, 'out', { x: 140, y: 5 });
    for (const key of candidate.layers[0].keys.filter((k) => k.frame <= 8)) {
      const [paint, line] = key.shapes,
        a = world(paint, paint.contours![0][0]),
        b = world(line, line.nodes![0]);
      expect(a).toEqual(b);
      expect(paint.contours![0]).toHaveLength(4);
      expect(line.nodes).toHaveLength(2);
      if (key.frame === 2 || key.frame === 6) {
        if (kind === 'anchor') {
          expect(a.x).toBe(key.frame === 2 ? 65 : 105);
          expect(a.y).toBe(55);
        } else expect(a.out!.y).toBe(17.5);
      }
    }
    expect(candidate.layers[0].keys.filter((k) => [0, 8, 10].includes(k.frame))).toEqual(
      before.project.layers[0].keys.filter((k) => [0, 8, 10].includes(k.frame)),
    );
    expect(candidate.layers[0].motionSpans!.map((s) => s.options)).toEqual([
      { nodes: true, affine: true },
      { nodes: true, affine: true },
    ]);
    const reopened = structuredClone(candidate);
    for (const span of reopened.layers[0].motionSpans!)
      refreshBasicMotionSpan(reopened, ['base'], span.start, span.end);
    expect(reopened.layers[0].keys).toEqual(candidate.layers[0].keys);
    expect(state).toEqual(before);
    cap.dispose();
  });
for (const kind of ['anchor', 'tangent'] as const)
  it(`library-aware isolated sampled ${kind} preparation retains maps and detached linked paint`, () => {
    const source = isolatedSampledAttachedFillFixture(kind === 'tangent'),
      before = structuredClone(source),
      cap = captureSymbolRememberedAuthoringFrame(() => source);
    const candidate =
      kind === 'anchor'
        ? cap.prepareNodePosition('@base', 'line', 0, { x: 90, y: 50 })
        : cap.prepareTangentPosition('@base', 'line', 0, 'out', { x: 140, y: 5 });
    const key = symbolLayers(candidate)[0].keys.find((k) => k.frame === 4)!,
      [paint, line] = key.shapes;
    expect(world(paint, paint.contours![0][0])).toEqual(world(line, line.nodes![0]));
    expect(candidate.buttonStates).toEqual(before.definition.buttonStates);
    expect(source).toEqual(before);
    paint.contours![0][0].x = 999;
    const retry =
      kind === 'anchor'
        ? cap.prepareNodePosition('@base', 'line', 0, { x: 90, y: 50 })
        : cap.prepareTangentPosition('@base', 'line', 0, 'out', { x: 140, y: 5 });
    expect(
      symbolLayers(retry)[0].keys.find((k) => k.frame === 4)!.shapes[0].contours![0][0].x,
    ).not.toBe(999);
    cap.dispose();
  });
it('compound stroke anchors carry attached paint without flattening ring ownership', () => {
  const state = sampledAttachedFillFixture(false, (line, paint) => {
    line.kind = 'polygon';
    line.fillRule = 'evenodd';
    line.closed = true;
    line.contours = structuredClone(paint.contours);
    delete line.nodes;
  });
  const cap = captureRememberedNodeAuthoringFrame(() => state),
    candidate = cap.prepareCompoundNodePosition('base', 'line', 0, 0, { x: 90, y: 50 }),
    [paint, line] = candidate.layers[0].keys.find((k) => k.frame === 4)!.shapes;
  expect(world(paint, paint.contours![0][0])).toEqual(world(line, line.contours![0][0]));
  expect(paint.contours).toHaveLength(1);
  expect(line.contours![0]).toHaveLength(4);
  cap.dispose();
});
for (const mode of ['object', 'group'] as const)
  it(`independent ${mode} fill does not gain an attachment`, () => {
    const state = sampledAttachedFillFixture(false, (_line, paint) => {
        if (mode === 'object') paint.drawingMode = 'object';
        else paint.groups = ['other'];
      }),
      cap = captureRememberedNodeAuthoringFrame(() => state),
      candidate = cap.prepareNodePosition('base', 'line', 0, { x: 90, y: 50 });
    expect(candidate.layers[0].keys.map((k) => k.shapes[0])).toEqual(
      state.project.layers[0].keys.map((k) => k.shapes[0]),
    );
    cap.dispose();
  });
it('preserves a differently based fill and its original paint metadata while moving an anchor', () => {
  const state = sampledAttachedFillFixture(false, (_line, paint) => {
      paint.transform = [2, 0.2, 0.3, 1];
      paint.gradient = undefined;
      for (const ring of paint.contours!)
        for (const n of ring) {
          const q = inversePoint(matrix(paint), { x: 40 + n.x, y: 60 + n.y });
          n.x = q.x;
          n.y = q.y;
        }
    }),
    cap = captureRememberedNodeAuthoringFrame(() => state),
    original = cap.scene[0].key.shapes[0],
    candidate = cap.prepareNodePosition('base', 'line', 0, { x: 90, y: 50 }),
    paint = candidate.layers[0].keys.find((k) => k.frame === 4)!.shapes[0];
  expect(worldPoint(paint, paint.contours![0][0]).x).toBeCloseTo(90, 10);
  expect(worldPoint(paint, paint.contours![0][0]).y).toBeCloseTo(50, 10);
  expect(paint.transform).toEqual(original.transform);
  expect(matrix(paint)).toEqual(matrix(original));
  expect(paint.pivot).toEqual({ x: -15, y: 20 });
  cap.dispose();
});
it('rejects a later track before publishing an earlier linked-fill preparation', () => {
  const state = sampledAttachedFillFixture(),
    project = structuredClone(state.project),
    extra = structuredClone(project.layers[0]);
  extra.id = 'extra';
  extra.motionSpans![0].id = 'extra-motion';
  project.layers.push(extra);
  promoteSampledMotionFrame(project, ['base', 'extra'], 0, 8, 4);
  const before = structuredClone(project);
  expect(() =>
    moveRememberedEndpointNodes(project, 4, [
      { layerId: 'base', shapeId: 'line', nodeIndex: 0, position: { x: 90, y: 50 } },
      { layerId: 'extra', shapeId: 'line', nodeIndex: 99, position: { x: 90, y: 50 } },
    ]),
  ).toThrow();
  expect(project).toEqual(before);
});
it('keeps linked-fill failures atomic when saved interpolation does not admit the new endpoint', () => {
  const state = sampledAttachedFillFixture();
  state.project.layers[0].motionSpans![0].options!.nodes = false;
  const cap = captureRememberedNodeAuthoringFrame(() => state),
    before = structuredClone(state);
  expect(() => cap.prepareNodePosition('base', 'line', 0, { x: 90, y: 50 })).toThrow();
  expect(state).toEqual(before);
  const plain = structuredClone(state.project);
  promoteSampledMotionFrame(plain, ['base'], 0, 8, 4);
  expect(plain.layers[0].motionSpans).toHaveLength(2);
  cap.dispose();
});
it('rejects raw original getters without invoking them in a merged endpoint', () => {
  const state = sampledAttachedFillFixture();
  promoteSampledMotionFrame(state.project, ['base'], 0, 8, 4);
  const paint = state.project.layers[0].keys.find((k) => k.frame === 4)!.shapes[0],
    get = vi.fn(() => 0);
  Object.defineProperty(paint.contours![0][0], 'x', { enumerable: true, get });
  expect(() =>
    moveRememberedEndpointNodes(state.project, 4, [
      { layerId: 'base', shapeId: 'line', nodeIndex: 0, position: { x: 90, y: 50 } },
    ]),
  ).toThrow();
  expect(get).not.toHaveBeenCalled();
});
it('rechecks original sources after request getters and preserves only the external edit', () => {
  const state = sampledAttachedFillFixture();
  promoteSampledMotionFrame(state.project, ['base'], 0, 8, 4);
  const before = structuredClone(state.project);
  const request = {
    layerId: 'base',
    shapeId: 'line',
    nodeIndex: 0,
    get position() {
      state.project.layers[0].name = 'external';
      return { x: 90, y: 50 };
    },
  };
  expect(() => moveRememberedEndpointNodes(state.project, 4, [request])).toThrow(/changed/);
  before.layers[0].name = 'external';
  expect(state.project).toEqual(before);
});
it('rejects swallowed same-source curve reentry before either line/fill track writes', () => {
  const state = sampledAttachedFillFixture(true);
  promoteSampledMotionFrame(state.project, ['base'], 0, 8, 4);
  const before = structuredClone(state.project);
  const request = {
    layerId: 'base',
    shapeId: 'line',
    nodeIndex: 0,
    get position() {
      try {
        moveRememberedEndpointTangents(state.project, 4, [
          {
            layerId: 'base',
            shapeId: 'line',
            nodeIndex: 0,
            part: 'out',
            position: { x: 140, y: 5 },
          },
        ]);
      } catch {}
      return { x: 90, y: 50 };
    },
  };
  expect(() => moveRememberedEndpointNodes(state.project, 4, [request])).toThrow(/reenter/);
  expect(state.project).toEqual(before);
});
it('cannot activate merged companion scope from a legacy request getter', () => {
  const state = sampledAttachedFillFixture(false, (line, paint) => {
    delete line.drawingMode;
    delete paint.drawingMode;
  });
  promoteSampledMotionFrame(state.project, ['base'], 0, 8, 4);
  const before = structuredClone(state.project),
    key = state.project.layers[0].keys.find((k) => k.frame === 4)!;
  const request = {
    layerId: 'base',
    shapeId: 'line',
    nodeIndex: 0,
    get position() {
      for (const shape of key.shapes) shape.drawingMode = 'merge';
      return { x: 90, y: 50 };
    },
  };
  expect(() => moveRememberedEndpointNodes(state.project, 4, [request])).toThrow(/scope changed/);
  for (const shape of before.layers[0].keys.find((k) => k.frame === 4)!.shapes)
    shape.drawingMode = 'merge';
  expect(state.project).toEqual(before);
});
it('rejects a clone-time source edit before linked-fill keys publish', () => {
  const state = sampledAttachedFillFixture();
  promoteSampledMotionFrame(state.project, ['base'], 0, 8, 4);
  const before = structuredClone(state.project),
    native = structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
    const out = native(value);
    if ((value as Vector)?.id === 'line') state.project.background = '#abcdef';
    return out;
  });
  expect(() =>
    moveRememberedEndpointNodes(state.project, 4, [
      { layerId: 'base', shapeId: 'line', nodeIndex: 0, position: { x: 90, y: 50 } },
    ]),
  ).toThrow(/changed/);
  before.background = '#abcdef';
  expect(state.project).toEqual(before);
});
it('retains actual aggregate capacity with attached symbol paint and rejects overflow without truncation', () => {
  const source = isolatedSampledAttachedFillFixture(),
    paint: Vector = {
      id: 'tiny',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      points: [],
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
    };
  const used = symbolLayers(source.definition).reduce(
      (n, l) => n + l.keys.reduce((m, k) => m + k.shapes.length, 0),
      0,
    ),
    other = {
      id: 'other',
      name: 'Other',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK - used }, (_, i) => ({
        ...paint,
        id: String(i),
      })),
    };
  source.symbols.push(other);
  const cap = captureSymbolRememberedAuthoringFrame(() => source),
    result = cap.prepareNodePosition('@base', 'line', 0, { x: 90, y: 50 });
  cap.dispose();
  expect(
    symbolLayers(result).reduce(
      (n, l) => n + l.keys.reduce((m, k) => m + k.shapes.length, 0),
      other.shapes.length,
    ),
  ).toBe(MAX_SYMBOL_ARTWORK);
  const initial = source.definition.timeline!.keys.find((k) => k.frame === 4)!.shapes[0];
  expect(worldPoint(initial, initial.contours![0][0])).toEqual({ x: 80, y: 60 });
  other.shapes.push({ ...paint, id: 'overflow' });
  expect(() =>
    moveSymbolRememberedEndpointNodes(result, [result, other], 4, [
      { layerId: '@base', shapeId: 'line', nodeIndex: 0, position: { x: 95, y: 45 } },
    ]),
  ).toThrow(/budget/);
  expect(other.shapes).toHaveLength(MAX_SYMBOL_ARTWORK - used + 1);
}, 30000);

it('sampled duplicate closing anchors move together with the attached fill seam', () => {
  const state = sampledAttachedFillFixture(false, (line, paint) => {
      line.closed = true;
      line.nodes = structuredClone(paint.contours![0]).concat([{ x: 0, y: 0 }]);
    }),
    cap = captureRememberedNodeAuthoringFrame(() => state),
    candidate = cap.prepareNodePosition('base', 'line', 0, { x: 90, y: 50 });
  for (const key of candidate.layers[0].keys.filter((k) => k.frame <= 8)) {
    const [paint, line] = key.shapes;
    expect(world(line, line.nodes![0])).toEqual(world(line, line.nodes!.at(-1)!));
    expect(worldPoint(paint, paint.contours![0][0])).toEqual(worldPoint(line, line.nodes![0]));
    expect(line.nodes).toHaveLength(5);
  }
  cap.dispose();
});
it('sampled compound stroke tangents carry their matching original contour handles', () => {
  const state = sampledAttachedFillFixture(true, (line, paint) => {
      line.kind = 'polygon';
      line.fillRule = 'evenodd';
      line.closed = true;
      line.contours = structuredClone(paint.contours);
      delete line.nodes;
    }),
    cap = captureRememberedNodeAuthoringFrame(() => state),
    candidate = cap.prepareCompoundTangentPosition('base', 'line', 0, 0, 'out', { x: 140, y: 5 });
  const [paint, line] = candidate.layers[0].keys.find((k) => k.frame === 4)!.shapes;
  expect(world(paint, paint.contours![0][0])).toEqual(world(line, line.contours![0][0]));
  cap.dispose();
});
it('prepares both valid requested tracks with their attached companions in one transaction', () => {
  const state = sampledAttachedFillFixture(),
    p = state.project,
    extra = structuredClone(p.layers[0]);
  extra.id = 'extra';
  extra.motionSpans![0].id = 'extra-motion';
  p.layers.push(extra);
  promoteSampledMotionFrame(p, ['base', 'extra'], 0, 8, 4);
  moveRememberedEndpointNodes(p, 4, [
    { layerId: 'base', shapeId: 'line', nodeIndex: 0, position: { x: 90, y: 50 } },
    { layerId: 'extra', shapeId: 'line', nodeIndex: 0, position: { x: 95, y: 55 } },
  ]);
  for (const layer of p.layers) {
    const [paint, line] = layer.keys.find((k) => k.frame === 4)!.shapes,
      expected = layer.id === 'base' ? { x: 90, y: 50 } : { x: 95, y: 55 };
    expect(worldPoint(paint, paint.contours![0][0])).toEqual(expected);
    expect(worldPoint(line, line.nodes![0])).toEqual(expected);
  }
});

import { expect, it } from 'vitest';
import { newProject, validateProject, type Vector } from '../packages/document/src';
import { mapPoint, matrix, transformVectors, around, localAuthoringBounds, normalizeVector, objectBounds, scaleVector } from '../packages/geometry/src';
import { lassoContains } from '../packages/geometry/src/lasso';
import {
  selectionTransformFrame,
  framePoint,
  hitSelectionTransform,
  selectionTransformOperation,
  transformHandles,
  selectionTransformCursor,
} from '../apps/editor/src/selection-transform';
const art = (id = 'a'): Vector => ({
  id,
  kind: 'rectangle',
  x: 40,
  y: 50,
  width: 120,
  height: 80,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
const pivot = { x: 100, y: 90 },
  view = { x: 1, y: 1 };

it('uses an independent signed control box for layout, lasso and the transform cage', () => {
  const shape: Vector = { ...art(), kind: 'bezier', controlBounds: true,
    transform: [-1, 0, 0, 2], pivot: { x: -10, y: 40 }, width: 26, height: 40,
    nodes: [{ x: -32, y: 20, out: { x: -40, y: 8 } }, { x: -20, y: 40, in: { x: -14, y: 48 } }],
  };
  expect(localAuthoringBounds(shape)).toEqual({ left: -40, right: -14, top: 8, bottom: 48 });
  expect(objectBounds(shape)).toEqual({ left: 54, right: 80, top: 66, bottom: 146 });
  const lasso = [{x:53,y:65}, {x:81,y:65}, {x:81,y:147}, {x:53,y:147}];
  expect(lassoContains(shape, lasso)).toBe(true);
  const legacy = { ...shape };
  delete legacy.controlBounds;
  expect(lassoContains(legacy, lasso)).toBe(false);
  const frame = selectionTransformFrame([shape])!;
  expect(frame.box).toEqual({ left: -40, right: -14, top: 8, bottom: 48 });
  expect(framePoint(frame, 'nw')).toEqual({ x: 80, y: 66 });
  expect(framePoint(frame, 'se')).toEqual({ x: 54, y: 146 });

  shape.nodes![0].out!.x = -50;
  const edited = structuredClone(shape);
  normalizeVector(shape);
  expect(shape).toEqual({ ...edited, width: 36 });
  scaleVector(shape, -2, 0.5);
  expect(shape).toMatchObject({ x: 40, y: 50, width: 72, height: 20, pivot: { x: 20, y: 20 } });
  expect(localAuthoringBounds(shape)).toEqual({ left: 28, right: 100, top: 4, bottom: 24 });
});

it('admits control-bound authoring only for explicit geometry and own data', () => {
  const project = newProject();
  const shape: Vector = { ...art(), kind: 'path', controlBounds: true,
    points: [{ x: 20, y: -5 }, { x: 70, y: 10 }], width: 50, height: 15 };
  project.layers[0].keys[0].shapes = [shape];
  expect(validateProject(project)).toStrictEqual(project);
  project.layers[0].keys[0].shapes = [{ ...shape, points: [] }];
  expect(() => validateProject(project)).toThrow('control bounds require explicit path geometry');
  project.layers[0].keys[0].shapes = [{ ...art(), controlBounds: true }];
  expect(() => validateProject(project)).toThrow('control bounds require explicit path geometry');
  Object.defineProperty(shape, 'controlBounds', { get() { throw Error('marker getter executed'); }, enumerable: true });
  project.layers[0].keys[0].shapes = [shape];
  expect(() => validateProject(project)).toThrow('control bounds require explicit path geometry');
});
for (const [corner, point] of Object.entries({
  nw: { x: 28, y: 38 },
  ne: { x: 172, y: 38 },
  se: { x: 172, y: 142 },
  sw: { x: 28, y: 142 },
}))
  it(`rotates outside ${corner} while the actual corner continues to scale`, () => {
    const f = selectionTransformFrame([art()])!;
    expect(hitSelectionTransform(f, pivot, point, view, 'free')).toEqual({
      kind: 'rotate',
      handle: corner,
    });
    expect(hitSelectionTransform(f, pivot, framePoint(f, corner), view, 'free')).toEqual({
      kind: 'scale',
      handle: corner,
    });
  });
for (const [edge, point] of Object.entries({
  n: { x: 70, y: 50 },
  s: { x: 130, y: 130 },
  w: { x: 40, y: 70 },
  e: { x: 160, y: 110 },
}))
  it(`skews the ${edge} outline without a modifier`, () => {
    const f = selectionTransformFrame([art()])!;
    expect(hitSelectionTransform(f, pivot, point, view, 'free')).toEqual({
      kind: 'skew',
      handle: edge,
    });
  });
it('uses rotate/skew mode corners and midpoints, movable pivot priority and no spare rotation knob', () => {
  const f = selectionTransformFrame([art()])!;
  expect(hitSelectionTransform(f, pivot, framePoint(f, 'nw'), view, 'rotate-skew')).toEqual({
    kind: 'rotate',
    handle: 'nw',
  });
  expect(hitSelectionTransform(f, pivot, framePoint(f, 'n'), view, 'rotate-skew')).toEqual({
    kind: 'skew',
    handle: 'n',
  });
  expect(hitSelectionTransform(f, pivot, pivot, view, 'free')?.kind).toBe('pivot');
  expect(transformHandles(f, pivot, view, 'rotate-skew').some((h) => h.name === 'rotate')).toBe(
    false,
  );
});
for (const basis of ['plain', 'rotated', 'skewed', 'reflected'])
  it(`transforms an original ${basis} cage with the artwork and keeps all local geometry`, () => {
    const a = art(),
      b = { ...art('b'), x: 210, y: 80, width: 35 };
    if (basis !== 'plain') {
      a.rotation = b.rotation = 25;
      a.transform = b.transform = [
        basis === 'reflected' ? -1.4 : 1.4,
        0.2,
        basis === 'skewed' ? 0.5 : 0,
        0.9,
      ];
    }
    const source = [a, b],
      before = structuredClone(source),
      f = selectionTransformFrame(source)!,
      op = around({ x: -40, y: 200 }, 0.8, 0.6, -0.6, 0.8);
    transformVectors(source, op);
    const after = selectionTransformFrame(source)!;
    for (const name of ['nw', 'ne', 'se', 'sw']) {
      const expected = mapPoint(op, framePoint(f, name)),
        actual = framePoint(after, name);
      expect(actual.x).toBeCloseTo(expected.x, 8);
      expect(actual.y).toBeCloseTo(expected.y, 8);
    }
    source.forEach((s, i) => {
      expect(s.width).toBe(before[i].width);
      expect(s.points).toEqual(before[i].points);
    });
  });
it('rotates around the original pivot, uses 45-degree Shift increments and supports the opposite-corner Alt origin', () => {
  const f = selectionTransformFrame([art()])!,
    start = { x: 172, y: 38 },
    end = { x: 180, y: 110 },
    h = { kind: 'rotate' as const, handle: 'ne' };
  const result = selectionTransformOperation(f, h, pivot, start, end, true);
  expect(result.degrees).toBe(45);
  expect(mapPoint(result.operation, pivot).x).toBeCloseTo(pivot.x, 10);
  expect(mapPoint(result.operation, pivot).y).toBeCloseTo(pivot.y, 10);
  const alt = selectionTransformOperation(f, h, pivot, start, end, false, true),
    opposite = { x: 40, y: 130 };
  expect(alt.pivot).toEqual(opposite);
  expect(mapPoint(alt.operation, opposite).x).toBeCloseTo(opposite.x);
  expect(mapPoint(alt.operation, opposite).y).toBeCloseTo(opposite.y);
});
it('honors configured Shift angles on rotation and reflected affine skew', () => {
  const shape = { ...art(), transform: [-1, .25, .5, 1] as Vector['transform'] };
  const frame = selectionTransformFrame([shape])!, center = framePoint(frame, '');
  const arm = 38 * Math.PI / 180;
  const rotation = selectionTransformOperation(frame, { kind: 'rotate', handle: 'ne' }, center,
    { x: center.x + 60, y: center.y }, { x: center.x + Math.cos(arm) * 60, y: center.y + Math.sin(arm) * 60 },
    true, false, 30);
  expect(rotation.degrees).toBeCloseTo(30, 10);
  const top = framePoint(frame, 'n'), bottom = framePoint(frame, 's');
  const movedPoint = { x: top.x - 94.4, y: top.y + 23.6 };
  const skew = selectionTransformOperation(frame, { kind: 'skew', handle: 'n' }, center, top, movedPoint, true, false, 30);
  expect(skew.degrees).toBeCloseTo(-60, 10);
  const amount = 80 * Math.sqrt(3), moved = mapPoint(skew.operation, top), fixed = mapPoint(skew.operation, bottom);
  expect(moved.x).toBeCloseTo(top.x - amount, 10);
  expect(moved.y).toBeCloseTo(top.y + .25 * amount, 10);
  expect(fixed.x).toBeCloseTo(bottom.x, 10);
  expect(fixed.y).toBeCloseTo(bottom.y, 10);
  const alternate = selectionTransformOperation(frame, { kind: 'skew', handle: 'n' }, center, top,
    { x: top.x - 47.2, y: top.y + 11.8 }, true, true, 30);
  expect(alternate.degrees).toBeCloseTo(-60, 10);
  expect(mapPoint(alternate.operation, center).x).toBeCloseTo(center.x, 10);
  expect(mapPoint(alternate.operation, center).y).toBeCloseTo(center.y, 10);
  expect(() => selectionTransformOperation(frame, { kind: 'skew', handle: 'n' }, center,
    top, movedPoint, true, false, 90)).toThrow('Skew cannot reach 90 degrees.');
});
for (const edge of ['n', 'e', 's', 'w'])
  it(`keeps the opposite ${edge} edge fixed and preserves the picked pointer offset`, () => {
    const f = selectionTransformFrame([art()])!,
      horizontal = ['n', 's'].includes(edge),
      h = framePoint(f, edge),
      start = { x: h.x + 2, y: h.y + 1 },
      end = { x: start.x + (horizontal ? 30 : 0), y: start.y + (horizontal ? 0 : 25) },
      result = selectionTransformOperation(f, { kind: 'skew', handle: edge }, pivot, start, end);
    const moved = mapPoint(result.operation, h);
    expect(moved.x).toBeCloseTo(h.x + end.x - start.x);
    expect(moved.y).toBeCloseTo(h.y + end.y - start.y);
    const opposite = framePoint(
      f,
      ({ n: 's', s: 'n', e: 'w', w: 'e' } as Record<string, string>)[edge],
    );
    expect(mapPoint(result.operation, opposite)).toEqual(opposite);
  });
it('scales from original handles rather than pickup coordinates and retains identity on a tangential no-op', () => {
  const f = selectionTransformFrame([art()])!,
    r = selectionTransformOperation(
      f,
      { kind: 'scale', handle: 'se' },
      pivot,
      { x: 162, y: 131 },
      { x: 222, y: 171 },
    );
  expect(mapPoint(r.operation, { x: 160, y: 130 })).toEqual({ x: 220, y: 170 });
  expect(mapPoint(r.operation, { x: 40, y: 50 })).toEqual({ x: 40, y: 50 });
  expect(
    selectionTransformOperation(
      f,
      { kind: 'skew', handle: 'n' },
      pivot,
      { x: 70, y: 50 },
      { x: 70, y: 70 },
    ).operation,
  ).toEqual([1, 0, 0, 1, 0, 0]);
});
it('uses CSS distance for zoomed, unequal-scale hits and keeps operation cursors distinct', () => {
  const f = selectionTransformFrame([art()])!,
    v = { x: 0.4, y: 2 };
  expect(hitSelectionTransform(f, pivot, { x: 190, y: 44 }, v, 'free')).toEqual({
    kind: 'rotate',
    handle: 'ne',
  });
  expect(selectionTransformCursor({ kind: 'rotate', handle: 'ne' }, f, view)).toContain(
    'data:image/svg',
  );
  expect(selectionTransformCursor({ kind: 'skew', handle: 'n' }, f, view)).not.toBe(
    selectionTransformCursor({ kind: 'rotate', handle: 'ne' }, f, view),
  );
});
it('rejects nonfinite pointers, singular frames and pivot-aligned shear denominators without source writes', () => {
  const s = art(),
    before = structuredClone(s),
    f = selectionTransformFrame([s])!;
  expect(() =>
    selectionTransformOperation(f, { kind: 'rotate', handle: 'nw' }, pivot, pivot, {
      x: NaN,
      y: 0,
    }),
  ).toThrow();
  expect(() =>
    selectionTransformOperation(
      f,
      { kind: 'skew', handle: 'n' },
      { x: 100, y: 50 },
      { x: 60, y: 50 },
      { x: 80, y: 50 },
      false,
      true,
    ),
  ).toThrow();
  expect(s).toEqual(before);
  s.transform = [1, 0, 0, 0];
  expect(selectionTransformFrame([s])).toBeNull();
  expect(matrix(before)).toEqual([1, 0, 0, 1, 40, 50]);
});

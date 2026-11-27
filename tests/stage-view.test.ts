import { describe, expect, it } from 'vitest';
import {
  registeredStageView,
  stageRulerEdge,
  stageRulers,
  stageRulerTicks,
  stageView,
  stageViewBounds,
  stageViewFootprint,
} from '../apps/editor/src/stage-view';
import { inversePoint, mapPoint } from '../packages/geometry/src/affine';

const viewport = { width: 800, height: 500 };
const stage = { width: 600, height: 360 };

describe('stage view', () => {
  it('admits registered magnified affine cameras and rejects lost registration or unusable inverses', () => {
    const camera = stageView(viewport, stage, 40, { x: 83, y: -41 }, 37, -1.5, 0.2);
    expect(registeredStageView(camera.matrix, viewport, stage, camera.origin)).toBe(true);
    expect(registeredStageView(camera.matrix, viewport, stage, { ...camera.origin, x: camera.origin.x + 1 })).toBe(false);
    const reduced = stageView(viewport, stage, 0.04, { x: 4, y: 8 }, 11, -0.5);
    expect(registeredStageView(reduced.matrix, viewport, stage, reduced.origin)).toBe(true);
    expect(registeredStageView([1e-25, 0, 0, 1, 400, 0], viewport, stage, { x: 400, y: 0 })).toBe(false);
    const zero = { x: 0, y: 0 };
    expect(registeredStageView([1, 2, 2, 4, 0, 0], viewport, stage, zero)).toBe(false);
    expect(registeredStageView([1e200, 0, 0, 1e200, 0, 0], viewport, stage, zero)).toBe(false);
    expect(registeredStageView([1e307, 0, 0, 1, 0, 0], viewport, stage, zero)).toBe(false);
    expect(registeredStageView([1, 0, 0, 1, 1e30, 0], viewport, stage, { x: 1e30, y: 0 })).toBe(false);
  });

  it('keeps the axis-aligned camera exact at zero degrees', () => {
    const { matrix } = stageView(viewport, stage, 2, { x: 10, y: -20 }, 0);
    expect(matrix).toEqual([2, 0, 0, 2, -190, -130]);
    expect(stageViewFootprint(stage, 0)).toEqual(stage);
  });

  it('swaps the footprint at a quarter turn and pans in viewport axes', () => {
    const { matrix } = stageView(viewport, stage, 1, { x: 25, y: -40 }, 90);
    expect(stageViewFootprint(stage, 90)).toEqual({ width: 360, height: 600 });
    expect(mapPoint(matrix, { x: 300, y: 180 })).toEqual({ x: 425, y: 210 });
    expect(mapPoint(matrix, { x: 350, y: 150 })).toEqual({ x: 455, y: 260 });
    expect(inversePoint(matrix, { x: 455, y: 260 })).toEqual({ x: 350, y: 150 });
    expect(stageViewBounds(matrix, viewport)).toEqual({ left: 90, top: -195, right: 590, bottom: 605 });
  });

  it('projects and inverts independent axis scales before rotating the stage', () => {
    const { matrix } = stageView(viewport, stage, 2, { x: 0, y: 0 }, 90, 0.25);
    expect(matrix).toEqual([0, 2, -0.5, 0, 490, -350]);
    expect(stageViewFootprint(stage, 90, 0.25)).toEqual({ width: 90, height: 600 });
    expect(inversePoint(matrix, { x: 455, y: 50 })).toEqual({ x: 200, y: 70 });
    expect(stageRulers(matrix).top.unitsPerPixel).toBe(-2);
    expect(stageRulers(matrix).left.unitsPerPixel).toBe(0.5);
  });

  it('keeps a sheared view and its bounds exact under a quarter turn', () => {
    const { matrix } = stageView(viewport, stage, 2, { x: 0, y: 0 }, 90, 0.5, 0.5);
    expect(matrix).toEqual([0, 2, -1, 1, 580, -530]);
    expect(stageViewFootprint(stage, 90, 0.5, 0.5)).toEqual({ width: 180, height: 780 });
    expect(inversePoint(matrix, { x: 510, y: -60 })).toEqual({ x: 200, y: 70 });
  });

  it('retains reflected projection and signed ruler coordinates', () => {
    const { matrix } = stageView(viewport, stage, 2, { x: 0, y: 0 }, 180, -0.5, -0.5);
    expect(matrix).toEqual([-2, 0, 1, 1, 820, 70]);
    expect(stageViewFootprint(stage, 180, -0.5, -0.5)).toEqual({ width: 780, height: 180 });
    expect(inversePoint(matrix, { x: 490, y: 140 })).toEqual({ x: 200, y: 70 });
    const rulers = stageRulers(matrix);
    expect([rulers.top.axis, rulers.top.unitsPerPixel]).toEqual(['x', -0.5]);
    expect([rulers.left.axis, rulers.left.unitsPerPixel]).toEqual(['y', 1]);
  });

  it('assigns both rulers a moving axis when skew cancels a diagonal term', () => {
    const rulers = stageRulers([1, 1, -1, 0, 0, 0]);
    expect([rulers.top.axis, rulers.top.unitsPerPixel]).toEqual(['y', -1]);
    expect([rulers.left.axis, rulers.left.unitsPerPixel]).toEqual(['x', 1]);
  });

  it('includes the entire rotated viewport in the document-space envelope', () => {
    const { matrix } = stageView(viewport, stage, 0.5, { x: 0, y: 0 }, 45);
    const bounds = stageViewBounds(matrix, viewport);
    const radius = (viewport.width + viewport.height) * Math.SQRT1_2;
    expect(bounds.left).toBeCloseTo(300 - radius);
    expect(bounds.right).toBeCloseTo(300 + radius);
    expect(bounds.top).toBeCloseTo(180 - radius);
    expect(bounds.bottom).toBeCloseTo(180 + radius);
  });

  it('swaps ruler dimensions at a quarter turn and retains signed tick values', () => {
    const { matrix } = stageView(viewport, stage, 1, { x: 0, y: 0 }, 90);
    const { top, left } = stageRulers(matrix);
    expect(top).toEqual({ axis: 'y', guideAxis: 'x', origin: 580, unitsPerPixel: -1 });
    expect(left).toEqual({ axis: 'x', guideAxis: 'y', origin: 50, unitsPerPixel: 1 });
    expect([...stageRulerTicks(top, 22, 800, stage.height)]).toEqual([
      { value: 0, pixel: 580 },
      { value: 100, pixel: 480 },
      { value: 200, pixel: 380 },
      { value: 300, pixel: 280 },
    ]);
  });

  it('projects oblique ticks through the inner edge in document coordinates', () => {
    const { matrix } = stageView(viewport, stage, 1.5, { x: 27, y: -18 }, 45);
    const { top, left } = stageRulers(matrix);
    expect([top.axis, top.guideAxis, left.axis, left.guideAxis]).toEqual(['x', 'y', 'y', 'x']);
    const ticks = [...stageRulerTicks(top, 22, 800, stage.width)];
    expect(ticks.length).toBeGreaterThan(1);
    for (const { value, pixel } of ticks) {
      expect(pixel).toBeGreaterThanOrEqual(22);
      expect(pixel).toBeLessThanOrEqual(800);
      expect(inversePoint(matrix, { x: pixel, y: 20 }).x).toBeCloseTo(value);
    }
    expect(stageRulerEdge({ x: 10, y: 10 }, viewport)).toBe('top');
    expect(stageRulerEdge({ x: 10, y: 30 }, viewport)).toBe('left');
    expect(stageRulerEdge({ x: 30, y: 30 }, viewport)).toBeUndefined();
    expect(stageRulerEdge({ x: -1, y: 30 }, viewport)).toBeUndefined();
  });
});

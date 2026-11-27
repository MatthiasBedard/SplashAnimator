import type { Point } from '../../../packages/document/src';
import { inversePoint, mapPoint, type Matrix } from '../../../packages/geometry/src/affine';

type Size = { width: number; height: number };
type Axis = 'x' | 'y';
type StageRuler = {
  axis: Axis;
  guideAxis: Axis;
  origin: number;
  unitsPerPixel: number;
};

export const STAGE_RULER_WIDTH = 22;
export const STAGE_RULER_HEIGHT = 20;

export function stageRulers(matrix: Matrix): { top: StageRuler; left: StageRuler } {
  const [a, b, c, d] = matrix;
  // Keep the horizontal ruler on X when the two axes are equally aligned.
  const topAxis: Axis = a && d && (!b || !c || Math.abs(a) >= Math.abs(b) - Math.hypot(a, b) * 1e-12) ? 'x' : 'y';
  const leftAxis = topAxis === 'x' ? 'y' : 'x';
  const top = inversePoint(matrix, { x: 0, y: STAGE_RULER_HEIGHT });
  const left = inversePoint(matrix, { x: STAGE_RULER_WIDTH, y: 0 });
  const det = a * matrix[3] - b * matrix[2];
  return {
    top: {
      axis: topAxis,
      guideAxis: leftAxis,
      origin: top[topAxis],
      unitsPerPixel: (topAxis === 'x' ? matrix[3] : -b) / det,
    },
    left: {
      axis: leftAxis,
      guideAxis: topAxis,
      origin: left[leftAxis],
      unitsPerPixel: (leftAxis === 'x' ? -matrix[2] : a) / det,
    },
  };
}

export function stageRulerEdge(point: Point, view: Size): 'top' | 'left' | undefined {
  if (point.x < 0 || point.y < 0 || point.x >= view.width || point.y >= view.height) return;
  if (point.y < STAGE_RULER_HEIGHT) return 'top';
  if (point.x < STAGE_RULER_WIDTH) return 'left';
}

export function* stageRulerTicks(ruler: StageRuler, start: number, end: number, extent: number) {
  const a = ruler.origin + start * ruler.unitsPerPixel;
  const b = ruler.origin + end * ruler.unitsPerPixel;
  const low = Math.max(0, Math.min(a, b));
  const high = Math.min(extent, Math.max(a, b));
  const step = 100 * Math.max(1, Math.ceil(36 * Math.abs(ruler.unitsPerPixel) / 100));
  for (let value = Math.ceil(low / step) * step; value <= high; value += step) {
    yield { value, pixel: (value - ruler.origin) / ruler.unitsPerPixel };
  }
}

function stageAxes(degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cardinal = degrees % 90 === 0;
  return {
    cos: cardinal ? Math.round(Math.cos(radians)) || 0 : Math.cos(radians),
    sin: cardinal ? Math.round(Math.sin(radians)) || 0 : Math.sin(radians),
  };
}

export function stageViewFootprint(stage: Size, degrees: number, aspect = 1, shear = 0) {
  const [a, b, c, d] = stageViewBasis(1, degrees, aspect, shear);
  return {
    width: Math.abs(a) * stage.width + Math.abs(c) * stage.height,
    height: Math.abs(b) * stage.width + Math.abs(d) * stage.height,
  };
}

const zoomPresets = [0.25, 0.5, 1, 1.5, 2, 4, 8, 10, 16, 20];

export function clampCanvasZoom(zoom: number, min: number, max: number) {
  return Math.max(min, Math.min(max, zoom));
}

export function canvasZoomChoices(zoom: number, min: number, max: number) {
  const stops = zoomPresets.filter(value => value > min && value < max);
  return [...new Set([min, ...stops, max, zoom])].sort((a, b) => a - b);
}

export function canvasZoomPercent(zoom: number) {
  return Math.round(zoom * 1000) / 10;
}

function stageViewBasis(zoom: number, degrees: number, aspect: number, shear: number) {
  const { cos, sin } = stageAxes(degrees);
  const a = cos * zoom;
  const b = sin * zoom;
  return [a, b, a * shear - b * aspect || 0, b * shear + a * aspect] as const;
}

export function stageView(view: Size, stage: Size, zoom: number, pan: Point, degrees: number, aspect = 1, shear = 0) {
  const [a, b, c, d] = stageViewBasis(zoom, degrees, aspect, shear);
  const x = (view.width - (a * stage.width + c * stage.height)) / 2 + pan.x;
  const y = (view.height - (b * stage.width + d * stage.height)) / 2 + pan.y;
  const matrix: Matrix = [a, b, c, d, x, y];
  return { matrix, origin: { x, y } };
}

/** Check the actual inherited camera before changing editor scope. All distances here are CSS pixels. */
export function registeredStageView(matrix: Matrix, view: Size, stage: Size, anchor: Point) {
  const [a, b, c, d, x, y] = matrix;
  const determinant = a * d - b * c;
  if (!matrix.every(Number.isFinite) || !Number.isFinite(determinant) || determinant === 0 ||
      !(Math.hypot(x - anchor.x, y - anchor.y) <= 1 / 64)) return false;
  // Include both axes even when a reflection cancels the far corner.
  if (![Math.abs(a) * stage.width + Math.abs(c) * stage.height + Math.abs(x),
        Math.abs(b) * stage.width + Math.abs(d) * stage.height + Math.abs(y)].every(Number.isFinite)) return false;
  const farX = mapPoint(matrix, { x: stage.width, y: 0 });
  const farY = mapPoint(matrix, { x: 0, y: stage.height });
  if ((farX.x === x && farX.y === y) || (farY.x === x && farY.y === y)) return false;
  for (const vx of [0, view.width]) for (const vy of [0, view.height]) {
    const projected = mapPoint(matrix, inversePoint(matrix, { x: vx, y: vy }));
    if (!(Math.hypot(projected.x - vx, projected.y - vy) <= 1 / 64)) return false;
  }
  return true;
}

export function stageViewBounds(matrix: Matrix, { width, height }: Size) {
  const corners = [
    inversePoint(matrix, { x: 0, y: 0 }),
    inversePoint(matrix, { x: width, y: 0 }),
    inversePoint(matrix, { x: width, y: height }),
    inversePoint(matrix, { x: 0, y: height }),
  ];
  return {
    left: Math.min(...corners.map(({ x }) => x)),
    top: Math.min(...corners.map(({ y }) => y)),
    right: Math.max(...corners.map(({ x }) => x)),
    bottom: Math.max(...corners.map(({ y }) => y)),
  };
}

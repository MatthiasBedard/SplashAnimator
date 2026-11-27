import { clone, MAX_VECTOR_POINTS, type Vector } from '../../document/src';
import { normalizeVector } from './drawing';
import { fitPencilStroke } from './pencil-fit';
import { prepareShapeDrawing, prepareWorkerShapeDrawing } from './shape-drawing';
import { optimizeNewStroke } from './stroke-optimize';
import { smoothPencilStroke } from './pencil';

export type PencilDrawing = {
  stroke: Vector;
  mode: 'ink' | 'smooth' | 'straight';
  merge: boolean;
  smoothing?: number;
  optimize?: boolean;
  symbol?: boolean;
};

type PencilPreparation = {
  shape: Vector;
  shapes: Vector[];
  retainedOverlap?: true;
};

/** Finish only incoming ink, then merge it with unchanged earlier artwork. */
export function preparePencilDrawing(shapes: Vector[], request: PencilDrawing): PencilPreparation {
  return preparePencilArtwork(shapes, request, prepareShapeDrawing);
}

export type PencilWorkerReply = {
  shape: Vector;
  shapes: Vector[];
  retainedOverlap?: never;
} | {
  shape: Vector;
  retainedOverlap: true;
  shapes?: never;
};

/** Recovery keeps all earlier roots in the editor's captured snapshot. */
export function prepareWorkerPencilDrawing(shapes: Vector[], request: PencilDrawing): PencilWorkerReply {
  const result = preparePencilArtwork(shapes, request, (artwork, drawing) =>
    prepareWorkerShapeDrawing(artwork, drawing, true));
  if (result.retainedOverlap) return { shape: result.shapes[0], retainedOverlap: true };
  return { shape: result.shape, shapes: result.shapes };
}

function preparePencilArtwork(shapes: Vector[], request: PencilDrawing,
  prepareShape: typeof prepareShapeDrawing): PencilPreparation {
  const { stroke, mode, merge, smoothing = 50, optimize = false, symbol = false } = request;
  if (
    typeof smoothing !== 'number' ||
    !Number.isFinite(smoothing) ||
    smoothing < 0 ||
    smoothing > 200 ||
    !['ink', 'smooth', 'straight'].includes(mode) ||
    typeof merge !== 'boolean' ||
    typeof optimize !== 'boolean' ||
    typeof symbol !== 'boolean' ||
    stroke.kind !== 'path' ||
    stroke.closed ||
    stroke.contours ||
    !Array.isArray(stroke.points) ||
    !stroke.points.length ||
    stroke.points.length > MAX_VECTOR_POINTS ||
    stroke.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    throw Error('Invalid incoming Pencil stroke.');
  let shape = clone(stroke);
  shape.fillEnabled = false;
  if (mode === 'smooth' && shape.points.length > 1)
    shape = symbol ? smoothPencilStroke(shape) : fitPencilStroke(shape, smoothing);
  if (mode === 'straight' && shape.points.length > 1)
    shape.points = [shape.points[0], shape.points.at(-1)!];
  if (shape.kind === 'path') normalizeVector(shape);
  if (optimize) shape = optimizeNewStroke(shape);
  if (![shape.x, shape.y, shape.width, shape.height].every(Number.isFinite))
    throw Error('Pencil finishing exceeds finite geometry.');
  if (merge) shape.drawingMode = 'merge';
  if (!merge || shape.width + shape.height <= 2) return { shape, shapes: clone(shapes) };
  return { shape, ...prepareShape(shapes, { shape, merge }) };
}

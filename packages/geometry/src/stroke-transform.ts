import type { Point, Vector } from '@splash/document';
import { inversePoint, mapPoint, transformedMatrix, transformVectors, type Matrix } from './affine';
import { normalizeVector } from './drawing';
import { isEditableInk } from './stroke-cut';

const identity: Matrix = [1, 0, 0, 1, 0, 0];

/** Transform the path and its pen separately so shared endpoints follow the full selection pose. */
export function transformStrokePath(source: Vector, operation: Matrix, strokeOperation: Matrix): Vector {
  const penAdjustment: Matrix = [strokeOperation[0], strokeOperation[1], strokeOperation[2], strokeOperation[3], 0, 0];
  const preserveBasis = penAdjustment.every((value, index) => value === identity[index]);
  const pose = transformedMatrix(source, operation);
  const penBasis = transformedMatrix({ ...source, x: 0, y: 0 }, penAdjustment);
  const posedBasis: Matrix = [pose[0], pose[1], pose[2], pose[3], 0, 0];
  const map = (point: Point): Point => {
    const mapped = inversePoint(penBasis, mapPoint(posedBasis, point));
    if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y))
      throw Error('Transform exceeds supported geometry limits.');
    return { ...point, ...mapped };
  };
  const edited: Vector = {
    ...source,
    x: pose[4], y: pose[5],
    ...(preserveBasis ? {} : { rotation: 0, transform: [penBasis[0], penBasis[1], penBasis[2], penBasis[3]] }),
    points: source.points.length || source.kind === 'bezier'
      ? source.points.map(map)
      : [{ x: 0, y: 0 }, map({ x: source.width, y: source.height })],
  };
  if (source.nodes) edited.nodes = source.nodes.map(node => ({
    ...map(node),
    ...(node.in ? { in: map(node.in) } : {}),
    ...(node.out ? { out: map(node.out) } : {}),
  }));
  if (source.pivot) edited.pivot = map(source.pivot);
  if (source.bitmap) edited.bitmap = { ...source.bitmap };
  if (source.gradient) edited.gradient = {
    ...source.gradient, from: { ...source.gradient.from }, to: { ...source.gradient.to },
  };
  normalizeVector(edited);
  transformedMatrix(edited, identity);
  if (!Number.isFinite(edited.width) || !Number.isFinite(edited.height))
    throw Error('Transform exceeds supported geometry limits.');
  return edited;
}

export function transformSelectionVectors(shapes: Vector[], operation: Matrix, strokeOperation?: Matrix) {
  if (!strokeOperation) {
    transformVectors(shapes, operation);
    return;
  }
  const affine: Vector[] = [];
  const edits: [Vector, Vector][] = [];
  for (const source of shapes) {
    if (isEditableInk(source)) edits.push([source, transformStrokePath(source, operation, strokeOperation)]);
    else affine.push(source);
  }
  transformVectors(affine, operation);
  for (const [source, edited] of edits) Object.assign(source, edited);
}

import { clone, MAX_VECTOR_POINTS, type Point, type Vector } from '../../../packages/document/src';
import { matrix, mapPoint } from '../../../packages/geometry/src/affine';
import { hitCurve } from '../../../packages/geometry/src/curve-hit';
import { convertAnchors, deleteAnchors, insertAnchor } from '../../../packages/geometry/src/nodes';
import { penEndpoint } from '../../../packages/geometry/src/pen-preview';

export type PenAnchorAction =
  | { kind: 'add'; index: number; t: number }
  | { kind: 'corner' | 'remove' | 'blocked'; index: number };

export function penAnchorAction(shape: Vector, point: Point, scale: number): PenAnchorAction | undefined {
  const nodes = shape.nodes;
  if (!Number.isFinite(scale) || scale <= 0 || shape.kind !== 'bezier' ||
      shape.contours || shape.drawingMode === 'merge' ||
      !nodes || nodes.length < 2 || penEndpoint(shape, point, scale)) return;
  const world = matrix(shape);
  let nearest = 7 / scale, index = -1;
  for (let i = 0; i < nodes.length; i++) {
    const p = mapPoint(world, nodes[i]);
    const distance = Math.hypot(p.x - point.x, p.y - point.y);
    if (distance < nearest) { nearest = distance; index = i; }
  }
  if (index >= 0) {
    const node = nodes[index];
    if ([node.in, node.out].some(handle => handle && (handle.x !== node.x || handle.y !== node.y)))
      return { kind: 'corner', index };
    return { kind: nodes.length > (shape.closed ? 3 : 2) ? 'remove' : 'blocked', index };
  }
  const segment = hitCurve(shape, point, 7 / scale);
  if (segment) return nodes.length < MAX_VECTOR_POINTS
    ? { kind: 'add', ...segment }
    : { kind: 'blocked', index: segment.index };
}

export function preparePenAnchorEdit(shape: Vector, action: PenAnchorAction) {
  const edited = clone(shape);
  switch (action.kind) {
    case 'add': return insertAnchor(edited, action.index, action.t) === undefined ? undefined : edited;
    case 'remove': return deleteAnchors(edited, [action.index]) ? edited : undefined;
    case 'corner': convertAnchors(edited, [action.index], 'corner'); return edited;
  }
}

const cursors = Object.fromEntries(Object.entries({
  add: 'M16 19h8m-4-4v8',
  remove: 'M16 19h8',
  corner: 'M16 21l4-5 4 5',
}).map(([kind, sign]) => {
  const path = 'M1 8h14M8 1v14' + sign;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="25"><path d="${path}" fill="none" stroke="white" stroke-width="3"/><path d="${path}" fill="none" stroke="black" stroke-width="1.5"/></svg>`;
  return [kind, `url("data:image/svg+xml,${encodeURIComponent(svg)}") 8 8, crosshair`];
}));

export function penAnchorCursor(action: PenAnchorAction | undefined) {
  return action && action.kind !== 'blocked' ? cursors[action.kind] : undefined;
}

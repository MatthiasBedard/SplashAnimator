import { matrix, mapPoint } from '../../../packages/geometry/src/affine';
import { clone, type BezierNode, type Vector } from '../../../packages/document/src';
import {
  shiftMotionContourStart,
  type MotionContourStart,
  type MotionContourReverse,
} from '../../../packages/animation/src/motion-nodes';
import {
  matchStraightMotionNodes,
  parseMotionNodeHints,
} from '../../../packages/animation/src/motion-resample';

import { matchShapeTweenArtwork } from '../../../packages/animation/src/motion-shape-morph';

function validateHints(source: Vector, target: Vector, hints: Parameters<typeof matchStraightMotionNodes>[2],
  curves: boolean, distance: boolean, shapeMatching: boolean) {
  if (shapeMatching) matchShapeTweenArtwork(source, target, hints, distance);
  else matchStraightMotionNodes(source, target, hints, curves, distance);
}

export function prepareMotionNodePreview(
  source: Vector | undefined,
  target: Vector | undefined,
  text: string,
  straight: boolean,
  curves: boolean,
  distance: boolean,
  offset: MotionContourStart = 0,
  reverse: MotionContourReverse = false,
  order?: readonly number[],
  shapeMatching = false,
) {
  if (!source || !target) throw new Error('Choose nonblank endpoint keys to preview node hints.');
  const end = shiftMotionContourStart(target, offset, reverse, order);
  const options = parseMotionNodeHints(text, straight, curves, distance);
  if (!options) throw new Error('Enable straight or curved node matching to preview hints.');
  const hints = typeof options === 'object' ? options.hints : undefined;
  // Validate originals and the same bounded correspondence used by generation.
  validateHints(source, end, hints, curves, distance, shapeMatching);
  const rings = (s: Vector): BezierNode[][] => (s.kind === 'polygon' ? s.contours! : [s.nodes!]);
  return {
    source: clone(source),
    target: clone(end),
    curves,
    distance,
    shapeMatching,
    closed: source.kind === 'polygon' || !!source.closed,
    rings: [rings(source), rings(end)].map((r) => clone(r)),
    hints: rings(source).map((_, i) => hints?.[i]?.map(([a, b]): [number, number] => [a, b]) ?? []),
  };
}
export type MotionNodePreview = ReturnType<typeof prepareMotionNodePreview>;

export function editMotionNodeHint(
  model: MotionNodePreview,
  contour: number,
  pair: [number, number],
  remove = false,
  original?: [number, number],
): string {
  if (!Number.isSafeInteger(contour) || !model.hints[contour]) throw new Error('Choose a contour.');
  const hints = model.hints.map((list) => list.map(([a, b]): [number, number] => [a, b]));
  if (original) {
    const index = hints[contour].findIndex(([a,b]) => a === original[0] && b === original[1]);
    if (index < 0) throw new Error('The selected node pair has changed.');
    hints[contour].splice(index, 1);
  }
  if (remove) hints[contour] = hints[contour].filter(([a, b]) => a !== pair[0] || b !== pair[1]);
  else hints[contour].push([...pair]);
  hints[contour].sort((a, b) => a[0] - b[0]);
  validateHints(model.source, model.target, hints, model.curves, model.distance, model.shapeMatching);
  return hints.every((list) => !list.length)
    ? ''
    : hints.map((list) => list.map((p) => p.join(':')).join(', ')).join('; ');
}

/** Fit local geometry into a fixed preview, including control hulls. No artwork edits. */
export function motionNodeDrawing(nodes: BezierNode[], closed: boolean, stageShape?: Vector) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const n of nodes)
    for (const p of [n, n.in, n.out])
      if (p) {
        left = Math.min(left, p.x);
        top = Math.min(top, p.y);
        right = Math.max(right, p.x);
        bottom = Math.max(bottom, p.y);
      }
  const span = Math.max(right - left, bottom - top, 1);
  if (![left, top, span].every(Number.isFinite)) throw new Error('Preview bounds are unresolved.');
  const basis = stageShape ? matrix(stageShape) : undefined;
  if (basis?.some((v) => !Number.isFinite(v)))
    throw new Error('Stage hint transform is unresolved.');
  const point = (p: { x: number; y: number }) => {
    const result = basis
      ? mapPoint(basis, p)
      : {
          x: 20 + ((p.x - left) / span) * 160,
          y: 20 + ((p.y - top) / span) * 160,
        };
    if (![result.x, result.y].every(Number.isFinite))
      throw new Error('Stage hint coordinates are unresolved.');
    return result;
  };
  const anchors = nodes.map(point);
  let path = `M ${anchors[0].x} ${anchors[0].y}`;
  for (let i = 0; i < nodes.length - (closed ? 0 : 1); i++) {
    const a = nodes[i],
      b = nodes[(i + 1) % nodes.length],
      end = point(b);
    if (a.out || b.in) {
      const c = point(a.out ?? a),
        d = point(b.in ?? b);
      path += ` C ${c.x} ${c.y} ${d.x} ${d.y} ${end.x} ${end.y}`;
    } else path += ` L ${end.x} ${end.y}`;
  }
  return { anchors, path: path + (closed ? ' Z' : '') };
}

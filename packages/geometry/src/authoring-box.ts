import type { BezierNode, Point, Vector } from '@splash/document';
import type { Bounds } from './bounds-index';

/** Legacy objects use their stored rectangle. Explicit shared-basis paths
 * keep their controls and handles in that basis while the box follows them. */
export function localAuthoringBounds(shape: Vector): Bounds {
  if (shape.controlBounds === true) {
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    const include = ({ x, y }: Point) => {
      bounds.left = Math.min(bounds.left, x);
      bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x);
      bounds.bottom = Math.max(bounds.bottom, y);
    };
    const includeNode = (node: BezierNode) => {
      include(node);
      if (node.in) include(node.in);
      if (node.out) include(node.out);
    };
    if (shape.contours) {
      for (const ring of shape.contours) for (const node of ring) includeNode(node);
    } else if (shape.kind === 'bezier') {
      for (const node of shape.nodes ?? []) includeNode(node);
    } else {
      for (const point of shape.points) include(point);
    }
    if (bounds.left !== Infinity) return bounds;
  }
  return { left: 0, top: 0, right: shape.width, bottom: shape.height };
}

import type { Vector, Project } from '../../../packages/document/src';
import type { LayerMask } from '../../../packages/document/src/layer-masks';
import { matrix } from '../../../packages/geometry/src/affine';
import { renderData, canvasPath } from '../../../packages/stage/src/render-data';
import { createOnionPainter } from '../../../packages/stage/src';

export const DEFAULT_LAYER_OUTLINE = '#00a6b8';

/** Outline suspends clipping on the editor stage. Visibility still controls painting the boundary. */
export function authoringLayerMasks(
  layers: readonly { id: string; outline?: boolean }[],
  masks: readonly LayerMask[] = [],
) {
  if (!masks.length) return masks;
  const outlined = new Set(layers.filter(layer => layer.outline).map(layer => layer.id));
  return masks.filter(mask => !outlined.has(mask.maskLayerId));
}

/** Authoring display only: keep original geometry, paint and export rendering intact. */
export function drawLayerOutline(
  ctx: CanvasRenderingContext2D,
  shape: Vector,
  color: string,
  width: number,
  assets: Project['assets'],
  ready?: () => void,
) {
  if (shape.kind === 'text' || shape.kind === 'brush') {
    // Outline the rendered union of nib dabs/glyphs, never their internal construction edges.
    createOnionPainter(ctx, assets, ready)([shape], 1, color, true);
    return;
  }
  const data = renderData(shape);
  const local = canvasPath({ ...data, gradient: undefined });
  if (!local) return;
  const world = new Path2D();
  world.addPath(local, new DOMMatrix(matrix(shape)));
  ctx.save();
  try {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(world);
  } finally {
    ctx.restore();
  }
}

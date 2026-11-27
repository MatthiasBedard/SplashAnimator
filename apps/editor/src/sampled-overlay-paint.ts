import type { Point, Vector } from '../../../packages/document/src';
import type { SelectionSkewLayout } from './sampled-selection-skew-drag';
import type { SelectionScaleLayout } from './sampled-selection-scale-drag';
import { objectBounds } from '../../../packages/geometry/src';
import type { SampledSelectionOwner } from '../../../packages/animation/src/selection-motion-owner';
import type { SampledSelectionPose } from './sampled-selection-editor';
import type { SelectionRotationLayout } from './sampled-selection-rotation-drag';

export function paintSampledSelectionRotationHandle(
  ctx: CanvasRenderingContext2D,
  layout: SelectionRotationLayout | null,
  width: number,
  height: number,
  dpr: number,
) {
  if (!layout) return;
  ctx.save();
  ctx.setTransform(
    (dpr * width) / layout.rect.width,
    0,
    0,
    (dpr * height) / layout.rect.height,
    0,
    0,
  );
  ctx.strokeStyle = '#007eaa';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(layout.center.x, layout.center.y);
  ctx.lineTo(layout.original.x, layout.original.y);
  ctx.stroke();
  for (const [p, r] of [
    [layout.center, 4],
    [layout.original, 6],
  ] as const) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  if (
    Math.hypot(layout.proposed.x - layout.original.x, layout.proposed.y - layout.original.y) > 1
  ) {
    ctx.fillStyle = '#ffbf66';
    ctx.beginPath();
    ctx.arc(layout.proposed.x, layout.proposed.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Exact existing CSS-space original/proposed point overlays, outside the large
 * component parser. The optional stem belongs only to cubic control layouts. */
export function paintSampledPointHint(
  ctx: CanvasRenderingContext2D,
  layout: {
    rect: { width: number; height: number };
    original: Point;
    proposed: Point;
    anchor?: Point;
  } | null,
  width: number,
  height: number,
  dpr: number,
  stem = false,
) {
  if (!layout) return;
  ctx.save();
  ctx.setTransform(
    (dpr * width) / layout.rect.width,
    0,
    0,
    (dpr * height) / layout.rect.height,
    0,
    0,
  );
  ctx.strokeStyle = '#007eaa';
  ctx.lineWidth = 1.5;
  if (stem && layout.anchor) {
    ctx.beginPath();
    ctx.moveTo(layout.anchor.x, layout.anchor.y);
    ctx.lineTo(layout.original.x, layout.original.y);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(layout.original.x, layout.original.y, 5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffbf66';
  ctx.beginPath();
  ctx.arc(layout.proposed.x, layout.proposed.y, 3, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

export function paintSampledSelectionOutlines(
  ctx: CanvasRenderingContext2D,
  scene: SampledSelectionPose['scene'] | undefined,
  owner: SampledSelectionOwner | null,
  zoom: number,
) {
  for (const track of owner?.tracks ?? [])
    for (const shape of scene
      ?.find((t) => t.layerId === track.layerId)
      ?.key.shapes.filter((s) => track.shapeIds.includes(s.id)) ?? []) {
      const b = objectBounds(shape);
      ctx.strokeStyle = '#007eaa';
      ctx.lineWidth = 1.5 / zoom;
      ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    }
}

/** Handoff cues paint above opaque artwork and use the actual authored selection. */
export function paintSampledSelectionScaleHandles(
  ctx: CanvasRenderingContext2D,
  layout: SelectionScaleLayout | null,
  width: number,
  height: number,
  dpr: number,
) {
  if (!layout) return;
  ctx.save();
  ctx.setTransform(
    (dpr * width) / layout.rect.width,
    0,
    0,
    (dpr * height) / layout.rect.height,
    0,
    0,
  );
  ctx.strokeStyle = '#007eaa';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  for (const handle of layout.original) {
    ctx.fillRect(handle.point.x - 4, handle.point.y - 4, 8, 8);
    ctx.strokeRect(handle.point.x - 4, handle.point.y - 4, 8, 8);
  }
  ctx.fillStyle = '#ffbf66';
  for (const handle of layout.proposed) {
    const original = layout.original.find((h) => h.id === handle.id);
    if (original && original.point.x === handle.point.x && original.point.y === handle.point.y)
      continue;
    ctx.fillRect(handle.point.x - 2, handle.point.y - 2, 4, 4);
  }
  ctx.restore();
}

/** Handoff cues paint above opaque artwork and use the actual authored selection. */
export function paintAuthoredSelectionOutlines(
  ctx: CanvasRenderingContext2D,
  shapes: Vector[],
  zoom: number,
) {
  ctx.save();
  ctx.strokeStyle = '#007eaa';
  ctx.lineWidth = 1.5 / zoom;
  for (const shape of shapes) {
    const b = objectBounds(shape);
    ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
  }
  ctx.restore();
}

/** Original diamonds and proposed cues share the same independent CSS projection as hits. */
export function paintSampledSelectionSkewHandles(
  ctx: CanvasRenderingContext2D,
  layout: SelectionSkewLayout | null,
  width: number,
  height: number,
  dpr: number,
) {
  if (!layout) return;
  ctx.save();
  ctx.setTransform(
    (dpr * width) / layout.rect.width,
    0,
    0,
    (dpr * height) / layout.rect.height,
    0,
    0,
  );
  ctx.strokeStyle = '#007eaa';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  layout.outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  for (const h of layout.original) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(h.point.x, h.point.y - 5);
    ctx.lineTo(h.point.x + 5, h.point.y);
    ctx.lineTo(h.point.x, h.point.y + 5);
    ctx.lineTo(h.point.x - 5, h.point.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = '#ffbf66';
  for (const h of layout.proposed) {
    const original = layout.original.find((o) => o.id === h.id);
    if (original && original.point.x === h.point.x && original.point.y === h.point.y) continue;
    ctx.beginPath();
    ctx.arc(h.point.x, h.point.y, 2.5, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

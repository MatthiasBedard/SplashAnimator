import { selectionRasterBounds } from './selection-raster';
import { paintBoxBlur } from './box-blur';
import { compositeLayerMasks } from './layer-mask-compositor';
import { groupDrawingPaint, type SymbolPaintItem } from '../../geometry/src/symbols';
import type { Vector } from '../../document/src';
import type { Bounds } from '../../geometry/src/layout';

/** Group-local effects can be captured over transparency. Blending with the
 * backdrop and unbounded glyphs still need the original vector paint pass. */
export function selectionSymbolRasterBounds(items: SymbolPaintItem[], padding: number): Bounds | null {
  let bounds: Bounds | null = null;
  for (const item of items) {
    if (item.blendMode) return null;
    let box: Bounds | null;
    if (item.kind === 'masked-symbol') {
      const children = item.layers.filter(layer => layer.visible).flatMap(layer => layer.items);
      if (!children.length) continue;
      box = selectionSymbolRasterBounds(children, padding);
      if (box && item.blurRadius) {
        const halo = item.blurRadius + padding;
        box = { left: box.left - halo, top: box.top - halo,
          right: box.right + halo, bottom: box.bottom + halo };
      }
    } else {
      if (item.groupBlur?.blendMode) return null;
      box = selectionRasterBounds([item], padding + (item.groupBlur?.radius ?? 0));
    }
    if (!box) return null;
    bounds = bounds ? {
      left: Math.min(bounds.left, box.left), top: Math.min(bounds.top, box.top),
      right: Math.max(bounds.right, box.right), bottom: Math.max(bounds.bottom, box.bottom),
    } : box;
  }
  return bounds;
}

// Text overhang and nested/effected children use the viewport plus the input halo.
export function symbolBlurBounds(item: Extract<SymbolPaintItem, { kind: 'masked-symbol' }>) {
  const leaves: Vector[] = [];
  for (const layer of item.layers)
    for (const child of layer.items) {
      // A preserved runtime placement can paint outside its definition box.
      if (child.kind === 'masked-symbol' || child.kind === 'symbol') return null;
      leaves.push(child);
    }
  return selectionRasterBounds(leaves, 0);
}

export function paintSymbolItems(
  ctx: CanvasRenderingContext2D,
  items: SymbolPaintItem[],
  paint: (target: CanvasRenderingContext2D, shape: Vector) => void,
  reservedPixels: number,
  groupDrawings = true,
) {
  for (const item of groupDrawings ? groupDrawingPaint(items) : items) {
    if (item.kind !== 'masked-symbol') {
      paint(ctx, item);
      continue;
    }
    const paintLayers = (surface: CanvasRenderingContext2D, opacity: number) => {
      const reserve = Math.max(
        reservedPixels,
        (surface as CanvasRenderingContext2D & { maskReservedPixels?: number })
          .maskReservedPixels ?? 0,
      );
      const childReserve =
        reserve + (item.masks.length ? 3 * surface.canvas.width * surface.canvas.height : 0);
      compositeLayerMasks(
        surface,
        item.layers,
        item.masks,
        (target, id) => {
          const layer = item.layers.find((l) => l.id === id)!;
          paintSymbolItems(target, layer.items, paint, childReserve, !item.drawingGroup);
        },
        reserve,
        1,
        opacity,
      );
    };
    if (item.blurRadius || item.blendMode || item.tint)
      paintBoxBlur(
        ctx,
        { blurRadius: item.blurRadius ?? 0, blendMode:item.blendMode, tint:item.tint, opacity: item.opacity, worldBounds: symbolBlurBounds(item) },
        (tile) => paintLayers(tile, 1),
        reservedPixels,
      );
    else paintLayers(ctx, item.opacity);
  }
}

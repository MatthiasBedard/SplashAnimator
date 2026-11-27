import type { Vector } from '../../document/src';
import { matrix, mapPoint, type Matrix } from '../../geometry/src/affine';
import type { Bounds } from '../../geometry/src/layout';
import { renderData } from './render-data';
import { MASK_WORKING_PIXELS } from './mask-budget';

export type SelectionRasterPart = {
  moving: boolean;
  bounds: Bounds | null;
  paint: (ctx: CanvasRenderingContext2D) => void;
  paintPose?: (ctx: CanvasRenderingContext2D, operation: Matrix) => void;
  composite?: boolean;
};
type SelectionRun = { moving: boolean; junction: boolean; posed: boolean; roots: Vector[] };

/** Merge moves paint selected artwork last. Build runs in final paint order
 * so interleaved selections can share rasters. Junctions replay live edits. */
export function selectionRasterRuns(
  roots: readonly Vector[],
  chosen: ReadonlySet<string>,
  junctions: ReadonlySet<string> | undefined,
  selectedOnTop: boolean,
  pose?: (shape: Vector) => boolean,
): SelectionRun[] {
  const runs: SelectionRun[] = [];
  const foreground: SelectionRun[] = [];
  for (const root of roots) {
    const moving = chosen.has(root.id);
    const junction = junctions?.has(root.id) ?? false;
    const posed = moving && (pose?.(root) ?? false);
    const target = selectedOnTop && moving ? foreground : runs;
    const last = target.at(-1);
    if (last?.moving === moving && last.junction === junction && last.posed === posed) last.roots.push(root);
    else target.push({ moving, junction, posed, roots: [root] });
  }
  return foreground.length ? runs.concat(foreground) : runs;
}
/** Conservative control hull, including round/square caps and the renderer's
 * miter limit of four. Text stays on the exact vector fallback: authoring boxes
 * do not bound glyph overhang. No viewport clipping of moving artwork. */
export function selectionRasterBounds(
  shapes: readonly Vector[],
  pixelPadding: number,
): Bounds | null {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const shape of shapes) {
    if (shape.blendMode || shape.blurRadius || shape.kind === 'text' || shape.kind === 'symbol') return null;
    const m = matrix(shape);
    const padX = 2 * (shape.strokeWidth || 0) * Math.hypot(m[0], m[2]) + pixelPadding;
    const padY = 2 * (shape.strokeWidth || 0) * Math.hypot(m[1], m[3]) + pixelPadding;
    for (const c of renderData(shape).commands) {
      if (c[0] === 'Z') continue;
      for (let i = 1; i < c.length; i += 2) {
        const p = mapPoint(m, { x: c[i] as number, y: c[i + 1] as number });
        left = Math.min(left, p.x - padX);
        right = Math.max(right, p.x + padX);
        top = Math.min(top, p.y - padY);
        bottom = Math.max(bottom, p.y + padY);
      }
    }
  }
  return [left, top, right, bottom].every(Number.isFinite) ? { left, top, right, bottom } : null;
}

/** Gesture-owned, disposable rasters. Oversize/unsupported parts replay their
 * exact vectors instead of clipping artwork or lowering its resolution. */
export class SelectionRasterCache {
  private canvases: HTMLCanvasElement[] = [];
  private parts = new Map<string, SelectionRasterPart[]>();
  private outline?: SelectionRasterPart;
  clear() {
    for (const canvas of this.canvases) canvas.width = canvas.height = 0;
    this.canvases = [];
    this.parts.clear();
    this.outline = undefined;
  }
  prepare(
    layers: Map<string, SelectionRasterPart[]>,
    view: { scale: number; x: number; y: number; reservedPixels: number },
    outline?: SelectionRasterPart,
  ) {
    this.clear();
    let pixels = view.reservedPixels;
    const raster = (part: SelectionRasterPart): SelectionRasterPart => {
      const b = part.bounds,
        s = view.scale;
      if (part.paintPose || !b || ![s, view.x, view.y, pixels].every(Number.isFinite) || s <= 0 || pixels < 0)
        return part;
      const x = Math.floor(b.left * s + view.x),
        y = Math.floor(b.top * s + view.y);
      const width = Math.ceil(b.right * s + view.x) - x,
        height = Math.ceil(b.bottom * s + view.y) - y;
      const count = width * height;
      if (
        !Number.isSafeInteger(count) ||
        width < 1 ||
        height < 1 ||
        width > 16384 ||
        height > 16384 ||
        pixels + count > MASK_WORKING_PIXELS
      )
        return part;
      const canvas = document.createElement('canvas');
      this.canvases.push(canvas);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        canvas.width = canvas.height = 0;
        return part;
      }
      ctx.setTransform(s, 0, 0, s, view.x - x, view.y - y);
      if (part.composite) Object.assign(ctx, { maskReservedPixels: pixels });
      try {
        part.paint(ctx);
      } catch (cause) {
        // An offscreen group can require more temporary pixels than its
        // visible portion. Let the ordinary renderer clip and budget it.
        if (!part.composite || !(cause instanceof Error) ||
          !['Mask working rasters exceed the shared 64-megapixel budget.',
            'Blur working rasters exceed the stage pixel budget.'].includes(cause.message))
          throw cause;
        canvas.width = canvas.height = 0;
        this.canvases.pop();
        return part;
      }
      pixels += count;
      return {
        ...part,
        paint: (target) =>
          target.drawImage(canvas, (x - view.x) / s, (y - view.y) / s, width / s, height / s),
      };
    };
    try {
      for (const [id, parts] of layers) this.parts.set(id, parts.map(raster));
      if (outline) this.outline = raster(outline);
    } catch (cause) {
      this.clear();
      throw cause;
    }
  }
  private draw(ctx: CanvasRenderingContext2D, part: SelectionRasterPart, operation: Matrix) {
    ctx.save();
    try {
      if (part.paintPose) part.paintPose(ctx, operation);
      else {
        if (part.moving) ctx.transform(...operation);
        part.paint(ctx);
      }
    } finally {
      ctx.restore();
    }
  }
  paintLayer(ctx: CanvasRenderingContext2D, id: string, operation: Matrix) {
    for (const part of this.parts.get(id) ?? []) this.draw(ctx, part, operation);
  }
  paintOutline(ctx: CanvasRenderingContext2D, operation: Matrix) {
    if (this.outline) this.draw(ctx, this.outline, operation);
  }
}

// Symbol paint items retain per-instance compositing during expansion.
import { compositeLayerMasks } from './layer-mask-compositor';
import { paintSymbolItems } from './symbol-mask-painter';
import { hasInstanceBlur, type SymbolPaintItem } from '../../geometry/src/symbols';
import { outlineAlpha } from './onion-outline';
import { paintStyledText } from './rich-text';
import { bitmapImage } from './bitmap-cache';
import type { Vector, Project } from '@splash/document';
import { evaluate, evaluateLayers } from '@splash/animation';
import { renderData, paintCommands, canvasPath } from './render-data';
import { wrapText } from '../../geometry/src/text-layout';
export interface StageRenderer {
  render(project: Project, frame: number, movieFrames?: Record<string, number>, tracks?: ReadonlyMap<string, { items: SymbolPaintItem[] }>): void;
  destroy(): void;
}
export function drawShape(
  ctx: CanvasRenderingContext2D,
  s: Vector,
  assets: Project['assets'] = [],
  onReady?: () => void,
  images?: ReadonlyMap<string, HTMLImageElement>,
): void {
  const data = renderData(s);
  paintCommands(
    ctx,
    data,
    wrapText,
    s.bitmap ? (images ? images.get(s.bitmap.assetId) : bitmapImage(assets, s.bitmap.assetId, onReady)) : undefined,
    paintStyledText,
    canvasPath(data), undefined, undefined,
    s.blurRadius || s.blendMode || s.tint?.amount ? assets.reduce((n,a)=>n+(a.bitmap ? a.bitmap.width*a.bitmap.height : 0),0) : 0,
  );
}
export class CanvasStage implements StageRenderer {
  constructor(private canvas: HTMLCanvasElement, private capture?: {
    transparent: boolean;
    images: ReadonlyMap<string, HTMLImageElement>;
  }) {}
  render(project: Project, frame: number, movieFrames?: Record<string, number>, tracks?: ReadonlyMap<string, { items: SymbolPaintItem[] }>) {
    const ctx = this.canvas.getContext('2d')!;
    ctx.save();
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    if (!this.capture?.transparent) {
      ctx.fillStyle = project.background;
      ctx.fillRect(0, 0, project.width, project.height);
    }
    const paint = (target: CanvasRenderingContext2D, shape: Vector) =>
      drawShape(target, shape, project.assets, undefined, this.capture?.images);
    if (project.symbols?.length || hasInstanceBlur(project)) {
      paintMaskedSymbols(ctx, project, frame, movieFrames, tracks, paint);
    } else if (project.layerMasks?.length) {
      const posed = evaluateLayers(project, frame, movieFrames);
      compositeLayerMasks(
        ctx,
        project.layers,
        project.layerMasks,
        (target, id) =>
          posed
            .find((l) => l.layerId === id)
            ?.shapes.forEach((s) => paint(target, s)),
        project.assets.reduce((n, a) => n + (a.bitmap ? a.bitmap.width * a.bitmap.height : 0), 0),
      );
    } else evaluate(project, frame, movieFrames).forEach((s) => paint(ctx, s));
  }
  destroy() {
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

function paintMaskedSymbols(ctx: CanvasRenderingContext2D, project: Project, frame: number, movieFrames?: Record<string, number>, tracks?: ReadonlyMap<string, { items: SymbolPaintItem[] }>, paint = (target: CanvasRenderingContext2D, shape: Vector) => drawShape(target, shape, project.assets)) {
  const decoded = project.assets.reduce((n, a) => n + (a.bitmap ? a.bitmap.width * a.bitmap.height : 0), 0);
  const masks = project.layerMasks ?? [];
  const reserved = decoded + (masks.length ? 3 * ctx.canvas.width * ctx.canvas.height : 0);
  const original = new Map(project.layers.map(layer => [layer.id, layer]));
  compositeLayerMasks(ctx, project.layers, masks, (target, id) => {
    const prepared = tracks?.get(id);
    const items: SymbolPaintItem[] = prepared?.items ?? [];
    if (!prepared) evaluate({ ...project, layers: [original.get(id)!] }, frame, movieFrames, items);
    paintSymbolItems(target, items, paint, reserved);
  }, decoded);
}

/** Sample final artwork only, excluding selection, guides and onion overlays. */
export function samplePaint(project: Project, frame: number, x: number, y: number): string | null {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= project.width ||
    y >= project.height
  )
    return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = project.background;
  ctx.fillRect(0, 0, 1, 1);
  ctx.translate(-Math.floor(x), -Math.floor(y));
  if (project.symbols?.length || hasInstanceBlur(project)) {
    paintMaskedSymbols(ctx, project, frame);
  } else if (project.layerMasks?.length) {
    const layers = evaluateLayers(project, frame);
    compositeLayerMasks(ctx, project.layers, project.layerMasks, (target, id) =>
      layers
        .find((l) => l.layerId === id)
        ?.shapes.forEach((s) => drawShape(target, s, project.assets)),
    );
  } else evaluate(project, frame).forEach((s) => drawShape(ctx, s, project.assets));
  return (
    '#' +
    Array.from(ctx.getImageData(0, 0, 1, 1).data)
      .slice(0, 3)
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Session-only onion rendering. Outlines follow rendered alpha, including glyph/bitmap holes. */
export function createOnionPainter(
  ctx: CanvasRenderingContext2D,
  assets: Project['assets'],
  onReady?: () => void,
) {
  let scratch: HTMLCanvasElement | undefined;
  return (shapes: Vector[], opacity: number, tint?: string, outline = false) => {
    if (!shapes.length || !opacity || !ctx.canvas.width || !ctx.canvas.height) return;
    scratch ??= document.createElement('canvas');
    if (scratch.width !== ctx.canvas.width) scratch.width = ctx.canvas.width;
    if (scratch.height !== ctx.canvas.height) scratch.height = ctx.canvas.height;
    const target = scratch.getContext('2d', { willReadFrequently: outline })!;
    target.clearRect(0, 0, scratch.width, scratch.height);
    target.setTransform(ctx.getTransform());
    shapes.forEach((s) => drawShape(target, s, assets, onReady));
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    if (outline) {
      const pixels = target.getImageData(0, 0, scratch.width, scratch.height);
      outlineAlpha(pixels.data, scratch.width, scratch.height);
      target.putImageData(pixels, 0, 0);
    }
    if (tint) {
      target.globalCompositeOperation = 'source-in';
      target.fillStyle = tint;
      target.fillRect(0, 0, scratch.width, scratch.height);
      target.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= opacity;
    ctx.drawImage(scratch, 0, 0);
    ctx.restore();
  };
}

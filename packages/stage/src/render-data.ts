import { paintBoxBlur } from './box-blur';
import type { Vector } from '@splash/document';
import { fontFamilyForRendering } from '../../geometry/src/font-family';
import type { wrapText } from '../../geometry/src/text-layout';
import { brushOpacityParts, pathCommands, type BrushOpacityPart, type Command } from '../../geometry/src/drawing';
export type RenderVector = Omit<Vector, 'points' | 'nodes' | 'brush'> & {
  commands: Command[];
  pressurePaint?: BrushOpacityPart[];
};
// Weak ownership allows removed artwork/history snapshots to be collected. The
// geometry signature detects in-place edits, including Svelte proxy mutations.
const geometryCache = new WeakMap<Vector, { signature: string; commands: Command[]; pressurePaint?: BrushOpacityPart[] }>();
const canvasPaths = new WeakMap<Command[], Path2D>();
function brightenedPaint(s: Vector, amount: number): Partial<Vector> {
  const weight = Math.abs(amount), target = amount > 0 ? 255 : 0;
  function adjust(hex: string) {
    let result = '#';
    for (const start of [1, 3, 5]) {
      const original = parseInt(hex.slice(start, start + 2), 16);
      result += Math.round(original + (target - original) * weight).toString(16).padStart(2, '0');
    }
    return result;
  }
  return {
    fill: adjust(s.fill), stroke: adjust(s.stroke),
    ...(s.gradient ? {gradient: {...s.gradient, stops: s.gradient.stops.map(stop =>
      ({...stop, color: adjust(stop.color)}))}} : {}),
    ...(s.text?.runs?.length ? {text: {...s.text, runs: s.text.runs.map(run =>
      run.style.color ? {...run, style: {...run.style, color: adjust(run.style.color)}} : run)}} : {}),
  };
}
/** Compile local path commands while retaining the vector's current paint and placement. */
export function renderData(s: Vector): RenderVector {
  const signature = JSON.stringify([
    s.kind,
    s.width,
    s.height,
    s.cornerRadius,
    s.closed,
    s.contours,
    s.points,
    s.nodes,
    s.brush,
    s.strokeWidth,
    s.rotation,
    s.transform,
  ]);
  let cached = geometryCache.get(s);
  if (!cached || cached.signature !== signature) {
    cached = { signature, commands: s.kind === 'text' ? [] : pathCommands(s), pressurePaint: brushOpacityParts(s) };
    geometryCache.set(s, cached);
  }
  // Paint and placement are always read live; never cache a whole render vector.
  return { ...s, ...(s.paintBrightness ? brightenedPaint(s,s.paintBrightness) : {}), commands: cached.commands, ...(cached.pressurePaint ? { pressurePaint: cached.pressurePaint } : {}) };
}
export function canvasPath(s: RenderVector): Path2D | undefined {
  // Independent gradients transform paint after constructing the current path.
  // Path2D is transformed at fill time, so retain current-path replay for these.
  if (s.kind === 'text' || s.gradient?.transform || typeof Path2D === 'undefined') return;
  let path = canvasPaths.get(s.commands);
  if (!path) {
    path = new Path2D();
    for (const c of s.commands) {
      if (c[0] === 'M') path.moveTo(c[1], c[2]);
      else if (c[0] === 'L') path.lineTo(c[1], c[2]);
      else if (c[0] === 'C') path.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
      else path.closePath();
    }
    canvasPaths.set(s.commands, path);
  }
  return path;
}
/** Self-contained: the identical function is embedded in HTML exports. */
export function paintCommands(
  ctx: CanvasRenderingContext2D,
  s: RenderVector,
  layout: typeof wrapText,
  bitmapImage?: CanvasImageSource,
  richPainter?: typeof import('./rich-text').paintStyledText,
  cachedPath?: Path2D,
  families: typeof fontFamilyForRendering = fontFamilyForRendering,
  blur: typeof paintBoxBlur = paintBoxBlur,
  decodedPixels = 0,
): void {
  if (s.blurRadius || s.blendMode || s.tint?.amount) {
    blur(ctx,s,tile=>paintCommands(tile,{...s,blurRadius:undefined,blendMode:undefined,tint:undefined,opacity:1},layout,bitmapImage,richPainter,cachedPath,families,blur,decodedPixels),decodedPixels);
    return;
  }
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate((s.rotation * Math.PI) / 180);
  if (s.transform) ctx.transform(...s.transform, 0, 0);
  ctx.globalAlpha *= s.opacity ?? 1;
  ctx.fillStyle = s.fill;
  ctx.strokeStyle = s.stroke;
  if (s.gradient) {
    const g = s.gradient;
    const gradient =
      g.kind === 'linear'
        ? ctx.createLinearGradient(g.from.x, g.from.y, g.to.x, g.to.y)
        : ctx.createRadialGradient(
            g.from.x,
            g.from.y,
            0,
            g.from.x,
            g.from.y,
            Math.max(0.001, Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y)),
          );
    g.stops.forEach((stop) =>
      gradient.addColorStop(
        stop.offset,
        stop.color +
          Math.round((stop.opacity ?? 1) * 255)
            .toString(16)
            .padStart(2, '0'),
      ),
    );
    ctx.fillStyle = gradient;
  }
  if (s.bitmap) {
    const b = s.bitmap;
    const pattern = bitmapImage
      ? ctx.createPattern(bitmapImage, b.repeat ? 'repeat' : 'no-repeat')
      : null;
    if (pattern && bitmapImage) {
      const source = bitmapImage as HTMLImageElement;
      pattern.setTransform(
        new DOMMatrix()
          .translate(b.x, b.y)
          .multiply(new DOMMatrix([...(b.transform ?? [1, 0, 0, 1]), 0, 0]))
          .scale(b.width / source.width, b.height / source.height),
      );
      ctx.fillStyle = pattern;
    } else ctx.fillStyle = '#ff00ff';
  }
  if (s.pressurePaint) {
    try {
      if (s.fillEnabled === false || !s.pressurePaint.length) return;
      const m = ctx.getTransform();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const { commands } of s.pressurePaint)
        for (const command of commands)
          for (let i = 1; i < command.length; i += 2) {
            const x = command[i] as number, y = command[i + 1] as number;
            const px = m.a * x + m.c * y + m.e, py = m.b * x + m.d * y + m.f;
            minX = Math.min(minX, px); maxX = Math.max(maxX, px);
            minY = Math.min(minY, py); maxY = Math.max(maxY, py);
          }
      const left = Math.max(0, Math.floor(minX) - 1), top = Math.max(0, Math.floor(minY) - 1);
      const width = Math.min(ctx.canvas.width, Math.ceil(maxX) + 1) - left;
      const height = Math.min(ctx.canvas.height, Math.ceil(maxY) + 1) - top;
      if (width <= 0 || height <= 0) return;
      if (![width, height].every(Number.isFinite) || width > 16384 || height > 16384 ||
          width * height * 2 > 64 * 1024 * 1024)
        throw Error('Brush opacity raster exceeds the stage working budget.');
      const tile = ctx.canvas.ownerDocument?.createElement('canvas') ?? new OffscreenCanvas(width, height);
      tile.width = width;
      tile.height = height;
      const ink = tile.getContext('2d', { willReadFrequently: true })!;
      // An opaque grayscale mask with lighten stores the strongest pressure
      // at an overlap. The single final composite applies object opacity once.
      ink.fillStyle = '#000000';
      ink.fillRect(0, 0, width, height);
      ink.setTransform(m.a, m.b, m.c, m.d, m.e - left, m.f - top);
      ink.globalCompositeOperation = 'lighten';
      const shade = (a: number) => `rgb(${a * 255} ${a * 255} ${a * 255})`;
      for (const { from, to, commands } of s.pressurePaint) {
        if (from[2] === to[2] || (from[0] === to[0] && from[1] === to[1]))
          ink.fillStyle = shade(Math.max(from[2], to[2]));
        else {
          const ramp = ink.createLinearGradient(from[0], from[1], to[0], to[1]);
          ramp.addColorStop(0, shade(from[2]));
          ramp.addColorStop(1, shade(to[2]));
          ink.fillStyle = ramp;
        }
        ink.beginPath();
        for (const c of commands) {
          if (c[0] === 'M') ink.moveTo(c[1], c[2]);
          else if (c[0] === 'L') ink.lineTo(c[1], c[2]);
          else if (c[0] === 'C') ink.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
          else ink.closePath();
        }
        ink.fill();
      }
      const rgba = ink.getImageData(0, 0, width, height);
      for (let i = 0; i < rgba.data.length; i += 4) rgba.data[i + 3] = rgba.data[i];
      ink.putImageData(rgba, 0, 0);
      ink.globalCompositeOperation = 'source-in';
      ink.fillStyle = ctx.fillStyle;
      const g = s.gradient;
      if (g?.transform) {
        ink.translate(g.from.x, g.from.y);
        ink.transform(...g.transform, 0, 0);
        ink.translate(-g.from.x, -g.from.y);
      }
      const inverse = ink.getTransform().inverse();
      const corners = [new DOMPoint(0, 0), new DOMPoint(width, 0), new DOMPoint(width, height),
        new DOMPoint(0, height)].map(p => inverse.transformPoint(p));
      const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
      ink.fillRect(x - 1, y - 1, Math.max(...corners.map(p => p.x)) - x + 2,
        Math.max(...corners.map(p => p.y)) - y + 2);
      ctx.resetTransform();
      ctx.drawImage(tile, left, top);
    } finally {
      ctx.restore();
    }
    return;
  }
  ctx.lineWidth = s.strokeWidth || 1;
  ctx.lineCap = s.strokeCap ?? 'round';
  ctx.lineJoin = s.strokeJoin ?? 'round';
  ctx.miterLimit = 4;
  if (s.kind === 'text' && s.text) {
    const t = s.text;
    const sx = t.scaleX ?? 1,
      sy = t.scaleY ?? 1;
    if (!sx || !sy) {
      ctx.restore();
      return;
    }
    if (t.runs?.length && richPainter) {
      const paintMatrix = ctx.getTransform();
      ctx.scale(sx, sy);
      const options = {
        ...t,
        runs: t.runs,
        width: s.width / sx,
        direction: t.direction ?? 'ltr',
        fillEnabled: s.fillEnabled,
        stroke: !!s.strokeWidth,
      };
      if (s.fillEnabled !== false && (s.gradient || s.bitmap)) {
        const prepared = richPainter(ctx, { ...options, measureOnly: true });
        const glyphMatrix = ctx.getTransform(),
          bounds = prepared.bounds;
        if (bounds) {
          const corners = [
            { x: bounds.left, y: bounds.top },
            { x: bounds.right, y: bounds.top },
            { x: bounds.right, y: bounds.bottom },
            { x: bounds.left, y: bounds.bottom },
          ].map((p) => glyphMatrix.transformPoint(p));
          const left = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))) - 2),
            top = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))) - 2);
          const right = Math.min(
              ctx.canvas.width,
              Math.ceil(Math.max(...corners.map((p) => p.x))) + 2,
            ),
            bottom = Math.min(
              ctx.canvas.height,
              Math.ceil(Math.max(...corners.map((p) => p.y))) + 2,
            );
          const tile = document.createElement('canvas');
          for (let y = top; y < bottom; y += 1024)
            for (let x = left; x < right; x += 1024) {
              tile.width = Math.min(1024, right - x);
              tile.height = Math.min(1024, bottom - y);
              const mask = tile.getContext('2d')!;
              mask.setTransform(
                glyphMatrix.a,
                glyphMatrix.b,
                glyphMatrix.c,
                glyphMatrix.d,
                glyphMatrix.e - x,
                glyphMatrix.f - y,
              );
              mask.fillStyle = '#ffffff';
              richPainter(mask, { ...options, prepared, stroke: false, fillMode: 'inherited' });
              mask.globalCompositeOperation = 'source-in';
              mask.resetTransform();
              mask.beginPath();
              mask.rect(0, 0, tile.width, tile.height);
              mask.setTransform(
                paintMatrix.a,
                paintMatrix.b,
                paintMatrix.c,
                paintMatrix.d,
                paintMatrix.e - x,
                paintMatrix.f - y,
              );
              if (s.gradient?.transform) {
                const g = s.gradient;
                mask.translate(g.from.x, g.from.y);
                mask.transform(...g.transform!, 0, 0);
                mask.translate(-g.from.x, -g.from.y);
              }
              mask.fillStyle = ctx.fillStyle;
              mask.fill();
              ctx.save();
              ctx.resetTransform();
              ctx.drawImage(tile, x, y);
              ctx.restore();
            }
        }
        richPainter(ctx, { ...options, prepared, fillMode: 'overrides' });
      } else richPainter(ctx, options);
      ctx.restore();
      return;
    }
    const paintMatrix = ctx.getTransform();
    ctx.scale(sx, sy);
    ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${families(t.font)}`;
    ctx.letterSpacing = `${t.letterSpacing ?? 0}px`;
    ctx.wordSpacing = `${t.wordSpacing ?? 0}px`;
    ctx.direction = t.direction ?? 'ltr';
    ctx.fontKerning = t.kerning ?? 'auto';
    ctx.textBaseline = 'top';
    ctx.textAlign = t.align;
    const x = t.align === 'center' ? s.width / sx / 2 : t.align === 'right' ? s.width / sx : 0;
    const lines = layout(t.content, t.wrapWidth, (text) => ctx.measureText(text).width);
    if (s.fillEnabled !== false && (s.gradient?.transform || s.bitmap)) {
      // Mask glyphs in device space, then paint through the mask. Transforming
      // fillText itself would distort glyph geometry along with the gradient.
      const glyphMatrix = ctx.getTransform();
      let left = Infinity,
        top = Infinity,
        right = -Infinity,
        bottom = -Infinity;
      lines.forEach((line, i) => {
        const m = ctx.measureText(line),
          y = i * t.size * (t.lineHeight ?? 1.2);
        for (const px of [x - m.actualBoundingBoxLeft, x + m.actualBoundingBoxRight])
          for (const py of [y - m.actualBoundingBoxAscent, y + m.actualBoundingBoxDescent]) {
            const point = glyphMatrix.transformPoint({ x: px, y: py });
            left = Math.min(left, point.x);
            right = Math.max(right, point.x);
            top = Math.min(top, point.y);
            bottom = Math.max(bottom, point.y);
          }
      });
      left = Math.max(0, Math.floor(left) - 2);
      top = Math.max(0, Math.floor(top) - 2);
      right = Math.min(ctx.canvas.width, Math.ceil(right) + 2);
      bottom = Math.min(ctx.canvas.height, Math.ceil(bottom) + 2);
      // Bounded scratch tiles avoid full-stage allocations for large exports.
      const tile = document.createElement('canvas');
      for (let ty = top; ty < bottom; ty += 1024)
        for (let tx = left; tx < right; tx += 1024) {
          tile.width = Math.min(1024, right - tx);
          tile.height = Math.min(1024, bottom - ty);
          const mask = tile.getContext('2d')!;
          mask.setTransform(
            glyphMatrix.a,
            glyphMatrix.b,
            glyphMatrix.c,
            glyphMatrix.d,
            glyphMatrix.e - tx,
            glyphMatrix.f - ty,
          );
          mask.font = ctx.font;
          mask.letterSpacing = ctx.letterSpacing;
          mask.wordSpacing = ctx.wordSpacing;
          mask.direction = ctx.direction;
          mask.fontKerning = ctx.fontKerning;
          mask.textAlign = ctx.textAlign;
          mask.textBaseline = ctx.textBaseline;
          mask.fillStyle = '#ffffff';
          lines.forEach((line, i) => mask.fillText(line, x, i * t.size * (t.lineHeight ?? 1.2)));
          mask.globalCompositeOperation = 'source-in';
          mask.resetTransform();
          mask.beginPath();
          mask.rect(0, 0, tile.width, tile.height);
          mask.setTransform(
            paintMatrix.a,
            paintMatrix.b,
            paintMatrix.c,
            paintMatrix.d,
            paintMatrix.e - tx,
            paintMatrix.f - ty,
          );
          if (s.gradient?.transform) {
            const g = s.gradient;
            mask.translate(g.from.x, g.from.y);
            mask.transform(...g.transform!, 0, 0);
            mask.translate(-g.from.x, -g.from.y);
          }
          mask.fillStyle = ctx.fillStyle;
          mask.fill();
          ctx.save();
          ctx.resetTransform();
          ctx.drawImage(tile, tx, ty);
          ctx.restore();
        }
    } else if (s.fillEnabled !== false) {
      lines.forEach((line, i) => ctx.fillText(line, x, i * t.size * (t.lineHeight ?? 1.2)));
    }
    if (s.strokeWidth)
      lines.forEach((line, i) => ctx.strokeText(line, x, i * t.size * (t.lineHeight ?? 1.2)));
    ctx.restore();
    return;
  }
  const path = s.gradient?.transform ? undefined : cachedPath;
  ctx.beginPath();
  for (const c of path ? [] : s.commands) {
    if (c[0] === 'M') ctx.moveTo(c[1], c[2]);
    else if (c[0] === 'L') ctx.lineTo(c[1], c[2]);
    else if (c[0] === 'C') ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else ctx.closePath();
  }
  if (
    s.fillEnabled !== false &&
    (['rectangle', 'ellipse', 'polygon', 'brush'].includes(s.kind) || s.closed)
  ) {
    ctx.save();
    if (s.gradient?.transform) {
      const g = s.gradient;
      ctx.translate(g.from.x, g.from.y);
      ctx.transform(...g.transform!, 0, 0);
      ctx.translate(-g.from.x, -g.from.y);
    }
    if (path) ctx.fill(path, s.fillRule ?? 'nonzero');
    else ctx.fill(s.fillRule ?? 'nonzero');
    ctx.restore();
  }
  if (s.strokeWidth && s.kind !== 'brush') {
    if (path) ctx.stroke(path);
    else ctx.stroke();
  }
  ctx.restore();
}

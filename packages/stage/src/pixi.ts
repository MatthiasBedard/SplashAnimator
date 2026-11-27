import { paintStyledText } from './rich-text';
import { fontFamilyForRendering } from '../../geometry/src/font-family';
import { bitmapImage } from './bitmap-cache';
import { wrapText } from '../../geometry/src/text-layout';
import { Application, Graphics, Sprite, Texture, FillGradient, Container, Matrix } from 'pixi.js';
import { matrix, mapPoint } from '../../geometry/src/affine';
import { evaluate } from '@splash/animation';
import type { Project } from '@splash/document';
import type { StageRenderer } from './index';
import { renderData, paintCommands } from './render-data';
export async function createPixiStage(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Promise<StageRenderer> {
  const app = new Application();
  await app.init({ canvas, width, height, antialias: true, autoStart: false, preference: 'webgl' });
  const measure = document.createElement('canvas').getContext('2d')!;
  let gradients: FillGradient[] = [];
  let textTextures: Texture[] = [];
  return {
    render(project: Project, frame: number, movieFrames?: Record<string, number>) {
      app.renderer.background.color = project.background;
      app.stage.removeChildren().forEach((c) => c.destroy({ children: true }));
      gradients.forEach((g) => g.destroy());
      gradients = [];
      textTextures.forEach((t) => t.destroy(true));
      textTextures = [];
      for (const shape of evaluate(project, frame, movieFrames)) {
        const s = renderData(shape);
        if (
          (s.bitmap && s.kind !== 'text') ||
          s.pressurePaint ||
          s.text?.runs?.length ||
          s.contours?.some((r) => r.some((n) => n.in || n.out))
        ) {
          const source = s.bitmap ? bitmapImage(project.assets, s.bitmap.assetId) : undefined;
          const sx = s.text?.scaleX ?? 1,
            sy = s.text?.scaleY ?? 1;
          const contourPoints = s.contours?.flatMap((r) =>
            r.flatMap((n) => [n, ...(n.in ? [n.in] : []), ...(n.out ? [n.out] : [])]),
          );
          const ink =
            s.text?.runs?.length && sx && sy
              ? paintStyledText(measure, {
                  ...s.text,
                  runs: s.text.runs,
                  width: s.width / sx,
                  direction: s.text.direction ?? 'ltr',
                  measureOnly: true,
                }).bounds
              : contourPoints?.length
                ? contourPoints.reduce(
                    (b, p) => ({
                      left: Math.min(b.left, p.x),
                      right: Math.max(b.right, p.x),
                      top: Math.min(b.top, p.y),
                      bottom: Math.max(b.bottom, p.y),
                    }),
                    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
                  )
                : null;
          const m = matrix(s),
            corners = [
              { x: ink ? ink.left * sx : 0, y: ink ? ink.top * sy : 0 },
              { x: ink ? ink.right * sx : s.width, y: ink ? ink.top * sy : 0 },
              { x: ink ? ink.right * sx : s.width, y: ink ? ink.bottom * sy : s.height },
              { x: ink ? ink.left * sx : 0, y: ink ? ink.bottom * sy : s.height },
            ].map((p) => mapPoint(m, p));
          const pad =
            Math.max(...m.slice(0, 4).map(Math.abs)) * s.strokeWidth * 4 * Math.max(1, sx, sy) + 2;
          const left = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x)) - pad)),
            top = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y)) - pad));
          const right = Math.min(
              project.width,
              Math.ceil(Math.max(...corners.map((p) => p.x)) + pad),
            ),
            bottom = Math.min(
              project.height,
              Math.ceil(Math.max(...corners.map((p) => p.y)) + pad),
            );
          for (let y = top; y < bottom; y += 1024)
            for (let x = left; x < right; x += 1024) {
              const tile = document.createElement('canvas');
              tile.width = Math.min(1024, right - x);
              tile.height = Math.min(1024, bottom - y);
              const ctx = tile.getContext('2d')!;
              ctx.translate(-x, -y);
              paintCommands(ctx, s, wrapText, source, paintStyledText);
              const texture = Texture.from(tile);
              textTextures.push(texture);
              const sprite = new Sprite(texture);
              sprite.position.set(x, y);
              app.stage.addChild(sprite);
            }
          continue;
        }
        if (s.kind === 'text' && s.text) {
          const t = s.text,
            sx = t.scaleX ?? 1,
            sy = t.scaleY ?? 1;
          if (!sx || !sy) continue;
          measure.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${fontFamilyForRendering(t.font)}`;
          measure.letterSpacing = `${t.letterSpacing ?? 0}px`;
          measure.wordSpacing = `${t.wordSpacing ?? 0}px`;
          measure.direction = t.direction ?? 'ltr';
          measure.fontKerning = t.kerning ?? 'auto';
          measure.textAlign = t.align;
          measure.textBaseline = 'top';
          const lines = wrapText(t.content, t.wrapWidth, (text) => measure.measureText(text).width);
          const x =
            t.align === 'center' ? s.width / sx / 2 : t.align === 'right' ? s.width / sx : 0;
          let left = Infinity,
            top = Infinity,
            right = -Infinity,
            bottom = -Infinity;
          const m = matrix(s),
            pad = s.strokeWidth * 2 + 2;
          lines.forEach((line, i) => {
            const bounds = measure.measureText(line),
              y = i * t.size * (t.lineHeight ?? 1.2);
            for (const px of [
              x - bounds.actualBoundingBoxLeft - pad,
              x + bounds.actualBoundingBoxRight + pad,
            ])
              for (const py of [
                y - bounds.actualBoundingBoxAscent - pad,
                y + bounds.actualBoundingBoxDescent + pad,
              ]) {
                const point = mapPoint(m, { x: px * sx, y: py * sy });
                left = Math.min(left, point.x);
                right = Math.max(right, point.x);
                top = Math.min(top, point.y);
                bottom = Math.max(bottom, point.y);
              }
          });
          left = Math.max(0, Math.floor(left) - 2);
          top = Math.max(0, Math.floor(top) - 2);
          right = Math.min(project.width, Math.ceil(right) + 2);
          bottom = Math.min(project.height, Math.ceil(bottom) + 2);
          for (let y = top; y < bottom; y += 1024)
            for (let x = left; x < right; x += 1024) {
              const tile = document.createElement('canvas');
              tile.width = Math.min(1024, right - x);
              tile.height = Math.min(1024, bottom - y);
              const ctx = tile.getContext('2d')!;
              ctx.translate(-x, -y);
              paintCommands(
                ctx,
                s,
                wrapText,
                s.bitmap ? bitmapImage(project.assets, s.bitmap.assetId) : undefined,
              );
              const texture = Texture.from(tile);
              textTextures.push(texture);
              const sprite = new Sprite(texture);
              sprite.position.set(x, y);
              app.stage.addChild(sprite);
            }
          continue;
        }
        const container = new Container();
        container.setFromMatrix(new Matrix(...matrix(s)));
        container.alpha = s.opacity ?? 1;
        app.stage.addChild(container);
        const gradient = s.gradient;
        let paint: string | FillGradient = s.fill;
        if (gradient) {
          paint = new FillGradient(
            gradient.kind === 'linear'
              ? {
                  type: 'linear',
                  start: gradient.from,
                  end: gradient.to,
                  colorStops: gradient.stops.map((stop) => ({
                    offset: stop.offset,
                    color:
                      stop.color +
                      Math.round((stop.opacity ?? 1) * 255)
                        .toString(16)
                        .padStart(2, '0'),
                  })),
                  textureSpace: 'global',
                }
              : {
                  type: 'radial',
                  center: gradient.from,
                  outerCenter: gradient.from,
                  innerRadius: 0,
                  outerRadius: Math.max(
                    0.001,
                    Math.hypot(gradient.to.x - gradient.from.x, gradient.to.y - gradient.from.y),
                  ),
                  colorStops: gradient.stops.map((stop) => ({
                    offset: stop.offset,
                    color:
                      stop.color +
                      Math.round((stop.opacity ?? 1) * 255)
                        .toString(16)
                        .padStart(2, '0'),
                  })),
                  textureSpace: 'global',
                },
          );
          if (gradient.transform) {
            const [a, b, c, d] = gradient.transform,
              { x, y } = gradient.from;
            paint.buildGradient();
            paint.transform!.prepend(new Matrix(a, b, c, d, x - a * x - c * y, y - b * x - d * y));
          }
          gradients.push(paint);
        }
        const g = new Graphics();
        if (s.contours?.length) {
          if (s.fillEnabled !== false)
            s.contours.forEach((ring, i) => {
              ring.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
              g.closePath();
              if (i) g.cut();
              else g.fill(paint);
            });
          if (s.strokeWidth)
            for (const ring of s.contours) {
              ring.forEach((p, j) => (j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
              g.closePath();
              g.stroke({
                color: s.stroke,
                width: s.strokeWidth,
                cap: s.strokeCap ?? 'round',
                join: s.strokeJoin ?? 'round',
              });
            }
          container.addChild(g);
          continue;
        }
        for (const c of s.commands) {
          if (c[0] === 'M') g.moveTo(c[1], c[2]);
          else if (c[0] === 'L') g.lineTo(c[1], c[2]);
          else if (c[0] === 'C') g.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
          else g.closePath();
        }
        if (
          s.fillEnabled !== false &&
          (['rectangle', 'ellipse', 'polygon', 'brush'].includes(s.kind) || s.closed)
        )
          g.fill(paint);
        if (s.strokeWidth && s.kind !== 'brush')
          g.stroke({
            color: s.stroke,
            width: s.strokeWidth,
            cap: s.strokeCap ?? 'round',
            join: s.strokeJoin ?? 'round',
            miterLimit: 4,
          });
        container.addChild(g);
      }
      app.render();
    },
    destroy() {
      app.destroy(false, { children: true });
      gradients.forEach((g) => g.destroy());
      gradients = [];
      textTextures.forEach((t) => t.destroy(true));
      textTextures = [];
    },
  };
}

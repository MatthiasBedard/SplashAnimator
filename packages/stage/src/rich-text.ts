import { createBidiResolver } from '../../geometry/src/bidi-text';
import { fontFamilyForRendering } from '../../geometry/src/font-family';
import {
  layoutStyledText,
  positionStyledLines,
  styledInkBounds,
  type PositionedLine,
  type TextRun,
  type TextStyle,
  type StyledSpan,
} from '../../geometry/src/rich-text';
export type RichTextOptions = {
  content: string;
  runs: readonly TextRun[];
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  width: number;
  wrapWidth?: number;
  align: 'left' | 'center' | 'right';
  direction: 'ltr' | 'rtl';
  lineHeight?: number;
  letterSpacing?: number;
  wordSpacing?: number;
  measureOnly?: boolean;
  caretMetrics?: boolean;
  fillMode?: 'all' | 'inherited' | 'overrides';
  prepared?: { lines: PositionedLine[]; bounds: ReturnType<typeof styledInkBounds> };
  fillEnabled?: boolean;
  stroke?: boolean;
  kerning?: 'auto' | 'normal' | 'none';
};
/** Shared Canvas adapter. Caller owns shape/paint transforms and compositing. */
export function createRichPainter(
  runtime: {
    layoutStyledText: typeof layoutStyledText;
    positionStyledLines: typeof positionStyledLines;
    styledInkBounds: typeof styledInkBounds;
  },
  resolver: typeof createBidiResolver,
  families: typeof fontFamilyForRendering = fontFamilyForRendering,
) {
  const { layoutStyledText, positionStyledLines, styledInkBounds } = runtime;
  const contextualCache = new WeakMap<Document, {
    faces: FontFace[];
    statuses: string;
    positions: Map<string, readonly number[]>;
  }>();
  function contextualPositions(
    ctx: CanvasRenderingContext2D,
    text: string,
    direction: 'ltr' | 'rtl',
    offsets: readonly number[],
    width: number,
  ) {
    const document = ctx.canvas?.ownerDocument;
    if (!document?.body || !width) return;
    const faces = Array.from(document.fonts);
    const statuses = faces.map(face => face.status).join(',');
    let cache = contextualCache.get(document);
    if (!cache || cache.statuses !== statuses || faces.some((face, i) => cache!.faces[i] !== face)) {
      cache = { faces, statuses, positions: new Map() };
      contextualCache.set(document, cache);
    }
    const key = JSON.stringify([
      ctx.font, ctx.letterSpacing, ctx.wordSpacing, ctx.fontKerning, direction,
      document.documentElement.lang, width, text, offsets,
    ]);
    const cached = cache.positions.get(key);
    if (cached) return cached;
    const probe = document.createElement('span');
    probe.style.cssText = 'all:initial;position:fixed;display:inline-block;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre';
    probe.dir = direction;
    probe.style.direction = direction;
    probe.style.font = ctx.font;
    probe.style.letterSpacing = ctx.letterSpacing;
    probe.style.wordSpacing = ctx.wordSpacing;
    probe.style.fontKerning = ctx.fontKerning;
    probe.textContent = text;
    probe.setAttribute('aria-hidden', 'true');
    document.body.append(probe);
    try {
      const box = probe.getBoundingClientRect();
      // Use CSS range positions only when CSS and Canvas selected compatible
      // metrics. The small difference allows browser subpixel rounding.
      if (!(box.width > 0) || Math.abs(box.width - width) > 0.08) return;
      const range = document.createRange();
      const results = offsets.map(offset => {
        if (offset === 0) return direction === 'rtl' ? width : 0;
        if (offset === text.length) return direction === 'rtl' ? 0 : width;
        range.setStart(probe.firstChild!, offset);
        range.collapse(true);
        return Math.min(width, Math.max(0, (range.getBoundingClientRect().left - box.left) / box.width * width));
      });
      // Avoid retaining a large assortment of rich text or its shaping ranges.
      if (cache.positions.size >= 64) cache.positions.clear();
      cache.positions.set(key, results);
      return results;
    } finally {
      probe.remove();
    }
  }
  function paintStyledText(ctx: CanvasRenderingContext2D, options: RichTextOptions) {
    ctx.save();
    try {
      const configure = (style: TextStyle, direction: 'ltr' | 'rtl') => {
        ctx.font = `${(style.italic ?? options.italic) ? 'italic ' : ''}${(style.bold ?? options.bold) ? 'bold ' : ''}${style.size ?? options.size}px ${families(style.font ?? options.font)}`;
        ctx.direction = direction;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.letterSpacing = `${style.letterSpacing ?? options.letterSpacing ?? 0}px`;
        ctx.wordSpacing = `${style.wordSpacing ?? options.wordSpacing ?? 0}px`;
        ctx.fontKerning = style.kerning ?? options.kerning ?? 'auto';
      };
      const arabicText = /^[\p{Script=Arabic}\p{Mark}\u200c\u200d\s]+$/u;
      const latinText = /^[\p{Script=Latin}\p{Mark}\x20-\x7e\p{Zs}\t]+$/u;
      const canJoin = (left: StyledSpan, right: StyledSpan, direction: 'ltr' | 'rtl') => {
        const script = direction === 'rtl' ? arabicText : latinText;
        if (!script.test(left.text) || !script.test(right.text)) return false;
        const a = left.style, b = right.style;
        return (a.font ?? options.font) === (b.font ?? options.font) &&
          (a.size ?? options.size) === (b.size ?? options.size) &&
          (a.bold ?? options.bold) === (b.bold ?? options.bold) &&
          (a.italic ?? options.italic) === (b.italic ?? options.italic) &&
          (a.letterSpacing ?? options.letterSpacing ?? 0) === (b.letterSpacing ?? options.letterSpacing ?? 0) &&
          (a.wordSpacing ?? options.wordSpacing ?? 0) === (b.wordSpacing ?? options.wordSpacing ?? 0) &&
          (a.kerning ?? options.kerning ?? 'auto') === (b.kerning ?? options.kerning ?? 'auto');
      };
      const prepare = () => {
        configure({}, options.direction);
        const base = ctx.measureText('Mg');
        const resolve = options.direction === 'ltr' && /^[\x00-\x7f]*$/.test(options.content)
          ? undefined : resolver(options.content, options.direction);
        const join = /[\p{Script=Arabic}\p{Script=Latin}]/u.test(options.content) ? canJoin : undefined;
        const logical = layoutStyledText(
          options.content,
          options.runs,
          options.wrapWidth,
          (text, style, direction) => {
            configure(style, direction ?? options.direction);
            return ctx.measureText(text).width;
          },
          resolve,
          join,
        );
        const positioned = positionStyledLines(
          logical,
          {
            width: options.width,
            align: options.align,
            lineHeight: options.lineHeight ?? 1.2,
            emptyAscent: base.fontBoundingBoxAscent ?? base.actualBoundingBoxAscent,
            emptyDescent: base.fontBoundingBoxDescent ?? base.actualBoundingBoxDescent,
          },
          (text, style, direction) => {
            configure(style, direction);
            const m = ctx.measureText(text);
            return {
              width: m.width,
              ascent: m.actualBoundingBoxAscent,
              descent: m.actualBoundingBoxDescent,
              fontAscent: m.fontBoundingBoxAscent ?? Math.max(0, m.actualBoundingBoxAscent),
              fontDescent: m.fontBoundingBoxDescent ?? Math.max(0, m.actualBoundingBoxDescent),
              left: m.actualBoundingBoxLeft,
              right: m.actualBoundingBoxRight,
            };
          },
          resolve,
          join,
          {
            includeCarets: options.caretMetrics,
            positions(text, style, direction, offsets, width) {
              configure(style, direction);
              return contextualPositions(ctx, text, direction, offsets, width);
            },
          },
        );
        return { lines: positioned, bounds: styledInkBounds(positioned) };
      };
      const prepared = options.prepared ?? prepare();
      const positioned = prepared.lines;
      const paint = ctx.fillStyle;
      const fill = (color: string | undefined) => {
        if (options.fillMode === 'inherited' && color) return undefined;
        if (options.fillMode === 'overrides' && !color) return undefined;
        return color ?? paint;
      };
      if (!options.measureOnly)
        for (const line of positioned)
          for (let i = 0; i < line.spans.length; i++) {
            const span = line.spans[i];
            configure(span.style, span.direction);
            const run = span.shaped;
            if (!run) {
              const color = fill(span.style.color);
              if (options.fillEnabled !== false && color) {
                ctx.fillStyle = color;
                ctx.fillText(span.text, span.x, span.baseline);
              }
              if (options.stroke) ctx.strokeText(span.text, span.x, span.baseline);
              continue;
            }
            const members = [span];
            while (line.spans[i + 1]?.shaped === run) members.push(line.spans[++i]);
            if (options.fillEnabled !== false) {
              const colors = members.map(member => fill(member.style.color));
              const right = run.x + run.metrics.width;
              const firstColor = colors.find(Boolean);
              if (firstColor) {
                // One rasterization keeps the native joined silhouette and
                // avoids alpha seams where two character colors meet.
                if (right <= run.x || colors.every(color => color === firstColor)) {
                  ctx.fillStyle = firstColor;
                  ctx.fillText(run.text, run.x, span.baseline);
                } else if (colors.every(color => !color || typeof color === 'string')) {
                  const gradient = ctx.createLinearGradient(run.x, 0, right, 0);
                  members.forEach((member, index) => {
                    const start = (member.x - run.x) / (right - run.x);
                    const end = index === members.length - 1 ? 1 : (members[index + 1].x - run.x) / (right - run.x);
                    const color = colors[index] ?? 'transparent';
                    gradient.addColorStop(start, color as string);
                    gradient.addColorStop(end, color as string);
                  });
                  ctx.fillStyle = gradient;
                  ctx.fillText(run.text, run.x, span.baseline);
                } else {
                  // The stage normally separates patterned paint into its
                  // alpha-mask pass. Preserve caller-owned patterns as well.
                  members.forEach((member, index) => {
                    const color = colors[index];
                    if (!color) return;
                    const left = index === 0 ? run.x - (run.metrics.left ?? 0) : member.x;
                    const end = members[index + 1]?.x ?? Math.max(right, run.x + (run.metrics.right ?? 0));
                    ctx.save();
                    try {
                      ctx.beginPath();
                      ctx.rect(left, span.baseline - run.metrics.ascent, end - left,
                        run.metrics.ascent + run.metrics.descent);
                      ctx.clip();
                      ctx.fillStyle = color;
                      ctx.fillText(run.text, run.x, span.baseline);
                    } finally {
                      ctx.restore();
                    }
                  });
                }
              }
            }
            if (options.stroke) ctx.strokeText(run.text, run.x, span.baseline);
          }
      return prepared;
    } finally {
      ctx.restore();
    }
  }

  return paintStyledText;
}
export const paintStyledText = createRichPainter(
  { layoutStyledText, positionStyledLines, styledInkBounds },
  createBidiResolver,
);

import type { Point, Vector } from '../../../packages/document/src';
import { fontFamilyForRendering } from '../../../packages/geometry/src/font-family';
import { createBidiResolver } from '../../../packages/geometry/src/bidi-text';
import {
  reconcileStyledText,
  layoutStyledText,
  type PositionedLine,
  type TextStyle,
  styledSpans,
  replaceStyledRange,
  formatTextRange,
} from '../../../packages/geometry/src/rich-text';
import { paintStyledText } from '../../../packages/stage/src/rich-text';
import { textRange } from '../../../packages/geometry/src/text-range';

export const textStyleKeys = [
  'font',
  'size',
  'bold',
  'italic',
  'color',
  'letterSpacing',
  'wordSpacing',
  'kerning',
] as const;

/** Selection-tool attributes apply across the field; unrelated character overrides survive. */
export function textObjectProperties(
  text: NonNullable<Vector['text']>,
  patch: Partial<NonNullable<Vector['text']>>,
) {
  const next = { ...text, ...patch };
  const clear: TextStyle = {};
  for (const key of textStyleKeys)
    if (key !== 'color' && key in patch) Object.assign(clear, { [key]: undefined });
  if (next.runs?.length && next.content.length && Object.keys(clear).length)
    next.runs = formatTextRange(next.content, next.runs, 0, next.content.length, clear);
  return next;
}

/** Character controls follow the caret/selection, without changing the field's base style. */
export function textFormatting(
  shape: Vector,
  start: number,
  end = start,
  typing: TextStyle = {},
): TextStyle {
  const t = shape.text!,
    range = textRange(t.content, start, end);
  const base: TextStyle = {
    font: t.font,
    size: t.size,
    bold: t.bold,
    italic: t.italic,
    color:
      !shape.gradient && !shape.bitmap && /^#[\da-f]{6}$/i.test(shape.fill)
        ? shape.fill
        : undefined,
    letterSpacing: t.letterSpacing ?? 0,
    wordSpacing: t.wordSpacing ?? 0,
    kerning: t.kerning ?? 'auto',
  };
  const effective = (style: TextStyle) => {
    const result = { ...base };
    for (const key of textStyleKeys)
      if (style[key] !== undefined) Object.assign(result, { [key]: style[key] });
    return result;
  };
  const spans = styledSpans(t.content, t.runs ?? []);
  if (start === end) {
    const at = start > 0 ? start - 1 : 0;
    const result = effective(spans.find((s) => s.start <= at && s.end > at)?.style ?? {});
    for (const key of textStyleKeys)
      if (key in typing) Object.assign(result, { [key]: typing[key] ?? base[key] });
    return result;
  }
  const styles = spans
    .filter((s) => s.start < range.end && s.end > range.start)
    .map((s) => effective(s.style));
  const result: TextStyle = {};
  for (const key of textStyleKeys) {
    const value = styles[0]?.[key];
    if (styles.every((s) => s[key] === value)) Object.assign(result, { [key]: value });
  }
  return result;
}

/** Native beforeinput supplies exact replacement ownership, including equal/shorter replacements. */
export function replaceTextSelection(
  ctx: CanvasRenderingContext2D,
  source: Vector,
  start: number,
  end: number,
  inserted: string,
  typing: TextStyle = {},
) {
  if (source.text!.content.length - (end - start) + inserted.replace(/\r\n?/g, '\n').length > 10000)
    throw Error('Text is limited to 10,000 characters.');
  const shape = structuredClone(source),
    t = shape.text!;
  const style = textFormatting(source, start, start === end ? end : start + 1, typing);
  const base = textFormatting({ ...source, text: { ...t, runs: [] } }, 0);
  const result = replaceStyledRange(
    t.content,
    t.runs ?? [],
    start,
    end,
    inserted.replace(/\r\n?/g, '\n'),
  );
  t.content = result.content;
  t.runs = result.runs;
  if (result.end > result.start) {
    const patch: TextStyle = {};
    for (const key of textStyleKeys)
      Object.assign(patch, { [key]: style[key] === base[key] ? undefined : style[key] });
    t.runs = formatTextRange(t.content, t.runs, result.start, result.end, patch);
  }
  return measureTextField(ctx, shape);
}

export function configureText(ctx: CanvasRenderingContext2D, shape: Vector, style: TextStyle = {}) {
  const t = shape.text!;
  ctx.font = `${(style.italic ?? t.italic) ? 'italic ' : ''}${(style.bold ?? t.bold) ? 'bold ' : ''}${style.size ?? t.size}px ${fontFamilyForRendering(style.font ?? t.font)}`;
  ctx.letterSpacing = `${style.letterSpacing ?? t.letterSpacing ?? 0}px`;
  ctx.wordSpacing = `${style.wordSpacing ?? t.wordSpacing ?? 0}px`;
  ctx.fontKerning = style.kerning ?? t.kerning ?? 'auto';
}

/** Use the same metrics and source offsets as the Canvas/export painters. */
export function textFieldLayout(ctx: CanvasRenderingContext2D, shape: Vector): PositionedLine[] {
  const t = shape.text!;
  ctx.save();
  try {
    if (t.runs?.length)
      return paintStyledText(ctx, {
        ...t,
        runs: t.runs,
        width: shape.width / (t.scaleX || 1),
        direction: t.direction ?? 'ltr',
        measureOnly: true,
        caretMetrics: true,
      }).lines;
    configureText(ctx, shape);
    const direction = t.direction ?? 'ltr';
    ctx.direction = direction;
    const lines = layoutStyledText(
      t.content,
      [],
      t.wrapWidth,
      (text) => ctx.measureText(text).width,
    );
    return lines.map((l, index) => {
      const left =
        t.align === 'right'
          ? shape.width / (t.scaleX || 1) - l.width
          : t.align === 'center'
            ? (shape.width / (t.scaleX || 1) - l.width) / 2
            : 0;
      const top = index * t.size * (t.lineHeight ?? 1.2);
      // Plain paint sends each full wrapped line to Canvas independently.
      // Resolve that same line here to locate its visual caret runs.
      const lineText = t.content.slice(l.start, l.end);
      const visual = direction === 'ltr' && /^[\x00-\x7f]*$/.test(lineText)
        ? l.spans.map(span => ({ ...span, direction }))
        : createBidiResolver(lineText, direction)({
          start: 0, end: lineText.length, width: l.width,
          spans: l.spans.map(span => ({ ...span, start: span.start - l.start, end: span.end - l.start })),
        }).map(span => ({ ...span, start: span.start + l.start, end: span.end + l.start }));
      let x = left;
      return {
        ...l,
        top,
        baseline: top + t.size,
        height: t.size * (t.lineHeight ?? 1.2),
        spans: visual.map(span => {
          ctx.direction = span.direction;
          const width = visual.length === 1 ? l.width : ctx.measureText(span.text).width;
          const positioned = { ...span, x, baseline: top + t.size,
            metrics: { width, ascent: t.size, descent: t.size * 0.2 } };
          x += width;
          return positioned;
        }),
      };
    });
  } finally {
    ctx.restore();
  }
}

export function measureTextField(ctx: CanvasRenderingContext2D, source: Vector): Vector {
  const shape = structuredClone(source),
    t = shape.text;
  if (!t || typeof t.content !== 'string' || t.content.length > 10000)
    throw Error('Text is limited to 10,000 characters.');
  const lines = textFieldLayout(ctx, shape);
  shape.width = (t.wrapWidth || Math.max(1, ...lines.map((l) => l.width))) * (t.scaleX ?? 1);
  shape.height =
    (t.runs?.length
      ? Math.max(
          1,
          lines.reduce((n, l) => n + l.height, 0),
        )
      : (Math.max(0, lines.length - 1) * (t.lineHeight ?? 1.2) + 1.2) * t.size) * (t.scaleY ?? 1);
  if (
    ![shape.x, shape.y, shape.width, shape.height].every(
      (n) => Number.isFinite(n) && Math.abs(n) <= 100000,
    ) ||
    shape.width <= 0 ||
    shape.height <= 0
  )
    throw Error('Text field exceeds supported geometry limits.');
  return shape;
}

export function replaceTextContent(
  ctx: CanvasRenderingContext2D,
  source: Vector,
  content: string,
): Vector {
  content = content.replace(/\r\n?/g, '\n');
  if (content.length > 10000) throw Error('Text is limited to 10,000 characters.');
  const shape = structuredClone(source),
    t = shape.text!;
  if (t.runs?.length) t.runs = reconcileStyledText(t.content, t.runs, content).runs;
  t.content = content;
  return measureTextField(ctx, shape);
}

function spanX(
  ctx: CanvasRenderingContext2D,
  shape: Vector,
  span: PositionedLine['spans'][number],
  offset: number,
) {
  const contextual = span.shaped?.carets?.get(offset);
  if (contextual !== undefined) return span.shaped!.x + contextual;
  configureText(ctx, shape, span.style);
  ctx.direction = span.direction;
  const prefix = ctx.measureText(
    span.text.slice(0, Math.max(0, Math.min(span.text.length, offset - span.start))),
  ).width;
  const width = span.isolatedWidth === undefined ? prefix :
    offset <= span.start ? 0 : offset >= span.end ? span.metrics.width :
      span.metrics.width * (span.isolatedWidth
        ? Math.min(1, Math.max(0, prefix / span.isolatedWidth))
        : (offset - span.start) / span.text.length);
  return span.direction === 'rtl' ? span.x + span.metrics.width - width : span.x + width;
}
export function textCaret(
  ctx: CanvasRenderingContext2D,
  shape: Vector,
  lines: PositionedLine[],
  offset: number,
) {
  const line =
    lines.find((l) => offset >= l.start && offset <= l.end) ??
    lines.find((l) => l.start > offset) ??
    lines.at(-1)!;
  const span = line.spans.find(s => offset >= s.start && offset < s.end) ??
    line.spans.find(s => offset === s.end) ?? line.spans.at(-1);
  return {
    x: span
      ? spanX(ctx, shape, span, offset)
      : shape.text!.align === 'right'
        ? shape.width / (shape.text!.scaleX || 1)
        : shape.text!.align === 'center'
          ? shape.width / (shape.text!.scaleX || 1) / 2
          : 0,
    y: line.top,
    height: line.height,
  };
}

export function textOffsetAt(
  ctx: CanvasRenderingContext2D,
  shape: Vector,
  lines: PositionedLine[],
  p: Point,
) {
  const line =
    lines.find((l) => p.y >= l.top && p.y < l.top + l.height) ??
    (p.y < lines[0].top ? lines[0] : lines.at(-1)!);
  let best = line.start,
    distance = Infinity;
  const containing = line.spans.find(span => span.x < p.x && p.x < span.x + span.metrics.width);
  for (const span of containing ? [containing] : line.spans) {
    const boundaries = [
      span.start,
      ...Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(span.text),
        (g) => span.start + g.index + g.segment.length,
      ),
    ];
    // Prefix measurements preserve kerning; binary search avoids measuring every
    // growing prefix of a long line during every pointer delivery.
    let low = 0,
      high = boundaries.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2),
        x = spanX(ctx, shape, span, boundaries[mid]);
      if (span.direction === 'rtl' ? x > p.x : x < p.x) low = mid + 1;
      else high = mid;
    }
    for (const i of [low, Math.max(0, low - 1)]) {
      const d = Math.abs(spanX(ctx, shape, span, boundaries[i]) - p.x);
      if (d < distance) {
        distance = d;
        best = boundaries[i];
      }
    }
  }
  return best;
}

export function textSelectionRects(
  ctx: CanvasRenderingContext2D,
  shape: Vector,
  lines: PositionedLine[],
  start: number,
  end: number,
) {
  const range = textRange(shape.text!.content, Math.min(start, end), Math.max(start, end));
  return lines.flatMap((line) =>
    line.spans
      .filter((s) => s.start < range.end && s.end > range.start)
      .map((span) => {
        const a = spanX(ctx, shape, span, Math.max(span.start, range.start)),
          b = spanX(ctx, shape, span, Math.min(span.end, range.end));
        return { x: Math.min(a, b), y: line.top, width: Math.abs(b - a), height: line.height };
      }),
  );
}

export function textWordRange(content: string, offset: number) {
  const word = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'word' }).segment(content),
  ).find((w) => offset >= w.index && offset < w.index + w.segment.length);
  return word
    ? { start: word.index, end: word.index + word.segment.length }
    : { start: offset, end: offset };
}

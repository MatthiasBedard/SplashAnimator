export type TextStyle = {
  bold?: boolean;
  italic?: boolean;
  font?: string;
  size?: number;
  color?: string;
  letterSpacing?: number;
  wordSpacing?: number;
  kerning?: 'auto' | 'normal' | 'none';
};
export type TextRun = { start: number; end: number; style: TextStyle };
export type StyledSpan = TextRun & { text: string };
export type StyledLine = { start: number; end: number; width: number; spans: StyledSpan[] };
export type RunMetrics = {
  width: number;
  ascent: number;
  descent: number;
  left?: number;
  right?: number;
};
export type VisualSpan = StyledSpan & { direction: 'ltr' | 'rtl' };
export type PositionedSpan = VisualSpan & {
  x: number;
  baseline: number;
  metrics: RunMetrics;
  shaped?: { text: string; x: number; metrics: RunMetrics; carets?: ReadonlyMap<number, number> };
  isolatedWidth?: number;
};
export type PositionedLine = {
  start: number;
  end: number;
  width: number;
  top: number;
  baseline: number;
  height: number;
  spans: PositionedSpan[];
};

/** Self-contained runtime factory, shared with standalone HTML exports. */
export function createRichTextRuntime() {
  function textRange(content: string, start: number, end: number) {
    if (![start, end].every(Number.isInteger) || start < 0 || end < start || end > content.length)
      throw new Error('Invalid text selection.');
    if (start === end) return { start, end };
    const boundaries = [0];
    for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
      content,
    ))
      boundaries.push(segment.index + segment.segment.length);
    return {
      start: boundaries.filter((n) => n <= start).at(-1)!,
      end: boundaries.find((n) => n >= end)!,
    };
  }

  /** Local types keep the exported runtime factory self-contained. */
  type TextStyle = {
    bold?: boolean;
    italic?: boolean;
    font?: string;
    size?: number;
    color?: string;
    letterSpacing?: number;
    wordSpacing?: number;
    kerning?: 'auto' | 'normal' | 'none';
  };
  type TextRun = { start: number; end: number; style: TextStyle };
  type StyledSpan = TextRun & { text: string };
  const same = (a: TextStyle, b: TextStyle) =>
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.font === b.font &&
    a.size === b.size &&
    a.color === b.color &&
    a.letterSpacing === b.letterSpacing &&
    a.wordSpacing === b.wordSpacing &&
    a.kerning === b.kerning;
  function checkedStyle(style: TextStyle): TextStyle {
    if (
      (style.bold !== undefined && typeof style.bold !== 'boolean') ||
      (style.italic !== undefined && typeof style.italic !== 'boolean') ||
      (style.font !== undefined && !/^[a-zA-Z0-9 ,_-]{1,100}$/.test(style.font)) ||
      (style.size !== undefined &&
        (!Number.isFinite(style.size) || style.size < 1 || style.size > 1000)) ||
      (style.letterSpacing !== undefined &&
        (!Number.isFinite(style.letterSpacing) || Math.abs(style.letterSpacing) > 100)) ||
      (style.wordSpacing !== undefined &&
        (!Number.isFinite(style.wordSpacing) || Math.abs(style.wordSpacing) > 1000)) ||
      (style.kerning !== undefined && !['auto', 'normal', 'none'].includes(style.kerning)) ||
      (style.color !== undefined && !/^#[0-9a-f]{6}$/i.test(style.color))
    )
      throw new Error('Invalid text run style.');
    return Object.fromEntries(
      Object.entries(style).filter(
        ([k, v]) =>
          [
            'bold',
            'italic',
            'font',
            'size',
            'color',
            'letterSpacing',
            'wordSpacing',
            'kerning',
          ].includes(k) && v !== undefined,
      ),
    ) as TextStyle;
  }
  function canonicalTextRuns(content: string, runs: readonly TextRun[]): TextRun[] {
    if (content.length > 10000 || runs.length > 256)
      throw new Error('Rich text complexity limit exceeded.');
    const boundaries = new Set([0]);
    for (const s of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(content))
      boundaries.add(s.index + s.segment.length);
    const sorted = runs
      .map((r) => ({ ...r, style: checkedStyle(r.style) }))
      .sort((a, b) => a.start - b.start);
    const result: TextRun[] = [];
    let previousEnd = 0;
    for (const r of sorted) {
      if (
        !Number.isInteger(r.start) ||
        !Number.isInteger(r.end) ||
        r.start < previousEnd ||
        r.end <= r.start ||
        !boundaries.has(r.start) ||
        !boundaries.has(r.end)
      )
        throw new Error('Text runs must be disjoint and end at grapheme boundaries.');
      previousEnd = r.end;
      if (!Object.keys(r.style).length) continue;
      const last = result.at(-1);
      if (last && last.end === r.start && same(last.style, r.style)) last.end = r.end;
      else result.push(r);
    }
    return result;
  }
  function styledSpans(content: string, runs: readonly TextRun[]): StyledSpan[] {
    const out: StyledSpan[] = [];
    let offset = 0;
    for (const r of canonicalTextRuns(content, runs)) {
      if (offset < r.start)
        out.push({ start: offset, end: r.start, style: {}, text: content.slice(offset, r.start) });
      out.push({ ...r, text: content.slice(r.start, r.end) });
      offset = r.end;
    }
    if (offset < content.length)
      out.push({ start: offset, end: content.length, style: {}, text: content.slice(offset) });
    return out;
  }
  /** Undefined patch values remove overrides; false remains an explicit override. */
  function formatTextRange(
    content: string,
    runs: readonly TextRun[],
    start: number,
    end: number,
    patch: TextStyle,
  ): TextRun[] {
    const range = textRange(content, start, end);
    checkedStyle(patch);
    if (range.start === range.end) return canonicalTextRuns(content, runs);
    const result: TextRun[] = [];
    for (const span of styledSpans(content, runs)) {
      const cuts = [
        span.start,
        ...[range.start, range.end].filter((n) => n > span.start && n < span.end),
        span.end,
      ];
      for (let i = 1; i < cuts.length; i++)
        result.push({
          start: cuts[i - 1],
          end: cuts[i],
          style:
            cuts[i - 1] >= range.start && cuts[i] <= range.end
              ? checkedStyle({ ...span.style, ...patch })
              : { ...span.style },
        });
    }
    return canonicalTextRuns(content, result);
  }
  /** Replace an explicit range; inserted content inherits its first character's overrides. */
  function replaceStyledRange(
    content: string,
    runs: readonly TextRun[],
    start: number,
    end: number,
    inserted: string,
  ) {
    let range = textRange(content, start, end);
    if (start === end && start < content.length) {
      const boundary = textRange(content, start, start + 1).start;
      range = { start: boundary, end: boundary };
    }
    const canonical = canonicalTextRuns(content, runs);
    const next = content.slice(0, range.start) + inserted + content.slice(range.end);
    if (next.length > 10000) throw new Error('Rich text complexity limit exceeded.');
    const delta = inserted.length - (range.end - range.start);
    const inherited =
      canonical.find((r) => r.start <= range.start && r.end > range.start)?.style ?? {};
    const result: TextRun[] = [];
    for (const r of canonical) {
      if (r.start < range.start)
        result.push({ start: r.start, end: Math.min(r.end, range.start), style: { ...r.style } });
      if (r.end > range.end)
        result.push({
          start: Math.max(r.start, range.end) + delta,
          end: r.end + delta,
          style: { ...r.style },
        });
    }
    if (inserted.length)
      result.push({
        start: range.start,
        end: range.start + inserted.length,
        style: { ...inherited },
      });
    // Replacement can join combining marks to neighboring graphemes. Normalize the
    // new boundaries by choosing the style at each new grapheme's first code unit.
    const normalized: TextRun[] = [];
    for (const g of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(next)) {
      const style = result.find((r) => r.start <= g.index && r.end > g.index)?.style ?? {};
      const last = normalized.at(-1),
        finish = g.index + g.segment.length;
      if (last && same(last.style, style)) last.end = finish;
      else normalized.push({ start: g.index, end: finish, style: { ...style } });
    }
    return {
      content: next,
      runs: canonicalTextRuns(next, normalized),
      start: range.start,
      end: range.start + inserted.length,
    };
  }
  type StyledLine = { start: number; end: number; width: number; spans: StyledSpan[] };
  type CanShapeTogether = (
    left: StyledSpan,
    right: StyledSpan,
    direction: 'ltr' | 'rtl',
  ) => boolean;
  function shapingRuns<T extends StyledSpan & { direction?: 'ltr' | 'rtl' }>(
    visual: readonly T[],
    join?: CanShapeTogether,
  ) {
    const groups: T[][] = [];
    for (const span of visual) {
      const group = groups.at(-1),
        previous = group?.at(-1),
        direction = span.direction;
      if (
        group && previous && direction && previous.direction === direction &&
        (direction === 'rtl' ? previous.start === span.end : previous.end === span.start) &&
        join?.(previous, span, direction)
      ) group.push(span);
      else groups.push([span]);
    }
    return groups.map(members => {
      const span = members[0];
      const logical = span.direction === 'rtl' && members.length > 1 ? [...members].reverse() : members;
      return { members, text: logical.map(member => member.text).join(''), span };
    });
  }
  /** Measure candidate line widths with the directional runs used for paint when available. */
  function layoutStyledText(
    content: string,
    runs: readonly TextRun[],
    width: number | undefined,
    measure: (text: string, style: TextStyle, direction?: 'ltr' | 'rtl') => number,
    resolve?: (line: StyledLine) => VisualSpan[],
    join?: CanShapeTogether,
  ): StyledLine[] {
    const spans = styledSpans(content, runs),
      lines: StyledLine[] = [];
    let work = 0;
    const pieces = (start: number, end: number) =>
      spans
        .filter((r) => r.start < end && r.end > start)
        .map((r) => {
          const a = Math.max(start, r.start),
            b = Math.min(end, r.end);
          return { ...r, start: a, end: b, text: content.slice(a, b) };
        });
    const length = (start: number, end: number, logical?: StyledSpan[]) => {
      work += end - start;
      if (work > 2000000) throw new Error('Rich text measurement budget exceeded.');
      const spans = logical ?? pieces(start, end);
      const runs: (StyledSpan & { direction?: 'ltr' | 'rtl' })[] = resolve
        ? resolve({ start, end, width: 0, spans })
        : join ? spans.map(span => ({ ...span, direction: 'ltr' as const })) : spans;
      const widthOf = (text: string, span: (typeof runs)[number]) => {
        const w = measure(text, span.style, span.direction);
        if (!Number.isFinite(w) || w < 0) throw new Error('Invalid text measurement.');
        return w;
      };
      return join
        ? shapingRuns(runs, join).reduce((sum, { text, span }) => sum + widthOf(text, span), 0)
        : runs.reduce((sum, span) => sum + widthOf(span.text, span), 0);
    };
    const push = (a: number, b: number) => {
      const spans = pieces(a, b);
      lines.push({ start: a, end: b, width: length(a, b, spans), spans });
    };
    const tokens = (paragraph: string) => {
      if (!resolve) return paragraph.match(/\s+|\S+/gu) ?? [];
      const grouped: string[] = [];
      let start = 0, previousSpace: boolean | undefined;
      // A whitespace character can anchor a combining grapheme. Tentative
      // wrap probes must use real grapheme boundaries as well as final lines.
      for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(paragraph)) {
        const space = /^\s+$/u.test(segment);
        if (previousSpace !== undefined && space !== previousSpace) {
          grouped.push(paragraph.slice(start, index));
          start = index;
        }
        previousSpace = space;
      }
      if (start < paragraph.length) grouped.push(paragraph.slice(start));
      return grouped;
    };
    let paragraphStart = 0;
    for (const paragraph of content.split(resolve ? /\r\n|\n/ : '\n')) {
      const end = paragraphStart + paragraph.length;
      const nextParagraph = end + (resolve && content.slice(end, end + 2) === '\r\n' ? 2 : 1);
      if (!width || !Number.isFinite(width) || width <= 0) {
        push(paragraphStart, end);
        paragraphStart = nextParagraph;
        continue;
      }
      let line = paragraphStart,
        cursor = paragraphStart;
      const before = lines.length;
      for (const token of tokens(paragraph)) {
        const tokenEnd = cursor + token.length;
        if (length(line, tokenEnd) > width) {
          if (cursor > line) {
            let trimmed = cursor;
            while (trimmed > line && /\s/u.test(content[trimmed - 1])) trimmed--;
            if (trimmed > line) push(line, trimmed);
            line = cursor;
          }
          if (/^\s+$/u.test(token)) {
            line = tokenEnd;
            cursor = tokenEnd;
            continue;
          }
          if (length(line, tokenEnd) > width) {
            const boundaries = [
              cursor,
              ...Array.from(
                new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(token),
                (g) => cursor + g.index + g.segment.length,
              ),
            ];
            let index = 0;
            while (index < boundaries.length - 1) {
              let low = index + 1,
                high = boundaries.length - 1;
              while (low < high) {
                const mid = Math.ceil((low + high) / 2);
                if (length(boundaries[index], boundaries[mid]) <= width) low = mid;
                else high = mid - 1;
              }
              if (low < boundaries.length - 1) push(boundaries[index], boundaries[low]);
              else line = boundaries[index];
              index = low;
            }
          }
        }
        cursor = tokenEnd;
      }
      if (line < end || lines.length === before) push(line, end);
      paragraphStart = nextParagraph;
    }
    return lines;
  }

  /** Reconcile a textarea replacement as one grapheme-aligned edit. */
  function reconcileStyledText(content: string, runs: readonly TextRun[], next: string) {
    if (content === next) return { content, runs: canonicalTextRuns(content, runs) };
    let prefix = 0;
    while (prefix < content.length && prefix < next.length && content[prefix] === next[prefix])
      prefix++;
    // Both sides need the same safe prefix; a new combining mark can extend it.
    const starts = (text: string) =>
      new Set([
        0,
        text.length,
        ...Array.from(
          new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
          (s) => s.index,
        ),
      ]);
    const oldBoundaries = starts(content),
      newBoundaries = starts(next);
    while (prefix > 0 && (!oldBoundaries.has(prefix) || !newBoundaries.has(prefix))) prefix--;
    let suffix = 0;
    while (
      suffix < content.length - prefix &&
      suffix < next.length - prefix &&
      content[content.length - 1 - suffix] === next[next.length - 1 - suffix]
    )
      suffix++;
    while (
      suffix > 0 &&
      (!oldBoundaries.has(content.length - suffix) || !newBoundaries.has(next.length - suffix))
    )
      suffix--;
    return replaceStyledRange(
      content,
      runs,
      prefix,
      content.length - suffix,
      next.slice(prefix, next.length - suffix),
    );
  }
  type RunMetrics = {
    width: number;
    /** Signed ink distances from the alphabetic baseline. */
    ascent: number;
    descent: number;
    fontAscent?: number;
    fontDescent?: number;
    left?: number;
    right?: number;
  };
  type VisualSpan = StyledSpan & { direction: 'ltr' | 'rtl' };
  type PositionedSpan = VisualSpan & {
    x: number;
    baseline: number;
    metrics: RunMetrics;
    shaped?: { text: string; x: number; metrics: RunMetrics; carets?: ReadonlyMap<number, number> };
    isolatedWidth?: number;
  };
  type PositionedLine = {
    start: number;
    end: number;
    width: number;
    top: number;
    baseline: number;
    height: number;
    spans: PositionedSpan[];
  };
  /** A visual resolver must return a lossless permutation of this line's logical spans.
   * Mixed-script shaping and bidi resolution belong to that resolver, never to string reversal.
   */
  function positionStyledLines(
    lines: readonly StyledLine[],
    options: {
      width: number;
      align: 'left' | 'center' | 'right';
      lineHeight: number;
      emptyAscent: number;
      emptyDescent: number;
    },
    measure: (text: string, style: TextStyle, direction: 'ltr' | 'rtl') => RunMetrics,
    resolve: (line: StyledLine) => VisualSpan[] = (line) => {
      if (
        line.spans.some((s) =>
          /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u202a-\u202e\u2066-\u2069]/u.test(s.text),
        )
      )
        throw new Error('Bidirectional text requires a visual run resolver.');
      return line.spans.map((s) => ({ ...s, direction: 'ltr' }));
    },
    join?: CanShapeTogether,
    contextual?: {
      includeCarets?: boolean;
      positions: (text: string, style: TextStyle, direction: 'ltr' | 'rtl',
        offsets: readonly number[], width: number) => readonly number[] | undefined;
    },
  ): PositionedLine[] {
    if (
      ![options.width, options.lineHeight, options.emptyAscent, options.emptyDescent].every(
        Number.isFinite,
      ) ||
      options.width < 0 ||
      options.lineHeight <= 0 ||
      options.emptyAscent < 0 ||
      options.emptyDescent < 0
    )
      throw new Error('Invalid rich text line metrics.');
    let top = 0;
    return lines.map((line) => {
      const visual = resolve({
        ...line,
        spans: line.spans.map((s) => ({ ...s, style: { ...s.style } })),
      });
      // A bidi resolver may split a style span into directional runs. Its logical
      // reconstruction must preserve every source unit, grapheme and style.
      const logical = [...visual].sort((a, b) => a.start - b.start);
      const lineText = line.spans.map((s) => s.text).join('');
      const boundaries = new Set([
        line.start,
        line.end,
        ...Array.from(
          new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(lineText),
          (s) => line.start + s.index,
        ),
      ]);
      let cursor = line.start;
      for (const span of logical) {
        if (
          span.start !== cursor ||
          span.end <= span.start ||
          !boundaries.has(span.start) ||
          !boundaries.has(span.end) ||
          !['ltr', 'rtl'].includes(span.direction)
        )
          throw new Error('Invalid visual text run mapping.');
        const expected = line.spans.filter((s) => s.start < span.end && s.end > span.start);
        const text = expected
          .map((s) =>
            s.text.slice(
              Math.max(span.start, s.start) - s.start,
              Math.min(span.end, s.end) - s.start,
            ),
          )
          .join('');
        if (text !== span.text || expected.some((s) => !same(s.style, span.style)))
          throw new Error('Invalid visual text run mapping.');
        cursor = span.end;
      }
      if (cursor !== line.end) throw new Error('Incomplete visual text run mapping.');
      const glyphMetrics = (text: string, span: VisualSpan) => {
        const raw = measure(text, { ...span.style }, span.direction);
        const metrics = { ...raw, left: raw.left ?? 0, right: raw.right ?? raw.width };
        if (
          !Object.values(metrics).every(Number.isFinite) ||
          metrics.width < 0 ||
          !Number.isFinite(metrics.ascent + metrics.descent) ||
          metrics.ascent + metrics.descent < 0 ||
          (metrics.fontAscent ?? 0) < 0 ||
          (metrics.fontDescent ?? 0) < 0
        )
          throw new Error('Invalid rich text glyph metrics.');
        return metrics;
      };
      const measured = shapingRuns(visual, join).map(({ text, span, members }) => ({
        text, members, metrics: glyphMetrics(text, span),
      }));
      const width = measured.reduce((n, r) => n + r.metrics.width, 0);
      // Keep each run's font height even when its ink is a raised quote,
      // a low underscore or whitespace. Overhanging glyphs can expand it.
      const ascent = Math.max(options.emptyAscent, ...measured.map(({ metrics }) =>
        Math.max(metrics.fontAscent ?? 0, metrics.ascent)));
      const descent = Math.max(options.emptyDescent, ...measured.map(({ metrics }) =>
        Math.max(metrics.fontDescent ?? 0, metrics.descent)));
      const height = (ascent + descent) * options.lineHeight;
      const baseline = top + (height - ascent - descent) / 2 + ascent;
      if (![width, height, baseline, top + height].every(Number.isFinite))
        throw new Error('Invalid rich text line metrics.');
      let x =
        options.align === 'left'
          ? 0
          : options.align === 'center'
            ? (options.width - width) / 2
            : options.width - width;
      const spans = measured.flatMap(({ members, text, metrics }): PositionedSpan[] => {
        const start = x;
        x += metrics.width;
        if (members.length === 1) {
          const span = members[0];
          return [{ ...span, style: { ...span.style }, x: start, baseline, metrics }];
        }
        const first = members[0], last = members[members.length - 1];
        const rtl = first.direction === 'rtl';
        const source = rtl ? last.start : first.start;
        const boundaries = contextual?.includeCarets
          ? [source, ...Array.from(
              new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
              g => source + g.index + g.segment.length,
            )]
          : [source, ...(rtl ? [...members].reverse() : members).map(span => span.end)];
        const positions = contextual?.positions(text, first.style, first.direction,
          boundaries.map(offset => offset - source), metrics.width);
        const carets = positions?.length === boundaries.length &&
          positions[0] === (rtl ? metrics.width : 0) && positions.at(-1) === (rtl ? 0 : metrics.width) &&
          positions.every((pos, i) => Number.isFinite(pos) && pos >= 0 && pos <= metrics.width &&
            (!i || (rtl ? pos <= positions[i - 1] : pos >= positions[i - 1])))
          ? new Map(boundaries.map((offset, i) => [offset, positions[i]])) : undefined;
        const shaped = { text, x: start, metrics, carets };
        const advances = carets ? [] : members.map(span => glyphMetrics(span.text, span).width);
        const total = advances.reduce((sum, advance) => sum + advance, 0);
        if (!Number.isFinite(total)) throw new Error('Invalid rich text glyph metrics.');
        // Canvas measures whole-run ink. Apportion its advance for source
        // ranges when the browser cannot expose contextual cluster positions.
        let offset = 0, left = start;
        return members.map((span, index) => {
          const isolatedWidth = advances[index] ?? 0;
          offset += isolatedWidth;
          const boundary = carets?.get(rtl ? span.start : span.end);
          const right = index === members.length - 1 ? x : start + (boundary ??
            metrics.width * (total ? offset / total : (index + 1) / members.length));
          const result = { ...span, style: { ...span.style }, x: left, baseline,
            metrics: { ...metrics, width: right - left }, shaped, isolatedWidth };
          left = right;
          return result;
        });
      });
      const result = { start: line.start, end: line.end, width, top, baseline, height, spans };
      top += height;
      return result;
    });
  }
  function styledInkBounds(lines: readonly PositionedLine[]) {
    const ink = lines.flatMap((l) => l.spans).filter((s) => s.text.trim().length)
      .map(s => s.shaped ? { ...s.shaped, baseline: s.baseline } : s);
    if (!ink.length) return null;
    return {
      left: Math.min(...ink.map((s) => s.x - (s.metrics.left ?? 0))),
      right: Math.max(...ink.map((s) => s.x + (s.metrics.right ?? s.metrics.width))),
      top: Math.min(...ink.map((s) => s.baseline - s.metrics.ascent)),
      bottom: Math.max(...ink.map((s) => s.baseline + s.metrics.descent)),
    };
  }

  function editStyledRange(
    content: string,
    runs: readonly TextRun[],
    start: number,
    end: number,
    action: 'uppercase' | 'lowercase' | 'duplicate' | 'delete',
  ) {
    const range = textRange(content, start, end),
      original = canonicalTextRuns(content, runs);
    const source = Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(content),
      (g) => ({
        text: g.segment,
        start: g.index,
        style: original.find((r) => r.start <= g.index && r.end > g.index)?.style ?? {},
      }),
    );
    const prefix = source.filter((g) => g.start < range.start),
      chosen = source.filter((g) => g.start >= range.start && g.start < range.end),
      suffix = source.filter((g) => g.start >= range.end);
    const selected = content.slice(range.start, range.end);
    let changed =
      action === 'duplicate'
        ? [...chosen, ...chosen]
        : action === 'delete'
          ? []
          : chosen.map((g) => ({
              ...g,
              text: action === 'uppercase' ? g.text.toUpperCase() : g.text.toLowerCase(),
            }));
    if (action === 'uppercase' || action === 'lowercase') {
      const correct = action === 'uppercase' ? selected.toUpperCase() : selected.toLowerCase();
      if (changed.reduce((n, g) => n + g.text.length, 0) !== correct.length)
        throw new Error('This case mapping cannot preserve text styles.');
      let offset = 0;
      changed = changed.map((g) => {
        const text = correct.slice(offset, offset + g.text.length);
        offset += g.text.length;
        return { ...g, text };
      });
    }
    const pieces = [...prefix, ...changed, ...suffix];
    let next = '';
    const mapped: TextRun[] = [];
    for (const piece of pieces) {
      const begin = next.length;
      next += piece.text;
      const last = mapped.at(-1);
      if (last && same(last.style, piece.style)) last.end = next.length;
      else mapped.push({ start: begin, end: next.length, style: { ...piece.style } });
    }
    if (next.length > 10000) throw new Error('Rich text complexity limit exceeded.');
    const normalized: TextRun[] = [];
    for (const g of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(next)) {
      const style = mapped.find((r) => r.start <= g.index && r.end > g.index)?.style ?? {},
        last = normalized.at(-1),
        end = g.index + g.segment.length;
      if (last && same(last.style, style)) last.end = end;
      else normalized.push({ start: g.index, end, style: { ...style } });
    }
    return {
      content: next,
      runs: canonicalTextRuns(next, normalized),
      start: range.start,
      end: range.start + changed.reduce((n, g) => n + g.text.length, 0),
    };
  }
  return {
    editStyledRange,
    canonicalTextRuns,
    styledSpans,
    formatTextRange,
    replaceStyledRange,
    layoutStyledText,
    reconcileStyledText,
    positionStyledLines,
    styledInkBounds,
  };
}
export const {
  editStyledRange,
  canonicalTextRuns,
  styledSpans,
  formatTextRange,
  replaceStyledRange,
  layoutStyledText,
  reconcileStyledText,
  positionStyledLines,
  styledInkBounds,
} = createRichTextRuntime();

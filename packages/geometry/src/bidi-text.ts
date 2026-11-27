import bidiFactory from 'bidi-js';
import type { BidiLevels } from 'bidi-js';
import { canonicalTextRuns, type StyledLine, type TextRun, type VisualSpan } from './rich-text';
export function createBidiTextRuntime(
  bidi: {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): BidiLevels;
    getReorderedIndices(text: string, levels: BidiLevels): number[];
    getBidiCharTypeName(char: string): string;
  },
  canonicalTextRuns: typeof import('./rich-text').canonicalTextRuns,
) {
  /** Resolve visual order without reversing stored text or splitting graphemes.
   * Canvas receives logical directional runs and performs glyph shaping/mirroring.
   */
  function createBidiResolver(content: string, direction: 'ltr' | 'rtl') {
    if (content.length > 10000) throw new Error('Rich text complexity limit exceeded.');
    const embedding = bidi.getEmbeddingLevels(content, direction);
    const graphemes = Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(content),
    );
    const paragraphBases = new Uint8Array(content.length);
    paragraphBases.fill(direction === 'rtl' ? 1 : 0);
    for (const paragraph of embedding.paragraphs)
      paragraphBases.fill(paragraph.level, paragraph.start, paragraph.end + 1);
    function clusterAt(offset: number) {
      let low = 0, high = graphemes.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (graphemes[middle].index < offset) low = middle + 1;
        else high = middle;
      }
      return low;
    }
    return (line: StyledLine): VisualSpan[] => {
      if (
        !Number.isInteger(line.start) ||
        !Number.isInteger(line.end) ||
        line.start < 0 ||
        line.end < line.start ||
        line.end > content.length
      )
        throw new Error('Invalid bidi line range.');
      if (line.start === line.end) return [];
      const local = content.slice(line.start, line.end);
      const levels = embedding.levels.slice(line.start, line.end);
      const base = paragraphBases[line.start];
      // Local offsets also avoid the dependency's nonzero-line-start trailing-space indexing issue.
      for (
        let i = local.length - 1;
        i >= 0 &&
        ['WS', 'S', 'B', 'BN', 'FSI', 'LRI', 'RLI', 'PDI'].includes(
          bidi.getBidiCharTypeName(local[i]),
        );
        i--
      )
        levels[i] = base;
      const order = bidi.getReorderedIndices(local, {
        levels,
        paragraphs: [{ start: 0, end: local.length - 1, level: base }],
      });
      const rank = new Map(order.map((index, position) => [index + line.start, position]));
      const first = clusterAt(line.start), last = clusterAt(line.end);
      if (graphemes[first]?.index !== line.start ||
          (last < graphemes.length && graphemes[last].index !== line.end))
        throw new Error('Bidi line splits a grapheme.');
      let spanIndex = 0;
      const clusters = graphemes.slice(first, last)
        .map((g) => {
          const end = g.index + g.segment.length;
          if (end > line.end) throw new Error('Bidi line splits a grapheme.');
          while (line.spans[spanIndex]?.end <= g.index) spanIndex++;
          const source = line.spans[spanIndex];
          if (!source || source.start > g.index || source.end < end)
            throw new Error('Invalid bidi style span.');
          const visualRank = Math.min(
            ...Array.from({ length: g.segment.length }, (_, i) => rank.get(g.index + i)!),
          );
          return {
            start: g.index,
            end,
            text: g.segment,
            style: { ...source.style },
            direction: (levels[g.index - line.start] & 1 ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
            rank: visualRank,
          };
        })
        .sort((a, b) => a.rank - b.rank);
      const result: VisualSpan[] = [];
      for (const g of clusters) {
        const last = result.at(-1);
        const contiguous =
          last && (g.direction === 'ltr' ? last.end === g.start : g.end === last.start);
        const identical =
          last &&
          [
            'bold',
            'italic',
            'font',
            'size',
            'color',
            'letterSpacing',
            'wordSpacing',
            'kerning',
          ].every(
            (k) => last.style[k as keyof typeof last.style] === g.style[k as keyof typeof g.style],
          );
        if (last && contiguous && identical && last.direction === g.direction) {
          last.start = Math.min(last.start, g.start);
          last.end = Math.max(last.end, g.end);
          last.text = content.slice(last.start, last.end);
        } else
          result.push({
            start: g.start,
            end: g.end,
            text: g.text,
            style: g.style,
            direction: g.direction,
          });
      }
      // Validate only this line's graphemes, even when wrapping probes the
      // paragraph repeatedly. The original line range is checked above.
      let cursor = line.start;
      const overrides: TextRun[] = [];
      for (const { start, end, style, text } of line.spans) {
        if (start !== cursor || end <= start || end > line.end || text !== content.slice(start, end))
          throw new Error('Invalid bidi style span.');
        if (Object.keys(style).length) overrides.push({ start: start - line.start, end: end - line.start, style });
        cursor = end;
      }
      if (cursor !== line.end) throw new Error('Incomplete bidi style mapping.');
      canonicalTextRuns(local, overrides);
      return result;
    };
  }

  return createBidiResolver;
}
export const createBidiResolver = createBidiTextRuntime(bidiFactory(), canonicalTextRuns);

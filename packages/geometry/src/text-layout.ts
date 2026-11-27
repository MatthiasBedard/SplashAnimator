/** Shared line breaking; measurement includes the active font and letter spacing. */
export function wrapText(
  content: string,
  width: number | undefined,
  measure: (text: string) => number,
): string[] {
  if (!width || !Number.isFinite(width) || width <= 0) return content.split('\n');
  const lines: string[] = [];
  for (const paragraph of content.split('\n')) {
    const paragraphStart = lines.length;
    let line = '';
    for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
      if (measure(line + token) <= width) {
        line += token;
        continue;
      }
      if (line) {
        if (line.trimEnd()) lines.push(line.trimEnd());
        line = '';
      }
      if (/^\s+$/u.test(token)) continue;
      if (measure(token) <= width) {
        line = token;
        continue;
      }
      const graphemes = [
        ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(token),
      ].map((s) => s.segment);
      for (let start = 0; start < graphemes.length;) {
        let low = 1,
          high = graphemes.length - start;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          if (measure(graphemes.slice(start, start + mid).join('')) <= width) low = mid;
          else high = mid - 1;
        }
        const part = graphemes.slice(start, start + low).join('');
        start += low;
        if (start < graphemes.length) lines.push(part);
        else line = part;
      }
    }
    if (line || lines.length === paragraphStart) lines.push(line);
  }
  return lines;
}

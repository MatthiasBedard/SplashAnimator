/** UTF-16 DOM offsets are expanded to whole graphemes before range edits. */
export function textRange(content: string, start: number, end: number) {
  if (![start, end].every(Number.isInteger) || start < 0 || end < start || end > content.length)
    throw new Error('Invalid text selection.');
  if (start === end) return { start, end };
  const boundaries = [0];
  for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(content))
    boundaries.push(segment.index + segment.segment.length);
  return {
    start: boundaries.filter((n) => n <= start).at(-1)!,
    end: boundaries.find((n) => n >= end)!,
  };
}
export type TextRangeAction = 'uppercase' | 'lowercase' | 'duplicate' | 'delete';
export function editTextRange(
  content: string,
  start: number,
  end: number,
  action: TextRangeAction,
) {
  const range = textRange(content, start, end);
  const selected = content.slice(range.start, range.end);
  const replacement =
    action === 'uppercase'
      ? selected.toUpperCase()
      : action === 'lowercase'
        ? selected.toLowerCase()
        : action === 'duplicate'
          ? selected + selected
          : '';
  const next = content.slice(0, range.start) + replacement + content.slice(range.end);
  if (next.length > 10000) throw new Error('Text is limited to 10,000 characters.');
  return { content: next, start: range.start, end: range.start + replacement.length };
}

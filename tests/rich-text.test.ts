import { editStyledRange } from '../packages/geometry/src/rich-text';
import {
  reconcileStyledText,
  positionStyledLines,
  styledInkBounds,
} from '../packages/geometry/src/rich-text';
import { describe, it, expect } from 'vitest';
import {
  canonicalTextRuns,
  formatTextRange,
  replaceStyledRange,
  styledSpans,
  layoutStyledText,
  type TextStyle,
} from '../packages/geometry/src/rich-text';
const measure = (text: string, style: TextStyle) => Array.from(text).length * (style.bold ? 2 : 1);
describe('rich text range foundation', () => {
  it('canonicalizes styles without mutating inputs and retains explicit false', () => {
    const runs = [
      { start: 2, end: 4, style: { bold: false } },
      { start: 0, end: 2, style: { bold: false } },
    ];
    expect(canonicalTextRuns('abcd', runs)).toEqual([{ start: 0, end: 4, style: { bold: false } }]);
    expect(runs[1].end).toBe(2);
    expect(styledSpans('abcdef', runs).map((r) => r.text)).toEqual(['abcd', 'ef']);
  });
  it('splits overlapping format edits, merges identical neighbors and clears overrides', () => {
    const first = formatTextRange('abcdef', [], 1, 5, { bold: true });
    const next = formatTextRange('abcdef', first, 3, 6, { italic: true });
    expect(next).toEqual([
      { start: 1, end: 3, style: { bold: true } },
      { start: 3, end: 5, style: { bold: true, italic: true } },
      { start: 5, end: 6, style: { italic: true } },
    ]);
    expect(formatTextRange('abcdef', next, 0, 6, { bold: undefined })).toEqual([
      { start: 3, end: 6, style: { italic: true } },
    ]);
    expect(first).toEqual([{ start: 1, end: 5, style: { bold: true } }]);
  });
  it('formats whole graphemes and rejects malformed ranges and styles', () => {
    expect(formatTextRange('A👩‍👩‍👧‍👦Z', [], 2, 4, { italic: true })).toEqual([
      { start: 1, end: 12, style: { italic: true } },
    ]);
    expect(() => canonicalTextRuns('AéZ', [{ start: 1, end: 2, style: { bold: true } }])).toThrow(
      'grapheme',
    );
    expect(() =>
      canonicalTextRuns('abc', [
        { start: 0, end: 2, style: { bold: true } },
        { start: 1, end: 3, style: { italic: true } },
      ]),
    ).toThrow();
    expect(() => formatTextRange('abc', [], 0, 1, { size: Infinity })).toThrow('style');
    expect(() => formatTextRange('abc', [], 0, 1, { color: 'red' })).toThrow('style');
  });
  it('replaces text with inherited style and shifts surviving ranges', () => {
    const runs = [
      { start: 0, end: 3, style: { bold: true } },
      { start: 4, end: 6, style: { italic: true } },
    ];
    expect(replaceStyledRange('abc def', runs, 1, 5, 'XYZ')).toEqual({
      content: 'aXYZef',
      start: 1,
      end: 4,
      runs: [
        { start: 0, end: 4, style: { bold: true } },
        { start: 4, end: 5, style: { italic: true } },
      ],
    });
    expect(replaceStyledRange('abc', runs.slice(0, 1), 0, 3, '')).toEqual({
      content: '',
      start: 0,
      end: 0,
      runs: [],
    });
  });
  it('inserts at a safe boundary and reconciles newly combined graphemes', () => {
    expect(replaceStyledRange('A👩‍👩‍👧‍👦Z', [], 3, 3, '!').content).toBe('A!👩‍👩‍👧‍👦Z');
    const result = replaceStyledRange(
      'ab',
      [{ start: 0, end: 1, style: { bold: true } }],
      1,
      1,
      '́',
    );
    expect(result.content).toBe('áb');
    expect(result.runs).toEqual([{ start: 0, end: 2, style: { bold: true } }]);
    expect(() => replaceStyledRange('x'.repeat(10000), [], 1, 1, 'x')).toThrow('limit');
  });
  it('wraps measured style spans and retains logical source offsets', () => {
    const lines = layoutStyledText(
      'aa bb cc',
      [{ start: 3, end: 5, style: { bold: true } }],
      5,
      measure,
    );
    expect(lines.map((l) => l.spans.map((r) => r.text).join(''))).toEqual(['aa', 'bb', 'cc']);
    expect(lines.map((l) => l.width)).toEqual([2, 4, 2]);
    expect(lines.map((l) => [l.start, l.end])).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
  });
  it('preserves explicit empty lines and long-token graphemes with bounded measurement', () => {
    expect(
      layoutStyledText('a\n\nb', [], undefined, measure).map((l) =>
        l.spans.map((r) => r.text).join(''),
      ),
    ).toEqual(['a', '', 'b']);
    const lines = layoutStyledText('👩‍👩‍👧‍👦ab', [], 1, () => 1);
    expect(lines[0].spans[0].text).toBe('👩‍👩‍👧‍👦ab');
    const chars = layoutStyledText(
      'ééé',
      [],
      1,
      (s) =>
        Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)).length,
    );
    expect(chars.map((l) => l.spans.map((r) => r.text).join(''))).toEqual(['é', 'é', 'é']);
    expect(() => layoutStyledText('a', [], 1, () => NaN)).toThrow('measurement');
  });
});

it('keeps canonical run invariants through a sequence of edits', () => {
  let content = 'alpha beta gamma';
  let runs = formatTextRange(content, [], 0, 5, { bold: true });
  for (let i = 0; i < 60; i++) {
    const start = i % (content.length + 1),
      end = Math.min(content.length, start + (i % 4));
    const edit = replaceStyledRange(content, runs, start, end, i % 3 === 0 ? 'xy' : 'z');
    content = edit.content;
    runs = edit.runs;
    if (content.length)
      runs = formatTextRange(content, runs, 0, Math.min(3, content.length), {
        italic: i % 2 === 0,
      });
    expect(canonicalTextRuns(content, runs)).toEqual(runs);
    expect(
      styledSpans(content, runs)
        .map((r) => r.text)
        .join(''),
    ).toBe(content);
  }
});

it('reconciles textarea changes without losing surviving styles or splitting graphemes', () => {
  const runs = [
    { start: 0, end: 3, style: { bold: true } },
    { start: 4, end: 7, style: { italic: true } },
  ];
  const result = reconcileStyledText('abc def', runs, 'abXYZc def');
  expect(result.content).toBe('abXYZc def');
  expect(result.runs).toEqual([
    { start: 0, end: 6, style: { bold: true } },
    { start: 7, end: 10, style: { italic: true } },
  ]);
  expect(
    reconcileStyledText('ab', [{ start: 0, end: 1, style: { bold: true } }], 'áb').runs,
  ).toEqual([{ start: 0, end: 2, style: { bold: true } }]);
  expect(reconcileStyledText('A👩‍👩‍👧‍👦Z', [], 'A👩‍👧Z').content).toBe('A👩‍👧Z');
});
it('positions mixed font metrics on shared baselines with physical alignment', () => {
  const lines = layoutStyledText(
    'ab\nc',
    [{ start: 1, end: 2, style: { size: 40 } }],
    undefined,
    () => 10,
  );
  const positioned = positionStyledLines(
    lines,
    { width: 100, align: 'center', lineHeight: 1.2, emptyAscent: 8, emptyDescent: 2 },
    (_, s) => ({
      width: 10,
      ascent: s.size ? 30 : 8,
      descent: s.size ? 10 : 2,
      left: 2,
      right: 12,
    }),
  );
  expect(positioned[0].height).toBe(48);
  expect(positioned[0].spans.map((s) => s.x)).toEqual([40, 50]);
  expect(positioned[0].spans.map((s) => s.baseline)).toEqual([34, 34]);
  expect(positioned[1].top).toBe(48);
  expect(styledInkBounds(positioned)).toEqual({ left: 38, right: 62, top: 4, bottom: 59 });
});
it('requires a lossless visual resolver for bidi without reversing logical text', () => {
  const lines = layoutStyledText(
    'אבגד',
    [{ start: 0, end: 2, style: { bold: true } }],
    undefined,
    measure,
  );
  const options = {
    width: 100,
    align: 'right' as const,
    lineHeight: 1,
    emptyAscent: 8,
    emptyDescent: 2,
  };
  const metric = () => ({ width: 20, ascent: 8, descent: 2 });
  expect(() => positionStyledLines(lines, options, metric)).toThrow('resolver');
  const positioned = positionStyledLines(lines, options, metric, (l) =>
    [...l.spans].reverse().map((s) => ({ ...s, direction: 'rtl' })),
  );
  expect(positioned[0].spans.map((s) => [s.text, s.x])).toEqual([
    ['גד', 60],
    ['אב', 80],
  ]);
  expect(lines[0].spans[0].text).toBe('אב');
  expect(() =>
    positionStyledLines(lines, options, metric, (l) =>
      l.spans.slice(1).map((s) => ({ ...s, direction: 'rtl' })),
    ),
  ).toThrow();
  expect(() =>
    positionStyledLines(lines, options, metric, (l) =>
      [...l.spans, l.spans[0]].map((s) => ({ ...s, direction: 'rtl' })),
    ),
  ).toThrow('Invalid');
});
it('uses the joined advance and ink while keeping visual color spans mapped to the source', () => {
  const content = 'سلام';
  const runs = [{ start: 2, end: 4, style: { color: '#0000ff' } }];
  const visual = (line: ReturnType<typeof layoutStyledText>[number]) =>
    [...line.spans].reverse().map(span => ({ ...span, direction: 'rtl' as const }));
  const advance = (text: string) => text === content ? 88 : text.length * 24;
  const lines = layoutStyledText(content, runs, 91, advance, visual, () => true);
  expect(lines.map(line => line.width)).toEqual([88]);
  const position = (contextual?: Parameters<typeof positionStyledLines>[5]) =>
    positionStyledLines(
      lines,
      { width: 100, align: 'right', lineHeight: 1, emptyAscent: 8, emptyDescent: 2 },
      text => ({ width: advance(text), ascent: 8, descent: 2, left: 3, right: advance(text) + 2 }),
      visual,
      () => true,
      contextual,
    );
  const positioned = position();
  const [blue, inherited] = positioned[0].spans;
  expect(blue).toMatchObject({ start: 2, end: 4, x: 12, metrics: { width: 44 }, style: runs[0].style });
  expect(inherited).toMatchObject({ start: 0, end: 2, x: 56, metrics: { width: 44 }, style: {} });
  expect(blue.shaped).toBe(inherited.shaped);
  expect(blue.shaped?.text).toBe(content);
  expect(styledInkBounds(positioned)).toEqual({ left: 9, right: 102, top: 0, bottom: 10 });
  expect(layoutStyledText(content, runs, 91, advance, visual).map(line => line.width)).toEqual([72, 24]);
  const precise = position({
    includeCarets: true,
    positions(text, _, direction, offsets, width) {
      expect([text, direction, offsets, width]).toEqual([content, 'rtl', [0, 1, 2, 3, 4], 88]);
      return [88, 56, 38, 20, 0];
    },
  });
  expect(precise[0].spans.map(span => [span.x, span.metrics.width])).toEqual([[12, 38], [50, 50]]);
  expect(precise[0].spans[0].shaped?.carets?.get(3)).toBe(20);
  expect(styledInkBounds(precise)).toEqual(styledInkBounds(positioned));
  for (const positions of [[88, 37, 0], [88, 90, 0], [88, NaN, 0], [88, 37, 1]]) {
    const actual = position({ positions: () => positions });
    expect(actual[0].spans[0].metrics.width).toBe(positions[1] === 37 && positions[2] === 0 ? 37 : 44);
  }
});
it('keeps empty line height and rejects invalid metric callbacks', () => {
  const lines = layoutStyledText('\n', [], undefined, measure);
  const options = {
    width: 100,
    align: 'left' as const,
    lineHeight: 1,
    emptyAscent: 8,
    emptyDescent: 2,
  };
  expect(
    positionStyledLines(lines, options, () => ({ width: 0, ascent: 0, descent: 0 })).map(
      (l) => l.height,
    ),
  ).toEqual([10, 10]);
  expect(
    styledInkBounds(
      positionStyledLines(lines, options, () => ({ width: 0, ascent: 0, descent: 0 })),
    ),
  ).toBeNull();
  expect(() =>
    positionStyledLines(layoutStyledText('a', [], undefined, measure), options, () => ({
      width: NaN,
      ascent: 1,
      descent: 1,
    })),
  ).toThrow('metrics');
});

it('uses font height with signed ink on either side of the baseline', () => {
  const lines = layoutStyledText('"\n_', [], undefined, () => 10);
  const options = { width: 30, align: 'left' as const, lineHeight: 1, emptyAscent: 8, emptyDescent: 2 };
  const positioned = positionStyledLines(lines, options, text => ({
    width: 10, fontAscent: 20, fontDescent: 5,
    ascent: text === '"' ? 17 : -2,
    descent: text === '"' ? -12 : 4,
  }));
  expect(positioned.map(({ top, baseline, height }) => [top, baseline, height]))
    .toEqual([[0, 20, 25], [25, 45, 25]]);
  expect(styledInkBounds(positioned)).toEqual({ left: 0, right: 10, top: 3, bottom: 49 });
  expect(() => positionStyledLines(lines, options, () => ({
    width: 10, ascent: 2, descent: -3,
  }))).toThrow('Invalid rich text glyph metrics');
});

it('preserves individual styles through duplication and length-changing case edits', () => {
  const runs = [
    { start: 0, end: 1, style: { bold: true } },
    { start: 1, end: 2, style: { italic: true } },
  ];
  const upper = editStyledRange('aß', runs, 0, 2, 'uppercase');
  expect(upper.content).toBe('ASS');
  expect(upper.runs).toEqual([
    { start: 0, end: 1, style: { bold: true } },
    { start: 1, end: 3, style: { italic: true } },
  ]);
  expect(editStyledRange('aß', runs, 0, 2, 'duplicate').runs).toEqual([
    ...runs,
    { start: 2, end: 3, style: { bold: true } },
    { start: 3, end: 4, style: { italic: true } },
  ]);
  expect(
    editStyledRange('ΟΣ', [{ start: 1, end: 2, style: { bold: true } }], 0, 2, 'lowercase').content,
  ).toBe('ος');
});

it('range spacing retains zero overrides and validates finite bounded values', () => {
  const runs = formatTextRange('ab cd', [], 0, 2, {
    letterSpacing: 0,
    wordSpacing: 12,
    kerning: 'none',
    bold: true,
  });
  expect(replaceStyledRange('ab cd', runs, 1, 1, 'X').runs[0].style).toEqual(runs[0].style);
  expect(
    formatTextRange('ab cd', runs, 0, 2, {
      letterSpacing: undefined,
      wordSpacing: undefined,
      kerning: undefined,
    }),
  ).toEqual([{ start: 0, end: 2, style: { bold: true } }]);
  for (const patch of [
    { letterSpacing: NaN },
    { letterSpacing: 101 },
    { wordSpacing: Infinity },
    { wordSpacing: -1001 },
    { kerning: 'invalid' },
  ])
    expect(() => formatTextRange('ab', [], 0, 2, patch as TextStyle)).toThrow('style');
  expect(
    canonicalTextRuns('abcd', [
      { start: 0, end: 2, style: { letterSpacing: 0 } },
      { start: 2, end: 4, style: { letterSpacing: 2 } },
    ]),
  ).toHaveLength(2);
});

import { it, expect } from 'vitest';
import { createBidiResolver } from '../packages/geometry/src/bidi-text';
import { layoutStyledText, positionStyledLines } from '../packages/geometry/src/rich-text';
const layout = (s: string) => layoutStyledText(s, [], undefined, (t) => t.length);
it('splits a single style into logical directional runs and reorders Hebrew and numbers', () => {
  const text = 'abc אבג 123';
  const result = createBidiResolver(text, 'ltr')(layout(text)[0]);
  expect(result.map((s) => [s.text, s.direction])).toEqual([
    ['abc ', 'ltr'],
    ['123', 'ltr'],
    ['אבג ', 'rtl'],
  ]);
  expect(
    [...result]
      .sort((a, b) => a.start - b.start)
      .map((s) => s.text)
      .join(''),
  ).toBe(text);
});
it('positions resolver fragments while preserving styles and graphemes', () => {
  const text = 'אב 👩‍👩‍👧‍👦 ab';
  const runs = [{ start: 0, end: 2, style: { bold: true } }];
  const lines = layoutStyledText(text, runs, undefined, (t) => t.length);
  const result = positionStyledLines(
    lines,
    { width: 100, align: 'right', lineHeight: 1, emptyAscent: 8, emptyDescent: 2 },
    (t) => ({ width: t.length, ascent: 8, descent: 2 }),
    createBidiResolver(text, 'rtl'),
  );
  expect(result[0].spans.some((s) => s.text.includes('👩‍👩‍👧‍👦'))).toBe(true);
  expect(result[0].spans.find((s) => s.text === 'אב')!.style.bold).toBe(true);
  expect(
    [...result[0].spans]
      .sort((a, b) => a.start - b.start)
      .map((s) => s.text)
      .join(''),
  ).toBe(text);
});
it('handles wrapped nonzero offsets and trailing spaces with paragraph direction', () => {
  const text = 'abc אבג 123   ';
  const whole = layout(text)[0];
  const line = {
    start: 4,
    end: text.length,
    width: 10,
    spans: [{ ...whole.spans[0], start: 4, text: text.slice(4) }],
  };
  const result = createBidiResolver(text, 'ltr')(line);
  expect(result.at(-1)!.text).toBe('   ');
  expect(result.at(-1)!.direction).toBe('ltr');
});
it('keeps isolates controls and combining marks in logical reconstruction', () => {
  const text = 'A ⁧אב 12⁩ é';
  const result = createBidiResolver(text, 'ltr')(layout(text)[0]);
  expect(
    [...result]
      .sort((a, b) => a.start - b.start)
      .map((s) => s.text)
      .join(''),
  ).toBe(text);
  expect(result.some((s) => s.text.includes('é'))).toBe(true);
});

it('keeps adjacent spacing-only styles distinct during visual run merging', () => {
  const content = 'ab cd';
  const lines = layoutStyledText(
    content,
    [
      { start: 0, end: 2, style: { letterSpacing: 0 } },
      { start: 2, end: 5, style: { letterSpacing: 3 } },
    ],
    undefined,
    (t) => t.length,
  );
  const visual = createBidiResolver(content, 'ltr')(lines[0]);
  expect(visual.map((s) => [s.text, s.style.letterSpacing])).toEqual([
    ['ab', 0],
    [' cd', 3],
  ]);
});

it('wraps with the same directional widths used by positioned rich runs', () => {
  const content = 'L אב 12';
  const resolve = createBidiResolver(content, 'ltr');
  const measure = (text: string, _style: unknown, direction?: 'ltr' | 'rtl') =>
    text.length * (direction === 'rtl' ? 3 : 1);
  const lines = layoutStyledText(content, [{ start: 0, end: 1, style: { bold: true } }], 9, measure, resolve);
  expect(lines.map(line => [content.slice(line.start, line.end), line.width])).toEqual([
    ['L אב', 8],
    ['12', 2],
  ]);
  const placed = positionStyledLines(
    lines, { width: 9, align: 'left', lineHeight: 1, emptyAscent: 8, emptyDescent: 2 },
    (text, style, direction) => ({ width: measure(text, style, direction), ascent: 8, descent: 2 }),
    resolve,
  );
  expect(placed.map(line => line.width)).toEqual(lines.map(line => line.width));
  const combining = 'L \u0301אב 12';
  expect(() => layoutStyledText(combining, [], 9, measure, createBidiResolver(combining, 'ltr')))
    .not.toThrow();
  const paragraphs = 'L\r\nאב';
  expect(layoutStyledText(paragraphs, [], 9, measure, createBidiResolver(paragraphs, 'ltr'))
    .map(line => [line.start, line.end])).toEqual([[0, 1], [3, 5]]);
});

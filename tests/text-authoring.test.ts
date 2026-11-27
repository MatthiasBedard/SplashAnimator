import { describe, it, expect } from 'vitest';
import type { Vector } from '../packages/document/src';
import {
  measureTextField,
  replaceTextContent,
  textFieldLayout,
  textCaret,
  textOffsetAt,
  textSelectionRects,
  textWordRange,
  textFormatting,
  textObjectProperties,
  replaceTextSelection,
} from '../apps/editor/src/text-authoring';

function context() {
  let calls = 0;
  const ctx = {
    font: '',
    save() {},
    restore() {},
    measureText(text: string) {
      calls++;
      return {
        width: Array.from(text).length * 10,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
        fontBoundingBoxAscent: 9,
        fontBoundingBoxDescent: 3,
      };
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls: () => calls };
}
const field = (content = 'hello world'): Vector => ({
  id: 'text',
  kind: 'text',
  x: 150,
  y: 75,
  width: 110,
  height: 24,
  rotation: 0,
  transform: [-1, 0.2, 0.4, 1],
  fill: '#e00000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
  text: { content, font: 'Arial', size: 20, bold: false, italic: false, align: 'left' },
});
describe('text field authoring uses original content and Canvas source offsets', () => {
  it('auto width and fixed wrapping preserve affine geometry, paint and unchanged source', () => {
    const { ctx } = context(),
      source = field(),
      before = structuredClone(source),
      auto = replaceTextContent(ctx, source, 'a longer line'),
      wrapped = structuredClone(source);
    wrapped.text!.wrapWidth = 60;
    const output = measureTextField(ctx, wrapped);
    expect(auto.width).toBe(130);
    expect(output.width).toBe(60);
    expect(output.height).toBe(48);
    expect(auto.transform).toEqual(source.transform);
    expect(auto.x).toBe(source.x);
    expect(auto.fill).toBe(source.fill);
    expect(source).toEqual(before);
    auto.transform![0] = 10;
    expect(source).toEqual(before);
  });
  for (const align of ['left', 'center', 'right'] as const)
    it(`${align} caret, hit and selected rectangles agree on independent fixed-width positions`, () => {
      const { ctx } = context(),
        shape = field('abc');
      shape.width = 100;
      shape.text!.align = align;
      const lines = textFieldLayout(ctx, shape),
        left = align === 'left' ? 0 : align === 'center' ? 35 : 70;
      expect(textCaret(ctx, shape, lines, 2).x).toBe(left + 20);
      expect(textOffsetAt(ctx, shape, lines, { x: left + 18, y: 10 })).toBe(2);
      expect(textSelectionRects(ctx, shape, lines, 0, 2)).toEqual([
        { x: left, y: 0, width: 20, height: 24 },
      ]);
    });
  it('empty and explicit newline positions remain actionable', () => {
    const { ctx } = context(),
      shape = field('a\n\nb'),
      lines = textFieldLayout(ctx, shape);
    expect(lines.map((l) => [l.start, l.end])).toEqual([
      [0, 1],
      [2, 2],
      [3, 4],
    ]);
    expect(textCaret(ctx, shape, lines, 2)).toEqual({ x: 0, y: 24, height: 24 });
    expect(textOffsetAt(ctx, shape, lines, { x: 100, y: 25 })).toBe(2);
    expect(measureTextField(ctx, field('')).width).toBe(1);
  });
  it('wraps a Latin pair using kerning across a color change and honors typography overrides', () => {
    const { ctx } = context();
    const measure = ctx.measureText.bind(ctx);
    ctx.measureText = text => ({
      ...measure(text),
      width: text === 'AV' && ctx.fontKerning !== 'none' ? 90 : text.length * 48,
    });
    const shape = field('AV');
    shape.text!.wrapWidth = 93;
    shape.text!.runs = [{ start: 1, end: 2, style: { color: '#0000ff' } }];
    expect(textFieldLayout(ctx, shape).map(line => line.width)).toEqual([90]);
    shape.text!.kerning = 'none';
    expect(textFieldLayout(ctx, shape).map(line => line.width)).toEqual([48, 48]);
    shape.text!.kerning = 'normal';
    shape.text!.runs[0].style.size = 25;
    expect(textFieldLayout(ctx, shape).map(line => line.width)).toEqual([48, 48]);
  });
  it('insertion keeps original rich ranges and normalizes CRLF without mutating them', () => {
    const { ctx } = context(),
      shape = field('hello world');
    shape.text!.runs = [{ start: 6, end: 11, style: { bold: true, color: '#0000ff' } }];
    const original = structuredClone(shape),
      out = replaceTextContent(
        ctx,
        replaceTextContent(ctx, shape, 'Hi hello world'),
        'Hi hello world\r\nnext',
      );
    expect(out.text!.content).toBe('Hi hello world\nnext');
    expect(out.text!.runs).toContainEqual({
      start: 9,
      end: 14,
      style: { bold: true, color: '#0000ff' },
    });
    expect(shape).toEqual(original);
  });
  it('grapheme-safe hits and highlights do not split surrogate or combining sequences', () => {
    const { ctx } = context(),
      shape = field('a👩‍💻éz'),
      lines = textFieldLayout(ctx, shape);
    for (let x = 0; x <= 90; x++)
      expect([0, 1, 6, 8, 9]).toContain(textOffsetAt(ctx, shape, lines, { x, y: 5 }));
    expect(textSelectionRects(ctx, shape, lines, 2, 3)[0].width).toBe(30);
  });
  it('long-line pointer lookup uses logarithmic measured prefixes rather than every growing prefix', () => {
    const { ctx, calls } = context(),
      shape = field('a'.repeat(10000)),
      lines = textFieldLayout(ctx, shape),
      before = calls();
    expect(textOffsetAt(ctx, shape, lines, { x: 65342, y: 10 })).toBe(6534);
    expect(calls() - before).toBeLessThan(25);
  });
  for (const content of ['hello world', 'café words', '你好 世界'])
    it(`word selection respects Unicode segmentation in ${content}`, () => {
      const range = textWordRange(content, 1);
      expect(range.start).toBe(0);
      expect(range.end).toBeGreaterThan(1);
    });
  for (const content of ['a'.repeat(10001), 'x'.repeat(100000)])
    it(`oversized ${content.length}-unit input is rejected without source writes`, () => {
      const { ctx } = context(),
        shape = field(),
        before = structuredClone(shape);
      expect(() => replaceTextContent(ctx, shape, content)).toThrow('10,000');
      expect(shape).toEqual(before);
    });
  it('overflowed measured dimensions are rejected atomically', () => {
    const { ctx } = context(),
      shape = field('abcdef');
    shape.text!.scaleX = 10000;
    expect(() => measureTextField(ctx, shape)).toThrow('geometry');
    expect(shape.width).toBe(110);
  });
});

describe('caret and character formatting ownership', () => {
  it('reads preceding character at a caret, selected styles and mixed values independently', () => {
    const shape = field('abcd');
    shape.text!.runs = [{ start: 1, end: 3, style: { size: 40, bold: true, color: '#0000ff' } }];
    expect(textFormatting(shape, 0)).toMatchObject({ size: 20, bold: false, color: '#e00000' });
    expect(textFormatting(shape, 1)).toMatchObject({ size: 20, bold: false });
    expect(textFormatting(shape, 2)).toMatchObject({ size: 40, bold: true, color: '#0000ff' });
    expect(textFormatting(shape, 1, 3)).toMatchObject({ size: 40, bold: true });
    expect(textFormatting(shape, 0, 4)).toMatchObject({ font: 'Arial' });
    expect(textFormatting(shape, 0, 4).size).toBeUndefined();
    expect(textFormatting(shape, 0, 4).bold).toBeUndefined();
  });
  it('pending caret styles override only future insertion and can return to inherited defaults', () => {
    const { ctx } = context(),
      shape = field('abc'),
      before = structuredClone(shape);
    shape.text!.runs = [{ start: 0, end: 3, style: { bold: true } }];
    const out = replaceTextSelection(ctx, shape, 1, 1, 'X', {
      size: 30,
      bold: false,
      color: '#0000ff',
    });
    expect(out.text!.content).toBe('aXbc');
    expect(textFormatting(out, 1, 2)).toMatchObject({ size: 30, bold: false, color: '#0000ff' });
    expect(textFormatting(out, 0, 1).bold).toBe(true);
    expect(textFormatting(out, 2, 4).bold).toBe(true);
    expect(shape.text!.content).toBe(before.text!.content);
    expect(shape.text!.size).toBe(20);
    expect(out.transform).toEqual(shape.transform);
  });
  for (const inserted of ['X', 'XY', 'longer text'])
    it(`replacement with ${inserted.length} units preserves first-selected style and outside ranges`, () => {
      const { ctx } = context(),
        shape = field('hello world');
      shape.text!.runs = [{ start: 6, end: 11, style: { italic: true, size: 30 } }];
      const before = structuredClone(shape),
        out = replaceTextSelection(ctx, shape, 6, 11, inserted);
      expect(out.text!.content).toBe('hello ' + inserted);
      expect(textFormatting(out, 6, 6 + inserted.length)).toMatchObject({ italic: true, size: 30 });
      expect(textFormatting(out, 0, 5)).toMatchObject({ italic: false, size: 20 });
      expect(shape).toEqual(before);
    });
  it('repeated characters use the actual selected replacement rather than an ambiguous string diff', () => {
    const { ctx } = context(),
      shape = field('aaaa');
    shape.text!.runs = [{ start: 1, end: 2, style: { bold: true } }];
    const out = replaceTextSelection(ctx, shape, 1, 2, 'aa');
    expect(textFormatting(out, 1, 3).bold).toBe(true);
    expect(textFormatting(out, 3, 5).bold).toBe(false);
  });
  it('default typing creates no redundant character override runs', () => {
    const { ctx } = context(),
      shape = field('abc'),
      out = replaceTextSelection(ctx, shape, 3, 3, 'd');
    expect(out.text!.runs).toEqual([]);
  });
  it('styled replacement remains grapheme safe and rejects invalid ranges/oversized output without mutation', () => {
    const { ctx } = context(),
      shape = field('a👩‍💻z'),
      before = structuredClone(shape);
    expect(replaceTextSelection(ctx, shape, 2, 3, 'X').text!.content).toBe('aXz');
    expect(() => replaceTextSelection(ctx, shape, -1, 3, 'X')).toThrow();
    expect(() => replaceTextSelection(ctx, shape, 0, 0, 'x'.repeat(10001))).toThrow();
    expect(shape).toEqual(before);
  });
});

it('typing keeps inherited gradient paint distinct from an explicit black character override', () => {
  const { ctx } = context(),
    shape = field('abcd');
  shape.gradient = {
    kind: 'linear',
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    stops: [
      { offset: 0, color: '#e00000' },
      { offset: 1, color: '#0000ff' },
    ],
  };
  shape.text!.runs = [{ start: 1, end: 3, style: { color: '#000000' } }];
  expect(textFormatting(shape, 0).color).toBeUndefined();
  expect(textFormatting(shape, 2).color).toBe('#000000');
  const inherited = replaceTextSelection(ctx, shape, 0, 0, 'X');
  expect(inherited.text!.runs![0]).toEqual({ start: 2, end: 4, style: { color: '#000000' } });
  const explicit = replaceTextSelection(ctx, shape, 2, 2, 'X');
  expect(explicit.text!.runs![0]).toEqual({ start: 1, end: 4, style: { color: '#000000' } });
  expect(explicit.gradient).toEqual(shape.gradient);
});

it('whole-field attributes replace their matching run overrides and preserve unrelated character formatting', () => {
  const t = field().text!;
  t.runs = [
    { start: 0, end: 3, style: { size: 48, bold: true, color: '#0000ff' } },
    { start: 6, end: 11, style: { size: 24, italic: true } },
  ];
  const before = structuredClone(t);
  const out = textObjectProperties(t, { size: 36 });
  expect(out.size).toBe(36);
  expect(out.runs).toEqual([
    { start: 0, end: 3, style: { bold: true, color: '#0000ff' } },
    { start: 6, end: 11, style: { italic: true } },
  ]);
  expect(t).toEqual(before);
  const plain = textObjectProperties(out, { bold: false });
  expect(plain.runs![0].style).toEqual({ color: '#0000ff' });
});

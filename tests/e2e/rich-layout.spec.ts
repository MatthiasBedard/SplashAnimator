import { test, expect } from '@playwright/test';

test('prototype mixed-font baseline bounds contain actual Canvas ink', async ({ page }) => {
  await page.goto('/');
  const modulePath =
    '/@fs/' + process.cwd().replaceAll('\\', '/') + '/packages/geometry/src/rich-text.ts';
  const result = await page.evaluate(async (path) => {
    const rich = await import(/* @vite-ignore */ path);
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    type Style = { size?: number; bold?: boolean; italic?: boolean };
    const configure = (s: Style) => {
      ctx.font = `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${s.size ?? 24}px Arial`;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
    };
    const content = 'Small LARGE\nItalic tail';
    const runs = [
      { start: 6, end: 11, style: { size: 60, bold: true } },
      { start: 12, end: 18, style: { italic: true, size: 36 } },
    ];
    const measure = (text: string, s: Style) => {
      configure(s);
      return ctx.measureText(text);
    };
    const logical = rich.layoutStyledText(
      content,
      runs,
      500,
      (text: string, s: Style) => measure(text, s).width,
    );
    const positioned = rich.positionStyledLines(
      logical,
      { width: 500, align: 'center', lineHeight: 1.2, emptyAscent: 18, emptyDescent: 6 },
      (text: string, s: Style) => {
        const m = measure(text, s);
        return {
          width: m.width,
          ascent: m.actualBoundingBoxAscent,
          descent: m.actualBoundingBoxDescent,
          left: m.actualBoundingBoxLeft,
          right: m.actualBoundingBoxRight,
        };
      },
    );
    const bounds = rich.styledInkBounds(positioned);
    ctx.fillStyle = '#000000';
    for (const line of positioned)
      for (const span of line.spans) {
        configure(span.style);
        ctx.fillText(span.text, span.x + 20, span.baseline + 20);
      }
    const pixels = ctx.getImageData(0, 0, 600, 300).data;
    let outside = 0,
      ink = 0;
    for (let y = 0; y < 300; y++)
      for (let x = 0; x < 600; x++)
        if (pixels[(y * 600 + x) * 4 + 3] > 128) {
          ink++;
          if (
            x < bounds.left + 18 ||
            x > bounds.right + 22 ||
            y < bounds.top + 18 ||
            y > bounds.bottom + 22
          )
            outside++;
        }
    return {
      outside,
      ink,
      lines: positioned.length,
      baseline: positioned[0].spans.map((s: { baseline: number }) => s.baseline),
    };
  }, modulePath);
  expect(result.lines).toBe(2);
  expect(new Set(result.baseline).size).toBe(1);
  expect(result.ink).toBeGreaterThan(1000);
  expect(result.outside).toBe(0);
});

for (const direction of ['ltr', 'rtl'] as const)
  test(`prototype bidi Canvas runs agree with native ${direction} line rendering`, async ({
    page,
  }) => {
    await page.goto('/');
    const path = '/@fs/' + process.cwd().replaceAll('\\', '/') + '/packages/stage/src/rich-text.ts';
    const result = await page.evaluate(
      async ({ path, direction }) => {
        const { paintStyledText } = await import(/* @vite-ignore */ path);
        const c = document.createElement('canvas');
        c.width = 600;
        c.height = 150;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#111111';
        ctx.translate(20, 10);
        const text = 'abc אבג 123';
        const layout = paintStyledText(ctx, {
          content: text,
          runs: [],
          font: 'Arial',
          size: 40,
          bold: false,
          italic: false,
          width: 550,
          align: 'left',
          direction,
          lineHeight: 1,
          kerning: 'none',
        });
        const actual = ctx.getImageData(0, 0, 600, 150).data;
        ctx.clearRect(-20, -10, 600, 150);
        ctx.font = '40px Arial';
        ctx.fontKerning = 'none';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.direction = direction;
        ctx.fillText(text, 0, layout.lines[0].baseline);
        const expected = ctx.getImageData(0, 0, 600, 150).data;
        let difference = 0,
          ink = 0;
        for (let i = 3; i < actual.length; i += 4) {
          difference += Math.abs(actual[i] - expected[i]);
          ink += expected[i];
        }
        return { ratio: difference / ink, ink };
      },
      { path, direction },
    );
    expect(result.ink).toBeGreaterThan(100000);
    expect(result.ratio).toBeLessThan(0.08);
  });

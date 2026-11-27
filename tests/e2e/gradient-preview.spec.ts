import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { test, expect } from '@playwright/test';
import { newProject, id, type Vector } from '../../packages/document/src';
for (const scenario of [
  'radial',
  'compound',
  'text',
  'linear-alpha',
  'text-tiles',
  'text-bitmap',
  'text-bitmap-tiles',
  'text-rich',
  'text-rich-bitmap',
  'text-rich-tiles',
  'text-rich-bitmap-tiles',
] as const)
  test(`accelerated ${scenario} gradient agrees with Canvas pixels`, async ({ page }) => {
    const kind = scenario.startsWith('text') ? 'text' : 'rectangle';
    const project = newProject();
    project.width = 400;
    project.height = 240;
    const shape: Vector = {
      id: id(),
      kind,
      x: 30,
      y: 25,
      width: 330,
      height: 180,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      gradient: {
        kind: 'radial',
        from: { x: 140, y: 80 },
        to: { x: 300, y: 80 },
        transform: [1, 0, 0.4, 0.6],
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      },
    };
    if (scenario === 'compound') {
      const ring = (rx: number, ry: number) => {
        const x = 150,
          y = 90,
          k = 0.5522847498307936;
        return [
          { x: x + rx, y, in: { x: x + rx, y: y - k * ry }, out: { x: x + rx, y: y + k * ry } },
          { x, y: y + ry, in: { x: x + k * rx, y: y + ry }, out: { x: x - k * rx, y: y + ry } },
          { x: x - rx, y, in: { x: x - rx, y: y + k * ry }, out: { x: x - rx, y: y - k * ry } },
          { x, y: y - ry, in: { x: x - k * rx, y: y - ry }, out: { x: x + k * rx, y: y - ry } },
        ];
      };
      shape.kind = 'polygon';
      shape.fillRule = 'evenodd';
      shape.closed = true;
      shape.contours = [ring(130, 75), ring(85, 45), ring(35, 18)];
    }
    if (kind === 'text')
      shape.text = {
        content: 'MMMM\nMMMM',
        font: 'Arial',
        size: 60,
        bold: true,
        italic: false,
        align: 'left',
        scaleX: 1.3,
        scaleY: 1.2,
      };
    if (scenario === 'linear-alpha') {
      shape.gradient!.kind = 'linear';
      shape.gradient!.to = { x: 260, y: 160 };
      shape.gradient!.stops[0].opacity = 0.3;
      shape.opacity = 0.7;
      shape.transform = [1, 0.1, 0.15, 0.9];
    }
    if (
      scenario === 'text' ||
      scenario === 'text-bitmap' ||
      (scenario.includes('rich') && !scenario.includes('tiles'))
    ) {
      shape.text!.align = 'center';
      shape.text!.direction = 'rtl';
      shape.text!.kerning = 'none';
      shape.text!.wordSpacing = 12;
      shape.text!.content = 'אבג AV AV אבג';
      shape.text!.wrapWidth = 190;
      shape.text!.letterSpacing = 2;
      shape.rotation = 8;
      shape.opacity = 0.8;
      shape.strokeWidth = 1;
    }
    if (scenario.includes('tiles')) {
      project.width = 1500;
      shape.width = 1400;
      shape.text!.content = 'MMMMMMMMMMMMMMMMMMMM';
      shape.text!.size = 100;
      shape.gradient!.to = { x: 1400, y: 80 };
    }
    if (scenario.includes('rich')) {
      shape.text!.runs = [
        { start: 0, end: 2, style: { color: '#00aa00', size: 40 } },
        {
          start: 3,
          end: 5,
          style: { italic: true, size: 80, letterSpacing: 4, wordSpacing: 15, kerning: 'none' },
        },
      ];
    }
    if (scenario.includes('bitmap')) {
      await page.goto('/');
      const dataUrl = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 8, 16);
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(8, 0, 8, 16);
        return c.toDataURL();
      });
      project.assets = [
        {
          id: 'a',
          path: 'assets/bitmaps/a.json',
          bitmap: { name: 'colors', width: 16, height: 16, dataUrl },
        },
      ];
      delete shape.gradient;
      shape.bitmap = {
        assetId: 'a',
        x: 0,
        y: 0,
        width: 120,
        height: 90,
        repeat: true,
        transform: [1, 0.2, 0.3, 0.8],
      };
    }
    project.layers[0].keys[0].shapes = [shape];
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      project,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes' }).click();
    const download = page.waitForEvent('download');
    await exportHtmlFromShortcut(page);
    const out = await page.context().newPage();
    await openWebExport(out, await readWebDownload(await download));
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText('WebGL · PixiJS', { exact: true })).toBeVisible();
    const preview = page.getByRole('dialog', { name: 'Test movie' }).locator('canvas');
    const png = await preview.screenshot();
    const result = await out.locator('canvas').evaluate(async (element, encoded) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + encoded;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(element as HTMLCanvasElement, 0, 0, canvas.width, canvas.height);
      const ref = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let green = 0;
      let count = 0,
        error = 0,
        missing = 0;
      for (let i = 0; i < ref.length; i += 4) {
        if (ref[i] < 80 && ref[i + 1] > 100 && ref[i + 1] < 220 && ref[i + 2] < 80) green++;
        if (ref[i + 1] > 240) continue;
        count++;
        error +=
          Math.abs(ref[i] - actual[i]) +
          Math.abs(ref[i + 1] - actual[i + 1]) +
          Math.abs(ref[i + 2] - actual[i + 2]);
        if (actual[i + 1] > 250) missing++;
      }
      return { count, green, error: error / count, missing: missing / count };
    }, png.toString('base64'));
    if (scenario.includes('rich')) expect(result.green).toBeGreaterThan(50);
    expect(result.count).toBeGreaterThan(1000);
    expect(result.missing, JSON.stringify(result)).toBeLessThan(0.03);
    expect(result.error, JSON.stringify(result)).toBeLessThan(8);
    await out.close();
  });

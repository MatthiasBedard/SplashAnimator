import { exportHtmlFromShortcut } from './export-settings';
import { openWebExport, readWebDownload } from './web-export-files';
import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { matrix, inversePoint } from '../../packages/geometry/src/affine';
async function exportedPixels(page: Page) {
  const download = page.waitForEvent('download');
  await exportHtmlFromShortcut(page);
  const files = await readWebDownload(await download);
  const out = await page.context().newPage();
  try {
    await openWebExport(out, files);
    const read = () =>
      out
        .locator('canvas')
        .evaluate((c) =>
          Array.from((c as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 500, 350).data),
        );
    await expect
      .poll(async () => (await read()).filter((v, i) => i % 4 === 1 && v < 200).length)
      .toBeGreaterThan(5000);
    return await read();
  } finally {
    await out.close();
  }
}
for (const paint of ['gradient', 'bitmap'] as const)
  test(`fitted affine ${paint} retains interior export pixels and recovery`, async ({ page }) => {
    await page.goto('/');
    const project = newProject();
    project.width = 500;
    project.height = 350;
    const ring = (r: number) =>
      Array.from({ length: 128 }, (_, i) => ({
        x: 100 + r * Math.cos((i * Math.PI) / 64),
        y: 100 + r * Math.sin((i * Math.PI) / 64),
      }));
    const shape: Vector = {
      id: 'paint-fit',
      kind: 'polygon',
      x: 260,
      y: 35,
      width: 200,
      height: 200,
      rotation: 12,
      transform: [-1, 0.15, 0.3, 1.1],
      fill: '#ee2200',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      closed: true,
      fillRule: 'evenodd',
      opacity: 0.75,
      contours: [ring(90), ring(50), ring(20)],
      gradient: {
        kind: 'linear',
        from: { x: 0, y: 20 },
        to: { x: 180, y: 150 },
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      },
    };
    if (paint === 'bitmap') {
      const dataUrl = await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const x = c.getContext('2d')!;
        x.fillStyle = '#ff0000';
        x.fillRect(0, 0, 8, 16);
        x.fillStyle = '#0000ff';
        x.fillRect(8, 0, 8, 16);
        return c.toDataURL();
      });
      project.assets = [
        {
          id: 'tile',
          path: 'assets/bitmaps/tile.json',
          bitmap: { name: 'tile', width: 16, height: 16, dataUrl },
        },
      ];
      delete shape.gradient;
      shape.bitmap = {
        assetId: 'tile',
        x: 7,
        y: 9,
        width: 30,
        height: 25,
        repeat: true,
        transform: [1, 0.2, 0.3, 0.8],
      };
    }
    project.layers[0].keys[0].shapes = [shape];
    await page.evaluate(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      project,
    );
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes' }).click();
    const before = await exportedPixels(page);
    await page.getByLabel('Drawing stage').focus();
    await page.keyboard.press('Control+a');
    await page.getByLabel('Contour fit tolerance').fill('0.25');
    await page.getByRole('button', { name: 'Preview fitted contours', exact: true }).click();
    const apply = page.getByRole('button', { name: 'Apply fitted contours', exact: true });
    await expect(apply).toBeEnabled();
    await apply.click();
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    const fitted = (await read()).layers[0].keys[0].shapes[0];
    expect(fitted.contours![0].length).toBeLessThan(128);
    expect({ ...fitted, contours: [] }).toEqual({ ...shape, contours: [] });
    const after = await exportedPixels(page),
      m = matrix(shape);
    let samples = 0,
      max = 0;
    for (let y = 0; y < 350; y++)
      for (let x = 0; x < 500; x++) {
        const p = inversePoint(m, { x: x + 0.5, y: y + 0.5 }),
          r = Math.hypot(p.x - 100, p.y - 100);
        if (r > 15 && !(r > 25 && r < 45) && !(r > 55 && r < 85) && !(r > 95 && r < 110)) continue;
        samples++;
        const i = (y * 500 + x) * 4;
        for (let k = 0; k < 4; k++) max = Math.max(max, Math.abs(before[i + k] - after[i + k]));
      }
    expect(samples).toBeGreaterThan(10000);
    expect(max).toBeLessThanOrEqual(1);
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes' }).click();
    expect((await read()).layers[0].keys[0].shapes[0]).toEqual(fitted);
    expect(await exportedPixels(page)).toEqual(after);
  });

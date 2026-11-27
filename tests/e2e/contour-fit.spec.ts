import { test, expect } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
for (const mode of ['object', 'merge'] as const)
  for (const ripple of [0, 2])
    test(`contour fit preview cancel apply undo in ${mode} layer with ripple ${ripple}`, async ({
      page,
    }) => {
      const p = newProject();
      p.layers[0].drawingMode = mode;
      const ring = (r: number) =>
        Array.from({ length: 64 }, (_, i) => ({
          x:
            100 +
            (r + (r === 90 ? ripple * Math.cos((9 * i * Math.PI) / 32) : 0)) *
              Math.cos((i * Math.PI) / 32),
          y:
            100 +
            (r + (r === 90 ? ripple * Math.cos((9 * i * Math.PI) / 32) : 0)) *
              Math.sin((i * Math.PI) / 32),
        }));
      p.layers[0].keys[0].shapes = [
        {
          id: 'fit',
          kind: 'polygon',
          x: 150,
          y: 80,
          width: 200,
          height: 200,
          rotation: 0,
          fill: '#cc2211',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
          closed: true,
          fillRule: 'evenodd',
          contours: [ring(90), ring(40)],
        },
      ];
      await page.addInitScript(
        (p) =>
          localStorage.setItem(
            'splash-recovery-v1',
            JSON.stringify({ project: p, folder: null, manifest: null }),
          ),
        p,
      );
      await page.addInitScript(
        ({ width, height }) => {
          const original = CanvasRenderingContext2D.prototype.fillRect;
          (window as unknown as { scenePaints: number }).scenePaints = 0;
          CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
            if (x === 0 && y === 0 && w === width && h === height)
              (window as unknown as { scenePaints: number }).scenePaints++;
            return original.call(this, x, y, w, h);
          };
        },
        { width: p.width, height: p.height },
      );
      await page.goto('/');
      await page.getByRole('button', { name: 'Recover changes' }).click();
      const stage = page.getByLabel('Drawing stage');
      await stage.focus();
      await page.keyboard.press('Control+a');
      const read = () =>
        page.evaluate(
          () =>
            (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
              .keys[0].shapes,
        );
      const before = await read();
      await page.getByLabel('Contour fit tolerance').fill('0.25');
      const preview = page.getByRole('button', { name: 'Preview fitted contours', exact: true });
      const originalPixels = await stage.screenshot();
      await stage.focus();
      await page.keyboard.press('Shift+F10');
      const menu = page.getByRole('menu', { name: 'Editing actions' });
      await menu.getByRole('menuitem', { name: 'Preview fitted contours', exact: true }).click();
      const apply = page.getByRole('button', { name: 'Apply fitted contours', exact: true });
      await expect(apply).toBeEnabled();
      await expect(page.getByTestId('fit-join-quality')).toContainText(
        /Largest non-corner tangent change: [0-9]+\.[0-9]+\u00b0/,
      );
      console.log(
        'Contour fit join quality',
        await page.getByTestId('fit-join-quality').textContent(),
      );
      if (!ripple) await expect(page.getByTestId('fit-join-quality')).toContainText('0.00');
      await expect(page.getByTestId('fit-join-quality')).toContainText(
        ripple
          ? 'Inspect marked joins before applying.'
          : 'No tangent breaks above 1\u00b0 detected.',
      );
      const markers = page.getByLabel('Show fitted join issues');
      await expect(markers).toBeChecked();
      const markedPixels = await stage.screenshot();
      const paints = await page.evaluate(
        () => (window as unknown as { scenePaints: number }).scenePaints,
      );
      await markers.uncheck();
      expect((await stage.screenshot()).equals(markedPixels)).toBe(ripple === 0);
      await expect(apply).toBeEnabled();
      await markers.check();
      await stage.screenshot();
      expect(
        await page.evaluate(() => (window as unknown as { scenePaints: number }).scenePaints),
      ).toBe(paints);
      expect(await read()).toEqual(before);
      expect((await stage.screenshot()).equals(originalPixels)).toBe(false);
      await page.keyboard.press('Escape');
      await expect(apply).toHaveCount(0);
      expect(await read()).toEqual(before);
      await preview.click();
      await expect(apply).toBeEnabled();
      const timeline = page.getByLabel('Timeline frames', { exact: true });
      await timeline.press('ArrowRight');
      await expect(apply).toHaveCount(0);
      expect(await read()).toEqual(before);
      await timeline.press('Home');
      await stage.press('Control+a');
      await preview.click();
      await expect(apply).toBeEnabled();
      await stage.focus();
      await page.keyboard.press('Shift+F10');
      await menu.getByRole('menuitem', { name: 'Cancel contour fit', exact: true }).click();
      await expect(apply).toHaveCount(0);
      expect(await read()).toEqual(before);
      await preview.click();
      await expect(apply).toBeEnabled();
      await stage.focus();
      await page.keyboard.press('Shift+F10');
      await menu.getByRole('menuitem', { name: 'Apply fitted contours', exact: true }).click();
      await expect.poll(async () => (await read())[0].contours![0].length).toBeLessThan(64);
      await expect(preview).toBeDisabled();
      const fitted = await read();
      expect(fitted[0].contours).toHaveLength(2);
      expect(fitted[0].contours![0][0].out).toBeDefined();
      await stage.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(read).toEqual(before);
      await page.keyboard.press('Control+a');
      await preview.click();
      await expect(apply).toBeEnabled();
      await page.getByLabel('Contour fit tolerance').fill('0.3');
      await expect(apply).toHaveCount(0);
      expect(await read()).toEqual(before);
      await preview.click();
      await expect(apply).toBeEnabled();
      await page.getByRole('button', { name: 'Brush', exact: true }).click();
      await expect(apply).toHaveCount(0);
      expect(await read()).toEqual(before);
      await stage.focus();
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(read).toEqual(fitted);
      if (mode === 'merge') {
        const box = (await stage.boundingBox())!;
        await page.getByRole('button', { name: 'Line', exact: true }).click();
        await page.getByLabel('Drawing stroke width').fill('10');
        await page.mouse.move(box.x + 650, box.y + 400);
        await page.mouse.down();
        await page.mouse.move(box.x + 690, box.y + 430);
        await page.mouse.up();
        await expect.poll(async () => (await read()).length).toBeGreaterThan(fitted.length);
        expect((await read()).find((s) => s.id === 'fit')).toEqual({
          ...fitted[0],
          drawingMode: 'merge',
        });
        await page.keyboard.press('Control+z');
        await expect.poll(read).toEqual(fitted);
        await page.getByRole('button', { name: 'Brush', exact: true }).click();

        await page.mouse.move(box.x + 650, box.y + 400);
        await page.mouse.down();
        await page.mouse.move(box.x + 690, box.y + 430);
        await page.mouse.up();
        await expect.poll(async () => (await read()).length).toBeGreaterThan(fitted.length);
        expect((await read()).find((s) => s.id === 'fit')).toEqual({
          ...fitted[0],
          drawingMode: 'merge',
        });
        await page.keyboard.press('Control+z');
        await expect.poll(read).toEqual(fitted);
      }
    });

test('dense contour fitting previews, commits and undoes without distant-pair work exhaustion', async ({
  page,
}) => {
  const p = newProject();
  p.layers[0].drawingMode = 'object';
  const contour = Array.from({ length: 1000 }, (_, i) => ({
    x: 100 + 90 * Math.cos((i * Math.PI * 2) / 1000),
    y: 100 + 90 * Math.sin((i * Math.PI * 2) / 1000),
  }));
  p.layers[0].keys[0].shapes = [
    {
      id: 'dense-fit',
      kind: 'polygon',
      x: 150,
      y: 80,
      width: 200,
      height: 200,
      rotation: 0,
      fill: '#cc2211',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
      closed: true,
      fillRule: 'evenodd',
      contours: [contour],
    },
  ];
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    p,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const stage = page.getByLabel('Drawing stage');
  await stage.focus();
  await page.keyboard.press('Control+a');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  const before = await read();
  await page.getByLabel('Contour fit tolerance').fill('0.1');
  await page.getByRole('button', { name: 'Preview fitted contours', exact: true }).click();
  const apply = page.getByRole('button', { name: 'Apply fitted contours', exact: true });
  await expect(apply).toBeEnabled();
  expect(await read()).toEqual(before);
  await apply.click();
  await expect.poll(async () => (await read())[0].contours![0].length).toBeLessThan(1000);
  expect((await read())[0]).toMatchObject({ id: 'dense-fit', fill: '#cc2211', x: 150, y: 80 });
  await stage.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(before);
});

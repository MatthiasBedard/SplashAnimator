import { test, expect } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';

for (const axis of ['x', 'y'] as const)
  test(`${axis} ruler guides span both pasteboard margins during drag, zoom, pan and panel resize`, async ({
    page,
  }) => {
    const p = newProject();
    p.width = 200;
    p.height = 120;
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      p,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const canvas = page.getByLabel('Drawing stage', { exact: true });
    const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    let b = (await canvas.boundingBox())!,
      position = axis === 'x' ? -35 : 55;
    async function marginPixels(zoom: number, panX = 0, panY = 0) {
      return canvas.evaluate(
        (c: HTMLCanvasElement, args) => {
          const width = c.clientWidth,
            height = c.clientHeight,
            scale = devicePixelRatio;
          const left = width / 2 - 100 * args.zoom + args.panX,
            top = height / 2 - 60 * args.zoom + args.panY;
          const start = args.axis === 'x' ? top : left;
          const end = start + (args.axis === 'x' ? 120 : 200) * args.zoom;
          const cross = (args.axis === 'x' ? left : top) + args.position * args.zoom;
          const length = args.axis === 'x' ? height : width;
          const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          const count = (a: number, z: number) => {
            let hits = 0;
            for (let along = Math.ceil(a); along < z; along++) {
              let cyan = false;
              for (let offset = -2; offset <= 2; offset++) {
                const x = Math.round((args.axis === 'x' ? cross + offset : along) * scale);
                const y = Math.round((args.axis === 'x' ? along : cross + offset) * scale);
                if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
                const i = (y * c.width + x) * 4,
                  r = data[i],
                  g = data[i + 1],
                  blue = data[i + 2];
                cyan ||= g > r + 40 && blue > r + 40 && g > 90;
              }
              if (cyan) hits++;
            }
            return hits;
          };
          return { before: count(25, start - 8), after: count(end + 8, length - 8) };
        },
        { axis, position, zoom, panX, panY },
      );
    }
    async function spans(zoom: number, panX = 0, panY = 0) {
      await expect
        .poll(async () => Math.min(...Object.values(await marginPixels(zoom, panX, panY))))
        .toBeGreaterThan(15);
    }
    const x = b.width / 2 - 100 + position,
      y = b.height / 2 - 60 + position;
    await page.mouse.move(
      b.x + (axis === 'x' ? 10 : b.width / 2),
      b.y + (axis === 'x' ? b.height / 2 : 10),
    );
    await page.mouse.down();
    await page.mouse.move(
      b.x + (axis === 'x' ? x : b.width / 2),
      b.y + (axis === 'x' ? b.height / 2 : y),
      { steps: 5 },
    );
    await spans(1);
    expect((await read()).guides).toBeUndefined();
    await page.mouse.up();
    await expect.poll(async () => (await read()).guides?.length).toBe(1);
    let out = await read();
    expect(out.guides![0].position).toBeCloseTo(position, 5);
    // Pick the existing guide in the non-drawing margin, not inside the page.
    b = (await canvas.boundingBox())!;
    await page.mouse.move(b.x + (axis === 'x' ? x : 35), b.y + (axis === 'x' ? 35 : y));
    await page.mouse.down();
    await page.mouse.move(b.x + (axis === 'x' ? x + 16 : 35), b.y + (axis === 'x' ? 35 : y + 16), {
      steps: 4,
    });
    await page.mouse.up();
    position += 16;
    await expect.poll(async () => (await read()).guides![0].position).toBeCloseTo(position, 5);
    out = await read();
    for (const zoom of [0.5, 1, 2]) {
      await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption(String(zoom));
      await spans(zoom);
      expect(await read()).toEqual(out);
    }
    b = (await canvas.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 + 25, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    await spans(2, 30, 25);
    const divider = page.getByRole('separator', { name: 'Resize properties sidebar', exact: true });
    await divider.focus();
    await divider.press('ArrowLeft');
    await spans(2, 30, 25);
    expect(await read()).toEqual(out);
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Show guides', exact: true }).click();
    await page.getByRole('button', { name: 'View', exact: true }).click();
    await expect
      .poll(
        async () => (await marginPixels(2, 30, 25)).before + (await marginPixels(2, 30, 25)).after,
      )
      .toBe(0);
    expect(await read()).toEqual(out);
    await canvas.focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await read()).guides![0].position).toBeCloseTo(position - 16, 5);
    await page.keyboard.press('Control+z');
    await expect.poll(read).toEqual(p);
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(read).toEqual(out);
  });

test('View hides both rulers without moving artwork or retaining invisible guide hit strips', async ({
  page,
}) => {
  const p = newProject();
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [
    {
      id: 'art',
      kind: 'rectangle',
      x: 100,
      y: 100,
      width: 80,
      height: 60,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
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
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    b = (await canvas.boundingBox())!;
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const pixel = (x: number, y: number) =>
    canvas.evaluate(
      (n, { x, y }) =>
        Array.from(
          (n as HTMLCanvasElement)
            .getContext('2d')!
            .getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1)
            .data,
        ),
      { x, y },
    );
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Show rulers', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const top = await pixel(5, 5),
    left = await pixel(5, 100);
  expect(top).toEqual([45, 48, 56, 255]);
  expect(left).toEqual(top);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => pixel(5, 5)).not.toEqual(top);
  await expect.poll(() => pixel(5, 100)).not.toEqual(left);
  expect(await read()).toEqual(p);
  await toggle.click();
  await expect.poll(() => pixel(5, 5)).toEqual(top);
  await expect.poll(() => pixel(5, 100)).toEqual(left);
  await toggle.click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(b.x + 400, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + 450, b.y + 100);
  await page.mouse.up();
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(2);
  expect((await read()).guides ?? []).toEqual([]);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(read).toEqual(p);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await toggle.click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.mouse.move(b.x + 400, b.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + 400, b.y + 200);
  await page.mouse.up();
  await expect.poll(async () => (await read()).guides?.length ?? 0).toBe(1);
  expect((await read()).layers[0].keys).toEqual(p.layers[0].keys);
});

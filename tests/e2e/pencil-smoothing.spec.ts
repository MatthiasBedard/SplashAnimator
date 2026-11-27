import { test, expect } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { openEditorAtStartup } from './editor-test';

for (const editor of ['scene', 'symbol', 'advanced symbol'] as const) {
  test(`rapid queued Pencil strokes stay visible and survive a failed worker in the ${editor}`, async ({ page }) => {
    await holdGeometry(page);
    const project = newProject();
    if (editor !== 'scene')
      project.symbols = [{ id: 'rapid', name: 'Rapid pencil', width: 800, height: 500, shapes: [{
        id: 'prior', kind: 'rectangle', x: 8, y: 8, width: 12, height: 12,
        rotation: 0, fill: '#000000', stroke: '#000000', strokeWidth: 0, points: [],
      }] }];
    await page.addInitScript(project => localStorage.setItem(
      'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
    ), project);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes' }).click();
    if (editor !== 'scene') {
      await page.getByRole('option', { name: 'Library item Rapid pencil', exact: true }).dblclick();
      if (editor === 'advanced symbol') await page.getByRole('button', { name: 'Advanced symbol timeline tools…' }).click();
    }
    const advanced = editor === 'advanced symbol';
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    const selection = page.getByRole('button', { name: 'Selection', exact: true });
    const selectionOpacity = () => selection.evaluate(element => getComputedStyle(element).opacity);
    const idleOpacity = await selectionOpacity();
    await page.getByLabel(advanced ? 'New symbol line color' : 'Drawing stroke', { exact: true }).fill('#ff0000');
    const canvas = page.getByLabel(advanced ? 'Symbol artwork preview' : 'Drawing stage', { exact: true });
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
    const start = async (y: number) => {
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + box.width * .30, box.y + box.height * y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .62, box.y + box.height * y, { steps: 5 });
    };
    const marks = [.34, .45, .56, .67];
    const visible = () => canvas.evaluate((c: HTMLCanvasElement, ys) => ys.map(y => {
      const pixels = c.getContext('2d')!.getImageData(Math.round(c.width * .44), Math.round(c.height * y) - 3, 1, 7).data;
      return pixels.some((value, i) => i % 4 === 0 && value > 180 && pixels[i + 1] < 130 && pixels[i + 2] < 130);
    }), marks);
    await start(marks[0]);
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await expect(selection).toBeDisabled();
    expect(await selectionOpacity()).toBe(idleOpacity);
    await start(marks[1]);
    await page.mouse.up();
    await start(marks[2]);
    await page.mouse.up();
    await start(marks[3]);
    await expect.poll(visible).toEqual([true, true, true, true]);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(visible).toEqual([true, true, true, false]);
    expect(await read()).toEqual(project);
    expect(await pendingGeometry(page)).toBe(1);
    await releaseGeometry(page, true);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await expect.poll(visible).toEqual([false, true, true, false]);
    await releaseGeometry(page);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page);
    await expect.poll(visible).toEqual([false, true, true, false]);
    if (editor !== 'scene') {
      await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
      await expect.poll(async () => (await read()).symbols![0].shapes.filter(s => s.stroke === '#ff0000')).toHaveLength(2);
    } else {
      await expect.poll(async () => (await read()).layers[0].keys[0].shapes).toHaveLength(2);
      await canvas.press('Control+z');
      await expect.poll(visible).toEqual([false, true, false, false]);
      await canvas.press('Control+z');
      await expect.poll(read).toEqual(project);
    }
  });
}

test('drawing worker keeps editor chrome steady after Pencil, Brush and Rectangle release', async ({ page }) => {
  await holdGeometry(page);
  await page.goto('/');
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  const selection = page.getByRole('button', { name: 'Selection', exact: true });
  const exportButton = page.locator('.menubar .publish');
  const documentStatus = page.locator('.saved-state');
  const addLayer = page.locator('#timeline-panel button[aria-label="Add layer"]');
  const newSymbol = page.locator('.library-browser button').filter({ hasText: /^New symbol$/ });
  const readOpacity = () => Promise.all([selection, exportButton, addLayer, newSymbol]
    .map(button => button.evaluate(element => getComputedStyle(element).opacity)));
  const read = () => page.evaluate(() => {
    const recovery = localStorage.getItem('splash-recovery-v1');
    return recovery && JSON.parse(recovery).project;
  });
  for (const [index, tool] of ['Pencil', 'Brush', 'Rectangle'].entries()) {
    const toolButton = page.getByRole('button', { name: tool, exact: true });
    await toolButton.click();
    const previous = await read();
    const previousStatus = await documentStatus.textContent();
    const before = await readOpacity();
    const x = box.x + box.width * .32, y = box.y + box.height * (.32 + index * .19);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y + 30, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    expect(await readOpacity()).toEqual(before);
    await expect(documentStatus).toHaveText(previousStatus!.trim());
    await expect(selection).toBeDisabled();
    await expect(exportButton).toBeDisabled();
    await selection.dispatchEvent('click');
    await expect(toolButton).toHaveAttribute('aria-pressed', 'true');
    expect(await read()).toEqual(previous);
    await releaseGeometry(page);
    await expect.poll(read).not.toEqual(previous);
    await expect(selection).toBeEnabled();
    expect(await readOpacity()).toEqual(before);
  }
});

test('rapid queued Pencil, Rectangle, Eraser and Pen process in release order on the same canvas', async ({ page }) => {
  await holdGeometry(page);
  const project = newProject();
  await page.addInitScript(project => localStorage.setItem(
    'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
  ), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  const canvas = page.getByLabel('Drawing stage', { exact: true });
  const box = (await canvas.boundingBox())!;
  const stroke = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
    await page.mouse.move(box.x + x + dx, box.y + y + dy, { steps: 5 });
    await page.mouse.up();
  };
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const frames = async () => (await read()).layers[0].keys[0].shapes.length;
  await page.getByLabel('Drawing stroke width', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await stroke(150, 120, 100, 0);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await stroke(320, 150, 120, 115);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await stroke(360, 140, 0, 140);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  for (const [x, y] of [[180, 340], [250, 300], [320, 340]]) await page.mouse.click(box.x + x, box.y + y);
  await canvas.press('Enter');
  expect(await read()).toEqual(project);
  await releaseGeometry(page);
  await expect.poll(frames).toBe(1);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect.poll(frames).toBeGreaterThan(1);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  const beforeErase = await read();
  await releaseGeometry(page);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  const afterErase = await read();
  expect(afterErase).not.toEqual(beforeErase);
  await releaseGeometry(page);
  await expect.poll(read).not.toEqual(afterErase);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(afterErase);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(beforeErase);
});

test('rapid queued Bucket clicks use the artwork from the preceding fill', async ({ page }) => {
  await holdGeometry(page);
  const project = newProject();
  project.layers[0].drawingMode = 'merge';
  const art = { kind: 'rectangle' as const, y: 140, width: 95, height: 80, rotation: 0,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [] };
  project.layers[0].keys[0].shapes = [{ ...art, id: 'first', x: 190 }, { ...art, id: 'second', x: 330 }];
  await page.addInitScript(project => localStorage.setItem(
    'splash-recovery-v1', JSON.stringify({ project, folder: null, manifest: null }),
  ), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes' }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Paint bucket', exact: true }).click();
  const canvas = page.getByLabel('Drawing stage', { exact: true }), box = (await canvas.boundingBox())!;
  for (const [x, color] of [[230, '#0000ff'], [375, '#00ff00']] as const) {
    await page.getByLabel('Drawing fill', { exact: true }).fill(color);
    await page.mouse.click(box.x + (box.width - project.width) / 2 + x, box.y + (box.height - project.height) / 2 + 165);
  }
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const afterFirst = structuredClone(project), afterBoth = structuredClone(project);
  afterFirst.layers[0].keys[0].shapes[0].fill = '#0000ff';
  afterBoth.layers[0].keys[0].shapes[0].fill = '#0000ff';
  afterBoth.layers[0].keys[0].shapes[1].fill = '#00ff00';
  await expect.poll(read).toEqual(afterBoth);
  expect(await pendingGeometry(page)).toBe(0);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(afterFirst);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(project);
});
for (const drawingMode of ['merge', 'object'] as const)
  for (const mode of ['smooth', 'ink', 'straight'] as const)
    test(`released ${mode} ${drawingMode} Pencil stays visible across release and completion with one history edit`, async ({
      page,
    }) => {
      await holdGeometry(page);
      const project = newProject();
      project.layers[0].drawingMode = drawingMode;
      await page.addInitScript((project) => {
        if (window === window.top)
          localStorage.setItem(
            'splash-recovery-v1',
            JSON.stringify({ project, folder: null, manifest: null }),
          );
      }, project);
      await page.goto('/');
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      await page.getByRole('button', { name: 'Pencil', exact: true }).click();
      await page
        .getByLabel('Separate Pencil objects', { exact: true })
        .setChecked(drawingMode === 'object');
      await page.getByLabel('Pencil mode', { exact: true }).selectOption(mode);
      await page.getByLabel('Drawing stroke', { exact: true }).fill('#ff0000');
      // Keep object selection bounds from covering the thin horizontal ink.
      if (drawingMode === 'object')
        await page.getByLabel('Drawing stroke width', { exact: true }).fill('6');
      const canvas = page.getByLabel('Drawing stage', { exact: true }),
        box = (await canvas.boundingBox())!,
        read = () =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
          );
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 250, box.y + 100, { steps: 30 });
      // Observe continuously before release, while the worker is held, and across
      // completion. Separate before/after probes could miss a one-frame blank.
      await canvas.evaluate(async (node) => {
        const c = node as HTMLCanvasElement & {
            pencilFrames?: { request: number; counts: number[] };
          },
          ctx = c.getContext('2d')!;
        const state = { request: 0, counts: [] as number[] };
        c.pencilFrames = state;
        const sample = () => {
          const scale = c.width / c.getBoundingClientRect().width;
          const data = ctx.getImageData(
            Math.floor(95 * scale),
            Math.floor(94 * scale),
            Math.floor(165 * scale),
            Math.floor(12 * scale),
          ).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4)
            if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80) count++;
          state.counts.push(count);
          state.request = requestAnimationFrame(sample);
        };
        // Let the last pointer-movement paint land before starting observation.
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        sample();
      });
      await page.mouse.up();
      {
        await expect.poll(() => pendingGeometry(page)).toBe(1);
        expect(await read()).toEqual(project);
        await canvas.evaluate(async () => {
          for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
        });
        await releaseGeometry(page);
      }
      await expect.poll(async () => JSON.stringify(await read())).not.toBe(JSON.stringify(project));
      const counts = await canvas.evaluate(async (node) => {
        const c = node as HTMLCanvasElement & {
          pencilFrames?: { request: number; counts: number[] };
        };
        for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
        const state = c.pencilFrames!;
        cancelAnimationFrame(state.request);
        delete c.pencilFrames;
        return state.counts;
      });
      expect(counts.length).toBeGreaterThan(8);
      expect(Math.min(...counts), JSON.stringify(counts)).toBeGreaterThan(40);
      const result = await read();
      await canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(read).toEqual(project);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(read).toEqual(result);
    });

for (const drawingMode of ['merge', 'object'] as const)
  test(`failed Pencil ${drawingMode} finishing clears temporary feedback without saving ghost artwork`, async ({
    page,
  }) => {
    await holdGeometry(page);
    const project = newProject();
    project.layers[0].drawingMode = drawingMode;
    await page.addInitScript((project) => {
      if (window === window.top)
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        );
    }, project);
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('button', { name: 'Pencil', exact: true }).click();
    await page
      .getByLabel('Separate Pencil objects', { exact: true })
      .setChecked(drawingMode === 'object');
    await page.getByLabel('Drawing stroke', { exact: true }).fill('#ff0000');
    const canvas = page.getByLabel('Drawing stage', { exact: true }),
      box = (await canvas.boundingBox())!,
      read = () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
        );
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 100, { steps: 20 });
    await page.mouse.up();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page, true);
    await expect(page.getByRole('alert')).toContainText('Simulated merge failure');
    expect(await read()).toEqual(project);
    await expect
      .poll(() =>
        canvas.evaluate((node) => {
          const c = node as HTMLCanvasElement,
            ctx = c.getContext('2d')!,
            pixels = ctx.getImageData(0, 0, c.width, c.height).data;
          let red = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i] > 150 && pixels[i + 1] < 80 && pixels[i + 2] < 80) red++;
          return red;
        }),
      )
      .toBe(0);
  });
test('Brush shows a brush icon and Pencil defaults to editable smooth curves with exact Undo', async ({
  page,
}) => {
  const project = newProject();
  project.layers[0].keys[0].shapes = [
    {
      id: 'old-line',
      kind: 'path',
      x: 10,
      y: 10,
      width: 40,
      height: 15,
      rotation: 0,
      fill: '#000000',
      fillEnabled: false,
      stroke: '#000000',
      strokeWidth: 2,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 15 },
        { x: 40, y: 0 },
      ],
    },
  ];
  await page.addInitScript((project) => {
    if (window === window.top)
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project, folder: null, manifest: null }),
      );
  }, project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const brush = page.getByRole('button', { name: 'Brush', exact: true });
  await expect(brush.locator('svg')).toHaveCount(1);
  await expect(brush.locator('svg path').first()).toBeVisible();
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await page.getByLabel('Separate Pencil objects', { exact: true }).check();
  const mode = page.getByLabel('Pencil mode', { exact: true });
  await expect(mode).toHaveValue('smooth');
  await page.getByLabel('Drawing stroke', { exact: true }).fill('#e60000');
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      );
  const draw = async (y: number) => {
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + y);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++)
      await page.mouse.move(
        box.x + 100 + i * 5,
        box.y + y + Math.sin(i / 5) * 15 + (i % 2 ? 2 : -2),
      );
    await page.mouse.up();
  };
  await draw(100);
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(2);
  const result = await read(),
    smooth = result.layers[0].keys[0].shapes[1];
  expect(smooth.kind).toBe('bezier');
  expect(smooth.nodes!.length).toBeLessThan(20);
  expect(smooth.nodes!.length).toBeGreaterThan(2);
  expect(smooth.nodes!.slice(1, -1).every((n) => n.in && n.out)).toBe(true);
  expect(result.layers[0].keys[0].shapes[0]).toEqual(project.layers[0].keys[0].shapes[0]);
  const ink = await canvas.evaluate((node) => {
    const c = node as HTMLCanvasElement,
      rect = c.getBoundingClientRect(),
      scale = c.width / rect.width,
      ctx = c.getContext('2d')!,
      data = ctx.getImageData(
        Math.floor(80 * scale),
        Math.floor(70 * scale),
        Math.floor(200 * scale),
        Math.floor(70 * scale),
      ).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 100 && data[i + 1] < 80 && data[i + 2] < 80) count++;
    return count;
  });
  expect(ink).toBeGreaterThan(20);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await read()).layers[0].keys[0].shapes)
    .toEqual(project.layers[0].keys[0].shapes);
  await page.keyboard.press('Control+Shift+z');
  await expect
    .poll(async () => (await read()).layers[0].keys[0].shapes)
    .toEqual(result.layers[0].keys[0].shapes);
  await mode.selectOption('ink');
  await page.getByLabel('Pencil optimize', { exact: true }).uncheck();
  await draw(170);
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(3);
  expect((await read()).layers[0].keys[0].shapes[2].kind).toBe('path');
  await mode.selectOption('straight');
  await draw(220);
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(4);
  expect((await read()).layers[0].keys[0].shapes[3].points).toHaveLength(2);
});

for (const drawingMode of ['merge', 'object'] as const)
  for (const finish of ['smooth', 'ink', 'straight'] as const)
    test(`curved ${finish} ${drawingMode} Pencil retains the exact incoming ink until its finished output is ready`, async ({
      page,
    }) => {
      await holdGeometry(page);
      await page.addInitScript(() => {
        const HeldWorker = window.Worker;
        window.Worker = class extends HeldWorker {
          postMessage(
            message: unknown,
            transfer: Transferable[] | StructuredSerializeOptions = [],
          ) {
            Object.assign(window, { pencilRequest: structuredClone(message) });
            if (Array.isArray(transfer)) super.postMessage(message, transfer);
            else super.postMessage(message, transfer);
          }
        };
      });
      const project = newProject();
      project.layers[0].drawingMode = drawingMode;
      await page.addInitScript((project) => {
        if (window === window.top)
          localStorage.setItem(
            'splash-recovery-v1',
            JSON.stringify({ project, folder: null, manifest: null }),
          );
      }, project);
      await page.goto('/');
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      await page.getByRole('button', { name: 'Pencil', exact: true }).click();
      await page
        .getByLabel('Separate Pencil objects', { exact: true })
        .setChecked(drawingMode === 'object');
      await page.getByLabel('Pencil mode', { exact: true }).selectOption(finish);
      await page.getByLabel('Drawing stroke', { exact: true }).fill('#ff0000');
      // Keep the selected object outline from covering its finished thin ink.
      await page
        .getByLabel('Drawing stroke width', { exact: true })
        .fill(drawingMode === 'object' ? '6' : '4');
      const canvas = page.getByLabel('Drawing stage', { exact: true }),
        box = (await canvas.boundingBox())!;
      const read = () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
        );
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      for (let i = 1; i <= 30; i++)
        await page.mouse.move(
          box.x + 100 + i * 5,
          box.y + 120 + Math.sin(i / 3) * 20 + (i % 2 ? 8 : -8),
        );
      const original = await canvas.evaluate(async (node) => {
        await new Promise(requestAnimationFrame);
        const c = node as HTMLCanvasElement,
          scale = c.width / c.getBoundingClientRect().width;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(105 * scale),
              Math.round(80 * scale),
              Math.round(120 * scale),
              Math.round(85 * scale),
            ).data,
        );
      });
      expect(
        original.filter(
          (n, i) => i % 4 === 0 && n > 150 && original[i + 1] < 80 && original[i + 2] < 80,
        ).length,
      ).toBeGreaterThan(80);
      await page.mouse.up();
      await expect.poll(() => pendingGeometry(page)).toBe(1);
      expect(await read()).toEqual(project);
      const request = await page.evaluate(
        () =>
          (
            window as unknown as {
              pencilRequest: {
                pencil: {
                  stroke: { kind: string; points: unknown[] };
                  mode: string;
                  merge: boolean;
                };
              };
            }
          ).pencilRequest,
      );
      expect(request.pencil.stroke.kind).toBe('path');
      expect(request.pencil.stroke.points.length).toBeGreaterThan(30);
      expect(request.pencil.mode).toBe(finish);
      expect(request.pencil.merge).toBe(drawingMode === 'merge');
      const frames = await canvas.evaluate(async (node) => {
        const c = node as HTMLCanvasElement,
          scale = c.width / c.getBoundingClientRect().width,
          frames: number[][] = [];
        for (let i = 0; i < 8; i++) {
          await new Promise(requestAnimationFrame);
          frames.push(
            Array.from(
              c
                .getContext('2d')!
                .getImageData(
                  Math.round(105 * scale),
                  Math.round(80 * scale),
                  Math.round(120 * scale),
                  Math.round(85 * scale),
                ).data,
            ),
          );
        }
        return frames;
      });
      for (const pixels of frames) expect(pixels).toEqual(original);
      await releaseGeometry(page);
      await expect.poll(async () => JSON.stringify(await read())).not.toBe(JSON.stringify(project));
      const result = await read();
      expect(result.layers[0].keys[0].shapes.length).toBeGreaterThan(0);
      const finalInk = await canvas.evaluate((node) => {
        const c = node as HTMLCanvasElement,
          scale = c.width / c.getBoundingClientRect().width;
        return Array.from(
          c
            .getContext('2d')!
            .getImageData(
              Math.round(105 * scale),
              Math.round(80 * scale),
              Math.round(120 * scale),
              Math.round(85 * scale),
            ).data,
        );
      });
      expect(
        finalInk.filter(
          (n, i) => i % 4 === 0 && n > 150 && finalInk[i + 1] < 80 && finalInk[i + 2] < 80,
        ).length,
      ).toBeGreaterThan(80);
      if (finish !== 'ink') expect(finalInk).not.toEqual(original);
      await canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(read).toEqual(project);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(read).toEqual(result);
    });

for (const dpi of [1, 3])
  test(`thin Pencil over existing artwork has no empty release frames at ${dpi}x DPI`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: dpi,
    });
    await openEditorAtStartup(context);
    const page = await context.newPage();
    try {
      await holdGeometry(page);
      const project = newProject();
      project.layers[0].drawingMode = 'merge';
      project.layers[0].keys[0].shapes = [
        {
          id: 'existing',
          kind: 'rectangle',
          x: 0,
          y: 0,
          width: 1000,
          height: 800,
          rotation: 0,
          fill: '#ddddff',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ];
      await page.addInitScript(
        (project) =>
          localStorage.setItem(
            'splash-recovery-v1',
            JSON.stringify({ project, folder: null, manifest: null }),
          ),
        project,
      );
      await page.goto('/');
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      await page.getByRole('button', { name: 'Pencil', exact: true }).click();
      await page.getByLabel('Drawing stroke', { exact: true }).fill('#ff0000');
      await page.getByLabel('Drawing stroke width', { exact: true }).fill('1');
      const canvas = page.getByLabel('Drawing stage', { exact: true });
      const read = () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
        );
      const before = await read(),
        box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + 120, box.y + 125);
      await page.mouse.down();
      for (let i = 1; i <= 35; i++)
        await page.mouse.move(box.x + 120 + i * 5, box.y + 125 + Math.sin(i / 4) * 18);
      await canvas.evaluate(async (node) => {
        await new Promise(requestAnimationFrame);
        const c = node as HTMLCanvasElement & { releaseProbe?: { id: number; counts: number[] } };
        const state = { id: 0, counts: [] as number[] };
        c.releaseProbe = state;
        const sample = () => {
          const scale = c.width / c.getBoundingClientRect().width;
          const data = c
            .getContext('2d')!
            .getImageData(
              Math.round(110 * scale),
              Math.round(95 * scale),
              Math.round(200 * scale),
              Math.round(60 * scale),
            ).data;
          let red = 0;
          for (let i = 0; i < data.length; i += 4)
            if (
              data[i] > 130 &&
              data[i + 1] < 150 &&
              data[i + 2] < 150 &&
              data[i] > data[i + 1] + 40
            )
              red++;
          state.counts.push(red);
          state.id = requestAnimationFrame(sample);
        };
        sample();
      });
      await page.mouse.up();
      await expect.poll(() => pendingGeometry(page)).toBe(1);
      expect(await read()).toEqual(before);
      await canvas.evaluate(async () => {
        for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
      });
      await releaseGeometry(page);
      await expect
        .poll(
          async () => {
            const errors = await page.getByRole('alert').allTextContents();
            return errors.length
              ? errors.join(' | ')
              : JSON.stringify(await read()) !== JSON.stringify(before)
                ? 'committed'
                : 'waiting';
          },
          { timeout: 20000 },
        )
        .toBe('committed');
      const counts = await canvas.evaluate(async (node) => {
        for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
        const c = node as HTMLCanvasElement & { releaseProbe?: { id: number; counts: number[] } },
          state = c.releaseProbe!;
        cancelAnimationFrame(state.id);
        delete c.releaseProbe;
        return state.counts;
      });
      expect(counts.length).toBeGreaterThan(8);
      expect(Math.min(...counts), JSON.stringify(counts)).toBeGreaterThan(20);
      const after = await read();
      await canvas.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(read).toEqual(before);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(read).toEqual(after);
    } finally {
      await context.close();
    }
  });
for (const mode of ['raw', 'smooth', 'straight'] as const)
  test(`symbol Pencil ${mode} retains ink on every displayed release frame`, async ({ page }) => {
    const project = newProject();
    project.symbols = [
      {
        id: 'pencil-release',
        name: 'Pencil release',
        width: 100,
        height: 100,
        shapes: [
          {
            id: 'base',
            kind: 'rectangle',
            x: 5,
            y: 5,
            width: 5,
            height: 5,
            rotation: 0,
            fill: '#0000ff',
            stroke: '#000000',
            strokeWidth: 0,
            points: [],
          },
        ],
      },
    ];
    await page.addInitScript(
      (project) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        ),
      project,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('option',{name:'Library item Pencil release',exact:true}).click({button:'right'});
    await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
    await page.getByRole('button', { name: 'Advanced symbol timeline tools…' }).click();
    const dialog = page.getByRole('region', { name: 'Symbol editing workspace', exact: true });
    await dialog.getByLabel('Symbol canvas tool').selectOption('pencil');
    await dialog.getByLabel('Symbol pencil smoothing').selectOption(mode);
    await dialog.getByLabel('New symbol line color').fill('#ff0000');
    await dialog.getByLabel('New symbol line width').fill('1');
    const canvas = dialog.getByLabel('Symbol artwork preview');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    const point = (x: number, y: number) => ({
      x: box.x + ((20 + x * 2.9) * box.width) / 540,
      y: box.y + ((20 + y * 2.9) * box.height) / 330,
    });
    const start = point(15, 55);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) {
      const p = point(15 + i * 2, 55 + Math.sin(i / 6) * 8);
      await page.mouse.move(p.x, p.y);
    }
    await canvas.evaluate(async (node) => {
      const c = node as HTMLCanvasElement & { pencilProbe?: { id: number; counts: number[] } },
        state = { id: 0, counts: [] as number[] };
      c.pencilProbe = state;
      const sample = () => {
        const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let red = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] > 150 && pixels[i + 1] < 100 && pixels[i + 2] < 100) red++;
        state.counts.push(red);
        state.id = requestAnimationFrame(sample);
      };
      await new Promise(requestAnimationFrame);
      sample();
    });
    await page.mouse.up();
    const counts = await canvas.evaluate(async (node) => {
      for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
      const c = node as HTMLCanvasElement & { pencilProbe?: { id: number; counts: number[] } },
        state = c.pencilProbe!;
      cancelAnimationFrame(state.id);
      delete c.pencilProbe;
      return state.counts;
    });
    expect(counts.length).toBeGreaterThan(8);
    expect(Math.min(...counts), JSON.stringify(counts)).toBeGreaterThan(60);
    await dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await expect(dialog.getByLabel('Symbol artwork item').locator('option')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await expect(dialog.getByLabel('Symbol artwork item').locator('option')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    const result = await page.evaluate(
      () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
    );
    expect(result.symbols![0].shapes).toHaveLength(2);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
      )
      .toEqual(project);
  });

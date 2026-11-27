import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { worldPoint } from '../../packages/geometry/src';

test('native inverted-pen smoke assertions agree with the editor gesture and history', async ({ page }) => {
  const source = readFileSync('apps/editor/src-tauri/src/native_smoke.rs', 'utf8');
  const expression = (prefix: string) => {
    const at = source.indexOf(prefix);
    expect(at, prefix).toBeGreaterThanOrEqual(0);
    const start = at + prefix.length, end = source.indexOf('"#', start);
    expect(end, prefix).toBeGreaterThan(start);
    return source.slice(start, end);
  };
  await page.addInitScript(() => Reflect.set(window,'__TAURI_INTERNALS__',{
    metadata:{currentWindow:{label:'main'}},invoke:async()=>null,
  }));
  await page.goto('/');
  await expect(page.getByLabel('Drawing stage', {exact:true})).toBeVisible();
  const check = (js: string) => expect.poll(() => page.evaluate(js)).toBe(true);
  await check(expression('const PEN_SETUP: &str = r#"'));
  const packet = (phase: string, x: number, pressure: number | null, eraser = false) =>
    page.evaluate(({phase,x,pressure,eraser}) => {
      window.__splashLinuxPen?.(eraser ? [phase,x,340,pressure,'eraser'] : [phase,x,340,pressure]);
    },{phase,x,pressure,eraser});
  await page.mouse.move(360,340);
  await packet('down',360,.2);
  await page.mouse.down();
  await packet('move',420,.8);
  await page.mouse.move(420,340);
  await packet('move',565,.8);
  await page.mouse.move(565,340);
  await packet('up',565,.8);
  await page.mouse.up();
  await check(expression('const PEN_DRAWN: &str = r#"'));
  const checkStep = (status: string) => check(expression(`("${status}", r#"`));
  await checkStep('eraser ready');
  await page.mouse.move(460,340);
  await packet('down',460,null,true);
  await page.mouse.down();
  await packet('up',460,null,true);
  await page.mouse.up();
  await checkStep('eraser verified');
  await page.keyboard.press('Control+z');
  await checkStep('eraser undo verified');
  await page.keyboard.press('Control+Shift+z');
  await checkStep('pen verified');
});

for (const drawing of ['object', 'merge'] as const)
test(`repeated curved erasure keeps remote ellipse handles and exact history in ${drawing} mode`, async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 280;
  project.layers[0].drawingMode = drawing;
  const ellipse: Vector = {
    id: 'ellipse', kind: 'ellipse', x: 40, y: 40, width: 160, height: 160,
    rotation: 0, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
  };
  project.layers[0].keys[0].shapes = [ellipse];
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: p, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.getByLabel('Eraser diameter', { exact: true }).fill('28');
  await page.getByLabel('Eraser mode', { exact: true }).selectOption('fills');
  const canvas = page.getByLabel('Drawing stage', { exact: true }), box = (await canvas.boundingBox())!;
  const read = () => page.evaluate(() =>
    (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0].keys[0].shapes);
  const pixels = () => canvas.evaluate(n => {
    const c = n as HTMLCanvasElement, ctx = c.getContext('2d')!;
    return [[186, 120], [164, 62], [45, 120]].map(([x, y]) => Array.from(ctx.getImageData(
      c.width / 2 + (x - 200) * devicePixelRatio,
      c.height / 2 + (y - 140) * devicePixelRatio, 1, 1,
    ).data));
  });
  const cut = async (from: [number, number], to: [number, number]) => {
    const x = box.x + box.width / 2 - 200, y = box.y + box.height / 2 - 140;
    await page.mouse.move(x + from[0], y + from[1]);
    await page.mouse.down();
    await page.mouse.move(x + to[0], y + to[1], { steps: 8 });
    await page.mouse.up();
    await page.mouse.move(x + 250, y + 220);
  };
  const red = [255, 0, 0, 255], white = [255, 255, 255, 255];
  const retainedHandles = (shape: Vector) => {
    const a = shape.contours?.flat().find(node => Math.abs(worldPoint(shape, node).x - 40) < 1e-7);
    expect(a?.in).toBeDefined();
    expect(a?.out).toBeDefined();
    return [worldPoint(shape, a!.in!), worldPoint(shape, a!.out!)];
  };
  await expect.poll(pixels).toEqual([red, red, red]);
  await cut([190, 100], [190, 140]);
  await expect.poll(async () => (await read())[0].kind).toBe('polygon');
  const first = await read(), handles = retainedHandles(first[0]);
  await expect.poll(pixels).toEqual([white, red, red]);
  await cut([160, 57], [169, 57]);
  await expect.poll(async () => JSON.stringify(await read())).not.toEqual(JSON.stringify(first));
  const second = await read();
  expect(retainedHandles(second[0])).toEqual(handles);
  await expect.poll(pixels).toEqual([white, white, red]);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual(first);
  await canvas.press('Control+z');
  await expect.poll(read).toEqual([ellipse]);
  await canvas.press('Control+Shift+z');
  await canvas.press('Control+Shift+z');
  await expect.poll(read).toEqual(second);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const drawing of ['object', 'merge'])
  for (const mode of ['fills', 'objects']) {
    test(`selected-only ${mode} erasure protects other artwork in ${drawing} mode`, async ({
      page,
    }) => {
      await page.goto('/');
      const canvas = page.getByLabel('Drawing stage'),
        b = (await canvas.boundingBox())!;
      const read = () =>
        page.evaluate(
          () =>
            (JSON.parse(localStorage.getItem('splash-recovery-v1') ?? 'null')?.project as Project | undefined)
              ?.layers[0].keys[0].shapes ?? [],
        );
      await page.getByLabel('Drawing mode').selectOption(drawing);
      await page.getByLabel('Drawing stroke width').fill('0');
      await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
      for (const x of [300, 450]) {
        await page.mouse.move(b.x + x, b.y + 180);
        await page.mouse.down();
        await page.mouse.move(b.x + x + 100, b.y + 300);
        await page.mouse.up();
        await expect.poll(async () => (await read()).length).toBe(x === 300 ? 1 : 2);
      }
      await page.getByRole('button', { name: 'Selection', exact: true }).click();
      await page.mouse.click(b.x + 330, b.y + 220);
      const before = await read(),
        protectedShape = before.reduce((right, shape) => shape.x > right.x ? shape : right);
      await page.getByRole('button', { name: 'Eraser', exact: true }).click();
      await page.getByLabel('Erase selected only').check();
      await page.getByLabel('Eraser mode').selectOption(mode);
      await page.mouse.move(b.x + 280, b.y + 240);
      await page.mouse.down();
      await page.mouse.move(b.x + 570, b.y + 240, { steps: 20 });
      await page.mouse.up();
      await expect
        .poll(async () => JSON.stringify(await read()) !== JSON.stringify(before))
        .toBe(true);
      expect((await read()).find((s) => s.id === protectedShape.id)).toEqual(protectedShape);
      if (mode === 'objects') expect(await read()).toEqual([protectedShape]);
      await canvas.focus();
      await page.keyboard.press('Control+z');
      expect(await read()).toEqual(before);
      // Undo clears selection: Selected only must now be a no-op.
      await page.mouse.click(b.x + 330, b.y + 220);
      expect(await read()).toEqual(before);
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
  }

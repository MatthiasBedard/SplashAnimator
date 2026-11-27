import { expect, test } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';

for (const kind of ['line–cubic', 'cubic–cubic'] as const)
test(`Pen snaps to a reflected affine ${kind} crossing and clears its cue on Alt and Escape`, async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 300;
  project.layers[0].drawingMode = 'object';
  const curve: Vector = {
    id: 'curve', kind: 'bezier', x: 220, y: 80, width: 160, height: 100,
    rotation: 0, transform: [-1, .2, .3, 1], fill: '#000000', stroke: '#000000',
    strokeWidth: 2, fillEnabled: false, points: [], nodes: [
      { x: 0, y: 0, out: { x: 30, y: 100 } }, { x: 160, y: 0, in: { x: 130, y: 100 } },
    ],
  };
  let other: Vector = { ...curve, id: 'edge', kind: 'line', nodes: undefined,
    points: [{ x: 0, y: 56.25 }, { x: 160, y: 56.25 }] };
  // Default line–cubic case crosses at local t=1/4. The two parabolas cross at t=1/2.
  let crossing = { x: 203.4375, y: 142.9375 };
  if (kind === 'cubic–cubic') {
    Object.assign(curve, { x: 250, y: 80, height: 160, transform: [-1, .25, .5, 1], nodes: [
      { x: 0, y: 0, out: { x: 160 / 3, y: 0 } },
      { x: 160, y: 160, in: { x: 320 / 3, y: 160 / 3 } },
    ] });
    other = { ...curve, id: 'second-curve', nodes: [
      { x: 0, y: 80, out: { x: 160 / 3, y: 80 } },
      { x: 160, y: -80, in: { x: 320 / 3, y: 80 - 160 / 3 } },
    ] };
    crossing = { x: 190, y: 140 };
  }
  project.layers[0].keys[0].shapes = [curve, other];
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: p, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to objects', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read(), box = (await stage.boundingBox())!;
  const x = box.x + box.width / 2 - 200, y = box.y + box.height / 2 - 150;
  const cue = () => stage.evaluate((canvas: HTMLCanvasElement, point) => {
    const ctx = canvas.getContext('2d')!, scale = devicePixelRatio;
    const cx = canvas.width / 2 + (point.x - 200) * scale;
    const cy = canvas.height / 2 + (point.y - 150) * scale;
    return [[-3, -3], [3, -3], [-3, 3], [3, 3]].some(([dx, dy]) => {
      const data = ctx.getImageData(Math.floor(cx + dx * scale) - 1, Math.floor(cy + dy * scale) - 1, 3, 3).data;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] > 200 && data[i + 1] < 175 && data[i + 2] > 100 && data[i + 2] < 210) return true;
      return false;
    });
  }, crossing);
  const near = { x: x + crossing.x + 3, y: y + crossing.y + 3 };
  await page.mouse.move(near.x, near.y);
  await expect.poll(cue).toBe(true);
  await stage.press('Escape');
  await expect.poll(cue).toBe(false);
  expect(await read()).toEqual(before);

  await page.mouse.move(near.x - 1, near.y);
  await expect.poll(cue).toBe(true);
  await page.mouse.click(near.x, near.y);
  await page.mouse.click(x + 275, y + 180);
  await stage.press('Enter');
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(3);
  const snapped = await read();
  expect(snapped.layers[0].keys[0].shapes.slice(0, 2)).toEqual(before.layers[0].keys[0].shapes);
  const first = (p: Project) => {
    const pen = p.layers[0].keys[0].shapes[2];
    return { x: pen.x + pen.nodes![0].x, y: pen.y + pen.nodes![0].y };
  };
  expect(first(snapped).x).toBeCloseTo(crossing.x, 8);
  expect(first(snapped).y).toBeCloseTo(crossing.y, 8);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(before);
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(snapped);
  await stage.press('Control+z');

  await page.mouse.move(near.x, near.y);
  await expect.poll(cue).toBe(true);
  await page.keyboard.down('Alt');
  await page.mouse.move(near.x + .2, near.y);
  await expect.poll(cue).toBe(false);
  await page.mouse.click(near.x, near.y);
  await page.keyboard.up('Alt');
  await page.mouse.click(x + 275, y + 180);
  await stage.press('Enter');
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(3);
  const bypass = first(await read());
  expect(bypass.x - crossing.x).toBeGreaterThan(2);
  expect(bypass.y - crossing.y).toBeGreaterThan(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Pen previews and saves a true tangent from the previous anchor', async ({ page }) => {
  const project = newProject();
  project.width = 400;
  project.height = 300;
  project.layers[0].drawingMode = 'object';
  const curve: Vector = {
    id: 'parabola', kind: 'bezier', x: 250, y: 80, width: 160, height: 160,
    rotation: 0, transform: [-1, .25, .5, 1], fill: '#000000', stroke: '#000000',
    strokeWidth: 2, fillEnabled: false, points: [], nodes: [
      { x: 0, y: 0, out: { x: 160 / 3, y: 0 } },
      { x: 160, y: 160, in: { x: 320 / 3, y: 160 / 3 } },
    ],
  };
  project.layers[0].keys[0].shapes = [curve];
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: p, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to objects', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const stage = page.getByLabel('Drawing stage', { exact: true }), box = (await stage.boundingBox())!;
  const x = box.x + box.width / 2 - 200, y = box.y + box.height / 2 - 150;
  // World points from the authored transform of A=(80,30) and B(1/4)=(40,10).
  const begin = () => page.mouse.click(x + 185, y + 130);
  const near = { x: x + 218, y: y + 103 };
  const hover = () => page.mouse.move(near.x, near.y);
  const cue = () => stage.evaluate((canvas: HTMLCanvasElement) => {
    const dpr = devicePixelRatio;
    const data = canvas.getContext('2d')!.getImageData(
      Math.floor(canvas.width / 2 + 19 * dpr) - 1, Math.floor(canvas.height / 2 - 53 * dpr) - 1, 3, 3,
    ).data;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 200 && data[i + 1] < 175 && data[i + 2] > 100 && data[i + 2] < 210) return true;
    return false;
  });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await begin();
  await hover();
  await expect.poll(cue).toBe(true);
  await stage.press('Escape');
  await expect.poll(cue).toBe(false);
  expect(await read()).toEqual(before);

  await begin();
  await hover();
  await expect.poll(cue).toBe(true);
  await stage.press('Backspace');
  await expect.poll(cue).toBe(false);
  expect(await read()).toEqual(before);

  await begin();
  await hover();
  await expect.poll(cue).toBe(true);
  await page.mouse.down();
  await page.mouse.move(near.x + 1, near.y);
  await page.mouse.up();
  await stage.press('Enter');
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(2);
  const snapped = await read(), pen = snapped.layers[0].keys[0].shapes[1];
  expect(pen.nodes).toHaveLength(2);
  const [start, end] = pen.nodes!;
  expect(start.out).toBeUndefined();
  expect(end.in).toBeUndefined();
  expect(pen.x + start.x).toBeCloseTo(185, 7);
  expect(pen.y + start.y).toBeCloseTo(130, 7);
  expect(pen.x + end.x).toBeCloseTo(215, 7);
  expect(pen.y + end.y).toBeCloseTo(100, 7);
  expect(snapped.layers[0].keys[0].shapes[0]).toEqual(before.layers[0].keys[0].shapes[0]);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(before);
  await stage.press('Control+Shift+z');
  await expect.poll(read).toEqual(snapped);
  await stage.press('Control+z');

  await begin();
  await hover();
  await expect.poll(cue).toBe(true);
  await page.keyboard.down('Alt');
  await expect.poll(cue).toBe(false);
  await page.mouse.click(near.x, near.y);
  await page.keyboard.up('Alt');
  await stage.press('Enter');
  await expect.poll(async () => (await read()).layers[0].keys[0].shapes.length).toBe(2);
  const bypass = (await read()).layers[0].keys[0].shapes[1];
  expect(bypass.x + bypass.nodes![1].x).toBeCloseTo(218, 0);
  expect(bypass.y + bypass.nodes![1].y).toBeCloseTo(103, 0);
});

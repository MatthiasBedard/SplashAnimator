import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { worldPoint } from '../../packages/geometry/src';

async function setup(page: Page, mode: 'merge' | 'object' = 'merge', kind = 'fill', held = false) {
  const p = newProject();
  p.width = 400;
  p.height = 260;
  p.layers[0].drawingMode = mode;
  const shape: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 40,
    y: 60,
    width: 100,
    height: 80,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  if (kind === 'curve')
    Object.assign(shape, {
      kind: 'bezier',
      fillEnabled: false,
      stroke: '#ff0000',
      strokeWidth: 6,
      nodes: [
        { x: 0, y: 0, out: { x: 30, y: 10 } },
        { x: 100, y: 0, in: { x: 70, y: -10 } },
      ],
      drawingMode: 'merge',
    });
  p.layers[0].keys[0].shapes = [
    shape,
    { ...shape, id: 'other', x: 230, fill: '#0000ff', stroke: '#0000ff' },
  ];
  if (held) await holdGeometry(page);
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
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const canvas = page.getByLabel('Drawing stage', { exact: true }),
    b = (await canvas.boundingBox())!;
  await page.mouse.click(
    b.x + b.width / 2 + 65 - 200,
    b.y + b.height / 2 + (kind === 'curve' ? 63 : 85) - 130,
  );
  await expect(page.getByLabel('Object opacity', { exact: true })).toBeVisible();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const settle = () => expect(page.locator('main.editor')).not.toHaveAttribute('inert', '');
  return { p, read, settle, canvas };
}

for (const mode of ['merge', 'object'] as const)
  for (const tool of ['Selection', 'Subselection', 'Brush', 'Pencil'] as const)
    test(`${mode} property edits keep the original artwork selected with ${tool} active`, async ({
      page,
    }) => {
      const f = await setup(page, mode);
      await page.getByRole('button', { name: tool, exact: true }).click();
      await page.getByLabel('Selected fill', { exact: true }).fill('#00ff00');
      await f.settle();
      await expect(page.getByLabel('Selected fill', { exact: true })).toHaveValue('#00ff00');
      await page.getByLabel('Object opacity', { exact: true }).fill('40');
      await page.getByLabel('Object opacity', { exact: true }).press('Tab');
      await f.settle();
      await expect(page.getByLabel('Object opacity', { exact: true })).toHaveValue('40');
      await page.getByLabel('Selected fill', { exact: true }).fill('#ffff00');
      await f.settle();
      await expect(page.getByLabel('Selected fill', { exact: true })).toHaveValue('#ffff00');
      const result = await f.read(),
        art = result.layers[0].keys[0].shapes;
      expect(art.filter((s) => s.fill === '#ffff00' && s.opacity === 0.4)).toHaveLength(1);
      expect(art.filter((s) => s.fill === '#0000ff')).toHaveLength(1);
      await f.canvas.focus();
      for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.p);
      for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Shift+z');
      await expect.poll(f.read).toEqual(result);
    });

test('gradient controls retain selection through repeated opacity and stop edits', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByLabel('Fill type', { exact: true }).selectOption('linear');
  await f.settle();
  await page.getByRole('button', { name: 'Transform gradient (F)', exact: true }).click();
  await page.getByLabel('Gradient opacity 1', { exact: true }).fill('35');
  await page.getByLabel('Gradient opacity 1', { exact: true }).press('Tab');
  await f.settle();
  await expect(page.getByLabel('Gradient opacity 1', { exact: true })).toHaveValue('35');
  await page.getByLabel('Gradient color 2', { exact: true }).fill('#00ffff');
  await f.settle();
  await expect(page.getByLabel('Gradient color 2', { exact: true })).toHaveValue('#00ffff');
  await page.getByLabel('Object opacity', { exact: true }).fill('60');
  await page.getByLabel('Object opacity', { exact: true }).press('Tab');
  await f.settle();
  await expect(page.getByLabel('Object opacity', { exact: true })).toHaveValue('60');
  const art = (await f.read()).layers[0].keys[0].shapes;
  expect(
    art.filter(
      (s) =>
        s.gradient?.stops[0].opacity === 0.35 &&
        s.gradient.stops[1].color === '#00ffff' &&
        s.opacity === 0.6,
    ),
  ).toHaveLength(1);
});

test('unfilled Pencil curves remain selected for repeated stroke and opacity changes', async ({
  page,
}) => {
  const f = await setup(page, 'merge', 'curve');
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await page.getByLabel('Selected stroke', { exact: true }).fill('#00ff00');
  await f.settle();
  await expect(page.getByLabel('Selected stroke', { exact: true })).toHaveValue('#00ff00');
  await page.getByLabel('Object opacity', { exact: true }).fill('50');
  await page.getByLabel('Object opacity', { exact: true }).press('Tab');
  await f.settle();
  await expect(page.getByLabel('Object opacity', { exact: true })).toHaveValue('50');
  await page.getByLabel('Stroke width', { exact: true }).fill('9');
  await page.getByLabel('Stroke width', { exact: true }).press('Tab');
  await f.settle();
  await expect(page.getByLabel('Stroke width', { exact: true })).toHaveValue('9');
  const art = (await f.read()).layers[0].keys[0].shapes;
  expect(art.find((s) => s.stroke === '#00ff00')).toMatchObject({
    kind: 'bezier',
    fillEnabled: false,
    opacity: 0.5,
    strokeWidth: 9,
    nodes: f.p.layers[0].keys[0].shapes[0].nodes,
  });
});

test('failed property rebuild restores both artwork and selection for an unreselected retry', async ({
  page,
}) => {
  const f = await setup(page, 'merge', 'fill', true);
  await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  await page.getByLabel('Selected fill', { exact: true }).fill('#00ff00');
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page, true);
  await f.settle();
  expect(await f.read()).toEqual(f.p);
  await expect(page.getByLabel('Selected fill', { exact: true })).toHaveValue('#ff0000');
  await page.getByLabel('Selected fill', { exact: true }).fill('#ffff00');
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await f.settle();
  await expect(page.getByLabel('Selected fill', { exact: true })).toHaveValue('#ffff00');
});

test('multiple selected pieces remain selected for successive property edits', async ({ page }) => {
  const f = await setup(page);
  await f.canvas.focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.getByLabel('Object opacity', { exact: true }).fill('45');
  await page.getByLabel('Object opacity', { exact: true }).press('Tab');
  await f.settle();
  await expect(page.locator('.inspector-title strong')).toHaveText('2 objects');
  await page.getByLabel('Selected fill', { exact: true }).fill('#00ff00');
  await f.settle();
  await expect(page.locator('.inspector-title strong')).toHaveText('2 objects');
  expect(
    (await f.read()).layers[0].keys[0].shapes.every(
      (s) => s.fill === '#00ff00' && s.opacity === 0.45,
    ),
  ).toBe(true);
});

test('property edits retain the actual selected curve anchor for a later nudge', async ({
  page,
}) => {
  const f = await setup(page, 'merge', 'curve');
  await page.getByRole('button', { name: 'Subselection', exact: true }).click();
  const b = (await f.canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2 + 40 - 200, b.y + b.height / 2 + 60 - 130);
  await page.getByLabel('Object opacity', { exact: true }).fill('45');
  await page.getByLabel('Object opacity', { exact: true }).press('Tab');
  await f.settle();
  await expect(page.getByLabel('Object opacity', { exact: true })).toHaveValue('45');
  await f.canvas.focus();
  await page.keyboard.press('ArrowRight');
  await f.settle();
  const shape = (await f.read()).layers[0].keys[0].shapes.find((s) => s.opacity === 0.45)!;
  expect(worldPoint(shape, shape.nodes![0])).toEqual({ x: 41, y: 60 });
  expect(worldPoint(shape, shape.nodes![1])).toEqual({ x: 140, y: 60 });
});

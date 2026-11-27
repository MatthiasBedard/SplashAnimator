import { test, expect, type Page } from '@playwright/test';
import { newProject, type Project } from '../../packages/document/src';
import { objectBounds } from '../../packages/geometry/src';
import { symbolInstance } from '../../packages/geometry/src/symbols';

async function recoverProject(page: Page, project: Project) {
  await page.addInitScript(source => localStorage.setItem('splash-recovery-v1',
    JSON.stringify({ project: source, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
}

test('equal gaps respect groups and undo as one edit', async ({ page }) => {
  const project = newProject();
  project.layers[0].drawingMode = 'object';
  project.layers[0].keys[0].shapes = [[100, 30], [145, 25], [220, 80], [500, 40]].map(([x, width], i) => ({
    id: `rect-${i}`, kind: 'rectangle', x, y: 200, width, height: 50, rotation: 0,
    fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
    ...(i < 2 ? { groups: ['drawing-group'] } : {}),
  }));
  await recoverProject(page, project);
  const panel = page.getByRole('region', { name: 'Align and distribute', exact: true });
  const stage = page.getByLabel('Drawing stage');
  const read = () =>
    page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project).layers[0]
          .keys[0].shapes,
    );
  await stage.focus();
  await page.keyboard.press('Control+a');
  const before = await read();
  expect(before[0].groups?.length).toBe(1);
  await panel.getByRole('button', { name: 'Distribute horizontal gaps', exact: true }).click();
  const after = await read();
  const bounds = after.map(objectBounds);
  expect(bounds[2].left - Math.max(bounds[0].right, bounds[1].right)).toBeCloseTo(
    bounds[3].left - bounds[2].right,
  );
  expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
  expect(after[3]).toEqual(before[3]);
  expect(after[2].x).not.toBe(before[2].x);
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await stage.focus();
  await page.keyboard.press('Control+a');
  await panel.getByRole('button', { name: 'Distribute horizontal centers', exact: true }).click();
  const spaced = (await read()).map(objectBounds);
  const groupCenter =
    (Math.min(spaced[0].left, spaced[1].left) + Math.max(spaced[0].right, spaced[1].right)) / 2;
  expect((spaced[2].left + spaced[2].right) / 2).toBeCloseTo(
    (groupCenter + (spaced[3].left + spaced[3].right) / 2) / 2,
  );
  await page.getByLabel('Align to stage', { exact: true }).check();
  await page.getByRole('button', { name: 'Align center', exact: true }).click();
  const aligned = await read();
  const alignedBounds = aligned.map(objectBounds);
  expect(
    (Math.min(alignedBounds[0].left, alignedBounds[1].left) +
      Math.max(alignedBounds[0].right, alignedBounds[1].right)) /
      2,
  ).toBeCloseTo(480);
  expect(aligned[1].x - aligned[0].x).toBeCloseTo(before[1].x - before[0].x);
  await stage.focus();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(before);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const mode of ['loop', 'movie'] as const) {
  test(`Align and Distribute is an independent Properties panel for ${mode === 'movie' ? 'a movie clip' : 'a graphic symbol'}`, async ({ page }) => {
    const project = newProject();
    project.layers[0].drawingMode = 'object';
    const definition = {
      id: 'badge', name: 'Badge', width: 40, height: 30,
      shapes: [{
        id: 'art', kind: 'rectangle' as const, x: 0, y: 0, width: 40, height: 30,
        fill: '#ff0000', stroke: '#000000', strokeWidth: 0, rotation: 0, points: [],
      }],
    };
    project.symbols = [definition];
    const instance = symbolInstance(definition, 120, 140);
    instance.symbolPlayback = { mode, firstFrame: 0 };
    project.layers[0].keys[0].shapes = [instance];
    await recoverProject(page, project);
    const stage = page.getByLabel('Drawing stage', { exact: true });
    const panel = page.getByRole('region', { name: 'Align and distribute', exact: true });
    await expect(panel).toHaveCount(0);
    await stage.press('Control+a');
    const symbol = page.getByRole('region', { name: 'Symbol instance', exact: true });
    await expect(symbol).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(symbol.getByLabel('Align to stage', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Align to stage', { exact: true })).toHaveCount(1);
    const collapse = page.getByRole('button', { name: 'Collapse Align and distribute panel', exact: true });
    await collapse.click();
    await expect(panel).toBeHidden();
    await expect(symbol).toBeVisible();
    await collapse.click();
    await panel.getByLabel('Align to stage', { exact: true }).check();
    await panel.getByRole('button', { name: 'Align center', exact: true }).click();
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
    await expect.poll(async () => (await read()).layers[0].keys[0].shapes[0]).toEqual({
      ...instance, x: (project.width - definition.width) / 2,
    });
    await stage.press('Control+z');
    await expect.poll(read).toEqual(project);
  });
}

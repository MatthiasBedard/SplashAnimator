import { expect, test, type Page } from '@playwright/test';
import { newProject, type Project, type Vector } from '../../packages/document/src';
import { prepareCreateLiveMotionSpans } from '../../packages/animation/src/live-motion';

async function setup(page: Page) {
  let p = newProject();
  p.width = 200;
  p.height = 100;
  p.duration = 12;
  const rect = (id: string, x: number, y: number, rotation: number, fill: string): Vector => ({
    id,
    kind: 'rectangle',
    x,
    y,
    width: 12,
    height: 12,
    rotation,
    fill,
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['outer', 'inner'],
  });
  p.layers[0].id = 'group';
  p.layers[0].name = 'Group';
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys = [
    { frame: 0, shapes: [rect('a', 0, 20, 0, '#ff0000'), rect('b', 40, 20, 0, '#0000ff')] },
    { frame: 8, shapes: [rect('a', 80, 20, 90, '#ff0000'), rect('b', 80, 60, 90, '#0000ff')] },
    { frame: 10, shapes: [] },
  ];
  p = prepareCreateLiveMotionSpans(p, [
    {
      layerId: 'group',
      span: {
        id: 'live-group',
        start: 0,
        end: 8,
        ease: 'linear',
        rotation: { direction: 'shortest', turns: 0, rigidGroups: true },
        path: { startX: 0, startY: 0, endX: 0, endY: 0 },
      },
    },
  ]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
  await page.getByLabel('Timeline frames').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Live stage status')).toContainText('read-only');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  return { p, read, errors };
}
async function pixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage').evaluate(
    (e, { p, x, y }) => {
      const c = e as HTMLCanvasElement,
        d = devicePixelRatio;
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(
            c.width / 2 + (x - p.width / 2) * d,
            c.height / 2 + (y - p.height / 2) * d,
            1,
            1,
          ).data,
      );
    },
    { p, x, y },
  );
}
async function command(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true });
  if (!(await button.isVisible()))
    await page.getByRole('button', { name: 'Control', exact: true }).click();
  await button.click();
}
test('admitted complete groups paint independent rigid world positions without authored key expansion', async ({
  page,
}) => {
  const f = await setup(page);
  await expect.poll(() => pixel(page, f.p, 40, 28)).toEqual([255, 0, 0, 255]);
  await expect.poll(() => pixel(page, f.p, 68, 56)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(page, f.p, 6, 26)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(f.p);
  expect((await f.read()).layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  expect(f.errors).toEqual([]);
});
test('plain-root authoring scopes stay unavailable and group metadata removal retains one undoable recovery', async ({
  page,
}) => {
  const f = await setup(page);
  await command(page, 'Edit live curve controls…');
  await expect(page.getByLabel('Live curve status')).toContainText('No original');
  await expect(
    page.getByRole('button', { name: 'Commit live curve control', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close live curve controls', exact: true }).click();
  await command(page, 'Edit live tween…');
  const dialog = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  await expect(
    dialog.getByLabel('Edit live tween Group frames 1–9', { exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText('explicitly include complete-group recipes to edit');
  await dialog.getByLabel('Edit live tween Group frames 1–9', { exact: true }).evaluate((el) => {
    const input = el as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await dialog.getByLabel('Live trajectory mode', { exact: true }).selectOption('remove');
  await dialog.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('plain-root');
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await command(page, 'Remove live tween…');
  const remove = page.getByRole('dialog', { name: 'Remove live tween', exact: true });
  await remove.getByRole('button', { name: 'Remove live tween', exact: true }).click();
  const expected = structuredClone(f.p);
  delete expected.layers[0].liveMotionSpans;
  await expect.poll(f.read).toEqual(expected);
  const canvas = page.getByLabel('Drawing stage');
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.p);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
  expect(f.errors).toEqual([]);
});

import { expect, test, type Page } from '@playwright/test';
import { symbolStageSimplifyFixture } from '../symbol-stage-simplify-fixture';
import { prepareSymbolSimplifyRequest } from '../../packages/geometry/src/symbol-simplify-request';
import type { Project } from '../../packages/document/src';
import { updateSymbolTimeline } from '../../packages/geometry/src/symbols';
import { prepareSmoothSelection } from '../../packages/geometry/src/smooth-selection';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
const issues = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => expect(issues.get(page) ?? []).toEqual([]));
async function setup(
  page: Page,
  nested = false,
  animated = false,
  held = false,
  depth = 1,
) {
  const errors: string[] = [];
  issues.set(page, errors);
  page.on('pageerror', (e) => errors.push(String(e)));
  const f = symbolStageSimplifyFixture(nested, animated, depth);
  if (held) await holdGeometry(page);
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    f.input.project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    before = await read();
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Edit symbol in stage context', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true }),
    timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  if (nested)
    for (let i = 0; i < depth; i++)
      await editor
        .getByRole('button', { name: 'Open nested symbol in stage context', exact: true })
        .click();
  if (animated) {
    await expect(timeline.getByLabel('Symbol frame', { exact: true })).toHaveValue('5');
    await timeline.getByRole('button', { name: 'Edit symbol frame artwork', exact: true }).click();
  }
  await expect(editor.getByText('Editing in stage context.', { exact: false })).toBeVisible();
  const pixels = () =>
    editor
      .getByLabel('Symbol artwork preview', { exact: true })
      .evaluate((n: HTMLCanvasElement) => {
        const c = n.getContext('2d')!,
          d = c.getImageData(0, 0, n.width, n.height).data;
        let red = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i] > 160 && d[i + 1] < 90 && d[i + 2] < 90) red++;
        return { red, reference: Array.from(c.getImageData(480, 260, 1, 1).data) };
      });
  const expected = (ancestry?: string[]) => {
    const out = prepareSymbolSimplifyRequest({
      ...f.input,
      project: before,
      ...(ancestry ? { ancestry } : {}),
    });
    if (!animated) return out;
    const project = structuredClone(before);
    updateSymbolTimeline(project, 'art', out.project.symbols![0]);
    return { ...out, project };
  };
  return { ...f, before, read, editor, timeline, pixels, expected };
}
for (const [nested, animated, group, depth] of [
  [false, false, false, 1],
  [true, false, false, 1],
  [false, true, false, 1],
  [true, true, false, 1],
  [true, false, true, 1],
  [true, true, false, 2],
] as const)
  test(`${nested ? `nested depth ${depth}` : 'root'} ${animated ? 'button frame' : 'static'} stage Simplify${group ? ' in isolated group' : ''} retains complete history and original surroundings`, async ({
    page,
  }) => {
    const f = await setup(page, nested, animated, false, depth),
      out = f.expected(group ? ['outer'] : undefined);
    await expect.poll(async () => (await f.pixels()).red).toBeGreaterThan(200);
    const originalPixels = await f.pixels();
    expect(originalPixels.reference[2]).toBe(255);
    expect(originalPixels.reference[0]).toBeGreaterThan(170);
    expect(originalPixels.reference[0]).toBeLessThan(190);
    let local = f.editor;
    if (group) {
      await local
        .getByRole('button', { name: 'Edit symbol group in isolation', exact: true })
        .click();
      local = page.getByRole('dialog', { name: 'Edit isolated symbol group', exact: true });
    }
    await local
      .getByRole('button', { name: 'Simplify selected symbol artwork', exact: true })
      .click();
    await expect(
      local.getByText(`Removed ${out.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    for (const label of ['Undo artwork change', 'Redo artwork change']) {
      await local.getByRole('button', { name: label, exact: true }).click();
      await expect(local.getByLabel('Symbol artwork item', { exact: true })).toHaveValue('line');
    }
    expect(await f.read()).toEqual(f.before);
    if (group) {
      await local.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
      for (const label of ['Undo artwork change', 'Redo artwork change'])
        await f.editor.getByRole('button', { name: label, exact: true }).click();
    }
    expect((await f.pixels()).reference).toEqual(originalPixels.reference);
    await expect.poll(async () => (await f.pixels()).red).toBeGreaterThan(200);
    await f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    if (animated) {
      for (const label of ['Undo symbol timeline change', 'Redo symbol timeline change'])
        await f.timeline.getByRole('button', { name: label, exact: true }).click();
      await f.timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    }
    await expect.poll(f.read).toEqual(out.project);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(out.project);
  });
test('shared nested single-frame Button Simplify can cancel and retry before saving', async ({ page }) => {
  const errors: string[] = [];
  issues.set(page, errors);
  page.on('pageerror', error => errors.push(String(error)));
  const project = symbolStageSimplifyFixture(true).input.project;
  const button = project.symbols![0];
  button.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  const expected = structuredClone(project);
  const reduced = prepareSmoothSelection(button.shapes, { selected: button.shapes.map(shape => shape.id), simplify: true });
  expect(reduced.removed).toBeGreaterThan(0);
  expected.symbols![0].shapes = reduced.artwork;
  await holdGeometry(page);
  await page.addInitScript(p => localStorage.setItem('splash-recovery-v1', JSON.stringify({ project: p, folder: null, manifest: null })), project);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const stage = page.getByLabel('Drawing stage', { exact: true });
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const edit = page.getByRole('button', { name: 'Edit symbol in stage context', exact: true });
  for (const name of ['Stage parent', button.name]) {
    await stage.press('Control+a');
    await edit.click();
    await expect(page.getByRole('navigation', { name: 'Symbol edit breadcrumbs' })).toContainText(name);
  }
  const pixels = () => stage.evaluate((canvas: HTMLCanvasElement) => {
    const c = canvas.getContext('2d')!, d = c.getImageData(0, 0, canvas.width, canvas.height).data;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 160 && d[i + 1] < 90 && d[i + 2] < 90) red++;
    return { red, reference: Array.from(c.getImageData(Math.floor(canvas.width / 2 + 210 * scale), Math.floor(canvas.height / 2 + 95 * scale), 1, 1).data) };
  });
  await stage.press('Control+a');
  const simplify = page.getByRole('button', { name: 'Simplify selected artwork', exact: true });
  await expect(simplify).toBeEnabled();
  await expect.poll(async () => (await pixels()).red).toBeGreaterThan(200);
  const before = await pixels();
  expect(before.reference).toEqual([178, 178, 255, 255]);
  await simplify.click();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.getByRole('button', { name: 'Cancel simplification', exact: true }).click();
  expect(await read()).toEqual(project);
  await expect.poll(pixels).toEqual(before);
  await simplify.click();
  await expect.poll(() => pendingGeometry(page)).toBe(2);
  await stage.press('Escape');
  await expect(simplify).toBeEnabled();
  await simplify.click();
  await expect.poll(() => pendingGeometry(page)).toBe(3);
  await releaseGeometry(page);
  await expect(page.getByText(`Removed ${reduced.removed} vertices from selection`, { exact: true })).toBeVisible();
  expect(await read()).toEqual(project);
  await expect.poll(async () => (await pixels()).red).not.toBe(before.red);
  const after = await pixels();
  expect(after.reference).toEqual(before.reference);
  await stage.press('Control+z');
  await stage.press('Control+a');
  await expect.poll(pixels).toEqual(before);
  await stage.press('Control+Shift+z');
  await stage.press('Control+a');
  await expect.poll(pixels).toEqual(after);
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  await expect.poll(read).toEqual(expected);
  await stage.press('Control+z');
  await expect.poll(read).toEqual(project);
});
test('stage pending Simplify cancellation and late replies keep the document exact and permit retry', async ({
  page,
}) => {
  const f = await setup(page, true, false, true),
    button = f.editor.getByRole('button', {
      name: 'Simplify selected symbol artwork',
      exact: true,
    });
  await button.click();
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await f.editor.getByRole('button', { name: 'Cancel symbol simplification', exact: true }).click();
  await releaseGeometry(page);
  expect(await f.read()).toEqual(f.before);
  await button.click();
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await releaseGeometry(page);
  await expect(f.editor.getByText(/Removed \d+ vertices/)).toBeVisible();
  await f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
});
for (const animated of [false, true])
  for (const action of ['source', 'target'] as const)
    test(`nested ${animated ? 'frame' : 'static'} stage late ${action} after complete recovery preparation rejects stale publication`, async ({
      page,
    }) => {
      const f = await setup(page, true, animated);
      await f.editor
        .getByRole('button', { name: 'Simplify selected symbol artwork', exact: true })
        .click();
      await expect(f.editor.getByText(/Removed \d+ vertices/)).toBeVisible();
      if (animated) {
        await f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
      }
      await page.evaluate(
        ({ action, animated }) => {
          const native = JSON.stringify;
          JSON.stringify = function (value: unknown, ...args: unknown[]) {
            const text = Reflect.apply(native, JSON, [value, ...args]),
              p = value as { project?: Project };
            const d = p?.project?.symbols?.find((s) => s.id === 'art'),
              shapes = animated ? d?.timeline?.keys.find((k) => k.frame === 4)?.shapes : d?.shapes;
            if (shapes?.[0]?.nodes) {
              JSON.stringify = native;
              document.documentElement.dataset.stageSimplifyLate = 'yes';
              const n = document.querySelector(
                `input[aria-label="${action === 'source' ? 'Layer name' : animated ? 'Symbol duration' : 'Symbol artwork x'}"]`,
              ) as HTMLInputElement;
              n.value = action === 'source' ? 'Changed source' : animated ? '13' : '55';
              n.dispatchEvent(new Event('input', { bubbles: true }));
              n.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return text;
          } as typeof JSON.stringify;
        },
        { action, animated },
      );
      const dialog = animated ? f.timeline : f.editor;
      await dialog
        .getByRole('button', {
          name: animated ? 'Apply symbol timeline' : 'Apply symbol changes',
          exact: true,
        })
        .click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.stageSimplifyLate))
        .toBe('yes');
      await expect(dialog.getByRole('alert')).toContainText(/changed|original/);
      const unchanged = structuredClone(f.before);
      if (action === 'source') unchanged.layers[0].name = 'Changed source';
      await expect.poll(f.read).toEqual(unchanged);
      if (action === 'source') {
        await dialog
          .getByRole('button', {
            name: animated ? 'Cancel symbol timeline' : 'Cancel symbol editing',
            exact: true,
          })
          .click();
        await page.getByLabel('Drawing stage', { exact: true }).focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.before);
      } else {
        const expected = f.expected().project;
        if (animated) expected.symbols![0].timeline!.duration = 13;
        else expected.symbols![0].shapes[0].x = 55;
        await dialog
          .getByRole('button', {
            name: animated ? 'Apply symbol timeline' : 'Apply symbol changes',
            exact: true,
          })
          .click();
        await expect.poll(f.read).toEqual(expected);
      }
    });

test('returning through an original ancestor retires pending work and fresh navigation can Simplify', async ({
  page,
}) => {
  const f = await setup(page, true, false, true);
  await f.editor
    .getByRole('button', { name: 'Simplify selected symbol artwork', exact: true })
    .click();
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await f.editor.getByRole('button', { name: 'Return to Stage parent', exact: true }).click();
  await expect(f.editor.getByRole('heading')).toHaveText('Edit symbol: Stage parent');
  await releaseGeometry(page);
  expect(await f.read()).toEqual(f.before);
  await f.editor
    .getByRole('button', { name: 'Open nested symbol in stage context', exact: true })
    .click();
  await f.editor
    .getByRole('button', { name: 'Simplify selected symbol artwork', exact: true })
    .click();
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await releaseGeometry(page);
  await expect(f.editor.getByText(/Removed \d+ vertices/)).toBeVisible();
  await f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
});
test('an actual source layer edit cancels a pending stage worker without changing local history', async ({
  page,
}) => {
  const f = await setup(page, true, false, true);
  await f.editor
    .getByRole('button', { name: 'Simplify selected symbol artwork', exact: true })
    .click();
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await page.getByLabel('Layer name', { exact: true }).evaluate((n: HTMLInputElement) => {
    n.value = 'Changed source';
    n.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await releaseGeometry(page);
  await expect(
    f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  const expected = structuredClone(f.before);
  expected.layers[0].name = 'Changed source';
  await expect.poll(f.read).toEqual(expected);
  await f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.before);
});

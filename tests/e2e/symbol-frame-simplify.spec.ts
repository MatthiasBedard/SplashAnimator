import { expect, test, type Page } from '@playwright/test';
import { symbolSimplifyFrameFixture } from '../symbol-simplify-frame-fixture';
import { prepareSymbolSimplifyRequest } from '../../packages/geometry/src/symbol-simplify-request';
import { updateSymbolTimeline } from '../../packages/geometry/src/symbols';
import type { Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
const errors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => expect(errors.get(page) ?? []).toEqual([]));
async function setup(page: Page, layer = '@base', at = 4, button = false, held = false, workspaceTools = false) {
  const issues: string[] = [];
  errors.set(page, issues);
  page.on('pageerror', (e) => issues.push(String(e)));
  const input = symbolSimplifyFrameFixture('plain', button);
  input.location = { layerId: layer, frame: at };
  if (held) await holdGeometry(page);
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    input.project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    before = await read();
  await page.getByRole('option', { name: 'Library item Original art', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit timeline', exact: true }).click();
  if (workspaceTools) await page.getByRole('button', { name: 'Timeline tools…', exact: true }).click();
  const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
  await timeline.getByLabel('Symbol layer', { exact: true }).selectOption(layer);
  await timeline.getByLabel('Symbol frame', { exact: true }).fill(String(at + 1));
  await timeline.getByLabel('Symbol frame', { exact: true }).press('Tab');
  await timeline.getByRole('button', { name: 'Edit symbol frame artwork', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  const simplify = () =>
    editor.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true }).click();
  const pixel = () =>
    editor
      .getByLabel('Symbol artwork preview', { exact: true })
      .evaluate((n: HTMLCanvasElement) => {
        const data = n.getContext('2d')!.getImageData(0, 0, n.width, n.height).data;
        let red = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] > 160 && data[i + 1] < 90 && data[i + 2] < 90) red++;
        return red;
      });
  const probe = (x: number, y: number) =>
    editor
      .getByLabel('Symbol artwork preview', { exact: true })
      .evaluate(
        (n: HTMLCanvasElement, p) =>
          Array.from(n.getContext('2d')!.getImageData(p.x, p.y, 1, 1).data),
        { x: 20 + x * Math.min(500 / 400, 290 / 240), y: 20 + y * Math.min(500 / 400, 290 / 240) },
      );
  return { input, before, read, timeline, editor, simplify, pixel, probe };
}
for (const [layer, at, button] of [
  ['@base', 0, false],
  ['@base', 4, true],
  ['detail', 6, false],
] as const)
  test(`original ${layer}/${at} ${button ? 'button' : 'timeline'} Simplify retains local/Apply/document history`, async ({
    page,
  }) => {
    const f = await setup(page, layer, at, button);
    await expect(
      f.editor.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true }),
    ).toBeEnabled();
    await expect.poll(f.pixel).toBeGreaterThan(200);
    await expect.poll(() => f.probe(110, 120)).toEqual([255, 255, 255, 255]);
    await expect.poll(() => f.probe(140, 120)).toEqual([255, 0, 0, 255]);
    const out = prepareSymbolSimplifyRequest({ ...f.input, project: f.before }),
      expected = structuredClone(f.before);
    updateSymbolTimeline(expected, 'art', out.project.symbols![0]);
    await f.simplify();
    await expect(
      f.editor.getByText(`Removed ${out.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    expect(await f.read()).toEqual(f.before);
    await expect.poll(f.pixel).toBeGreaterThan(200);
    await expect.poll(() => f.probe(110, 120)).toEqual([255, 255, 255, 255]);
    await expect.poll(() => f.probe(140, 120)).toEqual([255, 0, 0, 255]);
    await f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await f.editor.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    await expect(f.editor).toHaveCount(0);
    expect(await f.read()).toEqual(f.before);
    await f.timeline
      .getByRole('button', { name: 'Undo symbol timeline change', exact: true })
      .click();
    await f.timeline
      .getByRole('button', { name: 'Redo symbol timeline change', exact: true })
      .click();
    await f.timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    await expect(f.timeline).toHaveCount(0);
    await expect.poll(f.read).toEqual(expected);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(expected);
  });
test('frame Simplify fits an original relative group and keeps parent Cancel unpublished', async ({
  page,
}) => {
  const f = await setup(page, 'detail', 6, true);
  await f.editor
    .getByRole('button', { name: 'Edit symbol group in isolation', exact: true })
    .click();
  const child = page
    .getByRole('dialog', { name: 'Edit isolated symbol group', exact: true })
    .last();
  await child
    .getByRole('button', { name: 'Simplify selected symbol artwork', exact: true })
    .click();
  await expect(child.getByText(/Removed \d+ vertices/)).toBeVisible();
  await child.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  await expect(child).toHaveCount(0);
  await f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await f.editor.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await f.timeline.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
});
test('relative frame-group reduction survives every local parent and document history boundary', async ({
  page,
}) => {
  const f = await setup(page, 'detail', 6, true),
    out = prepareSymbolSimplifyRequest({ ...f.input, project: f.before, ancestry: ['outer'] }),
    expected = structuredClone(f.before);
  updateSymbolTimeline(expected, 'art', out.project.symbols![0]);
  await f.editor
    .getByRole('button', { name: 'Edit symbol group in isolation', exact: true })
    .click();
  const child = page.getByRole('dialog', { name: 'Edit isolated symbol group', exact: true });
  await child
    .getByRole('button', { name: 'Simplify selected symbol artwork', exact: true })
    .click();
  await expect(child.getByText(`Removed ${out.removed} vertices.`, { exact: true })).toBeVisible();
  for (const label of ['Undo artwork change', 'Redo artwork change']) {
    await child.getByRole('button', { name: label, exact: true }).click();
    await expect(child.getByLabel('Symbol artwork item', { exact: true })).toHaveValue('line');
  }
  await child.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  for (const label of ['Undo artwork change', 'Redo artwork change'])
    await f.editor.getByRole('button', { name: label, exact: true }).click();
  await expect.poll(() => f.probe(110, 120)).toEqual([255, 255, 255, 255]);
  await expect.poll(() => f.probe(140, 120)).toEqual([255, 0, 0, 255]);
  await f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  for (const label of ['Undo symbol timeline change', 'Redo symbol timeline change'])
    await f.timeline.getByRole('button', { name: label, exact: true }).click();
  expect(await f.read()).toEqual(f.before);
  await f.timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  await expect.poll(f.read).toEqual(expected);
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.before);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(f.read).toEqual(expected);
});

test('held exposures keep Simplify disabled while ordinary editing stays available', async ({
  page,
}) => {
  const f = await setup(page, '@base', 2);
  await expect(
    f.editor.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true }),
  ).toBeDisabled();
  await expect(
    f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }),
  ).toBeEnabled();
  await f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await f.timeline.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
});
test('pending frame fitting cancels without history and a fresh request succeeds', async ({
  page,
}) => {
  const f = await setup(page, '@base', 4, false, true, true);
  const tool = f.editor.getByLabel('Symbol canvas tool', { exact: true });
  const simplify = f.editor.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true });
  const cancel = f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true });
  const cancelWork = f.editor.getByRole('button', { name: 'Cancel symbol simplification', exact: true });
  await expect(tool).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(tool).toBeFocused();
  await simplify.press('Enter');
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await expect(cancelWork).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancelWork).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(simplify).toBeFocused();
  await releaseGeometry(page);
  expect(await f.read()).toEqual(f.before);
  await page.keyboard.press('Enter');
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await releaseGeometry(page);
  await expect(f.editor.getByText(/Removed \d+ vertices/)).toBeVisible();
  await expect(simplify).toBeFocused();
  const editFrame = f.timeline.getByRole('button', { name: 'Edit symbol frame artwork', exact: true });
  await f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).press('Enter');
  await expect(editFrame).toBeFocused();
  expect(await f.read()).toEqual(f.before);
  await page.keyboard.press('Enter');
  await expect(tool).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editFrame).toBeFocused();
  await f.timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
  const expected = structuredClone(f.before);
  updateSymbolTimeline(expected, 'art', prepareSymbolSimplifyRequest({ ...f.input, project: f.before }).project.symbols![0]);
  await expect.poll(f.read).toEqual(expected);
  await page.getByLabel('Drawing stage', { exact: true }).press('Control+z');
  await expect.poll(f.read).toEqual(f.before);
});

test('changed-and-restored parent frame rejects pending fitting and permits a fresh request', async ({
  page,
}) => {
  const f = await setup(page, '@base', 4, false, true);
  await f.simplify();
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await f.timeline.getByLabel('Symbol frame', { exact: true }).evaluate((n: HTMLInputElement) => {
    for (const value of ['7', '5']) {
      n.value = value;
      n.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await releaseGeometry(page);
  await expect(
    f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.before);
  await f.simplify();
  await expect.poll(() => pendingGeometry(page)).toBeGreaterThan(0);
  await releaseGeometry(page);
  await expect(f.editor.getByText(/Removed \d+ vertices/)).toBeVisible();
  await f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await f.timeline.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
});

for (const action of ['source', 'child-input', 'reentry'] as const)
  test(`late frame Apply ${action} after complete candidate/history preparation cannot publish stale data`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.simplify();
    await expect(f.editor.getByText(/Removed \d+ vertices/)).toBeVisible();
    const prepared = prepareSymbolSimplifyRequest({ ...f.input, project: f.before }).project;
    await page.evaluate((action) => {
      const native = JSON.stringify;
      JSON.stringify = function (value: unknown, ...args: unknown[]) {
        const text = Reflect.apply(native, JSON, [value, ...args]),
          d = value as {
            id?: string;
            timeline?: { keys: { frame: number; shapes: { nodes?: unknown[] }[] }[] };
          };
        if (d?.id === 'art' && d.timeline?.keys.find((k) => k.frame === 4)?.shapes[0]?.nodes) {
          JSON.stringify = native;
          document.documentElement.dataset.frameLocalLate = 'yes';
          if (action === 'source') {
            const e = document.querySelector('input[aria-label="Stage color"]') as HTMLInputElement;
            e.value = '#abcdef';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'child-input') {
            const e = document.querySelector(
              'input[aria-label="Symbol artwork x"]',
            ) as HTMLInputElement;
            e.value = '55';
            e.dispatchEvent(new Event('input', { bubbles: true }));
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'reentry') {
            const d = document.querySelector('dialog[aria-label="Edit symbol artwork"]')!;
            [...d.querySelectorAll('button')]
              .find((b) => b.textContent?.trim() === 'Apply symbol changes')!
              .click();
          }
        }
        return text;
      } as typeof JSON.stringify;
    }, action);
    await f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.frameLocalLate))
      .toBe('yes');
    await expect(f.editor.getByRole('alert')).toContainText(/changed|original|reenter/);
    const expectedSource = structuredClone(f.before);
    if (action === 'source') expectedSource.background = '#abcdef';
    expect(await f.read()).toEqual(expectedSource);
    await expect(
      f.timeline.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
    ).toBeDisabled();
    if (action === 'source') {
      await f.editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
      await f.timeline.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
      await page.getByLabel('Drawing stage', { exact: true }).focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.before);
    } else {
      if (action === 'child-input') {
        await expect(f.editor.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('55');
        prepared.symbols![0].timeline!.keys.find((k) => k.frame === 4)!.shapes[0].x = 55;
      }
      await f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
      await expect(f.editor).toHaveCount(0);
      await f.timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
      const expected = structuredClone(f.before);
      updateSymbolTimeline(expected, 'art', prepared.symbols![0]);
      await expect.poll(f.read).toEqual(expected);
    }
  });

for (const action of ['source', 'restored-frame'] as const)
  test(`late document Apply ${action} after recovery serialization rejects publication`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.simplify();
    await expect(f.editor.getByText(/Removed \d+ vertices/)).toBeVisible();
    await f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    await expect(f.editor).toHaveCount(0);
    await page.evaluate((action) => {
      const native = JSON.stringify;
      JSON.stringify = function (value: unknown, ...args: unknown[]) {
        const text = Reflect.apply(native, JSON, [value, ...args]),
          p = value as { project?: Project };
        if (
          p?.project?.symbols
            ?.find((s) => s.id === 'art')
            ?.timeline?.keys.find((k) => k.frame === 4)?.shapes[0]?.nodes
        ) {
          JSON.stringify = native;
          document.documentElement.dataset.frameDocumentLate = 'yes';
          if (action === 'source') {
            const e = document.querySelector('input[aria-label="Stage color"]') as HTMLInputElement;
            e.value = '#abcdef';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            const e = document.querySelector(
              'input[aria-label="Symbol frame"]',
            ) as HTMLInputElement;
            for (const value of ['7', '5']) {
              e.value = value;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
        return text;
      } as typeof JSON.stringify;
    }, action);
    await f.timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.frameDocumentLate))
      .toBe('yes');
    await expect(f.timeline.getByRole('alert')).toContainText(/changed|reenter/);
    const expectedSource = structuredClone(f.before);
    if (action === 'source') expectedSource.background = '#abcdef';
    await expect.poll(f.read).toEqual(expectedSource);
    if (action === 'source') {
      await f.timeline.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
      await page.getByLabel('Drawing stage', { exact: true }).focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.before);
    } else {
      await f.timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
      const expected = structuredClone(f.before);
      updateSymbolTimeline(
        expected,
        'art',
        prepareSymbolSimplifyRequest({ ...f.input, project: f.before }).project.symbols![0],
      );
      await expect.poll(f.read).toEqual(expected);
    }
  });

test('minimal frame Simplify and Apply add no artwork or timeline history', async ({ page }) => {
  const f = await setup(page);
  await f.editor.getByLabel('Symbol artwork item', { exact: true }).selectOption('other');
  await f.simplify();
  await expect(
    f.editor.getByText('No removable vertices in this selection.', { exact: true }),
  ).toBeVisible();
  await expect(
    f.editor.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await f.editor.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  await expect(
    f.timeline.getByRole('button', { name: 'Undo symbol timeline change', exact: true }),
  ).toBeDisabled();
  await f.timeline.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
});

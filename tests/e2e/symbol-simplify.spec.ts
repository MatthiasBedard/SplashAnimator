import { expect, test, type Page, type Locator } from '@playwright/test';
import { symbolSimplifyFixture } from '../symbol-simplify-fixture';
import {
  prepareSymbolSimplifyRequest,
  type SymbolSimplifyRequest,
} from '../../packages/geometry/src/symbol-simplify-request';
import { artworkVertices } from '../../packages/geometry/src/artwork-simplify';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
import { objectBounds } from '../../packages/geometry/src/layout';
import { mapPoint, matrix } from '../../packages/geometry/src/affine';
import { symbolInstance } from '../../packages/geometry/src/symbols';
import { validateProject, type Project } from '../../packages/document/src';
const pageErrors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});
async function setup(page: Page, basis = 'plain', held = false, patch?: (p: Project) => void) {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (e) => errors.push(String(e)));
  const request = symbolSimplifyFixture(basis);
  patch?.(request.project);
  validateProject(request.project);
  if (held) await holdGeometry(page);
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    request.project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const before = await read();
  await page
    .getByRole('option', { name: 'Library item Original art', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await expect(
    dialog.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true }),
  ).toBeEnabled();
  const pixel = () =>
    dialog
      .getByLabel('Symbol artwork preview', { exact: true })
      .evaluate((e: HTMLCanvasElement) => {
        const d = e.getContext('2d')!.getImageData(0, 0, e.width, e.height).data;
        let red = 0;
        for (let i = 0; i < d.length; i += 4)
          if (d[i] > 160 && d[i + 1] < 90 && d[i + 2] < 90) red++;
        return red;
      });
  const simplify = () =>
    dialog.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true }).click();
  const probe = async (
    project: Project,
    local: { x: number; y: number },
    owner = 'paint',
    target = dialog,
    symbolId = 'art',
  ) => {
    const definition = project.symbols!.find((s) => s.id === symbolId)!,
      bounds = definition.shapes.map(objectBounds),
      left = Math.min(0, ...bounds.map((b) => b.left)),
      top = Math.min(0, ...bounds.map((b) => b.top));
    const right = Math.max(definition.width, ...bounds.map((b) => b.right)),
      bottom = Math.max(definition.height, ...bounds.map((b) => b.bottom));
    const scale = Math.min(500 / (right - left), 290 / (bottom - top)),
      p = mapPoint(matrix(definition.shapes.find((s) => s.id === owner)!), local);
    return target
      .getByLabel('Symbol artwork preview', { exact: true })
      .evaluate(
        (c: HTMLCanvasElement, { x, y }) =>
          Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data),
        { x: 20 + (p.x - left) * scale, y: 20 + (p.y - top) * scale },
      );
  };
  return { dialog, read, before, pixel, simplify, probe };
}
for (const basis of ['plain', 'affine', 'reflected'])
  test(`${basis} static Library selection simplifies in the background with local and Apply history`, async ({
    page,
  }) => {
    const f = await setup(page, basis);
    await expect.poll(f.pixel).toBeGreaterThan(200);
    const expected = prepareSymbolSimplifyRequest({
      project: f.before,
      symbolId: 'art',
      selected: ['line'],
    });
    await expect.poll(() => f.probe(f.before, { x: 130, y: 100 })).toEqual([255, 0, 0, 255]);
    await expect.poll(() => f.probe(f.before, { x: 100, y: 100 })).toEqual([255, 255, 255, 255]);
    await f.simplify();
    await expect(
      f.dialog.getByText(`Removed ${expected.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    expect(await f.read()).toEqual(f.before);
    await expect.poll(f.pixel).toBeGreaterThan(200);
    await expect
      .poll(() => f.probe(expected.project, { x: 130, y: 100 }))
      .toEqual([255, 0, 0, 255]);
    await expect
      .poll(() => f.probe(expected.project, { x: 100, y: 100 }))
      .toEqual([255, 255, 255, 255]);
    await f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await expect(
      f.dialog.getByRole('button', { name: 'Redo artwork change', exact: true }),
    ).toBeEnabled();
    await f.dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await f.dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
    await expect(f.dialog).toHaveCount(0);
    expect(await f.read()).toEqual(expected.project);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(expected.project);
  });
test('repeated static simplification uses current draft vertices and preserves complete hierarchy selection', async ({
  page,
}) => {
  const f = await setup(page);
  await f.dialog.getByText('Drag or place selected units', { exact: true }).click();
  await expect(f.dialog.getByLabel('Move hierarchy unit line', { exact: true })).toBeChecked();
  let expected = f.before;
  const counts: number[] = [];
  for (let i = 0; i < 2; i++) {
    const result = prepareSymbolSimplifyRequest({
      project: expected,
      symbolId: 'art',
      selected: ['line'],
    });
    await f.simplify();
    await expect(
      f.dialog.getByText(`Removed ${result.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    await expect(f.dialog.getByLabel('Move hierarchy unit line', { exact: true })).toBeChecked();
    counts.push(result.project.symbols![0].shapes.reduce((n, s) => n + artworkVertices(s), 0));
    expected = result.project;
  }
  expect(counts[1]).toBeLessThan(counts[0]);
  expect(await f.read()).toEqual(f.before);
  await f.dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  expect(await f.read()).toEqual(expected);
});
test('pending static simplification can be cancelled, fails without local history and permits a fresh retry', async ({
  page,
}) => {
  const f = await setup(page, 'plain', true);
  await f.simplify();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await expect(
    f.dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }),
  ).toBeDisabled();
  await f.dialog.getByRole('button', { name: 'Cancel symbol simplification', exact: true }).click();
  await releaseGeometry(page);
  await expect(
    f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.before);
  await f.simplify();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page, true);
  await expect(f.dialog.getByRole('alert')).toContainText('Simulated merge failure');
  await expect(
    f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await f.simplify();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect(f.dialog.getByRole('status')).toContainText('Removed');
  await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
});
test('a minimal selection remains an exact no-op without local history', async ({ page }) => {
  const f = await setup(page);
  await f.dialog.getByLabel('Symbol artwork item', { exact: true }).selectOption('other');
  await f.simplify();
  await expect(
    f.dialog.getByText('No removable vertices in this selection.', { exact: true }),
  ).toBeVisible();
  await expect(
    f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await f.dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
});

test('Simplify uses the current unapplied draft and leaves an earlier edit separately undoable', async ({
  page,
}) => {
  const f = await setup(page);
  const field = f.dialog.getByLabel('Symbol artwork x', { exact: true });
  await field.fill('35');
  await field.press('Tab');
  const draft = structuredClone(f.before);
  draft.symbols![0].shapes[0].x = 35;
  const expected = prepareSymbolSimplifyRequest({
    project: draft,
    symbolId: 'art',
    selected: ['line'],
  });
  await f.simplify();
  await expect(
    f.dialog.getByText(`Removed ${expected.removed} vertices.`, { exact: true }),
  ).toBeVisible();
  await f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(field).toHaveValue('35');
  await f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(field).toHaveValue('10');
  await f.dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await f.dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await f.dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  expect(await f.read()).toEqual(expected.project);
});

test('complete multi-unit hierarchy selection survives Simplify and local Undo/Redo', async ({
  page,
}) => {
  const f = await setup(page);
  await f.dialog.getByText('Drag or place selected units', { exact: true }).click();
  await f.dialog.getByLabel('Move hierarchy unit other', { exact: true }).check();
  const expected = prepareSymbolSimplifyRequest({
    project: f.before,
    symbolId: 'art',
    selected: ['line', 'other'],
  });
  await f.simplify();
  await expect(
    f.dialog.getByText(`Removed ${expected.removed} vertices.`, { exact: true }),
  ).toBeVisible();
  for (const action of [null, 'Undo artwork change', 'Redo artwork change']) {
    if (action) await f.dialog.getByRole('button', { name: action, exact: true }).click();
    for (const id of ['line', 'other'])
      await expect(f.dialog.getByLabel('Move hierarchy unit ' + id, { exact: true })).toBeChecked();
  }
  await f.dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  expect(await f.read()).toEqual(expected.project);
});

for (const action of ['escape', 'close', 'restored-mode', 'source'] as const)
  test(`pending symbol Simplify ${action} cannot publish a late result`, async ({ page }) => {
    const f = await setup(page, 'plain', true);
    await f.simplify();
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'close')
      await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    if (action === 'restored-mode')
      await f.dialog
        .getByLabel('Symbol canvas tool', { exact: true })
        .evaluate((e: HTMLSelectElement) => {
          for (const value of ['line', 'select']) {
            e.value = value;
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
    if (action === 'source')
      await page.getByLabel('Stage color', { exact: true }).evaluate((e: HTMLInputElement) => {
        e.value = '#abcdef';
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await releaseGeometry(page);
    if (action === 'close') {
      await expect(f.dialog).toHaveCount(0);
      expect(await f.read()).toEqual(f.before);
      return;
    }
    await expect(
      f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    const expected = structuredClone(f.before);
    if (action === 'source') expected.background = '#abcdef';
    await expect.poll(f.read).toEqual(expected);
    if (action !== 'source') {
      await f.simplify();
      await expect.poll(() => pendingGeometry(page)).toBe(1);
      await releaseGeometry(page);
      await expect(f.dialog.getByRole('status')).toContainText('Removed');
    }
    await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    expect(await f.read()).toEqual(expected);
    if (action === 'source') {
      await page.getByLabel('Drawing stage', { exact: true }).focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.before);
    }
  });

for (const action of ['selection', 'restored-mode', 'source'] as const)
  test(`late ${action} after a complete reduced array exists rejects local publication`, async ({
    page,
  }) => {
    const f = await setup(page);
    await page.evaluate((action) => {
      const original = structuredClone;
      window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        const out = original(value, options),
          shapes = value as { id?: string; nodes?: unknown[] }[];
        if (
          Array.isArray(shapes) &&
          shapes[0]?.id === 'line' &&
          shapes[0].nodes &&
          shapes[0].nodes.length < 241
        ) {
          window.structuredClone = original;
          document.documentElement.dataset.simplifyLateArray = 'yes';
          if (action === 'source') {
            const e = document.querySelector('input[aria-label="Stage color"]') as HTMLInputElement;
            e.value = '#abcdef';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            const e = document.querySelector(
              `select[aria-label="${action === 'selection' ? 'Symbol artwork item' : 'Symbol canvas tool'}"]`,
            ) as HTMLSelectElement;
            for (const value of action === 'selection' ? ['other'] : ['line', 'select']) {
              e.value = value;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
        return out;
      }) as typeof structuredClone;
    }, action);
    await f.simplify();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.simplifyLateArray))
      .toBe('yes');
    await expect(
      f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    const expected = structuredClone(f.before);
    if (action === 'source') expected.background = '#abcdef';
    await expect.poll(f.read).toEqual(expected);
    if (action !== 'source') {
      await f.dialog.getByLabel('Symbol artwork item', { exact: true }).selectOption('line');
      await f.simplify();
      await expect(f.dialog.getByRole('status')).toContainText('Removed');
    }
    await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    expect(await f.read()).toEqual(expected);
  });

test('late original source change during complete Apply serialization cannot publish simplified Library artwork', async ({
  page,
}) => {
  const f = await setup(page);
  await f.simplify();
  await expect(f.dialog.getByRole('status')).toContainText('Removed');
  await page.evaluate(() => {
    const original = JSON.stringify;
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      const text = Reflect.apply(original, JSON, [value, ...args]);
      const p = value as Project;
      if (p?.schemaVersion && p.symbols?.[0]?.shapes?.[0]?.kind === 'bezier') {
        JSON.stringify = original;
        document.documentElement.dataset.simplifyLateApply = 'yes';
        const e = document.querySelector('input[aria-label="Stage color"]') as HTMLInputElement;
        e.value = '#abcdef';
        e.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return text;
    }) as typeof JSON.stringify;
  });
  await f.dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.simplifyLateApply))
    .toBe('yes');
  await expect(f.dialog.getByRole('alert')).toContainText(/changed|existing static Library/);
  const expected = structuredClone(f.before);
  expected.background = '#abcdef';
  await expect.poll(f.read).toEqual(expected);
  await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expect.poll(f.read).toEqual(f.before);
});

test('isolated groups expose separately owned Simplify while original static root controls remain available', async ({
  page,
}) => {
  const f = await setup(page);
  await f.dialog
    .getByRole('button', { name: 'Edit symbol group in isolation', exact: true })
    .click();
  const isolated = page.getByRole('dialog', { name: 'Edit isolated symbol group', exact: true });
  await expect(
    isolated.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true }),
  ).toBeEnabled();
  await isolated.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await expect(
    f.dialog.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true }),
  ).toBeEnabled();
  expect(await f.read()).toEqual(f.before);
});

test('blank new static drafts have no simplifiable selection', async ({ page }) => {
  const f = await setup(page);
  await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await page.getByLabel('New library item', { exact: true }).click();
  await page.getByLabel('New symbol name', { exact: true }).fill('New draft');
  await page.getByRole('button', { name: 'New symbol', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await expect(
    editor.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true }),
  ).toBeDisabled();
  await editor.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
});

test('forged worker counts reject without a local edit and a fresh real retry succeeds', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = Worker;
    let forged = false;
    window.Worker = class extends Native {
      simplify = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (e) => {
          if (this.simplify && !forged && e.data.result) {
            forged = true;
            e.data.result.removed++;
            document.documentElement.dataset.simplifyForged = 'yes';
          }
        });
      }
      postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
        this.simplify = !!(message as { symbolSimplify?: unknown }).symbolSimplify;
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
  });
  const f = await setup(page);
  await f.simplify();
  await expect(f.dialog.getByRole('alert')).toContainText('count');
  expect(await page.evaluate(() => document.documentElement.dataset.simplifyForged)).toBe('yes');
  await expect(
    f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.before);
  await f.simplify();
  await expect(f.dialog.getByRole('status')).toContainText('Removed');
});

test('a reentered Apply cannot publish the outer prepared Library candidate', async ({ page }) => {
  const f = await setup(page);
  await f.simplify();
  await expect(f.dialog.getByRole('status')).toContainText('Removed');
  await page.evaluate(() => {
    const original = JSON.stringify;
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      const text = Reflect.apply(original, JSON, [value, ...args]),
        p = value as Project;
      if (p?.schemaVersion && p.symbols?.[0]?.shapes?.[0]?.kind === 'bezier') {
        JSON.stringify = original;
        document.documentElement.dataset.simplifyReentered = 'yes';
        const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
          (b) => b.textContent?.trim() === 'Apply symbol changes',
        )!;
        button.click();
      }
      return text;
    }) as typeof JSON.stringify;
  });
  await f.dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.simplifyReentered))
    .toBe('yes');
  await expect(f.dialog.getByRole('alert')).toContainText('changed');
  expect(await f.read()).toEqual(f.before);
  await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
});

for (const isolated of [false, true])
  test(`${isolated ? 'Isolated ' : ''}Simplify preserves an original selected nested child and its blue preview pixels`, async ({
    page,
  }) => {
    const f = await setup(page, 'plain', false, (p) => {
      const child = {
        id: 'child',
        name: 'Blue child',
        width: 20,
        height: 20,
        shapes: [
          {
            ...structuredClone(p.symbols![0].shapes[2]),
            id: 'blue',
            x: 0,
            y: 0,
            width: 20,
            height: 20,
            groups: undefined,
            fill: '#0000ff',
          },
        ],
      };
      p.symbols!.push(child);
      const instance = symbolInstance(child, 300, 100);
      instance.id = 'nested';
      instance.groups = ['outer'];
      p.symbols![0].shapes.splice(2, 0, instance);
    });
    const target = isolated ? await isolate(f, page) : f.dialog;
    if (isolated) {
      await target.getByText('Drag or place selected units', { exact: true }).click();
      await target.getByLabel('Move hierarchy unit nested', { exact: true }).check();
    }
    const expected = prepareSymbolSimplifyRequest({
      project: f.before,
      symbolId: 'art',
      selected: isolated ? ['line', 'nested'] : ['line'],
      ...(isolated ? { ancestry: ['outer'] } : {}),
    });
    await expect
      .poll(() => f.probe(f.before, { x: 10, y: 10 }, 'nested', target))
      .toEqual([0, 0, 255, 255]);
    await simplifyIn(target);
    await expect(
      target.getByText(`Removed ${expected.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => f.probe(expected.project, { x: 10, y: 10 }, 'nested', target))
      .toEqual([0, 0, 255, 255]);
    await applyIn(target);
    if (isolated) await applyIn(f.dialog);
    expect(await f.read()).toEqual(expected.project);
  });

async function isolate(f: Awaited<ReturnType<typeof setup>>, page: Page, depth = 1) {
  let parent = f.dialog;
  for (let i = 0; i < depth; i++) {
    await parent
      .getByRole('button', { name: 'Edit symbol group in isolation', exact: true })
      .click();
    parent = page.locator('dialog[aria-label="Edit isolated symbol group"]').last();
  }
  return parent;
}
const simplifyIn = (dialog: Locator) =>
  dialog.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true }).click();
const applyIn = (dialog: Locator) =>
  dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }).click();
async function redPixels(dialog: Locator) {
  return dialog
    .getByLabel('Symbol artwork preview', { exact: true })
    .evaluate((e: HTMLCanvasElement) => {
      const d = e.getContext('2d')!.getImageData(0, 0, e.width, e.height).data;
      let count = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i] > 160 && d[i + 1] < 90 && d[i + 2] < 90) count++;
      return count;
    });
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const depth of [1, 2])
    test(`${basis} isolated depth ${depth} Simplify preserves siblings, pixels, selection and local/parent/document history`, async ({
      page,
    }) => {
      const f = await setup(page, basis),
        dialog = await isolate(f, page, depth),
        expected = prepareSymbolSimplifyRequest({
          project: f.before,
          symbolId: 'art',
          selected: ['line'],
          ancestry: ['outer', 'inner'].slice(0, depth),
        });
      await expect.poll(() => redPixels(dialog)).toBeGreaterThan(200);
      if (depth === 1) {
        await expect
          .poll(() => f.probe(f.before, { x: 130, y: 100 }, 'paint', dialog))
          .toEqual([255, 0, 0, 255]);
        await expect
          .poll(() => f.probe(f.before, { x: 100, y: 100 }, 'paint', dialog))
          .toEqual([255, 255, 255, 255]);
      }
      await simplifyIn(dialog);
      await expect(dialog.getByRole('status')).toHaveText(`Removed ${expected.removed} vertices.`);
      expect(await f.read()).toEqual(f.before);
      await expect.poll(() => redPixels(dialog)).toBeGreaterThan(200);
      await expect(dialog.getByLabel('Symbol artwork item', { exact: true })).toHaveValue('line');
      for (const action of ['Undo artwork change', 'Redo artwork change']) {
        await dialog.getByRole('button', { name: action, exact: true }).click();
        await expect(dialog.getByLabel('Symbol artwork item', { exact: true })).toHaveValue('line');
      }
      if (depth === 1) {
        await expect
          .poll(() => f.probe(expected.project, { x: 130, y: 100 }, 'paint', dialog))
          .toEqual([255, 0, 0, 255]);
        await expect
          .poll(() => f.probe(expected.project, { x: 100, y: 100 }, 'paint', dialog))
          .toEqual([255, 255, 255, 255]);
      }
      await applyIn(dialog);
      if (depth === 2)
        await applyIn(page.locator('dialog[aria-label="Edit isolated symbol group"]').last());
      expect(await f.read()).toEqual(f.before);
      await f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
      await f.dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
      await applyIn(f.dialog);
      expect(await f.read()).toEqual(expected.project);
      await page.getByLabel('Drawing stage', { exact: true }).focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.before);
      await page.keyboard.press('Control+Shift+z');
      await expect.poll(f.read).toEqual(expected.project);
    });
test('isolated repeated reductions retain checked complete relative units and original holes', async ({
  page,
}) => {
  const f = await setup(page),
    dialog = await isolate(f, page);
  await dialog.getByText('Drag or place selected units', { exact: true }).click();
  await dialog.getByLabel('Move hierarchy unit paint', { exact: true }).check();
  let expected = f.before;
  for (let i = 0; i < 2; i++) {
    const result = prepareSymbolSimplifyRequest({
      project: expected,
      symbolId: 'art',
      selected: ['line', 'paint'],
      ancestry: ['outer'],
    });
    expected = result.project;
    await simplifyIn(dialog);
    await expect(
      dialog.getByText(`Removed ${result.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    for (const action of [null, 'Undo artwork change', 'Redo artwork change']) {
      if (action) await dialog.getByRole('button', { name: action, exact: true }).click();
      for (const id of ['line', 'paint'])
        await expect(dialog.getByLabel('Move hierarchy unit ' + id, { exact: true })).toBeChecked();
    }
  }
  await applyIn(dialog);
  await applyIn(f.dialog);
  expect(await f.read()).toEqual(expected);
});
test('unapplied parent and child edits survive scoped reduction and have separate local Undo', async ({
  page,
}) => {
  const f = await setup(page);
  await f.dialog.getByLabel('Symbol artwork x', { exact: true }).fill('35');
  await f.dialog.getByLabel('Symbol artwork x', { exact: true }).press('Tab');
  const draft = structuredClone(f.before);
  draft.symbols![0].shapes[0].x = 35;
  const dialog = await isolate(f, page);
  await dialog.getByLabel('Symbol artwork x', { exact: true }).fill('55');
  await dialog.getByLabel('Symbol artwork x', { exact: true }).press('Tab');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeEnabled();
  draft.symbols![0].shapes[0].x = 55;
  const expected = prepareSymbolSimplifyRequest({
    project: draft,
    symbolId: 'art',
    selected: ['line'],
    ancestry: ['outer'],
  });
  await simplifyIn(dialog);
  await expect(dialog.getByRole('status')).toContainText('Removed');
  await dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(dialog.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('55');
  await dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(dialog.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('35');
  for (let i = 0; i < 2; i++)
    await dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await applyIn(dialog);
  await f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
  await expect(f.dialog.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('35');
  await f.dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
  await applyIn(f.dialog);
  expect(await f.read()).toEqual(expected.project);
});
test('isolated Simplify Cancel keeps parent artwork and document history unchanged', async ({
  page,
}) => {
  const f = await setup(page),
    dialog = await isolate(f, page);
  await simplifyIn(dialog);
  await expect(dialog.getByRole('status')).toContainText('Removed');
  await dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  await expect(
    f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await applyIn(f.dialog);
  expect(await f.read()).toEqual(f.before);
});
test('isolated minimal group has no reduction or local/parent history', async ({ page }) => {
  const f = await setup(page, 'plain', false, (p) => {
    p.symbols![0].shapes[2].groups = ['alone'];
  });
  await f.dialog.getByLabel('Symbol artwork item', { exact: true }).selectOption('other');
  const dialog = await isolate(f, page);
  await simplifyIn(dialog);
  await expect(dialog.getByRole('status')).toContainText('No removable');
  await expect(
    dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await applyIn(dialog);
  await expect(
    f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await applyIn(f.dialog);
  expect(await f.read()).toEqual(f.before);
});
test('isolated pending work cancels, fails, rejects late replies and permits a fresh valid retry', async ({
  page,
}) => {
  const f = await setup(page, 'plain', true),
    dialog = await isolate(f, page);
  await simplifyIn(dialog);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await expect(
    dialog.getByRole('button', { name: 'Apply symbol changes', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel symbol simplification', exact: true }).click();
  await releaseGeometry(page);
  await expect(
    dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
  ).toBeDisabled();
  await simplifyIn(dialog);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page, true);
  await expect(dialog.getByRole('alert')).toContainText('Simulated merge failure');
  await simplifyIn(dialog);
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await releaseGeometry(page);
  await expect(dialog.getByRole('status')).toContainText('Removed');
  await applyIn(dialog);
  await applyIn(f.dialog);
  expect(await f.read()).toEqual(
    prepareSymbolSimplifyRequest({
      project: f.before,
      symbolId: 'art',
      selected: ['line'],
      ancestry: ['outer'],
    }).project,
  );
});
for (const action of [
  'escape',
  'close',
  'child-mode',
  'parent-mode',
  'parent-selection',
  'source',
] as const)
  test(`isolated pending ${action} rejects stale local publication`, async ({ page }) => {
    const f = await setup(page, 'plain', true),
      dialog = await isolate(f, page);
    await simplifyIn(dialog);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'close')
      await dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    if (action === 'child-mode' || action === 'parent-mode')
      await (action === 'child-mode' ? dialog : f.dialog)
        .getByLabel('Symbol canvas tool', { exact: true })
        .evaluate((e: HTMLSelectElement) => {
          for (const value of ['line', 'select']) {
            e.value = value;
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
    if (action === 'parent-selection')
      await f.dialog
        .getByLabel('Symbol artwork item', { exact: true })
        .evaluate((e: HTMLSelectElement) => {
          e.value = 'other';
          e.dispatchEvent(new Event('change', { bubbles: true }));
        });
    if (action === 'source')
      await page.getByLabel('Stage color', { exact: true }).evaluate((e: HTMLInputElement) => {
        e.value = '#abcdef';
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await releaseGeometry(page);
    if (action !== 'close')
      await expect(
        dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
      ).toBeDisabled();
    const expected = structuredClone(f.before);
    if (action === 'source') expected.background = '#abcdef';
    expect(await f.read()).toEqual(expected);
  });

for (const action of ['source', 'parent-mode', 'child-selection'] as const)
  test(`late isolated ${action} after a complete reduced candidate exists rejects local publication`, async ({
    page,
  }) => {
    const f = await setup(page),
      dialog = await isolate(f, page);
    await page.evaluate((action) => {
      const native = structuredClone;
      window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        const copy = native(value, options),
          p = value as Project;
        if (
          p?.schemaVersion &&
          p.symbols?.[0]?.shapes[0]?.nodes?.length &&
          p.symbols[0].shapes[0].nodes!.length < 241
        ) {
          window.structuredClone = native;
          document.documentElement.dataset.isolatedLate = 'yes';
          if (action === 'source') {
            const e = document.querySelector('input[aria-label="Stage color"]') as HTMLInputElement;
            e.value = '#abcdef';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            const selector =
                action === 'parent-mode'
                  ? 'dialog[aria-label="Edit symbol artwork"] select[aria-label="Symbol canvas tool"]'
                  : 'dialog[aria-label="Edit isolated symbol group"] select[aria-label="Symbol artwork item"]',
              e = document.querySelector(selector) as HTMLSelectElement;
            for (const value of action === 'parent-mode' ? ['line', 'select'] : ['paint']) {
              e.value = value;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
        return copy;
      }) as typeof structuredClone;
    }, action);
    await simplifyIn(dialog);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.isolatedLate))
      .toBe('yes');
    await expect(
      dialog.getByRole('button', { name: 'Undo artwork change', exact: true }),
    ).toBeDisabled();
    const expected = structuredClone(f.before);
    if (action === 'source') expected.background = '#abcdef';
    expect(await f.read()).toEqual(expected);
    if (action !== 'source') {
      await dialog.getByLabel('Symbol artwork item', { exact: true }).selectOption('line');
      await simplifyIn(dialog);
      await expect(dialog.getByRole('status')).toContainText('Removed');
      await applyIn(dialog);
      await applyIn(f.dialog);
      expect(await f.read()).toEqual(
        prepareSymbolSimplifyRequest({
          project: f.before,
          symbolId: 'art',
          selected: ['line'],
          ancestry: ['outer'],
        }).project,
      );
    }
  });
for (const action of ['source', 'parent-mode', 'child-input', 'reentry'] as const)
  test(`late isolated parent Apply ${action} after detached member preparation rejects stale publication`, async ({
    page,
  }) => {
    const f = await setup(page),
      dialog = await isolate(f, page),
      prepared = prepareSymbolSimplifyRequest({
        project: f.before,
        symbolId: 'art',
        selected: ['line'],
        ancestry: ['outer'],
      }).project;
    await simplifyIn(dialog);
    await expect(dialog.getByRole('status')).toContainText('Removed');
    await page.evaluate((action) => {
      const native = structuredClone;
      window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        const copy = native(value, options),
          shapes = value as { id?: string; groups?: string[]; nodes?: unknown[] }[];
        if (
          Array.isArray(shapes) &&
          shapes.length === 3 &&
          shapes[0]?.id === 'line' &&
          shapes[0].groups?.[0] === 'outer' &&
          shapes[0].nodes &&
          shapes[0].nodes.length < 241
        ) {
          window.structuredClone = native;
          document.documentElement.dataset.isolatedApplyLate = 'yes';
          if (action === 'source') {
            const e = document.querySelector('input[aria-label="Stage color"]') as HTMLInputElement;
            e.value = '#abcdef';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'parent-mode') {
            const e = document.querySelector(
              'dialog[aria-label="Edit symbol artwork"] select[aria-label="Symbol canvas tool"]',
            ) as HTMLSelectElement;
            for (const value of ['line', 'select']) {
              e.value = value;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          if (action === 'child-input') {
            const e = document.querySelector(
              'dialog[aria-label="Edit isolated symbol group"] input[aria-label="Symbol artwork x"]',
            ) as HTMLInputElement;
            e.value = '55';
            e.dispatchEvent(new Event('input', { bubbles: true }));
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'reentry') {
            const child = document.querySelector(
              'dialog[aria-label="Edit isolated symbol group"]',
            )!;
            [...child.querySelectorAll('button')]
              .find((b) => b.textContent?.trim() === 'Apply symbol changes')!
              .click();
          }
        }
        return copy;
      }) as typeof structuredClone;
    }, action);
    await applyIn(dialog);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.isolatedApplyLate))
      .toBe('yes');
    await expect(dialog.getByRole('alert')).toContainText(/changed|reenter/);
    const expected = structuredClone(f.before);
    if (action === 'source') expected.background = '#abcdef';
    expect(await f.read()).toEqual(expected);
    if (action !== 'source') {
      if (action === 'child-input') {
        await expect(dialog.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('55');
        prepared.symbols![0].shapes[0].x = 55;
      }
      await applyIn(dialog);
      await applyIn(f.dialog);
      expect(await f.read()).toEqual(prepared);
    } else {
      await dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
      await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
      await page.getByLabel('Drawing stage', { exact: true }).focus();
      await page.keyboard.press('Control+z');
      await expect.poll(f.read).toEqual(f.before);
    }
  });

async function setupPending(
  page: Page,
  basis = 'plain',
  held = false,
  options: { minimal?: boolean; folder?: boolean; kind?: 'graphic' | 'movie' | 'button' } = {},
) {
  const f = await setup(page, basis, held, (p) => {
    p.libraryFolders = [
      { id: 'props', name: 'Props' },
      { id: 'destination', name: 'Drawings', parentId: 'props' },
    ];
    p.libraryLinks = [{ kind: 'symbol', id: 'art', name: 'New_prop' }];
  });
  if (options.minimal)
    await f.dialog.getByLabel('Symbol artwork item', { exact: true }).selectOption('other');
  await f.dialog.getByRole('button', { name: 'Copy symbol artwork', exact: true }).click();
  await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  if (options.folder)
    await page.getByLabel('Library folder', { exact: true }).selectOption('destination');
  await page.getByLabel('New library item', { exact: true }).click();
  await page.getByLabel('New symbol name', { exact: true }).fill('New prop');
  await page
    .getByRole('button', {
      name:
        options.kind === 'movie'
          ? 'New movie clip'
          : options.kind === 'button'
            ? 'New button'
            : 'New symbol',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Edit symbol artwork', exact: true });
  await expect(
    dialog.getByRole('button', { name: 'Simplify selected symbol artwork', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Paste symbol artwork', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => {
    const Native = window.Worker;
    Object.assign(window, { pendingSymbolRequests: [] });
    window.Worker = class extends Native {
      postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
        const packet = message as { symbolSimplify?: SymbolSimplifyRequest };
        if (packet?.symbolSimplify)
          (
            window as unknown as { pendingSymbolRequests: SymbolSimplifyRequest[] }
          ).pendingSymbolRequests.push(structuredClone(packet.symbolSimplify));
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
  });
  const packets = () =>
      page.evaluate(
        () =>
          (window as unknown as { pendingSymbolRequests: SymbolSimplifyRequest[] })
            .pendingSymbolRequests,
      ),
    latest = async () => {
      await expect.poll(async () => (await packets()).length).toBeGreaterThan(0);
      return (await packets()).at(-1)!;
    };
  return { ...f, dialog, packets, latest };
}
for (const basis of ['plain', 'affine', 'reflected'])
  test(`${basis} pending static Simplify keeps original Library and publishes one Add transaction`, async ({
    page,
  }) => {
    const f = await setupPending(page, basis, false, { folder: true });
    await expect.poll(() => redPixels(f.dialog)).toBeGreaterThan(200);
    await simplifyIn(f.dialog);
    const input = await f.latest(),
      expected = prepareSymbolSimplifyRequest(input),
      definition = input.project.symbols!.find((s) => s.id === input.symbolId)!;
    expect(input.symbolId).not.toBe('art');
    expect(input.project.symbols!.slice(0, 2)).toEqual(f.before.symbols);
    expect(definition.name).toBe('New prop');
    expect(definition.width).toBe(100);
    expect(definition.height).toBe(100);
    expect(input.project.libraryLinks).toContainEqual({
      kind: 'symbol',
      id: input.symbolId,
      name: 'New_prop_2',
    });
    expect(input.project.libraryItems).toContainEqual({
      kind: 'symbol',
      id: input.symbolId,
      folderId: 'destination',
    });
    await expect(
      f.dialog.getByText(`Removed ${expected.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    expect(await f.read()).toEqual(f.before);
    const paint = definition.shapes.find((s) => s.contours)!.id;
    await expect
      .poll(() => f.probe(expected.project, { x: 130, y: 100 }, paint, f.dialog, input.symbolId))
      .toEqual([255, 0, 0, 255]);
    await expect
      .poll(() => f.probe(expected.project, { x: 100, y: 100 }, paint, f.dialog, input.symbolId))
      .toEqual([255, 255, 255, 255]);
    for (const action of ['Undo artwork change', 'Redo artwork change'])
      await f.dialog.getByRole('button', { name: action, exact: true }).click();
    await applyIn(f.dialog);
    await expect(f.dialog).toHaveCount(0);
    expect(await f.read()).toEqual(expected.project);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(expected.project);
  });
for (const kind of ['graphic', 'movie', 'button'] as const)
  test(`pending ${kind} repeated reductions keep the reserved definition and artwork identities`, async ({
    page,
  }) => {
    const f = await setupPending(page, 'plain', false, { kind });
    await simplifyIn(f.dialog);
    const first = await f.latest(),
      a = prepareSymbolSimplifyRequest(first);
    await expect(
      f.dialog.getByText(`Removed ${a.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    await simplifyIn(f.dialog);
    await expect.poll(async () => (await f.packets()).length).toBe(2);
    const second = await f.latest(),
      b = prepareSymbolSimplifyRequest(second);
    expect(second.symbolId).toBe(first.symbolId);
    expect(second.project.symbols!.find((s) => s.id === second.symbolId)!.shapes).toEqual(
      a.project.symbols!.find((s) => s.id === first.symbolId)!.shapes,
    );
    await expect(
      f.dialog.getByText(`Removed ${b.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    for (const label of ['Undo artwork change', 'Redo artwork change'])
      await f.dialog.getByRole('button', { name: label, exact: true }).click();
    await applyIn(f.dialog);
    expect(await f.read()).toEqual(b.project);
  });
for (const [kind, depth] of [
  ['graphic', 1],
  ['graphic', 2],
  ['movie', 1],
  ['button', 1],
] as const)
  test(`pending ${kind === 'graphic' ? 'static' : kind} depth ${depth} isolated Simplify retains local/parent/Apply history`, async ({
    page,
  }) => {
    const f = await setupPending(page, 'reflected', false, { folder: true, kind }),
      dialog = await isolate(f, page, depth);
    await simplifyIn(dialog);
    const input = await f.latest(),
      expected = prepareSymbolSimplifyRequest(input);
    expect(input.ancestry).toHaveLength(depth);
    await expect(
      dialog.getByText(`Removed ${expected.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    expect(await f.read()).toEqual(f.before);
    for (const action of ['Undo artwork change', 'Redo artwork change'])
      await dialog.getByRole('button', { name: action, exact: true }).click();
    await applyIn(dialog);
    if (depth === 2)
      await applyIn(page.locator('dialog[aria-label="Edit isolated symbol group"]').last());
    await f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await f.dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await applyIn(f.dialog);
    expect(await f.read()).toEqual(expected.project);
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.before);
  });
for (const kind of ['graphic', 'movie', 'button'] as const)
  test(`pending ${kind} minimal no-op adds no local history beyond the original paste`, async ({
    page,
  }) => {
    const f = await setupPending(page, 'plain', false, { minimal: true, kind });
    await simplifyIn(f.dialog);
    const input = await f.latest();
    await expect(
      f.dialog.getByText('No removable vertices in this selection.', { exact: true }),
    ).toBeVisible();
    await f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await expect(f.dialog.getByLabel('Symbol artwork item', { exact: true })).toHaveValue('');
    await f.dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await applyIn(f.dialog);
    expect(await f.read()).toEqual(input.project);
  });
test('pending Simplify Cancel discards the new definition and every local reduction', async ({
  page,
}) => {
  const f = await setupPending(page);
  await simplifyIn(f.dialog);
  await expect(f.dialog.getByText(/^Removed \d+ vertices\.$/)).toBeVisible();
  await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
  await expect(
    page.getByRole('option', { name: 'Library item New prop', exact: true }),
  ).toHaveCount(0);
});
for (const kind of ['graphic', 'movie', 'button'] as const)
  test(`pending ${kind} fitting cancellation, worker failure and fresh retry keep the new draft unpublished`, async ({
    page,
  }) => {
    const f = await setupPending(page, 'plain', true, { kind });
    await simplifyIn(f.dialog);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await f.dialog
      .getByRole('button', { name: 'Cancel symbol simplification', exact: true })
      .click();
    await releaseGeometry(page);
    await f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
    await expect(f.dialog.getByLabel('Symbol artwork item', { exact: true })).toHaveValue('');
    await f.dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
    await simplifyIn(f.dialog);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    await releaseGeometry(page, true);
    await expect(f.dialog.getByRole('alert')).toContainText('Simulated merge failure');
    await simplifyIn(f.dialog);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    const input = await f.latest();
    await releaseGeometry(page);
    await expect(f.dialog.getByText(/^Removed \d+ vertices\.$/)).toBeVisible();
    expect(await f.read()).toEqual(f.before);
    await applyIn(f.dialog);
    expect(await f.read()).toEqual(prepareSymbolSimplifyRequest(input).project);
  });
for (const action of ['escape', 'close', 'restored-mode', 'source'] as const)
  test(`pending new static ${action} rejects late fitting publication`, async ({ page }) => {
    const f = await setupPending(page, 'plain', true);
    await simplifyIn(f.dialog);
    await expect.poll(() => pendingGeometry(page)).toBe(1);
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'close')
      await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    if (action === 'restored-mode')
      await f.dialog
        .getByLabel('Symbol canvas tool', { exact: true })
        .evaluate((e: HTMLSelectElement) => {
          for (const value of ['line', 'select']) {
            e.value = value;
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
    if (action === 'source')
      await page.getByLabel('Stage color', { exact: true }).evaluate((e: HTMLInputElement) => {
        e.value = '#abcdef';
        e.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await releaseGeometry(page);
    const expected = structuredClone(f.before);
    if (action === 'source') expected.background = '#abcdef';
    expect(await f.read()).toEqual(expected);
    if (action !== 'close') {
      await f.dialog.getByRole('button', { name: 'Undo artwork change', exact: true }).click();
      await expect(f.dialog.getByLabel('Symbol artwork item', { exact: true })).toHaveValue('');
      await f.dialog.getByRole('button', { name: 'Redo artwork change', exact: true }).click();
      if (action === 'restored-mode') {
        await simplifyIn(f.dialog);
        await expect.poll(() => pendingGeometry(page)).toBe(1);
        await releaseGeometry(page);
        await expect(f.dialog.getByText(/^Removed \d+ vertices\.$/)).toBeVisible();
      }
    }
  });
for (const action of ['source', 'target', 'restored-mode'] as const)
  test(`late pending ${action} after a reduced candidate exists cannot publish old local artwork`, async ({
    page,
  }) => {
    const f = await setupPending(page);
    await page.evaluate((action) => {
      const native = structuredClone;
      window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
        const out = native(value, options),
          p = value as Project;
        if (p?.symbols?.at(-1)?.name === 'New prop' && p.symbols.at(-1)?.shapes[0]?.nodes?.length) {
          window.structuredClone = native;
          document.documentElement.dataset.pendingLate = 'yes';
          if (action === 'source') {
            const e = document.querySelector('input[aria-label="Stage color"]') as HTMLInputElement;
            e.value = '#abcdef';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'target') {
            const e = document.querySelector(
              'input[aria-label="Symbol artwork x"]',
            ) as HTMLInputElement;
            e.value = '55';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'restored-mode') {
            const e = document.querySelector(
              'select[aria-label="Symbol canvas tool"]',
            ) as HTMLSelectElement;
            for (const value of ['line', 'select']) {
              e.value = value;
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
        return out;
      }) as typeof structuredClone;
    }, action);
    await simplifyIn(f.dialog);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.pendingLate))
      .toBe('yes');
    const expected = structuredClone(f.before);
    if (action === 'source') expected.background = '#abcdef';
    expect(await f.read()).toEqual(expected);
    if (action !== 'source') {
      await simplifyIn(f.dialog);
      await expect.poll(async () => (await f.packets()).length).toBe(2);
      const input = await f.latest();
      if (action === 'target') expect(input.project.symbols!.at(-1)!.shapes[0].x).toBe(55);
      await expect(f.dialog.getByText(/^Removed \d+ vertices\.$/)).toBeVisible();
      await applyIn(f.dialog);
      expect(await f.read()).toEqual(prepareSymbolSimplifyRequest(input).project);
    }
  });
for (const kind of ['graphic', 'movie', 'button'] as const)
  for (const action of ['source', 'target', 'reentry'] as const)
    test(`late pending ${kind} Apply ${action} after recovery preparation rejects the Add transaction`, async ({
      page,
    }) => {
      const f = await setupPending(page, 'plain', false, { kind });
      await simplifyIn(f.dialog);
      const input = await f.latest(),
        expectedFit = prepareSymbolSimplifyRequest(input).project;
      await expect(f.dialog.getByText(/^Removed \d+ vertices\.$/)).toBeVisible();
      await page.evaluate((action) => {
        const native = JSON.stringify;
        JSON.stringify = ((value: unknown, ...args: unknown[]) => {
          const text = Reflect.apply(native, JSON, [value, ...args]),
            packet = value as { project?: Project };
          if (
            packet?.project?.symbols?.at(-1)?.name === 'New prop' &&
            packet.project.symbols.at(-1)?.shapes[0]?.nodes?.length
          ) {
            JSON.stringify = native;
            document.documentElement.dataset.pendingApplyLate = 'yes';
            if (action === 'source') {
              const e = document.querySelector(
                'input[aria-label="Stage color"]',
              ) as HTMLInputElement;
              e.value = '#abcdef';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (action === 'target') {
              const e = document.querySelector(
                'input[aria-label="Symbol artwork x"]',
              ) as HTMLInputElement;
              e.value = '55';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (action === 'reentry')
              [...document.querySelectorAll('button')]
                .find((b) => b.textContent?.trim() === 'Apply symbol changes')!
                .click();
          }
          return text;
        }) as typeof JSON.stringify;
      }, action);
      await applyIn(f.dialog);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.pendingApplyLate))
        .toBe('yes');
      await expect(f.dialog.getByRole('alert')).toContainText(/changed|unpublished|reenter/);
      const expected = structuredClone(f.before);
      if (action === 'source') expected.background = '#abcdef';
      expect(await f.read()).toEqual(expected);
      if (action !== 'source') {
        if (action === 'target') {
          await expect(f.dialog.getByLabel('Symbol artwork x', { exact: true })).toHaveValue('55');
          expectedFit.symbols!.at(-1)!.shapes[0].x = 55;
        }
        await applyIn(f.dialog);
        expect(await f.read()).toEqual(expectedFit);
      } else {
        await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
        await page.getByLabel('Drawing stage', { exact: true }).focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.before);
      }
    });
test('a forged pending header snapshot rejects before worker dispatch and allows a fresh original draft retry', async ({
  page,
}) => {
  const f = await setupPending(page);
  await page.evaluate(() => {
    const native = structuredClone;
    window.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
      const out = native(value, options),
        header = value as { id?: string; name?: string; shapes?: unknown[]; width: number };
      if (header?.name === 'New prop' && header.shapes?.length === 0) {
        window.structuredClone = native;
        document.documentElement.dataset.pendingHeaderForged = 'yes';
        (out as typeof header).width++;
      }
      return out;
    }) as typeof structuredClone;
  });
  await simplifyIn(f.dialog);
  await expect(f.dialog.getByRole('alert')).toContainText('snapshots changed');
  expect(await page.evaluate(() => document.documentElement.dataset.pendingHeaderForged)).toBe(
    'yes',
  );
  expect(await f.packets()).toHaveLength(0);
  expect(await f.read()).toEqual(f.before);
  await simplifyIn(f.dialog);
  const input = await f.latest();
  expect(input.project.symbols!.at(-1)!.width).toBe(100);
  await expect(f.dialog.getByText(/^Removed \d+ vertices\.$/)).toBeVisible();
  await applyIn(f.dialog);
  expect(await f.read()).toEqual(prepareSymbolSimplifyRequest(input).project);
});
for (const kind of ['movie', 'button'] as const)
  test(`pending ${kind} Simplify keeps original Library and publishes one complete Add`, async ({
    page,
  }) => {
    const f = await setupPending(page, 'plain', false, { kind, folder: true });
    await expect.poll(() => redPixels(f.dialog)).toBeGreaterThan(200);
    await simplifyIn(f.dialog);
    const input = await f.latest(),
      expected = prepareSymbolSimplifyRequest(input);
    expect(input.location).toEqual({ layerId: '@base', frame: 0 });
    expect(input.project.symbols!.slice(0, 2)).toEqual(f.before.symbols);
    await expect(
      f.dialog.getByText(`Removed ${expected.removed} vertices.`, { exact: true }),
    ).toBeVisible();
    for (const label of ['Undo artwork change', 'Redo artwork change'])
      await f.dialog.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => redPixels(f.dialog)).toBeGreaterThan(200);
    const paint = expected.project.symbols!.at(-1)!.shapes.find((shape) => shape.contours)!.id;
    await expect
      .poll(() => f.probe(expected.project, { x: 130, y: 100 }, paint, f.dialog, input.symbolId))
      .toEqual([255, 0, 0, 255]);
    await expect
      .poll(() => f.probe(expected.project, { x: 100, y: 100 }, paint, f.dialog, input.symbolId))
      .toEqual([255, 255, 255, 255]);
    expect(await f.read()).toEqual(f.before);
    await applyIn(f.dialog);
    await expect.poll(f.read).toEqual(expected.project);
    const added = expected.project.symbols!.at(-1)!;
    if (kind === 'movie') {
      expect(added.defaultPlayback).toBe('movie');
      expect(added.timeline!.duration).toBe(f.before.duration);
    } else expect(added.buttonStates).toEqual({ up: 0, over: 0, down: 0, hit: 0 });
    expect(added.timeline!.keys).toEqual([]);
    expect(expected.project.libraryItems).toContainEqual({
      kind: 'symbol',
      id: added.id,
      folderId: 'destination',
    });
    expect(expected.project.libraryLinks).toContainEqual({
      kind: 'symbol',
      id: added.id,
      name: 'New_prop_2',
    });
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(f.read).toEqual(f.before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(f.read).toEqual(expected.project);
  });
for (const kind of ['movie', 'button'] as const)
  test(`pending ${kind} Cancel after Simplify discards every unpublished change`, async ({
    page,
  }) => {
    const f = await setupPending(page, 'plain', false, { kind });
    await simplifyIn(f.dialog);
    await expect(f.dialog.getByText(/^Removed \d+ vertices\.$/)).toBeVisible();
    await f.dialog.getByRole('button', { name: 'Cancel symbol editing', exact: true }).click();
    expect(await f.read()).toEqual(f.before);
    await expect(
      page.getByRole('option', { name: 'Library item New prop', exact: true }),
    ).toHaveCount(0);
  });

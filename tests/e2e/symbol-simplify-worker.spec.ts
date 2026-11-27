import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { symbolSimplifyFrameFixture } from '../symbol-simplify-frame-fixture';
import { symbolSimplifyFixture } from '../symbol-simplify-fixture';
import { isolatedSymbolSimplifyFixture } from '../symbol-simplify-isolated-fixture';
import { captureNewStaticSymbolSimplifyContext } from '../../apps/editor/src/new-symbol-simplify-context';
import {
  prepareSymbolSimplifyRequest,
  type SymbolSimplifyRequest,
  type SymbolSimplifyResult,
} from '../../packages/geometry/src/symbol-simplify-request';

function workerURL() {
  const names = readdirSync('dist/assets').filter(
    (n) =>
      n.startsWith('worker-') &&
      n.endsWith('.js') &&
      readFileSync(`dist/assets/${n}`, 'utf8').includes('symbolSimplify'),
  );
  expect(names).toHaveLength(1);
  return `/assets/${names[0]}`;
}
async function request(page: Page, input: SymbolSimplifyRequest) {
  return page.evaluate(
    async ({ url, input }) => {
      const worker = new Worker(url, { type: 'module' });
      try {
        return await new Promise<{ id: number; result?: SymbolSimplifyResult; error?: string }>(
          (resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Test worker deadline')), 15000);
            worker.onmessage = (e) => {
              clearTimeout(timer);
              resolve(e.data);
            };
            worker.onerror = () => {
              clearTimeout(timer);
              reject(Error('Native worker failure'));
            };
            worker.postMessage({ id: 45, shapes: [], symbolSimplify: input });
          },
        );
      } finally {
        worker.terminate();
      }
    },
    { url: workerURL(), input },
  );
}
for (const basis of ['plain', 'affine', 'reflected'])
  test(`real geometry worker prepares detached ${basis} static Library group simplification`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    const input = symbolSimplifyFixture(basis);
    input.project.frameScripts = [
      { frame: 0, source: 'throw new Error("Scripts must stay inert")' },
    ];
    const before = structuredClone(input),
      recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const response = await request(page, input);
    expect(response.id).toBe(45);
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(prepareSymbolSimplifyRequest(input));
    expect(response.result!.removed).toBeGreaterThan(100);
    expect(response.result!.selected).toEqual(['line', 'paint']);
    expect(input).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
    expect(errors).toEqual([]);
  });
test('real static simplification worker preserves a complete no-op and supports fresh valid work', async ({
  page,
}) => {
  await page.goto('/');
  const input = symbolSimplifyFixture();
  input.selected = ['other'];
  const response = await request(page, input);
  expect(response.result!.removed).toBe(0);
  expect(response.result!.project).toEqual(input.project);
  expect((await request(page, symbolSimplifyFixture())).result!.removed).toBeGreaterThan(100);
});
test('real worker rejects animated ownership without a partial candidate and leaves normal drawing available', async ({
  page,
}) => {
  await page.goto('/');
  const input = symbolSimplifyFixture();
  input.project.symbols![0].timeline = { duration: 1, keys: [] };
  const bad = await request(page, input);
  expect(bad.result).toBeUndefined();
  expect(bad.error).toMatch(/static/);
  const good = await request(page, symbolSimplifyFixture());
  expect(good.result!.removed).toBeGreaterThan(100);
  await expect(page.getByLabel('Drawing stage', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const basis of ['plain', 'affine', 'reflected'])
  for (const depth of [1, 2])
    test(`real worker simplifies only depth ${depth} isolated ${basis} original units`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto('/');
      const input = isolatedSymbolSimplifyFixture(basis);
      if (depth === 2) input.ancestry!.push('inner');
      input.project.frameScripts = [{ frame: 0, source: 'throw new Error("Scripts stay inert")' }];
      const before = structuredClone(input),
        recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1')),
        response = await request(page, input);
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual(prepareSymbolSimplifyRequest(input));
      expect(response.result!.selected).toEqual(depth === 1 ? ['line', 'partner'] : ['line']);
      expect(response.result!.removed).toBeGreaterThan(100);
      expect(response.result!.project.symbols![0].shapes[2]).toStrictEqual(
        input.project.symbols![0].shapes[2],
      );
      if (depth === 2)
        expect(response.result!.project.symbols![0].shapes[1]).toStrictEqual(
          input.project.symbols![0].shapes[1],
        );
      expect(input).toEqual(before);
      expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
      expect(errors).toEqual([]);
    });
test('real worker rejects escaped isolated membership and permits a fresh narrow retry', async ({
  page,
}) => {
  await page.goto('/');
  const input = isolatedSymbolSimplifyFixture();
  input.selected = ['other'];
  const response = await request(page, input);
  expect(response.result).toBeUndefined();
  expect(response.error).toMatch(/artwork/);
  const fresh = await request(page, isolatedSymbolSimplifyFixture());
  expect(fresh.result!.selected).toEqual(['line', 'partner']);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const basis of ['plain', 'affine', 'reflected'])
  test(`real worker fits a privately prepared ${basis} unpublished static definition without publication`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    const input = symbolSimplifyFixture(basis),
      definition = { id: 'pending', name: 'New prop', width: 400, height: 240, shapes: [] },
      artwork = structuredClone(input.project.symbols![0].shapes.slice(0, 2)),
      source = {
        project: input.project,
        definition,
        history: {},
        session: {},
        revision: 0,
        folder: '',
        context: 'new',
        eligible: true,
      };
    source.project.frameScripts = [
      { frame: 0, source: 'throw new Error("Stored scripts stay inert")' },
    ];
    const before = structuredClone(source.project),
      originalDefinition = structuredClone(definition),
      context = captureNewStaticSymbolSimplifyContext(() => source, artwork),
      requestInput = { project: context.project, symbolId: 'pending', selected: ['line'] },
      recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1')),
      response = await request(page, requestInput);
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(prepareSymbolSimplifyRequest(requestInput));
    expect(response.result!.removed).toBeGreaterThan(100);
    expect(response.result!.project.symbols!.slice(0, 2)).toStrictEqual(before.symbols);
    expect(response.result!.project.symbols![2].id).toBe('pending');
    expect(response.result!.project.libraryLinks).toContainEqual({
      kind: 'symbol',
      id: 'pending',
      name: 'New_prop',
    });
    context.validate();
    expect(source.project).toStrictEqual(before);
    expect(definition).toStrictEqual(originalDefinition);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
    expect(errors).toEqual([]);
  });

for (const scope of ['base', 'additional', 'button', 'isolated'] as const)
  test(`real frame simplification worker preserves original ${scope} storage`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    const input = symbolSimplifyFrameFixture(
      scope === 'additional' ? 'reflected' : 'plain',
      scope === 'button',
    );
    if (scope === 'additional' || scope === 'isolated')
      input.location = { layerId: 'detail', frame: 6 };
    if (scope === 'isolated') input.ancestry = ['outer'];
    const before = structuredClone(input),
      recovery = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    const response = await request(page, input);
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(prepareSymbolSimplifyRequest(input));
    expect(response.result!.removed).toBeGreaterThan(0);
    expect(response.result!.selected).toEqual(scope === 'isolated' ? ['line'] : ['line', 'paint']);
    const next = response.result!.project.symbols![0],
      prior = before.project.symbols![0];
    if (scope === 'additional' || scope === 'isolated') {
      expect(next.shapes).toEqual(prior.shapes);
      expect(next.timeline!.keys).toEqual(prior.timeline!.keys);
      expect(next.timeline!.layers![0].keys[0]).toEqual(prior.timeline!.layers![0].keys[0]);
    } else {
      expect(next.shapes).toEqual(prior.shapes);
      expect(next.timeline!.layers).toEqual(prior.timeline!.layers);
      expect(next.timeline!.keys[1]).toEqual(prior.timeline!.keys[1]);
    }
    expect(next.buttonStates).toEqual(prior.buttonStates);
    expect(next.timeline!.frameScripts).toEqual(prior.timeline!.frameScripts);
    expect(response.result!.project.layers).toEqual(before.project.layers);
    expect(input).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(recovery);
    expect(errors).toEqual([]);
  });

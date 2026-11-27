import { expect, test, type Page } from '@playwright/test';
import {
  sampledAttachedFillFixture,
  isolatedSampledAttachedFillFixture,
} from '../sampled-attached-fill-fixture';
import { newProject, symbolLayers, type Project, type Vector } from '../../packages/document/src';
import { captureRememberedNodeAuthoringFrame } from '../../packages/animation/src/node-motion-owner';
import { captureSymbolRememberedAuthoringFrame } from '../../packages/animation/src/symbol-motion-owner';
import { updateSymbolTimeline } from '../../packages/geometry/src/symbols';
test.use({ viewport: { width: 1440, height: 1400 } });
const errors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => expect(errors.get(page) ?? []).toEqual([]));
async function setup(
  page: Page,
  isolated = false,
  tangent = false,
  seam = false,
  compound = false,
) {
  const issues: string[] = [];
  errors.set(page, issues);
  page.on('pageerror', (e) => issues.push(String(e)));
  const configure = (line: Vector, paint: Vector) => {
    if (seam) {
      line.closed = true;
      line.nodes = structuredClone(paint.contours![0]).concat([{ x: 0, y: 0 }]);
    }
    if (compound) {
      line.kind = 'polygon';
      line.fillRule = 'evenodd';
      line.closed = true;
      line.contours = structuredClone(paint.contours);
      delete line.nodes;
    }
  };
  let project: Project;
  if (isolated) {
    const source = isolatedSampledAttachedFillFixture(tangent, configure);
    project = newProject();
    project.width = 400;
    project.height = 240;
    project.duration = 12;
    project.symbols = source.symbols;
  } else project = sampledAttachedFillFixture(tangent, configure).project;
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    project,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const read = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
    before = await read();
  if (isolated) {
    await page
      .getByRole('option', { name: 'Library item Sampled attached', exact: true })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit timeline', exact: true }).click();
    await page.getByRole('button', { name: 'Timeline tools…', exact: true }).click();
    await page.getByLabel('Symbol frame', { exact: true }).fill('5');
    await page.getByLabel('Symbol frame', { exact: true }).press('Tab');
    await page.getByLabel('Show sampled symbol stage', { exact: true }).check();
  } else {
    // The frame-range panel is created by an actual timeline cell selection.
    await page
      .getByLabel('Timeline frames', { exact: true })
      .click({ position: { x: 4 * 18 + 9, y: 40 } });
    await expect(page.getByLabel('Go to frame', { exact: true })).toHaveValue('5');
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page.getByRole('button', { name: 'Show sampled motion on stage', exact: true }).click();
  }
  await page
    .getByLabel(isolated ? 'Sampled symbol artwork' : 'Sampled stage artwork', { exact: true })
    .selectOption(JSON.stringify([isolated ? '@base' : 'base', 'line']));
  const prefix = isolated ? 'Sampled symbol' : 'Sampled',
    number = page.getByLabel(
      compound
        ? `${prefix} compound ${tangent ? '' : 'anchor '}node number`
        : isolated
          ? 'Sampled symbol Bezier node number'
          : 'Sampled Bezier node number',
      { exact: true },
    );
  if (compound)
    await page
      .getByLabel(`${prefix} compound ${tangent ? '' : 'anchor '}contour number`, { exact: true })
      .fill('1');
  await number.fill('1');
  await number.press('Tab');
  if (tangent)
    await page
      .getByLabel(`${prefix} ${compound ? 'compound' : 'Bezier'} tangent role`, { exact: true })
      .selectOption('out');
  const kind = `${compound ? 'compound ' : ''}${tangent ? 'tangent' : compound ? 'anchor' : 'node'}`;
  const x = page.getByLabel(`${prefix} ${kind} document X`, {
      exact: true,
    }),
    y = page.getByLabel(`${prefix} ${kind} document Y`, { exact: true });
  const target = tangent ? { x: 140, y: 5 } : { x: 90, y: 50 };
  await x.fill(String(target.x));
  await y.fill(String(target.y));
  const preview = page.getByRole('button', {
      name: `Preview sampled ${isolated ? 'symbol ' : ''}${kind} position`,
      exact: true,
    }),
    commit = page.getByRole('button', {
      name: `Promote and position sampled ${isolated ? 'symbol ' : ''}${kind}`,
      exact: true,
    }),
    canvas = page.getByLabel(isolated ? 'Sampled symbol stage' : 'Drawing stage', { exact: true });
  const probe = tangent ? { x: 180, y: 32 } : { x: 100, y: 56 };
  const pixel = (authored = false) =>
    (authored ? page.getByLabel('Symbol timeline preview', { exact: true }) : canvas).evaluate(
      (n: HTMLCanvasElement, p) => {
        const box = n.getBoundingClientRect(),
          scale = Math.min(500 / 400, 290 / 240),
          x = p.isolated ? 20 + p.x * scale : ((box.width / 2 - 200 + p.x) * n.width) / box.width,
          y = p.isolated
            ? 20 + p.y * scale
            : ((box.height / 2 - 120 + p.y) * n.height) / box.height;
        if (x < 0 || y < 0 || x >= n.width || y >= n.height)
          throw Error(
            JSON.stringify({ x, y, width: n.width, height: n.height, css: box.toJSON() }),
          );
        return Array.from(n.getContext('2d')!.getImageData(x, y, 1, 1).data);
      },
      { ...probe, isolated },
    );
  const expected = () => {
    if (isolated) {
      const capture = captureSymbolRememberedAuthoringFrame(() => ({
          definition: before.symbols![0],
          symbols: before.symbols!,
          revision: 0,
          frame: 4,
        })),
        definition = compound
          ? tangent
            ? capture.prepareCompoundTangentPosition('@base', 'line', 0, 0, 'out', target)
            : capture.prepareCompoundNodePosition('@base', 'line', 0, 0, target)
          : tangent
            ? capture.prepareTangentPosition('@base', 'line', 0, 'out', target)
            : capture.prepareNodePosition('@base', 'line', 0, target);
      capture.dispose();
      const result = structuredClone(before);
      updateSymbolTimeline(result, 'art', definition);
      return result;
    }
    const capture = captureRememberedNodeAuthoringFrame(() => ({
        project: before,
        revision: 0,
        frame: 4,
      })),
      result = compound
        ? tangent
          ? capture.prepareCompoundTangentPosition('base', 'line', 0, 0, 'out', target)
          : capture.prepareCompoundNodePosition('base', 'line', 0, 0, target)
        : tangent
          ? capture.prepareTangentPosition('base', 'line', 0, 'out', target)
          : capture.prepareNodePosition('base', 'line', 0, target);
    capture.dispose();
    return result;
  };
  const comparable = (p: Project) => {
    const result = structuredClone(p),
      tracks = isolated ? symbolLayers(result.symbols![0]) : result.layers;
    for (const layer of tracks) for (const span of layer.motionSpans ?? []) span.id = 'recipe';
    return result;
  };
  return { before, read, x, y, preview, commit, pixel, canvas, expected, comparable };
}
for (const isolated of [false, true])
  for (const tangent of [false, true])
    for (const compound of [false, true])
      test(`${isolated ? 'isolated' : 'main'} sampled ${compound ? 'compound ' : ''}${tangent ? 'tangent' : 'anchor'} previews linked paint and preserves complete history`, async ({
        page,
      }) => {
        const f = await setup(page, isolated, tangent, false, compound);
        await expect.poll(f.pixel).toEqual([255, 255, 255, 255]);
        const expected = f.expected();
        await f.preview.click();
        await expect.poll(f.pixel).toEqual([255, 0, 0, 255]);
        expect(await f.read()).toEqual(f.before);
        await f.commit.click();
        if (isolated) {
          if (!compound)
            await expect(
              page.getByText(
                tangent
                  ? 'Authored outgoing tangent at anchor 1 selected in line.'
                  : 'Authored Bezier anchor 1 selected in line.',
                { exact: true },
              ),
            ).toBeVisible();
          const timeline = page.getByRole('dialog', { name: 'Symbol timeline', exact: true });
          const undo = timeline.getByRole('button', {
            name: 'Undo symbol timeline change',
            exact: true,
          });
          await undo.click();
          await expect.poll(() => f.pixel(true)).toEqual([255, 255, 255, 255]);
          await timeline
            .getByRole('button', { name: 'Redo symbol timeline change', exact: true })
            .click();
          await expect.poll(() => f.pixel(true)).toEqual([255, 0, 0, 255]);
          expect(await f.read()).toEqual(f.before);
          await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
          expect(await f.read()).toEqual(f.before);
          await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
        }
        await expect.poll(async () => f.comparable(await f.read())).toEqual(f.comparable(expected));
        const published = await f.read(),
          recipes = isolated
            ? published.symbols![0].timeline!.motionSpans!
            : published.layers[0].motionSpans!,
          original = isolated
            ? f.before.symbols![0].timeline!.motionSpans![0]
            : f.before.layers[0].motionSpans![0];
        expect(recipes).toHaveLength(2);
        expect(recipes[0].id).toBe(original.id);
        expect(recipes[1].id).not.toBe(original.id);
        await page.getByLabel('Drawing stage', { exact: true }).focus();
        await page.keyboard.press('Control+z');
        await expect.poll(f.read).toEqual(f.before);
        await page.keyboard.press('Control+Shift+z');
        await expect.poll(async () => f.comparable(await f.read())).toEqual(f.comparable(expected));
      });
test('isolated sampled linked-fill Cancel discards the local edit without document history', async ({
  page,
}) => {
  const f = await setup(page, true);
  await f.commit.click();
  await page.getByRole('button', { name: 'Cancel symbol timeline', exact: true }).click();
  expect(await f.read()).toEqual(f.before);
});

test('sampled closed stroke seam and paint stay joined after explicit anchor commit', async ({
  page,
}) => {
  const f = await setup(page, false, false, true);
  await f.commit.click();
  const out = await f.read(),
    [paint, line] = out.layers[0].keys.find((k) => k.frame === 4)!.shapes;
  const point = (s: typeof line, n: { x: number; y: number }) => ({ x: s.x + n.x, y: s.y + n.y });
  expect(point(line, line.nodes![0])).toEqual({ x: 90, y: 50 });
  expect(point(line, line.nodes!.at(-1)!)).toEqual({ x: 90, y: 50 });
  expect(point(paint, paint.contours![0][0])).toEqual({ x: 90, y: 50 });
  expect(line.nodes).toHaveLength(5);
});

for (const isolated of [false, true])
  test(`${isolated ? 'isolated' : 'main'} sampled linked preview invalidates on authoritative target edit and permits a fresh commit`, async ({
    page,
  }) => {
    const f = await setup(page, isolated);
    await f.preview.click();
    await expect.poll(f.pixel).toEqual([255, 0, 0, 255]);
    await f.x.fill('95');
    await expect.poll(f.pixel).toEqual([255, 255, 255, 255]);
    expect(await f.read()).toEqual(f.before);
    await f.commit.click();
    if (isolated) {
      await page.getByRole('button', { name: 'Apply symbol timeline', exact: true }).click();
      await page.getByRole('button', { name: 'Save and return to scene', exact: true }).click();
    }
    const p = await f.read(),
      track = isolated ? symbolLayers(p.symbols![0])[0] : p.layers[0],
      [paint, line] = track.keys.find((k) => k.frame === 4)!.shapes;
    expect({ x: line.x + line.nodes![0].x, y: line.y + line.nodes![0].y }).toEqual({
      x: 95,
      y: 50,
    });
    expect({ x: paint.x + paint.contours![0][0].x, y: paint.y + paint.contours![0][0].y }).toEqual({
      x: 95,
      y: 50,
    });
  });

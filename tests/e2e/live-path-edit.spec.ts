import { test, expect, type Page } from '@playwright/test';
import { liveSplitFixture } from '../live-motion-split-fixture';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import type { Project } from '../../packages/document/src';
import { exportHTML } from '../../packages/export-web/src';
import { readFile } from 'node:fs/promises';

async function setup(page: Page, mode = 'plain') {
  await page.setViewportSize({ width: 1500, height: 1100 });
  const p = mode === 'movie' ? livePresentationFixture('movie') : liveSplitFixture();
  p.layers[0].name = 'Main';
  if (mode === 'guide' || mode === 'offsetGuide' || mode === 'staticGuide') {
    const source = p.layers[0].keys[0].shapes[0];
    p.layers.push({id:'route',name:'Guide',visible:true,locked:false,drawingMode:'object',
      keys:[{frame:0,shapes:[{...source,id:'guide',kind:'path',...(mode === 'offsetGuide' ? {x:0,y:24} : {}),width:80,height:26,fillEnabled:false,
        strokeWidth:2,points:[{x:0,y:0},{x:40,y:26},{x:80,y:0}]}]}]});
  }
  if (mode === 'merge') p.layers[0].drawingMode = 'merge';
  p.fps = 1;
  if (mode === 'bad') p.layers[0].keys[1].shapes[0].width = 50;
  if (mode === 'multiple')
    for (const k of p.layers[0].keys.slice(0, 2))
      k.shapes.push({ ...structuredClone(k.shapes[0]), id: 'second', y: 55 });
  if (mode === 'remaining') {
    p.duration = 20;
    p.layers[0].keys[2] = {
      frame: 16,
      shapes: [{ ...structuredClone(p.layers[0].keys[1].shapes[0]), x: 120 }],
    };
    p.layers[0].keys.push({ frame: 18, shapes: [] });
    p.layers[0].liveMotionSpans!.push({ id: 'next', start: 8, end: 16, ease: 'in-out' });
  }
  if (
    [
      'two',
      'mixed',
      'inactive',
      'locked',
      'hidden',
      'laterBad',
      'mixedKeep',
      'laterStill',
    ].includes(mode)
  ) {
    p.layers.push({ ...structuredClone(p.layers[0]), id: 'later', name: 'Later' });
    if (mode === 'inactive') p.layers[0].locked = true;
    if (mode === 'locked') p.layers[1].locked = true;
    if (mode === 'hidden') p.layers[1].visible = false;
  }
  const span = p.layers[0].liveMotionSpans![0];
  if (mode === 'paint') {
    p.layers[0].keys[0].shapes[0].fill = '#000000';
    p.layers[0].keys[1].shapes[0].fill = '#808080';
  }
  if (mode === 'disable') span.options = { paint: true };
  if (mode === 'removeOption') span.options = { paint: false, affine: false };
  if (mode === 'clear') span.options = { paint: false };
  if (mode === 'mixed') {
    span.options = { paint: false };
    p.layers[1].liveMotionSpans![0].options = { affine: false };
    p.layers[1].liveMotionSpans![0].ease = 'out';
  }
  if (mode === 'laterBad') p.layers[1].keys[1].shapes[0].width = 50;
  if (mode === 'advanced')
    Object.assign(span, {
      options: { paint: true, gradientGeometry: true, gradientStops: { pairs: 'auto' } },
      opacityEase: 'out',
      paintEase: 'linear',
      path: { startX: 0, startY: 0, endX: 0, endY: 0 },
      rotation: { direction: 'clockwise', turns: 0 },
    });
  const arch = { startX: 0, startY: 40, endX: 0, endY: 40 };
  if (['remove', 'noOp', 'mixedKeep'].includes(mode)) span.path = { ...arch };
  const waypoint = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    waypoints: [{ x: 40, y: 30 }],
    curvedWaypoints: true,
    distance: true,
    tangent: true,
    waypointTangents: [
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
    ],
    waypointIncoming: [{ x: -10, y: 0 }],
    headingOffset: 10,
    headingOffsetEnd: 20,
  };
  if (mode === 'waypoint') span.path = structuredClone(waypoint);
  if (mode === 'mixedKeep') {
    p.layers[1].liveMotionSpans![0].path = structuredClone(waypoint);
    p.layers[1].liveMotionSpans![0].opacityEase = 'out';
  }
  if (mode === 'failed') span.path = { startX: 40, startY: 0, endX: -120, endY: 0, tangent: true };
  if (mode === 'laterStill') p.layers[1].keys[1].shapes[0].x = p.layers[1].keys[0].shapes[0].x;
  if (mode === 'staticGuide') delete p.layers[0].liveMotionSpans;
  if (mode === 'affine' || mode === 'reflected') {
    span.options = { affine: true, nodes: true };
    for (const k of p.layers[0].keys.slice(0, 2))
      Object.assign(k.shapes[0], {
        kind: 'polygon',
        fillRule: 'evenodd',
        transform: [mode === 'reflected' ? -1.5 : 1.5, 0.2, 0.3, 1],
        pivot: { x: -5, y: 30 },
        contours: [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 5, y: 5 },
            { x: 15, y: 5 },
            { x: 15, y: 15 },
            { x: 5, y: 15 },
          ],
        ],
      });
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('live-path-ui-seed')) {
      sessionStorage.setItem('live-path-ui-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, p);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  const open = async () => {
    const cmd = page.getByRole('button', { name: 'Edit live tween…', exact: true });
    if (!(await cmd.isVisible()))
      await page.getByRole('button', { name: 'Control', exact: true }).click();
    await cmd.click();
    await expect(page.getByRole('dialog', { name: 'Edit live tween', exact: true })).toBeVisible();
  };
  return {
    p,
    errors,
    open,
    d: page.getByRole('dialog', { name: 'Edit live tween', exact: true }),
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
async function apply(page: Page) {
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  await d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(d).toBeHidden();
}
async function undo(page: Page, redo = false) {
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
}
async function go(page: Page, n: number) {
  await page.getByTitle('First frame', { exact: true }).click();
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight');
}
async function pixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (el, { p, x, y }) => {
      const c = el as HTMLCanvasElement;
      return [
        ...c
          .getContext('2d')!
          .getImageData(
            c.width / 2 + (x - p.width / 2) * devicePixelRatio,
            c.height / 2 + (y - p.height / 2) * devicePixelRatio,
            1,
            1,
          ).data,
      ];
    },
    { p, x, y },
  );
}

const arch = { startX: 0, startY: 40, endX: 0, endY: 40 };
async function trajectory(page: Page, controls = arch) {
  const d = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  await d.getByLabel('Live trajectory mode', { exact: true }).selectOption('replace');
  for (const [name, value] of Object.entries(controls))
    await d.getByLabel(`Live cubic ${name}`, { exact: true }).fill(String(value));
}

for (const hook of ['clone', 'serialize'])
  for (const action of [
    'mode',
    'startY',
    'endX',
    'distance',
    'tangent',
    'source',
    'frame',
    'tool',
    'context',
  ])
    test(`live path ${hook} rejects actual late ${action} and permits a fresh retry`, async ({
      page,
    }) => {
      const f = await setup(page);
      await f.open();
      await trajectory(page);
      if (action === 'context') {
        await page
          .getByRole('button', { name: 'Control', exact: true })
          .evaluate((el) => (el as HTMLButtonElement).click());
        await expect(
          page.getByRole('button', { name: 'Show sampled motion on stage', exact: true }),
        ).toBeAttached();
      }
      await page.evaluate(
        ({ hook, action }) => {
          const w = window as unknown as { pathHookHit: boolean };
          w.pathHookHit = false;
          const fire = (value: unknown) => {
            const p = value as Project;
            if (w.pathHookHit || !p?.layers?.[0]?.liveMotionSpans?.[0]?.path) return;
            w.pathHookHit = true;
            if (action === 'mode') {
              const e = document.querySelector(
                '[aria-label="Live trajectory mode"]',
              ) as HTMLSelectElement;
              for (const value of ['keep', 'replace']) {
                e.value = value;
                e.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            if (action === 'startY' || action === 'endX') {
              const e = document.querySelector(
                  `[aria-label="Live cubic ${action}"]`,
                ) as HTMLInputElement,
                original = e.value;
              for (const value of ['5', original]) {
                e.value = value;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
            if (action === 'distance' || action === 'tangent') {
              const e = document.querySelector(
                action === 'distance'
                  ? '[aria-label="Live cubic distance timing"]'
                  : '[aria-label="Live cubic tangent heading"]',
              ) as HTMLInputElement;
              e.click();
              e.click();
            }
            if (action === 'source') {
              const e = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
              e.value = 'Separate path source edit';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (action === 'frame')
              for (const title of ['Last frame', 'First frame'])
                (document.querySelector(`button[title="${title}"]`) as HTMLButtonElement).click();
            if (action === 'tool')
              for (const label of ['Brush', 'Selection'])
                (document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
            if (action === 'context')
              for (let i = 0; i < 2; i++) {
                const e = [...document.querySelectorAll('button')].find(
                  (e) =>
                    e.textContent === 'Show sampled motion on stage' ||
                    e.textContent === 'Return to authored stage',
                );
                if (!e) throw Error('Missing actual sampled-mode control');
                e.click();
              }
          };
          if (hook === 'clone') {
            const clone = structuredClone;
            window.structuredClone = <T>(value: T) => {
              const out = clone(value);
              fire(value);
              return out;
            };
          } else {
            const stringify = JSON.stringify;
            JSON.stringify = ((...args: Parameters<typeof stringify>) => {
              const out = stringify(...args);
              fire(args[0]);
              return out;
            }) as typeof stringify;
          }
        },
        { hook, action },
      );
      await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
      expect(
        await page.evaluate(() => (window as unknown as { pathHookHit: boolean }).pathHookHit),
      ).toBe(true);
      const expected = structuredClone(f.p);
      if (action === 'source') expected.layers[0].name = 'Separate path source edit';
      expect(await f.read()).toEqual(expected);
      if (await f.d.isVisible()) await page.keyboard.press('Escape');
      await undo(page);
      expect(await f.read()).toEqual(f.p);
      await f.open();
      await trajectory(page);
      await apply(page);
      const edited = structuredClone(f.p);
      edited.layers[0].liveMotionSpans![0].path = { ...arch };
      expect(await f.read()).toEqual(edited);
      await undo(page);
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });

test('cloned cubic control getters reject with zero reads and valid numeric retry succeeds', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await trajectory(page);
  await page.evaluate(() => {
    const clone = structuredClone,
      w = window as unknown as { pathGetterHit: boolean; pathGetterReads: number };
    w.pathGetterHit = false;
    w.pathGetterReads = 0;
    window.structuredClone = <T>(value: T) => {
      const out = clone(value);
      if (!w.pathGetterHit && Array.isArray(out) && out[0]?.changes?.path) {
        w.pathGetterHit = true;
        Object.defineProperty(out[0].changes.path, 'startY', {
          enumerable: true,
          get() {
            w.pathGetterReads++;
            return 40;
          },
        });
      }
      return out;
    };
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('Error:');
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { pathGetterHit: boolean; pathGetterReads: number };
      return [w.pathGetterHit, w.pathGetterReads];
    }),
  ).toEqual([true, 0]);
  expect(await f.read()).toEqual(f.p);
  await apply(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('forged trajectory mode cannot reinterpret or delete original route data', async ({
  page,
}) => {
  const f = await setup(page, 'waypoint');
  await f.open();
  await f.d.getByLabel('Live trajectory mode', { exact: true }).evaluate((el) => {
    const forged = document.createElement('option');
    forged.value = 'forged';
    el.append(forged);
    (el as HTMLSelectElement).value = 'forged';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('explicit live trajectory mode');
  expect(await f.read()).toEqual(f.p);
  await trajectory(page);
  await apply(page);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
for (const mode of [
  'cubic',
  'distance',
  'tangent',
  'remove',
  'waypoint',
  'multiple',
  'affine',
  'reflected',
  'negative',
])
  test(`main live ${mode} cubic action preserves exact source keys/settings and one history transaction`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await f.open();
    await expect(f.d.getByLabel('Live trajectory mode', { exact: true })).toHaveValue('keep');
    const expected = structuredClone(f.p),
      span = expected.layers[0].liveMotionSpans![0];
    if (mode === 'remove') {
      await f.d.getByLabel('Live trajectory mode', { exact: true }).selectOption('remove');
      delete span.path;
    } else {
      if (mode === 'waypoint')
        await expect(
          f.d.getByText(/Curved waypoint route.*custom handles.*saved heading correction/),
        ).toBeVisible();
      const path =
        mode === 'negative' ? { startX: -80, startY: -40, endX: 80, endY: -40 } : { ...arch };
      await trajectory(page, path);
      span.path = { ...path };
      if (mode === 'distance') {
        await f.d.getByLabel('Live cubic distance timing', { exact: true }).check();
        span.path.distance = true;
      }
      if (mode === 'tangent') {
        await f.d.getByLabel('Live cubic tangent heading', { exact: true }).check();
        span.path.tangent = true;
      }
    }
    await apply(page);
    expect(await f.read()).toEqual(expected);
    if (mode === 'multiple')
      await expect(page.locator('.inspector-title strong')).toHaveText('2 objects');
    else await expect(page.getByLabel('Shape X', { exact: true })).toHaveValue('8');
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    await undo(page, true);
    expect(await f.read()).toEqual(expected);
    if (['cubic', 'distance', 'tangent', 'remove', 'affine', 'reflected'].includes(mode)) {
      await go(page, 4);
      const x = mode === 'affine' ? 51 : mode === 'reflected' ? 45 : 53,
        y = mode === 'remove' ? 17 : mode === 'affine' || mode === 'reflected' ? 44 : 47;
      await expect.poll(() => pixel(page, f.p, x, y)).toEqual([255, 0, 0, 255]);
      if (!['affine', 'reflected'].includes(mode))
        expect(await pixel(page, f.p, 53, mode === 'remove' ? 47 : 17)).toEqual([
          255, 255, 255, 255,
        ]);
    }
    await page.reload();
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    expect(await f.read()).toEqual(expected);
    expect(f.errors).toEqual([]);
  });

for (const mode of ['waypoint', 'mixedKeep'])
  test(`Keep retains exact ${mode} routes and all advanced annotations while editing easing`, async ({
    page,
  }) => {
    const f = await setup(page, mode);
    await f.open();
    if (mode === 'mixedKeep')
      await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).check();
    await f.d.getByLabel('Change live tween easing', { exact: true }).check();
    await f.d.getByLabel('Edited live tween easing', { exact: true }).selectOption('in');
    await apply(page);
    const expected = structuredClone(f.p);
    for (const l of expected.layers) l.liveMotionSpans![0].ease = 'in';
    expect(await f.read()).toEqual(expected);
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('same cubic replacement and removing an absent path cannot add history', async ({ page }) => {
  const f = await setup(page, 'noOp');
  await f.open();
  await trajectory(page);
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('unchanged');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Live trajectory mode', { exact: true }).selectOption('remove');
  await apply(page);
  const removed = await f.read();
  await f.open();
  await f.d.getByLabel('Live trajectory mode', { exact: true }).selectOption('remove');
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('unchanged');
  expect(await f.read()).toEqual(removed);
  await page.keyboard.press('Escape');
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const field of ['startX', 'startY', 'endX', 'endY'])
  test(`raw live cubic ${field} rejects NaN before source/history changes`, async ({ page }) => {
    const f = await setup(page);
    await f.open();
    await trajectory(page);
    await f.d.getByLabel(`Live cubic ${field}`, { exact: true }).fill('');
    await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
    await expect(f.d.getByRole('status')).toContainText('finite');
    expect(await f.read()).toEqual(f.p);
    await trajectory(page);
    await apply(page);
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('later stationary tangent rejects all selected paths and a fresh valid subset succeeds', async ({
  page,
}) => {
  const f = await setup(page, 'laterStill');
  await f.open();
  await trajectory(page, { startX: 40, startY: 0, endX: -40, endY: 0 });
  await f.d.getByLabel('Live cubic tangent heading', { exact: true }).check();
  await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).check();
  await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
  await expect(f.d.getByRole('status')).toContainText('tangent');
  expect(await f.read()).toEqual(f.p);
  await f.d.getByLabel('Edit live tween Later frames 1–9', { exact: true }).uncheck();
  await apply(page);
  const expected = structuredClone(f.p);
  expected.layers[0].liveMotionSpans![0].path = {
    startX: 40,
    startY: 0,
    endX: -40,
    endY: 0,
    tangent: true,
  };
  expect(await f.read()).toEqual(expected);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('Remove path recovers an actual failing interior without sampling the failed trajectory', async ({
  page,
}) => {
  const f = await setup(page, 'failed');
  await go(page, 4);
  await expect(page.getByLabel('Live stage status')).toContainText('Error:');
  await f.open();
  await f.d.getByLabel('Live trajectory mode', { exact: true }).selectOption('remove');
  await apply(page);
  const expected = structuredClone(f.p);
  delete expected.layers[0].liveMotionSpans![0].path;
  expect(await f.read()).toEqual(expected);
  await go(page, 4);
  await expect.poll(() => pixel(page, f.p, 53, 17)).toEqual([255, 0, 0, 255]);
  await go(page, 0);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

test('explicit cubic UI output reaches PNG/Test Movie and later endpoint changes without Refresh', async ({
  page,
}) => {
  const f = await setup(page, 'movie');
  await f.open();
  await trajectory(page);
  await apply(page);
  const edited = await f.read(),
    endpoint = structuredClone(edited);
  endpoint.layers[0].keys[0].shapes[0].x = 20;
  await page.getByLabel('Shape X', { exact: true }).fill('20');
  await page.getByLabel('Shape X', { exact: true }).press('Tab');
  expect(await f.read()).toEqual(endpoint);
  await go(page, 2);
  await expect.poll(() => pixel(page, f.p, 55, 35)).toEqual([255, 0, 0, 255]);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const bytes = await readFile((await (await pending).path())!);
  const pixels = await page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(
        await (await fetch('data:image/png;base64,' + data)).blob(),
      ),
      c = document.createElement('canvas');
    c.width = 160;
    c.height = 80;
    const x = c.getContext('2d')!;
    x.drawImage(bitmap, 0, 0);
    bitmap.close();
    return [
      [55, 35],
      [65, 45],
    ].map(([a, b]) => [...x.getImageData(a, b, 1, 1).data]);
  }, bytes.toString('base64'));
  expect(pixels).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  expect(await f.read()).toEqual(endpoint);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Test movie', exact: false })
    .filter({ hasText: 'Ctrl Enter' })
    .click();
  const movie = page.getByRole('dialog', { name: 'Test live movie', exact: true });
  await expect(movie.getByLabel('Live movie status')).toContainText('Live movie ready');
  expect(
    await movie
      .getByLabel('Live movie interaction')
      .evaluate((el) => [
        ...(el as HTMLCanvasElement).getContext('2d')!.getImageData(55, 35, 1, 1).data,
      ]),
  ).toEqual([255, 0, 0, 255]);
  await page.keyboard.press('Escape');
  expect(await f.read()).toEqual(endpoint);
  await go(page, 0);
  await undo(page);
  expect(await f.read()).toEqual(edited);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const action of ['source', 'candidate', 'reentry'])
  test(`final history preparation ${action} cannot publish stale data or duplicate history`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.open();
    await trajectory(page);
    await page.evaluate((action) => {
      const clone = structuredClone,
        stringify = JSON.stringify,
        w = window as unknown as { finalHit: boolean };
      w.finalHit = false;
      let candidate: Project | undefined;
      if (action === 'source')
        JSON.stringify = ((...args: Parameters<typeof stringify>) => {
          const out = stringify(...args),
            p = args[0] as Project;
          if (
            !w.finalHit &&
            p?.layers?.[0]?.id === 'track' &&
            new Error().stack?.includes('prepareRecord')
          ) {
            w.finalHit = true;
            const el = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
            el.value = 'Separate history edit';
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return out;
        }) as typeof stringify;
      else
        window.structuredClone = <T>(value: T) => {
          const out = clone(value),
            p = out as unknown as Project;
          if (p?.layers?.[0]?.id === 'track') {
            if (candidate && candidate.layers[0].liveMotionSpans?.[0]?.path && !w.finalHit) {
              w.finalHit = true;
              if (action === 'candidate') candidate.layers[0].keys[0].shapes[0].x += 100;
              else {
                const el = [...document.querySelectorAll('button')].find(
                  (e) => e.textContent === 'Apply live tween changes',
                )!;
                el.disabled = false;
                el.click();
              }
            } else if (!candidate) candidate = p;
          }
          return out;
        };
    }, action);
    await f.d.getByRole('button', { name: 'Apply live tween changes', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { finalHit: boolean }).finalHit)).toBe(
      true,
    );
    const expected = structuredClone(f.p);
    if (action === 'source') expected.layers[0].name = 'Separate history edit';
    if (action === 'reentry') expected.layers[0].liveMotionSpans![0].path = { ...arch };
    expect(await f.read()).toEqual(expected);
    if (await f.d.isVisible()) await page.keyboard.press('Escape');
    await undo(page);
    expect(await f.read()).toEqual(f.p);
    if (action !== 'reentry') {
      await f.open();
      await trajectory(page);
      await apply(page);
      await undo(page);
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });

test('linked guide artwork drives a live tween after an on-stage node edit and recovery', async ({page}) => {
  const f = await setup(page,'guide');
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await f.open();
  await f.d.getByLabel('Live trajectory mode').selectOption('guide');
  await f.d.getByLabel('Linked stage guide').selectOption({label:'Guide · path 1 · frame 1'});
  await apply(page);
  const binding = {layerId:'route',frame:0,shapeId:'guide'};
  expect((await f.read()).layers[0].liveMotionSpans![0].guide).toEqual(binding);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  await undo(page,true);
  await go(page,4);
  await expect.poll(()=>pixel(page,f.p,57,47)).toEqual([255,0,0,255]);
  await go(page,0);
  await page.getByRole('group',{name:'Layer row Guide',exact:true}).locator('button.layer-name').click();
  await page.getByRole('button',{name:'Subselection',exact:true}).click();
  const canvas = page.getByLabel('Drawing stage',{exact:true}), rect = (await canvas.boundingBox())!;
  const x = rect.x + rect.width/2 - f.p.width/2 + 48, y = rect.y + rect.height/2 - f.p.height/2 + 38;
  await page.mouse.click(x,y);
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+26,{steps:5});
  await page.mouse.up();
  await expect.poll(async()=> (await f.read()).layers[1].keys[0].shapes[0].points[1].y).toBeCloseTo(52,0);
  expect((await f.read()).layers[0].keys).toEqual(f.p.layers[0].keys);
  await undo(page);
  expect((await f.read()).layers[1]).toEqual(f.p.layers[1]);
  await undo(page,true);
  await go(page,4);
  await expect.poll(()=>pixel(page,f.p,57,73)).toEqual([255,0,0,255]);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,4);
  await expect.poll(()=>pixel(page,f.p,57,73)).toEqual([255,0,0,255]);
  expect(await pixel(page,f.p,57,47)).toEqual([255,255,255,255]);
  const output=await page.context().newPage();
  try {
    await output.clock.install();
    await output.clock.pauseAt(new Date(Date.now()+1000));
    await output.setContent(exportHTML(await f.read()));
    await output.clock.runFor(4016);
    const colors = await output.locator('canvas').first().evaluate((c:HTMLCanvasElement)=>
      [73,47].map(y=>Array.from(c.getContext('2d')!.getImageData(57,y,1,1).data)));
    expect(colors).toEqual([[255,0,0,255],[255,255,255,255]]);
  } finally { await output.close(); }
  expect(f.errors).toEqual([]);
});

test('a follower keeps its offset and rotates along the guide in the editor and standalone HTML', async ({page}) => {
  const f=await setup(page,'offsetGuide');
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await f.open();
  await f.d.getByLabel('Live trajectory mode').selectOption('guide');
  await f.d.getByLabel('Linked stage guide').selectOption({label:'Guide · path 1 · frame 1'});
  await f.d.getByLabel('Guide offset X').fill('8');
  await f.d.getByLabel('Guide offset Y').fill('-12');
  await f.d.getByLabel('Follow guide tangent').check();
  await apply(page);
  const saved=await f.read();
  expect(saved.layers[0].liveMotionSpans![0].guide).toEqual({
    layerId:'route',shapeId:'guide',frame:0,offset:{x:8,y:-12},tangent:true
  });
  expect(saved.layers[0].keys).toEqual(f.p.layers[0].keys);
  await undo(page);
  expect(await f.read()).toEqual(f.p);
  await undo(page,true);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await f.open();
  await f.d.getByLabel('Live trajectory mode').selectOption('guide');
  await expect(f.d.getByLabel('Guide offset X')).toHaveValue('8');
  await expect(f.d.getByLabel('Guide offset Y')).toHaveValue('-12');
  await expect(f.d.getByLabel('Follow guide tangent')).toBeChecked();
  await f.d.getByRole('button',{name:'Close dialog',exact:true}).click();
  await go(page,2);
  await expect.poll(()=>pixel(page,f.p,24,37)).toEqual([255,0,0,255]);
  expect(await pixel(page,f.p,45,27)).toEqual([255,255,255,255]);
  const output=await page.context().newPage();
  try {
    await output.clock.install();
    await output.clock.pauseAt(new Date(Date.now()+1000));
    await output.setContent(exportHTML(saved));
    await output.clock.runFor(2016);
    const colors=await output.locator('canvas').first().evaluate((el:HTMLCanvasElement)=>
      [[24,37],[45,27]].map(([x,y])=>Array.from(el.getContext('2d')!.getImageData(x,y,1,1).data)));
    expect(colors).toEqual([[255,0,0,255],[255,255,255,255]]);
  } finally { await output.close(); }
});

test('guide layers keep editable paths on stage and hide them in Test Movie and HTML', async ({page}) => {
  const f=await setup(page,'guide');
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await f.open();
  await f.d.getByLabel('Live trajectory mode').selectOption('guide');
  await f.d.getByLabel('Linked stage guide').selectOption({label:'Guide · path 1 · frame 1'});
  await apply(page);
  const linked=await f.read();
  const row=page.getByRole('group',{name:'Layer row Guide',exact:true}).locator('button.layer-name');
  await row.click({button:'right'});
  await page.getByRole('menuitem',{name:'Convert to guide layer',exact:true}).click();
  const guide=structuredClone(linked);
  guide.layers[1].guideLayer=true;
  expect(await f.read()).toEqual(guide);
  await undo(page);
  expect(await f.read()).toEqual(linked);
  await undo(page,true);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await row.click({button:'right'});
  await page.getByRole('menuitem',{name:'Layer properties…',exact:true}).click();
  const properties=page.getByRole('dialog',{name:'Layer properties',exact:true});
  await expect(properties.getByLabel('Layer properties type')).toHaveValue('guide');
  await properties.getByLabel('Layer properties type').selectOption({label:'Normal'});
  await properties.getByRole('button',{name:'Apply layer properties'}).click();
  expect(await f.read()).toEqual(linked);
  await undo(page);
  await go(page,4);
  await expect.poll(async()=>(await pixel(page,f.p,18,18))[0]).toBeLessThan(80);
  await expect.poll(()=>pixel(page,f.p,57,47)).toEqual([255,0,0,255]);
  const colors=(canvas:ReturnType<Page['locator']>)=>canvas.evaluate((el:HTMLCanvasElement)=>
    [[18,18],[57,47]].map(([x,y])=>Array.from(el.getContext('2d')!.getImageData(x,y,1,1).data)));
  const expected=[[255,255,255,255],[255,0,0,255]];
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:/Test movie/i}).filter({hasText:'Ctrl Enter'}).click();
  const movie=page.getByRole('dialog',{name:'Test live movie',exact:true});
  await expect(movie.getByLabel('Live movie status')).toContainText('Live movie ready');
  await expect.poll(()=>colors(movie.getByLabel('Live movie interaction'))).toEqual(expected);
  const output=await page.context().newPage();
  try {
    await output.clock.install();
    await output.clock.pauseAt(new Date(Date.now()+1000));
    await output.setContent(exportHTML(guide));
    await output.clock.runFor(4016);
    expect(await colors(output.locator('canvas').first())).toEqual(expected);
  } finally { await output.close(); }
  expect(await f.read()).toEqual(guide);
});

test('layer properties keep a guide out of ordinary Test Movie', async ({page})=>{
  const f=await setup(page,'staticGuide');
  await page.getByRole('group',{name:'Layer row Guide',exact:true}).locator('button.layer-name').click({button:'right'});
  await page.getByRole('menuitem',{name:'Layer properties…',exact:true}).click();
  const properties=page.getByRole('dialog',{name:'Layer properties',exact:true});
  await properties.getByLabel('Layer properties type').selectOption({label:'Guide'});
  await properties.getByRole('button',{name:'Apply layer properties'}).click();
  expect((await f.read()).layers[1].guideLayer).toBe(true);
  await page.getByRole('button',{name:'Control',exact:true}).click();
  await page.getByRole('button',{name:/Test movie/i}).filter({hasText:'Ctrl Enter'}).click();
  const movie=page.getByRole('dialog',{name:'Test movie',exact:true});
  await expect(movie).toContainText(/WebGL|Canvas2D/);
  const canvas=movie.getByLabel('Test movie interaction');
  await expect.poll(async()=>{
    const bytes=await canvas.screenshot();
    return page.evaluate(async png=>{
      const bitmap=await createImageBitmap(await (await fetch('data:image/png;base64,'+png)).blob());
      const c=document.createElement('canvas');
      c.width=160; c.height=100;
      const ctx=c.getContext('2d')!;
      ctx.drawImage(bitmap,0,0,160,100); bitmap.close();
      return [[48,38],[13,24]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));
    },bytes.toString('base64'));
  }).toEqual([[255,255,255,255],[255,0,0,255]]);
  expect(f.errors).toEqual([]);
});

test('F6 preserves linked guide travel and both halves respond to later guide edits',async({page})=>{
  const f=await setup(page,'guide');
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await f.open();
  await f.d.getByLabel('Live trajectory mode').selectOption('guide');
  await f.d.getByLabel('Linked stage guide').selectOption({label:'Guide · path 1 · frame 1'});
  await apply(page);
  const linked=await f.read();
  await go(page,2);
  await page.keyboard.press('F6');
  await expect.poll(async()=>(await f.read()).layers[0].keys.map(k=>k.frame)).toEqual([0,2,8,10]);
  const split=await f.read();
  expect(split.layers[0].liveMotionSpans!.map(s=>s.guide?.interval)).toEqual([{start:0,end:0.25},{start:0.25,end:1}]);
  expect(split.layers[0].keys.filter(k=>k.frame!==2)).toEqual(linked.layers[0].keys);
  await undo(page);
  expect(await f.read()).toEqual(linked);
  await undo(page,true);
  expect(await f.read()).toEqual(split);
  for (const [frame,x,y] of [[1,22,25],[2,33,33],[4,55,47],[6,75,34]]) {
    await go(page,frame);
    await expect.poll(()=>pixel(page,f.p,x,y)).toEqual([255,0,0,255]);
  }
  await go(page,0);
  await page.getByRole('group',{name:'Layer row Guide',exact:true}).locator('button.layer-name').click();
  await page.getByRole('button',{name:'Subselection',exact:true}).click();
  const canvas=page.getByLabel('Drawing stage',{exact:true}), rect=(await canvas.boundingBox())!;
  const x=rect.x+rect.width/2-f.p.width/2+48, y=rect.y+rect.height/2-f.p.height/2+38;
  await page.mouse.click(x,y); await page.mouse.move(x,y); await page.mouse.down();
  await page.mouse.move(x,y+26,{steps:5}); await page.mouse.up();
  await expect.poll(async()=>(await f.read()).layers[1].keys[0].shapes[0].points[1].y).toBeCloseTo(52,0);
  const changed=await f.read();
  expect(changed.layers[0]).toEqual(split.layers[0]);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,4);
  await expect.poll(()=>pixel(page,f.p,54,70)).toEqual([255,0,0,255]);
  const output=await page.context().newPage();
  try{
    await output.clock.install();
    await output.clock.pauseAt(new Date(Date.now()+1000));
    await output.setContent(exportHTML(changed));
    for (const [ms,x,y] of [[1016,22,25],[1000,33,33],[2000,54,70]]) {
      await output.clock.runFor(ms);
      expect(await output.locator('canvas').first().evaluate((el:HTMLCanvasElement,[x,y])=>
        Array.from(el.getContext('2d')!.getImageData(x,y,1,1).data),[x,y])).toEqual([255,0,0,255]);
    }
  }finally{await output.close();}
});

test('timeline drags move a linked guide key and retime the follower in stage and HTML',async({page})=>{
  const f=await setup(page,'guide');
  await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  await f.open();
  await f.d.getByLabel('Live trajectory mode').selectOption('guide');
  await f.d.getByLabel('Linked stage guide').selectOption({label:'Guide · path 1 · frame 1'});
  await apply(page);
  const original=await f.read();
  const timeline=page.getByLabel('Timeline frames',{exact:true});
  async function move(row:number, from:number, to:number) {
    const b=(await timeline.boundingBox())!, x=b.x+9, y=b.y+39+28*row;
    await page.mouse.click(x+18*from,y);
    await page.mouse.move(x+18*from,y);
    await page.mouse.down();
    await page.mouse.move(x+18*to,y,{steps:5});
    await page.mouse.up();
  }
  await move(0,0,2);
  await expect.poll(async()=>(await f.read()).layers[0].liveMotionSpans![0].guide?.frame).toBe(2);
  const moved=await f.read();
  expect(moved.layers[1].keys).toEqual([{frame:0,shapes:[]},{...original.layers[1].keys[0],frame:2}]);
  await move(1,8,6);
  await expect.poll(async()=>(await f.read()).layers[0].liveMotionSpans![0].end).toBe(6);
  const timed=await f.read();
  await undo(page);
  expect(await f.read()).toEqual(moved);
  await undo(page);
  expect(await f.read()).toEqual(original);
  await undo(page,true); await undo(page,true);
  expect(await f.read()).toEqual(timed);
  await page.reload();
  await page.getByRole('button',{name:'Recover changes',exact:true}).click();
  await go(page,3);
  await expect.poll(()=>pixel(page,f.p,55,47)).toEqual([255,0,0,255]);
  const output=await page.context().newPage();
  try {
    await output.clock.install(); await output.clock.pauseAt(new Date(Date.now()+1000));
    await output.setContent(exportHTML(timed)); await output.clock.runFor(3016);
    expect(await output.locator('canvas').first().evaluate((c:HTMLCanvasElement)=>
      Array.from(c.getContext('2d')!.getImageData(55,47,1,1).data))).toEqual([255,0,0,255]);
  } finally { await output.close(); }
});

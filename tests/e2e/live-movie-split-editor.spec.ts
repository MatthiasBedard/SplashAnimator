import { livePresentationFixture } from '../live-motion-presentation-fixture';
import { test, expect, type Page } from '@playwright/test';
import { liveMovieFixture as originalMovieFixture, createLiveMovies } from '../live-movies-fixture';
import {
  captureLiveMovieMotionAuthoringFrame,
  prepareSplitLiveMovieMotionSpans,
} from '../../packages/animation/src/live-movie-motion-owner';
import type { Project } from '../../packages/document/src';
import { holdGeometry, pendingGeometry, releaseGeometry } from './held-worker';
function liveMovieFixture(mode = 'one', basis = 'plain') {
  return originalMovieFixture(mode === 'zero' ? 0 : mode === 'clamped' ? 9998 : 1, basis);
}
async function setup(page: Page, mode = 'one', basis = 'plain', special = '', custom?: Project) {
  await page.setViewportSize({ width: 1500, height: 1100 });
  const { p, span } = liveMovieFixture(mode, basis);
  p.width = 320;
  p.height = 240;
  p.fps = 1;
  p.layers[0].name = 'Main';
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.x += 60;
      shape.y += 20;
    }
  const source = custom ?? createLiveMovies(p, span);
  if (['two', 'laterBad', 'plain', 'locked', 'hidden'].includes(special)) {
    const later = structuredClone(source.layers[0]);
    later.id = 'later';
    later.name = 'Later';
    if (special === 'laterBad')
      later.liveMotionSpans![0].path = {
        startX: 0,
        startY: 80,
        endX: 0,
        endY: -40,
        distance: true,
      };
    if (special === 'plain') {
      delete later.liveMotionSpans![0].symbolContinuity;
      for (const key of later.keys)
        key.shapes = key.shapes.map((s) => ({
          id: 'plain',
          kind: 'rectangle',
          x: s.x,
          y: s.y,
          width: 8,
          height: 8,
          rotation: 0,
          fill: '#0000ff',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        }));
    }
    if (special === 'locked') later.locked = true;
    if (special === 'hidden') later.visible = false;
    source.layers.push(later);
  }
  if (special === 'multiple')
    for (const key of source.layers[0].keys)
      if (key.shapes.length) {
        const other = structuredClone(key.shapes[0]);
        other.id = 'other';
        other.y += 30;
        other.symbolPlayback!.firstFrame = 2;
        key.shapes.push(other, {
          id: 'plain',
          kind: 'rectangle',
          x: 200,
          y: 30,
          width: 8,
          height: 8,
          rotation: 0,
          fill: '#0000ff',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        });
      }
  if (special === 'inactive')
    source.layers.unshift({
      ...structuredClone(source.layers[0]),
      id: 'held',
      name: 'Held',
      liveMotionSpans: undefined,
    });
  if (special === 'merge')
    source.layers.unshift({
      ...structuredClone(source.layers[0]),
      id: 'paint',
      name: 'Paint',
      drawingMode: 'merge',
      keys: [{ frame: 0, shapes: [] }],
      liveMotionSpans: undefined,
    });
  if (special === 'curve')
    source.layers[0].liveMotionSpans![0].path = {
      startX: 0,
      startY: 80,
      endX: 0,
      endY: -40,
      distance: true,
    };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('movie-split-seed')) {
      sessionStorage.setItem('movie-split-seed', 'yes');
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
    }
  }, source);
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project);
  const open = async () => {
    const b = page.getByRole('button', { name: 'Insert live movie tween key…', exact: true });
    if (!(await b.isVisible()))
      await page.getByRole('button', { name: 'Control', exact: true }).click();
    await b.click();
    await page.getByLabel('Live movie split frame', { exact: true }).fill('7');
  };
  const insert = async () => {
    await page
      .getByRole('button', { name: 'Insert preserved live movie key', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  const undo = async (redo = false) => {
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
  };
  return { p: source, read, open, insert, undo, errors };
}
function expected(p: Project, out: Project, ids = ['track'], at = 6) {
  const capture = captureLiveMovieMotionAuthoringFrame(() => ({
    project: p,
    revision: 0,
    frame: at,
  }));
  try {
    return prepareSplitLiveMovieMotionSpans(
      ids.map((layerId) => ({
        owner: capture.resolve(layerId, 'instance'),
        rightSpanId: out.layers
          .find((l) => l.id === layerId)!
          .liveMotionSpans!.find((s) => s.start === at)!.id,
      })),
    );
  } finally {
    capture.dispose();
  }
}
async function stagePixel(page: Page, p: Project, x: number, y: number) {
  return page.getByLabel('Drawing stage', { exact: true }).evaluate(
    (el, { p, x, y }) => {
      const c = el as HTMLCanvasElement;
      return Array.from(
        c
          .getContext('2d')!
          .getImageData(
            Math.floor(c.width / 2 + (x - p.width / 2) * devicePixelRatio),
            Math.floor(c.height / 2 + (y - p.height / 2) * devicePixelRatio),
            1,
            1,
          ).data,
      );
    },
    { p, x, y },
  );
}
async function previewPixel(page: Page, x: number, y: number) {
  return page
    .getByRole('img', { name: 'Preserved live movie split preview', exact: true })
    .evaluate(
      async (el, { x, y }) => {
        const image = el as HTMLImageElement;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = image.naturalWidth;
        c.height = image.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return Array.from(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data);
      },
      { x, y },
    );
}
async function go(page: Page, count: number) {
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  for (let i = 0; i < Math.abs(count); i++)
    await page.keyboard.press(count >= 0 ? 'ArrowRight' : 'ArrowLeft');
}
for (const mode of ['zero', 'one', 'clamped'])
  for (const basis of ['plain', 'affine', 'reflected'])
    test(`movie ${mode}/${basis} insertion and detached preview preserve native clocks and world pixels`, async ({
      page,
    }) => {
      const f = await setup(page, mode, basis);
      await go(page, 6);
      const clock = mode === 'zero' ? 0 : mode === 'clamped' ? 4 : 1,
        b = basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
        u = b[0] * (clock * 10 + 2) + b[2] * 2,
        v = b[1] * (clock * 10 + 2) + b[3] * 2,
        x = 120 + (u - v) / Math.SQRT2,
        y = 70 + (u + v) / Math.SQRT2,
        previewClock = (clock + 4) % 5,
        pu = b[0] * (previewClock * 10 + 2) + b[2] * 2,
        pv = b[1] * (previewClock * 10 + 2) + b[3] * 2,
        px = 120 + (pu - pv) / Math.SQRT2,
        py = 70 + (pu + pv) / Math.SQRT2;
      await expect.poll(() => stagePixel(page, f.p, x, y)).toEqual([255, 0, 0, 255]);
      await f.open();
      await page
        .getByRole('button', { name: 'Preview preserved live movie key', exact: true })
        .click();
      await expect(
        page.getByRole('img', { name: 'Preserved live movie split preview', exact: true }),
      ).toBeVisible();
      await expect.poll(() => previewPixel(page, px, py)).toEqual([255, 0, 0, 255]);
      expect(await f.read()).toEqual(f.p);
      await f.insert();
      const out = await f.read();
      expect(out).toEqual(expected(f.p, out));
      expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 6, 10, 12]);
      await page.getByLabel('Drawing stage', { exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect.poll(() => stagePixel(page, f.p, x, y)).toEqual([255, 0, 0, 255]);
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      await f.undo(true);
      expect(await f.read()).toEqual(out);
      await page.reload();
      await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
      expect(await f.read()).toEqual(out);
      expect(f.errors).toEqual([]);
    });
for (const special of ['multiple', 'two', 'inactive'])
  test(`movie ${special} insertion preserves complete selection and one transaction`, async ({
    page,
  }) => {
    const f = await setup(page, 'loop', 'plain', special);
    await f.open();
    if (special === 'two') await page.getByLabel('Split live movie track Later').check();
    await f.insert();
    const out = await f.read();
    expect(out).toEqual(expected(f.p, out, special === 'two' ? ['track', 'later'] : ['track']));
    if (special === 'two')
      expect(new Set(out.layers.map((l) => l.liveMotionSpans![1].id)).size).toBe(2);
    if (special === 'multiple')
      await expect(page.getByText('3 objects', { exact: true })).toBeVisible();
    await f.undo();
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });
test('movie preview and failed-track retry retain stable distinct original right IDs', async ({
  page,
}) => {
  const f = await setup(page, 'loop', 'plain', 'laterBad');
  await f.open();
  await page.getByLabel('Split live movie track Later').check();
  await page.evaluate(() => {
    const clone = structuredClone,
      state = { ids: [] as string[] };
    Object.assign(window, { movieSplitIDs: state });
    window.structuredClone = <T>(v: T) => {
      const out = clone(v),
        q = v as { id?: string; liveMotionSpans?: { id: string }[] };
      if (q.id === 'track' && q.liveMotionSpans?.length === 2)
        state.ids.push(q.liveMotionSpans[1].id);
      return out;
    };
  });
  await page.getByRole('button', { name: 'Insert preserved live movie key', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await page.getByLabel('Split live movie track Later').uncheck();
  await page.getByRole('button', { name: 'Preview preserved live movie key', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Preserved live movie split preview', exact: true }),
  ).toBeVisible();
  expect(await f.read()).toEqual(f.p);
  await f.insert();
  const out = await f.read(),
    ids = await page.evaluate(
      () => (window as unknown as { movieSplitIDs: { ids: string[] } }).movieSplitIDs.ids,
    );
  expect(ids.length).toBeGreaterThanOrEqual(3);
  expect(new Set(ids).size).toBe(1);
  expect(out.layers[0].liveMotionSpans![1].id).toBe(ids[0]);
  expect(out.layers[1]).toEqual(f.p.layers[1]);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
for (const special of ['plain', 'locked', 'hidden'])
  test(`forged ${special} track cannot broaden movie insertion`, async ({ page }) => {
    const f = await setup(page, 'loop', 'plain', special);
    await f.open();
    const row = page.getByLabel('Split live movie track Later');
    await expect(row).toBeDisabled();
    await row.evaluate((el) => {
      const e = el as HTMLInputElement;
      e.disabled = false;
      e.click();
    });
    await page
      .getByRole('button', { name: 'Insert preserved live movie key', exact: true })
      .evaluate((el) => {
        const e = el as HTMLButtonElement;
        e.disabled = false;
        e.click();
      });
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('Error:');
    expect(await f.read()).toEqual(f.p);
    await row.uncheck();
    await f.insert();
    await f.undo();
    expect(await f.read()).toEqual(f.p);
  });
for (const value of ['', '0', '3', '4', '10', '1.5'])
  test(`invalid movie target ${JSON.stringify(value)} cannot publish`, async ({ page }) => {
    const f = await setup(page);
    await f.open();
    await page.getByLabel('Live movie split frame').fill(value);
    await expect(
      page.getByRole('button', { name: 'Insert preserved live movie key', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Insert preserved live movie key', exact: true })
      .evaluate((el) => {
        const e = el as HTMLButtonElement;
        e.disabled = false;
        e.click();
      });
    expect(await f.read()).toEqual(f.p);
    await page.getByLabel('Live movie split frame').fill('7');
    await f.insert();
    await f.undo();
    expect(await f.read()).toEqual(f.p);
  });
for (const hook of ['clone', 'serialize'])
  for (const action of ['target', 'tracks', 'source', 'frame', 'tool', 'close'])
    test(`movie ${hook} rejects actual late ${action} after complete candidates exist`, async ({
      page,
    }) => {
      const f = await setup(page);
      await f.open();
      await page.evaluate(
        ({ hook, action }) => {
          const state = { hit: false };
          Object.assign(window, { movieSplitHook: state });
          const fire = (value: unknown) => {
            const p = value as Project;
            if (state.hit || p?.layers?.[0]?.liveMotionSpans?.length !== 2) return;
            state.hit = true;
            if (action === 'target') {
              const e = document.querySelector(
                '[aria-label="Live movie split frame"]',
              ) as HTMLInputElement;
              for (const value of ['8', '7']) {
                e.value = value;
                e.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
            if (action === 'tracks') {
              const e = document.querySelector(
                '[aria-label="Split live movie track Main"]',
              ) as HTMLInputElement;
              e.click();
              e.click();
            }
            if (action === 'source') {
              const e = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
              e.value = '#000000';
              e.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (action === 'frame')
              for (const title of ['Last frame', 'First frame'])
                (document.querySelector(`button[title="${title}"]`) as HTMLButtonElement).click();
            if (action === 'tool')
              for (const label of ['Brush', 'Selection'])
                (document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
            if (action === 'close')
              (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
          };
          if (hook === 'clone') {
            const clone = structuredClone;
            window.structuredClone = <T>(v: T) => {
              const out = clone(v);
              fire(v);
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
      await page
        .getByRole('button', { name: 'Insert preserved live movie key', exact: true })
        .click();
      expect(
        await page.evaluate(
          () => (window as unknown as { movieSplitHook: { hit: boolean } }).movieSplitHook.hit,
        ),
      ).toBe(true);
      const expected = structuredClone(f.p);
      if (action === 'source') expected.background = '#000000';
      expect(await f.read()).toEqual(expected);
      if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
      if (action === 'source') {
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      }
      await f.open();
      await f.insert();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
      expect(f.errors).toEqual([]);
    });
for (const action of ['target', 'tracks', 'source', 'candidate', 'reentry', 'close'])
  test(`movie final recovery ${action} protects one complete history transaction`, async ({
    page,
  }) => {
    const f = await setup(page);
    await f.open();
    await page.evaluate((action) => {
      const stringify = JSON.stringify,
        state = { hit: false };
      Object.assign(window, { movieSplitFinal: state });
      JSON.stringify = ((...args: Parameters<typeof stringify>) => {
        const text = stringify(...args),
          v = args[0] as { project?: Project; folder?: unknown };
        if (
          !state.hit &&
          Object.hasOwn(v ?? {}, 'folder') &&
          v?.project?.layers?.[0]?.liveMotionSpans?.length === 2
        ) {
          state.hit = true;
          if (action === 'candidate') v.project.layers[0].keys[2].shapes[0].x++;
          if (action === 'source') {
            const e = document.querySelector('[aria-label="Stage color"]') as HTMLInputElement;
            e.value = '#000000';
            e.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (action === 'target') {
            const e = document.querySelector(
              '[aria-label="Live movie split frame"]',
            ) as HTMLInputElement;
            for (const value of ['8', '7']) {
              e.value = value;
              e.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          if (action === 'tracks') {
            const e = document.querySelector(
              '[aria-label="Split live movie track Main"]',
            ) as HTMLInputElement;
            e.click();
            e.click();
          }
          if (action === 'close')
            (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
          if (action === 'reentry')
            Array.from(document.querySelectorAll('button'))
              .find((e) => e.textContent === 'Insert preserved live movie key')!
              .click();
        }
        return text;
      }) as typeof stringify;
    }, action);
    await page
      .getByRole('button', { name: 'Insert preserved live movie key', exact: true })
      .click();
    expect(
      await page.evaluate(
        () => (window as unknown as { movieSplitFinal: { hit: boolean } }).movieSplitFinal.hit,
      ),
    ).toBe(true);
    if (action === 'reentry') {
      const out = await f.read();
      expect(out).toEqual(expected(f.p, out));
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    } else {
      const wanted = structuredClone(f.p);
      if (action === 'source') wanted.background = '#000000';
      expect(await f.read()).toEqual(wanted);
      if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
      if (action === 'source') {
        await f.undo();
        expect(await f.read()).toEqual(f.p);
      }
      await f.open();
      await f.insert();
      await f.undo();
      expect(await f.read()).toEqual(f.p);
    }
    expect(f.errors).toEqual([]);
  });
test('stale movie preview output revokes URLs and valid preview/close remain history-free', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await page.evaluate(() => {
    const create = URL.createObjectURL,
      revoke = URL.revokeObjectURL,
      state = { hit: false, url: '', revoked: [] as string[] };
    Object.assign(window, { movieSplitURLs: state });
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (!state.hit) {
        state.hit = true;
        state.url = url;
        const e = document.querySelector(
          '[aria-label="Live movie split frame"]',
        ) as HTMLInputElement;
        for (const value of ['8', '7']) {
          e.value = value;
          e.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      return url;
    };
    URL.revokeObjectURL = (url) => {
      state.revoked.push(url);
      revoke(url);
    };
  });
  await page.getByRole('button', { name: 'Preview preserved live movie key', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (
          window as unknown as {
            movieSplitURLs: { hit: boolean; url: string; revoked: string[] };
          }
        ).movieSplitURLs;
        return s.hit && s.revoked.includes(s.url);
      }),
    )
    .toBe(true);
  await expect(
    page.getByRole('img', { name: 'Preserved live movie split preview', exact: true }),
  ).toHaveCount(0);
  expect(await f.read()).toEqual(f.p);
  await page.getByRole('button', { name: 'Preview preserved live movie key', exact: true }).click();
  const img = page.getByRole('img', { name: 'Preserved live movie split preview', exact: true });
  await expect(img).toBeVisible();
  const url = await img.getAttribute('src');
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(
      (url) =>
        (
          window as unknown as { movieSplitURLs: { revoked: string[] } }
        ).movieSplitURLs.revoked.includes(url!),
      url,
    ),
  ).toBe(true);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});
test('pending Brush keeps movie insertion unavailable and paint history separate', async ({
  page,
}) => {
  await holdGeometry(page);
  const f = await setup(page, 'loop', 'plain', 'merge');
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const box = (await page.getByLabel('Drawing stage').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => pendingGeometry(page)).toBe(1);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Insert live movie tween key…', exact: true }),
  ).toBeDisabled();
  expect(await f.read()).toEqual(f.p);
  await releaseGeometry(page);
  await expect(
    page.getByRole('button', { name: 'Insert live movie tween key…', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
  await f.open();
  await f.insert();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});

test('remembered-child movie preview preserves original origins and script-free library/history', async ({
  page,
}) => {
  const ref = livePresentationFixture('movie'),
    { p, span } = liveMovieFixture();
  p.width = 320;
  p.height = 240;
  p.fps = 1;
  p.layers[0].name = 'Main';
  p.symbols = ref.symbols;
  p.frameScripts = ref.frameScripts;
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.symbolId = 'child';
      shape.width = 160;
      shape.height = 20;
      shape.x = key.frame === 2 ? 20 : 100;
      shape.y = 40;
      shape.rotation = 0;
    }
  const source = createLiveMovies(p, span),
    f = await setup(page, 'loop', 'plain', '', source);
  await f.open();
  await page.getByLabel('Live movie split frame').fill('5');
  await page.getByRole('button', { name: 'Preview preserved live movie key', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Preserved live movie split preview', exact: true }),
  ).toBeVisible();
  await expect.poll(() => previewPixel(page, 105, 45)).toEqual([0, 0, 255, 255]);
  await page.getByLabel('Movie split remembered children').check();
  await page.getByRole('button', { name: 'Preview preserved live movie key', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Preserved live movie split preview', exact: true }),
  ).toBeVisible();
  await expect.poll(() => previewPixel(page, 135, 45)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => previewPixel(page, 105, 45)).toEqual([255, 255, 255, 255]);
  expect(await f.read()).toEqual(source);
  await f.insert();
  const out = await f.read();
  expect(out).toEqual(expected(source, out, ['track'], 4));
  expect(out.symbols).toEqual(source.symbols);
  expect(out.frameScripts).toEqual(source.frameScripts);
  await expect.poll(() => stagePixel(page, source, 65, 45)).toEqual([0, 0, 255, 255]);
  await f.undo();
  expect(await f.read()).toEqual(source);
  expect(f.errors).toEqual([]);
});
test('reopened movie insertion supports a further preserved split', async ({ page }) => {
  const f = await setup(page);
  await f.open();
  await f.insert();
  const first = await f.read();
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await f.open();
  await page.getByLabel('Live movie split frame').fill('5');
  await f.insert();
  const out = await f.read();
  expect(out).toEqual(expected(first, out, ['track'], 4));
  expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 4, 6, 10, 12]);
  await f.undo();
  expect(await f.read()).toEqual(first);
});
test('unsupported movie restriction retains geometry-free removal and Undo recovery', async ({
  page,
}) => {
  const f = await setup(page, 'loop', 'plain', 'curve');
  await f.open();
  await page.getByRole('button', { name: 'Insert preserved live movie key', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Remove live tween…', exact: true }).click();
  await page.getByRole('button', { name: 'Remove live tween', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await f.read()).layers[0].keys).toEqual(f.p.layers[0].keys);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
test('cloned movie track accessor rejects with zero reads and permits a fresh Insert', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await page.evaluate(() => {
    const clone = structuredClone,
      state = { hit: false, reads: 0 };
    Object.assign(window, { movieRawTracks: state });
    window.structuredClone = <T>(v: T) => {
      const out = clone(v),
        q = out as { target?: number; ids?: string[] };
      if (!state.hit && q.target === 6 && Array.isArray(q.ids)) {
        state.hit = true;
        Object.defineProperty(q, 'ids', {
          enumerable: true,
          get() {
            state.reads++;
            return ['track'];
          },
        });
      }
      return out;
    };
  });
  await page.getByRole('button', { name: 'Insert preserved live movie key', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { movieRawTracks: { hit: boolean; reads: number } }).movieRawTracks,
    ),
  ).toEqual({ hit: true, reads: 0 });
  expect(await f.read()).toEqual(f.p);
  await f.insert();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});
for (const hook of ['clone', 'serialize'])
  test(`movie ${hook} restored sampled mode cannot publish`, async ({ page }) => {
    const f = await setup(page);
    await f.open();
    await page
      .getByRole('button', { name: 'Control', exact: true })
      .evaluate((e: HTMLButtonElement) => e.click());
    await expect(
      page.getByRole('button', { name: 'Show sampled motion on stage', exact: true }),
    ).toBeAttached();
    await page.evaluate((hook) => {
      const state = { hit: false, changes: 0 };
      Object.assign(window, { movieModeHook: state });
      const fire = (value: unknown) => {
        if (state.hit || (value as Project)?.layers?.[0]?.liveMotionSpans?.length !== 2) return;
        state.hit = true;
        for (let i = 0; i < 2; i++) {
          const e = Array.from(document.querySelectorAll('button')).find(
            (e) =>
              e.textContent === 'Show sampled motion on stage' ||
              e.textContent === 'Return to authored stage',
          );
          if (!e) throw Error('Missing sampled mode control');
          e.click();
          state.changes++;
        }
      };
      if (hook === 'clone') {
        const clone = structuredClone;
        window.structuredClone = <T>(v: T) => {
          const out = clone(v);
          fire(v);
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
    }, hook);
    await page
      .getByRole('button', { name: 'Insert preserved live movie key', exact: true })
      .click();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { movieModeHook: { hit: boolean; changes: number } }).movieModeHook,
      ),
    ).toEqual({ hit: true, changes: 2 });
    expect(await f.read()).toEqual(f.p);
    if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
    await f.open();
    await f.insert();
    await f.undo();
    expect(await f.read()).toEqual(f.p);
  });

test('actual original selection changes reject a complete movie candidate without writing history', async ({
  page,
}) => {
  const { p, span } = liveMovieFixture();
  p.width = 320;
  p.height = 240;
  p.fps = 1;
  p.layers[0].name = 'Main';
  for (const key of p.layers[0].keys)
    if (key.shapes.length)
      for (const [id, x] of [
        ['blue-a', 200],
        ['blue-b', 220],
      ] as const)
        key.shapes.push({
          id,
          kind: 'rectangle',
          x,
          y: 30,
          width: 8,
          height: 8,
          rotation: 0,
          fill: '#0000ff',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        });
  const source = createLiveMovies(p, span),
    f = await setup(page, 'loop', 'plain', '', source);
  await go(page, 2);
  const box = (await page.getByLabel('Drawing stage', { exact: true }).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 204 - 160, box.y + box.height / 2 + 34 - 120);
  await expect(page.locator('.inspector-title strong')).toHaveText('rectangle');
  await f.open();
  await page
    .getByRole('button', { name: 'Edit', exact: true })
    .evaluate((e: HTMLButtonElement) => e.click());
  await expect(
    page.getByRole('button', { name: 'Select matching fill paint', exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    const clone = structuredClone,
      state = { hit: false };
    Object.assign(window, { movieSelectionChange: state });
    window.structuredClone = <T>(v: T) => {
      const out = clone(v),
        q = v as Project;
      if (!state.hit && q?.layers?.[0]?.liveMotionSpans?.length === 2) {
        state.hit = true;
        Array.from(document.querySelectorAll('button'))
          .find((e) => e.textContent === 'Select matching fill paint')!
          .click();
      }
      return out;
    };
  });
  await page.getByRole('button', { name: 'Insert preserved live movie key', exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { movieSelectionChange: { hit: boolean } }).movieSelectionChange.hit,
    ),
  ).toBe(true);
  await expect(page.locator('.inspector-title strong')).toHaveText('2 objects');
  expect(await f.read()).toEqual(source);
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  await f.open();
  await f.insert();
  await expect(page.locator('.inspector-title strong')).toHaveText('3 objects');
  await f.undo();
  expect(await f.read()).toEqual(source);
  expect(f.errors).toEqual([]);
});
test('legacy root and group insertion cannot authorize movies while the explicit command can', async ({
  page,
}) => {
  const f = await setup(page);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Insert live graphic tween key…', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Insert live group tween key…', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Insert live tween key…', exact: true }).click();
  await page.getByLabel('Live split frame', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Insert preserved live key', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Error:');
  expect(await f.read()).toEqual(f.p);
  await page.keyboard.press('Escape');
  await f.open();
  await f.insert();
  await f.undo();
  expect(await f.read()).toEqual(f.p);
});

test('inserted movie key is editable and both live halves immediately use its new position', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await f.insert();
  const inserted = await f.read();
  await page.getByLabel('Drawing stage', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  const edited = await f.read(),
    want = structuredClone(inserted);
  want.layers[0].keys.find((k) => k.frame === 6)!.shapes[0].x++;
  expect(edited).toEqual(want);
  await page.keyboard.press('Escape');
  const x = 121 + 10 / Math.SQRT2,
    y = 70 + 14 / Math.SQRT2;
  await expect.poll(() => stagePixel(page, f.p, x, y)).toEqual([255, 0, 0, 255]);
  await f.undo();
  expect(await f.read()).toEqual(inserted);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
  await f.undo(true);
  await f.undo(true);
  expect(await f.read()).toEqual(edited);
  await go(page, -1);
  const leftAngle = (3 * Math.PI) / 16;
  await expect
    .poll(() =>
      stagePixel(
        page,
        f.p,
        110.75 + Math.cos(leftAngle) * 12 - Math.sin(leftAngle) * 2,
        65 + Math.sin(leftAngle) * 12 + Math.cos(leftAngle) * 2,
      ),
    )
    .toEqual([255, 0, 0, 255]);
  await go(page, 2);
  const angle = (5 * Math.PI) / 16,
    clock = 1,
    u = clock * 10 + 2,
    v = 2;
  await expect
    .poll(() =>
      stagePixel(
        page,
        f.p,
        130.75 + Math.cos(angle) * u - Math.sin(angle) * v,
        75 + Math.sin(angle) * u + Math.cos(angle) * v,
      ),
    )
    .toEqual([255, 0, 0, 255]);
  expect(f.errors).toEqual([]);
});

test('native Test Movie crosses an inserted key without restarting its movie clock', async ({
  page,
}) => {
  const f = await setup(page);
  await f.open();
  await f.insert();
  const out = await f.read();
  await go(page, -4);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByRole('button', { name: 'Test movie', exact: false })
    .filter({ hasText: 'Ctrl Enter' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Test live movie', exact: true });
  await expect(dialog.getByLabel('Live movie status')).toContainText('Live movie ready');
  await dialog.getByRole('button', { name: 'Pause preview clocks', exact: true }).click();
  await dialog.getByRole('button', { name: 'Restart live movie', exact: true }).click();
  for (let tick = 1; tick <= 5; tick++) {
    if (tick === 5)
      await dialog.getByRole('button', { name: 'Pause live root', exact: true }).click();
    await dialog.getByRole('button', { name: 'Step live preview', exact: true }).click();
    await expect(dialog.getByLabel('Live movie position')).toContainText('Tick ' + tick);
    await expect(dialog.getByLabel('Live movie status')).toContainText('Live movie ready');
    const frame = tick === 5 ? 6 : 2 + tick,
      t = (frame - 2) / 8,
      r = (t * Math.PI) / 2,
      phase = (1 + tick) % 5,
      x = 80 + 80 * t + Math.cos(r) * (phase * 10 + 2) - Math.sin(r) * 2,
      y = 50 + 40 * t + Math.sin(r) * (phase * 10 + 2) + Math.cos(r) * 2;
    expect(
      await page
        .getByLabel('Live movie interaction', { exact: true })
        .evaluate(
          (e, { x, y }) =>
            Array.from(
              (e as HTMLCanvasElement)
                .getContext('2d')!
                .getImageData(Math.floor(x), Math.floor(y), 1, 1).data,
            ),
          { x, y },
        ),
    ).toEqual([255, 0, 0, 255]);
  }
  await expect(dialog.getByLabel('Live movie position')).toContainText('Frame 7');
  await page.keyboard.press('Escape');
  expect(await f.read()).toEqual(out);
  await f.undo();
  expect(await f.read()).toEqual(f.p);
  await f.undo(true);
  expect(await f.read()).toEqual(out);
  expect(f.errors).toEqual([]);
});

import { openExportSettings } from './export-settings';
import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { livePresentationFixture } from '../live-motion-presentation-fixture';
import type { Project } from '../../packages/document/src';
import { readFile } from 'node:fs/promises';
type API = typeof import('../live-png-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-png-fixture.ts',
        formats: ['iife'],
        name: 'LivePNG',
        fileName: () => 'png.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one live PNG fixture');
  code = chunks[0].code;
});
for (const mode of ['graphic', 'movie', 'button'])
  test(`live PNG actual ${mode} pixels and bytes retain root pose and exact stored child replay`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (mode) => {
      const api = (window as unknown as { LivePNG: API }).LivePNG,
        p = api.livePresentationFixture(mode),
        before = JSON.stringify(p),
        rows = [];
      if (mode === 'button') {
        const b = p.symbols![1],
          shape = p.symbols![0].shapes[0];
        b.timeline = {
          duration: 3,
          keys: [
            { frame: 1, shapes: [{ ...shape, fill: '#00ff00' }] },
            { frame: 2, shapes: [{ ...shape, fill: '#ffff00' }] },
          ],
        };
        b.buttonStates = { up: 0, over: 1, down: 2, hit: 0 };
      }
      const source = JSON.stringify(p);
      for (const frame of [0, 1, 2, 3, 4, 7, 8]) {
        const blob = await api.exportPNGFrame(p, frame),
          reference = await api.prepareLiveMotionFrameCapture(
            () => ({ project: p, revision: 0 }),
            frame,
          ),
          expected = await api.exportPNGFrame(reference, frame);
        const actualBytes = new Uint8Array(await blob.arrayBuffer()),
          expectedBytes = new Uint8Array(await expected.arrayBuffer());
        const image = await createImageBitmap(blob),
          c = document.createElement('canvas');
        c.width = 160;
        c.height = 80;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        image.close();
        const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
        const redX = frame >= 4 ? 80 : frame * 20,
          blueX =
            mode === 'graphic'
              ? ({ 0: 0, 1: 0, 2: 20, 3: 40, 4: 60, 7: 20, 8: 40 } as Record<number, number>)[frame]
              : ({ 0: 0, 1: 40, 2: 60, 3: 120, 4: 0, 7: 60, 8: 120 } as Record<number, number>)[
                  frame
                ];
        rows.push({
          frame,
          red: at(redX + 5, 5),
          blue: at(blueX + 5, 45),
          same:
            actualBytes.length === expectedBytes.length &&
            actualBytes.every((v, i) => v === expectedBytes[i]),
        });
      }
      return {
        rows,
        unchanged: JSON.stringify(p) === source,
        original: before.length > 0,
        hosts: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
      };
    }, mode);
    expect(result.unchanged).toBe(true);
    expect(result.hosts).toBe(0);
    for (const row of result.rows) {
      expect(row.same).toBe(true);
      expect(row.red).toEqual(row.frame === 8 ? [255, 255, 255, 255] : [255, 0, 0, 255]);
      expect(row.blue).toEqual(row.frame === 0 ? [255, 255, 255, 255] : [0, 0, 255, 255]);
    }
  });

for (const scale of [0.5, 1, 2, 4])
  test(`live PNG transparent ${scale}x output retains geometry and native dimensions`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (scale) => {
      const api = (window as unknown as { LivePNG: API }).LivePNG,
        p = api.livePresentationFixture(),
        before = JSON.stringify(p),
        blob = await api.exportPNGFrame(p, 2, undefined, true, scale),
        image = await createImageBitmap(blob),
        c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      image.close();
      return {
        size: [c.width, c.height],
        red: Array.from(ctx.getImageData(Math.round(45 * scale), Math.round(5 * scale), 1, 1).data),
        blank: Array.from(
          ctx.getImageData(Math.round(140 * scale), Math.round(10 * scale), 1, 1).data,
        ),
        unchanged: JSON.stringify(p) === before,
      };
    }, scale);
    expect(result).toEqual({
      size: [160 * scale, 80 * scale],
      red: [255, 0, 0, 255],
      blank: [0, 0, 0, 0],
      unchanged: true,
    });
  });

for (const change of ['source', 'abort', 'restored'])
  test(`live PNG rejects ${change} after complete native encoding and cleans the iframe`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (change) => {
      const api = (window as unknown as { LivePNG: API }).LivePNG,
        p = api.liveSplitFixture(),
        ctrl = new AbortController();
      let hit = false,
        revision = 0;
      const observer = new MutationObserver((records) => {
        for (const r of records)
          for (const node of r.addedNodes)
            if (node instanceof HTMLIFrameElement && node.title === 'PNG frame renderer')
              node.addEventListener('load', () => {
                const child = node.contentWindow as unknown as {
                    HTMLCanvasElement: typeof HTMLCanvasElement;
                  },
                  proto = child.HTMLCanvasElement.prototype,
                  native = proto.toBlob;
                proto.toBlob = function (callback, type, quality) {
                  native.call(
                    this,
                    (blob) => {
                      hit = true;
                      if (change === 'source') p.layers[0].keys[0].shapes[0].fill = '#00ff00';
                      else if (change === 'abort') ctrl.abort();
                      else revision += 2;
                      callback(blob);
                    },
                    type,
                    quality,
                  );
                };
              });
      });
      observer.observe(document.body, { childList: true });
      let rejected = false;
      try {
        await api.exportPNGFrame(p, 2, ctrl.signal, false, 1, () => {
          if (revision) throw Error('Restored frame revision changed');
        });
      } catch {
        rejected = true;
      } finally {
        observer.disconnect();
      }
      return {
        hit,
        rejected,
        hosts: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
      };
    }, change);
    expect(result).toEqual({ hit: true, rejected: true, hosts: 0 });
  });

async function editor(page: Page) {
  const p = livePresentationFixture('movie');
  p.fps = 1;
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
  const timeline = page.getByLabel('Timeline frames', { exact: true });
  await timeline.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  return {
    p,
    errors,
    read: () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project as Project,
      ),
  };
}
test('main PNG action downloads actual live root and independently replayed movie pixels without edits', async ({
  page,
}) => {
  const f = await editor(page),
    download = page.waitForEvent('download');
  await openExportSettings(page);
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const c = document.createElement('canvas');
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return [
      [45, 5],
      [65, 45],
    ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
  }, bytes.toString('base64'));
  expect(pixels).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
  await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
});

for (const change of ['cancel', 'restored-frame'])
  test(`main live PNG rejects ${change} at complete Blob URL publication and revokes it`, async ({
    page,
  }) => {
    const f = await editor(page);
    await page.getByTitle('First frame', { exact: true }).click();
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.evaluate((change) => {
      const create = URL.createObjectURL,
        revoke = URL.revokeObjectURL;
      let made = 0,
        removed = 0;
      const urls = new Set<string>();
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        urls.add(url);
        made++;
        if (change === 'cancel')
          (
            [...document.querySelectorAll('button')].find(
              (b) => b.textContent === 'Cancel PNG export',
            ) as HTMLButtonElement
          ).click();
        else
          for (const title of ['Last frame', 'First frame'])
            (document.querySelector(`button[title="${title}"]`) as HTMLButtonElement).click();
        return url;
      };
      URL.revokeObjectURL = (url) => {
        if (urls.delete(url)) removed++;
        revoke(url);
      };
      (window as unknown as { pngURLs: () => unknown }).pngURLs = () => ({
        made,
        removed,
        live: urls.size,
      });
    }, change);
    await openExportSettings(page);
    await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
    if (change === 'cancel')
      await expect(page.getByText('PNG export cancelled', { exact: true })).toBeVisible();
    else
      await expect(page.getByRole('alert')).toContainText(
        'Live PNG source, frame or options changed',
      );
    await expect(page.getByRole('button', { name: 'Cancel PNG export', exact: true })).toHaveCount(
      0,
    );
    expect(downloads).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { pngURLs: () => unknown }).pngURLs()),
    ).toEqual({ made: 1, removed: 1, live: 0 });
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
    await expect(page.locator('iframe[title="PNG frame renderer"]')).toHaveCount(0);
  });

for (const change of ['snapshot', 'restored-options'])
  test(`main live PNG rejects ${change} during original capture and permits fresh export`, async ({
    page,
  }) => {
    const f = await editor(page);
    let downloads = 0;
    page.on('download', () => downloads++);
    await openExportSettings(page);
    await page.evaluate((change) => {
      const clone = structuredClone;
      let hit = false;
      (window as unknown as { pngCloneHit: () => boolean }).pngCloneHit = () => hit;
      window.structuredClone = <T>(value: T) => {
        const out = clone(value),
          p = out as unknown as Project;
        if (!hit && p?.layers?.some((l) => l.liveMotionSpans?.length)) {
          hit = true;
          if (change === 'snapshot')
            p.layers.find((l) => l.liveMotionSpans?.length)!.keys[0].shapes[0].x++;
          else {
            const field = document.querySelector(
              'select[aria-label="PNG export scale"]',
            ) as HTMLSelectElement;
            for (const v of ['2', '1']) {
              field.value = v;
              field.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
        return out;
      };
    }, change);
    await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      change === 'snapshot' ? 'snapshot changed' : 'source, frame or options changed',
    );
    expect(
      await page.evaluate(() =>
        (window as unknown as { pngCloneHit: () => boolean }).pngCloneHit(),
      ),
    ).toBe(true);
    expect(downloads).toBe(0);
    await openExportSettings(page);
    const next = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
    await next;
    expect(await f.read()).toEqual(f.p);
    expect(f.errors).toEqual([]);
  });

test('live PNG sequence and single-frame actions remain available together', async ({
  page,
}) => {
  const f = await editor(page);
  await openExportSettings(page);
  const archive = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG sequence ZIP…', exact: true }).click();
  expect((await archive).suggestedFilename()).toMatch(/-frames\.zip$/);
  await openExportSettings(page);
  const next = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current frame PNG…', exact: true }).click();
  await next;
  expect(await f.read()).toEqual(f.p);
  expect(f.errors).toEqual([]);
});

for (const mode of ['bitmap', 'text', 'affine', 'reflected'])
  test(`live PNG ${mode} native artwork retains admitted appearance and source`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (mode) => {
      const api = (window as unknown as { LivePNG: API }).LivePNG,
        p = api.livePresentationFixture();
      if (mode === 'bitmap') {
        const tile = document.createElement('canvas');
        tile.width = tile.height = 2;
        const ctx = tile.getContext('2d')!;
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(0, 0, 2, 2);
        p.assets = [
          {
            id: 'green',
            path: 'assets/bitmaps/green.json',
            bitmap: { name: 'Green', width: 2, height: 2, dataUrl: tile.toDataURL() },
          },
        ];
      }
      for (const key of p.layers[0].keys)
        for (const s of key.shapes) {
          if (mode === 'bitmap') s.bitmap = { assetId: 'green', x: 0, y: 0, width: 20, height: 20 };
          else if (mode === 'text') {
            s.kind = 'text';
            s.text = {
              content: 'A',
              font: 'sans-serif',
              size: 18,
              bold: false,
              italic: false,
              align: 'left',
            };
          } else {
            s.kind = 'polygon';
            s.fillRule = 'evenodd';
            s.transform = [mode === 'reflected' ? -1 : 1, 0.1, 0.2, 1];
            s.contours = [
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
            ];
            p.layers[0].liveMotionSpans![0].options = { affine: true, nodes: true };
          }
        }
      const before = JSON.stringify(p),
        blob = await api.exportPNGFrame(p, 2),
        image = await createImageBitmap(blob),
        c = document.createElement('canvas');
      c.width = 160;
      c.height = 80;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      image.close();
      const data = ctx.getImageData(40, 0, 20, 20).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] > data[i + 1] && data[i + 1] < 240) ink++;
      const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data),
        sign = mode === 'reflected' ? -1 : 1;
      return {
        ink,
        root: at(mode === 'bitmap' ? 45 : 40 + sign * 2 + 1, mode === 'bitmap' ? 5 : 2),
        hole: at(40 + sign * 10 + 2, 11),
        unchanged: before === JSON.stringify(p),
      };
    }, mode);
    expect(result.unchanged).toBe(true);
    if (mode === 'text') expect(result.ink).toBeGreaterThan(5);
    else {
      expect(result.root).toEqual(mode === 'bitmap' ? [0, 255, 0, 255] : [255, 0, 0, 255]);
      if (mode !== 'bitmap') expect(result.hole).toEqual([255, 255, 255, 255]);
    }
  });

for (const change of ['source', 'abort', 'timeout'])
  test(`held native PNG font readiness ${change} rejects, removes the iframe and permits fresh capture`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    if (change === 'timeout') await page.clock.install();
    await page.evaluate((change) => {
      const api = (window as unknown as { LivePNG: API }).LivePNG,
        p = api.liveSplitFixture(),
        ctrl = new AbortController();
      const w = window as unknown as {
        pngHeld: boolean;
        pngRelease?: () => void;
        pngJob: Promise<boolean>;
        pngChange: () => void;
        pngRecover: () => Promise<number[]>;
      };
      w.pngHeld = false;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc')!;
      Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
        ...descriptor,
        set(value: string) {
          if (this.title === 'PNG frame renderer')
            value = value.replace(
              'Promise.all([ready,document.fonts.ready])',
              'Promise.all([ready,new Promise(resolve=>{parent.pngHeld=true;parent.pngRelease=()=>resolve(document.fonts);})])',
            );
          descriptor.set!.call(this, value);
        },
      });
      w.pngJob = api.exportPNGFrame(p, 2, ctrl.signal).then(
        () => false,
        () => true,
      );
      w.pngChange = () => {
        if (change === 'source') p.layers[0].keys[0].shapes[0].x++;
        else ctrl.abort();
      };
      w.pngRecover = async () => {
        w.pngRelease?.();
        delete w.pngRelease;
        Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', descriptor);
        const blob = await api.exportPNGFrame(p, 2),
          image = await createImageBitmap(blob),
          c = document.createElement('canvas');
        c.width = 160;
        c.height = 100;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        image.close();
        return Array.from(ctx.getImageData(33, 17, 1, 1).data);
      };
    }, change);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { pngHeld: boolean }).pngHeld))
      .toBe(true);
    if (change === 'timeout') await page.clock.fastForward(60001);
    else await page.evaluate(() => (window as unknown as { pngChange: () => void }).pngChange());
    const result = await page.evaluate(async () => {
      const w = window as unknown as {
        pngJob: Promise<boolean>;
        pngRecover: () => Promise<number[]>;
      };
      const rejected = await w.pngJob,
        hosts = document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
        pixel = await w.pngRecover();
      return { rejected, hosts, pixel };
    });
    expect(result).toEqual({ rejected: true, hosts: 0, pixel: [255, 0, 0, 255] });
  });

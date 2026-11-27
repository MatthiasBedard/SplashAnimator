import { openExportSettings, expectExportStatus } from './export-settings';
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { newProject, type Vector } from '../../packages/document/src';
function fixture() {
  const p = newProject();
  p.name = 'MP4 fixture';
  p.width = p.height = 32;
  p.duration = 4;
  p.fps = 20;
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'child',
      name: 'Child',
      width: 32,
      height: 32,
      shapes: [art],
      timeline: {
        duration: 3,
        keys: [
          { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
        ],
      },
    },
  ];
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        {
          ...art,
          id: 'movie',
          kind: 'symbol',
          symbolId: 'child',
          symbolPlayback: { mode: 'movie', firstFrame: 0 },
        },
      ],
    },
  ];
  const up = { ...art, id: 'up', width: 8, height: 8, fill: '#ffff00' };
  p.symbols.push({
    id: 'button',
    name: 'Button',
    width: 8,
    height: 8,
    shapes: [up],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...up, fill: '#ff00ff' }] }] },
    buttonStates: { up: 0, over: 1, down: 1, hit: 1 },
  });
  p.layers.push({
    id: 'buttons',
    name: 'Buttons',
    visible: true,
    locked: false,
    keys: [
      {
        frame: 0,
        shapes: [
          {
            ...up,
            id: 'button-instance',
            kind: 'symbol',
            symbolId: 'button',
            x: 24,
            y: 24,
            symbolPlayback: { mode: 'single', firstFrame: 1 },
          },
        ],
      },
    ],
  });
  p.frameScripts = [{ frame: 0, source: 'throw Error("MP4 source stays inert");' }];
  return p;
}
async function recover(page: Page) {
  await page.addInitScript((p) => {
    if (window === window.top)
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      );
  }, fixture());
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  return page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
}
async function start(page: Page, selected = false) {
  await openExportSettings(page);
  await page
    .getByRole('button', {
      name: selected ? 'Export selected silent MP4 range…' : 'Export silent MP4 video…',
      exact: true,
    })
    .click();
}
async function decode(page: Page, bytes: Buffer, selected: boolean) {
  return page.evaluate(
    async ({ base64, selected }) => {
      const video = document.createElement('video');
      video.muted = true;
      document.body.append(video);
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'video/mp4' }),
      );
      const wait = (event: string) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
              clean();
              reject(Error(event + ' timeout'));
            }, 5000),
            ok = () => {
              clean();
              resolve();
            },
            bad = () => {
              clean();
              reject(Error(video.error?.message ?? 'MP4 playback'));
            },
            clean = () => {
              clearTimeout(timer);
              video.removeEventListener(event, ok);
              video.removeEventListener('error', bad);
            };
          video.addEventListener(event, ok);
          video.addEventListener('error', bad);
        });
      let duration = 0;
      const colors: number[][] = [],
        buttons: number[][] = [];
      try {
        const ready = wait('loadeddata');
        video.src = url;
        await ready;
        duration = video.duration;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const x = canvas.getContext('2d')!;
        for (const time of selected ? [0.01, 0.06, 0.01] : [0.01, 0.06, 0.11, 0.16]) {
          const seek = wait('seeked');
          video.currentTime = time;
          await seek;
          x.drawImage(video, 0, 0);
          colors.push(Array.from(x.getImageData(16, 16, 1, 1).data));
          buttons.push(Array.from(x.getImageData(28, 28, 1, 1).data));
        }
      } finally {
        video.removeAttribute('src');
        video.load();
        video.remove();
        URL.revokeObjectURL(url);
      }
      return { duration, colors, buttons };
    },
    { base64: bytes.toString('base64'), selected },
  );
}
for (const { selected, remembered } of [
  { selected: false, remembered: false },
  { selected: true, remembered: false },
  { selected: true, remembered: true },
])
  test(`silent MP4 download ${remembered ? 'remembered ' : ''}${selected ? 'selected' : 'full'} preserves real pixels, library and one prior history edit`, async ({
    page,
  }) => {
    const original = await recover(page);
    await page.getByLabel('Layer name', { exact: true }).fill('Before export');
    await page.getByLabel('Layer name', { exact: true }).press('Enter');
    const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    if (selected) {
      const box = (await page.getByLabel('Timeline frames').boundingBox())!;
      await page.mouse.click(box.x + 33, box.y + 40);
      await page.keyboard.down('Shift');
      await page.mouse.click(box.x + 45, box.y + 40);
      await page.keyboard.up('Shift');
    }
    await openExportSettings(page);
    await page.getByLabel('Video target bitrate', { exact: true }).selectOption('1000000');
    await page.getByLabel('Video keyframe interval', { exact: true }).fill('2');
    if (remembered) await page.getByLabel('Use remembered video motion', { exact: true }).check();
    const pending = page.waitForEvent('download');
    await page
      .getByRole('button', {
        name: selected ? 'Export selected silent MP4 range…' : 'Export silent MP4 video…',
        exact: true,
      })
      .click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(
      remembered ? 'MP4 fixture-remembered.mp4' : 'MP4 fixture.mp4',
    );
    await expectExportStatus(
      page,
      `Exported ${remembered ? 'remembered ' : ''}${selected ? 2 : 4} MP4 frames`,
    );
    await expectExportStatus(page, 'no audio');
    const decoded = await decode(page, await fs.readFile((await download.path())!), selected);
    expect(decoded.duration).toBeCloseTo(selected ? 0.1 : 0.2, 5);
    for (const [i, c] of selected
      ? [
          [0, 1],
          [1, 2],
          [2, 1],
        ]
      : [
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 0],
        ]) {
      expect(decoded.colors[i][c]).toBeGreaterThan(220);
      for (const other of [0, 1, 2].filter((n) => n !== c))
        expect(decoded.colors[i][other]).toBeLessThan(30);
    }
    for (const color of decoded.buttons) {
      expect(color[0]).toBeGreaterThan(220);
      expect(color[1]).toBeGreaterThan(220);
      expect(color[2]).toBeLessThan(30);
    }
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
    await expect(page.locator('iframe[title="Detached frame replay"]')).toHaveCount(0);
    await openExportSettings(page);
    await expect(page.getByLabel('Video target bitrate', { exact: true })).toHaveValue('1000000');
    await expect(page.getByLabel('Video keyframe interval', { exact: true })).toHaveValue('2');
    await expect(page.getByLabel('Use remembered video motion', { exact: true })).toBeChecked({
      checked: remembered,
    });
    await expect(
      page.getByRole('button', { name: 'Export WebM video…', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Export IVF video…', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Close export', exact: true }).click();
    await page.getByLabel('Drawing stage', { exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
      .toBe(original);
    await page.keyboard.press('Control+Shift+z');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('splash-recovery-v1')))
      .toBe(before);
  });
for (const fault of [
  'cancel',
  'source',
  'option',
  'restored',
  'restored-change',
  'context',
  'timeout',
] as const)
  test(`held native MP4 ${fault} rejects publication, cleans capture and retries`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Reflect.set(window, 'holdMp4Flush', true);
      const flush = VideoEncoder.prototype.flush;
      VideoEncoder.prototype.flush = function () {
        Reflect.set(window, 'mp4FlushSeen', true);
        return Reflect.get(window, 'holdMp4Flush')
          ? new Promise<void>((resolve, reject) => {
              Reflect.set(window, 'releaseMp4Flush', () => {
                Reflect.set(window, 'holdMp4Flush', false);
                flush.call(this).then(resolve, reject);
              });
            })
          : flush.call(this);
      };
      const stringify = JSON.stringify,
        copy = structuredClone;
      JSON.stringify = ((value: unknown, ...args: unknown[]) => {
        const p = value as { name?: string; layers?: { name: string }[] };
        if (p?.name === 'MP4 fixture' && p.layers) {
          try {
            copy(p);
          } catch {
            Reflect.set(window, 'mp4Live', p);
          }
        }
        return Reflect.apply(stringify, JSON, [value, ...args]);
      }) as typeof JSON.stringify;
    });
    const before = await recover(page);
    let downloads = 0;
    page.on('download', () => downloads++);
    await start(page);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'mp4FlushSeen'))).toBe(true);
    if (fault === 'cancel')
      await page.getByRole('button', { name: 'Cancel MP4 export', exact: true }).click();
    else
      await page.evaluate(async (fault) => {
        if (fault === 'source') {
          const source = Reflect.get(window, 'mp4Live');
          if (!source) throw Error('No actual source');
          source.layers[0].name = 'Late MP4 source';
        } else if (fault === 'timeout') {
          const now = performance.now.bind(performance);
          Object.defineProperty(performance, 'now', {
            configurable: true,
            value: () => now() + 60001,
          });
        } else if (fault === 'context') {
          const help = Array.from(document.querySelectorAll('button')).find(
            (b) => b.textContent?.trim() === 'Help',
          ) as HTMLButtonElement;
          help.click();
          await new Promise(requestAnimationFrame);
          const status = Array.from(document.querySelectorAll('button')).find(
            (b) => b.textContent?.trim() === 'Build status & shortcuts',
          ) as HTMLButtonElement;
          if (!status) throw Error('No actual help context');
          status.click();
        } else {
          const file = Array.from(document.querySelectorAll('button')).find(
            (b) => b.textContent?.trim() === 'File',
          ) as HTMLButtonElement;
          file.click();
          await new Promise(requestAnimationFrame);
          const select = document.querySelector(
            'select[aria-label="Video target bitrate"]',
          ) as HTMLSelectElement;
          select.value = '1000000';
          if (fault !== 'restored-change')
            select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          if (fault === 'restored' || fault === 'restored-change') {
            select.value = '4000000';
            if (fault !== 'restored-change')
              select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          file.click();
        }
        const release = Reflect.get(window, 'releaseMp4Flush');
        if (typeof release !== 'function') throw Error('No native flush');
        release();
      }, fault);
    if (fault === 'cancel') await expectExportStatus(page, 'MP4 export cancelled');
    else
      await expect(page.getByRole('alert')).toContainText(
        fault === 'timeout' ? 'timed out' : 'MP4 source',
      );
    await expect(page.locator('iframe[title="Detached frame replay"]')).toHaveCount(0);
    expect(downloads).toBe(0);
    if (fault === 'timeout') await page.evaluate(() => Reflect.deleteProperty(performance, 'now'));
    if (fault === 'context')
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    if (fault === 'source')
      await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue('Late MP4 source');
    else expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
    await page.evaluate(() => Reflect.set(window, 'holdMp4Flush', false));
    const retry = page.waitForEvent('download');
    await start(page);
    await retry;
    expect(downloads).toBe(1);
  });

for (const fault of ['blob-source', 'url-source', 'url-cancel', 'link-source'] as const)
  test(`complete MP4 ${fault} publication hook rejects output and revokes URLs before retry`, async ({
    page,
  }) => {
    await page.addInitScript((fault) => {
      const stringify = JSON.stringify,
        copy = structuredClone;
      JSON.stringify = ((value: unknown, ...args: unknown[]) => {
        const p = value as { name?: string; layers?: { name: string }[] };
        if (p?.name === 'MP4 fixture' && p.layers) {
          try {
            copy(p);
          } catch {
            Reflect.set(window, 'mp4Live', p);
          }
        }
        return Reflect.apply(stringify, JSON, [value, ...args]);
      }) as typeof JSON.stringify;
      let armed = true;
      const live = new Set<string>(),
        Native = Blob,
        create = URL.createObjectURL,
        revoke = URL.revokeObjectURL;
      const fire = () => {
        if (!armed) return;
        armed = false;
        Reflect.set(window, 'mp4PublicationSeen', true);
        if (fault === 'url-cancel') {
          const cancel = Array.from(document.querySelectorAll('button')).find(
            (b) => b.textContent?.trim() === 'Cancel MP4 export',
          ) as HTMLButtonElement;
          if (!cancel) throw Error('No actual cancel control');
          cancel.click();
        } else {
          const source = Reflect.get(window, 'mp4Live');
          if (!source) throw Error('No actual live publication source');
          source.layers[0].name = 'Late publication source';
        }
      };
      if (fault === 'blob-source')
        globalThis.Blob = class extends Native {
          constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
            super(parts, options);
            if (options?.type === 'video/mp4') fire();
          }
        };
      URL.createObjectURL = function (blob) {
        const url = create.call(this, blob);
        if (blob instanceof Native && blob.type === 'video/mp4') {
          live.add(url);
          if (fault.startsWith('url-')) fire();
        }
        return url;
      };
      URL.revokeObjectURL = function (url) {
        live.delete(url);
        return revoke.call(this, url);
      };
      if (fault === 'link-source') {
        const descriptor = Object.getOwnPropertyDescriptor(
          HTMLAnchorElement.prototype,
          'download',
        )!;
        Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
          ...descriptor,
          set(value) {
            descriptor.set!.call(this, value);
            if (String(value).endsWith('.mp4')) fire();
          },
        });
      }
      Reflect.set(window, 'mp4LiveURLs', () => live.size);
    }, fault);
    const before = await recover(page);
    let downloads = 0;
    page.on('download', () => downloads++);
    await start(page);
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, 'mp4PublicationSeen')))
      .toBe(true);
    if (fault === 'url-cancel') await expectExportStatus(page, 'MP4 export cancelled');
    else await expect(page.getByRole('alert')).toContainText('MP4 source');
    expect(downloads).toBe(0);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'mp4LiveURLs')())).toBe(0);
    if (fault.endsWith('source'))
      await expect(page.getByLabel('Layer name', { exact: true })).toHaveValue(
        'Late publication source',
      );
    else expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
    const retry = page.waitForEvent('download');
    await start(page);
    await retry;
    expect(downloads).toBe(1);
  });
test('unsupported native AVC fails without a WebM fallback and retries on supported encoding', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.set(window, 'mp4Unsupported', true);
    const support = VideoEncoder.isConfigSupported;
    VideoEncoder.isConfigSupported = function (config) {
      if (Reflect.get(window, 'mp4Unsupported'))
        return Promise.resolve({ supported: false, config });
      return support.call(this, config);
    };
  });
  const before = await recover(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await start(page);
  await expect(page.getByRole('alert')).toContainText('unsupported');
  expect(downloads).toBe(0);
  await expect(page.locator('iframe[title="Detached frame replay"]')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
  await page.evaluate(() => Reflect.set(window, 'mp4Unsupported', false));
  const retry = page.waitForEvent('download');
  await start(page);
  await retry;
});
test('missing browser encoding disables both MP4 actions', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.VideoEncoder = undefined as never;
  });
  await recover(page);
  await openExportSettings(page);
  await expect(
    page.getByRole('button', { name: 'Export silent MP4 video…', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Export selected silent MP4 range…', exact: true }),
  ).toBeDisabled();
});
for (const fault of ['cancel', 'timeout'] as const)
  test(`MP4 lazy import ${fault} releases busy state and rejects late module completion`, async ({
    page,
  }) => {
    if (fault === 'timeout') await page.clock.install();
    let seen = false,
      release!: () => void;
    const pattern = /\/(?:src\/export-mp4\.ts|assets\/export-mp4-[^/]+\.js)(?:\?.*)?$/;
    await page.route(pattern, async (route) => {
      seen = true;
      await new Promise<void>((r) => {
        release = r;
      });
      await route.continue();
    });
    const before = await recover(page);
    let downloads = 0;
    page.on('download', () => downloads++);
    await start(page);
    await expect.poll(() => seen).toBe(true);
    if (fault === 'cancel') {
      await page.getByRole('button', { name: 'Cancel MP4 export', exact: true }).click();
      await expectExportStatus(page, 'MP4 export cancelled');
    } else {
      await page.clock.fastForward(60001);
      await expect(page.getByRole('alert')).toContainText('timed out');
    }
    await expect(page.getByRole('button', { name: 'Cancel MP4 export', exact: true })).toHaveCount(
      0,
    );
    expect(downloads).toBe(0);
    const loaded = page.waitForResponse(
      (response) => pattern.test(response.url()) && response.ok(),
    );
    release();
    await loaded;
    await page.unroute(pattern);
    const retry = page.waitForEvent('download');
    await start(page);
    await retry;
    expect(downloads).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
  });

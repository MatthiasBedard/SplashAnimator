import { openExportSettings, expectExportStatus } from './export-settings';
import { test, expect } from '@playwright/test';
import { newProject, type Vector } from '../../packages/document/src';
function fixture() {
  const p = newProject();
  p.name = 'MP4 save';
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
      id: 'movie',
      name: 'Movie',
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
          id: 'instance',
          kind: 'symbol',
          symbolId: 'movie',
          symbolPlayback: { mode: 'movie', firstFrame: 0 },
        },
      ],
    },
  ];
  p.frameScripts = [{ frame: 0, source: 'throw Error("MP4 saves stay script-free");' }];
  return p;
}
const modes = [
  'full',
  'selected',
  'remembered',
  'write-failure',
  'write-cancel',
  'write-timeout',
  'source',
  'restored',
  'context',
  'open-source',
  'open-cancel',
  'abort-hold',
  'late-open',
  'picker-cancel',
  'picker-source',
  'picker-restored',
  'picker-abort',
  'long-picker',
  'invalid-handle',
  'handle-method',
  'close-failure',
  'close-abort',
  'close-hold',
  'final-timeout',
] as const;
for (const mode of modes)
  test(`transactional silent MP4 file save ${mode}`, async ({ page }) => {
    if (mode === 'long-picker' || mode === 'write-timeout') await page.clock.install();
    await page.addInitScript(
      ({ project, mode }) => {
        if (window !== window.top) return;
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project, folder: null, manifest: null }),
        );
        const state = {
          mode,
          name: 'mp4-save-' + crypto.randomUUID(),
          opens: 0,
          writes: 0,
          closes: 0,
          aborts: 0,
          releases: 0,
          opening: false,
          writing: false,
          closing: false,
          picking: false,
          activation: false,
          beforeReturn: false,
          eventReturned: false,
          nativeOnPick: -1,
          nativeClosed: false,
          suggested: '',
          types: undefined as unknown,
          bytes: [] as number[],
          redirects: 0,
          releasePicker: () => {},
          releaseOpen: () => {},
          releaseClose: () => {},
          releaseAbort: () => {},
          abortWaiting: false,
          restore: () => {},
          live: undefined as undefined | { layers: { name: string }[] },
        };
        Reflect.set(window, 'mp4Save', state);
        const now = performance.now.bind(performance);
        state.restore = () =>
          Object.defineProperty(performance, 'now', { configurable: true, value: now });
        const Native = VideoEncoder,
          encoders: VideoEncoder[] = [];
        let replace = () => {};
        globalThis.VideoEncoder = class extends Native {
          constructor(init: VideoEncoderInit) {
            super(init);
            encoders.push(this);
          }
          async flush() {
            if (state.mode === 'handle-method') replace();
            return super.flush();
          }
        };
        const stringify = JSON.stringify,
          copy = structuredClone;
        JSON.stringify = ((value: unknown, ...args: unknown[]) => {
          const p = value as { name?: string; layers: { name: string }[] };
          if (p?.name === 'MP4 save') {
            try {
              copy(p);
            } catch {
              state.live = p;
            }
          }
          return Reflect.apply(stringify, JSON, [value, ...args]);
        }) as typeof JSON.stringify;
        document.addEventListener(
          'click',
          (event) => {
            if (
              (event.target as HTMLElement)?.textContent?.includes('Save') &&
              (event.target as HTMLElement)?.textContent?.includes('MP4')
            ) {
              state.eventReturned = false;
            }
          },
          true,
        );
        window.addEventListener('click', () => {
          state.eventReturned = true;
        });
        Object.assign(window, {
          showSaveFilePicker: async (options: { suggestedName: string; types: unknown }) => {
            state.beforeReturn = !state.eventReturned;
            state.activation = navigator.userActivation.isActive;
            state.nativeOnPick = encoders.length;
            state.suggested = options.suggestedName;
            state.types = options.types;
            const root = await navigator.storage.getDirectory(),
              file = await root.getFileHandle(state.name, { create: true });
            if (state.opens === 0) {
              const seed = await file.createWritable();
              await seed.write('original');
              await seed.close();
            }
            if (state.mode === 'picker-abort')
              throw new DOMException('picker aborted', 'AbortError');
            if (
              state.mode === 'picker-cancel' ||
              state.mode === 'long-picker' ||
              state.mode === 'picker-source' ||
              state.mode === 'picker-restored'
            ) {
              state.picking = true;
              await new Promise<void>((resolve) => {
                state.releasePicker = resolve;
              });
            }
            if (state.mode === 'invalid-handle') return {};
            const handle = {
              createWritable: async () => {
                state.opens++;
                state.opening = true;
                state.nativeClosed =
                  encoders.length > 0 && encoders.every((e) => e.state === 'closed');
                if (state.mode === 'late-open')
                  await new Promise<void>((resolve) => {
                    state.releaseOpen = resolve;
                  });
                const stream = await file.createWritable(),
                  writer = stream.getWriter();
                let releaseWrite = () => {};
                if (state.mode === 'open-source') {
                  if (!state.live) throw Error('No original source');
                  state.live.layers[0].name = 'During MP4 open';
                }
                return {
                  getWriter: () => {
                    if (state.mode === 'open-cancel')
                      queueMicrotask(() => {
                        const button = Array.from(document.querySelectorAll('button')).find(
                          (b) => b.textContent?.trim() === 'Cancel MP4 export',
                        ) as HTMLButtonElement;
                        if (!button) throw Error('No open cancellation control');
                        button.click();
                      });
                    return {
                      async write(bytes: Uint8Array) {
                        state.writes++;
                        state.bytes = Array.from(bytes);
                        state.writing = true;
                        if (state.mode === 'write-failure')
                          throw Error('injected MP4 write failure');
                        if (state.mode === 'write-cancel' || state.mode === 'write-timeout') {
                          await new Promise<void>((r) => {
                            releaseWrite = r;
                          });
                          return;
                        }
                        await writer.write(bytes);
                        if (state.mode === 'source' || state.mode === 'abort-hold') {
                          if (!state.live) throw Error('No original source');
                          state.live.layers[0].name = 'After MP4 write';
                        }
                        if (state.mode === 'final-timeout')
                          Object.defineProperty(performance, 'now', {
                            configurable: true,
                            value: () => now() + 60001,
                          });
                        if (state.mode === 'restored' || state.mode === 'context') {
                          const name = state.mode === 'context' ? 'Help' : 'File',
                            button = Array.from(
                              document.querySelectorAll(
                                'nav[aria-label="Application menu"] button',
                              ),
                            ).find((b) => b.textContent?.trim() === name) as HTMLButtonElement;
                          button.click();
                          await new Promise(requestAnimationFrame);
                          if (state.mode === 'context') {
                            const help = Array.from(document.querySelectorAll('button')).find(
                              (b) => b.textContent?.trim() === 'Build status & shortcuts',
                            ) as HTMLButtonElement;
                            help.click();
                          } else {
                            const input = document.querySelector(
                              'select[aria-label="Video target bitrate"]',
                            ) as HTMLSelectElement;
                            input.value = '1000000';
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            input.value = '4000000';
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            button.click();
                          }
                        }
                      },
                      async close() {
                        state.closes++;
                        state.closing = true;
                        if (state.mode === 'close-failure')
                          throw Error('injected MP4 close failure');
                        if (state.mode === 'close-abort')
                          throw new DOMException('storage close aborted', 'AbortError');
                        if (state.mode === 'close-hold')
                          await new Promise<void>((r) => {
                            state.releaseClose = r;
                          });
                        await writer.close();
                      },
                      async abort(reason: unknown) {
                        state.aborts++;
                        releaseWrite();
                        await writer.abort(reason);
                        if (state.mode === 'abort-hold') {
                          state.abortWaiting = true;
                          await new Promise<void>((resolve) => {
                            state.releaseAbort = resolve;
                          });
                        }
                      },
                      releaseLock() {
                        state.releases++;
                        writer.releaseLock();
                      },
                    };
                  },
                } as unknown as FileSystemWritableFileStream;
              },
            };
            replace = () => {
              handle.createWritable = async () => {
                state.redirects++;
                throw Error('redirected handle');
              };
            };
            return handle;
          },
        });
      },
      { project: fixture(), mode },
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    const before = await page.evaluate(() => localStorage.getItem('splash-recovery-v1'));
    let downloads = 0;
    page.on('download', () => downloads++);
    if (mode === 'selected') {
      const box = (await page.getByLabel('Timeline frames').boundingBox())!;
      await page.mouse.click(box.x + 33, box.y + 40);
      await page.keyboard.down('Shift');
      await page.mouse.click(box.x + 45, box.y + 40);
      await page.keyboard.up('Shift');
    }
    await openExportSettings(page);
    if (mode === 'remembered')
      await page.getByLabel('Use remembered video motion', { exact: true }).check();
    await page
      .getByRole('button', {
        name:
          mode === 'selected'
            ? 'Save selected silent MP4 range to file…'
            : 'Save silent MP4 video to file…',
        exact: true,
      })
      .click();
    if (mode === 'write-cancel' || mode === 'write-timeout') {
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, 'mp4Save').writing))
        .toBe(true);
      if (mode === 'write-cancel')
        await page.getByRole('button', { name: 'Cancel MP4 export', exact: true }).click();
      else await page.clock.fastForward(60001);
    }
    if (mode === 'late-open') {
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, 'mp4Save').opening))
        .toBe(true);
      await page.getByRole('button', { name: 'Cancel MP4 export', exact: true }).click();
      await expectExportStatus(page, 'MP4 export cancelled');
      await page.evaluate(() => Reflect.get(window, 'mp4Save').releaseOpen());
      await expect.poll(() => page.evaluate(() => Reflect.get(window, 'mp4Save').aborts)).toBe(1);
    }
    if (
      mode === 'picker-cancel' ||
      mode === 'long-picker' ||
      mode === 'picker-source' ||
      mode === 'picker-restored'
    ) {
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, 'mp4Save').picking))
        .toBe(true);
      if (mode === 'picker-cancel') {
        await page.getByRole('button', { name: 'Cancel MP4 export', exact: true }).click();
        await expectExportStatus(page, 'MP4 export cancelled');
      } else if (mode === 'long-picker') await page.clock.fastForward(65000);
      else if (mode === 'picker-source')
        await page.evaluate(() => {
          const state = Reflect.get(window, 'mp4Save');
          if (!state.live) throw Error('No actual picker source');
          state.live.layers[0].name = 'During picker source';
        });
      else
        await page.evaluate(async () => {
          const file = Array.from(
            document.querySelectorAll('nav[aria-label="Application menu"] button'),
          ).find((b) => b.textContent?.trim() === 'File') as HTMLButtonElement;
          file.click();
          await new Promise(requestAnimationFrame);
          const select = document.querySelector(
            'select[aria-label="Video target bitrate"]',
          ) as HTMLSelectElement;
          select.value = '1000000';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          select.value = '4000000';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          file.click();
        });
      await page.evaluate(() => Reflect.get(window, 'mp4Save').releasePicker());
    }
    if (mode === 'close-hold') {
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, 'mp4Save').closing))
        .toBe(true);
      await expect(
        page.getByRole('button', { name: 'Cancel MP4 export', exact: true }),
      ).toHaveCount(0);
      await openExportSettings(page);
      await expect(
        page.getByRole('button', { name: 'Save silent MP4 video to file…', exact: true }),
      ).toBeDisabled();
      await openExportSettings(page);
      await page.evaluate(() => {
        const now = performance.now.bind(performance);
        Object.defineProperty(performance, 'now', {
          configurable: true,
          value: () => now() + 60001,
        });
        Reflect.get(window, 'mp4Save').releaseClose();
      });
    }
    if (mode === 'abort-hold') {
      await expect
        .poll(() => page.evaluate(() => Reflect.get(window, 'mp4Save').abortWaiting))
        .toBe(true);
      await openExportSettings(page);
      await expect(
        page.getByRole('button', { name: 'Save silent MP4 video to file…', exact: true }),
      ).toBeDisabled();
      await openExportSettings(page);
      await page.getByRole('button', { name: 'Cancel MP4 export', exact: true }).click();
      await page.evaluate(() => Reflect.get(window, 'mp4Save').releaseAbort());
    }
    const positive = [
        'full',
        'selected',
        'remembered',
        'long-picker',
        'handle-method',
        'close-hold',
      ].includes(mode),
      cancelled = [
        'write-cancel',
        'late-open',
        'open-cancel',
        'picker-cancel',
        'picker-abort',
      ].includes(mode);
    if (positive)
      await expectExportStatus(
        page,
        `Saved ${mode === 'remembered' ? 'remembered ' : ''}${mode === 'selected' ? 2 : 4} MP4 frames`,
      );
    else if (cancelled) await expectExportStatus(page, 'MP4 export cancelled');
    else
      await expect(page.getByRole('alert')).toContainText(
        mode === 'write-failure'
          ? 'write failure'
          : mode === 'close-failure'
            ? 'close failure'
            : mode === 'close-abort'
              ? 'storage close aborted'
              : mode === 'invalid-handle'
                ? 'Invalid MP4 save destination'
                : mode.includes('timeout')
                  ? 'timed out'
                  : 'MP4 source',
      );
    await page.evaluate(() => Reflect.get(window, 'mp4Save').restore());
    if (mode === 'context')
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.locator('iframe[title="Detached frame replay"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel MP4 export', exact: true })).toHaveCount(
      0,
    );
    expect(downloads).toBe(0);
    const result = await page.evaluate(async () => {
      const state = Reflect.get(window, 'mp4Save'),
        root = await navigator.storage.getDirectory(),
        file = await root.getFileHandle(state.name),
        bytes = new Uint8Array(await (await file.getFile()).arrayBuffer());
      return {
        bytes: Array.from(bytes),
        opens: state.opens,
        writes: state.writes,
        closes: state.closes,
        aborts: state.aborts,
        releases: state.releases,
        activation: state.activation,
        beforeReturn: state.beforeReturn,
        nativeOnPick: state.nativeOnPick,
        nativeClosed: state.nativeClosed,
        suggested: state.suggested,
        types: state.types,
        expected: state.bytes,
        redirects: state.redirects,
      };
    });
    expect(result.activation).toBe(true);
    expect(result.beforeReturn).toBe(true);
    expect(result.nativeOnPick).toBe(0);
    expect(result.suggested).toBe(
      mode === 'remembered' ? 'MP4 save-remembered.mp4' : 'MP4 save.mp4',
    );
    expect(result.types).toEqual([
      { description: 'Silent H.264 MP4 video', accept: { 'video/mp4': ['.mp4'] } },
    ]);
    expect(result.redirects).toBe(0);
    if (positive) {
      expect(result.bytes).toEqual(result.expected);
      expect(String.fromCharCode(...result.bytes.slice(4, 8))).toBe('ftyp');
      expect(result.closes).toBe(1);
      expect(result.aborts).toBe(0);
      expect(result.releases).toBe(1);
      expect(result.nativeClosed).toBe(true);
    } else {
      expect(new TextDecoder().decode(new Uint8Array(result.bytes))).toBe('original');
      if (
        [
          'picker-cancel',
          'picker-abort',
          'picker-source',
          'picker-restored',
          'invalid-handle',
        ].includes(mode)
      )
        expect(result.opens).toBe(0);
      else {
        expect(result.aborts).toBe(1);
        expect(result.releases).toBe(1);
      }
    }
    expect(await page.evaluate(() => localStorage.getItem('splash-recovery-v1'))).toBe(before);
    if (['full', 'selected', 'remembered'].includes(mode)) {
      const playback = await page.evaluate(
        async ({ bytes, selected }) => {
          const video = document.createElement('video');
          video.muted = true;
          document.body.append(video);
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }));
          const wait = (name: string) =>
            new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                  clean();
                  reject(Error('saved MP4 timeout'));
                }, 5000),
                ok = () => {
                  clean();
                  resolve();
                },
                bad = () => {
                  clean();
                  reject(Error(video.error?.message ?? 'saved MP4 error'));
                },
                clean = () => {
                  clearTimeout(timer);
                  video.removeEventListener(name, ok);
                  video.removeEventListener('error', bad);
                };
              video.addEventListener(name, ok);
              video.addEventListener('error', bad);
            });
          const colors: number[][] = [];
          let duration = 0;
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
            }
          } finally {
            video.removeAttribute('src');
            video.load();
            video.remove();
            URL.revokeObjectURL(url);
          }
          return { colors, duration };
        },
        { bytes: result.bytes, selected: mode === 'selected' },
      );
      expect(playback.duration).toBeCloseTo(mode === 'selected' ? 0.1 : 0.2, 5);
      for (const [i, c] of mode === 'selected'
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
        expect(playback.colors[i][c]).toBeGreaterThan(220);
        for (const other of [0, 1, 2].filter((n) => n !== c))
          expect(playback.colors[i][other]).toBeLessThan(30);
      }
    }
    if (!positive) {
      await page.evaluate(() => {
        const state = Reflect.get(window, 'mp4Save');
        state.mode = 'full';
      });
      await openExportSettings(page);
      await page
        .getByRole('button', { name: 'Save silent MP4 video to file…', exact: true })
        .click();
      await expectExportStatus(page, 'Saved 4 MP4 frames');
    }
  });

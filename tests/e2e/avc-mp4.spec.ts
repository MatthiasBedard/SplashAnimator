import { test, expect } from '@playwright/test';
test('complete AVC MP4 provider preserves native pixels and cancels held source delivery with a fresh retry', async ({
  page,
}) => {
  const { build } = await import('vite');
  const bundle = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'packages/export-video/src/avc-mp4.ts',
        formats: ['es'],
        fileName: () => 'complete-avc.js',
      },
    },
  });
  for (const b of Array.isArray(bundle) ? bundle : [bundle])
    if ('output' in b)
      for (const o of b.output)
        if (o.type === 'chunk')
          await page.route('**/' + o.fileName, (r) =>
            r.fulfill({ contentType: 'text/javascript', body: o.code }),
          );
  await page.goto('/');
  const actual = await page.evaluate(async () => {
    const path = '/complete-avc.js',
      { encodeAvcMp4 } = (await import(
        path
      )) as typeof import('../../packages/export-video/src/avc-mp4');
    const settings = {
      width: 32,
      height: 32,
      frameCount: 3,
      rate: 30000,
      scale: 1001,
      bitrate: 1000000,
      keyFrameInterval: 2,
    };
    const pixels = (index: number) => {
      const result = new Uint8Array(32 * 32 * 4);
      for (let i = 0; i < result.length; i += 4) {
        result[i + (index ? 2 : 0)] = 255;
        result[i + 3] = 255;
      }
      return result;
    };
    let reached!: () => void, release!: () => void;
    const held = new Promise<void>((r) => {
        reached = r;
      }),
      c = new AbortController(),
      calls: number[] = [];
    const pending = encodeAvcMp4(
      settings,
      async (index, signal) => {
        calls.push(index);
        signal.throwIfAborted();
        reached();
        await new Promise<void>((r) => {
          release = r;
        });
        return pixels(index);
      },
      { signal: c.signal },
    );
    await held;
    c.abort(Error('held source cancelled'));
    let cancelled = false;
    try {
      await pending;
    } catch (error) {
      cancelled = String(error).includes('held source cancelled');
    }
    release();
    let sourceChanged = false,
      sourceRejected = false;
    const sourceCalls: number[] = [];
    try {
      await encodeAvcMp4(
        settings,
        (index) => {
          sourceCalls.push(index);
          sourceChanged = true;
          return pixels(index);
        },
        {
          validate() {
            if (sourceChanged) throw Error('source changed');
          },
        },
      );
    } catch (error) {
      sourceRejected = String(error).includes('source changed');
    }
    const order: number[] = [],
      result = await encodeAvcMp4(settings, (index, signal) => {
        signal.throwIfAborted();
        order.push(index);
        const rgba = pixels(index);
        if (index === 1) return Promise.resolve(rgba);
        queueMicrotask(() => rgba.fill(0));
        return rgba;
      });
    const video = document.createElement('video');
    video.muted = true;
    document.body.append(video);
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(result.bytes).buffer], { type: 'video/mp4' }),
    );
    const wait = (name: string) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            clean();
            reject(Error('provider MP4 ' + name + ' timeout'));
          }, 5000),
          ok = () => {
            clean();
            resolve();
          },
          bad = () => {
            clean();
            reject(Error(video.error?.message ?? 'provider MP4 error'));
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
      const context = canvas.getContext('2d')!;
      for (const time of [0.01, 0.045, 0.08, 0.01]) {
        const seek = wait('seeked');
        video.currentTime = time;
        await seek;
        context.drawImage(video, 0, 0);
        colors.push(Array.from(context.getImageData(16, 16, 1, 1).data));
      }
    } finally {
      video.removeAttribute('src');
      video.load();
      video.remove();
      URL.revokeObjectURL(url);
    }
    return {
      cancelled,
      calls,
      sourceRejected,
      sourceCalls,
      order,
      colors,
      duration,
      frameCount: result.frameCount,
      durationTicks: result.durationTicks,
      codec: result.codec,
    };
  });
  expect(actual.cancelled).toBe(true);
  expect(actual.calls).toEqual([0]);
  expect(actual.sourceRejected).toBe(true);
  expect(actual.sourceCalls).toEqual([0]);
  expect(actual.order).toEqual([0, 1, 2]);
  expect(actual.frameCount).toBe(3);
  expect(actual.durationTicks).toBe(3003);
  expect(actual.duration).toBeCloseTo(0.1001, 5);
  expect(actual.codec).toMatch(/^avc1\.42/);
  for (let i = 0; i < actual.colors.length; i++) {
    const red = i === 0 || i === 3;
    expect(actual.colors[i][red ? 0 : 2]).toBeGreaterThan(230);
    expect(actual.colors[i][red ? 2 : 0]).toBeLessThan(25);
  }
});

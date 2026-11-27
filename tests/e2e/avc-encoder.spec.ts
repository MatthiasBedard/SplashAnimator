import { test, expect } from '@playwright/test';
for (const interval of [1, 2])
  test(`native Baseline AVC interval ${interval} preserves decoded frames and complete MP4 playback`, async ({
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
          entry: {
            'avc-host': 'packages/export-video/src/avc-encoder.ts',
            'avc-capture': 'packages/export-video/src/avc-samples.ts',
            'avc-mp4': 'packages/export-video/src/mp4-avc.ts',
          },
          formats: ['es'],
          fileName: (_format, name) => name + '.js',
        },
      },
    });
    for (const r of Array.isArray(bundle) ? bundle : [bundle])
      if ('output' in r)
        for (const o of r.output)
          if (o.type === 'chunk')
            await page.route('**/' + o.fileName, (route) =>
              route.fulfill({ contentType: 'text/javascript', body: o.code }),
            );
    await page.goto('/');
    const result = await page.evaluate(async (interval) => {
      const hp = '/avc-host.js',
        cp = '/avc-capture.js',
        mp = '/avc-mp4.js';
      const { openAvcEncoder } = (await import(
        hp
      )) as typeof import('../../packages/export-video/src/avc-encoder');
      const { readPreparedAvcDescription, readPreparedAvcSample } = (await import(
        cp
      )) as typeof import('../../packages/export-video/src/avc-samples');
      const { prepareAvcMp4 } = (await import(
        mp
      )) as typeof import('../../packages/export-video/src/mp4-avc');
      const host = await openAvcEncoder({
        width: 32,
        height: 32,
        frameCount: 3,
        rate: 30000,
        scale: 1001,
        bitrate: 1000000,
        keyFrameInterval: interval,
      });
      for (let i = 0; i < 3; i++) {
        const rgba = new Uint8Array(32 * 32 * 4);
        for (let p = 0; p < rgba.length; p += 4) {
          rgba[p + (i ? 2 : 0)] = 255;
          rgba[p + 3] = 255;
        }
        const job = host.append(rgba);
        rgba.fill(0);
        await job;
      }
      const capture = host.finish(),
        meta = capture.metadata(),
        packets = [0, 1, 2].map((i) => readPreparedAvcSample(capture, i));
      const colors: number[][] = [],
        times: number[] = [];
      let failure: unknown;
      const decoder = new VideoDecoder({
        output(frame) {
          try {
            const canvas = new OffscreenCanvas(32, 32),
              x = canvas.getContext('2d')!;
            x.drawImage(frame, 0, 0);
            colors.push(Array.from(x.getImageData(16, 16, 1, 1).data));
            times.push(frame.timestamp);
          } finally {
            frame.close();
          }
        },
        error(error) {
          failure = error;
        },
      });
      try {
        decoder.configure({
          codec: meta.codec,
          codedWidth: 32,
          codedHeight: 32,
          description: readPreparedAvcDescription(capture),
        });
        for (const p of packets)
          decoder.decode(
            new EncodedVideoChunk({
              type: p.keyFrame ? 'key' : 'delta',
              timestamp: p.timestampUs,
              duration: p.durationUs,
              data: p.bytes,
            }),
          );
        await decoder.flush();
        if (failure) throw failure;
      } finally {
        decoder.close();
      }
      const mux = prepareAvcMp4(capture),
        bytes = mux.bytes(),
        video = document.createElement('video');
      video.muted = true;
      document.body.append(video);
      const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: 'video/mp4' }));
      const wait = (name: string) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
              clean();
              reject(Error('MP4 ' + name + ' timeout'));
            }, 5000),
            ok = () => {
              clean();
              resolve();
            },
            bad = () => {
              clean();
              reject(Error(video.error?.message ?? 'MP4 playback failure'));
            },
            clean = () => {
              clearTimeout(timer);
              video.removeEventListener(name, ok);
              video.removeEventListener('error', bad);
            };
          video.addEventListener(name, ok);
          video.addEventListener('error', bad);
        });
      const playback: number[][] = [];
      let duration = 0;
      try {
        const ready = wait('loadeddata');
        video.src = url;
        await ready;
        duration = video.duration;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const x = canvas.getContext('2d')!;
        for (const time of [0.01, 0.045, 0.08, 0.01]) {
          const seeking = wait('seeked');
          video.currentTime = time;
          await seeking;
          x.drawImage(video, 0, 0);
          playback.push(Array.from(x.getImageData(16, 16, 1, 1).data));
        }
      } finally {
        video.removeAttribute('src');
        video.load();
        video.remove();
        URL.revokeObjectURL(url);
        mux.dispose();
        capture.dispose();
      }
      const controller = new AbortController();
      controller.abort();
      let cancelled = false;
      try {
        await openAvcEncoder(
          { width: 32, height: 32, frameCount: 1, rate: 30, scale: 1, bitrate: 100000 },
          { signal: controller.signal },
        );
      } catch {
        cancelled = true;
      }
      return {
        colors,
        times,
        playback,
        duration,
        keys: packets.map((p) => p.keyFrame),
        cancelled,
        meta,
      };
    }, interval);
    expect(result.times).toEqual([0, 33367, 66733]);
    expect(result.keys[0]).toBe(true);
    if (interval === 1) expect(result.keys).toEqual([true, true, true]);
    expect(result.meta.durationTicks).toBe(3003);
    expect(result.duration).toBeCloseTo(0.1001, 5);
    expect(result.cancelled).toBe(true);
    for (const values of [result.colors, result.playback])
      for (let i = 0; i < values.length; i++) {
        const red = i === 0 || i === 3;
        expect(values[i][red ? 0 : 2]).toBeGreaterThan(230);
        expect(values[i][red ? 2 : 0]).toBeLessThan(25);
      }
  });

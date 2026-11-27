import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../live-movie-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-movie-fixture.ts',
        formats: ['iife'],
        name: 'LiveMovie',
        fileName: () => 'movie.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one live movie fixture');
  code = chunks[0].code;
});
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ content: code });
});

for (const mode of ['graphic', 'movie', 'button'])
  test(`native ${mode} artwork advances with live roots and independent paused-root movie clocks`, async ({
    page,
  }) => {
    const result = await page.evaluate(async (mode) => {
      const api = (window as unknown as { LiveMovie: API }).LiveMovie,
        p = api.livePresentationFixture(mode);
      p.fps = 10;
      const before = JSON.stringify(p),
        s = api.createLiveMovieSession(p, 0),
        painter = api.createLiveMoviePainter(p, s, () => {});
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const rows = [];
      for (let n = 0; n < 4; n++) {
        const f = n === 0 ? s.current() : s.advance(n !== 3);
        await painter.prepare(f, () => {});
        painter.publish(canvas, f);
        const ctx = canvas.getContext('2d')!,
          pixels = ctx.getImageData(0, 0, 160, 80).data;
        const at = (x: number, y: number) =>
          Array.from(pixels.slice((y * 160 + x) * 4, (y * 160 + x) * 4 + 4));
        const redX = n === 3 ? 40 : n * 20,
          blueX =
            mode === 'graphic' ? (n === 3 ? 20 : Math.max(0, n - 1) * 20) : [0, 40, 60, 120][n];
        rows.push({
          frame: f.frame,
          tick: f.tick,
          red: at(redX + 5, 5),
          blue: at(blueX + 5, 45),
          hit: n && mode === 'button' ? !!s.pick(f, { x: 45, y: 45 }) : undefined,
        });
        // Native retry must retain both root and child clock phase and exact pixels.
        await painter.prepare(f, () => {});
        painter.publish(canvas, f);
        const retry = ctx.getImageData(0, 0, 160, 80).data;
        if (retry.some((value, i) => value !== pixels[i]))
          throw Error('Native retry changed pixels');
        if (s.current(f.input) !== f) throw Error('Native retry advanced clocks');
      }
      painter.dispose();
      s.dispose();
      return { rows, unchanged: before === JSON.stringify(p) };
    }, mode);
    expect(result.unchanged).toBe(true);
    expect(result.rows.map((r) => [r.frame, r.tick])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [2, 3],
    ]);
    for (const [i, row] of result.rows.entries()) {
      expect(row.red).toEqual([255, 0, 0, 255]);
      expect(row.blue).toEqual(i === 0 ? [255, 255, 255, 255] : [0, 0, 255, 255]);
      if (mode === 'button' && i) expect(row.hit).toBe(true);
    }
  });

test('sampled foreground pixels and private button hits agree through interior/endpoint/hold/blank poses', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { LiveMovie: API }).LiveMovie,
      p = api.livePresentationFixture('button');
    for (const k of p.layers[0].keys) for (const s of k.shapes) s.y = 40;
    p.layers[1].keys[1].shapes[0].x = 40;
    p.layers.reverse();
    const s = api.createLiveMovieSession(p, 3),
      paint = api.createLiveMoviePainter(p, s, () => {}),
      c = document.createElement('canvas'),
      rows = [];
    for (let n = 0; n < 6; n++) {
      const f = n ? s.advance(true) : s.current();
      await paint.prepare(f, () => {});
      paint.publish(c, f);
      rows.push({
        frame: f.frame,
        point: Array.from(c.getContext('2d')!.getImageData(85, 45, 1, 1).data),
        hit: !!s.pick(f, { x: 85, y: 45 }),
      });
    }
    paint.dispose();
    s.dispose();
    return rows;
  });
  expect(result.map((r) => r.frame)).toEqual([3, 4, 5, 6, 7, 8]);
  expect(result.map((r) => r.hit)).toEqual([true, false, false, false, false, true]);
  for (const r of result.slice(1, 5)) expect(r.point).toEqual([255, 0, 0, 255]);
  expect(result[0].point).not.toEqual([255, 0, 0, 255]);
  expect(result[5].point).not.toEqual([255, 0, 0, 255]);
});

for (const change of ['source', 'phase', 'policy', 'close', 'cancel-after-admission'])
  test(`rejects late ${change} after complete offscreen artwork, before visible publication`, async ({
    page,
  }) => {
    const result = await page.evaluate(async (change) => {
      const api = (window as unknown as { LiveMovie: API }).LiveMovie,
        p = api.liveSplitFixture();
      let revision = 0;
      const s = api.createLiveMovieSession(p, 0),
        paint = api.createLiveMoviePainter(p, s, () => {
          if (revision) throw Error('UI policy changed');
        });
      const f = s.current(),
        c = document.createElement('canvas');
      c.width = c.height = 1;
      await paint.prepare(f, () => {});
      const original = CanvasRenderingContext2D.prototype.fillRect;
      let changed = false,
        rejected = false;
      if (change === 'cancel-after-admission') {
        const assert = s.assertCurrent;
        let reads = 0;
        s.assertCurrent = (phase) => {
          assert(phase);
          if (changed && ++reads === 2) paint.cancel();
        };
      }
      CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        original.apply(this, args);
        if (!changed) {
          changed = true;
          if (change === 'source') p.layers[0].keys[0].shapes[0].fill = '#00ff00';
          else if (change === 'phase') s.advance(true);
          else if (change === 'policy') revision++;
          else if (change === 'close') paint.dispose();
        }
      };
      try {
        paint.publish(c, f);
      } catch {
        rejected = true;
      } finally {
        CanvasRenderingContext2D.prototype.fillRect = original;
        paint.dispose();
        s.dispose();
      }
      return {
        changed,
        rejected,
        size: [c.width, c.height],
        pixel: Array.from(c.getContext('2d')!.getImageData(0, 0, 1, 1).data),
      };
    }, change);
    expect(result).toEqual({ changed: true, rejected: true, size: [1, 1], pixel: [0, 0, 0, 0] });
  });

test('cancelled font readiness retries the same logical phase without publishing or advancing clocks', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { LiveMovie: API }).LiveMovie,
      p = api.livePresentationFixture('movie');
    for (const k of p.layers[0].keys)
      for (const shape of k.shapes) {
        shape.kind = 'text';
        shape.text = {
          content: 'A',
          font: 'sans-serif',
          size: 18,
          bold: false,
          italic: false,
          align: 'left',
        };
      }
    const s = api.createLiveMovieSession(p, 1),
      f = s.current(),
      paint = api.createLiveMoviePainter(p, s, () => {});
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      pending = new Promise<void>((r) => (release = r));
    Object.defineProperty(document.fonts, 'ready', {
      configurable: true,
      get() {
        entered();
        return pending;
      },
    });
    const job = paint
      .prepare(f, () => {})
      .then(
        () => false,
        () => true,
      );
    await started;
    paint.cancel();
    release();
    const rejected = await job;
    delete (document.fonts as unknown as { ready?: unknown }).ready;
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    await paint.prepare(f, () => {});
    paint.publish(c, f);
    const data = c.getContext('2d')!.getImageData(20, 0, 20, 20).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > data[i + 1] && data[i + 1] < 240) ink++;
    const unchanged = s.current() === f;
    paint.dispose();
    s.dispose();
    return { rejected, unchanged, ink, size: [c.width, c.height] };
  });
  expect(result.rejected).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.ink).toBeGreaterThan(5);
  expect(result.size).toEqual([160, 80]);
});

test('bitmap readiness is reused across phases and released on painter disposal', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { LiveMovie: API }).LiveMovie,
      p = api.liveSplitFixture();
    const tile = document.createElement('canvas');
    tile.width = tile.height = 2;
    tile.getContext('2d')!.fillStyle = '#00ff00';
    tile.getContext('2d')!.fillRect(0, 0, 2, 2);
    p.assets = [
      {
        id: 'green',
        path: 'assets/bitmaps/green.json',
        bitmap: { name: 'Green', width: 2, height: 2, dataUrl: tile.toDataURL() },
      },
    ];
    for (const key of p.layers[0].keys)
      for (const shape of key.shapes)
        shape.bitmap = { assetId: 'green', x: 0, y: 0, width: 20, height: 20 };
    const before = JSON.stringify(p),
      decode = createImageBitmap;
    let decodes = 0,
      closed = 0;
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      decodes++;
      const image = await decode(...args),
        close = image.close.bind(image);
      image.close = () => {
        closed++;
        close();
      };
      return image;
    }) as typeof createImageBitmap;
    const s = api.createLiveMovieSession(p, 0),
      paint = api.createLiveMoviePainter(p, s, () => {}),
      c = document.createElement('canvas'),
      pixels = [];
    for (let n = 0; n < 4; n++) {
      const f = n ? s.advance(true) : s.current();
      await paint.prepare(f, () => {});
      paint.publish(c, f);
      pixels.push(Array.from(c.getContext('2d')!.getImageData(13 + n * 10, 17, 1, 1).data));
    }
    const beforeClose = closed;
    paint.dispose();
    s.dispose();
    window.createImageBitmap = decode;
    return { decodes, beforeClose, closed, pixels, unchanged: JSON.stringify(p) === before };
  });
  expect(result).toEqual({
    decodes: 1,
    beforeClose: 0,
    closed: 1,
    pixels: Array(4).fill([0, 255, 0, 255]),
    unchanged: true,
  });
});

test('retains exact shared viewport admission before allocating visible or working rasters', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { LiveMovie: API }).LiveMovie,
      rows = [];
    for (const width of [4096, 4097]) {
      const p = api.liveSplitFixture();
      p.width = width;
      p.height = 4096;
      const s = api.createLiveMovieSession(p, 0),
        paint = api.createLiveMoviePainter(p, s, () => {}),
        f = s.current();
      let admitted = true;
      try {
        await paint.prepare(f, () => {});
      } catch {
        admitted = false;
      }
      rows.push({ width, admitted, current: s.current() === f });
      paint.dispose();
      s.dispose();
    }
    return rows;
  });
  expect(result).toEqual([
    { width: 4096, admitted: true, current: true },
    { width: 4097, admitted: false, current: true },
  ]);
});

test('native readiness timeout cleans up and permits same-phase retry', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => {
    const api = (window as unknown as { LiveMovie: API }).LiveMovie,
      p = api.liveSplitFixture();
    for (const key of p.layers[0].keys)
      for (const shape of key.shapes) {
        shape.kind = 'text';
        shape.text = {
          content: 'A',
          font: 'sans-serif',
          size: 18,
          bold: false,
          italic: false,
          align: 'left',
        };
      }
    const w = window as unknown as {
      movieHeld: boolean;
      movieJob: Promise<boolean>;
      movieRetry: () => Promise<boolean>;
    };
    w.movieHeld = false;
    let release!: () => void;
    const pending = new Promise<void>((r) => (release = r));
    Object.defineProperty(document.fonts, 'ready', {
      configurable: true,
      get() {
        w.movieHeld = true;
        return pending;
      },
    });
    const s = api.createLiveMovieSession(p, 0),
      f = s.current(),
      paint = api.createLiveMoviePainter(p, s, () => {});
    w.movieJob = paint
      .prepare(f, () => {})
      .then(
        () => false,
        () => true,
      );
    w.movieRetry = async () => {
      release();
      delete (document.fonts as unknown as { ready?: unknown }).ready;
      await paint.prepare(f, () => {});
      const c = document.createElement('canvas');
      paint.publish(c, f);
      const same = s.current() === f;
      paint.dispose();
      s.dispose();
      return same && c.width === 160;
    };
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { movieHeld: boolean }).movieHeld))
    .toBe(true);
  await page.clock.fastForward(60001);
  const result = await page.evaluate(async () => {
    const w = window as unknown as {
      movieJob: Promise<boolean>;
      movieRetry: () => Promise<boolean>;
    };
    return { rejected: await w.movieJob, retried: await w.movieRetry() };
  });
  expect(result).toEqual({ rejected: true, retried: true });
});

test('rejects asynchronous and swallowed reentrant native admission while retaining same-phase recovery', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const api = (window as unknown as { LiveMovie: API }).LiveMovie,
      p = api.liveSplitFixture(),
      s = api.createLiveMovieSession(p, 0),
      f = s.current(),
      paint = api.createLiveMoviePainter(p, s, () => {});
    let asyncRejected = false,
      reentryRejected = false;
    try {
      await paint.prepare(f, async () => {});
    } catch {
      asyncRejected = true;
    }
    let armed = false;
    await paint.prepare(f, () => {
      if (armed) {
        armed = false;
        try {
          paint.check(f);
        } catch {
          /* enclosing phase must still reject */
        }
      }
    });
    armed = true;
    try {
      paint.publish(document.createElement('canvas'), f);
    } catch {
      reentryRejected = true;
    }
    await paint.prepare(f, () => {});
    const c = document.createElement('canvas');
    paint.publish(c, f);
    const same = s.current() === f;
    paint.dispose();
    s.dispose();
    return { asyncRejected, reentryRejected, same };
  });
  expect(result).toEqual({ asyncRejected: true, reentryRejected: true, same: true });
});

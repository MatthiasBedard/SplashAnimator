import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../live-movie-split-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-movie-split-fixture.ts',
        formats: ['iife'],
        name: 'MovieSplit',
        fileName: () => 'movie-split.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one movie split fixture.');
  code = chunks[0].code;
});
for (const basis of ['plain', 'affine', 'reflected'])
  test(`movie split kernel preserves ${basis} PNG and independent paused Test Movie pixels`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (basis) => {
      const api = (window as unknown as { MovieSplit: API }).MovieSplit,
        p = api.movieSplitFixture(basis),
        before = JSON.stringify(p),
        layer = api.splitLiveMovieMotionLayer(
          p,
          p.layers[0],
          p.layers[0].liveMotionSpans![0],
          6,
          'right',
        ),
        out = { ...p, layers: [layer] },
        stored = JSON.stringify(out);
      const at = (frame: number, age: number) => {
        const t = Math.min((frame - 2) / 8, 1),
          r = (t * Math.PI) / 2,
          phase = (1 + age) % 5,
          a = basis === 'reflected' ? -2 : basis === 'affine' ? 2 : 1,
          b = basis === 'plain' ? 0 : 0.25,
          c = basis === 'plain' ? 0 : 0.5,
          d = basis === 'plain' ? 1 : 3,
          u = a * (phase * 10 + 2) + c * 2,
          v = b * (phase * 10 + 2) + d * 2;
        return {
          x: Math.floor(160 + 20 * t + Math.cos(r) * u - Math.sin(r) * v),
          y: Math.floor(100 + 40 * t + Math.sin(r) * u + Math.cos(r) * v),
        };
      };
      const read = (canvas: HTMLCanvasElement, point: { x: number; y: number }) =>
          Array.from(canvas.getContext('2d')!.getImageData(point.x, point.y, 1, 1).data),
        png = [];
      for (const frame of [2, 3, 4, 6, 8, 9, 10, 11]) {
        const pixels = [];
        for (const project of [p, out]) {
          const blob = await api.exportPNGFrame(project, frame),
            image = await createImageBitmap(blob),
            canvas = document.createElement('canvas');
          canvas.width = 400;
          canvas.height = 240;
          canvas.getContext('2d')!.drawImage(image, 0, 0);
          image.close();
          pixels.push(read(canvas, at(frame, frame - 2)));
        }
        png.push(pixels);
      }
      const movie = [];
      for (const project of [p, out]) {
        const session = api.createLiveMovieSession(project, 0),
          paint = api.createLiveMoviePainter(project, session, () => {}),
          canvas = document.createElement('canvas'),
          rows = [];
        session.current();
        for (let tick = 1; tick <= 12; tick++) {
          const phase = session.advance(tick !== 7);
          if (phase.frame < 2) continue;
          await paint.prepare(phase, () => {});
          paint.publish(canvas, phase);
          rows.push({
            frame: phase.frame,
            tick: phase.tick,
            pixel: read(canvas, at(phase.frame, tick - 2)),
          });
          if (session.current() !== phase) throw Error('Retry advanced a split movie clock.');
        }
        paint.dispose();
        session.dispose();
        movie.push(rows);
      }
      return {
        png,
        movie,
        unchanged: before === JSON.stringify(p) && stored === JSON.stringify(out),
        keys: layer.keys.map((k) => k.frame),
        halves: layer.liveMotionSpans!.map((s) => [s.id, s.start, s.end, s.symbolContinuity]),
        iframes: document.querySelectorAll('iframe').length,
      };
    }, basis);
    expect(errors).toEqual([]);
    expect(result.unchanged).toBe(true);
    expect(result.keys).toEqual([0, 2, 6, 10, 12]);
    expect(result.halves).toEqual([
      ['live', 2, 6, 'movies'],
      ['right', 6, 10, 'movies'],
    ]);
    expect(result.iframes).toBe(0);
    for (const pair of result.png)
      expect(pair).toEqual([
        [255, 0, 0, 255],
        [255, 0, 0, 255],
      ]);
    expect(result.movie[1]).toEqual(result.movie[0]);
    for (const rows of result.movie)
      for (const row of rows) expect(row.pixel).toEqual([255, 0, 0, 255]);
    expect(result.movie[0].find((r) => r.tick === 7)?.frame).toBe(6);
  });

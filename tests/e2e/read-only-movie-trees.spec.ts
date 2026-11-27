import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../read-only-movie-trees-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/read-only-movie-trees-fixture.ts',
        formats: ['iife'],
        name: 'MovieTrees',
        fileName: () => 'tree.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one tree fixture');
  code = chunks[0].code;
});
for (const basis of ['plain', 'affine', 'reflected'])
  test(`read-only ${basis} nested movie PNG and paused Test Movie keep independent phases`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (basis) => {
      const api = (window as unknown as { MovieTrees: API }).MovieTrees,
        { p, requests } = api.readOnlyMovieTreeFixture(basis),
        before = JSON.stringify(p),
        sampler = api.createReadOnlyMovieTreeFrameSampler(p, requests);
      const point = (frame: number, age: number) => {
        const t = (frame - 2) / 8,
          r = (t * Math.PI) / 2,
          x = 9 + ((1 + age) % 3) * 10,
          y = 5,
          a = basis === 'reflected' ? -2 : basis === 'affine' ? 2 : 1,
          b = basis === 'plain' ? 0 : 0.25,
          c = basis === 'plain' ? 0 : 0.5,
          d = basis === 'plain' ? 1 : 3,
          u = a * x + c * y,
          v = b * x + d * y;
        return {
          x: Math.floor(160 + 20 * t + Math.cos(r) * u - Math.sin(r) * v),
          y: Math.floor(100 + 40 * t + Math.sin(r) * u + Math.cos(r) * v),
        };
      };
      const read = (canvas: HTMLCanvasElement, at: { x: number; y: number }) =>
        Array.from(canvas.getContext('2d')!.getImageData(at.x, at.y, 1, 1).data);
      const png = [];
      for (const frame of [2, 3, 4, 6, 8, 9, 10]) {
        const view = sampler.sample(frame),
          blob = await api.exportPNGFrame(view, frame),
          image = await createImageBitmap(blob),
          canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 240;
        canvas.getContext('2d')!.drawImage(image, 0, 0);
        image.close();
        png.push(read(canvas, point(frame, frame - 2)));
      }
      const view = sampler.sample(6),
        viewBefore = JSON.stringify(view),
        session = api.createLiveMovieSession(view, 6),
        paint = api.createLiveMoviePainter(view, session, () => {}),
        canvas = document.createElement('canvas'),
        movie = [];
      session.current();
      for (let tick = 1; tick <= 11; tick++) {
        const phase = session.advance(false);
        await paint.prepare(phase, () => {});
        paint.publish(canvas, phase);
        movie.push({ frame: phase.frame, tick: phase.tick, pixel: read(canvas, point(6, tick)) });
      }
      paint.dispose();
      session.dispose();
      sampler.dispose();
      return {
        png,
        movie,
        unchanged: before === JSON.stringify(p) && viewBefore === JSON.stringify(view),
        script: (globalThis as unknown as { __treeScriptRan?: boolean }).__treeScriptRan ?? false,
      };
    }, basis);
    expect(result.unchanged).toBe(true);
    expect(result.script).toBe(false);
    expect(errors).toEqual([]);
    for (const pixel of result.png) expect(pixel).toEqual([255, 0, 0, 255]);
    expect(result.movie).toHaveLength(11);
    for (const row of result.movie) {
      expect(row.frame).toBe(6);
      expect(row.pixel).toEqual([255, 0, 0, 255]);
    }
  });

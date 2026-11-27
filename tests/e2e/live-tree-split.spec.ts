import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../live-tree-split-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-tree-split-fixture.ts',
        formats: ['iife'],
        name: 'TreeSplit',
        fileName: () => 'split.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one tree split fixture');
  code = chunks[0].code;
});
for (const basis of ['plain', 'affine', 'reflected'])
  for (const bridge of [undefined, 'loop', 'once', 'single'] as const)
    test(`nested split ${basis}/${bridge ?? 'direct'} preserves independent PNG/Test Movie world pixels`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/');
      await page.addScriptTag({ content: code });
      const result = await page.evaluate(
        async ({ basis, bridge }) => {
          const api = (window as unknown as { TreeSplit: API }).TreeSplit,
            p = api.treeSplitFixture(basis, bridge),
            before = JSON.stringify(p),
            layer = api.splitLiveMovieTreeMotionLayer(
              p,
              p.layers[0],
              p.layers[0].liveMotionSpans![0],
              6,
              'right',
            ),
            out = { ...p, layers: [layer] },
            saved = JSON.stringify(out);
          const visible = (age: number) => {
            const parent = (1 + age) % 5,
              local =
                bridge === 'single' ? 0 : bridge === 'once' ? Math.min(parent, 3) : parent % 4;
            return bridge === undefined || local !== 2;
          };
          const childAge = (age: number) => {
            let birth = 0,
              was = false;
            for (let i = 0; i <= age; i++) {
              const next = visible(i);
              if (next && !was) birth = i;
              was = next;
            }
            return age - birth;
          };
          const point = (frame: number, age: number) => {
            const t = Math.min((frame - 2) / 8, 1),
              r = (t * Math.PI) / 2,
              x = ((1 + childAge(age)) % 3) * 10 + 2,
              y = 2,
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
          const correct = (canvas: HTMLCanvasElement, frame: number, age: number) => {
            const ctx = canvas.getContext('2d')!,
              at = point(frame, age);
            if (visible(age))
              return (
                Array.from(ctx.getImageData(at.x, at.y, 1, 1).data).join(',') === '255,0,0,255'
              );
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i] > 150 && pixels[i + 1] < 80 && pixels[i + 2] < 80 && pixels[i + 3])
                return false;
            return true;
          };
          const png: boolean[][] = [];
          for (const frame of [2, 3, 4, 6, 8, 9, 10, 11]) {
            const pair: boolean[] = [];
            for (const project of [p, out]) {
              const blob = await api.exportPNGFrame(project, frame),
                image = await createImageBitmap(blob),
                canvas = document.createElement('canvas');
              canvas.width = 400;
              canvas.height = 240;
              canvas.getContext('2d')!.drawImage(image, 0, 0);
              image.close();
              pair.push(correct(canvas, frame, frame - 2));
            }
            png.push(pair);
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
                correct: correct(canvas, phase.frame, tick - 2),
              });
            }
            paint.dispose();
            session.dispose();
            movie.push(rows);
          }
          return {
            png,
            movie,
            unchanged: before === JSON.stringify(p) && saved === JSON.stringify(out),
            keys: layer.keys.map((k) => k.frame),
            halves: layer.liveMotionSpans!.map((s) => [s.id, s.start, s.end, s.symbolContinuity]),
            iframes: document.querySelectorAll('iframe').length,
          };
        },
        { basis, bridge },
      );
      expect(errors).toEqual([]);
      expect(result.unchanged).toBe(true);
      expect(result.keys).toEqual([0, 2, 6, 10, 12]);
      expect(result.halves).toEqual([
        ['live', 2, 6, 'movie-trees'],
        ['right', 6, 10, 'movie-trees'],
      ]);
      expect(result.iframes).toBe(0);
      for (const pair of result.png) expect(pair).toEqual([true, true]);
      expect(result.movie[1]).toEqual(result.movie[0]);
      for (const rows of result.movie) for (const row of rows) expect(row.correct).toBe(true);
      expect(result.movie[0].find((r) => r.tick === 7)?.frame).toBe(6);
    });

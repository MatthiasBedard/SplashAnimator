import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../movie-pose-clock-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/movie-pose-clock-fixture.ts',
        formats: ['iife'],
        name: 'MoviePose',
        fileName: () => 'movie-pose.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one movie pose fixture.');
  code = chunks[0].code;
});

for (const basis of ['plain', 'affine', 'reflected'])
  test(`detached moving ${basis} movie poses retain original stage/PNG lifetime pixels`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const rows = await page.evaluate(async (basis) => {
      const api = (window as unknown as { MoviePose: API }).MoviePose,
        p = api.moviePoseFixture(),
        before = JSON.stringify(p),
        clock = api.captureMoviePoseClock(() => ({ project: p, revision: 0 })),
        rows = [];
      for (const frame of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11]) {
        const view = await api.prepareLiveMotionFrameCapture(
            () => ({ project: p, revision: 0 }),
            frame,
          ),
          layer = view.layers[1],
          held = layer.keys.filter((k) => k.frame <= frame).at(-1)!;
        const x = basis === 'reflected' ? 300 - frame * 5 : 100 + frame * 5,
          a = basis === 'reflected' ? -1 : 1,
          b = basis === 'plain' ? 0 : 0.25,
          c = basis === 'plain' ? 0 : 0.25;
        layer.keys = layer.keys.filter((k) => k.frame !== frame);
        layer.keys.push({
          frame,
          shapes: held.shapes.map((s) => ({
            ...s,
            x,
            transform: [a, b, c, 1],
          })),
        });
        layer.keys.sort((a, b) => a.frame - b.frame);
        const pose = clock.capture(view),
          time = clock.replay(pose, frame),
          canvas = document.createElement('canvas');
        canvas.width = p.width;
        canvas.height = p.height;
        const stage = new api.CanvasStage(canvas);
        stage.render(pose.project, frame, time.frames);
        const actual = canvas.getContext('2d')!.getImageData(0, 0, p.width, p.height).data;
        const png = await api.exportPNGFrame(pose.project, frame),
          image = await createImageBitmap(png),
          output = document.createElement('canvas');
        output.width = p.width;
        output.height = p.height;
        const ctx = output.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        image.close();
        const encoded = ctx.getImageData(0, 0, p.width, p.height).data,
          blank = frame === 6 || frame === 7,
          birth = frame < 6 ? 1 : 8,
          age = frame - birth,
          localX = [0, 20, 40, 60, 120][(2 + age) % 5] + 5,
          px = Math.floor(x + a * localX + c * 5),
          py = Math.floor(80 + b * localX + 5),
          at = (px: number, py: number) =>
            Array.from(actual.slice((py * p.width + px) * 4, (py * p.width + px) * 4 + 4));
        rows.push({
          frame,
          same: actual.every((v, i) => v === encoded[i]),
          frames: time.frames,
          origins: time.origins,
          pixel: blank ? at(200, 85) : at(px, py),
          unchanged: before === JSON.stringify(p),
          blank,
          age,
          birth,
        });
        stage.destroy();
      }
      clock.dispose();
      return rows;
    }, basis);
    expect(errors).toEqual([]);
    for (const row of rows) {
      expect(row.same).toBe(true);
      expect(row.unchanged).toBe(true);
      expect(row.frames).toEqual(row.blank ? {} : { 'graphic/instance/child': row.age });
      expect(row.origins).toEqual(row.blank ? {} : { 'graphic/instance/child': row.birth / 10 });
      expect(row.pixel).toEqual(row.blank ? [255, 255, 255, 255] : [0, 0, 255, 255]);
    }
  });

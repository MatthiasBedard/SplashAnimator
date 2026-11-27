import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../live-movie-trees-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-movie-trees-fixture.ts',
        formats: ['iife'],
        name: 'LiveTrees',
        fileName: () => 'trees.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one persisted tree fixture');
  code = chunks[0].code;
});
for (const basis of ['plain', 'affine', 'reflected'])
  for (const mode of ['loop', 'once', 'single'] as const)
    test(`saved ${basis}/${mode} nested tween retains graphic blanks, reentry and paused child clocks`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/');
      await page.addScriptTag({ content: code });
      const result = await page.evaluate(
        async ({ basis, mode }) => {
          const api = (window as unknown as { LiveTrees: API }).LiveTrees,
            p = api.liveMovieTreesFixture(basis, mode),
            before = JSON.stringify(p);
          const visible = (age: number) => {
            const parent = (4 + age) % 5,
              local = mode === 'single' ? 0 : mode === 'once' ? Math.min(parent, 3) : parent % 4;
            return local !== 2;
          };
          const childAge = (age: number) => {
            let birth = 0,
              previous = false;
            for (let i = 0; i <= age; i++) {
              const next = visible(i);
              if (next && !previous) birth = i;
              previous = next;
            }
            return age - birth;
          };
          const point = (frame: number, age: number) => {
            const t = Math.min((frame - 2) / 8, 1),
              r = (t * Math.PI) / 2,
              x = 9 + ((1 + childAge(age)) % 3) * 10,
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
          const read = (canvas: HTMLCanvasElement, frame: number, age: number) => {
            const ctx = canvas.getContext('2d')!,
              at = point(frame, age);
            if (visible(age))
              return (
                Array.from(ctx.getImageData(at.x, at.y, 1, 1).data).join(',') === '255,0,0,255'
              );
            const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < bytes.length; i += 4)
              if (bytes[i] > 150 && bytes[i + 1] < 80 && bytes[i + 2] < 80 && bytes[i + 3])
                return false;
            return true;
          };
          const png = [];
          for (let frame = 2; frame <= 11; frame++) {
            const view = await api.prepareLiveMotionFrameCapture(
                () => ({ project: p, revision: 0 }),
                frame,
              ),
              blob = await api.exportPNGFrame(view, frame),
              image = await createImageBitmap(blob),
              canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 240;
            canvas.getContext('2d')!.drawImage(image, 0, 0);
            image.close();
            png.push({
              frame,
              visible: visible(frame - 2),
              correct: read(canvas, frame, frame - 2),
            });
          }
          const session = api.createLiveMovieSession(p, 6),
            paint = api.createLiveMoviePainter(p, session, () => {}),
            canvas = document.createElement('canvas'),
            movie = [];
          session.current();
          for (let tick = 1; tick <= 16; tick++) {
            const phase = session.advance(false);
            await paint.prepare(phase, () => {});
            paint.publish(canvas, phase);
            movie.push({
              tick,
              frame: phase.frame,
              visible: visible(tick),
              correct: read(canvas, 6, tick),
            });
          }
          paint.dispose();
          session.dispose();
          return {
            png,
            movie,
            unchanged: before === JSON.stringify(p),
            script:
              (globalThis as unknown as { __treeScriptRan?: boolean }).__treeScriptRan ?? false,
          };
        },
        { basis, mode },
      );
      expect(errors).toEqual([]);
      expect(result.unchanged).toBe(true);
      expect(result.script).toBe(false);
      expect(result.png).toHaveLength(10);
      expect(result.png.every((r) => r.correct)).toBe(true);
      expect(result.movie).toHaveLength(16);
      expect(result.movie.every((r) => r.correct && r.frame === 6)).toBe(true);
      if (mode !== 'single') {
        expect(result.png.some((r) => !r.visible)).toBe(true);
        expect(result.movie.some((r) => !r.visible)).toBe(true);
      }
    });

test('ordinary movie edit inclusion and insertion cannot authorize the separate nested marker', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/');
  await page.addScriptTag({ content: code });
  const source = await page.evaluate(() =>
    (window as unknown as { LiveTrees: API }).LiveTrees.liveMovieTreesFixture('plain', 'single'),
  );
  await page.evaluate(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    source,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Insert live movie tween key…', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Edit live tween…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit live tween', exact: true });
  await expect(dialog.getByRole('checkbox', { name: /^Edit live tween / })).toBeDisabled();
  await dialog.getByLabel('Include movie live tweens').check();
  await expect(dialog.getByRole('checkbox', { name: /^Edit live tween / })).toBeDisabled();
  await dialog.getByLabel('Include nested movie live tweens').check();
  await expect(dialog.getByRole('checkbox', { name: /^Edit live tween / })).toBeEnabled();
});

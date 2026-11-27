import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { liveMovieFixture, createLiveMovies } from '../live-movies-fixture';
type API = typeof import('../live-movies-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-movies-fixture.ts',
        formats: ['iife'],
        name: 'LiveMovies',
        fileName: () => 'live-movies.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one live movies fixture.');
  code = chunks[0].code;
});

for (const first of [0, 1, 9998])
  for (const basis of ['plain', 'affine', 'reflected'])
    test(`movie recipe first${first}/${basis} retains native stage, fresh PNG and paused Test Movie clocks`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/');
      await page.addScriptTag({ content: code });
      const result = await page.evaluate(
        async ({ first, basis }) => {
          const api = (window as unknown as { LiveMovies: API }).LiveMovies,
            { p, span } = api.liveMovieFixture(first, basis);
          p.width = 400;
          p.height = 240;
          p.fps = 10;
          for (const key of p.layers[0].keys)
            for (const s of key.shapes) {
              s.x = key.frame === 2 ? 160 : 180;
              s.y += 70;
            }
          p.frameScripts = [
            { frame: 3, source: "throw new Error('movie scripts must stay inert')" },
          ];
          const before = JSON.stringify(p),
            out = api.createLiveMovies(p, span),
            stored = JSON.stringify(out),
            rows = [];
          const pixelPoint = (frame: number, age: number) => {
            const phase = (Math.min(first, 4) + age) % 5,
              t = Math.min((frame - 2) / 8, 1),
              r = (t * Math.PI) / 2,
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
          const pixel = (canvas: HTMLCanvasElement, point: { x: number; y: number }) =>
            Array.from(canvas.getContext('2d')!.getImageData(point.x, point.y, 1, 1).data);
          const clocks = api.captureMoviePoseClock(() => ({ project: out, revision: 0 }));
          for (const frame of [2, 3, 6, 9, 10, 11]) {
            const view = await api.prepareLiveMotionFrameCapture(
                () => ({ project: out, revision: 0 }),
                frame,
              ),
              pose = clocks.capture(view),
              time = clocks.replay(pose, frame),
              canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 240;
            const renderer = new api.CanvasStage(canvas);
            renderer.render(pose.project, frame, time.frames);
            const blob = await api.exportPNGFrame(out, frame),
              image = await createImageBitmap(blob),
              png = document.createElement('canvas');
            png.width = 400;
            png.height = 240;
            png.getContext('2d')!.drawImage(image, 0, 0);
            image.close();
            const pt = pixelPoint(frame, frame - 2);
            rows.push({
              stage: pixel(canvas, pt),
              png: pixel(png, pt),
              age: time.frames['track/instance/graphic'],
              frame,
              origins: time.origins,
            });
            if (frame === 6) {
              const again = await api.exportPNGFrame(JSON.parse(stored), frame),
                a = new Uint8Array(await blob.arrayBuffer()),
                b = new Uint8Array(await again.arrayBuffer());
              if (a.length !== b.length || a.some((v, i) => v !== b[i]))
                throw Error('Reopened PNG bytes changed.');
            }
            renderer.destroy();
          }
          const session = api.createLiveMovieSession(out, 0),
            painter = api.createLiveMoviePainter(out, session, () => {}),
            canvas = document.createElement('canvas'),
            movie = [];
          let phase = session.current();
          for (let tick = 1; tick <= 12; tick++) {
            phase = session.advance(tick !== 7);
            if (phase.frame < 2 || phase.frame > 11) continue;
            await painter.prepare(phase, () => {});
            painter.publish(canvas, phase);
            movie.push({
              frame: phase.frame,
              tick: phase.tick,
              pixel: pixel(canvas, pixelPoint(phase.frame, phase.tick - 2)),
            });
            if (session.current() !== phase) throw Error('Retry advanced a movie clock.');
          }
          painter.dispose();
          session.dispose();
          clocks.dispose();
          return {
            rows,
            movie,
            unchanged: before === JSON.stringify(p) && stored === JSON.stringify(out),
            keys: out.layers[0].keys,
            original: p.layers[0].keys,
            marker: out.layers[0].liveMotionSpans![0].symbolContinuity,
            iframes: document.querySelectorAll('iframe').length,
          };
        },
        { first, basis },
      );
      expect(errors).toEqual([]);
      expect(result.unchanged).toBe(true);
      expect(result.keys).toEqual(result.original);
      expect(result.marker).toBe('movies');
      expect(result.iframes).toBe(0);
      for (const row of result.rows) {
        expect(row.stage).toEqual([255, 0, 0, 255]);
        expect(row.png).toEqual([255, 0, 0, 255]);
        expect(row.age).toBe(row.frame - 2);
        expect(row.origins).toEqual({ 'track/instance/graphic': 0.2 });
      }
      for (const row of result.movie) expect(row.pixel).toEqual([255, 0, 0, 255]);
      expect(result.movie.find((r) => r.tick === 7)?.frame).toBe(6);
    });

for (const basis of ['plain', 'reflected'])
  test(`main stopped ${basis} movie recipe paints sampled placement and excludes existing edit scopes`, async ({
    page,
  }) => {
    const { p, span } = liveMovieFixture(1, basis);
    p.width = 400;
    p.height = 240;
    p.fps = 10;
    p.layers[0].name = 'Movie';
    for (const key of p.layers[0].keys)
      for (const s of key.shapes) s.x = key.frame === 2 ? 160 : 180;
    const out = createLiveMovies(p, span);
    await page.setViewportSize({ width: 1500, height: 1100 });
    await page.addInitScript(
      (p) =>
        localStorage.setItem(
          'splash-recovery-v1',
          JSON.stringify({ project: p, folder: null, manifest: null }),
        ),
      out,
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1');
    await page.getByTitle('First frame', { exact: true }).click();
    await page.getByLabel('Timeline frames', { exact: true }).focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await expect(page.getByLabel('Live stage status', { exact: true })).toContainText('read-only');
    // Stopped authoring stage retains the ordinary movie first-frame pose; Test
    // Movie and fresh PNG above independently run their own movie clocks.
    const a = basis === 'reflected' ? -2 : 1,
      b = basis === 'plain' ? 0 : 0.25,
      c = basis === 'plain' ? 0 : 0.5,
      d = basis === 'plain' ? 1 : 3,
      r = Math.PI / 4,
      u = a * 12 + c * 2,
      v = b * 12 + d * 2,
      x = 170 + Math.cos(r) * u - Math.sin(r) * v,
      y = 50 + Math.sin(r) * u + Math.cos(r) * v;
    await expect
      .poll(() =>
        page.getByLabel('Drawing stage', { exact: true }).evaluate(
          (e, { x, y }) => {
            const c = e as HTMLCanvasElement,
              d = devicePixelRatio;
            return Array.from(
              c
                .getContext('2d')!
                .getImageData(c.width / 2 + (x - 200) * d, c.height / 2 + (y - 120) * d, 1, 1).data,
            );
          },
          { x, y },
        ),
      )
      .toEqual([255, 0, 0, 255]);
    await page.getByRole('button', { name: 'Control', exact: true }).click();
    await page.getByRole('button', { name: 'Edit live tween…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit live tween', exact: true }),
      row = dialog.getByLabel('Edit live tween Movie frames 3–11', { exact: true });
    await expect(row).toBeDisabled();
    await dialog.getByLabel('Include graphic live tweens').check();
    await dialog.getByLabel('Include complete group live tweens').check();
    await expect(row).toBeDisabled();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project),
    ).toEqual(out);
  });

test('unsupported saved movie graph stays noninteractive and metadata-only removal is exactly undoable', async ({
  page,
}) => {
  const { p, span } = liveMovieFixture(),
    out = createLiveMovies(p, span);
  out.symbols![0].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'splash-recovery-v1',
        JSON.stringify({ project: p, folder: null, manifest: null }),
      ),
    out,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Recover changes', exact: true }).click();
  await page.getByTitle('First frame', { exact: true }).click();
  await page.getByLabel('Timeline frames', { exact: true }).focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Live stage status', { exact: true })).toContainText('button');
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('splash-recovery-v1')!).project);
  expect(await read()).toEqual(out);
  const stage = page.getByLabel('Drawing stage', { exact: true }),
    box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await read()).toEqual(out);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('button', { name: 'Remove live tween…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove live tween', exact: true });
  await dialog.getByRole('button', { name: 'Remove live tween', exact: true }).click();
  await expect(dialog).toBeHidden();
  const recovered = await read();
  expect(recovered.layers[0].liveMotionSpans).toBeUndefined();
  expect(recovered.layers[0].keys).toEqual(out.layers[0].keys);
  expect(recovered.symbols).toEqual(out.symbols);
  await page.getByTitle('First frame', { exact: true }).click();
  await stage.focus();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(out);
  await stage.focus();
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(recovered);
});

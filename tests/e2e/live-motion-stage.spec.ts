import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../live-motion-stage-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-motion-stage-fixture.ts',
        formats: ['iife'],
        name: 'LiveStage',
        fileName: () => 'stage.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one live stage fixture');
  code = chunks[0].code;
});
for (const mode of ['graphic', 'movie', 'button', 'bitmap', 'text'])
  test(`reusable stage ${mode} native pixels retain current pose and original outside clocks`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (mode) => {
      const api = (window as unknown as { LiveStage: API }).LiveStage,
        p = api.livePresentationFixture(mode);
      if (mode === 'bitmap') {
        const c = document.createElement('canvas');
        c.width = 2;
        c.height = 2;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(0, 0, 2, 2);
        p.assets = [
          {
            id: 'green',
            path: 'assets/bitmaps/green.json',
            bitmap: { name: 'Green', width: 2, height: 2, dataUrl: c.toDataURL() },
          },
        ];
        for (const k of p.layers[0].keys.filter((k) => k.shapes.length)) {
          k.shapes[0].bitmap = { assetId: 'green', x: 0, y: 0, width: 20, height: 20 };
        }
      }
      if (mode === 'text')
        for (const k of p.layers[0].keys.filter((k) => k.shapes.length)) {
          const s = k.shapes[0];
          s.kind = 'text';
          s.text = {
            content: 'A',
            font: 'sans-serif',
            size: 18,
            bold: false,
            italic: false,
            align: 'left',
          };
        }
      const before = JSON.stringify(p),
        view = api.captureLiveMotionStage(() => ({ project: p, revision: 0 })),
        poses = [];
      for (const frame of [0, 1, 2, 3, 4, 7, 8]) {
        const f = view.sample(frame),
          reference = await api.prepareLiveMotionFrameCapture(
            () => ({ project: p, revision: 0 }),
            frame,
          ),
          images: Uint8ClampedArray[] = [];
        for (const project of [f.project, reference]) {
          const bitmap = await createImageBitmap(await api.exportPNGFrame(project, frame)),
            c = document.createElement('canvas');
          c.width = 160;
          c.height = 80;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          images.push(ctx.getImageData(0, 0, 160, 80).data);
        }
        view.assertFrame(f, frame);
        let changed = 0,
          ink = 0,
          rootInk = 0;
        for (let i = 0; i < images[0].length; i += 4) {
          if (images[0][i] < 250 || images[0][i + 1] < 250 || images[0][i + 2] < 250) ink++;
          if (
            i < 160 * 40 * 4 &&
            (images[0][i] < 250 || images[0][i + 1] < 250 || images[0][i + 2] < 250)
          )
            rootInk++;
          for (let k = 0; k < 4; k++) if (images[0][i + k] !== images[1][i + k]) changed++;
        }
        const point = (x: number, y: number) =>
          Array.from(images[0].slice((y * 160 + x) * 4, (y * 160 + x) * 4 + 4));
        poses.push({
          frame,
          changed,
          ink,
          rootInk,
          root: point(frame <= 4 ? frame * 20 + 5 : 85, 5),
          child: point(mode === 'movie' || mode === 'button' ? 65 : 25, 45),
        });
      }
      view.dispose();
      return {
        poses,
        unchanged: JSON.stringify(p) === before,
        keys: p.layers[0].keys.map((k) => k.frame),
        iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
      };
    }, mode);
    expect(result.unchanged).toBe(true);
    expect(result.keys).toEqual([0, 4, 8]);
    expect(result.iframes).toBe(0);
    for (const pose of result.poses) {
      expect(pose.changed).toBe(0);
      if (pose.frame < 8) expect(pose.rootInk).toBeGreaterThan(mode === 'text' ? 20 : 100);
    }
    if (mode !== 'text')
      expect(result.poses.find((p) => p.frame === 2)!.root).toEqual(
        mode === 'bitmap' ? [0, 255, 0, 255] : [255, 0, 0, 255],
      );
    expect(result.poses.find((p) => p.frame === 2)!.child).toEqual([0, 0, 255, 255]);
  });
for (const action of ['source', 'frame', 'dispose', 'public'] as const)
  test(`complete native output rejects late ${action} at private stage publication`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (action) => {
      const api = (window as unknown as { LiveStage: API }).LiveStage,
        p = api.livePresentationFixture(),
        view = api.captureLiveMotionStage(() => ({ project: p, revision: 0 })),
        f = view.sample(2),
        blob = await api.exportPNGFrame(f.project, 2);
      if (action === 'source') p.layers[0].keys[1].shapes[0].x++;
      if (action === 'frame') {
        view.sample(3);
        view.sample(2);
      }
      if (action === 'dispose') view.dispose();
      if (action === 'public') f.project.layers[0].keys[1].shapes[0].x++;
      let rejected = false;
      try {
        view.assertFrame(f, 2);
      } catch {
        rejected = true;
      }
      view.dispose();
      return {
        rejected,
        size: blob.size,
        iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
        keys: p.layers[0].keys.map((k) => k.frame),
      };
    }, action);
    expect(result.rejected).toBe(true);
    expect(result.size).toBeGreaterThan(100);
    expect(result.iframes).toBe(0);
    expect(result.keys).toEqual([0, 4, 8]);
  });

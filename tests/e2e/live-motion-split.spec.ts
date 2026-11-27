import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../live-motion-split-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-motion-split-fixture.ts',
        formats: ['iife'],
        name: 'LiveSplit',
        fileName: () => 'split.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one sparse split test bundle');
  code = chunks[0].code;
});
for (const mode of ['plain', 'channels', 'compound', 'path'])
  test(`native PNG ${mode} integer poses survive private sparse splitting`, async ({ page }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (mode) => {
      const api = (window as unknown as { LiveSplit: API }).LiveSplit;
      const p = api.liveSplitFixture((p, s) => {
          if (mode === 'channels') {
            s.ease = 'in';
            s.opacityEase = 'out';
            s.paintEase = 'linear';
            s.options = { paint: true };
            p.layers[0].keys[0].shapes[0].fill = '#000000';
            p.layers[0].keys[0].shapes[0].opacity = 0.5;
            p.layers[0].keys[1].shapes[0].fill = '#808080';
          }
          if (mode === 'compound') {
            s.options = { nodes: true, affine: true };
            for (const k of p.layers[0].keys.slice(0, 2))
              Object.assign(k.shapes[0], {
                kind: 'polygon',
                fillRule: 'evenodd',
                transform: [-1, 0, 0.25, 1],
                contours: [
                  [
                    { x: 0, y: 0 },
                    { x: 20, y: 0 },
                    { x: 20, y: 20 },
                    { x: 0, y: 20 },
                  ],
                  [
                    { x: 5, y: 5 },
                    { x: 10, y: 5 },
                    { x: 8, y: 10 },
                  ],
                ],
              });
            for (const k of p.layers[0].keys.slice(0, 2)) k.shapes[0].x += 25;
          }
          if (mode === 'path') s.path = { startX: 24, startY: 32, endX: -24, endY: 32 };
        }),
        before = JSON.stringify(p),
        owner = api.captureLiveMotionAuthoringFrame(() => ({ project: p, revision: 0, frame: 4 })),
        out = api.prepareSplitLiveMotionSpans([
          { owner: owner.resolve('track', 'art'), rightSpanId: 'right' },
        ]);
      owner.dispose();
      const poses = [];
      for (const f of [1, 4, 6, 8]) {
        const images = [];
        for (const project of [p, out]) {
          const view = await api.prepareLiveMotionFrameCapture(() => ({ project, revision: 0 }), f),
            bitmap = await createImageBitmap(await api.exportPNGFrame(view, f)),
            c = document.createElement('canvas');
          c.width = 160;
          c.height = 100;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          images.push(ctx.getImageData(0, 0, 160, 100).data);
        }
        let changed = 0,
          ink = 0;
        for (let i = 0; i < images[0].length; i += 4) {
          if (images[0][i] < 250 || images[0][i + 1] < 250 || images[0][i + 2] < 250) ink++;
          for (let k = 0; k < 4; k++) if (images[0][i + k] !== images[1][i + k]) changed++;
        }
        poses.push({ changed, ink });
      }
      return {
        poses,
        unchanged: JSON.stringify(p) === before,
        keys: out.layers[0].keys.map((k) => k.frame),
        frames: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
      };
    }, mode);
    expect(result.unchanged).toBe(true);
    expect(result.keys).toEqual([0, 4, 8, 10]);
    expect(result.frames).toBe(0);
    for (const pose of result.poses) {
      expect(pose.ink).toBeGreaterThan(100);
      expect(pose.changed).toBe(0);
    }
  });

import { test, expect, type Page } from '@playwright/test';
import { newProject, type Vector } from '../../packages/document/src';
import { createBasicMotionSpan } from '../../packages/animation/src/motion-spans';
async function prepare(page: Page) {
  const { build } = await import('vite');
  const bundle = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'apps/editor/src/export-mp4.ts',
        formats: ['es'],
        fileName: () => 'project-mp4.js',
      },
      rollupOptions: { output: { assetFileNames: '[name][extname]' } },
    },
  });
  for (const b of Array.isArray(bundle) ? bundle : [bundle])
    if ('output' in b)
      for (const o of b.output)
        await page.route('**/' + o.fileName, (r) =>
          r.fulfill({
            contentType: 'text/javascript',
            body:
              o.type === 'chunk'
                ? o.code
                : typeof o.source === 'string'
                  ? o.source
                  : Buffer.from(o.source),
          }),
        );
  await page.goto('/');
}
function fixture(remembered = false) {
  const p = newProject();
  p.width = p.height = 32;
  p.duration = remembered ? 3 : 4;
  p.fps = 20;
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  if (remembered) {
    const ink = { ...art, id: 'ink', width: 8, height: 8, fill: '#0000ff' };
    p.layers[0].keys = [
      { frame: 0, shapes: [ink] },
      { frame: 2, shapes: [{ ...ink, x: 16 }] },
    ];
    createBasicMotionSpan(p, [p.layers[0].id], 0, 2, 'linear');
    p.layers[0].keys[2].shapes[0].x = 32;
    p.symbols = [
      {
        id: 'child',
        name: 'Child',
        width: 32,
        height: 32,
        shapes: structuredClone(p.layers[0].keys[0].shapes),
        timeline: {
          duration: 3,
          keys: structuredClone(p.layers[0].keys.slice(1)),
          motionSpans: structuredClone(p.layers[0].motionSpans),
        },
      },
    ];
    p.layers.push({
      id: 'movies',
      name: 'Movies',
      visible: true,
      locked: false,
      keys: [
        {
          frame: 0,
          shapes: [
            {
              ...art,
              id: 'movie',
              kind: 'symbol',
              symbolId: 'child',
              y: 16,
              symbolPlayback: { mode: 'movie', firstFrame: 0 },
            },
          ],
        },
      ],
    });
  } else {
    p.symbols = [
      {
        id: 'child',
        name: 'Child',
        width: 32,
        height: 32,
        shapes: [art],
        timeline: {
          duration: 3,
          keys: [
            { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
            { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
          ],
        },
      },
    ];
    p.symbols.push({
      id: 'parent',
      name: 'Parent',
      width: 32,
      height: 32,
      shapes: [
        {
          ...art,
          id: 'inner',
          kind: 'symbol',
          symbolId: 'child',
          symbolPlayback: { mode: 'movie', firstFrame: 0 },
        },
      ],
    });
    p.layers[0].keys = [
      {
        frame: 0,
        shapes: [
          {
            ...art,
            id: 'outer',
            kind: 'symbol',
            symbolId: 'parent',
            symbolPlayback: { mode: 'loop', firstFrame: 0 },
          },
        ],
      },
    ];
  }
  const up = { ...art, id: 'up', width: 8, height: 8, fill: '#ffff00' };
  p.symbols!.push({
    id: 'button',
    name: 'Button',
    width: 8,
    height: 8,
    shapes: [up],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...up, fill: '#ff00ff' }] }] },
    buttonStates: { up: 0, over: 1, down: 1, hit: 1 },
  });
  p.layers.push({
    id: 'buttons',
    name: 'Buttons',
    visible: true,
    locked: false,
    keys: [
      {
        frame: 0,
        shapes: [
          {
            ...up,
            id: 'button-instance',
            kind: 'symbol',
            symbolId: 'button',
            x: 24,
            y: 24,
            symbolPlayback: { mode: 'single', firstFrame: 1 },
          },
        ],
      },
    ],
  });
  p.frameScripts = [{ frame: 0, source: 'throw Error("MP4 export scripts must stay inert");' }];
  return p;
}
for (const mode of ['full', 'selected', 'remembered'] as const)
  test(`detached project MP4 ${mode} preserves integer nested clocks, button Up and source`, async ({
    page,
  }) => {
    await prepare(page);
    const p = fixture(mode === 'remembered');
    let downloads = 0;
    page.on('download', () => downloads++);
    const result = await page.evaluate(
      async ({ project, mode }) => {
        const path = '/project-mp4.js',
          { exportProjectMp4 } = (await import(
            path
          )) as typeof import('../../apps/editor/src/export-mp4');
        const before = JSON.stringify(project),
          recovery = localStorage.getItem('splash-recovery-v1'),
          progress: number[] = [],
          range =
            mode === 'selected'
              ? { start: 1, end: 2 }
              : mode === 'remembered'
                ? { start: 1, end: 1 }
                : undefined;
        const result = await exportProjectMp4(project, new AbortController().signal, {
          range,
          remembered: mode === 'remembered',
          keyFrameInterval: 2,
          progress: (done) => {
            progress.push(done);
            if (range) {
              range.start = 0;
              range.end = 0;
            }
          },
        });
        const video = document.createElement('video');
        video.muted = true;
        document.body.append(video);
        const url = URL.createObjectURL(
          new Blob([Uint8Array.from(result.bytes).buffer], { type: 'video/mp4' }),
        );
        const wait = (name: string) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                clean();
                reject(Error('project MP4 ' + name + ' timeout'));
              }, 5000),
              ok = () => {
                clean();
                resolve();
              },
              bad = () => {
                clean();
                reject(Error(video.error?.message ?? 'project MP4 error'));
              },
              clean = () => {
                clearTimeout(timer);
                video.removeEventListener(name, ok);
                video.removeEventListener('error', bad);
              };
            video.addEventListener(name, ok);
            video.addEventListener('error', bad);
          });
        const colors: number[][] = [],
          buttons: number[][] = [],
          root: number[][] = [],
          child: number[][] = [],
          old: number[][] = [];
        let duration = 0;
        try {
          const ready = wait('loadeddata');
          video.src = url;
          await ready;
          duration = video.duration;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 32;
          const x = canvas.getContext('2d')!;
          for (const time of mode === 'full'
            ? [0.01, 0.06, 0.11, 0.16]
            : mode === 'selected'
              ? [0.01, 0.06, 0.01]
              : [0.01]) {
            const seeking = wait('seeked');
            video.currentTime = time;
            await seeking;
            x.drawImage(video, 0, 0);
            colors.push(Array.from(x.getImageData(16, 16, 1, 1).data));
            buttons.push(Array.from(x.getImageData(28, 28, 1, 1).data));
            root.push(Array.from(x.getImageData(20, 4, 1, 1).data));
            child.push(Array.from(x.getImageData(20, 20, 1, 1).data));
            old.push(Array.from(x.getImageData(10, 4, 1, 1).data));
          }
        } finally {
          video.removeAttribute('src');
          video.load();
          video.remove();
          URL.revokeObjectURL(url);
        }
        return {
          colors,
          buttons,
          root,
          child,
          old,
          duration,
          progress,
          start: result.start,
          end: result.end,
          count: result.frameCount,
          remembered: result.remembered,
          source: JSON.stringify(project) === before,
          recovery: localStorage.getItem('splash-recovery-v1') === recovery,
          hosts: document.querySelectorAll('iframe[title="Detached frame replay"]').length,
        };
      },
      { project: p, mode },
    );
    expect(result.source).toBe(true);
    expect(result.recovery).toBe(true);
    expect(result.hosts).toBe(0);
    expect(downloads).toBe(0);
    expect([result.start, result.end]).toEqual(
      mode === 'selected' ? [1, 2] : mode === 'remembered' ? [1, 1] : [0, 3],
    );
    expect(result.progress).toEqual(
      mode === 'selected' ? [1, 2] : mode === 'remembered' ? [1] : [1, 2, 3, 4],
    );
    expect(result.duration).toBeCloseTo(result.count / 20, 5);
    expect(result.remembered).toBe(mode === 'remembered');
    for (const color of result.buttons) {
      expect(color[0]).toBeGreaterThan(220);
      expect(color[1]).toBeGreaterThan(220);
      expect(color[2]).toBeLessThan(30);
    }
    if (mode === 'remembered') {
      for (const colors of [result.root, result.child]) expect(colors[0][2]).toBeGreaterThan(220);
      expect(result.old[0][0]).toBeGreaterThan(230);
      expect(result.old[0][1]).toBeGreaterThan(230);
    } else
      for (const [i, c] of mode === 'selected'
        ? [
            [0, 1],
            [1, 2],
            [2, 1],
          ]
        : [
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 0],
          ]) {
        expect(result.colors[i][c]).toBeGreaterThan(220);
        for (const other of [0, 1, 2].filter((n) => n !== c))
          expect(result.colors[i][other]).toBeLessThan(30);
      }
  });
test('project MP4 native source/cancel failures close replay and encoder before a fresh retry', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async (project) => {
    const path = '/project-mp4.js',
      { exportProjectMp4 } = (await import(
        path
      )) as typeof import('../../apps/editor/src/export-mp4');
    const Native = VideoEncoder,
      encoders: VideoEncoder[] = [];
    globalThis.VideoEncoder = class extends Native {
      constructor(init: VideoEncoderInit) {
        super(init);
        encoders.push(this);
      }
    };
    const before = JSON.stringify(project),
      errors: string[] = [];
    try {
      let valid = true;
      try {
        await exportProjectMp4(project, new AbortController().signal, {
          validate() {
            if (!valid) throw Error('source changed');
          },
          progress(done) {
            if (done === 2) valid = false;
          },
        });
      } catch (error) {
        errors.push(String(error));
      }
      const c = new AbortController();
      try {
        await exportProjectMp4(project, c.signal, {
          progress(done) {
            if (done === 2) c.abort(Error('capture cancelled'));
          },
        });
      } catch (error) {
        errors.push(String(error));
      }
      const retry = await exportProjectMp4(project, new AbortController().signal);
      return {
        errors,
        count: retry.frameCount,
        states: encoders.map((e) => e.state),
        hosts: document.querySelectorAll('iframe[title="Detached frame replay"]').length,
        source: JSON.stringify(project) === before,
      };
    } finally {
      globalThis.VideoEncoder = Native;
    }
  }, fixture());
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toContain('source changed');
  expect(result.errors[1]).toContain('capture cancelled');
  expect(result.count).toBe(4);
  expect(result.states).toEqual(['closed', 'closed', 'closed']);
  expect(result.hosts).toBe(0);
  expect(result.source).toBe(true);
});
for (const gate of ['bitmap', 'font'] as const)
  test(`project MP4 waits for real ${gate} readiness and cleans deadline failures`, async ({
    page,
  }) => {
    await page.addInitScript((gate) => {
      if (window === window.top) return;
      const held = () => Boolean(Reflect.get(window.parent, 'holdMp4Ready'));
      if (gate === 'bitmap') {
        const Native = window.Image;
        window.Image = class extends Native {
          set src(value: string) {
            if (held()) {
              Reflect.set(window.parent, 'mp4ReadyGateSeen', true);
              return;
            }
            super.src = value;
          }
          get src() {
            return super.src;
          }
        };
      } else {
        const original = document.fonts.ready;
        Object.defineProperty(document.fonts, 'ready', {
          get() {
            if (held()) {
              Reflect.set(window.parent, 'mp4ReadyGateSeen', true);
              return new Promise(() => {});
            }
            return original;
          },
        });
      }
    }, gate);
    await prepare(page);
    const result = await page.evaluate(async () => {
      const path = '/project-mp4.js',
        { exportProjectMp4 } = (await import(
          path
        )) as typeof import('../../apps/editor/src/export-mp4');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const x = canvas.getContext('2d')!;
      x.fillStyle = '#00ff00';
      x.fillRect(0, 0, 2, 2);
      const project = {
        id: 'ready',
        name: 'Ready',
        schemaVersion: 59,
        width: 32,
        height: 32,
        fps: 20,
        duration: 1,
        background: '#ffffff',
        assets: [
          {
            id: 'bitmap',
            path: 'assets/bitmaps/a.json',
            bitmap: { name: 'Green', width: 2, height: 2, dataUrl: canvas.toDataURL() },
          },
        ],
        layers: [
          {
            id: 'layer',
            name: 'Layer',
            visible: true,
            locked: false,
            keys: [
              {
                frame: 0,
                shapes: [
                  {
                    id: 'paint',
                    kind: 'rectangle',
                    x: 0,
                    y: 0,
                    width: 32,
                    height: 32,
                    rotation: 0,
                    fill: '#ffffff',
                    stroke: '#000000',
                    strokeWidth: 0,
                    points: [],
                    bitmap: { assetId: 'bitmap', x: 0, y: 0, width: 32, height: 32 },
                  },
                ],
              },
            ],
          },
        ],
      } as import('../../packages/document/src').Project;
      Reflect.set(window, 'holdMp4Ready', true);
      let error = '';
      try {
        await exportProjectMp4(project, new AbortController().signal, { timeoutMs: 200 });
      } catch (e) {
        error = String(e);
      }
      const failedHosts = document.querySelectorAll('iframe[title="Detached frame replay"]').length,
        seen = Reflect.get(window, 'mp4ReadyGateSeen');
      Reflect.set(window, 'holdMp4Ready', false);
      let pixel: number[] = [];
      const retry = await exportProjectMp4(project, new AbortController().signal, {
        progress() {
          const frame = document.querySelector(
            'iframe[title="Detached frame replay"]',
          ) as HTMLIFrameElement;
          const c = frame.contentDocument!.querySelector('canvas')!;
          pixel = Array.from(c.getContext('2d')!.getImageData(16, 16, 1, 1).data);
        },
      });
      return {
        error,
        seen,
        failedHosts,
        pixel,
        count: retry.frameCount,
        hosts: document.querySelectorAll('iframe[title="Detached frame replay"]').length,
      };
    });
    expect(result.seen).toBe(true);
    expect(result.error).toContain('timed out');
    expect(result.failedHosts).toBe(0);
    expect(result.hosts).toBe(0);
    expect(result.count).toBe(1);
    expect(result.pixel).toEqual([0, 255, 0, 255]);
  });

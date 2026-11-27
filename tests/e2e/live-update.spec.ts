import { test, expect } from '@playwright/test';
import { build } from 'vite';
type API = typeof import('../live-motion-update-fixture');
let code: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: 'tests/live-motion-update-fixture.ts',
        formats: ['iife'],
        name: 'LiveUpdate',
        fileName: () => 'update.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((o) => o.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one live update bundle');
  code = chunks[0].code;
});
for (const mode of ['in', 'out', 'custom', 'paint'])
  test(`updated ${mode} recipe drives native root/movie pixels without changing keys or library`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (mode) => {
      const api = (window as unknown as { LiveUpdate: API }).LiveUpdate,
        p = api.livePresentationFixture('movie');
      if (mode === 'paint') {
        p.layers[0].keys[0].shapes[0].fill = '#000000';
        p.layers[0].keys[1].shapes[0].fill = '#808080';
      }
      const before = JSON.stringify(p),
        ease =
          mode === 'custom'
            ? { kind: 'cubic' as const, x1: 0, y1: 0, x2: 1, y2: 0 }
            : mode === 'paint'
              ? ('linear' as const)
              : (mode as 'in' | 'out');
      const out = api.prepareUpdateLiveMotionSpans(p, [
        {
          layerId: 'live',
          spanId: 'span',
          changes: { ease, ...(mode === 'paint' ? { options: { paint: true } } : {}) },
        },
      ]);
      const stored = JSON.stringify(out),
        view = api.captureLiveMotionStage(() => ({ project: out, revision: 0 })),
        frame = view.sample(2);
      const direct = await api.exportPNGFrame(out, 2),
        detached = await api.exportPNGFrame(frame.project, 2);
      const a = new Uint8Array(await direct.arrayBuffer()),
        b = new Uint8Array(await detached.arrayBuffer());
      view.assertFrame(frame, 2);
      view.dispose();
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 80;
      const ctx = canvas.getContext('2d')!,
        bitmap = await createImageBitmap(direct);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const px = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data],
        x = mode === 'in' ? 25 : mode === 'out' ? 65 : mode === 'custom' ? 15 : 45;
      const root = px(x, 5),
        child = px(65, 45),
        old = px(mode === 'paint' ? 5 : 45, 5);
      const unchanged = JSON.stringify(p) === before && JSON.stringify(out) === stored;
      // A later authored endpoint edit must change live output immediately, without Refresh.
      out.layers[0].keys[1].shapes[0].x = 120;
      const updated = await api.exportPNGFrame(out, 2),
        later = await createImageBitmap(updated);
      ctx.clearRect(0, 0, 160, 80);
      ctx.drawImage(later, 0, 0);
      later.close();
      const moved = px(mode === 'in' ? 35 : mode === 'out' ? 95 : mode === 'custom' ? 20 : 65, 5);
      return {
        root,
        child,
        old,
        moved,
        unchanged,
        byteEqual: a.length === b.length && a.every((v, i) => v === b[i]),
        keys: out.layers[0].keys.map((k) => k.frame),
        library: JSON.stringify(p.symbols) === JSON.stringify(out.symbols),
        iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
      };
    }, mode);
    const color = mode === 'paint' ? [64, 64, 64, 255] : [255, 0, 0, 255];
    expect(result.root).toEqual(color);
    expect(result.moved).toEqual(color);
    expect(result.child).toEqual([0, 0, 255, 255]);
    expect(result.old).toEqual([255, 255, 255, 255]);
    expect(result.unchanged).toBe(true);
    expect(result.byteEqual).toBe(true);
    expect(result.library).toBe(true);
    expect(result.keys).toEqual([0, 4, 8]);
    expect(result.iframes).toBe(0);
    expect(errors).toEqual([]);
  });

for (const mode of ['opacity', 'paint', 'both', 'clear'])
  test(`channel-updated ${mode} retains independent native geometry, alpha, color and movie clocks`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (mode) => {
      const api = (window as unknown as { LiveUpdate: API }).LiveUpdate,
        p = api.livePresentationFixture('movie');
      Object.assign(p.layers[0].keys[0].shapes[0], { opacity: 0.2, fill: '#000000' });
      Object.assign(p.layers[0].keys[1].shapes[0], { opacity: 1, fill: '#808080' });
      Object.assign(p.layers[0].liveMotionSpans![0], {
        ease: 'in',
        options: { paint: true },
        opacityEase: 'linear',
        paintEase: 'linear',
      });
      const before = JSON.stringify(p),
        changes: Parameters<API['prepareUpdateLiveMotionSpans']>[1][number]['changes'] = {};
      if (mode === 'opacity' || mode === 'both') changes.opacityEase = 'out';
      if (mode === 'paint' || mode === 'both')
        changes.paintEase = { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: 0 };
      if (mode === 'clear') {
        changes.opacityEase = undefined;
        changes.paintEase = undefined;
      }
      const out = api.prepareUpdateLiveMotionSpans(p, [
          { layerId: 'live', spanId: 'span', changes },
        ]),
        stored = JSON.stringify(out),
        view = api.captureLiveMotionStage(() => ({ project: out, revision: 0 })),
        frame = view.sample(2);
      const blob = await api.exportPNGFrame(out, 2, undefined, true),
        detached = await api.exportPNGFrame(frame.project, 2, undefined, true),
        a = new Uint8Array(await blob.arrayBuffer()),
        b = new Uint8Array(await detached.arrayBuffer());
      view.assertFrame(frame, 2);
      view.dispose();
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 80;
      const ctx = canvas.getContext('2d')!,
        bitmap = await createImageBitmap(blob);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data],
        root = pixel(25, 5),
        outside = pixel(45, 5),
        child = pixel(65, 45);
      const unchanged = JSON.stringify(p) === before && JSON.stringify(out) === stored,
        keysExact = JSON.stringify(p.layers[0].keys) === JSON.stringify(out.layers[0].keys),
        settings = JSON.stringify(out.layers[0].liveMotionSpans![0]);
      Object.assign(out.layers[0].keys[1].shapes[0], { x: 120, opacity: 0.6, fill: '#404040' });
      const later = await createImageBitmap(await api.exportPNGFrame(out, 2, undefined, true));
      ctx.clearRect(0, 0, 160, 80);
      ctx.drawImage(later, 0, 0);
      later.close();
      return {
        root,
        outside,
        child,
        moved: pixel(35, 5),
        unchanged,
        keysExact,
        settings,
        byteEqual: a.length === b.length && a.every((v, i) => v === b[i]),
        library: JSON.stringify(p.symbols) === JSON.stringify(out.symbols),
        keys: out.layers[0].keys.map((k) => k.frame),
        iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
      };
    }, mode);
    const color = mode === 'opacity' ? 64 : mode === 'clear' ? 32 : 16,
      alpha = mode === 'opacity' || mode === 'both' ? 204 : mode === 'clear' ? 102 : 153;
    // Native premultiplied byte round trips can differ by one channel/alpha unit.
    for (const c of result.root.slice(0, 3)) expect(Math.abs(c - color)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.root[3] - alpha)).toBeLessThanOrEqual(1);
    const movedColor = mode === 'opacity' ? 32 : mode === 'clear' ? 16 : 8,
      movedAlpha = mode === 'opacity' || mode === 'both' ? 127.5 : mode === 'clear' ? 76.5 : 102;
    for (const c of result.moved.slice(0, 3))
      expect(Math.abs(c - movedColor)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.moved[3] - movedAlpha)).toBeLessThanOrEqual(1);
    expect(result.outside).toEqual([0, 0, 0, 0]);
    expect(result.child).toEqual([0, 0, 255, 255]);
    expect(result.byteEqual).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.keysExact).toBe(true);
    expect(result.library).toBe(true);
    expect(result.keys).toEqual([0, 4, 8]);
    expect(result.iframes).toBe(0);
    const span = JSON.parse(result.settings);
    expect(span.ease).toBe('in');
    expect(span.options).toEqual({ paint: true });
    if (mode === 'clear') {
      expect(Object.hasOwn(span, 'opacityEase')).toBe(false);
      expect(Object.hasOwn(span, 'paintEase')).toBe(false);
    }
    expect(errors).toEqual([]);
  });

for (const mode of ['cubic', 'waypoint', 'distance', 'clear'])
  test(`trajectory-updated ${mode} paints analytic native root and stored movie poses without changing keys`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(async (mode) => {
      const api = (window as unknown as { LiveUpdate: API }).LiveUpdate,
        p = api.livePresentationFixture('movie'),
        arch = { startX: 0, startY: 40, endX: 0, endY: 40 };
      if (mode === 'clear') p.layers[0].liveMotionSpans![0].path = { ...arch };
      const path =
        mode === 'clear'
          ? undefined
          : mode === 'cubic'
            ? arch
            : {
                startX: 0,
                startY: 0,
                endX: 0,
                endY: 0,
                waypoints: [{ x: 0, y: 40 }],
                ...(mode === 'distance' ? { distance: true } : {}),
              };
      const before = JSON.stringify(p),
        out = api.prepareUpdateLiveMotionSpans(p, [
          { layerId: 'live', spanId: 'span', changes: { path } },
        ]),
        stored = JSON.stringify(out),
        view = api.captureLiveMotionStage(() => ({ project: out, revision: 0 })),
        frame = view.sample(2);
      const blob = await api.exportPNGFrame(out, 2),
        detached = await api.exportPNGFrame(frame.project, 2),
        a = new Uint8Array(await blob.arrayBuffer()),
        b = new Uint8Array(await detached.arrayBuffer());
      view.assertFrame(frame, 2);
      view.dispose();
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 80;
      const ctx = c.getContext('2d')!,
        bitmap = await createImageBitmap(blob);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const ratio = (40 + Math.sqrt(80 ** 2 + 40 ** 2)) / 2 - 40,
        along = ratio / Math.sqrt(80 ** 2 + 40 ** 2);
      const x =
          mode === 'cubic' || mode === 'clear'
            ? 45
            : mode === 'waypoint'
              ? 5
              : Math.floor(80 * along) + 5,
        y =
          mode === 'cubic'
            ? 35
            : mode === 'clear'
              ? 5
              : mode === 'waypoint'
                ? 45
                : Math.floor(40 - 40 * along) + 5;
      const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
      return {
        root: pixel(x, y),
        child: pixel(65, 45),
        old: pixel(45, mode === 'clear' ? 35 : 5),
        unchanged: JSON.stringify(p) === before && JSON.stringify(out) === stored,
        keysExact: JSON.stringify(p.layers[0].keys) === JSON.stringify(out.layers[0].keys),
        library: JSON.stringify(p.symbols) === JSON.stringify(out.symbols),
        byteEqual: a.length === b.length && a.every((v, i) => v === b[i]),
        keys: out.layers[0].keys.map((k) => k.frame),
        path: out.layers[0].liveMotionSpans![0].path,
        iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
      };
    }, mode);
    expect(result.root).toEqual([255, 0, 0, 255]);
    expect(result.child).toEqual([0, 0, 255, 255]);
    expect(result.old).toEqual([255, 255, 255, 255]);
    expect(result.unchanged).toBe(true);
    expect(result.keysExact).toBe(true);
    expect(result.library).toBe(true);
    expect(result.byteEqual).toBe(true);
    expect(result.keys).toEqual([0, 4, 8]);
    expect(result.iframes).toBe(0);
    if (mode === 'clear') expect(result.path).toBeUndefined();
    expect(errors).toEqual([]);
  });

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
        name: 'LiveRotationUpdate',
        fileName: () => 'rotation.js',
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((r) => ('output' in r ? r.output : []))
    .filter((c) => c.type === 'chunk');
  if (chunks.length !== 1) throw Error('Expected one rotation update bundle');
  code = chunks[0].code;
});
for (const [mode, basis] of [
  ['rigid', 'plain'],
  ['rigid', 'affine'],
  ['rigid', 'reflected'],
  ['shear', 'reflected'],
] as const)
  test(`compiled ${mode} ${basis} rotation update renders exact native group pixels and detached PNG output`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate(
      async ({ mode, basis }) => {
        const api = (window as unknown as { LiveRotationUpdate: API }).LiveRotationUpdate,
          f = api.liveRotationFixture(mode, basis);
        for (const key of f.p.layers[0].keys)
          for (const shape of key.shapes) {
            shape.y += 80;
            if (shape.id === 'b') shape.fill = '#0000ff';
          }
        const before = JSON.stringify(f.p),
          rotation = {
            ...f.p.layers[0].liveMotionSpans![0].rotation!,
            direction: 'clockwise' as const,
            turns: 1,
          },
          request = { layerId: 'track', spanId: 'live', changes: { rotation } },
          input = JSON.stringify(request),
          out = api.prepareUpdateLiveMotionSpans(f.p, [request]),
          stored = JSON.stringify(out);
        const blob = await api.exportPNGFrame(out, 4),
          bitmap = await createImageBitmap(blob),
          canvas = document.createElement('canvas');
        canvas.width = f.p.width;
        canvas.height = f.p.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const hm = [(1 + f.h[0]) / 2, f.h[1] / 2, f.h[2] / 2, (1 + f.h[3]) / 2],
          local = { x: f.b[0] * 6 + f.b[2] * 5, y: f.b[1] * 6 + f.b[3] * 5 };
        const point = (offset: number, angle: number) => {
          const u = hm[0] * (offset + local.x) + hm[2] * local.y,
            v = hm[1] * (offset + local.x) + hm[3] * local.y,
            r = (angle * Math.PI) / 180;
          return {
            x: 40 + Math.cos(r) * u - Math.sin(r) * v,
            y: 100 + Math.sin(r) * u + Math.cos(r) * v,
          };
        };
        const pixel = (p: { x: number; y: number }) =>
            Array.from(ctx.getImageData(p.x, p.y, 1, 1).data),
          red = pixel(point(0, 225)),
          blue = pixel(point(40, 225)),
          old = pixel(point(40, 45));
        const reopened = JSON.parse(JSON.stringify(out)),
          again = await api.exportPNGFrame(reopened, 4),
          a = new Uint8Array(await blob.arrayBuffer()),
          b = new Uint8Array(await again.arrayBuffer());
        return {
          red,
          blue,
          old,
          unchanged:
            JSON.stringify(f.p) === before &&
            JSON.stringify(request) === input &&
            JSON.stringify(out) === stored,
          keys: out.layers[0].keys.map((k) => k.frame),
          library: JSON.stringify(out.symbols) === JSON.stringify(f.p.symbols),
          header: out.layers[0].liveMotionSpans![0].rotation,
          byteEqual: a.length === b.length && a.every((v, i) => v === b[i]),
          iframes: document.querySelectorAll('iframe[title="PNG frame renderer"]').length,
        };
      },
      { mode, basis },
    );
    expect(result.red).toEqual([255, 64, 64, 255]);
    expect(result.blue).toEqual([64, 64, 255, 255]);
    expect(result.old).toEqual([255, 255, 255, 255]);
    expect(result.unchanged).toBe(true);
    expect(result.library).toBe(true);
    expect(result.keys).toEqual([0, 8, 10]);
    expect(result.header).toEqual({
      direction: 'clockwise',
      turns: 1,
      rigidGroups: true,
      ...(mode === 'shear' ? { axisGroupScale: true, axisGroupShear: true } : {}),
    });
    expect(result.byteEqual).toBe(true);
    expect(result.iframes).toBe(0);
    expect(errors).toEqual([]);
  });
for (const mode of ['getter', 'scope'] as const)
  test(`compiled rotation ${mode} rejects atomically and a fresh header remains admissible`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.addScriptTag({ content: code });
    const result = await page.evaluate((mode) => {
      const api = (window as unknown as { LiveRotationUpdate: API }).LiveRotationUpdate,
        f = api.liveRotationFixture(),
        before = JSON.stringify(f.p),
        clone = structuredClone;
      let reads = 0,
        clones = 0,
        rejected = false;
      const rotation = { direction: 'clockwise' as const, turns: 1, rigidGroups: true };
      if (mode === 'getter')
        Object.defineProperty(rotation, 'turns', {
          enumerable: true,
          get() {
            reads++;
            return 1;
          },
        });
      window.structuredClone = <T>(value: T) => {
        clones++;
        return clone(value);
      };
      try {
        api.prepareUpdateLiveMotionSpans(f.p, [
          {
            layerId: 'track',
            spanId: 'live',
            changes: { rotation: mode === 'scope' ? undefined : rotation },
          },
        ]);
      } catch {
        rejected = true;
      } finally {
        window.structuredClone = clone;
      }
      const out = api.prepareUpdateLiveMotionSpans(f.p, [
        {
          layerId: 'track',
          spanId: 'live',
          changes: { rotation: { direction: 'clockwise', turns: 1, rigidGroups: true } },
        },
      ]);
      return {
        rejected,
        reads,
        clones,
        unchanged: JSON.stringify(f.p) === before,
        turns: out.layers[0].liveMotionSpans![0].rotation!.turns,
      };
    }, mode);
    expect(result.rejected).toBe(true);
    expect(result.reads).toBe(0);
    if (mode === 'getter') expect(result.clones).toBe(0);
    expect(result.unchanged).toBe(true);
    expect(result.turns).toBe(1);
  });

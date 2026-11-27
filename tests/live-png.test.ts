import { afterEach, expect, it, vi } from 'vitest';
import { prepareLivePNGFrame } from '../apps/editor/src/live-png';
import {
  exportPNGFrame,
  exportPNGSequence,
  exportPNGSequenceToSink,
  exportPNGSheet,
} from '../apps/editor/src/export-png';
import { exportHTML, exportPresentationHTML } from '../packages/export-web/src';
import { livePresentationFixture } from './live-motion-presentation-fixture';
import { liveSplitFixture } from './live-motion-split-fixture';
afterEach(() => vi.restoreAllMocks());

it.each(['graphic', 'movie', 'button'])(
  'prepares one live pose without rewriting %s exposure origins, library or scripts',
  async (mode) => {
    const p = livePresentationFixture(mode),
      before = structuredClone(p),
      capture = await prepareLivePNGFrame(p, 2, 1),
      out = capture.project;
    expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 4, 8]);
    expect(out.layers[0].keys[1].shapes[0].x).toBe(40);
    expect(out.layers[1]).toEqual(p.layers[1]);
    expect(out.symbols).toEqual(p.symbols);
    expect(out.frameScripts).toEqual(p.frameScripts);
    expect(out.layers.every((l) => l.liveMotionSpans === undefined)).toBe(true);
    expect(p).toEqual(before);
    capture.check();
  },
);
it.each([0, 4, 7, 8])(
  'keeps exact authored endpoint/hold/blank metadata at frame %s',
  async (frame) => {
    const p = livePresentationFixture(),
      capture = await prepareLivePNGFrame(p, frame, 1);
    expect(capture.project.layers[0].keys).toEqual(p.layers[0].keys);
    capture.check();
  },
);
it.each(['hidden', 'locked'])('retains %s semantics and exact outside artwork', async (mode) => {
  const p = livePresentationFixture();
  if (mode === 'hidden') p.layers[0].visible = false;
  else p.layers[0].locked = true;
  const c = await prepareLivePNGFrame(p, 2, 1);
  expect(c.project.layers[0].keys.map((k) => k.frame)).toEqual(
    mode === 'hidden' ? [0, 4, 8] : [0, 2, 4, 8],
  );
  expect(c.project.layers[0].visible).toBe(p.layers[0].visible);
  expect(c.project.layers[0].locked).toBe(p.layers[0].locked);
});
it('rejects changed original data permanently even after restoration', async () => {
  const p = liveSplitFixture(),
    c = await prepareLivePNGFrame(p, 2, 1);
  p.layers[0].keys[0].shapes[0].x++;
  expect(() => c.check()).toThrow();
  p.layers[0].keys[0].shapes[0].x--;
  expect(() => c.check()).toThrow();
});
it('rejects public render mutation without touching original data', async () => {
  const p = liveSplitFixture(),
    before = structuredClone(p),
    c = await prepareLivePNGFrame(p, 2, 1);
  c.project.layers[0].keys[1].shapes[0].x++;
  expect(() => c.check()).toThrow();
  expect(p).toEqual(before);
});
it('retains full all-track numeric rejection without partial output or source writes', async () => {
  const p = liveSplitFixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  p.layers[1].liveMotionSpans![0].path = { startX: 0, startY: 50000000, endX: 0, endY: -50000000 };
  const before = structuredClone(p);
  await expect(prepareLivePNGFrame(p, 2, 1)).rejects.toThrow();
  expect(p).toEqual(before);
});
it.each([-1, 0.5, 12, NaN, Infinity])(
  'rejects raw requested frame %s before native allocation',
  async (frame) => {
    await expect(prepareLivePNGFrame(liveSplitFixture(), frame, 1)).rejects.toThrow(
      'Choose a frame',
    );
  },
);
it.each([0, -1, NaN, Infinity, 1e300])(
  'rejects raw scale %s before geometry reconstruction',
  async (scale) => {
    await expect(prepareLivePNGFrame(liveSplitFixture(), 2, scale)).rejects.toThrow();
  },
);
it('admits existing raster bounds before reconstructing incompatible geometry', async () => {
  const p = liveSplitFixture();
  p.width = p.height = 8192;
  p.layers[0].keys[1].shapes[0].kind = 'ellipse';
  await expect(prepareLivePNGFrame(p, 2, 2)).rejects.toThrow('PNG output exceeds');
});
it.each([NaN, Infinity, -Infinity])(
  'rejects original nonfinite value %s without JSON normalization',
  async (value) => {
    const p = liveSplitFixture();
    p.layers[0].keys[0].shapes[0].x = value;
    await expect(prepareLivePNGFrame(p, 2, 1)).rejects.toThrow('finite');
    await expect(exportPNGFrame(p, 2)).rejects.toThrow('finite');
  },
);
it('does not read original geometry accessors', async () => {
  const p = liveSplitFixture();
  let reads = 0;
  Object.defineProperty(p.layers[0].keys[0].shapes[0], 'x', {
    enumerable: true,
    get() {
      reads++;
      return 8;
    },
  });
  await expect(prepareLivePNGFrame(p, 2, 1)).rejects.toThrow();
  await expect(exportPNGFrame(p, 2)).rejects.toThrow();
  expect(reads).toBe(0);
});
it('snapshots validators once and rejects getter-time source changes', async () => {
  const p = liveSplitFixture();
  let reads = 0;
  const c = await prepareLivePNGFrame(p, 2, 1, {
    get validate() {
      reads++;
      return () => {};
    },
  });
  c.check();
  expect(reads).toBe(1);
  await expect(
    prepareLivePNGFrame(p, 2, 1, {
      get validate() {
        p.layers[0].keys[0].shapes[0].x++;
        return () => {};
      },
    }),
  ).rejects.toThrow('source changed');
});
it('rejects asynchronous and swallowed reentrant final admission', async () => {
  await expect(
    prepareLivePNGFrame(liveSplitFixture(), 2, 1, { validate: async () => {} }),
  ).rejects.toThrow('synchronous');
  let armed = false;
  const c = await prepareLivePNGFrame(liveSplitFixture(), 2, 1, {
    validate() {
      if (armed) {
        try {
          c.check();
        } catch {
          /* outer check must reject */
        }
      }
    },
  });
  armed = true;
  expect(() => c.check()).toThrow();
});
it('keeps cancellation live through final prepared-output admission', async () => {
  const ctrl = new AbortController(),
    c = await prepareLivePNGFrame(liveSplitFixture(), 2, 1, { signal: ctrl.signal });
  ctrl.abort();
  expect(() => c.check()).toThrow();
});
it('rejects clone corruption instead of rendering a modified pose', async () => {
  const p = liveSplitFixture(),
    clone = structuredClone;
  let changed = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const output = clone(value, options);
    if (!changed && value && typeof value === 'object' && 'frame' in value && value.frame === 2) {
      changed = true;
      (output as { shapes: { x: number }[] }).shapes[0].x++;
    }
    return output;
  });
  await expect(prepareLivePNGFrame(p, 2, 1)).rejects.toThrow();
  expect(changed).toBe(true);
});
it.each([2, 'sequence'] as const)(
  'rejects unevaluated raster capture %s before compiling a held pose',
  (frame) => {
    const p = liveSplitFixture(),
      before = structuredClone(p);
    expect(() => exportHTML(p, frame)).toThrow('evaluated single-frame PNG');
    expect(p).toEqual(before);
    expect(() => exportPresentationHTML(p, [{ frame: 0, tick: 0 }])).toThrow(
      'evaluated single-frame PNG',
    );
  },
);
it('rejects malformed original live range artwork before allocating a renderer or writing a sink', async () => {
  const p = liveSplitFixture();
  p.layers[0].keys[0].shapes[0].x = NaN;
  let writes = 0;
  await expect(exportPNGSequence(p)).rejects.toThrow('Invalid project');
  await expect(exportPNGSheet(p)).rejects.toThrow('Invalid project');
  await expect(
    exportPNGSequenceToSink(p, async () => {
      writes++;
    }),
  ).rejects.toThrow('Invalid project');
  expect(writes).toBe(0);
  expect(p.layers[0].keys[0].shapes[0].x).toBeNaN();
});

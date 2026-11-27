import { afterEach, expect, it, vi } from 'vitest';
import type { Vector } from '../packages/document/src';
import {
  SelectionRasterCache,
  selectionRasterBounds,
  selectionRasterRuns,
  type SelectionRasterPart,
} from '../packages/stage/src/selection-raster';
import { MASK_WORKING_PIXELS } from '../packages/stage/src/mask-budget';
import { selectionSymbolRasterBounds } from '../packages/stage/src/symbol-mask-painter';
const shape: Vector = {
  id: 'ink',
  kind: 'bezier',
  x: 50,
  y: 20,
  width: 10,
  height: 10,
  rotation: 0,
  points: [],
  nodes: [
    { x: 0, y: 0, out: { x: 200, y: -80 } },
    { x: 10, y: 10, in: { x: -100, y: 160 } },
  ],
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 8,
  strokeJoin: 'miter',
};
afterEach(() => vi.unstubAllGlobals());
it('batches alternating merge artwork in stable order and keeps junction edits separate', () => {
  const roots = Array.from({ length: 4000 }, (_, id) => ({ ...shape, id: String(id) }));
  const moving = roots.filter((_, i) => i % 2 === 0);
  const fixed = roots.filter((_, i) => i % 2 === 1);
  const chosen = new Set(moving.map(root => root.id));
  const runs = selectionRasterRuns(roots, chosen, undefined, true);
  expect(runs.map(run => run.roots)).toEqual([fixed, moving]);
  const junctions = selectionRasterRuns(roots, chosen, new Set(['3']), true);
  expect(junctions.map(run => [run.moving, run.junction, run.roots.length])).toEqual([
    [false, false, 1], [false, true, 1], [false, false, 1998], [true, false, 2000],
  ]);
  const originalOrder = selectionRasterRuns(roots, chosen, undefined, false);
  expect(originalOrder.flatMap(run => run.roots)).toEqual(roots);
});
function fixture() {
  const canvases: { width: number; height: number }[] = [];
  const context = () => ({
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    transform: vi.fn(),
  });
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = { width: 0, height: 0, getContext: () => context() };
      canvases.push(canvas);
      return canvas;
    },
  });
  const paint = vi.fn(),
    part: SelectionRasterPart = {
      moving: true,
      bounds: { left: -5, top: -5, right: 20, bottom: 20 },
      paint,
    };
  return {
    canvases,
    paint,
    part,
    target: context() as unknown as CanvasRenderingContext2D,
    cache: new SelectionRasterCache(),
  };
}
it('bounds actual cubic control hulls and miter overhang outside the authoring box', () => {
  const b = selectionRasterBounds([shape], 2)!;
  expect(b.left).toBeLessThanOrEqual(-68);
  expect(b.right).toBeGreaterThanOrEqual(268);
  expect(b.top).toBeLessThanOrEqual(-78);
  expect(b.bottom).toBeGreaterThanOrEqual(198);
});
it('handles reflected/sheared control hulls and declines glyph/symbol box guesses', () => {
  const transformed = {
    ...shape,
    transform: [-1, 0.2, 0.5, 1] as [number, number, number, number],
  };
  const before = structuredClone(transformed),
    b = selectionRasterBounds([transformed], 2)!;
  expect(b.left).toBeLessThan(-190);
  expect(b.right).toBeGreaterThan(220);
  expect(transformed).toEqual(before);
  expect(selectionRasterBounds([{ ...shape, kind: 'text' }], 2)).toBeNull();
  expect(selectionRasterBounds([{ ...shape, kind: 'symbol' }], 2)).toBeNull();
  expect(selectionRasterBounds([], 2)).toBeNull();
});
it('rasterizes each layer/run once and reuses bitmaps through many affine movements', () => {
  const f = fixture();
  f.cache.prepare(new Map([['layer', [f.part, { ...f.part, moving: false }]]]), {
    scale: 2,
    x: 3,
    y: 7,
    reservedPixels: 0,
  });
  expect(f.paint).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 100; i++) f.cache.paintLayer(f.target, 'layer', [1, 0.1, 0.2, 1, i, 2 * i]);
  expect(f.paint).toHaveBeenCalledTimes(2);
  expect(f.target.drawImage).toHaveBeenCalledTimes(200);
  expect(f.target.transform).toHaveBeenCalledTimes(100);
  f.cache.clear();
  expect(f.canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
});

it('includes nested symbol blur halos and declines backdrop-dependent items', () => {
  const child = { ...shape, kind: 'rectangle' as const, strokeWidth: 0 };
  const inner = {
    kind: 'masked-symbol' as const, opacity: 1, blurRadius: 4, masks: [],
    layers: [{ id: 'inside', visible: true, items: [child] }],
  };
  const outer = { ...inner, blurRadius: 6, layers: [{ id: 'outside', visible: true, items: [inner] }] };
  expect(selectionSymbolRasterBounds([outer], 2)).toEqual({
    left: 34, top: 4, right: 76, bottom: 46,
  });
  expect(selectionSymbolRasterBounds([{ ...outer, blendMode: 'multiply' }], 2)).toBeNull();
});

it('falls back to original vector painting if a composite exceeds its scratch budget', () => {
  const f = fixture();
  const paint = vi.fn()
    .mockImplementationOnce(() => { throw Error('Mask working rasters exceed the shared 64-megapixel budget.'); });
  f.cache.prepare(new Map([['layer', [{ ...f.part, composite: true, paint }]]]),
    { scale: 1, x: 0, y: 0, reservedPixels: 128 });
  expect(f.canvases[0]).toMatchObject({ width: 0, height: 0 });
  f.cache.paintLayer(f.target, 'layer', [1, 0, 0, 1, 10, 0]);
  expect(paint).toHaveBeenCalledTimes(2);
  expect(f.target.drawImage).not.toHaveBeenCalled();
});

it('passes the full pose to live stroke paint and keeps the filled part cached', () => {
  const f = fixture(), paintPose = vi.fn();
  f.cache.prepare(new Map([['layer', [f.part, { ...f.part, paintPose }]]]), {
    scale: 1, x: 0, y: 0, reservedPixels: 0,
  });
  expect(f.canvases).toHaveLength(1);
  const operation: [number, number, number, number, number, number] = [1, 0, 2, 1, 8, 0];
  f.cache.paintLayer(f.target, 'layer', operation);
  expect(paintPose).toHaveBeenCalledWith(f.target, operation);
  expect(f.target.transform).toHaveBeenCalledTimes(1);
  expect(f.target.drawImage).toHaveBeenCalledTimes(1);
});
it('shares the pixel budget across layers and outlines and falls back without dropping artwork', () => {
  const f = fixture();
  f.cache.prepare(
    new Map([
      ['a', [f.part]],
      ['b', [f.part]],
    ]),
    { scale: 1, x: 0, y: 0, reservedPixels: MASK_WORKING_PIXELS - 625 },
    f.part,
  );
  expect(f.canvases).toHaveLength(1);
  f.cache.paintLayer(f.target, 'a', [1, 0, 0, 1, 0, 0]);
  f.cache.paintLayer(f.target, 'b', [1, 0, 0, 1, 0, 0]);
  f.cache.paintOutline(f.target, [1, 0, 0, 1, 0, 0]);
  expect(f.paint).toHaveBeenCalledTimes(3);
  expect(f.target.drawImage).toHaveBeenCalledTimes(1);
});
it.each([
  null,
  { left: 0, top: 0, right: 20000, bottom: 1 },
  { left: 0, top: 0, right: Infinity, bottom: 1 },
])('replays an unsupported or oversized part exactly: %s', (bounds) => {
  const f = fixture();
  f.cache.prepare(new Map([['a', [{ ...f.part, bounds }]]]), {
    scale: 1,
    x: 0,
    y: 0,
    reservedPixels: 0,
  });
  f.cache.paintLayer(f.target, 'a', [1, 0, 0, 1, 5, 0]);
  expect(f.paint).toHaveBeenCalledTimes(1);
  expect(f.canvases).toHaveLength(0);
});
it('never retains a partially painted cache after preparation throws', () => {
  const f = fixture();
  expect(() =>
    f.cache.prepare(
      new Map([
        [
          'a',
          [
            f.part,
            {
              ...f.part,
              paint: () => {
                throw Error('paint failed');
              },
            },
          ],
        ],
      ]),
      { scale: 1, x: 0, y: 0, reservedPixels: 0 },
    ),
  ).toThrow('paint failed');
  expect(f.canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  f.cache.paintLayer(f.target, 'a', [1, 0, 0, 1, 0, 0]);
  expect(f.target.drawImage).not.toHaveBeenCalled();
});

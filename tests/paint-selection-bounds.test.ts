import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { Vector, Point } from '../packages/document/src';
import { selectPaintRegion, clipPaint, clipOutsidePaintWithSourceCounts, deletePaintRegion, prepareEditorPaintSelection } from '../packages/geometry/src/clip-paint';
import { paintRegionBounds } from '../packages/geometry/src/paint-region-transform';
import { regionContains, type PaintRegion } from '../packages/geometry/src/paint-region';
import { containsPoint } from '../packages/geometry/src/drawing';
import clipping, { UnresolvedPaintContour, withSelectionClipping } from '../packages/geometry/src/paint-clipping';
import { joinNonzeroPaintSeam, separatedNonzeroPaint } from '../packages/geometry/src/paint-winding';
import { worldPoint } from '../packages/geometry/src';
const floating = createRequire(new URL('../packages/geometry/package.json', import.meta.url))(
  'polygon-clipping',
) as Record<'union' | 'intersection' | 'xor', (...args: unknown[]) => unknown>;
const rectangle: Vector = {
  id: 'paint',
  kind: 'rectangle',
  x: 40,
  y: 50,
  width: 120,
  height: 80,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
};
const box = (left = 0, top = 0, right = 250, bottom = 200): Point[] => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
];
const select = (shapes: Vector[], polygon = box(), eligible = shapes.map((s) => s.id)) =>
  selectPaintRegion(shapes, { current: [], polygon, mode: 'replace' }, eligible);

it('picks dense paint directly with the established coverage rule and no per-point conversion', () => {
  const ring = (offset: number, radius: number, count: number): PaintRegion[number][number] =>
    Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * 2 * Math.PI;
      return [offset + radius * Math.cos(angle), radius * Math.sin(angle)];
    });
  const exterior = ring(0, 20, 12000), hole = ring(0, 5, 1000), overlap = ring(6, 3, 80);
  const region: PaintRegion = [[exterior, hole], [overlap]];
  const mapped = region.map(polygon => polygon.map(boundary => boundary.map(([x, y]) => ({ x, y }))));
  const conversions = [exterior, hole, overlap].map(boundary => vi.spyOn(boundary, 'map'));
  try {
    const query = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 20, y: 0 }, { x: -20, y: 0 }, { x: 100, y: 100 }];
    for (const point of query) {
      expect(regionContains(region, point)).toBe(
        mapped.some(([outer, ...holes]) => containsPoint(outer, point) &&
          !holes.some(boundary => containsPoint(boundary, point))),
      );
    }
    expect(conversions.map(conversion => conversion.mock.calls.length)).toEqual([0, 0, 0]);
  } finally { conversions.forEach(conversion => conversion.mockRestore()); }
});
it('keeps the combined partial paint footprint when a bounded sweep collapses a separate hole on the grid', () => {
  const thin: Vector = { ...rectangle, kind: 'polygon', fillRule: 'nonzero',
    contours: [box(0, 0, 120, 80), box(30, 10, 30.00000003, 60).reverse()] };
  const crossing = { ...rectangle, id: 'crossing', x: 130, y: 80 };
  const artwork = [thin, crossing], before = structuredClone(artwork);
  const original = floating.union;
  const limit = Error('Infinite loop when passing sweep line over endpoints (too many sweep line segments).');
  let failed = false;
  const spy = vi.spyOn(floating, 'union').mockImplementation((first, ...rest) => {
    if (!failed && Array.isArray(first) && first.length && rest.length) {
      failed = true;
      throw limit;
    }
    return original(first, ...rest);
  });
  try {
    const result = prepareEditorPaintSelection(artwork, { current: [], polygon: box(20, 20, 200, 140), mode: 'replace' }, artwork.map(s => s.id));
    expect(failed).toBe(true);
    expect(regionContains(result.footprint, { x: 70.000000015, y: 80 })).toBe(false);
    expect(regionContains(result.footprint, { x: 71, y: 80 })).toBe(true);
    expect(regionContains(result.footprint, { x: 180, y: 120 })).toBe(true);
    expect(regionContains(result.footprint, { x: 210, y: 120 })).toBe(false);
    expect(artwork).toEqual(before);
  } finally { spy.mockRestore(); }
});
it('retains whole editable drawings when only the combined marquee outline collapses', () => {
  const pencil: Vector = { ...rectangle, id: 'pencil', kind: 'line', x: 30, y: 90,
    fillEnabled: false, strokeWidth: 3, points: [{ x: 0, y: 0 }, { x: 155, y: 3 }] };
  const brush: Vector = { ...rectangle, id: 'brush', kind: 'polygon', fillRule: 'evenodd',
    contours: [box(0, 0, 120, 80), box(40, 20, 70, 60)] };
  const remote = { ...brush, id: 'remote', x: 350 };
  const artwork = [brush, pencil, remote], original = structuredClone(artwork);
  const eligible = artwork.map(s => s.id);
  const union = clipping.union;
  const failure = new UnresolvedPaintContour('Paint contour collapses at the supported precision.');
  const spy = vi.spyOn(clipping, 'union').mockImplementation((first, ...rest) => {
    // Fail the two already-normalized footprints, after the stroke bands have
    // been unioned. The source stroke's first union starts with an empty set.
    if (first.length && rest.length === 1) throw failure;
    return union(first, ...rest);
  });
  try {
    expect(() => select(artwork)).toThrow(failure);
    const result = prepareEditorPaintSelection(artwork, { current: [], polygon: box(), mode: 'replace' }, eligible);
    expect(result).toMatchObject({ footprint: [], whole: ['brush', 'pencil'] });
    const partial = prepareEditorPaintSelection(artwork, { current: [], polygon: box(20, 20, 150, 140), mode: 'replace' }, eligible);
    expect(partial).toMatchObject({ separate: true });
    expect(partial.footprint.length).toBeGreaterThan(1);
    expect(paintRegionBounds(partial.footprint)?.right).toBe(150);
    expect(regionContains(partial.footprint, { x: 100, y: 88 })).toBe(false);
    expect(regionContains(partial.footprint, { x: 105, y: 91.5 })).toBe(true);
    expect(artwork).toEqual(original);
  } finally { spy.mockRestore(); }
});
it('deletes only the covered portion, retains remote artwork, and reports byte-stable no-ops', () => {
  const remote = { ...rectangle, id: 'remote', x: 280 };
  const source = [rectangle, remote];
  const request = (polygon: Point[]) => ({ current: [], polygon, mode: 'replace' as const });
  const selectMask = (polygon: Point[]) => prepareEditorPaintSelection(source, request(polygon), ['paint']).mask;
  const removed = deletePaintRegion(source, selectMask(box(80, 40, 140, 140)), ['paint']);
  expect(removed.changed).toBe(true);
  expect(removed.artwork.at(-1)).toBe(remote);
  const retained = select(removed.artwork, box(), removed.artwork.map(s => s.id));
  expect(regionContains(retained, { x: 100, y: 90 })).toBe(false);
  expect(regionContains(retained, { x: 50, y: 90 })).toBe(true);
  expect(deletePaintRegion(source, selectMask(box(260, 0, 400, 200)), ['paint'])).toEqual({ artwork: source, changed: false });
});
it('retains near-edge cut candidates and tracks exact per-source outside counts', () => {
  const enclosed = { ...rectangle, id: 'enclosed', x: 100, y: 75, width: 12, height: 20 };
  const remote = { ...rectangle, id: 'remote', x: 300 };
  const padded = { ...rectangle, id: 'padded', x: 130.0001, width: 5 };
  const shapes = [enclosed, remote, rectangle, padded], eligible = shapes.map(shape => shape.id);
  const selection = prepareEditorPaintSelection(shapes, { current: [], polygon: box(90, 30, 130, 155), mode: 'replace' }, eligible);
  expect(selection).toMatchObject({ cutCandidates: ['enclosed', 'paint', 'padded'] });
  const { counts, artwork } = clipOutsidePaintWithSourceCounts([enclosed, rectangle, padded], {
    region: selection.mask, eligible, preserveStrokes: true,
  });
  expect(counts).toEqual([0, 2, 1]);
  expect(artwork.map(piece => piece.x)).toEqual([40, 130, 130.0001]);
  expect(artwork[2]).toBe(padded);
});
it('retains an enclosed editable fill during a mixed rectangular cut', () => {
  const rounded = { ...rectangle, cornerRadius: 18 };
  const crossing = { ...rectangle, id: 'crossing', x: 150, y: 85, fill: '#0000ff' };
  const artwork = [rounded, crossing];
  const polygon = box(20, 20, 180, 150);
  const region = prepareEditorPaintSelection(artwork, { current: [], polygon, mode: 'replace' }, ['paint', 'crossing']).mask;
  const intersection = vi.spyOn(clipping, 'intersection');
  try {
    const inside = clipPaint(artwork, { region, keep: 'inside', eligible: ['paint', 'crossing'], preserveStrokes: true });
    expect(inside[0]).toEqual(rounded);
    expect(inside[0]).not.toBe(rounded);
    expect(inside).toHaveLength(2);
    expect(paintRegionBounds(select([inside[1]]))).toEqual({ left: 150, top: 85, right: 180, bottom: 150 });
    expect(intersection).toHaveBeenCalledTimes(1);
    intersection.mockClear();
    expect(clipPaint([rounded], { region, keep: 'outside', eligible: ['paint'], preserveStrokes: true })).toEqual([]);
    expect(intersection).not.toHaveBeenCalled();
  } finally { intersection.mockRestore(); }
});
it('retains enclosed curves in a nonrectangular cut and clips a hole inside the hull', () => {
  const rounded = { ...rectangle, cornerRadius: 18 };
  const crossing = { ...rectangle, id: 'crossing', x: 150, y: 85, fill: '#0000ff' };
  const artwork = [rounded, crossing];
  const polygon = [...box(20, 20, 180, 150).slice(0, 2), { x: 175, y: 150 }, { x: 20, y: 150 }];
  const region = prepareEditorPaintSelection(artwork, { current: [], polygon, mode: 'replace' }, ['paint', 'crossing']).mask;
  const clip = { region, keep: 'inside' as const, eligible: ['paint', 'crossing'], preserveStrokes: true };
  const inside = clipPaint(artwork, clip);
  expect(inside[0]).toEqual(rounded);
  expect(inside[0]).not.toBe(rounded);
  expect(inside).toHaveLength(2);
  expect(regionContains(select([inside[1]]), { x: 170, y: 105 })).toBe(true);
  expect(regionContains(select([inside[1]]), { x: 190, y: 105 })).toBe(false);

  const hole: PaintRegion[number][number] = [[90, 80], [90, 100], [110, 100], [110, 80], [90, 80]];
  const notEnclosed = clipPaint([rounded], { ...clip, region: [[region[0][0], hole]] });
  expect(notEnclosed[0].id).not.toBe(rounded.id);
  expect(regionContains(select(notEnclosed), { x: 100, y: 90 })).toBe(false);
  expect(regionContains(select(notEnclosed), { x: 80, y: 90 })).toBe(true);
  const concave: PaintRegion = [[[
    [20, 20], [90, 20], [90, 95], [106, 95], [106, 20], [180, 20],
    [175, 150], [20, 150], [20, 20],
  ]]];
  const cutAroundNotch = select(clipPaint([rounded], { ...clip, region: concave }));
  expect(regionContains(cutAroundNotch, { x: 98, y: 70 })).toBe(false);
  expect(regionContains(cutAroundNotch, { x: 80, y: 90 })).toBe(true);
});
it('selects paint across a narrow notch with an exact shared boundary', () => {
  const thin: Vector = { ...rectangle, id: 'thin', kind: 'polygon', fillRule: 'nonzero',
    contours: [box(0, 0, 120, 80), box(30, 0, 30.00000003, 60).reverse()] };
  const before = structuredClone(thin);
  const region = select([thin], box(55, 40, 120, 145));
  expect(paintRegionBounds(region)).toEqual({ left: 55, top: 50, right: 120, bottom: 130 });
  expect(regionContains(region, { x: 70.000000015, y: 90 })).toBe(false);
  expect(regionContains(region, { x: 69.99, y: 90 })).toBe(true);
  expect(regionContains(region, { x: 70.01, y: 90 })).toBe(true);
  expect(regionContains(region, { x: 70.000000015, y: 120 })).toBe(true);
  expect(thin).toEqual(before);
});
it('keeps independently shared seams in a three-ring sub-grid fill', () => {
  const thin: Vector = { ...rectangle, id: 'thin', kind: 'polygon', fillRule: 'nonzero',
    contours: [box(30, 0, 30.00000003, 60).reverse(), box(0, 0, 120, 80), box(45, 0, 45.00000003, 60).reverse()] };
  const region = select([thin], box(55, 40, 120, 145));
  for (const x of [70, 85]) {
    expect(regionContains(region, { x: x + 0.00000001, y: 90 })).toBe(false);
    expect(regionContains(region, { x: x + 0.01, y: 90 })).toBe(true);
    expect(regionContains(region, { x: x + 0.00000001, y: 120 })).toBe(true);
  }
  const crossing = [{ x: 45, y: -1 }, { x: 45, y: 60 }, { x: 45.00000003, y: 60 }];
  expect(() => select([{ ...thin, contours: [thin.contours![0], thin.contours![1], crossing] }], box(55, 40, 120, 145)))
    .toThrow(/contour collapses/);
});
it('certifies the same seam in either ring order after a reflected shear', () => {
  const map = ({ x, y }: Point): [number, number] => [200 - x + y, 100 + x + y];
  const width = 2 ** -24;
  const outer = box(0, 0, 120, 80).map(map);
  const notch = box(30, 0, 30 + width, 60).reverse().map(map);
  const result = joinNonzeroPaintSeam(outer, notch);
  expect(result).toHaveLength(1);
  const at = (x: number, y: number) => {
    const [worldX, worldY] = map({ x, y });
    return regionContains(result!, { x: worldX, y: worldY });
  };
  expect(at(30 + width / 2, 40)).toBe(false);
  expect(at(30.01, 40)).toBe(true);
  expect(at(30 + width / 2, 70)).toBe(true);
  expect(joinNonzeroPaintSeam(notch, outer)).toHaveLength(1);
  expect(joinNonzeroPaintSeam(outer, [...notch].reverse())).toBeUndefined();
  const overlapping = box(30, 0, 35, 90).reverse().map(map);
  expect(joinNonzeroPaintSeam(outer, overlapping)).toBeUndefined();
});
it('selects a fill with a sub-grid hole touching its outer boundary at one point', () => {
  const thin: Vector = { ...rectangle, kind: 'polygon', fillRule: 'nonzero',
    contours: [box(0, 0, 120, 80), [{ x: 30, y: 0 }, { x: 30, y: 60 }, { x: 30.00000003, y: 60 }]] };
  const before = structuredClone(thin);
  const footprint = select([thin], box(55, 40, 120, 145));
  expect(paintRegionBounds(footprint)).toEqual({ left: 55, top: 50, right: 120, bottom: 130 });
  expect(regionContains(footprint, { x: 70.00000001, y: 90 })).toBe(false);
  expect(regionContains(footprint, { x: 69.99, y: 90 })).toBe(true);
  expect(regionContains(footprint, { x: 70.01, y: 90 })).toBe(true);
  expect(regionContains(footprint, { x: 70.00000001, y: 120 })).toBe(true);
  expect(regionContains(select([thin]), { x: 70.00000001, y: 90 })).toBe(false);
  expect(thin).toEqual(before);
});
it('preserves two sub-grid holes that touch different points on a single exterior', () => {
  const hole = (x: number) => [{ x, y: 0 }, { x, y: 60 }, { x: x + 0.00000003, y: 60 }];
  const thin: Vector = { ...rectangle, kind: 'polygon', fillRule: 'nonzero',
    contours: [hole(30), box(0, 0, 120, 80), hole(45)] };
  const region = select([thin], box(55, 40, 120, 145));
  for (const x of [70, 85]) {
    expect(regionContains(region, { x: x + 0.00000001, y: 90 })).toBe(false);
    expect(regionContains(region, { x: x + 0.01, y: 90 })).toBe(true);
    expect(regionContains(region, { x: x + 0.00000001, y: 120 })).toBe(true);
  }
  expect(separatedNonzeroPaint([
    [[0, 0], [120, 0], [120, 80], [0, 80]],
    [[30, 0], [34, 40], [45, 0], [38, 5]],
    [[65, 0], [65, 60], [65.00000003, 60]],
  ])).toBeUndefined();
});
it('keeps independently selectable paint beside an unresolved crossing contour below the local grid', () => {
  const thin: Vector = { ...rectangle, id: 'thin', kind: 'polygon', fillRule: 'nonzero',
    contours: [box(0, 0, 120, 80), [{ x: 30, y: -1 }, { x: 30, y: 60 }, { x: 30.00000003, y: 60 }]] };
  const ordinary = { ...rectangle, id: 'ordinary', x: 65, y: 140 };
  const shapes = [thin, ordinary], before = structuredClone(shapes), eligible = shapes.map(s => s.id);
  const request = { current: [], polygon: box(55, 40, 120, 180), mode: 'replace' as const };
  expect(() => select(shapes, request.polygon)).toThrow(/contour collapses/);
  const result = prepareEditorPaintSelection(shapes, request, eligible);
  expect(result).toMatchObject({ omitted: ['thin'] });
  expect(paintRegionBounds(result.footprint)).toEqual({left: 65, top: 140, right: 120, bottom: 180});
  expect(regionContains(result.footprint, {x: 80, y: 90})).toBe(false);
  expect(prepareEditorPaintSelection([thin], request, [thin.id])).toMatchObject({ footprint: [], omitted: ['thin'] });
  const old = select([ordinary], box(60, 145, 105, 165));
  const added = prepareEditorPaintSelection(shapes, { current: old, polygon: box(95, 40, 150, 185), mode: 'add' }, eligible);
  expect(added).toMatchObject({ omitted: ['thin'] });
  expect(regionContains(added.footprint, { x: 80, y: 150 })).toBe(true);
  expect(regionContains(added.footprint, { x: 130, y: 170 })).toBe(true);
  expect(regionContains(added.footprint, { x: 105, y: 90 })).toBe(false);
  // If the original mask could reach the failed drawing, retain the existing
  // selection rather than silently changing a previously selected drawing.
  expect(() => prepareEditorPaintSelection(shapes, { current: result.mask, polygon: box(90, 85, 165, 185), mode: 'add' }, eligible))
    .toThrow(/contour collapses/);
  const repeated = prepareEditorPaintSelection(shapes,
    { current: result.mask, polygon: box(90, 85, 165, 185), mode: 'add' }, eligible, ['thin']);
  expect(repeated).toMatchObject({ omitted: ['thin'], cutCandidates: ['ordinary'] });
  expect(regionContains(repeated.footprint, { x: 140, y: 150 })).toBe(true);
  for (const mode of ['subtract', 'intersect'] as const) {
    const narrower = { current: result.mask, polygon: mode === 'subtract'
      ? box(105, 130, 150, 185) : box(55, 40, 105, 170), mode };
    expect(() => prepareEditorPaintSelection(shapes, narrower, eligible)).toThrow(/contour collapses/);
    const reduced = prepareEditorPaintSelection(shapes, narrower, eligible, ['thin']);
    expect(reduced).toMatchObject({ omitted: ['thin'], cutCandidates: ['ordinary'] });
    expect(regionContains(reduced.footprint, { x: 85, y: 150 })).toBe(true);
    expect(regionContains(reduced.footprint, { x: 113, y: 150 })).toBe(false);
  }
  expect(shapes).toEqual(before);
});
it('selects and deletes a whole authored contour that cannot be clipped inside a lasso', () => {
  const thin: Vector = { ...rectangle, id: 'thin', kind: 'polygon', fillRule: 'nonzero',
    contours: [box(0, 0, 120, 80), [{ x: 30, y: -1 }, { x: 30, y: 60 }, { x: 30.00000003, y: 60 }]] };
  const ordinary = { ...rectangle, id: 'ordinary', x: 30, y: 145, width: 40, height: 10 };
  const remote = { ...rectangle, id: 'remote', x: 250 };
  const shapes = [thin, ordinary, remote], source = structuredClone(shapes);
  const request = { current: [], polygon: [{ x: 10, y: 20 }, { x: 200, y: 25 },
    { x: 192, y: 177 }, { x: 12, y: 173 }], mode: 'replace' as const };
  const eligible = shapes.map(s => s.id);
  expect(() => select(shapes, request.polygon)).toThrow(/contour collapses/);
  const enclosed = prepareEditorPaintSelection(shapes, request, eligible);
  expect(enclosed).toMatchObject({ whole: ['thin', 'ordinary'], footprint: [] });
  expect(deletePaintRegion(shapes, enclosed.mask, eligible)).toEqual({ artwork: [remote], changed: true });

  const hole: PaintRegion[number][number] = [[60, 60], [60, 90], [85, 90], [85, 60], [60, 60]];
  const mask = [[enclosed.mask[0][0], hole]];
  const result = deletePaintRegion(shapes, mask, eligible);
  expect(result).toEqual({ artwork: [thin, remote], changed: true, preserved: 1 });
  expect(result.artwork[0]).toBe(thin);
  expect(shapes).toEqual(source);
});
it('deletes an enclosed precision-failed root and keeps a crossing failed root exact', () => {
  const inside = { ...rectangle, id: 'inside', x: 20, width: 30 };
  const crossing = { ...rectangle, id: 'crossing', x: 85, width: 100, y: 65 };
  const editable = { ...rectangle, id: 'editable', x: 80, y: 105, height: 20 };
  const shapes = [inside, crossing, editable], source = structuredClone(shapes);
  const region = prepareEditorPaintSelection([], { mode: 'replace', current: [], polygon: box(0, 0, 120, 150) }, []).mask;
  const intersection = clipping.intersection;
  const precision = new UnresolvedPaintContour('Paint contour collapses at the supported precision.');
  const spy = vi.spyOn(clipping, 'intersection').mockImplementation((paint, mask) => {
    const bounds = paintRegionBounds(paint as import('../packages/geometry/src/paint-region').PaintRegion);
    if (bounds?.left === 20 || bounds?.left === 85) throw precision;
    return intersection(paint, mask);
  });
  try {
    const result = deletePaintRegion(shapes, region, shapes.map(s => s.id));
    expect(result).toMatchObject({ changed: true, preserved: 1 });
    expect(result.artwork[0]).toBe(crossing);
    expect(result.artwork).toHaveLength(2);
    expect(result.artwork[1].x).toBe(120);
    expect(deletePaintRegion([crossing], region, [crossing.id])).toEqual({ artwork: [crossing], changed: false, preserved: 1 });
    expect(shapes).toEqual(source);
    spy.mockImplementation(() => { throw Error('test unrelated error'); });
    expect(() => deletePaintRegion(shapes, region, shapes.map(s => s.id))).toThrow('test unrelated error');
  } finally { spy.mockRestore(); }
});
it('selects separated rows and columns without any cross-artwork union or enclosed intersections', () => {
  const artwork = Array.from({ length: 96 }, (_, i): Vector => ({
    ...rectangle, id: `island-${i}`, kind: 'polygon', width: 8, height: 8,
    x: 10 + i % 12 * 18, y: 10 + Math.floor(i / 12) * 18, fillRule: 'evenodd',
    contours: [box(0, 0, 8, 8), box(2, 2, 5, 5)],
  }));
  const union = vi.spyOn(clipping, 'union'), intersection = vi.spyOn(clipping, 'intersection');
  try {
    const region = select(artwork);
    expect(region).toHaveLength(96);
    for (const { x, y } of artwork) {
      expect(regionContains(region, { x: x + 1, y: y + 1 })).toBe(true);
      expect(regionContains(region, { x: x + 3, y: y + 3 })).toBe(false);
    }
    expect(union).not.toHaveBeenCalled();
    expect(intersection).not.toHaveBeenCalled();
  } finally { union.mockRestore(); intersection.mockRestore(); }
});
it('rejects an over-budget sweep retry, retires its allowance and permits a fresh selection', () => {
  const limit = Error('Infinite loop when passing sweep line over endpoints (too many sweep line segments).');
  const spy = vi.spyOn(floating,'union').mockImplementation(()=>{throw limit;});
  const ring = Array.from({length:2000},(_,i):[number,number] =>
    i%2 ? [20+i/2000,20] : [0,i/2000]);
  try {
    expect(()=>withSelectionClipping(()=>clipping.union([ring]))).toThrow(/smaller region/);
    expect(()=>clipping.union([ring])).toThrow(limit);
    expect(regionContains(select([rectangle]),{x:80,y:80})).toBe(true);
  } finally { spy.mockRestore(); }
});
it('keeps successful partial footprint clips when their final union exceeds the retry allowance', () => {
  const points = Array.from({ length: 1500 }, (_, i) => ({
    x: i % 2 ? 80 : 0, y: (i % 2 ? 80 : 0) + i / 200,
  }));
  points.push({ x: 90, y: 100 }, { x: -10, y: 100 }, { x: -10, y: -10 });
  const dense: Vector = { ...rectangle, kind: 'polygon', fillRule: 'nonzero', contours: [points] };
  const crossing = { ...rectangle, id: 'crossing', x: 100, y: 106, width: 100 };
  const shapes = [dense, crossing], before = structuredClone(shapes);
  const request = { current: [], polygon: box(0, 0, 160, 190), mode: 'replace' as const };
  const ids = shapes.map(shape => shape.id);
  const limit = Error('Infinite loop when passing sweep line over endpoints (too many sweep line segments).');
  const union = floating.union;
  let combined = 0;
  const sweep = vi.spyOn(floating, 'union').mockImplementation((first, ...rest) => {
    if (Array.isArray(first) && first.length && rest.length) {
      combined++;
      throw limit;
    }
    return union(first, ...rest);
  });
  try {
    expect(() => select(shapes, request.polygon)).toThrow(/smaller region/);
    const result = prepareEditorPaintSelection(shapes, request, ids);
    expect(combined).toBe(2);
    expect(result).toMatchObject({ separate: true });
    expect(result.footprint).toHaveLength(2);
    expect(regionContains(result.footprint, { x: 38, y: 56 })).toBe(true);
    expect(regionContains(result.footprint, { x: 120, y: 135 })).toBe(true);
    expect(regionContains(result.footprint, { x: 150, y: 120 })).toBe(true);
    expect(regionContains(result.footprint, { x: 165, y: 120 })).toBe(false);
    expect(shapes).toEqual(before);
    const intersection = vi.spyOn(floating, 'intersection').mockImplementation(() => { throw limit; });
    try {
      const incomplete = { ...request, polygon: box(0, 0, 110, 190) };
      expect(() => prepareEditorPaintSelection(shapes, incomplete, ids)).toThrow(/smaller region/);
      expect(combined).toBe(2);
      expect(shapes).toEqual(before);
    } finally { intersection.mockRestore(); }
  } finally { sweep.mockRestore(); }
});
it('retains clipped paint and holes when the floating sweep exhausts its segment list', () => {
  const ring: Vector = { ...rectangle, x:0, y:0, kind:'polygon', fillRule:'evenodd',
    contours:[box(0,0,100,100),box(25,25,75,75)] };
  const before = structuredClone(ring);
  const limit = new Error('Infinite loop when passing sweep line over endpoints (too many sweep line segments).');
  const spies = (['xor','intersection','union'] as const).map(op =>
    vi.spyOn(floating,op).mockImplementation(()=>{throw limit;}));
  try {
    const region = select([ring, {...rectangle,id:'extra',x:105,y:0}], box(10,-10,120,90));
    for (const [x,y,inside] of [[15,40,true],[50,50,false],[103,50,false],[110,50,true],[5,40,false]] as const)
      expect(regionContains(region,{x,y})).toBe(inside);
    expect(spies.every(spy=>spy.mock.calls.length)).toBe(true);
    expect(ring).toEqual(before);
  } finally { spies.forEach(spy=>spy.mockRestore()); }
});
it('fits actual paint rather than large empty marquee margins, without editing its source', () => {
  const shapes = [rectangle],
    before = structuredClone(shapes),
    region = select(shapes);
  expect(paintRegionBounds(region)).toEqual({ left: 40, top: 50, right: 160, bottom: 130 });
  expect(regionContains(region, { x: 20, y: 20 })).toBe(false);
  expect(shapes).toEqual(before);
});
it('fits only the clipped parts of mixed fill and strokes', () => {
  const line: Vector = {
    ...rectangle,
    id: 'line',
    kind: 'line',
    x: 20,
    y: 80,
    width: 200,
    height: 0,
    fillEnabled: false,
    strokeWidth: 4,
    points: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ],
  };
  const shapes = [rectangle, line],
    region = select(shapes, box(80, 40, 180, 110));
  expect(paintRegionBounds(region)).toEqual({ left: 80, top: 50, right: 180, bottom: 110 });
  expect(regionContains(region, { x: 130, y: 45 })).toBe(false);
  expect(regionContains(region, { x: 175, y: 80 })).toBe(true);
  expect(regionContains(region, { x: 175, y: 70 })).toBe(false);
});
it('includes stroke caps and width when a line has no fill or authoring height', () => {
  const line: Vector = {
    ...rectangle,
    kind: 'line',
    x: 50,
    y: 80,
    width: 100,
    height: 0,
    fillEnabled: false,
    strokeWidth: 10,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  };
  const b = paintRegionBounds(select([line]))!;
  // This radius uses the established 19-sided round-cap footprint.
  expect(b.left).toBeCloseTo(50 - 5 * Math.cos(Math.PI / 19), 7);
  expect(b.right).toBeCloseTo(155);
  expect(b.top).toBe(75);
  expect(b.bottom).toBe(85);
});
it('empty areas, nonpainting geometry, text and excluded members do not create selection boxes', () => {
  expect(select([rectangle], box(200, 10, 220, 30))).toEqual([]);
  expect(select([rectangle], box(), [])).toEqual([]);
  expect(select([{ ...rectangle, fillEnabled: false, strokeWidth: 0 }])).toEqual([]);
  expect(select([{ ...rectangle, kind: 'text' }])).toEqual([]);
  const result = select(
    [{ ...rectangle, id: 'protected', x: 1, y: 1, width: 200, height: 180 }, rectangle],
    box(),
    ['paint'],
  );
  expect(paintRegionBounds(result)).toEqual({ left: 40, top: 50, right: 160, bottom: 130 });
});
it('unioned overlapping paint stays selected once instead of becoming an even-odd hole', () => {
  const region = select([
    { ...rectangle, x: 10, y: 10, width: 60, height: 60 },
    { ...rectangle, id: 'second', x: 40, y: 40, width: 50, height: 50 },
  ]);
  expect(regionContains(region, { x: 50, y: 50 })).toBe(true);
  expect(paintRegionBounds(region)).toEqual({ left: 10, top: 10, right: 90, bottom: 90 });
});
it('preserves actual artwork holes and selection add/subtract/intersect semantics', () => {
  const shape: Vector = {
    ...rectangle,
    kind: 'polygon',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fillRule: 'evenodd',
    contours: [box(10, 10, 90, 90), box(40, 40, 60, 60).reverse()],
  };
  const region = select([shape]);
  expect(regionContains(region, { x: 50, y: 50 })).toBe(false);
  expect(regionContains(region, { x: 20, y: 20 })).toBe(true);
  const sub = selectPaintRegion(
    [shape],
    { current: region, polygon: box(10, 10, 30, 90), mode: 'subtract' },
    ['paint'],
  );
  expect(paintRegionBounds(sub)).toEqual({ left: 30, top: 10, right: 90, bottom: 90 });
  const add = selectPaintRegion(
    [shape],
    { current: sub, polygon: box(120, 120, 150, 150), mode: 'add' },
    ['paint'],
  );
  expect(add).toEqual(sub);
  const intersect = selectPaintRegion(
    [shape],
    { current: add, polygon: box(60, 0, 120, 100), mode: 'intersect' },
    ['paint'],
  );
  expect(paintRegionBounds(intersect)).toEqual({ left: 60, top: 10, right: 90, bottom: 90 });
});
it.each([1, -1])(
  'bounds actual affine/reflected contour points rather than its authoring box %s',
  (sign) => {
    const s: Vector = {
      ...rectangle,
      kind: 'polygon',
      x: 90,
      y: 70,
      width: 500,
      height: 500,
      transform: [sign, 0.25, 0.5, 1],
      points: [
        { x: 10, y: 10 },
        { x: 40, y: 20 },
        { x: 20, y: 60 },
      ],
    };
    const points = s.points.map((p) => worldPoint(s, p)),
      region = select([s], box(-200, -200, 1000, 1000)),
      b = paintRegionBounds(region)!;
    expect(b.left).toBeCloseTo(Math.min(...points.map((p) => p.x)), 5);
    expect(b.right).toBeCloseTo(Math.max(...points.map((p) => p.x)), 5);
    expect(b.top).toBeCloseTo(Math.min(...points.map((p) => p.y)), 5);
    expect(b.bottom).toBeCloseTo(Math.max(...points.map((p) => p.y)), 5);
  },
);
it('selected geometry agrees with the established clip operation and cannot expand a later edit into empty margins', () => {
  const region = select([rectangle]),
    outside = { ...rectangle, id: 'new-art', x: 10, y: 10, width: 10, height: 10 };
  expect(
    clipPaint([rectangle, outside], {
      region,
      keep: 'inside',
      eligible: ['paint', 'new-art'],
    }).every((s) => s.fill === rectangle.fill && s.x >= 40),
  ).toBe(true);
  const request = { current: region, polygon: box(0, 0, 100, 100), mode: 'intersect' as const },
    before = structuredClone(request),
    next = selectPaintRegion([rectangle], request, ['paint']);
  next[0][0][0][0]++;
  expect(request).toEqual(before);
});
it('admits dense selected contours without a lower node cap', () => {
  const points = Array.from({ length: 9000 }, (_, i) => ({
    x: 100 + 80 * Math.cos((i * 2 * Math.PI) / 9000),
    y: 100 + 80 * Math.sin((i * 2 * Math.PI) / 9000),
  }));
  const s: Vector = { ...rectangle, kind: 'polygon', x: 0, y: 0, width: 200, height: 200, points };
  const region = select([s]);
  expect(region[0][0].length).toBeGreaterThan(8000);
  expect(paintRegionBounds(region)).toEqual({ left: 20, top: 20, right: 180, bottom: 180 });
});
it('batches many separate eligible objects without dropping islands or their bounds', () => {
  const shapes = Array.from({ length: 130 }, (_, i) => ({
    ...rectangle,
    id: 's' + i,
    x: i * 3,
    y: 10,
    width: 1,
    height: 1,
  }));
  const region = select(shapes, box(-1, 0, 400, 20));
  expect(region).toHaveLength(130);
  expect(paintRegionBounds(region)).toEqual({ left: 0, top: 10, right: 388, bottom: 11 });
});
it('rejects nonfinite selection data without changing the original artwork', () => {
  const shapes = [rectangle],
    before = structuredClone(shapes);
  expect(() => select(shapes, [...box(), { x: NaN, y: 0 }])).toThrow();
  expect(shapes).toEqual(before);
});

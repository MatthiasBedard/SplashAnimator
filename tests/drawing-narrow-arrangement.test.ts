import { expect, it } from 'vitest';
import { objectBounds, worldPoint } from '../packages/geometry/src';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { mergeEditedPieces, mergeSelectedArtwork } from '../packages/geometry/src/merge-selection';
import {
  contains,
  mergeDrawingVectors,
  mergeVectors,
  NarrowArrangementFaceError,
  vectorPolygons,
} from '../packages/geometry/src/merge';
import { narrowArrangementOutline, narrowFixtureBrush } from './narrow-arrangement-fixture';

const rectangle = (id: string, x: number, y: number) => ({
  id, kind: 'rectangle' as const, x, y, width: 70, height: 34, rotation: 0,
  fill: '#ff0000', stroke: '#000000', strokeWidth: 0, points: [],
});

const movedLine = (y: number) => ({
  ...rectangle('line', 90, y), kind: 'path' as const, height: 0,
  fillEnabled: false, strokeWidth: 20, drawingMode: 'merge' as const,
  points: [{ x: 0, y: 0 }, { x: 70, y: 0 }],
});

it('settles moved pieces whose component the older arrangement cannot resolve', () => {
  const outline=narrowArrangementOutline(320,6_000_000);
  const paint=rectangle('cut',85,315), line=movedLine(324);
  const pieces=[outline,paint,line], before=structuredClone(pieces);
  expect(()=>mergeDrawingVectors(pieces)).toThrow(NarrowArrangementFaceError);
  const result=mergeEditedPieces(pieces,new Set([paint,line]));
  // The planar map resolves it. The moved line ends inside the moved paint, so it doesn't divide
  // it; both stay, each once.
  const fills=result.filter(s=>s.fill===paint.fill && s.fillEnabled!==false && !s.strokeWidth);
  expect(fills).toHaveLength(1);
  for (const y of [318,340]) expect(contains(vectorPolygons(fills[0]),{x:100,y})).toBe(true);
  expect(result.filter(s=>s.stroke===line.stroke && s.strokeWidth===line.strokeWidth)).toHaveLength(1);
  expect(pieces).toEqual(before);
});

it('rebuilds the moved component without touching a remote narrow face', () => {
  const outline = narrowArrangementOutline();
  const line = movedLine(110);
  const shapes = [outline, rectangle('fill', 85, 95), line];
  expect(() => mergeDrawingVectors(shapes)).toThrow(NarrowArrangementFaceError);
  expect(() => mergeSelectedArtwork(shapes, [line.id], true, true)).not.toThrow();
  const output = mergeSelectedArtwork(shapes, [line.id], true, true, [line.id]);
  expect(output.artwork[0]).toEqual(outline);
  expect(output.selected.length).toBeGreaterThan(0);
  expect(output.retainedOverlap).toBeUndefined();
});

it('settles a moved line over a face the older arrangement cannot certify', () => {
  const line = movedLine(324);
  const shapes = [narrowArrangementOutline(320, 6_000_000), line];
  const output = mergeSelectedArtwork(shapes, [line.id], true, true, [line.id]);
  expect(output.retainedOverlap).toBeUndefined();
  expect(output.selected.length).toBeGreaterThan(0);
  expect(output.artwork.filter(s => output.selected.includes(s.id)).every(s => s.stroke === line.stroke)).toBe(true);
  expect(() => mergeSelectedArtwork([{ ...line, y: NaN }], [line.id], true, true, [line.id]))
    .toThrow('finite');
});

it('merges reached shapes and preserves a distant narrow arrangement exactly', () => {
  const outline = narrowArrangementOutline();
  const old = rectangle('old-rect', 80, 100);
  const shape = rectangle('new-rect', 140, 100);
  expect(() => mergeDrawingVectors([outline, old, shape])).toThrow(NarrowArrangementFaceError);
  const result = prepareShapeDrawing([outline, old], { shape, merge: true });
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes).toHaveLength(2);
  expect(result.shapes[0]).toEqual(outline);
  expect(result.shapes[0]).not.toBe(outline);
  for (const x of [90, 145, 200])
    expect(contains(vectorPolygons(result.shapes[1]), { x, y: 110 })).toBe(true);
});

it('splits a rounded fill along exact ink when its whole arrangement has an unresolved face', () => {
  const outline = narrowArrangementOutline(320, 6_000_000);
  const shape = { ...rectangle('new-rect', 90, 308), cornerRadius: 8 };
  const before = structuredClone([outline, shape]);
  expect(() => mergeDrawingVectors([outline, shape])).toThrow(NarrowArrangementFaceError);
  const result = prepareShapeDrawing([outline], { shape, merge: true });
  expect(result.retainedOverlap).toBeUndefined();
  const paint = result.shapes.filter(piece => piece.fill === shape.fill && piece.fillEnabled !== false);
  expect(paint).toHaveLength(2);
  const [top, bottom] = paint.sort((a, b) => objectBounds(a).top - objectBounds(b).top);
  expect(contains(vectorPolygons(top), { x: 110, y: 312 })).toBe(true);
  expect(contains(vectorPolygons(bottom), { x: 110, y: 336 })).toBe(true);
  expect(contains(vectorPolygons(top), { x: 110, y: 336 })).toBe(false);
  expect(contains(vectorPolygons(bottom), { x: 110, y: 312 })).toBe(false);
  for (const half of paint) {
    expect(half.contours![0].some(point => point.in || point.out)).toBe(true);
    const seam = half.contours![0].map(point => worldPoint(half, point)).filter(point => point.y === outline.y);
    expect(seam.map(point => point.x).sort((a, b) => a - b)).toEqual([90, 160]);
  }
  const ink = result.shapes.filter(piece => piece.fillEnabled === false);
  expect(ink.every(piece => piece.kind === 'path' && piece.stroke === outline.stroke &&
    piece.strokeWidth === outline.strokeWidth)).toBe(true);
  const inkPoints = ink.flatMap(piece => piece.points.map(point => worldPoint(piece, point)));
  for (const point of outline.points) expect(inkPoints).toContainEqual(worldPoint(outline, point));
  // The line was there first and covered lines are kept, so it stays exactly as drawn.
  expect(ink).toHaveLength(1);
  expect([outline, shape]).toEqual(before);
});

it('rejects an invalid source or incoming shape instead of publishing a fallback', () => {
  const outline = narrowArrangementOutline(320, 6_000_000);
  const shape = rectangle('new-rect', 90, 308);
  const invalid = { ...shape, x: NaN };
  expect(() => prepareShapeDrawing([outline, invalid], { shape, merge: true })).toThrow();
  expect(() => prepareShapeDrawing([outline], { shape: invalid, merge: true })).toThrow();
});

it('still merges an overlapping Brush fill when unrelated linework would defeat full normalization', () => {
  const outline = narrowArrangementOutline();
  const brush = narrowFixtureBrush();
  const [paint] = mergeVectors([
    {
      ...brush,
      id: 'earlier-paint',
      kind: 'rectangle',
      x: 120,
      y: 90,
      width: 50,
      height: 20,
      points: [],
      strokeWidth: 0,
    },
  ]);
  const result = prepareBrushPaint([outline, paint], {
    brush,
    amount: 0.5,
    merge: true,
    mode: 'normal',
    selected: [],
    at: 2,
  });
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes).toHaveLength(2);
  expect(result.shapes[0]).toEqual(outline);
  expect(contains(vectorPolygons(result.shapes[1]), { x: 100, y: 100 })).toBe(true);
  expect(contains(vectorPolygons(result.shapes[1]), { x: 165, y: 100 })).toBe(true);
});

for (const tool of ['Brush', 'Pencil'] as const) {
  function draw(y: number, at = 1) {
    const old = narrowArrangementOutline();
    const incoming = narrowFixtureBrush(y);
    const resolved =
      tool === 'Brush'
        ? prepareBrushPaint([old], {
            brush: incoming,
            amount: 0.5,
            optimize: true,
            at,
            mode: at ? 'normal' : 'behind',
            merge: true,
            selected: [],
          })
        : preparePencilDrawing([old], {
            stroke: { ...incoming, kind: 'path' },
            mode: 'ink',
            merge: true,
          });
    return { old, incoming, resolved };
  }

  it(`keeps drawing with ${tool} when a distant narrow face defeats full normalization`, () => {
    const { old, incoming, resolved } = draw(100);
    expect(() => mergeVectors([old, incoming])).toThrow(NarrowArrangementFaceError);
    expect(resolved.retainedOverlap).toBeUndefined();
    expect(resolved.shapes[0]).toEqual(old);
    expect(resolved.shapes[0]).not.toBe(old);
    expect(resolved.shapes[1].drawingMode).toBe('merge');
    expect(resolved.shapes[1].kind).toBe(tool === 'Brush' ? 'polygon' : 'path');
  });

  it(`settles an overlapping ${tool} stroke the older arrangement cannot resolve`, () => {
    const source = narrowArrangementOutline();
    const y = source.y + 3;
    const { old, incoming, resolved } = draw(y);
    expect(resolved.retainedOverlap).toBeUndefined();
    expect(old).toEqual(source);
    expect(resolved.shapes.filter(s => s.id !== source.id).every(s => s.drawingMode === 'merge')).toBe(true);
    if (tool === 'Brush') {
      const paint = resolved.shapes.filter(s => s.fillEnabled !== false && !s.strokeWidth);
      expect(paint.filter(s => contains(vectorPolygons(s), { x: 120, y }))).toHaveLength(1);
      const behind = draw(y, 0).resolved;
      expect(behind.retainedOverlap).toBeUndefined();
    } else {
      expect(resolved.shapes.some(s => s.fillEnabled === false && s.id === incoming.id)).toBe(true);
    }
  });
}

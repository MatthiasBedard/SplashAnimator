import { describe, expect, it } from 'vitest';
import type { BezierNode, Point, Vector } from '../packages/document/src';
import { validateLiveGraphicData } from '../packages/document/src/live-motion';
import { containsPoint, worldPaths } from '../packages/geometry/src/drawing';
import { merge, type PathCmd } from '../packages/geometry/src/planar';
import { planarBucket, planarFillJoin, planarMergeLayer } from '../packages/geometry/src/planar-merge';
import { normalizeEditorPreferences, editorPreferenceDefaults } from '../apps/editor/src/editor-preferences';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { mergeSelectedArtwork, mergeEditedPieces } from '../packages/geometry/src/merge-selection';
import { anotherMergeFailFrame, mergeFailThreeFrame } from './broken-drawing-fixture';

const base = { rotation: 0, points: [], stroke: '#000000', strokeWidth: 0, drawingMode: 'merge' as const };

function rect(id: string, x: number, y: number, w: number, h: number, fill: string, strokeWidth = 0): Vector {
  return { ...base, id, kind: 'rectangle', x, y, width: w, height: h, fill, strokeWidth };
}
function oval(id: string, x: number, y: number, w: number, h: number, fill: string): Vector {
  return { ...base, id, kind: 'ellipse', x, y, width: w, height: h, fill };
}
function curve(id: string, nodes: BezierNode[], strokeWidth = 2): Vector {
  return { ...base, id, kind: 'bezier', x: 0, y: 0, width: 0, height: 0, fill: '#ffffff', fillEnabled: false,
    strokeWidth, nodes };
}
/** A finished Brush footprint: closed curved paint, as the Brush commits it. */
function paint(id: string, cx: number, cy: number, rx: number, ry: number, fill: string): Vector {
  const k = 0.5522847498307936;
  return {
    ...base, id, kind: 'polygon', x: 0, y: 0, width: 0, height: 0, fill, closed: true, fillRule: 'evenodd',
    contours: [[
      { x: cx + rx, y: cy, in: { x: cx + rx, y: cy - ry * k }, out: { x: cx + rx, y: cy + ry * k } },
      { x: cx, y: cy + ry, in: { x: cx + rx * k, y: cy + ry }, out: { x: cx - rx * k, y: cy + ry } },
      { x: cx - rx, y: cy, in: { x: cx - rx, y: cy + ry * k }, out: { x: cx - rx, y: cy - ry * k } },
      { x: cx, y: cy - ry, in: { x: cx - rx * k, y: cy - ry }, out: { x: cx + rx * k, y: cy - ry } },
    ]],
  };
}

/** Fill owners at a point: the pieces whose paint covers it. */
function owners(artwork: Vector[], p: Point) {
  return artwork.filter(s => s.fillEnabled !== false && !s.strokeWidth && worldPaths(s, 0.01)
    .reduce((inside, ring) => inside !== containsPoint(ring, p), false));
}
const fills = (artwork: Vector[]) => artwork.filter(s => s.fillEnabled !== false && !s.strokeWidth);
const lines = (artwork: Vector[]) => artwork.filter(s => s.fillEnabled === false);

describe('planar kernel', () => {
  const square = (x: number, y: number, s: number): PathCmd[] =>
    [['M', x, y], ['L', x + s, y], ['L', x + s, y + s], ['L', x, y + s], ['Z']];

  it('joins matching paint, keeps the top colour on overlaps and cuts lines at crossings', () => {
    const out = merge([
      { path: square(0, 0, 100), fill: 0, fillRule: 'nonzero', stroke: 0 },
      { path: square(50, 50, 100), fill: 1, fillRule: 'nonzero' },
      { path: square(120, 120, 60), fill: 1, fillRule: 'nonzero' },
      { path: [['M', -20, 25], ['C', 40, -10, 80, 60, 200, 25]], fillRule: 'nonzero', stroke: 1 },
    ])!;
    // The two blue squares overlap: one region. The red square loses the corner under it.
    expect(out.fills.filter(f => f.style === 1)).toHaveLength(1);
    expect(out.strokes.filter(s => s.style === 1).length).toBeGreaterThan(1);
    // The curve's pieces stay curves (no flattening).
    expect(out.strokes.filter(s => s.style === 1).every(s => s.path.some(c => c[0] === 'C'))).toBe(true);
  });

  it('gives the same pieces when its output is merged again', () => {
    const items = [
      { path: square(0, 0, 100), fill: 0, fillRule: 'nonzero' as const, stroke: 0 },
      { path: [['M', -20, 30], ['C', 40, -10, 80, 120, 160, 60]] as PathCmd[], fillRule: 'nonzero' as const, stroke: 1 },
    ];
    const a = merge(items)!;
    const b = merge([...a.fills.map(f => ({ path: f.path, fill: f.style, fillRule: 'evenodd' as const })),
      ...a.strokes.map(s => ({ path: s.path, stroke: s.style, fillRule: 'nonzero' as const }))])!;
    expect(b.fills.length).toBe(a.fills.length);
    expect(b.strokes.length).toBe(a.strokes.length);
  });
});

describe('Merge Drawing through the planar map', () => {
  it('divides paint with a Pencil line and keeps both halves and the line editable', () => {
    const square = rect('square', 0, 0, 100, 100, '#ff0000');
    const line = curve('pencil', [{ x: -20, y: 40 }, { x: 50, y: 60, in: { x: 20, y: 70 }, out: { x: 80, y: 50 } },
      { x: 130, y: 50 }]);
    const result = preparePencilDrawing([square], { stroke: { ...line, kind: 'path', nodes: undefined,
      points: [{ x: -20, y: 40 }, { x: 50, y: 60 }, { x: 130, y: 50 }] }, mode: 'ink', merge: true });
    expect(result.retainedOverlap).toBeUndefined();
    validateLiveGraphicData(result.shapes);
    expect(fills(result.shapes)).toHaveLength(2);
    // A drawn line is cut only by other lines, not by the paint it crosses or its own corners.
    expect(lines(result.shapes)).toHaveLength(1);
    expect(owners(result.shapes, { x: 50, y: 10 })).toHaveLength(1);
    expect(owners(result.shapes, { x: 50, y: 90 })).toHaveLength(1);
  });

  it('paints Brush over shapes and lines: one owner per point, matching paint joins', () => {
    const square = rect('square', 0, 0, 100, 100, '#ff0000', 2);
    const blue = oval('blue', 150, 0, 80, 80, '#0000ff');
    const line = curve('line', [{ x: -40, y: 50 }, { x: 260, y: 50 }]);
    let artwork = prepareShapeDrawing([square, blue], { shape: line, merge: true, removeCoveredStrokes: true }).shapes;
    // Blue Brush paint bridging the red square and the blue oval.
    const brush = paint('brush', 120, 40, 60, 20, '#0000ff');
    artwork = prepareShapeDrawing(artwork, { shape: brush, merge: true, removeCoveredStrokes: true }).shapes;
    validateLiveGraphicData(artwork);
    for (const p of [{ x: 10, y: 10 }, { x: 90, y: 40 }, { x: 120, y: 40 }, { x: 170, y: 20 }, { x: 50, y: 80 }])
      expect(owners(artwork, p)).toHaveLength(1);
    expect(owners(artwork, { x: 90, y: 40 })[0].fill).toBe('#0000ff');
    // Brush paint and the oval are one region above the line; the line divides them below it.
    const blueAbove = owners(artwork, { x: 120, y: 35 })[0];
    expect(owners(artwork, { x: 190, y: 20 })[0]).toBe(blueAbove);
    // Covered lines go when Remove covered lines is on: nothing is stroked inside the blue paint.
    expect(lines(artwork).some(s => worldPaths(s, 0.01).some(r => r.some(p =>
      Math.hypot((p.x - 120) / 55, (p.y - 40) / 15) < 1)))).toBe(false);
  });

  it('keeps covered lines over new paint when Remove covered lines is off', () => {
    const line = curve('line', [{ x: -40, y: 50 }, { x: 260, y: 50 }]);
    const brush = paint('brush', 120, 50, 60, 20, '#0000ff');
    const artwork = prepareShapeDrawing([line], { shape: brush, merge: true }).shapes;
    // The line stays exactly as it was, above the new paint, and divides it like any line.
    expect(lines(artwork)).toEqual([line]);
    expect(fills(artwork)).toHaveLength(2);
    expect(artwork.indexOf(lines(artwork)[0])).toBeGreaterThan(artwork.indexOf(fills(artwork)[1]));
    // A new line still cuts the old one where they cross.
    const cross = curve('cross', [{ x: 100, y: 0 }, { x: 100, y: 100 }]);
    const crossed = prepareShapeDrawing(artwork, { shape: cross, merge: true }).shapes;
    expect(lines(crossed)).toHaveLength(4);
  });

  it('keeps exact curves of untouched artwork and leaves unreached shapes as the same objects', () => {
    const far = oval('far', 500, 500, 40, 40, '#00ff00');
    const near = oval('near', 0, 0, 100, 100, '#ff0000');
    const line = curve('cut', [{ x: -10, y: 50 }, { x: 110, y: 50 }]);
    const settled = planarMergeLayer([far, near, line], new Set([2]))!;
    expect(settled.shapes[0]).toBe(far);
    // Each half of the oval keeps two of its original quarter curves exactly.
    for (const half of fills(settled.shapes).filter(s => s !== far))
      expect(half.contours![0].filter(n => n.in || n.out).length).toBeGreaterThanOrEqual(2);
  });

  it('drops a moved shape so it cuts what it lands on and reports its pieces as selected', () => {
    const square = rect('square', 0, 0, 100, 100, '#ff0000');
    const moved = rect('moved', 50, 50, 100, 100, '#0000ff');
    const result = mergeSelectedArtwork([square, moved], ['moved'], false, true, ['moved']);
    expect(owners(result.artwork, { x: 75, y: 75 })).toHaveLength(1);
    expect(owners(result.artwork, { x: 75, y: 75 })[0].fill).toBe('#0000ff');
    expect(result.selected).toEqual(owners(result.artwork, { x: 75, y: 75 }).map(s => s.id));
    const edited = mergeEditedPieces([square, moved], new Set([moved]));
    expect(owners(edited, { x: 75, y: 75 })).toHaveLength(1);
  });

  it('places Paint Behind under the drawing', () => {
    const square = rect('square', 0, 0, 100, 100, '#ff0000');
    const brush: Vector = { ...base, id: 'brush', kind: 'brush', x: 0, y: 0, width: 0, height: 0, fill: '#0000ff',
      strokeWidth: 20, brush: { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 },
      points: [{ x: 50, y: 50 }, { x: 200, y: 50 }] };
    const result = prepareBrushPaint([square], { brush, amount: 0, merge: true, mode: 'behind', selected: [], at: 0 });
    expect(result.retainedOverlap).toBeUndefined();
    expect(owners(result.shapes, { x: 60, y: 50 })[0].fill).toBe('#ff0000');
    expect(owners(result.shapes, { x: 160, y: 50 })[0].fill).toBe('#0000ff');
    expect(owners(result.shapes, { x: 60, y: 50 })).toHaveLength(1);
  });
});

describe.skipIf(!anotherMergeFailFrame())('saved drawing: another merge fail', () => {
  it('cuts the dense Pencil probe through the saved frame with one owner per point', () => {
    const frame = anotherMergeFailFrame()!;
    const pencil: Vector = { id: 'ink-probe', kind: 'bezier', x: 130, y: 170, width: 235, height: 55, rotation: 0,
      strokeWidth: 2, stroke: '#2b232f', fill: '#6d5efc', fillEnabled: false, closed: false, points: [],
      drawingMode: 'merge', nodes: [{ x: 0, y: 30 }, { x: 70, y: 0 }, { x: 145, y: 55 }, { x: 235, y: 2 }] };
    const start = performance.now();
    const result = prepareShapeDrawing(frame, { shape: pencil, merge: true });
    const elapsed = performance.now() - start;
    expect(result.retainedOverlap).toBeUndefined();
    validateLiveGraphicData(result.shapes);
    console.info(`dense Pencil over ${frame.length} saved vectors: ${elapsed.toFixed(0)} ms`);
  });
});

describe.skipIf(!mergeFailThreeFrame())('saved drawing: merge fail 3', () => {
  it('rebuilds the saved layer as one planar drawing', () => {
    const frame = mergeFailThreeFrame()!;
    const settled = planarMergeLayer(frame, new Set(), { all: true });
    expect(settled).toBeDefined();
    validateLiveGraphicData(settled!.shapes);
  });
});

describe('Bucket and matching paint', () => {
  const red = '#ff0000';
  const line = (id: string, points: Point[]): Vector => ({ ...base, id, kind: 'path', x: 0, y: 0, width: 0, height: 0,
    fill: '#ffffff', fillEnabled: false, strokeWidth: 2, points });
  const bucketPaint = (): Vector => ({ ...base, id: 'region', kind: 'polygon', x: 0, y: 0, width: 0, height: 0,
    fill: red, fillEnabled: true, strokeWidth: 0 });
  const owners = (artwork: Vector[], p: Point) => artwork.filter((s) => !s.strokeWidth &&
    worldPaths(s, 0.001).reduce((inside, ring) => inside !== containsPoint(ring, p), false));

  it('fills the exact area lines and paint enclose, and joins the matching paint it meets', () => {
    // A ring of red paint crossed by a line: the Bucket inside the ring, beside the line.
    let artwork = prepareShapeDrawing([], { shape: line('ink', [{ x: 200, y: 80 }, { x: 200, y: 320 }]), merge: true }).shapes;
    const ring = { ...paint('ring', 200, 200, 90, 90, red), contours: [
      ...paint('o', 200, 200, 90, 90, red).contours!, ...paint('i', 200, 200, 60, 60, red).contours!] };
    artwork = prepareShapeDrawing(artwork, { shape: ring, merge: true }).shapes;
    const region = planarBucket(artwork, bucketPaint(), { x: 170, y: 200 })!;
    expect(region).toBeDefined();
    expect(region.id).toBe('region');
    // Bounded by the line on the right, the ring's inner edge elsewhere: exactly, so it meets it.
    expect(owners([region], { x: 199, y: 200 })).toHaveLength(1);
    expect(owners([region], { x: 201, y: 200 })).toHaveLength(0);
    expect(owners([region], { x: 200 - 59.9, y: 200 })).toHaveLength(1);
    expect(owners([region], { x: 200 - 60.1, y: 200 })).toHaveLength(0);
    const placed = [region, ...artwork];
    const joined = planarFillJoin(placed, [region.id])!;
    expect(joined.artwork).not.toBe(placed);
    validateLiveGraphicData(joined.artwork);
    // The region and the ring's left half are one shape now; the line still divides the ring.
    const left = owners(joined.artwork, { x: 120, y: 200 }), inner = owners(joined.artwork, { x: 170, y: 200 });
    expect(left).toHaveLength(1);
    expect(inner).toEqual(left);
    expect(left[0].id).toBe('region');
    expect(owners(joined.artwork, { x: 280, y: 200 })).toHaveLength(1);
    expect(owners(joined.artwork, { x: 280, y: 200 })[0]).not.toBe(left[0]);
    // The line stays over the paint.
    const ink = joined.artwork.findIndex((s) => s.strokeWidth > 0);
    expect(ink).toBeGreaterThan(joined.artwork.indexOf(left[0]));
  });

  it('declines an area that is open to the outside', () => {
    const artwork = prepareShapeDrawing([], { shape: line('ink', [{ x: 0, y: 0 }, { x: 100, y: 100 }]), merge: true }).shapes;
    expect(planarBucket(artwork, bucketPaint(), { x: 70, y: 30 })).toBeUndefined();
  });

  it('joins a recolored fill with the touching fill of that color, and leaves it alone otherwise', () => {
    const a = rect('a', 0, 0, 100, 100, red), b = rect('b', 100, 0, 100, 100, '#0000ff'), c = rect('c', 300, 0, 50, 50, '#0000ff');
    const artwork = [a, b, c];
    const recolored = artwork.map((s) => (s.id === 'b' ? { ...s, fill: red } : s));
    const joined = planarFillJoin(recolored, ['b'])!;
    const fills = joined.artwork.filter((s) => s.fill === red);
    expect(fills).toHaveLength(1);
    expect(fills[0].id).toBe('b');
    expect(joined.absorbed.get('a')).toBe('b');
    expect(joined.artwork).toContain(c);
    // Nothing of that color nearby: the same artwork.
    const alone = artwork.map((s) => (s.id === 'c' ? { ...s, fill: '#00ff00' } : s));
    expect(planarFillJoin(alone, ['c'])!.artwork).toBe(alone);
  });
});

describe('Lines and paint', () => {
  const ink = (id: string, x0: number, y0: number, x1: number, y1: number) => curve(id, [{ x: x0, y: y0 }, { x: x1, y: y1 }]);
  const lineXs = (artwork: Vector[]) => artwork.filter((s) => s.strokeWidth > 0)
    .flatMap((s) => worldPaths(s, 0.01).flat().map((p) => p.x));
  const shows = (artwork: Vector[], p: Point) => {
    // The topmost shape there is a line.
    const top = [...artwork].reverse().find((s) => s.strokeWidth > 0
      ? worldPaths(s, 0.01).some((r) => r.some((q, i) => {
        if (!i) return false;
        const a = r[i - 1], dx = q.x - a.x, dy = q.y - a.y, l = dx * dx + dy * dy;
        const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
        return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) < 1.5;
      }))
      : worldPaths(s, 0.001).reduce((inside, ring) => inside !== containsPoint(ring, p), false));
    return !!top && top.strokeWidth > 0;
  };

  it('new paint removes the line under it by default; lines drawn later stay on top', () => {
    expect(editorPreferenceDefaults.removeCoveredStrokes).toBe(true);
    expect(normalizeEditorPreferences({}).removeCoveredStrokes).toBe(true);
    expect(normalizeEditorPreferences({ removeCoveredStrokes: false, paintCoversLines: true }).removeCoveredStrokes).toBe(false);
    let artwork = prepareShapeDrawing([], { shape: ink('a', 0, 50, 200, 50), merge: true, removeCoveredStrokes: true }).shapes;
    artwork = prepareShapeDrawing(artwork, { shape: rect('cover', 50, 0, 100, 100, '#00aa00'), merge: true, removeCoveredStrokes: true }).shapes;
    // The covered span is gone: what is left ends at the paint's edges.
    const xs = lineXs(artwork).sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(0, 3);
    expect(xs.at(-1)).toBeCloseTo(200, 3);
    expect(xs.some((x) => x > 51 && x < 149)).toBe(false);
    // A line drawn over the paint afterwards shows on top of it.
    artwork = prepareShapeDrawing(artwork, { shape: ink('b', 100, -20, 100, 120), merge: true, removeCoveredStrokes: true }).shapes;
    expect(shows(artwork, { x: 100, y: 30 })).toBe(true);
  });

  it('puts a new line above paint it ends inside, even when that paint keeps its slot', () => {
    let artwork = prepareShapeDrawing([], { shape: rect('left', 0, 0, 100, 100, '#aa0000'), merge: true }).shapes;
    artwork = prepareShapeDrawing(artwork, { shape: rect('right', 200, 0, 100, 100, '#0000aa'), merge: true }).shapes;
    // Crosses the left fill and ends inside the right one, which it leaves as it was.
    artwork = prepareShapeDrawing(artwork, { shape: ink('cross', -20, 50, 250, 50), merge: true }).shapes;
    expect(shows(artwork, { x: 240, y: 50 })).toBe(true);
    expect(shows(artwork, { x: 50, y: 50 })).toBe(true);
  });

  it('a moved fill removes the line it is dropped on', () => {
    const artwork = prepareShapeDrawing([], { shape: ink('a', 0, 50, 200, 50), merge: true }).shapes;
    const moved = rect('moved', 50, 0, 100, 100, '#123456');
    const dropped = mergeEditedPieces([...artwork, moved], new Set([moved]));
    expect(lineXs(dropped).some((x) => x > 51 && x < 149)).toBe(false);
    expect(shows(dropped, { x: 20, y: 50 })).toBe(true);
  });
});

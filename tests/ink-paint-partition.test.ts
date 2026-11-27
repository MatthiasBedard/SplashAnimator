import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { pathCommands } from '../packages/geometry/src/drawing';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { mergeEditedPieces } from '../packages/geometry/src/merge-selection';
import { mergeControlBounds } from '../packages/geometry/src/merge';
import { partitionInkOverPaint } from '../packages/geometry/src/ink-paint-cut';

const ellipse: Vector = { id: 'blue', kind: 'ellipse', x: 30, y: 15, width: 90, height: 100,
  rotation: 0, fill: '#0088ff', stroke: '#000000', strokeWidth: 0, points: [], drawingMode: 'merge' };
const source = [ellipse, { ...ellipse, id: 'red', x: 145, rotation: 9, fill: '#dd2222' }];
const ink: Vector = { ...ellipse, id: 'ink', kind: 'path', fillEnabled: false, strokeWidth: 2,
  x: 0, y: 53, width: 260, height: 9, points: [{ x: 0, y: 0 }, { x: 260, y: 9 }] };

it('keeps a distant text owner out of the exact Pencil partition', () => {
  const text: Vector = { ...ellipse, id:'text', kind:'text', x:500,
    text:{content:'Label',font:'sans-serif',size:18,align:'left',bold:false,italic:false} };
  const cut = partitionInkOverPaint([ellipse,text,ink],ink,mergeControlBounds);
  expect(cut?.background.get(ellipse)).toHaveLength(2);
  expect(cut?.background.has(text)).toBe(false);
  expect(cut?.strokes).toHaveLength(3);
  expect(partitionInkOverPaint([ellipse,{ ...text, x:10, y:30 },ink],ink,mergeControlBounds)).toBeUndefined();
});

it('splits transverse ink in place but rejects replacing any coincident interval', () => {
  const bent: Vector = { ...ink, kind: 'bezier', points: [], nodes: [
    { x: 0, y: 0, out: { x: 90, y: 28 } }, { x: 260, y: 9, in: { x: 180, y: -20 } },
  ] };
  const crossing = { ...ink, id: 'lower', x: 104, y: 17, width: 0, height: 90, stroke: '#773300', strokeWidth: 4,
    points: [{ x: 0, y: 0 }, { x: 0, y: 90 }] };
  const exact = partitionInkOverPaint([crossing, bent], bent, mergeControlBounds, undefined, true, true)!;
  expect(exact.strokes).toHaveLength(2);
  expect(exact.strokes.every(s => s.nodes?.some(n => n.in || n.out) && s.strokeWidth === bent.strokeWidth)).toBe(true);
  const pieces = exact.background.get(crossing)!;
  expect(pieces).toHaveLength(2);
  expect(pieces.every(s => s.stroke === crossing.stroke && s.strokeWidth === crossing.strokeWidth)).toBe(true);
  const coincident = { ...bent, id: 'coincident', stroke: '#113300' };
  expect(partitionInkOverPaint([crossing, coincident, bent], bent, mergeControlBounds, undefined, true, true)).toBeUndefined();
});

for (const tool of ['Pencil', 'Line'] as const) it(`${tool} splits both curved fills on release without saving tessellation points`, () => {
  const original = structuredClone(source);
  const result = tool === 'Pencil' ? preparePencilDrawing(source, { stroke: ink, merge: true, mode: 'ink' }) :
    prepareShapeDrawing(source, { shape: { ...ink, kind: 'line', fillEnabled: undefined }, merge: true });
  expect(result.retainedOverlap).toBeUndefined();
  for (const { fill } of source) {
    const halves = result.shapes.filter(s => s.fillEnabled !== false && s.fill === fill);
    expect(halves).toHaveLength(2);
    // Two cuts divide four ellipse cubics into six; the only new edge on
    // either face is its straight ink seam (possibly the closing command).
    expect(halves.flatMap(s => pathCommands(s)).filter(c => c[0] === 'C')).toHaveLength(6);
    expect(halves.reduce((n, s) => n + s.contours![0].length, 0)).toBe(8);
  }
  // The ink divides both fills and stays one line (only other lines cut a line), anchored where
  // it crosses each fill's outline.
  const inks = result.shapes.filter(s => s.fillEnabled === false);
  expect(inks).toHaveLength(1);
  expect(pathCommands(inks[0])).toHaveLength(6);
  expect(source).toEqual(original);
});

it('uses the same saved cubic for fitted ink and both adjoining paint faces, on draw and edit', () => {
  const pen: Vector = { ...ink, kind: 'bezier', points: [], nodes: [
    { x: 0, y: 0, out: { x: 90, y: 28 } }, { x: 260, y: 9, in: { x: 180, y: -20 } },
  ] };
  const signature = (s: Vector) => pathCommands(s).map(c => {
    const points = [];
    for (let i = 1; i < c.length; i += 2) points.push(mapPoint(matrix(s), { x: Number(c[i]), y: Number(c[i + 1]) }));
    return [c[0], ...points];
  });
  const drawn = prepareShapeDrawing(source, { shape: pen, merge: true });
  expect(drawn.retainedOverlap).toBeUndefined();
  expect(mergeEditedPieces([...source, pen], new Set([pen])).map(signature)).toEqual(drawn.shapes.map(signature));
  // One line, anchored at each crossing: its second and fourth curves are the seams.
  const inks = drawn.shapes.filter(s => s.fillEnabled === false);
  expect(inks).toHaveLength(1);
  const [line] = inks;
  expect(line.nodes).toHaveLength(6);
  for (const [i, fill] of source.entries()) {
    const a = line.nodes![i * 2 + 1], b = line.nodes![i * 2 + 2];
    const controls = [a, a.out!, b.in!, b].map(p => mapPoint(matrix(line), p));
    const common = drawn.shapes.filter(s => s.fillEnabled !== false && s.fill === fill.fill).flatMap(s =>
      s.contours![0].flatMap((a, j, r) => {
        const b = r[(j + 1) % r.length];
        return [JSON.stringify([a, a.out ?? a, b.in ?? b, b].map(p => mapPoint(matrix(s), p)))];
      }));
    expect(common).toContain(JSON.stringify(controls));
    expect(common).toContain(JSON.stringify(controls.reverse()));
  }
});

it('preserves and splits the separate ink outline of a drawn ellipse', () => {
  const outlined = prepareShapeDrawing([], { shape: { ...ellipse, strokeWidth: 2 }, merge: true }).shapes;
  const cut = prepareShapeDrawing(outlined, { shape: ink, merge: true });
  expect(cut.retainedOverlap).toBeUndefined();
  expect(cut.shapes.filter(s => s.fillEnabled !== false)).toHaveLength(2);
  expect(cut.shapes.filter(s => s.fillEnabled === false && s.kind === 'bezier')).toHaveLength(2);
  expect(cut.shapes.filter(s => s.fillEnabled === false && s.kind === 'path')).toHaveLength(3);
});

it('reuses ellipse anchors when a horizontal line crosses two authored joins', () => {
  const across = { ...ink, y: ellipse.y + ellipse.height / 2, height: 0, points: [{ x: 0, y: 0 }, { x: 150, y: 0 }] };
  const result = prepareShapeDrawing([ellipse], { shape: across, merge: true });
  expect(result.retainedOverlap).toBeUndefined();
  const halves = result.shapes.filter(s => s.fillEnabled !== false);
  expect(halves).toHaveLength(2);
  expect(halves.map(s => s.contours![0].length)).toEqual([3, 3]);
  expect(halves.flatMap(s => pathCommands(s)).filter(c => c[0] === 'C')).toHaveLength(4);
});

it('keeps a shallow cut through one ellipse cubic as an editable curved cap', () => {
  const slash = { ...ink, x: 40, y: -33, width: 120, height: 120, points: [{ x: 0, y: 0 }, { x: 120, y: 120 }] };
  const result = prepareShapeDrawing([ellipse], { shape: slash, merge: true });
  expect(result.retainedOverlap).toBeUndefined();
  const faces = result.shapes.filter(s => s.fillEnabled !== false);
  expect(faces).toHaveLength(2);
  const cap = faces.find(s => s.contours![0].length === 3)!;
  expect(pathCommands(cap).filter(c => c[0] === 'C')).toHaveLength(2);
  expect(faces.flatMap(s => pathCommands(s)).filter(c => c[0] === 'C')).toHaveLength(7);
});

it('cuts both curved fills with transformed ink as with any other line', () => {
  const transformed = { ...ink, transform: [1, .1, 0, 1] as [number, number, number, number] };
  const original = structuredClone(source);
  const result = prepareShapeDrawing(source, { shape: transformed, merge: true });
  expect(result.retainedOverlap).toBeUndefined();
  for (const { fill } of source)
    expect(result.shapes.filter(s => s.fillEnabled !== false && s.fill === fill)).toHaveLength(2);
  const inks = result.shapes.filter(s => s.fillEnabled === false);
  expect(inks).toHaveLength(1);
  // The line keeps its own placement, so it is drawn with the same transformed stroke.
  expect(inks[0].transform).toEqual(transformed.transform);
  expect(source).toEqual(original);
});

import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { circleSamples, spiralSamples, zigzagSamples } from './spiral-zigzag-fixture';
import { hit, segmentDistance } from '../packages/geometry/src';
import { worldPaths } from '../packages/geometry/src/drawing';

for (const degrees of [0, 27]) it(`cuts the turns of a finished Brush spiral on Pencil zigzag release at ${degrees} degrees`, () => {
  const brush: Vector = { id: 'spiral', kind: 'brush', x: 0, y: 0, width: 350, height: 300,
    fill: '#0088ff', stroke: '#0088ff', strokeWidth: 14, rotation: 0, points: spiralSamples };
  const { shapes } = prepareBrushPaint([], { brush, mode: 'normal', merge: true, amount: 1, optimize: true, at: 0, selected: [] });
  const original = structuredClone(shapes);
  const angle = degrees * Math.PI / 180;
  const points = zigzagSamples.map(({x,y}) => ({ x: 200+(x-200)*Math.cos(angle)-(y-160)*Math.sin(angle),
    y: 160+(x-200)*Math.sin(angle)+(y-160)*Math.cos(angle) }));
  const result = preparePencilDrawing(shapes, { stroke: { ...brush, id: 'zigzag', kind: 'path', strokeWidth: 2,
    fillEnabled: false, points }, mode: 'smooth', smoothing: 50, optimize: true, merge: true });
  expect(result.retainedOverlap).toBeUndefined();
  const faces = result.shapes.filter(s => s.fillEnabled !== false);
  expect(faces.length).toBeGreaterThan(8);
  // The zigzag divides every turn it crosses; it is cut only where it crosses itself.
  const ink = result.shapes.filter(s => s.fillEnabled === false);
  expect(ink.length).toBeGreaterThanOrEqual(1);
  expect(ink.every(s => s.strokeWidth === 2)).toBe(true);
  expect(faces.every(s => s.contours?.some(r => r.some(n => n.in || n.out)))).toBe(true);
  expect(shapes).toEqual(original);
});

it('cuts a circular Brush stroke through both sides and preserves its empty center', () => {
  const brush: Vector = { id: 'loop', kind: 'brush', x: 0, y: 0, width: 300, height: 250,
    fill: '#0088ff', stroke: '#0088ff', strokeWidth: 18, rotation: 0, points: circleSamples };
  const { shapes } = prepareBrushPaint([], { brush, mode: 'normal', merge: true, amount: 1, optimize: true, at: 0, selected: [] });
  expect(shapes[0].contours).toHaveLength(2);
  const result = preparePencilDrawing(shapes, { stroke: { ...brush, id: 'line', kind: 'path', strokeWidth: 2,
    fillEnabled: false, points: [{ x: 55, y: 140 }, { x: 330, y: 151 }] }, mode: 'smooth', optimize: true, merge: true });
  expect(result.retainedOverlap).toBeUndefined();
  const halves = result.shapes.filter(s => s.fillEnabled !== false);
  expect(halves).toHaveLength(2);
  expect(halves.some(s => hit(s, { x: 190, y: 150 }, 0))).toBe(false);
  const top = halves.filter(s => hit(s, { x: 190, y: 65 }, 0));
  const bottom = halves.filter(s => hit(s, { x: 190, y: 235 }, 0));
  expect(top).toHaveLength(1);
  expect(bottom).toHaveLength(1);
  expect(top[0].id).not.toBe(bottom[0].id);
  // The line divides both sides and stays one line (only other lines cut a line).
  expect(result.shapes.filter(s => s.fillEnabled === false)).toHaveLength(1);

  // A stroke ending in the empty center crosses only one side of the loop.
  const radial = preparePencilDrawing(shapes, { stroke: { ...brush, id: 'radius', kind: 'path', strokeWidth: 2,
    fillEnabled: false, points: [{ x: 55, y: 140 }, { x: 190, y: 151 }] }, mode: 'smooth', optimize: true, merge: true });
  expect(radial.retainedOverlap).toBeUndefined();
  const ring = radial.shapes.filter(s => s.fillEnabled !== false);
  expect(ring).toHaveLength(1);
  expect(ring[0].contours).toHaveLength(2);
  expect(hit(ring[0], { x: 190, y: 150 }, 0)).toBe(false);
  expect(radial.shapes.filter(s => s.fillEnabled === false)).toHaveLength(1);
});

it('cuts a spiral and a second color where a new Brush stroke crosses both repeatedly', () => {
  const stroke: Vector = { id:'spiral', kind:'brush', x:0, y:0, width:350, height:300, rotation:0,
    stroke:'#0088ff', fill:'#0088ff', strokeWidth:14, points:spiralSamples };
  const options = { mode:'normal' as const, merge:true, amount:1, optimize:true, selected:[] };
  const spiral = prepareBrushPaint([], { ...options, brush:stroke, at:0 }).shapes;
  const across = { ...stroke, id:'red', fill:'#dd2244', points:[{x:200,y:36},{x:204,y:115},{x:212,y:191},{x:206,y:291}] };
  const twoColors = prepareBrushPaint(spiral, { ...options, brush:across, at:spiral.length });
  expect(twoColors.retainedOverlap).toBeUndefined();
  const zig = { ...stroke, id:'green', fill:'#00aa44', strokeWidth:14, points:zigzagSamples };
  const result = prepareBrushPaint(twoColors.shapes, { ...options, brush:zig, at:twoColors.shapes.length });
  expect(result.retainedOverlap).toBeUndefined();
  for (const fill of [stroke.fill,across.fill]) {
    expect(result.shapes.filter(s => s.fill === fill).length).toBeGreaterThan(twoColors.shapes.filter(s => s.fill === fill).length);
  }
  const green = result.shapes.find(s=>s.fill===zig.fill)!;
  expect(green.contours![0].some(n => n.in || n.out)).toBe(true);
  const blank = prepareBrushPaint([], { ...options, brush:zig, at:0 }).shapes[0];
  const [alone] = worldPaths(blank, .01), [overPaint] = worldPaths(green, .01);
  for (const [from, to] of [[alone, overPaint], [overPaint, alone]]) {
    for (const p of from) expect(to.some((a,i) => segmentDistance(p,a,to[(i+1)%to.length]) <= .021)).toBe(true);
  }
});

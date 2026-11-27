import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { containsPoint, hit, segmentDistance, worldPoint } from '../packages/geometry/src';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { worldPaths } from '../packages/geometry/src/drawing';
import { diagonalScribble, pencilWave, verticalWave } from './crosshatched-paint-fixture';

const wave: Vector = {id:'wave', kind:'brush', x:0, y:0, width:400, height:300, rotation:0,
  strokeWidth:9, fill:'#7055ff', stroke:'#242044', points:verticalWave};
const scribble = {...wave, id:'scribble', points:diagonalScribble, fill:'#ff5588'};
const pencil = preparePencilDrawing([], {stroke:{...wave, kind:'path', fillEnabled:false, strokeWidth:1,
  points:pencilWave}, mode:'smooth', optimize:true, merge:true}).shapes;
const paint = (shapes:Vector[], brush:Vector) => prepareBrushPaint(shapes, {brush, mode:'normal',
  merge:true, amount:1, optimize:true, removeCoveredStrokes:true, at:shapes.length, selected:[]});

for (const [bottom, top] of [[wave,scribble],[scribble,wave]]) {
  it(`cuts the existing ${bottom.id} and Pencil on release of the ${top.id}`, () => {
    const lower = paint(pencil,bottom);
    expect(lower.retainedOverlap).toBeUndefined();
    const before = structuredClone(lower.shapes);
    const result = paint(lower.shapes,top);
    expect(result.retainedOverlap).toBeUndefined();
    expect(lower.shapes).toEqual(before);
    const pieces = result.shapes.filter(s => !s.strokeWidth && s.fill === bottom.fill);
    expect(pieces.length).toBeGreaterThan(8);
    const upper = result.shapes.filter(s => !s.strokeWidth && s.fill === top.fill);
    const curvedSeams = (s:Vector) => s.contours!.flatMap(r => r.flatMap((a,i) => {
      const b = r[(i+1)%r.length];
      if (!a.out && !b.in) return [];
      const controls = [a,a.out ?? a,b.in ?? b,b].map(p => worldPoint(s,p));
      return [JSON.stringify(controls),JSON.stringify(controls.reverse())];
    }));
    const seams = new Set(upper.flatMap(curvedSeams));
    expect(pieces.filter(s => curvedSeams(s).some(e => seams.has(e))).length).toBeGreaterThan(8);
    const blank = paint([],top).shapes;
    const edges = blank.flatMap(s => worldPaths(s,.01));
    const coveredInk = pencilWave.filter(p => before.some(s => s.fillEnabled === false && hit(s,p,0)) &&
      blank.some(s => hit(s,p,0)) && edges.every(r => r.every((b,i) => !i || segmentDistance(p,r[i-1],b) > 1)));
    expect(coveredInk.length).toBeGreaterThan(1);
    for (const p of coveredInk) expect(result.shapes.some(s => s.fillEnabled === false && hit(s,p,0))).toBe(false);
    if (top === scribble) {
      const throughHoles = pencilWave.filter(p => edges.slice(1).some(r => containsPoint(r,p)) &&
        !blank.some(s => hit(s,p,0)) && before.some(s => s.fillEnabled === false && hit(s,p,0)));
      expect(throughHoles.length).toBeGreaterThan(2);
      for (const p of throughHoles) expect(result.shapes.some(s => s.fillEnabled === false && hit(s,p,0))).toBe(true);
    }
    for (const point of top.points.filter(p => blank.some(s => hit(s,p,0)))) {
      expect(upper.some(s => hit(s,point,0))).toBe(true);
      expect(pieces.some(s => hit(s,point,0))).toBe(false);
    }
  });
}

it('joins a same-color wave and compound scribble into one fill with open holes', () => {
  const base = paint([],wave);
  const stamp = {...scribble,fill:wave.fill};
  const outline = paint([], stamp).shapes;
  expect(outline[0].contours!.length).toBeGreaterThan(2);
  const result = paint(base.shapes,stamp);
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes).toHaveLength(1);
  const [joined] = result.shapes;
  expect(joined.contours!.length).toBeGreaterThan(2);
  // The union splits original cubics at intersections, which shifts the
  // tessellation chords. Use a fine enough oracle for near-edge probes.
  const outlines = [...base.shapes,...outline,joined].map(s => worldPaths(s,.00001));
  for (let y = 38; y <= 245; y += 8) for (let x = 27; x < 376; x += 8) {
    const p = {x,y};
    const inside = outlines.map(rings => rings.reduce((v,ring) => v !== containsPoint(ring,p),false));
    expect(inside.at(-1), JSON.stringify(p)).toBe(inside.slice(0,-1).some(Boolean));
  }
});

it('keeps the paint inside the holes separately selectable when the scribble is entirely inside a fill', () => {
  const sheet: Vector = {...wave,id:'sheet',kind:'rectangle',strokeWidth:0,points:[],drawingMode:'merge'};
  const result = paint([sheet], scribble);
  expect(result.retainedOverlap).toBeUndefined();
  const pink = result.shapes.find(s => s.fill === scribble.fill)!;
  const exposed = result.shapes.filter(s => s.fill === sheet.fill);
  expect(exposed.length).toBe(pink.contours!.length);
  for (const p of diagonalScribble.filter(p => hit(pink,p,0))) expect(exposed.some(s => hit(s,p,0))).toBe(false);
});

it('cuts the compound Brush outline with Pencil after both colors are on the stage', () => {
  const fills = paint(paint([],wave).shapes,scribble).shapes;
  const result = preparePencilDrawing(fills,{stroke:{...wave,id:'last',kind:'path',fillEnabled:false,
    strokeWidth:1,points:pencilWave},mode:'smooth',optimize:true,merge:true});
  expect(result.retainedOverlap).toBeUndefined();
  for (const fill of [wave.fill,scribble.fill])
    expect(result.shapes.filter(s => !s.strokeWidth && s.fill === fill).length).toBeGreaterThan(fills.filter(s => s.fill === fill).length);
  // The Pencil wave divides both colours and stays one line (only other lines cut a line).
  const ink = result.shapes.filter(s => s.fillEnabled === false);
  expect(ink).toHaveLength(1);
  expect(ink[0].nodes!.length).toBeGreaterThan(20);
});

import { expect, it } from 'vitest';
import { newProject, validateProject, type Point, type Vector } from '../packages/document/src';
import { containsPoint, worldPaths } from '../packages/geometry/src/drawing';
import { segmentDistance } from '../packages/geometry/src';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { arc, diagonal, horizontal, vertical } from './brush-overpaint-fixture';
import {circleSamples, spiralSamples, zigzagSamples} from './spiral-zigzag-fixture';
import {prepareShapeDrawing} from '../packages/geometry/src/shape-drawing';
import clipping from '../packages/geometry/src/paint-clipping';
import { vectorPolygons } from '../packages/geometry/src/merge';

function paint(shapes: Vector[], points: Point[], fill: string, amount = 1) {
  const brush: Vector = {
    id: 'brush-' + shapes.length, kind: 'brush', x: 0, y: 0, width: 320, height: 240,
    rotation: 0, strokeWidth: 32, stroke: '#171717', fill, points,
  };
  return prepareBrushPaint(shapes, { brush, mode: 'normal', amount, optimize: true, merge: true,
    at: shapes.length, selected: [], removeCoveredStrokes: true });
}

function coverage(shapes: Vector[]) {
  return shapes.map(shape => ({ fill: shape.fill, rings: worldPaths(shape, .02) }));
}
function covers(rings: Point[][], p: Point) {
  return rings.reduce((inside, ring) => inside !== containsPoint(ring, p), false);
}

it('cuts translucent paint without joining it to an opaque Brush of the same color', () => {
  const blue = '#0088ff';
  const wash: Vector = {id:'wash',kind:'ellipse',x:96,y:71,width:80,height:103,rotation:0,
    fill:blue,stroke:'#111111',strokeWidth:0,points:[],drawingMode:'merge',opacity:0.2};
  const original = structuredClone(wash);
  const result = paint([wash],horizontal,blue);
  expect(result.retainedOverlap).toBeUndefined();
  const opaque = result.shapes.filter(s=>(s.opacity??1)===1);
  const translucent = result.shapes.filter(s=>s.opacity===0.2);
  expect(opaque).toHaveLength(1);
  expect(translucent).toHaveLength(2);
  const at = (x:number,y:number) => result.shapes.filter(s=>covers(worldPaths(s,.002),{x,y}));
  expect(at(132,120)).toEqual(opaque);
  expect(at(132,85).map(s=>s.opacity)).toEqual([0.2]);
  expect(at(132,158).map(s=>s.opacity)).toEqual([0.2]);
  expect(translucent.every(s=>s.contours?.flat().some(n=>n.in||n.out))).toBe(true);
  expect(wash).toEqual(original);
});

it('joins a single Brush stroke to every matching fill across intervening colors', () => {
  const blue = '#0088ff';
  const shapes = ['#0088ff','#ee4477','#0088ff','#00aa55','#0088ff'].map((fill,i):Vector => ({
    id:`panel-${i}`, kind:'rectangle', x:55+i*51, y:78, width:51, height:88,
    rotation:0, fill, stroke:'#111111', strokeWidth:0, points:[], drawingMode:'merge',
  }));
  const points = [{x:37,y:125},{x:102,y:111},{x:176,y:133},{x:248,y:111},{x:328,y:126}];
  const result = paint(shapes,points,blue);
  const faces = result.shapes.filter(s => s.fill === blue);
  expect(result.retainedOverlap).toBeUndefined();
  expect(faces).toHaveLength(1);
  const samples = coverage(result.shapes);
  for (const [i, panel] of shapes.entries()) {
    const x = panel.x + panel.width/2;
    expect(samples.filter(s=>covers(s.rings,{x,y:125})).map(s=>s.fill), `crossing ${i}`).toEqual([blue]);
    for (const y of [87,154]) {
      expect(samples.filter(s=>covers(s.rings,{x,y})).map(s=>s.fill)).toEqual([panel.fill]);
    }
  }
  expect(result.shapes.filter(s=>s.fill === '#ee4477')).toHaveLength(2);
  expect(result.shapes.filter(s=>s.fill === '#00aa55')).toHaveLength(2);
});

it('joins matching Brush faces when one authoring-box alignment would collapse distinct points', () => {
  const blue = '#0088ff';
  const palette = [blue, '#ee4477', blue, '#00aa55', blue, '#ee4477'];
  let seed = 45;
  const sample = (low: number, high: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return low + (high - low) * (seed / 4294967296);
  };
  const [, fixture] = Array.from({length:2}, () => {
    const spacing = sample(28, 57), left = sample(-180, 7), top = sample(-170, 0);
    const traces = palette.map((_, i) => {
      const x = 70 + i * spacing + left;
      return Array.from({length:5}, (_, k) => ({x:x + sample(-41, 41), y:48 + k * 42 + sample(-12, 12) + top}));
    });
    const points = Array.from({length:9}, (_, j) => ({x:22 + j * 47 + left, y:135 + sample(-58, 58) + top}));
    return {traces, points};
  });
  const source = fixture.traces.reduce<Vector[]>((art, trace, i) => paint(art, trace, palette[i], .5).shapes, []);
  const snapshot = structuredClone(source);
  const [blank] = paint([], fixture.points, blue, .5).shapes;
  const mask = vectorPolygons(blank, .01);
  const matching = source.filter(s => s.fill === blue);
  const hitMatching = matching.filter(s => clipping.intersection(vectorPolygons(s, .01), mask).length);
  expect(matching).toHaveLength(3);
  expect(hitMatching).toHaveLength(2);
  const untouched = matching.find(s => !hitMatching.includes(s))!;

  const result = paint(source, fixture.points, blue, .5);
  expect(result.retainedOverlap).toBeUndefined();
  const joined = result.shapes.filter(s => s.fill === blue && s.id !== untouched.id);
  expect(joined).toHaveLength(1);
  expect(joined[0].contours!.flat().some(n => n.in || n.out)).toBe(true);
  expect(result.shapes.find(s => s.id === untouched.id)).toEqual(untouched);
  expect(source).toEqual(snapshot);

  const old = coverage(source), output = coverage(result.shapes), [incoming] = coverage([blank]);
  let crossings = 0;
  for (let x = -95; x < 162; x += 3) for (let y = -20; y < 110; y += 3) {
    const point = {x, y};
    if (![...old, incoming].every(s => s.rings.every(r => r.every((v, i) =>
      segmentDistance(point, v, r[(i + 1) % r.length]) > .15)))) continue;
    if (!covers(incoming.rings, point) || !old.some(s => s.fill !== blue && covers(s.rings, point))) continue;
    expect(output.filter(s => covers(s.rings, point)).map(s => s.fill)).toEqual([blue]);
    crossings++;
  }
  expect(crossings).toBeGreaterThan(100);
});

it.each([['dab', '#ee4477'], ['short stroke', '#ee4477'], ['short stroke', '#0088ff']] as const)(
  'saves an optimized %s over existing Brush paint with fill %s', (gesture, color) => {
    const blue = '#0088ff';
    const draw = (artwork: Vector[], points: Point[], fill: string) => prepareBrushPaint(artwork, {
      brush: { id: 'brush-' + artwork.length, kind: 'brush', x: 0, y: 0, width: 0, height: 0,
        rotation: 0, strokeWidth: 24, stroke: fill, fill, points },
      amount: 0.5, optimize: true, mode: 'normal', merge: true, selected: [],
      at: artwork.length, removeCoveredStrokes: true,
    });
    const source = draw([], [80, 105, 130, 155, 180].map(x => ({ x, y: 100 })), blue).shapes;
    const before = structuredClone(source);
    const points = [{ x: 95, y: 102 }, ...(gesture === 'dab' ? [] : [{ x: 96, y: 102 }])];
    const isolated = draw([], points, color).shapes;
    expect(isolated).toHaveLength(1);
    expect(isolated[0].contours).toHaveLength(1);
    const ring = isolated[0].contours![0];
    expect(ring).toHaveLength(3);
    expect(ring.every(node => node.in && node.out)).toBe(true);
    const result = draw(source, points, color);
    const project = newProject();
    project.layers[0].keys[0].shapes = result.shapes;
    expect(() => validateProject(project)).not.toThrow();
    expect(result.retainedOverlap).toBeUndefined();
    const output = coverage(result.shapes);
    const owner = (x: number, y: number) => output.filter(shape => covers(shape.rings, { x, y })).map(shape => shape.fill);
    expect(owner(95, 102)).toEqual([color]);
    expect(owner(95, 113)).toEqual([color]);
    expect(owner(160, 100)).toEqual([blue]);
    expect(owner(160, 114)).toEqual([]);
    if (color === blue) expect(result.shapes).toHaveLength(1);
    expect(source).toEqual(before);
  },
);

it('keeps a Pencil divider through new matching Brush paint and joins the material on each side',()=>{
  const color='#1188dd';
  const base = paint([],horizontal,color).shapes;
  const divider: Vector = {id:'pencil',kind:'path',x:0,y:0,width:320,height:240,
    rotation:0,fillEnabled:false,fill:'#000000',stroke:'#141414',strokeWidth:2,
    points:[{x:145,y:40},{x:145,y:210}],drawingMode:'merge'};
  const split = prepareShapeDrawing(base,{shape:divider,merge:true});
  const stroke: Vector = {...divider,kind:'brush',id:'second',points:horizontal.map(p=>({...p,y:p.y+16})),
    fill:color,fillEnabled:true,strokeWidth:32};
  const result=prepareBrushPaint(split.shapes,{brush:stroke,mode:'normal',amount:1,optimize:true,merge:true,
    at:split.shapes.length,selected:[],removeCoveredStrokes:false});
  expect(result.retainedOverlap).toBeUndefined();
  const faces = result.shapes.filter(s=>!s.strokeWidth);
  expect(faces).toHaveLength(2);
  for (const x of [110,185]) {
    const matches=(y:number)=>faces.filter(s=>covers(worldPaths(s,.002),{x,y}));
    const old=matches(110), added=matches(145);
    expect(old).toHaveLength(1);
    expect(added.map(s=>s.id)).toEqual([old[0].id]);
    expect(covers(worldPaths(old[0],.002),{x:295-x,y:145})).toBe(false);
  }
  const kept=result.shapes.filter(s=>s.strokeWidth);
  expect(kept.every(s=>s.fillEnabled===false)).toBe(true);
  expect(kept.some(s=>worldPaths(s,.002).flat().some(p=>p.x===145 && p.y>145))).toBe(true);
});

const sequences: [string, Point[][], number?][] = [
  ['parallel overlap', [horizontal, horizontal.map(p => ({ ...p, x: p.x + 65 }))]],
  ['identical outline', [horizontal, horizontal]],
  ['T junction', [horizontal, [{ x: 145, y: 120 }, ...vertical.slice(2)]]],
  ['cross and retrace', [horizontal, vertical, diagonal, vertical]],
  ['partially shared side after two cuts', [horizontal, vertical, diagonal, vertical.map(p => ({ ...p, y: p.y + 35 }))]],
  ['adjoining side through a crossing', [horizontal, vertical, vertical.map(p => ({ ...p, x: p.x + 32 }))]],
  ['three-way crossing', [horizontal, vertical, diagonal]],
  ['previously cut curve', [arc, vertical, horizontal, arc]],
  ['reversed previously cut curve', [arc, vertical, horizontal, arc.slice().reverse()]],
  ['Brush spiral across a painted circle', [circleSamples, spiralSamples], .5],
  ['Brush across already cut spiral and zigzag', [zigzagSamples, spiralSamples, vertical], .5],
];
it.each(sequences)('gives each painted location one editable owner through %s', (_, strokes, amount = 1) => {
  let artwork: Vector[] = [];
  const originals: ReturnType<typeof coverage> = [];
  for (const [i, points] of strokes.entries()) {
    const color = ['#0088ff', '#ee4477', '#00aa55', '#0088ff'][i];
    originals.push(...coverage(paint([], points, color, amount).shapes));
    const result = paint(artwork, points, color, amount);
    const actual = coverage(result.shapes);
    // Independently compose finished, isolated footprints at interior probes.
    // A hidden older face is a failure even if it renders behind the right color.
    for (let y = 25; y < 215; y += 9) for (let x = 30; x < 320; x += 11) {
      const p = { x, y };
      if (originals.some(s => s.rings.some(ring => ring.some((v, j) =>
        segmentDistance(p, v, ring[(j + 1) % ring.length]) < .1)))) continue;
      const expected = originals.filter(s => covers(s.rings, p)).at(-1);
      expect(actual.filter(s => covers(s.rings, p)).map(s => s.fill),
        `stroke ${i + 1} at (${x}, ${y})`).toEqual(expected ? [expected.fill] : []);
    }
    expect(result.retainedOverlap).toBeUndefined();
    artwork = result.shapes;
  }
});

it('keeps a separate curved lens where a compound fill is cut twice on one arc', () => {
  const base: Vector = {id:'base',kind:'polygon',x:0,y:0,width:150,height:150,rotation:0,strokeWidth:0,
    stroke:'#111111',fill:'#0088ff',fillRule:'evenodd',closed:true,points:[],drawingMode:'merge',contours:[
      [{x:20,y:80,out:{x:50,y:25}},{x:140,y:80,in:{x:110,y:25}},{x:140,y:145},{x:20,y:145}],
      [{x:60,y:100},{x:80,y:100},{x:80,y:115},{x:60,y:115}],
    ]};
  const mask: Vector = {...base,id:'mask',kind:'rectangle',x:0,y:52,width:170,height:35,fill:'#ff6600',contours:undefined};
  const result = prepareShapeDrawing([base],{shape:mask,merge:true,removeCoveredStrokes:true});
  expect(result.retainedOverlap).toBeUndefined();
  const old = result.shapes.filter(s=>s.fill===base.fill);
  expect(old).toHaveLength(2);
  const lens=old.find(s=>covers(worldPaths(s,.005),{x:80,y:48}))!;
  expect(lens.contours).toHaveLength(1);
  expect(lens.contours![0]).toHaveLength(3);
  expect(lens.contours![0].some(n=>n.in||n.out)).toBe(true);
  expect(coverage(result.shapes).filter(s=>covers(s.rings,{x:80,y:70})).map(s=>s.fill)).toEqual([mask.fill]);
  expect(coverage(result.shapes).filter(s=>covers(s.rings,{x:70,y:105}))).toHaveLength(0);
});

it('joins matching Brush colors along the side of a previously cut stroke', () => {
  const base = paint([], horizontal, '#0088ff').shapes;
  const crossed = paint(base, vertical, '#ee4477').shapes;
  const adjacent = vertical.map(p => ({ ...p, x: p.x + 32 }));
  const result = paint(crossed, adjacent, '#ee4477');
  const pink = coverage(result.shapes.filter(s => s.fill === '#ee4477'));
  expect(pink).toHaveLength(1);
  for (const x of [145, 161, 177]) expect(covers(pink[0].rings, { x, y: 120 })).toBe(true);
  for (const { rings } of coverage(result.shapes.filter(s => s.fill === '#0088ff'))) {
    expect(covers(rings, { x: 177, y: 120 })).toBe(false);
  }
});

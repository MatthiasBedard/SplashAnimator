import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { hit, worldPoint } from '../packages/geometry/src';
import { sampledStar } from './crosshatched-paint-fixture';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { prepareSharedPaintStack } from '../packages/geometry/src/shared-paint-cut';
import { transverseCubicContacts } from '../packages/geometry/src/cubic-crossings';
import type { Cubic } from '../packages/geometry/src/curve-fit';

const style: Vector = {
  id: 'base',
  kind: 'ellipse',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  rotation: 0,
  fill: '#ff5588',
  stroke: '#171717',
  strokeWidth: 0,
  points: [],
  drawingMode: 'merge',
};

const point = (x: number, y: number) => ({ x, y });
function finishedLine(curves: Cubic[]): Vector {
  return { ...style, kind:'bezier', id:'line', fillEnabled:false, strokeWidth:2,
    nodes:[...curves.map(([p,out],i)=>({...p,out,...(i && {in:curves[i-1][2]})})),{...curves.at(-1)![3],in:curves.at(-1)![2]}] };
}

it('cuts paint twice where a fitted Pencil path folds back at a tight join', () => {
  const line = finishedLine([
    [point(250,78),point(174,35),point(86,2),point(0,0)],
    [point(0,0),point(41,12),point(80,30),point(119,49)],
  ]);
  const source: Vector = { ...style, kind:'rectangle', x:50, y:-5, width:45, height:100 };
  const result = prepareShapeDrawing([source],{shape:line,merge:true});
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes.filter(s=>!s.strokeWidth)).toHaveLength(3);
  // The line divides the paint and stays one line: only other lines cut it.
  expect(result.shapes.filter(s=>s.strokeWidth)).toHaveLength(1);
});

it('keeps the shared endpoint and a second crossing between adjacent cubics', () => {
  const a: Cubic = [point(0,0),point(2,0),point(4,0),point(6,0)];
  const b: Cubic = [point(6,0),point(4,4),point(2,-4),point(0,0)];
  const hits = transverseCubicContacts(a,b,{remaining:200000},true);
  expect(hits?.map(h=>h.point)).toEqual([point(0,0),point(3,0),point(6,0)]);
});

it('makes the inside of a thin closed Pencil loop separately selectable from its surround', () => {
  const line = finishedLine([
    [point(13.054,6.142),point(15.429,11.175),point(17.803,16.209),point(20.176,21.244)],
    [point(20.176,21.244),point(22.969,27.166),point(25.762,33.088),point(28.561,39.008)],
    [point(28.561,39.008),point(28.885,39.695),point(29.209,40.382),point(29.534,41.069)],
    [point(29.534,41.069),point(26.758,34.365),point(23.787,27.743),point(20.645,21.199)],
    [point(20.645,21.199),point(18.213,16.133),point(15.679,11.115),point(13.054,6.142)],
  ]);
  const result = prepareShapeDrawing([{...style,kind:'rectangle'}],{shape:line,merge:true});
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes.filter(s=>!s.strokeWidth).map(s=>s.contours?.length).sort()).toEqual([1,2]);
});

it('cuts both existing ink and paint when applying a finished solid fill', () => {
  const background = { ...style, kind:'rectangle' as const, width:250, height:140 };
  const oldInk = finishedLine([[point(45,70),point(85,66),point(130,74),point(205,70)]]);
  const result = prepareShapeDrawing([background,oldInk], { shape:{...style,id:'upper',x:90,y:40,
    width:70,height:60,fill:'#0088ff'}, merge:true, removeCoveredStrokes:true });
  const middle = point(124,70);
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes.filter(s=>hit(s,middle,0)).map(s=>s.fill)).toEqual(['#0088ff']);
  expect(result.shapes.filter(s=>s.strokeWidth)).toHaveLength(2);
  expect(result.shapes.find(s=>s.fill === '#0088ff')?.contours?.[0].some(n=>n.in || n.out)).toBe(true);
});

it('cuts hundreds of separate faces while nearby ink stays editable', () => {
  const shapes: Vector[] = [];
  for (let i=0;i<250;i++) {
    shapes.push({...style,kind:'rectangle',id:'fill'+i,x:5,y:3+8*i,width:200,height:3});
    for (let j=0;j<3;j++) shapes.push({...style,kind:'path',id:'ink'+i+'-'+j,
      fillEnabled:false,strokeWidth:1,x:30+50*j,y:7+8*i,width:20,height:0,points:[point(0,0),point(20,0)]});
  }
  const line = finishedLine([[point(10,0),point(60,520),point(140,1510),point(200,2001)]]);
  const cut = prepareSharedPaintStack(shapes,line,'ink');
  for(const fill of shapes.filter(s=>!s.strokeWidth)) expect(cut?.background.get(fill)).toHaveLength(2);
  expect(cut?.strokes?.length).toBeGreaterThan(500);
});
const ink = (art: Vector[], xy: number[][], mode: 'ink' | 'smooth' = 'ink') =>
  preparePencilDrawing(art, {
    stroke: {
      ...style,
      id: 'ink-' + art.length,
      kind: 'path',
      fillEnabled: false,
      strokeWidth: 2,
      points: xy.map(([x, y]) => ({ x, y })),
    },
    mode,
    merge: true,
    optimize: mode === 'smooth',
  });
const brush = () =>
  prepareBrushPaint([], {
    brush: {
      ...style,
      kind: 'brush',
      strokeWidth: 80,
      points: [
        { x: 0, y: 50 },
        { x: 65, y: 48 },
        { x: 140, y: 53 },
        { x: 200, y: 50 },
      ],
    },
    merge: true,
    optimize: true,
    amount: 1,
    at: 0,
    mode: 'normal',
    selected: [],
  }).shapes;

for (const kind of ['brush', 'ellipse', 'rectangle'] as const)
  it('successive Pencil cuts through ' + kind, () => {
    let art = kind === 'brush' ? brush() : [{ ...style, kind }];
    for (const [i, gesture] of [
      [
        [-55, 50],
        [255, 50],
      ],
      [
        [100, -20],
        [100, 120],
      ],
      [
        [-55, -12],
        [255, 112],
      ],
      [
        [255, -12],
        [-55, 112],
      ],
      [
        [-55, 54],
        [255, 54],
      ],
      Array.from({ length: 91 }, (_, i) => [
        -55 + i * 3.5,
        Math.round(62 + 50 * Math.sin((i * Math.PI) / 15)),
      ]),
    ].entries()) {
      const result = ink(art, gesture, 'smooth');
      const faces = result.shapes.filter((s) => !s.strokeWidth);
      if (i < 4) expect(faces.length, 'cut ' + (i + 1)).toBe((i + 1) * 2);
      else
        expect(faces.length, 'cut ' + (i + 1)).toBeGreaterThan(
          art.filter((s) => !s.strokeWidth).length,
        );
      expect(result.retainedOverlap).toBeUndefined();
      art = result.shapes;
    }
  });

it('raw Pencil cuts a straight-sided fill through the same dense crossings as curved paint', () => {
  const box = { ...style, kind: 'rectangle' as const, x: 20, y: 72, width: 225, height: 100 };
  const result = ink([box], sampledStar.map(p => [p.x, p.y]));
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes.filter(s => !s.strokeWidth).length).toBeGreaterThan(100);
});

it('two shallow intersections split both original centerlines', () => {
  const lower: Vector = {
    ...style,
    id: 'curve',
    kind: 'bezier',
    width: 150,
    height: 0.15,
    fillEnabled: false,
    stroke: '#0088ff',
    strokeWidth: 1,
    nodes: [
      { x: 0, y: 0, out: { x: 50, y: 0.2 } },
      { x: 150, y: 0, in: { x: 100, y: 0.2 } },
    ],
  };
  const result = ink(
    [lower],
    [
      [-10, 0.1],
      [160, 0.1],
    ],
  );
  expect(result.shapes).toHaveLength(6);
  const curves = result.shapes.filter((s) => s.stroke === lower.stroke);
  expect(curves).toHaveLength(3);
  expect(curves.every((s) => s.kind === 'bezier' && s.nodes?.length === 2)).toBe(true);
  const ends = result.shapes.flatMap((s) =>
    [s.nodes?.[0] ?? s.points[0], (s.nodes ?? s.points).at(-1)!].map((p) => worldPoint(s, p)),
  );
  for (const sign of [-1, 1]) {
    const x = 75 * (1 + sign / Math.sqrt(3));
    const at = ends.filter((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - 0.1) < 1e-12);
    expect(at).toHaveLength(4);
    expect(at.every((p) => p.x === at[0].x && p.y === at[0].y)).toBe(true);
  }
});

it('a reversed subpixel Pencil diameter cuts at both original ellipse anchors', () => {
  const ellipse = { ...style, x: 13.2, y: -18.75, width: 193.2, height: 131.25 };
  const y = ellipse.y + ellipse.height / 2;
  const result = ink(
    [ellipse],
    [
      [236.7, y],
      [-31.45, y],
    ],
    'smooth',
  );
  expect(result.shapes.filter((s) => !s.strokeWidth)).toHaveLength(2);
  expect(result.shapes.filter((s) => s.strokeWidth)).toHaveLength(1);
});

it('cuts a fill when a fitted Pencil anchor lands on its straight edge', () => {
  const points = Array.from({ length: 91 }, (_, i) => [
    Math.round(110 + 50 * Math.sin((i * Math.PI) / 24)),
    2 * i,
  ]);
  const { shape } = ink([], points, 'smooth');
  const nodes = shape.nodes!;
  expect(nodes.length).toBeGreaterThan(3);
  const y = shape.y + nodes[Math.floor(nodes.length / 2)].y;
  const base = { ...style, kind: 'rectangle' as const, y, height: 20 };
  const result = ink([base], points, 'smooth');
  expect(result.shapes.filter((s) => !s.strokeWidth)).toHaveLength(2);
  expect(result.shapes.filter((s) => s.strokeWidth)).toHaveLength(1);
});

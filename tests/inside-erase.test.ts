import { describe, it, expect } from 'vitest';
import { id, clone, type Vector } from '../packages/document/src';
import { eraseVectors, prepareEraseDrawing, prepareVectorErase } from '../packages/geometry/src/erase';
import { hit, transformVectors, around, worldPoint } from '../packages/geometry/src';
const box = (x = 0): Vector => ({
  id: id(),
  kind: 'rectangle',
  x,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 2,
  points: [],
});
describe('inside erasure', () => {
  it('anchors to the topmost starting fill and protects adjacent fills and outlines', () => {
    const a = box(),
      b = box(100),
      before = clone([a, b]);
    const out = eraseVectors(
      [a, b],
      [
        { x: 50, y: 50 },
        { x: 150, y: 50 },
      ],
      8,
      'inside',
    );
    expect(out.find((s) => s.id === b.id)).toBe(b);
    expect(out.some((s) => hit(s, { x: 50, y: 50 }, 0))).toBe(false);
    expect(out.some((s) => s.strokeWidth === 2 && s.fillEnabled === false)).toBe(true);
    expect([a, b]).toEqual(before);
  });
  it('does nothing when starting outside paint or in a hole', () => {
    const a = box();
    const shapes = [a];
    expect(
      eraseVectors(
        shapes,
        [
          { x: -10, y: 50 },
          { x: 50, y: 50 },
        ],
        8,
        'inside',
      ),
    ).toBe(shapes);
    const ring = eraseVectors([a], [{ x: 50, y: 50 }], 10, 'fills');
    expect(
      eraseVectors(
        ring,
        [
          { x: 50, y: 50 },
          { x: 80, y: 50 },
        ],
        5,
        'inside',
      ),
    ).toBe(ring);
  });
  it('honors eligibility and anchors the topmost overlapping affine fill', () => {
    const a = box(),
      b = box();
    transformVectors([b], around({ x: 0, y: 0 }, 1, 0, 0.5, 1));
    const p = worldPoint(b, { x: 50, y: 50 });
    const out = eraseVectors([a, b], [p], 5, 'inside');
    expect(out[0]).toBe(a);
    expect(out.filter((s) => s.id !== a.id).some((s) => hit(s, p, 0))).toBe(false);
    expect(eraseVectors([a, b], [p], 5, 'inside', [])).toEqual([a, b]);
  });
});

it('retains the opposite cubic anchor across repeated curved boundary cuts', () => {
  const ellipse: Vector = { ...box(), kind: 'ellipse', x: 40, y: 40,
    width: 160, height: 160, strokeWidth: 0, pivot: { x: 20, y: 30 } };
  const before = structuredClone(ellipse);
  let paint = [ellipse];
  for (const trail of [[{ x: 190, y: 100 }, { x: 190, y: 140 }], [{ x: 160, y: 57 }, { x: 169, y: 57 }]]) {
    paint = eraseVectors(paint, trail, 14, 'fills');
    expect(paint).toHaveLength(1);
    const shape = paint[0];
    const far = shape.contours!.flat().find(node => {
      const p = worldPoint(shape, node);
      return Math.hypot(p.x - 40, p.y - 120) < 1e-7;
    });
    expect(far?.in).toBeDefined();
    expect(far?.out).toBeDefined();
    for (const handle of [far!.in!, far!.out!]) {
      const p = worldPoint(shape, handle);
      expect(p.x).toBeCloseTo(40, 8);
      expect(Math.abs(p.y - 120)).toBeCloseTo(80 * 0.5522847498307936, 8);
    }
    expect(hit(shape, { x: 186, y: 120 }, 0)).toBe(false);
    expect(hit(shape, { x: 45, y: 120 }, 0)).toBe(true);
    expect(hit(shape, { x: 120, y: 120 }, 0)).toBe(true);
    expect(hit(shape, { x: 200, y: 160 }, 0)).toBe(false);
    expect(worldPoint(shape, shape.pivot!)).toEqual(worldPoint(ellipse, ellipse.pivot!));
  }
  expect(hit(paint[0], { x: 164, y: 62 }, 0)).toBe(false);
  expect(ellipse).toEqual(before);
});

it('keeps an unresolved contour exact while independently erasing Brush fill and Pencil ink',()=>{
  const thin:Vector={...box(80),id:'thin',kind:'polygon',y:90,width:100,height:60,
    strokeWidth:0,fillRule:'nonzero',contours:[
      [{x:0,y:0},{x:100,y:0},{x:100,y:60},{x:0,y:60}],
      [{x:30,y:-1},{x:30,y:50},{x:30.00000003,y:50}],
    ]};
  const pencil:Vector={...box(42),id:'pencil',kind:'path',y:125,width:110,height:0,
    fillEnabled:false,stroke:'#0000ff',strokeWidth:8,points:[{x:0,y:0},{x:110,y:0}]};
  const brush:Vector={...pencil,id:'brush',kind:'brush',y:255,strokeWidth:16,
    fill:'#008800',fillEnabled:true,brush:{pressure:false,minimum:1,aspect:1,tilt:false,angle:0}};
  const trail=[{x:115,y:95},{x:115,y:270}];
  const art=[thin,pencil,brush], snapshot=structuredClone(art);
  const all=prepareVectorErase(art,trail,10,'all');
  expect(all.preserved).toBe(1);
  expect(all.artwork[0]).toBe(thin);
  const ink=all.artwork.filter(s=>s.kind==='path');
  const paint=all.artwork.filter(s=>s.fill==='#008800');
  expect(ink).toHaveLength(2);
  expect(paint).toHaveLength(2);
  expect(ink.every(s=>s.strokeWidth===8&&s.fillEnabled===false)).toBe(true);
  expect(ink.some(s=>hit(s,{x:70,y:125},0))).toBe(true);
  expect(ink.some(s=>hit(s,{x:115,y:125},0))).toBe(false);
  expect(paint.some(s=>hit(s,{x:70,y:255},0))).toBe(true);
  expect(paint.some(s=>hit(s,{x:115,y:255},0))).toBe(false);
  const scoped=prepareVectorErase(art,trail,10,'all',[pencil.id]);
  expect(scoped.preserved).toBe(0);
  expect(scoped.artwork.at(-1)).toBe(brush);
  const strokeOnly=prepareVectorErase(art,trail,10,'strokes');
  expect(strokeOnly.preserved).toBe(0);
  expect(strokeOnly.artwork[0]).toBe(thin);
  const inside=prepareVectorErase(art,trail,10,'inside');
  expect(inside).toEqual({artwork:art,preserved:1});
  expect(inside.artwork).toBe(art);
  expect(()=>prepareVectorErase(art,trail,Infinity,'all')).toThrow('Invalid eraser geometry');
  const reopened = JSON.parse(JSON.stringify(all.artwork)) as Vector[];
  const secondTrail = [{x:60,y:110},{x:60,y:275}];
  const partial = prepareVectorErase(reopened,secondTrail,12,'all');
  expect(partial.preserved).toBe(0);
  // The planar map settles the erased pieces even beside the contour the older cutter could not
  // resolve; the ink lying over that paint now divides it, and its paint stays where it was.
  const settled = prepareEraseDrawing(reopened,{trail:secondTrail,radius:12,mode:'all',merge:true});
  expect(settled.retainedBoundaries).toBeUndefined();
  for (const p of [{x:150,y:100},{x:150,y:140},{x:170,y:110}])
    expect(settled.artwork.filter(s=>s.fill===thin.fill&&s.fillEnabled!==false&&hit(s,p,0))).toHaveLength(1);
  expect(settled.artwork.filter(s=>s.kind==='path'&&s.fillEnabled===false)).toHaveLength(3);
  expect(settled.artwork.some(s=>hit(s,{x:60,y:125},0))).toBe(false);
  expect(settled.artwork.some(s=>hit(s,{x:60,y:255},0))).toBe(false);
  expect(art).toEqual(snapshot);
});

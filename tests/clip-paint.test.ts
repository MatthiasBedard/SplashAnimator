import { describe, it, expect, vi } from 'vitest';
import { clone, type Vector } from '../packages/document/src';
import { clipPaint, dropPaintSelection, preparePaintDrop } from '../packages/geometry/src/clip-paint';
import { hit, worldPoint } from '../packages/geometry/src';
import { worldPaths } from '../packages/geometry/src/drawing';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { restoreClippedFillCurves } from '../packages/geometry/src/clip-fill-curves';
import clipping from '../packages/geometry/src/paint-clipping';
import type { PaintRegion } from '../packages/geometry/src/paint-region';
import { polygonVectors } from '../packages/geometry/src/strokes';
const box = (): Vector => ({
  id: 'box',
  kind: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
const polygon = [
  { x: 50, y: -20 },
  { x: 120, y: -20 },
  { x: 120, y: 120 },
  { x: 50, y: 120 },
];
const painted = (shapes: Vector[], x: number, y = 50) => shapes.some((s) => hit(s, { x, y }, 0));

it('restores untouched cubics inside the open area of a compound cutter', () => {
  const vector: Vector = { ...box(), kind:'ellipse' };
  const mask: PaintRegion = [[
    [[-20,-20],[120,-20],[120,120],[-20,120],[-20,-20]],
    [[-5,-5],[-5,80],[105,80],[105,-5],[-5,-5]],
  ]];
  const rings = worldPaths(vector,0.25).map(ring=>ring.map(({x,y}):[number,number]=>[x,y]));
  const [piece] = polygonVectors(vector,clipping.difference([rings],mask),true);
  const [restored] = restoreClippedFillCurves([piece],new Map([[piece,vector]]),mask);
  const upperCurves = (shape:Vector) => {
    const curves = new Set<string>();
    worldPaths(shape,0.25,(_, {curve})=>{
      if (curve.every(p=>p.y<=50)) curves.add([JSON.stringify(curve),JSON.stringify([...curve].reverse())].sort()[0]);
    });
    return curves;
  };
  expect(upperCurves(vector).size).toBe(2);
  expect(upperCurves(restored)).toEqual(upperCurves(vector));
  expect(restored.contours![0].length).toBeLessThan(piece.contours![0].length);
  expect(painted([restored],50,5)).toBe(true);
  expect(painted([restored],50,90)).toBe(false);
});
it('cuts a matching curved hole without changing the dropped fill', () => {
  const target = box();
  const moving: Vector = { ...box(), id: 'ellipse', kind: 'ellipse', fill: '#0000ff',
    x: 20, y: 20, width: 60, height: 60 };
  const [survivor, placed] = dropPaintSelection([target, moving], [moving.id], [target.id]);
  expect(placed).toBe(moving);
  const ring = survivor.contours!.find(r => r.some(n => n.out));
  expect(ring).toHaveLength(4);
  const hole = worldPaths(survivor, 0.002).find(path => path.length > 5)!;
  const outline = worldPaths(moving, 0.002)[0];
  expect(hole).toHaveLength(outline.length);
  for (const p of outline) expect(hole.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-8)).toBe(true);
});

it('joins overlapping opaque same-color fills into one editable outline', () => {
  const target = box();
  const moving: Vector = { ...box(), id: 'ellipse', kind: 'ellipse', x: 70, y: 20, width: 70, height: 60 };
  const result = preparePaintDrop([target, moving], [moving.id], [target.id]);
  expect(result.absorbedFill).toEqual({ moving: moving.id, into: target.id });
  expect(result.artwork).toHaveLength(1);
  expect(result.artwork[0].contours!.flat().some(n => n.in || n.out)).toBe(true);
  expect(painted(result.artwork, 30)).toBe(true);
  expect(painted(result.artwork, 125)).toBe(true);
});

it('keeps the curve of a newly drawn rounded fill where it enters and exits existing paint', () => {
  const target = box();
  const shape: Vector = { ...box(), id: 'round', kind: 'rectangle', cornerRadius: 28,
    x: 70, y: 20, width: 70, height: 60, fill: '#0000ff' };
  const [cut, added] = prepareShapeDrawing([target], { shape, merge: true }).shapes;
  const [outline] = worldPaths(added, 0.002);
  // The only extra samples are the two exact intersections on straight runs.
  const isCrossing = (p: { x: number; y: number }) => p.x === 100 && (p.y === 20 || p.y === 80);
  expect(outline.filter(isCrossing)).toEqual([{ x: 100, y: 20 }, { x: 100, y: 80 }]);
  expect(outline.filter(p => !isCrossing(p))).toEqual(worldPaths(shape, 0.002)[0]);
  expect(worldPaths(cut, 0.002)[0].filter(isCrossing)).toHaveLength(2);
  expect(cut.contours!.flat().some(n => n.out)).toBe(true);
  // The leftmost point and top of the notch come from the new rounded border.
  expect(painted([cut], 69.9, 50)).toBe(true);
  expect(painted([cut], 70.1, 50)).toBe(false);
  expect(painted([cut], 98, 19.9)).toBe(true);
  expect(painted([cut], 98, 20.1)).toBe(false);
});

it('splits a curved fill with a straight Rectangle at the same four anchors on both sides', () => {
  const base: Vector = { ...box(), x: 30.75, y: 50.25, kind: 'ellipse', pivot: { x: 12, y: 36 } };
  const bar: Vector = { ...box(), id: 'bar', x: 10, y: 84.75, width: 150, height: 19, fill: '#00cc44' };
  const result = prepareShapeDrawing([base], { shape: bar, merge: true }).shapes;
  const upper = result.at(-1)!;
  expect(upper.id).toBe(bar.id);
  const seams = upper.contours![0].map(p => worldPoint(upper, p)).filter(p => p.x > 10 && p.x < 160);
  expect(seams).toHaveLength(4);
  const faces = result.slice(0, -1);
  expect(faces).toHaveLength(2);
  for (const face of faces) {
    expect(worldPoint(face, face.pivot!)).toEqual(worldPoint(base, base.pivot!));
    const ring = face.contours![0];
    expect(ring.filter(n => n.in || n.out).length).toBeGreaterThan(1);
    const anchors = ring.map(n => worldPoint(face, n));
    expect(seams.filter(p => anchors.some(q => q.x === p.x && q.y === p.y))).toHaveLength(2);
  }
});

it('keeps a protected foreground fill in its original paint order during a same-color drop', () => {
  const target = box();
  const barrier: Vector = { ...box(), id: 'protected', x: 80, width: 40,
    drawingMode: 'object', fill: '#0000ff' };
  const moving = { ...box(), id: 'moving', x: 60, y: 40, width: 70, height: 25 };
  const result = preparePaintDrop([target, barrier, moving], [moving.id], [target.id, barrier.id]);
  expect(result.absorbedFill).toBeUndefined();
  expect(result.artwork.slice(-2)).toEqual([barrier, moving]);
});
it('preserves only original remote curves through repeated partial cuts', () => {
  const ellipse: Vector = { ...box(), kind: 'ellipse', x: 40, y: 40, width: 160, height: 160,
    pivot: { x: 20, y: 30 } };
  const neighbor = { ...box(), id: 'other', x: 230, fill: '#0000ff' };
  const before = structuredClone([ellipse, neighbor]);
  let shapes = [ellipse, neighbor];
  for (const [left, top, right, bottom] of [[172, 80, 210, 154], [151, 45, 176, 74]]) {
    shapes = clipPaint(shapes, { polygon: [
      { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
    ], keep: 'outside', eligible: [shapes[0].id], preserveOutsideFillCurves: true });
    expect(shapes).toHaveLength(2);
    const kept = shapes[0];
    const far = kept.contours!.flat().find(node => {
      const point = worldPoint(kept, node);
      return Math.hypot(point.x - 40, point.y - 120) < 1e-7;
    });
    expect(far?.in).toBeDefined();
    expect(far?.out).toBeDefined();
    for (const handle of [far!.in!, far!.out!]) {
      const p = worldPoint(kept, handle);
      expect(p.x).toBeCloseTo(40, 8);
      expect(Math.abs(p.y - 120)).toBeCloseTo(80 * 0.5522847498307936, 8);
    }
    expect(painted([kept], 185, 120)).toBe(false);
    expect(painted([kept], 45, 120)).toBe(true);
    expect(worldPoint(kept, kept.pivot!)).toEqual(worldPoint(ellipse, ellipse.pivot!));
    expect(shapes[1]).toBe(neighbor);
  }
  expect(painted([shapes[0]], 163, 65)).toBe(false);
  expect([ellipse, neighbor]).toEqual(before);
});

describe('partial paint clipboard', () => {
  it('keeps original surviving handles beside a dense untouched compound fill', () => {
    const ellipse: Vector = { ...box(), kind: 'ellipse', x: 40, y: 40, width: 160, height: 160 };
    const ring = (y: number) => Array.from({ length: 72000 }, (_, i) => i < 36000
      ? { x: i / 512, y }
      : { x: (71999 - i) / 512, y: y + 8 });
    const remote: Vector = { ...box(), id: 'remote', kind: 'polygon', x: 300, width: 80, height: 40,
      fillRule: 'evenodd', contours: [ring(0), ring(20)] };
    const mask = [{ x: 172, y: 80 }, { x: 210, y: 80 }, { x: 210, y: 154 }, { x: 172, y: 154 }];
    const [survivor, untouched] = clipPaint([ellipse, remote], {
      polygon: mask, keep: 'outside', eligible: [ellipse.id, remote.id], preserveOutsideFillCurves: true,
    });
    const anchor = survivor.contours?.flat().find(node => {
      const point = worldPoint(survivor, node);
      return point.x === 40 && point.y === 120;
    });
    expect(anchor?.in).toBeDefined();
    expect(anchor?.out).toBeDefined();
    expect(worldPoint(survivor, anchor!.in!).x).toBe(40);
    expect(worldPoint(survivor, anchor!.out!).x).toBe(40);
    expect(untouched).toBe(remote);
    expect(painted([survivor], 185, 120)).toBe(false);
  });
  it('partitions fill without mutating source and retains untouched vectors', () => {
    const a = box(),
      b = { ...box(), id: 'other', x: 200 },
      before = clone(a);
    const inside = clipPaint([a, b], { polygon, keep: 'inside', eligible: [a.id, b.id] });
    const outside = clipPaint([a, b], { polygon, keep: 'outside', eligible: [a.id, b.id] });
    expect(painted(inside, 75)).toBe(true);
    expect(painted(inside, 25)).toBe(false);
    expect(painted(outside, 25)).toBe(true);
    expect(painted(outside, 75)).toBe(false);
    expect(outside.at(-1)).toBe(b);
    expect(a).toEqual(before);
    expect(new Set([...inside, ...outside].map((s) => s.id)).size).toBe(
      inside.length + outside.length,
    );
  });
  it('clips stroke outlines independently and respects eligibility/text', () => {
    const a = { ...box(), strokeWidth: 10 },
      text = { ...box(), id: 'text', kind: 'text' as const };
    const result = clipPaint([a, text], { polygon, keep: 'inside', eligible: [a.id, text.id] });
    expect(result.some((s) => s.fill === '#000000' && hit(s, { x: 75, y: -3 }, 0))).toBe(true);
    expect(result.every((s) => s.strokeWidth === 0)).toBe(true);
    expect(clipPaint([a, text], { polygon, keep: 'outside', eligible: [] })).toEqual([a, text]);
  });
  it('preserves affine gradient paint coordinates and holes', () => {
    const a = box();
    a.transform = [1, 0.2, 0.3, 1];
    a.gradient = {
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff', opacity: 0.5 },
      ],
    };
    const start = worldPoint(a, a.gradient.from),
      end = worldPoint(a, a.gradient.to);
    const pieces = clipPaint([a], { polygon, keep: 'inside', eligible: [a.id] });
    expect(pieces.length).toBeGreaterThan(0);
    for (const s of pieces) {
      expect(worldPoint(s, s.gradient!.from).x).toBeCloseTo(start.x);
      expect(worldPoint(s, s.gradient!.to).y).toBeCloseTo(end.y);
      expect(s.gradient!.stops).toEqual(a.gradient.stops);
    }
    const hole = clipPaint([box()], {
      polygon: [
        { x: 25, y: 25 },
        { x: 75, y: 25 },
        { x: 75, y: 75 },
        { x: 25, y: 75 },
      ],
      keep: 'outside',
      eligible: ['box'],
    });
    expect(painted(hole, 50)).toBe(false);
    expect(painted(hole, 10)).toBe(true);
  });
  it('rejects malformed masks before touching paint', () => {
    expect(() => clipPaint([box()], { polygon: [], keep: 'outside', eligible: ['box'] })).toThrow();
  });
});

it('drops only painted areas while retaining holes, disjoint pieces and protected artwork', () => {
  const ring = { ...box(), id: 'ring', fillRule: 'evenodd' as const, kind: 'polygon' as const,
    contours: [0,30].map(inset => [{x:inset,y:inset},{x:100-inset,y:inset},
      {x:100-inset,y:100-inset},{x:inset,y:100-inset}]) };
  const back = { ...box(), id: 'back', x:-10, y:-10, width:150, height:150 };
  const extra = { ...box(), id: 'extra', x:160, width:20 };
  const protectedShape = { ...box(), id: 'protected', drawingMode:'object' as const };
  const shapes = [ring,back,extra,protectedShape], before = structuredClone(shapes);
  const out = dropPaintSelection(shapes,['extra','ring'],shapes.map(s=>s.id));
  expect(out.slice(-2)).toEqual([ring,extra]);
  expect(out).toContain(protectedShape);
  const remaining = out.slice(0,-2).filter(s=>s.id!=='protected');
  expect(painted(remaining, 50, 50)).toBe(true);
  expect(painted(remaining, 15, 15)).toBe(false);
  expect(painted(remaining, 120, 50)).toBe(true);
  expect(shapes).toEqual(before);
});

it('keeps the original editable outline when a drop punches a hole only in its fill', () => {
  const destination = {...box(),strokeWidth:3};
  const moved = {...box(),id:'picked',x:20,y:20,width:20,height:20};
  const out = dropPaintSelection([moved,destination],[moved.id],[destination.id]);
  expect(out.find(s=>s.id===destination.id)).toMatchObject({kind:'rectangle',fillEnabled:false,strokeWidth:3});
  expect(painted(out.slice(0,-1),30,30)).toBe(false);
  expect(painted(out.slice(0,-1),60,60)).toBe(true);
});

it('splits a Pencil cubic into editable runs for partial selection and for covered destination paint', () => {
  const pencil: Vector = { ...box(), id: 'pencil', kind: 'bezier', fillEnabled: false, strokeWidth: 8,
    strokeCap: 'butt', nodes: [{ x: 0, y: 0, out: { x: 0, y: 40 } }, { x: 100, y: 0, in: { x: 100, y: 40 } }] };
  const polygon = [{ x: 35, y: -10 }, { x: 65, y: -10 }, { x: 65, y: 90 }, { x: 35, y: 90 }];
  const request = { polygon, eligible: [pencil.id], preserveStrokes: true };
  const inside = clipPaint([pencil], { ...request, keep: 'inside' });
  const outside = clipPaint([pencil], { ...request, keep: 'outside' });
  expect(inside).toHaveLength(1);
  expect(outside).toHaveLength(2);
  expect(inside[0].nodes!.map(node => worldPoint(inside[0], node).x)).toEqual([
    expect.closeTo(35, 9), expect.closeTo(65, 9),
  ]);
  for (const piece of [...inside, ...outside]) {
    expect(piece).toMatchObject({ kind: 'bezier', strokeWidth: 8, strokeCap: 'butt', fillEnabled: false });
    expect(piece.nodes![0].out).toBeDefined();
    expect(piece.nodes![1].in).toBeDefined();
  }
  const fill = { ...box(), x: 35, y: -10, width: 30, height: 100 };
  const dropped = dropPaintSelection([pencil, fill], [fill.id], [pencil.id]);
  expect(dropped).toHaveLength(3);
  expect(dropped.slice(0, 2).every(run => run.kind === 'bezier' && run.strokeWidth === 8 && run.fillEnabled === false)).toBe(true);
  expect(painted(dropped.slice(0, 2), 50, 30)).toBe(false);
  expect(painted(dropped.slice(0, 2), 15.625, 22.5)).toBe(true);
});

it('includes an editable Pencil run when only its painted edge is selected', () => {
  const pencil: Vector = { ...box(), id: 'pencil', kind: 'path', fillEnabled: false, strokeWidth: 20,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  const polygon = [{ x: 38, y: 5 }, { x: 62, y: 5 }, { x: 62, y: 14 }, { x: 38, y: 14 }];
  const request = { polygon, eligible: [pencil.id], preserveStrokes: true };
  const inside = clipPaint([pencil], { ...request, keep: 'inside' });
  const outside = clipPaint([pencil], { ...request, keep: 'outside' });
  expect(inside).toHaveLength(1);
  expect(outside).toHaveLength(2);
  expect([...inside, ...outside].every(run => run.kind === 'path' && run.strokeWidth === 20 && run.fillEnabled === false)).toBe(true);
  expect(painted(inside, 50, 0)).toBe(true);
  expect(painted(outside, 50, 0)).toBe(false);
  expect(painted(outside, 15, 0)).toBe(true);
});
it('only the fill of a mixed Pencil and brush selection overwrites destination paint', () => {
  const back=box();
  const pencil:Vector={...box(),id:'pencil',kind:'path',fillEnabled:false,strokeWidth:8,
    points:[{x:0,y:50},{x:100,y:50}]};
  const fill={...box(),id:'paint',fill:'#3388aa',x:20,y:20,width:15,height:15};
  const result=dropPaintSelection([pencil,fill,back],[pencil.id,fill.id],[back.id]);
  expect(result.slice(-2)).toEqual([pencil,fill]);
  expect(painted(result.slice(0,-2),50,50)).toBe(true);
  expect(painted(result.slice(0,-2),25,25)).toBe(false);
});

it('keeps an unresolved destination behind a mixed drop and still cuts its neighbors', async () => {
  const {default:clipping,integerPaint}=await import('../packages/geometry/src/paint-clipping');
  const back={...box(),id:'complex'};
  const other={...box(),id:'other',x:160};
  const paint={...box(),id:'brush-piece',fill:'#3388aa',x:20,y:20,width:175,height:50};
  const pencil:Vector={...box(),id:'pencil',kind:'path',fillEnabled:false,strokeWidth:3,
    points:[{x:0,y:50},{x:200,y:50}]};
  const input=[back,other,paint,pencil],snapshot=structuredClone(input);
  // Produce the kernel's actual collapse at the first destination difference.
  const realDifference=clipping.difference;
  const unresolved = captureStrictCollapse();
  function captureStrictCollapse() {
    try { integerPaint('difference',[[[0,0],[1,1],[2,2],[0,0]]]); }
    catch (error) { return error; }
    throw Error('Expected a strict contour collapse');
  }
  let attempts=0;
  const difference=vi.spyOn(clipping,'difference').mockImplementation((subject,...rest)=>{
    if(JSON.stringify(subject).includes('[0,0]')){
      attempts++;
      throw unresolved;
    }
    return realDifference(subject,...rest);
  });
  try {
    const moved=[paint.id,pencil.id],eligible=[back.id,other.id];
    const {artwork:result,preservedDestination}=preparePaintDrop(input,moved,eligible);
    expect(preservedDestination).toBe(true);
    expect(attempts).toBeGreaterThan(1);
    expect(difference).toHaveBeenCalled();
    expect(result[0]).toEqual(back);
    expect(result.slice(-2)).toEqual([paint,pencil]);
    const cutNeighbor=result.slice(1,-2);
    expect(painted(cutNeighbor,180,40)).toBe(false);
    expect(painted(cutNeighbor,220,40)).toBe(true);
    const again=result.map(s=>moved.includes(s.id)?{...s,x:s.x+300}:s);
    expect(dropPaintSelection(again,moved,again.map(s=>s.id))).toEqual(again);
    expect(input).toEqual(snapshot);
    difference.mockImplementationOnce(()=>{throw Error('Paint coordinates exceed the supported precision range.');});
    expect(()=>dropPaintSelection(input,moved,eligible)).toThrow(/precision range/);
  } finally { difference.mockRestore(); }
});

it('recovers a collapsed combined cutter by subtracting individual moved fills', async () => {
  const {default:clipping, integerPaint}=await import('../packages/geometry/src/paint-clipping');
  const under=box(), left={...box(),id:'left',fill:'#3388aa',x:10,y:10,width:10,height:80},
    right={...left,id:'right',x:70};
  let unresolved: unknown;
  try { integerPaint('union',[[[0,0],[1,1],[2,2],[0,0]]]); }
  catch (error) { unresolved = error; }
  expect(unresolved).toBeInstanceOf(Error);
  const union=clipping.union;
  const fault=vi.spyOn(clipping,'union').mockImplementation((first,...rest)=>{
    if(first.length===2 && !rest.length)
      throw unresolved;
    return union(first,...rest);
  });
  try {
    const drop=preparePaintDrop([under,left,right],[left.id,right.id],[under.id]);
    expect(fault.mock.calls.some(([first,...rest])=>first.length===2 && !rest.length)).toBe(true);
    expect(drop.preservedDestination).toBe(false);
    expect(drop.artwork.slice(-2)).toEqual([left,right]);
    const outside=drop.artwork.slice(0,-2);
    expect([15,50,75].map(x=>painted(outside,x))).toEqual([false,true,false]);
  } finally {fault.mockRestore();}
});

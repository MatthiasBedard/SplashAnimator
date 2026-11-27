import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { hit } from '../packages/geometry/src';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { healDeletedInk, prepareMatchingFillJoins } from '../packages/geometry/src/join-recolored-fills';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { brushInsert, compoundDividerFixture, compoundPaint, cutCompoundDivider, ovalInserts } from './compound-divider-fixture';
import { verticalWave } from './crosshatched-paint-fixture';
import { circleSamples, spiralSamples, zigzagSamples } from './spiral-zigzag-fixture';

const paint: Vector = { id:'paint', kind:'rectangle', x:0, y:0, width:200, height:100, rotation:0,
  fill:'#ff5588', stroke:'#122333', strokeWidth:0, points:[], drawingMode:'merge' };
const ink: Vector = { ...paint, id:'pencil', kind:'path', fillEnabled:false, strokeWidth:2 };
const faces = (art: Vector[]) => art.filter(s => !s.strokeWidth);
const pencil = (art: Vector[], points: Vector['points']) => preparePencilDrawing(art,
  { stroke:{...ink, points}, mode:'smooth', optimize:true, merge:true });

it('a shallow Bézier crossing splits the whole fill and the next Pencil can cut the resulting lens', () => {
  const first = pencil([paint], [{x:-30,y:40},{x:230,y:40}]);
  expect(faces(first.shapes)).toHaveLength(2);
  const depth = .005;
  const second = prepareShapeDrawing(first.shapes, {merge:true, shape:{...ink,id:'curve',kind:'bezier',
    nodes:[{x:-20,y:70},{x:40,y:40,out:{x:55,y:40-depth}},
      {x:80,y:40,in:{x:65,y:40-depth},out:{x:95,y:45}},{x:240,y:74}]}});
  expect(second.retainedOverlap).toBeUndefined();
  expect(faces(second.shapes)).toHaveLength(5);
  const lens = faces(second.shapes).find(s=>s.width<=41 && s.height<.01);
  expect(lens?.contours?.[0].some(n=>n.in||n.out)).toBe(true);
  const across = pencil(JSON.parse(JSON.stringify(second.shapes)), [{x:60,y:-20},{x:60,y:120}]);
  expect(across.retainedOverlap).toBeUndefined();
  expect(faces(across.shapes)).toHaveLength(8);
  expect(faces(across.shapes).filter(s=>s.width<=21 && s.height<.01)).toHaveLength(2);
  const beside = prepareShapeDrawing(first.shapes,{merge:true,shape:{...ink,id:'near',kind:'bezier',
    nodes:[{x:-20,y:70},{x:40,y:40.006,out:{x:55,y:40.001}},
      {x:80,y:40.006,in:{x:65,y:40.001},out:{x:95,y:45}},{x:240,y:74}]}});
  expect(beside.retainedOverlap).toBeUndefined();
  expect(faces(beside.shapes)).toHaveLength(3);
});

it('joins a long shared boundary network while keeping a surviving divider and an unrelated fill', () => {
  const strip = (x: number): Vector => ({ ...paint,id:'strip-'+x,x,width:1,height:32,kind:'polygon',
    fillRule:'evenodd',contours:[[{x:0,y:0},{x:1,y:0},{x:1,y:32},{x:0,y:32}]] });
  const strips = Array.from({length:720},(_,i)=>strip(i));
  const divider = {...ink,id:'barrier',points:[{x:700,y:-5},{x:700,y:35}]};
  const remote = strip(750);
  const joined = prepareMatchingFillJoins([...strips, divider, remote],[strips[350].id]);
  expect(joined.absorbed.size).toBe(699);
  const material = joined.artwork.find(s=>s.id===strips[350].id)!;
  expect(hit(material,{x:2,y:15},0)).toBe(true);
  expect(hit(material,{x:698,y:15},0)).toBe(true);
  expect(hit(material,{x:702,y:15},0)).toBe(false);
  expect(joined.artwork.slice(1)).toEqual([...strips.slice(700),divider,remote]);
});

for (const [label,points,count] of [
  ['wave',verticalWave,29], ['spiral',spiralSamples,19], ['circle',circleSamples,10],
] as const) {
  it(`rejoins all cut ${label} faces on Bucket or divider deletion and can cut the reopened paint again`, () => {
    const original = prepareBrushPaint([], { brush:{...paint,kind:'brush',strokeWidth:24,points},
      amount:.5,merge:true,optimize:true,at:0,mode:'normal',selected:[] }).shapes;
    const cut = pencil(original, zigzagSamples);
    expect(cut.retainedOverlap).toBeUndefined();
    const pieces = faces(cut.shapes), lines = cut.shapes.filter(s=>s.strokeWidth);
    expect(pieces).toHaveLength(count);
    const seed = pieces[Math.floor(pieces.length/2)];
    // Model a final Bucket recolor on a layer with uninked material seams.
    // Only the clicked face is supplied as the seed, from the reopened data.
    const adjacent: Vector[] = JSON.parse(JSON.stringify(pieces.map(s=>({...s,fill:s.id===seed.id?'#335599':paint.fill}))));
    adjacent.find(s=>s.id===seed.id)!.fill=paint.fill;
    const bucket = prepareMatchingFillJoins(adjacent, [seed.id]);
    expect(bucket.absorbed.size).toBe(count-1);
    expect(bucket.artwork[0].id).toBe(seed.id);
    const healed = healDeletedInk(pieces, lines);
    for (const result of [healed, bucket.artwork]) {
      expect(result).toHaveLength(1);
      expect(result[0].contours?.some(r=>r.some(n=>n.in||n.out))).toBe(true);
      expect(result[0].contours?.length).toBe(original[0].contours?.length);
      // Check material on both sides of the cut, including holes/background.
      for (const p of [...points.filter((_,i)=>i%8===0),{x:190,y:150},{x:10,y:10}])
        expect(hit(result[0],p,0)).toBe(hit(original[0],p,0));
      const again = pencil(JSON.parse(JSON.stringify(result)), zigzagSamples);
      expect(again.retainedOverlap).toBeUndefined();
      expect(faces(again.shapes)).toHaveLength(count);
    }
    expect(prepareMatchingFillJoins(cut.shapes,[seed.id]).artwork).toEqual(cut.shapes);
  });
}

it.each(['Brush','Oval'])('joins matching Brush and Oval paint with %s on top',last=>{
  const oval:Vector={...paint,id:'ellipse',kind:'ellipse',x:196,y:75,width:46,height:151};
  const brush:Vector={...oval,id:'brush',kind:'brush',x:0,y:0,strokeWidth:30,
    points:[{x:150,y:135},{x:184,y:145},{x:216,y:168},{x:255,y:162},{x:290,y:156}]};
  const applyBrush=(shapes:Vector[])=>prepareBrushPaint(shapes,{brush,amount:1,optimize:true,merge:true,
    mode:'normal',at:shapes.length,selected:[]});
  const applyOval=(shapes:Vector[])=>prepareShapeDrawing(shapes,{shape:oval,merge:true});
  const input=structuredClone({oval,brush});
  const result=last==='Brush'?applyBrush(applyOval([]).shapes):applyOval(applyBrush([]).shapes);
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes).toHaveLength(1);
  const [joined]=result.shapes;
  expect(joined.contours?.some(ring=>ring.some(point=>point.in&&point.out))).toBe(true);
  for (const [x,y] of [[219,95],[275,158],[219,205],[165,140]])
    expect(hit(joined,{x,y},0)).toBe(true);
  expect({oval,brush}).toEqual(input);
});

it('recolors one inset and heals only the erased divider while two curved holes remain',()=>{
  const {compound,divided,remote}=compoundDividerFixture();
  const material=(shapes:Vector[])=>faces(shapes).filter(s=>s.fill===compoundPaint);
  const owner=(shapes:Vector[],x:number,y:number)=>material(shapes).find(s=>hit(s,{x,y},0));
  const inkAt=(shapes:Vector[],x:number)=>shapes.find(s=>s.strokeWidth>0&&hit(s,{x,y:165},0))!;
  expect(material(compound)[0].contours).toHaveLength(4);
  expect(material(divided)).toHaveLength(3);
  const red=divided.find(s=>s.fill===brushInsert)!;
  const snapshot=structuredClone(divided);
  const recolored=prepareMatchingFillJoins(divided.map(s=>s===red?{...s,fill:compoundPaint}:s),[red.id]);
  expect(recolored.absorbed.size).toBe(1);
  expect(owner(recolored.artwork,90,73)).toBe(owner(recolored.artwork,115,165));
  const erased=inkAt(recolored.artwork,150), protectedInk=inkAt(recolored.artwork,250);
  expect(erased).toBeDefined();
  expect(protectedInk).toBeDefined();
  const healed=healDeletedInk(recolored.artwork.filter(s=>s!==erased),[erased]);
  expect(material(healed)).toHaveLength(2);
  expect(owner(healed,120,165)).toBe(owner(healed,175,165));
  expect(owner(healed,175,165)).not.toBe(owner(healed,270,165));
  expect(inkAt(healed,250)).toEqual(protectedInk);
  expect(inkAt(healed,150)).toBeUndefined();
  expect(material(healed).map(s=>s.contours?.length)).toEqual([2,2]);
  const recut=cutCompoundDivider(JSON.parse(JSON.stringify(healed)) as Vector[],150);
  expect(recut.retainedOverlap).toBeUndefined();
  expect(material(recut.shapes)).toHaveLength(3);
  for (const stage of [recolored.artwork,healed,recut.shapes]) {
    expect(stage.filter(s=>ovalInserts.some(color=>color===s.fill))).toEqual(
      divided.filter(s=>ovalInserts.some(color=>color===s.fill)));
    expect(stage.find(s=>s.id===remote.id)).toEqual(remote);
    expect(owner(stage,78,137)).toBeUndefined();
    expect(owner(stage,322,90)).toBeUndefined();
  }
  expect(divided).toEqual(snapshot);
});

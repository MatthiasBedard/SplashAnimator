import { expect, it } from 'vitest';
import type { Point, Vector } from '../packages/document/src';
import { pathCommands } from '../packages/geometry/src/drawing';
import { prepareMatchingFillJoins } from '../packages/geometry/src/join-recolored-fills';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { prepareSharedPaintStack } from '../packages/geometry/src/shared-paint-cut';
import { brokenFrame } from './broken-drawing-fixture';

const point = (x: number,y: number): Point => ({ x,y });
const polygon = (id: string, ring: Point[], fill = '#008800'): Vector => ({
  id, kind:'polygon', x:0, y:0, width:20, height:20, rotation:0, fill,
  stroke:'#000000', strokeWidth:0, drawingMode:'merge', contours:[ring],
  points:[], fillRule:'evenodd', closed:true,
});

it('joins matching paint past an intervening face when their interiors are disjoint', () => {
  const left = polygon('left',[point(0,0),point(10,0),point(10,10),point(0,1)]);
  const right = polygon('right',[point(10,0),point(20,0),point(20,1),point(10,10)]);
  const above = polygon('separate',[point(0,5),point(10,12),point(20,5),point(20,18),point(0,18)],'#887700');
  const joined = prepareMatchingFillJoins([left,above,right],[left.id]);
  expect(joined.artwork.map(s=>s.id)).toEqual(['left','separate']);
  expect(joined.artwork[0].contours).toHaveLength(1);
  expect(joined.artwork[1]).toBe(above);
  const bar = polygon('overlapping',[point(2,0.2),point(18,0.2),point(18,0.8),point(2,0.8)],'#887700');
  const blocked = [left,bar,right];
  expect(prepareMatchingFillJoins(blocked,[left.id]).artwork).toBe(blocked);
});

function pencil(art: Vector[],y: number) {
  const stroke: Vector = { ...art[0],id:'new-pencil',kind:'path',x:0,y:0,rotation:0,contours:undefined,
    fillRule:undefined,closed:false,fillEnabled:false,strokeWidth:2,points:[point(-20,y),point(700,y+5)] };
  return preparePencilDrawing(art,{mode:'ink',merge:true,stroke});
}

it('removes both halves of a reversed curved seam across fractional authoring boxes',()=>{
  const left=polygon('left',[]);
  left.contours=[[point(0,0),point(10,0),{...point(10,4),out:point(9,5)},
    {...point(10,7),in:point(11,6),out:point(9,8)},{...point(10,10),in:point(11,9)},point(0,10)]];
  const right=polygon('right',[]);
  right.y=1;
  right.contours=[[point(10,-1),point(20,-1),point(20,9),
    {...point(10,9),out:point(11,8)},
    {...point(10,6+4*Number.EPSILON),in:point(9,7),out:point(11,5)},
    {...point(10,3),in:point(9,4)}]];
  const joined=prepareMatchingFillJoins([left,right],[left.id]);
  expect(joined.artwork).toHaveLength(1);
  expect(joined.artwork[0].contours).toHaveLength(1);
  expect(joined.artwork[0].contours![0].some(n=>n.in||n.out)).toBe(false);
  expect(pencil(joined.artwork,5).shapes.filter(s=>!s.strokeWidth)).toHaveLength(2);
});

it('cuts a face whose triangular hole shares a vertex with the exterior', () => {
  const face=polygon('pinch',[point(0,0),point(100,0),point(100,100),point(0,100)]);
  face.contours!.push([point(0,0),point(12,28),point(30,10)]);
  const cut=pencil([face],50);
  expect(cut.retainedOverlap).toBeUndefined();
  expect(cut.shapes.filter(s=>!s.strokeWidth)).toHaveLength(2);
  // The line divides the face and stays one line: only other lines cut it.
  expect(cut.shapes.filter(s=>s.strokeWidth)).toHaveLength(1);
});

it('rejects a purported hole that also crosses the exterior between vertices',()=>{
  const face=polygon('crossing',[point(0,0),point(100,0),point(100,100),point(0,100)]);
  face.contours!.push([point(0,0),point(40,-15),point(20,30)]);
  const ink: Vector={...face,id:'pencil',kind:'path',closed:false,contours:undefined,fillEnabled:false,
    strokeWidth:2,points:[point(-20,50),point(150,53)]};
  const original=structuredClone(face);
  expect(prepareSharedPaintStack([face],ink,'ink')).toBeUndefined();
  expect(face).toEqual(original);
});

// The reported frame has translated, unrotated faces and ink. Compare full
// world cubic controls in either direction, excluding boundaries carrying ink.
function edgeKeys(shape: Vector) {
  const world = (x: number,y: number) => [x+shape.x,y+shape.y].join(',');
  const keys: string[]=[];
  let current='', start='';
  for (const command of pathCommands(shape)) {
    const end=command[0]==='Z'?start:command[0]==='C'?world(command[5],command[6]):world(command[1],command[2]);
    if (command[0]==='M') start=end;
    else if (end!==current) {
      const middle=command[0]==='C'?[world(command[1],command[2]),world(command[3],command[4])]:[];
      const controls=[current,...middle,end];
      keys.push([controls.join(';'),controls.reverse().join(';')].sort()[0]);
    }
    current=end;
  }
  return keys;
}

const broken=brokenFrame();
function neighbors(art: Vector[]) {
  const ink=new Set(art.filter(s=>s.strokeWidth).flatMap(edgeKeys));
  const edges=new Map<string,number[]>();
  art.forEach((s,i)=>{
    if (s.strokeWidth) return;
    for (const key of edgeKeys(s)) {
      const owners=edges.get(key);
      if (owners) owners.push(i);
      else edges.set(key,[i]);
    }
  });
  const adjacent=art.map(()=>new Set<number>());
  for (const [key,owners] of edges) if (owners.length===2 && !ink.has(key)) {
    const [a,b]=owners;
    adjacent[a].add(b);
    adjacent[b].add(a);
  }
  return adjacent;
}

it.skipIf(!broken).each([true,false])('joins every reachable saved face across uninked seams (recolor %s)',recolor=>{
  const art=broken!, adjacent=neighbors(art);
  let checked=0;
  for (const [i,seed] of art.entries()) {
    const color=recolor?(seed.fill==='#6d5efc'?'#5ffc86':'#6d5efc'):seed.fill;
    const component=new Set([i]);
    for (const j of component) for (const k of adjacent[j]) if (art[k].fill===color) component.add(k);
    if (component.size<2) continue;
    checked++;
    const input=art.map((s,j)=>j===i?{...s,fill:color}:s);
    const joined=prepareMatchingFillJoins(input,[seed.id]);
    component.delete(i);
    const expected=new Set([...component].map(j=>art[j].id));
    expect(new Set(joined.absorbed.keys()),seed.id).toEqual(expected);
    expect(new Set(joined.absorbed.values())).toEqual(new Set([seed.id]));
    expect(joined.artwork.filter(s=>s.strokeWidth)).toEqual(art.filter(s=>s.strokeWidth));
  }
  expect(checked).toBeGreaterThanOrEqual(recolor?146:3);
},120000);

it.skipIf(!broken)('joined artwork accepts subsequent Pencil cuts across multiway junctions',()=>{
  const art=broken!;
  for (const i of [1,2,183]) {
    const seed=art[i], color=seed.fill===art[183].fill?art[1].fill:art[183].fill;
    const result=prepareMatchingFillJoins(art.map(s=>s===seed?{...s,fill:color}:s),[seed.id]);
    expect(result.absorbed.size).toBeGreaterThan(1);
    const reopened: Vector[]=JSON.parse(JSON.stringify(result.artwork));
    const joined=reopened.find(s=>s.id===seed.id)!;
    for (const y of [180,230,315]) {
      const cut=pencil([joined],y);
      expect(cut.retainedOverlap).toBeUndefined();
      expect(cut.shapes.filter(s=>!s.strokeWidth).length).toBeGreaterThan(1);
      expect(cut.shapes.filter(s=>s.strokeWidth).every(s=>s.fillEnabled===false)).toBe(true);
    }
    const next=pencil(reopened,230);
    expect(next.retainedOverlap).toBeUndefined();
    expect(next.shapes.filter(s=>!s.strokeWidth).length).toBeGreaterThan(reopened.filter(s=>!s.strokeWidth).length);
  }
});

import { expect, it } from 'vitest';
import type { Point, Vector } from '../packages/document/src';
import { prepareBrushPaint } from '../packages/geometry/src/brush-commit';
import { preparePaintDrop } from '../packages/geometry/src/clip-paint';
import { hit, worldPoint } from '../packages/geometry/src';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { horizontal, vertical } from './brush-overpaint-fixture';

function brush(id:string,points:Point[]) {
  const source:Vector = {id,kind:'brush',x:0,y:0,width:400,height:320,rotation:0,strokeWidth:24,
    stroke:'#222222',fill:'#0077ff',points};
  return prepareBrushPaint([],{brush:source,mode:'normal',amount:.5,optimize:true,merge:true,at:0,selected:[]}).shapes[0];
}

it('cuts a stationary fill under a moved rounded rectangle and straight paint together', () => {
  const base: Vector = {
    id: 'blue', kind: 'polygon', x: 160, y: 115, width: 100, height: 60, rotation: 0, fill: '#0000ff',
    stroke: '#ff0000', strokeWidth: 0, points: [], closed: true, fillEnabled: true, fillRule: 'evenodd',
    contours: [[{x:0,y:45},{x:30,y:45},{x:30,y:0},{x:100,y:0},{x:100,y:60},{x:0,y:60}]],
  };
  const rounded: Vector = { ...base, id: 'rounded', kind: 'rectangle', x: 180, y: 90, fill: '#ff0000',
    cornerRadius: 18, contours: undefined };
  const straight: Vector = { ...base, id: 'straight', x: 260, width: 30, height: 45,
    contours: [[{x:0,y:0},{x:30,y:0},{x:30,y:45},{x:0,y:45}]] };
  const remote = { ...base, id: 'remote', x: 350 };
  const input = [remote, base, rounded, straight], before = structuredClone(input);
  const result = preparePaintDrop(input, [rounded.id, straight.id], [remote.id, base.id]);
  expect(result.preservedDestination).toBe(false);
  expect(result.artwork[0]).toBe(remote);
  expect(result.artwork.slice(-2)).toEqual([rounded, straight]);
  const lower = result.artwork.slice(1, -2);
  expect(lower.some(s => hit(s, {x:205,y:130}, 0))).toBe(false);
  expect(lower.some(s => hit(s, {x:235,y:165}, 0))).toBe(true);
  expect(lower.some(s => s.contours?.some(r => r.some(node => node.in || node.out)))).toBe(true);
  expect(input).toEqual(before);
});

it('unites an overlapping fill and another destination sharing the incoming exterior edge',()=>{
  const base:Vector={id:'left',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,points:[],
    fill:'#2277ff',stroke:'#222222',strokeWidth:0};
  const right={...base,id:'right',x:30,width:10}, moving={...base,id:'moving',x:10};
  const drop=preparePaintDrop([base,right,moving],[moving.id],[base.id,right.id]);
  expect(drop.artwork).toHaveLength(1);
  expect([5,25,35].every(x=>hit(drop.artwork[0],{x,y:10},0))).toBe(true);
});

it.each([false,true])('joins a dropped Brush to the paint it reaches with separate same-color paint in overlapping bounds (crossing ink %s)',crossInk=>{
  const base={...brush('base',horizontal),pivot:{x:-23,y:19}};
  const moving=brush('moving',vertical);
  moving.x+=0.375;
  moving.y+=0.125;
  const near=brush('near',[{x:55,y:70},{x:55,y:0},{x:110,y:0},{x:225,y:0}]);
  const existingInk:Vector={id:'existing',kind:'path',x:0,y:0,width:240,height:120,rotation:0,
    fillEnabled:false,fill:'#000000',stroke:'#aa1177',strokeWidth:2,points:[{x:110,y:164},{x:190,y:167}]};
  const input=[base,near,...(crossInk?[existingInk]:[]),moving], before=structuredClone(input);
  const result=preparePaintDrop(input,[moving.id],input.slice(0,-1).map(s=>s.id));
  expect(result.preservedDestination).toBe(false);
  expect(result.absorbedFill).toEqual({moving:moving.id,into:base.id});
  expect(result.artwork.filter(s=>!s.strokeWidth).map(s=>s.id)).toEqual([base.id,near.id]);
  expect(result.artwork[1]).toBe(near);
  const united=result.artwork[0];
  expect(united.contours).toHaveLength(1);
  expect(united.contours![0].some(n=>n.in || n.out)).toBe(true);
  expect(worldPoint(united,united.pivot!)).toEqual(worldPoint(base,base.pivot));
  const owners=(art:Vector[],x:number,y:number)=>art.filter(s=>!s.strokeWidth && hit(s,{x,y},0)).map(s=>s.id);
  for (const [x,y] of [[90,120],[145,70],[145,120]]) expect(owners(result.artwork,x,y)).toEqual([base.id]);
  expect(owners(result.artwork,195,0)).toEqual([near.id]);
  if (crossInk) {
    const ink=result.artwork.filter(s=>s.strokeWidth);
    expect(ink).toHaveLength(2);
    expect(ink.every(s=>s.fillEnabled===false && s.stroke===existingInk.stroke)).toBe(true);
    expect(ink.some(s=>hit(s,{x:145,y:165},0))).toBe(false);
  }
  expect(input).toEqual(before);

  const ink:Vector={id:'pencil',kind:'path',x:0,y:0,width:100,height:1,rotation:0,
    fillEnabled:false,fill:'#000000',stroke:'#111111',strokeWidth:1,points:[{x:98,y:85},{x:198,y:86}]};
  const cut=prepareShapeDrawing(result.artwork,{shape:ink,merge:true});
  expect(cut.retainedOverlap).toBeUndefined();
  const above=owners(cut.shapes,145,70), below=owners(cut.shapes,145,120);
  expect(above).toHaveLength(1);
  expect(below).toHaveLength(1);
  expect(above).not.toEqual(below);
  expect(owners(cut.shapes,195,0)).toEqual([near.id]);
});

it('unites two floating Brush pieces with the same destination in original paint order',()=>{
  const target=brush('destination',vertical);
  const upper=brush('upper',horizontal), lower=brush('lower',horizontal);
  upper.y-=26;
  lower.y+=29;
  const input=[upper,target,lower], original=structuredClone(input);
  const result=preparePaintDrop(input,[lower.id,upper.id],[target.id]);
  expect(result.absorbedFills).toEqual([{moving:upper.id,into:target.id},{moving:lower.id,into:target.id}]);
  expect(result.artwork.map(s=>s.id)).toEqual([target.id]);
  const outline=result.artwork[0];
  expect(outline.contours).toHaveLength(1);
  expect(outline.contours![0].some(n=>n.in || n.out)).toBe(true);
  for (const [x,y] of [[145,70],[145,94],[75,94],[145,149],[215,149]]) expect(hit(outline,{x,y},0)).toBe(true);
  expect(hit(outline,{x:75,y:120},0)).toBe(false);
  const protectedDrop=preparePaintDrop(input,[upper.id,lower.id],[target.id],false);
  expect(protectedDrop.absorbedFills).toBeUndefined();
  expect(protectedDrop.artwork.slice(-2)).toEqual([upper,lower]);
  expect(input).toEqual(original);
});

it('keeps the destination owner when a later floating piece bridges two connected fills',()=>{
  const rect=(id:string,x:number,width:number):Vector=>({id,x,y:10,width,height:24,kind:'rectangle',
    rotation:0,points:[],strokeWidth:0,stroke:'#222222',fill:'#0088ff',drawingMode:'merge'});
  const left=rect('left',0,20), right=rect('right',80,20);
  const first=rect('first',10,30), bridge=rect('bridge',35,55);
  const outside=rect('outside',140,18);
  const drop=preparePaintDrop([left,right,first,bridge,outside],[first.id,bridge.id,outside.id],[left.id,right.id]);
  expect(drop.artwork.map(s=>s.id)).toEqual([right.id,outside.id]);
  expect(drop.artwork[1]).toBe(outside);
  expect(drop.absorbedFills).toEqual([{moving:first.id,into:right.id},{moving:bridge.id,into:right.id}]);
  for (let x=1;x<100;x+=2) expect(hit(drop.artwork[0],{x,y:20},0)).toBe(true);
});

it('joins a carried fill past an earlier different color whose bounds overlap but whose paint is separate', () => {
  const make = (id:string, fill:string, points:Point[]):Vector => ({
    id, kind:'polygon', x:0, y:0, width:90, height:65, rotation:0, points:[], drawingMode:'merge',
    fill, stroke:fill, strokeWidth:0, fillRule:'evenodd', closed:true, contours:[points],
  });
  const color = '#0088ff';
  const destination = make('destination',color,[{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}]);
  const other = make('orange','#dd5522',[{x:72,y:19},{x:89,y:19},{x:89,y:42}]);
  const moving = make('blue',color,[{x:15,y:5},{x:75,y:5},{x:15,y:65}]);
  const original = [destination,other,moving], snapshot = structuredClone(original);
  const result = preparePaintDrop(original,[other.id,moving.id],[destination.id]);
  expect(result.preservedDestination).toBe(false);
  expect(result.absorbedFills).toEqual([{moving:moving.id,into:destination.id}]);
  expect(result.artwork.map(s=>s.id)).toEqual([destination.id,other.id]);
  expect(result.artwork[1]).toBe(other);
  for (const p of [{x:5,y:20},{x:20,y:20},{x:55,y:10}]) expect(hit(result.artwork[0],p,0)).toBe(true);
  expect(original).toEqual(snapshot);
  const crossing = {...other,x:-15};
  const blocked = preparePaintDrop([destination,crossing,moving],[crossing.id,moving.id],[destination.id]);
  expect(blocked.absorbedFills).toBeUndefined();
  expect(blocked.artwork.slice(-2)).toEqual([crossing,moving]);
});

it('keeps an earlier moved Pencil above its original destination and below a later overlapping moved fill',()=>{
  const destination=brush('destination',vertical), paint=brush('paint',horizontal);
  const ink:Vector={id:'ink',x:0,y:0,width:100,height:1,rotation:0,kind:'path',fill:'#000000',stroke:'#000000',
    strokeWidth:2,fillEnabled:false,points:[{x:90,y:120},{x:170,y:120}]};
  const result=preparePaintDrop([destination,ink,paint],[ink.id,paint.id],[destination.id]);
  expect(result.artwork.slice(-2)).toEqual([ink,paint]);
  expect(result.artwork.at(-1)).toBe(paint);
  expect(result.artwork.slice(0,-2).some(s=>hit(s,{x:145,y:120},0))).toBe(false);
});

it('joins across the bounds of intervening paint only when raising the lower fill preserves its visible area',()=>{
  const face=(id:string,fill:string,ring:number[][]):Vector=>({
    kind:'polygon',id,fill,stroke:fill,strokeWidth:0,drawingMode:'merge',x:0,y:0,width:60,height:34,
    rotation:0,points:[],fillRule:'evenodd',contours:[ring.map(([x,y])=>({x,y}))],closed:true,
  });
  const square=(id:string,x:number)=>face(id,'#7755ff',[[x,0],[x+20,0],[x+20,20],[x,20]]);
  const left=square('left',0), right=square('right',40);
  const bridge=face('bridge',left.fill,[[10,3],[50,3],[50,8],[10,8]]);
  for (const overlap of [false,true]) {
    const green=face('green','#339944',overlap ? [[5,24],[24,5],[24,24]] : [[10,34],[34,10],[34,34]]);
    const original=[left,green,right,bridge];
    const result=preparePaintDrop(original,[bridge.id],[left.id,green.id,right.id]);
    const visible=(x:number,y:number)=>result.artwork.filter(s=>hit(s,{x,y},0)).at(-1);
    expect(visible(18,18)?.fill).toBe(overlap ? green.fill : left.fill);
    expect(visible(21,22)?.fill).toBe(overlap ? green.fill : undefined);
    if (!overlap) {
      expect(result.absorbedFill).toEqual({moving:bridge.id,into:right.id});
      expect([visible(5,5),visible(30,5),visible(55,5)].every(s=>s?.id===right.id)).toBe(true);
      expect(result.artwork).toEqual([green,visible(5,5)]);
    }
  }
});

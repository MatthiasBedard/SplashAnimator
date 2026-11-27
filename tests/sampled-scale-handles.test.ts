import {it,expect} from 'vitest';
import type {Vector} from '../packages/document/src';
import {sampledScaleHandles,sampledGroupScaleHandles,sampledScaleFactors} from '../apps/editor/src/sampled-scale-handles';
const shape:Vector={id:'a',kind:'rectangle',x:80,y:10,width:40,height:20,rotation:0,fill:'#f00',stroke:'#000',strokeWidth:0,points:[]};
const view={origin:{x:100,y:100},zoom:.5,width:400,height:200,cssWidth:300,cssHeight:100};
it('projects original corners and their scaled locations through nonuniform CSS dimensions',()=>{
 const h=sampledScaleHandles(shape,view);expect(h.pivot).toEqual({x:100,y:20});
 expect(h.handles.filter(h=>!h.id.startsWith('scale-')).map(h=>[h.id,h.point.x,h.point.y])).toEqual([['nw',105,52.5],['ne',120,52.5],['se',120,57.5],['sw',105,57.5]]);
 const moved=sampledScaleHandles(shape,view,{x:2,y:.5});expect(moved.handles.find(h=>h.id==='se')!.point).toEqual({x:127.5,y:56.25});
});
it('retains only viable corners at a saved pivot and provides viable flat-artwork edge handles',()=>{
 const h=sampledScaleHandles({...shape,pivot:{x:0,y:0}},view);expect(h.pivot).toEqual({x:80,y:10});expect(h.handles.map(h=>h.id)).toEqual(['se','scale-e','scale-s']);
 expect(sampledScaleHandles({...shape,height:0},view).handles.map(h=>h.id)).toEqual(['scale-e','scale-w']);
});
it('resolves factors from the captured pointer and pivot with existing proportional/reflection/minimum rules',()=>{
 const {pivot,box}=sampledScaleHandles(shape,view),start={x:120,y:30};
 expect(sampledScaleFactors(box,pivot,start,{x:140,y:25},false)).toEqual({x:2,y:.5});
 expect(sampledScaleFactors(box,pivot,start,{x:140,y:25},true)).toEqual({x:2,y:2});
 expect(sampledScaleFactors(box,pivot,start,{x:80,y:25},false)).toEqual({x:-1,y:.5});
 expect(sampledScaleFactors(box,pivot,start,pivot,false)).toEqual({x:.0001,y:.0001});
 expect(sampledScaleFactors(box,pivot,start,start,false)).toEqual({x:1,y:1});
});
it('rejects singular pivots, invalid original coordinates, factors and views',()=>{
 const {pivot,box}=sampledScaleHandles(shape,view);
 expect(()=>sampledScaleFactors(box,pivot,pivot,{x:120,y:30},false)).toThrow(/pivot/);
 expect(()=>sampledScaleFactors(box,pivot,{x:120,y:30},{x:NaN,y:30},false)).toThrow(/finite/);
 expect(()=>sampledScaleHandles(shape,view,{x:Infinity,y:1})).toThrow();
 expect(()=>sampledScaleHandles({...shape,pivot:{x:NaN,y:0}},view)).toThrow();
 expect(()=>sampledScaleHandles(shape,{...view,cssWidth:0})).toThrow();
});


for(const edge of ['n','e','s','w'])it('keeps the orthogonal document axis unchanged with Shift and large pointer travel, edge '+edge,()=>{
 const {box,pivot,handles}=sampledScaleHandles(shape,view);
 expect(handles.some(h=>h.id==='scale-'+edge)).toBe(true);
 const horizontal=edge==='e'||edge==='w',start={x:edge==='e'?120:edge==='w'?80:100,y:edge==='n'?10:edge==='s'?30:20};
 const end={x:horizontal?pivot.x+2*(start.x-pivot.x):999,y:horizontal?-999:pivot.y+.5*(start.y-pivot.y)};
 expect(sampledScaleFactors(box,pivot,start,end,true,'scale-'+edge)).toEqual(horizontal?{x:2,y:1}:{x:1,y:.5});
});
it('projects midpoint factors, handles reflected saved bases, minimum scale and rejects unusable edges',()=>{
 const h=sampledScaleHandles({...shape,pivot:{x:0,y:0},transform:[-1,0,0,1]},view);
 expect(h.handles.some(p=>p.id==='scale-w')).toBe(true);expect(h.handles.some(p=>p.id==='scale-e')).toBe(false);
 const {pivot,box}=sampledScaleHandles(shape,view);
 expect(sampledScaleFactors(box,pivot,{x:120,y:20},pivot,true,'scale-e')).toEqual({x:.0001,y:1});
 expect(sampledScaleFactors(box,pivot,{x:120,y:20},{x:80,y:999},true,'scale-e')).toEqual({x:-1,y:1});
 expect(()=>sampledScaleFactors(box,pivot,{x:100,y:10},{x:120,y:20},false,'scale-e')).toThrow(/pivot/);
 expect(()=>sampledScaleFactors(box,pivot,{x:120,y:20},pivot,false,'scale-bad')).toThrow(/valid/);
});

it('projects complete-group corners and midpoints from the full original union and common pivot',()=>{
 const members=[shape,{...shape,id:'b',x:160,y:40,width:20}];
 const h=sampledGroupScaleHandles(members,view);
 expect(h.box).toEqual({left:80,top:10,right:180,bottom:60});expect(h.pivot).toEqual({x:130,y:35});
 expect(h.handles.map(h=>h.id)).toEqual(['nw','ne','se','sw','scale-n','scale-e','scale-s','scale-w']);
 expect(h.handles.find(h=>h.id==='se')!.point).toEqual({x:142.5,y:65});
 const scaled=sampledGroupScaleHandles(members,view,{x:1.5,y:.5});
 expect(scaled.handles.find(h=>h.id==='se')!.point).toEqual({x:151.875,y:61.875});
});
it('uses a common saved affine pivot and retains viable group corners and edges',()=>{
 const members=[{...shape,pivot:{x:0,y:0},transform:[2,0,0,1] as [number,number,number,number]},
  {...shape,id:'b',x:160,pivot:{x:-40,y:0},transform:[2,0,0,1] as [number,number,number,number]}];
 const before=structuredClone(members),h=sampledGroupScaleHandles(members,view);
 expect(h.pivot).toEqual({x:80,y:10});expect(h.handles.map(h=>h.id)).toEqual(['se','scale-e','scale-s']);expect(members).toEqual(before);
});
it('keeps flat complete-group artwork intact without inventing corner axes',()=>{
 const members=[{...shape,height:0},{...shape,id:'b',x:160,height:0}];
 expect(sampledGroupScaleHandles(members,view).handles.map(h=>h.id)).toEqual(['scale-e','scale-w']);
 expect(()=>sampledGroupScaleHandles([],view)).toThrow();
 expect(()=>sampledGroupScaleHandles([{...shape,pivot:{x:NaN,y:0}}],view)).toThrow();
});

it('keeps the inactive group axis fixed under Shift and arbitrary orthogonal travel',()=>{
 const {box,pivot}=sampledGroupScaleHandles([shape,{...shape,id:'b',x:160,y:40,width:20}],view);
 expect(sampledScaleFactors(box,pivot,{x:180,y:35},{x:230,y:999},true,'scale-e')).toEqual({x:2,y:1});
 expect(sampledScaleFactors(box,pivot,{x:130,y:60},{x:-999,y:47.5},true,'scale-s')).toEqual({x:1,y:.5});
});
it('retains viable vertical flat group axes and coincident edge/corner positions',()=>{
 const vertical=[{...shape,width:0},{...shape,id:'b',width:0,y:50}];
 expect(sampledGroupScaleHandles(vertical,view).handles.map(h=>h.id)).toEqual(['scale-n','scale-s']);
 const flat=[{...shape,height:0,pivot:{x:0,y:-10}}];
 const h=sampledGroupScaleHandles(flat,view);
 expect(h.handles.find(h=>h.id==='ne')!.point).toEqual(h.handles.find(h=>h.id==='scale-e')!.point);
});

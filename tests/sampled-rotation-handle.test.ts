import {expect,it} from 'vitest';
import type {Vector} from '../packages/document/src';
import {sampledRotationHandle,sampledGroupRotationHandle,rotationLocal,type RotationView} from '../apps/editor/src/sampled-rotation-handle';
const shape:Vector={id:'a',kind:'rectangle',x:80,y:10,width:40,height:12,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
const view:RotationView={origin:{x:100,y:100},zoom:.5,width:400,height:200,cssWidth:300,cssHeight:100};
it('uses the authoring center and inverse CSS projection for one frozen view',()=>{
 const h=sampledRotationHandle(shape,view);
 expect(h.pivot).toEqual({x:100,y:16});expect(h.center).toEqual({x:112.5,y:54});
 expect(h.knob).toEqual({x:112.5,y:22});
 expect(rotationLocal(h.center,view)).toEqual(h.pivot);
 const rotated=sampledRotationHandle(shape,view,90);
 expect(rotated.knob.x).toBeCloseTo(160.5);expect(rotated.knob.y).toBeCloseTo(54);
});
it('uses the saved affine world pivot and flips a top-edge handle below it',()=>{
 const h=sampledRotationHandle({...shape,pivot:{x:2,y:4},transform:[-2,0,1,3]}, {...view,origin:{x:0,y:0}});
 expect(h.pivot).toEqual({x:80,y:22});expect(h.center).toEqual({x:30,y:5.5});expect(h.knob).toEqual({x:30,y:37.5});
});
it('rejects invalid views and nonfinite original pivots',()=>{
 for(const key of ['zoom','width','height','cssWidth','cssHeight'] as const){
  expect(()=>sampledRotationHandle(shape,{...view,[key]:0})).toThrow();
  expect(()=>sampledRotationHandle(shape,{...view,[key]:NaN})).toThrow();
 }
 expect(()=>sampledRotationHandle({...shape,pivot:{x:NaN,y:0}},view)).toThrow();
});

it('projects the complete union center rather than one member or subgroup',()=>{
 const members=[shape,{...shape,id:'b',x:160,y:30,width:20,groups:['outer','inner']}];
 const h=sampledGroupRotationHandle(members,view);
 expect(h.pivot).toEqual({x:130,y:26});expect(rotationLocal(h.center,view)).toEqual(h.pivot);
 expect(h.center).toEqual({x:123.75,y:56.5});expect(h.knob).toEqual({x:123.75,y:24.5});
});
it('maps shared saved affine pivots and retains the original complete member geometry',()=>{
 const members=[{...shape,pivot:{x:0,y:0},transform:[-2,0,1,3] as [number,number,number,number]},
  {...shape,id:'b',x:100,pivot:{x:10,y:0},transform:[-2,0,1,3] as [number,number,number,number]}];
 const before=structuredClone(members),h=sampledGroupRotationHandle(members,view,90);
 expect(h.pivot).toEqual({x:80,y:10});expect(rotationLocal(h.center,view)).toEqual(h.pivot);
 expect(members).toEqual(before);
});
it('falls back to the union when saved pivots differ or a member has none',()=>{
 const members=[{...shape,pivot:{x:0,y:0}},{...shape,id:'b',x:160,y:30,width:20,pivot:{x:0,y:0}}];
 expect(sampledGroupRotationHandle(members,view).pivot).toEqual({x:130,y:26});
 delete (members[1] as Vector).pivot;
 expect(sampledGroupRotationHandle(members,view).pivot).toEqual({x:130,y:26});
});
it('rejects empty groups and original nonfinite member values before layout',()=>{
 expect(()=>sampledGroupRotationHandle([],view)).toThrow();
 expect(()=>sampledGroupRotationHandle([shape,{...shape,id:'b',pivot:{x:NaN,y:0}}],view)).toThrow(/nonfinite/);
 expect(()=>sampledGroupRotationHandle([{...shape,points:[{x:Infinity,y:0}]}],view)).toThrow(/nonfinite/);
});

for(const group of [false,true])for(const [x,y]of [[-2000,16],[2000,16],[100,-2000],[100,2000],[-2000,-2000],[2000,-2000],[-2000,2000],[2000,2000]])it('keeps the '+(group?'group':'single')+' authoring pivot '+x+','+y+' and exposes its initial control',()=>{
 const members=[{...shape,pivot:{x:x-shape.x,y:y-shape.y}},{...shape,id:'b',x:160,pivot:{x:x-160,y:y-shape.y}}],before=structuredClone(members);
 const h=group?sampledGroupRotationHandle(members,view):sampledRotationHandle(members[0],view);
 expect(h.pivot).toEqual({x,y});expect(h.center).toEqual({x:(x*.5+100)*.75,y:(y*.5+100)*.5});
 expect(h.knob.x).toBeGreaterThanOrEqual(12);expect(h.knob.x).toBeLessThanOrEqual(view.cssWidth-12);expect(h.knob.y).toBeGreaterThanOrEqual(12);expect(h.knob.y).toBeLessThanOrEqual(view.cssHeight-12);
 const start=rotationLocal(h.knob,view),turned=group?sampledGroupRotationHandle(members,view,30):sampledRotationHandle(members[0],view,30),local=rotationLocal(turned.knob,view),c=Math.cos(Math.PI/6),n=Math.sin(Math.PI/6);
 expect(local.x).toBeCloseTo(x+c*(start.x-x)-n*(start.y-y),10);expect(local.y).toBeCloseTo(y+n*(start.x-x)+c*(start.y-y),10);expect(members).toEqual(before);
});
it('keeps tiny valid views finite without changing pivot or introducing a view size cap',()=>{const h=sampledRotationHandle({...shape,pivot:{x:-2000,y:-2000}},{...view,cssWidth:10,cssHeight:8});expect(h.knob).toEqual({x:5,y:4});expect(h.pivot).toEqual({x:-1920,y:-1990});});
it('rejects overflow in the original projected pivot before making a control reachable',()=>{expect(()=>sampledRotationHandle({...shape,pivot:{x:1e308,y:0}},{...view,zoom:1e308})).toThrow();});

for(const group of [false,true])it('retains the off-view default '+(group?'union':'artwork')+' center without inventing a saved pivot',()=>{
 const a={...shape,x:-2000},members=[a,{...a,id:'b',x:-1960,y:30}],before=structuredClone(members),h=group?sampledGroupRotationHandle(members,view):sampledRotationHandle(a,view);
 expect(h.pivot).toEqual(group?{x:-1960,y:26}:{x:-1980,y:16});expect(h.knob.x).toBe(12);expect(h.knob.y).toBeGreaterThanOrEqual(12);expect(h.knob.y).toBeLessThanOrEqual(view.cssHeight-12);expect(members).toEqual(before);
});

import {expect,it} from 'vitest';
import type {Vector} from '../packages/document/src';
import {sampledSkewHandles,sampledGroupSkewHandles,sampledSkewAngle} from '../apps/editor/src/sampled-skew-handles';
const shape:Vector={id:'a',kind:'rectangle',x:80,y:10,width:40,height:20,rotation:0,fill:'#f00',stroke:'#000',strokeWidth:0,points:[]};
const view={origin:{x:100,y:100},zoom:.5,width:400,height:200,cssWidth:300,cssHeight:100};
it('projects original and sheared diamonds/outline through nonuniform CSS dimensions',()=>{
 const h=sampledSkewHandles(shape,view);
 expect(h.handles.map(h=>[h.id,h.point.x,h.point.y])).toEqual([['skew-n',112.5,52.5],['skew-e',120,55],['skew-s',112.5,57.5],['skew-w',105,55]]);
 const moved=sampledSkewHandles(shape,view,'x',30),shear=Math.tan(Math.PI/6);
 expect(moved.handles[0].point.x).toBeCloseTo(75+.375*(100-10*shear),12);
 expect(moved.outline[0].x).toBeCloseTo(75+.375*(80-10*shear),12);
 expect(moved.outline[0].y).toBe(52.5);
 expect(sampledSkewHandles({...shape,pivot:{x:0,y:0}},view).handles.map(h=>h.id)).toEqual(['skew-e','skew-s']);
 expect(sampledSkewHandles({...shape,height:0},view).handles.map(h=>h.id)).toEqual(['skew-e','skew-w']);
 expect(sampledSkewHandles({...shape,width:0},view).handles.map(h=>h.id)).toEqual(['skew-n','skew-s']);
});
for(const edge of ['n','e','s','w'])it('resolves the captured '+edge+' edge to its document shear axis',()=>{
 const {box,pivot}=sampledSkewHandles(shape,view),horizontal=edge==='n'||edge==='s';
 const start={x:edge==='e'?120:edge==='w'?80:100,y:edge==='n'?10:edge==='s'?30:20};
 const end={x:start.x+(horizontal?10:100),y:start.y+(horizontal?100:10)};
 const result=sampledSkewAngle('skew-'+edge,box,pivot,start,end,false);
 const expected=10/(horizontal?start.y-pivot.y:start.x-pivot.x);
 expect(result.axis).toBe(horizontal?'x':'y');expect(result.degrees).toBeCloseTo(Math.atan(expected)*180/Math.PI,12);
 expect(sampledSkewAngle('skew-'+edge,box,pivot,start,start,false).degrees===0).toBe(true);
});
it('keeps existing Shift/right-angle/pivot/numeric guards',()=>{
 const {box,pivot}=sampledSkewHandles(shape,view),start={x:100,y:30};
 expect(sampledSkewAngle('skew-s',box,pivot,start,{x:104,y:30},true).degrees).toBeCloseTo(15,12);
 expect(()=>sampledSkewAngle('skew-s',box,pivot,start,{x:100+10*Math.tan(85*Math.PI/180),y:30},true)).toThrow(/90 degrees/);
 expect(()=>sampledSkewAngle('skew-s',box,start,start,{x:105,y:30},false)).toThrow(/pivot/);
 expect(()=>sampledSkewAngle('bad',box,pivot,start,start,false)).toThrow(/valid/);
 expect(()=>sampledSkewAngle('skew-s',box,pivot,start,{x:NaN,y:30},false)).toThrow(/finite/);
 expect(()=>sampledSkewHandles(shape,view,'x',90)).toThrow();
 expect(()=>sampledSkewHandles({...shape,pivot:{x:NaN,y:0}},view)).toThrow();
});

it('uses full group bounds/common pivots for diamonds and transformed outlines',()=>{
 const members=[shape,{...shape,id:'b',x:160,y:40,width:20}],before=structuredClone(members);
 const h=sampledGroupSkewHandles(members,view,'x',30),k=Math.tan(Math.PI/6);
 expect(h.pivot).toEqual({x:130,y:35});expect(h.box).toEqual({left:80,top:10,right:180,bottom:60});
 expect(h.handles.map(p=>p.id)).toEqual(['skew-n','skew-e','skew-s','skew-w']);
 expect(h.outline[0].x).toBeCloseTo((100+.5*(80-25*k))*300/400,12);
 expect(h.outline[0].y).toBe(52.5);expect(members).toEqual(before);
});
it('retains saved group pivots, viable flat axes and original numeric rejection',()=>{
 const members=[{...shape,pivot:{x:0,y:0}},{...shape,id:'b',x:160,pivot:{x:-80,y:0}}];
 expect(sampledGroupSkewHandles(members,view).pivot).toEqual({x:80,y:10});
 expect(sampledGroupSkewHandles(members,view).handles.map(p=>p.id)).toEqual(['skew-e','skew-s']);
 expect(sampledGroupSkewHandles([{...shape,height:0}],view).handles.map(p=>p.id)).toEqual(['skew-e','skew-w']);
 expect(()=>sampledGroupSkewHandles([],view)).toThrow();
 expect(()=>sampledGroupSkewHandles([{...shape,pivot:{x:NaN,y:0}}],view)).toThrow();
 expect(()=>sampledGroupSkewHandles(members,view,'x',90)).toThrow();
});

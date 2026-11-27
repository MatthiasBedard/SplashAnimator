import {expect,it} from 'vitest';
import {clone,type Vector,type BezierNode} from '../packages/document/src';
import {inverseMotionContourAlignment,shiftMotionContourStart} from '../packages/animation/src/motion-nodes';
function ring(n:number,k=0):BezierNode[]{return Array.from({length:n},(_,i)=>({x:i+10*k,y:i*i+3*k,...(i%2?{in:{x:i-0.25,y:i*i-1}}:{out:{x:i+0.5,y:i*i+1}})}));}
function shape():Vector{return {id:'a',kind:'polygon',x:10,y:20,width:100,height:100,rotation:20,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],contours:[ring(3),ring(5,1),ring(4,2)]};}
it('inverts all compound permutations, directions and unequal contour offsets exactly',()=>{
 for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]])for(let mask=0;mask<8;mask++)for(const start of [[0,0,0],[1,3,2],[Number.MAX_SAFE_INTEGER,27,8]]){
  const source=shape(),before=clone(source),reverse=[0,1,2].map(i=>Boolean(mask&(1<<i))),inverse=inverseMotionContourAlignment(source,start,reverse,order),aligned=shiftMotionContourStart(source,start,reverse,order);
  expect(shiftMotionContourStart(aligned,inverse.start,inverse.reverse,inverse.order)).toEqual(source);expect(source).toEqual(before);
  inverse.order[0]=99;inverse.start[0]=99;inverse.reverse[0]=!reverse[0];expect(source).toEqual(before);expect(order).not.toContain(99);expect(start).not.toContain(99);
 }
});
it('inverts open and closed Bezier direction and asymmetric handle ownership',()=>{
 for(const closed of [false,true])for(const reverse of [false,true])for(const start of closed?[0,1,3,Number.MAX_SAFE_INTEGER]:[0]){
  const source={...shape(),kind:'bezier' as const,closed,nodes:ring(4)};delete source.contours;const before=clone(source),inverse=inverseMotionContourAlignment(source,start,reverse),aligned=shiftMotionContourStart(source,start,reverse);
  expect(shiftMotionContourStart(aligned,inverse.start,inverse.reverse,inverse.order)).toEqual(source);expect(source).toEqual(before);
 }
});
it('rejects malformed originals, incompatible alignment and degenerate contours without mutation',()=>{
 const source=shape(),before=clone(source);
 for(const start of [NaN,-1,1.5,[],[0,0]])expect(()=>inverseMotionContourAlignment(source,start)).toThrow();
 for(const order of [[0,0,2],[0,1],[0,1,3]])expect(()=>inverseMotionContourAlignment(source,0,false,order)).toThrow();
 expect(()=>inverseMotionContourAlignment(source,0,[true])).toThrow();
 const bad=clone(source);bad.contours![0][0].out!.x=NaN;expect(()=>inverseMotionContourAlignment(bad,0)).toThrow(/finite/);expect(Number.isNaN(bad.contours![0][0].out!.x)).toBe(true);
 for(const contours of [[],[[]],[[{x:0,y:0},{x:1,y:0},{x:0,y:0}]]])expect(()=>inverseMotionContourAlignment({...source,contours},0)).toThrow();
 expect(()=>inverseMotionContourAlignment({...source,kind:'rectangle'},0)).toThrow();
 expect(()=>inverseMotionContourAlignment({...source,kind:'bezier',closed:false,nodes:ring(4)},1)).toThrow(/Open/);
 expect(source).toEqual(before);
});

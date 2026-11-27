import { expect, it } from 'vitest';
import { motionGroupPreview } from '../apps/editor/src/motion-group-preview';
import type { Vector } from '../packages/document/src';
const a: Vector = { id:'a',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,
  fill:'#f00',stroke:'#000',strokeWidth:0,points:[],groups:['g'],pivot:{x:10,y:0} };
const from=[a,{...a,id:'b',x:20}], to=[{...a,x:100,rotation:90},{...a,id:'b',x:100,y:20,rotation:90}];
const path={startX:0,startY:-40,endX:0,endY:-40};
it('previews the pivot-corrected leader orbit without mutating endpoints or path',()=>{
  const before=structuredClone({from,to,path});
  const points=motionGroupPreview(from,to,{direction:'shortest',turns:0,rigidGroups:true,savedGroupPivots:true},path);
  expect(points).toHaveLength(65);
  expect(points[0]).toEqual({x:0,y:0}); expect(points.at(-1)).toEqual({x:100,y:0});
  // At half progress the moving pivot is (55,-25), with a rotated (-10,0) offset.
  expect(points[32].x).toBeCloseTo(55-10/Math.sqrt(2),12);
  expect(points[32].y).toBeCloseTo(-25-10/Math.sqrt(2),12);
  expect({from,to,path}).toEqual(before);
});
it('bounds optional preview work and rejects incompatible endpoints without writes',()=>{
  const rotation={direction:'clockwise' as const,turns:100,rigidGroups:true};
  expect(()=>motionGroupPreview(from,to,rotation,path)).toThrow(/sampling limit/);
  expect(()=>motionGroupPreview(from,[],rotation,path)).not.toThrow();
  expect(()=>motionGroupPreview(from,[to[0]],rotation,path)).toThrow(/matching endpoints/);
  expect(motionGroupPreview(from,to,{direction:'shortest',turns:0},path)).toEqual([]);
});

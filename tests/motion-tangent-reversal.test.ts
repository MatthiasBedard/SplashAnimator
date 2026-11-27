import {expect,it} from 'vitest';
import {createMotionPathSampler,reverseMotionPath,reverseTangentCubicPath,reverseTangentMotionPath,type MotionPath} from '../packages/animation/src/motion-path';
it('reverses continuous lifted cubic headings across branches, reflections and scales',()=>{
 for(const controls of [[160,-240,-90,130,0,0],[280,10,-280,-10,20,100],[30,20,-30,20,100,0]])for(const scale of [1e-8,1,1e8])for(const reflection of [-1,1]){
  const from={x:12*scale,y:-15*scale},to={x:from.x+controls[4]*scale,y:from.y+controls[5]*scale*reflection};
  const path:MotionPath={startX:controls[0]*scale,startY:controls[1]*scale*reflection,endX:controls[2]*scale,endY:controls[3]*scale*reflection,tangent:true};
  const before=JSON.stringify({from,to,path}),result=reverseTangentCubicPath(from,to,path),forward=createMotionPathSampler(from,to,path),backward=createMotionPathSampler(to,from,result.path);
  expect(Math.abs(result.headingOffset)%360).toBe(180);for(let i=1;i<100;i++){const t=i/100,a=forward(1-t),b=backward(t);expect(Math.abs(a.x-b.x)/scale).toBeLessThan(1e-10);expect(Math.abs(a.y-b.y)/scale).toBeLessThan(1e-10);expect(Math.abs(a.tangentAngle!-b.tangentAngle!-result.headingOffset)).toBeLessThan(1e-9);}
  expect(JSON.stringify({from,to,path})).toBe(before);const twice=reverseTangentCubicPath(to,from,result.path);expect(twice.headingOffset+result.headingOffset).toBe(0);
 }
});
it('supports stationary endpoint limits while keeping existing recipe rejection',()=>{
 const from={x:0,y:0},to={x:100,y:50},path:MotionPath={startX:0,startY:0,endX:0,endY:0,tangent:true};const result=reverseTangentCubicPath(from,to,path);const a=createMotionPathSampler(from,to,path),b=createMotionPathSampler(to,from,result.path);expect(b(0.25).tangentAngle!+result.headingOffset).toBeCloseTo(a(0.75).tangentAngle!,10);expect(()=>reverseMotionPath(from,to,path)).toThrow(/angular correction/);result.path.startX=20;expect(path.startX).toBe(0);
});
it('rejects waypoint routes, original invalid coordinates and interior cusps atomically',()=>{
 const from={x:0,y:0},to={x:100,y:0},path:MotionPath={startX:30,startY:0,endX:-30,endY:0,tangent:true};for(const bad of [{waypoints:[{x:10,y:10}]},{tangent:false},{startX:Infinity}])expect(()=>reverseTangentCubicPath(from,to,{...path,...bad})).toThrow();expect(()=>reverseTangentCubicPath({x:NaN,y:0},to,path)).toThrow(/finite/);expect(()=>reverseTangentCubicPath(from,to,{...path,startX:100,endX:-200})).toThrow(/stationary|unresolved/);expect(path).toEqual({startX:30,startY:0,endX:-30,endY:0,tangent:true});
});

it('reverses linear endpoints across lifted branches and restores them on double reversal',()=>{
 for(const reflection of [-1,1])for(const controls of [[280,10,-280,-10,20,100],[30,20,-30,20,100,0]]){
  const from={x:0,y:0},to={x:controls[4],y:controls[5]*reflection},path:MotionPath={startX:controls[0],startY:controls[1]*reflection,endX:controls[2],endY:controls[3]*reflection,tangent:true,headingOffset:12.25,headingOffsetEnd:47.5},before=JSON.stringify(path);
  const result=reverseTangentCubicPath(from,to,path),recipe={...result.path,headingOffset:result.headingOffset,headingOffsetEnd:result.headingOffsetEnd},sample=createMotionPathSampler(to,from,recipe),original=createMotionPathSampler(from,to,path);
  expect(result.headingOffsetEnd!-result.headingOffset).toBe(12.25-47.5);
  for(let i=1;i<100;i++)expect(sample(i/100).tangentAngle).toBeCloseTo(original(1-i/100).tangentAngle!,9);
  const twice=reverseTangentCubicPath(to,from,recipe);expect(twice.headingOffset).toBe(path.headingOffset);expect(twice.headingOffsetEnd).toBe(path.headingOffsetEnd);expect(JSON.stringify(path)).toBe(before);
 }
});
it('rejects composed linear endpoint overflow before returning a reversed recipe',()=>{
 const from={x:0,y:0},to={x:100,y:0},base={startX:30,startY:20,endX:-30,endY:20,tangent:true},shift=reverseTangentCubicPath(from,to,base).headingOffset,limit=Math.sign(shift)*360000;
 for(const correction of [{headingOffset:limit,headingOffsetEnd:0},{headingOffset:0,headingOffsetEnd:limit}]){const path={...base,...correction},before=JSON.stringify(path);expect(()=>reverseTangentCubicPath(from,to,path)).toThrow(/correction/);expect(JSON.stringify(path)).toBe(before);}
});

it('reverses unequal-speed distance cubics at complementary distances across winding and reflection', () => {
 const from={x:0,y:0};
 for(const sign of [-1,1]){
   const to={x:20,y:100*sign};
   const path={startX:280,startY:10*sign,endX:-280,endY:-10*sign,distance:true,tangent:true,headingOffset:12.25,headingOffsetEnd:47.5};
   const original=createMotionPathSampler(from,to,path);
   const equalTime=createMotionPathSampler(from,to,{...path,distance:false});
   expect(Math.abs(original(.25).x-equalTime(.25).x)).toBeGreaterThan(.5);
   const reversed=reverseTangentCubicPath(from,to,path);
   const recipe={...reversed.path,headingOffset:reversed.headingOffset,headingOffsetEnd:reversed.headingOffsetEnd};
   expect(recipe.distance).toBe(true);
   const sample=createMotionPathSampler(to,from,recipe);
   for(const progress of [0,.01,.15,.25,.49,.5,.65,.9,.99,1]){
     const a=original(1-progress),b=sample(progress);
     for(const field of ['x','y','tangentAngle'] as const)expect(b[field]).toBeCloseTo(a[field]!,9);
   }
   const twice=reverseTangentCubicPath(to,from,recipe);
   expect([twice.headingOffset,twice.headingOffsetEnd]).toEqual([path.headingOffset,path.headingOffsetEnd]);
 }
});

it('reverses lifted straight-waypoint headings between corners in both timing modes', () => {
  for (const distance of [false,true]) for (const sign of [-1,1]) {
    const from={x:0,y:0}, to={x:60,y:18*sign};
    const path={startX:0,startY:0,endX:0,endY:0,distance,tangent:true,
      waypoints:[{x:-40,y:sign},{x:-80,y:-sign}],headingOffset:12,headingOffsetEnd:-19};
    const forward=createMotionPathSampler(from,to,path);
    const {path:geometry,headingOffset,headingOffsetEnd}=reverseTangentMotionPath(from,to,path);
    const reversed={...geometry,headingOffset,headingOffsetEnd};
    const backward=createMotionPathSampler(to,from,reversed);
    for (const t of [0,.03,.19,.39,.58,.84,.99,1]) {
      const a=forward(1-t), b=backward(t);
      for(const field of ['x','y','tangentAngle'] as const) expect(b[field]).toBeCloseTo(a[field]!,10);
    }
    const twice=reverseTangentMotionPath(to,from,reversed);
    expect([twice.headingOffset,twice.headingOffsetEnd]).toEqual([12,-19]);
  }
});

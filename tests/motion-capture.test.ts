import { expect, it } from 'vitest';
import { clone, newProject, MAX_SYMBOL_ARTWORK, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { bakeRememberedTimeline, prepareRememberedMotionCapture, prepareRememberedTimelineCapture, createRememberedMotionCaptureCache } from '../packages/animation/src/motion-capture';
function fixture(end=8){
 const p=newProject();p.duration=end+3;
 const shape:Vector={id:'a',kind:'rectangle',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
 p.layers[0].keys=[{frame:0,shapes:[shape]},{frame:end,shapes:[{...shape,x:80}]},{frame:end+1,shapes:[]}];
 createBasicMotionSpan(p,[p.layers[0].id],0,end,'linear');return p;
}
it('prepares every selected pose while preserving endpoints, outside keys and unrelated tracks',async()=>{
 const p=fixture(),a=p.layers[0],b=clone(a),other=clone(a);b.id='b';other.id='other';p.layers.push(b,other);
 a.keys[8].shapes[0].x=160;b.keys[8].shapes[0].x=240;const before=clone(p),progress:number[]=[];
 const result=await prepareRememberedMotionCapture(p,[a.id,b.id],0,8,{progress:n=>progress.push(n)});
 expect(progress).toEqual([1,2,3,4,5,6,7,8,9]);
 for(let frame=0;frame<=8;frame++){expect(result.layers[0].keys[frame].shapes[0].x).toBe(frame*20);expect(result.layers[1].keys[frame].shapes[0].x).toBe(frame*30);}
 expect(result.layers[0].keys[9]).toEqual(a.keys[9]);expect(result.layers[2]).toEqual(other);expect(p).toEqual(before);
 result.layers[2].keys[0].shapes[0].x=999;expect(p).toEqual(before);
});
it('rejects cancellation, source invalidation and progress failure without partial publication',async()=>{
 for(const mode of ['cancel','stale','progress']){
  const p=fixture(40),before=clone(p),controller=new AbortController();let stale=false;
  await expect(prepareRememberedMotionCapture(p,[p.layers[0].id],0,40,{signal:controller.signal,validate:()=>{if(stale)throw new Error('source changed')},progress:n=>{if(n===17){if(mode==='cancel')controller.abort();if(mode==='stale')stale=true;if(mode==='progress')throw new Error('progress failed')}}})).rejects.toThrow();
  expect(p).toEqual(before);
  expect((await prepareRememberedMotionCapture(p,[p.layers[0].id],0,40)).layers[0].keys).toEqual(p.layers[0].keys);
 }
});
it('yields to cancellation and rejects edited later-track interiors before reporting progress',async()=>{
 const p=fixture(40),controller=new AbortController();let count=0;
 const pending=prepareRememberedMotionCapture(p,[p.layers[0].id],0,40,{signal:controller.signal,progress:n=>{count=n;if(n===16)setTimeout(()=>controller.abort(),0)}});
 await expect(pending).rejects.toThrow();expect(count).toBe(16);
 const second=clone(p.layers[0]);second.id='second';second.keys[2].shapes[0].x=999;p.layers.push(second);count=0;
 await expect(prepareRememberedMotionCapture(p,p.layers.map(l=>l.id),0,40,{progress:()=>count++})).rejects.toThrow(/Generated keys changed/);expect(count).toBe(0);
});

it('reuses only complete captures and releases them on invalidation or source failure',async()=>{
 const p=fixture(),ids=[p.layers[0].id];let stale=false,count=0;
 const cache=createRememberedMotionCaptureCache(p,ids,0,8,()=>{if(stale)throw new Error('stale')});ids.length=0;
 const first=await cache.get(undefined,()=>count++);expect(count).toBe(9);
 expect(await cache.get(undefined,()=>count++)).toBe(first);expect(count).toBe(9);
 cache.invalidate();expect(await cache.get()).not.toBe(first);
 stale=true;await expect(cache.get()).rejects.toThrow('stale');stale=false;
 expect(await cache.get()).not.toBe(first);cache.dispose();cache.dispose();await expect(cache.get()).rejects.toThrow(/disposed/);
});
it('does not retain cancelled or invalidated preparation and rejects concurrent requests',async()=>{
 for(const action of ['abort','invalidate','dispose'] as const){
  const p=fixture(40),controller=new AbortController(),cache=createRememberedMotionCaptureCache(p,[p.layers[0].id],0,40,()=>{});
  const pending=cache.get(controller.signal,n=>{if(n===16)setTimeout(()=>{if(action==='abort')controller.abort();else cache[action]()},0)});
  await expect(cache.get()).rejects.toThrow(/already running/);
  await expect(pending).rejects.toThrow();
  if(action==='dispose')await expect(cache.get()).rejects.toThrow(/disposed/);
  else{let count=0;await cache.get(undefined,()=>count++);expect(count).toBe(41);}
 }
});
it('rejects already-aborted cache hits and source-triggered invalidation',async()=>{
 const p=fixture();let invalidate=false;
 const cache=createRememberedMotionCaptureCache(p,[p.layers[0].id],0,8,()=>{if(invalidate)cache.invalidate()});
 const first=await cache.get(),controller=new AbortController();controller.abort();await expect(cache.get(controller.signal)).rejects.toThrow();
 expect(await cache.get()).not.toBe(first);invalidate=true;await expect(cache.get()).rejects.toThrow();
 invalidate=false;expect((await cache.get()).layers[0].keys).toEqual(p.layers[0].keys);
});

it('captures independent timeline spans on locked tracks while preserving blank holds and hidden tracks',async()=>{
 const p=fixture(4),a=p.layers[0];p.duration=12;a.keys[4].shapes[0].x=160;a.locked=true;
 const b=clone(a);b.id='later';b.locked=false;b.keys=[{frame:0,shapes:[]},{frame:6,shapes:clone(a.keys[0].shapes)},{frame:10,shapes:clone(a.keys[4].shapes)}];b.motionSpans=[];p.layers.push(b);createBasicMotionSpan(p,[b.id],6,10,'linear');b.keys.find(k=>k.frame===10)!.shapes[0].x=240;
 const hidden=clone(a);hidden.id='hidden';hidden.visible=false;hidden.keys[2].shapes[0].x=999;p.layers.push(hidden);const before=clone(p);
 const capture=await prepareRememberedTimelineCapture(p);expect(capture.layers[0].keys[2].shapes[0].x).toBe(80);expect(capture.layers[1].keys.find(k=>k.frame===8)!.shapes[0].x).toBe(120);
 expect(capture.layers[1].keys[0]).toEqual({frame:0,shapes:[]});expect(capture.layers[0].keys[5]).toEqual(a.keys[5]);expect(capture.layers[2]).toEqual(hidden);expect(p).toEqual(before);
});
it('rejects a later timeline span without publishing earlier prepared frames',async()=>{
 const p=fixture(4),a=p.layers[0];p.duration=12;a.keys.push({frame:6,shapes:clone(a.keys[0].shapes)},{frame:10,shapes:clone(a.keys[4].shapes)});createBasicMotionSpan(p,[a.id],6,10,'linear');a.keys.find(k=>k.frame===8)!.shapes[0].x=999;const before=clone(p);
 await expect(prepareRememberedTimelineCapture(p)).rejects.toThrow(/Generated keys changed/);expect(p).toEqual(before);
});

it('prepares reachable nested symbol base and additional tracks, leaving unused edited definitions untouched',async()=>{
 const p=fixture(4),template=clone(p.layers[0]);p.layers[0].motionSpans=[];
 const base={id:'child',name:'Child',width:200,height:100,shapes:clone(template.keys[0].shapes),timeline:{duration:7,keys:clone(template.keys.slice(1)),motionSpans:clone(template.motionSpans),layers:[{...clone(template),id:'extra'}]}};
 base.timeline.keys.find(k=>k.frame===4)!.shapes[0].x=160;base.timeline.layers[0].keys[4].shapes[0].x=240;
 const unused=clone(base);unused.id='unused';unused.timeline.keys[1].shapes[0].x=999;
 const instance:Vector={...clone(template.keys[0].shapes[0]),id:'child-instance',kind:'symbol',symbolId:'child',symbolPlayback:{mode:'movie',firstFrame:0}};
 p.symbols=[base,unused,{id:'parent',name:'Parent',width:200,height:100,shapes:[instance]}];p.layers[0].keys=[{frame:0,shapes:[{...instance,id:'root',symbolId:'parent'}]}];const before=clone(p);
 const result=await prepareRememberedTimelineCapture(p);expect(result.symbols![0].timeline!.keys.find(k=>k.frame===2)!.shapes[0].x).toBe(80);expect(result.symbols![0].timeline!.layers![0].keys[2].shapes[0].x).toBe(120);expect(result.symbols![1]).toEqual(unused);expect(p).toEqual(before);
});
it('rejects reachable edited symbol interiors, missing definitions and aggregate artwork overflow atomically',async()=>{
 const p=fixture(4),track=clone(p.layers[0]),instance:Vector={...track.keys[0].shapes[0],kind:'symbol',symbolId:'child'};
 p.layers[0].keys=[{frame:0,shapes:[instance]}];p.layers[0].motionSpans=[];
 p.symbols=[{id:'child',name:'Child',width:20,height:20,shapes:clone(track.keys[0].shapes),timeline:{duration:7,keys:clone(track.keys.slice(1)),motionSpans:clone(track.motionSpans)}}];p.symbols[0].timeline!.keys[1].shapes[0].x=999;
 const before=clone(p);await expect(prepareRememberedTimelineCapture(p)).rejects.toThrow(/Generated keys changed/);expect(p).toEqual(before);
 p.symbols=[];await expect(prepareRememberedTimelineCapture(p)).rejects.toThrow(/missing/);
 p.symbols=[{id:'child',name:'Child',width:20,height:20,shapes:Array(MAX_SYMBOL_ARTWORK+1).fill(track.keys[0].shapes[0])}];await expect(prepareRememberedTimelineCapture(p)).rejects.toThrow(/artwork budget/);
});

it('bakes visible root and reachable symbol recipes while retaining hidden and unused ownership',async()=>{
 const p=fixture(4),root=p.layers[0];root.keys[4].shapes[0].x=160;
 const hidden=clone(root);hidden.id='hidden';hidden.visible=false;p.layers.push(hidden);
 const definition={id:'child',name:'Child',width:200,height:100,shapes:clone(root.keys[0].shapes),timeline:{duration:7,keys:clone(root.keys.slice(1)),motionSpans:clone(root.motionSpans)}};
 p.symbols=[definition,{...clone(definition),id:'unused'}];p.layers.push({...clone(root),id:'instance',motionSpans:[],keys:[{frame:0,shapes:[{...clone(root.keys[0].shapes[0]),kind:'symbol',symbolId:'child',width:200,height:100}]}]});const before=clone(p);
 const baked=await bakeRememberedTimeline(p);expect(baked.layers[0].keys[2].shapes[0].x).toBe(80);expect(baked.layers[0].motionSpans).toBeUndefined();expect(baked.symbols![0].timeline!.motionSpans).toBeUndefined();expect(baked.symbols![0].timeline!.keys[1].shapes[0].x).toBe(80);
 expect(baked.layers[1]).toEqual(hidden);expect(baked.symbols![1]).toEqual(p.symbols[1]);expect(p).toEqual(before);
});
it('baking rejects locked root or symbol recipe tracks without altering source',async()=>{
 const p=fixture(4);p.layers[0].locked=true;const before=clone(p);await expect(bakeRememberedTimeline(p)).rejects.toThrow(/Unlock/);expect(p).toEqual(before);
 p.layers[0].locked=false;const track=clone(p.layers[0]);track.locked=true;p.symbols=[{id:'child',name:'Child',width:20,height:20,shapes:[],timeline:{duration:7,keys:[],layers:[track]}}];p.layers[0].motionSpans=[];p.layers[0].keys=[{frame:0,shapes:[{...track.keys[0].shapes[0],kind:'symbol',symbolId:'child'}]}];await expect(bakeRememberedTimeline(p)).rejects.toThrow(/Unlock/);
});

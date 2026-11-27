import { keyAt, type Keyframe } from '../../document/src';
import { createRememberedMotionSampler } from './motion-spans';
import type { MotionRevisionSource } from './motion-revision';

/** Opt-in timeline evaluation; never modifies authored or generated keys.
 * Callers advance the source revision for all in-place edits and symbol changes.
 * Exact endpoints/holds keep their authored exposure origin. Interior samples
 * have origin=frame because graphic exposure age is already in the sampled pose.
 */
export function createRememberedTimelineSampler(readSource:()=>MotionRevisionSource) {
  type Plan=ReturnType<typeof createRememberedMotionSampler>;
  const plans=new Map<string,{start:number;end:number;plan:Plan}>();
  let source:MotionRevisionSource|undefined,disposed=false,busy=false,generation=0;
  function invalidate(){generation++;for(const entry of plans.values())entry.plan.dispose();plans.clear();source=undefined;}
  function read(){
    if(disposed)throw new Error('Timeline sampler is disposed.');
    const epoch=generation,value=readSource();
    if(disposed||epoch!==generation)throw new Error('Timeline source was invalidated while being read.');
    if(!value?.project||!Number.isSafeInteger(value.revision)||value.revision<0)throw new Error('Invalid timeline source revision.');
    return {project:value.project,revision:value.revision};
  }
  return {
    sample(frame:number):{layerId:string;key:Keyframe;sampled:boolean}[]{
      if(busy)throw new Error('Timeline sampling cannot reenter.');
      busy=true;
      try{
        const current=read(),project=current.project;
        if(!Number.isSafeInteger(frame)||frame<0||frame>=project.duration)throw new Error('Invalid timeline sample frame.');
        if(!source||source.project!==project||source.revision!==current.revision){invalidate();source=current;}
        const epoch=generation,active=new Set<string>(),seen=new Set<string>();
        const result=project.layers.filter(layer=>layer.visible).map(layer=>{
          if(seen.has(layer.id))throw new Error('Duplicate timeline track identity.');seen.add(layer.id);
          const spans=layer.motionSpans??[];
          const ordered=[...spans].sort((a,b)=>a.start-b.start),spanIds=new Set<string>();
          for(let index=0;index<ordered.length;index++){
            const span=ordered[index];
            if(!span.id||spanIds.has(span.id)||!Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||span.start<0||span.end-span.start<2||span.end>=project.duration||
              (index>0&&ordered[index-1].end>span.start))throw new Error('Ambiguous or invalid remembered timeline ranges.');
            spanIds.add(span.id);
          }
          const span=ordered.find(span=>span.start<frame&&frame<span.end);
          if(!span)return {layerId:layer.id,key:structuredClone(keyAt(layer,frame)),sampled:false};
          active.add(layer.id);
          let entry=plans.get(layer.id);
          if(!entry||entry.start!==span.start||entry.end!==span.end){
            entry?.plan.dispose();plans.delete(layer.id);
            // Locks constrain authoring, not read-only presentation. This view never
            // changes the source lock or bypasses baseline/geometry admission.
            const view={...project,layers:[{...layer,locked:false}]};
            entry={start:span.start,end:span.end,plan:createRememberedMotionSampler(view,[layer.id],span.start,span.end)};
            plans.set(layer.id,entry);
          }
          return {layerId:layer.id,key:{frame,shapes:entry.plan.sample(frame)[0].shapes},sampled:true};
        });
        const latest=read();
        if(epoch!==generation||latest.project!==project||latest.revision!==current.revision)throw new Error('Timeline source changed during sampling.');
        for(const [id,entry] of plans)if(!active.has(id)){entry.plan.dispose();plans.delete(id);}
        return result;
      }catch(error){invalidate();throw error;}
      finally{busy=false;}
    },
    invalidate,
    dispose(){disposed=true;invalidate();},
  };
}

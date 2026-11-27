import { MAX_SYMBOL_ARTWORK, symbolArtworks, symbolLayers, type Project } from '../../document/src';
import { createRememberedTimelineSampler } from './motion-timeline';
import { createRevisionMotionSampler } from './motion-revision';
import { selectionTrajectoryStamp } from './selection-trajectory';

/** Temporary render project only. Publish nothing until the complete range validates.
 * Callers must keep the captured project immutable and validate its live source.
 * This preserves baked poses outside the selected range and all other tracks.
 */
export async function prepareRememberedMotionCapture(
  snapshot: Project,
  ids: readonly string[],
  start: number,
  end: number,
  options: { signal?: AbortSignal; validate?: () => void; progress?: (completed: number, total: number) => void } = {},
): Promise<Project> {
  const { signal, validate, progress } = options;
  function active() { signal?.throwIfAborted(); validate?.(); signal?.throwIfAborted(); }
  active();
  const sampler = createRevisionMotionSampler(() => {
    active(); return { project: snapshot, revision: 0 };
  }, ids, start, end);
  try {
    // Admit all tracks and original endpoint values before copying the project.
    const first = sampler.sample(start);
    const draft = structuredClone(snapshot);
    const targets = new Map(first.map(pose => {
      const layer = draft.layers.find(layer => layer.id === pose.layerId)!;
      return [pose.layerId, { layer, indices: new Map(layer.keys.map((key, index) => [key.frame, index])) }];
    }));
    const total = end - start + 1;
    for (let frame = start; frame <= end; frame++) {
      active();
      const poses = frame === start ? first : sampler.sample(frame);
      for (const pose of poses) {
        const target = targets.get(pose.layerId)!;
        const index = target.indices.get(frame);
        if (index === undefined) throw new Error('Captured motion key is missing.');
        target.layer.keys[index] = { ...target.layer.keys[index], shapes: pose.shapes };
      }
      progress?.(frame - start + 1, total);
      active();
      if ((frame - start + 1) % 16 === 0 && frame < end) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        active();
      }
    }
    active();
    return draft;
  } finally { sampler.dispose(); }
}

/** Evaluate independent remembered ranges throughout the captured root timeline.
 * Only interior poses replace existing generated keys; authored exposure origins remain.
 */
async function prepareTimelineLayers(snapshot:Pick<Project,'layers'|'duration'|'symbols'>,options:{signal?:AbortSignal;validate?:()=>void;progress?:(completed:number,total:number)=>void}={}):Promise<Project['layers']>{
  const {signal,validate,progress}=options;
  function active(){signal?.throwIfAborted();validate?.();signal?.throwIfAborted();}
  active();
  const sampler=createRememberedTimelineSampler(()=>{active();return {project:snapshot,revision:0}});
  try{
    if(!Number.isSafeInteger(snapshot.duration)||snapshot.duration<1)throw new Error('Invalid timeline capture duration.');
    const layers=structuredClone(snapshot.layers);
    const tracks=new Map(layers.map(layer=>[layer.id,{layer,indices:new Map(layer.keys.map((key,index)=>[key.frame,index]))}]));
    for(let frame=0;frame<snapshot.duration;frame++){
      active();const scene=sampler.sample(frame);
      for(const pose of scene)if(pose.sampled){
        const track=tracks.get(pose.layerId)!,index=track.indices.get(frame);
        if(index===undefined)throw new Error('Generated timeline capture key is missing.');
        track.layer.keys[index]={...track.layer.keys[index],shapes:pose.key.shapes};
      }
      progress?.(frame+1,snapshot.duration);active();
      if((frame+1)%16===0&&frame+1<snapshot.duration){await new Promise<void>(resolve=>setTimeout(resolve,0));active();}
    }
    active();return layers;
  }finally{sampler.dispose();}
}

/** Prepare root tracks and reachable symbol definitions without changing clock metadata.
 * Hidden tracks do not participate. Unused library definitions remain byte-for-byte data.
 */
type TimelineCaptureOptions={signal?:AbortSignal;validate?:()=>void;progress?:(completed:number,total:number)=>void};
export function prepareRememberedTimelineCapture(snapshot:Project,options:TimelineCaptureOptions={}):Promise<Project>{
  return prepareTimelineProject(snapshot,options,false);
}
/** Explicit render-only child evaluation. Root keys/recipes retain their exact
 * captured poses; in particular, stale baked root recipes are not reinterpreted. */
export function prepareRememberedChildrenCapture(snapshot:Project,options:TimelineCaptureOptions={}):Promise<Project>{
  return prepareTimelineProject(snapshot,options,false,false);
}
/** Explicit authoring transition: return a complete candidate with evaluated recipes
 * detached. Source changes, edited interiors and locked recipe tracks reject atomically. */
export function bakeRememberedTimeline(snapshot:Project,options:TimelineCaptureOptions={}):Promise<Project>{
  return prepareTimelineProject(snapshot,options,true);
}
async function prepareTimelineProject(snapshot:Project,options:TimelineCaptureOptions,bake:boolean,prepareRoots=true):Promise<Project>{
  const original=prepareRoots?undefined:selectionTrajectoryStamp(snapshot);
  const {signal,validate}=options;
  function active(){signal?.throwIfAborted();validate?.();signal?.throwIfAborted();if(original!==undefined&&selectionTrajectoryStamp(snapshot)!==original)throw Error('Child capture source changed.');}
  active();
  const symbols=snapshot.symbols??[],definitions=new Map(symbols.map(symbol=>[symbol.id,symbol]));
  if(definitions.size!==symbols.length)throw new Error('Duplicate symbol definition identity.');
  let count=0;
  for(const symbol of symbols){count+=symbolArtworks(symbol).reduce((n,shapes)=>n+shapes.length,0);if(count>MAX_SYMBOL_ARTWORK)throw new Error('Motion capture exceeds the existing project symbol artwork budget.');}
  const reachable=new Set<string>(),queue:string[]=[];
  function references(layers:Project['layers']){
    for(const layer of layers)if(layer.visible)for(const key of layer.keys)for(const shape of key.shapes)
      if(shape.kind==='symbol'&&shape.symbolId&&!reachable.has(shape.symbolId)){reachable.add(shape.symbolId);queue.push(shape.symbolId);}
  }
  references(snapshot.layers);
  for(let index=0;index<queue.length;index++){
    active();const symbol=definitions.get(queue[index]);if(!symbol)throw new Error('Referenced symbol definition is missing.');references(symbolLayers(symbol));
  }
  function authorable(layers:Project['layers']){
    if(bake&&layers.some(layer=>layer.visible&&layer.locked&&layer.motionSpans?.length))
      throw new Error('Unlock remembered motion tracks before baking.');
  }
  authorable(snapshot.layers);
  for(const id of queue)authorable(symbolLayers(definitions.get(id)!));
  const layers=prepareRoots?await prepareTimelineLayers(snapshot,options):structuredClone(snapshot.layers);
  if(!prepareRoots&&selectionTrajectoryStamp(layers)!==selectionTrajectoryStamp(snapshot.layers))throw Error('Child capture root clone changed.');
  if(bake)for(const layer of layers)if(layer.visible)delete layer.motionSpans;
  const prepared=new Map<string,Project['layers']>();
  for(const id of queue){
    active();const symbol=definitions.get(id)!,original=symbolLayers(symbol);
    if(!original.some(layer=>layer.visible&&layer.motionSpans?.length))continue;
    const result=await prepareTimelineLayers({layers:original,duration:symbol.timeline?.duration??1,symbols},
      {signal,validate});
    count+=result.reduce((n,layer)=>n+layer.keys.reduce((sum,key)=>sum+key.shapes.length,0),0)-original.reduce((n,layer)=>n+layer.keys.reduce((sum,key)=>sum+key.shapes.length,0),0);
    if(count>MAX_SYMBOL_ARTWORK)throw new Error('Motion capture exceeds the existing project symbol artwork budget.');
    if(bake)for(const layer of result)if(layer.visible)delete layer.motionSpans;
    prepared.set(id,result);
    await new Promise<void>(resolve=>setTimeout(resolve,0));active();
  }
  active();const draft=structuredClone(snapshot);
  if(original!==undefined&&selectionTrajectoryStamp(draft)!==original)throw Error('Child capture source clone changed.');
  draft.layers=layers;
  for(const symbol of draft.symbols??[]){
    const tracks=prepared.get(symbol.id);if(!tracks)continue;
    symbol.shapes=tracks[0].keys[0].shapes;
    symbol.timeline={...symbol.timeline!,keys:tracks[0].keys.slice(1),...(symbol.timeline?.layers!==undefined?{layers:tracks.slice(1)}:{})};
    if(bake)delete symbol.timeline.motionSpans;
  }
  active();return draft;
}

/** Preview-local cache. Returned projects are borrowed read-only render inputs:
 * callers must never mutate them. Source changes must invalidate or fail validate.
 * No partial preparation is retained, and concurrent consumers are rejected.
 */
export function createRememberedMotionCaptureCache(
  snapshot: Project, ids: readonly string[], start: number, end: number, validate: () => void,
  scope: 'range' | 'timeline' = 'range',
) {
  const selected = [...ids];
  let prepared: Project | undefined;
  let pending: AbortController | undefined;
  let disposed = false;
  function invalidate() { prepared = undefined; pending?.abort(); }
  return {
    async get(signal?: AbortSignal, progress?: (completed:number,total:number)=>void): Promise<Project> {
      if (disposed) throw new Error('Motion capture cache is disposed.');
      if (pending) throw new Error('Motion capture preparation is already running.');
      const job = new AbortController();
      pending = job;
      const abort = () => job.abort(signal?.reason);
      signal?.addEventListener('abort', abort, {once:true});
      if (signal?.aborted) abort();
      function active() {
        job.signal.throwIfAborted();
        if (disposed) throw new Error('Motion capture cache is disposed.');
        validate();
        job.signal.throwIfAborted();
      }
      try {
        active();
        if (!prepared) {
          const candidate = await (scope==='timeline'
            ? prepareRememberedTimelineCapture(snapshot,{signal:job.signal,validate:active,progress})
            : prepareRememberedMotionCapture(snapshot, selected, start, end,{signal:job.signal,validate:active,progress}));
          active();
          prepared = candidate;
        }
        active();
        return prepared;
      } catch(error) { prepared=undefined; throw error; }
      finally {signal?.removeEventListener('abort',abort);if(pending===job)pending=undefined;}
    },
    invalidate,
    dispose() {disposed=true;invalidate();},
  };
}

import {clone,MAX_SYMBOL_ARTWORK,symbolArtworks,symbolLayers,type Project,type SymbolDefinition} from '../../document/src';
import {splitBasicMotionSpan} from './motion-spans';

/** Subdivide one remembered range at ordered absolute frame indices.
 * All tracks and cuts prepare before publication. Original-value validation is
 * delegated to preserved splitting; structuredClone retains NaN/Infinity rather
 * than laundering invalid geometry through JSON. No source objects are retained
 * in the published key/recipe arrays.
 */
export function subdividePreservedMotionSpan(
  project:Pick<Project,'layers'|'duration'|'symbols'>,ids:readonly string[],
  start:number,end:number,cuts:readonly number[],
):void{
  validateCuts(project.duration,start,end,cuts);
  const selected=[...new Set(ids)];
  if(!selected.length)throw new Error('Choose motion tracks.');
  const originals=selected.map(id=>{
    const layer=project.layers.find(l=>l.id===id);
    if(!layer||!layer.visible||layer.locked)throw new Error('Choose visible, unlocked motion tracks.');
    return layer;
  });
  const draft={...project,layers:structuredClone(originals)};
  // Split around the middle requested cut first, avoiding a long chain of
  // repeatedly restricted right-hand recipes. Each derived recipe still passes
  // the existing exact-baseline and full-pose reconstruction checks.
  const pending=[{start,end,lo:0,hi:cuts.length}];
  while(pending.length){
    const section=pending.pop()!;if(section.lo===section.hi)continue;
    const middle=Math.floor((section.lo+section.hi)/2),cut=cuts[middle];
    splitBasicMotionSpan(draft,selected,section.start,section.end,cut,true);
    pending.push({start:cut,end:section.end,lo:middle+1,hi:section.hi},{start:section.start,end:cut,lo:section.lo,hi:middle});
  }
  originals.forEach((layer,i)=>{layer.keys=draft.layers[i].keys;layer.motionSpans=draft.layers[i].motionSpans;});
}

function validateCuts(duration:number,start:number,end:number,cuts:readonly number[]):void{
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>=duration||
    !Array.isArray(cuts)||!cuts.length)throw new Error('Choose an interior subdivision range and cuts.');
  let previous=start;
  for(const cut of cuts){
    if(!Number.isSafeInteger(cut)||cut-previous<2||end-cut<2)
      throw new Error('Subdivision cuts must increase with at least three frames in each section.');
    previous=cut;
  }
}

/** Preserved cuts retain all artwork keys, so capacity is admitted once.
 * Only selected tracks are prepared; the whole definition detaches once on success.
 */
export function subdividePreservedSymbolMotionSpan(
  definition:SymbolDefinition,ids:readonly string[],start:number,end:number,cuts:readonly number[],
  symbols:SymbolDefinition[]=[definition],
):SymbolDefinition{
  validateCuts(definition.timeline?.duration??1,start,end,cuts);
  const count=[...symbols.filter(s=>s.id!==definition.id),definition].reduce(
    (n,s)=>n+symbolArtworks(s).reduce((m,art)=>m+art.length,0),0);
  if(count>MAX_SYMBOL_ARTWORK)throw new Error('Motion would exceed the existing project symbol artwork budget.');
  const layers=symbolLayers(definition).map(layer=>({...layer}));
  subdividePreservedMotionSpan({layers,duration:definition.timeline?.duration??1,
    symbols:[...symbols.filter(s=>s.id!==definition.id),definition]},ids,start,end,cuts);
  // Original selected geometry has passed reconstruction before serialization.
  const result=clone(definition);
  for(const id of new Set(ids)){
    const prepared=layers.find(layer=>layer.id===id)!;
    if(id==='@base'){
      result.shapes=prepared.keys[0].shapes;
      result.timeline!.keys=prepared.keys.slice(1);
      result.timeline!.motionSpans=prepared.motionSpans;
    }else{
      const target=result.timeline!.layers!.find(layer=>layer.id===id)!;
      target.keys=prepared.keys;target.motionSpans=prepared.motionSpans;
    }
  }
  return result;
}

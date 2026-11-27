export { motionInteriorBaseline } from './motion-ownership';
import { sameMotionArtwork, requireOwnedMotionInterior, checkMotionReconstruction } from './motion-ownership';
import { symbolPlacementFields, validatePositionTiming, allIntervalTimingFields, intervalKeys, validatePositionEaseArray, validateGradientColorTracks, validateLiveScaleRange, hasKeyableSolidFill, liveColorChannels, validateLiveColorKeys, validateLiveNumericKeys, liveNumericChannels } from '../../document/src/live-motion';
import {selectionTrajectoryStamp} from './selection-trajectory';
import { matchStraightMotionNodes } from './motion-resample';
import { shiftMotionContourStart, validateMotionNodes } from './motion-nodes';
import { moveFrames, copyFrames, clearFrames } from './frame-exposures';
import {
  validateMotionContourCorrespondence,
  type MotionContourCorrespondence,
} from '../../document/src/motion-contour';
import { captureOpacityEase, capturePaintEase, validateMotionEase } from '../../document/src/motion-ease';
import { validateMotionRotation, type MotionRotation } from '../../document/src/motion-rotation';
import { validateMotionPath, type MotionPath } from '../../document/src/motion-path';
import {
  assertSymbolHasArtwork,
  validateMotionSpanOptions,
  validateProject,
  type MotionSpanOptions,
  clone,
  keyAt,
  id,
  MAX_SYMBOL_ARTWORK,
  symbolArtworks,
  symbolLayers,
  type SymbolDefinition,
  type BasicMotionSpan,
  type Project,
} from '../../document/src';
import { prepareGradientColorKeys, prepareNumericProperty, validateMotionPose, colorKeyAt, affinePose, generateMotionFrames, motionProgress, resolveAutomaticGradientPairs, createMotionFrameSampler, type MotionFrameSampler } from './motion-frames';
import { motionRotationDelta } from './motion-rotation';
import { prepareRigidGroups, rigidGroupPosition } from './motion-rigid';
import { reverseTangentMotionPath, reverseMotionPath, offsetPreservedPath, splitPreservedMotionPath } from './motion-path';

type Timeline = Pick<Project, 'layers' | 'duration' | 'symbols'>;
type Ease = BasicMotionSpan['ease'];
const interior = (layer: Timeline['layers'][number], start: number, end: number) =>
  layer.keys.filter((key) => key.frame > start && key.frame < end);

type TimedProperty = typeof liveNumericChannels[number]['property'];
type NumericTracks = Pick<BasicMotionSpan,typeof liveNumericChannels[number]['field']>;
type PropertyTracks = NumericTracks & Pick<BasicMotionSpan,typeof allIntervalTimingFields[number]|'fillColorKeys'|'strokeColorKeys'|'gradientColorTracks'>;
function reverseIntervalEase(ease:Ease):Ease {
  if (typeof ease==='object') return {kind:'cubic',x1:1-ease.x2,y1:1-ease.y2,x2:1-ease.x1,y2:1-ease.y1};
  return ease==='in'?'out':ease==='out'?'in':ease;
}
type TimedTracks = Pick<import('../../document/src/live-motion').LiveMotionSpan,typeof allIntervalTimingFields[number]|typeof intervalKeys[keyof typeof intervalKeys]>;
export function splitSymbolPlacementKeys(span:TimedTracks & {start:number;end:number}, offset:number, halves:TimedTracks[]) {
  for (const field of symbolPlacementFields) {
    const left = halves[0][field], right = halves[1][field];
    if (left && right) {
      halves[0][field] = left.filter(key => key.offset < offset);
      halves[1][field] = right.filter(key => key.offset > offset)
        .map(key => ({...key, offset:key.offset-offset}));
    }
  }
  splitPositionTiming(span,offset,halves);
}
export function splitPositionTiming(span:TimedTracks & {start:number;end:number}, offset:number, halves:TimedTracks[]) {
  for (const field of allIntervalTimingFields) {
    const timing=span[field];
    if (!timing) continue;
    const keys=span[intervalKeys[field]]!;
    const [left,right]=splitIntervalEases(keys,span.end-span.start,offset,timing);
    halves[0][field]=left;
    halves[1][field]=right;
  }
}
export function splitIntervalEases(keys:readonly {offset:number}[],length:number,offset:number,timing:readonly Ease[]) {
  const ends=[...keys.map(key=>key.offset),length];
  const index=ends.findIndex(end=>end>=offset);
  if (ends[index]===offset) return [timing.slice(0,index+1),timing.slice(index+1)] as const;
  const from=ends[index-1]??0;
  const [left,right]=splitSimpleMotionEase(timing[index],(offset-from)/(ends[index]-from));
  return [[...timing.slice(0,index),left],[right,...timing.slice(index+1)]] as const;
}
function mapPropertyTracks(span:PropertyTracks, map:(offset:number)=>number|null,
  mapTiming:(keys:readonly {offset:number}[],timing:readonly Ease[])=>readonly Ease[]=(_keys,timing)=>clone(timing)) {
  const tracks:PropertyTracks={};
  if(span.gradientColorTracks) tracks.gradientColorTracks=span.gradientColorTracks.map(row=>({
    stop:row.stop,...(row.eases ? {eases:mapTiming(row.keys,row.eases)} : {}),
    keys:row.keys.flatMap(key=>{
      const offset=map(key.offset);
      return offset===null ? [] : [{offset,color:key.color}];
    }).sort((a,b)=>a.offset-b.offset),
  }));
  for (const {field} of liveColorChannels) {
    const keys=span[field];
    if (keys) tracks[field]=keys.flatMap(key=>{
      const offset=map(key.offset);
      return offset===null ? [] : [{offset,color:key.color}];
    }).sort((a,b)=>a.offset-b.offset);
  }
  for (const {field} of liveNumericChannels) {
    const keys=span[field];
    if (keys) tracks[field]=keys.flatMap(key=>{
      const offset=map(key.offset);
      return offset===null ? [] : [{offset,value:key.value}];
    }).sort((a,b)=>a.offset-b.offset);
  }
  return tracks;
}
function generateRemembered(
  project: Timeline,
  ids: string[],
  start: number,
  end: number,
  ease: Ease,
  options?: MotionSpanOptions,
  path?: MotionPath,
  rotation?: MotionRotation,
  correspondence?: MotionContourCorrespondence,
  opacityEase?: Ease,
  paintEase?: Ease,
  tracks: PropertyTracks = {},
) {
  opacityEase=captureOpacityEase(opacityEase);
  paintEase=capturePaintEase(paintEase,options?.paint??false);
  validateMotionSpanOptions(options);
  if (correspondence !== undefined) validateMotionContourCorrespondence(correspondence);
  if (path !== undefined) validateMotionPath(path);
  if (rotation !== undefined) validateMotionRotation(rotation);
  validatePositionTiming(tracks);
  const channels=liveNumericChannels.filter(({field})=>tracks[field]);
  for(const {field} of channels) validateLiveNumericKeys(tracks[field]!,end-start,field);
  if (path?.tangent && tracks.rotationKeys) throw Error('Tangent heading and rotation keys both own the angle.');
  if (path && (tracks.xKeys || tracks.yKeys)) throw Error('Remove the motion path before keying position.');
  if (correspondence?.source) {
    if (!options?.nodes) throw new Error('Source contour alignment requires node interpolation.');
    const source=correspondence.source,selected=new Set(ids);
    const layers=project.layers.map(layer=>{
      if (!selected.has(layer.id)) return layer;
      return {...layer,keys:layer.keys.map(key=>{
        if (key.frame!==start) return key;
        return {...key,shapes:key.shapes.map(shape=>{
          validateMotionNodes(shape);
          return shiftMotionContourStart(shape,source.start??0,source.reverse??false,source.order);
        })};
      })};
    });
    const {source:unused,...target}=correspondence;
    void unused;
    generateRemembered({...project,layers},ids,start,end,ease,options,path,rotation,target,opacityEase,paintEase,tracks);
    // Publish only after all selected tracks succeed, restoring authored source
    // keys exactly. Generated keys retain the aligned source indexing.
    project.layers.forEach((layer,i)=>{if(selected.has(layer.id)){
      const authored=layer.keys.find(key=>key.frame===start)!;
      layer.keys=layers[i].keys.map(key=>key.frame===start?authored:key);
    }});
    return;
  }
  const colors=liveColorChannels.filter(({field})=>tracks[field]);
  for (const {field,option,label} of colors) {
    if (!options?.[option]) throw Error(label+' keys require saved color interpolation.');
    validateLiveColorKeys(tracks[field]!,end-start);
  }
  if(tracks.gradientColorTracks) {
    if(!options?.paint) throw Error('Gradient keys require saved paint interpolation.');
    validateGradientColorTracks(tracks.gradientColorTracks,end-start);
  }
  const propertyPlans=channels.length || colors.length || tracks.gradientColorTracks ? [...new Set(ids)].flatMap(id=>{
    const layer=project.layers.find(l=>l.id===id)!;
    const endpoints=[start,end].map(frame=>layer.keys.find(key=>key.frame===frame)?.shapes);
    if (rotation?.rigidGroups || endpoints.some(shapes=>shapes?.length!==1 || shapes[0].groups?.length || shapes[0].kind==='symbol' || shapes[0].id!==endpoints[0]?.[0]?.id))
      throw Error('Remembered property keys require one matching ungrouped artwork item.');
    const colorPlans=colors.map(({field,property})=>{
      const pair=endpoints.map(shapes=>shapes![0]);
      if (property==='fill' && !pair.every(hasKeyableSolidFill)) throw Error('Fill keys require solid fill at both endpoints.');
      const stops=[{offset:0,color:pair[0][property]},...tracks[field]!,{offset:end-start,color:pair[1][property]}];
      return (key:typeof layer.keys[number])=>{key.shapes[0][property]=colorKeyAt(stops,key.frame-start,false,tracks[`${property}KeyEases`]);};
    });
    if (tracks.scaleXKeys || tracks.scaleYKeys || tracks.shearKeys) {
      if (!options?.affine) throw Error('Enable affine interpolation before setting scale keys.');
      validateLiveScaleRange({start,end,ease,scaleXKeys:tracks.scaleXKeys,scaleYKeys:tracks.scaleYKeys,
        shearKeys:tracks.shearKeys,sxKeyEases:tracks.sxKeyEases,syKeyEases:tracks.syKeyEases},endpoints[0]![0],endpoints[1]![0]);
    }
    const numericPlans=channels.map(({field,property})=>{
      const apply=prepareNumericProperty(property,endpoints[0]![0],endpoints[1]![0],end-start,tracks[field]!,options?.affine,
        tracks[`${property}KeyEases`]);
      return (key:typeof layer.keys[number])=>apply(key.shapes[0],key.frame-start);
    });
    const gradientPlans=tracks.gradientColorTracks ? prepareGradientColorKeys(endpoints[0]![0],endpoints[1]![0],options!,
      tracks.gradientColorTracks,end-start,paintEase ?? ease).map(({stop,colors,eases})=>
      (key:typeof layer.keys[number])=>{key.shapes[0].gradient!.stops[stop].color=colorKeyAt(colors,key.frame-start,options?.gradientPremultiplied,eases);}
    ) : [];
    return {layer,plans:[...numericPlans,...colorPlans,...gradientPlans]};
  }) : [];
  generateMotionFrames(
    project,
    ids,
    start,
    end,
    ease,
    options?.affine,
    options?.paint,
    options?.nodes,
    path,
    options?.primitives,
    options?.gradientGeometry,
    rotation,
    options?.strokeWidth,
    options?.gradientBasis,
    options?.gradientStops,
    options?.contourContacts ? 'contacts' : options?.contourEdges ? 'edges' : options?.contourAreas,
    correspondence?.start ?? 0,
    correspondence?.reverse ?? false,
    correspondence?.order,
    options?.gradientPremultiplied,
    correspondence?.nodes ?? false,
    options?.curveTangents,
    options?.curveSelfContacts,
    options?.pivots,
    options?.defaultPivots,
    opacityEase,
    paintEase,
    options?.strokeColor,
  );
  for (const {layer,plans} of propertyPlans) for (const key of interior(layer,start,end)) {
    for(const apply of plans) apply(key);
    if(channels.length) validateMotionPose(key.shapes[0]);
  }
}

/** Persist a basic position/shortest-rotation/opacity recipe alongside its editable keys. */
export function createBasicMotionSpan(
  project: Timeline,
  ids: string[],
  start: number,
  end: number,
  ease: Ease,
  options?: MotionSpanOptions,
  path?: MotionPath,
  rotation?: MotionRotation,
  correspondence?: MotionContourCorrespondence,
  opacityEase?: Ease,
  paintEase?: Ease,
) {
  opacityEase=captureOpacityEase(opacityEase);
  paintEase=capturePaintEase(paintEase,options?.paint??false);
  validateMotionEase(ease);
  const selected = [...new Set(ids)];
  const layers = selected.map((key) => {
    const layer = project.layers.find((candidate) => candidate.id === key);
    if (!layer) throw new Error('Motion track is missing.');
    if (layer.motionSpans?.some((span) => span.start < end && span.end > start))
      throw new Error('Remembered motion spans cannot overlap.');
    return layer;
  });
  // Shallow wrappers retain original numeric values for the generator's preflight.
  const draft = { ...project, layers: layers.map((layer) => ({ ...layer })) };
  generateRemembered(draft, selected, start, end, ease, options, path, rotation, correspondence, opacityEase,paintEase);
  const prepared = draft.layers.map((layer) => ({
    keys: layer.keys,
    spans: [
      ...(layer.motionSpans ?? []),
      {
        id: id(),
        start,
        end,
        ease: clone(ease),
        ...(opacityEase!==undefined?{opacityEase:clone(opacityEase)}:{}),
        ...(paintEase!==undefined?{paintEase:clone(paintEase)}:{}),
        ...(options ? { options: clone(options) } : {}),
        ...(path ? { path: clone(path) } : {}),
        ...(rotation ? { rotation: clone(rotation) } : {}),
        ...(correspondence ? { correspondence: clone(correspondence) } : {}),
        baseline: JSON.stringify(interior(layer, start, end)),
      },
    ].sort((a, b) => a.start - b.start),
  }));
  layers.forEach((layer, i) => {
    layer.keys = prepared[i].keys;
    layer.motionSpans = prepared[i].spans;
  });
}

/** Output layers are private partitions with the source's exact key times. */
export function projectDistributedMotion(
  captured: Timeline,
  original: Project['layers'][number],
  outputs: Project['layers'],
) {
  const source = captured.layers.find(layer => layer.id === original.id)!;
  const recipes = outputs.map((): BasicMotionSpan[] => []);
  for (const span of source.motionSpans ?? []) {
    if (span.end >= captured.duration) throw new Error('Remembered motion extends beyond the timeline.');
    requireOwnedMotionInterior(original, span);
    const first = source.keys.findIndex(key => key.frame === span.start);
    const last = first + span.end - span.start;
    checkMotionReconstruction(captured, source, span, source.keys.slice(first + 1, last),
      'The source recipe cannot reconstruct its generated artwork. Refresh it before distributing.');
    let assigned = false;
    for (const [index, layer] of outputs.entries()) {
      const keys = layer.keys.slice(first, last + 1);
      if (!keys.some(key => key.shapes.length)) continue;
      const generated = keys.slice(1, -1);
      checkMotionReconstruction(captured, layer, span, generated,
        'The distributed recipe cannot reconstruct its generated artwork.');
      recipes[index].push({
        ...clone(span), id: assigned ? id() : span.id, baseline: JSON.stringify(generated),
      });
      assigned = true;
    }
    if (!assigned) throw new Error('No distributed artwork owns the remembered span.');
  }
  outputs.forEach((layer, index) => {
    if (recipes[index].length) layer.motionSpans = recipes[index];
    else delete layer.motionSpans;
  });
}

/** Reverse a complete connected chain after all members and tracks validate. */
export function reverseBasicMotionSpan(project: Timeline, ids: string[], start: number, end: number) {
  if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end>=project.duration || end<=start)
    throw new Error('Choose a remembered range within the existing timeline.');
  const selected=[...new Set(ids)];
  if(!selected.length)throw new Error('Choose motion tracks.');
  const prepared=selected.map(id=>{
    const layer=project.layers.find(l=>l.id===id);
    if(!layer || !layer.visible || layer.locked)throw new Error('Choose visible, unlocked motion tracks.');
    const chain=(layer.motionSpans??[]).filter(s=>s.start>=start && s.end<=end).sort((a,b)=>a.start-b.start);
    if(!chain.length || chain[0].start!==start || chain.at(-1)!.end!==end || chain.some((s,i)=>i>0 && chain[i-1].end!==s.start))
      throw new Error('Select a complete connected chain of remembered spans.');
    const members=new Set(chain);
    if(layer.motionSpans!.some(s=>!members.has(s) && s.start<=end+1 && s.end>=start))
      throw new Error('Reverse an isolated complete chain without touching other recipes.');
    const keys=layer.keys.filter(k=>k.frame<start || k.frame>end);
    const spans=layer.motionSpans!.filter(s=>!members.has(s));
    const frames=new Map<number, typeof layer.keys[number]>();
    for(const span of chain){
      const draft={...layer,keys:layer.keys.filter(k=>k.frame>=span.start && k.frame<=span.end),motionSpans:[span]};
      reverseIsolatedMotionSpan({...project,duration:span.end+1,layers:[draft]},[id],span.start,span.end);
      const offset=start+end-span.end-span.start;
      const shifted=draft.keys.map(k=>({...k,frame:k.frame+offset}));
      for(const key of shifted){
        const shared=frames.get(key.frame);
        if(shared && JSON.stringify(shared)!==JSON.stringify(key))throw new Error('Reversed shared endpoint is inconsistent.');
        frames.set(key.frame,key);
      }
      const next={...draft.motionSpans[0],start:span.start+offset,end:span.end+offset,
        baseline:JSON.stringify(shifted.filter(k=>k.frame>span.start+offset && k.frame<span.end+offset))};
      spans.push(next);
    }
    if(end+1<project.duration && !keys.some(k=>k.frame===end+1))keys.push({...clone(keyAt(layer,end)),frame:end+1});
    return {layer,keys:[...keys,...frames.values()].sort((a,b)=>a.frame-b.frame),spans:spans.sort((a,b)=>a.start-b.start)};
  });
  prepared.forEach(({layer,keys,spans})=>{layer.keys=keys;layer.motionSpans=spans;});
}

/** Reverse one isolated recipe, validating both directions before any track writes. */
function reverseIsolatedMotionSpan(project: Timeline, ids: string[], start: number, end: number) {
  const selected=[...new Set(ids)];
  if(!selected.length)throw new Error('Choose motion tracks.');
  const prepared=selected.map(id=>{
    const layer=project.layers.find(l=>l.id===id);
    if(!layer || !layer.visible || layer.locked)throw new Error('Choose visible, unlocked motion tracks.');
    const span=layer.motionSpans?.find(s=>s.start===start && s.end===end);
    if(!span)throw new Error('No remembered motion span matches this range.');
    if(layer.motionSpans!.some(s=>s!==span && s.start<=end+1 && s.end>=start))throw new Error('Reverse one isolated remembered span.');
    const aligned=span.correspondence?.source !== undefined || span.correspondence?.start !== undefined || span.correspondence?.reverse !== undefined || span.correspondence?.order !== undefined;
    const original={...layer,keys:layer.keys.filter(k=>k.frame<=start || k.frame>=end)};
    generateRemembered({...project,layers:[original]},[id],start,end,span.ease,span.options,span.path,span.rotation,span.correspondence,span.opacityEase,span.paintEase,span);
    if(JSON.stringify(interior(layer,start,end))!==span.baseline || JSON.stringify(interior(original,start,end))!==span.baseline)
      throw new Error('Reversal requires unchanged generated motion and endpoints.');
    const ease:Ease=typeof span.ease==='object'?{kind:'cubic',x1:1-span.ease.x2,y1:1-span.ease.y2,x2:1-span.ease.x1,y2:1-span.ease.y1}:span.ease==='in'?'out':span.ease==='out'?'in':span.ease;
    const opacityEase=span.opacityEase===undefined?undefined:typeof span.opacityEase==='object'?{kind:'cubic' as const,x1:1-span.opacityEase.x2,y1:1-span.opacityEase.y2,x2:1-span.opacityEase.x1,y2:1-span.opacityEase.y1}:span.opacityEase==='in'?'out' as const:span.opacityEase==='out'?'in' as const:span.opacityEase;
    const paintEase=span.paintEase===undefined?undefined:typeof span.paintEase==='object'?{kind:'cubic' as const,x1:1-span.paintEase.x2,y1:1-span.paintEase.y2,x2:1-span.paintEase.x1,y2:1-span.paintEase.y1}:span.paintEase==='in'?'out' as const:span.paintEase==='out'?'in' as const:span.paintEase;
    const rotation=span.rotation?{...span.rotation,direction:span.rotation.direction==='clockwise'?'counterclockwise' as const:span.rotation.direction==='counterclockwise'?'clockwise' as const:'shortest' as const}:undefined;
    // The reversed source basis has the original endpoint rotation. Infer both
    // shear axes so a diagonal source-axis transform can be expressed there.
    if(rotation?.axisGroupScale)rotation.axisGroupShear=true;
    if(span.rotation?.rigidPivot){
      const members=prepareRigidGroups(keyAt(layer,start).shapes,keyAt(layer,end).shapes,span.rotation);
      let pivot:{x:number;y:number}|undefined;
      members.forEach((member,i)=>{
        if(!member || member.leader!==i)return;
        const angle=(member.delta%360)*Math.PI/180;
        const c=member.endScale*Math.cos(angle),s=member.endScale*Math.sin(angle);
        const x=member.endScaleX*member.pivotX+member.endShear*member.pivotY;
        const y=member.endScaleY*member.pivotY+member.endShearY*member.pivotX;
        const next={x:c*x-s*y,y:s*x+c*y};
        if(!Number.isFinite(next.x)||!Number.isFinite(next.y))throw new Error('Reversed custom pivot exceeds numeric limits.');
        if(pivot&&(pivot.x!==next.x||pivot.y!==next.y))throw new Error('Reversed custom pivots require one shared transformed offset.');
        pivot=next;
      });
      rotation!.rigidPivot=pivot;
    }
    let path=span.path&&!span.path.waypoints&&!span.path.tangent?reverseMotionPath({x:0,y:0},{x:0,y:0},span.path):undefined;
    if(span.path?.tangent){
      const source=keyAt(layer,start).shapes,target=keyAt(layer,end).shapes;
      const groups=span.rotation?.rigidGroups?prepareRigidGroups(source,target,span.rotation):undefined;
      const routes=source.filter((_,i)=>!groups?.[i] || groups[i]!.leader===i).map(shape=>{
        const last=target.find(s=>s.id===shape.id);
        if(!last)throw new Error('Reversed tangent endpoint is missing.');
        const reversed=reverseTangentMotionPath(shape,last,span.path!);
        return {...reversed.path,headingOffset:reversed.headingOffset,...(reversed.headingOffsetEnd!==undefined?{headingOffsetEnd:reversed.headingOffsetEnd}:{})};
      });
      if(!routes.length || routes.some(route=>JSON.stringify(route)!==JSON.stringify(routes[0])))
        throw new Error('Reversed tangent paths require one shared route and angular correction across artwork.');
      path=routes[0];
    } else if(span.path?.waypoints){
      const source=keyAt(layer,start).shapes,target=keyAt(layer,end).shapes;
      const groups=span.rotation?.rigidGroups?prepareRigidGroups(source,target,span.rotation):undefined;
      const routes=source.filter((_,i)=>!groups?.[i] || groups[i]!.leader===i).map(shape=>{
        const last=target.find(s=>s.id===shape.id);
        if(!last)throw new Error('Reversed path endpoint is missing.');
        return reverseMotionPath(shape,last,span.path!);
      });
      if(!routes.length || routes.some(route=>JSON.stringify(route)!==JSON.stringify(routes[0])))
        throw new Error('Reversed waypoint paths require shared endpoint displacement and controls.');
      path=routes[0];
    }
    const options=span.options?clone(span.options):undefined;
    const matching=span.options?.gradientStops;
    if(typeof matching==='object'){
      let pairs=matching.pairs==='auto'?undefined:matching.pairs;
      if(matching.pairs==='auto'){
        const first=keyAt(layer,start).shapes,last=keyAt(layer,end).shapes;
        for(let i=0;i<first.length;i++){
          const resolved=resolveAutomaticGradientPairs(first[i],last[i]);
          if(!resolved)continue;
          if(pairs && JSON.stringify(pairs)!==JSON.stringify(resolved))throw new Error('Automatic gradient reversal requires shared correspondence across artwork.');
          pairs=resolved;
        }
      }
      if(pairs)options!.gradientStops={pairs:pairs.map(([a,b])=>[b,a] as const)};
    }
    let correspondence=span.correspondence?clone(span.correspondence):undefined;
    if (aligned && correspondence) {
      const {source,nodes,...target}=correspondence;
      // Both endpoints must keep the original generated indexing. Swapping the
      // aligned endpoint views preserves it; inverting only the target does not.
      correspondence={...source,...(Object.keys(target).length?{source:target}:{}),
        ...(nodes!==undefined?{nodes}:{})};
    }
    // Hint indices belong to the aligned views; swap endpoints only after
    // swapping those views. Full reconstruction below rejects partition drift.
    if(correspondence?.nodes && typeof correspondence.nodes==='object' && correspondence.nodes.hints)
      correspondence.nodes.hints=correspondence.nodes.hints.map(pairs=>pairs.map(([a,b])=>[b,a] as const));
    if (typeof correspondence?.nodes === 'object' && correspondence.nodes.artworkHints)
      correspondence.nodes.artworkHints = correspondence.nodes.artworkHints.map(entry => ({
        sourceId:entry.targetId, targetId:entry.sourceId,
        ...(entry.contourOwners ? {contourOwners:entry.contourOwners.map(pair=>pair ? [pair[1],pair[0]] as const : null)} : {}),
        hints:entry.hints?.map(ring=>ring.map(([a,b])=>[b,a] as const)) ?? null,
      }));
    const reversed=layer.keys.filter(k=>k.frame>=start && k.frame<=end).map(k=>({...clone(k),frame:start+end-k.frame})).sort((a,b)=>a.frame-b.frame);
    const draft={...layer,keys:[reversed[0],reversed[reversed.length-1]]};
    const reversedTracks=mapPropertyTracks(span,offset=>end-start-offset,(_keys,timing)=>[...timing].reverse().map(reverseIntervalEase));
    for (const field of allIntervalTimingFields) {
      if (span[field]) reversedTracks[field] = [...span[field]].reverse().map(reverseIntervalEase);
    }
    generateRemembered({...project,layers:[draft]},[id],start,end,ease,options,path,rotation,correspondence,opacityEase,paintEase,reversedTracks);
    if(!sameMotionArtwork(draft.keys,reversed))throw new Error('Reversed recipe could not reconstruct the original artwork.');
    const outside=layer.keys.filter(k=>k.frame<start || k.frame>end);
    if(end+1<project.duration && !outside.some(k=>k.frame===end+1))outside.push({...clone(keyAt(layer,end)),frame:end+1});
    const keys=[...outside,...reversed].sort((a,b)=>a.frame-b.frame);
    const next={...span,ease,...(opacityEase!==undefined?{opacityEase}:{}),...(paintEase!==undefined?{paintEase}:{}),rotation,path,baseline:JSON.stringify(reversed.filter(k=>k.frame>start&&k.frame<end))};
    Object.assign(next,reversedTracks);
    if(options)next.options=options;
    if(correspondence)next.correspondence=correspondence;
    if(!rotation)delete next.rotation;if(!path)delete next.path;
    return {layer,keys,spans:layer.motionSpans!.map(s=>s===span?next:s)};
  });
  prepared.forEach(({layer,keys,spans})=>{layer.keys=keys;layer.motionSpans=spans;});
}

/** Read remembered recipes without adopting edited generated keys or publishing history.
 * Endpoint edits are evaluated against the unchanged interior baseline, as in explicit refresh.
 * The baseline is an ownership check, not proof that every intermediate pose reconstructs.
 */
export function createRememberedMotionSampler(
  project: Timeline,
  ids: string[],
  start: number,
  end: number,
) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
      end - start < 2 || end >= project.duration)
    throw new Error('Choose an integer sample inside a valid motion range.');
  const selected = [...new Set(ids)];
  if (!selected.length) throw new Error('Choose motion tracks.');
  const prepared = selected.map((layerId) => {
    const layers = project.layers.filter((layer) => layer.id === layerId);
    const layer = layers[0];
    if (layers.length !== 1 || !layer.visible || layer.locked)
      throw new Error('Choose visible, unlocked motion tracks.');
    const spans = layer.motionSpans?.filter((span) => span.start === start && span.end === end);
    if (spans?.length !== 1)
      throw new Error('Choose one unambiguous remembered motion span for this range.');
    const span = spans[0];
    requireOwnedMotionInterior(layer, span);
    return { layerId, span };
  });
  let plans: {layerId:string; sampler:MotionFrameSampler}[] | undefined = [];
  try {
    for (const {layerId,span} of prepared)
      plans.push({layerId,sampler:createMotionFrameSampler(project,layerId,span)});
  } catch(error) {
    for(const plan of plans)plan.sampler.dispose();
    throw error;
  }
  return {
    sample(frame:number) {
      if(!plans)throw new Error('Remembered motion sampler is disposed.');
      return plans.map(({layerId,sampler})=>({layerId,shapes:sampler.sample(frame)}));
    },
    dispose() {
      if(plans)for(const plan of plans)plan.sampler.dispose();
      plans=undefined;
    },
  };
}

/** One-shot sampling retains current source admission on each call. */
export function sampleRememberedMotionFrames(project:Timeline,ids:string[],start:number,end:number,frame:number) {
  const sampler=createRememberedMotionSampler(project,ids,start,end);
  try{return sampler.sample(frame)}finally{sampler.dispose()}
}

/** Explicit refresh: never overwrite changed, inserted, removed or retimed interior keys. */
export function refreshBasicMotionSpan(
  project: Timeline,
  ids: string[],
  start: number,
  end: number,
  replacementEase?: Ease,
  replacementPath?: MotionPath | null, // undefined retains the recipe; null explicitly removes its path.
) {
  regenerateRemembered(project,ids,start,end,{replacementEase,replacementPath});
}

const rememberedChannelEditors=new WeakMap<object,{invalid:boolean}>();
/** Atomic opacity-only reauthoring. Stale endpoints require explicit refresh first;
 * geometry and optional metadata in the currently owned keys remain exact. */
export function setRememberedMotionOpacityEase(project:Timeline,ids:readonly string[],start:number,end:number,
 request:Ease|null,options:{validate?:()=>void}={}){
  return editRememberedNumericChannel(project,ids,start,end,request,options);
}
export function setRememberedOpacityKey(project:Timeline,ids:readonly string[],start:number,end:number,
 frame:number,value:number|null,options:{validate?:()=>void}={}) {
  if (!Number.isSafeInteger(frame) || frame<=start || frame>=end || (value!==null && (!Number.isFinite(value)||value<0||value>1)))
    throw Error('Choose an interior frame and an opacity between 0 and 100 percent.');
  return editRememberedNumericChannel(project,ids,start,end,null,options,{field:'opacityKeys',offset:frame-start,value});
}
export function setRememberedPositionKey(project:Timeline,ids:readonly string[],start:number,end:number,
 axis:'x'|'y',frame:number,value:number|null,options:{validate?:()=>void}={}) {
  if ((axis!=='x' && axis!=='y') || !Number.isSafeInteger(frame) || frame<=start || frame>=end || (value!==null && !Number.isFinite(value)))
    throw Error('Choose a position axis, interior frame and finite coordinate.');
  return editRememberedNumericChannel(project,ids,start,end,null,options,{field:axis==='x'?'xKeys':'yKeys',offset:frame-start,value});
}
export function setRememberedPositionTiming(project:Timeline, ids:readonly string[], start:number, end:number,
 axis:'x'|'y', frame:number, ease:Ease, options:{validate?:()=>void}={}) {
  if ((axis!=='x' && axis!=='y') || !Number.isSafeInteger(frame) || frame<=start || frame>end)
    throw Error('Choose a position interval ending at a key or the last frame.');
  return setRememberedIntervalTiming(project,ids,start,end,axis,frame,ease,options);
}
export function setRememberedIntervalTiming(project:Timeline, ids:readonly string[], start:number, end:number,
 property:TimedProperty|'fill'|'stroke'|number, frame:number, ease:Ease, options:{validate?:()=>void}={}) {
  if(property==='fill'||property==='stroke'||typeof property==='number'){
    if(typeof property==='number' && (!Number.isSafeInteger(property)||property<0||property>=32))throw Error('Choose a matched gradient stop.');
    if(!Number.isSafeInteger(frame)||frame<=start||frame>end)throw Error('Choose an interval ending at an authored key.');
    return editRememberedPaintChannel(project,ids,start,end,ease,options,undefined,{property,offset:frame-start});
  }
  if(!liveNumericChannels.some(channel=>channel.property===property) || !Number.isSafeInteger(frame) || frame<=start || frame>end)
    throw Error('Choose an interval ending at a key or the last frame.');
  return editRememberedNumericChannel(project,ids,start,end,ease,options,undefined,{axis:property,offset:frame-start});
}
export function setRememberedScaleKey(project:Timeline,ids:readonly string[],start:number,end:number,
 axis:'x'|'y',frame:number,value:number|null,options:{validate?:()=>void}={}) {
  if ((axis!=='x' && axis!=='y') || !Number.isSafeInteger(frame) || frame<=start || frame>=end || (value!==null && !Number.isFinite(value)))
    throw Error('Choose a scale axis, an interior frame and a finite scale.');
  return editRememberedNumericChannel(project,ids,start,end,null,options,{field:axis==='x'?'scaleXKeys':'scaleYKeys',offset:frame-start,value});
}
export function setRememberedRotationOrShearKey(project:Timeline,ids:readonly string[],start:number,end:number,
 property:'rotation'|'shear',frame:number,value:number|null,options:{validate?:()=>void}={}) {
  if ((property!=='rotation' && property!=='shear') || !Number.isSafeInteger(frame) || frame<=start || frame>=end || (value!==null && !Number.isFinite(value)))
    throw Error('Choose an interior frame and a finite rotation or shear.');
  return editRememberedNumericChannel(project,ids,start,end,null,options,{field:property==='rotation'?'rotationKeys':'shearKeys',offset:frame-start,value});
}
function editRememberedNumericChannel(project:Timeline,ids:readonly string[],start:number,end:number,
 request:Ease|null,options:{validate?:()=>void},keyEdit?:{field:keyof NumericTracks;offset:number;value:number|null},timingEdit?:{axis:TimedProperty;offset:number}){
 const prior=rememberedChannelEditors.get(project);if(prior){prior.invalid=true;throw Error('Opacity easing cannot reenter its original source.');}
 const owner={invalid:false};rememberedChannelEditors.set(project,owner);
 try{
  const stamp=(value:unknown)=>{try{return selectionTrajectoryStamp(value);}catch(cause){throw new Error('Opacity editing requires finite original data fields.',{cause});}};
  const original=stamp(project),layers=project.layers,symbols=project.symbols,duration=project.duration;
  const references=layers.map(layer=>({layer,keys:layer.keys,spans:layer.motionSpans}));
  const check=()=>{if(owner.invalid||project.layers!==layers||project.symbols!==symbols||project.duration!==duration||references.some((r,i)=>layers[i]!==r.layer||r.layer.keys!==r.keys||r.layer.motionSpans!==r.spans))throw Error('The original opacity easing source changed.');};
  const current=()=>{check();if(stamp(project)!==original)throw Error('The original opacity easing source changed.');check();};
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end-start<2||end>=duration)throw Error('Choose a complete remembered opacity range.');
  if(!Array.isArray(ids))throw Error('Choose distinct original opacity tracks.');
  const count=ids.length,selected:string[]=[],seen=new Set<string>();
  if(!Number.isSafeInteger(count)||count<1||count>layers.length)throw Error('Choose distinct original opacity tracks.');
  for(let i=0;i<count;i++){const id=ids[i];if(typeof id!=='string'||!id||seen.has(id))throw Error('Choose distinct original opacity tracks.');seen.add(id);selected.push(id);}
  if(ids.length!==count)throw Error('Opacity track requests changed while being read.');
  if(timingEdit && request!==null) validatePositionEaseArray([request]);
  const target=request===null?undefined:captureOpacityEase(request);
  const targetStamp=stamp(target);
  if(request!==null&&target===undefined)throw Error('Choose explicit opacity easing or remove its override.');
  if(!options||typeof options!=='object'||Array.isArray(options)||Reflect.ownKeys(options).some(key=>key!=='validate'))throw Error('Invalid opacity editing options.');
  const validate=options.validate;
  if(validate!==undefined&&typeof validate!=='function')throw Error('Opacity validation must be synchronous.');
  const admit=()=>{current();const result=validate?.() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw Error('Opacity validation must be synchronous.');}current();};
  admit();
  if('schemaVersion' in project)validateProject(project);
  if((symbols??[]).reduce((n,s)=>n+symbolArtworks(s).reduce((m,a)=>m+a.length,0),0)>MAX_SYMBOL_ARTWORK)throw Error('Opacity editing exceeds the original symbol artwork budget.');
  let changed=false;
  const prepared=selected.map(id=>{
   const matches=layers.filter(l=>l.id===id),layer=matches[0];
   if(matches.length!==1||!layer.visible||layer.locked)throw Error('Choose visible unlocked original opacity tracks.');
   const spans=layer.motionSpans?.filter(s=>s.start===start&&s.end===end),span=spans?.[0];
   if(spans?.length!==1||!span||layer.motionSpans!.filter(s=>s.id===span.id).length!==1||layer.motionSpans!.some(s=>s!==span&&s.start<end&&s.end>start))throw Error('Choose one unique original opacity recipe per track.');
   const generated=requireOwnedMotionInterior(layer,span);
   checkMotionReconstruction(project,layer,span,generated,'Refresh changed endpoints before editing opacity easing.');
   const saved=captureOpacityEase(span.opacityEase);
   const nextEase=keyEdit || timingEdit ? saved : target;
   const field=keyEdit?.field ?? (timingEdit ? intervalKeys[`${timingEdit.axis}KeyEases`] : 'opacityKeys');
   const property=liveNumericChannels.find(c=>c.field===field)!.property;
   let propertyKeys=span[field];
   if (keyEdit) {
     const kept=(propertyKeys ?? []).filter(k=>k.offset!==keyEdit.offset);
     if (keyEdit.value!==null) kept.push({offset:keyEdit.offset,value:keyEdit.value});
     else if (kept.length===(propertyKeys?.length ?? 0)) throw Error('No remembered '+property+' key at this frame.');
     propertyKeys=kept.length ? kept.sort((a,b)=>a.offset-b.offset) : undefined;
   }
   const timingField= `${property}KeyEases` as const;
   let intervalTiming=span[timingField];
   if(intervalTiming || timingEdit){
     const channel=property==='x'||property==='y'?'position':property;
     intervalTiming=remapIntervalTiming(span[field],propertyKeys,intervalTiming,end-start,channel,
       timingEdit ? {offset:timingEdit.offset,ease:target!} : undefined);
   }
   if(stamp(span[timingField])===stamp(intervalTiming) && JSON.stringify(saved)===JSON.stringify(nextEase) && JSON.stringify(propertyKeys)===JSON.stringify(span[field]))return {layer,keys:layer.keys,spans:layer.motionSpans!};
   changed=true;
   const draft={...layer,keys:layer.keys.filter(k=>k.frame<=start||k.frame>=end)};
   const nextSpan={...span,opacityEase:nextEase};
   if(intervalTiming)nextSpan[timingField]=intervalTiming;else delete nextSpan[timingField];
   if (propertyKeys) nextSpan[field]=propertyKeys; else delete nextSpan[field];
   generateRemembered({...project,layers:[draft]},[id],start,end,span.ease,span.options,span.path,span.rotation,span.correspondence,nextEase,span.paintEase,nextSpan);
   checkMotionReconstruction({...project,layers:[draft]},draft,nextSpan,interior(draft,start,end),'Prepared opacity keys do not match the requested curve.');
   const geometry=(shape:typeof generated[number]['shapes'][number])=>{const next={...shape};
     if(property==='sx' || property==='sy' || property==='shear'){
       if(!shape.transform)throw Error('Missing sampled affine transform.');
       next.transform=[...shape.transform];next.transform[property==='sx'?0:property==='sy'?3:2]=1;
     }else Reflect.deleteProperty(next,property);
     return next;};
   const keys=layer.keys.map(key=>{
    if(key.frame<=start||key.frame>=end)return key;
    const next=draft.keys.find(k=>k.frame===key.frame)!;
    if(!next||!sameMotionArtwork(next.shapes.map(geometry),key.shapes.map(geometry)))throw Error('Editing a property key cannot change other artwork geometry.');
    return {...key,shapes:key.shapes.map((shape,i)=>{const copy={...shape};if(property==='sx'||property==='sy'||property==='shear')copy.transform=[...next.shapes[i].transform!];else if(Object.hasOwn(next.shapes[i],property))Object.assign(copy,{[property]:next.shapes[i][property]});else Reflect.deleteProperty(copy,property);return copy;})};
   });
   const replacement={...span,baseline:JSON.stringify(keys.filter(k=>k.frame>start&&k.frame<end))};
   if(intervalTiming) replacement[timingField]=clone(intervalTiming); else delete replacement[timingField];
   if(stamp(replacement[timingField])!==stamp(intervalTiming))throw Error('Prepared interval easing changed during cloning.');
   if(propertyKeys)replacement[field]=clone(propertyKeys);else delete replacement[field];
   if(nextEase===undefined)delete replacement.opacityEase;else replacement.opacityEase=clone(nextEase);
   if(stamp(target)!==targetStamp||stamp(replacement.opacityEase)!==stamp(nextEase) || stamp(replacement[field])!==stamp(propertyKeys))throw Error('Prepared opacity easing changed during cloning.');
   return {layer,keys,spans:layer.motionSpans!.map(s=>s===span?replacement:s)};
  });
  if(!changed)throw Error('Opacity easing already matches all selected recipes.');
  if('schemaVersion' in project){const byId=new Map(prepared.map(p=>[p.layer,p]));validateProject({...project,layers:layers.map(layer=>{const next=byId.get(layer);return next?{...layer,keys:next.keys,motionSpans:next.spans}:layer;})});}
  admit();
  for(const {layer}of prepared)for(const key of ['keys','motionSpans']as const){const field=Object.getOwnPropertyDescriptor(layer,key);if(!field||!Object.hasOwn(field,'value')||!field.writable)throw Error('Opacity tracks are no longer writable.');}
  check();for(const {layer,keys,spans}of prepared){layer.keys=keys;layer.motionSpans=spans;}
 }finally{rememberedChannelEditors.delete(project);}
}
/** Atomic paint-only reauthoring, retaining exact non-paint geometry and object opacity. Stale endpoints require explicit refresh first;
 * geometry and optional metadata in the currently owned keys remain exact. */
export function setRememberedMotionPaintEase(project:Timeline,ids:readonly string[],start:number,end:number,
 request:Ease|null,options:{validate?:()=>void}={}){
 return editRememberedPaintChannel(project,ids,start,end,request,options);
}
function remapIntervalTiming(
  original:readonly {offset:number}[]|undefined, updated:readonly {offset:number}[]|undefined,
  timing:readonly Ease[]|undefined, length:number, channel:string, edit?:{offset:number;ease:Ease}
) {
  const previous=[...(original??[]).map(key=>key.offset),length];
  const ends=updated ? [...updated.map(key=>key.offset),length] : [];
  if(edit && !ends.includes(edit.offset))throw Error('Choose an existing '+channel+' interval.');
  const saved=new Map(previous.map((offset,i)=>[offset,timing?.[i]??'linear']));
  const curves=ends.map(offset=>offset===edit?.offset ? edit.ease : saved.get(offset)??'linear');
  return curves.some(ease=>ease!=='linear') ? curves : undefined;
}
export function setRememberedColorKey(project:Timeline,ids:readonly string[],start:number,end:number,property:'fill'|'stroke'|number,frame:number,color:string|null,options:{validate?:()=>void}={}) {
 if ((property!=='fill' && property!=='stroke' && !(typeof property==='number' && Number.isSafeInteger(property) && property>=0 && property<32)) || !Number.isSafeInteger(frame) || frame<=start || frame>=end ||
    (color!==null && (typeof color!=='string' || !/^#[0-9a-f]{6}$/i.test(color)))) throw Error('Choose an interior frame and a six-digit RGB color.');
 return editRememberedPaintChannel(project,ids,start,end,null,options,{property,offset:frame-start,color});
}
function editRememberedPaintChannel(project:Timeline,ids:readonly string[],start:number,end:number,request:Ease|null,
 options:{validate?:()=>void},keyEdit?:{property:'fill'|'stroke'|number;offset:number;color:string|null},timingEdit?:{property:'fill'|'stroke'|number;offset:number}) {
 const prior=rememberedChannelEditors.get(project);if(prior){prior.invalid=true;throw Error('Paint easing cannot reenter its original source.');}
 const owner={invalid:false};rememberedChannelEditors.set(project,owner);
 try{
  const stamp=(value:unknown)=>{try{return selectionTrajectoryStamp(value);}catch(cause){throw new Error('Paint editing requires finite original data fields.',{cause});}};
  const original=stamp(project),layers=project.layers,symbols=project.symbols,duration=project.duration;
  const references=layers.map(layer=>({layer,keys:layer.keys,spans:layer.motionSpans}));
  const check=()=>{if(owner.invalid||project.layers!==layers||project.symbols!==symbols||project.duration!==duration||references.some((r,i)=>layers[i]!==r.layer||r.layer.keys!==r.keys||r.layer.motionSpans!==r.spans))throw Error('The original paint easing source changed.');};
  const current=()=>{check();if(stamp(project)!==original)throw Error('The original paint easing source changed.');check();};
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end-start<2||end>=duration)throw Error('Choose a complete remembered paint range.');
  if(!Array.isArray(ids))throw Error('Choose distinct original paint tracks.');
  const count=ids.length,selected:string[]=[],seen=new Set<string>();
  if(!Number.isSafeInteger(count)||count<1||count>layers.length)throw Error('Choose distinct original paint tracks.');
  for(let i=0;i<count;i++){const id=ids[i];if(typeof id!=='string'||!id||seen.has(id))throw Error('Choose distinct original paint tracks.');seen.add(id);selected.push(id);}
  if(ids.length!==count)throw Error('Paint track requests changed while being read.');
  if(timingEdit)validatePositionEaseArray([request!]);
  const target=request===null?undefined:capturePaintEase(request,true);
  const targetStamp=stamp(target);
  if(request!==null&&target===undefined)throw Error('Choose explicit paint easing or remove its override.');
  if(!options||typeof options!=='object'||Array.isArray(options)||Reflect.ownKeys(options).some(key=>key!=='validate'))throw Error('Invalid paint editing options.');
  const validate=options.validate;
  if(validate!==undefined&&typeof validate!=='function')throw Error('Paint validation must be synchronous.');
  const admit=()=>{current();const result=validate?.() as unknown;if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>{});throw Error('Paint validation must be synchronous.');}current();};
  admit();
  if('schemaVersion' in project)validateProject(project);
  if((symbols??[]).reduce((n,s)=>n+symbolArtworks(s).reduce((m,a)=>m+a.length,0),0)>MAX_SYMBOL_ARTWORK)throw Error('Paint editing exceeds the original symbol artwork budget.');
  let changed=false;
  const prepared=selected.map(id=>{
   const matches=layers.filter(l=>l.id===id),layer=matches[0];
   if(matches.length!==1||!layer.visible||layer.locked)throw Error('Choose visible unlocked original paint tracks.');
   const spans=layer.motionSpans?.filter(s=>s.start===start&&s.end===end),span=spans?.[0];
   if(spans?.length!==1||!span||layer.motionSpans!.filter(s=>s.id===span.id).length!==1||layer.motionSpans!.some(s=>s!==span&&s.start<end&&s.end>start))throw Error('Choose one unique original paint recipe per track.');
   const editedProperty=timingEdit?.property??keyEdit?.property;
   if(!span.options?.[editedProperty==='stroke'?'strokeColor':'paint']) throw Error(keyEdit?'Enable the corresponding color interpolation on the remembered recipe.':'Paint easing requires saved paint interpolation.');
   const generated=requireOwnedMotionInterior(layer,span);
   checkMotionReconstruction(project,layer,span,generated,'Refresh changed endpoints before editing paint easing.');
   const saved=capturePaintEase(span.paintEase,span.options?.paint??false);
   const nextEase=keyEdit||timingEdit?saved:target;
   const nextSpan={...span};
   if(keyEdit){
     const property=keyEdit.property;
     const field=property==='fill'?'fillColorKeys':'strokeColorKeys';
     const rows=span.gradientColorTracks ?? [];
     const existing=(typeof property==='number' ? rows.find(row=>row.stop===property)?.keys : span[field]) ?? [];
     const kept=existing.filter(k=>k.offset!==keyEdit.offset);
     if(keyEdit.color!==null) kept.push({offset:keyEdit.offset,color:keyEdit.color});
     else if(kept.length===existing.length) throw Error('No remembered color key at this frame.');
     kept.sort((a,b)=>a.offset-b.offset);
     if(typeof property==='number'){
       const next=rows.filter(row=>row.stop!==property);
       if(kept.length) next.push({stop:property,keys:kept});
       if(next.length) nextSpan.gradientColorTracks=next.sort((a,b)=>a.stop-b.stop); else delete nextSpan.gradientColorTracks;
     }else if(kept.length) nextSpan[field]=kept; else delete nextSpan[field];
   }
   if(typeof editedProperty==='number'){
     const old=span.gradientColorTracks?.find(row=>row.stop===editedProperty);
     const row=nextSpan.gradientColorTracks?.find(row=>row.stop===editedProperty);
     const eases=remapIntervalTiming(old?.keys,row?.keys,old?.eases,end-start,'gradient stop',
       timingEdit?{offset:timingEdit.offset,ease:target!}:undefined);
     if(row && (old?.eases || eases)){
       const updated={stop:row.stop,keys:row.keys,...(eases ? {eases} : {})};
       nextSpan.gradientColorTracks=nextSpan.gradientColorTracks!.map(r=>r===row?updated:r);
     }
   }
   if(editedProperty==='fill'||editedProperty==='stroke'){
     const field=`${editedProperty}ColorKeys` as const, timingField=`${editedProperty}KeyEases` as const;
     if(span[timingField]||timingEdit){
       const timing=remapIntervalTiming(span[field],nextSpan[field],span[timingField],end-start,editedProperty,
         timingEdit?{offset:timingEdit.offset,ease:target!}:undefined);
       if(timing)nextSpan[timingField]=timing;else delete nextSpan[timingField];
     }
   }
   if(nextEase===undefined)delete nextSpan.paintEase;else nextSpan.paintEase=clone(nextEase);
   if(stamp(nextSpan.paintEase)!==stamp(nextEase))throw Error('Prepared paint easing changed during cloning.');
   const desired=stamp(nextSpan);
   if(stamp(span)===desired)return {layer,keys:layer.keys,spans:layer.motionSpans!};
   changed=true;
   const draft={...layer,keys:layer.keys.filter(k=>k.frame<=start||k.frame>=end)};
   generateRemembered({...project,layers:[draft]},[id],start,end,span.ease,span.options,span.path,span.rotation,span.correspondence,span.opacityEase,nextEase,nextSpan);
   checkMotionReconstruction({...project,layers:[draft]},draft,nextSpan,interior(draft,start,end),'Prepared paint keys do not match the requested curve.');
   const geometry=(shape:typeof generated[number]['shapes'][number])=>{const next:Record<string,unknown>={...shape};delete next.fill;delete next.stroke;if(shape.gradient)next.gradient={...shape.gradient,stops:shape.gradient.stops.map(stop=>{const copy:Record<string,unknown>={...stop};delete copy.color;delete copy.opacity;return copy;})};return next;};
   const keys=layer.keys.map(key=>{
    if(key.frame<=start||key.frame>=end)return key;
    const next=draft.keys.find(k=>k.frame===key.frame)!;
    if(!next||!sameMotionArtwork(next.shapes.map(geometry),key.shapes.map(geometry)))throw Error('Paint editing cannot change other artwork geometry.');
    return {...key,shapes:key.shapes.map((shape,i)=>{const replacement=next.shapes[i];if(typeof editedProperty==='number'){
      const index=editedProperty, gradient=shape.gradient!;
      return {...shape,gradient:{...gradient,stops:gradient.stops.map((stop,j)=>j===index?{...stop,color:replacement.gradient!.stops[j].color}:stop)}};
    }if(editedProperty==='fill'||editedProperty==='stroke')return {...shape,[editedProperty]:replacement[editedProperty]};const copy={...shape,fill:replacement.fill,stroke:replacement.stroke};if(shape.gradient)copy.gradient={...shape.gradient,stops:shape.gradient.stops.map((stop,j)=>{const admitted=replacement.gradient!.stops[j],copy={...stop,color:admitted.color};if(Object.hasOwn(admitted,'opacity'))copy.opacity=admitted.opacity;else delete copy.opacity;return copy;})};return copy;})};
   });
   const replacement={...nextSpan,baseline:JSON.stringify(keys.filter(k=>k.frame>start&&k.frame<end))};
   if(stamp(target)!==targetStamp || stamp(nextSpan)!==desired || stamp(replacement.paintEase)!==stamp(nextEase))throw Error('Prepared paint easing changed during cloning.');
   return {layer,keys,spans:layer.motionSpans!.map(s=>s===span?replacement:s)};
  });
  if(!changed)throw Error('Paint easing already matches all selected recipes.');
  if('schemaVersion' in project){const byId=new Map(prepared.map(p=>[p.layer,p]));validateProject({...project,layers:layers.map(layer=>{const next=byId.get(layer);return next?{...layer,keys:next.keys,motionSpans:next.spans}:layer;})});}
  admit();
  for(const {layer}of prepared)for(const key of ['keys','motionSpans']as const){const field=Object.getOwnPropertyDescriptor(layer,key);if(!field||!Object.hasOwn(field,'value')||!field.writable)throw Error('Paint tracks are no longer writable.');}
  check();for(const {layer,keys,spans}of prepared){layer.keys=keys;layer.motionSpans=spans;}
 }finally{rememberedChannelEditors.delete(project);}
}
/** Readout only; no proposed easing owns a saved recipe. */
export function rememberedOpacitySummary(layers:Timeline['layers'],ids:readonly string[],start:number,end:number){
 if(!ids.length)return 'No remembered tracks selected';
 const values: (Ease|undefined)[]=[];
 for(const id of ids){const tracks=layers.filter(l=>l.id===id),spans=tracks[0]?.motionSpans?.filter(s=>s.start===start&&s.end===end);if(tracks.length!==1||spans?.length!==1)return 'Select one complete remembered range';values.push(spans[0].opacityEase);}
 try{if(new Set(values.map(value=>JSON.stringify(captureOpacityEase(value)))).size!==1)return 'Mixed opacity easing';}catch{return 'Invalid saved opacity easing';}
 const value=values[0];if(value===undefined)return 'Opacity inherits global easing';
 return typeof value==='string'?`Independent opacity: ${value}`:`Independent opacity cubic: ${value.x1}, ${value.y1}, ${value.x2}, ${value.y2}`;
}

export function rememberedPaintSummary(layers:Timeline['layers'],ids:readonly string[],start:number,end:number){
 if(!ids.length)return 'No remembered tracks selected';
 const values: (Ease|undefined)[]=[],enabled:boolean[]=[];
 for(const id of ids){const tracks=layers.filter(l=>l.id===id),spans=tracks[0]?.motionSpans?.filter(s=>s.start===start&&s.end===end);if(tracks.length!==1||spans?.length!==1)return 'Select one complete remembered range';values.push(spans[0].paintEase);enabled.push(spans[0].options?.paint===true);}
 if(enabled.every(value=>!value))return 'Paint interpolation disabled';
 if(enabled.some(value=>!value))return 'Mixed paint interpolation';
 try{if(new Set(values.map(value=>JSON.stringify(capturePaintEase(value,true)))).size!==1)return 'Mixed paint easing';}catch{return 'Invalid saved paint easing';}
 const value=values[0];if(value===undefined)return 'Paint inherits global easing';
 return typeof value==='string'?`Independent paint: ${value}`:`Independent paint cubic: ${value.x1}, ${value.y1}, ${value.x2}, ${value.y2}`;
}

type Spin = Pick<MotionRotation,'direction'|'turns'>;
export function setRememberedMotionSpin(project:Timeline,ids:string[],start:number,end:number,spin:Spin) {
  const replacementSpin = {direction:spin.direction,turns:spin.turns};
  validateMotionRotation(replacementSpin);
  regenerateRemembered(project,ids,start,end,{replacementSpin});
}

function regenerateRemembered(project:Timeline,ids:string[],start:number,end:number,
  {replacementEase,replacementPath,replacementSpin}:{replacementEase?:Ease;replacementPath?:MotionPath|null;replacementSpin?:Spin}) {
  if (replacementEase !== undefined) validateMotionEase(replacementEase);
  if (replacementPath !== undefined && replacementPath !== null) validateMotionPath(replacementPath);
  const selected = [...new Set(ids)];
  if (!selected.length) throw new Error('Choose motion tracks.');
  const prepared = selected.map((key) => {
    const layer = project.layers.find((candidate) => candidate.id === key);
    if (!layer || !layer.visible || layer.locked)
      throw new Error('Choose visible, unlocked motion tracks.');
    const span = layer.motionSpans?.find(
      (candidate) => candidate.start === start && candidate.end === end,
    );
    if (!span) throw new Error('No remembered motion span matches this range.');
    if (JSON.stringify(interior(layer, start, end)) !== span.baseline)
      throw new Error('Generated keys changed; detach the span to preserve those edits.');
    const draft = {
      ...layer,
      keys: layer.keys.filter((key) => key.frame <= start || key.frame >= end),
    };
    const rotation = replacementSpin ? {...span.rotation,...replacementSpin} : span.rotation;
    generateRemembered(
      { ...project, layers: [draft] },
      [layer.id],
      start,
      end,
      replacementEase ?? span.ease,
      span.options,
      replacementPath === undefined ? span.path : replacementPath ?? undefined,
      rotation,
      span.correspondence,
      span.opacityEase,
      span.paintEase,
      span,
    );
    const baseline = JSON.stringify(interior(draft, start, end));
    const updated = { ...span, ...(replacementEase === undefined ? {} : {ease:clone(replacementEase)}), baseline };
    if (replacementSpin && rotation) updated.rotation=clone(rotation);
    if (replacementPath === null) delete updated.path;
    else if (replacementPath !== undefined) updated.path = clone(replacementPath);
    return {
      layer,
      keys: draft.keys,
      spans: layer.motionSpans!.map((s) => (s === span ? updated : s)),
    };
  });
  for (const item of prepared) {
    item.layer.keys = item.keys;
    item.layer.motionSpans = item.spans;
  }
}

/** Restrict simple motion easing; custom curves use bounded Bezier subdivision. */
export function splitSimpleMotionEase(ease: Ease, fraction: number): [Ease, Ease] {
  validateMotionEase(ease);
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1)
    throw new Error('Choose an interior split fraction.');
  const quadratic = (linear: number): Ease => ({ kind: 'cubic', x1: 1 / 3, x2: 2 / 3,
    y1: linear / 3, y2: (1 + linear) / 3 });
  if (typeof ease === 'object') {
    if (ease.x1 === ease.y1 && ease.x2 === ease.y2) return ['linear', 'linear'];
    const sample = (u: number) => 3 * (1-u)**2 * u * ease.x1 + 3 * (1-u) * u*u * ease.x2 + u**3;
    let low = 0, high = 1;
    for (let i = 0; i < 60; i++) {
      const u = (low + high) / 2;
      if (sample(u) < fraction) low = u; else high = u;
    }
    const u = (low + high) / 2;
    const split = (a: number, b: number) => {
      const p = u*a, q = (1-u)*a + u*b, r = (1-u)*b + u;
      const v = (1-u)*p + u*q, w = (1-u)*q + u*r;
      return [p, v, (1-u)*v + u*w, w, r];
    };
    const x = split(ease.x1, ease.x2), y = split(ease.y1, ease.y2);
    if (!(x[2] > 0 && x[2] < 1 && y[2] > 0 && y[2] < 1))
      throw new Error('Preserved cubic split has an unresolved time or progress interval.');
    const left: Ease = { kind: 'cubic', x1: x[0]/x[2], x2: x[1]/x[2], y1: y[0]/y[2], y2: y[1]/y[2] };
    const right: Ease = { kind: 'cubic', x1: (x[3]-x[2])/(1-x[2]), x2: (x[4]-x[2])/(1-x[2]),
      y1: (y[3]-y[2])/(1-y[2]), y2: (y[4]-y[2])/(1-y[2]) };
    try { validateMotionEase(left); validateMotionEase(right); }
    catch { throw new Error('Preserved cubic split requires representable controls between zero and one.'); }
    return [left, right];
  }
  if (ease === 'linear') return ['linear', 'linear'];
  if (ease === 'in') return ['in', quadratic(2 * fraction / (1 + fraction))];
  if (ease === 'out') return [quadratic(2 / (2 - fraction)), 'out'];
  if (ease === 'in-out' && fraction === 0.5) return ['in', 'out'];
  throw new Error('Preserved splits support Linear, Ease in, Ease out, the midpoint of Ease in-out, or representable custom cubic curves.');
}

/** Promote one interior key, then reapply the recipe independently to both halves.
 * Default mode reauthors both halves; preserve mode restricts supported simple easing. */
export function splitBasicMotionSpan(project: Timeline, ids: string[], start: number, end: number, at: number, preserve = false, allowAdjacent = false) {
  const minimum = allowAdjacent ? 1 : 2;
  if (![start, end, at].every(Number.isSafeInteger) || at - start < minimum || end - at < minimum)
    throw new Error('Split requires at least three frames in each half.');
  const selected = [...new Set(ids)];
  if (!selected.length) throw new Error('Choose motion tracks.');
  const prepared = selected.map((key) => {
    const layer = project.layers.find((l) => l.id === key);
    if (!layer || !layer.visible || layer.locked)
      throw new Error('Choose visible, unlocked motion tracks.');
    const span = layer.motionSpans?.find((s) => s.start === start && s.end === end);
    if (!span) throw new Error('No remembered motion span matches this range.');
    const baseline = JSON.parse(span.baseline) as typeof layer.keys;
    if (!Array.isArray(baseline) || !baseline.some((k) => k.frame === at) ||
        !layer.keys.some((k) => k.frame === at) ||
        JSON.stringify(interior(layer, start, end).filter((k) => k.frame !== at)) !==
        JSON.stringify(baseline.filter((k) => k.frame !== at)))
      throw new Error('Only the split key may be edited; other generated keys must match the recipe.');
    let options: [MotionSpanOptions | undefined, MotionSpanOptions | undefined] = [span.options, span.options];
    let correspondences: [MotionContourCorrespondence | undefined, MotionContourCorrespondence | undefined] = [span.correspondence, span.correspondence];
    if (!preserve && span.correspondence?.source) {
      const {source,...target}=span.correspondence;
      // An edited generated key retains its aligned indexing. Keep each
      // authored endpoint's alignment on its own side during reauthoring too.
      correspondences=[{source:clone(source),...(target.nodes!==undefined?{nodes:clone(target.nodes)}:{})},Object.keys(target).length?clone(target):undefined];
    }
    let eases: [Ease, Ease] = [span.ease, span.ease];
    let opacityEases:[Ease|undefined,Ease|undefined]=[span.opacityEase,span.opacityEase];
    let paintEases:[Ease|undefined,Ease|undefined]=[span.paintEase,span.paintEase];
    let rotations: [MotionRotation | undefined, MotionRotation | undefined] = [span.rotation, span.rotation];
    let paths: [MotionPath | undefined, MotionPath | undefined] = [span.path, span.path];
    if (preserve) {
      const nodeMatching=span.correspondence?.nodes;
      if (Object.entries(span.options ?? {}).some(([name, enabled]) => enabled && !['gradientStops', 'paint', 'gradientPremultiplied', 'affine', 'gradientBasis', 'primitives', 'strokeWidth', 'strokeColor', 'gradientGeometry', 'nodes', 'contourAreas', 'contourEdges', 'contourContacts', 'curveTangents', 'curveSelfContacts', 'pivots', 'defaultPivots'].includes(name)) ||
          (span.rotation?.rigidGroups && ((span.options?.affine && !span.rotation.uniformGroupScale && !span.rotation.axisGroupScale) || ((span.rotation.savedGroupPivots || span.rotation.rigidPivot) && span.path && span.path.tangent))))
        throw new Error('Preserved splits require simple position/rotation/opacity motion without correspondence or unsupported property/group interpolation.');
      eases = splitSimpleMotionEase(span.ease, (at - start) / (end - start));
      if(span.opacityEase!==undefined)opacityEases=splitSimpleMotionEase(span.opacityEase,(at-start)/(end-start));
      if(span.paintEase!==undefined)paintEases=splitSimpleMotionEase(span.paintEase,(at-start)/(end-start));
      const original = { ...layer, keys: layer.keys.filter(k => k.frame <= start || k.frame >= end) };
      generateRemembered({ ...project, layers: [original] }, [key], start, end, span.ease, span.options, span.path, span.rotation, span.correspondence,span.opacityEase,span.paintEase,span);
      if (JSON.stringify(interior(original, start, end)) !== JSON.stringify(interior(layer, start, end)))
        throw new Error('Preserved splits require unchanged generated motion, including the split key and endpoints.');
      correspondences=[nodeMatching?{nodes:nodeMatching}:undefined,span.correspondence];
      if (span.correspondence?.source) {
        const {source,...target}=span.correspondence;
        // The promoted key already uses the aligned indexing. Reapply each
        // endpoint alignment only on the half that still owns that endpoint.
        correspondences=[{source:clone(source),...(target.nodes!==undefined?{nodes:clone(target.nodes)}:{})},Object.keys(target).length?clone(target):undefined];
      }
      if(typeof nodeMatching==='object' && nodeMatching.hints){
        const first=layer.keys.find(k=>k.frame===start)!.shapes,last=layer.keys.find(k=>k.frame===end)!.shapes,c=span.correspondence!;
        let shared: number[][]|undefined;
        first.forEach((shape,i)=>{
          const indices:number[][]=[];
          const target=shiftMotionContourStart(last[i],c.start??0,c.reverse??false,c.order);
          const source=c.source?shiftMotionContourStart(shape,c.source.start??0,c.source.reverse??false,c.source.order):shape;
          matchStraightMotionNodes(source,target,nodeMatching.hints,nodeMatching.curves===true,nodeMatching.distance===true,ring=>indices.push(ring));
          if(shared && JSON.stringify(shared)!==JSON.stringify(indices))throw new Error('Preserved hints require shared expanded indices across artwork.');
          shared=indices;
        });
        const left=nodeMatching.hints.map((ring,r)=>ring.map(([a],i)=>[a,shared![r][i]] as const));
        const right=nodeMatching.hints.map((ring,r)=>ring.map(([,b],i)=>[shared![r][i],b] as const));
        correspondences=[{...correspondences[0],nodes:{...nodeMatching,hints:left}},{...correspondences[1],nodes:{...nodeMatching,hints:right}}];
      }
      const matching=span.options?.gradientStops;
      if(typeof matching==='object'){
        let pairs:readonly (readonly [number,number])[] | undefined=matching.pairs==='auto'?undefined:matching.pairs;
        if(matching.pairs==='auto'){
          const first=layer.keys.find(k=>k.frame===start)!.shapes,last=layer.keys.find(k=>k.frame===end)!.shapes;
          for(let i=0;i<first.length;i++){
            const resolved=resolveAutomaticGradientPairs(first[i],last[i]);
            if(!resolved)continue;
            if(pairs && JSON.stringify(pairs)!==JSON.stringify(resolved))throw new Error('Preserved automatic gradient splits require shared correspondence across artwork.');
            pairs=resolved;
          }
        }
        if(pairs){
          for(const shape of layer.keys.find(k=>k.frame===at)!.shapes){
            if(!shape.gradient) continue;
            const groups=shape.gradient.stops.filter((stop,i,stops)=>i===0||stop.offset!==stops[i-1].offset);
            if(groups.length!==pairs.length) throw new Error('Preserved gradient pairing requires distinct resolved split groups.');
          }
          options=[
            {...span.options,gradientStops:{pairs:pairs.map(([from],i)=>[from,i] as const)}},
            {...span.options,gradientStops:{pairs:pairs.map(([,to],i)=>[i,to] as const)}},
          ];
        }
      }
      if (!span.rotationKeys && span.rotation && span.rotation.direction !== 'shortest') {
        const first=layer.keys.find(k=>k.frame===start)!.shapes,last=layer.keys.find(k=>k.frame===end)!.shapes;
        const middle=layer.keys.find(k=>k.frame===at)!.shapes;
        const progress=motionProgress((at-start)/(end-start),span.ease),rotation=span.rotation;
        const members=rotation.rigidGroups?prepareRigidGroups(first,last,rotation):undefined;
        const derive=(right:boolean):MotionRotation=>{
          const counts=first.map((shape,i)=>{
            const angle=(shape: typeof first[number])=>span.options?.affine&&!members?.[i]?affinePose(shape).rotation:shape.rotation;
            const from=angle(shape),to=angle(last[i]),mid=angle(middle[i]);
            const total=motionRotationDelta(from,to,rotation);
            const wanted=total*(right?1-progress:progress);
            const base=motionRotationDelta(right?mid:from,right?to:mid,{...rotation,turns:0});
            const turns=Math.round((wanted-base)/(rotation.direction==='clockwise'?360:-360));
            const result={...rotation,turns};validateMotionRotation(result);
            const actual=motionRotationDelta(right?mid:from,right?to:mid,result);
            if(Math.abs(actual-wanted)>32*Number.EPSILON*Math.max(1,Math.abs(actual),Math.abs(wanted)))
              throw new Error('Preserved rotation split is numerically unresolved.');
            return turns;
          });
          if(counts.some(turns=>turns!==counts[0])) throw new Error('Preserved rotation splits require shared extra-turn counts on each half.');
          return {...rotation,turns:counts[0]};
        };
        rotations=[derive(false),derive(true)];
      }
      // A rotated split basis expresses the remaining document-axis transform
      // with shear even when the original recipe used only diagonal scaling.
      if(span.rotation?.axisGroupScale)rotations[1]={...rotations[1]!,axisGroupShear:true};
      if(span.rotation?.rigidPivot){
        const first=layer.keys.find(k=>k.frame===start)!.shapes,last=layer.keys.find(k=>k.frame===end)!.shapes;
        const t=motionProgress((at-start)/(end-start),span.ease);
        const members=prepareRigidGroups(first,last,span.rotation);
        let pivot: {x:number;y:number}|undefined;
        members.forEach((member,i)=>{
          if(!member||member.leader!==i)return;
          // A custom pivot is a document-space offset. The right half starts
          // with the offset rotated/scaled by the original motion at the cut.
          const angle=((member.delta*t)%360)*Math.PI/180;
          const scale=1-t+t*member.endScale,c=scale*Math.cos(angle),s=scale*Math.sin(angle);
          const x=(1-t+t*member.endScaleX)*member.pivotX+t*member.endShear*member.pivotY;
          const y=(1-t+t*member.endScaleY)*member.pivotY+t*member.endShearY*member.pivotX;
          const next={x:c*x-s*y,y:s*x+c*y};
          if(!Number.isFinite(next.x)||!Number.isFinite(next.y))throw new Error('Preserved custom pivot exceeds numeric limits.');
          if(pivot&&(pivot.x!==next.x||pivot.y!==next.y))throw new Error('Preserved custom pivot splits require a shared transformed pivot across groups.');
          pivot=next;
        });
        rotations[1]={...rotations[1]!,rigidPivot:pivot};
        validateMotionRotation(rotations[1]);
      }
      if (span.path) {
        const first = layer.keys.find(k => k.frame === start)!.shapes;
        const last = layer.keys.find(k => k.frame === end)!.shapes;
        const dx = last[0].x - first[0].x, dy = last[0].y - first[0].y;
        const members=span.rotation?.rigidGroups?prepareRigidGroups(first,last,span.rotation):undefined;
        if (first.some((shape, i) => (!members?.[i] || members[i]!.leader===i) && (last[i].x - shape.x !== dx || last[i].y - shape.y !== dy)))
          throw new Error('Preserved path splits require matching endpoint displacement for every path leader or ungrouped artwork item.');
        paths = splitPreservedMotionPath(first[0], last[0], span.path, motionProgress((at-start)/(end-start), span.ease));
        if(span.rotation?.savedGroupPivots || span.rotation?.rigidPivot){
          const t=motionProgress((at-start)/(end-start),span.ease);
          let correction: {x:number;y:number}|undefined;
          first.forEach((_,i)=>{
            const member=members?.[i];if(member&&member.leader!==i)return;
            const next=member?rigidGroupPosition({x:0,y:0},{x:0,y:0},member,t):{x:0,y:0};
            if(correction&&(correction.x!==next.x||correction.y!==next.y))throw new Error('Preserved pivot paths require a shared leader correction.');
            correction=next;
          });
          // The exact split key includes its pivot correction. Add a linear
          // ramp to each restricted route so its reference route meets that key;
          // the half pivot correction removes the same ramp during generation.
          // Distance timing cannot absorb a linear progress ramp as geometry.
          // A zero correction needs no ramp and preserves the distance recipes.
          if(span.path.distance && (correction!.x!==0 || correction!.y!==0))
            throw new Error('Preserved distance pivot paths require exactly zero leader correction.');
          if(correction!.x!==0 || correction!.y!==0)
            paths=[offsetPreservedPath(paths[0]!,correction!),offsetPreservedPath(paths[1]!,{x:-correction!.x,y:-correction!.y})];
        }
      }
    }
    const draft = { ...layer, keys: layer.keys.filter((k) => k.frame <= start || k.frame >= end || k.frame === at) };
    const splitOffset=at-start;
    const trackHalves=[
      mapPropertyTracks(span,n=>n<splitOffset?n:null,(keys,timing)=>splitIntervalEases(keys,end-start,splitOffset,timing)[0]),
      mapPropertyTracks(span,n=>n>splitOffset?n-splitOffset:null,(keys,timing)=>splitIntervalEases(keys,end-start,splitOffset,timing)[1]),
    ];
    splitPositionTiming(span,splitOffset,trackHalves);
    for (const [index, [left, right]] of [[start, at], [at, end]].entries()) {
      // Remembered recipes require an interior frame. Adjacent authored keys
      // already represent that half in full.
      if (right - left === 1) continue;
      generateRemembered({ ...project, layers: [draft] }, [key], left, right, eases[index],
        options[index], paths[index], rotations[index], correspondences[index],opacityEases[index],paintEases[index],trackHalves[index]);
    }
    if (preserve) {
      // Reconstructed recipes must agree at every existing pose. Keep the original
      // keys byte-for-byte; subsequent refresh differs only by floating-point rounding.
      for (const generated of interior(draft, start, end)) {
        const original = layer.keys.find(k => k.frame === generated.frame)!;
        for (let i = 0; i < generated.shapes.length; i++) {
          const a = generated.shapes[i], b = original.shapes[i];
          const compare = (x: number, y: number) => {
            if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x-y) > 32*Number.EPSILON*Math.max(1,Math.abs(x),Math.abs(y)))
              throw new Error('Preserved split could not resolve the original trajectory numerically.');
          };
          const compareBasis = (first: typeof a.transform, last: typeof b.transform) => {
            const x=first??[1,0,0,1],y=last??[1,0,0,1];
            x.forEach((value,index)=>compare(value,y[index]));
          };
          if(a.kind==='symbol' && JSON.stringify(a.symbolPlayback)!==JSON.stringify(b.symbolPlayback))
            throw new Error('Preserved split changed symbol playback phase or mode.');
          if(span.fillColorKeys && a.fill.toLowerCase()!==b.fill.toLowerCase()) throw Error('Preserved split would change a rounded fill color.');
          if(span.options?.strokeColor && a.stroke.toLowerCase() !== b.stroke.toLowerCase())
            throw Error('Preserved split cannot reproduce rounded stroke colors.');
          if(span.options?.paint){
            const color=(x:string,y:string)=>{if(x.toLowerCase()!==y.toLowerCase()) throw new Error('Preserved split cannot reproduce rounded paint colors.');};
            color(a.fill,b.fill);color(a.stroke,b.stroke);
            if(Boolean(a.gradient)!==Boolean(b.gradient)||a.gradient?.stops.length!==b.gradient?.stops.length) throw new Error('Preserved split changed gradient paint structure.');
            a.gradient?.stops.forEach((stop,index)=>{const original=b.gradient!.stops[index];color(stop.color,original.color);compare(stop.opacity??1,original.opacity??1);});
          }
          if(span.options?.affine || span.rotation?.uniformGroupScale || span.rotation?.axisGroupScale) compareBasis(a.transform,b.transform);
          if(span.options?.pivots){
            if(Boolean(a.pivot)!==Boolean(b.pivot))throw new Error('Preserved split changed pivot presence.');
            if(a.pivot&&b.pivot){compare(a.pivot.x,b.pivot.x);compare(a.pivot.y,b.pivot.y);}
          }
          if(span.options?.gradientBasis) compareBasis(a.gradient?.transform,b.gradient?.transform);
          if (span.options?.gradientGeometry || span.options?.gradientStops) {
            if(Boolean(a.gradient)!==Boolean(b.gradient)) throw new Error('Preserved split changed gradient structure.');
            if(a.gradient&&b.gradient){
              for(const point of ['from','to'] as const){compare(a.gradient[point].x,b.gradient[point].x);compare(a.gradient[point].y,b.gradient[point].y);}
              if(a.gradient.stops.length!==b.gradient.stops.length) throw new Error('Preserved split changed gradient stops.');
              a.gradient.stops.forEach((stop,index)=>compare(stop.offset,b.gradient!.stops[index].offset));
            }
          }
          if (span.options?.nodes) {
            const rings = (shape: typeof a) => shape.kind === 'bezier' ? [shape.nodes ?? []] : shape.kind === 'polygon' ? shape.contours ?? [] : [];
            const first=rings(a),last=rings(b);
            if(first.length!==last.length) throw new Error('Preserved split changed contour structure.');
            first.forEach((ring,r)=>{
              if(ring.length!==last[r].length) throw new Error('Preserved split changed node structure.');
              ring.forEach((node,n)=>{
                const original=last[r][n];
                for(const part of [undefined,'in','out'] as const){
                  const x=part?node[part]:node,y=part?original[part]:original;
                  if(Boolean(x)!==Boolean(y)) throw new Error('Preserved split changed handle structure.');
                  if(x&&y){compare(x.x,y.x);compare(x.y,y.y);}
                }
              });
            });
          }
          for (const field of ['x', 'y', 'rotation', 'opacity', 'width', 'height', 'cornerRadius', 'strokeWidth'] as const) {
            const fallback = field === 'opacity' ? 1 : 0;
            const x = a[field] ?? fallback, y = b[field] ?? fallback;
            compare(x, y);
          }
        }
      }
      draft.keys = layer.keys;
    }
    const left = { ...clone(span), ease: clone(eases[0]), ...(opacityEases[0]!==undefined?{opacityEase:clone(opacityEases[0])}:{}), ...(paintEases[0]!==undefined?{paintEase:clone(paintEases[0])}:{}), ...(options[0] ? { options: clone(options[0]) } : {}), ...(rotations[0] ? { rotation: clone(rotations[0]) } : {}), ...(paths[0] ? { path: clone(paths[0]) } : {}), end: at, baseline: JSON.stringify(interior(draft, start, at)) };
    const right = { ...clone(span), ease: clone(eases[1]), ...(opacityEases[1]!==undefined?{opacityEase:clone(opacityEases[1])}:{}), ...(paintEases[1]!==undefined?{paintEase:clone(paintEases[1])}:{}), ...(options[1] ? { options: clone(options[1]) } : {}), ...(rotations[1] ? { rotation: clone(rotations[1]) } : {}), ...(paths[1] ? { path: clone(paths[1]) } : {}), id: id(), start: at, baseline: JSON.stringify(interior(draft, at, end)) };
    Object.assign(left,trackHalves[0]); Object.assign(right,trackHalves[1]);
    if(correspondences[0]) left.correspondence=clone(correspondences[0]);else delete left.correspondence;
    if(correspondences[1]) right.correspondence=clone(correspondences[1]);else delete right.correspondence;
    const halves = [left, right].filter((half) => half.end - half.start >= 2);
    if (halves.length) halves[0].id = span.id;
    return { layer, keys: draft.keys, spans: layer.motionSpans!.flatMap((s) => s === span ? halves : [s]) };
  });
  for (const item of prepared) {
    item.layer.keys = item.keys;
    if (item.spans.length) item.layer.motionSpans = item.spans;
    else delete item.layer.motionSpans;
  }
}

/** Refresh from authored endpoints, then promote the evaluated interior pose.
 * Both operations run on local track wrappers. A failed preserved split never
 * publishes its prerequisite refresh or changes any authored/outside key.
 */
export function promoteSampledMotionFrame(project: Timeline, ids: string[], start: number, end: number, at: number) {
  if (![start,end,at].every(Number.isSafeInteger) || start < 0 || end >= project.duration || at-start < 2 || end-at < 2)
    throw new Error('Promotion requires at least three frames in each half.');
  const selected=[...new Set(ids)];
  if (!selected.length) throw new Error('Choose motion tracks.');
  const tracks=selected.map(id=>{
    const matches=project.layers.filter(layer=>layer.id===id);
    if(matches.length!==1 || !matches[0].visible || matches[0].locked) throw new Error('Choose visible, unlocked motion tracks.');
    const layer=matches[0], keys=interior(layer,start,end);
    if(layer.motionSpans?.filter(span=>span.start===start&&span.end===end).length!==1)
      throw new Error('Choose one remembered span matching this range.');
    if(keys.length!==end-start-1 || keys.some((key,i)=>key.frame!==start+i+1))
      throw new Error('Generated keys changed; cannot promote this pose.');
    return {layer,draft:{...layer}};
  });
  const timeline={...project,layers:tracks.map(track=>track.draft)};
  refreshBasicMotionSpan(timeline,selected,start,end);
  splitBasicMotionSpan(timeline,selected,start,end,at,true);
  const prepared=tracks.map(({layer,draft})=>{
    const generated=new Map(interior(draft,start,end).map(key=>[key.frame,key]));
    return {layer,keys:layer.keys.map(key=>generated.get(key.frame)??key),spans:draft.motionSpans!};
  });
  for(const {layer,keys,spans} of prepared){layer.keys=keys;layer.motionSpans=spans;}
}

/** Remove recipe ownership without changing any artwork or keys. */
export function detachBasicMotionSpan(
  project: Timeline,
  ids: string[],
  start: number,
  end: number,
) {
  const selected = [...new Set(ids)];
  if (!selected.length) throw new Error('Choose motion tracks.');
  const prepared = selected.map((key) => {
    const layer = project.layers.find((candidate) => candidate.id === key);
    if (!layer || !layer.visible || layer.locked)
      throw new Error('Choose visible, unlocked motion tracks.');
    if (!layer.motionSpans?.some((s) => s.start === start && s.end === end))
      throw new Error('No remembered motion span matches this range.');
    return { layer, spans: layer.motionSpans.filter((s) => s.start !== start || s.end !== end) };
  });
  for (const { layer, spans } of prepared) {
    if (spans.length) layer.motionSpans = spans;
    else delete layer.motionSpans;
  }
}

/** Change only saved refresh policy, preparing every selected track before writes. */
export function setBasicMotionSpanAutoRefresh(
  project: Timeline,
  ids: string[],
  start: number,
  end: number,
  enabled: boolean,
): void {
  if (typeof enabled !== 'boolean') throw new Error('Choose a boolean endpoint refresh setting.');
  const selected = [...new Set(ids)];
  if (!selected.length) throw new Error('Choose motion tracks.');
  const prepared = selected.map((id) => {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || !layer.visible || layer.locked)
      throw new Error('Choose visible, unlocked motion tracks.');
    const span = layer.motionSpans?.find((s) => s.start === start && s.end === end);
    if (!span) throw new Error('No remembered motion span matches this range.');
    return {
      layer,
      spans: layer.motionSpans!.map((s) => (s === span ? { ...s, autoRefresh: enabled } : s)),
    };
  });
  for (const { layer, spans } of prepared) layer.motionSpans = spans;
}

/** Optional per-span inclusive frame counts, in chronological recipe order. */
export function parseMotionSpanLengths(text: string): number[] | undefined {
  if (!text.trim()) return undefined;
  const values = text.split(',').map((v) => {
    if (!/^\s*\d+\s*$/.test(v))
      throw new Error('Span frame counts must be comma-separated integers of at least three.');
    return Number(v);
  });
  motionSpanFrameCount(0, values);
  return values;
}
export function motionSpanFrameCount(length: number, spans?: readonly number[]): number {
  if (spans === undefined) return length;
  if (
    !Array.isArray(spans) ||
    !spans.length ||
    Array.from(spans).some((n) => !Number.isSafeInteger(n) || n < 3)
  )
    throw new Error('Each span frame count must be an integer of at least three.');
  const total = spans.reduce((sum, n) => sum + n - 1, 1);
  if (!Number.isSafeInteger(total)) throw new Error('Span frame counts exceed numeric limits.');
  return total;
}

/** Resize a complete connected recipe chain, retaining each recipe and authored endpoint. */
export function retimeBasicMotionSpan(
  project: Timeline,
  ids: string[],
  start: number,
  end: number,
  length: number,
  ripple = false,
  spanLengths?: readonly number[],
) {
  length = motionSpanFrameCount(length, spanLengths);
  const nextEnd = start + length - 1;
  if (
    ![start, end, length, nextEnd].every(Number.isSafeInteger) ||
    start < 0 ||
    end <= start ||
    end >= project.duration ||
    length < 3 ||
    nextEnd >= project.duration
  )
    throw new Error('Remembered motion needs at least three frames within the existing timeline.');
  const selected = [...new Set(ids)];
  if (!selected.length) throw new Error('Choose motion tracks.');
  const prepared = selected.map((id) => {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || !layer.visible || layer.locked)
      throw new Error('Choose visible, unlocked motion tracks.');
    const chain = (layer.motionSpans ?? [])
      .filter((s) => s.start >= start && s.end <= end)
      .sort((a, b) => a.start - b.start);
    if (
      !chain.length ||
      chain[0].start !== start ||
      chain.at(-1)!.end !== end ||
      chain.some((s, i) => i > 0 && chain[i - 1].end !== s.start)
    )
      throw new Error('Select a complete connected chain of remembered spans.');
    const members = new Set(chain);
    if (spanLengths && spanLengths.length !== chain.length)
      throw new Error('Provide one frame count for every selected remembered span.');
    const boundaries = new Map<number, number>([[start, start]]);
    let next = start;
    for (let i = 0; i < chain.length; i++) {
      next = spanLengths
        ? next + spanLengths[i] - 1
        : start + Math.round(((chain[i].end - start) * (length - 1)) / (end - start));
      boundaries.set(chain[i].end, next);
    }
    const mapped = (frame: number) => boundaries.get(frame)!;
    const retimedTracks=(span:BasicMotionSpan)=>{
      const result=mapPropertyTracks(span,n=>Math.round(n*(mapped(span.end)-mapped(span.start))/(span.end-span.start)));
      for (const field of allIntervalTimingFields) if(span[field]) result[field]=clone(span[field]);
      return result;
    };
    for (const span of chain) {
      if (JSON.stringify(interior(layer, span.start, span.end)) !== span.baseline)
        throw new Error('Generated keys changed; detach the span to preserve those edits.');
      if (mapped(span.end) - mapped(span.start) < 2)
        throw new Error('Retiming must leave at least three frames in every remembered span.');
    }
    if (
      !ripple &&
      layer.motionSpans!.some(
        (s) => !members.has(s) && (s.start === end || (s.start < nextEnd && s.end > start)),
      )
    )
      throw new Error('Retiming would affect another remembered span.');
    if (!ripple && layer.keys.some((k) => k.frame > end && k.frame <= nextEnd))
      throw new Error('Retiming would overwrite outside keys.');
    const delta = nextEnd - end;
    if (ripple) {
      if (layer.keys.some((k) => k.frame > end && k.frame + delta >= project.duration))
        throw new Error('Following keys would exceed the existing timeline duration.');
      for (const following of layer.motionSpans!.filter((s) => !members.has(s) && s.start >= end)) {
        if (following.end + delta >= project.duration)
          throw new Error('Following spans would exceed the existing timeline duration.');
        if (JSON.stringify(interior(layer, following.start, following.end)) !== following.baseline)
          throw new Error(
            'Following generated keys changed; detach that span before ripple retiming.',
          );
      }
    }
    const endpoints = new Set([start, ...chain.map((s) => s.end)]);
    for (const frame of endpoints)
      if (!layer.keys.some((k) => k.frame === frame))
        throw new Error('Motion endpoint key is missing.');
    // Keep original artwork values until each generator has validated its endpoints.
    const draft = {
      ...layer,
      keys: layer.keys
        .filter((k) => k.frame < start || k.frame > end || endpoints.has(k.frame))
        .map((k) =>
          endpoints.has(k.frame)
            ? { ...k, frame: mapped(k.frame) }
            : ripple && k.frame > end
              ? { ...k, frame: k.frame + delta }
              : k,
        )
        .sort((a, b) => a.frame - b.frame),
    };
    for (const span of chain)
      generateRemembered(
        { ...project, layers: [draft] },
        [id],
        mapped(span.start),
        mapped(span.end),
        span.ease,
        span.options,
        span.path,
        span.rotation,
        span.correspondence,
        span.opacityEase,
        span.paintEase,
        retimedTracks(span),
      );
    return {
      layer,
      keys: draft.keys,
      spans: layer.motionSpans!.map((s) => {
        if (members.has(s))
          return {
            ...s,
            ...retimedTracks(s),
            start: mapped(s.start),
            end: mapped(s.end),
            baseline: JSON.stringify(interior(draft, mapped(s.start), mapped(s.end))),
          };
        if (ripple && s.start >= end)
          return {
            ...s,
            start: s.start + delta,
            end: s.end + delta,
            baseline: JSON.stringify(interior(draft, s.start + delta, s.end + delta)),
          };
        return s;
      }),
    };
  });
  for (const item of prepared) {
    item.layer.keys = item.keys;
    item.layer.motionSpans = item.spans;
  }
}

/** Translate a complete connected recipe chain and its existing keys into blank time, without changing duration. */
export function moveBasicMotionSpan(
  project: Timeline,
  ids: string[],
  start: number,
  end: number,
  at: number,
  targetId?: string,
  exchange = false,
) {
  if (exchange) {
    exchangeBasicMotionSpan(project, ids, start, end, at, targetId);
    return;
  }
  const nextEnd = at + end - start;
  if (
    ![start, end, at, nextEnd].every(Number.isSafeInteger) ||
    start < 0 ||
    end - start < 2 ||
    at < 0 ||
    end >= project.duration ||
    nextEnd >= project.duration
  )
    throw new Error('Move the complete remembered span within the existing timeline.');
  const selected = [...new Set(ids)];
  if (!selected.length) throw new Error('Choose motion tracks.');
  if (targetId && selected.length !== 1)
    throw new Error('Choose one source track for a cross-track move.');
  const prepared = selected.map((id) => {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer || !layer.visible || layer.locked)
      throw new Error('Choose visible, unlocked motion tracks.');
    const target =
      targetId && targetId !== id ? project.layers.find((l) => l.id === targetId) : undefined;
    if (targetId && targetId !== id && (!target || !target.visible || target.locked))
      throw new Error('Choose a visible, unlocked destination track.');
    if (target && (target.drawingMode ?? 'object') !== (layer.drawingMode ?? 'object'))
      throw new Error('Source and destination must use the same drawing mode.');
    const chain = (layer.motionSpans ?? [])
      .filter((s) => s.start >= start && s.end <= end)
      .sort((a, b) => a.start - b.start);
    if (
      !chain.length ||
      chain[0].start !== start ||
      chain.at(-1)!.end !== end ||
      chain.some((s, i) => i > 0 && chain[i - 1].end !== s.start)
    )
      throw new Error('Select a complete connected chain of remembered spans.');
    for (const span of chain)
      if (JSON.stringify(interior(layer, span.start, span.end)) !== span.baseline)
        throw new Error('Generated keys changed; detach the span to preserve those edits.');
    const members = new Set(chain);
    if (at === start && !target) return { layer, keys: layer.keys, spans: layer.motionSpans! };
    if (
      layer.motionSpans!.some(
        (s) =>
          !members.has(s) &&
          ((s.start <= end && s.end >= start) || (!target && s.start <= nextEnd && s.end >= at)),
      )
    )
      throw new Error('Moving would affect another remembered span or shared endpoint.');
    if (target) {
      if (
        target.motionSpans?.some(
          (s) => (s.start <= nextEnd && s.end >= at) || chain.some((c) => c.id === s.id),
        )
      )
        throw new Error('Destination contains a conflicting remembered span.');
      const boundaries = [
        at,
        ...target.keys.filter((k) => k.frame > at && k.frame <= nextEnd).map((k) => k.frame),
      ];
      if (boundaries.some((f) => keyAt(target, f).shapes.length))
        throw new Error('Destination contains artwork. Choose blank frames.');
      const artworkIds = new Set<string>(),
        groupIds = new Set<string>();
      for (const key of layer.keys.filter((k) => k.frame >= start && k.frame <= end))
        for (const shape of key.shapes) {
          artworkIds.add(shape.id);
          for (const group of shape.groups ?? []) groupIds.add(group);
        }
      if (
        target.keys.some((k) =>
          k.shapes.some(
            (shape) => artworkIds.has(shape.id) || shape.groups?.some((g) => groupIds.has(g)),
          ),
        )
      )
        throw new Error('Destination already uses moved artwork or group identities.');
    }
    // Validate every original endpoint/settings pair before cloning any moved artwork.
    for (const span of chain) {
      const check = {
        ...layer,
        keys: layer.keys.filter((k) => k.frame <= span.start || k.frame >= span.end),
      };
      generateRemembered(
        { ...project, layers: [check] },
        [id],
        span.start,
        span.end,
        span.ease,
        span.options,
        span.path,
        span.rotation,
        span.correspondence,
        span.opacityEase,
        span.paintEase,
        span,
      );
    }
    if (target) {
      const clip = copyFrames(layer, start, end),
        source = { ...layer },
        delta = at - start;
      clearFrames(source, start, end, project.duration);
      const after = nextEnd + 1 < project.duration ? clone(keyAt(target, nextEnd + 1).shapes) : [];
      const keys = [
        ...target.keys.filter((k) => k.frame < at || k.frame > nextEnd),
        ...clip.keys.map((k) => ({ ...k, frame: k.frame + at })),
      ];
      if (nextEnd + 1 < project.duration && !keys.some((k) => k.frame === nextEnd + 1))
        keys.push({ frame: nextEnd + 1, shapes: after });
      keys.sort((a, b) => a.frame - b.frame);
      const spans = [
        ...(target.motionSpans ?? []),
        ...chain.map((s) => ({
          ...clone(s),
          start: s.start + delta,
          end: s.end + delta,
          baseline: JSON.stringify(interior({ ...target, keys }, s.start + delta, s.end + delta)),
        })),
      ].sort((a, b) => a.start - b.start);
      return {
        layer,
        keys: source.keys,
        spans: layer.motionSpans!.filter((s) => !members.has(s)),
        destination: { layer: target, keys, spans },
      };
    }
    const draft = { ...layer };
    moveFrames({ layers: [draft], duration: project.duration }, id, start, end, at);
    const delta = at - start;
    return {
      layer,
      keys: draft.keys,
      spans: layer
        .motionSpans!.map((s) =>
          members.has(s)
            ? {
                ...s,
                start: s.start + delta,
                end: s.end + delta,
                baseline: JSON.stringify(interior(draft, s.start + delta, s.end + delta)),
              }
            : s,
        )
        .sort((a, b) => a.start - b.start),
    };
  });
  for (const item of prepared) {
    item.layer.keys = item.keys;
    if (item.spans.length) item.layer.motionSpans = item.spans;
    else delete item.layer.motionSpans;
    if (item.destination) {
      item.destination.layer.keys = item.destination.keys;
      item.destination.layer.motionSpans = item.destination.spans;
    }
  }
}

/** Exchange equal-length complete chains using detached, fully validated move transactions. */
function exchangeBasicMotionSpan(project: Timeline, ids: string[], start: number, end: number, at: number, targetId?: string) {
  const selected = [...new Set(ids)];
  if (selected.length > 1 && !targetId) {
    const layers = project.layers.map(layer => ({ ...layer }));
    const draft = { ...project, layers };
    for (const id of selected) exchangeBasicMotionSpan(draft, [id], start, end, at);
    // Commit only after every selected track has prepared both chains successfully.
    for (const layer of project.layers) if (selected.includes(layer.id)) {
      const prepared = layers.find(candidate => candidate.id === layer.id)!;
      layer.keys = prepared.keys;
      layer.motionSpans = prepared.motionSpans;
    }
    return;
  }
  if (selected.length !== 1)
    throw new Error('Choose one source track for a cross-track exchange.');
  targetId ||= selected[0];
  const source = project.layers.find(l => l.id === selected[0]);
  const target = project.layers.find(l => l.id === targetId);
  if (!source || !target) throw new Error('Motion track is missing.');
  const targetEnd = at + end - start;
  if (source === target) {
    if (start <= targetEnd && at <= end)
      throw new Error('Exchange separate ranges without overlapping or shared endpoints.');
    // Extract each chain into an empty detached track. Clearing both ranges first
    // preserves the original following holds, including adjacent range boundaries.
    const extract = (layer: typeof source, first: number, last: number, destination: number) => {
      const sink = { ...layer, id: `${layer.id}:exchange`, keys: [{ frame: 0, shapes: [] }], motionSpans: undefined };
      const layers = [{ ...layer }, sink];
      moveBasicMotionSpan({ ...project, layers }, [layer.id], first, last, destination, sink.id);
      return layers;
    };
    const [clearedSource, incomingTarget] = extract(source, start, end, at);
    const [clearedBoth, incomingSource] = extract(clearedSource, at, targetEnd, start);
    const outside = (frame: number) => (frame < start || frame > end) && (frame < at || frame > targetEnd);
    const keys = [
      ...clearedBoth.keys.filter(k => outside(k.frame)),
      ...incomingTarget.keys.filter(k => k.frame >= at && k.frame <= targetEnd),
      ...incomingSource.keys.filter(k => k.frame >= start && k.frame <= end),
    ].sort((a, b) => a.frame - b.frame);
    const spans = [
      ...(clearedBoth.motionSpans ?? []),
      ...(incomingTarget.motionSpans ?? []),
      ...(incomingSource.motionSpans ?? []),
    ].sort((a, b) => a.start - b.start);
    source.keys = keys;
    source.motionSpans = spans;
    return;
  }
  // Move-to-empty preflights validate original endpoint/settings values before cloning
  // artwork and produce cleared tracks with their following exposure restored.
  const clear = (from: typeof source, into: typeof source, first: number, last: number, destination: number) => {
    const layers = [{ ...from }, { ...into, keys: [{ frame: 0, shapes: [] }], motionSpans: undefined }];
    moveBasicMotionSpan({ ...project, layers }, [from.id], first, last, destination, into.id);
    return layers[0];
  };
  const clearedSource = clear(source, target, start, end, at);
  const clearedTarget = clear(target, source, at, targetEnd, start);
  // Both incoming chains must also be compatible with every remaining target
  // identity, recipe and exposure. No original layer is written until both pass.
  const forward = [{ ...source }, clearedTarget];
  moveBasicMotionSpan({ ...project, layers: forward }, [source.id], start, end, at, target.id);
  const reverse = [{ ...target }, clearedSource];
  moveBasicMotionSpan({ ...project, layers: reverse }, [target.id], at, targetEnd, start, source.id);
  source.keys = reverse[1].keys;
  source.motionSpans = reverse[1].motionSpans;
  target.keys = forward[1].keys;
  target.motionSpans = forward[1].motionSpans;
}

export type SymbolPropertyKey =
  | {property:typeof liveNumericChannels[number]['field']; frame:number; value:number|null}
  | {property:'fillColorKeys'|'strokeColorKeys'|number; frame:number; value:string|null};

export type SymbolPositionInterval = {property:typeof allIntervalTimingFields[number]; frame:number; value:Ease}
  | {property:'gradientStopEasing';stop:number;frame:number;value:Ease};

function editSymbolPropertyKey(timeline:Timeline,ids:string[],start:number,end:number,key:SymbolPropertyKey|SymbolPositionInterval) {
  const {property,frame,value}=key;
  if(key.property==='gradientStopEasing')return setRememberedIntervalTiming(timeline,ids,start,end,key.stop,frame,key.value);
  if(property==='fillKeyEases'||property==='strokeKeyEases')
    return setRememberedIntervalTiming(timeline,ids,start,end,property==='fillKeyEases'?'fill':'stroke',frame,value);
  if(property==='sxKeyEases'||property==='syKeyEases'||property==='shearKeyEases')
    return setRememberedIntervalTiming(timeline,ids,start,end,property==='sxKeyEases'?'sx':property==='syKeyEases'?'sy':'shear',frame,value);
  if(property==='opacityKeyEases'||property==='rotationKeyEases')
    return setRememberedIntervalTiming(timeline,ids,start,end,property==='opacityKeyEases'?'opacity':'rotation',frame,value);
  if(property==='xKeyEases' || property==='yKeyEases')
    return setRememberedPositionTiming(timeline,ids,start,end,property==='xKeyEases'?'x':'y',frame,value);
  if(property==='fillColorKeys'||property==='strokeColorKeys'||typeof property==='number'){
    if(value!==null && typeof value!=='string') throw Error('Choose an RGB color.');
    return setRememberedColorKey(timeline,ids,start,end,property==='fillColorKeys'?'fill':property==='strokeColorKeys'?'stroke':property,frame,value);
  }
  if(value!==null && typeof value!=='number') throw Error('Choose a numeric key value.');
  switch(property){
    case 'xKeys': case 'yKeys': return setRememberedPositionKey(timeline,ids,start,end,property==='xKeys'?'x':'y',frame,value);
    case 'scaleXKeys': case 'scaleYKeys': return setRememberedScaleKey(timeline,ids,start,end,property==='scaleXKeys'?'x':'y',frame,value);
    case 'shearKeys': case 'rotationKeys': return setRememberedRotationOrShearKey(timeline,ids,start,end,property==='shearKeys'?'shear':'rotation',frame,value);
    case 'opacityKeys': return setRememberedOpacityKey(timeline,ids,start,end,frame,value);
    default: throw Error('Unknown remembered property.');
  }
}
/** Detached symbol transaction, including base artwork and the aggregate project budget. */
export function editSymbolBasicMotionSpan(
  definition: SymbolDefinition,
  ids: string[],
  start: number,
  end: number,
  action: SymbolPropertyKey | SymbolPositionInterval | 'paint' | 'clearPaint' | 'opacity' | 'clearOpacity' | 'create' | 'promote' | 'spin' | 'refresh' | 'ease' | 'path' | 'clearPath' | 'detach' | 'retime' | 'live' | 'move' | 'exchange' | 'split' | 'reverse',
  ease: Ease = 'linear',
  symbols: SymbolDefinition[] = [definition],
  length?: number,
  ripple = false,
  options?: MotionSpanOptions,
  path?: MotionPath,
  rotation?: MotionRotation,
  autoRefresh = false,
  correspondence?: MotionContourCorrespondence,
  destination?: number,
  destinationLayerId?: string,
  spanLengths?: readonly number[],
  splitAt?: number,
  preserveSplit = false,
  opacityEase?: Ease,
  paintEase?: Ease,
): SymbolDefinition {
  const propertyEdit=typeof action==='object';
  const channel=propertyEdit?'property':action==='paint'||action==='clearPaint'?'paint':'opacity';
  const opacityAction=propertyEdit||action==='opacity'||action==='clearOpacity'||action==='paint'||action==='clearPaint';
  const prior=opacityAction?rememberedChannelEditors.get(definition):undefined;if(prior){prior.invalid=true;throw Error(`Symbol ${channel} editing cannot reenter its original source.`);}
  const opacityOwner=opacityAction?{invalid:false}:undefined;
  if(opacityOwner)rememberedChannelEditors.set(definition,opacityOwner);
  try{
  const originalOpacity=opacityAction?selectionTrajectoryStamp([definition,symbols]):'',originalShapes=definition.shapes,originalTimeline=definition.timeline,symbolReferences=opacityAction?[...symbols]:[];
  const fields=propertyEdit && action && Object.getOwnPropertyDescriptor(action,'property')?.value==='gradientStopEasing'
    ? ['property','frame','value','stop'] : ['property','frame','value'];
  if(propertyEdit && (!action || Reflect.ownKeys(action).length!==fields.length || !fields.every(key=>{
    const field=Object.getOwnPropertyDescriptor(action,key);
    return field?.enumerable && Object.hasOwn(field,'value');
  }))) throw Error('Symbol property keys require original property, frame and value fields.');
  const inputStamp=propertyEdit?selectionTrajectoryStamp(action):undefined;
  if (action === 'path' && path === undefined) throw new Error('Enable a motion path before applying it.');
  if (action === 'retime') length = motionSpanFrameCount(length!, spanLengths);
  const selected: string[] = [];
  if(opacityAction){
    if(!Array.isArray(ids)||!ids.length)throw Error(`Choose distinct original ${channel} tracks.`);
    const count=ids.length,seen=new Set<string>();
    for(let i=0;i<count;i++){const id=ids[i];if(typeof id!=='string'||!id||seen.has(id))throw Error(`Choose distinct original ${channel} tracks.`);seen.add(id);selected.push(id);}
    if(ids.length!==count)throw Error(`${channel==='paint'?'Paint':'Opacity'} track requests changed while being read.`);
  }else selected.push(...new Set(ids));
  const layers = symbolLayers(definition).map((layer) => ({ ...layer }));
  if (action !== 'reverse' && action !== 'detach' && action !== 'live' && action !== 'move' && action !== 'exchange') {
    let count = [...symbols.filter((s) => s.id !== definition.id), definition].reduce(
      (sum, s) => sum + symbolArtworks(s).reduce((n, shapes) => n + shapes.length, 0),
      0,
    );
    for (const id of selected) {
      const layer = layers.find((l) => l.id === id);
      if (!layer) throw new Error('Motion track is missing.');
      count +=
        (action === 'retime' ? (length ?? 0) - 2 : end - start - 1) *
        (layer.keys.find((k) => k.frame === start)?.shapes.length ?? 0);
      if (propertyEdit || action === 'promote' || action === 'spin' || action === 'path' || action === 'clearPath' || action === 'ease' || action === 'refresh' || action === 'retime' || action === 'split' || action === 'opacity' || action === 'clearOpacity' || action === 'paint' || action === 'clearPaint')
        count -= interior(layer, start, end).reduce((n, k) => n + k.shapes.length, 0);
    }
    if (count > MAX_SYMBOL_ARTWORK)
      throw new Error('Motion would exceed the existing project symbol artwork budget.');
  }
  const timeline = {
    layers,
    duration: definition.timeline?.duration ?? 1,
    symbols: [...symbols.filter((s) => s.id !== definition.id), definition],
  };
  if (action === 'create')
    createBasicMotionSpan(
      timeline,
      selected,
      start,
      end,
      ease,
      options,
      path,
      rotation,
      correspondence,
      opacityEase,
      paintEase,
    );
  else if(propertyEdit)editSymbolPropertyKey(timeline,selected,start,end,action);
  else if(action==='paint'||action==='clearPaint')setRememberedMotionPaintEase(timeline,selected,start,end,action==='clearPaint'?null:paintEase as Ease);
  else if(action==='opacity'||action==='clearOpacity')setRememberedMotionOpacityEase(timeline,selected,start,end,action==='clearOpacity'?null:opacityEase as Ease);
  else if (action === 'reverse') reverseBasicMotionSpan(timeline, selected, start, end);
  else if (action === 'promote') promoteSampledMotionFrame(timeline, selected, start, end, splitAt!);
  else if (action === 'split') splitBasicMotionSpan(timeline, selected, start, end, splitAt!, preserveSplit);
  else if (action === 'spin') {
    if (!rotation) throw new Error('Choose a rotation direction and extra turn count.');
    setRememberedMotionSpin(timeline,selected,start,end,rotation);
  }
  else if (action === 'path' || action === 'clearPath') refreshBasicMotionSpan(timeline, selected, start, end, undefined, action === 'clearPath' ? null : path);
  else if (action === 'refresh' || action === 'ease') refreshBasicMotionSpan(timeline, selected, start, end, action === 'ease' ? ease : undefined);
  else if (action === 'retime')
    retimeBasicMotionSpan(timeline, selected, start, end, length!, ripple, spanLengths);
  else if (action === 'move' || action === 'exchange') {
    moveBasicMotionSpan(timeline, selected, start, end, destination!, destinationLayerId, action === 'exchange');
    assertSymbolHasArtwork(layers);
    const count =
      symbols
        .filter((s) => s.id !== definition.id)
        .reduce((n, s) => n + symbolArtworks(s).reduce((m, shapes) => m + shapes.length, 0), 0) +
      layers.reduce((n, l) => n + l.keys.reduce((m, k) => m + k.shapes.length, 0), 0);
    if (count > MAX_SYMBOL_ARTWORK)
      throw new Error('Motion would exceed the existing project symbol artwork budget.');
  } else if (action === 'live')
    setBasicMotionSpanAutoRefresh(timeline, selected, start, end, autoRefresh);
  else detachBasicMotionSpan(timeline, selected, start, end);
  if(action==='reverse' && symbols.filter(s=>s.id!==definition.id).reduce((n,s)=>n+symbolArtworks(s).reduce((m,a)=>m+a.length,0),0)+layers.reduce((n,l)=>n+l.keys.reduce((m,k)=>m+k.shapes.length,0),0)>MAX_SYMBOL_ARTWORK)throw new Error('Motion would exceed the existing project symbol artwork budget.');
  const expectedOpacity=opacityAction?{...definition,shapes:layers[0].keys[0].shapes,timeline:{...definition.timeline!,keys:layers[0].keys.slice(1),layers:layers.slice(1)}}:undefined;
  if(expectedOpacity){if(layers[0].motionSpans)expectedOpacity.timeline.motionSpans=layers[0].motionSpans;else delete expectedOpacity.timeline.motionSpans;}
  const outputOpacityStamp=opacityAction?selectionTrajectoryStamp(expectedOpacity):'';
  const result = clone(definition),
    detached = clone(layers);
  result.shapes = detached[0].keys[0].shapes;
  result.timeline = {
    ...result.timeline!,
    keys: detached[0].keys.slice(1),
    layers: detached.slice(1),
  };
  if (detached[0].motionSpans) result.timeline.motionSpans = detached[0].motionSpans;
  else delete result.timeline.motionSpans;
  if(opacityAction&&selectionTrajectoryStamp(result)!==outputOpacityStamp)throw Error(`Prepared symbol ${channel} output changed during cloning.`);
  if(propertyEdit && selectionTrajectoryStamp(action)!==inputStamp)throw Error('Symbol property key inputs changed.');
  if(opacityOwner&&(opacityOwner.invalid||definition.shapes!==originalShapes||definition.timeline!==originalTimeline||symbols.length!==symbolReferences.length||symbols.some((s,i)=>s!==symbolReferences[i])||selectionTrajectoryStamp([definition,symbols])!==originalOpacity))throw Error(`The original symbol ${channel} source changed.`);
  return result;
  }finally{if(opacityOwner)rememberedChannelEditors.delete(definition);}
}

/** Detect endpoint edits only for recipes retained unchanged by the authoring operation. */
function changedSpanEndpoints(
  before: Timeline['layers'],
  after: Timeline['layers'],
  onlySaved = false,
) {
  const affected: { layer: string; start: number; end: number }[] = [];
  for (const layer of after) {
    if (
      !layer.motionSpans?.length ||
      (onlySaved && !layer.motionSpans.some((s) => s.autoRefresh === true))
    )
      continue;
    const old = before.find((candidate) => candidate.id === layer.id);
    if (!old) continue;
    for (const span of layer.motionSpans ?? []) {
      if (onlySaved && span.autoRefresh !== true) continue;
      const previous = old.motionSpans?.find((candidate) => candidate.id === span.id);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(span)) continue;
      const endpoints = (track: typeof layer) =>
        [span.start, span.end].map((frame) => track.keys.find((key) => key.frame === frame));
      if (JSON.stringify(endpoints(old)) !== JSON.stringify(endpoints(layer)))
        affected.push({ layer: layer.id, start: span.start, end: span.end });
    }
  }
  return affected;
}

/** Prepare every affected span before writes. Failure leaves the user's endpoint edit intact. */
export function refreshChangedBasicMotionSpans(
  before: Timeline,
  after: Timeline,
  onlySaved = false,
  snapshotLayer?: (layer: Timeline['layers'][number]) => Timeline['layers'][number],
): void {
  const affected = changedSpanEndpoints(before.layers, after.layers, onlySaved);
  if (!affected.length) return;
  const editedLayers = new Set(affected.map(span => span.layer));
  const draft = { ...after, layers: after.layers.map(layer =>
    snapshotLayer && editedLayers.has(layer.id) ? snapshotLayer(layer) : { ...layer }) };
  for (const span of affected) refreshBasicMotionSpan(draft, [span.layer], span.start, span.end);
  for (const layer of after.layers) {
    const prepared = draft.layers.find((candidate) => candidate.id === layer.id)!;
    layer.keys = prepared.keys;
    if (prepared.motionSpans) layer.motionSpans = prepared.motionSpans;
  }
}

/** Symbol counterpart retains detached updates and aggregate capacity checks. */
export function refreshChangedSymbolMotionSpans(
  before: SymbolDefinition,
  after: SymbolDefinition,
  symbols: SymbolDefinition[],
  onlySaved = false,
): SymbolDefinition {
  const affected = changedSpanEndpoints(symbolLayers(before), symbolLayers(after), onlySaved);
  if (!affected.length) return after;
  const layers = symbolLayers(after).map((layer) => ({ ...layer }));
  let count = [...symbols.filter((s) => s.id !== after.id), after].reduce(
    (sum, s) => sum + symbolArtworks(s).reduce((n, shapes) => n + shapes.length, 0),
    0,
  );
  for (const span of affected) {
    const layer = layers.find((l) => l.id === span.layer)!;
    count +=
      (span.end - span.start - 1) *
        (layer.keys.find((k) => k.frame === span.start)?.shapes.length ?? 0) -
      interior(layer, span.start, span.end).reduce((n, k) => n + k.shapes.length, 0);
  }
  if (count > MAX_SYMBOL_ARTWORK)
    throw new Error('Motion would exceed the existing project symbol artwork budget.');
  const timeline = {
    layers,
    duration: after.timeline?.duration ?? 1,
    symbols: [...symbols.filter((s) => s.id !== after.id), after],
  };
  for (const span of affected) refreshBasicMotionSpan(timeline, [span.layer], span.start, span.end);
  const result = clone(after),
    detached = clone(layers);
  result.shapes = detached[0].keys[0].shapes;
  result.timeline = {
    ...result.timeline!,
    keys: detached[0].keys.slice(1),
    layers: detached.slice(1),
  };
  if (detached[0].motionSpans) result.timeline.motionSpans = detached[0].motionSpans;
  return result;
}

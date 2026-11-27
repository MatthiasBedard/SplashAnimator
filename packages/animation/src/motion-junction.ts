import {validateLiveGraphicData} from '../../document/src/live-motion';
import {captureAttachedFillEdit} from '../../geometry/src/attached-fill';
import {selectionTrajectoryStamp as curveStamp} from './selection-trajectory';
import {moveTangent} from '../../geometry/src/nodes';
import { MAX_SYMBOL_ARTWORK, symbolArtworks, symbolLayers, type SymbolDefinition, type Project, type Vector, type Point } from '../../document/src';
import { around, matrix, multiply, inversePoint, mapPoint, objectBounds, transformVectors } from '../../geometry/src';
import { refreshBasicMotionSpan } from './motion-spans';

type Timeline = Pick<Project, 'layers' | 'duration' | 'symbols'>;
type TrackSelection = { layerId: string; shapeIds: readonly string[] };

// Explicit shared-pivot transactions also reject swallowed same-source reentry.
// Legacy calls outside such a transaction retain their original execution path.
const sharedPivotOwners = new WeakMap<object,{invalid:boolean}>();
function rejectSharedRotationReentry(source:object){
  const owner=sharedPivotOwners.get(source);
  if(owner){owner.invalid=true;throw new Error('Shared-pivot rotation cannot reenter its original source.');}
}
function rotationSelection(selection:readonly TrackSelection[],layers:Timeline['layers'],frame:number):TrackSelection[]{
  if(!Array.isArray(selection))throw new Error('Choose original distinct rotation tracks.');
  const length=selection.length;
  if(!Number.isSafeInteger(length)||length<1||length>layers.length)
    throw new Error('Choose original distinct rotation tracks.');
  const result:TrackSelection[]=[];
  for(let i=0;i<length;i++){
    const request=selection[i],layerId=request?.layerId,ids=request?.shapeIds;
    const layer=layers.find(l=>l.id===layerId),maximum=layer?.keys.find(k=>k.frame===frame)?.shapes.length??0;
    if(typeof layerId!=='string'||!layerId||!Array.isArray(ids))
      throw new Error('Choose original endpoint artwork for rotation.');
    const count=ids.length,shapeIds:string[]=[];
    if(!Number.isSafeInteger(count)||count<1||count>maximum)throw new Error('Choose original endpoint artwork for rotation.');
    for(let j=0;j<count;j++){const id=ids[j];if(typeof id!=='string'||!id)throw new Error('Choose original artwork identities.');shapeIds.push(id);}
    if(ids.length!==count)throw new Error('Rotation artwork requests changed while being read.');
    result.push({layerId,shapeIds});
  }
  if(selection.length!==length)throw new Error('Rotation track requests changed while being read.');
  return result;
}
function rejectSharedScalingReentry(source:object){
  const owner=sharedPivotOwners.get(source);
  if(owner){owner.invalid=true;throw new Error('Shared-pivot scaling cannot reenter its original source.');}
}
function scalingSelection(selection:readonly TrackSelection[],layers:Timeline['layers'],frame:number):TrackSelection[]{
  if(!Array.isArray(selection))throw new Error('Choose original distinct scaling tracks.');
  const length=selection.length;
  if(!Number.isSafeInteger(length)||length<1||length>layers.length)
    throw new Error('Choose original distinct scaling tracks.');
  const result:TrackSelection[]=[];
  for(let i=0;i<length;i++){
    const request=selection[i],layerId=request?.layerId,ids=request?.shapeIds;
    const layer=layers.find(l=>l.id===layerId),maximum=layer?.keys.find(k=>k.frame===frame)?.shapes.length??0;
    if(typeof layerId!=='string'||!layerId||!Array.isArray(ids))
      throw new Error('Choose original endpoint artwork for scaling.');
    const count=ids.length,shapeIds:string[]=[];
    if(!Number.isSafeInteger(count)||count<1||count>maximum)throw new Error('Choose original endpoint artwork for scaling.');
    for(let j=0;j<count;j++){const id=ids[j];if(typeof id!=='string'||!id)throw new Error('Choose original artwork identities.');shapeIds.push(id);}
    if(ids.length!==count)throw new Error('Scaling artwork requests changed while being read.');
    result.push({layerId,shapeIds});
  }
  if(selection.length!==length)throw new Error('Scaling track requests changed while being read.');
  return result;
}
function rejectSharedShearingReentry(source:object){
  const owner=sharedPivotOwners.get(source);
  if(owner){owner.invalid=true;throw new Error('Shared-pivot shearing cannot reenter its original source.');}
}
function shearingSelection(selection:readonly TrackSelection[],layers:Timeline['layers'],frame:number):TrackSelection[]{
  if(!Array.isArray(selection))throw new Error('Choose original distinct shearing tracks.');
  const length=selection.length;
  if(!Number.isSafeInteger(length)||length<1||length>layers.length)
    throw new Error('Choose original distinct shearing tracks.');
  const result:TrackSelection[]=[];
  for(let i=0;i<length;i++){
    const request=selection[i],layerId=request?.layerId,ids=request?.shapeIds;
    const layer=layers.find(l=>l.id===layerId),maximum=layer?.keys.find(k=>k.frame===frame)?.shapes.length??0;
    if(typeof layerId!=='string'||!layerId||!Array.isArray(ids))
      throw new Error('Choose original endpoint artwork for shearing.');
    const count=ids.length,shapeIds:string[]=[];
    if(!Number.isSafeInteger(count)||count<1||count>maximum)throw new Error('Choose original endpoint artwork for shearing.');
    for(let j=0;j<count;j++){const id=ids[j];if(typeof id!=='string'||!id)throw new Error('Choose original artwork identities.');shapeIds.push(id);}
    if(ids.length!==count)throw new Error('Shearing artwork requests changed while being read.');
    result.push({layerId,shapeIds});
  }
  if(selection.length!==length)throw new Error('Shearing track requests changed while being read.');
  return result;
}
function sharedShearingValues(axis:'x'|'y',degrees:number,pivot:Point){
  if(!['x','y'].includes(axis)||!Number.isFinite(degrees)||degrees%180===0)
    throw new Error('Choose a skew axis and a finite angle that changes the endpoint.');
  const radians=degrees*Math.PI/180;
  if(!Number.isFinite(radians)||Math.abs(Math.cos(radians))<1e-8)
    throw new Error('Skew cannot reach 90 degrees.');
  const shear=Math.tan(radians);
  if(!Number.isFinite(shear)||shear===0)throw new Error('Skew exceeds finite numerics or cannot be represented.');
  const x=pivot?.x,y=pivot?.y;
  if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Choose a finite document shearing pivot.');
  return {pivot:{x,y},shear};
}
function sharedScalingValues(scaleX:number,scaleY:number,pivot:Point){
  if(![scaleX,scaleY].every(Number.isFinite)||!scaleX||!scaleY||(scaleX===1&&scaleY===1))
    throw new Error('Enter finite nonzero scales that change the endpoint.');
  const x=pivot?.x,y=pivot?.y;
  if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Choose a finite document scaling pivot.');
  return {x,y};
}
function sharedRotationValues(degrees:number,pivot:Point){
  if(!Number.isFinite(degrees)||!degrees||degrees%360===0||!Number.isFinite(degrees*Math.PI/180)||degrees*Math.PI/180===0)
    throw new Error('Enter a finite rotation that changes the endpoint.');
  const x=pivot?.x,y=pivot?.y;
  if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Choose a finite document rotation pivot.');
  return {x,y};
}

/** Move explicitly selected artwork at an authored junction; publish both regenerated
 * intervals on every requested track only after the last one has succeeded. */
export function translateRememberedEndpoint(project: Timeline, frame: number,
  selection: readonly TrackSelection[], dx: number, dy: number): void {
  if (!Number.isSafeInteger(frame) || frame <= 0 || frame >= project.duration ||
      !Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy))
    throw new Error('Choose a shared endpoint and a finite, nonzero translation.');
  editRememberedEndpoint(project,frame,selection,shape=>{
    const x=shape.x+dx,y=shape.y+dy;
    if(![shape.x,shape.y,x,y].every(Number.isFinite))throw new Error('Endpoint translation exceeds finite coordinates.');
    return {...shape,x,y};
  });
}

/** Rotate the complete selected union using the stage's common saved pivot, or
 * its authoring-box center. Preserve local pivots and affine bases as metadata. */
export function rotateRememberedEndpoint(project: Timeline, frame: number,
  selection: readonly TrackSelection[], degrees: number, worldPivot?:Point): void {
  rejectSharedRotationReentry(project);
  if(worldPivot!==undefined){rotateSharedRememberedEndpoint(project,frame,selection,degrees,worldPivot);return;}
  if(!Number.isFinite(degrees) || !degrees || degrees%360===0)
    throw new Error('Enter a finite rotation that changes the endpoint.');
  const radians=degrees*Math.PI/180;
  if(!Number.isFinite(radians))throw new Error('Enter a finite rotation.');
  editRememberedEndpoint(project,frame,selection,undefined,(members,layer)=>{
    if(layer.drawingMode==='merge')throw new Error('Rotating an endpoint requires object-mode artwork.');
    const pivot=endpointTransformPivot(members,layer);
    const copies=structuredClone(members),c=Math.cos(radians),n=Math.sin(radians);
    transformVectors(copies,around(pivot,c,n,-n,c));
    // A pure world rotation retains each local affine basis. Keeping the angle
    // explicit also retains the recipe's existing directed-rotation semantics.
    return members.map((shape,i)=>{
      const rotation=shape.rotation+degrees;
      if(!Number.isFinite(rotation))throw new Error('Endpoint rotation exceeds finite values.');
      return {...shape,x:copies[i].x,y:copies[i].y,rotation};
    });
  });
}

/** Explicit world pivots are snapshotted once and shared across every track.
 * Reuse the existing transform arithmetic and all-track preparation, retaining
 * authored/outside key and untouched-junction-member references on publication. */
function rotateSharedRememberedEndpoint(project:Timeline,frame:number,selection:readonly TrackSelection[],degrees:number,worldPivot:Point){
  const owner={invalid:false};sharedPivotOwners.set(project,owner);
  try{
    finiteEndpointNumbers(project);
    const layers=project.layers,symbols=project.symbols,duration=project.duration;
    const references=layers.map(layer=>({layer,keys:layer.keys,spans:layer.motionSpans}));
    const stamp=JSON.stringify(project);
    const check=()=>{
      if(owner.invalid||project.layers!==layers||project.symbols!==symbols||project.duration!==duration||
        references.some((r,i)=>layers[i]!==r.layer||r.layer.keys!==r.keys||r.layer.motionSpans!==r.spans))
        throw new Error('The original shared-pivot rotation source changed.');
    };
    const active=()=>{
      check();
      finiteEndpointNumbers(project);
      if(JSON.stringify(project)!==stamp||owner.invalid)throw new Error('The original shared-pivot rotation source changed.');
      check();
    };
    active();
    const pivot=sharedRotationValues(degrees,worldPivot),requests=rotationSelection(selection,layers,frame);
    active();
    // Recheck immediately before publication too: source callbacks may freeze
    // a later track while detached intervals are being prepared.
    const tracks=requests.map(request=>layers.find(l=>l.id===request.layerId)!);
    const writable=()=>{for(const layer of tracks){
      for(const name of ['keys','motionSpans']){const descriptor=Object.getOwnPropertyDescriptor(layer,name);
        if(!descriptor||!('value' in descriptor)||!descriptor.writable)throw new Error('Rotation tracks must permit atomic endpoint publication.');}}};
    writable();active();
    const radians=degrees*Math.PI/180,c=Math.cos(radians),n=Math.sin(radians);
    editRememberedEndpoint(project,frame,requests,undefined,(members,layer)=>{
      if(layer.drawingMode==='merge')throw new Error('Rotating an endpoint requires object-mode artwork.');
      const copies=structuredClone(members);transformVectors(copies,around(pivot,c,n,-n,c));
      return members.map((shape,i)=>{
        const rotation=shape.rotation+degrees;
        if(!Number.isFinite(rotation))throw new Error('Endpoint rotation exceeds finite values.');
        if(rotation===shape.rotation&&copies[i].x===shape.x&&copies[i].y===shape.y)
          throw new Error('Rotation cannot be represented on every selected member.');
        return {...shape,x:copies[i].x,y:copies[i].y,rotation};
      });
    },()=>{active();writable();});
  }finally{sharedPivotOwners.delete(project);}
}

function scaleSharedRememberedEndpoint(project:Timeline,frame:number,selection:readonly TrackSelection[],scaleX:number,scaleY:number,worldPivot:Point){
  const owner={invalid:false};sharedPivotOwners.set(project,owner);
  try{
    finiteEndpointNumbers(project);
    const layers=project.layers,symbols=project.symbols,duration=project.duration;
    const references=layers.map(layer=>({layer,keys:layer.keys,spans:layer.motionSpans}));
    const stamp=JSON.stringify(project);
    const check=()=>{
      if(owner.invalid||project.layers!==layers||project.symbols!==symbols||project.duration!==duration||
        references.some((r,i)=>layers[i]!==r.layer||r.layer.keys!==r.keys||r.layer.motionSpans!==r.spans))
        throw new Error('The original shared-pivot scaling source changed.');
    };
    const active=()=>{
      check();
      finiteEndpointNumbers(project);
      if(JSON.stringify(project)!==stamp||owner.invalid)throw new Error('The original shared-pivot scaling source changed.');
      check();
    };
    active();
    const pivot=sharedScalingValues(scaleX,scaleY,worldPivot),requests=scalingSelection(selection,layers,frame);
    active();
    // Recheck immediately before publication too: source callbacks may freeze
    // a later track while detached intervals are being prepared.
    const tracks=requests.map(request=>layers.find(l=>l.id===request.layerId)!);
    const writable=()=>{for(const layer of tracks){
      for(const name of ['keys','motionSpans']){const descriptor=Object.getOwnPropertyDescriptor(layer,name);
        if(!descriptor||!('value' in descriptor)||!descriptor.writable)throw new Error('Scaling tracks must permit atomic endpoint publication.');}}};
    writable();active();
    editRememberedEndpoint(project,frame,requests,undefined,(members,layer)=>{
      if(layer.drawingMode==='merge')throw new Error('Scaling an endpoint requires object-mode artwork.');
      const copies=structuredClone(members);transformVectors(copies,around(pivot,scaleX,0,0,scaleY));
      copies.forEach((copy,i)=>{
        const original=matrix(members[i]);
        if(matrix(copy).every((value,j)=>value===original[j]))
          throw new Error('Scaling cannot be represented on every selected member.');
      });
      return copies;
    },()=>{active();writable();});
  }finally{sharedPivotOwners.delete(project);}
}

function skewSharedRememberedEndpoint(project:Timeline,frame:number,selection:readonly TrackSelection[],axis:'x'|'y',degrees:number,worldPivot:Point){
  const owner={invalid:false};sharedPivotOwners.set(project,owner);
  try{
    finiteEndpointNumbers(project);
    const layers=project.layers,symbols=project.symbols,duration=project.duration;
    const library=symbols?[...symbols]:undefined;
    const references=layers.map(layer=>({layer,keys:layer.keys,spans:layer.motionSpans}));
    const stamp=JSON.stringify(project);
    const check=()=>{
      if(owner.invalid||project.layers!==layers||project.symbols!==symbols||project.duration!==duration||layers.length!==references.length||
        (symbols&&library&&(symbols.length!==library.length||symbols.some((value,i)=>value!==library[i])))||
        references.some((r,i)=>layers[i]!==r.layer||r.layer.keys!==r.keys||r.layer.motionSpans!==r.spans))
        throw new Error('The original shared-pivot shearing source changed.');
    };
    const active=()=>{
      check();
      finiteEndpointNumbers(project);
      if(JSON.stringify(project)!==stamp||owner.invalid)throw new Error('The original shared-pivot shearing source changed.');
      check();
    };
    active();
    const {pivot,shear}=sharedShearingValues(axis,degrees,worldPivot),requests=shearingSelection(selection,layers,frame);
    active();
    // Recheck immediately before publication too: source callbacks may freeze
    // a later track while detached intervals are being prepared.
    const tracks=requests.map(request=>layers.find(l=>l.id===request.layerId)!);
    const writable=()=>{for(const layer of tracks){
      for(const name of ['keys','motionSpans']){const descriptor=Object.getOwnPropertyDescriptor(layer,name);
        if(!descriptor||!('value' in descriptor)||!descriptor.writable)throw new Error('Shearing tracks must permit atomic endpoint publication.');}}};
    writable();active();
    editRememberedEndpoint(project,frame,requests,undefined,(members,layer)=>{
      if(layer.drawingMode==='merge')throw new Error('Shearing an endpoint requires object-mode artwork.');
      const operation=around(pivot,1,axis==='y'?shear:0,axis==='x'?shear:0,1);
      // Reject a rounded-away operation before affine decomposition can create
      // an unrelated ULP change and masquerade as representable shearing.
      for(const member of members){const original=matrix(member);
        if(multiply(operation,original).every((value,i)=>value===original[i]))
          throw new Error('Shearing cannot be represented on every selected member.');}
      const copies=structuredClone(members);transformVectors(copies,operation);
      copies.forEach((copy,i)=>{
        const original=matrix(members[i]);
        if(matrix(copy).every((value,j)=>value===original[j]))
          throw new Error('Shearing cannot be represented on every selected member.');
      });
      return copies;
    },()=>{active();writable();});
  }finally{sharedPivotOwners.delete(project);}
}

/** Scale the selected union in document axes. Existing recipes must explicitly
 * admit the resulting affine endpoints; never enable interpolation properties. */
export function scaleRememberedEndpoint(project:Timeline,frame:number,
  selection:readonly TrackSelection[],scaleX:number,scaleY:number,worldPivot?:Point):void{
  rejectSharedScalingReentry(project);
  if(worldPivot!==undefined){scaleSharedRememberedEndpoint(project,frame,selection,scaleX,scaleY,worldPivot);return;}
  if(![scaleX,scaleY].every(Number.isFinite)||!scaleX||!scaleY||(scaleX===1&&scaleY===1))
    throw new Error('Enter finite nonzero scales that change the endpoint.');
  editRememberedEndpoint(project,frame,selection,undefined,(members,layer)=>{
    if(layer.drawingMode==='merge')throw new Error('Scaling an endpoint requires object-mode artwork.');
    const pivot=endpointTransformPivot(members,layer),copies=structuredClone(members);
    transformVectors(copies,around(pivot,scaleX,0,0,scaleY));
    return copies;
  });
}

/** Apply one document-axis shear; preserve both recipes' explicit admission settings. */
export function skewRememberedEndpoint(project:Timeline,frame:number,
  selection:readonly TrackSelection[],axis:'x'|'y',degrees:number,worldPivot?:Point):void{
  rejectSharedShearingReentry(project);
  if(worldPivot!==undefined){skewSharedRememberedEndpoint(project,frame,selection,axis,degrees,worldPivot);return;}
  if(!['x','y'].includes(axis)||!Number.isFinite(degrees)||degrees%180===0)
    throw new Error('Choose a skew axis and a finite angle that changes the endpoint.');
  const radians=degrees*Math.PI/180;
  if(!Number.isFinite(radians)||Math.abs(Math.cos(radians))<1e-8)
    throw new Error('Skew cannot reach 90 degrees.');
  const shear=Math.tan(radians);
  if(!Number.isFinite(shear)||shear===0)throw new Error('Skew exceeds finite numerics or cannot be represented.');
  editRememberedEndpoint(project,frame,selection,undefined,(members,layer)=>{
    if(layer.drawingMode==='merge')throw new Error('Skewing an endpoint requires object-mode artwork.');
    const pivot=endpointTransformPivot(members,layer),copies=structuredClone(members);
    transformVectors(copies,around(pivot,1,axis==='y'?shear:0,axis==='x'?shear:0,1));
    return copies;
  });
}

export type RememberedPivotPosition={layerId:string;shapeId:string;position:Point};
/** Pivots are local authoring metadata. The stage matrix excludes them, so
 * setting a pivot must leave position, basis and all world geometry unchanged. */
export function setRememberedEndpointPivots(project:Timeline,frame:number,requests:readonly RememberedPivotPosition[]):void{
 finiteEndpointNumbers(project);const stamp=JSON.stringify(project);
 const edits=Array.from(requests,request=>{const layerId=request.layerId,shapeId=request.shapeId,point=request.position;return {layerId,shapeId,position:{x:point.x,y:point.y}};});
 finiteEndpointNumbers(project);if(JSON.stringify(project)!==stamp)throw new Error('Pivot source changed while reading requests.');
 const tracks=new Map<string,string[]>(),seen=new Set<string>();
 for(const edit of edits){
  if(!edit.layerId||!edit.shapeId||![edit.position.x,edit.position.y].every(Number.isFinite))throw new Error('Choose original artwork and a finite document pivot.');
  const key=JSON.stringify([edit.layerId,edit.shapeId]);if(seen.has(key))throw new Error('Choose one pivot per distinct artwork item.');seen.add(key);
  const ids=tracks.get(edit.layerId)??[];ids.push(edit.shapeId);tracks.set(edit.layerId,ids);
 }
 editRememberedEndpoint(project,frame,[...tracks].map(([layerId,shapeIds])=>({layerId,shapeIds})),undefined,(members,layer)=>{
  if(layer.drawingMode==='merge')throw new Error('Pivot authoring requires object-mode artwork.');
  return members.map(shape=>{
   const edit=edits.find(e=>e.layerId===layer.id&&e.shapeId===shape.id)!,basis=matrix(shape),det=basis[0]*basis[3]-basis[1]*basis[2];
   if(!basis.every(Number.isFinite)||!Number.isFinite(det)||det===0)throw new Error('Pivot position requires an invertible finite artwork basis.');
   const previous=rememberedAuthoringPivot([shape]);
   if(previous.x===edit.position.x&&previous.y===edit.position.y)throw new Error('Pivot position does not change the saved pivot.');
   const pivot=inversePoint(basis,edit.position);if(![pivot.x,pivot.y].every(Number.isFinite))throw new Error('Pivot position exceeds finite coordinates.');
   const copy={...shape,pivot};finiteEndpointNumbers(copy);return copy;
  });
 });
}

// One original source owns all requested tracks until their complete preparation
// succeeds. A swallowed recursive call cannot publish a partially edited source.
const curveEndpointOwners=new WeakMap<object,{invalid:boolean}>();
function curveEndpointTransaction<T>(source:object,read:()=>unknown,run:(verify:()=>void)=>T,enabled=true):T{
 const prior=curveEndpointOwners.get(source);if(prior){prior.invalid=true;throw Error('Endpoint curve editing cannot reenter its original source.');}
 const owner={invalid:false};curveEndpointOwners.set(source,owner);
 try{
  const original=enabled?read():undefined;if(enabled)validateLiveGraphicData(original);const signature=enabled?curveStamp(original):undefined;
  const verify=()=>{if(owner.invalid)throw Error('Endpoint curve editing cannot reenter its original source.');if(!enabled)return;const current=read();validateLiveGraphicData(current);if(owner.invalid||curveStamp(current)!==signature||owner.invalid)throw Error('Original endpoint curve source changed during preparation.');};
  verify();return run(verify);
 }finally{curveEndpointOwners.delete(source);}
}
// Scope discovery reads only original data descriptors on endpoint metadata;
// ordinary legacy edits do not serialize an unrelated large symbol library.
function curveField(value:unknown,key:string):unknown{
 if(!value||typeof value!=='object')return;
 const field=Object.getOwnPropertyDescriptor(value,key);if(field&&!('value'in field))throw Error('Endpoint curve scope requires original data fields.');return field?.value;
}
function* curveItems(value:unknown):Iterable<unknown>{
 if(!Array.isArray(value))return;
 const length=curveField(value,'length');if(typeof length!=='number'||!Number.isSafeInteger(length)||length<0)throw Error('Invalid endpoint array.');
 for(let i=0;i<length;i++){const field=Object.getOwnPropertyDescriptor(value,String(i));if(!field||!('value'in field))throw Error('Endpoint arrays require original entries.');yield field.value;}
}
function mergedEndpointKeys(keys:unknown,frame:number){
 for(const key of curveItems(keys))if(curveField(key,'frame')===frame)
  for(const shape of curveItems(curveField(key,'shapes')))if(curveField(shape,'drawingMode')==='merge'&&curveField(shape,'strokeWidth'))return true;
 return false;
}
function mergedRootEndpoint(project:Timeline,frame:number){for(const layer of curveItems(curveField(project,'layers')))if(mergedEndpointKeys(curveField(layer,'keys'),frame))return true;return false;}
function mergedSymbolEndpoint(definition:SymbolDefinition,frame:number){
 const timeline=curveField(definition,'timeline');
 if(mergedEndpointKeys(frame===0?[{frame:0,shapes:curveField(definition,'shapes')}]:curveField(timeline,'keys'),frame))return true;
 for(const layer of curveItems(curveField(timeline,'layers')))if(mergedEndpointKeys(curveField(layer,'keys'),frame))return true;return false;
}

/** Capture companions from the original endpoint, before any selected shape is
 * changed. Only explicitly merged artwork participates on these object tracks. */
function endpointAttachedFills(layer:Timeline['layers'][number],frame:number,members:Vector[]){
 if(!members.some(s=>s.drawingMode==='merge'&&s.strokeWidth))return (_moved:Vector[])=>[] as Vector[];
 const shapes=layer.keys.find(k=>k.frame===frame)!.shapes,selected=new Set(members.map(s=>s.id));
 const plan=captureAttachedFillEdit(shapes.filter(s=>s.drawingMode==='merge'),[...selected]);
 return (moved:Vector[])=>{
  const edits=new Map(moved.map(s=>[s.id,s])),result:Vector[]=[];
  for(const linked of plan.prepare(shapes.map(s=>edits.get(s.id)??s))){
   const original=shapes.find(s=>s.id===linked.id)!;
   if(JSON.stringify(original)===JSON.stringify(linked))continue;
   // Carry geometry only: original paint/registration/optional metadata stay
   // independent even when the legacy outline helper uses a JSON clone.
   const copy=structuredClone(original) as Vector&Record<string,unknown>;
   for(const field of ['kind','points','nodes','contours','closed','fillRule']as const){
    if(Object.hasOwn(linked,field))(copy as Record<string,unknown>)[field]=structuredClone(linked[field]);
    else delete (copy as Record<string,unknown>)[field];
   }
   validateLiveGraphicData(copy);result.push(copy);
  }
  return result;
 };
}

export type RememberedNodePosition={layerId:string;shapeId:string;nodeIndex:number;position:Point;contourIndex?:number};
/** Move original Bezier anchors in document coordinates. Topology and handle
 * offsets stay fixed; every requested track regenerates before any write.
 * Explicit contourIndex uses that contour's nodeIndex; omission retains legacy scope. */
export function moveRememberedEndpointNodes(project:Timeline,frame:number,requests:readonly RememberedNodePosition[]):void{
 const merged=mergedRootEndpoint(project,frame);
 return curveEndpointTransaction(project,()=>project,verify=>{
 finiteEndpointNumbers(project);
 const edits=Array.from(requests,request=>({layerId:request.layerId,shapeId:request.shapeId,nodeIndex:request.nodeIndex,contourIndex:request.contourIndex,position:{x:request.position.x,y:request.position.y}}));
 finiteEndpointNumbers(project);
 verify();if(mergedRootEndpoint(project,frame)!==merged)throw Error('Original endpoint merge scope changed while reading requests.');
 const tracks=new Map<string,string[]>(),seen=new Set<string>();
 for(const edit of edits){
  if(!edit.layerId||!edit.shapeId||!Number.isSafeInteger(edit.nodeIndex)||edit.nodeIndex<0||(edit.contourIndex!==undefined&&(!Number.isSafeInteger(edit.contourIndex)||edit.contourIndex<0))||![edit.position.x,edit.position.y].every(Number.isFinite))throw new Error('Choose an original Bezier node and finite document position.');
  const key=JSON.stringify([edit.layerId,edit.shapeId]);if(seen.has(key))throw new Error('Choose one node per distinct artwork item.');seen.add(key);
  const ids=tracks.get(edit.layerId)??[];ids.push(edit.shapeId);tracks.set(edit.layerId,ids);
 }
 editRememberedEndpoint(project,frame,[...tracks].map(([layerId,shapeIds])=>({layerId,shapeIds})),undefined,(members,layer)=>{
  if(layer.drawingMode==='merge')throw new Error('Editing a remembered node requires object-mode artwork.');
  const attached=merged?endpointAttachedFills(layer,frame,members):(_moved:Vector[])=>[] as Vector[];
  const moved=members.map(shape=>{
   const edit=edits.find(e=>e.layerId===layer.id&&e.shapeId===shape.id)!,compound=edit.contourIndex!==undefined;
   const base=compound?shape.contours?.[edit.contourIndex!]?.[edit.nodeIndex]:shape.nodes?.[edit.nodeIndex];
   if((compound?(shape.kind!=='polygon'||shape.fillRule!=='evenodd'||!shape.contours?.length):shape.kind!=='bezier')||!base)throw new Error(compound?'The original compound contour node no longer exists.':'The original Bezier node no longer exists.');
   const basis=matrix(shape),det=basis[0]*basis[3]-basis[1]*basis[2];
   if(!basis.every(Number.isFinite)||!Number.isFinite(det)||det===0)throw new Error('Node position requires an invertible finite artwork basis.');
   const position=inversePoint(basis,edit.position),dx=position.x-base.x,dy=position.y-base.y;
   if(![position.x,position.y,dx,dy].every(Number.isFinite)||(position.x===base.x&&position.y===base.y))throw new Error('Node position is nonfinite or does not change the anchor.');
   const copy=structuredClone(shape),originalNodes=compound?shape.contours![edit.contourIndex!]:shape.nodes!,nodes=compound?copy.contours![edit.contourIndex!]:copy.nodes!,last=originalNodes.length-1;
   const joined=shape.drawingMode==='merge'&&(compound||shape.closed)&&last>0&&(edit.nodeIndex===0||edit.nodeIndex===last)&&originalNodes[0].x===originalNodes[last].x&&originalNodes[0].y===originalNodes[last].y;
   for(const index of joined?[0,last]:[edit.nodeIndex]){const prior=originalNodes[index],node=nodes[index];node.x=position.x;node.y=position.y;
    for(const part of ['in','out']as const)if(prior[part])node[part]={...prior[part],x:prior[part]!.x+dx,y:prior[part]!.y+dy};
   }
   finiteEndpointNumbers(copy);return copy;
  });
  return [...moved,...attached(moved)];
 },verify);
 },merged);
}

export type RememberedTangentPosition=RememberedNodePosition&{part:'in'|'out';coupled?:boolean};
/** Position an existing handle independently by default. Explicit coupling uses
 * the stage geometry rules and requires an existing opposite handle. An explicit
 * contourIndex addresses that contour's nodeIndex; omission retains legacy scope. */
export function moveRememberedEndpointTangents(project:Timeline,frame:number,requests:readonly RememberedTangentPosition[]):void{
 const merged=mergedRootEndpoint(project,frame);
 return curveEndpointTransaction(project,()=>project,verify=>{
 finiteEndpointNumbers(project);
 const edits=Array.from(requests,request=>({layerId:request.layerId,shapeId:request.shapeId,nodeIndex:request.nodeIndex,part:request.part,coupled:request.coupled,contourIndex:request.contourIndex,position:{x:request.position.x,y:request.position.y}}));
 finiteEndpointNumbers(project);
 verify();if(mergedRootEndpoint(project,frame)!==merged)throw Error('Original endpoint merge scope changed while reading requests.');
 const tracks=new Map<string,string[]>(),seen=new Set<string>();
 for(const edit of edits){
  if(!edit.layerId||!edit.shapeId||!Number.isSafeInteger(edit.nodeIndex)||edit.nodeIndex<0||!['in','out'].includes(edit.part)||(edit.contourIndex!==undefined&&(!Number.isSafeInteger(edit.contourIndex)||edit.contourIndex<0))||(edit.coupled!==undefined&&typeof edit.coupled!=='boolean')||![edit.position.x,edit.position.y].every(Number.isFinite))throw new Error('Choose an original Bezier handle and finite document position.');
  const key=JSON.stringify([edit.layerId,edit.shapeId]);if(seen.has(key))throw new Error('Choose one tangent per distinct artwork item.');seen.add(key);
  const ids=tracks.get(edit.layerId)??[];ids.push(edit.shapeId);tracks.set(edit.layerId,ids);
 }
 editRememberedEndpoint(project,frame,[...tracks].map(([layerId,shapeIds])=>({layerId,shapeIds})),undefined,(members,layer)=>{
  if(layer.drawingMode==='merge')throw new Error('Editing a remembered tangent requires object-mode artwork.');
  const attached=merged?endpointAttachedFills(layer,frame,members):(_moved:Vector[])=>[] as Vector[];
  const moved=members.map(shape=>{
   const edit=edits.find(e=>e.layerId===layer.id&&e.shapeId===shape.id)!,compound=edit.contourIndex!==undefined;
   const originalNode=compound?shape.contours?.[edit.contourIndex!]?.[edit.nodeIndex]:shape.nodes?.[edit.nodeIndex],base=originalNode?.[edit.part];
   if((compound?(shape.kind!=='polygon'||shape.fillRule!=='evenodd'||!shape.contours?.length):(shape.kind!=='bezier'||!!shape.contours?.length))||!base)throw new Error(compound?'The original compound contour handle no longer exists.':'The original single-contour Bezier handle no longer exists.');
   const basis=matrix(shape),det=basis[0]*basis[3]-basis[1]*basis[2];
   if(!basis.every(Number.isFinite)||!Number.isFinite(det)||det===0)throw new Error('Tangent position requires an invertible finite artwork basis.');
   const position=inversePoint(basis,edit.position);
   if(![position.x,position.y].every(Number.isFinite)||(position.x===base.x&&position.y===base.y))throw new Error('Tangent position is nonfinite or does not change the handle.');
   const copy=structuredClone(shape),node=compound?copy.contours![edit.contourIndex!][edit.nodeIndex]:copy.nodes![edit.nodeIndex];
   if(edit.coupled){
    const opposite=edit.part==='in'?'out':'in',other=originalNode![opposite];
    if(!other)throw new Error('Coupled tangent editing requires both original handles.');
    let flatIndex=edit.nodeIndex;
    if(compound)for(let i=0;i<edit.contourIndex!;i++)flatIndex+=shape.contours![i].length;
    if(!Number.isSafeInteger(flatIndex))throw new Error('Compound tangent index exceeds representable geometry.');
    moveTangent(copy,shape,flatIndex,edit.part,position);
    const moved=node[edit.part]!;
    if(moved.x!==position.x||moved.y!==position.y)throw new Error('Coupled tangent position exceeds finite geometry.');
    node[edit.part]={...base,...moved};node[opposite]={...other,...node[opposite]!};
   }else node[edit.part]={...base,x:position.x,y:position.y};
   finiteEndpointNumbers(copy);return copy;
  });
  return [...moved,...attached(moved)];
 },verify);
 },merged);
}

/** Reject original values before any JSON-based motion cloning can normalize them. */
function finiteEndpointNumbers(value:unknown):void{
  if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Endpoint artwork contains nonfinite original values.');
  if(value&&typeof value==='object')for(const child of Object.values(value))finiteEndpointNumbers(child);
}

function endpointTransformPivot(members:Vector[],layer:Timeline['layers'][number]){
    finiteEndpointNumbers(layer);
    return rememberedAuthoringPivot(members);
}

/** Common mapped saved pivot, falling back to the complete authoring-box union. */
export function rememberedAuthoringPivot(members:Vector[]){
    finiteEndpointNumbers(members);
    if(!members.length)throw new Error('Choose endpoint artwork for a pivot.');
    const pivots=members.map(s=>s.pivot?mapPoint(matrix(s),s.pivot):null),first=pivots[0];
    const boxes=members.map(objectBounds);
    const pivot=first && pivots.every(p=>p && Math.hypot(p.x-first.x,p.y-first.y)<1e-5)
      ? first : {x:(Math.min(...boxes.map(b=>b.left))+Math.max(...boxes.map(b=>b.right)))/2,
                 y:(Math.min(...boxes.map(b=>b.top))+Math.max(...boxes.map(b=>b.bottom)))/2};
    if(![pivot.x,pivot.y].every(Number.isFinite))throw new Error('Endpoint pivot exceeds finite coordinates.');
    return pivot;
}

function editRememberedEndpoint(project:Timeline,frame:number,selection:readonly TrackSelection[],
  move?: (shape:Vector)=>Vector,
  transform?: (members:Vector[],layer:Timeline['layers'][number])=>Vector[],verify?:()=>void) {
  if(!Number.isSafeInteger(frame)||frame<=0||frame>=project.duration)
    throw new Error('Choose a shared endpoint.');
  if (!selection.length) throw new Error('Select endpoint artwork.');
  const seen = new Set<string>();
  const prepared = Array.from(selection, ({layerId,shapeIds}) => {
    const matches = project.layers.filter(l => l.id === layerId), layer = matches[0];
    if (seen.has(layerId) || matches.length !== 1 || !layer.visible || layer.locked)
      throw new Error('Choose distinct visible, unlocked motion tracks.');
    seen.add(layerId);
    const spans = layer.motionSpans ?? [], left = spans.filter(s => s.end === frame), right = spans.filter(s => s.start === frame);
    if (left.length !== 1 || right.length !== 1 ||
        spans.filter(s => s.end > left[0].start && s.start < right[0].end).length !== 2)
      throw new Error('Choose an endpoint shared by two adjacent remembered spans.');
    const keys = layer.keys.filter(k => k.frame === frame), ids = new Set(shapeIds);
    if (keys.length !== 1 || !ids.size || ids.size !== shapeIds.length)
      throw new Error('Select distinct artwork on the shared key.');
    const key = keys[0], found = new Set<string>();
    const moved = {...key, shapes: key.shapes.map(shape => {
      if (!ids.has(shape.id)) return shape;
      if (found.has(shape.id)) throw new Error('Endpoint artwork identity is ambiguous.');
      found.add(shape.id);
      return move ? move(shape) : shape;
    })};
    if (found.size !== ids.size) throw new Error('Selected endpoint artwork changed.');
    if(transform){
      const replacements=new Map(transform(key.shapes.filter(s=>ids.has(s.id)),layer).map(s=>[s.id,s]));
      moved.shapes=key.shapes.map(s=>replacements.get(s.id)??s);
    }
    const replacements = new Map([[frame,moved]]);
    const updated = new Map<typeof spans[number],typeof spans[number]>();
    for (const span of [left[0],right[0]]) {
      const interval = layer.keys.filter(k => k.frame >= span.start && k.frame <= span.end);
      if (interval.length !== span.end-span.start+1 || interval.some((k,i) => k.frame !== span.start+i))
        throw new Error('Remembered interval has missing or ambiguous keys.');
      const draft = {...layer,keys:interval.map(k => k === key ? moved : k),motionSpans:[span]};
      refreshBasicMotionSpan({...project,layers:[draft]},[layerId],span.start,span.end);
      for (const k of draft.keys) if (k.frame > span.start && k.frame < span.end) replacements.set(k.frame,k);
      updated.set(span,draft.motionSpans[0]);
    }
    return {layer,keys:layer.keys.map(k => replacements.get(k.frame) ?? k),spans:spans.map(s => updated.get(s) ?? s)};
  });
  verify?.();
  for (const {layer,keys,spans} of prepared) {layer.keys=keys;layer.motionSpans=spans;}
}

/** Return a detached symbol draft. Account for both regenerated intervals and
 * every other definition before allocating generated artwork. */
export function translateSymbolRememberedEndpoint(definition: SymbolDefinition, symbols: SymbolDefinition[],
  frame: number, selection: readonly TrackSelection[], dx: number, dy: number): SymbolDefinition {
  return editSymbolRememberedEndpoint(definition,symbols,frame,selection,timeline=>
    translateRememberedEndpoint(timeline,frame,selection,dx,dy));
}

/** Rotate detached symbol tracks using their complete library for nested timing. */
export function rotateSymbolRememberedEndpoint(definition:SymbolDefinition,symbols:SymbolDefinition[],
  frame:number,selection:readonly TrackSelection[],degrees:number,worldPivot?:Point):SymbolDefinition{
  rejectSharedRotationReentry(definition);
  if(worldPivot!==undefined){
    const owner={invalid:false};sharedPivotOwners.set(definition,owner);
    try{
      validateSymbolEndpointSource(definition,symbols);
      const timeline=definition.timeline,shapes=definition.shapes,library=[...symbols],stamp=JSON.stringify([definition,symbols]);
      const check=()=>{if(owner.invalid||definition.timeline!==timeline||definition.shapes!==shapes||symbols.length!==library.length||symbols.some((s,i)=>s!==library[i]))
        throw new Error('The original shared-pivot symbol rotation source changed.');};
      const active=()=>{check();validateSymbolEndpointSource(definition,symbols);if(JSON.stringify([definition,symbols])!==stamp)
        throw new Error('The original shared-pivot symbol rotation source changed.');check();};
      active();
      const pivot=sharedRotationValues(degrees,worldPivot),requests=rotationSelection(selection,symbolLayers(definition),frame);
      active();
      const result=editSymbolRememberedEndpoint(definition,symbols,frame,requests,candidate=>rotateRememberedEndpoint(candidate,frame,requests,degrees,pivot));
      active();return result;
    }finally{sharedPivotOwners.delete(definition);}
  }
  validateSymbolEndpointSource(definition,symbols);
  return editSymbolRememberedEndpoint(definition,symbols,frame,selection,timeline=>
    rotateRememberedEndpoint(timeline,frame,selection,degrees));
}

/** Scale detached symbol tracks without enabling any interpolation properties. */
export function scaleSymbolRememberedEndpoint(definition:SymbolDefinition,symbols:SymbolDefinition[],
  frame:number,selection:readonly TrackSelection[],scaleX:number,scaleY:number,worldPivot?:Point):SymbolDefinition{
  rejectSharedScalingReentry(definition);
  if(worldPivot!==undefined){
    const owner={invalid:false};sharedPivotOwners.set(definition,owner);
    try{
      validateSymbolEndpointSource(definition,symbols);
      const timeline=definition.timeline,shapes=definition.shapes,library=[...symbols],stamp=JSON.stringify([definition,symbols]);
      const check=()=>{if(owner.invalid||definition.timeline!==timeline||definition.shapes!==shapes||symbols.length!==library.length||symbols.some((s,i)=>s!==library[i]))
        throw new Error('The original shared-pivot symbol scaling source changed.');};
      const active=()=>{check();validateSymbolEndpointSource(definition,symbols);if(JSON.stringify([definition,symbols])!==stamp)
        throw new Error('The original shared-pivot symbol scaling source changed.');check();};
      active();
      const pivot=sharedScalingValues(scaleX,scaleY,worldPivot),requests=scalingSelection(selection,symbolLayers(definition),frame);
      active();
      const result=editSymbolRememberedEndpoint(definition,symbols,frame,requests,candidate=>scaleRememberedEndpoint(candidate,frame,requests,scaleX,scaleY,pivot));
      active();return result;
    }finally{sharedPivotOwners.delete(definition);}
  }
  validateSymbolEndpointSource(definition,symbols);
  return editSymbolRememberedEndpoint(definition,symbols,frame,selection,timeline=>
    scaleRememberedEndpoint(timeline,frame,selection,scaleX,scaleY));
}
/** Shear detached symbol tracks about one explicit document pivot, retaining library admission. */
export function skewSymbolRememberedEndpoint(definition:SymbolDefinition,symbols:SymbolDefinition[],
  frame:number,selection:readonly TrackSelection[],axis:'x'|'y',degrees:number,worldPivot?:Point):SymbolDefinition{
  rejectSharedShearingReentry(definition);
  if(worldPivot!==undefined){
    const owner={invalid:false};sharedPivotOwners.set(definition,owner);
    try{
      validateSymbolEndpointSource(definition,symbols);
      const timeline=definition.timeline,shapes=definition.shapes,library=[...symbols],stamp=JSON.stringify([definition,symbols]);
      const keys=timeline?.keys,spans=timeline?.motionSpans,tracks=timeline?.layers;
      const references=tracks?.map(layer=>({layer,keys:layer.keys,spans:layer.motionSpans}));
      const check=()=>{if(owner.invalid||definition.timeline!==timeline||definition.shapes!==shapes||
        timeline?.keys!==keys||timeline?.motionSpans!==spans||timeline?.layers!==tracks||
        (tracks&&references&&(tracks.length!==references.length||references.some((r,i)=>tracks[i]!==r.layer||r.layer.keys!==r.keys||r.layer.motionSpans!==r.spans)))||
        symbols.length!==library.length||symbols.some((s,i)=>s!==library[i]))
        throw new Error('The original shared-pivot symbol shearing source changed.');};
      const active=()=>{check();validateSymbolEndpointSource(definition,symbols);if(JSON.stringify([definition,symbols])!==stamp)
        throw new Error('The original shared-pivot symbol shearing source changed.');check();};
      active();
      const {pivot}=sharedShearingValues(axis,degrees,worldPivot),requests=shearingSelection(selection,symbolLayers(definition),frame);
      active();
      const result=editSymbolRememberedEndpoint(definition,symbols,frame,requests,candidate=>skewRememberedEndpoint(candidate,frame,requests,axis,degrees,pivot));
      active();return result;
    }finally{sharedPivotOwners.delete(definition);}
  }
  validateSymbolEndpointSource(definition,symbols);
  return editSymbolRememberedEndpoint(definition,symbols,frame,selection,timeline=>
    skewRememberedEndpoint(timeline,frame,selection,axis,degrees));
}
/** Detached pivot metadata edits retain original/replacement aggregate admission.
 * Snapshot request accessors before preparation and recheck original sources. */
export function setSymbolRememberedEndpointPivots(definition:SymbolDefinition,symbols:SymbolDefinition[],frame:number,requests:readonly RememberedPivotPosition[]):SymbolDefinition{
 validateSymbolEndpointSource(definition,symbols);
 const original=[...symbols.filter(s=>s.id!==definition.id),definition];
 if(original.reduce((sum,s)=>sum+symbolArtworks(s).reduce((n,items)=>n+items.length,0),0)>MAX_SYMBOL_ARTWORK)throw new Error('Pivot source exceeds the existing project symbol artwork budget.');
 const stamp=JSON.stringify([definition,symbols]);
 const edits=Array.from(requests,request=>{const layerId=request.layerId,shapeId=request.shapeId,point=request.position;return {layerId,shapeId,position:{x:point.x,y:point.y}};});
 const active=()=>{validateSymbolEndpointSource(definition,symbols);if(JSON.stringify([definition,symbols])!==stamp)throw new Error('Pivot source changed while preparing symbol requests.');};active();
 const selection=[...new Set(edits.map(edit=>edit.layerId))].map(layerId=>({layerId,shapeIds:edits.filter(edit=>edit.layerId===layerId).map(edit=>edit.shapeId)}));
 const result=editSymbolRememberedEndpoint(definition,symbols,frame,selection,timeline=>setRememberedEndpointPivots(timeline,frame,edits));
 active();return result;
}

/** Detached library-aware Bezier node edits retain original and replacement
 * aggregate admission before and after every requested track is prepared. */
export function moveSymbolRememberedEndpointNodes(definition:SymbolDefinition,symbols:SymbolDefinition[],frame:number,requests:readonly RememberedNodePosition[]):SymbolDefinition{
 const merged=mergedSymbolEndpoint(definition,frame);
 return curveEndpointTransaction(definition,()=>[definition,symbols],verify=>{
  validateSymbolEndpointSource(definition,symbols);
  const edits=Array.from(requests,request=>({layerId:request.layerId,shapeId:request.shapeId,nodeIndex:request.nodeIndex,contourIndex:request.contourIndex,position:{x:request.position.x,y:request.position.y}}));
  validateSymbolEndpointSource(definition,symbols);
  verify();if(mergedSymbolEndpoint(definition,frame)!==merged)throw Error('Original endpoint merge scope changed while reading requests.');
  const selection=[...new Set(edits.map(edit=>edit.layerId))].map(layerId=>({layerId,shapeIds:edits.filter(edit=>edit.layerId===layerId).map(edit=>edit.shapeId)}));
  const result=editSymbolRememberedEndpoint(definition,symbols,frame,selection,timeline=>moveRememberedEndpointNodes(timeline,frame,edits));
  verify();return result;
 },merged);
}

/** Prepare existing symbol handles with original/replacement library budgets. */
export function moveSymbolRememberedEndpointTangents(definition:SymbolDefinition,symbols:SymbolDefinition[],frame:number,requests:readonly RememberedTangentPosition[]):SymbolDefinition{
 const merged=mergedSymbolEndpoint(definition,frame);
 return curveEndpointTransaction(definition,()=>[definition,symbols],verify=>{
  validateSymbolEndpointSource(definition,symbols);
  const edits=Array.from(requests,request=>({layerId:request.layerId,shapeId:request.shapeId,nodeIndex:request.nodeIndex,part:request.part,coupled:request.coupled,contourIndex:request.contourIndex,position:{x:request.position.x,y:request.position.y}}));
  validateSymbolEndpointSource(definition,symbols);
  verify();if(mergedSymbolEndpoint(definition,frame)!==merged)throw Error('Original endpoint merge scope changed while reading requests.');
  const selection=[...new Set(edits.map(edit=>edit.layerId))].map(layerId=>({layerId,shapeIds:edits.filter(edit=>edit.layerId===layerId).map(edit=>edit.shapeId)}));
  const result=editSymbolRememberedEndpoint(definition,symbols,frame,selection,timeline=>moveRememberedEndpointTangents(timeline,frame,edits));
  verify();return result;
 },merged);
}

function validateSymbolEndpointSource(definition:SymbolDefinition,symbols:SymbolDefinition[]){
  finiteEndpointNumbers(definition);finiteEndpointNumbers(symbols);
  if(new Set(symbols.map(s=>s.id)).size!==symbols.length)throw new Error('Symbol library identities are ambiguous.');
}

function editSymbolRememberedEndpoint(definition:SymbolDefinition,symbols:SymbolDefinition[],
  frame:number,selection:readonly TrackSelection[],edit:(timeline:Timeline)=>void):SymbolDefinition{
  if (!definition.timeline) throw new Error('Choose an animated symbol.');
  const library=[...symbols.filter(s=>s.id!==definition.id),definition];
  const layers=symbolLayers(definition).map(layer=>({...layer}));
  const otherCount=library.slice(0,-1).reduce((sum,s)=>sum+symbolArtworks(s).reduce((n,items)=>n+items.length,0),0);
  const count=()=>otherCount+layers.reduce((n,l)=>n+l.keys.reduce((m,k)=>m+k.shapes.length,0),0);
  let projected=count();
  const check=(n:number)=>{if(!Number.isSafeInteger(n)||n>MAX_SYMBOL_ARTWORK)throw new Error('Motion would exceed the existing project symbol artwork budget.');};
  check(projected);
  for(const {layerId} of selection){
    const layer=layers.find(l=>l.id===layerId);
    if(!layer)throw new Error('Motion track is missing.');
    for(const span of layer.motionSpans??[])if(span.start===frame||span.end===frame){
      const source=layer.keys.find(k=>k.frame===span.start);
      if(!source)throw new Error('Missing authored motion endpoint.');
      projected+=(span.end-span.start-1)*source.shapes.length-layer.keys.reduce((n,k)=>n+(k.frame>span.start&&k.frame<span.end?k.shapes.length:0),0);
    }
  }
  check(projected);
  edit({layers,duration:definition.timeline.duration,symbols:library});
  check(count());
  const [base,...additional]=layers;
  return structuredClone({...definition,shapes:base.keys[0].shapes,timeline:{...definition.timeline,
    keys:base.keys.slice(1),...(definition.timeline.layers!==undefined?{layers:additional}:{}),
    ...(base.motionSpans!==undefined?{motionSpans:base.motionSpans}:{})}});
}

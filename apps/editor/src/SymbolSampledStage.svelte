<script lang="ts">
  import {onMount,untrack} from 'svelte';
  let preparingSelection=0,selectionRepaintPending=false;
  function selectionPreparing(active:boolean){preparingSelection+=active?1:-1;if(!preparingSelection&&selectionRepaintPending){selectionRepaintPending=false;paint();}}
  import {paintSampledSelectionRotationHandle,paintSampledSelectionScaleHandles,paintSampledSelectionSkewHandles,paintSampledPointHint} from './sampled-overlay-paint';
  import type {SelectionRotationLayout} from './symbol-sampled-selection-rotation-drag';
  import type {SelectionScaleLayout} from './symbol-sampled-selection-scale-drag';
  import type {SelectionSkewLayout} from './symbol-sampled-selection-skew-drag';
  let selectionTrajectoryHint=$state.raw<Parameters<typeof paintSampledPointHint>[1]>(null);
  let selectionSkewHint=$state.raw<SelectionSkewLayout|null>(null);
  let selectionScaleHint=$state.raw<SelectionScaleLayout|null>(null);
  let selectionRotationHint=$state.raw<SelectionRotationLayout|null>(null);
  import {createSymbolSampledSelectionTrajectoryContext,type SymbolSampledSelectionTrajectoryEdit} from './symbol-sampled-selection-trajectory-editor';
  import SymbolSampledSelectionEditor from './SymbolSampledSelectionEditor.svelte';
  import {createSymbolSampledSelectionContext,type SymbolSampledSelectionEdit,type SymbolSampledSelectionPreview} from './symbol-sampled-selection-editor';
  import type {SymbolSampledSelectionOwner} from '../../../packages/animation/src/symbol-selection-motion-owner';
  import {createLatestFrameTask} from './latest-frame-task';
  import {symbolLayers,keyAt,type Point,type Project,type SymbolDefinition} from '../../../packages/document/src';
  import type {MotionPath} from '../../../packages/document/src/motion-path';
  import {rememberedAuthoringPivot} from '../../../packages/animation/src/motion-junction';
  import {captureSymbolRememberedAuthoringFrame} from '../../../packages/animation/src/symbol-motion-owner';
  import {expandSymbols} from '../../../packages/geometry/src/symbols';
  import {worldPoint} from '../../../packages/geometry/src';
  import {objectBounds,type Bounds} from '../../../packages/geometry/src/layout';
  import {drawShape} from '../../../packages/stage/src';
  import {sampledSkewHandles,sampledGroupSkewHandles,sampledSkewAngle} from './sampled-skew-handles';
  import {sampledScaleHandles,sampledGroupScaleHandles,sampledScaleFactors} from './sampled-scale-handles';
  import {sampledRotationHandle,sampledGroupRotationHandle,rotationLocal,type RotationView} from './sampled-rotation-handle';
  import {pickPreviewRoot} from './motion-preview-hit';
  type Owner=ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolve']>;
  type NodeOwner=ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolveNode']>;
  type TangentOwner=ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolveTangent']>;
  type CompoundNodeOwner=ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolveCompoundNode']>;
  type CompoundOwner=ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolveCompoundTangent']>;
  type GroupOwner=ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolveGroup']>;
  let {definition,symbols,assets,frame,validateSource:validateEnclosingSource,validateCandidate,promote:publishLegacy,publishSelection,publishTrajectories}:{definition:SymbolDefinition;symbols:SymbolDefinition[];assets:Project['assets'];frame:number;validateSource:()=>void;validateCandidate:(candidate:SymbolDefinition)=>void;publishSelection:(edit:SymbolSampledSelectionEdit)=>void;publishTrajectories:(edit:SymbolSampledSelectionTrajectoryEdit,finalAdmission?:()=>void)=>void;promote:(owner:Owner|GroupOwner|NodeOwner|TangentOwner|CompoundOwner|CompoundNodeOwner,prepare:()=>SymbolDefinition,verify:()=>void)=>void}=$props();
  // A keyed source change must not replace this instance's admission callback
  // before its pending pointer event has finished.
  const validateSource=untrack(()=>validateEnclosingSource);
  let selectionMode=$state(false),selectionPolicy=$state(0),selectionReady=$state(false);
  let selectionPreview=$state.raw<SymbolSampledSelectionPreview|null>(null),selectionOwner=$state.raw<SymbolSampledSelectionOwner|null>(null);
  const selectionState=()=>({definition,symbols,assets,frame,revision:0,policy:selectionPolicy,groups:groupMode,pick,prepared:presentationSymbols,blocked:!alive||!selectionMode||!selectionReady||!!failure});
  const sampleSelection=(candidate:SymbolDefinition,at:number)=>{const owner=captureSymbolRememberedAuthoringFrame(()=>({definition:candidate,symbols,frame:at,revision:0}));try{return {scene:owner.scene,symbols:[...presentationSymbols!.filter(s=>s.id!==candidate.id),candidate]};}finally{owner.dispose();}};
  const selectionContext=$derived.by(()=>{
    if(!selectionMode||!selectionReady)return null;
    return createSymbolSampledSelectionContext(selectionState,validateSource,validateCandidate,sampleSelection);
  });
  function trajectoryContext(){return createSymbolSampledSelectionTrajectoryContext(selectionState,validateSource,validateCandidate,sampleSelection);}
  function changeSelectionMode(enabled:boolean){cancelInteraction();selectionPolicy++;selectionPreview=null;selectionOwner=null;selectionMode=enabled;paint();}
  function selectionPose(){if(!selectionMode||!selectionPreview)return null;try{selectionPreview.validate();return selectionPreview.pose;}catch{return null;}}
  class SelectionModeChanged extends Error {}
  let preparingLegacySelection=false,legacySelectionRepaint=false;
  function promote(owner:Parameters<typeof publishLegacy>[0],prepare:()=>SymbolDefinition,verify:()=>void){
    const policy=selectionPolicy;
    const check=()=>{if(selectionMode||selectionPolicy!==policy)throw new SelectionModeChanged('The sampled symbol editing mode changed.');verify();if(selectionMode||selectionPolicy!==policy)throw new SelectionModeChanged('The sampled symbol editing mode changed.');};
    check();publishLegacy(owner,()=>{check();preparingLegacySelection=true;try{const candidate=prepare();check();return candidate;}finally{preparingLegacySelection=false;if(legacySelectionRepaint){legacySelectionRepaint=false;paint();}}},check);
  }
  let canvas:HTMLCanvasElement, capture:ReturnType<typeof captureSymbolRememberedAuthoringFrame>|undefined;
  let choices=$state<{layerId:string;shapeId:string}[]>([]),pick=$state(''),status=$state('Preparing sampled pose.'),failure=$state('');
  let moveX=$state<number|undefined>(0),moveY=$state<number|undefined>(0),actionError=$state('');
  let scaleInputRevision=0,scaleInputAxes={x:0,y:0},scalePolicy=0,preparingScale=false,scaleRepaintPending=false;
  let scaleX=$state<number|undefined>(100),scaleY=$state<number|undefined>(100);
  const validScale=$derived(Number.isFinite(scaleX)&&Number.isFinite(scaleY)&&!!scaleX&&!!scaleY&&(scaleX!==100||scaleY!==100));
  let skewInputRevision=0,skewInputAxes={axis:0,angle:0},skewPolicy=0,preparingSkew=false,skewRepaintPending=false;
  let skewAxis=$state<'x'|'y'>('x'),skewAngle=$state<number|undefined>(0);
  const validSkew=$derived(Number.isFinite(skewAngle)&&!!skewAngle&&skewAngle!%180!==0);
  let rotationInputRevision=0,rotationPolicy=0,preparingRotation=false,rotationRepaintPending=false;
  let angle=$state<number|undefined>(0);
  const validRotation=$derived(Number.isFinite(angle)&&!!angle&&angle!%360!==0);
  let groupMode=$state(false),groupChoices=$state<{layerId:string;shapeId:string}[]>([]),memberIds=$state<string[]>([]);
  let presentationSymbols:SymbolDefinition[]|undefined,capturedDefinition:SymbolDefinition|undefined;
  let node=$state.raw<{owner:NodeOwner;pick:string;point:Point}>(),nodeX=$state<number|undefined>(),nodeY=$state<number|undefined>();
  const nodeShape=$derived(!groupMode&&pick&&capture&&presentationSymbols?capture.scene.find(t=>t.layerId===choices.find(c=>JSON.stringify([c.layerId,c.shapeId])===pick)?.layerId)?.key.shapes.find(s=>s.id===choices.find(c=>JSON.stringify([c.layerId,c.shapeId])===pick)?.shapeId):undefined);
  const validNode=$derived(!!node&&Number.isFinite(nodeX)&&Number.isFinite(nodeY)&&(nodeX!==node.point.x||nodeY!==node.point.y));
  function chooseNode(value:string){rootTrajectory=undefined;rootWaypoints=undefined;
    cancelInteraction();discardProposal();node=undefined;nodeX=undefined;nodeY=undefined;
    if(!value||!capture||!nodeShape||groupMode)return;
    try{const selected=pickedView();if(!selected)throw Error('Choose original sampled artwork.');const owner=capture.resolveNode(selected.owner.layerId,selected.owner.shapeId,Number(value)-1),point=worldPoint(selected.shape,selected.shape.nodes![owner.nodeIndex]);validateSource();node={owner,pick,point};nodeX=point.x;nodeY=point.y;paint();}catch(cause){actionFailure(cause);}
  }
  function nodeInput(event:Event,axis:'x'|'y'){
    const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);cancelInteraction();nodeInputRevision++;nodeInputAxes[axis]++;discardProposal();if(axis==='x')nodeX=n;else nodeY=n;input.value=value;
  }
  function nodeAction(){
    if(!node||!validNode||groupMode)throw Error('Choose an original node and a changed finite document position.');
    const selection=node,x=nodeX!,y=nodeY!,gesture=nodeDrag,target=gesture?.previewTarget,inputRevision=nodeInputRevision,at=frame,admission=prepareAction(),originalCapture=capture!,owner=originalCapture.resolveNode(admission.owner.layerId,admission.owner.shapeId,selection.owner.nodeIndex);
    const verifyInputs=()=>{validateSource();if(gesture)assertNodeInputs(gesture);if(!alive||failure||press||drag||capture!==originalCapture||frame!==at||node!==selection||pick!==selection.pick||groupMode||nodeX!==x||nodeY!==y||nodeInputRevision!==inputRevision||(gesture&&gesture.previewTarget!==target))throw Error('Sampled symbol node or target changed.');};
    const verify=()=>{admission.verify();verifyInputs();const actual=JSON.stringify(originalCapture.resolveNode(owner.layerId,owner.shapeId,owner.nodeIndex)),expected=JSON.stringify(selection.owner);verifyInputs();if(actual!==expected)throw Error('The original sampled node owner changed.');};
    const prepare=()=>{verify();let candidate:SymbolDefinition;preparingNode=true;try{candidate=originalCapture.prepareNodePosition(owner.layerId,owner.shapeId,owner.nodeIndex,{x,y},{validate:verifyInputs});}finally{preparingNode=false;if(nodeRepaintPending){nodeRepaintPending=false;paint();}}verify();return candidate;};verify();return {owner,verify,prepare};
  }
  function previewNode(){try{const action=nodeAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();proposal={definition:candidate,layerId:action.owner.layerId};actionError='';status='Unapplied node position. Picks retain original sampled artwork.';paint();}catch(cause){actionFailure(cause);}}
  function promoteNode(){try{const action=nodeAction();promote(action.owner,action.prepare,action.verify);}catch(cause){actionFailure(cause);}}
  let waypointCanvas=$state(false),waypointPolicy=0,waypointAuthor=$state(false),waypointReleasePolicy=0;
  function changeWaypointAuthor(enabled:boolean){stopWaypointDraft();waypointReleasePolicy++;waypointAuthor=enabled;}
  let groupWaypoints=$state.raw<{owner:GroupOwner;pick:string;origin:Point;path:MotionPath&{waypoints:readonly Point[]}}>(),groupWaypoint=$state.raw<{route:NonNullable<typeof groupWaypoints>;index:number;point:Point}>(),waypointNumber=$state<number|undefined>(),waypointX=$state<number|undefined>(),waypointY=$state<number|undefined>(),waypointRevision=0;
  const validWaypoint=$derived(!!groupWaypoint&&groupMode&&groupWaypoints===groupWaypoint.route&&groupWaypoint.route.pick===pick&&waypointNumber===groupWaypoint.index+1&&Number.isFinite(waypointX)&&Number.isFinite(waypointY)&&(waypointX!==groupWaypoint.point.x||waypointY!==groupWaypoint.point.y));
  function chooseGroupWaypoints(){
    cancelInteraction();waypointCanvas=false;waypointPolicy++;discardProposal();groupWaypoints=undefined;groupWaypoint=undefined;waypointNumber=undefined;waypointX=undefined;waypointY=undefined;waypointRevision++;groupTrajectory=undefined;groupPivot=undefined;groupPivotCanvas=false;pivotCanvas=false;nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;
    try{if(!capture||!capturedDefinition||!groupMode)throw Error('Choose one complete original sampled group.');const admission=prepareAction(),originalCapture=capture,originalPick=pick,owner=originalCapture.resolveGroup(admission.owner.layerId,admission.owner.shapeId),span=symbolLayers(capturedDefinition).find(l=>l.id===owner.layerId)!.motionSpans!.find(s=>s.id===owner.spanId)!,path=structuredClone(span.path);
      if(!path?.waypoints?.length)throw Error('Choose an original saved waypoint path. Cubic routes are not converted.');
      if(path.tangent||span.rotation?.savedGroupPivots||span.rotation?.rigidPivot)throw Error('Group tangent or custom-pivot trajectories require separate orbit admission.');
      admission.verify();if(capture!==originalCapture||pick!==originalPick||!groupMode)throw Error('The original saved waypoint route changed.');const leader=symbolLayers(capturedDefinition).find(l=>l.id===owner.layerId)!.keys.find(k=>k.frame===owner.start)!.shapes[0];groupWaypoints={owner,pick,origin:{x:leader.x,y:leader.y},path:path as MotionPath&{waypoints:readonly Point[]}};paint();
    }catch(cause){actionFailure(cause);}
  }
  function waypointIndexInput(event:Event){const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);cancelInteraction();discardProposal();waypointRevision++;groupWaypoint=undefined;waypointNumber=n;waypointX=undefined;waypointY=undefined;
    const route=groupWaypoints;if(!route||!groupMode||route.pick!==pick||n===undefined||!Number.isSafeInteger(n)||n<1||n>route.path.waypoints.length){if(value!=='')actionError='Choose an original saved waypoint number.';input.value=value;return;}
    const index=n-1,point={...route.path.waypoints[index]};groupWaypoint={route,index,point};waypointX=point.x;waypointY=point.y;input.value=value;
  }
  function waypointInput(axis:'x'|'y',event:Event){const input=event.currentTarget as HTMLInputElement,value=input.value;cancelInteraction();discardProposal();waypointRevision++;if(axis==='x')waypointX=value===''?undefined:Number(value);else waypointY=value===''?undefined:Number(value);input.value=value;}
  function groupWaypointAction(release?:WaypointDrag){
    const selection=groupWaypoint,x=waypointX,y=waypointY,revision=waypointRevision,originalCapture=capture,gesture=release??waypointDrag;
    if(!selection||!validWaypoint||!originalCapture)throw Error('Choose an original waypoint and finite changed offsets.');
    const verifyInputs=()=>{validateSource();if(gesture)assertWaypointInputs(gesture,!release);if(!alive||!groupMode||capture!==originalCapture||pick!==selection.route.pick||groupWaypoints!==selection.route||groupWaypoint!==selection||waypointNumber!==selection.index+1||waypointX!==x||waypointY!==y||waypointRevision!==revision||press||drag||failure)throw Error('The original symbol waypoint, index or target changed.');};
    const verify=()=>{verifyInputs();const actual=JSON.stringify(originalCapture.resolveGroup(selection.route.owner.layerId,selection.route.owner.shapeId)),expected=JSON.stringify(selection.route.owner);verifyInputs();if(actual!==expected)throw Error('The original waypoint membership changed.');};
    const prepare=()=>{verify();const path={...selection.route.path,waypoints:selection.route.path.waypoints.map((point,index)=>index===selection.index?{x:x??NaN,y:y??NaN}:point)};let candidate:SymbolDefinition;preparingTrajectory=true;try{candidate=originalCapture.prepareGroupTrajectory(selection.route.owner.layerId,selection.route.owner.shapeId,path,{validate:verifyInputs});}finally{finishTrajectoryPreparation();}verify();return candidate;};verify();return {owner:selection.route.owner,verify,prepare};
  }
  function previewGroupWaypoint(){try{const action=groupWaypointAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();proposal={definition:candidate,layerId:action.owner.layerId,waypoint:{selection:groupWaypoint!,x:waypointX,y:waypointY}};actionError='';status='Unapplied saved waypoint position. Picks retain original sampled artwork.';paint();}catch(cause){actionFailure(cause);}}
  function commitGroupWaypoint(){try{const action=groupWaypointAction();promote(action.owner,action.prepare,action.verify);}catch(cause){actionFailure(cause);}}
  let rootWaypointCanvas=$state(false),rootWaypointPolicy=0,rootWaypointAuthor=$state(false),rootWaypointReleasePolicy=0;
  function changeRootWaypointAuthor(enabled:boolean){stopRootWaypointDraft();rootWaypointReleasePolicy++;rootWaypointAuthor=enabled;}
  let rootWaypoints=$state.raw<{owner:Owner;pick:string;origin:Point;path:MotionPath&{waypoints:readonly Point[]}}>(),rootWaypoint=$state.raw<{route:NonNullable<typeof rootWaypoints>;index:number;point:Point}>(),rootWaypointNumber=$state<number|undefined>(),rootWaypointX=$state<number|undefined>(),rootWaypointY=$state<number|undefined>(),rootWaypointRevision=0;
  const validRootWaypoint=$derived(!!rootWaypoint&&!groupMode&&rootWaypoints===rootWaypoint.route&&rootWaypoint.route.pick===pick&&rootWaypointNumber===rootWaypoint.index+1&&Number.isFinite(rootWaypointX)&&Number.isFinite(rootWaypointY)&&(rootWaypointX!==rootWaypoint.point.x||rootWaypointY!==rootWaypoint.point.y));
  function chooseRootWaypoints(){
    cancelInteraction();rootWaypointCanvas=false;rootWaypointPolicy++;discardProposal();rootWaypoints=undefined;rootWaypoint=undefined;rootWaypointNumber=undefined;rootWaypointX=undefined;rootWaypointY=undefined;rootWaypointRevision++;rootTrajectory=undefined;rootWaypoints=undefined;groupPivotCanvas=false;pivotCanvas=false;nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;
    try{if(!capture||!capturedDefinition||groupMode)throw Error('Choose one original sampled root.');const admission=prepareAction(),originalCapture=capture,originalPick=pick,owner=originalCapture.resolveTrajectory(admission.owner.layerId,admission.owner.shapeId),span=symbolLayers(capturedDefinition).find(l=>l.id===owner.layerId)!.motionSpans!.find(s=>s.id===owner.spanId)!,path=structuredClone(span.path);
      if(!path?.waypoints?.length)throw Error('Choose an original saved waypoint path. Cubic routes are not converted.');
      if(path.tangent||span.rotation?.savedGroupPivots||span.rotation?.rigidPivot)throw Error('Root tangent or custom-pivot trajectories require separate orbit admission.');
      admission.verify();if(capture!==originalCapture||pick!==originalPick||groupMode)throw Error('The original saved waypoint route changed.');const leader=symbolLayers(capturedDefinition).find(l=>l.id===owner.layerId)!.keys.find(k=>k.frame===owner.start)!.shapes[0];rootWaypoints={owner,pick,origin:{x:leader.x,y:leader.y},path:path as MotionPath&{waypoints:readonly Point[]}};paint();
    }catch(cause){actionFailure(cause);}
  }
  function rootWaypointIndexInput(event:Event){const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);cancelInteraction();discardProposal();rootWaypointRevision++;rootWaypoint=undefined;rootWaypointNumber=n;rootWaypointX=undefined;rootWaypointY=undefined;
    const route=rootWaypoints;if(!route||groupMode||route.pick!==pick||n===undefined||!Number.isSafeInteger(n)||n<1||n>route.path.waypoints.length){if(value!=='')actionError='Choose an original saved waypoint number.';input.value=value;return;}
    const index=n-1,point={...route.path.waypoints[index]};rootWaypoint={route,index,point};rootWaypointX=point.x;rootWaypointY=point.y;input.value=value;
  }
  function rootWaypointInput(axis:'x'|'y',event:Event){const input=event.currentTarget as HTMLInputElement,value=input.value;cancelInteraction();discardProposal();rootWaypointRevision++;if(axis==='x')rootWaypointX=value===''?undefined:Number(value);else rootWaypointY=value===''?undefined:Number(value);input.value=value;}
  function rootWaypointAction(release?:RootWaypointDrag){
    const selection=rootWaypoint,x=rootWaypointX,y=rootWaypointY,revision=rootWaypointRevision,originalCapture=capture,gesture=release??rootWaypointDrag;
    if(!selection||!validRootWaypoint||!originalCapture)throw Error('Choose an original waypoint and finite changed offsets.');
    const verifyInputs=()=>{validateSource();if(gesture)assertRootWaypointInputs(gesture,!release);if(!alive||groupMode||capture!==originalCapture||pick!==selection.route.pick||rootWaypoints!==selection.route||rootWaypoint!==selection||rootWaypointNumber!==selection.index+1||rootWaypointX!==x||rootWaypointY!==y||rootWaypointRevision!==revision||press||drag||failure)throw Error('The original symbol waypoint, index or target changed.');};
    const verify=()=>{verifyInputs();const actual=JSON.stringify(originalCapture.resolveTrajectory(selection.route.owner.layerId,selection.route.owner.shapeId)),expected=JSON.stringify(selection.route.owner);verifyInputs();if(actual!==expected)throw Error('The original waypoint membership changed.');};
    const prepare=()=>{verify();const path={...selection.route.path,waypoints:selection.route.path.waypoints.map((point,index)=>index===selection.index?{x:x??NaN,y:y??NaN}:point)};let candidate:SymbolDefinition;preparingTrajectory=true;try{candidate=originalCapture.prepareTrajectory(selection.route.owner.layerId,selection.route.owner.shapeId,path,{validate:verifyInputs});}finally{finishTrajectoryPreparation();}verify();return candidate;};verify();return {owner:selection.route.owner,verify,prepare};
  }
  function previewRootWaypoint(){try{const action=rootWaypointAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();proposal={definition:candidate,layerId:action.owner.layerId,rootWaypoint:{selection:rootWaypoint!,x:rootWaypointX,y:rootWaypointY}};actionError='';status='Unapplied saved waypoint position. Picks retain original sampled artwork.';paint();}catch(cause){actionFailure(cause);}}
  function commitRootWaypoint(){try{const action=rootWaypointAction();promote(action.owner,action.prepare,action.verify);}catch(cause){actionFailure(cause);}}
  type TrajectoryControls={startX:number|undefined;startY:number|undefined;endX:number|undefined;endY:number|undefined};
  let rootCurveCanvas=$state(false),rootCurvePolicy=0,rootCurvePart=$state<'start'|'end'>('start'),rootCurveAuthor=$state(false),rootCurveReleasePolicy=0;
  function changeRootCurveAuthor(enabled:boolean){stopRootCurveDraft();rootCurveReleasePolicy++;rootCurveAuthor=enabled;}
  function changeRootCurveCanvas(enabled:boolean){cancelInteraction();rootCurvePolicy++;rootCurveCanvas=enabled;if(proposal?.rootTrajectory?.policy!==undefined)discardProposal();paint();}
  function changeRootCurvePart(value:string){cancelInteraction();rootTrajectoryRevision++;rootCurvePart=value==='end'?'end':'start';discardProposal();paint();}
  let rootTrajectory=$state.raw<{owner:Owner;pick:string;path:MotionPath;start:Point;end:Point}>(),rootTrajectoryControls=$state.raw<TrajectoryControls>({startX:undefined,startY:undefined,endX:undefined,endY:undefined}),rootTrajectoryRevision=0;
  const validRootTrajectory=$derived(!!rootTrajectory&&!groupMode&&rootTrajectory.pick===pick&&Object.values(rootTrajectoryControls).every(Number.isFinite)&&JSON.stringify({...rootTrajectory.path,...rootTrajectoryControls})!==JSON.stringify(rootTrajectory.path));
  function chooseRootTrajectory(){
    cancelInteraction();rootCurveCanvas=false;rootCurvePolicy++;discardProposal();rootTrajectory=undefined;rootWaypoints=undefined;rootTrajectoryRevision++;groupPivotCanvas=false;pivotCanvas=false;nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;
    try{if(!capture||!capturedDefinition||groupMode)throw Error('Choose one original sampled root.');const admission=prepareAction(),originalCapture=capture,originalPick=pick,owner=originalCapture.resolveTrajectory(admission.owner.layerId,admission.owner.shapeId),span=symbolLayers(capturedDefinition).find(l=>l.id===owner.layerId)!.motionSpans!.find(s=>s.id===owner.spanId)!,path=structuredClone(span.path??{startX:0,startY:0,endX:0,endY:0});
      if(path.waypoints!==undefined||path.waypointTangents!==undefined||path.waypointIncoming!==undefined||path.curvedWaypoints===true)throw Error('Use a waypoint editor for this saved trajectory. Cubic controls cannot replace its waypoint data.');
      if(path.tangent||span.rotation?.savedGroupPivots||span.rotation?.rigidPivot)throw Error('Root tangent or custom-pivot trajectories require separate orbit admission.');
      admission.verify();if(capture!==originalCapture||pick!==originalPick||groupMode)throw Error('The original root trajectory changed.');const track=symbolLayers(capturedDefinition).find(l=>l.id===owner.layerId)!,a=track.keys.find(k=>k.frame===owner.start)!.shapes.find(s=>s.id===owner.shapeId)!,b=track.keys.find(k=>k.frame===owner.end)!.shapes.find(s=>s.id===owner.shapeId)!;rootTrajectory={owner,pick,path,start:{x:a.x,y:a.y},end:{x:b.x,y:b.y}};rootTrajectoryControls={startX:path.startX,startY:path.startY,endX:path.endX,endY:path.endY};paint();
    }catch(cause){actionFailure(cause);}
  }
  function rootTrajectoryInput(field:keyof TrajectoryControls,event:Event){const input=event.currentTarget as HTMLInputElement,value=input.value;cancelInteraction();discardProposal();rootTrajectoryRevision++;rootTrajectoryControls={...rootTrajectoryControls,[field]:value===''?undefined:Number(value)};input.value=value;}
  function rootTrajectoryAction(release?:RootCurveDrag){
    const selection=rootTrajectory,controls=rootTrajectoryControls,revision=rootTrajectoryRevision,originalCapture=capture,gesture=release??rootCurveDrag;
    if(!selection||!validRootTrajectory||!originalCapture)throw Error('Enter finite changed cubic root trajectory controls.');
    // The API prohibits reentry: its callback checks inputs/enclosing source only.
    const verifyInputs=()=>{validateSource();if(gesture)assertRootCurveInputs(gesture,!release);if(!alive||groupMode||capture!==originalCapture||pick!==selection.pick||rootTrajectory!==selection||rootTrajectoryControls!==controls||rootTrajectoryRevision!==revision||press||drag||failure)throw Error('The original sampled symbol trajectory or controls changed.');};
    const verify=()=>{verifyInputs();const actual=JSON.stringify(originalCapture.resolveTrajectory(selection.owner.layerId,selection.owner.shapeId)),expected=JSON.stringify(selection.owner);verifyInputs();if(actual!==expected)throw Error('The original trajectory membership changed.');};
    const prepare=()=>{verify();let candidate:SymbolDefinition;preparingTrajectory=true;try{candidate=originalCapture.prepareTrajectory(selection.owner.layerId,selection.owner.shapeId,{...selection.path,...controls} as MotionPath,{validate:verifyInputs});}finally{finishTrajectoryPreparation();}verify();return candidate;};verify();return {owner:selection.owner,verify,prepare};
  }
  function previewRootTrajectory(){try{const action=rootTrajectoryAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();proposal={definition:candidate,layerId:action.owner.layerId,rootTrajectory:{selection:rootTrajectory!,controls:rootTrajectoryControls}};actionError='';status='Unapplied root trajectory. Picks retain original sampled artwork.';paint();}catch(cause){actionFailure(cause);}}
  function commitRootTrajectory(){try{const action=rootTrajectoryAction();promote(action.owner,action.prepare,action.verify);}catch(cause){actionFailure(cause);}}
  let groupCurveCanvas=$state(false),groupCurvePolicy=0,groupCurvePart=$state<'start'|'end'>('start'),groupCurveAuthor=$state(false),groupCurveReleasePolicy=0;
  function changeGroupCurveAuthor(enabled:boolean){stopGroupCurveDraft();groupCurveReleasePolicy++;groupCurveAuthor=enabled;}
  function changeGroupCurveCanvas(enabled:boolean){cancelInteraction();groupCurvePolicy++;groupCurveCanvas=enabled;if(proposal?.trajectory?.policy!==undefined)discardProposal();paint();}
  function changeGroupCurvePart(value:string){cancelInteraction();trajectoryRevision++;groupCurvePart=value==='end'?'end':'start';discardProposal();paint();}
  let groupTrajectory=$state.raw<{owner:GroupOwner;pick:string;path:MotionPath;leaderId:string;start:Point;end:Point}>(),trajectoryControls=$state.raw<TrajectoryControls>({startX:undefined,startY:undefined,endX:undefined,endY:undefined}),trajectoryRevision=0,preparingTrajectory=false,trajectoryRepaintPending=false;
  const validTrajectory=$derived(!!groupTrajectory&&groupMode&&groupTrajectory.pick===pick&&Object.values(trajectoryControls).every(Number.isFinite)&&JSON.stringify({...groupTrajectory.path,...trajectoryControls})!==JSON.stringify(groupTrajectory.path));
  function chooseGroupTrajectory(){
    groupWaypoints=undefined;cancelInteraction();groupCurveCanvas=false;groupCurvePolicy++;discardProposal();groupTrajectory=undefined;trajectoryRevision++;groupPivot=undefined;groupPivotCanvas=false;pivotCanvas=false;nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;
    try{if(!capture||!capturedDefinition||!groupMode)throw Error('Choose one complete original sampled group.');const admission=prepareAction(),originalCapture=capture,originalPick=pick,owner=originalCapture.resolveGroup(admission.owner.layerId,admission.owner.shapeId),span=symbolLayers(capturedDefinition).find(l=>l.id===owner.layerId)!.motionSpans!.find(s=>s.id===owner.spanId)!,path=structuredClone(span.path??{startX:0,startY:0,endX:0,endY:0});
      if(path.waypoints!==undefined||path.waypointTangents!==undefined||path.waypointIncoming!==undefined||path.curvedWaypoints!==undefined)throw Error('Use a waypoint editor for this saved trajectory. Cubic controls cannot replace its waypoint data.');
      if(path.tangent||span.rotation?.savedGroupPivots||span.rotation?.rigidPivot)throw Error('Group tangent or custom-pivot trajectories require separate orbit admission.');
      admission.verify();if(capture!==originalCapture||pick!==originalPick||!groupMode)throw Error('The original group trajectory changed.');const track=symbolLayers(capturedDefinition).find(l=>l.id===owner.layerId)!,a=track.keys.find(k=>k.frame===owner.start)!.shapes[0],b=track.keys.find(k=>k.frame===owner.end)!.shapes[0];groupTrajectory={owner,pick,path,leaderId:a.id,start:{x:a.x,y:a.y},end:{x:b.x,y:b.y}};trajectoryControls={startX:path.startX,startY:path.startY,endX:path.endX,endY:path.endY};paint();
    }catch(cause){actionFailure(cause);}
  }
  function trajectoryInput(field:keyof TrajectoryControls,event:Event){const input=event.currentTarget as HTMLInputElement,value=input.value;cancelInteraction();discardProposal();trajectoryRevision++;trajectoryControls={...trajectoryControls,[field]:value===''?undefined:Number(value)};input.value=value;}
  function groupTrajectoryAction(release?:GroupCurveDrag){
    const selection=groupTrajectory,controls=trajectoryControls,revision=trajectoryRevision,originalCapture=capture,gesture=release??groupCurveDrag;
    if(!selection||!validTrajectory||!originalCapture)throw Error('Enter finite changed cubic group trajectory controls.');
    // The API prohibits reentry: its callback checks inputs/enclosing source only.
    const verifyInputs=()=>{validateSource();if(gesture)assertGroupCurveInputs(gesture,!release);if(!alive||!groupMode||capture!==originalCapture||pick!==selection.pick||groupTrajectory!==selection||trajectoryControls!==controls||trajectoryRevision!==revision||press||drag||failure)throw Error('The original sampled symbol trajectory or controls changed.');};
    const verify=()=>{verifyInputs();const actual=JSON.stringify(originalCapture.resolveGroup(selection.owner.layerId,selection.owner.shapeId)),expected=JSON.stringify(selection.owner);verifyInputs();if(actual!==expected)throw Error('The original trajectory membership changed.');};
    const prepare=()=>{verify();let candidate:SymbolDefinition;preparingTrajectory=true;try{candidate=originalCapture.prepareGroupTrajectory(selection.owner.layerId,selection.owner.shapeId,{...selection.path,...controls} as MotionPath,{validate:verifyInputs});}finally{finishTrajectoryPreparation();}verify();return candidate;};verify();return {owner:selection.owner,verify,prepare};
  }
  function previewGroupTrajectory(){try{const action=groupTrajectoryAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();proposal={definition:candidate,layerId:action.owner.layerId,trajectory:{selection:groupTrajectory!,controls:trajectoryControls}};actionError='';status='Unapplied group trajectory. Picks retain original sampled artwork.';paint();}catch(cause){actionFailure(cause);}}
  function commitGroupTrajectory(){try{const action=groupTrajectoryAction();promote(action.owner,action.prepare,action.verify);}catch(cause){actionFailure(cause);}}
  let groupPivotCanvas=$state(false),groupPivotPolicy=0,groupPivotAuthor=$state(false),groupPivotReleasePolicy=0;
  function changeGroupPivotAuthor(enabled:boolean){stopGroupPivotDraft();groupPivotReleasePolicy++;groupPivotAuthor=enabled;}
  let groupPivot=$state.raw<{owner:GroupOwner;pick:string;point:Point;shared:boolean}>(),groupPivotX=$state<number|undefined>(),groupPivotY=$state<number|undefined>();
  const validGroupPivot=$derived(!!groupPivot&&groupMode&&groupPivot.pick===pick&&Number.isFinite(groupPivotX)&&Number.isFinite(groupPivotY)&&(!groupPivot.shared||groupPivotX!==groupPivot.point.x||groupPivotY!==groupPivot.point.y));
  $effect(()=>{if(groupPivot&&(!groupMode||groupPivot.pick!==pick)){groupPivot=undefined;groupPivotX=undefined;groupPivotY=undefined;groupPivotCanvas=false;}});
  function chooseGroupPivot(){
    groupWaypoints=undefined;groupTrajectory=undefined;cancelInteraction();groupPivotCanvas=false;discardProposal();groupPivot=undefined;groupPivotX=undefined;groupPivotY=undefined;
    pivotCanvas=false;nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;
    try{if(!capture||!groupMode)throw Error('Choose one complete original sampled group.');const admission=prepareAction(),originalCapture=capture,originalPick=pick,owner=originalCapture.resolveGroup(admission.owner.layerId,admission.owner.shapeId),members=originalCapture.scene.find(t=>t.layerId===owner.layerId)!.key.shapes.filter(s=>owner.shapeIds.includes(s.id)),point=rememberedAuthoringPivot(members),shared=members.every(s=>{const p=rememberedAuthoringPivot([s]);return p.x===point.x&&p.y===point.y;});admission.verify();if(capture!==originalCapture||pick!==originalPick||!groupMode)throw Error('The original group pivot changed.');groupPivot={owner,pick,point,shared};groupPivotX=point.x;groupPivotY=point.y;paint();}catch(cause){actionFailure(cause);}
  }
  function groupPivotInput(event:Event,axis:'x'|'y'){const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);cancelInteraction();groupPivotInputRevision++;groupPivotInputAxes[axis]++;discardProposal();if(axis==='x')groupPivotX=n;else groupPivotY=n;input.value=value;}
  function groupPivotAction(){
    if(!groupPivot||!validGroupPivot||!groupMode)throw Error('Choose an original complete group and finite changed pivot.');
    const selection=groupPivot,x=groupPivotX!,y=groupPivotY!,gesture=groupPivotDrag,target=gesture?.previewTarget,inputRevision=groupPivotInputRevision,at=frame,admission=prepareAction(),originalCapture=capture!,owner=originalCapture.resolveGroup(admission.owner.layerId,admission.owner.shapeId);
    const verifyInputs=()=>{validateSource();if(gesture)assertGroupPivotInputs(gesture);if(!alive||failure||press||drag||capture!==originalCapture||frame!==at||groupPivot!==selection||pick!==selection.pick||!groupMode||groupPivotX!==x||groupPivotY!==y||groupPivotInputRevision!==inputRevision||(gesture&&gesture.previewTarget!==target))throw Error('Sampled symbol pivot or target changed.');};
    const verify=()=>{admission.verify();verifyInputs();const actual=JSON.stringify(originalCapture.resolveGroup(owner.layerId,owner.shapeId)),expected=JSON.stringify(selection.owner);verifyInputs();if(actual!==expected)throw Error('The original sampled pivot owner changed.');};
    const prepare=()=>{verify();let candidate:SymbolDefinition;preparingPivot=true;try{candidate=originalCapture.prepareGroupPivotPosition(owner.layerId,owner.shapeId,{x,y},{validate:verifyInputs});}finally{preparingPivot=false;}verify();return candidate;};verify();return {owner,verify,prepare};
  }
  function previewGroupPivot(){try{const action=groupPivotAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();proposal={definition:candidate,layerId:action.owner.layerId,groupPivotPoint:{x:groupPivotX!,y:groupPivotY!}};actionError='';status='Unapplied group pivot position. Artwork remains fixed.';paint();}catch(cause){actionFailure(cause);}}
  function promoteGroupPivot(){try{const action=groupPivotAction();promote(action.owner,action.prepare,action.verify);}catch(cause){actionFailure(cause);}}
  let pivot=$state.raw<{owner:Owner;pick:string;point:Point}>(),pivotX=$state<number|undefined>(),pivotY=$state<number|undefined>();
  const validPivot=$derived(!!pivot&&pivot.pick===pick&&!groupMode&&Number.isFinite(pivotX)&&Number.isFinite(pivotY)&&(pivotX!==pivot.point.x||pivotY!==pivot.point.y));
  function choosePivot(){rootTrajectory=undefined;rootWaypoints=undefined;
    cancelInteraction();discardProposal();pivot=undefined;pivotX=undefined;pivotY=undefined;pivotCanvas=false;
    nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;
    try{if(!capture||groupMode)throw Error('Choose one original sampled root pivot.');const admission=prepareAction(),originalCapture=capture,owner=originalCapture.resolve(admission.owner.layerId,admission.owner.shapeId),originalPick=pick;
      const shape=originalCapture.scene.find(t=>t.layerId===owner.layerId)!.key.shapes.find(s=>s.id===owner.shapeId)!,point=rememberedAuthoringPivot([shape]);admission.verify();if(capture!==originalCapture||pick!==originalPick||groupMode)throw Error('The original sampled pivot changed.');pivot={owner,pick,point};pivotX=point.x;pivotY=point.y;paint();
    }catch(cause){actionFailure(cause);}
  }
  function pivotInput(event:Event,axis:'x'|'y'){const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);cancelInteraction();pivotInputRevision++;pivotInputAxes[axis]++;discardProposal();if(axis==='x')pivotX=n;else pivotY=n;input.value=value;}
  function pivotAction(){
    if(!pivot||!validPivot||groupMode||nodeDrag||tangentDrag||compoundDrag||compoundNodeDrag)throw Error('Choose an original pivot and changed finite document coordinates.');
    const selection=pivot,x=pivotX!,y=pivotY!,gesture=pivotDrag,target=gesture?.previewTarget,inputRevision=pivotInputRevision,at=frame,admission=prepareAction(),originalCapture=capture!,owner=originalCapture.resolve(admission.owner.layerId,admission.owner.shapeId);
    const verifyInputs=()=>{validateSource();if(gesture)assertPivotInputs(gesture);if(!alive||failure||press||drag||capture!==originalCapture||frame!==at||pivot!==selection||pick!==selection.pick||groupMode||pivotX!==x||pivotY!==y||pivotInputRevision!==inputRevision||(gesture&&gesture.previewTarget!==target))throw Error('Sampled symbol pivot or target changed.');};
    const verify=()=>{admission.verify();verifyInputs();const actual=JSON.stringify(originalCapture.resolve(owner.layerId,owner.shapeId)),expected=JSON.stringify(selection.owner);verifyInputs();if(actual!==expected)throw Error('The original sampled pivot owner changed.');};
    const prepare=()=>{verify();let candidate:SymbolDefinition;preparingPivot=true;try{candidate=originalCapture.preparePivotPosition(owner.layerId,owner.shapeId,{x,y},{validate:verifyInputs});}finally{preparingPivot=false;}verify();return candidate;};verify();return {owner,verify,prepare};
  }
  function previewPivot(){try{const action=pivotAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();proposal={definition:candidate,layerId:action.owner.layerId,pivotPoint:{x:pivotX!,y:pivotY!}};actionError='';status='Unapplied pivot position. Artwork remains fixed.';paint();}catch(cause){actionFailure(cause);}}
  function promotePivot(){try{const action=pivotAction();promote(action.owner,action.prepare,action.verify);}catch(cause){actionFailure(cause);}}
  let tangent=$state.raw<{selection:NonNullable<typeof node>;owner:TangentOwner;point:Point}>(),tangentX=$state<number|undefined>(),tangentY=$state<number|undefined>();
  let tangentCoupled=$state(false),tangentCouplingRevision=0;
  function changeTangentCoupling(enabled:boolean){cancelInteraction();tangentCouplingRevision++;tangentCoupled=enabled;tangentCanvas=false;tangentPolicy++;discardProposal();paint();}
  function changeTangentCanvas(enabled:boolean){if(enabled)rootTrajectory=undefined;rootWaypoints=undefined;if(enabled&&tangentCoupled&&tangentParts.length!==2)return;tangentPolicy++;cancelInteraction();tangentCanvas=enabled;if(enabled){pivotCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;nodeCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;}paint();}
  const tangentParts=$derived(node&&!nodeShape?.contours?.length?(['in','out']as const).filter(part=>!!nodeShape?.nodes?.[node!.owner.nodeIndex]?.[part]):[]);
  const validTangent=$derived(!!tangent&&(!tangentCoupled||tangentParts.length===2)&&tangent.selection===node&&Number.isFinite(tangentX)&&Number.isFinite(tangentY)&&(tangentX!==tangent.point.x||tangentY!==tangent.point.y));
  $effect(()=>{if(tangent&&tangent.selection!==node){tangent=undefined;tangentX=undefined;tangentY=undefined;}});
  function chooseTangent(part:string){rootTrajectory=undefined;rootWaypoints=undefined;
    cancelInteraction();discardProposal();tangent=undefined;tangentX=undefined;tangentY=undefined;
    if(!node||!capture||groupMode||!tangentParts.includes(part as 'in'|'out'))return;
    try{const selection=node,owner=capture.resolveTangent(node.owner.layerId,node.owner.shapeId,node.owner.nodeIndex,part as 'in'|'out'),shape=pickedView()!.shape,point=worldPoint(shape,shape.nodes![owner.nodeIndex][owner.part]!);validateSource();if(node!==selection)throw Error('The sampled symbol node changed.');tangent={selection,owner,point};tangentX=point.x;tangentY=point.y;paint();}catch(cause){actionFailure(cause);}
  }
  function tangentInput(event:Event,axis:'x'|'y'){const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);cancelInteraction();tangentInputRevision++;tangentInputAxes[axis]++;discardProposal();if(axis==='x')tangentX=n;else tangentY=n;input.value=value;}
  function tangentAction(){
    if(!tangent||!validTangent||groupMode||nodeDrag)throw Error('Choose an existing original tangent and a changed finite position.');
    const selection=tangent,x=tangentX!,y=tangentY!,coupled=tangentCoupled,couplingRevision=tangentCouplingRevision,gesture=tangentDrag,target=gesture?.previewTarget,inputRevision=tangentInputRevision,at=frame,admission=prepareAction(),originalCapture=capture!,owner=originalCapture.resolveTangent(admission.owner.layerId,admission.owner.shapeId,selection.owner.nodeIndex,selection.owner.part);
    const verifyInputs=()=>{validateSource();if(gesture)assertTangentInputs(gesture);if(!alive||failure||press||drag||capture!==originalCapture||frame!==at||tangent!==selection||node!==selection.selection||pick!==selection.selection.pick||groupMode||nodeDrag||tangentX!==x||tangentY!==y||tangentInputRevision!==inputRevision||tangentCoupled!==coupled||tangentCouplingRevision!==couplingRevision||(gesture&&gesture.previewTarget!==target))throw Error('Sampled symbol tangent or target changed.');};
    const verify=()=>{admission.verify();verifyInputs();const actual=JSON.stringify(originalCapture.resolveTangent(owner.layerId,owner.shapeId,owner.nodeIndex,owner.part)),expected=JSON.stringify(selection.owner);verifyInputs();if(actual!==expected)throw Error('The original sampled tangent owner changed.');};
    const prepare=()=>{verify();let candidate:SymbolDefinition;preparingTangent=true;try{candidate=originalCapture.prepareTangentPosition(owner.layerId,owner.shapeId,owner.nodeIndex,owner.part,{x,y},{validate:verifyInputs,coupled});}finally{preparingTangent=false;if(tangentRepaintPending){tangentRepaintPending=false;paint();}}verify();return candidate;};verify();return {owner,verify,prepare};
  }
  function previewTangent(){try{const action=tangentAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();proposal={definition:candidate,layerId:action.owner.layerId};actionError='';status='Unapplied tangent position. Picks retain original sampled artwork.';paint();}catch(cause){actionFailure(cause);}}
  function promoteTangent(){try{const action=tangentAction();promote(action.owner,action.prepare,action.verify);}catch(cause){actionFailure(cause);}}
  let compoundContour=$state<number|undefined>(),compoundNode=$state<number|undefined>();
  let compound=$state.raw<{owner:CompoundOwner;pick:string;point:Point}>(),compoundX=$state<number|undefined>(),compoundY=$state<number|undefined>();
  let compoundCoupled=$state(false),compoundRevision=0;
  const compoundShape=$derived(nodeShape?.kind==='polygon'&&nodeShape.fillRule==='evenodd'&&nodeShape.contours?.length?nodeShape:undefined);
  const compoundRing=$derived(compoundContour===undefined?undefined:compoundShape?.contours?.[compoundContour-1]);
  const compoundAnchor=$derived(compoundNode===undefined?undefined:compoundRing?.[compoundNode-1]);
  const compoundParts=$derived((['in','out']as const).filter(part=>!!compoundAnchor?.[part]));
  const validCompound=$derived(!!compound&&(!compoundCoupled||compoundParts.length===2)&&Number.isFinite(compoundX)&&Number.isFinite(compoundY)&&(compoundX!==compound.point.x||compoundY!==compound.point.y));
  let anchorContour=$state<number|undefined>(),anchorIndex=$state<number|undefined>();
  let compoundNodeSelection=$state.raw<{owner:CompoundNodeOwner;pick:string;point:Point}>(),anchorX=$state<number|undefined>(),anchorY=$state<number|undefined>();
  const anchorRing=$derived(anchorContour===undefined?undefined:compoundShape?.contours?.[anchorContour-1]);
  const validCompoundNode=$derived(!!compoundNodeSelection&&Number.isFinite(anchorX)&&Number.isFinite(anchorY)&&(anchorX!==compoundNodeSelection.point.x||anchorY!==compoundNodeSelection.point.y));
  function compoundAnchorIndex(axis:'contour'|'node',value:string){
    cancelInteraction();compoundCanvas=false;discardProposal();compoundNodeSelection=undefined;anchorX=undefined;anchorY=undefined;
    const n=value===''?undefined:Number(value);if(axis==='contour'){anchorContour=n;anchorIndex=undefined;}else anchorIndex=n;
    if(n!==undefined&&(!Number.isSafeInteger(n)||n<1||(axis==='contour'?!compoundShape?.contours?.[n-1]:!anchorRing?.[n-1]))){actionError='Choose an original compound contour and anchor.';return;}
    if(anchorContour===undefined||anchorIndex===undefined||!capture||groupMode)return;
    try{const selected=pickedView();if(!selected)throw Error('Choose original sampled artwork.');const originalPick=pick,ci=anchorContour-1,ni=anchorIndex-1,originalCapture=capture,owner=originalCapture.resolveCompoundNode(selected.owner.layerId,selected.owner.shapeId,ci,ni),point=worldPoint(selected.shape,selected.shape.contours![ci][ni]);validateSource();if(capture!==originalCapture||pick!==originalPick||groupMode||anchorContour!==ci+1||anchorIndex!==ni+1)throw Error('The compound anchor selection changed.');compoundNodeSelection={owner,pick,point};anchorX=point.x;anchorY=point.y;paint();}catch(cause){actionFailure(cause);}
  }
  function compoundAnchorInput(event:Event,axis:'x'|'y'){const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);cancelInteraction();compoundNodeInputRevision++;compoundNodeInputAxes[axis]++;discardProposal();if(axis==='x')anchorX=n;else anchorY=n;input.value=value;}
  function compoundNodeAction(){
    if(!compoundNodeSelection||!validCompoundNode||groupMode||nodeDrag||tangentDrag||compoundDrag)throw Error('Choose an original compound anchor and a changed finite position.');
    const selection=compoundNodeSelection,x=anchorX!,y=anchorY!,gesture=compoundNodeDrag,target=gesture?.previewTarget,inputRevision=compoundNodeInputRevision,at=frame,admission=prepareAction(),originalCapture=capture!,o=selection.owner;
    const owner=originalCapture.resolveCompoundNode(admission.owner.layerId,admission.owner.shapeId,o.contourIndex,o.nodeIndex);
    const verifyInputs=()=>{validateSource();if(gesture)assertCompoundNodeInputs(gesture);if(!alive||failure||press||drag||capture!==originalCapture||frame!==at||compoundNodeSelection!==selection||pick!==selection.pick||groupMode||nodeDrag||tangentDrag||compoundDrag||anchorContour!==o.contourIndex+1||anchorIndex!==o.nodeIndex+1||anchorX!==x||anchorY!==y||compoundNodeInputRevision!==inputRevision||(gesture&&gesture.previewTarget!==target))throw Error('Sampled symbol compound anchor or target changed.');};
    const verify=()=>{admission.verify();verifyInputs();const actual=JSON.stringify(originalCapture.resolveCompoundNode(owner.layerId,owner.shapeId,owner.contourIndex,owner.nodeIndex)),expected=JSON.stringify(o);verifyInputs();if(actual!==expected)throw Error('The original sampled compound anchor owner changed.');};
    const prepare=()=>{verify();let candidate:SymbolDefinition;preparingCompoundNode=true;try{candidate=originalCapture.prepareCompoundNodePosition(owner.layerId,owner.shapeId,owner.contourIndex,owner.nodeIndex,{x,y},{validate:verifyInputs});}finally{preparingCompoundNode=false;if(compoundNodeRepaintPending){compoundNodeRepaintPending=false;paint();}}verify();return candidate;};verify();return {owner,verify,prepare};
  }
  function previewCompoundNode(){try{const action=compoundNodeAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();proposal={definition:candidate,layerId:action.owner.layerId};actionError='';status='Unapplied compound anchor position. Picks retain original sampled artwork.';paint();}catch(cause){actionFailure(cause);}}
  function promoteCompoundNode(){try{const action=compoundNodeAction();promote(action.owner,action.prepare,action.verify);}catch(cause){actionFailure(cause);}}
  function compoundIndex(axis:'contour'|'node',value:string){
    cancelInteraction();discardProposal();compound=undefined;compoundX=undefined;compoundY=undefined;
    const n=value===''?undefined:Number(value);if(axis==='contour'){compoundContour=n;compoundNode=undefined;}else compoundNode=n;
    if(n!==undefined&&(!Number.isSafeInteger(n)||n<1||(axis==='contour'?!compoundShape?.contours?.[n-1]:!compoundRing?.[n-1])))actionError='Choose an original compound contour and node.';
  }
  function chooseCompound(part:string){rootTrajectory=undefined;rootWaypoints=undefined;
    cancelInteraction();discardProposal();compound=undefined;compoundX=undefined;compoundY=undefined;
    if(!capture||groupMode||!compoundParts.includes(part as 'in'|'out'))return;
    try{const selected=pickedView();if(!selected)throw Error('Choose original sampled artwork.');const originalPick=pick,ci=(compoundContour??NaN)-1,ni=(compoundNode??NaN)-1,owner=capture.resolveCompoundTangent(selected.owner.layerId,selected.owner.shapeId,ci,ni,part as 'in'|'out'),point=worldPoint(selected.shape,selected.shape.contours![ci][ni][owner.part]!);validateSource();if(pick!==originalPick||compoundContour!==ci+1||compoundNode!==ni+1)throw Error('The compound selection changed.');compound={owner,pick,point};compoundX=point.x;compoundY=point.y;paint();}catch(cause){actionFailure(cause);}
  }
  function compoundInput(event:Event,axis:'x'|'y'){const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);cancelInteraction();compoundInputRevision++;compoundInputAxes[axis]++;discardProposal();if(axis==='x')compoundX=n;else compoundY=n;input.value=value;}
  function changeCompoundCoupling(enabled:boolean){cancelInteraction();compoundRevision++;compoundCoupled=enabled;discardProposal();}
  function compoundAction(){
    if(!compound||!validCompound||groupMode||nodeDrag||tangentDrag||compoundNodeDrag)throw Error('Choose an original compound handle and a changed finite position.');
    const selection=compound,x=compoundX!,y=compoundY!,gesture=compoundDrag,target=gesture?.previewTarget,inputRevision=compoundInputRevision,at=frame,coupled=compoundCoupled,modeRevision=compoundRevision,admission=prepareAction(),originalCapture=capture!,o=selection.owner;
    const owner=originalCapture.resolveCompoundTangent(admission.owner.layerId,admission.owner.shapeId,o.contourIndex,o.nodeIndex,o.part);
    const verifyInputs=()=>{validateSource();if(gesture)assertCompoundInputs(gesture);if(!alive||failure||press||drag||capture!==originalCapture||frame!==at||compound!==selection||pick!==selection.pick||groupMode||nodeDrag||tangentDrag||compoundNodeDrag||compoundContour!==o.contourIndex+1||compoundNode!==o.nodeIndex+1||compoundX!==x||compoundY!==y||compoundInputRevision!==inputRevision||compoundCoupled!==coupled||compoundRevision!==modeRevision||(gesture&&gesture.previewTarget!==target))throw Error('Sampled symbol compound tangent or target changed.');};
    const verify=()=>{admission.verify();verifyInputs();const actual=JSON.stringify(originalCapture.resolveCompoundTangent(owner.layerId,owner.shapeId,owner.contourIndex,owner.nodeIndex,owner.part)),expected=JSON.stringify(o);verifyInputs();if(actual!==expected)throw Error('The original sampled compound tangent owner changed.');};
    const prepare=()=>{verify();let candidate:SymbolDefinition;preparingCompound=true;try{candidate=originalCapture.prepareCompoundTangentPosition(owner.layerId,owner.shapeId,owner.contourIndex,owner.nodeIndex,owner.part,{x,y},{validate:verifyInputs,coupled});}finally{preparingCompound=false;if(compoundRepaintPending){compoundRepaintPending=false;paint();}}verify();return candidate;};verify();return {owner,verify,prepare};
  }
  function previewCompound(){try{const action=compoundAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();proposal={definition:candidate,layerId:action.owner.layerId};actionError='';status='Unapplied compound tangent position. Picks retain original sampled artwork.';paint();}catch(cause){actionFailure(cause);}}
  function promoteCompound(){try{const action=compoundAction();promote(action.owner,action.prepare,action.verify);}catch(cause){actionFailure(cause);}}
  let proposal=$state.raw<{definition:SymbolDefinition;layerId:string;pivotPoint?:Point;pivotPolicy?:number;groupPivotPoint?:Point;groupPivotPolicy?:number;trajectory?:{selection:NonNullable<typeof groupTrajectory>;controls:TrajectoryControls;policy?:number;part?:'start'|'end'};rootTrajectory?:{selection:NonNullable<typeof rootTrajectory>;controls:TrajectoryControls;policy?:number;part?:'start'|'end'};rootWaypoint?:{selection:NonNullable<typeof rootWaypoint>;x:number|undefined;y:number|undefined;policy?:number};waypoint?:{selection:NonNullable<typeof groupWaypoint>;x:number|undefined;y:number|undefined;policy?:number}}>();
  const validMove=$derived(Number.isFinite(moveX)&&Number.isFinite(moveY)&&!!(moveX||moveY));
  function changeGroupMode(){selectionPolicy++;cancelInteraction();pivotCanvas=false;nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;groupAuthorOnRelease=false;choose('');}
  let preparingTranslation=false,translationRepaintPending=false,translationInputRevision=0,translationPolicy=0,translationAuthorPolicy=0,translationGroupAuthorPolicy=0;const translationInputAxes={x:0,y:0};
  let alive=false,preparingCompound=false,compoundRepaintPending=false,preparingCompoundNode=false,compoundNodeRepaintPending=false,preparingPivot=false,preparingNode=false,nodeRepaintPending=false,preparingTangent=false,tangentRepaintPending=false;
  let tangentInputRevision=0;const tangentInputAxes={x:0,y:0};
  let compoundInputRevision=0;const compoundInputAxes={x:0,y:0};
  let compoundNodeInputRevision=0;const compoundNodeInputAxes={x:0,y:0};
  let nodeInputRevision=0;const nodeInputAxes={x:0,y:0};
  let pivotInputRevision=0,groupPivotInputRevision=0;
  const pivotInputAxes={x:0,y:0},groupPivotInputAxes={x:0,y:0};
  type Press={groupMode:boolean;id:number;x:number;y:number;box:DOMRect;pick:string};
  let press=$state.raw<Press>();
  let dragEnabled=$state(false),authorOnRelease=$state(false),groupAuthorOnRelease=$state(false),rotateHandle=$state(false),scaleHandles=$state(false),skewHandles=$state(false);
  type Drag={translation?:{handles:{rotation:boolean;scaling:boolean;skewing:boolean};frame:number;policy:number;authorPolicy:number;inputRevision:number;inputAxes:{x:number;y:number};target?:Point;pose?:NonNullable<typeof proposal>};group:boolean;skewing?:{rotation:boolean;scaling:boolean;frame:number;policy:number;inputRevision:number;inputAxes:{axis:number;angle:number};target?:{axis:'x'|'y';degrees:number};pose?:NonNullable<typeof proposal>;poseSkew?:{axis:'x'|'y';degrees:number};view:RotationView;pivot:Point;box:Bounds;start:Point;edge:string;axis:'x'|'y';expected:number;beforeAxis:'x'|'y';beforeAngle:number|undefined};scaling?:{rotation:boolean;frame:number;policy:number;inputRevision:number;inputAxes:{x:number;y:number};target?:Point;pose?:NonNullable<typeof proposal>;poseFactors?:Point;view:RotationView;pivot:Point;box:Bounds;start:Point;handle:string;expected:Point;beforeX:number|undefined;beforeY:number|undefined};rotation?:{scaling:boolean;frame:number;policy:number;inputRevision:number;target?:{degrees:number};pose?:NonNullable<typeof proposal>;poseDegrees?:number;view:RotationView;pivot:Point;last:number;total:number;expected:number;before:number|undefined};author:boolean;id:number;x:number;y:number;box:DOMRect;scaleX:number;scaleY:number;pick:string;owner:Owner|GroupOwner;
    capture:NonNullable<typeof capture>;beforeX:number|undefined;beforeY:number|undefined;expectedX:number|undefined;expectedY:number|undefined;
    proposal:typeof proposal;status:string;error:string;observer:ResizeObserver};
  let drag=$state.raw<Drag>();
  let pivotCanvas=$state(false),pivotPolicy=0,pivotAuthor=$state(false),pivotReleasePolicy=0;
  function changePivotAuthor(enabled:boolean){stopPivotDraft();pivotReleasePolicy++;pivotAuthor=enabled;}
  type GroupCurveDrag={author:boolean;releasePolicy:number;policy:number;inputRevision:number;frame:number;id:number;part:'start'|'end';selection:NonNullable<typeof groupTrajectory>;capture:NonNullable<typeof capture>;box:DOMRect;view:RotationView;start:Point;before:TrajectoryControls;controls:TrajectoryControls;proposal:typeof proposal;pose?:NonNullable<typeof proposal>;status:string;error:string;observer:ResizeObserver};
  let groupCurveDrag=$state.raw<GroupCurveDrag>();
  $effect(()=>{if(proposal?.trajectory?.policy!==undefined&&(!groupCurveCanvas||proposal.trajectory.policy!==groupCurvePolicy||proposal.trajectory.part!==groupCurvePart)){proposal=undefined;paint();}});
  function restoreGroupCurveDraft(d:GroupCurveDrag){if(groupTrajectory===d.selection&&pick===d.selection.pick){if(trajectoryRevision===d.inputRevision&&trajectoryControls===d.controls){trajectoryControls=d.before;proposal=d.proposal?.trajectory?.policy===undefined||(groupCurveCanvas&&d.proposal.trajectory.policy===groupCurvePolicy&&d.proposal.trajectory.part===groupCurvePart)?d.proposal:undefined;}else proposal=undefined;status=d.status;actionError=d.error;}}
  function stopGroupCurveDraft(restore=true,repaint=true){const d=groupCurveDrag;if(!d)return;cubicPreview.cancel();if(groupCurveDrag!==d)return;groupCurveDrag=undefined;d.observer.disconnect();window.removeEventListener('scroll',checkDragView,true);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);if(restore)restoreGroupCurveDraft(d);if(repaint&&alive)paint();}
  function groupCurveMarkers(){const selection=groupTrajectory,part=groupCurvePart,selected=groupCurveCanvas&&groupMode&&selection?pickedView():null;if(!selected||!selection||selection.pick!==pick)return null;const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),screen=(p:Point)=>({x:(20+p.x*scale)*selected.view.cssWidth/540,y:(20+p.y*scale)*selected.view.cssHeight/330}),anchor=selection[part],fx=part==='start'?'startX':'endX',fy=part==='start'?'startY':'endY',pose=groupCurveDrag?.pose?.trajectory??proposal?.trajectory,controls=pose?.selection===selection?pose.controls:selection.path,original=screen({x:anchor.x+selection.path[fx],y:anchor.y+selection.path[fy]}),proposed=screen({x:anchor.x+(controls[fx]??NaN),y:anchor.y+(controls[fy]??NaN)});if(![original.x,original.y,proposed.x,proposed.y].every(Number.isFinite))return null;return {...selected,anchor:screen(anchor),original,proposed};}
  function assertGroupCurveInputs(d:GroupCurveDrag,active=true){validateSource();if(!alive||failure||!groupCurveCanvas||groupCurvePolicy!==d.policy||groupCurveAuthor!==d.author||groupCurveReleasePolicy!==d.releasePolicy||groupCurvePart!==d.part||!groupMode||(active&&groupCurveDrag!==d)||groupTrajectory!==d.selection||capture!==d.capture||pick!==d.selection.pick||frame!==d.frame||trajectoryRevision!==d.inputRevision||trajectoryControls!==d.controls||!sameBox(canvas.getBoundingClientRect(),d.box)||(active&&!canvas.hasPointerCapture(d.id)))throw Error('The original symbol cubic control drag changed.');}
  function assertGroupCurveDraft(d:GroupCurveDrag,active=true){assertGroupCurveInputs(d,active);const owner=JSON.stringify(d.capture.resolveGroup(d.selection.owner.layerId,d.selection.owner.shapeId)),expected=JSON.stringify(d.selection.owner);assertGroupCurveInputs(d,active);if(owner!==expected)throw Error('The original cubic root changed.');}
  function failGroupCurveDraft(d:GroupCurveDrag,cause:unknown){stopGroupCurveDraft(false,false);restoreGroupCurveDraft(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  function updateGroupCurveDraft(e:PointerEvent,finish=false){const d=groupCurveDrag;if(!d||e.pointerId!==d.id)return;let owned=d.controls;
    try{if(finish){cubicPreview.cancel();if(groupCurveDrag!==d||d.controls!==owned)return;}if(finish)assertGroupCurveDraft(d);else assertGroupCurveInputs(d);const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},d.view);let dx=point.x-d.start.x,dy=point.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}if(![dx,dy].every(Number.isFinite))throw Error('Invalid cubic control pointer.');d.controls={...d.before,[d.part+'X']:d.selection.path[d.part==='start'?'startX':'endX']+dx,[d.part+'Y']:d.selection.path[d.part==='start'?'startY':'endY']+dy};trajectoryControls=d.controls;owned=d.controls;
      if(dx||dy){if(!finish){status='Dragging an unapplied cubic control.';cubicPreview.request({kind:'group',drag:d,controls:owned});}}else{cubicPreview.cancel();if(groupCurveDrag!==d||d.controls!==owned)return;d.pose=undefined;status=d.status;}
      if(finish){assertGroupCurveDraft(d);stopGroupCurveDraft(false,false);if(!dx&&!dy)restoreGroupCurveDraft(d);else if(d.author){const action=groupTrajectoryAction(d),verify=()=>{action.verify();assertGroupCurveDraft(d,false);if(!d.author||!groupCurveAuthor)throw Error('Group cubic control release authoring changed.');};verify();promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},verify);return;}else{assertGroupCurveDraft(d,false);const action=groupTrajectoryAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertGroupCurveDraft(d,false);proposal={definition:candidate,layerId:action.owner.layerId,trajectory:{selection:d.selection,controls:d.controls,part:d.part,policy:d.policy}};actionError='';status='Unapplied cubic control. Release did not change history.';}}paint();
    }catch(cause){if((groupCurveDrag===d&&d.controls===owned)||(finish&&!groupCurveDrag))failGroupCurveDraft(d,cause);}
  }
  function beginGroupCurve(e:PointerEvent){const author=groupCurveAuthor,releasePolicy=groupCurveReleasePolicy,selection=groupTrajectory,originalCapture=capture,originalPick=pick,part=groupCurvePart,policy=groupCurvePolicy,inputRevision=trajectoryRevision,at=frame,controls=trajectoryControls,initialBox=canvas.getBoundingClientRect();if(!selection||!originalCapture||!groupCurveCanvas||!groupMode||failure)return false;
    const current=()=>{validateSource();if(!alive||capture!==originalCapture||groupTrajectory!==selection||pick!==originalPick||!groupCurveCanvas||groupCurvePart!==part||groupCurvePolicy!==policy||groupCurveAuthor!==author||groupCurveReleasePolicy!==releasePolicy||trajectoryRevision!==inputRevision||frame!==at||!groupMode||trajectoryControls!==controls||!sameBox(canvas.getBoundingClientRect(),initialBox))throw Error('The original symbol cubic control capture changed.');};const verify=()=>{current();const owner=originalCapture.resolveGroup(selection.owner.layerId,selection.owner.shapeId);current();if(JSON.stringify(owner)!==JSON.stringify(selection.owner))throw Error('The original cubic root changed.');};
    try{verify();const handles=groupCurveMarkers();verify();if(!handles||Math.hypot(e.clientX-initialBox.left-handles.original.x,e.clientY-initialBox.top-handles.original.y)>8)return false;const box=canvas.getBoundingClientRect(),pointer=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},handles.view),hit=pickPreviewRoot(originalCapture,pointer);verify();if(hit.kind==='blocked'||(hit.kind==='pick'&&(hit.owner.layerId!==selection.owner.layerId||!selection.owner.shapeIds.includes(hit.owner.shapeId)))){status='Foreground artwork owns this cubic control position.';paint();return true;}
      cancelInteraction();verify();canvas.focus({preventScroll:true});verify();e.preventDefault();const observer=new ResizeObserver(checkDragView);verify();canvas.setPointerCapture(e.pointerId);const original={...controls,[part+'X']:selection.path[part==='start'?'startX':'endX'],[part+'Y']:selection.path[part==='start'?'startY':'endY']};groupCurveDrag={author,releasePolicy,policy,part,inputRevision,frame:at,id:e.pointerId,selection,capture:originalCapture,box,view:handles.view,start:pointer,before:controls,controls:original,proposal,status,error:actionError,observer};trajectoryControls=original;proposal=undefined;observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);return true;
    }catch(cause){try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return true;}actionFailure(cause);return true;}
  }
  type RootCurveDrag={author:boolean;releasePolicy:number;policy:number;inputRevision:number;frame:number;id:number;part:'start'|'end';selection:NonNullable<typeof rootTrajectory>;capture:NonNullable<typeof capture>;box:DOMRect;view:RotationView;start:Point;before:TrajectoryControls;controls:TrajectoryControls;proposal:typeof proposal;pose?:NonNullable<typeof proposal>;status:string;error:string;observer:ResizeObserver};
  let rootCurveDrag=$state.raw<RootCurveDrag>();
  $effect(()=>{if(proposal?.rootTrajectory?.policy!==undefined&&(!rootCurveCanvas||proposal.rootTrajectory.policy!==rootCurvePolicy||proposal.rootTrajectory.part!==rootCurvePart)){proposal=undefined;paint();}});
  // Drag controls are mutable; each queued request owns one exact controls object.
  // Movement checks captured inputs without reentering an in-progress private preparation;
  // the frame task and release still resolve the original private owner before/after work.
  type CubicPreview={kind:'root';drag:RootCurveDrag;controls:TrajectoryControls}|{kind:'group';drag:GroupCurveDrag;controls:TrajectoryControls};
  const cubicPreview=createLatestFrameTask<CubicPreview>({
    admit(job){if((job.kind==='root'?rootCurveDrag:groupCurveDrag)!==job.drag||job.drag.controls!==job.controls||!Object.values(job.controls).every(Number.isFinite))throw Error('Invalid isolated cubic preview request.');return job;},
    run(job,current){
      if(!current()||(job.kind==='root'?rootCurveDrag:groupCurveDrag)!==job.drag||job.drag.controls!==job.controls)return;
      if(job.kind==='root'){const d=job.drag;assertRootCurveDraft(d);const action=rootTrajectoryAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertRootCurveDraft(d);if(current()&&rootCurveDrag===d&&d.controls===job.controls)d.pose={definition:candidate,layerId:action.owner.layerId,rootTrajectory:{selection:d.selection,controls:job.controls,part:d.part,policy:d.policy}};}
      else {const d=job.drag;assertGroupCurveDraft(d);const action=groupTrajectoryAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertGroupCurveDraft(d);if(current()&&groupCurveDrag===d&&d.controls===job.controls)d.pose={definition:candidate,layerId:action.owner.layerId,trajectory:{selection:d.selection,controls:job.controls,part:d.part,policy:d.policy}};}
      if(current())paint();
    },
    onError(cause,job,current){if(!current()||(job.kind==='root'?rootCurveDrag:groupCurveDrag)!==job.drag||job.drag.controls!==job.controls)return;if(job.kind==='root')failRootCurveDraft(job.drag,cause);else failGroupCurveDraft(job.drag,cause);},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function restoreRootCurveDraft(d:RootCurveDrag){if(rootTrajectory===d.selection&&pick===d.selection.pick){if(rootTrajectoryRevision===d.inputRevision&&rootTrajectoryControls===d.controls){rootTrajectoryControls=d.before;proposal=d.proposal?.rootTrajectory?.policy===undefined||(rootCurveCanvas&&d.proposal.rootTrajectory.policy===rootCurvePolicy&&d.proposal.rootTrajectory.part===rootCurvePart)?d.proposal:undefined;}else proposal=undefined;status=d.status;actionError=d.error;}}
  function stopRootCurveDraft(restore=true,repaint=true){const d=rootCurveDrag;if(!d)return;cubicPreview.cancel();if(rootCurveDrag!==d)return;rootCurveDrag=undefined;d.observer.disconnect();window.removeEventListener('scroll',checkDragView,true);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);if(restore)restoreRootCurveDraft(d);if(repaint&&alive)paint();}
  function rootCurveMarkers(){const selection=rootTrajectory,part=rootCurvePart,selected=rootCurveCanvas&&!groupMode&&selection?pickedView():null;if(!selected||!selection||selection.pick!==pick)return null;const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),screen=(p:Point)=>({x:(20+p.x*scale)*selected.view.cssWidth/540,y:(20+p.y*scale)*selected.view.cssHeight/330}),anchor=selection[part],fx=part==='start'?'startX':'endX',fy=part==='start'?'startY':'endY',pose=rootCurveDrag?.pose?.rootTrajectory??proposal?.rootTrajectory,controls=pose?.selection===selection?pose.controls:selection.path,original=screen({x:anchor.x+selection.path[fx],y:anchor.y+selection.path[fy]}),proposed=screen({x:anchor.x+(controls[fx]??NaN),y:anchor.y+(controls[fy]??NaN)});if(![original.x,original.y,proposed.x,proposed.y].every(Number.isFinite))return null;return {...selected,anchor:screen(anchor),original,proposed};}
  function assertRootCurveInputs(d:RootCurveDrag,active=true){validateSource();if(!alive||failure||!rootCurveCanvas||rootCurvePolicy!==d.policy||rootCurveAuthor!==d.author||rootCurveReleasePolicy!==d.releasePolicy||rootCurvePart!==d.part||groupMode||(active&&rootCurveDrag!==d)||rootTrajectory!==d.selection||capture!==d.capture||pick!==d.selection.pick||frame!==d.frame||rootTrajectoryRevision!==d.inputRevision||rootTrajectoryControls!==d.controls||!sameBox(canvas.getBoundingClientRect(),d.box)||(active&&!canvas.hasPointerCapture(d.id)))throw Error('The original symbol cubic control drag changed.');}
  function assertRootCurveDraft(d:RootCurveDrag,active=true){assertRootCurveInputs(d,active);const owner=JSON.stringify(d.capture.resolveTrajectory(d.selection.owner.layerId,d.selection.owner.shapeId)),expected=JSON.stringify(d.selection.owner);assertRootCurveInputs(d,active);if(owner!==expected)throw Error('The original cubic root changed.');}
  function failRootCurveDraft(d:RootCurveDrag,cause:unknown){stopRootCurveDraft(false,false);restoreRootCurveDraft(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  function updateRootCurveDraft(e:PointerEvent,finish=false){const d=rootCurveDrag;if(!d||e.pointerId!==d.id)return;let owned=d.controls;
    try{if(finish){cubicPreview.cancel();if(rootCurveDrag!==d||d.controls!==owned)return;}if(finish)assertRootCurveDraft(d);else assertRootCurveInputs(d);const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},d.view);let dx=point.x-d.start.x,dy=point.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}if(![dx,dy].every(Number.isFinite))throw Error('Invalid cubic control pointer.');d.controls={...d.before,[d.part+'X']:d.selection.path[d.part==='start'?'startX':'endX']+dx,[d.part+'Y']:d.selection.path[d.part==='start'?'startY':'endY']+dy};rootTrajectoryControls=d.controls;owned=d.controls;
      if(dx||dy){if(!finish){status='Dragging an unapplied cubic control.';cubicPreview.request({kind:'root',drag:d,controls:owned});}}else{cubicPreview.cancel();if(rootCurveDrag!==d||d.controls!==owned)return;d.pose=undefined;status=d.status;}
      if(finish){assertRootCurveDraft(d);stopRootCurveDraft(false,false);if(!dx&&!dy)restoreRootCurveDraft(d);else if(d.author){const action=rootTrajectoryAction(d),verify=()=>{action.verify();assertRootCurveDraft(d,false);if(!d.author||!rootCurveAuthor)throw Error('Cubic control release authoring changed.');};verify();promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},verify);return;}else{assertRootCurveDraft(d,false);const action=rootTrajectoryAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertRootCurveDraft(d,false);proposal={definition:candidate,layerId:action.owner.layerId,rootTrajectory:{selection:d.selection,controls:d.controls,part:d.part,policy:d.policy}};actionError='';status='Unapplied cubic control. Release did not change history.';}}paint();
    }catch(cause){if((rootCurveDrag===d&&d.controls===owned)||(finish&&!rootCurveDrag))failRootCurveDraft(d,cause);}
  }
  function beginRootCurve(e:PointerEvent){const author=rootCurveAuthor,releasePolicy=rootCurveReleasePolicy,selection=rootTrajectory,originalCapture=capture,originalPick=pick,part=rootCurvePart,policy=rootCurvePolicy,inputRevision=rootTrajectoryRevision,at=frame,controls=rootTrajectoryControls,initialBox=canvas.getBoundingClientRect();if(!selection||!originalCapture||!rootCurveCanvas||groupMode||failure)return false;
    const current=()=>{validateSource();if(!alive||capture!==originalCapture||rootTrajectory!==selection||pick!==originalPick||!rootCurveCanvas||rootCurvePart!==part||rootCurvePolicy!==policy||rootCurveAuthor!==author||rootCurveReleasePolicy!==releasePolicy||rootTrajectoryRevision!==inputRevision||frame!==at||groupMode||rootTrajectoryControls!==controls||!sameBox(canvas.getBoundingClientRect(),initialBox))throw Error('The original symbol cubic control capture changed.');};const verify=()=>{current();const owner=originalCapture.resolveTrajectory(selection.owner.layerId,selection.owner.shapeId);current();if(JSON.stringify(owner)!==JSON.stringify(selection.owner))throw Error('The original cubic root changed.');};
    try{verify();const handles=rootCurveMarkers();verify();if(!handles||Math.hypot(e.clientX-initialBox.left-handles.original.x,e.clientY-initialBox.top-handles.original.y)>8)return false;const box=canvas.getBoundingClientRect(),pointer=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},handles.view),hit=pickPreviewRoot(originalCapture,pointer);verify();if(hit.kind==='blocked'||(hit.kind==='pick'&&(hit.owner.layerId!==selection.owner.layerId||hit.owner.shapeId!==selection.owner.shapeId))){status='Foreground artwork owns this cubic control position.';paint();return true;}
      cancelInteraction();verify();canvas.focus({preventScroll:true});verify();e.preventDefault();const observer=new ResizeObserver(checkDragView);verify();canvas.setPointerCapture(e.pointerId);const original={...controls,[part+'X']:selection.path[part==='start'?'startX':'endX'],[part+'Y']:selection.path[part==='start'?'startY':'endY']};rootCurveDrag={author,releasePolicy,policy,part,inputRevision,frame:at,id:e.pointerId,selection,capture:originalCapture,box,view:handles.view,start:pointer,before:controls,controls:original,proposal,status,error:actionError,observer};rootTrajectoryControls=original;proposal=undefined;observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);return true;
    }catch(cause){try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return true;}actionFailure(cause);return true;}
  }
  type RootWaypointDrag={author:boolean;releasePolicy:number;policy:number;inputRevision:number;frame:number;id:number;selection:NonNullable<typeof rootWaypoint>;capture:NonNullable<typeof capture>;box:DOMRect;view:RotationView;start:Point;beforeX:number|undefined;beforeY:number|undefined;x:number;y:number;previewTarget?:Point;proposal:typeof proposal;pose?:NonNullable<typeof proposal>;status:string;error:string;observer:ResizeObserver};
  let rootWaypointDrag=$state.raw<RootWaypointDrag>();
  function changeRootWaypointCanvas(enabled:boolean){cancelInteraction();rootWaypointPolicy++;rootWaypointCanvas=enabled;if(proposal?.rootWaypoint?.policy!==undefined)discardProposal();paint();}
  $effect(()=>{if(proposal?.rootWaypoint?.policy!==undefined&&(!rootWaypointCanvas||proposal.rootWaypoint.policy!==rootWaypointPolicy)){proposal=undefined;paint();}});
  function restoreRootWaypointDraft(d:RootWaypointDrag){if(rootWaypoint===d.selection&&pick===d.selection.route.pick){if(rootWaypointRevision!==d.inputRevision){proposal=undefined;status=d.status;actionError=d.error;return;}const x=rootWaypointX,y=rootWaypointY;rootWaypointX=x===d.x?d.beforeX:x;rootWaypointY=y===d.y?d.beforeY:y;proposal=x===d.x&&y===d.y&&(d.proposal?.rootWaypoint?.policy===undefined||(rootWaypointCanvas&&d.proposal.rootWaypoint.policy===rootWaypointPolicy))?d.proposal:undefined;status=d.status;actionError=d.error;}}
  function stopRootWaypointDraft(restore=true,repaint=true){const d=rootWaypointDrag;if(!d)return;const target=d.previewTarget;waypointPreview.cancel();if(rootWaypointDrag!==d||d.previewTarget!==target)return;rootWaypointDrag=undefined;d.observer.disconnect();window.removeEventListener('scroll',checkDragView,true);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);if(restore)restoreRootWaypointDraft(d);if(repaint&&alive)paint();}
  function rootWaypointMarkers(){const selection=rootWaypoint,selected=rootWaypointCanvas&&!groupMode&&selection?pickedView():null;if(!selected||!selection||rootWaypoints!==selection.route||selection.route.pick!==pick)return null;const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),screen=(p:Point)=>({x:(20+(selection.route.origin.x+p.x)*scale)*selected.view.cssWidth/540,y:(20+(selection.route.origin.y+p.y)*scale)*selected.view.cssHeight/330}),pose=rootWaypointDrag?.pose?.rootWaypoint??proposal?.rootWaypoint,point=pose?.selection===selection?{x:pose.x!,y:pose.y!}:selection.point,original=screen(selection.point),proposed=screen(point);if(![original.x,original.y,proposed.x,proposed.y].every(Number.isFinite))return null;return {...selected,original,proposed};}
  function assertRootWaypointInputs(d:RootWaypointDrag,active=true){validateSource();if(!alive||failure||!rootWaypointCanvas||rootWaypointPolicy!==d.policy||rootWaypointAuthor!==d.author||rootWaypointReleasePolicy!==d.releasePolicy||groupMode||(active&&rootWaypointDrag!==d)||rootWaypoint!==d.selection||rootWaypoints!==d.selection.route||capture!==d.capture||pick!==d.selection.route.pick||frame!==d.frame||rootWaypointNumber!==d.selection.index+1||rootWaypointRevision!==d.inputRevision||rootWaypointX!==d.x||rootWaypointY!==d.y||!sameBox(canvas.getBoundingClientRect(),d.box)||(active&&!canvas.hasPointerCapture(d.id)))throw Error('The original symbol waypoint drag changed.');}
  function assertRootWaypointDraft(d:RootWaypointDrag,active=true){assertRootWaypointInputs(d,active);const owner=JSON.stringify(d.capture.resolveTrajectory(d.selection.route.owner.layerId,d.selection.route.owner.shapeId)),expected=JSON.stringify(d.selection.route.owner);assertRootWaypointInputs(d,active);if(owner!==expected)throw Error('The original waypoint group changed.');}
  function failRootWaypointDraft(d:RootWaypointDrag,cause:unknown){stopRootWaypointDraft(false,false);restoreRootWaypointDraft(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  function updateRootWaypointDraft(e:PointerEvent,finish=false){const d=rootWaypointDrag;if(!d||e.pointerId!==d.id)return;let owned=d.previewTarget;
    try{if(finish){waypointPreview.cancel();if(rootWaypointDrag!==d||d.previewTarget!==owned)return;}if(finish)assertRootWaypointDraft(d);else assertRootWaypointInputs(d);if(rootWaypointDrag!==d||d.previewTarget!==owned)return;const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},d.view);let dx=point.x-d.start.x,dy=point.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}if(![dx,dy].every(Number.isFinite))throw Error('Invalid waypoint pointer coordinates.');d.x=d.selection.point.x+dx;d.y=d.selection.point.y+dy;rootWaypointX=d.x;rootWaypointY=d.y;owned={x:d.x,y:d.y};d.previewTarget=owned;
      if(dx||dy){if(!finish){status='Dragging an unapplied saved waypoint.';waypointPreview.request({kind:'root',drag:d,target:owned});}}else{waypointPreview.cancel();if(rootWaypointDrag!==d||d.previewTarget!==owned)return;d.pose=undefined;status=d.status;}
      if(finish){assertRootWaypointDraft(d);stopRootWaypointDraft(false,false);if(!dx&&!dy)restoreRootWaypointDraft(d);else if(d.author){const action=rootWaypointAction(d),verify=()=>{action.verify();assertRootWaypointDraft(d,false);if(!d.author||!rootWaypointAuthor)throw Error('Root waypoint release authoring changed.');};verify();promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},verify);return;}else{assertRootWaypointDraft(d,false);const action=rootWaypointAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertRootWaypointDraft(d,false);proposal={definition:candidate,layerId:action.owner.layerId,rootWaypoint:{selection:d.selection,x:d.x,y:d.y,policy:d.policy}};actionError='';status='Unapplied saved waypoint position. Release did not change history.';}}paint();
    }catch(cause){if((rootWaypointDrag===d&&d.previewTarget===owned)||(finish&&!rootWaypointDrag))failRootWaypointDraft(d,cause);}
  }
  function beginRootWaypoint(e:PointerEvent){const author=rootWaypointAuthor,releasePolicy=rootWaypointReleasePolicy,selection=rootWaypoint,originalCapture=capture,originalPick=pick,policy=rootWaypointPolicy,inputRevision=rootWaypointRevision,at=frame,x=rootWaypointX,y=rootWaypointY,initialBox=canvas.getBoundingClientRect();
    if(!selection||!originalCapture||!rootWaypointCanvas||groupMode||failure)return false;
    const current=()=>{validateSource();if(!alive||capture!==originalCapture||rootWaypoint!==selection||rootWaypoints!==selection.route||pick!==originalPick||!rootWaypointCanvas||rootWaypointPolicy!==policy||rootWaypointAuthor!==author||rootWaypointReleasePolicy!==releasePolicy||rootWaypointRevision!==inputRevision||rootWaypointNumber!==selection.index+1||frame!==at||groupMode||rootWaypointX!==x||rootWaypointY!==y||!sameBox(canvas.getBoundingClientRect(),initialBox))throw Error('The original symbol waypoint capture changed.');};
    const verify=()=>{current();const owner=originalCapture.resolveTrajectory(selection.route.owner.layerId,selection.route.owner.shapeId);current();if(JSON.stringify(owner)!==JSON.stringify(selection.route.owner))throw Error('The original waypoint membership changed.');};
    try{verify();const handles=rootWaypointMarkers();verify();if(!handles||Math.hypot(e.clientX-initialBox.left-handles.original.x,e.clientY-initialBox.top-handles.original.y)>8)return false;const box=canvas.getBoundingClientRect(),pointer=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},handles.view),hit=pickPreviewRoot(originalCapture,pointer);verify();if(hit.kind==='blocked'||(hit.kind==='pick'&&(hit.owner.layerId!==selection.route.owner.layerId||selection.route.owner.shapeId!==hit.owner.shapeId))){status='Foreground artwork owns this waypoint position.';paint();return true;}
      cancelInteraction();verify();if(!sameBox(canvas.getBoundingClientRect(),box))throw Error('The waypoint view changed.');canvas.focus({preventScroll:true});verify();e.preventDefault();const observer=new ResizeObserver(checkDragView);verify();canvas.setPointerCapture(e.pointerId);rootWaypointDrag={author,releasePolicy,policy,inputRevision,frame:at,id:e.pointerId,selection,capture:originalCapture,box,view:handles.view,start:pointer,beforeX:x,beforeY:y,x:selection.point.x,y:selection.point.y,proposal,status,error:actionError,observer};rootWaypointX=selection.point.x;rootWaypointY=selection.point.y;proposal=undefined;observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);return true;
    }catch(cause){try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return true;}actionFailure(cause);return true;}
  }
  type WaypointDrag={author:boolean;releasePolicy:number;policy:number;inputRevision:number;frame:number;id:number;selection:NonNullable<typeof groupWaypoint>;capture:NonNullable<typeof capture>;box:DOMRect;view:RotationView;start:Point;beforeX:number|undefined;beforeY:number|undefined;x:number;y:number;previewTarget?:Point;proposal:typeof proposal;pose?:NonNullable<typeof proposal>;status:string;error:string;observer:ResizeObserver};
  let waypointDrag=$state.raw<WaypointDrag>();
  function changeWaypointCanvas(enabled:boolean){cancelInteraction();waypointPolicy++;waypointCanvas=enabled;if(proposal?.waypoint?.policy!==undefined)discardProposal();paint();}
  $effect(()=>{if(proposal?.waypoint?.policy!==undefined&&(!waypointCanvas||proposal.waypoint.policy!==waypointPolicy)){proposal=undefined;paint();}});
  // X/Y snapshots have a private identity so a changed-and-restored raw target stays newer.
  type WaypointPreview={kind:'root';drag:RootWaypointDrag;target:Point}|{kind:'group';drag:WaypointDrag;target:Point};
  const waypointPreview=createLatestFrameTask<WaypointPreview>({
    admit(job){if((job.kind==='root'?rootWaypointDrag:waypointDrag)!==job.drag||job.drag.previewTarget!==job.target||job.drag.x!==job.target.x||job.drag.y!==job.target.y||![job.target.x,job.target.y].every(Number.isFinite))throw Error('Invalid isolated waypoint preview request.');return job;},
    run(job,current){
      if(!current()||(job.kind==='root'?rootWaypointDrag:waypointDrag)!==job.drag||job.drag.previewTarget!==job.target)return;
      if(job.kind==='root'){const d=job.drag;assertRootWaypointDraft(d);const action=rootWaypointAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertRootWaypointDraft(d);if(current()&&rootWaypointDrag===d&&d.previewTarget===job.target)d.pose={definition:candidate,layerId:action.owner.layerId,rootWaypoint:{selection:d.selection,x:job.target.x,y:job.target.y,policy:d.policy}};}
      else {const d=job.drag;assertWaypointDraft(d);const action=groupWaypointAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertWaypointDraft(d);if(current()&&waypointDrag===d&&d.previewTarget===job.target)d.pose={definition:candidate,layerId:action.owner.layerId,waypoint:{selection:d.selection,x:job.target.x,y:job.target.y,policy:d.policy}};}
      if(current())paint();
    },
    onError(cause,job,current){if(!current()||(job.kind==='root'?rootWaypointDrag:waypointDrag)!==job.drag||job.drag.previewTarget!==job.target)return;if(job.kind==='root')failRootWaypointDraft(job.drag,cause);else failWaypointDraft(job.drag,cause);},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function restoreWaypointDraft(d:WaypointDrag){if(groupWaypoint===d.selection&&pick===d.selection.route.pick){if(waypointRevision!==d.inputRevision){proposal=undefined;status=d.status;actionError=d.error;return;}const x=waypointX,y=waypointY;waypointX=x===d.x?d.beforeX:x;waypointY=y===d.y?d.beforeY:y;proposal=x===d.x&&y===d.y&&(d.proposal?.waypoint?.policy===undefined||(waypointCanvas&&d.proposal.waypoint.policy===waypointPolicy))?d.proposal:undefined;status=d.status;actionError=d.error;}}
  function stopWaypointDraft(restore=true,repaint=true){const d=waypointDrag;if(!d)return;const target=d.previewTarget;waypointPreview.cancel();if(waypointDrag!==d||d.previewTarget!==target)return;waypointDrag=undefined;d.observer.disconnect();window.removeEventListener('scroll',checkDragView,true);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);if(restore)restoreWaypointDraft(d);if(repaint&&alive)paint();}
  function waypointMarkers(){const selection=groupWaypoint,selected=waypointCanvas&&groupMode&&selection?pickedView():null;if(!selected||!selection||groupWaypoints!==selection.route||selection.route.pick!==pick)return null;const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),screen=(p:Point)=>({x:(20+(selection.route.origin.x+p.x)*scale)*selected.view.cssWidth/540,y:(20+(selection.route.origin.y+p.y)*scale)*selected.view.cssHeight/330}),pose=waypointDrag?.pose?.waypoint??proposal?.waypoint,point=pose?.selection===selection?{x:pose.x!,y:pose.y!}:selection.point,original=screen(selection.point),proposed=screen(point);if(![original.x,original.y,proposed.x,proposed.y].every(Number.isFinite))return null;return {...selected,original,proposed};}
  function assertWaypointInputs(d:WaypointDrag,active=true){validateSource();if(!alive||failure||!waypointCanvas||waypointPolicy!==d.policy||waypointAuthor!==d.author||waypointReleasePolicy!==d.releasePolicy||!groupMode||(active&&waypointDrag!==d)||groupWaypoint!==d.selection||groupWaypoints!==d.selection.route||capture!==d.capture||pick!==d.selection.route.pick||frame!==d.frame||waypointNumber!==d.selection.index+1||waypointRevision!==d.inputRevision||waypointX!==d.x||waypointY!==d.y||!sameBox(canvas.getBoundingClientRect(),d.box)||(active&&!canvas.hasPointerCapture(d.id)))throw Error('The original symbol waypoint drag changed.');}
  function assertWaypointDraft(d:WaypointDrag,active=true){assertWaypointInputs(d,active);const owner=JSON.stringify(d.capture.resolveGroup(d.selection.route.owner.layerId,d.selection.route.owner.shapeId)),expected=JSON.stringify(d.selection.route.owner);assertWaypointInputs(d,active);if(owner!==expected)throw Error('The original waypoint group changed.');}
  function failWaypointDraft(d:WaypointDrag,cause:unknown){stopWaypointDraft(false,false);restoreWaypointDraft(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  function updateWaypointDraft(e:PointerEvent,finish=false){const d=waypointDrag;if(!d||e.pointerId!==d.id)return;let owned=d.previewTarget;
    try{if(finish){waypointPreview.cancel();if(waypointDrag!==d||d.previewTarget!==owned)return;}if(finish)assertWaypointDraft(d);else assertWaypointInputs(d);if(waypointDrag!==d||d.previewTarget!==owned)return;const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},d.view);let dx=point.x-d.start.x,dy=point.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}if(![dx,dy].every(Number.isFinite))throw Error('Invalid waypoint pointer coordinates.');d.x=d.selection.point.x+dx;d.y=d.selection.point.y+dy;waypointX=d.x;waypointY=d.y;owned={x:d.x,y:d.y};d.previewTarget=owned;
      if(dx||dy){if(!finish){status='Dragging an unapplied saved waypoint.';waypointPreview.request({kind:'group',drag:d,target:owned});}}else{waypointPreview.cancel();if(waypointDrag!==d||d.previewTarget!==owned)return;d.pose=undefined;status=d.status;}
      if(finish){assertWaypointDraft(d);stopWaypointDraft(false,false);if(!dx&&!dy)restoreWaypointDraft(d);else if(d.author){const action=groupWaypointAction(d),verify=()=>{action.verify();assertWaypointDraft(d,false);if(!d.author||!waypointAuthor)throw Error('Waypoint release authoring changed.');};verify();promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},verify);return;}else{assertWaypointDraft(d,false);const action=groupWaypointAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertWaypointDraft(d,false);proposal={definition:candidate,layerId:action.owner.layerId,waypoint:{selection:d.selection,x:d.x,y:d.y,policy:d.policy}};actionError='';status='Unapplied saved waypoint position. Release did not change history.';}}paint();
    }catch(cause){if((waypointDrag===d&&d.previewTarget===owned)||(finish&&!waypointDrag))failWaypointDraft(d,cause);}
  }
  function beginWaypoint(e:PointerEvent){const author=waypointAuthor,releasePolicy=waypointReleasePolicy,selection=groupWaypoint,originalCapture=capture,originalPick=pick,policy=waypointPolicy,inputRevision=waypointRevision,at=frame,x=waypointX,y=waypointY,initialBox=canvas.getBoundingClientRect();
    if(!selection||!originalCapture||!waypointCanvas||!groupMode||failure)return false;
    const current=()=>{validateSource();if(!alive||capture!==originalCapture||groupWaypoint!==selection||groupWaypoints!==selection.route||pick!==originalPick||!waypointCanvas||waypointPolicy!==policy||waypointAuthor!==author||waypointReleasePolicy!==releasePolicy||waypointRevision!==inputRevision||waypointNumber!==selection.index+1||frame!==at||!groupMode||waypointX!==x||waypointY!==y||!sameBox(canvas.getBoundingClientRect(),initialBox))throw Error('The original symbol waypoint capture changed.');};
    const verify=()=>{current();const owner=originalCapture.resolveGroup(selection.route.owner.layerId,selection.route.owner.shapeId);current();if(JSON.stringify(owner)!==JSON.stringify(selection.route.owner))throw Error('The original waypoint membership changed.');};
    try{verify();const handles=waypointMarkers();verify();if(!handles||Math.hypot(e.clientX-initialBox.left-handles.original.x,e.clientY-initialBox.top-handles.original.y)>8)return false;const box=canvas.getBoundingClientRect(),pointer=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},handles.view),hit=pickPreviewRoot(originalCapture,pointer);verify();if(hit.kind==='blocked'||(hit.kind==='pick'&&(hit.owner.layerId!==selection.route.owner.layerId||!selection.route.owner.shapeIds.includes(hit.owner.shapeId)))){status='Foreground artwork owns this waypoint position.';paint();return true;}
      cancelInteraction();verify();if(!sameBox(canvas.getBoundingClientRect(),box))throw Error('The waypoint view changed.');canvas.focus({preventScroll:true});verify();e.preventDefault();const observer=new ResizeObserver(checkDragView);verify();canvas.setPointerCapture(e.pointerId);waypointDrag={author,releasePolicy,policy,inputRevision,frame:at,id:e.pointerId,selection,capture:originalCapture,box,view:handles.view,start:pointer,beforeX:x,beforeY:y,x:selection.point.x,y:selection.point.y,proposal,status,error:actionError,observer};waypointX=selection.point.x;waypointY=selection.point.y;proposal=undefined;observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);return true;
    }catch(cause){try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return true;}actionFailure(cause);return true;}
  }
  type GroupPivotDrag={author:boolean;releasePolicy:number;policy:number;inputRevision:number;inputAxes:{x:number;y:number};frame:number;previewTarget?:Point;id:number;selection:NonNullable<typeof groupPivot>;capture:NonNullable<typeof capture>;box:DOMRect;view:RotationView;start:Point;beforeX:number|undefined;beforeY:number|undefined;x:number|undefined;y:number|undefined;proposal:typeof proposal;pose?:NonNullable<typeof proposal>;status:string;error:string;observer:ResizeObserver};
  let groupPivotDrag=$state.raw<GroupPivotDrag>();
  function changeGroupPivotCanvas(enabled:boolean){cancelInteraction();groupPivotPolicy++;groupPivotCanvas=enabled;if(proposal?.groupPivotPolicy!==undefined)discardProposal();paint();}
  $effect(()=>{if(proposal?.groupPivotPolicy!==undefined&&(!groupPivotCanvas||proposal.groupPivotPolicy!==groupPivotPolicy)){proposal=undefined;paint();}});
  function restoreGroupPivotDraft(d:GroupPivotDrag){if(groupPivot===d.selection&&pick===d.selection.pick){const x=groupPivotX,y=groupPivotY,ownX=groupPivotInputAxes.x===d.inputAxes.x&&x===d.x,ownY=groupPivotInputAxes.y===d.inputAxes.y&&y===d.y;groupPivotX=ownX?d.beforeX:x;groupPivotY=ownY?d.beforeY:y;proposal=groupPivotInputRevision===d.inputRevision&&ownX&&ownY&&(d.proposal?.groupPivotPolicy===undefined||(groupPivotCanvas&&d.proposal.groupPivotPolicy===groupPivotPolicy))?d.proposal:undefined;status=d.status;actionError=d.error;}}
  function stopGroupPivotDraft(restore=true,repaint=true){const d=groupPivotDrag;if(!d)return;const target=d.previewTarget;pivotPreview.cancel();if(groupPivotDrag!==d||d.previewTarget!==target)return;groupPivotDrag=undefined;d.observer.disconnect();window.removeEventListener('scroll',checkDragView,true);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);if(restore)restoreGroupPivotDraft(d);if(repaint&&alive)paint();}
  function groupPivotMarkers(){const selected=groupPivotCanvas&&groupMode&&groupPivot?pickedView():null;if(!selected||!groupPivot||groupPivot.pick!==pick)return null;const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),screen=(p:Point)=>({x:(20+p.x*scale)*selected.view.cssWidth/540,y:(20+p.y*scale)*selected.view.cssHeight/330}),proposed=groupPivotDrag?(groupPivotDrag.pose?.groupPivotPoint??groupPivot.point):(proposal?.groupPivotPoint??groupPivot.point);return {...selected,original:screen(groupPivot.point),proposed:screen(proposed)};}
  function assertGroupPivotInputs(d:GroupPivotDrag,active=true){validateSource();if(!alive||!groupPivotCanvas||groupPivotPolicy!==d.policy||groupPivotAuthor!==d.author||groupPivotReleasePolicy!==d.releasePolicy||!groupMode||(active&&groupPivotDrag!==d)||groupPivot!==d.selection||capture!==d.capture||pick!==d.selection.pick||frame!==d.frame||groupPivotInputRevision!==d.inputRevision||groupPivotX!==d.x||groupPivotY!==d.y||!sameBox(canvas.getBoundingClientRect(),d.box)||(active&&!canvas.hasPointerCapture(d.id)))throw Error('Sampled symbol group pivot drag changed or lost its view.');}
  function assertGroupPivotDraft(d:GroupPivotDrag,active=true){assertGroupPivotInputs(d,active);const owner=JSON.stringify(d.capture.resolveGroup(d.selection.owner.layerId,d.selection.owner.shapeId)),expected=JSON.stringify(d.selection.owner);assertGroupPivotInputs(d,active);if(owner!==expected)throw Error('The original sampled pivot group changed.');}
  function failGroupPivotDraft(d:GroupPivotDrag,cause:unknown){stopGroupPivotDraft(false,false);restoreGroupPivotDraft(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  function updateGroupPivotDraft(e:PointerEvent,finish=false){const d=groupPivotDrag;if(!d||e.pointerId!==d.id)return;let owned=d.previewTarget;
    try{if(finish){pivotPreview.cancel();if(groupPivotDrag!==d||d.previewTarget!==owned)return;}if(finish)assertGroupPivotDraft(d);else assertGroupPivotInputs(d);if(groupPivotDrag!==d||d.previewTarget!==owned)return;const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},d.view);let dx=point.x-d.start.x,dy=point.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}if(![dx,dy].every(Number.isFinite))throw Error('Invalid group pivot pointer coordinates.');
      owned={x:d.selection.point.x+dx,y:d.selection.point.y+dy};d.previewTarget=owned;if(dx||dy){d.x=owned.x;d.y=owned.y;groupPivotX=d.x;groupPivotY=d.y;if(!finish){status='Dragging an unapplied group pivot. Artwork stays fixed.';pivotPreview.request({kind:'group',drag:d,target:owned});}}else{pivotPreview.cancel();if(groupPivotDrag!==d||d.previewTarget!==owned)return;d.pose=undefined;status=d.status;}
      if(finish){assertGroupPivotDraft(d);stopGroupPivotDraft(false,false);if(!dx&&!dy)restoreGroupPivotDraft(d);else if(d.author){const action=groupPivotAction(),verify=()=>{action.verify();assertGroupPivotDraft(d,false);if(!d.author||!groupPivotAuthor)throw Error('Group pivot release authoring changed.');};verify();promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},verify);return;}else{assertGroupPivotDraft(d,false);const action=groupPivotAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertGroupPivotDraft(d,false);proposal={definition:candidate,layerId:action.owner.layerId,groupPivotPoint:{x:d.x!,y:d.y!},groupPivotPolicy:d.policy};actionError='';status='Unapplied group pivot position. Release did not change history.';}}paint();
    }catch(cause){if((groupPivotDrag===d&&d.previewTarget===owned)||(finish&&!groupPivotDrag))failGroupPivotDraft(d,cause);}
  }
  function beginGroupPivot(e:PointerEvent){const selection=groupPivot,originalCapture=capture,originalPick=pick,policy=groupPivotPolicy,author=groupPivotAuthor,releasePolicy=groupPivotReleasePolicy,x=groupPivotX,y=groupPivotY,inputRevision=groupPivotInputRevision,inputAxes={...groupPivotInputAxes},at=frame,initialBox=canvas.getBoundingClientRect();
    if(!selection||!originalCapture||!groupPivotCanvas||!groupMode)return false;
    const current=()=>{validateSource();if(capture!==originalCapture||groupPivot!==selection||pick!==originalPick||!groupPivotCanvas||groupPivotPolicy!==policy||groupPivotAuthor!==author||groupPivotReleasePolicy!==releasePolicy||!groupMode||frame!==at||groupPivotInputRevision!==inputRevision||groupPivotX!==x||groupPivotY!==y||!sameBox(canvas.getBoundingClientRect(),initialBox))throw Error('The sampled symbol group pivot capture changed.');};
    const verify=()=>{current();const owner=originalCapture.resolveGroup(selection.owner.layerId,selection.owner.shapeId);current();if(JSON.stringify(owner)!==JSON.stringify(selection.owner))throw Error('The original pivot group changed.');};
    try{verify();const handles=groupPivotMarkers();verify();if(!handles||Math.hypot(e.clientX-initialBox.left-handles.original.x,e.clientY-initialBox.top-handles.original.y)>8)return false;
      const box=canvas.getBoundingClientRect(),pointer=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},handles.view),hit=pickPreviewRoot(originalCapture,pointer);verify();if(hit.kind==='blocked'||(hit.kind==='pick'&&(hit.owner.layerId!==selection.owner.layerId||!selection.owner.shapeIds.includes(hit.owner.shapeId)))){status='Foreground artwork owns this group pivot position.';paint();return true;}
      cancelInteraction();verify();if(!sameBox(canvas.getBoundingClientRect(),box))throw Error('The group pivot view changed.');canvas.focus({preventScroll:true});e.preventDefault();const observer=new ResizeObserver(checkDragView);canvas.setPointerCapture(e.pointerId);groupPivotDrag={author,releasePolicy,policy,inputRevision,inputAxes,frame:at,id:e.pointerId,selection,capture:originalCapture,box,view:handles.view,start:pointer,beforeX:x,beforeY:y,x,y,proposal,status,error:actionError,observer};observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);return true;
    }catch(cause){try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return true;}actionFailure(cause);return true;}
  }
  type PivotDrag={author:boolean;releasePolicy:number;policy:number;inputRevision:number;inputAxes:{x:number;y:number};frame:number;previewTarget?:Point;id:number;selection:NonNullable<typeof pivot>;capture:NonNullable<typeof capture>;box:DOMRect;view:RotationView;start:Point;beforeX:number|undefined;beforeY:number|undefined;x:number|undefined;y:number|undefined;proposal:typeof proposal;pose?:NonNullable<typeof proposal>;status:string;error:string;observer:ResizeObserver};
  let pivotDrag=$state.raw<PivotDrag>();
  function changePivotCanvas(enabled:boolean){if(enabled)rootTrajectory=undefined;rootWaypoints=undefined;cancelInteraction();pivotPolicy++;pivotCanvas=enabled;if(proposal?.pivotPolicy!==undefined)discardProposal();if(enabled){nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;}paint();}
  $effect(()=>{if(proposal?.pivotPolicy!==undefined&&(!pivotCanvas||proposal.pivotPolicy!==pivotPolicy)){proposal=undefined;paint();}});
  type PivotPreview={kind:'root';drag:PivotDrag;target:Point}|{kind:'group';drag:GroupPivotDrag;target:Point};
  const pivotPreview=createLatestFrameTask<PivotPreview>({
    admit(job){if((job.kind==='root'?pivotDrag:groupPivotDrag)!==job.drag||job.drag.previewTarget!==job.target||job.drag.x!==job.target.x||job.drag.y!==job.target.y||![job.target.x,job.target.y].every(Number.isFinite))throw Error('Invalid isolated pivot preview request.');return job;},
    run(job,current){
      if(!current()||(job.kind==='root'?pivotDrag:groupPivotDrag)!==job.drag||job.drag.previewTarget!==job.target)return;
      if(job.kind==='root'){const d=job.drag;assertPivotDraft(d);const action=pivotAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertPivotDraft(d);if(current()&&pivotDrag===d&&d.previewTarget===job.target)d.pose={definition:candidate,layerId:action.owner.layerId,pivotPoint:{...job.target},pivotPolicy:d.policy};}
      else {const d=job.drag;assertGroupPivotDraft(d);const action=groupPivotAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertGroupPivotDraft(d);if(current()&&groupPivotDrag===d&&d.previewTarget===job.target)d.pose={definition:candidate,layerId:action.owner.layerId,groupPivotPoint:{...job.target},groupPivotPolicy:d.policy};}
      if(current())paint();
    },
    onError(cause,job,current){if(!current()||(job.kind==='root'?pivotDrag:groupPivotDrag)!==job.drag||job.drag.previewTarget!==job.target)return;if(job.kind==='root')failPivotDraft(job.drag,cause);else failGroupPivotDraft(job.drag,cause);},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function restorePivotDraft(d:PivotDrag){if(pivot===d.selection&&pick===d.selection.pick){const x=pivotX,y=pivotY,ownX=pivotInputAxes.x===d.inputAxes.x&&x===d.x,ownY=pivotInputAxes.y===d.inputAxes.y&&y===d.y;pivotX=ownX?d.beforeX:x;pivotY=ownY?d.beforeY:y;proposal=pivotInputRevision===d.inputRevision&&ownX&&ownY&&(d.proposal?.pivotPolicy===undefined||d.proposal.pivotPolicy===pivotPolicy)?d.proposal:undefined;status=d.status;actionError=d.error;}}
  function stopPivotDraft(restore=true,repaint=true){const d=pivotDrag;if(!d)return;const target=d.previewTarget;pivotPreview.cancel();if(pivotDrag!==d||d.previewTarget!==target)return;pivotDrag=undefined;d.observer.disconnect();window.removeEventListener('scroll',checkDragView,true);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);if(restore)restorePivotDraft(d);if(repaint&&alive)paint();}
  function pivotMarkers(){const selected=pivotCanvas&&!groupMode&&pivot?pickedView():null;if(!selected||!pivot||pivot.pick!==pick)return null;const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),screen=(p:Point)=>({x:(20+p.x*scale)*selected.view.cssWidth/540,y:(20+p.y*scale)*selected.view.cssHeight/330});const proposed=pivotDrag?(pivotDrag.pose?.pivotPoint??pivot.point):(proposal?.pivotPoint??pivot.point);return {...selected,original:screen(pivot.point),proposed:screen(proposed)};}
  function assertPivotInputs(d:PivotDrag,active=true){validateSource();if(!alive||!pivotCanvas||pivotPolicy!==d.policy||pivotAuthor!==d.author||pivotReleasePolicy!==d.releasePolicy||groupMode||(active&&pivotDrag!==d)||pivot!==d.selection||capture!==d.capture||pick!==d.selection.pick||frame!==d.frame||pivotInputRevision!==d.inputRevision||pivotX!==d.x||pivotY!==d.y||!sameBox(canvas.getBoundingClientRect(),d.box)||(active&&!canvas.hasPointerCapture(d.id)))throw Error('Sampled symbol pivot drag changed or lost its view.');}
  function assertPivotDraft(d:PivotDrag,active=true){assertPivotInputs(d,active);const owner=JSON.stringify(d.capture.resolve(d.selection.owner.layerId,d.selection.owner.shapeId)),expected=JSON.stringify(d.selection.owner);assertPivotInputs(d,active);if(owner!==expected)throw Error('The original sampled pivot owner changed.');}
  function failPivotDraft(d:PivotDrag,cause:unknown){stopPivotDraft(false,false);restorePivotDraft(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  function updatePivotDraft(e:PointerEvent,finish=false){const d=pivotDrag;if(!d||e.pointerId!==d.id)return;let owned=d.previewTarget;
    try{if(finish){pivotPreview.cancel();if(pivotDrag!==d||d.previewTarget!==owned)return;}if(finish)assertPivotDraft(d);else assertPivotInputs(d);if(pivotDrag!==d||d.previewTarget!==owned)return;const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},d.view);let dx=point.x-d.start.x,dy=point.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}if(![dx,dy].every(Number.isFinite))throw Error('Invalid pivot pointer coordinates.');
      owned={x:d.selection.point.x+dx,y:d.selection.point.y+dy};d.previewTarget=owned;if(dx||dy){d.x=owned.x;d.y=owned.y;pivotX=d.x;pivotY=d.y;if(!finish){status='Dragging an unapplied pivot. Artwork stays fixed.';pivotPreview.request({kind:'root',drag:d,target:owned});}}
      else{pivotPreview.cancel();if(pivotDrag!==d||d.previewTarget!==owned)return;d.pose=undefined;status=d.status;}
      if(finish){assertPivotDraft(d);stopPivotDraft(false,false);if(!dx&&!dy)restorePivotDraft(d);else if(d.author){const action=pivotAction(),verify=()=>{action.verify();assertPivotDraft(d,false);if(!d.author||!pivotAuthor)throw Error('Pivot release authoring changed.');};verify();promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},verify);return;}else{assertPivotDraft(d,false);const action=pivotAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertPivotDraft(d,false);proposal={definition:candidate,layerId:action.owner.layerId,pivotPoint:{x:d.x!,y:d.y!},pivotPolicy:d.policy};actionError='';status='Unapplied pivot position. Release did not change history.';}}paint();
    }catch(cause){if((pivotDrag===d&&d.previewTarget===owned)||(finish&&!pivotDrag))failPivotDraft(d,cause);}
  }
  function beginPivot(e:PointerEvent){const selection=pivot,originalCapture=capture,originalPick=pick,policy=pivotPolicy,author=pivotAuthor,releasePolicy=pivotReleasePolicy,x=pivotX,y=pivotY,inputRevision=pivotInputRevision,inputAxes={...pivotInputAxes},at=frame,initialBox=canvas.getBoundingClientRect();
    if(!selection||!originalCapture||!pivotCanvas||groupMode)return false;
    const current=()=>{validateSource();if(capture!==originalCapture||pivot!==selection||pick!==originalPick||!pivotCanvas||pivotPolicy!==policy||pivotAuthor!==author||pivotReleasePolicy!==releasePolicy||groupMode||frame!==at||pivotInputRevision!==inputRevision||pivotX!==x||pivotY!==y||!sameBox(canvas.getBoundingClientRect(),initialBox))throw Error('The sampled symbol pivot capture changed.');};
    const verify=()=>{current();originalCapture.resolve(selection.owner.layerId,selection.owner.shapeId);current();};
    try{verify();const handles=pivotMarkers();verify();if(!handles||Math.hypot(e.clientX-initialBox.left-handles.original.x,e.clientY-initialBox.top-handles.original.y)>8)return false;
      const box=canvas.getBoundingClientRect(),pointer=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},handles.view),hit=pickPreviewRoot(originalCapture,pointer);verify();if(hit.kind==='blocked'||(hit.kind==='pick'&&JSON.stringify([hit.owner.layerId,hit.owner.shapeId])!==pick)){status='Foreground artwork owns this pivot position.';paint();return true;}
      cancelInteraction();verify();if(!sameBox(canvas.getBoundingClientRect(),box))throw Error('The sampled pivot view changed.');canvas.focus({preventScroll:true});e.preventDefault();const observer=new ResizeObserver(checkDragView);canvas.setPointerCapture(e.pointerId);pivotDrag={author,releasePolicy,policy,inputRevision,inputAxes,frame:at,id:e.pointerId,selection,capture:originalCapture,box,view:handles.view,start:pointer,beforeX:x,beforeY:y,x,y,proposal,status,error:actionError,observer};observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);return true;
    }catch(cause){try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return true;}actionFailure(cause);return true;}
  }
  let nodeCanvas=$state(false),nodePolicy=0,nodeAuthor=$state(false),nodeReleasePolicy=0;
  type NodeDrag={inputRevision:number;inputAxes:{x:number;y:number};frame:number;previewTarget?:Point;author:boolean;releasePolicy:number;policy:number;id:number;selection:NonNullable<typeof node>;capture:NonNullable<typeof capture>;box:DOMRect;view:RotationView;start:Point;beforeX:number|undefined;beforeY:number|undefined;x:number|undefined;y:number|undefined;proposal:typeof proposal;pose?:NonNullable<typeof proposal>;status:string;error:string;observer:ResizeObserver};
  let nodeDrag=$state.raw<NodeDrag>();
  function restoreNodeDraft(d:NodeDrag){
    if(node===d.selection&&pick===d.selection.pick){const x=nodeX,y=nodeY,ownX=nodeInputAxes.x===d.inputAxes.x&&x===d.x,ownY=nodeInputAxes.y===d.inputAxes.y&&y===d.y;nodeX=ownX?d.beforeX:x;nodeY=ownY?d.beforeY:y;proposal=nodeInputRevision===d.inputRevision&&ownX&&ownY?d.proposal:undefined;status=d.status;actionError=d.error;}
  }
  function stopNodeDraft(restore=true,repaint=true){const d=nodeDrag;if(!d)return;const target=d.previewTarget;nodePreview.cancel();if(nodeDrag!==d||d.previewTarget!==target)return;nodeDrag=undefined;d.observer.disconnect();window.removeEventListener('scroll',checkDragView,true);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);if(restore)restoreNodeDraft(d);if(repaint&&alive)paint();}
  function nodeMarkers(){const selected=nodeCanvas&&!groupMode?pickedView():null;if(!selected||selected.shape.kind!=='bezier')return null;const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height));return {...selected,markers:(selected.shape.nodes??[]).map((anchor,index)=>{const point=worldPoint(selected.shape,anchor);return {index,point,x:(20+point.x*scale)*selected.view.cssWidth/540,y:(20+point.y*scale)*selected.view.cssHeight/330};})};}
  function assertNodeInputs(d:NodeDrag,active=true){validateSource();if(!alive||!nodeCanvas||nodePolicy!==d.policy||nodeReleasePolicy!==d.releasePolicy||nodeAuthor!==d.author||groupMode||(active&&nodeDrag!==d)||node!==d.selection||capture!==d.capture||pick!==d.selection.pick||frame!==d.frame||nodeInputRevision!==d.inputRevision||nodeX!==d.x||nodeY!==d.y||!sameBox(canvas.getBoundingClientRect(),d.box)||(active&&!canvas.hasPointerCapture(d.id)))throw Error('Sampled symbol node drag changed or lost its view.');}
  function assertNodeDraft(d:NodeDrag,active=true){assertNodeInputs(d,active);const owner=JSON.stringify(d.capture.resolveNode(d.selection.owner.layerId,d.selection.owner.shapeId,d.selection.owner.nodeIndex)),expected=JSON.stringify(d.selection.owner);assertNodeInputs(d,active);if(owner!==expected)throw Error('The original sampled node changed.');}
  function failNodeDraft(d:NodeDrag,cause:unknown){stopNodeDraft(false,false);restoreNodeDraft(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  const nodePreview=createLatestFrameTask<{drag:NodeDrag;target:Point}>({
    admit(job){if(nodeDrag!==job.drag||job.drag.previewTarget!==job.target||job.drag.x!==job.target.x||job.drag.y!==job.target.y||![job.target.x,job.target.y].every(Number.isFinite))throw Error('Invalid isolated anchor preview request.');return job;},
    run(job,current){if(!current()||nodeDrag!==job.drag||job.drag.previewTarget!==job.target)return;const d=job.drag;assertNodeDraft(d);const action=nodeAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertNodeDraft(d);if(current()&&nodeDrag===d&&d.previewTarget===job.target){d.pose={definition:candidate,layerId:action.owner.layerId};paint();}},
    onError(cause,job,current){if(current()&&nodeDrag===job.drag&&job.drag.previewTarget===job.target)failNodeDraft(job.drag,cause);},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function updateNodeDraft(e:PointerEvent,finish=false){
    const d=nodeDrag;if(!d||e.pointerId!==d.id)return;let owned=d.previewTarget;
    try{
      if(finish){nodePreview.cancel();if(nodeDrag!==d||d.previewTarget!==owned)return;assertNodeDraft(d);}else assertNodeInputs(d);if(nodeDrag!==d||d.previewTarget!==owned)return;
      const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},d.view);let dx=point.x-d.start.x,dy=point.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}
      const x=d.selection.point.x+dx,y=d.selection.point.y+dy;if(![dx,dy,x,y].every(Number.isFinite))throw Error('Invalid node pointer position.');owned={x,y};d.previewTarget=owned;
      if(dx||dy){d.x=x;d.y=y;nodeX=x;nodeY=y;if(!finish){status=d.author?'Dragging an unapplied node. Valid release authors one local edit.':'Dragging an unapplied node. Release sets position; commit is explicit.';nodePreview.request({drag:d,target:owned});}}
      else{nodePreview.cancel();if(nodeDrag!==d||d.previewTarget!==owned)return;d.pose=undefined;actionError=d.error;status=d.status;}
      if(finish){assertNodeDraft(d);stopNodeDraft(false,false);if(!dx&&!dy)restoreNodeDraft(d);else if(d.author){
        const verify=()=>{assertNodeDraft(d,false);if(!d.author||!nodeAuthor)throw Error('Node release authoring changed.');};verify();const action=nodeAction();promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},()=>{action.verify();verify();});return;
      }else{assertNodeDraft(d,false);const action=nodeAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertNodeDraft(d,false);proposal={definition:candidate,layerId:action.owner.layerId};actionError='';status='Unapplied node position. Release did not change history.';}}paint();
    }catch(cause){if((nodeDrag===d&&d.previewTarget===owned)||(finish&&!nodeDrag))failNodeDraft(d,cause);}
  }
  let tangentCanvas=$state(false),tangentPolicy=0,tangentAuthor=$state(false),tangentReleasePolicy=0;
  let pairedTangentAuthor=$state(false),pairedTangentPolicy=0;
  function changePairedTangentAuthor(enabled:boolean){stopTangentDraft();pairedTangentPolicy++;pairedTangentAuthor=enabled;}
  type TangentDrag={inputRevision:number;inputAxes:{x:number;y:number};frame:number;previewTarget?:Point;pairedAuthor:boolean;pairedPolicy:number;coupled:boolean;couplingRevision:number;author:boolean;releasePolicy:number;id:number;policy:number;selection:NonNullable<typeof tangent>;capture:NonNullable<typeof capture>;box:DOMRect;view:RotationView;start:Point;beforeX:number|undefined;beforeY:number|undefined;x:number|undefined;y:number|undefined;proposal:typeof proposal;pose?:NonNullable<typeof proposal>;status:string;error:string;observer:ResizeObserver};
  let tangentDrag=$state.raw<TangentDrag>();
  $effect(()=>{if(!node||!nodeShape)tangentCanvas=false;});
  function restoreTangentDraft(d:TangentDrag){if(tangent===d.selection&&node===d.selection.selection&&pick===d.selection.selection.pick){const x=tangentX,y=tangentY,ownX=tangentInputAxes.x===d.inputAxes.x&&x===d.x,ownY=tangentInputAxes.y===d.inputAxes.y&&y===d.y;tangentX=ownX?d.beforeX:x;tangentY=ownY?d.beforeY:y;const sameMode=tangentCoupled===d.coupled&&tangentCouplingRevision===d.couplingRevision;proposal=tangentInputRevision===d.inputRevision&&ownX&&ownY&&sameMode?d.proposal:undefined;status=sameMode?d.status:'';actionError=sameMode?d.error:'';}}
  function stopTangentDraft(restore=true,repaint=true){const d=tangentDrag;if(!d)return;const target=d.previewTarget;tangentPreview.cancel();if(tangentDrag!==d||d.previewTarget!==target)return;tangentDrag=undefined;d.observer.disconnect();window.removeEventListener('scroll',checkDragView,true);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);if(restore)restoreTangentDraft(d);if(repaint&&alive)paint();}
  function tangentMarkers(){const selected=(!tangentCoupled||tangentParts.length===2)&&tangentCanvas&&!groupMode&&node?pickedView():null;if(!selected||selected.shape.kind!=='bezier'||selected.shape.contours?.length||!node)return null;const anchor=selected.shape.nodes?.[node.owner.nodeIndex];if(!anchor)return null;const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),screen=(p:Point)=>({x:(20+p.x*scale)*selected.view.cssWidth/540,y:(20+p.y*scale)*selected.view.cssHeight/330});return {...selected,anchor:screen(worldPoint(selected.shape,anchor)),markers:tangentParts.map(part=>({part,...screen(worldPoint(selected.shape,anchor[part]!))}))};}
  function assertTangentInputs(d:TangentDrag,active=true){validateSource();if(!alive||tangentCoupled!==d.coupled||tangentCouplingRevision!==d.couplingRevision||(d.coupled&&(pairedTangentAuthor!==d.pairedAuthor||pairedTangentPolicy!==d.pairedPolicy))||!tangentCanvas||tangentPolicy!==d.policy||tangentReleasePolicy!==d.releasePolicy||tangentAuthor!==d.author||groupMode||(active&&tangentDrag!==d)||tangent!==d.selection||node!==d.selection.selection||capture!==d.capture||pick!==d.selection.selection.pick||frame!==d.frame||tangentInputRevision!==d.inputRevision||tangentX!==d.x||tangentY!==d.y||!sameBox(canvas.getBoundingClientRect(),d.box)||(active&&!canvas.hasPointerCapture(d.id)))throw Error('Sampled symbol tangent drag changed or lost its view.');}
  function assertTangentDraft(d:TangentDrag,active=true){assertTangentInputs(d,active);const owner=JSON.stringify(d.capture.resolveTangent(d.selection.owner.layerId,d.selection.owner.shapeId,d.selection.owner.nodeIndex,d.selection.owner.part)),expected=JSON.stringify(d.selection.owner);assertTangentInputs(d,active);if(owner!==expected)throw Error('The original sampled tangent changed.');}
  function failTangentDraft(d:TangentDrag,cause:unknown){stopTangentDraft(false,false);restoreTangentDraft(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  const tangentPreview=createLatestFrameTask<{drag:TangentDrag;target:Point}>({
    admit(job){if(tangentDrag!==job.drag||job.drag.previewTarget!==job.target||job.drag.x!==job.target.x||job.drag.y!==job.target.y||![job.target.x,job.target.y].every(Number.isFinite))throw Error('Invalid isolated tangent preview request.');return job;},
    run(job,current){if(!current()||tangentDrag!==job.drag||job.drag.previewTarget!==job.target)return;const d=job.drag;assertTangentDraft(d);const action=tangentAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertTangentDraft(d);if(current()&&tangentDrag===d&&d.previewTarget===job.target){d.pose={definition:candidate,layerId:action.owner.layerId};paint();}},
    onError(cause,job,current){if(current()&&tangentDrag===job.drag&&job.drag.previewTarget===job.target)failTangentDraft(job.drag,cause);},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function updateTangentDraft(e:PointerEvent,finish=false){
    const d=tangentDrag;if(!d||e.pointerId!==d.id)return;let owned=d.previewTarget;
    try{if(finish){tangentPreview.cancel();if(tangentDrag!==d||d.previewTarget!==owned)return;assertTangentDraft(d);}else assertTangentInputs(d);if(tangentDrag!==d||d.previewTarget!==owned)return;
      const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},d.view);let dx=point.x-d.start.x,dy=point.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}const x=d.selection.point.x+dx,y=d.selection.point.y+dy;if(![dx,dy,x,y].every(Number.isFinite))throw Error('Invalid tangent pointer position.');owned={x,y};d.previewTarget=owned;
      if(dx||dy){d.x=x;d.y=y;tangentX=x;tangentY=y;if(!finish){status=(d.coupled?d.pairedAuthor:d.author)?'Dragging an unapplied tangent. Valid release authors one local edit.':'Dragging an unapplied tangent. Release sets position; commit is explicit.';tangentPreview.request({drag:d,target:owned});}}else{tangentPreview.cancel();if(tangentDrag!==d||d.previewTarget!==owned)return;d.pose=undefined;actionError=d.error;status=d.status;}
      if(finish){assertTangentDraft(d);stopTangentDraft(false,false);if(!dx&&!dy)restoreTangentDraft(d);else if(d.coupled?d.pairedAuthor:d.author){const verify=()=>{assertTangentDraft(d,false);if(d.coupled?(!d.pairedAuthor||!pairedTangentAuthor):(!d.author||!tangentAuthor))throw Error('Tangent release authoring changed.');};verify();const action=tangentAction();promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},()=>{action.verify();verify();});return;}else{assertTangentDraft(d,false);const action=tangentAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertTangentDraft(d,false);proposal={definition:candidate,layerId:action.owner.layerId};actionError='';status='Unapplied tangent position. Release did not change history.';}}paint();
    }catch(cause){if((tangentDrag===d&&d.previewTarget===owned)||(finish&&!tangentDrag))failTangentDraft(d,cause);}
  }
  let compoundCanvas=$state(false),compoundPolicy=0,compoundAuthor=$state(false),compoundReleasePolicy=0;
  function changeCompoundAuthor(enabled:boolean){stopCompoundDraft();compoundReleasePolicy++;compoundAuthor=enabled;}
  type CompoundDrag={inputRevision:number;inputAxes:{x:number;y:number};frame:number;previewTarget?:Point;author:boolean;releasePolicy:number;id:number;policy:number;selection:NonNullable<typeof compound>;capture:NonNullable<typeof capture>;coupled:boolean;couplingRevision:number;box:DOMRect;view:RotationView;start:Point;beforeX:number|undefined;beforeY:number|undefined;x:number|undefined;y:number|undefined;proposal:typeof proposal;pose?:NonNullable<typeof proposal>;status:string;error:string;observer:ResizeObserver};
  let compoundDrag=$state.raw<CompoundDrag>();
  function changeCompoundCanvas(enabled:boolean){if(enabled)rootTrajectory=undefined;rootWaypoints=undefined;cancelInteraction();compoundPolicy++;compoundCanvas=enabled;if(enabled){pivotCanvas=false;compoundNodeCanvas=false;nodeCanvas=false;tangentCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;}paint();}
  $effect(()=>{if(!compoundShape)compoundCanvas=false;});
  function restoreCompoundDraft(d:CompoundDrag){if(compound===d.selection&&pick===d.selection.pick){const x=compoundX,y=compoundY,ownX=compoundInputAxes.x===d.inputAxes.x&&x===d.x,ownY=compoundInputAxes.y===d.inputAxes.y&&y===d.y;compoundX=ownX?d.beforeX:x;compoundY=ownY?d.beforeY:y;const sameMode=compoundCoupled===d.coupled&&compoundRevision===d.couplingRevision;proposal=compoundInputRevision===d.inputRevision&&ownX&&ownY&&sameMode?d.proposal:undefined;status=sameMode?d.status:'';actionError=sameMode?d.error:'';}}
  function stopCompoundDraft(restore=true,repaint=true){const d=compoundDrag;if(!d)return;const target=d.previewTarget;compoundPreview.cancel();if(compoundDrag!==d||d.previewTarget!==target)return;compoundDrag=undefined;d.observer.disconnect();window.removeEventListener('scroll',checkDragView,true);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);if(restore)restoreCompoundDraft(d);if(repaint&&alive)paint();}
  function compoundMarkers(){const selected=compoundCanvas&&!groupMode&&(!compoundCoupled||compoundParts.length===2)?pickedView():null;if(!selected||!compoundShape||!compoundAnchor)return null;const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),screen=(p:Point)=>({x:(20+p.x*scale)*selected.view.cssWidth/540,y:(20+p.y*scale)*selected.view.cssHeight/330});return {...selected,anchor:screen(worldPoint(selected.shape,compoundAnchor)),markers:compoundParts.map(part=>({part,...screen(worldPoint(selected.shape,compoundAnchor[part]!))}))};}
  function assertCompoundInputs(d:CompoundDrag,active=true){validateSource();const o=d.selection.owner;if(!alive||!compoundCanvas||compoundCoupled!==d.coupled||compoundRevision!==d.couplingRevision||compoundPolicy!==d.policy||compoundAuthor!==d.author||compoundReleasePolicy!==d.releasePolicy||groupMode||(active&&compoundDrag!==d)||compound!==d.selection||capture!==d.capture||pick!==d.selection.pick||frame!==d.frame||compoundInputRevision!==d.inputRevision||compoundContour!==o.contourIndex+1||compoundNode!==o.nodeIndex+1||compoundX!==d.x||compoundY!==d.y||!sameBox(canvas.getBoundingClientRect(),d.box)||(active&&!canvas.hasPointerCapture(d.id)))throw Error('Sampled symbol compound tangent drag changed or lost its view.');}
  function assertCompoundDraft(d:CompoundDrag,active=true){assertCompoundInputs(d,active);const o=d.selection.owner,actual=JSON.stringify(d.capture.resolveCompoundTangent(o.layerId,o.shapeId,o.contourIndex,o.nodeIndex,o.part)),expected=JSON.stringify(o);assertCompoundInputs(d,active);if(actual!==expected)throw Error('The original sampled compound tangent changed.');}
  function failCompoundDraft(d:CompoundDrag,cause:unknown){stopCompoundDraft(false,false);restoreCompoundDraft(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  const compoundPreview=createLatestFrameTask<{drag:CompoundDrag;target:Point}>({
    admit(job){if(compoundDrag!==job.drag||job.drag.previewTarget!==job.target||job.drag.x!==job.target.x||job.drag.y!==job.target.y||![job.target.x,job.target.y].every(Number.isFinite))throw Error('Invalid isolated compound tangent preview request.');return job;},
    run(job,current){if(!current()||compoundDrag!==job.drag||job.drag.previewTarget!==job.target)return;const d=job.drag;assertCompoundDraft(d);const action=compoundAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertCompoundDraft(d);if(current()&&compoundDrag===d&&d.previewTarget===job.target){d.pose={definition:candidate,layerId:action.owner.layerId};paint();}},
    onError(cause,job,current){if(current()&&compoundDrag===job.drag&&job.drag.previewTarget===job.target)failCompoundDraft(job.drag,cause);},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function updateCompoundDraft(e:PointerEvent,finish=false){
    const d=compoundDrag;if(!d||e.pointerId!==d.id)return;let owned=d.previewTarget;
    try{
      if(finish){compoundPreview.cancel();if(compoundDrag!==d||d.previewTarget!==owned)return;assertCompoundDraft(d);}else assertCompoundInputs(d);if(compoundDrag!==d||d.previewTarget!==owned)return;
      const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},d.view);let dx=point.x-d.start.x,dy=point.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}
      const x=d.selection.point.x+dx,y=d.selection.point.y+dy;if(![dx,dy,x,y].every(Number.isFinite))throw Error('Invalid compound tangent pointer position.');owned={x,y};d.previewTarget=owned;
      if(dx||dy){d.x=x;d.y=y;compoundX=x;compoundY=y;if(!finish){status=d.author?'Dragging an unapplied compound tangent. Valid release authors one local edit.':'Dragging an unapplied compound tangent. Release sets position; commit is explicit.';compoundPreview.request({drag:d,target:owned});}}
      else{compoundPreview.cancel();if(compoundDrag!==d||d.previewTarget!==owned)return;d.pose=undefined;actionError=d.error;status=d.status;}
      if(finish){assertCompoundDraft(d);stopCompoundDraft(false,false);if(!dx&&!dy)restoreCompoundDraft(d);else if(d.author){const verify=()=>{assertCompoundDraft(d,false);if(!compoundAuthor||!d.author)throw Error('Compound tangent release authoring changed.');};verify();const action=compoundAction();promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},()=>{action.verify();verify();});return;}else{assertCompoundDraft(d,false);const action=compoundAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertCompoundDraft(d,false);proposal={definition:candidate,layerId:action.owner.layerId};actionError='';status='Unapplied compound tangent position. Release did not change history.';}}paint();
    }catch(cause){if((compoundDrag===d&&d.previewTarget===owned)||(finish&&!compoundDrag))failCompoundDraft(d,cause);}
  }
  let compoundNodeCanvas=$state(false),compoundNodePolicy=0,compoundNodeAuthor=$state(false),compoundNodeReleasePolicy=0;
  function changeCompoundNodeAuthor(enabled:boolean){stopCompoundNodeDraft();compoundNodeReleasePolicy++;compoundNodeAuthor=enabled;}
  type CompoundNodeDrag={inputRevision:number;inputAxes:{x:number;y:number};frame:number;previewTarget?:Point;author:boolean;releasePolicy:number;id:number;policy:number;selection:NonNullable<typeof compoundNodeSelection>;capture:NonNullable<typeof capture>;box:DOMRect;view:RotationView;start:Point;beforeX:number|undefined;beforeY:number|undefined;x:number|undefined;y:number|undefined;proposal:typeof proposal;pose?:NonNullable<typeof proposal>;status:string;error:string;observer:ResizeObserver};
  let compoundNodeDrag=$state.raw<CompoundNodeDrag>();
  function changeCompoundNodeCanvas(enabled:boolean){if(enabled)rootTrajectory=undefined;rootWaypoints=undefined;cancelInteraction();compoundNodePolicy++;compoundNodeCanvas=enabled;if(enabled){pivotCanvas=false;compoundCanvas=false;nodeCanvas=false;tangentCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;}paint();}
  $effect(()=>{if(!compoundShape)compoundNodeCanvas=false;});
  function restoreCompoundNodeDraft(d:CompoundNodeDrag){if(compoundNodeSelection===d.selection&&pick===d.selection.pick){const x=anchorX,y=anchorY,ownX=compoundNodeInputAxes.x===d.inputAxes.x&&x===d.x,ownY=compoundNodeInputAxes.y===d.inputAxes.y&&y===d.y;anchorX=ownX?d.beforeX:x;anchorY=ownY?d.beforeY:y;proposal=compoundNodeInputRevision===d.inputRevision&&ownX&&ownY?d.proposal:undefined;status=d.status;actionError=d.error;}}
  function stopCompoundNodeDraft(restore=true,repaint=true){const d=compoundNodeDrag;if(!d)return;const target=d.previewTarget;compoundNodePreview.cancel();if(compoundNodeDrag!==d||d.previewTarget!==target)return;compoundNodeDrag=undefined;d.observer.disconnect();window.removeEventListener('scroll',checkDragView,true);if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);if(restore)restoreCompoundNodeDraft(d);if(repaint&&alive)paint();}
  function compoundNodeMarkers(){const selected=compoundNodeCanvas&&!groupMode?pickedView():null;if(!selected||!compoundShape)return null;const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),screen=(p:Point)=>({x:(20+p.x*scale)*selected.view.cssWidth/540,y:(20+p.y*scale)*selected.view.cssHeight/330});return {...selected,markers:selected.shape.contours!.flatMap((ring,contour)=>ring.map((node,index)=>({contour,index,...screen(worldPoint(selected.shape,node))})))};}
  function assertCompoundNodeInputs(d:CompoundNodeDrag,active=true){validateSource();const o=d.selection.owner;if(!alive||!compoundNodeCanvas||compoundNodePolicy!==d.policy||compoundNodeAuthor!==d.author||compoundNodeReleasePolicy!==d.releasePolicy||groupMode||(active&&compoundNodeDrag!==d)||compoundNodeSelection!==d.selection||capture!==d.capture||pick!==d.selection.pick||frame!==d.frame||compoundNodeInputRevision!==d.inputRevision||anchorContour!==o.contourIndex+1||anchorIndex!==o.nodeIndex+1||anchorX!==d.x||anchorY!==d.y||!sameBox(canvas.getBoundingClientRect(),d.box)||(active&&!canvas.hasPointerCapture(d.id)))throw Error('Sampled symbol compound anchor drag changed or lost its view.');}
  function assertCompoundNodeDraft(d:CompoundNodeDrag,active=true){assertCompoundNodeInputs(d,active);const o=d.selection.owner,actual=JSON.stringify(d.capture.resolveCompoundNode(o.layerId,o.shapeId,o.contourIndex,o.nodeIndex)),expected=JSON.stringify(o);assertCompoundNodeInputs(d,active);if(actual!==expected)throw Error('The original sampled compound anchor changed.');}
  function failCompoundNodeDraft(d:CompoundNodeDrag,cause:unknown){stopCompoundNodeDraft(false,false);restoreCompoundNodeDraft(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  const compoundNodePreview=createLatestFrameTask<{drag:CompoundNodeDrag;target:Point}>({
    admit(job){if(compoundNodeDrag!==job.drag||job.drag.previewTarget!==job.target||job.drag.x!==job.target.x||job.drag.y!==job.target.y||![job.target.x,job.target.y].every(Number.isFinite))throw Error('Invalid isolated compound anchor preview request.');return job;},
    run(job,current){if(!current()||compoundNodeDrag!==job.drag||job.drag.previewTarget!==job.target)return;const d=job.drag;assertCompoundNodeDraft(d);const action=compoundNodeAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertCompoundNodeDraft(d);if(current()&&compoundNodeDrag===d&&d.previewTarget===job.target){d.pose={definition:candidate,layerId:action.owner.layerId};paint();}},
    onError(cause,job,current){if(current()&&compoundNodeDrag===job.drag&&job.drag.previewTarget===job.target)failCompoundNodeDraft(job.drag,cause);},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function updateCompoundNodeDraft(e:PointerEvent,finish=false){
    const d=compoundNodeDrag;if(!d||e.pointerId!==d.id)return;let owned=d.previewTarget;
    try{
      if(finish){compoundNodePreview.cancel();if(compoundNodeDrag!==d||d.previewTarget!==owned)return;assertCompoundNodeDraft(d);}else assertCompoundNodeInputs(d);if(compoundNodeDrag!==d||d.previewTarget!==owned)return;
      const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},d.view);let dx=point.x-d.start.x,dy=point.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}
      const x=d.selection.point.x+dx,y=d.selection.point.y+dy;if(![dx,dy,x,y].every(Number.isFinite))throw Error('Invalid compound anchor pointer position.');owned={x,y};d.previewTarget=owned;
      if(dx||dy){d.x=x;d.y=y;anchorX=x;anchorY=y;if(!finish){status=d.author?'Dragging an unapplied compound anchor. Valid release authors one local edit.':'Dragging an unapplied compound anchor. Release sets position; commit is explicit.';compoundNodePreview.request({drag:d,target:owned});}}
      else{compoundNodePreview.cancel();if(compoundNodeDrag!==d||d.previewTarget!==owned)return;d.pose=undefined;actionError=d.error;status=d.status;}
      if(finish){assertCompoundNodeDraft(d);stopCompoundNodeDraft(false,false);if(!dx&&!dy)restoreCompoundNodeDraft(d);else if(d.author){const verify=()=>{assertCompoundNodeDraft(d,false);if(!compoundNodeAuthor||!d.author)throw Error('Compound anchor release authoring changed.');};verify();const action=compoundNodeAction();promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},()=>{action.verify();verify();});return;}else{assertCompoundNodeDraft(d,false);const action=compoundNodeAction(),candidate=action.prepare();validateCandidate(candidate);action.verify();assertCompoundNodeDraft(d,false);proposal={definition:candidate,layerId:action.owner.layerId};actionError='';status='Unapplied compound anchor position. Release did not change history.';}}paint();
    }catch(cause){if((compoundNodeDrag===d&&d.previewTarget===owned)||(finish&&!compoundNodeDrag))failCompoundNodeDraft(d,cause);}
  }
  function assertTranslationInputs(d:Drag,active=true){
    validateSource();const job=d.translation!;const current=()=>{if(!alive||failure||!job||groupMode!==d.group||(active&&drag!==d)||capture!==d.capture||pick!==d.pick||frame!==job.frame||!dragEnabled||rotateHandle!==job.handles.rotation||scaleHandles!==job.handles.scaling||skewHandles!==job.handles.skewing||translationPolicy!==job.policy||(d.group?translationGroupAuthorPolicy:translationAuthorPolicy)!==job.authorPolicy||(d.group?groupAuthorOnRelease:authorOnRelease)!==d.author||translationInputRevision!==job.inputRevision||moveX!==d.expectedX||moveY!==d.expectedY||(active&&!canvas.hasPointerCapture(d.id)))throw Error('The original symbol translation changed.');};current();if(!sameBox(canvas.getBoundingClientRect(),d.box))throw Error('The symbol translation view changed.');current();
  }
  function assertTranslation(d:Drag,active=true){assertTranslationInputs(d,active);const owner=JSON.stringify(d.group?d.capture.resolveGroup(d.owner.layerId,d.owner.shapeId):d.capture.resolve(d.owner.layerId,d.owner.shapeId));assertTranslationInputs(d,active);if(owner!==JSON.stringify(d.owner))throw Error('The original symbol translation membership changed.');}
  function restoreTranslation(d:Drag){const job=d.translation!;if(pick!==d.pick)return;const ownX=translationInputAxes.x===job.inputAxes.x&&moveX===d.expectedX,ownY=translationInputAxes.y===job.inputAxes.y&&moveY===d.expectedY;if(ownX)moveX=d.beforeX;if(ownY)moveY=d.beforeY;proposal=ownX&&ownY&&translationInputRevision===job.inputRevision?d.proposal:undefined;status=d.status;actionError=d.error;}
  const translationPreview=createLatestFrameTask<{drag:Drag;target:Point}>({
    admit(request){if(drag!==request.drag||request.drag.translation?.target!==request.target||![request.target.x,request.target.y].every(Number.isFinite))throw Error('Invalid symbol translation preview request.');return request;},
    run({drag:d,target},current){if(!current()||drag!==d||d.translation?.target!==target)return;assertTranslation(d);const action=prepareAction(target,d),candidate=action.prepare();validateCandidate(candidate);action.verify();assertTranslation(d);if(current()&&drag===d&&d.translation?.target===target){d.translation.pose={definition:candidate,layerId:action.owner.layerId};paint();}},
    onError(cause,{drag:d,target},current){if(!current()||drag!==d||d.translation?.target!==target)return;try{assertTranslation(d);if(current()&&drag===d&&d.translation?.target===target){d.translation.pose=undefined;actionFailure(cause);}}catch(stale){if(current()&&drag===d&&d.translation?.target===target)failTranslation(d,stale);}},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function failTranslation(d:Drag,cause:unknown){stopDrag(false,false);restoreTranslation(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);status='Drag canceled. '+String(cause);paint();}
  function assertRotationInputs(d:Drag,active=true){validateSource();const job=d.rotation!;const current=()=>{if(!alive||failure||!job||groupMode!==d.group||(active&&drag!==d)||capture!==d.capture||pick!==d.pick||frame!==job.frame||!rotateHandle||scaleHandles!==job.scaling||skewHandles||rotationPolicy!==job.policy||rotationInputRevision!==job.inputRevision||angle!==job.expected||moveX!==d.expectedX||moveY!==d.expectedY||(active&&!canvas.hasPointerCapture(d.id)))throw Error('The original symbol rotation changed.');};current();if(!sameBox(canvas.getBoundingClientRect(),d.box))throw Error('The symbol rotation view changed.');current();}
  function assertRotation(d:Drag,active=true){assertRotationInputs(d,active);const owner=JSON.stringify(d.group?d.capture.resolveGroup(d.owner.layerId,d.owner.shapeId):d.capture.resolve(d.owner.layerId,d.owner.shapeId));assertRotationInputs(d,active);if(owner!==JSON.stringify(d.owner))throw Error('The original symbol rotation membership changed.');}
  function restoreRotation(d:Drag){const job=d.rotation!;if(pick!==d.pick)return;const owned=rotationInputRevision===job.inputRevision&&angle===job.expected;if(owned)angle=job.before;if(moveX===d.expectedX)moveX=d.beforeX;if(moveY===d.expectedY)moveY=d.beforeY;proposal=owned&&moveX===d.beforeX&&moveY===d.beforeY?d.proposal:undefined;status=d.status;actionError=d.error;}
  const rotationPreview=createLatestFrameTask<{drag:Drag;target:{degrees:number}}>({
    admit(request){if(drag!==request.drag||request.drag.rotation?.target!==request.target||!Number.isFinite(request.target.degrees))throw Error('Invalid symbol rotation preview.');return request;},
    run({drag:d,target},current){if(!current()||drag!==d||d.rotation?.target!==target)return;assertRotation(d);const action=prepareAction(undefined,d,target.degrees),candidate=action.prepare();validateCandidate(candidate);action.verify();assertRotation(d);if(current()&&drag===d&&d.rotation?.target===target){d.rotation.pose={definition:candidate,layerId:action.owner.layerId};d.rotation.poseDegrees=target.degrees;paint();}},
    onError(cause,{drag:d,target},current){if(!current()||drag!==d||d.rotation?.target!==target)return;try{assertRotation(d);if(current()&&drag===d&&d.rotation?.target===target){d.rotation.pose=undefined;d.rotation.poseDegrees=undefined;actionFailure(cause);}}catch(stale){if(current()&&drag===d&&d.rotation?.target===target)failRotation(d,stale);}},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function failRotation(d:Drag,cause:unknown){stopDrag(false,false);restoreRotation(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  function assertScaleInputs(d:Drag,active=true){validateSource();const job=d.scaling!;const current=()=>{if(!alive||failure||!job||groupMode!==d.group||(active&&drag!==d)||capture!==d.capture||pick!==d.pick||frame!==job.frame||!scaleHandles||rotateHandle!==job.rotation||skewHandles||scalePolicy!==job.policy||scaleInputRevision!==job.inputRevision||scaleX!==job.expected.x*100||scaleY!==job.expected.y*100||moveX!==d.expectedX||moveY!==d.expectedY||(active&&!canvas.hasPointerCapture(d.id)))throw Error('The original symbol scale changed.');};current();if(!sameBox(canvas.getBoundingClientRect(),d.box))throw Error('The symbol scale view changed.');current();}
  function assertScale(d:Drag,active=true){assertScaleInputs(d,active);const owner=JSON.stringify(d.group?d.capture.resolveGroup(d.owner.layerId,d.owner.shapeId):d.capture.resolve(d.owner.layerId,d.owner.shapeId));assertScaleInputs(d,active);if(owner!==JSON.stringify(d.owner))throw Error('The original symbol scale membership changed.');}
  function restoreScale(d:Drag){const job=d.scaling!;if(pick!==d.pick)return;const ownX=scaleInputAxes.x===job.inputAxes.x&&scaleX===job.expected.x*100,ownY=scaleInputAxes.y===job.inputAxes.y&&scaleY===job.expected.y*100;if(ownX)scaleX=job.beforeX;if(ownY)scaleY=job.beforeY;if(moveX===d.expectedX)moveX=d.beforeX;if(moveY===d.expectedY)moveY=d.beforeY;proposal=ownX&&ownY&&scaleInputRevision===job.inputRevision&&moveX===d.beforeX&&moveY===d.beforeY?d.proposal:undefined;status=d.status;actionError=d.error;}
  const scalePreview=createLatestFrameTask<{drag:Drag;target:Point}>({
    admit(request){if(drag!==request.drag||request.drag.scaling?.target!==request.target||![request.target.x,request.target.y].every(Number.isFinite))throw Error('Invalid symbol scale preview.');return request;},
    run({drag:d,target},current){if(!current()||drag!==d||d.scaling?.target!==target)return;assertScale(d);const action=prepareAction(undefined,d,undefined,target),candidate=action.prepare();validateCandidate(candidate);action.verify();assertScale(d);if(current()&&drag===d&&d.scaling?.target===target){d.scaling.pose={definition:candidate,layerId:action.owner.layerId};d.scaling.poseFactors=target;paint();}},
    onError(cause,{drag:d,target},current){if(!current()||drag!==d||d.scaling?.target!==target)return;try{assertScale(d);if(current()&&drag===d&&d.scaling?.target===target){d.scaling.pose=undefined;d.scaling.poseFactors=undefined;actionFailure(cause);}}catch(stale){if(current()&&drag===d&&d.scaling?.target===target)failScale(d,stale);}},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function failScale(d:Drag,cause:unknown){stopDrag(false,false);restoreScale(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  function assertSkewInputs(d:Drag,active=true){validateSource();const job=d.skewing!;const current=()=>{if(!alive||failure||!job||groupMode!==d.group||(active&&drag!==d)||capture!==d.capture||pick!==d.pick||frame!==job.frame||!skewHandles||rotateHandle!==job.rotation||scaleHandles!==job.scaling||skewPolicy!==job.policy||skewInputRevision!==job.inputRevision||skewAxis!==job.axis||skewAngle!==job.expected||moveX!==d.expectedX||moveY!==d.expectedY||(active&&!canvas.hasPointerCapture(d.id)))throw Error('The original symbol skew changed.');};current();if(!sameBox(canvas.getBoundingClientRect(),d.box))throw Error('The symbol skew view changed.');current();}
  function assertSkew(d:Drag,active=true){assertSkewInputs(d,active);const owner=JSON.stringify(d.group?d.capture.resolveGroup(d.owner.layerId,d.owner.shapeId):d.capture.resolve(d.owner.layerId,d.owner.shapeId));assertSkewInputs(d,active);if(owner!==JSON.stringify(d.owner))throw Error('The original symbol skew membership changed.');}
  function restoreSkew(d:Drag){const job=d.skewing!;if(pick!==d.pick)return;const ownAxis=skewInputAxes.axis===job.inputAxes.axis&&skewAxis===job.axis,ownAngle=skewInputAxes.angle===job.inputAxes.angle&&skewAngle===job.expected;if(ownAxis)skewAxis=job.beforeAxis;if(ownAngle)skewAngle=job.beforeAngle;if(moveX===d.expectedX)moveX=d.beforeX;if(moveY===d.expectedY)moveY=d.beforeY;proposal=ownAxis&&ownAngle&&skewInputRevision===job.inputRevision&&moveX===d.beforeX&&moveY===d.beforeY?d.proposal:undefined;status=d.status;actionError=d.error;}
  const skewPreview=createLatestFrameTask<{drag:Drag;target:{axis:'x'|'y';degrees:number}}>({
    admit(request){if(drag!==request.drag||request.drag.skewing?.target!==request.target||!Number.isFinite(request.target.degrees))throw Error('Invalid symbol skew preview.');return request;},
    run({drag:d,target},current){if(!current()||drag!==d||d.skewing?.target!==target)return;assertSkew(d);const action=prepareAction(undefined,d,undefined,undefined,target),candidate=action.prepare();validateCandidate(candidate);action.verify();assertSkew(d);if(current()&&drag===d&&d.skewing?.target===target){d.skewing.pose={definition:candidate,layerId:action.owner.layerId};d.skewing.poseSkew=target;paint();}},
    onError(cause,{drag:d,target},current){if(!current()||drag!==d||d.skewing?.target!==target)return;try{assertSkew(d);if(current()&&drag===d&&d.skewing?.target===target){d.skewing.pose=undefined;d.skewing.poseSkew=undefined;actionFailure(cause);}}catch(stale){if(current()&&drag===d&&d.skewing?.target===target)failSkew(d,stale);}},
    requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:handle=>cancelAnimationFrame(handle),
  });
  function failSkew(d:Drag,cause:unknown){stopDrag(false,false);restoreSkew(d);try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}actionError=String(cause);paint();}
  function stopDrag(restore=true,repaint=true){stopGroupCurveDraft(restore,repaint);stopRootCurveDraft(restore,repaint);stopRootWaypointDraft(restore,repaint);
    stopWaypointDraft(restore,repaint);stopGroupPivotDraft(restore,repaint);stopPivotDraft(restore,repaint);stopCompoundNodeDraft(restore,repaint);stopCompoundDraft(restore,repaint);stopTangentDraft(restore,repaint);stopNodeDraft(restore,repaint);
    const d=drag;translationPreview.cancel();rotationPreview.cancel();scalePreview.cancel();skewPreview.cancel();if(!d||drag!==d)return;drag=undefined;d.observer.disconnect();
    window.removeEventListener('scroll',checkDragView,true);
    if(canvas.hasPointerCapture(d.id))canvas.releasePointerCapture(d.id);
    if(restore){if(d.skewing)restoreSkew(d);else if(d.scaling)restoreScale(d);else if(d.rotation)restoreRotation(d);else if(d.translation)restoreTranslation(d);else{moveX=d.beforeX;moveY=d.beforeY;proposal=d.proposal;status=d.status;actionError=d.error;}}
    if(repaint&&alive)paint();
  }
  function cancelInteraction(){clearPress();stopDrag();}
  function sameBox(a:DOMRect,b:DOMRect){return a.left===b.left&&a.top===b.top&&a.width===b.width&&a.height===b.height;}
  function checkDragView(){if(groupCurveDrag&&!sameBox(canvas.getBoundingClientRect(),groupCurveDrag.box))stopGroupCurveDraft();if(rootCurveDrag&&!sameBox(canvas.getBoundingClientRect(),rootCurveDrag.box))stopRootCurveDraft();if(rootWaypointDrag&&!sameBox(canvas.getBoundingClientRect(),rootWaypointDrag.box))stopRootWaypointDraft();if(waypointDrag&&!sameBox(canvas.getBoundingClientRect(),waypointDrag.box))stopWaypointDraft();if(groupPivotDrag&&!sameBox(canvas.getBoundingClientRect(),groupPivotDrag.box))stopGroupPivotDraft();if(pivotDrag&&!sameBox(canvas.getBoundingClientRect(),pivotDrag.box))stopPivotDraft();if(compoundNodeDrag&&!sameBox(canvas.getBoundingClientRect(),compoundNodeDrag.box))stopCompoundNodeDraft();if(compoundDrag&&!sameBox(canvas.getBoundingClientRect(),compoundDrag.box))stopCompoundDraft();if(tangentDrag&&!sameBox(canvas.getBoundingClientRect(),tangentDrag.box))stopTangentDraft();if(nodeDrag&&!sameBox(canvas.getBoundingClientRect(),nodeDrag.box))stopNodeDraft();if(drag&&!sameBox(canvas.getBoundingClientRect(),drag.box))stopDrag();}
  function authorRelease(d:Drag,offset?:Point,degrees?:number,scale?:Point,skew?:{axis:'x'|'y';degrees:number}){
    try{
      const action=prepareAction(offset,undefined,degrees,scale,skew);
      const verify=()=>{
        action.verify();if(d.translation)assertTranslation(d,false);if(d.rotation)assertRotation(d,false);if(d.scaling)assertScale(d,false);if(d.skewing)assertSkew(d,false);
        if((d.skewing?!skewHandles:d.scaling?!scaleHandles:d.rotation?!rotateHandle:!(d.group?groupAuthorOnRelease:authorOnRelease)||!dragEnabled)||groupMode!==d.group||JSON.stringify(action.owner)!==JSON.stringify(d.owner)||capture!==d.capture||pick!==d.pick||!sameBox(canvas.getBoundingClientRect(),d.box))
          throw new Error('Sampled symbol release changed. Drag the pose again.');
      };
      promote(action.owner,()=>{verify();const candidate=action.prepare();verify();return candidate;},verify);
    }catch(cause){
      if(d.translation)restoreTranslation(d);else{if(moveX===d.expectedX)moveX=d.beforeX;if(moveY===d.expectedY)moveY=d.beforeY;}
      if(d.skewing)restoreSkew(d);
      if(d.rotation)restoreRotation(d);
      if(d.scaling)restoreScale(d);
      if(!d.translation&&!d.rotation&&!d.scaling&&!d.skewing)proposal=moveX===d.beforeX&&moveY===d.beforeY?d.proposal:undefined;
      actionError=String(cause);
      try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}
      paint();
    }
  }
  function pickedView(){
    if(!pick||!capture||!canvas)return null;
    const item=choices.find(c=>JSON.stringify([c.layerId,c.shapeId])===pick);
    if(!item)return null;
    const groupOwner=groupMode?capture.resolveGroup(item.layerId,item.shapeId):undefined;
    const owner=groupOwner??capture.resolve(item.layerId,item.shapeId);
    const artwork=capture.scene.find(t=>t.layerId===item.layerId)!.key.shapes;
    const members=groupOwner?artwork.filter(s=>groupOwner.shapeIds.includes(s.id)):[];
    const shape=capture.scene.find(t=>t.layerId===item.layerId)?.key.shapes.find(s=>s.id===item.shapeId);
    if(!shape)return null;
    const box=canvas.getBoundingClientRect(),view:RotationView={origin:{x:20,y:20},zoom:Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),width:540,height:330,cssWidth:box.width,cssHeight:box.height};
    return {shape,members,owner,view};
  }
  function rotationHandle(){
    const selected=rotateHandle&&!skewHandles&&!nodeCanvas&&!tangentCanvas?pickedView():null;
    if(!selected)return null;
    const handle=groupMode?sampledGroupRotationHandle(selected.members,selected.view,drag?.rotation?.poseDegrees??0)
      :sampledRotationHandle(selected.shape,selected.view,drag?.rotation?.poseDegrees??0);
    return {...handle,view:selected.view,owner:selected.owner};
  }
  function scaleHandleSet(){
    const selected=scaleHandles&&!skewHandles&&!nodeCanvas&&!tangentCanvas?pickedView():null;
    if(!selected)return null;
    const set=groupMode?sampledGroupScaleHandles(selected.members,selected.view,drag?.scaling?.poseFactors)
      :sampledScaleHandles(selected.shape,selected.view,drag?.scaling?.poseFactors);
    return {...set,view:selected.view,owner:selected.owner};
  }
  function skewHandleSet(){
    const selected=skewHandles&&!nodeCanvas&&!tangentCanvas?pickedView():null;
    if(!selected)return null;
    const set=groupMode?sampledGroupSkewHandles(selected.members,selected.view,drag?.skewing?.poseSkew?.axis??'x',drag?.skewing?.poseSkew?.degrees??0)
      :sampledSkewHandles(selected.shape,selected.view,drag?.skewing?.poseSkew?.axis??'x',drag?.skewing?.poseSkew?.degrees??0);
    return {...set,view:selected.view,owner:selected.owner};
  }
  function updateSkew(e:PointerEvent,d:Drag,finish:boolean){
    const job=d.skewing!;let owned=job.target;
    try{
      if(finish){skewPreview.cancel();if(drag!==d||job.target!==owned)return;assertSkew(d);}else assertSkewInputs(d);if(drag!==d||job.target!==owned)return;
      const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},job.view),value=sampledSkewAngle(job.edge,job.box,job.pivot,job.start,point,e.shiftKey);
      if(!Number.isFinite(value.degrees)||Math.abs(Math.cos(value.degrees*Math.PI/180))<1e-8)throw new Error('Skew cannot reach 90 degrees.');
      owned=value;job.target=owned;job.expected=value.degrees;skewAxis=job.axis;skewAngle=value.degrees;
      if(!value.degrees){skewPreview.cancel();job.pose=undefined;job.poseSkew=undefined;proposal=d.proposal;status=d.status;}
      else if(!finish){status='Unapplied skew. Valid release authors one local edit.';skewPreview.request({drag:d,target:owned});}
      if(finish){assertSkew(d);if(drag!==d||job.target!==owned)return;stopDrag(false,false);if(!value.degrees){restoreSkew(d);paint();}else authorRelease(d,undefined,undefined,undefined,value);}else paint();
    }catch(cause){if(drag===d&&job.target===owned)failSkew(d,cause);}
  }
  function updateScaling(e:PointerEvent,d:Drag,finish:boolean){
    const job=d.scaling!;let owned=job.target;
    try{
      if(finish){scalePreview.cancel();if(drag!==d||job.target!==owned)return;assertScale(d);}else assertScaleInputs(d);if(drag!==d||job.target!==owned)return;
      const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},job.view),factors=sampledScaleFactors(job.box,job.pivot,job.start,point,e.shiftKey,job.handle);
      owned=factors;job.target=owned;job.expected=factors;scaleX=factors.x*100;scaleY=factors.y*100;
      if(factors.x===1&&factors.y===1){scalePreview.cancel();job.pose=undefined;job.poseFactors=undefined;proposal=d.proposal;status=d.status;}
      else if(!finish){status='Unapplied scale. Valid release authors one local edit.';scalePreview.request({drag:d,target:owned});}
      if(finish){assertScale(d);if(drag!==d||job.target!==owned)return;stopDrag(false,false);if(factors.x===1&&factors.y===1){restoreScale(d);paint();}else authorRelease(d,undefined,undefined,factors);}else paint();
    }catch(cause){if(drag===d&&job.target===owned)failScale(d,cause);}
  }
  function updateRotation(e:PointerEvent,d:Drag,finish:boolean){
    const job=d.rotation!;let owned=job.target;
    try{
      if(finish){rotationPreview.cancel();if(drag!==d||job.target!==owned)return;assertRotation(d);}else assertRotationInputs(d);if(drag!==d||job.target!==owned)return;
      const point=rotationLocal({x:e.clientX-d.box.left,y:e.clientY-d.box.top},job.view);
      if(![point.x,point.y].every(Number.isFinite))throw new Error('Invalid rotation pointer coordinates.');
      if(!Math.hypot(point.x-job.pivot.x,point.y-job.pivot.y))throw new Error('Rotation pointer is at its pivot.');
      const current=Math.atan2(point.y-job.pivot.y,point.x-job.pivot.x);
      let delta=current-job.last;while(delta>Math.PI)delta-=2*Math.PI;while(delta<-Math.PI)delta+=2*Math.PI;
      job.last=current;job.total+=delta*180/Math.PI;
      const degrees=e.shiftKey?Math.round(job.total/15)*15:job.total;
      if(!Number.isFinite(degrees))throw new Error('Rotation exceeds finite angles.');owned={degrees};job.target=owned;job.expected=degrees;angle=degrees;
      if(degrees%360===0){rotationPreview.cancel();if(drag!==d||job.target!==owned)return;job.pose=undefined;job.poseDegrees=undefined;proposal=d.proposal;status=d.status;}
      else if(!finish){status='Unapplied rotation. Valid release authors one local edit.';rotationPreview.request({drag:d,target:owned});}
      if(finish){assertRotation(d);stopDrag(false,false);if(degrees%360===0){restoreRotation(d);paint();}else authorRelease(d,undefined,degrees);}else paint();
    }catch(cause){if((drag===d&&job.target===owned)||(finish&&!drag))failRotation(d,cause);}
  }
  function updateDrag(e:PointerEvent,finish=false){
    const d=drag;if(!d||d.id!==e.pointerId)return;
    if(d.skewing){updateSkew(e,d,finish);return;}
    if(d.scaling){updateScaling(e,d,finish);return;}
    if(d.rotation){updateRotation(e,d,finish);return;}
    const job=d.translation!;let owned=job.target;
    try{
      if(finish){translationPreview.cancel();if(drag!==d||job.target!==owned)return;assertTranslation(d);}else assertTranslationInputs(d);if(drag!==d||job.target!==owned)return;
      let dx=(e.clientX-d.x)/d.scaleX,dy=(e.clientY-d.y)/d.scaleY;
      if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}
      const x=d.beforeX!+dx,y=d.beforeY!+dy;if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Drag offsets exceed finite coordinates.');owned={x,y};job.target=owned;d.expectedX=x;d.expectedY=y;moveX=x;moveY=y;
      if(x===d.beforeX&&y===d.beforeY){translationPreview.cancel();if(drag!==d||job.target!==owned)return;job.pose=undefined;actionError=d.error;status=d.status;}
      else if(!x&&!y){translationPreview.cancel();if(drag!==d||job.target!==owned)return;job.pose=undefined;proposal=undefined;status='Zero offset. Release leaves artwork unchanged.';}
      else if(!finish){status=d.author?'Dragging an unapplied pose. Valid release authors one local edit.':'Dragging an unapplied pose. Release sets offsets; commit is explicit.';translationPreview.request({drag:d,target:owned});}
      if(finish){assertTranslation(d);stopDrag(false,false);if(x===d.beforeX&&y===d.beforeY)restoreTranslation(d);else if(d.author&&(x||y)){authorRelease(d,{x,y});return;}else if(x||y){assertTranslation(d,false);const action=prepareAction({x,y}),candidate=action.prepare();validateCandidate(candidate);action.verify();assertTranslation(d,false);proposal={definition:candidate,layerId:action.owner.layerId};actionError='';} }paint();
    }catch(cause){if(finish&&!drag){try{assertTranslation(d,false);actionFailure(cause);return;}catch(stale){failTranslation(d,stale);}}else if(drag===d&&job.target===owned)failTranslation(d,cause);}
  }

  function clearPress(){
    const old=press;press=undefined;
    if(old&&canvas?.hasPointerCapture(old.id))canvas.releasePointerCapture(old.id);
  }
  function fail(cause:unknown){
    stopDrag(true,false);clearPress();capture?.dispose();capture=undefined;presentationSymbols=undefined;choices=[];groupChoices=[];memberIds=[];pick='';proposal=undefined;failure=String(cause);paint();
  }
  function finishTrajectoryPreparation(){
    preparingTrajectory=false;
    if(trajectoryRepaintPending){trajectoryRepaintPending=false;paint();}
  }
  function paint(){
    if(preparingSelection){selectionRepaintPending=true;return;}
    if(preparingLegacySelection){legacySelectionRepaint=true;return;}
    // Synchronous input events may invalidate a route during its private preparation.
    // Defer rendering until that operation returns instead of reentering its owner.
    if(preparingSkew){skewRepaintPending=true;return;}
    if(preparingScale){scaleRepaintPending=true;return;}
    if(preparingRotation){rotationRepaintPending=true;return;}
    if(preparingTranslation){translationRepaintPending=true;return;}
    if(preparingTangent){tangentRepaintPending=true;return;}
    if(preparingCompound){compoundRepaintPending=true;return;}
    if(preparingCompoundNode){compoundNodeRepaintPending=true;return;}
    if(preparingNode){nodeRepaintPending=true;return;}
    if(preparingTrajectory){trajectoryRepaintPending=true;return;}
    if(!canvas||preparingPivot)return;
    const c=canvas.getContext('2d')!;c.setTransform(1,0,0,1,0,0);c.fillStyle='#fff';c.fillRect(0,0,540,330);
    if(!alive||!capture||!presentationSymbols)return;
    try{
      validateSource();
      const original=capture.scene;
      const setPose=selectionPose();
      const proposed=selectionMode?undefined:drag?.skewing?.pose??drag?.scaling?.pose??drag?.rotation?.pose??drag?.translation?.pose??groupCurveDrag?.pose??rootCurveDrag?.pose??rootWaypointDrag?.pose??waypointDrag?.pose??groupPivotDrag?.pose??pivotDrag?.pose??compoundNodeDrag?.pose??compoundDrag?.pose??tangentDrag?.pose??nodeDrag?.pose??proposal;
      const scene=setPose?.scene??(proposed?original.map(track=>track.layerId===proposed.layerId
        ?{...track,key:keyAt(symbolLayers(proposed.definition).find(l=>l.id===track.layerId)!,frame)}:track):original);
      const library=setPose?.symbols??(proposed?[...presentationSymbols.filter(s=>s.id!==proposed.definition.id),proposed.definition]:presentationSymbols);
      const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height));
      c.save();c.translate(20,20);c.scale(scale,scale);
      try{
        for(const track of scene)for(const root of track.key.shapes){
          expandSymbols({symbols:library},[root],frame-track.key.frame).forEach(s=>drawShape(c,s,assets,repaint));
          if(selectionMode?selectionOwner?.tracks.some(t=>t.layerId===track.layerId&&t.shapeIds.includes(root.id)):pick&&JSON.parse(pick)[0]===track.layerId&&memberIds.includes(root.id)){
            const b=objectBounds(root);c.strokeStyle='#00aacc';c.lineWidth=1/scale;
            c.strokeRect(b.left,b.top,b.right-b.left,b.bottom-b.top);
          }
        }
      }finally{c.restore();}
      if(selectionMode){paintSampledSelectionRotationHandle(c,selectionRotationHint,540,330,1);paintSampledSelectionScaleHandles(c,selectionScaleHint,540,330,1);paintSampledSelectionSkewHandles(c,selectionSkewHint,540,330,1);paintSampledPointHint(c,selectionTrajectoryHint,540,330,1,true);return;}
      {const h=groupCurveMarkers();if(h){c.save();c.scale(540/h.view.cssWidth,330/h.view.cssHeight);c.strokeStyle='#007f99';c.lineWidth=1;c.beginPath();c.moveTo(h.anchor.x,h.anchor.y);c.lineTo(h.original.x,h.original.y);c.stroke();c.fillStyle='#ffffff';c.beginPath();c.arc(h.original.x,h.original.y,5,0,2*Math.PI);c.fill();c.stroke();c.fillStyle='#ffbf66';c.beginPath();c.arc(h.proposed.x,h.proposed.y,3,0,2*Math.PI);c.fill();c.restore();}}
      {const h=rootCurveMarkers();if(h){c.save();c.scale(540/h.view.cssWidth,330/h.view.cssHeight);c.strokeStyle='#007f99';c.lineWidth=1;c.beginPath();c.moveTo(h.anchor.x,h.anchor.y);c.lineTo(h.original.x,h.original.y);c.stroke();c.fillStyle='#ffffff';c.beginPath();c.arc(h.original.x,h.original.y,5,0,2*Math.PI);c.fill();c.stroke();c.fillStyle='#ffbf66';c.beginPath();c.arc(h.proposed.x,h.proposed.y,3,0,2*Math.PI);c.fill();c.restore();}}
      {      const waypoints=rootWaypointMarkers();if(waypoints){c.save();c.scale(540/waypoints.view.cssWidth,330/waypoints.view.cssHeight);c.strokeStyle='#007f99';c.lineWidth=1;c.fillStyle='#ffffff';c.beginPath();c.arc(waypoints.original.x,waypoints.original.y,5,0,2*Math.PI);c.fill();c.stroke();c.fillStyle='#ffbf66';c.beginPath();c.arc(waypoints.proposed.x,waypoints.proposed.y,3,0,2*Math.PI);c.fill();c.restore();}
}
      const waypoints=waypointMarkers();if(waypoints){c.save();c.scale(540/waypoints.view.cssWidth,330/waypoints.view.cssHeight);c.strokeStyle='#007f99';c.lineWidth=1;c.fillStyle='#ffffff';c.beginPath();c.arc(waypoints.original.x,waypoints.original.y,5,0,2*Math.PI);c.fill();c.stroke();c.fillStyle='#ffbf66';c.beginPath();c.arc(waypoints.proposed.x,waypoints.proposed.y,3,0,2*Math.PI);c.fill();c.restore();}
      const groupPivots=groupPivotMarkers();if(groupPivots){c.save();c.scale(540/groupPivots.view.cssWidth,330/groupPivots.view.cssHeight);c.strokeStyle='#007f99';c.lineWidth=1;c.fillStyle='#ffffff';c.beginPath();c.arc(groupPivots.original.x,groupPivots.original.y,5,0,2*Math.PI);c.fill();c.stroke();c.fillStyle='#ffbf66';c.beginPath();c.arc(groupPivots.proposed.x,groupPivots.proposed.y,3,0,2*Math.PI);c.fill();c.restore();}
      const pivots=pivotMarkers();if(pivots){c.save();c.scale(540/pivots.view.cssWidth,330/pivots.view.cssHeight);c.strokeStyle='#007f99';c.lineWidth=1;c.fillStyle='#ffffff';c.beginPath();c.arc(pivots.original.x,pivots.original.y,5,0,2*Math.PI);c.fill();c.stroke();c.fillStyle='#ffbf66';c.beginPath();c.arc(pivots.proposed.x,pivots.proposed.y,3,0,2*Math.PI);c.fill();c.restore();}
      const compoundAnchors=compoundNodeMarkers();if(compoundAnchors){c.save();c.scale(540/compoundAnchors.view.cssWidth,330/compoundAnchors.view.cssHeight);c.strokeStyle='#007f99';c.lineWidth=1;for(const marker of compoundAnchors.markers){c.fillStyle=compoundNodeSelection?.owner.contourIndex===marker.contour&&compoundNodeSelection.owner.nodeIndex===marker.index?'#ffbf66':'#ffffff';c.beginPath();c.arc(marker.x,marker.y,4,0,Math.PI*2);c.fill();c.stroke();}c.restore();}
      const compounds=compoundMarkers();if(compounds){c.save();c.scale(540/compounds.view.cssWidth,330/compounds.view.cssHeight);c.strokeStyle='#007f99';c.lineWidth=1;for(const marker of compounds.markers){c.beginPath();c.moveTo(compounds.anchor.x,compounds.anchor.y);c.lineTo(marker.x,marker.y);c.stroke();c.fillStyle=compound?.owner.part===marker.part?'#ffbf66':'#ffffff';c.beginPath();c.arc(marker.x,marker.y,4,0,Math.PI*2);c.fill();c.stroke();}c.restore();}
      const tangents=tangentMarkers();if(tangents){c.save();c.scale(540/tangents.view.cssWidth,330/tangents.view.cssHeight);c.strokeStyle='#007f99';c.lineWidth=1;for(const marker of tangents.markers){c.beginPath();c.moveTo(tangents.anchor.x,tangents.anchor.y);c.lineTo(marker.x,marker.y);c.stroke();c.fillStyle=tangent?.owner.part===marker.part?'#ffbf66':'#ffffff';c.beginPath();c.arc(marker.x,marker.y,4,0,Math.PI*2);c.fill();c.stroke();}c.restore();}
      const anchors=nodeMarkers();if(anchors){c.save();c.scale(540/anchors.view.cssWidth,330/anchors.view.cssHeight);c.lineWidth=1;c.strokeStyle='#007f99';for(const marker of anchors.markers){c.fillStyle=node?.owner.nodeIndex===marker.index?'#ffbf66':'#ffffff';c.beginPath();c.arc(marker.x,marker.y,4,0,Math.PI*2);c.fill();c.stroke();}c.restore();}
      const diamonds=skewHandleSet();
      if(diamonds){
        c.save();c.scale(540/diamonds.view.cssWidth,330/diamonds.view.cssHeight);c.strokeStyle='#007f99';c.fillStyle='#ffd38a';c.lineWidth=1;
        c.beginPath();diamonds.outline.forEach((p,i)=>{if(i)c.lineTo(p.x,p.y);else c.moveTo(p.x,p.y);});c.closePath();c.stroke();
        for(const h of diamonds.handles){c.beginPath();c.moveTo(h.point.x,h.point.y-4);c.lineTo(h.point.x+4,h.point.y);c.lineTo(h.point.x,h.point.y+4);c.lineTo(h.point.x-4,h.point.y);c.closePath();c.fill();c.stroke();}c.restore();
      }
      const handles=scaleHandleSet();
      if(handles){
        c.save();c.scale(540/handles.view.cssWidth,330/handles.view.cssHeight);c.strokeStyle='#007f99';c.fillStyle='#ffffff';c.lineWidth=1;
        for(const h of handles.handles){c.fillRect(h.point.x-3,h.point.y-3,6,6);c.strokeRect(h.point.x-3,h.point.y-3,6,6);}c.restore();
      }
      const h=rotationHandle();
      if(h){
        c.save();c.scale(540/h.view.cssWidth,330/h.view.cssHeight);c.strokeStyle='#007f99';c.lineWidth=1;
        c.beginPath();c.moveTo(h.center.x,h.center.y);c.lineTo(h.knob.x,h.knob.y);c.stroke();
        c.fillStyle='#ffbf66';c.beginPath();c.arc(h.knob.x,h.knob.y,6,0,Math.PI*2);c.fill();c.stroke();c.restore();
      }
    }catch(cause){fail(cause);}
  }
  function repaint(){if(alive)paint();}
  function choose(value:string){
    if(!capture)return;
    try{
      validateSource();
      const item=choices.find(c=>JSON.stringify([c.layerId,c.shapeId])===value);
      if(value&&!item)throw new Error('Choose a current sampled symbol item.');
      memberIds=item?(groupMode?capture.resolveGroup(item.layerId,item.shapeId).shapeIds:[capture.resolve(item.layerId,item.shapeId).shapeId]):[];
      rootTrajectory=undefined;rootCurveCanvas=false;rootWaypoints=undefined;rootTrajectoryControls={startX:undefined,startY:undefined,endX:undefined,endY:undefined};rootTrajectoryRevision++;rootWaypoint=undefined;rootWaypointNumber=undefined;rootWaypointX=undefined;rootWaypointY=undefined;rootWaypointRevision++;rootWaypointCanvas=false;groupWaypoints=undefined;groupWaypoint=undefined;waypointCanvas=false;waypointNumber=undefined;waypointX=undefined;waypointY=undefined;waypointRevision++;groupTrajectory=undefined;groupCurveCanvas=false;trajectoryControls={startX:undefined,startY:undefined,endX:undefined,endY:undefined};trajectoryRevision++;groupPivot=undefined;groupPivotX=undefined;groupPivotY=undefined;groupPivotCanvas=false;
      pivot=undefined;pivotX=undefined;pivotY=undefined;pivotCanvas=false;
      compoundNodeSelection=undefined;anchorContour=undefined;anchorIndex=undefined;anchorX=undefined;anchorY=undefined;
      compound=undefined;compoundContour=undefined;compoundNode=undefined;compoundX=undefined;compoundY=undefined;compoundCoupled=false;compoundRevision++;
      node=undefined;nodeX=undefined;nodeY=undefined;proposal=undefined;actionError='';moveX=0;moveY=0;angle=0;scaleX=100;scaleY=100;skewAxis='x';skewAngle=0;pick=value;status=item?'Picked '+item.layerId+' / '+item.shapeId+'. Selection does not change artwork.':'No sampled item selected.';paint();
    }catch(cause){fail(cause);}
  }
  function offsetInput(event:Event,axis:'x'|'y'){
    const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);
    translationInputRevision++;translationInputAxes[axis]++;stopDrag();discardProposal();
    // Explicit input remains authoritative while the other drag draft is restored.
    if(axis==='x')moveX=n;else moveY=n;
    input.value=value;
  }
  function angleInput(event:Event){
    rotationInputRevision++;const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);
    stopDrag();discardProposal();angle=n;input.value=value;
  }
  function scaleInput(event:Event,axis:'x'|'y'){
    const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);
    scaleInputRevision++;scaleInputAxes[axis]++;stopDrag();discardProposal();if(axis==='x')scaleX=n;else scaleY=n;input.value=value;
  }
  function skewAxisInput(event:Event){
    const input=event.currentTarget as HTMLSelectElement,value=input.value as 'x'|'y';
    skewInputRevision++;skewInputAxes.axis++;stopDrag();discardProposal();skewAxis=value;input.value=value;
  }
  function skewInput(event:Event){
    const input=event.currentTarget as HTMLInputElement,value=input.value,n=value===''?undefined:Number(value);
    skewInputRevision++;skewInputAxes.angle++;stopDrag();discardProposal();skewAngle=n;input.value=value;
  }
  function discardProposal(){
    proposal=undefined;actionError='';status='Original sampled pose. Selection does not change artwork.';paint();
  }
  function actionFailure(cause:unknown){
    proposal=undefined;actionError=String(cause);
    try{validateSource();if(capture)void capture.scene;}catch(stale){fail(stale);return;}
    paint();
  }
  function prepareAction(offset?:Point,activeDrag?:Drag,degrees?:number,scale?:Point,skew?:{axis:'x'|'y';degrees:number}){
    if(selectionMode||!alive||!capture||!presentationSymbols||!pick||press||failure||drag!==activeDrag)throw new Error('Choose a current sampled symbol item.');
    if(offset&&(!Number.isFinite(offset.x)||!Number.isFinite(offset.y)||(!offset.x&&!offset.y)))
      throw new Error('Enter a finite, nonzero offset.');
    const expectedSkewRevision=skewInputRevision,expectedSkewTarget=activeDrag?.skewing?.target;
    const expectedScaleRevision=scaleInputRevision,expectedScaleTarget=activeDrag?.scaling?.target;
    const expectedAngleRevision=rotationInputRevision,expectedAngleTarget=activeDrag?.rotation?.target;
    const expectedInputRevision=translationInputRevision,expectedTarget=activeDrag?.translation?.target,expectedFrame=frame;
    const expectedGroup=groupMode,expectedCapture=capture,expectedPick=pick,expectedX=moveX,expectedY=moveY,expectedAngle=angle,expectedScaleX=scaleX,expectedScaleY=scaleY,expectedSkewAxis=skewAxis,expectedSkewAngle=skewAngle;
    const item=choices.find(c=>JSON.stringify([c.layerId,c.shapeId])===pick);
    if(!item)throw new Error('Choose a current sampled symbol item.');
    const resolve=()=>expectedGroup?expectedCapture.resolveGroup(item.layerId,item.shapeId):expectedCapture.resolve(item.layerId,item.shapeId);
    const owner=resolve();
    const verifyInputs=()=>{
      validateSource();
      if(skew&&(skewInputRevision!==expectedSkewRevision||frame!==expectedFrame||skewAxis!==expectedSkewAxis||skewAngle!==expectedSkewAngle||(activeDrag&&activeDrag.skewing?.target!==expectedSkewTarget)))throw new Error('Sampled symbol skew changed. Choose the axis and angle again.');
      if(scale&&(scaleInputRevision!==expectedScaleRevision||frame!==expectedFrame||scaleX!==expectedScaleX||scaleY!==expectedScaleY||(activeDrag&&activeDrag.scaling?.target!==expectedScaleTarget)))throw new Error('Sampled symbol scale changed. Choose the factors again.');
      if(degrees!==undefined&&(rotationInputRevision!==expectedAngleRevision||frame!==expectedFrame||angle!==expectedAngle||(activeDrag&&activeDrag.rotation?.target!==expectedAngleTarget)))throw new Error('Sampled symbol rotation changed. Choose the angle again.');
      if(!alive||groupMode!==expectedGroup||capture!==expectedCapture||pick!==expectedPick||press||drag!==activeDrag||
        (offset&&(translationInputRevision!==expectedInputRevision||frame!==expectedFrame||moveX!==expectedX||moveY!==expectedY||(activeDrag&&activeDrag.translation?.target!==expectedTarget))))
        throw new Error('Sampled symbol pick or offset changed. Pick the pose again.');
    };
    const verify=()=>{verifyInputs();const current=JSON.stringify(resolve());verifyInputs();if(current!==JSON.stringify(owner))throw Error('The original sampled symbol ownership changed.');};
    const prepare=()=>{verify();let candidate:SymbolDefinition;if(offset)preparingTranslation=true;if(degrees!==undefined)preparingRotation=true;if(scale)preparingScale=true;if(skew)preparingSkew=true;try{candidate=expectedGroup?expectedCapture.prepareGroupPromotion(item.layerId,item.shapeId,offset,degrees,scale,skew):expectedCapture.preparePromotion(item.layerId,item.shapeId,offset,degrees,scale,skew);}finally{if(skew){preparingSkew=false;if(skewRepaintPending){skewRepaintPending=false;paint();}}if(scale){preparingScale=false;if(scaleRepaintPending){scaleRepaintPending=false;paint();}}if(degrees!==undefined){preparingRotation=false;if(rotationRepaintPending){rotationRepaintPending=false;paint();}}if(offset){preparingTranslation=false;if(translationRepaintPending){translationRepaintPending=false;paint();}}}verify();return candidate;};
    verify();return {owner,verify,prepare};
  }
  function promotePick(offset?:Point,degrees?:number,scale?:Point,skew?:{axis:'x'|'y';degrees:number}){
    if(!alive||!capture||!pick||press||drag||failure)return;
    try{const action=prepareAction(offset,undefined,degrees,scale,skew);promote(action.owner,action.prepare,action.verify);}
    catch(cause){if(cause instanceof SelectionModeChanged||offset||degrees!==undefined||scale||skew)actionFailure(cause);else fail(cause);}
  }
  function previewMove(){if(validMove)previewPose({x:moveX!,y:moveY!});}
  function previewRotation(){if(validRotation)previewPose(undefined,angle!);}
  function previewScale(){if(validScale)previewPose(undefined,undefined,{x:scaleX!/100,y:scaleY!/100});}
  function previewSkew(){if(validSkew)previewPose(undefined,undefined,undefined,{axis:skewAxis,degrees:skewAngle!});}
  function previewPose(offset?:Point,degrees?:number,scale?:Point,skew?:{axis:'x'|'y';degrees:number}){
    if(!pick||press||drag||failure)return;
    try{
      const action=prepareAction(offset,undefined,degrees,scale,skew),candidate=action.prepare();
      validateCandidate(candidate);action.verify();
      proposal={definition:candidate,layerId:action.owner.layerId};actionError='';status=skew?'Unapplied skewed pose. Canvas picks still use the original sampled artwork.':scale?'Unapplied scaled pose. Canvas picks still use the original sampled artwork.':degrees===undefined?'Unapplied moved pose. Canvas picks still use the original sampled artwork.':'Unapplied rotated pose. Canvas picks still use the original sampled artwork.';paint();
    }catch(cause){actionFailure(cause);}
  }
  function down(e:PointerEvent){
    if(selectionMode)return;
    if(rootWaypoints&&!groupMode){e.preventDefault();canvas.focus({preventScroll:true});if(e.button===0&&e.pointerType!=='touch'&&e.isPrimary&&!rootWaypointDrag&&rootWaypointCanvas)beginRootWaypoint(e);return;}
    if(rootTrajectory&&!groupMode){e.preventDefault();canvas.focus({preventScroll:true});if(e.button===0&&e.pointerType!=='touch'&&e.isPrimary&&!rootCurveDrag&&rootCurveCanvas)beginRootCurve(e);return;}
    if(groupWaypoints&&groupMode){e.preventDefault();canvas.focus({preventScroll:true});if(e.button===0&&e.pointerType!=='touch'&&e.isPrimary&&!waypointDrag&&waypointCanvas)beginWaypoint(e);return;}
    if(groupTrajectory&&groupMode){e.preventDefault();canvas.focus({preventScroll:true});if(e.button===0&&e.pointerType!=='touch'&&e.isPrimary&&!groupCurveDrag&&groupCurveCanvas)beginGroupCurve(e);return;}
    if(groupPivot&&groupMode){e.preventDefault();canvas.focus({preventScroll:true});if(e.button===0&&e.pointerType!=='touch'&&e.isPrimary&&!groupPivotDrag&&groupPivotCanvas)beginGroupPivot(e);return;}
    if(!capture||!presentationSymbols||e.button!==0||e.pointerType==='touch'||pivotDrag)return;
    if(pivotCanvas&&beginPivot(e))return;
    if(pivotCanvas&&proposal){e.preventDefault();canvas.focus({preventScroll:true});return;}
    if((skewHandles||scaleHandles||rotateHandle||dragEnabled||nodeCanvas||tangentCanvas||compoundNodeCanvas||compoundCanvas)&&!e.isPrimary)return;
    let skewCaptureChanged=false,scaleCaptureChanged=false,rotationCaptureChanged=false,translationCaptureChanged=false,nodeCaptureChanged=false,tangentCaptureChanged=false,compoundCaptureChanged=false,compoundNodeCaptureChanged=false;
    try{
      const skewAdmission=skewHandles&&!nodeCanvas&&!tangentCanvas&&!compoundCanvas&&!compoundNodeCanvas?{capture,pick,group:groupMode,frame,rotation:rotateHandle,scaling:scaleHandles,policy:skewPolicy,inputRevision:skewInputRevision,inputAxes:{...skewInputAxes},axis:skewAxis,angle:skewAngle,x:moveX,y:moveY}:undefined;
      const skewBox=skewAdmission?canvas.getBoundingClientRect():undefined;
      const verifySkewCapture=()=>{const a=skewAdmission;if(!a)return;const current=()=>{if(!alive||failure||capture!==a.capture||pick!==a.pick||groupMode!==a.group||frame!==a.frame||!skewHandles||rotateHandle!==a.rotation||scaleHandles!==a.scaling||skewPolicy!==a.policy||skewInputRevision!==a.inputRevision||skewAxis!==a.axis||skewAngle!==a.angle||moveX!==a.x||moveY!==a.y){skewCaptureChanged=true;throw Error('The original sampled symbol skew capture changed.');}};current();if(!sameBox(canvas.getBoundingClientRect(),skewBox!)){skewCaptureChanged=true;throw Error('The sampled symbol skew view changed.');}current();};
      const scaleAdmission=scaleHandles&&!skewHandles&&!nodeCanvas&&!tangentCanvas&&!compoundCanvas&&!compoundNodeCanvas?{capture,pick,group:groupMode,frame,rotation:rotateHandle,policy:scalePolicy,inputRevision:scaleInputRevision,inputAxes:{...scaleInputAxes},scaleX,scaleY,x:moveX,y:moveY}:undefined;
      const scaleBox=scaleAdmission?canvas.getBoundingClientRect():undefined;
      const verifyScaleCapture=()=>{const a=scaleAdmission;if(!a)return;const current=()=>{if(!alive||failure||capture!==a.capture||pick!==a.pick||groupMode!==a.group||frame!==a.frame||!scaleHandles||rotateHandle!==a.rotation||skewHandles||scalePolicy!==a.policy||scaleInputRevision!==a.inputRevision||scaleX!==a.scaleX||scaleY!==a.scaleY||moveX!==a.x||moveY!==a.y){scaleCaptureChanged=true;throw Error('The original sampled symbol scale capture changed.');}};current();if(!sameBox(canvas.getBoundingClientRect(),scaleBox!)){scaleCaptureChanged=true;throw Error('The sampled symbol scale view changed.');}current();};
      const rotationAdmission=rotateHandle&&!skewHandles&&!nodeCanvas&&!tangentCanvas&&!compoundCanvas&&!compoundNodeCanvas?{capture,pick,group:groupMode,frame,scaling:scaleHandles,policy:rotationPolicy,inputRevision:rotationInputRevision,angle,x:moveX,y:moveY}:undefined;
      const rotationBox=rotationAdmission?canvas.getBoundingClientRect():undefined;
      const verifyRotationCapture=()=>{const a=rotationAdmission;if(!a)return;const current=()=>{if(!alive||failure||capture!==a.capture||pick!==a.pick||groupMode!==a.group||frame!==a.frame||!rotateHandle||scaleHandles!==a.scaling||skewHandles||rotationPolicy!==a.policy||rotationInputRevision!==a.inputRevision||angle!==a.angle||moveX!==a.x||moveY!==a.y){rotationCaptureChanged=true;throw Error('The original sampled symbol rotation capture changed.');}};current();if(!sameBox(canvas.getBoundingClientRect(),rotationBox!)){rotationCaptureChanged=true;throw Error('The sampled symbol rotation view changed.');}current();};
      const translationAdmission=dragEnabled&&!nodeCanvas&&!tangentCanvas&&!compoundCanvas&&!compoundNodeCanvas?{capture,pick,group:groupMode,frame,handles:{rotation:rotateHandle,scaling:scaleHandles,skewing:skewHandles},policy:translationPolicy,authorPolicy:groupMode?translationGroupAuthorPolicy:translationAuthorPolicy,inputRevision:translationInputRevision,inputAxes:{...translationInputAxes},author:groupMode?groupAuthorOnRelease:authorOnRelease,x:moveX,y:moveY}:undefined;
      const translationBox=translationAdmission?canvas.getBoundingClientRect():undefined;
      const verifyTranslationCapture=()=>{const a=translationAdmission;if(!a)return;const current=()=>{if(!alive||failure||capture!==a.capture||pick!==a.pick||groupMode!==a.group||frame!==a.frame||!dragEnabled||rotateHandle!==a.handles.rotation||scaleHandles!==a.handles.scaling||skewHandles!==a.handles.skewing||translationPolicy!==a.policy||(a.group?translationGroupAuthorPolicy:translationAuthorPolicy)!==a.authorPolicy||(a.group?groupAuthorOnRelease:authorOnRelease)!==a.author||translationInputRevision!==a.inputRevision||moveX!==a.x||moveY!==a.y){translationCaptureChanged=true;throw Error('The original sampled symbol translation capture changed.');}};current();if(!sameBox(canvas.getBoundingClientRect(),translationBox!)){translationCaptureChanged=true;throw Error('The sampled symbol translation view changed.');}current();};
      const nodeAdmission=nodeCanvas&&node?{capture,selection:node,pick,frame,policy:nodePolicy,author:nodeAuthor,releasePolicy:nodeReleasePolicy,inputRevision:nodeInputRevision,inputAxes:{...nodeInputAxes},x:nodeX,y:nodeY,box:canvas.getBoundingClientRect()}:undefined;
      const verifyNodeCapture=()=>{const current=()=>{if(nodeAdmission&&(capture!==nodeAdmission.capture||node!==nodeAdmission.selection||pick!==nodeAdmission.pick||frame!==nodeAdmission.frame||!nodeCanvas||groupMode||nodePolicy!==nodeAdmission.policy||nodeAuthor!==nodeAdmission.author||nodeReleasePolicy!==nodeAdmission.releasePolicy||nodeInputRevision!==nodeAdmission.inputRevision||nodeX!==nodeAdmission.x||nodeY!==nodeAdmission.y)){nodeCaptureChanged=true;throw Error('Sampled symbol node capture changed.');}};current();if(nodeAdmission&&!sameBox(canvas.getBoundingClientRect(),nodeAdmission.box)){nodeCaptureChanged=true;throw Error('Sampled symbol node capture view changed.');}current();};
      const admission=tangentCanvas&&tangent?{capture,selection:tangent,node,pick,frame,policy:tangentPolicy,coupled:tangentCoupled,couplingRevision:tangentCouplingRevision,author:tangentAuthor,releasePolicy:tangentReleasePolicy,pairedAuthor:pairedTangentAuthor,pairedPolicy:pairedTangentPolicy,inputRevision:tangentInputRevision,inputAxes:{...tangentInputAxes},x:tangentX,y:tangentY,box:canvas.getBoundingClientRect()}:undefined;
      const verifyTangentCapture=()=>{const current=()=>{if(admission&&(capture!==admission.capture||tangent!==admission.selection||node!==admission.node||pick!==admission.pick||frame!==admission.frame||groupMode||!tangentCanvas||tangentPolicy!==admission.policy||tangentCoupled!==admission.coupled||tangentCouplingRevision!==admission.couplingRevision||tangentAuthor!==admission.author||tangentReleasePolicy!==admission.releasePolicy||tangentInputRevision!==admission.inputRevision||tangentX!==admission.x||tangentY!==admission.y||(admission.coupled&&(pairedTangentAuthor!==admission.pairedAuthor||pairedTangentPolicy!==admission.pairedPolicy)))){tangentCaptureChanged=true;throw Error('Sampled symbol tangent capture changed.');}};current();if(admission&&!sameBox(canvas.getBoundingClientRect(),admission.box)){tangentCaptureChanged=true;throw Error('Sampled symbol tangent capture view changed.');}current();};
      const compoundAdmission=compoundCanvas&&compound?{capture,selection:compound,pick,frame,inputRevision:compoundInputRevision,inputAxes:{...compoundInputAxes},policy:compoundPolicy,author:compoundAuthor,releasePolicy:compoundReleasePolicy,coupled:compoundCoupled,revision:compoundRevision,contour:compoundContour,node:compoundNode,x:compoundX,y:compoundY,box:canvas.getBoundingClientRect()}:undefined;
      const verifyCompoundCapture=()=>{const current=()=>{if(compoundAdmission&&(capture!==compoundAdmission.capture||compound!==compoundAdmission.selection||pick!==compoundAdmission.pick||frame!==compoundAdmission.frame||groupMode||!compoundCanvas||compoundInputRevision!==compoundAdmission.inputRevision||compoundPolicy!==compoundAdmission.policy||compoundAuthor!==compoundAdmission.author||compoundReleasePolicy!==compoundAdmission.releasePolicy||compoundCoupled!==compoundAdmission.coupled||compoundRevision!==compoundAdmission.revision||compoundContour!==compoundAdmission.contour||compoundNode!==compoundAdmission.node||compoundX!==compoundAdmission.x||compoundY!==compoundAdmission.y)){compoundCaptureChanged=true;throw Error('Sampled symbol compound tangent capture changed.');}};current();if(compoundAdmission&&!sameBox(canvas.getBoundingClientRect(),compoundAdmission.box)){compoundCaptureChanged=true;throw Error('Sampled symbol compound tangent capture view changed.');}current();};
      const compoundNodeAdmission=compoundNodeCanvas&&compoundNodeSelection?{capture,selection:compoundNodeSelection,pick,frame,inputRevision:compoundNodeInputRevision,inputAxes:{...compoundNodeInputAxes},policy:compoundNodePolicy,author:compoundNodeAuthor,releasePolicy:compoundNodeReleasePolicy,contour:anchorContour,node:anchorIndex,x:anchorX,y:anchorY,box:canvas.getBoundingClientRect()}:undefined;
      const verifyCompoundNodeCapture=()=>{const current=()=>{if(compoundNodeAdmission&&(capture!==compoundNodeAdmission.capture||compoundNodeSelection!==compoundNodeAdmission.selection||pick!==compoundNodeAdmission.pick||frame!==compoundNodeAdmission.frame||groupMode||!compoundNodeCanvas||compoundNodeInputRevision!==compoundNodeAdmission.inputRevision||compoundNodePolicy!==compoundNodeAdmission.policy||compoundNodeAuthor!==compoundNodeAdmission.author||compoundNodeReleasePolicy!==compoundNodeAdmission.releasePolicy||anchorContour!==compoundNodeAdmission.contour||anchorIndex!==compoundNodeAdmission.node||anchorX!==compoundNodeAdmission.x||anchorY!==compoundNodeAdmission.y)){compoundNodeCaptureChanged=true;throw Error('Sampled symbol compound anchor capture changed.');}};current();if(compoundNodeAdmission&&!sameBox(canvas.getBoundingClientRect(),compoundNodeAdmission.box)){compoundNodeCaptureChanged=true;throw Error('Sampled symbol compound anchor capture view changed.');}current();};
      if(translationAdmission&&!Object.values(translationAdmission.handles).some(Boolean))verifyTranslationCapture();verifySkewCapture();verifyScaleCapture();verifyRotationCapture();validateSource();void capture.scene;verifyRotationCapture();verifyScaleCapture();verifySkewCapture();if(translationAdmission&&!Object.values(translationAdmission.handles).some(Boolean))verifyTranslationCapture();verifyNodeCapture();verifyTangentCapture();verifyCompoundCapture();verifyCompoundNodeCapture();
      cancelInteraction();
      const box=canvas.getBoundingClientRect(),scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height));
      if(compoundNodeCanvas){const handles=compoundNodeMarkers(),near=handles?.markers.filter(m=>Math.hypot(e.clientX-box.left-m.x,e.clientY-box.top-m.y)<=8).sort((a,b)=>Math.hypot(e.clientX-box.left-a.x,e.clientY-box.top-a.y)-Math.hypot(e.clientX-box.left-b.x,e.clientY-box.top-b.y)||a.contour-b.contour||a.index-b.index)[0];if(handles&&near){const pointer=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},handles.view),hit=pickPreviewRoot(capture,pointer);if(hit.kind==='blocked'||(hit.kind==='pick'&&JSON.stringify([hit.owner.layerId,hit.owner.shapeId])!==pick)){status='Foreground artwork owns this compound anchor position.';paint();return;}canvas.focus({preventScroll:true});e.preventDefault();if(compoundNodeSelection?.owner.contourIndex!==near.contour||compoundNodeSelection.owner.nodeIndex!==near.index||compoundNodeSelection.pick!==pick){compoundAnchorIndex('contour',String(near.contour+1));compoundAnchorIndex('node',String(near.index+1));return;}if(!compoundNodeAdmission){compoundNodeCaptureChanged=true;throw Error('Pick the original compound anchor again before dragging.');}verifyCompoundNodeCapture();if(!sameBox(canvas.getBoundingClientRect(),box))throw Error('The compound anchor view changed.');const observer=new ResizeObserver(checkDragView);canvas.setPointerCapture(e.pointerId);compoundNodeDrag={frame:compoundNodeAdmission.frame,inputRevision:compoundNodeAdmission.inputRevision,inputAxes:compoundNodeAdmission.inputAxes,author:compoundNodeAdmission.author,releasePolicy:compoundNodeAdmission.releasePolicy,id:e.pointerId,policy:compoundNodeAdmission.policy,selection:compoundNodeSelection,capture,box,view:handles.view,start:pointer,beforeX:anchorX,beforeY:anchorY,x:anchorX,y:anchorY,proposal,status,error:actionError,observer};observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);return;}}
      if(compoundCanvas){const handles=compoundMarkers(),near=handles?.markers.filter(m=>Math.hypot(e.clientX-box.left-m.x,e.clientY-box.top-m.y)<=8).sort((a,b)=>Math.hypot(e.clientX-box.left-a.x,e.clientY-box.top-a.y)-Math.hypot(e.clientX-box.left-b.x,e.clientY-box.top-b.y))[0];if(handles&&near){const pointer=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},handles.view),hit=pickPreviewRoot(capture,pointer);if(hit.kind==='blocked'||(hit.kind==='pick'&&JSON.stringify([hit.owner.layerId,hit.owner.shapeId])!==pick)){status='Foreground artwork owns this compound tangent position.';paint();return;}canvas.focus({preventScroll:true});e.preventDefault();if(compound?.owner.part!==near.part||compound.owner.contourIndex!==compoundContour!-1||compound.owner.nodeIndex!==compoundNode!-1||compound.pick!==pick){chooseCompound(near.part);return;}if(!compoundAdmission){compoundCaptureChanged=true;throw Error('Pick the original compound tangent again before dragging.');}if(!sameBox(canvas.getBoundingClientRect(),box))throw Error('The compound tangent view changed.');verifyCompoundCapture();const observer=new ResizeObserver(checkDragView);canvas.setPointerCapture(e.pointerId);compoundDrag={frame:compoundAdmission.frame,inputRevision:compoundAdmission.inputRevision,inputAxes:compoundAdmission.inputAxes,author:compoundAdmission.author,releasePolicy:compoundAdmission.releasePolicy,id:e.pointerId,policy:compoundAdmission.policy,selection:compound,capture,coupled:compoundAdmission.coupled,couplingRevision:compoundAdmission.revision,box,view:handles.view,start:pointer,beforeX:compoundX,beforeY:compoundY,x:compoundX,y:compoundY,proposal,status,error:actionError,observer};observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);return;}}
      if(tangentCanvas){const handles=tangentMarkers(),near=handles?.markers.filter(m=>Math.hypot(e.clientX-box.left-m.x,e.clientY-box.top-m.y)<=8).sort((a,b)=>Math.hypot(e.clientX-box.left-a.x,e.clientY-box.top-a.y)-Math.hypot(e.clientX-box.left-b.x,e.clientY-box.top-b.y))[0];if(handles&&near){const pointer=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},handles.view),hit=pickPreviewRoot(capture,pointer);if(hit.kind==='blocked'||(hit.kind==='pick'&&JSON.stringify([hit.owner.layerId,hit.owner.shapeId])!==pick)){status='Foreground artwork owns this tangent position.';paint();return;}canvas.focus({preventScroll:true});e.preventDefault();if(tangent?.owner.part!==near.part||tangent.selection!==node){chooseTangent(near.part);return;}if(!admission){tangentCaptureChanged=true;throw Error('Pick the original tangent again before dragging.');}verifyTangentCapture();const observer=new ResizeObserver(checkDragView);canvas.setPointerCapture(e.pointerId);tangentDrag={inputRevision:admission.inputRevision,inputAxes:admission.inputAxes,frame:admission.frame,pairedAuthor:admission.pairedAuthor,pairedPolicy:admission.pairedPolicy,coupled:admission.coupled,couplingRevision:admission.couplingRevision,author:admission.author,releasePolicy:admission.releasePolicy,id:e.pointerId,policy:tangentPolicy,selection:tangent,capture,box,view:handles.view,start:pointer,beforeX:tangentX,beforeY:tangentY,x:tangentX,y:tangentY,proposal,status,error:actionError,observer};observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);return;}}
      if(nodeCanvas){
        const anchors=nodeMarkers(),near=anchors?.markers.filter(m=>Math.hypot(e.clientX-box.left-m.x,e.clientY-box.top-m.y)<=8).sort((a,b)=>Math.hypot(e.clientX-box.left-a.x,e.clientY-box.top-a.y)-Math.hypot(e.clientX-box.left-b.x,e.clientY-box.top-b.y))[0];
        if(anchors&&near){
          const pointer=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},anchors.view),hit=pickPreviewRoot(capture,pointer);
          if(hit.kind==='blocked'||(hit.kind==='pick'&&JSON.stringify([hit.owner.layerId,hit.owner.shapeId])!==pick)){status='Foreground artwork owns this node position.';paint();return;}
          canvas.focus({preventScroll:true});e.preventDefault();
          if(node?.owner.nodeIndex!==near.index||node.pick!==pick){chooseNode(String(near.index+1));return;}
          if(!nodeAdmission){nodeCaptureChanged=true;throw Error('Pick the original node again before dragging.');}verifyNodeCapture();if(!sameBox(canvas.getBoundingClientRect(),box))throw Error('The node view changed.');const observer=new ResizeObserver(checkDragView);canvas.setPointerCapture(e.pointerId);nodeDrag={inputRevision:nodeAdmission.inputRevision,inputAxes:nodeAdmission.inputAxes,frame:nodeAdmission.frame,author:nodeAdmission.author,releasePolicy:nodeAdmission.releasePolicy,policy:nodeAdmission.policy,id:e.pointerId,selection:node,capture,box,view:anchors.view,start:pointer,beforeX:nodeX,beforeY:nodeY,x:nodeX,y:nodeY,proposal,status,error:actionError,observer};observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);return;
        }
      }
      const diamonds=skewHandleSet();verifySkewCapture();const diamond=diamonds?.handles.find(h=>Math.hypot(e.clientX-box.left-h.point.x,e.clientY-box.top-h.point.y)<=9);
      if(diamonds&&diamond){
        if(!skewAdmission)throw Error('Choose the original sampled skew again.');verifySkewCapture();
        const axis=diamond.id==='skew-n'||diamond.id==='skew-s'?'x':'y';
        canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);const observer=new ResizeObserver(checkDragView);
        drag={group:groupMode,author:true,id:e.pointerId,x:e.clientX,y:e.clientY,box,scaleX:scale*box.width/540,scaleY:scale*box.height/330,pick,
          owner:diamonds.owner,capture,beforeX:moveX,beforeY:moveY,expectedX:moveX,expectedY:moveY,proposal,status,error:actionError,observer,
          skewing:{rotation:skewAdmission.rotation,scaling:skewAdmission.scaling,frame:skewAdmission.frame,policy:skewAdmission.policy,inputRevision:skewAdmission.inputRevision,inputAxes:skewAdmission.inputAxes,view:diamonds.view,pivot:diamonds.pivot,box:diamonds.box,start:rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},diamonds.view),edge:diamond.id,axis,expected:0,beforeAxis:skewAxis,beforeAngle:skewAngle}};
        skewAxis=axis;skewAngle=0;observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);e.preventDefault();return;
      }
      const scales=scaleHandleSet();verifyScaleCapture();const near=scales?.handles.filter(h=>Math.hypot(e.clientX-box.left-h.point.x,e.clientY-box.top-h.point.y)<=9)
         .sort((a,b)=>a.point.x===b.point.x&&a.point.y===b.point.y
          ?Number(b.id.startsWith('scale-'))-Number(a.id.startsWith('scale-'))
          :Math.hypot(e.clientX-box.left-a.point.x,e.clientY-box.top-a.point.y)-Math.hypot(e.clientX-box.left-b.point.x,e.clientY-box.top-b.point.y))[0];
      if(scales&&near){
        if(!scaleAdmission)throw Error('Choose the original sampled scale again.');verifyScaleCapture();
        canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);const observer=new ResizeObserver(checkDragView);
        drag={group:groupMode,author:true,id:e.pointerId,x:e.clientX,y:e.clientY,box,scaleX:scale*box.width/540,scaleY:scale*box.height/330,pick,
          owner:scales.owner,capture,beforeX:moveX,beforeY:moveY,expectedX:moveX,expectedY:moveY,proposal,status,error:actionError,observer,
          scaling:{rotation:scaleAdmission.rotation,frame:scaleAdmission.frame,policy:scaleAdmission.policy,inputRevision:scaleAdmission.inputRevision,inputAxes:scaleAdmission.inputAxes,view:scales.view,pivot:scales.pivot,box:scales.box,start:rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},scales.view),handle:near.id,expected:{x:1,y:1},beforeX:scaleX,beforeY:scaleY}};
        scaleX=100;scaleY=100;observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);e.preventDefault();return;
      }
      const h=rotationHandle();verifyRotationCapture();
      if(h&&Math.hypot(e.clientX-box.left-h.knob.x,e.clientY-box.top-h.knob.y)<=9){
        if(!rotationAdmission)throw Error('Pick the original sampled rotation again.');verifyRotationCapture();
        const point=rotationLocal({x:e.clientX-box.left,y:e.clientY-box.top},h.view);
        canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
        const observer=new ResizeObserver(checkDragView);
        const before=angle;
        drag={group:groupMode,author:true,id:e.pointerId,x:e.clientX,y:e.clientY,box,scaleX:scale*box.width/540,scaleY:scale*box.height/330,pick,
          owner:h.owner,capture,beforeX:moveX,beforeY:moveY,expectedX:moveX,expectedY:moveY,proposal,status,error:actionError,observer,
          rotation:{scaling:rotationAdmission.scaling,frame:rotationAdmission.frame,policy:rotationAdmission.policy,inputRevision:rotationAdmission.inputRevision,view:h.view,pivot:h.pivot,last:Math.atan2(point.y-h.pivot.y,point.x-h.pivot.x),total:0,expected:0,before}};
        angle=0;observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);e.preventDefault();return;
      }
      if(dragEnabled&&!compoundNodeCanvas&&!nodeCanvas&&!tangentCanvas&&!compoundCanvas&&pick&&box.width>0&&box.height>0){
        const result=pickPreviewRoot(capture,{x:((e.clientX-box.left)*540/box.width-20)/scale,y:((e.clientY-box.top)*330/box.height-20)/scale});
        const [layerId,shapeId]=JSON.parse(pick) as [string,string];
        const groupOwner=groupMode?capture.resolveGroup(layerId,shapeId):undefined;
        const owner=groupOwner??capture.resolve(layerId,shapeId);
        const hitOwner=result.kind==='pick'&&groupMode&&result.owner.layerId===layerId&&groupChoices.some(c=>c.layerId===layerId&&c.shapeId===result.owner.shapeId)
          ?capture.resolveGroup(layerId,result.owner.shapeId):undefined;
        const sameUnit=groupMode
          ?hitOwner&&groupOwner&&hitOwner.groupId===groupOwner.groupId&&JSON.stringify(hitOwner.shapeIds)===JSON.stringify(groupOwner.shapeIds)
          :result.kind==='pick'&&JSON.stringify([result.owner.layerId,result.owner.shapeId])===pick;
        if(sameUnit){
          verifyTranslationCapture();if(!translationAdmission)throw Error('Choose the original sampled translation again.');
          if(!Number.isFinite(moveX)||!Number.isFinite(moveY)){actionFailure(new Error('Enter finite offset drafts before dragging.'));return;}
          canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
          const observer=new ResizeObserver(checkDragView);
          drag={group:groupMode,author:groupMode?groupAuthorOnRelease:authorOnRelease,id:e.pointerId,x:e.clientX,y:e.clientY,box,scaleX:scale*box.width/540,scaleY:scale*box.height/330,pick,owner,
            capture,beforeX:moveX,beforeY:moveY,expectedX:moveX,expectedY:moveY,proposal,status,error:actionError,observer,translation:{handles:translationAdmission.handles,frame:translationAdmission.frame,policy:translationAdmission.policy,authorPolicy:translationAdmission.authorPolicy,inputRevision:translationAdmission.inputRevision,inputAxes:translationAdmission.inputAxes}};
          observer.observe(canvas);window.addEventListener('scroll',checkDragView,true);e.preventDefault();return;
        }
      }
      verifyTranslationCapture();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
      press={groupMode,id:e.pointerId,x:e.clientX,y:e.clientY,box:canvas.getBoundingClientRect(),pick};e.preventDefault();
    }catch(cause){if(skewCaptureChanged||scaleCaptureChanged||rotationCaptureChanged||translationCaptureChanged||nodeCaptureChanged||tangentCaptureChanged||compoundCaptureChanged||compoundNodeCaptureChanged)actionFailure(cause);else fail(cause);}
  }
  function move(e:PointerEvent){if(groupCurveDrag){updateGroupCurveDraft(e);return;}if(rootCurveDrag){updateRootCurveDraft(e);return;}if(rootWaypointDrag){updateRootWaypointDraft(e);return;}if(waypointDrag){updateWaypointDraft(e);return;}if(groupPivotDrag){updateGroupPivotDraft(e);return;}if(pivotDrag){updatePivotDraft(e);return;}if(compoundNodeDrag){updateCompoundNodeDraft(e);return;}if(compoundDrag){updateCompoundDraft(e);return;}if(tangentDrag){updateTangentDraft(e);return;}if(nodeDrag){updateNodeDraft(e);return;}if(drag){updateDrag(e);return;}if(press?.id===e.pointerId&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>4)clearPress();}
  function lost(e:PointerEvent){if(groupCurveDrag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopGroupCurveDraft();if(rootCurveDrag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopRootCurveDraft();if(rootWaypointDrag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopRootWaypointDraft();if(waypointDrag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopWaypointDraft();if(groupPivotDrag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopGroupPivotDraft();if(pivotDrag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopPivotDraft();if(compoundNodeDrag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopCompoundNodeDraft();if(compoundDrag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopCompoundDraft();if(tangentDrag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopTangentDraft();if(nodeDrag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopNodeDraft();if(drag?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))stopDrag();if(press?.id===e.pointerId&&!canvas.hasPointerCapture(e.pointerId))clearPress();}
  function cancelled(e:PointerEvent){if(groupCurveDrag?.id===e.pointerId)stopGroupCurveDraft();if(rootCurveDrag?.id===e.pointerId)stopRootCurveDraft();if(rootWaypointDrag?.id===e.pointerId)stopRootWaypointDraft();if(waypointDrag?.id===e.pointerId)stopWaypointDraft();if(groupPivotDrag?.id===e.pointerId)stopGroupPivotDraft();if(pivotDrag?.id===e.pointerId)stopPivotDraft();if(compoundNodeDrag?.id===e.pointerId)stopCompoundNodeDraft();if(compoundDrag?.id===e.pointerId)stopCompoundDraft();if(tangentDrag?.id===e.pointerId)stopTangentDraft();if(nodeDrag?.id===e.pointerId)stopNodeDraft();if(drag?.id===e.pointerId)stopDrag();if(press?.id===e.pointerId)clearPress();}
  function up(e:PointerEvent){
    if(groupCurveDrag){updateGroupCurveDraft(e,true);return;}
    if(rootCurveDrag){updateRootCurveDraft(e,true);return;}
    if(rootWaypointDrag){updateRootWaypointDraft(e,true);return;}
    if(waypointDrag){updateWaypointDraft(e,true);return;}
    if(groupPivotDrag){updateGroupPivotDraft(e,true);return;}
    if(pivotDrag){updatePivotDraft(e,true);return;}
    if(compoundNodeDrag){updateCompoundNodeDraft(e,true);return;}
    if(compoundDrag){updateCompoundDraft(e,true);return;}
    if(tangentDrag){updateTangentDraft(e,true);return;}
    if(nodeDrag){updateNodeDraft(e,true);return;}
    if(drag){updateDrag(e,true);return;}
    const p=press;if(!p||p.id!==e.pointerId)return;
    const box=canvas.getBoundingClientRect();clearPress();
    if(!capture||!alive)return;
    try{
      validateSource();
      if(p.groupMode!==groupMode||p.pick!==pick||box.left!==p.box.left||box.top!==p.box.top||box.width!==p.box.width||box.height!==p.box.height||
        Math.hypot(e.clientX-p.x,e.clientY-p.y)>4||box.width<=0||box.height<=0)return;
      const x=(e.clientX-box.left)*540/box.width,y=(e.clientY-box.top)*330/box.height;
      const scale=Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height));
      const result=x<0||y<0||x>=540||y>=330
        ?{kind:'empty'}as const:pickPreviewRoot(capture,{x:(x-20)/scale,y:(y-20)/scale});
      if(result.kind==='pick'&&groupMode&&!groupChoices.some(c=>c.layerId===result.owner.layerId&&c.shapeId===result.owner.shapeId)){
        choose('');status='Foreground artwork is not a sampled complete group.';
      }else if(result.kind==='pick')choose(JSON.stringify([result.owner.layerId,result.owner.shapeId]));
      else{choose('');if(result.kind==='blocked')status='Foreground artwork cannot be promoted at this frame.';}
    }catch(cause){fail(cause);}
  }
  function escape(e:KeyboardEvent){if(e.key==='Escape'&&selectionMode){if(selectionPreview){e.preventDefault();e.stopPropagation();selectionPreview.discard();paint();}return;}if(e.key==='Escape'&&(groupCurveDrag||rootCurveDrag||rootWaypointDrag||waypointDrag||groupPivotDrag||pivotDrag||compoundNodeDrag||compoundDrag||tangentDrag||nodeDrag||drag||proposal||press||pick)){e.preventDefault();e.stopPropagation();clearPress();if(groupCurveDrag)stopGroupCurveDraft();else if(rootCurveDrag)stopRootCurveDraft();else if(rootWaypointDrag)stopRootWaypointDraft();else if(waypointDrag)stopWaypointDraft();else if(groupPivotDrag)stopGroupPivotDraft();else if(pivotDrag)stopPivotDraft();else if(compoundNodeDrag)stopCompoundNodeDraft();else if(compoundDrag)stopCompoundDraft();else if(tangentDrag)stopTangentDraft();else if(nodeDrag)stopNodeDraft();else if(drag)stopDrag();else if(proposal)discardProposal();else choose('');}}
  onMount(()=>{
    alive=true;const presentationJob=new AbortController();
    try{
      validateSource();
      // Stable private snapshots live only for this keyed editing context.
      const source={definition:structuredClone(definition),symbols:structuredClone(symbols),revision:0,frame};
      capturedDefinition=source.definition;capture=captureSymbolRememberedAuthoringFrame(()=>{validateSource();return source;});
      const owner=capture;status='Preparing nested remembered artwork.';
      void owner.preparePresentation({signal:presentationJob.signal,validate:validateSource}).then(prepared=>{
        if(!alive||capture!==owner)return;
        presentationSymbols=prepared.symbols;choices=owner.choices;selectionReady=true;
        groupChoices=choices.filter(item=>owner.scene.find(t=>t.layerId===item.layerId)?.key.shapes.find(s=>s.id===item.shapeId)?.groups?.[0]);
        status='Pick sampled artwork on the canvas or in the list. Selection does not change artwork.';paint();
      }).catch(cause=>{if(alive&&capture===owner&&!presentationJob.signal.aborted)fail(cause);});
    }catch(cause){fail(cause);}
    const viewObserver=new ResizeObserver(()=>{checkDragView();paint();});viewObserver.observe(canvas);
    window.addEventListener('blur',cancelInteraction);window.addEventListener('resize',cancelInteraction);
    return()=>{selectionReady=false;alive=false;skewPreview.dispose();scalePreview.dispose();rotationPreview.dispose();translationPreview.dispose();cubicPreview.dispose();waypointPreview.dispose();pivotPreview.dispose();nodePreview.dispose();tangentPreview.dispose();compoundNodePreview.dispose();compoundPreview.dispose();presentationJob.abort();presentationSymbols=undefined;viewObserver.disconnect();cancelInteraction();proposal=undefined;capture?.dispose();capture=undefined;window.removeEventListener('blur',cancelInteraction);window.removeEventListener('resize',cancelInteraction);};
  });
</script>
<svelte:window onkeydown={escape}/>
<canvas bind:this={canvas} width="540" height="330" aria-label="Sampled symbol stage" tabindex="0"
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancelled} onlostpointercapture={lost} onblur={cancelInteraction}></canvas>
<label><input type="checkbox" aria-label="Select multiple sampled symbol units" checked={selectionMode} disabled={!selectionReady||!!failure} onchange={e=>changeSelectionMode(e.currentTarget.checked)}/>Select multiple units</label>
<label><input type="checkbox" aria-label="Select complete sampled symbol groups" bind:checked={groupMode} onchange={changeGroupMode}/>Select complete outer groups (promotion and document-space movement)</label>
{#if selectionMode}
  {#if selectionContext}<SymbolSampledSelectionEditor trajectoryHandles={layout=>{selectionTrajectoryHint=layout;paint();}} {trajectoryContext} {publishTrajectories} skewHandles={layout=>{selectionSkewHint=layout;paint();}} scaleHandles={layout=>{selectionScaleHint=layout;paint();}} rotationHandle={layout=>{selectionRotationHint=layout;paint();}} preparing={selectionPreparing} surface={()=>({canvas,view:{origin:{x:20,y:20},zoom:Math.min(500/Math.max(1,definition.width),290/Math.max(1,definition.height)),width:540,height:330}})} context={selectionContext} preview={value=>{selectionPreview=value;paint();}} selection={owner=>{selectionOwner=owner;paint();}} publish={publishSelection}/>{/if}
{:else}

{#if groupMode}<p>Every member of the picked outer group is outlined and moves together. Preview leaves artwork unchanged; commit is explicit.</p>{/if}
<label><input type="checkbox" aria-label="Show sampled symbol skew handles" bind:checked={skewHandles} onchange={()=>{skewPolicy++;if(skewHandles){rootTrajectory=undefined;rootWaypoints=undefined;groupPivot=undefined;groupTrajectory=undefined;groupWaypoints=undefined;}cancelInteraction();pivotCanvas=false;nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;discardProposal();}}/>Skew with diamond handles (replaces scale/rotation handles; release authors one edit)</label>
<label><input type="checkbox" aria-label="Show sampled symbol scale handles" bind:checked={scaleHandles} onchange={()=>{scalePolicy++;if(scaleHandles){rootTrajectory=undefined;rootWaypoints=undefined;groupPivot=undefined;groupTrajectory=undefined;groupWaypoints=undefined;}cancelInteraction();pivotCanvas=false;nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;discardProposal();}}/>Scale the picked pose with corner and midpoint handles (release authors one edit)</label>
<label><input type="checkbox" aria-label="Show sampled symbol rotation handle" bind:checked={rotateHandle} onchange={()=>{rotationPolicy++;if(rotateHandle){rootTrajectory=undefined;rootWaypoints=undefined;groupPivot=undefined;groupTrajectory=undefined;groupWaypoints=undefined;}cancelInteraction();pivotCanvas=false;nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;discardProposal();}}/>Rotate the picked pose with a canvas handle (release authors one edit)</label>
<label><input type="checkbox" aria-label="Drag sampled symbol offsets" bind:checked={dragEnabled} onchange={event=>{translationPolicy++;if(event.currentTarget.checked){rootTrajectory=undefined;rootWaypoints=undefined;groupPivot=undefined;groupTrajectory=undefined;groupWaypoints=undefined;pivotCanvas=false;nodeCanvas=false;tangentCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;}else authorOnRelease=false;cancelInteraction();discardProposal();}}/>Drag selected sampled artwork to set offsets</label>
<label><input type="checkbox" aria-label="Author sampled symbol drag on release" bind:checked={authorOnRelease} disabled={groupMode||!dragEnabled} onchange={()=>{translationAuthorPolicy++;cancelInteraction();}}/>Author the moved pose on drag release</label>
<label><input type="checkbox" aria-label="Author sampled group drag on release" bind:checked={groupAuthorOnRelease} disabled={!groupMode||!dragEnabled} onchange={()=>{translationGroupAuthorPolicy++;cancelInteraction();}}/>Author the complete group move on drag release</label>
{#if groupPivot}<p>{groupPivotCanvas?(groupPivotAuthor?'Drag the original group pivot. Shift constrains the document axis. Valid release authors one local edit.':'Drag the original group pivot marker. Shift constrains the document axis. Release sets unapplied coordinates; commit explicitly.'):'Numeric group pivot selected. Enable pivot dragging or a group transform to resume canvas input.'}</p>{:else}<p>Drag starts on the original sampled artwork. Shift constrains the dominant document axis. {(groupMode?groupAuthorOnRelease:authorOnRelease)?'Valid release freshly promotes and moves the pose in one local edit.':'Release sets offsets without editing the draft; commit remains explicit.'} Escape cancels the drag. Zero travel leaves artwork unchanged.</p>{/if}
<label>Sampled symbol artwork<select aria-label="Sampled symbol artwork" value={pick} disabled={!!failure||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))}
  onchange={e=>{stopDrag(false);clearPress();choose(e.currentTarget.value);}}>
  <option value="">Choose sampled artwork</option>
  {#each (groupMode?groupChoices:choices) as item}<option value={JSON.stringify([item.layerId,item.shapeId])}>{item.layerId} / {item.shapeId}</option>{/each}
</select></label>
<button disabled={!pick||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={()=>promotePick()}>Promote sampled symbol pose</button>
{#if nodeShape?.kind==='bezier'&&nodeShape.nodes?.length}
<label><input type="checkbox" aria-label="Drag sampled symbol Bezier nodes" bind:checked={nodeCanvas} onchange={()=>{nodePolicy++;cancelInteraction();if(nodeCanvas){pivotCanvas=false;compoundCanvas=false;compoundNodeCanvas=false;tangentCanvas=false;dragEnabled=false;rotateHandle=false;scaleHandles=false;skewHandles=false;}paint();}}/>Pick and drag original Bezier anchors</label>
<label><input type="checkbox" aria-label="Author sampled symbol node on release" bind:checked={nodeAuthor} disabled={!nodeCanvas} onchange={()=>{nodeReleasePolicy++;stopNodeDraft();}}/>Author the node position on valid release</label>
<p>{nodeAuthor?'Valid release freshly prepares the original node and authors one local edit.':'Release sets numeric drafts without editing artwork; commit stays explicit.'} Escape cancels; zero travel and returning to the start preserve artwork.</p>
<label>Bezier anchor number<input type="number" min="1" max={nodeShape.nodes.length} step="1" aria-label="Sampled symbol Bezier node number" value={node?node.owner.nodeIndex+1:''} disabled={!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onchange={e=>chooseNode(e.currentTarget.value)}/></label>
{#if node}
<label>Node document X<input type="number" step="any" aria-label="Sampled symbol node document X" bind:value={nodeX} disabled={(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} oninput={e=>nodeInput(e,'x')}/></label>
<label>Node document Y<input type="number" step="any" aria-label="Sampled symbol node document Y" bind:value={nodeY} disabled={(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} oninput={e=>nodeInput(e,'y')}/></label>
<button disabled={!validNode||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={previewNode}>Preview sampled symbol node position</button>
<button disabled={!validNode||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={promoteNode}>Promote and position sampled symbol node</button>
<p>Node positions use document coordinates and preserve handle offsets. Unapplied transform drafts stay separate; commit authors one local edit.</p>
{#if tangentParts.length}
<label><input type="checkbox" aria-label="Drag sampled symbol Bezier tangents" checked={tangentCanvas} disabled={tangentCoupled&&tangentParts.length!==2} onchange={e=>changeTangentCanvas(e.currentTarget.checked)}/> {tangentCoupled?'Pick and drag paired tangent drafts':'Pick and drag original tangent handles'}</label>
<label><input type="checkbox" aria-label="Author sampled symbol tangent on release" bind:checked={tangentAuthor} disabled={!tangentCanvas||tangentCoupled} onchange={()=>{tangentReleasePolicy++;stopTangentDraft();}}/>Author the tangent position on valid release</label>
{#if tangentCoupled}<label><input type="checkbox" aria-label="Author paired sampled symbol tangent on release" checked={pairedTangentAuthor} disabled={!tangentCanvas} onchange={e=>changePairedTangentAuthor(e.currentTarget.checked)}/>Author paired tangent on valid release</label>{/if}
<p>{tangentCoupled?(pairedTangentAuthor?'Valid paired release freshly authors one local edit.':'Paired release sets numeric drafts without editing artwork; commit explicitly.'):tangentAuthor?'Valid release freshly prepares the original tangent and authors one local edit.':'Release sets numeric drafts without editing artwork; commit stays explicit.'} Escape cancels; zero travel and returning to the start preserve artwork.</p>
<label>Existing tangent<select aria-label="Sampled symbol Bezier tangent role" value={tangent?.owner.part??''} disabled={!!failure||!!press||!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag)))))} onchange={e=>chooseTangent(e.currentTarget.value)}><option value="">Choose original handle</option>{#each tangentParts as part}<option value={part}>{part==='in'?'Incoming':'Outgoing'}</option>{/each}</select></label>
<label><input type="checkbox" aria-label="Couple sampled symbol tangent handles" checked={tangentCoupled} disabled={!tangentCoupled&&tangentParts.length!==2} onchange={e=>changeTangentCoupling(e.currentTarget.checked)}/>Align opposite handle, preserving its document-space length</label>
{#if tangent}
<label>Tangent document X<input type="number" step="any" aria-label="Sampled symbol tangent document X" bind:value={tangentX} disabled={!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag)))))} oninput={e=>tangentInput(e,'x')}/></label>
<label>Tangent document Y<input type="number" step="any" aria-label="Sampled symbol tangent document Y" bind:value={tangentY} disabled={!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag)))))} oninput={e=>tangentInput(e,'y')}/></label>
<button disabled={!validTangent||!!failure||!!press||!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag)))))} onclick={previewTangent}>Preview sampled symbol tangent position</button>
<button disabled={!validTangent||!!failure||!!press||!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag)))))} onclick={promoteTangent}>Promote and position sampled symbol tangent</button>
<p>{tangentCoupled?'Positions the selected handle and aligns its existing opposite while preserving its document-space length. The paired release policy controls authoring; explicit commit remains available.':'Moves only the selected existing handle; its opposite stays fixed.'} Anchor and topology stay fixed; anchor and transform drafts apply separately.</p>
{/if}
{/if}
{/if}
{/if}
{#if groupMode&&pick}
<button disabled={!!failure||!!press||!!drag} onclick={chooseGroupWaypoints}>Select original sampled symbol group waypoints</button>
{#if groupWaypoints}
<label><input type="checkbox" aria-label="Drag sampled symbol group waypoints" checked={waypointCanvas} disabled={!groupWaypoint} onchange={e=>changeWaypointCanvas(e.currentTarget.checked)}/>Drag original saved waypoint drafts</label>
<label><input type="checkbox" aria-label="Author sampled symbol group waypoint on release" checked={waypointAuthor} disabled={!waypointCanvas} onchange={e=>changeWaypointAuthor(e.currentTarget.checked)}/>Author waypoint on valid release</label>
<p>Drag the original selected waypoint marker. Shift constrains the document axis. {waypointAuthor?'Valid release authors one local edit.':'Release keeps an unapplied draft; commit explicitly.'} Other release preferences do not author waypoint edits.</p>
<label>Saved waypoint number<input type="number" min="1" max={groupWaypoints.path.waypoints.length} step="1" aria-label="Sampled symbol group waypoint number" value={waypointNumber??''} disabled={!!failure||!!press||!!drag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag)))} oninput={waypointIndexInput}/></label>
<label>Waypoint X offset<input type="number" step="any" aria-label="Sampled symbol group waypoint X offset" value={waypointX??''} disabled={!groupWaypoint||!!failure||!!press||!!drag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag)))} oninput={e=>waypointInput('x',e)}/></label>
<label>Waypoint Y offset<input type="number" step="any" aria-label="Sampled symbol group waypoint Y offset" value={waypointY??''} disabled={!groupWaypoint||!!failure||!!press||!!drag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag)))} oninput={e=>waypointInput('y',e)}/></label>
<button disabled={!validWaypoint||!!failure||!!press||!!drag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag)))||!!proposal} onclick={previewGroupWaypoint}>Preview sampled symbol group waypoint position</button>
<button disabled={!validWaypoint||!!failure||!!press||!!drag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag)))} onclick={commitGroupWaypoint}>Commit sampled symbol group waypoint position</button>
<p>Offsets use the original recipe leader's start position in document units. Saved handles and timing stay fixed; no waypoint is added or removed. Other drafts apply separately; canvas gestures are paused.</p>
{/if}
<button disabled={!!failure||!!press||!!drag} onclick={chooseGroupTrajectory}>Select original sampled symbol group trajectory</button>
{#if groupTrajectory}
<label><input type="checkbox" aria-label="Drag sampled symbol group cubic controls" checked={groupCurveCanvas} onchange={e=>changeGroupCurveCanvas(e.currentTarget.checked)}/>Drag original shared cubic control drafts</label>
<label>Original shared cubic control<select aria-label="Sampled symbol group cubic control role" value={groupCurvePart} onchange={e=>changeGroupCurvePart(e.currentTarget.value)}><option value="start">Start control</option><option value="end">End control</option></select></label>
<label><input type="checkbox" aria-label="Author sampled symbol group cubic control on release" checked={groupCurveAuthor} disabled={!groupCurveCanvas} onchange={e=>changeGroupCurveAuthor(e.currentTarget.checked)}/>Author shared cubic control on valid release</label>
<small>The original recipe leader owns the handle. Shift constrains the document axis. Release keeps an unapplied draft unless group cubic release authoring is enabled.</small>
{#each ['startX','startY','endX','endY'] as field}
<label>Group cubic {field}<input type="number" step="any" aria-label={'Sampled symbol group trajectory '+field} value={trajectoryControls[field as keyof TrajectoryControls]??''} disabled={!!failure||!!press||!!drag} oninput={e=>trajectoryInput(field as keyof TrajectoryControls,e)}/></label>
{/each}
<button disabled={!validTrajectory||!!failure||!!press||!!drag||!!groupCurveDrag||!!proposal} onclick={previewGroupTrajectory}>Preview sampled symbol group trajectory</button>
<button disabled={!validTrajectory||!!failure||!!press||!!drag||!!groupCurveDrag} onclick={commitGroupTrajectory}>Commit sampled symbol group trajectory</button>
<p>Cubic control offsets use the original recipe leader in document units. Edits replace the shared translation route while preserving endpoints and member geometry. Other drafts apply separately; canvas gestures are paused.</p>
{/if}
<button disabled={!!failure||!!press||!!drag} onclick={chooseGroupPivot}>Select original sampled symbol group pivot</button>
<label><input type="checkbox" aria-label="Drag sampled symbol group pivots" checked={groupPivotCanvas} disabled={!groupPivot} onchange={e=>changeGroupPivotCanvas(e.currentTarget.checked)}/>Drag original group pivot drafts</label>
<label><input type="checkbox" aria-label="Author sampled symbol group pivot on release" checked={groupPivotAuthor} disabled={!groupPivotCanvas} onchange={e=>changeGroupPivotAuthor(e.currentTarget.checked)}/>Author group pivot on valid release (one local edit)</label>
<label>Group pivot document X<input type="number" step="any" aria-label="Sampled symbol group pivot document X" value={groupPivotX??''} disabled={!groupPivot||!!drag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} oninput={e=>groupPivotInput(e,'x')}/></label>
<label>Group pivot document Y<input type="number" step="any" aria-label="Sampled symbol group pivot document Y" value={groupPivotY??''} disabled={!groupPivot||!!drag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} oninput={e=>groupPivotInput(e,'y')}/></label>
<button disabled={!validGroupPivot||!!failure||!!press||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))||!!drag||!!proposal} onclick={previewGroupPivot}>Preview sampled symbol group pivot position</button>
<button disabled={!validGroupPivot||!!failure||!!press||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))||!!drag} onclick={promoteGroupPivot}>Promote and position sampled symbol group pivot</button>
<p>Sets a shared pivot for the complete original group with fixed artwork. Saved/default pivot interpolation must already be enabled; saved group orbit motion stays separate. Enable a group transform to resume dragging.</p>
{/if}
{#if !groupMode&&pick}
<button disabled={!!failure||!!press||!!drag} onclick={chooseRootWaypoints}>Select original sampled symbol root waypoints</button>
{#if rootWaypoints}
<label><input type="checkbox" aria-label="Drag sampled symbol root waypoints" checked={rootWaypointCanvas} disabled={!rootWaypoint} onchange={e=>changeRootWaypointCanvas(e.currentTarget.checked)}/>Drag original saved root waypoint drafts</label>
<label><input type="checkbox" aria-label="Author sampled symbol root waypoint on release" checked={rootWaypointAuthor} disabled={!rootWaypointCanvas} onchange={e=>changeRootWaypointAuthor(e.currentTarget.checked)}/>Author root waypoint on valid release</label>
<small>Drag the original marker; Shift constrains the document axis. Release keeps an unapplied draft unless root waypoint release authoring is enabled.</small>
<label>Saved waypoint number<input type="number" min="1" max={rootWaypoints.path.waypoints.length} step="1" aria-label="Sampled symbol root waypoint number" value={rootWaypointNumber??''} disabled={!!failure||!!press||!!drag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))} oninput={rootWaypointIndexInput}/></label>
<label>Waypoint X offset<input type="number" step="any" aria-label="Sampled symbol root waypoint X offset" value={rootWaypointX??''} disabled={!rootWaypoint||!!failure||!!press||!!drag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))} oninput={e=>rootWaypointInput('x',e)}/></label>
<label>Waypoint Y offset<input type="number" step="any" aria-label="Sampled symbol root waypoint Y offset" value={rootWaypointY??''} disabled={!rootWaypoint||!!failure||!!press||!!drag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))} oninput={e=>rootWaypointInput('y',e)}/></label>
<button disabled={!validRootWaypoint||!!failure||!!press||!!drag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))||!!proposal} onclick={previewRootWaypoint}>Preview sampled symbol root waypoint position</button>
<button disabled={!validRootWaypoint||!!failure||!!press||!!drag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))} onclick={commitRootWaypoint}>Commit sampled symbol root waypoint position</button>
<p>Offsets use the original root start position in document units. Existing handles and timing stay fixed; no waypoint is added or removed. Other drafts apply separately; commit explicitly.</p>
{/if}
<button disabled={!!failure||!!press||!!drag} onclick={chooseRootTrajectory}>Select original sampled symbol root trajectory</button>
{#if rootTrajectory}
<label><input type="checkbox" aria-label="Drag sampled symbol cubic controls" checked={rootCurveCanvas} onchange={e=>changeRootCurveCanvas(e.currentTarget.checked)}/>Drag original cubic control drafts</label>
<label>Original cubic control<select aria-label="Sampled symbol cubic control role" value={rootCurvePart} onchange={e=>changeRootCurvePart(e.currentTarget.value)}><option value="start">Start control</option><option value="end">End control</option></select></label>
<label><input type="checkbox" aria-label="Author sampled symbol cubic control on release" checked={rootCurveAuthor} disabled={!rootCurveCanvas} onchange={e=>changeRootCurveAuthor(e.currentTarget.checked)}/>Author cubic control on valid release</label>
<small>Only original markers own picks. Shift constrains the document axis. Release keeps an unapplied draft unless cubic release authoring is enabled.</small>
{#each ['startX','startY','endX','endY'] as field}
<label>Root cubic {field}<input type="number" step="any" aria-label={'Sampled symbol root trajectory '+field} value={rootTrajectoryControls[field as keyof TrajectoryControls]??''} disabled={!!failure||!!press||!!drag} oninput={e=>rootTrajectoryInput(field as keyof TrajectoryControls,e)}/></label>
{/each}
<button disabled={!validRootTrajectory||!!failure||!!press||!!drag||(!!rootCurveDrag||!!groupCurveDrag)||!!proposal} onclick={previewRootTrajectory}>Preview sampled symbol root trajectory</button>
<button disabled={!validRootTrajectory||!!failure||!!press||!!drag||(!!rootCurveDrag||!!groupCurveDrag)} onclick={commitRootTrajectory}>Commit sampled symbol root trajectory</button>
<p>Cubic offsets use the original root origins in document units. Other drafts apply separately; commit this route explicitly.</p>
{/if}
{/if}
{#if !groupMode&&pick}
<button disabled={!!failure||!!press||!!drag||!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} onclick={choosePivot}>Select original sampled symbol pivot</button>
{#if pivot}
<label><input type="checkbox" aria-label="Drag sampled symbol pivots" checked={pivotCanvas} onchange={e=>changePivotCanvas(e.currentTarget.checked)}/>Drag original pivot drafts</label>
<label><input type="checkbox" aria-label="Author sampled symbol pivot on release" checked={pivotAuthor} disabled={!pivotCanvas} onchange={e=>changePivotAuthor(e.currentTarget.checked)}/>Author pivot on valid release (one local edit)</label>
<label>Pivot document X<input type="number" step="any" aria-label="Sampled symbol pivot document X" value={pivotX??''} disabled={!!drag||!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} oninput={e=>pivotInput(e,'x')}/></label>
<label>Pivot document Y<input type="number" step="any" aria-label="Sampled symbol pivot document Y" value={pivotY??''} disabled={!!drag||!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} oninput={e=>pivotInput(e,'y')}/></label>
<button disabled={!validPivot||!!failure||!!press||!!drag||!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} onclick={previewPivot}>Preview sampled symbol pivot position</button>
<button disabled={!validPivot||!!failure||!!press||!!drag||!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} onclick={promotePivot}>Promote and position sampled symbol pivot</button>
<p>Changes the original pivot while artwork stays fixed. Both recipes must already allow saved/default pivot interpolation. Other drafts apply separately.</p>
{/if}
{/if}
<label>Document X offset<input type="number" aria-label="Sampled symbol X offset" bind:value={moveX} disabled={(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} oninput={event=>offsetInput(event,'x')}/></label>
<label>Document Y offset<input type="number" aria-label="Sampled symbol Y offset" bind:value={moveY} disabled={(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} oninput={event=>offsetInput(event,'y')}/></label>
<button disabled={!pick||!validMove||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={previewMove}>Preview sampled symbol move</button>
<button disabled={!pick||!validMove||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={()=>promotePick({x:moveX!,y:moveY!})}>Promote and move sampled symbol pose</button>
{#if compoundShape}
<label><input type="checkbox" aria-label="Drag sampled symbol compound anchors" checked={compoundNodeCanvas} onchange={e=>changeCompoundNodeCanvas(e.currentTarget.checked)}/>Pick and drag original contour anchor drafts</label>
<label><input type="checkbox" aria-label="Author sampled symbol compound anchor on release" checked={compoundNodeAuthor} disabled={!compoundNodeCanvas} onchange={e=>changeCompoundNodeAuthor(e.currentTarget.checked)}/>Author compound anchor on valid release</label>
<label>Anchor contour number<input type="number" min="1" max={compoundShape.contours?.length} step="1" aria-label="Sampled symbol compound anchor contour number" value={anchorContour??''} oninput={e=>compoundAnchorIndex('contour',e.currentTarget.value)}/></label>
<label>Anchor node number<input type="number" min="1" max={anchorRing?.length} step="1" aria-label="Sampled symbol compound anchor node number" value={anchorIndex??''} disabled={!anchorRing} oninput={e=>compoundAnchorIndex('node',e.currentTarget.value)}/></label>
{#if compoundNodeSelection}
<label>Anchor document X<input type="number" step="any" aria-label="Sampled symbol compound anchor document X" bind:value={anchorX} oninput={e=>compoundAnchorInput(e,'x')}/></label>
<label>Anchor document Y<input type="number" step="any" aria-label="Sampled symbol compound anchor document Y" bind:value={anchorY} oninput={e=>compoundAnchorInput(e,'y')}/></label>
{/if}
<button disabled={!validCompoundNode||!!failure||!!press||!!drag||!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} onclick={previewCompoundNode}>Preview sampled symbol compound anchor position</button>
<button disabled={!validCompoundNode||!!failure||!!press||!!drag||!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} onclick={promoteCompoundNode}>Promote and position sampled symbol compound anchor</button>
<p>Moves an original contour anchor with its existing handle offsets. Tangent and transform drafts apply separately.</p>
<label><input type="checkbox" aria-label="Drag sampled symbol compound tangents" checked={compoundCanvas} onchange={e=>changeCompoundCanvas(e.currentTarget.checked)}/>Pick and drag original contour handle drafts</label>
<label><input type="checkbox" aria-label="Author sampled symbol compound tangent on release" checked={compoundAuthor} disabled={!compoundCanvas} onchange={e=>changeCompoundAuthor(e.currentTarget.checked)}/>Author compound tangent on valid release</label>
<label>Contour number<input type="number" min="1" max={compoundShape.contours?.length} step="1" aria-label="Sampled symbol compound contour number" value={compoundContour??''} oninput={e=>compoundIndex('contour',e.currentTarget.value)}/></label>
<label>Contour node number<input type="number" min="1" max={compoundRing?.length} step="1" aria-label="Sampled symbol compound node number" value={compoundNode??''} disabled={!compoundRing} oninput={e=>compoundIndex('node',e.currentTarget.value)}/></label>
<label>Existing compound tangent<select aria-label="Sampled symbol compound tangent role" value={compound?.owner.part??''} disabled={!compoundAnchor} onchange={e=>chooseCompound(e.currentTarget.value)}><option value="">Choose original handle</option>{#each compoundParts as part}<option value={part}>{part==='in'?'Incoming':'Outgoing'}</option>{/each}</select></label>
<label><input type="checkbox" aria-label="Couple sampled symbol compound tangent handles" checked={compoundCoupled} disabled={!compoundCoupled&&compoundParts.length!==2} onchange={e=>changeCompoundCoupling(e.currentTarget.checked)}/>Align opposite handle, preserving its document-space length</label>
{#if compound}
<label>Tangent document X<input type="number" step="any" aria-label="Sampled symbol compound tangent document X" bind:value={compoundX} oninput={e=>compoundInput(e,'x')}/></label>
<label>Tangent document Y<input type="number" step="any" aria-label="Sampled symbol compound tangent document Y" bind:value={compoundY} oninput={e=>compoundInput(e,'y')}/></label>
{/if}
<button disabled={!validCompound||!!failure||!!press||!!drag||!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} onclick={previewCompound}>Preview sampled symbol compound tangent position</button>
<button disabled={!validCompound||!!failure||!!press||!!drag||!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))} onclick={promoteCompound}>Promote and position sampled symbol compound tangent</button>
<p>Edits one original contour handle. Other rings and anchors stay fixed. Transform drafts apply separately.</p>
{/if}
<button disabled={!proposal||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={discardProposal}>Discard sampled symbol pose preview</button>
<label>Rotation degrees<input type="number" aria-label="Sampled symbol rotation angle" bind:value={angle} disabled={(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} oninput={angleInput}/></label>
<button disabled={!pick||!validRotation||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={previewRotation}>Preview sampled symbol rotation</button>
<button disabled={!pick||!validRotation||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={()=>{if(validRotation)promotePick(undefined,angle!);}}>Promote and rotate sampled symbol pose</button>
<p>Rotation uses {groupMode?'the common saved pivot or combined group authoring-box center':'the saved pivot or artwork-box center'} and ignores unapplied move offsets. Each action keeps the saved recipe options.</p>
<label>Scale X percent<input type="number" aria-label="Sampled symbol X scale" bind:value={scaleX} disabled={(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} oninput={event=>scaleInput(event,'x')}/></label>
<label>Scale Y percent<input type="number" aria-label="Sampled symbol Y scale" bind:value={scaleY} disabled={(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} oninput={event=>scaleInput(event,'y')}/></label>
<button disabled={!pick||!validScale||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={previewScale}>Preview sampled symbol scale</button>
<button disabled={!pick||!validScale||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={()=>{if(validScale)promotePick(undefined,undefined,{x:scaleX!/100,y:scaleY!/100});}}>Promote and scale sampled symbol pose</button>
<p>Scale uses document axes and {groupMode?'the common saved pivot or combined group authoring-box center':'the saved pivot or artwork-box center'}. Unapplied movement and rotation drafts stay separate; saved affine/group options must already admit the change.</p>
<label>Skew axis<select aria-label="Sampled symbol skew axis" bind:value={skewAxis} disabled={(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onchange={skewAxisInput}><option value="x">Document X</option><option value="y">Document Y</option></select></label>
<label>Skew degrees<input type="number" aria-label="Sampled symbol skew angle" bind:value={skewAngle} disabled={(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} oninput={skewInput}/></label>
<button disabled={!pick||!validSkew||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={previewSkew}>Preview sampled symbol skew</button>
<button disabled={!pick||!validSkew||!!failure||!!press||(!!drag||(!!nodeDrag||!!tangentDrag||!!compoundDrag||!!compoundNodeDrag||!!pivotDrag||(!!groupPivotDrag||(!!waypointDrag||(!!rootWaypointDrag||(!!rootCurveDrag||!!groupCurveDrag))))))} onclick={()=>{if(validSkew)promotePick(undefined,undefined,undefined,{axis:skewAxis,degrees:skewAngle!});}}>Promote and skew sampled symbol pose</button>
<p>Skew uses one document axis about {groupMode?'the common saved pivot or combined group authoring-box center':'the saved/default pivot'}. Unapplied movement, rotation and scale stay separate; saved affine/group options must admit the result.</p>
{/if}
<p role="status">{failure||actionError||status}</p>
<p>This view samples remembered recipes, including reachable nested artwork. Preparation is read-only and rejects edited child recipes. Picks identify whole root items; text and symbols use their interaction bounds. Authored endpoints, holds and locked foreground items cannot be promoted here. Movie children show their authoring pose. Onion and range overlays stay in the stored-key view.</p>
<style>canvas{display:block;max-width:100%;height:auto;touch-action:none;}select{max-width:100%;}</style>

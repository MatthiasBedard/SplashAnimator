<script lang="ts">
  import { appendHistory, HistoryEntry, moveHistory } from '../../../packages/document/src/history-storage';
  import {captureFrameSymbolSimplifyContext} from './frame-symbol-simplify-context';
  import {validateLiveGraphicData} from '../../../packages/document/src/live-motion';
  import {assertSymbolSimplifyDetached as frameDetached} from '../../../packages/geometry/src/symbol-simplify-owner';
  import NumberSlider from './NumberSlider.svelte';
  import ContextMenu, { type ContextAction } from './ContextMenu.svelte';
  import ScriptCheck from './ScriptCheck.svelte';
  import { frameScriptStarter } from './script-workspace';
  import ScriptPreview from './ScriptPreview.svelte';
  import {createSymbolScriptArtworkProvider,querySymbolScriptArtworkTargets,prepareSymbolScriptArtworkVisual,renderSymbolScriptArtworkVisual,prepareSymbolScriptArtworkPress,renderSymbolScriptArtworkPress,prepareSymbolScriptArtworkDelivery,renderSymbolScriptArtworkDelivery,type SymbolArtworkDelivery,prepareSymbolScriptArtworkContinuation,renderSymbolScriptArtworkContinuation,captureSymbolScriptArtworkHistory,restoreSymbolScriptArtworkHistory,type SymbolArtworkHistory,type SymbolArtworkTargetQuery} from './symbol-script-artwork';
  import {captureSymbolLocalProgram,subscribeSymbolProgramDisposal,type SymbolProgramSnapshot} from '../../../packages/scripting/src/symbol-program';
  import {captureIsolatedSymbolFrameSources} from '../../../packages/document/src/symbol-frame-sources';
  import { parseMotionSpanLengths, motionSpanFrameCount } from '../../../packages/animation/src/motion-spans';
  import MotionNodeHints from './MotionNodeHints.svelte';
  import { parseMotionNodeHints } from '../../../packages/animation/src/motion-resample';
  import { parseMotionGradientPairs } from "../../../packages/animation/src/motion-frames";
  import { parseMotionContourStarts, parseMotionContourOrder, parseMotionContourDirections } from "../../../packages/animation/src/motion-nodes";
  import { translateSymbolRememberedEndpoint, rotateSymbolRememberedEndpoint, scaleSymbolRememberedEndpoint, skewSymbolRememberedEndpoint } from '../../../packages/animation/src/motion-junction';
  import MotionRotationControls from './MotionRotationControls.svelte';
  import type { MotionRotation } from '../../../packages/animation/src/motion-rotation';
  import MotionPathControls from './MotionPathControls.svelte';
  import MotionPathPreview from './MotionPathPreview.svelte';
  import type { MotionPath } from '../../../packages/animation/src/motion-path';
  import MotionEasing from './MotionEasing.svelte';
  import { subdividePreservedSymbolMotionSpan } from '../../../packages/animation/src/motion-subdivide';
  import RememberedPositionTiming from './RememberedPositionTiming.svelte';
  import { type SymbolPositionInterval, type SymbolPropertyKey, rememberedPaintSummary, rememberedOpacitySummary, editSymbolBasicMotionSpan, refreshChangedSymbolMotionSpans } from '../../../packages/animation/src/motion-spans';
  import { generateSymbolMotionFrames, type MotionEase } from '../../../packages/animation/src/motion-frames';
  import {
    symbolTrackEditContext,
    type SymbolEditContext,
  } from '../../../packages/geometry/src/symbol-context';
  import {
    symbolMultiFrameProject,
    symbolFromMultiFrameProject,
  } from '../../../packages/animation/src/symbol-multi-frame';
  import {
    multiFrameKeys,
    pickMultiFrameGroup,
    multiFrameId,
    multiFrameMembers,
    selectMultiFrames,
    translateMultiFrames,
    transformMultiFrames,
    deleteMultiFrames,
  } from '../../../packages/animation/src/multi-frame';
  import {
    rangeHandleTransform,
    rangePivotDrag,
  } from '../../../packages/geometry/src/range-handles';
  import { objectBounds, type Bounds } from '../../../packages/geometry/src/layout';
  import { hit } from '../../../packages/geometry/src';
  import type { Point } from '../../../packages/document/src';
  import type { SelectionMode } from '../../../packages/geometry/src/lasso';
  import { around, type Matrix } from '../../../packages/geometry/src/affine';
  import { onMount, onDestroy, tick, untrack } from 'svelte';
  import {selectionTrajectoryStamp} from '../../../packages/animation/src/selection-trajectory';
  import {captureOpacityEase,capturePaintEase} from '../../../packages/document/src/motion-ease';
  import {watchRememberedCreationInputs,assertRememberedCreation,type RememberedCreationRecipe} from './remembered-creation';
  import {
    clone,
    id,
    keyAt,
    symbolLayers,
    type Project,
    type SymbolDefinition,
    type Vector,
  } from '../../../packages/document/src';
  import { expandSymbols } from '../../../packages/geometry/src/symbols';
  import {
    transferSymbolKey,
    transferSymbolFrames,
    transferSymbolTracks,
    duplicateSymbolLayer,
    distributeSymbolArtwork,
    cutSymbolTracks,
    clearSymbolFrames,
    reverseSymbolFrames,
    insertSymbolFrames,
    removeSymbolFrames,
    duplicateSymbolFrames,
    editSymbolTracks,
    retimeSymbolTracks,
    copySymbolTracks,
    insertSymbolTracks,
    type SymbolTrackClip,
  } from '../../../packages/animation/src/symbol-timeline';
  import type { FrameClip } from '../../../packages/animation/src/timeline';
  import {prepareSymbolRememberedPlayback} from '../../../packages/animation/src/symbol-remembered-playback';
  import { createSymbolPreviewClock } from '../../../packages/animation/src/symbol-preview-clock';
  import { symbolOnionFrames } from '../../../packages/animation/src/onion';
  import { drawShape, createOnionPainter } from '../../../packages/stage/src';
  import type {captureSymbolRememberedAuthoringFrame} from '../../../packages/animation/src/symbol-motion-owner';
  import {rememberedAuthoringPivot} from '../../../packages/animation/src/motion-junction';
  import SymbolSampledStage from './SymbolSampledStage.svelte';
  import {admitSymbolSampledSelectionTrajectoryPublication,type SymbolSampledSelectionTrajectoryEdit} from './symbol-sampled-selection-trajectory-editor';
  import {admitSymbolSampledSelectionPublication,type SymbolSampledSelectionEdit} from './symbol-sampled-selection-editor';
  import SymbolEditor from './SymbolEditor.svelte';
  import SymbolButtonPreview from './SymbolButtonPreview.svelte';
  import { wrapDialogTab } from './dialog-focus';
  let buttonPreview = $state(false);
  import SymbolFrameGrid from './SymbolFrameGrid.svelte';
  let {
    definition,
    readSourceProject,
    stageSimplify,
    hierarchyOwner,
    assets,
    symbols,
    fps,
    apply,
    validate,
    cancel,
    context,
    navigate: navigateContext,
    location,
    initialScriptFrame,
    returnTo,
    returnName,
  }: {
    definition: SymbolDefinition;
    readSourceProject: ()=>{project:Project;revision:number};
    stageSimplify?:()=>void;
    hierarchyOwner?: string;
    assets: Project['assets'];
    symbols: SymbolDefinition[];
    fps: number;
    apply: (d: SymbolDefinition, admit?:()=>void) => string | null;
    validate: (d: SymbolDefinition) => void;
    cancel: () => void;
    context?: SymbolEditContext;
    location?: { layerId: string; frame: number };
    initialScriptFrame?: number;
    navigate?: (id: string, location: { layerId: string; frame: number }) => string | null;
    returnTo?: () => string | null;
    returnName?: string;
  } = $props();
  let draft = $state(untrack(() => clone(definition))),
    frame = $state(untrack(() => initialScriptFrame ?? location?.frame ?? context?.initialFrame ?? 0)),
    playing = $state(false),
    editing = $state(false),
    error = $state('');
  let sourceEditor=$state.raw<ReturnType<typeof captureLocalSourceEditor>>();
  let localSourceDraft=$state(''),sourceMessage=$state('');
  let frameScriptMenu = $state.raw<{x:number;y:number;items:ContextAction[]}>();
  let localScriptEditor = $state.raw<ReturnType<typeof ScriptCheck>>();
  let sourceLeaveBlocked = $state(false);
  async function leaveLocalSource(afterSave?: () => void) {
    const editorId = sourceEditor?.id;
    if (editorId) {
      const saved = await localScriptEditor?.flush();
      if (sourceEditor?.id !== editorId) return;
      if (saved === false) { sourceLeaveBlocked = true; return; }
      closeLocalSource();
    }
    afterSave?.();
  }
  function closeLocalSource(){
    sourceEditor?.owner.dispose();sourceEditor=undefined;sourceLeaveBlocked=false;
  }
  function captureLocalSourceEditor(editorId:string,selection?:{line:number;column:number}){
      const originalDraft=draft,originalSymbols=symbols,originalAssets=assets,originalPast=past,originalFuture=future;
      const originalFrame=frame,originalLayer=layerId,originalHierarchy=hierarchyOwner,validator=validate,readEnclosing=readSourceProject;
      const expected=JSON.stringify([draft,symbols,assets,frame,layerId,hierarchyOwner]);
      const verify=()=>{
        if(draft!==originalDraft||symbols!==originalSymbols||assets!==originalAssets||past!==originalPast||future!==originalFuture||frame!==originalFrame||layerId!==originalLayer||hierarchyOwner!==originalHierarchy||hierarchyOwner!==sampledEnclosingOwner||playing||editing||buttonPreview||sampledStage||rangeGesture||JSON.stringify([draft,symbols,assets,frame,layerId,hierarchyOwner])!==expected)
          throw new Error('Symbol source editing context changed. Close and reopen the source editor.');
      };
      const sourceDefinition=draft.timeline ? draft : {...$state.snapshot(draft),timeline:{duration:1,keys:[]}};
      const owner=captureIsolatedSymbolFrameSources(()=>{const enclosing=readEnclosing();return {project:enclosing.project,definition:sourceDefinition,revision:enclosing.revision,frame,validateEnclosing:verify};});
      const original=draft.timeline?.frameScripts?.find(entry=>entry.frame===frame)?.source;
      return {id:editorId,frame,original,owner,validate:validator,verify,
        selection:selection?{source:original??'',...selection}:undefined,
        persist:(source:string)=>commitLocalSource(source,owner),apply:(source:string)=>commitLocalSource(source,owner,true),
        remove:()=>commitLocalSource(null,owner,true)};
  }
  function openLocalSource(selection?:{line:number;column:number},attach=false){
    cancelRangeGesture();releaseRemembered();playing=false;sampledStage=false;moviePose=null;sourceMessage='';
    try {
      const session=captureLocalSourceEditor(id(),selection);
      localSourceDraft=session.original??(attach?frameScriptStarter:'');
      sourceEditor=session;
      if(attach&&session.original===undefined)session.persist(frameScriptStarter);
    }catch(e){error=String(e);}
  }
  function commitLocalSource(source:string|null,owned:ReturnType<typeof captureIsolatedSymbolFrameSources>,close=false):void{
    const session=sourceEditor;if(!session||session.owner!==owned)throw new Error('Local source editor closed.');
    session.verify();const input=localSourceDraft;
    if((source??undefined)===session.original){
      session.owner.assertCurrent();
      if(close)closeLocalSource();
      return;
    }
    const verifyInput=()=>{if(localSourceDraft!==input)throw new Error('Local source text changed during preparation. Try saving again.');};
    const before=snapshot(),candidate=session.owner.prepare(source);
    verifyInput();
    const expected=JSON.stringify(candidate);
    session.validate(candidate);
    const nextPast=appendHistory(past, new HistoryEntry<Snapshot>(before));
    if(JSON.stringify(candidate)!==expected)throw new Error('Prepared local source candidate changed.');
    session.owner.assertCurrent();session.verify();verifyInput();
    if(sourceEditor!==session)throw new Error('Local source editor changed.');
    const unchanged=JSON.stringify(before.definition)===expected;
    session.owner.assertCurrent();session.verify();
    verifyInput();closeLocalSource();
    if(!unchanged){draft=candidate;past=nextPast;future=[];}
    if(!close)sourceEditor=captureLocalSourceEditor(session.id);
    error='';
    if(close)sourceMessage=source===null?'Local frame source removed from the draft.':'Local frame source applied to the draft.';
  }
  type LocalArtworkHistory={capture:(image:Blob)=>SymbolArtworkHistory;restore:(history:SymbolArtworkHistory,signal:AbortSignal)=>Promise<Blob>};
  type LocalInspector={subscribeSoundDisposal:(dispose:()=>void)=>()=>void;qualifyArtwork:(image:Blob,query:SymbolArtworkTargetQuery,input:Pick<import('../../../packages/scripting/src/button-input').ScriptButtonHoverInput,'type'|'pointerId'|'button'>)=>SymbolArtworkDelivery;publishArtworkDelivery:(delivery:SymbolArtworkDelivery,pose:import('../../../packages/export-web/src').PresentationPose,signal:AbortSignal,validateInput:()=>void,textValues?:unknown,hiddenPlacements?:unknown,placementTransforms?:unknown,spawnedGraphics?:unknown)=>Promise<Blob>;pressArtwork:(image:Blob,query:SymbolArtworkTargetQuery,input:Pick<import('../../../packages/scripting/src/button-input').ScriptButtonHoverInput,'type'|'pointerId'|'button'>,pose:import('../../../packages/export-web/src').PresentationPose,signal:AbortSignal,textValues?:unknown,hiddenPlacements?:unknown,placementTransforms?:unknown,spawnedGraphics?:unknown)=>Promise<Blob>;continueArtwork:(image:Blob,poses:readonly import('../../../packages/export-web/src').PresentationPose[],signal:AbortSignal,textValues?:unknown,hiddenPlacements?:unknown,placementTransforms?:unknown,spawnedGraphics?:unknown)=>Promise<Blob>;hoverArtwork:(image:Blob,query:SymbolArtworkTargetQuery,state:'up'|'over',pose:import('../../../packages/export-web/src').PresentationPose,signal:AbortSignal,textValues?:unknown,hiddenPlacements?:unknown,placementTransforms?:unknown,spawnedGraphics?:unknown)=>Promise<Blob>;artworkHistory:LocalArtworkHistory;id:string;owner:ReturnType<typeof captureSymbolLocalProgram>;data:SymbolProgramSnapshot;verify:()=>void;prepare:ReturnType<typeof captureSymbolLocalProgram>['prepare'];renderArtwork:(poses:readonly import('../../../packages/export-web/src').PresentationPose[],signal:AbortSignal,textValues?:unknown,hiddenPlacements?:unknown,placementTransforms?:unknown,spawnedGraphics?:unknown)=>Promise<Blob>;queryArtwork:(image:Blob,points:readonly {x:number;y:number}[],signal:AbortSignal)=>Promise<SymbolArtworkTargetQuery>;openSource:(frame:number,location?:{line:number;column:number})=>void};
  let localInspector=$state.raw<LocalInspector>(),localInspectorError=$state('');
  function closeLocalInspector(){localInspector?.owner.dispose();localInspector=undefined;localInspectorError='';}
  function openLocalInspector(){
    cancelRangeGesture();releaseRemembered();playing=false;sampledStage=false;moviePose=null;localInspectorError='';
    let owner:ReturnType<typeof captureSymbolLocalProgram>|undefined;
    try{
      const originalDraft=draft,originalSymbols=symbols,originalAssets=assets,originalPast=past,originalFuture=future,originalFrame=frame,originalLayer=layerId,originalHierarchy=hierarchyOwner,readEnclosing=readSourceProject;
      const expected=JSON.stringify([draft,symbols,assets,frame,layerId,hierarchyOwner]);
      const context=()=>{if(draft!==originalDraft||symbols!==originalSymbols||assets!==originalAssets||past!==originalPast||future!==originalFuture||frame!==originalFrame||layerId!==originalLayer||hierarchyOwner!==originalHierarchy||hierarchyOwner!==sampledEnclosingOwner||playing||editing||buttonPreview||sampledStage||rangeGesture||JSON.stringify([draft,symbols,assets,frame,layerId,hierarchyOwner])!==expected)throw new Error('Symbol inspector source or context changed. Close and reopen the inspector.');};
      const captured=captureSymbolLocalProgram(()=>{const enclosing=readEnclosing();return {project:enclosing.project,definition:draft,revision:enclosing.revision,frame,validateEnclosing:context};},0);owner=captured;
      const data=captured.snapshot();
      let session:LocalInspector,images:ReturnType<typeof createSymbolScriptArtworkProvider>|undefined;
      const verify=()=>{if(localInspector!==session||localInspectorError)throw new Error('Local inspector closed or invalidated.');context();captured.assertCurrent();};
      session={id:id(),owner:captured,data,verify,subscribeSoundDisposal:dispose=>subscribeSymbolProgramDisposal(captured,dispose),qualifyArtwork:(image,query,input)=>{verify();if(!images)throw new Error('No qualified local artwork image.');return prepareSymbolScriptArtworkDelivery(images,image,query,0,input);},publishArtworkDelivery:(delivery,pose,signal,validateInput,textValues,hiddenPlacements,placementTransforms,spawnedGraphics)=>{verify();if(!images)throw new Error('No qualified local artwork image.');return renderSymbolScriptArtworkDelivery(images,delivery,{frame:pose.frame,tick:pose.tick},{signal,validateInput,textValues,hiddenPlacements,placementTransforms,spawnedGraphics});},pressArtwork:(image,query,input,pose,signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics)=>{verify();if(!images)throw new Error('No qualified local artwork image.');const plan=prepareSymbolScriptArtworkPress(images,image,query,0,input,{frame:pose.frame,tick:pose.tick});verify();return renderSymbolScriptArtworkPress(images,plan,{signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics});},continueArtwork:(image,poses,signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics)=>{verify();if(!images)throw new Error('No qualified local artwork image.');const plan=prepareSymbolScriptArtworkContinuation(images,image,poses.map(({frame,tick})=>({frame,tick})));verify();return renderSymbolScriptArtworkContinuation(images,plan,{signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics});},hoverArtwork:(image,query,state,pose,signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics)=>{verify();if(!images)throw new Error('No qualified local artwork image.');const plan=prepareSymbolScriptArtworkVisual(images,image,query,0,state,{frame:pose.frame,tick:pose.tick});verify();return renderSymbolScriptArtworkVisual(images,plan,{signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics});},artworkHistory:{capture:image=>{verify();if(!images)throw new Error('No qualified local artwork image.');return captureSymbolScriptArtworkHistory(images,image);},restore:(history,signal)=>{verify();if(!images)throw new Error('No qualified local artwork image.');return restoreSymbolScriptArtworkHistory(images,history,{signal});}},queryArtwork:(image,points,signal)=>{verify();if(!images)throw new Error('No qualified local artwork image.');return querySymbolScriptArtworkTargets(images,image,points,{signal});},renderArtwork:(poses,signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics)=>{verify();images??=createSymbolScriptArtworkProvider(captured);return images.render(poses,{signal,textValues,hiddenPlacements,placementTransforms,spawnedGraphics});},prepare:(state,options)=>{verify();return captured.prepare(state,options);},openSource:(target,location)=>{
        verify();if(!Number.isSafeInteger(target)||target<0||target>=data.config.duration)throw new Error('Invalid local source frame.');
        closeLocalInspector();frame=target;openLocalSource(location);
      }};
      localInspector=session;
    }catch(cause){owner?.dispose();error=String(cause);}
  }
  $effect(()=>{
    const session=localInspector;
    if(session&&!localInspectorError){
      void past;void future;void JSON.stringify([draft,symbols,assets,frame,layerId,hierarchyOwner,playing,editing,buttonPreview,sampledStage]);
      try{session.verify();}catch(cause){session.owner.dispose();localInspectorError=String(cause);}
    }
  });
  onDestroy(()=>{closeLocalSource();closeLocalInspector();});
  let moviePose = $state<{ frame: number; draft: string; frames: Record<string, number> } | null>(
    null,
  );
  let rememberedPlayback=$state(false),preparingRemembered=$state(false),rememberedFailure=$state(false);
  let rememberedPose=$state.raw<{frame:number;shapes:Vector[]}>();
  let rememberedSession:Awaited<ReturnType<typeof prepareSymbolRememberedPlayback>>|undefined;
  let rememberedJob:AbortController|undefined,rememberedOwner='',rememberedDataOwner='',previewAlive=false,playbackEpoch=0;
  // The data stamp owns the detached playback snapshot. The broader stamp
  // also invalidates playback when the user changes its range or mode.
  function playbackDataStamp(){return JSON.stringify([draft,symbols,assets,fps,hierarchyOwner]);}
  function playbackStamp(){return JSON.stringify([draft,symbols,assets,fps,hierarchyOwner,previewRange,previewLoop,rangeStart,rangeEnd,rememberedPlayback,editing,buttonPreview,sampledStage]);}
  function releaseRemembered(){
    rememberedJob?.abort();rememberedJob=undefined;rememberedSession?.dispose();rememberedSession=undefined;
    preparingRemembered=false;rememberedPose=undefined;rememberedFailure=false;
  }
  $effect(()=>{
    const stamp=playbackStamp();
    if((rememberedSession||preparingRemembered)&&
      (stamp!==rememberedOwner||hierarchyOwner!==sampledEnclosingOwner||(!playing&&rememberedPose&&rememberedPose.frame!==frame))){
      const stale=playbackDataStamp()!==rememberedDataOwner||hierarchyOwner!==sampledEnclosingOwner;
      releaseRemembered();playing=false;
      if(stale&&rememberedPlayback){rememberedFailure=true;error='Symbol playback source changed. Start the preview again.';}
    }
    paint();
  });
  let previewRange = $state(false),
    previewLoop = $state(true);
  let onion = $state(false),
    onionBefore = $state(1),
    onionAfter = $state(1),
    onionOpacity = $state(0.25);
  let onionKeys = $state(false),
    onionActive = $state(false),
    onionFade = $state(true);
  let onionOutline = $state(false);
  let onionTint = $state(false),
    onionPastColor = $state('#ff0000'),
    onionFutureColor = $state('#00ff00');
  let destination = $state(2);
  let destinationLayerId = $state('');
  let rangeDestination = $state(1),
    rangeTrack = $state('');
  let rangeStart = $state(1),
    rangeEnd = $state(1),
    insertAt = $state(1);
  let clipboard = $state<FrameClip | null>(null);
  let clipboardKind = $state<'single' | 'tracks'>('single');
  let layerId = $state(untrack(() => location?.layerId ?? '@base'));
  let sampledStage=$state(false);
  const sampledEnclosingOwner=untrack(()=>hierarchyOwner);
  const sampledScope=$derived(JSON.stringify([draft,symbols,assets,frame,layerId,hierarchyOwner]));
  $effect(()=>{if(playing||editing||buttonPreview)sampledStage=false;});

  let selectedTracks = $state<string[]>([]);
  let spanDestinations = $state<Record<string, string>>({});
  let trackClipboard = $state<SymbolTrackClip | null>(null);
  let trackDestinations = $state<string[]>([]);
  type Snapshot = {
    definition: SymbolDefinition;
    frame: number;
    layerId: string;
    rangeStart: number;
    rangeEnd: number;
    selectedTracks: string[];
    spanDestinations: Record<string, string>;
    sampledSelection?: string[];
    sampledTrajectories?: {units:number;tracks:number;members:number};
    sampledRotation?: {degrees:number;pivot:{x:number;y:number}};
    sampledScale?: {x:number;y:number;pivot:{x:number;y:number}};
    sampledSkew?: {axis:'x'|'y';degrees:number;pivot:{x:number;y:number}};
  };
  let past = $state.raw<HistoryEntry<Snapshot>[]>([]),
    future = $state.raw<HistoryEntry<Snapshot>[]>([]);
  let dialog: HTMLDialogElement;
  let canvas=$state<HTMLCanvasElement>(null!);
  const duration = $derived(draft.timeline?.duration ?? 1);
  const layers = $derived(symbolLayers(draft));
  const layer = $derived(layers.find((l) => l.id === layerId)!);
  const writable = $derived(layer.visible && !layer.locked);
  const artwork = $derived(keyAt(layer, frame).shapes);
  const key = $derived(layer.keys.some((k) => k.frame === frame));
  const keyframes = $derived(layer.keys);
  const junction=$derived(layer.motionSpans?.some(s=>s.end===frame)&&layer.motionSpans?.some(s=>s.start===frame));
  const junctionScope=$derived(JSON.stringify([draft.id,layerId,frame]));
  let junctionNode=$state<{scope:string;shapeId:string;index:number;part?:'in'|'out';contour?:number}>();
  let junctionPick=$state({scope:'',ids:[] as string[]});
  const junctionIds=$derived(junctionPick.scope===junctionScope?junctionPick.ids:[]);
  const authoredPivot=$derived.by(()=>{const members=keyAt(layer,frame).shapes.filter(s=>junctionIds.includes(s.id));return members.length&&members.length===junctionIds.length?rememberedAuthoringPivot(members):undefined;});
  let junctionDx=$state(0),junctionDy=$state(0),junctionAngle=$state(0),junctionScaleX=$state(100),junctionScaleY=$state(100);
  let junctionSkewAxis=$state<'x'|'y'>('x'),junctionSkewAngle=$state(0);
  function sampledSourceValidator(expected:string){
    const originalDraft=draft,originalSymbols=symbols,originalAssets=assets,originalPast=past,originalFuture=future;
    // Freeze the keyed instance's source, rather than rereading a reactive
    // template constant during a reentrant edit before the keyed remount.
    return ()=>{
      if(expected!==JSON.stringify([draft,symbols,assets,frame,layerId,hierarchyOwner])||hierarchyOwner!==sampledEnclosingOwner||draft!==originalDraft||symbols!==originalSymbols||assets!==originalAssets||past!==originalPast||future!==originalFuture)
        throw new Error('Symbol editing source changed. Cancel and reopen the timeline.');
    };
  }
  function promoteSampled(
    owner:ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolve']>|ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolveGroup']>|ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolveNode']>|ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolveTangent']>|ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolveCompoundTangent']>|ReturnType<ReturnType<typeof captureSymbolRememberedAuthoringFrame>['resolveCompoundNode']>,
    prepare:()=>SymbolDefinition,verify:()=>void,
  ){
    if(!sampledStage||playing||editing||buttonPreview||rangeGesture||owner.definitionId!==draft.id||owner.frame!==frame)
      throw new Error('Symbol editing context changed. Pick the pose again.');
    const source=()=>JSON.stringify([draft,symbols,assets,frame,layerId,hierarchyOwner,playing,editing,buttonPreview,!!rangeGesture,sampledStage]);
    const expected=source(),before=snapshot();
    const originalDraft=draft,originalSymbols=symbols,originalAssets=assets,originalPast=past,originalFuture=future;
    const candidate=prepare();
    // Enclosing library/assets/cycle admission precedes every local history write.
    validate(candidate);
    const unchanged=JSON.stringify(candidate)===JSON.stringify(before.definition);
    const nextPast=appendHistory(past, new HistoryEntry<Snapshot>(before));
    const nextPick={scope:JSON.stringify([candidate.id,owner.layerId,owner.frame]),ids:'shapeIds' in owner?[...owner.shapeIds]:[owner.shapeId]};
    verify();
    if(source()!==expected||hierarchyOwner!==sampledEnclosingOwner||draft!==originalDraft||symbols!==originalSymbols||
      assets!==originalAssets||past!==originalPast||future!==originalFuture)
      throw new Error('Symbol editing source changed. Cancel and reopen the timeline.');
    // Serialization/enclosing reads may invoke callbacks; release policies get
    // the final admission before any local draft/history publication.
    verify();
    if(draft!==originalDraft||symbols!==originalSymbols||assets!==originalAssets||past!==originalPast||future!==originalFuture)
      throw new Error('Symbol editing source changed during final admission.');
    if(unchanged)return;
    draft=candidate;layerId=owner.layerId;frame=owner.frame;
    junctionNode='nodeIndex' in owner?{scope:nextPick.scope,shapeId:owner.shapeId,index:owner.nodeIndex,...('part' in owner?{part:owner.part}:{}),...('contourIndex' in owner?{contour:owner.contourIndex}:{})}:undefined;
    junctionPick=nextPick;past=nextPast;future=[];error='';sampledStage=false;moviePose=null;
  }
  function publishSampledSelection(edit:SymbolSampledSelectionEdit){publishSelectionCandidate(edit,false);}
  function publishSelectionTrajectories(edit:SymbolSampledSelectionTrajectoryEdit,finalAdmission?:()=>void){publishSelectionCandidate(edit,true,finalAdmission);}
  function publishSelectionCandidate(edit:SymbolSampledSelectionEdit|SymbolSampledSelectionTrajectoryEdit,trajectories:boolean,finalAdmission?:()=>void){
    const admit=()=>{if(trajectories)admitSymbolSampledSelectionTrajectoryPublication(edit as SymbolSampledSelectionTrajectoryEdit);else admitSymbolSampledSelectionPublication(edit as SymbolSampledSelectionEdit);};
    if(trajectories)admit();
    if(!sampledStage||playing||editing||buttonPreview||rangeGesture||edit.owner.definitionId!==draft.id||edit.owner.frame!==frame)
      throw Error('The isolated selection editing context changed.');
    const source=()=>JSON.stringify([draft,symbols,assets,frame,layerId,hierarchyOwner,playing,editing,buttonPreview,!!rangeGesture,sampledStage]);
    const expected=source(),before=snapshot(),originalDraft=draft,originalLayer=layerId,originalSymbols=symbols,originalAssets=assets,originalPast=past,originalFuture=future;
    admit();validate(edit.candidate);JSON.stringify(edit.candidate);
    const nextPast=appendHistory(past, new HistoryEntry<Snapshot>(before)),tracks=edit.owner.tracks.map(t=>t.layerId),at=edit.owner.frame;
    const picked=edit.owner.tracks.flatMap(t=>t.shapeIds.map(id=>multiFrameId(t.layerId,at,id)));
    const rotation='rotation' in edit&&edit.rotation?structuredClone(edit.rotation):null;
    const scaling='scaling' in edit&&edit.scaling?structuredClone(edit.scaling):null;
    const shearing='shearing' in edit&&edit.shearing?structuredClone(edit.shearing):null;
    const routeReadout=trajectories?{units:edit.owner.units.length,tracks:tracks.length,members:picked.length}:null;
    admit();
    if(source()!==expected||hierarchyOwner!==sampledEnclosingOwner||draft!==originalDraft||symbols!==originalSymbols||assets!==originalAssets||past!==originalPast||future!==originalFuture)
      throw Error('The original isolated selection source changed.');
    admit();
    finalAdmission?.();
    if((trajectories&&(!sampledStage||playing||editing||buttonPreview||rangeGesture||frame!==at||layerId!==originalLayer||hierarchyOwner!==sampledEnclosingOwner))||draft!==originalDraft||symbols!==originalSymbols||assets!==originalAssets||past!==originalPast||future!==originalFuture)
      throw Error('The isolated selection changed during final admission.');
    draft=edit.candidate;frame=at;layerId=tracks[0];selectedTracks=tracks;rangeStart=at+1;rangeEnd=at+1;
    rangeArtwork=true;rangePick='move';rangeSelection=picked;rangeOffset={x:0,y:0};rangeOperation=null;
    selectionScope=JSON.stringify([draft,tracks,rangeStart,rangeEnd]);sampledSelectionScope=selectionScope;junctionNode=undefined;junctionPick={scope:'',ids:[]};
    sampledSelectionTrajectories=routeReadout;
    sampledSelectionRotation=rotation;
    sampledSelectionScale=scaling;
    sampledSelectionSkew=shearing;
    past=nextPast;future=[];error='';sampledStage=false;moviePose=null;
  }
  function moveJunction(){
    if(!junction||!writable||playing||!junctionIds.length)return;
    mutate(()=>{draft=translateSymbolRememberedEndpoint($state.snapshot(draft),symbols,frame,[{layerId,shapeIds:junctionIds}],junctionDx,junctionDy);});
  }

  function transformJunction(operation:'rotate'|'scale'|'skew'){
    if(!junction||!writable||playing||editing||rangeGesture||!junctionIds.length)return;
    try{
      const original=structuredClone($state.snapshot(draft));
      const selection=[{layerId,shapeIds:[...junctionIds]}];
      const candidate=operation==='skew'
        ?skewSymbolRememberedEndpoint(original,symbols,frame,selection,junctionSkewAxis,junctionSkewAngle)
        :operation==='scale'
        ?scaleSymbolRememberedEndpoint(original,symbols,frame,selection,junctionScaleX/100,junctionScaleY/100)
        :rotateSymbolRememberedEndpoint(original,symbols,frame,selection,junctionAngle);
      mutate(()=>{draft=candidate;},false);
    }catch(cause){error=String(cause);}
  }

  const heldStart = $derived([...keyframes].reverse().find((k) => k.frame <= frame)!.frame);
  let rangeArtwork = $state(false);
  let rangeX = $state(0),
    rangeY = $state(0),
    rangeAngle = $state(0),
    rangeScale = $state(100);
  let rangePivotX = $state(0),
    rangePivotY = $state(0);
  let savedPivotScope = '';
  $effect(() => {
    const scope = JSON.stringify([draft.id, draft.multiFramePivot]);
    if (scope !== savedPivotScope) {
      savedPivotScope = scope;
      rangePivotX = draft.multiFramePivot?.x ?? 0;
      rangePivotY = draft.multiFramePivot?.y ?? 0;
    }
  });
  function rememberRangePivot(clear = false) {
    if (!clear && (!Number.isFinite(rangePivotX) || !Number.isFinite(rangePivotY))) return;
    mutate(() => {
      if (clear) delete draft.multiFramePivot;
      else draft.multiFramePivot = { x: rangePivotX, y: rangePivotY };
    });
  }
  let rangeOffset = $state({ x: 0, y: 0 });
  let rangePick = $state<'move' | 'point' | 'box' | 'lasso'>('move');
  let rangeSelection = $state<string[] | null>(null);
  let rangeRing = $state<Point[]>([]);
  let rangeHandlesEnabled = $state(false);
  let rangeOperation = $state<Matrix | null>(null);
  function rangeBounds(): Bounds | null {
    try {
      const boxes = multiFrameMembers(
        artworkProject(),
        artworkTracks,
        rangeStart - 1,
        rangeEnd - 1,
        rangeSelection,
      ).map(objectBounds);
      return boxes.length
        ? {
            left: Math.min(...boxes.map((b) => b.left)),
            right: Math.max(...boxes.map((b) => b.right)),
            top: Math.min(...boxes.map((b) => b.top)),
            bottom: Math.max(...boxes.map((b) => b.bottom)),
          }
        : null;
    } catch {
      return null;
    }
  }
  function rangeHandles(b: Bounds) {
    const scale = Math.min(500 / Math.max(1, draft.width), 290 / Math.max(1, draft.height));
    return [
      { name: 'pivot', x: rangePivotX, y: rangePivotY },
      { name: 'nw', x: b.left, y: b.top },
      { name: 'ne', x: b.right, y: b.top },
      { name: 'se', x: b.right, y: b.bottom },
      { name: 'sw', x: b.left, y: b.bottom },
      { name: 'rotate', x: (b.left + b.right) / 2, y: b.top - 24 / scale },
      { name: 'skew-n', x: (b.left + b.right) / 2, y: b.top },
      { name: 'skew-e', x: b.right, y: (b.top + b.bottom) / 2 },
      { name: 'skew-s', x: (b.left + b.right) / 2, y: b.bottom },
      { name: 'skew-w', x: b.left, y: (b.top + b.bottom) / 2 },
    ];
  }
  function centerRangePivot() {
    cancelRangeGesture();
    const b = rangeBounds();
    if (b) {
      rangePivotX = (b.left + b.right) / 2;
      rangePivotY = (b.top + b.bottom) / 2;
    }
  }
  let rangeMode: SelectionMode = 'replace';
  let selectionScope = '';
  let sampledSelectionScope=$state('');
  let sampledSelectionTrajectories=$state<{units:number;tracks:number;members:number}|null>(null);
  let sampledSelectionSkew=$state<{axis:'x'|'y';degrees:number;pivot:{x:number;y:number}}|null>(null);
  let sampledSelectionScale=$state<{x:number;y:number;pivot:{x:number;y:number}}|null>(null);
  let sampledSelectionRotation=$state<{degrees:number;pivot:{x:number;y:number}}|null>(null);
  $effect(() => {
    const scope = JSON.stringify([draft, artworkTracks, rangeStart, rangeEnd]);
    if (scope !== selectionScope) {
      selectionScope = scope;
      rangeSelection = rangePick === 'move' ? null : [];
      cancelRangeGesture();
    }
  });
  let rangeGesture: {
    pointer: number;
    start: Point;
    context: string;
    transform?: { handle: string; box: Bounds; pivot: Point };
  } | null = null;
  const artworkTracks = $derived(selectedTracks.length ? selectedTracks : [layerId]);
  function artworkContext() {
    return JSON.stringify([
      draft,
      artworkTracks,
      rangeStart,
      rangeEnd,
      rangeSelection,
      rangePick,
      rangeHandlesEnabled,
      rangePivotX,
      rangePivotY,
    ]);
  }
  function artworkProject() {
    return symbolMultiFrameProject(draft, symbols, assets);
  }
  function editRangeArtwork(
    action: 'move' | 'transform' | 'delete',
    dx = rangeX,
    dy = rangeY,
    operation: Matrix | null = null,
  ) {
    if (rangeGesture || playing) return;
    mutate(() => {
      const project = artworkProject(),
        start = rangeStart - 1,
        end = rangeEnd - 1;
      const radians = (rangeAngle * Math.PI) / 180,
        scale = rangeScale / 100;
      const next =
        action === 'move'
          ? translateMultiFrames(project, artworkTracks, start, end, dx, dy, rangeSelection)
          : action === 'delete'
            ? deleteMultiFrames(project, artworkTracks, start, end, rangeSelection)
            : transformMultiFrames(
                project,
                artworkTracks,
                start,
                end,
                operation ??
                  around(
                    { x: rangePivotX, y: rangePivotY },
                    Math.cos(radians) * scale,
                    Math.sin(radians) * scale,
                    -Math.sin(radians) * scale,
                    Math.cos(radians) * scale,
                  ),
                rangeSelection,
              );
      draft = symbolFromMultiFrameProject(draft, next);
    });
  }
  function rangePoint(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(500 / Math.max(1, draft.width), 290 / Math.max(1, draft.height));
    return {
      x: (((e.clientX - rect.left) * 540) / rect.width - 20) / scale,
      y: (((e.clientY - rect.top) * 330) / rect.height - 20) / scale,
    };
  }
  function cancelRangeGesture() {
    if (rangeGesture?.transform?.handle === 'pivot') {
      rangePivotX = rangeGesture.transform.pivot.x;
      rangePivotY = rangeGesture.transform.pivot.y;
    }
    rangeGesture = null;
    rangeOperation = null;
    rangeRing = [];
    rangeOffset = { x: 0, y: 0 };
  }
  function rangeDown(e: PointerEvent) {
    if (!rangeArtwork || playing || e.button !== 0 || e.pointerType === 'touch') return;
    try {
      const tracks = multiFrameKeys(artworkProject(), artworkTracks, rangeStart - 1, rangeEnd - 1);
      const p = rangePoint(e);
      const box = rangeHandlesEnabled ? rangeBounds() : null;
      const scale = Math.min(500 / Math.max(1, draft.width), 290 / Math.max(1, draft.height));
      const handle =
        box && rangeHandles(box).find((h) => Math.hypot(h.x - p.x, h.y - p.y) < 8 / scale);
      if (handle && box) {
        e.preventDefault();
        canvas.focus();
        canvas.setPointerCapture(e.pointerId);
        rangeGesture = {
          pointer: e.pointerId,
          start: p,
          context: artworkContext(),
          transform: { handle: handle.name, box, pivot: { x: rangePivotX, y: rangePivotY } },
        };
        rangeOperation = null;
        return;
      }
      if (rangePick === 'point') {
        const picked = pickMultiFrameGroup(
          tracks,
          (shape) => hit(shape, p, 2),
          rangeSelection,
          e.altKey,
        );
        if (e.altKey) {
          rangeSelection = picked;
          e.preventDefault();
          canvas.focus();
          return;
        }
        const current =
          rangeSelection ??
          tracks.flatMap((t) =>
            t.keys.flatMap((k) => k.shapes.map((s) => multiFrameId(t.layer.id, k.frame, s.id))),
          );
        if (e.shiftKey)
          rangeSelection = picked.every((id) => current.includes(id))
            ? current.filter((id) => !picked.includes(id))
            : [...new Set([...current, ...picked])];
        else if (!picked.length || !picked.every((id) => current.includes(id)))
          rangeSelection = picked;
      }
      rangeMode =
        e.shiftKey && e.altKey
          ? 'intersect'
          : e.altKey
            ? 'subtract'
            : e.shiftKey
              ? 'add'
              : 'replace';
      rangeRing = rangePick === 'box' || rangePick === 'lasso' ? [p] : [];
      e.preventDefault();
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      rangeGesture = { pointer: e.pointerId, start: rangePoint(e), context: artworkContext() };
      rangeOffset = { x: 0, y: 0 };
    } catch (e) {
      error = String(e);
    }
  }
  function rangeMove(e: PointerEvent) {
    if (!rangeGesture || rangeGesture.pointer !== e.pointerId) return;
    if (rangeGesture.context !== artworkContext() || playing || !rangeArtwork) {
      cancelRangeGesture();
      return;
    }
    const p = rangePoint(e);
    if (rangeGesture.transform) {
      const t = rangeGesture.transform;
      try {
        if (t.handle === 'pivot') {
          const next = rangePivotDrag(t.pivot, rangeGesture.start, p, e.shiftKey);
          rangePivotX = next.x;
          rangePivotY = next.y;
          rangeGesture.context = artworkContext();
          return;
        }
        rangeOperation = rangeHandleTransform(
          t.handle,
          t.box,
          t.pivot,
          rangeGesture.start,
          p,
          e.shiftKey,
          e.altKey,
        );
      } catch (e) {
        error = String(e);
        cancelRangeGesture();
      }
      return;
    }
    if (rangePick === 'box') {
      const a = rangeGesture.start;
      rangeRing = [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }];
      return;
    }
    if (rangePick === 'lasso') {
      if (rangeRing.length < 1024) rangeRing = [...rangeRing, p];
      return;
    }
    rangeOffset = { x: p.x - rangeGesture.start.x, y: p.y - rangeGesture.start.y };
    if (e.shiftKey) {
      if (Math.abs(rangeOffset.x) >= Math.abs(rangeOffset.y)) rangeOffset.y = 0;
      else rangeOffset.x = 0;
    }
  }
  function rangeUp(e: PointerEvent) {
    rangeMove(e);
    if (!rangeGesture || rangeGesture.pointer !== e.pointerId) return;
    if (rangeGesture.transform) {
      if (rangeGesture.transform.handle === 'pivot') {
        rangeGesture = null;
        cancelRangeGesture();
        return;
      }
      const operation = rangeOperation;
      cancelRangeGesture();
      if (operation) editRangeArtwork('transform', 0, 0, operation);
      return;
    }
    if (rangePick === 'box' || rangePick === 'lasso') {
      try {
        rangeSelection = selectMultiFrames(
          artworkProject(),
          artworkTracks,
          rangeStart - 1,
          rangeEnd - 1,
          rangeRing,
          rangeSelection,
          rangeMode,
        );
        error = '';
      } catch (e) {
        error = String(e);
      }
      cancelRangeGesture();
      return;
    }
    const offset = { ...rangeOffset };
    cancelRangeGesture();
    if (offset.x || offset.y) editRangeArtwork('move', offset.x, offset.y);
  }
  function snapshot(): Snapshot {
    return {
      definition: clone(draft),
      frame,
      layerId,
      rangeStart,
      rangeEnd,
      selectedTracks: [...selectedTracks],
      spanDestinations: { ...spanDestinations },
      ...(sampledSelectionScope===JSON.stringify([draft,artworkTracks,rangeStart,rangeEnd])&&rangeSelection?{sampledSelection:[...rangeSelection],...(sampledSelectionTrajectories?{sampledTrajectories:clone(sampledSelectionTrajectories)}:{}),...(sampledSelectionRotation?{sampledRotation:clone(sampledSelectionRotation)}:{}),...(sampledSelectionScale?{sampledScale:clone(sampledSelectionScale)}:{}),...(sampledSelectionSkew?{sampledSkew:clone(sampledSelectionSkew)}:{})}:{}),
    };
  }
  let motionEase = $state<MotionEase>('linear');
  let motionAffine = $state(false);
  let motionPaint = $state(false);
  let motionGradientPremultiplied = $state(false);
  let motionNodes = $state(false);
  let motionMatchStraightNodes = $state(false);
  let motionMatchCurvedNodes = $state(false);
  let motionCurveDistance = $state(false);
  let motionNodeHints = $state('');
  let motionRotation = $state<MotionRotation>({ direction: 'shortest', turns: 0 });
  let motionStrokeWidth = $state(false);
  let motionPrimitives = $state(false);
  let motionGradientGeometry = $state(false);
  let motionGradientBasis = $state(false);
  let motionGradientStops = $state(false);
  let motionGradientStopOrder = $state(false);
  let motionGradientPairs = $state('');
  let motionContourAreas = $state(false);
  let motionCurveTangents = $state(false);
  let motionCurveSelfContacts = $state(false);
  let motionContourContacts = $state(false);
  let motionContourEdges = $state(false);
  let motionContourStart = $state(0);
  let motionContourOffsets = $state('');
  let motionContourOrder = $state('');
  let motionContourReverse = $state(false);
  let motionContourDirections = $state('');
  let motionPath = $state<MotionPath | undefined>();
  let editMotionOnStage = $state(false);
  let editNodeHintsOnStage = $state(false);
  let motionStageWidth = $state(540);
  const motionStageScale = $derived(Math.min(500 / Math.max(1, draft.width), 290 / Math.max(1, draft.height)));
  let rememberedEase = $state<MotionEase>('linear');
  let rememberedOpacityEnabled=$state(false),rememberedOpacityEase=$state<MotionEase>('linear');
  let rememberedPaintEnabled=$state(false),rememberedPaintEase=$state<MotionEase>('linear'),rememberingPaint=false;
  let existingOpacityEase=$state<MotionEase>('linear');let existingOpacityRevision=0,opacityAlive=true;
  onDestroy(()=>{opacityAlive=false;});
  function editRememberedOpacity(remove=false){
    if(playing||editing||buttonPreview||rangeGesture||sampledStage||preparingRemembered)return;
    try{
      const original=draft,originalSymbols=symbols,originalAssets=assets,originalPast=past,originalFuture=future,originalValidate=validate,originalHierarchy=hierarchyOwner,originalContext=context,originalDefinition=definition;
      const at=frame,track=layerId,start=rangeStart,end=rangeEnd,batch=rememberedBatch,input=existingOpacityRevision,ids=[...(batch?selectedTracks:[track])],signature=selectionTrajectoryStamp([original,originalSymbols,originalAssets]);
      const active=()=>{if(!opacityAlive||draft!==original||symbols!==originalSymbols||assets!==originalAssets||past!==originalPast||future!==originalFuture||validate!==originalValidate||definition!==originalDefinition||context!==originalContext||hierarchyOwner!==originalHierarchy||frame!==at||layerId!==track||rangeStart!==start||rangeEnd!==end||rememberedBatch!==batch||existingOpacityRevision!==input||JSON.stringify(batch?selectedTracks:[layerId])!==JSON.stringify(ids)||playing||editing||buttonPreview||rangeGesture||sampledStage||preparingRemembered||selectionTrajectoryStamp([original,originalSymbols,originalAssets])!==signature)throw Error('Symbol opacity source or inputs changed. Try the edit again.');};
      const target=remove?undefined:captureOpacityEase(existingOpacityEase)!;active();
      const source=clone(original);active();const library=clone(originalSymbols);active();
      const candidate=editSymbolBasicMotionSpan(source,ids,start-1,end-1,remove?'clearOpacity':'opacity','linear',library,undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,false,target);active();
      const output=selectionTrajectoryStamp(candidate);originalValidate(candidate);JSON.stringify(candidate);active();
      const before=snapshot(),nextPast=appendHistory(past, new HistoryEntry<Snapshot>(before));active();
      originalValidate(candidate);active();
      if(selectionTrajectoryStamp(candidate)!==output)throw Error('Prepared symbol opacity artwork changed.');
      active();draft=candidate;past=nextPast;future=[];error='';moviePose=null;
    }catch(cause){error=String(cause);}
  }

  let existingPaintEase=$state<MotionEase>('linear');let existingPaintRevision=0,editingSavedPaint=false;
  let keyProperty=$state<Exclude<SymbolPropertyKey['property'],number>|'gradient'>('xKeys');
  let keyFrame=$state(2),keyNumber=$state(0),keyColor=$state('#000000'),keyStop=$state(1);
  const colorProperty=$derived(keyProperty==='gradient'||keyProperty==='fillColorKeys'||keyProperty==='strokeColorKeys');
  const keyRecipe=$derived(layers.find(l=>l.id===layerId)?.motionSpans?.find(s=>s.start===rangeStart-1 && s.end===rangeEnd-1));
  const savedPropertyKeys=$derived(keyProperty==='gradient'?keyRecipe?.gradientColorTracks?.find(r=>r.stop===keyStop-1)?.keys:keyRecipe?.[keyProperty]);
  function symbolKeyRequest(remove:boolean):SymbolPropertyKey {
    const frame=keyFrame-1;
    if(keyProperty==='gradient'||keyProperty==='fillColorKeys'||keyProperty==='strokeColorKeys')
      return {property:keyProperty==='gradient'?keyStop-1:keyProperty,frame,value:remove?null:keyColor};
    return {property:keyProperty,frame,value:remove?null:keyProperty==='opacityKeys'?keyNumber/100:keyNumber};
  }
  function editRememberedPaint(remove=false,propertyEdit=false,interval?:SymbolPositionInterval){
    if(editingSavedPaint||rememberingPaint||playing||editing||buttonPreview||rangeGesture||sampledStage||preparingRemembered)return;
    editingSavedPaint=true;const inputs=watchRememberedCreationInputs(document);
    try{
      const original=draft,originalSymbols=symbols,originalAssets=assets,originalPast=past,originalFuture=future,originalValidate=validate,originalHierarchy=hierarchyOwner,originalContext=context,originalDefinition=definition;
      const at=frame,track=layerId,start=rangeStart,end=rangeEnd,batch=rememberedBatch,input=existingPaintRevision,ids=[...(batch?selectedTracks:[track])],signature=selectionTrajectoryStamp([original,originalSymbols,originalAssets]);
      const active=()=>{inputs.validate();if(!opacityAlive||draft!==original||symbols!==originalSymbols||assets!==originalAssets||past!==originalPast||future!==originalFuture||validate!==originalValidate||definition!==originalDefinition||context!==originalContext||hierarchyOwner!==originalHierarchy||frame!==at||layerId!==track||rangeStart!==start||rangeEnd!==end||rememberedBatch!==batch||existingPaintRevision!==input||JSON.stringify(batch?selectedTracks:[layerId])!==JSON.stringify(ids)||playing||editing||buttonPreview||rangeGesture||sampledStage||preparingRemembered||selectionTrajectoryStamp([original,originalSymbols,originalAssets])!==signature)throw Error('Symbol paint source or inputs changed. Try the edit again.');};
      const target=remove||propertyEdit?undefined:capturePaintEase(existingPaintEase,true)!;
      const action=interval ?? (propertyEdit?symbolKeyRequest(remove):remove?'clearPaint':'paint');active();
      const source=clone(original);active();const library=clone(originalSymbols);active();
      const candidate=editSymbolBasicMotionSpan(source,ids,start-1,end-1,action,'linear',library,undefined,false,undefined,undefined,undefined,false,undefined,undefined,undefined,undefined,undefined,false,undefined,target);active();
      const output=selectionTrajectoryStamp(candidate);originalValidate(candidate);JSON.stringify(candidate);active();
      const before=snapshot(),nextPast=appendHistory(past, new HistoryEntry<Snapshot>(before));active();
      originalValidate(candidate);active();
      if(selectionTrajectoryStamp(candidate)!==output)throw Error('Prepared symbol paint artwork changed.');
      active();draft=candidate;past=nextPast;future=[];error='';moviePose=null;
    }catch(cause){error=String(cause);}finally{inputs.dispose();editingSavedPaint=false;}
  }

  let rememberedOptions = $state({ affine: false, paint: false, nodes: false, primitives: false, strokeWidth: false, gradientGeometry: false, gradientBasis: false, contourAreas: false, contourEdges: false, contourContacts: false, curveTangents: false, curveSelfContacts: false, gradientStops: false, gradientPremultiplied: false, pivots:false, defaultPivots:false, strokeColor:false });
  let rememberedLive = $state(false);
  let rememberedGradientOrder = $state(false);
  let rememberedGradientPairs = $state('');
  let rememberedCorrespondence = $state(false);
  let rememberedRotation = $state(false);
  let rememberedPath = $state(false);
  let rememberedBatch = $state(false);
  const savedOpacitySummary=$derived(rememberedOpacitySummary(layers,rememberedBatch?selectedTracks:[layerId],rangeStart-1,rangeEnd-1));
  const savedPaintSummary=$derived(rememberedPaintSummary(layers,rememberedBatch?selectedTracks:[layerId],rangeStart-1,rangeEnd-1));
  let rememberedLength = $state(5);
  let rememberedSpanLengths = $state('');
  let rememberedSplit = $state(3);
  let rememberedCuts = $state('');
  let preserveRememberedSplit = $state(false);
  let rememberedDestination = $state(1);
  let rememberedDestinationLayer = $state('');
  let rememberedRipple = $state(false);
  const activeSavedPath = $derived(layer.motionSpans?.find(span => span.start === rangeStart - 1 && span.end === rangeEnd - 1)?.path);

  function rememberedPaintInputs(){return selectionTrajectoryStamp([rememberedPaintEnabled,rememberedPaintEase,rememberedOpacityEnabled,rememberedOpacityEnabled?rememberedOpacityEase:undefined,rememberedEase,rememberedOptions,rememberedBatch,rememberedGradientPairs,rememberedGradientOrder,rememberedCorrespondence,rememberedCorrespondence?[motionContourOffsets,motionContourStart,motionContourDirections,motionContourReverse,motionContourOrder,motionNodeHints,motionMatchStraightNodes,motionMatchCurvedNodes,motionCurveDistance]:undefined,rememberedPath,rememberedPath?motionPath:undefined,rememberedRotation,rememberedRotation?motionRotation:undefined]);}
  function rememberedPaintRecipe(ids:string[],start:number,end:number):RememberedCreationRecipe{
    const paintEase=capturePaintEase(rememberedPaintEase,rememberedOptions.paint),opacityEase=captureOpacityEase(rememberedOpacityEnabled?rememberedOpacityEase:undefined),ease=captureOpacityEase(rememberedEase)!;
    const {pivots,defaultPivots,strokeColor,...legacyOptions}=$state.snapshot(rememberedOptions);
    const options={...legacyOptions,...(strokeColor?{strokeColor:true}:{}),...(pivots?{pivots:true}:{}),...(defaultPivots?{defaultPivots:true}:{}),gradientStops:parseMotionGradientPairs(rememberedGradientPairs,rememberedOptions.gradientStops,rememberedGradientOrder)};
    if(rememberedPath&&!motionPath)throw Error('Enable a motion path before remembering it.');
    const correspondence=rememberedCorrespondence?{start:parseMotionContourStarts(motionContourOffsets,motionContourStart),reverse:parseMotionContourDirections(motionContourDirections,motionContourReverse),order:parseMotionContourOrder(motionContourOrder),nodes:parseMotionNodeHints(motionNodeHints,motionMatchStraightNodes,motionMatchCurvedNodes,motionCurveDistance)}:undefined;
    return {ids,start,end,ease,options:clone(options),path:rememberedPath?clone(motionPath):undefined,rotation:rememberedRotation?clone(motionRotation):undefined,correspondence:correspondence?clone(correspondence):undefined,opacityEase,paintEase};
  }

  function createRememberedPaint(){
    if(rememberingPaint||playing||editing||buttonPreview||rangeGesture||sampledStage||preparingRemembered)return;
    releaseRemembered();rememberingPaint=true;const inputs=watchRememberedCreationInputs(document);
    try{
      const original=draft,originalSymbols=symbols,originalAssets=assets,originalPast=past,originalFuture=future,originalValidate=validate,originalDefinition=definition,originalContext=context,originalHierarchy=hierarchyOwner;
      const at=frame,track=layerId,start=rangeStart,end=rangeEnd,batch=rememberedBatch,ids=[...(batch?selectedTracks:[track])],signature=selectionTrajectoryStamp([original,originalSymbols,originalAssets]),input=rememberedPaintInputs();
      const active=()=>{inputs.validate();if(!opacityAlive||draft!==original||symbols!==originalSymbols||assets!==originalAssets||past!==originalPast||future!==originalFuture||validate!==originalValidate||definition!==originalDefinition||context!==originalContext||hierarchyOwner!==originalHierarchy||frame!==at||layerId!==track||rangeStart!==start||rangeEnd!==end||rememberedBatch!==batch||JSON.stringify(batch?selectedTracks:[layerId])!==JSON.stringify(ids)||!rememberedPaintEnabled||playing||editing||buttonPreview||rangeGesture||sampledStage||preparingRemembered||selectionTrajectoryStamp([original,originalSymbols,originalAssets])!==signature||rememberedPaintInputs()!==input)throw Error('Symbol paint creation source or inputs changed. Try again.');};
      active();const recipe=rememberedPaintRecipe(ids,start-1,end-1);active();const source=clone(original);active();const library=clone(originalSymbols);active();
      const candidate=editSymbolBasicMotionSpan(source,ids,recipe.start,recipe.end,'create',recipe.ease,library,undefined,false,recipe.options,recipe.path,recipe.rotation,false,recipe.correspondence,undefined,undefined,undefined,undefined,false,recipe.opacityEase,recipe.paintEase);active();
      assertRememberedCreation({layers:symbolLayers(source),duration:source.timeline!.duration,symbols:library},{layers:symbolLayers(candidate),duration:candidate.timeline!.duration,symbols:library},recipe);
      const expected={...source,shapes:candidate.shapes,timeline:{...source.timeline!,keys:candidate.timeline!.keys,layers:candidate.timeline!.layers,motionSpans:candidate.timeline!.motionSpans}};
      if(JSON.stringify(candidate)!==JSON.stringify(expected))throw Error('Symbol paint creation changed settings.');
      const output=JSON.stringify(candidate);originalValidate(candidate);active();const before=snapshot(),nextPast=appendHistory(past, new HistoryEntry<Snapshot>(before));active();originalValidate(candidate);active();
      if(JSON.stringify(candidate)!==output)throw Error('Prepared symbol paint creation changed.');
      active();draft=candidate;past=nextPast;future=[];error='';moviePose=null;
    }catch(cause){error=String(cause);}finally{inputs.dispose();rememberingPaint=false;}
  }
  function rememberedMotion(action: 'create' | 'promote' | 'spin' | 'path' | 'clearPath' | 'ease' | 'refresh' | 'detach' | 'retime' | 'live' | 'move' | 'exchange' | 'split' | 'reverse' | 'subdivide') {
    if(rememberingPaint)return;
    if(action==='create'&&rememberedPaintEnabled){createRememberedPaint();return;}
    mutate(() => {
      const spanLengths = action === 'retime' ? parseMotionSpanLengths(rememberedSpanLengths) : undefined;
      const effectiveLength = motionSpanFrameCount(rememberedLength, spanLengths);
      const correspondence = action === 'create' && rememberedCorrespondence ? { start: parseMotionContourStarts(motionContourOffsets, motionContourStart), reverse: parseMotionContourDirections(motionContourDirections, motionContourReverse), order: parseMotionContourOrder(motionContourOrder), nodes: parseMotionNodeHints(motionNodeHints, motionMatchStraightNodes, motionMatchCurvedNodes, motionCurveDistance) } : undefined;
      const {pivots,defaultPivots,strokeColor,...legacyOptions}=rememberedOptions;
      const explicitOptions={...legacyOptions,...(strokeColor?{strokeColor:true}:{}),...(pivots?{pivots:true}:{}),...(defaultPivots?{defaultPivots:true}:{})};
      const options = action === 'create' ? { ...explicitOptions, gradientStops: parseMotionGradientPairs(rememberedGradientPairs, rememberedOptions.gradientStops, rememberedGradientOrder) } : explicitOptions;
      if (action === 'create' && rememberedPath && !motionPath) throw new Error('Enable a motion path before remembering it.');
      if (action === 'subdivide') {
        const entries = rememberedCuts.split(',').map(value => value.trim());
        if (entries.some(value => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1))
          throw new Error('Enter increasing whole frame numbers separated by commas.');
        draft = subdividePreservedSymbolMotionSpan($state.snapshot(draft), rememberedBatch ? selectedTracks : [layerId], rangeStart - 1, rangeEnd - 1, entries.map(value => Number(value) - 1), symbols);
      } else draft = editSymbolBasicMotionSpan(draft, rememberedBatch ? selectedTracks : [layerId], rangeStart - 1, rangeEnd - 1, action, rememberedEase, symbols, effectiveLength, rememberedRipple, options, (action === 'path' || rememberedPath) ? motionPath : undefined, (action === 'spin' || rememberedRotation) ? motionRotation : undefined, rememberedLive, correspondence, rememberedDestination - 1, rememberedDestinationLayer || undefined, spanLengths, rememberedSplit - 1, preserveRememberedSplit,action==='create'&&rememberedOpacityEnabled?rememberedOpacityEase:undefined);
      if (action === 'move' || action === 'exchange') { if (rememberedDestinationLayer) layerId = rememberedDestinationLayer; const count = rangeEnd - rangeStart; rangeStart = rememberedDestination; rangeEnd = rangeStart + count; }
      if (action === 'retime') rangeEnd = rangeStart + effectiveLength - 1;
    });
  }
  function generateMotion(batch = false) {
    mutate(() => {
      draft = generateSymbolMotionFrames(draft, batch ? selectedTracks : [layerId], rangeStart - 1, rangeEnd - 1, motionEase, motionAffine, motionPaint, motionNodes, motionPath, motionPrimitives, motionGradientGeometry, symbols, motionRotation, motionStrokeWidth, motionGradientBasis, parseMotionGradientPairs(motionGradientPairs, motionGradientStops, motionGradientStopOrder), motionContourContacts ? 'contacts' : motionContourEdges ? 'edges' : motionContourAreas, parseMotionContourStarts(motionContourOffsets, motionContourStart), parseMotionContourDirections(motionContourDirections, motionContourReverse), parseMotionContourOrder(motionContourOrder), motionGradientPremultiplied, parseMotionNodeHints(motionNodeHints, motionMatchStraightNodes, motionMatchCurvedNodes, motionCurveDistance), motionCurveTangents, motionCurveSelfContacts);
    });
  }
  let retimeLength = $state(12);
  function retimeRange(batch = false) {
    mutate(() => {
      draft = retimeSymbolTracks(
        draft,
        batch ? selectedTracks : [layerId],
        rangeStart - 1,
        rangeEnd - 1,
        retimeLength,
        symbols,
        assets,
      );
      rangeEnd = rangeStart + retimeLength - 1;
      frame = rangeEnd - 1;
    }, false);
  }
  let autoRefreshRemembered = $state(false);
  function mutate(fn: () => void, refreshEndpoints = true) {
    cancelRangeGesture();releaseRemembered();
    playing = false;
    moviePose = null;
    const before = snapshot();
    try {
      fn();
      let refreshWarning = '';
      if (refreshEndpoints) {
        try { draft = refreshChangedSymbolMotionSpans(before.definition, draft, symbols, !autoRefreshRemembered); }
        catch (e) { refreshWarning = `Endpoint edit kept; automatic motion refresh failed: ${String(e)}`; }
      }
      validate(draft);
      frame = Math.min(frame, (draft.timeline?.duration ?? 1) - 1);
      rangeStart = Math.max(1, Math.min(rangeStart, draft.timeline?.duration ?? 1));
      rangeEnd = Math.max(rangeStart, Math.min(rangeEnd, draft.timeline?.duration ?? 1));
      error = refreshWarning;
      if (JSON.stringify(before.definition) !== JSON.stringify(draft)) {
        past = appendHistory(past, new HistoryEntry<Snapshot>(before));
        future = [];
      }
      return true;
    } catch (e) {
      draft = before.definition;
      frame = before.frame;
      layerId = before.layerId;
      rangeStart = before.rangeStart;
      rangeEnd = before.rangeEnd;
      selectedTracks = [...before.selectedTracks];
      spanDestinations = { ...before.spanDestinations };
      error = String(e);
      return false;
    }
  }
  function undo(redo = false) {
    cancelRangeGesture();releaseRemembered();
    playing = false;
    const source = redo ? future : past;
    if (!source.length) return;
    const next = source.at(-1)!.read(), destination = redo ? past : future;
    const moved = moveHistory(source, destination, new HistoryEntry(snapshot()));
    if (source !== (redo ? future : past) || destination !== (redo ? past : future)) return;
    past = redo ? moved.destination : moved.source;
    future = redo ? moved.source : moved.destination;
    draft = next.definition;
    frame = next.frame;
    layerId = next.layerId;
    rangeStart = next.rangeStart;
    rangeEnd = next.rangeEnd;
    selectedTracks = [...next.selectedTracks];
    spanDestinations = { ...next.spanDestinations };
    sampledSelectionScope='';
    sampledSelectionTrajectories=next.sampledTrajectories?clone(next.sampledTrajectories):null;
    sampledSelectionRotation=next.sampledRotation?clone(next.sampledRotation):null;
    sampledSelectionScale=next.sampledScale?clone(next.sampledScale):null;
    sampledSelectionSkew=next.sampledSkew?clone(next.sampledSkew):null;
    if(next.sampledSelection){rangeArtwork=true;rangePick='move';rangeSelection=[...next.sampledSelection];rangeOffset={x:0,y:0};rangeOperation=null;selectionScope=JSON.stringify([draft,artworkTracks,rangeStart,rangeEnd]);sampledSelectionScope=selectionScope;}
    error = '';
  }
  function transfer(move: boolean) {
    mutate(() => {
      draft = transferSymbolKey(
        draft,
        frame,
        destination - 1,
        move,
        layerId,
        destinationLayerId || layerId,
      );
      frame = destination - 1;
      layerId = destinationLayerId || layerId;
    });
  }
  function transferRange(move: boolean) {
    const count = rangeEnd - rangeStart + 1,
      target = rangeTrack || layerId;
    mutate(() => {
      draft = transferSymbolFrames(
        draft,
        layerId,
        rangeStart - 1,
        rangeEnd - 1,
        target,
        rangeDestination - 1,
        move,
        symbols,
        assets,
      );
      layerId = target;
      frame = rangeDestination - 1;
      rangeStart = rangeDestination;
      rangeEnd = rangeDestination + count - 1;
    }, false);
  }
  function captureFrameClipboard(ids: string[], cut: boolean) {
    const start = rangeStart - 1, end = rangeEnd - 1;
    if (!cut) return copySymbolTracks(draft, ids, start, end, symbols, assets);
    const result = cutSymbolTracks(draft, ids, start, end, symbols, assets);
    if (mutate(() => { draft = result.definition; }, false)) return result.clipboard;
  }
  function copyRange(cut = false) {
    try {
      const clip = captureFrameClipboard([layerId], cut);
      if (!clip) return;
      clipboard = clip.tracks[0].clip;
      clipboardKind = 'single';
      error = '';
    } catch (e) {
      error = String(e);
    }
  }
  function selectFrame(track: string, target: number, extend: boolean) {
    playing = false;
    const anchor =
      extend && track === layerId ? (frame + 1 === rangeStart ? rangeEnd : rangeStart) - 1 : target;
    layerId = track;
    frame = target;
    rangeStart = Math.min(anchor, target) + 1;
    rangeEnd = Math.max(anchor, target) + 1;
  }
  function selectExposure(track: string, at: number) {
    const keys = layers.find((l) => l.id === track)!.keys;
    const held = [...keys].reverse().find((k) => k.frame <= at)!;
    layerId = track;
    frame = at;
    playing = false;
    rangeStart = held.frame + 1;
    rangeEnd = keys.find((k) => k.frame > at)?.frame ?? duration;
  }
  function editRange(duplicate: boolean) {
    const start = rangeStart - 1,
      end = rangeEnd - 1;
    if (
      mutate(() => {
        draft = duplicate
          ? duplicateSymbolFrames(draft, layerId, start, end, symbols, assets)
          : removeSymbolFrames(draft, layerId, start, end, symbols, assets);
        frame = duplicate ? end + 1 : start;
      }, false)
    ) {
      rangeStart = frame + 1;
      rangeEnd = duplicate ? frame + end - start + 1 : frame + 1;
    }
  }
  function copyTracks(cut = false) {
    try {
      const clip = captureFrameClipboard(selectedTracks, cut);
      if (!clip) return;
      trackClipboard = clip;
      clipboardKind = 'tracks';
      trackDestinations = clip.tracks.map((t) => t.layerId);
      error = '';
    } catch (e) {
      error = String(e);
    }
  }
  function pasteTracks(at = insertAt - 1) {
    if (!trackClipboard) return;
    mutate(() => {
      draft = insertSymbolTracks(draft, at, trackClipboard!, trackDestinations, symbols, assets);
      frame = at;
      rangeStart = at + 1;
      rangeEnd = at + trackClipboard!.tracks[0].clip.duration;
    }, false);
  }
  function transferTracks(move: boolean) {
    const destinations = selectedTracks.map(id => spanDestinations[id] ?? id);
    mutate(() => {
      const count = rangeEnd - rangeStart + 1;
      draft = transferSymbolTracks(
        draft,
        selectedTracks,
        rangeStart - 1,
        rangeEnd - 1,
        rangeDestination - 1,
        move,
        destinations,
        symbols,
        assets,
      );
      frame = rangeDestination - 1;
      rangeStart = rangeDestination;
      rangeEnd = rangeDestination + count - 1;
    }, false);
  }
  function bulkRange(action: 'clear' | 'duplicate' | 'remove' | 'reverse' | 'keys') {
    mutate(() => {
      const start = rangeStart - 1,
        end = rangeEnd - 1;
      draft = editSymbolTracks(draft, selectedTracks, start, end, action, symbols, assets);
      if (action === 'duplicate') {
        frame = end + 1;
        rangeStart = frame + 1;
        rangeEnd = frame + end - start + 1;
      } else frame = start;
    }, action === 'keys');
  }
  function clearRange() {
    mutate(() => {
      draft = clearSymbolFrames(draft, layerId, rangeStart - 1, rangeEnd - 1, symbols, assets);
    }, false);
  }
  function rangeShortcut(
    action: 'copy' | 'cut' | 'paste' | 'duplicate' | 'clear' | 'remove' | 'undo' | 'redo',
  ) {
    if (playing) return;
    if (action === 'undo' || action === 'redo') {
      undo(action === 'redo');
      return;
    }
    if (action === 'paste' && clipboardKind === 'tracks') {
      pasteTracks(frame);
      return;
    }
    if (selectedTracks.length > 1 && selectedTracks.includes(layerId) && action !== 'paste') {
      if (action === 'copy' || action === 'cut') copyTracks(action === 'cut');
      else bulkRange(action);
      return;
    }
    if (!writable) return;
    if (action === 'copy' || action === 'cut') copyRange(action === 'cut');
    else if (action === 'duplicate' || action === 'remove') editRange(action === 'duplicate');
    else if (action === 'clear') clearRange();
    else if (clipboard)
      mutate(() => {
        draft = insertSymbolFrames(draft, layerId, frame, clipboard!, symbols, assets);
        rangeStart = frame + 1;
        rangeEnd = frame + clipboard!.duration;
      }, false);
  }
  async function togglePreview() {
    if(preparingRemembered){releaseRemembered();paint();return;}
    if(playing){playing=false;return;}
    if (
      !playing &&
      previewRange &&
      (!Number.isInteger(rangeStart) ||
        !Number.isInteger(rangeEnd) ||
        rangeStart < 1 ||
        rangeEnd < rangeStart ||
        rangeEnd > duration)
    ) {
      error = 'Choose a valid frame range inside the symbol duration.';
      return;
    }
    error = '';
    if(rememberedPlayback){
      releaseRemembered();sampledStage=false;preparingRemembered=true;
      const job=new AbortController();rememberedJob=job;rememberedOwner=playbackStamp();rememberedDataOwner=playbackDataStamp();
      const initialFrame=frame;
      const source={definition:clone($state.snapshot(draft)),symbols:clone($state.snapshot(symbols)),revision:0,frame:initialFrame};
      const active=()=>{
        job.signal.throwIfAborted();
        if(!previewAlive||rememberedJob!==job||playbackStamp()!==rememberedOwner||hierarchyOwner!==sampledEnclosingOwner||
          (preparingRemembered&&frame!==initialFrame))throw new Error('Symbol playback source changed. Start the preview again.');
      };
      paint();
      try{
        const session=await prepareSymbolRememberedPlayback(()=>source,fps,previewRange?rangeStart-1:0,previewRange?rangeEnd-1:duration-1,{signal:job.signal,validate:active});
        try{active();}catch(cause){session.dispose();throw cause;}
        rememberedSession=session;preparingRemembered=false;playbackEpoch++;playing=true;
      }catch(cause){
        if(rememberedJob===job&&!job.signal.aborted){releaseRemembered();rememberedFailure=true;error=String(cause);paint();}
      }
    }else{releaseRemembered();playbackEpoch++;playing=true;}
  }
  function navigate(next: boolean) {
    releaseRemembered();playing = false;
    const target = next
      ? keyframes.find((k) => k.frame > frame)
      : [...keyframes].reverse().find((k) => k.frame < frame);
    if (target) frame = target.frame;
  }
  function writeArtwork(candidate: SymbolDefinition, shapes: Vector[]) {
    const track = symbolLayers(candidate).find((l) => l.id === layerId);
    if (!track || track.locked || !track.visible)
      throw new Error('Choose a visible unlocked symbol layer.');
    if (layerId === '@base' && frame === 0) candidate.shapes = clone(shapes);
    else {
      candidate.timeline ??= { duration: 1, keys: [] };
      if (layerId === '@base')
        candidate.timeline.keys = [
          ...candidate.timeline.keys.filter((k) => k.frame !== frame),
          { frame, shapes: clone(shapes) },
        ].sort((a, b) => a.frame - b.frame);
      else
        track.keys = [
          ...track.keys.filter((k) => k.frame !== frame),
          { frame, shapes: clone(shapes) },
        ].sort((a, b) => a.frame - b.frame);
    }
  }
  function setArtwork(shapes: Vector[]) {
    mutate(() => writeArtwork(draft, shapes));
  }
  let frameArtworkAlive=true,preparingFrameArtwork=false,frameArtworkPoisoned=false,publishingFrameArtwork=false,framePublicationPoisoned=false;
  let frameArtworkSession=$state.raw<object>({}),frameContextRevision=$state(0);
  onMount(()=>{const changed=()=>frameContextRevision++;for(const name of ['input','change','click'])dialog.addEventListener(name,changed,true);return ()=>{for(const name of ['input','change','click'])dialog.removeEventListener(name,changed,true);};});
  const originalFrameValidate=untrack(()=>validate),originalFrameRead=untrack(()=>readSourceProject),originalStageSimplify=untrack(()=>stageSimplify);
  onDestroy(()=>{frameArtworkAlive=false;});
  function frameSimplifyAvailable(){return frameArtworkAlive&&editing&&(!context||!!stageSimplify)&&!rangeArtwork&&!sampledStage&&!playing&&!buttonPreview&&!rangeGesture&&writable&&key&&!!(draft.timeline||draft.buttonStates)&&symbols.some(s=>s.id===draft.id)&&!layer.motionSpans?.some(span=>span.start<frame&&frame<span.end);}
  function frameContextKey(){return selectionTrajectoryStamp([frameContextRevision,frame,layerId,rangeStart,rangeEnd,rangeArtwork,selectedTracks,spanDestinations,hierarchyOwner,autoRefreshRemembered,context]);}
  function prepareFrameSimplify(artwork:Vector[]){
    if(preparingFrameArtwork){frameArtworkPoisoned=true;throw Error('Frame simplification cannot reenter.');}
    preparingFrameArtwork=true;frameArtworkPoisoned=false;
    try{
      if(context){if(!originalStageSimplify||stageSimplify!==originalStageSimplify)throw Error('Original stage frame capability changed.');originalStageSimplify();}
      validateLiveGraphicData(artwork);const enclosing=originalFrameRead(),source=enclosing.project,revision=enclosing.revision;
      const local=draft,oldPast=past,oldFuture=future,session=frameArtworkSession,originalSymbols=symbols,originalAssets=assets,originalDefinition=definition;
      validateLiveGraphicData(source);validateLiveGraphicData(local);
      const sourceStamp=selectionTrajectoryStamp(source),localStamp=selectionTrajectoryStamp(local),contextKey=frameContextKey();
      const projectCopy=structuredClone($state.snapshot(source)) as Project,definitionCopy=structuredClone($state.snapshot(local));
      frameDetached(source,projectCopy);frameDetached(local,definitionCopy);
      if(selectionTrajectoryStamp(projectCopy)!==sourceStamp||selectionTrajectoryStamp(definitionCopy)!==localStamp)throw Error('Original frame snapshot changed.');
      const history={past:oldPast,future:oldFuture};
      return captureFrameSymbolSimplifyContext(()=>{
        if(context){if(stageSimplify!==originalStageSimplify)throw Error('Original stage frame capability changed.');originalStageSimplify!();}
        const live=originalFrameRead();validateLiveGraphicData(live.project);validateLiveGraphicData(draft);
        return {project:projectCopy,definition:definitionCopy,history,session,revision:live.revision,location:{layerId,frame},context:frameContextKey(),
          eligible:!frameArtworkPoisoned&&frameSimplifyAvailable()&&draft===local&&past===oldPast&&future===oldFuture&&frameArtworkSession===session&&symbols===originalSymbols&&assets===originalAssets&&definition===originalDefinition&&validate===originalFrameValidate&&hierarchyOwner===sampledEnclosingOwner&&live.project===source&&live.revision===revision&&selectionTrajectoryStamp(live.project)===sourceStamp&&selectionTrajectoryStamp(draft)===localStamp&&frameContextKey()===contextKey};
      },artwork);
    }finally{preparingFrameArtwork=false;}
  }
  function validateFrameArtwork(shapes:Vector[]){
    validateLiveGraphicData(shapes);validateLiveGraphicData(draft);
    const candidate=clone(draft);writeArtwork(candidate,shapes);originalFrameValidate(candidate);
  }
  let frameArtworkButton = $state<HTMLButtonElement>();
  async function closeFrameArtwork() {
    editing = false;
    await tick();
    if (!editing && frameArtworkButton?.isConnected && !frameArtworkButton.disabled)
      frameArtworkButton.focus({ preventScroll: true });
  }

  function applyFrameArtwork(shapes:Vector[],admit?:()=>void):string|null{
    if(!admit){setArtwork(shapes);if(!error)void closeFrameArtwork();return error||null;}
    if(publishingFrameArtwork){framePublicationPoisoned=true;return 'Frame publication cannot reenter.';}
    publishingFrameArtwork=true;framePublicationPoisoned=false;
    try{
      validateLiveGraphicData(shapes);const input=selectionTrajectoryStamp(shapes),original=draft,oldPast=past,oldFuture=future,session=frameArtworkSession;
      const key=frameContextKey(),sourceStamp=selectionTrajectoryStamp(draft),ctx=prepareFrameSimplify(shapes);
      const current=()=>{admit();ctx.validate();validateLiveGraphicData(shapes);validateLiveGraphicData(draft);
        if(framePublicationPoisoned||!frameSimplifyAvailable()||draft!==original||past!==oldPast||future!==oldFuture||frameArtworkSession!==session||frameContextKey()!==key||selectionTrajectoryStamp(shapes)!==input||selectionTrajectoryStamp(draft)!==sourceStamp)throw Error('The original frame or child artwork changed before Apply.');};
      current();
      const before={...snapshot(),definition:structuredClone($state.snapshot(original))},prepared=ctx.project.symbols!.find(s=>s.id===draft.id)!;
      let candidate=structuredClone(prepared),warning='';frameDetached(prepared,candidate);frameDetached(original,before.definition);
      current();
      try{candidate=refreshChangedSymbolMotionSpans(before.definition,candidate,symbols,!autoRefreshRemembered);}catch(cause){warning=`Endpoint edit kept; automatic motion refresh failed: ${String(cause)}`;}
      validateLiveGraphicData(candidate);const expected=selectionTrajectoryStamp(candidate);originalFrameValidate(candidate);
      const nextPast=appendHistory(oldPast, new HistoryEntry<Snapshot>(before)),changed=JSON.stringify(before.definition)!==JSON.stringify(candidate);
      current();if(selectionTrajectoryStamp(candidate)!==expected||selectionTrajectoryStamp(before.definition)!==sourceStamp)throw Error('Prepared frame/history changed.');
      if(changed){draft=candidate;past=nextPast;future=[];}error=warning;void closeFrameArtwork();return null;
    }catch(cause){return String(cause);}finally{publishingFrameArtwork=false;}
  }
  let publishingTimelineInput=false,timelineInputPoisoned=false;
  function applyTimelineDraft(){
    if(editing||publishingFrameArtwork){error='Finish frame editing before applying the timeline.';return;}
    if(publishingTimelineInput){timelineInputPoisoned=true;error='Timeline Apply cannot reenter.';return;}
    publishingTimelineInput=true;timelineInputPoisoned=false;
    try{
      playing=false;validateLiveGraphicData(draft);
      const original=draft,input=selectionTrajectoryStamp(draft),oldPast=past,oldFuture=future,key=frameContextKey(),publisher=apply;
      const current=()=>{validateLiveGraphicData(draft);if(timelineInputPoisoned||!frameArtworkAlive||draft!==original||past!==oldPast||future!==oldFuture||frameContextKey()!==key||apply!==publisher||selectionTrajectoryStamp(draft)!==input)throw Error('Original timeline input changed during Apply.');};
      const prepared=structuredClone($state.snapshot(draft));frameDetached(original,prepared);current();
      if(selectionTrajectoryStamp(prepared)!==input)throw Error('Original timeline Apply snapshot changed.');
      error=publisher(prepared,current)??'';
    }catch(cause){error=String(cause);}finally{publishingTimelineInput=false;}
  }

  function addLayer() {
    mutate(() => {
      draft.timeline ??= { duration: 1, keys: [] };
      const next = {
        id: id(),
        name: 'Layer ' + (layers.length + 1),
        visible: true,
        locked: false,
        keys: [{ frame: 0, shapes: [] }],
      };
      draft.timeline.layers = [...(draft.timeline.layers ?? []), next];
      layerId = next.id;
    });
  }
  function layerChange(action: 'remove' | 'front' | 'back') {
    mutate(() => {
      if (layerId === '@base' || layer.locked)
        throw new Error('Choose an unlocked additional layer.');
      const rest = draft.timeline!.layers!.filter((l) => l.id !== layerId);
      if (action === 'remove') {
        draft.timeline!.layers = rest;
        layerId = '@base';
      } else draft.timeline!.layers = action === 'front' ? [...rest, layer] : [layer, ...rest];
    });
  }
  function paint() {
    if (sampledStage || !canvas) return;
    const c = canvas.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 540, 330);
    if(rememberedPlayback&&(preparingRemembered||rememberedFailure||(playing&&!rememberedPose)))return;
    const scale = Math.min(500 / Math.max(1, draft.width), 290 / Math.max(1, draft.height));
    c.translate(20, 20);
    c.scale(scale, scale);
    if(rememberedPlayback&&rememberedPose&&rememberedPose.frame===frame){
      if(playbackStamp()!==rememberedOwner||hierarchyOwner!==sampledEnclosingOwner)return;
      rememberedPose.shapes.forEach(shape=>drawShape(c,shape,assets,paint));return;
    }
    const instance = {
      id: 'preview',
      kind: 'symbol' as const,
      symbolId: draft.id,
      x: 0,
      y: 0,
      width: draft.width,
      height: draft.height,
      rotation: 0,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    const previewProject = { symbols: symbols.map((d) => (d.id === draft.id ? draft : d)) };
    if (onion && !playing) {
      const ghost = onionActive ? clone(draft) : draft;
      if (onionActive) {
        if (layerId !== '@base') {
          ghost.shapes = [];
          if (ghost.timeline)
            ghost.timeline.keys = ghost.timeline.keys.map((k) => ({ ...k, shapes: [] }));
        }
        if (ghost.timeline?.layers)
          ghost.timeline.layers = ghost.timeline.layers.map((l) => ({
            ...l,
            visible: l.visible && l.id === layerId,
          }));
      }
      const ghostProject = { symbols: symbols.map((d) => (d.id === ghost.id ? ghost : d)) };
      const paintOnion = createOnionPainter(c, assets, paint);
      for (const sample of symbolOnionFrames(draft, frame, {
        before: onionBefore,
        after: onionAfter,
        opacity: onionOpacity,
        fade: onionFade,
        keysOnly: onionKeys,
        layerId: onionActive ? layerId : undefined,
      })) {
        paintOnion(
          expandSymbols(ghostProject, [instance], sample.frame),
          sample.opacity,
          onionTint ? (sample.frame < frame ? onionPastColor : onionFutureColor) : undefined,
          onionOutline,
        );
      }
    }

    if (rangeArtwork && !playing) {
      c.save();
      try {
        const ghosts = multiFrameKeys(
          artworkProject(),
          artworkTracks,
          rangeStart - 1,
          rangeEnd - 1,
        ).flatMap((t) => t.keys.flatMap((k) => expandSymbols(previewProject, k.shapes, 0)));
        createOnionPainter(c, assets, paint)(ghosts, 0.75, '#8b5cf6', true);
      } catch {
        /* Commit reports invalid scopes without changing artwork. */
      } finally {
        c.restore();
      }
    }
    const movies =
      moviePose?.frame === frame && moviePose.draft === JSON.stringify(draft)
        ? moviePose.frames
        : {};
    expandSymbols(
      previewProject,
      [instance],
      frame,
      (s) => movies['root/' + s.id + '/' + s.symbolId] ?? 0,
    ).forEach((s) => drawShape(c, s, assets, paint));
    if (rangeArtwork && !playing) {
      c.save();
      try {
        c.translate(rangeOffset.x, rangeOffset.y);
        if (rangeOperation) c.transform(...rangeOperation);
        const picked = multiFrameMembers(
          artworkProject(),
          artworkTracks,
          rangeStart - 1,
          rangeEnd - 1,
          rangeSelection,
        );
        createOnionPainter(c, assets, paint)(
          expandSymbols(previewProject, picked, 0),
          0.9,
          '#00cfff',
          true,
        );
      } catch {
        /* Scope validation is reported on commit. */
      }
      c.restore();
      if (rangeHandlesEnabled) {
        const b = rangeBounds();
        if (b) {
          c.save();
          if (rangeOperation) c.transform(...rangeOperation);
          c.strokeStyle = '#00cfff';
          c.lineWidth = 1 / scale;
          c.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
          for (const h of rangeHandles(b)) {
            c.fillStyle = ['rotate', 'pivot'].includes(h.name) ? '#ffb347' : '#ffffff';
            c.fillRect(h.x - 3 / scale, h.y - 3 / scale, 6 / scale, 6 / scale);
            c.strokeRect(h.x - 3 / scale, h.y - 3 / scale, 6 / scale, 6 / scale);
          }
          c.restore();
        }
      }
      if (rangeRing.length) {
        c.beginPath();
        c.moveTo(rangeRing[0].x, rangeRing[0].y);
        for (const p of rangeRing.slice(1)) c.lineTo(p.x, p.y);
        c.closePath();
        c.strokeStyle = '#00cfff';
        c.lineWidth = 1 / scale;
        c.stroke();
      }
    }
  }
  $effect(() => {
    JSON.stringify([
      draft,
      frame,
      moviePose,rememberedPose,preparingRemembered,rememberedFailure,rememberedPlayback,
      rangeArtwork,
      rangeOffset,
      rangeSelection,
      rangeOperation,
      rangeHandlesEnabled,
      rangePivotX,
      rangePivotY,
      rangeRing,
      artworkTracks,
      rangeStart,
      rangeEnd,
      playing,
      onion,
      onionBefore,
      onionAfter,
      onionOpacity,
      onionKeys,
      onionActive,
      onionFade,
      onionTint,
      onionOutline,
      onionPastColor,
      onionFutureColor,
      layerId,
    ]);
    if (
      !playing &&
      moviePose &&
      (moviePose.frame !== frame || moviePose.draft !== JSON.stringify(draft))
    )
      moviePose = null;
    paint();
  });
  onMount(() => {
    const element=dialog; element.showModal();previewAlive=true;
    paint();
    if(initialScriptFrame!==undefined)openLocalSource(undefined,true);
    let raf = 0,
      start = 0,
      base = 0,
      first = 0,
      last = 0,
      was = false,epoch=-1;
    let clock: ReturnType<typeof createSymbolPreviewClock> | undefined;
    let draftSignature = '';
    const tick = (time: number) => {
      try {
        if (playing) {
          if (!was||epoch!==playbackEpoch) {
            epoch=playbackEpoch;
            start = time;
            first = previewRange ? rangeStart - 1 : 0;
            last = previewRange ? rangeEnd - 1 : duration - 1;
            base =
              frame < first || frame > last || (!previewLoop && frame === last) ? first : frame;
            if(!rememberedPlayback)clock = createSymbolPreviewClock(draft, symbols, fps, first, last);
            draftSignature = JSON.stringify(draft);
            if(!rememberedPlayback)clock!.sample(base, 0, base);
          }
          const next = base + Math.floor(((time - start) * fps) / 1000);
          if (previewLoop) frame = first + ((next - first) % (last - first + 1));
          else {
            frame = Math.min(next, last);
            if (next > last) playing = false;
          }
          const seconds = previewLoop
            ? (time - start) / 1000
            : Math.min((time - start) / 1000, (last - base) / fps);
          if(rememberedPlayback){
            if(!rememberedSession)throw new Error('Remembered symbol playback is not prepared.');
            const pose=rememberedSession.sample(frame,seconds,previewLoop?next:Math.min(next,last));
            rememberedPose={frame,shapes:pose.shapes};
          }else{
            const frames = clock!.sample(frame, seconds, previewLoop ? next : Math.min(next, last));
            if (
              moviePose?.frame !== frame ||
              moviePose.draft !== draftSignature ||
              JSON.stringify(moviePose.frames) !== JSON.stringify(frames)
            )
              moviePose = { frame, draft: draftSignature, frames };
          }
        }
      } catch (e) {
        error = String(e);
        playing = false;
        moviePose = null;
        if(rememberedPlayback){releaseRemembered();rememberedFailure=true;}
      }
      was = playing;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      previewAlive=false;
      releaseRemembered();
      cancelAnimationFrame(raf);
      if (element.open) element.close();
    };
  });
</script>

<dialog
  bind:this={dialog}
  aria-label="Symbol timeline"
  onkeydown={wrapDialogTab}
  oncancel={(e) => {
    e.preventDefault();
    if (rangeGesture) cancelRangeGesture();
    else if (sourceEditor) void leaveLocalSource();
    else if (localInspector) closeLocalInspector();
    else if (!editing) cancel();
  }}
>
  <h2>Timeline: {definition.name}</h2>
  <button disabled={!draft.timeline||playing||editing||buttonPreview||!!sourceEditor||!!localInspector} onclick={()=>openLocalSource()}>Edit local frame source</button>
  <button disabled={!draft.timeline||playing||editing||buttonPreview||!!sourceEditor||!!localInspector} onclick={openLocalInspector}>Inspect local timeline scripts</button>
  {#if localInspector}
    {#key localInspector.id}<section aria-label="Local timeline script inspector">
      {#if localInspectorError}<p role="alert">{localInspectorError}</p>{/if}
      <fieldset disabled={!!localInspectorError}>
        <ScriptPreview inputLayers={symbolLayers(localInspector.data.artwork.definition)} config={localInspector.data.config} sources={localInspector.data.sources} scope="symbol" soundSource={localInspector.data.artwork} subscribeSoundDisposal={localInspector.subscribeSoundDisposal} validate={localInspector.verify} preparePreview={localInspector.prepare} renderArtwork={localInspector.renderArtwork} queryArtwork={localInspector.queryArtwork} artworkHistory={localInspector.artworkHistory} continueArtwork={localInspector.continueArtwork} hoverArtwork={localInspector.hoverArtwork} pressArtwork={localInspector.pressArtwork} qualifyArtwork={localInspector.qualifyArtwork} publishArtworkDelivery={localInspector.publishArtworkDelivery} openSource={localInspector.openSource}/>
      </fieldset>
      <button onclick={closeLocalInspector}>Close local script inspector</button>
    </section>{/key}
  {/if}
  {#if sourceMessage}<p role="status">{sourceMessage} Apply the symbol timeline to keep it in the project.</p>{/if}
  {#if sourceEditor}
    {#key sourceEditor.id}
      <section aria-label="Local frame source editor">
        {#if draft.timeline?.frameScripts?.length}
          <div role="group" aria-label="Frame scripts">
            {#each draft.timeline.frameScripts as entry (entry.frame)}
              <button disabled={entry.frame===sourceEditor.frame} onclick={() => void leaveLocalSource(() => {
                frame=entry.frame;openLocalSource();
              })}>Frame {entry.frame+1}</button>
            {/each}
          </div>
        {/if}
        <ScriptCheck bind:this={localScriptEditor} bind:source={localSourceDraft} frameNumber={sourceEditor.frame+1} scope="symbol" selection={sourceEditor.selection} apply={sourceEditor.apply} persist={sourceEditor.persist} remove={sourceEditor.remove}/>
        <button onclick={() => void leaveLocalSource()}>Close local source editor</button>
        {#if sourceLeaveBlocked && localSourceDraft !== (sourceEditor.original ?? '')}
          <p role="alert">Frame changes still need to be saved. Retry or discard this draft.</p>
          <button onclick={closeLocalSource}>Discard local frame draft</button>
        {/if}
      </section>
    {/key}
  {/if}
  {#if returnTo}
    <button disabled={playing || JSON.stringify(draft) !== JSON.stringify(definition)} onclick={() => { error = returnTo!() ?? ''; }}>Return to {returnName}</button>
    <p>Undo current changes before returning. Apply commits this definition and closes the editor.</p>
  {/if}
  <button
    disabled={!draft.buttonStates && duration < 4}
    onclick={() => {
      playing = false;
      cancelRangeGesture();
      buttonPreview = true;
    }}>Test button states</button
  >
  <p>
    Button test uses the saved state frames, or frames 1–4 when no mapping is saved. This mapping
    does not yet assign interactive behavior to stage or exported instances.
  </p>
  <label
    ><input
      type="checkbox"
      aria-label="Save button state mapping"
      checked={!!draft.buttonStates}
      onchange={(e) =>
        mutate(() => {
          if (e.currentTarget.checked)
            draft.buttonStates = {
              up: 0,
              over: Math.min(1, duration - 1),
              down: Math.min(2, duration - 1),
              hit: Math.min(3, duration - 1),
            };
          else delete draft.buttonStates;
        })}
    />Save button state mapping</label
  >
  {#if draft.buttonStates}
    <fieldset>
      <legend>Button state frames</legend>
      {#each ['up', 'over', 'down', 'hit'] as name}
        <label
          >{name}<input
            type="number"
            min="1"
            max={duration}
            step="1"
            aria-label={'Button ' + name + ' frame'}
            value={draft.buttonStates[name as keyof typeof draft.buttonStates] + 1}
            onchange={(e) => {
              const value = Number(e.currentTarget.value) - 1;
              mutate(() => {
                draft.buttonStates![name as keyof NonNullable<typeof draft.buttonStates>] = value;
              });
            }}
          /></label
        >
      {/each}
      <p>
        States may share a frame. Frame positions stay fixed when keys are inserted or removed.
        Shortening the timeline past a mapped state is rejected; remap it first.
      </p>
    </fieldset>
  {/if}
  {#if buttonPreview}
    <SymbolButtonPreview
      validateSource={()=>{if(hierarchyOwner!==sampledEnclosingOwner)throw new Error('Symbol editing source changed. Close and reopen the timeline.');}}
      definition={draft}
      {assets}
      {symbols}
      {fps}
      close={() => {
        buttonPreview = false;
      }}
    />
  {/if}
  <p>
    Graphic loop at document frame rate. Each parent exposure starts this timeline at frame 1.
    Choose Movie clip on an instance for independent Test animation/export playback, including
    nested clips. Graphic symbols follow their containing exposure. Movie children run independently
    during preview, including a one-frame loop. Stop or play-once freezes the last pose; scrubbing
    or editing restores the authoring pose. Each new preview starts fresh movie clocks.
  </p>
  <label><input type="checkbox" aria-label="Show sampled symbol stage" bind:checked={sampledStage}
    disabled={playing||editing||buttonPreview} onchange={()=>{cancelRangeGesture();}}/>Show sampled symbol stage</label>
  {#if sampledStage}
    {#key sampledScope}
      {@const expected=sampledScope}
      <SymbolSampledStage definition={$state.snapshot(draft)} symbols={$state.snapshot(symbols)} assets={$state.snapshot(assets)} {frame} promote={promoteSampled} publishSelection={publishSampledSelection} publishTrajectories={publishSelectionTrajectories} validateCandidate={validate}
        validateSource={sampledSourceValidator(expected)}/>
    {/key}
  {:else}
  <div class="motion-stage" bind:clientWidth={motionStageWidth}>
  <canvas
    bind:this={canvas}
    width="540"
    height="330"
    aria-label="Symbol timeline preview"
    tabindex="0"
    onpointerdown={rangeDown}
    onpointermove={rangeMove}
    onpointerup={rangeUp}
    onpointercancel={cancelRangeGesture}
    onlostpointercapture={cancelRangeGesture}
    onblur={cancelRangeGesture}
  ></canvas>
  {#if editNodeHintsOnStage && !playing}
    {#key `${draft.id}:${layerId}:${frame}:${rangeStart}:${rangeEnd}`}
      <MotionNodeHints source={layer.keys.find(k => k.frame === rangeStart - 1)?.shapes[0]} target={layer.keys.find(k => k.frame === rangeEnd - 1)?.shapes[0]} bind:value={motionNodeHints} straight={motionMatchStraightNodes} curves={motionMatchCurvedNodes} distance={motionCurveDistance} offset={motionContourStart} offsets={motionContourOffsets} reverse={motionContourReverse} directions={motionContourDirections} order={motionContourOrder} label="Symbol stage motion" stageBox={{x: -20 / motionStageScale, y: -20 / motionStageScale, width: 540 / motionStageScale, height: 330 / motionStageScale}} stageScale={motionStageScale * motionStageWidth / 540} />
    {/key}
  {/if}
  {#if editMotionOnStage && !editNodeHintsOnStage && motionPath && !playing}
    {@const pathStart = layer.keys.find(k => k.frame === rangeStart - 1)?.shapes[0]}
    {@const pathEnd = layer.keys.find(k => k.frame === rangeEnd - 1)?.shapes[0]}
    {#if pathStart && pathEnd}
      {#key `${draft.id}:${layerId}:${frame}:${rangeStart}:${rangeEnd}`}
        <MotionPathPreview groupSource={layer.keys.find(k=>k.frame===rangeStart - 1)?.shapes ?? []} groupTarget={layer.keys.find(k=>k.frame===rangeEnd - 1)?.shapes ?? []} groupRotation={motionRotation} bind:value={motionPath} start={pathStart} end={pathEnd}
          label="Symbol stage motion path"
          stageBox={{x: -20 / motionStageScale, y: -20 / motionStageScale, width: 540 / motionStageScale, height: 330 / motionStageScale}}
          stageScale={motionStageScale * motionStageWidth / 540} />
      {/key}
    {/if}
  {/if}
  </div>
  {/if}
  <fieldset>
    <legend>Multi-frame symbol artwork</legend>
    <label
      ><input
        type="checkbox"
        aria-label="Edit symbol frame-range artwork"
        bind:checked={rangeArtwork}
        onchange={cancelRangeGesture}
      />Edit artwork across the selected frame range</label
    >
    {#if rangeArtwork}
      <label
        ><input
          type="checkbox"
          aria-label="Symbol multi-frame transform handles"
          bind:checked={rangeHandlesEnabled}
          onchange={() => {
            cancelRangeGesture();
            if (rangeHandlesEnabled && !draft.multiFramePivot) centerRangePivot();
          }}
        />Transform handles</label
      >
      <button onclick={centerRangePivot}>Center symbol range pivot</button>
      <p>
        Corner handles scale from the opposite corner; Alt uses the shared pivot. Shift keeps
        proportions or snaps rotation/skew to 15 degrees. Edge midpoints skew parallel to their
        edge; Alt uses the shared pivot. Drag the orange center handle to move the pivot; Shift
        constrains its axis. Pivot movement is session-only. Escape cancels the preview.
      </p>
      <label
        >Canvas action<select
          aria-label="Symbol range canvas action"
          bind:value={rangePick}
          onchange={cancelRangeGesture}
        >
          <option value="move">Move selection</option><option value="point"
            >Pick objects/groups</option
          >
          <option value="box">Marquee</option><option value="lasso">Lasso</option>
        </select></label
      >
      <button
        onclick={() => {
          cancelRangeGesture();
          rangeSelection = null;
        }}>Select all symbol range artwork</button
      >
      <button
        onclick={() => {
          cancelRangeGesture();
          rangeSelection = [];
        }}>Clear symbol range selection</button
      >
      <p>
        {rangeSelection === null ? 'All' : rangeSelection.length} objects selected. Cyan outlines show
        the selection. Point Shift-click toggles groups; Alt-click cycles overlapping objects/groups without
        moving them. Region Shift adds, Alt subtracts, Shift+Alt intersects. Choose Move selection after
        a region selection. Edits and scope changes reset picks.
      </p>
      {#if sampledSelectionScope===JSON.stringify([draft,artworkTracks,rangeStart,rangeEnd])&&sampledSelectionTrajectories}<output aria-label="Updated symbol trajectory selection">Trajectory · {sampledSelectionTrajectories.units} units · {sampledSelectionTrajectories.tracks} tracks · {sampledSelectionTrajectories.members} artwork members</output>{/if}
      {#if sampledSelectionScope===JSON.stringify([draft,artworkTracks,rangeStart,rangeEnd])&&sampledSelectionSkew}
        <output aria-label="Authored sampled symbol selection skew">Skew · {sampledSelectionSkew.axis.toUpperCase()} · {sampledSelectionSkew.degrees}° · Pivot {sampledSelectionSkew.pivot.x.toFixed(2)}, {sampledSelectionSkew.pivot.y.toFixed(2)}</output>
      {/if}
      {#if sampledSelectionScope===JSON.stringify([draft,artworkTracks,rangeStart,rangeEnd])&&sampledSelectionScale}
        <output aria-label="Authored sampled symbol selection scale">Scale · {(sampledSelectionScale.x*100).toFixed(2)}%, {(sampledSelectionScale.y*100).toFixed(2)}% · Pivot {sampledSelectionScale.pivot.x.toFixed(2)}, {sampledSelectionScale.pivot.y.toFixed(2)}</output>
      {/if}
      {#if sampledSelectionScope===JSON.stringify([draft,artworkTracks,rangeStart,rangeEnd])&&sampledSelectionRotation}
        <output aria-label="Authored sampled symbol selection rotation">Rotation · {sampledSelectionRotation.degrees}° · Pivot {sampledSelectionRotation.pivot.x.toFixed(2)}, {sampledSelectionRotation.pivot.y.toFixed(2)}</output>
      {/if}
      <p>
        Drag the preview to move selected artwork on checked tracks, or the active track if none are
        checked. Purple outlines show whole key exposures, including held portions outside the
        range. Shift constrains an axis; Escape cancels. Apply timeline commits the draft to the
        project. Keep artwork on at least one frame of the symbol.
      </p>
      <label
        >X offset<input
          type="number"
          aria-label="Symbol multi-frame X offset"
          bind:value={rangeX}
        /></label
      >
      <label
        >Y offset<input
          type="number"
          aria-label="Symbol multi-frame Y offset"
          bind:value={rangeY}
        /></label
      >
      <button disabled={playing} onclick={() => editRangeArtwork('move')}
        >Move symbol range artwork</button
      >
      <label
        >Rotation<input
          type="number"
          aria-label="Symbol multi-frame rotation"
          bind:value={rangeAngle}
        /></label
      >
      <label
        >Scale %<input
          type="number"
          aria-label="Symbol multi-frame scale"
          bind:value={rangeScale}
        /></label
      >
      <label
        >Pivot X<input
          type="number"
          aria-label="Symbol multi-frame pivot X"
          bind:value={rangePivotX}
        /></label
      >
      <label
        >Pivot Y<input
          type="number"
          aria-label="Symbol multi-frame pivot Y"
          bind:value={rangePivotY}
        /></label
      >
      <button disabled={playing} onclick={() => rememberRangePivot()}>Remember symbol pivot</button>
      <button disabled={playing || !draft.multiFramePivot} onclick={() => rememberRangePivot(true)}
        >Forget saved symbol pivot</button
      >
      <button disabled={playing} onclick={() => editRangeArtwork('transform')}
        >Transform symbol range artwork</button
      >
      <button disabled={playing} onclick={() => editRangeArtwork('delete')}
        >Delete symbol range artwork</button
      >
    {/if}
  </fieldset>
  <fieldset>
    <legend>Symbol onion skins</legend>
    <label
      ><input type="checkbox" aria-label="Symbol onion skins" bind:checked={onion} />Show
      neighboring frames</label
    >
    <label
      >Before<input
        type="number"
        min="0"
        max="5"
        step="1"
        aria-label="Symbol onion before"
        bind:value={onionBefore}
      /></label
    >
    <label
      >After<input
        type="number"
        min="0"
        max="5"
        step="1"
        aria-label="Symbol onion after"
        bind:value={onionAfter}
      /></label
    >
    <NumberSlider liveNumber label="Symbol onion opacity" caption="Opacity" value={onionOpacity} min={0} max={1} step={0.05} scope={frame} onchange={value=>onionOpacity=value}/>
    <label
      ><input
        type="checkbox"
        aria-label="Symbol onion keyframes only"
        bind:checked={onionKeys}
      />Different key exposures only</label
    >
    <label
      ><input
        type="checkbox"
        aria-label="Symbol onion active layer only"
        bind:checked={onionActive}
      />Active layer only</label
    >
    <label
      ><input type="checkbox" aria-label="Symbol onion fade" bind:checked={onionFade} />Fade farther
      samples</label
    >
    <label
      ><input
        type="checkbox"
        aria-label="Symbol onion outlines"
        bind:checked={onionOutline}
      />Outline onion skins</label
    >
    <label
      ><input type="checkbox" aria-label="Symbol onion tint" bind:checked={onionTint} />Tint
      neighboring frames</label
    >
    <label
      >Past color<input
        type="color"
        aria-label="Symbol onion past color"
        bind:value={onionPastColor}
      /></label
    >
    <label
      >Future color<input
        type="color"
        aria-label="Symbol onion future color"
        bind:value={onionFutureColor}
      /></label
    >
    <p>
      Preview only; farther frames fade. Hidden during playback, without wrapping at timeline ends.
    </p>
  </fieldset>
  <fieldset disabled={playing}>
    <legend>Symbol layers</legend>
    <label
      >Layer<select aria-label="Symbol layer" bind:value={layerId}
        >{#each layers as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select
      ></label
    >
    <button onclick={addLayer}>Add symbol layer</button>
    <button
      disabled={!writable}
      onclick={() =>
        mutate(() => {
          const result = duplicateSymbolLayer(draft, layerId, symbols, assets);
          draft = result.definition;
          layerId = result.layerId;
        }, false)}>Duplicate symbol layer</button
    >
    <button
      disabled={!writable}
      onclick={() => mutate(() => { draft = distributeSymbolArtwork(draft, layerId, symbols, assets); }, false)}
      >Distribute symbol artwork to layers</button
    >
    <p>Separates objects and outer groups across this track's entire timeline.</p>
    {#if layerId !== '@base'}
      <label
        >Name<input
          aria-label="Symbol layer name"
          value={layer.name}
          disabled={layer.locked}
          onchange={(e) => {
            const name = e.currentTarget.value.trim();
            mutate(() => {
              if (!name || name.length > 80)
                throw new Error('Enter a layer name up to 80 characters.');
              layer.name = name;
            });
          }}
        /></label
      >
      <label
        ><input
          type="checkbox"
          aria-label="Symbol layer visible"
          checked={layer.visible}
          onchange={(e) =>
            mutate(() => {
              layer.visible = e.currentTarget.checked;
            })}
        />Visible</label
      >
      <label
        ><input
          type="checkbox"
          aria-label="Symbol layer locked"
          checked={layer.locked}
          onchange={(e) =>
            mutate(() => {
              layer.locked = e.currentTarget.checked;
            })}
        />Locked</label
      >
      <button disabled={layer.locked} onclick={() => layerChange('front')}
        >Bring symbol layer to front</button
      >
      <button disabled={layer.locked} onclick={() => layerChange('back')}
        >Send symbol layer to back</button
      >
      <button disabled={layer.locked} onclick={() => layerChange('remove')}
        >Remove symbol layer</button
      >
    {/if}
    <p>
      Artwork is the fixed bottom layer. Additional layers have independent keys and share duration.
    </p>
  </fieldset>
  <SymbolFrameGrid
    {layers}
    frameScripts={draft.timeline?.frameScripts}
    {selectedTracks}
    {duration}
    {frame}
    {layerId}
    start={rangeStart - 1}
    end={rangeEnd - 1}
    disabled={playing}
    select={selectFrame}
    exposure={selectExposure}
    contextScript={(event, track, at) => {
      if(at>=duration||playing||editing||sourceEditor||localInspector)return;
      event.preventDefault();
      const owner=draft;
      frameScriptMenu={x:event.clientX,y:event.clientY,items:[{
        label:'Script…',
        run:()=>{
          if(draft!==owner||playing||editing||sourceEditor||localInspector)return;
          selectFrame(track,at,false);
          openLocalSource(undefined,true);
        },
      }]};
    }}
    transfer={(source, start, end, target, at, sources, destinations) => {
      mutate(() => {
        draft =
          sources.length > 1
            ? transferSymbolTracks(draft, sources, start, end, at, true, destinations, symbols, assets)
            : transferSymbolFrames(draft, source, start, end, target, at, true, symbols, assets);
        layerId = target;
        frame = at;
        rangeStart = at + 1;
        rangeEnd = at + end - start + 1;
      }, false);
    }}
    command={rangeShortcut}
  />
  {#if frameScriptMenu}
    <ContextMenu {...frameScriptMenu} close={() => frameScriptMenu=undefined} />
  {/if}
  <label
    >Duration<input
      aria-label="Symbol duration"
      type="number"
      min="1"
      max="10000"
      value={duration}
      onchange={(e) => {
        releaseRemembered();playing = false;
        const n = Number(e.currentTarget.value);
        mutate(() => {
          draft.timeline = { ...draft.timeline, duration: n, keys: draft.timeline?.keys ?? [] };
        });
      }}
    /></label
  >
  <label
    >Frame<input
      aria-label="Symbol frame"
      type="number"
      min="1"
      max={duration}
      value={frame + 1}
      onchange={(e) => {
        releaseRemembered();playing = false;
        const n = Number(e.currentTarget.value);
        if (Number.isFinite(n)) frame = Math.max(0, Math.min(duration - 1, Math.floor(n) - 1));
      }}
    /></label
  >
  <label
    >Keyframes<select
      aria-label="Symbol keyframes"
      value={heldStart}
      disabled={playing}
      onchange={(e) => {
        frame = Number(e.currentTarget.value);
      }}
    >
      {#each keyframes as k (k.frame)}<option value={k.frame}
          >Frame {k.frame + 1}{k.shapes.length ? '' : ' (blank)'}</option
        >{/each}
    </select></label
  >
  <button disabled={playing || frame === 0} onclick={() => navigate(false)}
    >Previous symbol keyframe</button
  >
  <button
    disabled={playing || !keyframes.some((k) => k.frame > frame)}
    onclick={() => navigate(true)}>Next symbol keyframe</button
  >
  <p>{key ? 'Keyframe' : 'Held exposure'} · {frame + 1} / {duration}</p>
  <fieldset disabled={playing}>
    <legend>Preview playback</legend>
    <label><input type="checkbox" aria-label="Use remembered symbol playback" bind:checked={rememberedPlayback}
      onchange={()=>{releaseRemembered();playing=false;}}/>Evaluate remembered animation, including nested children</label>
    <p>Remembered playback prepares a read-only snapshot before starting. Edited child recipes reject the whole preview; scripts and button interaction stay in their separate test views.</p>
    <label
      ><input
        type="checkbox"
        aria-label="Preview selected symbol range"
        bind:checked={previewRange}
      />Selected frame range only</label
    >
    <label
      ><input type="checkbox" aria-label="Loop symbol preview" bind:checked={previewLoop} />Loop
      preview</label
    >
    <p>Preview settings stay in this dialog. Turning loop off stops on the last frame.</p>
  </fieldset>
  {#if preparingRemembered}<p role="status">Preparing remembered symbol playback.</p>{/if}
  <div>
    <button onclick={togglePreview}
      >{preparingRemembered?'Cancel symbol preview preparation':playing ? 'Stop symbol preview' : 'Play symbol preview'}</button
    >
    <button disabled={key || playing || !writable} onclick={() => setArtwork(artwork)}
      >Insert symbol keyframe</button
    >
    <button disabled={playing || !writable} onclick={() => setArtwork([])}
      >Insert blank symbol keyframe</button
    >
    <button
      disabled={!frame || !key || playing || !writable}
      onclick={() =>
        mutate(() => {
          if (layerId === '@base')
            draft.timeline!.keys = draft.timeline!.keys.filter((k) => k.frame !== frame);
          else layer.keys = layer.keys.filter((k) => k.frame !== frame);
        })}>Remove symbol keyframe</button
    >
    <button
      bind:this={frameArtworkButton}
      disabled={playing || !writable}
      onclick={() => {
        frameArtworkSession={};editing = true;
      }}>Edit symbol frame artwork</button
    >
  </div>
  <fieldset disabled={playing || !writable}>
    <legend>Copy or move a key</legend>
    <label
      >Destination layer<select
        aria-label="Symbol key destination layer"
        bind:value={destinationLayerId}
      >
        <option value="">Current layer</option>
        {#each layers as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select></label
    >
    <label
      >Destination frame<input
        aria-label="Symbol key destination"
        type="number"
        min="2"
        max="10000"
        bind:value={destination}
      /></label
    >
    <button onclick={() => transfer(false)}>Copy symbol exposure</button>
    <button disabled={!frame || !key} onclick={() => transfer(true)}>Move symbol keyframe</button>
    <p>
      Copy uses the current held artwork. Move relocates this key only, within or between layers.
      Existing destination keys are protected; later destinations extend duration.
    </p>
  </fieldset>
  <fieldset disabled={playing || !writable}>
    <legend>Frame range on this layer</legend>
    <label
      >From<input
        type="number"
        min="1"
        max={duration}
        aria-label="Symbol range start"
        bind:value={rangeStart}
      /></label
    >
    <label
      >Through<input
        type="number"
        min="1"
        max={duration}
        aria-label="Symbol range end"
        bind:value={rangeEnd}
      /></label
    >
    <button
      onclick={() => {
        rangeStart = frame + 1;
        rangeEnd = frame + 1;
      }}>Use current symbol frame</button
    >
    <button onclick={() => selectExposure(layerId, frame)}>Select held symbol exposure</button>
    <button onclick={() => editRange(true)}>Duplicate symbol frame range</button>
    <button onclick={() => editRange(false)}>Remove symbol frame range</button>
    <button
      onclick={() =>
        mutate(() => {
          draft = reverseSymbolFrames(draft, layerId, rangeStart - 1, rangeEnd - 1, symbols, assets);
        }, false)}>Reverse symbol frame range</button
    >
    <MotionEasing bind:value={motionEase} label="Symbol motion easing" />
    <MotionRotationControls bind:value={motionRotation} label="Symbol motion rotation" />
    <label><input type="checkbox" aria-label="Symbol motion reverse contour matching" bind:checked={motionContourReverse} />Reverse end node matching</label>
    <label>End contour start offset <input type="number" min="0" step="1" aria-label="Symbol motion contour start offset" bind:value={motionContourStart} /></label>
    <label>End contour order (optional) <input aria-label="Symbol motion contour order" bind:value={motionContourOrder} placeholder="1, 0" /></label>
    <small>List every end contour index once, starting at zero, in source matching order. Blank keeps authored order. Per-contour offsets apply after this ordering.</small>
    <label>Per-contour directions (optional) <input aria-label="Symbol motion per-contour directions" bind:value={motionContourDirections} placeholder="forward, reverse" /></label>
    <small>List forward or reverse for each contour in source matching order, after end contour ordering. Blank uses the shared reversal; an explicit list overrides it. Requires node interpolation.</small>
    <label>Per-contour offsets (optional) <input aria-label="Symbol motion per-contour offsets" bind:value={motionContourOffsets} placeholder="0, 2" /></label>
    <small>Comma-separated offsets override the shared offset in contour order. Supply one per contour of every selected path.</small>
    <small>With node interpolation, pair the first node with this end-contour node offset (wraps per contour). Reversal pairs nodes backward from the offset and swaps handles. Open Bezier paths allow reversal at offset zero only. Closed contours with repeated closing anchors are unsupported. Endpoint keys stay unchanged.</small>
    <label><input type="checkbox" aria-label="Symbol motion validate curve self contacts" bind:checked={motionCurveSelfContacts} />Reject self-contact within each Bezier segment (requires nodes)</label>
    <small>Checks all curve positions and motion progress. Stationary tangents, missing endpoint handles and unresolved cases also reject. Does not check contacts between different segments or objects.</small>
    <label><input type="checkbox" aria-label="Symbol motion validate curve tangents" bind:checked={motionCurveTangents} />Reject stationary or reversing Bezier tangents (requires nodes)</label>
    <p>Checks all motion progress and curve positions. Missing endpoint handles, near-zero tangents, reversing joins and unresolved cases reject. Does not prevent crossings.</p>
    <label><input type="checkbox" aria-label="Symbol motion validate contour contacts" bind:checked={motionContourContacts} />Reject contour contacts (straight or Bezier)</label>
    <small>Checks contacts throughout node interpolation, plus segment and closed-area collapse. Straight contours include adjacent retracing and contacts between contours. Bezier curves allow shared endpoints but reject other segment contacts. Self-contact within one cubic requires the separate self-contact option. Use the tangent guard separately for stationary or reversing joins. Separate objects are excluded. Bounded work rejects unresolved or over-budget input.</small>
    <label><input type="checkbox" aria-label="Symbol motion validate contour edges" bind:checked={motionContourEdges} />Reject segment collapse and closed area collapse</label>
    <small>Requires node interpolation. Checks straight and cubic segments throughout the tween, including open paths. Crossings, cusps and contour contacts are not checked.</small>
    <label><input type="checkbox" aria-label="Symbol motion validate contour areas" bind:checked={motionContourAreas} />Reject closed contour area collapse (requires node interpolation)</label>
    <small>Checks polygon and closed Bezier contour areas throughout the tween. Rejects signed-area collapse or reversal; does not detect every edge crossing or hole contact. Other shape kinds are unchanged.</small>
    <label><input type="checkbox" aria-label="Edit symbol motion path on stage" bind:checked={editMotionOnStage} disabled={!motionPath} onchange={cancelRangeGesture} />Edit motion path on symbol stage</label>
    <MotionPathControls groupSource={layer.keys.find(k=>k.frame===rangeStart - 1)?.shapes ?? []} groupTarget={layer.keys.find(k=>k.frame===rangeEnd - 1)?.shapes ?? []} groupRotation={motionRotation} guides={layers.filter(l=>l.visible).flatMap(l=>keyAt(l,frame).shapes)} bind:value={motionPath} label="Symbol motion path" start={layer.keys.find(k => k.frame === rangeStart - 1)?.shapes[0]} end={layer.keys.find(k => k.frame === rangeEnd - 1)?.shapes[0]} />
    <label><input type="checkbox" aria-label="Symbol motion interpolate scale and skew" bind:checked={motionAffine} />Interpolate scale and skew</label>
    <label><input type="checkbox" aria-label="Symbol motion opacity weighted gradients" bind:checked={motionGradientPremultiplied} />Weight gradient colors by stop opacity (requires paint interpolation)</label>
    <small>Transparent stops contribute less color, including when matching offsets. Uses encoded RGB; fully transparent pairs keep ordinary hidden colors. Solid colors and object opacity keep their existing interpolation.</small>
    <label><input type="checkbox" aria-label="Symbol motion interpolate paint colors" bind:checked={motionPaint} />Interpolate paint colors</label>
    <small>Paint interpolation blends RGB fill/stroke colors and colors/opacity of matching gradient stops. Gradient geometry stays fixed unless its interpolation is enabled.</small>
    <label><input type="checkbox" aria-label="Symbol motion interpolate gradient geometry" bind:checked={motionGradientGeometry} />Interpolate gradient geometry</label>
    <small>Blends gradient endpoints and corresponding stop offsets. Kind must match; stop count/order must match unless stop matching is enabled. Gradient basis stays fixed unless enabled separately. Coincident endpoints use the existing renderer behavior.</small>
    <label><input type="checkbox" aria-label="Symbol motion match gradient stops" bind:checked={motionGradientStops} />Match gradient stops</label>
    {#if motionGradientStops}<label><input type="checkbox" aria-label="Symbol motion match stop groups in order" bind:checked={motionGradientStopOrder} />Match stop groups in order (requires gradient geometry)</label>{/if}
    <label>Gradient group pairs (optional) <input aria-label="Symbol motion gradient group pairs" bind:value={motionGradientPairs} placeholder="0:0, 0:1, 1:2" /></label>
    <small>With ordered stop matching, pair zero-based source:end groups. Cover every group in order; repeat one side to split or merge groups. Blank pairs equal group counts in order. Enter auto to minimize opacity-weighted color differences plus a small offset-movement cost. Automatic matching is a heuristic; explicit pairs override it.</small>
    <small>Requires paint color interpolation. By default, samples combined fixed offsets. Ordered matching pairs equal counts of distinct stop groups and moves their offsets with gradient geometry. Hard-edge copies repeat to match group sizes. The 32-stop limit applies; original endpoint keys stay exact.</small>
    <label><input type="checkbox" aria-label="Symbol motion interpolate gradient basis" bind:checked={motionGradientBasis} />Interpolate gradient basis</label>
    <small>Blends gradient scale/skew and shortest rotation. Singular bases and reflection changes reject. Gradient endpoints and colors use their separate options.</small>
    <label><input type="checkbox" aria-label="Symbol motion interpolate stroke width" bind:checked={motionStrokeWidth} />Interpolate stroke width</label>
    <label><input type="checkbox" aria-label="Symbol motion interpolate primitive geometry" bind:checked={motionPrimitives} />Interpolate rectangle and ellipse geometry</label>
    <small>Blends width/height and rectangle corner radius. Paint coordinates stay fixed unless separately enabled; contour-backed shapes are unchanged.</small>
    <label><input type="checkbox" aria-label="Symbol motion interpolate curve nodes" bind:checked={motionNodes} />Interpolate matching curve nodes</label>
    <label><input type="checkbox" aria-label="Symbol motion match straight nodes" bind:checked={motionMatchStraightNodes} />Match straight contour nodes</label>
    <label><input type="checkbox" aria-label="Symbol motion match curved nodes" bind:checked={motionMatchCurvedNodes} />Match curved Bezier nodes</label>
    <label><input type="checkbox" aria-label="Symbol motion curved node distance" bind:checked={motionCurveDistance} />Match curved nodes by distance</label>
    <small>Requires curved matching. Uses bounded approximate arc lengths to place subdivisions; exact authored curves remain. Zero-length or unresolved segments reject.</small>
    <small>Choose one matching mode. Curved mode subdivides each original segment at corresponding parameter intervals, preserving its curve. By default, segments receive equal correspondence intervals; enable distance matching to use approximate arc lengths. Interior node pairs also apply. Requires node interpolation; no pressure metadata or topology repair.</small>
    <label><input type="checkbox" aria-label="Edit symbol node hints on stage" bind:checked={editNodeHintsOnStage} onchange={cancelRangeGesture} />Edit symbol node hints on stage</label>
    <small>Stage picking shows the first artwork at its authored endpoint pose. Choose Source or Target to select anchors; shared hints change only when added. Stage hint mode takes priority over motion-path editing. Disable it to edit artwork.</small>
    <label>Interior node pairs<input aria-label="Symbol motion node hints" bind:value={motionNodeHints} placeholder="1:2, 3:4" /></label>
    <MotionNodeHints source={layer.keys.find(k => k.frame === rangeStart - 1)?.shapes[0]} target={layer.keys.find(k => k.frame === rangeEnd - 1)?.shapes[0]} bind:value={motionNodeHints} straight={motionMatchStraightNodes} curves={motionMatchCurvedNodes} distance={motionCurveDistance} offset={motionContourStart} offsets={motionContourOffsets} reverse={motionContourReverse} directions={motionContourDirections} order={motionContourOrder} label="Symbol motion" />
    <small>Optional zero-based source:target interior anchors in increasing order. Separate contours with semicolons; endpoints are implicit. Hints apply after contour order/start/direction matching.</small>
    <small>Straight matching requires node interpolation and straight Bezier or polygon anchors without handles. Inserts points at both contours' proportional edge distances, retaining corners. Contour count and order must match; authored endpoint keys stay exact.</small>
    <small>Without node matching, Bezier anchors/handles and polygon contours match by order with equal counts and handle presence. Inspect generated fills: crossings and collapsing contours are not repaired.</small>
    <button onclick={() => generateMotion()}>Generate symbol motion in-betweens</button>
    <p>Creates editable position, shortest-rotation and opacity keys, with optional scale and skew, between matching endpoint artwork. Existing intermediate keys reject. Graphic symbol playback continues through generated keys; the end key may have its own playback mode/start frame and stays unchanged. Interiors retain the source playback mode. The exact end key may switch between movie and graphic playback; entering movie playback starts its independent clock. Movie offset-only changes preserve elapsed time. Movie descendants retain independent clocks beneath movie and graphic roots. Button descendants are supported behind a movie boundary, including nested movies under graphic roots. Direct buttons and buttons reached only through graphics reject. Moving poses cancel stale presses while state movies continue; later endpoint edits do not update generated keys.</p>
    <fieldset>
      <legend>Remembered basic symbol motion</legend>
      <label><input type="checkbox" bind:checked={autoRefreshRemembered} />Automatically refresh remembered symbol endpoints this session</label>
      <small>Refresh affected spans in the same isolated undo step. Conflicts keep your endpoint edit and existing interiors. This preference resets when the symbol editor closes.</small>
      <p>Creates editable position, shortest-rotation and opacity keys with the optional properties below. These separate controls do not use the motion settings above. Edit an endpoint, then refresh manually or enable automatic refresh for this session. Edited interiors reject refresh; detach preserves keys. Apply saves recipes with the symbol.</p>
      <label><input type="checkbox" aria-label="Saved symbol endpoint refresh" bind:checked={rememberedLive} />Automatically refresh this saved range</label>
<button onclick={() => rememberedMotion('live')}>Apply saved symbol endpoint refresh</button>
<MotionEasing bind:value={rememberedEase} label="Remembered symbol motion easing" />
<label><input type="checkbox" aria-label="Independent remembered symbol opacity easing" bind:checked={rememberedOpacityEnabled}/>Use separate opacity easing for new remembered recipes</label>
{#if rememberedOpacityEnabled}<MotionEasing bind:value={rememberedOpacityEase} label="Remembered symbol opacity easing" />{/if}
<label><input type="checkbox" aria-label="Independent remembered symbol paint easing" bind:checked={rememberedPaintEnabled}/>Use separate paint easing for new remembered recipes</label>
{#if rememberedPaintEnabled}<MotionEasing bind:value={rememberedPaintEase} label="Remembered symbol paint easing" />{/if}
<small>Separate paint easing requires Remember paint colors. It affects fill/stroke and gradient stop colors/opacity; geometry, stop positions and object opacity keep their own easing. This preference only creates new recipes.</small>
<details>
  <summary>Remembered symbol property keys</summary>
  <label>Symbol key property<select bind:value={keyProperty} onchange={()=>existingPaintRevision++}>
    <option value="xKeys">X position</option><option value="yKeys">Y position</option>
    <option value="opacityKeys">Opacity (%)</option><option value="scaleXKeys">Horizontal scale</option>
    <option value="scaleYKeys">Vertical scale</option><option value="rotationKeys">Rotation (degrees)</option>
    <option value="shearKeys">Shear factor</option><option value="fillColorKeys">Solid fill</option>
    <option value="strokeColorKeys">Stroke</option><option value="gradient">Gradient stop</option>
  </select></label>
  {#if keyProperty==='gradient'}<label>Symbol matched stop<input type="number" min="1" max="32" bind:value={keyStop} oninput={()=>existingPaintRevision++}/></label>{/if}
  {#each savedPropertyKeys ?? [] as key}
    <button onclick={()=>{keyFrame=rangeStart+key.offset;if('color' in key)keyColor=key.color;else keyNumber=key.value*(keyProperty==='opacityKeys'?100:1);existingPaintRevision++}}>Frame {rangeStart+key.offset} · {'color' in key?key.color:keyProperty==='opacityKeys'?key.value*100+'%':key.value}</button>
  {/each}
  <label>Symbol property key frame<input type="number" min={rangeStart+1} max={rangeEnd-1} bind:value={keyFrame} oninput={()=>existingPaintRevision++}/></label>
  {#if colorProperty}<label>Symbol key color<input type="color" bind:value={keyColor} oninput={()=>existingPaintRevision++}/></label>
  {:else}<label>Symbol key value<input type="number" step="any" bind:value={keyNumber} oninput={()=>existingPaintRevision++}/></label>{/if}
  <button disabled={rememberedBatch&&!selectedTracks.length} onclick={()=>editRememberedPaint(false,true)}>Set symbol property key</button>
  <button disabled={rememberedBatch&&!selectedTracks.length} onclick={()=>editRememberedPaint(true,true)}>Remove symbol property key</button>
  {#if keyRecipe && savedPropertyKeys}
    {@const axis=keyProperty==='gradient'?keyStop-1:keyProperty==='scaleXKeys'?'sx':keyProperty==='scaleYKeys'?'sy':keyProperty==='shearKeys'?'shear':keyProperty==='xKeys'?'x':keyProperty==='yKeys'?'y':keyProperty==='opacityKeys'?'opacity':keyProperty==='fillColorKeys'?'fill':keyProperty==='strokeColorKeys'?'stroke':'rotation'}
    {#key keyRecipe}
      {#key axis}
        <RememberedPositionTiming span={keyRecipe} {axis} disabled={rememberedBatch&&!selectedTracks.length}
          onchange={()=>existingPaintRevision++}
          onapply={(frame,ease)=>editRememberedPaint(false,true,typeof axis==='number'?{property:'gradientStopEasing',stop:axis,frame,value:ease}:{property:`${axis}KeyEases`,frame,value:ease})}/>
      {/key}
    {/key}
  {/if}
</details>
<p aria-label="Saved remembered symbol paint easing">{savedPaintSummary}</p>
<MotionEasing bind:value={()=>existingPaintEase,(value)=>{existingPaintRevision++;existingPaintEase=value;}} label="Existing symbol paint easing" />
<button onclick={()=>editRememberedPaint()}>Apply paint easing to remembered symbol motion</button>
<button onclick={()=>editRememberedPaint(true)}>Remove remembered symbol paint override</button>
<small>Apply/Remove edits only the saved paint channel. Saved paint interpolation is required; creation preferences stay separate.</small>
<p aria-label="Saved remembered symbol opacity easing">{savedOpacitySummary}</p>
<MotionEasing bind:value={()=>existingOpacityEase,(value)=>{existingOpacityRevision++;existingOpacityEase=value;}} label="Existing symbol opacity easing" />
<button disabled={rememberedBatch&&!selectedTracks.length} onclick={()=>editRememberedOpacity()}>Apply opacity easing to remembered symbol motion</button>
<button disabled={rememberedBatch&&!selectedTracks.length} onclick={()=>editRememberedOpacity(true)}>Remove remembered symbol opacity override</button>
<small>Apply changes the selected saved opacity curves. Remove inherits each recipe's global easing; creation preferences stay separate.</small>
      <label><input type="checkbox" aria-label="Remember current symbol contour correspondence" bind:checked={rememberedCorrespondence} />Capture current contour alignment, node hints and resampling</label>
<label><input type="checkbox" aria-label="Remember current symbol rotation and groups" bind:checked={rememberedRotation} />Remember current symbol rotation and groups</label>
<label><input type="checkbox" aria-label="Remember current symbol motion path" bind:checked={rememberedPath} />Remember current symbol motion path</label>
<label><input type="checkbox" aria-label="Remembered symbol motion saved pivots" bind:checked={rememberedOptions.pivots}/>Interpolate saved pivots</label>
<label><input type="checkbox" aria-label="Remembered symbol motion default pivots" bind:checked={rememberedOptions.defaultPivots}/>Resolve missing pivots from authoring-box defaults (requires pivot interpolation)</label>
<label><input type="checkbox" aria-label="Remembered symbol motion scale and skew" bind:checked={rememberedOptions.affine} />Remember scale and skew</label>
<label><input type="checkbox" aria-label="Remembered symbol motion paint colors" bind:checked={rememberedOptions.paint} />Remember paint colors</label>
<label><input type="checkbox" aria-label="Remembered symbol motion matching nodes" bind:checked={rememberedOptions.nodes} />Remember matching nodes</label>
<label><input type="checkbox" aria-label="Remembered symbol motion primitive geometry" bind:checked={rememberedOptions.primitives} />Remember primitive geometry</label>
<label><input type="checkbox" aria-label="Remembered symbol motion stroke color" bind:checked={rememberedOptions.strokeColor}/>Animate stroke color with geometry timing</label>
<label><input type="checkbox" aria-label="Remembered symbol motion stroke width" bind:checked={rememberedOptions.strokeWidth} />Remember stroke width</label>
<label><input type="checkbox" aria-label="Remembered symbol motion gradient geometry" bind:checked={rememberedOptions.gradientGeometry} />Remember gradient geometry</label>
<label><input type="checkbox" aria-label="Remembered symbol motion gradient basis" bind:checked={rememberedOptions.gradientBasis} />Remember gradient basis</label>
<label><input type="checkbox" aria-label="Remembered symbol motion reject area collapse" bind:checked={rememberedOptions.contourAreas} />reject area collapse</label>
<label><input type="checkbox" aria-label="Remembered symbol motion reject segment collapse" bind:checked={rememberedOptions.contourEdges} />reject segment collapse</label>
<label><input type="checkbox" aria-label="Remembered symbol motion reject segment contacts" bind:checked={rememberedOptions.contourContacts} />reject segment contacts</label>
<label><input type="checkbox" aria-label="Remembered symbol motion reject stationary or reversing tangents" bind:checked={rememberedOptions.curveTangents} />reject stationary or reversing tangents</label>
<label><input type="checkbox" aria-label="Remembered symbol motion reject single-curve self contacts" bind:checked={rememberedOptions.curveSelfContacts} />reject single-curve self contacts</label>
<label><input type="checkbox" aria-label="Remembered symbol motion resample gradient stops" bind:checked={rememberedOptions.gradientStops} />Resample gradient stops (requires paint)</label>
<label><input type="checkbox" aria-label="Remembered symbol motion ordered gradient stops" bind:checked={rememberedGradientOrder} />Match stop groups in order (requires gradient geometry)</label>
<label>Gradient group pairs <input aria-label="Remembered symbol motion gradient group pairs" bind:value={rememberedGradientPairs} placeholder="0:0, 1:1 or auto" /></label>
<label><input type="checkbox" aria-label="Remembered symbol motion opacity-weighted gradient colors" bind:checked={rememberedOptions.gradientPremultiplied} />Opacity-weighted gradient colors (requires paint)</label>
<small>Saved guards require matching nodes. They reject unsafe or unresolved interpolation using the existing bounded checks; they do not certify full topology.</small>
<small>These options apply to new recipes. Refresh and retime use saved options. Nodes require matching topology; paths, group motion, matching hints, custom easing and topology guards are not stored by these controls.</small>
<label><input type="checkbox" bind:checked={rememberedBatch} />Remembered motion on checked symbol tracks</label>
      {#if !junction&&junctionIds.length}
        <p>Selected artwork at frame {frame+1}: <output aria-label="Selected symbol artwork">{junctionIds.join(', ')}</output></p>
      {/if}
      {#if junction}
        <fieldset disabled={!writable||playing}>
          <legend>Shared motion endpoint</legend>
          {#if junctionNode?.scope===junctionScope&&junctionIds.includes(junctionNode.shapeId)}<p>{#if junctionNode.part}{`Authored ${junctionNode.part==='in'?'incoming':'outgoing'} tangent at ${junctionNode.contour!==undefined?'contour '+(junctionNode.contour+1)+', ':''}anchor ${junctionNode.index+1} selected in ${junctionNode.shapeId}.`}{:else}{`Authored ${junctionNode.contour!==undefined?'contour '+(junctionNode.contour+1)+' anchor':'Bezier anchor'} ${junctionNode.index+1} selected in ${junctionNode.shapeId}.`}{/if}</p>{/if}
          {#if authoredPivot}<label>Authored pivot X<input aria-label="Authored symbol pivot X" readonly value={Math.round(authoredPivot.x*100)/100}/></label><label>Authored pivot Y<input aria-label="Authored symbol pivot Y" readonly value={Math.round(authoredPivot.y*100)/100}/></label>{/if}
          <label>Shared-key artwork<select multiple aria-label="Symbol shared endpoint artwork" value={junctionIds}
            onchange={e=>{junctionPick={scope:junctionScope,ids:Array.from(e.currentTarget.selectedOptions,o=>o.value)}}}>
            {#each artwork as item (item.id)}<option value={item.id}>{item.kind} · {item.id}</option>{/each}
          </select></label>
          <label>Move X<input type="number" step="any" aria-label="Symbol shared endpoint X offset" bind:value={junctionDx}/></label>
          <label>Move Y<input type="number" step="any" aria-label="Symbol shared endpoint Y offset" bind:value={junctionDy}/></label>
          <button disabled={!junctionIds.length||(!junctionDx&&!junctionDy)} onclick={moveJunction}>Move symbol endpoint and refresh both spans</button>
          <label>Rotate degrees<input type="number" step="any" aria-label="Symbol shared endpoint rotation" bind:value={junctionAngle}/></label>
          <button disabled={!junctionIds.length||!Number.isFinite(junctionAngle)||!junctionAngle||junctionAngle%360===0} onclick={()=>transformJunction('rotate')}>Rotate symbol endpoint and refresh both spans</button>
          <label>Scale X %<input type="number" step="any" aria-label="Symbol shared endpoint X scale" bind:value={junctionScaleX}/></label>
          <label>Scale Y %<input type="number" step="any" aria-label="Symbol shared endpoint Y scale" bind:value={junctionScaleY}/></label>
          <button disabled={!junctionIds.length||!Number.isFinite(junctionScaleX)||!Number.isFinite(junctionScaleY)||!junctionScaleX||!junctionScaleY||(junctionScaleX===100&&junctionScaleY===100)} onclick={()=>transformJunction('scale')}>Scale symbol endpoint and refresh both spans</button>
          <label>Skew axis<select aria-label="Symbol shared endpoint skew axis" bind:value={junctionSkewAxis}><option value="x">Document X</option><option value="y">Document Y</option></select></label>
          <label>Skew degrees<input type="number" step="any" aria-label="Symbol shared endpoint skew angle" bind:value={junctionSkewAngle}/></label>
          <button disabled={!junctionIds.length||!Number.isFinite(junctionSkewAngle)||!junctionSkewAngle||junctionSkewAngle%180===0} onclick={()=>transformJunction('skew')}>Skew symbol endpoint and refresh both spans</button>
          <small>Scaling and skew require compatible saved affine interpolation; recipe options stay unchanged.</small>
          <small>Uses the common saved pivot or combined authoring-box center. Both saved recipes and the enclosing library must admit the result.</small>
        </fieldset>
      {/if}
      <button onclick={() => rememberedMotion('create')}>Create remembered symbol motion</button>
      <button onclick={() => rememberedMotion('refresh')}>Refresh remembered symbol motion</button>
<button disabled={rememberedBatch && !selectedTracks.length} onclick={() => rememberedMotion('ease')}>Apply easing to remembered symbol motion</button>
<button disabled={rememberedBatch && !selectedTracks.length} title="Use the current rotation direction and extra turns. Keep each track’s saved group and pivot settings." onclick={()=>rememberedMotion('spin')}>Apply direction and turns to remembered symbol motion</button>
<button disabled={!activeSavedPath} onclick={()=>{if(activeSavedPath)motionPath=clone(activeSavedPath)}}>Load active track’s saved path</button>
<button disabled={!motionPath || (rememberedBatch && !selectedTracks.length)} onclick={()=>rememberedMotion('path')}>Apply path to remembered symbol motion</button>
<button disabled={rememberedBatch && !selectedTracks.length} onclick={()=>rememberedMotion('clearPath')}>Remove path from remembered symbol motion</button>
      <button onclick={() => rememberedMotion('detach')}>Detach remembered symbol motion</button>
      <label><input type="checkbox" bind:checked={rememberedRipple} />Shift following symbol keys and remembered spans</label>
<label>New span or chain frame count<input type="number" min="3" step="1" aria-label="Remembered symbol motion frame count" bind:value={rememberedLength} /></label>
      <button onclick={() => rememberedMotion('retime')}>Retime remembered symbol motion</button>
<label>Per-span frame counts<input aria-label="Remembered symbol motion per-span frame counts" bind:value={rememberedSpanLengths} placeholder="5, 9" /></label>
<small>Optional counts override the total above, in span order. Shared endpoints count once. Leave blank for proportional retiming.</small>
<label>Destination track<select aria-label="Remembered symbol motion destination track" bind:value={rememberedDestinationLayer}><option value="">Same track(s)</option>{#each layers as target (target.id)}<option value={target.id}>{target.name}</option>{/each}</select></label>
<label>Move span or connected chain to frame<input type="number" min="1" step="1" aria-label="Remembered symbol motion destination frame" bind:value={rememberedDestination} /></label>
<button onclick={() => rememberedMotion('move')}>Move remembered symbol motion</button>
<button onclick={() => rememberedMotion('exchange')}>Exchange remembered symbol motion</button>
<small>Exchange requires equal-length complete remembered chains. Same track(s) can exchange checked tracks together; all must validate before any change. A cross-track exchange requires one source track. On the same track, ranges must not overlap or share endpoints. Across tracks, both must be visible, unlocked and use the same drawing mode. Conflicting identities and edited interiors reject the whole exchange.</small>
<label>Promote interior frame<input type="number" min="1" step="1" aria-label="Remembered symbol motion split frame" bind:value={rememberedSplit} /></label>
<label><input type="checkbox" aria-label="Preserve simple symbol motion when splitting" bind:checked={preserveRememberedSplit} />Preserve simple trajectory when splitting (including supported paths)</label>
<button onclick={() => rememberedMotion('split')}>Split and regenerate remembered symbol motion</button>
<button title="Use the current endpoint poses, then split without changing the refreshed motion. All generated keys must be unedited." onclick={()=>rememberedMotion('promote')}>Refresh and promote pose in remembered symbol motion</button>
<label>Preserved cut frames<input aria-label="Remembered symbol motion cut frames" bind:value={rememberedCuts} placeholder="5, 9, 13" /></label>
<button onclick={() => rememberedMotion('subdivide')}>Subdivide remembered symbol motion</button>
<small>Enter increasing symbol frame numbers, separated by commas. Each section needs at least three frames including shared endpoints. Supported trajectories are preserved together in the isolated draft; Apply saves the result.</small>
<button onclick={() => rememberedMotion('reverse')}>Reverse remembered symbol motion</button>
<small>Reverse an isolated complete chain of unchanged recipes and its exact keys, deriving easing and frozen path controls. Outside holds remain. Groups support uniform or independent-axis scaling/shear; custom/saved pivots support paths and custom pivots need a shared transformed offset. Node matching reverses explicit hint pairs. Tangent rotation can reverse on single cubics and straight waypoint paths with equal-time or distance timing. At a waypoint corner, the outgoing segment controls rotation. Reversal rejects a corner frame if its pose would change. Refresh the span if its stored keys no longer regenerate exactly. Reversal checks every generated pose.</small>
<small>Preserve mode keeps all existing keys and derives easing for each half. Requires unchanged position/rotation/opacity motion, optionally with exactly reconstructable fill/stroke/gradient colors (including opacity-weighted blending and fixed-offset, ordered or explicit moving-stop matching) and stop opacity, primitive dimensions/corner radius, stroke width, matching contour nodes/handles, gradient endpoints/stop positions, and individual artwork/gradient scale and skew, with Linear, Ease in, Ease out, midpoint Ease in-out, or custom cubic easing with representable subdivided controls. Numerically unresolved subdivisions and changed rounded paint colors reject. Supported paths: a parameter-timed cubic, a single or waypoint distance-timed cubic route whose rebuilt distance tables reconstruct every pose, distance-timed straight waypoints, or equal-time straight/curved waypoints at existing boundaries or exactly resolved uniform subdivisions (up to 32 parts per segment and 256 total). Path leaders and ungrouped artwork must share endpoint displacement. Directed extra turns support individual affine bases and require shared turn counts per half. Explicit gradient pairs are remapped through distinct split groups; automatic matching freezes shared resolved pairs for both halves. Rigid groups support leader-pivot rotation/translation and uniform positive scaling with supported paths. Independent-axis scaling/rotation derives right-half shear in the split basis. Saved or custom pivots support pathless, parameter-cubic or equal-time waypoint group motion; pivot paths require shared leader correction; custom pivots must share one transformed offset across groups. Contour order/start/direction stays on the right half only. Symbol playback phases must reconstruct exactly. Straight, parameter-based or distance-based curve matching is retained on both halves when node partitions reconstruct exactly. Explicit hints remap through shared expanded anchor indices. Single tangent cubics and straight waypoint routes can split at nonzero headings when both halves reproduce the stored rotation. At corner cuts the promoted key keeps the outgoing heading. Equal-time curved waypoint tangent routes also support nonzero headings at existing or exactly representable uniform subdivision boundaries; distance-timed curved tangent routes can split at nonzero headings when both rebuilt tables reproduce every pose. Distance pivot paths require exactly zero leader correction and full reconstruction.</small>
<small>With preserve mode off, promotes this key to a shared endpoint and reapplies saved easing, path, rotation and correspondence separately to each half. This can change the trajectory and repeat extra turns. Only the split key may have edits; each half needs at least three frames.</small>
      <small>Moves the target and regenerates interiors within the existing duration. By default, outside keys stay fixed and collisions reject. Optional shifting moves following keys and saved spans; edited following interiors or duration overflow reject. Button frame mappings stay fixed.</small>
      <small>Refresh and detach require the exact saved range on every chosen track. Refresh uses each saved easing. Automatic refresh is off by default.</small>
      {#each symbolLayers(draft).find(l => l.id === layerId)?.motionSpans ?? [] as span (span.id)}
        <button onclick={() => { rangeStart = span.start + 1; rangeEnd = span.end + 1; }}>Select remembered symbol frames {span.start + 1}–{span.end + 1}</button>
        <small>{typeof span.ease === 'string' ? span.ease : 'Custom cubic'}{span.autoRefresh ? ' · automatic' : ''}: {JSON.stringify(symbolLayers(draft).find(l => l.id === layerId)!.keys.filter(k => k.frame > span.start && k.frame < span.end)) === span.baseline ? 'Generated keys unchanged' : 'Generated keys changed — detach to preserve edits'}</small>
      {/each}
    </fieldset>
    <label
      >Retimed length<input
        type="number"
        min="1"
        max="10000"
        aria-label="Retimed symbol range length"
        bind:value={retimeLength}
      /></label
    >
    <button onclick={() => retimeRange()}>Retime symbol frame range</button>
    <p>
      Scales exposure timing and shifts following keys on edited tracks. Compression leaves a blank
      tail and rejects collapsed keys. Button state frame numbers stay fixed.
    </p>
    <button onclick={() => copyRange()}>Copy symbol frame range</button>
    <button onclick={() => copyRange(true)}>Cut symbol frame range</button>
    <button onclick={clearRange}>Clear symbol frame range</button
    >
    <label
      >Destination layer<select aria-label="Symbol range destination layer" bind:value={rangeTrack}>
        <option value="">Current layer</option>
        {#each layers as track}<option value={track.id}>{track.name}</option>{/each}
      </select></label
    >
    <label
      >Destination frame<input
        type="number"
        min="1"
        max="10000"
        aria-label="Symbol range destination frame"
        bind:value={rangeDestination}
      /></label
    >
    <button onclick={() => transferRange(false)}>Copy symbol range to destination</button>
    <button onclick={() => transferRange(true)}>Move symbol range to destination</button>
    <p>
      Transfers require blank destination time and nonoverlapping ranges on the same layer. Move
      leaves blank source frames. Later destinations extend duration without shifting other keys.
    </p>
    <label
      >Insert at<input
        type="number"
        min="1"
        max={duration + 1}
        aria-label="Symbol frame range insertion"
        bind:value={insertAt}
      /></label
    >
    <button
      disabled={!clipboard}
      onclick={() =>
        mutate(() => {
          draft = insertSymbolFrames(draft, layerId, insertAt - 1, clipboard!, symbols, assets);
          frame = insertAt - 1;
        }, false)}>Insert copied symbol frames</button
    >
    <p>
      {clipboard ? `${clipboard.duration} copied frames` : 'No copied frames'}. Cut/clear leave
      blank frames. Remove shifts later frames on this layer left and can shorten the timeline when
      the selection reaches the end. Duplicate inserts a copy after the range. Insert shifts this layer and
      extends shared duration; other layers keep their key positions.
    </p>
  </fieldset>
  <fieldset disabled={playing}>
    <legend>Apply range to multiple layers</legend>
    <p>Uses From/Through above. Locked or hidden selected layers reject the entire edit.</p>
    <button
      onclick={() => {
        selectedTracks = layers.map((l) => l.id);
      }}>Select all symbol tracks</button
    >
    <button
      onclick={() => {
        selectedTracks = [];
      }}>Clear symbol track selection</button
    >
    {#each layers as track (track.id)}
      <label
        ><input
          type="checkbox"
          aria-label={`Include symbol track ${track.name}`}
          checked={selectedTracks.includes(track.id)}
          onchange={(e) => {
            selectedTracks = e.currentTarget.checked
              ? [...selectedTracks, track.id]
              : selectedTracks.filter((id) => id !== track.id);
          }}
        />{track.name}</label
      >
    {/each}
    {#each selectedTracks as sourceId (sourceId)}
      <label
        >Span from {layers.find((l) => l.id === sourceId)?.name ?? 'missing layer'} →
        <select
          aria-label={`Symbol span destination ${sourceId}`}
          value={spanDestinations[sourceId] ?? sourceId}
          onchange={(e) => {
            spanDestinations = { ...spanDestinations, [sourceId]: e.currentTarget.value };
          }}
        >
          {#if !layers.some((l) => l.id === (spanDestinations[sourceId] ?? sourceId))}<option
              value={spanDestinations[sourceId] ?? sourceId}>Missing layer</option
            >{/if}
          {#each layers as target}<option value={target.id}>{target.name}</option>{/each}
        </select>
      </label>
    {/each}
    <button
      disabled={!selectedTracks.length}
      onclick={() => {
        spanDestinations = {};
      }}>Reset symbol span destinations</button
    >
    <button disabled={!selectedTracks.length} onclick={() => transferTracks(false)}
      >Copy selected symbol spans to destination</button
    >
    <button disabled={!selectedTracks.length} onclick={() => transferTracks(true)}
      >Move selected symbol spans to destination</button
    >
    <p>
      Span transfers use Destination frame above and the routes shown here. Destinations must be
      unique and blank. Moves may swap selected tracks: sources are captured and cleared together
      before placement. One invalid route rejects the whole operation.
    </p>
    <button disabled={!selectedTracks.length} onclick={() => copyTracks()}
      >Copy selected symbol tracks</button
    >
    <button disabled={!selectedTracks.length} onclick={() => copyTracks(true)}
      >Cut selected symbol tracks</button
    >
    {#if trackClipboard}
      <button
        onclick={() => {
          trackDestinations = trackClipboard!.tracks.map((t) => t.layerId);
        }}>Reset symbol track destinations</button
      >
      {#each trackClipboard.tracks as copied, index (copied.layerId)}
        <label
          >Copied {layers.find((l) => l.id === copied.layerId)?.name ?? 'removed layer'} →
          <select
            aria-label={`Copied symbol track ${index + 1} destination`}
            value={trackDestinations[index]}
            onchange={(e) => {
              trackDestinations = trackDestinations.map((id, i) =>
                i === index ? e.currentTarget.value : id,
              );
            }}
          >
            {#if !layers.some((l) => l.id === trackDestinations[index])}<option
                value={trackDestinations[index]}>Missing original layer</option
              >{/if}
            {#each layers as target (target.id)}<option value={target.id}>{target.name}</option
              >{/each}
          </select>
        </label>
      {/each}
    {/if}
    <button disabled={!trackClipboard} onclick={() => pasteTracks()}
      >Insert copied symbol tracks</button
    >
    <p>
      {trackClipboard
        ? `${trackClipboard.tracks.length} copied tracks, ${trackClipboard.tracks[0].clip.duration} frames`
        : 'No copied tracks'}. Insert uses Insert at above and the original copied layers,
      regardless of current checkboxes.
    </p>
    <button disabled={!selectedTracks.length} onclick={() => bulkRange('clear')}
      >Clear range on selected symbol tracks</button
    >
    <button disabled={!selectedTracks.length} onclick={() => bulkRange('duplicate')}
      >Duplicate range on selected symbol tracks</button
    >
    <button onclick={() => mutate(() => { draft = editSymbolTracks(draft, [layerId], rangeStart - 1, rangeEnd - 1, 'keys'); })}>Key every symbol frame in range</button>
    <button disabled={!selectedTracks.length} onclick={() => bulkRange('keys')}>Key every frame on checked symbol tracks</button>
    <button disabled={!selectedTracks.length} onclick={() => generateMotion(true)}>Generate motion on checked symbol tracks</button>
    <p>Copies held artwork into explicit keys; nested playback is not baked.</p>
    <button disabled={!selectedTracks.length} onclick={() => bulkRange('reverse')}
      >Reverse range on selected symbol tracks</button
    >
    <button disabled={!selectedTracks.length} onclick={() => retimeRange(true)}
      >Retime range on selected symbol tracks</button
    >
    <button disabled={!selectedTracks.length} onclick={() => bulkRange('remove')}
      >Remove range on selected symbol tracks</button
    >
    <p>
      {selectedTracks.length} tracks selected. Duplicate extends shared duration once. Remove leaves blank
      tails without moving unselected layers.
    </p>
  </fieldset>
  {#if error}<p role="alert">{error}</p>{/if}
  <footer>
    <button disabled={!past.length} onclick={() => undo()}>Undo symbol timeline change</button>
    <button disabled={!future.length} onclick={() => undo(true)}>Redo symbol timeline change</button
    >
    <button onclick={() => void leaveLocalSource(applyTimelineDraft)}>Apply symbol timeline</button
    ><button onclick={cancel}>Cancel symbol timeline</button>
  </footer>
</dialog>
{#if editing}
  <SymbolEditor
    navigate={navigateContext && context && JSON.stringify(draft) === JSON.stringify(definition)
      ? (id) => navigateContext!(id, { layerId, frame })
      : undefined}
    definition={{ ...draft, shapes: clone(artwork) }}
    hierarchyOwner={JSON.stringify([hierarchyOwner,layerId,frame,rangeArtwork,rangeStart,rangeEnd])}
    context={context ? symbolTrackEditContext(context, draft, layerId, frame, symbols) : undefined}
    {assets}
    {symbols}
    simplify={frameSimplifyAvailable()?prepareFrameSimplify:undefined}
    frameSimplify={frameSimplifyAvailable()}
    validate={validateFrameArtwork}
    apply={applyFrameArtwork}
    cancel={() => void closeFrameArtwork()}
  />
{/if}

<style>
  dialog {
    width: min(650px, 90vw);
    max-height: 90vh;
    overflow: auto;
    background: var(--surface-dark);
    color: var(--surface-text);
    border: 1px solid #777;
    border-radius: 8px;
    padding: 20px;
  }
  dialog::backdrop {
    background: #0009;
  }
  .motion-stage {
    position: relative;
    width: 540px;
    max-width: 100%;
  }
  canvas {
    display: block;
    max-width: 100%;
    height: auto;
  }
  label {
    display: inline-flex;
    gap: 8px;
    margin: 8px;
  }
  input {
    width: 90px;
  }
  button {
    margin: 4px;
    padding: 8px;
  }
  footer {
    margin-top: 16px;
  }
</style>

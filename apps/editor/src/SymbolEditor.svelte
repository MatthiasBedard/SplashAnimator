<script module lang="ts">
  let artworkClipboard = $state<import('../../../packages/document/src').Vector[]>([]);
</script>

<script lang="ts">
  import { appendHistory, HistoryEntry, moveHistory } from '../../../packages/document/src/history-storage';
  import CanvasTextEditor from './CanvasTextEditor.svelte';
  import { fontFamilyForRendering } from '../../../packages/geometry/src/font-family';
  import DynamicTextBinding from './DynamicTextBinding.svelte';
  import TextFontControls from './TextFontControls.svelte';
  import {measureTextField,textObjectProperties} from './text-authoring';
  import ToolIcon from './ToolIcon.svelte';
  import {drawLayerOutline,DEFAULT_LAYER_OUTLINE} from './layer-outline';
  import {connectedAnchorSets} from './subselection';
  import {captureAttachedFillEdit,type AttachedFillEdit} from '../../../packages/geometry/src/attached-fill';
  import {pickBendEdge,bendEdge} from '../../../packages/geometry/src/edge-bend';
  import { healDeletedInk, joinRecoloredFills } from '../../../packages/geometry/src/join-recolored-fills';
  import {simplifySymbolArtworkInWorker} from './geometry-worker';
  import type {StaticSymbolSimplifyContext} from './symbol-simplify-context';
  import {captureIsolatedSymbolSimplifyContext,replaceIsolatedSymbolGroup} from './isolated-symbol-simplify-context';
  import {validateLiveGraphicData} from '../../../packages/document/src/live-motion';
  import {selectionTrajectoryStamp as simplifyStamp} from '../../../packages/animation/src/selection-trajectory';
  import {assertSymbolSimplifyDetached} from '../../../packages/geometry/src/symbol-simplify-owner';
  import NumberSlider from './NumberSlider.svelte';
  import { wrapDialogTab } from './dialog-focus';
  import { inkContour, inkSegment, contourInkPlan } from '../../../packages/geometry/src/ink-contour';
  import { getContext, onMount, onDestroy, untrack } from 'svelte';
  import { createCanvasTouch } from './canvas-touch';
  import { canvasZoomChoices, canvasZoomPercent, clampCanvasZoom } from './stage-view';
  import { EDITOR_PREFERENCES_CONTEXT, loadEditorPreferences, type EditorPreferences } from './editor-preferences';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import HierarchyPlacement, {type HierarchyTarget} from './HierarchyPlacement.svelte';
  import { inScope, selectionUnit, reparentVectors } from '../../../packages/document/src/groups';
  import SymbolEditor from './SymbolEditor.svelte';
  import { inversePoint, mapPoint, multiply, type Matrix } from '../../../packages/geometry/src/affine';
  import { rangeHandleTransform } from '../../../packages/geometry/src/range-handles';
  import type { SymbolEditContext } from '../../../packages/geometry/src/symbol-context';
  import {
    clone,
    MAX_VECTOR_POINTS,
    id,
    type Project,
    type SymbolDefinition,
    type Vector,
    type BezierNode,
    type Point,
    type Brush,
  } from '../../../packages/document/src';
  import { expandSymbols, symbolInstance } from '../../../packages/geometry/src/symbols';
  import { containsPoint } from '../../../packages/geometry/src/drawing';
  import { BrushSamples, stabilizeSample } from '../../../packages/interaction/src';
  import { editorCoalescedEvents, editorPointer, sampleEditorPointer } from './editor-pointer';
  import { brushContactOpacity } from '../../../packages/geometry/src/pressure';
  import BrushContactOpacity from './BrushContactOpacity.svelte';
  import {
    reconcileStyledText,
    formatTextRange,
    type TextStyle,
  } from '../../../packages/geometry/src/rich-text';
  import { wrapText } from '../../../packages/geometry/src/text-layout';
  import { paintStyledText } from '../../../packages/stage/src/rich-text';
  import { drawShape } from '../../../packages/stage/src';
  import {
    scaleVector,
    hit,
    hitPart,
    normalizeVector,
    localPoint,
    worldPoint,
  } from '../../../packages/geometry/src';
  import {
    editSymbolChildren,
    isolateSymbolGroup,
    copySymbolChildren,
    pasteSymbolChildren,
    moveSymbolChildren,
    transformSymbolChildren,
    symbolTransformPivot,
    symbolTransformBounds,
    affineSymbolChildren,
    drawnSymbolPrimitive,
    drawnSymbolPencil,
    symbolBrushMergeStart,
    symbolStrokeCandidates,
  } from '../../../packages/geometry/src/symbol-artwork';
  import {
    continueBezier,
    insertAnchor,
    moveAnchors,
    moveTangent,
    convertAnchors,
    deleteAnchors,
  } from '../../../packages/geometry/src/nodes';
  import {
    editGradientStop,
    addGradientStop,
    removeGradientStop,
    transformGradient,
    shapeGradient,
    gradientPoint,
    gradientStopPoint,
    moveGradientStop,
    gradientAxis,
    moveGradientAxis,
  } from '../../../packages/geometry/src/gradient';
  import {
    transformBitmap,
    bitmapHandle,
    moveBitmapHandle,
  } from '../../../packages/geometry/src/bitmap';
  import type { BrushPaintMode } from '../../../packages/geometry/src/brush-paint';
  import { mergeInWorker, brushInWorker, createDrawingWorkerPreparation, pencilInWorker, shapeInWorker, connectedStrokesInWorker } from './geometry-worker';
  import { BrushPreview } from '../../../packages/stage/src/brush-preview';
  import { hitCurve } from '../../../packages/geometry/src/curve-hit';
  import { penPreview, penEndpoint } from '../../../packages/geometry/src/pen-preview';
  import { penAnchorAction, penAnchorCursor, preparePenAnchorEdit } from './pen-anchor-edit';
  import { smoothPath } from '../../../packages/geometry/src/path-edit';
  import { objectBounds } from '../../../packages/geometry/src/layout';
  import CanvasScrollbars from './CanvasScrollbars.svelte';
  import { createCanvasPan } from './canvas-pan';
  import { bindingFor, shortcutForKey, shortcutText, toolShortcut, type ShortcutOverrides } from './editor-shortcuts';
  import { symbolWorkspaceTools, type SymbolCanvasTool, type SymbolDrawingSettings } from './symbol-drawing-settings';
  const preferences = getContext<(() => EditorPreferences) | undefined>(EDITOR_PREFERENCES_CONTEXT) ?? loadEditorPreferences;
  const initialPreferences = untrack(preferences);
  let {
    definition,
    embedded = false,
    shortcutOverrides = {},
    macShortcuts = false,
    readOnly = false,
    playbackTracks,
    stageCamera,
    viewport = $bindable({ scale: 1, pan: { x: 0, y: 0 } }),
    canvasTool = $bindable('select'),
    newFill = $bindable('#6366f1'),
    newStroke = $bindable('#000000'),
    newLineWidth = $bindable(2),
    brushWidth = $bindable(initialPreferences.brushSize),
    brushSimplify = $bindable(initialPreferences.brushSmoothing),
    brushLockToCanvas = $bindable(!initialPreferences.brushScreenSize),
    brushOptimize = $bindable(initialPreferences.brushOptimize),
    brushObjects = $bindable(false),
    contactOpacityEnabled = $bindable(initialPreferences.pressureOpacity === 'initial'),
    strokeOpacityEnabled = $bindable(initialPreferences.pressureOpacity === 'continuous'),
    contactOpacityMinimum = $bindable(initialPreferences.contactOpacityMinimum),
    contactOpacityResponse = $bindable(initialPreferences.contactOpacityResponse),
    removeCoveredStrokes = $bindable(initialPreferences.removeCoveredStrokes),
    pencilMode = $bindable('smooth'),
    pencilSimplify = $bindable(initialPreferences.pencilSmoothing),
    pencilOptimize = $bindable(initialPreferences.pencilOptimize),
    pencilObjects = $bindable(false),
    outline=false,outlineColor=DEFAULT_LAYER_OUTLINE,
    historyCommand,
    assets,
    symbols,
    apply,
    simplify,
    frameSimplify = false,
    validate,
    cancel,
    isolated = false,
    hierarchyOwner,
    context,
    returnTo,
    returnName,
    navigate,
  }: Partial<SymbolDrawingSettings> & {
    definition: SymbolDefinition;
    embedded?: boolean;
    shortcutOverrides?: ShortcutOverrides;
    macShortcuts?: boolean;
    readOnly?: boolean;
    playbackTracks?: { artwork: Vector[]; outlineColor?: string }[];
    stageCamera?: {x:number;y:number;zoom:number};
    viewport?: { scale: number; pan: { x: number; y: number } };
    outline?:boolean;outlineColor?:string;
    historyCommand?:(redo:boolean)=>void;
    assets: Project['assets'];
    symbols: SymbolDefinition[];
    apply: (shapes: Vector[], admit?:()=>void) => string | null;
    simplify?: (shapes:Vector[]) => StaticSymbolSimplifyContext;
    frameSimplify?: boolean;
    validate: (shapes: Vector[]) => void;
    cancel: () => void;
    isolated?: boolean;
    hierarchyOwner?: string;
    context?: SymbolEditContext;
    returnTo?: () => string | null;
    returnName?: string;
    navigate?: (instanceId: string) => string | null;
  } = $props();
  const previewOnly = untrack(() => playbackTracks !== undefined);
  let artwork = $state<Vector[]>(untrack(() => clone(definition.shapes)));
  let selected = $state(untrack(() => artwork[0]?.id ?? '')),
    error = $state('');
  let textRange = $state<{ owner: string; content: string; start: number; end: number } | null>(
    null,
  );
  let rangeFont = $state('sans-serif'),
    rangeSize = $state(32),
    rangeColor = $state('#000000');
  function captureTextRange(element: HTMLTextAreaElement) {
    textRange = {
      owner: selected,
      content: element.value,
      start: element.selectionStart,
      end: element.selectionEnd,
    };
  }
  function setTextColor(color:string) {
    if(inlineText){inlineTextEditor?.format({color});return;}
    change(s=>{if(!s.text)return;s.fill=color;delete s.gradient;delete s.bitmap;s.text.runs=formatTextRange(s.text.content,s.text.runs??[],0,s.text.content.length,{color:undefined});measureText(s);});
  }
  function styleTextRange(patch: TextStyle) {
    if(inlineText&&inlineTextEditor){inlineTextEditor.format(patch);return;}
    if (!hasTextRange || !textRange || !shape?.text) return;
    try {
      setText({
        runs: formatTextRange(
          shape.text.content,
          shape.text.runs ?? [],
          textRange.start,
          textRange.end,
          patch,
        ),
      });
    } catch (e) {
      error = String(e);
    }
  }
  let groupTransform = $state({ dx: 0, dy: 0, rotation: 0, scaleX: 100, scaleY: 100 });
  let hierarchyCustomPivot=$state(false);
  let hierarchyTransformPivot=$state({x:0,y:0});
  let libraryId = $state('');
  let penSmoothing = $state(false);
  let brushSmooth = $state(true);
  let eyedropperSource = $state<'stored' | 'object' | 'rendered'>('stored');
  let keepEyedropper = $state(false);
  let gradientMove = $state({ x: 0, y: 0, rotation: 0, scale: 100 });
  let gradientShape = $state({ aspect: 100, skew: 0 });
  let bitmapMove = $state({
    dx: 0,
    dy: 0,
    rotation: 0,
    scaleX: 100,
    scaleY: 100,
    skewX: 0,
    skewY: 0,
  });
  let bucketGap = $state(0);
  let brushPressure = $state(initialPreferences.pressureSize),
    brushTilt = $state(initialPreferences.tiltNib),
    brushTwist = $state(initialPreferences.twistNib);
  let brushMinimum = $state(initialPreferences.minimumSize * 100),
    brushResponse = $state(initialPreferences.brushResponse),
    brushAspect = $state(100),
    brushAngle = $state(0),
    brushStabilization = $state(initialPreferences.stabilization);
  let brushPaintMode = $state<BrushPaintMode>('normal');
  let brushBusy = $state(false);
  let brushStatus = $state('');
  let contourInk = $state(false), segmentInk = $state(false);
  let connectedContours = $state(false);
  let connectedInk = $state(false),
    inkBusy = $state(false);
  let inkEpoch = 0, queuedInk = $state(false);
  let strokeSelectionJob=$state.raw<{controller:AbortController;current:()=>boolean}|null>(null);
  let strokeSelectionInfo=$state('');
  function cancelStrokeSelection(){
    const job=strokeSelectionJob;strokeSelectionJob=null;
    if(job){job.controller.abort();inkBusy=false;strokeSelectionInfo='Connected line selection cancelled.';}
  }
  async function selectConnectedSymbolStrokes(event:MouseEvent){
    if(event.button!==0||!['select','hierarchy'].includes(canvasTool)||hierarchyPointerBlocked||simplifyJob||drag||hierarchyMove||hierarchyPick||penGesture||nodeGesture||paintGesture||nodeMarquee)return;
    const picked=[...artwork].reverse().find(s=>hit(s,point(event),4/view.scale)),p=point(event);
    if(!picked||picked.groups?.length||['brush','text','symbol'].includes(picked.kind)||!picked.strokeWidth||hitPart(picked,p,4/view.scale)!=='stroke')return;
    event.preventDefault();canvas.focus({preventScroll:true});
    const controller=new AbortController();
    let job:NonNullable<typeof strokeSelectionJob>|undefined;
    try{
      validateLiveGraphicData(artwork);
      const source=artwork,signature=JSON.stringify(artwork),boundary=hierarchyBoundary,active=selected,
        ids=JSON.stringify(hierarchySelectedIds),mode=canvasTool,oldPast=past,oldFuture=future,validator=validate,
        rect=hierarchyRect(),layout=JSON.stringify(view);
      const current=()=>alive&&!controller.signal.aborted&&strokeSelectionJob===job&&artwork===source&&JSON.stringify(artwork)===signature&&hierarchyBoundary===boundary&&selected===active&&canvasTool===mode&&past===oldPast&&future===oldFuture&&validate===validator&&JSON.stringify(hierarchySelectedIds)===ids&&hierarchyRect()===rect&&JSON.stringify(view)===layout;
      job={controller,current};strokeSelectionJob=job;inkBusy=true;strokeSelectionInfo='Finding connected lines…';
      const snapshot=structuredClone($state.snapshot(artwork));validate(snapshot);
      if(!current())throw Error('Original symbol stroke selection changed.');
      const candidates=symbolStrokeCandidates(snapshot,picked.id);
      const result=await connectedStrokesInWorker(candidates,picked.id,p,4/view.scale,controller.signal);
      if(!current())throw Error('Original symbol stroke selection changed.');
      if(!result.includes(picked.id))throw Error('The original stroke pick changed.');
      if(selected!==picked.id){preserveHierarchyOnce=true;selected=picked.id;}
      hierarchySelection=[...result];nodeSelection=[];acrossNodes={};error='';
      strokeSelectionInfo=`Selected ${result.length} connected lines`;
    }catch(cause){if(strokeSelectionJob===job&&!controller.signal.aborted){error=String(cause);strokeSelectionInfo='';}}
    finally{if(strokeSelectionJob===job){strokeSelectionJob=null;inkBusy=false;}}
  }
  $effect(()=>{if(strokeSelectionJob&&!strokeSelectionJob.current())cancelStrokeSelection();});
  type QueuedBrush = { kind: 'brush'; stroke: Vector; view: typeof view; amount: number; optimize: boolean; objects: boolean; mode: BrushPaintMode; selected: string; removeCoveredStrokes: boolean };
  type QueuedPencil = { kind: 'pencil'; stroke: Vector; view: typeof view; mode: typeof pencilMode; amount: number; optimize: boolean; objects: boolean };
  type QueuedShape = { kind: 'shape'; stroke: Vector; view: typeof view; smoothPen?: boolean };
  type QueuedPaint = { kind: 'paint'; tool: 'bucket' | 'ink'; point: Point; view: typeof view; radius: number;
    fill: string; color: string; width: number; gap: number; contour: boolean; segment: boolean; connected: boolean; connectedContours: boolean };
  type DrawingJob = QueuedBrush | QueuedPencil | QueuedShape | QueuedPaint;
  let drawingQueue = $state.raw<DrawingJob[]>([]);
  let liveMark = $state.raw<Vector | null>(null);
  let liveBrush = $state<Vector | null>(null);
  let brushSampleRevision = $state(0);
  const brushPreview = new BrushPreview(() => { if (alive) paint(); });
  const brushWorker = createDrawingWorkerPreparation();
  let alive = true;
  onDestroy(() => {
    brushWorker.cancel();
    cancelStrokeSelection();
    cancelHierarchyPick();cancelHierarchyMove();
    alive = false;
    drawingQueue = [];
    cancelSimplification();
    brushPreview.clear();
    brushScene = undefined;
    cancelSymbolHierarchyDrag();
  });
  type Snapshot = { artwork: Vector[]; selected: string; hierarchy?:string[] };
  let preserveHierarchyOnce=false;
  let past = $state.raw<HistoryEntry<Snapshot>[]>([]),
    future = $state.raw<HistoryEntry<Snapshot>[]>([]);
  let dialog: HTMLElement, canvas: HTMLCanvasElement;
  let stageWidth=$state(0),stageHeight=$state(0);
  const canvasWidth=$derived(embedded&&stageCamera?Math.max(1,Math.round(stageWidth*(devicePixelRatio||1))):540);
  const canvasHeight=$derived(embedded&&stageCamera?Math.max(1,Math.round(stageHeight*(devicePixelRatio||1))):330);

  type InlineTextSession={source:Vector[];stamp:string;oldPast:HistoryEntry<Snapshot>[];oldFuture:HistoryEntry<Snapshot>[];boundary:string;validator:typeof validate;shape:Vector;owner?:string;point?:Point;view:typeof view};
  let inlineTextStyle=$state<TextStyle>({});
  let inlineText=$state.raw<InlineTextSession|null>(null),inlineTextPreview=$state<Vector|null>(null),inlineTextEditor=$state<CanvasTextEditor>(),inlineTextView=$state.raw<import('../../../packages/geometry/src/affine').Matrix>([1,0,0,1,0,0]);
  let inlineTextPress:{pointer:number;start:Point;source:string}|null=null;
  function beginInlineText(original?:Vector,p?:Point,wrapWidth?:number){
    if(readOnly||drag||brushBusy||inkBusy||penDraft||simplifyJob)return;
    try{
      const source=original?clone(original):{id:id(),kind:'text' as const,x:p!.x,y:p!.y,width:1,height:38.4,rotation:0,fill:newFill,stroke:newStroke,strokeWidth:0,points:[],text:{content:'',font:'Arial',size:32,bold:false,italic:false,align:'left' as const,wrapWidth:wrapWidth??0}};
      const field=original?source:measureTextField(canvas.getContext('2d')!,source);
      inlineText={source:artwork,stamp:JSON.stringify(artwork),oldPast:past,oldFuture:future,boundary:hierarchyBoundary,validator:validate,shape:field,owner:original?.id,point:p,view:{...view}};
      inlineTextPreview=field;selected=field.id;hierarchySelection=null;error='';
    }catch(cause){error=String(cause);}
  }
  function finishInlineText(field:Vector,admit:()=>void):string|null{
    try{
      const session=inlineText;if(!session)throw Error('Text editor closed.');
      const input=JSON.stringify(field),active=()=>{admit();if(!alive||inlineText!==session||artwork!==session.source||JSON.stringify(artwork)!==session.stamp||past!==session.oldPast||future!==session.oldFuture||hierarchyBoundary!==session.boundary||validate!==session.validator||JSON.stringify(field)!==input)throw Error('The original symbol text source or editing context changed.');};
      active();const before={artwork:clone(artwork),selected:session.owner??''},next=clone(artwork),index=next.findIndex(v=>v.id===session.owner);
      if(session.owner){if(index<0)throw Error('Original text disappeared.');if(field.text!.content)next[index]=clone(field);else next.splice(index,1);}else if(field.text!.content)next.push(clone(field));
      validateLiveGraphicData(next);const output=JSON.stringify(next);session.validator(next);active();const nextPast=appendHistory(past, new HistoryEntry<Snapshot>(before));active();if(JSON.stringify(next)!==output)throw Error('Prepared symbol text changed.');
      if(output!==session.stamp){artwork=next;past=nextPast;future=[];}
      selected=field.text!.content?field.id:'';inlineText=null;inlineTextPreview=null;error='';return null;
    }catch(cause){return String(cause);}
  }
  const shape = $derived(inlineTextPreview ?? artwork.find((s) => s.id === selected)!);
  const hasTextRange = $derived(
    !!textRange &&
      textRange.owner === selected &&
      textRange.content === shape?.text?.content &&
      textRange.end > textRange.start,
  );

  type NumericField = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity' | 'strokeWidth';
  const fields: NumericField[] = [
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'opacity',
    'strokeWidth',
  ];
  let view = { left: 0, top: 0, scale: 1 };
  let workspaceZoom = $state(1);
  const minCanvasZoom = $derived(preferences().minCanvasZoom);
  const maxCanvasZoom = $derived(preferences().maxCanvasZoom);
  const workspaceZoomChoices = $derived(canvasZoomChoices(workspaceZoom, minCanvasZoom, maxCanvasZoom));
  let cameraBase: { zoom: number; origin: Point } | undefined;
  let canvasPanButtons = $state<1 | 4>();
  let spaceHand = $state(false);
  let temporarySelectionHeld = $state(false);
  let temporarySelectionPointer = $state<number | null>(null);
  const freehandSelectionTool = $derived(canvasTool === 'pen' || canvasTool === 'pencil' || canvasTool === 'brush');
  const paintTool = $derived(canvasTool === 'bucket' || canvasTool === 'ink');
  const temporarySelectionTool = $derived(freehandSelectionTool || paintTool);
  const temporaryHand = $derived.by(() => spaceHand && canNavigateCanvas());
  const temporarySelectionCursor = $derived(temporarySelectionPointer !== null || (temporarySelectionHeld && canUseTemporarySelection()));
  function canUseTemporarySelection() {
    return temporarySelectionTool && !readOnly && !canvasPanButtons && canNavigateCanvas();
  }
  function canNavigateCanvas(touch = false) {
    return (embedded || touch) && !brushBusy && !inkBusy && !drag && !nodeGesture && !nodeMarquee && !paintGesture && !penGesture &&
      !penDraft && !inlineText && !inlineTextPress && !hierarchyMove && !simplifyJob;
  }
  function setWorkspaceZoom(next: number, anchor?: Point, target = anchor, touch = false) {
    if (!canNavigateCanvas(touch) || !cameraBase || !Number.isFinite(next)) return;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    stopCanvasPan();
    const zoom = clampCanvasZoom(next, minCanvasZoom, maxCanvasZoom);
    const ratio = zoom / (cameraBase.zoom * viewport.scale);
    const at = anchor ?? { x: box.width / 2, y: box.height / 2 };
    const destination = target ?? at;
    const origin = {
      x: cameraBase.origin.x + viewport.pan.x,
      y: cameraBase.origin.y + viewport.pan.y,
    };
    viewport = {
      scale: viewport.scale * ratio,
      pan: {
        x: viewport.pan.x + (at.x - origin.x) * (1 - ratio) + destination.x - at.x,
        y: viewport.pan.y + (at.y - origin.y) * (1 - ratio) + destination.y - at.y,
      },
    };
  }
  function wheelWorkspaceZoom(e: WheelEvent) {
    if (!embedded || (!preferences().wheelZoom && !e.ctrlKey && !e.metaKey) || canvasTouch.active) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1);
    setWorkspaceZoom((cameraBase?.zoom ?? 1) * viewport.scale * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002),
      { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }
  function fitWorkspace() {
    if (!canNavigateCanvas()) return;
    canvasTouch.end();
    stopCanvasPan();
    if (!stageCamera || !context || !cameraBase) {
      const baseZoom = cameraBase?.zoom ?? 1;
      viewport = { scale: clampCanvasZoom(baseZoom, minCanvasZoom, maxCanvasZoom) / baseZoom, pan: { x: 0, y: 0 } };
      return;
    }
    const box = canvas.getBoundingClientRect();
    const zoom = clampCanvasZoom(Math.min(1, (box.width - 100) / context.width,
      (box.height - 90) / context.height), minCanvasZoom, maxCanvasZoom);
    viewport = { scale: zoom / cameraBase.zoom, pan: {
      x: (box.width - context.width * zoom) / 2 - cameraBase.origin.x,
      y: (box.height - context.height * zoom) / 2 - cameraBase.origin.y,
    }};
  }
  function queuedSymbolTool(value: SymbolCanvasTool) {
    return value === 'brush' || value === 'pencil' || value === 'pen' ||
      value === 'line' || value === 'rectangle' || value === 'ellipse' || value === 'bucket' || value === 'ink';
  }
  function chooseCanvasTool(next: SymbolCanvasTool) {
    if (readOnly || (brushBusy && !(drawingQueue.length && queuedSymbolTool(next))) || inkBusy || simplifyJob) return;
    cancelDrag(); cancelHierarchyPick(); cancelHierarchyMove(); discardPen();
    canvasTool = next;
  }
  const canvasNavigation = createCanvasPan({
    surface: () => canvas,
    blocked: () => !canNavigateCanvas(),
    point: event => ({ x: event.clientX, y: event.clientY }),
    position: () => viewport.pan,
    apply: pan => { viewport = { ...viewport, pan }; },
    setButtons: buttons => { canvasPanButtons = buttons; },
  });
  const stopCanvasPan = canvasNavigation.end;
  const canvasTouch = createCanvasTouch({
    surface: () => canvas,
    mode: () => preferences().singleTouch,
    pinch: () => preferences().pinchZoom,
    blocked: () => !cameraBase || !canNavigateCanvas(true) || !!canvasPanButtons,
    context: () => JSON.stringify([definition.id, context?.artworkFrame, canvasWidth, canvasHeight,
      stageWidth, stageHeight, preferences().singleTouch, preferences().pinchZoom]),
    point: event => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    navigate: (ratio, from, to) => setWorkspaceZoom((cameraBase?.zoom ?? 1) * viewport.scale * ratio, from, to, true),
    cancelTool: () => { inlineTextPress = null; cancelDrag(); cancelHierarchyPick(); cancelHierarchyMove(); discardPen(); },
  });
  let nodeIndex = $state(0);
  let nodeSelection = $state<number[]>([0]);
  let acrossArtwork = $state(false);
  let acrossNodes = $state<Record<string, number[]>>({});
  let nodeFocusId = $state('');
  function nodeItems() {
    return acrossArtwork
      ? artwork.filter(
          (s) =>
            !s.groups?.length && (s.kind === 'path' || s.kind === 'bezier' || s.kind === 'polygon'),
        )
      : shape
        ? [shape]
        : [];
  }
  function nodeSets() {
    return Object.fromEntries(nodeItems().map((s) => [s.id, selectedNodes(s)]));
  }
  function setNodeSets(sets: Record<string, number[]>) {
    if (acrossArtwork) acrossNodes = sets;
    else nodeSelection = sets[selected] ?? [];
  }
  function nodeCount() {
    return nodeItems().reduce((count, s) => count + selectedNodes(s).length, 0);
  }
  function selectAllNodes() {
    setNodeSets(
      Object.fromEntries(nodeItems().map((s) => [s.id, editableNodes(s).map((_, i) => i)])),
    );
  }
  function moveNodeSets(
    next: Vector[],
    before: Vector[],
    sets: Record<string, number[]>,
    dx: number,
    dy: number,
  ) {
    const targets = new Map(next.map((s) => [s.id, s]));
    for (const original of before) {
      const indices = sets[original.id];
      if (!indices?.length) continue;
      const a = localPoint(original, { x: 0, y: 0 }),
        b = localPoint(original, { x: dx, y: dy });
      const target = targets.get(original.id)!;
      moveAnchors(target, original, joinedNodeIndices(original,indices), b.x - a.x, b.y - a.y);
    }
  }
  $effect(() => {
    void selected;
    textRange = null;
    untrack(() => {
      if (nodeMarquee) cancelDrag();
    });
    nodeIndex = 0;
    nodeSelection = [0];
    acrossNodes = {};
    nodeFocusId = selected;
  });
  function selectedNodes(s = shape) {
    const nodes = s ? editableNodes(s) : [];
    return (acrossArtwork ? (acrossNodes[s?.id] ?? []) : nodeSelection).filter((i) => !!nodes[i]);
  }
  let nodeRegionForm = $state<'box' | 'lasso'>('box');
  let nodeMarquee: {
    pointer: number;
    start: { x: number; y: number };
    end: { x: number; y: number };
    original: Vector;
    source: Vector[];
    previous: Record<string, number[]>;
    form: typeof nodeRegionForm;
    ring: { x: number; y: number }[];
    mode: 'replace' | 'add' | 'subtract' | 'intersect';
    view: typeof view;
  } | null = null;
  type NodeEdit = {
    pointer:number;start:Point;before:Snapshot;original:Vector;part:'anchor'|'in'|'out'|'edge';sets:Record<string,number[]>;view:typeof view;
    edge?:NonNullable<ReturnType<typeof pickBendEdge>>;attached:AttachedFillEdit;index:number;
    source:Vector[];signature:string;beforeStamp:string;boundary:string;revision:number;validator:typeof validate;oldPast:HistoryEntry<Snapshot>[];oldFuture:HistoryEntry<Snapshot>[];box:{x:number;y:number;width:number;height:number};
  };
  let nodeGesture:NodeEdit|null=null;
  function joinedNodeIndices(original:Vector,indices:number[]){
    const nodes=original.nodes??original.points,last=nodes.length-1;
    if(original.drawingMode!=='merge'||original.contours||!original.closed||last<1||nodes[0].x!==nodes[last].x||nodes[0].y!==nodes[last].y)return indices;
    return indices.includes(0)||indices.includes(last)?[...new Set([...indices,0,last])]:indices;
  }
  function captureNodeEdit(pointer:number,start:Point,original:Vector,part:NodeEdit['part'],sets:Record<string,number[]>,edge?:NodeEdit['edge']):NodeEdit{
    validateLiveGraphicData(artwork);
    const source=artwork,signature=simplifyStamp($state.snapshot(source)),boundary=hierarchyBoundary,revision=simplifyInputRevision,validator=validate,oldPast=past,oldFuture=future;
    const before={artwork:structuredClone($state.snapshot(source)),selected,hierarchy:[...hierarchySelectedIds]},box=canvas.getBoundingClientRect();
    assertSymbolSimplifyDetached(source,before.artwork);
    const moving=part==='anchor'?connectedAnchorSets(before.artwork,sets):sets;
    const g:NodeEdit={pointer,start,before,original:structuredClone($state.snapshot(original)),part,sets:clone(moving),view:{...view},edge,attached:captureAttachedFillEdit(before.artwork.filter(s=>s.drawingMode==='merge'),part==='anchor'?Object.entries(moving).filter(([,indices])=>indices.length).map(([id])=>id):[original.id],true),index:nodeIndex,
      source,signature,beforeStamp:simplifyStamp(before.artwork),boundary,revision,validator,oldPast,oldFuture,box:{x:box.x,y:box.y,width:box.width,height:box.height}};
    currentNodeEdit(g);return g;
  }
  function currentNodeEdit(g:NodeEdit){
    validateLiveGraphicData(g.source);validateLiveGraphicData(g.before.artwork);
    const box=canvas.getBoundingClientRect();
    if(!alive||selected!==g.before.selected||nodeIndex!==g.index||hierarchyBoundary!==g.boundary||simplifyInputRevision!==g.revision||validate!==g.validator||past!==g.oldPast||future!==g.oldFuture||
      simplifyStamp($state.snapshot(g.source))!==g.signature||simplifyStamp(g.before.artwork)!==g.beforeStamp||box.x!==g.box.x||box.y!==g.box.y||box.width!==g.box.width||box.height!==g.box.height)
      throw Error('Original node artwork, input or context changed. Start a new edit.');
  }
  function withNodeAttachments(next:Vector[],g:NodeEdit){
    const updates=new Map(g.attached.prepare(next).map(s=>[s.id,s]));
    const result=next.map(s=>updates.get(s.id)??s);validateLiveGraphicData(result);currentNodeEdit(g);return result;
  }
  function publishNodeEdit(g:NodeEdit,candidate:Vector[]){
    try{
      currentNodeEdit(g);validateLiveGraphicData(candidate);
      const input=simplifyStamp(candidate),next=structuredClone($state.snapshot(candidate));assertSymbolSimplifyDetached(candidate,next);currentNodeEdit(g);
      if(simplifyStamp(next)!==input||simplifyStamp(candidate)!==input)throw Error('Prepared node copy changed.');
      if(simplifyStamp(next)===g.beforeStamp){artwork=g.before.artwork;return;}
      for(const edited of next)if((g.part==='anchor'?g.sets[edited.id]?.length:edited.id===g.original.id)&&!edited.contours)normalizeVector(edited);
      validateLiveGraphicData(next);const expected=simplifyStamp(next);g.validator(next);
      const nextPast=appendHistory(g.oldPast, new HistoryEntry<Snapshot>(g.before)),changed=JSON.stringify(g.before.artwork)!==JSON.stringify(next);
      currentNodeEdit(g);validateLiveGraphicData(next);if(simplifyStamp(next)!==expected)throw Error('Prepared node candidate changed.');
      artwork=changed?next:g.before.artwork;if(changed){past=nextPast;future=[];}error='';
    }catch(cause){error=String(cause);}
  }
  let paintGesture: {
    pointer: number;
    start: { x: number; y: number };
    before: Snapshot;
    original: Vector;
    part: 'origin' | 'x' | 'y' | number;
    view: typeof view;
  } | null = null;
  function paintHandle(s: Vector, part: 'origin' | 'x' | 'y' | number) {
    if (typeof part === 'number') return gradientStopPoint(s.gradient!, part);
    if (s.gradient)
      return part === 'origin'
        ? s.gradient.from
        : part === 'x'
          ? gradientPoint(s.gradient, s.gradient.to)
          : gradientAxis(s.gradient);
    return bitmapHandle(s.bitmap!, part);
  }
  function bitmapDown(e: PointerEvent) {
    if (!shape || (canvasTool === 'gradient' ? !shape.gradient : !shape.bitmap)) return;
    const p = point(e);
    const parts: ('origin' | 'x' | 'y' | number)[] = [
      ...(shape.gradient ? shape.gradient.stops.map((_, i) => i).reverse() : []),
      'origin',
      'x',
      'y',
    ];
    const part = parts.find((part) => {
      const q = worldPoint(shape, paintHandle(shape, part));
      if (typeof part === 'number') q.y += 14 / view.scale;
      return Math.hypot(q.x - p.x, q.y - p.y) < (typeof part === 'number' ? 6 : 8) / view.scale;
    });
    if (part === undefined) return;
    paintGesture = {
      pointer: e.pointerId,
      start: p,
      before: { artwork: clone(artwork), selected },
      original: clone(shape),
      part,
      view: { ...view },
    };
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function bitmapDragMove(e: PointerEvent) {
    const g = paintGesture;
    if (!g || g.pointer !== e.pointerId) return;
    const p = point(e);
    if (e.shiftKey) {
      if (Math.abs(p.x - g.start.x) >= Math.abs(p.y - g.start.y)) p.y = g.start.y;
      else p.x = g.start.x;
    }
    const start = localPoint(g.original, g.start),
      end = localPoint(g.original, p),
      original = paintHandle(g.original, g.part);
    try {
      const next = clone(g.before.artwork),
        target = next.find((s) => s.id === g.original.id)!;
      const destination = { x: original.x + end.x - start.x, y: original.y + end.y - start.y };
      if (g.original.gradient) {
        const gradient = g.original.gradient;
        if (typeof g.part === 'number')
          target.gradient = moveGradientStop(gradient, g.part, destination);
        else if (g.part === 'origin')
          target.gradient = transformGradient(gradient, end.x - start.x, end.y - start.y, 0, 1);
        else if (g.part === 'y') target.gradient = moveGradientAxis(gradient, destination);
        else {
          const to = gradientPoint(gradient, destination, true);
          if (
            ![to.x, to.y].every((v) => Number.isFinite(v) && Math.abs(v) <= 100000) ||
            Math.hypot(to.x - gradient.from.x, to.y - gradient.from.y) < 1e-6
          )
            throw new Error('Gradient endpoint must remain finite and distinct from its origin.');
          target.gradient = { ...clone(gradient), to };
        }
      } else if (typeof g.part !== 'number')
        target.bitmap = moveBitmapHandle(g.original.bitmap!, g.part, destination);
      artwork = next;
      error = '';
    } catch (e) {
      artwork = clone(g.before.artwork);
      error = String(e);
    }
  }
  function editableNodes(s: Vector): BezierNode[] {
    return (s.contours?.flat() ?? s.nodes ?? s.points) as BezierNode[];
  }
  function nodeCommand(mode: 'smooth' | 'corner' | 'delete') {
    const sets = nodeSets();
    if (!nodeCount()) return;
    change(() => {
      for (const s of nodeItems()) {
        const indices = sets[s.id];
        if (!indices?.length) continue;
        if (mode === 'delete') {
          if (!deleteAnchors(s, indices))
            throw new Error('Keep at least two open-path or three closed-ring anchors.');
        } else {
          if (!s.nodes && !s.contours)
            throw new Error('Choose a Bezier path or fill contour for tangent conversion.');
          convertAnchors(s, indices, mode);
        }
        if (!s.contours) normalizeVector(s);
      }
    });
    if (!error && mode === 'delete') {
      nodeIndex = 0;
      nodeSelection = [0];
      acrossNodes = {};
    }
  }
  function nodeDown(e: PointerEvent) {
    if (!shape) return;
    const p = point(e),
      items = nodeItems();
    const focus = acrossArtwork ? items.find((s) => s.id === nodeFocusId) : shape;
    const targets: {
      shape: Vector;
      index: number;
      part: 'anchor' | 'in' | 'out';
      p: { x: number; y: number };
    }[] = [];
    const n = focus && editableNodes(focus)[nodeIndex];
    for (const part of ['in', 'out'] as const)
      if (focus && n?.[part])
        targets.push({ shape: focus, index: nodeIndex, part, p: worldPoint(focus, n[part]!) });
    for (const s of [...items].reverse())
      editableNodes(s).forEach((n, index) =>
        targets.push({ shape: s, index, part: 'anchor', p: worldPoint(s, n) }),
      );
    const found = targets.find((t) => Math.hypot(t.p.x - p.x, t.p.y - p.y) < 7 / view.scale);
    if (!found) {
      const curve =
        e.altKey && !e.shiftKey
          ? [...items]
              .reverse()
              .map((s) => ({ s, hit: hitCurve(s, p, 7 / view.scale) }))
              .find((candidate) => candidate.hit)
          : undefined;
      const foreground=[...artwork].reverse().find(s=>hit(s,p,2/view.scale));
      const bend=!e.altKey&&!e.shiftKey?[...items].reverse().filter(s=>!foreground||s.id===foreground.id).map(s=>({s,edge:pickBendEdge(s,p,7/view.scale)})).find(item=>item.edge):undefined;
      if(bend?.edge){
        try{nodeIndex=bend.edge.index;nodeFocusId=bend.s.id;setNodeSets({[bend.s.id]:[bend.edge.index,bend.edge.end]});nodeGesture=captureNodeEdit(e.pointerId,p,bend.s,'edge',nodeSets(),bend.edge);canvas.setPointerCapture(e.pointerId);}
        catch(cause){error=String(cause);}
        canvas.focus({preventScroll:true});e.preventDefault();return;
      }
      if (curve?.hit) {
        let inserted: number | undefined;
        change(() => {
          inserted = insertAnchor(
            artwork.find((s) => s.id === curve.s.id)!,
            curve.hit!.index,
            curve.hit!.t,
          );
        });
        if (!error && inserted !== undefined) {
          nodeIndex = inserted;
          nodeFocusId = curve.s.id;
          setNodeSets({ [curve.s.id]: [inserted] });
        }
      } else {
        nodeMarquee = {
          pointer: e.pointerId,
          start: p,
          end: p,
          original: shape,
          source: artwork,
          previous: nodeSets(),
          form: nodeRegionForm,
          ring: [p],
          mode:
            e.shiftKey && e.altKey
              ? 'intersect'
              : e.altKey
                ? 'subtract'
                : e.shiftKey
                  ? 'add'
                  : 'replace',
          view: { ...view },
        };
        canvas.setPointerCapture(e.pointerId);
        paint();
      }
      canvas.focus({ preventScroll: true });
      e.preventDefault();
      return;
    }
    nodeFocusId = found.shape.id;
    if (found.part === 'anchor' && e.shiftKey) {
      const sets = nodeSets(),
        indices = selectedNodes(found.shape);
      sets[found.shape.id] = indices.includes(found.index)
        ? indices.filter((i) => i !== found.index)
        : [...indices, found.index];
      setNodeSets(sets);
      nodeIndex = sets[found.shape.id].includes(found.index)
        ? found.index
        : (sets[found.shape.id][0] ?? 0);
      canvas.focus({ preventScroll: true });
      e.preventDefault();
      return;
    }
    if (!selectedNodes(found.shape).includes(found.index))
      setNodeSets({ [found.shape.id]: [found.index] });
    nodeIndex = found.index;
    try{nodeGesture=captureNodeEdit(e.pointerId,p,found.shape,found.part,nodeSets());}
    catch(cause){error=String(cause);return;}
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function updateNodeRegion(e: PointerEvent) {
    const g = nodeMarquee;
    if (!g || g.pointer !== e.pointerId) return false;
    if (shape !== g.original || artwork !== g.source) {
      cancelDrag();
      return false;
    }
    g.end = point(e);
    const last = g.ring[g.ring.length - 1];
    if (g.form === 'lasso' && Math.hypot(last.x - g.end.x, last.y - g.end.y) >= 1 / g.view.scale) {
      if (g.ring.length >= 1024) {
        cancelDrag();
        error = 'Anchor lasso cancelled: use at most 1,024 sampled points.';
        return false;
      }
      g.ring.push(g.end);
    }
    return true;
  }
  function nodeMove(e: PointerEvent) {
    if (!nodeGesture || nodeGesture.pointer !== e.pointerId) return;
    const g = nodeGesture,
      p = point(e);
    if (e.shiftKey) {
      if (Math.abs(p.x - g.start.x) >= Math.abs(p.y - g.start.y)) p.y = g.start.y;
      else p.x = g.start.x;
    }
    try{
      currentNodeEdit(g);
      if(p.x===g.start.x&&p.y===g.start.y){artwork=g.before.artwork;return;}
      let next=structuredClone($state.snapshot(g.before.artwork));const target=next.find(s=>s.id===g.original.id)!;
      if(g.edge){const bent=bendEdge(g.edge.outline,g.edge.index,g.edge.t,{x:p.x-g.start.x,y:p.y-g.start.y});next=next.map(s=>s.id===bent.id?bent:s);}
      else if(g.part==='anchor')moveNodeSets(next,g.before.artwork,g.sets,p.x-g.start.x,p.y-g.start.y);
      else{
        const handle=editableNodes(g.original)[g.index][g.part as 'in'|'out']!,origin=worldPoint(g.original,handle),q=localPoint(g.original,{x:origin.x+p.x-g.start.x,y:origin.y+p.y-g.start.y});
        moveTangent(target,g.original,g.index,g.part as 'in'|'out',q,e.altKey);
      }
      artwork=withNodeAttachments(next,g);
    }catch(cause){cancelDrag();error=String(cause);}
  }
  let penDraft = $state<Vector | null>(null);
  let penSource = $state<Vector | null>(null);
  let penHover = $state<{ x: number; y: number } | null>(null);
  let penHoverAlt = $state(false);
  let penHoverShift = $state(false);
  function symbolPenAnchorAction(p: Point) {
    if (!shape || shape.groups?.length || !canUseTemporarySelection()) return;
    const action = penAnchorAction(shape, p, view.scale);
    if (!action) return;
    for (let i = artwork.length - 1; i >= 0; i--) {
      const item = artwork[i];
      if (hit(item, p, 0)) return item.id === shape.id ? action : undefined;
    }
    return action;
  }
  const penAnchorHover = $derived.by(() =>
    canvasTool === 'pen' && penHover && !penHoverAlt && !temporarySelectionCursor
      ? symbolPenAnchorAction(penHover) : undefined,
  );
  let penView: typeof view | null = null;
  let penGesture: {
    pointer: number;
    start: { x: number; y: number };
    before: Vector | null;
  } | null = null;
  function discardPen() {
    penGesture = null;
    penDraft = null;
    penSource = null;
    penHover = null;
    penView = null;
  }
  function finishPen(closed = false) {
    if (penGesture || !penDraft || (penDraft.nodes?.length ?? 0) < 2) return;
    const result = clone(penDraft);
    const source = penSource;
    if (source && !closed && JSON.stringify(result) === JSON.stringify(source)) {
      discardPen();
      return;
    }
    result.closed = closed;
    if (!source) result.fillEnabled = closed;
    const drawingView = penView ?? view;
    discardPen();
    if (!source) {
      enqueueDrawing({ kind: 'shape', stroke: result, view: drawingView, smoothPen: penSmoothing });
      return;
    }
    if (penSmoothing) smoothPath(result);
    normalizeVector(result);
    change(() => {
      artwork = artwork.map(s => s.id === result.id ? result : s);
      selected = result.id;
    });
  }
  function penDown(e: PointerEvent) {
    const p = point(e),
      target = penDraft && penPreview(penDraft, p, view.scale, e.shiftKey ? 45 : 0);
    if (penDraft && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      const radius = 4 / view.scale;
      if (target?.kind === 'segment' && !hit(penDraft, p, radius) &&
          !artwork.some(shape => hit(shape, p, radius))) finishPen();
      return;
    }
    if (!e.altKey) {
      const action = symbolPenAnchorAction(p);
      if (action) {
        e.preventDefault();
        canvas.focus({ preventScroll: true });
        if (action.kind !== 'blocked') change(original => {
          validateLiveGraphicData(original);
          const replacement = preparePenAnchorEdit(original, action);
          if (replacement) Object.assign(original, replacement);
        });
        return;
      }
    }
    if (!brushBusy && !penDraft && shape && !e.altKey) {
      const endpoint = penEndpoint(shape, p, view.scale);
      const prepared = endpoint && continueBezier(shape, endpoint.index);
      if (prepared) {
        penDraft = prepared;
        penSource = clone(prepared);
        penView = { ...view };
        penHover = p;
        canvas.focus({ preventScroll: true });
        e.preventDefault();
        return;
      }
    }
    if (target?.kind === 'close') {
      finishPen(true);
      return;
    }
    if (target?.kind === 'corner') {
      delete penDraft!.nodes!.at(-1)!.out;
      return;
    }
    if ((penDraft?.nodes?.length ?? 0) >= 4096) {
      error = 'Finish this path before adding more than 4096 anchors.';
      return;
    }
    const before = penDraft ? clone(penDraft) : null;
    if (!penDraft) {
      penView = { ...view };
      penDraft = {
        id: id(),
        kind: 'bezier',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        fill: newFill,
        fillEnabled: false,
        stroke: newStroke,
        strokeWidth: newLineWidth,
        points: [],
        nodes: [],
        closed: false,
      };
    }
    penDraft.nodes!.push(localPoint(penDraft, target?.to ?? p));
    penGesture = { pointer: e.pointerId, start: p, before };
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function penMove(e: PointerEvent) {
    if (!penGesture || penGesture.pointer !== e.pointerId || !penDraft) return;
    const p = point(e),
      n = penDraft.nodes!.at(-1)!,
      origin = worldPoint(penDraft, n);
    let dx = p.x - penGesture.start.x,
      dy = p.y - penGesture.start.y;
    if (Math.hypot(dx, dy) * view.scale < 2) return;
    if (e.shiftKey) {
      const angle = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4,
        radius = Math.hypot(dx, dy);
      dx = Math.cos(angle) * radius;
      dy = Math.sin(angle) * radius;
    }
    n.out = localPoint(penDraft, { x: origin.x + dx, y: origin.y + dy });
    if (!e.altKey) n.in = { x: 2 * n.x - n.out.x, y: 2 * n.y - n.out.y };
  }
  let drag:
    | {
        pointer: number;
        x: number;
        y: number;
        before: Snapshot;
        view: typeof view;
        picked: string;
        kind: Exclude<
          typeof canvasTool,
          'text' | 'pen' | 'nodes' | 'ink' | 'eyedropper' | 'bucket' | 'bitmap' | 'gradient' | 'hierarchy' | 'hierarchy-move' | 'hierarchy-rotate' | 'hierarchy-scale' | 'hierarchy-skew'
        >;
        fill: string;
        stroke: string;
        lineWidth: number;
        samples: Point[];
        brush: Brush;
        stabilization: number;
        pencilMode: typeof pencilMode;
        pencilOptimize: boolean;
        pencilSimplify: number;
        pencilObjects: boolean;
        brushOptimize: boolean;
        brushMode: BrushPaintMode;
        brushObjects: boolean;
        brushAmount: number;
        axis?: 'x' | 'y';
      }
    | undefined;
  function cancelDrag() {
    if (liveBrush) brushWorker.cancel();
    temporarySelectionPointer = null;
    cancelStrokeSelection();
    liveBrush = null;
    liveMark = null;
    if (inkBusy) {
      inkEpoch++;
      inkBusy = false;
    }
    if (nodeMarquee) {
      const g = nodeMarquee;
      nodeMarquee = null;
      if (canvas.hasPointerCapture(g.pointer)) canvas.releasePointerCapture(g.pointer);
      paint();
    }

    if (paintGesture) {
      const g = paintGesture;
      paintGesture = null;
      artwork = g.before.artwork;
      selected = g.before.selected;
      if (canvas.hasPointerCapture(g.pointer)) canvas.releasePointerCapture(g.pointer);
    }

    if (nodeGesture) {
      const g = nodeGesture;
      nodeGesture = null;
      artwork = g.before.artwork;
      selected = g.before.selected;
      if (canvas.hasPointerCapture(g.pointer)) canvas.releasePointerCapture(g.pointer);
    }
    if (penGesture) {
      const old = penGesture;
      penGesture = null;
      penDraft = old.before;
      if (!penDraft) penView = null;
      if (canvas.hasPointerCapture(old.pointer)) canvas.releasePointerCapture(old.pointer);
    }
    if (!drag) return;
    const old = drag;
    drag = undefined;
    if (old.kind === 'select') {
      artwork = old.before.artwork;
      selected = old.before.selected;
    }
    if (canvas.hasPointerCapture(old.pointer)) canvas.releasePointerCapture(old.pointer);
    paint();
  }
  function point(e: MouseEvent, box = canvas.getBoundingClientRect()) {
    const v =
        hierarchyMove?.view ??
        nodeMarquee?.view ??
        paintGesture?.view ??
        nodeGesture?.view ??
        drag?.view ??
        penView ??
        view;
    const p = {
      x: (((e.clientX - box.left) * canvasWidth) / box.width - 20) / v.scale + v.left,
      y: (((e.clientY - box.top) * canvasHeight) / box.height - 20) / v.scale + v.top,
    };
    return context ? inversePoint(context.matrix, p) : p;
  }
  async function prepareQueuedPaint(input: Vector[], job: QueuedPaint) {
    const frontToBack = [...input].reverse();
    const picked = frontToBack.find(shape => hit(shape, job.point, 0)) ??
      frontToBack.find(shape => hit(shape, job.point, job.radius));
    if (picked && (picked.kind === 'symbol' || picked.kind === 'text' || picked.groups?.length)) return input;
    if (job.tool === 'bucket') {
      if (picked && hitPart(picked, job.point, 0) === 'fill') {
        picked.fill = job.fill;
        delete picked.gradient;
        delete picked.bitmap;
        if (picked.drawingMode === 'merge') {
          const joined = joinRecoloredFills(input, [picked.id]);
          if (joined !== input) {
            try { validate(joined); }
            catch { return input; }
            return joined;
          }
        }
        return input;
      }
      const start = symbolBrushMergeStart(input), eligible = input.slice(start);
      const paint: Vector = {
        id: id(), kind: 'polygon', x: 0, y: 0, width: 0, height: 0, rotation: 0,
        fill: job.fill, fillEnabled: true, stroke: '#000000', strokeWidth: 0, points: [],
      };
      const [region] = await mergeInWorker(eligible, undefined, undefined, { paint, point: job.point, gap: job.gap });
      if (!region) throw Error('No enclosed region here. Close the outline or increase gap tolerance.');
      const prefix = input.slice(0, start);
      const artwork = [region, ...eligible];
      const joined = joinRecoloredFills(artwork, [region.id]);
      if (joined !== artwork) {
        const candidate = [...prefix, ...joined];
        try { validate(candidate); return candidate; }
        catch { return [...prefix, ...artwork]; }
      }
      return [...prefix, ...artwork];
    }
    if (!picked) return input;
    if (job.contour || job.segment) {
      const pieces = (job.segment ? inkSegment : inkContour)(picked, job.point, job.color, job.width, job.radius);
      if (pieces) input.splice(input.indexOf(picked), 1, ...pieces);
    } else if (job.connected) {
      if (hitPart(picked, job.point, job.radius) !== 'stroke') return input;
      const candidates = symbolStrokeCandidates(input, picked.id);
      if (!candidates.some(s => s.id === picked.id)) return input;
      const plan = job.connectedContours ? contourInkPlan(candidates, picked.id, job.point, job.radius) : null;
      const target = plan ? plan.target : picked.id;
      if (!target) return input;
      const request = ++inkEpoch;
      queuedInk = true;
      try {
        const connected = await mergeInWorker(plan?.strokes ?? candidates, undefined, undefined, undefined, target);
        if (request !== inkEpoch) return input;
        const ids = new Set(connected.map(s => s.id));
        return plan ? plan.apply(input, ids, job.color, job.width) :
          input.map(s => ids.has(s.id) ? { ...s, stroke: job.color, strokeWidth: job.width } : s);
      } catch (cause) {
        if (request !== inkEpoch) return input;
        throw cause;
      } finally { queuedInk = false; }
    } else {
      picked.stroke = job.color;
      picked.strokeWidth = job.width;
    }
    return input;
  }
  function down(e: PointerEvent) {
    if (e.button === 1 && embedded) { canvasNavigation.start(e, 4); return; }
    if (e.button === 0 && temporaryHand) { canvasNavigation.start(e, 1); return; }
    if (readOnly || canvasPanButtons) return;
    const selectionPress = e.button === 0 && e.pointerType !== 'touch' && !(e.buttons & 32) &&
      (e.ctrlKey || e.metaKey) && temporarySelectionTool && embedded && !penDraft;
    if (selectionPress && drawingQueue.length) { e.preventDefault(); return; }
    const temporarySelect = selectionPress && canUseTemporarySelection();
    if(canvasTool==='text'){
      if(e.button!==0||readOnly||drag||brushBusy||inkBusy||simplifyJob)return;
      e.preventDefault();const p=point(e),picked=[...artwork].reverse().find(v=>hit(v,p,3/view.scale));
      if(picked?.kind==='text'){beginInlineText(picked,p);return;}
      inlineTextPress={pointer:e.pointerId,start:p,source:JSON.stringify(artwork)};canvas.setPointerCapture(e.pointerId);return;
    }

    if(simplifyJob)return;
    if(canvasTool==='select'&&hierarchySelection!==null&&!hierarchyPointerBlocked&&!drag&&!hierarchyMove&&e.button===0){
      const p=point(e),picked=[...artwork].reverse().find(s=>hit(s,p,2/view.scale));
      if(picked&&hierarchySelectedIds.some(id=>selectionUnit(artwork.find(s=>s.id===id)!,0)===selectionUnit(picked,0))){hierarchyMoveDown(e);return;}
      hierarchySelection=null;strokeSelectionInfo='';
    }
    if(canvasTool==='hierarchy-move' || canvasTool==='hierarchy-rotate' || canvasTool==='hierarchy-scale' || canvasTool==='hierarchy-skew'){hierarchyMoveDown(e);return;}
    if(canvasTool==='hierarchy'){hierarchyPickDown(e);return;}
    if (
      (brushBusy && !(queuedSymbolTool(canvasTool) && drawingQueue.length)) ||
      inkBusy ||
      e.button !== 0 ||
      drag ||
      penGesture ||
      nodeGesture ||
      paintGesture ||
      nodeMarquee
    )
      return;
    if (
      !temporarySelect && (canvasTool === 'line' ||
        canvasTool === 'pencil' ||
        canvasTool === 'pen' ||
        canvasTool === 'ink') &&
      (!Number.isFinite(newLineWidth) || newLineWidth <= 0 || newLineWidth > 1000)
    ) {
      error = 'Line width must be greater than zero and at most 1000.';
      return;
    }
    if (canvasTool === 'bitmap' || canvasTool === 'gradient') {
      bitmapDown(e);
      return;
    }
    if (canvasTool === 'nodes') {
      nodeDown(e);
      return;
    }
    if (canvasTool === 'pen' && !temporarySelect) {
      penDown(e);
      return;
    }
    if (
      !temporarySelect && canvasTool === 'brush' &&
      (!Number.isFinite(brushWidth) || brushWidth <= 0 || brushWidth > 1000)
    ) {
      error = 'Brush size must be greater than zero and at most 1000.';
      return;
    }
    const simplifyAmount = canvasTool === 'brush' ? brushSimplify : pencilSimplify;
    if (!temporarySelect && embedded && (canvasTool === 'brush' || (canvasTool === 'pencil' && pencilMode === 'smooth')) &&
      (!Number.isFinite(simplifyAmount) || simplifyAmount < 0 || simplifyAmount > 200)) {
      error = 'Choose Simplify from 0 to 200 percent.';
      return;
    }
    let contactOpacity: number | undefined;
    let opacityProfile: Brush['opacityProfile'];
    const spatialOpacity = strokeOpacityEnabled && !brushTilt && !brushTwist;
    const brushInput = !temporarySelect && canvasTool === 'brush' ? editorPointer(e) : undefined;
    if (brushInput?.pointerType === 'pen' && brushObjects && (contactOpacityEnabled || spatialOpacity) &&
        (brushPaintMode === 'normal' || brushPaintMode === 'behind')) {
      try {
        const minimum = contactOpacityMinimum / 100, response = contactOpacityResponse;
        const opacity = brushContactOpacity(brushInput.pressure, minimum, response);
        if (spatialOpacity) opacityProfile = { minimum, response };
        else contactOpacity = opacity;
      } catch (cause) {
        e.preventDefault(); error = String(cause); return;
      }
    }
    const p = point(e), radius = 2 / view.scale;
    const candidates = canvasTool === 'brush' && !temporarySelect ? [] : [...artwork].reverse();
    const picked = (canvasTool === 'eyedropper' ? candidates.find(s => hit(s, p, 0)) : undefined) ??
      candidates.find(s => hit(s, p, radius));
    canvas.focus({ preventScroll: true });
    if (!temporarySelect && (canvasTool === 'bucket' || canvasTool === 'ink')) {
      const gap = Number(bucketGap);
      if (canvasTool === 'bucket' && (!Number.isFinite(gap) || gap < 0 || gap > 40)) {
        error = 'Gap tolerance must be between 0 and 40 symbol units.';
        return;
      }
      enqueueDrawing({ kind: 'paint', tool: canvasTool, point: p, view: { ...view }, radius: 2 / view.scale,
        fill: newFill, color: newStroke, width: newLineWidth, gap, contour: contourInk,
        segment: segmentInk, connected: connectedInk, connectedContours });
      return;
    }
    if (canvasTool === 'eyedropper') {
      if (eyedropperSource === 'rendered' || e.altKey) {
        const sample = document.createElement('canvas');
        sample.width = sample.height = 1;
        const ctx = sample.getContext('2d', { willReadFrequently: true })!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1, 1);
        ctx.translate(-Math.floor(p.x), -Math.floor(p.y));
        expandSymbols({ symbols }, artwork).forEach((s) => drawShape(ctx, s, assets));
        newFill =
          '#' +
          Array.from(ctx.getImageData(0, 0, 1, 1).data)
            .slice(0, 3)
            .map((n) => n.toString(16).padStart(2, '0'))
            .join('');
        error = '';
        return;
      }
      if (picked && picked.kind !== 'symbol') {
        const part = hitPart(picked, p, 0) ?? hitPart(picked, p, radius);
        if (eyedropperSource === 'object' || part === 'fill') newFill = picked.fill;
        if (eyedropperSource === 'object' || part === 'stroke') {
          newStroke = picked.stroke;
          newLineWidth = picked.strokeWidth;
        }
        error = '';
        if (eyedropperSource === 'stored' && !keepEyedropper && part)
          chooseCanvasTool(part === 'fill' ? 'bucket' : 'ink');
      }
      return;
    }
    const drawTool = temporarySelect || canvasTool === 'pen' || canvasTool === 'bucket' || canvasTool === 'ink'
      ? 'select' : canvasTool;
    if (!picked && drawTool === 'select') {
      selected = '';
      return;
    }
    drag = {
      pointer: e.pointerId,
      x: p.x,
      y: p.y,
      before: { artwork: drawTool === 'select' ? clone(artwork) : artwork, selected },
      view: { ...view },
      picked: drawTool === 'select' ? picked!.id : id(),
      kind: drawTool,
      fill: newFill,
      stroke: newStroke,
      lineWidth: drawTool === 'brush'
        ? embedded ? Math.min(200, Math.min(200, brushWidth) / (brushLockToCanvas ? 1 : workspaceZoom)) : brushWidth
        : newLineWidth,
      samples: drawTool === 'brush' ? new BrushSamples(sampleEditorPointer(e, p)) : [p],
      brush: {
        ...(opacityProfile ? { opacityProfile } : {}),
        pressure: brushPressure,
        tilt: brushTilt,
        twist: brushTwist,
        minimum: Math.max(0.01, Math.min(1, (Number(brushMinimum) || 1) / 100)),
        response: Math.max(0.25, Math.min(4, Number(brushResponse) || 1)),
        aspect: Math.max(0.1, Math.min(1, (Number(brushAspect) || 100) / 100)),
        angle: Math.max(-360, Math.min(360, Number(brushAngle) || 0)),
      },
      stabilization: Math.max(0, Math.min(100, Number(brushStabilization) || 0)),
      pencilMode,
      pencilOptimize,
      pencilSimplify,
      pencilObjects,
      brushOptimize: contactOpacity === undefined && !opacityProfile && brushOptimize,
      brushMode: brushPaintMode,
      brushObjects,
      brushAmount: embedded ? brushSimplify / 100 : brushSmooth ? 0.5 : 0,
    };
    if (drag.kind === 'brush') liveBrush = {
      id: drag.picked, kind: 'brush', x: 0, y: 0, width: 0, height: 0, rotation: 0,
      fill: drag.fill, fillEnabled: true, stroke: drag.fill, strokeWidth: drag.lineWidth,
      points: drag.samples, brush: drag.brush,
      ...(contactOpacity === undefined ? {} : { opacity: contactOpacity }),
    };
    if (liveBrush) brushWorker.start();
    if (drawTool === 'select') selected = drag.picked;
    canvas.setPointerCapture(e.pointerId);
    if (temporarySelect) temporarySelectionPointer = e.pointerId;
    e.preventDefault();
  }
  function enqueueDrawing(job: DrawingJob) {
    drawingQueue = [...drawingQueue, job];
    if (brushBusy) return;
    brushStatus = '';
    brushBusy = true;
    void drainDrawingQueue();
  }
  async function drainDrawingQueue() {
    try {
      while (alive && drawingQueue.length) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (!alive) return;
        const job = drawingQueue[0], original = artwork, validator = validate;
        const source = JSON.stringify(original);
        const before: Snapshot = { artwork: JSON.parse(source), selected };
        const current = () => alive && artwork === original && validate === validator && JSON.stringify(artwork) === source;
        try {
          let result: Vector[], retainedOverlap = false, nextSelected = '';
          if (job.kind === 'brush') {
            const start = symbolBrushMergeStart(before.artwork), eligible = before.artwork.slice(start);
            const prepared = await brushInWorker(eligible, {
              brush: job.stroke, amount: job.amount, optimize: job.optimize, merge: !job.objects,
              removeCoveredStrokes: job.removeCoveredStrokes,
              mode: job.mode, selected: [job.selected], at: job.mode === 'behind' ? 0 : eligible.length,
              symbol: !embedded,
            }, brushWorker.take());
            result = [...before.artwork.slice(0, start), ...prepared.shapes];
            retainedOverlap = !!prepared.retainedOverlap;
          } else if (job.kind === 'pencil') {
            const merge = embedded && !job.objects;
            const start = merge ? symbolBrushMergeStart(before.artwork) : before.artwork.length;
            const prepared = await pencilInWorker(merge ? before.artwork.slice(start) : [], job.stroke,
              job.mode === 'raw' ? 'ink' : job.mode, merge, job.amount, job.optimize, !embedded);
            if (Math.hypot(prepared.shape.width, prepared.shape.height) * job.view.scale < 2) result = before.artwork;
            else {
              result = [...before.artwork.slice(0, start), ...(merge ? prepared.shapes : [prepared.shape])];
              nextSelected = merge ? '' : job.stroke.id;
              retainedOverlap = !!prepared.retainedOverlap;
            }
          } else if (job.kind === 'paint') {
            result = await prepareQueuedPaint(clone(before.artwork), job);
            nextSelected = job.tool === 'ink' ? selected : '';
          } else {
            const mark = job.smoothPen === undefined ? [job.stroke] :
              (await shapeInWorker([], { shape: job.stroke, merge: false, smoothPen: job.smoothPen })).shapes;
            result = [...before.artwork, ...mark];
            nextSelected = job.stroke.id;
          }
          if (!current()) {
            if (alive) error = 'Symbol artwork changed before queued geometry finished.';
            return;
          }
          if (JSON.stringify(result) !== source) {
            validator(result);
            const nextPast = appendHistory(past, new HistoryEntry(before));
            if (!current()) {
              if (alive) error = 'Symbol artwork changed before queued geometry finished.';
              return;
            }
            artwork = result;
            selected = nextSelected;
            past = nextPast;
            future = [];
            simplifyInfo = '';
            if (retainedOverlap) brushStatus = (job.kind === 'pencil' ? 'Pencil' : 'Brush') +
              ' stroke kept separately. The overlap could not be merged safely.';
          }
        } catch (cause) {
          if (alive) error = String(cause);
          if (!current()) return;
        }
        drawingQueue = drawingQueue.slice(1);
      }
    } finally {
      if (alive) {
        drawingQueue = [];
        brushBusy = false;
        if (!liveBrush) brushWorker.cancel();
      }
    }
  }
  function move(e: PointerEvent) {
    if (canvasNavigation.move(e)) return;
    if (temporaryHand) return;
    if (readOnly) return;
    if(inlineTextPress)return;
    if(hierarchyMove){updateHierarchyMove(e);return;}
    if(canvasTool==='hierarchy-move' || canvasTool==='hierarchy-rotate' || canvasTool==='hierarchy-scale' || canvasTool==='hierarchy-skew'){updateHierarchyMove(e);return;}
    if(canvasTool==='hierarchy'){
      const job=hierarchyPick;
      if(job && job.pointer===e.pointerId &&
        Math.hypot(e.clientX-job.x,e.clientY-job.y)>4)cancelHierarchyPick();
      return;
    }
    if (paintGesture) {
      bitmapDragMove(e);
      return;
    }
    if (nodeMarquee) {
      if (updateNodeRegion(e)) paint();
      return;
    }
    if (nodeGesture) {
      nodeMove(e);
      return;
    }
    if (canvasTool === 'pen') { penHover = point(e); penHoverAlt = e.altKey; penHoverShift = e.shiftKey; }
    if (penGesture) {
      penMove(e);
      return;
    }
    if (!drag || e.pointerId !== drag.pointer) return;
    // Snapshot layout once for this delivery, including all coalesced samples.
    const sampleRect = canvas.getBoundingClientRect();
    const p = point(e, sampleRect);
    if (drag.kind === 'pencil' || drag.kind === 'brush') {
      const count = drag.samples.length;
      const events = editorCoalescedEvents(e);
      // The dispatched move summarizes the coalesced samples.
      for (const event of events.length ? events : [e]) {
        const last = drag.samples.at(-1)!;
        let q: Point =
          drag.kind === 'brush'
            ? sampleEditorPointer(event, point(event, sampleRect), last)
            : point(event, sampleRect);
        if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
        if (e.shiftKey) {
          drag.axis ??= Math.abs(q.x - drag.x) >= Math.abs(q.y - drag.y) ? 'x' : 'y';
          if (drag.axis === 'x') q.y = drag.y;
          else q.x = drag.x;
        } else drag.axis = undefined;
        if (drag.kind === 'brush' && event.type !== 'pointerup')
          q = stabilizeSample(last, q, drag.stabilization);
        if (
          (event.type === 'pointerup'
            ? q.x === last.x && q.y === last.y
            : Math.hypot(q.x - last.x, q.y - last.y) * drag.view.scale < 0.5) &&
          q.pressure === last.pressure &&
          q.tiltX === last.tiltX &&
          q.tiltY === last.tiltY &&
          q.twist === last.twist
        )
          continue;
        if (drag.samples.length >= MAX_VECTOR_POINTS) {
          cancelDrag();
          error = 'Stroke exceeds the document point capacity; no partial stroke was committed.';
          return;
        }
        drag.samples.push(q);
      }
      if (drag.kind === 'brush' && drag.samples.length !== count) brushSampleRevision++;
      if (drag.kind === 'pencil' && drag.samples.length >= 2)
        liveMark = drawnSymbolPencil(drag.picked, drag.samples, 'raw', drag.stroke, drag.lineWidth);
      return;
    }
    if (drag.kind !== 'select') {
      const drawn = drawnSymbolPrimitive(
        drag.kind,
        drag.picked,
        { x: drag.x, y: drag.y },
        p,
        e.shiftKey,
        e.altKey,
      );
      drawn.fill = drag.fill;
      drawn.stroke = drag.stroke;
      if (drag.kind === 'line') drawn.strokeWidth = drag.lineWidth;
      liveMark = drawn;
      return;
    }
    let dx = p.x - drag.x,
      dy = p.y - drag.y;
    if (e.shiftKey) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    artwork = moveSymbolChildren(drag.before.artwork, drag.picked, dx, dy);
  }
  async function up(e: PointerEvent) {
    if(inlineTextPress){if(e.pointerId!==inlineTextPress.pointer)return;const press=inlineTextPress;inlineTextPress=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(JSON.stringify(artwork)!==press.source){error='Text creation source changed.';return;}const p=point(e),dragged=Math.abs(p.x-press.start.x)*view.scale>3;beginInlineText(undefined,dragged?{x:Math.min(p.x,press.start.x),y:Math.min(p.y,press.start.y)}:press.start,dragged?Math.abs(p.x-press.start.x):undefined);return;}

    if(hierarchyMove){hierarchyMoveUp(e);return;}
    if(canvasTool==='hierarchy-move' || canvasTool==='hierarchy-rotate' || canvasTool==='hierarchy-scale' || canvasTool==='hierarchy-skew'){hierarchyMoveUp(e);return;}
    if(canvasTool==='hierarchy'){hierarchyPickUp(e);return;}
    if (paintGesture?.pointer === e.pointerId) {
      bitmapDragMove(e);
      const g = paintGesture,
        candidate = artwork;
      paintGesture = null;
      artwork = g.before.artwork;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      change(() => {
        artwork = candidate;
      });
      paint();
      return;
    }

    if (nodeMarquee?.pointer === e.pointerId) {
      if (!updateNodeRegion(e)) return;
      const g = nodeMarquee;
      nodeMarquee = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (shape === g.original && artwork === g.source) {
        const sets: Record<string, number[]> = {};
        for (const s of nodeItems()) {
          const hits = editableNodes(s).flatMap((node, i) => {
            const p = worldPoint(s, node);
            if (g.form === 'lasso')
              return g.ring.length >= 3 && containsPoint(g.ring, p) ? [i] : [];
            return p.x >= Math.min(g.start.x, g.end.x) &&
              p.x <= Math.max(g.start.x, g.end.x) &&
              p.y >= Math.min(g.start.y, g.end.y) &&
              p.y <= Math.max(g.start.y, g.end.y)
              ? [i]
              : [];
          });
          const previous = g.previous[s.id] ?? [];
          sets[s.id] =
            g.mode === 'replace'
              ? hits
              : g.mode === 'add'
                ? [...new Set([...previous, ...hits])]
                : previous.filter((i) =>
                    g.mode === 'subtract' ? !hits.includes(i) : hits.includes(i),
                  );
        }
        setNodeSets(sets);
        if (!acrossArtwork)
          nodeIndex = nodeSelection.includes(nodeIndex) ? nodeIndex : (nodeSelection[0] ?? 0);
      }
      paint();
      return;
    }
    if (nodeGesture?.pointer === e.pointerId) {
      nodeMove(e);
      if(!nodeGesture)return;
      const g=nodeGesture,candidate=artwork;nodeGesture=null;artwork=g.before.artwork;
      if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
      publishNodeEdit(g,candidate);
      paint();
      return;
    }
    if (penGesture?.pointer === e.pointerId) {
      penMove(e);
      penGesture = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      return;
    }
    if (!drag || e.pointerId !== drag.pointer) return;
    move(e);
    if (!drag) return;
    const old = drag;
    const mark = liveMark, brush = liveBrush;
    drag = undefined;
    temporarySelectionPointer = null;
    liveMark = null;
    liveBrush = null;
    if (canvas.hasPointerCapture(old.pointer)) canvas.releasePointerCapture(old.pointer);
    if (old.kind === 'brush' && brush) {
      enqueueDrawing({ kind: 'brush', stroke: clone(brush), view: old.view, amount: old.brushAmount,
        optimize: old.brushOptimize, objects: old.brushObjects, mode: old.brushMode, selected: old.before.selected,
        removeCoveredStrokes });
    } else if (old.kind === 'pencil' && mark) {
      enqueueDrawing({ kind: 'pencil', stroke: mark, view: old.view, mode: old.pencilMode,
        amount: old.pencilSimplify, optimize: old.pencilOptimize, objects: old.pencilObjects });
    } else if (old.kind !== 'select' && mark) {
      const { width, height } = mark, { scale } = old.view;
      if (old.kind === 'line' ? Math.hypot(width, height) * scale >= 2 : width * scale >= 2 && height * scale >= 2)
        enqueueDrawing({ kind: 'shape', stroke: mark, view: old.view });
    } else if (old.kind === 'select') {
      const candidate = artwork;
      artwork = old.before.artwork;
      selected = old.picked;
      change(() => { artwork = candidate; selected = old.picked; });
    }
    paint();
  }
  function canvasKey(e: KeyboardEvent) {
    if(e.defaultPrevented||e.isComposing||e.getModifierState('AltGraph'))return;
    const shortcut=shortcutForKey(e,embedded?shortcutOverrides:{});
    if (canvasTool === 'pen') { penHoverAlt = e.altKey; penHoverShift = e.shiftKey; }
    if (temporarySelectionTool && (e.key === 'Control' || e.key === 'Meta'))
      temporarySelectionHeld = e.ctrlKey || e.metaKey;
    if ((canvasPanButtons || spaceHand) && e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); spaceHand = false; stopCanvasPan(); return;
    }
    if (embedded && e.key === ' ' && !e.defaultPrevented && !e.isComposing &&
        !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat && !canvasPanButtons && canNavigateCanvas()) { spaceHand = true; penHover = null; }
      return;
    }
    if (canvasPanButtons) { e.stopPropagation(); return; }
    if (readOnly) return;
    if(strokeSelectionJob){e.preventDefault();e.stopPropagation();if(e.key==='Escape')cancelStrokeSelection();return;}
    if(hierarchyMove&&e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelHierarchyMove();return;}
    if(simplifyJob){e.preventDefault();e.stopPropagation();return;}
    if (embedded && !penDraft && shortcut) {
      const tool = symbolWorkspaceTools.find(item => toolShortcut(item.id) === shortcut);
      if (tool) {
        e.preventDefault();
        e.stopPropagation();
        chooseCanvasTool(tool.mode);
        return;
      }
    }
    if(canvasTool==='hierarchy' || canvasTool==='hierarchy-move' || canvasTool==='hierarchy-rotate' || canvasTool==='hierarchy-scale' || canvasTool==='hierarchy-skew'){
      if(e.key==='Escape'){
        e.preventDefault();e.stopPropagation();
        if(hierarchyMove)cancelHierarchyMove();else if(hierarchyPick)cancelHierarchyPick();else canvasTool='select';
      }else if(shortcut==='all'){
        e.preventDefault();e.stopPropagation();
        if(!hierarchyBlocked)selectHierarchyUnits(hierarchyChoices.map(item=>item.id));
      }else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Delete','Backspace'].includes(e.key) || e.ctrlKey || e.metaKey){
        e.preventDefault();e.stopPropagation();
      }
      return;
    }
    if (penDraft && ['Enter', 'Escape', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        cancelDrag();
        discardPen();
      } else if (!penGesture && e.key === 'Enter') finishPen();
      else if (!penGesture && e.key === 'Backspace') {
        penDraft.nodes!.pop();
        if (!penDraft.nodes!.length) discardPen();
      }
      return;
    }
    if (e.key === 'Escape' && queuedInk && !drag && !penDraft) {
      e.preventDefault(); e.stopPropagation(); inkEpoch++; return;
    }
    if (e.key === 'Escape' && (inkBusy || drag || nodeGesture || paintGesture || nodeMarquee)) {
      e.preventDefault();
      e.stopPropagation();
      cancelDrag();
      return;
    }
    if (
      canvasTool === 'nodes' &&
      !nodeMarquee &&
      !nodeGesture &&
      !drag &&
      shortcut === 'all'
    ) {
      e.preventDefault();
      e.stopPropagation();
      selectAllNodes();
      return;
    }
    if (
      canvasTool === 'nodes' &&
      !nodeMarquee &&
      !drag &&
      !nodeGesture &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      shape &&
      nodeCount() > 0
    ) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) nodeCommand('delete');
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const step = e.shiftKey ? 10 : 1;
        const sets=nodeSets();
        try{
          const g=captureNodeEdit(-1,{x:0,y:0},shape,'anchor',sets),next=structuredClone($state.snapshot(g.before.artwork));
          moveNodeSets(next,g.before.artwork,g.sets,e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0);
          publishNodeEdit(g,withNodeAttachments(next,g));
        }catch(cause){error=String(cause);}
        return;
      }
    }
    if (
      canvasTool === 'nodes' &&
      !nodeCount() &&
      ['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (drag || nodeGesture || paintGesture || nodeMarquee || e.altKey) return;
    const key = e.key.toLowerCase();
    const modified = e.ctrlKey || e.metaKey;
    if(canvasTool==='select'&&hierarchySelection!==null){
      const commands:Record<string,'copy'|'cut'|'paste'|'duplicate'|'delete'>={c:'copy',x:'cut',v:'paste',d:'duplicate',delete:'delete',backspace:'delete'};
      if(shortcut==='duplicate'||(modified&&!e.shiftKey&&['c','x','v'].includes(key))||(!modified&&['delete','backspace'].includes(key))){
        e.preventDefault();e.stopPropagation();
        if(!e.repeat){
          const action=shortcut==='duplicate'?'duplicate':commands[key];
          if(['copy','cut','delete'].includes(action)){
            try{
              const owner=captureSymbolHierarchyDrag(),copied=copySymbolChildren(owner.snapshot,owner.ids),
                remove=new Set(copied.map(s=>s.id)),next=owner.snapshot.filter(s=>!remove.has(s.id));
              if(action==='copy'){
                if(!symbolHierarchyCurrent(owner))throw Error('Original symbol selection changed.');
              }else publishHierarchyCandidate(owner,next,[],next[0]?.id??'');
              if(action!=='delete')artworkClipboard=copied;
            }catch(cause){error=String(cause);}
          }else hierarchyArtworkCommand(action);
        }
        return;
      }
      const delta:Record<string,Point>={ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1}};
      if(!modified&&delta[e.key]){e.preventDefault();e.stopPropagation();try{const job=captureSymbolHierarchyDrag(),step=e.shiftKey?10:1;publishHierarchyCandidate(job,moveSymbolChildren(job.snapshot,job.ids,delta[e.key].x*step,delta[e.key].y*step));}catch(cause){error=String(cause);}return;}
    }
    if (modified && !e.shiftKey && ['c', 'x', 'v'].includes(key)) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) clipboardCommand(key === 'c' ? 'copy' : key === 'x' ? 'cut' : 'paste');
      return;
    }
    const history = shortcut==='undo'||shortcut==='redo';
    const duplicate = shortcut==='duplicate';
    const remove = !modified && !e.shiftKey && (key === 'delete' || key === 'backspace');
    if (history || duplicate || remove) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) {
        if (history){const redo=shortcut==='redo';if(embedded&&historyCommand&&!(redo?future:past).length)historyCommand(redo);else undo(redo);}
        else if (shape) children(duplicate ? 'duplicate' : 'delete');
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || !shape || drag) return;
    const delta = (
      { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<
        string,
        number[]
      >
    )[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 10 : 1;
    change(() => {
      artwork = moveSymbolChildren(artwork, selected, delta[0] * step, delta[1] * step);
    });
  }
  function change(action: (s: Vector) => void) {
    if(simplifyJob || drawingQueue.length)return false;
    simplifyInfo='';
    if (penDraft) {
      error = 'Finish or cancel the Pen path before editing other artwork.';
      return false;
    }
    cancelDrag();
    const before = { artwork: clone(artwork), selected };
    try {
      action(shape);
      validate(artwork);
      error = '';
    } catch (e) {
      artwork = before.artwork;
      selected = before.selected;
      error = String(e);
      return false;
    }
    if (JSON.stringify(before.artwork) !== JSON.stringify(artwork)) {
      past = appendHistory(past, new HistoryEntry<Snapshot>(before));
      future = [];
    }
    return true;
  }
  function add(kind: 'rectangle' | 'ellipse' | 'text') {
    if(kind==='text'){beginInlineText(undefined,{x:0,y:0});return;}
    change(() => {
      const child: Vector = {
        id: id(),
        kind,
        x: 0,
        y: 0,
        width: Math.max(1, definition.width / 2),
        height: Math.max(1, definition.height / 2),
        rotation: 0,
        fill: newFill,
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
      };
      artwork = [...artwork, child];
      selected = child.id;
    });
  }
  function measureText(s: Vector) {
    const t = s.text!;
    const ctx = canvas.getContext('2d')!;
    if (t.runs?.length) {
      const layout = paintStyledText(ctx, {
        ...t,
        runs: t.runs,
        width: t.wrapWidth ?? s.width / (t.scaleX || 1),
        direction: t.direction ?? 'ltr',
        measureOnly: true,
      });
      s.width = (t.wrapWidth || Math.max(1, ...layout.lines.map((l) => l.width))) * (t.scaleX ?? 1);
      s.height =
        Math.max(
          1,
          layout.lines.reduce((n, l) => n + l.height, 0),
        ) * (t.scaleY ?? 1);
      return;
    }
    ctx.save();
    try {
      ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${fontFamilyForRendering(t.font)}`;
      ctx.letterSpacing = `${t.letterSpacing ?? 0}px`;
      ctx.wordSpacing = `${t.wordSpacing ?? 0}px`;
      ctx.direction = t.direction ?? 'ltr';
      ctx.fontKerning = t.kerning ?? 'auto';
      const lines = wrapText(t.content, t.wrapWidth, (text) => ctx.measureText(text).width);
      s.width =
        (t.wrapWidth || Math.max(1, ...lines.map((line) => ctx.measureText(line).width))) *
        (t.scaleX ?? 1);
      s.height =
        (Math.max(0, lines.length - 1) * (t.lineHeight ?? 1.2) + 1.2) * t.size * (t.scaleY ?? 1);
    } finally {
      ctx.restore();
    }
  }
  function setText(patch: Partial<NonNullable<Vector['text']>>) {
    if(inlineText&&inlineTextEditor){inlineTextEditor.properties(patch);return;}
    if (patch.content !== undefined) textRange = null;
    change((s) => {
      if (!s.text) return;
      if (patch.content !== undefined && s.text.runs?.length)
        patch.runs = reconcileStyledText(s.text.content, s.text.runs, patch.content).runs;
      s.text = textObjectProperties(s.text, patch);
      validate(artwork);
      measureText(s);
    });
  }
  function setTextBinding(binding: string | undefined, editable: boolean) {
    if (!shape?.text || inlineText || readOnly ||
        (shape.text.dynamicBinding === binding && !!shape.text.input === editable)) return;
    change((selected) => {
      const text = selected.text!;
      if (binding === undefined) delete text.dynamicBinding;
      else text.dynamicBinding = binding;
      if (binding !== undefined && editable) text.input = true;
      else delete text.input;
    });
  }
  function clipboardCommand(action: 'copy' | 'cut' | 'paste') {
    if (penDraft || brushBusy || inkBusy) return;
    cancelDrag();
    try {
      if (action === 'paste') {
        change(() => {
          const result = pasteSymbolChildren(artwork, $state.snapshot(artworkClipboard));
          artwork = result.artwork;
          selected = result.selected;
        });
        return;
      }
      const copied = copySymbolChildren($state.snapshot(artwork), selected);
      if (action === 'cut') {
        const before = artwork.length;
        children('delete');
        if (artwork.length === before) return;
      }
      artworkClipboard = copied;
      error = '';
    } catch (e) {
      error = String(e);
    }
  }
  let groupEditing = $state<{ group: string; source: string; definition: SymbolDefinition; admit?:()=>void } | null>(
    null,
  );
  function editGroup() {
    if (penDraft || brushBusy || inkBusy || groupEditing) return;
    cancelDrag();
    try {
      validateLiveGraphicData(artwork);
      const isolatedGroup = isolateSymbolGroup($state.snapshot(artwork), selected),admission=originalSimplify&&simplify?originalSimplify($state.snapshot(artwork)):undefined;
      admission?.validate();
      groupEditing = {
        group: isolatedGroup.group,
        ...(admission?{admit:admission.validate}:{}),
        source: JSON.stringify(artwork),
        definition: {
          id: definition.id,
          name: 'Isolated group',
          width: definition.width,
          height: definition.height,
          shapes: isolatedGroup.artwork,
        },
      };
    } catch (e) {
      error = String(e);
    }
  }
  function groupResult(edited: Vector[]) {
    validateLiveGraphicData(artwork);validateLiveGraphicData(edited);
    if (!groupEditing || JSON.stringify(artwork) !== groupEditing.source)
      throw new Error('Artwork changed during group isolation. Cancel and reopen the group.');
    return replaceIsolatedSymbolGroup($state.snapshot(artwork), groupEditing.group, $state.snapshot(edited));
  }
  function simplifyGroup(edited:Vector[]):StaticSymbolSimplifyContext {
    validateLiveGraphicData(artwork);validateLiveGraphicData(edited);
    const session=groupEditing;
    if(!session||!originalSimplify||!simplify)throw Error('The original static group editor has ended.');
    return captureIsolatedSymbolSimplifyContext(()=>{validateLiveGraphicData(artwork);return {
      artwork:$state.snapshot(artwork),source:artwork,session:groupEditing!,past,future,symbolId:definition.id,
      group:groupEditing?.group??'',selected,revision:simplifyInputRevision,
      context:JSON.stringify([hierarchyBoundary,canvasTool,hierarchySelectedIds]),
      eligible:alive&&groupEditing===session&&JSON.stringify(artwork)===session.source&&!!simplify&&!penDraft&&!brushBusy&&!inkBusy&&!drag&&!penGesture&&!nodeGesture&&!paintGesture&&!nodeMarquee&&!hierarchyMove&&!hierarchyPick&&!symbolHierarchyDrag,
    };},edited,originalSimplify);
  }
  let applyingGroup=false,groupApplyReentered=false;
  function applyGroup(edited: Vector[], admit?:()=>void): string | null {
    if(applyingGroup){groupApplyReentered=true;return 'Isolated group publication cannot reenter.';}
    applyingGroup=true;groupApplyReentered=false;
    try {
      validateLiveGraphicData(artwork);validateLiveGraphicData(edited);
      const session=groupEditing,source=artwork,signature=simplifyStamp($state.snapshot(artwork)),input=simplifyStamp(edited),
        oldPast=past,oldFuture=future,active=selected,ids=[...hierarchySelectedIds],mode=canvasTool,boundary=hierarchyBoundary,
        revision=simplifyInputRevision,validator=validate;
      const original=()=>{
        validateLiveGraphicData(artwork);validateLiveGraphicData(edited);
        if(groupApplyReentered||!alive||!session||groupEditing!==session||artwork!==source||simplifyStamp($state.snapshot(artwork))!==signature||
          JSON.stringify(artwork)!==session.source||simplifyStamp(edited)!==input||past!==oldPast||future!==oldFuture||selected!==active||
          JSON.stringify(hierarchySelectedIds)!==JSON.stringify(ids)||canvasTool!==mode||hierarchyBoundary!==boundary||simplifyInputRevision!==revision||
          validate!==validator||penDraft||brushBusy||inkBusy||drag||penGesture||nodeGesture||paintGesture||nodeMarquee||hierarchyMove||hierarchyPick||symbolHierarchyDrag||simplifyJob)
          throw Error('Original isolated parent source changed. Cancel and reopen the group.');
      };
      const current=()=>{original();session?.admit?.();admit?.();original();};
      current();
      const next=structuredClone($state.snapshot(groupResult(edited))),expected=simplifyStamp(next),before=structuredClone($state.snapshot(artwork));
      assertSymbolSimplifyDetached(source,next);assertSymbolSimplifyDetached(edited,next);assertSymbolSimplifyDetached(source,before);
      validateLiveGraphicData(next);validator(next);current();
      if(simplifyStamp(next)!==expected||simplifyStamp(before)!==signature)throw Error('Prepared isolated group changed.');
      const nextPast=appendHistory(oldPast, new HistoryEntry<Snapshot>({artwork:before,selected:active,hierarchy:ids})),nextSelected=next.some(s=>s.id===active)?active:next[0]?.id??'',
        nextIds=ids.filter(id=>next.some(s=>s.id===id));
      current();
      if(expected!==signature){preserveHierarchyOnce=true;artwork=next;past=nextPast;future=[];selected=nextSelected;hierarchySelection=nextIds.length?nextIds:nextSelected?[nextSelected]:[];
        nodeIndex=0;nodeSelection=[0];acrossNodes={};nodeFocusId=selected;}
      error='';simplifyInfo='';groupEditing=null;return null;
    } catch (e) { return String(e); }
    finally {applyingGroup=false;}
  }
  function children(action: 'duplicate' | 'delete' | 'front' | 'back') {
    change(() => {
      const result = editSymbolChildren($state.snapshot(artwork), selected, action);
      const removed = action === 'delete' ? artwork.filter(item => item.id === selected && item.drawingMode === 'merge') : [];
      artwork = removed.length ? healDeletedInk(result.artwork, removed) : result.artwork;
      selected = result.selected && artwork !== result.artwork && !artwork.some(item => item.id === result.selected)
        ? artwork[0]?.id ?? '' : result.selected;
    });
  }
  let groupDestination = $state('[]');
  let groupPlacement = $state<'append' | 'before' | 'after'>('append');
  let groupAnchor = $state('');
  const groupAnchors = $derived(artwork.filter((item) => inScope(item, JSON.parse(groupDestination))));
  const groupDestinations = $derived.by(() => {
    const paths = new SvelteMap<string, string>();
    paths.set('[]', 'Current editing root');
    for (const item of artwork) {
      for (let depth = 1; depth <= (item.groups?.length ?? 0); depth++) {
        const path = item.groups!.slice(0, depth);
        paths.set(JSON.stringify(path), path.join(' / '));
      }
    }
    return [...paths].map(([value, label]) => ({ value, label }));
  });
  const hierarchyEntries=$derived(groupDestinations.map(entry=>{
    const path=JSON.parse(entry.value) as string[],seen=new SvelteSet<string>();
    const anchors=artwork.filter(item=>{
      if(!inScope(item,path))return false;
      const unit=selectionUnit(item,path.length);
      if(seen.has(unit))return false;
      seen.add(unit);return true;
    }).map(item=>({id:item.id,label:item.groups?.[path.length]?'Group '+item.groups[path.length]:item.kind+' · '+item.id}));
    return {...entry,path,anchors};
  }));
  let hierarchySelection=$state<string[] | null>(null);
  const hierarchyChoices=$derived(hierarchyEntries[0]?.anchors ?? []);
  const hierarchySelectedIds=$derived.by(()=>{
    if(hierarchySelection!==null)return hierarchySelection;
    const active=artwork.find(item=>item.id===selected);
    if(!active)return [];
    const representative=hierarchyChoices.find(choice=>{
      const item=artwork.find(item=>item.id===choice.id)!;
      return selectionUnit(item,0)===selectionUnit(active,0);
    });
    return representative?[representative.id]:[];
  });
  $effect(()=>{
    void selected;void hierarchyBoundary;JSON.stringify(artwork);
    if(preserveHierarchyOnce){preserveHierarchyOnce=false;return;}
    hierarchySelection=null;
  });
  function selectHierarchyUnits(ids:string[]){
    cancelSymbolHierarchyDrag();cancelHierarchyPick();cancelHierarchyMove();
    hierarchySelection=[...ids];
  }
  let hierarchyPick=$state.raw<{
    pointer:number;x:number;y:number;toggle:boolean;source:Vector[];signature:string;
    boundary:string;selection:string;view:string;rect:string;
  } | null>(null);
  function hierarchyRect(){const r=canvas.getBoundingClientRect();return JSON.stringify([r.left,r.top,r.width,r.height]);}
  function cancelHierarchyPick(){
    const job=hierarchyPick;hierarchyPick=null;
    if(job && canvas?.hasPointerCapture(job.pointer))canvas.releasePointerCapture(job.pointer);
  }
  function hierarchyPointerCancel(event:PointerEvent){
    if(hierarchyPick?.pointer===event.pointerId &&
      (event.type!=='lostpointercapture' || !canvas.hasPointerCapture(event.pointerId)))cancelHierarchyPick();
    if(hierarchyMove?.pointer===event.pointerId &&
      (event.type!=='lostpointercapture' || !canvas.hasPointerCapture(event.pointerId)))cancelHierarchyMove();
    if(canvasTool!=='hierarchy' && canvasTool!=='hierarchy-move' && canvasTool!=='hierarchy-rotate' && canvasTool!=='hierarchy-scale' && canvasTool!=='hierarchy-skew')cancelDrag();
  }
  function hierarchyPickCurrent(job:NonNullable<typeof hierarchyPick>){
    return alive && canvasTool==='hierarchy' && !hierarchyPointerBlocked && !drag && !penGesture &&
      !nodeGesture && !paintGesture && !nodeMarquee && artwork===job.source &&
      JSON.stringify(artwork)===job.signature && hierarchyBoundary===job.boundary &&
      JSON.stringify(hierarchySelectedIds)===job.selection && JSON.stringify(view)===job.view &&
      hierarchyRect()===job.rect;
  }
  function hierarchyPickDown(event:PointerEvent){
    if(event.button!==0 || hierarchyPick || hierarchyPointerBlocked || drag || penGesture ||
      nodeGesture || paintGesture || nodeMarquee)return;
    event.preventDefault();canvas.focus({preventScroll:true});
    hierarchyPick={pointer:event.pointerId,x:event.clientX,y:event.clientY,toggle:event.shiftKey,
      source:artwork,signature:JSON.stringify(artwork),boundary:hierarchyBoundary,
      selection:JSON.stringify(hierarchySelectedIds),view:JSON.stringify(view),rect:hierarchyRect()};
    try{canvas.setPointerCapture(event.pointerId);}catch{cancelHierarchyPick();}
  }
  function hierarchyPickUp(event:PointerEvent){
    const job=hierarchyPick;
    if(!job || event.pointerId!==job.pointer)return;
    const current=hierarchyPickCurrent(job) && canvas.hasPointerCapture(job.pointer),box=canvas.getBoundingClientRect();
    cancelHierarchyPick();
    if(!current || Math.hypot(event.clientX-job.x,event.clientY-job.y)>4 ||
      event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom)return;
    const p=point(event),picked=[...artwork].reverse().find(item=>hit(item,p,2/view.scale));
    const choice=picked && hierarchyChoices.find(entry=>{
      const item=artwork.find(item=>item.id===entry.id)!;
      return selectionUnit(item,0)===selectionUnit(picked,0);
    });
    const ids=hierarchySelectedIds;
    if(choice && !shape)selected=choice.id;
    selectHierarchyUnits(choice ? job.toggle
      ? ids.includes(choice.id)?ids.filter(id=>id!==choice.id):[...ids,choice.id]
      : [choice.id] : job.toggle?[...ids]:[]);
  }
  $effect(()=>{
    if(hierarchyPick && !hierarchyPickCurrent(hierarchyPick))cancelHierarchyPick();
  });
  const hierarchyPointerBlocked=$derived.by(()=>!!penDraft || brushBusy || inkBusy  || !!groupEditing);
  const hierarchyBlocked=$derived.by(()=>!shape || hierarchyPointerBlocked);
  const hierarchyBoundary=$derived(JSON.stringify({definition,symbols,assets,context,isolated,hierarchyOwner}));
  let symbolHierarchyDrag=$state.raw<{
    token:string;source:Vector[];snapshot:Vector[];signature:string;boundary:string;selected:string;ids:string[];
    validator:typeof validate;past:HistoryEntry<Snapshot>[];future:HistoryEntry<Snapshot>[];
  } | null>(null);
  function cancelSymbolHierarchyDrag(){symbolHierarchyDrag=null;}
  function captureSymbolHierarchyDrag(){
    if(!alive || hierarchyBlocked || hierarchyMove || drag || penGesture || nodeGesture || paintGesture || nodeMarquee)
      throw new Error('Finish pending artwork work before moving hierarchy units.');
    const ids=[...hierarchySelectedIds];
    if(!ids.length || new SvelteSet(ids).size!==ids.length ||
        ids.some(id=>!hierarchyChoices.some(choice=>choice.id===id)))
      throw new Error('Choose current complete hierarchy units before placement.');
    validateLiveGraphicData(artwork);
    const source=artwork,signature=JSON.stringify(artwork),boundary=hierarchyBoundary,active=selected,validator=validate,oldPast=past,oldFuture=future;
    const snapshot=structuredClone($state.snapshot(artwork));
    validate(snapshot);
    if(artwork!==source||JSON.stringify(artwork)!==signature||hierarchyBoundary!==boundary||selected!==active||validate!==validator||past!==oldPast||future!==oldFuture||JSON.stringify(hierarchySelectedIds)!==JSON.stringify(ids))throw Error('Original symbol hierarchy changed during capture.');
    return {token:crypto.randomUUID(),source,snapshot,signature,
      boundary,selected:active,ids,validator,past:oldPast,future:oldFuture};
  }
  function publishHierarchyCandidate(owner:ReturnType<typeof captureSymbolHierarchyDrag>,candidate:Vector[],ids=owner.ids,active=owner.selected,admit=()=>symbolHierarchyCurrent(owner)){
    validateLiveGraphicData(candidate);
    const next=structuredClone(candidate);validate(next);
    const signature=JSON.stringify(next),before:Snapshot={artwork:structuredClone(owner.snapshot),selected:owner.selected,hierarchy:[...owner.ids]},nextPast=appendHistory(owner.past, new HistoryEntry<Snapshot>(before)),nextIds=[...ids];
    if(!symbolHierarchyCurrent(owner)||!admit()||JSON.stringify(next)!==signature||!symbolHierarchyCurrent(owner))throw Error('Original symbol selection changed before publication.');
    if(signature===owner.signature&&active===owner.selected)return;
    preserveHierarchyOnce=true;artwork=next;selected=active;hierarchySelection=nextIds;past=nextPast;future=[];error='';if(!nextIds.length)strokeSelectionInfo='';
  }
  function hierarchyArtworkCommand(action:'copy'|'cut'|'paste'|'duplicate'|'delete'|'front'|'back'|'group'|'ungroup'){
    try{
      if(!alive || hierarchyPointerBlocked || hierarchyMove || hierarchyPick || symbolHierarchyDrag ||
        drag || penGesture || nodeGesture || paintGesture || nodeMarquee)
        throw new Error('Finish pending artwork work before using hierarchy artwork commands.');
      const source=artwork,snapshot=structuredClone($state.snapshot(artwork)),signature=JSON.stringify(artwork);
      const boundary=hierarchyBoundary,active=selected,ids=[...hierarchySelectedIds],validator=validate;
      validate(snapshot);
      if(action!=='paste' && (!ids.length || new SvelteSet(ids).size!==ids.length ||
        ids.some(id=>!hierarchyChoices.some(choice=>choice.id===id))))
        throw new Error('Choose current complete hierarchy units first.');
      const current=()=>alive && !hierarchyPointerBlocked && !hierarchyMove && !hierarchyPick &&
        !symbolHierarchyDrag && !drag && !penGesture && !nodeGesture && !paintGesture && !nodeMarquee &&
        artwork===source && JSON.stringify(artwork)===signature && hierarchyBoundary===boundary &&
        selected===active && validate===validator && JSON.stringify(hierarchySelectedIds)===JSON.stringify(ids);
      let next=snapshot,nextSelected=active,copied:Vector[]|undefined;
      if(action==='paste'){
        const result=pasteSymbolChildren(snapshot,structuredClone($state.snapshot(artworkClipboard)));
        next=result.artwork;nextSelected=result.selected;
      }else if(action==='copy' || action==='cut'){
        copied=copySymbolChildren(snapshot,ids);
        if(action==='cut'){
          const remove=new SvelteSet(copied.map(item=>item.id));
          next=snapshot.filter(item=>!remove.has(item.id));
          if(!next.some(item=>item.id===nextSelected))nextSelected=next[0]?.id ?? '';
        }
      }else{
        const result=editSymbolChildren(snapshot,ids,action);
        next=result.artwork;
        if(action==='duplicate' || !next.some(item=>item.id===active))nextSelected=result.selected;
      }
      if(action==='delete'||action==='cut'){
        const survivors=new Set(next.map(s=>s.id));
        next=healDeletedInk(next,snapshot.filter(s=>s.drawingMode==='merge'&&!survivors.has(s.id)));
        if(nextSelected&&!next.some(s=>s.id===nextSelected))nextSelected=next[0]?.id??'';
      }
      validate(next);
      if(!current())throw new Error('Symbol hierarchy changed before artwork publication.');
      if(action==='copy'){artworkClipboard=copied!;error='';return;}
      if(JSON.stringify(next)===signature && nextSelected===active){error='';return;}
      const accepted=change(()=>{artwork=next;selected=nextSelected;});
      if(accepted && action==='cut')artworkClipboard=copied!;
    }catch(cause){error=String(cause);}
  }
  let hierarchyMove=$state.raw<{
    owner:ReturnType<typeof captureSymbolHierarchyDrag>;pointer:number;start:Point;view:typeof view;
    rect:string;preview:Vector[];dx:number;dy:number;mode:typeof canvasTool;
    pivot?:Point;pivotConfig:string;rotation:number;lastAngle:number;angle:number;
    box?:ReturnType<typeof symbolTransformBounds>;handle?:string;operation?:Matrix;scaled:boolean;
  } | null>(null);
  function cancelHierarchyMove(){
    const job=hierarchyMove;hierarchyMove=null;
    if(job && canvas?.hasPointerCapture(job.pointer))canvas.releasePointerCapture(job.pointer);
  }
  function hierarchyMoveCurrent(job:NonNullable<typeof hierarchyMove>){
    return canvasTool===job.mode && symbolHierarchyCurrent(job.owner) &&
      ((job.mode!=='hierarchy-rotate' && job.mode!=='hierarchy-scale' && job.mode!=='hierarchy-skew') || hierarchyPivotConfig()===job.pivotConfig) &&
      JSON.stringify(view)===JSON.stringify(job.view) && hierarchyRect()===job.rect;
  }
  function hierarchyPivotConfig(){return JSON.stringify([hierarchyCustomPivot,hierarchyTransformPivot]);}
  function hierarchyScreen(p:Point){
    const stage=context?mapPoint(context.matrix,p):p;
    return {x:20+(stage.x-view.left)*view.scale,y:20+(stage.y-view.top)*view.scale};
  }
  function hierarchyLocal(p:Point){
    const stage={x:(p.x-20)/view.scale+view.left,y:(p.y-20)/view.scale+view.top};
    return context?inversePoint(context.matrix,stage):stage;
  }
  function hierarchyRotationHandle(){
    try{
      if(!hierarchySelectedIds.length || hierarchyBlocked)return null;
      const pivot=hierarchyMove?.pivot ?? symbolTransformPivot(artwork,hierarchySelectedIds,
        hierarchyCustomPivot?hierarchyTransformPivot:undefined);
      const center=hierarchyScreen(pivot);
      if(!Number.isFinite(center.x) || !Number.isFinite(center.y))return null;
      const base=hierarchyLocal({x:center.x,y:center.y+(center.y<40?32:-32)});
      const angle=(hierarchyMove?.rotation ?? 0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
      const knob=hierarchyScreen({x:pivot.x+c*(base.x-pivot.x)-s*(base.y-pivot.y),
        y:pivot.y+s*(base.x-pivot.x)+c*(base.y-pivot.y)});
      if(!Number.isFinite(knob.x) || !Number.isFinite(knob.y))return null;
      return {pivot,center,knob};
    }catch{return null;}
  }
  function hierarchyScaleHandles(){
    try{
      if(!hierarchySelectedIds.length || hierarchyBlocked)return [];
      const box=hierarchyMove?.box ?? symbolTransformBounds(artwork,hierarchySelectedIds);
      const locations=[{id:'nw',x:box.left,y:box.top},{id:'ne',x:box.right,y:box.top},
        {id:'se',x:box.right,y:box.bottom},{id:'sw',x:box.left,y:box.bottom},
        {id:'scale-n',x:(box.left+box.right)/2,y:box.top},
        {id:'scale-e',x:box.right,y:(box.top+box.bottom)/2},
        {id:'scale-s',x:(box.left+box.right)/2,y:box.bottom},
        {id:'scale-w',x:box.left,y:(box.top+box.bottom)/2}];
      return locations.map(location=>{
        const local=hierarchyMove?.operation?mapPoint(hierarchyMove.operation,location):location;
        return {id:canvasTool==='hierarchy-skew'?location.id.replace('scale-','skew-'):location.id,point:hierarchyScreen(local)};
      }).filter(handle=>Number.isFinite(handle.point.x) && Number.isFinite(handle.point.y));
    }catch{return [];}
  }
  function hierarchyMoveDown(event:PointerEvent){
    if(event.button!==0 || hierarchyMove)return;
    try{
      const owner=captureSymbolHierarchyDrag(),p=point(event);
      const rotating=canvasTool==='hierarchy-rotate';
      let pivot:Point|undefined,box:ReturnType<typeof symbolTransformBounds>|undefined,handle:string|undefined;
      if(canvasTool==='hierarchy-scale' || canvasTool==='hierarchy-skew'){
        box=symbolTransformBounds(owner.snapshot,owner.ids);
        pivot=symbolTransformPivot(owner.snapshot,owner.ids,hierarchyCustomPivot?hierarchyTransformPivot:undefined);
        const screen=hierarchyScreen(p);
        handle=hierarchyScaleHandles().filter(item=>canvasTool!=='hierarchy-skew'||item.id.startsWith('skew-'))
          .map(item=>({...item,distance:Math.hypot(screen.x-item.point.x,screen.y-item.point.y)}))
          .sort((a,b)=>a.distance-b.distance || Number(b.id.startsWith('scale-'))-Number(a.id.startsWith('scale-')))
          .find(item=>item.distance<=8)?.id;
        if(!handle)return;
      }else if(rotating){
        pivot=symbolTransformPivot(owner.snapshot,owner.ids,hierarchyCustomPivot?hierarchyTransformPivot:undefined);
        const handle=hierarchyRotationHandle(),screen=hierarchyScreen(p);
        if(!handle || Math.hypot(screen.x-handle.knob.x,screen.y-handle.knob.y)>8)return;
      }else{
        const picked=[...owner.snapshot].reverse().find(item=>hit(item,p,2/view.scale));
        if(!picked || !owner.ids.some(id=>selectionUnit(owner.snapshot.find(item=>item.id===id)!,0)===selectionUnit(picked,0)))return;
      }
      event.preventDefault();canvas.focus({preventScroll:true});
      cancelSymbolHierarchyDrag();cancelHierarchyPick();
      hierarchyMove={owner,pointer:event.pointerId,start:p,view:{...view},rect:hierarchyRect(),
        preview:owner.snapshot,dx:0,dy:0,mode:canvasTool,pivot,pivotConfig:hierarchyPivotConfig(),
        rotation:0,angle:0,lastAngle:pivot?Math.atan2(p.y-pivot.y,p.x-pivot.x):0,box,handle,scaled:false};
      canvas.setPointerCapture(event.pointerId);error='';
    }catch(cause){cancelHierarchyMove();error=String(cause);}
  }
  function updateHierarchyMove(event:PointerEvent){
    const job=hierarchyMove;
    if(!job || job.pointer!==event.pointerId)return;
    if(!hierarchyMoveCurrent(job) || !canvas.hasPointerCapture(job.pointer)){cancelHierarchyMove();return;}
    try{
      const p=point(event);let dx=p.x-job.start.x,dy=p.y-job.start.y;
      let rotation=0,lastAngle=job.lastAngle,angle=job.angle;
      let next:Vector[],operation:Matrix|undefined,scaled=false;
      if(job.mode==='hierarchy-scale' || job.mode==='hierarchy-skew'){
        operation=rangeHandleTransform(job.handle!,job.box!,job.pivot!,job.start,p,event.shiftKey,event.altKey);
        scaled=operation.some((value,i)=>value!==[1,0,0,1,0,0][i]);
        dx=0;dy=0;
        next=affineSymbolChildren(job.owner.snapshot,job.owner.ids,operation);
      }else if(job.mode==='hierarchy-rotate'){
        const pivot=job.pivot!;
        if(p.x===pivot.x && p.y===pivot.y){cancelHierarchyMove();return;}
        lastAngle=Math.atan2(p.y-pivot.y,p.x-pivot.x);
        const delta=lastAngle-job.lastAngle;angle+=Math.atan2(Math.sin(delta),Math.cos(delta));
        rotation=angle*180/Math.PI;
        if(event.shiftKey)rotation=Math.round(rotation/15)*15;
        dx=0;dy=0;
        next=transformSymbolChildren(job.owner.snapshot,job.owner.ids,
          {dx:0,dy:0,rotation,scaleX:1,scaleY:1,pivot});
      }else{
        if(event.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}
        next=moveSymbolChildren(job.owner.snapshot,job.owner.ids,dx,dy);
      }
      validate(next);
      if(!hierarchyMoveCurrent(job)){cancelHierarchyMove();return;}
      hierarchyMove={...job,preview:next,dx,dy,rotation,lastAngle,angle,operation,scaled};
    }catch(cause){cancelHierarchyMove();error=String(cause);}
  }
  function hierarchyMoveUp(event:PointerEvent){
    if(hierarchyMove?.pointer!==event.pointerId)return;
    updateHierarchyMove(event);
    const job=hierarchyMove;
    if(!job)return;
    cancelHierarchyMove();
    if(!hierarchyMoveCurrent(job) || (!job.dx && !job.dy && !job.rotation && !job.scaled))return;
    // updateHierarchyMove regenerated the final candidate from the original, not the preview.
    try{publishHierarchyCandidate(job.owner,job.preview,job.owner.ids,job.owner.selected,()=>hierarchyMoveCurrent(job));}catch(cause){error=String(cause);}
  }
  $effect(()=>{
    if(hierarchyMove && !hierarchyMoveCurrent(hierarchyMove))cancelHierarchyMove();
  });
  function transformHierarchyUnits(){
    try {
      const job=captureSymbolHierarchyDrag();
      const input=JSON.stringify([groupTransform,hierarchyCustomPivot,hierarchyTransformPivot]);
      const next=transformSymbolChildren(job.snapshot,job.ids,{
        ...groupTransform,scaleX:groupTransform.scaleX/100,scaleY:groupTransform.scaleY/100,
        pivot:hierarchyCustomPivot?{...hierarchyTransformPivot}:undefined
      });
      validate(next);
      if(!symbolHierarchyCurrent(job))throw new Error('Symbol hierarchy context changed before transform.');
      publishHierarchyCandidate(job,next,job.ids,job.selected,()=>JSON.stringify([groupTransform,hierarchyCustomPivot,hierarchyTransformPivot])===input);
    } catch(cause){error=String(cause);}
  }
  function symbolHierarchyCurrent(job:NonNullable<typeof symbolHierarchyDrag>){
    return alive && !hierarchyBlocked && !drag && !penGesture && !nodeGesture && !paintGesture && !nodeMarquee &&
      artwork===job.source && JSON.stringify(artwork)===job.signature && selected===job.selected &&
      hierarchyBoundary===job.boundary && validate===job.validator && past===job.past && future===job.future && JSON.stringify(hierarchySelectedIds)===JSON.stringify(job.ids);
  }
  $effect(()=>{
    if(symbolHierarchyDrag && !symbolHierarchyCurrent(symbolHierarchyDrag))cancelSymbolHierarchyDrag();
  });
  function startSymbolHierarchyDrag(event:DragEvent){
    try{
      const job=captureSymbolHierarchyDrag();
      if(!event.dataTransfer)throw new Error('Hierarchy drag transport is unavailable.');
      event.dataTransfer.setData('application/x-splash-hierarchy',job.token);
      event.dataTransfer.effectAllowed='move';symbolHierarchyDrag=job;error='';
    }catch(cause){event.preventDefault();cancelSymbolHierarchyDrag();error=String(cause);}
  }
  function overSymbolHierarchyDrag(event:DragEvent){
    if(symbolHierarchyDrag && symbolHierarchyCurrent(symbolHierarchyDrag) &&
        event.dataTransfer?.types.includes('application/x-splash-hierarchy')){
      event.preventDefault();event.dataTransfer.dropEffect='move';
    }
  }
  function publishSymbolHierarchy(job:NonNullable<typeof symbolHierarchyDrag>,target:HierarchyTarget){
    if(!symbolHierarchyCurrent(job))throw new Error('Symbol artwork, selection or enclosing context changed. Start a new drag.');
    const destination=[...target.destination];
    if(!hierarchyEntries.some(entry=>entry.value===JSON.stringify(destination) &&
        (!target.anchor || entry.anchors.some(anchor=>anchor.id===target.anchor))))
      throw new Error('Symbol hierarchy destination or anchor changed.');
    const next=structuredClone(job.snapshot);
    reparentVectors(next,job.ids,[],destination,target.anchor?{anchor:target.anchor,side:target.side!}:undefined);
    // Includes every enclosing group/timeline and the original aggregate library budget.
    validate(next);
    if(!symbolHierarchyCurrent(job))throw new Error('Symbol hierarchy context changed before placement.');
    cancelSymbolHierarchyDrag();
    change(()=>{artwork=next;});
  }
  function dropSymbolHierarchyDrag(event:DragEvent,target:HierarchyTarget){
    event.preventDefault();
    const job=symbolHierarchyDrag;
    try{
      if(!job || event.dataTransfer?.getData('application/x-splash-hierarchy')!==job.token)
        throw new Error('Start a new hierarchy drag in this symbol editor.');
      publishSymbolHierarchy(job,target);
    }catch(cause){error=String(cause);}
    finally{cancelSymbolHierarchyDrag();}
  }
  function placeSymbolHierarchy(target:HierarchyTarget){
    try{publishSymbolHierarchy(captureSymbolHierarchyDrag(),target);}
    catch(cause){error=String(cause);}
    finally{cancelSymbolHierarchyDrag();}
  }
  function moveToGroup() {
    if (!shape || penDraft || brushBusy || inkBusy || groupEditing ||
        (groupDestination === '[]' && groupPlacement === 'append')) return;
    change(() => {
      if (!groupDestinations.some((entry) => entry.value === groupDestination))
        throw new Error('Destination group changed. Select an existing group.');
      const next = clone(artwork);
      reparentVectors(next, [selected], [], JSON.parse(groupDestination),
        groupPlacement === 'append' ? undefined : {anchor: groupAnchor, side: groupPlacement});
      // change validates through every enclosing isolation/timeline before recording history.
      artwork = next;
    });
  }
  function extractItemFromGroup() {
    if (!shape?.groups?.length || penDraft || brushBusy || inkBusy || groupEditing) return;
    change((item) => {
      const scope = [...item.groups!];
      const next = clone(artwork);
      reparentVectors(next, [item.id], scope, scope.slice(0, -1));
      artwork = next;
    });
  }
  function number(field: NumericField, value: string) {
    const n = Number(value);
    if (!value.trim() || !Number.isFinite(n)) {
      error = 'Enter a finite number.';
      return;
    }
    change((s) => {
      if (field === 'width' || field === 'height') {
        if (n <= 0 || !s[field]) throw new Error('Resize requires positive dimensions.');
        scaleVector(s, field === 'width' ? n / s.width : 1, field === 'height' ? n / s.height : 1);
      } else {
        if (field === 'opacity' && (n < 0 || n > 1))
          throw new Error('Opacity must be between 0 and 1.');
        if (field === 'strokeWidth' && n < 0) throw new Error('Stroke width must be nonnegative.');
        s[field] = n;
      }
    });
  }
  function undo(redo = false) {
    if(simplifyJob || drawingQueue.length)return;
    simplifyInfo='';
    textRange = null;
    discardPen();
    cancelDrag();
    const source = redo ? future : past;
    if (!source.length) return;
    const next = source.at(-1)!.read(), destination = redo ? past : future;
    const inverse = new HistoryEntry<Snapshot>({ artwork, selected,
      ...(next.hierarchy ? { hierarchy: [...hierarchySelectedIds] } : {}) });
    const moved = moveHistory(source, destination, inverse);
    if (source !== (redo ? future : past) || destination !== (redo ? past : future)) return;
    past = redo ? moved.destination : moved.source;
    future = redo ? moved.source : moved.destination;
    artwork = next.artwork;
    selected = next.selected;
    if(next.hierarchy){preserveHierarchyOnce=true;hierarchySelection=[...next.hierarchy];}
    nodeIndex = 0;
    nodeSelection = [0];
    acrossNodes = {};
    nodeFocusId = selected;
    error = '';
  }
  export function flush():string|null{
    if (previewOnly) return null;
    if(inlineText&&!inlineTextEditor?.finish())return 'Finish or cancel the current text edit before changing frames.';
    if(embedded&&(!alive||hierarchyOwner!==workspaceBoundary))return 'The previous frame editor is closing. Try the frame command again.';
    if(inlineTextPress||penDraft||brushBusy||inkBusy||drag||penGesture||nodeGesture||paintGesture||nodeMarquee||hierarchyMove||hierarchyPick||symbolHierarchyDrag||simplifyJob)return 'Finish or cancel the current artwork edit before changing frames.';
    const active=document.activeElement;if(active instanceof HTMLElement&&dialog.contains(active))active.blur();
    if(JSON.stringify(artwork)===JSON.stringify(definition.shapes))return null;
    applyArtwork();return error||null;
  }
  function embeddedCamera(){
    const rect=canvas.getBoundingClientRect(),scale=stageCamera!.zoom*canvasWidth/rect.width;
    return {scale,left:(20-(stageCamera!.x-rect.left)*canvasWidth/rect.width)/scale,top:(20-(stageCamera!.y-rect.top)*canvasHeight/rect.height)/scale};
  }
  let applyingArtwork=false,artworkApplyReentered=false;
  function applyArtwork(){
    if (brushBusy) return;
    if(!originalSimplify&&!embedded){error=apply(clone(artwork))??'';return;}
    if(applyingArtwork){artworkApplyReentered=true;error='Symbol artwork publication cannot reenter.';return;}
    applyingArtwork=true;artworkApplyReentered=false;
    try{
      validateLiveGraphicData(artwork);
      const source=artwork,signature=simplifyStamp($state.snapshot(artwork)),oldPast=past,oldFuture=future,active=selected,
        ids=JSON.stringify(hierarchySelectedIds),mode=canvasTool,boundary=hierarchyBoundary,revision=simplifyInputRevision,publisher=apply;
      let enclosing:StaticSymbolSimplifyContext|undefined;
      const original=()=>{
        validateLiveGraphicData(artwork);
        if(artworkApplyReentered||!alive||artwork!==source||simplifyStamp($state.snapshot(artwork))!==signature||past!==oldPast||future!==oldFuture||
          selected!==active||JSON.stringify(hierarchySelectedIds)!==ids||canvasTool!==mode||hierarchyBoundary!==boundary||simplifyInputRevision!==revision||apply!==publisher||
          penDraft||brushBusy||inkBusy||drag||penGesture||nodeGesture||paintGesture||nodeMarquee||hierarchyMove||hierarchyPick||symbolHierarchyDrag||simplifyJob)
          throw Error('Original symbol artwork or inputs changed during Apply.');
      };
      const current=()=>{original();enclosing?.validate();original();};current();
      const snapshot=structuredClone($state.snapshot(artwork));assertSymbolSimplifyDetached(source,snapshot);current();
      if(simplifyStamp(snapshot)!==signature)throw Error('Original symbol Apply snapshot changed.');
      enclosing=originalSimplify?.(snapshot);current();error=publisher(snapshot,current)??'';
    }catch(cause){error=String(cause);}finally{applyingArtwork=false;}
  }
  const originalSimplify=untrack(()=>simplify);
  const workspaceBoundary=untrack(()=>hierarchyOwner);
  const originalFrameSimplify=untrack(()=>frameSimplify);
  let simplifyInfo=$state(''),simplifyInputRevision=$state(0);
  type SimplifyJob={
    controller:AbortController;source:Vector[];snapshot:Vector[];signature:string;boundary:string;
    selected:string;ids:string[];mode:typeof canvasTool;past:HistoryEntry<Snapshot>[];future:HistoryEntry<Snapshot>[];
    validate:typeof validate;context:StaticSymbolSimplifyContext;
  };
  let simplifyJob=$state.raw<SimplifyJob>();
  const simplifyBlocked=$derived(!!inlineText||!originalSimplify||!simplify||frameSimplify!==originalFrameSimplify||(!originalFrameSimplify&&(!!definition.timeline||!!definition.buttonStates))||!hierarchySelectedIds.length||
    !!penDraft||brushBusy||inkBusy||!!groupEditing||!!drag||!!penGesture||!!nodeGesture||!!paintGesture||!!nodeMarquee||!!hierarchyMove||!!hierarchyPick||!!symbolHierarchyDrag);
  function cancelSimplification(message=''){
    const job=simplifyJob;simplifyJob=undefined;job?.controller.abort();
    if(message&&alive)simplifyInfo=message;
  }
  function currentSimplification(job:SimplifyJob){
    job.controller.signal.throwIfAborted();job.context.validate();
    validateLiveGraphicData($state.snapshot(artwork));
    if(!alive||simplifyJob!==job||artwork!==job.source||simplifyStamp($state.snapshot(artwork))!==job.signature||
      hierarchyBoundary!==job.boundary||selected!==job.selected||canvasTool!==job.mode||past!==job.past||future!==job.future||validate!==job.validate||
      JSON.stringify(hierarchySelectedIds)!==JSON.stringify(job.ids)||simplifyBlocked)
      throw Error('Symbol artwork, selection or editing context changed. Try Simplify again.');
  }
  async function simplifySelectedArtwork(){
    if(simplifyJob||simplifyBlocked||!originalSimplify)return;
    let job:SimplifyJob|undefined;
    try{
      const source=artwork,snapshot=structuredClone($state.snapshot(artwork));
      validateLiveGraphicData(snapshot);assertSymbolSimplifyDetached(source,snapshot);
      const signature=simplifyStamp(snapshot),boundary=hierarchyBoundary,active=selected,ids=[...hierarchySelectedIds],mode=canvasTool,oldPast=past,oldFuture=future,validator=validate;
      const enclosing=originalSimplify(snapshot);enclosing.validate();
      if(artwork!==source||simplifyStamp($state.snapshot(artwork))!==signature||hierarchyBoundary!==boundary||selected!==active||canvasTool!==mode||past!==oldPast||future!==oldFuture||validate!==validator||JSON.stringify(hierarchySelectedIds)!==JSON.stringify(ids)||simplifyBlocked)
        throw Error('Symbol source changed before background preparation.');
      job={controller:new AbortController(),source,snapshot,signature,boundary,selected:active,ids,mode,past:oldPast,future:oldFuture,validate:validator,context:enclosing};
      simplifyJob=job;error='';simplifyInfo='';currentSimplification(job);
      const result=await simplifySymbolArtworkInWorker({project:enclosing.project,symbolId:definition.id,selected:ids,...(enclosing.location?{location:enclosing.location}:{}),...(enclosing.ancestry?{ancestry:[...enclosing.ancestry]}:{})},job.controller.signal);
      currentSimplification(job);
      const replacement=enclosing.extract?enclosing.extract(result.project):result.project.symbols!.find(s=>s.id===definition.id)!.shapes,expected=simplifyStamp(replacement),next=structuredClone(replacement);
      assertSymbolSimplifyDetached(result,next);assertSymbolSimplifyDetached(source,next);validateLiveGraphicData(next);
      job.validate(next);currentSimplification(job);
      if(simplifyStamp(replacement)!==expected||simplifyStamp(next)!==expected)throw Error('Prepared symbol artwork changed after copying.');
      if(!result.removed){simplifyInfo='No removable vertices in this selection.';return;}
      const before=structuredClone(snapshot);assertSymbolSimplifyDetached(source,before);
      const nextPast=appendHistory(job.past, new HistoryEntry<Snapshot>({artwork:before,selected:job.selected,hierarchy:[...job.ids]}));
      if(simplifyStamp(before)!==signature)throw Error('Original symbol history snapshot changed.');
      currentSimplification(job);
      preserveHierarchyOnce=true;artwork=next;past=nextPast;future=[];selected=job.selected;hierarchySelection=[...job.ids];
      nodeIndex=0;nodeSelection=[0];acrossNodes={};nodeFocusId=selected;
      simplifyInfo=`Removed ${result.removed} vertices.`;
    }catch(cause){if(alive&&(!job||simplifyJob===job))error=String(cause);}
    finally{if(job&&simplifyJob===job)simplifyJob=undefined;}
  }
  $effect(()=>{const job=simplifyJob;if(job){try{currentSimplification(job);}catch{cancelSimplification('Symbol source or selection changed. Simplification cancelled.');}}});
  // Stationary artwork can outlive native capture while the complete stroke
  // drains to its bitmap and the worker finishes. Source admission remains
  // independent of the retained raster and is refreshed on actual edits.
  const artworkSignature = $derived(JSON.stringify(artwork));
  const propertySliderScope=$derived({source:artworkSignature,boundary:hierarchyBoundary,selected});
  // Neither key includes the growing sample array. Pending display artwork is
  // separately keyed: it must never inherit a raster for a different scene.
  const brushSceneSignature = $derived(JSON.stringify([artworkSignature, assets, symbols, context, definition, penSource?.id]));
  const brushView = $derived(drag && drag.kind !== 'select' ? drag.view : drawingQueue[0]?.view);
  const brushSceneKey = $derived(brushSceneSignature + ':' + JSON.stringify([brushView, viewport, stageWidth, stageHeight]));
  const brushSelectionBounds = $derived(shape ? objectBounds(shape) : undefined);
  let brushScene: {
    key: string;
    expanded: Vector[];
    fitted: { left: number; top: number; scale: number };
    under: HTMLCanvasElement;
    over?: HTMLCanvasElement;
  } | undefined;
  function brushResourceReady() {
    brushScene = undefined;
    if (alive) paint();
  }
  function paint() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const displayArtwork=inlineText&&inlineTextPreview?(inlineText.owner?artwork.map(v=>v.id===inlineText!.owner?inlineTextPreview!:v):[...artwork,inlineTextPreview]):hierarchyMove?.preview ?? artwork;
    const displayingBrush = !!liveBrush || !!liveMark || drawingQueue.length > 0;
    const cacheKey = displayingBrush ? brushSceneKey : '';
    if (!displayingBrush || brushScene?.key !== cacheKey) brushScene = undefined;
    const retained = brushScene;
    const expanded = playbackTracks?.flatMap(track => track.artwork) ?? retained?.expanded ?? expandSymbols(
      { symbols },
      displayArtwork.filter((s) => !penSource || s.id !== penSource.id),
      context?.artworkFrame ?? 0,
    );
    const bounds = retained ? [] : expanded.map(objectBounds),
      left = Math.min(0, ...bounds.map((b) => b.left)),
      top = Math.min(0, ...bounds.map((b) => b.top));
    const right = Math.max(definition.width, ...bounds.map((b) => b.right)),
      bottom = Math.max(definition.height, ...bounds.map((b) => b.bottom));
    const fitted = retained?.fitted ?? (embedded && stageCamera ? embeddedCamera() : context
      ? { left: 0, top: 0, scale: Math.min(500 / context.width, 290 / context.height) }
      : {
          left,
          top,
          scale: Math.min(500 / Math.max(1, right - left), 290 / Math.max(1, bottom - top)),
        });
    const box = canvas.getBoundingClientRect();
    const hasNavigation = embedded || viewport.scale !== 1 || viewport.pan.x !== 0 || viewport.pan.y !== 0;
    const navigated = hasNavigation && box.width > 0 && box.height > 0 ? {
      scale: fitted.scale * viewport.scale,
      left: (fitted.left * fitted.scale - viewport.pan.x * canvasWidth / box.width) / (fitted.scale * viewport.scale),
      top: (fitted.top * fitted.scale - viewport.pan.y * canvasHeight / box.height) / (fitted.scale * viewport.scale),
    } : fitted;
    if (box.width > 0 && box.height > 0) {
      cameraBase = {
        zoom: fitted.scale * box.width / canvasWidth,
        origin: {
          x: (20 - fitted.left * fitted.scale) * box.width / canvasWidth,
          y: (20 - fitted.top * fitted.scale) * box.height / canvasHeight,
        },
      };
      workspaceZoom = navigated.scale * box.width / canvasWidth;
    }
    view =
      inlineText?.view ?? hierarchyMove?.view ??
      nodeMarquee?.view ??
      paintGesture?.view ??
      nodeGesture?.view ??
      drag?.view ??
      brushView ??
      penView ??
      navigated;
    const scale = view.scale;
    const textView=multiply([scale,0,0,scale,20-view.left*scale,20-view.top*scale],context?.matrix??[1,0,0,1,0,0]);if(JSON.stringify(textView)!==JSON.stringify(inlineTextView))inlineTextView=textView;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.setLineDash([]);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    if (retained) ctx.drawImage(retained.under, 0, 0);
    else {
      ctx.fillStyle = embedded&&stageCamera&&context ? '#3c3f48' : (context?.background ?? '#ffffff');
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    ctx.translate(20 - view.left * scale, 20 - view.top * scale);
    ctx.scale(scale, scale);
    if(!retained&&embedded&&stageCamera&&context){ctx.fillStyle=context.background;ctx.fillRect(0,0,context.width,context.height);}
    if (context) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      if (!retained) context.under.forEach((s,i) => context.underOutline?.[i] ? drawLayerOutline(ctx,s,context.underOutline[i]!,1/scale,assets,brushResourceReady) : drawShape(ctx, s, assets, brushResourceReady));
      ctx.restore();
      ctx.save();
      ctx.transform(...context.matrix);
      ctx.globalAlpha = context.opacity;
    }
    if (playbackTracks) {
      for (const track of playbackTracks)
        for (const s of track.artwork)
          if (track.outlineColor) drawLayerOutline(ctx, s, track.outlineColor, 1 / scale, assets, brushResourceReady);
          else drawShape(ctx, s, assets, brushResourceReady);
    } else if (!retained) expanded.forEach((s) => outline ? drawLayerOutline(ctx,s,outlineColor,1/scale,assets,brushResourceReady) : drawShape(ctx, s, assets, brushResourceReady));
    if (displayingBrush && !retained) {
      const under = document.createElement('canvas');
      under.width = canvas.width; under.height = canvas.height;
      under.getContext('2d')!.drawImage(canvas, 0, 0);
      brushScene = { key: cacheKey, expanded, fitted, under };
    }
    if (displayingBrush) brushPreview.drawQueue(ctx, drawingQueue.flatMap(job => job.kind === 'paint' ? [] : [job.stroke]), liveBrush ?? liveMark,
      mark => drawShape(ctx, mark, assets, brushResourceReady));
    else brushPreview.clear();
    if (context) {
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.3;
      if (displayingBrush && brushScene) {
        if (!brushScene.over) {
          const over = document.createElement('canvas');
          over.width = canvas.width; over.height = canvas.height;
          const target = over.getContext('2d')!;
          target.setTransform(ctx.getTransform()); target.globalAlpha = ctx.globalAlpha;
          context.over.forEach((s,i) => context.overOutline?.[i] ? drawLayerOutline(target,s,context.overOutline[i]!,1/scale,assets,brushResourceReady) : drawShape(target, s, assets, brushResourceReady));
          brushScene.over = over;
        }
        ctx.save(); ctx.resetTransform(); ctx.globalAlpha = 1;
        ctx.drawImage(brushScene.over, 0, 0); ctx.restore();
      } else context.over.forEach((s,i) => context.overOutline?.[i] ? drawLayerOutline(ctx,s,context.overOutline[i]!,1/scale,assets,brushResourceReady) : drawShape(ctx, s, assets, brushResourceReady));
      ctx.restore();
      ctx.transform(...context.matrix);
    }
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([4 / scale, 4 / scale]);
    ctx.strokeRect(0, 0, definition.width, definition.height);
    if((canvasTool==='select'&&hierarchySelection!==null)||canvasTool==='hierarchy' || canvasTool==='hierarchy-move' || canvasTool==='hierarchy-rotate' || canvasTool==='hierarchy-scale' || canvasTool==='hierarchy-skew'){
      const units=new SvelteSet(artwork.filter(item=>hierarchySelectedIds.includes(item.id)).map(item=>selectionUnit(item,0)));
      ctx.setLineDash([]);ctx.strokeStyle='#0891b2';
      for(const item of displayArtwork)if(units.has(selectionUnit(item,0))){
        const b=objectBounds(item);ctx.strokeRect(b.left,b.top,b.right-b.left,b.bottom-b.top);
      }
    }
    if (nodeMarquee) {
      const { start, end } = nodeMarquee;
      ctx.strokeStyle = '#0891b2';
      if (nodeMarquee.form === 'lasso') {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        for (const p of nodeMarquee.ring.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.stroke();
      } else ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
    }
    if (penDraft) {
      drawShape(ctx, penDraft, assets, paint);
      ctx.setLineDash([]);
      ctx.strokeStyle = '#0891b2';
      ctx.fillStyle = '#ffffff';
      ctx.lineWidth = 1 / scale;
      for (const node of penDraft.nodes ?? []) {
        const n = {
          ...worldPoint(penDraft, node),
          in: node.in && worldPoint(penDraft, node.in),
          out: node.out && worldPoint(penDraft, node.out),
        };
        for (const h of [n.in, n.out])
          if (h) {
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(h.x, h.y);
            ctx.stroke();
          }
        ctx.fillRect(n.x - 3 / scale, n.y - 3 / scale, 6 / scale, 6 / scale);
        ctx.strokeRect(n.x - 3 / scale, n.y - 3 / scale, 6 / scale, 6 / scale);
      }
    }
    if (canvasTool === 'pen' && penHover && !penGesture && !temporarySelectionCursor) {
      const preview = penDraft ? penPreview(penDraft, penHover, scale, penHoverShift ? 45 : 0) : undefined;
      const pickup = !penDraft && shape ? penEndpoint(shape, penHover, scale) : undefined;
      ctx.setLineDash([3 / scale, 3 / scale]);
      ctx.strokeStyle = '#0891b2';
      ctx.lineWidth = 1 / scale;
      if (preview) {
        ctx.beginPath();
        ctx.moveTo(preview.from.x, preview.from.y);
        ctx.bezierCurveTo(
          preview.out.x,
          preview.out.y,
          preview.into.x,
          preview.into.y,
          preview.to.x,
          preview.to.y,
        );
        ctx.stroke();
      }
      const target =
        pickup?.point ??
        (preview?.kind === 'close' || preview?.kind === 'corner' ? preview.to : null);
      if (target) {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(target.x, target.y, 6 / scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (canvasTool === 'nodes')
      for (const item of nodeItems()) {
        const active = new Set(selectedNodes(item));
        ctx.setLineDash([]);
        ctx.strokeStyle = '#0891b2';
        ctx.lineWidth = 1 / scale;
        editableNodes(item).forEach((n, i) => {
          const p = worldPoint(item, n);
          if (i === nodeIndex && item.id === (acrossArtwork ? nodeFocusId : selected))
            for (const part of ['in', 'out'] as const)
              if (n[part]) {
                const h = worldPoint(item, n[part]!);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(h.x, h.y);
                ctx.stroke();
                ctx.fillStyle = '#ffb347';
                ctx.fillRect(h.x - 3 / scale, h.y - 3 / scale, 6 / scale, 6 / scale);
              }
          ctx.fillStyle = active.has(i) ? '#00cfff' : '#ffffff';
          ctx.fillRect(p.x - 3 / scale, p.y - 3 / scale, 6 / scale, 6 / scale);
          ctx.strokeRect(p.x - 3 / scale, p.y - 3 / scale, 6 / scale, 6 / scale);
        });
      }
    if (
      shape &&
      ((canvasTool === 'bitmap' && shape.bitmap) || (canvasTool === 'gradient' && shape.gradient))
    ) {
      const points = (['origin', 'x', 'y'] as const).map((part) =>
        worldPoint(shape, paintHandle(shape, part)),
      );
      ctx.setLineDash([]);
      ctx.strokeStyle = '#db2777';
      ctx.fillStyle = '#ffffff';
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.moveTo(points[1].x, points[1].y);
      ctx.lineTo(points[0].x, points[0].y);
      ctx.lineTo(points[2].x, points[2].y);
      ctx.stroke();
      points.forEach((p) => {
        ctx.fillRect(p.x - 4 / scale, p.y - 4 / scale, 8 / scale, 8 / scale);
        ctx.strokeRect(p.x - 4 / scale, p.y - 4 / scale, 8 / scale, 8 / scale);
      });
      if (shape.gradient)
        shape.gradient.stops.forEach((stop, i) => {
          const p = worldPoint(shape!, gradientStopPoint(shape!.gradient!, i));
          p.y += 14 / scale;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4 / scale, 0, Math.PI * 2);
          ctx.fillStyle = stop.color;
          ctx.fill();
          ctx.strokeStyle = '#171b27';
          ctx.stroke();
        });
    }
    if(canvasTool==='hierarchy-scale' || canvasTool==='hierarchy-skew'){
      const handles=hierarchyScaleHandles();
      ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.setLineDash([]);ctx.lineWidth=1;
      ctx.strokeStyle='#0891b2';ctx.fillStyle='#ffffff';
      const corners=handles.filter(handle=>!handle.id.includes('-'));
      if(corners.length===4){
        ctx.beginPath();ctx.moveTo(corners[0].point.x,corners[0].point.y);
        for(const handle of corners.slice(1))ctx.lineTo(handle.point.x,handle.point.y);
        ctx.closePath();ctx.stroke();
      }
      for(const handle of handles){
        if(canvasTool==='hierarchy-skew'){
          if(!handle.id.startsWith('skew-'))continue;
          ctx.beginPath();ctx.moveTo(handle.point.x,handle.point.y-5);ctx.lineTo(handle.point.x+5,handle.point.y);
          ctx.lineTo(handle.point.x,handle.point.y+5);ctx.lineTo(handle.point.x-5,handle.point.y);ctx.closePath();ctx.fill();ctx.stroke();
        }else{ctx.fillRect(handle.point.x-3.5,handle.point.y-3.5,7,7);ctx.strokeRect(handle.point.x-3.5,handle.point.y-3.5,7,7);}
      }
      try{
        const pivot=hierarchyScreen(hierarchyMove?.pivot ?? symbolTransformPivot(artwork,hierarchySelectedIds,
          hierarchyCustomPivot?hierarchyTransformPivot:undefined));
        if(Number.isFinite(pivot.x) && Number.isFinite(pivot.y)){
          ctx.beginPath();ctx.moveTo(pivot.x-5,pivot.y);ctx.lineTo(pivot.x+5,pivot.y);
          ctx.moveTo(pivot.x,pivot.y-5);ctx.lineTo(pivot.x,pivot.y+5);ctx.stroke();
        }
      }catch{/* An invalid pivot cannot start a gesture. */}

      ctx.restore();
    }
    if(canvasTool==='hierarchy-rotate'){
      const handle=hierarchyRotationHandle();
      if(handle){
        ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.setLineDash([]);ctx.lineWidth=1;
        ctx.strokeStyle='#0891b2';ctx.fillStyle='#ffffff';
        ctx.beginPath();ctx.moveTo(handle.center.x,handle.center.y);ctx.lineTo(handle.knob.x,handle.knob.y);ctx.stroke();
        ctx.beginPath();ctx.arc(handle.knob.x,handle.knob.y,6,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.beginPath();ctx.moveTo(handle.center.x-5,handle.center.y);ctx.lineTo(handle.center.x+5,handle.center.y);
        ctx.moveTo(handle.center.x,handle.center.y-5);ctx.lineTo(handle.center.x,handle.center.y+5);ctx.stroke();
        ctx.restore();
      }
    }
    if (shape && !inlineText && !(canvasTool==='select'&&hierarchySelection!==null) && canvasTool!=='hierarchy' && canvasTool!=='hierarchy-move' && canvasTool!=='hierarchy-rotate' && canvasTool!=='hierarchy-scale' && canvasTool!=='hierarchy-skew') {
      const b = brushSelectionBounds!;
      ctx.setLineDash([]);
      ctx.strokeStyle = '#0891b2';
      ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    }
  }
  $effect(() => {
    void brushSampleRevision;
    // Keep these derived values subscribed even though rAF paints outside a
    // reactive effect. Unsubscribed derived reads can reserialize unchanged
    // original artwork every time the asynchronous painter reads them.
    void artworkSignature;
    void liveMark;
    void brushSceneKey;
    void brushSelectionBounds;
    JSON.stringify([
      artwork,
      selected,
      penDraft,
      penHover,
      penSource,
      canvasTool,
      nodeIndex,
      nodeSelection,
      acrossArtwork,
      acrossNodes,
      nodeFocusId,
      stageWidth,stageHeight,stageCamera,canvasWidth,canvasHeight,inlineTextPreview,viewport,playbackTracks,
      hierarchySelectedIds,
      hierarchyMove,
      hierarchyCustomPivot,
      hierarchyTransformPivot,
    ]);
    if (liveBrush || liveMark || drawingQueue.length) {
      // Keep input capture independent of display frequency. The preview owns
      // catch-up frames and retains every sample until vector finishing ends.
      void assets;
      void symbols;
      void context;
      void definition;
      brushPreview.requestDraw();
    } else paint();
  });
  $effect(() => {
    if (!embedded) return;
    const ready = stageWidth > 16 && stageHeight > 16;
    const camera = stageCamera;
    const min = minCanvasZoom, max = maxCanvasZoom;
    const raf = requestAnimationFrame(() => {
      if (!alive) return;
      paint();
      // Wait for layout before clamping. An in-place camera keeps its scene placement.
      if (!ready || camera) return;
      const next = clampCanvasZoom(workspaceZoom, min, max);
      if (Math.abs(next - workspaceZoom) > 1e-10) setWorkspaceZoom(next);
    });
    return () => cancelAnimationFrame(raf);
  });
  onMount(() => {
    if(!embedded)(dialog as HTMLDialogElement).showModal();
    const changed=(event:Event)=>{if((event.target as HTMLElement)?.closest('[data-canvas-text-input]'))return;simplifyInputRevision++;if(simplifyJob)cancelSimplification('Symbol inputs changed. Simplification cancelled.');};
    dialog.addEventListener('input',changed,true);dialog.addEventListener('change',changed,true);
    canvas.addEventListener('wheel', wheelWorkspaceZoom, { passive: false });
    paint();
    document.fonts?.addEventListener('loadingdone', brushResourceReady);
    return () => {canvasTouch.end();stopCanvasPan();canvas?.removeEventListener('wheel',wheelWorkspaceZoom);document.fonts?.removeEventListener('loadingdone', brushResourceReady);dialog.removeEventListener('input',changed,true);dialog.removeEventListener('change',changed,true);};
  });
</script>

<svelte:window onblur={()=>{spaceHand=false;temporarySelectionHeld=false;penHoverShift=false;canvasTouch.end();stopCanvasPan();cancelDrag();cancelSymbolHierarchyDrag();cancelHierarchyPick();cancelHierarchyMove();}}
  onkeyup={e=>{penHoverAlt=e.altKey;penHoverShift=e.shiftKey;if(e.key===' ')spaceHand=false;if(!e.ctrlKey&&!e.metaKey)temporarySelectionHeld=false;}} />

{#snippet artworkCanvas()}
  <div class="symbol-canvas-holder" style:width={embedded?`${Math.max(1,stageCamera?stageWidth:Math.min(stageWidth,stageHeight*540/330))}px`:'540px'}>
  <canvas
    bind:this={canvas}
    id={embedded ? 'symbol-workspace-canvas' : undefined}
    width={canvasWidth}
    height={canvasHeight}
    aria-label="Symbol artwork preview"
    class:eyedropper-cursor={canvasTool === 'eyedropper' && !temporaryHand && !canvasPanButtons}
    class:bucket-cursor={canvasTool === 'bucket' && !temporaryHand && !canvasPanButtons}
    class:ink-cursor={canvasTool === 'ink' && !temporaryHand && !canvasPanButtons}
    tabindex="0"
    onpointerdown={e => { if (!canvasTouch.down(e)) down(e); }}
    onpointermove={e => { if (!canvasTouch.move(e)) move(e); }}
    onpointerleave={() => {
      penHover = null;
    }}
    onpointerup={e => {
      if (!canvasTouch.finish(e) && !canvasNavigation.finish(e)) void up(e);
    }}
    onauxclick={e => { if (embedded && e.button === 1) e.preventDefault(); }}
    ondblclick={event=>{if(readOnly||temporaryHand||canvasPanButtons)return;if(canvasTool==='select'&&shape?.kind==='text'){beginInlineText(artwork.find(v=>v.id===shape.id),point(event));return;}if(embedded&&navigate&&canvasTool==='select'&&shape?.kind==='symbol'&&JSON.stringify(artwork)===JSON.stringify(definition.shapes)){error=navigate(shape.id)??'';return;}void selectConnectedSymbolStrokes(event);}}
    onpointercancel={e=>{if(canvasTouch.finish(e,true))return;stopCanvasPan(e.pointerId);if(temporarySelectionPointer===e.pointerId)cancelDrag();if(inlineTextPress?.pointer===e.pointerId)inlineTextPress=null;hierarchyPointerCancel(e);}}
    onlostpointercapture={e=>{if(canvasTouch.finish(e,true,true))return;stopCanvasPan(e.pointerId);if(temporarySelectionPointer===e.pointerId)cancelDrag();if(inlineTextPress?.pointer===e.pointerId)inlineTextPress=null;hierarchyPointerCancel(e);}}
    onkeydown={canvasKey}
    onblur={()=>{spaceHand=false;temporarySelectionHeld=false;if(canvasPanButtons===1)stopCanvasPan();}}
    style:cursor={canvasPanButtons?'grabbing':temporaryHand?'grab':temporarySelectionCursor?'default':freehandSelectionTool?penAnchorCursor(penAnchorHover)??'crosshair':undefined}
    style:width={embedded?`${Math.max(1,stageCamera?stageWidth:Math.min(stageWidth,stageHeight*540/330))}px`:undefined}
    style="touch-action:none"
  ></canvas>
  {#if inlineText}
    {#key inlineText.shape.id}<CanvasTextEditor bind:this={inlineTextEditor} shape={inlineText.shape} view={inlineTextView} width={canvasWidth} height={canvasHeight} initialPoint={inlineText.point} creating={!inlineText.owner} preview={v=>inlineTextPreview=v} apply={finishInlineText} formatting={style=>inlineTextStyle=style}
      selection={(start,end,content)=>{if(inlineText)textRange={owner:inlineText.shape.id,start,end,content};}}
      cancel={()=>{const owner=inlineText?.owner;inlineText=null;inlineTextPreview=null;selected=owner??'';canvas.focus();}} outside={down}/>{/key}
  {/if}
  </div>
{/snippet}

<svelte:element this={embedded?'section':'dialog'}
  class:embedded
  role={embedded?'region':undefined}
  bind:this={dialog}
  aria-label={isolated ? 'Edit isolated symbol group' : 'Edit symbol artwork'}
  onkeydown={(event:KeyboardEvent)=>{
    if(event.key==='Escape' && simplifyJob){event.preventDefault();event.stopPropagation();cancelSimplification('Simplification cancelled.');
    }else if(event.key==='Escape' && hierarchyMove){
      event.preventDefault();event.stopPropagation();cancelHierarchyMove();
    }else if(event.key==='Escape' && hierarchyPick){
      event.preventDefault();event.stopPropagation();cancelHierarchyPick();
    }else if(event.key==='Escape' && symbolHierarchyDrag){
      event.preventDefault();event.stopPropagation();cancelSymbolHierarchyDrag();
    } else if (!embedded && event.key === 'Tab') wrapDialogTab(event);
  }}
  oncancel={(e:Event) => {
    e.preventDefault();
    if(simplifyJob)cancelSimplification('Simplification cancelled.');
    else if(hierarchyMove)cancelHierarchyMove();
    else if(hierarchyPick)cancelHierarchyPick();
    else if(symbolHierarchyDrag)cancelSymbolHierarchyDrag();
    else if (penDraft) {
      cancelDrag();
      discardPen();
    } else if (drag || nodeGesture || paintGesture || nodeMarquee) cancelDrag();
    else cancel();
  }}
>
  {#if embedded}
    <nav class="embedded-tools" aria-label="Symbol drawing tools" inert={readOnly}>
      {#each symbolWorkspaceTools as item}
        <button disabled={inkBusy || !!simplifyJob} aria-disabled={(brushBusy && !(drawingQueue.length && queuedSymbolTool(item.mode))) || undefined} title={shortcutText(bindingFor(shortcutOverrides,toolShortcut(item.id)),macShortcuts) ? item.label+' ('+shortcutText(bindingFor(shortcutOverrides,toolShortcut(item.id)),macShortcuts)+')' : item.label} aria-label={item.label} aria-pressed={canvasTool===item.mode} onclick={()=>chooseCanvasTool(item.mode)}><ToolIcon tool={item.id}/></button>
      {/each}
    </nav>
    <div class="embedded-stage" bind:clientWidth={stageWidth} bind:clientHeight={stageHeight}>
      {@render artworkCanvas()}
      {#if stageWidth > 16 && stageHeight > 16}
        <CanvasScrollbars controls="symbol-workspace-canvas" width={stageWidth - 16} height={stageHeight - 16}
          documentWidth={context?.width ?? definition.width} documentHeight={context?.height ?? definition.height}
          zoom={workspaceZoom} pan={viewport.pan} blocked={() => !canNavigateCanvas() || !!canvasPanButtons}
          change={pan => viewport = { ...viewport, pan }}/>
      {/if}
      <div class="embedded-view-controls">
        <button onclick={fitWorkspace}>Fit</button>
        <select aria-label="Zoom" value={String(workspaceZoom)} onchange={e => setWorkspaceZoom(Number(e.currentTarget.value))}>
          {#each workspaceZoomChoices as z (z)}<option value={String(z)}>{canvasZoomPercent(z)}%</option>{/each}
        </select>
      </div>
    </div>
  {/if}
  <div class:embedded-properties={embedded} inert={embedded && readOnly}>
  <h2>Edit symbol: {definition.name}</h2>
  {#if returnTo}
    <button disabled={!!penDraft || brushBusy || inkBusy || JSON.stringify(artwork) !== JSON.stringify(definition.shapes)} onclick={() => { error = returnTo!() ?? ''; }}>Return to {returnName}</button>
    <p>Undo current changes before returning. Apply commits this definition and closes the editor.</p>
  {/if}
  {#if context}<p>
      Editing in stage context. Dimmed surrounding artwork is read-only. Apply updates every linked
      instance.
    </p>{/if}
  <p>
    {#if isolated}
      Only this group's contents are editable. Apply returns changes to the enclosing draft; the
      project stays unchanged until the outer symbol editor is applied. Cancel discards this group's
      draft.
    {:else}
      Changes apply to every linked instance. Registration and instance bounds stay fixed. Cancel
      leaves the project unchanged.
    {/if}
  </p>
  <div inert={!!simplifyJob}>
  <label
    >Canvas tool<select
      aria-label="Symbol canvas tool"
      value={canvasTool}
      onchange={(e) => {
        cancelDrag();cancelHierarchyPick();cancelHierarchyMove();
        discardPen();
        canvasTool = e.currentTarget.value as typeof canvasTool;
      }}
      ><option value="select">Select / move</option><option value="text">Text</option><option value="hierarchy">Select hierarchy units</option><option value="hierarchy-move">Move selected hierarchy units</option><option value="hierarchy-rotate">Rotate selected hierarchy units</option><option value="hierarchy-scale">Scale selected hierarchy units</option><option value="hierarchy-skew">Skew selected hierarchy units</option><option value="rectangle">Draw rectangle</option
      ><option value="ellipse">Draw ellipse</option><option value="line">Draw line</option><option
        value="pencil">Draw pencil</option
      ><option value="brush">Draw brush</option><option value="ink">Ink stroke</option><option
        value="bucket">Paint bucket</option
      ><option value="eyedropper">Eyedropper</option><option value="bitmap">Bitmap handles</option
      ><option value="gradient">Gradient handles</option><option value="pen">Draw Pen</option
      ><option value="nodes">Edit anchors</option></select
    ></label
  >
  {#if canvasTool==='hierarchy-skew'}<p>
    Drag an edge diamond along the edge to skew the checked units, keeping the opposite edge fixed.
    Alt uses the marked combined-box center or custom hierarchy pivot. Shift snaps the shear angle
    to 15-degree steps; singular pivots and 90-degree shear reject. The preview is unapplied until
    release; Escape cancels.
  </p>{/if}
  {#if canvasTool==='hierarchy-scale'}<p>
    Drag a corner square to scale the checked units from the opposite corner. Shift scales corners
    proportionally. Midpoint squares scale one axis from the opposite edge; their other axis stays
    fixed, including with Shift. Alt uses the marked combined-box center or custom hierarchy pivot.
    The preview is unapplied until release; Escape cancels. Crossing an anchor reflects artwork.
  </p>{/if}
  {#if canvasTool==='hierarchy-rotate'}<p>
    Drag the circular handle to rotate the checked units around the marked shared pivot.
    Shift snaps to 15-degree steps. The pivot uses the combined box center or the custom hierarchy
    coordinates below. The preview is unapplied until release; Escape cancels.
  </p>{/if}
  {#if canvasTool==='hierarchy-move'}<p>
    Drag from a checked unit to move the complete selection. Shift constrains a document axis.
    The canvas shows an unapplied preview; release accepts one artwork change.
    Escape, capture loss or changed source, selection or view discards it. Other properties keep
    their active-item scope.
  </p>{/if}
  {#if canvasTool==='hierarchy'}<p>
    Click artwork to select its complete outer unit. Shift-click toggles a unit; a blank click clears
    the selection. Ctrl/Cmd+A selects all units. Escape cancels a pending pick or leaves this mode.
    Picks update hierarchy checkboxes and outlines only. Placement and hierarchy transforms use this
    selection; other property controls retain their active artwork item.
  </p>{/if}
  {#if canvasTool === 'gradient'}<p>
      Drag the origin, endpoint or secondary axis to edit gradient paint. Drag colored circles below
      the gradient axis to move color stops. Shift constrains movement; Escape cancels.
    </p>{/if}
  {#if canvasTool === 'bitmap'}<p>
      Select bitmap artwork in Artwork, then drag the pink origin or axis handles. Shift constrains
      a world axis; Escape cancels. Paint changes independently of geometry.
    </p>{/if}
  {#if canvasTool === 'bucket'}
    <label
      >Gap tolerance<input
        aria-label="Symbol bucket gap tolerance"
        type="number"
        min="0"
        max="40"
        step="0.5"
        bind:value={bucketGap}
      /></label
    >
    <p>
      Click a fill to replace its paint with the current solid fill, or click a closed line
      enclosure to create merged fill contours. Enclosures use artwork above the last text, instance
      or group; gap tolerance bridges nearby open endpoints in symbol units without changing the
      source outlines. Each change has one draft undo step.
    </p>
  {/if}
  {#if canvasTool === 'eyedropper'}
    <label
      >Sample source<select aria-label="Symbol eyedropper source" bind:value={eyedropperSource}
        ><option value="stored">Stored fill or stroke</option><option value="object">Whole object style</option><option value="rendered">Rendered fill</option
        ></select
      ></label
    >
    <label><input type="checkbox" bind:checked={keepEyedropper} disabled={eyedropperSource !== 'stored'} />Keep sampling</label>
    <p>
      Stored paint copies the fill or the stroke you click. Rendered fill (or Alt-click) samples the
      artwork over the white preview background, including nested artwork and opacity, without
      guides or selection. It changes only the new fill color. Wait for bitmap previews to load
      before sampling. Sampling never edits artwork or history.
    </p>
  {/if}
  {#if canvasTool === 'ink'}
    <p>
      Click a vector to apply the line color and width. Fills and geometry are retained; text,
      instances and grouped artwork are protected. Each changed click has one draft undo step.
    </p>
  {/if}
  {#if canvasTool === 'nodes'}
    <p>
      Choose an Artwork item or enable selection across artwork, then drag an anchor or its orange
      tangent handles. Shift toggles anchors; hold Shift after starting a drag to constrain
      movement. Alt moves a tangent independently. Alt-click a curve to insert an anchor. Drag empty
      space to select anchors with the chosen region; Shift adds, Alt subtracts, Shift+Alt
      intersects. Escape cancels.
    </p>
    <label
      ><input
        type="checkbox"
        aria-label="Select anchors across symbol artwork"
        bind:checked={acrossArtwork}
        onchange={() => {
          cancelDrag();
          acrossNodes = {};
          nodeSelection = [];
          nodeFocusId = selected;
        }}
      />Select anchors across artwork</label
    >
    {#if acrossArtwork}<p>
        Path and fill anchors across ungrouped artwork share one selection. Text, instances, groups
        and brush objects are protected.
      </p>{/if}
    <label
      >Anchor<select
        aria-label="Symbol anchor"
        bind:value={nodeIndex}
        onchange={() => {
          cancelDrag();
          nodeFocusId = selected;
          setNodeSets({ [selected]: [nodeIndex] });
        }}
      >
        {#each shape ? editableNodes(shape) : [] as _, i}<option value={i}>{i + 1}</option>{/each}
      </select></label
    >
    <label
      >Anchor selection region<select
        aria-label="Symbol anchor selection region"
        bind:value={nodeRegionForm}
        onchange={cancelDrag}
      >
        <option value="box">Box</option><option value="lasso">Freehand lasso</option>
      </select></label
    >
    <p aria-label="Selected symbol anchors">{nodeCount()} anchors selected</p>
    <button
      onclick={() => {
        cancelDrag();
        selectAllNodes();
      }}>Select all symbol anchors</button
    >
    <button
      onclick={() => {
        cancelDrag();
        setNodeSets({});
      }}>Clear symbol anchor selection</button
    >
    <button onclick={() => nodeCommand('smooth')}>Smooth symbol anchor</button>
    <button onclick={() => nodeCommand('corner')}>Corner symbol anchor</button>
    <button onclick={() => nodeCommand('delete')}>Delete symbol anchor</button>
  {/if}
  {#if canvasTool === 'pen'}
    <label
      ><input
        aria-label="Smooth symbol Pen anchors on finish"
        type="checkbox"
        bind:checked={penSmoothing}
      />Smooth anchors on finish</label
    >
    <p>
      Rebuilds curve handles while keeping anchor positions. Leave off to preserve manual handles.
    </p>
    <p>
      Click anchors; drag for curve handles. Shift snaps handles to 45 degrees; Alt leaves the
      incoming handle independent. Click the last anchor to remove its outgoing handle, or the first
      to close. Enter finishes, Backspace removes an anchor, Escape discards the path. Finish before
      Apply.
    </p>
    <button disabled={!penDraft || (penDraft.nodes?.length ?? 0) < 2} onclick={() => finishPen()}
      title="Finish an open path with Enter or Ctrl/Command-click on empty canvas"
      >Finish symbol Pen path</button
    >
    <button
      disabled={!penDraft || (penDraft.nodes?.length ?? 0) < 3}
      onclick={() => finishPen(true)}>Close symbol Pen path</button
    >
    <button
      disabled={!penDraft}
      onclick={() => {
        cancelDrag();
        discardPen();
      }}>Cancel symbol Pen path</button
    >
  {/if}
  {#if canvasTool === 'ink'}
    <label><input type="checkbox" aria-label="Ink one symbol contour" bind:checked={contourInk} onchange={() => { connectedInk = false; segmentInk = false; cancelDrag(); }} />Ink one compound contour</label>
    <label><input type="checkbox" aria-label="Ink one symbol edge" bind:checked={segmentInk} onchange={() => { contourInk = false; connectedInk = false; cancelDrag(); }} />Ink one edge</label>
    <p>Edge mode separates one anchor-to-anchor segment from a polygon contour, closed Bezier path or open butt-cap path. Curves stay editable; separated stroke ends use butt caps.</p>
    <p>Contour mode repaints one closed polygon boundary, preserving holes and other contours. It separates stroke paint from fill into editable objects.</p>
    <label
      ><input
        type="checkbox"
        aria-label="Connected symbol strokes"
        bind:checked={connectedInk}
        onchange={() => { contourInk = false; segmentInk = false; cancelDrag(); }}
      />Ink connected strokes</label
    >
    <p>
      Click a stroke to repaint its touching stroke network. Fills do not connect networks; grouped
      artwork, text and instances separate paint stacks. Escape cancels pending work.
    </p>
  {/if}
  {#if canvasTool === 'ink' && connectedInk}
    <label><input type="checkbox" aria-label="Connected symbol contours" bind:checked={connectedContours} onchange={cancelDrag} />Connect contours individually</label>
    <p>Only touching contour strokes connect. Disconnected boundaries in the same object keep their paint.</p>
  {/if}
  {#if queuedInk}<p role="status">Finding connected symbol strokes...</p>{/if}
  {#if canvasTool === 'brush'}
    <label
      >Brush paint<select aria-label="Symbol brush paint mode" bind:value={brushPaintMode}>
        <option value="normal">Normal</option><option value="behind">Behind</option>
        <option value="fills">Fills</option><option value="selection">Selection</option><option
          value="inside">Inside</option
        >
      </select></label
    >
    <p>
      Paint modes apply above the last protected text, symbol or group. Selection uses the chosen
      Artwork item. Inside follows the fill under the stroke start; starting empty protects existing
      fills. The live stroke is an unmasked preview; clipping is applied on release.
    </p>

    <label
      >Brush size<input
        aria-label="Symbol brush size"
        type="number"
        min="1"
        max="1000"
        value={brushWidth}
        oninput={e => brushWidth = e.currentTarget.valueAsNumber}
      /></label
    >
    <label
      ><input
        type="checkbox"
        aria-label="Symbol brush pressure"
        bind:checked={brushPressure}
      />Pressure controls size</label
    >
    <label
      >Minimum size %<input
        type="number"
        min="1"
        max="100"
        aria-label="Symbol brush minimum size"
        bind:value={brushMinimum}
      /></label
    >
    <label
      >Pressure response<input
        type="number"
        min="0.25"
        max="4"
        step="0.25"
        aria-label="Symbol brush pressure response"
        bind:value={brushResponse}
      /></label
    >
    <label
      ><input type="checkbox" aria-label="Symbol brush tilt" bind:checked={brushTilt} />Tilt
      controls nib</label
    >
    <label
      ><input type="checkbox" aria-label="Symbol brush twist" bind:checked={brushTwist} />Twist
      rotates nib</label
    >
    <label
      >Nib aspect %<input
        type="number"
        min="10"
        max="100"
        aria-label="Symbol brush nib aspect"
        bind:value={brushAspect}
      /></label
    >
    <label
      >Nib angle<input
        type="number"
        min="-360"
        max="360"
        aria-label="Symbol brush nib angle"
        bind:value={brushAngle}
      /></label
    >
    <label
      >Stabilization<input
        type="number"
        min="0"
        max="100"
        aria-label="Symbol brush stabilization"
        bind:value={brushStabilization}
      /></label
    >
    <p>
      Stabilization trails the pointer by this distance in symbol units; release reaches the
      endpoint. Pressure, tilt and twist use pen input. Mouse strokes use full pressure. Settings
      are captured when a stroke starts.
    </p>
    {#if embedded}
      <label>Simplify <input aria-label="Brush simplify slider" type="range" min="0" max="200" step="1" bind:value={brushSimplify}/></label>
      <label><input aria-label="Brush simplify amount" type="number" min="0" max="200" step="1" value={brushSimplify} oninput={e => brushSimplify = e.currentTarget.valueAsNumber}/> %</label>
      <label><input aria-label="Brush lock size to canvas" type="checkbox" bind:checked={brushLockToCanvas}/>Lock size to canvas</label>
    {:else}
      <label><input type="checkbox" bind:checked={brushSmooth} />Smooth symbol brush</label>
    {/if}
    <label><input aria-label="Symbol brush optimize" type="checkbox" bind:checked={brushOptimize}/>Optimize</label>
    <BrushContactOpacity available={brushObjects && (brushPaintMode === 'normal' || brushPaintMode === 'behind')}
      alongAvailable={brushObjects && (brushPaintMode === 'normal' || brushPaintMode === 'behind') && !brushTilt && !brushTwist}
      bind:along={strokeOpacityEnabled}
      bind:enabled={contactOpacityEnabled} bind:minimum={contactOpacityMinimum} bind:response={contactOpacityResponse} />
    <label><input type="checkbox" bind:checked={brushObjects} />Separate symbol brush objects</label
    >
    <label title="Normal Brush paint removes covered portions of earlier lines when merging.">
      <input type="checkbox" bind:checked={removeCoveredStrokes} />Remove covered lines
    </label>
    <p>
      Brush uses the fill color and merges editable contours above the last text, symbol or group.
      Shift constrains an axis; Escape cancels. Size is in symbol units.
    </p>
  {/if}
  {#if brushBusy}<p class="drawing-queue-status" role="status">Finishing symbol stroke...</p>{/if}
  {#if brushStatus}<p role="status">{brushStatus}</p>{/if}
  {#if canvasTool === 'pencil'}
    <label
      >Pencil smoothing<select aria-label="Symbol pencil smoothing" bind:value={pencilMode}>
        <option value="raw">Off (Raw)</option><option value="smooth">Smooth</option><option
          value="straight">Straight</option
        >
      </select></label
    >
    <label><input aria-label="Symbol pencil optimize" type="checkbox" bind:checked={pencilOptimize}/>Optimize</label>
    {#if embedded}
      <label>Simplify <input aria-label="Pencil simplify slider" type="range" min="0" max="200" step="1" disabled={pencilMode !== 'smooth'} bind:value={pencilSimplify}/></label>
      <label><input aria-label="Pencil simplify amount" type="number" min="0" max="200" step="1" disabled={pencilMode !== 'smooth'} value={pencilSimplify} oninput={e => pencilSimplify = e.currentTarget.valueAsNumber}/> %</label>
      <label><input type="checkbox" bind:checked={pencilObjects}/>Separate Pencil objects</label>
    {/if}
    <p>
      Pencil draws editable unfilled paths using the line color and width. Shift constrains an axis;
      Escape cancels. Smoothing runs once on release. Each stroke has one draft undo step.
    </p>
  {/if}
  <div class="fields">
    <label
      >New fill<input
        type="color"
        aria-label="New symbol drawing fill"
        bind:value={newFill}
      /></label
    >
    <label
      >New line color<input
        type="color"
        aria-label="New symbol line color"
        bind:value={newStroke}
      /></label
    >
    <label
      >New line width<input
        type="number"
        min="0.1"
        max="1000"
        step="0.1"
        aria-label="New symbol line width"
        value={newLineWidth}
        oninput={e => newLineWidth = e.currentTarget.valueAsNumber}
      /></label
    >
  </div>
  {#if !embedded}{@render artworkCanvas()}{/if}
  <p>
    Select/move picks artwork and drags its complete group. Rectangle/ellipse/line draws new
    artwork. Alt draws around the start point. Shift constrains movement, draws a square/circle or
    snaps lines to 45° increments. Arrow keys nudge; Shift uses 10 units. Escape cancels a drag.
    With canvas focus, Ctrl/Cmd+C/X/V copies/cuts/pastes artwork, Ctrl/Cmd+D duplicates the group,
    Delete/Backspace removes it, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes.
  </p>
  <label
    >Artwork<select
      aria-label="Symbol artwork item"
      value={selected}
      onchange={(e) => {
        const next = e.currentTarget.value;
        cancelDrag();
        selected = next;
      }}
    >
      {#each artwork as s, i (s.id)}<option value={s.id}>{i + 1}. {s.kind}</option>{/each}
    </select></label
  >
  <label
    >Library symbol<select aria-label="Nested symbol definition" bind:value={libraryId}>
      <option value="">Choose a symbol</option>
      {#each symbols.filter((s) => s.id !== definition.id) as s (s.id)}<option value={s.id}
          >{s.name}</option
        >{/each}
    </select></label
  >
  <button
    disabled={!libraryId}
    onclick={() =>
      change(() => {
        const target = symbols.find((s) => s.id === libraryId);
        if (!target) throw new Error('Missing symbol definition.');
        const child = symbolInstance(target, 0, 0);
        artwork = [...artwork, child];
        selected = child.id;
      })}>Place nested symbol</button
  >
  <button
    disabled={shape?.kind !== 'symbol' || !libraryId || shape.symbolId === libraryId}
    onclick={() =>
      change((s) => {
        if (!symbols.some((d) => d.id === libraryId)) throw new Error('Missing symbol definition.');
        s.symbolId = libraryId;
      })}>Swap nested symbol</button
  >
  <button
    disabled={shape?.kind !== 'symbol'}
    onclick={() =>
      change((s) => {
        const target = symbols.find((d) => d.id === s.symbolId);
        if (!target) throw new Error('Missing symbol definition.');
        s.width = target.width;
        s.height = target.height;
      })}>Use nested symbol native size</button
  >
  <p>
    Swap preserves placement, size, transform and playback. Native size changes only the selected
    instance's dimensions.
  </p>
  <div class="actions">
    <label>Destination group
      <select aria-label="Symbol destination group" bind:value={groupDestination}
        disabled={!shape || !!penDraft || brushBusy || inkBusy || !!groupEditing}>
        {#each groupDestinations as destination}
          <option value={destination.value}>{destination.label}</option>
        {/each}
      </select>
    </label>
    <label>Stack placement
      <select aria-label="Symbol group stack placement" bind:value={groupPlacement}
        disabled={!shape || !!penDraft || brushBusy || inkBusy || !!groupEditing}>
        <option value="append">Above all destination children</option>
        <option value="before">Below anchor unit</option>
        <option value="after">Above anchor unit</option>
      </select>
    </label>
    {#if groupPlacement !== 'append'}
      <label>Anchor artwork
        <select aria-label="Symbol group placement anchor" bind:value={groupAnchor}
          disabled={!shape || !!penDraft || brushBusy || inkBusy || !!groupEditing}>
          <option value="">Choose destination artwork</option>
          {#each groupAnchors as item (item.id)}
            <option value={item.id}>{item.kind} · {item.id}</option>
          {/each}
        </select>
      </label>
    {/if}
    <button onclick={moveToGroup}
      disabled={!shape || !!penDraft || brushBusy || inkBusy || !!groupEditing ||
        (groupPlacement === 'append' ? groupDestination === '[]' : !groupAnchor)}>
      Move symbol selection to group
    </button>
    <p class="hint">Moves the complete outer selection unit around a whole anchor unit or above all children. Destinations stay inside this editing context.</p>
    <div class="actions">
      <button disabled={hierarchyPointerBlocked || !hierarchySelectedIds.length}
        onclick={()=>hierarchyArtworkCommand('copy')}>Copy checked hierarchy units</button>
      <button disabled={hierarchyPointerBlocked || !hierarchySelectedIds.length}
        onclick={()=>hierarchyArtworkCommand('cut')}>Cut checked hierarchy units</button>
      <button disabled={hierarchyPointerBlocked || !artworkClipboard.length}
        onclick={()=>hierarchyArtworkCommand('paste')}>Paste hierarchy artwork</button>
      <button disabled={hierarchyPointerBlocked || !hierarchySelectedIds.length}
        onclick={()=>hierarchyArtworkCommand('duplicate')}>Duplicate checked hierarchy units</button>
      <button disabled={hierarchyPointerBlocked || !hierarchySelectedIds.length}
        onclick={()=>hierarchyArtworkCommand('delete')}>Delete checked hierarchy units</button>
      <button disabled={hierarchyPointerBlocked || !hierarchySelectedIds.length}
        onclick={()=>hierarchyArtworkCommand('front')}>Bring checked hierarchy units to front</button>
      <button disabled={hierarchyPointerBlocked || !hierarchySelectedIds.length}
        onclick={()=>hierarchyArtworkCommand('back')}>Send checked hierarchy units to back</button>
      <button disabled={hierarchyPointerBlocked || !hierarchySelectedIds.length}
        onclick={()=>hierarchyArtworkCommand('group')}>Group checked hierarchy units</button>
      <button disabled={hierarchyPointerBlocked || !hierarchySelectedIds.length}
        onclick={()=>hierarchyArtworkCommand('ungroup')}>Ungroup checked hierarchy units</button>
    </div>
    <p>Group wraps at least two complete units above their highest original stack position.
      Ungroup removes one outer level from each checked group inside this editing boundary.
      Artwork coordinates, bases and pivots stay unchanged.</p>
    <p>These explicit artwork commands use all checked units. Paste appends fresh identities with
      a 10-unit offset; its first unit becomes active. Other object and property controls retain
      their active-item scope.</p>
    <HierarchyPlacement entries={hierarchyEntries} disabled={hierarchyBlocked || !hierarchySelectedIds.length} dragging={!!symbolHierarchyDrag}
      selectionChoices={hierarchyChoices} selectionIds={hierarchySelectedIds} selectionDisabled={hierarchyBlocked} onselection={selectHierarchyUnits}
      onstart={startSymbolHierarchyDrag} onend={cancelSymbolHierarchyDrag} onover={overSymbolHierarchyDrag}
      ondrop={dropSymbolHierarchyDrag} onplace={placeSymbolHierarchy} />

    <button onclick={extractItemFromGroup}
      disabled={!shape?.groups?.length || !!penDraft || brushBusy || inkBusy || !!groupEditing}>
      Extract symbol item one group level
    </button>
    <p class="hint">Extracts only the chosen artwork item from its immediate group, above its new siblings. Other group members stay grouped; enclosing editing boundaries stay intact.</p>
    <button onclick={() => add('rectangle')}>Add symbol rectangle</button>
    <button onclick={() => add('ellipse')}>Add symbol ellipse</button>
    <button onclick={() => add('text')}>Add symbol text</button>
    <button
      disabled={!shape?.groups?.length || !!penDraft || brushBusy || inkBusy}
      onclick={editGroup}>Edit symbol group in isolation</button
    >
    <button
      disabled={!shape || !!penDraft || brushBusy || inkBusy}
      onclick={() => clipboardCommand('copy')}>Copy symbol artwork</button
    >
    <button
      disabled={!shape || !!penDraft || brushBusy || inkBusy}
      onclick={() => clipboardCommand('cut')}>Cut symbol artwork</button
    >
    <button
      disabled={!artworkClipboard.length || !!penDraft || brushBusy || inkBusy}
      onclick={() => clipboardCommand('paste')}>Paste symbol artwork</button
    >

    <button disabled={!shape} onclick={() => children('duplicate')}>Duplicate symbol artwork</button
    >
    <button disabled={!shape} onclick={() => children('delete')}>Delete symbol artwork</button>
    <button disabled={!shape} onclick={() => children('front')}
      >Bring symbol artwork to front</button
    >
    <button disabled={!shape} onclick={() => children('back')}>Send symbol artwork to back</button>
  </div>
  <p>
    Copy, cut, duplicate, delete and stacking commands act on the selected item's complete outer
    group. The symbol artwork clipboard lasts for this app session and works across symbol editors.
    Paste adds a copy offset by 10 units, retaining linked symbols and assets.
  </p>
  {#if shape}
    <fieldset>
      <legend>Transform artwork group</legend>
      <p>
        Applies to the selected item and its complete outer group, around their shared box center.
        Scale first, then rotate and move. Negative scales reflect artwork. The hierarchy selection button uses these values around the combined box center of all checked units.
      </p>
      <div class="fields">
        {#each ['dx', 'dy', 'rotation', 'scaleX', 'scaleY'] as field}
          <label
            >{field === 'dx'
              ? 'Move X'
              : field === 'dy'
                ? 'Move Y'
                : field === 'rotation'
                  ? 'Rotation (degrees)'
                  : field === 'scaleX'
                    ? 'Scale X (%)'
                    : 'Scale Y (%)'}<input
              type="number"
              step="any"
              aria-label={'Symbol group transform ' + field}
              bind:value={groupTransform[field as keyof typeof groupTransform]}
            /></label
          >
        {/each}
      </div>
      <button
        disabled={!!penDraft || brushBusy || inkBusy}
        onclick={() =>
          change(() => {
            artwork = transformSymbolChildren(artwork, selected, {
              ...groupTransform,
              scaleX: groupTransform.scaleX / 100,
              scaleY: groupTransform.scaleY / 100,
            });
          })}>Transform symbol artwork group</button
      >
      <label><input type="checkbox" bind:checked={hierarchyCustomPivot}
        aria-label="Use custom hierarchy transform pivot" onchange={cancelHierarchyMove} />Use a custom pivot for the hierarchy transform</label>
      {#if hierarchyCustomPivot}
        <div class="fields">
          <label>Pivot X<input type="number" step="any" aria-label="Hierarchy transform pivot X" bind:value={hierarchyTransformPivot.x} oninput={cancelHierarchyMove} /></label>
          <label>Pivot Y<input type="number" step="any" aria-label="Hierarchy transform pivot Y" bind:value={hierarchyTransformPivot.y} oninput={cancelHierarchyMove} /></label>
        </div>
      {/if}
      <p>Hierarchy pivot coordinates use this editing context. The default is the combined box center.
        These controls do not rewrite saved member pivots or change the active-item transform command.</p>
      <button disabled={hierarchyBlocked || !hierarchySelectedIds.length}
        onclick={transformHierarchyUnits}>Transform selected hierarchy units</button>
      <button
        onclick={() => {
          groupTransform = { dx: 0, dy: 0, rotation: 0, scaleX: 100, scaleY: 100 };
          cancelHierarchyMove();hierarchyCustomPivot=false;hierarchyTransformPivot={x:0,y:0};
        }}>Reset symbol transform values</button
      >
    </fieldset>
    {#if shape.text}
      <fieldset data-canvas-text-properties>
        <legend>{shape.text.input ? 'Input text' : shape.text.dynamicBinding ? 'Dynamic text' : 'Text'}</legend>
        {#key shape.id}
          <DynamicTextBinding label="Symbol dynamic text binding" value={shape.text.dynamicBinding} input={shape.text.input}
            disabled={!!inlineText || readOnly} change={setTextBinding} />
          <label
            >Content<textarea
              aria-label="Symbol text content"
              value={shape.text.content}
              onselect={(e) => captureTextRange(e.currentTarget)}
              onkeyup={(e) => captureTextRange(e.currentTarget)}
              onpointerup={(e) => captureTextRange(e.currentTarget)}
              onchange={(e) => setText({ content: e.currentTarget.value })}></textarea></label
          >
        {/key}
        <fieldset>
          <legend>Selected characters</legend>
          <p>
            Select characters in Content, then apply a style. Complete characters are kept together.
          </p>
          <div class="actions">
            <button disabled={!hasTextRange} onclick={() => styleTextRange({ bold: true })}
              >Bold selected symbol text</button
            >
            <button disabled={!hasTextRange} onclick={() => styleTextRange({ bold: false })}
              >Unbold selected symbol text</button
            >
            <button disabled={!hasTextRange} onclick={() => styleTextRange({ italic: true })}
              >Italic selected symbol text</button
            >
            <button disabled={!hasTextRange} onclick={() => styleTextRange({ italic: false })}
              >Unitalic selected symbol text</button
            >
            <button
              disabled={!hasTextRange}
              onclick={() =>
                styleTextRange({
                  bold: undefined,
                  italic: undefined,
                  font: undefined,
                  size: undefined,
                  color: undefined,
                  letterSpacing: undefined,
                  wordSpacing: undefined,
                  kerning: undefined,
                })}>Clear selected symbol text styles</button
            >
          </div>
          <label>Font<input aria-label="Selected symbol text font" bind:value={rangeFont} /></label>
          <button disabled={!hasTextRange} onclick={() => styleTextRange({ font: rangeFont })}
            >Apply selected symbol text font</button
          >
          <label
            >Size<input
              aria-label="Selected symbol text size"
              type="number"
              min="1"
              max="1000"
              bind:value={rangeSize}
            /></label
          >
          <button disabled={!hasTextRange} onclick={() => styleTextRange({ size: rangeSize })}
            >Apply selected symbol text size</button
          >
          <label
            >Color<input
              aria-label="Selected symbol text color"
              type="color"
              bind:value={rangeColor}
            /></label
          >
          <button disabled={!hasTextRange} onclick={() => styleTextRange({ color: rangeColor })}
            >Apply selected symbol text color</button
          >
        </fieldset>
        <TextFontControls label="Symbol text font" choiceLabel="Choose symbol font"
          font={inlineText ? inlineTextStyle.font : shape.text.font} disabled={readOnly}
          embedded={assets.flatMap(a => a.font?.dataUrl ? [a.font.family] : [])}
          change={font=>setText({font})} />
        <label
          >Size<input
            aria-label="Symbol text size" placeholder="Mixed"
            type="number"
            min="1"
            max="1000"
            value={inlineText ? inlineTextStyle.size : shape.text.size}
            onchange={(e) => setText({ size: e.currentTarget.valueAsNumber })}
          /></label
        >
        <label
          ><input
            aria-label="Symbol text bold"
            type="checkbox"
            checked={inlineText ? (inlineTextStyle.bold ?? false) : shape.text.bold} indeterminate={!!inlineText && inlineTextStyle.bold===undefined}
            onchange={(e) => setText({ bold: e.currentTarget.checked })}
          />Bold</label
        >
        <label
          ><input
            aria-label="Symbol text italic"
            type="checkbox"
            checked={inlineText ? (inlineTextStyle.italic ?? false) : shape.text.italic} indeterminate={!!inlineText && inlineTextStyle.italic===undefined}
            onchange={(e) => setText({ italic: e.currentTarget.checked })}
          />Italic</label
        >
        <label>Text color<input aria-label="Symbol text color" type="color" value={inlineText ? (inlineTextStyle.color ?? '#000000') : (typeof shape.fill==='string' ? shape.fill : '#000000')} title={inlineText && inlineTextStyle.color===undefined ? 'Mixed colors' : 'Character color'} onchange={e=>setTextColor(e.currentTarget.value)} /></label>
        <label
          >Alignment<select
            aria-label="Symbol text alignment"
            value={shape.text.align}
            onchange={(e) =>
              setText({ align: e.currentTarget.value as 'left' | 'center' | 'right' })}
            ><option value="left">Left</option><option value="center">Center</option><option
              value="right">Right</option
            ></select
          ></label
        >
        <label
          >Wrap width (0 for automatic)<input
            aria-label="Symbol text wrap width"
            type="number"
            min="0"
            max="100000"
            value={shape.text.wrapWidth ?? 0}
            onchange={(e) => setText({ wrapWidth: e.currentTarget.valueAsNumber })}
          /></label
        >
        <label
          >Line height<input
            aria-label="Symbol text line height"
            type="number"
            min="0.5"
            max="5"
            step="0.1"
            value={shape.text.lineHeight ?? 1.2}
            onchange={(e) => setText({ lineHeight: e.currentTarget.valueAsNumber })}
          /></label
        >
        <p>
          Base styles apply to text without character overrides. Existing character styles are
          preserved when editing content.
        </p>
      </fieldset>
    {/if}
    {#if shape.kind === 'symbol'}
      {#if navigate && context}
        <button
          disabled={!!penDraft ||
            brushBusy ||
            inkBusy ||
            JSON.stringify(artwork) !== JSON.stringify(definition.shapes)}
          onclick={() => {
            error = navigate!(shape.id) ?? '';
          }}>Open nested symbol in stage context</button
        >
        <p>
          Navigation opens the nested shared definition with a return to this context. Apply or undo
          current artwork changes first. Applying the nested editor updates that shared definition.
        </p>
      {/if}

      <label
        >Playback<select
          aria-label="Nested symbol playback"
          value={shape.symbolPlayback?.mode ?? 'loop'}
          onchange={(e) =>
            change((s) => {
              s.symbolPlayback = {
                mode: e.currentTarget.value as 'loop' | 'once' | 'single' | 'movie',
                firstFrame: s.symbolPlayback?.firstFrame ?? 0,
              };
            })}
          ><option value="loop">Loop</option><option value="once">Play once</option><option
            value="single">Single frame</option
          ><option value="movie">Movie clip</option></select
        ></label
      >
      <label
        >First frame<input
          aria-label="Nested symbol first frame"
          type="number"
          min="1"
          max="10000"
          value={(shape.symbolPlayback?.firstFrame ?? 0) + 1}
          onchange={(e) =>
            change((s) => {
              s.symbolPlayback = {
                mode: s.symbolPlayback?.mode ?? 'loop',
                firstFrame: Number(e.currentTarget.value) - 1,
              };
            })}
        /></label
      >
    {/if}
    <div class="fields">
      {#each fields.filter((f) => shape.kind !== 'symbol' || f !== 'strokeWidth') as field}
        <label
          >{field}<input
            type="number"
            step="any"
            aria-label={'Symbol artwork ' + field}
            value={shape[field] ?? 1}
            onchange={(e) => number(field, e.currentTarget.value)}
          /></label
        >
      {/each}
      {#if shape.kind !== 'symbol'}
        <label
          >Base fill<input
            type="color"
            aria-label="Symbol artwork fill"
            value={shape.fill}
            disabled={!!shape.gradient || !!shape.bitmap}
            onchange={(e) =>
              change((s) => {
                const recolored = s.fill !== e.currentTarget.value;
                s.fill = e.currentTarget.value;
                if (recolored && s.drawingMode === 'merge') {
                  const joined = joinRecoloredFills(artwork, [s.id]);
                  if (joined !== artwork) {
                    try { validate(joined); }
                    catch { return; }
                    artwork = joined;
                  }
                }
              })}
          /></label
        >
        <label
          >Stroke<input
            type="color"
            aria-label="Symbol artwork stroke"
            value={shape.stroke}
            onchange={(e) =>
              change((s) => {
                s.stroke = e.currentTarget.value;
              })}
          /></label
        >
      {/if}
    </div>
    {#if shape.kind !== 'symbol'}
      <label
        >Fill paint<select
          aria-label="Symbol fill paint"
          value={shape.gradient?.kind ?? (shape.bitmap ? 'bitmap' : 'solid')}
          onchange={(e) =>
            change((s) => {
              const kind = e.currentTarget.value;
              if (kind === 'bitmap') return;
              s.bitmap = undefined;
              s.fillEnabled = true;
              if (kind === 'solid') s.gradient = undefined;
              else if (s.gradient) s.gradient.kind = kind as 'linear' | 'radial';
              else
                s.gradient = {
                  kind: kind as 'linear' | 'radial',
                  from: { x: kind === 'radial' ? s.width / 2 : 0, y: s.height / 2 },
                  to: { x: Math.max(1, s.width), y: s.height / 2 },
                  stops: [
                    { offset: 0, color: s.fill },
                    { offset: 1, color: '#ffffff' },
                  ],
                };
            })}
        >
          <option value="solid">Solid</option><option value="linear">Linear gradient</option><option
            value="radial">Radial gradient</option
          >
          {#if shape.bitmap}<option value="bitmap">Existing bitmap</option>{/if}
        </select></label
      >
    {/if}
    {#if shape.kind !== 'symbol' && assets.some((a) => a.bitmap)}
      <label
        >Bitmap fill<select
          aria-label="Symbol bitmap asset"
          value={shape.bitmap?.assetId ?? ''}
          onchange={(e) =>
            change((s) => {
              const asset = assets.find((a) => a.id === e.currentTarget.value && a.bitmap);
              if (!asset) {
                s.bitmap = undefined;
                return;
              }
              s.gradient = undefined;
              s.fillEnabled = true;
              s.bitmap = s.bitmap
                ? { ...s.bitmap, assetId: asset.id }
                : {
                    assetId: asset.id,
                    x: 0,
                    y: 0,
                    width: Math.max(1, s.width),
                    height: Math.max(1, s.height),
                    repeat: false,
                  };
            })}
        >
          <option value="">No bitmap</option>
          {#each assets.filter((a) => a.bitmap) as asset}<option value={asset.id}
              >{asset.bitmap!.name}</option
            >{/each}
        </select></label
      >
    {/if}
    {#if shape.bitmap}
      <div class="fields">
        {#each ['dx', 'dy', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY'] as field}
          <label
            >Paint {field}{field.startsWith('scale') ? ' %' : ''}<input
              type="number"
              step="any"
              aria-label={'Symbol bitmap transform ' + field}
              bind:value={bitmapMove[field as keyof typeof bitmapMove]}
            /></label
          >
        {/each}
      </div>
      <button
        onclick={() =>
          change((s) => {
            s.bitmap = transformBitmap(s.bitmap!, {
              ...bitmapMove,
              scaleX: bitmapMove.scaleX / 100,
              scaleY: bitmapMove.scaleY / 100,
            });
          })}>Transform symbol bitmap</button
      >
      <button
        onclick={() =>
          change((s) => {
            s.bitmap = { ...s.bitmap!, transform: undefined };
          })}>Reset symbol bitmap basis</button
      >
      <p>
        Transform composes paint rotation, skew and scale around its local origin, then translates
        it. Negative scale mirrors paint. Reset basis retains the origin, dimensions and repeat
        setting.
      </p>
      <p>
        Bitmap coordinates are local to the artwork. Changing the asset retains its paint mapping;
        Fit and Native size reset the mapping without changing artwork geometry.
      </p>
      <div class="fields">
        {#each ['x', 'y', 'width', 'height'] as field}
          <label
            >Bitmap {field}<input
              type="number"
              step="any"
              aria-label={'Symbol bitmap ' + field}
              value={shape.bitmap[field as 'x' | 'y' | 'width' | 'height']}
              onchange={(e) =>
                change((s) => {
                  const value = Number(e.currentTarget.value);
                  if (
                    !Number.isFinite(value) ||
                    ((field === 'width' || field === 'height') && value <= 0)
                  )
                    throw new Error('Bitmap dimensions must be positive and coordinates finite.');
                  s.bitmap![field as 'x' | 'y' | 'width' | 'height'] = value;
                })}
            /></label
          >
        {/each}
      </div>
      <label
        ><input
          type="checkbox"
          aria-label="Repeat symbol bitmap"
          checked={shape.bitmap.repeat ?? false}
          onchange={(e) =>
            change((s) => {
              s.bitmap!.repeat = e.currentTarget.checked;
            })}
        />Repeat bitmap</label
      >
      <button
        onclick={() =>
          change((s) => {
            s.bitmap = {
              ...s.bitmap!,
              x: 0,
              y: 0,
              width: Math.max(1, s.width),
              height: Math.max(1, s.height),
              transform: undefined,
            };
          })}>Fit symbol bitmap</button
      >
      <button
        onclick={() =>
          change((s) => {
            const asset = assets.find((a) => a.id === s.bitmap!.assetId)?.bitmap;
            if (!asset) throw new Error('Bitmap asset is missing.');
            s.bitmap = {
              ...s.bitmap!,
              x: 0,
              y: 0,
              width: asset.width,
              height: asset.height,
              transform: undefined,
            };
          })}>Native symbol bitmap size</button
      >
    {/if}
    {#if shape.gradient}
      <p>
        Gradient coordinates are local to this artwork. Existing affine paint mapping is retained.
        Paint edits have independent draft undo steps.
      </p>
      <div class="fields">
        {#each ['from', 'to'] as endpoint}
          {#each ['x', 'y'] as axis}
            <label
              >{endpoint}
              {axis}<input
                type="number"
                step="any"
                aria-label={'Symbol gradient ' + endpoint + ' ' + axis}
                value={shape.gradient[endpoint as 'from' | 'to'][axis as 'x' | 'y']}
                onchange={(e) =>
                  change((s) => {
                    const value = Number(e.currentTarget.value);
                    if (!Number.isFinite(value))
                      throw new Error('Gradient coordinates must be finite.');
                    s.gradient![endpoint as 'from' | 'to'][axis as 'x' | 'y'] = value;
                  })}
              /></label
            >
          {/each}
        {/each}
      </div>
      <div class="fields">
        {#each ['x', 'y', 'rotation', 'scale'] as field}
          <label
            >Paint {field}{field === 'scale' ? ' %' : ''}<input
              type="number"
              step="any"
              aria-label={'Symbol gradient transform ' + field}
              bind:value={gradientMove[field as keyof typeof gradientMove]}
            /></label
          >
        {/each}
      </div>
      <button
        onclick={() =>
          change((s) => {
            s.gradient = transformGradient(
              s.gradient!,
              gradientMove.x,
              gradientMove.y,
              gradientMove.rotation,
              gradientMove.scale / 100,
            );
          })}>Transform symbol gradient</button
      >
      <div class="fields">
        <label
          >Aspect %<input
            type="number"
            min="1"
            max="10000"
            step="any"
            aria-label="Symbol gradient aspect"
            bind:value={gradientShape.aspect}
          /></label
        >
        <label
          >Skew degrees<input
            type="number"
            min="-80"
            max="80"
            step="any"
            aria-label="Symbol gradient skew"
            bind:value={gradientShape.skew}
          /></label
        >
      </div>
      <button
        onclick={() =>
          change((s) => {
            s.gradient = shapeGradient(s.gradient!, gradientShape.aspect / 100, gradientShape.skew);
          })}>Set symbol gradient shape</button
      >
      <p>
        Transform offsets and rotates/scales the paint around its origin. Set shape replaces the
        paint basis with the specified aspect and skew. Artwork geometry stays fixed.
      </p>
      {#each shape.gradient.stops as stop, i}
        <div class="fields">
          <label
            >Stop {i + 1}<input
              type="color"
              aria-label={'Symbol gradient stop ' + (i + 1) + ' color'}
              value={stop.color}
              onchange={(e) =>
                change((s) => {
                  s.gradient = editGradientStop(s.gradient!, i, { color: e.currentTarget.value });
                })}
            /></label
          >
          <label
            >Position<input
              type="number"
              min="0"
              max="100"
              aria-label={'Symbol gradient stop ' + (i + 1) + ' position'}
              value={stop.offset * 100}
              onchange={(e) =>
                change((s) => {
                  s.gradient = editGradientStop(s.gradient!, i, {
                    offset: Number(e.currentTarget.value) / 100,
                  });
                })}
            /></label
          >
          <NumberSlider label={'Symbol gradient stop '+(i+1)+' opacity'} caption="Opacity" value={(stop.opacity??1)*100} min={0} max={100} scope={propertySliderScope} onchange={value=>change(s=>{s.gradient=editGradientStop(s.gradient!,i,{opacity:value/100});})}/>
          <button
            disabled={shape.gradient.stops.length <= 2}
            aria-label={'Remove symbol gradient stop ' + (i + 1)}
            onclick={() =>
              change((s) => {
                s.gradient = removeGradientStop(s.gradient!, i);
              })}>Remove stop</button
          >
        </div>
      {/each}
      <button
        disabled={shape.gradient.stops.length >= 32}
        onclick={() =>
          change((s) => {
            s.gradient = addGradientStop(s.gradient!);
          })}>Add symbol gradient stop</button
      >
    {/if}
  {:else}<p>This keyframe is blank. Add artwork to begin.</p>{/if}
  </div>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if simplifyJob}<p role="status">Simplifying selected symbol artwork…</p>
  {:else if simplifyInfo}<p role="status">{simplifyInfo}</p>{/if}
  <p role="status" style="min-height:1.5em">{strokeSelectionInfo}</p>
  <footer>
    <button disabled={!simplifyJob && simplifyBlocked}
      title={simplifyJob ? undefined : originalSimplify ? 'Reduce vertices in the selected complete artwork units' : 'Available for existing static Library symbols'}
      onclick={() => {
        if (simplifyJob) cancelSimplification('Simplification cancelled.');
        else void simplifySelectedArtwork();
      }}>{simplifyJob ? 'Cancel symbol simplification' : 'Simplify selected symbol artwork'}</button>
    <button disabled={!past.length||!!simplifyJob} onclick={() => undo()}>Undo artwork change</button>
    <button disabled={!future.length||!!simplifyJob} onclick={() => undo(true)}>Redo artwork change</button>
    {#if !embedded}<button
      onclick={applyArtwork}
      disabled={!!penDraft || inkBusy || !!simplifyJob} aria-disabled={brushBusy || undefined}>Apply symbol changes</button
    >
    <button onclick={cancel}>Cancel symbol editing</button>{/if}
  </footer>
  </div>
</svelte:element>
{#if groupEditing}
  <SymbolEditor
    isolated
    definition={groupEditing.definition}
    hierarchyOwner={JSON.stringify([hierarchyOwner,groupEditing.group,groupEditing.source,artwork])}
    {assets}
    {symbols}
    simplify={originalSimplify&&simplify?simplifyGroup:undefined}
    frameSimplify={originalFrameSimplify}
    validate={(edited) => validate(groupResult(edited))}
    apply={applyGroup}
    cancel={() => {
      groupEditing = null;
    }}
  />
{/if}

<style>
  .symbol-canvas-holder{position:relative;line-height:0;flex-shrink:0;}
  .symbol-canvas-holder>canvas{display:block;height:auto;}
  .embedded {display:grid;grid-template-columns:var(--tools-width,84px) minmax(0,1fr) var(--inspector-width,280px);height:100%;min-height:0;min-width:0;background:#20222a;color:var(--surface-text);}
  .embedded-tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(35px,1fr));grid-auto-rows:35px;align-content:start;justify-items:center;gap:4px;padding:4px;border-right:1px solid #444754;overflow:auto;}
  .embedded-tools button{padding:7px;border:0;background:transparent;color:inherit;}
  .embedded-tools button[aria-pressed='true']{background:var(--accent-surface);}
  .drawing-queue-status{position:absolute;width:1px;height:1px;margin:0;overflow:hidden;clip-path:inset(50%);}
  .embedded-stage{position:relative;align-self:start;height:calc(100% - var(--timeline-height,267px));display:flex;min-width:0;min-height:0;align-items:center;justify-content:center;overflow:hidden;}
  .embedded-view-controls{position:absolute;left:10px;top:8px;display:flex;gap:6px;}
  .embedded-properties{padding:12px;border-left:1px solid #444754;overflow:auto;min-height:0;}
  .embedded-properties :global(p:not([role])){display:none;}
  .embedded-properties h2{font-size:13px;}
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
  canvas {
    max-width: 100%;
    height: auto;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 12px 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  input,
  select {
    min-width: 0;
    padding: 6px;
  }
  footer {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  button {
    padding: 8px;
  }
</style>

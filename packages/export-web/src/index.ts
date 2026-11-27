import {symbolBlurBounds} from '../../stage/src/symbol-mask-painter';
import {createLayerMaskCompositor} from '../../stage/src/layer-mask-compositor';
import {hasMaskChain, maskAncestors, maskPaintChains} from '../../document/src/layer-masks';
import {MASK_WORKING_PIXELS} from '../../stage/src/mask-budget';
import { evaluatedMotionProgress } from '../../document/src/motion-ease';
import { interpolateOpacityKeys } from '../../animation/src/opacity-track';
import { createHeldKeySampler } from './held-key';
import { createButtonChildViewBank } from '../../animation/src/button-child-view';
import type { RootButton } from '../../animation/src/button-preview';
import { createMovieButtonViewBank, movieButtonExportToken, nestedSceneMovieButtonSignature, stateMovieButtonSignature, type MoviePlacementRoute } from '../../animation/src/movie-button-view';
import {
  compileGraphicButtonPlan,
  compileGraphicButtonLifetimes,
  sampleGraphicButtonPlan,
  graphicButtonLifetimesAt,
} from '../../animation/src/graphic-button-plan';
import { createButtonExposureRuntime, crossedButtonEntry, movieButtonEntrySeconds } from '../../animation/src/button-exposure';
import { createExportButtonMovieRuntime } from './button-movie-runtime';
import { compileButtonStatePlans } from '../../animation/src/button-state-clock';
import type { MovieClockPlan } from '../../animation/src/movie-clock-plan';
import { createExportButtonRuntime, createMaskCoverage, type ExportHitItem } from './button-runtime';
import { groupDrawingPaint, hasInstanceBlur, expandSymbols, expandStaticButtonContainers, symbolLocalFrame, type SymbolPaintItem } from '../../geometry/src/symbols';
import { createMovieClock } from '../../animation/src/movie-clock';
import { compileMovieClockPlan } from '../../animation/src/movie-clock-plan';
import { createMovieTreeRuntime } from '../../animation/src/movie-tree-clock';
import bidiFactory from 'bidi-js';
import { createRichTextRuntime } from '../../geometry/src/rich-text';
import { createBidiTextRuntime } from '../../geometry/src/bidi-text';
import { createRichPainter } from '../../stage/src/rich-text';
import { createFontFamilyResolver } from '../../geometry/src/font-family';
import { movieLayerView, symbolArtworks, validateProject, type Project, type Vector } from '@splash/document';
import { resolveExportPaintAssets } from './paint-assets';
import { validateLiveGraphicData, validateLiveMotionData } from '../../document/src/live-motion';
import { MAX_HTML_COMPILED_SHAPES, prepareLiveHTMLTimeline } from './live-timeline';
import { createSharedSymbolPaint } from './shared-symbol-paint';
import { addWebMedia, webCanvasLayout, webDataScript, webPlayerScript, type WebCanvasSizing, type WebFolderFiles } from './web-folder';
import { matrix, multiply } from '../../geometry/src/affine';
import { paintBoxBlur } from '../../stage/src/box-blur';
import { softwareBlend } from '../../stage/src/software-blend';
import { renderData, paintCommands } from '../../stage/src/render-data';
import { wrapText } from '../../geometry/src/text-layout';
import { captureDynamicTextValues } from '../../document/src/dynamic-text';
import { captureDynamicTextOwners } from './dynamic-text';
import { captureReplayTextChanges, type ReplayTextChange } from './replay-text';
import { graphicVisibilityOwner } from '../../animation/src/placement-visibility';
import { graphicTransformOwner, captureReplayTransforms, replayTransformByteLimit, replayTransformSize, type TransformEntry } from '../../animation/src/placement-transform';
import { captureSpawnArtwork, replaySpawnByteLimit, replaySpawnField, replaySpawnSize, scriptGraphicsLayer, type SpawnedGraphic } from '../../animation/src/spawn-artwork';
import { encodeReplayWave } from './replay-wave';
import { htmlSoundtrackSource, soundtrackPlayback, type HTMLSoundtrack } from './html-soundtrack';
/** Bound raster allocation independently of editable document geometry. */
export function captureDimensions(width:number,height:number,scale:number){
  if(!Number.isFinite(scale)||scale<=0)throw new Error('PNG scale must be positive and finite.');
  const w=Math.round(width*scale),h=Math.round(height*scale);
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||w>16384||h>16384||w*h>64*1024*1024)
    throw new Error('PNG output exceeds the 16,384-pixel edge or 64-megapixel raster limit.');
  return {width:w,height:h};
}
export interface PresentationButtonState {instanceId:string;symbolId:string;lifetime:number;state:'over'|'down'}
export interface PresentationPose {
  frame: number;
  tick: number;
  buttonState?: PresentationButtonState;
  /** An omitted list inherits the previous pose. An empty list reveals all buttons. */
  hiddenButtons?: readonly string[];
  /** Qualified original Graphic exposures, inherited until a new list is supplied. */
  hiddenGraphics?: readonly string[];
  /** Complete transform overrides for this tick. Omission inherits, [] restores authored poses. */
  placementTransforms?: readonly TransformEntry[];
  /** Omission inherits the preceding spawn set. An empty list removes all script-owned paint. */
  spawnedGraphics?: readonly SpawnedGraphic[];
}
/** Replay a complete host trajectory into a fresh detached renderer. No user source runs here.
 * Root seeks visit only their destinations. Continuously visible movies keep host time;
 * sampled disappearance/reentry restarts them. Optional visual states require a previously
 * committed target lifetime; absent, expired and first-arrival targets stay Up.
 */
export function exportPresentationHTML(project:Project,poses:readonly PresentationPose[], textValues?: unknown):string{
  return compileHTML(project,0,false,1,poses,captureDynamicTextValues(textValues));
}
/** Play a trusted presentation trajectory at the document frame rate. */
export function exportScriptReplayHTML(project:Project,poses:readonly PresentationPose[], textChanges?:readonly ReplayTextChange[], wave?:Uint8Array):string{
  if(!Array.isArray(poses)||poses.length<2)throw Error('Replay HTML requires a completed presentation tick.');
  return compileHTML(project,0,false,1,poses,undefined,captureReplayTextChanges(textChanges,poses.length-1),wave);
}
/** Drive the same trusted replay one recorded tick at a time for offline video. */
export function exportScriptReplayFramesHTML(project: Project, poses: readonly PresentationPose[], textChanges?: readonly ReplayTextChange[]): string {
  if (!Array.isArray(poses) || poses.length < 2) throw Error('Replay capture requires a completed presentation tick.');
  return compileHTML(project, 0, false, 1, poses, undefined, captureReplayTextChanges(textChanges, poses.length - 1), undefined, true);
}
/** Prepare the artwork for a separately admitted script driver. The artwork contains no guest code. */
export function exportInteractiveArtworkHTML(project: Project): string {
  return compileHTML(project, undefined, false, 1, undefined, undefined, undefined, undefined, false, true);
}
/** Geometry compiled from the editable document; no user scripts are executed. */
export function exportHTML(project: Project, captureFrame?: number | 'sequence', transparentCapture = false, captureScale = 1, presentation?:readonly PresentationPose[]): string {
  return compileHTML(project,captureFrame,transparentCapture,captureScale,presentation);
}
/** Add an explicitly prepared root-timeline mix to ordinary script-free playback. */
export function exportHTMLWithAudio(project: Project, soundtrack: HTMLSoundtrack): string {
  const html = compileHTML(project, undefined, false, 1, undefined, undefined, undefined,
    undefined, false, false, soundtrack);
  if (new Blob([html]).size > 64 * 1024 * 1024) throw Error('HTML with audio exceeds the 64 MiB output limit.');
  return html;
}
/** Package the standalone player and its referenced media for static hosting. */
export function exportWebFolder(project: Project, soundtrack?: HTMLSoundtrack, sizing: WebCanvasSizing = 'fit'): WebFolderFiles {
  const files: WebFolderFiles = new Map();
  const html = compileHTML(project, undefined, false, 1, undefined, undefined, undefined,
    undefined, false, false, soundtrack, { files, sizing });
  files.set('index.html', html);
  return files;
}
// Build the same admitted playback model for standalone, captured, and folder
// output. Output packaging and soundtrack settings do not edit the source project.
function compileHTML(project: Project, captureFrame: number | 'sequence' | undefined, transparentCapture: boolean,
  captureScale: number, presentation?: readonly PresentationPose[], textValues?: Record<string, string>,
  replayText?: readonly ReplayTextChange[], replayWave?:Uint8Array, replayCapture = false, interactiveArtwork = false,
  soundtrack?: HTMLSoundtrack, web?: { files: WebFolderFiles; sizing: WebCanvasSizing }): string {
  const webFiles = web?.files;
  validateLiveMotionData(project);
  const authored = validateProject(project);
  // A standalone movie owns only the timeline it plays.
  delete authored.scenes;
  const snapshot = movieLayerView(authored);
  const hasLiveMotion = project.layers.some(layer => layer.liveMotionSpans?.length);
  if (hasLiveMotion) validateLiveGraphicData(project);
  if (hasLiveMotion && captureFrame !== undefined)
    throw new Error('Live motion capture requires an evaluated single-frame PNG capture. Live ranges require separate raster export preparation.');
  const valid = hasLiveMotion ? prepareLiveHTMLTimeline(snapshot) : snapshot;
  const textKeys = new Set<string>();
  for(const change of replayText??[])for(const key of Object.keys(change.values??{}))textKeys.add(key);
  const resolveTextOwner = captureDynamicTextOwners(valid, textValues,textKeys);
  const textOwners = resolveTextOwner ? new WeakMap<object, string>() : undefined;
  const tagText = (shape: object, layer: string, id: string, frame: number) => {
    const owner = resolveTextOwner?.(layer, frame, id);
    if (owner !== undefined) textOwners?.set(shape, owner);
  };
  // Expand bound root artwork at unit opacity, then apply the sampled root factor to
  // the compiled paint subtree. This also permits a zero-opacity authored root to fade in.
  type Tag={channel:number;base:number};
  const paintOwners=new WeakMap<object,Tag>(),targets=new Map<string,Map<string,number>>();
  const channels:NonNullable<Project['opacityBindings']>[]=[];
  for(const binding of valid.opacityBindings??[]){
    let ids=targets.get(binding.layerId);if(!ids){ids=new Map();targets.set(binding.layerId,ids);}
    let index=ids.get(binding.shapeId);if(index===undefined){index=channels.length;channels.push([]);ids.set(binding.shapeId,index);}
    channels[index].push(binding);
  }
  for(const channel of channels)channel.sort((a,b)=>a.start-b.start);
  const tags=new Map<string,Tag>(),tagKey=(layer:string,frame:number,id:string)=>JSON.stringify([layer,frame,id]);
  for(const layer of valid.layers){
    const ids=targets.get(layer.id);if(!ids)continue;
    for(const key of layer.keys)for(const shape of key.shapes){
      const channel=ids.get(shape.id);if(channel===undefined)continue;
      tags.set(tagKey(layer.id,key.frame,shape.id),{channel,base:shape.opacity??1});shape.opacity=1;
    }
  }
  function tagPaint(shape:object,layer:string,id:string,frame:number){
    const tag=tags.get(tagKey(layer,frame,id));if(tag)paintOwners.set(shape,tag);
  }
  const replayGraphicIds=new Map<string,number>();
  type CompiledPose=Omit<PresentationPose,'hiddenGraphics'|'placementTransforms'|'spawnedGraphics'>&{hiddenGraphics?:number[];transforms?:[number,number][];spawns?:number[]};
  let trajectory:CompiledPose[]|undefined;
  const transformChanges=new Map<number,TransformEntry[]>();
  const transformKeys=new Set<string>();
  let transformBytes=0;
  const spawnChanges=new Map<number,SpawnedGraphic[]>();
  let spawnSource:ReturnType<typeof captureSpawnArtwork>|undefined;
  let spawnLayer:ReturnType<typeof scriptGraphicsLayer>|undefined;
  let spawnBytes=0,previousOrigins=new Map<string,string>();
  let visibilityBytes=0;
  const encoder=new TextEncoder();
  function captureHiddenGraphics(raw:readonly string[]|undefined) {
    if (!replayText || raw===undefined) return undefined;
    if (!Array.isArray(raw)) throw Error('Invalid replay Graphic visibility.');
    const keys=new Set<string>();
    for(let index=0;index<raw.length;index++){
      const key=Object.getOwnPropertyDescriptor(raw,index)?.value;
      if(typeof key!=='string'||keys.has(key))throw Error('Invalid replay Graphic visibility.');
      keys.add(key);
      visibilityBytes+=encoder.encode(JSON.stringify(key)).byteLength+1;
      if(visibilityBytes>64*1024*1024)throw Error('Replay Graphic visibility exceeds the 64 MiB artwork limit.');
    }
    return Array.from(keys,key=>{
      const saved=replayGraphicIds.get(key);
      if(saved!==undefined)return saved;
      const index=replayGraphicIds.size;
      replayGraphicIds.set(key,index);
      return index;
    });
  }
  if(presentation!==undefined){
    if(!Array.isArray(presentation)||presentation.length<1||presentation.length>10001)
      throw new Error('Presentation requires one to 10001 poses.');
    trajectory=presentation.map((pose,index)=>{
      if(!pose||!Number.isSafeInteger(pose.frame)||pose.frame<0||pose.frame>=valid.duration||pose.tick!==index)
        throw new Error('Presentation must start at tick zero and contain every host tick.');
      const state=pose.buttonState;
      if(state!==undefined&&(!state||typeof state.instanceId!=='string'||typeof state.symbolId!=='string'||
        !Number.isSafeInteger(state.lifetime)||state.lifetime<1||!['over','down'].includes(state.state)))
        throw new Error('Presentation button state requires a valid target lifetime and Over/Down state.');
      const hidden=pose.hiddenButtons;
      if(hidden!==undefined&&(!Array.isArray(hidden)||hidden.some(token=>typeof token!=='string')||
        new Set(hidden).size!==hidden.length))
        throw Error('Invalid presentation button visibility.');
      const hiddenGraphics=captureHiddenGraphics(pose.hiddenGraphics);
      const entries=replayText?captureReplayTransforms(pose):undefined;
      if(entries!==undefined){
        transformBytes+=replayTransformSize(entries);
        if(transformBytes>replayTransformByteLimit)throw Error('Replay transforms exceed the 64 MiB artwork limit.');
        transformChanges.set(index,entries);
        for(const [key] of entries)transformKeys.add(key);
      }
      const rawSpawns=replayText?replaySpawnField(pose):undefined;
      if(rawSpawns!==undefined){
        spawnSource??=captureSpawnArtwork(valid);
        const spawns=spawnSource.read(rawSpawns);
        spawnBytes+=replaySpawnSize(spawns);
        if(spawnBytes>replaySpawnByteLimit)throw Error('Replay spawned artwork exceeds the 64 MiB artwork limit.');
        if(spawns.length){
          if(index===0)throw Error('Replay must begin with authored artwork.');
          spawnLayer??=scriptGraphicsLayer(valid);
        }
        const origins=new Map<string,string>();
        for(const entry of spawns){
          if(entry[5]!=='timeline')continue;
          const stamp=JSON.stringify(entry);
          if(previousOrigins.get(entry[0])!==stamp&&(entry[6]!==index||entry[7]!==pose.frame))
            throw Error('Invalid spawned symbol origin.');
          origins.set(entry[0],stamp);
        }
        previousOrigins=origins;
        spawnChanges.set(index,spawns);
      }
      return {frame:pose.frame,tick:pose.tick,...(hidden!==undefined?{hiddenButtons:[...hidden]}:{}),
        ...(hiddenGraphics!==undefined?{hiddenGraphics}:{}),...(state===undefined?{}:{buttonState:{
        instanceId:state.instanceId,symbolId:state.symbolId,lifetime:state.lifetime,state:state.state}})};
    });
    if(trajectory[0].frame!==0)throw new Error('Presentation must start at frame zero.');
  }
  const visibilityTags=new Map<string,number>(),visibilityOwners=new WeakMap<object,number>();
  const visibilityExposures=new Set<string>();
  if(replayGraphicIds.size){
    const owner=graphicVisibilityOwner(valid);
    const matched=new Set<string>();
    for(const layer of valid.layers)for(const key of layer.keys)for(const shape of key.shapes){
      const identity=owner(layer,key.frame,shape);
      if(identity===undefined)continue;
      const index=replayGraphicIds.get(identity);
      if(index===undefined)continue;
      matched.add(identity);
      visibilityTags.set(tagKey(layer.id,key.frame,shape.id),index);
      visibilityExposures.add(JSON.stringify([layer.id,key.frame]));
    }
    if(matched.size!==replayGraphicIds.size)throw Error('Unknown replay Graphic visibility target.');
  }
  const transformTags=new Map<string,number>(),transformOwners=new WeakMap<object,number>();
  const transformTargets=new Map<string,{index:number;layer:string;start:number;end:number;shape:Vector;duration:number}>();
  const transformExposures=new Set<string>();
  if(transformKeys.size){
    const owner=graphicTransformOwner(valid);
    const durations=new Map(valid.symbols?.map(symbol=>[symbol.id,symbol.timeline?.duration??1]));
    for(const layer of valid.layers)for(const [i,key] of layer.keys.entries())for(const shape of key.shapes){
      const id=owner(layer,key.frame,shape);
      if(id===undefined||!transformKeys.has(id))continue;
      const index=transformTargets.size;
      transformTargets.set(id,{index,layer:layer.id,start:key.frame,end:layer.keys[i+1]?.frame??valid.duration,
        shape,duration:durations.get(shape.symbolId!)!});
      transformTags.set(tagKey(layer.id,key.frame,shape.id),index);
      transformExposures.add(JSON.stringify([layer.id,key.frame]));
    }
    if(transformTargets.size!==transformKeys.size)throw Error('Unknown replay Graphic transform target.');
  }
  const tagRoot = channels.length || resolveTextOwner || visibilityTags.size || transformTags.size
    ? (shape: object, layer: string, id: string, start: number) => {
        if (channels.length) tagPaint(shape, layer, id, start);
        tagText(shape, layer, id, start);
        const visibility=visibilityTags.get(tagKey(layer,start,id));
        if(visibility!==undefined)visibilityOwners.set(shape,visibility);
        const transform=transformTags.get(tagKey(layer,start,id));
        if(transform!==undefined)transformOwners.set(shape,transform);
      }
    : undefined;
  const textTrack = replayText?.length ? JSON.stringify(replayText).replace(/</g,'\\u003c') : undefined;
  const output=captureFrame===undefined?{width:valid.width,height:valid.height}:captureDimensions(valid.width,valid.height,captureScale);
  if (captureFrame !== undefined && captureFrame !== 'sequence' && (!Number.isSafeInteger(captureFrame) || captureFrame < 0 || captureFrame >= valid.duration))
    throw new Error('Choose a frame within the existing timeline.');
  let compiledShapes = 0;
  const exposureSpans = new Map<string, { start: number; end: number }>();
  const rootSources = new WeakMap<object, string>();
  const buttonDefinitions = new Map(
    valid.symbols?.filter((d) => d.buttonStates).map((d) => [d.id, d]),
  );
  let maskedGraphicSpans: ReturnType<typeof compileGraphicButtonLifetimes> | undefined;
  let spanFrame = -1;
  let frameSpans = new Map<string, ReturnType<typeof compileGraphicButtonLifetimes>[number]>();
  let hasSymbolMasks = valid.layers.some(l=>l.keys.some(k=>k.shapes.some(s=>s.groupBlur)));
  const rootChain = hasMaskChain(valid.layerMasks);
  if (valid.symbols && (hasInstanceBlur(valid) || valid.symbols.some(d => d.timeline?.layerMasks?.length))) {
    const byId = new Map(valid.symbols.map(d => [d.id, d]));
    const descendants = new Map<string, boolean>();
    function visit(shape: Project['layers'][number]['keys'][number]['shapes'][number]): boolean {
      if(shape.groupBlur)hasSymbolMasks=true;
      if (!shape.symbolId) return false;
      const definition = byId.get(shape.symbolId)!;
      if((shape.instanceBlur || shape.instanceBlend || shape.instanceTint?.amount) && !definition.buttonStates)hasSymbolMasks=true;
      let below = descendants.get(definition.id);
      if (below === undefined) {
        below = false;
        if (definition.timeline?.layerMasks?.length) hasSymbolMasks = true;
        for (const artwork of symbolArtworks(definition)) for (const child of artwork) {
          if (visit(child)) below = true;
        }
        descendants.set(definition.id, below);
      }
      return !!definition.buttonStates || below;
    }
    for (const track of valid.layers) for (const key of track.keys) key.shapes.forEach(visit);
    for (const id of buttonDefinitions.keys()) if (!descendants.has(id)) buttonDefinitions.delete(id);
    if (hasSymbolMasks && [...descendants.values()].some(Boolean))
      maskedGraphicSpans = compileGraphicButtonLifetimes(compileGraphicButtonPlan(valid));
  }
  const sharedPaint = !trajectory && !tagRoot && !hasSymbolMasks && !buttonDefinitions.size
    ? createSharedSymbolPaint(valid, count => {
      compiledShapes += count;
      if (compiledShapes > MAX_HTML_COMPILED_SHAPES)
        throw Error('Animated symbol export exceeds one million compiled shapes.');
    })
    : undefined;
  type SharedPlacement = NonNullable<ReturnType<ReturnType<typeof createSharedSymbolPaint>['place']>>;
  const sharedPlacements = new WeakMap<Vector, SharedPlacement>();
  const expandUnbound = (
    shapes: Project['layers'][number]['keys'][number]['shapes'],
    frame = 0,
    scope = '',
    start = 0,
    end = valid.duration,
  ) => {
    const result = shapes.flatMap(source => {
      const placement = sharedPaint?.place(source, frame);
      if (placement) {
        const shape = { ...source };
        sharedPlacements.set(shape, placement);
        return [shape];
      }
      return expandStaticButtonContainers(valid, [source]).flatMap((shape) => {
        if (shape.kind === 'symbol' && buttonDefinitions.has(shape.symbolId!)) {
          const copy = { ...shape };
          const token = JSON.stringify([scope, shape.id, shape.symbolId]);
          rootSources.set(copy, token);
          exposureSpans.set(token, { start, end });
          return [copy];
        }
        return expandSymbols(valid, [shape], frame, undefined, () => true);
      });
    });
    compiledShapes += result.length;
    if (compiledShapes > MAX_HTML_COMPILED_SHAPES)
      throw new Error('Animated symbol export exceeds one million compiled shapes.');
    return result;
  };
  const exposurePaint = new WeakMap<object, SymbolPaintItem[]>();
  function expand(shapes:Project['layers'][number]['keys'][number]['shapes'],frame:number,scope:string,start:number,end:number,layerId:string){
    if (hasSymbolMasks) {
      const flat: typeof shapes = [], items: SymbolPaintItem[] = [];
      for (const source of shapes) {
        if (source.symbolId && buttonDefinitions.has(source.symbolId)) {
          const placed = expandUnbound([source], frame, scope, start, end);
          for (const shape of placed) {
            tagRoot?.(shape, layerId, source.id, start);
            items.push(shape);
            flat.push(shape);
          }
          continue;
        }
        const pose: SymbolPaintItem[] = [];
        const leaves = expandSymbols(valid, [source], frame, undefined, () => true, child => {
          if (!child.symbolId || !buttonDefinitions.has(child.symbolId)) return false;
          const position = start + frame;
          if (spanFrame !== position) {
            spanFrame = position;
            frameSpans = new Map(graphicButtonLifetimesAt(maskedGraphicSpans ?? [], valid.duration, position)
              .map(span => [JSON.stringify([span.layerId, span.path]), span]));
          }
          const span = frameSpans.get(JSON.stringify([layerId, child.id]));
          if (!span) throw Error('Nested button has no matching original graphic exposure.');
          const token = JSON.stringify([span.id, span.start, span.end]);
          rootSources.set(child, token);
          exposureSpans.set(token, { start: span.start, end: span.end });
          return true;
        }, pose);
        compiledShapes += leaves.length;
        if (compiledShapes > MAX_HTML_COMPILED_SHAPES) throw Error('Animated symbol export exceeds one million compiled shapes.');
        for (const item of pose) {
          tagRoot?.(item, layerId, source.id, start);
          items.push(item);
        }
        for (const leaf of leaves) flat.push(leaf);
      }
      exposurePaint.set(flat, items);
      return flat;
    }
    if(!tagRoot)return expandUnbound(shapes,frame,scope,start,end);
    if(!targets.has(layerId)&&!resolveTextOwner){
      const exposure=JSON.stringify([layerId,start]);
      if(!visibilityExposures.has(exposure)&&!transformExposures.has(exposure))
        return expandUnbound(shapes,frame,scope,start,end);
    }
    return shapes.flatMap(source=>{
      const result=expandUnbound([source],frame,scope,start,end);
      for(const shape of result)tagRoot(shape,layerId,source.id,start);
      return result;
    });
  }
  const graphicPlan = buttonDefinitions.size && !hasSymbolMasks ? compileGraphicButtonPlan(valid) : null;
  const advances =
    graphicPlan &&
    [graphicPlan.root, ...graphicPlan.definitions].some((t) =>
      t.layers.some((l) =>
        l.keys.some((k) =>
          k.nodes.some(
            (n) =>
              n.definition !== undefined &&
              graphicPlan.definitions[n.definition].duration > 1 &&
              n.shape.symbolPlayback?.mode !== 'single',
          ),
        ),
      ),
    );
  let routedLayers: Project['layers'] | undefined;
  if (graphicPlan && advances) {
    const spans = compileGraphicButtonLifetimes(graphicPlan);
    routedLayers = valid.layers.map((l) => ({ ...l, keys: [] }));
    const fixed = new Map<string, Set<string>>();
    for (const l of valid.layers)
      for (const key of l.keys)
        fixed.set(
          JSON.stringify([l.id, key.frame]),
          new Set(
            expandStaticButtonContainers(valid, key.shapes)
              .filter((s) => buttonDefinitions.has(s.symbolId!))
              .map((s) => s.id),
          ),
        );
    for (let frame = 0; frame < valid.duration; frame++) {
      const active = new Map(
        graphicButtonLifetimesAt(spans, valid.duration, frame).map((span) => [
          JSON.stringify([span.layerId, span.path]),
          span,
        ]),
      );
      const grouped = new Map<string, Project['layers'][number]['keys'][number]['shapes']>();
      for (const pose of sampleGraphicButtonPlan(graphicPlan, frame, undefined, tagRoot)) {
        const shape = pose.shape;
        if (pose.button) {
          const span = active.get(JSON.stringify([pose.layerId, shape.id]))!;
          const rootStart = pose.exposures[0].start;
          const token = fixed.get(JSON.stringify([pose.layerId, rootStart]))?.has(shape.id)
            ? JSON.stringify([pose.layerId + '/' + rootStart, shape.id, shape.symbolId])
            : JSON.stringify([span.id, span.start, span.end]);
          rootSources.set(shape, token);
          exposureSpans.set(token, { start: span.start, end: span.end });
        }
        let shapes = grouped.get(pose.layerId);
        if (!shapes) grouped.set(pose.layerId, (shapes = []));
        shapes.push(shape);
        if (++compiledShapes > MAX_HTML_COMPILED_SHAPES)
          throw new Error('Animated symbol export exceeds one million compiled shapes.');
      }
      for (const layer of routedLayers)
        layer.keys.push({ frame, shapes: grouped.get(layer.id) ?? [] });
    }
  }
  const p = {
    ...valid,
    symbols: undefined,
    frameComments: undefined,
    frameScripts: undefined,
    layers:
      routedLayers ??
      valid.layers.map((l) => {
        const advancing = l.keys.some((k) =>
          k.shapes.some(
            (s) =>
              s.symbolPlayback?.mode !== 'movie' &&
              valid.symbols?.some((d) => d.id === s.symbolId && d.timeline),
          ),
        );
        const expandKey = (index: number, frame: number) => {
          const key = l.keys[index];
          return expand(key.shapes, frame - key.frame, l.id + '/' + key.frame,
            key.frame, l.keys[index + 1]?.frame ?? valid.duration, l.id);
        };
        let cursor = 0;
        const keys = advancing
          ? Array.from({ length: valid.duration }, (_, frame) => {
              while (cursor + 1 < l.keys.length && l.keys[cursor + 1].frame <= frame) cursor++;
              return { frame, shapes: expandKey(cursor, frame) };
            })
          : l.keys.map((key, index) => ({ ...key, shapes: expandKey(index, key.frame) }));
        return { ...l, keys };
      }),
  };
  const movieViews = createMovieButtonViewBank(valid);
  const childViews = createButtonChildViewBank(valid);
  const childSources = new WeakMap<object, { index: number; frame: number }>();
  const movieSources = new WeakMap<
    object,
    {
      owner?: number;
      path: string;
      identity: string;
      start: number;
      end: number;
      duration: number;
      firstFrame: number;
    }
  >();
  const buttons: {
    token: string;
    parent?: { index: number; frame: number };
    exposure: { start: number; end: number };
    scope?: {
      owner?: number;
      path: string;
      identity: string;
      start: number;
      end: number;
      duration: number;
      firstFrame: number;
    };
    instanceId: string;
    rootLayer?: string;
    symbolId: string;
    name: string;
    poses: Record<'up' | 'over' | 'down', MoviePaint[]> & { hit: ExportHitItem[] };
    states: NonNullable<NonNullable<Project['symbols']>[number]['buttonStates']>;
    plans: number;
  }[] = [];
  const buttonCache = new Map<string, number>();
  const buttonPlans: Record<number, MovieClockPlan>[] = [];
  const buttonPlanCache = new Map<string, number>();
  type MoviePaint = {visibilityOwner?:number;transformOwner?:number} & (
    | { maskLayers: { id: string; visible: boolean; shapes: MoviePaint[] }[];
        masks: NonNullable<Project['layerMasks']>; opacity: number }
    | { button: number }
    | SharedPlacement
    | ReturnType<typeof renderData>
    | {
        kind: 'symbol';
        id: string;
        symbolId?: string;
        symbolPlayback: Project['layers'][number]['keys'][number]['shapes'][number]['symbolPlayback'];
        movie: number;
      });
  function compileGroup<T>(item: Extract<SymbolPaintItem, { kind: 'masked-symbol' }>, child: (item: SymbolPaintItem) => T) {
    compiledShapes += 1 + item.layers.length;
    if (compiledShapes > MAX_HTML_COMPILED_SHAPES) throw Error('Animated symbol export exceeds one million compiled shapes.');
    return { masks: item.masks, opacity: item.opacity, ...(item.blurRadius||item.blendMode||item.tint?{blurRadius:item.blurRadius??0,blendMode:item.blendMode,tint:item.tint,worldBounds:symbolBlurBounds(item)}:{}), maskLayers: item.layers.map(track => ({
      id: track.id, visible: track.visible, shapes: (item.drawingGroup ? track.items : groupDrawingPaint(track.items)).map(child),
    })) };
  }
  function compileHit(item: SymbolPaintItem): ExportHitItem {
    return item.kind === 'masked-symbol' ? compileGroup(item, compileHit) : renderData(item);
  }
  function compileItem(item: SymbolPaintItem, layer?: string, owner?: { index: number; frame: number }, movieAncestors?: MoviePlacementRoute): MoviePaint {
    const data: MoviePaint = item.kind !== 'masked-symbol' ? compileShape(item, layer, owner, movieAncestors) :
      compileGroup(item, child => compileItem(child, layer, owner, movieAncestors));
    const visibilityOwner=visibilityOwners.get(item);
    return visibilityOwner===undefined?data:{...data,visibilityOwner};
  }
  const movieFrames: MoviePaint[][][] = [];
  const movieCache = new Map<string, number>();
  const compileShape = (
    s: Project['layers'][number]['keys'][number]['shapes'][number],
    layer?: string,
    owner?: { index: number; frame: number },
    movieAncestors?: MoviePlacementRoute,
  ): MoviePaint => {
    const shared = sharedPlacements.get(s);
    if (shared) return shared;
    const token = rootSources.get(s);
    if (token) {
      // A script target keeps its address when the containing Movie moves.
      // Each compiled pose still owns its own Hit geometry and parent index.
      const parent = childSources.get(s);
      const cacheKey = trajectory && (parent || movieSources.has(s)) ? JSON.stringify([token, parent, s]) : token;
      let button = buttonCache.get(cacheKey);
      if (button === undefined) {
        button = buttons.length;
        buttonCache.set(cacheKey, button);
        const definition = buttonDefinitions.get(s.symbolId!)!;
        let planIndex = buttonPlanCache.get(definition.id);
        if (planIndex === undefined) {
          planIndex = buttonPlans.length;
          buttonPlanCache.set(definition.id, planIndex);
          buttonPlans.push(
            Object.fromEntries(compileButtonStatePlans(definition, valid.symbols!, valid.fps)),
          );
        }
        const poses = {} as (typeof buttons)[number]['poses'];
        buttons.push({
          token,
          parent,
          exposure: exposureSpans.get(token)!,
          scope: movieSources.get(s),
          instanceId: s.id,
          rootLayer: layer,
          symbolId: s.symbolId!,
          name: definition.name,
          poses,
          states: definition.buttonStates!,
          plans: planIndex,
        });
        for (const name of ['up', 'over', 'down', 'hit'] as const) {
          const items: SymbolPaintItem[] | undefined = hasSymbolMasks ? [] : undefined;
          const nested = (shape: typeof s) => shape.id !== s.id && !!shape.symbolId && buttonDefinitions.has(shape.symbolId);
          let shapes = expandSymbols(
            valid,
            [
              {
                ...s,
                symbolPlayback: { mode: 'single', firstFrame: definition.buttonStates![name] },
              },
            ],
            0,
            undefined,
            name === 'hit' ? undefined : () => true, items && name !== 'hit' ? nested : undefined, items,
          );
          if (name !== 'hit') {
            const span = exposureSpans.get(token)!;
            const parent: RootButton = {
              token,
              start: span.start,
              end: span.end,
              layerId: layer ?? 'root',
              name: definition.name,
              shape: s,
              poses: {} as RootButton['poses'],
            };
            const view = childViews.sample(parent, name);
            if (view.buttons.length) {
              const placed = items && new Map(shapes.filter(nested).map(shape => [shape.id, shape]));
              const replacements = new Map(
                view.buttons.map((child) => {
                  const shape = placed ? placed.get(child.shape.id) : child.shape;
                  if (!shape || shape.symbolId !== child.shape.symbolId) throw Error('Missing original button-state placement.');
                  rootSources.set(shape, child.token);
                  exposureSpans.set(child.token, span);
                  childSources.set(shape, { index: button!, frame: view.frame });
                  return [child.token, [child.shape]];
                }),
              );
              if (!items) shapes = view.render(null, null, replacements);
            }
          }
          compiledShapes += shapes.length;
          if (compiledShapes > MAX_HTML_COMPILED_SHAPES)
            throw new Error('Animated symbol export exceeds one million compiled shapes.');
          if (name === 'hit') poses.hit = (items ?? shapes).map(compileHit);
          else
            poses[name] = groupDrawingPaint(items ?? shapes).map((shape) =>
              compileItem(shape, 'root', {
                index: button!,
                frame: definition.buttonStates![name],
              }),
            );
        }
      }
      return { button };
    }
    if (s.symbolPlayback?.mode !== 'movie') return renderData(s);
    const signature = JSON.stringify([layer, s, owner]);
    const cacheKey = movieAncestors ? JSON.stringify([movieAncestors,signature]) : signature;
    const tokenSignature = owner && trajectory
      ? stateMovieButtonSignature(buttons[owner.index].token, owner.frame, s.id, s.symbolId!)
      : movieAncestors && layer !== undefined
        ? nestedSceneMovieButtonSignature(layer,movieAncestors,s.id,s.symbolId!)
        : signature;
    let movie = movieCache.get(cacheKey);
    if (movie === undefined) {
      movie = movieFrames.length;
      movieFrames.push([]);
      movieCache.set(cacheKey, movie);
      const definition = valid.symbols!.find((d) => d.id === s.symbolId)!;
      const childAncestors:MoviePlacementRoute|undefined=trajectory&&!owner
        ? [...(movieAncestors??[]),[s.id,s.symbolId!]]:undefined;
      const frames = Array.from({ length: definition.timeline?.duration ?? 1 }, (_, frame) => {
        let shapes: Project['layers'][number]['keys'][number]['shapes'];
        const items: SymbolPaintItem[] | undefined = hasSymbolMasks ? [] : undefined;
        const nested = (shape: typeof s) => shape.id !== s.id && !!shape.symbolId && buttonDefinitions.has(shape.symbolId);
        const expanded = items || layer === undefined || !buttonDefinitions.size
          ? expandSymbols(valid, [s], 0, () => frame, child => child.id !== s.id, items ? nested : undefined, items)
          : undefined;
        if (layer !== undefined && buttonDefinitions.size) {
          const placed = expanded && new Map(expanded.filter(nested).map(shape => [shape.id, shape]));
          const view = movieViews.sample(s, layer, frame, 0);
          const placeholders = new Map(
            view.buttons.map((button) => {
              const lifetime = view.lifetimes.get(button.token)!;
              const token = movieButtonExportToken(tokenSignature,lifetime);
              const shape = placed ? placed.get(button.shape.id) : button.shape;
              if (!shape || shape.symbolId !== button.shape.symbolId) throw Error('Missing original movie-local button placement.');
              rootSources.set(shape, token);
              exposureSpans.set(token, { start: 0, end: valid.duration });
              if (owner) childSources.set(shape, owner);
              const instanceId = owner
                ? 'preview' + s.id.slice(buttons[owner.index].instanceId.length)
                : s.id;
              movieSources.set(shape, {
                owner: owner?.index,
                path: layer + '/' + instanceId + '/' + s.symbolId,
                ...lifetime,
              });
              return [button.token, [shape]];
            }),
          );
          shapes = expanded ?? view.render(null, null, placeholders);
        } else shapes = expanded!;
        compiledShapes += shapes.length;
        if (compiledShapes > MAX_HTML_COMPILED_SHAPES)
          throw new Error('Animated symbol export exceeds one million compiled shapes.');
        return groupDrawingPaint(items ?? shapes).map(shape => compileItem(shape, layer, owner, childAncestors));
      });
      movieFrames[movie] = frames;
    }
    return {
      kind: 'symbol',
      id: s.id,
      symbolId: s.symbolId,
      symbolPlayback: s.symbolPlayback,
      movie,
    };
  };
  // Recompile just the changed original placements. Reusing the ordinary
  // expansion and paint compiler preserves affine gradients, masks and filters.
  const transformVariants:MoviePaint[][]=[];
  if(transformTargets.size&&trajectory){
    const variants=new Map<string,number>();
    let entries:TransformEntry[]=[];
    let previous='';
    for(const pose of trajectory){
      entries=transformChanges.get(pose.tick)??entries;
      const active:[number,number][]=[];
      for(const entry of entries){
        if(++compiledShapes>MAX_HTML_COMPILED_SHAPES)throw Error('Animated symbol export exceeds one million compiled shapes.');
        const [id,x,y,rotation,basis]=entry;
        const target=transformTargets.get(id)!;
        if(pose.frame<target.start||pose.frame>=target.end)continue;
        const age=pose.frame-target.start;
        const localFrame=symbolLocalFrame(target.duration,age,target.shape.symbolPlayback);
        const signature=JSON.stringify([localFrame,entry]);
        let variant=variants.get(signature);
        if(variant===undefined){
          const placed={...target.shape,x,y,rotation,...(basis?{transform:basis}:{})};
          const leaves=expand([placed],age,'',target.start,target.end,target.layer);
          const items=groupDrawingPaint(exposurePaint.get(leaves)??leaves);
          variant=transformVariants.length;
          transformVariants.push(items.map(item=>compileItem(item,target.layer)));
          variants.set(signature,variant);
        }
        active.push([target.index,variant]);
      }
      const stamp=JSON.stringify(active);
      if(stamp!==previous){pose.transforms=active;previous=stamp;}
    }
  }
  function replayOwner(shape:SymbolPaintItem):number|undefined {
    if(!transformTargets.size)return undefined;
    if(shape.kind!=='masked-symbol'||!shape.drawingGroup)return transformOwners.get(shape);
    const members=shape.layers[0].items;
    const owner=members.map(member=>transformOwners.get(member)).find(id=>id!==undefined);
    if(owner!==undefined&&members.some(member=>transformOwners.get(member)!==owner))
      throw Error('Replay Graphic transform crosses a drawing group boundary.');
    return owner;
  }
  const spawnVariants:MoviePaint[][]=[],spawnBitmaps=new Set<string>();
  if(spawnSource&&spawnLayer&&trajectory){
    const variants=new Map<string,number>();
    let entries:SpawnedGraphic[]=[];
    let previous='';
    for(const pose of trajectory){
      entries=spawnChanges.get(pose.tick)??entries;
      const active=entries.map((entry,index)=>{
        if(++compiledShapes>MAX_HTML_COMPILED_SHAPES)throw Error('Animated symbol export exceeds one million compiled shapes.');
        const shape=spawnSource!.shape(entry,index,pose);
        const signature=JSON.stringify(shape);
        const saved=variants.get(signature);
        if(saved!==undefined)return saved;
        const items:SymbolPaintItem[]=[];
        const leaves=expandSymbols(valid,[shape],0,undefined,undefined,undefined,items);
        compiledShapes+=leaves.length;
        if(compiledShapes>MAX_HTML_COMPILED_SHAPES)throw Error('Animated symbol export exceeds one million compiled shapes.');
        for(const leaf of leaves)if(leaf.bitmap)spawnBitmaps.add(leaf.bitmap.assetId);
        const variant=spawnVariants.length;
        spawnVariants.push(groupDrawingPaint(items).map(item=>compileItem(item)));
        variants.set(signature,variant);
        return variant;
      });
      const stamp=JSON.stringify(active);
      if(stamp!==previous){pose.spawns=active;previous=stamp;}
    }
  }
  const movieDefinitions = new Set(
    p.layers.flatMap((l) =>
      l.keys.flatMap((k) => k.shapes.filter((s) => s.kind === 'symbol').map((s) => s.symbolId)),
    ),
  );
  // Movies compile their nested graphic frames; include every transitive paint dependency.
  function collect(id: string) {
    const d = valid.symbols?.find((s) => s.id === id);
    for (const s of d ? symbolArtworks(d).flat() : []) {
      if (s.symbolId && !movieDefinitions.has(s.symbolId)) {
        movieDefinitions.add(s.symbolId);
        collect(s.symbolId);
      }
    }
  }
  for (const id of [...movieDefinitions]) if (id) collect(id);
  const movieArtwork = (valid.symbols ?? [])
    .filter((d) => movieDefinitions.has(d.id))
    .flatMap((d) => symbolArtworks(d).flat());
  const { bitmapAssets, fonts } = resolveExportPaintAssets(
    p.assets, [...movieArtwork, ...p.layers.flatMap(layer => layer.keys.flatMap(key => key.shapes))], spawnBitmaps,
  );
  // Local file URLs cannot reliably supply font bytes or readable Canvas pixels.
  const localMedia: Record<string, string> = {};
  const folderMedia = (path: string, dataUrl?: string) => {
    if (!webFiles || !dataUrl) throw Error(`Cannot export missing media for ${path}.`);
    localMedia[path] = dataUrl;
    return addWebMedia(webFiles, path, dataUrl);
  };
  const compiled = {
    ...p,
    opacityBindings:undefined,
    opacityChannels:channels.length?channels:undefined,
    clockPlan: compileMovieClockPlan(valid),
    movieFrames,
    ...(sharedPaint?.artwork.length ? { sharedArtwork: sharedPaint.artwork } : {}),
    buttons,
    buttonPlans,
    ...(transformVariants.length?{transformVariants}:{}),
    ...(spawnLayer?{spawnVariants}:{}),
    assets: webFiles ? bitmapAssets.map((asset, index) => {
      const { dataUrl, ...bitmap } = asset.bitmap!;
      return { ...asset, bitmap: { ...bitmap, src: folderMedia(`assets/images/image-${index + 1}.png`, dataUrl) } };
    }) : bitmapAssets,
    ...(fonts.length ? { fonts: fonts.map((font, index) => webFiles
      ? { family: font.family, src: folderMedia(`assets/fonts/font-${index + 1}.ttf`, font.dataUrl) }
      : { family: font.family, dataUrl: font.dataUrl }) } : {}),
    layers: [...p.layers.map((l) => ({
      ...l,
      keys: l.keys.map((k) => ({
        ...k,
        shapes: groupDrawingPaint(exposurePaint.get(k.shapes) ?? k.shapes).map((shape) => {
          const transformOwner=replayOwner(shape);
          const transformTag=transformOwner===undefined?undefined:{transformOwner};
          if(shape.kind==='masked-symbol' && shape.drawingGroup)return {...compileGroup(shape, member=>{
            const data=compileItem(member,l.id),owner=paintOwners.get(member);
            return owner ? {...data,groupMemberOpacity:owner} : data;
          }),...transformTag};
          const data = compileItem(shape, l.id);
          const opacityOwner = paintOwners.get(shape), textInstance = textOwners?.get(shape);
          if (opacityOwner === undefined && textInstance === undefined && !transformTag) return data;
          return {
            ...data,
            ...transformTag,
            ...(opacityOwner === undefined ? {} : { opacityOwner }),
            ...(textInstance === undefined ? {} : { textInstance }),
          };
        }),
      })),
    })),...(spawnLayer?[spawnLayer]:[])],
  };
  const data = webFiles ? 'animation' : JSON.stringify(compiled).replace(/</g, '\\u003c');
  if (webFiles) webFiles.set('data/animation.js', webDataScript('animation', compiled));
  const textData = textValues && JSON.stringify(textValues).replace(/</g, '\\u003c');
  const dynamicText = !!textData || !!textTrack;
  const heldPNG = captureFrame === 'sequence' && !trajectory && !dynamicText &&
    !valid.symbols?.length && !channels.length && !valid.layerMasks?.length;
  const wave=replayWave&&trajectory?encodeReplayWave(replayWave,trajectory.length-1,p.fps):undefined;
  const playback=replayText&&trajectory
    ? `${wave?`const soundtrack=document.querySelector('audio'),transport=document.querySelector('button');
const audioReady=new Promise((resolve,reject)=>{if(soundtrack.error)reject(soundtrack.error);else if(soundtrack.readyState>=2)resolve();else{soundtrack.addEventListener('loadeddata',resolve,{once:true});soundtrack.addEventListener('error',reject,{once:true});}});`:''}
Promise.all([ready,document.fonts.ready${wave?',audioReady':''}]).then(()=>{c.dataset.assets='ready';const poses=${JSON.stringify(trajectory).replace(/</g,'\\u003c')};
${textTrack?`const textChanges=${textTrack};let textIndex=0;presentText=true;`:''}
let next=0,hidden;function paintReplay(target){
const end=Math.min(target+1,next+32);for(;next<end;next++){const pose=poses[next];hidden=pose.hiddenButtons??hidden;${textTrack?'if(textChanges[textIndex]?.tick===pose.tick)textValues=textChanges[textIndex++].values;':''}${visibilityTags.size?'if(pose.hiddenGraphics)hiddenGraphics=new Set(pose.hiddenGraphics);':''}${transformVariants.length?'if(pose.transforms)currentTransforms=new Map(pose.transforms);':''}${spawnLayer?'if(pose.spawns)scriptPaint=pose.spawns.flatMap(index=>p.spawnVariants[index]);':''}draw(0,pose.frame,pose.tick,pose.buttonState,hidden);c.dataset.frame=String(pose.frame);c.dataset.tick=String(pose.tick);}
c.dataset.capture=next===poses.length?'ready':'playing';
}
${replayCapture?`c.addEventListener('capture-next',()=>{try{
if(next>=poses.length)throw Error('Replay capture finished');paintReplay(next);
}catch{c.dataset.capture='error';}});
c.dataset.capture='waiting';`:wave?`let raf=0;
const fail=()=>{soundtrack.pause();cancelAnimationFrame(raf);transport.disabled=true;transport.textContent='Replay unavailable';c.dataset.capture='error';};
const paintSound=()=>{raf=0;try{
const target=soundtrack.ended?poses.length-1:Math.min(poses.length-1,Math.floor(soundtrack.currentTime*p.fps));
paintReplay(target);
if(next<=target||!soundtrack.paused&&next<poses.length)requestPaint();
}catch{fail();}};
function requestPaint(){if(!raf)raf=requestAnimationFrame(paintSound);}
soundtrack.addEventListener('play',()=>{transport.textContent='Pause replay';requestPaint();});
soundtrack.addEventListener('pause',()=>{if(!soundtrack.ended)transport.textContent='Play replay';requestPaint();});
soundtrack.addEventListener('ended',()=>{transport.textContent='Replay finished';transport.disabled=true;requestPaint();});
soundtrack.addEventListener('error',fail);
transport.onclick=async()=>{if(!soundtrack.paused){soundtrack.pause();return;}transport.disabled=true;try{await soundtrack.play();if(!soundtrack.ended&&!soundtrack.error)transport.disabled=false;}catch{fail();}};
paintReplay(0);transport.disabled=false;`:`let first;function play(now){try{first??=now;paintReplay(Math.min(poses.length-1,Math.floor((now-first)*p.fps/1000)));
if(next<poses.length)requestAnimationFrame(play);}catch{c.dataset.capture='error';}}requestAnimationFrame(play);`}
}).catch(()=>{c.dataset.capture='error';${wave?"transport.textContent='Replay unavailable';":''}});`
    : undefined;
  const soundData = soundtrack ? htmlSoundtrackSource(soundtrack, p.duration, p.fps) : undefined;
  const standaloneSound = webFiles && soundData
    ? addWebMedia(webFiles, `assets/audio/soundtrack.${soundtrack?.format === 'opus' ? 'ogg' : 'wav'}`, soundData)
    : soundData;
  const standalonePlayback = standaloneSound ? soundtrackPlayback : interactiveArtwork ? `Promise.all([ready,document.fonts.ready]).then(()=>{
    draw(0,0,0);
    c.splashPresentScriptFrame=(frame,tick)=>{draw(0,frame,tick);c.dataset.frame=String(frame);c.dataset.tick=String(tick);};
    c.dataset.frame='0';c.dataset.tick='0';c.dataset.scriptArtwork='ready';
    c.dispatchEvent(new Event('splash-script-artwork'));
  }).catch(()=>{c.dataset.scriptArtwork='error';c.dispatchEvent(new Event('splash-script-artwork'));});`
    : `ready.then(()=>requestAnimationFrame(draw)).catch(error=>{
  const message=document.createElement('p');
  message.className='asset-error';
  message.setAttribute('role','alert');
  message.textContent=error instanceof Error?error.message:'The animation failed to start.';
  document.body.replaceChildren(message);
});`;
  const embeddedAudio = wave ? `data:audio/wav;base64,${wave}` : standaloneSound;
  const canvas = `<canvas width="${output.width}" height="${output.height}" aria-label="Animation"></canvas>`;
  const canvasStyle = web ? webCanvasLayout(web.sizing, output.width, output.height, !!embeddedAudio) : '';
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${replayText?'Splash script replay':'Splash animation'}</title><style>body{margin:0;background:#20232a;display:grid;place-items:center;height:100vh}canvas{max-width:100%;max-height:100vh;object-fit:contain;touch-action:none}.asset-error{margin:24px;color:#f4f5f8;font:16px system-ui;text-align:center}${embeddedAudio?'body{grid-template-rows:minmax(0,1fr) auto}canvas{max-height:100%}button{margin:8px 0 16px;padding:7px 14px;font:inherit}':''}${canvasStyle}</style>${web ? `<main class="web-stage">${canvas}</main>` : canvas}${embeddedAudio?`<button type="button" disabled>${wave?'Play replay':'Play animation'}</button><audio hidden preload="auto"${standaloneSound?' loop':''} src="${embeddedAudio}"></audio>`:''}`;
  const player = `
const {fontFamilyForRendering:fontFamilies}=(${createFontFamilyResolver.toString()})();
const selectSoftwareBlend=${softwareBlend.toString()}, paintBoxBlur=${paintBoxBlur.toString()};
const blurDrawing=(target,shape,paint,decodedPixels)=>paintBoxBlur(target,shape,paint,decodedPixels,selectSoftwareBlend);

const paintCommands=${paintCommands.toString()};
${sharedPaint?.artwork.length ? `const placementMatrix=(${matrix.toString()}),composePlacement=(${multiply.toString()});` : ''}
const ${dynamicText ? 'paintBase' : 'paint'}=(ctx,shape,layout,image,richPaint)=>paintCommands(ctx,shape,layout,image,richPaint,undefined,fontFamilies,blurDrawing,reservedMaskPixels);
  ${dynamicText ? `let textValues=${textData??'null'};let presentText=false;
function paint(ctx,shape,layout,image,richPaint,textOwner){
  const text=shape.text,binding=text?.dynamicBinding;
  if(presentText&&binding&&textValues){
    const scoped=textOwner===undefined?undefined:JSON.stringify([textOwner,binding]);
    const key=scoped!==undefined&&Object.hasOwn(textValues,scoped)?scoped:binding;
    const content=Object.hasOwn(textValues,key)?textValues[key]:undefined;
    if(typeof content==='string'&&text.content!==content){
      const next=text.runs?.length&&richPaint?richRuntime.reconcileStyledText(text.content,text.runs,content):{content};
      shape={...shape,text:{...text,...next}};
    }
  }
  paintBase(ctx,shape,layout,image,richPaint);
}` : ''}
const layout=${wrapText.toString()};
${movieArtwork.some((s) => s.text?.runs?.length) || p.layers.some((l) => l.keys.some((k) => k.shapes.some((s) => s.text?.runs?.length))) ? `const richRuntime=(${createRichTextRuntime.toString()})();const richResolve=(${createBidiTextRuntime.toString()})((${bidiFactory.toString()})(),richRuntime.canonicalTextRuns);const richPaint=(${createRichPainter.toString()})(richRuntime,richResolve,fontFamilies);` : 'const richPaint=undefined;'}
const p=${data},c=document.querySelector('canvas'),x=c.getContext('2d');x.scale(${output.width/p.width},${output.height/p.height});let start;const images=Object.create(null);
const makeButtonExposures=(${createButtonExposureRuntime.toString()});
const crossedEntry=(${crossedButtonEntry.toString()});
const movieEntry=(${movieButtonEntrySeconds.toString()});
${p.layerMasks?.length || hasSymbolMasks?`const compositeMasks=(${createLayerMaskCompositor.toString()})(${MASK_WORKING_PIXELS},(${maskPaintChains.toString()}));`:''}
${hasSymbolMasks || rootChain ? `const ancestors=(${maskAncestors.toString()});` : ''}
${(hasSymbolMasks || rootChain) && buttons.length ? `const maskCoverage=(${createMaskCoverage.toString()})((ctx,shape)=>paintCommands(ctx,shape,layout,shape.bitmap?images[shape.bitmap.assetId]:undefined,richPaint,undefined,fontFamilies,blurDrawing,reservedMaskPixels),compositeMasks,p.assets.reduce((n,a)=>n+(a.bitmap?a.bitmap.width*a.bitmap.height:0),0));` : ''}
const buttonRuntime=(${createExportButtonRuntime.toString()})(c,p.buttons,p.width,p.height,${!trajectory}${(hasSymbolMasks || rootChain) && buttons.length ? ',maskCoverage,ancestors' : ''});
const makeMovieTree=${createMovieTreeRuntime.toString()},makeMovieClock=${createMovieClock.toString()};
const movieClock=makeMovieTree(p.clockPlan,makeMovieClock);
const buttonMovies=(${createExportButtonMovieRuntime.toString()})(p.buttons,makeMovieTree,makeMovieClock,p.buttonPlans);
const bitmapReady=p.assets.map(a=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images[a.id]=image;resolve()};image.onerror=()=>reject(new Error('The embedded bitmap “'+a.bitmap.name+'” could not be decoded.'));image.src=${webFiles ? 'localMedia?.[a.bitmap.src]??a.bitmap.src' : 'a.bitmap.dataUrl'}}));
const fontReady=(p.fonts??[]).map(async font=>{
  try {
    let bytes;
    const dataUrl=${webFiles ? 'localMedia?.[font.src]' : 'font.dataUrl'};
    if(!dataUrl){
      const response=await fetch(font.src);
      if(!response.ok)throw Error('Font response failed.');
      bytes=await response.arrayBuffer();
    }else{
      const payload=dataUrl.slice(dataUrl.indexOf(',')+1);
      bytes=Uint8Array.from(atob(payload),c=>c.charCodeAt(0));
    }
    const face=await new FontFace(font.family,bytes).load();
    document.fonts.add(face);
  } catch { throw new Error('The embedded font “'+font.family+'” could not be loaded.'); }
});
const ready=Promise.all([...bitmapReady,...fontReady]);
const makeHeldKeySampler=${createHeldKeySampler.toString()};
${channels.length?`const easeOpacity=${evaluatedMotionProgress.toString()},interpolateOpacity=${interpolateOpacityKeys.toString()};
function rootOpacity(owner,f){const list=p.opacityChannels[owner.channel];let lo=0,hi=list.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(list[mid].start<=f)lo=mid+1;else hi=mid;}const binding=list[lo-1];return binding&&f<=binding.end?interpolateOpacity(binding.keys,f,easeOpacity):owner.base;}`:''}
const rootTracks=p.layers.filter(l=>l.visible).map(l=>({id:l.id,sample:makeHeldKeySampler(l.keys)}));
${visibilityTags.size?'let hiddenGraphics=new Set();':''}
${spawnLayer?`let scriptPaint=[];const scriptLayer=${JSON.stringify(spawnLayer.id)};`:''}
${transformVariants.length?`let currentTransforms=new Map();
function replayPaint(shapes){
  if(!currentTransforms.size)return shapes;
  const result=[],placed=new Set();
  for(const shape of shapes){
    const owner=shape.transformOwner,index=currentTransforms.get(owner);
    if(index===undefined)result.push(shape);
    else if(!placed.has(owner)){placed.add(owner);for(const item of p.transformVariants[index])result.push(item);}
  }
  return result;
}`:''}
let reservedMaskPixels=p.assets.reduce((sum,a)=>sum+(a.bitmap?a.bitmap.width*a.bitmap.height:0),0);
const maskScratchPixels=3*c.width*c.height;
let lastActive=[],previousButtonPosition;const localGuards=new Map();
function draw(t,exactFrame,hostTick,buttonState,hiddenButtons){const hidden=hiddenButtons?new Set(hiddenButtons):undefined;buttonRuntime.beginPresentation(buttonState);start??=t;const seconds=hostTick!==undefined?hostTick/p.fps:exactFrame===undefined?(t-start)/1000:exactFrame/p.fps,position=exactFrame??Math.floor(seconds*p.fps),f=position%p.duration,movies=movieClock.sample(f,seconds,hostTick===undefined?position:undefined),origins=movieClock.origins();const active=[],expired=new Set(),continuity=new Map(),stateFrames=new Map(),stateOrigins=new Map();
const clips=new Map();
function frozen(shapes,layer,clocks,instanceId){
  return shapes.flatMap(s=>{
    if(s.maskLayers)return [{...s,maskLayers:s.maskLayers.map(l=>({...l,shapes:frozen(l.shapes,layer,clocks,instanceId)}))}];
    if(s.movie!==undefined){const frames=p.movieFrames[s.movie],id=instanceId===undefined?s.id:'preview'+s.id.slice(instanceId.length);return frozen(frames[(clocks[layer+'/'+id+'/'+s.symbolId]??0)%frames.length],layer,clocks,instanceId);}
    if(s.button!==undefined)return frozen(buttonRuntime.pose(s.button),'root',stateFrames.get(s.button)??{},p.buttons[s.button].instanceId);
    return [s];
  });
}
function discover(shapes,layer,clocks=movies,instanceId,ancestor){for(const s of shapes){
if(s.maskLayers){
  for(const track of s.maskLayers){
    if(!track.visible||s.masks.some(m=>m.maskLayerId===track.id))continue;
    const sources=ancestors(s.masks,track.id).map(id=>s.maskLayers.find(l=>l.id===id));
    if(sources.some(source=>!source?.visible))continue;
    const clip=sources.length?(x,y)=>sources.reduce((a,source)=>a&&Math.round(a*maskCoverage(frozen(source.shapes,layer,clocks,instanceId),x,y)/255),ancestor?ancestor(x,y):255):ancestor;
    discover(track.shapes,layer,clocks,instanceId,clip);
  }
  continue;
}
if(s.button!==undefined){const id=s.button,b=p.buttons[id],scope=b.scope,parent=b.parent;if(hidden?.has(b.token))continue;active.push(id);if(ancestor)clips.set(id,ancestor);
const clock=scope?.owner===undefined?movies:stateFrames.get(scope.owner),origin=scope?.owner===undefined?origins:stateOrigins.get(scope.owner);
let guard=localGuards.get(id);if(!guard){guard=makeButtonExposures();localGuards.set(id,guard);}
const spans=scope?[{id:scope.path+':'+origin?.[scope.path],start:scope.start,end:scope.end,duration:scope.duration,position:scope.firstFrame+(clock?.[scope.path]??0)}]:[];
if(guard.sample([{id,...b.exposure,ancestors:spans}],p.duration,hostTick===undefined?position:0).has(id)||(parent&&expired.has(parent.index)))expired.add(id);
let identity;if(hostTick!==undefined&&!scope&&!parent)identity=JSON.stringify(['script-root',b.rootLayer,b.instanceId,b.symbolId]);if(scope){const pos=scope.firstFrame+(clock?.[scope.path]??0),epoch=scope.start===0&&scope.end===scope.duration?0:Math.floor((pos-scope.start)/scope.duration);identity=JSON.stringify([b.instanceId,b.symbolId,scope.path,scope.identity,scope.start,scope.end,scope.duration,origin?.[scope.path],epoch]);}
if(parent)identity=JSON.stringify([continuity.get(parent.index)??p.buttons[parent.index].token,parent.frame,b.instanceId,b.symbolId,identity]);
if(identity!==undefined)continuity.set(id,identity);
buttonRuntime.update([...new Set([...lastActive,...active])],expired);buttonRuntime.resolvePresentation(id,identity,expired.has(id));buttonMovies.prepare(id,identity,expired.has(id));
let entry;if(hostTick===undefined){if(scope&&clock?.[scope.path]!==undefined&&origin?.[scope.path]!==undefined)entry=movieEntry(scope.start,scope.end,scope.duration,scope.firstFrame,clock[scope.path],origin[scope.path],p.fps);else if(!scope)entry=parent?buttonMovies.entrySeconds(parent.index):crossedEntry(b.exposure.start,b.exposure.end,p.duration,previousButtonPosition,position,position/p.fps,p.fps);}
const frames=buttonMovies.sample(id,buttonRuntime.state(id),seconds,entry);stateFrames.set(id,frames);stateOrigins.set(id,buttonMovies.origins(id));discover(buttonRuntime.pose(id),'root',frames,b.instanceId,ancestor);
}else if(s.movie!==undefined){const frames=p.movieFrames[s.movie],id=instanceId===undefined?s.id:'preview'+s.id.slice(instanceId.length);discover(frames[(clocks[layer+'/'+id+'/'+s.symbolId]??0)%frames.length],layer,clocks,instanceId,ancestor);}}}
const rootPoses=rootTracks.map(l=>({id:l.id,shapes:${spawnLayer?'l.id===scriptLayer?scriptPaint:':''}${transformVariants.length?'replayPaint(l.sample(f).shapes)':'l.sample(f).shapes'}}));
${heldPNG?'c.dataset.pngExposure=String(rootTracks.reduce((latest,track)=>Math.max(latest,track.sample(f).frame),0));':''}
${(hasSymbolMasks || rootChain) && p.layerMasks?.length && buttons.length ? `for(const l of rootPoses){
  if(p.layerMasks.some(mask=>mask.maskLayerId===l.id))continue;
  const sources=ancestors(p.layerMasks,l.id).map(id=>rootPoses.find(track=>track.id===id));
  if(sources.some(source=>!source?.shapes.length))continue;
  const clip=sources.length?(x,y)=>sources.reduce((a,source)=>a&&Math.round(a*maskCoverage(source.shapes.flatMap(s=>{
    const items=frozen([s],source.id,movies);
    if(!s.opacityOwner)return items;
    const alpha=rootOpacity(s.opacityOwner,f);
    return items.map(item=>({...item,opacity:(item.opacity??1)*alpha}));
  }),x,y)/255),255):undefined;
  discover(l.shapes,l.id,movies,undefined,clip);
}` : 'for(const l of rootPoses)discover(l.shapes,l.id);'}
previousButtonPosition=position;for(const id of lastActive)if(!active.includes(id)){expired.add(id);localGuards.delete(id);}
buttonRuntime.setAncestorClips(clips);buttonRuntime.update(active,expired);${trajectory ? 'buttonRuntime.commitTargetLifetimes(active,expired,continuity);' : ''}buttonMovies.update(active,new Set(),continuity);lastActive=active;
${captureFrame !== undefined && transparentCapture ? "x.clearRect(0,0,p.width,p.height);" : "x.fillStyle=p.background;x.fillRect(0,0,p.width,p.height);"}function render(shapes,layer,clocks=movies,instanceId,target=x${resolveTextOwner ? ',inheritedTextOwner' : ''}){for(const s of shapes){${visibilityTags.size?'if(hiddenGraphics.has(s.visibilityOwner))continue;':''}${channels.length?'if(s.groupMemberOpacity){target.save();try{target.globalAlpha*=rootOpacity(s.groupMemberOpacity,f);render([{...s,groupMemberOpacity:undefined}],layer,clocks,instanceId,target);}finally{target.restore();}continue;}':''}${resolveTextOwner ? 'const textOwner=inheritedTextOwner??s.textInstance;' : ''}if(s.sharedSymbol!==undefined){
  const art=p.sharedArtwork[s.sharedSymbol];
  const local=s.localFrame??(s.firstFrame+(clocks[layer+'/'+s.movieId+'/'+s.symbolId]??0))%art.frames.length;
  for(const leaf of art.poses[art.frames[local]]){
    const [a,b,c,d,x,y]=composePlacement(s.placement,placementMatrix(leaf));
    const placed={...leaf,x,y,rotation:0,transform:[a,b,c,d],opacity:(leaf.opacity??1)*s.opacity};
    paint(target,placed,layout,leaf.bitmap?images[leaf.bitmap.assetId]:undefined,richPaint);
  }
  continue;
}
if(s.maskLayers&&(s.blurRadius||s.blendMode||s.tint)){blurDrawing(target,{blurRadius:s.blurRadius,blendMode:s.blendMode,tint:s.tint,opacity:s.opacity,worldBounds:s.worldBounds},tile=>{const previous=reservedMaskPixels;reservedMaskPixels=tile.maskReservedPixels;try{render([{...s,blurRadius:undefined,blendMode:undefined,tint:undefined,opacity:1}],layer,clocks,instanceId,tile${resolveTextOwner ? ',textOwner' : ''});}finally{reservedMaskPixels=previous;}},reservedMaskPixels);continue;}if(s.maskLayers){const reserve=reservedMaskPixels;reservedMaskPixels+=s.masks.length?3*target.canvas.width*target.canvas.height:0;try{compositeMasks(target,s.maskLayers,s.masks,(dest,id)=>render(s.maskLayers.find(l=>l.id===id).shapes,layer,clocks,instanceId,dest${resolveTextOwner ? ',textOwner' : ''}),reserve,1,s.opacity);}finally{reservedMaskPixels=reserve;}continue;}if(s.button!==undefined){if(hidden?.has(p.buttons[s.button].token))continue;const state=buttonRuntime.state(s.button);const sampled=buttonMovies.sample(s.button,state,seconds);stateFrames.set(s.button,sampled);render(buttonRuntime.pose(s.button),'root',sampled,p.buttons[s.button].instanceId,target${resolveTextOwner ? ',textOwner' : ''});continue;}const frames=s.movie===undefined?undefined:p.movieFrames[s.movie];if(frames){const id=instanceId===undefined?s.id:'preview'+s.id.slice(instanceId.length);render(frames[(clocks[layer+'/'+id+'/'+s.symbolId]??0)%frames.length],layer,clocks,instanceId,target${resolveTextOwner ? ',textOwner' : ''});}else paint(target,s,layout,s.bitmap?images[s.bitmap.assetId]:undefined,richPaint${resolveTextOwner ? ',textOwner' : ''});}}${p.layerMasks?.length?`compositeMasks(x,p.layers,p.layerMasks,(target,id)=>{const l=rootPoses.find(l=>l.id===id);if(!l)return;reservedMaskPixels+=maskScratchPixels;try{for(const s of l.shapes){target.save();try{if(s.opacityOwner)target.globalAlpha*=rootOpacity(s.opacityOwner,f);render([s],l.id,movies,undefined,target);}finally{target.restore();}}}finally{reservedMaskPixels-=maskScratchPixels;}},p.assets.reduce((n,a)=>n+(a.bitmap?a.bitmap.width*a.bitmap.height:0),0));`:channels.length?`for(const l of rootPoses)for(const s of l.shapes){if(!s.opacityOwner){render([s],l.id);continue;}x.save();try{x.globalAlpha*=rootOpacity(s.opacityOwner,f);render([s],l.id);}finally{x.restore();}}`:'for(const l of rootPoses)render(l.shapes,l.id);'}if(exactFrame===undefined)requestAnimationFrame(draw)}
${playback ?? (trajectory ? `Promise.all([ready,document.fonts.ready]).then(async()=>{const poses=${JSON.stringify(trajectory).replace(/</g, '\\u003c')};let hiddenButtons;for(let i=0;i<poses.length;i++){hiddenButtons=poses[i].hiddenButtons??hiddenButtons;${textData ? 'presentText=i===poses.length-1;' : ''}draw(0,poses[i].frame,poses[i].tick,poses[i].buttonState,hiddenButtons);if(i%32===31)await new Promise(resolve=>setTimeout(resolve,0));}c.dataset.frame=String(poses.at(-1).frame);c.dataset.tick=String(poses.at(-1).tick);c.splashButtonAt=(x,y)=>buttonRuntime.targetAt(x,y);c.dataset.capture='ready';}).catch(()=>{c.dataset.capture='error';});` : captureFrame === undefined ? standalonePlayback : captureFrame === 'sequence' ? `Promise.all([ready,document.fonts.ready]).then(()=>{let next=0;c.addEventListener('capture-next',()=>{try{if(next>=p.duration)throw new Error('Capture finished');draw(0,next);c.dataset.frame=String(next++);c.dataset.capture='ready';}catch{c.dataset.capture='error';}});c.dataset.capture='waiting';}).catch(()=>{c.dataset.capture='error';});` : `Promise.all([ready,document.fonts.ready]).then(async()=>{for(let f=0;f<=${captureFrame};f++){draw(0,f);if(f%32===31)await new Promise(resolve=>setTimeout(resolve,0));}c.dataset.capture="ready";}).catch(()=>{c.dataset.capture="error";});`)}

`;
  if (webFiles) {
    const hasLocalMedia = Object.keys(localMedia).length > 0;
    if (hasLocalMedia) webFiles.set('data/local-media.js', webDataScript('localMedia', localMedia));
    webFiles.set('scripts/player.js', webPlayerScript(player, hasLocalMedia));
    return page + '<script defer src="data/animation.js"></script><script defer src="scripts/player.js"></script></html>';
  }
  return page + '<script>' + player + '</script></html>';
}

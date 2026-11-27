import { symbolLayers, type Project, type Layer, type Vector } from '../../document/src';
import { graphicVisibilityOwner,captureGraphicVisibilityKeys } from '../../animation/src/placement-visibility';
import { MAX_HTML_COMPILED_SHAPES } from '../../export-web/src/live-timeline';
import { compileGraphicButtonPlan, compileGraphicButtonLifetimes } from '../../animation/src/graphic-button-plan';
import { hasInstanceBlur, symbolExposures, symbolLocalFrame } from '../../geometry/src/symbols';
import type { ScriptState } from './timeline';
import type { StagePlacement } from './stage-placements';
import {captureAuthoredButtonRoutes} from './authored-button-routes';

export const hiddenPlacementsKey = '$splashHiddenPlacements';

type VisibilitySource = Pick<Project, 'symbols' | 'layerMasks' | 'opacityBindings'>;

export { graphicVisibilityOwner };

// Shared by the isolated worker and host. Script state already enforces its JSON budget.
export function hiddenPlacementKeys(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(key => typeof key !== 'string') || new Set(value).size !== value.length)
    throw Error('Invalid script placement visibility state.');
  return value.slice();
}

export function createStageVisibility(lookup:(name:string,layerId?:string,parentName?:string)=>StagePlacement|undefined,
  state:ScriptState, stateKey:string, readKeys:typeof hiddenPlacementKeys) {
  function info(item: StagePlacement | undefined) {
    if (!item) return undefined;
    const {id,name,symbolId,layerId,parentId,visible,visibilityKey}=item;
    return Object.freeze({
      id,name,symbolId,layerId,
      ...('parentId' in item ? {parentId} : {}),
      visible:visible && !(visibilityKey && readKeys(state[stateKey]).includes(visibilityKey)),
    });
  }
  function write(item: StagePlacement | undefined, visible: boolean) {
    if (typeof visible !== 'boolean') throw Error('Placement visibility must be boolean.');
    const key=item?.visibilityKey;
    if (!key) throw Error('Visibility requires a named noninteractive graphic or an eligible button on an ordinary layer.');
    const hidden=new Set(readKeys(state[stateKey]));
    if (visible) hidden.delete(key); else hidden.add(key);
    if (hidden.size) state[stateKey]=Array.from(hidden); else delete state[stateKey];
  }
  return {
    getInstance(name:string,layerId?:string) {
      return info(lookup(name,layerId));
    },
    setVisible(name:string,visible:boolean,layerId?:string) {
      write(lookup(name,layerId),visible);
    },
    getChildInstance(parentName:string,name:string,layerId?:string) {
      if (typeof parentName !== 'string') throw Error('Invalid parent placement name.');
      return info(lookup(name,layerId,parentName));
    },
    setChildVisible(parentName:string,name:string,visible:boolean,layerId?:string) {
      if (typeof parentName !== 'string') throw Error('Invalid parent placement name.');
      write(lookup(name,layerId,parentName),visible);
    },
  };
}

export function lastHiddenButtons(poses: readonly {hiddenButtons?: readonly string[]}[], end = poses.length) {
  for (let i = end - 1; i >= 0; i--) {
    const hidden = poses[i].hiddenButtons;
    if (hidden !== undefined) return hidden;
  }
  return [];
}

/** Static containers and single-frame playback use the exporter's fixed exposure token. */
export function nestedButtonOwners(project: VisibilitySource, layers: readonly Layer[], enabled: boolean) {
  const definitions = new Map(project.symbols?.map(definition => [definition.id, definition]));
  const eligible = enabled && simpleNestedPresentation(project,layers);
  const masked = new Set(project.layerMasks?.flatMap(mask => [mask.maskLayerId,...mask.layerIds]));
  const bound = new Set(project.opacityBindings?.map(binding => JSON.stringify([binding.layerId,binding.shapeId])));
  const owner = graphicVisibilityOwner(project, enabled);
  let captured = 0;
  return (layer: Layer, key: Layer['keys'][number]) => {
    const children: {placement: StagePlacement; token: string; parentSymbolId:string; childKey:number}[] = [];
    if (!eligible || layer.guideLayer || masked.has(layer.id) || layer.liveMotionSpans?.length || layer.motionSpans?.length)
      return children;
    const rootIds = new Set(key.shapes.map(shape => shape.id));
    for (const parent of key.shapes) {
      const definition = definitions.get(parent.symbolId!);
      if (parent.kind !== 'symbol' || !parent.instanceName || !parent.id || parent.id.includes('/') ||
          parent.symbolPlayback?.mode === 'movie' || !definition || definition.buttonStates ||
          ((definition.timeline?.duration ?? 1) > 1 && parent.symbolPlayback?.mode !== 'single') ||
          bound.has(JSON.stringify([layer.id,parent.id]))) continue;
      const exposures = symbolExposures(definition,0,parent.symbolPlayback);
      const localFrame = symbolLocalFrame(definition.timeline?.duration ?? 1,0,parent.symbolPlayback);
      const childPaths = new Map<string,number>();
      if (definition.timeline) for (const exposure of exposures) for (const shape of exposure.shapes) {
        if (shape.kind !== 'symbol') continue;
        const path = childPath(parent.id,exposure.layerId,shape.id);
        childPaths.set(path,(childPaths.get(path)??0)+1);
      }
      for (const exposure of exposures) for (const child of exposure.shapes) {
        if (!child.instanceName || !definitions.get(child.symbolId!)?.buttonStates || !owner(layer,key.frame,child)) continue;
        const id = nestedButtonPath(parent.id,exposure.layerId,child.id);
        if (!id || rootIds.has(id)) continue;
        if (definition.timeline && (
          hasCompetingPrefix(rootIds,id,parent.id) ||
          hasCompetingPrefix(childPaths,id) || (childPaths.get(id)??0) > 1
        )) continue;
        if (++captured > MAX_HTML_COMPILED_SHAPES) throw Error('Nested script placement capture exceeds the presentation budget.');
        const visibilityKey = 'nested:' + JSON.stringify([layer.id,key.frame,parent.id,parent.symbolId,id,child.symbolId,child.instanceName]);
        children.push({
          placement: {id,name:child.instanceName,symbolId:child.symbolId!,layerId:layer.id,
            visible:layer.visible,parentId:parent.id,visibilityKey},
          token: buttonExposureToken(layer.id,key.frame,id,child.symbolId!),
          parentSymbolId: definition.id,
          childKey: localFrame - exposure.age,
        });
      }
    }
    return children;
  };
}

function childPath(parentId:string,layerId:string,childId:string) {
  return parentId+(layerId==='@base'?'':'/'+layerId)+'/'+childId;
}
function nestedButtonPath(parentId:string,layerId:string,childId:string) {
  if (!layerId || layerId.includes('/') || !childId || childId.includes('/')) return undefined;
  return childPath(parentId,layerId,childId);
}
function hasCompetingPrefix(paths: {has(path:string):boolean}, path:string, skip?:string) {
  for (let slash=path.indexOf('/'); slash>=0; slash=path.indexOf('/',slash+1)) {
    const prefix=path.slice(0,slash);
    if (prefix!==skip && paths.has(prefix)) return true;
  }
  return false;
}

function simpleNestedPresentation(project: VisibilitySource, layers: readonly Layer[]) {
  return !hasInstanceBlur({layers:[...layers],symbols:project.symbols}) &&
    !project.symbols?.some(definition=>definition.timeline?.layerMasks?.length);
}

/** Capture fixed state-script routes without widening the named-child visibility API. */
export function deepFixedButtonRoutes(project:VisibilitySource,layers:readonly Layer[],artwork?:(symbolId:string)=>boolean){
  const definitions=new Map(project.symbols?.map(definition=>[definition.id,definition]));
  const eligible=simpleNestedPresentation(project,layers);
  const bound=new Set(project.opacityBindings?.map(binding=>JSON.stringify([binding.layerId,binding.shapeId])));
  const owner=graphicVisibilityOwner(project,true);
  let work=0;
  return (layer:Layer,key:Layer['keys'][number])=>{
    const routes:{id:string;symbolId:string;identity:string;token:string}[]=[];
    if(!eligible)return routes;
    const rootIds=new Set(key.shapes.map(shape=>shape.id));
    const counts=new Map<string,number>();
    function walk(shape:Vector,path:string,rootId:string,lineage:readonly(string|number)[],depth:number,admitted:boolean){
      if(++work>MAX_HTML_COMPILED_SHAPES)throw Error('Fixed Button script routes exceed the presentation budget.');
      if(shape.kind!=='symbol'||!shape.symbolId)return;
      const definition=definitions.get(shape.symbolId);
      if(!definition)return;
      const named=admitted&&!!shape.instanceName&&!!shape.id&&!shape.id.includes('/');
      if(definition.buttonStates){
        counts.set(path,(counts.get(path)??0)+1);
        const scripted=depth>2&&definition.timeline?.frameScripts?.length&&owner(layer,key.frame,shape);
        if(depth>1&&named&&(scripted||artwork?.(shape.symbolId))&&
          !rootIds.has(path)&&!hasCompetingPrefix(rootIds,path,rootId)){
          routes.push({id:path,symbolId:shape.symbolId,identity:JSON.stringify(lineage),
            token:buttonExposureToken(layer.id,key.frame,path,shape.symbolId)});
        }
        return;
      }
      const duration=definition.timeline?.duration??1;
      if(depth>=8||shape.symbolPlayback?.mode==='movie'||duration>1&&shape.symbolPlayback?.mode!=='single')return;
      const local=symbolLocalFrame(duration,0,shape.symbolPlayback);
      for(const exposure of symbolExposures(definition,0,shape.symbolPlayback)){
        const trackNamed=!!exposure.layerId&&!exposure.layerId.includes('/');
        for(const child of exposure.shapes)walk(child,childPath(path,exposure.layerId,child.id),rootId,
          [...lineage,exposure.layerId,local-exposure.age,child.id,child.symbolId??''],depth+1,named&&trackNamed);
      }
    }
    for(const root of key.shapes){
      if(root.kind!=='symbol'||!root.symbolId)continue;
      walk(root,root.id,root.id,[layer.id,root.id,root.symbolId],1,!bound.has(JSON.stringify([layer.id,root.id])));
    }
    return routes.filter(route=>counts.get(route.id)===1);
  };
}

/** Own an animated child by the same exposure span the presentation compiler uses. */
export function animatedButtonOwners(project: VisibilitySource, layers: readonly Layer[], duration?: number) {
  if (duration === undefined || !simpleNestedPresentation(project,layers)) return [];
  const definitions = new Map(project.symbols?.map(definition=>[definition.id,definition]));
  const masked = new Set(project.layerMasks?.flatMap(mask=>[mask.maskLayerId,...mask.layerIds]));
  const bound = new Set(project.opacityBindings?.map(binding=>JSON.stringify([binding.layerId,binding.shapeId])));
  const owner = graphicVisibilityOwner(project,true);
  type Candidate = {layerId:string;parentId:string;name:string};
  const candidates = new Map<string,Candidate>();
  for (const layer of layers) {
    if (!layer.visible || layer.guideLayer || masked.has(layer.id) || layer.liveMotionSpans?.length || layer.motionSpans?.length) continue;
    for (const key of layer.keys) {
      const rootIds = new Set(key.shapes.map(shape=>shape.id));
      for (const parent of key.shapes) {
        const definition = definitions.get(parent.symbolId!);
        if (parent.kind !== 'symbol' || !parent.instanceName || !parent.id || parent.id.includes('/') ||
            parent.symbolPlayback?.mode === 'movie' || parent.symbolPlayback?.mode === 'single' ||
            !definition?.timeline || definition.timeline.duration < 2 || definition.buttonStates ||
            bound.has(JSON.stringify([layer.id,parent.id]))) continue;
        for (const track of symbolLayers(definition)) {
          if (!track.visible) continue;
          for (const exposure of track.keys) for (const child of exposure.shapes) {
            if (!child.instanceName || !definitions.get(child.symbolId!)?.buttonStates || !owner(layer,key.frame,child)) continue;
            const id = nestedButtonPath(parent.id,track.id,child.id);
            if (!id || rootIds.has(id) || hasCompetingPrefix(rootIds,id,parent.id)) continue;
            const identity = JSON.stringify([layer.id,key.frame,id,child.symbolId,exposure.frame]);

            candidates.set(identity,{layerId:layer.id,parentId:parent.id,name:child.instanceName});
            if(candidates.size > MAX_HTML_COMPILED_SHAPES) throw Error('Animated script placement capture exceeds the presentation budget.');
          }
        }
      }
    }
  }
  if (!candidates.size) return [];
  const plan = compileGraphicButtonPlan({layers:layers.filter(layer=>!layer.guideLayer),symbols:project.symbols,duration});
  const spans = compileGraphicButtonLifetimes(plan).map(span=>{
    const [, , symbolId, chain] = JSON.parse(span.id) as [string,string,string,[string,number,number][]];
    return {span,symbolId,chain};
  });
  // The renderer indexes by layer and flattened path. A path reached through
  // different ancestry is ambiguous even when the authored keys differ.
  const routes = new Map<string,string>();
  const ambiguous = new Set<string>();
  for (const {span,chain} of spans) {
    const path = JSON.stringify([span.layerId,span.path]);
    const route = JSON.stringify(chain.map(([name])=>name));
    const previous = routes.get(path);
    if (previous !== undefined && previous !== route) ambiguous.add(path);
    routes.set(path,route);
  }
  return spans.flatMap(({span,symbolId,chain})=>{
    if (chain.length !== 2 || ambiguous.has(JSON.stringify([span.layerId,span.path]))) return [];
    const item = candidates.get(JSON.stringify([span.layerId,chain[0][1],span.path,symbolId,chain[1][1]]));
    if (!item) return [];
    const token = JSON.stringify([span.id,span.start,span.end]);
    const placement: StagePlacement = {
      id:span.path,name:item.name,symbolId,layerId:item.layerId,parentId:item.parentId,visible:true,
      visibilityKey:'animated:' + token,
    };
    return [{start:span.start,end:span.end,placement,token}];
  });
}

/** Deeper routes belong to explicit scheduling; the named-child API remains one level deep. */
export function deepGraphicButtonSpans(project:VisibilitySource,layers:readonly Layer[],duration?:number,artwork?:(symbolId:string)=>boolean){
  if(duration===undefined||!project.symbols?.some(item=>item.buttonStates&&(artwork?artwork(item.id):item.timeline?.frameScripts?.length))||
    !simpleNestedPresentation(project,layers))return [];
  const library=new Map(project.symbols.map(definition=>[definition.id,definition]));
  const admitted=(symbolId:string,depth:number)=>artwork?depth>1&&artwork(symbolId):
    depth>2&&!!library.get(symbolId)?.timeline?.frameScripts?.length;
  const masked=new Set(project.layerMasks?.flatMap(mask=>[mask.maskLayerId,...mask.layerIds]));
  const bound=new Set(project.opacityBindings?.map(binding=>JSON.stringify([binding.layerId,binding.shapeId])));
  const allowed=new Set(layers.filter(layer=>layer.visible&&!layer.guideLayer&&!masked.has(layer.id)&&
    !layer.liveMotionSpans?.length&&!layer.motionSpans?.length).map(layer=>layer.id));
  const admitsRoot=(layer:string,shape:Vector)=>allowed.has(layer)&&shape.kind==='symbol'&&
    shape.symbolPlayback?.mode!=='single'&&shape.symbolPlayback?.mode!=='movie'&&
    !bound.has(JSON.stringify([layer,shape.id]))&&(library.get(shape.symbolId!)?.timeline?.duration??1)>1;
  if(!layers.some(layer=>layer.keys.some(key=>key.shapes.some(shape=>admitsRoot(layer.id,shape)))))return [];
  const plan=compileGraphicButtonPlan({layers:layers.filter(layer=>!layer.guideLayer),symbols:project.symbols,duration});
  return captureAuthoredButtonRoutes(plan,{
    root:(layer,_,shape)=>admitsRoot(layer,shape),
    container:()=>true,
    button:(shape,depth)=>admitted(shape.symbolId!,depth),
  }).map(span=>{
    const placement:StagePlacement={id:span.path,name:span.path,symbolId:span.symbolId,layerId:span.layerId,visible:true};
    return {start:span.start,end:span.end,token:JSON.stringify([span.id,span.start,span.end]),placement};
  });
}

export function captureButtonVisibility(project: Project) {
  const owner = graphicVisibilityOwner(project, true);
  const definitions = new Set(project.symbols?.filter(definition => definition.buttonStates).map(definition => definition.id));
  const tokens = new Map<string, string>();
  const nested = nestedButtonOwners(project, project.layers, true);
  for (const layer of project.layers) for (const key of layer.keys) {
    for (const shape of key.shapes) {
      if (!definitions.has(shape.symbolId!)) continue;
      const identity = owner(layer, key.frame, shape);
      if (identity) tokens.set(identity, buttonExposureToken(layer.id,key.frame,shape.id,shape.symbolId!));
    }
    for (const child of nested(layer,key)) tokens.set(child.placement.visibilityKey!, child.token);
  }
  for (const child of animatedButtonOwners(project,project.layers,project.duration))
    tokens.set(child.placement.visibilityKey!,child.token);
  return (hidden: readonly string[]) => hidden.flatMap(key => {
    const token = tokens.get(key);
    return token === undefined ? [] : [token];
  }).sort();
}

export function captureArtworkVisibility(project: Project) {
  const buttonVisibility = captureButtonVisibility(project);
  const graphicKeys = captureGraphicVisibilityKeys(project);
  return (hidden: readonly string[]) => {
    const buttons = buttonVisibility(hidden);
    const graphics = hidden.filter(key=>graphicKeys.has(key)).sort();
    if (buttons.length + graphics.length !== hidden.length)
      throw Error('Unknown script placement visibility target.');
    return { buttons, graphics };
  };
}

export function buttonExposureToken(layer: string, frame: number, id: string, symbolId: string) {
  return JSON.stringify([layer + '/' + frame, id, symbolId]);
}

export function applyStageVisibility(project:Project, state?:ScriptState, directButtonTokens?: Set<string>): Project {
  const hidden=new Set(hiddenPlacementKeys(state?.[hiddenPlacementsKey]));
  if (!hidden.size) return project;
  const owner=graphicVisibilityOwner(project, !!directButtonTokens);
  const buttons = new Set(directButtonTokens ? project.symbols?.filter(definition=>definition.buttonStates).map(definition=>definition.id) : []);
  if (directButtonTokens && [...hidden].some(key=>key.startsWith('nested:'))) {
    const nested = nestedButtonOwners(project, project.layers, true);
    for (const layer of project.layers) for (const key of layer.keys)
      for (const child of nested(layer,key))
        if (hidden.delete(child.placement.visibilityKey!)) directButtonTokens.add(child.token);
  }
  if (directButtonTokens && [...hidden].some(key=>key.startsWith('animated:'))) {
    for (const child of animatedButtonOwners(project,project.layers,project.duration))
      if (hidden.delete(child.placement.visibilityKey!)) directButtonTokens.add(child.token);
  }
  const layers=project.layers.map(layer=>({...layer,keys:layer.keys.map(key=>({...key,shapes:key.shapes.map(shape=>{
    const token=owner(layer,key.frame,shape);
    if (!token || !hidden.delete(token)) return shape;
    if (directButtonTokens && buttons.has(shape.symbolId!)) {
      directButtonTokens.add(buttonExposureToken(layer.id,key.frame,shape.id,shape.symbolId!));
      return shape;
    }
    return {...shape,opacity:0};
  })}))}));
  if (hidden.size) throw Error('Unknown script placement visibility target.');
  return {...project,layers};
}

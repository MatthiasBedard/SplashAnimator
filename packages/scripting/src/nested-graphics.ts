import {symbolLayers,type ButtonStates,type Project,type Vector} from '../../document/src';
import {compileGraphicButtonPlan,sampleGraphicButtonPlan} from '../../animation/src/graphic-button-plan';
import {buttonChildToken} from '../../animation/src/button-child-view';
import {movieButtonExportToken,nestedSceneMovieButtonSignature,stateMovieButtonSignature,type MoviePlacementRoute} from '../../animation/src/movie-button-view';
import {compilePlacedMovieClockPlan,compileSymbolPreviewClockPlan} from '../../animation/src/symbol-preview-clock';
import {createMovieTreeRuntime} from '../../animation/src/movie-tree-clock';
import {createMovieClock} from '../../animation/src/movie-clock';
import {hasInstanceBlur,symbolLocalFrame} from '../../geometry/src/symbols';
import {compileScriptProgram,type CompiledScriptProgram} from './compile-program';
import {executeIsolatedFrameWithState} from './isolated-frame';
import {cloneScriptState,type ScriptState} from './timeline';
import {advanceScriptButtonHover,type ScriptButtonHoverCheckpoint,type ScriptButtonHoverInput,type ScriptButtonTarget} from './button-input';
import {buttonExposureToken,deepFixedButtonRoutes,deepGraphicButtonSpans,graphicVisibilityOwner,hiddenPlacementKeys,hiddenPlacementsKey,nestedButtonOwners,type animatedButtonOwners} from './stage-visibility';
import {captureGraphicChildren} from './stage-children';
import {authoredRouteKey,captureAuthoredButtonRoutes,captureAuthoredMovieBoundaries,captureAuthoredStateLeaves,captureAuthoredStateMovies} from './authored-button-routes';

type ButtonVisual='up'|'over'|'down';
type GraphicOwner={key:string;layerId:string;shapeId:string;symbolId:string;start:number;playback?:Vector['symbolPlayback'];
  button?:{frames:ButtonStates;token:string;visibilityKey?:string;movie?:true;stateChild?:true};child?:true;stateArtwork?:true};
type GraphicSnapshot={key:string;layerId:string;shapeId:string;symbolId:string;frame:number;randomState:number;state:ScriptState;originTick?:number;buttonVisual?:ButtonVisual};
type ChildBranch={duration:number;playback?:Vector['symbolPlayback'];movieKey?:string;
  tracks:{frame:number;items:{owner?:GraphicOwner;branch?:ChildBranch}[]}[][]};
type MovieButtonScope={movieKey:string;duration:number;firstFrame:number;
  items:{start:number;end:number;owner:GraphicOwner}[];
  clockPath?:string;clock?:PreparedMovieClock;children?:{start:number;end:number;scope:MovieButtonScope}[]};
type StateButtonRoute={track:string;shape:Vector;exposures:[string,number,number][]};
type PreparedMovieClock={key:string;definition:string};
type StateButtonChildren={buttons:GraphicOwner[];movies:MovieButtonScope[];clock?:PreparedMovieClock};
export type NestedGraphicState=GraphicSnapshot[];
export type NestedMovieParents=[key:string,originTick:number][];
const instanceLimit=64;

function atBoundary<T>(items:readonly T[],frame:number,start:(item:T)=>number):T|undefined{
  let low=0,high=items.length;
  while(low<high){
    const mid=Math.floor((low+high)/2);
    if(start(items[mid])<=frame)low=mid+1;else high=mid;
  }
  return items[low-1];
}

export async function prepareNestedGraphics(
  project:Pick<Project,'layers'|'symbols'|'layerMasks'|'opacityBindings'>,fps:number,seed:number,
  options:{signal?:AbortSignal;timeoutMs?:number;allowDirectButtons?:boolean;boundedEngine?:boolean},
  animation?:{duration:number;buttons:Readonly<ReturnType<typeof animatedButtonOwners>>},
){
  const boundedEngine=options.boundedEngine===true;
  const definitions=new Map(project.symbols?.filter(item=>(!item.buttonStates||options.allowDirectButtons===true)&&item.timeline?.frameScripts?.length)
    .map(item=>[item.id,item]));
  const library=new Map(project.symbols?.map(item=>[item.id,item]));
  const hasSavedButton=[...definitions.values()].some(item=>!!item.buttonStates);
  const excluded=new Set(project.layerMasks?.flatMap(mask=>[mask.maskLayerId,...mask.layerIds]));
  const owners=new Map<string,GraphicOwner>();
  const movieParents=new Set<string>();
  const buttonTokens=new Map<string,GraphicOwner>();
  const graphicIds=new Set([...definitions.values()].filter(definition=>!definition.buttonStates).map(definition=>definition.id));
  const graphicChildren=graphicIds.size?captureGraphicChildren(project,graphicIds):undefined;
  const stateButtonRoutes=new Map<string,Map<number,StateButtonRoute[]>>();
  const stateRouteBudget={remaining:2000000};
  const resolvingStates=new Set<string>();
  function stateButtons(id:string){
    const cached=stateButtonRoutes.get(id);
    if(cached)return cached;
    if(resolvingStates.size>=8||resolvingStates.has(id))throw Error('Nested Button script depth or cycle limit.');
    const mapped=new Map<number,StateButtonRoute[]>();
    const definition=library.get(id);
    if(!hasSavedButton||!definition?.buttonStates||definition.timeline?.layerMasks?.length)return mapped;
    options.signal?.throwIfAborted();
    resolvingStates.add(id);
    const {up,over,down}=definition.buttonStates,duration=definition.timeline?.duration??1;
    const layers=symbolLayers(definition);
    const allowed=new Set(layers.filter(layer=>!layer.guideLayer&&!layer.id.includes('/')&&
      !layer.liveMotionSpans?.length&&!layer.motionSpans?.length).map(layer=>layer.id));
    const plan=compileGraphicButtonPlan({layers,symbols:project.symbols,duration},stateRouteBudget);
    const authored=captureAuthoredStateLeaves(plan,{
      root:layer=>allowed.has(layer),
      container:shape=>!library.get(shape.symbolId!)?.timeline?.layerMasks?.length,
    });
    if(authored.size)for(const frame of new Set([up,over,down])){
      const poses=sampleGraphicButtonPlan(plan,frame,stateRouteBudget);
      const counts=new Map<string,number>();
      const path=(track:string,id:string)=>(track==='@base'?'':track+'/')+id;
      for(const {layerId,shape} of poses){
        const id=path(layerId,shape.id);
        counts.set(id,(counts.get(id)??0)+1);
      }
      const routes=poses.flatMap(({shape,button,layerId,exposures}):StateButtonRoute[]=>{
        if(!shape.symbolId||counts.get(path(layerId,shape.id))!==1||!authored.has(authoredRouteKey(
          layerId,shape.id,shape.symbolId,exposures.map(entry=>[entry.path,entry.start]))))return [];
        const child=library.get(shape.symbolId);
        if(!child||(button?!definitions.has(child.id)&&!stateButtons(child.id).size:
          !!child.timeline?.layerMasks?.length||!hasMovieButton(child,true)))return [];
        return [{track:layerId,shape,exposures:exposures.map(entry=>[entry.path,entry.start,entry.end])}];
      });
      if(routes.length)mapped.set(frame,routes);
    }
    resolvingStates.delete(id);
    stateButtonRoutes.set(id,mapped);
    return mapped;
  }
  const artworkDefinitions=new Map<string,boolean>();
  function hasStateArtwork(id:string){
    const cached=artworkDefinitions.get(id);
    if(cached!==undefined)return cached;
    const frames=library.get(id)?.buttonStates,definition=frames&&graphicChildren?.exposures(id);
    const found=stateButtons(id).size>0||!!frames&&!!definition&&[frames.up,frames.over,frames.down].some(frame=>
      definition.tracks.some(track=>!!atBoundary(track.keys,frame,key=>key.frame)?.items.length));
    artworkDefinitions.set(id,found);
    return found;
  }
  const admitsButton=(id:string)=>definitions.has(id)||hasStateArtwork(id);
  const canRouteButton=new Map<string,boolean>();
  const routeButtons=options.allowDirectButtons===true&&[...library.values()].some(definition=>definition.buttonStates&&admitsButton(definition.id));
  const captureChildren=routeButtons?nestedButtonOwners(project,project.layers,true):undefined;
  const captureFixedChildren=routeButtons?deepFixedButtonRoutes(project,project.layers,hasStateArtwork):undefined;
  const buttonArtwork=new Map<string,Map<number,ChildBranch>>();
  const childButtons=new Map<string,Map<number,StateButtonChildren>>();
  const moviePlans=new Map<string,ReturnType<typeof compileSymbolPreviewClockPlan>>();
  const stateMovieRoutes=new Map<string,ReturnType<typeof captureAuthoredStateMovies>>();
  type MovieButtonRoute={layerId:string;path:string;symbolId:string;identity:string;start:number;end:number};
  const buttonRoutes=new Map<string,MovieButtonRoute[]>();
  const opacityOwners=new Set(project.opacityBindings?.map(binding=>JSON.stringify([binding.layerId,binding.shapeId])));
  let visibilityOwner:ReturnType<typeof graphicVisibilityOwner>|undefined;
  let captured=0;
  function capture(owner:GraphicOwner,sharesParentClock=false){
    if((!sharesParentClock&&!owner.button&&owner.playback?.mode!=='movie'&&owners.has(owner.key))||++captured>100000)
      throw Error('Nested symbol placement capture exceeds its budget.');
    if(owner.button){
      if(buttonTokens.has(owner.button.token))throw Error('Duplicate nested Button exposure.');
      buttonTokens.set(owner.button.token,owner);
    }
    owners.set(owner.key,owner);
    return owner;
  }
  function captureBranch(layerId:string,symbolId:string,path:string,lineage:readonly string[],exposure:readonly (string|number)[],
    playback:Vector['symbolPlayback'],movieKey?:string,depth=1,independentAncestor=false,stateFrame?:number,stateArtwork=false):ChildBranch|undefined{
    const definition=graphicChildren?.exposures(symbolId);
    if(!definition)return undefined;
    if(depth>=8)throw Error('Nested script symbol depth limit.');
    if(movieKey)movieParents.add(movieKey);
    const independent=independentAncestor||movieKey!==undefined;
    const parentExposure=movieKey?[movieKey]:exposure;
    const tracks=definition.tracks.map(track=>{
      const selected=stateFrame===undefined?undefined:atBoundary(track.keys,stateFrame,key=>key.frame);
      const keys=stateFrame===undefined?track.keys:selected?[selected]:[];
      return keys.map(key=>({
        frame:key.frame,
        items:key.items.map(child=>{
          const shapeId=path+(track.id==='@base'?'':'/'+track.id)+'/'+child.id;
          const route=[...lineage,track.id,child.id,child.symbolId];
          const childExposure=[...parentExposure,track.id,key.frame,child.id,child.symbolId];
          const movie=child.playback?.mode==='movie';
          const identity=JSON.stringify(movie?['child-movie',...route]:['child-graphic',...childExposure]);
          const owner=graphicIds.has(child.symbolId)?capture({key:identity,layerId,shapeId,symbolId:child.symbolId,
            start:key.frame,playback:child.playback,child:true,...(stateArtwork?{stateArtwork:true}:{})},independent):undefined;
          if(owner&&movie&&stateArtwork)movieParents.add(identity);
          if(!owner&&++captured>100000)throw Error('Nested symbol placement capture exceeds its budget.');
          const branch=captureBranch(layerId,child.symbolId,shapeId,route,childExposure,child.playback,movie?identity:undefined,
            depth+1,independent,undefined,stateArtwork);
          return {owner,branch};
        }),
      }));
    }).filter(track=>track.some(key=>key.items.length));
    return tracks.length?{playback,movieKey,duration:definition.duration,tracks}:undefined;
  }
  function captureChildGraphics(layer:Project['layers'][number],key:Project['layers'][number]['keys'][number]){
    if(!graphicChildren)return [];
    return graphicChildren.capture(layer,key).map(parent=>{
      const lineage=[layer.id,parent.id,parent.symbolId];
      const movieKey=parent.playback?.mode==='movie'?JSON.stringify([layer.id,'movie',parent.id,parent.symbolId]):undefined;
      return {start:parent.start,branch:captureBranch(layer.id,parent.symbolId,parent.id,lineage,[key.frame,...lineage],parent.playback,movieKey)!};
    });
  }
  function captureButtonArtwork(layerId:string,path:string,symbolId:string,key:string,frames:ButtonStates){
    const saved=buttonArtwork.get(key);
    if(saved)return saved.size>0;
    const branches=new Map<number,ChildBranch>();
    for(const frame of new Set([frames.up,frames.over,frames.down])){
      const lineage=[key,'button-state',String(frame)];
      const branch=captureBranch(layerId,symbolId,path,lineage,lineage,{mode:'single',firstFrame:frame},
        undefined,1,false,frame,true);
      if(branch)branches.set(frame,branch);
    }
    buttonArtwork.set(key,branches);
    return branches.size>0;
  }
  function captureButton(owner:GraphicOwner,depth=1){
    if(hasStateArtwork(owner.symbolId))captureButtonArtwork(owner.layerId,owner.shapeId,owner.symbolId,owner.key,owner.button!.frames);
    capture(owner);
    const routes=stateButtons(owner.symbolId);
    if(!routes.size)return owner;
    if(depth>=8)throw Error('Nested Button script placement depth limit.');
    const parent=owner.button!.token,children=new Map<number,StateButtonChildren>();
    for(const [frame,items] of routes){
      const owned:StateButtonChildren={buttons:[],movies:[]};
      for(const {track,shape,exposures} of items){
        const id=owner.shapeId+(track==='@base'?'':'/'+track)+'/'+shape.id;
        const symbolId=shape.symbolId!,frames=library.get(symbolId)!.buttonStates;
        if(frames){
          const token=buttonChildToken(parent,frame,track,shape.id,exposures);
          const key=JSON.stringify([owner.key,'state-button',frame,track,shape.id,symbolId,exposures]);
          owned.buttons.push(captureButton({key,layerId:owner.layerId,symbolId,start:frame,shapeId:id,
            button:{frames:{...frames},token,stateChild:true}},depth+1));
        }else{
          const scope=captureMovieScope({...shape,id},owner.layerId,
            JSON.stringify([owner.key,'state-movie',frame,id,symbolId]),{parent,frame,depth,rootId:owner.shapeId});
          if(scope)owned.movies.push(scope);
        }
      }
      if(owned.movies.some(scope=>!!scope.children?.length)){
        const key=JSON.stringify([owner.key,'state-clock',frame]);
        const definition=JSON.stringify(['state',owner.symbolId,frame]);
        if(!moviePlans.has(definition))
          moviePlans.set(definition,compileSymbolPreviewClockPlan(
            library.get(owner.symbolId)!,project.symbols!,fps,frame,frame,stateRouteBudget));
        owned.clock={key,definition};
        movieParents.add(key);
      }
      children.set(frame,owned);
    }
    childButtons.set(parent,children);
    return owner;
  }
  type SymbolDefinition=NonNullable<Project['symbols']>[number];
  function hasMovieButton(definition:SymbolDefinition,nested=false):boolean{
    const key=JSON.stringify([definition.id,nested]);
    const cached=canRouteButton.get(key);
    if(cached!==undefined)return cached;
    canRouteButton.set(key,false);
    const found=symbolLayers(definition).some(track=>track.visible&&track.keys.some(exposure=>exposure.shapes.some(shape=>{
      if(shape.kind!=='symbol'||!shape.instanceName||!shape.symbolId)return false;
      const child=library.get(shape.symbolId);
      return child?.buttonStates?admitsButton(child.id):!!child&&(nested||shape.symbolPlayback?.mode!=='movie')&&
        !child.timeline?.layerMasks?.length&&hasMovieButton(child,nested);
    })));
    canRouteButton.set(key,found);
    return found;
  }
  function routesFor(definition:SymbolDefinition,duration:number){
    let routes=buttonRoutes.get(definition.id);
    if(!routes){
      routes=hasMovieButton(definition)?captureAuthoredButtonRoutes(
        compileGraphicButtonPlan({layers:symbolLayers(definition),symbols:project.symbols,duration}),{
          root:layer=>!layer.includes('/'),
          container:shape=>!library.get(shape.symbolId!)?.timeline?.layerMasks?.length,
          button:shape=>admitsButton(shape.symbolId!),
        },
      ).map(({id,...span})=>({...span,identity:id})):[];
      buttonRoutes.set(definition.id,routes);
    }
    return routes;
  }
  function nestedMoviesFor(definition:SymbolDefinition,duration:number){
    const cached=stateMovieRoutes.get(definition.id);
    if(cached)return cached;
    const layers=symbolLayers(definition);
    const allowed=new Set(layers.filter(layer=>!layer.guideLayer&&!layer.id.includes('/')&&
      !layer.liveMotionSpans?.length&&!layer.motionSpans?.length).map(layer=>layer.id));
    const plan=compileGraphicButtonPlan({layers,symbols:project.symbols,duration},stateRouteBudget);
    const routes=captureAuthoredStateMovies(plan,{
      root:layer=>allowed.has(layer),
      container:shape=>!library.get(shape.symbolId!)?.timeline?.layerMasks?.length,
    },shape=>{
      const child=library.get(shape.symbolId!);
      return !!child&&!child.timeline?.layerMasks?.length&&hasMovieButton(child,true);
    },stateRouteBudget);
    stateMovieRoutes.set(definition.id,routes);
    return routes;
  }
  const movieScopes=new Map<string,MovieButtonScope|undefined>();
  function captureMovieScope(instance:Vector,layerId:string,movieKey:string,
    state?:{parent:string;frame:number;depth:number;rootId:string},movieAncestors:MoviePlacementRoute=[]):MovieButtonScope|undefined{
    if(instance.symbolPlayback?.mode!=='movie'||!instance.symbolId)return undefined;
    const nestedScene=!state&&movieAncestors.length>0,rootId=state?.rootId??movieAncestors[0]?.[0]??instance.id;
    const signature=state?stateMovieButtonSignature(state.parent,state.frame,instance.id,instance.symbolId):
      nestedScene?nestedSceneMovieButtonSignature(layerId,movieAncestors,instance.id,instance.symbolId):JSON.stringify([layerId,instance,undefined]);
    const definition=library.get(instance.symbolId);
    if(!definition||definition.buttonStates||definition.timeline?.layerMasks?.length||!hasMovieButton(definition,true))return undefined;
    const duration=definition.timeline?.duration??1;
    const firstFrame=Math.min(instance.symbolPlayback.firstFrame,duration-1);
    const cacheKey=state||nestedScene?JSON.stringify([signature,instance.symbolId,firstFrame]):signature;
    if(movieScopes.has(cacheKey)){
      const saved=movieScopes.get(cacheKey);
      if(saved&&saved.movieKey!==movieKey)throw Error('Ambiguous sampled Movie Button ancestry.');
      return saved;
    }
    if(movieAncestors.length>=7)throw Error('Nested Movie script depth limit.');
    const items=routesFor(definition,duration).map(span=>{
      const {symbolId}=span,frames=library.get(symbolId)!.buttonStates!;
      const shapeId=instance.id+(span.layerId==='@base'?'':'/'+span.layerId)+'/'+span.path;
      const token=movieButtonExportToken(signature,span);
      const key=state||nestedScene?movieButtonExportToken(movieKey,span):JSON.stringify(['movie-button',token]);
      const previous=buttonTokens.get(token);
      if(previous&&previous.key!==key)throw Error('Ambiguous Movie Button script route.');
      const owner=previous??captureButton({key,layerId,shapeId,symbolId,
        start:span.start,button:{frames:{...frames},token,movie:true,...(state?{stateChild:true}:{})}},
        state?state.depth+1:1);
      return {start:span.start,end:span.end,owner};
    });
    const children=nestedMoviesFor(definition,duration).flatMap(({layerId:track,path,shape,start,end})=>{
      const id=instance.id+(track==='@base'?'':'/'+track)+'/'+path;
      const child=captureMovieScope({...shape,id},layerId,JSON.stringify([movieKey,id,shape.symbolId]),state,
        [...movieAncestors,[instance.id,instance.symbolId!]]);
      return child?[{start,end,scope:child}]:[];
    });
    let clock:PreparedMovieClock|undefined;
    if(!state&&!movieAncestors.length&&children.length){
      const clockDefinition=JSON.stringify(['scene',definition.id,firstFrame]);
      if(!moviePlans.has(clockDefinition))
        moviePlans.set(clockDefinition,compilePlacedMovieClockPlan(definition,project.symbols!,fps,firstFrame,stateRouteBudget));
      clock={key:movieKey,definition:clockDefinition};
    }
    const scope=items.length||children.length?{movieKey,duration,firstFrame,items,
      ...(state||nestedScene?{clockPath:'root/preview'+instance.id.slice(rootId.length)+'/'+instance.symbolId}:{}),
      ...(clock?{clock}:{}),
      ...(children.length?{children}:{})}:undefined;
    if(scope)movieParents.add(movieKey);
    movieScopes.set(cacheKey,scope);
    return scope;
  }
  function captureMovieButtons(layer:Project['layers'][number],key:Project['layers'][number]['keys'][number]){
    if(!captureChildren)return [];
    const prefixes=new Set(key.shapes.filter(shape=>shape.id.includes('/')).map(shape=>shape.id.split('/')[0]));
    return key.shapes.flatMap(instance=>{
      if(instance.kind!=='symbol'||instance.symbolPlayback?.mode!=='movie'||!instance.symbolId||
        !instance.instanceName||instance.id.includes('/')||prefixes.has(instance.id)||
        opacityOwners.has(JSON.stringify([layer.id,instance.id])))return [];
      const scope=captureMovieScope(instance,layer.id,JSON.stringify([layer.id,'movie',instance.id,instance.symbolId]));
      return scope?[scope]:[];
    });
  }
  const tracks=project.layers.filter(layer=>layer.visible&&!layer.guideLayer&&!excluded.has(layer.id)&&
    !layer.liveMotionSpans?.length&&!layer.motionSpans?.length).map(layer=>layer.keys.map(key=>({
      frame:key.frame,
      children:captureChildGraphics(layer,key),
      movieButtons:captureMovieButtons(layer,key),
      items:[...key.shapes.flatMap((shape):GraphicOwner[]=>{
        if(shape.kind!=='symbol'||!shape.symbolId)return [];
        const mapping=options.allowDirectButtons===true?library.get(shape.symbolId)?.buttonStates:undefined;
        const movie=!mapping&&shape.symbolPlayback?.mode==='movie';
        // The renderer holds Movie and Button lifetimes across keys that retain
        // layer, placement and definition; Graphic clocks belong to each key.
        const identity=JSON.stringify([layer.id,mapping?'button':movie?'movie':key.frame,shape.id,shape.symbolId]);
        const artwork=!!mapping&&!!shape.instanceName&&!shape.id.includes('/')&&
          !key.shapes.some(candidate=>candidate.id.startsWith(shape.id+'/'))&&hasStateArtwork(shape.symbolId);
        if(!artwork&&!definitions.has(shape.symbolId))return [];
        const owner:GraphicOwner={key:identity,layerId:layer.id,shapeId:shape.id,symbolId:shape.symbolId,start:key.frame,
          ...(shape.symbolPlayback&&!mapping?{playback:{...shape.symbolPlayback}}:{})};
        if(mapping){
          const token=buttonExposureToken(layer.id,key.frame,shape.id,shape.symbolId);
          visibilityOwner??=graphicVisibilityOwner(project,true);
          owner.button={frames:{...mapping},token,visibilityKey:visibilityOwner(layer,key.frame,shape)};
        }
        return [mapping&&artwork?captureButton(owner):capture(owner)];
      }),...(captureChildren?.(layer,key)??[]).flatMap(({placement,token,parentSymbolId,childKey}):GraphicOwner[]=>{
        const mapping=definitions.get(placement.symbolId)?.buttonStates;
        if(!mapping)return [];
        // The flattened id is a renderer address. The original parent and
        // local child key also own state, even when that address is reused.
        const identity=JSON.stringify([layer.id,'child-button',placement.id,placement.symbolId,parentSymbolId,childKey]);
        return [captureButton({key:identity,layerId:layer.id,shapeId:placement.id,symbolId:placement.symbolId,start:key.frame,
          button:{frames:{...mapping},token,visibilityKey:placement.visibilityKey}})];
      }),...(captureFixedChildren?.(layer,key)??[]).flatMap(({id,symbolId,identity,token})=>
        buttonTokens.has(token)?[]:[captureButton({key:JSON.stringify(['deep-fixed-button',identity]),layerId:layer.id,shapeId:id,symbolId,
          start:key.frame,button:{frames:{...library.get(symbolId)!.buttonStates!},token}})])],
    }))).filter(track=>track.some(key=>key.items.length||key.children.length||key.movieButtons.length));
  function captureRoutedMovies(){
    const rows:{frame:number;scopes:MovieButtonScope[]}[]=[];
    if(!animation||!captureChildren||hasInstanceBlur(project)||
      project.symbols?.some(definition=>definition.timeline?.layerMasks?.length))return rows;
    const eligible=project.layers.filter(layer=>layer.visible&&!layer.guideLayer&&!excluded.has(layer.id)&&
      !layer.liveMotionSpans?.length&&!layer.motionSpans?.length);
    const nested=new Map<string,boolean>();
    function containsButtonMovie(symbolId:string):boolean{
      const saved=nested.get(symbolId);
      if(saved!==undefined)return saved;
      nested.set(symbolId,false);
      const definition=library.get(symbolId);
      const found=!!definition&&!definition.buttonStates&&symbolLayers(definition).some(track=>track.visible&&
        track.keys.some(key=>key.shapes.some(shape=>{
          if(shape.kind!=='symbol'||!shape.instanceName||!shape.symbolId)return false;
          const child=library.get(shape.symbolId);
          return shape.symbolPlayback?.mode==='movie'?!!child&&!child.buttonStates&&hasMovieButton(child,true):containsButtonMovie(shape.symbolId);
        })));
      nested.set(symbolId,found);
      return found;
    }
    const root=(layerId:string,shape:Vector)=>shape.kind==='symbol'&&!!shape.symbolId&&!!shape.instanceName&&
      !opacityOwners.has(JSON.stringify([layerId,shape.id]))&&shape.symbolPlayback?.mode!=='movie'&&containsButtonMovie(shape.symbolId);
    if(!eligible.some(layer=>layer.keys.some(key=>key.shapes.some(shape=>root(layer.id,shape)))))return rows;
    const plan=compileGraphicButtonPlan({layers:eligible,symbols:project.symbols,duration:animation.duration});
    const paths=captureAuthoredMovieBoundaries(plan,{
      root:(layer,_,shape)=>root(layer,shape),container:shape=>containsButtonMovie(shape.symbolId!),
    },shape=>!!library.get(shape.symbolId!)&&hasMovieButton(library.get(shape.symbolId!)!,true));
    if(!paths.size)return rows;
    for(const layer of plan.root.layers)for(const key of layer.keys)
      key.nodes=key.nodes.filter(node=>root(layer.id,node.shape));
    const budget={remaining:2000000};
    for(let frame=0;frame<animation.duration;frame++){
      options.signal?.throwIfAborted();
      const scopes:MovieButtonScope[]=[];
      for(const {shape,layerId,exposures} of sampleGraphicButtonPlan(plan,frame,budget)){
        if(shape.symbolPlayback?.mode!=='movie'||!shape.symbolId)continue;
        const lineage=paths.get(authoredRouteKey(layerId,shape.id,shape.symbolId,exposures.map(entry=>[entry.path,entry.start])));
        if(!lineage)continue;
        const scope=captureMovieScope(shape,layerId,JSON.stringify(['child-movie',...lineage]));
        if(scope)scopes.push(scope);
      }
      const previous=rows.at(-1)?.scopes;
      if(!previous||previous.length!==scopes.length||scopes.some((scope,index)=>scope!==previous[index]))
        rows.push({frame,scopes});
    }
    return rows;
  }
  const routedMovies=captureRoutedMovies();
  type AnimatedExposure={start:number;end:number;owner:GraphicOwner};
  const animatedByPath=new Map<string,AnimatedExposure[]>();
  if(options.allowDirectButtons===true&&animation){
    const {duration,buttons}=animation;
    const artwork=deepGraphicButtonSpans(project,project.layers,duration,hasStateArtwork);
    for(const {start,end,placement,token} of [...buttons,...artwork]){
      const mapping=library.get(placement.symbolId)?.buttonStates;
      if(!mapping||buttonTokens.has(token)||!admitsButton(placement.symbolId))continue;
      const {layerId,id:shapeId,symbolId,visibilityKey}=placement;
      const owner=captureButton({key:JSON.stringify(['animated-button',token]),layerId,shapeId,symbolId,start,
        button:{frames:{...mapping},token,visibilityKey}});
      const path=JSON.stringify([layerId,shapeId]);
      const spans=animatedByPath.get(path)??[];
      spans.push({start,end:Math.min(end,duration),owner});
      // The renderer keeps the same span token on both sides of a root wrap.
      if(end>duration)spans.push({start:0,end:end-duration,owner});
      animatedByPath.set(path,spans);
    }
  }
  const animatedTracks=[...animatedByPath.values()];
  for(const spans of animatedTracks){
    spans.sort((a,b)=>a.start-b.start);
    if(spans.some((span,index)=>index>0&&span.start<spans[index-1].end))
      throw Error('Overlapping animated Button exposures.');
  }
  const programs=new Map<string,{program:CompiledScriptProgram;frames:Map<number,string>}>();
  const deadline=Date.now()+(options.timeoutMs??30000);
  let compiledBytes=0,mapBytes=0;
  const encoder=new TextEncoder();
  for(const symbolId of new Set([...owners.values()].map(owner=>owner.symbolId).filter(id=>definitions.has(id)))){
    options.signal?.throwIfAborted();
    const remaining=deadline-Date.now();
    if(remaining<1)throw Error('Nested graphic compilation timed out.');
    const timeline=definitions.get(symbolId)!.timeline!;
    const result=await compileScriptProgram({duration:timeline.duration,fps,seed,frameLabels:timeline.frameLabels},
      timeline.frameScripts!,{signal:options.signal,timeoutMs:remaining});
    if(!result.program)throw Error('Placed symbol '+definitions.get(symbolId)!.name+' has source diagnostics.');
    compiledBytes+=encoder.encode(JSON.stringify(result.program.frames)).byteLength;
    mapBytes+=encoder.encode(JSON.stringify(result.program.maps)).byteLength;
    if(compiledBytes>256*1024||mapBytes>4*1024*1024)throw Error('Nested graphic scripts exceed the compiled program budget.');
    programs.set(symbolId,{program:result.program,frames:new Map(result.program.frames.map(entry=>[entry.frame,entry.source]))});
  }
  const buttonBranches=[...buttonArtwork].filter(([,branches])=>branches.size).map(([key,branches])=>[key,[...branches]]);
  const bytes=new TextEncoder().encode(JSON.stringify([tracks,[...programs].map(([id,value])=>[id,value.program.sourceIdentity]),
    ...(animatedTracks.length?[animatedTracks]:[]),...(routedMovies.length?[routedMovies]:[]),
    ...(buttonBranches.length?[buttonBranches]:[]),
    ...(childButtons.size?[[...childButtons].map(([key,children])=>[key,[...children]])]:[]),
    ...(moviePlans.size?[[...moviePlans]]:[]),...(boundedEngine?[{boundedEngine}]:[])]));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  options.signal?.throwIfAborted();
  const identity=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');

  function copy(value:unknown,tick?:number):NestedGraphicState{
    const {items}=cloneScriptState({items:value});
    if(!Array.isArray(items)||items.length>instanceLimit)throw Error('Invalid nested graphic checkpoint.');
    const seen=new Set<string>();
    return items.map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.key!=='string')
        throw Error('Invalid nested graphic checkpoint.');
      const original=owners.get(item.key),program=original&&programs.get(original.symbolId)?.program;
      const movie=original?.playback?.mode==='movie', origin=item.originTick, visual=item.buttonVisual;
      if(!original||!program||seen.has(item.key)||item.layerId!==original.layerId||item.shapeId!==original.shapeId||
          item.symbolId!==original.symbolId||typeof item.frame!=='number'||!Number.isInteger(item.frame)||
          item.frame<0||item.frame>=program.config.duration||typeof item.randomState!=='number'||
          !Number.isInteger(item.randomState)||item.randomState<0||item.randomState>0xffffffff||
          (movie
            ? typeof origin!=='number'||!Number.isSafeInteger(origin)||origin<0||(tick!==undefined&&origin>tick)
            : origin!==undefined)||
          (original.button
            ? (visual!=='up'&&visual!=='over'&&visual!=='down')||original.button.frames[visual]!==item.frame
            : visual!==undefined))
        throw Error('Invalid nested graphic checkpoint.');
      seen.add(item.key);
      return {key:item.key,layerId:original.layerId,shapeId:original.shapeId,symbolId:original.symbolId,
        frame:item.frame,randomState:item.randomState,state:cloneScriptState(item.state),
        ...(typeof origin==='number'?{originTick:origin}:{}),
        ...(visual==='up'||visual==='over'||visual==='down'?{buttonVisual:visual}:{})};
    });
  }
  function copyMovieParents(value:unknown,tick:number):NestedMovieParents{
    if(!Array.isArray(value)||value.length>movieParents.size)throw Error('Invalid Movie parent checkpoint.');
    const seen=new Set<string>();
    const clocks:NestedMovieParents=[];
    for(let index=0;index<value.length;index++){
      const entry=Object.getOwnPropertyDescriptor(value,index)?.value;
      const key=Array.isArray(entry)&&Object.getOwnPropertyDescriptor(entry,0)?.value;
      const born=Array.isArray(entry)&&Object.getOwnPropertyDescriptor(entry,1)?.value;
      if(typeof key!=='string'||entry.length!==2||!movieParents.has(key)||seen.has(key)||
         typeof born!=='number'||!Number.isSafeInteger(born)||born<0||born>tick)throw Error('Invalid Movie parent checkpoint.');
      seen.add(key);
      clocks.push([key,born]);
    }
    return clocks;
  }
  function at(frame:number,tick=0,parents?:NestedMovieParents,prior?:ReadonlyMap<string,number>){
    const saved=parents?new Map(parents):undefined;
    const origins=parents?new Map<string,number>():undefined;
    const visible:(GraphicOwner&{elapsed?:number})[]=[];
    function origin(key:string,displayed?:ReadonlyMap<string,number>){
      if(!origins)return undefined;
      const born=saved?.get(key)??displayed?.get(key)??((displayed||prior&&!prior.has(key))?tick+1:tick);
      origins.set(key,born);
      return born;
    }
    function walk(branch:ChildBranch,age:number,displayed?:ReadonlyMap<string,number>){
      const {movieKey,duration,playback,tracks}=branch;
      const born=movieKey?origin(movieKey,displayed):undefined;
      if(movieKey&&born===undefined)return;
      const local=symbolLocalFrame(duration,born===undefined?age:Math.max(0,tick-born),playback);
      for(const track of tracks){
        const exposure=atBoundary(track,local,key=>key.frame);
        if(!exposure)continue;
        for(const {owner,branch} of exposure.items){
          const elapsed=local-exposure.frame;
          if(owner){
            if(owner.stateArtwork&&owner.playback?.mode==='movie')origin(owner.key,displayed);
            visible.push({...owner,elapsed});
          }
          if(branch)walk(branch,elapsed,displayed);
        }
      }
    }
    function movieButtons({duration,firstFrame,items,children}:MovieButtonScope,elapsed:number|undefined,
      displayed:GraphicOwner[],frames?:Readonly<Record<string,number>>){
      if(elapsed===undefined)return;
      const local=(firstFrame+elapsed)%duration;
      const active=(start:number,end:number)=>local>=start&&local<end||end>duration&&local<end-duration;
      for(const {start,end,owner} of items)if(active(start,end))displayed.push(owner);
      if(frames)for(const {start,end,scope} of children??[])if(active(start,end))
        movieButtons(scope,frames[scope.clockPath!],displayed,frames);
    }
    const clockSamples=new Map<string,Record<string,number>>();
    function movieClockFrames(clock:PreparedMovieClock,age:number){
      const id=JSON.stringify([clock.definition,age]);
      const existing=clockSamples.get(id);
      if(existing)return existing;
      // Start at the placement pose so crossed keys and loop boundaries
      // establish nested Movie origins before sampling the requested age.
      const runtime=createMovieTreeRuntime(moviePlans.get(clock.definition)!,createMovieClock);
      const initial=runtime.sample(0,0,0);
      const frames=age===0?initial:runtime.sample(0,age/fps,0);
      clockSamples.set(id,frames);
      return frames;
    }
    function sampleMovie(scope:MovieButtonScope){
      const born=origin(scope.movieKey);
      if(born!==undefined){
        const age=Math.max(0,tick-born);
        movieButtons(scope,age,visible,scope.clock?movieClockFrames(scope.clock,age):undefined);
      }
    }
    for(const track of tracks){
      const key=atBoundary(track,frame,key=>key.frame);
      if(!key)continue;
      visible.push(...key.items);
      for(const {start,branch} of key.children)walk(branch,frame-start);
      for(const scope of key.movieButtons)sampleMovie(scope);
    }
    for(const scope of atBoundary(routedMovies,frame,row=>row.frame)?.scopes??[])sampleMovie(scope);
    for(const track of animatedTracks){
      const span=atBoundary(track,frame,span=>span.start);
      if(span&&frame<span.end)visible.push(span.owner);
    }
    function displayedButtons(buttons:ScriptButtonHoverCheckpoint|undefined,hidden?:(owner:GraphicOwner)=>boolean,
      observeMovie?:(key:string)=>number|undefined){
      const displayed=visible.filter(owner=>owner.button&&!hidden?.(owner));
      for(const owner of displayed){
        const visual=buttonVisual(owner,buttons);
        if(!visual||!owner.button)continue;
        const children=childButtons.get(owner.button.token)?.get(owner.button.frames[visual]);
        if(children){
          displayed.push(...children.buttons);
          if(children.clock){
            const {clock}=children;
            const born=observeMovie?observeMovie(clock.key):saved?.get(clock.key)??tick;
            if(born!==undefined){
              const frames=movieClockFrames(clock,Math.max(0,tick-born));
              for(const scope of children.movies)movieButtons(scope,frames[scope.clockPath!],displayed,frames);
            }
          }else for(const scope of children.movies){
            const born=observeMovie?observeMovie(scope.movieKey):saved?.get(scope.movieKey)??tick;
            if(born!==undefined)movieButtons(scope,Math.max(0,tick-born),displayed);
          }
        }
        if(displayed.length>instanceLimit)throw Error('Too many active placed symbol scripts.');
      }
      return displayed;
    }
    function appendButtonArtwork(buttons:ScriptButtonHoverCheckpoint|undefined,displayed?:ReadonlyMap<string,number>,
      hidden?:(owner:GraphicOwner)=>boolean){
      if(!buttonBranches.length&&!childButtons.size)return;
      for(const owner of displayedButtons(buttons,hidden,key=>origin(key,displayed))){
        if(owner.button?.stateChild)visible.push(owner);
        const visual=buttonVisual(owner,buttons);
        if(!visual||!owner.button)continue;
        const branch=buttonArtwork.get(owner.key)?.get(owner.button.frames[visual]);
        if(branch)walk(branch,0,displayed);
      }
    }
    return {visible,origins,displayedButtons,appendButtonArtwork};
  }
  function buttonOwner(target:ScriptButtonTarget|null|undefined){
    if(!target)return undefined;
    const owner=buttonTokens.get(target.token);
    return owner&&owner.shapeId===target.instanceId&&owner.symbolId===target.symbolId?owner:undefined;
  }
  function buttonVisual(owner:GraphicOwner,buttons?:ScriptButtonHoverCheckpoint):ButtonVisual|undefined{
    if(!owner.button)return undefined;
    const hover=buttons?.hover?.target,press=buttons?.press.pressed?.target;
    if(buttonOwner(hover)?.key!==owner.key)return 'up';
    return buttonOwner(press)?.key===owner.key&&press?.lifetime===hover?.lifetime?'down':'over';
  }
  function retire(buttons:ScriptButtonHoverCheckpoint,active:ReadonlySet<string>,hidden:(owner:GraphicOwner)=>boolean,
    includeDynamic=true){
    const absent=(target:ScriptButtonTarget|undefined)=>{
      const owner=buttonOwner(target);
      return !!owner&&(includeDynamic||!owner.button?.movie&&!owner.button?.stateChild)&&
        (!active.has(owner.key)||hidden(owner));
    };
    const pressed=buttons.press.pressed,hover=buttons.hover;
    const cancel=absent(pressed?.target),leave=absent(hover?.target);
    return cancel||leave?{
      version:1 as const,press:{version:1 as const,pressed:cancel?null:pressed},hover:leave?null:hover,
    }:buttons;
  }
  function hiddenByState(state?:ScriptState){
    const hidden=new Set(hiddenPlacementKeys(state?.[hiddenPlacementsKey]));
    return (owner:GraphicOwner)=>!!owner.button?.visibilityKey&&hidden.has(owner.button.visibilityKey);
  }
  return Object.freeze({identity,boundedEngine,copy,copyMovieParents,hasMovieParents:movieParents.size>0,hasButtons:buttonTokens.size>0,
    hasChildren:tracks.some(track=>track.some(key=>key.children.length)),
    retireButtonTargets(buttons:ScriptButtonHoverCheckpoint,frame:number,hiddenTokens:readonly string[]){
      if(!buttonTokens.size||(!buttons.press.pressed&&!buttons.hover))return buttons;
      const tokens=new Set(hiddenTokens);
      const hidden=(owner:GraphicOwner)=>!!owner.button&&tokens.has(owner.button.token);
      const active=new Set(at(frame).visible.filter(owner=>owner.button&&!hidden(owner)).map(owner=>owner.key));
      return retire(buttons,active,hidden,false);
    },
    finishPresentation(items:NestedGraphicState,buttons:ScriptButtonHoverCheckpoint|undefined,frame:number,state:ScriptState,
      tick:number,parents?:NestedMovieParents,previousButtons?:ScriptButtonHoverCheckpoint,pointer?:ScriptButtonHoverInput){
      const {origins,visible,appendButtonArtwork}=at(frame,tick,parents);
      const hidden=buttons?hiddenByState(state):undefined;
      appendButtonArtwork(buttons,undefined,hidden);
      const active=new Set(visible.filter(owner=>!hidden?.(owner)).map(owner=>owner.key));
      const retiredMovieButtons=new Set<string>();
      for(const target of [previousButtons?.press.pressed?.target,previousButtons?.hover?.target,
        buttons?.press.pressed?.target,buttons?.hover?.target,pointer?.target]){
        const owner=buttonOwner(target);
        if((owner?.button?.movie||owner?.button?.stateChild)&&!active.has(owner.key))retiredMovieButtons.add(owner.button.token);
      }
      return {
        nestedGraphics:items.filter(item=>active.has(item.key)||(!item.buttonVisual&&!owners.get(item.key)?.child)),
        ...(buttons&&hidden?{nestedButtons:retire(buttons,active,hidden)}:{}),
        ...(origins?{nestedMovieParents:[...origins]}:{}),
        ...(retiredMovieButtons.size?{retiredMovieButtons:[...retiredMovieButtons]}:{}),
      };
    },
    async advance(previous:NestedGraphicState,frame:number,tick:number,signal?:AbortSignal,timeoutMs?:number,admit?:()=>void,
      buttons?:ScriptButtonHoverCheckpoint,pointer?:ScriptButtonHoverInput,rootState?:ScriptState,previousFrame?:number,parents?:NestedMovieParents){
      const old=new Map(previous.map(item=>[item.key,item])),next:NestedGraphicState=[];
      const hidden=buttons?hiddenByState(rootState):undefined;
      const seeking=previousFrame!==undefined&&previousFrame!==frame;
      const prior=seeking||buttonBranches.length||childButtons.size?at(previousFrame??frame,tick,parents):undefined;
      prior?.appendButtonArtwork(buttons,undefined,hidden);
      const {origins,visible:all,displayedButtons,appendButtonArtwork}=at(frame,tick,parents,seeking?prior?.origins:undefined);
      let activation:ScriptButtonTarget|null=null;
      if(buttons&&hidden){
        const activeButtons=displayedButtons(buttons,hidden);
        buttons=retire(buttons,new Set(activeButtons.map(owner=>owner.key)),hidden);
        if(pointer){
          // A previously accepted pointer may carry its old key token, but a
          // newly delivered hit must belong to the currently visible key.
          const hit=pointer.target;
          const currentHit=hit&&buttonTokens.has(hit.token)
            ? activeButtons.some(owner=>owner.button?.token===hit.token&&buttonOwner(hit)?.key===owner.key)
            : true;
          const held=buttonOwner(buttons.press.pressed?.target);
          const step=advanceScriptButtonHover(buttons,currentHit?pointer:{...pointer,target:null});
          if(held&&buttonOwner(step.activation)?.key===held.key)activation=step.activation;
          buttons=step.checkpoint;
        }
      }
      appendButtonArtwork(buttons,prior?.origins,hidden);
      const visible=hidden?all.filter(owner=>!hidden(owner)):all;
      if(visible.length>instanceLimit)throw Error('Too many active placed symbol scripts.');
      let previousVisible:Set<string>|undefined;
      for(const owner of visible){
        signal?.throwIfAborted();
        admit?.();
        const compiled=programs.get(owner.symbolId);
        if(!compiled)continue;
        const {program,frames}=compiled;
        const saved=old.get(owner.key);
        const movie=owner.playback?.mode==='movie';
        let origin=movie ? origins?.get(owner.key)??saved?.originTick??tick : undefined;
        if(movie&&owner.child&&!owner.stateArtwork&&!saved&&seeking){
          previousVisible??=new Set(prior?.visible.map(owner=>owner.key));
          // An explicit host seek first displays its destination on the next
          // presentation pose. The entry body still runs at its first frame.
          if(!previousVisible.has(owner.key))origin=tick+1;
        }
        const matches=(target?:ScriptButtonTarget|null)=>owner.button&&buttonOwner(target)?.key===owner.key;
        const visual=buttonVisual(owner,buttons);
        const activated=matches(activation)?activation:null;
        const local=owner.button&&visual?owner.button.frames[visual]:
          symbolLocalFrame(program.config.duration,origin===undefined?owner.elapsed??frame-owner.start:Math.max(0,tick-origin),owner.playback);
        if(saved?.frame===local&&saved.buttonVisual===visual&&!activated){next.push(saved);continue;}
        const {key,layerId,shapeId,symbolId}=owner;
        let ownedSeed=seed;
        for(let i=0;i<key.length;i++)ownedSeed=Math.imul(ownedSeed^key.charCodeAt(i),16777619)>>>0;
        const entry={key,layerId,shapeId,symbolId,frame:local,randomState:saved?.randomState??ownedSeed,state:saved?.state??{},
          ...(origin===undefined?{}:{originTick:origin}),...(visual?{buttonVisual:visual}:{})};
        const body=frames.get(local);
        if(body!==undefined){
          try{
            const result=await executeIsolatedFrameWithState(body,{
              ...program.config,version:1,seed:ownedSeed,frame:local,playing:false,tick,randomState:entry.randomState,
            },entry.state,{signal,timeoutMs,...(boundedEngine?{boundedEngine}:{}),...(visual?{input:cloneScriptState({buttonActivation:activated})}:{})});
            entry.state=result.state;entry.randomState=result.timeline.randomState;
          }catch(error){
            signal?.throwIfAborted();
            throw Error((visual?'Button ':movie?'Movie ':'Graphic ')+shapeId+', local frame '+(local+1)+': '+(error instanceof Error?error.message:String(error)));
          }
          admit?.();
        }
        next.push(entry);
      }
      return {nestedGraphics:copy(next,tick+1),...(buttons?{nestedButtons:buttons}:{}),
        ...(origins?{nestedMovieParents:[...origins]}:{})};
    },
  });
}

export type NestedGraphics=Awaited<ReturnType<typeof prepareNestedGraphics>>;

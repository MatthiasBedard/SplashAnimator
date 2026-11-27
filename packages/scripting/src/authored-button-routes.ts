import {compileGraphicButtonLifetimes,type GraphicButtonPlan} from '../../animation/src/graphic-button-plan';
import type {Vector} from '../../document/src';
import {MAX_HTML_COMPILED_SHAPES} from '../../export-web/src/live-timeline';

type Exposure=[path:string,frame:number];
type ContainerAdmission={
  root:(layerId:string,frame:number,shape:Vector)=>boolean;
  container:(shape:Vector)=>boolean;
};
type Node=GraphicButtonPlan['root']['layers'][number]['keys'][number]['nodes'][number];
export const authoredRouteKey=(layer:string,path:string,symbol:string,chain:Exposure[])=>JSON.stringify([layer,path,symbol,chain]);

function captureNamedRoutes(plan:GraphicButtonPlan,admit:ContainerAdmission,leaf:(node:Node,depth:number)=>boolean,
  onLeaf?:(key:string,shape:Vector)=>void){
  const candidates=new Map<string,string[]>();
  let work=0;
  function visit(node:Node,layer:string,path:string,chain:Exposure[],lineage:string[],rootId:string,rootIds:Set<string>){
    if(++work>MAX_HTML_COMPILED_SHAPES)throw Error('Authored symbol route capture exceeds the presentation budget.');
    const shape=node.shape;
    if(shape.kind!=='symbol'||!shape.symbolId||!shape.instanceName||!shape.id||shape.id.includes('/'))return;
    if(path!==rootId){
      if(rootIds.has(path))return;
      for(let index=path.indexOf('/',rootId.length+1);index>=0;index=path.indexOf('/',index+1))
        if(rootIds.has(path.slice(0,index)))return;
    }
    if(node.definition===undefined){
      if(leaf(node,chain.length)){
        const key=authoredRouteKey(layer,path,shape.symbolId,chain);
        candidates.set(key,lineage);
        onLeaf?.(key,shape);
      }
      return;
    }
    if(!admit.container(shape))return;
    for(const track of plan.definitions[node.definition].layers){
      if(track.id.includes('/'))continue;
      const prefix=path+(track.id==='@base'?'':'/'+track.id);
      for(const exposure of track.keys){
        const childChain:Exposure[]=[...chain,[path+'/'+track.id,exposure.frame]];
        for(const child of exposure.nodes)visit(child,layer,prefix+'/'+child.shape.id,childChain,
          [...lineage,track.id,child.shape.id,child.shape.symbolId??''],rootId,rootIds);
      }
    }
  }
  for(const layer of plan.root.layers){
    for(const key of layer.keys){
      const rootIds=new Set(key.nodes.map(node=>node.shape.id));
      for(const node of key.nodes)if(admit.root(layer.id,key.frame,node.shape))
        visit(node,layer.id,node.shape.id,[['/'+layer.id,key.frame]],[layer.id,node.shape.id,node.shape.symbolId??''],node.shape.id,rootIds);
    }
  }
  return candidates;
}

export function captureAuthoredMovieBoundaries(plan:GraphicButtonPlan,admit:ContainerAdmission,movie:(shape:Vector)=>boolean){
  return captureNamedRoutes(plan,admit,(node,depth)=>depth>1&&!node.button&&node.shape.symbolPlayback?.mode==='movie'&&movie(node.shape));
}

/** Exact named leaves for a fixed Button state, with Movie clocks kept as leaves. */
export function captureAuthoredStateLeaves(plan:GraphicButtonPlan,admit:ContainerAdmission){
  return captureNamedRoutes(plan,admit,node=>node.button||node.shape.symbolPlayback?.mode==='movie');
}

export function captureAuthoredStateMovies(plan:GraphicButtonPlan,admit:ContainerAdmission,movie:(shape:Vector)=>boolean,
  budget:{remaining:number}){
  const candidates=new Map<string,Vector>();
  const isMovie=(node:Node)=>!node.button&&node.shape.symbolPlayback?.mode==='movie';
  captureNamedRoutes(plan,admit,node=>isMovie(node)&&movie(node.shape),(key,shape)=>candidates.set(key,shape));
  if(!candidates.size)return [];
  const paths=new Map<string,string>(),ambiguous=new Set<string>();
  const sampled=compileGraphicButtonLifetimes(plan,pose=>!pose.button&&pose.shape.symbolPlayback?.mode==='movie',budget)
    .map(span=>{
      const [layer,path,symbol,chain]=JSON.parse(span.id) as [string,string,string,[string,number,number][]];
      const address=(layer==='@base'?'':layer+'/')+path;
      const lineage=JSON.stringify([layer,path,chain.map(([name])=>name)]);
      const previous=paths.get(address);
      if(previous!==undefined&&previous!==lineage)ambiguous.add(address);
      paths.set(address,lineage);
      const shape=candidates.get(authoredRouteKey(layer,path,symbol,chain.map(([name,frame])=>[name,frame])));
      return {span,address,shape};
    });
  return sampled.flatMap(({span,address,shape})=>shape&&!ambiguous.has(address)?[{...span,shape}]:[]);
}

/** Match compiled renderer spans back to named authored placements by the full exposure chain. */
export function captureAuthoredButtonRoutes(plan:GraphicButtonPlan,admit:ContainerAdmission&{button:(shape:Vector,depth:number)=>boolean}){
  const candidates=captureNamedRoutes(plan,admit,(node,depth)=>node.button&&admit.button(node.shape,depth));
  if(!candidates.size)return [];
  const matching=compileGraphicButtonLifetimes(plan).map(span=>{
    const [layer,path,symbolId,chain]=JSON.parse(span.id) as [string,string,string,[string,number,number][]];
    return {span,symbolId,route:authoredRouteKey(layer,path,symbolId,chain.map(([name,frame])=>[name,frame])),
      lineage:JSON.stringify(chain.map(([name])=>name))};
  });
  const lineages=new Map<string,string>();
  const ambiguous=new Set<string>();
  for(const {span,lineage} of matching){
    const path=JSON.stringify([span.layerId,span.path]);
    const prior=lineages.get(path);
    if(prior!==undefined&&prior!==lineage)ambiguous.add(path);
    lineages.set(path,lineage);
  }
  return matching.flatMap(({span,symbolId,route})=>
    !ambiguous.has(JSON.stringify([span.layerId,span.path]))&&candidates.has(route)
      ? [{...span,symbolId}]:[]);
}

import {afterEach,expect,it,vi} from 'vitest';
import {newProject,symbolLayers,symbolArtworks,MAX_SYMBOL_ARTWORK,type Vector,type Point,type SymbolDefinition} from '../packages/document/src';
import {createBasicMotionSpan,refreshBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {rotateRememberedEndpoint,rotateSymbolRememberedEndpoint} from '../packages/animation/src/motion-junction';

afterEach(()=>vi.restoreAllMocks());
function fixture(mode='plain'){
 const p=newProject();p.duration=14;
 const ink=(id:string,x:number,y:number):Vector=>({id,kind:'rectangle',x,y,width:12,height:9,rotation:0,fill:'#e02030',stroke:'#111111',strokeWidth:0,points:[],...(id==='other'?{}:{groups:['outer',...(id==='a'?['inner']:[])]})});
 p.layers=['base','extra'].map((id,i)=>({id,name:id,visible:true,locked:false,drawingMode:'object',keys:[...new Set([0,i?1:0,4,i?10:8,12])].map(frame=>({frame,shapes:frame===12?[]:[ink('a',10+frame*7,i?120:20),ink('b',40+frame*7,i?140:50),ink('other',150,i?160:70)]}))}));
 for(const layer of p.layers){for(const key of layer.keys)for(const s of key.shapes){
  if(mode==='saved')s.pivot={x:-3,y:17};
  if(mode==='rotated'||mode==='affine'||mode==='reflected')s.rotation=23;
  if(mode==='affine'||mode==='reflected')s.transform=[mode==='reflected'?-1.3:1.3,.2,.4,.8];
  if(mode==='compound'||mode==='aligned'){s.kind='polygon';s.closed=true;s.fillRule='evenodd';s.contours=[[[0,0],[12,0],[12,9],[0,9]],[[3,3],[3,5],[5,3]]].map(r=>r.map(([x,y])=>({x,y})));}
 }
 const i=layer.id==='extra'?1:0,rotation={direction:'shortest' as const,turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true};
 if(mode==='aligned')for(const key of layer.keys)if(key.frame>=4)for(const s of key.shapes)s.contours=[...s.contours!].reverse().map(r=>[r[1],r[0],...r.slice(2).reverse()]);
 createBasicMotionSpan(p,[layer.id],i?1:0,4,'in',{affine:true,...(mode==='aligned'?{nodes:true}:{})},undefined,mode==='aligned'?undefined:rotation,mode==='aligned'?{order:[1,0],start:[1,1],reverse:[true,true]}:undefined);
 createBasicMotionSpan(p,[layer.id],4,i?10:8,'out',{affine:true,...(mode==='aligned'?{nodes:true}:{})},undefined,mode==='aligned'?undefined:rotation);
 }
 return p;
}
const picks=[{layerId:'base',shapeIds:['a','b']},{layerId:'extra',shapeIds:['a','b']}];
const pivot={x:-31,y:83};
function world(s:Vector,p:Point){const r=s.rotation*Math.PI/180,c=Math.cos(r),n=Math.sin(r),[a,b,u,d]=s.transform??[1,0,0,1];return{x:s.x+c*(a*p.x+u*p.y)-n*(b*p.x+d*p.y),y:s.y+n*(a*p.x+u*p.y)+c*(b*p.x+d*p.y)};}
function rotated(p:Point,center:Point,degrees:number){const r=degrees*Math.PI/180,c=Math.cos(r),n=Math.sin(r),x=p.x-center.x,y=p.y-center.y;return{x:center.x+c*x-n*y,y:center.y+n*x+c*y};}
function metadata(s:Vector){return Object.fromEntries(Object.entries(s).filter(([key])=>!['x','y','rotation'].includes(key)));}
function settings(spans:NonNullable<ReturnType<typeof fixture>['layers'][number]['motionSpans']>){return spans.map(({baseline:_baseline,...s})=>s);}
for(const mode of ['plain','saved','rotated','affine','reflected','compound','aligned'])for(const degrees of [37,-90,450])
it('uses one explicit world pivot across different track spans: '+mode+' '+degrees,()=>{
 const p=fixture(mode),before=structuredClone(p),outer=p.layers.map(l=>l.keys.filter(k=>k.frame<= (l.id==='extra'?1:0)||k.frame>=(l.id==='extra'?10:8))),siblings=p.layers.map(l=>l.keys.find(k=>k.frame===4)!.shapes[2]);
 rotateRememberedEndpoint(p,4,picks,degrees,pivot);
 for(let i=0;i<p.layers.length;i++){const l=p.layers[i],old=before.layers[i];
  expect(settings(l.motionSpans!)).toEqual(settings(old.motionSpans!));
  for(const key of outer[i])expect(l.keys.find(k=>k.frame===key.frame)).toBe(key);
  expect(l.keys.find(k=>k.frame===4)!.shapes[2]).toBe(siblings[i]);
  for(let j=0;j<2;j++){const s=l.keys.find(k=>k.frame===4)!.shapes[j],original=old.keys.find(k=>k.frame===4)!.shapes[j];expect(metadata(s)).toEqual(metadata(original));expect(s.rotation).toBe(original.rotation+degrees);
   for(const point of [{x:0,y:0},{x:7,y:3},...(original.contours??[]).flat()]){const actual=world(s,point),expected=rotated(world(original,point),pivot,degrees);expect(actual.x).toBeCloseTo(expected.x,9);expect(actual.y).toBeCloseTo(expected.y,9);}
  }
 }
 const reopened=JSON.parse(JSON.stringify(p));for(const l of reopened.layers)for(const span of [...l.motionSpans])refreshBasicMotionSpan(reopened,[l.id],span.start,span.end);expect(reopened).toEqual(p);expect(p.duration).toBe(before.duration);
});
for(const mode of ['plain','saved','rotated','affine','reflected','compound','aligned'])it('keeps omitted and explicit undefined legacy results exact: '+mode,()=>{
 const omitted=fixture(mode),missing=structuredClone(omitted);rotateRememberedEndpoint(omitted,4,picks,37);rotateRememberedEndpoint(missing,4,picks,37,undefined);expect(missing).toEqual(omitted);
 const shared=fixture(mode);rotateRememberedEndpoint(shared,4,picks,37,pivot);expect(shared.layers[0].keys).not.toEqual(omitted.layers[0].keys);
});
for(const origin of [0,10000,-10000])it('retains small local geometry at admitted translated origins '+origin,()=>{
 const p=fixture('compound');for(const l of p.layers){const keys=l.keys.filter(k=>(l.id==='extra'?[0,1,4,10,12]:[0,4,8,12]).includes(k.frame));l.keys=keys;delete l.motionSpans;
 for(const k of l.keys)for(const s of k.shapes){s.x=origin+s.x*.001;s.y=origin+s.y*.001;s.contours=s.contours!.map(r=>r.map(n=>({x:n.x*1e-6,y:n.y*1e-6})));s.width*=1e-6;s.height*=1e-6;}
 const extra=l.id==='extra';createBasicMotionSpan(p,[l.id],extra?1:0,4,'linear',{affine:true});createBasicMotionSpan(p,[l.id],4,extra?10:8,'linear',{affine:true});}
 const before=structuredClone(p),center={x:origin-.01,y:origin+.02};rotateRememberedEndpoint(p,4,picks,37,center);
 for(let i=0;i<2;i++)for(let j=0;j<2;j++){const original=before.layers[i].keys.find(k=>k.frame===4)!.shapes[j],s=p.layers[i].keys.find(k=>k.frame===4)!.shapes[j];expect(s.contours).toEqual(original.contours);const expected=rotated(world(original,{x:0,y:0}),center,37),actual=world(s,{x:0,y:0});expect(actual.x).toBeCloseTo(expected.x,9);expect(actual.y).toBeCloseTo(expected.y,9);}
});
for(const degrees of [NaN,Infinity,-Infinity,0,360,-720,Number.MIN_VALUE,Number.MAX_VALUE])it('rejects invalid/unrepresentable explicit angles '+degrees,()=>{const p=fixture(),before=structuredClone(p);expect(()=>rotateRememberedEndpoint(p,4,picks,degrees,pivot)).toThrow();expect(p).toEqual(before);});
for(const center of [null,{}, {x:NaN,y:0},{x:0,y:Infinity},{x:'0',y:0},{x:new Number(0),y:0}])it('rejects malformed original explicit pivots '+JSON.stringify(center),()=>{const p=fixture(),before=structuredClone(p);expect(()=>rotateRememberedEndpoint(p,4,picks,37,center as Point)).toThrow();expect(p).toEqual(before);});
for(const reason of ['missing','duplicate','locked','hidden','merge','stale-left','stale-right','overflow','original','frozen'])it('rejects a later track atomically: '+reason,()=>{
 const p=fixture(),l=p.layers[1],input=structuredClone(picks);let center=pivot;
 if(reason==='missing')input[1].shapeIds=['absent'];if(reason==='duplicate')input[1].shapeIds=['a','a'];if(reason==='locked')l.locked=true;if(reason==='hidden')l.visible=false;if(reason==='merge')l.drawingMode='merge';
 if(reason==='stale-left'||reason==='stale-right')l.keys.find(k=>k.frame===(reason==='stale-left'?2:7))!.shapes[0].x++;
 if(reason==='overflow')center={x:1e308,y:1e308};if(reason==='original')l.keys.find(k=>k.frame===4)!.shapes[2].pivot={x:NaN,y:0};if(reason==='frozen')Object.freeze(l);
 const before=structuredClone(p),keys=p.layers.map(l=>l.keys),spans=p.layers.map(l=>l.motionSpans);expect(()=>rotateRememberedEndpoint(p,4,input,37,center)).toThrow();expect(p).toEqual(before);p.layers.forEach((l,i)=>{expect(l.keys).toBe(keys[i]);expect(l.motionSpans).toBe(spans[i]);});
});
it('snapshots raw pivot/request identities once',()=>{
 const p=fixture(),reads={x:0,y:0,layer:0,ids:0,id:0};const request={get layerId(){reads.layer++;return 'base';},get shapeIds(){reads.ids++;return [{toString(){throw Error('coercion');}}] as never;}};
 expect(()=>rotateRememberedEndpoint(p,4,[request],37,pivot)).toThrow();
 const ids=['a','b'];Object.defineProperty(ids,0,{get(){reads.id++;return 'a';}});reads.ids=reads.layer=0;
 rotateRememberedEndpoint(p,4,[{get layerId(){reads.layer++;return 'base';},get shapeIds(){reads.ids++;return ids;}}],37,{get x(){reads.x++;return pivot.x;},get y(){reads.y++;return pivot.y;}});expect(reads).toEqual({x:1,y:1,layer:1,ids:1,id:1});
});
for(const event of ['pivot','request','clone','reentry'])it('rejects original source changes/reentry around '+event,()=>{
 const p=fixture(),before=structuredClone(p);let seen=false,input=picks,center:Point=pivot;
 if(event==='pivot')center={get x(){seen=true;p.layers[1].name='External edit';return pivot.x;},y:pivot.y};
 if(event==='request')input=[{get layerId(){seen=true;p.layers[1].name='External edit';return 'base';},shapeIds:['a']}];
 if(event==='clone'){const clone=structuredClone;vi.spyOn(globalThis,'structuredClone').mockImplementation(((v:unknown)=>{const out=clone(v);if(Array.isArray(v)&&v[0]?.id==='a'){seen=true;p.layers[1].name='External edit';}return out;})as typeof structuredClone);}
 if(event==='reentry')center={get x(){seen=true;try{rotateRememberedEndpoint(p,4,picks,30);}catch{}return pivot.x;},y:pivot.y};
 expect(()=>rotateRememberedEndpoint(p,4,input,37,center)).toThrow();expect(seen).toBe(true);if(event!=='reentry')before.layers[1].name='External edit';expect(p).toEqual(before);vi.restoreAllMocks();rotateRememberedEndpoint(p,4,picks,37,pivot);
});
function symbolFixture(mode='plain'){
 const p=fixture(mode),base=p.layers[0],definition:SymbolDefinition={id:'symbol',name:'Shared rotation',width:400,height:300,buttonStates:{up:0,over:4,down:8,hit:12},multiFramePivot:{x:-20,y:30},shapes:base.keys[0].shapes,timeline:{duration:p.duration,keys:base.keys.slice(1),motionSpans:base.motionSpans,layers:[p.layers[1]]}};
 return {definition,library:[definition],selection:[{layerId:'@base',shapeIds:['a','b']},picks[1]]};
}
for(const mode of ['plain','saved','affine','reflected','compound','aligned'])it('forwards explicit shared pivots through detached symbol/library preparation '+mode,()=>{
 const {definition,library,selection}=symbolFixture(mode),before=structuredClone({definition,library});const out=rotateSymbolRememberedEndpoint(definition,library,4,selection,37,pivot);
 for(let i=0;i<2;i++)for(let j=0;j<2;j++){const original=symbolLayers(definition)[i].keys.find(k=>k.frame===4)!.shapes[j],s=symbolLayers(out)[i].keys.find(k=>k.frame===4)!.shapes[j],expected=rotated(world(original,{x:7,y:3}),pivot,37),actual=world(s,{x:7,y:3});expect(actual.x).toBeCloseTo(expected.x,9);expect(actual.y).toBeCloseTo(expected.y,9);expect(metadata(s)).toEqual(metadata(original));}
 expect(out.buttonStates).toEqual(definition.buttonStates);expect(out.multiFramePivot).toEqual(definition.multiFramePivot);expect(out.width).toBe(400);expect(out.height).toBe(300);expect(out.timeline!.duration).toBe(14);out.shapes[0].x=999;expect({definition,library}).toEqual(before);
 const a=rotateSymbolRememberedEndpoint(definition,library,4,selection,37),b=rotateSymbolRememberedEndpoint(definition,library,4,selection,37,undefined);expect(b).toEqual(a);
});
for(const event of ['pivot','request','clone','library','reentry'])it('retains isolated original source admission around '+event,()=>{
 const {definition,library,selection}=symbolFixture(),before=structuredClone(definition);let seen=false,center:Point=pivot,input=selection;
 const change=()=>{seen=true;definition.name='External edit';};
 if(event==='pivot')center={get x(){change();return pivot.x;},y:pivot.y};
 if(event==='request')input=[{get layerId(){change();return '@base';},shapeIds:['a']}];
 if(event==='library')center={get x(){seen=true;library.push({id:'new',name:'New',width:1,height:1,shapes:[]});return pivot.x;},y:pivot.y};
 if(event==='clone'){const clone=structuredClone;vi.spyOn(globalThis,'structuredClone').mockImplementation(((v:unknown)=>{const out=clone(v);if((v as SymbolDefinition)?.id==='symbol'){change();}return out;})as typeof structuredClone);}
 if(event==='reentry')center={get x(){seen=true;try{rotateSymbolRememberedEndpoint(definition,library,4,selection,30);}catch{}return pivot.x;},y:pivot.y};
 expect(()=>rotateSymbolRememberedEndpoint(definition,library,4,input,37,center)).toThrow();expect(seen).toBe(true);if(event!=='library'&&event!=='reentry')before.name='External edit';expect(definition).toEqual(before);vi.restoreAllMocks();expect(()=>rotateSymbolRememberedEndpoint(definition,library,4,selection,37,pivot)).not.toThrow();
});
it('admits exact aggregate capacity and rejects original overflow without dropping artwork',()=>{
 const {definition,selection}=symbolFixture(),own=symbolArtworks(definition).reduce((n,s)=>n+s.length,0),other={id:'other',name:'Other',width:1,height:1,shapes:Array(MAX_SYMBOL_ARTWORK-own).fill(definition.shapes[0])},library=[definition,other];
 expect(rotateSymbolRememberedEndpoint(definition,library,4,selection,37,pivot).timeline!.keys.find(k=>k.frame===4)!.shapes[0].rotation).toBe(37);
 other.shapes.push(definition.shapes[0]);const before=structuredClone(definition);expect(()=>rotateSymbolRememberedEndpoint(definition,library,4,selection,37,pivot)).toThrow(/artwork budget/);expect(definition).toEqual(before);
});

it('rejects finite rotation absorbed by every selected pose without publishing',()=>{const p=fixture('rotated'),before=structuredClone(p);expect(()=>rotateRememberedEndpoint(p,4,picks,1e-300,pivot)).toThrow(/represented/);expect(p).toEqual(before);});

it('rechecks a later track frozen during cloning before any track is published',()=>{
 const p=fixture(),before=structuredClone(p),keys=p.layers.map(l=>l.keys),clone=structuredClone;let seen=false;
 vi.spyOn(globalThis,'structuredClone').mockImplementation(((value:unknown)=>{const out=clone(value);if(Array.isArray(value)&&value[0]?.id==='a'){seen=true;Object.freeze(p.layers[1]);}return out;})as typeof structuredClone);
 expect(()=>rotateRememberedEndpoint(p,4,picks,37,pivot)).toThrow(/atomic/);expect(seen).toBe(true);expect(p).toEqual(before);p.layers.forEach((l,i)=>expect(l.keys).toBe(keys[i]));
});

for(const field of ['tracks','artwork']as const)it('snapshots and bounds raw proxy request lengths before traversal: '+field,()=>{
 const p=fixture(),before=structuredClone(p);let reads=0;
 const changing=<T extends unknown[]>(value:T)=>new Proxy(value,{get(target,key,receiver){if(key==='length')return ++reads===1?value.length:Infinity;return Reflect.get(target,key,receiver);}});
 const input=field==='tracks'?changing(picks):[{layerId:'base',shapeIds:changing(['a','b'])}];
 expect(()=>rotateRememberedEndpoint(p,4,input,37,pivot)).toThrow(/changed/);expect(reads).toBe(2);expect(p).toEqual(before);
});

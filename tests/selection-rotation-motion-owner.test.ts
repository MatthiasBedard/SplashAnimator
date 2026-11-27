import {afterEach,expect,it,vi} from 'vitest';
import {newProject,validateProject,MAX_SYMBOL_ARTWORK,type Vector,type Project,type Point} from '../packages/document/src';
import {createBasicMotionSpan,promoteSampledMotionFrame,refreshBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {captureRememberedSelectionAuthoringFrame,type SampledUnitRequest} from '../packages/animation/src/selection-motion-owner';
import type {GroupAuthoringSource} from '../packages/animation/src/group-motion-owner';
import * as junction from '../packages/animation/src/motion-junction';
import * as motion from '../packages/animation/src/motion-spans';
afterEach(()=>vi.restoreAllMocks());
function ink(id:string,x:number,y:number,groups?:string[]):Vector{return{id,kind:'rectangle',x,y,width:12,height:12,rotation:0,pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(groups?{groups}:{})};}
function fixture(mode='plain'):GroupAuthoringSource{
 const project=newProject();project.duration=14;project.width=500;project.height=300;
 for(const [i,id]of ['base','extra'].entries()){
  const y=i?110:10,shapes=[ink('r',0,y),ink('b',20,y,['outer','inner']),ink('a',40,y,['outer','inner']),ink('c',60,y,['outer']),ink('other',100,y),ink('d',130,y,['second']),ink('e',150,y,['second'])];
  if(mode==='absent'||mode==='defaults')for(const s of shapes)delete s.pivot;
  if(mode==='affine'||mode==='reflected'||mode==='common-reflected')for(const s of shapes){s.rotation=25;s.transform=[mode==='affine'?1.3:-1.3,.2,.4,.8];}
  if(['compound','aligned','asymmetric'].includes(mode))for(const s of shapes){s.kind='polygon';s.closed=true;s.fillRule='evenodd';s.contours=[[[0,0],[12,0],[12,12],[0,12]],[[3,3],[3,6],[6,3]]].map(r=>r.map(([x,y])=>({x,y})));if(mode==='asymmetric'&&s.id==='r')s.contours[0]=[{x:-8,y:-3},{x:20,y:-3},{x:20,y:13},{x:-8,y:13}];}
  if(mode==='asymmetric')for(const s of shapes){if(s.id==='e'){s.width=57;s.height=27;}if(s.id==='c')s.height=41;if(s.id==='r'){s.width=28;s.height=16;}else s.contours![0]=[{x:0,y:0},{x:s.width,y:0},{x:s.width,y:s.height},{x:0,y:s.height}];}
  if(['loop','once','single','movie','nested-button'].includes(mode)){
   project.symbols??=[{id:'child',name:'Child',width:12,height:12,shapes:[ink('kid',0,0)],timeline:{duration:3,keys:[{frame:2,shapes:[{...ink('kid',0,0),fill:'#0000ff'}]}]}}];
   shapes[3]={...shapes[3],kind:'symbol',symbolId:'child',symbolPlayback:{mode:mode as 'loop'|'once'|'single'|'movie',firstFrame:1}};
   if(mode==='nested-button'){const button={...project.symbols![0],id:'button',buttonStates:{up:0,over:1,down:2,hit:0}},container={id:'container',name:'Container',width:12,height:12,shapes:[{...ink('button-instance',0,0),kind:'symbol' as const,symbolId:'button',symbolPlayback:{mode:'single' as const,firstFrame:0}}]};project.symbols=[button,container];shapes[3]={...shapes[3],symbolId:'container',symbolPlayback:{mode:'movie',firstFrame:0}};}
  }
  const end=shapes.map(s=>({...structuredClone(s),x:s.x+(i?100:80)}));
  if(mode==='aligned')for(const s of end)s.contours=[...s.contours!].reverse().map(r=>[r[1],r[0],...r.slice(2).reverse()]);
  if(mode.startsWith('common'))for(const s of [...shapes,...end]){const [a,b,c,d]=basis(s),det=a*d-b*c,x=17-s.x,y=-23-s.y;s.pivot={x:(d*x-c*y)/det,y:(a*y-b*x)/det};}
  const layer={id,name:id,visible:true,locked:false,drawingMode:'object' as const,keys:[{frame:0,shapes},{frame:i?10:8,shapes:end},{frame:12,shapes:[]}]};
  if(i===0)project.layers=[layer];else project.layers.push(layer);
  const rotation=mode==='aligned'?undefined:{direction:(mode==='clockwise'||mode==='counterclockwise'?mode:'shortest')as 'clockwise'|'counterclockwise'|'shortest',turns:mode==='clockwise'||mode==='counterclockwise'?1:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true,...(mode==='orbit'?{savedGroupPivots:true}:{})};
  createBasicMotionSpan(project,[id],0,i?10:8,'linear',{affine:true,...(mode==='aligned'?{nodes:true}:{}),...(mode.startsWith('common')?{pivots:true}:{}),...(mode==='defaults'?{pivots:true,defaultPivots:true}:{})},undefined,rotation,mode==='aligned'?{order:[1,0],start:[1,1],reverse:[true,true]}:undefined);
 }
 validateProject(project);return{project,revision:2,frame:4};
}
function basis(s:Vector){const r=s.rotation*Math.PI/180,c=Math.cos(r),n=Math.sin(r),[a,b,u,d]=s.transform??[1,0,0,1];return[c*a-n*b,n*a+c*b,c*u-n*d,n*u+c*d];}
function world(s:Vector,p:Point){const[a,b,c,d]=basis(s);return{x:s.x+a*p.x+c*p.y,y:s.y+b*p.x+d*p.y};}
function rotate(p:Point,center:Point,degrees:number){const r=degrees*Math.PI/180,c=Math.cos(r),n=Math.sin(r),x=p.x-center.x,y=p.y-center.y;return{x:center.x+c*x-n*y,y:center.y+n*x+c*y};}
const pick=(layerId:string,shapeId:string)=>({layerId,shapeId});
const mixed=[pick('extra','c'),pick('base','e'),pick('base','a'),pick('base','r')];
function comparable(p:Project){return{...p,layers:p.layers.map(l=>({...l,motionSpans:l.motionSpans?.map(s=>({...s,id:'span'}))}))};}
function expectedPivot(shapes:Vector[],mode:string){
 if(mode.startsWith('common'))return{x:17,y:-23};
 const points=shapes.flatMap(s=>[{x:0,y:0},{x:s.width,y:0},{x:0,y:s.height},{x:s.width,y:s.height}].map(p=>world(s,p)));
 return{x:(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,y:(Math.min(...points.map(p=>p.y))+Math.max(...points.map(p=>p.y)))/2};
}
for(const mode of ['plain','absent','defaults','affine','reflected','compound','aligned','asymmetric','common','common-reflected','loop','once','single','movie','nested-button','orbit'])for(const degrees of [37,-90,450])
it('prepares one private union rotation with original saved/default semantics '+mode+' '+degrees,()=>{
 const state=fixture(mode),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),owner=cap.resolveRotation(mixed),scene=cap.scene;
 expect(owner.units.map(u=>[u.layerId,u.kind,u.shapeId,u.shapeIds])).toEqual([['base','root','r',['r']],['base','group','b',['b','a','c']],['base','group','d',['d','e']],['extra','group','b',['b','a','c']]]);
 const originals=owner.tracks.flatMap(t=>scene.find(l=>l.layerId===t.layerId)!.key.shapes.filter(s=>t.shapeIds.includes(s.id))),pivot=expectedPivot(originals,mode);
 expect(owner.pivot.x).toBeCloseTo(pivot.x,9);expect(owner.pivot.y).toBeCloseTo(pivot.y,9);
 if(mode==='plain')expect(owner.pivot).toEqual({x:121,y:66});if(mode==='asymmetric')expect(owner.pivot).toEqual({x:143.5,y:80.5});
 const candidate=cap.prepareRotation(mixed,degrees),expected=structuredClone(state.project);
 for(const t of owner.tracks)promoteSampledMotionFrame(expected,[t.layerId],t.start,t.end,4);
 junction.rotateRememberedEndpoint(expected,4,owner.tracks,degrees,owner.pivot);expect(comparable(candidate)).toEqual(comparable(expected));
 for(const t of owner.tracks){const old=state.project.layers.find(l=>l.id===t.layerId)!,next=candidate.layers.find(l=>l.id===t.layerId)!,sample=scene.find(l=>l.layerId===t.layerId)!.key.shapes;
  expect(next.keys.filter(k=>[0,t.end,12].includes(k.frame))).toEqual(old.keys.filter(k=>[0,t.end,12].includes(k.frame)));expect(next.motionSpans!.map(s=>[s.options,s.rotation])).toEqual([old.motionSpans![0],old.motionSpans![0]].map(s=>[s.options,s.rotation]));
  for(const shape of sample){const got=next.keys.find(k=>k.frame===4)!.shapes.find(s=>s.id===shape.id)!;if(!t.shapeIds.includes(shape.id)){expect(got).toEqual(shape);continue;}
   expect({...got,x:shape.x,y:shape.y,rotation:shape.rotation}).toEqual(shape);
   for(const local of [{x:0,y:0},{x:7,y:11}]){const actual=world(got,local),wanted=rotate(world(shape,local),pivot,degrees);expect(actual.x).toBeCloseTo(wanted.x,8);expect(actual.y).toBeCloseTo(wanted.y,8);}
  }
 }
 expect(candidate.symbols).toEqual(state.project.symbols);expect(candidate.assets).toEqual(state.project.assets);expect(state).toEqual(before);cap.dispose();
});
for(const requests of [[pick('base','r'),pick('extra','r')],[pick('base','a'),pick('extra','a')],[pick('base','a'),pick('base','e')],[pick('base','r')]])
it('resolves roots/group unions independently of request order '+JSON.stringify(requests),()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state),forward=cap.resolveRotation(requests),backward=cap.resolveRotation([...requests].reverse());expect(backward).toEqual(forward);
 const spy=vi.spyOn(junction,'rotateRememberedEndpoint'),result=cap.prepareRotation(requests,37);expect(spy).toHaveBeenCalledTimes(1);expect(result.layers.filter(l=>l.motionSpans?.length===2)).toHaveLength(forward.tracks.length);expect(spy.mock.calls[0][4]).toEqual(forward.pivot);
});
it('keeps all public ownership/pivot/scene/output data detached and translation exact',()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),owner=cap.resolveRotation(mixed),canonical=structuredClone(owner),expected=cap.prepareRotation(mixed,37);
 owner.pivot.x=9999;owner.units[0].shapeIds=['other'];owner.tracks[0].shapeIds=['other'];cap.scene[0].key.shapes.splice(0);cap.choices.splice(0);
 const output=cap.prepareRotation(mixed.map(r=>({...r,pivot:{x:999,y:999},shapeIds:['other']})),37);expect(comparable(output)).toEqual(comparable(expected));output.layers[0].keys.find(k=>k.frame===4)!.shapes[0].pivot={x:999,y:999};output.symbols=[];
 expect(cap.resolveRotation(mixed)).toEqual(canonical);expect(comparable(cap.prepareRotation(mixed,37))).toEqual(comparable(expected));expect(Object.hasOwn(cap.resolveSelection(mixed),'pivot')).toBe(false);
 const translated=cap.prepareTranslation(mixed,{x:5,y:4});expect(translated.layers[0].keys.find(k=>k.frame===4)!.shapes[0].x).toBe(45);expect(state).toEqual(before);
});
for(const angle of [0,360,-720,NaN,Infinity,-Infinity,Number.MIN_VALUE,Number.MAX_VALUE,'37',new Number(37),undefined,null])
it('rejects invalid/no-op/unrepresentable degrees '+String(angle),()=>{const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state);expect(()=>cap.prepareRotation(mixed,angle as number)).toThrow();expect(state).toEqual(before);expect(cap.prepareRotation(mixed,37)).toBeDefined();});
for(const request of [[],[pick('missing','r')],[pick('base','missing')],[pick('base','r'),pick('base','r')],[pick('base','a'),pick('base','c')],[{layerId:1,shapeId:'r'}],[{layerId:'base'}],{0:pick('base','r'),length:1}])
it('rejects malformed/overlapping original units '+JSON.stringify(request),()=>{const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state);expect(()=>cap.prepareRotation(request as SampledUnitRequest[],37)).toThrow();expect(state).toEqual(before);expect(cap.prepareRotation(mixed,37)).toBeDefined();});
for(const mode of ['hidden','locked','merge','authored','near-start','held'])it('rejects nonauthorable rotation scope '+mode,()=>{
 const state=fixture();if(mode==='hidden')state.project.layers[1].visible=false;if(mode==='locked')state.project.layers[1].locked=true;if(mode==='merge')state.project.layers[1].drawingMode='merge';if(mode==='authored')state.frame=8;if(mode==='near-start')state.frame=1;if(mode==='held')state.frame=12;
 const before=structuredClone(state);expect(()=>captureRememberedSelectionAuthoringFrame(()=>state).prepareRotation(mixed,37)).toThrow();expect(state).toEqual(before);
});
for(const mode of ['reference','revision','frame','membership','library','lock','recipe','interior','numeric'])it('invalidates original rotation source after '+mode,()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state);cap.resolveRotation(mixed);
 if(mode==='reference')state.project=structuredClone(state.project);if(mode==='revision')state.revision++;if(mode==='frame')state.frame++;if(mode==='membership')state.project.layers[1].keys[0].shapes[1].groups=['changed'];if(mode==='library')state.project.symbols=[{id:'new',name:'New',width:1,height:1,shapes:[]}];if(mode==='lock')state.project.layers[1].locked=true;if(mode==='recipe')state.project.layers[1].motionSpans![0].id='changed';if(mode==='interior')state.project.layers[1].keys[1].shapes[0].x++;if(mode==='numeric')state.project.layers[1].keys[0].shapes[0].x=NaN;
 const before=structuredClone(state);expect(()=>cap.prepareRotation(mixed,37)).toThrow();expect(()=>cap.resolveRotation(mixed)).toThrow(/invalidated/);expect(state).toEqual(before);
});
it('snapshots request IDs and enclosing callbacks once',()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state),reads={layer:0,id:0,validate:0};cap.prepareRotation([{get layerId(){reads.layer++;return 'base';},get shapeId(){reads.id++;return 'a';}}],37,{get validate(){reads.validate++;return()=>{};}});expect(reads).toEqual({layer:1,id:1,validate:1});
});
for(const method of ['scene','choices','selection','rotation','translate','prepare','assert','dispose'])it('rejects rotation enclosing reentry '+method,()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state);
 const validate=()=>{try{if(method==='scene')void cap.scene;if(method==='choices')void cap.choices;if(method==='selection')cap.resolveSelection(mixed);if(method==='rotation')cap.resolveRotation(mixed);if(method==='translate')cap.prepareTranslation(mixed,{x:5,y:4});if(method==='prepare')cap.prepareRotation(mixed,37);if(method==='assert')cap.assertCurrent();if(method==='dispose')cap.dispose();}catch{/* Swallowed reentry still invalidates the outer owner. */}};
 expect(()=>cap.prepareRotation(mixed,37,{validate})).toThrow();expect(()=>cap.assertCurrent()).toThrow(/invalidated/);expect(state).toEqual(before);
});
for(const validate of [null,3,()=>Promise.resolve(),()=>{throw Error('enclosing');}])it('rejects invalid/async/enclosing failure and permits source-valid retries',()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state);expect(()=>cap.prepareRotation(mixed,37,{validate:validate as never})).toThrow();expect(state).toEqual(before);expect(cap.prepareRotation(mixed,37)).toBeDefined();
});
for(const field of ['layer','id','callback','angle','length'])it('rejects real source/input edits during '+field+' getter',()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state),request=pick('base','a'),requests=[request],options={validate:()=>{}};let degrees=37;
 if(field==='layer'||field==='id')Object.defineProperty(request,field==='layer'?'layerId':'shapeId',{get(){state.revision++;return field==='layer'?'base':'a';}});
 if(field==='callback')Object.defineProperty(options,'validate',{get(){state.revision++;return()=>{};}});
 if(field==='angle')degrees=({get angle(){state.revision++;return 37;}}).angle;
 if(field==='length')Object.defineProperty(requests,0,{get(){requests.push(pick('base','other'));return request;}});
 const before=structuredClone(state.project);expect(()=>cap.prepareRotation(requests,degrees,options)).toThrow();expect(state.project).toEqual(before);
});
for(const mode of ['source','options','rotation'])it('checks source/settings after the complete shared-pivot all-track kernel '+mode,()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),rotate=junction.rotateRememberedEndpoint;let seen=false;
 vi.spyOn(junction,'rotateRememberedEndpoint').mockImplementation((...args)=>{rotate(...args);expect(args[0].layers.every(l=>l.motionSpans?.length===2)).toBe(true);expect(args[0].layers[0].keys.find(k=>k.frame===4)!.shapes[0].rotation).toBe(37);seen=true;if(mode==='source')state.revision++;else if(mode==='options')args[0].layers[1].motionSpans![0].options!.affine=false;else args[0].layers[1].motionSpans![0].rotation!.axisGroupShear=false;});
 expect(()=>cap.prepareRotation(mixed,37)).toThrow();expect(seen).toBe(true);expect(state.project).toEqual(before.project);
});
for(const mutation of ['source','output'])it('admits original source and detached candidate after the completed output clone '+mutation,()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),clone=structuredClone;let seen=false;
 vi.spyOn(globalThis,'structuredClone').mockImplementation(((value:unknown)=>{const out=clone(value),p=out as Project;if(p?.layers?.every(l=>l.motionSpans?.length===2)&&p.layers[0].keys.find(k=>k.frame===4)?.shapes[0].rotation===37){seen=true;if(mutation==='source')state.revision++;else p.layers[0].keys.find(k=>k.frame===4)!.shapes[0].x++;}return out;})as typeof structuredClone);
 expect(()=>cap.prepareRotation(mixed,37)).toThrow();expect(seen).toBe(true);expect(state.project).toEqual(before.project);
});
for(const value of [undefined,false])it('requires original group-shear admission without widening '+value,()=>{
 const state=fixture();state.project.layers[1].motionSpans![0].rotation!.axisGroupShear=value;const before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),spy=vi.spyOn(junction,'rotateRememberedEndpoint');expect(()=>cap.prepareRotation(mixed,37)).toThrow(/already admit/);expect(spy).not.toHaveBeenCalled();expect(state).toEqual(before);expect(cap.prepareRotation([pick('base','r')],37)).toBeDefined();
});
it('rejects later-track overflow with no source writes or stale fallback',()=>{
 const state=fixture();for(const k of state.project.layers[1].keys.filter(k=>k.frame===0||k.frame===10))k.shapes.forEach(s=>s.x+=9e6);refreshBasicMotionSpan(state.project,['extra'],0,10);
 const before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),rotate=junction.rotateRememberedEndpoint,refresh=vi.spyOn(motion,'refreshBasicMotionSpan');let preparedFirst=false;
 vi.spyOn(junction,'rotateRememberedEndpoint').mockImplementation((...args)=>{refresh.mockClear();try{rotate(...args);}finally{preparedFirst=refresh.mock.calls.filter(call=>call[1][0]==='base').length===2;}});
 expect(()=>cap.prepareRotation(mixed,1)).toThrow(/geometry limits/);expect(preparedFirst).toBe(true);expect(state).toEqual(before);vi.restoreAllMocks();expect(cap.prepareRotation([pick('base','r')],37)).toBeDefined();
});
it('refreshes and reopens rotation output for later private editing',()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state),output=JSON.parse(JSON.stringify(cap.prepareRotation(mixed,37))) as Project,copy=structuredClone(output);for(const l of output.layers)for(const span of [...l.motionSpans!])refreshBasicMotionSpan(output,[l.id],span.start,span.end);expect(output).toEqual(copy);
 const later=captureRememberedSelectionAuthoringFrame(()=>({project:output,revision:0,frame:2}));expect(later.prepareRotation([pick('base','r'),pick('base','a')],-17).layers[0].motionSpans).toHaveLength(3);
});
it('admits actual symbol aggregate capacity through complete detached rotation',()=>{
 const state=fixture();state.project.symbols=[{id:'large',name:'Large',width:1,height:1,shapes:Array.from({length:MAX_SYMBOL_ARTWORK},(_,i)=>({...ink(String(i),0,0),width:1,height:1}))}];const cap=captureRememberedSelectionAuthoringFrame(()=>state),output=cap.prepareRotation([pick('base','r')],37);expect(output.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);expect(output.symbols).toEqual(state.project.symbols);cap.dispose();
},60000);

it('rejects finite degree changes absorbed by original rotated poses and permits fresh retry',()=>{
 const state=fixture('affine'),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state);expect(()=>cap.prepareRotation(mixed,1e-300)).toThrow(/represented/);expect(state).toEqual(before);expect(cap.prepareRotation(mixed,37)).toBeDefined();
});
it('rejects original aggregate overflow before capturing any rotation owner',()=>{
 const state=fixture();state.project.symbols=[{id:'large',name:'Large',width:1,height:1,shapes:Array(MAX_SYMBOL_ARTWORK+1).fill(ink('same',0,0))}];expect(()=>captureRememberedSelectionAuthoringFrame(()=>state)).toThrow(/symbol artwork budget/);
});
it('rejects detached output aggregate overflow after completed cloning without source writes',()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),clone=structuredClone;let seen=false;
 vi.spyOn(globalThis,'structuredClone').mockImplementation(((value:unknown)=>{const out=clone(value),p=out as Project;if(p?.layers?.every(l=>l.motionSpans?.length===2)&&p.layers[0].keys.find(k=>k.frame===4)?.shapes[0].rotation===37){seen=true;p.symbols=[{id:'large',name:'Large',width:1,height:1,shapes:Array(MAX_SYMBOL_ARTWORK+1).fill(ink('same',0,0))}];}return out;})as typeof structuredClone);
 expect(()=>cap.prepareRotation(mixed,37)).toThrow(/symbol artwork budget/);expect(seen).toBe(true);expect(state).toEqual(before);vi.restoreAllMocks();expect(cap.prepareRotation(mixed,37)).toBeDefined();
});

for(const direction of ['clockwise','counterclockwise'])it('retains the actual split-directed-turn headers '+direction,()=>{
 const state=fixture(direction),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),owner=cap.resolveRotation(mixed),scene=cap.scene,promoted=structuredClone(state.project);
 for(const track of owner.tracks)promoteSampledMotionFrame(promoted,[track.layerId],track.start,track.end,owner.frame);
 const headers=(p:Project)=>p.layers.map(l=>l.motionSpans!.map(span=>({...Object.fromEntries(Object.entries(span).filter(([key])=>key!=='baseline')),id:span.start===state.frame?'new-owned-split':span.id})));
 const result=cap.prepareRotation(mixed,37);expect(headers(result)).toEqual(headers(promoted));
 for(const track of owner.tracks)for(const s of result.layers.find(l=>l.id===track.layerId)!.keys.find(k=>k.frame===4)!.shapes.filter(s=>track.shapeIds.includes(s.id))){const old=scene.find(l=>l.layerId===track.layerId)!.key.shapes.find(t=>t.id===s.id)!,wanted=rotate(world(old,{x:7,y:11}),owner.pivot,37),got=world(s,{x:7,y:11});expect(got.x).toBeCloseTo(wanted.x,8);expect(got.y).toBeCloseTo(wanted.y,8);}
 for(const layer of result.layers)for(const span of [...layer.motionSpans!])refreshBasicMotionSpan(result,[layer.id],span.start,span.end);expect(state).toEqual(before);
});
for(const field of ['direction','turns'])it('rejects late mutation of derived rotation headers '+field,()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),rotate=junction.rotateRememberedEndpoint;let completed=false;
 vi.spyOn(junction,'rotateRememberedEndpoint').mockImplementation((...args)=>{rotate(...args);completed=true;const rotation=args[0].layers[1].motionSpans![0].rotation!;if(field==='direction')rotation.direction='clockwise';else{rotation.direction='clockwise';rotation.turns=1;}});
 expect(()=>cap.prepareRotation(mixed,37)).toThrow(/metadata/);expect(completed).toBe(true);expect(state).toEqual(before);
});

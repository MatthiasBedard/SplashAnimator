import {afterEach,expect,it,vi} from 'vitest';
import {newProject,validateProject,MAX_SYMBOL_ARTWORK,type Vector,type Project} from '../packages/document/src';
import {createBasicMotionSpan,promoteSampledMotionFrame,refreshBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {captureRememberedAuthoringFrame} from '../packages/animation/src/motion-owner';
import {captureRememberedGroupAuthoringFrame,type GroupAuthoringSource} from '../packages/animation/src/group-motion-owner';
import {captureRememberedSelectionAuthoringFrame,type SampledUnitRequest} from '../packages/animation/src/selection-motion-owner';
import * as junction from '../packages/animation/src/motion-junction';
import {worldPoint,matrix} from '../packages/geometry/src';
afterEach(()=>vi.restoreAllMocks());
function ink(id:string,x:number,groups?:string[]):Vector{return {id,kind:'rectangle',x,y:10,width:12,height:12,rotation:0,pivot:{x:3,y:4},fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],...(groups?{groups}:{})};}
function fixture(mode='plain'):GroupAuthoringSource {
 const project=newProject();project.duration=14;project.width=400;project.height=240;const layer=project.layers[0];layer.id='base';layer.drawingMode='object';
 const shapes=[ink('r',0),ink('b',20,['outer','inner']),ink('a',40,['outer','inner']),ink('c',60,['outer']),ink('other',100),ink('d',130,['second']),ink('e',150,['second'])];
 if(mode==='affine'||mode==='reflected')for(const s of shapes){s.rotation=25;s.transform=[mode==='reflected'?-1.3:1.3,.2,.4,.8];}
 if(mode==='compound')for(const s of shapes.filter(s=>['r','a'].includes(s.id))){s.kind='polygon';s.closed=true;s.fillRule='evenodd';s.nodes=[];s.contours=[[[0,0],[12,0],[12,12],[0,12]],[[3,3],[3,9],[9,9],[9,3]]].map(r=>r.map(([x,y])=>({x,y,out:{x:x+1,y}})));}
 if(['loop','once','single','movie'].includes(mode)){
  project.symbols=[{id:'child',name:'Child',width:12,height:12,shapes:[ink('kid',0)],timeline:{duration:3,keys:[{frame:2,shapes:[{...ink('kid',0),fill:'#00ff00'}]}]}}];
  shapes[3]={...shapes[3],kind:'symbol',symbolId:'child',symbolPlayback:{mode:mode as 'loop'|'once'|'single'|'movie',firstFrame:1}};
 }
 layer.keys=[{frame:0,shapes},{frame:8,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+80}))},{frame:12,shapes:[]}];
 createBasicMotionSpan(project,['base'],0,8,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true});
 const extra={...structuredClone(layer),id:'extra',name:'Extra',keys:[{frame:0,shapes:structuredClone(shapes)},{frame:10,shapes:shapes.map(s=>({...structuredClone(s),x:s.x+100}))},{frame:12,shapes:[]}],motionSpans:undefined};
 project.layers.push(extra);createBasicMotionSpan(project,['extra'],0,10,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true});
 if(mode==='fresh'){for(const t of project.layers)t.keys.find(k=>k.frame===(t.id==='base'?8:10))!.shapes.forEach(s=>s.x+=40);}
 validateProject(project);return {project,frame:4,revision:2};
}
const pick=(layerId:string,shapeId:string)=>({layerId,shapeId});
const mixed=[pick('extra','c'),pick('base','e'),pick('base','a'),pick('base','r')];
function comparable(p:Project){return {...p,layers:p.layers.map(l=>({...l,motionSpans:l.motionSpans?.map(s=>({...s,id:'owned-span'}))}))};}
for(const mode of ['plain','fresh','affine','reflected','compound','loop','once','single','movie'])it('prepares mixed complete units with independent world translations, '+mode,()=>{
 const state=fixture(mode),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),owner=cap.resolveSelection(mixed),pose=cap.scene;
 expect(owner.units.map(u=>[u.layerId,u.kind,u.shapeId,u.shapeIds])).toEqual([['base','root','r',['r']],['base','group','b',['b','a','c']],['base','group','d',['d','e']],['extra','group','b',['b','a','c']]]);
 expect(owner.tracks.map(t=>[t.layerId,t.start,t.end,t.shapeIds])).toEqual([['base',0,8,['r','b','a','c','d','e']],['extra',0,10,['b','a','c']]]);
 const candidate=cap.prepareTranslation(mixed,{x:10,y:-6}),expected=structuredClone(state.project);
 for(const t of owner.tracks)promoteSampledMotionFrame(expected,[t.layerId],t.start,t.end,4);
 junction.translateRememberedEndpoint(expected,4,owner.tracks,10,-6);expect(comparable(candidate)).toEqual(comparable(expected));
 for(const t of owner.tracks){
  const old=state.project.layers.find(l=>l.id===t.layerId)!,next=candidate.layers.find(l=>l.id===t.layerId)!,sample=pose.find(l=>l.layerId===t.layerId)!.key.shapes;
  expect(next.keys.filter(k=>[0,t.end,12].includes(k.frame))).toEqual(old.keys.filter(k=>[0,t.end,12].includes(k.frame)));expect(next.motionSpans).toHaveLength(2);
  expect(next.motionSpans!.map(s=>[s.options,s.rotation])).toEqual([old.motionSpans![0],old.motionSpans![0]].map(s=>[s.options,s.rotation]));
  for(const shape of sample){const got=next.keys.find(k=>k.frame===4)!.shapes.find(s=>s.id===shape.id)!;
   if(!t.shapeIds.includes(shape.id)){expect(got).toEqual(shape);continue;}
   expect({...got,x:shape.x,y:shape.y}).toEqual(shape);expect(matrix(got).slice(0,4)).toEqual(matrix(shape).slice(0,4));
   const a=worldPoint(shape,{x:7,y:11}),b=worldPoint(got,{x:7,y:11});expect(b.x).toBeCloseTo(a.x+10,9);expect(b.y).toBeCloseTo(a.y-6,9);
  }
 }
 expect(candidate.symbols).toEqual(state.project.symbols);expect(candidate.assets).toEqual(state.project.assets);expect(state).toEqual(before);cap.dispose();
});
for(const ids of [['other','r'],['a','r'],['e','a'],['c','r','e']])it('promotes one track only once for '+ids.join('/'),()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state),spy=vi.spyOn(junction,'translateRememberedEndpoint'),result=cap.prepareTranslation(ids.map(id=>pick('base',id)),{x:5,y:4});
 expect(result.layers[0].motionSpans).toHaveLength(2);expect(result.layers[1]).toEqual(state.project.layers[1]);expect(spy).toHaveBeenCalledTimes(1);expect(spy.mock.calls[0][2]).toHaveLength(1);
});
it('never accepts public scenes, hints, owners or candidates as private membership',()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),requests=[pick('base','a')],owner=cap.resolveSelection(requests);
 expect(cap.choices.map(c=>[c.layerId,c.shapeId])).toEqual(['base','extra'].flatMap(l=>['r','b','other','d'].map(id=>[l,id])));
 cap.scene[0].key.shapes.splice(0);cap.choices.splice(0);owner.units[0].shapeIds.splice(0,3,'other');owner.tracks[0].shapeIds.splice(0,3,'other');
 const result=cap.prepareTranslation([{...requests[0],shapeIds:['other']} as SampledUnitRequest],{x:5,y:4});result.layers[0].keys[4].shapes[1].groups=['forged'];result.symbols=[];
 expect(cap.resolveSelection(requests).units[0].shapeIds).toEqual(['b','a','c']);expect(cap.prepareTranslation(requests,{x:5,y:4}).layers[0].keys[4].shapes[1].groups).toEqual(['outer','inner']);expect(state).toEqual(before);
});
for(const requests of [[],[pick('missing','r')],[pick('base','missing')],[pick('base','r'),pick('base','r')],[pick('base','a'),pick('base','c')],[pick('extra','r'),pick('base','a'),pick('base','b')],[{layerId:1,shapeId:'r'}],[{layerId:'base'}],{0:pick('base','r'),length:1}])it('rejects missing/malformed/overlapping requests '+JSON.stringify(requests),()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),spy=vi.spyOn(junction,'translateRememberedEndpoint');
 expect(()=>cap.prepareTranslation(requests as SampledUnitRequest[],{x:10,y:4})).toThrow();expect(spy).not.toHaveBeenCalled();expect(state).toEqual(before);expect(cap.prepareTranslation([pick('base','r')],{x:5,y:4})).toBeDefined();
});
for(const offset of [{x:0,y:0},{x:NaN,y:1},{x:1,y:Infinity},{x:Number.MIN_VALUE,y:0},{x:Number.MAX_VALUE,y:0},{x:'2',y:1},{y:1},null])it('rejects raw/no-op/absorbed/overflow offsets '+JSON.stringify(offset),()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state);
 expect(()=>cap.prepareTranslation(mixed,offset as never)).toThrow();expect(state).toEqual(before);expect(cap.prepareTranslation(mixed,{x:10,y:4})).toBeDefined();
});
for(const mode of ['hidden','locked','merge','authored','near-start','near-end','held'])it('rejects non-authorable later selection '+mode,()=>{
 const state=fixture(),layer=state.project.layers[1];
 if(mode==='hidden')layer.visible=false;if(mode==='locked')layer.locked=true;if(mode==='merge')layer.drawingMode='merge';
 if(mode==='authored')state.frame=8;if(mode==='near-start')state.frame=1;if(mode==='near-end')state.frame=7;if(mode==='held')state.frame=12;
 const before=structuredClone(state);expect(()=>captureRememberedSelectionAuthoringFrame(()=>state).prepareTranslation(mixed,{x:10,y:4})).toThrow();expect(state).toEqual(before);
});
for(const mode of ['reference','revision','frame','membership','library','lock','hidden','recipe','interior','numeric'])it('invalidates after live source '+mode,()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state);cap.resolveSelection(mixed);
 if(mode==='reference')state.project=structuredClone(state.project);if(mode==='revision')state.revision++;if(mode==='frame')state.frame++;
 if(mode==='membership')state.project.layers[1].keys[0].shapes[1].groups=['changed'];if(mode==='library')state.project.symbols=[{id:'new',name:'New',width:1,height:1,shapes:[]}];
 if(mode==='lock')state.project.layers[1].locked=true;if(mode==='hidden')state.project.layers[1].visible=false;if(mode==='recipe')state.project.layers[1].motionSpans![0].id='changed';
 if(mode==='interior')state.project.layers[1].keys[1].shapes[0].x++;if(mode==='numeric')state.project.layers[1].keys[0].shapes[0].x=NaN;
 const before=structuredClone(state);expect(()=>cap.prepareTranslation(mixed,{x:5,y:4})).toThrow();expect(()=>cap.assertCurrent()).toThrow(/invalidated/);expect(state).toEqual(before);
});
it('snapshots original request IDs, delta and callback exactly once',()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state),reads={layer:0,id:0,x:0,y:0,validate:0};
 const requests=[{get layerId(){reads.layer++;return 'base';},get shapeId(){reads.id++;return 'a';}}],offset={get x(){reads.x++;return 5;},get y(){reads.y++;return 4;}},options={get validate(){reads.validate++;return ()=>{};}};
 cap.prepareTranslation(requests,offset,options);expect(reads).toEqual({layer:1,id:1,x:1,y:1,validate:1});
});
for(const field of ['layer','id','x','y','callback','length'])it('rejects changed input or source during one-shot getter '+field,()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state),request=pick('base','a'),offset={x:5,y:4},options={validate:()=>{}},requests=[request];
 if(field==='layer'||field==='id')Object.defineProperty(request,field==='layer'?'layerId':'shapeId',{get(){state.revision++;return field==='layer'?'base':'a';}});
 if(field==='x'||field==='y')Object.defineProperty(offset,field,{get(){state.revision++;return 5;}});
 if(field==='callback')Object.defineProperty(options,'validate',{get(){state.revision++;return ()=>{};}});
 if(field==='length')Object.defineProperty(requests,0,{get(){requests.push(pick('base','other'));return request;}});
 const before=structuredClone(state.project);expect(()=>cap.prepareTranslation(requests,offset,options)).toThrow();expect(state.project).toEqual(before);
});
for(const method of ['scene','choices','resolve','prepare','assert','dispose'])it('rejects capture reentry during enclosing validation '+method,()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state);
 const validate=()=>{if(method==='scene')void cap.scene;if(method==='choices')void cap.choices;if(method==='resolve')cap.resolveSelection(mixed);if(method==='prepare')cap.prepareTranslation(mixed,{x:5,y:4});if(method==='assert')cap.assertCurrent();if(method==='dispose')cap.dispose();};
 expect(()=>cap.prepareTranslation(mixed,{x:5,y:4},{validate})).toThrow();expect(()=>cap.assertCurrent()).toThrow(/invalidated/);expect(state).toEqual(before);
});
for(const validate of [null,3,()=>Promise.resolve(),()=>{throw Error('enclosing');}])it('rejects invalid/asynchronous/failed enclosing validators without writes',()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state);expect(()=>cap.prepareTranslation(mixed,{x:5,y:4},{validate:validate as never})).toThrow();expect(state).toEqual(before);expect(cap.prepareTranslation(mixed,{x:5,y:4})).toBeDefined();
});
it('rejects late actual source change after the complete atomic junction candidate exists',()=>{
 const state=fixture(),before=structuredClone(state.project),cap=captureRememberedSelectionAuthoringFrame(()=>state),translate=junction.translateRememberedEndpoint;let completed=false;
 vi.spyOn(junction,'translateRememberedEndpoint').mockImplementation((...args)=>{translate(...args);const p=args[0];expect(p.layers[0].motionSpans).toHaveLength(2);expect(p.layers[1].motionSpans).toHaveLength(2);expect(p.layers[0].keys[4].shapes.find(s=>s.id==='r')!.x).toBe(45);expect(p.layers[1].keys[4].shapes.find(s=>s.id==='a')!.y).toBe(14);completed=true;state.project.symbols=[{id:'changed',name:'Changed',width:1,height:1,shapes:[]}];});
 expect(()=>cap.prepareTranslation(mixed,{x:5,y:4})).toThrow(/changed/);expect(completed).toBe(true);expect(state.project).toEqual({...before,symbols:state.project.symbols});
});
it('rejects post-clone source edits and permits no stale scene fallback',()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state),clone=structuredClone;let fired=false;
 vi.spyOn(globalThis,'structuredClone').mockImplementation((value,options)=>{const out=clone(value,options);if((value as Project)?.layers&&!fired){fired=true;state.revision++;}return out;});
 expect(()=>cap.prepareTranslation(mixed,{x:5,y:4})).toThrow(/changed/);expect(fired).toBe(true);expect(()=>cap.scene).toThrow(/invalidated/);
});
it('reopens generated output for later private selection edits',()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state),candidate=JSON.parse(JSON.stringify(cap.prepareTranslation(mixed,{x:5,y:4}))) as Project;
 refreshBasicMotionSpan(candidate,['base'],0,4);const next=captureRememberedSelectionAuthoringFrame(()=>({project:candidate,revision:0,frame:2}));expect(next.prepareTranslation([pick('base','r'),pick('base','a')],{x:-2,y:3}).layers[0].motionSpans).toHaveLength(3);
});
it('keeps exact legacy root/group ownership scope',()=>{
 const state=fixture(),root=captureRememberedAuthoringFrame(()=>state,4),group=captureRememberedGroupAuthoringFrame(()=>state),set=captureRememberedSelectionAuthoringFrame(()=>state);
 expect(root.resolve('base','a').shapeId).toBe('a');expect(group.resolveGroup('base','a').shapeId).toBe('a');expect(set.resolveSelection([pick('base','a')]).units[0].shapeId).toBe('b');expect(group.prepareGroupPromotion('base','a')).toBeDefined();
});
it('rejects original nonfinite and aggregate library overflow before capture',()=>{
 const state=fixture();state.project.layers[0].keys[0].shapes[0].x=NaN;expect(()=>captureRememberedSelectionAuthoringFrame(()=>state)).toThrow(/nonfinite/);
 const valid=fixture();valid.project.symbols=[{id:'large',name:'Large',width:1,height:1,shapes:Array(MAX_SYMBOL_ARTWORK+1).fill(ink('same',0))}];expect(()=>captureRememberedSelectionAuthoringFrame(()=>valid)).toThrow(/symbol artwork budget/);
});

for(const value of [undefined,false])it('requires existing saved group-shear admission without changing legacy promotion '+value,()=>{
 const state=fixture();for(const layer of state.project.layers)layer.motionSpans![0].rotation!.axisGroupShear=value;
 const before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state);
 expect(cap.resolveSelection(mixed).units).toHaveLength(4);expect(()=>cap.prepareTranslation(mixed,{x:5,y:4})).toThrow(/already admit/);expect(state).toEqual(before);
 expect(captureRememberedGroupAuthoringFrame(()=>state).prepareGroupPromotion('base','a',{x:5,y:4})).toBeDefined();
});

for(const length of [NaN,Infinity,-1,.5,Number.MAX_SAFE_INTEGER,15])it('bounds forged request length by original eligible artwork '+length,()=>{
 const state=fixture(),cap=captureRememberedSelectionAuthoringFrame(()=>state);let ids=0;
 const requests=new Proxy([pick('base','r')],{get(target,key,receiver){if(key==='length')return length;if(key==='0')ids++;return Reflect.get(target,key,receiver);}});
 expect(()=>cap.prepareTranslation(requests,{x:5,y:4})).toThrow();expect(ids).toBe(0);expect(cap.resolveSelection([pick('base','r')]).units).toHaveLength(1);
});
for(const mode of ['missing','ancestry','order','duplicate','stack'])it('rejects changed later group topology '+mode,()=>{
 const state=fixture(),shapes=state.project.layers[1].keys.find(k=>k.frame===10)!.shapes;
 if(mode==='missing')shapes.splice(3,1);if(mode==='ancestry')shapes[3].groups=['else'];if(mode==='order')[shapes[1],shapes[2]]=[shapes[2],shapes[1]];if(mode==='duplicate')shapes[3].id='a';if(mode==='stack')[shapes[3],shapes[4]]=[shapes[4],shapes[3]];
 const before=structuredClone(state);expect(()=>captureRememberedSelectionAuthoringFrame(()=>state).prepareTranslation(mixed,{x:5,y:4})).toThrow();expect(state).toEqual(before);
});
it('rejects later-track coordinate limits without returning partial artwork',()=>{
 const state=fixture(),extra=state.project.layers[1];for(const frame of [0,10])extra.keys.find(k=>k.frame===frame)!.shapes.find(s=>s.id==='r')!.x=9e6;refreshBasicMotionSpan(state.project,['extra'],0,10);validateProject(state.project);
 const before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),translate=junction.translateRememberedEndpoint;let completed=false;
 vi.spyOn(junction,'translateRememberedEndpoint').mockImplementation((...args)=>{translate(...args);expect(args[0].layers[0].keys[4].shapes.find(s=>s.id==='r')!.x).toBe(2000040);expect(args[0].layers[1].keys[4].shapes.find(s=>s.id==='r')!.x).toBe(11e6);completed=true;});
 expect(()=>cap.prepareTranslation([pick('base','r'),pick('extra','r')],{x:2e6,y:0})).toThrow(/shape geometry/);expect(completed).toBe(true);expect(state).toEqual(before);vi.restoreAllMocks();expect(cap.prepareTranslation([pick('base','r')],{x:5,y:4})).toBeDefined();
});
it('rejects later-track saved option widening before any translation request',()=>{
 const state=fixture();state.project.layers[1].motionSpans![0].rotation!.axisGroupShear=false;
 const before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),translate=vi.spyOn(junction,'translateRememberedEndpoint');
 expect(()=>cap.prepareTranslation(mixed,{x:5,y:4})).toThrow(/already admit/);expect(translate).not.toHaveBeenCalled();expect(state).toEqual(before);expect(cap.prepareTranslation([pick('base','r')],{x:5,y:4})).toBeDefined();
});
it('invalidates source-reader reentry and remains terminal after explicit disposal',()=>{
 const state=fixture();let read=()=>state;const cap=captureRememberedSelectionAuthoringFrame(()=>read());read=()=>{try{cap.resolveSelection([pick('base','r')]);}catch{/* outer admission must still reject */}return state;};
 expect(()=>cap.prepareTranslation(mixed,{x:5,y:4})).toThrow();expect(()=>cap.scene).toThrow(/invalidated/);
 const fresh=captureRememberedSelectionAuthoringFrame(()=>state);fresh.dispose();fresh.dispose();expect(()=>fresh.resolveSelection(mixed)).toThrow(/invalidated/);
});
it('admits the exact original symbol artwork capacity through detached translation',()=>{
 const state=fixture();state.project.symbols=[{id:'large',name:'Large',width:1,height:1,shapes:Array.from({length:MAX_SYMBOL_ARTWORK},(_,i)=>({...ink(String(i),0),width:1,height:1}))}];
 const cap=captureRememberedSelectionAuthoringFrame(()=>state),result=cap.prepareTranslation([pick('base','r')],{x:5,y:4});expect(result.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);expect(result.symbols).toEqual(state.project.symbols);expect(result.layers[0].keys[4].shapes[0].x).toBe(45);cap.dispose();
},60000);

for(const options of [undefined,{}, {affine:false},{affine:true}])it('keeps original ungrouped default/explicit recipe options '+JSON.stringify(options),()=>{
 const project=newProject();project.duration=12;const layer=project.layers[0];layer.id='base';layer.drawingMode='object';layer.keys=[{frame:0,shapes:[ink('r',0),ink('other',50)]},{frame:8,shapes:[ink('r',80),ink('other',130)]},{frame:10,shapes:[]}];createBasicMotionSpan(project,['base'],0,8,'linear',options);
 const before=structuredClone(project),cap=captureRememberedSelectionAuthoringFrame(()=>({project,revision:0,frame:4})),candidate=cap.prepareTranslation([pick('base','other'),pick('base','r')],{x:5,y:4});
 expect(candidate.layers[0].motionSpans!.map(s=>s.options)).toEqual([before.layers[0].motionSpans![0].options,before.layers[0].motionSpans![0].options]);expect(project).toEqual(before);
});
it('snapshots source reader metadata once per read',()=>{
 const state=fixture();let calls=0,projects=0,revisions=0,frames=0;
 const cap=captureRememberedSelectionAuthoringFrame(()=>{calls++;return {get project(){projects++;return state.project;},get revision(){revisions++;return state.revision;},get frame(){frames++;return state.frame;}};});
 cap.prepareTranslation(mixed,{x:5,y:4});expect(projects).toBe(calls);expect(revisions).toBe(calls);expect(frames).toBe(calls);
});

for(const mode of ['options','rotation'])it('admits original saved settings again after complete regeneration '+mode,()=>{
 const state=fixture(),before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state),translate=junction.translateRememberedEndpoint;let completed=false;
 vi.spyOn(junction,'translateRememberedEndpoint').mockImplementation((...args)=>{translate(...args);const span=args[0].layers[1].motionSpans!.find(s=>s.start===4)!;if(mode==='options')span.options!.affine=false;else span.rotation!.axisGroupShear=false;completed=true;});
 expect(()=>cap.prepareTranslation(mixed,{x:5,y:4})).toThrow(/already admit/);expect(completed).toBe(true);expect(state).toEqual(before);vi.restoreAllMocks();expect(cap.prepareTranslation(mixed,{x:5,y:4})).toBeDefined();
});

for(const mode of ['absent','undefined','object'] as const)it('admits original object-mode defaults without materializing settings '+mode,()=>{
 const state=fixture();for(const layer of state.project.layers){if(mode==='absent')delete layer.drawingMode;else layer.drawingMode=mode==='undefined'?undefined:'object';}
 const before=structuredClone(state),cap=captureRememberedSelectionAuthoringFrame(()=>state);
 expect(cap.choices.map(c=>[c.layerId,c.shapeId])).toEqual(['base','extra'].flatMap(id=>['r','b','other','d'].map(shapeId=>[id,shapeId])));
 const result=cap.prepareTranslation(mixed,{x:5,y:4});for(let i=0;i<result.layers.length;i++){expect(Object.hasOwn(result.layers[i],'drawingMode')).toBe(Object.hasOwn(before.project.layers[i],'drawingMode'));expect(result.layers[i].drawingMode).toBe(before.project.layers[i].drawingMode);}
 expect(state).toEqual(before);cap.dispose();
});

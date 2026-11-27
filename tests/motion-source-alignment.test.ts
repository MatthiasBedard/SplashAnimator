import {expect,it} from 'vitest';
import {clone,newProject,migrateProject,validateProject,type Vector} from '../packages/document/src';
import {validateMotionContourCorrespondence} from '../packages/document/src/motion-contour';
import {createBasicMotionSpan,refreshBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {shiftMotionContourStart} from '../packages/animation/src/motion-nodes';
import {saveProject,loadProject,type DirectoryStore} from '../packages/document/src/storage';
const alignment={start:[1,2],reverse:[true,false],order:[1,0]};
function fixture(){const p=newProject();p.duration=5;const a:Vector={id:'a',kind:'polygon',x:0,y:0,width:20,height:20,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[],contours:[[{x:0,y:0},{x:20,y:0},{x:0,y:20}],[{x:3,y:3},{x:6,y:3},{x:6,y:6},{x:3,y:6}]]};const b=clone(a);b.contours=b.contours!.map(r=>r.map(n=>({x:n.x*2,y:n.y*2})));p.layers[0].keys=[{frame:0,shapes:[a]},{frame:4,shapes:[b]}];return p;}
it('generates in aligned source order while retaining exact authored endpoints and captured settings',()=>{
 const p=fixture(),before=clone(p),settings=clone(alignment),id=p.layers[0].id;
 createBasicMotionSpan(p,[id],0,4,'linear',{nodes:true},undefined,undefined,{source:settings,...settings});settings.start[0]=99;
 expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
 const source=shiftMotionContourStart(before.layers[0].keys[0].shapes[0],alignment.start,alignment.reverse,alignment.order),target=shiftMotionContourStart(before.layers[0].keys[1].shapes[0],alignment.start,alignment.reverse,alignment.order);
 const midpoint=p.layers[0].keys[2].shapes[0];expect(midpoint.contours).toEqual(source.contours!.map((r,i)=>r.map((n,j)=>({x:(n.x+target.contours![i][j].x)/2,y:(n.y+target.contours![i][j].y)/2}))));
 const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,[id],0,4);expect(loaded).toEqual(p);
});
it('rejects malformed originals, invalid matching, missing node interpolation and later-track failures atomically',()=>{
 for(const source of [null,{source:{}},{nodes:true},{start:NaN},{reverse:[null]},{order:[1,1]}])expect(()=>validateMotionContourCorrespondence({source})).toThrow();
 expect(()=>validateMotionContourCorrespondence({source:alignment,nodes:{hints:[[[2,1],[1,2]]]}})).toThrow(/increasing/);
 const p=fixture(),before=clone(p);expect(()=>createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear',undefined,undefined,undefined,{source:alignment})).toThrow(/node interpolation/);expect(p).toEqual(before);
 p.layers.push({...clone(p.layers[0]),id:'later'});p.layers[1].keys[0].shapes[0].contours!.pop();const saved=clone(p);expect(()=>createBasicMotionSpan(p,p.layers.map(l=>l.id),0,4,'linear',{nodes:true},undefined,undefined,{source:alignment,...alignment})).toThrow(/count/);expect(p).toEqual(saved);
});
it('persists root and symbol source alignment and rejects unversioned fields before migration',async()=>{
 const p=fixture();createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear',{nodes:true},undefined,undefined,{source:alignment,...alignment});const layer=clone(p.layers[0]);p.symbols=[{id:'s',name:'s',width:100,height:100,shapes:layer.keys[0].shapes,timeline:{duration:5,keys:layer.keys.slice(1),motionSpans:layer.motionSpans,layers:[{...clone(layer),id:'extra'}]}}];expect(validateProject(p)).toEqual(p);
 const files=new Map<string,string>(),store:DirectoryStore={read:async k=>files.get(k)!,exists:async k=>files.has(k),writeNew:async(k,v)=>{files.set(k,v);},commit:async(k,v)=>{files.set(k,v);}};
 const manifest=await saveProject(store,p,null);expect(JSON.parse(manifest).schemaVersion).toBe(59);expect((await loadProject(store)).project).toEqual(p);
 for(const target of ['root','base','extra']){const q=clone(p);q.layers[0].motionSpans=undefined;q.symbols![0].timeline!.motionSpans=undefined;q.symbols![0].timeline!.layers![0].motionSpans=undefined;const track=target==='root'?q.layers[0]:target==='base'?q.symbols![0].timeline!:q.symbols![0].timeline!.layers![0];track.motionSpans=clone(layer.motionSpans);expect(()=>migrateProject({...q,schemaVersion:45})).toThrow(/schema 46/);}
 const legacy=fixture();expect(migrateProject({...legacy,schemaVersion:45})).toEqual(legacy);
});

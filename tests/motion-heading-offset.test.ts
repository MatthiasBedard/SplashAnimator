import {expect,it} from 'vitest';
import {newProject,migrateProject,validateProject,clone} from '../packages/document/src';
import {validateMotionPath} from '../packages/document/src/motion-path';
import {createBasicMotionSpan,refreshBasicMotionSpan} from '../packages/animation/src/motion-spans';
import {createMotionPathSampler,reverseTangentCubicPath,splitPreservedMotionPath} from '../packages/animation/src/motion-path';
import {saveProject,loadProject,type DirectoryStore} from '../packages/document/src/storage';
const path={startX:30,startY:20,endX:-30,endY:20,tangent:true,headingOffset:180};
function fixture(){const p=newProject();p.duration=5;const art={id:'art',kind:'rectangle' as const,x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};p.layers[0].keys=[{frame:0,shapes:[art]},{frame:4,shapes:[{...art,x:100}]}];createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear',undefined,path);return p;}
it('validates original correction values and restricts unsupported trajectory modes',()=>{
 for(const headingOffset of [NaN,Infinity,null,'180',360001])expect(()=>validateMotionPath({...path,headingOffset} as typeof path)).toThrow(/correction/);
 for(const bad of [{tangent:false}])expect(()=>validateMotionPath({...path,...bad})).toThrow(/correction/);
 for(const headingOffset of [-360000,0,12.25,360000])expect(()=>validateMotionPath({...path,headingOffset})).not.toThrow();
 const p=fixture();p.layers[0].motionSpans![0].path!.headingOffset=NaN;expect(()=>validateProject(p)).toThrow(/correction/);
});
it('applies captured heading corrections and composes reversal without changing position',()=>{
 const from={x:0,y:0},to={x:100,y:0},settings={...path,headingOffset:12.25},corrected=createMotionPathSampler(from,to,settings),base=createMotionPathSampler(from,to,{...path,headingOffset:0});settings.headingOffset=99;
 for(const t of [.1,.5,.9]){expect(corrected(t).x).toBe(base(t).x);expect(corrected(t).tangentAngle!-base(t).tangentAngle!).toBeCloseTo(12.25,10);}
 const reversed=reverseTangentCubicPath(from,to,{...path,headingOffset:12.25}),sample=createMotionPathSampler(to,from,{...reversed.path,headingOffset:reversed.headingOffset});for(const t of [.1,.5,.9])expect(sample(t).tangentAngle).toBeCloseTo(corrected(1-t).tangentAngle!,10);
 expect(splitPreservedMotionPath(from,to,path,.5)).toHaveLength(2);
});
it('migrates schema 43 without inventing corrections and rejects unversioned root and symbol fields',()=>{
 const p=fixture();const legacy=clone(p) as unknown as Record<string,unknown>;legacy.schemaVersion=43;expect(()=>migrateProject(legacy)).toThrow(/schema 44/);delete p.layers[0].motionSpans![0].path!.headingOffset;const upgraded=migrateProject({...p,schemaVersion:43});expect(upgraded.schemaVersion).toBe(59);expect(upgraded.layers[0].motionSpans![0].path!.headingOffset).toBeUndefined();
 for(const additional of [false,true]){const q=fixture(),span=clone(q.layers[0].motionSpans![0]);q.layers[0].motionSpans=undefined;q.symbols=[{id:'s',name:'s',width:100,height:100,shapes:[],timeline:{duration:5,keys:[],...(additional?{layers:[{...q.layers[0],id:'extra',motionSpans:[span]}]}:{motionSpans:[span]})}}];expect(()=>migrateProject({...q,schemaVersion:43})).toThrow(/schema 44/);}
});
it('roundtrips corrected keys and recipes through directory persistence and refresh',async()=>{
 const p=fixture(),files=new Map<string,string>();const store:DirectoryStore={read:async k=>{if(!files.has(k))throw Error('missing');return files.get(k)!;},exists:async k=>files.has(k),writeNew:async(k,v)=>{if(files.has(k))throw Error('exists');files.set(k,v);},commit:async(k,v)=>{files.set(k,v);}};
 const manifest=await saveProject(store,p,null);expect(JSON.parse(manifest).schemaVersion).toBe(59);const loaded=(await loadProject(store)).project;expect(loaded).toEqual(p);const before=clone(loaded.layers[0].keys);refreshBasicMotionSpan(loaded,[loaded.layers[0].id],0,4);expect(loaded.layers[0].keys).toEqual(before);expect(migrateProject(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded);
});

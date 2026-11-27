import {expect,it} from 'vitest';
import {newProject,validateProject,migrateProject,setAudioClips,clone,History,type AudioClip} from '../packages/document/src';
const project=()=>{const p=newProject();p.assets=[{id:'sound',path:'assets/audio/sound.wav',audio:{name:'Sound',format:'pcm16-wav' as const,sampleRate:8000,channels:1 as const,frames:8000}}];return p;};
const clip=():AudioClip=>({id:'clip',assetId:'sound',startFrame:4,offsetSamples:12,gain:0.5});
it('owns detached root audio references with independent history and no artwork changes',()=>{
 const p=project(),before=clone(p),history=new History(),clips=[clip()];setAudioClips(p,clips);history.record(before,'Edit audio clips');clips[0].gain=9;
 expect(p.audioClips![0].gain).toBe(0.5);expect(p.layers).toEqual(before.layers);expect(p.duration).toBe(before.duration);
 const undone=history.undo(p)!;expect(undone.audioClips).toBeUndefined();expect(history.redo(undone)).toEqual(p);
 setAudioClips(p,[]);expect(p.audioClips).toBeUndefined();
});
it('rejects invalid original metadata and clip values before any mutation',()=>{
 const p=project();setAudioClips(p,[clip()]);const before=clone(p);
 for(const bad of [{...clip(),startFrame:48},{...clip(),offsetSamples:8001},{...clip(),gain:NaN},{...clip(),gain:Infinity},{...clip(),assetId:'missing'},{...clip(),id:''}]){
  expect(()=>setAudioClips(p,[bad])).toThrow();expect(p).toEqual(before);
 }
 expect(()=>setAudioClips(p,[clip(),clip()])).toThrow();expect(p).toEqual(before);
 for(const patch of [{frames:NaN},{frames:Infinity},{frames:0},{channels:3},{sampleRate:7999},{format:'mp3'},{frames:33554433}])expect(()=>validateProject({...p,assets:[{...p.assets[0],audio:{...p.assets[0].audio,...patch}}]})).toThrow();
 p.assets[0].audio!.frames=NaN;expect(()=>setAudioClips(p,[])).toThrow();expect(Number.isNaN(p.assets[0].audio!.frames)).toBe(true);
});
it('enforces audio paths and aggregate PCM budgets without accepting bitmap aliases',()=>{
 const p=project();for(const path of ['assets/images/sound.wav','assets/audio/../sound.wav','assets/audio/sound.mp3'])expect(()=>validateProject({...p,assets:[{...p.assets[0],path}]})).toThrow();
 expect(()=>validateProject({...p,assets:[{...p.assets[0],audio:Object.assign([],p.assets[0].audio)}]})).toThrow();
 const a=p.assets[0];a.audio!.frames=16777216;expect(validateProject(p).assets).toEqual(p.assets);
 p.assets.push({...clone(a),id:'second',path:'assets/audio/second.wav'});expect(validateProject(p).assets.length).toBe(2);
 p.assets[1].audio!.frames++;expect(()=>validateProject(p)).toThrow(/PCM budget/);
 expect(()=>validateProject({...project(),assets:[{...a,bitmap:{name:'bad',width:1,height:1}}]})).toThrow(/ambiguous/);
});
it('migrates schema 41 without inventing audio and rejects unversioned references before cloning',()=>{
 const p=newProject(),legacy={...p,schemaVersion:41};expect(migrateProject(legacy)).toEqual(p);expect(legacy.schemaVersion).toBe(41);
 for(const schemaVersion of [0,40,41]){
  expect(()=>migrateProject({...legacy,schemaVersion,audioClips:[]})).toThrow(/schema 42/);
  expect(()=>migrateProject({...project(),schemaVersion})).toThrow(/schema 42/);
 }
 const invalid={...legacy,fps:NaN};expect(()=>migrateProject(invalid)).toThrow();expect(Number.isNaN(invalid.fps)).toBe(true);
});
it('keeps root audio timing independent of short symbol timelines',()=>{
 const p=project();setAudioClips(p,[{...clip(),startFrame:40}]);
 p.symbols=[{id:'symbol',name:'Short',width:10,height:10,shapes:[{id:'shape',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]}],timeline:{duration:2,keys:[]}}];
 expect(validateProject(p).audioClips).toEqual(p.audioClips);
});

it('persists detached fade references through history and migrates only versioned envelopes',()=>{
 const p=project(),before=clone(p),history=new History(),draft={...clip(),fadeInSamples:400,fadeOutSamples:800};setAudioClips(p,[draft]);history.record(before,'Fade audio');draft.fadeInSamples=1;
 expect(p.audioClips![0].fadeInSamples).toBe(400);const undone=history.undo(p)!;expect(undone.audioClips).toBeUndefined();expect(history.redo(undone)).toEqual(p);
 const legacy={...before,schemaVersion:42};expect(migrateProject(legacy)).toEqual(before);expect(legacy.schemaVersion).toBe(42);
 expect(()=>migrateProject({...p,schemaVersion:42})).toThrow(/schema 43/);
 for(const fade of [NaN,Infinity,-1,0.5,null,7989]){const snapshot=clone(p);expect(()=>setAudioClips(p,[{...clip(),fadeInSamples:fade as number}])).toThrow(/fade/);expect(p).toEqual(snapshot);}
 const invalid={...p,audioClips:[{...clip(),fadeOutSamples:NaN}]};expect(()=>validateProject(invalid)).toThrow(/fade/);expect(Number.isNaN(invalid.audioClips[0].fadeOutSamples)).toBe(true);
});

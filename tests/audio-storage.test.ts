import {afterEach,expect,it,vi} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {NodeDirectoryStore,createDirectory} from '../packages/document/src/node-store';
import {newProject} from '../packages/document/src';
import {saveProject,loadProject} from '../packages/document/src/storage';
import {pcm16WavFixture} from './wav-fixture';
const roots:string[]=[];
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'splash-audio-'));roots.push(root);const folder=path.join(root,'Audio.spl');await createDirectory(folder);return {folder,store:new NodeDirectoryStore(folder)};}
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
const wav=()=>pcm16WavFixture([[0,16384,-32768]]);
it('persists an owned binary snapshot and loads matching project references',async()=>{
 const {store,folder}=await fixture(),bytes=wav(),before=bytes.slice();const write=store.writeNewAudio('assets/audio/test.wav',bytes);bytes.fill(0);await write;
 expect(await store.readAudio('assets/audio/test.wav')).toEqual(before);
 const project=newProject();project.assets=[{id:'a',path:'assets/audio/test.wav',audio:{name:'Test',format:'pcm16-wav',sampleRate:8000,channels:1,frames:3}}];
 project.audioClips=[{id:'clip',assetId:'a',startFrame:0,offsetSamples:0,gain:1,fadeInSamples:2,fadeOutSamples:1}];
 await saveProject(store,project,null);expect((await loadProject(store)).missingAssets).toEqual([]);expect((await loadProject(store)).project).toEqual(project);
 expect(await fs.readdir(path.join(folder,'assets/audio'))).toEqual(['test.wav']);
});
it('never replaces existing artwork and leaves no temporary files on collision',async()=>{
 const {store,folder}=await fixture();await store.writeNewAudio('assets/audio/test.wav',wav());
 await expect(store.writeNewAudio('assets/audio/test.wav',new Uint8Array(50))).rejects.toThrow();expect(await store.readAudio('assets/audio/test.wav')).toEqual(wav());expect(await fs.readdir(path.join(folder,'assets/audio'))).toEqual(['test.wav']);
});
it('allows exactly one concurrent exclusive writer',async()=>{
 const {store}=await fixture(),first=wav(),second=wav();second[44]=77;
 const results=await Promise.allSettled([store.writeNewAudio('assets/audio/test.wav',first),store.writeNewAudio('assets/audio/test.wav',second)]);
 expect(results.filter(r=>r.status==='fulfilled').length).toBe(1);const bytes=await store.readAudio('assets/audio/test.wav');expect([first[44],second[44]]).toContain(bytes[44]);
});
it('rejects unsafe paths, shared views, empty files and oversized reads',async()=>{
 const {store,folder}=await fixture();for(const name of ['project.json','assets/audio/../outside.wav','assets/images/test.wav','assets/audio/test.mp3'])await expect(store.writeNewAudio(name,wav())).rejects.toThrow();
 await expect(store.writeNewAudio('assets/audio/test.wav',new Uint8Array(new SharedArrayBuffer(50)))).rejects.toThrow(/nonshared/);
 await expect(store.writeNewAudio('assets/audio/test.wav',new Uint8Array(0))).rejects.toThrow();
 const file=path.join(folder,'assets/audio/large.wav'),handle=await fs.open(file,'wx');await handle.truncate(64*1024*1024+1);await handle.close();await expect(store.readAudio('assets/audio/large.wav')).rejects.toThrow(/limits/);
});
it('honors pre-cancelled reads and writes without publishing a destination',async()=>{
 const {store,folder}=await fixture(),controller=new AbortController();controller.abort();await expect(store.writeNewAudio('assets/audio/test.wav',wav(),controller.signal)).rejects.toThrow();await expect(store.readAudio('assets/audio/test.wav',controller.signal)).rejects.toThrow();expect(await fs.readdir(path.join(folder,'assets/audio'))).toEqual([]);
});
it('preserves a completed asset when manifest publication later conflicts',async()=>{
 const {store}=await fixture(),project=newProject();await saveProject(store,project,null);await store.writeNewAudio('assets/audio/test.wav',wav());project.assets=[{id:'a',path:'assets/audio/test.wav',audio:{name:'Test',format:'pcm16-wav',sampleRate:8000,channels:1,frames:3}}];
 await expect(saveProject(store,project,null)).rejects.toThrow(/changed on disk/);expect((await loadProject(store)).project.assets).toEqual([]);expect(await store.readAudio('assets/audio/test.wav')).toEqual(wav());
});

it('aborts after staging bytes but before publication and removes only its temporary file',async()=>{
 const {store,folder}=await fixture(),controller=new AbortController(),open=fs.open.bind(fs);
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{
  const handle=await open(...args);
  if(String(args[0]).endsWith('.tmp')){const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();controller.abort();};}
  return handle;
 });
 try{await expect(store.writeNewAudio('assets/audio/test.wav',wav(),controller.signal)).rejects.toThrow();}finally{spy.mockRestore();}
 expect(await fs.readdir(path.join(folder,'assets/audio'))).toEqual([]);
});

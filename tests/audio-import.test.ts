import {expect,it,vi} from 'vitest';
import {newProject,clone} from '../packages/document/src';
import {pcm16WavFixture} from './wav-fixture';
vi.mock('../packages/audio/src/wav-async',async()=>{const {decodePcm16Wav}=await import('../packages/audio/src/wav');return {decodePcm16WavAsync:vi.fn(async(bytes,options)=>decodePcm16Wav(bytes,options))};});
import {prepareAudioImport,persistAudioImport,AudioImportPersistenceError} from '../packages/audio/src/import';
const bytes=()=>pcm16WavFixture([[0,16384,-32768]]);
const file=()=>new Blob([bytes()]);
it('prepares admitted metadata and immutable bytes without implicit clips or source mutation',async()=>{
 const project=newProject(),before=clone(project),result=await prepareAudioImport(project,file(),'Sound');
 expect(project).toEqual(before);expect(result.baseSignature).toBe(JSON.stringify(before));expect(result.nextProject.audioClips).toBeUndefined();
 expect(result.nextProject.assets[0]).toEqual({id:result.assetId,path:result.path,audio:{name:'Sound',format:'pcm16-wav',sampleRate:8000,channels:1,frames:3}});
 expect(new Uint8Array(await result.payload.arrayBuffer())).toEqual(bytes());result.nextProject.name='changed';expect(project).toEqual(before);
});
it('detaches clip options and rejects invalid offsets before returning any candidate',async()=>{
 const project=newProject(),clip={startFrame:2,offsetSamples:1,gain:-0.5};const pending=prepareAudioImport(project,file(),'Sound',{clip});clip.gain=9;
 const result=await pending;expect(result.nextProject.audioClips![0].gain).toBe(-0.5);expect(result.nextProject.audioClips![0].assetId).toBe(result.assetId);
 await expect(prepareAudioImport(project,file(),'Sound',{clip:{...clip,offsetSamples:4}})).rejects.toThrow(/timing/);expect(project.assets).toEqual([]);
});
it('rejects original values, format and admission budgets without changing the project',async()=>{
 const project=newProject(),arrayBuffer=vi.fn();
 await expect(prepareAudioImport(project,{size:64*1024*1024+1,arrayBuffer} as unknown as Blob,'Sound')).rejects.toThrow(/64 MiB/);expect(arrayBuffer).not.toHaveBeenCalled();
 project.fps=NaN;await expect(prepareAudioImport(project,file(),'Sound')).rejects.toThrow();expect(Number.isNaN(project.fps)).toBe(true);
 await expect(prepareAudioImport(newProject(),new Blob([new Uint8Array(44)]),'Sound')).rejects.toThrow(/RIFF/);
 const full=newProject();full.assets=[{id:'full',path:'assets/audio/full.wav',audio:{name:'full',format:'pcm16-wav',sampleRate:8000,channels:1,frames:33554431}}];
 await expect(prepareAudioImport(full,file(),'Sound')).rejects.toThrow();expect(full.assets.length).toBe(1);
});
it('cancels or times out pending reads and allows a clean retry',async()=>{
 const controller=new AbortController();let release!:(b:ArrayBuffer)=>void;
 const delayed={size:50,arrayBuffer:()=>new Promise<ArrayBuffer>(resolve=>{release=resolve;})} as Blob;
 const run=prepareAudioImport(newProject(),delayed,'Sound',{signal:controller.signal});controller.abort();await expect(run).rejects.toThrow();release(bytes().buffer);await Promise.resolve();
 await expect(prepareAudioImport(newProject(),{size:50,arrayBuffer:()=>new Promise(()=>{})} as Blob,'Sound',{timeoutMs:5})).rejects.toThrow(/timed out/);
 expect((await prepareAudioImport(newProject(),file(),'Sound')).nextProject.assets.length).toBe(1);
});

it('persists admitted bytes before returning a detached publishable candidate',async()=>{
 const project=newProject(),prepared=await prepareAudioImport(project,file(),'Sound'),writeNewAudio=vi.fn(async()=>{});
 const result=await persistAudioImport(prepared,{writeNewAudio},()=>project);
 expect(writeNewAudio).toHaveBeenCalledWith(prepared.path,bytes(),undefined);expect(project.assets).toEqual([]);
 expect(result.nextProject).toEqual(prepared.nextProject);result.nextProject.name='other';expect(prepared.nextProject.name).not.toBe('other');
 await expect(persistAudioImport(prepared,{writeNewAudio},()=>project)).rejects.toThrow(/consumed/);expect(writeNewAudio).toHaveBeenCalledTimes(1);
});
it('rejects forged, modified and stale preparations before storage',async()=>{
 const project=newProject(),prepared=await prepareAudioImport(project,file(),'Sound'),writeNewAudio=vi.fn(async()=>{});
 await expect(persistAudioImport({...prepared},{writeNewAudio},()=>project)).rejects.toThrow(/unknown/);
 prepared.nextProject.name='modified';await expect(persistAudioImport(prepared,{writeNewAudio},()=>project)).rejects.toThrow(/changed/);
 const fresh=await prepareAudioImport(project,file(),'Sound');project.name='new state';await expect(persistAudioImport(fresh,{writeNewAudio},()=>project)).rejects.toThrow(/project changed/);expect(writeNewAudio).not.toHaveBeenCalled();
});
it('reports possible orphan assets on stale completion, cancellation and storage failures',async()=>{
 for(const mode of ['stale','cancel','failure']){
  const project=newProject(),controller=new AbortController(),prepared=await prepareAudioImport(project,file(),'Sound');
  const writeNewAudio=vi.fn(async()=>{if(mode==='stale')project.name='changed';if(mode==='cancel')controller.abort();if(mode==='failure')throw new Error('disk failure');});
  const error=await persistAudioImport(prepared,{writeNewAudio},()=>project,controller.signal).catch(e=>e);
  expect(error).toBeInstanceOf(AudioImportPersistenceError);expect(error.assetMayExist).toBe(true);expect(error.path).toBe(prepared.path);expect(error.cause).toBeDefined();expect(project.assets).toEqual([]);
  await expect(persistAudioImport(prepared,{writeNewAudio},()=>project)).rejects.toThrow(/consumed/);
 }
});
it('allows only one persistence invocation while retaining stale guards during writes',async()=>{
 const project=newProject(),prepared=await prepareAudioImport(project,file(),'Sound');let release!:()=>void;
 const writeNewAudio=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
 const first=persistAudioImport(prepared,{writeNewAudio},()=>project);
 await vi.waitFor(()=>expect(writeNewAudio).toHaveBeenCalledTimes(1));
 await expect(persistAudioImport(prepared,{writeNewAudio},()=>project)).rejects.toThrow(/consumed/);
 prepared.nextProject.name='changed during write';release();await expect(first).rejects.toBeInstanceOf(AudioImportPersistenceError);expect(project.assets).toEqual([]);
});
it('pre-cancellation never invokes storage or consumes admission',async()=>{
 const project=newProject(),prepared=await prepareAudioImport(project,file(),'Sound'),controller=new AbortController(),writeNewAudio=vi.fn(async()=>{});controller.abort();
 await expect(persistAudioImport(prepared,{writeNewAudio},()=>project,controller.signal)).rejects.toThrow();expect(writeNewAudio).not.toHaveBeenCalled();
 await persistAudioImport(prepared,{writeNewAudio},()=>project);expect(writeNewAudio).toHaveBeenCalledTimes(1);
});

it('persists preparation through the actual directory store before manifest save/load',async()=>{
 const {promises:fs}=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const {NodeDirectoryStore,createDirectory}=await import('../packages/document/src/node-store');
 const {saveProject,loadProject}=await import('../packages/document/src/storage');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'splash-admitted-import-'));
 try{
  const folder=path.join(root,'Import.spl');await createDirectory(folder);const store=new NodeDirectoryStore(folder),project=newProject();
  const prepared=await prepareAudioImport(project,file(),'Sound',{clip:{startFrame:1,offsetSamples:1,gain:0.5}});
  const persisted=await persistAudioImport(prepared,store,()=>project);
  expect(await store.readAudio(persisted.path)).toEqual(bytes());expect(project.assets).toEqual([]);
  await saveProject(store,persisted.nextProject,null);const loaded=await loadProject(store);
  expect(loaded.missingAssets).toEqual([]);expect(loaded.project).toEqual(persisted.nextProject);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

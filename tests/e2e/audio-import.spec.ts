import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {newProject,type Project} from '../../packages/document/src';
import {decodePcm16Wav} from '../../packages/audio/src/wav';
import {pcm16WavFixture} from '../wav-fixture';
async function saved(page:Page){
 await page.goto('/');await page.getByLabel('Drawing stage').focus();await page.keyboard.press('Control+s');
 const folder=`Audio-import-${Date.now()}.spl`;await page.getByLabel('Project name').fill(folder.slice(0,-4));await page.getByRole('button',{name:'Save project folder',exact:true}).click();await expect(page.getByText('Saved to folder',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Import audio...',exact:true}).click();return folder;
}
const wav=()=>({name:'sample.wav',mimeType:'audio/wav',buffer:Buffer.from(pcm16WavFixture([[0,16384,-32768]]))});
const recovery=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('splash-recovery-v1')??'null')?.project??null);
test('imports real MP3 and Opus into editable timeline audio',async({page})=>{
 const license=process.env.SPLASH_TEST_LICENSE;
 test.skip(!license,'Run with the isolated licensing fixture.');
 const project=newProject(),folder='C:/SplashTests/Compressed.spl';
 await page.addInitScript(({license,project,folder})=>{
  if(window!==window.top)return;
  localStorage.setItem('splash-recovery-v1',JSON.stringify({project,folder,manifest:null}));
  const audio=new Map<string,Uint8Array>();
  Reflect.set(window,'importedAudio',audio);
  Reflect.set(window,'__TAURI_INTERNALS__',{
   metadata:{currentWindow:{label:'main'}},
   invoke:async(command:string,args?:unknown)=>{
    if(command==='read_license')return license;
    if(command==='project_operation')
     return (args as {request:{op:string}}).request.op==='select'?folder:false;
    if(command==='project_audio_write'){
     const bytes=new Uint8Array(args as ArrayBuffer),end=4+new DataView(bytes.buffer).getUint32(0,true);
     const owner=JSON.parse(new TextDecoder().decode(bytes.subarray(4,end)));
     if(owner.project!==folder||audio.has(owner.path))throw Error('Invalid test asset write.');
     audio.set(owner.path,bytes.slice(end));
     return null;
    }
    if(command==='project_audio_read'){
     const owner=(args as {owner:{project:string;path:string}}).owner;
     if(owner.project!==folder||!audio.has(owner.path))throw Error('Missing test WAV.');
     return audio.get(owner.path)!.slice().buffer;
    }
    return null;
   },
  });
 },{license,project,folder});
 await page.goto('/');
 const splash=page.getByRole('button',{name:'Open editor',exact:true});
 const recover=page.getByRole('button',{name:'Recover changes',exact:true});
 await expect(splash.or(recover).first()).toBeVisible();
 if(await splash.isVisible())await splash.click();
 await recover.click();
 const control=page.getByRole('button',{name:'Control',exact:true});
 const dialog=page.getByRole('dialog',{name:'Import audio',exact:true});
 const open=async()=>{await control.click();await page.getByRole('button',{name:'Import audio...',exact:true}).click();};
 const input=dialog.getByLabel('Audio file');
 const submit=dialog.getByRole('button',{name:'Import audio asset',exact:true});
 const writes=()=>page.evaluate(()=>[...(Reflect.get(window,'importedAudio') as Map<string,Uint8Array>).keys()]);
 await open();
 await input.setInputFiles({name:'broken.opus',mimeType:'audio/ogg',buffer:Buffer.alloc(44)});
 await submit.click();
 await expect(dialog.getByRole('alert')).toContainText('Ogg Opus');
 expect(await writes()).toEqual([]);
 for(const [format,channels] of [['mp3',1],['opus',2]] as const){
  const file=await readFile(new URL(`../fixtures/import-tone.${format}`,import.meta.url));
  if(format==='opus'){
   await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
   await page.getByRole('group',{name:'Library browser',exact:true}).evaluate((library,bytes)=>{
    const dataTransfer=new DataTransfer();
    dataTransfer.items.add(new File([Uint8Array.from(bytes)],'tone.opus',{type:'audio/ogg'}));
    library.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
   },[...file]);
   await expect(dialog.getByText('Selected: tone.opus', { exact: true })).toBeVisible();
  }else{
   await input.setInputFiles({name:'tone.mp3',mimeType:'audio/mpeg',buffer:file});
   await page.evaluate(()=>{
    const original=OfflineAudioContext.prototype.decodeAudioData;
    OfflineAudioContext.prototype.decodeAudioData=function(this:OfflineAudioContext,bytes:ArrayBuffer){
     OfflineAudioContext.prototype.decodeAudioData=original;
     const native=original.call(this,bytes);
     return new Promise<AudioBuffer>((resolve,reject)=>{
      Reflect.set(window,'finishImportDecode',async()=>{await native.then(resolve,reject);});
     });
    };
   });
   await submit.click();
   await expect.poll(()=>page.evaluate(()=>typeof Reflect.get(window,'finishImportDecode'))).toBe('function');
   await dialog.getByRole('button',{name:'Cancel audio import'}).click();
   await expect(submit).toBeEnabled();
   await page.evaluate(()=>Reflect.get(window,'finishImportDecode')());
   expect(await writes()).toEqual([]);
  }
  await submit.click();
  await expect(dialog.getByRole('status')).toContainText('Audio asset imported.');
  const loaded=await recovery(page) as Project;
  const asset=loaded.assets.at(-1)!;
  expect(asset.path).toMatch(/^assets\/audio\/.+\.wav$/);
  expect(asset.audio).toMatchObject({name:`tone.${format}`,format:'pcm16-wav',channels,sampleRate:48000,frames:11520});
  expect(loaded.audioClips).toBeUndefined();
  const stored=await page.evaluate(path=>Array.from((Reflect.get(window,'importedAudio') as Map<string,Uint8Array>).get(path)!),asset.path);
  const wav=decodePcm16Wav(Uint8Array.from(stored));
  expect(wav.frames).toBe(11520);
  expect(wav.channels).toHaveLength(channels);
  expect(wav.channels[0].subarray(1000,6000).some(n=>Math.abs(n)>0.07)).toBe(true);
 }
 await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 const stage=page.getByLabel('Drawing stage',{exact:true});
 await stage.press('Control+z');
 await expect.poll(async()=>(await recovery(page) as Project).assets.length).toBe(1);
 await stage.press('Control+Shift+z');
 await expect.poll(async()=>(await recovery(page) as Project).assets.length).toBe(2);
 await control.click();
 await page.getByRole('button',{name:'Edit audio clips...',exact:true}).click();
 await page.getByRole('button',{name:'Add audio clip',exact:true}).click();
 const assets=(await recovery(page) as Project).assets;
 await page.getByLabel('Clip 1 asset').selectOption(assets[1].id);
 await page.getByRole('button',{name:'Apply audio clips',exact:true}).click();
 await expect.poll(async()=>(await recovery(page) as Project).audioClips?.[0]?.assetId).toBe(assets[1].id);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await control.click();
 await page.getByRole('button',{name:'Preview saved audio...',exact:true}).click();
 await page.getByLabel('Use project folder WAV files').check();
 await page.getByRole('button',{name:'Prepare audio',exact:true}).click();
 await expect(page.getByText(/Audio prepared. Playback starts/)).toBeVisible();
});
test('imports a WAV through real workers and storage with undo redo and saved metadata',async({page})=>{
 const folder=await saved(page);const before={assets:[]};await page.getByLabel('Audio file').setInputFiles(wav());await page.getByRole('button',{name:'Import audio asset',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Audio asset imported.'})).toBeVisible();
 const after=await recovery(page);expect(after.assets.length).toBe(before.assets.length+1);expect(after.assets.at(-1).audio.frames).toBe(3);expect(after.audioClips).toBeUndefined();
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByLabel('Drawing stage').focus();await page.keyboard.press('Control+z');expect((await recovery(page)).assets).toEqual(before.assets);await page.keyboard.press('Control+Shift+z');expect((await recovery(page)).assets).toEqual(after.assets);
 await page.keyboard.press('Control+s');await expect(page.getByText('Saved to folder',{exact:true})).toBeVisible();
 const manifest=await page.evaluate(async(folder)=>{return await (await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'read',project:folder,path:'project.json'})})).json();},folder);expect(JSON.parse(manifest.result).document.assets).toEqual(after.assets);
});
test('invalid WAV and cancelled upload leave history unchanged and permit retry',async({page})=>{
 await saved(page);const before=await recovery(page);await page.getByLabel('Audio file').setInputFiles({name:'bad.wav',mimeType:'audio/wav',buffer:Buffer.alloc(44)});await page.getByRole('button',{name:'Import audio asset',exact:true}).click();await expect(page.getByRole('alert')).toContainText('RIFF');expect(await recovery(page)).toEqual(before);
 let seen=false;await page.route('**/api/audio-assets',async route=>{seen=true;await new Promise(resolve=>setTimeout(resolve,300));await route.abort();});
 await page.getByLabel('Audio file').setInputFiles(wav());await page.getByRole('button',{name:'Import audio asset',exact:true}).click();await expect.poll(()=>seen).toBe(true);await page.getByRole('button',{name:'Cancel audio import',exact:true}).click();await expect(page.getByRole('alert')).toContainText('unreferenced asset');expect(await recovery(page)).toEqual(before);
 await page.unroute('**/api/audio-assets');await page.getByRole('button',{name:'Import audio asset',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Audio asset imported.'})).toBeVisible();
});

test('closing an upload prevents late publication and reopening starts clean',async({page})=>{
 await saved(page);let seen=false;await page.route('**/api/audio-assets',async route=>{seen=true;await new Promise(resolve=>setTimeout(resolve,250));await route.abort();});
 await page.getByLabel('Audio file').setInputFiles(wav());await page.getByRole('button',{name:'Import audio asset',exact:true}).click();await expect.poll(()=>seen).toBe(true);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('button',{name:'Control',exact:true}).click();await expect(page.getByRole('button',{name:'Import audio...',exact:true})).toBeEnabled();expect(await recovery(page)).toBeNull();await page.getByRole('button',{name:'Import audio...',exact:true}).click();await expect(page.getByRole('button',{name:'Import audio asset',exact:true})).toBeDisabled();
});

test('saved preview explicitly resolves folder WAVs and source changes invalidate preparation',async({page})=>{
 await saved(page);await page.getByLabel('Audio file').setInputFiles(wav());await page.getByRole('button',{name:'Import audio asset',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Audio asset imported.'})).toBeVisible();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Edit audio clips...',exact:true}).click();await page.getByRole('button',{name:'Add audio clip',exact:true}).click();await page.getByRole('button',{name:'Apply audio clips',exact:true}).click();await page.getByRole('button',{name:'Close dialog',exact:true}).click();const before=await recovery(page);
 await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Preview saved audio...',exact:true}).click();await expect(page.getByRole('button',{name:'Prepare audio',exact:true})).toBeDisabled();await page.getByLabel('Use project folder WAV files').check();await page.getByRole('button',{name:'Prepare audio',exact:true}).click();await expect(page.getByText(/Audio prepared. Playback starts/)).toBeVisible();await expect(page.getByText(/Peak 1.000/)).toBeVisible();await expect(page.getByRole('button',{name:'Stop audio',exact:true})).toBeDisabled();expect(await recovery(page)).toEqual(before);
 await page.getByLabel('Use project folder WAV files').uncheck();await expect(page.getByRole('button',{name:'Play audio',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Prepare audio',exact:true})).toBeDisabled();
 await page.getByLabel('Use project folder WAV files').check();await page.route('**/api/audio-assets',route=>route.fulfill({status:404,body:'missing'}));await page.getByRole('button',{name:'Prepare audio',exact:true}).click();await expect(page.getByRole('alert')).toContainText('missing');expect(await recovery(page)).toEqual(before);await page.unroute('**/api/audio-assets');await page.getByRole('button',{name:'Prepare audio',exact:true}).click();await expect(page.getByText(/Audio prepared. Playback starts/)).toBeVisible();
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'Control',exact:true}).click();await page.getByRole('button',{name:'Preview saved audio...',exact:true}).click();await expect(page.getByLabel('Use project folder WAV files')).not.toBeChecked();
});

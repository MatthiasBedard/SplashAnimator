import {expect,it,vi} from 'vitest';
import {newProject,clone} from '../packages/document/src';
import {pcm16WavFixture} from './wav-fixture';
vi.mock('../packages/audio/src/wav-async',async()=>{const {decodePcm16Wav}=await import('../packages/audio/src/wav');return {decodePcm16WavAsync:vi.fn(async(bytes,options)=>decodePcm16Wav(bytes,options))};});
vi.mock('../packages/audio/src/pcm-async',async()=>{const {mixTimelinePcm}=await import('../packages/audio/src/pcm');return {mixTimelinePcmAsync:vi.fn(async(clips,options)=>mixTimelinePcm(clips,options))};});
vi.mock('../packages/audio/src/resample',()=>({resamplePcm:vi.fn(async(channels:Float32Array[],sourceRate:number,targetRate:number)=>({channels:channels.map(c=>Float32Array.from({length:Math.round(c.length*targetRate/sourceRate)},(_,i)=>c[Math.min(c.length-1,Math.floor(i*sourceRate/targetRate))])),sampleRate:targetRate,frames:Math.round(channels[0].length*targetRate/sourceRate),peak:0.5,clippedSamples:0}))}));
import {resamplePcm} from '../packages/audio/src/resample';
import {prepareProjectAudio} from '../packages/audio/src/project-preview';
const fixture=()=>{const p=newProject();p.fps=100;p.duration=2;p.assets=[{id:'a',path:'assets/audio/a.wav',audio:{name:'A',format:'pcm16-wav',sampleRate:8000,channels:1,frames:160}}];p.audioClips=[{id:'c',assetId:'a',startFrame:0,offsetSamples:0,gain:1}];return p;};
const blob=()=>new Blob([pcm16WavFixture([Array(160).fill(16384)])]);
it('loads each reference once and mixes detached original clips in order',async()=>{
 const p=fixture();p.audioClips!.push({...p.audioClips![0],id:'d',gain:0.5});const before=clone(p);
 const load=vi.fn(async()=>{p.audioClips![0].gain=0;return blob();});
 const result=await prepareProjectAudio(p,load);expect(load).toHaveBeenCalledTimes(1);expect(result.channels[0][0]).toBe(0.75);expect(result.channels[0].length).toBe(160);expect(p.assets).toEqual(before.assets);
});
it('rejects incompatible formats and original invalid values before reading files',async()=>{
 const p=fixture(),load=vi.fn(async()=>blob());p.assets.push({...clone(p.assets[0]),id:'b',path:'assets/audio/b.wav',audio:{...p.assets[0].audio!,sampleRate:16000}});p.audioClips!.push({...p.audioClips![0],id:'d',assetId:'b'});
 await expect(prepareProjectAudio(p,load)).rejects.toThrow(/matching/);expect(load).not.toHaveBeenCalled();p.audioClips![0].gain=NaN;await expect(prepareProjectAudio(p,load)).rejects.toThrow();expect(load).not.toHaveBeenCalled();
});
it('checks decoded metadata and missing files before publishing any mix',async()=>{
 const p=fixture();p.assets[0].audio!.frames=161;
 await expect(prepareProjectAudio(p,async()=>blob())).rejects.toThrow(/metadata mismatch/);
 await expect(prepareProjectAudio(fixture(),async()=>{throw Error('Missing WAV');})).rejects.toThrow('Missing WAV');
});
it('rejects oversized encoded admission before allocating bytes',async()=>{
 const arrayBuffer=vi.fn();await expect(prepareProjectAudio(fixture(),async()=>({size:64*1024*1024+1,arrayBuffer}) as unknown as Blob)).rejects.toThrow(/budget/);expect(arrayBuffer).not.toHaveBeenCalled();
});
it('cancels a pending loader, ignores its late result and permits retry',async()=>{
 const controller=new AbortController();let release!:(value:Blob)=>void;let captured!:AbortSignal;
 const run=prepareProjectAudio(fixture(),async(_path,signal)=>{captured=signal;return new Promise(resolve=>{release=resolve;});},{signal:controller.signal});
 controller.abort();await expect(run).rejects.toThrow();expect(captured.aborted).toBe(true);release(blob());await Promise.resolve();
 expect((await prepareProjectAudio(fixture(),async()=>blob())).channels[0][0]).toBe(0.5);
});
it('times out idle loading and uses absolute selected sample boundaries',async()=>{
 await expect(prepareProjectAudio(fixture(),async()=>new Promise(()=>{}),{timeoutMs:5})).rejects.toThrow(/timed out/);
 const result=await prepareProjectAudio(fixture(),async()=>blob(),{startFrame:1,endFrame:2});expect(result.startSample).toBe(80);expect(result.endSample).toBe(160);expect(result.channels[0].length).toBe(80);
});

it('explicit output channels admit mixed mono/stereo while retaining actual metadata checks',async()=>{
 const p=fixture();p.assets.push({...clone(p.assets[0]),id:'b',path:'assets/audio/b.wav',audio:{...p.assets[0].audio!,channels:2}});p.audioClips!.push({...p.audioClips![0],id:'d',assetId:'b'});
 const load=vi.fn(async(path:string)=>path.endsWith('b.wav')?new Blob([pcm16WavFixture([Array(160).fill(8192),Array(160).fill(-8192)])]):blob());
 await expect(prepareProjectAudio(p,load)).rejects.toThrow(/matching/);expect(load).not.toHaveBeenCalled();
 await expect(prepareProjectAudio(p,load,{channelCount:null as unknown as 1})).rejects.toThrow(/output channels/);expect(load).not.toHaveBeenCalled();
 const stereo=await prepareProjectAudio(p,load,{channelCount:2});expect(stereo.channels.map(c=>c[0])).toEqual([0.75,0.25]);
 const mono=await prepareProjectAudio(p,load,{channelCount:1});expect(mono.channels.map(c=>c[0])).toEqual([0.5]);
 await expect(prepareProjectAudio(p,async()=>blob(),{channelCount:1})).rejects.toThrow(/metadata mismatch/);
});

it('uses saved fades without restarting them for selected ranges',async()=>{
 const p=fixture();p.audioClips![0].fadeInSamples=160;p.audioClips![0].fadeOutSamples=80;
 const full=await prepareProjectAudio(p,async()=>blob()),part=await prepareProjectAudio(p,async()=>blob(),{startFrame:1,endFrame:2});expect(full.channels[0][0]).toBe(0);expect(full.channels[0][159]).toBe(0);expect(full.channels[0][80]).toBeCloseTo(0.5*80/159);expect(part.channels[0]).toEqual(full.channels[0].slice(80));
});

it('explicit target rate converts each unique asset once and maps offset/fade boundaries',async()=>{
 const p=fixture();p.audioClips![0].offsetSamples=40;p.audioClips![0].fadeInSamples=80;p.audioClips![0].fadeOutSamples=40;
 p.audioClips!.push({...p.audioClips![0],id:'second',gain:0.5});vi.mocked(resamplePcm).mockClear();
 const result=await prepareProjectAudio(p,async()=>blob(),{sampleRate:16000});expect(resamplePcm).toHaveBeenCalledTimes(1);expect(result.channels[0].length).toBe(320);expect(result.channels[0][0]).toBe(0);expect(result.channels[0][159]).toBe(0.75);expect(result.channels[0][239]).toBe(0);expect(result.resampling).toEqual({assets:1,peak:0.5,clippedSamples:0});
 const selected=await prepareProjectAudio(p,async()=>blob(),{sampleRate:16000,startFrame:1,endFrame:2});expect(selected.channels[0]).toEqual(result.channels[0].slice(160));
});
it('rejects converted aggregate budgets and invalid explicit rates before loading',async()=>{
 const p=fixture(),load=vi.fn(async()=>blob());p.assets[0].audio!.frames=2000000;
 await expect(prepareProjectAudio(p,load,{sampleRate:192000})).rejects.toThrow(/converted PCM budget/);
 for(const sampleRate of [null,NaN,0,8000.5,192001])await expect(prepareProjectAudio(fixture(),load,{sampleRate:sampleRate as number})).rejects.toThrow();expect(load).not.toHaveBeenCalled();
});
it('keeps original metadata checking for explicitly resampled sources',async()=>{
 const p=fixture();p.assets[0].audio!.sampleRate=16000;await expect(prepareProjectAudio(p,async()=>blob(),{sampleRate:8000})).rejects.toThrow(/metadata mismatch/);
});

it('maps fade endpoint boundaries without a one-sample remainder overflow',async()=>{
 const p=fixture();p.audioClips![0].offsetSamples=1;p.audioClips![0].fadeInSamples=159;
 const result=await prepareProjectAudio(p,async()=>blob(),{sampleRate:11025});expect(result.channels[0].length).toBe(221);expect(result.channels[0][0]).toBe(0);expect(result.channels[0][219]).toBe(0.5);expect(result.channels[0][220]).toBe(0);
});

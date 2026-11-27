import {validateProject,type Project} from '../../document/src';
import {audioSampleRange,type TimelinePcmClip} from './pcm';
import {decodePcm16WavAsync} from './wav-async';
import {mixTimelinePcmAsync} from './pcm-async';

export interface ProjectAudioJob {signal?:AbortSignal;timeoutMs?:number;startFrame?:number;endFrame?:number;channelCount?:1|2;sampleRate?:number}
/** Loader must honor the signal where possible. Late results are ignored; no playback or writes.
 * Only referenced assets load, once each, serially. Blob admission precedes byte allocation.
 * The mix covers the half-open frame range [startFrame, endFrame).
 */
export async function prepareProjectAudio(project:Project,load:(path:string,signal:AbortSignal)=>Promise<Blob>,job:ProjectAudioJob={}){
  const {signal,timeoutMs=10000}=job;
  signal?.throwIfAborted();
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid project audio deadline.');
  const snapshot=validateProject(project),clips=snapshot.audioClips??[];
  if(!clips.length)throw new Error('Project has no audio clips.');
  const assets=new Map(snapshot.assets.map(a=>[a.id,a]));
  const first=assets.get(clips[0].assetId)!.audio!;
  const channelCount=job.channelCount===undefined?first.channels:job.channelCount,convertChannels=job.channelCount!==undefined;
  if(channelCount!==1&&channelCount!==2)throw new Error('Invalid project audio output channels.');
  const sampleRate=job.sampleRate===undefined?first.sampleRate:job.sampleRate;
  const startFrame=job.startFrame??0,endFrame=job.endFrame??snapshot.duration;
  const range=audioSampleRange(startFrame,endFrame,snapshot.fps,sampleRate);
  if(endFrame>snapshot.duration||(range.end-range.start)*channelCount*4>128*1024*1024)throw new Error('Project audio range exceeds limits.');
  const admitted=new Set<string>();let convertedBytes=0;
  for(const clip of clips){const a=assets.get(clip.assetId)!.audio!;
    if((job.sampleRate===undefined&&a.sampleRate!==first.sampleRate)||(!convertChannels&&a.channels!==first.channels))throw new Error('Project audio requires matching sample rates and channels.');
    if(!admitted.has(clip.assetId)){admitted.add(clip.assetId);const frames=Math.round(a.frames*sampleRate/a.sampleRate);convertedBytes+=frames*a.channels*4;if(!Number.isSafeInteger(frames)||frames<1||convertedBytes>128*1024*1024)throw new Error('Project converted PCM budget exceeded.');}
  }
  const controller=new AbortController(),deadline=Date.now()+timeoutMs;
  const abort=()=>controller.abort(signal?.reason??new DOMException('Audio preparation cancelled.','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new Error('Project audio preparation timed out.')),timeoutMs);
  const wait=<T>(promise:Promise<T>)=>new Promise<T>((resolve,reject)=>{
    const stop=()=>reject(controller.signal.reason);
    controller.signal.addEventListener('abort',stop,{once:true});
    promise.then(value=>{controller.signal.removeEventListener('abort',stop);if(controller.signal.aborted)reject(controller.signal.reason);else resolve(value);},error=>{controller.signal.removeEventListener('abort',stop);reject(error);});
    if(controller.signal.aborted)stop();
  });
  const remaining=()=>{controller.signal.throwIfAborted();const n=deadline-Date.now();if(n<1)throw new Error('Project audio preparation timed out.');return n;};
  try{
    if(signal?.aborted)abort();
    const resampling={assets:0,peak:0,clippedSamples:0};
    const decoded=new Map<string,Awaited<ReturnType<typeof decodePcm16WavAsync>>>();let encodedBytes=0;
    for(const clip of clips){
      if(decoded.has(clip.assetId))continue;
      remaining();const asset=assets.get(clip.assetId)!,metadata=asset.audio!;
      const blob=await wait(load(asset.path,controller.signal));
      if(!Number.isSafeInteger(blob.size)||blob.size<12||blob.size>64*1024*1024||encodedBytes+blob.size>128*1024*1024)throw new Error('Project audio encoded byte budget exceeded.');
      encodedBytes+=blob.size;
      const bytes=new Uint8Array(await wait(blob.arrayBuffer()));
      if(bytes.length!==blob.size)throw new Error('Project audio file size changed.');
      const result=await wait(decodePcm16WavAsync(bytes,{signal:controller.signal,timeoutMs:remaining(),maxPcmBytes:metadata.frames*metadata.channels*4}));
      if(result.sampleRate!==metadata.sampleRate||result.frames!==metadata.frames||result.channels.length!==metadata.channels)throw new Error(`Audio metadata mismatch: ${asset.path}`);
      if(result.sampleRate!==sampleRate){
        const {resamplePcm}=await import('./resample');remaining();
        const converted=await wait(resamplePcm(result.channels,result.sampleRate,sampleRate,{signal:controller.signal,timeoutMs:remaining()}));
        resampling.assets++;resampling.peak=Math.max(resampling.peak,converted.peak);resampling.clippedSamples+=converted.clippedSamples;decoded.set(asset.id,converted);
      }else decoded.set(asset.id,result);
    }
    const sources:TimelinePcmClip[]=clips.map(clip=>{
      const metadata=assets.get(clip.assetId)!.audio!,map=(sample:number)=>Math.round(sample*sampleRate/metadata.sampleRate),offsetSamples=map(clip.offsetSamples);
      return {...clip,offsetSamples,
        fadeInSamples:clip.fadeInSamples===undefined?undefined:map(clip.offsetSamples+clip.fadeInSamples)-offsetSamples,
        fadeOutSamples:clip.fadeOutSamples===undefined?undefined:map(metadata.frames)-map(metadata.frames-clip.fadeOutSamples),
        channels:decoded.get(clip.assetId)!.channels,sampleRate};
    });
    const mixed=await wait(mixTimelinePcmAsync(sources,{startFrame,endFrame,fps:snapshot.fps,sampleRate,channelCount,convertChannels},{signal:controller.signal,timeoutMs:remaining()}));
    return {...mixed,resampling};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}

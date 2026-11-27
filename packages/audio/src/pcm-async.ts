import {audioSampleRange,type TimelinePcmClip,type TimelinePcmOptions,mixTimelinePcm} from './pcm';
export interface PcmWorkerOptions {signal?:AbortSignal;timeoutMs?:number;maxInputBytes?:number}
type PcmResult=ReturnType<typeof mixTimelinePcm>;
/** Trusted disposable worker, never a source-code runtime. Input buffers clone without detachment.
 * Backing-buffer admission bounds structured-clone input; copy/output validation remains synchronous.
 */
export async function mixTimelinePcmAsync(clips:readonly TimelinePcmClip[],settings:TimelinePcmOptions,job:PcmWorkerOptions={}):Promise<PcmResult>{
  const {signal,timeoutMs=10000,maxInputBytes=128*1024*1024}=job;
  signal?.throwIfAborted();
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('Invalid audio worker deadline.');
  if(!Number.isSafeInteger(maxInputBytes)||maxInputBytes<1||maxInputBytes>128*1024*1024)throw new Error('Invalid audio input budget.');
  const options={convertChannels:settings.convertChannels===undefined?false:settings.convertChannels,startFrame:settings.startFrame,endFrame:settings.endFrame,fps:settings.fps,sampleRate:settings.sampleRate,channelCount:settings.channelCount,maxBytes:settings.maxBytes??128*1024*1024,maxWorkSamples:settings.maxWorkSamples??50000000};
  if(typeof options.convertChannels!=='boolean')throw new Error('Invalid channel conversion option.');
  const range=audioSampleRange(options.startFrame,options.endFrame,options.fps,options.sampleRate),length=range.end-range.start;
  if((options.channelCount!==1&&options.channelCount!==2)||!Number.isSafeInteger(options.maxBytes)||options.maxBytes<1||options.maxBytes>128*1024*1024||length*options.channelCount*4>options.maxBytes||
    !Number.isSafeInteger(options.maxWorkSamples)||options.maxWorkSamples<1||options.maxWorkSamples>50000000)throw new Error('Invalid audio output or work budget.');
  if(!Array.isArray(clips)||clips.length>10000)throw new Error('Audio requires at most 10000 clips.');
  const tag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype),Symbol.toStringTag)!.get!;
  const byteLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
  const seen=new Set<ArrayBuffer>();let inputBytes=0;
  const snapshot=clips.map(clip=>{
    if(!clip||!Array.isArray(clip.channels)||(clip.channels.length!==options.channelCount&&(!options.convertChannels||(clip.channels.length!==1&&clip.channels.length!==2))))throw new Error('Invalid audio clip channels.');
    const channels=[...clip.channels];
    for(const channel of channels){
      if(tag.call(channel)!=='Float32Array')throw new Error('Audio input requires Float32 PCM.');
      let size:number;try{size=byteLength.call(channel.buffer);}catch{throw new Error('Audio input requires nonshared buffers.');}
      if(!size||!channel.length)throw new Error('Audio input is empty or detached.');
      if(!seen.has(channel.buffer)){seen.add(channel.buffer);inputBytes+=size;}
      if(inputBytes>maxInputBytes)throw new Error('Audio input exceeds the clone byte budget.');
    }
    return {fadeInSamples:clip.fadeInSamples,fadeOutSamples:clip.fadeOutSamples,startFrame:clip.startFrame,offsetSamples:clip.offsetSamples,gain:clip.gain,sampleRate:clip.sampleRate,channels};
  });
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    let worker:Worker|undefined,finished=false;
    const finish=(error?:unknown,result?:PcmResult)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}
      if(error!==undefined)reject(error);else resolve(result!);
    };
    const abort=()=>finish(signal?.reason??new DOMException('Audio mixing cancelled.','AbortError'));
    const timer=setTimeout(()=>finish(new Error('Audio mixing timed out.')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    try{
      worker=new Worker(new URL('./pcm-worker.ts',import.meta.url),{type:'module',name:'Splash PCM mixer'});
      worker.onmessage=event=>{
        try{
          const value=event.data;
          if(value?.ok!==true)throw new Error(typeof value?.error==='string'?value.error.slice(0,2000):'Invalid audio worker response.');
          const result=value.result as PcmResult;
          if(!result||result.sampleRate!==options.sampleRate||result.startSample!==range.start||result.endSample!==range.end||
            !Number.isFinite(result.peak)||result.peak<0||result.peak>160000||!Number.isSafeInteger(result.clippedSamples)||result.clippedSamples<0||result.clippedSamples>length*options.channelCount||
            !Array.isArray(result.channels)||result.channels.length!==options.channelCount)throw new Error('Invalid audio worker output.');
          for(const channel of result.channels){
            if(!(channel instanceof Float32Array)||channel.length!==length||channel.byteOffset!==0||byteLength.call(channel.buffer)!==channel.byteLength)throw new Error('Invalid audio worker channel.');
            for(const sample of channel)if(!Number.isFinite(sample)||Math.abs(sample)>1)throw new Error('Invalid audio worker samples.');
          }
          finish(undefined,result);
        }catch(error){finish(error);}
      };
      worker.onerror=event=>{event.preventDefault();finish(new Error('Audio mixer worker failed.'));};
      worker.onmessageerror=()=>finish(new Error('Audio worker response could not be read.'));
      if(signal?.aborted){abort();return;}worker.postMessage({clips:snapshot,options});
    }catch(error){finish(error);}
  });
}

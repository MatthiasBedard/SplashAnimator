export interface ResampleOptions {signal?:AbortSignal;timeoutMs?:number;maxBytes?:number}
let rendering=false;
/** Explicit platform resampling, with nearest-integer duration and no channel conversion.
 * Cancellation discards output; it cannot stop the native offline renderer. Admission stays
 * occupied until that renderer settles. Copies/scans are synchronous and may delay abort.
 * Platform filters may overshoot: output is hard-clipped with pre-clip peak/count reports.
 */
export async function resamplePcm(channels:readonly Float32Array[],sourceRate:number,targetRate:number,options:ResampleOptions={}){
 const {signal,timeoutMs=10000,maxBytes=128*1024*1024}=options,deadline=Date.now()+timeoutMs;
 signal?.throwIfAborted();
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isSafeInteger(maxBytes)||maxBytes<4||maxBytes>128*1024*1024)throw new Error('Invalid resampling limits.');
 for(const rate of [sourceRate,targetRate])if(!Number.isInteger(rate)||rate<8000||rate>192000)throw new Error('Invalid resampling rate.');
 if(!Array.isArray(channels)||channels.length<1||channels.length>2)throw new Error('Resampling requires mono or stereo PCM.');
 if(rendering)throw new Error('An offline audio conversion is still rendering.');
 const sources=[...channels],tag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype),Symbol.toStringTag)!.get!,byteLength=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
 let frames=0;
 for(const channel of sources){if(tag.call(channel)!=='Float32Array'||!channel.length||(frames&&frames!==channel.length))throw new Error('Invalid resampling channels.');byteLength.call(channel.buffer);frames=channel.length;}
 const outputFrames=Math.round(frames*targetRate/sourceRate);
 if(!Number.isSafeInteger(outputFrames)||outputFrames<1||frames*sources.length*4>maxBytes||outputFrames*sources.length*4>maxBytes)throw new Error('Resampling exceeds input/output PCM budgets.');
 for(const channel of sources)for(const sample of channel)if(!Number.isFinite(sample)||Math.abs(sample)>1)throw new Error('Invalid resampling source samples.');
 const check=()=>{signal?.throwIfAborted();if(Date.now()>=deadline)throw new Error('Audio resampling timed out.');};check();
 const context=new OfflineAudioContext(sources.length,outputFrames,targetRate),buffer=context.createBuffer(sources.length,frames,sourceRate);
 sources.forEach((channel,i)=>buffer.copyToChannel(channel as Float32Array<ArrayBuffer>,i));check();
 const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
 return new Promise<{channels:Float32Array<ArrayBuffer>[];sampleRate:number;frames:number;peak:number;clippedSamples:number}>((resolve,reject)=>{
  let finished=false;
  const finish=(error?:unknown,result?:{channels:Float32Array<ArrayBuffer>[];sampleRate:number;frames:number;peak:number;clippedSamples:number})=>{
   if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);try{source.stop();}catch{/* Already ended. */}source.disconnect();source.buffer=null;
   if(error!==undefined)reject(error);else resolve(result!);
  };
  const abort=()=>finish(signal?.reason??new DOMException('Resampling cancelled.','AbortError'));
  const timer=setTimeout(()=>finish(new Error('Audio resampling timed out.')),Math.max(1,deadline-Date.now()));signal?.addEventListener('abort',abort,{once:true});
  try{
   check();source.start();rendering=true;
   context.startRendering().then(rendered=>{
    rendering=false;if(finished)return;
    try{check();if(rendered.length!==outputFrames||rendered.numberOfChannels!==sources.length||rendered.sampleRate!==targetRate)throw new Error('Invalid resampling output.');
     const output:Float32Array<ArrayBuffer>[]=[];let peak=0,clippedSamples=0;
     for(let c=0;c<sources.length;c++){
      const data=rendered.getChannelData(c),copy=new Float32Array(outputFrames);
      for(let i=0;i<outputFrames;i++){const sample=data[i];if(!Number.isFinite(sample))throw new Error('Invalid resampled sample.');peak=Math.max(peak,Math.abs(sample));if(Math.abs(sample)>1)clippedSamples++;copy[i]=Math.max(-1,Math.min(1,sample));}output.push(copy);
     }
     check();finish(undefined,{channels:output,sampleRate:targetRate,frames:outputFrames,peak,clippedSamples});
    }catch(error){finish(error);}
   },error=>{rendering=false;finish(error);});
  }catch(error){rendering=false;finish(error);}
 });
}

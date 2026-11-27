/** Absolute frame boundaries avoid accumulating per-frame sample rounding. */
export function audioSampleRange(startFrame:number,endFrame:number,fps:number,sampleRate:number){
  if(!Number.isSafeInteger(startFrame)||!Number.isSafeInteger(endFrame)||startFrame<0||endFrame<=startFrame||
    !Number.isFinite(fps)||fps<=0||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)
    throw new Error('Invalid audio frame range, frame rate or sample rate.');
  const start=Math.round(startFrame*sampleRate/fps),end=Math.round(endFrame*sampleRate/fps);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start)throw new Error('Audio sample range exceeds numeric limits or is empty.');
  return {start,end};
}
export interface TimelinePcmClip {
  /** Root-timeline start; source offset is measured at the declared output sample rate. */
  startFrame:number;
  offsetSamples?:number;
  gain?:number;
  /** Linear fades over the playable source after offset. Zero disables; one silences
   * the endpoint sample. Overlapping fades multiply. Selected ranges do not restart them. */
  fadeInSamples?:number;
  fadeOutSamples?:number;
  /** Mono or stereo planar PCM. Rates must match; channel conversion requires explicit opt-in. */
  channels:readonly Float32Array[];
  sampleRate:number;
}
export interface TimelinePcmOptions {
  startFrame:number;endFrame:number;fps:number;sampleRate:number;channelCount:1|2;
  /** Bounds output Float32 storage, not caller-owned source buffers or total process memory. */
  maxBytes?:number;
  /** Explicit mono duplication or stereo arithmetic mean; no rate conversion. */
  convertChannels?:boolean;
  /** Upper bound for source validation plus sample/clip visits in this synchronous call. */
  maxWorkSamples?:number;
}
/** Offline, synchronous mixer. No resampling or source execution. Validates all source samples
 * before allocation, mixes in input order, hard-clips to [-1,1], and reports pre-clip peak/count.
 * Frame range is end-exclusive. Clips may start before it; gaps produce silence.
 */
export function mixTimelinePcm(clips:readonly TimelinePcmClip[],options:TimelinePcmOptions){
  const {startFrame,endFrame,fps,sampleRate,channelCount,maxBytes=128*1024*1024,maxWorkSamples=50000000,convertChannels=false}=options;
  if(typeof convertChannels!=='boolean')throw new Error('Invalid channel conversion option.');
  const range=audioSampleRange(startFrame,endFrame,fps,sampleRate),length=range.end-range.start;
  if(channelCount!==1&&channelCount!==2)throw new Error('Audio requires one or two output channels.');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>128*1024*1024||length*channelCount*4>maxBytes)
    throw new Error('Audio output exceeds the PCM byte budget.');
  if(!Array.isArray(clips)||clips.length>10000)throw new Error('Audio requires at most 10000 clips.');
  if(!Number.isSafeInteger(maxWorkSamples)||maxWorkSamples<1||maxWorkSamples>50000000)throw new Error('Invalid audio work budget.');
  let work=length*channelCount*Math.max(1,clips.length);
  const prepared=clips.map(clip=>{
    if(!clip||clip.sampleRate!==sampleRate||!Number.isSafeInteger(clip.startFrame)||clip.startFrame<0||
      !Array.isArray(clip.channels)||(clip.channels.length!==channelCount&&(!convertChannels||(clip.channels.length!==1&&clip.channels.length!==2))))
      throw new Error('Invalid audio clip timing, channels or sample rate.');
    const gain=clip.gain??1,offset=clip.offsetSamples??0,channels=[...clip.channels];
    if(!Number.isFinite(gain)||Math.abs(gain)>16||!Number.isSafeInteger(offset)||offset<0)
      throw new Error('Invalid audio clip gain or source offset.');
    if(channels.length===2&&channelCount===1)work+=length;
    const fadeIn=clip.fadeInSamples===undefined?0:clip.fadeInSamples,fadeOut=clip.fadeOutSamples===undefined?0:clip.fadeOutSamples;
    const frames=channels[0]?.length;
    if(!frames||offset>frames)throw new Error('Invalid audio clip source length or offset.');
    if(!Number.isSafeInteger(fadeIn)||!Number.isSafeInteger(fadeOut)||fadeIn<0||fadeOut<0||fadeIn>frames-offset||fadeOut>frames-offset)throw new Error('Invalid audio clip fade lengths.');
    for(const channel of channels){
      if(!(channel instanceof Float32Array)||channel.length!==frames)throw new Error('Audio channels must be equal-length Float32 PCM.');
      work+=channel.length;
    }
    const at=Math.round(clip.startFrame*sampleRate/fps);
    if(!Number.isSafeInteger(at)||!Number.isSafeInteger(at+frames-offset))throw new Error('Audio clip exceeds numeric timing limits.');
    return {channels,gain,offset,fadeIn,fadeOut,at,end:at+frames-offset};
  });
  if(!Number.isSafeInteger(work)||work>maxWorkSamples)throw new Error('Audio mixing exceeds the synchronous work budget.');
  for(const clip of prepared)for(const channel of clip.channels)for(const sample of channel)
    if(!Number.isFinite(sample)||Math.abs(sample)>1)throw new Error('Audio source samples must be finite and normalized.');
  const channels=Array.from({length:channelCount},()=>new Float32Array(length));
  let peak=0,clippedSamples=0;
  // Sum in double precision before the single Float32 write; clipping is never applied per clip.
  // Reject budgets above remain conservative: block culling never admits extra work.
  // Keep input order for identical double-precision sums, including cancellation.
  for(let block=0;block<length;block+=1024){
    const limit=Math.min(length,block+1024),first=range.start+block,last=range.start+limit;
    const active=prepared.filter(clip=>clip.at<last&&clip.end>first);
    if(active.length===0)continue; // Fresh output is already silent.
    for(let i=block;i<limit;i++)for(let c=0;c<channelCount;c++){
      const at=range.start+i;let sample=0;
      for(const clip of active)if(at>=clip.at&&at<clip.end){
        const index=at-clip.at+clip.offset;
        const value=clip.channels.length===channelCount?clip.channels[c][index]:clip.channels.length===1?clip.channels[0][index]:(clip.channels[0][index]+clip.channels[1][index])/2;
        const age=at-clip.at,remaining=clip.end-1-at;
        const fadeIn=clip.fadeIn===0?1:clip.fadeIn===1?(age===0?0:1):Math.min(1,age/(clip.fadeIn-1));
        const fadeOut=clip.fadeOut===0?1:clip.fadeOut===1?(remaining===0?0:1):Math.min(1,remaining/(clip.fadeOut-1));
        sample+=value*clip.gain*fadeIn*fadeOut;
      }
      peak=Math.max(peak,Math.abs(sample));if(Math.abs(sample)>1)clippedSamples++;
      channels[c][i]=Math.max(-1,Math.min(1,sample));
    }
  }
  return {channels,sampleRate,startSample:range.start,endSample:range.end,peak,clippedSamples};
}

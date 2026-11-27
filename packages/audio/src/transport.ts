import {audioSampleRange} from './pcm';
export interface AudioTransportConfig {startFrame:number;endFrame:number;fps:number;sampleRate:number}
export interface AudioTransportPosition {frame:number;sample:number;offsetSeconds:number;playing:boolean;ended:boolean}

/** Invert the same absolute, rounded boundaries used by the mixer. */
export function audioFrameAtSample(sample:number,startFrame:number,endFrame:number,fps:number,sampleRate:number){
 let lo=startFrame,hi=endFrame-1;
 while(lo<hi){const mid=lo+Math.ceil((hi-lo)/2);if(Math.round(mid*sampleRate/fps)<=sample)lo=mid;else hi=mid-1;}
 return lo;
}

/** Pure transport driven by one monotonic AudioContext clock, in seconds. No timers,
 * source nodes, stage mutation or playback. End is exclusive; its visual frame is the
 * final included frame. Seeking resets fractional position; pause/resume preserves it.
 */
export function createAudioTransport(config:AudioTransportConfig){
 const {startFrame,endFrame,fps,sampleRate}=config,range=audioSampleRange(startFrame,endFrame,fps,sampleRate);
 // A frame must have at least one sample; otherwise inverse frame mapping is ambiguous.
 if(fps>sampleRate)throw new Error('Audio transport requires at least one sample per frame.');
 let position=range.start,anchor=0,lastClock=0,playing=false;
 const clock=(now:number)=>{if(!Number.isFinite(now)||now<0||now<lastClock)throw new Error('Audio transport clock must be finite and monotonic.');};
 const projected=(now:number)=>{
  if(!playing)return position;
  const elapsed=now-anchor,remaining=range.end-position;
  return elapsed>=remaining/sampleRate?range.end:position+elapsed*sampleRate;
 };
 const describe=(at:number,running:boolean):AudioTransportPosition=>{
  const sample=Math.min(range.end,Math.floor(at)),frame=audioFrameAtSample(sample,startFrame,endFrame,fps,sampleRate);
  return {frame,sample,offsetSeconds:(at-range.start)/sampleRate,playing:running&&sample<range.end,ended:sample===range.end};
 };
 const advance=(now:number)=>{clock(now);const at=projected(now);position=at;anchor=now;lastClock=now;if(at>=range.end)playing=false;};
 return {
  position(now:number){clock(now);const at=projected(now);lastClock=now;if(at>=range.end){position=range.end;anchor=now;playing=false;}return describe(at,playing);},
  play(now:number){advance(now);if(position<range.end)playing=true;return describe(position,playing);},
  pause(now:number){advance(now);playing=false;return describe(position,false);},
  seek(frame:number,now:number){
   clock(now);if(!Number.isSafeInteger(frame)||frame<startFrame||frame>=endFrame)throw new Error('Audio transport seek is outside the prepared range.');
   const at=Math.round(frame*sampleRate/fps);position=at;anchor=now;lastClock=now;return describe(position,playing);
  },
 };
}

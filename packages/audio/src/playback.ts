import {audioSampleRange} from './pcm';
import {audioFrameAtSample,createAudioTransport,type AudioTransportConfig} from './transport';

function playbackBuffer(context:AudioContext,channels:readonly Float32Array[],frames:number,sampleRate:number){
 if(context.state==='closed'||context.sampleRate!==sampleRate)throw new Error('Audio context rate must match the prepared mix.');
 if(!Array.isArray(channels)||channels.length<1||channels.length>2||frames*channels.length*4>128*1024*1024)throw new Error('Invalid or oversized playback PCM.');
 const sources=[...channels],tag=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype),Symbol.toStringTag)!.get!,length=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
 for(const channel of sources){if(tag.call(channel)!=='Float32Array'||channel.length!==frames)throw new Error('Playback channels must match the prepared range.');length.call(channel.buffer);for(const sample of channel)if(!Number.isFinite(sample)||Math.abs(sample)>1)throw new Error('Invalid playback samples.');}
 const buffer=context.createBuffer(sources.length,frames,sampleRate);
 sources.forEach((channel,i)=>buffer.copyToChannel(channel as Float32Array<ArrayBuffer>,i));
 return buffer;
}

/** Explicit playback on a caller-owned context. Creation is silent; dispose stops sources
 * but never closes the shared context. Seek pauses. Resume is guarded against intervening
 * pause/seek/dispose calls. No stage mutation, loop scheduling or source execution.
 */
export function createAudioPlayback(context:AudioContext,channels:readonly Float32Array[],config:AudioTransportConfig){
 const settings={...config},transport=createAudioTransport(settings),range=audioSampleRange(settings.startFrame,settings.endFrame,settings.fps,settings.sampleRate);
 let buffer:AudioBuffer|undefined=playbackBuffer(context,channels,range.end-range.start,settings.sampleRate);
 let source:AudioBufferSourceNode|undefined,version=0,disposed=false;
 const active=()=>{if(disposed||context.state==='closed')throw new Error('Audio playback is disposed or its context closed.');};
 const stop=()=>{const old=source;source=undefined;if(old){old.onended=null;try{old.stop();}catch{/* May have already ended. */}old.disconnect();}};
 return {
  position(){active();return transport.position(context.currentTime);},
  async play(){
   active();if(source&&transport.position(context.currentTime).playing)return transport.position(context.currentTime);
   const token=++version;
   try{
    await context.resume();
    if(disposed||token!==version)return null;
    active();if(context.state!=='running')throw new Error('Audio context did not resume.');
    const now=context.currentTime,position=transport.position(now);if(position.ended)return position;
    stop();const node=context.createBufferSource();source=node;node.buffer=buffer!;node.connect(context.destination);
    node.onended=()=>{if(source===node){source=undefined;node.onended=null;node.disconnect();transport.pause(context.currentTime);}};
    node.start(now,position.offsetSeconds);return transport.play(now);
   }catch(error){if(!disposed&&token===version){stop();transport.pause(context.currentTime);}throw error;}
  },
  pause(){active();const position=transport.pause(context.currentTime);version++;stop();return position;},
  seek(frame:number){active();const now=context.currentTime;transport.seek(frame,now);const position=transport.pause(now);version++;stop();return position;},
  dispose(){if(disposed)return;disposed=true;version++;stop();buffer=undefined;},
 };
}

/** A single hardware-clock loop keeps visual wrap and waveform wrap on the same sample. */
export function startTimelineAudioLoop(context:AudioContext,channels:readonly Float32Array[],fps:number,duration:number,firstFrame:number){
 const rate=context.sampleRate,{end:frames}=audioSampleRange(0,duration,fps,rate);
 if(context.state!=='running'||fps>rate||!Number.isSafeInteger(firstFrame)||firstFrame<0||firstFrame>=duration)
  throw Error('Invalid timeline audio playback position or context.');
 const firstSample=Math.round(firstFrame*rate/fps);
 const buffer=playbackBuffer(context,channels,frames,rate);
 const node=context.createBufferSource();
 node.buffer=buffer;
 node.loop=true;
 node.connect(context.destination);
 const initialTime=context.currentTime;
 try{node.start(initialTime,firstSample/rate);}catch(error){node.disconnect();throw error;}
 let stopped=false;
 return {
  position(){
   if(stopped||context.state==='closed')throw Error('Timeline audio playback has ended.');
   const absolute=firstSample+Math.floor(Math.max(0,context.currentTime-initialTime)*rate);
   const frame=audioFrameAtSample(absolute%frames,0,duration,fps,rate);
   return {frame,absoluteFrame:Math.floor(absolute/frames)*duration+frame};
  },
  stop(){
   if(stopped)return;
   stopped=true;
   try{node.stop();}catch{/* The context may already have closed. */}finally{node.disconnect();}
  },
 };
}

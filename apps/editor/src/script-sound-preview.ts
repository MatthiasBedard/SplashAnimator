import type {Project} from '../../../packages/document/src';
import {captureScriptLibrary} from '../../../packages/scripting/src/stage-library';
import {MAX_SCRIPT_SOUND_CUES,readScriptSound,scriptSoundPosition,type ScriptSoundCue} from '../../../packages/scripting/src/stage-sound';
import {audioSampleRange} from '../../../packages/audio/src/pcm';
import {replayWaveByteLimit} from '../../../packages/export-web/src/replay-wave';

export type ScriptSoundLoader = (path:string, signal:AbortSignal)=>Promise<Blob>;
export type ScriptSoundSource = Pick<Project,'assets'|'libraryLinks'>;

type Voice = {source:AudioBufferSourceNode; gain:GainNode};
type Playback = {bus:GainNode; voices:Set<Voice>; buffers:Map<string,AudioBuffer>};
const pcmLimit=128*1024*1024;
let renderingReplay=false;

export function createScriptSoundPreview(context:AudioContext, project:ScriptSoundSource, load:ScriptSoundLoader) {
  const sounds=new Map(captureScriptLibrary(project,[]).filter(item=>item.kind==='audio').map(item=>[item.id,item]));
  const paths=new Map(project.assets.filter(asset=>sounds.has(asset.id)).map(asset=>[asset.id,asset.path]));
  // Keep only committed, privately decoded assets so replay never reopens a changed WAV.
  const retained=new Map<string,AudioBuffer>(),notRetained=new Set<string>();
  let retainedBytes=0;
  let active:Playback|undefined,decoded:{id:string;buffer:AudioBuffer}|undefined;
  function dispose(playback:Playback|undefined) {
    if(!playback)return;
    playback.bus.disconnect();
    for(const {source,gain} of playback.voices){
      source.onended=null;
      try{source.stop();}catch{/* This source may have ended. */}
      source.disconnect();gain.disconnect();
    }
    playback.voices.clear();
    playback.buffers.clear();
  }
  function stop(){
    const previous=active;active=undefined;decoded=undefined;
    dispose(previous);
  }
  function schedule(cues:readonly ScriptSoundCue[],fps:number,limit:number,lastTick?:number){
      if(!cues.length||cues.length>limit||!Number.isFinite(fps)||fps<=0)
        throw Error('Invalid script sound schedule.');
      return cues.map(({tick,value},index)=>{
        const entry=readScriptSound(value===null?undefined:value,sounds);
        if(!Number.isSafeInteger(tick)||tick<0||(index>0&&tick<=cues[index-1].tick)||
            entry&&entry[1]>tick||lastTick!==undefined&&(tick<1||tick>lastTick||entry&&entry[1]!==tick))
          throw Error('Invalid script sound cue time.');
        const sound=entry?sounds.get(entry[0]):undefined;
        const sample=entry&&sound?scriptSoundPosition(entry,tick,fps,sound):0;
        return {tick,entry,sound,sample};
      });
  }
  return {
    stop,
    async bakeReplay(cues:readonly ScriptSoundCue[],fps:number,lastTick:number,signal:AbortSignal,outputRate?:48000):Promise<Uint8Array|undefined> {
      signal.throwIfAborted();
      if(renderingReplay)throw Error('A replay sound render is still finishing.');
      const entries=schedule(cues,fps,10000,lastTick);
      const voices=entries.flatMap(({entry,sample,sound,tick},index)=>{
        if(!entry||entry[4]||!sound||sample>=sound.frames)return [];
        const buffer=retained.get(sound.id);
        if(!buffer)throw Error('Replay sound exceeds the retained PCM budget.');
        return [{buffer,sample,tick,gain:entry[3],end:entries[index+1]?.tick??lastTick+1}];
      });
      if(!voices.length)return undefined;
      const rate=outputRate??Math.max(...voices.map(voice=>voice.buffer.sampleRate));
      const channels=Math.max(...voices.map(voice=>voice.buffer.numberOfChannels));
      const {end:frames}=audioSampleRange(0,lastTick+1,fps,rate);
      if(frames*channels*2+44>replayWaveByteLimit)throw Error('Replay WAV exceeds the HTML artwork byte budget.');
      const offline=new OfflineAudioContext(channels,frames,rate);
      const at=(tick:number)=>Math.round(tick*rate/fps)/rate;
      for(const voice of voices){
        const source=offline.createBufferSource(),gain=offline.createGain();
        source.buffer=voice.buffer;gain.gain.value=voice.gain;
        source.connect(gain);gain.connect(offline.destination);
        source.start(at(voice.tick),voice.sample/voice.buffer.sampleRate);
        source.stop(at(voice.end));
      }
      let abort=()=>{};
      const stopped=new Promise<never>((_,reject)=>{
        abort=()=>reject(signal.reason);
        signal.addEventListener('abort',abort,{once:true});
      });
      try{
        signal.throwIfAborted();
        const rendering=offline.startRendering();
        renderingReplay=true;
        // Cancellation discards the result. Native rendering owns admission until it settles.
        const output=await Promise.race([rendering.finally(()=>{renderingReplay=false;}),stopped]);
        signal.throwIfAborted();
        const {encodePcm16WavAsync}=await import('../../../packages/audio/src/wav-encode-async');
        return await encodePcm16WavAsync(Array.from({length:channels},(_,i)=>output.getChannelData(i)),rate,{signal,maxBytes:replayWaveByteLimit});
      }finally{signal.removeEventListener('abort',abort);}
    },
    async prepare(cues:readonly ScriptSoundCue[],fps:number,signal:AbortSignal):Promise<()=>void> {
      signal.throwIfAborted();
      const entries=schedule(cues,fps,MAX_SCRIPT_SOUND_CUES);
      const job=new AbortController();
      const abort=()=>job.abort(signal.reason);
      signal.addEventListener('abort',abort,{once:true});
      const timeout=setTimeout(()=>job.abort(Error('Script sound preparation timed out.')),10000);
      const stopped=new Promise<never>((_,reject)=>job.signal.addEventListener('abort',()=>reject(job.signal.reason),{once:true}));
      const buffers=new Map<string,AudioBuffer>();
      try{
        let bytesReserved=0;
        for(const {entry,sound,sample} of entries){
          if(!sound||entry?.[4]||sample>=sound.frames||buffers.has(sound.id))continue;
          const pcmBytes=sound.frames*sound.channels*4;
          bytesReserved+=pcmBytes;
          if(bytesReserved>pcmLimit)throw Error('Script sound schedule exceeds the PCM budget.');
          const existing=retained.get(sound.id)??active?.buffers.get(sound.id)??(decoded?.id===sound.id?decoded.buffer:undefined);
          if(existing){buffers.set(sound.id,existing);continue;}
          const [{decodePcm16WavAsync},blob]=await Promise.race([
            Promise.all([import('../../../packages/audio/src/wav-async'),load(paths.get(sound.id)!,job.signal)]),stopped,
          ]);
          if(blob.size<12||blob.size>64*1024*1024)throw Error('Invalid script WAV size.');
          const bytes=new Uint8Array(await Promise.race([blob.arrayBuffer(),stopped]));
          const wav=await decodePcm16WavAsync(bytes,{signal:job.signal,maxPcmBytes:pcmBytes});
          job.signal.throwIfAborted();
          if(wav.frames!==sound.frames||wav.sampleRate!==sound.sampleRate||wav.channels.length!==sound.channels)
            throw Error('Script WAV does not match its captured metadata.');
          const buffer=context.createBuffer(sound.channels,sound.frames,sound.sampleRate);
          wav.channels.forEach((channel,index)=>buffer.copyToChannel(channel as Float32Array<ArrayBuffer>,index));
          buffers.set(sound.id,buffer);
        }
      }finally{
        clearTimeout(timeout);
        signal.removeEventListener('abort',abort);
      }
      return ()=>{
        signal.throwIfAborted();
        if(context.state!=='running')throw Error('The script preview audio context is suspended.');
        const candidate:Playback={bus:context.createGain(),voices:new Set(),buffers};
        const now=context.currentTime,first=entries[0].tick;
        try{
          for(const [index,{tick,entry,sound,sample}] of entries.entries()){
            const buffer=sound&&buffers.get(sound.id);
            if(!sound||!buffer||!entry||entry[4]||sample>=sound.frames)continue;
            const source=context.createBufferSource(),gain=context.createGain(),voice={source,gain};
            candidate.voices.add(voice);
            source.buffer=buffer;gain.gain.value=entry[3];
            source.connect(gain);gain.connect(candidate.bus);
            source.onended=()=>{
              if(!candidate.voices.delete(voice))return;
              source.disconnect();gain.disconnect();
              if(!candidate.voices.size){
                candidate.bus.disconnect();candidate.buffers.clear();
                if(active===candidate)active=undefined;
              }
            };
            source.start(now+(tick-first)/fps,sample/sound.sampleRate);
            const next=entries[index+1];
            if(next)source.stop(now+(next.tick-first)/fps);
          }
          if(candidate.voices.size)candidate.bus.connect(context.destination);
        }catch(error){dispose(candidate);throw error;}
        const previous=active;active=candidate.voices.size?candidate:undefined;
        dispose(previous);
        for(const [id,buffer] of buffers){
          if(retained.has(id)||notRetained.has(id))continue;
          const bytes=buffer.length*buffer.numberOfChannels*4;
          if(retainedBytes+bytes>pcmLimit){notRetained.add(id);continue;}
          retainedBytes+=bytes;retained.set(id,buffer);
        }
        const last=entries.at(-1)?.entry,lastId=last?.[0];
        const buffer=lastId?(buffers.get(lastId)??(decoded?.id===lastId?decoded.buffer:undefined)):undefined;
        decoded=lastId&&buffer?{id:lastId,buffer}:undefined;
      };
    },
  };
}

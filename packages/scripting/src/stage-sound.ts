import type { ScriptLibraryItem } from './stage-library';
import type { ScriptState, ScriptValue } from './timeline';

export const scriptSoundKey = '$splashSound';
export const MAX_SCRIPT_SOUND_CUES = 256;
export type ScriptSoundCue = {tick:number; value:ScriptValue};
type PlayingSound = [assetId:string, tick:number, offsetSamples:number, gain:number];
export type ScriptSound = PlayingSound | [...PlayingSound, paused:true];
export type SoundItem = Extract<ScriptLibraryItem,{kind:'audio'}>;

export function readScriptSound(value: unknown, assets: ReadonlyMap<string,SoundItem>): ScriptSound | undefined {
  if (value===undefined) return undefined;
  if (!Array.isArray(value) || (value.length!==4 && value.length!==5)) throw Error('Invalid script sound state.');
  const [id,tick,offset,gain,paused]=[0,1,2,3,4].map(index=>Object.getOwnPropertyDescriptor(value,index)?.value);
  if (value.length===5 && paused!==true) throw Error('Invalid script sound pause state.');
  const asset=typeof id==='string' ? assets.get(id) : undefined;
  if (!asset) throw Error('This sound is unavailable in the script preview.');
  if (!Number.isSafeInteger(tick) || tick<0 || !Number.isSafeInteger(offset) || offset<0 ||
      offset>asset.frames || typeof gain!=='number' || !Number.isFinite(gain) || gain<0 || gain>1)
    throw Error('Script sound requires a valid sample offset and gain from 0 to 1.');
  return paused ? [id,tick,offset,gain,true] : [id,tick,offset,gain];
}

export function scriptSoundPosition(sound: ScriptSound, tick: number, fps: number, asset: SoundItem) {
  if (sound[4]) return sound[2];
  return Math.min(asset.frames,sound[2]+Math.floor((Math.max(0,tick-sound[1])*asset.sampleRate)/fps));
}

export function createScriptSound(
  state: ScriptState, key: string, assets: ReadonlyMap<string,SoundItem>, tick: number, fps: number,
  read: typeof readScriptSound, position: typeof scriptSoundPosition,
) {
  const links=new Map([...assets.values()].map(asset=>[asset.link,asset]));
  const current=()=>read(state[key],assets);
  function active() {
    const sound=current();
    if(!sound)throw Error('Select a linked sound before changing playback.');
    return sound;
  }
  return Object.freeze({
    play(link:string, offsetSamples=0, gain=1) {
      const asset=links.get(link);
      if (!asset) throw Error('This sound link is unavailable in the script preview.');
      if (offsetSamples===asset.frames) throw Error('Script sound requires a valid sample offset and gain from 0 to 1.');
      state[key]=read([asset.id,tick+1,offsetSamples,gain],assets)!;
    },
    stop(){delete state[key];},
    pause(){
      const sound=active();
      if(sound[4])return;
      state[key]=[sound[0],tick+1,position(sound,tick,fps,assets.get(sound[0])!),sound[3],true];
    },
    resume(){
      const sound=active();
      if(!sound[4]||sound[2]===assets.get(sound[0])!.frames)return;
      state[key]=[sound[0],tick+1,sound[2],sound[3]];
    },
    seekSamples(offsetSamples:number){
      const sound=active();
      const entry=[sound[0],tick+1,offsetSamples,sound[3]];
      state[key]=read(sound[4]?[...entry,true]:entry,assets)!;
    },
    positionSamples() {
      const sound=current();
      return sound ? position(sound,tick,fps,assets.get(sound[0])!) : undefined;
    },
  });
}

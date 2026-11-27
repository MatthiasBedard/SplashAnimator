import { audioSampleRange } from '../../audio/src/pcm';

/** Base64 expansion counts against the existing 64 MiB standalone HTML limit. */
export const replayWaveByteLimit = 48 * 1024 * 1024;

/** Admit the canonical PCM16 output of our encoder without allocating decoded PCM. */
export function encodeReplayWave(bytes: Uint8Array, lastTick: number, fps: number): string {
  if (!(bytes instanceof Uint8Array) || bytes.length < 46 || bytes.length > replayWaveByteLimit)
    throw Error('Invalid replay WAV byte size.');
  Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!.call(bytes.buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at+length));
  const rate = view.getUint32(24,true), channels = view.getUint16(22,true);
  const {end:frames} = audioSampleRange(0,lastTick+1,fps,rate);
  if (text(0,4)!=='RIFF'||text(8,8)!=='WAVEfmt '||text(36,4)!=='data'||
      view.getUint32(4,true)!==bytes.length-8||view.getUint32(16,true)!==16||view.getUint16(20,true)!==1||
      (channels!==1&&channels!==2)||view.getUint32(28,true)!==rate*channels*2||
      view.getUint16(32,true)!==channels*2||view.getUint16(34,true)!==16||
      view.getUint32(40,true)!==bytes.length-44||frames*channels*2!==bytes.length-44)
    throw Error('Replay WAV does not match the recorded timeline.');
  let base64='';
  for(let start=0;start<bytes.length;start+=24576)
    base64+=btoa(String.fromCharCode(...bytes.subarray(start,start+24576)));
  return base64;
}

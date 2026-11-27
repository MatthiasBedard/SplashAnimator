import {expect,it,vi} from 'vitest';
import {encodePcm16Wav,writePcm16Wav} from '../packages/audio/src/wav-encode';
import {decodePcm16Wav} from '../packages/audio/src/wav';

it('emits exact bounded owned PCM chunks across mono/stereo and uneven boundaries',()=>{
 for(const count of [1,2])for(const chunkFrames of [1,127,16384]){
  const channels=Array.from({length:count},(_,c)=>Float32Array.from({length:33001},(_,i)=>((i*97+c*19)%65536-32768)/32768));
  const chunks:Uint8Array[]=[];const expected=encodePcm16Wav(channels,44100);
  const receipt=writePcm16Wav(channels,44100,c=>{chunks.push(c);},{chunkFrames,maxBytes:expected.length});
  expect(receipt).toEqual({bytesWritten:expected.length,frames:33001,sampleRate:44100,channelCount:count});
  expect(chunks[0].length).toBe(44);expect(chunks.slice(1).every(c=>c.length<=chunkFrames*count*2)).toBe(true);
  const bytes=new Uint8Array(receipt.bytesWritten);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  expect(bytes).toEqual(expected);const decoded=decodePcm16Wav(bytes);
  expect(decoded.channels).toEqual(channels);expect(new Set(chunks.map(c=>c.buffer)).size).toBe(chunks.length);
 }
});
it('rejects invalid late samples and options before any provisional bytes',()=>{
 const sink=vi.fn(),valid=new Float32Array(33001),bad=valid.slice();bad[33000]=NaN;
 for(const channels of [[valid,bad],[valid,new Float32Array(2)],[]])expect(()=>writePcm16Wav(channels,8000,sink)).toThrow();
 for(const chunkFrames of [0,1.5,16385,Infinity])expect(()=>writePcm16Wav([valid],8000,sink,{chunkFrames})).toThrow();
 expect(()=>writePcm16Wav([valid],8000,sink,{maxBytes:44+valid.length*2-1})).toThrow(/budget/);
 expect(sink).not.toHaveBeenCalled();
});
it('permits sink ownership of emitted bytes without reusing blocks or changing source',()=>{
 const source=new Float32Array([0.5,-1,1]),seen:number[][]=[];
 writePcm16Wav([source],8000,chunk=>{seen.push(Array.from(chunk));chunk.fill(0);},{chunkFrames:1});
 expect(seen.slice(1)).toEqual([[0,64],[0,128],[255,127]]);expect(Array.from(source)).toEqual([0.5,-1,1]);
});
it('stops on sink failure and abort, never issuing a successful receipt',()=>{
 const source=new Float32Array(10),controller=new AbortController();let writes=0;
 expect(()=>writePcm16Wav([source],8000,()=>{if(++writes===2)throw Error('disk');},{chunkFrames:1})).toThrow('disk');expect(writes).toBe(2);
 writes=0;expect(()=>writePcm16Wav([source],8000,()=>{writes++;controller.abort(Error('cancel'));},{signal:controller.signal})).toThrow('cancel');expect(writes).toBe(1);
 const sink=vi.fn();expect(()=>writePcm16Wav([source],8000,sink,{signal:controller.signal})).toThrow('cancel');expect(sink).not.toHaveBeenCalled();
});
it('rejects asynchronous sinks and absorbs their rejected promises',async()=>{
 const sink=vi.fn(async()=>{throw Error('async disk');});
 expect(()=>writePcm16Wav([new Float32Array(1)],8000,sink)).toThrow(/synchronous/);
 expect(sink).toHaveBeenCalledOnce();await Promise.resolve();
});

it('accounts transferred output by original length',()=>{
 const chunks:Uint8Array[]=[];
 const receipt=writePcm16Wav([new Float32Array([0.5,-1])],8000,chunk=>{chunks.push(structuredClone(chunk,{transfer:[chunk.buffer]}));},{chunkFrames:1});
 expect(receipt.bytesWritten).toBe(48);expect(chunks.map(c=>c.length)).toEqual([44,2,2]);
});

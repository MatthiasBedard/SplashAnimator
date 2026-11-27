import {expect,it} from 'vitest';
import {decodePcm16Wav} from '../packages/audio/src/wav';
import {pcm16WavFixture} from './wav-fixture';
it('decodes mono and stereo signed endpoints into detached normalized planar PCM',()=>{
 for(const samples of [[[-32768,-1,0,1,32767]],[[-32768,0,32767],[32767,1,-32768]]]){
  const bytes=pcm16WavFixture(samples),before=bytes.slice(),result=decodePcm16Wav(bytes);
  expect(result.sampleRate).toBe(8000);expect(result.frames).toBe(samples[0].length);expect(result.channels.map(c=>Array.from(c))).toEqual(samples.map(c=>c.map(n=>n/32768)));expect(bytes).toEqual(before);
  bytes.fill(0);expect(result.channels[0][0]).toBe(-1);
 }
});
it('walks padded unknown chunks and reversed chunk ordering, and respects input subviews',()=>{
 const bytes=pcm16WavFixture([[100,-100]],44100,true,true),padded=new Uint8Array(bytes.length+12);padded.set(bytes,7);
 expect(decodePcm16Wav(padded.subarray(7,7+bytes.length)).channels[0]).toEqual(new Float32Array([100/32768,-100/32768]));
 expect(()=>decodePcm16Wav(bytes,{maxChunks:2})).toThrow(/chunk budget/);
});
it('rejects truncation, trailing bytes, invalid formats and inconsistent alignment',()=>{
 const valid=pcm16WavFixture([[0,1]]);
 for(let n=0;n<valid.length;n++)expect(()=>decodePcm16Wav(valid.slice(0,n))).toThrow();
 for(const [at,value] of [[20,3],[22,3],[32,1],[34,8],[40,3],[16,15],[28,0]]){const bad=valid.slice();bad[at]=value;expect(()=>decodePcm16Wav(bad)).toThrow();}
 const trailing=new Uint8Array(valid.length+1);trailing.set(valid);expect(()=>decodePcm16Wav(trailing)).toThrow(/file length/);
});
it('rejects duplicate and missing chunks and enforces exact decode budgets',()=>{
 const valid=pcm16WavFixture([[0,1]]),duplicate=new Uint8Array(valid.length+12);duplicate.set(valid);duplicate.set(valid.slice(36),valid.length);new DataView(duplicate.buffer).setUint32(4,duplicate.length-8,true);
 expect(()=>decodePcm16Wav(duplicate)).toThrow(/Duplicate/);
 const missing=valid.slice();missing.set(new TextEncoder().encode('JUNK'),36);expect(()=>decodePcm16Wav(missing)).toThrow(/Missing/);
 expect(decodePcm16Wav(valid,{maxInputBytes:valid.length,maxPcmBytes:8,maxChunks:2}).frames).toBe(2);
 expect(()=>decodePcm16Wav(valid,{maxPcmBytes:7})).toThrow(/PCM/);expect(()=>decodePcm16Wav(valid,{maxInputBytes:valid.length-1})).toThrow(/oversized/);
 for(const budget of [0,NaN,Infinity,1.5])expect(()=>decodePcm16Wav(valid,{maxChunks:budget})).toThrow(/budget/);
});

it('accepts an empty format extension but rejects nonempty extensions and missing odd padding',()=>{
 const valid=pcm16WavFixture([[1]]),extended=new Uint8Array(valid.length+2);extended.set(valid.slice(0,36));extended.set(valid.slice(36),38);
 const view=new DataView(extended.buffer);view.setUint32(4,extended.length-8,true);view.setUint32(16,18,true);
 expect(decodePcm16Wav(extended).channels[0][0]).toBe(1/32768);view.setUint16(36,1,true);expect(()=>decodePcm16Wav(extended)).toThrow(/PCM16/);
 const unpadded=new Uint8Array(valid.length+9);unpadded.set(valid);unpadded.set(new TextEncoder().encode('JUNK'),valid.length);new DataView(unpadded.buffer).setUint32(valid.length+4,1,true);new DataView(unpadded.buffer).setUint32(4,unpadded.length-8,true);
 expect(()=>decodePcm16Wav(unpadded)).toThrow(/padding/);
});

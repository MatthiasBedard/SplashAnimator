import {expect,it} from 'vitest';
import {createWavChunkProcessor} from '../packages/audio/src/wav-chunk-processor';
import {createPcm16WavChunks,encodePcm16Wav} from '../packages/audio/src/wav-encode';
it('pulls exactly one owned chunk per ordered acknowledgement and completes after the last ack',()=>{
 const source=Float32Array.from({length:33001},(_,i)=>(i%65536-32768)/32768),expected=encodePcm16Wav([source],48000),p=createWavChunkProcessor();
 const chunks:Uint8Array[]=[];let response=p.process({type:'start',channels:[source],sampleRate:48000,options:{chunkFrames:127}}),index=0;
 while(response.type==='chunk'){
  expect(response.sequence).toBe(index++);chunks.push(structuredClone(response.bytes,{transfer:[response.bytes.buffer]}));
  response=p.process({type:'ack',sequence:response.sequence});
 }
 expect(response.sequence).toBe(chunks.length);expect(response.receipt.bytesWritten).toBe(expected.length);
 const bytes=new Uint8Array(expected.length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}expect(bytes).toEqual(expected);
 expect(()=>p.process({type:'ack',sequence:index-1})).toThrow(/closed/);
});
it('rejects missing, future, duplicate and malformed acknowledgements terminally',()=>{
 for(const request of [{type:'ack',sequence:-1},{type:'ack',sequence:1},{type:'ack',sequence:0,extra:true},{type:'start'},null]){
  const p=createWavChunkProcessor();p.process({type:'start',channels:[new Float32Array(3)],sampleRate:8000});
  expect(()=>p.process(request)).toThrow();expect(()=>p.process({type:'ack',sequence:0})).toThrow(/closed/);
 }
 const p=createWavChunkProcessor();p.process({type:'start',channels:[new Float32Array(3)],sampleRate:8000});p.process({type:'ack',sequence:0});expect(()=>p.process({type:'ack',sequence:0})).toThrow(/acknowledgement/);
});
it('validates all samples and original start options before output',()=>{
 for(const request of [{type:'ack',sequence:0},{type:'start',channels:[new Float32Array([0,NaN])],sampleRate:8000},{type:'start',channels:[new Float32Array(1)],sampleRate:8000,options:null},{type:'start',channels:[new Float32Array(1)],sampleRate:8000,options:{signal:{}}}]){
  const p=createWavChunkProcessor();expect(()=>p.process(request)).toThrow();expect(()=>p.process({type:'start',channels:[new Float32Array(1)],sampleRate:8000})).toThrow(/closed/);
 }
});
it('supports disposal while waiting for acknowledgement without completion',()=>{
 const p=createWavChunkProcessor();p.process({type:'start',channels:[new Float32Array(1)],sampleRate:8000});p.dispose();p.dispose();expect(()=>p.process({type:'ack',sequence:0})).toThrow(/closed/);
});
it('validates pulls eagerly and terminates a cancelled iterator',()=>{
 expect(()=>createPcm16WavChunks([new Float32Array([NaN])],8000)).toThrow(/normalized/);
 const controller=new AbortController(),chunks=createPcm16WavChunks([new Float32Array(2)],8000,{signal:controller.signal});expect(chunks.next().done).toBe(false);controller.abort(Error('cancel'));expect(()=>chunks.next()).toThrow('cancel');expect(chunks.next().done).toBe(true);
 const unopened=createPcm16WavChunks([new Float32Array(1)],8000);unopened.return();expect(unopened.next().done).toBe(true);
});

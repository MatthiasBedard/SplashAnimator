import {expect,it} from 'vitest';
import {encodePcm16Wav} from '../packages/audio/src/wav-encode';
import {decodePcm16Wav} from '../packages/audio/src/wav';
it('roundtrips every signed PCM16 integer without changing the source',()=>{
 const source=Float32Array.from({length:65536},(_,i)=>(i-32768)/32768),before=source.slice();
 const bytes=encodePcm16Wav([source],48000),decoded=decodePcm16Wav(bytes);
 expect(decoded.sampleRate).toBe(48000);expect(decoded.channels[0]).toEqual(source);expect(source).toEqual(before);source.fill(0);expect(decodePcm16Wav(bytes).channels[0]).toEqual(before);
});
it('writes exact RIFF sizes, stereo interleaving and saturated rounded endpoints',()=>{
 const bytes=encodePcm16Wav([new Float32Array([-1,1,0.5]),new Float32Array([0,-0.5,1/65536])],8000),view=new DataView(bytes.buffer);
 expect(new TextDecoder().decode(bytes.slice(0,4))).toBe('RIFF');expect(view.getUint32(4,true)).toBe(bytes.length-8);expect(view.getUint32(28,true)).toBe(32000);expect(view.getUint16(32,true)).toBe(4);expect(view.getUint32(40,true)).toBe(12);
 expect(Array.from({length:6},(_,i)=>view.getInt16(44+i*2,true))).toEqual([-32768,0,32767,-16384,16384,1]);
 expect(encodePcm16Wav([new Float32Array([0])],8000,{maxBytes:46})).toHaveLength(46);
 expect(()=>encodePcm16Wav([new Float32Array([0])],8000,{maxBytes:45})).toThrow(/budget/);
});
it('rejects invalid formats, unequal/shared/empty channels and original nonfinite samples',()=>{
 const valid=new Float32Array([0]);for(const rate of [0,7999,192001,NaN,8000.5])expect(()=>encodePcm16Wav([valid],rate)).toThrow();
 for(const channels of [[],[valid,valid,valid],[valid,new Float32Array(2)],[new Float32Array()],[new Float64Array([0])],[new Float32Array(new SharedArrayBuffer(4))]])expect(()=>encodePcm16Wav(channels as Float32Array[],8000)).toThrow();
 for(const sample of [NaN,Infinity,-Infinity,1.1,-1.1]){const input=new Float32Array([sample]);expect(()=>encodePcm16Wav([input],8000)).toThrow(/normalized/);expect(Object.is(input[0],Math.fround(sample))).toBe(true);}
 for(const maxBytes of [NaN,Infinity,43,64*1024*1024+1])expect(()=>encodePcm16Wav([valid],8000,{maxBytes})).toThrow();
});

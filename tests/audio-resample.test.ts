import {afterEach,expect,it,vi} from 'vitest';
import {resamplePcm} from '../packages/audio/src/resample';
class Context {
 static instances:Context[]=[];copies:Float32Array[]=[];source={buffer:null as unknown,connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn()};destination={};
 resolve!:(value:unknown)=>void;reject!:(error:unknown)=>void;
 constructor(public numberOfChannels:number,public length:number,public sampleRate:number){Context.instances.push(this);}
 createBuffer(){return {copyToChannel:(data:Float32Array,i:number)=>{this.copies[i]=data.slice();}};}
 createBufferSource(){return this.source;}
 startRendering(){return new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}
 complete(samples:number[]){this.resolve({numberOfChannels:this.numberOfChannels,length:this.length,sampleRate:this.sampleRate,getChannelData:()=>new Float32Array(samples)});}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();Context.instances=[];});
it('snapshots sources and reports normalized output without publishing native storage',async()=>{
 vi.stubGlobal('OfflineAudioContext',Context);const data=new Float32Array([0.5,-0.5]),pending=resamplePcm([data],8000,16000),context=Context.instances[0];data.fill(0);expect(context.copies[0]).toEqual(new Float32Array([0.5,-0.5]));context.complete([0,1.25,-1.5,0.25]);const result=await pending;expect(Array.from(result.channels[0])).toEqual([0,1,-1,0.25]);expect(result.peak).toBe(1.5);expect(result.clippedSamples).toBe(2);expect(context.source.disconnect).toHaveBeenCalledOnce();
});
it('cancels publication while holding admission until native rendering settles',async()=>{
 vi.stubGlobal('OfflineAudioContext',Context);const controller=new AbortController(),pending=resamplePcm([new Float32Array(2)],8000,8000,{signal:controller.signal}),context=Context.instances[0];controller.abort();await expect(pending).rejects.toThrow();await expect(resamplePcm([new Float32Array(2)],8000,8000)).rejects.toThrow(/still rendering/);context.complete([1,1]);await Promise.resolve();const retry=resamplePcm([new Float32Array(2)],8000,8000);Context.instances[1].complete([0,0]);expect((await retry).frames).toBe(2);
});
it('rejects invalid original input before allocation and discards deadline output',async()=>{
 vi.stubGlobal('OfflineAudioContext',Context);for(const data of [new Float32Array([NaN]),new Float32Array([2]),new Float32Array(new SharedArrayBuffer(4))])await expect(resamplePcm([data],8000,8000)).rejects.toThrow();await expect(resamplePcm([new Float32Array(2)],8000,16000,{maxBytes:8})).rejects.toThrow(/budgets/);expect(Context.instances).toHaveLength(0);
 vi.useFakeTimers();const pending=resamplePcm([new Float32Array(2)],8000,8000,{timeoutMs:10}),assertion=expect(pending).rejects.toThrow(/timed out/);await vi.advanceTimersByTimeAsync(10);await assertion;Context.instances[0].complete([0,0]);await Promise.resolve();
});

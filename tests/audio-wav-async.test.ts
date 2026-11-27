import {afterEach,expect,it,vi} from 'vitest';
import {decodePcm16Wav} from '../packages/audio/src/wav';
import {decodePcm16WavAsync} from '../packages/audio/src/wav-async';
import {pcm16WavFixture} from './wav-fixture';
class FakeWorker{
 static instances:FakeWorker[]=[];
 onmessage:((event:{data:unknown})=>void)|null=null;onerror:((event:{preventDefault:()=>void})=>void)|null=null;onmessageerror:(()=>void)|null=null;
 terminate=vi.fn();postMessage=vi.fn();constructor(){FakeWorker.instances.push(this);}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
it('snapshots only admitted bytes and transfers owned copies without detaching caller buffers',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const wav=pcm16WavFixture([[-32768,32767]]),backing=new Uint8Array(1024);backing.set(wav,10);
 const input=backing.subarray(10,10+wav.length),pending=decodePcm16WavAsync(input,{maxInputBytes:wav.length}),worker=FakeWorker.instances[0];
 const [{bytes},transfers]=worker.postMessage.mock.calls[0];expect(bytes).toEqual(wav);expect(bytes.buffer.byteLength).toBe(wav.length);expect(transfers).toEqual([bytes.buffer]);expect(bytes.buffer).not.toBe(input.buffer);
 input.fill(0);worker.onmessage!({data:{ok:true,result:decodePcm16Wav(wav)}});expect((await pending).channels[0][0]).toBe(-1);expect(backing.length).toBe(1024);
});
it('rejects malformed output and cleans failure, abort and late responses',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const wav=pcm16WavFixture([[0]]);
 for(const mode of ['nan','rate','size','failure','cancel','error','messageerror']){
  const controller=new AbortController(),pending=decodePcm16WavAsync(wav,{signal:controller.signal}),worker=FakeWorker.instances.at(-1)!,late=worker.onmessage!;
  const assertion=expect(pending).rejects.toThrow(),result=decodePcm16Wav(wav);
  if(mode==='nan')result.channels[0][0]=NaN;if(mode==='rate')result.sampleRate=0;if(mode==='size')result.frames=100000000;
  if(['nan','rate','size'].includes(mode))worker.onmessage!({data:{ok:true,result}});
  if(mode==='failure')worker.onmessage!({data:{ok:false,error:'decode failed'}});if(mode==='cancel')controller.abort(new Error('cancel WAV'));
  if(mode==='error')worker.onerror!({preventDefault:()=>{}});if(mode==='messageerror')worker.onmessageerror!();
  await assertion;late({data:{ok:true,result:decodePcm16Wav(wav)}});expect(worker.terminate).toHaveBeenCalledOnce();expect(worker.onmessage).toBeNull();
 }
});
it('rejects budgets and preabort before workers and terminates expired decoding',async()=>{
 vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();const wav=pcm16WavFixture([[0]]);
 await expect(decodePcm16WavAsync(wav,{timeoutMs:0})).rejects.toThrow(/deadline/);await expect(decodePcm16WavAsync(wav,{maxInputBytes:1})).rejects.toThrow(/oversized/);
 await expect(decodePcm16WavAsync(wav,{signal:AbortSignal.abort()})).rejects.toThrow();expect(FakeWorker.instances).toHaveLength(0);
 const pending=decodePcm16WavAsync(wav,{timeoutMs:10}),assertion=expect(pending).rejects.toThrow(/timed out/);await vi.advanceTimersByTimeAsync(10);await assertion;expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

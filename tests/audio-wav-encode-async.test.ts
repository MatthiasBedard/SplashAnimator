import {afterEach,expect,it,vi} from 'vitest';
import {encodePcm16WavAsync} from '../packages/audio/src/wav-encode-async';
import {encodePcm16Wav} from '../packages/audio/src/wav-encode';
class FakeWorker{
 static instances:FakeWorker[]=[];onmessage:((event:{data:unknown})=>void)|null=null;onerror:((event:{preventDefault:()=>void})=>void)|null=null;onmessageerror:(()=>void)|null=null;
 terminate=vi.fn();postMessage=vi.fn();constructor(){FakeWorker.instances.push(this);}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
it('transfers exact view snapshots and preserves callers',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const source=new Float32Array([9,-1,0,1,9]),input=source.subarray(1,4),pending=encodePcm16WavAsync([input],8000),worker=FakeWorker.instances[0];
 const [{channels},transfer]=worker.postMessage.mock.calls[0];expect(Array.from(channels[0])).toEqual([-1,0,1]);expect(channels[0].buffer.byteLength).toBe(12);expect(transfer).toEqual([channels[0].buffer]);source.fill(0);
 const bytes=encodePcm16Wav(channels,8000);worker.onmessage!({data:{ok:true,bytes}});expect(await pending).toEqual(bytes);expect(source.byteLength).toBe(20);expect(worker.terminate).toHaveBeenCalledOnce();
});
it('rejects malformed output, aborts, errors and late completion with cleanup',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 for(const mode of ['header','size','cancel','error','message']){const controller=new AbortController(),pending=encodePcm16WavAsync([new Float32Array([0])],8000,{signal:controller.signal}),worker=FakeWorker.instances.at(-1)!,late=worker.onmessage!,assertion=expect(pending).rejects.toThrow();const bytes=encodePcm16Wav([new Float32Array([0])],8000);
 if(mode==='header'){bytes[24]=0;worker.onmessage!({data:{ok:true,bytes}});}if(mode==='size')worker.onmessage!({data:{ok:true,bytes:new Uint8Array(4)}});if(mode==='cancel')controller.abort();if(mode==='error')worker.onerror!({preventDefault(){}});if(mode==='message')worker.onmessageerror!();await assertion;late({data:{ok:true,bytes}});expect(worker.terminate).toHaveBeenCalledOnce();expect(worker.onmessage).toBeNull();}
});
it('rejects admission before workers and cleans timeout',async()=>{
 vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();const source=new Float32Array([0]);await expect(encodePcm16WavAsync([source],8000,{maxBytes:45})).rejects.toThrow();await expect(encodePcm16WavAsync([new Float32Array(new SharedArrayBuffer(4))],8000)).rejects.toThrow();await expect(encodePcm16WavAsync([source],8000,{signal:AbortSignal.abort()})).rejects.toThrow();expect(FakeWorker.instances).toHaveLength(0);
 const pending=encodePcm16WavAsync([source],8000,{timeoutMs:10}),assertion=expect(pending).rejects.toThrow(/timed out/);await vi.advanceTimersByTimeAsync(10);await assertion;expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

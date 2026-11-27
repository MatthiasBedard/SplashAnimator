import {afterEach,expect,it,vi} from 'vitest';
import {streamPcm16Wav} from '../packages/audio/src/wav-chunk-async';
import {encodePcm16Wav} from '../packages/audio/src/wav-encode';
class FakeWorker{
 static instances:FakeWorker[]=[];onmessage:((event:{data:unknown})=>void)|null=null;onerror:((event:{preventDefault:()=>void})=>void)|null=null;onmessageerror:(()=>void)|null=null;
 terminate=vi.fn();postMessage=vi.fn();constructor(){FakeWorker.instances.push(this);}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
it('captures exact views and withholds acknowledgement until the sink completes',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const source=new Float32Array([9,-1,0,1,9]),chunks:Uint8Array[]=[];let release:()=>void=()=>{};
 const pending=streamPcm16Wav([source.subarray(1,4)],8000,bytes=>{chunks.push(structuredClone(bytes,{transfer:[bytes.buffer]}));return new Promise<void>(r=>{release=r;});},{chunkFrames:2}),w=FakeWorker.instances[0];
 const [start,transfer]=w.postMessage.mock.calls[0];expect(Array.from(start.channels[0])).toEqual([-1,0,1]);expect(start.channels[0].buffer.byteLength).toBe(12);expect(transfer).toEqual([start.channels[0].buffer]);source.fill(0);
 const bytes=encodePcm16Wav(start.channels,8000);
 for(const [sequence,chunk] of [bytes.slice(0,44),bytes.slice(44,48),bytes.slice(48)].entries()){
  w.onmessage!({data:{type:'chunk',sequence,bytes:chunk}});await tick();expect(w.postMessage).toHaveBeenCalledTimes(sequence+1);release();await tick();expect(w.postMessage).toHaveBeenLastCalledWith({type:'ack',sequence});
 }
 w.onmessage!({data:{type:'done',sequence:3,receipt:{bytesWritten:50,frames:3,sampleRate:8000,channelCount:1}}});expect(await pending).toEqual({bytesWritten:50,frames:3,sampleRate:8000,channelCount:1});expect(chunks.map(c=>c.length)).toEqual([44,4,2]);expect(w.terminate).toHaveBeenCalledOnce();expect(source.byteLength).toBe(20);
});
it('rejects malformed headers/envelopes/sequences and premature completion before sinks',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const full=encodePcm16Wav([new Float32Array(1)],8000),bad=full.slice(0,44);bad[24]=0;
 const cases=[{type:'chunk',sequence:1,bytes:full.slice(0,44)},{type:'chunk',sequence:0,bytes:bad},{type:'chunk',sequence:0,bytes:full.subarray(0,44)},{type:'chunk',sequence:0,bytes:new Uint8Array(43)},{type:'done',sequence:0,receipt:{}},{type:'error',error:'worker rejected'},null];
 for(const data of cases){const sink=vi.fn(),pending=streamPcm16Wav([new Float32Array(1)],8000,sink),w=FakeWorker.instances.at(-1)!;w.onmessage!({data});await expect(pending).rejects.toThrow();expect(sink).not.toHaveBeenCalled();expect(w.terminate).toHaveBeenCalledOnce();}
});
it('rejects unsolicited output during a pending sink and ignores its late settlement',async()=>{
 vi.stubGlobal('Worker',FakeWorker);let release:()=>void=()=>{},sinkSignal:AbortSignal|undefined;
 const pending=streamPcm16Wav([new Float32Array(1)],8000,(_,signal)=>{sinkSignal=signal;return new Promise<void>(r=>{release=r;});}),w=FakeWorker.instances[0],late=w.onmessage!;
 const header=encodePcm16Wav([new Float32Array(1)],8000).slice(0,44);late({data:{type:'chunk',sequence:0,bytes:header}});late({data:{type:'chunk',sequence:1,bytes:new Uint8Array(2)}});
 await expect(pending).rejects.toThrow(/Unsolicited/);expect(sinkSignal!.aborted).toBe(true);release();await tick();late({data:{type:'done',sequence:2}});expect(w.postMessage).toHaveBeenCalledTimes(1);expect(w.terminate).toHaveBeenCalledOnce();
});
it('cleans sink failure, cancellation and deadline while writes are pending',async()=>{
 vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();
 for(const mode of ['failure','cancel','timeout']){const controller=new AbortController();let release:()=>void=()=>{},sinkSignal:AbortSignal|undefined;
  const pending=streamPcm16Wav([new Float32Array(1)],8000,(_,signal)=>{sinkSignal=signal;if(mode==='failure')throw Error('sink failure');return new Promise<void>(r=>{release=r;});},{signal:controller.signal,timeoutMs:10}),w=FakeWorker.instances.at(-1)!,rejected=expect(pending).rejects.toThrow();
  w.onmessage!({data:{type:'chunk',sequence:0,bytes:encodePcm16Wav([new Float32Array(1)],8000).slice(0,44)}});
  if(mode==='cancel')controller.abort(Error('cancel'));if(mode==='timeout')await vi.advanceTimersByTimeAsync(10);await rejected;expect(sinkSignal!.aborted).toBe(true);release();await tick();expect(w.postMessage).toHaveBeenCalledTimes(1);expect(w.terminate).toHaveBeenCalledOnce();
 }
});
it('rejects invalid admission before allocating workers',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const sink=vi.fn();
 await expect(streamPcm16Wav([new Float32Array(1)],8000,sink,{maxBytes:45})).rejects.toThrow();await expect(streamPcm16Wav([new Float32Array(new SharedArrayBuffer(4))],8000,sink)).rejects.toThrow();await expect(streamPcm16Wav([new Float32Array(1)],8000,sink,{chunkFrames:0})).rejects.toThrow();await expect(streamPcm16Wav([new Float32Array(1)],8000,sink,{signal:AbortSignal.abort()})).rejects.toThrow();expect(FakeWorker.instances).toHaveLength(0);
});
it('validates the final receipt and cleans native worker failures',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 for(const mode of ['receipt','error','message']){const pending=streamPcm16Wav([new Float32Array(1)],8000,()=>{}),w=FakeWorker.instances.at(-1)!;
  if(mode==='error')w.onerror!({preventDefault(){}});else if(mode==='message')w.onmessageerror!();else{const bytes=encodePcm16Wav([new Float32Array(1)],8000);w.onmessage!({data:{type:'chunk',sequence:0,bytes:bytes.slice(0,44)}});await tick();w.onmessage!({data:{type:'chunk',sequence:1,bytes:bytes.slice(44)}});await tick();w.onmessage!({data:{type:'done',sequence:2,receipt:{bytesWritten:46,frames:2,sampleRate:8000,channelCount:1}}});}
  await expect(pending).rejects.toThrow();expect(w.terminate).toHaveBeenCalledOnce();expect(w.onmessage).toBeNull();
 }
});

import {afterEach,expect,it,vi} from 'vitest';
import {openGifStream} from '../packages/export-video/src/gif-stream-async';
import {createGifStreamProcessor} from '../packages/export-video/src/gif-stream';
class FakeWorker {
  static instances:FakeWorker[]=[];
  onmessage:((event:{data:unknown})=>void)|null=null;
  onerror:((event:{preventDefault:()=>void})=>void)|null=null;onmessageerror:(()=>void)|null=null;
  terminate=vi.fn();postMessage=vi.fn();constructor(){FakeWorker.instances.push(this);}
}
const settings=()=>({width:1,height:1,frameCount:1,fps:24,matte:[0,0,0] as const,transparent:false});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
it('enforces one in-flight request, valid phases and successful cleanup with real protocol responses',async()=>{
  vi.stubGlobal('Worker',FakeWorker);const processor=createGifStreamProcessor(),opening=openGifStream(settings()),worker=FakeWorker.instances[0];
  const reply=()=>worker.onmessage!({data:{ok:true,...processor(worker.postMessage.mock.lastCall![0])}});
  reply();const stream=await opening,frame=new Uint8Array([255,0,0,255]);
  await expect(stream.seal()).rejects.toThrow(/incomplete/);
  const first=stream.analyze(frame);await expect(stream.analyze(frame)).rejects.toThrow(/in flight/);expect(worker.postMessage).toHaveBeenCalledTimes(2);
  reply();await first;const seal=stream.seal();reply();await seal;
  const indexed=stream.index(frame,true);expect(worker.postMessage.mock.lastCall![1]).toEqual([frame.buffer]);reply();await indexed;
  const finishing=stream.finish();reply();expect((await finishing).bytes[0]).toBe(71);
  expect(worker.terminate).toHaveBeenCalledOnce();await expect(stream.finish()).rejects.toThrow(/completed/);
});
it('terminates on invalid acknowledgments, errors, cancellation, disposal and shared idle deadline',async()=>{
  vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();
  for(const mode of ['ack','early','error','message','abort','dispose','idle']){
    const controller=new AbortController(),opening=openGifStream(settings(),{signal:controller.signal,timeoutMs:10}),worker=FakeWorker.instances.at(-1)!;
    worker.onmessage!({data:{ok:true,seq:0,phase:'analyze',accepted:0}});const stream=await opening;
    if(mode==='idle'){await vi.advanceTimersByTimeAsync(10);await expect(stream.analyze(new Uint8Array(4))).rejects.toThrow(/timed out/);}
    else{
      const job=stream.analyze(new Uint8Array(4)),assertion=expect(job).rejects.toThrow();
      if(mode==='ack')worker.onmessage!({data:{ok:true,seq:99,phase:'analyze',accepted:1}});
      if(mode==='early')worker.onmessage!({data:{ok:true,seq:1,phase:'analyze',accepted:1,bytes:new Uint8Array(1)}});
      if(mode==='error')worker.onerror!({preventDefault(){}});
      if(mode==='message')worker.onmessageerror!();
      if(mode==='abort')controller.abort(new Error('cancel'));
      if(mode==='dispose')stream.dispose();
      await assertion;
    }
    expect(worker.terminate).toHaveBeenCalledOnce();expect(worker.onmessage).toBeNull();
  }
});

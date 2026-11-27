import {afterEach,expect,it,vi} from 'vitest';
import {openGifChunkStream} from '../packages/export-video/src/gif-chunk-async';
import {createGifChunkStreamProcessor} from '../packages/export-video/src/gif-chunk-stream';
class FakeWorker {
  static instances:FakeWorker[]=[];
  onmessage:((event:{data:unknown})=>void)|null=null;
  onerror:((event:{preventDefault:()=>void})=>void)|null=null;onmessageerror:(()=>void)|null=null;
  terminate=vi.fn();postMessage=vi.fn();constructor(){FakeWorker.instances.push(this);}
}
const settings=()=>({width:1,height:1,frameCount:1,fps:24,matte:[0,0,0] as const,transparent:false});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
it('awaits destination writes before acknowledgments and returns a receipt without publishing',async()=>{
  vi.stubGlobal('Worker',FakeWorker);const process=createGifChunkStreamProcessor(),abort=vi.fn();let resolveWrite:()=>void=()=>{};
  const chunks:Uint8Array[]=[],write=vi.fn((chunk:Uint8Array)=>{chunks.push(chunk);return new Promise<void>(r=>{resolveWrite=r;});});
  const opening=openGifChunkStream(settings(),{write,abort}),worker=FakeWorker.instances[0];
  const reply=()=>worker.onmessage!({data:{ok:true,...process(worker.postMessage.mock.lastCall![0])}});
  reply();const stream=await opening,frame=new Uint8Array([255,0,0,255]);
  const analyze=stream.analyze(frame);reply();await analyze;const seal=stream.seal();reply();await seal;
  const index=stream.index(frame);reply();await index;
  const finish=stream.finish();reply();await Promise.resolve();expect(write).toHaveBeenCalledOnce();
  expect(worker.postMessage.mock.lastCall![0].kind).toBe('finish');
  resolveWrite();await vi.waitFor(()=>expect(worker.postMessage.mock.lastCall![0].kind).toBe('ack-chunk'));
  reply();const result=await finish;expect(result.bytesWritten).toBe(chunks[0].length);expect(result.quantized).toBe(false);
  await stream.dispose();expect(abort).not.toHaveBeenCalled();expect(worker.terminate).toHaveBeenCalledOnce();
});
it('aborts failed/pending writes and suppresses late acknowledgments',async()=>{
  vi.stubGlobal('Worker',FakeWorker);
  for(const rejectWrite of [true,false]){
    const process=createGifChunkStreamProcessor(),abort=vi.fn();let settle:()=>void=()=>{};
    const write=()=>new Promise<void>((resolve,reject)=>{settle=()=>rejectWrite?reject(new Error('disk failure')):resolve();});
    const opening=openGifChunkStream(settings(),{write,abort}),worker=FakeWorker.instances.at(-1)!;
    const reply=()=>worker.onmessage!({data:{ok:true,...process(worker.postMessage.mock.lastCall![0])}});
    reply();const stream=await opening,frame=new Uint8Array([255,0,0,255]);
    const a=stream.analyze(frame);reply();await a;const b=stream.seal();reply();await b;const c=stream.index(frame);reply();await c;
    const finish=stream.finish(),assertion=expect(finish).rejects.toThrow();reply();await Promise.resolve();
    if(!rejectWrite)await stream.dispose();settle();await assertion;await stream.dispose();
    expect(abort).toHaveBeenCalledOnce();expect(worker.postMessage.mock.lastCall![0].kind).toBe('finish');expect(worker.terminate).toHaveBeenCalledOnce();
  }
});

it('expires idle destinations and exposes abort cleanup failures through dispose',async()=>{
  vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();
  const abort=vi.fn(()=>Promise.reject(new Error('abort failed'))),opening=openGifChunkStream(settings(),{write:()=>{},abort},{timeoutMs:10});
  const worker=FakeWorker.instances[0];worker.onmessage!({data:{ok:true,kind:'ack',seq:0,phase:'analyze',accepted:0}});
  const stream=await opening;await vi.advanceTimersByTimeAsync(10);
  await expect(stream.analyze(new Uint8Array(4))).rejects.toThrow(/timed out/);
  await expect(stream.dispose()).rejects.toThrow(/abort failed/);expect(abort).toHaveBeenCalledOnce();expect(worker.terminate).toHaveBeenCalledOnce();
});

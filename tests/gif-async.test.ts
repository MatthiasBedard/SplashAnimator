import {afterEach,expect,it,vi} from 'vitest';
import {encodeIndexedGif} from '../packages/export-video/src/gif';
import {prepareRgbaGif,type RgbaGifInput} from '../packages/export-video/src/gif-rgba';
const input=():RgbaGifInput=>({width:1,height:1,frames:[new Uint8Array([255,0,0,255])],fps:24,matte:[0,0,0],transparent:false});
import {encodeRgbaGifAsync} from '../packages/export-video/src/gif-async';

class FakeWorker {
  static instances:FakeWorker[]=[];
  onmessage:((event:{data:unknown})=>void)|null=null;
  onerror:((event:{preventDefault:()=>void})=>void)|null=null;
  onmessageerror:(()=>void)|null=null;
  terminate=vi.fn();postMessage=vi.fn();
  constructor(){FakeWorker.instances.push(this);}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
it('terminates GIF encoding after success, malformed output, errors and cancellation',async()=>{
  vi.stubGlobal('Worker',FakeWorker);
  for(const mode of ['success','malformed','failure','error','messageerror','cancel']){
    const controller=new AbortController(),project=input();
    const pending=encodeRgbaGifAsync(project,{signal:controller.signal});
    const worker=FakeWorker.instances.at(-1)!;
    expect(worker.postMessage).toHaveBeenCalledWith({input:project,maxBytes:512*1024*1024,maxIndexedBytes:512*1024*1024});
    const bytes=encodeIndexedGif(prepareRgbaGif(project).animation);
    const assertion=mode==='success'?expect(pending).resolves.toEqual({bytes,quantized:false}):expect(pending).rejects.toThrow();
    if(mode==='success')worker.onmessage!({data:{ok:true,bytes,quantized:false}});
    if(mode==='malformed')worker.onmessage!({data:{ok:true,bytes:12,quantized:false}});
    if(mode==='failure')worker.onmessage!({data:{ok:false,error:'Invalid artwork'}});
    if(mode==='error')worker.onerror!({preventDefault:()=>{}});
    if(mode==='messageerror')worker.onmessageerror!();
    if(mode==='cancel')controller.abort();
    await assertion;expect(worker.terminate).toHaveBeenCalledOnce();expect(worker.onmessage).toBeNull();
  }
});
it('rejects invalid deadlines and pre-aborts without workers, and terminates timed-out compilation',async()=>{
  vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();
  await expect(encodeRgbaGifAsync(input(),{timeoutMs:0})).rejects.toThrow(/deadline/);
  await expect(encodeRgbaGifAsync(input(),{signal:AbortSignal.abort()})).rejects.toThrow();
  expect(FakeWorker.instances).toHaveLength(0);
  const pending=encodeRgbaGifAsync(input(),{timeoutMs:10});
  const assertion=expect(pending).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(10);await assertion;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it('transfers only explicit full owned buffers, deduplicates aliases and rejects partial views before workers',async()=>{
  vi.stubGlobal('Worker',FakeWorker);
  const project=input(),buffer=project.frames[0].buffer;project.frames=[project.frames[0],project.frames[0]];
  const pending=encodeRgbaGifAsync(project,{transferFrames:true});const worker=FakeWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledWith({input:project,maxBytes:512*1024*1024,maxIndexedBytes:512*1024*1024},[buffer]);
  worker.onmessage!({data:{ok:true,bytes:encodeIndexedGif(prepareRgbaGif(project).animation),quantized:false}});await pending;
  const count=FakeWorker.instances.length;
  for(const frame of [new Uint8Array(8).subarray(0,4),new Uint8Array(8).subarray(4),new Uint8Array(0),new Uint8Array(new SharedArrayBuffer(4))])
    await expect(encodeRgbaGifAsync({...input(),frames:[frame]},{transferFrames:true})).rejects.toThrow(/buffers/);
  await expect(encodeRgbaGifAsync(input(),{transferFrames:true,signal:AbortSignal.abort()})).rejects.toThrow();
  expect(FakeWorker.instances.length).toBe(count);
});

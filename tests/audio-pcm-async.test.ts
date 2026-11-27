import {afterEach,expect,it,vi} from 'vitest';
import {mixTimelinePcm} from '../packages/audio/src/pcm';
import {mixTimelinePcmAsync} from '../packages/audio/src/pcm-async';
const options={startFrame:0,endFrame:4,fps:8000,sampleRate:8000,channelCount:1 as const};
const clips=()=>[{startFrame:0,sampleRate:8000,channels:[new Float32Array([0.5,-0.5])]}];
class FakeWorker{
 static instances:FakeWorker[]=[];
 onmessage:((event:{data:unknown})=>void)|null=null;onerror:((event:{preventDefault:()=>void})=>void)|null=null;onmessageerror:(()=>void)|null=null;
 terminate=vi.fn();postMessage=vi.fn();constructor(){FakeWorker.instances.push(this);}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
it('cleans up after success, malformed samples, failures, cancellation and message errors',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 for(const mode of ['success','nan','length','failure','cancel','error','messageerror']){
  const source=clips(),controller=new AbortController(),pending=mixTimelinePcmAsync(source,options,{signal:controller.signal}),worker=FakeWorker.instances.at(-1)!;
  const result=mixTimelinePcm(source,options),assertion=mode==='success'?expect(pending).resolves.toEqual(result):expect(pending).rejects.toThrow();
  if(mode==='nan')result.channels[0][0]=NaN;if(mode==='length')result.channels[0]=new Float32Array(1);
  if(['success','nan','length'].includes(mode))worker.onmessage!({data:{ok:true,result}});
  if(mode==='failure')worker.onmessage!({data:{ok:false,error:'mix failed'}});
  if(mode==='cancel')controller.abort(new Error('cancel mix'));
  if(mode==='error')worker.onerror!({preventDefault:()=>{}});if(mode==='messageerror')worker.onmessageerror!();
  await assertion;expect(worker.terminate).toHaveBeenCalledOnce();expect(worker.onmessage).toBeNull();expect(source[0].channels[0].length).toBe(2);
 }
});
it('rejects input backing-buffer budgets and preabort before worker creation',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 const source=clips();source[0].channels=[new Float32Array(new ArrayBuffer(1024),0,1)];
 await expect(mixTimelinePcmAsync(source,options,{maxInputBytes:4})).rejects.toThrow(/clone byte budget/);
 await expect(mixTimelinePcmAsync(clips(),options,{signal:AbortSignal.abort()})).rejects.toThrow();
 await expect(mixTimelinePcmAsync(clips(),options,{timeoutMs:0})).rejects.toThrow(/deadline/);
 expect(FakeWorker.instances).toHaveLength(0);
});
it('terminates expired jobs and ignores late results',async()=>{
 vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();
 const pending=mixTimelinePcmAsync(clips(),options,{timeoutMs:10}),worker=FakeWorker.instances[0],late=worker.onmessage!;
 const assertion=expect(pending).rejects.toThrow(/timed out/);await vi.advanceTimersByTimeAsync(10);await assertion;
 late({data:{ok:true,result:mixTimelinePcm(clips(),options)}});expect(worker.terminate).toHaveBeenCalledOnce();
});

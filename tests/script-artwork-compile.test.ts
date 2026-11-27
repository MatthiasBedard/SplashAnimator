import {afterEach,expect,it,vi} from 'vitest';
import {newProject} from '../packages/document/src';
import {compileScriptArtwork} from '../apps/editor/src/script-artwork-compile';

class FakeWorker {
  static instances:FakeWorker[]=[];
  onmessage:((event:{data:unknown})=>void)|null=null;
  onerror:((event:{preventDefault:()=>void})=>void)|null=null;
  onmessageerror:(()=>void)|null=null;
  terminate=vi.fn();postMessage=vi.fn();
  constructor(){FakeWorker.instances.push(this);}
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
it('terminates artwork compilation after success, malformed output, errors and cancellation',async()=>{
  vi.stubGlobal('Worker',FakeWorker);
  for(const mode of ['success','malformed','failure','error','messageerror','cancel']){
    const controller=new AbortController(),project=newProject();
    const pending=compileScriptArtwork(project,[{frame:0,tick:0}],{signal:controller.signal});
    const worker=FakeWorker.instances.at(-1)!;
    expect(worker.postMessage).toHaveBeenCalledWith({project,poses:[{frame:0,tick:0}]});
    const assertion=mode==='success'?expect(pending).resolves.toBe('<html></html>'):expect(pending).rejects.toThrow();
    if(mode==='success')worker.onmessage!({data:{ok:true,html:'<html></html>'}});
    if(mode==='malformed')worker.onmessage!({data:{ok:true,html:12}});
    if(mode==='failure')worker.onmessage!({data:{ok:false,error:'Invalid artwork'}});
    if(mode==='error')worker.onerror!({preventDefault:()=>{}});
    if(mode==='messageerror')worker.onmessageerror!();
    if(mode==='cancel')controller.abort();
    await assertion;expect(worker.terminate).toHaveBeenCalledOnce();expect(worker.onmessage).toBeNull();
  }
});
it('rejects invalid deadlines and pre-aborts without workers, and terminates timed-out compilation',async()=>{
  vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();
  await expect(compileScriptArtwork(newProject(),[],{timeoutMs:0})).rejects.toThrow(/deadline/);
  await expect(compileScriptArtwork(newProject(),[],{signal:AbortSignal.abort()})).rejects.toThrow();
  expect(FakeWorker.instances).toHaveLength(0);
  const pending=compileScriptArtwork(newProject(),[],{timeoutMs:10});
  const assertion=expect(pending).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(10);await assertion;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

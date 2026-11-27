import {afterEach,expect,it,vi} from 'vitest';
import {compileFrameSourceAsync,decodeCompiledFrame} from '../packages/scripting/src/compile-async';

class FakeWorker {
  static instances:FakeWorker[]=[];
  onmessage:((event:{data:unknown})=>void)|null=null;
  onerror:((event:{preventDefault:()=>void})=>void)|null=null;
  onmessageerror:(()=>void)|null=null;
  terminate=vi.fn();postMessage=vi.fn();
  constructor(){FakeWorker.instances.push(this);}
}
const success=JSON.stringify({body:'return 1;',sourceMap:'{}',sourceLineOffset:1,diagnostics:[]});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();FakeWorker.instances=[];});
it('cleans success, malformed response, worker errors and cancellation; subsequent jobs are independent',async()=>{
  vi.stubGlobal('Worker',FakeWorker);
  for(const mode of ['success','malformed','error','messageerror','cancel']){
    const controller=new AbortController();
    const pending=compileFrameSourceAsync('const n:number=1;',{signal:controller.signal});
    const worker=FakeWorker.instances.at(-1)!;
    const assertion=mode==='success'?expect(pending).resolves.toMatchObject({body:'return 1;'}):expect(pending).rejects.toThrow();
    if(mode==='success'||mode==='malformed')worker.onmessage!({data:mode==='success'?success:'{}'});
    if(mode==='error')worker.onerror!({preventDefault:()=>{}});
    if(mode==='messageerror')worker.onmessageerror!();
    if(mode==='cancel')controller.abort();
    await assertion;expect(worker.terminate).toHaveBeenCalledOnce();expect(worker.onmessage).toBeNull();
  }
  const pending=compileFrameSourceAsync('');FakeWorker.instances.at(-1)!.onmessage!({data:success});
  await expect(pending).resolves.toMatchObject({diagnostics:[]});
});
it('bounds startup inputs and deadlines and terminates timed out jobs',async()=>{
  vi.stubGlobal('Worker',FakeWorker);vi.useFakeTimers();
  await expect(compileFrameSourceAsync('é'.repeat(131073))).rejects.toThrow(/256/);
  await expect(compileFrameSourceAsync('',{timeoutMs:0})).rejects.toThrow(/deadline/);
  await expect(compileFrameSourceAsync('',{signal:AbortSignal.abort()})).rejects.toThrow(/cancelled/);
  expect(FakeWorker.instances).toHaveLength(0);
  const pending=compileFrameSourceAsync('',{timeoutMs:10});
  const assertion=expect(pending).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(10);await assertion;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
it('rejects oversized output and invalid diagnostic coordinates or mixed error/output',()=>{
  for(const value of [null,'x'.repeat(4*1024*1024+1),JSON.stringify({body:'x',sourceLineOffset:1,diagnostics:[{code:1,message:'error',line:0,column:1}]}),
    JSON.stringify({body:'x',sourceLineOffset:1,diagnostics:[{code:1,message:'error',line:1,column:1}]})])
    expect(()=>decodeCompiledFrame(value)).toThrow();
});
it('requires the compiler to return the exact requested source breakpoint',async()=>{
  vi.stubGlobal('Worker',FakeWorker);
  const pending=compileFrameSourceAsync('state.n=1;', {breakpointLine:1});
  const worker=FakeWorker.instances.at(-1)!;
  expect(worker.postMessage).toHaveBeenCalledWith({source:'state.n=1;',breakpointLine:1});
  worker.onmessage!({data:JSON.stringify({...JSON.parse(success),statementLocations:[{line:2,column:1}]})});
  await expect(pending).rejects.toThrow('Compiler breakpoint does not match the request');
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(()=>decodeCompiledFrame(JSON.stringify({...JSON.parse(success),statementLocations:[{line:2,column:3},{line:2,column:2}]})))
    .toThrow('Invalid compiler statement locations.');
});
it('rejects function pause locations without an unambiguous original call site',()=>{
  const base={...JSON.parse(success),statementLocations:[{line:1,column:1}]};
  const helper={name:'helper',points:[{line:3,column:2}],calls:[0]};
  expect(decodeCompiledFrame(JSON.stringify({...base,debugFunctions:[helper]})).debugFunctions).toEqual([helper]);
  expect(()=>decodeCompiledFrame(JSON.stringify({...base,debugFunctions:[{...helper,calls:[1]}]})))
    .toThrow('Invalid compiler function call site.');
  expect(()=>decodeCompiledFrame(JSON.stringify({...base,debugFunctions:[helper,{...helper,name:'other'}]})))
    .toThrow('Invalid compiler function call site.');
});

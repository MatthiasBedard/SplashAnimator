import {afterEach,expect,it,vi} from 'vitest';
import {compileScriptProgram} from '../packages/scripting/src/compile-program';
import {compileFrameSourceAsync} from '../packages/scripting/src/compile-async';
vi.mock('../packages/scripting/src/compile-async',()=>({compileFrameSourceAsync:vi.fn()}));
const compile=vi.mocked(compileFrameSourceAsync),config={duration:4,fps:24,seed:3};
const good={body:'timeline.stop();',sourceMap:'{}',sourceLineOffset:1,diagnostics:[]};
afterEach(()=>{vi.resetAllMocks();vi.useRealTimers();});
it('snapshots sources/config before awaits and publishes only complete detached tables',async()=>{
  const settings={...config},sources=[{frame:0,source:'one'},{frame:2,source:'two'}];
  compile.mockImplementationOnce(async()=>{sources[1].source='changed';settings.fps=60;return good;}).mockResolvedValue(good);
  const result=await compileScriptProgram(settings,sources);
  expect(compile.mock.calls.map(call=>call[0])).toEqual(['one','two']);
  expect(result.program?.config.fps).toBe(24);expect(result.program?.sourceIdentity).toContain('two');
  expect(result.program?.frames.map(entry=>entry.frame)).toEqual([0,2]);
  expect(result.program?.maps).toHaveLength(2);
});
it('attributes diagnostics and never returns a partial program',async()=>{
  compile.mockResolvedValueOnce(good).mockResolvedValue({sourceLineOffset:1,diagnostics:[{code:1,message:'bad',line:2,column:3}]});
  const result=await compileScriptProgram(config,[{frame:0,source:''},{frame:3,source:''}]);
  expect(result.program).toBeUndefined();expect(result.diagnostics).toEqual([{frame:3,code:1,message:'bad',line:2,column:3}]);
  expect(result.checkedFrames).toBe(2);
});
it('caps diagnostics and rejects aggregate output or invalid input',async()=>{
  compile.mockResolvedValue({sourceLineOffset:1,diagnostics:Array.from({length:50},()=>({code:1,message:'bad',line:1,column:1}))});
  const result=await compileScriptProgram(config,[0,1,2].map(frame=>({frame,source:''})));
  expect(result.diagnostics).toHaveLength(100);expect(result.checkedFrames).toBe(2);expect(result.totalFrames).toBe(3);
  compile.mockResolvedValue({...good,body:'x'.repeat(140000)});
  await expect(compileScriptProgram(config,[{frame:0,source:''},{frame:1,source:''}])).rejects.toThrow(/budget/);
  for(const frames of [[{frame:2,source:''},{frame:1,source:''}],[{frame:0,source:'é'.repeat(131073)}]])
    await expect(compileScriptProgram(config,frames)).rejects.toThrow();
});
it('enforces a whole-program deadline and cancellation without partial results',async()=>{
  vi.useFakeTimers();
  compile.mockImplementation((_source,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(new Error('worker aborted')))));
  const pending=compileScriptProgram(config,[{frame:0,source:''}],{timeoutMs:20});
  const check=expect(pending).rejects.toThrow(/timed out/);await vi.advanceTimersByTimeAsync(20);await check;
  const controller=new AbortController();
  const cancelled=compileScriptProgram(config,[{frame:0,source:''}],{signal:controller.signal});
  const assertion=expect(cancelled).rejects.toThrow();controller.abort();await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

import {expect,it,vi} from 'vitest';
import {newProject} from '../packages/document/src';
import {queryScriptArtworkTargets} from '../apps/editor/src/script-artwork';
import {compileScriptArtwork} from '../apps/editor/src/script-artwork-compile';
vi.mock('../apps/editor/src/script-artwork-compile',()=>({compileScriptArtwork:vi.fn()}));
it('rejects invalid coordinates, batches and deadlines before creating artwork workers',async()=>{
  const p=newProject(),poses=[{frame:0,tick:0}];
  for(const points of [[],[{x:NaN,y:0}],[{x:0,y:Infinity}],Array.from({length:65},()=>({x:0,y:0}))])
    await expect(queryScriptArtworkTargets(p,poses,points)).rejects.toThrow();
  for(const timeoutMs of [0,1.5,60001])await expect(queryScriptArtworkTargets(p,poses,[{x:0,y:0}],{timeoutMs})).rejects.toThrow(/deadline/);
  await expect(queryScriptArtworkTargets(p,[],[{x:0,y:0}])).rejects.toThrow(/trajectory/);
  const controller=new AbortController();controller.abort(new Error('cancel before compile'));
  await expect(queryScriptArtworkTargets(p,poses,[{x:0,y:0}],{signal:controller.signal})).rejects.toThrow('cancel before compile');
  expect(compileScriptArtwork).not.toHaveBeenCalled();
});

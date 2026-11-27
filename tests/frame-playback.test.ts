import {expect,it,vi,beforeEach} from 'vitest';
import {newProject} from '../packages/document/src';
const mock=vi.hoisted(()=>({seek:vi.fn(),dispose:vi.fn(),create:vi.fn()}));
vi.mock('../apps/editor/src/frame-replay',()=>({createFrameReplay:mock.create}));
import {playFrameRange} from '../apps/editor/src/frame-playback';
beforeEach(()=>{vi.clearAllMocks();mock.seek.mockImplementation(async()=>({width:1,height:1,data:new Uint8ClampedArray(4)}));mock.create.mockReturnValue({seek:mock.seek,dispose:mock.dispose})});
it('presents all requested frames in order and disposes at completion',async()=>{
 const p=newProject();p.duration=8;p.fps=240;const shown:number[]=[];
 expect(await playFrameRange(p,2,4,{signal:new AbortController().signal,validate:()=>{},present:(_,frame)=>shown.push(frame)})).toBe(3);
 expect(shown).toEqual([2,3,4]);expect(mock.seek.mock.calls.map(call=>call[0])).toEqual(shown);expect(mock.dispose).toHaveBeenCalledTimes(1);
});
it('cleans up on cancellation, stale source or failed presentation without showing later frames',async()=>{
 for(const mode of ['cancel','stale','paint']){
  vi.clearAllMocks();const p=newProject();p.duration=8;p.fps=240;const controller=new AbortController();let stale=false;const shown:number[]=[];
  await expect(playFrameRange(p,0,4,{signal:controller.signal,validate:()=>{if(stale)throw new Error('stale')},present:(_,frame)=>{shown.push(frame);if(mode==='cancel')controller.abort();if(mode==='stale')stale=true;if(mode==='paint')throw new Error('paint')}})).rejects.toThrow();
  expect(shown).toEqual([0]);expect(mock.dispose).toHaveBeenCalledTimes(1);
 }
});
it('cancels pacing waits and rejects invalid ranges before allocating replay',async()=>{
 const p=newProject();p.duration=8;p.fps=1;const controller=new AbortController();
 const pending=playFrameRange(p,0,4,{signal:controller.signal,validate:()=>{},present:()=>{setTimeout(()=>controller.abort(),0)}});
 await expect(pending).rejects.toThrow();expect(mock.seek).toHaveBeenCalledTimes(1);expect(mock.dispose).toHaveBeenCalledTimes(1);
 mock.create.mockClear();await expect(playFrameRange(p,4,2,{signal:new AbortController().signal,validate:()=>{},present:()=>{}})).rejects.toThrow(/valid playback/);expect(mock.create).not.toHaveBeenCalled();
});

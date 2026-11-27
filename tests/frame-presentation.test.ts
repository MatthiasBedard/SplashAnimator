import {beforeEach,describe,expect,it,vi} from 'vitest';
import {newProject} from '../packages/document/src';
const mock=vi.hoisted(()=>({seek:vi.fn(),dispose:vi.fn()}));
vi.mock('../apps/editor/src/frame-replay',()=>({createFrameReplay:()=>mock}));
import {createFramePresentation} from '../apps/editor/src/frame-presentation';
const pixels={} as ImageData;
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function pending(){let resolve!:(value:ImageData)=>void,reject!:(error:unknown)=>void;const promise=new Promise<ImageData>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
beforeEach(()=>{mock.seek.mockReset();mock.dispose.mockReset();});
describe('frame presentation ownership',()=>{
 it('coalesces clock targets, suppresses stale frames and serializes backward seeks',async()=>{
  const first=pending(),second=pending(),third=pending();mock.seek.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  const publish=vi.fn(),error=vi.fn(),session=createFramePresentation(newProject(),publish,error);
  session.request(0);session.request(3);session.request(7);session.request(7);
  expect(mock.seek.mock.calls).toEqual([[0]]);first.resolve(pixels);await flush();
  expect(publish).not.toHaveBeenCalled();expect(mock.seek.mock.calls).toEqual([[0],[7]]);
  session.request(2);second.resolve(pixels);await flush();expect(mock.seek.mock.calls).toEqual([[0],[7],[2]]);
  third.resolve(pixels);await flush();expect(publish.mock.calls).toEqual([[2,pixels]]);session.request(2);expect(mock.seek).toHaveBeenCalledTimes(3);expect(error).not.toHaveBeenCalled();session.dispose();
 });
 it('rejects invalid targets without replacing work and suppresses late results after disposal',async()=>{
  const work=pending();mock.seek.mockReturnValue(work.promise);const publish=vi.fn(),error=vi.fn(),session=createFramePresentation(newProject(),publish,error);
  session.request(1);for(const frame of [-1,NaN,0.5,Number.MAX_SAFE_INTEGER])expect(()=>session.request(frame)).toThrow('Invalid');
  session.dispose();session.dispose();work.resolve(pixels);await flush();expect(publish).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();expect(mock.dispose).toHaveBeenCalledTimes(1);expect(()=>session.request(0)).toThrow('disposed');
 });
 it('terminates on replay or publication failure and never runs queued work',async()=>{
  const work=pending();mock.seek.mockReturnValue(work.promise);const error=vi.fn(),session=createFramePresentation(newProject(),vi.fn(),error);session.request(0);session.request(3);const failure=new Error('render failed');work.reject(failure);await flush();expect(error).toHaveBeenCalledWith(failure);expect(mock.seek).toHaveBeenCalledTimes(1);expect(mock.dispose).toHaveBeenCalledTimes(1);
  mock.seek.mockResolvedValue(pixels);const callbackFailure=new Error('paint failed'),otherError=vi.fn(),other=createFramePresentation(newProject(),()=>{throw callbackFailure;},otherError);other.request(0);await flush();expect(otherError).toHaveBeenCalledWith(callbackFailure);expect(()=>other.request(1)).toThrow('disposed');
 });
 it('allows a publication callback to request the next frame without parallel replay',async()=>{
  mock.seek.mockResolvedValue(pixels);const frames:number[]=[],session=createFramePresentation(newProject(),frame=>{frames.push(frame);if(frame===0)session.request(1);},vi.fn());session.request(0);await flush();expect(frames).toEqual([0,1]);expect(mock.seek.mock.calls).toEqual([[0],[1]]);session.dispose();
 });
});


import {expect,it,vi} from 'vitest';
import {createGifWritableDestination} from '../packages/export-video/src/gif-destination';
it('locks provisional output and closes only for a matching receipt',async()=>{
  const close=vi.fn(),abort=vi.fn(),chunks:Uint8Array[]=[];
  const stream=new WritableStream<Uint8Array>({write:c=>{chunks.push(c.slice());},close,abort}),sink=createGifWritableDestination(stream,4),signal=new AbortController().signal;
  expect(stream.locked).toBe(true);await sink.write(new Uint8Array([1,2]),signal);
  await expect(sink.commit({bytesWritten:1},signal)).rejects.toThrow(/receipt/);expect(close).not.toHaveBeenCalled();
  await sink.write(new Uint8Array([3,4]),signal);await sink.commit({bytesWritten:4},signal);
  expect(close).toHaveBeenCalledOnce();expect(abort).not.toHaveBeenCalled();expect(stream.locked).toBe(false);expect(chunks.flatMap(c=>Array.from(c))).toEqual([1,2,3,4]);
});
it('waits for pending writes before abort cleanup and prevents later publication',async()=>{
  let finish:()=>void=()=>{};const abort=vi.fn(),close=vi.fn(),controller=new AbortController();
  const stream=new WritableStream<Uint8Array>({write:()=>new Promise<void>(r=>{finish=r;}),abort,close}),sink=createGifWritableDestination(stream);
  const pending=sink.write(new Uint8Array([1]),controller.signal),rejection=expect(pending).rejects.toThrow();await Promise.resolve();
  controller.abort(new Error('cancel'));finish();await rejection;await sink.abort('again');
  expect(abort).toHaveBeenCalledOnce();expect(close).not.toHaveBeenCalled();expect(stream.locked).toBe(false);
  await expect(sink.commit({bytesWritten:1},new AbortController().signal)).rejects.toThrow(/closed/);
});
it('rejects concurrent writes and budget overflow, and releases locks after failed commit',async()=>{
  let finish:()=>void=()=>{};const stream=new WritableStream<Uint8Array>({write:()=>new Promise<void>(r=>{finish=r;}),close:()=>{throw new Error('disk close failed');}});
  const sink=createGifWritableDestination(stream,1),signal=new AbortController().signal;
  const pending=sink.write(new Uint8Array([1]),signal);await Promise.resolve();await expect(sink.write(new Uint8Array([1]),signal)).rejects.toThrow(/busy/);
  finish();await pending;await expect(sink.write(new Uint8Array([1]),signal)).rejects.toThrow(/oversized/);
  await expect(sink.commit({bytesWritten:1},signal)).rejects.toThrow(/disk close failed/);await sink.abort('final cleanup');expect(stream.locked).toBe(false);
});

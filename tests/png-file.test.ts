import { expect, it, vi } from 'vitest';
import { openPNGWritable, discardPNGWritable, type PNGFileStream } from '../apps/editor/src/png-file';
const writable = (): PNGFileStream => ({ write: vi.fn(async()=>{}), close: vi.fn(async()=>{}), abort: vi.fn(async()=>{}) });

it('returns an open writable and never aborts an owned stream',async()=>{
  const stream=writable(),controller=new AbortController();
  expect(await openPNGWritable({createWritable:async()=>stream},controller.signal)).toBe(stream);
  controller.abort();expect(stream.abort).not.toHaveBeenCalled();
});

it('cancels opening immediately and discards a late writable without writes or close',async()=>{
  let resolve!: (stream:PNGFileStream)=>void;
  const controller=new AbortController(),stream=writable();
  const pending=openPNGWritable({createWritable:()=>new Promise(r=>{resolve=r;})},controller.signal);
  await Promise.resolve();controller.abort();await expect(pending).rejects.toThrow();
  resolve(stream);await new Promise(r=>setTimeout(r,0));
  expect(stream.abort).toHaveBeenCalledOnce();expect(stream.write).not.toHaveBeenCalled();expect(stream.close).not.toHaveBeenCalled();
});

it('bounds stalled opening and abort, discarding late output after timeout',async()=>{
  vi.useFakeTimers();
  try {
    let resolve!: (stream:PNGFileStream)=>void;
    const stream=writable(),controller=new AbortController();
    const pending=openPNGWritable({createWritable:()=>new Promise(r=>{resolve=r;})},controller.signal);
    const rejection=expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(60000);await rejection;
    resolve(stream);await vi.advanceTimersByTimeAsync(0);expect(stream.abort).toHaveBeenCalledOnce();
    stream.abort=vi.fn(()=>new Promise<void>(()=>{}));const discard=discardPNGWritable(stream);
    await vi.advanceTimersByTimeAsync(60000);await discard;expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});


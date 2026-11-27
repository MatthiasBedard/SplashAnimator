import { afterEach, expect, it, vi } from 'vitest';
import { executeIsolatedFrame } from '../packages/scripting/src/isolated-frame';
import { createScriptTimeline } from '../packages/scripting/src/timeline';

const checkpoint = createScriptTimeline({ duration: 1, fps: 24, seed: 0 }).checkpoint();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(['__TAURI_INTERNALS__', '__TAURI__'])('denies direct execution before allocating a frame with %s', marker => {
  const createElement = vi.fn();
  vi.stubGlobal('document', { createElement });
  vi.stubGlobal(marker, undefined);
  expect(() => executeIsolatedFrame('timeline.stop();', checkpoint)).toThrow('native application');
  expect(createElement).not.toHaveBeenCalled();
});

it('rechecks the host before sending source at iframe load and removes a rejected frame', async () => {
  const frame = {
    sandbox: { add: vi.fn() },
    contentWindow: { postMessage: vi.fn() },
    onload: null as null | (() => void),
    remove: vi.fn(),
  };
  vi.stubGlobal('document', { createElement: () => frame, body: { append: vi.fn() } });
  const result = executeIsolatedFrame('timeline.stop();', checkpoint);
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  frame.onload?.();
  await expect(result).rejects.toThrow('native application');
  expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
  expect(frame.remove).toHaveBeenCalledOnce();
});

it('still enforces the wall-clock deadline when the isolated frame cannot load', async () => {
  vi.useFakeTimers();
  const frame = { sandbox: { add: vi.fn() }, remove: vi.fn() };
  vi.stubGlobal('document', { createElement: () => frame, body: { append: vi.fn() } });
  const result = executeIsolatedFrame('timeline.stop();', checkpoint, { timeoutMs: 20 });
  const failed = expect(result).rejects.toThrow('Frame execution timed out.');
  await vi.advanceTimersByTimeAsync(20);
  await failed;
  expect(frame.remove).toHaveBeenCalledOnce();
});

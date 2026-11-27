import { expect, test, vi } from 'vitest';
import { waitForProjectFonts } from '../apps/editor/src/project-fonts';

test('closing one preview cancels its wait without cancelling the project load', async () => {
  let finish!: () => void;
  const fonts = new Promise<void>(resolve => { finish = resolve; });
  const discarded = new AbortController(), retained = new AbortController();
  const first = waitForProjectFonts(fonts, discarded.signal);
  const second = waitForProjectFonts(fonts, retained.signal);
  discarded.abort(Error('Preview closed.'));
  await expect(first).rejects.toThrow('Preview closed.');
  finish();
  await expect(second).resolves.toBeUndefined();
});

test('a stalled project font wait has a deadline and cleans up its timer', async () => {
  vi.useFakeTimers();
  try {
    const signal = new AbortController().signal;
    const rejecting = expect(waitForProjectFonts(new Promise<void>(() => {}), signal))
      .rejects.toThrow('Project fonts took too long to load.');
    await vi.advanceTimersByTimeAsync(60000);
    await rejecting;
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

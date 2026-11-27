import { expect, test, vi } from 'vitest';
import { createTimelineScrub } from '../apps/editor/src/timeline-scrub';

function setup() {
  let captured: number | undefined;
  const surface = {
    getBoundingClientRect: () => ({ left: 100, width: 180 }) as DOMRect,
    setPointerCapture: vi.fn((pointer: number) => { captured = pointer; }),
    hasPointerCapture: (pointer: number) => pointer === captured,
    releasePointerCapture: vi.fn(() => { captured = undefined; }),
  };
  const state = { project: {}, revision: 5, blocked: false, frameStart: 10, cellWidth: 18, duration: 100 };
  const seek = vi.fn();
  const scroll = vi.fn((frame: number) => { state.frameStart = frame; });
  const scrub = createTimelineScrub({ surface: () => surface, read: () => state, scroll, seek });
  const pointer = (clientX: number, pointerId = 3) => ({ clientX, pointerId, shiftKey: true });
  return { scrub, seek, scroll, pointer, state, surface };
}

test('ruler ownership preserves Shift selection, final seek and edge scrolling', () => {
  const { scrub, seek, scroll, pointer, state, surface } = setup();
  scrub.start(pointer(139), 10, 100);
  expect(seek).toHaveBeenLastCalledWith(12, true, false);
  scrub.move(pointer(250, 9));
  expect(seek).toHaveBeenCalledOnce();
  scrub.move(pointer(315));
  expect(seek).toHaveBeenLastCalledWith(19, true, false);
  expect(scrub.tick(89)).toBe(true);
  expect(scroll).not.toHaveBeenCalled();
  scrub.tick(90);
  expect(state.frameStart).toBeGreaterThan(10);
  scrub.finish(pointer(125));
  expect(seek).toHaveBeenLastCalledWith(state.frameStart + 1, true, false);
  expect(surface.releasePointerCapture).toHaveBeenCalledWith(3);
  expect(scrub.active).toBe(false);
});

test('changed project or revision ends a scrub before seeking or scrolling, and capture fallback remains a normal click', () => {
  const { scrub, seek, scroll, pointer, state, surface } = setup();
  scrub.start(pointer(139), 10, 100);
  scrub.move(pointer(315));
  state.revision++;
  scrub.tick(91);
  expect(scroll).not.toHaveBeenCalled();
  expect(seek).toHaveBeenCalledTimes(2);
  expect(scrub.active).toBe(false);

  surface.setPointerCapture.mockImplementationOnce(() => { throw Error('capture denied'); });
  scrub.start(pointer(139), 92, 100);
  expect(seek).toHaveBeenLastCalledWith(12, false, true);
  expect(scrub.active).toBe(false);

  scrub.start(pointer(139), 93, 100);
  state.project = {};
  scrub.finish(pointer(151));
  expect(seek).toHaveBeenLastCalledWith(12, true, false);
  expect(seek).toHaveBeenCalledTimes(4);
  expect(scrub.active).toBe(false);
});

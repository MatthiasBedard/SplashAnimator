import { expect, test, vi } from 'vitest';
import { createCanvasPan } from '../apps/editor/src/canvas-pan';

function fixture() {
  let position = { x: 10, y: -4 }, captured: number | undefined;
  const notify = vi.fn();
  const surface = {
    focus: vi.fn(),
    setPointerCapture: vi.fn((pointer: number) => { captured = pointer; }),
    hasPointerCapture: (pointer: number) => pointer === captured,
    releasePointerCapture: vi.fn(() => { captured = undefined; }),
  };
  let currentSurface = surface;
  const blocked = vi.fn(() => false);
  const nav = createCanvasPan({
    surface: () => currentSurface,
    blocked,
    point: event => ({ x: event.clientX * 2, y: event.clientY * .5 }),
    position: () => position,
    apply: next => { position = next; },
    setButtons: notify,
  });
  const sample = (clientX: number, clientY: number, buttons = 4, pointerId = 1) => ({
    clientX, clientY, buttons, pointerId, pointerType: 'mouse', preventDefault: vi.fn(),
  });
  return { surface, nav, blocked, sample, notify, read: () => position,
    replaceSurface: () => { currentSurface = { ...surface, releasePointerCapture: vi.fn() }; return currentSurface; } };
}

test('canvas pan admits one pointer and preserves the host coordinate map through final release', () => {
  const { surface, nav, sample, notify, read } = fixture();
  expect(nav.move(sample(0, 0))).toBe(false);
  const first = sample(23, 40);
  expect(nav.start(first, 4)).toBe(true);
  expect(first.preventDefault).toHaveBeenCalledOnce();
  expect(surface.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(surface.hasPointerCapture(1)).toBe(true);
  expect(notify).toHaveBeenLastCalledWith(4);
  expect(nav.start(sample(0, 0, 4, 2), 4)).toBe(false);
  expect(nav.move(sample(900, 900, 4, 2))).toBe(true);
  expect(nav.finish(sample(900, 900, 0, 2))).toBe(true);
  expect(read()).toEqual({ x: 10, y: -4 });
  nav.move(sample(50, 60));
  expect(read()).toEqual({ x: 64, y: 6 });
  nav.finish(sample(55, 62, 0));
  expect(read()).toEqual({ x: 74, y: 7 });
  expect(notify).toHaveBeenLastCalledWith();
  expect(surface.releasePointerCapture).toHaveBeenCalledOnce();
  expect(nav.finish(sample(60, 70, 0))).toBe(false);
});

test('failed or cancelled capture does not leave a stale owner, including after a surface swap', () => {
  const { surface, nav, sample, notify, replaceSurface, blocked } = fixture();
  expect(nav.start({ ...sample(0, 0), pointerType: 'touch' }, 4)).toBe(false);
  blocked.mockReturnValueOnce(true);
  expect(nav.start(sample(0, 0), 4)).toBe(false);
  expect(nav.start(sample(NaN, 0), 4)).toBe(false);
  surface.setPointerCapture.mockImplementationOnce(() => { throw Error('capture denied'); });
  nav.start(sample(0, 0), 4);
  expect(notify).toHaveBeenLastCalledWith();
  surface.focus.mockImplementationOnce(() => nav.end());
  nav.start(sample(0, 0), 4);
  expect(surface.hasPointerCapture(1)).toBe(false);

  nav.start(sample(0, 0, 1), 1);
  const replacement = replaceSurface();
  nav.end(2);
  expect(surface.hasPointerCapture(1)).toBe(true);
  nav.move(sample(12, 12, 0));
  expect(surface.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(replacement.releasePointerCapture).not.toHaveBeenCalled();
  expect(notify).toHaveBeenLastCalledWith();
  expect(nav.start(sample(0, 0), 4)).toBe(true);
  expect(replacement.hasPointerCapture(1)).toBe(true);
  nav.end();
});

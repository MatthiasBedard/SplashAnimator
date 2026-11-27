import { expect, test, vi } from 'vitest';
import { createStagePointer } from '../apps/editor/src/stage-pointer';

function fixture() {
  let capture: number | undefined, textPointer: number | undefined, sampledPointer: number | undefined;
  const route = { current: 'authored' as 'authored' | 'live-curve' | 'sampled' };
  const native = {
    setPointerCapture: vi.fn((pointer: number) => { capture = pointer; }),
    hasPointerCapture: (pointer: number) => capture === pointer,
    releasePointerCapture: vi.fn(() => { capture = undefined; }),
  };
  const host = {
    surface: () => native,
    navigation: { start: vi.fn(() => true), move: vi.fn(() => false), finish: vi.fn(() => false), end: vi.fn() },
    panActive: vi.fn(() => false),
    temporaryHand: vi.fn(() => false),
    clearFuturePick: vi.fn(),
    panAdmitted: vi.fn(),
    preparePress: vi.fn<() => boolean | null>(() => false),
    route: () => route.current,
    text: { pointer: () => textPointer, move: vi.fn(), up: vi.fn(),
      cancel: vi.fn(() => { textPointer = undefined; }) },
    live: { down: vi.fn(), move: vi.fn(), up: vi.fn(), cancel: vi.fn() },
    sampled: { pointer: () => sampledPointer, down: vi.fn(), move: vi.fn(), cancel: vi.fn() },
    authored: { hasGesture: vi.fn(() => true), down: vi.fn(), move: vi.fn(), up: vi.fn(), cancel: vi.fn(), released: vi.fn() },
  };
  const dispatch = createStagePointer(host);
  host.authored.cancel.mockImplementation(() => dispatch.release());
  const event = (pointerId = 1, button = 0) =>
    ({ pointerId, button, preventDefault: vi.fn() } as unknown as PointerEvent);
  return { host, route, dispatch, native, event,
    text: (id: number) => { textPointer = id; },
    sampled: (id: number) => { sampledPointer = id; } };
}

test('stage routes navigation, live, sampled and authored events in priority order', () => {
  const { host, route, dispatch, event } = fixture(), press = event();
  route.current = 'live-curve';
  dispatch.down(event(1, 1));
  expect(host.navigation.start).toHaveBeenCalledWith(expect.objectContaining({ button: 1 }), 4);
  expect(host.live.down).not.toHaveBeenCalled();

  host.preparePress.mockReturnValueOnce(null);
  dispatch.down(press);
  expect(host.live.down).not.toHaveBeenCalled();
  dispatch.down(press);
  dispatch.move(press);
  dispatch.up(press);
  expect(press.preventDefault).toHaveBeenCalledOnce();
  expect(host.live.down).toHaveBeenCalledWith(press);
  expect(host.live.move).toHaveBeenCalledWith(press);
  expect(host.live.up).toHaveBeenCalledWith(press);

  route.current = 'sampled';
  dispatch.down(press);
  dispatch.up(press);
  expect(host.sampled.down).toHaveBeenCalledWith(press);
  expect(host.sampled.move).toHaveBeenCalledWith(press, true);

  route.current = 'authored';
  dispatch.down(press);
  expect(host.authored.down).toHaveBeenCalledWith(press, false);
  expect(dispatch.capture(1)).toBe(true);
  dispatch.up(event(99));
  expect(host.authored.up).not.toHaveBeenCalled();
  dispatch.up(press);
  expect(host.authored.up).toHaveBeenCalledWith(press);
});

test('native interruption and failed capture cannot publish or keep an old authored owner', () => {
  const { host, dispatch, native, route, event, text, sampled } = fixture();
  native.setPointerCapture.mockImplementationOnce(() => { throw Error('capture denied'); });
  expect(dispatch.capture(1)).toBe(false);
  expect(dispatch.pointer).toBeUndefined();
  expect(dispatch.capture(1)).toBe(true);

  text(1);
  dispatch.move(event(22));
  dispatch.up(event(22));
  expect(host.text.move).not.toHaveBeenCalled();
  expect(host.text.up).not.toHaveBeenCalled();
  dispatch.interrupt(event(22), true);
  expect(dispatch.pointer).toBe(1);
  dispatch.interrupt(event(), true);
  expect(host.text.cancel).toHaveBeenCalledOnce();
  expect(native.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(dispatch.pointer).toBeUndefined();

  expect(dispatch.capture(3)).toBe(true);
  dispatch.blurAuthored();
  expect(host.authored.cancel).toHaveBeenCalledOnce();
  dispatch.up(event(3));
  expect(host.authored.up).not.toHaveBeenCalled();
  route.current = 'live-curve';
  sampled(4);
  dispatch.interrupt(event(4), true);
  expect(host.live.cancel).not.toHaveBeenCalled();
  expect(host.sampled.cancel).toHaveBeenCalledOnce();
  dispatch.interrupt(event(4), false);
  expect(host.live.cancel).toHaveBeenCalledOnce();
});

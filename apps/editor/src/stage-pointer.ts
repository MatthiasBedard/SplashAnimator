import type { createCanvasPan } from './canvas-pan';

type Surface = Pick<HTMLCanvasElement, 'setPointerCapture' | 'hasPointerCapture' | 'releasePointerCapture'>;
type Route = 'authored' | 'live-curve' | 'sampled';
type Host = {
  surface: () => Surface;
  navigation: ReturnType<typeof createCanvasPan>;
  panActive: () => boolean;
  temporaryHand: () => boolean;
  clearFuturePick: () => void;
  panAdmitted: () => void;
  preparePress: (event: PointerEvent) => boolean | null;
  route: () => Route;
  text: {
    pointer: () => number | undefined;
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: () => void;
  };
  live: {
    down: (event: PointerEvent) => void;
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: () => void;
  };
  sampled: {
    pointer: () => number | undefined;
    down: (event: PointerEvent) => void;
    move: (event: PointerEvent, finish: boolean) => void;
    cancel: () => void;
  };
  authored: {
    hasGesture: () => boolean;
    down: (event: PointerEvent, temporarySelect: boolean) => void;
    move: (event: PointerEvent, flushNode: boolean) => void;
    up: (event: PointerEvent) => void;
    cancel: () => void;
    released: (pointer: number) => void;
  };
};

export function createStagePointer(host: Host) {
  let authored: { surface: Surface; pointer: number } | undefined;

  function release() {
    const capture = authored;
    if (!capture) return;
    authored = undefined;
    host.authored.released(capture.pointer);
    if (capture.surface.hasPointerCapture(capture.pointer))
      capture.surface.releasePointerCapture(capture.pointer);
  }

  function capture(pointer: number) {
    if (authored) return false;
    const owner = { surface: host.surface(), pointer };
    authored = owner;
    try { owner.surface.setPointerCapture(pointer); }
    catch {
      if (authored === owner) release();
      return false;
    }
    if (authored !== owner) {
      const next = authored as typeof owner | undefined;
      if ((!next || next.surface !== owner.surface || next.pointer !== pointer) &&
          owner.surface.hasPointerCapture(pointer)) owner.surface.releasePointerCapture(pointer);
      return false;
    }
    return true;
  }

  function down(event: PointerEvent) {
    host.clearFuturePick();
    const pan = event.button === 1 ? 4 : event.button === 0 && host.temporaryHand() ? 1 : null;
    if (pan) {
      if (host.navigation.start(event, pan)) host.panAdmitted();
      return;
    }
    if (host.panActive()) { event.preventDefault(); return; }

    const temporarySelect = host.preparePress(event);
    if (temporarySelect === null) return;
    const route = host.route();
    if (route === 'live-curve') {
      event.preventDefault();
      host.live.down(event);
    } else if (route === 'sampled') host.sampled.down(event);
    else host.authored.down(event, temporarySelect);
  }

  function move(event: PointerEvent, flushNode = false) {
    const text = host.text.pointer();
    if (text !== undefined) {
      if (text === event.pointerId) host.text.move(event);
      return;
    }
    if (host.navigation.move(event) || host.temporaryHand()) return;
    const route = host.route();
    if (route === 'live-curve') host.live.move(event);
    else if (route === 'sampled') host.sampled.move(event, false);
    else host.authored.move(event, flushNode);
  }

  function up(event: PointerEvent) {
    const text = host.text.pointer();
    if (text !== undefined) {
      if (text === event.pointerId) host.text.up(event);
      return;
    }
    if (host.navigation.finish(event)) return;
    const route = host.route();
    if (route === 'live-curve') host.live.up(event);
    else if (route === 'sampled') host.sampled.move(event, true);
    else if (authored?.pointer === event.pointerId) host.authored.up(event);
  }

  function cancelText() {
    const pointer = host.text.pointer();
    if (pointer === undefined) return false;
    host.text.cancel();
    if (pointer === authored?.pointer) release();
    return true;
  }

  function interrupt(event: PointerEvent, lost: boolean) {
    const owner = authored;
    if (host.text.pointer() === event.pointerId) cancelText();
    host.navigation.end(event.pointerId);
    if (!lost && host.route() === 'live-curve') host.live.cancel();
    if (host.sampled.pointer() === event.pointerId) host.sampled.cancel();
    if (owner?.pointer !== event.pointerId || authored !== owner) return;
    if (!lost || host.authored.hasGesture()) host.authored.cancel();
    else release();
  }

  function blurAuthored() {
    if (cancelText()) return;
    if (host.authored.hasGesture()) host.authored.cancel();
    else release();
  }

  return { get pointer() { return authored?.pointer; }, capture, release, down, move, up, interrupt, cancelText, blurAuthored };
}

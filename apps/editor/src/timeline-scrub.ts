import { timelineScrollStep } from '../../../packages/animation/src/timeline';

type Surface = Pick<HTMLCanvasElement, 'getBoundingClientRect' | 'setPointerCapture' |
  'hasPointerCapture' | 'releasePointerCapture'>;
type Source<T> = { project: T; revision: number; blocked: boolean; frameStart: number;
  cellWidth: number; duration: number };
type ScrubHost<T> = {
  surface: () => Surface;
  read: () => Source<T>;
  scroll: (frameStart: number) => void;
  seek: (frame: number, extend: boolean, reveal: boolean) => void;
};
type ScrubPointer = Pick<PointerEvent, 'pointerId' | 'clientX' | 'shiftKey'>;
type Session<T> = { surface: Surface; pointer: number; document: T; revision: number;
  extend: boolean; x: number; time: number };

export function createTimelineScrub<T>(host: ScrubHost<T>) {
  let active: Session<T> | undefined;

  function end(pointer = active?.pointer) {
    const session = active;
    if (!session || session.pointer !== pointer) return;
    active = undefined;
    if (session.surface.hasPointerCapture(session.pointer))
      session.surface.releasePointerCapture(session.pointer);
  }

  function current(session: Session<T>) {
    const source = host.read();
    if (active !== session) return;
    if (source.blocked || source.project !== session.document || source.revision !== session.revision) {
      end(session.pointer);
      return;
    }
    return source;
  }

  function seek(session: Session<T>, clientX: number) {
    if (!current(session) || !Number.isFinite(clientX)) return;
    const rect = session.surface.getBoundingClientRect();
    const source = current(session);
    if (!source) return;
    const x = Math.max(0, Math.min(rect.width - 1, clientX - rect.left));
    host.seek(source.frameStart + Math.floor(x / source.cellWidth), session.extend, false);
  }

  function start(event: ScrubPointer, time: number, rulerLeft: number) {
    const source = host.read();
    if (active || source.blocked || !Number.isFinite(event.clientX)) return;
    const session = { surface: host.surface(), pointer: event.pointerId, document: source.project,
      revision: source.revision, extend: event.shiftKey, x: event.clientX, time };
    active = session;
    try {
      session.surface.setPointerCapture(session.pointer);
    } catch {
      const fallback = current(session);
      end(session.pointer);
      if (fallback) host.seek(fallback.frameStart + Math.floor((event.clientX - rulerLeft) / fallback.cellWidth), false, true);
      return;
    }
    seek(session, event.clientX);
  }

  function move(event: ScrubPointer) {
    const session = active;
    if (!session) return false;
    if (event.pointerId === session.pointer && Number.isFinite(event.clientX)) {
      session.x = event.clientX;
      seek(session, session.x);
    }
    return true;
  }

  function finish(event: ScrubPointer) {
    const session = active;
    if (!session) return false;
    if (event.pointerId === session.pointer) {
      seek(session, event.clientX);
      if (active === session) end(session.pointer);
    }
    return true;
  }

  function tick(time: number) {
    const session = active;
    if (!session) return false;
    if (time - session.time >= 80 && current(session)) {
      session.time = time;
      const rect = session.surface.getBoundingClientRect();
      const source = current(session);
      if (source) {
        host.scroll(timelineScrollStep(source.frameStart, session.x - rect.left, rect.width, source.duration, source.cellWidth));
        seek(session, session.x);
      }
    }
    return true;
  }

  return { get active() { return !!active; }, start, move, finish, end, tick };
}

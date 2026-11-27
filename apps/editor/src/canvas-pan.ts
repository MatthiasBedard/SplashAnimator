import type { Point } from '../../../packages/document/src';

type PanButtons = 1 | 4;
type PointerSample = Pick<PointerEvent, 'pointerId' | 'pointerType' | 'buttons' | 'clientX' | 'clientY' | 'preventDefault'>;
type Surface = Pick<HTMLElement, 'focus' | 'setPointerCapture' | 'hasPointerCapture' | 'releasePointerCapture'>;
type CanvasPanHost = {
  surface: () => Surface;
  blocked: () => boolean;
  point: (event: PointerSample) => Point;
  position: () => Point;
  apply: (position: Point) => void;
  setButtons: (buttons?: PanButtons) => void;
};
type Session = { surface: Surface; pointer: number; buttons: PanButtons; start: Point; origin: Point };
const finitePoint = ({ x, y }: Point) => Number.isFinite(x) && Number.isFinite(y);

export function createCanvasPan(host: CanvasPanHost) {
  let active: Session | undefined;

  function end(pointer = active?.pointer) {
    const session = active;
    if (!session || session.pointer !== pointer) return;
    active = undefined;
    host.setButtons();
    if (session.surface.hasPointerCapture(session.pointer))
      session.surface.releasePointerCapture(session.pointer);
  }

  function start(event: PointerSample, buttons: PanButtons) {
    event.preventDefault();
    if (active || event.pointerType === 'touch' || host.blocked() ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    const start = host.point(event);
    const origin = host.position();
    if (active || !finitePoint(start) || !finitePoint(origin)) return false;

    const session = { surface: host.surface(), pointer: event.pointerId, buttons,
      start, origin: { ...origin } };
    active = session;
    try {
      session.surface.focus({ preventScroll: true });
      if (active !== session) return true;
      session.surface.setPointerCapture(session.pointer);
      if (active === session) host.setButtons(buttons);
      else if ((!active || active.surface !== session.surface || active.pointer !== session.pointer) &&
          session.surface.hasPointerCapture(session.pointer))
        session.surface.releasePointerCapture(session.pointer);
    } catch {
      if (active === session) end(session.pointer);
    }
    return true;
  }

  function update(event: PointerSample, session: Session) {
    const point = host.point(event);
    if (active !== session || !finitePoint(point)) return;
    host.apply({
      x: session.origin.x + point.x - session.start.x,
      y: session.origin.y + point.y - session.start.y,
    });
  }

  function move(event: PointerSample) {
    const session = active;
    if (!session) return false;
    if (event.pointerId === session.pointer) {
      if (event.buttons & session.buttons) update(event, session);
      else end(session.pointer);
    }
    return true;
  }

  function finish(event: PointerSample) {
    const session = active;
    if (!session) return false;
    if (event.pointerId === session.pointer) {
      update(event, session);
      if (active === session && !(event.buttons & session.buttons)) end(session.pointer);
    }
    return true;
  }

  return { start, move, finish, end };
}

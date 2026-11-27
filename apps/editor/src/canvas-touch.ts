import type { Point } from '../../../packages/document/src';
import type { TouchMode } from './editor-preferences';

type Host = {
  surface: () => HTMLCanvasElement;
  mode: () => TouchMode;
  pinch: () => boolean;
  blocked: () => boolean;
  context: () => string;
  point: (event: PointerEvent) => Point;
  navigate: (scale: number, from: Point, to: Point) => void;
  cancelTool: () => void;
};

export function createCanvasTouch(host: Host) {
  let owner: { surface: HTMLCanvasElement; context: string; contacts: Map<number, Point>; mode: TouchMode; tool: boolean } | undefined;

  function release(surface: HTMLCanvasElement, pointer: number) {
    if (surface.hasPointerCapture(pointer)) surface.releasePointerCapture(pointer);
  }

  function end() {
    const current = owner;
    owner = undefined;
    if (!current) return;
    if (current.tool) host.cancelTool();
    for (const pointer of current.contacts.keys()) release(current.surface, pointer);
  }

  function current() {
    if (owner && (host.surface() !== owner.surface || host.context() !== owner.context)) end();
    return owner;
  }

  function capture(surface: HTMLCanvasElement, pointer: number) {
    try { surface.setPointerCapture(pointer); }
    catch { end(); }
  }

  function down(event: PointerEvent): boolean {
    if (event.pointerType !== 'touch') {
      if (event.pointerType === 'pen') end();
      return !!owner;
    }
    event.preventDefault();
    const point = host.point(event);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return true;
    const active = current();
    if (!active) {
      if (host.blocked()) return true;
      const surface = host.surface();
      const mode = host.mode();
      if (mode === 'ignore' && !host.pinch()) return true;
      const tool = mode === 'tool';
      owner = { surface, context: host.context(), contacts: new Map([[event.pointerId, point]]), mode, tool };
      if (!tool) capture(surface, event.pointerId);
      return !tool;
    }
    if (!host.pinch() || active.contacts.size !== 1 || active.contacts.has(event.pointerId)) return true;
    if (active.tool) {
      active.tool = false;
      host.cancelTool();
      capture(active.surface, [...active.contacts.keys()][0]);
      if (owner !== active) return true;
    }
    active.contacts.set(event.pointerId, point);
    capture(active.surface, event.pointerId);
    return true;
  }

  function pose(contacts: Map<number, Point>) {
    const [a, b] = contacts.values();
    return b
      ? { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) }
      : { center: a, distance: 0 };
  }

  function move(event: PointerEvent): boolean {
    if (event.pointerType !== 'touch') return !!owner;
    const active = current();
    if (!active?.contacts.has(event.pointerId)) return true;
    if (active.tool) {
      active.contacts.set(event.pointerId, host.point(event));
      return false;
    }
    const before = pose(active.contacts);
    const point = host.point(event);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return true;
    active.contacts.set(event.pointerId, point);
    if (active.mode === 'ignore' && active.contacts.size === 1) return true;
    const after = pose(active.contacts);
    const scale = before.distance >= 4 && after.distance >= 4 ? after.distance / before.distance : 1;
    host.navigate(scale, before.center, after.center);
    return true;
  }

  function finish(event: PointerEvent, interrupted = false, lost = false): boolean {
    if (event.pointerType !== 'touch') return false;
    const active = current();
    if (!active?.contacts.has(event.pointerId)) return true;
    // A tool-to-pinch handoff may already have reacquired the pointer.
    if (lost && active.surface.hasPointerCapture(event.pointerId)) return true;
    if (active.tool && !interrupted) {
      owner = undefined;
      return false;
    }
    if (interrupted) end();
    else {
      active.contacts.delete(event.pointerId);
      if (!active.contacts.size) owner = undefined;
      release(active.surface, event.pointerId);
    }
    return true;
  }

  return { down, move, finish, end, get active() { return !!owner; } };
}

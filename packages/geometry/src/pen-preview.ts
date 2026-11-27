import type { Point, Vector } from '@splash/document';
import { matrix, mapPoint } from './affine';
import { snapRay } from './snapping';
/** Shared endpoint priority for Pen click handling and its session-only preview. */
export function penPreview(s: Vector, pointer: Point, zoom: number, angleIncrement = 0) {
  const nodes = s.nodes;
  if (!nodes?.length || !Number.isFinite(zoom) || zoom <= 0) return;
  const m = matrix(s),
    last = nodes.at(-1)!,
    from = mapPoint(m, last),
    first = mapPoint(m, nodes[0]);
  if (Math.hypot(pointer.x - from.x, pointer.y - from.y) < 9 / zoom)
    return { kind: 'corner' as const, from, out: from, into: from, to: from };
  const closing =
    nodes.length > 2 && Math.hypot(pointer.x - first.x, pointer.y - first.y) < 9 / zoom;
  const snapped = !closing && angleIncrement > 0 ? snapRay(from, pointer, angleIncrement) : undefined;
  const to = closing ? first : snapped?.point ?? pointer;
  return {
    kind: closing ? ('close' as const) : ('segment' as const),
    from,
    out: mapPoint(m, last.out ?? last),
    into: closing ? mapPoint(m, nodes[0].in ?? nodes[0]) : to,
    to,
  };
}

/** Nearest open endpoint, measured in screen pixels after affine placement. */
export function penEndpoint(s: Vector, pointer: Point, zoom: number) {
  if (
    s.kind !== 'bezier' ||
    s.closed ||
    !s.nodes ||
    s.nodes.length < 2 ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  )
    return;
  const m = matrix(s);
  let result: { index: number; point: Point } | undefined,
    best = 9 / zoom;
  for (const index of [0, s.nodes.length - 1]) {
    const point = mapPoint(m, s.nodes[index]),
      distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
    if (distance < best) {
      best = distance;
      result = { index, point };
    }
  }
  return result;
}

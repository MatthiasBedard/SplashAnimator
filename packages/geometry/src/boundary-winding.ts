import type { Point } from '@splash/document';
import { boundsIndex } from './bounds-index';
import { crossesHorizontalRay, horizontalRayIntersectionX } from './drawing';

type Run = {
  start: Point;
  end: Point;
  top: number;
  bottom: number;
  left: number;
  right: number;
  halves?: [Run, Run];
};

/** Index consecutive segments of each sampled ring for repeated seam-side queries. */
export function boundaryContains(paths: Point[][], evenodd: boolean, tick: () => void) {
  const rings: Run[] = [], unbounded: Run[] = [];
  for (const points of paths) {
    if (!points.length) continue;
    function build(from: number, to: number): Run {
      tick();
      const start = points[from], end = points[to % points.length];
      if (to - from === 1) {
        let left = Infinity, right = -Infinity;
        if (start.y !== end.y) {
          const a = evenodd ? end : start, b = evenodd ? start : end;
          const x0 = horizontalRayIntersectionX(a, b, a.y);
          const x1 = horizontalRayIntersectionX(a, b, b.y);
          // The computed crossing is monotone between these two evaluations.
          // If arithmetic overflows, leave the decision to the original ray test.
          left = Number.isFinite(x0) && Number.isFinite(x1) ? Math.min(x0, x1) : -Infinity;
          right = Number.isFinite(x0) && Number.isFinite(x1) ? Math.max(x0, x1) : Infinity;
        }
        return { start, end, left, right, top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) };
      }
      const middle = from + Math.floor((to - from) / 2);
      const first = build(from, middle), second = build(middle, to);
      return {
        start, end, halves: [first, second],
        top: Math.min(first.top, second.top), bottom: Math.max(first.bottom, second.bottom),
        left: Math.min(first.left, second.left), right: Math.max(first.right, second.right),
      };
    }
    // The legacy even-odd loop tests the closing edge first in reverse orientation.
    // Preserve orientation for its exact crossing arithmetic. Parity is order independent.
    const ring = build(0, points.length);
    if (ring.left > ring.right) continue;
    if ([ring.left, ring.right, ring.top, ring.bottom].every(Number.isFinite)) rings.push(ring);
    else unbounded.push(ring);
  }
  const lookup = boundsIndex(rings);

  function winding(run: Run, p: Point): number {
    tick();
    if (p.y < run.top || p.y >= run.bottom || p.x >= run.right) return 0;
    const { start, end, halves } = run;
    const net = Number(end.y > p.y) - Number(start.y > p.y);
    // For a whole run to the right of the ray origin, consecutive upward and
    // downward crossings cancel. Only its first and last endpoints matter.
    if (p.x < run.left) return net;
    if (halves) return winding(halves[0], p) + winding(halves[1], p);
    return (evenodd ? crossesHorizontalRay(end, start, p) : crossesHorizontalRay(start, end, p)) ? net : 0;
  }

  return (p: Point) => {
    let total = 0;
    // A closed ring contributes zero outside its own crossing bounds.
    for (const i of lookup({ left: p.x, right: p.x, top: p.y, bottom: p.y })) total += winding(rings[i], p);
    for (const ring of unbounded) total += winding(ring, p);
    return evenodd ? total % 2 !== 0 : total !== 0;
  };
}

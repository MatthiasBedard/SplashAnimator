import type { Point } from '@splash/document';
import { splitCubic, type Cubic } from './curve-fit';

export function cubicInterval(c: Cubic, start: number, end: number): Cubic {
  if (start > end) return [...cubicInterval(c, end, start)].reverse() as Cubic;
  const left = end === 1 ? c : splitCubic(c, end)[0];
  return start === 0 ? left : splitCubic(left, start / end)[1];
}

// An arbitrary subcurve has the same control polygon after exact subdivision.
// A monotone coordinate gives a unique parameter for each of its endpoints.
export function monotoneAxis(source: Cubic) {
  const axes = (['x', 'y'] as const).filter(axis => {
    const direction = Math.sign(source[3][axis] - source[0][axis]);
    return direction && source.every((p, i) => !i || direction * (p[axis] - source[i - 1][axis]) >= 0);
  });
  return axes.sort((a, b) => Math.abs(source[3][b] - source[0][b]) - Math.abs(source[3][a] - source[0][a]))[0];
}

export function monotoneInterval(source: Cubic, target: Cubic, equal: (a: Point, b: Point) => boolean, tick: () => void) {
  const axis = monotoneAxis(source);
  if (!axis) return;
  const first = source[0][axis], last = source[3][axis], direction = Math.sign(last - first);
  const parameter = (p: Point) => {
    if (equal(p, source[0])) return 0;
    if (equal(p, source[3])) return 1;
    if (p[axis] <= Math.min(first, last) || p[axis] >= Math.max(first, last)) return;
    let lo = 0, hi = 1;
    for (let i = 0; i < 53; i++) {
      tick();
      const mid = (lo + hi) / 2;
      const value = splitCubic(source, mid)[0][3][axis];
      if (value === p[axis]) return mid;
      if (direction * (value - p[axis]) < 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const start = parameter(target[0]), end = parameter(target[3]);
  if (start === undefined || end === undefined || start === end) return;
  const part = cubicInterval(source, start, end);
  if (target.every((p, i) => equal(p, part[i]))) return { start, end };
}

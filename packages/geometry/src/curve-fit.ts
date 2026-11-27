import { measureCurveJoins, smoothCurveJoins } from './curve-joins';
import type { Point, BezierNode } from '@splash/document';
export type Cubic = [Point, Point, Point, Point];
export const CURVE_FIT_WORK_LIMIT = 200000;
const FIT_WINDOW_SAMPLES = 8192;
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const a = mix(c[0], c[1], t),
    b = mix(c[1], c[2], t),
    d = mix(c[2], c[3], t),
    e = mix(a, b, t),
    f = mix(b, d, t),
    p = mix(e, f, t);
  return [
    [c[0], a, e, p],
    [p, f, d, c[3]],
  ];
}
function interval(c: Cubic, start: number, end: number): Cubic {
  const left = end === 1 ? c : splitCubic(c, end)[0];
  return start === 0 ? left : splitCubic(left, start / end)[1];
}
function line(a: Point, b: Point): Cubic {
  return [a, mix(a, b, 1 / 3), mix(a, b, 2 / 3), b];
}
/** Conservative parameter-correspondence error: the difference between a cubic
 * piece and its source line is a cubic whose control hull bounds every point.
 * This is stronger than checking only input samples, but is not a topology test.
 */
export function segmentError(c: Cubic, a: Point, b: Point, start: number, end: number): number {
  // Subdivide the difference in a nearby coordinate system. Absolute-coordinate
  // interpolation otherwise introduces artificial error on translated artwork.
  const piece = interval(c.map((p) => ({ x: p.x - a.x, y: p.y - a.y })) as Cubic, start, end),
    straight = line({ x: 0, y: 0 }, { x: b.x - a.x, y: b.y - a.y });
  return Math.max(...piece.map((p, i) => Math.hypot(p.x - straight[i].x, p.y - straight[i].y)));
}
function candidate(points: Point[], ts: number[]): Cubic {
  const a = points[0],
    z = points.at(-1)!;
  // Solve in coordinates relative to the first anchor to avoid subtracting
  // large translated coordinates inside the least-squares residual.
  let aa = 0,
    ab = 0,
    bb = 0,
    ax = 0,
    ay = 0,
    bx = 0,
    by = 0;
  points.forEach((p, i) => {
    const t = ts[i],
      u = 1 - t,
      A = 3 * u * u * t,
      B = 3 * u * t * t,
      x = p.x - a.x - t ** 3 * (z.x - a.x),
      y = p.y - a.y - t ** 3 * (z.y - a.y);
    aa += A * A;
    ab += A * B;
    bb += B * B;
    ax += A * x;
    ay += A * y;
    bx += B * x;
    by += B * y;
  });
  const det = aa * bb - ab * ab;
  if (det <= 1e-12) return line(a, z);
  return [
    a,
    { x: a.x + (ax * bb - bx * ab) / det, y: a.y + (ay * bb - by * ab) / det },
    { x: a.x + (bx * aa - ax * ab) / det, y: a.y + (by * aa - ay * ab) / det },
    z,
  ];
}
export interface CurveFit {
  curves: Cubic[];
  nodes: BezierNode[];
  closed: boolean;
  maxError: number;
  work: number;
  joins: ReturnType<typeof measureCurveJoins>;
}
/** Standalone, non-mutating fitter. Coordinates/tolerance use the same space.
 * Supply world-space points for document-space accuracy. Work exhaustion rejects
 * the entire operation. Compound callers apply separate topology screening.
 */
export function fitPolyline(
  input: Point[],
  tolerance = 0.25,
  closed = false,
  cornerTolerance = 0,
  dense?: { workLimit: number; windowSamples?: number },
): CurveFit {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw Error('Invalid curve-fit tolerance');
  if (!Number.isFinite(cornerTolerance) || cornerTolerance < 0 || cornerTolerance > tolerance)
    throw Error('Invalid curve-fit corner allowance');
  const workLimit = dense?.workLimit ?? CURVE_FIT_WORK_LIMIT;
  const windowSamples = dense?.windowSamples;
  if (
    !Number.isSafeInteger(workLimit) ||
    workLimit <= 0 ||
    workLimit > CURVE_FIT_WORK_LIMIT ||
    input.length > (dense ? workLimit : FIT_WINDOW_SAMPLES) ||
    (windowSamples !== undefined && (!Number.isSafeInteger(windowSamples) || windowSamples < 2))
  )
    throw Error('Too many curve-fit samples');
  if (
    input.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 1e12 ||
        Math.abs(p.y) > 1e12,
    )
  )
    throw Error('Invalid curve-fit point');
  const points = input
    .filter((p, i) => !i || p.x !== input[i - 1].x || p.y !== input[i - 1].y)
    .map((p) => ({ x: p.x, y: p.y }));
  if (
    closed &&
    points.length > 1 &&
    points[0].x === points.at(-1)!.x &&
    points[0].y === points.at(-1)!.y
  )
    points.pop();
  if (points.length < (closed ? 3 : 2)) throw Error('Not enough curve-fit points');
  const ends = [0],
    corners = new Set<number>();
  // Keep sharp corners as segment boundaries instead of rounding through them.
  for (let i = closed ? 0 : 1; i < (closed ? points.length : points.length - 1); i++) {
    const a = points[(i - 1 + points.length) % points.length],
      b = points[i],
      c = points[(i + 1) % points.length],
      ux = b.x - a.x,
      uy = b.y - a.y,
      vx = c.x - b.x,
      vy = c.y - b.y;
    const chord = Math.hypot(c.x - a.x, c.y - a.y);
    const height = chord
      ? Math.abs(ux * (c.y - a.y) - uy * (c.x - a.x)) / chord
      : Math.hypot(ux, uy);
    if (
      (ux * vx + uy * vy) / Math.hypot(ux, uy) / Math.hypot(vx, vy) < Math.SQRT1_2 &&
      (!cornerTolerance || height > 2 * cornerTolerance)
    ) {
      ends.push(i);
      corners.add(i);
    }
  }
  if (closed) {
    ends.push(Math.floor(points.length / 2));
    points.push({ ...points[0] });
  }
  // Bound the initial fitting spans without discarding any original samples.
  // Artificial boundaries are still eligible for certified tangent smoothing.
  if (dense && points.length > (windowSamples ?? FIT_WINDOW_SAMPLES)) {
    const windows = Math.ceil((points.length - 1) / (windowSamples ?? 2048));
    for (let i = 1; i < windows; i++) ends.push(Math.floor((i * (points.length - 1)) / windows));
  }
  ends.push(points.length - 1);
  const boundaries = [...new Set(ends)].sort((a, b) => a - b);
  let curves: Cubic[] = [];
  const errors: number[] = [];
  const sources: { samples: Point[]; ts: number[] }[] = [];
  let maxError = 0,
    work = dense ? input.length : 0;
  for (let k = 1; k < boundaries.length; k++) {
    const stack: [number, number][] = [[boundaries[k - 1], boundaries[k]]];
    while (stack.length) {
      const [start, end] = stack.pop()!;
      if (end - start === 1) {
        curves.push(line(points[start], points[end]));
        errors.push(0);
        sources.push({ samples: [points[start], points[end]], ts: [0, 1] });
        continue;
      }
      const samples = points.slice(start, end + 1),
        ts = [0];
      for (let i = 1; i < samples.length; i++)
        ts.push(
          ts.at(-1)! + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y),
        );
      const length = ts.at(-1)!;
      if (!Number.isFinite(length)) throw Error('Curve-fit coordinate range exceeded');
      for (let i = 0; i < ts.length; i++) ts[i] /= length;
      const c = candidate(samples, ts);
      if (
        c.some(
          (p) =>
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            Math.abs(p.x) > 1e12 ||
            Math.abs(p.y) > 1e12,
        )
      )
        throw Error('Curve-fit coordinate range exceeded');
      let error = 0,
        split = Math.floor((start + end) / 2);
      for (let i = 1; i < samples.length; i++) {
        if (++work > workLimit) throw Error('Curve-fit work limit reached');
        const e = segmentError(c, samples[i - 1], samples[i], ts[i - 1], ts[i]);
        if (e > error) {
          error = e;
          split = Math.max(start + 1, Math.min(end - 1, start + i));
        }
      }
      if (error <= tolerance) {
        curves.push(c);
        errors.push(error);
        sources.push({ samples, ts });
        maxError = Math.max(maxError, error);
      } else stack.push([split, end], [start, split]);
    }
  }
  const sourceIndices = new Map(points.map((p, i) => [p, i]));
  const cornerJoins = new Set(
    curves.flatMap((c, i) => (corners.has(sourceIndices.get(c[0])!) ? [i] : [])),
  );
  const certify = (index: number, curve: Cubic) => {
    const { samples, ts } = sources[index];
    let error = 0;
    for (let i = 1; i < samples.length; i++) {
      if (++work > workLimit) throw Error('Curve-fit work limit reached');
      error = Math.max(error, segmentError(curve, samples[i - 1], samples[i], ts[i - 1], ts[i]));
    }
    return error;
  };
  const smoothed = smoothCurveJoins(curves, errors, cornerJoins, closed, tolerance, certify);
  curves = smoothed.curves;
  maxError = smoothed.maxError;
  const nodes: BezierNode[] = curves.map((c) => ({ ...c[0], out: { ...c[1] } }));
  if (!closed) nodes.push({ ...curves.at(-1)![3] });
  curves.forEach((c, i) => {
    nodes[(i + 1) % nodes.length].in = { ...c[2] };
  });
  return {
    curves,
    nodes,
    closed,
    maxError,
    work,
    joins: measureCurveJoins(curves, cornerJoins, closed),
  };
}

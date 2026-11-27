import { clone, type BezierNode, type Point, type Vector } from '@splash/document';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { matrix, inversePoint } from './affine';
import { worldPaths } from './drawing';
import { fitPolyline } from './curve-fit';
import { fitBrushContoursWithCorners, fitCompoundContours } from './compound-fit';
import { simplifyBrushSamples } from './brush-simplify';

// Independent of smoothing strength: optimization approximates already-smoothed
// NEW ink. Flattening (.025) plus fitting (.725) allows at most .75 stage units.
const flattenTolerance = 0.025;
const fitTolerance = 0.725;
const anchors = (s: Vector) =>
  s.contours?.reduce((n, r) => n + r.length, 0) ?? s.nodes?.length ?? s.points.length;
function localNode(source: Vector) {
  const m = matrix(source);
  if (!m.every(Number.isFinite) || Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-10)
    throw Error('Optimization requires an invertible transform');
  const local = (p: Point) => {
    const q = inversePoint(m, p);
    if (![q.x, q.y].every(Number.isFinite)) throw Error('Invalid optimized coordinate');
    return q;
  };
  return (n: BezierNode): BezierNode => ({
    ...local(n),
    ...(n.in ? { in: local(n.in) } : {}),
    ...(n.out ? { out: local(n.out) } : {}),
  });
}

/** Optional worker preparation, never a second smoothing pass. Failed proofs or
 * exhausted fitting work retain complete original ink, with no geometry cap. */
export function optimizeNewStroke(source: Vector): Vector {
  validateLiveGraphicData(source);
  const result = clone(source);
  if (source.kind === 'brush') {
    // Object brushes retain editable pressure/nib samples. This existing reducer
    // bounds both center AND radius error; nonlinear/tilt/twist nibs stay exact.
    result.points = clone(simplifyBrushSamples(source, 0.75));
    return result;
  }
  if (source.closed || source.contours || !['path', 'bezier'].includes(source.kind)) return result;
  if (source.kind === 'path' && !source.rotation && !source.transform && result.points.length > 2) {
    const points = result.points;
    const first = points[0], last = points[points.length - 1];
    const axis = first.x === last.x ? 'y' : first.y === last.y ? 'x' : undefined;
    if (axis) {
      const fixed = axis === 'x' ? 'y' : 'x';
      const sign = Math.sign(last[axis] - first[axis]);
      if (sign && points.every((p, i) => p[fixed] === first[fixed] &&
          (!i || sign * (p[axis] - points[i - 1][axis]) >= 0))) {
        // This path is already straight. Fitting handles to the same line
        // introduces rounded cubic parameters at otherwise exact line contacts.
        result.points = [first, last];
        return result;
      }
    }
  }
  try {
    const paths = worldPaths(source, flattenTolerance);
    if (paths.length !== 1 || paths[0].length < 3) return result;
    const fit = fitPolyline(paths[0], fitTolerance, false, fitTolerance);
    if (fit.nodes.length >= anchors(source)) return result;
    const node = localNode(source);
    result.kind = 'bezier';
    result.points = [];
    result.nodes = fit.nodes.map(node);
    // End contacts and their pen metadata remain exact. Handles come from the
    // fit, never from the old curve's different parameterization.
    const ends = source.nodes ?? source.points;
    for (const [i, original] of [
      [0, ends[0]],
      [result.nodes.length - 1, ends.at(-1)!],
    ] as const) {
      const metadata = { ...original } as BezierNode;
      delete metadata.in;
      delete metadata.out;
      result.nodes[i] = { ...metadata, ...result.nodes[i], x: original.x, y: original.y };
    }
    validateLiveGraphicData(result);
    return result;
  } catch {
    return clone(source);
  }
}

/** Fit the new Brush footprint before it encounters ANY previously drawn paint.
 * Certify all of its rings together, including contacts between separate pieces. */
export function optimizeNewPaint(shapes: Vector[]): Vector[] {
  validateLiveGraphicData(shapes);
  const original = clone(shapes);
  if (!shapes.length || shapes.some((s) => s.kind !== 'polygon' || !s.contours || s.strokeWidth))
    return original;
  try {
    const paths = shapes.map((s) => worldPaths(s, flattenTolerance));
    const input = paths.flat();
    let fitted;
    try {
      fitted = fitCompoundContours(input, fitTolerance, 0, true, fitTolerance).rings;
    } catch {
      fitted = fitBrushContoursWithCorners(input, fitTolerance);
    }
    let ring = 0;
    const result = shapes.map((source, i) => {
      const shape = clone(source),
        node = localNode(source);
      shape.contours = paths[i].map(() => fitted[ring++].nodes.map(node));
      return shape;
    });
    if (result.reduce((n, s) => n + anchors(s), 0) >= shapes.reduce((n, s) => n + anchors(s), 0))
      return original;
    validateLiveGraphicData(result);
    return result;
  } catch {
    return original;
  }
}

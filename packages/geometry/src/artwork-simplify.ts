import { clone, type BezierNode, type Vector } from '@splash/document';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { matrix, inversePoint } from './affine';
import { worldPaths } from './drawing';
import { CURVE_FIT_WORK_LIMIT, fitPolyline } from './curve-fit';
import { fitCompoundContours, fitDenseCompoundContours } from './compound-fit';
import { simplifyBrushSamples } from './brush-simplify';
import { simplifyContourSpans } from './simplify-contour-spans';

export const artworkVertices = (s: Vector) =>
  s.contours?.reduce((n, ring) => n + ring.length, 0) ?? s.nodes?.length ?? s.points.length;

/** Explicit simplification is a vertex-reducing edit, not another smoothing pass.
 * Try bounded document-space allowances against the current source each time;
 * never publish equal/more anchors or bypass a compound topology certificate. */
export function simplifyArtwork(source: Vector): Vector {
  validateLiveGraphicData(source);
  const count = artworkVertices(source);
  if (['line', 'rectangle', 'ellipse', 'text', 'symbol'].includes(source.kind) || count < 3)
    return clone(source);
  const m = matrix(source);
  if (!m.every(Number.isFinite) || Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-10)
    throw Error('Simplification requires an invertible transform.');
  const local = (n: BezierNode): BezierNode => {
    const point = (p: { x: number; y: number }) => {
      const q = inversePoint(m, p);
      if (![q.x, q.y].every(Number.isFinite))
        throw Error('Simplification exceeds finite geometry.');
      return q;
    };
    return {
      ...point(n),
      ...(n.in ? { in: point(n.in) } : {}),
      ...(n.out ? { out: point(n.out) } : {}),
    };
  };
  const closed = !!source.contours || !!source.closed || source.kind === 'polygon';
  const paths = source.kind === 'brush' ? undefined : worldPaths(source, 0.05);
  const dense = (paths?.reduce((n, path) => n + path.length, 0) ?? 0) > 8192;
  if (paths?.some((r) => r.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))))
    throw Error('Simplification exceeds finite geometry.');
  let best = clone(source),
    bestCount = count;
  const target = Math.max(closed ? 3 * (paths?.length ?? 1) : 2, Math.floor(count * 0.75));
  for (const allowance of [0.5, 1, 2, 4]) {
    try {
      const result = clone(source);
      if (source.kind === 'brush') result.points = clone(simplifyBrushSamples(source, allowance));
      else {
        const tolerance = allowance - 0.05;
        if (closed) {
          const rings = dense
            ? fitDenseCompoundContours(paths!, tolerance)
            : fitCompoundContours(paths!, tolerance, 0, true, tolerance).rings;
          if (source.contours) result.contours = rings.map((r) => r.nodes.map(local));
          else {
            result.kind = 'bezier';
            result.closed = true;
            result.points = [];
            result.nodes = rings[0].nodes.map(local);
          }
        } else {
          if (paths!.length !== 1 || paths![0].length < 2) return best;
          result.kind = 'bezier';
          result.points = [];
          result.nodes = fitPolyline(
            paths![0],
            tolerance,
            false,
            tolerance,
            dense ? { workLimit: CURVE_FIT_WORK_LIMIT } : undefined,
          ).nodes.map(local);
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
        }
      }
      validateLiveGraphicData(result);
      const n = artworkVertices(result);
      if (n < bestCount) {
        best = result;
        bestCount = n;
      }
      if (bestCount <= target) break;
    } catch {
      // Uncertain topology or exhausted existing work limits retain complete art.
    }
  }
  if (bestCount === count && source.contours) {
    for (const tolerance of [0.5, 1, 2, 4]) {
      const reduced = simplifyContourSpans(source, tolerance);
      if (reduced) {
        validateLiveGraphicData(reduced);
        return reduced;
      }
    }
  }
  return best;
}

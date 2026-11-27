import { clone, type Vector } from '../../document/src';
import { matrix, mapPoint, inversePoint } from './affine';
import { normalizeVector } from './drawing';
import { smoothPencilStroke } from './pencil';
import { fitPolyline } from './curve-fit';

/** Main Pencil Smooth: suppress capture jitter, then fit a small set of cubics.
 * Only the incoming stroke is processed. Legacy callers keep their old kernel. */
export function fitPencilStroke(source: Vector, smoothing = 50): Vector {
  if (
    typeof smoothing !== 'number' ||
    !Number.isFinite(smoothing) ||
    smoothing < 0 ||
    smoothing > 200
  )
    throw Error('Pencil smoothing must be from 0 to 200 percent.');
  const strength = smoothing / 50;
  // Validate through the original kernel before any optional preparation.
  const prepared = smoothPencilStroke(source, true, strength),
    m = matrix(source);
  if (smoothing === 0) {
    const result = clone(source);
    normalizeVector(result);
    if (![result.x, result.y, result.width, result.height].every(Number.isFinite))
      throw Error('Pencil fit exceeds finite geometry.');
    return result;
  }
  if (prepared.nodes!.length === 2) return prepared;
  const original = source.points.map((p) => ({ ...p, ...mapPoint(m, p) }));
  const distances = [0];
  for (let i = 1; i < original.length; i++)
    distances.push(
      distances[i - 1] +
        Math.hypot(original[i].x - original[i - 1].x, original[i].y - original[i - 1].y),
    );
  if (
    !Number.isFinite(distances.at(-1)) ||
    !Number.isFinite(m[0] * m[3] - m[1] * m[2]) ||
    m[0] * m[3] - m[1] * m[2] === 0
  )
    return prepared;
  // Distance-weighted Gaussian filtering is stable under uneven input sampling.
  // Relative sums protect translated ink; endpoints stay at the actual contacts.
  let work = 0,
    left = 0,
    right = 0;
  const points = original.map((p, i) => {
    if (i === 0 || i === original.length - 1) return p;
    while (distances[i] - distances[left] > 18 * strength) left++;
    right = Math.max(right, i);
    while (right + 1 < original.length && distances[right + 1] - distances[i] <= 18 * strength)
      right++;
    let x = 0,
      y = 0,
      total = 0;
    for (let j = left; j <= right; j++) {
      if (++work > 1000000) return p;
      const cell =
        (distances[Math.min(j + 1, original.length - 1)] - distances[Math.max(0, j - 1)]) / 2;
      const weight = Math.exp(-0.5 * ((distances[j] - distances[i]) / (6 * strength)) ** 2) * cell;
      x += (original[j].x - p.x) * weight;
      y += (original[j].y - p.y) * weight;
      total += weight;
    }
    return total ? { ...p, x: p.x + x / total, y: p.y + y / total } : p;
  });
  if (work > 1000000 || points.length > 8192) return prepared;
  try {
    const fit = fitPolyline(points, 2 * strength, false);
    // Where rapid input leaves a turn farther from either neighbor than the
    // smoothing window, averaging those neighbors can move the turn across
    // the drawing. Keep the fitter's explicit corner at that input instead.
    if (fit.joins.discontinuities || fit.joins.intentionalCorners &&
      !distances.every((distance, i) => i === 0 || distance - distances[i - 1] > 18 * strength))
      return prepared;
    let index = 0;
    const local = (p: { x: number; y: number }) => {
      const q = inversePoint(m, p);
      if (!Number.isFinite(q.x) || !Number.isFinite(q.y))
        throw Error('Pencil fit exceeds finite geometry.');
      return q;
    };
    const result = {
      ...clone(source),
      kind: 'bezier' as const,
      points: [],
      nodes: fit.nodes.map((n, i) => {
        while (index < points.length - 1 && (points[index].x !== n.x || points[index].y !== n.y))
          index++;
        const metadata =
          i === 0
            ? source.points[0]
            : i === fit.nodes.length - 1
              ? source.points.at(-1)!
              : points[index];
        return {
          ...metadata,
          ...local(n),
          ...(n.in ? { in: local(n.in) } : {}),
          ...(n.out ? { out: local(n.out) } : {}),
        };
      }),
    };
    normalizeVector(result);
    if (![result.x, result.y, result.width, result.height].every(Number.isFinite))
      throw Error('Pencil fit exceeds finite geometry.');
    return result;
  } catch (cause) {
    if (
      cause instanceof Error &&
      /curve-fit|Curve-fit|curve tolerance|curve-fit points/i.test(cause.message)
    )
      return prepared;
    throw cause;
  }
}

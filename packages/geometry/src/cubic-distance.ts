import type { Point } from '../../document/src';

/** One distance table and subdivision budget for the entire multi-cubic path. */
export function createCubicDistanceCorrespondence(
  segments: readonly (readonly [Point, Point, Point, Point])[],
) {
  return buildCubicDistanceCorrespondence(segments);
}

/** Detached breakpoints for restriction admission; legacy sampling keeps its exact table. */
export function captureCubicDistanceCorrespondence(
  segments: readonly (readonly [Point, Point, Point, Point])[],
) {
  let knots: readonly Readonly<{ parameter: number; progress: number }>[] = [];
  const map = buildCubicDistanceCorrespondence(segments, (samples, total) => {
    knots = Object.freeze(
      samples.map((sample, i) => {
        const progress = total === 0 ? sample.parameter : sample.length / total;
        if (
          !Number.isFinite(progress) ||
          (i > 0 &&
            progress <=
              (total === 0
                ? samples[i - 1].parameter
                : samples[i - 1].length / total))
        )
          throw Error(
            'Motion path normalized distance interval is numerically unresolved.',
          );
        return Object.freeze({ parameter: sample.parameter, progress });
      }),
    );
  });
  return { ...map, knots };
}

function buildCubicDistanceCorrespondence(
  segments: readonly (readonly [Point, Point, Point, Point])[],
  capture?: (samples: readonly { parameter: number; length: number }[], total: number) => void,
): {
  parameter: (progress: number) => number;
  fraction: (parameter: number) => number;
  total: number;
} {
  const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  const length = segments.reduce(
    (sum, [p, a, b, q]) => sum + distance(p, a) + distance(a, b) + distance(b, q),
    0,
  );
  if (!Number.isFinite(length)) throw new Error('Motion path distance exceeds numeric limits.');
  const tolerance = 0.001 + length * 1e-7;
  const samples = [{ parameter: 0, length: 0 }];
  const mix = (p: Point, q: Point, t = 0.5): Point => ({
    x: p.x * (1 - t) + q.x * t,
    y: p.y * (1 - t) + q.y * t,
  });
  let visits = 0;
  function subdivide(
    p: Point,
    a: Point,
    b: Point,
    q: Point,
    lo: number,
    hi: number,
    budget: number,
    depth: number,
  ) {
    if (++visits > 131072)
      throw new Error('Motion path distance calculation exceeded its subdivision budget.');
    const chord = distance(p, q),
      polygon = distance(p, a) + distance(a, b) + distance(b, q);
    // Also bound parameter nonuniformity, including perfectly straight cubic paths.
    const deviation = Math.max(distance(a, mix(p, q, 1 / 3)), distance(b, mix(p, q, 2 / 3)));
    if (polygon - chord <= budget && deviation <= tolerance && (chord > 0 || polygon === 0)) {
      const total = samples[samples.length - 1].length + chord;
      if (!Number.isFinite(total)) throw new Error('Motion path distance exceeds numeric limits.');
      if (chord > 0 && total === samples[samples.length - 1].length)
        throw new Error('Motion path distance interval is numerically unresolved.');
      samples.push({ parameter: hi, length: total });
      return;
    }
    if (depth >= 20)
      throw new Error('Motion path distance calculation could not meet its tolerance.');
    const pa = mix(p, a),
      ab = mix(a, b),
      bq = mix(b, q),
      left = mix(pa, ab),
      right = mix(ab, bq),
      center = mix(left, right),
      mid = (lo + hi) / 2;
    subdivide(p, pa, left, center, lo, mid, budget / 2, depth + 1);
    subdivide(center, right, bq, q, mid, hi, budget / 2, depth + 1);
  }
  segments.forEach(([p, a, b, q], i) =>
    subdivide(
      p,
      a,
      b,
      q,
      i / segments.length,
      (i + 1) / segments.length,
      tolerance / segments.length,
      0,
    ),
  );
  const total = samples[samples.length - 1].length;
  const parameter = (progress: number) => {
    if (progress === 0 || progress === 1 || total === 0) return progress;
    const wanted = progress * total;
    let low = 0,
      high = samples.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >>> 1;
      if (samples[mid].length < wanted) low = mid;
      else high = mid;
    }
    const a = samples[low],
      b = samples[high],
      span = b.length - a.length;
    const parameter =
      span === 0
        ? b.parameter
        : a.parameter + (b.parameter - a.parameter) * ((wanted - a.length) / span);
    return parameter;
  };
  const fraction = (parameter: number) => {
    if (parameter === 0 || parameter === 1 || total === 0) return parameter;
    let low = 0,
      high = samples.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >>> 1;
      if (samples[mid].parameter < parameter) low = mid;
      else high = mid;
    }
    const a = samples[low],
      b = samples[high],
      t = (parameter - a.parameter) / (b.parameter - a.parameter);
    return (a.length * (1 - t) + b.length * t) / total;
  };
  capture?.(samples, total);
  return { parameter, fraction, total };
}


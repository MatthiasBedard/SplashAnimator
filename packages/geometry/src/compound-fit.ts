import type { Point } from '@splash/document';
import { boundsIndex } from './bounds-index';
import {
  CURVE_FIT_WORK_LIMIT,
  fitPolyline,
  splitCubic,
  type Cubic,
  type CurveFit,
} from './curve-fit';
import { containsPoint, crossesHorizontalRay, flattenCommands, type Command } from './drawing';
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const norm = (p: Point) => Math.hypot(p.x, p.y);
const TOPOLOGY_WORK_LIMIT = 200000;
export const STANDARD_COMPOUND_SAMPLE_LIMIT = 8192;
function pointDistance(p: Point, a: Point, b: Point) {
  const d = sub(b, a),
    t = Math.max(0, Math.min(1, dot(sub(p, a), d) / dot(d, d)));
  return norm(sub(p, { x: a.x + d.x * t, y: a.y + d.y * t }));
}
function edgeDistance(a: Point, b: Point, c: Point, d: Point) {
  const ab = sub(b, a),
    cd = sub(d, c),
    u = cross(ab, sub(c, a)),
    v = cross(ab, sub(d, a)),
    w = cross(cd, sub(a, c)),
    z = cross(cd, sub(b, c));
  if (((u < 0 && v > 0) || (u > 0 && v < 0)) && ((w < 0 && z > 0) || (w > 0 && z < 0))) return 0;
  return Math.min(
    pointDistance(a, c, d),
    pointDistance(b, c, d),
    pointDistance(c, a, b),
    pointDistance(d, a, b),
  );
}
const area = (ring: Point[]) =>
  ring.reduce(
    (sum, p, i) => sum + cross(sub(p, ring[0]), sub(ring[(i + 1) % ring.length], ring[0])),
    0,
  ) / 2;
function bounds(c: Cubic) {
  return {
    x: Math.min(...c.map((p) => p.x)),
    y: Math.min(...c.map((p) => p.y)),
    right: Math.max(...c.map((p) => p.x)),
    bottom: Math.max(...c.map((p) => p.y)),
  };
}
/** Conservative acceptance subset: simple rings with a clearance margin, monotone
 * cubic spans, separable adjacent joins and disjoint nonadjacent control hulls.
 * Ambiguous/touching cases reject atomically; not an exact-predicate kernel.
 */
export function fitCompoundContours(
  input: Point[][],
  tolerance = 0.25,
  clearance = 2 * tolerance,
  directionalJoins = false,
  cornerTolerance = 0,
): { rings: CurveFit[]; parents: number[]; depths: number[] } {
  const rings = fitCompoundPolylines(input, tolerance, clearance, directionalJoins, cornerTolerance);
  return { rings, ...certifyFittedRings(input, rings, tolerance, clearance, directionalJoins) };
}

/** Retry a new paint outline with its sharp turns retained. Check tight joins
 * using subdivisions of the proposed cubics while storing the original fits. */
export function fitBrushContoursWithCorners(input: Point[][], tolerance: number): CurveFit[] {
  return fitDenseRings(input, tolerance, 0, true);
}

function fitCompoundPolylines(input: Point[][], tolerance: number, clearance: number,
  directionalJoins: boolean, cornerTolerance: number): CurveFit[] {
  if (typeof directionalJoins !== 'boolean') throw Error('Invalid compound join proof option');
  if (!Number.isFinite(clearance) || clearance < 0)
    throw Error('Compound fitting clearance must be a finite nonnegative number');
  if (!input.length || input.reduce((n, r) => n + r.length, 0) > STANDARD_COMPOUND_SAMPLE_LIMIT)
    throw Error('Invalid compound outline size');
  return input.map((r) => fitPolyline(r, tolerance, true, cornerTolerance));
}

function certifyFittedRings(input: Point[][], rings: CurveFit[], tolerance: number, clearance: number,
  directionalJoins: boolean) {
  return certifyCompoundContours(input, rings.map(r => r.curves), tolerance, clearance, directionalJoins);
}

/** Brush finishing only uses fits that improve its current anchor count. */
export function fitSmallerCompoundContours(input: Point[][], tolerance: number, anchorCount: number) {
  const rings = fitCompoundPolylines(input, tolerance, 0, false, 0);
  const fittedAnchors = rings.reduce((count, ring) => count + ring.nodes.length, 0);
  if (fittedAnchors >= anchorCount) return;
  certifyFittedRings(input, rings, tolerance, 0, false);
  return { rings, fittedAnchors };
}

/** Explicit Simplify can fit dense rings in bounded spans, then prove them as
 * one compound shape against every original sample and all other rings. */
export function fitDenseCompoundContours(input: Point[][], tolerance: number): CurveFit[] {
  return fitDenseRings(input, tolerance, tolerance, false);
}

function fitDenseRings(input: Point[][], tolerance: number, cornerTolerance: number, subdivideJoins: boolean) {
  if (!input.length || input.reduce((n, r) => n + r.length, 0) > CURVE_FIT_WORK_LIMIT)
    throw Error('Invalid compound outline size');
  let remaining = CURVE_FIT_WORK_LIMIT;
  const rings = input.map((ring) => {
    const fitted = fitPolyline(ring, tolerance, true, cornerTolerance, { workLimit: remaining });
    remaining -= fitted.work;
    return fitted;
  });
  certifyCompoundContours(
    input,
    rings.map((ring) => ring.curves),
    tolerance,
    0,
    true,
    'dense',
    subdivideJoins,
  );
  return rings;
}

/** Prove open or closed cubic walks simple using their original controls. */
export function certifySimpleCurveWalks(paths: Cubic[][], closed: boolean, epsilon: number,
  directionalJoins: boolean, dense: boolean, tick: (cost?: number) => void, subdivideJoins = false) {
  function monotone(c: Cubic) {
    const chord = sub(c[3], c[0]);
    return c.slice(1).every((p,i) => dot(sub(p,c[i]),chord) >= 0);
  }
  // A freehand turn may reverse along its own chord without intersecting
  // itself. Subdivide only for this proof; the authored span stays intact.
  function monotoneSpans(c: Cubic, result: Cubic[], depth = 0) {
    tick();
    if (monotone(c)) { result.push(c); return; }
    if (depth === 18) throw Error('Fitted span is not monotone');
    for (const half of splitCubic(c,.5)) monotoneSpans(half,result,depth+1);
  }
  const separated = (a: Cubic, b: Cubic, depth = 0): boolean => {
    tick();
    const A = bounds(a),
      B = bounds(b);
    if (
      A.right + epsilon < B.x ||
      B.right + epsilon < A.x ||
      A.bottom + epsilon < B.y ||
      B.bottom + epsilon < A.y
    )
      return true;
    if (depth >= 18) {
      if (!subdivideJoins) return false;
      // A short diagonal boundary between two cuts can leave the adjacent
      // long arcs in overlapping axis-aligned boxes at the depth limit.
      // Their full control hulls may still have a strict gap across a chord.
      for (const span of [a, b]) {
        tick();
        const chord = sub(span[3], span[0]), length = norm(chord);
        if (!length || !Number.isFinite(length)) continue;
        const normal = { x: -chord.y / length, y: chord.x / length };
        const project = (p: Point) => dot(sub(p, span[0]), normal);
        const left = a.map(project), right = b.map(project);
        if (!left.every(Number.isFinite) || !right.every(Number.isFinite)) continue;
        if (Math.max(...left) + epsilon < Math.min(...right) ||
            Math.max(...right) + epsilon < Math.min(...left)) return true;
      }
      return false;
    }
    const sizeA = A.right - A.x + A.bottom - A.y,
      sizeB = B.right - B.x + B.bottom - B.y;
    if (sizeA >= sizeB) {
      const [l, r] = splitCubic(a, 0.5);
      return separated(l, b, depth + 1) && separated(r, b, depth + 1);
    }
    const [l, r] = splitCubic(b, 0.5);
    return separated(a, l, depth + 1) && separated(a, r, depth + 1);
  };
  const walks = closed && !subdivideJoins ? paths : paths.map(path => {
    const spans: Cubic[] = [];
    for (const c of path) {
      // A ring cut out of Brush paint can retain a span that turns back
      // along its chord. Check its pieces against every other span, including
      // its own siblings and the closing join. Already monotone ring spans
      // retain their original work charge.
      if (closed && monotone(c)) spans.push(c);
      else monotoneSpans(c, spans);
    }
    return spans;
  });
  const curves = walks.flatMap((path, ring) =>
    path.map((c, index) => ({ c, ring, index, count: path.length })),
  );
  for (const { c } of curves) {
    const chord = sub(c[3], c[0]),
      length = norm(chord);
    if (length <= epsilon) throw Error('Degenerate fitted span');
    if (!monotone(c)) throw Error('Fitted span is not monotone');
  }
  // Cubics stay inside their control hulls. Adjacent spans share an endpoint,
  // so they remain candidates for the existing join-separation check.
  const curveBounds = curves.map(({ c }) => {
    const b = bounds(c);
    return { left: b.x, top: b.y, right: b.right, bottom: b.bottom };
  });
  const curveCandidates = boundsIndex(curveBounds);
  for (let i = 0; i < curves.length; i++)
    for (const j of curveCandidates(curveBounds[i], epsilon)) {
      if (j <= i) continue;
      if (dense) tick();
      const a = curves[i],
        b = curves[j];
      if (
        a.ring === b.ring &&
        (b.index === a.index + 1 || (closed && a.index === 0 && b.index === a.count - 1))
      ) {
        const left = b.index === a.index + 1 ? a.c : b.c,
          right = b.index === a.index + 1 ? b.c : a.c,
          p = left[3];
        const u = sub(p, left[0]),
          v = sub(right[3], p),
          lu = norm(u),
          lv = norm(v),
          n = { x: u.x / lu + v.x / lv, y: u.y / lu + v.y / lv };
        const chordSeparated = !(
          left.slice(0, 3).some((q) => dot(sub(q, p), n) >= -epsilon) ||
          right.slice(1).some((q) => dot(sub(q, p), n) <= epsilon)
        );
        // The chord bisector is only one possible separating plane. Tight turns
        // can have disjoint control hulls on another axis. Prove that axis using
        // the actual controls, retaining the same strict numeric margin.
        const directionalSeparated = (before: Cubic, after: Cubic, depth = 0): boolean => {
          const incoming = before.slice(0, 3).map((q) => sub(p, q));
          const outgoing = after.slice(1).map((q) => sub(q, p));
          for (const a of incoming)
            for (const b of outgoing) {
              tick();
              const la = norm(a),
                lb = norm(b);
              if (!la || !lb) continue;
              const axis = { x: a.x / la + b.x / lb, y: a.y / la + b.y / lb };
              const exactZero = (q: Point) => q.x === 0 && q.y === 0;
              // A control exactly on the shared anchor is harmless: Bernstein
              // weights of the other, strictly separated controls are positive
              // throughout the open cubic interval. Nonzero uncertain controls
              // still reject; neither epsilon nor the global work limit changes.
              if (
                incoming.every((q) => exactZero(q) || dot(q, axis) > epsilon) &&
                outgoing.every((q) => exactZero(q) || dot(q, axis) > epsilon)
              )
                return true;
            }
          if (!subdivideJoins || depth >= 18) return false;
          // Long arcs at a tight paint-cut corner can have overlapping
          // hulls. Prove the remote portions disjoint before checking the
          // shared endpoint on shorter intervals of the same two cubics.
          const [farLeft, nearLeft] = splitCubic(before, 0.5);
          const [nearRight, farRight] = splitCubic(after, 0.5);
          return norm(sub(nearLeft[0], p)) > epsilon && norm(sub(nearRight[3], p)) > epsilon &&
            separated(farLeft, after) && separated(nearLeft, farRight) &&
            directionalSeparated(nearLeft, nearRight, depth + 1);
        };
        if (!chordSeparated && !(directionalJoins && directionalSeparated(left, right)))
          throw Error('Fitted join cannot be separated');
      } else if (!separated(a.c, b.c)) throw Error('Fitted contours touch or cross');
    }
}

/** Topology proof for supplied cubic rings. Geometry fidelity is the caller's
 * responsibility; fitting and exact merge-trace restoration share this proof. */
export function certifyCompoundContours(
  input: Point[][],
  candidates: Cubic[][],
  tolerance = 0.25,
  clearance = 2 * tolerance,
  directionalJoins = false,
  size: 'standard' | 'dense' = 'standard',
  subdivideJoins = false,
): { parents: number[]; depths: number[] } {
  if (typeof directionalJoins !== 'boolean') throw Error('Invalid compound join proof option');
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw Error('Invalid compound proof tolerance');
  if (!Number.isFinite(clearance) || clearance < 0)
    throw Error('Compound fitting clearance must be a finite nonnegative number');
  const sampleCount = input.reduce((n, r) => n + r.length, 0);
  const dense = size === 'dense';
  if (!input.length || sampleCount > (dense ? TOPOLOGY_WORK_LIMIT : STANDARD_COMPOUND_SAMPLE_LIMIT))
    throw Error('Invalid compound outline size');
  if (
    candidates.length !== input.length ||
    input.some(
      (r) => r.length < 3 || r.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)),
    ) ||
    candidates.some(
      (r) =>
        !r.length ||
        r.some(
          (c, i) =>
            c.length !== 4 ||
            c.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
            c[3].x !== r[(i + 1) % r.length][0].x ||
            c[3].y !== r[(i + 1) % r.length][0].y,
        ),
    )
  )
    throw Error('Invalid compound proof geometry');
  const rings = candidates.map((curves) => ({ curves }));
  const source = input.map((r) => {
    const p = r
      .filter((p, i) => !i || p.x !== r[i - 1].x || p.y !== r[i - 1].y)
      .map((p) => ({ ...p }));
    if (p[0].x === p.at(-1)!.x && p[0].y === p.at(-1)!.y) p.pop();
    return p;
  });
  let scale = 1;
  for (const ring of source)
    for (const p of ring) scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
  const epsilon = scale * Number.EPSILON * 64;
  let work = dense ? sampleCount : 0;
  const tick = (cost = 1) => {
    work += cost;
    if (work > TOPOLOGY_WORK_LIMIT) throw Error('Compound topology work limit reached');
  };
  // Many holes probe the same outer contour. Index its edge y-ranges on
  // reuse so that the existing proof budget pays only for possible crossings.
  const probed = new Set<Point[]>(), rayIndices = new Map<Point[],ReturnType<typeof boundsIndex>>();
  const contains = (ring: Point[], p: Point) => {
    if (!dense) return containsPoint(ring,p);
    if (!probed.has(ring)) {
      probed.add(ring);
      tick(ring.length);
      return containsPoint(ring,p);
    }
    let lookup = rayIndices.get(ring);
    if (!lookup) {
      tick(ring.length);
      lookup = boundsIndex(ring.map((a,i)=>{
        const b = ring[(i+ring.length-1)%ring.length];
        return {left:0,right:0,top:Math.min(a.y,b.y),bottom:Math.max(a.y,b.y)};
      }));
      rayIndices.set(ring,lookup);
    }
    let inside = false;
    for (const i of lookup({left:0,right:0,top:p.y,bottom:p.y})) {
      tick();
      if (crossesHorizontalRay(ring[i],ring[(i+ring.length-1)%ring.length],p)) inside = !inside;
    }
    return inside;
  };
  const edges = source.flatMap((r, ring) =>
    r.map((a, index) => ({ a, b: r[(index + 1) % r.length], ring, index, count: r.length })),
  );
  // A pair within the clearance must have overlapping padded bounds. Keep the
  // distance predicate as the final decision and spend work only on candidates.
  const edgeBounds = edges.map(({ a, b }) => ({
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y),
  }));
  const edgeCandidates = boundsIndex(edgeBounds);
  for (let i = 0; i < edges.length; i++)
    for (const j of edgeCandidates(edgeBounds[i], clearance + epsilon)) {
      if (j <= i) continue;
      tick();
      const a = edges[i],
        b = edges[j];
      if (
        a.ring === b.ring &&
        (Math.abs(a.index - b.index) === 1 || Math.abs(a.index - b.index) === a.count - 1)
      )
        continue;
      if (edgeDistance(a.a, a.b, b.a, b.b) <= clearance + epsilon)
        throw Error('Outline crosses or has insufficient fitting clearance');
    }
  const ringBounds = (ring: Point[]) => {
    const b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const p of ring) {
      b.left = Math.min(b.left, p.x);
      b.right = Math.max(b.right, p.x);
      b.top = Math.min(b.top, p.y);
      b.bottom = Math.max(b.bottom, p.y);
    }
    return b;
  };
  const sourceBounds = source.map(ringBounds);
  const sourceCandidates = boundsIndex(sourceBounds);
  const areas = source.map(area);
  const atPoint = (p: Point) => ({ left: p.x, right: p.x, top: p.y, bottom: p.y });
  const parents = source.map((r, i) => {
    let parent = -1;
    for (const j of sourceCandidates(atPoint(r[0]))) {
      if (dense) tick();
      if (j === i) continue;
      if (
        (parent < 0 ||
          Math.abs(areas[j]) < Math.abs(areas[parent]) ||
          (Math.abs(areas[j]) === Math.abs(areas[parent]) && j < parent)) &&
        contains(source[j], r[0])
      )
        parent = j;
    }
    return parent;
  });
  const depths = parents.map((_, i) => {
    let depth = 0,
      p = parents[i];
    while (p !== -1) {
      if (dense) tick();
      if (++depth > parents.length) throw Error('Invalid contour nesting');
      p = parents[p];
    }
    return depth;
  });
  certifySimpleCurveWalks(candidates, true, epsilon, directionalJoins, dense, tick, subdivideJoins);
  const outlines = rings.map((r) => {
    const commands: Command[] = [
      ['M', r.curves[0][0].x, r.curves[0][0].y],
      ...r.curves.map((c): Command => ['C', c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y]),
      ['Z'],
    ];
    return flattenCommands(commands, tolerance / 16)[0].slice(0, -1);
  });
  // Either the original or fitted ring can contain the probe. Their combined
  // bounds retain both lost and newly introduced containment as candidates.
  const nestingCandidates = boundsIndex(
    outlines.map((r, i) => {
      const a = sourceBounds[i],
        b = ringBounds(r);
      return {
        left: Math.min(a.left, b.left),
        top: Math.min(a.top, b.top),
        right: Math.max(a.right, b.right),
        bottom: Math.max(a.bottom, b.bottom),
      };
    }),
  );
  for (let i = 0; i < source.length; i++) {
    if (Math.sign(areas[i]) !== Math.sign(area(outlines[i]))) throw Error('Fitted winding changed');
    for (const j of nestingCandidates(atPoint(source[i][0])))
      if (i !== j && contains(source[j], source[i][0]) !== contains(outlines[j], source[i][0]))
        throw Error('Fitted contour nesting changed');
  }
  return { parents, depths };
}

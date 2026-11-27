import type { BezierNode, Vector } from '@splash/document';

function rings(shape: Vector): BezierNode[][] {
  if (shape.kind === 'bezier' && shape.nodes) return [shape.nodes];
  if (shape.kind === 'polygon' && shape.contours) return shape.contours;
  return [];
}
/** Validate original values before JSON cloning can turn nonfinite numbers into null. */
export function validateMotionNodes(shape: Vector): void {
  for (const ring of rings(shape))
    for (const node of ring)
      for (const point of [node, node.in, node.out])
        if (point && (!Number.isFinite(point.x) || !Number.isFinite(point.y)))
          throw new Error('Node interpolation requires finite coordinates.');
}
/** Erase only interpolated coordinates, retaining contour/anchor order and handle presence. */
export function fixedMotionNodes(shape: Vector): void {
  for (const ring of rings(shape))
    for (const node of ring) {
      node.x = node.y = 0;
      if (node.in) node.in.x = node.in.y = 0;
      if (node.out) node.out.x = node.out.y = 0;
    }
}
/** Correspondence is checked by the caller; no resampling, matching or topology repair. */
export function interpolateMotionNodes(
  result: Vector,
  source: Vector,
  target: Vector,
  t: number,
): void {
  const first = rings(source),
    last = rings(target);
  rings(result).forEach((ring, r) =>
    ring.forEach((node, n) => {
      const from = first[r][n],
        to = last[r][n];
      for (const part of [undefined, 'in', 'out'] as const) {
        const output = part ? node[part] : node;
        if (!output) continue;
        const a = part ? from[part]! : from,
          b = part ? to[part]! : to;
        output.x = a.x * (1 - t) + b.x * t;
        output.y = a.y * (1 - t) + b.y * t;
        if (![output.x, output.y].every(Number.isFinite))
          throw new Error('Curve motion generated invalid coordinates.');
      }
    }),
  );
}

/** Signed area is quadratic under linear node motion. Check its full interval,
 * including its interior extremum, rather than just generated frame samples. */
export function validateMotionContourAreas(source: Vector, target: Vector): void {
  if (source.kind !== 'polygon' && !(source.kind === 'bezier' && source.closed)) return;
  const first = rings(source),
    last = rings(target);
  if (!first.length) return;
  if (first.length !== last.length)
    throw new Error('Contour area validation requires matching closed contours.');
  first.forEach((ring, r) => {
    const end = last[r];
    if (ring.length < (source.kind === 'bezier' ? 2 : 3) || ring.length !== end.length)
      throw new Error('Contour area validation requires matching contour nodes.');
    if (
      [...ring, ...end].some((p) =>
        [p, p.in, p.out].some((q) => q && (!Number.isFinite(q.x) || !Number.isFinite(q.y))),
      )
    )
      throw new Error('Contour area validation requires finite coordinates.');
    // Relative coordinates avoid cancellation from document-space translation.
    let c = 0,
      b = 0,
      a = 0,
      errorScale = 0;
    const curved = [...ring, ...end].some((p) => p.in || p.out);
    if (curved) {
      const coefficients = cubicAreaMotion(ring, end);
      [a, b, c, errorScale] = coefficients;
    } else
      for (let i = 1; i + 1 < ring.length; i++) {
        const ux = ring[i].x - ring[0].x,
          uy = ring[i].y - ring[0].y;
        const vx = ring[i + 1].x - ring[0].x,
          vy = ring[i + 1].y - ring[0].y;
        const dux = end[i].x - end[0].x - ux,
          duy = end[i].y - end[0].y - uy;
        const dvx = end[i + 1].x - end[0].x - vx,
          dvy = end[i + 1].y - end[0].y - vy;
        c += ux * vy - uy * vx;
        b += ux * dvy + dux * vy - uy * dvx - duy * vx;
        a += dux * dvy - duy * dvx;
      }
    if (![a, b, c].every(Number.isFinite))
      throw new Error('Contour area validation exceeds numeric limits.');
    const values = [c, a + b + c];
    // Divide before halving so finite coefficients do not overflow at 2*a.
    const extremum = a === 0 ? -1 : -b / a / 2;
    if (extremum > 0 && extremum < 1) values.push((a * extremum + b) * extremum + c);
    const sign = Math.sign(c);
    // Twice the geometry kernel's existing area threshold, plus cancellation guard.
    const tolerance = Math.max(
      2e-7,
      64 * Number.EPSILON * (Math.abs(a) + Math.abs(b) + Math.abs(c) + errorScale),
    );
    if (values.some((value) => !Number.isFinite(value) || value * sign <= tolerance))
      throw new Error(
        'Contour area collapses, reverses or is numerically unresolved during motion.',
      );
  });
}

/** Integrate x*y' - y*x' on each cubic in power basis. Each coordinate
 * coefficient is linear in tween progress, so each cross product is quadratic. */
function cubicAreaMotion(
  first: BezierNode[],
  last: BezierNode[],
): [number, number, number, number] {
  const power = (ring: BezierNode[], i: number) => {
    const p = ring[i],
      q = ring[(i + 1) % ring.length],
      origin = ring[0];
    const controls = [p, p.out ?? p, q.in ?? q, q];
    return (['x', 'y'] as const).map((axis) => {
      const [a, b, c, d] = controls.map((p) => p[axis] - origin[axis]);
      return [a, 3 * (b - a), 3 * (c - 2 * b + a), d - 3 * c + 3 * b - a];
    });
  };
  let a = 0,
    b = 0,
    c = 0,
    errorScale = 0;
  for (let segment = 0; segment < first.length; segment++) {
    const from = power(first, segment),
      to = power(last, segment);
    const delta = to.map((axis, n) => axis.map((v, i) => v - from[n][i]));
    for (let i = 0; i < 4; i++)
      for (let j = 1; j < 4; j++) {
        const weight = j / (i + j);
        const constant = weight * (from[0][i] * from[1][j] - from[1][i] * from[0][j]);
        const linear =
          weight *
          (from[0][i] * delta[1][j] +
            delta[0][i] * from[1][j] -
            from[1][i] * delta[0][j] -
            delta[1][i] * from[0][j]);
        const quadratic = weight * (delta[0][i] * delta[1][j] - delta[1][i] * delta[0][j]);
        c += constant;
        b += linear;
        a += quadratic;
        errorScale += Math.abs(constant) + Math.abs(linear) + Math.abs(quadratic);
      }
  }
  return [a, b, c, errorScale];
}

export type MotionContourStart = number | readonly number[];
export function validateMotionContourStart(offset: MotionContourStart): void {
  const values = Array.isArray(offset) ? offset : [offset];
  if (!values.length || values.some((v) => !Number.isSafeInteger(v) || v < 0))
    throw new Error('Contour start offsets must be nonnegative safe integers.');
}
/** Blank text keeps the shared offset; explicit lists must match each path's contours. */
export function parseMotionContourStarts(text: string, fallback: number): MotionContourStart {
  if (!text.trim()) return fallback;
  const parts = text.split(',').map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part)))
    throw new Error('Enter comma-separated nonnegative contour offsets.');
  const offsets = parts.map(Number);
  validateMotionContourStart(offsets);
  return offsets;
}
/** Blank preserves authored contour order; explicit indices form a full permutation. */
export function parseMotionContourOrder(text: string): readonly number[] | undefined {
  if (!text.trim()) return undefined;
  const parts = text.split(',').map((part) => part.trim());
  if (parts.some((part) => !/^\d+$/.test(part)))
    throw new Error('Enter comma-separated nonnegative contour order indices.');
  const order = parts.map(Number);
  validateMotionContourOrder(order);
  return order;
}
export function validateMotionContourOrder(order?: readonly number[]): void {
  if (
    order &&
    (!order.length ||
      new Set(order).size !== order.length ||
      order.some((value) => !Number.isSafeInteger(value) || value < 0 || value >= order.length))
  )
    throw new Error('Contour order must include each index exactly once, starting at zero.');
}
export type MotionContourReverse = boolean | readonly boolean[];
export function validateMotionContourReverse(reverse: MotionContourReverse): void {
  const values = typeof reverse === 'boolean' ? [reverse] : reverse;
  if (!Array.isArray(values) || !values.length || values.some((v) => typeof v !== 'boolean'))
    throw new Error('Contour directions must be a nonempty list of forward or reverse choices.');
}
/** Explicit directions override the shared reversal in source matching order. */
export function parseMotionContourDirections(
  text: string,
  fallback: boolean,
): MotionContourReverse {
  if (!text.trim()) return fallback;
  const values = text.split(',').map((v) => v.trim().toLowerCase());
  if (values.some((v) => v !== 'forward' && v !== 'reverse'))
    throw new Error('Enter comma-separated forward or reverse contour directions.');
  return values.map((v) => v === 'reverse');
}
/** Reindex only a detached endpoint view; authored keys retain their node order. */
export function shiftMotionContourStart(
  shape: Vector,
  offset: MotionContourStart,
  reverse: MotionContourReverse = false,
  order?: readonly number[],
): Vector {
  validateMotionContourStart(offset);
  validateMotionContourReverse(reverse);
  validateMotionContourOrder(order);
  if (offset === 0 && !reverse && !order) return shape;
  const open = shape.kind === 'bezier' && !shape.closed;
  if (shape.kind !== 'polygon' && shape.kind !== 'bezier') return shape;
  const original = rings(shape);
  if (order && order.length !== original.length)
    throw new Error('Contour order count must match every selected path contour count.');
  const contours = order ? order.map((index) => original[index]) : original;
  if (Array.isArray(offset) && offset.length !== contours.length)
    throw new Error('Contour offset count must match every selected path contour count.');
  if (Array.isArray(reverse) && reverse.length !== contours.length)
    throw new Error('Contour direction count must match every selected path contour count.');
  const shifted = contours.map((ring, contour) => {
    const backward = typeof reverse === 'boolean' ? reverse : reverse[contour];
    const amount = typeof offset === 'number' ? offset : offset[contour];
    if (open && amount) throw new Error('Open path reversal requires a zero contour start offset.');
    if (!ring.length) throw new Error('Contour start matching requires nonempty contours.');
    if (
      !open &&
      ring.length > 1 &&
      ring[0].x === ring[ring.length - 1].x &&
      ring[0].y === ring[ring.length - 1].y
    )
      throw new Error('Contour start matching requires no repeated closing anchor.');
    const index = open ? (backward ? ring.length - 1 : 0) : amount % ring.length;
    if (!backward) return [...ring.slice(index), ...ring.slice(0, index)];
    return ring.map((_, i) => {
      const node = ring[(index - i + ring.length) % ring.length];
      const result = { ...node };
      delete result.in;
      delete result.out;
      if (node.out) result.in = { ...node.out };
      if (node.in) result.out = { ...node.in };
      return result;
    });
  });
  return shape.kind === 'bezier'
    ? { ...shape, nodes: shifted[0] }
    : { ...shape, contours: shifted };
}

/** Invert target alignment without rewriting artwork. The result maps an aligned
 * view back to authored contour/node order, including reversed Bezier handles.
 * This alone is not remembered reversal: its sampler must retain the original
 * source ordering of generated frames before publishing a reversed recipe.
 */
export function inverseMotionContourAlignment(
  shape: Vector,
  offset: MotionContourStart,
  reverse: MotionContourReverse = false,
  order?: readonly number[],
): {start: number[]; reverse: boolean[]; order: number[]} {
  validateMotionNodes(shape);
  // Reuse original alignment admission, including open-path and closing-anchor
  // restrictions, before returning any inverse settings. No authored writes.
  const original=rings(shape);
  if (!original.length || original.some(ring=>!ring.length))
    throw new Error('Inverse alignment requires nonempty polygon or Bezier contours.');
  const aligned=shiftMotionContourStart(shape,typeof offset==='number'?original.map(()=>offset):offset,reverse,order);
  const views=rings(aligned);
  const result={start:new Array<number>(original.length),reverse:new Array<boolean>(original.length),order:new Array<number>(original.length)};
  for(let i=0;i<views.length;i++){
    const authored=order?.[i]??i,n=views[i].length;
    const backward=typeof reverse==='boolean'?reverse:reverse[i];
    const amount=(typeof offset==='number'?offset:offset[i])%n;
    result.order[authored]=i;
    result.reverse[authored]=backward;
    result.start[authored]=backward?amount:(n-amount)%n;
  }
  return result;
}

/** Check simultaneous collapse of each segment's endpoint/control displacements. */
export function validateMotionContourEdges(source: Vector, target: Vector): void {
  if (source.kind !== 'polygon' && source.kind !== 'bezier') return;
  const first = rings(source),
    last = rings(target);
  if (first.length !== last.length)
    throw new Error('Segment validation requires matching contours.');
  first.forEach((ring, r) => {
    const end = last[r];
    if (ring.length < 2 || ring.length !== end.length)
      throw new Error('Segment validation requires matching contour nodes.');
    const count = source.kind === 'bezier' && !source.closed ? ring.length - 1 : ring.length;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % ring.length;
      const curved = ring[i].out || ring[j].in || end[i].out || end[j].in;
      const displacements = (nodes: BezierNode[]) => {
        const a = nodes[i],
          b = nodes[j];
        const controls = curved ? [a.out ?? a, b.in ?? b, b] : [b];
        return controls.flatMap((p) => [p.x - a.x, p.y - a.y]);
      };
      const from = displacements(ring),
        to = displacements(end);
      const components = [...from, ...to],
        scale = Math.max(...components.map(Math.abs));
      if (!components.every(Number.isFinite) || scale === 0)
        throw new Error('Contour segment collapses or is numerically unresolved during motion.');
      const a = from.map((v) => v / scale),
        b = to.map((v) => v / scale);
      const delta = b.map((v, n) => v - a[n]);
      const speed2 = delta.reduce((sum, v) => sum + v * v, 0);
      const dot = a.reduce((sum, v, n) => sum + v * delta[n], 0);
      const t = speed2 === 0 ? 0 : Math.max(0, Math.min(1, -dot / speed2));
      if (Math.hypot(...a.map((v, n) => v + t * delta[n])) <= 64 * Number.EPSILON)
        throw new Error('Contour segment collapses or is numerically unresolved during motion.');
    }
  });
}

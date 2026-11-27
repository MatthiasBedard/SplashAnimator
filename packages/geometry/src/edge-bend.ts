import { clone, type Vector, type Point, type BezierNode } from '../../document/src';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { pathCommands } from './drawing';
import { matrix, inversePoint, mapPoint, type Matrix } from './affine';
import { hitCurve } from './curve-hit';

/** Detached editable outline; primitives retain their original local paint basis. */
export function editableEdgeOutline(source: Vector): Vector | undefined {
  validateLiveGraphicData(source);
  if (['brush', 'text', 'symbol'].includes(source.kind)) return;
  const out = clone(source);
  if (out.contours) return out.fillRule === 'evenodd' ? out : undefined;
  if (out.kind === 'bezier' && out.nodes) return out;
  if (out.kind === 'path' || out.kind === 'polygon' || out.kind === 'line') {
    out.nodes = clone(
      out.points.length
        ? out.points
        : [
            { x: 0, y: 0 },
            { x: out.width, y: out.height },
          ],
    );
    out.closed = !!out.closed || out.kind === 'polygon';
    out.kind = 'bezier';
    out.points = [];
    return out;
  }
  const nodes: BezierNode[] = [];
  for (const command of pathCommands(out)) {
    if (command[0] === 'M' || command[0] === 'L') {
      const p = { x: command[1], y: command[2] };
      if (!nodes.length || p.x !== nodes.at(-1)!.x || p.y !== nodes.at(-1)!.y) nodes.push(p);
    } else if (command[0] === 'C') {
      const a = nodes.at(-1)!,
        b = { x: command[5], y: command[6] };
      if (
        a.x === b.x &&
        a.y === b.y &&
        command[1] === a.x &&
        command[2] === a.y &&
        command[3] === a.x &&
        command[4] === a.y
      )
        continue;
      a.out = { x: command[1], y: command[2] };
      nodes.push({ ...b, in: { x: command[3], y: command[4] } });
    }
  }
  if (nodes.length > 1 && nodes[0].x === nodes.at(-1)!.x && nodes[0].y === nodes.at(-1)!.y) {
    nodes[0].in = nodes.at(-1)!.in;
    nodes.pop();
  }
  out.kind = 'bezier';
  out.nodes = nodes;
  out.points = [];
  out.closed = true;
  return out;
}
function segment(out: Vector, index: number) {
  let offset = 0;
  for (const nodes of out.contours ?? [out.nodes ?? []]) {
    if (index >= offset && index < offset + nodes.length) {
      const i = index - offset;
      if (i === nodes.length - 1 && !out.contours && !out.closed) return;
      return {
        a: nodes[i],
        b: nodes[(i + 1) % nodes.length],
        end: offset + ((i + 1) % nodes.length),
      };
    }
    offset += nodes.length;
  }
}
export function pickBendEdge(source: Vector, point: Point, radius: number, projection?: Matrix) {
  const outline = editableEdgeOutline(source);
  if (!outline) return;
  const hit = hitCurve(outline, point, radius, projection);
  if (!hit) return;
  const pair = segment(outline, hit.index);
  if (!pair) return;
  // A straight segment without handles is hit as a smoothstep cubic. Its new
  // linear controls use geometric progress, keeping the actual grabbed point.
  const t = !pair.a.out && !pair.b.in ? hit.t * hit.t * (3 - 2 * hit.t) : hit.t;
  return { outline, index: hit.index, end: pair.end, t };
}
/** Move a point on a cubic by a stage-space displacement. Endpoint anchors and
 * adjacent segments stay fixed; the two controls use the least-norm solution. */
export function bendEdge(outline: Vector, index: number, t: number, delta: Point): Vector {
  validateLiveGraphicData(outline);
  if (
    !Number.isInteger(index) ||
    !Number.isFinite(t) ||
    t <= 0 ||
    t >= 1 ||
    !Number.isFinite(delta.x) ||
    !Number.isFinite(delta.y)
  )
    throw Error('Invalid edge bend target.');
  const result = clone(outline),
    pair = segment(result, index);
  if (!pair) throw Error('Choose an existing edge.');
  const m = matrix(outline),
    q = inversePoint([m[0], m[1], m[2], m[3], 0, 0], delta);
  if (!Number.isFinite(q.x) || !Number.isFinite(q.y))
    throw Error('The edge transform cannot be inverted.');
  const { a, b } = pair,
    straight = !a.out && !b.in;
  const u = a.out ?? (straight ? { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 } : a);
  const v =
    b.in ?? (straight ? { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 } : b);
  const w1 = 3 * (1 - t) ** 2 * t,
    w2 = 3 * (1 - t) * t * t,
    den = w1 * w1 + w2 * w2;
  const shifted = (p: Point, w: number) => ({ x: p.x + (q.x * w) / den, y: p.y + (q.y * w) / den });
  const outgoing = shifted(u, w1),
    incoming = shifted(v, w2);
  if ([outgoing.x, outgoing.y, incoming.x, incoming.y].some((n) => !Number.isFinite(n)))
    throw Error('The edge bend exceeds finite geometry.');
  if (
    [a, b, outgoing, incoming].some((p) => {
      const w = mapPoint(m, p);
      return !Number.isFinite(w.x) || !Number.isFinite(w.y);
    })
  )
    throw Error('The edge bend exceeds finite stage geometry.');
  a.out = outgoing;
  b.in = incoming;
  return result;
}

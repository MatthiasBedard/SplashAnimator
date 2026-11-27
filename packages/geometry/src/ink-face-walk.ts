import type { Point } from '@splash/document';
import type { Cubic } from './curve-fit';

export type Edge = { curve: Cubic; cubic: boolean };
export const key = (p: Point) => `${p.x},${p.y}`;
export const reverse = (edge: Edge): Edge => {
  const [a, b, c, d] = edge.curve;
  return { curve: [d, c, b, a], cubic: edge.cubic };
};
export const directionKey = (edge: Edge) =>
  (edge.cubic ? edge.curve : [edge.curve[0], edge.curve[3]]).map(key).join(':');

/** Walk the sides of the original subdivided curves. An interior stroke
 * contributes both directions. A tail traversed in both directions by the
 * same face is editable ink but contributes no boundary to that fill. */
export function walkInkRings(boundaries: Edge[][], interior: Edge[], charge: (n: number) => void) {
  type Side = { edge: Edge; allowed: boolean; angle: number; twin: number; next: number };
  const sides: Side[] = [],
    outgoing = new Map<string, number[]>(),
    known = new Set<string>();
  const add = (edge: Edge, twoSided: boolean) => {
    const back = reverse(edge);
    if (known.has(directionKey(edge))) return;
    known.add(directionKey(edge));
    known.add(directionKey(back));
    const start = sides.length;
    for (const [i, directed] of [edge, back].entries()) {
      charge(1);
      const a = directed.curve[0],
        b = directed.curve.find((p) => key(p) !== key(a));
      if (!b) throw Error('Degenerate ink boundary');
      const k = key(a),
        indices = outgoing.get(k) ?? [];
      indices.push(sides.length);
      outgoing.set(k, indices);
      sides.push({
        edge: directed,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        allowed: !i || twoSided,
        twin: start + 1 - i,
        next: -1,
      });
    }
  };
  for (const ring of boundaries) for (const edge of ring) add(edge, false);
  for (const edge of interior) add(edge, true);
  for (const indices of outgoing.values()) {
    indices.sort((a, b) => sides[a].angle - sides[b].angle);
    for (const [i, index] of indices.entries()) {
      const previous = indices[(i + indices.length - 1) % indices.length];
      if (previous !== index && sides[index].angle === sides[previous].angle) return;
      sides[sides[index].twin].next = previous;
    }
  }
  const visited = new Set<number>(),
    rings: Edge[][] = [];
  for (const [start, first] of sides.entries()) {
    if (!first.allowed || visited.has(start)) continue;
    const walk: number[] = [];
    let current = start;
    while (!visited.has(current)) {
      charge(1);
      if (!sides[current].allowed) return;
      visited.add(current);
      walk.push(current);
      current = sides[current].next;
    }
    if (current !== start) return;
    // Repeated vertices delimit closed subwalks, including zero-area
    // out-and-back spurs. Extract each ring without emitting the spur.
    const stack: Edge[] = [],
      positions = new Map<string, number>();
    for (const index of walk) {
      const e = sides[index].edge;
      positions.set(key(e.curve[0]), stack.length);
      stack.push(e);
      const at = positions.get(key(e.curve[3]));
      if (at === undefined) continue;
      const loop = stack.splice(at);
      for (const part of loop) positions.delete(key(part.curve[0]));
      if (loop.length === 2 && directionKey(loop[0]) === directionKey(reverse(loop[1]))) continue;
      rings.push(loop);
    }
    if (stack.length) return;
  }
  return rings;
}

import type { Point } from '@splash/document';
import { boundsIndex, type Bounds } from './bounds-index';
import { certifySimpleCurveWalks } from './compound-fit';
import { splitCubic, type Cubic } from './curve-fit';
import type { Edge } from './ink-face-walk';
import { paintCoordinateUnits } from './paint-winding';

export const hull = ({ curve }: Edge): Bounds => ({
  left: Math.min(...curve.map(p => p.x)), right: Math.max(...curve.map(p => p.x)),
  top: Math.min(...curve.map(p => p.y)), bottom: Math.max(...curve.map(p => p.y)),
});

/** An orthogonal edge fills its closed bounds exactly. A simple ring can
 * therefore retain arbitrarily close distinct steps without a clearance
 * tolerance. Every contact must be the one endpoint shared by neighbors. */
export function simpleOrthogonalRing(ring: Edge[], charge: (cost: number) => void): boolean {
  if (ring.length < 4) return false;
  const boxes: Bounds[] = [];
  for (const [i, { curve: [a, , , b], cubic }] of ring.entries()) {
    charge(1);
    const next = ring[(i + 1) % ring.length].curve[0];
    if (cubic || ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
        (a.x === b.x) === (a.y === b.y) || b.x !== next.x || b.y !== next.y) return false;
    boxes.push({ left: Math.min(a.x, b.x), right: Math.max(a.x, b.x),
      top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) });
  }
  const lookup = boundsIndex(boxes);
  for (const [i, a] of boxes.entries()) {
    for (const j of lookup(a)) {
      charge(1);
      if (j <= i) continue;
      if (j !== i + 1 && !(i === 0 && j === boxes.length - 1)) return false;
      const b = boxes[j];
      if (Math.max(a.left, b.left) < Math.min(a.right, b.right) ||
          Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom)) return false;
    }
  }
  return true;
}

/** Prove disjoint open cubics, allowing a shared endpoint only when the
 * two branches form a simple open walk. A second crossing still rejects. */
export function certifyEdgeInteriors(a: Cubic, b: Cubic, tick: () => void) {
  const same = (p: Point,q: Point) => p.x === q.x && p.y === q.y;
  const reversed = (c: Cubic): Cubic => [c[3],c[2],c[1],c[0]];
  const paths = same(a[3],b[0]) ? [[a,b]] : same(b[3],a[0]) ? [[b,a]] :
    same(a[0],b[0]) ? [[reversed(a),b]] : same(a[3],b[3]) ? [[a,reversed(b)]] : [[a],[b]];
  const scale = Math.max(1,...a.concat(b).flatMap(p=>[Math.abs(p.x),Math.abs(p.y)]));
  certifySimpleCurveWalks(paths,false,64*Number.EPSILON*scale,true,true,tick,true);
}

/** A cut can leave a hole touching its surround at one existing anchor.
 * Prove simplicity and classify the open arcs between junctions. A shared
 * vertex alone cannot distinguish nesting from a crossing. */
export function touchingRingNesting(rings: Edge[][], curves: Cubic[][], charge: (cost: number) => void) {
  const owners = new Map<string, number>();
  let touches = false;
  const all = rings.flatMap((ring,i) => ring.map(edge => {
    charge(1);
    const p = edge.curve[0], key = p.x+','+p.y;
    if (owners.has(key) && owners.get(key) !== i) touches = true;
    owners.set(key,i);
    return {edge,ring:i};
  }));
  if (!touches) return;
  const boxes = all.map(s=>hull(s.edge)), lookup = boundsIndex(boxes);
  const scale = boxes.reduce((max,b)=>Math.max(max,...Object.values(b).map(Math.abs)),1);
  const tick = (cost=1) => charge(cost);
  for (const loop of curves) certifySimpleCurveWalks([loop],true,64*Number.EPSILON*scale,true,true,tick,true);
  for (const [i,span] of all.entries()) for (const j of lookup(boxes[i])) {
    tick();
    if (j>i && span.ring!==all[j].ring) certifyEdgeInteriors(span.edge.curve,all[j].edge.curve,tick);
  }
  const classifiers = rings.map(ring=>paintClassifier(ring,charge));
  const containers = rings.map((ring,i) => {
    const parents: number[] = [];
    for (const [j,inside] of classifiers.entries()) {
      if (j===i) continue;
      const contained = inside(ring[0]);
      if (!ring.every(edge=>inside(edge)===contained)) throw Error('Paint rings cross at a junction');
      if (contained) parents.push(j);
    }
    return parents;
  });
  const depths = containers.map(p=>p.length);
  const parents = containers.map((list,i)=>{
    if (!list.length) return -1;
    const direct = list.filter(j=>depths[j]===depths[i]-1);
    if (direct.length !== 1) throw Error('Ambiguous paint nesting');
    return direct[0];
  });
  return { parents,depths };
}


/** Count a ray from the exact cubic midpoint. Scale each restriction by a
 * positive power of two so the control hull and its signs remain exact. */
function exactMidpointRay(curve: Cubic, probe: Cubic, charge: (n: number) => void) {
  if (![...curve, ...probe].every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return;
  type Controls = [bigint, bigint, bigint, bigint];
  const units = paintCoordinateUnits;
  const relative = (axis: 'x' | 'y') => {
    const [a, b, c, d] = probe.map(p => units(p[axis]));
    const origin = a + 3n * (b + c) + d;
    const [u, v, w, z] = curve.map(p => 8n * units(p[axis]) - origin);
    return [u, v, w, z] as Controls;
  };
  function split([a,b,c,d]: Controls): [Controls, Controls] {
    const middle = a + 3n * (b + c) + d;
    return [
      [8n*a, 4n*(a+b), 2n*(a+2n*b+c), middle],
      [middle, 2n*(b+2n*c+d), 4n*(c+d), 8n*d],
    ];
  }
  function count(x: Controls, y: Controls, depth: number): boolean | undefined {
    charge(1);
    if (x.every(n => n < 0n) || y.every(n => n > 0n) || y.every(n => n < 0n)) return false;
    if (x.every(n => n > 0n)) return (y[0] > 0n) !== (y[3] > 0n);
    if (depth === 96) return;
    const [leftX, rightX] = split(x), [leftY, rightY] = split(y);
    const left = count(leftX, leftY, depth + 1);
    if (left === undefined) return;
    const right = count(rightX, rightY, depth + 1);
    if (right !== undefined) return left !== right;
  }
  return count(relative('x'), relative('y'), 0);
}

export function paintClassifier(edges: Edge[], charge: (n: number) => void, exactCloseProbes = false) {
  const boxes = edges.map(hull), find = boundsIndex(boxes);
  const extent = boxes.reduce((a,b)=>({left:Math.min(a.left,b.left),right:Math.max(a.right,b.right),
    top:Math.min(a.top,b.top),bottom:Math.max(a.bottom,b.bottom)}),
  {left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity});
  const scale = Math.max(1,...Object.values(extent).map(Math.abs));
  return (piece: Edge) => {
    charge(1);
    const p = splitCubic(piece.curve, .5)[0][3];
    const margin = Math.max(scale, Math.abs(p.x), Math.abs(p.y)) * Number.EPSILON * 64;
    if (p.x < extent.left-margin || p.x > extent.right+margin || p.y < extent.top-margin || p.y > extent.bottom+margin) return false;
    let covered = false;
    // Replacing a cubic by its chord preserves winding about p whenever
    // their common control hull excludes p. Only refine ambiguous hulls;
    // dense crossings can be much closer than the display sampling error.
    function count(curve: Cubic, box: Bounds, depth: number): boolean | undefined {
      charge(1);
      if (box.right < p.x-margin || box.top > p.y+margin || box.bottom < p.y-margin) return false;
      if (box.left > p.x+margin) return (curve[0].y > p.y) !== (curve[3].y > p.y);
      if (depth === 48 || Math.max(box.right-box.left, box.bottom-box.top) <= margin) return;
      const [first, second] = splitCubic(curve,.5);
      const left = count(first, hull({curve:first, cubic:true}), depth+1);
      if (left === undefined) return;
      const right = count(second, hull({curve:second, cubic:true}), depth+1);
      if (right !== undefined) return left !== right;
    }
    for (const i of find({ left: p.x, right: Infinity, top: p.y, bottom: p.y }, margin)) {
      const curve = edges[i].curve;
      const ordinary = count(curve, boxes[i], 0);
      if (ordinary === undefined) {
        if (!exactCloseProbes) throw Error('Ambiguous paint boundary');
        // Every boundary must use the same ray ordinate. A rounded midpoint
        // can be on the other side of a vertex even far from the ambiguity.
        const probe = hull(piece);
        let exact = false;
        for (const j of find({ ...probe, right: Infinity })) {
          const crossing = exactMidpointRay(edges[j].curve, piece.curve, charge);
          if (crossing === undefined) throw Error('Ambiguous paint boundary');
          if (crossing) exact = !exact;
        }
        return exact;
      }
      if (ordinary) covered = !covered;
    }
    return covered;
  };
}

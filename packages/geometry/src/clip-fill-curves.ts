import type { MultiPolygon } from 'polygon-clipping';
import type { Vector } from '@splash/document';
import { boundsIndex } from './bounds-index';
import type { Cubic } from './curve-fit';
import { restorePaintCurves } from './paint-curves';
import { regionContains } from './paint-region';

export function hasRestorableFillCurves(shape: Vector) {
  return shape.kind === 'ellipse' || (shape.kind === 'rectangle' && !!shape.cornerRadius) ||
    shape.contours?.some(ring => ring.some(node => node.in || node.out)) ||
    (shape.kind === 'bezier' && shape.closed && shape.nodes?.some(node => node.in || node.out));
}

export const OVERLAY_CURVE_TOLERANCE = 1 / 64;

/** Restore only the original intervals that still clear the cutter. */
export function restoreClippedFillCurves(artwork: Vector[], owners: ReadonlyMap<Vector, Vector>, clip: MultiPolygon,
  curvedCutters: ReadonlySet<Vector> = new Set(), fineSources?: ReadonlySet<Vector>) {
  if (!owners.size) return artwork;
  const cutterBounds = boundsIndex(clip.map(polygon => {
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const [x, y] of polygon[0]) {
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x);
      box.bottom = Math.max(box.bottom, y);
    }
    return box;
  }));
  const sizes = clip.map(polygon=>polygon.reduce((count,ring)=>count+ring.length,0));
  const maxWork = 200000;
  let work = sizes.reduce((sum,size)=>sum+size,0);
  let boundaries: ReturnType<typeof boundsIndex> | undefined;
  function clearsCutter(curve: Cubic) {
    const box = {
      left: Math.min(...curve.map(p => p.x)), top: Math.min(...curve.map(p => p.y)),
      right: Math.max(...curve.map(p => p.x)), bottom: Math.max(...curve.map(p => p.y)),
    };
    const cutters = cutterBounds(box,0.25);
    if (!cutters.length) return true;
    if (work >= maxWork) return false;
    boundaries ??= boundsIndex(clip.flatMap(polygon=>polygon.flatMap(ring=>ring.map(([x,y],i)=>{
      const [u,v] = ring[(i+1)%ring.length];
      return {left:Math.min(x,u),right:Math.max(x,u),top:Math.min(y,v),bottom:Math.max(y,v)};
    }))));
    const edges = boundaries(box,0.25);
    work += 1+edges.length;
    if (edges.length) return false;
    // A connected box that meets no mask boundary is entirely inside or
    // outside. This admits clear spans inside a concavity or hole while
    // keeping the original clearance at actual cut edges.
    const corner = {x:box.left,y:box.top};
    return cutters.every(i=>(work+=sizes[i])<=maxWork && !regionContains([clip[i]],corner));
  }
  const restored = restorePaintCurves(artwork, [...new Set([...curvedCutters, ...owners.values()])], (piece, source, curve) =>
    (curvedCutters.has(source) && owners.has(piece)) || (owners.get(piece) === source && clearsCutter(curve)),
    source => curvedCutters.has(source) || fineSources?.has(source) ? OVERLAY_CURVE_TOLERANCE : 0.25,
  );
  return artwork.map((shape, index) => owners.has(shape) ? restored[index] : shape);
}

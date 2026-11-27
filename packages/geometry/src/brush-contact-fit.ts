import { type BezierNode, type Point, type Vector } from '@splash/document';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { mapPoint, matrix } from './affine';
import { overlaps, type Bounds } from './bounds-index';
import { CURVE_FIT_WORK_LIMIT, fitPolyline, splitCubic, type Cubic } from './curve-fit';
import { crossesHorizontalRay } from './drawing';
import { preparePathSimplification } from './path-edit';
import { certifyRoundBrushFootprint } from './round-brush-fit';

const bounds = (points: Point[]): Bounds => ({
  left: Math.min(...points.map(point=>point.x)), right: Math.max(...points.map(point=>point.x)),
  top: Math.min(...points.map(point=>point.y)), bottom: Math.max(...points.map(point=>point.y)),
});

/** Prepare a detached fit for a straight sweep with one exact triangular lobe.
 * Keep the lobe and all edges near its attachment at their original coordinates. */
export function prepareBrushContactFit(source: Vector, tolerance: number): Vector | undefined {
  if (!Number.isFinite(tolerance) || tolerance <= .025 || tolerance > 100) return;
  try {
    validateLiveGraphicData(source);
    if (source.kind !== 'polygon' || !source.closed || source.fillRule !== 'evenodd' ||
        source.fillEnabled === false || source.strokeWidth || source.rotation || source.transform ||
        source.contours?.length !== 1) return;
    const ring = source.contours[0];
    if (ring.length < 7 || ring.length > CURVE_FIT_WORK_LIMIT || ring.some(point=>point.in || point.out)) return;
    const seen = new Map<string, number>();
    let contact = -1;
    for (const [index, point] of ring.entries()) {
      const key = `${point.x},${point.y}`, previous = seen.get(key);
      if (previous === undefined) seen.set(key,index);
      else {
        if (contact >= 0 || index - previous !== 3) return;
        contact = previous;
      }
    }
    if (contact < 0) return;
    const lobe = ring.slice(contact,contact+3);
    const main = [...ring.slice(contact+3),...ring.slice(0,contact)];
    const basis = matrix(source), world = (point:Point)=>mapPoint(basis,point);
    const [a,b,c] = lobe.map(world);
    const area = (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    if (!Number.isFinite(area) || area === 0) return;
    const protectedBox = bounds([a,b,c]);
    const margin = Math.max(1,Math.abs(a.x),Math.abs(a.y),Math.abs(b.x),Math.abs(b.y),
      Math.abs(c.x),Math.abs(c.y))*Number.EPSILON*64;
    const original = main.map(world);
    // Keep every difference product in the ray test finite.
    const safeRayPoint = ({x,y}:Point) => Number.isFinite(16*x*x+16*y*y);
    if (![a,b,c].every(safeRayPoint) || !original.every(safeRayPoint)) return;
    let run = 0, start = 0, count = 0;
    for (let i=0;i<original.length;i++) {
      if (overlaps(bounds([original[i],original[(i+1)%original.length]]),protectedBox,margin+tolerance)) run=0;
      else run++;
      if (run>count) { start=i-run+1; count=run; }
    }
    if (count < 2 || start === 0 || start+count >= main.length) return;
    const end = start+count;
    const span = main.slice(start,end+1);
    const reduced = preparePathSimplification(span,basis)(tolerance/2);
    const fit = fitPolyline(reduced,tolerance/2,false,tolerance/2,{workLimit:CURVE_FIT_WORK_LIMIT});
    if (fit.nodes.length >= span.length) return;

    // A cubic and a chord inside the same convex hull have equal ray parity
    // at any point outside that hull. Compare the original and fitted spans
    // at one witness since both spans avoid the entire connected lobe box.
    const witness = {x:a.x+((b.x-a.x)+(c.x-a.x))/3,y:a.y+((b.y-a.y)+(c.y-a.y))/3};
    let hullWork = 0, parity = false;
    const clear = (curve: Cubic, depth: number): boolean => {
      if (++hullWork > CURVE_FIT_WORK_LIMIT || !curve.every(safeRayPoint)) return false;
      if (overlaps(bounds(curve),protectedBox,margin)) {
        return depth < 12 && splitCubic(curve,.5).every(half=>clear(half,depth+1));
      }
      parity = parity !== crossesHorizontalRay(curve[0],curve[3],witness);
      return true;
    };
    if (fit.curves.some(([a,b,c,d])=>!clear([world(a),world(b),world(c),world(d)],0))) return;
    for (let i=start;i<end;i++) {
      parity = parity !== crossesHorizontalRay(original[i],original[i+1],witness);
    }
    if (parity) return;

    const adjusted: BezierNode[] = [...main.slice(0,start), ...fit.nodes, ...main.slice(end+1)];
    if (!certifyRoundBrushFootprint({...source,contours:[main]},
      {...source,contours:[adjusted]},tolerance)) return;
    // Separate the two closed walks at their exact shared vertex. Their
    // even-odd coverage is the same as the original walk. Downstream cutters
    // can certify touching rings through their existing distinct-ring proof.
    const result = structuredClone({...source,contours:[adjusted,lobe]});
    validateLiveGraphicData(result);
    return result;
  } catch {
    return;
  }
}

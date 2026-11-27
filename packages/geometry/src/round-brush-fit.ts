import { clone, type Point, type Vector } from '@splash/document';
import { boundsIndex, type Bounds } from './bounds-index';
import { certifyCompoundContours } from './compound-fit';
import { CURVE_FIT_WORK_LIMIT, fitPolyline, type Cubic } from './curve-fit';
import { crossesHorizontalRay, flattenCommands, normalizeVector, type Command } from './drawing';
import { brushNib } from './pressure';
import { traceRoundBrush } from './round-brush-trace';
import { matrix, mapPoint } from './affine';
import { PATH_SIMPLIFICATION_WORK_LIMIT, preparePathSimplification } from './path-edit';
import { validateLiveGraphicData } from '../../document/src/live-motion';

const comparisonWorkLimit = 200_000;
const flattenTolerance = .025;

const bounds = (a: Point, b: Point): Bounds => ({
  left: Math.min(a.x,b.x), right: Math.max(a.x,b.x),
  top: Math.min(a.y,b.y), bottom: Math.max(a.y,b.y),
});

function ringBounds(ring: Point[]): Bounds {
  return ring.reduce((box, point) => ({
    left:Math.min(box.left,point.x), right:Math.max(box.right,point.x),
    top:Math.min(box.top,point.y), bottom:Math.max(box.bottom,point.y),
  }), bounds(ring[0],ring[0]));
}

function distance(p: Point, a: Point, b: Point) {
  const x = p.x-a.x, y = p.y-a.y, dx = b.x-a.x, dy = b.y-a.y;
  const lengthSquared = dx*dx+dy*dy;
  const t = lengthSquared ? Math.max(0, Math.min(1,(x*dx+y*dy)/lengthSquared)) : 0;
  return Math.hypot(x-t*dx,y-t*dy);
}

function edges(ring: Point[]) {
  return ring.map((a,i) => [a,ring[(i+1)%ring.length]] as const);
}

/** Every part of each source edge must lie inside a target edge's tolerance
 * capsule. Capsules are convex. Subdivision only adds proof intervals. */
function boundaryNear(source: Point[], target: Point[], tolerance: number, tick: () => void) {
  const targetEdges = edges(target);
  const lookup = boundsIndex(targetEdges.map(([a,b])=>bounds(a,b)));
  const close = (a: Point,b: Point,depth: number): boolean => {
    tick();
    const mid = {x:a.x+(b.x-a.x)/2,y:a.y+(b.y-a.y)/2};
    const candidates = lookup(bounds(mid,mid),tolerance);
    if (candidates.some(index => {
      tick();
      const [start,end] = targetEdges[index];
      return distance(a,start,end) <= tolerance && distance(b,start,end) <= tolerance;
    })) return true;
    return depth < 12 && candidates.length > 0 &&
      close(a,mid,depth+1) && close(mid,b,depth+1);
  };
  return edges(source).every(([a,b])=>close(a,b,0));
}

function area(ring: Point[]) {
  const origin = ring[0];
  return edges(ring).reduce((sum,[a,b]) =>
    sum+(a.x-origin.x)*(b.y-origin.y)-(a.y-origin.y)*(b.x-origin.x), 0);
}

function curveOutline(shape: Vector): Cubic[][] {
  const m = matrix(shape);
  return shape.contours!.map(ring => ring.map((node,i): Cubic => {
    const next = ring[(i+1)%ring.length];
    return [mapPoint(m,node), mapPoint(m,node.out??node), mapPoint(m,next.in??next), mapPoint(m,next)];
  }));
}

function curveSamples(curves: Cubic[]) {
  const [start] = curves[0];
  const commands: Command[] = [['M',start.x,start.y]];
  for (const [,a,b,d] of curves) commands.push(['C',a.x,a.y,b.x,b.y,d.x,d.y]);
  return flattenCommands(commands, flattenTolerance)[0].slice(0,-1);
}

/** Compare a detached, fitted candidate to the established sweep. Ring count
 * alone is insufficient: each ring needs one independent boundary match,
 * and all matched curves must pass the complete compound topology check. */
export function certifyRoundBrushFootprint(original: Vector, candidate: Vector, tolerance: number) {
  if (!Number.isFinite(tolerance) || tolerance <= flattenTolerance ||
      original.fillRule !== 'evenodd' || candidate.fillRule !== 'evenodd' ||
      original.kind !== 'polygon' || candidate.kind !== 'polygon' ||
      original.fillEnabled === false || candidate.fillEnabled === false ||
      original.strokeWidth || candidate.strokeWidth ||
      !original.contours?.length || original.contours.length !== candidate.contours?.length) return false;
  let work = 0;
  const tick = () => {
    if (++work > comparisonWorkLimit) throw Error('Round Brush boundary comparison work limit reached.');
  };
  try {
    validateLiveGraphicData([original,candidate]);
    if (original.contours.some(ring=>ring.some(node=>node.in || node.out))) return false;
    const m = matrix(original);
    const source = original.contours.map(ring=>ring.map(point=>mapPoint(m,point)));
    const curves = curveOutline(candidate), samples = curves.map(curveSamples);
    const boxes = samples.map(ringBounds), lookup = boundsIndex(boxes);
    const used = new Set<number>();
    const matched: Cubic[][] = [];
    const matchedIndices: number[] = [];
    const margin = tolerance - flattenTolerance;
    for (const ring of source) {
      const box = ringBounds(ring);
      const candidates = lookup(box,margin).filter(i => {
        tick();
        const other = boxes[i];
        return Math.abs(box.left-other.left)<=margin && Math.abs(box.right-other.right)<=margin &&
          Math.abs(box.top-other.top)<=margin && Math.abs(box.bottom-other.bottom)<=margin;
      });
      const matches = candidates.filter(i =>
        boundaryNear(ring,samples[i],margin,tick) && boundaryNear(samples[i],ring,margin,tick));
      if (matches.length !== 1 || used.has(matches[0])) return false;
      const index = matches[0], boundary = curves[index];
      used.add(index);
      matchedIndices.push(index);
      matched.push(Math.sign(area(ring)) === Math.sign(area(samples[index])) ? boundary :
        boundary.slice().reverse().map(([a,b,c,d]) => [d,c,b,a]));
    }
    const {depths} = certifyCompoundContours(source, matched, tolerance, 0, true, 'dense', true);
    const rayTests = samples.map(ring => {
      const sides = edges(ring);
      work += sides.length;
      tick();
      const search = boundsIndex(sides.map(([a,b])=>bounds(a,b)));
      return (point:Point) => search({left:point.x,right:Infinity,top:point.y,bottom:point.y})
        .reduce((inside,i)=>{
          tick();
          return inside !== crossesHorizontalRay(sides[i][0],sides[i][1],point);
        },false);
    });
    for (const [i, index] of matchedIndices.entries()) {
      const point = samples[index][0];
      let depth = 0;
      for (const other of lookup(bounds(point,point))) {
        if (other === index) continue;
        tick();
        if (rayTests[other](point)) depth++;
      }
      if (depth !== depths[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Evaluate traced rings privately. The existing stroke sweep is the topology
 * witness for this trial. Only a whole, certified footprint is returned. */
export function prepareTracedRoundBrush(brush: Vector, line: Point[], amount: number, spacing: number, original: Vector) {
  const tip = brush.brush;
  if (brush.kind !== 'brush' || !line.length || brush.transform || !Number.isFinite(amount) || amount <= 0 ||
      (tip && (tip.aspect !== 1 || tip.tilt || tip.twist || tip.opacityProfile))) return;
  const sweep = {...brush, points:line};
  validateLiveGraphicData(sweep);
  const radius = brushNib(brush,line[0]).rx;
  if (line.some(point=>brushNib(brush,point).rx !== radius)) return;
  const rings = traceRoundBrush(line,radius,spacing,true);
  if (!rings) return;
  if (rings.length !== original.contours?.length) return;
  const tolerance = Math.min(1.25,amount*2);
  try {
    const contours = fitTracedRings(rings,tolerance);
    const fitted: Vector = {...clone(brush), id:original.id, kind:'polygon', brush:undefined, points:[], closed:true,
      fillEnabled:true, strokeWidth:0, fillRule:'evenodd', drawingMode:'merge', contours};
    normalizeVector(fitted);
    if (certifyRoundBrushFootprint(original,fitted,tolerance)) return fitted;
  } catch {
    return;
  }
}

function fitTracedRings(rings: Point[][], tolerance: number) {
  let simplificationWork = PATH_SIMPLIFICATION_WORK_LIMIT;
  let fittingWork = CURVE_FIT_WORK_LIMIT;
  const charge = (work:number) => {
    simplificationWork -= work;
    if (simplificationWork < 0) throw Error('Round Brush trace simplification work limit reached.');
  };
  const identity: ReturnType<typeof matrix> = [1,0,0,1,0,0];
  return rings.map(ring => {
    const middle = Math.floor(ring.length / 2);
    const spans = [ring.slice(0,middle+1),[...ring.slice(middle),ring[0]]];
    // Spend part of the outline allowance on reducing dense lattice samples.
    // The final comparison measures the assembled curves against the sweep.
    const reduced = spans.flatMap(span =>
      preparePathSimplification(span,identity,charge)(tolerance*.22).slice(0,-1));
    if (reduced.length < 3) return ring;
    const fit = fitPolyline(reduced,tolerance*.52,true,0,{workLimit:fittingWork,windowSamples:128});
    fittingWork -= fit.work;
    // A two-cubic fit can collapse or pinch a tiny hole. Keep the reduced
    // linear boundary and require it to pass the same compound comparison.
    return fit.nodes.length >= 3 ? fit.nodes : reduced;
  });
}

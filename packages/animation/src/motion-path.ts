import { createCubicDistanceCorrespondence } from '../../geometry/src/cubic-distance';
export { createCubicDistanceCorrespondence, captureCubicDistanceCorrespondence } from '../../geometry/src/cubic-distance';
import type { Point } from '@splash/document';
import { validateMotionPath, type MotionPath } from '../../document/src/motion-path';
export { validateMotionPath, type MotionPath } from '../../document/src/motion-path';

/** Reverse a route with frozen controls; callers verify reconstructed artwork. */
export function reverseMotionPath(from: Point, to: Point, path: MotionPath): MotionPath {
  validateMotionPath(path);
  if(path.tangent)throw new Error('Tangent path reversal requires angular correction.');
  let result:MotionPath;
  if(!path.waypoints)result={...path,startX:path.endX,startY:path.endY,endX:path.startX,endY:path.startY};
  else if(path.curvedWaypoints){
    const parts=curvedWaypointSegments(from,to,path.waypoints,path.waypointTangents,path.waypointIncoming);
    result={...curvedPartsRecipe(parts.reverse().map(([a,b,c,d])=>[d,c,b,a])),...(path.distance?{distance:true}:{})};
  }else result={...path,waypoints:[...path.waypoints].reverse().map(p=>({x:from.x+p.x-to.x,y:from.y+p.y-to.y}))};
  validateMotionPath(result);return result;
}

export function reverseTangentCubicPath(from: Point, to: Point, path: MotionPath) {
  if (path.waypoints !== undefined) throw new Error('Choose a single tangent cubic path.');
  return reverseTangentMotionPath(from, to, path);
}

/** Return the reversed geometry and the two corrections to attach to its recipe. */
export function reverseTangentMotionPath(from: Point, to: Point, path: MotionPath): {path: MotionPath; headingOffset: number; headingOffsetEnd?: number} {
  validateMotionPath(path);
  if (!path.tangent)
    throw new Error('Choose a tangent cubic or waypoint path.');
  if (![from.x,from.y,to.x,to.y].every(Number.isFinite))
    throw new Error('Tangent reversal endpoints must be finite.');
  // Compile both directions before returning anything. These preserve existing
  // interior stationary-derivative and continuous heading-branch guards.
  const {headingOffset:priorOffset=0,headingOffsetEnd:priorEnd,...base}=path;
  const original = createMotionPathSampler(from,to,base);
  const reversed: MotionPath = {...reverseMotionPath(from,to,{...base,tangent:false}),tangent:true};
  const sample = createMotionPathSampler(to,from,reversed);
  // The first forward segment and last backward segment have opposite travel
  // directions. Their endpoint limits avoid the outgoing-heading convention
  // at interior corners. Cubics use the midpoint to avoid stationary endpoints.
  const anchor = path.waypoints === undefined ? 0.5 : 0;
  const difference = original(anchor).tangentAngle! - sample(1-anchor).tangentAngle!;
  const headingOffset = 180 + 360 * Math.round((difference - 180) / 360);
  if (!Number.isSafeInteger(headingOffset) || !Number.isFinite(difference))
    throw new Error('Tangent reversal angular correction exceeds numeric limits.');
  // Reverse the correction in the same progress domain as the cubic. Preserve
  // an explicit end even when equal, and validate both composed original values.
  const correction={headingOffset:headingOffset+(priorEnd??priorOffset),
    ...(priorEnd!==undefined?{headingOffsetEnd:headingOffset+priorOffset}:{})};
  validateMotionPath({...reversed,...correction});
  return {path:reversed,...correction};
}

/** Distance-timed polylines remain distance-timed after cutting an interior segment. */
export function splitPreservedMotionPath(from: Point, to: Point, path: MotionPath, progress: number): [MotionPath, MotionPath] {
  validateMotionPath(path);
  if (path.tangent) {
    if (!Number.isFinite(progress) || progress<=0 || progress>=1) throw new Error('Choose an interior tangent split progress.');
    const original=createMotionPathSampler(from,to,path),cut=original(progress);
    const {headingOffset=0,headingOffsetEnd=headingOffset,...base}=path;
    const raw=createMotionPathSampler(from,to,base);
    const middle=headingOffset*(1-progress)+headingOffsetEnd*progress;
    const halves = base.waypoints && !base.distance
      ? splitWaypointJunction(from, to, base, progress)
      : splitPreservedMotionPath(from, to, {...base, tangent:false}, progress);
    return halves.map((half,i)=>{
      const candidate={...half,tangent:true};
      // A waypoint half starts on the original outgoing segment. The samplers
      // independently lift headings, so align the shared start branch first.
      const anchor = path.waypoints ? 0 : 0.5;
      const local=createMotionPathSampler(i?cut:from,i?to:cut,candidate)(anchor).tangentAngle!;
      const global=raw(i?progress+(1-progress)*anchor:progress*anchor).tangentAngle!;
      const branch=360*Math.round((global-local)/360);
      // The promoted key includes the cut heading. Remove its contribution
      // from the new base rotation interpolation, preserving the lifted branch.
      const start=(i?middle-cut.tangentAngle!:headingOffset)+branch;
      const end=(i?headingOffsetEnd:middle-cut.tangentAngle!)+branch;
      if ((path.distance || path.waypoints) && path.headingOffset === undefined && start === 0 && end === 0) return candidate;
      const result={...candidate,headingOffset:start,...(start!==end?{headingOffsetEnd:end}:{})};
      validateMotionPath(result);return result;
    }) as [MotionPath,MotionPath];
  }
  if (!path.waypoints) {
    if (!path.distance) return splitCubicMotionPath(from, to, path, progress);
    validateMotionPath(path);
    if (!Number.isFinite(progress) || progress <= 0 || progress >= 1)
      throw new Error('Preserved path split has an unresolved distance interval.');
    // Use the same world-space table as playback; relative controls alone can
    // round differently at distant origins. The caller verifies both new tables.
    const a = {x:from.x+path.startX,y:from.y+path.startY};
    const b = {x:to.x+path.endX,y:to.y+path.endY};
    const parameter = createCubicDistanceCorrespondence([[from,a,b,to]]).parameter(progress);
    const halves = splitCubicMotionPath(from,to,{...path,distance:false},parameter);
    return halves.map(half=>({...half,distance:true})) as [MotionPath,MotionPath];
  }
  validateMotionPath(path);
  if (!path.distance && !path.tangent) return splitWaypointJunction(from, to, path, progress);
  if (path.distance && path.curvedWaypoints && !path.tangent) {
    if (!Number.isFinite(progress) || progress <= 0 || progress >= 1)
      throw new Error('Preserved path split has an unresolved distance interval.');
    const segments=curvedWaypointSegments(from,to,path.waypoints!,path.waypointTangents,path.waypointIncoming);
    const cut=createCubicDistanceCorrespondence(segments).parameter(progress)*segments.length;
    const index=Math.floor(cut),local=cut-index;
    if(index<0 || index>=segments.length || !(cut>0 && cut<segments.length))
      throw new Error('Preserved curved waypoint split is unresolved.');
    const left=segments.slice(0,index),right=segments.slice(index+1);
    if(local===0)right.unshift(segments[index]);
    else {
      const [a,b,c,d]=segments[index];
      const mix=(a:Point,b:Point):Point=>({x:a.x*(1-local)+b.x*local,y:a.y*(1-local)+b.y*local});
      const ab=mix(a,b),bc=mix(b,c),cd=mix(c,d),abc=mix(ab,bc),bcd=mix(bc,cd),middle=mix(abc,bcd);
      left.push([a,ab,abc,middle]);right.unshift([middle,bcd,cd,d]);
    }
    const result:[MotionPath,MotionPath]=[{...curvedPartsRecipe(left),distance:true},{...curvedPartsRecipe(right),distance:true}];
    result.forEach(validateMotionPath);return result;
  }
  if (!path.distance || path.curvedWaypoints || path.tangent)
    throw new Error('Preserved path splits require a single cubic or a distance-timed straight waypoint path without tangent rotation.');
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1)
    throw new Error('Preserved path split has an unresolved progress interval.');
  const points = [{ x: 0, y: 0 }, ...path.waypoints.map(p => ({ ...p })), { x: to.x-from.x, y: to.y-from.y }];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x-points[i].x, p.y-points[i].y));
  if (lengths.some(n => !Number.isFinite(n) || n <= 0))
    throw new Error('Preserved waypoint splits require resolved nonzero segments.');
  const scale = lengths.reduce((a, b) => Math.max(a, b), 0), cumulative = [0];
  for (const length of lengths) {
    const previous = cumulative[cumulative.length-1], next = previous + length/scale;
    if (next === previous) throw new Error('Preserved waypoint distance interval is unresolved.');
    cumulative.push(next);
  }
  const wanted = progress*cumulative[cumulative.length-1];
  if (!(wanted > 0 && wanted < cumulative[cumulative.length-1]))
    throw new Error('Preserved waypoint split has an unresolved distance interval.');
  let index = 0;
  while (index < lengths.length-1 && cumulative[index+1] <= wanted) index++;
  const local = (wanted-cumulative[index])/(cumulative[index+1]-cumulative[index]);
  const a=points[index], b=points[index+1];
  const middle={x:a.x*(1-local)+b.x*local,y:a.y*(1-local)+b.y*local};
  if (local !== 0 && (!(local > 0 && local < 1) ||
      (middle.x === a.x && middle.y === a.y) || (middle.x === b.x && middle.y === b.y)))
    throw new Error('Preserved waypoint split position is unresolved.');
  const left=points.slice(0,index+1), right=points.slice(index+1);
  // At an exact corner retain it only as the new endpoint, avoiding zero segments.
  if (local !== 0) left.push(middle);
  right.unshift(middle);
  return [straightWaypointPart(left, true), straightWaypointPart(right, true)];
}

function straightWaypointPart(points: readonly Point[], distance = false): MotionPath {
  const first = points[0], last = points[points.length - 1];
  const dx = last.x - first.x, dy = last.y - first.y;
  if (points.length === 2 && ((dx !== 0 && dx / 3 === 0) || (dy !== 0 && dy / 3 === 0)))
    throw new Error('Preserved straight segment controls are unresolved.');
  const result: MotionPath = points.length === 2
    ? { startX: dx / 3, startY: dy / 3, endX: -dx / 3, endY: -dy / 3 }
    : { startX: 0, startY: 0, endX: 0, endY: 0, ...(distance ? { distance } : {}),
        waypoints: points.slice(1,-1).map(p => ({ x:p.x-first.x, y:p.y-first.y })) };
  validateMotionPath(result);
  return result;
}

/** Equal-time routes can retain their timing at an existing segment boundary.
 * Freeze original cubic controls: recomputing Catmull-Rom at new ends changes the route. */
function splitWaypointJunction(from: Point, to: Point, path: MotionPath, progress: number): [MotionPath, MotionPath] {
  const cut = progress * (path.waypoints!.length + 1);
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1)
    throw new Error('Preserved path split has an unresolved progress interval.');
  if (!Number.isSafeInteger(cut)) {
    // Uniform subdivision preserves equal segment timing. Only accept an exact
    // representable boundary, never snap the requested progress to a nearby one.
    const count=path.waypoints!.length+1;
    const maxDivisor=Math.floor(256/count);
    let divisor=2;
    while(divisor<=maxDivisor && !Number.isSafeInteger(progress*(count*divisor))) divisor++;
    if(divisor>maxDivisor)
      throw new Error('Preserved equal-time split exceeds the resolved subdivision budget.');
    const origin={x:0,y:0},target={x:to.x-from.x,y:to.y-from.y};
    const vertices=[origin,...path.waypoints!,target];
    if (path.tangent && !path.curvedWaypoints) {
      // Retain actual straight segments: smoothing a corner would change its heading.
      const refined: Point[] = [origin];
      for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i-1], b = vertices[i];
        for (let j = 1; j < divisor; j++) {
          const t = j / divisor;
          refined.push({ x:a.x*(1-t)+b.x*t, y:a.y*(1-t)+b.y*t });
        }
        refined.push(b);
      }
      const boundary = progress * (count * divisor);
      return [
        straightWaypointPart(refined.slice(0, boundary+1)),
        straightWaypointPart(refined.slice(boundary)),
      ];
    }
    const segments: [Point,Point,Point,Point][]=path.curvedWaypoints
      ? curvedWaypointSegments(origin,target,path.waypoints!,path.waypointTangents,path.waypointIncoming)
      : vertices.slice(1).map((end,i)=>{const start=vertices[i];return [start,{x:start.x+(end.x-start.x)/3,y:start.y+(end.y-start.y)/3},{x:end.x-(end.x-start.x)/3,y:end.y-(end.y-start.y)/3},end];});
    const split=(points:[Point,Point,Point,Point],t:number):[[Point,Point,Point,Point],[Point,Point,Point,Point]]=>{
      const mix=(a:Point,b:Point):Point=>({x:a.x*(1-t)+b.x*t,y:a.y*(1-t)+b.y*t});
      const a=mix(points[0],points[1]),b=mix(points[1],points[2]),c=mix(points[2],points[3]),d=mix(a,b),e=mix(b,c),f=mix(d,e);
      return [[points[0],a,d,f],[f,e,c,points[3]]];
    };
    const parts:[Point,Point,Point,Point][]=[];
    for(const segment of segments){let remaining=segment;for(let n=divisor;n>1;n--){const [part,rest]=split(remaining,1/n);parts.push(part);remaining=rest;}parts.push(remaining);}
    const index=progress*parts.length;
    const result:[MotionPath,MotionPath]=[curvedPartsRecipe(parts.slice(0,index)),curvedPartsRecipe(parts.slice(index))];
    result.forEach(validateMotionPath);return result;
  }
  const origin = {x:0,y:0}, target = {x:to.x-from.x,y:to.y-from.y};
  if (!path.curvedWaypoints) {
    const vertices=[origin,...path.waypoints!,target];
    return [straightWaypointPart(vertices.slice(0,cut+1)),straightWaypointPart(vertices.slice(cut))];
  }
  const segments=curvedWaypointSegments(origin,target,path.waypoints!,path.waypointTangents,path.waypointIncoming);
  const result:[MotionPath,MotionPath]=[curvedPartsRecipe(segments.slice(0,cut)),curvedPartsRecipe(segments.slice(cut))];
  result.forEach(validateMotionPath);return result;
}

function curvedPartsRecipe(parts: [Point,Point,Point,Point][]):MotionPath {
    const first=parts[0][0],last=parts[parts.length-1][3];
    if(parts.length===1) return {startX:parts[0][1].x-first.x,startY:parts[0][1].y-first.y,
      endX:parts[0][2].x-last.x,endY:parts[0][2].y-last.y};
    const endControl=parts[parts.length-1][2];
    return {startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,
      waypoints:parts.slice(1).map(s=>({x:s[0].x-first.x,y:s[0].y-first.y})),
      waypointTangents:[...parts.map(s=>({x:s[1].x-s[0].x,y:s[1].y-s[0].y})),{x:last.x-endControl.x,y:last.y-endControl.y}],
      waypointIncoming:parts.slice(0,-1).map(s=>({x:s[2].x-s[3].x,y:s[2].y-s[3].y}))};
}

/** Add a linear endpoint displacement ramp to a detached equal-time route.
 * Curved waypoint splits already carry explicit outgoing/incoming controls. */
export function offsetPreservedPath(path: MotionPath, delta: Point): MotionPath {
  validateMotionPath(path);
  if(path.distance||path.tangent)throw new Error('Pivot path correction requires equal-time segments.');
  const n=(path.waypoints?.length??0)+1,x=delta.x/(3*n),y=delta.y/(3*n);
  let result:MotionPath;
  if(!path.waypoints)result={...path,startX:path.startX+x,startY:path.startY+y,endX:path.endX-x,endY:path.endY-y};
  else {
    if(path.curvedWaypoints&&(!path.waypointTangents||!path.waypointIncoming))throw new Error('Pivot waypoint correction requires explicit controls.');
    result={...path,waypoints:path.waypoints.map((p,i)=>({x:p.x+delta.x*((i+1)/n),y:p.y+delta.y*((i+1)/n)})),
      ...(path.waypointTangents?{waypointTangents:path.waypointTangents.map(p=>({x:p.x+x,y:p.y+y}))}:{}),
      ...(path.waypointIncoming?{waypointIncoming:path.waypointIncoming.map(p=>({x:p.x-x,y:p.y-y}))}:{})};
  }
  validateMotionPath(result);return result;
}

/** Restrict one parameter-timed cubic; handles remain offsets from each new endpoint. */
export function splitCubicMotionPath(from: Point, to: Point, path: MotionPath, progress: number): [MotionPath, MotionPath] {
  validateMotionPath(path);
  if (path.waypoints || path.distance || path.tangent)
    throw new Error('Preserved path splits require a single cubic without distance timing or tangent rotation.');
  if (!Number.isFinite(progress) || progress <= 0 || progress >= 1)
    throw new Error('Preserved path split has an unresolved progress interval.');
  // Work relative to the first origin to avoid subtracting nearby distant world controls.
  const delta = { x: to.x - from.x, y: to.y - from.y };
  const a = { x: path.startX, y: path.startY };
  const b = { x: delta.x + path.endX, y: delta.y + path.endY };
  const mix = (a: Point, b: Point): Point => ({ x: a.x * (1-progress) + b.x * progress, y: a.y * (1-progress) + b.y * progress });
  const p = mix({ x: 0, y: 0 }, a), q = mix(a, b), r = mix(b, delta);
  const v = mix(p, q), w = mix(q, r), middle = mix(v, w);
  const left = { startX: p.x, startY: p.y, endX: v.x - middle.x, endY: v.y - middle.y };
  const right = { startX: w.x - middle.x, startY: w.y - middle.y, endX: r.x - delta.x, endY: r.y - delta.y };
  validateMotionPath(left); validateMotionPath(right);
  return [left, right];
}

export function motionPathPosition(from: Point, to: Point, t: number, path: MotionPath): Point {
  if (path.waypoints) {
    validateMotionPath(path);
    return createWaypointSampler(from, to, { ...path, distance: false })(t);
  }
  const a = { x: from.x + path.startX, y: from.y + path.startY };
  const b = { x: to.x + path.endX, y: to.y + path.endY };
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite))
    throw new Error('Motion path control positions exceed numeric limits.');
  const mix = (left: Point, right: Point): Point => ({
    x: left.x * (1 - t) + right.x * t,
    y: left.y * (1 - t) + right.y * t,
  });
  // de Casteljau retains convex interpolation and exact endpoint positions.
  const left = mix(from, a),
    middle = mix(a, b),
    right = mix(b, to);
  const result = mix(mix(left, middle), mix(middle, right));
  if (![result.x, result.y].every(Number.isFinite))
    throw new Error('Motion path generated invalid coordinates.');
  return result;
}

type MotionPathSample = Point & { tangentAngle?: number };
function samplePath(from: Point, to: Point, parameter: number, path: MotionPath): MotionPathSample {
  const point = motionPathPosition(from, to, parameter, path);
  if (!path.tangent) return point;
  const a = { x: from.x + path.startX, y: from.y + path.startY };
  const b = { x: to.x + path.endX, y: to.y + path.endY };
  // The common derivative factor 3 does not affect heading.
  const u = 1 - parameter;
  const dx =
    u * u * (a.x - from.x) + 2 * u * parameter * (b.x - a.x) + parameter * parameter * (to.x - b.x);
  const dy =
    u * u * (a.y - from.y) + 2 * u * parameter * (b.y - a.y) + parameter * parameter * (to.y - b.y);
  if (![dx, dy].every(Number.isFinite) || (dx === 0 && dy === 0))
    throw new Error(
      'Motion path tangent is undefined at a generated pose. Adjust the path or disable tangent rotation.',
    );
  return { ...point, tangentAngle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** Check roots of the quadratic velocity before frame sampling can skip a cusp.
 * Residuals are relative to the largest control-edge component, not world origin. */
function validatePathTangents(from: Point, to: Point, path: MotionPath): void {
  const controlA = { x: from.x + path.startX, y: from.y + path.startY };
  const controlB = { x: to.x + path.endX, y: to.y + path.endY };
  const edges = [
    controlA.x - from.x,
    controlB.x - controlA.x,
    to.x - controlB.x,
    controlA.y - from.y,
    controlB.y - controlA.y,
    to.y - controlB.y,
  ];
  const scale = Math.max(...edges.map(Math.abs));
  const fail = () => {
    throw new Error(
      'Motion path tangent is stationary or unresolved inside the path. Adjust the path or disable tangent rotation.',
    );
  };
  if (!edges.every(Number.isFinite) || scale === 0) fail();
  const normalized = edges.map((v) => v / scale);
  const stationaryStart = edges[0] === 0 && edges[3] === 0;
  const stationaryEnd = edges[2] === 0 && edges[5] === 0;
  const coefficients = [0, 3].map((i) => {
    const [a, b, c] = normalized.slice(i, i + 3);
    // Factor exact endpoint zeros before solving: rounded quadratic roots can
    // otherwise move an endpoint into the open interval and reject valid motion.
    if (stationaryStart && stationaryEnd) return [0, 0, 2 * b];
    if (stationaryStart) return [0, c - 2 * b, 2 * b];
    if (stationaryEnd) return [0, 2 * b - a, a];
    return [a - 2 * b + c, 2 * (b - a), a];
  });
  const strength = (c: number[]) => Math.max(...c.map(Math.abs));
  const [a, b, c] =
    strength(coefficients[0]) >= strength(coefficients[1]) ? coefficients[0] : coefficients[1];
  const roots: number[] = [];
  const tolerance = 64 * Number.EPSILON;
  if (a === 0) {
    if (b !== 0) roots.push(-c / b);
  } else {
    let discriminant = b * b - 4 * a * c;
    const error = tolerance * (b * b + Math.abs(4 * a * c));
    if (discriminant >= -error) {
      discriminant = Math.max(0, discriminant);
      const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
      if (q === 0) roots.push(-b / (2 * a));
      else roots.push(q / a, c / q);
    }
  }
  for (const t of roots)
    if (
      t > 0 &&
      t < 1 &&
      coefficients.every(([a, b, c]) => Math.abs((a * t + b) * t + c) <= tolerance)
    )
      fail();
}

/** Lift analytic headings into a continuous angle branch without depending on frame order.
 * A quadratic velocity stays inside the convex hull of its three controls. Each
 * accepted interval has all nonzero controls in one open half-plane, so its
 * headings can be lifted relative to a reference without missing a full turn. */
function createHeadingLift(from: Point, to: Point, path: MotionPath) {
  const a = { x: from.x + path.startX, y: from.y + path.startY };
  const b = { x: to.x + path.endX, y: to.y + path.endY };
  const controls = [
    { x: a.x - from.x, y: a.y - from.y },
    { x: b.x - a.x, y: b.y - a.y },
    { x: to.x - b.x, y: to.y - b.y },
  ];
  const scale = Math.max(...controls.flatMap((v) => [Math.abs(v.x), Math.abs(v.y)]));
  const [p, q, r] = controls.map((v) => ({ x: v.x / scale, y: v.y / scale }));
  const nonzero = (v: Point) => v.x !== 0 || v.y !== 0;
  const angle = (v: Point) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
  const lift = (value: number, reference: number) =>
    value + 360 * Math.round((reference - value) / 360);
  const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const intervals: { end: number; heading: number }[] = [];
  let heading = angle([p, q, r].find(nonzero)!);
  let visits = 0;
  function split(p: Point, q: Point, r: Point, lo: number, hi: number, depth: number) {
    if (++visits > 131072 || depth > 32)
      throw new Error('Motion path heading calculation could not resolve continuous tangents.');
    const left = middle(p, q),
      right = middle(q, r),
      center = middle(left, right);
    const length = Math.hypot(center.x, center.y);
    const reference = { x: center.x / length, y: center.y / length };
    if ([p, q, r].every((v) => !nonzero(v) || v.x * reference.x + v.y * reference.y > 0)) {
      const lifted = lift(angle(center), heading);
      intervals.push({ end: hi, heading: lifted });
      heading = lift(angle([r, q, p].find(nonzero)!), lifted);
      return;
    }
    const mid = (lo + hi) / 2;
    split(p, left, center, lo, mid, depth + 1);
    split(center, right, r, mid, hi, depth + 1);
  }
  split(p, q, r, 0, 1, 0);
  return (parameter: number, value: number) => {
    let lo = 0,
      hi = intervals.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (parameter > intervals[mid].end) lo = mid + 1;
      else hi = mid;
    }
    return lift(value, intervals[lo].heading);
  };
}

/** Compile an adaptive distance table once per object, then evaluate each generated frame. */
export function createMotionPathSampler(
  from: Point,
  to: Point,
  path: MotionPath,
): (progress: number) => MotionPathSample {
  validateMotionPath(path);
  if (path.waypoints) {
    const sample = createWaypointSampler(from, to, path);
    const start = path.headingOffset;
    if (start === undefined) return sample;
    const end = path.headingOffsetEnd;
    return progress => {
      const pose = sample(progress);
      const correction = end === undefined ? start : start * (1-progress) + end * progress;
      return { ...pose, tangentAngle: pose.tangentAngle! + correction };
    };
  }
  // Keep evaluated poses on the same geometry used by the compiled distance
  // table and heading lift, even if the caller later edits its draft settings.
  from = { ...from };
  to = { ...to };
  path = { ...path };
  if (path.tangent) validatePathTangents(from, to, path);
  const liftHeading = path.tangent ? createHeadingLift(from, to, path) : undefined;
  // Lift the geometric heading at the cubic parameter. Apply the stored
  // correction in the same eased progress domain as base rotation.
  const sample = (parameter: number, progress: number) => {
    const pose = samplePath(from, to, parameter, path);
    if (liftHeading && pose.tangentAngle !== undefined)
      pose.tangentAngle = liftHeading(parameter, pose.tangentAngle) + (path.headingOffsetEnd === undefined
        ? (path.headingOffset ?? 0)
        : path.headingOffset! * (1-progress) + path.headingOffsetEnd * progress);
    return pose;
  };
  if (!path.distance) return progress => sample(progress, progress);
  const a = { x: from.x + path.startX, y: from.y + path.startY };
  const b = { x: to.x + path.endX, y: to.y + path.endY };
  const parameter = createCubicDistanceMap([[from, a, b, to]]);
  return (progress) => sample(parameter(progress), progress);
}

function createCubicDistanceMap(
  segments: readonly (readonly [Point, Point, Point, Point])[],
): (progress: number) => number {
  return createCubicDistanceCorrespondence(segments).parameter;
}

/** Compile waypoint segments once; straight zero-length segments hold in parameter mode,
 * and consume no distance in distance mode. Coordinates are detached from settings. */
function createWaypointSampler(
  from: Point,
  to: Point,
  path: MotionPath,
): (t: number) => MotionPathSample {
  if (path.curvedWaypoints) {
    const segments = curvedWaypointSegments(
      from,
      to,
      path.waypoints!,
      path.waypointTangents,
      path.waypointIncoming,
    );
    const parameter = path.distance ? createCubicDistanceMap(segments) : (t: number) => t;
    let previousHeading: number | undefined;
    const headings = path.tangent
      ? segments.map(([a, b, c, d]) => {
          const sample = createMotionPathSampler(a, d, {
            startX: b.x - a.x,
            startY: b.y - a.y,
            endX: c.x - d.x,
            endY: c.y - d.y,
            tangent: true,
          });
          // Check every boundary before generation, including joins that no frame samples.
          const first = sample(0).tangentAngle!,
            last = sample(1).tangentAngle!;
          const turns =
            previousHeading === undefined ? 0 : 360 * Math.round((previousHeading - first) / 360);
          if (previousHeading !== undefined && Math.abs(first + turns - previousHeading) > 1e-7)
            throw new Error('Curved waypoint tangent join is numerically unresolved.');
          previousHeading = last + turns;
          return (t: number) => sample(t).tangentAngle! + turns;
        })
      : undefined;
    return (t) => {
      if (!Number.isFinite(t) || t < 0 || t > 1)
        throw new Error('Waypoint progress must be between zero and one.');
      t = parameter(t);
      const index = Math.min(segments.length - 1, Math.floor(t * segments.length));
      const local = t === 1 ? 1 : t * segments.length - index;
      const [a, b, c, d] = segments[index];
      const mix = (p: Point, q: Point): Point => ({
        x: p.x * (1 - local) + q.x * local,
        y: p.y * (1 - local) + q.y * local,
      });
      const result = mix(mix(mix(a, b), mix(b, c)), mix(mix(b, c), mix(c, d)));
      if (!Number.isFinite(result.x) || !Number.isFinite(result.y))
        throw new Error('Curved waypoint interpolation exceeds numeric limits.');
      return headings ? { ...result, tangentAngle: headings[index](local) } : result;
    };
  }
  const distance = path.distance === true;
  const points = [
    { ...from },
    ...path.waypoints!.map((p) => ({ x: from.x + p.x, y: from.y + p.y })),
    { ...to },
  ];
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('Waypoint positions exceed numeric limits.');
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  if (!lengths.every(Number.isFinite)) throw new Error('Waypoint distance exceeds numeric limits.');
  // Polyline headings are right-continuous at corners. Compile the angle branch
  // once so random-access sampling cannot change winding or depend on frame order.
  const headings: number[] | undefined = path.tangent ? [] : undefined;
  if (headings) {
    let previous: Point | undefined;
    for (let i = 0; i < lengths.length; i++) {
      const dx = points[i + 1].x - points[i].x,
        dy = points[i + 1].y - points[i].y;
      const magnitude = Math.max(Math.abs(dx), Math.abs(dy));
      if (magnitude === 0)
        throw new Error('Straight waypoint tangent requires nonzero travel on every segment.');
      const direction = { x: dx / magnitude, y: dy / magnitude };
      if (previous) {
        const cross = previous.x * direction.y - previous.y * direction.x;
        const dot = previous.x * direction.x + previous.y * direction.y;
        if (dot < 0 && Math.abs(cross) <= 64 * Number.EPSILON)
          throw new Error('Straight waypoint tangent reversal is ambiguous or unresolved.');
      }
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const prior = headings[headings.length - 1] ?? angle;
      headings.push(angle + 360 * Math.round((prior - angle) / 360));
      previous = direction;
    }
  }
  const scale = lengths.reduce((largest, n) => Math.max(largest, n), 0);
  const cumulative = [0];
  for (const length of lengths) {
    const previous = cumulative[cumulative.length - 1];
    const next = previous + (scale ? length / scale : 0);
    if (distance && length > 0 && next === previous)
      throw new Error(
        'Waypoint distance interval is numerically unresolved. Use equal segment timing or adjust the path.',
      );
    cumulative.push(next);
  }
  const total = cumulative[cumulative.length - 1];
  return (t) => {
    if (!Number.isFinite(t) || t < 0 || t > 1)
      throw new Error('Waypoint progress must be between zero and one.');
    if (t === 0 || t === 1) {
      const point = { ...points[t === 0 ? 0 : points.length - 1] };
      return headings
        ? { ...point, tangentAngle: headings[t === 0 ? 0 : headings.length - 1] }
        : point;
    }
    let index = Math.min(lengths.length - 1, Math.floor(t * lengths.length));
    let local = t * lengths.length - index;
    if (distance && total > 0) {
      const wanted = t * total;
      let lo = 0,
        hi = cumulative.length - 1;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumulative[mid] <= wanted) lo = mid;
        else hi = mid;
      }
      index = lo;
      local = (wanted - cumulative[lo]) / (cumulative[hi] - cumulative[lo]);
    }
    const a = points[index],
      b = points[index + 1];
    const point = { x: a.x * (1 - local) + b.x * local, y: a.y * (1 - local) + b.y * local };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new Error('Waypoint interpolation exceeds numeric limits.');
    return headings ? { ...point, tangentAngle: headings[index] } : point;
  };
}

/** Default Catmull-Rom conversion with optional linked control offsets; shared by generation and preview.
 * Each segment has equal parameter duration. Adjacent cubic derivatives match.
 * Curves can overshoot; repeated vertices do not imply a stationary hold. */
export function curvedWaypointSegments(
  from: Point,
  to: Point,
  offsets: readonly Point[],
  tangents?: readonly Point[],
  incoming?: readonly Point[],
): [Point, Point, Point, Point][] {
  const points = [
    { ...from },
    ...offsets.map((p) => ({ x: from.x + p.x, y: from.y + p.y })),
    { ...to },
  ];
  if (!points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
    throw new Error('Curved waypoint positions exceed numeric limits.');
  if (
    tangents &&
    (tangents.length !== points.length ||
      tangents.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))
  )
    throw new Error('Custom curve handles require finite offsets matching every vertex.');
  if (
    incoming &&
    (!tangents ||
      incoming.length !== offsets.length ||
      incoming.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))
  )
    throw new Error('Independent incoming handles must match the waypoints.');
  const segments: [Point, Point, Point, Point][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      previous = points[Math.max(0, i - 1)],
      next = points[Math.min(points.length - 1, i + 2)];
    const c = {
      x: a.x + (tangents?.[i].x ?? (b.x - previous.x) / 6),
      y: a.y + (tangents?.[i].y ?? (b.y - previous.y) / 6),
    };
    const d = {
      x: b.x + (incoming?.[i]?.x ?? -(tangents?.[i + 1].x ?? (next.x - a.x) / 6)),
      y: b.y + (incoming?.[i]?.y ?? -(tangents?.[i + 1].y ?? (next.y - a.y) / 6)),
    };
    if (![c.x, c.y, d.x, d.y].every(Number.isFinite))
      throw new Error('Curved waypoint controls exceed numeric limits.');
    segments.push([a, c, d, b]);
  }
  return segments;
}

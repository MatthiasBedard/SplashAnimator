import type { Point, Vector } from '@splash/document';
import { CURVE_FIT_WORK_LIMIT, fitPolyline } from './curve-fit';
import { flattenCommands, pathCommands } from './drawing';
import { brushNib } from './pressure';

/** A tight loop can be one small part of a long stroke. Examine the shortest
 * recent span with travel approaching the nib circumference. If it still
 * fits in a nib-sized box, keep the original sweep rather than risk closing
 * its hole. An unresolved scan also leaves the original sweep available. */
function mayContainTightRetrace(points: Point[], radius: number, diameter: number) {
  const spanLength = 5 * radius;
  const distance = (index: number) =>
    Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  let length = 0, start = 0, work = CURVE_FIT_WORK_LIMIT;
  for (let end = 1; end < points.length; end++) {
    if (--work < 0) return true;
    length += distance(end);
    if (!Number.isFinite(length)) return true;
    for (; start + 1 < end; start++) {
      const first = distance(start + 1);
      if (length - first < spanLength) break;
      if (--work < 0) return true;
      length -= first;
    }
    if (length < spanLength) continue;
    let left = Math.min(points[start].x, points[end].x);
    let right = Math.max(points[start].x, points[end].x);
    let top = Math.min(points[start].y, points[end].y);
    let bottom = Math.max(points[start].y, points[end].y);
    let i = start + 1;
    for (; i < end && right - left <= diameter && bottom - top <= diameter; i++) {
      if (--work < 0) return true;
      const { x, y } = points[i];
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    if (i === end && right - left <= diameter && bottom - top <= diameter) return true;
  }
  return false;
}

/** Fit a constant-radius round Brush before sweeping the nib. The
 * sweep sees points sampled along the fitted curve, never the fit's handles.
 * Leave pressure changes, elliptical tips and affine scaling to their
 * established sweeps until they can be fitted with their own error bound. */
export function fitBrushCenterline(brush: Vector, amount: number): Point[] | undefined {
  const { points } = brush;
  const tip = brush.brush;
  if (
    points.length < 3 || !(amount > 0) || brush.transform ||
    (tip && (tip.aspect !== 1 || tip.tilt || tip.twist || tip.opacityProfile))
  ) return;
  const pressure = points[0].pressure ?? 1;
  if (tip?.pressure !== false && points.some(point => (point.pressure ?? 1) !== pressure)) return;
  const radius = brushNib(brush, points[0]).rx;
  const allowance = Math.min(0.75, radius / 12, amount * 1.5);
  if (!(allowance > 0)) return;
  // In a footprint this compact, even a bounded centerline displacement can
  // fill the entire hole of a tight retrace. Sweep the original samples so
  // the boundary fit sees the actual hole and must preserve it.
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  const diameter = 2 * (radius + allowance);
  if (Math.max(right - left, bottom - top) <= diameter ||
      mayContainTightRetrace(points, radius, diameter)) return;
  try {
    const {line} = fittedSamples(brush, points, allowance, CURVE_FIT_WORK_LIMIT);
    if (line.length < 2 || line.length >= points.length) return;
    return line.map(point => ({...point, pressure}));
  } catch {
    // Admission or fitting exhausted its budget. The original sweep remains
    // available with every input sample.
    return;
  }
}

function fittedSamples(brush: Vector, points: Point[], allowance: number, workLimit: number) {
  const tolerance = allowance * 2 / 3;
  const fit = fitPolyline(points, tolerance, false, tolerance, {workLimit, windowSamples:128});
  const [line] = flattenCommands(pathCommands({
    ...brush, kind:'bezier', nodes:fit.nodes, closed:false, contours:undefined,
  }), allowance - tolerance);
  return {line, work:fit.work};
}

function strictlyOrdered(points: Point[], axis: 'x' | 'y', direction: number) {
  return direction !== 0 && points.every((point,index)=>
    index === 0 || (point[axis] - points[index - 1][axis]) * direction > 0);
}

/** Center and raw pressure differences are affine between the combined
 * breakpoints. A power response needs separate maxima before adding the
 * center error to the conservative radius error. */
function carryPressure(source: Point[], line: Point[], allowance: number,
  radiusError: (pressureDifference: number) => number, linear: boolean) {
  const start = source[0], end = source.at(-1)!;
  const axis = (['x','y'] as const).find(axis=>
    strictlyOrdered(source,axis,Math.sign(end[axis]-start[axis])));
  if (!axis || line.length < 2 || line.length >= source.length) return;
  const direction = Math.sign(end[axis]-start[axis]);
  if (!strictlyOrdered(line,axis,direction) ||
      line[0].x !== start.x || line[0].y !== start.y ||
      line.at(-1)!.x !== end.x || line.at(-1)!.y !== end.y) return;
  const other = axis === 'x' ? 'y' : 'x';
  const pressure = (p:Point) => p.pressure ?? 1;
  const sampleAt = (points: Point[]) => {
    let index = 1;
    return (coordinate: number) => {
      while ((points[index][axis] - coordinate) * direction < 0) index++;
      const a=points[index-1], b=points[index];
      const t=(coordinate-a[axis])/(b[axis]-a[axis]);
      return {other:a[other]+(b[other]-a[other])*t,pressure:pressure(a)+(pressure(b)-pressure(a))*t};
    };
  };
  const sourceAt = sampleAt(source);
  const candidate: Point[] = [];
  let maxCenterError = 0;
  for (const p of line) {
    const sample = sourceAt(p[axis]);
    const centerError = Math.abs(sample.other-p[other]);
    if (!(centerError <= allowance)) return;
    maxCenterError = Math.max(maxCenterError, centerError);
    candidate.push({...p,pressure:sample.pressure});
  }
  candidate[0] = {...start};
  candidate[candidate.length-1] = {...end};
  const candidateAt = sampleAt(candidate);
  let maxRadiusError = 0;
  for (const p of source) {
    const sample = candidateAt(p[axis]);
    const centerError = Math.abs(sample.other-p[other]);
    const widthError = radiusError(Math.abs(sample.pressure-pressure(p)));
    if (!(centerError + widthError <= allowance)) return;
    maxCenterError = Math.max(maxCenterError, centerError);
    maxRadiusError = Math.max(maxRadiusError, widthError);
  }
  if (!linear && !(maxCenterError + maxRadiusError <= allowance)) return;
  return candidate;
}

function pressureRadiusError(scale: number, response: number, minimumPressure: number) {
  if (response === 1) return (delta: number) => delta * scale;
  if (response > 1) return (delta: number) => (delta * response) * scale;
  // Sublinear powers have no finite derivative bound at zero. Concavity
  // bounds the change by delta^response even there. A positive lower bound
  // also admits a tighter bound using the maximum derivative on that range.
  const maxSlope = response * minimumPressure ** (response - 1);
  return (delta: number) => scale * (minimumPressure > 0
    ? Math.min(delta ** response, delta * maxSlope) : delta ** response);
}

/** Detached fitting for round pressure strokes. Stationary
 * samples and abrupt width changes are exact barriers. */
export function fitVariablePressureBrushCenterline(brush: Vector, amount: number): Point[] | undefined {
  const tip = brush.brush;
  const points = brush.points;
  const minimum = tip ? tip.minimum : .1;
  const response = tip?.response ?? 1;
  if (brush.kind !== 'brush' || brush.transform || !Number.isFinite(amount) || amount <= 0 ||
      !Number.isFinite(brush.strokeWidth) || brush.strokeWidth <= 0 ||
      !Number.isFinite(minimum) || minimum < 0 || minimum > 1 ||
      !Number.isFinite(response) || response < .25 || response > 4 ||
      points.length < 3 || points.length > CURVE_FIT_WORK_LIMIT ||
      (tip && (!tip.pressure || tip.aspect !== 1 || tip.tilt || tip.twist || tip.opacityProfile ||
        !Number.isFinite(tip.angle)))) return;
  const firstPressure = points[0].pressure ?? 1;
  if (!points.some(p => (p.pressure ?? 1) !== firstPressure)) return;
  let minimumPressure = 1;
  for (const p of points) {
    const pressure = p.pressure ?? 1;
    if (!Number.isFinite(pressure) || pressure < 0 || pressure > 1 ||
        !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.max(Math.abs(p.x),Math.abs(p.y)) > 1e12) return;
    minimumPressure = Math.min(minimumPressure,pressure);
  }
  const halfWidth = brush.strokeWidth / 2;
  const minimumRadius = halfWidth * (minimum + (1 - minimum) * minimumPressure ** response);
  const allowance = Math.min(.75,minimumRadius/12,amount*1.5);
  if (!(allowance > 0)) return;
  const radiusScale = halfWidth * (1 - minimum);
  const radiusError = pressureRadiusError(radiusScale,response,minimumPressure);
  let remaining = CURVE_FIT_WORK_LIMIT - points.length;
  const output: Point[] = [];
  let start = 0;
  for (let end=1;end<=points.length;end++) {
    const previous = points[end-1], next = points[end];
    if (next && (previous.x !== next.x || previous.y !== next.y) &&
        Math.abs((next.pressure ?? 1) ** response - (previous.pressure ?? 1) ** response) *
          radiusScale <= allowance) continue;
    const source = points.slice(start,end);
    let candidate: Point[] | undefined;
    if (source.length >= 3 && remaining >= source.length) {
      try {
        const {line,work} = fittedSamples(brush,source,allowance,remaining);
        remaining -= work + source.length + line.length;
        if (remaining >= 0) candidate = carryPressure(source,line,allowance,radiusError,response === 1);
      } catch {
        // Keep this and any following spans on the original sweep.
        remaining = 0;
      }
    }
    for (const point of candidate ?? source) output.push({...point});
    start = end;
  }
  if (output.length < points.length) return output;
}

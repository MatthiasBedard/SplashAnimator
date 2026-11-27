import { resizeBitmap } from './bitmap';
import { responseSweepSamples } from './brush-response-sweep';
import { simplifyBrushSamples } from './brush-simplify';
import type { Point, Vector } from '@splash/document';
import { matrix, mapPoint } from './affine';
import { localAuthoringBounds } from './authoring-box';
import { resizeGradient } from './gradient';
import { brushContactOpacity, brushNib, interpolateTwist } from './pressure';
export type Command =
  ['M' | 'L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];
export type Dab = { x: number; y: number; rx: number; ry: number; angle: number };
export function brushDabs(s: Vector): Dab[] {
  return [...iterateBrushDabs(s)];
}

function* iterateBrushDabs(s: Vector, preservePressure = false): Generator<Dab & { pressure?: number }> {
  const b = s.brush ?? { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 };
  let previous: (Dab & { pressure?: number }) | undefined;
  let emitted = 0;
  let totalLength = 0;
  for (let i = 1; i < s.points.length; i++)
    totalLength += Math.hypot(s.points[i].x - s.points[i - 1].x, s.points[i].y - s.points[i - 1].y);
  const add = (p: Point) => {
    const dab = { x: p.x, y: p.y, ...brushNib(s, p), ...(preservePressure ? { pressure: p.pressure } : {}) };
    if (
      previous &&
      previous.x === dab.x &&
      previous.y === dab.y &&
      previous.rx === dab.rx &&
      previous.ry === dab.ry &&
      previous.angle === dab.angle &&
      previous.pressure === dab.pressure
    )
      return;
    previous = dab;
    return dab;
  };
  const step = Math.max(0.35, s.strokeWidth * b.minimum * b.aspect * 0.2, totalLength / 50000);
  const angularDistance = (start: number, end: number) =>
    Math.abs(((end - start + 540) % 360) - 180);
  const tiltAngle = (v: Point) => (Math.atan2(v.tiltY ?? 0, v.tiltX ?? 0) * 180) / Math.PI;
  if (s.points[0]) {
    const dab = add(s.points[0]);
    if (dab) {
      emitted++;
      yield dab;
    }
  }
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1],
      p = s.points[i];
    // A narrow nib sweeps paint even without pointer travel. Bound angular
    // sampling independently of positional stamping, with a three-degree
    // endpoint-angle target. Tilt-vector interpolation is nonlinear.
    const twist =
      b.twist && (b.aspect < 1 || b.tilt) ? angularDistance(a.twist ?? 0, p.twist ?? 0) : 0;
    const tilt = b.tilt ? angularDistance(tiltAngle(a), tiltAngle(p)) : 0;
    const count = Math.min(
      4000,
      Math.max(
        1,
        Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / step),
        Math.ceil((twist + tilt) / 3),
      ),
    );

    for (let j = 1; j <= count; j++) {
      const t = j / count;
      const dab = add({
        x: a.x + (p.x - a.x) * t,
        y: a.y + (p.y - a.y) * t,
        pressure: (a.pressure ?? 1) + ((p.pressure ?? 1) - (a.pressure ?? 1)) * t,
        tiltX: (a.tiltX ?? 0) + ((p.tiltX ?? 0) - (a.tiltX ?? 0)) * t,
        tiltY: (a.tiltY ?? 0) + ((p.tiltY ?? 0) - (a.tiltY ?? 0)) * t,
        twist: interpolateTwist(a.twist ?? 0, p.twist ?? 0, t),
      });
      if (dab) {
        emitted++;
        yield dab;
      }
      if (emitted >= 200000)
        throw new Error('Brush geometry exceeds safe rendering limit; split the stroke.');
    }
  }
}

/** Closed preview parts can pause raster work without cutting a filled path. */
export function* brushPreviewParts(s: Vector): Generator<Command[]> {
  const samples = fixedNibSamples(s);
  if (samples) {
    yield* fixedNibParts(s, samples);
    return;
  }
  for (const dab of iterateBrushDabs(s)) {
    const part: Command[] = [];
    ellipse(part, dab.x, dab.y, dab.rx, dab.ry, dab.angle);
    yield part;
  }
}

export type BrushOpacityPart = {
  from: [number, number, number];
  to: [number, number, number];
  commands: Command[];
};

export function brushOpacitySegment(s: Vector, previous: Point | undefined, sample: Point): BrushOpacityPart {
  const profile = s.brush!.opacityProfile!;
  const at = (p: Point): BrushOpacityPart['from'] => [
    p.x, p.y, brushContactOpacity(p.pressure ?? 1, profile.minimum, profile.response),
  ];
  const commands = [...brushPreviewParts({ ...s, points: previous ? [previous, sample] : [sample] })].flat();
  return { from: at(previous ?? sample), to: at(sample), commands };
}

/** Keep each pressure ramp in the same local coordinates as its swept nib. */
export function brushOpacityParts(s: Vector): BrushOpacityPart[] | undefined {
  const profile = s.brush?.opacityProfile;
  if (s.kind !== 'brush' || !profile) return;
  const result: BrushOpacityPart[] = [];
  const point = (p: Point): BrushOpacityPart['from'] => [
    p.x, p.y, brushContactOpacity(p.pressure ?? 1, profile.minimum, profile.response),
  ];
  if (s.brush?.tilt || s.brush?.twist) {
    for (const dab of iterateBrushDabs(s, true)) {
      const commands: Command[] = [];
      ellipse(commands, dab.x, dab.y, dab.rx, dab.ry, dab.angle);
      const at = point(dab);
      result.push({ from: at, to: at, commands });
    }
    return result;
  }
  for (const [index, sample] of s.points.entries()) {
    result.push(brushOpacitySegment(s, s.points[index - 1], sample));
  }
  return result;
}
function ellipse(out: Command[], x: number, y: number, rx: number, ry: number, angle = 0) {
  const k = 0.5522847498307936,
    c = Math.cos(angle),
    sn = Math.sin(angle);
  const p = (u: number, v: number): [number, number] => [x + u * c - v * sn, y + u * sn + v * c];
  out.push(
    ['M', ...p(rx, 0)],
    ['C', ...p(rx, k * ry), ...p(k * rx, ry), ...p(0, ry)],
    ['C', ...p(-k * rx, ry), ...p(-rx, k * ry), ...p(-rx, 0)],
    ['C', ...p(-rx, -k * ry), ...p(-k * rx, -ry), ...p(0, -ry)],
    ['C', ...p(k * rx, -ry), ...p(rx, -k * ry), ...p(rx, 0)],
    ['Z'],
  );
}
// A fixed elliptical nib is a circular sweep in nib coordinates. External
// tangents join adjacent radii; endpoint ellipses supply the round caps/joins.
// Work scales with input samples rather than distance travelled in pixels.
function fixedNibSamples(s: Vector): Point[] | undefined {
  const b = s.brush;
  if (b?.tilt || b?.twist) return;
  return b?.pressure && (b.response ?? 1) !== 1 ? responseSweepSamples(s) : simplifyBrushSamples(s);
}

function fixedNibSweep(s: Vector, out: Command[]): boolean {
  const samples = fixedNibSamples(s);
  if (!samples) return false;
  for (const part of fixedNibParts(s, samples)) out.push(...part);
  return true;
}

// Geometry admission is unchanged, but presentation can pause before building
// the next ellipse/connector instead of allocating the entire command stream.
function* fixedNibParts(s: Vector, samples: Point[]): Generator<Command[]> {
  const b = s.brush;
  const aspect = b?.aspect ?? 1;
  const angle = ((b?.angle ?? 0) * Math.PI) / 180;
  const c = Math.cos(angle),
    sn = Math.sin(angle);
  const offset = (x: number, y: number): [number, number] => [
    c * x - sn * y * aspect,
    sn * x + c * y * aspect,
  ];
  let previous: Dab | undefined;
  for (const p of samples) {
    const d = { x: p.x, y: p.y, ...brushNib(s, p) };
    const cap: Command[] = [];
    ellipse(cap, d.x, d.y, d.rx, d.ry, d.angle);
    yield cap;
    if (previous) {
      const a = previous,
        dx = d.x - a.x,
        dy = d.y - a.y;
      const x = c * dx + sn * dy,
        y = (-sn * dx + c * dy) / aspect;
      const length = Math.hypot(x, y);
      // If one disc contains the other, it already covers the whole sweep.
      if (length > Math.abs(a.rx - d.rx)) {
        const slope = (a.rx - d.rx) / length;
        const side = Math.sqrt(Math.max(0, 1 - slope * slope));
        const nx = x / length,
          ny = y / length;
        const left = offset(nx * slope - ny * side, ny * slope + nx * side);
        const right = offset(nx * slope + ny * side, ny * slope - nx * side);
        yield [
          ['M', a.x + right[0] * a.rx, a.y + right[1] * a.rx],
          ['L', d.x + right[0] * d.rx, d.y + right[1] * d.rx],
          ['L', d.x + left[0] * d.rx, d.y + left[1] * d.rx],
          ['L', a.x + left[0] * a.rx, a.y + left[1] * a.rx],
          ['Z'],
        ];
      }
    }
    previous = d;
  }
}
export function pathCommands(s: Vector): Command[] {
  if (s.kind === 'symbol')
    throw new Error('Break apart the symbol instance before editing its geometry.');
  const out: Command[] = [],
    w = s.width,
    h = s.height;
  if (s.contours) {
    for (const ring of s.contours) {
      if (!ring.length) continue;
      out.push(['M', ring[0].x, ring[0].y]);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length];
        if (a.out || b.in) {
          const u = a.out ?? a,
            v = b.in ?? b;
          out.push(['C', u.x, u.y, v.x, v.y, b.x, b.y]);
        } else if (i < ring.length - 1) out.push(['L', b.x, b.y]);
      }
      out.push(['Z']);
    }
    return out;
  }
  if (s.kind === 'brush') {
    if (fixedNibSweep(s, out)) return out;
    for (const d of brushDabs(s)) ellipse(out, d.x, d.y, d.rx, d.ry, d.angle);
    return out;
  }
  if (s.kind === 'ellipse') {
    ellipse(out, w / 2, h / 2, w / 2, h / 2);
    return out;
  }
  if (s.kind === 'rectangle') {
    const r = Math.min(s.cornerRadius ?? 0, w / 2, h / 2),
      k = 0.5522847498307936;
    return [
      ['M', r, 0],
      ['L', w - r, 0],
      ['C', w - r + r * k, 0, w, r - r * k, w, r],
      ['L', w, h - r],
      ['C', w, h - r + r * k, w - r + r * k, h, w - r, h],
      ['L', r, h],
      ['C', r - r * k, h, 0, h - r + r * k, 0, h - r],
      ['L', 0, r],
      ['C', 0, r - r * k, r - r * k, 0, r, 0],
      ['Z'],
    ];
  }
  if (s.kind === 'bezier' && s.nodes?.length) {
    const nodes = s.nodes;
    out.push(['M', nodes[0].x, nodes[0].y]);
    const count = nodes.length - 1 + (s.closed ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const a = nodes[i],
        b = nodes[(i + 1) % nodes.length],
        c = a.out ?? a,
        d = b.in ?? b;
      out.push(['C', c.x, c.y, d.x, d.y, b.x, b.y]);
    }
    if (s.closed) out.push(['Z']);
    return out;
  }
  const points = s.points.length
    ? s.points
    : [
        { x: 0, y: 0 },
        { x: w, y: h },
      ];
  points.forEach((p, i) => out.push([i ? 'L' : 'M', p.x, p.y]));
  if (s.kind === 'polygon' || s.closed) out.push(['Z']);
  return out;
}
export type CurveTrace = { curve: [Point, Point, Point, Point]; start: number; end: number };
export type TraceCurveSegment = (end: Point, trace: CurveTrace) => void;
/** Transform control points before flattening so tolerance is in document units. */
export function worldPaths(s: Vector, tolerance = 0.25, trace?: TraceCurveSegment): Point[][] {
  const m = matrix(s);
  const point = (x: number, y: number): [number, number] => {
    const p = mapPoint(m, { x, y });
    return [p.x, p.y];
  };
  return flattenCommands(
    pathCommands(s).map((c): Command => {
      if (c[0] === 'Z') return c;
      if (c[0] === 'C')
        return ['C', ...point(c[1], c[2]), ...point(c[3], c[4]), ...point(c[5], c[6])];
      return [c[0], ...point(c[1], c[2])];
    }),
    tolerance,
    trace,
  );
}
export class CurveSubdivisionLimitError extends Error {}

export function flattenCommands(
  commands: Command[],
  tolerance = 0.5,
  trace?: TraceCurveSegment,
): Point[][] {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Invalid curve tolerance');
  let work = 0;
  const paths: Point[][] = [];
  let path: Point[] = [],
    current: Point = { x: 0, y: 0 };
  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const cubic = (
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    depth: number,
    start: number,
    end: number,
    source?: CurveTrace['curve'],
  ) => {
    if (++work > 1000000) throw new CurveSubdivisionLimitError('Curve subdivision limit reached; split the path.');
    const dx = d.x - a.x,
      dy = d.y - a.y,
      length = Math.hypot(dx, dy);
    const error = length
      ? Math.max(
          Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx),
          Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx),
        ) / length
      : Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y));
    const overshoot =
      Math.hypot(b.x - a.x, b.y - a.y) +
      Math.hypot(c.x - b.x, c.y - b.y) +
      Math.hypot(d.x - c.x, d.y - c.y) -
      length;
    if (error <= tolerance && overshoot <= tolerance) {
      path.push(d);
      if (source) trace?.(d, { curve: source, start, end });
      return;
    }
    if (depth >= 16) throw new CurveSubdivisionLimitError('Curve tolerance cannot be met; split the path.');
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      cd = midpoint(c, d),
      abc = midpoint(ab, bc),
      bcd = midpoint(bc, cd),
      mid = midpoint(abc, bcd);
    const time = (start + end) / 2;
    cubic(a, ab, abc, mid, depth + 1, start, time, source);
    cubic(mid, bcd, cd, d, depth + 1, time, end, source);
  };
  for (const c of commands) {
    if (c[0] === 'M') {
      path = [{ x: c[1], y: c[2] }];
      paths.push(path);
      current = path[0];
    } else if (c[0] === 'L') {
      current = { x: c[1], y: c[2] };
      path.push(current);
    } else if (c[0] === 'C') {
      const end = { x: c[5], y: c[6] };
      const b = { x: c[1], y: c[2] },
        d = { x: c[3], y: c[4] };
      cubic(current, b, d, end, 0, 0, 1, trace ? [current, b, d, end] : undefined);
      current = end;
    } else if (path.length) {
      path.push({ ...path[0] });
      current = path[0];
    }
  }
  return paths;
}
export const horizontalRayIntersectionX = (a: Point, b: Point, y: number) =>
  ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;

export function crossesHorizontalRay(a: Point, b: Point, p: Point): boolean {
  return (a.y > p.y) !== (b.y > p.y) && p.x < horizontalRayIntersectionX(a, b, p.y);
}

export function containsPoint(points: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (crossesHorizontalRay(a,b,p)) inside = !inside;
  }
  return inside;
}
/** Signed ray crossings for authored nonzero fills, including repeated loops. */
export function windingNumber(points: Point[], p: Point): number {
  let winding = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j],
      b = points[i];
    if (crossesHorizontalRay(a, b, p))
      winding += b.y > a.y ? 1 : -1;
  }
  return winding;
}
export function polystar(
  width: number,
  height: number,
  sides: number,
  innerRatio: number,
): Point[] {
  const n = Math.min(32, Math.max(3, Math.floor(sides))),
    star = innerRatio < 1,
    count = star ? n * 2 : n;
  return Array.from({ length: count }, (_, i) => {
    const a = (i * Math.PI * 2) / count - Math.PI / 2,
      r = star && i % 2 ? Math.max(0.05, innerRatio) : 1;
    return {
      x: width / 2 + ((Math.cos(a) * width) / 2) * r,
      y: height / 2 + ((Math.sin(a) * height) / 2) * r,
    };
  });
}
export function normalizeVector(s: Vector): void {
  if (s.controlBounds === true) {
    const box = localAuthoringBounds(s);
    s.width = box.right - box.left;
    s.height = box.bottom - box.top;
    return;
  }
  const points = s.contours
    ? s.contours.flatMap((r) =>
        r.flatMap((n) => [n, ...(n.in ? [n.in] : []), ...(n.out ? [n.out] : [])]),
      )
    : s.kind === 'bezier'
      ? s.nodes?.flatMap((n) => [n, ...(n.in ? [n.in] : []), ...(n.out ? [n.out] : [])])
      : s.points;
  if (!points?.length) return;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  points.forEach((p) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });
  const origin = mapPoint(matrix(s), { x: minX, y: minY });
  s.x = origin.x;
  s.y = origin.y;
  if (s.pivot) {
    s.pivot.x -= minX;
    s.pivot.y -= minY;
  }
  points.forEach((p) => {
    p.x -= minX;
    p.y -= minY;
  });
  s.width = maxX - minX;
  s.height = maxY - minY;
  if (s.bitmap) {
    s.bitmap.x -= minX;
    s.bitmap.y -= minY;
  }
  if (s.gradient)
    for (const p of [s.gradient.from, s.gradient.to]) {
      p.x -= minX;
      p.y -= minY;
    }
}
export function scaleVector(s: Vector, sx: number, sy: number) {
  const bitmap = s.bitmap ? resizeBitmap(s.bitmap, sx, sy) : undefined;
  const gradient = s.gradient
    ? resizeGradient(
        s.text && !s.gradient.transform
          ? resizeGradient(s.gradient, s.text.scaleX ?? 1, s.text.scaleY ?? 1)
          : s.gradient,
        sx,
        sy,
      )
    : undefined;
  if (s.pivot) {
    s.pivot.x *= sx;
    s.pivot.y *= sy;
  }
  if (s.text) {
    s.text.scaleX = (s.text.scaleX ?? 1) * sx;
    s.text.scaleY = (s.text.scaleY ?? 1) * sy;
  }
  const points = [
    ...s.points,
    ...(s.contours?.flatMap((r) =>
      r.flatMap((n) => [n, ...(n.in ? [n.in] : []), ...(n.out ? [n.out] : [])]),
    ) ?? []),
    ...(s.nodes?.flatMap((n) => [n, ...(n.in ? [n.in] : []), ...(n.out ? [n.out] : [])]) ?? []),
  ];
  points.forEach((p) => {
    p.x *= sx;
    p.y *= sy;
  });
  if (s.controlBounds === true) normalizeVector(s);
  else {
    s.width *= sx;
    s.height *= sy;
  }
  if (gradient) s.gradient = gradient;
  if (bitmap) s.bitmap = bitmap;
}
export function smoothPoints(points: Point[]): Point[] {
  return points.map((p, i) =>
    i === 0 || i === points.length - 1
      ? { ...p }
      : {
          ...p,
          x: (points[i - 1].x + p.x * 2 + points[i + 1].x) / 4,
          y: (points[i - 1].y + p.y * 2 + points[i + 1].y) / 4,
        },
  );
}

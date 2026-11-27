import { clone, type Point, type Vector } from '@splash/document';
function pressure(value: number) {
  if (!Number.isFinite(value)) throw new Error('Pressure must be finite');
  return Math.max(0, Math.min(1, value));
}
function editable(s: Vector) {
  if (s.kind !== 'brush' || !s.points.length)
    throw new Error('Select a brush stroke with editable samples');
  const result = clone(s);
  result.brush = {
    pressure: true,
    minimum: 0.1,
    aspect: 1,
    tilt: false,
    angle: 0,
    ...result.brush,
  };
  result.brush.pressure = true;
  return result;
}
export function editPressureSample(s: Vector, index: number, value: number): Vector {
  if (!Number.isInteger(index) || index < 0 || index >= s.points.length)
    throw new Error('Unknown brush sample');
  const next = editable(s);
  next.points[index].pressure = pressure(value);
  return next;
}
export function applyPressureProfile(
  s: Vector,
  start: number,
  middle: number,
  end: number,
): Vector {
  const a = pressure(start),
    b = pressure(middle),
    c = pressure(end),
    next = editable(s),
    lengths = [0];
  for (let i = 1; i < s.points.length; i++)
    lengths.push(
      lengths[i - 1] +
        Math.hypot(s.points[i].x - s.points[i - 1].x, s.points[i].y - s.points[i - 1].y),
    );
  const total = lengths.at(-1)!;
  next.points.forEach((p, i) => {
    const t = total ? lengths[i] / total : 0;
    p.pressure = t <= 0.5 ? a + (b - a) * t * 2 : b + (c - b) * (t - 0.5) * 2;
  });
  return next;
}

export function pressureHandle(s: Vector, index: number) {
  const p = s.points[index];
  if (s.kind !== 'brush' || !p) throw new Error('Unknown brush sample');
  const { rx, angle } = brushNib(s, p);
  return { x: p.x + Math.cos(angle) * rx, y: p.y + Math.sin(angle) * rx, angle };
}
export function dragPressure(s: Vector, index: number, target: { x: number; y: number }) {
  const p = s.points[index],
    handle = pressureHandle(s, index),
    minimum = s.brush?.minimum ?? 0.1;
  const radius =
    (target.x - p.x) * Math.cos(handle.angle) + (target.y - p.y) * Math.sin(handle.angle);
  if (s.strokeWidth <= 0 || minimum >= 1) return clone(s);
  return editPressureSample(
    s,
    index,
    pressureResponse(
      (radius / (s.strokeWidth / 2) - minimum) / (1 - minimum),
      s.brush?.response ?? 1,
      true,
    ),
  );
}
export function reversePressure(s: Vector): Vector {
  const next = editable(s),
    lengths = [0];
  for (let i = 1; i < s.points.length; i++)
    lengths.push(
      lengths[i - 1] +
        Math.hypot(s.points[i].x - s.points[i - 1].x, s.points[i].y - s.points[i - 1].y),
    );
  const total = lengths.at(-1)!;
  let j = s.points.length - 1;
  next.points.forEach((p, i) => {
    const distance = total - lengths[i];
    while (j > 0 && lengths[j - 1] >= distance) j--;
    const a = Math.max(0, j - 1),
      span = lengths[j] - lengths[a],
      t = span ? (distance - lengths[a]) / span : 0;
    p.pressure = (s.points[a].pressure ?? 1) * (1 - t) + (s.points[j].pressure ?? 1) * t;
  });
  return next;
}

/** Curve response changes rendered width while retaining raw pressure samples. */
export function pressureResponse(value: number, response = 1, inverse = false): number {
  if (!Number.isFinite(response) || response < 0.25 || response > 4)
    throw new Error('Pressure response must be between 0.25 and 4');
  return Math.pow(pressure(value), inverse ? 1 / response : response);
}

/** Set uniform stroke opacity from the first pen contact, independently of width. */
export function brushContactOpacity(value: number, minimum: number, response: number): number {
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 1)
    throw new Error('Minimum brush opacity must be between 0 and 1');
  if (!Number.isFinite(response)) throw new Error('Opacity response must be between 0.25 and 4');
  return minimum + (1 - minimum) * pressureResponse(value, response);
}

export function brushNib(s: Pick<Vector, 'strokeWidth' | 'brush'>, p: Point) {
  const b = s.brush ?? { pressure: true, minimum: 0.1, tilt: false, aspect: 1, angle: 0 };
  const tx = p.tiltX ?? 0,
    ty = p.tiltY ?? 0,
    tilt = b.tilt ? Math.min(1, Math.hypot(tx, ty) / 90) : 0;
  const rx =
    (s.strokeWidth / 2) *
    (b.pressure
      ? b.minimum + (1 - b.minimum) * pressureResponse(p.pressure ?? 1, b.response ?? 1)
      : 1);
  return {
    rx,
    ry: rx * b.aspect * (1 - tilt * 0.75),
    angle:
      (b.angle * Math.PI) / 180 +
      (tilt ? Math.atan2(ty, tx) : 0) +
      (b.twist ? ((p.twist ?? 0) * Math.PI) / 180 : 0),
  };
}
export function interpolateTwist(a: number, b: number, t: number) {
  const delta = ((b - a + 540) % 360) - 180;
  return (((a + delta * t) % 360) + 360) % 360;
}

export function smoothBrushSamples(points: Point[], amount: number): Point[] {
  if (!Number.isFinite(amount) || amount < 0 || amount > 10)
    throw new Error('Invalid brush smoothing');
  // Each full unit adds one stable pass; never extrapolate a point beyond its neighbors.
  if (amount > 1) {
    let result=points;
    for(let pass=0;pass<Math.ceil(amount);pass++)result=smoothBrushSamples(result,Math.min(1,amount-pass));
    return result;
  }
  const samePosition = (a: Point | undefined, b: Point) => a?.x === b.x && a?.y === b.y;
  // Coincident samples encode a stationary pressure/tilt/twist change. Keep the
  // whole run in place instead of turning that change into a short moving stroke.
  return points.map((p, i) => {
    if (
      i === 0 ||
      i === points.length - 1 ||
      samePosition(points[i - 1], p) ||
      samePosition(points[i + 1], p)
    )
      return { ...p };
    const a = points[i - 1],
      b = points[i + 1];
    const incoming = Math.hypot(p.x - a.x, p.y - a.y),
      outgoing = Math.hypot(b.x - p.x, b.y - p.y),
      t = incoming / (incoming + outgoing);
    // Arc-length weighting leaves unevenly sampled straight sections in place.
    // Work relative to p to avoid cancellation at large translated coordinates.
    return {
      ...p,
      x: p.x + (((a.x - p.x) * (1 - t) + (b.x - p.x) * t) * amount) / 2,
      y: p.y + (((a.y - p.y) * (1 - t) + (b.y - p.y) * t) * amount) / 2,
    };
  });
}

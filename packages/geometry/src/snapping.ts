import type { Point } from '@splash/document';

/** Snap an axis by its nearest anchor/target pair; tolerance is in document units. */
export function snapAxis(
  anchors: number[],
  targets: number[],
  tolerance: number,
  grid = 0,
): { delta: number; target?: number } {
  let delta = 0,
    distance = tolerance + 1,
    target: number | undefined;
  for (const anchor of anchors) {
    const candidates = grid > 0 ? [...targets, Math.round(anchor / grid) * grid] : targets;
    for (const candidate of candidates) {
      const difference = candidate - anchor;
      if (Math.abs(difference) <= tolerance && Math.abs(difference) < distance) {
        delta = difference;
        distance = Math.abs(difference);
        target = candidate;
      }
    }
  }
  return { delta, target };
}

/** Visible grid coordinates only. Thin dense grids to at least four screen pixels
 * and at most 1024 lines per axis; snapping still uses the original spacing. */
export function gridLines(min: number, max: number, spacing: number, zoom: number): number[] {
  if (![min, max, spacing, zoom].every(Number.isFinite) || max < min || spacing <= 0 || zoom <= 0)
    return [];
  const stride = Math.max(
      1,
      Math.ceil(4 / (spacing * zoom)),
      Math.ceil((max - min) / (spacing * 1023)),
    ),
    step = spacing * stride;
  const first = Math.ceil(min / step),
    last = Math.floor(max / step),
    result: number[] = [];
  for (let i = first; i <= last && result.length < 1024; i++) result.push(i * step);
  return result;
}

/** Constrain a radian angle to a degree increment, retaining full revolutions. */
export function snapAngle(angle: number, degrees: number): number {
  if (!Number.isFinite(angle) || !Number.isFinite(degrees) || degrees <= 0 || degrees > 180)
    return angle;
  const step = (degrees * Math.PI) / 180;
  return Math.round(angle / step) * step;
}

/** Constrain a stage-space ray while keeping the pointer's distance from its anchor. */
export function snapRay(anchor: Point, pointer: Point, degrees: number) {
  const dx = pointer.x - anchor.x, dy = pointer.y - anchor.y;
  const radius = Math.hypot(dx, dy);
  if (!(radius > 0 && Number.isFinite(radius)) || !(degrees > 0 && degrees <= 180)) return;
  const angle = snapAngle(Math.atan2(dy, dx), degrees);
  const point = { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius };
  if (Number.isFinite(point.x) && Number.isFinite(point.y)) return { point, angle };
}

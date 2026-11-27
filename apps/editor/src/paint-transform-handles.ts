import type { Point, Vector } from '../../../packages/document/src';
import { worldPoint } from '../../../packages/geometry/src';
import { bitmapHandle } from '../../../packages/geometry/src/bitmap';
import { gradientAxis, gradientPoint, gradientStopPoint } from '../../../packages/geometry/src/gradient';

const bitmapParts = ['origin', 'x', 'y'] as const;
const gradientParts = ['from', 'to', 'axis'] as const;
const stopOffset = 14;
type Projection = (point: Point) => Point;
type PaintHit =
  | { kind: 'bitmap'; part: (typeof bitmapParts)[number] }
  | { kind: 'gradient'; part: (typeof gradientParts)[number] }
  | { kind: 'gradient'; part: 'stop'; index: number };

function projectHandles(shape: Vector, project: Projection) {
  const point = (local: Point) => project(worldPoint(shape, local));
  const { bitmap, gradient } = shape;
  return {
    point,
    bitmap: bitmap && bitmapParts.map(part => ({ part, at: point(bitmapHandle(bitmap, part)) })),
    gradient: gradient && {
      from: point(gradientPoint(gradient, gradient.from)),
      to: point(gradientPoint(gradient, gradient.to)),
      axis: point(gradientAxis(gradient)),
      stops: gradient.stops.map((stop, index) => {
        const at = point(gradientStopPoint(gradient, index));
        return { color: stop.color, x: at.x, y: at.y + stopOffset };
      }),
    },
  };
}

export function hitPaintTransformHandle(shape: Vector, project: Projection, cursor: Point): PaintHit | undefined {
  const handles = projectHandles(shape, project);
  const near = (p: Point, radius: number) => Math.hypot(p.x - cursor.x, p.y - cursor.y) < radius;
  for (const handle of handles.bitmap ?? []) {
    if (near(handle.at, 10)) return { kind: 'bitmap', part: handle.part };
  }
  if (!handles.gradient) return;
  const { stops } = handles.gradient;
  for (let index = stops.length - 1; index >= 0; index--) {
    if (near(stops[index], 6)) return { kind: 'gradient', part: 'stop', index };
  }
  for (const part of gradientParts) {
    if (near(handles.gradient[part], 10)) return { kind: 'gradient', part };
  }
}

/** Paint in CSS coordinates so skew and reflection affect the guides but never the handles. */
export function drawPaintTransformHandles(ctx: CanvasRenderingContext2D, shape: Vector, project: Projection) {
  const handles = projectHandles(shape, project);
  const square = (p: Point, radius: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(p.x - radius, p.y - radius, 2 * radius, 2 * radius);
    ctx.strokeRect(p.x - radius, p.y - radius, 2 * radius, 2 * radius);
  };
  const line = (a: Point, b: Point) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  ctx.strokeStyle = '#7251b5';
  ctx.lineWidth = 1;
  if (handles.bitmap) {
    const [a, b, c] = handles.bitmap.map(({ at }) => at);
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x + c.x - a.x, b.y + c.y - a.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [i, p] of [a, b, c].entries()) {
      square(p, 5, i ? '#e5d9ff' : '#ffffff');
      ctx.fillStyle = '#171b27';
      ctx.font = '11px sans-serif';
      ctx.fillText(['O', 'X', 'Y'][i], p.x + 8, p.y - 8);
    }
  }
  if (!handles.gradient || !shape.gradient) return;
  const { from, to, axis, stops } = handles.gradient, gradient = shape.gradient;
  ctx.strokeStyle = '#171b27';
  ctx.lineWidth = 2;
  line(from, to);
  if (gradient.kind === 'radial') {
    const radius = Math.hypot(gradient.to.x - gradient.from.x, gradient.to.y - gradient.from.y);
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const theta = (i * Math.PI) / 32;
      const p = handles.point(gradientPoint(gradient, {
        x: gradient.from.x + radius * Math.cos(theta),
        y: gradient.from.y + radius * Math.sin(theta),
      }));
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    }
    ctx.strokeStyle = '#7251b5';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = '#7251b5';
  line(from, axis);
  ctx.beginPath();
  ctx.moveTo(axis.x, axis.y - 6);
  ctx.lineTo(axis.x + 6, axis.y);
  ctx.lineTo(axis.x, axis.y + 6);
  ctx.lineTo(axis.x - 6, axis.y);
  ctx.closePath();
  ctx.fillStyle = '#e5d9ff';
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#171b27';
  ctx.lineWidth = 1;
  for (const stop of stops) {
    ctx.beginPath();
    ctx.arc(stop.x, stop.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = stop.color;
    ctx.fill();
    ctx.stroke();
  }
  square(from, 4, '#fff');
  square(to, 4, '#fff');
}

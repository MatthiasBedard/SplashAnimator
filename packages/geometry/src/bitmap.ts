import type { Vector } from '@splash/document';
export type BitmapPaint = NonNullable<Vector['bitmap']>;
export function checkedBitmap(paint: BitmapPaint): BitmapPaint {
  const [a, b, c, d] = paint.transform ?? [1, 0, 0, 1];
  if (
    [paint.x, paint.y, paint.width, paint.height].some(
      (n) => !Number.isFinite(n) || Math.abs(n) > 100000,
    ) ||
    paint.width <= 0 ||
    paint.height <= 0 ||
    [a, b, c, d].some((n) => !Number.isFinite(n) || Math.abs(n) > 100) ||
    Math.abs(a * d - b * c) < 1e-6
  )
    throw new Error('Bitmap paint transform exceeds coordinate or invertibility limits.');
  return paint;
}
/** Keep the complete paint map consistent with a nonuniform geometry resize. */
export function resizeBitmap(paint: BitmapPaint, sx: number, sy: number): BitmapPaint {
  if (![sx, sy].every(Number.isFinite) || sx <= 0 || sy <= 0)
    throw new Error('Bitmap resize requires positive dimensions.');
  const [a, b, c, d] = paint.transform ?? [1, 0, 0, 1];
  return checkedBitmap({
    ...paint,
    x: paint.x * sx,
    y: paint.y * sy,
    width: paint.width * sx,
    height: paint.height * sy,
    ...(paint.transform
      ? { transform: [a, (b * sy) / sx, (c * sx) / sy, d] as [number, number, number, number] }
      : {}),
  });
}
/** Compose paint-only rotation/skew/scale about its local origin, then translate it. */
export function transformBitmap(
  paint: BitmapPaint,
  options: {
    dx: number;
    dy: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    skewX: number;
    skewY: number;
  },
): BitmapPaint {
  if (
    !Object.values(options).every(Number.isFinite) ||
    Math.abs(options.skewX) > 80 ||
    Math.abs(options.skewY) > 80
  )
    throw new Error('Use finite bitmap transforms and skew between -80 and 80 degrees.');
  const angle = ((options.rotation % 360) * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const tx = Math.tan((options.skewX * Math.PI) / 180),
    ty = Math.tan((options.skewY * Math.PI) / 180);
  const a = (cos - sin * ty) * options.scaleX,
    b = (sin + cos * ty) * options.scaleX;
  const c = (cos * tx - sin) * options.scaleY,
    d = (sin * tx + cos) * options.scaleY;
  const [u, v, w, z] = paint.transform ?? [1, 0, 0, 1];
  return checkedBitmap({
    ...paint,
    x: paint.x + options.dx,
    y: paint.y + options.dy,
    transform: [a * u + c * v, b * u + d * v, a * w + c * z, b * w + d * z],
  });
}

export type BitmapHandle = 'origin' | 'x' | 'y';
export function bitmapHandle(paint: BitmapPaint, part: BitmapHandle) {
  const [a, b, c, d] = paint.transform ?? [1, 0, 0, 1];
  return {
    x: paint.x + (part === 'x' ? a * paint.width : part === 'y' ? c * paint.height : 0),
    y: paint.y + (part === 'x' ? b * paint.width : part === 'y' ? d * paint.height : 0),
  };
}
export function moveBitmapHandle(
  paint: BitmapPaint,
  part: BitmapHandle,
  target: { x: number; y: number },
): BitmapPaint {
  if (part === 'origin') return checkedBitmap({ ...paint, x: target.x, y: target.y });
  const transform: [number, number, number, number] = [...(paint.transform ?? [1, 0, 0, 1])];
  const index = part === 'x' ? 0 : 2,
    size = part === 'x' ? paint.width : paint.height;
  transform[index] = (target.x - paint.x) / size;
  transform[index + 1] = (target.y - paint.y) / size;
  return checkedBitmap({ ...paint, transform });
}

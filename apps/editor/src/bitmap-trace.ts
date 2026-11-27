import { MAX_VECTOR_POINTS, type BitmapAsset, type Vector } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import { bitmapDimensions } from './bitmap';
import { BITMAP_TRACE_DETAILS, type BitmapTraceDetail } from '../../../packages/geometry/src/bitmap-trace';
import { traceBitmapInWorker } from './geometry-worker';

export function isFullBitmapPlacement(shape: Vector) {
  const mapping = shape.bitmap;
  if (!mapping || shape.cornerRadius || shape.strokeWidth || shape.fillEnabled === false ||
      mapping.repeat || mapping.transform || mapping.x || mapping.y ||
      shape.width !== mapping.width || shape.height !== mapping.height) return false;
  if (shape.kind === 'rectangle' && !shape.contours) return true;
  // Merge Drawing represents an intact placed bitmap with a four-corner contour.
  if (shape.kind !== 'polygon' || shape.contours?.length !== 1) return false;
  const ring = shape.contours[0];
  return ring.length === 4 && new Set(ring.map(p => `${p.x},${p.y}`)).size === 4 &&
    ring.every((p, index) => {
      const next = ring[(index + 1) % ring.length];
      return !p.in && !p.out && (p.x === 0 || p.x === mapping.width) &&
        (p.y === 0 || p.y === mapping.height) && (p.x === next.x) !== (p.y === next.y);
    });
}

export async function prepareBitmapTrace(bitmap: BitmapAsset, detail: BitmapTraceDetail, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!BITMAP_TRACE_DETAILS.includes(detail) || !bitmap.dataUrl?.startsWith('data:image/png;base64,') ||
      bitmap.dataUrl.length > 2800000)
    throw Error('Invalid bitmap or trace detail.');
  const bytes = Uint8Array.from(atob(bitmap.dataUrl.slice(22)), character => character.charCodeAt(0));
  const size = bitmapDimensions(bytes);
  if (size.width !== bitmap.width || size.height !== bitmap.height)
    throw Error('The bitmap dimensions changed before tracing.');
  const scale = Math.min(1, detail / Math.max(size.width, size.height));
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    resizeWidth: width, resizeHeight: height, resizeQuality: 'high',
  });
  let rgba: Uint8ClampedArray;
  try {
    signal.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Bitmap trace canvas is unavailable.');
    ctx.drawImage(image, 0, 0);
    rgba = ctx.getImageData(0, 0, width, height).data;
  } finally {
    image.close();
  }
  const paint = await traceBitmapInWorker({ width, height, rgba }, signal);
  signal.throwIfAborted();
  validateLiveGraphicData(paint);
  if (!Array.isArray(paint) || !paint.length || paint.length > 2048)
    throw Error('Invalid bitmap trace output.');
  let points = 0;
  for (const entry of paint) {
    if (!entry || typeof entry.fill !== 'string' || !/^#[a-f0-9]{6}$/.test(entry.fill) ||
        !(entry.opacity > 0 && entry.opacity <= 1) || !Array.isArray(entry.contours) ||
        !entry.contours.length || entry.contours.length > 10000)
      throw Error('Invalid bitmap trace paint.');
    for (const ring of entry.contours) {
      if (!Array.isArray(ring) || ring.length < 4 || (points += ring.length) > MAX_VECTOR_POINTS ||
          ring.some(point => !point || !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y) ||
            point.x < 0 || point.y < 0 || point.x > width || point.y > height))
        throw Error('Invalid bitmap trace boundary.');
    }
  }
  return { width, height, paint };
}

export type BitmapTrace = Awaited<ReturnType<typeof prepareBitmapTrace>>;

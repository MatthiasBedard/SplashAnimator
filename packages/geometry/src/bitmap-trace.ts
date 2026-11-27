import { MAX_VECTOR_POINTS, type Point } from '@splash/document';

export const BITMAP_TRACE_DETAILS = [128, 256, 512] as const;
export type BitmapTraceDetail = (typeof BITMAP_TRACE_DETAILS)[number];
export type BitmapTraceRaster = { width: number; height: number; rgba: Uint8ClampedArray };
export type BitmapTracePaint = { fill: string; opacity: number; contours: Point[][] };

const stepX = [1, 0, -1, 0], stepY = [0, 1, 0, -1];
// Cell offsets from the starting vertex of each clockwise edge.
const cellX = [0, -1, -1, 0], cellY = [0, 0, -1, -1];
const edgeBits = [1, 2, 4, 8];
const turns = [1, 0, 3, 2];

/** Trace quantized color boundaries on the sampled pixel grid. Keep only turns;
 * an even-odd compound per color retains both transparent holes and islands. */
export function traceBitmapRaster({ width, height, rgba }: BitmapTraceRaster): BitmapTracePaint[] {
  const limit = BITMAP_TRACE_DETAILS[2];
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width > limit || height > limit ||
      !(rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4)
    throw Error('Invalid bitmap trace raster.');

  const size = width * height, labels = new Uint16Array(size);
  const palette = new Map<number, { totals: number[]; count: number; contours: Point[][] }>();
  for (let i = 0; i < size; i++) {
    const offset = i * 4, alpha = rgba[offset + 3];
    if (!alpha) continue;
    const label = 1 + ((rgba[offset] >> 5) << 8 | (rgba[offset + 1] >> 5) << 5 |
      (rgba[offset + 2] >> 5) << 2 | alpha >> 6);
    labels[i] = label;
    let paint = palette.get(label);
    if (!paint) {
      paint = { totals: [0, 0, 0, 0], count: 0, contours: [] };
      palette.set(label, paint);
    }
    paint.count++;
    for (let channel = 0; channel < 4; channel++) paint.totals[channel] += rgba[offset + channel];
  }
  if (!palette.size) throw Error('This bitmap has no visible paint to trace.');

  const edges = new Uint8Array(size), visited = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const label = labels[i], x = i % width;
    if (!label) continue;
    if (labels[i - width] !== label) edges[i] |= 1;
    if (x === width - 1 || labels[i + 1] !== label) edges[i] |= 2;
    if (labels[i + width] !== label) edges[i] |= 4;
    if (x === 0 || labels[i - 1] !== label) edges[i] |= 8;
  }

  let points = 0;
  for (let start = 0; start < size; start++) for (let direction = 0; direction < 4; direction++) {
    const bit = edgeBits[direction];
    if (!(edges[start] & bit) || visited[start] & bit) continue;
    const label = labels[start], ring: Point[] = [];
    let cell = start, edge = direction;
    let x = start % width - cellX[edge], y = Math.floor(start / width) - cellY[edge];
    do {
      if (visited[cell] & edgeBits[edge]) throw Error('Bitmap boundary could not be traced.');
      visited[cell] |= edgeBits[edge];
      x += stepX[edge];
      y += stepY[edge];
      // At a diagonal contact keep the current painted side on the right.
      const next = turns.find(turn => {
        const d = (edge + turn) % 4, nx = x + cellX[d], ny = y + cellY[d], i = ny * width + nx;
        return nx >= 0 && nx < width && ny >= 0 && ny < height &&
          labels[i] === label && (edges[i] & edgeBits[d]);
      });
      if (next === undefined) throw Error('Bitmap boundary could not be traced.');
      if (next !== 0) {
        if (++points > MAX_VECTOR_POINTS) throw Error('The trace is too complex. Choose lower detail.');
        ring.push({ x, y });
      }
      edge = (edge + next) % 4;
      cell = (y + cellY[edge]) * width + x + cellX[edge];
    } while (cell !== start || edge !== direction);
    const contours = palette.get(label)!.contours;
    if (contours.length >= 10000) throw Error('The trace has too many contours. Choose lower detail.');
    contours.push(ring);
  }
  return [...palette.values()].map(({ totals, count, contours }) => ({
    fill: '#' + totals.slice(0, 3).map(channel => Math.round(channel / count).toString(16).padStart(2, '0')).join(''),
    opacity: totals[3] / count / 255,
    contours,
  }));
}

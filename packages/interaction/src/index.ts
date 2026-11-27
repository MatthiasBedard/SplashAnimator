import { MAX_VECTOR_POINTS, type Point } from '@splash/document';
export type Tool =
  | 'select'
  | 'subselect'
  | 'lasso'
  | 'pen'
  | 'text'
  | 'line'
  | 'rectangle'
  | 'rounded'
  | 'ellipse'
  | 'star'
  | 'path'
  | 'brush'
  | 'bucket'
  | 'ink'
  | 'eyedropper'
  | 'eraser'
  | 'gradient'
  | 'hand'
  | 'zoom';
export const tools: { id: Tool; label: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Selection', icon: '↖', key: 'V' },
  { id: 'subselect', label: 'Subselection', icon: '⇱', key: 'A' },
  { id: 'lasso', label: 'Lasso', icon: '◌', key: 'L' },
  { id: 'pen', label: 'Pen', icon: '✒', key: 'P' },
  { id: 'text', label: 'Text', icon: 'T', key: 'T' },
  { id: 'line', label: 'Line', icon: '╱', key: 'N' },
  { id: 'rectangle', label: 'Rectangle', icon: '□', key: 'R' },
  { id: 'rounded', label: 'Rounded rectangle', icon: '▢', key: '' },
  { id: 'ellipse', label: 'Oval', icon: '○', key: 'O' },
  { id: 'star', label: 'Polystar', icon: '☆', key: '' },
  { id: 'path', label: 'Pencil', icon: '✎', key: 'Y' },
  { id: 'brush', label: 'Brush', icon: '▰', key: 'B' },
  { id: 'bucket', label: 'Paint bucket', icon: '◩', key: 'K' },
  { id: 'ink', label: 'Ink bottle', icon: '▤', key: 'S' },
  { id: 'eyedropper', label: 'Eyedropper', icon: '⌁', key: 'I' },
  { id: 'eraser', label: 'Eraser', icon: '▱', key: 'E' },
  { id: 'hand', label: 'Hand', icon: '✥', key: 'H' },
  { id: 'zoom', label: 'Zoom', icon: '⌕', key: 'Z' },
  { id: 'gradient', label: 'Gradient transform', icon: '◈', key: 'F' },
];
export type PointerSample = Pick<
  PointerEvent,
  'pointerType' | 'pressure' | 'tiltX' | 'tiltY' | 'twist' | 'type'
>;
/** Mouse contact is full width. Pen release retains the last contact nib state;
 * release-time pressure/orientation defaults must not add a different final dab. */
export function samplePointer(e: PointerSample, position: Point, previous?: Point): Point {
  const pen = e.pointerType === 'pen';
  const contact = pen && e.type === 'pointerup' && previous ? previous : e;
  return {
    ...position,
    pressure: pen
      ? e.type === 'pointerup'
        ? (previous?.pressure ?? 0.5)
        : Math.max(0, Math.min(1, e.pressure))
      : 1,
    tiltX: pen ? Math.max(-90, Math.min(90, contact.tiltX || 0)) : 0,
    tiltY: pen ? Math.max(-90, Math.min(90, contact.tiltY || 0)) : 0,
    twist: pen ? Math.max(0, Math.min(359, contact.twist || 0)) : 0,
  };
}
/** Gesture-only storage: avoid a reactive signal/proxy for every captured Brush
 * point. Editors invalidate presentation once per delivered sample batch instead.
 * JSON/structured cloning produces ordinary arrays for worker/document ownership;
 * derived array operations also return ordinary arrays, never live capture state.
 */
export class BrushSamples extends Array<Point> {
  static get [Symbol.species]() {
    return Array;
  }
}

/** Endpoint samples bypass movement filtering. Capture shares the document
 * point capacity rather than imposing a lower freehand cutoff. False means a
 * distinct sample would exceed that capacity; never commit a truncated gesture. */
export function appendSample(points: Point[], sample: Point, endpoint = false): boolean {
  const last = points.at(-1);
  if (
    last &&
    (endpoint
      ? last.x === sample.x && last.y === sample.y
      : Math.hypot(last.x - sample.x, last.y - sample.y) < 0.2) &&
    Math.abs((last.pressure ?? 1) - (sample.pressure ?? 1)) < 0.01 &&
    last.tiltX === sample.tiltX &&
    last.tiltY === sample.tiltY &&
    last.twist === sample.twist
  )
    return true;
  if (points.length >= MAX_VECTOR_POINTS) return false;
  points.push(sample);
  return true;
}

/** Spatial trailing stabilizer; pen metadata always belongs to the current sample. */
export function stabilizeSample(
  previous: Point | undefined,
  sample: Point,
  distance: number,
): Point {
  if (!Number.isFinite(distance) || distance < 0 || distance > 100)
    throw new Error('Invalid stabilization distance');
  if (!previous || !distance) return { ...sample };
  const dx = sample.x - previous.x,
    dy = sample.y - previous.y,
    length = Math.hypot(dx, dy),
    t = length > distance ? (length - distance) / length : 0;
  return { ...sample, x: previous.x + dx * t, y: previous.y + dy * t };
}

/** Keep a viewport point fixed when changing zoom in a centered document view. */
export function zoomPan(
  pan: Point,
  anchor: Point,
  view: { width: number; height: number },
  previous: number,
  next: number,
): Point {
  if (
    ![pan.x, pan.y, anchor.x, anchor.y, view.width, view.height, previous, next].every(
      Number.isFinite,
    ) ||
    previous <= 0 ||
    next <= 0
  )
    throw new Error('Invalid viewport zoom');
  const x = anchor.x - view.width / 2,
    y = anchor.y - view.height / 2,
    ratio = next / previous;
  return { x: x - (x - pan.x) * ratio, y: y - (y - pan.y) * ratio };
}

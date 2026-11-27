import type { Point, Vector } from '../../../packages/document/src';
import {
  matrix,
  mapPoint,
  inversePoint,
  multiply,
  around,
  objectBounds,
  localAuthoringBounds,
  type Matrix,
  type Bounds,
} from '../../../packages/geometry/src';
import { snapAngle } from '../../../packages/geometry/src/snapping';

export type TransformMode = 'free' | 'rotate-skew';
export type TransformHit = { kind: 'scale' | 'rotate' | 'skew' | 'pivot'; handle: string };
export type TransformFrame = { basis: Matrix; box: Bounds };
export type TransformView = { x: number; y: number };
const names = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export function framePoint(frame: TransformFrame, name: string): Point {
  const b = frame.box;
  return mapPoint(frame.basis, {
    x: name.includes('w') ? b.left : name.includes('e') ? b.right : (b.left + b.right) / 2,
    y: name.includes('n') ? b.top : name.includes('s') ? b.bottom : (b.top + b.bottom) / 2,
  });
}
/** An affine authoring cage in the first original member's basis. Applying the
 * same world transform to every member therefore transforms the cage as well. */
export function selectionTransformFrame(members: readonly Vector[]): TransformFrame | null {
  if (!members.length) return null;
  const basis = matrix(members[0]),
    det = basis[0] * basis[3] - basis[1] * basis[2];
  if (!basis.every(Number.isFinite) || !Number.isFinite(det) || Math.abs(det) < 1e-10) return null;
  const inv: Matrix = [basis[3] / det, -basis[1] / det, -basis[2] / det, basis[0] / det, 0, 0];
  inv[4] = -inv[0] * basis[4] - inv[2] * basis[5];
  inv[5] = -inv[1] * basis[4] - inv[3] * basis[5];
  const boxes = members.map((s, index) => {
    if (index === 0 && s.controlBounds === true) return localAuthoringBounds(s);
    const m = multiply(inv, matrix(s));
    return objectBounds({
      ...s,
      x: m[4],
      y: m[5],
      rotation: 0,
      transform: [m[0], m[1], m[2], m[3]],
    });
  });
  const box = {
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
  return Object.values(box).every(Number.isFinite) ? { basis, box } : null;
}
export function transformHandles(
  frame: TransformFrame,
  pivot: Point,
  view: TransformView,
  mode: TransformMode,
) {
  const handles: { name: string; x: number; y: number }[] = names.map((name) => ({
    name,
    ...framePoint(frame, name),
  }));
  if (mode === 'free') {
    const center = framePoint(frame, ''),
      n = framePoint(frame, 'n'),
      dx = (n.x - center.x) * view.x,
      dy = (n.y - center.y) * view.y,
      length = Math.hypot(dx, dy);
    handles.push({
      name: 'rotate',
      x: n.x + (length ? (24 * dx) / length / view.x : 0),
      y: n.y + (length ? (24 * dy) / length / view.y : -24 / view.y),
    });
  }
  return [...handles, { name: 'pivot', ...pivot }];
}
function viewValid(view: TransformView) {
  if (![view.x, view.y].every((n) => Number.isFinite(n) && n > 0))
    throw Error('Invalid selection transform view.');
}
export function hitSelectionTransform(
  frame: TransformFrame,
  pivot: Point,
  point: Point,
  view: TransformView,
  mode: TransformMode,
): TransformHit | null {
  viewValid(view);
  if (![point.x, point.y].every(Number.isFinite)) return null;
  const distance = (p: Point) => Math.hypot((p.x - point.x) * view.x, (p.y - point.y) * view.y);
  if (distance(pivot) <= 7) return { kind: 'pivot', handle: 'pivot' };
  const handles = transformHandles(frame, pivot, view, mode)
    .filter((h) => h.name !== 'pivot')
    .sort((a, b) => distance(a) - distance(b));
  const handle = handles.find((h) => distance(h) <= 6);
  if (handle)
    return {
      kind:
        handle.name === 'rotate' || (mode === 'rotate-skew' && handle.name.length === 2)
          ? 'rotate'
          : mode === 'rotate-skew'
            ? 'skew'
            : 'scale',
      handle: handle.name,
    };
  const q = inversePoint(frame.basis, point),
    b = frame.box,
    outside = q.x < b.left || q.x > b.right || q.y < b.top || q.y > b.bottom;
  if (mode === 'free' && outside) {
    const corner = handles.find((h) => h.name.length === 2 && distance(h) <= 19);
    if (corner) return { kind: 'rotate', handle: corner.name };
  }
  for (const [name, a, z] of [
    ['n', 'nw', 'ne'],
    ['e', 'ne', 'se'],
    ['s', 'sw', 'se'],
    ['w', 'nw', 'sw'],
  ]) {
    const from = framePoint(frame, a),
      to = framePoint(frame, z),
      dx = (to.x - from.x) * view.x,
      dy = (to.y - from.y) * view.y,
      l = dx * dx + dy * dy;
    const t = l ? ((point.x - from.x) * view.x * dx + (point.y - from.y) * view.y * dy) / l : -1;
    if (
      t > 0 &&
      t < 1 &&
      distance({ x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) }) <= 4
    )
      return { kind: 'skew', handle: name };
  }
  return null;
}
const icon = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none" stroke="white" stroke-width="4">${body}</g><g fill="none" stroke="#20232a" stroke-width="2">${body}</g></svg>`)}") 12 12, crosshair`;
const rotateCursor = icon('<path d="M6 16a7 7 0 1 1 12-7M14 9h5V4"/>');
const skewXCursor = icon('<path d="M6 7h13l-4 10H2ZM5 21h14m-11-3-3 3 3 3m8-6 3 3-3 3"/>');
const skewYCursor = icon('<path d="m7 6 10-4v13L7 19ZM21 5v14m-3-11 3-3 3 3m-6 8 3 3 3-3"/>');
export function selectionTransformCursor(
  hit: TransformHit | null,
  frame: TransformFrame | null,
  view: TransformView,
): string {
  if (!hit || !frame) return '';
  if (hit.kind === 'pivot') return 'move';
  if (hit.kind === 'rotate') return rotateCursor;
  if (hit.kind === 'skew') return ['n', 's'].includes(hit.handle) ? skewXCursor : skewYCursor;
  const p = framePoint(frame, hit.handle),
    c = framePoint(frame, ''),
    angle = Math.atan2((p.y - c.y) * view.y, (p.x - c.x) * view.x),
    sector = (Math.round(angle / (Math.PI / 4)) + 8) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][sector];
}
/** Every movement uses the original frame and pickup, retaining pointer offsets. */
export function selectionTransformOperation(
  frame: TransformFrame,
  hit: TransformHit,
  pivot: Point,
  start: Point,
  end: Point,
  shift = false,
  alt = false,
  angleIncrement = 0,
): { operation: Matrix; pivot: Point; degrees?: number } {
  if (![start.x, start.y, end.x, end.y, pivot.x, pivot.y].every(Number.isFinite))
    throw Error('Invalid selection transform pointer.');
  if (hit.kind === 'pivot') throw Error('Pivot movement edits metadata separately.');
  const b = frame.box,
    h = hit.handle;
  if (hit.kind === 'rotate') {
    const center =
      alt && h.length === 2
        ? framePoint(
            frame,
            ({ nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' } as Record<string, string>)[h],
          )
        : pivot;
    let angle =
      Math.atan2(end.y - center.y, end.x - center.x) -
      Math.atan2(start.y - center.y, start.x - center.x);
    if (shift) angle = snapAngle(angle, angleIncrement || 45);
    return {
      operation: around(
        center,
        Math.cos(angle),
        Math.sin(angle),
        -Math.sin(angle),
        Math.cos(angle),
      ),
      pivot: center,
      degrees: (angle * 180) / Math.PI,
    };
  }
  const a = inversePoint(frame.basis, start),
    z = inversePoint(frame.basis, end),
    delta = { x: z.x - a.x, y: z.y - a.y };
  const anchor = alt
    ? inversePoint(frame.basis, pivot)
    : {
        x: h.includes('w') ? b.right : h.includes('e') ? b.left : (b.left + b.right) / 2,
        y: h.includes('n') ? b.bottom : h.includes('s') ? b.top : (b.top + b.bottom) / 2,
      };
  const local = inversePoint(frame.basis, framePoint(frame, h));
  let op: Matrix;
  let degrees: number | undefined;
  if (hit.kind === 'skew') {
    const horizontal = h === 'n' || h === 's',
      distance = horizontal ? local.y - anchor.y : local.x - anchor.x;
    if (distance === 0) throw Error('Move the transformation point away from the dragged edge.');
    let shear = (horizontal ? delta.x : delta.y) / distance;
    if (shift) {
      const angle = snapAngle(Math.atan(shear), angleIncrement || 15);
      if (Math.abs(Math.cos(angle)) < 1e-8) throw Error('Skew cannot reach 90 degrees.');
      shear = Math.tan(angle);
      degrees = angle * 180 / Math.PI;
    }
    op = horizontal
      ? around(anchor, 1, 0, shear, 1)
      : around(anchor, 1, shear, 0, 1);
  } else {
    let x =
        h.includes('w') || h.includes('e')
          ? (local.x + delta.x - anchor.x) / (local.x - anchor.x)
          : 1,
      y =
        h.includes('n') || h.includes('s')
          ? (local.y + delta.y - anchor.y) / (local.y - anchor.y)
          : 1;
    if (shift && h.length === 2) {
      const size = Math.max(Math.abs(x), Math.abs(y));
      x = Math.sign(x || 1) * size;
      y = Math.sign(y || 1) * size;
    }
    x = Math.sign(x || 1) * Math.max(0.0001, Math.abs(x));
    y = Math.sign(y || 1) * Math.max(0.0001, Math.abs(y));
    op = around(anchor, x, 0, 0, y);
  }
  const det = frame.basis[0] * frame.basis[3] - frame.basis[1] * frame.basis[2],
    inv: Matrix = [
      frame.basis[3] / det,
      -frame.basis[1] / det,
      -frame.basis[2] / det,
      frame.basis[0] / det,
      0,
      0,
    ];
  inv[4] = -inv[0] * frame.basis[4] - inv[2] * frame.basis[5];
  inv[5] = -inv[1] * frame.basis[4] - inv[3] * frame.basis[5];
  if (op.every((n, i) => n === [1, 0, 0, 1, 0, 0][i]))
    return { operation: [1, 0, 0, 1, 0, 0], pivot: mapPoint(frame.basis, anchor), degrees };
  const operation = multiply(frame.basis, multiply(op, inv));
  if (!operation.every(Number.isFinite))
    throw Error('Selection transform exceeds finite geometry.');
  return { operation, pivot: mapPoint(frame.basis, anchor), degrees };
}

import type { Point } from '../../document/src';
import { around, type Matrix } from './affine';
import { snapAngle } from './snapping';

type RangeBox = { left: number; right: number; top: number; bottom: number };

export function rangeHandleTransform(
  handle: string, box: RangeBox, pivot: Point, start: Point, end: Point,
  shift: boolean, alt: boolean, angleIncrement = 0,
): Matrix {
  return rangeHandlePose(handle, box, pivot, start, end, shift, alt, angleIncrement).operation;
}

/** Use the resolved angle for both artwork and the stage cue. */
export function rangeHandlePose(
  handle: string,
  box: RangeBox,
  pivot: Point,
  start: Point,
  end: Point,
  shift: boolean,
  alt: boolean,
  angleIncrement = 0,
): { operation: Matrix; degrees?: number } {
  if (angleIncrement !== 0 && !(angleIncrement > 0 && angleIncrement <= 180))
    throw Error('Choose a valid range angle increment.');
  const constrain = (angle: number) => angleIncrement ? snapAngle(angle, angleIncrement)
    : (Math.round(angle / (Math.PI / 12)) * Math.PI) / 12;
  if (handle.startsWith('scale-')) {
    const edge=handle.slice(6);
    if(!['n','e','s','w'].includes(edge))throw new Error('Choose a valid scale edge.');
    if(![box.left,box.right,box.top,box.bottom,pivot.x,pivot.y,start.x,start.y,end.x,end.y].every(Number.isFinite))
      throw new Error('Enter finite edge scaling coordinates.');
    const horizontal=edge==='e' || edge==='w';
    const anchor=alt?pivot:{
      x:edge==='w'?box.right:edge==='e'?box.left:(box.left+box.right)/2,
      y:edge==='n'?box.bottom:edge==='s'?box.top:(box.top+box.bottom)/2
    };
    const distance=horizontal?start.x-anchor.x:start.y-anchor.y;
    if(Math.abs(distance)<1e-8)throw new Error('Choose a pivot away from the scaling handle.');
    let scale=(horizontal?end.x-anchor.x:end.y-anchor.y)/distance;
    if(!Number.isFinite(scale))throw new Error('Edge scaling exceeds finite numerics.');
    // Match the existing corner protection; an edge always keeps its orthogonal axis fixed, even with Shift.
    scale=Math.sign(scale || 1)*Math.max(0.0001,Math.abs(scale));
    const operation=around(anchor,horizontal?scale:1,0,0,horizontal?1:scale);
    if(!operation.every(Number.isFinite))throw new Error('Edge scaling exceeds finite numerics.');
    return { operation };
  }
  if (handle.startsWith('skew-')) {
    const edge = handle.slice(5);
    const horizontal = edge === 'n' || edge === 's';
    const anchor = alt
      ? pivot
      : {
          x: edge === 'w' ? box.right : box.left,
          y: edge === 'n' ? box.bottom : box.top,
        };
    const distance = horizontal ? start.y - anchor.y : start.x - anchor.x;
    if (Math.abs(distance) < 1e-8)
      throw new Error('Choose a pivot away from the skew handle edge.');
    let shear = (horizontal ? end.x - start.x : end.y - start.y) / distance;
    let degrees: number | undefined;
    if (shift) {
      const angle = constrain(Math.atan(shear));
      if (Math.abs(Math.cos(angle)) < 1e-8) throw new Error('Skew cannot reach 90 degrees.');
      shear = Math.tan(angle);
      degrees = angle * 180 / Math.PI;
    }
    return { operation: horizontal ? around(anchor, 1, 0, shear, 1) : around(anchor, 1, shear, 0, 1), degrees };
  }
  if (handle === 'rotate') {
    let angle =
      Math.atan2(end.y - pivot.y, end.x - pivot.x) -
      Math.atan2(start.y - pivot.y, start.x - pivot.x);
    if (shift) angle = constrain(angle);
    return { operation: around(pivot, Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle)),
      degrees: shift ? angle * 180 / Math.PI : undefined };
  }
  const anchor = alt
    ? pivot
    : {
        x: handle.includes('w') ? box.right : box.left,
        y: handle.includes('n') ? box.bottom : box.top,
      };
  const x = start.x - anchor.x,
    y = start.y - anchor.y;
  if (Math.abs(x) < 1e-8 || Math.abs(y) < 1e-8)
    throw new Error('Choose a pivot away from the scaling handle.');
  let sx = (end.x - anchor.x) / x,
    sy = (end.y - anchor.y) / y;
  if (shift) {
    const size = Math.max(Math.abs(sx), Math.abs(sy));
    sx = Math.sign(sx || 1) * size;
    sy = Math.sign(sy || 1) * size;
  }
  sx = Math.sign(sx || 1) * Math.max(0.0001, Math.abs(sx));
  sy = Math.sign(sy || 1) * Math.max(0.0001, Math.abs(sy));
  return { operation: around(anchor, sx, 0, 0, sy) };
}

/** Session-local pivot movement; preserve the initial pointer-to-pivot offset. */
export function rangePivotDrag(pivot: Point, start: Point, end: Point, shift: boolean): Point {
  let dx = end.x - start.x,
    dy = end.y - start.y;
  if (shift) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  const next = { x: pivot.x + dx, y: pivot.y + dy };
  if ([next.x, next.y].some((n) => !Number.isFinite(n) || Math.abs(n) > 100000))
    throw new Error('Pivot exceeds supported geometry limits.');
  return next;
}

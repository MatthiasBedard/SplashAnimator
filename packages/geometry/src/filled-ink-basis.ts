import { clone, id, type BezierNode, type Point, type Vector } from '@splash/document';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import type { Bounds } from './bounds-index';
import { exactCoordinateFromUnits } from './line-contacts';
import { paintCoordinateUnits } from './paint-winding';

/** Artwork prepared for a single placement. The box is for authoring tools.
 * All outlines keep the same coordinate origin, including their shared edges. */
export type InkBasisPiece = { contours: BezierNode[][]; bounds: Bounds };
export type FilledInkInBasis = {
  origin: Point;
  ink: InkBasisPiece[];
  fills: Map<Vector, InkBasisPiece[]>;
  outlines: Map<Vector, InkBasisPiece[]>;
};

const supported = (value: number) => Number.isFinite(value) && Math.abs(value) <= 1e7;

export function inkBasisTranslation(shape: Point, origin: Point, charge: (n: number) => void) {
  const dx = paintCoordinateUnits(shape.x) - paintCoordinateUnits(origin.x);
  const dy = paintCoordinateUnits(shape.y) - paintCoordinateUnits(origin.y);
  return (point: Point): Point => {
    charge(1);
    if (!supported(point.x) || !supported(point.y) ||
        !supported(shape.x + point.x) || !supported(shape.y + point.y))
      throw Error('The original paint control exceeds document limits.');
    // Rebase the stored coordinates before rounding a document-space sum.
    const x = exactCoordinateFromUnits(paintCoordinateUnits(point.x) + dx);
    const y = exactCoordinateFromUnits(paintCoordinateUnits(point.y) + dy);
    if (x === undefined || y === undefined || !supported(x) || !supported(y))
      throw Error('The original outline cannot use this common coordinate origin.');
    return { x, y };
  };
}

export function filledInkBasisSources(sources: Vector[], cutter: Vector, origin: Point,
  charge: (n: number) => void, closedPaint = false): { cutter: Vector; sources: Vector[] } | undefined {
  validateLiveGraphicData([sources, cutter, origin]);
  const plain = (shape: Vector) => supported(shape.x) && supported(shape.y) &&
    !shape.transform && !shape.rotation && !shape.groups?.length &&
    !shape.bitmap && !shape.gradient && !shape.brush && !shape.tint &&
    !shape.blendMode && !shape.blurRadius && !shape.groupBlur && shape.drawingMode !== 'object';
  const straightInk = (shape: Vector) => shape.kind === 'path' && !shape.closed && !shape.nodes &&
    !shape.contours && shape.points.length === 2 && shape.fillEnabled === false &&
    supported(shape.strokeWidth) && shape.strokeWidth > 0;
  const fill = (shape: Vector) => shape.kind === 'polygon' && shape.closed && shape.fillRule === 'evenodd' &&
    shape.contours?.length && shape.fillEnabled !== false && !shape.strokeWidth;
  if (!supported(origin.x) || !supported(origin.y) || !sources.length ||
      !plain(cutter) || !(closedPaint ? fill(cutter) : straightInk(cutter)) ||
      !sources.every(shape => plain(shape) && (fill(shape) || straightInk(shape)))) return;
  const rebase = (shape: Vector) => {
    const place = inkBasisTranslation(shape, origin, charge);
    if (!shape.contours) return { ...shape, x: 0, y: 0, points: shape.points.map(place) };
    return { ...shape, x: 0, y: 0, contours: shape.contours.map(ring => ring.map(node => ({
      ...place(node),
      ...(node.in && { in: place(node.in) }),
      ...(node.out && { out: place(node.out) }),
    }))) };
  };
  return { cutter: rebase(cutter), sources: sources.map(rebase) };
}

export function inkBasisPiece(contours: BezierNode[][], origin: Point, charge: (n: number) => void): InkBasisPiece {
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  const add = (point: Point) => {
    charge(1);
    if (!supported(point.x + origin.x) || !supported(point.y + origin.y))
      throw Error('The placed paint control exceeds document limits.');
    bounds.left = Math.min(bounds.left, point.x);
    bounds.right = Math.max(bounds.right, point.x);
    bounds.top = Math.min(bounds.top, point.y);
    bounds.bottom = Math.max(bounds.bottom, point.y);
  };
  for (const ring of contours) for (const node of ring) {
    add(node);
    if (node.in) add(node.in);
    if (node.out) add(node.out);
  }
  if (!Number.isFinite(bounds.left) || !supported(bounds.right - bounds.left) ||
      !supported(bounds.bottom - bounds.top)) throw Error('The paint outline exceeds document limits.');
  return { contours, bounds };
}

type PlacedPiece = { vector: Vector; bounds: InkBasisPiece['bounds'] };

export function prepareInkBasisWriter(owner: Vector, basis: Point, ink: boolean) {
  const pivot = owner.pivot && inkBasisTranslation(owner, basis, () => {})(owner.pivot);
  const style = clone({ ...owner, points: [], nodes: undefined, contours: undefined,
    pivot: undefined, cornerRadius: undefined, transform: undefined, fillRule: undefined });
  return ({ contours, bounds }: InkBasisPiece, faceId: string): PlacedPiece => {
    const path = contours[0];
    const curved = ink && path.some(p => p.in || p.out);
    const vector: Vector = {
      ...clone(style), id: faceId,
      x: basis.x, y: basis.y, rotation: 0,
      width: bounds.right - bounds.left, height: bounds.bottom - bounds.top,
      kind: ink ? curved ? 'bezier' : 'path' : 'polygon',
      drawingMode: 'merge', closed: !ink, controlBounds: true,
      ...(pivot && { pivot: { ...pivot } }),
      ...(ink ? curved
        ? { fillEnabled: false, nodes: path }
        : { fillEnabled: false, points: path }
        : { fillRule: 'evenodd', contours }),
    };
    return { vector, bounds };
  };
}

export function placeFilledInkPieces(cut: FilledInkInBasis, cutter: Vector) {
  const basis = cut.origin;
  try {
    function placePieces(owner: Vector, pieces: InkBasisPiece[], ink: boolean, keepId = false): PlacedPiece[] {
      const write = prepareInkBasisWriter(owner, basis, ink);
      return pieces.map((piece, index) => write(piece, keepId && !index ? owner.id : id()));
    }
    return {
      origin: basis,
      ink: placePieces(cutter, cut.ink, true, true),
      outlines: new Map([...cut.outlines].map(([owner, pieces]) => [owner, placePieces(owner, pieces, true)])),
      fills: new Map([...cut.fills].map(([owner, pieces]) => [owner, placePieces(owner, pieces, false)])),
    };
  } catch {
    return;
  }
}

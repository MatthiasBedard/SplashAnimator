import { clone, type Vector, type Point } from '@splash/document';
import { matrix, mapPoint, inversePoint, type Matrix } from './affine';
import { certifyCompoundContours, fitCompoundContours, fitSmallerCompoundContours } from './compound-fit';
import type { CurveFit } from './curve-fit';

/** Prepare a fitted copy; callers may preview or discard it without touching art.
 * Only straight, fill-only even-odd compounds are eligible. Never repeatedly fit
 * an already fitted curve: that would accumulate unreported approximation error.
 */
export function prepareContourFit(source: Vector, tolerance = 0.25, clearance = 2 * tolerance) {
  const { m, input } = straightContourInput(source);
  const fit = fitCompoundContours(input, tolerance, clearance);
  const shape = fittedShape(source, m, fit.rings);
  return {
    shape,
    tolerance,
    maxError: Math.max(...fit.rings.map((r) => r.maxError)),
    sourceAnchors: source.contours!.reduce((n, r) => n + r.length, 0),
    fittedAnchors: shape.contours!.reduce((n, r) => n + r.length, 0),
    joins: {
      issues: fit.rings.flatMap((r, ring) => r.joins.issues.map((issue) => ({ ...issue, ring }))),
      maxDegrees: Math.max(...fit.rings.map((r) => r.joins.maxDegrees)),
      discontinuities: fit.rings.reduce((n, r) => n + r.joins.discontinuities, 0),
      degenerate: fit.rings.reduce((n, r) => n + r.joins.degenerate, 0),
    },
    parents: fit.parents,
    depths: fit.depths,
  };
}

export function prepareSmallerBrushContourFit(source: Vector, tolerance: number, anchorCount: number, original?: Point[][]) {
  const { m, input } = straightContourInput(source);
  const fit = fitSmallerCompoundContours(input, tolerance, anchorCount);
  if (!fit) return;
  if (original) certifyCompoundContours(original, fit.rings.map(ring=>ring.curves), tolerance * 2, 0, true, 'dense', true);
  return { shape: fittedShape(source, m, fit.rings), fittedAnchors: fit.fittedAnchors };
}

function straightContourInput(source: Vector) {
  if (
    source.kind !== 'polygon' ||
    source.fillRule !== 'evenodd' ||
    source.fillEnabled === false ||
    source.strokeWidth !== 0 ||
    !source.contours?.length ||
    source.contours.some((ring) => ring.some((node) => node.in || node.out))
  )
    throw Error('Contour fitting requires straight, fill-only even-odd polygon contours');
  const m = matrix(source);
  if (m.some((n) => !Number.isFinite(n)) || Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-10)
    throw Error('Contour fitting requires an invertible transform');
  return { m, input: source.contours.map(r => r.map(p => mapPoint(m, p))) };
}

function fittedShape(source: Vector, m: Matrix, rings: CurveFit[]) {
  const local = (p: Point) => {
    const q = inversePoint(m, p);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y))
      throw Error('Invalid fitted local coordinate');
    return q;
  };
  const shape = clone(source);
  shape.contours = rings.map((r) =>
    r.nodes.map((n) => ({
      ...local(n),
      ...(n.in ? { in: local(n.in) } : {}),
      ...(n.out ? { out: local(n.out) } : {}),
    })),
  );
  // Keep placement, dimensions and paint bases exactly as stored. Renormalizing
  // here would require remapping every independent gradient/bitmap basis.
  return shape;
}

/** Bound a multi-selection request before doing any fitting. No partial result is
 * returned if one member fails. Unselected shapes retain their original values. */
export function prepareContourFits(shapes: Vector[], selected: string[], tolerance = 0.25) {
  const ids = new Set(selected);
  if (
    !ids.size ||
    ids.size !== selected.length ||
    new Set(shapes.map((s) => s.id)).size !== shapes.length
  )
    throw Error('Invalid contour-fit selection');
  const targets = shapes.filter((s) => ids.has(s.id));
  if (targets.length !== ids.size) throw Error('Contour-fit selection is missing artwork');
  if (
    targets.length > 64 ||
    targets.reduce((n, s) => n + (s.contours?.reduce((m, r) => m + r.length, 0) ?? 0), 0) > 8192
  )
    throw Error('Contour-fit selection exceeds work limits');
  const fits = targets.map((s) => prepareContourFit(s, tolerance));
  const replacements = new Map(fits.map((fit) => [fit.shape.id, fit.shape]));
  return { shapes: shapes.map((s) => replacements.get(s.id) ?? clone(s)), fits };
}

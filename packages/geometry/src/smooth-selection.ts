import { clone, type Vector } from '@splash/document';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { matrix, mapPoint, inversePoint } from './affine';
import { worldPaths } from './drawing';
import { smoothBrushSamples } from './pressure';
import { fitPolyline } from './curve-fit';
import { fitCompoundContours } from './compound-fit';
import { clipPaint } from './clip-paint';
import type { PaintRegion } from './paint-region';
import { artworkVertices, simplifyArtwork } from './artwork-simplify';

export type SmoothSelection = {
  selected: string[];
  region?: PaintRegion;
  eligible?: string[];
  simplify?: boolean;
};
export const canSmoothVector = (shape: Vector) => !['text', 'symbol'].includes(shape.kind);

/** Worker-only preparation. Unselected art is never filtered or merged again. */
export function prepareSmoothSelection(shapes: Vector[], request: SmoothSelection) {
  validateLiveGraphicData({ shapes, request });
  if (request.simplify !== undefined && typeof request.simplify !== 'boolean')
    throw Error('Invalid selection simplification option.');
  const reduce = request.simplify === true;
  const unchanged = () => ({ artwork: clone(shapes), selected: [...request.selected], changed: 0,
    ...(reduce ? { removed: 0 } : {}) });
  const ids = new Set(request.selected);
  if (
    ids.size !== request.selected.length ||
    request.selected.some((id) => !shapes.some((s) => s.id === id))
  )
    throw Error('Select the original artwork again before smoothing.');
  const region = request.region?.length ? request.region : undefined;
  let artwork = clone(shapes),
    picked = [...request.selected];
  if (region) {
    const eligible = request.eligible ?? [];
    if (!eligible.length || eligible.some((id) => !shapes.some((s) => s.id === id)))
      throw Error('Select the original paint region again before smoothing.');
    const outside = clipPaint(artwork, {
      region,
      eligible,
      keep: 'outside',
      ...(reduce ? { preserveStrokes: true, preserveOutsideFillCurves: true } : {}),
    });
    const inside = clipPaint(artwork, {
      region,
      eligible,
      keep: 'inside',
      ...(reduce ? { preserveStrokes: true } : {}),
    });
    picked = inside.filter(canSmoothVector).map((s) => s.id);
    artwork = [...outside, ...inside];
  }
  const targets = new Set(picked);
  const beforeCount = artwork
    .filter((s) => targets.has(s.id))
    .reduce((n, s) => n + artworkVertices(s), 0);
  let changed = 0;
  artwork = artwork.map((source) => {
    if (!targets.has(source.id) || !canSmoothVector(source)) return source;
    if (reduce) {
      const result = simplifyArtwork(source);
      if (artworkVertices(result) < artworkVertices(source)) changed++;
      return result;
    }
    // Straight primitives and ellipses are already smooth; keep their exact data.
    if (['line', 'rectangle', 'ellipse'].includes(source.kind)) return source;
    const result = clone(source),
      m = matrix(source);
    const local = (p: { x: number; y: number }) => {
      const q = inversePoint(m, p);
      if (!Number.isFinite(q.x) || !Number.isFinite(q.y))
        throw Error('Smoothing exceeds finite geometry.');
      return q;
    };
    if (source.kind === 'brush') {
      const points = source.points.map((p) => ({ ...p, ...mapPoint(m, p) }));
      result.points = smoothBrushSamples(points, 1).map((p, i) =>
        p.x === points[i].x && p.y === points[i].y
          ? { ...source.points[i] }
          : { ...source.points[i], ...local(p) },
      );
    } else {
      const paths = worldPaths(source, 0.1);
      const node = (n: {
        x: number;
        y: number;
        in?: { x: number; y: number };
        out?: { x: number; y: number };
      }) => ({
        ...local(n),
        ...(n.in ? { in: local(n.in) } : {}),
        ...(n.out ? { out: local(n.out) } : {}),
      });
      const closed = !!source.contours || !!source.closed || source.kind === 'polygon';
      if (closed) {
        // Existing compound certifier protects ring winding, nesting and contacts.
        // Zero source-edge clearance permits dense Brush outlines without relaxing
        // its intersection, fitted-hull, numeric or work-limit rejection.
        const fit = fitCompoundContours(paths, 0.25, 0, true);
        if (source.contours) result.contours = fit.rings.map((r) => r.nodes.map(node));
        else {
          result.kind = 'bezier';
          result.closed = true;
          result.points = [];
          result.nodes = fit.rings[0].nodes.map(node);
        }
      } else {
        if (paths.length !== 1 || paths[0].length < 2) return source;
        const fit = fitPolyline(smoothBrushSamples(paths[0], 1), 0.75);
        result.kind = 'bezier';
        result.points = [];
        result.nodes = fit.nodes.map(node);
        // Preserve endpoint pen metadata and exact authored local positions.
        const endpoints = source.nodes ?? source.points;
        if (endpoints.length) {
          result.nodes[0] = {
            ...endpoints[0],
            ...result.nodes[0],
            x: endpoints[0].x,
            y: endpoints[0].y,
          };
          result.nodes[result.nodes.length - 1] = {
            ...endpoints.at(-1)!,
            ...result.nodes.at(-1)!,
            x: endpoints.at(-1)!.x,
            y: endpoints.at(-1)!.y,
          };
        }
      }
    }
    validateLiveGraphicData(result);
    if (JSON.stringify(result) !== JSON.stringify(source)) changed++;
    return result;
  });
  if (region && changed) {
    // Keep the original selection boundary exact: smoothing a clipped fragment
    // must not repaint neighboring, unselected ink across that boundary.
    const counts: number[] = [];
    const inside = clipPaint(
      artwork.filter((s) => targets.has(s.id)),
      {
        region,
        keep: 'inside',
        eligible: picked,
        ...(reduce ? { preserveStrokes: true } : {}),
      },
      counts,
    );
    // An uncertified reclip can report no inside fragment. Keep the source
    // rather than publishing that disappearance as a vertex reduction.
    if (counts.some(count => count === 0)) return unchanged();
    artwork = [...artwork.filter((s) => !targets.has(s.id)), ...inside];
    picked = inside.map((s) => s.id);
  }
  if (reduce) {
    const afterCount = artwork
      .filter((s) => picked.includes(s.id))
      .reduce((n, s) => n + artworkVertices(s), 0);
    // Re-clipping can reintroduce boundary vertices. That is not a successful
    // Simplify action: leave source, selection and history untouched instead.
    if (!changed || afterCount >= beforeCount)
      return unchanged();
    return { artwork, selected: picked, changed, removed: beforeCount - afterCount };
  }
  return { artwork, selected: picked, changed };
}

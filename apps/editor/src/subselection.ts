import { clone, type BezierNode, type Point, type Vector } from '../../../packages/document/src';
import { validateLiveGraphicData } from '../../../packages/document/src/live-motion';
import {
  anchorsInBox,
  convertAnchors,
  deleteAnchors,
  moveAnchors,
} from '../../../packages/geometry/src/nodes';
import { editableEdgeOutline } from '../../../packages/geometry/src/edge-bend';
import { inversePoint, matrix, mapPoint } from '../../../packages/geometry/src/affine';
import { boundsIndex } from '../../../packages/geometry/src/bounds-index';
import { combineSelection, type SelectionMode } from '../../../packages/geometry/src/lasso';

export type AnchorSets = Record<string, number[]>;
/** Virtual primitive vertices do not materialize until an actual edit. */
export function subselectionOutline(shape: Vector): Vector | undefined {
  if (shape.kind === 'symbol' || shape.kind === 'text') return;
  if (shape.contours || shape.nodes || shape.points.length) return shape;
  return editableEdgeOutline(shape);
}
export function subselectionNodes(shape: Vector): BezierNode[] {
  const outline = subselectionOutline(shape);
  return outline?.contours?.flat() ?? outline?.nodes ?? outline?.points ?? [];
}
/** Original merged stroke anchors at the same world point are one junction,
 * even when the arrangement stores their branches in separate paths. Capture
 * only original anchor identities: no screen-distance snapping, edge insertion
 * or propagation through nearby points. Object/group boundaries stay separate.
 * Unmarked artwork is eligible only inside an explicitly merged main layer. */
export function connectedAnchorSets(
  artwork: Vector[],
  sets: AnchorSets,
  mergeUnmarked = false,
): AnchorSets {
  validateLiveGraphicData([artwork, sets]);
  if (typeof mergeUnmarked !== 'boolean') throw Error('Choose an original drawing scope.');
  const originals = new Map(artwork.map((s) => [s.id, s]));
  if (originals.size !== artwork.length) throw Error('Original anchor identities changed.');
  const result = new Map<string, Set<number>>();
  for (const [id, indices] of Object.entries(sets)) {
    const source = originals.get(id),
      nodes = source && subselectionNodes(source);
    if (!nodes || indices.some((i) => !Number.isSafeInteger(i) || i < 0 || !nodes[i]))
      throw Error('Original selected anchors changed.');
    // Symbol cross-artwork selection includes empty entries for unselected
    // items. They must not become owners that suppress attached-fill following.
    if (indices.length) result.set(id, new Set(indices));
  }
  const eligible = (s: Vector) =>
    s.strokeWidth > 0 &&
    s.kind !== 'brush' &&
    (s.drawingMode === 'merge' || (mergeUnmarked && s.drawingMode !== 'object'));
  let work = 0;
  const tick = () => {
    if (++work > 1000000) throw Error('Connected anchor work limit reached.');
  };
  const points = artwork.flatMap((s) => {
    if (!eligible(s)) return [];
    const m = matrix(s),
      group = JSON.stringify(s.groups ?? []);
    return subselectionNodes(s).map((node, index) => {
      tick();
      const p = mapPoint(m, node);
      if (![p.x, p.y].every(Number.isFinite))
        throw Error('Connected anchor exceeds finite geometry.');
      return { owner: s.id, index, p, group };
    });
  });
  const box = (p: Point) => ({ left: p.x, right: p.x, top: p.y, bottom: p.y }),
    lookup = boundsIndex(points.map((p) => box(p.p)));
  // Only explicitly chosen original anchors seed the lookup. A newly discovered
  // branch cannot recursively turn a chain of near points into a connection.
  for (const [id, indices] of Object.entries(sets)) {
    const source = originals.get(id)!;
    if (!eligible(source)) continue;
    const m = matrix(source),
      nodes = subselectionNodes(source),
      group = JSON.stringify(source.groups ?? []);
    for (const index of indices) {
      tick();
      const p = mapPoint(m, nodes[index]),
        epsilon = Math.min(1e-7, Math.max(1, Math.abs(p.x), Math.abs(p.y)) * Number.EPSILON * 64);
      for (const i of lookup(box(p), epsilon)) {
        tick();
        const target = points[i];
        if (
          target.group !== group ||
          Math.abs(target.p.x - p.x) > epsilon ||
          Math.abs(target.p.y - p.y) > epsilon
        )
          continue;
        const selected = result.get(target.owner) ?? new Set<number>();
        selected.add(target.index);
        result.set(target.owner, selected);
      }
    }
  }
  return Object.fromEntries([...result].map(([id, indices]) => [id, [...indices]]));
}
export function selectAnchorBox(
  artwork: Vector[],
  a: Point,
  b: Point,
  previous: AnchorSets,
  mode: SelectionMode,
): AnchorSets {
  const result: AnchorSets = {};
  for (const shape of artwork) {
    const outline = subselectionOutline(shape);
    if (!outline) continue;
    const indices = combineSelection(
      (previous[shape.id] ?? []).map(String),
      anchorsInBox(outline, a, b).map(String),
      mode,
    ).map(Number);
    if (indices.length) result[shape.id] = indices;
  }
  return result;
}
/** Prepare every member before the caller writes any artwork. Displacements
 * share stage coordinates, with each member retaining its own local basis. */
export function prepareAnchorSetEdit(
  artwork: Vector[],
  sets: AnchorSets,
  operation: Point | 'smooth' | 'corner' | 'delete',
): Vector[] {
  validateLiveGraphicData(artwork);
  validateLiveGraphicData(sets);
  if (typeof operation !== 'string' && ![operation.x, operation.y].every(Number.isFinite))
    throw Error('Anchor displacement must be finite.');
  const source = new Map(artwork.map((shape) => [shape.id, shape]));
  return Object.entries(sets).map(([id, indices]) => {
    const original = source.get(id);
    if (!original) throw Error('Selected anchor artwork changed.');
    const outline = subselectionOutline(original),
      nodes = outline && subselectionNodes(outline);
    if (
      !outline ||
      !nodes ||
      !indices.length ||
      indices.some((index) => !Number.isSafeInteger(index) || !nodes[index])
    )
      throw Error('Selected anchors changed.');
    if (typeof operation !== 'string' && operation.x === 0 && operation.y === 0)
      return clone(original);
    const target = clone(outline);
    if (typeof operation === 'string') {
      if (operation === 'delete') {
        if (!deleteAnchors(target, indices))
          throw Error('Keep at least two anchors in open paths and three in closed contours.');
      } else {
        if (!target.nodes && !target.contours)
          throw Error('Choose Bezier paths or fill contours for tangent conversion.');
        convertAnchors(target, indices, operation);
      }
    } else {
      const basis = matrix(original);
      basis[4] = basis[5] = 0;
      const delta = inversePoint(basis, operation);
      if (![delta.x, delta.y].every(Number.isFinite))
        throw Error('Anchor displacement exceeds numeric limits.');
      moveAnchors(target, outline, indices, delta.x, delta.y);
    }
    if (
      subselectionNodes(target).some((node) =>
        [node, node.in, node.out].some((p) => p && ![p.x, p.y].every(Number.isFinite)),
      )
    )
      throw Error('Anchor edit exceeds numeric limits.');
    return target;
  });
}

/** Capture the unselected ends of original merged stroke junctions once.
 * Selected strokes translate as a whole. Other strokes move only at a join. */
export function captureStrokeMoveJunctions(artwork: Vector[], selected: ReadonlySet<string>) {
  const strokes = artwork.filter(
    (s) => s.strokeWidth > 0 && s.drawingMode !== 'object' && s.kind !== 'brush',
  );
  if (!strokes.some((s) => !selected.has(s.id))) return;
  const seeds = Object.fromEntries(
    strokes
      .filter((s) => selected.has(s.id))
      .map((s) => [s.id, subselectionNodes(s).map((_, index) => index)]),
  );
  if (!Object.keys(seeds).length) return;
  const joins = connectedAnchorSets(strokes, seeds, true);
  const followers = strokes.filter((s) => !selected.has(s.id) && Object.hasOwn(joins, s.id));
  if (!followers.length) return;
  const sets = Object.fromEntries(followers.map((s) => [s.id, joins[s.id]]));
  return {
    ids: new Set(followers.map((s) => s.id)),
    prepare: (delta: Point) => prepareAnchorSetEdit(followers, sets, delta),
  };
}

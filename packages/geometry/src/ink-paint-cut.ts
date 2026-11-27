import { id, type Vector } from '@splash/document';
import { hasRestorableFillCurves } from './clip-fill-curves';
import { boundsIndex, overlaps } from './bounds-index';
import { prepareSharedPaintStack } from './shared-paint-cut';
import { isEditableInk } from './stroke-cut';
import { paintCoordinateUnits } from './paint-winding';
import type { Bounds } from './bounds-index';

export type InkPaintReplacement = { source: number; pieces: Vector[] };
export type InkPaintRetry = {
  bounds: (shape: Vector) => Bounds;
  declined?: { ink: Vector; sources: Vector[] };
};

/** Use the original ink centerline as the shared boundary of the two faces.
 * Only ordinary solid paint can be written in a common document-space basis. */
export function partitionInkOverPaint(artwork: Vector[], ink: Vector, bounds: (s: Vector) => Bounds,
  eligible?: ReadonlySet<string>, includeStraightPaint = false, preserveInkOwners = false, retry?: InkPaintRetry) {
  const plain = (s: Vector) => s.drawingMode !== 'object' && !s.groups?.length &&
    !s.gradient && !s.bitmap && !s.tint && !s.blendMode && !s.blurRadius && !s.groupBlur && !s.brush;
  const editableInk = (s: Vector) => isEditableInk(s) && !s.rotation && !s.transform;
  if (!plain(ink) || !editableInk(ink) || ink.closed) return;
  const box = bounds(ink);
  const sources = artwork.filter(s => s !== ink && (!eligible || eligible.has(s.id)) &&
    overlaps(bounds(s), box, 0));
  if (sources.some(s => s.kind === 'symbol' || s.kind === 'text')) return;
  const fills = sources.filter(s => !isEditableInk(s) && s.fillEnabled !== false);
  const curvedInk = (s: Vector) => s.nodes?.some(n => n.in || n.out);
  if (!sources.length || !(includeStraightPaint || curvedInk(ink) || sources.some(s => hasRestorableFillCurves(s) || curvedInk(s))) || !sources.every(s =>
    plain(s) && (editableInk(s) || (s.fillEnabled !== false && !s.strokeWidth)))) return;
  // An earlier Pencil gesture may stop inside a face. A later segment
  // finishes that cut even when only the last link overlaps the new stroke.
  const connected = new Set(sources.filter(editableInk));
  if (fills.length && connected.size) {
    const exactPlacement = !!ink.controlBounds || sources.some(s => s.controlBounds);
    const ends = new Map<Vector,string[]>(), incident = new Map<string,Vector[]>();
    for (const s of artwork) {
      if (s === ink || eligible && !eligible.has(s.id) || !editableInk(s) || !plain(s) || s.closed) continue;
      const points = s.nodes ?? s.points;
      if (!points.length) continue;
      const endpoints = [points[0], points[points.length - 1]];
      const keys = exactPlacement
        ? endpoints.map(p => `${paintCoordinateUnits(s.x) + paintCoordinateUnits(p.x)},${paintCoordinateUnits(s.y) + paintCoordinateUnits(p.y)}`)
        : endpoints.map(p => `${s.x+p.x},${s.y+p.y}`);
      ends.set(s,keys);
      for (const key of keys) {
        const list = incident.get(key) ?? [];
        list.push(s);
        incident.set(key,list);
      }
    }
    for (const s of connected) for (const key of ends.get(s) ?? []) {
      for (const neighbor of incident.get(key) ?? []) connected.add(neighbor);
      incident.delete(key);
    }
  }
  const candidates = [...new Set([...sources,...connected])];
  // Full-layer and connected-component attempts in one release can reach
  // the same ordered owners. Only a decline under that same policy is reusable.
  const memo = !eligible && !includeStraightPaint && !preserveInkOwners ? retry : undefined;
  const previous = memo?.declined;
  if (previous?.ink === ink && previous.sources.length === candidates.length &&
      candidates.every((shape, i) => shape === previous.sources[i])) return;
  const cut = prepareSharedPaintStack(candidates, ink, 'ink',
    preserveInkOwners ? { removeCoveredInk: false, rejectCoincidentInk: true } : undefined);
  if (!cut && memo) memo.declined = { ink, sources: candidates };
  if (cut?.strokes) {
    // The edit worker's replacement protocol requires surviving pieces for
    // every owner. Completely covered old ink uses its normal drop merger.
    if (eligible && [...cut.background.values()].some(pieces => !pieces.length)) return;
    // A new line split into independent ink segments retires its drawing ID.
    // An edited selection still uses that ID to follow the original segment.
    const strokes = !eligible && !fills.length && cut.strokes.length > 1
      ? cut.strokes.map(s => s.id === ink.id ? { ...s, id: id() } : s)
      : cut.strokes;
    return { background: cut.background, strokes };
  }
}

/** A group drop can unite paint before its own Pencil lines cut the new
 * exterior. Keep every resulting face and centerline in its owner's slot. */
export function partitionJoinedPaint(artwork: Vector[], inkIds: ReadonlySet<string>, bounds: (s: Vector) => Bounds,
  respectStack = false): InkPaintReplacement[] {
  let drawn = artwork.filter(shape => !inkIds.has(shape.id));
  const owners = new WeakMap(artwork.map(shape => [shape,shape]));
  const order = new Map(artwork.map((shape,index) => [shape,index]));
  const slots = (shape:Vector) => order.get(owners.get(shape)!)!;
  const nearbyPaint = boundsIndex(drawn.map(bounds));
  for (const ink of artwork.filter(shape => inkIds.has(shape.id))) {
    const inkBox = bounds(ink);
    if (!nearbyPaint(inkBox).length) { drawn.push(ink); continue; }
    const stack = [...drawn,ink];
    const eligible = new Set(drawn.filter(shape => !respectStack || slots(shape)<slots(ink)).map(shape=>shape.id));
    const result = partitionInkOverPaint(stack,ink,bounds,eligible,true);
    if (!result || ![...result.background.keys()].some(shape=>!isEditableInk(shape))) {
      drawn.push(ink);
      continue;
    }
    const replacements = result.background;
    replacements.set(ink,result.strokes);
    drawn = stack.flatMap(shape => {
      const pieces = replacements.get(shape);
      if (!pieces) return [shape];
      const owner = owners.get(shape)!;
      for (const piece of pieces) owners.set(piece,owner);
      return pieces;
    });
  }
  const grouped = new Map<Vector,Vector[]>();
  for (const piece of drawn) {
    const owner = owners.get(piece)!, pieces = grouped.get(owner);
    if (pieces) pieces.push(piece);
    else grouped.set(owner,[piece]);
  }
  if (!artwork.some(shape=>!inkIds.has(shape.id) && grouped.get(shape)?.[0] !== shape)) return [];
  return artwork.flatMap((shape,source) => {
    const pieces = grouped.get(shape)!;
    if (pieces.length === 1 && pieces[0] === shape) return [];
    // The first face keeps the admitted destination ID for selection and
    // the remaining pieces keep the IDs assigned by the cut.
    pieces[0] = {...pieces[0],id:shape.id};
    return [{source,pieces}];
  });
}

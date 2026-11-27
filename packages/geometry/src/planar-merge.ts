import { clone, id, type BezierNode, type Point, type Vector } from '@splash/document';
import { inversePoint, mapPoint, matrix, type Matrix } from './affine';
import { normalizeVector, pathCommands } from './drawing';
import { boundsIndex, overlaps, type Bounds } from './bounds-index';
import { hasVectorFill, mergeControlBounds } from './merge';
import { merge, SNAP, type FillRule, type Item, type PathCmd, type Piece } from './planar';

// Merge Drawing on one layer's raw artwork, through the planar map in `planar.ts`.
//
// New raw shapes cut and join the raw shapes they touch. Everything they touch is cut into one
// planar map of exact curves, and comes out again as raw shapes: one polygon per fill region and
// one path per stroke run, fills under strokes, in the stack slot of the lowest shape taken in.
// Shapes the new ones don't reach are left exactly as they were (same objects, same slots).

export type PlanarLayerOptions = {
  /** Merge every raw shape on the layer, not only what the seeds reach. */
  all?: boolean;
  /** Lines stay over all paint (they divide it, and are never covered by it). */
  keepCoveredLines?: boolean;
  /** Only these shapes (besides the seeds) may be taken in; the rest stay as they are. */
  eligible?: ReadonlySet<number>;
  /** More areas (layer space) whose shapes are taken in, such as where moved artwork was. */
  reach?: readonly Bounds[];
  /** Return copies of the shapes left as they were (for callers that keep their input). */
  copy?: boolean;
  /** Decline when a seed's own outline crosses itself (a finished Brush footprint never does). */
  simpleSeeds?: boolean;
};

export type PlanarLayerMerge = {
  shapes: Vector[];
  /** Input indices that were merged (each replaced by the new pieces). Shapes the merge took in
   * but did not change stay in their slots, as they were. */
  taken: number[];
  /** The new pieces: paint from `at`, then lines (right after the paint, or above paint left as
   * it was in a higher slot). */
  pieces: Vector[];
  at: number;
  /** For each piece, the input index of the topmost shape it came from. */
  sources: number[];
  /** For each piece, the input indices of every shape that makes it up. */
  contributors: number[][];
  /** For each output shape, its input index when it is an input shape left as it was. */
  origins: (number | undefined)[];
};

/** A raw shape the planar merge can take. Everything else stays whole, as an object. */
export function planarMergeable(s: Vector): boolean {
  if (s.drawingMode === 'object' || s.kind === 'text' || s.kind === 'symbol') return false;
  if (s.blendMode || s.tint || s.blurRadius || s.groupBlur || s.brush?.opacityProfile) return false;
  if (s.bone || s.boneAttachment || s.groups?.length) return false;
  const m = matrix(s);
  if (!m.every(Number.isFinite)) return false;
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return false;
  return hasVectorFill(s) || strokes(s);
}

/** Merges the raw shapes at `seeds` (new or moved shapes, at their stack slots) with the raw
 * shapes they touch. `undefined` when the merge declines (too much at once, or a map that can't
 * be drawn in the plane): the caller keeps the artwork as it was. */
export function planarMergeLayer(
  shapes: readonly Vector[],
  seeds: ReadonlySet<number>,
  options: PlanarLayerOptions = {},
): PlanarLayerMerge | undefined {
  // Bounds provide a conservative starting set. The planar map makes the
  // geometric decision later, so overlapping boxes alone never cut artwork.
  const eligible = shapes.map((s, i) => planarMergeable(s) && (!options.eligible || seeds.has(i) || options.eligible.has(i)));
  for (const i of seeds) if (!eligible[i]) return;
  const bounds: (Bounds | undefined)[] = shapes.map((s, i) => {
    if (!eligible[i]) return;
    try {
      const b = mergeControlBounds(s);
      return [b.left, b.right, b.top, b.bottom].every(Number.isFinite) ? b : undefined;
    } catch {
      return;
    }
  });
  for (const i of seeds) if (!bounds[i]) return;
  let taken: number[];
  if (options.all) taken = shapes.flatMap((_, i) => (bounds[i] ? [i] : []));
  else {
    const reach = [...[...seeds].map((i) => bounds[i]!), ...(options.reach ?? [])];
    taken = shapes.flatMap((_, i) => {
      const b = bounds[i];
      return b && (seeds.has(i) || reach.some((r) => overlaps(r, b, 2 * SNAP))) ? [i] : [];
    });
    // Matching paint that touches what was taken in joins it too, through any chain of touching
    // pieces of that paint (older artwork can hold matching pieces that were never joined).
    const byKey = new Map<string, number[]>();
    shapes.forEach((s, i) => {
      if (!bounds[i] || !hasVectorFill(s)) return;
      const key = fillKey(s);
      const list = byKey.get(key);
      if (list) list.push(i);
      else byKey.set(key, [i]);
    });
    const inside = new Set(taken);
    const pending = taken.filter((i) => hasVectorFill(shapes[i]));
    const lookups = new Map<string, (q: Bounds, pad?: number) => number[]>();
    for (let k = 0; k < pending.length; k++) {
      const i = pending[k], key = fillKey(shapes[i]), list = byKey.get(key)!;
      if (list.length < 2) continue;
      let find = lookups.get(key);
      if (!find) lookups.set(key, (find = boundsIndex(list.map((j) => bounds[j]!))));
      for (const n of find(bounds[i]!, 2 * SNAP)) {
        const j = list[n];
        if (!inside.has(j)) {
          inside.add(j);
          pending.push(j);
        }
      }
    }
    // Lines over or along paint taken in come too: they are what divides it from its neighbours.
    const fills = boundsIndex(taken.filter((i) => hasVectorFill(shapes[i])).map((i) => bounds[i]!));
    shapes.forEach((s, i) => {
      if (bounds[i] && !inside.has(i) && strokes(s) && fills(bounds[i]!, 2 * SNAP).length) inside.add(i);
    });
    taken = [...inside].sort((a, b) => a - b);
  }
  if (!taken.length) return;
  // With `keepCoveredLines`, every line goes over all the paint: lines divide paint, and paint
  // never covers them. Earlier lines stay as they are when new paint without a line of its own
  // meets them (moved just above it if their slot was under it); new lines still cut them.
  const lift = !!options.keepCoveredLines;
  const fillOnly = [...seeds].every((i) => !strokes(shapes[i]));
  // One entry per item going in, bottom to top: a shape, or its fill or its outline alone when
  // the outline goes above the paint.
  type Entry = { source: number; fill: boolean; stroke: boolean; over: boolean };
  const below: Entry[] = [], above: Entry[] = [];
  for (const i of taken) {
    const s = shapes[i], fill = hasVectorFill(s), stroke = strokes(s);
    if (lift && stroke) {
      if (fill) below.push({ source: i, fill, stroke: false, over: false });
      above.push({ source: i, fill: false, stroke, over: fillOnly && !seeds.has(i) });
    } else below.push({ source: i, fill, stroke, over: false });
  }
  const entries = [...below, ...above];
  const order = entries.map((e) => e.source);
  const fillStyles = new Map<string, number>(), strokeStyles = new Map<string, number>();
  const style = (table: Map<string, number>, key: string) => {
    let n = table.get(key);
    if (n === undefined) table.set(key, (n = table.size));
    return n;
  };
  const items: Item[] = entries.map(({ source: i, fill, stroke, over }) => {
    const s = shapes[i];
    return {
      path: worldPath(s),
      fill: fill ? style(fillStyles, fillKey(s)) : undefined,
      fillRule: fillRule(s),
      stroke: stroke ? style(strokeStyles, strokeKey(s)) : undefined,
      seed: seeds.has(i),
      over,
      seeThrough: fill && ((s.opacity ?? 1) < 1 || !!s.gradient || !!s.bitmap),
    };
  });
  const merged = merge(items);
  if (!merged) return;
  if (options.simpleSeeds && order.some((i, k) => seeds.has(i) && merged.selfCrossing[k])) return;
  // Shapes taken in that nothing changed stay exactly as they were, in their slots.
  const changed = new Set(order.filter((i, k) => seeds.has(i) || !merged.untouched[k]));
  const kept = new Set(taken.filter((i) => !changed.has(i)));
  taken = taken.filter((i) => !kept.has(i));
  // A new shape nothing else meets goes in exactly as it was drawn, not through the map.
  const alone = new Set(order.filter((i, k) => seeds.has(i) && merged.isolated[k]));
  const named = new Set<number>();
  const pieces: Vector[] = [], sources: number[] = [], contributors: number[][] = [];
  const emit = (piece: Piece, fill: boolean, direct = false) => {
    const source = order[piece.item];
    if (kept.has(source) || (alone.has(source) && !direct)) return;
    // Rebuilt pieces are new shapes with new ids, except that new paint keeps its id on its first
    // piece (it is still the shape just drawn). Shapes left as they were keep theirs.
    const vector = direct ? { ...clone(shapes[source]), drawingMode: 'merge' as const }
      : fill ? fillVector(shapes[source], piece.path) : strokeVector(shapes[source], piece.path);
    if (!vector) return;
    if (fill && !direct && seeds.has(source) && !named.has(source)) {
      named.add(source);
      vector.id = shapes[source].id;
    }
    pieces.push(vector);
    sources.push(source);
    contributors.push([...new Set((piece.sources.length ? piece.sources : [piece.item]).map((k) => order[k]))]);
  };
  for (const i of alone) {
    const item = order.indexOf(i);
    emit({ style: 0, path: [], item, sources: [item] }, hasVectorFill(shapes[i]), true);
  }
  for (const piece of merged.fills) emit(piece, true);
  for (const piece of merged.strokes) emit(piece, false);
  let at = taken[0];
  for (const i of taken) if (i < at) at = i;
  const removed = new Set(taken);
  const copy = (s: Vector) => (options.copy ? clone(s) : s);
  // Lines kept over the paint that sat under its slot move just above it.
  const lifted = new Set(above.filter((e) => kept.has(e.source) &&
    !hasVectorFill(shapes[e.source]) && e.source < at).map((e) => e.source));
  // Paint pieces go in the lowest slot taken. Line pieces show above everything they came out
  // over, so they go above any paint the merge left as it was in a higher slot too.
  const paintFirst = pieces.map((_, k) => k).sort((a, b) => Number(!hasVectorFill(pieces[a])) - Number(!hasVectorFill(pieces[b])));
  const ordered = paintFirst.map((k) => pieces[k]);
  const orderedSources = paintFirst.map((k) => sources[k]), orderedContributors = paintFirst.map((k) => contributors[k]);
  const lineStart = ordered.findIndex((piece) => !hasVectorFill(piece));
  const paintPieces = lineStart < 0 ? ordered : ordered.slice(0, lineStart);
  const linePieces = lineStart < 0 ? [] : ordered.slice(lineStart);
  let linesAfter = -1;
  for (const i of kept) if (i > at && hasVectorFill(shapes[i]) && i > linesAfter) linesAfter = i;
  const out: Vector[] = [], origins: (number | undefined)[] = [];
  const keep = (i: number) => {
    out.push(copy(shapes[i]));
    origins.push(i);
  };
  const add = (list: Vector[]) => {
    out.push(...list);
    origins.push(...list.map(() => undefined));
  };
  shapes.forEach((_, i) => {
    if (i === at) {
      add(paintPieces);
      if (linesAfter < 0) add(linePieces);
      lifted.forEach(keep);
    }
    if (!removed.has(i) && !lifted.has(i)) keep(i);
    if (i === linesAfter) add(linePieces);
  });
  // Nothing below `at` is removed except lines moved above the pieces, so they start here.
  return { shapes: out, taken, pieces: ordered, at: at - lifted.size, sources: orderedSources,
    contributors: orderedContributors, origins };
}

/** Whether the shape draws a line the merge cuts. */
function strokes(s: Vector): boolean {
  return s.kind !== 'brush' && Number.isFinite(s.strokeWidth) && s.strokeWidth > 0;
}

function fillRule(s: Vector): FillRule {
  return s.fillRule === 'evenodd' && (!!s.contours || s.kind !== 'brush') ? 'evenodd' : 'nonzero';
}

const round = (n: number) => Math.round(n * 1e9) / 1e9;

/** Equal keys are one fill to the merge: equal paint, placed the same way for gradients and
 * bitmaps (they are carried into each piece in their source's space). */
function fillKey(s: Vector): string {
  const m = matrix(s).map(round);
  return JSON.stringify([
    s.fill, s.opacity ?? 1, s.paintBrightness ?? 0,
    s.gradient ? [s.gradient, m] : 0, s.bitmap ? [s.bitmap, m] : 0,
  ]);
}

/** Equal keys are one line style: pieces of one style chain into one run. */
function strokeKey(s: Vector): string {
  const m = matrix(s);
  return JSON.stringify([
    s.stroke, s.strokeWidth, s.strokeCap ?? '', s.strokeJoin ?? '', s.opacity ?? 1, s.paintBrightness ?? 0,
    round(m[0]), round(m[1]), round(m[2]), round(m[3]),
  ]);
}

/** The shape's outline in layer space. Curves whose handles sit on their ends are lines. */
export function worldPath(s: Vector): PathCmd[] {
  const m = matrix(s);
  const out: PathCmd[] = [];
  let last: Point = { x: 0, y: 0 };
  const at = (x: number, y: number) => mapPoint(m, { x, y });
  for (const c of pathCommands(s)) {
    if (c[0] === 'Z') {
      out.push(['Z']);
      continue;
    }
    if (c[0] === 'C') {
      const a = { x: c[1], y: c[2] }, b = { x: c[3], y: c[4] }, e = { x: c[5], y: c[6] };
      const p = at(e.x, e.y);
      if (same(a, last) && same(b, e)) out.push(['L', p.x, p.y]);
      else {
        const u = at(a.x, a.y), v = at(b.x, b.y);
        out.push(['C', u.x, u.y, v.x, v.y, p.x, p.y]);
      }
      last = e;
      continue;
    }
    const p = at(c[1], c[2]);
    out.push([c[0], p.x, p.y]);
    last = { x: c[1], y: c[2] };
  }
  return out;
}

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** Subpaths of `path` in `source`'s own space (or layer space without `m`), as anchors with handles. */
function rings(path: PathCmd[], m?: Matrix): { nodes: BezierNode[]; closed: boolean; curved: boolean }[] {
  const local = (x: number, y: number) => (m ? inversePoint(m, { x, y }) : { x, y });
  const out: { nodes: BezierNode[]; closed: boolean; curved: boolean }[] = [];
  let ring: { nodes: BezierNode[]; closed: boolean; curved: boolean } | undefined;
  for (const c of path) {
    if (c[0] === 'M') {
      ring = { nodes: [local(c[1], c[2])], closed: false, curved: false };
      out.push(ring);
    } else if (!ring) continue;
    else if (c[0] === 'L') ring.nodes.push(local(c[1], c[2]));
    else if (c[0] === 'C') {
      ring.nodes[ring.nodes.length - 1].out = local(c[1], c[2]);
      ring.nodes.push({ ...local(c[5], c[6]), in: local(c[3], c[4]) });
      ring.curved = true;
    } else {
      ring.closed = true;
      const first = ring.nodes[0], last = ring.nodes[ring.nodes.length - 1];
      if (ring.nodes.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) <= 1e-9) {
        if (last.in) first.in = last.in;
        ring.nodes.pop();
      }
    }
  }
  return out.filter((r) => r.nodes.length > 1);
}

/** Paint and authoring settings a piece keeps from its source; geometry is rebuilt. A piece in
 * the layer's own basis (`world`) stores its points exactly as the merge made them, so pieces that
 * share an edge store bit-identical curves there; otherwise it keeps its source's placement (a
 * gradient, bitmap or transformed line is drawn in that space). */
function pieceBase(source: Vector, world: boolean): Vector {
  const base = clone({ ...source, points: [], nodes: undefined, contours: undefined, brush: undefined });
  delete base.cornerRadius;
  delete base.controlBounds;
  delete base.text;
  if (world) {
    // The pivot stays where it was on the stage.
    if (source.pivot) base.pivot = mapPoint(matrix(source), source.pivot);
    base.x = 0;
    base.y = 0;
    base.rotation = 0;
    delete base.transform;
    base.controlBounds = true;
  }
  return base;
}

const identityBasis = (s: Vector) => {
  const m = matrix(s);
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;
};

/** A closed ring of two anchors (two curves) as three, by halving one curve: the document keeps
 * at least three anchors in a contour. A straight two-anchor ring has no area and is dropped. */
function threeAnchors(ring: BezierNode[]): BezierNode[] | undefined {
  if (ring.length !== 2) return ring.length > 2 ? ring : undefined;
  const k = ring[0].out || ring[1].in ? 0 : ring[1].out || ring[0].in ? 1 : -1;
  if (k < 0) return;
  const a = ring[k], b = ring[1 - k];
  const c = [a, a.out ?? a, b.in ?? b, b];
  const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const p01 = mid(c[0], c[1]), p12 = mid(c[1], c[2]), p23 = mid(c[2], c[3]);
  const p012 = mid(p01, p12), p123 = mid(p12, p23), m = mid(p012, p123);
  const out: BezierNode[] = [{ ...a, out: p01 }, { ...m, in: p012, out: p123 }, { ...b, in: p23 }];
  return k === 0 ? out : [out[2], out[0], out[1]];
}

function fillVector(source: Vector, path: PathCmd[]): Vector | undefined {
  const world = !source.gradient && !source.bitmap;
  const contours = rings(path, world ? undefined : matrix(source)).flatMap((r) => {
    const ring = threeAnchors(r.nodes);
    return ring ? [ring] : [];
  });
  if (!contours.length) return;
  const s: Vector = {
    ...pieceBase(source, world),
    id: id(),
    kind: 'polygon',
    points: [],
    closed: true,
    fillEnabled: true,
    strokeWidth: 0,
    fillRule: 'evenodd',
    contours,
    drawingMode: 'merge',
  };
  normalizeVector(s);
  return s;
}

function strokeVector(source: Vector, path: PathCmd[]): Vector | undefined {
  const world = identityBasis(source);
  const [ring] = rings(path, world ? undefined : matrix(source));
  if (!ring) return;
  const base = pieceBase(source, world);
  delete base.gradient;
  delete base.bitmap;
  const s: Vector = ring.curved
    ? { ...base, id: id(), kind: 'bezier', points: [], nodes: ring.nodes, closed: ring.closed || undefined }
    : {
        ...base, id: id(), kind: 'path', closed: ring.closed || undefined,
        points: ring.nodes.map(({ x, y }) => ({ x, y })),
      };
  if (!s.closed) delete s.closed;
  s.fillEnabled = false;
  s.drawingMode = 'merge';
  normalizeVector(s);
  return s;
}

export type PlanarFillJoin = {
  artwork: Vector[];
  /** Ids of fills joined into another fill, to the id of the fill they joined. */
  absorbed: Map<string, string>;
  /** Fills that disappeared inside the fill they joined (none here: every join absorbs). */
  contained: Set<string>;
};

/** Recolored or newly placed paint (`seeds`, by id) joins the matching paint it touches on a
 * Merge Drawing layer into one shape, through any chain of touching pieces of that paint, wherever
 * no visible line divides them. Lines stay as they are, over the paint. With nothing to join the
 * artwork comes back as it is (the same array). `undefined` when the seeds aren't paint the map
 * takes, or the merge declines: the caller may try another way. */
export function planarFillJoin(artwork: Vector[], seeds: readonly string[]): PlanarFillJoin | undefined {
  const ids = new Set(seeds);
  const at = new Set<number>();
  artwork.forEach((s, i) => {
    if (ids.has(s.id) && planarMergeable(s) && hasVectorFill(s) && !strokes(s)) at.add(i);
  });
  if (!at.size) return;
  // Only run the map when matching paint lies near a seed.
  const box = (s: Vector) => {
    try {
      const b = mergeControlBounds(s);
      return [b.left, b.right, b.top, b.bottom].every(Number.isFinite) ? b : undefined;
    } catch {
      return;
    }
  };
  const near = [...at].some((i) => {
    const key = fillKey(artwork[i]), b = box(artwork[i]);
    return !!b && artwork.some((s, j) => {
      if (at.has(j) || !planarMergeable(s) || !hasVectorFill(s) || fillKey(s) !== key) return false;
      const o = box(s);
      return !!o && overlaps(b, o, 2 * SNAP);
    });
  });
  const unchanged = { artwork, absorbed: new Map<string, string>(), contained: new Set<string>() };
  if (!near) return unchanged;
  let merged: PlanarLayerMerge | undefined;
  try {
    merged = planarMergeLayer(artwork, at, { keepCoveredLines: true });
  } catch {
    return;
  }
  if (!merged) return;
  const absorbed = new Map<string, string>();
  const used = new Set(merged.shapes.map((shape) => shape.id));
  let joined = false;
  merged.pieces.forEach((piece, n) => {
    if (!hasVectorFill(piece)) return;
    const fills = merged!.contributors[n].filter((i) => hasVectorFill(artwork[i]));
    if (fills.length < 2) return;
    joined = true;
    // The joined shape is still the recolored (or placed) one: it keeps that id.
    const seed = fills.find((i) => at.has(i));
    if (seed !== undefined && !at.has(merged!.sources[n]) && !used.has(artwork[seed].id)) {
      used.delete(piece.id);
      piece.id = artwork[seed].id;
      used.add(piece.id);
    }
    for (const i of fills) if (artwork[i].id !== piece.id) absorbed.set(artwork[i].id, piece.id);
  });
  if (!joined) return unchanged;
  return { artwork: merged.shapes, absorbed, contained: new Set() };
}

/** Bucket: the empty area around `point` that the layer's lines and paint enclose, with exact
 * curves along everything that bounds it (so it meets its neighbours edge to edge), filled with
 * `paint`. Islands inside it stay holes. `undefined` when the planar map can't answer (shapes it
 * doesn't take, or no closed area there): the caller falls back to its own enclosure search. */
export function planarBucket(shapes: readonly Vector[], paint: Vector, point: Point): Vector | undefined {
  if (!shapes.length || !shapes.every(planarMergeable)) return;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const s of shapes) {
    let b: Bounds;
    try { b = mergeControlBounds(s); } catch { return; }
    if (![b.left, b.right, b.top, b.bottom].every(Number.isFinite)) return;
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  }
  if (!(point.x > left && point.x < right && point.y > top && point.y < bottom)) return;
  // Everything sits on a sheet of the new paint. The sheet's regions left showing, between
  // visible lines and paint, are the empty areas; the one around the outside is open.
  left -= 8; top -= 8; right += 8; bottom += 8;
  const sheet: Item = {
    path: [['M', left, top], ['L', right, top], ['L', right, bottom], ['L', left, bottom], ['Z']],
    fill: 0, fillRule: 'nonzero',
  };
  const fills = new Map<string, number>([['\u0000sheet', 0]]), lines = new Map<string, number>();
  const style = (table: Map<string, number>, key: string) => {
    let n = table.get(key);
    if (n === undefined) table.set(key, (n = table.size));
    return n;
  };
  const items: Item[] = [sheet, ...shapes.map((s): Item => {
    const fill = hasVectorFill(s);
    return {
      path: worldPath(s),
      fill: fill ? style(fills, fillKey(s)) : undefined,
      fillRule: fillRule(s),
      stroke: strokes(s) ? style(lines, strokeKey(s)) : undefined,
      seeThrough: fill && ((s.opacity ?? 1) < 1 || !!s.gradient || !!s.bitmap),
    };
  })];
  let merged: ReturnType<typeof merge>;
  try {
    merged = merge(items);
  } catch {
    return;
  }
  if (!merged) return;
  const open = { x: left + 4, y: top + 4 };
  let found: Piece | undefined;
  for (const piece of merged.fills) {
    if (piece.item !== 0 || !insidePath(piece.path, point)) continue;
    if (insidePath(piece.path, open)) return;
    found = piece;
    break;
  }
  if (!found) return;
  const region = fillVector({ ...paint, x: 0, y: 0, rotation: 0, transform: undefined }, found.path);
  if (!region) return;
  region.id = paint.id;
  return region;
}

/** Even-odd containment of `p` by a path of lines and cubics (cubics in short chords). */
function insidePath(path: readonly PathCmd[], p: Point): boolean {
  let inside = false, start: Point | undefined, last: Point | undefined;
  const edge = (a: Point, b: Point) => {
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  };
  for (const c of path) {
    if (c[0] === 'M') {
      if (start && last) edge(last, start);
      start = last = { x: c[1], y: c[2] };
    } else if (!last) continue;
    else if (c[0] === 'L') {
      const b = { x: c[1], y: c[2] };
      edge(last, b);
      last = b;
    } else if (c[0] === 'C') {
      const a = last;
      for (let k = 1; k <= 24; k++) {
        const t = k / 24, u = 1 - t;
        const b = {
          x: u * u * u * a.x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
          y: u * u * u * a.y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
        };
        edge(last, b);
        last = b;
      }
    } else if (start) {
      edge(last, start);
      last = start;
    }
  }
  if (start && last) edge(last, start);
  return inside;
}

import { clone, type BezierNode, type Point, type Vector } from '@splash/document';
import { validateLiveGraphicData } from '../../document/src/live-motion';
import { inversePoint, mapPoint, matrix } from './affine';
import { cubicInterval as interval, monotoneInterval } from './cubic-interval';
import { boundsIndex } from './bounds-index';
import { splitCubic, type Cubic } from './curve-fit';
import { flattenCommands, worldPaths } from './drawing';
import { boundaryContains } from './boundary-winding';
import { editableEdgeOutline } from './edge-bend';
import { OVERLAY_CURVE_TOLERANCE } from './clip-fill-curves';

type Edge = {
  ring: number;
  index: number;
  end: number;
  slot: number;
  curve: Cubic;
  straight: boolean;
};
type SourceEdge = Edge & { owner: string };
type Piece = { source: SourceEdge; start: number; end: number; a: Point; b: Point };
type EdgeLink = { edge: Edge; source: SourceEdge; start: number; end: number };
type PartialLink = { source: SourceEdge; low: number; high: number; reverse: boolean };
type PartialEdge = { edge: Edge; links: PartialLink[] };
type AnchorLink = { ring: number; index: number; owner: string; slot: number };
type Target = { original: Vector; outline: Vector; edges: EdgeLink[]; partial: PartialEdge[]; anchors: AnchorLink[] };
const pointBox = (p: Point) => ({ left: p.x, right: p.x, top: p.y, bottom: p.y });
const box = (points: Point[]) => ({
  left: Math.min(...points.map((p) => p.x)),
  right: Math.max(...points.map((p) => p.x)),
  top: Math.min(...points.map((p) => p.y)),
  bottom: Math.max(...points.map((p) => p.y)),
});
function lists(s: Vector): BezierNode[][] {
  return s.contours ?? [s.nodes ?? []];
}
function edges(s: Vector): Edge[] {
  const m = matrix(s),
    result: Edge[] = [];
  let offset = 0;
  lists(s).forEach((nodes, ring) => {
    const count = nodes.length - (s.contours || s.closed ? 0 : 1);
    for (let index = 0; index < count; index++) {
      const end = (index + 1) % nodes.length,
        a = nodes[index],
        b = nodes[end];
      const straight = !a.out && !b.in;
      const u = a.out ?? (straight ? { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 } : a);
      const v =
        b.in ?? (straight ? { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 } : b);
      result.push({
        ring,
        index,
        end,
        slot: offset + index,
        straight,
        curve: [a, u, v, b].map((p) => mapPoint(m, p)) as Cubic,
      });
    }
    offset += nodes.length;
  });
  return result;
}
function straightProgress(a: Point, b: Point, p: Point, equal: (a: Point, b: Point) => boolean) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  if (!Number.isFinite(length) || !length) return;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  if (equal(p, { x: a.x + dx * t, y: a.y + dy * t })) return t;
}
export type AttachedFillEdit = {
  readonly targetIds: readonly string[];
  ownsEdge(owner: string, slot: number): boolean;
  ownsAnchor(owner: string, slot: number): boolean;
  /** Undefined for a free fill anchor; an empty list denotes a subdivided stroke boundary. */
  sourceAnchorsForFill(id: string, slot: number): {owner:string;slot:number}[] | undefined;
  prepare(edited: Vector[]): Vector[];
};

/** Capture actual coincident boundaries in one merge-drawing scope. Object-mode
 * artwork and unrelated groups stay independent. Public IDs/proximity alone do
 * not attach a fill: its edge must match an original cubic or tessellation chord.
 * Preparation always starts from the original fill, retaining anchor counts,
 * other rings, paint and local affine/pivot metadata. No Boolean rebuild/refit. */
export function captureAttachedFillEdit(artwork: Vector[], owners: string[], sharedPaint = false): AttachedFillEdit {
  validateLiveGraphicData(artwork);
  const originals = clone(artwork),
    selected = new Set(owners);
  const sources: SourceEdge[] = [],
    points: { owner: string; slot: number; p: Point }[] = [];
  const originalOwners = new Map<string, Vector>();
  let work = 0;
  const tick = (count = 1) => {
    work += count;
    if (work > 1000000) throw Error('Attached fill boundary work limit reached.');
  };
  for (const s of originals) {
    if (!selected.has(s.id) || s.drawingMode === 'object' || (!s.strokeWidth &&
        (!sharedPaint || s.fillEnabled === false || !(s.contours || s.closed ||
          ['rectangle', 'ellipse', 'polygon'].includes(s.kind))))) continue;
    const outline = editableEdgeOutline(s);
    if (!outline) continue;
    originalOwners.set(s.id, outline);
    for (const edge of edges(outline)) sources.push({ ...edge, owner: s.id });
    lists(outline)
      .flat()
      .forEach((n, slot) => points.push({ owner: s.id, slot, p: mapPoint(matrix(outline), n) }));
  }
  const pieces: Piece[] = [];
  const originalPoints = new Map<string, Map<number, Point>>();
  for (const p of points) {
    const owner = originalPoints.get(p.owner) ?? new Map<number, Point>();
    owner.set(p.slot, p.p);
    originalPoints.set(p.owner, owner);
  }
  for (const source of sources) {
    const c = source.curve;
    if (source.straight) pieces.push({ source, start: 0, end: 1, a: c[0], b: c[3] });
    else for (const tolerance of originalOwners.get(source.owner)!.strokeWidth ? [0.25] : [OVERLAY_CURVE_TOLERANCE, 0.25]) {
      let a = c[0];
      flattenCommands(
        [
          ['M', a.x, a.y],
          ['C', c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y],
        ],
        tolerance,
        (b, trace) => {
          tick();
          pieces.push({ source, start: trace.start, end: trace.end, a, b });
          a = b;
        },
      );
    }
  }
  const sourceIndex = boundsIndex(sources.map((s) => box(s.curve)));
  const pieceIndex = boundsIndex(pieces.map((p) => box([p.a, p.b])));
  const pointIndex = boundsIndex(points.map((p) => pointBox(p.p)));
  const targets: Target[] = [];
  const boundaries = new Map<Vector, (p: Point) => boolean>();
  const contains = (shape: Vector, p: Point) => {
    let probe = boundaries.get(shape);
    if (!probe) {
      const paths = worldPaths(shape, OVERLAY_CURVE_TOLERANCE / 8, () => tick());
      probe = boundaryContains(paths, shape.fillRule === 'evenodd', tick);
      boundaries.set(shape, probe);
    }
    return probe(p);
  };
  const opposedPaint = (source: SourceEdge, target: Vector, seam: Cubic) => {
    const original = originalOwners.get(source.owner)!;
    if (original.strokeWidth) return true;
    const [before, after] = splitCubic(seam, 0.5), center = before[3];
    const x = after[1].x - before[2].x, y = after[1].y - before[2].y, length = Math.hypot(x, y);
    if (!length || !Number.isFinite(length)) return false;
    const scale = Math.min(0.5, length / 3) / length;
    const a = { x: center.x - y * scale, y: center.y + x * scale };
    const b = { x: center.x + y * scale, y: center.y - x * scale };
    const side = contains(original, a);
    return side !== contains(original, b) && side !== contains(target, a) && side === contains(target, b);
  };
  for (const s of originals) {
    if (
      selected.has(s.id) ||
      s.drawingMode === 'object' ||
      s.fillEnabled === false ||
      !(s.contours || s.closed || ['rectangle', 'ellipse', 'polygon'].includes(s.kind))
    )
      continue;
    const outline = editableEdgeOutline(s);
    if (!outline) continue;
    const world = lists(outline)
      .flat()
      .map((n) => mapPoint(matrix(outline), n));
    let scale = 1;
    for (const p of world) scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
    const epsilon = Math.min(1e-7, scale * Number.EPSILON * 64);
    const equal = (a: Point, b: Point) =>
      Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
    const sameGroup = (id: string) =>
      JSON.stringify(originalOwners.get(id)?.groups ?? []) === JSON.stringify(s.groups ?? []);
    const matchInterval = (
      source: Cubic,
      target: Cubic,
      start = 0,
      end = 1,
      depth = 0,
    ): { start: number; end: number } | undefined => {
      tick();
      if (target.every((p, i) => equal(p, source[i]))) return { start, end };
      if (target.every((p, i) => equal(p, source[3 - i]))) return { start: end, end: start };
      if (depth >= 16) return;
      const b = box(source);
      if (
        [target[0], target[3]].some(
          (p) =>
            p.x < b.left - epsilon ||
            p.x > b.right + epsilon ||
            p.y < b.top - epsilon ||
            p.y > b.bottom + epsilon,
        )
      )
        return;
      const [left, right] = splitCubic(source, 0.5),
        mid = (start + end) / 2;
      return (
        matchInterval(left, target, start, mid, depth + 1) ??
        matchInterval(right, target, mid, end, depth + 1)
      );
    };
    const linked: EdgeLink[] = [], partial: PartialEdge[] = [],
      anchors: AnchorLink[] = [];
    lists(outline).forEach((nodes, ring) =>
      nodes.forEach((n, index) => {
        const p = mapPoint(matrix(outline), n);
        for (const j of pointIndex(pointBox(p), epsilon)) {
          tick();
          const source = points[j];
          if (sameGroup(source.owner) && equal(p, source.p))
            anchors.push({ ring, index, owner: source.owner, slot: source.slot });
        }
      }),
    );
    for (const edge of edges(outline)) {
      const c = edge.curve;
      let match: EdgeLink | undefined;
      for (const i of sourceIndex(pointBox(c[0]), epsilon)) {
        tick();
        const source = sources[i];
        if (!sameGroup(source.owner)) continue;
        if (c.every((p, k) => equal(p, source.curve[k])) && opposedPaint(source, s, c)) {
          match = { edge, source, start: 0, end: 1 };
          break;
        }
        if (c.every((p, k) => equal(p, source.curve[3 - k])) && opposedPaint(source, s, c)) {
          match = { edge, source, start: 1, end: 0 };
          break;
        }
        if (!edge.straight && !source.straight) {
          const part = matchInterval(source.curve, c) ?? monotoneInterval(source.curve, c, equal, () => tick());
          if (part && opposedPaint(source, s, c)) {
            match = { edge, source, ...part };
            break;
          }
        }
      }
      if (!match && edge.straight)
        for (const i of pieceIndex(pointBox(c[0]), epsilon)) {
          tick();
          const piece = pieces[i];
          if (!sameGroup(piece.source.owner)) continue;
          const progress = (p: Point) => {
            const dx = piece.b.x - piece.a.x,
              dy = piece.b.y - piece.a.y,
              length = dx * dx + dy * dy;
            if (!Number.isFinite(length) || !length) return;
            const t = ((p.x - piece.a.x) * dx + (p.y - piece.a.y) * dy) / length;
            const clamped = Math.max(0, Math.min(1, t));
            if (!equal(p, { x: piece.a.x + dx * clamped, y: piece.a.y + dy * clamped })) return;
            // Curved chords only own their actual tessellation endpoints. Do not
            // reinterpret an intersection inside a chord as an exact curve point.
            if (!piece.source.straight && t !== 0 && t !== 1) {
              if (equal(p, piece.a)) return 0;
              if (equal(p, piece.b)) return 1;
              return;
            }
            return clamped;
          };
          const a = progress(c[0]),
            b = progress(c[3]);
          if (a !== undefined && b !== undefined && a !== b && opposedPaint(piece.source, s, c)) {
            match = {
              edge,
              source: piece.source,
              start: piece.start + (piece.end - piece.start) * a,
              end: piece.start + (piece.end - piece.start) * b,
            };
            break;
          }
        }
      if (match) linked.push(match);
      else if (sharedPaint) {
        // A shorter source can replace a proven interval inside a longer
        // neighboring edge. Its exterior remains on the original cubic.
        const links: PartialLink[] = [];
        for (const i of sourceIndex(box(c), epsilon)) {
          tick();
          const source = sources[i];
          if (!sameGroup(source.owner) || originalOwners.get(source.owner)!.strokeWidth ||
              source.straight !== edge.straight) continue;
          const start = edge.straight ? straightProgress(c[0], c[3], source.curve[0], equal) : undefined;
          const end = edge.straight ? straightProgress(c[0], c[3], source.curve[3], equal) : undefined;
          const part = edge.straight ? (start === undefined || end === undefined ? undefined : { start, end })
            : monotoneInterval(c, source.curve, equal, () => tick());
          if (!part || part.start === part.end) continue;
          const low = Math.min(part.start, part.end), high = Math.max(part.start, part.end);
          if ((low > 0 || high < 1) && opposedPaint(source, s, source.curve))
            links.push({ source, low, high, reverse: part.start > part.end });
        }
        links.sort((a, b) => a.low - b.low);
        for (let i = 1; i < links.length; i++) {
          if (Math.abs(links[i].low - links[i - 1].high) <= 64 * Number.EPSILON)
            links[i].low = links[i - 1].high;
        }
        if (links.length && links.every((link, i) => link.low < link.high && (!i || link.low >= links[i - 1].high)))
          partial.push({ edge, links });
      }
    }
    const paintAnchors = new Map<string, Set<string>>();
    for (const { source, edge } of [...linked, ...partial.flatMap(({ edge, links }) => links.map(({ source }) => ({ source, edge })))]) {
      if (originalOwners.get(source.owner)!.strokeWidth) continue;
      const slots = paintAnchors.get(source.owner) ?? new Set<string>();
      slots.add(`${edge.ring}:${edge.index}`);
      slots.add(`${edge.ring}:${edge.end}`);
      paintAnchors.set(source.owner, slots);
    }
    const matchedAnchors = anchors.filter(anchor => originalOwners.get(anchor.owner)!.strokeWidth ||
      paintAnchors.get(anchor.owner)?.has(`${anchor.ring}:${anchor.index}`));
    if (linked.length || partial.length || matchedAnchors.length)
      targets.push({ original: s, outline, edges: linked,
        partial: partial.sort((a, b) => b.edge.index - a.edge.index), anchors: matchedAnchors });
  }
  const linkedEdges = new Map<string, Set<number>>();
  const linkedAnchors = new Map<string, Set<number>>();
  const remember = (links: Map<string, Set<number>>, owner: string, slot: number) => {
    let slots = links.get(owner);
    if (!slots) links.set(owner, slots = new Set());
    slots.add(slot);
  };
  for (const target of targets) {
    for (const link of target.edges) remember(linkedEdges, link.source.owner, link.source.slot);
    for (const part of target.partial) for (const link of part.links) remember(linkedEdges, link.source.owner, link.source.slot);
    for (const link of target.anchors) remember(linkedAnchors, link.owner, link.slot);
  }
  return Object.freeze({
    targetIds: Object.freeze(targets.map((target) => target.original.id)),
    ownsEdge: (owner: string, slot: number) => linkedEdges.get(owner)?.has(slot) ?? false,
    ownsAnchor: (owner: string, slot: number) => linkedAnchors.get(owner)?.has(slot) ?? false,
    sourceAnchorsForFill(id: string, slot: number) {
      const target = targets.find(t => t.original.id === id);
      if (!target) return;
      const rings = lists(target.outline);
      for (let ring=0; ring<rings.length; ring++) {
        if (slot >= rings[ring].length) {slot -= rings[ring].length; continue;}
        const links = target.anchors.filter(a => a.ring === ring && a.index === slot);
        if (links.length || target.edges.some(({edge}) => edge.ring === ring && (edge.index === slot || edge.end === slot)))
          return links.map(({owner,slot}) => ({owner,slot}));
        return;
      }
    },
    prepare(edited: Vector[]): Vector[] {
      if (!targets.length) return [];
      const updates = new Map(edited.filter((s) => originalOwners.has(s.id)).map((s) => [s.id, s]));
      validateLiveGraphicData([...updates.values()]);
      const next = new Map<
        string,
        { outline: Vector; edges: Map<number, Edge>; nodes: BezierNode[] }
      >();
      for (const [id, original] of originalOwners) {
        const source = updates.get(id);
        if (!source) throw Error('Attached line changed.');
        const outline = editableEdgeOutline(source);
        if (
          !outline ||
          lists(outline).some((r, i) => r.length !== lists(original)[i]?.length) ||
          lists(outline).length !== lists(original).length
        )
          throw Error('Attached line topology changed.');
        next.set(id, {
          outline,
          edges: new Map(edges(outline).map((e) => [e.slot, e])),
          nodes: lists(outline).flat(),
        });
      }
      const result: Vector[] = [];
      for (const target of targets) {
        const out = clone(target.outline),
          m = matrix(out);
        if (!m.every(Number.isFinite) || Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-10)
          throw Error('Attached fill transform cannot be inverted.');
        const moved = new Map<BezierNode, Point>();
        let changed = false;
        const move = (node: BezierNode, p: Point) => {
          const q = inversePoint(m, p);
          if (!Number.isFinite(q.x) || !Number.isFinite(q.y))
            throw Error('Attached fill exceeds finite geometry.');
          const prior = moved.get(node);
          if (prior && (Math.abs(prior.x - p.x) > 1e-7 || Math.abs(prior.y - p.y) > 1e-7))
            throw Error('Attached boundary edits disagree.');
          if (prior) return;
          moved.set(node, { ...p });
          const dx = q.x - node.x,
            dy = q.y - node.y;
          if (dx || dy) {
            changed = true;
            for (const role of ['in', 'out'] as const)
              if (node[role]) node[role] = { x: node[role]!.x + dx, y: node[role]!.y + dy };
            node.x = q.x;
            node.y = q.y;
          }
        };
        for (const link of target.anchors) {
          const current = next.get(link.owner)!;
          const p = current.nodes[link.slot];
          const oldPoint = originalPoints.get(link.owner)!.get(link.slot)!,
            newPoint = mapPoint(matrix(current.outline), p);
          if (oldPoint.x !== newPoint.x || oldPoint.y !== newPoint.y)
            move(lists(out)[link.ring][link.index], newPoint);
        }
        for (const link of target.edges) {
          const current = next.get(link.source.owner)!.edges.get(link.source.slot)!;
          if (
            current.curve.every(
              (p, i) => p.x === link.source.curve[i].x && p.y === link.source.curve[i].y,
            )
          )
            continue;
          const c = interval(current.curve, link.start, link.end),
            nodes = lists(out)[link.edge.ring];
          move(nodes[link.edge.index], c[0]);
          move(nodes[link.edge.end], c[3]);
          if (current.straight) {
            delete nodes[link.edge.index].out;
            delete nodes[link.edge.end].in;
          } else {
            nodes[link.edge.index].out = inversePoint(m, c[1]);
            nodes[link.edge.end].in = inversePoint(m, c[2]);
          }
          changed = true;
        }
        for (const { edge, links } of target.partial) {
          const current = links.map(link => next.get(link.source.owner)!.edges.get(link.source.slot)!);
          if (current.every((segment, i) => segment.curve.every((p, j) =>
            p.x === links[i].source.curve[j].x && p.y === links[i].source.curve[j].y))) continue;
          const nodes = lists(out)[edge.ring], first = nodes[edge.index], last = nodes[edge.end];
          const sections: { curve: Cubic; straight: boolean; shared: boolean }[] = [];
          let from = 0;
          const addGap = (end: number) => {
            if (end > from) sections.push({ curve: interval(edge.curve, from, end), straight: edge.straight, shared: false });
          };
          for (const [i, link] of links.entries()) {
            addGap(link.low);
            sections.push({ curve: link.reverse ? interval(current[i].curve, 1, 0) : current[i].curve,
              straight: current[i].straight, shared: true });
            from = link.high;
          }
          addGap(1);
          const shifted = (c: Cubic, end: 0 | 3, point: Point) => {
            const handle = end === 0 ? 1 : 2;
            c[handle] = { x: c[handle].x + (point.x - c[end].x), y: c[handle].y + (point.y - c[end].y) };
            c[end] = point;
          };
          for (let i = 1; i < sections.length; i++) {
            const a = sections[i - 1], b = sections[i];
            if (!a.shared) shifted(a.curve, 3, b.curve[0]);
            else if (!b.shared) shifted(b.curve, 0, a.curve[3]);
            else if (Math.hypot(a.curve[3].x - b.curve[0].x, a.curve[3].y - b.curve[0].y) > 1e-7)
              throw Error('Attached boundary edits disagree.');
          }
          const start = sections[0], end = sections.at(-1)!;
          if (start.shared) move(first, start.curve[0]);
          else shifted(start.curve, 0, mapPoint(m, first));
          if (end.shared) move(last, end.curve[3]);
          else shifted(end.curve, 3, mapPoint(m, last));
          const added: BezierNode[] = [];
          let a = first;
          for (const [i, section] of sections.entries()) {
            const b: BezierNode = i === sections.length - 1 ? last : inversePoint(m, section.curve[3]);
            if (i < sections.length - 1) added.push(b);
            if (section.straight) { delete a.out; delete b.in; }
            else { a.out = inversePoint(m, section.curve[1]); b.in = inversePoint(m, section.curve[2]); }
            a = b;
          }
          const nextRing = nodes.slice(0, edge.index + 1).concat(added, nodes.slice(edge.index + 1));
          if (out.contours) out.contours[edge.ring] = nextRing;
          else out.nodes = nextRing;
          changed = true;
        }
        result.push(changed ? out : clone(target.original));
      }
      validateLiveGraphicData(result);
      return result;
    },
  });
}

import { clone, id } from '@splash/document';
import { matrix, mapPoint, inversePoint } from './affine';
import type { Point } from '@splash/document';
import type { Vector, BezierNode } from '@splash/document';
export function moveAnchors(
  target: Vector,
  original: Vector,
  indices: number[],
  dx: number,
  dy: number,
) {
  const nodes = target.contours?.flat() ?? target.nodes ?? target.points;
  const bases = original.contours?.flat() ?? original.nodes ?? original.points;
  for (const i of new Set(indices)) {
    const node = nodes[i] as BezierNode,
      base = bases[i] as BezierNode;
    if (!node || !base) continue;
    node.x = base.x + dx;
    node.y = base.y + dy;
    for (const part of ['in', 'out'] as const)
      if (base[part]) node[part] = { ...base[part], x: base[part]!.x + dx, y: base[part]!.y + dy };
  }
}
/** Drag from the gesture snapshot, preserving the opposite handle's stage-space
 * length. Alt leaves that handle unchanged; endpoints never gain a new handle. */
export function moveTangent(
  target: Vector,
  original: Vector,
  index: number,
  part: 'in' | 'out',
  point: Point,
  independent = false,
) {
  const node = (target.contours?.flat() ?? target.nodes ?? target.points)[index] as BezierNode;
  const base = (original.contours?.flat() ?? original.nodes ?? original.points)[
    index
  ] as BezierNode;
  if (!node || !base || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const opposite = part === 'in' ? 'out' : 'in';
  let other = base[opposite] ? { ...base[opposite] } : undefined;
  if (!independent && other) {
    const m = matrix(original),
      anchor = mapPoint(m, base),
      dragged = mapPoint(m, point),
      prior = mapPoint(m, other);
    const dx = dragged.x - anchor.x,
      dy = dragged.y - anchor.y,
      length = Math.hypot(dx, dy);
    if (length > 1e-9) {
      const radius = Math.hypot(prior.x - anchor.x, prior.y - anchor.y);
      other = inversePoint(m, {
        x: anchor.x - (dx * radius) / length,
        y: anchor.y - (dy * radius) / length,
      });
      if (!Number.isFinite(other.x) || !Number.isFinite(other.y)) return;
    }
  }
  node[part] = { ...point };
  if (other) node[opposite] = other;
  else delete node[opposite];
}

export function deleteAnchors(s: Vector, indices: number[]): boolean {
  const all = s.contours?.flat() ?? s.nodes ?? s.points;
  const selected = new Set(indices.map((i) => all[i]).filter(Boolean));
  const lists = s.contours ?? [s.nodes ?? s.points];
  const minimum = s.contours || s.closed || s.kind === 'polygon' ? 3 : 2;
  if (!selected.size || lists.some((list) => list.filter((p) => !selected.has(p)).length < minimum))
    return false;
  for (const list of lists)
    for (let i = list.length - 1; i >= 0; i--) if (selected.has(list[i])) list.splice(i, 1);
  return true;
}

/** Anchor-only stage-space marquee; tangent handles are not selection targets. */
export function anchorsInBox(s: Vector, a: Point, b: Point): number[] {
  const m = matrix(s);
  return (s.contours?.flat() ?? s.nodes ?? s.points).flatMap((node, index) => {
    const p = mapPoint(m, node);
    return p.x >= Math.min(a.x, b.x) &&
      p.x <= Math.max(a.x, b.x) &&
      p.y >= Math.min(a.y, b.y) &&
      p.y <= Math.max(a.y, b.y)
      ? [index]
      : [];
  });
}

/** Resolve the flat subselection index without crossing compound ring boundaries. */
function anchorList(s: Vector, index: number) {
  if (!Number.isInteger(index) || index < 0) return;
  const lists =
    s.kind === 'polygon' && s.fillRule === 'evenodd'
      ? s.contours
      : s.kind === 'bezier' && s.nodes
        ? [s.nodes]
        : undefined;
  if (!lists) return;
  let offset = 0;
  for (const nodes of lists) {
    if (index < offset + nodes.length)
      return { nodes, index: index - offset, offset, closed: !!s.contours || !!s.closed };
    offset += nodes.length;
  }
}
/** Convert selected anchors without moving anchors or touching other rings. */
export function convertAnchors(s: Vector, indices: number[], mode: 'smooth' | 'corner') {
  for (const selected of new Set(indices)) {
    const list = anchorList(s, selected);
    if (!list || list.nodes.length < 2) continue;
    const { nodes, index, closed } = list;
    const node = nodes[index];
    delete node.in;
    delete node.out;
    if (mode === 'corner') continue;
    const prev = index > 0 ? nodes[index - 1] : closed ? nodes.at(-1) : undefined;
    const next = index + 1 < nodes.length ? nodes[index + 1] : closed ? nodes[0] : undefined;
    let dx = (next ?? node).x - (prev ?? node).x;
    let dy = (next ?? node).y - (prev ?? node).y;
    let length = Math.hypot(dx, dy);
    if (length < 1e-9) {
      dx = (next ?? node).x - node.x;
      dy = (next ?? node).y - node.y;
      length = Math.hypot(dx, dy);
    }
    if (length < 1e-9) continue;
    const ux = dx / length,
      uy = dy / length;
    if (prev) {
      const size = Math.hypot(prev.x - node.x, prev.y - node.y) / 3;
      node.in = { x: node.x - ux * size, y: node.y - uy * size };
    }
    if (next) {
      const size = Math.hypot(next.x - node.x, next.y - node.y) / 3;
      node.out = { x: node.x + ux * size, y: node.y + uy * size };
    }
  }
}

/** De Casteljau split of the outgoing cubic, retaining the exact geometric curve. */
export function insertAnchor(s: Vector, index: number, t = 0.5): number | undefined {
  const list = anchorList(s, index);
  const total = s.contours?.reduce((n, ring) => n + ring.length, 0) ?? s.nodes?.length ?? 0;
  if (
    !list ||
    list.nodes.length < 2 ||
    total >= 100000 ||
    (!list.closed && list.index === list.nodes.length - 1) ||
    !Number.isFinite(t) ||
    t <= 0 ||
    t >= 1
  )
    return;
  const { nodes, offset } = list;
  index = list.index;
  const a = nodes[index],
    b = nodes[(index + 1) % nodes.length];
  const mix = (p: Point, q: Point): Point => ({
    x: p.x + (q.x - p.x) * t,
    y: p.y + (q.y - p.y) * t,
  });
  const p = mix(a, a.out ?? a),
    q = mix(a.out ?? a, b.in ?? b),
    r = mix(b.in ?? b, b);
  const u = mix(p, q),
    v = mix(q, r),
    anchor = mix(u, v);
  a.out = p;
  b.in = r;
  nodes.splice(index + 1, 0, { ...anchor, in: u, out: v });
  return offset + index + 1;
}

/** Open paths split into two objects; closed paths open at the anchor with all segments retained. */
export function splitBezier(s: Vector, index: number): Vector[] | undefined {
  const nodes = s.nodes;
  if (
    s.kind !== 'bezier' ||
    !nodes ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= nodes.length ||
    nodes.length < 2
  )
    return;
  if (s.closed) {
    if (nodes.length >= 100000) return;
    const result = clone(s);
    result.closed = false;
    result.nodes = clone([...nodes.slice(index), ...nodes.slice(0, index), nodes[index]]);
    delete result.nodes[0].in;
    delete result.nodes.at(-1)!.out;
    return [result];
  }
  if (index === 0 || index === nodes.length - 1) return;
  const first = clone(s),
    second = clone(s);
  second.id = id();
  first.nodes = clone(nodes.slice(0, index + 1));
  second.nodes = clone(nodes.slice(index));
  delete first.nodes.at(-1)!.out;
  delete second.nodes[0].in;
  return [first, second];
}

/** Join coincident endpoints of compatible open paths, preserving their local stroke basis. */
export function joinBezier(a: Vector, b: Vector): Vector | undefined {
  if (
    a.kind !== 'bezier' ||
    b.kind !== 'bezier' ||
    a.closed ||
    b.closed ||
    !a.nodes ||
    !b.nodes ||
    a.nodes.length < 2 ||
    b.nodes.length < 2 ||
    a.nodes.length + b.nodes.length - 1 > 100000
  )
    return;
  const ma = matrix(a),
    mb = matrix(b);
  if (ma.slice(0, 4).some((v, i) => Math.abs(v - mb[i]) > 1e-9)) return;
  const style = (s: Vector) =>
    JSON.stringify([
      s.fill.toLowerCase(),
      s.fillEnabled ?? true,
      s.stroke.toLowerCase(),
      s.strokeWidth,
      s.strokeCap ?? 'round',
      s.strokeJoin ?? 'round',
      s.opacity ?? 1,
      s.groups ?? [],
    ]);
  if (style(a) !== style(b) || !!a.gradient !== !!b.gradient) return;
  if (a.gradient && b.gradient) {
    const ga = a.gradient,
      gb = b.gradient;
    if (
      ga.kind !== gb.kind ||
      JSON.stringify(ga.transform ?? [1, 0, 0, 1]) !==
        JSON.stringify(gb.transform ?? [1, 0, 0, 1]) ||
      JSON.stringify(ga.stops.map((s) => [s.offset, s.color.toLowerCase(), s.opacity ?? 1])) !==
        JSON.stringify(gb.stops.map((s) => [s.offset, s.color.toLowerCase(), s.opacity ?? 1]))
    )
      return;
    for (const key of ['from', 'to'] as const) {
      const p = mapPoint(ma, ga[key]),
        q = mapPoint(mb, gb[key]);
      if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) return;
    }
  }
  // Joining keeps the first object's paint. Require the second bitmap to describe
  // the same document-space map, including after independent path normalization.
  if (!!a.bitmap !== !!b.bitmap) return;
  if (a.bitmap && b.bitmap) {
    const pa = a.bitmap,
      pb = b.bitmap;
    if (
      pa.assetId !== pb.assetId ||
      (pa.repeat ?? false) !== (pb.repeat ?? false) ||
      pa.width !== pb.width ||
      pa.height !== pb.height ||
      JSON.stringify(pa.transform ?? [1, 0, 0, 1]) !== JSON.stringify(pb.transform ?? [1, 0, 0, 1])
    )
      return;
    const p = mapPoint(ma, pa),
      q = mapPoint(mb, pb);
    if (!(Math.hypot(p.x - q.x, p.y - q.y) <= 1e-6)) return;
  }
  let pair: [number, number] | undefined;
  for (const i of [a.nodes.length - 1, 0])
    for (const j of [0, b.nodes.length - 1]) {
      const p = mapPoint(ma, a.nodes[i]),
        q = mapPoint(mb, b.nodes[j]);
      if (!pair && Math.hypot(p.x - q.x, p.y - q.y) <= 1e-6) pair = [i, j];
    }
  if (!pair) return;
  const reverse = (nodes: BezierNode[]) =>
    nodes.reverse().map((n) => {
      const incoming = n.in;
      n.in = n.out;
      n.out = incoming;
      return n;
    });
  const result = clone(a);
  let left = result.nodes!,
    right = clone(b.nodes).map((n) => {
      const convert = (p: Point) => ({ ...p, ...inversePoint(ma, mapPoint(mb, p)) });
      return {
        ...convert(n),
        ...(n.in ? { in: convert(n.in) } : {}),
        ...(n.out ? { out: convert(n.out) } : {}),
      };
    });
  if (pair[0] === 0) left = reverse(left);
  if (pair[1] !== 0) right = reverse(right);
  left.at(-1)!.out = right[0].out;
  result.nodes = [...left, ...right.slice(1)];
  return result;
}

/** Inverse De Casteljau for a redundant join. Keep the endpoints and verify the other five
 * split controls in stage space before mutation; arbitrary joins and stationary cusps are rejected. */
export function dissolveAnchor(s: Vector, selected: number): boolean {
  const list = anchorList(s, selected);
  if (!list || list.nodes.length <= (list.closed ? 3 : 2)) return false;
  const { nodes, index, closed } = list;
  if (!closed && (index === 0 || index === nodes.length - 1)) return false;
  const a = nodes[(index + nodes.length - 1) % nodes.length],
    n = nodes[index],
    b = nodes[(index + 1) % nodes.length];
  if (!n.in || !n.out) return false;
  const left = Math.hypot(n.x - n.in.x, n.y - n.in.y),
    right = Math.hypot(n.out.x - n.x, n.out.y - n.y),
    t = left / (left + right);
  if (!Number.isFinite(t) || t < 1e-6 || t > 1 - 1e-6) return false;
  const p = a.out ?? a,
    r = b.in ?? b,
    c1 = { x: a.x + (p.x - a.x) / t, y: a.y + (p.y - a.y) / t },
    c2 = { x: b.x + (r.x - b.x) / (1 - t), y: b.y + (r.y - b.y) / (1 - t) };
  if ([c1.x, c1.y, c2.x, c2.y].some((v) => !Number.isFinite(v) || Math.abs(v) > 100000))
    return false;
  const mix = (u: Point, v: Point): Point => ({
    x: u.x + (v.x - u.x) * t,
    y: u.y + (v.y - u.y) * t,
  });
  const q0 = mix(a, c1),
    q1 = mix(c1, c2),
    q2 = mix(c2, b),
    u = mix(q0, q1),
    v = mix(q1, q2),
    center = mix(u, v);
  const m = matrix(s);
  for (const [actual, expected] of [
    [q0, p],
    [u, n.in],
    [center, n],
    [v, n.out],
    [q2, r],
  ]) {
    // Compare differences without translation to avoid cancellation at large origins.
    const dx = actual.x - expected.x,
      dy = actual.y - expected.y;
    if (!(Math.hypot(m[0] * dx + m[2] * dy, m[1] * dx + m[3] * dy) <= 1e-7)) return false;
  }
  a.out = c1;
  b.in = c2;
  nodes.splice(index, 1);
  return true;
}

/** A detached Pen draft ending at the chosen open endpoint; never mutates artwork. */
export function continueBezier(s: Vector, index: number): Vector | undefined {
  if (
    s.kind !== 'bezier' ||
    s.closed ||
    !s.nodes ||
    s.nodes.length < 2 ||
    (index !== 0 && index !== s.nodes.length - 1)
  )
    return;
  const draft = clone(s);
  if (index === 0)
    draft.nodes = draft.nodes!.reverse().map((n) => {
      const { in: incoming, out: outgoing, ...anchor } = n;
      return {
        ...anchor,
        ...(outgoing ? { in: outgoing } : {}),
        ...(incoming ? { out: incoming } : {}),
      };
    });
  return draft;
}

// Splash Animator's Merge Drawing kernel.
//
// A layer's raw shapes, listed bottom to top, are laid out as one planar map: every outline is cut
// wherever it meets another outline, the cut pieces become the edges of the map, and the map's
// faces are the regions of the drawing. From the map the kernel reads off what the artist sees:
//
//   paint  – each face shows the fill of the topmost shape that covers it. Neighbouring faces of
//            one fill become a single piece unless a visible line runs between them.
//   lines  – an edge shows the line of the topmost shape that strokes it, unless an opaque fill
//            from higher in the stack covers the edge on both sides. Visible edges of one style
//            are chained into runs; a run carries on through its own shape's corners and through
//            smooth joins with matching lines, and stops at crossings.
//
// Precision rules:
//   - Pieces of curves are exact sub-curves of the originals (de Casteljau splits). Nothing is
//     flattened and re-fitted, and stretches of one original segment are stitched back into one
//     curve on the way out, so the artist's anchors are never simplified away.
//   - Crossings found on flat sub-pieces are polished with Newton's method on the real curves.
//   - Points closer than SNAP are welded into one vertex, and edges that run along each other
//     closer than SNAP are one edge that every shape involved owns.
//   - A map whose vertex orderings can't be drawn in the plane (checked with Euler's formula) is
//     re-cut against itself a few times; if it still isn't planar the kernel declines and the
//     caller keeps its artwork as it was.
//
// Styles are plain numbers the caller hands in (equal numbers, equal style). Everything is in one
// shared coordinate space; the kernel knows nothing about documents.
//
// Hot paths work on flat Float64Arrays (eight numbers per cubic) and reusable scratch buffers, so
// a large layer rebuild allocates little besides its results.

/** Points this close (stage units) weld into one vertex, and edges this close are one edge.
 * Crossings are polished with Newton's method, so SNAP only has to absorb rounding. */
export const SNAP = 1 / 1024;
/** Subdivision for crossings stops when control points are this close to the chord. */
const FLAT = 1e-3;
/** Chord tolerance when curves are flattened for areas, containment and sample points. */
const FLAT_FILL = 0.01;
/** Most segments taken at once; beyond it `merge` declines. */
const MAX_SEGMENTS = 20_000;
/** Most candidate segment pairs, and subdivision steps per pair, before `merge` declines. */
const MAX_PAIRS = 4_000_000;
const PAIR_STEPS = 4096;
/** Lines from different shapes join into one run only where they turn less than this (cos 20°). */
const SMOOTH_COS = 0.94;
/** The owner of an edge the map cut again: no item's outline. */
const RECUT = -2;

export type PathCmd =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z'];

export type FillRule = 'nonzero' | 'evenodd';

/** A shape going in: its outline (in the shared space) and its fill and line style numbers. */
export type Item = {
  path: readonly PathCmd[];
  fill?: number;
  fillRule: FillRule;
  stroke?: number;
  /** New or moved artwork: `Merged.untouched` reports what it changes. Without any, every item. */
  seed?: boolean;
  /** An older line laid over the seeds' paint. It divides that paint like any line, and meeting
   * the paint doesn't count as changing it. */
  over?: boolean;
  /** The fill lets what is under it show (translucent, gradient or bitmap paint), so it hides no
   * lines. Fills under it are still covered. */
  seeThrough?: boolean;
};

/** A shape coming out: one region of paint or one run of line. */
export type Piece = {
  style: number;
  path: PathCmd[];
  /** The topmost item it came from. */
  item: number;
  /** Every item whose paint (topmost in a face) or line makes it up. */
  sources: number[];
};

export type Merged = {
  fills: Piece[];
  strokes: Piece[];
  /** Per item: no seed meets it, covers it or is covered by it, and it joins no changed paint, so
   * it would come out as it went in (up to its own points closer than SNAP). Its pieces are still
   * listed; a caller may keep the original shape instead. */
  untouched: boolean[];
  /** Per item: nothing else at all meets, covers, hides or joins it. */
  isolated: boolean[];
  /** Per item: its outline crosses or touches itself somewhere. */
  selfCrossing: boolean[];
};

/** Merges `items` (bottom to top). `undefined` when there is too much to merge at once, or when
 * the map can't be drawn in the plane; the caller then keeps its artwork whole. */
export function merge(items: readonly Item[]): Merged | undefined {
  const segs = collect(items);
  if (!segs) return;
  let cuts = cutAll(segs.list);
  if (!cuts) return;
  let map = weld(segs.list, cuts);
  let faces = map.faces();
  // Welding moves points by up to SNAP. Two pieces that left a crossing nearly along each other
  // can be nudged into crossing again with no vertex there; then the faces aren't the drawing's
  // regions. Cutting the map's own edges against each other again gives such crossings vertices.
  for (let pass = 0; !faces.planar && pass < 3; pass++) {
    const again: Seg[] = map.edges.map((e) => ({
      c: e.c, line: e.line, item: RECUT, strokes: e.strokes.slice(), owners: e.owners.slice(),
      parent: e.src, p0: e.t0, p1: e.t1,
    }));
    cuts = cutAll(again);
    if (!cuts) return;
    map = weld(again, cuts);
    faces = map.faces();
  }
  return faces.planar ? map.read(items, segs, faces) : undefined;
}

// ----- cubic curves as eight numbers ---------------------------------------------------------------

/** A cubic: x0 y0 x1 y1 x2 y2 x3 y3. */
type Bez = Float64Array;
type P = { x: number; y: number };

const bez = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): Bez => {
  const c = new Float64Array(8);
  c[0] = x0; c[1] = y0; c[2] = x1; c[3] = y1; c[4] = x2; c[5] = y2; c[6] = x3; c[7] = y3;
  return c;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

/** A straight segment, with its handles a third of the way along. */
const straight = (ax: number, ay: number, bx: number, by: number): Bez =>
  bez(ax, ay, lerp(ax, bx, 1 / 3), lerp(ay, by, 1 / 3), lerp(ax, bx, 2 / 3), lerp(ay, by, 2 / 3), bx, by);

const flipped = (c: Bez): Bez => bez(c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]);

/** The point at `t`, by de Casteljau: a coordinate all four points share comes out exactly. */
function pointAt(c: Bez, t: number): P {
  const ax = lerp(c[0], c[2], t), ay = lerp(c[1], c[3], t);
  const bx = lerp(c[2], c[4], t), by = lerp(c[3], c[5], t);
  const dx = lerp(c[4], c[6], t), dy = lerp(c[5], c[7], t);
  const ex = lerp(ax, bx, t), ey = lerp(ay, by, t);
  const fx = lerp(bx, dx, t), fy = lerp(by, dy, t);
  return { x: lerp(ex, fx, t), y: lerp(ey, fy, t) };
}

/** Result slots of `evalTo`. */
let ex = 0, ey = 0;

/** `pointAt` without allocating: the point goes to `ex`, `ey`. */
function evalTo(c: Bez, t: number) {
  const ax = lerp(c[0], c[2], t), ay = lerp(c[1], c[3], t);
  const bx = lerp(c[2], c[4], t), by = lerp(c[3], c[5], t);
  const dx = lerp(c[4], c[6], t), dy = lerp(c[5], c[7], t);
  const fx = lerp(bx, dx, t), fy = lerp(by, dy, t);
  const gx = lerp(ax, bx, t), gy = lerp(ay, by, t);
  ex = lerp(gx, fx, t);
  ey = lerp(gy, fy, t);
}

/** Splits `c` at `t` into `left` and `right` (which may be fresh arrays or reused buffers). */
function splitInto(c: Bez, t: number, left: Bez, right: Bez) {
  const x0 = c[0], y0 = c[1], x1 = c[2], y1 = c[3], x2 = c[4], y2 = c[5], x3 = c[6], y3 = c[7];
  const ax = lerp(x0, x1, t), ay = lerp(y0, y1, t);
  const bx = lerp(x1, x2, t), by = lerp(y1, y2, t);
  const dx = lerp(x2, x3, t), dy = lerp(y2, y3, t);
  const ex = lerp(ax, bx, t), ey = lerp(ay, by, t);
  const fx = lerp(bx, dx, t), fy = lerp(by, dy, t);
  const mx = lerp(ex, fx, t), my = lerp(ey, fy, t);
  left[0] = x0; left[1] = y0; left[2] = ax; left[3] = ay; left[4] = ex; left[5] = ey; left[6] = mx; left[7] = my;
  right[0] = mx; right[1] = my; right[2] = fx; right[3] = fy; right[4] = dx; right[5] = dy; right[6] = x3; right[7] = y3;
}

/** The stretch of `c` from `t0` to `t1` (backwards when `t1 < t0`), as a new curve. */
function stretch(c: Bez, t0: number, t1: number): Bez {
  if (t1 < t0) return flipped(stretch(c, t1, t0));
  const out = new Float64Array(8), spare = new Float64Array(8);
  if (t1 >= 1) out.set(c);
  else splitInto(c, t1, out, spare);
  if (t0 <= 0 || t1 <= 0) return out;
  splitInto(out, Math.min(1, Math.max(0, t0 / t1)), spare, out);
  return out;
}

/** `c` with its ends moved to (ax, ay) and (bx, by); the handles move with their ends. */
function pinned(c: Bez, line: boolean, ax: number, ay: number, bx: number, by: number): Bez {
  if (line) return straight(ax, ay, bx, by);
  return bez(ax, ay, c[2] + (ax - c[0]), c[3] + (ay - c[1]), c[4] + (bx - c[6]), c[5] + (by - c[7]), bx, by);
}

/** Bernstein evaluation, for distances (no exactness needed). */
const bx = (c: Bez, t: number) => {
  const m = 1 - t;
  return m * m * m * c[0] + 3 * m * m * t * c[2] + 3 * m * t * t * c[4] + t * t * t * c[6];
};
const by = (c: Bez, t: number) => {
  const m = 1 - t;
  return m * m * m * c[1] + 3 * m * m * t * c[3] + 3 * m * t * t * c[5] + t * t * t * c[7];
};
function dist2At(c: Bez, t: number, px: number, py: number) {
  const x = bx(c, t) - px, y = by(c, t) - py;
  return x * x + y * y;
}

/** Control-polygon length. */
function hull(c: Bez) {
  return len(c[2] - c[0], c[3] - c[1]) + len(c[4] - c[2], c[5] - c[3]) + len(c[6] - c[4], c[7] - c[5]);
}

/** How far the handles stand off the chord. */
function bulge(c: Bez): number {
  const dx = c[6] - c[0], dy = c[7] - c[1];
  const l = len(dx, dy);
  if (l < 1e-12) return Math.max(len(c[2] - c[0], c[3] - c[1]), len(c[4] - c[0], c[5] - c[1]));
  return Math.max(Math.abs(dx * (c[3] - c[1]) - dy * (c[2] - c[0])), Math.abs(dx * (c[5] - c[1]) - dy * (c[4] - c[0]))) / l;
}

/** Total turn of the control polygon (radians). Under half a circle, a cubic can't loop. */
function turn(c: Bez): number {
  let sum = 0, px = 0, py = 0, have = false;
  for (let i = 2; i < 8; i += 2) {
    const dx = c[i] - c[i - 2], dy = c[i + 1] - c[i - 1];
    if (len(dx, dy) <= 1e-12) continue;
    if (have) sum += Math.abs(Math.atan2(px * dy - py * dx, px * dx + py * dy));
    px = dx; py = dy; have = true;
  }
  return sum;
}

/** Appends points along `c` after its start (x, y pairs) within FLAT_FILL of the curve. */
function flatten(c: Bez, line: boolean, out: number[]) {
  if (line) {
    out.push(c[6], c[7]);
    return;
  }
  const dd = Math.max(
    len(c[0] - 2 * c[2] + c[4], c[1] - 2 * c[3] + c[5]),
    len(c[2] - 2 * c[4] + c[6], c[3] - 2 * c[5] + c[7]),
  );
  let n = Math.ceil(Math.sqrt((0.75 * dd) / FLAT_FILL));
  n = Number.isFinite(n) && n >= 1 ? Math.min(256, n) : 1;
  for (let i = 1; i <= n; i++) {
    evalTo(c, i / n);
    out.push(ex, ey);
  }
}

/** Result slots of `closest`. */
let closestT = 0, closestD = 0;

/** The parameter on `c` closest to (px, py) and the distance, in `closestT` and `closestD`:
 * a coarse scan, then Newton's method on the squared distance inside the best interval. */
function closest(c: Bez, line: boolean, px: number, py: number) {
  if (line) {
    const dx = c[6] - c[0], dy = c[7] - c[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 1e-24 ? Math.min(1, Math.max(0, ((px - c[0]) * dx + (py - c[1]) * dy) / l2)) : 0;
    closestT = t;
    closestD = len(c[0] + dx * t - px, c[1] + dy * t - py);
    return;
  }
  const N = 32;
  let bt = 0, bd = Infinity;
  for (let i = 0; i <= N; i++) {
    const d = Math.sqrt(dist2At(c, i / N, px, py));
    if (d < bd) {
      bd = d;
      bt = i / N;
    }
  }
  const lo = Math.max(0, bt - 1 / N), hi = Math.min(1, bt + 1 / N);
  let t = bt;
  {
    // Derivative coefficients: B'(t) = 3[(1−t)²(P1−P0) + 2(1−t)t(P2−P1) + t²(P3−P2)].
    const ax = c[2] - c[0], ay = c[3] - c[1], qx = c[4] - c[2], qy = c[5] - c[3], rx = c[6] - c[4], ry = c[7] - c[5];
    for (let k = 0; k < 10; k++) {
      const m = 1 - t;
      const fx = bx(c, t) - px, fy = by(c, t) - py;
      const d1x = 3 * (m * m * ax + 2 * m * t * qx + t * t * rx), d1y = 3 * (m * m * ay + 2 * m * t * qy + t * t * ry);
      const d2x = 6 * (m * (qx - ax) + t * (rx - qx)), d2y = 6 * (m * (qy - ay) + t * (ry - qy));
      const g = fx * d1x + fy * d1y, h = d1x * d1x + d1y * d1y + fx * d2x + fy * d2y;
      if (!(h > 0)) break;
      const next = Math.min(hi, Math.max(lo, t - g / h));
      const step = Math.abs(next - t);
      t = next;
      if (step < 1e-15) break;
    }
  }
  const d = Math.sqrt(dist2At(c, t, px, py));
  if (d < bd) {
    closestT = t;
    closestD = d;
  } else {
    closestT = bt;
    closestD = bd;
  }
}


// ----- segments going in ---------------------------------------------------------------------------

type Seg = {
  c: Bez;
  line: boolean;
  /** The item whose outline it is (fills are measured from these), or RECUT. */
  item: number;
  /** Items stroking it. */
  strokes: number[];
  /** Items whose outline includes it. */
  owners: number[];
  /** The original curve it is a stretch of (an index into `Collected.originals`), and where. */
  parent: number;
  p0: number;
  p1: number;
};

type Collected = { list: Seg[]; originals: Bez[] };

/** Every segment of every item. A filled subpath left open gets an unstroked closing edge. */
function collect(items: readonly Item[]): Collected | undefined {
  const list: Seg[] = [], originals: Bez[] = [];
  items.forEach((it, item) => {
    if (it.fill === undefined && it.stroke === undefined) return;
    const stroked = it.stroke !== undefined;
    const add = (c: Bez, line: boolean, s: boolean, parent: number, p0: number, p1: number, depth: number) => {
      // Cuts only happen where segments meet each other, so a curve that might loop over itself
      // is halved until each half turns less than half a circle.
      if (!line && depth < 6 && turn(c) > 0.9 * Math.PI) {
        const a = new Float64Array(8), b = new Float64Array(8), pm = 0.5 * (p0 + p1);
        splitInto(c, 0.5, a, b);
        add(a, line, s, parent, p0, pm, depth + 1);
        add(b, line, s, parent, pm, p1, depth + 1);
        return;
      }
      const strokes = s ? [item] : [];
      // A segment ending where it began is halved, so no edge of the map is a loop.
      if (len(c[6] - c[0], c[7] - c[1]) < SNAP && hull(c) > 2 * SNAP) {
        const a = new Float64Array(8), b = new Float64Array(8), pm = 0.5 * (p0 + p1);
        splitInto(c, 0.5, a, b);
        list.push({ c: a, line, item, strokes, owners: [item], parent, p0, p1: pm },
          { c: b, line, item, strokes: strokes.slice(), owners: [item], parent, p0: pm, p1 });
      } else list.push({ c, line, item, strokes, owners: [item], parent, p0, p1 });
    };
    const push = (c: Bez, line: boolean, s: boolean) => {
      for (let i = 0; i < 8; i++) if (!Number.isFinite(c[i])) return;
      if (hull(c) <= 1e-9) return;
      originals.push(c);
      add(c, line, s, originals.length - 1, 0, 1, 0);
    };
    let sx = 0, sy = 0, lx = 0, ly = 0, open = false, drawn = false;
    const close = (s: boolean) => {
      if (lx !== sx || ly !== sy) push(straight(lx, ly, sx, sy), true, s);
    };
    for (const cmd of it.path) {
      if (cmd[0] === 'M') {
        if (open && drawn && it.fill !== undefined) close(false);
        sx = lx = cmd[1];
        sy = ly = cmd[2];
        open = true;
        drawn = false;
      } else if (cmd[0] === 'Z') {
        if (open) close(stroked);
        lx = sx;
        ly = sy;
        open = false;
        drawn = false;
      } else {
        const line = cmd[0] === 'L';
        const c = line ? straight(lx, ly, cmd[1], cmd[2]) : bez(lx, ly, cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]);
        push(c, line, stroked);
        lx = c[6];
        ly = c[7];
        open = true;
        drawn = true;
      }
    }
    if (open && drawn && it.fill !== undefined) close(false);
  });
  return list.length > MAX_SEGMENTS ? undefined : { list, originals };
}

// ----- cutting -------------------------------------------------------------------------------------

/** Bounding boxes, four numbers per curve: min x, min y, max x, max y. */
function boxesOf(segs: readonly Seg[]): Float64Array {
  const b = new Float64Array(segs.length * 4);
  segs.forEach((s, i) => {
    const c = s.c;
    b[4 * i] = Math.min(c[0], c[2], c[4], c[6]);
    b[4 * i + 1] = Math.min(c[1], c[3], c[5], c[7]);
    b[4 * i + 2] = Math.max(c[0], c[2], c[4], c[6]);
    b[4 * i + 3] = Math.max(c[1], c[3], c[5], c[7]);
  });
  return b;
}

/** Where each segment is cut: sorted parameters including 0 and 1. `undefined` when the search
 * runs out of budget (a crossing might be missed, so the merge declines instead). */
function cutAll(segs: readonly Seg[]): number[][] | undefined {
  const cuts: number[][] = segs.map(() => [0, 1]);
  const box = boxesOf(segs);
  // Sweep along x: each segment meets only the ones whose boxes start before its box ends.
  const order = Array.from(segs.keys()).sort((a, b) => box[4 * a] - box[4 * b]);
  let pairs = 0;
  const found: number[] = [];
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const ix1 = box[4 * i + 2] + SNAP, iy0 = box[4 * i + 1] - SNAP, iy1 = box[4 * i + 3] + SNAP;
    for (let m = k + 1; m < order.length; m++) {
      const j = order[m];
      if (box[4 * j] > ix1) break;
      if (box[4 * j + 1] > iy1 || box[4 * j + 3] < iy0 || box[4 * j + 2] < box[4 * i] - SNAP) continue;
      if (++pairs > MAX_PAIRS) return;
      found.length = 0;
      if (!meet(segs[i], segs[j], box, i, j, found)) return;
      for (let h = 0; h < found.length; h += 2) {
        cuts[i].push(found[h]);
        cuts[j].push(found[h + 1]);
      }
    }
  }
  for (const s of cuts) {
    s.sort((a, b) => a - b);
    let w = 0;
    for (let r = 0; r < s.length; r++) if (!w || Math.abs(s[r] - s[w - 1]) >= 1e-12) s[w++] = s[r];
    s.length = w;
  }
  return cuts;
}

/** Whether (px, py) lies more than `pad` outside box `k`. */
function outsideBox(box: Float64Array, k: number, px: number, py: number, pad: number) {
  return px < box[4 * k] - pad || py < box[4 * k + 1] - pad || px > box[4 * k + 2] + pad || py > box[4 * k + 3] + pad;
}

/** Where `p` (an end of another segment) lies on `c`: usually on one of its ends. */
function landOn(c: Bez, line: boolean, px: number, py: number) {
  const d0 = len(c[0] - px, c[1] - py);
  if (d0 < SNAP) {
    closestT = 0;
    closestD = d0;
    return;
  }
  const d1 = len(c[6] - px, c[7] - py);
  if (d1 < SNAP) {
    closestT = 1;
    closestD = d1;
    return;
  }
  closest(c, line, px, py);
}

/** Appends (t on a, t on b) pairs where two segments meet to `out`: crossings, ends lying on the
 * other one, and the ends of a stretch where they run along each other. False when the search
 * ran out of steps. */
function meet(a: Seg, b: Seg, box: Float64Array, ia: number, ib: number, out: number[]): boolean {
  const ends = meetEnds;
  ends.length = 0;
  for (let e = 0; e < 2; e++) {
    const px = a.c[6 * e], py = a.c[6 * e + 1];
    if (outsideBox(box, ib, px, py, SNAP)) continue;
    landOn(b.c, b.line, px, py);
    if (closestD < SNAP) ends.push(e, closestT);
  }
  for (let e = 0; e < 2; e++) {
    const px = b.c[6 * e], py = b.c[6 * e + 1];
    if (outsideBox(box, ia, px, py, SNAP)) continue;
    landOn(a.c, a.line, px, py);
    if (closestD < SNAP) ends.push(closestT, e);
  }
  if (ends.length >= 4 && alongside(a, b, ends)) {
    for (const v of ends) out.push(v);
    return true;
  }
  const hits = meetHits;
  hits.length = 0;
  if (!crossings(a.c, b.c, hits)) return false;
  if (!hits.length && ends.length <= 2) {
    for (const v of ends) out.push(v);
    return true;
  }
  for (let h = 0; h < hits.length; h += 2) polish(a.c, b.c, hits, h);
  // Keep one hit per place along `a`.
  const kept = meetKept;
  kept.length = 0;
  const keep = (s: number, t: number) => {
    evalTo(a.c, s);
    for (let k = 0; k < kept.length; k += 2) if (len(kept[k] - ex, kept[k + 1] - ey) < SNAP) return;
    kept.push(ex, ey);
    out.push(s, t);
  };
  for (let h = 0; h < ends.length; h += 2) keep(ends[h], ends[h + 1]);
  for (let h = 0; h < hits.length; h += 2) keep(hits[h], hits[h + 1]);
  return true;
}

const meetEnds: number[] = [], meetHits: number[] = [], meetKept: number[] = [];

/** Whether `a` runs along `b` between the outermost of its ends that touch `b`. */
function alongside(a: Seg, b: Seg, ends: number[]): boolean {
  let lo = Infinity, hi = -Infinity;
  for (let h = 0; h < ends.length; h += 2) {
    lo = Math.min(lo, ends[h]);
    hi = Math.max(hi, ends[h]);
  }
  const p = pointAt(a.c, lo), q = pointAt(a.c, hi);
  if (len(p.x - q.x, p.y - q.y) < SNAP) return false;
  for (let k = 1; k <= 5; k++) {
    const m = pointAt(a.c, lo + ((hi - lo) * k) / 6);
    closest(b.c, b.line, m.x, m.y);
    if (closestD >= SNAP) return false;
  }
  return true;
}

/** Moves the crossing at `hits[h]`, `hits[h + 1]` onto where the curves really meet (Newton's
 * method on both parameters); leaves it when that doesn't get closer. */
function polish(a: Bez, b: Bez, hits: number[], h: number) {
  const s0 = hits[h], t0 = hits[h + 1];
  const gap = (s: number, t: number) => {
    evalTo(a, s);
    const x = ex, y = ey;
    evalTo(b, t);
    return len(x - ex, y - ey);
  };
  let s = s0, t = t0;
  for (let k = 0; k < 12; k++) {
    const pa = pointAt(a, s), pb = pointAt(b, t);
    const fx = pa.x - pb.x, fy = pa.y - pb.y;
    if (fx * fx + fy * fy < 1e-26) break;
    const ms = 1 - s, mt = 1 - t;
    const dax = 3 * (ms * ms * (a[2] - a[0]) + 2 * ms * s * (a[4] - a[2]) + s * s * (a[6] - a[4]));
    const day = 3 * (ms * ms * (a[3] - a[1]) + 2 * ms * s * (a[5] - a[3]) + s * s * (a[7] - a[5]));
    const dbx = 3 * (mt * mt * (b[2] - b[0]) + 2 * mt * t * (b[4] - b[2]) + t * t * (b[6] - b[4]));
    const dby = 3 * (mt * mt * (b[3] - b[1]) + 2 * mt * t * (b[5] - b[3]) + t * t * (b[7] - b[5]));
    const det = dbx * day - dax * dby;
    if (!(Math.abs(det) > 1e-12)) break;
    const ds = (fx * dby - dbx * fy) / det, dt = (day * fx - dax * fy) / det;
    s = Math.min(1, Math.max(0, s + ds));
    t = Math.min(1, Math.max(0, t + dt));
    if (Math.abs(ds) + Math.abs(dt) < 1e-16) break;
  }
  if (Number.isFinite(s) && Number.isFinite(t) && Math.abs(s - s0) < 0.05 && Math.abs(t - t0) < 0.05 &&
    gap(s, t) <= gap(s0, t0)) {
    hits[h] = s;
    hits[h + 1] = t;
  }
}

const scratchA = new Float64Array(8), scratchB = new Float64Array(8);
const scratchL = new Float64Array(8), scratchR = new Float64Array(8);

/** Frames of the crossing search: curve a (8), its range (2), curve b (8), its range (2), depth. */
const FRAME = 21;
let stack = new Float64Array(FRAME * 128);

/** Crossings of `a` and `b` by subdivision: boxes first, then chords once both pieces are flat.
 * Appends (s, t) pairs to `out`; false when the step budget ran out. Depth first, the lower half
 * of the split curve before the upper. */
function crossings(a: Bez, b: Bez, out: number[]): boolean {
  let steps = PAIR_STEPS, sp: number;
  stack.set(a, 0);
  stack[8] = 0; stack[9] = 1;
  stack.set(b, 10);
  stack[18] = 0; stack[19] = 1;
  stack[20] = 0;
  sp = 1;
  const A = scratchA, B = scratchB, L = scratchL, R = scratchR;
  while (sp > 0) {
    if (steps === 0) return false;
    sp--;
    const f = sp * FRAME;
    for (let i = 0; i < 8; i++) {
      A[i] = stack[f + i];
      B[i] = stack[f + 10 + i];
    }
    const a0 = stack[f + 8], a1 = stack[f + 9], b0 = stack[f + 18], b1 = stack[f + 19], depth = stack[f + 20];
    // Boxes, padded by FLAT.
    const alx = Math.min(A[0], A[2], A[4], A[6]), ahx = Math.max(A[0], A[2], A[4], A[6]);
    const blx = Math.min(B[0], B[2], B[4], B[6]), bhx = Math.max(B[0], B[2], B[4], B[6]);
    if (alx > bhx + FLAT || blx > ahx + FLAT) continue;
    const aly = Math.min(A[1], A[3], A[5], A[7]), ahy = Math.max(A[1], A[3], A[5], A[7]);
    const bly = Math.min(B[1], B[3], B[5], B[7]), bhy = Math.max(B[1], B[3], B[5], B[7]);
    if (aly > bhy + FLAT || bly > ahy + FLAT) continue;
    steps--;
    const fa = bulge(A) <= FLAT, fb = bulge(B) <= FLAT;
    if ((fa && fb) || depth >= 48) {
      chordHit(A, B, a0, a1, b0, b1, out);
      continue;
    }
    const splitA = !fa && (fb || Math.max(ahx - alx, ahy - aly) >= Math.max(bhx - blx, bhy - bly));
    if (splitA) {
      splitInto(A, 0.5, L, R);
      const m = 0.5 * (a0 + a1);
      frame(sp++, R, m, a1, B, b0, b1, depth + 1);
      frame(sp++, L, a0, m, B, b0, b1, depth + 1);
    } else {
      splitInto(B, 0.5, L, R);
      const m = 0.5 * (b0 + b1);
      frame(sp++, A, a0, a1, R, m, b1, depth + 1);
      frame(sp++, A, a0, a1, L, b0, m, depth + 1);
    }
  }
  return steps > 0;
}

function frame(at: number, a: Bez, a0: number, a1: number, b: Bez, b0: number, b1: number, depth: number) {
  if ((at + 1) * FRAME > stack.length) {
    const grown = new Float64Array(stack.length * 2);
    grown.set(stack);
    stack = grown;
  }
  const f = at * FRAME;
  for (let i = 0; i < 8; i++) {
    stack[f + i] = a[i];
    stack[f + 10 + i] = b[i];
  }
  stack[f + 8] = a0;
  stack[f + 9] = a1;
  stack[f + 18] = b0;
  stack[f + 19] = b1;
  stack[f + 20] = depth;
}

/** Where the chords of two flat pieces cross, mapped back to the pieces' parameter ranges. */
function chordHit(A: Bez, B: Bez, a0: number, a1: number, b0: number, b1: number, out: number[]) {
  const rx = A[6] - A[0], ry = A[7] - A[1], sx = B[6] - B[0], sy = B[7] - B[1];
  const d = rx * sy - ry * sx;
  if (Math.abs(d) <= 1e-12 * Math.max(len(rx, ry) * len(sx, sy), 1e-300)) return;
  const qx = B[0] - A[0], qy = B[1] - A[1];
  const t = (qx * sy - qy * sx) / d, u = (qx * ry - qy * rx) / d;
  const E = 1e-9;
  if (t < -E || t > 1 + E || u < -E || u > 1 + E) return;
  out.push(a0 + Math.min(1, Math.max(0, t)) * (a1 - a0), b0 + Math.min(1, Math.max(0, u)) * (b1 - b0));
}

// ----- welding the cut pieces into a map -----------------------------------------------------------

type Edge = {
  c: Bez;
  line: boolean;
  v0: number;
  v1: number;
  /** The original curve it is part of, and where along it. */
  src: number;
  t0: number;
  t1: number;
  strokes: number[];
  owners: number[];
  /** `c` backwards, once something asked for it. */
  back?: Bez;
};

/** What landed in one vertex, to decide where the vertex goes: anchors closer than SNAP meet at
 * their average; a point that falls on the inside of another segment goes there instead, so the
 * segment it lands on stays where it is. */
class Landing {
  onto?: P;
  /** A horizontal or vertical segment through the point keeps that coordinate exactly. */
  x?: number;
  y?: number;
  anchors: P[] = [];
  add(p: P, end: boolean, inside: boolean, c: Bez) {
    if (inside) {
      this.onto ??= p;
      if (c[0] === c[2] && c[2] === c[4] && c[4] === c[6]) this.x ??= c[0];
      if (c[1] === c[3] && c[3] === c[5] && c[5] === c[7]) this.y ??= c[1];
    } else if (end && this.anchors.length < 64 &&
      !this.anchors.some((q) => Math.abs(q.x - p.x) < 1e-9 && len(q.x - p.x, q.y - p.y) < 1e-9)) this.anchors.push(p);
  }
  place(first: P): P {
    if (this.onto) return { x: this.x ?? this.onto.x, y: this.y ?? this.onto.y };
    if (!this.anchors.length) return first;
    let x = 0, y = 0;
    for (const p of this.anchors) {
      x += p.x;
      y += p.y;
    }
    return { x: x / this.anchors.length, y: y / this.anchors.length };
  }
}

/** Vertices by greedy welding: a point joins the closest vertex whose first point is within SNAP.
 * Points are filed in SNAP-sized cells; cells are found by a numeric hash (a collision only adds
 * candidates, which are checked by distance anyway). */
class Welder {
  pts: P[] = [];
  private cells = new Map<number, number[]>();
  private static key(cx: number, cy: number) {
    return (Math.imul(cx | 0, 73856093) ^ Math.imul(cy | 0, 19349663)) | 0;
  }
  at(p: P): number {
    const cx = Math.floor(p.x / SNAP), cy = Math.floor(p.y / SNAP);
    let best = -1, bd = SNAP;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.cells.get(Welder.key(cx + dx, cy + dy));
        if (!list) continue;
        for (const i of list) {
          const q = this.pts[i];
          const d = len(q.x - p.x, q.y - p.y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    if (best >= 0) return best;
    const i = this.pts.push(p) - 1;
    const k = Welder.key(cx, cy), list = this.cells.get(k);
    if (list) list.push(i);
    else this.cells.set(k, [i]);
    return i;
  }
}

function weld(segs: readonly Seg[], cuts: number[][]): PlanarMap {
  const welder = new Welder();
  // Every cut point goes to a vertex first; then each vertex is placed (see Landing) and the
  // pieces are pinned to where their vertices ended up.
  const landings: Landing[] = [];
  const ids: number[][] = [];
  segs.forEach((s, si) => {
    const row: number[] = [];
    for (const t of cuts[si]) {
      const end = t <= 0 || t >= 1;
      const p = t <= 0 ? { x: s.c[0], y: s.c[1] } : t >= 1 ? { x: s.c[6], y: s.c[7] } : pointAt(s.c, t);
      const v = welder.at(p);
      while (landings.length <= v) landings.push(new Landing());
      const inside = !end && len(p.x - s.c[0], p.y - s.c[1]) >= SNAP && len(p.x - s.c[6], p.y - s.c[7]) >= SNAP;
      landings[v].add(p, end, inside, s.c);
      row.push(v);
    }
    ids.push(row);
  });
  const verts = welder.pts.map((p, i) => landings[i].place(p));
  const n = verts.length;
  const edges: Edge[] = [];
  const byEnds = new Map<number, number[]>();
  segs.forEach((s, si) => {
    const ts = cuts[si], row = ids[si];
    for (let w = 0; w + 1 < ts.length; w++) {
      const t0 = ts[w], t1 = ts[w + 1], a = row[w], b = row[w + 1];
      if (a === b) continue; // shorter than SNAP (longer loops were halved when collected)
      const va = verts[a], vb = verts[b];
      const c = pinned(stretch(s.c, t0, t1), s.line, va.x, va.y, vb.x, vb.y);
      const key = Math.min(a, b) * n + Math.max(a, b);
      // Pieces running along each other are one edge, stroked and owned by all of them.
      const list = byEnds.get(key);
      let same: number | undefined;
      if (list) {
        for (const e of list) {
          let along = true;
          for (let k = 1; k <= 3 && along; k++) {
            const p = pointAt(c, k / 4);
            closest(edges[e].c, edges[e].line, p.x, p.y);
            along = closestD < SNAP;
          }
          if (along) {
            same = e;
            break;
          }
        }
      }
      if (same !== undefined) {
        const e = edges[same];
        for (const i of s.strokes) if (!e.strokes.includes(i)) e.strokes.push(i);
        for (const i of s.owners) if (!e.owners.includes(i)) e.owners.push(i);
      } else {
        if (list) list.push(edges.length);
        else byEnds.set(key, [edges.length]);
        edges.push({
          c, line: s.line, v0: a, v1: b, src: s.parent,
          t0: s.p0 + (s.p1 - s.p0) * t0, t1: s.p0 + (s.p1 - s.p0) * t1,
          strokes: s.strokes.slice(), owners: s.owners.slice(),
        });
      }
    }
  });
  return new PlanarMap(verts, edges);
}

// ----- the map -------------------------------------------------------------------------------------

/** One direction of an edge: 2e runs v0 → v1, 2e + 1 runs back. */
type Half = number;

type Faces = {
  faceOfHalf: (number | undefined)[];
  /** A point inside each face. */
  samples: (P | undefined)[];
  /** The halves round each vertex are in an order the plane allows, so faces are regions. */
  planar: boolean;
};

class PlanarMap {
  /** Each vertex's outgoing halves, counter-clockwise. */
  around: Half[][] = [];
  /** Each half's place in its origin's `around`. */
  slot: number[] = [];
  /** Vertices that stay anchors of every piece through them (set by `read`). */
  junction: boolean[] = [];
  faceOfHalf: (number | undefined)[] = [];

  constructor(public verts: P[], public edges: Edge[]) {
    this.order();
  }

  origin(h: Half) {
    const e = this.edges[h >> 1];
    return h & 1 ? e.v1 : e.v0;
  }
  dest(h: Half) {
    const e = this.edges[h >> 1];
    return h & 1 ? e.v0 : e.v1;
  }
  /** The half's curve, in its direction (the backward ones made once, on first use). */
  curve(h: Half): Bez {
    const e = this.edges[h >> 1];
    return h & 1 ? (e.back ??= flipped(e.c)) : e.c;
  }
  /** The next half round the face on `h`'s left. */
  next(h: Half): Half {
    const t = h ^ 1;
    const list = this.around[this.origin(t)];
    return list[(this.slot[t] + list.length - 1) % list.length];
  }

  /** Sorts each vertex's halves by angle, measured where each first reaches a small circle round
   * the vertex (so curves that leave along one tangent still sort by how they bend). */
  private order() {
    const around: Half[][] = this.verts.map(() => []);
    for (let h = 0; h < this.edges.length * 2; h++) around[this.origin(h)].push(h);
    const slot = new Array<number>(this.edges.length * 2).fill(0);
    around.forEach((list, v) => {
      const o = this.verts[v];
      let r = Infinity;
      for (const h of list) r = Math.min(r, reach(this.curve(h), o));
      r *= 0.5;
      const dirs = list.map((h) => {
        if (this.edges[h >> 1].line) {
          const d = this.verts[this.dest(h)];
          return { h, x: d.x - o.x, y: d.y - o.y };
        }
        const p = atRadius(this.curve(h), o, r);
        return { h, x: p.x - o.x, y: p.y - o.y };
      });
      dirs.sort(byAngle);
      around[v] = dirs.map((d) => d.h);
      around[v].forEach((h, i) => (slot[h] = i));
    });
    this.around = around;
    this.slot = slot;
  }

  /** Faces: the cycles of halves, holes assigned to the faces round them, a sample point in each,
   * and whether the map is planar. */
  faces(): Faces {
    const n = this.edges.length * 2;
    const cycleOf = new Int32Array(n).fill(-1);
    const cycles: Half[][] = [];
    for (let h0 = 0; h0 < n; h0++) {
      if (cycleOf[h0] !== -1) continue;
      const cyc: Half[] = [];
      for (let h = h0; cycleOf[h] === -1 && cyc.length <= n; h = this.next(h)) {
        cycleOf[h] = cycles.length;
        cyc.push(h);
      }
      cycles.push(cyc);
    }
    const polys = cycles.map((c) => this.polygon(c));
    const area = polys.map(signedArea);
    const parts = new Dsu(this.verts.length);
    for (const e of this.edges) parts.union(e.v0, e.v1);
    const roots = parts.roots();
    const partOf = cycles.map((c) => (c.length ? roots[this.origin(c[0])] : -1));
    const faceOfCycle: (number | undefined)[] = cycles.map(() => undefined);
    const faces: number[][] = [];
    area.forEach((a, i) => {
      if (a > 0) {
        faceOfCycle[i] = faces.length;
        faces.push([i]);
      }
    });
    // An outer (clockwise) cycle belongs to the smallest face of another part around it.
    const boxes = polys.map(polyBox);
    for (let i = 0; i < cycles.length; i++) {
      if (area[i] > 0 || !cycles[i].length) continue;
      const p = this.verts[this.origin(cycles[i][0])];
      let holder = -1;
      for (let j = 0; j < cycles.length; j++) {
        if (area[j] <= 0 || partOf[j] === partOf[i]) continue;
        const b = boxes[j];
        if (p.x < b[0] || p.x > b[2] || p.y < b[1] || p.y > b[3]) continue;
        if (!insidePoly(polys[j], p.x, p.y)) continue;
        if (holder < 0 || area[j] < area[holder]) holder = j;
      }
      const f = holder >= 0 ? faceOfCycle[holder] : undefined;
      if (f !== undefined) {
        faceOfCycle[i] = f;
        faces[f].push(i);
      }
    }
    const faceOfHalf = Array.from(cycleOf, (c) => faceOfCycle[c]);
    const samples = faces.map((f) => samplePoint(f.map((c) => polys[c])));
    // Euler's formula per connected part: vertices − edges + cycles = 2 exactly when the orders
    // round the vertices describe a drawing in the plane.
    const euler = new Map<number, number>();
    const bump = (r: number, d: number) => euler.set(r, (euler.get(r) ?? 0) + d);
    this.around.forEach((list, v) => {
      if (list.length) bump(roots[v], 1);
    });
    for (const e of this.edges) bump(roots[e.v0], -1);
    for (const c of partOf) bump(c, 1);
    let planar = true;
    for (const x of euler.values()) if (x !== 2) planar = false;
    return { faceOfHalf, samples, planar };
  }

  /** A cycle flattened to points (x, y pairs). */
  polygon(cycle: Half[]): number[] {
    const pts: number[] = [];
    if (cycle.length) {
      const o = this.verts[this.origin(cycle[0])];
      pts.push(o.x, o.y);
    }
    for (const h of cycle) flatten(this.curve(h), this.edges[h >> 1].line, pts);
    return pts;
  }

  /** Reads the drawing off the map: paint pieces, line runs, and what changed. */
  read(items: readonly Item[], segs: Collected, faces: Faces): Merged {
    const { faceOfHalf, samples } = faces;
    this.faceOfHalf = faceOfHalf;
    const face = (h: Half) => faceOfHalf[h];
    const covers = coverage(items, segs.list, samples);
    const regions = covers.regions;
    const over = covers.list;
    const fillOf = (f: number): [number, number] | undefined => {
      const list = over[f];
      const top = list[list.length - 1];
      if (top === undefined) return;
      const style = items[top].fill;
      return style === undefined ? undefined : [style, top];
    };
    // An edge shows its topmost line unless an opaque fill above it covers both its sides.
    const lineOf: (number | undefined)[] = this.edges.map((edge, e) => {
      let z = -1;
      for (const i of edge.strokes) if (i >= 0 && i < items.length && i > z) z = i;
      if (z < 0) return;
      const l = face(2 * e), r = face(2 * e + 1);
      if (l !== undefined && r !== undefined && hides(items, over[l], over[r], (i) => i > z)) return;
      return z;
    });
    // Faces of one fill with no line between them are one region.
    const group = new Dsu(samples.length);
    lineOf.forEach((line, e) => {
      const l = face(2 * e), r = face(2 * e + 1);
      if (line !== undefined || l === undefined || r === undefined || l === r) return;
      const fl = fillOf(l), fr = fillOf(r);
      if (fl && fr && fl[0] === fr[0]) group.union(l, r);
    });
    const roots = group.roots();
    const region = (f: number | undefined) => (f !== undefined && fillOf(f) ? roots[f] : undefined);
    const tops = new Map<number, { style: number; item: number; sources: Set<number> }>();
    samples.forEach((_, f) => {
      const g = region(f), fo = fillOf(f);
      if (g === undefined || !fo) return;
      const t = tops.get(g);
      if (t) {
        t.item = Math.max(t.item, fo[1]);
        t.sources.add(fo[1]);
      } else tops.set(g, { style: fo[0], item: fo[1], sources: new Set([fo[1]]) });
    });
    // Where more than two region borders meet, or three or more visible lines, the vertex is a
    // junction: it stays an anchor of every piece through it, so neighbours share their curves.
    const border = this.edges.map((_, e) => region(face(2 * e)) !== region(face(2 * e + 1)));
    this.junction = this.around.map((list) => {
      let b = 0, l = 0;
      for (const h of list) {
        if (border[h >> 1]) b++;
        if (lineOf[h >> 1] !== undefined) l++;
      }
      return b > 2 || l > 2;
    });
    const out: Merged = {
      fills: [], strokes: [],
      untouched: this.unchanged(items, over, fillOf, lineOf, roots, false, regions),
      isolated: this.unchanged(items, over, fillOf, lineOf, roots, true, regions),
      selfCrossing: items.map(() => false),
    };
    for (const list of this.around) {
      if (list.length <= 2) continue;
      let owner: number | undefined, one = true;
      for (const h of list) for (const i of this.edges[h >> 1].owners) {
        if (owner === undefined) owner = i;
        else if (owner !== i) one = false;
      }
      if (one && owner !== undefined && owner >= 0) out.selfCrossing[owner] = true;
    }
    // Paint: walk each region's boundary loops, stepping past edges inside the region.
    const pieceOf = new Map<number, number>();
    const done = new Uint8Array(this.edges.length * 2);
    for (let h0 = 0; h0 < this.edges.length * 2; h0++) {
      const g = region(face(h0));
      if (g === undefined || done[h0] || region(face(h0 ^ 1)) === g) continue;
      const halves: Half[] = [];
      let h = h0;
      while (!done[h] && halves.length <= done.length) {
        done[h] = 1;
        halves.push(h);
        let nx = this.next(h);
        for (let guard = 0; region(face(nx ^ 1)) === g && guard <= done.length; guard++) nx = this.next(nx ^ 1);
        h = nx;
      }
      const path = this.trace(halves, true, segs.originals);
      const at = pieceOf.get(g);
      if (at !== undefined) out.fills[at].path.push(...path);
      else {
        const t = tops.get(g) ?? { style: 0, item: 0, sources: new Set<number>() };
        pieceOf.set(g, out.fills.length);
        out.fills.push({ style: t.style, path, item: t.item, sources: [...t.sources] });
      }
    }
    this.lines(items, lineOf, segs.originals, out);
    return out;
  }

  /** Per item, whether no seed changes it (see `Merged.untouched`); with `all`, whether nothing
   * else changes it. */
  private unchanged(
    items: readonly Item[], over: number[][], fillOf: (f: number) => [number, number] | undefined,
    lineOf: (number | undefined)[], roots: number[], all: boolean, regions: Coverage[],
  ): boolean[] {
    const anySeed = !all && items.some((it) => it.seed);
    const seed = (i: number) => i >= 0 && i < items.length && (!anySeed || !!items[i].seed);
    const touched = items.map((_, i) => anySeed && seed(i));
    const mark = (i: number) => {
      if (i >= 0 && i < touched.length) touched[i] = true;
    };
    const spared = (i: number) => anySeed && !!items[i]?.over;
    // Items meeting a seed (lines laid over the seeds' paint aren't changed by that).
    const meets = (owners: Iterable<number>) => {
      const list = [...owners];
      if (list.length > 1 && list.some(seed)) for (const i of list) if (!spared(i)) mark(i);
    };
    // Sharing an edge or a vertex with a seed's outline.
    for (const e of this.edges) meets(e.owners);
    for (const list of this.around) {
      const owners = new Set<number>();
      for (const h of list) for (const i of this.edges[h >> 1].owners) owners.add(i);
      meets(owners);
    }
    // Covering a face with a seed, or covered by one.
    for (const c of over) meets(c);
    // Paint that a seed's outline now divides.
    this.edges.forEach((e, k) => {
      if (!e.owners.some(seed)) return;
      const l = this.faceOfHalf[2 * k], r = this.faceOfHalf[2 * k + 1];
      if (l === undefined || r === undefined || l === r) return;
      for (const f of [l, r]) {
        const fo = fillOf(f);
        if (fo && !spared(fo[1])) mark(fo[1]);
      }
    });
    // A line a seed's fill now hides, or that a seed's line now draws over.
    this.edges.forEach((e, k) => {
      const z = lineOf[k];
      const l = this.faceOfHalf[2 * k], r = this.faceOfHalf[2 * k + 1];
      for (const i of e.strokes) {
        if (z === i) continue;
        const hidden = z === undefined && l !== undefined && r !== undefined &&
          hides(items, over[l], over[r], (j) => j > i && seed(j));
        if (hidden || (z !== undefined && seed(z))) mark(i);
      }
    });
    // Joined into one region with changed paint (repeated until nothing more changes).
    const joined = new Map<number, Set<number>>();
    over.forEach((_, f) => {
      const fo = fillOf(f);
      if (!fo) return;
      let set = joined.get(roots[f]);
      if (!set) joined.set(roots[f], (set = new Set()));
      set.add(fo[1]);
    });
    for (let again = true; again; ) {
      again = false;
      for (const set of joined.values()) {
        if (set.size < 2) continue;
        let some = false, every = true;
        for (const i of set) {
          if (touched[i]) some = true;
          else every = false;
        }
        if (!some || every) continue;
        set.forEach(mark);
        again = true;
      }
    }
    // An item too small to leave an edge (a line shorter than SNAP) changes when a seed's fill
    // above it covers it: it goes, like any hidden line.
    const drawn = items.map(() => false);
    for (const e of this.edges) for (const i of e.owners) if (i >= 0) drawn[i] = true;
    items.forEach((it, i) => {
      if (drawn[i] || touched[i] || spared(i)) return;
      const start = it.path.find((c) => c[0] === 'M') as ['M', number, number] | undefined;
      if (!start) return;
      if (regions.some((r, j) => j > i && seed(j) && !items[j].seeThrough && r.covers(start[1], start[2], items[j].fillRule)))
        mark(i);
    });
    return touched.map((t, i) => !t && (items[i].fill !== undefined || items[i].stroke !== undefined));
  }

  /** Visible lines as runs, chained through vertices where exactly two visible pieces of one
   * style meet: always for one item's own corners, smoothly for different items. */
  private lines(items: readonly Item[], lineOf: (number | undefined)[], originals: Bez[], out: Merged) {
    const style = (e: number) => {
      const z = lineOf[e];
      return z === undefined ? undefined : items[z].stroke;
    };
    const shown = this.around.map((l) => l.filter((h) => style(h >> 1) !== undefined));
    // The half the run continues on after `h`, if it continues.
    const carry = (h: Half): Half | undefined => {
      const list = shown[this.dest(h)];
      if (list.length !== 2) return;
      const nx = list[0] === (h ^ 1) ? list[1] : list[1] === (h ^ 1) ? list[0] : undefined;
      if (nx === undefined || nx >> 1 === h >> 1 || style(nx >> 1) !== style(h >> 1)) return;
      if (lineOf[nx >> 1] === lineOf[h >> 1]) return nx;
      const a = endDirection(this.curve(h)), b = startDirection(this.curve(nx));
      return a.x * b.x + a.y * b.y >= SMOOTH_COS * len(a.x, a.y) * len(b.x, b.y) ? nx : undefined;
    };
    const seen = new Uint8Array(this.edges.length);
    for (let e = 0; e < this.edges.length; e++) {
      const st = style(e);
      if (st === undefined || seen[e]) continue;
      // Back up to the start of the run (or once round a loop).
      let start = 2 * e, closed = false;
      for (let steps = 0, p = carry(start ^ 1); p !== undefined; p = carry(start ^ 1)) {
        start = p ^ 1;
        if (start >> 1 === e || ++steps > this.edges.length) {
          closed = start >> 1 === e;
          break;
        }
      }
      const halves: Half[] = [start];
      seen[start >> 1] = 1;
      for (let h = start, nx = carry(h); nx !== undefined && !seen[nx >> 1]; h = nx, nx = carry(h)) {
        seen[nx >> 1] = 1;
        halves.push(nx);
      }
      let item = 0;
      const sources = new Set<number>();
      for (const h of halves) {
        const z = lineOf[h >> 1];
        if (z === undefined) continue;
        if (z > item) item = z;
        sources.add(z);
      }
      out.strokes.push({ style: st, path: this.trace(halves, closed, originals), item, sources: [...sources] });
    }
  }

  /** The path along `halves`, with neighbouring stretches of one original segment stitched back
   * into one curve (never across a junction). */
  private trace(halves: Half[], closed: boolean, originals: Bez[]): PathCmd[] {
    const runs: Run[] = [];
    for (const h of halves) {
      const e = this.edges[h >> 1];
      const run: Run = h & 1
        ? { c: this.curve(h), line: e.line, src: e.src, t0: e.t1, t1: e.t0 }
        : { c: e.c, line: e.line, src: e.src, t0: e.t0, t1: e.t1 };
      const last = runs[runs.length - 1];
      const j = last && !this.junction[this.origin(h)] && stitch(last, run, originals);
      if (j) runs[runs.length - 1] = j;
      else runs.push(run);
    }
    if (closed && runs.length > 1 && halves.length && !this.junction[this.origin(halves[0])]) {
      const j = stitch(runs[runs.length - 1], runs[0], originals);
      if (j) {
        runs[0] = j;
        runs.pop();
      }
    }
    const path: PathCmd[] = [];
    if (runs.length) path.push(['M', runs[0].c[0], runs[0].c[1]]);
    for (const { c, line } of runs) path.push(line ? ['L', c[6], c[7]] : ['C', c[2], c[3], c[4], c[5], c[6], c[7]]);
    if (closed && runs.length) path.push(['Z']);
    return path;
  }
}

/** A stretch of output and the stretch of its original segment it covers. */
type Run = { c: Bez; line: boolean; src: number; t0: number; t1: number };

/** `a` followed by `b` as one run, when `b` carries on along the same original segment. Different
 * originals stay apart even when nearly in line: the merge never simplifies the artist's points. */
function stitch(a: Run, b: Run, originals: Bez[]): Run | undefined {
  if (a.src < 0 || a.src !== b.src || a.t1 !== b.t0 || a.t1 > a.t0 !== b.t1 > b.t0) return;
  const parent = originals[a.src];
  if (!parent) return;
  const c = pinned(stretch(parent, a.t0, b.t1), a.line, a.c[0], a.c[1], b.c[6], b.c[7]);
  return { c, line: a.line, src: a.src, t0: a.t0, t1: b.t1 };
}

/** The direction a curve leaves its start. */
function startDirection(c: Bez): P {
  for (let i = 2; i < 8; i += 2) {
    const x = c[i] - c[0], y = c[i + 1] - c[1];
    if (len(x, y) > 1e-9) return { x, y };
  }
  return { x: 0, y: 0 };
}

/** The direction a curve arrives at its end. */
function endDirection(c: Bez): P {
  for (let i = 4; i >= 0; i -= 2) {
    const x = c[6] - c[i], y = c[7] - c[i + 1];
    if (len(x, y) > 1e-9) return { x, y };
  }
  return { x: 0, y: 0 };
}

/** How far the curve gets from `o` (sampled). */
function reach(c: Bez, o: P): number {
  let r = 0;
  for (let k = 1; k <= 16; k++) {
    evalTo(c, k / 16);
    r = Math.max(r, len(ex - o.x, ey - o.y));
  }
  return r;
}

/** Where the curve, leaving `o`, first gets `r` away from it. */
function atRadius(c: Bez, o: P, r: number): P {
  const N = 32;
  const far = (t: number) => {
    evalTo(c, t);
    return len(ex - o.x, ey - o.y) >= r;
  };
  let prev = 0;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    if (far(t)) {
      let lo = prev, hi = t;
      for (let k = 0; k < 24; k++) {
        const m = 0.5 * (lo + hi);
        if (far(m)) hi = m;
        else lo = m;
      }
      return pointAt(c, hi);
    }
    prev = t;
  }
  return { x: c[6], y: c[7] };
}

/** Counter-clockwise order of directions from +x, exactly (no trigonometry). */
function byAngle(a: P, b: P): number {
  const half = (p: P) => (p.y > 0 || (p.y === 0 && p.x > 0) ? 0 : 1);
  const h = half(a) - half(b);
  if (h) return h;
  const c = a.x * b.y - a.y * b.x;
  return c > 0 ? -1 : c < 0 ? 1 : 0;
}

// ----- areas and containment -----------------------------------------------------------------------

function signedArea(pts: number[]): number {
  const n = pts.length >> 1;
  if (n < 3) return 0;
  // Relative to the first point, so a small ring far from the origin keeps its area.
  const ox = pts[0], oy = pts[1];
  let s = 0;
  for (let i = 1; i + 1 < n; i++)
    s += (pts[2 * i] - ox) * (pts[2 * i + 3] - oy) - (pts[2 * i + 1] - oy) * (pts[2 * i + 2] - ox);
  return s * 0.5;
}

function polyBox(pts: number[]): [number, number, number, number] {
  let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (x < lx) lx = x;
    if (y < ly) ly = y;
    if (x > hx) hx = x;
    if (y > hy) hy = y;
  }
  return [lx, ly, hx, hy];
}

function insidePoly(pts: number[], px: number, py: number): boolean {
  let c = false;
  const n = pts.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ay = pts[j + 1], byy = pts[i + 1];
    if (ay > py !== byy > py && px < pts[j] + ((py - ay) * (pts[i] - pts[j])) / (byy - ay)) c = !c;
  }
  return c;
}

/** A point well inside the region the polygons bound (even-odd): the middle of the widest span on
 * one of nine horizontal lines across it. */
function samplePoint(polys: number[][]): P | undefined {
  let lo = Infinity, hi = -Infinity;
  for (const pts of polys)
    for (let i = 1; i < pts.length; i += 2) {
      if (pts[i] < lo) lo = pts[i];
      if (pts[i] > hi) hi = pts[i];
    }
  let best: P | undefined, widest = 0;
  const xs: number[] = [];
  for (let k = 1; k <= 9; k++) {
    const y = lo + ((hi - lo) * k) / 10;
    xs.length = 0;
    for (const pts of polys) {
      const n = pts.length;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const ay = pts[j + 1], byy = pts[i + 1];
        if (ay > y !== byy > y) xs.push(pts[j] + ((y - ay) * (pts[i] - pts[j])) / (byy - ay));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (w > 1e-6 && w > widest) {
        widest = w;
        best = { x: 0.5 * (xs[i] + xs[i + 1]), y };
      }
    }
  }
  return best;
}

/** Whether an opaque fill passing `ok` covers both sides of an edge (`l` and `r`: the fills over
 * the faces on either side, bottom to top). */
function hides(items: readonly Item[], l: number[], r: number[], ok: (i: number) => boolean): boolean {
  for (const i of l) if (ok(i) && !items[i].seeThrough && r.includes(i)) return true;
  return false;
}

/** For each face sample, the filled items covering it (bottom to top). */
function coverage(items: readonly Item[], segs: readonly Seg[], samples: (P | undefined)[]) {
  const byItem: Seg[][] = items.map(() => []);
  for (const s of segs) if (s.item >= 0 && s.item < items.length) byItem[s.item].push(s);
  const regions = items.map((it, i) => new Coverage(byItem[i], it.fill !== undefined));
  // Only items whose bounds hold a sample can cover it: file the filled ones in a coarse grid.
  const filled = regions.flatMap((r, i) => (r.count ? [i] : []));
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
  for (const i of filled) {
    const r = regions[i];
    gx0 = Math.min(gx0, r.lx);
    gy0 = Math.min(gy0, r.ly);
    gx1 = Math.max(gx1, r.hx);
    gy1 = Math.max(gy1, r.hy);
  }
  const g = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(filled.length))));
  const cw = Math.max((gx1 - gx0) / g, 1e-300), ch = Math.max((gy1 - gy0) / g, 1e-300);
  const cell = (v: number, o: number, w: number) => Math.min(g - 1, Math.max(0, Math.floor((v - o) / w) || 0));
  const grid: number[][] = Array.from({ length: g * g }, () => []);
  for (const i of filled) {
    const r = regions[i];
    for (let cy = cell(r.ly, gy0, ch); cy <= cell(r.hy, gy0, ch); cy++)
      for (let cx = cell(r.lx, gx0, cw); cx <= cell(r.hx, gx0, cw); cx++) grid[cy * g + cx].push(i);
  }
  const list = samples.map((s) => {
    if (!s || !filled.length) return [];
    const out: number[] = [];
    for (const i of grid[cell(s.y, gy0, ch) * g + cell(s.x, gx0, cw)])
      if (regions[i].covers(s.x, s.y, items[i].fillRule)) out.push(i);
    return out.sort((a, b) => a - b);
  });
  return { list, regions };
}

/** One item's fill outline, flattened into runs filed by horizontal band, for winding tests. */
class Coverage {
  lx = Infinity;
  ly = Infinity;
  hx = -Infinity;
  hy = -Infinity;
  count = 0;
  private bands: number[][] = [];
  private band = 1;
  constructor(segs: readonly Seg[], filled: boolean) {
    if (!filled) return;
    const lines: number[] = [];
    const pts: number[] = [];
    for (const s of segs) {
      const c = s.c;
      pts.length = 0;
      pts.push(c[0], c[1]);
      flatten(c, s.line, pts);
      for (let i = 2; i < pts.length; i += 2) lines.push(pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
      this.lx = Math.min(this.lx, c[0], c[2], c[4], c[6]);
      this.ly = Math.min(this.ly, c[1], c[3], c[5], c[7]);
      this.hx = Math.max(this.hx, c[0], c[2], c[4], c[6]);
      this.hy = Math.max(this.hy, c[1], c[3], c[5], c[7]);
    }
    this.count = lines.length / 4;
    if (!this.count) return;
    // About eight runs a band, so a test reads only the runs near its height.
    const n = Math.max(1, Math.min(4096, Math.ceil(this.count / 8)));
    this.band = Math.max((this.hy - this.ly) / n, 1e-300);
    this.bands = Array.from({ length: n }, () => []);
    for (let k = 0; k < lines.length; k += 4) {
      const b0 = this.bandOf(Math.min(lines[k + 1], lines[k + 3])), b1 = this.bandOf(Math.max(lines[k + 1], lines[k + 3]));
      for (let b = b0; b <= b1; b++) this.bands[b].push(lines[k], lines[k + 1], lines[k + 2], lines[k + 3]);
    }
  }
  private bandOf(y: number): number {
    const b = Math.floor((y - this.ly) / this.band);
    return Math.min(this.bands.length - 1, Math.max(0, Number.isFinite(b) ? b : 0));
  }
  covers(px: number, py: number, rule: FillRule): boolean {
    if (!this.count || px < this.lx || px > this.hx || py < this.ly || py > this.hy) return false;
    let w = 0;
    const list = this.bands[this.bandOf(py)];
    for (let k = 0; k < list.length; k += 4) {
      const ax = list[k], ay = list[k + 1], bx2 = list[k + 2], by2 = list[k + 3];
      const side = (bx2 - ax) * (py - ay) - (by2 - ay) * (px - ax);
      if (ay <= py) {
        if (by2 > py && side > 0) w++;
      } else if (by2 <= py && side < 0) w--;
    }
    return rule === 'nonzero' ? w !== 0 : w % 2 !== 0;
  }
}

/** Union-find with path halving; the smaller index becomes the root. */
class Dsu {
  private p: Int32Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(i: number): number {
    const p = this.p;
    while (p[i] !== i) {
      p[i] = p[p[i]];
      i = p[i];
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  roots(): number[] {
    return Array.from(this.p, (_, i) => this.find(i));
  }
}

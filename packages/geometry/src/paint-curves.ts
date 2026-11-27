import { clone, type BezierNode, type Point, type Vector } from '@splash/document';
import { validateDetachedLiveGraphicData, validateLiveGraphicData } from '../../document/src/live-motion';
import { inversePoint, mapPoint, matrix } from './affine';
import { boundsIndex, type Bounds } from './bounds-index';
import { certifyCompoundContours } from './compound-fit';
import { splitCubic, type Cubic } from './curve-fit';
import { pathCommands, worldPaths } from './drawing';

type Span = { source: Vector; curve: Cubic; samples: Point[]; times: number[] };
type Match = {
  start: number;
  length: number;
  curve: Cubic;
  span: Span;
  direction: number;
  index: number;
};
type Plan = { path: Point[]; matches: Match[] };
const matchInterval = (
  span: Span,
  direction: number,
  index: number,
  start: number,
  length: number,
): Match => {
  const from = span.times[Math.min(index, index + direction * length)],
    to = span.times[Math.max(index, index + direction * length)];
  let curve = to === 1 ? span.curve : splitCubic(span.curve, to)[0];
  if (from) curve = splitCubic(curve, from / to)[1];
  if (direction < 0) curve = [...curve].reverse() as Cubic;
  return { start, length, curve, span, direction, index };
};
const placedCurve = (path: Point[], match: Match): Cubic => {
  const a = path[match.start],
    b = path[(match.start + match.length) % path.length],
    c = match.curve;
  return [
    a,
    { x: a.x + (c[1].x - c[0].x), y: a.y + (c[1].y - c[0].y) },
    { x: b.x + (c[2].x - c[3].x), y: b.y + (c[2].y - c[3].y) },
    b,
  ];
};
const pointBounds = (p: Point) => ({ left: p.x, right: p.x, top: p.y, bottom: p.y });

/** Boolean paint merging tessellates curves. Restore original cubic
 * intervals whose EVERY tessellated edge survived, in either orientation.
 * Cut edges and intersections stay exact polygon edges. This never refits or
 * smooths earlier artwork. Uncertain geometry stays complete; contacting output
 * groups retain their original common boundaries. */
export function restorePaintCurves(
  merged: Vector[],
  sources: Vector[],
  admit?: (piece: Vector, source: Vector, placed: Cubic) => boolean,
  traceTolerance?: (source: Vector) => number,
): Vector[] {
  return restoreCurves(merged, sources, admit, false, traceTolerance);
}

/** Detached Brush worker inputs have no caller-owned admission callback. */
export function restoreWorkerPaintCurves(merged: Vector[], sources: Vector[]): Vector[] {
  return restoreCurves(merged, sources, undefined, true);
}

/** Bucket enclosures can take their contour from a stroke centerline. */
export function restoreBucketCurves(faces: Vector[], sources: Vector[]): Vector[] {
  return restoreCurves(faces, sources, undefined, false, undefined, true);
}

function restoreCurves(
  merged: Vector[], sources: Vector[],
  admit: ((piece: Vector, source: Vector, placed: Cubic) => boolean) | undefined,
  detached: boolean,
  traceTolerance?: (source: Vector) => number, includeInk = false,
): Vector[] {
  const validate = detached ? validateDetachedLiveGraphicData : validateLiveGraphicData;
  validate([merged, sources]);
  const hasCallbacks = !!(admit || traceTolerance);
  const original = detached ? undefined : clone(merged);
  const fallback = () => original ?? clone(merged);
  // Restoration replaces whole results and never edits their source records.
  // Reuse the private fallback copy when no caller callback can change a root.
  const copy = (source: Vector, index: number) => !hasCallbacks && original ? original[index] : clone(source);
  try {
    const spans: Span[] = [];
    let work = 0;
    const tick = () => {
      if (++work > 200000) throw Error('Paint curve restoration work limit reached');
    };
    for (const s of sources) {
      // Native rounded rectangles/ellipses own the same exact cubic commands as
      // authored contours. Their fill and stroke are separated by the merger.
      if (
        (s.fillEnabled === false && !(includeInk && s.strokeWidth)) ||
        (!s.contours && s.kind !== 'rectangle' && s.kind !== 'ellipse' && !(s.kind === 'bezier' && (s.closed || includeInk))) ||
        // Plain closed contours can only emit line commands and have no trace
        // samples to contribute to restoration.
        (!traceTolerance && s.kind !== 'symbol' && s.contours && !s.contours.some(ring => ring.some(node => node.in || node.out)))
      )
        continue;
      const found = new Map<Cubic, Span>();
      worldPaths(s, traceTolerance?.(s) ?? 0.25, (end, trace) => {
        tick();
        let span = found.get(trace.curve);
        if (!span) {
          span = { source: s, curve: trace.curve, samples: [trace.curve[0]], times: [trace.start] };
          found.set(trace.curve, span);
        }
        span.samples.push(end);
        span.times.push(trace.end);
      });
      // Even a single surviving edge owns an original cubic. Dropping those
      // handles would change small old curves during an unrelated merge.
      spans.push(...[...found.values()].filter((s) => s.samples.length > 1));
    }
    if (!spans.length) return fallback();
    const entries = spans.flatMap((span) =>
      span.samples.flatMap((p, index) => [
        ...(index < span.samples.length - 1 ? [{ span, direction: 1, index, p }] : []),
        ...(index > 0 ? [{ span, direction: -1, index, p }] : []),
      ]),
    );
    const lookup = boundsIndex(entries.map((e) => pointBounds(e.p)));
    // Stage exact surviving intervals first. Overlapping bounds alone do not
    // imply shared paint boundaries; complete neighbouring groups certify below.
    if (merged.some((s) => s.kind === 'text')) return fallback();
    const paintBounds = (s: Vector) => {
      const m = matrix(s),
        b = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      for (const c of pathCommands(s)) {
        const points =
          c[0] === 'Z'
            ? []
            : c[0] === 'C'
              ? [
                  { x: c[1], y: c[2] },
                  { x: c[3], y: c[4] },
                  { x: c[5], y: c[6] },
                ]
              : [{ x: c[1], y: c[2] }];
        for (const p of points) {
          const q = mapPoint(m, p);
          b.left = Math.min(b.left, q.x);
          b.right = Math.max(b.right, q.x);
          b.top = Math.min(b.top, q.y);
          b.bottom = Math.max(b.bottom, q.y);
        }
      }
      const padding = s.strokeWidth * 2 * Math.hypot(m[0], m[1], m[2], m[3]) + 0.5;
      return {
        left: b.left - padding,
        right: b.right + padding,
        top: b.top - padding,
        bottom: b.bottom + padding,
      };
    };
    const boxes = merged.map(paintBounds),
      changed = new Set<number>(),
      uncertain = new Set<number>(),
      plans = new Map<number, Plan[]>();
    const result = merged.map((s, shapeIndex) => {
      if (
        s.kind !== 'polygon' ||
        s.strokeWidth ||
        !s.contours ||
        s.fillRule !== 'evenodd' ||
        s.contours.some((r) => r.some((n) => n.in || n.out))
      )
        return copy(s, shapeIndex);
      const paths = worldPaths(s, 0.25).map((r) => r.slice(0, -1));
      let scale = 1;
      for (const ring of paths)
        for (const point of ring) scale = Math.max(scale, Math.abs(point.x), Math.abs(point.y));
      // Large document origins must never turn matching into geometric snapping.
      const epsilon = Math.min(1e-8, scale * Number.EPSILON * 64);
      const equal = (a: Point, b: Point) =>
        Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
      const planned: Plan[] = [];
      for (const path of paths) {
        const matches: Match[] = [];
        for (let i = 0; i < path.length; i++) {
          for (const j of lookup(pointBounds(path[i]), epsilon)) {
            tick();
            const { span, direction, index } = entries[j];
            // Only start a maximal surviving run. Rechecking every suffix is
            // quadratic in the samples of an unchanged long original cubic.
            const previous = span.samples[index - direction];
            if (previous && equal(path[(i + path.length - 1) % path.length], previous)) continue;
            let length = 0;
            for (let k = 0; k <= path.length; k++) {
              tick();
              const sample = span.samples[index + direction * k];
              if (!sample || !equal(path[(i + k) % path.length], sample)) break;
              length = k;
            }
            if (length < 1) continue;
            const match = matchInterval(span, direction, index, i, length);
            if (!admit || admit(s, span.source, placedCurve(path, match))) matches.push(match);
          }
        }
        const occupied = new Set<number>();
        const selected = new Map<number, Match>();
        for (const m of matches.sort((a, b) => b.length - a.length || a.start - b.start)) {
          const edges = Array.from({ length: m.length }, (_, k) => (m.start + k) % path.length);
          if (edges.some((k) => occupied.has(k))) continue;
          edges.forEach((k) => occupied.add(k));
          selected.set(m.start, m);
        }
        planned.push({ path, matches: [...selected.values()] });
      }
      plans.set(shapeIndex, planned);
      try {
        return restore(s, shapeIndex, planned, () => changed.add(shapeIndex));
      } catch (error) {
        // An uncertain local region must not flatten unrelated old artwork.
        // Exhausting the shared work budget still rejects the whole attempt.
        if (work > 200000) throw error;
        uncertain.add(shapeIndex);
        return copy(s, shapeIndex);
      }
    });
    function restore(
      s: Vector,
      shapeIndex: number,
      planned: Plan[],
      onChange = () => {},
      keepOriginalAnchors = false,
      localProof = false,
    ) {
      const curves: Cubic[][] = [],
        nodes: BezierNode[][] = [];
      let restored = 0;
      for (const { path, matches } of planned) {
        const selected = new Map(matches.map((m) => [m.start, m]));
        // Begin at a span boundary so a seam-spanning match is never truncated.
        const start = selected.keys().next().value ?? 0;
        const ringCurves: Cubic[] = [];
        const ringNodes: BezierNode[] = [];
        for (let offset = 0; offset < path.length;) {
          const i = (start + offset) % path.length,
            match = selected.get(i);
          const a = path[i],
            b = path[(i + (match?.length ?? 1)) % path.length];
          const c: Cubic = match
            ? placedCurve(path, match)
            : [
                a,
                { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
                { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 },
                b,
              ];
          ringCurves.push(c);
          ringNodes.push({ ...a, ...(match ? { out: c[1] } : {}) });
          offset += match?.length ?? 1;
          if (match) restored++;
        }
        ringNodes.forEach((n, i) => {
          const previous = ringCurves[(i + ringCurves.length - 1) % ringCurves.length];
          const p = ringNodes[(i + ringNodes.length - 1) % ringNodes.length];
          if (p.out) n.in = previous[2];
        });
        curves.push(ringCurves);
        nodes.push(ringNodes);
      }
      if (!restored) return copy(s, shapeIndex);
      if (!localProof)
        certifyCompoundContours(
          planned.map((r) => r.path),
          curves,
          0.25,
          0,
          true,
        );
      const m = matrix(s);
      if (!m.every(Number.isFinite) || Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-10) return copy(s, shapeIndex);
      const local = (p: Point) => inversePoint(m, p);
      const originalAnchors = new Map<string, Point>();
      if (keepOriginalAnchors)
        for (const ring of s.contours!)
          for (const n of ring) {
            const p = mapPoint(m, n);
            originalAnchors.set(`${p.x},${p.y}`, { x: n.x, y: n.y });
          }
      onChange();
      return {
        ...copy(s, shapeIndex),
        contours: nodes.map((r) =>
          r.map((n) => ({
            ...(originalAnchors.get(`${n.x},${n.y}`) ?? local(n)),
            ...(n.in ? { in: local(n.in) } : {}),
            ...(n.out ? { out: local(n.out) } : {}),
          })),
        ),
      };
    }
    // A separate proof must consider all proposed neighbours together: proving
    // A against old B and B against old A could miss a newly introduced contact.
    // Union original/candidate control bounds also catches handles reaching past
    // the old polygon hull. Unsupported/contacting groups retain their originals.
    if (changed.size || uncertain.size) {
      const proofBoxes = result.map((s, i) => {
        const original = boxes[i];
        const candidate = !hasCallbacks && !changed.has(i) ? original : paintBounds(s);
        const box = {
          left: Math.min(candidate.left, original.left),
          right: Math.max(candidate.right, original.right),
          top: Math.min(candidate.top, original.top),
          bottom: Math.max(candidate.bottom, original.bottom),
        };
        // Failed whole-region proofs can still have safe local intervals. Their
        // proposed control hulls must participate in neighbour discovery too.
        for (const plan of plans.get(i) ?? [])
          for (const match of plan.matches)
            for (const p of placedCurve(plan.path, match)) {
              tick();
              box.left = Math.min(box.left, p.x);
              box.right = Math.max(box.right, p.x);
              box.top = Math.min(box.top, p.y);
              box.bottom = Math.max(box.bottom, p.y);
            }
        return box;
      });
      const neighbours = boundsIndex(proofBoxes),
        seen = new Set<number>();
      // A restored outline may coincide with a restored fill boundary. It is
      // the same locus, not a foreign obstacle: include the fill in the joint
      // proof and omit only outlines proven coincident with, strictly away from,
      // or joined solely at a common endpoint to EVERY replacement patch.
      // Unresolved outlines remain obstacles and keep the old fallback.
      const boundary = (s: Vector): Cubic[] => {
        const curves: Cubic[] = [],
          m = matrix(s);
        let from: Point | undefined, first: Point | undefined;
        const at = (x: number, y: number) => mapPoint(m, { x, y });
        const line = (a: Point, b: Point): Cubic => [
          a,
          { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
          { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 },
          b,
        ];
        for (const c of pathCommands(s)) {
          tick();
          if (c[0] === 'M') {
            from = first = at(c[1], c[2]);
            continue;
          }
          if (!from) continue;
          if (c[0] === 'C') {
            const to = at(c[5], c[6]);
            curves.push([from, at(c[1], c[2]), at(c[3], c[4]), to]);
            from = to;
          } else {
            const to = c[0] === 'L' ? at(c[1], c[2]) : first!;
            if (from.x !== to.x || from.y !== to.y) curves.push(line(from, to));
            from = to;
          }
        }
        return curves;
      };
      const curveBox = (curve: Cubic) => {
        const [a, b, c, d] = curve;
        const left = Math.min(a.x, b.x, c.x, d.x), right = Math.max(a.x, b.x, c.x, d.x);
        const top = Math.min(a.y, b.y, c.y, d.y), bottom = Math.max(a.y, b.y, c.y, d.y);
        return { left, right, top, bottom,
          scale: Math.max(1, Math.abs(left), Math.abs(right), Math.abs(top), Math.abs(bottom)) };
      };
      const separated = (a: Bounds, b: Bounds, margin: number) =>
        a.right < b.left - margin || b.right < a.left - margin ||
        a.bottom < b.top - margin || b.bottom < a.top - margin;
      const fillBoundaries = new Map<number, { curve: Cubic; box: ReturnType<typeof curveBox> }[]>();
      const coveredOutline = new Set<number>();
      for (const [i, s] of result.entries()) {
        if (!s.strokeWidth || s.fillEnabled !== false || s.kind !== 'bezier') continue;
        const candidates = neighbours(proofBoxes[i]).filter((j) => changed.has(j));
        if (!candidates.length) continue;
        const borders = candidates.flatMap((j) => {
          if (!fillBoundaries.has(j))
            fillBoundaries.set(j, boundary(result[j]).map(curve => ({ curve, box: curveBox(curve) })));
          return fillBoundaries.get(j)!;
        });
        const strokes = boundary(s);
        if (
          strokes.length &&
          strokes.every((a) => {
            const aBounds = curveBox(a);
            return borders.every(({ curve: b, box: bBounds }) => {
              tick();
              // Even at the maximum existing numeric margin, disjoint control
              // hulls already prove this stroke cannot meet the restored arc.
              if (separated(aBounds, bBounds, 1e-8)) return true;
              const scale = Math.max(aBounds.scale, bBounds.scale);
              const epsilon = Math.min(1e-8, scale * Number.EPSILON * 64);
              const equal = (p: Point, q: Point) =>
                Math.abs(p.x - q.x) <= epsilon && Math.abs(p.y - q.y) <= epsilon;
              if (a.every((p, k) => equal(p, b[k])) || a.every((p, k) => equal(p, b[3 - k])))
                return true;
              const straight = (c: Cubic) => {
                const dx = c[3].x - c[0].x,
                  dy = c[3].y - c[0].y,
                  length = Math.hypot(dx, dy);
                return (
                  length > 0 &&
                  c.every(
                    (p) => Math.abs((p.x - c[0].x) * dy - (p.y - c[0].y) * dx) <= epsilon * length,
                  )
                );
              };
              // Straight boundaries do not move. Every curved boundary must either
              // coincide with this outline span or have a disjoint control hull.
              // The hull contains both the old tessellation and the restored arc.
              if (straight(b)) return true;
              for (const anchor of [a[0], a[3]]) {
                if (!equal(anchor, b[0]) && !equal(anchor, b[3])) continue;
                const incoming = a
                  .filter((p) => !equal(p, anchor))
                  .map((p) => ({ x: anchor.x - p.x, y: anchor.y - p.y }));
                const outgoing = b
                  .filter((p) => !equal(p, anchor))
                  .map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y }));
                for (const u of incoming)
                  for (const v of outgoing) {
                    tick();
                    const lu = Math.hypot(u.x, u.y),
                      lv = Math.hypot(v.x, v.y);
                    if (!lu || !lv || !Number.isFinite(lu + lv)) continue;
                    const x = u.x / lu + v.x / lv,
                      y = u.y / lu + v.y / lv;
                    const side = (p: Point) => {
                      tick();
                      return p.x * x + p.y * y > epsilon;
                    };
                    if (incoming.every(side) && outgoing.every(side)) return true;
                  }
              }
              if (separated(aBounds, bBounds, epsilon)) return true;
              // Rotated or opposite quarter-arcs can have overlapping boxes
              // while their convex control hulls are strictly separated.
              for (const set of [a, b])
                for (let i = 0; i < 4; i++)
                  for (let j = i + 1; j < 4; j++) {
                    tick();
                    const dx = set[j].x - set[i].x,
                      dy = set[j].y - set[i].y,
                      length = Math.hypot(dx, dy);
                    if (!length || !Number.isFinite(length)) continue;
                    const project = (p: Point) => {
                      tick();
                      return ((p.x - a[0].x) * -dy + (p.y - a[0].y) * dx) / length;
                    };
                    const A = a.map(project),
                      B = b.map(project);
                    if (
                      Math.max(...A) + epsilon < Math.min(...B) ||
                      Math.max(...B) + epsilon < Math.min(...A)
                    )
                      return true;
                  }
              return false;
            });
          })
        )
          coveredOutline.add(i);
      }
      const eligible = (s: Vector) =>
        s.kind === 'polygon' &&
        !s.strokeWidth &&
        s.fillEnabled !== false &&
        s.fillRule === 'evenodd' &&
        !!s.contours?.length;
      const suppliedCurves = (s: Vector): Cubic[][] => {
        const m = matrix(s),
          at = (p: Point) => mapPoint(m, p);
        return s.contours!.map((ring) =>
          ring.flatMap((node, i) => {
            tick();
            const next = ring[(i + 1) % ring.length],
              a = at(node),
              b = at(next);
            if (node.out || next.in)
              return [[a, at(node.out ?? node), at(next.in ?? next), b] as Cubic];
            if (a.x === b.x && a.y === b.y) return [];
            return [
              [
                a,
                { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
                { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 },
                b,
              ] as Cubic,
            ];
          }),
        );
      };
      for (const start of new Set([...changed, ...uncertain])) {
        if (seen.has(start)) continue;
        const component = [start];
        seen.add(start);
        for (let cursor = 0; cursor < component.length; cursor++) {
          tick();
          for (const neighbour of neighbours(proofBoxes[component[cursor]])) {
            tick();
            if (coveredOutline.has(neighbour)) continue;
            if (!seen.has(neighbour)) {
              seen.add(neighbour);
              component.push(neighbour);
            }
          }
        }
        if (component.length === 1 && !uncertain.has(start)) continue;
        let admitted = component.every((i) => !uncertain.has(i) && eligible(result[i]));
        if (admitted) {
          const paths = component.flatMap((i) =>
              worldPaths(merged[i], 0.25, () => tick()).map((r) => r.slice(0, -1)),
            ),
            curves = component.flatMap((i) => suppliedCurves(result[i]));
          try {
            // One original compound sample/work budget spans every ring/pair in
            // this connected group. No separate allowance is reset per neighbour.
            certifyCompoundContours(paths, curves, 0.25, 0, true);
          } catch {
            admitted = false;
          }
        }
        if (!admitted) {
          for (const i of component) result[i] = copy(merged[i], i);
          if (
            component.every(
              (i) =>
                eligible(merged[i]) &&
                merged[i].contours!.every((r) => r.every((n) => !n.in && !n.out)),
            )
          )
            restoreExterior(component);
        }
      }
    }
    /** Each replacement deforms its original polyline only inside the convex
     * hull of that polyline and the original cubic controls. Certify those whole
     * patches away from every foreign original edge AND every other patch.
     * Shared boundaries remain exact; a contact cannot flatten unrelated arcs. */
    function restoreExterior(component: number[]) {
      const edges = component.flatMap((shape) =>
        worldPaths(merged[shape], 0.25, () => tick()).flatMap((ring, contour) =>
          ring.slice(1).flatMap((b, i) =>
            ring[i].x === b.x && ring[i].y === b.y
              ? []
              : [
                  {
                    shape,
                    contour,
                    index: i,
                    points: [ring[i], b],
                  },
                ],
          ),
        ),
      );
      // A point contact or near miss needs the same local proof as a shared
      // edge. Neither should prevent remote original intervals from surviving.
      const bounds = (points: Point[]): Bounds => ({
        left: Math.min(...points.map((p) => p.x)),
        right: Math.max(...points.map((p) => p.x)),
        top: Math.min(...points.map((p) => p.y)),
        bottom: Math.max(...points.map((p) => p.y)),
      });
      let scale = 1;
      for (const e of edges)
        for (const p of e.points) {
          tick();
          scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
        }
      const epsilon = scale * Number.EPSILON * 64,
        edgeIndex = boundsIndex(edges.map((e) => bounds(e.points)));
      const separated = (a: Point[], b: Point[], controls: Point[], otherControls = b) => {
        const origin = a[0];
        // Any strict separating plane proves convex-hull separation. Axes from
        // control chords suffice for this conservative subset; no uncertain
        // hull construction, contact exception or numeric snapping is needed.
        for (const set of [controls, otherControls])
          for (let i = 0; i < set.length; i++)
            for (let j = i + 1; j < set.length; j++) {
              tick();
              const dx = set[j].x - set[i].x,
                dy = set[j].y - set[i].y,
                length = Math.hypot(dx, dy);
              if (!Number.isFinite(length)) throw Error('Paint patch axis overflow');
              if (!length) continue;
              const x = -dy / length,
                y = dx / length;
              const project = (p: Point) => {
                tick();
                const v = (p.x - origin.x) * x + (p.y - origin.y) * y;
                if (!Number.isFinite(v)) throw Error('Paint patch projection overflow');
                return v;
              };
              const A = a.map(project),
                B = b.map(project);
              if (
                Math.max(...A) + epsilon < Math.min(...B) ||
                Math.max(...B) + epsilon < Math.min(...A)
              )
                return true;
            }
        return false;
      };
      const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
      // Only consecutive intervals of the SAME original ring can share an
      // anchor. Strict opposite half-planes prove the entire swept hulls meet
      // solely there, using the original directional-join numeric margin.
      const joined = (a: Point[], b: Point[], anchor: Point) => {
        const incoming = a
            .filter((p) => !equal(p, anchor))
            .map((p) => ({
              x: anchor.x - p.x,
              y: anchor.y - p.y,
            })),
          outgoing = b
            .filter((p) => !equal(p, anchor))
            .map((p) => ({
              x: p.x - anchor.x,
              y: p.y - anchor.y,
            }));
        for (const u of incoming)
          for (const v of outgoing) {
            tick();
            const lu = Math.hypot(u.x, u.y),
              lv = Math.hypot(v.x, v.y);
            if (!lu || !lv || !Number.isFinite(lu + lv)) continue;
            const x = u.x / lu + v.x / lv,
              y = u.y / lu + v.y / lv;
            const side = (p: Point) => {
              tick();
              const d = p.x * x + p.y * y;
              if (!Number.isFinite(d)) throw Error('Paint join projection overflow');
              return d > epsilon;
            };
            if (incoming.every(side) && outgoing.every(side)) return true;
          }
        return false;
      };
      type Patch = {
        shape: number;
        ring: number;
        match: Match;
        owner: Match;
        points: Point[];
        controls: Cubic;
        bounds: Bounds;
      };
      const patches: Patch[] = [];
      for (const shape of component)
        for (const [ring, plan] of (plans.get(shape) ?? []).entries()) {
          const refine = (match: Match, owner = match) => {
            tick();
            const controls = placedCurve(plan.path, match),
              points = [
                ...controls,
                ...Array.from(
                  { length: match.length + 1 },
                  (_, k) => plan.path[(match.start + k) % plan.path.length],
                ),
              ],
              box = bounds(points);
            const chord = { x: controls[3].x - controls[0].x, y: controls[3].y - controls[0].y };
            const monotone = (path: Point[]) =>
              path.slice(1).every((p, i) => {
                tick();
                const d = (p.x - path[i].x) * chord.x + (p.y - path[i].y) * chord.y;
                if (!Number.isFinite(d)) throw Error('Paint patch direction overflow');
                return d >= 0;
              });
            const path = plan.path,
              end = (match.start + match.length) % path.length;
            const simple =
              Math.hypot(chord.x, chord.y) > epsilon &&
              monotone(controls) &&
              monotone(points.slice(4));
            const safe =
              simple &&
              edgeIndex(box, epsilon).every((i) => {
                tick();
                const edge = edges[i];
                // Certified regions retain the established full-ring proof
                // below. Only uncertain regions need the local self-edge proof.
                if (edge.shape === shape && !uncertain.has(shape)) return true;
                if (edge.shape === shape && edge.contour === ring) {
                  const offset = (edge.index - match.start + path.length) % path.length;
                  if (offset < match.length) return true;
                  if (edge.index === (match.start + path.length - 1) % path.length)
                    return joined(points, edge.points, path[match.start]);
                  if (edge.index === end) return joined(points, edge.points, path[end]);
                }
                return separated(points, edge.points, controls);
              });
            if (safe) patches.push({ shape, ring, match, owner, points, controls, bounds: box });
            else if (match.length >= 4) {
              // Split the proof only at original trace samples. Original cut
              // anchors stay exact; contiguous safe pieces recombine below.
              const left = Math.floor(match.length / 2),
                right = match.length - left;
              refine(
                matchInterval(match.span, match.direction, match.index, match.start, left),
                owner,
              );
              refine(
                matchInterval(
                  match.span,
                  match.direction,
                  match.index + match.direction * left,
                  (match.start + left) % plan.path.length,
                  right,
                ),
                owner,
              );
            }
          };
          for (const match of plan.matches) refine(match);
        }
      const patchIndex = boundsIndex(patches.map((p) => p.bounds)),
        rejected = new Set<number>();
      for (const [i, a] of patches.entries())
        for (const j of patchIndex(a.bounds, epsilon)) {
          tick();
          const b = patches[j];
          if (j <= i || (a.shape === b.shape && !uncertain.has(a.shape))) continue;
          const path = plans.get(a.shape)![a.ring].path,
            endA = (a.match.start + a.match.length) % path.length,
            endB = (b.match.start + b.match.length) % path.length;
          const adjacent =
            a.shape === b.shape &&
            a.ring === b.ring &&
            ((endA === b.match.start && joined(a.points, b.points, path[endA])) ||
              (endB === a.match.start && joined(a.points, b.points, path[a.match.start])));
          if (!adjacent && !separated(a.points, b.points, a.controls, b.controls)) {
            rejected.add(i);
            rejected.add(j);
          }
        }
      const byOwner = new Map<Match, Match[]>();
      for (const [i, patch] of patches.entries()) {
        tick();
        if (rejected.has(i)) continue;
        const parts = byOwner.get(patch.owner) ?? [];
        parts.push(patch.match);
        byOwner.set(patch.owner, parts);
      }
      for (const shape of component) {
        const accepted = (plans.get(shape) ?? []).map((plan) => {
          const matches: Match[] = [];
          for (const owner of plan.matches) {
            tick();
            const parts = (byOwner.get(owner) ?? []).sort((a, b) => {
              tick();
              return (
                ((a.start - owner.start + plan.path.length) % plan.path.length) -
                ((b.start - owner.start + plan.path.length) % plan.path.length)
              );
            });
            // Subdivide the PROOF, not the saved geometry. Recombine contiguous
            // certified intervals from the same original cubic, so a nearby
            // neighbour cannot turn proof subdivisions into new authored nodes.
            for (let i = 0; i < parts.length;) {
              tick();
              const first = parts[i++];
              let length = first.length;
              while (
                i < parts.length &&
                (first.start + length) % plan.path.length === parts[i].start
              ) {
                tick();
                length += parts[i++].length;
              }
              matches.push(
                matchInterval(first.span, first.direction, first.index, first.start, length),
              );
            }
          }
          return { path: plan.path, matches };
        });
        if (!accepted.length) continue;
        try {
          // Each monotone replacement and its original polyline lie in an
          // empty convex patch. Strict edge/patch separation (with proven local
          // joins only) makes this a local boundary deformation. Contacts and
          // nesting elsewhere stay exact, even if a global proof is uncertain.
          result[shape] = restore(merged[shape], shape, accepted, undefined, true, uncertain.has(shape));
        } catch {
          result[shape] = copy(merged[shape], shape);
        }
      }
    }
    validate(result);
    return result;
  } catch {
    return fallback();
  }
}

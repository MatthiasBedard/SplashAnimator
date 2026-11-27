import type { Point, Vector } from '@splash/document';
import { mapPoint, matrix } from './affine';
import { boundsIndex } from './bounds-index';
import { hasRestorableFillCurves } from './clip-fill-curves';
import { pathCommands } from './drawing';
import { PAINT_GRID_STEP } from './paint-clipping';

export class PaintCurveLossError extends Error {
  constructor() { super('Could not resolve a shared paint boundary without changing its curve.'); }
}

type Line = { a: Point; b: Point };
const box = ({ a, b }: Line) => ({ left: Math.min(a.x, b.x), right: Math.max(a.x, b.x),
  top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) });

function* straightEdges(shape: Vector): Generator<Line> {
  const basis = matrix(shape);
  const at = (x: number, y: number) => mapPoint(basis, { x, y });
  let start: Point | undefined, a: Point | undefined;
  for (const c of pathCommands(shape)) {
    if (c[0] === 'M') { a = start = at(c[1], c[2]); continue; }
    if (!a || !start) continue;
    const b = c[0] === 'Z' ? start : c[0] === 'C' ? at(c[5], c[6]) : at(c[1], c[2]);
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length > 0) {
      const onLine = (p: Point) => Math.abs((p.x - a!.x) * dy - (p.y - a!.y) * dx) <=
        length * Math.max(1, length, Math.abs(p.x), Math.abs(p.y)) * Number.EPSILON * 32;
      if (c[0] !== 'C' || (onLine(at(c[1], c[2])) && onLine(at(c[3], c[4])))) yield { a, b };
    }
    a = b;
  }
}

export const PAINT_EDGE_WORK_LIMIT = 200000;

/** A paint Boolean may shorten or join authored straight edges. It cannot
 * introduce straight edges elsewhere without replacing a curve with chords.
 * Check the legacy polygon result before publishing it to the document. */
export function checkPaintEdgeProvenance(sources: Vector[], output: Vector[],
  budget = { remaining: PAINT_EDGE_WORK_LIMIT }) {
  if (!sources.some(s => s.fillEnabled !== false ? hasRestorableFillCurves(s) :
      s.kind === 'bezier' && s.nodes?.some(n => n.in || n.out))) return;
  const original = new Set(sources);
  const faces = output.filter(face => !original.has(face) && face.fillEnabled !== false && face.kind === 'polygon');
  if (!faces.length) return;
  const lines: Line[] = [];
  const charge = () => { if (--budget.remaining < 0) throw new PaintCurveLossError(); };
  for (const source of sources) {
    if (source.kind === 'symbol' || source.kind === 'text') continue;
    for (const line of straightEdges(source)) { charge(); lines.push(line); }
  }
  const lookup = boundsIndex(lines.map(box));
  // The polygon clipper rounds intersection positions to its existing grid.
  const tolerance = PAINT_GRID_STEP * Math.SQRT2;
  for (const face of faces) {
    for (const edge of straightEdges(face)) {
      charge();
      const dx = edge.b.x - edge.a.x, dy = edge.b.y - edge.a.y, length = Math.hypot(dx, dy);
      const ux = dx / length, uy = dy / length;
      const spans: [number, number][] = [];
      for (const i of lookup(box(edge), tolerance)) {
        charge();
        const { a, b } = lines[i];
        const sx = b.x - a.x, sy = b.y - a.y, size = Math.hypot(sx, sy);
        const distance = (p: Point) => Math.abs((p.x - a.x) * (sy / size) - (p.y - a.y) * (sx / size));
        if (distance(edge.a) > tolerance || distance(edge.b) > tolerance) continue;
        const project = (p: Point) => (p.x - edge.a.x) * ux + (p.y - edge.a.y) * uy;
        const p = project(a), q = project(b);
        spans.push([Math.min(p, q), Math.max(p, q)]);
      }
      let end = 0;
      for (const [lo, hi] of spans.sort((a, b) => a[0] - b[0])) {
        if (lo > end + tolerance) break;
        end = Math.max(end, hi);
        if (end >= length - tolerance) break;
      }
      if (!spans.length || end < length - tolerance) throw new PaintCurveLossError();
    }
  }
}

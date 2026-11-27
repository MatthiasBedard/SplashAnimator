import { expect, it, vi } from 'vitest';
import { id, type Vector } from '../packages/document/src';
import { commitBrushPaint } from '../packages/geometry/src/brush-commit';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { containsPoint, worldPaths } from '../packages/geometry/src/drawing';
import { hasVectorFill } from '../packages/geometry/src/merge';

type Listener = ((event: { data: unknown }) => void) | null;
type WorkerScope = { postMessage: (message: unknown) => void; onmessage?: Listener };
const scope = globalThis as unknown as { self: WorkerScope };
let current: InlineWorker | undefined;
scope.self = { postMessage: (message) => {
  const target = current;
  setTimeout(() => target?.onmessage?.({ data: structuredClone(message) }));
} };
class InlineWorker {
  onmessage: Listener = null;
  onerror: Listener = null;
  onmessageerror: Listener = null;
  postMessage(data: unknown) {
    setTimeout(() => {
      current = this; // eslint-disable-line @typescript-eslint/no-this-alias
      scope.self.onmessage?.({ data: structuredClone(data) });
    });
  }
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.stubGlobal('Worker', InlineWorker);

const brush = (fill: string, pts: {x:number,y:number}[], w = 24): Vector => {
  const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y), x = Math.min(...xs), y = Math.min(...ys);
  return { id: id(), kind:'brush', x, y, width:Math.max(...xs)-x, height:Math.max(...ys)-y, rotation:0, fill, stroke:fill, strokeWidth:w,
    points: pts.map(p=>({x:p.x-x,y:p.y-y})), brush:{ pressure:false, minimum:1, tilt:false, aspect:1, angle:0 }, drawingMode:'merge' };
};
const paint = (s: Vector[], b: Vector) => commitBrushPaint(s, { brush:b, amount:0.5, merge:true, mode:'normal', optimize:true, selected:[], at:s.length, removeCoveredStrokes:true });
const line = (pts: {x:number,y:number}[]): Vector => ({ id:id(), kind:'path', x:0, y:0, width:1, height:1, rotation:0, fill:'#00ff00', fillEnabled:false, stroke:'#000000', strokeWidth:2, points: pts, drawingMode:'merge' });
const pencil = (s: Vector[], v: Vector) => prepareShapeDrawing(s, { shape:v, merge:true, removeCoveredStrokes:true }).shapes;
const inside = (s: Vector, p: {x:number,y:number}) => worldPaths(s, 0.01).reduce((a, r) => a !== containsPoint(r, p), false);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// Moving a mixed selection of Brush paint and Pencil lines, then dropping it, through the real
// worker transaction (run inline): every moved fill shows at its new place, none is left behind,
// and the worker's reply passes the editor's checks.
it('drops mixed Brush and Pencil selections where they were moved', async () => {
  await import('../packages/geometry/src/worker');
  const { mergeEditedPiecesInWorker } = await import('../apps/editor/src/geometry-worker');
  let fails = 0, runs = 0;
  for (let trial = 0; trial < 20; trial++) {
    let a: Vector[] = [];
    const colors = ['#ff0000', '#0000ff', '#00aa00'];
    for (let k = 0; k < 5; k++) {
      const x = 80 + rnd() * 200, y = 80 + rnd() * 200;
      if (rnd() < 0.55) a = paint(a, brush(colors[k % 3], [{x,y},{x:x+60+rnd()*120,y:y+rnd()*80-40},{x:x+rnd()*100,y:y+60+rnd()*60}], 20 + rnd()*20));
      else a = pencil(a, line([{x,y},{x:x+rnd()*200-50,y:y+rnd()*200-50},{x:x+rnd()*150,y:y+rnd()*40}]));
    }
    const ids = a.map(s => s.id);
    const chosen = new Set(ids.filter(() => rnd() < 0.5));
    if (!chosen.size || ![...chosen].some(i => hasVectorFill(a.find(s=>s.id===i)!)) ) continue;
    const dx = rnd() * 80 - 40, dy = rnd() * 80 - 40;
    const moved = structuredClone(a);
    for (const s of moved) if (chosen.has(s.id)) { s.x += dx; s.y += dy; }
    moved.sort((p,q)=>Number(chosen.has(p.id))-Number(chosen.has(q.id)));
    const vacatedInk = a.filter(s => chosen.has(s.id) && !hasVectorFill(s));
    const eligible = moved.filter(s => !chosen.has(s.id)).map(s => s.id);
    runs++;
    let result;
    try { result = await mergeEditedPiecesInWorker(moved, [...chosen], undefined, eligible, { cutPlacedInk: true, vacatedInk, planar: true }); }
    catch (e) { console.log('trial', trial, 'threw', String(e).slice(0, 120)); fails++; continue; }
    // Every moved fill's paint must show at its new place.
    let bad = 0;
    for (const s of moved) if (chosen.has(s.id) && hasVectorFill(s)) {
      for (let k = 0; k < 40; k++) {
        const b = worldPaths(s, 0.01).flat(); const xs = b.map(p=>p.x), ys = b.map(p=>p.y);
        const p = { x: Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), y: Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys)) };
        if (!inside(s, p)) continue;
        const above = moved.slice(moved.indexOf(s) + 1).some(t => chosen.has(t.id) && hasVectorFill(t) && inside(t, p));
        if (above) continue;
        const top = [...result.artwork].reverse().find(t => hasVectorFill(t) && inside(t, p));
        if (!top || top.fill !== s.fill) bad++;
      }
    }
    // Where a moved fill was (and is no longer), nothing it became should remain.
    let stale = 0;
    for (const s of a) if (chosen.has(s.id) && hasVectorFill(s)) {
      const now = moved.find(t => t.id === s.id)!;
      for (let k = 0; k < 40; k++) {
        const b = worldPaths(s, 0.01).flat(); const xs = b.map(p=>p.x), ys = b.map(p=>p.y);
        const p = { x: Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), y: Math.min(...ys) + rnd() * (Math.max(...ys) - Math.min(...ys)) };
        if (!inside(s, p) || inside(now, p)) continue;
        if (moved.some(t => t.id !== s.id && hasVectorFill(t) && t.fill === s.fill && inside(t, p))) continue;
        const top = [...result.artwork].reverse().find(t => hasVectorFill(t) && inside(t, p));
        if (top && top.fill === s.fill) stale++;
      }
    }
    if (stale) { fails++; console.log('trial', trial, 'moved paint left behind at', stale, 'samples'); }
    if (bad) { fails++; console.log('trial', trial, 'missing moved paint at', bad, 'samples; artwork', result.artwork.length); }
  }
  expect(runs).toBeGreaterThan(10);
  expect(fails).toBe(0);
}, 120000);

import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { newProject, validateProject, type Point, type Vector } from '../packages/document/src';
import { containsPoint, worldPaths } from '../packages/geometry/src/drawing';
import { mergeControlBounds } from '../packages/geometry/src/merge';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { brokenFrame, mergeFailThreeFrame, mergeFailTwoFrame, mergeFailTwoPurpleFrame, selectFailFrame } from './broken-drawing-fixture';
import { preparePaintDrop, splitPaintSelection } from '../packages/geometry/src/clip-paint';
import { overlaps } from '../packages/geometry/src/bounds-index';
import { worldPoint } from '../packages/geometry/src';

// Replay only this revision. The artist can continue saving other revisions
// in the same folder. The project itself stays outside the source repository.
const file = '.local-projects/line not merging.spl/vectors/32f9b938-0726-4c97-b19d-e7fac11c1e74.json';

function paintIndex(shapes: Vector[], tolerance = .002) {
  return shapes.filter(s => !s.strokeWidth).map(s => ({
    bounds: mergeControlBounds(s), rings: worldPaths(s, tolerance), color: s.fill,
  }));
}

function colorsAt(index: ReturnType<typeof paintIndex>, p: Point) {
  return index.filter(({ bounds: b, rings }) =>
    p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom &&
    rings.reduce((inside, ring) => inside !== containsPoint(ring, p), false)
  ).map(face => face.color);
}

it.skipIf(!existsSync(file))('replays the four fills and two Pencil paths in the supplied mixed drawing', () => {
  const layers: Record<string, Vector[]> = JSON.parse(readFileSync(file, 'utf8'));
  const [saved] = Object.values(layers);
  const additions = saved.slice(375);
  expect(additions.map(s => s.kind)).toEqual(['polygon','polygon','bezier','polygon','polygon','bezier']);
  let artwork = saved.slice(0,375);
  for (const shape of additions) {
    const result = prepareShapeDrawing(artwork, { shape, merge: true, removeCoveredStrokes: true });
    expect(result.retainedOverlap, shape.id).toBeUndefined();
    if (shape.strokeWidth) {
      const fillsBefore = artwork.filter(s => !s.strokeWidth).length;
      const fillsAfter = result.shapes.filter(s => !s.strokeWidth).length;
      expect(fillsAfter).toBeGreaterThan(fillsBefore);
      expect(result.shapes.length - fillsAfter).toBeGreaterThan(artwork.length - fillsBefore + 100);
    }
    artwork = result.shapes;
  }
  const before = paintIndex(saved), after = paintIndex(artwork);
  let originalOverlaps = 0;
  for (let x = .47; x < 960; x += 2) for (let y = .53; y < 540; y += 2) {
    const p = { x, y }, original = colorsAt(before, p), fixed = colorsAt(after, p);
    if (original.length > 1) originalOverlaps++;
    if (fixed.length > 1 || fixed.at(-1) !== original.at(-1))
      throw Error(`Paint mismatch at (${x}, ${y}). Original ${original}, replay ${fixed}`);
  }
  expect(originalOverlaps).toBeGreaterThan(2000);
});

const drawtest2 = '.local-projects/drawtest2.spl/vectors/c91b92e2-a74c-4780-a96b-18403f09b052.json';

const broken = brokenFrame();
const selectFail = selectFailFrame();
const mergeFailTwo = mergeFailTwoFrame();
const purpleRevision = mergeFailTwoPurpleFrame();
const mergeFailThree = mergeFailThreeFrame();

for (const [name, x, y, w, h, dx, dy, count, ink, expectedOverlaps, complete] of [
  ['small', 450, 255, 85, 100, 16, 22, 12, 5, 385, true],
  ['dense', 355, 245, 126, 95, 90, 75, 49, 29, 2004, true],
  ['uncertain', 475, 200, 95, 62, -30, 90, 25, 15, 908, false],
] as const) {
  it.skipIf(!mergeFailThree)(`settles certified cuts of the ${name} mixed selection from merge fail 3`, () => {
    const source = mergeFailThree!, before = structuredClone(source);
    const polygon = [{ x, y }, { x: x+w, y }, { x: x+w, y: y+h }, { x, y: y+h }];
    const selection = splitPaintSelection(source, { polygon, eligible: source.map(s => s.id),
      preserveStrokes: true, preserveOutsideFillCurves: true });
    const moved = selection.inside.map(s => ({ ...s, x: s.x+dx, y: s.y+dy }));
    expect(moved).toHaveLength(count);
    expect(moved.filter(s => s.strokeWidth && s.fillEnabled === false)).toHaveLength(ink);
    const existing = selection.artwork;
    const drop = preparePaintDrop([...existing, ...moved], moved.map(s => s.id), existing.map(s => s.id));
    expect(drop.preservedDestination).toBe(!complete);
    expect(drop.artwork.slice(-moved.length)).toStrictEqual(moved);
    const lower = paintIndex(existing, .005), upper = paintIndex(moved, .005);
    const outcome = paintIndex(drop.artwork.slice(0, -moved.length), .005);
    let overlapsBefore = 0, residue = 0;
    for (let py = y+dy+1.37; py < y+dy+h-1; py += 2.15) {
      for (let px = x+dx+1.48; px < x+dx+w-1; px += 2.21) {
        const point = { x: px, y: py };
        if (!colorsAt(lower, point).length || !colorsAt(upper, point).length) continue;
        overlapsBefore++;
        if (colorsAt(outcome, point).length) residue++;
      }
    }
    expect(overlapsBefore).toBe(expectedOverlaps);
    if (complete) expect(residue).toBe(0);
    else {
      expect(residue).toBeGreaterThan(0);
      expect(residue).toBeLessThan(overlapsBefore / 2);
    }
    const movedBounds = moved.map(mergeControlBounds);
    const untouched = existing.filter(s => !movedBounds.some(box => overlaps(box, mergeControlBounds(s), .001)));
    expect(untouched.length).toBeGreaterThan(450);
    for (const shape of untouched) expect(drop.artwork.find(s => s.id === shape.id)).toBe(shape);
    const doc = newProject();
    doc.layers[0].drawingMode = 'merge';
    doc.layers[0].keys[0].shapes = drop.artwork;
    expect(() => validateProject(doc)).not.toThrow();
    expect(source).toStrictEqual(before);
  });
}

it.skipIf(!purpleRevision)('cuts the final purple Brush in merge fail 2 across a touching hole', () => {
  const saved = purpleRevision!, snapshot = structuredClone(saved);
  const top = saved.at(-1)!, background = saved.slice(0,-1);
  expect(background).toHaveLength(962);
  expect(top.contours?.[0]).toHaveLength(88);
  const result = prepareShapeDrawing(background,{shape:top,merge:true,removeCoveredStrokes:true});
  expect(result.retainedOverlap).toBeUndefined();
  const paint = paintIndex(result.shapes), before = paintIndex(background), cutter = paintIndex([top]);
  expect(result.shapes.find(s=>s.id===top.id)?.contours?.flat().some(n=>n.in||n.out)).toBe(true);
  let covered = 0;
  for (let x=462.13;x<769;x+=4) for (let y=127.62;y<419;y+=4) {
    const point = {x,y};
    if (!colorsAt(before,point).length) continue;
    if (colorsAt(cutter,point).length) {
      expect(colorsAt(paint,point),`paint ownership at ${x},${y}`).toEqual([top.fill]);
      covered++;
    }
  }
  expect(covered).toBeGreaterThan(100);
  expect(result.shapes.some(s=>s.strokeWidth===2&&s.fillEnabled===false&&s.nodes?.length)).toBe(true);
  const document = newProject();
  document.layers[0].keys[0].shapes = result.shapes;
  expect(() => validateProject(document)).not.toThrow();
  expect(saved).toEqual(snapshot);
},30_000);
it.skipIf(!mergeFailTwo)('cuts the final orange Brush in merge fail 2', () => {
  const saved = mergeFailTwo!, snapshot = structuredClone(saved);
  const top = saved.at(-1)!, background = saved.slice(0,-1);
  expect(background).toHaveLength(1098);
  expect(top.contours).toHaveLength(12);
  const result = prepareShapeDrawing(background, {shape:top, merge:true, removeCoveredStrokes:true});
  expect(result.retainedOverlap).toBeUndefined();
  const document = newProject();
  document.layers[0].drawingMode = 'merge';
  document.layers[0].keys[0].shapes = result.shapes;
  expect(() => validateProject(document)).not.toThrow();
  expect(result.shapes.some(s=>s.fill===top.fill&&s.contours?.flat().some(n=>n.in||n.out))).toBe(true);
  expect(result.shapes.some(s=>s.opacity===0.2 && s.fill==='#3b821f' && s.strokeWidth===0)).toBe(true);
  expect(result.shapes.filter(s=>s.strokeWidth).every(s=>s.strokeWidth===2&&s.fillEnabled===false)).toBe(true);
  const paint = paintIndex(result.shapes), before = paintIndex(background), cutter = paintIndex([top]);
  let covered = 0;
  for (let x = 42.13; x < 870; x += 5) for (let y = 20.62; y < 480; y += 5) {
    const point = {x,y};
    if (!colorsAt(cutter,point).length || !colorsAt(before,point).length) continue;
    expect(colorsAt(paint,point), `paint ownership at ${x},${y}`).toEqual([top.fill]);
    covered++;
  }
  expect(covered).toBeGreaterThan(100);
  expect(saved).toEqual(snapshot);
},30_000);
it.skipIf(!selectFail)('settles the mixed drop and cuts the saved red Brush in select fail', () => {
  const saved = selectFail!, snapshot = structuredClone(saved);
  const [pencil, purple, red] = saved.slice(-3), base = saved.slice(0,-1);
  const moves = new Set([pencil.id,purple.id]);
  const drop = preparePaintDrop(base,[...moves],base.filter(s=>!moves.has(s.id)).map(s=>s.id));
  expect(drop.preservedDestination).toBe(false);
  expect(drop.artwork).toContain(pencil);
  expect(drop.artwork).toContain(purple);
  const moved = paintIndex([purple]), original = paintIndex(base), settled = paintIndex(drop.artwork);
  let movedOverlaps = 0;
  for (let y = -80.41; y < 25; y += 2) for (let x = 522.37; x < 679; x += 2) {
    const p = { x, y };
    if (!colorsAt(moved,p).length || colorsAt(original,p).length < 2) continue;
    expect(colorsAt(settled,p),JSON.stringify(p)).toEqual([purple.fill]);
    movedOverlaps++;
  }
  expect(movedOverlaps).toBeGreaterThan(30);

  // Exercise the saved overdraw both on the original failed layout and after
  // settling the mixed drop. Its stored finish already has the authored curves.
  for (const input of [base, drop.artwork]) {
    const result = prepareShapeDrawing(input,{shape:red,merge:true,removeCoveredStrokes:true});
    expect(result.retainedOverlap).toBeUndefined();
    // The red paint stays one piece, keeping every authored anchor (it gains anchors only where
    // outlines below now end on it).
    const reds = result.shapes.filter(s=>s.fill===red.fill);
    expect(reds).toHaveLength(1);
    const anchors = reds[0].contours!.flat().map(n=>worldPoint(reds[0],n));
    for (const n of red.contours!.flat()) {
      const p = worldPoint(red,n);
      expect(anchors.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<1e-9)).toBe(true);
    }
    const paint = paintIndex(result.shapes), cutter = paintIndex([red]);
    let covered = 0;
    for (let y = -100.43; y < 225; y += 3) for (let x = 311.29; x < 672; x += 3) {
      const p = {x,y};
      if (!colorsAt(cutter,p).length || !colorsAt(settled,p).length) continue;
      expect(colorsAt(paint,p),JSON.stringify(p)).toEqual([red.fill]);
      covered++;
    }
    expect(covered).toBeGreaterThan(100);
    expect(result.shapes.filter(s=>s.strokeWidth).every(s=>s.fillEnabled===false && s.strokeWidth===pencil.strokeWidth)).toBe(true);
    // Paint away from the red stays where it was, in its colour. Matching neighbours it touches
    // may join into one piece, so this compares the painted colour rather than the records.
    const byId = new Map(result.shapes.map(s=>[s.id,s]));
    const after = paintIndex(result.shapes);
    for (const shape of input.filter(s=>!overlaps(mergeControlBounds(s),mergeControlBounds(red),0))) {
      if (byId.get(shape.id) && JSON.stringify(byId.get(shape.id)) === JSON.stringify(shape)) continue;
      const own = paintIndex([shape]);
      const b = mergeControlBounds(shape);
      for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) {
        const p = { x: b.left + (b.right - b.left) * i / 6, y: b.top + (b.bottom - b.top) * j / 6 };
        if (colorsAt(own,p).length) expect(colorsAt(after,p),JSON.stringify(p)).toEqual([shape.fill]);
      }
    }
  }
  expect(saved).toEqual(snapshot);
}, 30_000);
for (const removeCoveredStrokes of [true,false]) {
  it.skipIf(!broken)(`replays the last Brush and Pencil together in broken (remove covered ink: ${removeCoveredStrokes})`,()=>{
    const saved=broken!, [brush,pencil]=saved.slice(-2);
    const overpaint=prepareShapeDrawing(saved.slice(0,-2),{shape:brush,merge:true,removeCoveredStrokes});
    expect(overpaint.retainedOverlap).toBeUndefined();
    const cut=prepareShapeDrawing(overpaint.shapes,{shape:pencil,merge:true});
    expect(cut.retainedOverlap).toBeUndefined();
    expect(cut.shapes.filter(s=>!s.strokeWidth).length).toBeGreaterThan(
      overpaint.shapes.filter(s=>!s.strokeWidth).length+100);
    const before=paintIndex(saved,.0005), after=paintIndex(cut.shapes,.0005);
    let overlaps=0;
    for(let x=300.33;x<810;x+=2) for(let y=190.27;y<540;y+=2) {
      const p={x,y}, old=colorsAt(before,p), current=colorsAt(after,p);
      if (old.length>1) overlaps++;
      if (current.length>1 || current.at(-1)!==old.at(-1)) throw Error(`Paint changed at (${x}, ${y}): ${old} -> ${current}`);
    }
    expect(overlaps).toBe(290);
  });
}

it.skipIf(!existsSync(drawtest2))('cuts the saved drawtest2 Brush overlap into independently owned faces',()=>{
  const [saved] = Object.values(JSON.parse(readFileSync(drawtest2,'utf8'))) as Vector[][];
  expect(saved.map(s=>s.contours?.map(r=>r.length))).toEqual([[258,4],[223,8,7,3,5],[4]]);
  let artwork = saved.slice(0,1);
  for (const shape of saved.slice(1)) {
    const result=prepareShapeDrawing(artwork,{shape,merge:true,removeCoveredStrokes:true});
    expect(result.retainedOverlap).toBeUndefined();
    artwork=result.shapes;
  }
  expect(artwork.filter(s=>s.fill===saved[0].fill)).toHaveLength(88);
  const before=paintIndex(saved), after=paintIndex(artwork);
  const fineBefore=paintIndex(saved,.00002), fineAfter=paintIndex(artwork,.00002);
  let originalOverlap=0;
  for(let x=-81.59;x<800;x+=4) for(let y=-154.57;y<510;y+=4){
    const p={x,y}, original=colorsAt(before,p), fixed=colorsAt(after,p);
    if(original.length>1)originalOverlap++;
    if(fixed.length>1)throw Error('Multiple faces at '+JSON.stringify(p));
    if(original.at(-1)!==fixed.at(-1)){
      const expected=colorsAt(fineBefore,p).at(-1);
      expect(colorsAt(fineAfter,p),JSON.stringify(p)).toEqual(expected?[expected]:[]);
    }
  }
  expect(originalOverlap).toBe(5342);
});

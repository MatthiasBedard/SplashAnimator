import { expect, it } from 'vitest';
import type { Point, Vector } from '../packages/document/src';
import { preparePaintDrop } from '../packages/geometry/src/clip-paint';
import { containsPoint, pathCommands, worldPaths } from '../packages/geometry/src/drawing';
import { preparePencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { mergeFailFrame } from './broken-drawing-fixture';

// Compare the actual filled interiors before and after deselection, including
// holes. The probes are inside the artwork and independent of hit-test slop.
function membership(artwork: Vector[]) {
  const rings = artwork.map(shape => worldPaths(shape, 0.03));
  return (p: Point) => artwork.filter((_, i) =>
    rings[i].reduce((inside, ring) => inside !== containsPoint(ring, p), false));
}

const p = (x: number, y: number) => ({ x, y });

// The saved project has translation-only faces. Match cubic controls in either
// direction, accounting for rounding when a cut face takes a new local origin.
function greenCurvesAwayFromDrop(faces: Vector[], color: string) {
  const result = new Set<string>();
  for (const face of faces.filter(s => s.fill === color)) {
    let start = p(0,0), current = start;
    const world = (x: number, y: number) => p(x + face.x, y + face.y);
    for (const c of pathCommands(face)) {
      if (c[0] === 'Z') { current = start; continue; }
      const end = c[0] === 'C' ? world(c[5],c[6]) : world(c[1],c[2]);
      if (c[0] === 'C') {
        const curve = [current,world(c[1],c[2]),world(c[3],c[4]),end];
        if (curve.every(pt => pt.x < 290) || curve.every(pt => pt.x > 520)) {
          const pts = curve.map(pt => [pt.x.toFixed(8),pt.y.toFixed(8)].join(','));
          result.add([pts.join(';'),pts.reverse().join(';')].sort()[0]);
        }
      }
      if (c[0] === 'M') start = end;
      current = end;
    }
  }
  return result;
}

const contacts = [
  [14,346,193], [15,340,148], [16,386,159], [29,425,241], [30,436,323],
  [31,383,229], [32,413,310], [33,419,366], [34,370,200],
];

const saved = mergeFailFrame();
it.skipIf(!saved)('joins the nine connected purple destinations and cuts the five-ring green Brush in merge fail', () => {
  const art = saved!, moving = art[45];
  const snapshot = structuredClone(art);
  const original = membership(art);
  for (const [index,x,y] of contacts) expect(original(p(x,y))).toEqual([art[index], moving]);
  expect(original(p(314,124))).toEqual([art[19], moving]);
  const drop = preparePaintDrop(art, [moving.id], art.slice(0,-1).map(s => s.id));
  expect(drop.preservedDestination).toBe(false);
  const owner = drop.artwork.find(s => s.id === drop.absorbedFill?.into);
  expect(owner?.fill).toBe(moving.fill);
  const resolved = membership(drop.artwork);
  for (const point of [...contacts.map(([,x,y]) => p(x,y)), p(314,124),p(325,144),
    p(336,190),p(355,151),p(416,168),p(470,255),p(456,334),p(377,228),p(392,300),p(401,361)]) {
    expect(resolved(point)).toEqual([owner]);
  }
  // A clean drop changes multiplicity and topology, preserving the visible
  // color everywhere as well as the original disjoint purple destinations.
  const absorbed = new Set(contacts.map(([i]) => art[i]));
  for (const shape of art) if (shape !== moving && shape !== art[19] && !absorbed.has(shape)) {
    expect(drop.artwork.find(s => s.id === shape.id)).toBe(shape);
  }
  for (let y = -1; y <= 505; y += 11) for (let x = -140; x <= 731; x += 13) {
    const before = original(p(x,y)), after = resolved(p(x,y));
    expect(after.length, `overlap at ${x},${y}`).toBeLessThanOrEqual(1);
    expect(after[0]?.fill, `color at ${x},${y}`).toBe(before.at(-1)?.fill);
  }
  expect(owner!.contours!.some(ring => ring.some(n => n.in || n.out))).toBe(true);
  const curves = greenCurvesAwayFromDrop(art, art[19].fill);
  expect(curves.size).toBeGreaterThan(50);
  expect(greenCurvesAwayFromDrop(drop.artwork, art[19].fill)).toEqual(curves);

  const stroke: Vector = { id:'new-pencil', kind:'path', x:0, y:0, width:990, height:1, rotation:0,
    fillEnabled:false, fill:'#000000', stroke:'#111111', strokeWidth:1, points:[p(-190,226),p(800,226)] };
  const reopened: Vector[] = JSON.parse(JSON.stringify(drop.artwork));
  const cut = preparePencilDrawing(reopened, { mode:'ink', merge:true, stroke });
  expect(cut.retainedOverlap).toBeUndefined();
  const afterCut = membership(cut.shapes.filter(s => !s.strokeWidth));
  const above = afterCut(p(376,224)), below = afterCut(p(376,228));
  expect(above.map(s => s.fill)).toEqual([moving.fill]);
  expect(below.map(s => s.fill)).toEqual([moving.fill]);
  expect(above[0].id).not.toBe(below[0].id);
  // The new line divides the paint and stays one line: only other lines cut it.
  const ink = cut.shapes.filter(s => s.strokeWidth);
  expect(ink).toHaveLength(1);
  expect(ink.every(s => s.fillEnabled === false && s.stroke === stroke.stroke)).toBe(true);
  expect(art).toEqual(snapshot);
});

it.skipIf(!saved)('rejoins a fractional drop while keeping each material visible through the Brush hole', () => {
  const art = saved!, top = art[45];
  const moving = { ...top, x: top.x + 0.375, y: top.y + 0.625 };
  const base = art.slice(0,-1), input = [...base,moving];
  const drop = preparePaintDrop(input, [moving.id], base.map(s => s.id));
  expect(drop.preservedDestination).toBe(false);
  expect(drop.absorbedFill?.moving).toBe(moving.id);
  const owner = drop.absorbedFill!.into;
  const before = membership(input), after = membership(drop.artwork);
  for (const [index,x,y] of contacts) {
    expect(before(p(x,y))).toEqual([art[index],moving]);
    expect(after(p(x,y)).map(s => s.id)).toEqual([owner]);
  }
  expect(before(p(314,124))).toEqual([art[19],moving]);
  expect(after(p(314,124)).map(s => s.id)).toEqual([owner]);
  expect(drop.artwork.filter(s => s.fill === art[19].fill)).toHaveLength(10);
  const [outside,hole] = worldPaths(moving,0.03);
  for (const pt of [p(456,318),p(456,334),p(456,378)]) {
    expect(containsPoint(outside,pt) && containsPoint(hole,pt)).toBe(true);
    expect(after(pt).map(s => s.fill)).toEqual(before(pt).map(s => s.fill));
  }
});

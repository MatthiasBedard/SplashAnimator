import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { newProject, validateProject, type Point, type Project, type Vector } from '../packages/document/src';
import { loadProject, saveProject, type DirectoryStore } from '../packages/document/src/storage';
import { localAuthoringBounds, objectBounds, worldPoint } from '../packages/geometry/src';
import { containsPoint, pathCommands, worldPaths } from '../packages/geometry/src/drawing';
import { preparePencilDrawing, prepareWorkerPencilDrawing } from '../packages/geometry/src/pencil-drawing';
import { prepareFilledInkInBasis, prepareSharedPaintStack } from '../packages/geometry/src/shared-paint-cut';
import { preparePlacedFilledInk } from '../packages/geometry/src/placed-filled-ink';
import { filledInkBasisSources } from '../packages/geometry/src/filled-ink-basis';
import { joinOverlayFills } from '../packages/geometry/src/join-recolored-fills';
import { prepareBrushPaint, prepareWorkerBrushPaint, type BrushCommit } from '../packages/geometry/src/brush-commit';
import { mayIntersectPaint, mergeControlBounds } from '../packages/geometry/src/merge';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { paintClassifier, simpleOrthogonalRing } from '../packages/geometry/src/paint-boundary';
import type { Edge } from '../packages/geometry/src/ink-face-walk';
import { lineContacts, sameStraightCrossing, uniqueLineCubicContact } from '../packages/geometry/src/line-contacts';
import { paintCoordinateUnits } from '../packages/geometry/src/paint-winding';
import { partitionInkOverPaint, type InkPaintRetry } from '../packages/geometry/src/ink-paint-cut';
import { prepareStrokeCut } from '../packages/geometry/src/stroke-cut';
import { prepareEraseDrawing } from '../packages/geometry/src/erase';
import { worldStrokePolygons } from '../packages/geometry/src/strokes';
import type { PaintRegion } from '../packages/geometry/src/paint-region';
import { adjacentPrecisionBoundaries, collidingObliqueInkCrossings, consecutiveCurvedInkCoordinates, consecutiveInkCoordinates, consecutiveObliqueInkCoordinates, consecutiveObliquePaintBoundaries, crossingCompoundPair, mixedObliqueInkCrossings, nearbySavedPencilCrossings, subpixelPencilAcrossOrigin, subpixelPencilPiece, twoGroupsOfObliqueInkCrossings } from './drawing-crossing-contours-fixture';

const path = '.local-projects/another merge fail.spl/vectors/cb7dcff9-6407-41a5-a44d-efc1d89022a9.json';
const bytes = existsSync(path) ? readFileSync(path) : undefined;
const saved = bytes && createHash('sha256').update(bytes).digest('hex') ===
  '80081214113d42b574d75e817d364e2fcaaee5cb3293894a5d5a421d5f439019'
  ? (JSON.parse(bytes.toString('utf8')) as Record<string, Vector[]>)['11fc04d6-a488-4245-b7e6-4f523af8ecae:0']
  : undefined;

const densePencil: Vector = {
  id: 'ink-probe', kind: 'bezier', x: 130, y: 170, width: 235, height: 55, rotation: 0,
  strokeWidth: 2, stroke: '#2b232f', fill: '#6d5efc', fillEnabled: false, closed: false,
  points: [], drawingMode: 'merge',
  nodes: [{ x: 0, y: 30 }, { x: 70, y: 0 }, { x: 145, y: 55 }, { x: 235, y: 2 }],
};

function paintOwners(artwork: Vector[], point: Point) {
  return artwork.filter(shape => !shape.strokeWidth && worldPaths(shape, .001)
    .reduce((inside, ring) => inside !== containsPoint(ring, point), false));
}

function prepare(artwork: Vector[], shape: Vector) {
  return prepareShapeDrawing(artwork, { shape, merge: true, removeCoveredStrokes: true });
}

it('keeps the ordinary filled cut when exact roots cannot stay ordered after boxing', () => {
  const { arcs, pencil } = nearbySavedPencilCrossings(224);
  const source: Vector[] = arcs.map((arc, index) => ({
    ...arc, kind: 'polygon', fill: arc.stroke, strokeWidth: 0, fillEnabled: true, closed: true,
    fillRule: 'evenodd', nodes: undefined, contours: [[...arc.nodes!,
      ...(index ? [{ x: 19, y: 7 }, { x: -8, y: 14 }] : [{ x: -15, y: -5 }, { x: 11, y: -14 }]),
    ]],
  }));
  const original = structuredClone(source);
  const result = prepareShapeDrawing(source, { shape: pencil, merge: true });
  expect(result.retainedOverlap).toBeUndefined();
  // The line divides both fills and stays one line (only other lines cut a line).
  expect(result.shapes.filter(s => s.strokeWidth)).toHaveLength(1);
  for (const shape of source) expect(result.shapes.filter(s => s.fill === shape.fill && !s.strokeWidth)).toHaveLength(2);
  expect(source).toEqual(original);
});

it('does not weld the two reduced saved intersections when both fit in the working coordinates', () => {
  const { arcs, pencil } = nearbySavedPencilCrossings();
  const original = structuredClone({ arcs, pencil });
  const result = prepareSharedPaintStack(arcs, pencil, 'ink');
  expect(result?.strokes).toHaveLength(3);
  const middle = result!.strokes![1];
  const endpoints = worldPaths(middle)[0];
  // Both authoring boxes must reconstruct the same placed junction. The
  // shared-origin adjustment can differ from the root's private coordinates.
  expect(endpoints).toEqual([
    { x: 0.0240170610070507, y: -0.01572082192816282 },
    { x: 0.024017061007052476, y: -0.015720821928161932 },
  ]);
  expect(middle.width).toBeGreaterThan(0);
  expect(middle.height).toBeGreaterThan(0);
  for (const [i, arc] of arcs.entries()) {
    const pieces = result!.background.get(arc);
    expect(pieces).toHaveLength(2);
    expect(pieces?.every(s => s.kind === 'bezier' && s.stroke === arc.stroke && s.strokeWidth === arc.strokeWidth)).toBe(true);
    expect(pieces?.map(s => worldPaths(s)[0].filter(p => p.x === endpoints[i].x && p.y === endpoints[i].y).length)).toEqual([1, 1]);
  }
  const doc = newProject();
  doc.layers[0].keys[0].shapes = [...result!.strokes!, ...Array.from(result!.background.values()).flat()];
  const reopened = JSON.parse(JSON.stringify(doc)) as Project;
  expect(() => validateProject(reopened)).not.toThrow();
  expect(worldPaths(reopened.layers[0].keys[0].shapes[1])[0]).toEqual(endpoints);
  expect({ arcs, pencil }).toEqual(original);
});

it('admits a loaded even-odd fill with crossing contours and verifies the ordinary merge control', () => {
  const [lower, upper] = crossingCompoundPair();
  const overlap = { x: 46, y: 25 };
  const doc = newProject();
  doc.layers[0].drawingMode = 'merge';
  doc.layers[0].keys[0].shapes = [lower, upper];
  expect(() => validateProject(doc)).not.toThrow();
  expect(paintOwners([lower, upper], overlap)).toHaveLength(2);
  const result = prepare([{ ...lower, contours: lower.contours!.slice(0, 1) }], upper);
  expect(result.retainedOverlap).toBeUndefined();
  expect(paintOwners(result.shapes, overlap)).toHaveLength(1);
});

it('settles same-color overlap over a loaded curved fill with crossing contours', () => {
  const [lower, upper] = crossingCompoundPair();
  const source = [lower];
  const original = structuredClone(source);
  const result = prepare(source, upper);
  expect(source).toEqual(original);
  expect(paintOwners(result.shapes, { x: 46, y: 25 })).toHaveLength(1);
  expect(result.retainedOverlap).toBeUndefined();
}, 10_000);

it('cuts each destination when two vertical boundaries are one representable step apart', () => {
  const [first, second, upper] = adjacentPrecisionBoundaries();
  const disjoint: Vector = { ...first, id: 'unaffected', x: 170, y: 80 };
  const source = [first, second, disjoint];
  const original = structuredClone(source);
  expect(mergeControlBounds(first).right).toBe(100.00000000000001);
  expect(mergeControlBounds(second).right).toBe(100);
  expect(paintOwners(source, { x: 90, y: 64 })).toEqual([first, second]);
  const result = prepare(source, upper);
  expect(result.retainedOverlap).toBeUndefined();
  expect(paintOwners(result.shapes, { x: 90, y: 64 })).toHaveLength(1);
  expect(paintOwners(result.shapes, { x: 56, y: 25 })).toHaveLength(1);
  expect(paintOwners(result.shapes, { x: 54, y: 90 })).toHaveLength(1);
  const anchors = result.shapes.flatMap(shape => worldPaths(shape, .001).flat());
  expect(anchors).toContainEqual({ x: 100.00000000000001, y: 12 });
  expect(anchors).toContainEqual({ x: 100, y: 99 });
  expect(result.shapes.find(s => s.id === disjoint.id)).toEqual(disjoint);
  expect(source).toEqual(original);
});

it('gives the touched matching paint one owner outside the new Oval footprint', () => {
  const [first, second, oval] = adjacentPrecisionBoundaries();
  const oldOverlap = { x: 83, y: 43 };
  expect(paintOwners([first, second], oldOverlap)).toEqual([first, second]);
  expect(paintOwners([oval], oldOverlap)).toHaveLength(0);
  const result = prepare([first, second], oval);
  expect(result.retainedOverlap).toBeUndefined();
  expect(result.shapes).toHaveLength(1);
  expect(paintOwners(result.shapes, { x: 91, y: 64 })).toHaveLength(1);
  expect(paintOwners(result.shapes, oldOverlap)).toHaveLength(1);
  expect(paintOwners(result.shapes, { x: 30, y: 20 })).toHaveLength(0);
  expect(result.shapes[0].contours?.[0].some(node => node.in || node.out)).toBe(true);
});

it('certifies a one-ULP orthogonal step but rejects retraced or crossing outlines', () => {
  const stepped = [[40,12],[100.00000000000001,12],[100.00000000000001,72],[100,72],
    [100,99],[25,99],[25,39],[40,39]];
  const ring = (pairs: number[][]): Edge[] => {
    const points = pairs.map(([x,y]) => ({x,y}));
    return points.map((a, index) => {
      const b = points[(index + 1) % points.length];
      return { curve: [a,a,b,b], cubic: false };
    });
  };
  const tick = () => {};
  expect(simpleOrthogonalRing(ring(stepped), tick)).toBe(true);
  expect(simpleOrthogonalRing(ring([...stepped].reverse()), tick)).toBe(true);
  expect(simpleOrthogonalRing(ring([[0,0],[16,0],[8,0],[8,8],[0,8]]), tick)).toBe(false);
  expect(simpleOrthogonalRing(ring([[0,0],[4,0],[4,4],[2,4],[2,-2],[6,-2],[6,6],[0,6]]), tick)).toBe(false);
  expect(() => simpleOrthogonalRing(ring(stepped), () => { throw Error('Work budget exhausted'); })).toThrow('Work budget exhausted');
});

it('finds both distinct Pencil contacts when verified one owner at a time', () => {
  const { horizontal, second, vertical } = consecutiveInkCoordinates();
  for (const owner of [horizontal, second]) {
    const cut = prepareSharedPaintStack([owner], vertical, 'ink');
    expect(cut?.strokes).toHaveLength(2);
    expect(cut?.background.get(owner)).toHaveLength(2);
    expect(cut?.strokes?.map(s => s.y)).toEqual([vertical.y, owner.y]);
  }
});

it('keeps neighboring exact cubic crossings distinct along straight Pencil ink', () => {
  const { first, second, pencil, junctions } = consecutiveCurvedInkCoordinates();
  const source = [first, second];
  const original = structuredClone(source);
  const prepared = prepareSharedPaintStack(source, pencil, 'ink');
  const incoming = prepared?.strokes;
  expect(incoming?.map(shape => ({ x: shape.x, y: shape.y }))).toEqual([
    { x: pencil.x, y: pencil.y }, ...junctions,
  ]);
  expect(incoming?.[1].width).toBe(junctions[1].x - junctions[0].x);
  expect(incoming?.every(shape => shape.kind === 'path' && shape.strokeWidth === 2 && shape.fillEnabled === false)).toBe(true);
  for (const [i, owner] of source.entries()) {
    const halves = prepared?.background.get(owner);
    expect(halves).toHaveLength(2);
    const controls = halves!.map(half => half.nodes?.map(node => ({
      x: node.x + half.x, y: node.y + half.y,
      ...(node.in && { in: { x: node.in.x + half.x, y: node.in.y + half.y } }),
      ...(node.out && { out: { x: node.out.x + half.x, y: node.out.y + half.y } }),
    })));
    const offset = junctions[i].x - junctions[0].x;
    expect(controls).toEqual([
      [{ x: 40 + offset, y: 0, out: { x: 46 + offset, y: 16 } },
        { ...junctions[i], in: { x: 49 + offset, y: 40 } }],
      [{ ...junctions[i], out: { x: 49 + offset, y: 88 } },
        { x: 40 + offset, y: 128, in: { x: 46 + offset, y: 112 } }],
    ]);
  }
  expect(source).toEqual(original);
});

it.each([false, true])('retains two oblique cubic contacts at the analytic junctions (reversed: %s)', reversed => {
  const { first, second, pencil, junctions } = consecutiveObliqueInkCoordinates();
  if (reversed) pencil.points.reverse();
  const source = [first, second];
  const original = structuredClone({ source, pencil });
  const prepared = prepareSharedPaintStack(source, pencil, 'ink');
  const strokes = prepared?.strokes;
  expect(strokes).toHaveLength(3);
  const world = (shape: Vector, point: Point) => ({ x: point.x + shape.x, y: point.y + shape.y });
  const split = strokes!.slice(1).map(shape => world(shape, shape.points[0]));
  expect(split).toEqual(reversed ? junctions.slice().reverse() : junctions);
  expect(strokes!.every(s => s.kind === 'path' && s.strokeWidth === pencil.strokeWidth && s.fillEnabled === false)).toBe(true);
  for (const [i, owner] of source.entries()) {
    const halves = prepared?.background.get(owner);
    expect(halves).toHaveLength(2);
    expect(halves?.every(s => s.kind === 'bezier' && s.nodes?.some(n => n.in || n.out))).toBe(true);
    expect(halves?.map((half, index) => world(half, index ? half.nodes![0] : half.nodes!.at(-1)!)))
      .toEqual([junctions[i], junctions[i]]);
  }
  expect({ source, pencil }).toEqual(original);
});

it('classifies a true midpoint between adjacent binary64 coordinates and refuses a probe on the boundary', () => {
  const left = 100, right = left + 2 ** -46;
  const line = (a: Point, b: Point): Edge => ({ cubic: false, curve: [a, a, b, b] });
  const box = [{x:left,y:10},{x:right,y:10},{x:right,y:90},{x:left,y:90}];
  const edges = box.map((p,i) => line(p,box[(i+1)%box.length]));
  const probe = line({x:left,y:50},{x:right,y:50});
  expect(() => paintClassifier(edges, () => {})(probe)).toThrow('Ambiguous paint boundary');
  const classify = paintClassifier(edges, () => {}, true);
  expect(classify(probe)).toBe(true);
  expect(classify(line({x:right,y:50},{x:right + 2 ** -46,y:50}))).toBe(false);
  expect(() => classify(line({x:left,y:40},{x:left,y:60}))).toThrow('Ambiguous paint boundary');
});

it('cuts different colored paint on both sides of the tiny gap without filling or welding it', () => {
  const { left, right, pencil, junctions } = consecutiveObliquePaintBoundaries();
  const source = [left, right];
  const original = structuredClone(source);
  const result = prepareSharedPaintStack(source, pencil, 'ink');
  expect(result?.strokes).toHaveLength(5);
  const gap = result!.strokes![2];
  expect(gap.points.map(point => ({ x: gap.x + point.x, y: gap.y + point.y }))).toEqual(junctions);
  for (const [owner, samples] of [[left,[{x:25,y:32},{x:25,y:92}]], [right,[{x:80,y:38},{x:80,y:95}]]] as const) {
    const pieces = result!.background.get(owner)!;
    expect(pieces).toHaveLength(2);
    expect(pieces.every(s => s.fill === owner.fill && s.strokeWidth === 0 &&
      s.contours?.some(ring => ring.some(n => n.in || n.out)))).toBe(true);
    const owners = samples.map(point => paintOwners(pieces, point));
    expect(owners.map(found => found.length)).toEqual([1, 1]);
    expect(owners[0][0].id).not.toBe(owners[1][0].id);
  }
  expect(source).toEqual(original);
});

it('settles two separate groups of close cubic crossings in one Pencil span', () => {
  const { arcs, pencil, junctions } = twoGroupsOfObliqueInkCrossings();
  const original = structuredClone(arcs);
  const result = prepareSharedPaintStack(arcs, pencil, 'ink');
  expect(result?.strokes).toHaveLength(5);
  expect(result?.strokes?.slice(1).map(s => ({ x: s.x + s.points[0].x, y: s.y + s.points[0].y }))).toEqual(junctions);
  expect(result?.strokes?.every(s => s.kind === 'path' && s.strokeWidth === 2 && s.fillEnabled === false)).toBe(true);
  for (const [i, arc] of arcs.entries()) {
    const halves = result?.background.get(arc);
    expect(halves).toHaveLength(2);
    expect(halves?.every(s => s.kind === 'bezier' && s.nodes?.some(n => n.in || n.out))).toBe(true);
    expect(halves?.map((half,index) => {
      const node = index ? half.nodes![0] : half.nodes!.at(-1)!;
      return {x:half.x+node.x,y:half.y+node.y};
    })).toEqual([junctions[i],junctions[i]]);
  }
  expect(arcs).toEqual(original);
});

it('declines an interior contact when the signed-distance polynomial may have multiple roots', () => {
  let work = 0;
  // These signed-distance coefficients [-64,112,-112,64] have three
  // sign changes and the cubic intersects at u = .2, .5 and .8.
  const hit = uniqueLineCubicContact({x:0,y:100},{x:100,y:100},
    [{x:0,y:36},{x:30,y:212},{x:60,y:-12},{x:90,y:164}], n => { work += n; });
  expect(hit).toBeUndefined();
  expect(work).toBe(0);
});

it('retains the sources when distinct exact crossings round to the same stored point', () => {
  const { arcs: source, pencil } = collidingObliqueInkCrossings();
  // The shifted control remains on the same signed-distance level. At
  // u = .5 its Bernstein weight is 3/8, so the roots differ by less than
  // half a binary64 step on each coordinate at (129,120.5).
  for (const arc of source.slice(2)) {
    const [a, d] = arc.nodes!;
    const [p, q, r, s] = [a,a.out!,d.in!,d].map(n => ({x:arc.x+n.x,y:arc.y+n.y}));
    expect(uniqueLineCubicContact({x:8,y:60},{x:168,y:140},[p,q,r,s],() => {}))
      .toEqual({u:.5,point:{x:129,y:120.5}});
  }
  const original = structuredClone(source);
  expect(prepareSharedPaintStack(source, pencil, 'ink')).toBeUndefined();
  expect(source).toEqual(original);
});

it('keeps crossings distinct on either axis and shares only the confirmed straight junction', () => {
  const { curves, straight, pencil, junctions } = mixedObliqueInkCrossings();
  const owners = [...curves, ...straight];
  const before = structuredClone(owners);
  const result = prepareSharedPaintStack(owners, pencil, 'ink');
  expect(result?.strokes).toHaveLength(6);
  expect(result?.strokes?.slice(1).map(s => ({ x:s.x+s.points[0].x, y:s.y+s.points[0].y }))).toEqual(junctions);
  expect(result?.strokes?.[1].width).toBe(0);
  expect(result?.strokes?.[1].height).toBeGreaterThan(0);
  for (const [i,owner] of owners.entries()) {
    const pieces = result?.background.get(owner);
    expect(pieces).toHaveLength(2);
    expect(pieces?.every(s => s.stroke === owner.stroke && s.strokeWidth === owner.strokeWidth)).toBe(true);
    const seam = junctions[[0,1,3,4,2,2][i]];
    for (const piece of pieces ?? []) {
      const nodes = piece.nodes ?? piece.points;
      expect(nodes.some(p => piece.x + p.x === seam.x && piece.y + p.y === seam.y)).toBe(true);
    }
  }
  expect(owners).toEqual(before);
});

it('requires exact equality of straight intersections with independently parameterized boundaries', () => {
  const start = {x:128,y:0}, end = {x:248,y:60};
  const line = [{x:180,y:-5},{x:180,y:75}] as const;
  expect(sameStraightCrossing(start,end,line,[{x:180,y:95},{x:180,y:1}])).toBe(true);
  expect(sameStraightCrossing(start,end,line,[{x:180 + 2 ** -45,y:1},{x:180 + 2 ** -45,y:95}])).toBe(false);
  const close = [{x:180,y:25},{x:180 + 2 ** -45,y:95}] as const;
  expect(lineContacts(start,end,...close)[0].point).toEqual(lineContacts(start,end,...line)[0].point);
  expect(sameStraightCrossing(start,end,line,close)).toBe(false);
  expect(sameStraightCrossing(start,end,line,[{x:160,y:16},{x:200,y:36}])).toBe(false);
});

it('retries changed owner geometry even when the earlier failed merge used the same IDs', () => {
  const { arcs, pencil } = collidingObliqueInkCrossings();
  const retry: InkPaintRetry = { bounds: mergeControlBounds };
  const merge = (owners: Vector[]) => partitionInkOverPaint([...owners, pencil], pencil, mergeControlBounds,
    undefined, false, false, retry);
  expect(merge(arcs)).toBeUndefined();
  expect(retry.declined?.sources).toEqual(arcs);
  expect(merge(arcs.slice())).toBeUndefined();
  const separated = twoGroupsOfObliqueInkCrossings().arcs[3];
  const changed = [...arcs.slice(0,3), { ...separated, id: arcs[3].id }];
  const prepared = merge(changed);
  expect(prepared?.strokes).toHaveLength(5);
  expect(prepared?.background.get(changed[3])).toHaveLength(2);
});

it('preserves rebased local knots through JSON reopen but reproduces their collapse in world projection', () => {
  const { arcs, pencil } = collidingObliqueInkCrossings();
  const origin = { x: 128, y: 120 };
  // This replay uses translation-only fixture vectors. Take the same world
  // controls as the current cutter before shifting the private coordinates.
  const rebase = (shape: Vector): Vector => {
    const shift = (p: Point) => ({ x: (shape.x + p.x) - origin.x, y: (shape.y + p.y) - origin.y });
    return { ...shape, x: 0, y: 0, points: shape.points.map(shift), nodes: shape.nodes?.map(node => ({
      ...shift(node), ...(node.in && {in:shift(node.in)}), ...(node.out && {out:shift(node.out)}),
    })) };
  };
  const prepared = prepareSharedPaintStack(arcs.map(rebase), rebase(pencil), 'ink');
  expect(prepared?.strokes).toHaveLength(5);
  const project = newProject();
  project.layers[0].keys[0].shapes = prepared!.strokes!.map(shape => ({
    ...shape, x: shape.x + origin.x, y: shape.y + origin.y,
  }));
  const reopened = JSON.parse(JSON.stringify(project)) as Project;
  validateProject(reopened);
  const between = reopened.layers[0].keys[0].shapes[3];
  expect(between.kind).toBe('path');
  expect(between.points).toEqual(project.layers[0].keys[0].shapes[3].points);
  expect(between.points[1].x - between.points[0].x).toBe(3 / 8 * 2 ** -45);
  expect(worldPaths(between)).toEqual([[{ x: 129, y: 120.5 }, { x: 129, y: 120.5 }]]);
});

it('selects and erases the stored round-capped Pencil piece even when its translated centerline rounds to a point', () => {
  const project = newProject();
  project.layers[0].keys[0].shapes = [subpixelPencilPiece()];
  const reopened = JSON.parse(JSON.stringify(project)) as Project;
  validateProject(reopened);
  const shape = reopened.layers[0].keys[0].shapes[0];
  const source = structuredClone(shape);
  expect(worldPaths(shape)[0][0]).toEqual(worldPaths(shape)[0][1]);
  expect(shape.points[0]).not.toEqual(shape.points[1]);
  const mask: PaintRegion = [[[[110,103],[147,103],[147,138],[110,138],[110,103]]]];
  const cut = prepareStrokeCut(mask);
  expect(cut(shape,'inside')[0]).toBe(shape);
  expect(cut(shape,'outside')).toEqual([]);
  expect(worldStrokePolygons(shape)).toHaveLength(1);
  const untouched = { ...shape, id: 'protected-piece', x: 250 };
  const erased = prepareEraseDrawing([shape, untouched], {
    trail: [{x:129,y:120.5}], radius: 16, mode: 'strokes', merge: true,
  });
  expect(erased.artwork).toEqual([untouched]);
  expect(shape).toEqual(source);
});

it('keeps the whole source when a collapsed span touches a mask boundary after earlier spans were clipped', () => {
  const tiny = subpixelPencilPiece();
  const shape = { ...tiny, points: [{ x: -20, y: 0 }, ...tiny.points], width: 20 };
  const mask: PaintRegion = [[[[100,105],[129,105],[129,137],[100,137],[100,105]]]];
  const cut = prepareStrokeCut(mask);
  expect(cut(shape,'inside')).toEqual([]);
  expect(cut(shape,'outside')[0]).toBe(shape);
});

it('splits a translated two-knot stroke at a representable local mask crossing and retains its origin on reopen', () => {
  const shape = subpixelPencilAcrossOrigin();
  const original = structuredClone(shape);
  expect(worldPaths(shape)).toEqual([[{x:129,y:120.5},{x:129,y:120.5}]]);
  const mask: PaintRegion = [[[[110,102],[129,102],[129,140],[110,140],[110,102]]]];
  const cut = prepareStrokeCut(mask);
  const inside = cut(shape,'inside'), outside = cut(shape,'outside');
  expect(inside).toHaveLength(1);
  expect(outside).toHaveLength(1);
  expect(inside[0].points).toEqual([shape.points[0],{x:0,y:0}]);
  expect(outside[0].points).toEqual([{x:0,y:0},shape.points[1]]);
  const project = newProject();
  project.layers[0].keys[0].shapes = [...inside,...outside];
  const reopened = JSON.parse(JSON.stringify(project)) as Project;
  validateProject(reopened);
  expect(reopened.layers[0].keys[0].shapes.map(piece => ({
    x:piece.x,y:piece.y,width:piece.width,height:piece.height,stroke:piece.stroke,
  }))).toEqual(Array.from({length:2}, () => ({
    x:shape.x,y:shape.y,width:shape.width/2,height:shape.height/2,stroke:shape.stroke,
  })));
  expect(shape).toEqual(original);
});

it('retains the original when a mask intersection cannot be stored exactly in the existing local basis', () => {
  const shape = subpixelPencilAcrossOrigin();
  shape.points = shape.points.map(p => ({x:p.x,y:0}));
  shape.height = 0;
  const diagonal: PaintRegion = [[[[128,119.5],[131,122.5 + 2 ** -46],[131,130],[128,130],[128,119.5]]]];
  const cut = prepareStrokeCut(diagonal);
  expect(cut(shape,'inside')).toEqual([]);
  expect(cut(shape,'outside')[0]).toBe(shape);
});

it('represents two neighboring Pencil contacts without welding their vertices', () => {
  const { horizontal, second, vertical } = consecutiveInkCoordinates();
  const cut = prepareSharedPaintStack([horizontal, second], vertical, 'ink');
  expect(cut?.strokes).toHaveLength(3);
  expect(cut?.background.get(horizontal)).toHaveLength(2);
  expect(cut?.background.get(second)).toHaveLength(2);
  expect(cut?.strokes?.map(s => s.y)).toEqual([vertical.y, horizontal.y, second.y]);
  expect(cut?.strokes?.[1].height).toBe(second.y - horizontal.y);
  expect(cut?.strokes?.every(stroke => stroke.kind === 'path' && stroke.strokeWidth === 2)).toBe(true);
  const reversed = { ...vertical, points: vertical.points.slice().reverse() };
  const reverseCut = prepareSharedPaintStack([horizontal, second], reversed, 'ink');
  expect(reverseCut?.strokes?.map(s => worldPaths(s, .001)[0][0].y)).toEqual([95, second.y, horizontal.y]);
});

it('preserves both contacts when Optimize reduces the incoming straight stroke', () => {
  const { horizontal, second, vertical } = consecutiveInkCoordinates();
  const authored: Vector = {
    ...horizontal, kind: 'bezier', points: [],
    nodes: [{ x: 0, y: 0, out: { x: 20, y: 0 } }, { x: 60, y: 0, in: { x: 40, y: 0 } }],
  };
  const stroke: Vector = { ...vertical, stroke: '#e23257', points: [0, 17, 69, 90].map(y => ({ x: 0, y })) };
  const outcome = preparePencilDrawing([authored, second], { stroke, mode: 'ink', merge: true, optimize: true });
  expect(outcome.shape.kind).toBe('path');
  expect(outcome.shape.points).toEqual([stroke.points[0], stroke.points.at(-1)]);
  // The two old lines lie closer than SNAP: to the merge they are one line, which the new stroke
  // crosses once, and both are cut there.
  const incoming = outcome.shapes.filter(s => s.stroke === stroke.stroke).map(s => objectBounds(s));
  expect(incoming).toHaveLength(2);
  expect(incoming[0].top).toBe(5);
  expect(Math.abs(incoming[1].top - horizontal.y)).toBeLessThan(1e-9);
  const previousInk = outcome.shapes.filter(s => s.stroke === horizontal.stroke);
  expect(previousInk.length).toBeGreaterThanOrEqual(2);
  expect(previousInk.every(s => objectBounds(s).bottom - objectBounds(s).top < 1e-9 && s.strokeWidth === 2)).toBe(true);
});

describe.skipIf(!saved)('another merge fail, pinned saved revision', () => {
  const oldOverlap = { x: 220.31, y: 162.23 };
  const fixture = () => {
    const artwork = saved!;
    return {
      artwork,
      lower: artwork.find(s => s.id === 'c7af1829-7c43-4929-b150-9afb16df1407')!,
      upper: artwork.find(s => s.id === 'b3e1c14a-d258-40ca-bbf3-1b32a26bf04f')!,
    };
  };
  const indirectOverlap = () => {
    const { artwork, upper } = fixture();
    const first = artwork.find(s => s.id === '796e4da6-b6f4-4d33-8f95-70e0b7c7b2b4')!;
    const second = artwork.find(s => s.id === 'bb4ade4f-73f6-4a11-99be-130246746000')!;
    return { first, second, upper };
  };

  it('identifies the penultimate fill and positive-area overlap on the original frame', () => {
    const { artwork, lower, upper } = fixture();
    expect(artwork).toHaveLength(1018);
    expect(artwork.at(-2)).toBe(upper);
    expect(lower.contours?.map(ring => ring.length)).toEqual([11, 4]);
    expect(paintOwners([lower, upper], { x: 222.25, y: 175.75 })).toEqual([lower, upper]);
    expect(paintOwners([lower, upper], { x: 210.25, y: 169.25 })).toEqual([lower]);
    expect(paintOwners([lower, upper], { x: 254.5, y: 171.25 })).toEqual([upper]);
  });

  it('replays the reduced saved fill with a single owner at the overlap', () => {
    const { lower, upper } = fixture();
    const result = prepare([lower], upper);
    expect(paintOwners(result.shapes, { x: 222.25, y: 175.75 })).toHaveLength(1);
    expect(result.retainedOverlap).toBeUndefined();
  });

  it('cuts the penultimate saved fill over the preceding 1,016 vectors', () => {
    const { artwork, upper } = fixture();
    const source = artwork.slice(0, -2);
    const original = structuredClone(source);
    const result = prepare(source, upper);
    expect(result.retainedOverlap).toBeUndefined();
    const footprint = worldPaths(upper, .003);
    const covered = (rings:Point[][], point:Point) =>
      rings.reduce((inside, ring) => inside !== containsPoint(ring, point), false);
    const nearby = (shapes: Vector[]) => shapes
      .filter(s => !s.strokeWidth && mergeControlBounds(s).right >= 217 && mergeControlBounds(s).left <= 259)
      .map(s => worldPaths(s, .003));
    const originalPaint = nearby(source), currentPaint = nearby(result.shapes);
    let samples = 0;
    for (let x=219.2; x<256; x+=1.3) for (let y=169.15; y<194; y+=1.3) {
      const point = { x, y };
      if (![[0,0],[-.15,0],[.15,0],[0,.15],[0,-.15]].every(([dx,dy]) =>
        covered(footprint, { x:x+dx, y:y+dy }))) continue;
      if (originalPaint.some(paths => covered(paths, point))) samples++;
      expect(currentPaint.filter(paths => covered(paths,point)), JSON.stringify(point)).toHaveLength(1);
    }
    expect(samples).toBeGreaterThan(25);
    const edited = result.shapes.find(s => s.id === upper.id);
    expect(edited?.contours?.some(ring => ring.some(n => n.in || n.out))).toBe(true);
    expect(source).toEqual(original);
  });

  it('gives the affected saved matching paint one owner outside the new fill', () => {
    const { artwork, upper } = fixture();
    const source = artwork.slice(0, -2);
    const earlier = paintOwners(source, oldOverlap);
    expect(earlier.map(s => s.id)).toEqual([
      '796e4da6-b6f4-4d33-8f95-70e0b7c7b2b4', 'bb4ade4f-73f6-4a11-99be-130246746000',
    ]);
    expect(earlier.every(s => s.fill === upper.fill && (s.opacity ?? 1) === 1)).toBe(true);
    expect(paintOwners([upper], oldOverlap)).toHaveLength(0);
    const result = prepare(source, upper);
    expect(result.retainedOverlap).toBeUndefined();
    expect(paintOwners(result.shapes, { x: 222.25, y: 175.75 })).toHaveLength(1);
    expect(paintOwners(result.shapes, oldOverlap)).toHaveLength(1);
  });

  it('certifies the reduced three-fill union using only the original curves', () => {
    const { first, second, upper } = indirectOverlap();
    const original = structuredClone([first, second, upper]);
    const incomingBounds = mergeControlBounds(upper);
    expect([first, second].filter(s => mayIntersectPaint(s, incomingBounds))).toEqual([first]);
    expect(paintOwners([first, second, upper], oldOverlap)).toEqual([first, second]);

    const earlier = prepareSharedPaintStack([first], second, 'union');
    expect(earlier?.background.get(first)).toEqual([]);
    const union = prepareSharedPaintStack([earlier!.foreground], upper, 'union');
    expect(union?.background.get(earlier!.foreground)).toEqual([]);
    const shape = union!.foreground;
    expect(shape.id).toBe(upper.id);
    expect(shape.contours?.[0].some(node => node.in || node.out)).toBe(true);
    for (const [point, owners] of [
      [{ x: 204.81, y: 159.73 }, [first]],
      [{ x: 217.31, y: 157.23 }, [second]],
      [{ x: 217.81, y: 172.73 }, [upper]],
      [oldOverlap, [first, second]],
      [{ x: 221.81, y: 172.23 }, [first, upper]],
    ] as [Point, Vector[]][]) {
      expect(paintOwners([first, second, upper], point)).toEqual(owners);
      expect(paintOwners([shape], point)).toEqual([shape]);
    }
    expect(paintOwners([shape], { x: 195.31, y: 145.23 })).toEqual([]);
    const doc = newProject();
    doc.layers[0].keys[0].shapes = [shape];
    expect(() => validateProject(JSON.parse(JSON.stringify(doc)))).not.toThrow();
    expect([first, second, upper]).toEqual(original);
  });

  it('includes a matching saved curve reached only through the directly touched fill', () => {
    const { first, second, upper } = indirectOverlap();
    const result = prepare([first, second], upper);
    expect(result.retainedOverlap).toBeUndefined();
    expect(result.shapes).toHaveLength(1);
    expect(paintOwners(result.shapes, oldOverlap)).toEqual(result.shapes);
    expect(paintOwners(result.shapes, { x: 217.31, y: 157.23 })).toEqual(result.shapes);
    expect(paintOwners(result.shapes, { x: 217.81, y: 172.73 })).toEqual(result.shapes);
  });

  it('keeps the original paint slots when a different color separates overlapping curves', () => {
    const { first, second, upper } = indirectOverlap();
    const [foreground] = prepare([first], upper).shapes;
    const separator: Vector = {
      id: 'intervening-paint', kind: 'rectangle', fill: '#e23257', stroke: '#000000',
      strokeWidth: 0, x: 215, y: 160, width: 14, height: 10, rotation: 0, points: [], drawingMode: 'merge',
    };
    const artwork = [second, separator, foreground];
    const original = structuredClone(artwork);
    expect(paintOwners(artwork, oldOverlap)).toEqual(artwork);
    expect(prepareSharedPaintStack([second], foreground, 'union')?.background.get(second)).toEqual([]);
    expect(joinOverlayFills(artwork, upper)).toEqual(original);
    expect(artwork).toEqual(original);
  });

  it('settles a representative different-color Brush crossing on the full saved frame', () => {
    const { artwork } = fixture();
    const brush: Vector = {
      id: 'paint-probe', kind: 'brush', x: 0, y: 0, width: 960, height: 540, rotation: 0,
      strokeWidth: 24, stroke: '#111111', fill: '#e23257',
      points: [{ x: 130, y: 200 }, { x: 200, y: 170 }, { x: 275, y: 225 }, { x: 365, y: 172 }],
    };
    const result = prepareBrushPaint(artwork, {
      brush, mode: 'normal', amount: .5, optimize: true, merge: true,
      at: artwork.length, selected: [], removeCoveredStrokes: true,
    });
    expect(result.retainedOverlap).toBeUndefined();
    const [footprint] = result.shapes.filter(s => s.fill === brush.fill);
    expect(footprint.contours?.some(path => path.some(node => node.in || node.out))).toBe(true);
    const originalPaint = artwork.filter(s => !s.strokeWidth).map(s => ({fill:s.fill, paths:worldPaths(s, .02)}));
    const savedPaint = result.shapes.filter(s => !s.strokeWidth).map(s => ({fill:s.fill, paths:worldPaths(s, .02)}));
    const incoming = worldPaths(footprint, .02);
    const owns = (paths:Point[][], point:Point) =>
      paths.reduce((inside, ring) => inside !== containsPoint(ring,point), false);
    let overlaps = 0;
    for (let y=164.53; y<230; y+=5) for (let x=137.22; x<361; x+=5) {
      const point = {x,y};
      if (![[0,0],[-1,0],[1,0],[0,1],[0,-1]].every(([dx,dy]) => owns(incoming,{x:x+dx,y:y+dy}))) continue;
      if (!originalPaint.some(s => owns(s.paths,point))) continue;
      expect(savedPaint.filter(s => owns(s.paths,point)).map(s => s.fill), JSON.stringify(point)).toEqual([brush.fill]);
      overlaps++;
    }
    expect(overlaps).toBeGreaterThan(25);
  });

  it('keeps the entire saved mixed layer exact when Brush lands outside every old control hull', () => {
    const { artwork } = fixture();
    const brush: Vector = { id: 'distant-brush', kind: 'brush', x: 450, y: 40, width: 0, height: 80, rotation: 0,
      strokeWidth: 8, stroke: '#111111', fill: '#b3a932', points: [{ x: 0, y: 0 }, { x: 0, y: 80 }] };
    const request: BrushCommit = { brush, mode: 'normal', amount: .5, optimize: true, merge: true,
      at: artwork.length, selected: [], removeCoveredStrokes: true };
    const original = structuredClone(artwork);
    const blank = prepareBrushPaint([], { ...request, at: 0 }).shapes[0];
    const painted = prepareWorkerBrushPaint(artwork, request, undefined, 4, true);
    expect(painted.retainedOverlap).toBeUndefined();
    expect(painted.shapes).toHaveLength(artwork.length + 1);
    expect(painted.unchangedRoots).toStrictEqual(artwork.map((_, i) => ({ input: i, output: i })));
    expect(painted.damage?.artwork).toStrictEqual([painted.shapes[artwork.length]]);
    expect(painted.shapes.slice(0, artwork.length).every((s, i) => s === artwork[i])).toBe(true);
    expect({ ...painted.shapes[artwork.length], id: blank.id }).toStrictEqual(blank);
    expect(artwork).toStrictEqual(original);
  });

  it('settles the dense saved Pencil without changing the caller\'s artwork', () => {
    const { artwork } = fixture();
    const original = structuredClone(artwork);
    const result = prepareShapeDrawing(artwork, { shape: densePencil, merge: true });
    expect(result.retainedOverlap).toBeUndefined();
    expect(result.shapes.some(s => s.stroke === densePencil.stroke && s.fillEnabled === false)).toBe(true);
    expect(result.shapes[0]).not.toBe(artwork[0]);
    expect(artwork).toEqual(original);
  });

  it('sends the settled layer for the dense saved Pencil from the worker', () => {
    const { artwork } = fixture();
    const original = structuredClone(artwork);
    const { nodes, ...style } = densePencil;
    const stroke: Vector = { ...style, kind: 'path', points: nodes!.map(({ x, y }) => ({ x, y })) };
    const request = { stroke, mode: 'smooth', merge: true } as const;
    const legacy = preparePencilDrawing(artwork, request);
    expect(legacy.retainedOverlap).toBeUndefined();
    const reply = structuredClone(prepareWorkerPencilDrawing(artwork, request));
    expect(reply.retainedOverlap).toBeUndefined();
    // The worker sends the settled layer; it matches the direct preparation piece for piece.
    expect(reply.shapes!.map(s => worldPaths(s, .01))).toEqual(legacy.shapes.map(s => worldPaths(s, .01)));
    expect(artwork).toEqual(original);
  });

  it('settles a representative Pencil zigzag on the full saved frame', () => {
    const { artwork } = fixture();
    const result = prepareShapeDrawing(artwork, { shape: densePencil, merge: true });
    expect(result.retainedOverlap).toBeUndefined();
  });

  for (const mode of ['ink', 'smooth'] as const) {
    it(`settles the saved-frame Pencil gesture in ${mode} mode`, () => {
      const { artwork } = fixture();
      const { nodes, ...style } = densePencil;
      const stroke: Vector = { ...style, kind: 'path', points: nodes!.map(({ x, y }) => ({ x, y })) };
      const result = preparePencilDrawing(artwork, { stroke, mode, merge: true, optimize: false });
      expect(result.retainedOverlap).toBeUndefined();
    });
  }

  const inkOwners = ['d9c85457-0148-4bb4-bcb8-0eba85a4a33a', '41a4cb87-52f3-4831-a3d9-1f64b36e1932'];
  const combinations = [
    { name: 'two paint faces', ids: ['bd726b8f-e6ff-4caa-abcb-8835864e497c', 'fd6ab281-cde2-46cf-9098-4bab62ba766c'] },
    { name: 'a paint face and its neighboring ink', ids: ['fd6ab281-cde2-46cf-9098-4bab62ba766c', '4e65ae7f-8b04-46fc-a107-eff13a1ed8a1'] },
  ];
  const ownersFor = (ids: string[]) => ids.map(id => fixture().artwork.find(s => s.id === id)!);

  const closeFillIds = ['c7af1829-7c43-4929-b150-9afb16df1407', 'fc1aa69c-3be4-4a43-8b25-01b43b51e05f'];
  const closeFillPencil: Vector = { ...densePencil, x: 200, y: 170, width: 75,
    kind: 'path', nodes: undefined, points: [{ x: 0, y: 0 }, { x: 75, y: 55 }] };

  function closeFillsInBasis(owners: Vector[], origin: Point) {
    return owners.map(owner => {
      const place = (p: Point) => {
        const world = worldPoint(owner, p);
        const relative = { x: world.x - origin.x, y: world.y - origin.y };
        for (const axis of ['x', 'y'] as const)
          expect(paintCoordinateUnits(relative[axis]) + paintCoordinateUnits(origin[axis]))
            .toBe(paintCoordinateUnits(world[axis]));
        return relative;
      };
      return { ...owner, x: 0, y: 0, contours: owner.contours!.map(ring => ring.map(node => ({
        ...place(node), ...(node.in && { in: place(node.in) }), ...(node.out && { out: place(node.out) }),
      }))) };
    });
  }

  it('refines distinct crossings through both saved filled contours in a nearby document basis', () => {
    const owners = ownersFor(closeFillIds);
    const source = structuredClone(owners);
    const origin = { x: 224.5, y: 188 };
    const { arcs, pencil } = nearbySavedPencilCrossings(origin.x);
    const local = closeFillsInBasis(owners, origin);
    expect(local.map(s => s.contours!.map(ring => ring.length))).toEqual([[11, 4], [11]]);
    const proved = arcs.map(arc => {
      const [a, b] = arc.nodes!;
      return uniqueLineCubicContact(pencil.points[0], pencil.points[1], [a, a.out!, b.in!, b], () => {})!.point;
    });
    expect(proved.map(p => p.x)).toEqual([0.024017061007052216, 0.024017061007052348]);
    expect(proved.map(p => p.x + origin.x)).toEqual([224.52401706100704, 224.52401706100704]);
    const result = prepareShapeDrawing(local, { shape: pencil, merge: true });
    expect(result.retainedOverlap).toBeUndefined();
    // Both proved crossings lie closer than SNAP, so the merge makes them one junction. The line
    // stays one line; both fills are cut and keep their curves.
    const ink = result.shapes.filter(s => s.strokeWidth);
    expect(ink).toHaveLength(1);
    const fills = result.shapes.filter(s => !s.strokeWidth);
    expect(fills.length).toBeGreaterThan(local.length);
    expect(fills.every(s => s.contours?.some(ring => ring.some(n => n.in || n.out)))).toBe(true);
    const project = newProject();
    project.layers[0].keys[0].shapes = result.shapes;
    const reopened = JSON.parse(JSON.stringify(project)) as Project;
    expect(() => validateProject(reopened)).not.toThrow();
    expect(reopened.layers[0].keys[0].shapes.map(s => worldPaths(s))).toEqual(result.shapes.map(s => worldPaths(s)));
    expect(owners).toEqual(source);
  });

  it('keeps the junctions the line shares with the saved fills exact through save and reopen', () => {
    const origin = { x: 224, y: 188 };
    const { pencil } = nearbySavedPencilCrossings(origin.x);
    const local = closeFillsInBasis(ownersFor(closeFillIds), origin);
    const result = prepareShapeDrawing(local, { shape: pencil, merge: true });
    expect(result.retainedOverlap).toBeUndefined();
    const project = newProject();
    project.layers[0].keys[0].shapes = result.shapes;
    const reopened = JSON.parse(JSON.stringify(project)) as Project;
    expect(() => validateProject(reopened)).not.toThrow();
    const placed = reopened.layers[0].keys[0].shapes;
    // Pieces are stored in the layer's own basis, so the line and the fills keep their shared
    // junctions bit for bit.
    const [line] = placed.filter(s => s.strokeWidth);
    const anchors = (line.nodes ?? line.points).map(p => worldPoint(line, p));
    const fillAnchors = placed.filter(s => !s.strokeWidth).flatMap(s => s.contours!.flat().map(p => worldPoint(s, p)));
    const shared = anchors.filter(a => fillAnchors.some(q => q.x === a.x && q.y === a.y));
    expect(shared.length).toBeGreaterThan(0);
    for (const a of shared) expect(fillAnchors.filter(q => q.x === a.x && q.y === a.y).length).toBeGreaterThanOrEqual(2);
  });

  it('prepares an exact shared placement and separate authoring bounds for the saved filled cut', () => {
    const owners = ownersFor(closeFillIds);
    const origin = { x: 224.5, y: 188 };
    const original = structuredClone({ owners, pencil: closeFillPencil, origin });
    const prepared = prepareFilledInkInBasis(owners, closeFillPencil, origin);
    expect(prepared?.origin).toEqual(origin);
    expect(prepared?.origin).not.toBe(origin);
    expect(prepared?.ink).toHaveLength(11);
    expect(owners.map(owner => prepared?.fills.get(owner)?.length)).toEqual([5, 3]);
    const tiny = prepared!.ink[6], [first, second] = tiny.contours[0];
    expect([first, second]).toEqual([
      { x: 0.024017061007052216, y: -0.01572082192816171 },
      { x: 0.024017061007052348, y: -0.015720821928161613 },
    ]);
    expect(tiny.bounds).toEqual({ left: first.x, right: second.x, top: first.y, bottom: second.y });
    expect(prepared!.ink[0].contours[0][0]).toEqual({ x: -24.5, y: -18 });
    expect(prepared!.ink.at(-1)!.contours[0].at(-1)).toEqual({ x: 50.5, y: 37 });
    const fills = [...prepared!.fills.values()].flat();
    const source = owners[1], [before, after] = source.contours![0].slice(1, 3);
    const samePlacedPoint = (local: Point | undefined, original: Point) => !!local &&
      (['x', 'y'] as const).every(axis =>
        paintCoordinateUnits(origin[axis]) + paintCoordinateUnits(local[axis]) ===
        paintCoordinateUnits(source[axis]) + paintCoordinateUnits(original[axis]));
    expect(prepared!.fills.get(source)!.some(piece => piece.contours.some(ring => ring.some((a, index) => {
      const b = ring[(index + 1) % ring.length];
      return samePlacedPoint(a, before) && samePlacedPoint(a.out, before.out!) &&
        samePlacedPoint(b.in, after.in!) && samePlacedPoint(b, after) ||
        samePlacedPoint(a, after) && samePlacedPoint(a.out, after.in!) &&
        samePlacedPoint(b.in, before.out!) && samePlacedPoint(b, before);
    })))).toBe(true);
    for (const point of [first, second]) {
      expect(prepared!.ink.filter(piece => piece.contours.flat().some(p => p.x === point.x && p.y === point.y))).toHaveLength(2);
      expect(fills.filter(piece => piece.contours.flat().some(p => p.x === point.x && p.y === point.y))).toHaveLength(2);
    }
    for (const piece of fills) {
      const controls = piece.contours.flat().flatMap(node => [node, node.in, node.out].filter(p => p !== undefined));
      expect(piece.bounds).toEqual({
        left: Math.min(...controls.map(p => p.x)), right: Math.max(...controls.map(p => p.x)),
        top: Math.min(...controls.map(p => p.y)), bottom: Math.max(...controls.map(p => p.y)),
      });
    }
    expect([first.x + origin.x, second.x + origin.x]).toEqual([224.52401706100704, 224.52401706100704]);
    expect(paintCoordinateUnits(origin.x) + paintCoordinateUnits(first.x))
      .not.toBe(paintCoordinateUnits(origin.x) + paintCoordinateUnits(second.x));
    first.x = 0;
    expect(fills.flatMap(piece => piece.contours.flat()).some(node => node.x === 0.024017061007052216)).toBe(true);
    expect({ owners, pencil: closeFillPencil, origin }).toEqual(original);
  });

  it('declines a lossy coordinate origin and an unsupported destination before preparing filled ink', () => {
    const owners = ownersFor(closeFillIds);
    const original = structuredClone(owners);
    expect(prepareFilledInkInBasis(owners, closeFillPencil, { x: 1e7, y: 1e7 })).toBeUndefined();
    expect(prepareFilledInkInBasis([{ ...owners[0], drawingMode: 'object' }, owners[1]], closeFillPencil,
      { x: 224.5, y: 188 })).toBeUndefined();
    expect(owners).toEqual(original);
  });

  it('round-trips exact filled Pencil junctions and their independent authoring boxes through directory storage', async () => {
    const owners = structuredClone(ownersFor(closeFillIds));
    owners[0].pivot = { x: 0, y: 0 };
    const origin = { x: 224.5, y: 188 };
    const original = structuredClone({ owners, pencil: closeFillPencil });
    const cut = preparePlacedFilledInk(owners, closeFillPencil, origin);
    expect(cut?.ink).toHaveLength(11);
    expect(owners.map(owner => cut?.fills.get(owner)?.length)).toEqual([5, 3]);
    const pieces = [...owners.flatMap(owner => cut!.fills.get(owner)!), ...cut!.ink];
    const doc = newProject();
    doc.layers[0].drawingMode = 'merge';
    doc.layers[0].keys[0].shapes = pieces.map(p => p.vector);
    const files = new Map<string, string>();
    const store: DirectoryStore = {
      async read(name) {
        const value = files.get(name);
        if (value === undefined) throw Error('Missing test fixture file.');
        return value;
      },
      async exists(name) { return files.has(name); },
      async writeNew(name, data) {
        if (files.has(name)) throw Error('Unexpected fixture overwrite.');
        files.set(name, data);
      },
      async commit(name, data) { files.set(name, data); },
    };
    const manifest = await saveProject(store, doc, null);
    const reopened = (await loadProject(store)).project;
    expect(JSON.parse(manifest).schemaVersion).toBe(doc.schemaVersion);
    expect(reopened).toStrictEqual(doc);
    const read = reopened.layers[0].keys[0].shapes;
    expect(read.map(localAuthoringBounds)).toEqual(pieces.map(p => p.bounds));
    expect(read.every(s => s.x === origin.x && s.y === origin.y)).toBe(true);
    const short = read[8 + 6];
    const endpoints = [
      { x: 0.024017061007052216, y: -0.01572082192816171 },
      { x: 0.024017061007052348, y: -0.015720821928161613 },
    ];
    expect(short.points).toStrictEqual(endpoints);
    expect(pathCommands(short)).toEqual([['M', endpoints[0].x, endpoints[0].y], ['L', endpoints[1].x, endpoints[1].y]]);
    expect(objectBounds(short).left).toBe(224.52401706100704);
    for (const endpoint of endpoints) {
      const matches = (s: Vector) => (s.contours?.flat() ?? s.points)
        .some(p => p.x === endpoint.x && p.y === endpoint.y);
      expect(read.slice(0, 8).filter(matches)).toHaveLength(2);
      expect(read.slice(8).filter(matches)).toHaveLength(2);
    }
    expect(worldPoint(short, endpoints[0])).toEqual(worldPoint(short, endpoints[1]));
    expect(read[0].pivot && worldPoint(read[0], read[0].pivot)).toEqual({ x: owners[0].x, y: owners[0].y });
    const reopenedPaint = read.slice(0, 8);
    const next: Vector = { ...closeFillPencil, id: 'later-pencil', x: 218, y: 155, width: 0, height: 60,
      points: [{ x: 0, y: 0 }, { x: 0, y: 60 }] };
    delete next.nodes;
    const recentered = filledInkBasisSources(reopenedPaint, next, origin, () => {});
    expect(recentered?.sources.map(s => s.contours)).toStrictEqual(reopenedPaint.map(s => s.contours));
    const legacyLocalPaint = recentered!.sources.map(({ controlBounds: _bounds, ...source }) => source);
    const later = prepareSharedPaintStack(legacyLocalPaint, recentered!.cutter, 'ink');
    expect(later?.strokes).toHaveLength(6);
    expect([...later!.background].map(([source, faces]) => [legacyLocalPaint.indexOf(source), faces.length]))
      .toEqual([[3, 2], [4, 2], [7, 2]]);
    // Later lines through the reopened pieces settle in one planar map: each cuts the paint it
    // crosses and leaves the tiny saved piece it doesn't reach exactly as it was.
    const axial = { ...next, stroke: '#228855' };
    const axialCut = prepareShapeDrawing(read, { shape: axial, merge: true });
    expect(axialCut.retainedOverlap).toBeUndefined();
    const axialFills = axialCut.shapes.filter(s => s.fillEnabled !== false);
    // Matching pieces that no line separates join; the new line divides the paint it crosses.
    const ownerAt = (p: Point) => axialFills.filter(s => worldPaths(s, .001)
      .reduce((inside, ring) => inside !== containsPoint(ring, p), false));
    let divided = 0;
    for (let y = 157; y < 214; y += 2) {
      const left = ownerAt({ x: 217.9, y }), right = ownerAt({ x: 218.1, y });
      expect(left.length).toBeLessThanOrEqual(1);
      expect(right.length).toBeLessThanOrEqual(1);
      if (left.length && right.length) {
        expect(left[0]).not.toBe(right[0]);
        divided++;
      }
    }
    expect(divided).toBeGreaterThan(0);
    expect(axialCut.shapes.find(s => s.id === short.id)).toStrictEqual(short);
    const reversed = prepareShapeDrawing(read, { shape: { ...axial, points: axial.points.slice().reverse() }, merge: true });
    expect(reversed.retainedOverlap).toBeUndefined();
    expect(reversed.shapes.filter(s => s.fillEnabled !== false)).toHaveLength(axialFills.length);
    // A rotated piece is cut like any other.
    const rotated = read.map((s, i) => i === 3 ? { ...s, rotation: 1 } : s);
    expect(prepareShapeDrawing(rotated, { shape: next, merge: true }).retainedOverlap).toBeUndefined();

    const crossing = { ...next, x: 215, stroke: '#228855' };
    const partition = prepareSharedPaintStack(read, crossing, 'ink');
    const oldPieces = partition?.background.get(read[11]);
    expect(oldPieces).toHaveLength(2);
    const junction = oldPieces![0].points.at(-1)!;
    expect(oldPieces![1].points[0]).toStrictEqual(junction);
    expect(partition?.strokes?.filter(s => s.points.some(p => p.x === junction.x && p.y === junction.y))).toHaveLength(2);
    const written = prepareShapeDrawing(read, { shape: crossing, merge: true });
    expect(written.retainedOverlap).toBeUndefined();
    expect(written.shapes.find(s => s.id === short.id)).toStrictEqual(short);
    const newInk = written.shapes.filter(s => s.stroke === crossing.stroke);
    const ends = newInk.flatMap(s => {
      const points = s.nodes ?? s.points;
      return [worldPoint(s, points[0]), worldPoint(s, points.at(-1)!)];
    });
    expect(ends).toContainEqual({ x: 215, y: 155 });
    expect(ends).toContainEqual({ x: 215, y: 215 });
    expect(read).toStrictEqual(doc.layers[0].keys[0].shapes);
    expect({ owners, pencil: closeFillPencil }).toEqual(original);
  });

  it('declines placed artwork when the saved pivot cannot use the common origin exactly', () => {
    const owners = structuredClone(ownersFor(closeFillIds));
    const origin = { x: 224.5, y: 188 };
    owners[0].pivot = { x: Number.MIN_VALUE, y: 0 };
    expect(prepareFilledInkInBasis(owners, closeFillPencil, origin)).toBeDefined();
    expect(preparePlacedFilledInk(owners, closeFillPencil, origin)).toBeUndefined();
    expect(owners[0].pivot.x).toBe(Number.MIN_VALUE);
  });

  it('joins matching Brush paint across reopened junctions while retaining the covered Pencil divider', () => {
    const owners = ownersFor(closeFillIds);
    const origin = { x: 224.5, y: 188 };
    const cut = preparePlacedFilledInk(owners, closeFillPencil, origin)!;
    const read = JSON.parse(JSON.stringify([...owners.flatMap(owner => cut.fills.get(owner)!), ...cut.ink]
      .map(piece => piece.vector))) as Vector[];
    const narrow = read[14];
    const before = structuredClone(read);
    const brush: Vector = { id: 'placed-overpaint', kind: 'brush', x: 224, y: 153, width: 0, height: 80, rotation: 0,
      strokeWidth: 8, stroke: '#111111', fill: read[3].fill,
      points: [{ x: 0, y: 0 }, { x: 0, y: 80 }] };
    const request: BrushCommit = { brush, mode: 'normal', amount: .5, optimize: true,
      merge: true, at: read.length, selected: [], removeCoveredStrokes: false };
    const blank = prepareBrushPaint([], { ...request, at: 0 }).shapes[0];
    const prepared = prepareBrushPaint(read, request);
    expect(prepared.retainedOverlap).toBeUndefined();
    expect(prepared.shapes.find(s => s.id === narrow.id)).toStrictEqual(narrow);
    expect(prepared.shapes.find(s => s.id === read[0].id)).toStrictEqual(read[0]);

    const paint = (items: Vector[]) => items.filter(s => s.fillEnabled !== false)
      .map(s => ({ color: s.fill, rings: worldPaths(s, .01) }));
    const colorsAt = (items: ReturnType<typeof paint>, p: Point) =>
      items.filter(s => s.rings.reduce((inside, ring) => inside !== containsPoint(ring, p), false)).map(s => s.color);
    const old = paint(read), after = paint(prepared.shapes), incoming = paint([blank]);
    let shared = 0;
    for (let y = 163; y < 223; y += 4) for (const x of [222, 224, 226]) {
      const p = { x, y };
      expect(colorsAt(incoming, p)).toEqual([brush.fill]);
      if (colorsAt(old, p).length) shared++;
      expect(colorsAt(after, p)).toEqual([brush.fill]);
    }
    expect(shared).toBe(24);
    for (const p of [{ x: 208, y: 180 }, { x: 232, y: 190 }, { x: 236, y: 198 }])
      expect(colorsAt(after, p)).toEqual(colorsAt(old, p));
    const covered = prepareBrushPaint(read, { ...request, removeCoveredStrokes: true });
    expect(covered.retainedOverlap).toBeUndefined();
    expect(covered.shapes.some(s => s.id === narrow.id)).toBe(false);
    expect(read).toStrictEqual(before);
  });

  it('rejects malformed original controls before computing a shared filled cut', () => {
    const owners = ownersFor(closeFillIds);
    const malformed = structuredClone(owners);
    const node = malformed[1].contours![0][1];
    const getter = vi.fn(() => node.y);
    Object.defineProperty(node, 'x', { get: getter, enumerable: true });
    expect(prepareFilledInkInBasis(malformed, closeFillPencil, { x: 224.5, y: 188 })).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    const invalid = structuredClone(owners);
    invalid[1].contours![0][1].x = '18' as unknown as number;
    expect(prepareFilledInkInBasis(invalid, closeFillPencil, { x: 224.5, y: 188 })).toBeUndefined();
  });

  it.fails('retains both crossings of the same filled-owner pair at the original drawing coordinates', () => {
    const result = prepareShapeDrawing(ownersFor(closeFillIds), { shape: closeFillPencil, merge: true });
    expect(result.shapes.filter(s => s.strokeWidth)).toHaveLength(11);
  });

  it('certifies every isolated owner in the reduced saved Pencil cases', () => {
    for (const owner of ownersFor([...new Set([...inkOwners, ...combinations.flatMap(c => c.ids)])])) {
      const result = prepareSharedPaintStack([owner], densePencil, 'ink');
      expect(result?.strokes?.length, owner.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('splits both saved paint faces while retaining the narrow Pencil interval', () => {
    const owners = ownersFor(combinations[0].ids);
    const source = structuredClone(owners);
    const result = prepareSharedPaintStack(owners, densePencil, 'ink');
    expect(result?.strokes).toHaveLength(5);
    const middle = result!.strokes![2];
    expect(middle.points.map(point => ({ x: middle.x + point.x, y: middle.y + point.y }))).toEqual([
      { x: 223.06516706498076, y: 186.91445584765253 },
      { x: 223.06516706498084, y: 186.91445584765262 },
    ]);
    for (const owner of owners) {
      const paint = result!.background.get(owner);
      expect(paint).toHaveLength(2);
      expect(paint?.every(shape => shape.fill === owner.fill &&
        shape.contours?.some(ring => ring.some(node => node.in || node.out)))).toBe(true);
    }
    expect(owners).toEqual(source);
  });

  it('cuts the saved fill next to its original editable ink', () => {
    const owners = ownersFor(combinations[1].ids);
    const source = structuredClone(owners);
    const result = prepareShapeDrawing(owners, { shape: densePencil, merge: true });
    expect(result.retainedOverlap).toBeUndefined();
    expect(result.shapes.find(shape => shape.id === owners[1].id)).toEqual(owners[1]);
    const pieces = result.shapes.filter(shape => !shape.strokeWidth);
    expect(pieces).toHaveLength(2);
    expect(pieces.every(shape => shape.fill === owners[0].fill &&
      shape.contours?.some(ring => ring.some(node => node.in || node.out)))).toBe(true);
    expect(owners).toEqual(source);
  });

  it('keeps the saved oblique Pencil junctions and both old Béziers editable', () => {
    const owners = ownersFor(inkOwners);
    const source = structuredClone(owners);
    const result = prepareSharedPaintStack(owners, densePencil, 'ink');
    expect(result?.strokes).toHaveLength(3);
    const middle = result!.strokes![1];
    const ends = middle.points.map(point => ({ x: middle.x + point.x, y: middle.y + point.y }));
    expect(ends).toEqual([
      { x: 213.56100616757388, y: 179.94473785622085 },
      { x: 213.56100616757394, y: 179.94473785622088 },
    ]);
    for (const owner of owners) {
      const halves = result!.background.get(owner);
      expect(halves).toHaveLength(2);
      expect(halves?.every(shape => shape.kind === 'bezier' && shape.nodes?.some(node => node.in || node.out))).toBe(true);
    }
    expect(owners).toEqual(source);
  });

  it('keeps the first reduced saved nonmonotone crossing group distinct', () => {
    const owners = ownersFor(['37a74c24-b697-464b-98a1-84ab7f0b8108','645b3048-f671-4cfd-9a6c-324b866ca2c0']);
    const original = structuredClone(owners);
    const span = { ...densePencil, width: 70, height: 30, nodes: densePencil.nodes!.slice(0,2) };
    const result = prepareSharedPaintStack(owners, span, 'ink');
    expect(result?.strokes).toHaveLength(4);
    const middle = result!.strokes![1];
    expect(middle.points.map(point => ({x: middle.x + point.x, y: middle.y + point.y}))).toEqual([
      { x: 152.98680638859454, y: 190.1485115477452 },
      { x: 152.98680638859457, y: 190.1485115477452 },
    ]);
    expect(owners.map(owner => result?.background.get(owner)?.length)).toEqual([2,3]);
    expect([...result!.background.values()].flat().every(shape =>
      shape.kind === 'bezier' && shape.nodes?.some(node => node.in || node.out))).toBe(true);
    expect(owners).toEqual(original);
  });
});

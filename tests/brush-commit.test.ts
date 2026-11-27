import { expect, it } from 'vitest';
import { clone, type Vector } from '../packages/document/src';
import { commitBrushPaint, prepareBrushPaint, prepareWorkerBrushPaint, type BrushCommit } from '../packages/geometry/src/brush-commit';
import { validateDetachedLiveGraphicData, validateLiveGraphicData } from '../packages/document/src/live-motion';
import { mergeControlBounds, mergeVectors, prepareBrushSweep } from '../packages/geometry/src/merge';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { finishBrushPaint } from '../packages/geometry/src/brush-finish';
import { brushContactOpacity, smoothBrushSamples } from '../packages/geometry/src/pressure';
import { brushOpacityParts, containsPoint, normalizeVector, pathCommands, worldPaths } from '../packages/geometry/src/drawing';
import { drawnSymbolBrush } from '../packages/geometry/src/symbol-artwork';
import { joinRecoloredFills } from '../packages/geometry/src/join-recolored-fills';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';
import { objectBounds } from '../packages/geometry/src/layout';
import { integerBrushDabUnion, integerBrushSweepUnion, integerPaint, PAINT_GRID_STEP } from '../packages/geometry/src/paint-clipping';
import { polygonVectors } from '../packages/geometry/src/strokes';
import type { MultiPolygon, Polygon } from 'polygon-clipping';

for (const tool of ['Brush', 'Rectangle'] as const)
  it(`selects each remaining side of a through-cut at its own position with ${tool}`, () => {
    const paper: Vector = { id: 'base', kind: 'rectangle', x: 101.25, y: 80.75, width: 110, height: 140,
      fill: '#0088ff', stroke: '#000000', strokeWidth: 0, rotation: 0, points: [], drawingMode: 'merge' };
    const across: Vector = { ...brush('across', 75), y: 145, strokeWidth: 22, fill: '#cc4422',
      points: [{ x: 0, y: 0 }, { x: 58, y: -9 }, { x: 114, y: 10 }, { x: 168, y: 4 }] };
    const output = tool === 'Brush' ? commitBrushPaint([paper], request(across, { optimize: true })) :
      prepareShapeDrawing([paper], { shape: { ...paper, id: 'bar', fill: across.fill, x: 75, y: 138, width: 168, height: 22 }, merge: true }).shapes;
    const islands = output.filter(s => s.fill === paper.fill);
    expect(islands).toHaveLength(2);
    expect(new Set(islands.map(s => s.id)).size).toBe(2);
    for (const face of output) {
      const box = objectBounds(face), hull = mergeControlBounds(face);
      for (const side of ['left', 'right', 'top', 'bottom'] as const) expect(box[side]).toBeCloseTo(hull[side], 9);
    }
    const [above, below] = islands.map(objectBounds).sort((a,b) => a.top - b.top);
    expect(above.bottom).toBeLessThan(below.top);
    expect(above.top).toBeCloseTo(paper.y, 9);
    expect(below.bottom).toBeCloseTo(paper.y + paper.height, 9);
  });

const brush = (id: string, x = 0): Vector => ({
  id,
  kind: 'brush',
  x,
  y: 100,
  width: 0,
  height: 0,
  rotation: 0,
  fill: '#123456',
  stroke: '#123456',
  strokeWidth: 24,
  points: Array.from({ length: 65 }, (_, i) => ({ x: i * 4, y: Math.sin(i / 3) * 22 })),
});
const request = (b: Vector, patch: Partial<BrushCommit> = {}): BrushCommit => ({
  brush: b,
  amount: 1,
  mode: 'normal',
  merge: true,
  at: 1,
  selected: [],
  ...patch,
});

it('joins a 12000-face chain reached by Brush while leaving disjoint artwork exact', () => {
  const chain: Vector[] = Array.from({ length: 12000 }, (_, i) => ({
    id: 'chain-' + i, kind: 'polygon', fillRule: 'evenodd', drawingMode: 'merge', closed: true,
    x: 450 + i, y: 270, width: 1, height: 1, rotation: 0, fill: '#ff0000', stroke: '#000000',
    strokeWidth: 0, points: [], contours: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
  }));
  const unrelated: Vector = { ...chain[0], id: 'other', y: 350 };
  const pencil: Vector = { id: 'ink', kind: 'line', x: 450, y: 310, width: 5, height: 5,
    rotation: 0, fill: '#000000', fillEnabled: false, stroke: '#000000', strokeWidth: 1,
    points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] };
  const artwork = [...chain, unrelated, pencil], original = structuredClone(artwork);
  const incoming: Vector = {
    ...brush('incoming', 405), y: 270.5, width: 55, fill: '#ff0000',
    points: Array.from({ length: 13 }, (_, i) => ({ x: 55 * i / 12, y: 0 })),
  };
  const result = commitBrushPaint(artwork, request(incoming, {
    amount: 0.5, optimize: true, at: artwork.length, removeCoveredStrokes: true,
  }));
  expect(result).toHaveLength(3);
  expect(result.find(shape => shape.id === unrelated.id)).toEqual(unrelated);
  expect(result.find(shape => shape.id === pencil.id)).toEqual(pencil);
  const joined = result.find(shape => shape.id !== unrelated.id && shape.id !== pencil.id)!;
  expect(joined.contours).toHaveLength(1);
  expect(joined.contours![0].some(node => node.in || node.out)).toBe(true);
  const [path] = worldPaths(joined);
  for (const x of [420, 450.5, 6450.5, 12449.5]) {
    expect(containsPoint(path, { x, y: 270.5 })).toBe(true);
    expect(containsPoint(path, { x, y: 274 })).toBe(x <= 450.5);
  }
  expect(artwork).toEqual(original);
});

it('reuses only whole admitted dab rings on the integer grid', () => {
  const box: Polygon = [[[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]]];
  const same: Polygon = [box[0].map(([x, y]) => [x + PAINT_GRID_STEP / 10, y])];
  const wider: Polygon = [[[0, 0], [9, 0], [8, 8], [0, 8], [0, 0]]];
  const hole: Polygon = [box[0], [[2, 2], [2, 6], [6, 6], [6, 2], [2, 2]]];
  const disjoint: Polygon = [[[20, 1], [22, 1], [22, 3], [20, 3], [20, 1]]];
  const input = [box, same, wider, hole, disjoint, same, disjoint];
  const before = structuredClone(input);
  const merged = integerBrushDabUnion(input);
  expect(merged).toEqual(integerPaint('union', input));
  expect(Math.max(...merged.flat(2).map(([x]) => x))).toBe(22);
  expect(merged.flat(2)).toContainEqual([9, 0]);
  expect(input).toEqual(before);
});

it('validates every repeated dab and keeps the original fine-grid fallback', () => {
  const box: Polygon = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
  const invalid: Polygon = [[[0, 0], [1, 0], [Infinity, 1], [0, 1], [0, 0]]];
  const thin: Polygon = [[[2, 0], [3, 0], [3, 1e-7], [2, 1e-7], [2, 0]]];
  expect(() => integerBrushDabUnion([box, box, invalid])).toThrow('precision range');
  const expected = integerPaint('union', [box, box, thin]);
  expect(expected).toHaveLength(2);
  expect(integerBrushDabUnion([box, box, thin])).toEqual(expected);
});

it('keeps repeated loop batches in the final union and preserves the exact hole boundary', () => {
  const points = Array.from({length:4500}, (_, i) => {
    const angle = (i % 48) * Math.PI / 24;
    return { x:37*Math.cos(angle), y:38*Math.sin(angle), pressure:.45+.2*Math.sin(angle) };
  });
  const source: Vector = { ...brush('pressure-loops'), y:0, points: smoothBrushSamples(points,.5) };
  const before = structuredClone(source);
  const dabs: MultiPolygon = worldPaths(source).map(path => [path.map(({x,y}) => [x,y])]);
  const chunks: MultiPolygon = [];
  for (let i=0;i<dabs.length;i+=64) chunks.push(...integerBrushDabUnion(dabs.slice(i,i+64)));
  const expected = integerPaint('union',chunks);
  expect(expected).toHaveLength(1);
  expect(expected[0]).toHaveLength(2);
  const unique = [...new Map(chunks.map(polygon=>[JSON.stringify(polygon),polygon])).values()];
  expect(unique.length).toBeLessThan(chunks.length/4);
  // Removing exact repetitions from Clipper's final input changes the hole.
  expect(integerPaint('union', unique)).not.toEqual(expected);
  expect(integerBrushSweepUnion(dabs)).toEqual(expected);
  expect(source).toEqual(before);
});

it('compares all raw coordinates before reusing a complete Brush batch', () => {
  const box: Polygon = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
  const island: Polygon = [[[3, 0], [4, 0], [4, 1], [3, 1], [3, 0]]];
  const thin: Polygon = [[[2, 0], [3, 0], [3, 1e-7], [2, 1e-7], [2, 0]]];
  const invalid: Polygon = [[[0, 0], [1, 0], [Infinity, 1], [0, 1], [0, 0]]];
  const original = Array.from({length:64},()=>box);
  const changed = [...original.slice(0,-1),island];
  const expected = integerPaint('union', [
    ...integerBrushDabUnion(original), ...integerBrushDabUnion(changed), ...integerBrushDabUnion(original),
  ]);
  expect(expected).toHaveLength(2);
  expect(integerBrushSweepUnion([...original,...changed,...original])).toEqual(expected);
  expect(() => integerBrushSweepUnion([...original,...original.slice(0,-1),invalid])).toThrow('precision range');
  const fineBatch = [...original.slice(0,-1),thin];
  const fine = integerBrushDabUnion(fineBatch);
  expect(fine).toHaveLength(2);
  expect(integerBrushSweepUnion([...fineBatch,...fineBatch])).toEqual(integerPaint('union',[...fine,...fine]));
});

it.each([false, true])('keeps exact independent sweep geometry through variable-pressure retraces (reflected %s)', reflected => {
  const source: Vector = {
    ...brush('pressure-retraces', 113.125), y: 70.25,
    transform: reflected ? [-1, .2, .3, 1.4] : undefined,
    points: Array.from({length:450}, (_, i) => {
      const step = i % 36, x = step < 18 ? step : 36 - step;
      return { x, y: 3 * Math.sin(x / 5), pressure: .25 + x / 40 };
    }),
  };
  source.points = smoothBrushSamples(source.points, .5);
  const before = structuredClone(source);
  const dabs: MultiPolygon = worldPaths(source).map(path => [path.map(({x,y}) => [x,y])]);
  expect(dabs.length).toBeGreaterThan(64);
  const oldChunks: MultiPolygon = [];
  for (let i=0;i<dabs.length;i+=64)
    oldChunks.push(...integerPaint('union', dabs.slice(i,i+64)));
  const expected = polygonVectors(source, integerPaint('union', oldChunks), true)
    .map(piece => ({...piece, id:'stable', drawingMode:'merge'}));
  expect(prepareBrushSweep(source).merge().map(piece => ({...piece, id:'stable'}))).toEqual(expected);
  expect(source).toEqual(before);
});

it('reuses original Brush nib paths with the exact single-stroke merge geometry', () => {
  const source: Vector = {
    ...brush('prepared-sweep', -76.125), rotation: 23, transform: [-1, .2, .3, 1.4],
    brush: { pressure: true, minimum: .2, response: 1.5, tilt: true, aspect: .7, angle: 23 },
    points: [
      {x:0,y:0,pressure:.27,tiltX:-11,tiltY:17},
      {x:24,y:16,pressure:.61,tiltX:16,tiltY:20},
      {x:40,y:5,pressure:.89,tiltX:24,tiltY:30},
    ],
  };
  const original = structuredClone(source);
  const sweep = prepareBrushSweep(source);
  const paths = sweep.sample();
  expect(paths).toEqual(worldPaths(source));
  const withoutIds = (vectors:Vector[]) => vectors.map(({id:_id,...shape})=>shape);
  const expected = mergeVectors([source]);
  expect(expected.length).toBeGreaterThan(0);
  expect(withoutIds(sweep.merge())).toEqual(withoutIds(expected));
  expect(sweep.sample()).toBe(paths);
  expect(paths).toEqual(worldPaths(source));
  expect(source).toEqual(original);

  const authored: Vector = {
    ...source, strokeWidth: 0, drawingMode: 'merge', fillRule: 'evenodd',
    contours: [[{x:0,y:0,out:{x:10,y:-5}},{x:30,y:0,in:{x:20,y:-5}},{x:30,y:30},{x:0,y:30}]],
  };
  expect(prepareBrushSweep(authored).merge()).toEqual(mergeVectors([authored]));
});

for (const recolor of [false, true]) for (const x of [35, 115, 155]) it(`joins a Brush crossing a drawn outlined square at ${x} (Bucket recolor: ${recolor})`, () => {
  const square: Vector = { id:'square', kind:'rectangle', x:100, y:60, width:120, height:120,
    fill:'#123456', stroke:'#121212', strokeWidth:2, rotation:0, points:[], drawingMode:'merge' };
  const base = prepareShapeDrawing([], {shape:square, merge:true, removeCoveredStrokes:true}).shapes;
  const stroke = {...brush('paint', x), fill:recolor ? '#ff7700' : square.fill,
    points:[{x:0,y:0},{x:40,y:10},{x:68,y:18},{x:110,y:30}]};
  const painted = commitBrushPaint(base,request(stroke,{at:base.length,removeCoveredStrokes:true,optimize:true}));
  const seed = painted.find(s=>s.fill === stroke.fill && s.strokeWidth === 0)!;
  const result = recolor ? joinRecoloredFills(painted.map(s=>s===seed ? {...s,fill:square.fill} : s), [seed.id]) : painted;
  expect(result.filter(s=>s.strokeWidth===0)).toHaveLength(1);
  expect(result.filter(s=>s.strokeWidth>0).length).toBeGreaterThan(0);
});

for (const recolor of [false,true]) it(`unites a brush with both outlined square fills (Bucket recolor: ${recolor})`, () => {
  const square: Vector = { id:'first', kind:'rectangle', x:40, y:60, width:110, height:120,
    fill:'#123456', stroke:'#121212', strokeWidth:2, rotation:0, points:[], drawingMode:'merge' };
  const base = prepareShapeDrawing([], {shape:square, merge:true}).shapes;
  const pair = prepareShapeDrawing(base, {shape:{...square,id:'second',x:170}, merge:true}).shapes;
  const stroke = {...brush('bridge',90),fill:recolor?'#ff7700':square.fill,points:[{x:0,y:0},{x:45,y:12},{x:80,y:5},{x:135,y:1}]};
  const painted = commitBrushPaint(pair,request(stroke,{at:pair.length,removeCoveredStrokes:true,optimize:true}));
  const seed = painted.find(s=>s.fill===stroke.fill && !s.strokeWidth)!;
  const result = recolor ? joinRecoloredFills(painted.map(s=>s===seed ? {...s,fill:square.fill} : s),[seed.id]) : painted;
  expect(result.filter(s=>!s.strokeWidth)).toHaveLength(1);
});

for (const matching of [false, true])
it(`keeps the finished Brush curves across two adjoining fills (matching paint: ${matching})`, () => {
  const left: Vector = { id: 'left', kind: 'rectangle', x: 101.25, y: 80.75, width: 65, height: 140,
    fill: '#0088ff', stroke: '#000000', strokeWidth: 0, rotation: 0, points: [], drawingMode: 'merge' };
  const right = { ...left, id: 'right', x: left.x + left.width, fill: '#ff0044' };
  const stroke = { ...brush('across', 72), fill: matching ? right.fill : '#00aa44', y: 142, strokeWidth: 23,
    points: [{ x: 0, y: 0 }, { x: 65, y: -12 }, { x: 124, y: 15 }, { x: 205, y: 3 }] };
  const options = request(stroke, { at: 2, optimize: true });
  const [blank] = commitBrushPaint([], options);
  const result = commitBrushPaint([left, right], options);
  const top = result.filter(s => s.fill === stroke.fill);
  expect(top).toHaveLength(1);
  if (!matching) {
    // Two sides of the stroke each cross three vertical edges, including
    // the boundary shared by the old fills. There are six real new vertices.
    expect(top[0].contours![0]).toHaveLength(blank.contours![0].length + 6);
  }
  const cubics = (s: Vector, reverse: boolean) => s.contours!.flatMap(r => r.flatMap((a, i) => {
    const b = r[(i + 1) % r.length];
    if (!a.out && !b.in) return [];
    const points = [a, a.out ?? a, b.in ?? b, b].map(p => mapPoint(matrix(s), p));
    return [JSON.stringify(reverse ? points.reverse() : points)];
  }));
  const edges = new Set(cubics(top[0], false));
  const adjacent = result.filter(s => s.fill !== stroke.fill);
  expect(adjacent).toHaveLength(matching ? 2 : 4);
  for (const piece of adjacent) {
    expect(piece.contours![0].length).toBeLessThan(blank.contours![0].length + 6);
    const own = cubics(piece, true);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every(e => edges.has(e))).toBe(true);
  }
});

it('keeps a hole and its curved inset on the same boundary after another Brush cuts through both', () => {
  const base: Vector = { id: 'base', kind: 'rectangle', x: 58, y: 32, width: 211, height: 200,
    fill: '#0088ff', stroke: '#000000', strokeWidth: 0, rotation: 0, points: [], drawingMode: 'merge' };
  const inset = { ...brush('inset', 156), fill: '#ff0044', y: 64, strokeWidth: 28,
    points: [{ x: 0, y: 0 }, { x: -7, y: 35 }, { x: 13, y: 80 }, { x: 1, y: 128 }] };
  const before = commitBrushPaint([base], request(inset, { optimize: true }));
  expect(before[0].contours).toHaveLength(2);
  const cross = { ...inset, id: 'cross', fill: '#00aa44', x: 79, y: 121,
    points: [{ x: 0, y: 0 }, { x: 56, y: -12 }, { x: 111, y: 11 }, { x: 168, y: 5 }] };
  const options = request(cross, { at: 2, optimize: true });
  const [blank] = commitBrushPaint([], options);
  const output = commitBrushPaint(before, options);
  const red = output.filter(s => s.fill === inset.fill), top = output.find(s => s.fill === cross.fill)!;
  expect(top.contours![0]).toHaveLength(blank.contours![0].length + 4);
  expect(red).toHaveLength(2);
  const joined = joinRecoloredFills(output.map(s => s === top ? { ...s, fill: inset.fill } : s), [top.id]);
  expect(joined.map(s => s.fill).sort()).toEqual([base.fill, inset.fill].sort());
  expect(joined.find(s => s.fill === base.fill)!.contours).toHaveLength(2);
});

it('cuts a rotated ellipse with the finished Brush and keeps both sides cubic', () => {
  const lower: Vector = { id: 'rotated', kind: 'ellipse', x: 170, y: 70, width: 101, height: 129,
    rotation: 17, strokeWidth: 0, fill: '#0088ff', stroke: '#000000', points: [], drawingMode: 'merge' };
  const incoming = { ...brush('new', 80), y: 120, strokeWidth: 25,
    points: [{ x: 0, y: 0 }, { x: 66, y: -18 }, { x: 128, y: 10 }, { x: 210, y: 4 }] };
  const options = request(incoming, { optimize: true });
  const [blank] = commitBrushPaint([], options);
  const before = structuredClone(lower);
  const result = prepareBrushPaint([lower], options);
  expect(result.retainedOverlap).toBeUndefined();
  const sides = result.shapes.filter(s => s.fill === lower.fill);
  expect(sides).toHaveLength(2);
  const top = result.shapes.find(s => s.fill === incoming.fill)!;
  expect(top.contours![0]).toHaveLength(blank.contours![0].length + 4);
  for (const side of sides) expect(side.contours![0].every(n => n.in || n.out)).toBe(true);
  expect(lower).toEqual(before);
});

it('retains original-value admission in the detached Brush worker', () => {
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { throw Error('getter executed'); } });
  const hidden = Object.defineProperty({}, 'x', { value: 1 });
  const holeAndExtra = Array(1) as unknown[];
  Object.assign(holeAndExtra, { other: 1 });
  const invalid = [
    { anchors: [{ x: NaN }] }, [Infinity], { count: 1n }, { value: () => 0 },
    [new Date()], [getter], [hidden], Object.assign([0], { extra: true }),
    [Array(2)], holeAndExtra, Object.assign([0], { [Symbol('extra')]: 1 }),
  ];
  for (const data of invalid) {
    for (const validate of [validateLiveGraphicData, validateDetachedLiveGraphicData])
      expect(() => validate(data)).toThrow(/requires|require|unsupported/);
  }
  const nullRecord = Object.assign(Object.create(null) as Record<string, unknown>, { x: 0, in: undefined });
  for (const validate of [validateLiveGraphicData, validateDetachedLiveGraphicData])
    expect(() => validate([nullRecord, { contours: [[{ x: 8, y: -2 }, { x: 0, y: 2 }]] }, null])).not.toThrow();

  const old = mergeVectors([brush('old', 1000)]);
  const incoming = request(brush('new'));
  const phases: string[] = [];
  const normal = prepareBrushPaint(old, incoming, undefined, 4, true);
  const workerInput = structuredClone(old);
  const detached = prepareWorkerBrushPaint(workerInput, structuredClone(incoming), phase => phases.push(phase), 4, true);
  const withoutIds = (vectors: Vector[]) => vectors.map(({ id: _id, ...shape }) => shape);
  expect(withoutIds(detached.shapes)).toEqual(withoutIds(normal.shapes));
  expect(detached.unchangedRoots).toEqual(normal.unchangedRoots);
  const references = detached.unchangedRoots!;
  expect(references.length).toBeGreaterThan(0);
  for (const {input,output} of references) {
    expect(detached.shapes[output]).toBe(workerInput[input]);
    expect(normal.shapes[output]).not.toBe(old[input]);
  }
  const withoutReferences = prepareWorkerBrushPaint(workerInput,structuredClone(incoming));
  expect(withoutReferences.unchangedRoots).toBeUndefined();
  expect(withoutReferences.shapes.find(s=>s.id===workerInput[0].id)).not.toBe(workerInput[0]);
  expect(workerInput).toEqual(old);
  expect(detached.damage?.bounds).toEqual(normal.damage?.bounds);
  expect(phases).toContain('validation');
  const invalidSource = structuredClone(old);
  invalidSource[0].contours![0][0].x = Infinity;
  expect(() => prepareWorkerBrushPaint(invalidSource, incoming)).toThrow('finite original values');
  expect(invalidSource[0].contours![0][0].x).toBe(Infinity);
});

it('bounds contoured paint exactly like its derived commands, including reflected closing handles and stroke reach', () => {
  const contour: Vector = {
    ...brush('contour', -99700), kind: 'polygon', points: [], y: 99800, rotation: -83,
    transform: [-1, 0.3, 0.45, 1.6], strokeWidth: 17, strokeJoin: 'miter',
    contours: [
      [{ x: 0, y: 0, in: { x: -42, y: -19 } }, { x: 80, y: 20 }, { x: 11, y: 90, out: { x: -73, y: 105 } }],
      [{ x: 15, y: 30, out: { x: 37, y: 68 } }, { x: 48, y: 45 }, { x: 19, y: 54 }],
      [{ x: 17, y: 8, in: { x: 30, y: 0 } }],
    ],
  };
  for (const s of [contour, { ...contour, strokeWidth: 0 }, brush('nib'),
    { ...contour, kind: 'ellipse' as const, contours: undefined, width: 120, height: 44 }]) {
    const m = matrix(s);
    const points = pathCommands(s).flatMap(command => command[0] === 'Z' ? [] :
      (command[0] === 'C' ? [1, 3, 5] : [1]).map(i =>
        mapPoint(m, { x: command[i] as number, y: command[i + 1] as number })));
    const pad = s.kind !== 'brush' && s.strokeWidth
      ? s.strokeWidth / 2 * (s.strokeJoin === 'miter' ? 4 : 1) * Math.hypot(...m.slice(0, 4)) : 0;
    expect(mergeControlBounds(s)).toEqual({
      left: Math.min(...points.map(p => p.x)) - pad, right: Math.max(...points.map(p => p.x)) + pad,
      top: Math.min(...points.map(p => p.y)) - pad, bottom: Math.max(...points.map(p => p.y)) + pad,
    });
  }
});

it('reports only the rebuilt component for an isolated Brush display patch', () => {
  const old = mergeVectors([brush('old', 1000)]);
  const source = clone(old);
  const incoming = request(brush('new'));
  const full = prepareBrushPaint(old, incoming);
  const patched = prepareBrushPaint(old, incoming, undefined, 4);
  const withoutIds = (shapes: Vector[]) => shapes.map(({ id: _id, ...shape }) => shape);
  expect(withoutIds(patched.shapes)).toEqual(withoutIds(full.shapes));
  expect(patched.damage?.artwork).toHaveLength(1);
  expect(patched.damage?.bounds.right).toBeLessThan(300);
  expect(patched.shapes[0]).toEqual(old[0]);
  expect(prepareBrushPaint(old, incoming, undefined, 1000).damage).toBeUndefined();
  expect(old).toEqual(source);
});

it('maps disjoint source roots across a rebuilt span without aliasing the public candidate', () => {
  const left = mergeVectors([brush('left', -1200)])[0];
  const middle = mergeVectors([brush('middle', 12)])[0];
  const right = mergeVectors([brush('right', 1200)])[0];
  const source = [left, middle, right];
  const result = prepareBrushPaint(source, request(brush('new')), undefined, undefined, true);
  expect(result.unchangedRoots).toEqual([
    { input: 0, output: 0 }, { input: 2, output: result.shapes.length - 1 },
  ]);
  expect(result.shapes[0]).toEqual(left);
  expect(result.shapes.at(-1)).toEqual(right);
  expect(result.shapes[0]).not.toBe(left);
  expect(result.shapes.at(-1)).not.toBe(right);
});

it('smooths only the incoming stroke, then merges: older jagged paint stays exact outside the new footprint', () => {
  const old = mergeVectors([brush('old')]);
  const incoming = brush('incoming', 220);
  const source = clone(old),
    captured = clone(incoming);
  const result = commitBrushPaint(old, request(incoming));
  const remote = (shapes: Vector[]) =>
    [
      ...new Set(
        shapes
          .flatMap((s) => worldPaths(s, 0.25).flat())
          .filter((p) => p.x < 180)
          .map((p) => [p.x.toFixed(8), p.y.toFixed(8)].join(',')),
      ),
    ].sort();
  expect(remote(result)).toEqual(remote(old));
  // Prove the oracle catches the old post-merge fitting behavior on this fixture.
  const incorrectlyRefitted = finishBrushPaint(mergeVectors([...old, incoming]), {
    brush: incoming,
    amount: 1,
  });
  expect(remote(incorrectlyRefitted)).not.toEqual(remote(old));
  expect(result).toHaveLength(1);
  expect(old).toEqual(source);
  expect(incoming).toEqual(captured);
});

for (const optimize of [false, true])
  it(`uses the finished Brush footprint over a differently colored outlined fill (Optimize ${optimize})`, () => {
    const incoming = brush('incoming', 140);
    const under: Vector = { id: 'under', kind: 'rectangle', x: 80, y: 45, width: 395, height: 130,
      rotation: 0, fill: '#0088ff', stroke: '#000000', strokeWidth: 0, points: [], drawingMode: 'merge' };
    const border: Vector = { ...under, id: 'border', kind: 'path', fillEnabled: false,
      strokeWidth: 2, closed: true, points: [{ x: 0, y: 0 }, { x: under.width, y: 0 },
        { x: under.width, y: under.height }, { x: 0, y: under.height }] };
    const input = [under, border], saved = clone(input);
    const options = request(incoming, { at: 2, amount: 1.5, optimize, removeCoveredStrokes: true });
    const [finished] = commitBrushPaint([], options);
    const expected = worldPaths(finished, 0.002)[0].slice(0, -1);
    expect(finished.contours?.flat().some(node => node.in || node.out)).toBe(true);
    const output = commitBrushPaint(input, options);
    // The new paint is the finished footprint, curve for curve, on the stage.
    const over = output.find(s => s.fill === incoming.fill && s.fillEnabled !== false)!;
    expect(worldPaths(over, 0.002)).toEqual(worldPaths(finished, 0.002));
    const underpaint = output.find(s => s.fill === under.fill && s.fillEnabled !== false)!;
    const [, hole] = worldPaths(underpaint, 0.002);
    const points = hole.slice(0, -1);
    expect(points).toHaveLength(expected.length);
    for (const p of expected) expect(points.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-8)).toBe(true);
    expect(output.find(s => s.id === border.id)).toEqual(border);
    expect(input).toEqual(saved);
  });

it('uses the same finished footprint when a crossing outline is removed or retained', () => {
  const incoming = brush('incoming', 140);
  const under: Vector = { id: 'under', kind: 'rectangle', x: 80, y: 45, width: 395, height: 130,
    rotation: 0, fill: '#0088ff', stroke: '#000000', strokeWidth: 0, points: [], drawingMode: 'merge' };
  const line: Vector = { ...under, id: 'ink', kind: 'line', x: 198, y: 50, width: 0, height: 115,
    fillEnabled: false, strokeWidth: 2 };
  const options = request(incoming, { at: 2, amount: 1.5 });
  const [finished] = commitBrushPaint([], options);
  for (const removeCoveredStrokes of [false, true]) {
    const output = commitBrushPaint([under, line], { ...options, removeCoveredStrokes });
    const ink = output.filter(s => s.fillEnabled === false);
    // A line kept over the new paint divides it, as lines divide paint everywhere in Merge
    // Drawing; together the pieces are exactly the finished footprint.
    const paint = output.filter(s => s.fill === incoming.fill);
    if (removeCoveredStrokes) expect(worldPaths(paint[0], 0.002)).toEqual(worldPaths(finished, 0.002));
    else {
      expect(paint).toHaveLength(2);
      const rings = paint.flatMap(s => worldPaths(s, 0.002));
      const inside = (p: { x: number; y: number }) => rings.reduce((n, r) => n !== containsPoint(r, p), false);
      const outline = worldPaths(finished, 0.002);
      const original = (p: { x: number; y: number }) => outline.reduce((n, r) => n !== containsPoint(r, p), false);
      for (let x = 60; x < 520; x += 7) for (let y = 30; y < 200; y += 7)
        if (Math.abs(x - 198) > 2) expect(inside({ x, y })).toBe(original({ x, y }));
    }
    if (removeCoveredStrokes) {
      expect(ink).toHaveLength(2);
      expect(ink.every(s => s.kind === 'line' || s.kind === 'path' || s.kind === 'bezier')).toBe(true);
    } else {
      expect(ink).toEqual([line]);
      expect(output.indexOf(ink[0])).toBeGreaterThan(Math.max(...paint.map(s => output.indexOf(s))));
    }
  }
});

for (const surface of ['rectangle', 'rounded rectangle', 'Brush paint'] as const)
it(`shares exact cubic fragments before recoloring a Brush crossing over ${surface}`, () => {
  const rectangle: Vector = { id: 'lower', kind: 'rectangle', x: 100, y: 100, width: 145, height: 145,
    rotation: 0, fill: '#0088ff', stroke: '#000000', strokeWidth: 0, points: [], drawingMode: 'merge' };
  const stroke: Vector = { ...brush('brush', 150), y: 135, strokeWidth: 30, fill: '#ff0000',
    points: [{ x: 0, y: 0 }, { x: 34, y: 10 }, { x: 66, y: 33 }, { x: 105, y: 27 }, { x: 140, y: 21 }] };
  const lower = surface === 'Brush paint' ? commitBrushPaint([], request({ ...stroke, id: 'lower', fill: rectangle.fill,
    x: 221, y: 87, points: [{ x: 0, y: 0 }, { x: -11, y: 39 }, { x: 11, y: 84 }, { x: -4, y: 135 }],
  }, { optimize: true }))[0] : { ...rectangle, ...(surface === 'rounded rectangle' ? { cornerRadius: 24 } : {}) };
  const output = commitBrushPaint([lower], request(stroke, { optimize: true, removeCoveredStrokes: true }));
  const over = output.at(-1)!;
  const under = output.slice(0, -1);
  expect(under).toHaveLength(surface === 'Brush paint' ? 2 : 1);
  const edges = (s: Vector) => s.contours!.flatMap(ring => ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const world = (p: { x: number; y: number }) => mapPoint(matrix(s), p);
    return { a: world(a), b: world(b), out: a.out && world(a.out), in: b.in && world(b.in) };
  }));
  for (const piece of under) {
    const other = edges(piece);
    const shared = edges(over).filter(edge => other.some(candidate =>
      JSON.stringify([edge.a, edge.out, edge.in, edge.b]) ===
      JSON.stringify([candidate.b, candidate.in, candidate.out, candidate.a])));
    expect(shared.some(edge => !!(edge.out || edge.in) &&
      (surface !== 'rectangle' || [edge.a, edge.b].some(point => point.x === 245)))).toBe(true);
    const joined = joinRecoloredFills([...under.map(s => s === piece ? { ...s, fill: over.fill } : s), over], [piece.id]);
    expect(joined).toHaveLength(under.length);
  }
  const joined = joinRecoloredFills([...under, { ...over, fill: lower.fill }], [over.id]);
  expect(joined).toHaveLength(1);
  expect(joined[0].contours).toHaveLength(1);
});

for (const mode of ['normal', 'behind', 'fills', 'inside', 'selection'] as const)
  it('keeps older paint out of smoothing in ' + mode + ' mode', () => {
    const old = mergeVectors([brush('old')]);
    const source = clone(old);
    const incoming = brush('new', 220);
    const result = commitBrushPaint(old, request(incoming, { mode, selected: [old[0].id] }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.kind !== 'brush')).toBe(true);
    expect(old).toEqual(source);
  });

it('preserves distant fitted paint byte-for-byte while finishing new paint', () => {
  const oldBrush = brush('old', -1000);
  const old = finishBrushPaint(mergeVectors([oldBrush]), { brush: oldBrush, amount: 1 });
  const result = commitBrushPaint(old, request(brush('new')));
  expect(result.find((s) => s.id === old[0].id)).toEqual(old[0]);
  expect(
    result
      .filter((s) => s.id !== old[0].id)
      .flatMap((s) => s.contours?.flat() ?? [])
      .some((n) => n.in || n.out),
  ).toBe(true);
});

it('separate objects retain every raw sample at zero smoothing and finish only new samples when enabled', () => {
  const old = brush('old'),
    incoming = brush('new', 220),
    snapshot = clone(old);
  const raw = commitBrushPaint([old], request(incoming, { amount: 0, merge: false }));
  const smooth = commitBrushPaint([old], request(incoming, { amount: 1, merge: false }));
  expect(raw[0]).toEqual(snapshot);
  expect(smooth[0]).toEqual(snapshot);
  const expected = clone(incoming);
  expected.points = smoothBrushSamples(expected.points, 1);
  normalizeVector(expected);
  expect(smooth[1]).toEqual(expected);
  expect(raw[1].points).toHaveLength(incoming.points.length);
  expect(smooth[1].points).not.toEqual(raw[1].points);
});

it('rejects invalid smoothing atomically', () => {
  const old = mergeVectors([brush('old')]),
    snapshot = clone(old);
  for (const amount of [NaN, Infinity, -1, 11])
    expect(() => commitBrushPaint(old, request(brush('new'), { amount }))).toThrow();
  expect(old).toEqual(snapshot);
});

for (const amount of [0, 0.5])
  it('keeps existing symbol sample smoothing semantics in the worker at ' + amount, () => {
    const incoming = brush('symbol');
    incoming.x = incoming.y = 0;
    const result = commitBrushPaint(
      [],
      request(incoming, { at: 0, amount, merge: false, symbol: true }),
    );
    expect(result).toEqual([
      drawnSymbolBrush(
        incoming.id,
        incoming.points,
        incoming.fill,
        incoming.strokeWidth,
        amount > 0,
        incoming.brush,
      ),
    ]);
  });

it('preserves resolved contact opacity and editable pen samples in a separate symbol stroke', () => {
  const source = brush('pen');
  source.points.forEach((point, index) => { point.pressure = index ? 0.8 : 0.25; });
  source.opacity = brushContactOpacity(source.points[0].pressure!, 0.2, 2);
  expect(source.opacity).toBe(0.25);
  const past = brush('past');
  const output = commitBrushPaint([past], request(source, { merge: false, amount: 0, symbol: true }));
  expect(output[0]).toEqual(past);
  expect(output[1].opacity).toBe(0.25);
  expect(output[1].points.map(p => p.pressure)).toEqual(source.points.map(p => p.pressure));
  expect(() => commitBrushPaint([past], request({ ...source, opacity: NaN }, { symbol: true }))).toThrow('Invalid brush opacity');
  expect(() => brushContactOpacity(0.25, NaN, 1)).toThrow('Minimum brush opacity');
  expect(() => brushContactOpacity(0.25, 0, 0)).toThrow('Pressure response');
  expect(brushContactOpacity(1, 0.2, 2)).toBe(1);
});

it('prepares independent pressure ramps and rejects flattening them in Merge drawing', () => {
  const source = brush('pressure');
  source.brush = { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0,
    opacityProfile: { minimum: 0.2, response: 2 } };
  source.points = [{ x: 0, y: 0, pressure: 0.25 }, { x: 25, y: 0, pressure: 0.75 }];
  const original = clone(source);
  const [first, ramp] = brushOpacityParts(source)!;
  expect(first.from).toEqual([0, 0, 0.25]);
  expect(ramp.from).toEqual(first.from);
  expect(ramp.to).toEqual([25, 0, 0.65]);
  expect(ramp.commands.some(c => c[0] === 'C')).toBe(true);
  expect(() => mergeVectors([source])).toThrow('separate Brush objects');
  expect(source).toEqual(original);
});

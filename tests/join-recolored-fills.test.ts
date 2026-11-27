import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { healDeletedInk, joinRecoloredFills, planVacatedInkHealing, prepareMatchingFillJoins } from '../packages/geometry/src/join-recolored-fills';
import { dropPaintSelection } from '../packages/geometry/src/clip-paint';
import { hit, worldPoint } from '../packages/geometry/src';
import { recoloredBrushFixture } from './recolored-brush-fixture';
import { commitBrushPaint } from '../packages/geometry/src/brush-commit';
import { prepareShapeDrawing } from '../packages/geometry/src/shape-drawing';

it('joins touching Brush strokes across cap and side contacts with different Simplify settings', () => {
  const stroke = (id: string, fill: string, x: number, y: number, dx: number, dy: number): Vector => ({
    id, kind:'brush', x, y, width:Math.abs(dx), height:Math.abs(dy), rotation:0, fill, stroke:fill, strokeWidth:28,
    points:Array.from({ length:15 }, (_,i)=>({x:dx*i/14,y:dy*i/14})),
    brush:{ pressure:true, minimum:0.1, tilt:false, aspect:1, angle:0 },
  });
  const commit = (shapes: Vector[], brush: Vector, amount: number, optimize: boolean) => commitBrushPaint(shapes,
    { brush, amount, merge:true, mode:'normal', optimize, selected:[], at:shapes.length });
  for (const optimize of [true,false]) for (const amount of [0,0.5,1]) {
    const first = commit([],stroke('first','#ff0000',93,130,176,0),amount,optimize);
    let pairs = 0;
    for (const [x,y,dx,dy] of [[154,55,42,66],[180,65,0,44],[160,108,100,0],[266,80,6,40],
      [145,40,77,82],[230,150,65,0],[225,55,0,51],[216,70,45,53],[90,129,-50,-30], [165,72,65,37]]) {
      const paint = commit(first,stroke('second','#0088ff',x,y,dx,dy),amount,optimize);
      const seed = paint.find(s=>s.fill==='#ff0000');
      if (!seed || paint.length!==2) continue;
      pairs++;
      const joined = joinRecoloredFills(paint.map(s=>({...s,fill:'#0088ff'})),[seed.id]);
      expect(joined, `Brush ${x}, ${y}, ${dx}, ${dy} at ${amount} with Optimize ${optimize}`).toHaveLength(1);
      expect(joined[0].id).toBe(seed.id);
    }
    expect(pairs).toBeGreaterThanOrEqual(9);
  }
});

const rect = (id: string, x: number, y: number, width: number, height: number): Vector => ({
  id, kind: 'rectangle', x, y, width, height, rotation: 0, fill: '#0088ff',
  stroke: '#000000', strokeWidth: 0, points: [], drawingMode: 'merge',
});

it('absorbs a contained fill from either side without rebuilding the outer geometry', () => {
  const outer = { ...rect('outer', 100, 100, 200, 200), rotation: 12, pivot: { x: 62, y: 54 } };
  const inside = rect('inside', 160, 160, 70, 70);
  const input = [outer, inside];
  for (const seed of input) {
    const plan = prepareMatchingFillJoins(input, [seed.id]);
    expect(plan.artwork).toEqual([{ ...outer, id: seed.id }]);
    expect(plan.contained).toEqual(new Set([inside.id]));
    expect(plan.absorbed.get(input.find(shape => shape !== seed)!.id)).toBe(seed.id);
  }
  expect(prepareMatchingFillJoins(input, input.map(shape => shape.id), true).artwork).toBe(input);
});

it('heals only a deleted ink seam in the same group and material', () => {
  const left = rect('left',0,0,50,80), middle = rect('middle',50,0,50,80), right = rect('right',100,0,50,80);
  const divider: Vector = {...left,id:'divider',x:50,kind:'path',strokeWidth:2,fillEnabled:false,
    points:[{x:0,y:0},{x:0,y:80}]};
  const paint = [left,middle,right];
  const result = healDeletedInk(paint,[divider]);
  expect(result).toHaveLength(2);
  expect(result[1]).toBe(right);
  expect(hit(result[0],{x:80,y:20},0)).toBe(true);
  expect(hit(result[0],{x:120,y:20},0)).toBe(false);
  for (const other of [[left,{...middle,fill:'#dd5522'}], [left,{...middle,groups:['object']}],
    [left,{...middle,drawingMode:'object' as const}], [...paint,{...divider,id:'remaining'}]]) {
    expect(healDeletedInk(other,[divider])).toBe(other);
  }
  const divided = [left,middle,divider];
  expect(joinRecoloredFills(divided,[left.id])).toBe(divided);
  const longer = {...divider, points:[{x:0,y:-10},{x:0,y:95}]};
  expect(healDeletedInk(paint,[longer])).toHaveLength(2);
  const split = {...divider, points:[{x:0,y:0},{x:0,y:34},{x:0,y:80}]};
  const retained = [...paint,split];
  expect(healDeletedInk(retained,[longer])).toBe(retained);
});

it('heals the vacated divider while the final and protected owners keep their slots', () => {
  const left = rect('left',0,0,50,80), middle = rect('middle',50,0,50,80), right = rect('right',100,0,50,80);
  const source: Vector = { ...left, id:'divider', kind:'path', x:50, strokeWidth:2, fillEnabled:false,
    points:[{x:0,y:0},{x:0,y:80}] };
  const moved = {...source,x:75}, still = {...source,id:'stationary',x:100};
  const eligible = new Set([left.id,middle.id,right.id]);
  const artwork = [left,middle,right,still,moved];
  const result = planVacatedInkHealing(artwork,[source],eligible)!;
  expect(result.artwork).toHaveLength(4);
  expect(result.artwork.slice(1)).toEqual([right,still,moved]);
  expect(result.artwork[2]).toBe(still);
  expect(result.artwork[3]).toBe(moved);
  expect(hit(result.artwork[0],{x:80,y:40},0)).toBe(true);
  expect(hit(result.artwork[0],{x:120,y:40},0)).toBe(false);
  expect(planVacatedInkHealing(artwork,[source],new Set([left.id,right.id]))?.artwork).toBe(artwork);
  const returned = [left,middle,right,still,source];
  expect(planVacatedInkHealing(returned,[source],eligible)?.artwork).toBe(returned);
});

it('reunites the two painted sides of a deleted cubic Pencil line', () => {
  const oval: Vector = {...rect('oval',40,40,200,120),kind:'ellipse'};
  const line: Vector = {...rect('line',0,0,300,180),kind:'bezier',strokeWidth:2,fillEnabled:false,
    nodes:[{x:10,y:105,out:{x:90,y:35}},{x:275,y:100,in:{x:190,y:165}}]};
  const cut = prepareShapeDrawing([oval],{shape:line,merge:true}).shapes;
  // The line divides the oval and stays one curved line (only other lines cut a line).
  const ink = cut.filter(s=>s.strokeWidth);
  expect(ink).toHaveLength(1);
  expect(ink[0].nodes?.some(n=>n.in||n.out)).toBe(true);
  expect(cut.filter(s=>!s.strokeWidth)).toHaveLength(2);
  const reunited=healDeletedInk(cut.filter(s=>s!==ink[0]),[ink[0]]);
  const paint=reunited.filter(s=>!s.strokeWidth);
  expect(paint).toHaveLength(1);
  expect(hit(paint[0],{x:125,y:70},0) && hit(paint[0],{x:140,y:136},0)).toBe(true);
  expect(paint[0].contours![0].some(n=>n.in||n.out)).toBe(true);
  expect(reunited.filter(s=>s.strokeWidth)).toEqual([]);
});

it('preserves enclosed paint when a curved or holed surround cannot prove containment, or stacking would change', () => {
  const outer = rect('outer', 0, 0, 120, 120);
  const inner = rect('inner', 10, 10, 30, 30);
  const ring = (x: number, y: number, size: number) => [{ x, y }, { x: x + size, y },
    { x: x + size, y: y + size }, { x, y: y + size }];
  const holed: Vector = { ...outer, kind: 'polygon', fillRule: 'evenodd', contours: [ring(0, 0, 120), ring(15, 15, 20)] };
  const cover = { ...inner, id: 'cover', fill: '#ff0000' };
  for (const artwork of [[{ ...outer, cornerRadius: 60 }, inner], [holed, inner], [outer, cover, inner]]) {
    for (const seed of [artwork[0], inner]) expect(joinRecoloredFills(artwork, [seed.id])).toBe(artwork);
  }
});

it('cancels an exact curved seam and retains the exterior Bézier handles', () => {
  const left: Vector = { ...rect('left', 100, 80, 90, 80), kind: 'polygon', fillRule: 'evenodd', contours: [[
    { x: 0, y: 0, out: { x: 24, y: -12 } },
    { x: 90, y: 0, in: { x: 64, y: -12 }, out: { x: 110, y: 20 } },
    { x: 90, y: 80, in: { x: 105, y: 66 } }, { x: 0, y: 80 },
  ]] };
  const right: Vector = { ...rect('right', 190, 80, 75, 80), kind: 'polygon', fillRule: 'evenodd', contours: [[
    { x: 0, y: 0, in: { x: 20, y: 20 } }, { x: 75, y: 0 }, { x: 75, y: 80 },
    { x: 0, y: 80, out: { x: 15, y: 66 } },
  ]] };
  const before = structuredClone([left, right]);
  const joined = joinRecoloredFills([left, right], [left.id]);
  expect(joined).toHaveLength(1);
  expect(joined[0].id).toBe(left.id);
  const ring = joined[0].contours![0];
  const start = ring.find(node => worldPoint(joined[0], node).x === 100 && node.out)!;
  expect(worldPoint(joined[0], start.out!)).toEqual({ x: 124, y: 68 });
  expect(ring.filter(node => node.in || node.out)).toHaveLength(2);
  expect(hit(joined[0], { x: 260, y: 110 }, 0)).toBe(true);
  expect([left, right]).toEqual(before);
});

it('joins a partial straight edge and only the connected matching paint', () => {
  const seed = rect('seed', 0, 0, 40, 80), right = rect('right', 40, 20, 40, 40), far = rect('far', 90, 0, 30, 80);
  const joined = joinRecoloredFills([seed, right, far], ['seed']);
  expect(joined.map(s => s.id)).toEqual(['seed', 'far']);
  expect(joined[1]).toBe(far);
  expect(hit(joined[0], { x: 55, y: 24 }, 0)).toBe(true);
  expect(hit(joined[0], { x: 55, y: 16 }, 0)).toBe(false);
  expect(joinRecoloredFills([seed, far, right], ['seed']).map(s => s.id)).toEqual(['seed', 'far']);
});

it('removes a curved hole boundary when the fill inside it is recolored to match', () => {
  const target = rect('target', 100, 100, 140, 140);
  const cutter: Vector = { ...rect('cutter', 120, 120, 60, 60), kind: 'ellipse', fill: '#ff0000' };
  const [surround, inside] = dropPaintSelection([target, cutter], [cutter.id], [target.id]);
  expect(surround.contours).toHaveLength(2);
  const joined = joinRecoloredFills([surround, { ...inside, fill: target.fill }], [inside.id]);
  expect(joined).toHaveLength(1);
  expect(joined[0].contours).toHaveLength(1);
  expect(hit(joined[0], { x: 150, y: 150 }, 0)).toBe(true);
});

it('joins an inset square beneath the outer stroke from either side and preserves a crossing stroke barrier', () => {
  const outer = rect('outer', 100, 100, 140, 140);
  const inner = rect('inner', 130, 130, 60, 60);
  const [surround, inset] = dropPaintSelection([outer, { ...inner, fill: '#ff0000' }], [inner.id], [outer.id]);
  const matching = { ...inset, fill: outer.fill };
  const border: Vector = { ...outer, id: 'border', kind: 'path', closed: true, fillEnabled: false,
    strokeWidth: 2, points: [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 140 }, { x: 0, y: 140 }] };
  const separate = [surround, border, matching];
  for (const seed of [surround, matching]) {
    const result = joinRecoloredFills(separate, [seed.id]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(seed.id);
    expect(result[0].contours).toHaveLength(1);
    expect(result[1]).toBe(border);
  }
  const crossing: Vector = { ...border, id: 'crossing', y: 150, closed: false,
    points: [{ x: 0, y: 0 }, { x: 140, y: 0 }] };
  const blocked = [surround, crossing, matching];
  for (const seed of [surround, matching]) expect(joinRecoloredFills(blocked, [seed.id])).toBe(blocked);
});

it('joins nested squares after fractional resizing and placement', () => {
  const surround = rect('surround', 92.719871, 75.49968, 234.85723, 234.85723);
  for (let i = 0; i < 64; i++) {
    const scale = 0.3811925 + i * 0.00187283;
    const inner: Vector = { ...rect('inner', 111.31817698 + 0.48972 * i, 85.7187418 + 0.32867 * i, 221.125, 221.125),
      transform: [scale, 0, 0, scale], fill: '#ff0000' };
    const [outside, inset] = dropPaintSelection([surround, inner], [inner.id], [surround.id]);
    const matching = [outside, { ...inset, fill: surround.fill }];
    for (const seed of matching) {
      const result = joinRecoloredFills(matching, [seed.id]);
      expect(result, `fractional placement ${i}, ${seed.id === inset.id ? 'inset' : 'surround'}`).toHaveLength(1);
      expect(result[0].contours).toHaveLength(1);
      expect(hit(result[0], { x: 130, y: 110 }, 0)).toBe(true);
    }
    if (i === 35) {
      const shifted = [outside, { ...matching[1], x: matching[1].x + 1e-7 }];
      expect(joinRecoloredFills(shifted, [inset.id])).toBe(shifted);
    }
  }
});

it('keeps both closed square outlines when matching their nested paint', () => {
  const outer = {...rect('outer',80,55,200,200),strokeWidth:2};
  const inner = {...rect('inner',140,115,80,80),fill:'#ff0000',strokeWidth:2};
  const first = prepareShapeDrawing([],{shape:outer,merge:true}).shapes;
  const before = prepareShapeDrawing(first,{shape:inner,merge:true}).shapes;
  const seed = before.find(s=>!s.strokeWidth && s.fill===inner.fill)!;
  const joined = joinRecoloredFills(before.map(s=>s===seed ? {...s,fill:outer.fill} : s),[seed.id]);
  expect(joined.filter(s=>!s.strokeWidth)).toHaveLength(1);
  expect(joined.filter(s=>s.strokeWidth)).toEqual(before.filter(s=>s.strokeWidth));
});

it('joins the curved seam created where a dropped fill crosses an existing edge', () => {
  const target = rect('target', 100, 100, 140, 140);
  const cutter: Vector = { ...rect('cutter', 185, 130, 100, 85), kind: 'ellipse', fill: '#ff0000' };
  const [surround, inside] = dropPaintSelection([target, cutter], [cutter.id], [target.id]);
  const joined = joinRecoloredFills([surround, { ...inside, fill: target.fill }], [inside.id]);
  expect(joined).toHaveLength(1);
  expect(joined[0].contours).toHaveLength(1);
  expect(hit(joined[0], { x: 102, y: 140 }, 0)).toBe(true);
  expect(hit(joined[0], { x: 282, y: 175 }, 0)).toBe(true);
});

it('keeps overlaps, point contacts, protected paint, and gaps separate', () => {
  const seed = rect('seed', 0, 0, 40, 40);
  for (const other of [rect('corner', 40, 40, 40, 40), rect('overlap', 39, 0, 40, 40),
    rect('gap', 40.00001, 0, 40, 40), { ...rect('object', 40, 0, 40, 40), drawingMode: 'object' as const },
    { ...rect('stroke', 40, 0, 40, 40), strokeWidth: 1 }]) {
    const input = [seed, other];
    expect(joinRecoloredFills(input, [seed.id])).toBe(input);
  }
  const separated = [seed, { ...rect('interleaved', 35, 0, 10, 40), fill: '#ff0000' }, rect('right', 40, 0, 40, 40)];
  expect(joinRecoloredFills(separated, [seed.id])).toBe(separated);
});

it('rejects a real interior overlap even when another contour shares an exact seam', () => {
  const ring = (x: number) => [{ x, y: 0 }, { x: x + 40, y: 0 }, { x: x + 40, y: 40 }, { x, y: 40 }];
  const left: Vector = { ...rect('left', 0, 0, 140, 40), kind: 'polygon', fillRule: 'evenodd',
    contours: [ring(0), ring(100)] };
  const right: Vector = { ...left, id: 'right', contours: [ring(40), ring(139)] };
  const input = [left, right];
  expect(joinRecoloredFills(input, [left.id])).toBe(input);
});

it('joins a real simplified Brush footprint crossing a differently colored rounded fill', () => {
  const { shapes, color, foreground } = recoloredBrushFixture();
  expect(shapes).toHaveLength(2);
  const recolored = shapes.map(shape => shape === foreground ? { ...shape, fill: color } : shape);
  for (const seed of recolored) {
    const result = joinRecoloredFills(recolored, [seed.id]);
    expect(result).toHaveLength(1);
    const [joined] = result;
    expect(joined.id).toBe(seed.id);
    expect(joined.contours).toHaveLength(1);
    const exterior = foreground.contours![0].find(node => worldPoint(foreground, node).x === 290)!;
    const anchor = joined.contours![0].find(node => worldPoint(joined, node).x === 290)!;
    expect(worldPoint(joined, anchor)).toEqual(worldPoint(foreground, exterior));
    expect(worldPoint(joined, anchor.in!)).toEqual(worldPoint(foreground, exterior.in!));
    expect(worldPoint(joined, anchor.out!)).toEqual(worldPoint(foreground, exterior.out!));
  }
});

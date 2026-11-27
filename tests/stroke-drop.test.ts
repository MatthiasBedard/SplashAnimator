import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { worldPaths } from '../packages/geometry/src/drawing';
import { prepareMovedStrokeMerges } from '../packages/geometry/src/stroke-drop';

const line = (id: string, x: number, y: number, dx: number, dy: number): Vector => ({
  id, kind: 'path', x, y, width: Math.abs(dx), height: Math.abs(dy), rotation: 0,
  fill: '#000000', fillEnabled: false, stroke: '#000000', strokeWidth: 6, drawingMode: 'merge',
  points: [{ x: 0, y: 0 }, { x: dx, y: dy }],
});
const merge = (strokes: Vector[]) =>
  prepareMovedStrokeMerges(strokes, new Set(['moving']), new Set(strokes.map(shape => shape.id)));

it('deduplicates a collinear overlap even when the strokes have different origins', () => {
  const input = [line('base', 10, 20, 50, 0), line('moving', 30, 20, 50, 0)];
  const before = structuredClone(input);
  const output = merge(input);
  expect(input).toEqual(before);
  expect(output).toHaveLength(1);
  expect(output[0].sources).toEqual([0, 1]);
  expect(output[0].strokes).toHaveLength(1);
  const [points] = worldPaths(output[0].strokes[0]);
  expect(points).toEqual([10,30,60,80].map(x => ({x,y:20})));
});

it('keeps a crossing editable and leaves distant and nearby non-contact strokes exact', () => {
  const base = line('base', 5, 30, 55, 0);
  const near = line('near', 62, 32, 20, 0);
  const far = line('far', 500, 100, 20, 0);
  const moving = line('moving', 45, 10, 0, 40);
  const result = merge([base, moving, near, far]);
  expect(result).toHaveLength(1);
  expect(result[0].sources).toEqual([0, 1]);
  expect(result[0].strokes).toHaveLength(4);
  for (const stroke of result[0].strokes) {
    expect(stroke.strokeWidth).toBe(6);
    expect(worldPaths(stroke).flat()).toContainEqual({x:45,y:30});
  }
  // Close strokes with overlapping paint bounds still need a centerline contact.
  expect(merge([base, {...moving, x:6, y:32, points:base.points}])).toEqual([]);
});

it('merges across distant intervening paint without replacing it', () => {
  const base = line('base', 5, 30, 55, 0), moving = line('moving',45,10,0,40);
  const fill: Vector = {...base,id:'fill',kind:'rectangle',x:100,y:100,height:20,fillEnabled:true,strokeWidth:0};
  const input = [base,fill,moving], before = structuredClone(input);
  const [result] = merge(input);
  expect(result.sources).toEqual([0,2]);
  expect(result.strokes).toHaveLength(4);
  expect(input).toEqual(before);
});

it('protects overlapping intervening paint and ineligible lines', () => {
  const base = line('base', 5, 30, 55, 0), moving = line('moving',45,10,0,40);
  const fill: Vector = {...base,id:'fill',kind:'rectangle',y:25,height:20,fillEnabled:true,strokeWidth:0};
  expect(merge([base,fill,moving])).toEqual([]);
  expect(prepareMovedStrokeMerges([base,moving],new Set(['moving']),new Set())).toEqual([]);
});

it('retains Bézier handles on both sides of a new stroke junction', () => {
  const moving: Vector = {
    ...line('moving',10,20,80,0),
    kind:'bezier', points:[], nodes:[{x:0,y:0,out:{x:20,y:-20}},{x:80,y:0,in:{x:60,y:20}}],
  };
  const [result] = merge([line('base',50,0,0,40),moving]);
  const curves = result.strokes.filter(shape => shape.kind === 'bezier');
  expect(curves).toHaveLength(2);
  for (const curve of curves) {
    expect(curve.nodes?.some(node => node.in || node.out)).toBe(true);
    const [points] = worldPaths(curve);
    expect([points[0],points.at(-1)]).toContainEqual({x:50,y:20});
  }
});

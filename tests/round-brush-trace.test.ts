import { expect, it } from 'vitest';
import type { Point, Vector } from '../packages/document/src';
import { fitBrushCenterline } from '../packages/geometry/src/brush-centerline';
import { containsPoint, worldPaths } from '../packages/geometry/src/drawing';
import { segmentDistance } from '../packages/geometry/src';
import { smoothBrushSamples } from '../packages/geometry/src/pressure';
import { traceRoundBrush } from '../packages/geometry/src/round-brush-trace';
import { mergeVectors } from '../packages/geometry/src/merge';
import { certifyRoundBrushFootprint, prepareTracedRoundBrush } from '../packages/geometry/src/round-brush-fit';

const distance = (point: Point, path: Point[]) => {
  let nearest = Math.hypot(point.x - path[0].x, point.y - path[0].y);
  for (let i = 1; i < path.length; i++) {
    nearest = Math.min(nearest, segmentDistance(point, path[i - 1], path[i]));
  }
  return nearest;
};

const inside = (point: Point, rings: Point[][]) =>
  rings.reduce((painted, ring) => painted !== containsPoint(ring, point), false);

it('traces a round dab and a retraced capsule with one exterior', () => {
  for (const path of [[{x:0,y:0}], [{x:0,y:0},{x:80,y:24},{x:0,y:0}]]) {
    const rings = traceRoundBrush(path, 12, .4)!;
    expect(rings).toHaveLength(1);
    expect(inside({x:0,y:0}, rings)).toBe(true);
    expect(inside({x:-13,y:0}, rings)).toBe(false);
    expect(inside({x:-11,y:0}, rings)).toBe(true);
    expect(Math.max(...rings[0].map(point => Math.abs(distance(point, path) - 12)))).toBeLessThan(.01);
  }
});

it('preserves the open hole of a loop and relative geometry after translation', () => {
  const points = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100},{x:0,y:0}];
  const rings = traceRoundBrush(points, 12, .4)!;
  expect(rings).toHaveLength(2);
  expect(inside({x:50,y:50}, rings)).toBe(false);
  expect(inside({x:5,y:5}, rings)).toBe(true);
  expect(inside({x:25,y:-13}, rings)).toBe(false);
  const translated = traceRoundBrush(points.map(p => ({x:p.x+1e8,y:p.y-1e8})), 12, .4)!;
  expect(translated.map(ring => ring.length)).toEqual(rings.map(ring => ring.length));
  for (const [i, ring] of rings.entries()) for (const [j, p] of ring.entries()) {
    expect(translated[i][j].x - 1e8).toBeCloseTo(p.x, 6);
    expect(translated[i][j].y + 1e8).toBeCloseTo(p.y, 6);
  }
});

it.each([false, true])('traces the fitted reference input with bounded boundary error (looping %s)', looping => {
  const samples = Array.from({ length: looping ? 3500 : 4500 }, (_, i) => {
    const x = i*.9, y = 150 + 40*Math.sin(i/60);
    return looping ? {x:x+40*Math.sin(i/17),y:y+40*Math.cos(i/17)}
      : {x:Math.round(x),y:Math.round(y)};
  });
  const brush: Vector = {kind:'brush',id:'trace',x:0,y:0,rotation:0,width:4100,height:300,
    fill:'#0088ff',stroke:'#000000',strokeWidth:24,points:smoothBrushSamples(samples, .5)};
  const line = fitBrushCenterline(brush,.5)!;
  const snapshot = structuredClone(line);
  if (looping) expect(traceRoundBrush(line, 12, .4)).toBeUndefined();
  const rings = traceRoundBrush(line, 12, .45)!;
  expect(rings?.length).toBe(looping ? 34 : 1);
  const polygonSweep = mergeVectors([{...brush,points:line}]);
  expect(polygonSweep).toHaveLength(1);
  expect(rings).toHaveLength(polygonSweep[0].contours!.length);
  const candidate = prepareTracedRoundBrush(brush,line,.5,.45,polygonSweep[0]);
  expect(candidate).toBeDefined();
  expect(candidate!.contours).toHaveLength(rings.length);
  expect(candidate!.contours!.flat().length).toBeLessThan(looping ? 600 : 260);
  expect(candidate!.contours!.some(r=>r.some(n=>n.in || n.out))).toBe(true);
  const fittedPaths = worldPaths(candidate!, .025);
  expect(inside({x:0,y:150+(looping?40:0)},fittedPaths)).toBe(true);
  expect(inside({x:0,y:300},fittedPaths)).toBe(false);
  if (looping) {
    // The full fit can reduce some tiny contours to two arcs. Keep those
    // rings editable, with their own closed boundary and no invented handles.
    expect(candidate!.contours!.slice(1).some(r=>r.every(n=>!n.in && !n.out))).toBe(true);
    const missing = {...candidate!,contours:candidate!.contours!.slice(0,-1)};
    expect(certifyRoundBrushFootprint(polygonSweep[0],missing,1)).toBe(false);
  }
  expect(inside({x:0,y:150+(looping?40:0)},rings)).toBe(true);
  expect(inside({x:0,y:300},rings)).toBe(false);
  for (const ring of rings) for (let i=0; i<ring.length; i+=17) {
    expect(Math.abs(distance(ring[i],line)-12)).toBeLessThan(.25);
  }
  expect(line).toEqual(snapshot);
});

it('declines oversized and sub-resolution grids and rejects nonfinite input', () => {
  expect(traceRoundBrush([{x:0,y:0},{x:100000,y:100000}], 12, .4)).toBeUndefined();
  expect(traceRoundBrush([{x:0,y:0}], .01, .4)).toBeUndefined();
  expect(traceRoundBrush([], 1, .1)).toBeUndefined();
  expect(() => traceRoundBrush([{x:NaN,y:0}], 12, .4)).toThrow(/coordinates/);
  expect(() => traceRoundBrush([{x:0,y:0}], Infinity, .4)).toThrow(/dimensions/);
});

it('spends one sweep budget on repeated spans within a small grid', () => {
  const repeats = Array.from({length:10_000}, (_, i) => ({x:i%2,y:0}));
  expect(traceRoundBrush(repeats, 12, .4)).toBeUndefined();
});

it('keeps one continuous swept outline across tile edges in a sparse diagonal grid', () => {
  const path = [{x:0,y:0},{x:320,y:210}];
  const rings = traceRoundBrush(path,6,.2)!;
  expect(rings).toHaveLength(1);
  expect(rings[0].length).toBeGreaterThan(3200);
  for (const point of rings[0]) expect(Math.abs(distance(point,path)-6)).toBeLessThan(.01);
  for (let i=0;i<=16;i++) {
    expect(inside({x:320*i/16,y:210*i/16},rings)).toBe(true);
  }
  expect(inside({x:310,y:10},rings)).toBe(false);
  expect(inside({x:10,y:200},rings)).toBe(false);
});

it('certifies reordered rings and rejects a misplaced or duplicated tiny hole', () => {
  const square = (x:number,y:number,size:number) =>
    [{x,y},{x:x+size,y},{x:x+size,y:y+size},{x,y:y+size}];
  const exterior = square(0,0,50), hole = square(22,21,.03);
  const original:Vector = {
    kind:'polygon',id:'footprint',x:0,y:0,width:50,height:50,rotation:0,
    closed:true,fill:'#2255ff',stroke:'#000000',strokeWidth:0,fillRule:'evenodd',
    points:[],contours:[exterior,hole],
  };
  const reverse = {...original,contours:[hole.slice().reverse(),exterior]};
  expect(certifyRoundBrushFootprint(original,reverse,.5)).toBe(true);
  const relocated = {...original,contours:[exterior,square(23,21,.03)]};
  expect(certifyRoundBrushFootprint(original,relocated,.5)).toBe(false);
  expect(certifyRoundBrushFootprint(original,{...original,contours:[exterior,exterior]},.5)).toBe(false);
  const overlap = {...original,contours:[exterior,square(49.99,21,.03)]};
  expect(certifyRoundBrushFootprint(overlap,overlap,.5)).toBe(false);
});

import { expect, it } from 'vitest';
import { clone, type Vector } from '../packages/document/src';
import { mergeVectors } from '../packages/geometry/src/merge';
import { finishBrushPaint } from '../packages/geometry/src/brush-finish';
import { hit } from '../packages/geometry/src';

const brush = (loop = false): Vector => ({
  id: 'brush',
  kind: 'brush',
  x: 200,
  y: 200,
  width: 200,
  height: 100,
  rotation: 0,
  fill: '#123456',
  stroke: '#123456',
  strokeWidth: 24,
  points: Array.from({ length: 65 }, (_, i) =>
    loop
      ? { x: 60 * Math.cos((i * Math.PI) / 32), y: 60 * Math.sin((i * Math.PI) / 32) }
      : { x: i * 3, y: Math.sin(i / 10) * 30 },
  ),
  brush: { pressure: false, minimum: 1, tilt: false, aspect: 1, angle: 0 },
});
const count = (shapes: Vector[]) =>
  shapes.reduce((n, s) => n + (s.contours?.flat().length ?? 0), 0);

it('retains the original footprint when an outline has a short ring', () => {
  const b = brush();
  const shapes = mergeVectors([b]);
  shapes[0].contours!.push([]);
  expect(finishBrushPaint(shapes, { brush: b, amount: 0.5 })).toEqual(shapes);
});

for (const loop of [false, true])
  it(`fits finished brush edges into fewer curved anchors (loop=${loop})`, () => {
    const b = brush(loop),
      merged = mergeVectors([b]),
      before = clone(merged);
    const fitted = finishBrushPaint(merged, { brush: b, amount: 0.5 });
    expect(count(fitted)).toBeLessThan(count(merged) / 2);
    expect(fitted.some((s) => s.contours?.some((r) => r.some((n) => n.in && n.out)))).toBe(true);
    expect(merged).toEqual(before);
    expect(fitted.map((s) => s.contours?.length)).toEqual(merged.map((s) => s.contours?.length));
    if (loop) expect(fitted.some((s) => hit(s, { x: 200, y: 200 }, 0))).toBe(false);
    expect(finishBrushPaint(merged, { brush: b, amount: 0 })).toEqual(merged);
  });

it('stronger smoothing reduces more vertices while distant paint is untouched', () => {
  const b = brush(),
    distant = { ...brush(), id: 'distant', x: 1000 };
  const merged = mergeVectors([b, distant]);
  const low = finishBrushPaint(merged, { brush: b, amount: 0.05 });
  const high = finishBrushPaint(merged, { brush: b, amount: 1 });
  expect(count(high)).toBeLessThan(count(low));
  expect(high.filter((s) => s.x > 700)).toEqual(merged.filter((s) => s.x > 700));
});

it('preserves shared color boundaries and already fitted curves exactly', () => {
  const b = brush(),
    other: Vector = {
      ...b,
      id: 'box',
      kind: 'rectangle',
      x: 250,
      y: 210,
      width: 70,
      height: 60,
      points: [],
      strokeWidth: 0,
      fill: '#ff0000',
    };
  const merged = mergeVectors([b, other]);
  expect(finishBrushPaint(merged, { brush: b, amount: 1 })).toEqual(merged);
  const fitted = finishBrushPaint(mergeVectors([b]), { brush: b, amount: 0.5 });
  expect(finishBrushPaint(fitted, { brush: b, amount: 1 })).toEqual(fitted);
});

it('keeps a narrow hole and thin paint intact at maximum smoothing', () => {
  const b = { ...brush(true), strokeWidth: 115 };
  const merged = mergeVectors([b]);
  const fitted = finishBrushPaint(merged, { brush: b, amount: 1 });
  expect(fitted.map((s) => s.contours?.length)).toEqual(merged.map((s) => s.contours?.length));
  expect(fitted.some((s) => hit(s, { x: 200, y: 200 }, 0))).toBe(false);
  expect(fitted.some((s) => hit(s, { x: 230, y: 200 }, 0))).toBe(true);
});

it('smooths hand jitter in a thick stroke rather than only reducing storage', () => {
  const b = brush();
  b.strokeWidth = 60;
  b.points = Array.from({ length: 100 }, (_, i) => ({
    x: i * 3,
    y: Math.sin(i / 10) * 30 + (i % 2 ? 3 : -3),
  }));
  const merged = mergeVectors([b]);
  const fitted = finishBrushPaint(merged, { brush: b, amount: 1 });
  expect(count(fitted)).toBeLessThan(count(merged) / 3);
  expect(fitted.some((s) => s.contours?.flat().some((n) => n.in && n.out))).toBe(true);
});

it('increasing smoothing cannot reintroduce vertices after a tighter turn rejects fitting', () => {
  const b = brush();
  b.points = Array.from({ length: 160 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 3) * 60 }));
  const raw = mergeVectors([b]);
  const counts = [0, 0.1, 0.25, 0.5, 0.75, 1].map((amount) =>
    count(finishBrushPaint(raw, { brush: b, amount })),
  );
  for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
  expect(counts.at(-1)).toBeLessThan(counts[1]);
});

it('smooths a loop even when unrelated paint lies inside its bounding box', () => {
  const b = brush(true);
  const center: Vector = {
    ...b,
    id: 'center',
    kind: 'rectangle',
    x: 195,
    y: 195,
    width: 10,
    height: 10,
    strokeWidth: 0,
    points: [],
    fill: '#ff0000',
  };
  const raw = mergeVectors([b, center]);
  const fitted = finishBrushPaint(raw, { brush: b, amount: 0.5 });
  expect(count(fitted)).toBeLessThan(count(raw) / 2);
  expect(fitted.filter((s) => s.fill === center.fill)).toEqual(
    raw.filter((s) => s.fill === center.fill),
  );
  expect(fitted.filter((s) => s.fill === b.fill).some((s) => hit(s, { x: 200, y: 200 }, 0))).toBe(
    false,
  );
});


it('extends outline smoothing beyond 100 percent while retaining loop topology',()=>{
 const b=brush(true),raw=mergeVectors([b]);
 const normal=finishBrushPaint(raw,{brush:b,amount:1}),strong=finishBrushPaint(raw,{brush:b,amount:10});
 expect(count(strong)).toBeLessThanOrEqual(count(normal));expect(strong.map(s=>s.contours?.length)).toEqual(raw.map(s=>s.contours?.length));expect(strong.some(s=>hit(s,{x:200,y:200},0))).toBe(false);
});
it('retains isolated merged paint exactly across a large scene',()=>{
 const distant:Vector[]=Array.from({length:600},(_,i)=>({...brush(),id:`retained-${i}`,kind:'polygon',drawingMode:'merge',fillRule:'evenodd',strokeWidth:0,x:1000+(i%30)*20,y:1000+Math.floor(i/30)*20,width:10,height:10,points:[],contours:[[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]]}));
 const before=clone(distant),result=mergeVectors([...distant,brush()]);
 expect(result.filter(s=>s.id.startsWith('retained-'))).toEqual(before);expect(distant).toEqual(before);expect(result.some(s=>hit(s,{x:240,y:220},0))).toBe(true);
});

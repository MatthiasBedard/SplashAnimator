import { expect, it } from 'vitest';
import { rangeHandlePose, rangeHandleTransform, rangePivotDrag } from '../packages/geometry/src/range-handles';
import { mapPoint } from '../packages/geometry/src/affine';
const box = { left: 10, top: 20, right: 110, bottom: 70 },
  pivot = { x: 60, y: 45 };
it('scales about opposite corners or the shared pivot, with proportional and reflected drags', () => {
  const start = { x: 110, y: 70 };
  const op = rangeHandleTransform('se', box, pivot, start, { x: 210, y: 170 }, false, false);
  expect(mapPoint(op, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  expect(mapPoint(op, start)).toEqual({ x: 210, y: 170 });
  const centered = rangeHandleTransform('se', box, pivot, start, { x: 160, y: 70 }, true, true);
  expect(mapPoint(centered, pivot)).toEqual(pivot);
  expect(centered[0]).toBe(2);
  expect(centered[3]).toBe(2);
  const reflected = rangeHandleTransform('se', box, pivot, start, { x: -90, y: 70 }, false, false);
  expect(reflected[0]).toBe(-1);
  expect(reflected[3]).toBe(1);
});
it('rotates with 15-degree snapping and rejects a singular handle/pivot configuration', () => {
  const r = rangeHandleTransform(
    'rotate',
    box,
    pivot,
    { x: 60, y: 0 },
    { x: 105, y: 45 },
    true,
    false,
  );
  const q = mapPoint(r, { x: 110, y: 45 });
  expect(q.x).toBeCloseTo(60);
  expect(q.y).toBeCloseTo(95);
  expect(() =>
    rangeHandleTransform(
      'se',
      box,
      { x: 110, y: 70 },
      { x: 110, y: 70 },
      { x: 120, y: 80 },
      false,
      true,
    ),
  ).toThrow('pivot');
});

it('uses a configured increment in place of the range rotation default', () => {
  const angle = 38 * Math.PI / 180, start = { x: 110, y: 45 };
  const end = { x: pivot.x + 50 * Math.cos(angle), y: pivot.y + 50 * Math.sin(angle) };
  const operation = rangeHandleTransform('rotate', box, pivot, start, end, true, false, 30);
  expect(Math.atan2(operation[1], operation[0])).toBeCloseTo(Math.PI / 6, 12);
  expect(rangeHandlePose('rotate', box, pivot, start, end, true, false).degrees).toBeCloseTo(45, 12);
});

it('reports the configured skew angle and keeps the Alt pivot and single-axis scaling', () => {
  const start = { x: 60, y: 20 }, end = { x: 90, y: 20 };
  const pose = rangeHandlePose('skew-n', box, pivot, start, end, true, true, 30);
  expect(pose.degrees).toBeCloseTo(-60, 12);
  expect(pose.operation[2]).toBeCloseTo(-Math.sqrt(3), 12);
  expect(mapPoint(pose.operation, pivot)).toEqual(pivot);
  expect(() => rangeHandlePose('skew-n', box, pivot, start, end, true, true, 90)).toThrow('90');
  expect(() => rangeHandlePose('rotate', box, pivot, start, end, true, true, NaN)).toThrow('increment');
  const scale = rangeHandlePose('scale-e', box, pivot, { x: 110, y: 45 }, { x: 210, y: 300 }, true, false, 30);
  expect(scale.degrees).toBeUndefined();
  expect(scale.operation[0]).toBe(2);
  expect(scale.operation[3]).toBe(1);
});

it('skews every edge along its tangent while fixing the opposite edge', () => {
  for (const [edge, start, end, fixed] of [
    ['n', { x: 60, y: 20 }, { x: 85, y: 35 }, { x: 60, y: 70 }],
    ['s', { x: 60, y: 70 }, { x: 85, y: 85 }, { x: 60, y: 20 }],
    ['w', { x: 10, y: 45 }, { x: 25, y: 70 }, { x: 110, y: 45 }],
    ['e', { x: 110, y: 45 }, { x: 125, y: 70 }, { x: 10, y: 45 }],
  ] as const) {
    const op = rangeHandleTransform('skew-' + edge, box, pivot, start, end, false, false);
    expect(mapPoint(op, fixed)).toEqual(fixed);
    const moved = mapPoint(op, start);
    expect(moved).toEqual(
      edge === 'n' || edge === 's' ? { x: end.x, y: start.y } : { x: start.x, y: end.y },
    );
    expect(op[0] * op[3] - op[1] * op[2]).toBe(1);
  }
});
it('skews about a shared pivot, snaps angles and rejects degenerate configurations', () => {
  const start = { x: 60, y: 20 };
  const op = rangeHandleTransform('skew-n', box, pivot, start, { x: 70, y: 20 }, true, true);
  expect(mapPoint(op, pivot)).toEqual(pivot);
  expect((Math.atan(op[2]) * 180) / Math.PI).toBeCloseTo(-15);
  expect(() =>
    rangeHandleTransform('skew-n', box, start, start, { x: 70, y: 20 }, false, true),
  ).toThrow('pivot');
  expect(() =>
    rangeHandleTransform('skew-n', box, pivot, start, { x: 100000, y: 20 }, true, false),
  ).toThrow('90');
});

it('moves shared pivots with offset retention, axis constraint and geometry bounds', () => {
  expect(rangePivotDrag(pivot, { x: 61, y: 46 }, { x: 71, y: 51 }, false)).toEqual({
    x: 70,
    y: 50,
  });
  expect(rangePivotDrag(pivot, { x: 61, y: 46 }, { x: 71, y: 51 }, true)).toEqual({ x: 70, y: 45 });
  expect(rangePivotDrag(pivot, { x: 61, y: 46 }, { x: 62, y: 56 }, true)).toEqual({ x: 60, y: 55 });
  expect(() => rangePivotDrag(pivot, pivot, { x: Infinity, y: 0 }, false)).toThrow('limits');
  expect(() => rangePivotDrag(pivot, pivot, { x: 100001, y: 0 }, false)).toThrow('limits');
});


it('scales all four edges on one axis while keeping the opposite edge and orthogonal coordinates fixed', () => {
  for(const edge of ['n','e','s','w']){
    const horizontal=edge==='e'||edge==='w';
    const start={x:edge==='w'?box.left:edge==='e'?box.right:60,y:edge==='n'?box.top:edge==='s'?box.bottom:45};
    const anchor={x:edge==='w'?box.right:edge==='e'?box.left:60,y:edge==='n'?box.bottom:edge==='s'?box.top:45};
    const end={x:horizontal?anchor.x+2*(start.x-anchor.x):999,y:horizontal?999:anchor.y+3*(start.y-anchor.y)};
    const op=rangeHandleTransform('scale-'+edge,box,pivot,start,end,true,false);
    expect(mapPoint(op,anchor)).toEqual(anchor);
    const p=mapPoint(op,{x:40,y:30});
    expect(p.x).toBe(horizontal?anchor.x+2*(40-anchor.x):40);
    expect(p.y).toBe(horizontal?30:anchor.y+3*(30-anchor.y));
    const custom={x:20,y:25};
    const centered=rangeHandleTransform('scale-'+edge,box,custom,start,
      {x:custom.x-2*(start.x-custom.x),y:custom.y-2*(start.y-custom.y)},true,true);
    expect(mapPoint(centered,custom)).toEqual(custom);
    expect(centered[0]).toBe(horizontal?-2:1);expect(centered[3]).toBe(horizontal?1:-2);
  }
});

it('edge scaling retains existing minimum protection and accepts a flat orthogonal dimension', () => {
  const flat={left:10,right:110,top:20,bottom:20},start={x:110,y:20};
  const op=rangeHandleTransform('scale-e',flat,{x:60,y:20},start,{x:10,y:500},false,false);
  expect(op[0]).toBe(.0001);expect(op[3]).toBe(1);expect(op[5]).toBe(0);
  const reflected=rangeHandleTransform('scale-e',flat,{x:60,y:20},start,{x:-90,y:500},false,false);
  expect(reflected[0]).toBe(-1);expect(reflected[3]).toBe(1);
  expect(()=>rangeHandleTransform('scale-e',flat,start,start,{x:100,y:20},false,true)).toThrow('pivot');
  for(const end of [{x:Infinity,y:20},{x:100,y:NaN}])
    expect(()=>rangeHandleTransform('scale-e',flat,pivot,start,end,false,false)).toThrow('finite');
  expect(()=>rangeHandleTransform('scale-invalid',box,pivot,start,start,false,false)).toThrow('valid');
});

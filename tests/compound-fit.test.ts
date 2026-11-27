import { expect, it } from 'vitest';
import { certifySimpleCurveWalks, fitCompoundContours } from '../packages/geometry/src/compound-fit';
import type { Cubic } from '../packages/geometry/src/curve-fit';

it('separates the diagonal tips beside a short cut and rejects an actual crossing at the same scale', () => {
  const first: Cubic = [
    { x: 0, y: 0 }, { x: -1, y: -0.25 }, { x: -3, y: -0.7 }, { x: -4, y: -1 },
  ];
  const second: Cubic = [
    { x: -4, y: -4 }, { x: -3, y: -3.1 }, { x: -1, y: -1 }, { x: 0.001, y: 0.00025 },
  ];
  function certify(shiftY: number) {
    const shifted: Cubic = second.map(p => ({ x: p.x, y: p.y + shiftY })) as Cubic;
    let work = 0;
    certifySimpleCurveWalks([[first], [shifted]], false, 1e-11, true, true, () => {
      if (++work > 200000) throw Error('work exhausted');
    }, true);
  }
  expect(() => certify(0)).not.toThrow();
  expect(() => certify(0.001)).toThrow('Fitted contours touch or cross');
});

it('rejects a second crossing or retrace away from a shared paint-cut corner',()=>{
  const a: Cubic=[{x:-100,y:0},{x:-70,y:0},{x:-30,y:0},{x:0,y:0}];
  const crossing: Cubic=[a[3],{x:-25,y:10},{x:-65,y:-12},{x:-95,y:-2}];
  const retrace: Cubic=[a[3],a[2],a[1],a[0]];
  for(const b of [crossing,retrace]){
    let work=0;
    expect(()=>certifySimpleCurveWalks([[a,b]],false,1e-11,true,true,()=>{
      if(++work>200000)throw Error('work exhausted');
    },true)).toThrow('Fitted join cannot be separated');
  }
});
const circle = (radius: number, count = 64) =>
  Array.from({ length: count }, (_, i) => ({
    x: radius * Math.cos((i * Math.PI * 2) / count),
    y: radius * Math.sin((i * Math.PI * 2) / count),
  }));
it('preserves outer, hole and island nesting without flattening rings together', () => {
  const input = [circle(100, 128), circle(60).reverse(), circle(25)],
    before = JSON.stringify(input);
  const result = fitCompoundContours(input, 0.1);
  expect(result.parents).toEqual([-1, 0, 1]);
  expect(result.depths).toEqual([0, 1, 2]);
  expect(result.rings).toHaveLength(3);
  expect(result.rings.reduce((n, r) => n + r.nodes.length, 0)).toBeLessThan(
    input.reduce((n, r) => n + r.length, 0),
  );
  expect(JSON.stringify(input)).toBe(before);
});
it('rejects crossings, touching rings and gaps narrower than twice the tolerance', () => {
  expect(() =>
    fitCompoundContours(
      [
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
          { x: 10, y: 0 },
        ],
      ],
      0.1,
    ),
  ).toThrow();
  expect(() => fitCompoundContours([circle(10), circle(10)], 0.1)).toThrow();
  expect(() => fitCompoundContours([circle(10), circle(9.9)], 0.1)).toThrow('clearance');
});
it('accepts disjoint components, reversed winding and translated coordinates', () => {
  const a = circle(20).map((p) => ({ x: p.x + 1000000000, y: p.y - 2000 })),
    b = circle(10)
      .reverse()
      .map((p) => ({ x: p.x + 1000000100, y: p.y - 2000 }));
  const fit = fitCompoundContours([a, b], 0.1);
  expect(fit.parents).toEqual([-1, -1]);
  expect(fit.depths).toEqual([0, 0]);
  expect(fit.rings[1].nodes[0]).toMatchObject(b[0]);
});

it('fits a dense separated outline without spending topology work on distant edges', () => {
  const input = [circle(1000, 1000)],
    before = JSON.stringify(input);
  const fit = fitCompoundContours(input, 0.1);
  expect(fit.parents).toEqual([-1]);
  expect(fit.rings[0].nodes.length).toBeLessThan(1000);
  expect(JSON.stringify(input)).toBe(before);
});

it('fits many disjoint components while still rejecting a nearby crossing pair', () => {
  const input = Array.from({ length: 180 }, (_, i) =>
    circle(10, 32).map((p) => ({ x: p.x + i * 40, y: p.y })),
  );
  const before = structuredClone(input);
  const fit = fitCompoundContours(input, 0.1);
  expect(fit.parents).toEqual(input.map(() => -1));
  expect(fit.depths).toEqual(input.map(() => 0));
  expect(input).toEqual(before);
  input.push(circle(10, 32).map((p) => ({ x: p.x + 5, y: p.y })));
  expect(() => fitCompoundContours(input, 0.1)).toThrow('clearance');
});

it('preserves shuffled nested components with mixed winding and detached source data', () => {
  const input = Array.from({ length: 40 }, (_, i) =>
    [10, 30, 20].map((radius, depth) => {
      const ring = circle(radius, 48).map((p) => ({ x: p.x + i * 100, y: p.y - 5000 }));
      return depth === 2 ? ring.reverse() : ring;
    }),
  ).flat();
  const before = structuredClone(input);
  const fit = fitCompoundContours(input, 0.1);
  expect(fit.parents).toEqual(
    Array.from({ length: 40 }, (_, i) => [i * 3 + 2, -1, i * 3 + 1]).flat(),
  );
  expect(fit.depths).toEqual(Array.from({ length: 40 }, () => [2, 0, 1]).flat());
  expect(fit.rings).toHaveLength(120);
  expect(input).toEqual(before);
});

it('rejects invalid clearance before accepting a fitted compound while preserving zero clearance', () => {
  const input = [circle(20)],
    before = structuredClone(input);
  for (const clearance of [-1, NaN, Infinity, -Infinity])
    expect(() => fitCompoundContours(input, 0.1, clearance)).toThrow(/clearance/);
  expect(fitCompoundContours(input, 0.1, 0).parents).toEqual([-1]);
  expect(input).toEqual(before);
});

it('directional join proofs retain source crossing/contact and numeric option rejection', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  expect(() => fitCompoundContours([square, square], 0.25, 0, true)).toThrow();
  expect(() =>
    fitCompoundContours(
      [
        [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
          { x: 10, y: 0 },
        ],
      ],
      0.25,
      0,
      true,
    ),
  ).toThrow();
  expect(() => fitCompoundContours([square], 0.25, 0, 1 as unknown as boolean)).toThrow(/option/);
  expect(() => fitCompoundContours([square], 0.25, NaN, true)).toThrow(/clearance/);
  expect(() => fitCompoundContours([[...square, { x: NaN, y: 0 }]], 0.25, 0, true)).toThrow();
});

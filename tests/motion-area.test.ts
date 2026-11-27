import { expect, it } from 'vitest';
import type { BezierNode, Vector } from '../packages/document/src';
import {
  validateMotionContourAreas,
  validateMotionContourEdges,
} from '../packages/animation/src/motion-nodes';

// Three-point Gauss-Legendre integrates the degree-five Bernstein area
// integrand exactly in real arithmetic, independently of the power-basis kernel.
function area(nodes: BezierNode[]): number {
  let sum = 0;
  const origin = nodes[0];
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i],
      q = nodes[(i + 1) % nodes.length];
    const c = [p, p.out ?? p, q.in ?? q, q].map((v) => ({ x: v.x - origin.x, y: v.y - origin.y }));
    for (const [s, w] of [
      [-Math.sqrt(3 / 5), 5 / 9],
      [0, 8 / 9],
      [Math.sqrt(3 / 5), 5 / 9],
    ]) {
      const t = (s + 1) / 2,
        u = 1 - t;
      const coordinate = (axis: 'x' | 'y') =>
        c[0][axis] * u ** 3 +
        3 * c[1][axis] * u * u * t +
        3 * c[2][axis] * u * t * t +
        c[3][axis] * t ** 3;
      const derivative = (axis: 'x' | 'y') =>
        3 *
        (u * u * (c[1][axis] - c[0][axis]) +
          2 * u * t * (c[2][axis] - c[1][axis]) +
          t * t * (c[3][axis] - c[2][axis]));
      sum += (w / 4) * (coordinate('x') * derivative('y') - coordinate('y') * derivative('x'));
    }
  }
  return sum;
}
function vector(nodes: BezierNode[]): Vector {
  return {
    id: 'oracle',
    kind: 'bezier',
    closed: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    nodes,
  };
}
function blend(a: BezierNode[], b: BezierNode[], t: number): BezierNode[] {
  return a.map((p, i) => {
    const node: BezierNode = { x: 0, y: 0 };
    for (const part of [undefined, 'in', 'out'] as const) {
      const from = part ? p[part] : p,
        to = part ? b[i][part] : b[i];
      if (!from || !to) continue;
      const point = { x: from.x * (1 - t) + to.x * t, y: from.y * (1 - t) + to.y * t };
      if (part) node[part] = point;
      else Object.assign(node, point);
    }
    return node;
  });
}
it('qualifies cubic morph area decisions against independent Bernstein quadrature', () => {
  let seed = 72931;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  let accepted = 0,
    rejected = 0,
    interiorRejected = 0;
  for (let sample = 0; sample < 120; sample++) {
    const count = 2 + (sample % 6);
    const ring = () =>
      Array.from({ length: count }, () => ({
        x: random() * 200 - 100,
        y: random() * 200 - 100,
        in: { x: random() * 200 - 100, y: random() * 200 - 100 },
        out: { x: random() * 200 - 100, y: random() * 200 - 100 },
      }));
    const first = ring(),
      last = ring();
    const c = area(first),
      end = area(last),
      mid = area(blend(first, last, 0.5));
    const a = 2 * (end + c - 2 * mid),
      b = end - c - a;
    const critical = -b / (2 * a);
    const signed = [c, end];
    if (critical > 0 && critical < 1) signed.push(area(blend(first, last, critical)));
    // Keep this numerical comparison well away from the implementation's
    // threshold; threshold-specific analytic arch tests live elsewhere.
    expect(Math.min(...signed.map(Math.abs))).toBeGreaterThan(1e-3);
    const safe = signed.every((v) => v * Math.sign(c) > 0);
    if (safe) accepted++;
    else rejected++;
    if (!safe && end * c > 0) interiorRejected++;
    for (const scale of [0.01, 1, 100])
      for (const origin of [0, -99900, 99900]) {
        const angle = sample * 0.37,
          mirror = sample % 2 ? -1 : 1;
        const transform = (nodes: BezierNode[]) =>
          nodes.map((p) => {
            const result = { ...p };
            const map = (v: { x: number; y: number }) => ({
              x: origin + scale * (Math.cos(angle) * v.x - Math.sin(angle) * v.y),
              y: origin + mirror * scale * (Math.sin(angle) * v.x + Math.cos(angle) * v.y),
            });
            Object.assign(result, map(p));
            result.in = map(p.in!);
            result.out = map(p.out!);
            return result;
          });
        const from = vector(transform(first)),
          to = vector(transform(last));
        const before = JSON.stringify([from, to]);
        if (safe) expect(() => validateMotionContourAreas(from, to)).not.toThrow();
        else expect(() => validateMotionContourAreas(from, to)).toThrow(/area collapses/);
        expect(JSON.stringify([from, to])).toBe(before);
      }
  }
  expect(accepted).toBeGreaterThan(10);
  expect(rejected).toBeGreaterThan(10);
  expect(interiorRejected).toBeGreaterThan(0);
});

it('rejects off-frame area collapse when twice the quadratic coefficient overflows', () => {
  const side = 1e153;
  const first = vector([
    { x: 0, y: 0 },
    { x: side, y: 0 },
    { x: 0, y: side },
  ]);
  const last = vector(first.nodes!.map((p) => ({ x: -9 * p.x, y: -9 * p.y })));
  const before = JSON.stringify([first, last]);
  // The signed area is side^2 * (1 - 10t)^2 / 2: zero at t=0.1.
  // Coefficients and the cancellation tolerance are finite, but 2*a is not.
  expect(() => validateMotionContourAreas(first, last)).toThrow(/area collapses/);
  expect(JSON.stringify([first, last])).toBe(before);
});

it('qualifies cubic collapse against constructed control coincidence across affine coordinate families', () => {
  let cases = 0;
  for (const scale of [0.125, 1, 128])
    for (const origin of [-99900, 0, 99900])
      for (const matrix of [
        [1, 0, 0, 1],
        [0, 1, -1, 0],
        [-1, 1, 2, 1],
      ])
        for (const factor of [1, 2, 4]) {
          const map = (x: number, y: number) => ({
            x: origin + scale * (matrix[0] * x + matrix[2] * y),
            y: origin + scale * (matrix[1] * x + matrix[3] * y),
          });
          const controls = [
            [0, 0],
            [8, 16],
            [24, -8],
            [32, 8],
          ];
          const a = controls.map(([x, y]) => map(x, y));
          const b = controls.map(([x, y]) => map(64 - factor * x, 32 - factor * y));
          const first = vector([
            { ...a[0], out: a[1] },
            { ...a[3], in: a[2] },
          ]);
          first.closed = false;
          const last = vector([
            { ...b[0], out: b[1] },
            { ...b[3], in: b[2] },
          ]);
          last.closed = false;
          const before = structuredClone([first, last]);
          // Constructed independently: all controls coincide at progress 1/(1+factor).
          const t = 1 / (1 + factor),
            samples = a.map((p, i) => ({
              x: (1 - t) * p.x + t * b[i].x,
              y: (1 - t) * p.y + t * b[i].y,
            }));
          for (const sample of samples)
            expect(Math.hypot(sample.x - samples[0].x, sample.y - samples[0].y)).toBeLessThan(1e-8);
          expect(() => validateMotionContourEdges(first, last)).toThrow(/segment collapses/);
          const safe = structuredClone(last);
          // Endpoint coincidence fixes the only possible collapse time. Moving just
          // one control away makes whole-segment collapse impossible at that time.
          safe.nodes![0].out!.y += scale * 4;
          expect(() => validateMotionContourEdges(first, safe)).not.toThrow();
          expect([first, last]).toEqual(before);
          cases++;
        }
  expect(cases).toBe(81);
});

import { expect, it } from 'vitest';
import { parseSvgPath } from '../apps/editor/src/svg-path';

it('retains relative path commands and reflects only the matching previous control', () => {
  const [path] = parseSvgPath('M10 20c1 0 2 4 3 4s3 4 6 0q3-6 6 0t6 0z');
  expect(path.closed).toBe(true);
  expect(path.nodes).toMatchObject([
    { x: 10, y: 20, out: { x: 11, y: 20 } },
    { x: 13, y: 24, in: { x: 12, y: 24 }, out: { x: 14, y: 24 } },
    { x: 19, y: 24, in: { x: 16, y: 28 }, out: { x: 21, y: 20 } },
    { x: 25, y: 24, in: { x: 23, y: 20 }, out: { x: 27, y: 28 } },
    { x: 31, y: 24, in: { x: 29, y: 28 } },
  ]);
});

it('retains an arc seam as a cubic handle and accepts adjacent arc flags', () => {
  const [ring] = parseSvgPath('M10 0A10 10 0 0110 20A10 10 0 0110 0Z');
  expect(ring.closed).toBe(true);
  expect(ring.nodes).toHaveLength(4);
  expect(ring.nodes[0].out!.x).toBeCloseTo(15.5228475);
  expect(ring.nodes[0].in!.x).toBeCloseTo(4.4771525);
  expect(ring.nodes[1].x).toBeCloseTo(20);
  expect(ring.nodes[3].x).toBeCloseTo(0);
});

it('keeps subpaths separate and rejects invalid command arguments', () => {
  expect(parseSvgPath('M0 0 10 10M2e1,5h5v-2z')).toEqual([
    { nodes: [{ x: 0, y: 0 }, { x: 10, y: 10 }], closed: false },
    { nodes: [{ x: 20, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 3 }], closed: true },
  ]);
  for (const invalid of ['L2 3', 'M0 0 A1 2 0 2 0 1 3', 'M1e999 0', 'M0 0 C1 2 3 4 5', 'M0,,1', 'M0 0,Z'])
    expect(() => parseSvgPath(invalid)).toThrow();
});

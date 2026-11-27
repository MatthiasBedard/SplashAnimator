import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import type { Vector } from '../packages/document/src';
import clipping, { evenOddPaint } from '../packages/geometry/src/paint-clipping';
import { contains, vectorPolygons } from '../packages/geometry/src/merge';
import { commitBrushPaint } from '../packages/geometry/src/brush-commit';
const floating = createRequire(new URL('../packages/geometry/package.json', import.meta.url))(
  'polygon-clipping',
) as Record<'union' | 'difference' | 'intersection' | 'xor', (...args: unknown[]) => unknown>;
afterEach(() => vi.restoreAllMocks());
export const queueFailure = (side = 'left') =>
  new Error(
    `Unable to pop() ${side} SweepEvent [66.44871739195302, 334.9944499599596] from segment #2996 [66.44871739195302, 334.9944499599596] -> [66.44883787083073, 334.99474973631874] from queue.`,
  );
type Ring = [number, number][];
const box = (x: number, y: number, w: number, h: number): Ring => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
];
for (const op of ['union', 'difference', 'intersection'] as const)
  for (const side of ['left', 'right'])
    for (const origin of [0, -99900, 99900])
      it(`${op} retries the reported ${side} queue failure with near-coincident edges at ${origin}`, () => {
        const x = origin + 66.44871739195302,
          y = origin + 334.9944499599596;
        const outer: Ring = [
          [x - 30, y - 20],
          [x, y - 20],
          [x, y],
          [origin + 66.44883787083073, origin + 334.99474973631874],
          [x, y + 20],
          [x - 30, y + 20],
          [x - 30, y - 20],
        ];
        const first = [outer, box(x - 20, y - 5, 10, 10).reverse()],
          second = [box(x - 5, y - 10, 20, 20)],
          before = structuredClone({ first, second });
        const spy = vi.spyOn(floating, op).mockImplementation(() => {
          throw queueFailure(side);
        });
        const out = clipping[op](first, second);
        expect(spy).toHaveBeenCalledTimes(1);
        for (let dx = -33.75; dx < 20; dx += 2.5)
          for (let dy = -23.75; dy < 25; dy += 2.5) {
            const a =
                dx > -30 &&
                dx < 0 &&
                dy > -20 &&
                dy < 20 &&
                !(dx > -20 && dx < -10 && dy > -5 && dy < 5),
              b = dx > -5 && dx < 15 && dy > -10 && dy < 10;
            expect(contains(out, { x: x + dx, y: y + dy })).toBe(
              op === 'union' ? a || b : op === 'difference' ? a && !b : a && b,
            );
          }
        expect({ first, second }).toEqual(before);
      });

for (const op of ['union', 'difference', 'intersection'] as const)
  it(`${op} does not discard collapsed paint or accept nonfinite coordinates after a queue fault`, () => {
    vi.spyOn(floating, op).mockImplementation(() => {
      throw queueFailure();
    });
    const outer = [box(0, 0, 10, 10)],
      tiny = [box(1, 1, 0.00001, 0.00001)];
    const recovered = clipping[op](outer, tiny);
    expect(contains(recovered, {x: 1.000005, y: 1.000005})).toBe(op !== 'difference');
    expect(contains(recovered, {x: 5, y: 5})).toBe(op !== 'intersection');
    // A persistent sweep failure and a contour too thin even for the local grid
    // still reject the whole operation.
    expect(() => clipping[op](outer, [box(1, 1, 1e-10, 0.2)])).toThrow(/collapses/);
    for (const value of [NaN, Infinity, -Infinity])
      expect(() =>
        clipping[op](
          [
            [
              [value, 0],
              [1, 0],
              [1, 1],
              [value, 0],
            ],
          ],
          outer,
        ),
      ).toThrow(/precision/);
  });

for (const message of [
  'Infinite loop when putting segment endpoints in a priority queue (queue size too big).',
  'Infinite loop when passing sweep line over endpoints (queue size too big).',
  'Infinite loop when passing sweep line over endpoints (too many sweep line segments).',
  'Unable to pop() an unrelated value',
  'Unrelated allocation failure',
])
  it(`propagates the original error rather than bypassing a guard: ${message}`, () => {
    const error = new Error(message);
    vi.spyOn(floating, 'union').mockImplementation(() => {
      throw error;
    });
    expect(() => clipping.union([box(0, 0, 10, 10)])).toThrow(error);
  });

it('keeps parity, holes and islands when XOR reports the queue fault', () => {
  vi.spyOn(floating, 'xor').mockImplementationOnce(() => {
    throw queueFailure();
  });
  const result = evenOddPaint([[box(0, 0, 20, 20)], [box(3, 3, 14, 14)], [box(6, 6, 8, 8)]]);
  expect(contains(result, { x: 1, y: 1 })).toBe(true);
  expect(contains(result, { x: 4, y: 4 })).toBe(false);
  expect(contains(result, { x: 7, y: 7 })).toBe(true);
});

for (const merge of [false, true])
  for (const mode of ['normal', 'behind', 'fills', 'selection', 'inside'] as const)
    it(`real Brush ${mode}/merge${merge} survives queue faults in paint masks and stroke expansion`, () => {
      const old: Vector = {
        id: 'old',
        kind: 'rectangle',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 8,
        points: [],
      };
      const brush: Vector = {
        ...old,
        id: 'brush',
        kind: 'brush',
        x: -20,
        y: 50,
        fill: '#00ff00',
        strokeWidth: 30,
        points: [
          { x: 0, y: 0 },
          { x: 240, y: 0 },
        ],
      };
      const before = structuredClone({ old, brush });
      const fail = () => {
        throw queueFailure();
      };
      const spies = ['union', 'difference', 'intersection'].map((op) =>
        vi.spyOn(floating, op as 'union').mockImplementation(fail),
      );
      const out = commitBrushPaint([old], {
        brush,
        amount: 0,
        merge,
        mode,
        selected: ['old'],
        at: mode === 'behind' ? 0 : 1,
      });
      const green = (x: number) =>
        out.filter((s) => contains(vectorPolygons(s), { x, y: 50 })).at(-1)?.fill === '#00ff00';
      expect(green(50)).toBe(mode !== 'behind' && mode !== 'inside');
      expect(green(-10)).toBe(mode !== 'selection');
      if (mode === 'fills') expect(green(1)).toBe(false);
      if (mode !== 'normal' && mode !== 'behind')
        expect(spies.some((s) => s.mock.calls.length)).toBe(true);
      expect({ old, brush }).toEqual(before);
    });

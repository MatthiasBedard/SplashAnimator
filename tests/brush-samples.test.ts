import { expect, test } from 'vitest';
import { BrushSamples, appendSample } from '../packages/interaction/src';
import { MAX_VECTOR_POINTS, clone, type Point } from '../packages/document/src';

test('live Brush capture retains complete samples and the original document capacity', () => {
  const first: Point = { x: 0, y: 0, pressure: 0.2, tiltX: -25, tiltY: 12, twist: 90 };
  const samples = new BrushSamples(first);
  expect(Array.isArray(samples)).toBe(true);
  // A class prototype keeps gesture storage outside Svelte deep proxying.
  expect(Object.getPrototypeOf(samples)).not.toBe(Array.prototype);
  for (let i = 1; i < MAX_VECTOR_POINTS; i++)
    expect(appendSample(samples, { ...first, x: i, y: i % 2 })).toBe(true);
  expect(samples).toHaveLength(MAX_VECTOR_POINTS);
  expect(samples[0]).toBe(first);
  expect(samples.at(-1)).toEqual({ ...first, x: MAX_VECTOR_POINTS - 1, y: 1 });
  expect(appendSample(samples, { x: MAX_VECTOR_POINTS, y: 0 })).toBe(false);
  expect(samples).toHaveLength(MAX_VECTOR_POINTS);
});

test('worker, history and derived samples are ordinary detached arrays with exact pen data', () => {
  const samples = new BrushSamples({
    x: 1,
    y: 2,
    pressure: 0.3,
    tiltX: 15,
    tiltY: -10,
    twist: 270,
  });
  for (const output of [
    clone(samples),
    structuredClone(samples),
    samples.map((p) => ({ ...p })),
    samples.slice(),
  ]) {
    expect(Object.getPrototypeOf(output)).toBe(Array.prototype);
    expect(output).toEqual([{ x: 1, y: 2, pressure: 0.3, tiltX: 15, tiltY: -10, twist: 270 }]);
  }
  const copied = structuredClone(samples);
  copied[0].x = 99;
  expect(samples[0].x).toBe(1);
});

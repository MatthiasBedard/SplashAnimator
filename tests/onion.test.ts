import { symbolOnionFrames } from '../packages/animation/src/onion';
import { it, expect } from 'vitest';
import { newProject, clone, newLayer } from '../packages/document/src';
import { onionSamples } from '../packages/animation/src/onion';
const options = { before: 2, after: 2, opacity: 0.4, fade: true, keysOnly: false };
it('bounds onion samples and orders distant ghosts before nearby ones', () => {
  const p = newProject();
  p.duration = 5;
  const old = clone(p);
  expect(onionSamples(p, 2, options).map((s) => [s.frame, s.opacity])).toEqual([
    [0, 0.2],
    [1, 0.4],
    [4, 0.2],
    [3, 0.4],
  ]);
  expect(onionSamples(p, 0, options).map((s) => s.frame)).toEqual([2, 1]);
  expect(p).toEqual(old);
  expect(onionSamples(p, 2, { ...options, before: Infinity, after: -1 })).toEqual([]);
});
it('key exposure samples skip the current held exposure and respect layer visibility/scope', () => {
  const p = newProject();
  p.duration = 12;
  p.layers[0].keys = [
    { frame: 0, shapes: [] },
    { frame: 4, shapes: [] },
    { frame: 9, shapes: [] },
  ];
  const other = newLayer('other');
  other.keys.push({ frame: 6, shapes: [] });
  p.layers.push(other);
  expect(
    onionSamples(p, 7, { ...options, keysOnly: true, layerId: p.layers[0].id }).map((s) => s.frame),
  ).toEqual([0, 9]);
  expect(onionSamples(p, 7, { ...options, keysOnly: true }).map((s) => s.frame)).toEqual([0, 4, 9]);
  p.layers[0].visible = false;
  expect(onionSamples(p, 7, { ...options, layerId: p.layers[0].id })).toEqual([]);
});

it('samples symbol key exposures with bounded counts, layer scope and optional fade', () => {
  const d = {
    id: 'symbol',
    name: 'Symbol',
    width: 10,
    height: 10,
    shapes: [],
    timeline: {
      duration: 20,
      keys: [
        { frame: 5, shapes: [] },
        { frame: 15, shapes: [] },
      ],
      layers: [
        {
          id: 'extra',
          name: 'Extra',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [] },
            { frame: 10, shapes: [] },
          ],
        },
      ],
    },
  };
  const options = { before: 1, after: 1, opacity: 0.5, fade: true, keysOnly: true };
  expect(symbolOnionFrames(d, 7, options).map((s) => s.frame)).toEqual([0, 10]);
  expect(symbolOnionFrames(d, 7, { ...options, layerId: '@base' }).map((s) => s.frame)).toEqual([
    0, 15,
  ]);
  expect(symbolOnionFrames(d, 7, { ...options, layerId: 'extra' }).map((s) => s.frame)).toEqual([
    10,
  ]);
  expect(symbolOnionFrames(d, 7, { ...options, layerId: 'missing' })).toEqual([]);
  expect(symbolOnionFrames(d, 0, { ...options, keysOnly: false, before: 100, after: 2 })).toEqual([
    { frame: 2, opacity: 0.25 },
    { frame: 1, opacity: 0.5 },
  ]);
  expect(symbolOnionFrames(d, 19, { ...options, keysOnly: false, before: 2, fade: false })).toEqual(
    [
      { frame: 17, opacity: 0.5 },
      { frame: 18, opacity: 0.5 },
    ],
  );
});

it('bounds key-only onion lookup work on a ten-thousand-key symbol', () => {
  let reads = 0;
  const keys = Array.from({ length: 9999 }, (_, i) => ({
    get frame() {
      reads++;
      return i + 1;
    },
    shapes: [],
  }));
  const d = {
    id: 'dense',
    name: 'Dense',
    width: 10,
    height: 10,
    shapes: [],
    timeline: { duration: 10000, keys },
  };
  const options = { before: 2, after: 2, opacity: 0.5, fade: true, keysOnly: true };
  expect(symbolOnionFrames(d, 5000, options).map((s) => s.frame)).toEqual([4998, 4999, 5002, 5001]);
  expect(reads).toBeLessThan(500000);
  reads = 0;
  expect(symbolOnionFrames(d, 5000, { ...options, keysOnly: false }).map((s) => s.frame)).toEqual([
    4998, 4999, 5002, 5001,
  ]);
  expect(reads).toBe(0);
});

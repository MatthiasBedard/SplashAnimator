import { expect, it } from 'vitest';
import {
  createOpacityTrackSampler,
  type OpacityKey,
} from '../packages/animation/src/opacity-track';

it('uses absolute property key times, outgoing easing, exact keys and outside holds', () => {
  const sample = createOpacityTrackSampler(
    [
      { frame: 2, opacity: 0.25, ease: 'in' },
      { frame: 6, opacity: 1, ease: 'out' },
      { frame: 14, opacity: 0 },
      { frame: 16, opacity: 0.5 },
    ],
    20,
  );
  for (const [frame, value] of [
    [0, 0.25],
    [2, 0.25],
    [4, 0.4375],
    [6, 1],
    [10, 0.25],
    [14, 0],
    [15, 0.25],
    [16, 0.5],
    [19, 0.5],
    [4, 0.4375],
  ])
    expect(sample(frame)).toBe(value);
});

it('holds until the next exact key and supports single-key and adjacent-key tracks', () => {
  const single = createOpacityTrackSampler([{ frame: 3, opacity: Number.MIN_VALUE }], 8);
  for (let frame = 0; frame < 8; frame++) expect(single(frame)).toBe(Number.MIN_VALUE);
  const two = createOpacityTrackSampler(
    [
      { frame: 0, opacity: 1, ease: 'hold' },
      { frame: 5, opacity: 0 },
      { frame: 6, opacity: 1 },
    ],
    7,
  );
  expect(Array.from({ length: 7 }, (_, frame) => two(frame))).toEqual([1, 1, 1, 1, 1, 0, 1]);
});

it('detaches the complete validated curve and key sequence, including custom cubic control values', () => {
  const curve = { kind: 'cubic' as const, x1: 1 / 3, x2: 2 / 3, y1: 0, y2: 0 };
  const keys: OpacityKey[] = [
    { frame: 2, opacity: 0, ease: curve },
    { frame: 10, opacity: 1 },
  ];
  const sample = createOpacityTrackSampler(keys, 12);
  curve.y1 = 1;
  keys[1].frame = 3;
  keys[1].opacity = 0;
  keys.length = 0;
  expect(sample(6)).toBeCloseTo(0.125, 14);
  expect(sample(10)).toBe(1);
});

it('keeps long, uneven segments finite and bounded for degenerate cubic time tangents', () => {
  for (const x of [0, 1])
    for (const y of [0, 1]) {
      const sample = createOpacityTrackSampler(
        [
          { frame: 0, opacity: 1, ease: { kind: 'cubic', x1: x, x2: x, y1: y, y2: y } },
          { frame: 99998, opacity: Number.MIN_VALUE },
          { frame: 99999, opacity: 0.6 },
        ],
        100000,
      );
      expect(sample(99998)).toBe(Number.MIN_VALUE);
      expect(sample(99999)).toBe(0.6);
      for (const frame of [1, 50000, 99997]) {
        const value = sample(frame);
        expect(value).toBeGreaterThanOrEqual(Number.MIN_VALUE);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
});

it('rejects original malformed values, sparse sequences, duplicate times and invalid samples', () => {
  const key = { frame: 1, opacity: 0.5 };
  for (const keys of [
    [],
    Array(2),
    [key, , { frame: 3, opacity: 1 }],
    [null],
    [key, key],
    [key, { ...key, frame: 0 }],
    ...[-1, 4, 0.5, Infinity, NaN].map((frame) => [{ ...key, frame }]),
    ...[-1, 1.01, NaN, Infinity, null, '0.5'].map((opacity) => [{ ...key, opacity }]),
    ...[null, 'other', { kind: 'cubic', x1: NaN, y1: 0, x2: 1, y2: 1 }].map((ease) => [
      key,
      { ...key, frame: 3, ease },
    ]),
  ])
    expect(() => createOpacityTrackSampler(keys as OpacityKey[], 4)).toThrow();
  for (const duration of [0, 1.5, 100001, NaN])
    expect(() => createOpacityTrackSampler([key], duration)).toThrow();
  const sample = createOpacityTrackSampler([key], 4);
  for (const frame of [-1, 4, 0.5, NaN, Infinity]) expect(() => sample(frame)).toThrow();
  expect(sample(2)).toBe(0.5);
});

import { expect, it } from 'vitest';
import { clone, newProject, type Vector } from '../packages/document/src';
import { validateMotionCurveTangents } from '../packages/animation/src/motion-tangents';
import { generateMotionFrames } from '../packages/animation/src/motion-frames';
function curve(end = false): Vector {
  return {
    id: 'curve',
    kind: 'bezier',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 1,
    points: [],
    nodes: end
      ? [
          { x: 0, y: 0, out: { x: 1, y: -3 } },
          { x: -5, y: -9, in: { x: -6, y: -6 } },
        ]
      : [
          { x: 0, y: 0, out: { x: 1, y: 1 } },
          { x: 3, y: 3, in: { x: 2, y: 2 } },
        ],
  };
}
it('rejects an interior stationary tangent occurring between sampled frames', () => {
  const a = curve(),
    b = curve(true);
  // At progress 1/4 the derivative controls are (1,0),(-1,0),(1,0).
  // Their quadratic value at curve parameter 1/2 is exactly zero.
  expect(() => validateMotionCurveTangents(a, b)).toThrow(/stationary|unresolved/);
  for (const t of [0, 1 / 3, 2 / 3, 1]) {
    // The Y derivative is 1-4t everywhere: these sampled poses have no stationary tangent.
    expect(Math.abs(1 - 4 * t)).toBeGreaterThan(0);
  }
});
it('certifies curved nonstationary contours and ignores shared endpoint translation', () => {
  const a = curve();
  a.nodes! = [
    { x: 0, y: 0, out: { x: 1, y: 0 } },
    { x: 0, y: 1, in: { x: 1, y: 1 } },
  ];
  const b = clone(a);
  for (const p of b.nodes!) {
    p.x += 1e12;
    p.y -= 1e12;
    if (p.in) {
      p.in.x += 1e12;
      p.in.y -= 1e12;
    }
    if (p.out) {
      p.out.x += 1e12;
      p.out.y -= 1e12;
    }
  }
  const before = clone([a, b]);
  expect(() => validateMotionCurveTangents(a, b)).not.toThrow();
  expect([a, b]).toEqual(before);
});
it('rejects endpoint stations, malformed input and unresolved near-zero tangents', () => {
  for (const mode of ['handle', 'invalid', 'kind', 'near'] as const) {
    const a = curve();
    if (mode === 'handle') delete a.nodes![0].out;
    if (mode === 'invalid') a.nodes![0].out!.x = NaN;
    if (mode === 'kind') a.kind = 'polygon';
    if (mode === 'near') a.nodes![0].out = { x: 1e-16, y: 0 };
    expect(() => validateMotionCurveTangents(a, clone(a))).toThrow();
  }
});
it('preflights every track atomically and requires node interpolation', () => {
  const p = newProject();
  p.duration = 4;
  p.layers[0].keys = [
    { frame: 0, shapes: [curve()] },
    { frame: 3, shapes: [curve()] },
  ];
  const later = clone(p.layers[0]);
  later.id = 'later';
  later.keys[1].shapes = [curve(true)];
  p.layers.push(later);
  const before = clone(p);
  const generate = (nodes: boolean) =>
    generateMotionFrames(
      p,
      p.layers.map((l) => l.id),
      0,
      3,
      'linear',
      false,
      false,
      nodes,
      undefined,
      false,
      false,
      undefined,
      false,
      false,
      false,
      false,
      0,
      false,
      undefined,
      false,
      false,
      true,
    );
  expect(() => generate(false)).toThrow(/node interpolation/);
  expect(() => generate(true)).toThrow(/stationary|unresolved/);
  expect(p).toEqual(before);
  p.layers.pop();
  generate(true);
  expect(p.layers[0].keys).toHaveLength(4);
});

it('checks the closing segment without rejecting ordinary closed contour corners', () => {
  const a = curve();
  a.closed = true;
  a.nodes = [
    { x: 0, y: 0, in: { x: 0, y: 1 }, out: { x: 1, y: 0 } },
    { x: 3, y: 0, in: { x: 2, y: 0 }, out: { x: 2, y: 1 } },
    { x: 0, y: 3, in: { x: 1, y: 2 }, out: { x: 0, y: 2 } },
  ];
  expect(() => validateMotionCurveTangents(a, clone(a))).not.toThrow();
  delete a.nodes[2].out;
  expect(() => validateMotionCurveTangents(a, clone(a))).toThrow(/stationary|unresolved/);
});

it('rejects transient reversing joins while retaining ordinary corners', () => {
  const a = curve(),
    b = curve();
  a.nodes = [
    { x: -3, y: 0, out: { x: -2, y: 0 } },
    { x: 0, y: 0, in: { x: -1, y: 0 }, out: { x: -1, y: 1 } },
    { x: -3, y: 3, in: { x: -2, y: 2 } },
  ];
  b.nodes = [
    { x: -3, y: 0, out: { x: -2, y: 0 } },
    { x: 0, y: 0, in: { x: -1, y: 0 }, out: { x: -1, y: -4 } },
    { x: -3, y: -12, in: { x: -2, y: -8 } },
  ];
  // Each segment has a fixed-sign X derivative, but the join reverses at t=1/5.
  expect(() => validateMotionCurveTangents(a, a)).not.toThrow();
  expect(() => validateMotionCurveTangents(b, b)).not.toThrow();
  expect(() => validateMotionCurveTangents(a, b)).toThrow(/join tangents/);
  const sameDirection = clone(a);
  sameDirection.nodes![1].out = { x: 1, y: 0 };
  sameDirection.nodes![2] = { x: 3, y: 0, in: { x: 2, y: 0 } };
  expect(() => validateMotionCurveTangents(sameDirection, sameDirection)).not.toThrow();
});

it('certifies joins independently of the relative sizes of their neighboring segments', () => {
  for (const size of [1e-16, 1e-100, 1e100]) {
    const a = curve();
    a.nodes = [
      { x: -3 * size, y: 0, out: { x: -2 * size, y: 0 } },
      { x: 0, y: 0, in: { x: -size, y: 0 }, out: { x: 1, y: 0 } },
      { x: 3, y: 0, in: { x: 2, y: 0 } },
    ];
    // Both segments have strictly positive constant X derivatives, regardless of size.
    expect(() => validateMotionCurveTangents(a, a)).not.toThrow();
    const b = clone(a);
    b.nodes![1].out = { x: -1, y: 1 };
    b.nodes![2] = { x: -3, y: 3, in: { x: -2, y: 2 } };
    const c = clone(b);
    c.nodes![1].out = { x: -1, y: -4 };
    c.nodes![2] = { x: -3, y: -12, in: { x: -2, y: -8 } };
    // Rescaling incoming speed must not hide the analytic reversal at t=1/5.
    expect(() => validateMotionCurveTangents(b, b)).not.toThrow();
    expect(() => validateMotionCurveTangents(b, c)).toThrow(/join tangents/);
  }
});

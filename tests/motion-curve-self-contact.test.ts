import { expect, it } from 'vitest';
import { clone, newProject, type Vector } from '../packages/document/src';
import { validateMotionCurveSelfContacts } from '../packages/animation/src/motion-curve-self-contact';
import { generateMotionFrames } from '../packages/animation/src/motion-frames';
function curve(cy = 0): Vector {
  // C(u)=(u³-1.5u²+11u/16, u²+cy*u).
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
    nodes: [
      { x: 0, y: 0, out: { x: 11 / 48, y: cy / 3 } },
      { x: 3 / 16, y: 1 + cy, in: { x: -1 / 24, y: 1 / 3 + (2 * cy) / 3 } },
    ],
  };
}
it('rejects self-contact that appears only between authored endpoint curves', () => {
  const a = curve(0),
    b = curve(-2);
  expect(() => validateMotionCurveSelfContacts(a, a)).not.toThrow();
  expect(() => validateMotionCurveSelfContacts(b, b)).not.toThrow();
  // At t=1/2, C(1/4)=C(3/4)=(3/32,-3/16). Tangents are nonzero.
  const at = (u: number) => [u ** 3 - 1.5 * u * u + (11 * u) / 16, u * u - u];
  expect(at(1 / 4)).toEqual(at(3 / 4));
  const before = clone([a, b]);
  expect(() => validateMotionCurveSelfContacts(a, b)).toThrow(/self-contact/);
  expect([a, b]).toEqual(before);
});
it('certifies monotone curved geometry across translation and rejects stations', () => {
  const a = curve();
  a.nodes = [
    { x: 0, y: 0, out: { x: 1, y: 2 } },
    { x: 3, y: 0, in: { x: 2, y: -2 } },
  ];
  const b = clone(a);
  for (const p of b.nodes!)
    for (const q of [p, p.in, p.out])
      if (q) {
        q.x += 1e12;
        q.y -= 1e12;
      }
  expect(() => validateMotionCurveSelfContacts(a, b)).not.toThrow();
  delete a.nodes[0].out;
  expect(() => validateMotionCurveSelfContacts(a, a)).toThrow(/stationary/);
});
it('requires node interpolation and rejects a later track atomically', () => {
  const p = newProject();
  p.duration = 4;
  p.layers[0].keys = [
    { frame: 0, shapes: [curve()] },
    { frame: 3, shapes: [curve()] },
  ];
  const run = (nodes = true) =>
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
      false,
      true,
    );
  expect(() => run(false)).toThrow(/node interpolation/);
  const original = clone(p);
  run();
  expect(p.layers[0].keys).toHaveLength(4);
  p.layers = clone(original.layers);
  const bad = clone(p.layers[0]);
  bad.id = 'bad';
  bad.keys[1].shapes = [curve(-2)];
  p.layers.push(bad);
  const before = clone(p);
  expect(() => run()).toThrow(/self-contact/);
  expect(p).toEqual(before);
});

import { expect, it } from 'vitest';
import { newProject, clone, type Vector } from '../packages/document/src';
import { validateMotionContourContacts } from '../packages/animation/src/motion-contact';
import { generateMotionFrames } from '../packages/animation/src/motion-frames';
function shape(nodes: { x: number; y: number }[]): Vector {
  return {
    id: 'a',
    kind: 'bezier',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 1,
    points: [],
    nodes,
  };
}
it('rejects brief between-frame crossings and collinear contact intervals', () => {
  for (const collinear of [false, true]) {
    const a = shape(
      collinear
        ? [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
          ]
        : [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: -1 },
            { x: 20, y: 1 },
          ],
    );
    const b = clone(a);
    b.nodes![2].x = collinear ? -10 : -100;
    b.nodes![3].x = collinear ? -9 : -100;
    const before = clone([a, b]);
    expect(() => validateMotionContourContacts(a, b)).toThrow(
      collinear ? /retrace|touch or cross/ : /touch or cross/,
    );
    expect([a, b]).toEqual(before);
  }
});
it('allows separated moving edges and adjacent closed seams', () => {
  const a = shape([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]),
    b = clone(a);
  b.nodes!.forEach((p) => {
    p.x += 30;
    p.y += 20;
  });
  for (const closed of [false, true]) {
    a.closed = b.closed = closed;
    expect(() => validateMotionContourContacts(a, b)).not.toThrow();
  }
});
it('checks contact between contours of one artwork and rejects invalid controls', () => {
  const a = shape([]);
  a.kind = 'polygon';
  delete a.nodes;
  a.contours = [
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ],
    [
      { x: 5, y: 0 },
      { x: 7, y: 0 },
      { x: 5, y: 2 },
    ],
  ];
  const b = clone(a);
  b.contours![1].forEach((p) => (p.x -= 20));
  expect(() => validateMotionContourContacts(a, b)).toThrow(/touch or cross/);
  const curve = shape([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ]);
  curve.nodes![0].out = { x: NaN, y: 2 };
  expect(() => validateMotionContourContacts(curve, curve)).toThrow(/finite/);
});
it('rejects budget exhaustion explicitly without silently omitting pairs', () => {
  const a = shape(Array.from({ length: 635 }, (_, i) => ({ x: i, y: i % 2 })));
  expect(() => validateMotionContourContacts(a, a)).toThrow(/work budget/);
});
it('prepares all tracks before contact rejection and preserves exact safe keys', () => {
  const p = newProject();
  p.duration = 5;
  const a = shape([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]),
    b = clone(a);
  b.nodes!.forEach((p) => (p.x += 20));
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 4, shapes: [b] },
  ];
  const original = clone(p),
    run = (p: typeof original) =>
      generateMotionFrames(
        p,
        p.layers.map((l) => l.id),
        0,
        4,
        'linear',
        false,
        false,
        true,
        undefined,
        false,
        false,
        undefined,
        false,
        false,
        false,
        'contacts',
      );
  run(p);
  expect(p.layers[0].keys[0]).toEqual(original.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(original.layers[0].keys[1]);
  const bad = clone(original);
  bad.layers.push({ ...clone(bad.layers[0]), id: 'bad' });
  bad.layers[1].keys[0].shapes[0].nodes = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: -1 },
    { x: 20, y: 1 },
  ];
  bad.layers[1].keys[1].shapes[0].nodes = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: -100, y: -1 },
    { x: -100, y: 1 },
  ];
  const before = clone(bad);
  expect(() => run(bad)).toThrow(/touch or cross/);
  expect(bad).toEqual(before);
});

it('rejects a fleeting adjacent fold while retaining straight-through joins', () => {
  const a = shape([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 1 },
    ]),
    b = shape([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: -80, y: -4 },
    ]);
  // At t=1/5 the third point is (0,0); neither segment collapses, but both cover [0,10].
  expect(() => validateMotionContourContacts(a, b)).toThrow(/Adjacent.*retrace/);
  const straight = shape([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ]);
  expect(() => validateMotionContourContacts(straight, straight)).not.toThrow();
  const end = clone(straight);
  end.nodes!.forEach((p) => (p.x += 100));
  expect(() => validateMotionContourContacts(straight, end)).not.toThrow();
});
it('rejects closed contours with overlapping seam edges and preserves original endpoints', () => {
  const a = shape([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 5, y: 0 },
  ]);
  a.closed = true;
  const before = clone(a);
  expect(() => validateMotionContourContacts(a, a)).toThrow(/retrace|touch or cross/);
  expect(a).toEqual(before);
  const safe = shape([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: -5, y: 0 },
  ]);
  safe.closed = true;
  expect(() => validateMotionContourContacts(safe, safe)).not.toThrow();
});

it('does not interpret shared large translation as adjacent retracing', () => {
  const a = shape([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ]),
    b = clone(a);
  b.nodes!.forEach((p) => {
    p.x += 1e12;
    p.y -= 1e12;
  });
  expect(() => validateMotionContourContacts(a, b)).not.toThrow();
  const p = newProject();
  p.duration = 5;
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 4, shapes: [b] },
  ];
  const before = clone(p);
  generateMotionFrames(
    p,
    [p.layers[0].id],
    0,
    4,
    'linear',
    false,
    false,
    true,
    undefined,
    false,
    false,
    undefined,
    false,
    false,
    false,
    'contacts',
  );
  expect(p.layers[0].keys[0]).toEqual(before.layers[0].keys[0]);
  expect(p.layers[0].keys[4]).toEqual(before.layers[0].keys[1]);
});

it('retains true transient contact detection under shared translation', () => {
  for (const shift of [0, 1e9, 1e12]) {
    const a = shape([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 1 },
      ]),
      b = shape([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: -80, y: -4 },
      ]);
    b.nodes!.forEach((p) => {
      p.x += shift;
      p.y -= shift;
    });
    expect(() => validateMotionContourContacts(a, b)).toThrow(/retrace/);
    const safe = shape([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
      end = clone(safe);
    end.nodes!.forEach((p) => {
      p.x += shift;
      p.y -= shift;
    });
    expect(() => validateMotionContourContacts(safe, end)).not.toThrow();
  }
});

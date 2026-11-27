import { describe, expect, it } from 'vitest';
import { newProject, validateProject, type Layer, type Vector } from '../packages/document/src';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { prepareTwoBoneKey, prepareTwoBoneSpan } from '../packages/geometry/src/two-bone-ik';
import { loadProject, saveProject, type DirectoryStore } from '../packages/document/src/storage';

function line(id: string, x: number, y: number, length: number, reverse = false): Vector {
  const points = [{ x: 0, y: 0 }, { x: length, y: 0 }];
  return { id, kind: 'line', x, y, width: length, height: 0, rotation: 0,
    fill: '#000000', fillEnabled: false, stroke: '#ff0000', strokeWidth: 6,
    points: reverse ? points.reverse() : points, drawingMode: 'object' };
}

function source() {
  const p = newProject();
  p.duration = 5;
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [
    line('upper', 30, 30, 40, true), line('lower', 70, 30, 30, true),
    line('unrelated', 10, 90, 10),
  ];
  return p;
}

const ids = ['upper', 'lower'];
const binding = { kind: 'bind', rigId: 'rig-1' } as const;
const world = (s: Vector, tip = false) => mapPoint(matrix(s), s.points[tip ? 1 - s.bone!.start : s.bone!.start]);
function posed(layer: Layer, x: number, y: number, bend: 1 | -1 = 1) {
  return prepareTwoBoneKey(layer, 2, [...ids].reverse(), { kind: 'pose', target: { x, y }, bend });
}

describe('two-bone authored exposures', () => {
  it('binds reversed local points and leaves unrelated artwork and source untouched', () => {
    const p = source(), before = structuredClone(p);
    p.layers[0] = prepareTwoBoneKey(p.layers[0], 0, ids, binding);
    const [a, b, c] = p.layers[0].keys[0].shapes;
    expect(a.bone).toEqual({ rigId: 'rig-1', role: 'upper', start: 1, length: 40 });
    expect(b.bone).toEqual({ rigId: 'rig-1', role: 'lower', start: 1, length: 30 });
    expect(c).toEqual(before.layers[0].keys[0].shapes[2]);
    expect(world(a, true)).toEqual(world(b));
    expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const removed = prepareTwoBoneKey(p.layers[0], 0, ids, { kind: 'remove' });
    expect(removed).toEqual(before.layers[0]);
  });

  it.each([
    { x: 70, y: 60, tip: [70, 60], bend: 1, joint: [41.2, 68.4] },
    { x: 70, y: 60, tip: [70, 60], bend: -1, joint: [70, 30] },
    { x: 230, y: 30, tip: [100, 30], bend: 1, joint: [70, 30] },
    { x: 33, y: 30, tip: [40, 30], bend: 1, joint: [70, 30] },
  ] as const)('poses $x,$y with bend $bend', ({ x, y, tip, bend, joint }) => {
    const initial = source().layers[0];
    const bound = prepareTwoBoneKey(initial, 0, ids, binding);
    const next = posed(bound, x, y, bend);
    const [a, b, c] = next.keys.at(-1)!.shapes;
    expect(world(a).x).toBeCloseTo(30, 10);
    expect(world(a).y).toBeCloseTo(30, 10);
    expect(world(a, true).x).toBeCloseTo(joint[0], 7);
    expect(world(a, true).y).toBeCloseTo(joint[1], 7);
    expect(world(b).x).toBeCloseTo(joint[0], 7);
    expect(world(b).y).toBeCloseTo(joint[1], 7);
    expect(world(b, true).x).toBeCloseTo(tip[0], 7);
    expect(world(b, true).y).toBeCloseTo(tip[1], 7);
    expect(a.points).toEqual(initial.keys[0].shapes[0].points);
    expect(b.stroke).toBe('#ff0000');
    expect(c).toBe(initial.keys[0].shapes[2]);
    expect(next.keys[0]).toBe(bound.keys[0]);
    expect(next.keys.map(k => k.frame)).toEqual(x === 230 ? [0] : [0, 2]);
  });

  it('folds equal segments at their root and rejects invalid authoring without mutation', () => {
    const layer = source().layers[0];
    layer.keys[0].shapes[1] = line('lower', 70, 30, 40);
    const bound = prepareTwoBoneKey(layer, 0, ids, binding);
    const folded = posed(bound, 30, 30);
    expect(world(folded.keys[1].shapes[1], true)).toEqual({ x: 30, y: 30 });
    const before = structuredClone(bound);
    expect(() => posed(bound, Infinity, 30)).toThrow('finite');
    expect(() => posed(bound, '70' as unknown as number, 30)).toThrow('finite');
    expect(() => posed({ ...bound, locked: true }, 30, 30)).toThrow('unlocked');
    expect(() => prepareTwoBoneKey(layer, 0, ['upper', 'unrelated'], binding)).toThrow('share exactly one');
    expect(() => prepareTwoBoneKey({ ...layer, drawingMode: 'merge' }, 0, ids, binding)).toThrow('object layer');
    expect(() => prepareTwoBoneKey({ ...layer, keys: [{ ...layer.keys[0], openMotionTween: { affine: false, ease: 'linear' } }] }, 2, ids, binding)).toThrow('ordinary exposure');
    expect(bound).toEqual(before);
  });

  it('rejects malformed bindings before saving or posing', () => {
    const p = source();
    p.layers[0] = prepareTwoBoneKey(p.layers[0], 0, ids, binding);
    Object.defineProperty(p.layers[0].keys[0].shapes[0].bone!, 'length', {
      enumerable: true, get() { throw Error('Getter should not run'); },
    });
    expect(() => validateProject(p)).toThrow('Invalid bone binding');
    expect(() => posed(p.layers[0], 70, 60)).toThrow('Invalid bone binding');
  });

  it('persists the bound and posed keys through the directory document format', async () => {
    const p = withArtwork();
    p.layers[0] = posed(prepareTwoBoneKey(p.layers[0], 0, ['lower', 'art'], { kind: 'attach' }), 70, 60);
    const files = new Map<string, string>();
    const store: DirectoryStore = {
      exists: async path => files.has(path),
      read: async path => {
        const file = files.get(path);
        if (file === undefined) throw Error('Missing directory entry.');
        return file;
      },
      writeNew: async (path, contents) => { files.set(path, contents); },
      commit: async (path, contents) => { files.set(path, contents); },
    };
    await saveProject(store, p, null);
    const reopened = (await loadProject(store)).project;
    expect(reopened).toEqual(p);
    expect(posed(reopened.layers[0], 230, 30).keys[1].shapes[1].bone?.rigId).toBe('rig-1');
    expect(reopened.layers[0].keys[1].shapes[2].boneAttachment?.boneId).toBe('lower');
  });
});

function spanSource(end: { x: number; y: number }, start?: { x: number; y: number }, bend: 1 | -1 = 1) {
  const sourceLayer = source().layers[0];
  sourceLayer.keys[0].shapes.splice(2);
  let bound = prepareTwoBoneKey(sourceLayer, 0, ids, binding);
  if (start) bound = prepareTwoBoneKey(bound, 0, ids, { kind: 'pose', target: start, bend: 1 });
  return prepareTwoBoneKey(bound, 4, ids, { kind: 'pose', target: end, bend });
}

function checkGeneratedKey(layer: Layer, frame: number, x: number, y: number) {
  const [a, b] = layer.keys.find(key => key.frame === frame)!.shapes;
  const root = world(a), joint = world(a, true), leg = world(b), tip = world(b, true);
  expect(root.x).toBeCloseTo(30, 10);
  expect(root.y).toBeCloseTo(30, 10);
  expect(joint.x).toBeCloseTo(leg.x, 10);
  expect(joint.y).toBeCloseTo(leg.y, 10);
  expect(Math.hypot(joint.x - root.x, joint.y - root.y)).toBeCloseTo(40, 10);
  expect(Math.hypot(tip.x - leg.x, tip.y - leg.y)).toBeCloseTo(30, 10);
  expect(tip.x).toBeCloseTo(x, 10);
  expect(tip.y).toBeCloseTo(y, 10);
}

describe('in-between bone poses', () => {
  it('solves intermediate tip positions and preserves original keys, selection and binding', () => {
    const original = spanSource({ x: 70, y: 60 });
    original.keys.push({ frame: 6, shapes: [line('later', 10, 90, 10)] });
    const snapshot = structuredClone(original);
    const result = prepareTwoBoneSpan(original, 0, 4, 7, [...ids].reverse());
    expect(result.keys.map(key => key.frame)).toEqual([0, 1, 2, 3, 4, 6]);
    expect(result.keys[0]).toBe(original.keys[0]);
    expect(result.keys[4]).toBe(original.keys[1]);
    expect(result.keys[5]).toBe(original.keys[2]);
    checkGeneratedKey(result, 1, 92.5, 37.5);
    checkGeneratedKey(result, 2, 85, 45);
    checkGeneratedKey(result, 3, 77.5, 52.5);
    expect(result.keys[2].shapes[0].bone).toEqual(original.keys[0].shapes[0].bone);
    expect(result.keys[1].shapes[0].points).not.toBe(result.keys[2].shapes[0].points);
    expect(result.keys[1].shapes[1].points).not.toBe(original.keys[0].shapes[1].points);
    expect(original).toEqual(snapshot);
  });

  it('clamps an interior target inside the near reach without shortening either segment', () => {
    const offset = Math.sqrt(50);
    const original = spanSource({ x: 30 + offset, y: 30 + offset }, { x: 30 + offset, y: 30 - offset });
    checkGeneratedKey(prepareTwoBoneSpan(original, 0, 4, 5, ids), 2, 40, 30);
  });

  it('preserves an occupied range and rejects changed endpoints or missing bounds', () => {
    const layer = spanSource({ x: 70, y: 60 }), before = structuredClone(layer);
    const run = (candidate: Layer, start = 0, end = 4) => prepareTwoBoneSpan(candidate, start, end, 5, ids);
    expect(() => run(layer, 1)).toThrow('ordinary authored keys');
    expect(() => run(layer, 0, 5)).toThrow('at least one frame');
    expect(() => prepareTwoBoneSpan(layer, 0, 4, Number.MAX_SAFE_INTEGER, ids)).toThrow('at least one frame');
    expect(() => run({ ...layer, keys: [layer.keys[0], { frame: 2, shapes: [] }, layer.keys[1]] }))
      .toThrow('Remove intermediate keys');
    expect(() => run({ ...layer, liveMotionSpans: [{ id: 'occupied', start: 2, end: 3, ease: 'linear' }] }))
      .toThrow('outside a tween');
    const moved = structuredClone(layer);
    moved.keys[1].shapes.forEach(shape => { shape.x += 10; });
    expect(() => run(moved)).toThrow('same root position');
    const restyled = structuredClone(layer);
    restyled.keys[1].shapes[0].stroke = '#00ff00';
    expect(() => run(restyled)).toThrow('local geometry and paint');
    restyled.keys[1].shapes.push(line('unrelated', 50, 90, 17));
    expect(() => run(restyled)).toThrow('only the two selected bones');
    const accessor = structuredClone(layer);
    Object.defineProperty(accessor.keys[1].shapes[0], 'bone', {
      enumerable: true, get() { throw Error('Getter should not run'); },
    });
    expect(() => run(accessor)).toThrow('Invalid bone binding');
    expect(layer).toEqual(before);
  });

  it('rejects a root crossing and incompatible elbow branches before creating keys', () => {
    const crossing = spanSource({ x: -40, y: 30 });
    expect(() => prepareTwoBoneSpan(crossing, 0, 4, 5, ids)).toThrow('crosses the root');
    const different = spanSource({ x: 70, y: 60 }, { x: 80, y: 50 }, -1);
    expect(() => prepareTwoBoneSpan(different, 0, 4, 5, ids)).toThrow('different elbow sides');
  });
});

function withArtwork() {
  const p = source();
  const layer = p.layers[0];
  layer.keys[0].shapes[2] = {
    id: 'art', kind: 'rectangle', x: 78, y: 18, width: 10, height: 10, rotation: 0,
    fill: '#008000', stroke: '#000000', strokeWidth: 0, points: [], drawingMode: 'object',
  };
  p.layers[0] = prepareTwoBoneKey(layer, 0, ids, binding);
  return p;
}

describe('rigid editable bone artwork', () => {
  it('keeps bind placement and moves the artwork through posing, generation and detaching', () => {
    const p = withArtwork();
    const original = p.layers[0], rest = original.keys[0].shapes[2], before = structuredClone(original);
    const bound = prepareTwoBoneKey(original, 0, ['lower', 'art'], { kind: 'attach' });
    const attached = bound.keys[0].shapes[2];
    expect(matrix(attached)).toEqual(matrix(rest));
    expect(attached.boneAttachment).toEqual({ rigId: 'rig-1', boneId: 'lower', local: [1, 0, 0, 1, 8, -12] });
    const posed = prepareTwoBoneKey(bound, 4, ids, { kind: 'pose', target: { x: 70, y: 60 }, bend: 1 });
    const result = posed.keys[1].shapes[2];
    expect(result.x).toBeCloseTo(45.52, 8);
    expect(result.y).toBeCloseTo(54.64, 8);
    expect(result.transform).toEqual([0.96, -0.28, 0.28, 0.96].map(value => expect.closeTo(value, 10)));
    expect(result.fill).toBe('#008000');
    expect(result.boneAttachment).toEqual(attached.boneAttachment);
    const generated = prepareTwoBoneSpan(posed, 0, 4, 5, ids);
    checkGeneratedKey(generated, 2, 85, 45);
    const [,, mid] = generated.keys[2].shapes;
    const lower = generated.keys[2].shapes[1];
    const root = world(lower), tip = world(lower, true);
    const c = (tip.x - root.x) / 30, s = (tip.y - root.y) / 30;
    expect(mid.x).toBeCloseTo(root.x + 8 * c + 12 * s, 10);
    expect(mid.y).toBeCloseTo(root.y + 8 * s - 12 * c, 10);
    expect(matrix(mid).slice(0, 4)).toEqual([c, s, -s, c].map(value => expect.closeTo(value, 10)));
    expect(mid.boneAttachment).toEqual(result.boneAttachment);
    expect(generated.keys[0]).toBe(posed.keys[0]);
    expect(generated.keys[4]).toBe(posed.keys[1]);
    const detached = prepareTwoBoneKey(generated, 2, ['art'], { kind: 'detach' });
    expect(matrix(detached.keys[2].shapes[2])).toEqual(matrix(mid));
    expect(detached.keys[2].shapes[2].boneAttachment).toBeUndefined();
    const unbound = prepareTwoBoneKey(generated, 4, ids, { kind: 'remove' });
    expect(unbound.keys[4].shapes.every(shape => !shape.bone && !shape.boneAttachment)).toBe(true);
    expect(matrix(unbound.keys[4].shapes[2])).toEqual(matrix(result));
    expect(original).toEqual(before);
    p.layers[0] = generated;
    expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('rejects stale relations, incompatible endpoint art and malformed attachment data', () => {
    const p = withArtwork(), original = p.layers[0], before = structuredClone(original);
    const bound = prepareTwoBoneKey(p.layers[0], 0, ['upper', 'art'], { kind: 'attach' });
    expect(() => prepareTwoBoneKey(bound, 0, ['lower', 'art'], { kind: 'attach' })).toThrow('Detach the artwork');
    const poses = prepareTwoBoneKey(bound, 4, ids, { kind: 'pose', target: { x: 70, y: 60 }, bend: 1 });
    const changed = structuredClone(poses);
    changed.keys[1].shapes[2].x += 2;
    expect(() => prepareTwoBoneSpan(changed, 0, 4, 5, ids)).toThrow('changed position');
    expect(() => prepareTwoBoneKey(changed, 4, ids, { kind: 'pose', target: { x: 60, y: 60 }, bend: 1 }))
      .toThrow('changed position');
    const removed = prepareTwoBoneKey(poses, 4, ['art'], { kind: 'detach' });
    expect(() => prepareTwoBoneSpan(removed, 0, 4, 5, ids)).toThrow('only the two selected bones');
    const invalidBasis = structuredClone(bound);
    invalidBasis.keys[0].shapes[2].boneAttachment!.local[3] = 0;
    expect(() => validateProject({ ...p, layers: [invalidBasis] })).toThrow('Invalid bone attachment basis');
    p.layers[0] = structuredClone(bound);
    Object.defineProperty(p.layers[0].keys[0].shapes[2].boneAttachment!.local, '0', {
      enumerable: true, get() { throw Error('Getter should not run'); },
    });
    expect(() => validateProject(p)).toThrow('Invalid bone attachment');
    expect(() => prepareTwoBoneKey(p.layers[0], 2, ids, { kind: 'pose', target: { x: 60, y: 60 }, bend: 1 }))
      .toThrow('Invalid bone attachment');
    expect(original).toEqual(before);
  });
});

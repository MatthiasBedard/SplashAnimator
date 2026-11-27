import { expect, it } from 'vitest';
import { newProject, clone } from '../packages/document/src';
import {
  pickMultiFrameGroup,
  multiFrameKeys,
  multiFrameId,
  translateMultiFrames,
} from '../packages/animation/src/multi-frame';
function fixture() {
  const p = newProject();
  p.duration = 8;
  const shape = {
    id: 'same',
    kind: 'rectangle' as const,
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    rotation: 20,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    groups: ['g'],
    transform: [1, 0.2, 0.3, 1] as [number, number, number, number],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [shape] },
    { frame: 3, shapes: [{ ...clone(shape), x: 50 }] },
    { frame: 6, shapes: [{ ...clone(shape), x: 90 }] },
  ];
  return p;
}
it('moves each intersecting key once, including the starting hold, preserving timing and affine artwork', () => {
  const p = fixture(),
    before = clone(p);
  const moved = translateMultiFrames(p, [p.layers[0].id], 1, 4, 5, -7);
  expect(moved.layers[0].keys.map((k) => k.shapes[0].x)).toEqual([15, 55, 90]);
  expect(moved.layers[0].keys.map((k) => k.frame)).toEqual([0, 3, 6]);
  expect(moved.layers[0].keys[0].shapes[0]).toEqual({
    ...before.layers[0].keys[0].shapes[0],
    x: 15,
    y: 13,
  });
  expect(p).toEqual(before);
});
it('rejects locked or missing tracks and invalid offsets atomically', () => {
  const p = fixture();
  const other = clone(p.layers[0]);
  other.id = 'other';
  other.locked = true;
  p.layers.push(other);
  const before = clone(p);
  expect(() => translateMultiFrames(p, [p.layers[0].id, 'other'], 0, 4, 5, 6)).toThrow('unlocked');
  expect(() => translateMultiFrames(p, ['missing'], 0, 4, 5, 6)).toThrow('present');
  expect(() => translateMultiFrames(p, [p.layers[0].id], 0, 4, NaN, 6)).toThrow('finite');
  expect(p).toEqual(before);
});

it('moves multiple tracks together and rejects an oversized scope without editing', () => {
  const p = fixture();
  const second = clone(p.layers[0]);
  second.id = 'second';
  p.layers.push(second);
  const moved = translateMultiFrames(
    p,
    p.layers.map((l) => l.id),
    1,
    4,
    3,
    4,
  );
  expect(moved.layers.map((l) => l.keys.map((k) => k.shapes[0].x))).toEqual([
    [13, 53, 90],
    [13, 53, 90],
  ]);
  p.duration = 129;
  p.layers[0].keys = Array.from({ length: 129 }, (_, frame) => ({ frame, shapes: [] }));
  const before = clone(p);
  expect(() => translateMultiFrames(p, [p.layers[0].id], 0, 128, 1, 1)).toThrow('128 exposures');
  expect(p).toEqual(before);
});

it('scopes picked IDs by layer and key and expands groups without selecting matching IDs in other frames', async () => {
  const { multiFrameId, transformMultiFrames } =
    await import('../packages/animation/src/multi-frame');
  const { around, matrix, mapPoint } = await import('../packages/geometry/src/affine');
  const p = fixture();
  p.layers[0].keys[0].shapes.push({
    ...clone(p.layers[0].keys[0].shapes[0]),
    id: 'sibling',
    x: 25,
  });
  const selected = [multiFrameId(p.layers[0].id, 0, 'same')];
  const moved = translateMultiFrames(p, [p.layers[0].id], 0, 4, 5, 6, selected);
  expect(moved.layers[0].keys[0].shapes.map((s) => s.x)).toEqual([15, 30]);
  expect(moved.layers[0].keys[1]).toEqual(p.layers[0].keys[1]);
  const op = around({ x: 10, y: 20 }, 0, 2, -2, 0);
  const result = transformMultiFrames(p, [p.layers[0].id], 0, 4, op, selected);
  for (let i = 0; i < 2; i++) {
    const point = { x: 12, y: 8 };
    const expected = mapPoint(op, mapPoint(matrix(p.layers[0].keys[0].shapes[i]), point));
    const actual = mapPoint(matrix(result.layers[0].keys[0].shapes[i]), point);
    expect(actual.x).toBeCloseTo(expected.x);
    expect(actual.y).toBeCloseTo(expected.y);
  }
  expect(result.layers[0].keys[1]).toEqual(p.layers[0].keys[1]);
  expect(() =>
    transformMultiFrames(p, [p.layers[0].id], 0, 4, [0, 0, 0, 0, 0, 0], selected),
  ).toThrow('nonsingular');
  expect(() => translateMultiFrames(p, [p.layers[0].id], 0, 4, 1, 1, ['stale'])).toThrow('stale');
  expect(translateMultiFrames(p, [p.layers[0].id], 0, 4, 1, 1, [])).toEqual(p);
});

it('selects regions with scoped set operations and deletes complete groups without removing key timing', async () => {
  const { selectMultiFrames, deleteMultiFrames, multiFrameId } =
    await import('../packages/animation/src/multi-frame');
  const p = fixture();
  p.layers[0].keys[0].shapes[0].rotation = 0;
  p.layers[0].keys[0].shapes[0].transform = undefined;
  p.layers[0].keys[0].shapes.push({
    ...clone(p.layers[0].keys[0].shapes[0]),
    id: 'sibling',
    x: 200,
  });
  const ring = [
    { x: 0, y: 0 },
    { x: 45, y: 0 },
    { x: 45, y: 65 },
    { x: 0, y: 65 },
  ];
  const args: [typeof p, string[], number, number] = [p, [p.layers[0].id], 0, 4];
  const picked = selectMultiFrames(...args, ring, [], 'replace');
  expect(picked).toEqual([
    multiFrameId(p.layers[0].id, 0, 'same'),
    multiFrameId(p.layers[0].id, 0, 'sibling'),
  ]);
  expect(selectMultiFrames(...args, ring, picked, 'subtract')).toEqual([]);
  expect(selectMultiFrames(...args, ring, null, 'intersect')).toEqual(picked);
  expect(selectMultiFrames(...args, ring, [], 'add')).toEqual(picked);
  const deleted = deleteMultiFrames(...args, [picked[0]]);
  expect(deleted.layers[0].keys[0].shapes).toEqual([]);
  expect(deleted.layers[0].keys.slice(1)).toEqual(p.layers[0].keys.slice(1));
  expect(deleted.layers[0].keys.map((k) => k.frame)).toEqual([0, 3, 6]);
  expect(p.layers[0].keys[0].shapes).toHaveLength(2);
  expect(() => deleteMultiFrames(...args, ['missing'])).toThrow('stale');
  expect(() => selectMultiFrames(...args, Array(1025).fill({ x: 0, y: 0 }), [], 'replace')).toThrow(
    '1,024',
  );
});

it('cycles overlapping exposure groups in stack order regardless of scope order without mutating artwork', () => {
  const p = fixture();
  const layer = p.layers[0];
  layer.keys[0].shapes.push({ ...clone(layer.keys[0].shapes[0]), id: 'sibling' });
  const second = clone(layer);
  second.id = 'second';
  p.layers.push(second);
  const before = clone(p);
  const tracks = multiFrameKeys(p, [second.id, layer.id], 1, 4);
  const expected = [
    [multiFrameId(second.id, 3, 'same')],
    [multiFrameId(second.id, 0, 'same'), multiFrameId(second.id, 0, 'sibling')],
    [multiFrameId(layer.id, 3, 'same')],
    [multiFrameId(layer.id, 0, 'same'), multiFrameId(layer.id, 0, 'sibling')],
  ];
  let selected: string[] | null = null;
  for (const ids of [...expected, expected[0]]) {
    selected = pickMultiFrameGroup(tracks, () => true, selected, true);
    expect(selected).toEqual(ids);
  }
  expect(pickMultiFrameGroup(tracks, () => false, selected, true)).toEqual([]);
  expect(pickMultiFrameGroup(tracks, () => true, expected[2])).toEqual(expected[0]);
  expect(pickMultiFrameGroup(tracks, () => true, ['stale'], true)).toEqual(expected[0]);
  expect(p).toEqual(before);
});

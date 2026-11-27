import { expect, it } from 'vitest';
import { newProject, newLayer, type Project } from '../packages/document/src';
import { prepareLayerReorder } from '../packages/animation/src/layers';
function fixture() {
  const p = newProject();
  p.duration = 10;
  p.layers = ['a', 'b', 'c'].map((name) => ({
    ...newLayer(name),
    id: name,
    keys: [
      { frame: 0, shapes: [] },
      { frame: 6, shapes: [] },
    ],
  }));
  return p;
}
const order = (p: Project) => p.layers.map((l) => l.id);
it('prepares both visual directions with exact layer/key records and unchanged source', () => {
  const p = fixture();
  p.layers[0].drawingMode = undefined;
  const before = structuredClone(p);
  const up = prepareLayerReorder(p, 'a', 'c', 'above');
  expect(order(up)).toEqual(['b', 'c', 'a']);
  expect(up.layers[2]).toStrictEqual(p.layers[0]);
  expect(Object.hasOwn(up.layers[2], 'drawingMode')).toBe(true);
  expect(up.layers[2].keys).toStrictEqual(p.layers[0].keys);
  const down = prepareLayerReorder(p, 'c', 'a', 'below');
  expect(order(down)).toEqual(['c', 'a', 'b']);
  expect(p).toEqual(before);
});
it('returns an exact no-op for self and already adjacent drops', () => {
  const p = fixture();
  expect(prepareLayerReorder(p, 'a', 'a', 'above')).toBe(p);
  expect(prepareLayerReorder(p, 'a', 'b', 'below')).toBe(p);
});
it('moves the source to the destination folder without changing other layers or original paint', () => {
  const p = fixture();
  p.folders = [{ id: 'art', name: 'Art' }];
  p.layers[1].folderId = 'art';
  const before = structuredClone(p);
  const next = prepareLayerReorder(p, 'a', 'b', 'above');
  expect(order(next)).toEqual(['b', 'a', 'c']);
  expect(next.layers[1].folderId).toBe('art');
  expect(next.layers[1].keys).toStrictEqual(p.layers[0].keys);
  expect(p).toEqual(before);
  const root = prepareLayerReorder(next, 'a', 'c', 'above');
  expect(Object.hasOwn(root.layers[2], 'folderId')).toBe(false);
});
function masked() {
  const p = fixture();
  p.layers = ['outside', 'first', 'second', 'mask', 'front'].map((id) => ({ ...newLayer(id), id }));
  p.layerMasks = [{ maskLayerId: 'mask', layerIds: ['first', 'second'] }];
  return p;
}
it('moves an entire mask block while retaining exact members and saved ownership', () => {
  const p = masked(),
    before = structuredClone(p),
    next = prepareLayerReorder(p, 'mask', 'front', 'above');
  expect(order(next)).toEqual(['outside', 'front', 'first', 'second', 'mask']);
  expect(next.layerMasks).toEqual(p.layerMasks);
  expect(next.layers.slice(2)).toEqual(p.layers.slice(1, 4));
  expect(p).toEqual(before);
});
it('snaps an outside edge drop around the complete target mask instead of splitting it', () => {
  const p = masked(),
    next = prepareLayerReorder(p, 'outside', 'second', 'above');
  expect(order(next)).toEqual(['first', 'second', 'mask', 'outside', 'front']);
  expect(next.layerMasks).toEqual(p.layerMasks);
});
it('reorders individual members inside their existing mask and updates only their saved order', () => {
  const p = masked(),
    before = structuredClone(p),
    next = prepareLayerReorder(p, 'first', 'second', 'above');
  expect(order(next)).toEqual(['outside', 'second', 'first', 'mask', 'front']);
  expect(next.layerMasks).toEqual([{ maskLayerId: 'mask', layerIds: ['second', 'first'] }]);
  expect(p).toEqual(before);
});
it('rejects escaping members, locked sources and locked mask blocks atomically', () => {
  for (const mode of ['member', 'locked', 'block'] as const) {
    const p = masked();
    if (mode === 'locked') p.layers[0].locked = true;
    if (mode === 'block') p.layers[1].locked = true;
    const before = structuredClone(p);
    expect(() =>
      prepareLayerReorder(
        p,
        mode === 'member' ? 'first' : mode === 'block' ? 'mask' : 'outside',
        'front',
        'above',
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('rejects missing identities, invalid sides and raw getters without invoking them', () => {
  const p = fixture(),
    before = structuredClone(p);
  expect(() => prepareLayerReorder(p, 'missing', 'a', 'above')).toThrow();
  expect(() => prepareLayerReorder(p, 'a', 'b', 'inside' as never)).toThrow();
  expect(p).toEqual(before);
  let reads = 0;
  Object.defineProperty(p.layers[0], 'folderId', {
    enumerable: true,
    get() {
      reads++;
      return undefined;
    },
  });
  expect(() => prepareLayerReorder(p, 'a', 'b', 'above')).toThrow();
  expect(reads).toBe(0);
});

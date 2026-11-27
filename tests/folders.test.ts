import { it, expect } from 'vitest';
import { newProject, newLayer, clone, validateProject } from '../packages/document/src';
import {
  createFolder,
  updateFolder,
  assignFolder,
  removeFolder,
  folderPath,
  folderRows,
  folderMembers,
  orderFolder,
  positionFolder,
} from '../packages/animation/src/folders';
it('nests folders, assigns layers and promotes children without changing drawing order', () => {
  const p = newProject(),
    layer = p.layers[0].id,
    keys = clone(p.layers[0].keys);
  const root = createFolder(p, 'Root'),
    child = createFolder(p, 'Child', root);
  assignFolder(p, layer, child);
  expect(folderPath(p, child)).toEqual([root, child]);
  expect(folderMembers(p, root).map((l) => l.id)).toEqual([layer]);
  removeFolder(p, root);
  expect(folderPath(p, child)).toEqual([child]);
  expect(p.layers[0].keys).toEqual(keys);
  removeFolder(p, child);
  expect(p.layers[0].folderId).toBeUndefined();
  expect(p.layers[0].id).toBe(layer);
  validateProject(p);
});
it('rejects folder cycles, missing references and excessive depth atomically', () => {
  const p = newProject(),
    a = createFolder(p, 'A'),
    b = createFolder(p, 'B', a),
    before = clone(p);
  expect(() => updateFolder(p, a, 'A', b)).toThrow('cycle');
  expect(p).toEqual(before);
  expect(() => assignFolder(p, p.layers[0].id, 'missing')).toThrow('reference');
  expect(p).toEqual(before);
  let parent = b;
  for (let i = 0; i < 6; i++) parent = createFolder(p, 'Nested', parent);
  const deep = clone(p);
  expect(() => createFolder(p, 'Too deep', parent)).toThrow('depth');
  expect(p).toEqual(deep);
});

it('tree rows include empty folders, hide descendants on collapse and preserve paint order', () => {
  const p = newProject(),
    original = p.layers[0],
    root = createFolder(p, 'Root'),
    child = createFolder(p, 'Child', root);
  assignFolder(p, original.id, child);
  const before = clone(p);
  expect(folderRows(p).map((r) => r.folderRowId ?? r.id)).toEqual([root, child, original.id]);
  expect(folderRows(p, [root]).map((r) => r.folderRowId ?? r.id)).toEqual([root]);
  expect(folderRows(p, [child]).map((r) => r.folderRowId ?? r.id)).toEqual([root, child]);
  expect(p).toEqual(before);
  expect(folderRows(p).at(-1)).toBe(p.layers[0]);
});

it('orders sibling headers without changing nested membership or paint order', () => {
  const p = newProject(),
    a = createFolder(p, 'A'),
    child = createFolder(p, 'Child', a),
    b = createFolder(p, 'B');
  const layers = clone(p.layers);
  orderFolder(p, b, -1);
  expect(
    folderRows(p)
      .filter((r) => r.folderRowId)
      .map((r) => r.name),
  ).toEqual(['B', 'A', 'Child']);
  expect(p.layers).toEqual(layers);
  expect(folderPath(p, child)).toEqual([a, child]);
  orderFolder(p, b, 1);
  expect(p.folders!.map((f) => f.id)).toEqual([a, child, b]);
  const before = clone(p);
  orderFolder(p, child, -1);
  expect(p).toEqual(before);
  expect(() => orderFolder(p, 'missing', 1)).toThrow();
  expect(p).toEqual(before);
});
it('moves nested folder members as a stable paint block and rejects locked descendants', () => {
  const p = newProject();
  p.layers.push(newLayer('second'), newLayer('third'), newLayer('fourth'));
  const root = createFolder(p, 'Root'),
    child = createFolder(p, 'Child', root);
  assignFolder(p, p.layers[0].id, root);
  assignFolder(p, p.layers[2].id, child);
  const original = clone(p),
    ids = p.layers.map((l) => l.id);
  positionFolder(p, root, 'top');
  expect(p.layers.map((l) => l.id)).toEqual([ids[1], ids[3], ids[0], ids[2]]);
  positionFolder(p, root, 'bottom');
  expect(p.layers.map((l) => l.id)).toEqual([ids[0], ids[2], ids[1], ids[3]]);
  for (const layer of p.layers)
    expect(layer).toEqual(original.layers.find((l) => l.id === layer.id));
  p.layers[1].locked = true;
  const before = clone(p);
  expect(() => positionFolder(p, root, 'top')).toThrow('Unlock');
  expect(p).toEqual(before);
  validateProject(p);
});

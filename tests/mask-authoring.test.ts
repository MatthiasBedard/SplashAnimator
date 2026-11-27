import { removeRootLayer } from '../packages/animation/src/layers';
import { it, expect, vi } from 'vitest';
import {
  newProject,
  newLayer,
  validateProject,
  migrateProject,
  clone,
} from '../packages/document/src';
import { prepareMaskLayer, prepareMaskMember } from '../packages/document/src/mask-authoring';
import { saveProject, loadProject } from '../packages/document/src/storage';
function fixture() {
  const p = newProject();
  p.layers = ['Extra', 'Paint', 'Mask'].map((name) => {
    const l = newLayer(name);
    l.id = name;
    return l;
  });
  return p;
}
it('converts the source over the immediately lower layer, without changing any artwork or source', () => {
  const p = fixture(),
    before = clone(p),
    out = prepareMaskLayer(p, 'Mask', true);
  expect(out.layerMasks).toEqual([{ maskLayerId: 'Mask', layerIds: ['Paint'] }]);
  expect(out.layers).toEqual(p.layers);
  expect(p).toEqual(before);
  expect(prepareMaskLayer(out, 'Mask', false)).toEqual(p);
});
it('adds another layer to the contiguous masked run and detaches the whole result', () => {
  const p = prepareMaskLayer(fixture(), 'Mask', true),
    before = clone(p),
    out = prepareMaskMember(p, 'Mask', 'Extra');
  expect(out.layers.map((l) => l.id)).toEqual(['Paint', 'Extra', 'Mask']);
  expect(out.layerMasks).toEqual([{ maskLayerId: 'Mask', layerIds: ['Paint', 'Extra'] }]);
  expect(p).toEqual(before);
  out.layers[0].name = 'Changed';
  expect(p.layers[1].name).toBe('Paint');
});
it('converts an existing member into an inner mask and retains original ownership', () => {
  const p = prepareMaskLayer(fixture(), 'Mask', true);
  const q = prepareMaskLayer(p, 'Paint', true);
  expect(q.layerMasks).toEqual([...p.layerMasks!, { maskLayerId: 'Paint', layerIds: ['Extra'] }]);
  expect(prepareMaskLayer(q, 'Paint', false)).toEqual(p);
  expect(() => prepareMaskMember(p, 'Mask', 'Mask')).toThrow();
  expect(() => prepareMaskLayer(p, 'Extra', true)).toThrow();
});
it('rejects broken order, missing members, cross-folder ownership and duplicate masking', () => {
  const p = prepareMaskLayer(fixture(), 'Mask', true);
  for (const ids of [['Extra'], ['missing'], ['Paint', 'Paint']])
    expect(() =>
      validateProject({ ...p, layerMasks: [{ maskLayerId: 'Mask', layerIds: ids }] }),
    ).toThrow();
  const q = clone(p);
  q.folders = [{ id: 'f', name: 'Folder' }];
  q.layers[1].folderId = 'f';
  expect(() => validateProject(q)).toThrow();
  expect(() =>
    validateProject({ ...p, layerMasks: [...p.layerMasks!, ...p.layerMasks!] }),
  ).toThrow();
});
it('keeps locked members intact when dropping them into a mask', () => {
  const p = prepareMaskLayer(fixture(), 'Mask', true);
  p.layers[0].locked = true;
  const before = clone(p);
  expect(() => prepareMaskMember(p, 'Mask', 'Extra')).toThrow();
  expect(p).toEqual(before);
});
it('rejects raw getters and sparse lists without invoking the getter', () => {
  const p = fixture();
  let reads = 0;
  Object.defineProperty(p, 'layerMasks', {
    enumerable: true,
    get() {
      reads++;
      return [];
    },
  });
  expect(() => validateProject(p)).toThrow();
  expect(reads).toBe(0);
  const q = fixture();
  q.layerMasks = new Array(1);
  expect(() => validateProject(q)).toThrow();
});
it('upgrades schema57 without materializing masks and rejects unversioned rendering behavior', () => {
  const p = fixture();
  expect(migrateProject({ ...p, schemaVersion: 57 })).toEqual(p);
  expect(migrateProject({ ...p, schemaVersion: 57 })).not.toHaveProperty('layerMasks');
  expect(() => migrateProject({ ...p, schemaVersion: 57, layerMasks: [] })).toThrow(/schema 58/);
});
it('saves and reopens mask membership in the existing directory transport', async () => {
  const p = prepareMaskMember(prepareMaskLayer(fixture(), 'Mask', true), 'Mask', 'Extra'),
    files = new Map<string, string>();
  const store = {
    read: async (path: string) => files.get(path)!,
    exists: async (path: string) => files.has(path),
    writeNew: async (path: string, data: string) => {
      files.set(path, data);
    },
    commit: async (path: string, data: string) => {
      files.set(path, data);
    },
  };
  await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
  expect(JSON.parse(files.get('project.json')!).schemaVersion).toBe(59);
  const art = { id: 'fill', kind: 'rectangle' as const, x: 0, y: 0, width: 10, height: 10,
    rotation: 0, points: [], fill: '#000000', stroke: '#000000', strokeWidth: 0 };
  p.symbols = [{ id: 'clip', name: 'Clip', width: 10, height: 10, shapes: [art],
    timeline: { duration: 1, keys: [], layers: [newLayer('Source')], layerMasks: [] } }];
  const local = p.symbols[0].timeline!;
  local.layerMasks!.push({ maskLayerId: local.layers![0].id, layerIds: ['@base'] });
  p.schemaVersion = 60;
  await saveProject(store, p, files.get('project.json')!);
  expect((await loadProject(store)).project).toEqual(p);
  const manifest = JSON.parse(files.get('project.json')!);
  expect(manifest.schemaVersion).toBe(60);
  files.set('project.json', JSON.stringify({ ...manifest, schemaVersion: 59 }));
  await expect(loadProject(store)).rejects.toThrow(/schema 60 manifest/i);
});

it('removes mask-source ownership when deleting the source and keeps children unchanged', () => {
  const p = prepareMaskMember(prepareMaskLayer(fixture(), 'Mask', true), 'Mask', 'Extra'),
    before = clone(p.layers.slice(0, 2));
  removeRootLayer(p, 'Mask');
  expect(p.layers).toEqual(before);
  expect(p).not.toHaveProperty('layerMasks');
  validateProject(p);
});
it('retains explicit empty channel/mask metadata when deleting an unrelated normal layer',()=>{
  const p=fixture();p.opacityBindings=[];p.layerMasks=[];
  removeRootLayer(p,'Extra');expect(p.opacityBindings).toEqual([]);expect(p.layerMasks).toEqual([]);validateProject(p);
});
it('deleting a member preserves the remaining mask and deleting its final member releases the source', () => {
  const p = prepareMaskMember(prepareMaskLayer(fixture(), 'Mask', true), 'Mask', 'Extra');
  removeRootLayer(p, 'Extra');
  expect(p.layerMasks).toEqual([{ maskLayerId: 'Mask', layerIds: ['Paint'] }]);
  const q = fixture().layers[0];
  q.id = 'unrelated';
  p.layers.unshift(q);
  removeRootLayer(p, 'Paint');
  expect(p).not.toHaveProperty('layerMasks');
  validateProject(p);
});

it('moves a member between mask groups without breaking either original contiguous run', () => {
  let p = fixture();
  p.layers = ['A', 'B', 'M', 'C', 'N'].map((id) => ({ ...newLayer(id), id }));
  p = prepareMaskMember(prepareMaskLayer(prepareMaskLayer(p, 'M', true), 'N', true), 'M', 'A');
  const before = clone(p),
    out = prepareMaskMember(p, 'N', 'A');
  expect(out.layers.map((l) => l.id)).toEqual(['B', 'M', 'C', 'A', 'N']);
  expect(out.layerMasks).toEqual([
    { maskLayerId: 'M', layerIds: ['B'] },
    { maskLayerId: 'N', layerIds: ['C', 'A'] },
  ]);
  validateProject(out);
  expect(p).toEqual(before);
  expect(() => prepareMaskMember(out, 'N', 'B')).toThrow(/last layer/);
});
it('rejects saved mask accessors and inherited serialization hooks without invoking them', () => {
  const p = prepareMaskLayer(fixture(), 'Mask', true);
  let calls = 0;
  Object.defineProperty(p.layerMasks![0], 'layerIds', {
    enumerable: true,
    get() {
      calls++;
      return ['Paint'];
    },
  });
  expect(() => validateProject(p)).toThrow();
  expect(calls).toBe(0);
  const q = prepareMaskLayer(fixture(), 'Mask', true);
  Object.setPrototypeOf(q.layerMasks![0], {
    toJSON() {
      calls++;
      return {};
    },
  });
  expect(() => validateProject(q)).toThrow();
  expect(calls).toBe(0);
});
for (const op of ['convert', 'member'])
  it(`rejects a late source edit after detached ${op} cloning`, () => {
    const p = op === 'convert' ? fixture() : prepareMaskLayer(fixture(), 'Mask', true),
      stringify = JSON.stringify;
    let reads = 0,
      hit = false;
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation(((
      ...args: Parameters<typeof JSON.stringify>
    ) => {
      const result = stringify(...args);
      if (args[0] === p && ++reads === 2) {
        p.layers[0].name = 'Actual source edit';
        hit = true;
      }
      return result;
    }) as typeof JSON.stringify);
    try {
      expect(() =>
        op === 'convert'
          ? prepareMaskLayer(p, 'Mask', true)
          : prepareMaskMember(p, 'Mask', 'Extra'),
      ).toThrow(/original mask layers changed/);
      expect(hit).toBe(true);
      expect(p.layers[0].name).toBe('Actual source edit');
    } finally {
      spy.mockRestore();
    }
  });

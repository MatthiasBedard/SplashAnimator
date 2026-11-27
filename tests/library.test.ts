import { expect, it } from 'vitest';
import { newProject, validateProject, migrateProject } from '../packages/document/src';
import {
  setLibraryFolder,
  removeLibraryFolder,
  moveLibraryItem,
  validateLibraryOrganization,
  libraryFolderPaths,
  libraryItemFolder,
} from '../packages/document/src/library';
import { loadProject, saveProject, type DirectoryStore } from '../packages/document/src/storage';
import {
  replaceSymbolArtwork,
  updateSymbolArtwork,
  duplicateSymbol,
} from '../packages/geometry/src/symbols';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=';
function fixture() {
  const p = newProject();
  p.symbols = [
    {
      id: 's',
      name: 'Zebra',
      width: 100,
      height: 100,
      shapes: [
        {
          id: 'art',
          kind: 'rectangle',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
    },
  ];
  p.assets = [
    {
      id: 'b',
      path: 'assets/bitmaps/b.json',
      bitmap: { name: 'Apple', width: 1, height: 1, dataUrl: png },
    },
  ];
  return p;
}
it('keeps legacy/default documents exact and renders organization independently from timeline folders', () => {
  const p = fixture();
  expect(validateProject(p)).toEqual(p);
  expect(migrateProject(p)).toEqual(p);
  setLibraryFolder(p, { id: 'root', name: 'Art' });
  setLibraryFolder(p, { id: 'child', name: 'Heads', parentId: 'root' });
  moveLibraryItem(p, 'symbol', 's', 'child');
  moveLibraryItem(p, 'bitmap', 'b', 'root');
  expect(libraryFolderPaths(p)).toEqual([
    { id: 'root', path: 'Art' },
    { id: 'child', path: 'Art / Heads' },
  ]);
  expect(p.folders).toBeUndefined();
  expect(validateProject(p)).toEqual(p);
  expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
});
it('renames and reparents nested folders without touching item identities or bytes', () => {
  const p = fixture(),
    bytes = p.assets[0].bitmap!.dataUrl;
  setLibraryFolder(p, { id: 'a', name: 'Art' });
  setLibraryFolder(p, { id: 'b', name: 'Characters' });
  setLibraryFolder(p, { id: 'child', name: 'Heads', parentId: 'a' });
  moveLibraryItem(p, 'bitmap', 'b', 'child');
  setLibraryFolder(p, { id: 'child', name: 'Faces', parentId: 'b' });
  expect(libraryFolderPaths(p).find((f) => f.id === 'child')!.path).toBe('Characters / Faces');
  expect(p.assets[0].bitmap!.dataUrl).toBe(bytes);
  expect(p.assets[0].path).toBe('assets/bitmaps/b.json');
});
it('deleting a folder preserves all assets/symbols and promotes items and subfolders to its parent', () => {
  const p = fixture();
  setLibraryFolder(p, { id: 'a', name: 'Art' });
  setLibraryFolder(p, { id: 'b', name: 'People', parentId: 'a' });
  setLibraryFolder(p, { id: 'c', name: 'Heads', parentId: 'b' });
  moveLibraryItem(p, 'symbol', 's', 'b');
  moveLibraryItem(p, 'bitmap', 'b', 'c');
  removeLibraryFolder(p, 'b');
  expect(libraryItemFolder(p, 'symbol', 's')).toBe('a');
  expect(p.libraryFolders!.find((f) => f.id === 'c')!.parentId).toBe('a');
  removeLibraryFolder(p, 'a');
  expect(libraryItemFolder(p, 'symbol', 's')).toBe('');
  expect(p.libraryFolders![0].parentId).toBeUndefined();
  expect(p.assets).toHaveLength(1);
  expect(p.symbols).toHaveLength(1);
  expect(validateProject(p)).toEqual(p);
});
it('rejects cycles, dangling destinations, duplicate sibling names and conflicting promotion atomically', () => {
  const p = fixture();
  setLibraryFolder(p, { id: 'a', name: 'Art' });
  setLibraryFolder(p, { id: 'b', name: 'Heads', parentId: 'a' });
  const before = structuredClone(p);
  expect(() => setLibraryFolder(p, { id: 'a', name: 'Art', parentId: 'b' })).toThrow(/themselves/);
  expect(() => setLibraryFolder(p, { id: 'c', name: ' heads ', parentId: 'a' })).toThrow(
    /already exists/,
  );
  expect(() => moveLibraryItem(p, 'symbol', 's', 'missing')).toThrow();
  expect(() => moveLibraryItem(p, 'bitmap', 'missing')).toThrow();
  expect(p).toEqual(before);
  setLibraryFolder(p, { id: 'c', name: 'Heads' });
  const conflict = structuredClone(p);
  expect(() => removeLibraryFolder(p, 'a')).toThrow(/already exists/);
  expect(p).toEqual(conflict);
});
it('moving items to root removes optional membership rather than writing an empty reference', () => {
  const p = fixture();
  setLibraryFolder(p, { id: 'a', name: 'Art' });
  moveLibraryItem(p, 'symbol', 's', 'a');
  moveLibraryItem(p, 'symbol', 's');
  expect(p.libraryItems).toEqual([]);
});
for (const bad of [
  [{ id: 'a', name: '' }],
  [{ id: 'a', name: 'A', parentId: 'missing' }],
  [
    { id: 'a', name: 'A' },
    { id: 'a', name: 'B' },
  ],
  [{ id: 'a', name: 'A', parentId: 'a' }],
  [{ id: 'a', name: 'A', extra: true }],
  [{ id: 2, name: 'A' }],
  new Array(1),
])
  it('rejects malformed/dangling original folder metadata', () => {
    const p = Object.assign(fixture(), { libraryFolders: bad });
    expect(() => validateProject(p)).toThrow();
  });
it('rejects raw getters without reading them, including sparse/extended arrays and item membership', () => {
  const p = fixture();
  let reads = 0;
  Object.defineProperty(p, 'libraryFolders', {
    enumerable: true,
    get() {
      reads++;
      return [];
    },
  });
  expect(() => validateLibraryOrganization(p)).toThrow();
  expect(() => validateProject(p)).toThrow();
  expect(reads).toBe(0);
  const q = fixture();
  Object.defineProperty(q, 'libraryItems', {
    enumerable: true,
    get() {
      reads++;
      return 'x';
    },
  });
  expect(() => validateLibraryOrganization(q)).toThrow();
  expect(reads).toBe(0);
  const r = fixture();
  r.libraryFolders = [];
  Object.assign(r.libraryFolders, { other: 1 });
  expect(() => validateLibraryOrganization(r)).toThrow();
});
it('organized symbol artwork can still be edited, duplicated and replaced through detached library validators', () => {
  const p = fixture();
  setLibraryFolder(p, { id: 'folder', name: 'Art' });
  moveLibraryItem(p, 'symbol', 's', 'folder');
  moveLibraryItem(p, 'bitmap', 'b', 'folder');
  const organization = structuredClone(p.libraryItems);
  updateSymbolArtwork(
    p,
    's',
    p.symbols![0].shapes.map((s) => ({ ...s, fill: '#0000ff' })),
  );
  const copy = duplicateSymbol(p, 's');
  expect(copy.shapes[0].fill).toBe('#0000ff');
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys[0].shapes = [{ ...p.symbols![0].shapes[0], id: 'source' }];
  replaceSymbolArtwork(p, 's', p.layers[0].id, 0, ['source']);
  expect(p.libraryItems).toEqual(organization);
  expect(validateProject(p)).toEqual(p);
});
it('rejects non-string location fields before coercion or JSON callbacks can execute', () => {
  const p = fixture();
  setLibraryFolder(p, { id: 'folder', name: 'Art' });
  let reads = 0;
  const bad = {
    toString() {
      reads++;
      return 'symbol';
    },
    toJSON() {
      reads++;
      return 'symbol';
    },
  };
  p.libraryItems = [
    Object.assign({ kind: 'symbol' as const, id: 's', folderId: 'folder' }, { kind: bad }),
  ] as unknown as NonNullable<typeof p.libraryItems>;
  expect(() => validateProject(p)).toThrow();
  expect(reads).toBe(0);
});
it('saves and reopens folders and both item kinds through the real directory serializer', async () => {
  const p = fixture();
  setLibraryFolder(p, { id: 'a', name: 'Artwork' });
  setLibraryFolder(p, { id: 'b', name: 'Textures', parentId: 'a' });
  moveLibraryItem(p, 'symbol', 's', 'a');
  moveLibraryItem(p, 'bitmap', 'b', 'b');
  const files = new Map<string, string>();
  const store: DirectoryStore = {
    async read(path) {
      if (!files.has(path)) throw Error('Missing file');
      return files.get(path)!;
    },
    async writeNew(path, value) {
      if (files.has(path)) throw Error('Exists');
      files.set(path, value);
    },
    async commit(path, value, expected) {
      expect(files.get(path) ?? null).toBe(expected);
      files.set(path, value);
    },
    async exists(path) {
      return files.has(path);
    },
  };
  await saveProject(store, p, null);
  expect((await loadProject(store)).project).toEqual(p);
  expect(files.get('assets/bitmaps/b.json')).toContain(png);
});

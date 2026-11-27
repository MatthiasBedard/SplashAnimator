import { expect, it } from 'vitest';
import {
  newProject,
  validateProject,
  migrateProject,
  type Project,
} from '../packages/document/src';
import {
  setLibraryLink,
  libraryLinkName,
  resolveLibraryLink,
  suggestLibraryLink,
  moveLibraryItem,
  setLibraryFolder,
} from '../packages/document/src/library';
import { libraryInstance, libraryAudioClip } from '../packages/geometry/src/library-instance';
import { saveProject, loadProject } from '../packages/document/src/storage';
function fixture() {
  const p = newProject();
  p.symbols = [
    {
      id: 'hero',
      name: 'Hero',
      width: 20,
      height: 20,
      shapes: [
        {
          id: 'art',
          kind: 'rectangle',
          x: 0,
          y: 0,
          width: 20,
          height: 20,
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
      id: 'paper',
      path: 'assets/bitmaps/paper.json',
      bitmap: { name: 'Paper.png', width: 2, height: 3 },
    },
  ];
  return p;
}
it('keeps code aliases stable through display rename and folder organization', () => {
  const p = fixture();
  setLibraryLink(p, 'symbol', 'hero', 'characters.Hero');
  p.symbols![0].name = 'Renamed';
  setLibraryFolder(p, { id: 'folder', name: 'People' });
  moveLibraryItem(p, 'symbol', 'hero', 'folder');
  expect(libraryLinkName(p, 'symbol', 'hero')).toBe('characters.Hero');
  expect(resolveLibraryLink(p, 'characters.Hero')).toMatchObject({
    kind: 'symbol',
    symbol: { id: 'hero', name: 'Renamed' },
  });
  validateProject(p);
});
it('rejects duplicate global names atomically and allows explicit clear/reassignment', () => {
  const p = fixture();
  setLibraryLink(p, 'symbol', 'hero', 'Hero');
  const before = structuredClone(p);
  expect(() => setLibraryLink(p, 'bitmap', 'paper', 'Hero')).toThrow(/unique/);
  expect(p).toEqual(before);
  setLibraryLink(p, 'symbol', 'hero', '');
  setLibraryLink(p, 'bitmap', 'paper', 'Hero');
  expect(resolveLibraryLink(p, 'Hero').kind).toBe('bitmap');
});
for (const name of [
  'bad name',
  '2Hero',
  'a..b',
  'a.__proto__',
  'constructor',
  'x.prototype',
  'x.constructor',
  'x-y',
  'a'.repeat(201),
])
  it(`rejects invalid code alias ${name.slice(0, 25)}`, () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => setLibraryLink(p, 'symbol', 'hero', name)).toThrow();
    expect(p).toEqual(before);
  });
it('generates deterministic unique import aliases without changing display names', () => {
  const p = fixture();
  setLibraryLink(p, 'bitmap', 'paper', 'my_image');
  expect(suggestLibraryLink(p, 'my image.png')).toBe('my_image_2');
  expect(suggestLibraryLink(p, '2.png')).toBe('item_2');
  expect(suggestLibraryLink(p, 'constructor')).toBe('item_constructor');
});
it('creates linked scene objects from code using original item identities and insertion defaults', () => {
  const p = fixture();
  p.symbols![0].defaultPlayback = 'movie';
  setLibraryLink(p, 'symbol', 'hero', 'Hero');
  setLibraryLink(p, 'bitmap', 'paper', 'Paper');
  const hero = libraryInstance(p, 'Hero', 15, 25),
    paper = libraryInstance(p, 'Paper', 30, 40);
  expect(hero).toMatchObject({
    kind: 'symbol',
    symbolId: 'hero',
    x: 15,
    y: 25,
    symbolPlayback: { mode: 'movie', firstFrame: 0 },
  });
  expect(paper).toMatchObject({
    kind: 'rectangle',
    width: 2,
    height: 3,
    bitmap: { assetId: 'paper' },
  });
  p.layers[0].keys[0].shapes.push(hero, paper);
  validateProject(p);
  expect(() => libraryInstance(p, 'Missing', 0, 0)).toThrow(/No library item/);
  expect(() => libraryInstance(p, 'Hero', NaN, 0)).toThrow(/finite/);
});
it('preserves legacy absent insertion defaults and rejects invalid/movie button preferences', () => {
  const p = fixture();
  setLibraryLink(p, 'symbol', 'hero', 'Hero');
  expect(libraryInstance(p, 'Hero', 0, 0).symbolPlayback).toBeUndefined();
  Object.assign(p.symbols![0], { defaultPlayback: 'bad' });
  expect(() => validateProject(p)).toThrow(/default playback/);
  p.symbols![0].defaultPlayback = 'movie';
  p.symbols![0].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  expect(() => validateProject(p)).toThrow(/button insertion/);
});
it('rejects raw alias getters, sparse lists and duplicate identity records without reads', () => {
  const p = fixture();
  let reads = 0;
  p.libraryLinks = [
    Object.defineProperty({ kind: 'symbol', id: 'hero' }, 'name', {
      enumerable: true,
      get() {
        reads++;
        return 'Hero';
      },
    }) as NonNullable<Project['libraryLinks']>[0],
  ];
  expect(() => validateProject(p)).toThrow();
  expect(reads).toBe(0);
  p.libraryLinks = new Array(1);
  expect(() => validateProject(p)).toThrow();
  p.libraryLinks = [
    { kind: 'symbol', id: 'hero', name: 'Hero' },
    { kind: 'symbol', id: 'hero', name: 'Other' },
  ];
  expect(() => validateProject(p)).toThrow(/unique/);
});
it('roundtrips links and insertion hints in directory/recovery data without adding defaults to old documents', async () => {
  const p = fixture();
  setLibraryLink(p, 'symbol', 'hero', 'Hero');
  p.symbols![0].defaultPlayback = 'movie';
  expect(migrateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  const files = new Map<string, string>(),
    store = {
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
  const old = fixture();
  expect(Object.hasOwn(migrateProject(JSON.parse(JSON.stringify(old))), 'libraryLinks')).toBe(
    false,
  );
});

it('organizes audio alongside artwork and resolves its code link without adding scene artwork', () => {
  const p = fixture();
  p.assets.push({
    id: 'sound',
    path: 'assets/audio/sound.wav',
    audio: { name: 'Sound', format: 'pcm16-wav', sampleRate: 48000, channels: 1, frames: 48000 },
  });
  setLibraryFolder(p, { id: 'sounds', name: 'Sounds' });
  moveLibraryItem(p, 'audio', 'sound', 'sounds');
  setLibraryLink(p, 'audio', 'sound', 'sounds.Click');
  const before = structuredClone(p),
    clip = libraryAudioClip(p, 'sounds.Click', 0);
  expect(clip).toMatchObject({ assetId: 'sound', startFrame: 0, offsetSamples: 0, gain: 1 });
  expect(p).toEqual(before);
  expect(p.libraryItems).toContainEqual({ kind: 'audio', id: 'sound', folderId: 'sounds' });
  expect(() => libraryInstance(p, 'sounds.Click', 0, 0)).toThrow(/libraryAudioClip/);
  expect(() => libraryAudioClip(p, 'sounds.Click', p.duration)).toThrow(/inside/);
  expect(() => libraryAudioClip(p, 'sounds.Click', NaN)).toThrow(/inside/);
  p.audioClips = [clip];
  validateProject(p);
});

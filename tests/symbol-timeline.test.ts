import { editSymbolBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { it, expect } from 'vitest';
import { migrateProject, newProject, symbolLayers, MAX_SYMBOL_ARTWORK, type SymbolDefinition, type Vector } from '../packages/document/src';
import {
  copySymbolFrames,
  cutSymbolTracks,
  clearSymbolFrames,
  reverseSymbolFrames,
  insertSymbolFrames,
  transferSymbolKey,
  transferSymbolFrames,
  transferSymbolTracks,
  removeSymbolFrames,
  duplicateSymbolFrames,
  editSymbolTracks,
  retimeSymbolTracks,
  copySymbolTracks,
  insertSymbolTracks,
} from '../packages/animation/src/symbol-timeline';
import { symbolFrame } from '../packages/geometry/src/symbols';
const art = (fill: string): Vector => ({
  id: 'art',
  kind: 'rectangle',
  x: 0,
  y: 0,
  width: 40,
  height: 30,
  rotation: 0,
  fill,
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
  groups: ['group'],
});
const definition = (): SymbolDefinition => ({
  id: 'symbol',
  name: 'Symbol',
  width: 40,
  height: 30,
  shapes: [art('#ff0000')],
  timeline: {
    duration: 8,
    keys: [
      { frame: 2, shapes: [art('#0000ff')] },
      { frame: 5, shapes: [] },
    ],
  },
});
it('shortens a symbol tail while retaining frame notes and button state mappings', () => {
  const symbol = definition();
  symbol.timeline!.frameComments = [{ frame: 5, text: 'Keep this cue' }];
  symbol.buttonStates = { up: 0, over: 2, down: 2, hit: 4 };
  const before = structuredClone(symbol);
  const first = removeSymbolFrames(symbol, '@base', 4, 7, [symbol]);
  expect(first.timeline?.duration).toBe(6);
  expect(first.timeline?.frameComments).toEqual(before.timeline?.frameComments);
  expect(first.buttonStates).toEqual(before.buttonStates);
  delete first.timeline!.frameComments;
  const trimmed = removeSymbolFrames(first, '@base', 4, 5, [first]);
  expect(trimmed.timeline?.duration).toBe(5);
  expect(trimmed.buttonStates).toEqual(before.buttonStates);
  expect(symbol).toEqual(before);
});
it('reopens a symbol whose Artwork layer is empty and evaluates the later exposure on another layer', () => {
  const d = definition();
  const artwork = d.shapes;
  d.shapes = [];
  d.timeline!.keys = [];
  d.timeline!.layers = [{
    id: 'other', name: 'Other', visible: true, locked: false,
    keys: [{ frame: 0, shapes: [] }, { frame: 3, shapes: artwork }],
  }];
  const project = { ...newProject(), symbols: [d] };
  const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
  expect(reopened).toEqual(project);
  const saved = reopened.symbols![0];
  expect(symbolFrame(saved, 0)).toEqual([]);
  expect(symbolFrame(saved, 3)).toEqual(artwork);
  expect(symbolFrame(saved, 8)).toEqual([]);
});
it('copies held artwork and blank exposures, preserves identities and extends without mutating input', () => {
  const d = definition(),
    before = structuredClone(d);
  const copy = transferSymbolKey(d, 3, 9);
  expect(copy.timeline?.duration).toBe(10);
  expect(copy.timeline?.keys.map((k) => k.frame)).toEqual([2, 5, 9]);
  expect(copy.timeline?.keys[2].shapes).toEqual(d.timeline?.keys[0].shapes);
  copy.timeline!.keys[2].shapes[0].groups!.push('other');
  expect(d).toEqual(before);
  expect(transferSymbolKey(d, 6, 7).timeline?.keys[2].shapes).toEqual([]);
  const initial = transferSymbolKey(d, 0, 1);
  expect(initial.timeline?.keys[0].shapes).toEqual(d.shapes);
});
it('relocates individual noninitial keys in either direction and retains other keys', () => {
  const d = definition();
  expect(transferSymbolKey(d, 2, 4, true).timeline?.keys.map((k) => k.frame)).toEqual([4, 5]);
  const backward = transferSymbolKey(d, 5, 1, true);
  expect(backward.timeline?.keys.map((k) => k.frame)).toEqual([1, 2]);
  expect(backward.timeline?.keys[0].shapes).toEqual([]);
  expect(backward.shapes).toEqual(d.shapes);
  expect(backward.timeline?.duration).toBe(8);
});
it('rejects collisions, initial-key moves, held-key moves and invalid boundaries without mutation', () => {
  const d = definition(),
    before = structuredClone(d);
  for (const args of [
    [2, 2, false],
    [2, 5, false],
    [0, 1, true],
    [3, 4, true],
    [8, 9, false],
    [2, 0, false],
    [2, 10000, false],
    [2, 1.5, false],
    [2, NaN, false],
  ] as const)
    expect(() => transferSymbolKey(d, args[0], args[1], args[2])).toThrow();
  expect(d).toEqual(before);
  expect(transferSymbolKey(d, 2, 9999).timeline?.duration).toBe(10000);
});

it('copies held ranges immutably and clears with the original boundary hold restored', () => {
  const d = definition(),
    before = structuredClone(d);
  const clip = copySymbolFrames(d, '@base', 1, 5);
  expect(clip.duration).toBe(5);
  expect(clip.keys.map((k) => k.frame)).toEqual([0, 1, 4]);
  const cleared = clearSymbolFrames(d, '@base', 1, 3);
  expect(cleared.timeline!.keys.map((k) => k.frame)).toEqual([1, 4, 5]);
  expect(cleared.timeline!.keys[0].shapes).toEqual([]);
  expect(cleared.timeline!.keys[1].shapes[0].fill).toBe('#0000ff');
  clip.keys[0].shapes[0].fill = '#ffffff';
  expect(d).toEqual(before);
});
it('inserts snapshots across tracks with fresh consistent identities and preserves other key positions', () => {
  const d = definition();
  d.timeline!.layers = [
    { id: 'extra', name: 'Extra', visible: true, locked: false, keys: [{ frame: 0, shapes: [] }] },
  ];
  const clip = copySymbolFrames(d, '@base', 0, 3),
    before = structuredClone(d);
  const result = insertSymbolFrames(d, 'extra', 1, clip);
  expect(result.timeline!.duration).toBe(12);
  expect(result.timeline!.keys).toEqual(d.timeline!.keys);
  const keys = result.timeline!.layers![0].keys;
  expect(keys.map((k) => k.frame)).toEqual([0, 1, 3, 5]);
  expect(keys[3].shapes).toEqual([]);
  expect(keys[1].shapes[0].id).toBe(keys[2].shapes[0].id);
  expect(keys[1].shapes[0].id).not.toBe('art');
  expect(keys[1].shapes[0].groups).not.toEqual(['group']);
  const inserted = insertSymbolFrames(d, '@base', 1, clip);
  expect(inserted.timeline!.keys.map((k) => k.frame)).toEqual([1, 3, 5, 6, 9]);
  expect(inserted.timeline!.keys[2].shapes).toEqual(d.shapes);
  expect(d).toEqual(before);
});
it('admits blank first frames and rejects invalid ranges, locked tracks and insertion overflow atomically', () => {
  const d = definition(),
    before = structuredClone(d),
    clip = copySymbolFrames(d, '@base', 0, 1);
  for (const [a, b] of [
    [-1, 2],
    [2, 1],
    [0, 8],
    [1.5, 2],
  ])
    expect(() => copySymbolFrames(d, '@base', a, b)).toThrow();
  expect(clearSymbolFrames(d, '@base', 0, 2).shapes).toEqual([]);
  const inserted = insertSymbolFrames(d, '@base', 0, { duration: 1, keys: [{ frame: 0, shapes: [] }] });
  expect(inserted.shapes).toEqual([]);
  expect(inserted.timeline!.keys[0]).toEqual({ frame: 1, shapes: d.shapes });
  expect(() => clearSymbolFrames(d, '@base', 0, 7)).toThrow('Keep artwork on at least one frame');
  expect(() => insertSymbolFrames(d, '@base', 9, clip)).toThrow();
  expect(() => insertSymbolFrames(d, '@base', 1, { ...clip, duration: 10000 })).toThrow();
  expect(() => insertSymbolFrames(d, 'missing', 1, clip)).toThrow();
  expect(d).toEqual(before);
  d.timeline!.layers = [
    { id: 'locked', name: 'Locked', visible: true, locked: true, keys: [{ frame: 0, shapes: [] }] },
  ];
  expect(() => clearSymbolFrames(d, 'locked', 0, 2)).toThrow('unlocked');
  expect(() => insertSymbolFrames(d, 'locked', 0, clip)).toThrow('unlocked');
});

it('removes track time with restored boundary holds and a blank tail without moving other tracks', () => {
  const d = definition(),
    before = structuredClone(d);
  d.timeline!.layers = [
    {
      id: 'other',
      name: 'Other',
      visible: true,
      locked: false,
      keys: [
        { frame: 0, shapes: [] },
        { frame: 7, shapes: [art('#00ff00')] },
      ],
    },
  ];
  const result = removeSymbolFrames(d, '@base', 1, 3);
  expect(result.timeline!.duration).toBe(8);
  expect(result.timeline!.keys.map((k) => k.frame)).toEqual([1, 2, 5]);
  expect(result.timeline!.keys[0].shapes[0].fill).toBe('#0000ff');
  expect(result.timeline!.keys.slice(1).every((k) => !k.shapes.length)).toBe(true);
  expect(result.timeline!.layers).toEqual(d.timeline!.layers);
  expect(removeSymbolFrames(d, 'other', 0, 7).timeline!.layers![0].keys).toEqual([
    { frame: 0, shapes: [] },
  ]);
  expect(removeSymbolFrames(d, '@base', 0, 7).shapes).toEqual([]);
  expect(removeSymbolFrames(d, '@base', 0, 4).shapes).toEqual([]);
  expect(removeSymbolFrames(d, '@base', 0, 1).shapes[0].fill).toBe('#0000ff');
  expect(d.shapes).toEqual(before.shapes);
  expect(d.timeline!.keys).toEqual(before.timeline!.keys);
});
it('duplicates a whole span after itself with fresh identities and rejects overflow and locked removal', () => {
  const d = definition();
  const duplicated = duplicateSymbolFrames(d, '@base', 1, 3);
  expect(duplicated.timeline!.duration).toBe(11);
  expect(duplicated.timeline!.keys.map((k) => k.frame)).toEqual([2, 4, 5, 7, 8]);
  expect(duplicated.timeline!.keys[1].shapes[0].id).toBe(duplicated.timeline!.keys[2].shapes[0].id);
  expect(duplicated.timeline!.keys[1].shapes[0].id).not.toBe('art');
  expect(duplicated.timeline!.keys[3].shapes[0].fill).toBe('#0000ff');
  d.timeline!.duration = 10000;
  expect(() => duplicateSymbolFrames(d, '@base', 0, 0)).toThrow('limit');
  d.timeline!.layers = [
    { id: 'locked', name: 'Locked', visible: true, locked: true, keys: [{ frame: 0, shapes: [] }] },
  ];
  expect(() => removeSymbolFrames(d, 'locked', 0, 2)).toThrow('unlocked');
});

it('edits multiple tracks atomically using one shared duration and distinct copied identities', () => {
  const d = definition();
  d.timeline!.layers = [
    {
      id: 'other',
      name: 'Other',
      visible: true,
      locked: false,
      keys: [
        { frame: 0, shapes: [art('#00ff00')] },
        { frame: 6, shapes: [] },
      ],
    },
  ];
  const before = structuredClone(d);
  const duplicated = editSymbolTracks(d, ['@base', 'other'], 1, 3, 'duplicate');
  expect(duplicated.timeline!.duration).toBe(11);
  expect(duplicated.timeline!.keys.map((k) => k.frame)).toEqual([2, 4, 5, 7, 8]);
  const keys = duplicated.timeline!.layers![0].keys;
  expect(keys.map((k) => k.frame)).toEqual([0, 4, 7, 9]);
  expect(keys[1].shapes[0].id).not.toBe(duplicated.timeline!.keys[1].shapes[0].id);
  const cleared = editSymbolTracks(d, ['@base', 'other'], 1, 3, 'clear');
  expect(cleared.timeline!.layers![0].keys.map((k) => k.frame)).toEqual([0, 1, 4, 6]);
  expect(cleared.timeline!.keys[0].shapes).toEqual([]);
  const removed = editSymbolTracks(d, ['@base', 'other'], 1, 3, 'remove');
  expect(removed.timeline!.duration).toBe(8);
  expect(removed.timeline!.layers![0].keys.map((k) => k.frame)).toEqual([0, 1, 3, 5]);
  expect(d).toEqual(before);
  for (const ids of [[], ['@base', '@base'], ['@base', 'missing']])
    expect(() => editSymbolTracks(d, ids, 1, 3, 'clear')).toThrow();
  d.timeline!.layers![0].locked = true;
  const locked = structuredClone(d);
  expect(() => editSymbolTracks(d, ['@base', 'other'], 1, 3, 'duplicate')).toThrow('unlocked');
  expect(d).toEqual(locked);
});

it('copies immutable multi-track spans and inserts once into original tracks with atomic rejection', () => {
  const d = definition();
  d.timeline!.layers = [
    {
      id: 'other',
      name: 'Other',
      visible: true,
      locked: false,
      keys: [
        { frame: 0, shapes: [art('#00ff00')] },
        { frame: 6, shapes: [] },
      ],
    },
  ];
  const before = structuredClone(d),
    clip = copySymbolTracks(d, ['@base', 'other'], 1, 3);
  const result = insertSymbolTracks(d, 2, clip);
  expect(result.timeline!.duration).toBe(11);
  expect(result.timeline!.keys.map((k) => k.frame)).toEqual([2, 3, 5, 8]);
  expect(result.timeline!.layers![0].keys.map((k) => k.frame)).toEqual([0, 2, 5, 9]);
  expect(result.timeline!.keys[0].shapes[0].id).not.toBe(
    result.timeline!.layers![0].keys[1].shapes[0].id,
  );
  clip.tracks[0].clip.keys[0].shapes[0].fill = '#ffffff';
  expect(d).toEqual(before);
  const locked = structuredClone(d);
  locked.timeline!.layers![0].locked = true;
  expect(() => insertSymbolTracks(locked, 2, clip)).toThrow('unlocked');
  expect(locked.shapes).toEqual(d.shapes);
  expect(() => insertSymbolTracks(d, 2, { tracks: [clip.tracks[0], clip.tracks[0]] })).toThrow(
    'clipboard',
  );
  expect(() =>
    insertSymbolTracks(d, 2, {
      tracks: [
        clip.tracks[0],
        { ...clip.tracks[1], clip: { ...clip.tracks[1].clip, duration: 2 } },
      ],
    }),
  ).toThrow('clipboard');
  expect(() => copySymbolTracks(d, [], 1, 2)).toThrow();
});

it('routes clipboard tracks independently, including swaps, with unique destination guards', () => {
  const d = definition();
  d.timeline!.layers = [
    {
      id: 'other',
      name: 'Other',
      visible: true,
      locked: false,
      keys: [{ frame: 0, shapes: [art('#00ff00')] }],
    },
  ];
  const before = structuredClone(d),
    clip = copySymbolTracks(d, ['@base', 'other'], 0, 1);
  const result = insertSymbolTracks(d, 1, clip, ['other', '@base']);
  expect(result.timeline!.duration).toBe(10);
  expect(result.timeline!.keys[0].shapes[0].fill).toBe('#00ff00');
  expect(result.timeline!.layers![0].keys[1].shapes[0].fill).toBe('#ff0000');
  expect(result.shapes).toEqual(d.shapes);
  for (const route of [['other'], ['other', 'other'], ['missing', '@base']])
    expect(() => insertSymbolTracks(d, 1, clip, route)).toThrow();
  const detached = copySymbolTracks(d, ['other'], 0, 1);
  d.timeline!.layers = [];
  expect(insertSymbolTracks(d, 1, detached, ['@base']).timeline!.keys[0].shapes[0].fill).toBe(
    '#00ff00',
  );
  expect(before.timeline!.layers![0].keys[0].shapes[0].fill).toBe('#00ff00');
});

it('transfers symbol spans with preserved holds, blank boundaries and fresh copied identities', () => {
  const d = definition(),
    before = structuredClone(d);
  const moved = transferSymbolFrames(d, '@base', 2, 3, '@base', 6, true);
  expect(moved.timeline!.keys.map((k) => [k.frame, k.shapes.length])).toEqual([
    [2, 0],
    [4, 1],
    [5, 0],
    [6, 1],
  ]);
  expect(moved.timeline!.keys.at(-1)!.shapes[0].id).toBe('art');
  const copied = transferSymbolFrames(d, '@base', 1, 3, '@base', 10);
  expect(copied.timeline!.duration).toBe(13);
  expect(copied.timeline!.keys.map((k) => k.frame)).toEqual([2, 5, 8, 10, 11]);
  expect(copied.timeline!.keys.at(-1)!.shapes[0].id).not.toBe('art');
  expect(copied.timeline!.keys.at(-1)!.shapes[0].id).toBe(
    copied.timeline!.keys.at(-2)!.shapes[0].id,
  );
  expect(d).toEqual(before);
});
it('can move the initial range and rejects occupied, overlapping or locked moves atomically', () => {
  const d = definition();
  d.timeline!.layers = [
    { id: 'other', name: 'Other', visible: true, locked: false, keys: [{ frame: 0, shapes: [] }] },
  ];
  const before = structuredClone(d);
  const moved = transferSymbolFrames(d, '@base', 2, 4, 'other', 1, true);
  expect(moved.timeline!.layers![0].keys.map((k) => [k.frame, k.shapes.length])).toEqual([
    [0, 0],
    [1, 1],
    [4, 0],
  ]);
  expect(moved.timeline!.layers![0].keys[1].shapes[0].groups).not.toEqual(['group']);
  expect(() => transferSymbolFrames(d, '@base', 2, 4, '@base', 3, true)).toThrow('overlap');
  expect(() => transferSymbolFrames(d, '@base', 5, 6, '@base', 1)).toThrow('artwork');
  const movedInitial = transferSymbolFrames(d, '@base', 0, 1, 'other', 0, true);
  expect(movedInitial.shapes).toEqual([]);
  expect(movedInitial.timeline!.layers![0].keys[0].shapes[0].fill).toBe(d.shapes[0].fill);
  expect(() => transferSymbolFrames(d, '@base', 2, 3, 'other', 9999)).toThrow('limit');
  expect(d).toEqual(before);
  d.timeline!.layers![0].locked = true;
  expect(() => transferSymbolFrames(d, '@base', 2, 3, 'other', 1, true)).toThrow('unlocked');
});

it('moves and copies multiple symbol spans atomically with one shared extension', () => {
  const d = definition();
  d.timeline!.layers = [
    {
      id: 'other',
      name: 'Other',
      visible: true,
      locked: false,
      keys: [
        { frame: 0, shapes: [art('#00ff00')] },
        { frame: 5, shapes: [] },
      ],
    },
  ];
  const before = structuredClone(d);
  const moved = transferSymbolTracks(d, ['@base', 'other'], 2, 3, 10, true);
  expect(moved.timeline!.duration).toBe(12);
  expect(moved.timeline!.keys.find((k) => k.frame === 2)!.shapes).toEqual([]);
  expect(moved.timeline!.layers![0].keys.find((k) => k.frame === 2)!.shapes).toEqual([]);
  expect(moved.timeline!.layers![0].keys.at(-1)!.shapes[0].id).toBe('art');
  const copied = transferSymbolTracks(d, ['@base', 'other'], 2, 3, 6);
  expect(copied.timeline!.duration).toBe(8);
  expect(copied.timeline!.keys.at(-1)!.shapes[0].id).not.toBe(
    copied.timeline!.layers![0].keys.at(-1)!.shapes[0].id,
  );
  expect(d).toEqual(before);
  d.timeline!.layers![0].keys = [{ frame: 0, shapes: [art('#00ff00')] }];
  const occupied = structuredClone(d);
  expect(() => transferSymbolTracks(d, ['@base', 'other'], 2, 3, 6, true)).toThrow('artwork');
  expect(d).toEqual(occupied);
  expect(() => transferSymbolTracks(d, [], 2, 3, 6)).toThrow('distinct');
  expect(() => transferSymbolTracks(d, ['@base', '@base'], 2, 3, 6)).toThrow('distinct');
  expect(() => transferSymbolTracks(d, ['@base', 'missing'], 2, 3, 6)).toThrow('unlocked');
});

it('routes multiple symbol spans to disjoint tracks and rejects aliases without partial mutation', () => {
  const d = definition();
  d.timeline!.layers = [
    {
      id: 'source',
      name: 'Source',
      visible: true,
      locked: false,
      keys: [{ frame: 0, shapes: [art('#00ff00')] }],
    },
    { id: 'a', name: 'A', visible: true, locked: false, keys: [{ frame: 0, shapes: [] }] },
    { id: 'b', name: 'B', visible: true, locked: false, keys: [{ frame: 0, shapes: [] }] },
  ];
  const before = structuredClone(d);
  const moved = transferSymbolTracks(d, ['@base', 'source'], 2, 3, 1, true, ['a', 'b']);
  expect(moved.timeline!.duration).toBe(8);
  expect(moved.timeline!.layers![1].keys.map((k) => [k.frame, k.shapes.length])).toEqual([
    [0, 0],
    [1, 1],
    [3, 0],
  ]);
  expect(moved.timeline!.layers![2].keys[1].shapes[0].fill).toBe('#00ff00');
  expect(moved.timeline!.layers![0].keys.find((k) => k.frame === 2)!.shapes).toEqual([]);
  expect(moved.timeline!.keys.find((k) => k.frame === 2)!.shapes).toEqual([]);
  expect(moved.timeline!.layers![1].keys[1].shapes[0].id).not.toBe(
    moved.timeline!.layers![2].keys[1].shapes[0].id,
  );
  const copied = transferSymbolTracks(d, ['@base', 'source'], 2, 3, 9, false, ['a', 'b']);
  expect(copied.timeline!.duration).toBe(11);
  expect(copied.timeline!.layers![0]).toEqual(d.timeline!.layers![0]);
  for (const routes of [['a'], ['a', 'a'], ['a', 'missing']])
    expect(() => transferSymbolTracks(d, ['@base', 'source'], 2, 3, 1, true, routes)).toThrow();
  expect(d).toEqual(before);
  d.timeline!.layers![2].locked = true;
  expect(() => transferSymbolTracks(d, ['@base', 'source'], 2, 3, 1, true, ['a', 'b'])).toThrow(
    'unlocked',
  );
});

it('swaps selected symbol spans from snapshots and rejects uncleared destination paint', () => {
  const d = definition();
  d.timeline!.layers = [
    {
      id: 'other',
      name: 'Other',
      visible: true,
      locked: false,
      keys: [{ frame: 0, shapes: [art('#00ff00')] }],
    },
  ];
  const before = structuredClone(d);
  const swapped = transferSymbolTracks(d, ['@base', 'other'], 2, 3, 2, true, ['other', '@base']);
  expect(swapped.timeline!.keys.find((k) => k.frame === 2)!.shapes[0].fill).toBe('#00ff00');
  expect(swapped.timeline!.layers![0].keys.find((k) => k.frame === 2)!.shapes[0].fill).toBe(
    '#0000ff',
  );
  expect(swapped.timeline!.keys.find((k) => k.frame === 4)!.shapes[0].fill).toBe('#0000ff');
  expect(swapped.timeline!.layers![0].keys.find((k) => k.frame === 4)!.shapes[0].fill).toBe(
    '#00ff00',
  );
  expect(swapped.timeline!.duration).toBe(8);
  expect(() =>
    transferSymbolTracks(d, ['@base', 'other'], 2, 3, 3, true, ['other', '@base']),
  ).toThrow('artwork');
  expect(() =>
    transferSymbolTracks(d, ['@base', 'other'], 2, 3, 2, false, ['other', '@base']),
  ).toThrow('artwork');
  expect(d).toEqual(before);
});

it('reverses clipped symbol holds and blanks without moving outside timing or identities', () => {
  const d = definition(),
    before = structuredClone(d);
  d.buttonStates = { up: 0, over: 2, down: 3, hit: 4 };
  const reversed = reverseSymbolFrames(d, '@base', 1, 6);
  expect(reversed.timeline?.duration).toBe(8);
  expect(reversed.timeline?.keys.map((k) => k.frame)).toEqual([1, 3, 6, 7]);
  expect(reversed.timeline?.keys.map((k) => k.shapes[0]?.fill ?? null)).toEqual([
    null,
    '#0000ff',
    '#ff0000',
    null,
  ]);
  expect(reversed.timeline?.keys[1].shapes).toEqual(d.timeline?.keys[0].shapes);
  expect(reversed.buttonStates).toEqual(d.buttonStates);
  expect(d.timeline).toEqual(before.timeline);
  expect(reverseSymbolFrames(d, '@base', 2, 2)).toEqual(d);
  const full = reverseSymbolFrames(d, '@base', 0, 7);
  expect(full.shapes).toEqual([]);
  expect(full.timeline!.keys.at(-1)?.shapes).toEqual(d.shapes);
  expect(() => reverseSymbolFrames(d, '@base', -1, 2)).toThrow('frame range');
  expect(() => reverseSymbolFrames(d, 'missing', 1, 2)).toThrow('visible unlocked');
});

it('reverses checked tracks atomically while retaining unchecked artwork and fixed button mappings', () => {
  const d = definition();
  d.buttonStates = { up: 0, over: 2, down: 4, hit: 7 };
  d.timeline!.layers = [
    {
      id: 'other',
      name: 'Other',
      visible: true,
      locked: false,
      keys: [
        { frame: 0, shapes: [art('#00ff00')] },
        { frame: 3, shapes: [] },
      ],
    },
    {
      id: 'untouched',
      name: 'Untouched',
      visible: true,
      locked: true,
      keys: [{ frame: 0, shapes: [] }],
    },
  ];
  const before = structuredClone(d);
  const result = editSymbolTracks(d, ['other', '@base'], 1, 6, 'reverse');
  expect(result.timeline?.duration).toBe(8);
  expect(result.timeline?.keys).toEqual(reverseSymbolFrames(d, '@base', 1, 6).timeline?.keys);
  expect(result.timeline?.layers?.[0].keys.map((k) => k.frame)).toEqual([0, 1, 5, 7]);
  expect(result.timeline?.layers?.[0].keys[1].shapes).toEqual([]);
  expect(result.timeline?.layers?.[0].keys[2].shapes).toEqual(
    d.timeline?.layers?.[0].keys[0].shapes,
  );
  expect(result.timeline?.layers?.[1]).toEqual(d.timeline?.layers?.[1]);
  expect(result.buttonStates).toEqual(d.buttonStates);
  expect(() => editSymbolTracks(d, ['other', 'untouched'], 1, 6, 'reverse')).toThrow('unlocked');
  expect(editSymbolTracks(d, ['other', '@base'], 0, 7, 'reverse').shapes).toEqual([]);
  expect(() => editSymbolTracks(d, ['other', 'other'], 1, 6, 'reverse')).toThrow('distinct');
  expect(d).toEqual(before);
});

it('atomically swaps initial Artwork even when its new exposure is blank', () => {
  const d = definition();
  d.buttonStates = { up: 0, over: 2, down: 4, hit: 7 };
  d.timeline!.layers = [
    {
      id: 'other',
      name: 'Other',
      visible: true,
      locked: false,
      keys: [{ frame: 0, shapes: [art('#00ff00')] }],
    },
  ];
  const before = structuredClone(d);
  const swapped = transferSymbolTracks(d, ['@base', 'other'], 0, 3, 0, true, ['other', '@base']);
  expect(swapped.shapes[0].fill).toBe('#00ff00');
  expect(swapped.timeline!.layers![0].keys.map((k) => [k.frame, k.shapes[0]?.fill])).toEqual([
    [0, '#ff0000'],
    [2, '#0000ff'],
    [4, '#00ff00'],
  ]);
  expect(swapped.timeline!.keys.map((k) => [k.frame, k.shapes[0]?.fill])).toEqual([
    [4, '#0000ff'],
    [5, undefined],
  ]);
  expect(swapped.buttonStates).toEqual(d.buttonStates);
  expect(swapped.timeline!.duration).toBe(8);
  const extended = transferSymbolTracks(d, ['@base', 'other'], 0, 3, 8, true);
  expect(extended.shapes).toEqual([]);
  expect(extended.timeline!.keys.find(key => key.frame === 8)?.shapes).toEqual(d.shapes);
  d.timeline!.layers![0].keys[0].shapes = [];
  expect(transferSymbolTracks(d, ['@base', 'other'], 0, 3, 0, true, ['other', '@base']).shapes)
    .toEqual([]);
  d.timeline!.layers![0] = structuredClone(before.timeline!.layers![0]);
  d.timeline!.layers![0].locked = true;
  expect(() =>
    transferSymbolTracks(d, ['@base', 'other'], 0, 3, 0, true, ['other', '@base']),
  ).toThrow('unlocked');
  d.timeline!.layers![0].locked = false;
  expect(d).toEqual(before);
});

it('retimes symbol holds and blanks without changing initial artwork, state mappings or source', () => {
  const d = definition();
  d.buttonStates = { up: 0, over: 2, down: 4, hit: 7 };
  const before = structuredClone(d);
  const expanded = retimeSymbolTracks(d, ['@base'], 1, 6, 12);
  expect(d).toEqual(before);
  expect(expanded.shapes).toEqual(d.shapes);
  expect(expanded.buttonStates).toEqual(d.buttonStates);
  expect(expanded.timeline!.duration).toBe(14);
  expect(expanded.timeline!.keys.map((k) => k.frame)).toEqual([1, 3, 9, 13]);
  expect(expanded.timeline!.keys[0].shapes).toEqual(d.shapes);
  expect(expanded.timeline!.keys[2].shapes).toEqual([]);
  const compressed = retimeSymbolTracks(expanded, ['@base'], 1, 12, 6);
  expect(compressed.timeline!.duration).toBe(14);
  expect(compressed.timeline!.keys.map((k) => k.frame)).toEqual([1, 2, 5, 7, 8]);
  expect(compressed.buttonStates).toEqual(d.buttonStates);
  expect(compressed.shapes).toEqual(d.shapes);
});
it('retimes symbol batches once and rejects protected, hidden, missing or collapsing tracks atomically', () => {
  const d = definition();
  d.timeline!.layers = [
    {
      id: 'other',
      name: 'Other',
      visible: true,
      locked: false,
      keys: [
        { frame: 0, shapes: [art('#00ff00')] },
        { frame: 1, shapes: [] },
      ],
    },
  ];
  const before = structuredClone(d);
  expect(() => retimeSymbolTracks(d, ['@base', 'other'], 0, 7, 4)).toThrow('collapse');
  expect(d).toEqual(before);
  const expanded = retimeSymbolTracks(d, ['@base', 'other'], 0, 7, 16);
  expect(expanded.timeline!.duration).toBe(16);
  expect(expanded.timeline!.keys.map((k) => k.frame)).toEqual([4, 10]);
  expect(expanded.timeline!.layers![0].keys.map((k) => k.frame)).toEqual([0, 2]);
  const single = retimeSymbolTracks(d, ['@base'], 0, 7, 16);
  expect(single.timeline!.layers).toEqual(d.timeline!.layers);
  for (const ids of [[], ['missing'], ['@base', '@base']])
    expect(() => retimeSymbolTracks(d, ids, 0, 7, 16)).toThrow();
  for (const length of [0, 1.5, NaN, Infinity, 10001])
    expect(() => retimeSymbolTracks(d, ['@base'], 0, 7, length)).toThrow();
  d.timeline!.layers![0].locked = true;
  expect(() => retimeSymbolTracks(d, ['@base', 'other'], 0, 7, 16)).toThrow('unlocked');
  d.timeline!.layers![0].locked = false;
  d.timeline!.layers![0].visible = false;
  expect(() => retimeSymbolTracks(d, ['@base', 'other'], 0, 7, 16)).toThrow('visible');
  d.shapes = [];
  const retimedBlank = retimeSymbolTracks(d, ['@base'], 0, 7, 16);
  expect(retimedBlank.shapes).toEqual([]);
  expect(retimedBlank.timeline!.keys[0].frame).toBe(4);
});
it('retimes static symbol artwork and preserves the duration bound and no-op shape', () => {
  const d = definition();
  delete d.timeline;
  expect(retimeSymbolTracks(d, ['@base'], 0, 0, 1)).toEqual(d);
  const result = retimeSymbolTracks(d, ['@base'], 0, 0, 10000);
  expect(result.timeline).toEqual({ duration: 10000, keys: [] });
  expect(result.shapes).toEqual(d.shapes);
  expect(() => retimeSymbolTracks(result, ['@base'], 0, 0, 2)).toThrow('10000');
});

it('materializes symbol holds with fixed mappings and atomic protected-track rejection', () => {
  const d = definition();
  d.buttonStates = { up: 0, over: 2, down: 5, hit: 0 };
  const before = structuredClone(d),
    next = editSymbolTracks(d, ['@base'], 1, 6, 'keys');
  expect(next.timeline!.keys.map((k) => k.frame)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(next.timeline!.keys[0].shapes).toEqual(d.shapes);
  expect(next.timeline!.keys.at(-1)!.shapes).toEqual([]);
  expect(next.buttonStates).toEqual(d.buttonStates);
  expect(next.shapes).toEqual(d.shapes);
  expect(d).toEqual(before);
  expect(editSymbolTracks(next, ['@base'], 1, 6, 'keys')).toEqual(next);
  d.timeline!.layers = [
    { id: 'locked', name: 'Locked', locked: true, visible: true, keys: [{ frame: 0, shapes: [] }] },
  ];
  const snapshot = structuredClone(d);
  expect(() => editSymbolTracks(d, ['@base', 'locked'], 1, 6, 'keys')).toThrow('unlocked');
  expect(d).toEqual(snapshot);
  const staticDef = { ...definition(), timeline: undefined };
  expect(editSymbolTracks(staticDef, ['@base'], 0, 0, 'keys')).toEqual(staticDef);
});


it('routes adjacent symbol recipes onto fresh artwork and shifts destination ownership only once', () => {
  const d=definition();
  d.timeline={duration:14,keys:[4,8].map(frame=>({frame,shapes:[{...art('#ff0000'),x:frame*5}]})),
    layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys:[0,4,8].map(frame=>({frame,shapes:[{...art('#00ff00'),y:frame*3}]}))}]};
  d.buttonStates={up:0,over:1,down:3,hit:4};
  let source=d;
  for (const [a,b] of [[0,4],[4,8]]) source=editSymbolBasicMotionSpan(source,['@base','extra'],a,b,'create','linear');
  const original=structuredClone(source);
  const clip=copySymbolTracks(source,['@base','extra'],0,8,[source]);
  const captured=structuredClone(clip);
  expect(()=>insertSymbolTracks(source,4,clip,['extra','@base'],[source])).toThrow('inside a remembered');
  const result=insertSymbolTracks(source,0,clip,['extra','@base'],[source]);
  expect(result.buttonStates).toEqual(source.buttonStates);
  expect(result.timeline!.duration).toBe(23);
  const tracks=symbolLayers(result);
  for(const [i,layer] of tracks.entries()){
    expect(layer.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8],[9,13],[13,17]]);
    expect(layer.motionSpans![2].id).toBe(symbolLayers(source)[i].motionSpans![0].id);
    const pasted=layer.keys[0].shapes[0], from=symbolLayers(source)[1-i].keys[0].shapes[0];
    expect(pasted.fill).toBe(from.fill);
    expect(pasted.id).not.toBe(from.id);
    expect(pasted.groups).not.toEqual(from.groups);
    for (const span of layer.motionSpans!) expect(JSON.parse(span.baseline)).toEqual(layer.keys.filter(k=>k.frame>span.start&&k.frame<span.end));
    const refreshed=editSymbolBasicMotionSpan(result,[layer.id],0,4,'refresh','linear');
    expect(symbolLayers(refreshed)).toEqual(tracks);
  }
  expect(tracks[0].keys[0].shapes[0].id).not.toBe(tracks[1].keys[0].shapes[0].id);
  expect(source).toEqual(original);
  expect(clip).toEqual(captured);
});

it('rejects stale clip artwork and aggregate overflow without changing the symbol', () => {
  const d=definition();
  d.timeline={duration:8,keys:[{frame:4,shapes:[{...d.shapes[0],x:30}]}]};
  const source=editSymbolBasicMotionSpan(d,['@base'],0,4,'create','linear');
  const original=structuredClone(source), clip=copySymbolFrames(source,'@base',0,4);
  const large={id:'large',name:'large',width:20,height:20,shapes:Array(MAX_SYMBOL_ARTWORK-8).fill(art('#00ff00'))};
  expect(()=>insertSymbolFrames(source,'@base',8,clip,[source,large])).toThrow('artwork budget');
  clip.keys[2].shapes[0].x++;
  expect(()=>insertSymbolFrames(source,'@base',8,clip)).toThrow('Generated keys changed');
  expect(copySymbolFrames(source,'@base',1,3).motionSpans).toBeUndefined();
  expect(source).toEqual(original);
});


it('cuts complete recipes across symbol tracks and preserves both neighboring junctions', () => {
  const d=definition();
  const keys=[0,3,6,9].map(frame=>({frame,shapes:[{...art('#ff0000'),x:frame*5}]}));
  d.shapes=keys[0].shapes;
  d.timeline={duration:11,keys:keys.slice(1),layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys}]};
  d.buttonStates={up:0,over:2,down:7,hit:9};
  let source=d;
  for(const [a,b] of [[0,3],[3,6],[6,9]]) source=editSymbolBasicMotionSpan(source,['@base','extra'],a,b,'create','linear');
  const original=structuredClone(source);
  const cut=cutSymbolTracks(source,['@base','extra'],3,6);
  expect(source).toEqual(original);
  expect(cut.definition.buttonStates).toEqual(source.buttonStates);
  for (const [i,l] of symbolLayers(cut.definition).entries()){
    const old=symbolLayers(source)[i];
    expect(l.keys).toEqual([...old.keys.slice(0,4),{frame:4,shapes:[]},...old.keys.slice(6)]);
    expect(l.motionSpans).toEqual([old.motionSpans![0],old.motionSpans![2]]);
    expect(cut.clipboard.tracks[i].clip.motionSpans![0].id).toBe(old.motionSpans![1].id);
  }
  const head = cutSymbolTracks(source,['extra','@base'],0,3);
  expect(head.definition.shapes).toEqual([]);
  expect(head.clipboard.tracks.map(t => t.clip.keys[0].shapes)).toEqual([keys[0].shapes, keys[0].shapes]);
  source.timeline!.layers![0].keys[4].shapes[0].x++;
  const stale=structuredClone(source);
  expect(()=>cutSymbolTracks(source,['@base','extra'],3,6)).toThrow('Generated keys changed');
  expect(source).toEqual(stale);
});

it('removes the final base recipe without restoring it from the old symbol timeline', () => {
  const d=definition();
  d.timeline={duration:8,keys:[2,6].map(frame=>({frame,shapes:[{...art('#ff0000'),x:frame*4}]}))};
  const source=editSymbolBasicMotionSpan(d,['@base'],2,6,'create','in');
  const cut=cutSymbolTracks(source,['@base'],2,6);
  expect(cut.definition.timeline!.motionSpans).toBeUndefined();
  expect(cut.definition.timeline!.keys).toEqual([{frame:2,shapes:[]},{...source.timeline!.keys.at(-1)!,frame:7}]);
  const pasted=insertSymbolFrames(cut.definition,'@base',8,cut.clipboard.tracks[0].clip);
  expect(pasted.timeline!.motionSpans![0]).toMatchObject({start:8,end:12,ease:'in'});
  expect(pasted.timeline!.keys.at(-1)!.shapes[0].id).not.toBe('art');
  expect(source.timeline!.motionSpans).toHaveLength(1);
});


it('duplicates complete symbol recipes on two tracks, with fresh artwork and independently refreshable ownership', () => {
  const d=definition(), keys=[0,2,5,8,11,14].map(frame=>({frame,shapes:[{...art('#ff0000'),x:frame*4}]}));
  d.shapes=keys[0].shapes;
  d.buttonStates={up:0,over:3,down:6,hit:14};
  d.timeline={duration:16,keys:keys.slice(1),layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys}]};
  let source=d;
  const ids=['@base','extra'];
  for(const [a,b] of [[2,5],[5,8],[11,14]]) source=editSymbolBasicMotionSpan(source,ids,a,b,'create','out');
  const before=structuredClone(source), result=editSymbolTracks(source,ids,2,8,'duplicate',[source]);
  expect(result.timeline!.duration).toBe(23);
  expect(result.buttonStates).toEqual(source.buttonStates);
  expect(result.shapes).toEqual(source.shapes);
  for(const [i,l] of symbolLayers(result).entries()){
    const old=symbolLayers(source)[i];
    expect(l.motionSpans!.map(s=>[s.start,s.end])).toEqual([[2,5],[5,8],[9,12],[12,15],[18,21]]);
    expect(l.motionSpans!.slice(0,2)).toEqual(old.motionSpans!.slice(0,2));
    expect(l.motionSpans![4].id).toBe(old.motionSpans![2].id);
    const copy=l.keys.find(k=>k.frame===9)!.shapes[0];
    expect(copy.id).not.toBe(old.keys[1].shapes[0].id);
    expect(copy.groups).not.toEqual(old.keys[1].shapes[0].groups);
  }
  const refreshed=editSymbolBasicMotionSpan(result,ids,9,12,'refresh','linear',[result]);
  expect(symbolLayers(refreshed)).toEqual(symbolLayers(result));
  expect(source).toEqual(before);
});

it('rejects a later-track shared junction when fresh identities cannot anchor the displaced recipe', () => {
  const d=definition(), keys=[0,4,8].map(frame=>({frame,shapes:[{...art('#ff0000'),x:frame}]}));
  d.shapes=keys[0].shapes;
  d.timeline={duration:10,keys:keys.slice(1),layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys}]};
  const ids=['@base','extra'];
  let source=editSymbolBasicMotionSpan(d,ids,0,4,'create','in');
  source=editSymbolBasicMotionSpan(source,['extra'],4,8,'create','out');
  const before=structuredClone(source);
  expect(()=>editSymbolTracks(source,ids,0,4,'duplicate',[source])).toThrow('inside a remembered');
  expect(source).toEqual(before);
  const partial=duplicateSymbolFrames(source,'@base',2,4,[source]);
  expect(partial.timeline!.motionSpans).toEqual(source.timeline!.motionSpans);
  expect(partial.timeline!.layers).toEqual(source.timeline!.layers);
  const full={id:'other',name:'Other',width:20,height:20,shapes:Array(MAX_SYMBOL_ARTWORK).fill(art('#ff0000'))};
  expect(()=>duplicateSymbolFrames(source,'@base',2,4,[source,full])).toThrow('artwork budget');
  expect(source).toEqual(before);
});

it('rejects removal across a stale additional track before publishing any shifted recipes', () => {
  const d = definition();
  const keys = [0, 2, 5, 8, 11].map(frame => ({frame, shapes:[{...art('#ff0000'), x:frame}]}));
  d.shapes = keys[0].shapes;
  d.timeline = {duration:13, keys:keys.slice(1), layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys}]};
  const ids = ['@base', 'extra'];
  let source = editSymbolBasicMotionSpan(d, ids, 2, 5, 'create', 'out');
  source = editSymbolBasicMotionSpan(source, ids, 8, 11, 'create', 'in');
  const result = editSymbolTracks(source, ids, 2, 5, 'remove', [source]);
  expect(editSymbolBasicMotionSpan(result, ids, 4, 7, 'refresh', 'linear', [result])).toEqual(result);
  source.timeline!.layers![0].keys.find(key => key.frame === 3)!.shapes[0].x++;
  const before = structuredClone(source);
  expect(() => editSymbolTracks(source, ids, 2, 5, 'remove', [source])).toThrow('Generated keys changed');
  expect(source).toEqual(before);
});

it('counts the restored boundary hold against artwork capacity for standalone removal and reversal', () => {
  const d = definition();
  const pose = Array.from({length:100}, (_, i) => ({...art('#ff0000'), id:String(i)}));
  d.shapes = pose;
  d.timeline = {duration:1004, keys:Array.from({length:999}, (_, i) => ({frame:i+4, shapes:pose}))};
  expect(() => removeSymbolFrames(d, '@base', 1, 2)).toThrow('artwork budget');
  expect(() => reverseSymbolFrames(d, '@base', 1, 2)).toThrow('artwork budget');
  expect(d.timeline.keys[0].frame).toBe(4);
  expect(d.timeline.keys.length * pose.length + d.shapes.length).toBe(MAX_SYMBOL_ARTWORK);
});

it('reverses isolated motion on both tracks and rejects edited interiors on a later track', () => {
  const d = definition(), ids = ['@base', 'extra'];
  const keys = [0,2,5,9].map(frame => ({frame, shapes:[{...art('#ff0000'),x:frame*8}]}));
  d.shapes = keys[0].shapes;
  d.timeline = {duration:12,keys:keys.slice(1),layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys}]};
  d.buttonStates = {up:0,over:3,down:7,hit:11};
  let source = editSymbolBasicMotionSpan(d,ids,2,5,'create','linear');
  source = editSymbolBasicMotionSpan(source,ids,5,9,'create','in');
  const result = editSymbolTracks(source,ids,2,9,'reverse',[source]);
  expect(result.buttonStates).toEqual(source.buttonStates);
  expect(result.shapes).toEqual(source.shapes);
  for (const [i, layer] of symbolLayers(result).entries()) {
    const original = symbolLayers(source)[i];
    expect(layer.motionSpans!.map(span => [span.start,span.end,span.ease,span.id])).toEqual([
      [2,6,'out',original.motionSpans![1].id],[6,9,'linear',original.motionSpans![0].id],
    ]);
  }
  source.timeline!.layers![0].keys.find(key => key.frame === 3)!.shapes[0].x++;
  const stale = structuredClone(source);
  expect(() => editSymbolTracks(source,ids,2,9,'reverse',[source])).toThrow('Generated keys changed');
  expect(source).toEqual(stale);
});

it('rejects edits whose restored hold exceeds capacity across the symbol library', () => {
  const owner = definition();
  owner.timeline = {duration:4,keys:[]};
  const artwork = Array.from({length:100}, (_, i) => ({...art('#ff0000'), id:String(i)}));
  const sibling = {
    ...definition(), id:'sibling', shapes:artwork.slice(1),
    timeline:{duration:1000, keys:Array.from({length:999}, (_, i) => ({frame:i+1, shapes:artwork}))},
  };
  const before = structuredClone(owner);
  expect(reverseSymbolFrames(owner,'@base',1,2,[owner]).timeline!.keys).toHaveLength(2);
  expect(() => reverseSymbolFrames(owner,'@base',1,2,[owner,sibling])).toThrow('symbol artwork budget');
  expect(() => clearSymbolFrames(owner,'@base',1,2,[owner,sibling])).toThrow('symbol artwork budget');
  expect(() => transferSymbolFrames(owner,'@base',1,2,'@base',4,true,[owner,sibling])).toThrow('symbol artwork budget');
  expect(owner).toEqual(before);
});

it('clears only the middle symbol recipe across tracks and keeps both adjacent spans refreshable', () => {
  const d = definition(), ids = ['@base','extra'];
  const keys = [0,3,6,9].map(frame => ({frame,shapes:[{...art('#ff0000'),x:frame*8}]}));
  d.shapes = keys[0].shapes;
  d.timeline = {duration:12,keys:keys.slice(1),layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys}]};
  let source = d;
  for (const [a,b] of [[0,3],[3,6],[6,9]]) source = editSymbolBasicMotionSpan(source,ids,a,b,'create','linear');
  const stored = structuredClone(source);
  const cleared = editSymbolTracks(source,ids,3,6,'clear',[source]);
  for (const [i,track] of symbolLayers(cleared).entries()) {
    const prior = symbolLayers(source)[i];
    expect(track.keys).toEqual([...prior.keys.slice(0,4),{frame:4,shapes:[]},...prior.keys.slice(6)]);
    expect(track.motionSpans).toEqual([prior.motionSpans![0],prior.motionSpans![2]]);
  }
  for (const [a,b] of [[0,3],[6,9]])
    expect(editSymbolBasicMotionSpan(cleared,ids,a,b,'refresh','linear',[cleared])).toEqual(cleared);
  const routed = transferSymbolFrames(source,'extra',3,6,'@base',12,true);
  const incoming = routed.timeline!.motionSpans!.at(-1)!;
  expect(incoming).toMatchObject({id:source.timeline!.layers![0].motionSpans![1].id,start:12,end:15});
  expect(routed.timeline!.keys.find(k => k.frame===12)!.shapes[0].id).not.toBe(keys[1].shapes[0].id);
  expect(editSymbolBasicMotionSpan(routed,['@base'],12,15,'refresh','linear',[routed])).toEqual(routed);
  const moved = transferSymbolTracks(source,ids,3,6,14,true,ids,[source]);
  expect(moved.timeline!.duration).toBe(18);
  for (const [i,layer] of symbolLayers(moved).entries()) {
    const prior = symbolLayers(source)[i];
    expect(layer.keys.filter(k => k.frame < 12)).toEqual(symbolLayers(cleared)[i].keys);
    expect(layer.keys.find(k => k.frame === 12)!.shapes).toEqual([]);
    expect(layer.keys.slice(-4)).toEqual(prior.keys.slice(3,7).map(k => ({...k,frame:k.frame+11})));
    expect(layer.motionSpans!.at(-1)).toMatchObject({id:prior.motionSpans![1].id,start:14,end:17});
  }
  expect(editSymbolBasicMotionSpan(moved,ids,14,17,'refresh','linear',[moved])).toEqual(moved);
  expect(source).toEqual(stored);
  source.timeline!.layers![0].keys.find(key => key.frame === 4)!.shapes[0].x++;
  const stale = structuredClone(source);
  expect(() => transferSymbolTracks(source,ids,3,6,14,true,ids,[source])).toThrow('Generated keys changed');
  expect(() => editSymbolTracks(source,ids,3,6,'clear',[source])).toThrow('Generated keys changed');
  expect(source).toEqual(stale);
});

it('moves a remembered span backward into a blank hold and preserves both outside exposures', () => {
  const d = definition();
  d.timeline = {duration:16,keys:[
    {frame:1,shapes:[]},
    ...[8,12].map(frame => ({frame,shapes:[{...art('#00aa00'),x:frame}]})),
  ]};
  const source = editSymbolBasicMotionSpan(d,['@base'],8,12,'create','out');
  const layer = symbolLayers(source)[0], before = structuredClone(source);
  expect(() => transferSymbolFrames(source,'@base',9,11,'@base',2,true,[source])).toThrow('complete remembered');
  const result = transferSymbolFrames(source,'@base',8,12,'@base',2,true,[source]);
  const moved = symbolLayers(result)[0];
  expect(result.timeline!.duration).toBe(16);
  expect(moved.keys.filter(k => k.frame >= 2 && k.frame <= 6)).toEqual(
    layer.keys.filter(k => k.frame >= 8).map(k => ({...k,frame:k.frame-6})),
  );
  expect(moved.keys.filter(k => k.frame >= 7)).toEqual([
    {frame:7,shapes:[]},{frame:8,shapes:[]},{frame:13,shapes:layer.keys.at(-1)!.shapes},
  ]);
  expect(moved.motionSpans![0]).toMatchObject({id:layer.motionSpans![0].id,start:2,end:6,ease:'out'});
  expect(source).toEqual(before);
});

it('swaps initial remembered symbol ranges from snapshots and rebases both remapped baselines', () => {
  const owner = definition(), ids = ['@base','extra'], routes = ['extra','@base'];
  owner.timeline = {duration:10,keys:[{frame:4,shapes:[{...art('#ff0000'),x:40}]}],
    layers:[{id:'extra',name:'Extra',visible:true,locked:false,keys:[0,4].map(frame => ({
      frame,shapes:[{...art('#00ff00'),x:frame*20}],
    }))}]};
  owner.buttonStates = {up:0,over:2,down:4,hit:8};
  const source = editSymbolBasicMotionSpan(owner,ids,0,4,'create','out');
  const before = structuredClone(source);
  const swapped = transferSymbolTracks(source,ids,0,4,0,true,routes,[source]);
  expect(swapped.buttonStates).toEqual(source.buttonStates);
  for (const [i,layer] of symbolLayers(swapped).entries()) {
    const from = symbolLayers(source)[1-i], original = symbolLayers(source)[i];
    const first = layer.keys[0].shapes[0];
    expect(first.fill).toBe(from.keys[0].shapes[0].fill);
    expect(first.id).not.toBe(from.keys[0].shapes[0].id);
    expect(first.groups).not.toEqual(from.keys[0].shapes[0].groups);
    expect(layer.motionSpans![0].id).toBe(from.motionSpans![0].id);
    expect(layer.keys[5]).toEqual({frame:5,shapes:original.keys[4].shapes});
    for (const key of layer.keys.slice(0,5)) expect(key.shapes[0]).toMatchObject({id:first.id,groups:first.groups});
  }
  expect(editSymbolBasicMotionSpan(swapped,ids,0,4,'refresh','linear',[swapped])).toEqual(swapped);
  const copied = transferSymbolTracks(source,ids,0,4,10,false,routes,[source]);
  expect(copied.timeline!.motionSpans![1].id).not.toBe(source.timeline!.layers![0].motionSpans![0].id);
  expect(source).toEqual(before);
  source.timeline!.layers![0].motionSpans![0].id = source.timeline!.motionSpans![0].id;
  const collision = structuredClone(source);
  expect(() => transferSymbolFrames(source,'extra',0,4,'@base',10,true,[source])).toThrow('recipe ID');
  expect(source).toEqual(collision);
});

it('rejects a later routed destination and an over-budget standalone source before publishing', () => {
  const owner = definition();
  const empty = {id:'empty',name:'Empty',visible:true,locked:false,keys:[{frame:0,shapes:[]}]};
  owner.timeline = {duration:12,keys:[{frame:4,shapes:[art('#ff0000')]}],layers:[
    {...empty,id:'extra',keys:[0,4].map(frame => ({frame,shapes:[{...art('#00ff00'),x:frame}]}))},
    empty,{...empty,id:'occupied',keys:[{frame:0,shapes:[art('#0000ff')]}]},
  ]};
  const ids = ['@base','extra'];
  const source = editSymbolBasicMotionSpan(owner,ids,0,4,'create','linear');
  const original = structuredClone(source);
  expect(() => transferSymbolTracks(source,ids,0,4,6,false,['empty','occupied'],[source])).toThrow('contains artwork');
  expect(source).toEqual(original);
  const tooLarge = {...definition(), shapes:Array(MAX_SYMBOL_ARTWORK).fill(art('#ff0000'))};
  expect(() => transferSymbolFrames(tooLarge,'@base',2,3,'@base',8,true)).toThrow('artwork budget');
});

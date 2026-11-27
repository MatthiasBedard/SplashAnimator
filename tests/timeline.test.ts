import { createBasicMotionSpan, refreshBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { it, expect } from 'vitest';
import {
  newProject,
  clone,
  keyAt,
  newLayer,
  type Vector,
  validateProject,
} from '../packages/document/src';
import {
  insertRootKey,
  editRootExposure,
  editFrameRange,
  editLayerFrameRanges,
  retimeLayerFrameRanges,
  copyLayerFrames,
  cutLayerFrames,
  pasteLayerFrames,
  moveLayerFrames,
  transferLayerFrames,
  transferFrameTracks,
  transferFrameBlock,
  adjacentKey,
  copyFrames,
  clearFrames,
  pasteFrames,
  moveFrames,
} from '../packages/animation/src/timeline';
const shape = (name: string): Vector => ({
  id: name,
  kind: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
const setup = () => {
  const p = newProject();
  p.duration = 10;
  p.layers[0].keys = [
    { frame: 0, shapes: [shape('a')] },
    { frame: 3, shapes: [] },
    { frame: 5, shapes: [shape('b')] },
  ];
  p.layers.push(newLayer('other'));
  return p;
};
it('duplicates a held exposure range with internal blank keys and restores the following hold', () => {
  const p = setup(),
    other = clone(p.layers[1]);
  editFrameRange(p, p.layers[0].id, 1, 4, 'duplicate');
  expect(p.duration).toBe(14);
  expect(p.layers[1]).toEqual(other);
  expect(Array.from({ length: 14 }, (_, f) => keyAt(p.layers[0], f).shapes[0]?.id ?? '-')).toEqual([
    'a',
    'a',
    'a',
    '-',
    '-',
    'a',
    'a',
    '-',
    '-',
    'b',
    'b',
    'b',
    'b',
    'b',
  ]);
  validateProject(p);
});
it('removes an active layer range preserving the following exposure and blanking the tail', () => {
  const p = setup(),
    other = clone(p.layers[1]);
  editFrameRange(p, p.layers[0].id, 1, 3, 'remove');
  expect(p.duration).toBe(10);
  expect(p.layers[1]).toEqual(other);
  expect(Array.from({ length: 10 }, (_, f) => keyAt(p.layers[0], f).shapes[0]?.id ?? '-')).toEqual([
    'a',
    '-',
    'b',
    'b',
    'b',
    'b',
    'b',
    '-',
    '-',
    '-',
  ]);
  validateProject(p);
  editFrameRange(p, p.layers[0].id, 0, 9, 'remove');
  expect(p.layers[0].keys).toEqual([{ frame: 0, shapes: [] }]);
  validateProject(p);
});
it('removes the selected timeline tail without adding a replacement blank key', () => {
  const project = newProject();
  project.duration = 8;
  const layer = project.layers[0];
  layer.keys = [{ frame: 0, shapes: [shape('art')] }, { frame: 4, shapes: [] }];

  editLayerFrameRanges(project, [layer.id], 4, 7, 'remove');

  expect(project.duration).toBe(4);
  expect(layer.keys).toEqual([{ frame: 0, shapes: [shape('art')] }]);
  validateProject(project);
});
it('trims only as far as unaffected keys, absolute cues and audio allow', () => {
  const project = newProject();
  project.duration = 16;
  const [layer] = project.layers;
  const other = newLayer('Keep these keys');
  other.keys.push({ frame: 7, shapes: [shape('keep')] });
  project.layers.push(other);
  project.frameScripts = [{ frame: 8, source: 'state.cue = true;' }];
  project.frameComments = [{ frame: 9, text: 'Keep this cue' }];
  project.assets = [{ id: 'sound', path: 'assets/audio/sound.wav', audio: {
    name: 'Sound', format: 'pcm16-wav', sampleRate: 48000, channels: 1, frames: 12000,
  } }];
  project.audioClips = [{ id: 'clip', assetId: 'sound', startFrame: 6, offsetSamples: 0, gain: 1 }];
  const before = clone(project);

  editLayerFrameRanges(project, [layer.id], 4, 15, 'remove');

  expect(project.duration).toBe(12);
  expect(project.layers[1]).toEqual(before.layers[1]);
  expect(project.frameScripts).toEqual(before.frameScripts);
  expect(project.frameComments).toEqual(before.frameComments);
  expect(project.audioClips).toEqual(before.audioClips);
  delete project.audioClips;
  editLayerFrameRanges(project, [layer.id], 4, 11, 'remove');
  expect(project.duration).toBe(10);
  validateProject(project);
});
it('rejects locked, invalid and excessive edits without changing the project and navigates keys', () => {
  const p = setup();
  expect(adjacentKey(p.layers[0], 4, -1)).toBe(3);
  expect(adjacentKey(p.layers[0], 4, 1)).toBe(5);
  expect(adjacentKey(p.layers[0], 9, 1)).toBe(9);
  p.layers[0].locked = true;
  const before = clone(p);
  expect(() => editFrameRange(p, p.layers[0].id, 0, 1, 'remove')).toThrow();
  expect(p).toEqual(before);
  p.layers[0].locked = false;
  expect(() => editFrameRange(p, p.layers[0].id, -1, 1, 'remove')).toThrow();
  p.duration = 100000;
  const large = clone(p);
  expect(() => editFrameRange(p, p.layers[0].id, 0, 1, 'duplicate')).toThrow();
  expect(p).toEqual(large);
});

it('frame clipboard is immutable and insertion preserves surrounding exposures', () => {
  const p = setup(),
    l = p.layers[0],
    clip = copyFrames(l, 1, 4);
  clearFrames(l, 1, 4, p.duration);
  expect(keyAt(l, 0).shapes[0].id).toBe('a');
  expect(keyAt(l, 1).shapes).toEqual([]);
  expect(keyAt(l, 5).shapes[0].id).toBe('b');
  pasteFrames(p, l.id, 2, clip);
  expect(p.duration).toBe(14);
  expect(keyAt(l, 2).shapes[0].id).toBe('a');
  expect(keyAt(l, 4).shapes).toEqual([]);
  expect(keyAt(l, 9).shapes[0].id).toBe('b');
  l.keys.find((k) => k.frame === 2)!.shapes[0].fill = '#000000';
  expect(clip.keys[0].shapes[0].fill).toBe('#ff0000');
  validateProject(p);
});
it('range moves reject occupied destinations atomically and preserve overlapping source exposures', () => {
  const p = setup(),
    l = p.layers[0],
    before = clone(p);
  expect(() => moveFrames(p, l.id, 0, 1, 5)).toThrow('artwork');
  expect(p).toEqual(before);
  moveFrames(p, l.id, 0, 2, 1);
  expect(keyAt(l, 0).shapes).toEqual([]);
  expect(keyAt(l, 3).shapes[0].id).toBe('a');
  expect(keyAt(l, 4).shapes).toEqual([]);
  expect(keyAt(l, 5).shapes[0].id).toBe('b');
  validateProject(p);
  moveFrames(p, l.id, 1, 3, 12);
  expect(p.duration).toBe(15);
  expect(keyAt(l, 10).shapes).toEqual([]);
  expect(keyAt(l, 12).shapes[0].id).toBe('a');
  validateProject(p);
});

it('edits multiple layer exposures against one time base with independent artwork', () => {
  for (const action of ['duplicate', 'remove', 'clear'] as const) {
    const p = setup();
    p.layers[1].keys = [
      { frame: 0, shapes: [shape('other')] },
      { frame: 6, shapes: [] },
    ];
    p.layers.push(newLayer('untouched'));
    const original = clone(p),
      expected = clone(p);
    for (const layer of expected.layers.slice(0, 2)) {
      const one = clone(original);
      if (action === 'clear')
        clearFrames(
          one.layers.find((l) => l.id === layer.id)!,
          1,
          4,
          one.duration,
        );
      else editFrameRange(one, layer.id, 1, 4, action);
      layer.keys = one.layers.find((l) => l.id === layer.id)!.keys;
    }
    expected.duration = action === 'duplicate' ? 14 : 10;
    editLayerFrameRanges(p, [p.layers[0].id, p.layers[1].id, p.layers[0].id], 1, 4, action);
    expect(p).toEqual(expected);
    validateProject(p);
    p.layers[0].keys[0].shapes[0].fill = '#ffffff';
    expect(original.layers[0].keys[0].shapes[0].fill).toBe('#ff0000');
  }
});
it('rejects a whole layer batch for locked/missing layers, invalid ranges and duration limits', () => {
  const p = setup();
  p.layers[1].locked = true;
  const before = clone(p);
  for (const action of ['duplicate', 'remove', 'clear'] as const) {
    expect(() =>
      editLayerFrameRanges(
        p,
        p.layers.map((l) => l.id),
        1,
        4,
        action,
      ),
    ).toThrow();
    expect(p).toEqual(before);
    expect(() => editLayerFrameRanges(p, [p.layers[0].id, 'missing'], 1, 4, action)).toThrow();
    expect(() => editLayerFrameRanges(p, [p.layers[0].id], -1, 4, action)).toThrow();
    expect(p).toEqual(before);
  }
  p.duration = 100000;
  const full = clone(p);
  expect(() => editLayerFrameRanges(p, [p.layers[0].id], 1, 4, 'duplicate')).toThrow();
  expect(p).toEqual(full);
});

it('multi-layer clipboard is immutable, restores original layer identities and inserts time once', () => {
  const p = setup();
  p.layers[1].keys = clone(p.layers[0].keys);
  const original = clone(p),
    ids = p.layers.map((l) => l.id);
  const clip = copyLayerFrames(p, ids, 1, 4),
    saved = clone(clip);
  editLayerFrameRanges(p, ids, 1, 4, 'clear');
  p.layers.reverse();
  pasteLayerFrames(p, 2, clip);
  expect(p.duration).toBe(14);
  for (const layer of p.layers) {
    const expected = clone(original);
    clearFrames(
      expected.layers.find((l) => l.id === layer.id)!,
      1,
      4,
      10,
    );
    pasteFrames(expected, layer.id, 2, clip.tracks.find((t) => t.layerId === layer.id)!.clip);
    expect(layer.keys).toEqual(expected.layers.find((l) => l.id === layer.id)!.keys);
  }
  expect(clip).toEqual(saved);
  validateProject(p);
  const before = clone(p);
  expect(() => pasteLayerFrames(p, 0, { ...clip, projectId: 'other' })).toThrow();
  expect(() =>
    pasteLayerFrames(p, 0, { ...clip, tracks: [...clip.tracks, clip.tracks[0]] }),
  ).toThrow();
  p.layers[0].locked = true;
  const locked = clone(p);
  expect(() => pasteLayerFrames(p, 0, clip)).toThrow();
  expect(p).toEqual(locked);
  p.layers[0].locked = false;
  expect(p).toEqual(before);
});
it('multi-layer moves reject later occupied tracks atomically and preserve holds when extending', () => {
  const p = setup(),
    ids = p.layers.map((l) => l.id);
  p.layers[0].keys = [
    { frame: 0, shapes: [shape('first')] },
    { frame: 2, shapes: [] },
  ];
  p.layers[1].keys = [{ frame: 0, shapes: [shape('second')] }];
  const original = clone(p);
  expect(() => moveLayerFrames(p, ids, 0, 1, 5)).toThrow('Destination contains artwork');
  expect(p).toEqual(original);
  moveLayerFrames(p, ids, 0, 1, 12);
  expect(p.duration).toBe(14);
  for (const layer of p.layers) {
    expect(keyAt(layer, 0).shapes).toEqual([]);
    expect(keyAt(layer, 11).shapes).toEqual([]);
    expect(keyAt(layer, 12).shapes[0].id).toBe(layer.id === ids[0] ? 'first' : 'second');
  }
  validateProject(p);
});

it('cross-layer copy and move preserve exposure timing, groups and unrelated artwork', () => {
  for (const action of ['copy', 'move'] as const) {
    const p = setup(),
      source = p.layers[0],
      target = p.layers[1];
    source.keys[0].shapes[0].groups = ['group'];
    target.keys = [
      { frame: 0, shapes: [] },
      { frame: 8, shapes: [shape('existing')] },
    ];
    const original = clone(source);
    transferLayerFrames(p, source.id, target.id, 1, 4, 3, action);
    expect(p.duration).toBe(10);
    expect(keyAt(target, 3).shapes[0].id).not.toBe('a');
    expect(keyAt(target, 3).shapes[0].groups).not.toEqual(['group']);
    expect(keyAt(target, 5).shapes).toEqual([]);
    expect(keyAt(target, 7).shapes).toEqual([]);
    expect(keyAt(target, 8).shapes[0].id).toBe('existing');
    if (action === 'copy') expect(source).toEqual(original);
    else {
      expect(keyAt(source, 1).shapes).toEqual([]);
      expect(keyAt(source, 5).shapes[0].id).toBe('b');
    }
    validateProject(p);
  }
});
it('cross-layer transfers reject occupied spans and incompatible/locked targets atomically', () => {
  const p = setup(),
    [source, target] = p.layers;
  target.keys = [
    { frame: 0, shapes: [] },
    { frame: 5, shapes: [shape('obstacle')] },
  ];
  let before = clone(p);
  expect(() => transferLayerFrames(p, source.id, target.id, 0, 2, 4, 'move')).toThrow(
    'Destination contains artwork',
  );
  expect(p).toEqual(before);
  target.locked = true;
  before = clone(p);
  expect(() => transferLayerFrames(p, source.id, target.id, 0, 2, 0, 'move')).toThrow();
  expect(p).toEqual(before);
  target.locked = false;
  target.drawingMode = 'merge';
  before = clone(p);
  expect(() => transferLayerFrames(p, source.id, target.id, 0, 2, 0, 'copy')).toThrow(
    'same drawing mode',
  );
  expect(p).toEqual(before);
  target.drawingMode = 'object';
  transferLayerFrames(p, source.id, target.id, 0, 1, 12, 'copy');
  expect(p.duration).toBe(14);
  expect(keyAt(target, 11).shapes).toEqual([]);
  expect(keyAt(target, 12).shapes).toHaveLength(1);
  validateProject(p);
});

it('frame dragging rejects grouped artwork on a Merge Drawing destination atomically', () => {
  const p = setup();
  const [source, target] = p.layers;
  source.keys[0].shapes[0].groups = ['original-group'];
  target.drawingMode = 'merge';
  const before = clone(p);
  expect(() => transferFrameBlock(p, [{ sourceId: source.id, targetId: target.id }], 0, 0, 1))
    .toThrow('Move it to an Object Drawing layer');
  expect(p).toEqual(before);
});

it('mapped frame tracks commit together with a shared duration and reject conflicting mappings', () => {
  const p = setup();
  p.layers[1].keys = clone(p.layers[0].keys);
  p.layers.push(newLayer('dest1'), newLayer('dest2'));
  const mappings = [
    { sourceId: p.layers[0].id, targetId: p.layers[2].id },
    { sourceId: p.layers[1].id, targetId: p.layers[3].id },
  ];
  p.layers[3].keys = [{ frame: 0, shapes: [shape('occupied')] }];
  let before = clone(p);
  expect(() => transferFrameTracks(p, mappings, 0, 1, 4, 'move')).toThrow(
    'Destination contains artwork',
  );
  expect(p).toEqual(before);
  p.layers[3].keys = [{ frame: 0, shapes: [] }];
  before = clone(p);
  expect(() =>
    transferFrameTracks(
      p,
      [mappings[0], { ...mappings[1], targetId: mappings[0].targetId }],
      0,
      1,
      4,
      'copy',
    ),
  ).toThrow('unique destination');
  expect(() =>
    transferFrameTracks(
      p,
      [{ ...mappings[0], targetId: mappings[1].sourceId }, mappings[1]],
      0,
      1,
      4,
      'move',
    ),
  ).toThrow('separate');
  expect(p).toEqual(before);
  // Restore fixture for the independent batch; no aliasing with the snapshot.
  const next = clone(before);
  transferFrameTracks(next, mappings, 0, 1, 12, 'move');
  expect(next.duration).toBe(14);
  for (const layer of next.layers.slice(0, 2)) expect(keyAt(layer, 0).shapes).toEqual([]);
  for (const layer of next.layers.slice(2)) {
    expect(keyAt(layer, 11).shapes).toEqual([]);
    expect(keyAt(layer, 12).shapes).toHaveLength(1);
  }
  expect(before.layers[0].keys[0].shapes).toHaveLength(1);
  validateProject(next);
});

it('swaps occupied track ranges from original snapshots and rejects locked cycles atomically', () => {
  const p = setup();
  p.layers[1].keys = [{ frame: 0, shapes: [shape('second')] }];
  const before = clone(p),
    mappings = [
      { sourceId: p.layers[0].id, targetId: p.layers[1].id },
      { sourceId: p.layers[1].id, targetId: p.layers[0].id },
    ];
  p.layers[1].locked = true;
  const locked = clone(p);
  expect(() => transferFrameTracks(p, mappings, 0, 1, 0, 'swap')).toThrow('locked');
  expect(p).toEqual(locked);
  p.layers[1].locked = false;
  expect(() => transferFrameTracks(p, mappings, 0, 1, 3, 'swap')).toThrow('source frame');
  expect(p).toEqual(before);
  transferFrameTracks(p, mappings, 0, 1, 0, 'swap');
  expect(keyAt(p.layers[0], 0).shapes.map((s) => ({ ...s, id: '' }))).toEqual(
    keyAt(before.layers[1], 0).shapes.map((s) => ({ ...s, id: '' })),
  );
  expect(keyAt(p.layers[1], 0).shapes.map((s) => ({ ...s, id: '' }))).toEqual(
    keyAt(before.layers[0], 0).shapes.map((s) => ({ ...s, id: '' })),
  );
  expect(keyAt(p.layers[0], 2).shapes).toEqual(keyAt(before.layers[0], 2).shapes);
  expect(keyAt(p.layers[1], 2).shapes).toEqual(keyAt(before.layers[1], 2).shapes);
  expect(p.duration).toBe(before.duration);
  validateProject(p);
});

it('rotates three occupied tracks without cascading the first source into every target', () => {
  const p = setup();
  p.layers.push(newLayer('third'));
  p.layers.forEach((layer, i) => {
    layer.keys = [{ frame: 0, shapes: [{ ...shape('shape' + i), x: i * 20 }] }];
  });
  const before = clone(p);
  const mappings = p.layers.map((layer, i) => ({
    sourceId: layer.id,
    targetId: p.layers[(i + 1) % 3].id,
  }));
  transferFrameTracks(p, mappings, 2, 4, 2, 'swap');
  expect(p.layers.map((layer) => keyAt(layer, 2).shapes[0].x)).toEqual([40, 0, 20]);
  expect(p.layers.map((layer) => keyAt(layer, 1).shapes[0].x)).toEqual([0, 20, 40]);
  expect(p.layers.map((layer) => keyAt(layer, 5).shapes[0].x)).toEqual([0, 20, 40]);
  expect(before.layers.map((layer) => keyAt(layer, 2).shapes[0].x)).toEqual([0, 20, 40]);
  validateProject(p);
});

it('reverses clipped main timeline exposures atomically across checked layers', () => {
  const p = newProject();
  p.duration = 8;
  p.layers[0].keys = [
    { frame: 0, shapes: [shape('a')] },
    { frame: 2, shapes: [shape('b')] },
    { frame: 5, shapes: [] },
  ];
  const other = newLayer('Other');
  other.keys = [
    { frame: 0, shapes: [shape('c')] },
    { frame: 3, shapes: [] },
  ];
  const protectedLayer = newLayer('Protected');
  protectedLayer.locked = true;
  p.layers.push(other, protectedLayer);
  const before = clone(p);
  expect(() =>
    editLayerFrameRanges(p, [p.layers[0].id, protectedLayer.id], 1, 6, 'reverse'),
  ).toThrow('unlocked');
  expect(p).toEqual(before);
  editLayerFrameRanges(p, [p.layers[0].id, other.id], 1, 6, 'reverse');
  expect(p.duration).toBe(8);
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 3, 6, 7]);
  expect(p.layers[0].keys.map((k) => k.shapes[0]?.id ?? null)).toEqual(['a', null, 'b', 'a', null]);
  expect(p.layers[1].keys.map((k) => k.frame)).toEqual([0, 1, 5, 7]);
  expect(p.layers[2]).toEqual(before.layers[2]);
  const reversed = clone(p);
  editFrameRange(p, p.layers[0].id, 2, 2, 'reverse');
  expect(p).toEqual(reversed);
  expect(() => editFrameRange(p, p.layers[0].id, 1, 8, 'reverse')).toThrow('Invalid');
  validateProject(p);
});

it('retimes clipped holds and blank keys while preserving identities and following artwork', () => {
  const p = setup(),
    original = clone(p);
  retimeLayerFrameRanges(p, [p.layers[0].id], 1, 6, 12);
  expect(p.duration).toBe(16);
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 5, 9, 13]);
  expect(p.layers[0].keys[1].shapes).toEqual(original.layers[0].keys[0].shapes);
  expect(keyAt(p.layers[0], 8).shapes).toEqual([]);
  expect(keyAt(p.layers[0], 13).shapes[0].id).toBe('b');
  expect(p.layers[1]).toEqual(original.layers[1]);
  retimeLayerFrameRanges(p, [p.layers[0].id], 1, 12, 6);
  expect(p.duration).toBe(16);
  for (let frame = 0; frame < 10; frame++)
    expect(keyAt(p.layers[0], frame).shapes).toEqual(keyAt(original.layers[0], frame).shapes);
  expect(keyAt(p.layers[0], 10).shapes).toEqual([]);
  validateProject(p);
});
it('rejects collapsed keys and protected or invalid retiming batches atomically', () => {
  const p = setup();
  p.layers[1].keys = [
    { frame: 0, shapes: [] },
    { frame: 1, shapes: [shape('c')] },
  ];
  const original = clone(p),
    ids = p.layers.map((l) => l.id);
  expect(() => retimeLayerFrameRanges(p, ids, 0, 5, 3)).toThrow('collapse');
  expect(p).toEqual(original);
  p.layers[1].locked = true;
  const locked = clone(p);
  expect(() => retimeLayerFrameRanges(p, ids, 0, 5, 12)).toThrow('unlocked');
  expect(p).toEqual(locked);
  for (const length of [0, -1, NaN, Infinity, 2.5, 100001])
    expect(() => retimeLayerFrameRanges(p, [ids[0]], 0, 5, length)).toThrow();
  expect(p).toEqual(locked);
});
it('retimes checked tracks on one time base including the final exposure', () => {
  const p = setup(),
    ids = p.layers.map((l) => l.id);
  p.layers[1].keys = clone(p.layers[0].keys);
  retimeLayerFrameRanges(p, [...ids, ids[0]], 0, 9, 20);
  expect(p.duration).toBe(20);
  expect(p.layers.map((l) => l.keys.map((k) => k.frame))).toEqual([
    [0, 6, 10],
    [0, 6, 10],
  ]);
  retimeLayerFrameRanges(p, ids, 0, 19, 10);
  expect(p.duration).toBe(20);
  expect(p.layers.map((l) => l.keys.map((k) => k.frame))).toEqual([
    [0, 3, 5, 10],
    [0, 3, 5, 10],
  ]);
  validateProject(p);
});

it('keys every frame across holds and blanks without moving following keys or sharing artwork', () => {
  const p = newProject();
  p.duration = 10;
  p.layers[0].keys = [
    { frame: 0, shapes: [shape('a')] },
    { frame: 3, shapes: [] },
    { frame: 6, shapes: [shape('b')] },
  ];
  const before = clone(p);
  editLayerFrameRanges(p, [p.layers[0].id], 1, 4, 'keys');
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 2, 3, 4, 6]);
  expect(p.layers[0].keys[1].shapes).toEqual(before.layers[0].keys[0].shapes);
  expect(p.layers[0].keys[4].shapes).toEqual([]);
  p.layers[0].keys[1].shapes[0].x = 123;
  expect(p.layers[0].keys[0].shapes).toEqual(before.layers[0].keys[0].shapes);
  expect(p.duration).toBe(10);
  const protectedLayer = newLayer('Protected');
  protectedLayer.locked = true;
  p.layers.push(protectedLayer);
  const snapshot = clone(p);
  expect(() =>
    editLayerFrameRanges(p, [p.layers[0].id, protectedLayer.id], 0, 7, 'keys'),
  ).toThrow();
  expect(p).toEqual(snapshot);
});

it('clears held artwork only outside every bound lifetime and restores the adjacent exposure', () => {
  const p = setup(), [first, second] = p.layers;
  second.keys[0].shapes = [shape('bound')];
  p.opacityBindings = [{layerId:second.id, shapeId:'bound', start:2, end:4,
    keys:[{frame:3, opacity:0.5}]}];
  const original = clone(p);
  const ids = [first.id,second.id];
  expect(() => editLayerFrameRanges(p,ids,1,2,'clear')).toThrow('uniquely');
  expect(p).toEqual(original);
  editLayerFrameRanges(p,ids,0,1,'clear');
  expect(keyAt(second,1).shapes).toEqual([]);
  expect(keyAt(second,2).shapes).toEqual(original.layers[1].keys[0].shapes);
  expect(p.opacityBindings).toEqual(original.opacityBindings);
  expect(p.duration).toBe(original.duration);
  validateProject(p);
});

it('rejects invalid original bound artwork even if clearing would remove the invalid exposure', () => {
  const p = setup(), layer = p.layers[0];
  p.opacityBindings = [{layerId:layer.id, shapeId:'a', start:0, end:1,keys:[{frame:0,opacity:1}]}];
  layer.keys[2].shapes[0].x = Infinity;
  const original = structuredClone(p);
  expect(() => editLayerFrameRanges(p,[layer.id],5,9,'clear')).toThrow();
  expect(p).toEqual(original);
});


it('validates the held exposure after a blank key before publishing any keys', () => {
  const p = setup(), l = p.layers[0];
  p.opacityBindings = [{layerId:l.id, shapeId:'b', start:7, end:9, keys:[{frame:7,opacity:1}]}];
  const before = clone(p);
  for (const frame of [5,6,8]) {
    expect(() => insertRootKey(p,l.id,frame,true)).toThrow('uniquely');
    expect(p).toEqual(before);
  }
  insertRootKey(p,l.id,7);
  expect(keyAt(l,7).shapes).toEqual(keyAt(l,5).shapes);
  insertRootKey(p,l.id,0,true);
  expect(keyAt(l,0).shapes).toEqual([]);
  expect(p.opacityBindings).toEqual(before.opacityBindings);
});

it('rejects shifted, replaced and invalid pasted artwork atomically on bound layers', () => {
  const p = setup(), l = p.layers[0];
  p.opacityBindings = [{layerId:l.id,shapeId:'b',start:5,end:6,keys:[{frame:5,opacity:0.4}]}];
  const before = clone(p);
  for (const [at, art] of [[3,shape('a')],[5,{...shape('b'),kind:'ellipse'}],
    [8,{...shape('other'),opacity:NaN}]] as const) {
    const clip = {duration:2,keys:[{frame:0,shapes:[art]}]};
    expect(() => pasteFrames(p,l.id,at,clip)).toThrow();
    expect(p).toEqual(before);
  }
  const clip = copyFrames(l,0,0);
  pasteFrames(p,l.id,8,clip);
  expect(keyAt(l,8).shapes).toEqual(clip.keys[0].shapes);
  expect(keyAt(l,9).shapes).toEqual(before.layers[0].keys[2].shapes);
  expect(p.opacityBindings).toEqual(before.opacityBindings);
  expect(p.duration).toBe(11);
});


it('does not shift an opacity interval onto a disconnected lifetime reusing the same ID', () => {
  const p = setup(), l = p.layers[0];
  l.keys[0].shapes = [shape('b')];
  p.opacityBindings = [{layerId:l.id,shapeId:'b',start:5,end:6,keys:[{frame:5,opacity:0.4}]}];
  const original = clone(p);
  const clip = {duration:5,keys:[{frame:0,shapes:[]}]};
  expect(() => pasteFrames(p,l.id,0,clip)).toThrow('uniquely');
  expect(p).toEqual(original);
});


for (const action of ['insert-frame','remove-key'] as const) {
  it(action + ' checks the original symbol identity when a whole opacity interval is replaced', () => {
    const p = setup(), layer = p.layers[0];
    p.symbols = ['first','second'].map(id => ({id,name:id,width:10,height:10,shapes:[shape('inner')]}));
    const instance = (symbolId: string): Vector => ({...shape('shared'),kind:'symbol',symbolId});
    layer.keys = [{frame:0,shapes:[instance('first')]},{frame:3,shapes:[instance('second')]},
      {frame:6,shapes:[instance('second')]}];
    p.opacityBindings = [{layerId:layer.id,shapeId:'shared',start:3,end:3,keys:[{frame:3,opacity:0.4}]}];
    const original = clone(p);
    expect(() => editRootExposure(p,layer.id,action==='insert-frame'?2:3,action)).toThrow('identity');
    expect(p).toEqual(original);
    editRootExposure(p,layer.id,6,action);
    expect(layer.keys.map(k=>k.frame)).toEqual(action==='insert-frame'?[0,3,6]:[0,3]);
    expect(p.duration).toBe(action==='insert-frame'?11:10);
    expect(p.opacityBindings).toEqual(original.opacityBindings);
    expect(p.layers[1]).toEqual(original.layers[1]);
  });
}

it('allows a previous pose in the same lifetime to take over a bound hold', () => {
  const p = setup(), layer = p.layers[0];
  layer.keys = [{frame:0,shapes:[shape('a')]},{frame:4,shapes:[{...shape('a'),x:50}]}];
  p.opacityBindings = [{layerId:layer.id,shapeId:'a',start:5,end:8,keys:[{frame:7,opacity:0.5}]}];
  editRootExposure(p,layer.id,4,'remove-key');
  expect(keyAt(layer,7).shapes).toEqual([shape('a')]);
  expect(p.duration).toBe(10);
  validateProject(p);
});


it('copies adjacent recipes with relative baselines, shifts later recipes and supports repeated paste', () => {
  const p = newProject(), l = p.layers[0];
  p.duration = 20;
  l.keys = [0,2,6,10,13,17].map(frame=>({frame,shapes:[{...shape('a'),x:frame*2}]}));
  for (const [a,b] of [[2,6],[6,10],[13,17]]) createBasicMotionSpan(p,[l.id],a,b,'in');
  const before = clone(p), clip = copyLayerFrames(p,[l.id],1,10).tracks[0].clip;
  expect(clip.motionSpans!.map(s=>[s.start,s.end])).toEqual([[1,5],[5,9]]);
  const stored = clone(clip);
  pasteFrames(p,l.id,12,clip);
  expect(clip).toEqual(stored);
  expect(l.motionSpans!.map(s=>[s.start,s.end])).toEqual([[2,6],[6,10],[13,17],[17,21],[23,27]]);
  expect(l.motionSpans!.at(-1)!.id).toBe(before.layers[0].motionSpans!.at(-1)!.id);
  for(const span of l.motionSpans!) {
    expect(JSON.parse(span.baseline)).toEqual(l.keys.filter(k=>k.frame>span.start&&k.frame<span.end));
    refreshBasicMotionSpan(p,[l.id],span.start,span.end);
  }
  pasteFrames(p,l.id,p.duration,clip);
  expect(new Set(l.motionSpans!.map(s=>s.id)).size).toBe(7);
  expect(clip).toEqual(stored);
});

it('retains partial-span artwork, rejects stale complete copies and prevents partial multi-track publication', () => {
  const p=setup(),[a,b]=p.layers;
  for (const l of [a,b]) {
    l.keys = [0,4].map(frame=>({frame,shapes:[{...shape('a'),x:frame}]}));
    createBasicMotionSpan(p,[l.id],0,4,'linear');
  }
  b.keys[2].shapes[0].x++;
  const before=clone(p);
  expect(copyLayerFrames(p,[b.id],1,3).tracks[0].clip.motionSpans).toBeUndefined();
  expect(()=>copyLayerFrames(p,[a.id,b.id],0,4)).toThrow('Generated keys changed');
  const clip=copyLayerFrames(p,[a.id,b.id],1,2);
  expect(()=>pasteLayerFrames(p,0,clip)).toThrow('Generated keys changed');
  expect(()=>pasteFrames(p,a.id,4,clip.tracks[0].clip)).toThrow('inside a remembered');
  expect(p).toEqual(before);
  const clean=copyLayerFrames(p,[a.id],0,4).tracks[0].clip;
  clean.keys[0].shapes[0].x++;
  expect(()=>pasteFrames(p,a.id,6,clean)).toThrow('reconstruct');
  expect(p).toEqual(before);
});


it('inserts a copy at a shared endpoint only when its first key preserves the left pose exactly', () => {
  const p=setup(), l=p.layers[0];
  l.keys=[0,4,8].map(frame=>({frame,shapes:[{...shape('a'),x:frame}]}));
  createBasicMotionSpan(p,[l.id],0,4,'in');
  createBasicMotionSpan(p,[l.id],4,8,'out');
  const original=clone(l), clip=copyLayerFrames(p,[l.id],4,8).tracks[0].clip;
  pasteFrames(p,l.id,4,clip);
  expect(l.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[4,8],[9,13]]);
  expect(l.motionSpans![0]).toEqual(original.motionSpans![0]);
  expect(l.motionSpans![2].id).toBe(original.motionSpans![1].id);
  for(const span of l.motionSpans!) refreshBasicMotionSpan(p,[l.id],span.start,span.end);
  expect(l.keys.slice(0,9)).toEqual(original.keys);
});


it('validates original clipboard identities before assigning fresh paste IDs', () => {
  const p=setup(), l=p.layers[0];
  l.keys=[0,4,8].map(frame=>({frame,shapes:[{...shape('a'),x:frame}]}));
  for(const [a,b] of [[0,4],[4,8]]) createBasicMotionSpan(p,[l.id],a,b,'linear');
  const clip=copyLayerFrames(p,[l.id],0,8).tracks[0].clip;
  const original=clone(p);
  clip.motionSpans![1].id=clip.motionSpans![0].id;
  expect(()=>pasteFrames(p,l.id,9,clip)).toThrow('identity');
  expect(p).toEqual(original);
});


it('cuts a complete middle span while preserving both shared endpoints and adjacent recipes', () => {
  const p = setup(), l = p.layers[0];
  p.duration = 15;
  l.keys = [0,4,8,12].map(frame=>({frame,shapes:[{...shape('a'),x:frame*5}]}));
  for (const [a,b] of [[0,4],[4,8],[8,12]]) createBasicMotionSpan(p,[l.id],a,b,'in');
  const original = clone(l);
  const clipboard = cutLayerFrames(p,[l.id],4,8);
  expect(l.motionSpans).toEqual([original.motionSpans![0],original.motionSpans![2]]);
  expect(l.keys).toEqual([...original.keys.slice(0,5),{frame:5,shapes:[]},...original.keys.slice(8)]);
  const clip = clipboard.tracks[0].clip;
  expect(clip.motionSpans).toHaveLength(1);
  expect(clip.keys).toEqual(original.keys.slice(4,9).map(k=>({...k,frame:k.frame-4})));
  refreshBasicMotionSpan(p,[l.id],0,4);
  refreshBasicMotionSpan(p,[l.id],8,12);
  pasteLayerFrames(p,15,clipboard);
  const restored = l.motionSpans!.at(-1)!;
  expect(restored.id).not.toBe(original.motionSpans![1].id);
  refreshBasicMotionSpan(p,[l.id],restored.start,restored.end);
  expect(l.keys.filter(k=>k.frame>=15)).toEqual(clip.keys.map(k=>({...k,frame:k.frame+15})));
});

for (const operation of ['cut','clear'] as const) for (const problem of ['partial','stale','opacity'] as const)
  it(`rejects a multi-track ${operation} without writes when a later track is ${problem}`, () => {
    const p=setup(), [a,b]=p.layers;
    for (const l of [a,b]) {
      const finish = l===b && problem==='partial' ? 6 : 4;
      l.keys=[0,finish].map(frame=>({frame,shapes:[{...shape('a'),x:frame}]}));
      createBasicMotionSpan(p,[l.id],0,finish,'linear');
    }
    if (problem==='stale') b.keys[1].shapes[0].x++;
    if (problem==='opacity') p.opacityBindings=[{layerId:b.id,shapeId:'a',start:2,end:3,keys:[{frame:2,opacity:1}]}];
    const before = clone(p);
    const edit = () => operation === 'cut' ? cutLayerFrames(p,[a.id,b.id],0,4)
      : editLayerFrameRanges(p,[a.id,b.id],0,4,'clear');
    expect(edit).toThrow();
    expect(p).toEqual(before);
  });

it('cuts the final recipe without shortening the timeline or losing the following held pose', () => {
  const p = setup(), layer = p.layers[0];
  layer.keys = [0,2,6].map(frame=>({frame,shapes:[{...shape('a'),x:frame*4}]}));
  createBasicMotionSpan(p,[layer.id],2,6,'out');
  const before = clone(layer);
  const clip = cutLayerFrames(p,[layer.id],2,6).tracks[0].clip;
  expect(Object.prototype.hasOwnProperty.call(layer,'motionSpans')).toBe(false);
  expect(layer.keys).toEqual([before.keys[0],{frame:2,shapes:[]},{frame:7,shapes:before.keys.at(-1)!.shapes}]);
  expect(clip.motionSpans![0]).toMatchObject({start:0,end:4,ease:'out'});
  expect(p.duration).toBe(10);
});


it('duplicates complete adjacent recipes after their range, shifting a later owned recipe only once', () => {
  const p = setup(), [a,b]=p.layers;
  p.duration=20;
  for(const l of [a,b]) {
    l.keys=[0,2,5,8,12,16].map(frame=>({frame,shapes:[{...shape(l.id),x:frame*4}]}));
    for(const [start,end] of [[2,5],[5,8],[12,16]]) createBasicMotionSpan(p,[l.id],start,end,'out');
  }
  const before=clone(p);
  editLayerFrameRanges(p,[a.id,b.id],2,8,'duplicate');
  expect(p.duration).toBe(27);
  for(const [index,l] of p.layers.entries()){
    const old=before.layers[index];
    expect(l.motionSpans!.map(s=>[s.start,s.end])).toEqual([[2,5],[5,8],[9,12],[12,15],[19,23]]);
    expect(l.motionSpans!.slice(0,2)).toEqual(old.motionSpans!.slice(0,2));
    expect(new Set(l.motionSpans!.map(s=>s.id)).size).toBe(5);
    expect(l.motionSpans![4].id).toBe(old.motionSpans![2].id);
    const generated=clone(l.keys);
    for(const span of l.motionSpans!) refreshBasicMotionSpan(p,[l.id],span.start,span.end);
    expect(l.keys).toEqual(generated);
  }
});

it('duplicates a partial suffix as artwork and rejects a later-track junction conflict atomically', () => {
  const p=setup(),[a,b]=p.layers;
  for(const l of [a,b]){
    l.keys=[0,4,8].map(frame=>({frame,shapes:[{...shape('ink'),x:frame}]}));
    createBasicMotionSpan(p,[l.id],0,4,'linear');
  }
  b.keys=[0,6].map(frame=>({frame,shapes:[{...shape('ink'),x:frame}]}));
  delete b.motionSpans;
  createBasicMotionSpan(p,[b.id],0,6,'in');
  const before=clone(p);
  expect(()=>editLayerFrameRanges(p,[a.id,b.id],2,4,'duplicate')).toThrow('inside a remembered');
  expect(p).toEqual(before);
  editFrameRange(p,a.id,2,4,'duplicate');
  expect(a.motionSpans).toEqual(before.layers[0].motionSpans);
  expect(a.keys.filter(k=>k.frame>=5&&k.frame<=7)).toEqual(before.layers[0].keys.slice(2,5).map(k=>({...k,frame:k.frame+3})));
});


it('duplicates a recipe ending at a shared endpoint and moves the right recipe onto the copied endpoint', () => {
  const p=setup(), l=p.layers[0];
  l.keys=[0,4,8].map(frame=>({frame,shapes:[{...shape('ink'),x:frame*5}]}));
  createBasicMotionSpan(p,[l.id],0,4,'in');
  createBasicMotionSpan(p,[l.id],4,8,'out');
  const before=clone(p), clip=copyLayerFrames(p,[l.id],0,4).tracks[0].clip;
  clip.keys[4].shapes[0].x++;
  expect(()=>pasteFrames(p,l.id,5,clip)).toThrow('inside a remembered');
  expect(p).toEqual(before);
  editFrameRange(p,l.id,0,4,'duplicate');
  expect(l.motionSpans!.map(s=>[s.start,s.end])).toEqual([[0,4],[5,9],[9,13]]);
  expect(l.motionSpans![2].id).toBe(before.layers[0].motionSpans![1].id);
  expect(l.keys[9].shapes).toEqual(before.layers[0].keys[4].shapes);
  const baked=clone(l.keys);
  for(const span of l.motionSpans!) refreshBasicMotionSpan(p,[l.id],span.start,span.end);
  expect(l.keys).toEqual(baked);
});

it('rejects duplication if a later selected layer would lose its opacity target while keys shift', () => {
  const p=setup(), [a,b]=p.layers;
  b.keys=[{frame:0,shapes:[]},{frame:2,shapes:[shape('bound')]}];
  p.opacityBindings=[{layerId:b.id,shapeId:'bound',start:3,end:5,keys:[{frame:4,opacity:0.25}]}];
  const before=clone(p);
  expect(()=>editLayerFrameRanges(p,[a.id,b.id],0,1,'duplicate')).toThrow('uniquely');
  expect(p).toEqual(before);
});

it('removes complete motion on selected tracks and keeps displaced recipes refreshable', () => {
  const p=setup(), [a,b]=p.layers;
  p.duration=18;
  for(const layer of [a,b]) {
    layer.keys=[0,2,6,9,13].map(frame=>({frame,shapes:[{...shape(layer.id),x:frame*3}]}));
    createBasicMotionSpan(p,[layer.id],2,6,'in');
    createBasicMotionSpan(p,[layer.id],9,13,'out');
  }
  p.layers.push(newLayer('untouched'));
  const before=clone(p);
  editLayerFrameRanges(p,[a.id,b.id],2,6,'remove');
  expect(p.duration).toBe(18);
  expect(p.layers[2]).toEqual(before.layers[2]);
  for(const [i,layer] of [a,b].entries()){
    const old=before.layers[i], moved=layer.motionSpans![0];
    expect(layer.motionSpans).toHaveLength(1);
    expect(moved).toMatchObject({id:old.motionSpans![1].id,start:4,end:8,ease:'out'});
    expect(keyAt(layer,2).shapes).toEqual(keyAt(old,7).shapes);
    expect(layer.keys.at(-1)).toEqual({frame:13,shapes:[]});
    const exact=clone(layer.keys);
    refreshBasicMotionSpan(p,[layer.id],4,8);
    expect(layer.keys).toEqual(exact);
  }
});

it('removes a duplicated span at its shared endpoint and restores the right recipe identity', () => {
  const p=setup(), l=p.layers[0];
  l.keys=[0,4,8].map(frame=>({frame,shapes:[{...shape('ink'),x:frame}]}));
  createBasicMotionSpan(p,[l.id],0,4,'linear');
  createBasicMotionSpan(p,[l.id],4,8,'in');
  const original=clone(l);
  editFrameRange(p,l.id,0,4,'duplicate');
  editFrameRange(p,l.id,5,9,'remove');
  expect(l.motionSpans).toEqual(original.motionSpans);
  for(const k of original.keys) expect(keyAt(l,k.frame)).toEqual(k);
  expect(l.keys.at(-1)).toEqual({frame:10,shapes:[]});
});

for (const issue of ['stale','partial','junction','reused opacity ID'] as const)
  it(`rejects a later-track ${issue} before publishing any removal`, () => {
    const p=setup(), [a,b]=p.layers;
    p.duration=14;
    for(const layer of [a,b]){
      layer.keys=[0,2,6,9,13].map(frame=>({frame,shapes:[{...shape('ink'),x:frame}]}));
      createBasicMotionSpan(p,[layer.id],2,6,'linear');
      createBasicMotionSpan(p,[layer.id],9,13,'in');
    }
    if(issue==='stale') b.keys.find(k=>k.frame===10)!.shapes[0].x++;
    if(issue==='partial'){
      b.keys=[0,1,5].map(frame=>({frame,shapes:[{...shape('ink'),x:frame}]}));
      delete b.motionSpans;
      createBasicMotionSpan(p,[b.id],1,5,'in');
    }
    if(issue==='junction') createBasicMotionSpan(p,[b.id],0,2,'linear');
    if(issue==='reused opacity ID'){
      b.keys=[{frame:0,shapes:[shape('ink')]},{frame:4,shapes:[]},{frame:7,shapes:[shape('ink')]}];
      delete b.motionSpans;
      p.opacityBindings=[{layerId:b.id,shapeId:'ink',start:2,end:3,keys:[{frame:3,opacity:0.5}]}];
    }
    const before=clone(p);
    expect(()=>editLayerFrameRanges(p,[a.id,b.id],2,6,'remove')).toThrow();
    expect(p).toEqual(before);
  });

it('retains an exact left endpoint and a continuous absolute opacity interval through removal', () => {
  const p=setup(), layer=p.layers[0], endpoint={...shape('a'),x:40};
  layer.keys=[{frame:0,shapes:[shape('a')]},{frame:4,shapes:[endpoint]},{frame:6,shapes:[clone(endpoint)]}];
  createBasicMotionSpan(p,[layer.id],0,4,'linear');
  p.opacityBindings=[{layerId:layer.id,shapeId:'a',start:3,end:7,keys:[{frame:6,opacity:0.25}]}];
  const before=clone(p);
  editFrameRange(p,layer.id,4,5,'remove');
  expect(layer.motionSpans).toEqual(before.layers[0].motionSpans);
  expect(p.opacityBindings).toEqual(before.opacityBindings);
  expect(layer.keys.find(k=>k.frame===4)).toEqual(before.layers[0].keys.find(k=>k.frame===4));
  expect(layer.keys.at(-1)).toEqual({frame:8,shapes:[]});
  const after=clone(p);
  expect(()=>editFrameRange(p,layer.id,5,7,'remove')).toThrow('blank tail');
  expect(p).toEqual(after);
});

it('regenerates complete motion across a shared junction and rebases the following recipe', () => {
  const p = setup(), layer = p.layers[0];
  p.duration = 16;
  layer.keys = [0,2,6,10,14].map(frame => ({frame, shapes:[{...shape('ink'), x:frame*8}]}));
  for (const [a,b] of [[2,6],[6,10],[10,14]]) createBasicMotionSpan(p,[layer.id],a,b,'in');
  p.opacityBindings = [{layerId:layer.id, shapeId:'ink', start:4, end:11, keys:[{frame:8,opacity:0.5}]}];
  const before = clone(p);
  retimeLayerFrameRanges(p,[layer.id],2,10,5);
  expect(p.duration).toBe(16);
  expect(p.opacityBindings).toEqual(before.opacityBindings);
  expect(layer.motionSpans!.map(s => [s.start,s.end])).toEqual([[2,4],[4,6],[6,10]]);
  expect(layer.motionSpans!.map(s => s.id)).toEqual(before.layers[0].motionSpans!.map(s => s.id));
  expect(keyAt(layer,4).shapes).toEqual(keyAt(before.layers[0],6).shapes);
  expect(layer.keys.at(-1)).toEqual({frame:12,shapes:[]});
  const retimed = clone(layer.keys);
  for (const s of layer.motionSpans!) refreshBasicMotionSpan(p,[layer.id],s.start,s.end);
  expect(layer.keys).toEqual(retimed);
});

it('rejects a stale second motion track and disconnected opacity reuse before a retime publishes', () => {
  const p = setup(), [a,b] = p.layers;
  const ids = [a.id,b.id];
  for (const layer of [a,b]) {
    layer.keys = [0,4,8].map(frame => ({frame, shapes:[{...shape('ink'),x:frame}]}));
    createBasicMotionSpan(p,[layer.id],0,4,'in');
  }
  b.keys[1].shapes[0].x++;
  const stale = clone(p);
  expect(() => retimeLayerFrameRanges(p,ids,0,4,9)).toThrow('Generated keys changed');
  expect(p).toEqual(stale);
  delete b.motionSpans;
  b.keys = [{frame:0,shapes:[shape('ink')]},{frame:3,shapes:[]},{frame:5,shapes:[shape('ink')]}];
  p.opacityBindings = [{layerId:b.id,shapeId:'ink',start:6,end:6,keys:[{frame:6,opacity:1}]}];
  const reused = clone(p);
  expect(() => retimeLayerFrameRanges(p,ids,0,4,15)).toThrow('uniquely');
  expect(p).toEqual(reused);
});

it('reverses enclosed recipes and holds together, preserving shared keys and independent easing', () => {
  const p = setup(), layer = p.layers[0];
  p.duration = 20;
  layer.keys = [0,2,5,9,14].map(frame => ({frame, shapes:[{...shape('ink'),x:frame*8}]}));
  createBasicMotionSpan(p,[layer.id],2,5,'linear');
  createBasicMotionSpan(p,[layer.id],5,9,'in');
  p.opacityBindings = [{layerId:layer.id,shapeId:'ink',start:4,end:7,keys:[{frame:4,opacity:0.5}]}];
  const before = clone(p);
  editFrameRange(p,layer.id,1,12,'reverse');
  expect(layer.motionSpans!.map(s => [s.start,s.end,s.ease,s.id])).toEqual([
    [4,8,'out',before.layers[0].motionSpans![1].id],
    [8,11,'linear',before.layers[0].motionSpans![0].id],
  ]);
  for (let frame=0;frame<p.duration;frame++) {
    const original = frame>=1 && frame<=12 ? 13-frame : frame;
    expect(keyAt(layer,frame).shapes).toEqual(keyAt(before.layers[0],original).shapes);
  }
  expect(p.opacityBindings).toEqual(before.opacityBindings);
  for (const span of layer.motionSpans!) refreshBasicMotionSpan(p,[layer.id],span.start,span.end);
});

for (const issue of ['partial','stale','junction','opacity reuse'] as const)
  it(`rejects a later-track ${issue} atomically when reversing a root range`, () => {
    const p = setup(), [a,b] = p.layers;
    for (const layer of [a,b]) {
      layer.keys = [0,2,6,9].map(frame => ({frame,shapes:[{...shape('ink'),x:frame}]}));
      createBasicMotionSpan(p,[layer.id],2,6,'in');
    }
    if (issue==='partial') {
      delete b.motionSpans;
      b.keys = b.keys.filter(k => [0,2,6,9].includes(k.frame));
      createBasicMotionSpan(p,[b.id],6,9,'in');
    }
    if (issue==='stale') b.keys.find(k => k.frame===3)!.shapes[0].x++;
    if (issue==='junction') createBasicMotionSpan(p,[b.id],0,2,'linear');
    if (issue==='opacity reuse') {
      delete b.motionSpans;
      b.keys = [{frame:0,shapes:[shape('ink')]},{frame:4,shapes:[]},{frame:6,shapes:[shape('ink')]}];
      p.opacityBindings = [{layerId:b.id,shapeId:'ink',start:2,end:2,keys:[{frame:2,opacity:1}]}];
    }
    const before = clone(p);
    expect(() => editLayerFrameRanges(p,[a.id,b.id],2,issue==='partial'?7:6,'reverse')).toThrow();
    expect(p).toEqual(before);
  });

it('keeps a touching outside recipe when the reflected junction is exactly its authored pose', () => {
  const p = setup(), layer = p.layers[0];
  layer.keys = [0,3,7].map(frame => ({frame,shapes:[{...shape('ink'),x:frame===0?0:24}]}));
  createBasicMotionSpan(p,[layer.id],0,3,'linear');
  createBasicMotionSpan(p,[layer.id],3,7,'out');
  const left = clone(layer.motionSpans![0]);
  editFrameRange(p,layer.id,3,7,'reverse');
  expect(layer.motionSpans![0]).toEqual(left);
  expect(layer.motionSpans![1].ease).toBe('in');
  expect(keyAt(layer,3).shapes[0].x).toBe(24);
});

it('restores the graphic exposure age on the first frame outside a reversal', () => {
  const p = setup(), layer = p.layers[0];
  const graphic = {...shape('instance'), kind:'symbol' as const, symbolId:'child'};
  p.symbols = [{id:'child',name:'Child',width:10,height:10,shapes:[shape('first')],
    timeline:{duration:3,keys:[{frame:2,shapes:[shape('third')]}]}}];
  layer.keys = [{frame:0,shapes:[shape('root')]},{frame:2,shapes:[graphic]}];
  editFrameRange(p,layer.id,0,5,'reverse');
  expect(keyAt(layer,6).shapes[0]).toEqual({...graphic,symbolPlayback:{mode:'loop',firstFrame:1}});
  expect(graphic).not.toHaveProperty('symbolPlayback');
});

it('reverses a displaced curved waypoint recipe and rejects mismatched reversed routes', () => {
  const p = setup(), [a,b] = p.layers;
  const path = {startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:16,y:32}]};
  for (const layer of [a,b]) {
    layer.keys = [0,2,6].map(frame => ({frame,shapes:[{...shape('ink'),x:frame*8}]}));
    if (layer === b) for (const key of layer.keys) key.shapes.push({...shape('other'),x:key.frame*4});
    createBasicMotionSpan(p,[layer.id],2,6,'linear',undefined,path);
  }
  const before = clone(p);
  expect(() => editLayerFrameRanges(p,[a.id,b.id],2,8,'reverse')).toThrow('shared endpoint');
  expect(p).toEqual(before);
  editFrameRange(p,a.id,2,8,'reverse');
  expect(a.motionSpans![0]).toMatchObject({start:4,end:8,id:before.layers[0].motionSpans![0].id});
  expect(a.motionSpans![0].path!.waypointIncoming).toHaveLength(1);
  refreshBasicMotionSpan(p,[a.id],4,8);
  for (let frame=4;frame<=8;frame++)
    expect(keyAt(a,frame).shapes[0].x).toBeCloseTo(keyAt(before.layers[0],10-frame).shapes[0].x,11);
});

it('clears a clean middle recipe while both neighbors retain refreshable junctions', () => {
  const p = setup(), layer = p.layers[0];
  p.duration = 15;
  layer.keys = [0,4,8,12].map(frame => ({frame, shapes:[{...shape('ink'),x:frame}]}));
  for (const [a,b] of [[0,4],[4,8],[8,12]]) createBasicMotionSpan(p,[layer.id],a,b,'in');
  const before = clone(p);
  editLayerFrameRanges(p,[layer.id],4,8,'clear');
  expect(layer.motionSpans).toEqual([before.layers[0].motionSpans![0],before.layers[0].motionSpans![2]]);
  expect(layer.keys).toEqual([...before.layers[0].keys.slice(0,5),{frame:5,shapes:[]},...before.layers[0].keys.slice(8)]);
  expect(p.duration).toBe(before.duration);
  expect(p.layers[1]).toEqual(before.layers[1]);
  for (const span of layer.motionSpans!) refreshBasicMotionSpan(p,[layer.id],span.start,span.end);
});

it('rejects an endpoint edit before clearing keys that still match their baseline', () => {
  const p = setup(), layer = p.layers[0];
  layer.keys = [0,4].map(frame => ({frame,shapes:[{...shape('ink'),x:frame}]}));
  createBasicMotionSpan(p,[layer.id],0,4,'out');
  layer.keys[0].shapes[0].x++;
  const before = clone(p);
  expect(() => editLayerFrameRanges(p,[layer.id],0,4,'clear')).toThrow('Refresh remembered motion');
  expect(p).toEqual(before);
});

it('restores graphic playback age beyond newly blank frames', () => {
  const p = setup(), layer = p.layers[0];
  p.symbols = [{id:'child',name:'Child',width:10,height:10,shapes:[shape('first')],
    timeline:{duration:3,keys:[{frame:2,shapes:[shape('last')]}]}}];
  layer.keys = [{frame:0,shapes:[{...shape('instance'),kind:'symbol',symbolId:'child'}]}];
  editLayerFrameRanges(p,[layer.id],1,3,'clear');
  expect(keyAt(layer,3).shapes).toEqual([]);
  expect(keyAt(layer,4).shapes[0].symbolPlayback).toEqual({mode:'loop',firstFrame:1});
  expect(keyAt(layer,0).shapes[0].symbolPlayback).toBeUndefined();
});

it('relocates a middle recipe while keeping both shared endpoints and refreshing the moved keys', () => {
  const p = setup(), layer = p.layers[0];
  p.duration = 16;
  layer.keys = [0,3,6,9].map(frame => ({frame,shapes:[{...shape('ink'),groups:['group'],x:frame*8}]}));
  for (const [a,b] of [[0,3],[3,6],[6,9]]) createBasicMotionSpan(p,[layer.id],a,b,'in');
  const original = clone(layer);
  moveFrames(p,layer.id,3,6,18);
  expect(p.duration).toBe(22);
  expect(layer.keys.filter(k => k.frame<16)).toEqual([...original.keys.slice(0,4),{frame:4,shapes:[]},...original.keys.slice(6)]);
  expect(layer.keys.slice(-4)).toEqual(original.keys.slice(3,7).map(k => ({...k,frame:k.frame+15})));
  expect(layer.motionSpans!.map(s => s.id)).toEqual([original.motionSpans![0].id,original.motionSpans![2].id,original.motionSpans![1].id]);
  const exact = clone(layer.keys);
  for (const s of layer.motionSpans!) refreshBasicMotionSpan(p,[layer.id],s.start,s.end);
  expect(layer.keys).toEqual(exact);
});

for (const issue of ['partial','stale','opacity gap'] as const)
  it(`rejects a later-track ${issue} without publishing any root move`, () => {
    const p = setup(), [a,b] = p.layers;
    for (const layer of [a,b]) {
      layer.keys = [0,issue==='partial' && layer===b ? 6:4].map(frame => ({frame,shapes:[{...shape('ink'),x:frame}]}));
      createBasicMotionSpan(p,[layer.id],0,layer.keys[1].frame,'linear');
      layer.keys.push({frame:7,shapes:[]});
    }
    if (issue==='stale') b.keys[2].shapes[0].x++;
    if (issue==='opacity gap') p.opacityBindings=[{layerId:b.id,shapeId:'ink',start:2,end:4,keys:[{frame:2,opacity:1}]}];
    const before = clone(p);
    expect(() => moveLayerFrames(p,[a.id,b.id],0,4,10)).toThrow();
    expect(p).toEqual(before);
  });

it('checks opacity against both sides of overlapping moves and rejects disconnected ID reuse', () => {
  const p = setup(), layer = p.layers[0];
  layer.keys = [0,2,3,6].map(frame => ({frame,shapes:frame===6?[]:[shape('ink')]}));
  p.opacityBindings=[{layerId:layer.id,shapeId:'ink',start:3,end:3,keys:[{frame:3,opacity:0.5}]}];
  const original = clone(p);
  moveLayerFrames(p,[layer.id],0,5,2);
  expect(p.opacityBindings).toEqual(original.opacityBindings);
  expect(keyAt(layer,3).shapes).toEqual([shape('ink')]);
  original.layers[0].keys[1].shapes=[];
  const snapshot=clone(original);
  expect(() => moveLayerFrames(original,[layer.id],0,5,2)).toThrow('uniquely');
  expect(original).toEqual(snapshot);
});

it('moves an overlapping complete recipe and keeps a continuous absolute opacity interval', () => {
  const p = setup(), layer = p.layers[0];
  layer.keys = [0,4,5].map(frame => ({frame,shapes:frame === 5 ? [] : [{...shape('ink'),x:frame*8}]}));
  createBasicMotionSpan(p,[layer.id],0,4,'out');
  p.opacityBindings = [{layerId:layer.id,shapeId:'ink',start:2,end:4,keys:[{frame:2,opacity:0.5}]}];
  const original = clone(p);
  moveLayerFrames(p,[layer.id],0,4,2);
  expect(layer.keys.filter(key => key.frame>=2 && key.frame<=6)).toEqual(
    original.layers[0].keys.slice(0,5).map(key => ({...key,frame:key.frame+2})),
  );
  expect(layer.motionSpans![0]).toMatchObject({id:original.layers[0].motionSpans![0].id,start:2,end:6});
  expect(p.opacityBindings).toEqual(original.opacityBindings);
  expect(keyAt(layer,7).shapes).toEqual([]);
  const beforeRefresh = clone(layer.keys);
  refreshBasicMotionSpan(p,[layer.id],2,6);
  expect(layer.keys).toEqual(beforeRefresh);
});

it('preserves a held graphic clock at both the move destination and the source restoration', () => {
  const p = setup(), layer = p.layers[0];
  p.symbols = [{id:'graphic',name:'Graphic',width:10,height:10,shapes:[shape('first')],
    timeline:{duration:4,keys:[{frame:2,shapes:[shape('third')]}]}}];
  layer.keys = [{frame:0,shapes:[{...shape('instance'),kind:'symbol',symbolId:'graphic'}]},{frame:6,shapes:[]}];
  moveFrames(p,layer.id,1,2,7);
  expect(keyAt(layer,0).shapes[0].symbolPlayback).toBeUndefined();
  expect(keyAt(layer,3).shapes[0].symbolPlayback).toEqual({mode:'loop',firstFrame:3});
  expect(keyAt(layer,7).shapes[0].symbolPlayback).toEqual({mode:'loop',firstFrame:1});
  expect(keyAt(layer,9).shapes).toEqual([]);
});

for (const action of ['copy','move','swap'] as const)
  it(`routes complete remembered root motion with editable remapped baselines for ${action}`, () => {
    const p = setup(), [a,b] = p.layers;
    p.duration = 14;
    for (const [i,layer] of [a,b].entries()) {
      layer.keys = [0,3,6].map(frame => ({frame,shapes:[{...shape('ink'),groups:['group'],x:i*20+frame}]}));
      createBasicMotionSpan(p,[layer.id],3,6,i===0?'in':'out');
    }
    const before = clone(p), at = action==='swap'?3:14;
    if (action==='swap') transferFrameTracks(p,[{sourceId:a.id,targetId:b.id},{sourceId:b.id,targetId:a.id}],3,6,at,action);
    else transferLayerFrames(p,a.id,b.id,3,6,at,action);
    const moved = b.motionSpans!.find(span => span.start===at)!;
    expect(moved.ease).toBe('in');
    if (action==='copy') {
      expect(moved.id).not.toBe(before.layers[0].motionSpans![0].id);
      expect(a).toEqual(before.layers[0]);
    } else expect(moved.id).toBe(before.layers[0].motionSpans![0].id);
    const first = keyAt(b,at).shapes[0];
    expect(first.id).not.toBe('ink');
    expect(first.groups).not.toEqual(['group']);
    for (let i=0;i<4;i++) expect(keyAt(b,at+i).shapes[0]).toEqual({
      ...keyAt(before.layers[0],3+i).shapes[0],id:first.id,groups:first.groups,
    });
    const exact = clone(b.keys);
    refreshBasicMotionSpan(p,[b.id],at,at+3);
    expect(b.keys).toEqual(exact);
    if (action==='swap') {
      expect(a.motionSpans![0].id).toBe(before.layers[1].motionSpans![0].id);
      expect(keyAt(b,7).shapes).toEqual(keyAt(before.layers[1],7).shapes);
    }
  });

for (const problem of ['stale','opacity','ID collision'] as const)
  it(`rejects a later root transfer with ${problem} without publishing earlier routes`, () => {
    const p = setup(), [a,b] = p.layers;
    p.layers.push(newLayer('First target'),newLayer('Second target'));
    for (const layer of [a,b,p.layers[3]]) {
      layer.keys = [0,3,6].map(frame => ({frame,shapes:[{...shape('ink'),x:frame}]}));
      createBasicMotionSpan(p,[layer.id],3,6,'linear');
    }
    if (problem==='stale') b.keys.find(key => key.frame===4)!.shapes[0].x++;
    if (problem==='opacity') p.opacityBindings=[{layerId:b.id,shapeId:'ink',start:4,end:5,keys:[{frame:4,opacity:1}]}];
    if (problem==='ID collision') p.layers[3].motionSpans![0].id=b.motionSpans![0].id;
    const before = clone(p);
    expect(() => transferFrameTracks(p,[{sourceId:a.id,targetId:p.layers[2].id},{sourceId:b.id,targetId:p.layers[3].id}],3,6,12,'move')).toThrow();
    expect(p).toEqual(before);
  });

it('keeps shared root endpoints and an outside opacity binding when moving the middle recipe to another layer', () => {
  const p = setup(), [source,target] = p.layers;
  p.duration = 14;
  source.keys = [0,3,6,9].map(frame => ({frame,shapes:[{...shape('ink'),x:frame}]}));
  for (const [a,b] of [[0,3],[3,6],[6,9]]) createBasicMotionSpan(p,[source.id],a,b,'linear');
  p.opacityBindings = [{layerId:source.id,shapeId:'ink',start:6,end:9,keys:[{frame:8,opacity:0.5}]}];
  const before = clone(p);
  transferLayerFrames(p,source.id,target.id,3,6,1,'move');
  expect(p.opacityBindings).toEqual(before.opacityBindings);
  expect(source.keys).toEqual([...before.layers[0].keys.slice(0,4),{frame:4,shapes:[]},...before.layers[0].keys.slice(6)]);
  expect(source.motionSpans).toEqual([before.layers[0].motionSpans![0],before.layers[0].motionSpans![2]]);
  expect(target.motionSpans![0]).toMatchObject({id:before.layers[0].motionSpans![1].id,start:1,end:4});
  for (const span of source.motionSpans!) refreshBasicMotionSpan(p,[source.id],span.start,span.end);
  refreshBasicMotionSpan(p,[target.id],1,4);
});

it('copies only enclosed opacity channels to the remapped artwork and detaches cubic easing', () => {
  const p = setup(), [source,target] = p.layers;
  source.keys = [0,2,6].map(frame => ({frame, shapes:[{...shape('ink'),x:frame}]}));
  createBasicMotionSpan(p,[source.id],2,6,'in');
  const curve = {kind:'cubic' as const,x1:0.25,y1:0,x2:0.7,y2:1};
  p.opacityBindings = [
    {layerId:source.id,shapeId:'ink',start:3,end:5,keys:[{frame:3,opacity:0,ease:curve},{frame:5,opacity:1}]},
    {layerId:source.id,shapeId:'ink',start:6,end:6,keys:[{frame:6,opacity:0.2,ease:'hold'}]},
    {layerId:source.id,shapeId:'ink',start:8,end:9,keys:[{frame:9,opacity:0.5}]},
  ];
  const before = clone(p);
  transferLayerFrames(p,source.id,target.id,2,6,10,'copy-with-opacity');
  const newId = keyAt(target,10).shapes[0].id;
  expect(newId).not.toBe('ink');
  expect(target.motionSpans![0]).toMatchObject({start:10,end:14,ease:'in'});
  expect(p.opacityBindings.slice(0,3)).toEqual(before.opacityBindings);
  expect(p.opacityBindings.slice(3)).toEqual(before.opacityBindings!.slice(0,2).map(b => ({
    ...b,layerId:target.id,shapeId:newId,start:b.start+8,end:b.end+8,
    keys:b.keys.map(k => ({...k,frame:k.frame+8})),
  })));
  expect(p.opacityBindings[3].keys[0].ease).not.toBe(curve);
  curve.x1 = 0.9;
  expect(p.opacityBindings[3].keys[0].ease).toMatchObject({x1:0.25});
});

for (const action of ['copy-with-opacity','move-with-opacity'] as const) for (const problem of ['starts before','ends after','occupied target','invalid original'] as const)
  it(`keeps all mapped layers and channels intact when ${action} encounters ${problem}`, () => {
    const p = setup(), [a,b] = p.layers;
    for (const l of [a,b]) l.keys = [{frame:0,shapes:[shape('ink')]}];
    p.layers.push(newLayer('A copy'),newLayer('B copy'));
    p.opacityBindings = [a,b].map(l => ({
      layerId:l.id,shapeId:'ink',start:l===b && problem==='starts before'?1:2,
      end:l===b && problem==='ends after'?6:5,keys:[{frame:3,opacity:1}],
    }));
    if (problem==='occupied target') p.layers[3].keys[0].shapes = [shape('other')];
    if (problem==='invalid original') p.opacityBindings[1].keys[0].opacity = Infinity;
    const before = structuredClone(p);
    expect(() => transferFrameTracks(p,[{sourceId:a.id,targetId:p.layers[2].id},{sourceId:b.id,targetId:p.layers[3].id}],
      2,5,1,action)).toThrow();
    expect(p).toEqual(before);
  });

it('moves complete opacity channels with a middle recipe and retains source junctions and unrelated channels', () => {
  const p = setup(), [source,target] = p.layers;
  p.duration = 12;
  source.keys = [0,3,6,9].map(frame => ({frame,shapes:[{...shape('ink'),x:frame}]}));
  for (const [a,b] of [[0,3],[3,6],[6,9]]) createBasicMotionSpan(p,[source.id],a,b,'out');
  target.keys = [{frame:0,shapes:[shape('other')]},{frame:2,shapes:[]}];
  const curve = {kind:'cubic' as const,x1:0.2,y1:0,x2:0.8,y2:1};
  p.opacityBindings = [
    {layerId:source.id,shapeId:'ink',start:3,end:5,keys:[{frame:3,opacity:0,ease:curve},{frame:5,opacity:0.8}]},
    {layerId:source.id,shapeId:'ink',start:6,end:6,keys:[{frame:6,opacity:1,ease:'hold'}]},
    {layerId:source.id,shapeId:'ink',start:7,end:9,keys:[{frame:8,opacity:0.5}]},
    {layerId:target.id,shapeId:'other',start:0,end:1,keys:[{frame:0,opacity:0.75}]},
  ];
  const before = clone(p);
  transferLayerFrames(p,source.id,target.id,3,6,12,'move-with-opacity');
  const shapeId = keyAt(target,12).shapes[0].id;
  expect(shapeId).not.toBe('ink');
  expect(p.opacityBindings.slice(0,2)).toEqual(before.opacityBindings!.slice(2));
  expect(p.opacityBindings.slice(2)).toEqual(before.opacityBindings!.slice(0,2).map(b => ({
    ...b,layerId:target.id,shapeId,start:b.start+9,end:b.end+9,keys:b.keys.map(k => ({...k,frame:k.frame+9})),
  })));
  expect(p.opacityBindings[2].keys[0].ease).not.toBe(curve);
  expect(source.keys).toEqual([...before.layers[0].keys.slice(0,4),{frame:4,shapes:[]},...before.layers[0].keys.slice(6)]);
  expect(target.motionSpans![0].id).toBe(before.layers[0].motionSpans![1].id);
  refreshBasicMotionSpan(p,[target.id],12,15);
});

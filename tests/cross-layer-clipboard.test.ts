import { expect, it, vi } from 'vitest';
import { newProject, newLayer, type Vector } from '../packages/document/src';
import { multiFrameId } from '../packages/animation/src/multi-frame';
import { copyCurrentLayers, pasteCurrentLayers } from '../apps/editor/src/cross-layer-clipboard';
import { mergeSelectedArtwork } from '../packages/geometry/src/merge-selection';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import type { CrossLayerRebuilder } from '../apps/editor/src/cross-layer-selection';
const rect = (id: string, x = 20): Vector => ({
  id,
  kind: 'rectangle',
  x,
  y: 30,
  width: 20,
  height: 20,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
function fixture(merge = false) {
  const p = newProject();
  p.duration = 10;
  p.layers = ['One', 'Two', 'Hidden', 'Locked'].map((name, i) => ({
    ...newLayer(name),
    id: 'l' + i,
    drawingMode: merge && i < 2 ? ('merge' as const) : ('object' as const),
    visible: i !== 2,
    locked: i === 3,
    keys: [
      { frame: 0, shapes: [rect('same', 20 + i * 60)] },
      { frame: 8, shapes: [] },
    ],
  }));
  return p;
}
const ids = [multiFrameId('l0', 0, 'same'), multiFrameId('l1', 0, 'same')];
const rebuild: CrossLayerRebuilder = async (shapes, selected, curves) =>
  mergeSelectedArtwork(shapes, selected, curves);
it('copies complete original groups detached with original track namespaces and no source writes', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes = [
    { ...rect('same'), groups: ['g'] },
    { ...rect('peer', 50), groups: ['g', 'child'] },
  ];
  const before = structuredClone(p),
    clip = copyCurrentLayers(p, 4, ids);
  expect(clip.tracks.map((t) => [t.layer, t.shapes.map((s) => s.id)])).toEqual([
    ['l0', ['same', 'peer']],
    ['l1', ['same']],
  ]);
  clip.tracks[0].shapes[0].x = 999;
  expect(p).toEqual(before);
});
it('pastes to original held exposures with fresh shape/group identities and complete retained picks', async () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[0].groups = ['g'];
  const clip = copyCurrentLayers(p, 4, ids),
    before = structuredClone({ p, clip }),
    worker = vi.fn(rebuild);
  const result = await pasteCurrentLayers(p, 4, clip, false, { rebuild: worker });
  expect(worker).not.toHaveBeenCalled();
  expect(result.selected).toHaveLength(2);
  for (const [i, l] of result.project.layers.slice(0, 2).entries()) {
    expect(l.keys.map((k) => k.frame)).toEqual([0, 8]);
    expect(l.keys[0].shapes).toHaveLength(2);
    const copy = l.keys[0].shapes[1];
    expect(copy.id).not.toBe('same');
    expect(copy.x).toBe(36 + i * 60);
    expect(copy.y).toBe(46);
    expect(result.selected).toContain(multiFrameId(l.id, 0, copy.id));
    if (!i) expect(copy.groups).not.toEqual(['g']);
    expect(l.keys[0].shapes[0]).toEqual(p.layers[i].keys[0].shapes[0]);
    expect(l.keys[1]).toEqual(p.layers[i].keys[1]);
  }
  expect(result.project.layers.slice(2)).toEqual(p.layers.slice(2));
  result.project.layers[0].keys[0].shapes[1].x = 1000;
  expect({ p, clip }).toEqual(before);
});
it('paste in place follows layer identity after reordering and keeps complete group sharing independent per track', async () => {
  const p = fixture();
  for (const l of p.layers.slice(0, 2)) {
    l.keys[0].shapes[0].groups = ['g'];
    l.keys[0].shapes.push({ ...rect('peer', 90), groups: ['g'] });
  }
  const clip = copyCurrentLayers(p, 0, ids);
  p.layers.reverse();
  p.layers.find((l) => l.id === 'l0')!.name = 'Renamed';
  const result = await pasteCurrentLayers(p, 4, clip, true, { rebuild });
  const groups: string[] = [];
  for (const t of clip.tracks) {
    const l = result.project.layers.find((l) => l.id === t.layer)!;
    const copies = l.keys[0].shapes.slice(2);
    expect(copies.map((s) => s.x)).toEqual(t.shapes.map((s) => s.x));
    expect(copies[0].groups).toEqual(copies[1].groups);
    groups.push(copies[0].groups![0]);
  }
  expect(new Set(groups).size).toBe(2);
});
it('rebuilds only the pasted masked merge component and rejects protected output', async () => {
  const p = fixture(), member = p.layers[2];
  member.visible = true;
  member.drawingMode = 'merge';
  member.keys[0].shapes = [rect('same'), rect('hidden', 150)];
  p.layers[3].keys[0].shapes = [{ ...rect('mask', 22), y: 20, width: 40, height: 70 }];
  p.layerMasks = [{ maskLayerId: 'l3', layerIds: [member.id] }];
  const clip = copyCurrentLayers(p, 4, [ids[0], multiFrameId(member.id, 0, 'same')]);
  const before = structuredClone({ p, clip }), worker = vi.fn(rebuild);
  const pasted = await pasteCurrentLayers(p, 4, clip, false, { rebuild: worker });
  expect(worker).toHaveBeenCalledTimes(1);
  const [input, copies] = worker.mock.calls[0];
  expect(input[0]).toEqual(member.keys[0].shapes[0]);
  expect(input[1].id).toEqual(copies[0]);
  expect(input).toHaveLength(2);
  expect(pasted.project.layers[2].keys[0].shapes.at(-1)).toEqual(member.keys[0].shapes[1]);
  expect(pasted.project.layerMasks).toEqual(p.layerMasks);
  expect(pasted.selected).toHaveLength(2);
  await expect(pasteCurrentLayers(p, 4, clip, false, {
    rebuild: async () => ({ artwork: [{ ...rect('hidden', 28) }], selected: ['hidden'] }),
  })).rejects.toThrow('protected artwork');
  const touched = structuredClone(p);
  touched.layers[2].keys[0].shapes[1].x = 55;
  touched.layers[2].keys[0].shapes[1].strokeWidth = 1;
  worker.mockClear();
  await expect(pasteCurrentLayers(touched, 4, clip, false, { rebuild: worker }))
    .rejects.toThrow('protected artwork');
  expect(worker).not.toHaveBeenCalled();
  expect({ p, clip }).toEqual(before);
});

it('pastes complete masked objects under their original mask and rejects changed or invisible destinations', async () => {
  const p = fixture(), member = p.layers[2];
  member.visible = true;
  member.keys[0].shapes = [
    { ...rect('same'), groups: ['g'] },
    { ...rect('peer'), y: 60, groups: ['g'] },
    rect('hidden', 50),
  ];
  p.layers[3].keys[0].shapes = [{ ...rect('mask', 22), y: 20, width: 5, height: 70 }];
  p.layerMasks = [{ maskLayerId: 'l3', layerIds: [member.id] }];
  const clip = copyCurrentLayers(p, 4, [ids[0], multiFrameId(member.id, 0, 'same')]),
    before = structuredClone({ p, clip }), worker = vi.fn(rebuild);
  expect(clip.tracks[1]).toEqual({ layer: member.id, maskLayer: 'l3', shapes: member.keys[0].shapes.slice(0, 2) });
  const pasted = await pasteCurrentLayers(p, 4, clip, true, { rebuild: worker });
  const copies = pasted.project.layers[2].keys[0].shapes.slice(3);
  expect(copies).toHaveLength(2);
  expect(copies[0].groups).toEqual(copies[1].groups);
  expect(copies[0].groups).not.toEqual(['g']);
  expect(copies.map(s => [s.x, s.y])).toEqual([[20, 30], [20, 60]]);
  expect(pasted.selected).toHaveLength(3);
  expect(pasted.project.layers[2].keys[0].shapes.slice(0, 3)).toEqual(member.keys[0].shapes);
  expect(pasted.project.layers[3]).toEqual(p.layers[3]);
  expect(pasted.project.layerMasks).toEqual(p.layerMasks);
  await expect(pasteCurrentLayers(p, 4, clip, false, { rebuild: worker })).rejects.toThrow('visible beneath');
  const unmasked = structuredClone(p);
  unmasked.layerMasks = [];
  await expect(pasteCurrentLayers(unmasked, 4, clip, true, { rebuild: worker })).rejects.toThrow('original mask groups');
  const shifted = structuredClone(p);
  shifted.layers[3].keys[0].shapes[0].x = 50;
  await expect(pasteCurrentLayers(shifted, 4, clip, true, { rebuild: worker })).rejects.toThrow('visible beneath');
  expect(worker).not.toHaveBeenCalled();
  expect({ p, clip }).toEqual(before);
});

it('pastes into new current keys without rewriting the copied exposure or inventing keys', async () => {
  const p = fixture(),
    clip = copyCurrentLayers(p, 4, ids),
    out = await pasteCurrentLayers(p, 9, clip, true, { rebuild });
  for (const [i, l] of out.project.layers.slice(0, 2).entries()) {
    expect(l.keys.map((k) => k.frame)).toEqual([0, 8]);
    expect(l.keys[0]).toEqual(p.layers[i].keys[0]);
    expect(l.keys[1].shapes).toHaveLength(1);
    expect(l.keys[1].shapes[0].x).toBe(20 + i * 60);
    expect(out.selected).toContain(multiFrameId(l.id, 8, l.keys[1].shapes[0].id));
  }
});
it('merges every inserted paint track before returning an atomic complete candidate', async () => {
  const p = fixture(true),
    clip = copyCurrentLayers(p, 4, ids),
    before = structuredClone({ p, clip }),
    worker = vi.fn(rebuild);
  const out = await pasteCurrentLayers(p, 4, clip, false, { rebuild: worker });
  expect(worker).toHaveBeenCalledTimes(2);
  expect(out.selected).toHaveLength(2);
  for (const l of out.project.layers.slice(0, 2)) expect(l.keys[0].shapes).toHaveLength(1);
  expect({ p, clip }).toEqual(before);
});
for (const kind of ['missing', 'hidden', 'locked', 'tween', 'document', 'duplicate-track'] as const)
  it(`rejects ${kind} destination ownership before any worker`, async () => {
    const p = fixture(true),
      clip = copyCurrentLayers(p, 4, ids),
      worker = vi.fn(rebuild);
    if (kind === 'missing') p.layers.splice(1, 1);
    if (kind === 'hidden') p.layers[1].visible = false;
    if (kind === 'locked') p.layers[1].locked = true;
    if (kind === 'tween') {
      p.layers[1].drawingMode = 'object';
      p.layers[1].keys[1].shapes = [rect('same', 100)];
      createBasicMotionSpan(p, [p.layers[1].id], 0, 8, 'linear');
    }
    if (kind === 'document') clip.projectId = 'other';
    if (kind === 'duplicate-track') clip.tracks.push(structuredClone(clip.tracks[0]));
    const before = structuredClone({ p, clip });
    await expect(pasteCurrentLayers(p, 4, clip, false, { rebuild: worker })).rejects.toThrow();
    expect(worker).not.toHaveBeenCalled();
    expect({ p, clip }).toEqual(before);
  });
it('a later track failure preserves complete original project and clipboard', async () => {
  const p = fixture(true),
    clip = copyCurrentLayers(p, 4, ids),
    before = structuredClone({ p, clip });
  let calls = 0;
  await expect(
    pasteCurrentLayers(p, 4, clip, false, {
      rebuild: async (...args) => {
        if (++calls === 2) throw Error('Later track failed');
        return rebuild(...args);
      },
    }),
  ).rejects.toThrow('Later track');
  expect(calls).toBe(2);
  expect({ p, clip }).toEqual(before);
});
for (const kind of ['source', 'clipboard', 'payload', 'selection', 'abort'] as const)
  it(`rejects actual late ${kind} change without publishing a candidate`, async () => {
    const p = fixture(true),
      clip = copyCurrentLayers(p, 4, ids),
      control = new AbortController();
    await expect(
      pasteCurrentLayers(p, 4, clip, false, {
        signal: control.signal,
        rebuild: async (shapes, picks, curves) => {
          const result = await rebuild(shapes, picks, curves);
          if (kind === 'source') p.name = 'Separate source edit';
          if (kind === 'clipboard') clip.tracks[0].shapes[0].x++;
          if (kind === 'payload') shapes[0].x++;
          if (kind === 'selection') result.selected = ['missing'];
          if (kind === 'abort') control.abort();
          return result;
        },
      }),
    ).rejects.toThrow();
    expect(p.layers[0].keys[0].shapes).toHaveLength(1);
    expect(p.layers[1].keys[0].shapes).toHaveLength(1);
  });
it('rejects raw numeric/getter/frame requests and complete candidate overflow without normalizing them', async () => {
  const p = fixture(),
    clip = copyCurrentLayers(p, 4, ids),
    worker = vi.fn(rebuild);
  clip.tracks[0].shapes[0].x = NaN;
  await expect(pasteCurrentLayers(p, 4, clip, false, { rebuild: worker })).rejects.toThrow();
  clip.tracks[0].shapes[0].x = 20;
  await expect(pasteCurrentLayers(p, NaN, clip, false, { rebuild: worker })).rejects.toThrow();
  const options = {
    get rebuild(): CrossLayerRebuilder {
      throw Error('Getter must not run');
    },
  };
  await expect(pasteCurrentLayers(p, 4, clip, false, options)).rejects.toThrow(
    'original clipboard options',
  );
  clip.tracks[0].shapes[0].x = Number.MAX_VALUE;
  await expect(pasteCurrentLayers(p, 4, clip, false, { rebuild: worker })).rejects.toThrow();
  expect(worker).not.toHaveBeenCalled();
});

it('admits the full inserted shape budget before starting a reconstruction worker', { timeout: 30_000 }, async () => {
  const p = fixture(true),
    clip = copyCurrentLayers(p, 4, ids),
    worker = vi.fn(rebuild);
  p.layers[0].keys[0].shapes = Array.from({ length: 100000 }, (_, i) =>
    rect(i ? `shape-${i}` : 'same'),
  );
  await expect(pasteCurrentLayers(p, 4, clip, false, { rebuild: worker })).rejects.toThrow(
    'shapes',
  );
  expect(worker).not.toHaveBeenCalled();
  expect(p.layers[0].keys[0].shapes).toHaveLength(100000);
});

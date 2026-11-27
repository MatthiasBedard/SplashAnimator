import { expect, it, vi } from 'vitest';
import { newProject, newLayer, type Vector } from '../packages/document/src';
import { multiFrameId } from '../packages/animation/src/multi-frame';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { objectBounds } from '../packages/geometry/src/layout';
import { mergeSelectedArtwork } from '../packages/geometry/src/merge-selection';
import { mergeVectors } from '../packages/geometry/src/merge';
import {
  prepareMergedCurrentLayerChange,
  type CrossLayerRebuilder,
} from '../apps/editor/src/cross-layer-selection';
const rect = (id: string, x: number): Vector => ({
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
function fixture() {
  const p = newProject();
  p.duration = 10;
  p.layers = ['One', 'Two', 'Hidden', 'Locked'].map((name, i) => ({
    ...newLayer(name),
    id: 'l' + i,
    drawingMode: 'merge' as const,
    visible: i !== 2,
    locked: i === 3,
    keys: [
      { frame: 0, shapes: [rect('same', 20 + i * 60), rect('other', 180 + i * 60)] },
      { frame: 8, shapes: [] },
    ],
  }));
  return p;
}
const ids = [multiFrameId('l0', 0, 'same'), multiFrameId('l1', 0, 'same')];
const rebuild: CrossLayerRebuilder = async (shapes, selected, curves) =>
  selected.length
    ? mergeSelectedArtwork(shapes, selected, curves)
    : { artwork: mergeVectors(shapes, undefined, curves), selected: [] };
it('reconstructs two original merge tracks independently and preserves held/outside/protected artwork', async () => {
  const p = fixture(),
    before = structuredClone(p),
    calls: Vector[][] = [];
  const result = await prepareMergedCurrentLayerChange(
    p,
    4,
    ids,
    { kind: 'move', x: 10, y: 5 },
    {
      rebuild: async (...args) => {
        const r = await rebuild(...args);
        calls.push(structuredClone(r.artwork));
        return r;
      },
    },
  );
  expect(p).toEqual(before);
  for (const [i, l] of result.project.layers.slice(0, 2).entries()) {
    expect(l.keys.map((k) => k.frame)).toEqual([0, 8]);
    expect(l.keys[0].shapes).toEqual(calls[i]);
    const selected = l.keys[0].shapes.filter((s) =>
      result.selected.includes(multiFrameId(l.id, 0, s.id)),
    );
    expect(selected).toHaveLength(1);
    expect(objectBounds(selected[0])).toMatchObject({
      left: 30 + i * 60,
      top: 35,
      right: 50 + i * 60,
      bottom: 55,
    });
    expect(
      l.keys[0].shapes
        .filter((s) => !result.selected.includes(multiFrameId(l.id, 0, s.id)))
        .map(objectBounds),
    ).toEqual([{ left: 180 + i * 60, top: 30, right: 200 + i * 60, bottom: 50 }]);
  }
  expect(result.project.layers.slice(2)).toEqual(before.layers.slice(2));
  result.project.layers[0].keys[0].shapes[0].x = 999;
  expect(p).toEqual(before);
});
it('remaps merged pieces selected after a real overlap and keeps the other original track namespace', async () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[1] = { ...rect('other', 45), fill: '#0000ff' };
  p.layers[1].drawingMode = 'object';
  const out = await prepareMergedCurrentLayerChange(
    p,
    4,
    ids,
    { kind: 'move', x: 10, y: 0 },
    { rebuild },
  );
  const merged = out.project.layers[0].keys[0].shapes;
  expect(merged.length).toBeGreaterThan(1);
  expect(out.selected.some((id) => id === multiFrameId('l1', 0, 'same'))).toBe(true);
  const picked = merged.filter((s) => out.selected.includes(multiFrameId('l0', 0, s.id)));
  expect(picked.length).toBeGreaterThan(0);
  expect(picked.every((s) => s.fill === '#ff0000')).toBe(true);
  expect(picked.map(objectBounds).reduce((max, b) => Math.max(max, b.right), 0)).toBe(45);
  expect(out.project.layers[1].keys[0].shapes[0]).toMatchObject({ id: 'same', x: 90 });
});
it('qualifies a live endpoint before reconstructing a selected merge track', async () => {
  const p = fixture(), layer = p.layers[1], worker = vi.fn(rebuild);
  layer.drawingMode = 'object';
  layer.keys[1].shapes = layer.keys[0].shapes.map(shape => ({ ...shape, x: shape.x + 30 }));
  layer.liveMotionSpans = [{ id: 'live', start: 0, end: 8, ease: 'linear' }];
  const change = { kind: 'move' as const, x: 10, y: 5 };
  const before = structuredClone(p);
  const result = await prepareMergedCurrentLayerChange(p, 0, ids, change, { rebuild: worker });
  expect(worker).toHaveBeenCalledTimes(1);
  expect(result.project.layers[1].keys[0].shapes[0]).toMatchObject({ x: 90, y: 35 });
  expect(result.project.layers[1].keys[1]).toEqual(before.layers[1].keys[1]);
  expect(result.project.layers[1].liveMotionSpans).toEqual(before.layers[1].liveMotionSpans);
  expect(result.selected).toContain(ids[1]);
  expect(p).toEqual(before);

  worker.mockClear();
  layer.keys[1].shapes[0].kind = 'ellipse';
  const incompatible = structuredClone(p);
  await expect(prepareMergedCurrentLayerChange(p, 0, ids, change, { rebuild: worker }))
    .rejects.toThrow(/motion|interpolation/i);
  expect(worker).not.toHaveBeenCalled();
  expect(p).toEqual(incompatible);
});

it('validates a masked merge result against the original mask before publishing any track', async () => {
  const p = fixture();
  p.layers[1].drawingMode = 'object';
  const mask = { ...newLayer('Mask'), id: 'mask', drawingMode: 'object' as const };
  mask.keys[0].shapes = [{ ...rect('clip', 0), y: 0, width: 250, height: 100 }];
  p.layers.splice(1, 0, mask);
  p.layerMasks = [{ maskLayerId: mask.id, layerIds: ['l0'] }];
  const before = structuredClone(p);
  const change = { kind: 'move' as const, x: 10, y: 5 };
  const worker = vi.fn(rebuild);
  const result = await prepareMergedCurrentLayerChange(p, 4, ids, change, { rebuild: worker });
  expect(worker).toHaveBeenCalledTimes(1);
  expect(result.project.layers[1]).toEqual(mask);
  expect(result.project.layerMasks).toEqual(p.layerMasks);
  expect(result.project.layers[2].keys[0].shapes[0].x).toBe(90);
  expect(result.project.layers[0].keys[0].shapes.map(objectBounds))
    .toContainEqual({ left: 30, top: 35, right: 50, bottom: 55 });
  expect(p).toEqual(before);

  worker.mockClear();
  await expect(prepareMergedCurrentLayerChange(p, 4, ids, { ...change, x: 260 }, { rebuild: worker }))
    .rejects.toThrow('inside the mask');
  expect(worker).not.toHaveBeenCalled();
  worker.mockImplementationOnce(async (...args) => {
    const output = await rebuild(...args);
    output.artwork[0].x = 260;
    return output;
  });
  await expect(prepareMergedCurrentLayerChange(p, 4, ids, change, { rebuild: worker }))
    .rejects.toThrow('Keep the reconstructed cross-layer edit inside the mask.');
  expect(p).toEqual(before);
});

it('admits clipped merge output and rejects edits to protected paint or lost visibility', async () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[1].x = 46;
  p.layers[1].drawingMode = 'object';
  const mask = { ...newLayer('Mask'), id: 'mask', drawingMode: 'object' as const };
  mask.keys[0].shapes = [{ ...rect('clip', 25), y: 0, width: 20, height: 100 }];
  p.layers.splice(1, 0, mask);
  p.layerMasks = [{ maskLayerId: mask.id, layerIds: ['l0'] }];
  const before = structuredClone(p), change = { kind: 'move' as const, x: 4, y: 5 };
  const worker = vi.fn(rebuild);
  const result = await prepareMergedCurrentLayerChange(p, 4, ids, change, { rebuild: worker });
  expect(worker.mock.calls[0][0].map(shape => shape.id)).toEqual(['same']);
  expect(result.project.layers[0].keys[0].shapes.find(shape => shape.id === 'other'))
    .toEqual(before.layers[0].keys[0].shapes[1]);
  expect(result.project.layers[0].keys[0].shapes.map(objectBounds))
    .toContainEqual({ left: 24, top: 35, right: 44, bottom: 55 });
  await expect(prepareMergedCurrentLayerChange(p, 4, ids, change, {
    rebuild: async (...args) => {
      const output = await rebuild(...args);
      output.artwork.push({ ...before.layers[0].keys[0].shapes[1], x: 32 });
      output.selected.push('other');
      return output;
    },
  })).rejects.toThrow('protected artwork');
  await expect(prepareMergedCurrentLayerChange(p, 4, ids, change, {
    rebuild: async (...args) => {
      const output = await rebuild(...args);
      output.artwork.find(shape => shape.id === output.selected[0])!.x += 50;
      return output;
    },
  })).rejects.toThrow('inside the mask');
  worker.mockClear();
  await expect(prepareMergedCurrentLayerChange(p, 4, ids, { ...change, x: 10 }, { rebuild: worker }))
    .rejects.toThrow('protected artwork');
  expect(worker).not.toHaveBeenCalled();
  const deleted = structuredClone(before);
  deleted.layers[0].keys[0].shapes.shift();
  deleted.layers[2].keys[0].shapes.shift();
  expect(await prepareMergedCurrentLayerChange(p, 4, ids, { kind: 'delete' }, { rebuild: worker }))
    .toEqual({ project: deleted, selected: [] });
  expect(worker).not.toHaveBeenCalled();
  expect(p).toEqual(before);

  const remaining = { ...rect('peer', 30), y: 50, width: 10, fill: '#0000ff' };
  p.layers[0].keys[0].shapes.splice(1, 0, remaining);
  const connected = structuredClone(p);
  const deletion = await prepareMergedCurrentLayerChange(p, 4, ids, { kind: 'delete' }, { rebuild: worker });
  expect(worker.mock.calls[0].slice(0, 2)).toEqual([[remaining], []]);
  expect(deletion.project.layers[0].keys[0].shapes.map(objectBounds))
    .toEqual([objectBounds(remaining), objectBounds(before.layers[0].keys[0].shapes[1])]);
  expect(deletion.project.layers[0].keys[0].shapes[1]).toEqual(before.layers[0].keys[0].shapes[1]);
  await expect(prepareMergedCurrentLayerChange(p, 4, ids, { kind: 'delete' }, {
    rebuild: async () => ({ artwork: [before.layers[0].keys[0].shapes[0]], selected: [] }),
  })).rejects.toThrow('protected artwork');
  await expect(prepareMergedCurrentLayerChange(p, 4, ids, { kind: 'delete' }, {
    rebuild: async () => ({ artwork: [], selected: [] }),
  })).rejects.toThrow('discard remaining artwork');
  expect(p).toEqual(connected);

  p.layers[0].keys[0].shapes[2].x = 40;
  p.layers[0].keys[0].shapes[2].y = 50;
  p.layers[0].keys[0].shapes[2].fillEnabled = false;
  p.layers[0].keys[0].shapes[2].strokeWidth = 1;
  worker.mockClear();
  await expect(prepareMergedCurrentLayerChange(p, 4, ids, { kind: 'delete' }, { rebuild: worker }))
    .rejects.toThrow('protected artwork');
  expect(worker).not.toHaveBeenCalled();
});

it('deletes selected paint with empty worker picks while leaving outside keys unchanged', async () => {
  const p = fixture(),
    worker = vi.fn(rebuild);
  const out = await prepareMergedCurrentLayerChange(
    p,
    4,
    ids,
    { kind: 'delete' },
    { rebuild: worker },
  );
  expect(worker).toHaveBeenCalledTimes(2);
  expect(worker.mock.calls.every((c) => c[1].length === 0)).toBe(true);
  expect(out.selected).toEqual([]);
  for (const [i, l] of out.project.layers.slice(0, 2).entries())
    expect(l.keys[0].shapes.map(objectBounds)).toEqual([
      { left: 180 + i * 60, top: 30, right: 200 + i * 60, bottom: 50 },
    ]);
  expect(out.project.layers.slice(2)).toEqual(p.layers.slice(2));
});
it('transforms the original complete group without altering an aliased key on another layer', async () => {
  const p = fixture();
  p.layers[0].drawingMode = 'object';
  p.layers[1].drawingMode = 'object';
  p.layers[0].keys[0].shapes.forEach((s) => (s.groups = ['g']));
  p.layers[1].keys[0] = p.layers[0].keys[0];
  const original = structuredClone(p.layers[1]);
  const out = await prepareMergedCurrentLayerChange(
    p,
    0,
    [ids[0]],
    { kind: 'transform', matrix: [2, 0, 0, 1, 5, 0] },
    { rebuild },
  );
  expect(out.project.layers[1]).toEqual(original);
  expect(out.selected).toHaveLength(2);
  expect(out.project.layers[0].keys[0].shapes.map(objectBounds).map((b) => b.left)).toEqual([
    45, 365,
  ]);
});
it('skips workers and topology regeneration for zero movement', async () => {
  const p = fixture(),
    worker = vi.fn(rebuild);
  const out = await prepareMergedCurrentLayerChange(
    p,
    4,
    ids,
    { kind: 'move', x: 0, y: 0 },
    { rebuild: worker },
  );
  expect(worker).not.toHaveBeenCalled();
  expect(out.project).toEqual(p);
  expect(out.selected).toEqual(ids);
});
it('rejects a later worker failure without any source writes', async () => {
  const p = fixture(),
    before = structuredClone(p);
  let n = 0;
  await expect(
    prepareMergedCurrentLayerChange(
      p,
      4,
      ids,
      { kind: 'move', x: 10, y: 0 },
      {
        rebuild: async (...args) => {
          if (++n === 2) throw Error('later worker');
          return rebuild(...args);
        },
      },
    ),
  ).rejects.toThrow('later worker');
  expect(n).toBe(2);
  expect(p).toEqual(before);
});
it('does not start any worker when another selected track belongs to a tween', async () => {
  const p = fixture(),
    worker = vi.fn(rebuild);
  p.layers[1].keys[1].shapes = [rect('same', 90), rect('other', 240)];
  createBasicMotionSpan(p, ['l1'], 0, 8, 'linear');
  await expect(
    prepareMergedCurrentLayerChange(
      p,
      4,
      [ids[0], multiFrameId('l1', 4, 'same')],
      { kind: 'move', x: 10, y: 0 },
      { rebuild: worker },
    ),
  ).rejects.toThrow('tween');
  expect(worker).not.toHaveBeenCalled();
});
for (const phase of ['worker', 'admission'] as const)
  it(`rejects actual source edits during ${phase} without reverting that edit`, async () => {
    const p = fixture();
    let touched = false;
    await expect(
      prepareMergedCurrentLayerChange(
        p,
        4,
        ids,
        { kind: 'move', x: 10, y: 0 },
        {
          rebuild: async (...args) => {
            if (phase === 'worker') p.name = 'separate edit';
            touched = true;
            return rebuild(...args);
          },
          admit: () => {
            if (phase === 'admission' && touched) p.name = 'separate edit';
          },
        },
      ),
    ).rejects.toThrow('source');
    expect(p.name).toBe('separate edit');
    expect(p.layers[0].keys[0].shapes[0].x).toBe(20);
  });
it('cancels pending output without preparing the next layer', async () => {
  const p = fixture(),
    controller = new AbortController(),
    worker = vi.fn(async (...args: Parameters<CrossLayerRebuilder>) => {
      controller.abort();
      return rebuild(...args);
    });
  await expect(
    prepareMergedCurrentLayerChange(
      p,
      4,
      ids,
      { kind: 'move', x: 10, y: 0 },
      { rebuild: worker, signal: controller.signal },
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker).toHaveBeenCalledOnce();
  expect(p.layers[0].keys[0].shapes[0].x).toBe(20);
});
for (const problem of ['raw', 'selection', 'payload', 'overflow'] as const)
  it(`rejects malformed ${problem} before any publication`, async () => {
    const p = fixture(),
      before = structuredClone(p);
    await expect(
      prepareMergedCurrentLayerChange(
        p,
        4,
        ids,
        { kind: 'move', x: 10, y: 0 },
        {
          rebuild: async (...args) => {
            const out = await rebuild(...args);
            if (problem === 'raw')
              Object.defineProperty(out.artwork[0], 'x', {
                get() {
                  throw Error('getter ran');
                },
                enumerable: true,
              });
            if (problem === 'selection') out.selected.push('missing');
            if (problem === 'payload') args[0][0].x++;
            if (problem === 'overflow') out.artwork[0].x = 1e9;
            return out;
          },
        },
      ),
    ).rejects.toThrow();
    expect(p).toEqual(before);
  });
it('captures raw targets/options without invoking accessors', async () => {
  const p = fixture(),
    worker = vi.fn(rebuild),
    getter = vi.fn(() => worker),
    options = { rebuild: worker };
  Object.defineProperty(options, 'rebuild', { get: getter });
  await expect(
    prepareMergedCurrentLayerChange(p, 4, ids, { kind: 'move', x: 1, y: 0 }, options),
  ).rejects.toThrow('original merge options');
  expect(getter).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
});

it('does not rebuild an unselected aliased merge track or later exposure', async () => {
  const p = fixture();
  p.layers[1].keys[0] = p.layers[0].keys[0];
  p.layers[0].keys[1].shapes = p.layers[0].keys[0].shapes;
  const before = structuredClone(p),
    worker = vi.fn(rebuild);
  const out = await prepareMergedCurrentLayerChange(
    p,
    4,
    [ids[0]],
    { kind: 'move', x: 10, y: 0 },
    { rebuild: worker },
  );
  expect(worker).toHaveBeenCalledOnce();
  expect(out.project.layers[1]).toEqual(before.layers[1]);
  expect(out.project.layers[0].keys[1]).toEqual(before.layers[0].keys[1]);
  expect(p).toEqual(before);
});
it('rejects a changed detached original clone before starting work', async () => {
  const p = fixture(),
    clone = structuredClone,
    worker = vi.fn(rebuild);
  const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => {
    const out = clone(value);
    if (value === p) (out as typeof p).background = '#ffff00';
    return out;
  }) as typeof structuredClone);
  try {
    await expect(
      prepareMergedCurrentLayerChange(p, 4, ids, { kind: 'move', x: 1, y: 0 }, { rebuild: worker }),
    ).rejects.toThrow('snapshot');
    expect(worker).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

import { afterEach, expect, it, vi } from 'vitest';
import {
  newLayer,
  newProject,
  validateProject,
  type Project,
  type Vector,
} from '../packages/document/src';
import { liveSplitFixture } from './live-motion-split-fixture';
import {
  prepareTimelineFrameInsertion,
  prepareTimelineKeyframe,
} from '../apps/editor/src/timeline-keyframe';

afterEach(() => vi.restoreAllMocks());
function fixture(live = false) {
  const p = liveSplitFixture();
  p.layers[0].keys.pop();
  if (!live) delete p.layers[0].liveMotionSpans;
  const other = newLayer('Other');
  other.locked = true;
  other.keys[0].shapes = [
    { ...structuredClone(p.layers[0].keys[0].shapes[0]), id: 'unrelated', x: 120 },
  ];
  p.layers.push(other);
  return p;
}
for (const live of [false, true])
  for (const action of ['key', 'blank', 'frame'] as const)
    it(`extends to the exact future column for ${action}, live=${live}, without changing original keys or recipes`, () => {
      const p = fixture(live),
        before = structuredClone(p),
        q = prepareTimelineFrameInsertion(p, 'track', 35, action);
      expect(p).toEqual(before);
      expect(q.duration).toBe(36);
      expect(q.layers[1]).toEqual(p.layers[1]);
      expect(q.layers[0].keys.filter((k) => k.frame !== 35)).toEqual(p.layers[0].keys);
      expect(q.layers[0].keys.find((k) => k.frame === 35)).toEqual(
        action === 'frame'
          ? undefined
          : {
              frame: 35,
              shapes: action === 'blank' ? [] : p.layers[0].keys[1].shapes,
            },
      );
      expect(q.layers[0].liveMotionSpans).toEqual(p.layers[0].liveMotionSpans);
      expect({ ...q, layers: p.layers, duration: p.duration }).toEqual(p);
      validateProject(q);
      if (action === 'key') q.layers[0].keys.at(-1)!.shapes[0].x = -1;
      expect(p).toEqual(before);
    });
it('supports the first column after the old end and exact maximum without filling the gap with keys', () => {
  const p = fixture();
  const adjacent = prepareTimelineKeyframe(p, 'track', p.duration);
  expect(adjacent.duration).toBe(p.duration + 1);
  const max = prepareTimelineKeyframe(p, 'track', 99999);
  expect(max.duration).toBe(100000);
  expect(max.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 99999]);
  expect(() => prepareTimelineKeyframe(max, 'track', 100000)).toThrow();
  expect(() => prepareTimelineFrameInsertion(max, 'track', 0, 'frame')).toThrow(/limit/);
});
it('extends an empty document with either a held frame or an explicit blank key', () => {
  const p = newProject();
  p.duration = 1;
  const held = prepareTimelineFrameInsertion(p, p.layers[0].id, 40, 'frame');
  expect(held.layers).toEqual(p.layers);
  expect(held.duration).toBe(41);
  const key = prepareTimelineKeyframe(p, p.layers[0].id, 40, true);
  expect(key.layers[0].keys).toEqual([
    { frame: 0, shapes: [] },
    { frame: 40, shapes: [] },
  ]);
});
it('retains saved symbol/library/playback data when adding a future key', () => {
  const p = fixture(),
    leaf = structuredClone(p.layers[0].keys[0].shapes[0]);
  p.symbols = [
    {
      id: 'child',
      name: 'Child',
      width: 20,
      height: 20,
      shapes: [leaf],
      timeline: { duration: 3, keys: [] },
    },
  ];
  delete p.layers[0].liveMotionSpans;
  for (const k of p.layers[0].keys)
    k.shapes = [
      {
        ...k.shapes[0],
        kind: 'symbol',
        symbolId: 'child',
        symbolPlayback: { mode: 'movie', firstFrame: 1 },
      } as Vector,
    ];
  const q = prepareTimelineKeyframe(p, 'track', 40);
  expect(q.symbols).toEqual(p.symbols);
  expect(q.layers[0].keys.at(-1)!.shapes).toEqual(p.layers[0].keys.at(-1)!.shapes);
});
it('ordinary Insert frame shifts only following keys on the target layer and preserves selected opacity holds', () => {
  const p = fixture(),
    q = prepareTimelineFrameInsertion(p, 'track', 3, 'frame');
  expect(q.duration).toBe(p.duration + 1);
  expect(q.layers[0].keys).toEqual([p.layers[0].keys[0], { ...p.layers[0].keys[1], frame: 9 }]);
  expect(q.layers[1]).toEqual(p.layers[1]);
  const bound = fixture();
  bound.opacityBindings = [
    { layerId: 'track', shapeId: 'art', start: 0, end: 3, keys: [{ frame: 0, opacity: 0.5 }] },
  ];
  const result = prepareTimelineFrameInsertion(bound, 'track', 35, 'frame');
  expect(result.opacityBindings).toEqual(bound.opacityBindings);
  expect(result.layers).toEqual(bound.layers);
});
it('inserts time inside live tween ownership and permits held time after its end', () => {
  const p = fixture(true),
    before = structuredClone(p);
  const result = prepareTimelineFrameInsertion(p, 'track', 4, 'frame');
  expect(result.duration).toBe(p.duration + 1);
  expect(result.layers[0].keys).toEqual(
    p.layers[0].keys.map((k) => (k.frame > 4 ? { ...k, frame: k.frame + 1 } : k)),
  );
  expect(result.layers[0].liveMotionSpans).toEqual(
    p.layers[0].liveMotionSpans!.map((s) => ({ ...s, end: 9 })),
  );
  expect(p).toEqual(before);
  expect(prepareTimelineFrameInsertion(p, 'track', 9, 'frame').layers).toEqual(p.layers);
});
for (const action of ['key', 'blank', 'frame'] as const)
  it(`rejects locked future ${action} insertion without extending duration`, () => {
    const p = fixture();
    p.layers[0].locked = true;
    const before = structuredClone(p);
    expect(() => prepareTimelineFrameInsertion(p, 'track', 35, action)).toThrow(/locked/);
    expect(p).toEqual(before);
  });
for (const change of ['source', 'context', 'candidate'] as const)
  it(`rejects late ${change} changes after the fully extended candidate exists`, () => {
    const p = fixture(true),
      before = structuredClone(p),
      native = structuredClone;
    let fired = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, ...rest) => {
      if ((value as Project)?.duration === 36 && !fired) {
        fired = true;
        if (change === 'source') p.name = 'User edit';
        if (change === 'candidate') (value as Project).background = '#000000';
      }
      return native(value, ...rest);
    });
    expect(() =>
      prepareTimelineFrameInsertion(p, 'track', 35, 'key', () => {
        if (fired && change === 'context') throw Error('Timeline context changed');
      }),
    ).toThrow();
    expect(fired).toBe(true);
    expect(p.layers).toEqual(before.layers);
    expect(p.duration).toBe(before.duration);
  });

import { afterEach, expect, it, vi } from 'vitest';
import { newLayer, validateProject, type Project } from '../packages/document/src';
import { editLayerFrameRanges, removeLayerKeyframes, transferFrameBlock } from '../packages/animation/src/timeline';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { liveSplitFixture } from './live-motion-split-fixture';
import { prepareTimelineKeyframe } from '../apps/editor/src/timeline-keyframe';
import { prepareTimelineFrameMove } from '../apps/editor/src/timeline-frame-move';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';

afterEach(() => vi.restoreAllMocks());
const route = [{ sourceId: 'track', targetId: 'track' }];
function move(p: Project, start: number, at: number, end = start) {
  return prepareTimelineFrameMove(p, route, start, end, at);
}
function sample(p: Project, at: number) {
  return sampleTrack(p, p.layers[0].id, at);
}
function sampleTrack(p: Project, id: string, at: number) {
  const layer = p.layers.find(layer => layer.id === id)!,
    span = layer.liveMotionSpans!.find((s) => s.start <= at && at <= s.end)!;
  const sampler = createMotionFrameSampler(p, layer.id, span);
  try {
    return sampler.sample(at);
  } finally {
    sampler.dispose();
  }
}
it('moves sampled tween cells across a plain layer without changing the poses on either side', () => {
  const p = liveSplitFixture(), target = newLayer('Plain');
  p.layers.push(target);
  const original = structuredClone(p);
  const moved = prepareTimelineFrameMove(p, [{ sourceId: 'track', targetId: target.id }], 2, 4, 6);
  expect(p).toEqual(original);
  const [source, destination] = moved.layers;
  expect(source.keys.map(key => key.frame)).toEqual([0, 1, 5, 8, 10]);
  expect(destination.keys.map(key => key.frame)).toEqual([0, 6, 8]);
  for (const i of [6, 7, 8])
    expect(sampleTrack(moved, target.id, i)[0].x).toBe(sample(p, i - 4)[0].x);
  for (const i of [5, 6, 7, 8]) expect(sample(moved, i)).toEqual(sample(p, i));
  expect(source.keys[1].shapes).toEqual(sample(p, 1));
});
it('replaces a selected part of a destination tween and keeps its outside poses', () => {
  const p = liveSplitFixture();
  const target = structuredClone(p.layers[0]);
  target.id = 'target';
  target.liveMotionSpans![0].options = { primitives: true };
  target.keys[1].shapes[0].width = 36;
  p.layers.push(target);
  const moved = prepareTimelineFrameMove(p, [{ sourceId: 'track', targetId: target.id }], 2, 4, 3);
  for (const i of [0, 1, 2, 6, 7, 8])
    expect(sampleTrack(moved, target.id, i)).toEqual(sampleTrack(p, target.id, i));
  expect(moved.layers[1].liveMotionSpans?.map(span => [span.start, span.end, span.options?.primitives]))
    .toEqual([[0, 2, true], [3, 5, undefined], [6, 8, true]]);
});
it('moves part of a remembered tween with its stored artwork and leaves outside keys exact', () => {
  const p = liveSplitFixture(), target = newLayer('Plain');
  delete p.layers[0].liveMotionSpans;
  createBasicMotionSpan(p, ['track'], 0, 8, 'linear');
  p.layers.push(target);
  const source = p.layers[0];
  const moved = prepareTimelineFrameMove(p, [{ sourceId: 'track', targetId: target.id }], 2, 4, 6);
  expect(source.motionSpans).toHaveLength(1);
  expect(moved.layers[0].motionSpans).toBeUndefined();
  expect(moved.layers[0].keys).toEqual(source.keys.filter(key => key.frame < 2 || key.frame > 4));
  expect(moved.layers[1].keys.slice(1).map(key => key.shapes[0].x)).toEqual([28, 38, 48]);
});
it('deletes time before a live tween and shifts its pose and endpoint keys together', () => {
  const p = liveSplitFixture((source, span) => {
    span.start = source.layers[0].keys[0].frame = 2;
    source.layers[0].keys.unshift({ frame: 0, shapes: [] });
  });
  const untouched = newLayer('Unselected');
  p.layers.push(untouched);
  const before = structuredClone(p);
  const poses = Array.from({ length: 7 }, (_, i) => sample(p, i + 2));
  editLayerFrameRanges(p, ['track'], 0, 1, 'remove');
  expect(p.layers[0].liveMotionSpans).toEqual([
    { ...before.layers[0].liveMotionSpans![0], start: 0, end: 6 },
  ]);
  expect(p.layers[0].keys.map(key => key.frame)).toEqual([0, 6, 8, 10]);
  expect(p.layers[1]).toEqual(untouched);
  expect(p.duration).toBe(before.duration);
  expect(Array.from({ length: 7 }, (_, i) => sample(p, i))).toEqual(poses);
});
it.each([[2, 8], [0, 8]])('clears a live end key without shifting time (%s–%s)', (start, end) => {
  const p = liveSplitFixture();
  const other = newLayer('Other');
  other.keys.push({ frame: 8, shapes: [] });
  p.layers.unshift(other);
  const before = structuredClone(p);
  removeLayerKeyframes(p, [other.id, 'track'], start, end);
  expect(p.layers[0].keys).toEqual(before.layers[0].keys.slice(0, 1));
  expect(p.layers[1].keys).toEqual([before.layers[1].keys[0], before.layers[1].keys[2]]);
  expect(p.layers[1].liveMotionSpans).toBeUndefined();
  expect(p.duration).toBe(before.duration);
});
it.each([1, 4, 7])('rejoins a live tween across a cleared authored key at %s', at => {
  const p = liveSplitFixture();
  const edited = prepareTimelineKeyframe(p, 'track', at);
  edited.layers[0].keys[1].shapes[0].y += 20;
  removeLayerKeyframes(edited, ['track'], at, at);
  expect(edited.layers[0].keys).toEqual(p.layers[0].keys);
  expect(edited.layers[0].liveMotionSpans).toEqual(p.layers[0].liveMotionSpans);
  expect(sample(edited, at)).toEqual(sample(p, at));
  expect(edited.duration).toBe(p.duration);
});

it('rejects a join that would discard a custom path, atomically across layers', () => {
  const p = liveSplitFixture((_, span) => {
    span.path = { startX: 15, startY: 10, endX: -15, endY: 10 };
  });
  const edited = prepareTimelineKeyframe(p, 'track', 4);
  const other = newLayer('Other');
  other.keys.push({ frame: 4, shapes: [] });
  edited.layers.unshift(other);
  const before = structuredClone(edited);
  expect(() => removeLayerKeyframes(edited, [other.id, 'track'], 4, 4)).toThrow('custom path');
  expect(edited).toEqual(before);
});
it('duplicates complete live tween keys with new recipe and artwork identities', () => {
  const p = liveSplitFixture(), target = newLayer('Destination');
  target.keys.push({ frame: 2, shapes: [] }, { frame: 11, shapes: [] });
  p.layers.unshift(target);
  const before = structuredClone(p);
  transferFrameBlock(p, [{ sourceId: 'track', targetId: target.id }], 0, 8, 2, true);
  const copy = p.layers[0];
  expect(p.layers[1]).toEqual(before.layers[1]);
  expect(copy.keys.map(key => key.frame)).toEqual([0, 2, 10, 11]);
  expect(copy.liveMotionSpans?.[0]).toMatchObject({ start: 2, end: 10, ease: 'linear' });
  expect(copy.liveMotionSpans?.[0].id).not.toBe('live');
  expect(copy.keys[1].shapes[0].id).toBe(copy.keys[2].shapes[0].id);
  expect(copy.keys[1].shapes[0].id).not.toBe('art');
  expect(sample(p, 6)[0].x).toBe(48);
});
it('copies to a later time on the same row and protects source or partial tween ownership', () => {
  const p = liveSplitFixture(), before = structuredClone(p);
  expect(() => transferFrameBlock(p, route, 0, 8, 2, true)).toThrow('overlaps its source');
  expect(() => transferFrameBlock(p, route, 2, 4, 10, true)).toThrow('complete live tween');
  expect(p).toEqual(before);
  transferFrameBlock(p, route, 0, 8, 10, true);
  const layer = p.layers[0];
  expect(layer.keys.map(key => key.frame)).toEqual([0, 8, 10, 18]);
  expect(layer.keys.slice(0, 2)).toEqual(before.layers[0].keys.slice(0, 2));
  expect(layer.liveMotionSpans?.[0]).toEqual(before.layers[0].liveMotionSpans![0]);
  expect(layer.liveMotionSpans?.[1].id).not.toBe('live');
  expect(sample(p, 14)[0].x).toBe(48);
});
it('transfers a complete live tween while preserving outside keys and remapping endpoint identity', () => {
  const p = liveSplitFixture();
  p.duration = 15;
  const target = newLayer('Destination');
  target.id = 'destination';
  const outside = { ...p.layers[0].keys[0].shapes[0], id: 'outside' };
  target.keys.push({ frame: 2, shapes: [] }, { frame: 11, shapes: [outside] },
    { frame: 14, shapes: [{ ...outside, x: 35 }] });
  target.liveMotionSpans = [{ id: 'outside', start: 11, end: 14, ease: 'out' }];
  p.layers.unshift(target);
  const before = structuredClone(p);
  const q = prepareTimelineFrameMove(p, [{ sourceId: 'track', targetId: target.id }], 0, 8, 2);
  expect(p).toEqual(before);
  expect(q.duration).toBe(p.duration);
  expect(q.layers[1].keys).toEqual([{ frame: 0, shapes: [] }, p.layers[1].keys[2]]);
  expect(q.layers[1].liveMotionSpans).toBeUndefined();
  const layer = q.layers[0];
  expect(layer.keys.map(key => key.frame)).toEqual([0, 2, 10, 11, 14]);
  expect(layer.keys.slice(-2)).toEqual(target.keys.slice(-2));
  expect(layer.keys[1].shapes[0].id).not.toBe('art');
  expect(layer.keys[2].shapes[0].id).toBe(layer.keys[1].shapes[0].id);
  expect(layer.liveMotionSpans).toEqual([
    { ...p.layers[1].liveMotionSpans![0], start: 2, end: 10 }, ...target.liveMotionSpans,
  ]);
  expect(sample(q, 6)[0].x).toBe(48);
  expect(sample(q, 12)).toEqual(sample(p, 12));
});
it('rebinds independent group routes to the transferred artwork without changing their sampled positions', () => {
  const p = liveSplitFixture((p, span) => {
    for (const key of p.layers[0].keys.filter(key => key.shapes.length)) {
      const first = key.shapes[0];
      first.groups = ['outer', 'inner'];
      key.shapes.push({ ...structuredClone(first), id: 'other-member', x: first.x + 30 });
    }
    span.rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
    span.groupPaths = [{ groupId: 'outer', composition: 'additive', path: { startX: 0, startY: 20, endX: 0, endY: 20 } }];
  });
  const pose = sample(p, 4);
  const target = newLayer('Destination');
  p.layers.unshift(target);
  const q = prepareTimelineFrameMove(p, [{ sourceId: 'track', targetId: target.id }], 0, 8, 2);
  const newPose = sample(q, 6), ids = newPose[0].groups!;
  expect(ids).not.toContain('outer');
  expect(ids).not.toContain('inner');
  expect(newPose[1].groups).toEqual(ids);
  expect(q.layers[0].liveMotionSpans![0].groupPaths).toEqual([
    { ...p.layers[1].liveMotionSpans![0].groupPaths![0], groupId: ids[0] },
  ]);
  expect(newPose.map(({ id: _id, groups: _groups, ...shape }) => shape))
    .toEqual(pose.map(({ id: _id, groups: _groups, ...shape }) => shape));
});
it('takes all original sparse recipes before moving through overlapping destination rows', () => {
  const p = liveSplitFixture(), middle = structuredClone(p.layers[0]), last = newLayer('Destination');
  middle.id = 'middle';
  for (const key of middle.keys) for (const shape of key.shapes) shape.y += 40;
  p.layers.push(middle, last);
  const q = prepareTimelineFrameMove(p, [
    { sourceId: 'track', targetId: middle.id },
    { sourceId: middle.id, targetId: last.id },
  ], 0, 8, 2);
  expect(q.layers[0].liveMotionSpans).toBeUndefined();
  expect(q.layers.slice(1).map(layer => layer.liveMotionSpans?.map(span => [span.start, span.end]))).toEqual([[[2, 10]], [[2, 10]]]);
  expect(q.layers.slice(1).map(layer => layer.keys.find(key => key.frame === 2)?.shapes[0].y)).toEqual([12, 52]);
});
it('retimes complete grouped endpoint membership without changing geometry or hierarchy', () => {
  const p = liveSplitFixture((p, s) => {
    for (const key of p.layers[0].keys) {
      if (!key.shapes.length) continue;
      const a = key.shapes[0];
      a.groups = ['outer', 'inner'];
      key.shapes.push({ ...structuredClone(a), id: 'second', x: a.x + 30 });
    }
    s.rotation = { direction: 'shortest', turns: 0, rigidGroups: true };
  });
  const q = move(p, 8, 6);
  expect(q.layers[0].keys).toEqual(
    p.layers[0].keys.map((k) => (k.frame === 8 ? { ...k, frame: 6 } : k)),
  );
  expect(q.layers[0].liveMotionSpans).toEqual([{ ...p.layers[0].liveMotionSpans![0], end: 6 }]);
  const shapes = sample(q, 3);
  expect(shapes.map((s) => s.x)).toEqual([48, 78]);
  expect(shapes.map((s) => s.groups)).toEqual([
    ['outer', 'inner'],
    ['outer', 'inner'],
  ]);
});
it('rejects raw source and mapping getters without reading or normalizing them', () => {
  for (const kind of ['source', 'mapping']) {
    const p = liveSplitFixture(),
      routes = structuredClone(route);
    let reads = 0;
    Object.defineProperty(
      kind === 'source' ? p.layers[0].keys[1] : routes[0],
      kind === 'source' ? 'frame' : 'targetId',
      {
        enumerable: true,
        get() {
          reads++;
          return kind === 'source' ? 8 : 'track';
        },
      },
    );
    expect(() => prepareTimelineFrameMove(p, routes, 8, 8, 6)).toThrow();
    expect(reads).toBe(0);
  }
});
for (const ease of ['linear', 'in', 'out', 'in-out'] as const)
  for (const at of [4, 9, 10])
    it(`moves the ending key to ${at} retaining ${ease} sparse timing and replacing its destination`, () => {
      const p = liveSplitFixture((_, s) => {
          s.ease = ease;
        }),
        before = structuredClone(p);
      const q = move(p, 8, at);
      expect(p).toEqual(before);
      expect(q.layers[0].keys.map((k) => k.frame)).toEqual(at === 10 ? [0, 10] : [0, at, 10]);
      expect(q.layers[0].keys.find((k) => k.frame === at)!.shapes).toEqual(
        before.layers[0].keys[1].shapes,
      );
      expect(q.layers[0].liveMotionSpans).toEqual([
        { ...before.layers[0].liveMotionSpans![0], end: at },
      ]);
      expect(sample(q, 0)).toEqual(before.layers[0].keys[0].shapes);
      expect(sample(q, at)).toEqual(before.layers[0].keys[1].shapes);
      expect(q.duration).toBe(p.duration);
      validateProject(q);
    });
it('moves a selected sampled cell by promoting its original pose then retiming both sides', () => {
  const p = liveSplitFixture(),
    before = structuredClone(p),
    pose = sample(p, 3);
  const q = move(p, 3, 5);
  expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 5, 8, 10]);
  expect(q.layers[0].keys[1].shapes).toEqual(pose);
  expect(q.layers[0].liveMotionSpans!.map((s) => [s.start, s.end])).toEqual([
    [0, 5],
    [5, 8],
  ]);
  expect(q.layers[0].keys.filter((k) => k.frame !== 5)).toEqual(p.layers[0].keys);
  expect(p).toEqual(before);
  expect(sample(q, 2)[0].x).toBeCloseTo(20);
  expect(sample(q, 6)[0].x).toBeCloseTo(54.6666666667);
});
it('moves a shared key onto the next endpoint, replacing it and collapsing only the zero interval', () => {
  const p = prepareTimelineKeyframe(liveSplitFixture(), 'track', 4),
    middle = p.layers[0].keys[1];
  const q = move(p, 4, 8);
  expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  expect(q.layers[0].keys[1].shapes).toEqual(middle.shapes);
  expect(q.layers[0].liveMotionSpans).toEqual([{ ...p.layers[0].liveMotionSpans![0], end: 8 }]);
  expect(sample(q, 4)[0].x).toBe(28);
});
it('retimes connected spans from original membership and keeps outside keys and recipe options', () => {
  const p = prepareTimelineKeyframe(
    liveSplitFixture((_, s) => {
      s.options = { paint: true };
      s.paintEase = 'out';
      s.opacityEase = 'in';
      s.path = { startX: 10, startY: 20, endX: -10, endY: -20 };
    }),
    'track',
    4,
  );
  const q = move(p, 4, 6);
  expect(q.layers[0].liveMotionSpans).toEqual(
    p.layers[0].liveMotionSpans!.map((s) => ({
      ...s,
      ...(s.start === 4 ? { start: 6 } : { end: 6 }),
    })),
  );
  expect(q.layers[0].keys[1]).toEqual({ ...p.layers[0].keys[1], frame: 6 });
  expect(q.layers[0].keys.filter((k) => k.frame !== 6)).toEqual(
    p.layers[0].keys.filter((k) => k.frame !== 4),
  );
});
it('moves an entire tween block without generating boundary keys except the required initial blank', () => {
  const p = liveSplitFixture();
  p.layers[0].keys.pop();
  const q = move(p, 0, 3, 8);
  expect(q.layers[0].keys).toEqual([
    { frame: 0, shapes: [] },
    ...p.layers[0].keys.map((k) => ({ ...k, frame: k.frame + 3 })),
  ]);
  expect(q.layers[0].liveMotionSpans).toEqual([
    { ...p.layers[0].liveMotionSpans![0], start: 3, end: 11 },
  ]);
});
it('moves sparse keys on multiple tracks atomically and extends duration once', () => {
  const p = liveSplitFixture();
  p.layers[0].keys.pop();
  const second = structuredClone(p.layers[0]);
  second.id = 'second';
  p.layers.push(second);
  transferFrameBlock(p, [...route, { sourceId: 'second', targetId: 'second' }], 8, 8, 15);
  expect(p.duration).toBe(16);
  for (const l of p.layers) {
    expect(l.keys.map((k) => k.frame)).toEqual([0, 15]);
    expect(l.liveMotionSpans![0].end).toBe(15);
  }
});
for (const reason of [
  'locked',
  'cross-endpoint',
  'interior-key',
  'nonfinite',
  'fraction',
  'overflow',
  'later-track',
] as const)
  it(`rejects ${reason} without consuming any source keys or recipes`, () => {
    const p = liveSplitFixture();
    if (reason === 'locked') p.layers[0].locked = true;
    if (reason === 'later-track') {
      const b = structuredClone(p.layers[0]);
      b.id = 'bad';
      b.locked = true;
      p.layers.push(b);
    }
    const before = structuredClone(p);
    expect(() =>
      prepareTimelineFrameMove(
        p,
        reason === 'later-track'
          ? [...route, { sourceId: 'bad', targetId: 'bad' }]
          : route,
        reason === 'cross-endpoint' ? 0 : 8,
        reason === 'cross-endpoint' ? 0 : 8,
        reason === 'nonfinite'
          ? NaN
          : reason === 'fraction'
            ? 4.5
            : reason === 'overflow'
              ? 100000
              : reason === 'cross-endpoint'
                ? 9
                : reason === 'interior-key'
                  ? 11
                  : 5,
      ),
    ).toThrow();
    expect(p).toEqual(before);
  });
it('keeps no-op captures exact and returns detached keys/options', () => {
  const p = liveSplitFixture((_, s) => {
    s.options = { paint: true };
  });
  const q = move(p, 3, 3);
  expect(q).toEqual(p);
  q.layers[0].keys[0].shapes[0].x = -1;
  q.layers[0].liveMotionSpans![0].options!.paint = false;
  expect(p.layers[0].keys[0].shapes[0].x).toBe(8);
  expect(p.layers[0].liveMotionSpans![0].options!.paint).toBe(true);
});
for (const mutation of ['source', 'input', 'reentry', 'async'] as const)
  it(`rejects ${mutation} admission before output publication`, () => {
    const p = liveSplitFixture(),
      mappings = structuredClone(route);
    expect(() =>
      prepareTimelineFrameMove(p, mappings, 8, 8, 6, () => {
        if (mutation === 'source') p.background = '#000000';
        if (mutation === 'input') mappings[0].targetId = 'missing';
        if (mutation === 'reentry') {
          try {
            move(p, 8, 5);
          } catch {
            /* swallowed reentry still invalidates */
          }
        }
        if (mutation === 'async') return Promise.resolve() as unknown as void;
      }),
    ).toThrow();
    expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
    expect(p.layers[0].liveMotionSpans![0].end).toBe(8);
  });

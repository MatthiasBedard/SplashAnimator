import { afterEach, expect, it, vi } from 'vitest';
import { newLayer, validateProject, type Project } from '../packages/document/src';
import { createMotionFrameSampler, motionProgress } from '../packages/animation/src/motion-frames';
import {
  prepareTimelineFrameInsertion,
  prepareTimelineKeyframe,
} from '../apps/editor/src/timeline-keyframe';
import { prepareTimelineTween } from '../apps/editor/src/timeline-tween';
import { liveSplitFixture } from './live-motion-split-fixture';
import { movieSplitFixture } from './live-movie-split-fixture';
import { liveMovieTreesFixture } from './live-movie-trees-fixture';
import { liveGraphicFixture, createLiveGraphics } from './live-graphics-fixture';

afterEach(() => vi.restoreAllMocks());
function fixture(
  kind: 'motion' | 'shape' = 'motion',
  ease: 'linear' | 'in' | 'out' | 'in-out' = 'linear',
) {
  const p = liveSplitFixture();
  delete p.layers[0].liveMotionSpans;
  const other = newLayer('Untouched');
  other.locked = true;
  p.layers.push(other);
  return prepareTimelineTween(p, 'track', {
    start: 0,
    end: 8,
    kind,
    ease,
    symbolize: kind === 'motion',
    affine: false,
    createEndpoints: false,
  });
}
function expected(p: Project, at: number) {
  const q = structuredClone(p);
  q.duration++;
  q.layers[0].keys = q.layers[0].keys.map((k) => (k.frame > at ? { ...k, frame: k.frame + 1 } : k));
  q.layers[0].liveMotionSpans = q.layers[0].liveMotionSpans!.map((s) => ({
    ...s,
    start: s.start > at ? s.start + 1 : s.start,
    end: s.end > at ? s.end + 1 : s.end,
  }));
  return q;
}
for (const kind of ['motion', 'shape'] as const)
  for (const ease of ['linear', 'in', 'out', 'in-out'] as const)
    for (const at of [0, 4, 8, 9])
      it(`inserts one sparse ${kind} frame at ${at}, ${ease}, without extra keys or artwork changes`, () => {
        const p = fixture(kind, ease),
          before = structuredClone(p),
          out = prepareTimelineFrameInsertion(p, 'track', at, 'frame');
        expect(out).toEqual(expected(before, at));
        expect(p).toEqual(before);
        validateProject(out);
        const span = out.layers[0].liveMotionSpans![0],
          sampler = createMotionFrameSampler(out, 'track', span);
        try {
          for (let t = span.start + 1; t < span.end; t++)
            expect(sampler.sample(t)[0].x).toBeCloseTo(
              8 + 80 * motionProgress((t - span.start) / (span.end - span.start), ease),
              9,
            );
        } finally {
          sampler.dispose();
        }
        out.layers[0].keys[0].shapes[0].x++;
        expect(p).toEqual(before);
      });
for (const at of [0, 1])
  it(`shifts a future sparse tween as a whole after inserting at ${at}`, () => {
    const p = fixture();
    p.layers[0].keys = p.layers[0].keys.map((k) => ({ ...k, frame: k.frame + 2 }));
    p.layers[0].keys.unshift({ frame: 0, shapes: [] });
    p.duration += 2;
    p.layers[0].liveMotionSpans![0].start += 2;
    p.layers[0].liveMotionSpans![0].end += 2;
    const before = structuredClone(p),
      out = prepareTimelineFrameInsertion(p, 'track', at, 'frame');
    expect(out).toEqual(expected(before, at));
    expect(p).toEqual(before);
  });
for (const at of [3, 4])
  it(`retimes connected sparse intervals through their original shared endpoint at ${at}`, () => {
    const p = prepareTimelineKeyframe(fixture(), 'track', 4),
      before = structuredClone(p),
      out = prepareTimelineFrameInsertion(p, 'track', at, 'frame');
    expect(out).toEqual(expected(before, at));
    for (const span of out.layers[0].liveMotionSpans!) {
      const sampler = createMotionFrameSampler(out, 'track', span);
      sampler.dispose();
    }
    expect(p).toEqual(before);
  });
it('retains original route and separate opacity easing while retiming a live span', () => {
  const p = fixture('shape', 'in'),
    s = p.layers[0].liveMotionSpans![0];
  s.path = { startX: 20, startY: -20, endX: -20, endY: -20 };
  s.opacityEase = 'out';
  const before = structuredClone(p),
    out = prepareTimelineFrameInsertion(p, 'track', 4, 'frame');
  expect(out).toEqual(expected(before, 4));
  expect(p).toEqual(before);
});
it('rejects unqualified original geometry without consuming the original sparse source', () => {
  const p = fixture('shape');
  p.layers[0].keys[1].shapes[0].transform = [-1, 0, 0, 1];
  p.layers[0].liveMotionSpans![0].options = {
    ...p.layers[0].liveMotionSpans![0].options,
    affine: true,
  };
  const before = structuredClone(p);
  expect(() => prepareTimelineFrameInsertion(p, 'track', 4, 'frame')).toThrow();
  expect(p).toEqual(before);
});
it('allows hidden unlocked tween timing edits without altering visibility or lock metadata', () => {
  const p = fixture();
  p.layers[0].visible = false;
  const before = structuredClone(p),
    out = prepareTimelineFrameInsertion(p, 'track', 4, 'frame');
  expect(out).toEqual(expected(before, 4));
  expect(p).toEqual(before);
});
for (const change of ['source', 'context', 'candidate'] as const)
  it(`rejects actual late ${change} edits after sparse timing is prepared`, () => {
    const p = fixture(),
      before = structuredClone(p),
      native = structuredClone;
    let fired = false;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, ...rest) => {
      const q = value as Project;
      if (!fired && q?.layers?.[0]?.liveMotionSpans?.[0]?.end === 9) {
        fired = true;
        if (change === 'source') p.name = 'User edit';
        if (change === 'candidate') q.layers[0].keys[0].shapes[0].x++;
      }
      return native(value, ...rest);
    });
    expect(() =>
      prepareTimelineFrameInsertion(p, 'track', 4, 'frame', () => {
        if (fired && change === 'context') throw Error('Timeline changed');
      }),
    ).toThrow();
    expect(fired).toBe(true);
    expect(p.layers).toEqual(before.layers);
    expect(p.duration).toBe(before.duration);
    vi.restoreAllMocks();
    expect(prepareTimelineFrameInsertion(p, 'track', 4, 'frame').duration).toBe(p.duration + 1);
  });
it('rejects maximum-duration insertion without retiming any sparse key', () => {
  const p = fixture();
  p.duration = 100000;
  const before = structuredClone(p);
  expect(() => prepareTimelineFrameInsertion(p, 'track', 4, 'frame')).toThrow(/limit/);
  expect(p).toEqual(before);
});
for (const basis of ['plain', 'reflected'])
  for (const tree of [false, true])
    it(`retains ${tree ? 'nested' : 'root'} movie clocks, library and artwork while inserting time (${basis})`, () => {
      const p = tree ? liveMovieTreesFixture(basis, 'loop') : movieSplitFixture(basis),
        before = structuredClone(p),
        out = prepareTimelineFrameInsertion(p, 'track', 6, 'frame');
      expect(out).toEqual(expected(before, 6));
      expect(p).toEqual(before);
    });
for (const mode of ['once', 'single'])
  it(`retimes a phase-compatible animated graphic with exact endpoint settings (${mode})`, () => {
    const { p, span } = liveGraphicFixture(mode, 'reflected'),
      source = createLiveGraphics(p, span),
      before = structuredClone(source),
      out = prepareTimelineFrameInsertion(source, 'track', 6, 'frame');
    expect(out).toEqual(expected(before, 6));
    expect(source).toEqual(before);
  });
it('retains the existing discontinuous animated-graphic clock guard atomically', () => {
  const { p, span } = liveGraphicFixture('loop'),
    source = createLiveGraphics(p, span),
    before = structuredClone(source);
  expect(() => prepareTimelineFrameInsertion(source, 'track', 6, 'frame')).toThrow(/clock/);
  expect(source).toEqual(before);
  expect(prepareTimelineFrameInsertion(source, 'track', 0, 'frame')).toEqual(expected(before, 0));
});
it('extends a complete rigid group without changing member hierarchy or pivots', () => {
  const p = liveSplitFixture();
  delete p.layers[0].liveMotionSpans;
  for (const key of p.layers[0].keys)
    if (key.shapes.length) {
      const a = key.shapes[0];
      a.groups = ['outer', 'inner'];
      a.pivot = { x: -8, y: 12 };
      key.shapes.push({ ...structuredClone(a), id: 'member', x: a.x + 30, groups: ['outer'] });
    }
  const source = prepareTimelineTween(p, 'track', {
      start: 0,
      end: 8,
      kind: 'motion',
      ease: 'linear',
      affine: false,
      createEndpoints: false,
    }),
    before = structuredClone(source),
    out = prepareTimelineFrameInsertion(source, 'track', 4, 'frame');
  expect(out).toEqual(expected(before, 4));
  expect(source).toEqual(before);
});

import { it, expect } from 'vitest';
import { newProject, newLayer, type Vector } from '../packages/document/src';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import {
  createBasicMotionSpan,
  motionInteriorBaseline,
} from '../packages/animation/src/motion-spans';
import {
  prepareTimelineTween,
  timelineTweenRange,
  tweenLayerLabel,
  type TimelineTweenInput,
} from '../apps/editor/src/timeline-tween';

function fixture() {
  const p = newProject();
  p.duration = 12;
  p.fps = 4;
  const shape: Vector = {
    id: 'a',
    kind: 'rectangle',
    x: 20,
    y: 30,
    width: 40,
    height: 40,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [shape] },
    { frame: 8, shapes: [{ ...structuredClone(shape), x: 100, y: 70 }] },
    { frame: 10, shapes: [] },
  ];
  return p;
}
const input = (kind: 'motion' | 'shape', start = 0, end = 8): TimelineTweenInput => ({
  kind,
  start,
  end,
  affine: false,
  createEndpoints: true,
  ease: 'linear',
});
for (const kind of ['motion', 'shape'] as const)
  it(`creates a detached ${kind} tween and preserves all authored keys/settings`, () => {
    const p = fixture(),
      before = structuredClone(p),
      result = prepareTimelineTween(p, p.layers[0].id, input(kind));
    expect(p).toEqual(before);
    expect(result.layers[0].keys).toEqual(p.layers[0].keys);
    expect(result.duration).toBe(p.duration);
    expect(tweenLayerLabel(result.layers[0])).toBe(
      kind === 'shape' ? 'Shape tween' : 'Motion tween',
    );
    const sample = createMotionFrameSampler(
      result,
      result.layers[0].id,
      result.layers[0].liveMotionSpans![0],
    );
    expect(sample.sample(4)[0].x).toBe(60);
    sample.dispose();
  });
it('shape tweens interpolate compatible node geometry, dimensions and paint without baking keys', () => {
  const p = fixture();
  Object.assign(p.layers[0].keys[1].shapes[0], { width: 80, height: 60, fill: '#0000ff' });
  const q = prepareTimelineTween(p, p.layers[0].id, input('shape')),
    sample = createMotionFrameSampler(q, q.layers[0].id, q.layers[0].liveMotionSpans![0]);
  expect(sample.sample(4)[0]).toMatchObject({ width: 60, height: 50, fill: '#800080' });
  expect(q.layers[0].keys.length).toBe(3);
  sample.dispose();
});
it('creates matching endpoints on a single-key layer without extending duration', () => {
  const p = fixture();
  p.layers[0].keys = [p.layers[0].keys[0]];
  const range = timelineTweenRange(p, p.layers[0].id, 2);
  expect(range).toEqual({ start: 0, end: 4 });
  const q = prepareTimelineTween(p, p.layers[0].id, input('motion', range.start, range.end));
  expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 4]);
  expect(q.layers[0].keys[1].shapes).toEqual(p.layers[0].keys[0].shapes);
  expect(p.layers[0].keys).toHaveLength(1);
  expect(q.duration).toBe(12);
});
it('preserves a blank exposure after a held tween', () => {
  const p = fixture();
  p.layers[0].keys.splice(1, 1);
  expect(timelineTweenRange(p, p.layers[0].id, 2)).toEqual({ start: 0, end: 9 });
  const q = prepareTimelineTween(p, p.layers[0].id, input('shape', 0, 9));
  expect(q.layers[0].keys.at(-1)).toEqual(p.layers[0].keys.at(-1));
});
it('converts only one complete existing live range and preserves its identity/path/easing and outside keys', () => {
  const p = fixture(),
    a = prepareTimelineTween(p, p.layers[0].id, input('motion'));
  const span = a.layers[0].liveMotionSpans![0];
  span.path = { startX: 0, startY: 0, endX: 5, endY: 10 };
  const q = prepareTimelineTween(a, a.layers[0].id, { ...input('shape'), ease: 'in' }),
    converted = q.layers[0].liveMotionSpans![0];
  expect(converted.id).toBe(span.id);
  expect(converted.path).toEqual(span.path);
  expect(converted.ease).toBe('in');
  expect(q.layers[0].keys).toEqual(p.layers[0].keys);
});
it('converts owned generated keys to sparse motion without discarding authored edits', () => {
  const p = fixture();
  createBasicMotionSpan(p, [p.layers[0].id], 0, 8, 'linear');
  const before = structuredClone(p);
  const q = prepareTimelineTween(p, p.layers[0].id, input('motion'));
  expect(q.layers[0].motionSpans).toBeUndefined();
  expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  expect(p).toEqual(before);
  p.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x++;
  expect(() => prepareTimelineTween(p, p.layers[0].id, input('shape'))).toThrow(/changed|recipe/);
});
for (const failure of [
  'locked',
  'hidden',
  'blank',
  'interior',
  'mismatched',
  'overlap',
  'no endpoints',
  'NaN',
  'out of range',
] as const)
  it(`rejects ${failure} atomically`, () => {
    const p = fixture(),
      request = input('motion');
    if (failure === 'locked') p.layers[0].locked = true;
    if (failure === 'hidden') p.layers[0].visible = false;
    if (failure === 'blank') p.layers[0].keys[1].shapes = [];
    if (failure === 'interior')
      p.layers[0].keys.splice(1, 0, {
        frame: 4,
        shapes: structuredClone(p.layers[0].keys[0].shapes),
      });
    if (failure === 'mismatched') p.layers[0].keys[1].shapes[0].id = 'other';
    if (failure === 'overlap') {
      const q = prepareTimelineTween(p, p.layers[0].id, input('motion'));
      Object.assign(p, q);
      request.end = 6;
    }
    if (failure === 'no endpoints') {
      request.start = 1;
      request.createEndpoints = false;
    }
    if (failure === 'NaN') request.start = NaN;
    if (failure === 'out of range') request.end = 50;
    const before = structuredClone(p);
    expect(() => prepareTimelineTween(p, p.layers[0].id, request)).toThrow();
    expect(p).toEqual(before);
  });
for (const action of ['source', 'input', 'reentry', 'async'] as const)
  it(`rejects late ${action} admission without losing user changes`, () => {
    const p = fixture(),
      request = input('shape');
    let hit = false;
    expect(() =>
      prepareTimelineTween(p, p.layers[0].id, request, () => {
        if (hit) return;
        hit = true;
        if (action === 'source') p.name = 'User edit';
        if (action === 'input') request.end = 7;
        if (action === 'reentry')
          try {
            prepareTimelineTween(p, p.layers[0].id, request);
          } catch {}
        if (action === 'async') return Promise.resolve();
      }),
    ).toThrow();
    expect(p.layers[0].liveMotionSpans).toBeUndefined();
    if (action === 'source') expect(p.name).toBe('User edit');
  });
it('preserves unrelated layers and outline preferences', () => {
  const p = fixture();
  p.layers[0].outline = true;
  p.layers[0].outlineColor = '#ff00ff';
  const other = newLayer('Other');
  p.layers.push(other);
  const q = prepareTimelineTween(p, p.layers[0].id, input('shape'));
  expect(q.layers[1]).toEqual(other);
  expect(q.layers[0].outlineColor).toBe('#ff00ff');
  expect(q.layers[0].outline).toBe(true);
});

it('rejects a regenerated ownership baseline that conceals edited generated artwork', () => {
  const p = fixture();
  createBasicMotionSpan(p, [p.layers[0].id], 0, 8, 'linear');
  p.layers[0].keys.find((k) => k.frame === 4)!.shapes[0].x += 20;
  p.layers[0].motionSpans![0].baseline = motionInteriorBaseline(
    p.layers[0].keys.filter((k) => k.frame > 0 && k.frame < 8),
  );
  const before = structuredClone(p);
  expect(() => prepareTimelineTween(p, p.layers[0].id, input('motion'))).toThrow(/recipe/);
  expect(p).toEqual(before);
});

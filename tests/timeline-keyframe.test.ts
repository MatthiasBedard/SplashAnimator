import { prepareMaskLayer } from '../packages/document/src/mask-authoring';
import { expect, it, vi, afterEach } from 'vitest';
import {
  newProject,
  newLayer,
  validateProject,
  type Project,
  type Vector,
} from '../packages/document/src';
import { prepareTimelineTween } from '../apps/editor/src/timeline-tween';
import {
  prepareTimelineFrameInsertion,
  prepareTimelineKeyframe,
} from '../apps/editor/src/timeline-keyframe';
import { timelineTweenCell, tweenCellKind } from '../apps/editor/src/timeline-tween-cell';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { splitLiveMotionLayer } from '../packages/animation/src/live-motion-split';
import { editLayerFrameRanges, removeLayerKeyframes } from '../packages/animation/src/timeline';
afterEach(() => vi.restoreAllMocks());
function fixture(
  kind: 'motion' | 'shape' = 'motion',
  ease: 'linear' | 'in' | 'out' = 'linear',
  type = 'root',
) {
  const p = newProject();
  p.duration = 12;
  const a: Vector = {
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
  let first = [a];
  if (type === 'group')
    first = [
      { ...a, groups: ['g'] },
      { ...a, id: 'b', x: 70, groups: ['g'] },
    ];
  if (['graphic', 'movie', 'tree'].includes(type)) {
    p.symbols = [
      {
        id: 'def',
        name: 'Definition',
        width: 40,
        height: 40,
        shapes: [{ ...a, id: 'leaf', x: 0, y: 0 }],
        timeline: {
          duration: 3,
          keys: [{ frame: 2, shapes: [{ ...a, id: 'leaf', x: 0, y: 0, fill: '#0000ff' }] }],
        },
      },
    ];
    if (type === 'tree')
      p.symbols.push({
        id: 'outer',
        name: 'Outer',
        width: 40,
        height: 40,
        shapes: [
          {
            ...a,
            id: 'child',
            kind: 'symbol',
            symbolId: 'def',
            x: 0,
            y: 0,
            symbolPlayback: { mode: 'movie', firstFrame: 0 },
          },
        ],
      });
    first = [
      {
        ...a,
        kind: 'symbol',
        symbolId: type === 'tree' ? 'outer' : 'def',
        ...(type !== 'graphic'
          ? { symbolPlayback: { mode: 'movie' as const, firstFrame: 0 } }
          : {}),
      },
    ];
  }
  p.layers[0].keys = [
    { frame: 0, shapes: first },
    {
      frame: 8,
      shapes: first.map((s) => ({
        ...structuredClone(s),
        x: s.x + 80,
        ...(kind === 'shape' ? { width: 80, fill: '#0000ff' } : {}),
        ...(type === 'graphic' ? { symbolPlayback: { mode: 'loop' as const, firstFrame: 2 } } : {}),
      })),
    },
    { frame: 10, shapes: [] },
  ];
  p.layers.push(newLayer('Untouched'));
  return prepareTimelineTween(p, p.layers[0].id, {
    start: 0,
    end: 8,
    kind,
    affine: false,
    createEndpoints: false,
    ease,
  });
}
function poses(p: Project) {
  const layer = p.layers[0];
  return Array.from({ length: 9 }, (_, frame) => {
    const key = layer.keys.find((k) => k.frame === frame);
    if (key) return key.shapes;
    const span = layer.liveMotionSpans!.find((s) => s.start < frame && frame < s.end)!;
    const plan = createMotionFrameSampler(p, layer.id, span);
    try {
      return plan.sample(frame);
    } finally {
      plan.dispose();
    }
  });
}
for (const kind of ['motion', 'shape'] as const)
  for (const ease of ['linear', 'in', 'out'] as const)
    for (const at of [1, 2, 3, 4, 5, 6, 7])
      it(`inserts ${kind} ${ease} frame ${at} with the exact promoted pose and untouched source`, () => {
        const p = fixture(kind, ease),
          before = structuredClone(p),
          original = poses(p),
          result = prepareTimelineKeyframe(p, p.layers[0].id, at);
        expect(p).toEqual(before);
        validateProject(result);
        expect(result.layers[0].keys.map((k) => k.frame)).toEqual([0, at, 8, 10]);
        expect(result.layers[0].keys.find((k) => k.frame === at)!.shapes).toEqual(original[at]);
        expect(result.layers[1]).toEqual(p.layers[1]);
        expect(result.assets).toEqual(p.assets);
        poses(result).forEach((art, i) =>
          expect(
            sameMotionArtwork(
              original[i].map((s) => ({ ...s, fill: '' })),
              art.map((s) => ({ ...s, fill: '' })),
            ),
          ).toBe(true),
        );
        expect(result.layers[0].liveMotionSpans).toHaveLength(at === 1 || at === 7 ? 1 : 2);
        result.layers[0].keys[1].shapes[0].x = 999;
        expect(p).toEqual(before);
      });
for (const type of ['group', 'graphic', 'movie', 'tree'])
  for (const at of [1, 4, 7])
    it(`promotes original ${type} artwork at frame ${at} through its qualified split kernel`, () => {
      const p = fixture('motion', 'linear', type),
        before = structuredClone(p),
        original = poses(p),
        result = prepareTimelineKeyframe(p, p.layers[0].id, at);
      expect(p).toEqual(before);
      expect(result.symbols).toEqual(before.symbols);
      validateProject(result);
      poses(result).forEach((art, i) => expect(sameMotionArtwork(original[i], art)).toBe(true));
    });
for (const kind of ['motion', 'shape'] as const)
  it(`continues a ${kind} into an adjacent interval and stops at a plain or blank key`, () => {
    const p = fixture(kind, 'in');
    const { id, keys, liveMotionSpans } = p.layers[0];
    const result = prepareTimelineKeyframe(p, id, 9);
    const continued = result.layers[0].liveMotionSpans![1];
    expect(continued).toMatchObject({ start: 8, end: 9, ease: 'linear' });
    expect(tweenCellKind(continued)).toBe(kind);
    expect(result.layers[0].liveMotionSpans![0]).toEqual(liveMotionSpans![0]);
    expect(result.layers[0].keys).toEqual([...keys.slice(0, 2), { ...keys[1], frame: 9 }, keys[2]]);
    expect(timelineTweenCell(result.layers[0], 8)?.span).toBe(continued);
    expect(timelineTweenCell(result.layers[0], 10)).toBeUndefined();
    const removed = prepareTimelineFrameInsertion(result, id, 9, `remove-${kind}`);
    expect(removed.layers[0].keys).toEqual(result.layers[0].keys);
    expect(removed.layers[0].liveMotionSpans).toEqual(liveMotionSpans);
    expect(timelineTweenCell(removed.layers[0], 9)).toBeUndefined();
    for (const action of ['plain', 'blank'] as const) {
      const stopped = prepareTimelineFrameInsertion(p, id, 9, action);
      expect(stopped.layers[0].keys[2].shapes).toEqual(action === 'blank' ? [] : keys[1].shapes);
      expect(stopped.layers[0].liveMotionSpans).toEqual(liveMotionSpans);
      expect(timelineTweenCell(stopped.layers[0], 9)).toBeUndefined();
    }
  });
it('keeps graphic exposure age when a new key continues a tween', () => {
  const p = fixture('motion', 'linear', 'graphic');
  const result = prepareTimelineKeyframe(p, p.layers[0].id, 9);
  expect(result.layers[0].keys[2].shapes[0].symbolPlayback).toEqual({
    mode: 'loop',
    firstFrame: 0,
  });
  expect(result.layers[0].liveMotionSpans![1].symbolContinuity).toBe('graphics');
});
it('interpolates new endpoint artwork without retiming the previous shape tween', () => {
  const p = fixture('shape', 'in');
  const layer = p.layers[0];
  layer.keys.pop();
  const result = prepareTimelineKeyframe(p, layer.id, 12);
  const extended = result.layers[0];
  extended.keys[2].shapes[0].width = 120;
  const sampler = createMotionFrameSampler(result, layer.id, extended.liveMotionSpans![1]);
  try {
    expect(sampler.sample(10)[0].width).toBe(100);
  } finally {
    sampler.dispose();
  }
  expect(extended.liveMotionSpans![0]).toEqual(layer.liveMotionSpans![0]);
  expect(extended.keys.slice(0, 2)).toEqual(layer.keys);
});

function rememberedSymbolFixture(end: number) {
  const p = fixture();
  const layer = p.layers[0];
  delete layer.liveMotionSpans;
  layer.keys[1].frame = end;
  p.symbols = [{ id: 'symbol', name: 'Symbol', width: 40, height: 40, shapes: layer.keys[0].shapes }];
  return prepareTimelineTween(p, layer.id, {
    start: 0, end, kind: 'motion', ease: 'linear', affine: true, createEndpoints: false,
  }, undefined, 'symbol');
}

for (const [end, at, ranges] of [
  [8, 1, [[1, 8]]], [8, 4, [[0, 4], [4, 8]]], [8, 7, [[0, 7]]], [2, 1, []],
] as const) {
  it(`promotes only symbol frame ${at} from a remembered tween ending at ${end}`, () => {
    const p = rememberedSymbolFixture(end);
    const before = structuredClone(p);
    const result = prepareTimelineFrameInsertion(p, p.layers[0].id, at, 'key', undefined, 'symbol');
    expect(p).toEqual(before);
    expect(result.layers[0].keys).toEqual(before.layers[0].keys);
    expect(result.layers[1]).toEqual(before.layers[1]);
    const spans = result.layers[0].motionSpans ?? [];
    expect(spans.map(({ start, end }) => [start, end])).toEqual(ranges);
    expect(spans[0]?.id).toBe(ranges.length ? before.layers[0].motionSpans![0].id : undefined);
    expect(spans.every(span => span.autoRefresh)).toBe(true);
    validateProject(result);
  });
}

it('rejects blank and stale generated symbol key promotions without editing the tween', () => {
  const p = rememberedSymbolFixture(8);
  const { id, keys } = p.layers[0];
  expect(() => prepareTimelineFrameInsertion(p, id, 4, 'blank', undefined, 'symbol')).toThrow('blank key');
  keys[3].shapes[0].x += 1;
  const before = structuredClone(p);
  expect(() => prepareTimelineFrameInsertion(p, id, 4, 'key', undefined, 'symbol')).toThrow(/generated keys/i);
  expect(p).toEqual(before);
});

for (const at of [1, 4, 7]) {
  it(`removes authored symbol frame ${at} and reconnects the original tween`, () => {
    const original = rememberedSymbolFixture(8);
    const { id } = original.layers[0];
    const split = prepareTimelineFrameInsertion(original, id, at, 'key', undefined, 'symbol');
    removeLayerKeyframes(split, [id], at, at, 'symbol');
    expect(split).toEqual(original);
  });
}

it('clears several symbol tween keys at once and then removes the ending key without shifting time', () => {
  const original = rememberedSymbolFixture(8);
  const { id, keys } = original.layers[0];
  const first = prepareTimelineFrameInsertion(original, id, 4, 'key', undefined, 'symbol');
  const split = prepareTimelineFrameInsertion(first, id, 2, 'key', undefined, 'symbol');
  removeLayerKeyframes(split, [id], 1, 7, 'symbol');
  expect(split).toEqual(original);
  removeLayerKeyframes(split, [id], 8, 8, 'symbol');
  expect(split.layers[0].keys).toEqual([keys[0], keys.at(-1)]);
  expect(split.layers[0].motionSpans).toBeUndefined();
  expect(split.duration).toBe(original.duration);
});

it('ignores generated symbol samples and rejects a stale adjacent recipe atomically across tracks', () => {
  const original = rememberedSymbolFixture(8);
  const { id } = original.layers[0];
  const split = prepareTimelineFrameInsertion(original, id, 4, 'key', undefined, 'symbol');
  const unchanged = structuredClone(split);
  removeLayerKeyframes(split, [id], 1, 3, 'symbol');
  expect(split).toEqual(unchanged);
  split.layers[0].keys[5].shapes[0].x++;
  split.layers[1].keys.push({ frame: 4, shapes: [] });
  const stale = structuredClone(split);
  expect(() => removeLayerKeyframes(split, [split.layers[1].id, id], 4, 4, 'symbol'))
    .toThrow('Generated keys changed');
  expect(split).toEqual(stale);
});

for (const [start, end, from, to, firstX, lastX] of [
  [3, 4, 0, 6, 20, 100], [0, 2, 0, 5, 50, 100], [6, 8, 0, 5, 20, 70],
] as const) {
  it(`deletes automatic symbol tween frames ${start}-${end} and rebuilds the shortened span`, () => {
    const p = rememberedSymbolFixture(8);
    const before = structuredClone(p);
    const { id } = p.layers[0];
    editLayerFrameRanges(p, [id], start, end, 'remove', 'symbol');
    const layer = p.layers[0], [recipe] = layer.motionSpans!;
    expect(recipe).toMatchObject({ id: before.layers[0].motionSpans![0].id, start: from, end: to, autoRefresh: true });
    const spanKeys = layer.keys.filter(key => key.frame <= to);
    expect(spanKeys[0].shapes[0].x).toBe(firstX);
    expect(spanKeys.at(-1)?.shapes[0].x).toBe(lastX);
    expect(JSON.parse(recipe.baseline)).toEqual(spanKeys.slice(1, -1));
    for (const key of spanKeys)
      expect(key.shapes[0].x).toBeCloseTo(firstX + (lastX - firstX) * key.frame / to);
    expect(layer.keys.at(-1)).toEqual({ frame: p.duration - (end - start + 1), shapes: [] });
    expect(p.duration).toBe(before.duration);
    expect(p.layers[1]).toEqual(before.layers[1]);
    expect(p.symbols).toEqual(before.symbols);
  });
}

it('deletes a symbol tween junction and retains each surviving side independently', () => {
  const original = rememberedSymbolFixture(8);
  const { id } = original.layers[0];
  const p = prepareTimelineFrameInsertion(original, id, 4, 'key', undefined, 'symbol');
  editLayerFrameRanges(p, [id], 4, 4, 'remove', 'symbol');
  const layer = p.layers[0];
  expect(layer.motionSpans?.map(span => [span.start, span.end])).toEqual([[0, 3], [4, 7]]);
  expect(layer.keys.slice(0, 8).map(key => key.shapes[0].x)).toEqual([20, 30, 40, 50, 70, 80, 90, 100]);
});

it('drops zero-interior symbol recipes and preserves manual or edited recipes on rejected deletes', () => {
  const p = rememberedSymbolFixture(2), { id } = p.layers[0];
  const shortened = structuredClone(p);
  editLayerFrameRanges(shortened, [id], 1, 1, 'remove', 'symbol');
  expect(shortened.layers[0].motionSpans).toBeUndefined();
  expect(shortened.layers[0].keys.slice(0, 2)).toEqual([p.layers[0].keys[0], { ...p.layers[0].keys[2], frame: 1 }]);
  for (const manual of [true, false]) {
    const protectedProject = rememberedSymbolFixture(8), [source, other] = protectedProject.layers;
    if (manual) source.motionSpans![0].autoRefresh = false;
    else source.keys[3].shapes[0].x++;
    const before = structuredClone(protectedProject);
    expect(() => editLayerFrameRanges(protectedProject, [other.id, source.id], 3, 4, 'remove', 'symbol'))
      .toThrow(manual ? 'Cannot remove part' : 'Generated keys changed');
    expect(protectedProject).toEqual(before);
  }
});

it('removes a remembered tween from its held exposure and retains the baked artwork', () => {
  const p = fixture();
  const layer = p.layers[0];
  delete layer.liveMotionSpans;
  createBasicMotionSpan(p, [layer.id], 0, 8, 'linear');
  expect(timelineTweenCell(layer, 9)?.span).toBe(layer.motionSpans![0]);
  const result = prepareTimelineFrameInsertion(p, layer.id, 9, 'remove-motion');
  expect(result.layers[0].keys).toEqual(layer.keys);
  expect(result.layers[0].motionSpans).toBeUndefined();
  expect(result.layers[1]).toEqual(p.layers[1]);
});
it('does not change existing endpoint keys and retains legacy dedicated split limits', () => {
  const p = fixture(),
    layer = p.layers[0];
  expect(prepareTimelineKeyframe(p, layer.id, 0)).toEqual(p);
  expect(prepareTimelineKeyframe(p, layer.id, 8)).toEqual(p);
  expect(() => splitLiveMotionLayer(p, layer, layer.liveMotionSpans![0], 1, 'right')).toThrow(
    /three frames/,
  );
});
it('repeated insertion reaches adjacent frames without invalid one-interval recipes', () => {
  let p = fixture();
  const original = poses(p);
  for (const at of [1, 7, 4, 3, 2, 5, 6]) p = prepareTimelineKeyframe(p, p.layers[0].id, at);
  expect(p.layers[0].liveMotionSpans).toEqual([]);
  poses(p).forEach((art, i) => expect(sameMotionArtwork(original[i], art)).toBe(true));
  validateProject(p);
});
for (const at of [-1, 100000, NaN, Infinity, 1.2])
  it(`rejects raw invalid target ${at} atomically`, () => {
    const p = fixture(),
      before = structuredClone(p);
    expect(() => prepareTimelineKeyframe(p, p.layers[0].id, at)).toThrow();
    expect(p).toEqual(before);
  });
it('rejects locks, blank tween endpoints and unsafe source data without writes', () => {
  const p = fixture();
  expect(() => prepareTimelineKeyframe(p, p.layers[0].id, 4, true)).toThrow(/blank key/i);
  p.layers[0].locked = true;
  expect(() => prepareTimelineKeyframe(p, p.layers[0].id, 4)).toThrow(/locked/);
  p.layers[0].locked = false;
  Object.defineProperty(p.layers[0], 'name', {
    get() {
      throw Error('must not read');
    },
    enumerable: true,
  });
  expect(() => prepareTimelineKeyframe(p, p.layers[0].id, 4)).toThrow();
});
it('rejects source changes and swallowed reentry, then permits a fresh retry', () => {
  const p = fixture();
  let calls = 0;
  expect(() =>
    prepareTimelineKeyframe(p, p.layers[0].id, 4, false, () => {
      if (++calls === 3) p.name = 'User edit';
    }),
  ).toThrow(/changed/);
  expect(p.name).toBe('User edit');
  expect(p.layers[0].keys).toHaveLength(3);
  expect(() =>
    prepareTimelineKeyframe(p, p.layers[0].id, 4, false, () => {
      try {
        prepareTimelineKeyframe(p, p.layers[0].id, 3);
      } catch {
        /* swallowed */
      }
    }),
  ).toThrow(/reentered/);
  expect(prepareTimelineKeyframe(p, p.layers[0].id, 4).layers[0].keys).toHaveLength(4);
});
it('rejects a late completed-output clone edit without modifying the original', () => {
  const p = fixture(),
    before = structuredClone(p),
    native = structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, ...rest) => {
    const out = native(value, ...rest) as Project;
    if (out?.layers?.[0]?.keys?.some((k) => k.frame === 4)) out.layers[0].name = 'Tampered clone';
    return out;
  });
  expect(() => prepareTimelineKeyframe(p, p.layers[0].id, 4)).toThrow(/candidate changed/);
  expect(p).toEqual(before);
});

it('reauthors quantized paint on the adjacent shape segments while keeping the inserted and existing keys exact', () => {
  const p = fixture('shape'),
    original = poses(p),
    out = prepareTimelineKeyframe(p, p.layers[0].id, 4),
    after = poses(out);
  expect(after[4]).toEqual(original[4]);
  expect(after[0]).toEqual(original[0]);
  expect(after[8]).toEqual(original[8]);
  expect(after.some((art, i) => art[0].fill !== original[i][0].fill)).toBe(true);
  expect(
    out.layers[0].liveMotionSpans!.every(
      (s) => JSON.stringify(s.options) === JSON.stringify(p.layers[0].liveMotionSpans![0].options),
    ),
  ).toBe(true);
});
for (const at of [1, 3, 7])
  it(`inserts into ease-in-out at ${at} without requiring the midpoint-only preserved split`, () => {
    const p = fixture();
    p.layers[0].liveMotionSpans![0].ease = 'in-out';
    validateProject(p);
    const expected = poses(p)[at];
    const out = prepareTimelineKeyframe(p, p.layers[0].id, at);
    expect(out.layers[0].keys.find((k) => k.frame === at)!.shapes).toEqual(expected);
    validateProject(out);
  });

for (const type of ['root', 'group', 'graphic', 'movie', 'tree'])
  it(`preserves saved layer masks while authoring a ${type} tween key`, () => {
    const p = fixture('motion', 'linear', type),
      source = p.layers[0],
      mask = p.layers[1];
    const q = prepareMaskLayer(p, mask.id, true),
      before = structuredClone(q),
      result = prepareTimelineKeyframe(q, source.id, 4);
    expect(result.layerMasks).toEqual(q.layerMasks);
    expect(result.layers[0].keys.some((k) => k.frame === 4)).toBe(true);
    expect(result.layers[1]).toEqual(mask);
    validateProject(result);
    expect(q).toEqual(before);
  });

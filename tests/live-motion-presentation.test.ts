import { expect, it, vi } from 'vitest';
import { livePresentationFixture } from './live-motion-presentation-fixture';
import { prepareLiveMotionFrameCapture as prepare } from '../packages/animation/src/live-motion-presentation';
import { prepareRememberedChildrenCapture } from '../packages/animation/src/motion-capture';
import { evaluate } from '../packages/animation/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { keyAt, type Project } from '../packages/document/src';

for (const rememberedChildren of [false, true])
  it(`prepares one live pose with exact outside origins and explicit children ${rememberedChildren}`, async () => {
    const p = livePresentationFixture(),
      before = structuredClone(p),
      reader = () => ({ project: p, revision: 2 });
    const view = await prepare(reader, 2, { rememberedChildren });
    expect(keyAt(view.layers[0], 2).shapes[0].x).toBe(40);
    expect(view.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 4, 8]);
    expect(view.layers[0].keys.filter((k) => k.frame !== 2)).toEqual(p.layers[0].keys);
    expect(view.layers[0].liveMotionSpans).toBeUndefined();
    expect(view.layers[1]).toEqual(p.layers[1]);
    expect(evaluate(view, 2).find((s) => s.fill === '#0000ff')!.x).toBe(
      rememberedChildren ? 30 : 20,
    );
    expect(view.symbols![0].timeline!.motionSpans).toEqual(p.symbols![0].timeline!.motionSpans);
    expect(p).toEqual(before);
    view.layers[0].keys[0].shapes[0].x = 999;
    view.symbols![0].shapes[0].x = 888;
    expect(p).toEqual(before);
  });
for (const frame of [0, 4, 6, 8, 9])
  it(`keeps authored endpoints/holds/blank exposure origins exact at ${frame}`, async () => {
    const p = livePresentationFixture(),
      view = await prepare(() => ({ project: p, revision: 0 }), frame);
    expect(view.layers[0].keys).toEqual(p.layers[0].keys);
    expect(view.layers[1].keys).toEqual(p.layers[1].keys);
    expect(evaluate(view, frame)).toEqual(evaluate(p, frame));
  });
it('does not refresh or reinterpret stale baked root recipes while preparing children', async () => {
  const p = livePresentationFixture(),
    baked = structuredClone(p.layers[0]);
  baked.id = 'baked';
  delete baked.liveMotionSpans;
  p.layers.push(baked);
  createBasicMotionSpan(p, ['baked'], 0, 4, 'linear');
  p.layers[2].keys[4].shapes[0].x = 160;
  const before = structuredClone(p),
    view = await prepare(() => ({ project: p, revision: 0 }), 2, { rememberedChildren: true });
  expect(view.layers[2]).toEqual(p.layers[2]);
  expect(keyAt(view.layers[2], 2).shapes[0].x).toBe(40);
  expect(p).toEqual(before);
});
it('the child-only helper preserves all original roots and has no default effect on the legacy helper', async () => {
  const p = livePresentationFixture(),
    before = structuredClone(p);
  const view = await prepareRememberedChildrenCapture(p);
  expect(view.layers).toEqual(before.layers);
  expect(view.symbols![0].timeline!.keys[1].shapes[0].x).toBe(60);
  expect(p).toEqual(before);
});
it('supports hidden/locked root tracks and preserves unused child definitions exactly', async () => {
  const p = livePresentationFixture();
  p.layers[0].locked = true;
  p.symbols!.push({ ...structuredClone(p.symbols![0]), id: 'unused' });
  const view = await prepare(() => ({ project: p, revision: 1 }), 2, { rememberedChildren: true });
  expect(view.layers[0].locked).toBe(true);
  expect(view.symbols![1]).toEqual(p.symbols![1]);
  p.layers[0].visible = false;
  const hidden = await prepare(() => ({ project: p, revision: 2 }), 2);
  expect(hidden.layers[0].keys).toEqual(p.layers[0].keys);
});
for (const frame of [NaN, Infinity, -1, 0.5, 10])
  it(`rejects raw frame ${frame}`, async () => {
    const p = livePresentationFixture();
    await expect(prepare(() => ({ project: p, revision: 0 }), frame)).rejects.toThrow();
  });
for (const field of ['signal', 'rememberedChildren', 'validate', 'unknown'])
  it(`rejects malformed ${field} options`, async () => {
    const p = livePresentationFixture();
    await expect(
      prepare(() => ({ project: p, revision: 0 }), 2, { [field]: 'bad' }),
    ).rejects.toThrow();
  });
it('captures one-shot option getters before rechecking original source', async () => {
  const p = livePresentationFixture();
  let reads = 0;
  await expect(
    prepare(() => ({ project: p, revision: 0 }), 2, {
      get rememberedChildren() {
        reads++;
        p.background = '#000000';
        return false;
      },
    }),
  ).rejects.toThrow(/source/);
  expect(reads).toBe(1);
  expect(p.layers[0].keys).toHaveLength(3);
});
for (const mode of ['revision', 'source', 'async', 'abort'])
  it(`rejects ${mode} admission without returning a partial project`, async () => {
    const p = livePresentationFixture(),
      controller = new AbortController();
    let revision = 0;
    await expect(
      prepare(() => ({ project: p, revision }), 2, {
        signal: controller.signal,
        validate: () => {
          if (mode === 'revision') revision++;
          if (mode === 'source') p.background = '#000000';
          if (mode === 'abort') controller.abort();
          if (mode === 'async') return Promise.resolve();
        },
      }),
    ).rejects.toThrow();
    expect(p.layers[0].keys).toHaveLength(3);
  });
it('rejects source descriptor accessors without invoking them', async () => {
  let reads = 0;
  await expect(
    prepare(
      () => ({
        get project() {
          reads++;
          return livePresentationFixture();
        },
        revision: 0,
      }),
      2,
    ),
  ).rejects.toThrow(/data fields/);
  expect(reads).toBe(0);
});
it('observed reader reentry rejects the outer preparation even if the inner rejection is swallowed', async () => {
  const p = livePresentationFixture();
  let nested = false,
    inner: Promise<unknown> | undefined;
  const reader = () => {
    if (!nested) {
      nested = true;
      inner = prepare(reader, 2).catch(() => undefined);
    }
    return { project: p, revision: 0 };
  };
  await expect(prepare(reader, 2)).rejects.toThrow(/data fields/);
  await inner;
});
for (const mode of ['source', 'clone', 'abort'])
  it(`rejects late ${mode} after complete detached child preparation`, async () => {
    const p = livePresentationFixture(),
      before = structuredClone(p),
      controller = new AbortController(),
      clone = structuredClone;
    let hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value);
      if (
        !hit &&
        value &&
        typeof value === 'object' &&
        'layers' in value &&
        !(value as Project).layers[0].liveMotionSpans &&
        (value as Project).layers[0].keys.some((k) => k.frame === 2)
      ) {
        hit = true;
        if (mode === 'source') p.layers[0].keys[0].shapes[0].x = 123;
        if (mode === 'clone') (out as Project).layers[0].keys[1].shapes[0].x = 123;
        if (mode === 'abort') controller.abort();
      }
      return out;
    });
    try {
      await expect(
        prepare(() => ({ project: p, revision: 0 }), 2, {
          rememberedChildren: true,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
      expect(hit).toBe(true);
      if (mode !== 'source') expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
it('invalid prepared children never silently fall back to the ordinary library', async () => {
  const p = livePresentationFixture();
  p.symbols![0].timeline!.keys[1].shapes[0].x = 123;
  const before = structuredClone(p);
  await expect(
    prepare(() => ({ project: p, revision: 0 }), 2, { rememberedChildren: true }),
  ).rejects.toThrow(/Generated keys/);
  expect(p).toEqual(before);
  expect((await prepare(() => ({ project: p, revision: 0 }), 2)).symbols).toEqual(p.symbols);
});

it('fresh presentation reflects supported endpoint edits without adding saved keys or changing old views', async () => {
  const p = livePresentationFixture(),
    reader = () => ({ project: p, revision: 0 }),
    before = await prepare(reader, 2);
  p.layers[0].keys[1].shapes[0].x = 120;
  const fresh = await prepare(reader, 2);
  expect(keyAt(before.layers[0], 2).shapes[0].x).toBe(40);
  expect(keyAt(fresh.layers[0], 2).shapes[0].x).toBe(60);
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8]);
});

it('derived out-of-bounds live geometry rejects the whole presentation, while an exact endpoint can still render', async () => {
  const p = livePresentationFixture();
  p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 30000000, endX: 0, endY: 30000000 };
  const before = structuredClone(p),
    reader = () => ({ project: p, revision: 0 });
  await expect(prepare(reader, 2)).rejects.toThrow(/shape geometry/);
  expect(p).toEqual(before);
  expect((await prepare(reader, 0)).layers[0].keys).toEqual(p.layers[0].keys);
  expect(p).toEqual(before);
});

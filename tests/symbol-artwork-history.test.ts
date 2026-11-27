import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { newProject, clone, type Vector } from '../packages/document/src';
import { captureSymbolLocalProgram } from '../packages/scripting/src/symbol-program';
import {
  createSymbolScriptArtworkProvider,
  querySymbolScriptArtworkTargets as queryTargets,
  prepareSymbolScriptArtworkVisual as prepare,
  renderSymbolScriptArtworkVisual as renderVisual,
  captureSymbolScriptArtworkHistory as capture,
  restoreSymbolScriptArtworkHistory as restore,
} from '../apps/editor/src/symbol-script-artwork';
import { renderScriptArtwork, queryScriptArtworkTargets } from '../apps/editor/src/script-artwork';
vi.mock('../apps/editor/src/script-artwork', () => ({
  renderScriptArtwork: vi.fn(),
  queryScriptArtworkTargets: vi.fn(),
}));
const render = vi.mocked(renderScriptArtwork),
  query = vi.mocked(queryScriptArtworkTargets),
  raw = {
    token: 'button',
    instanceId: 'raw-instance',
    symbolId: 'button',
    name: 'Button',
    lifetime: 1,
  };
function fixture() {
  const project = newProject(),
    art: Vector = {
      id: 'art',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
  project.symbols = [
    {
      id: 'local',
      name: 'Local',
      width: 100,
      height: 60,
      shapes: [{ ...art, kind: 'symbol', symbolId: 'button' }],
      timeline: {
        duration: 3,
        keys: [],
        frameScripts: [{ frame: 0, source: 'throw new Error("inert")' }],
      },
    },
    {
      id: 'button',
      name: 'Button',
      width: 20,
      height: 20,
      shapes: [art],
      buttonStates: { up: 0, over: 1, down: 2, hit: 0 },
      timeline: { duration: 3, keys: [] },
    },
  ];
  const source = {
      project,
      definition: clone(project.symbols[0]),
      revision: 1,
      frame: 0,
      validateEnclosing: () => {},
    },
    owner = captureSymbolLocalProgram(() => source),
    provider = createSymbolScriptArtworkProvider(owner);
  return { source, owner, provider };
}
async function ready() {
  const f = fixture(),
    initial = await f.provider.render([{ frame: 0, tick: 0 }]),
    initialHistory = capture(f.provider, initial),
    proof = await queryTargets(f.provider, initial, [{ x: 5, y: 5 }]),
    image = await renderVisual(
      f.provider,
      prepare(f.provider, initial, proof, 0, 'over', { frame: 0, tick: 1 }),
    ),
    history = capture(f.provider, image);
  return { ...f, initial, initialHistory, image, history };
}
beforeEach(() => {
  render.mockImplementation(async () => new Blob(['png'], { type: 'image/png' }));
  query.mockImplementation(async (_project, poses, points) => ({
    frame: poses.at(-1)!.frame,
    tick: poses.at(-1)!.tick,
    points: points.map((p) => ({ ...p })),
    targets: points.map(() => ({ ...raw })),
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.useRealTimers();
});
it('captures opaque source-owned histories and restores exact states repeatedly with fresh images', async () => {
  const f = await ready(),
    before = clone(f.source.project),
    metadata = f.history.snapshot();
  expect(metadata).toMatchObject({ frame: 0, tick: 1, poseCount: 2, visualPoseCount: 1 });
  expect(JSON.stringify(metadata)).not.toContain('raw-instance');
  metadata.tick = 999;
  const proof = await queryTargets(f.provider, f.image, [{ x: 5, y: 5 }]),
    plan = prepare(f.provider, f.image, proof, 0, 'down', { frame: 0, tick: 2 });
  await renderVisual(f.provider, plan);
  const initial = await restore(f.provider, f.initialHistory);
  expect(render.mock.calls.at(-1)![1]).toEqual([{ frame: 0, tick: 0 }]);
  const old = await queryTargets(f.provider, initial, [{ x: 5, y: 5 }]),
    restored = await restore(f.provider, f.history);
  expect(render.mock.calls.at(-1)![1]).toEqual([
    { frame: 0, tick: 0 },
    {
      frame: 0,
      tick: 1,
      buttonState: { instanceId: raw.instanceId, symbolId: 'button', lifetime: 1, state: 'over' },
    },
  ]);
  const current = await queryTargets(f.provider, restored, [{ x: 5, y: 5 }]);
  expect(current.imageId).not.toBe(old.imageId);
  expect(() => prepare(f.provider, initial, old, 0, 'over', { frame: 0, tick: 1 })).toThrow(
    /stale/,
  );
  expect(() => plan.snapshot()).toThrow(/stale/);
  expect(f.history.snapshot().tick).toBe(1);
  await restore(f.provider, f.history);
  expect(f.source.project).toEqual(before);
  f.owner.dispose();
});
it('rejects copies, serialized histories, foreign providers/images and reopened captures', async () => {
  const a = await ready(),
    b = await ready();
  for (const fake of [{ ...a.provider }, Object.create(a.provider), {}])
    expect(() => capture(fake, a.image)).toThrow(/qualified/);
  for (const image of [a.initial, b.image, new Blob([a.image], { type: 'image/png' })])
    expect(() => capture(a.provider, image)).toThrow(/stale|foreign/);
  for (const fake of [
    { ...a.history },
    Object.create(a.history),
    a.history.snapshot(),
    JSON.parse(JSON.stringify(a.history)),
    b.history,
  ])
    expect(() => restore(a.provider, fake)).toThrow(/qualified/);
  a.provider.dispose();
  expect(() => a.history.snapshot()).toThrow(/disposed/);
  const reopened = createSymbolScriptArtworkProvider(a.owner);
  await reopened.render([{ frame: 0, tick: 0 }]);
  expect(() => restore(reopened, a.history)).toThrow(/qualified/);
  reopened.dispose();
  a.owner.dispose();
  b.owner.dispose();
});
it.each(['candidate', 'source', 'output'])(
  'failed %s restoration preserves current image ownership and private history for retry',
  async (fault) => {
    const f = await ready(),
      proof = await queryTargets(f.provider, f.image, [{ x: 5, y: 5 }]),
      current = await renderVisual(
        f.provider,
        prepare(f.provider, f.image, proof, 0, 'down', { frame: 0, tick: 2 }),
      ),
      currentProof = await queryTargets(f.provider, current, [{ x: 5, y: 5 }]);
    render.mockImplementationOnce(async (_project, poses) => {
      if (fault === 'candidate') poses[1].buttonState!.instanceId = 'forged';
      if (fault === 'source') f.source.revision++;
      return new Blob(['x'], { type: fault === 'output' ? 'text/plain' : 'image/png' });
    });
    await expect(restore(f.provider, f.history)).rejects.toThrow();
    if (fault === 'source') f.source.revision = 1;
    expect((await queryTargets(f.provider, current, [{ x: 5, y: 5 }])).imageId).toBe(
      currentProof.imageId,
    );
    await restore(f.provider, f.history);
    expect(render.mock.calls.at(-1)![1][1].buttonState!.instanceId).toBe('raw-instance');
    f.owner.dispose();
  },
);
it.each(['source', 'reentry'])(
  'rejects actual %s changes while copying a private capture',
  async (fault) => {
    const f = await ready(),
      stringify = JSON.stringify;
    let fired = false,
      error: unknown;
    const hook = vi.spyOn(JSON, 'stringify').mockImplementation((...args) => {
      const value = args[0];
      if (
        !fired &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.hasOwn(value, 'frame') &&
        Object.hasOwn(value, 'tick')
      ) {
        fired = true;
        if (fault === 'source') f.source.revision++;
        else
          try {
            capture(f.provider, f.image);
          } catch {}
      }
      return stringify(...args);
    });
    try {
      capture(f.provider, f.image);
    } catch (cause) {
      error = cause;
    } finally {
      hook.mockRestore();
    }
    expect(fired).toBe(true);
    expect(String(error)).toMatch(/changed|reentered/);
    if (fault === 'source') f.source.revision = 1;
    expect(capture(f.provider, f.image).snapshot().poseCount).toBe(2);
    f.owner.dispose();
  },
);
it('rejects swallowed restoration reentry from option reads before renderer dispatch', async () => {
  const f = await ready(),
    calls = render.mock.calls.length;
  await expect(
    restore(f.provider, f.history, {
      get timeoutMs() {
        try {
          restore(f.provider, f.history);
        } catch {}
        return 100;
      },
    }),
  ).rejects.toThrow(/reentered/);
  expect(render).toHaveBeenCalledTimes(calls);
  await restore(f.provider, f.history);
  f.owner.dispose();
});
it('busy restoration rejects competing work without invalidating the original successful job', async () => {
  const f = await ready();
  let complete: (value: Blob) => void = () => {};
  render.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = restore(f.provider, f.history);
  expect(() => capture(f.provider, f.image)).toThrow(/busy/);
  expect(() => restore(f.provider, f.history)).toThrow(/busy/);
  complete(new Blob(['ok'], { type: 'image/png' }));
  const image = await pending;
  expect(capture(f.provider, image).snapshot().visualPoseCount).toBe(1);
  f.owner.dispose();
});
it('owns deadlines, cancellation, preaborts and capture disposal without consuming history', async () => {
  vi.useFakeTimers();
  const f = await ready();
  render.mockImplementation(
    (_project, _poses, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason)),
      ),
  );
  const pending = restore(f.provider, f.history, { timeoutMs: 20 }),
    expired = expect(pending).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(20);
  await expired;
  await expect(restore(f.provider, f.history, { signal: AbortSignal.abort() })).rejects.toThrow();
  const controller = new AbortController(),
    cancelled = restore(f.provider, f.history, { signal: controller.signal }),
    cancel = expect(cancelled).rejects.toThrow();
  controller.abort();
  await cancel;
  const last = restore(f.provider, f.history),
    closed = expect(last).rejects.toThrow(/closed/);
  f.owner.dispose();
  await closed;
  expect(vi.getTimerCount()).toBe(0);
  expect(() => f.history.snapshot()).toThrow(/disposed/);
});
it('retains exactly 10001 poses and their complete last tick without truncation', async () => {
  const f = fixture(),
    poses = Array.from({ length: 10001 }, (_, tick) => ({ frame: tick % 3, tick })),
    image = await f.provider.render(poses),
    history = capture(f.provider, image);
  expect(history.snapshot()).toMatchObject({
    tick: 10000,
    frame: 1,
    poseCount: 10001,
    visualPoseCount: 0,
  });
  await restore(f.provider, history);
  expect(render.mock.calls.at(-1)![1]).toEqual(poses);
  f.owner.dispose();
});

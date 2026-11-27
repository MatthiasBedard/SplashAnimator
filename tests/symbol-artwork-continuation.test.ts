import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { newProject, clone, type Vector } from '../packages/document/src';
import { captureSymbolLocalProgram } from '../packages/scripting/src/symbol-program';
import {
  createSymbolScriptArtworkProvider,
  querySymbolScriptArtworkTargets,
  prepareSymbolScriptArtworkVisual as prepare,
  renderSymbolScriptArtworkVisual as renderVisual,
  prepareSymbolScriptArtworkContinuation as continueVisual,
  renderSymbolScriptArtworkContinuation as renderContinuation,
  captureSymbolScriptArtworkHistory as captureHistory,
  restoreSymbolScriptArtworkHistory as restoreHistory,
} from '../apps/editor/src/symbol-script-artwork';
import { renderScriptArtwork, queryScriptArtworkTargets } from '../apps/editor/src/script-artwork';
vi.mock('../apps/editor/src/script-artwork', () => ({
  renderScriptArtwork: vi.fn(),
  queryScriptArtworkTargets: vi.fn(),
}));
const render = vi.mocked(renderScriptArtwork),
  query = vi.mocked(queryScriptArtworkTargets),
  raw = {
    token: 'private-token',
    instanceId: 'raw/instance',
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
        duration: 6,
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
      frame: 0,
      revision: 1,
      validateEnclosing: () => {},
    },
    owner = captureSymbolLocalProgram(() => source),
    provider = createSymbolScriptArtworkProvider(owner);
  return { source, owner, provider };
}
async function ready() {
  const f = fixture(),
    image = await f.provider.render([{ frame: 0, tick: 0 }]),
    proof = await querySymbolScriptArtworkTargets(f.provider, image, [
      { x: 5, y: 5 },
      { x: -1, y: 0 },
    ]);
  return { ...f, image, proof };
}
beforeEach(() => {
  render.mockImplementation(async () => new Blob(['png'], { type: 'image/png' }));
  query.mockImplementation(async (_project, poses, points) => ({
    frame: poses.at(-1)!.frame,
    tick: poses.at(-1)!.tick,
    points: points.map((p) => ({ ...p })),
    targets: points.map((p) => (p.x < 0 ? null : { ...raw })),
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.useRealTimers();
});

async function active(state: 'over' | 'down' = 'over') {
  const f = await ready();
  const image = await renderVisual(
    f.provider,
    prepare(f.provider, f.image, f.proof, 0, state, { frame: 2, tick: 1 }),
  );
  return { ...f, image };
}

it('owns detached text values with the image, continuation and history', async () => {
  const f = fixture(), values = { caption: 'First' };
  const image = await f.provider.render([{ frame: 0, tick: 0 }], { textValues: values });
  values.caption = 'Caller changed';
  const history = captureHistory(f.provider, image);
  await querySymbolScriptArtworkTargets(f.provider, image, [{ x: 5, y: 5 }]);
  expect(query.mock.lastCall?.[3]?.textValues).toEqual({ caption: 'First' });
  const plan = continueVisual(f.provider, image, [{ frame: 0, tick: 1 }]);
  const accessor = { get textValues() { throw Error('Getter must stay inert'); } };
  await expect(renderContinuation(f.provider, plan, accessor)).rejects.toThrow(/explicit data/);
  const next = await renderContinuation(f.provider, plan, { textValues: { caption: 'Second' } });
  expect(render.mock.lastCall?.[3]).toEqual({ caption: 'Second' });
  const advanced = continueVisual(f.provider, next, [{ frame: 0, tick: 2 }]);
  await renderContinuation(f.provider, advanced);
  expect(render.mock.lastCall?.[3]).toEqual({ caption: 'Second' });
  await restoreHistory(f.provider, history);
  expect(render.mock.lastCall?.[3]).toEqual({ caption: 'First' });
  f.owner.dispose();
});
it.each(['over', 'down'] as const)(
  'continues private %s across detached stopped/advancing poses without public ownership',
  async (state) => {
    const f = await active(state),
      before = clone(f.source.project),
      next = [
        { frame: 2, tick: 2 },
        { frame: 4, tick: 3 },
      ],
      plan = continueVisual(f.provider, f.image, next),
      snapshot = plan.snapshot();
    expect(snapshot).toMatchObject({
      fromImageId: expect.any(String),
      frame: 4,
      tick: 3,
      appendedPoseCount: 2,
      poseCount: 4,
    });
    expect(JSON.stringify(snapshot)).not.toContain(raw.instanceId);
    snapshot.tick = 500;
    next[0].frame = 5;
    const result = await renderContinuation(f.provider, plan),
      frames = render.mock.calls.at(-1)![1];
    expect(frames.map((p) => [p.frame, p.tick])).toEqual([
      [0, 0],
      [2, 1],
      [2, 2],
      [4, 3],
    ]);
    expect(frames.slice(1).map((p) => p.buttonState)).toEqual(
      Array(3).fill({ instanceId: raw.instanceId, symbolId: 'button', lifetime: 1, state }),
    );
    expect(f.source.project).toEqual(before);
    expect(() => plan.snapshot()).toThrow(/stale/);
    const proof = await querySymbolScriptArtworkTargets(f.provider, result, [{ x: 5, y: 5 }]);
    expect(proof.tick).toBe(3);
    await f.provider.render([
      { frame: 0, tick: 0 },
      { frame: 2, tick: 1 },
    ]);
    expect(render.mock.calls.at(-1)![1].every((p) => p.buttonState === undefined)).toBe(true);
    f.owner.dispose();
  },
);
it('keeps initial Up and explicit cleared Up exact, and restores private history before later continuation', async () => {
  const f = await ready();
  let image = await renderContinuation(
    f.provider,
    continueVisual(f.provider, f.image, [{ frame: 1, tick: 1 }]),
  );
  expect(render.mock.calls.at(-1)![1].every((p) => p.buttonState === undefined)).toBe(true);
  let proof = await querySymbolScriptArtworkTargets(f.provider, image, [{ x: 5, y: 5 }]);
  image = await renderVisual(
    f.provider,
    prepare(f.provider, image, proof, 0, 'down', { frame: 2, tick: 2 }),
  );
  const saved = captureHistory(f.provider, image);
  proof = await querySymbolScriptArtworkTargets(f.provider, image, [{ x: -1, y: 0 }]);
  image = await renderVisual(
    f.provider,
    prepare(f.provider, image, proof, 0, 'up', { frame: 2, tick: 3 }),
  );
  image = await renderContinuation(
    f.provider,
    continueVisual(f.provider, image, [{ frame: 2, tick: 4 }]),
  );
  expect(render.mock.calls.at(-1)![1].at(-1)!.buttonState).toBeUndefined();
  image = await restoreHistory(f.provider, saved);
  await renderContinuation(f.provider, continueVisual(f.provider, image, [{ frame: 2, tick: 3 }]));
  expect(render.mock.calls.at(-1)![1].at(-1)!.buttonState?.state).toBe('down');
  f.owner.dispose();
});
it.each([
  [],
  [{ frame: 0, tick: 1 }],
  [{ frame: 0, tick: 3 }],
  [{ frame: 0, tick: NaN }],
  [{ frame: 0, tick: Infinity }],
  [{ frame: 0, tick: 2.5 }],
  [{ frame: NaN, tick: 2 }],
  [{ frame: Infinity, tick: 2 }],
  [{ frame: -1, tick: 2 }],
  [{ frame: 6, tick: 2 }],
  [{ frame: 0.5, tick: 2 }],
  [
    { frame: 0, tick: 2 },
    { frame: 0, tick: 4 },
  ],
  [{ frame: 0, tick: 2, buttonState: {} }],
  new Array(1),
])('rejects invalid or incomplete continuation atomically %j', async (next) => {
  const f = await active();
  expect(() => continueVisual(f.provider, f.image, next)).toThrow();
  expect(continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }]).snapshot().poseCount).toBe(3);
  f.owner.dispose();
});
it('rejects foreign/copied/serialized/reopened/stale capabilities and exact-image copies', async () => {
  const f = await active(),
    other = await active(),
    plan = continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }]);
  for (const provider of [{ ...f.provider }, other.provider])
    expect(() => continueVisual(provider, f.image, [{ frame: 0, tick: 2 }])).toThrow();
  expect(() =>
    continueVisual(f.provider, new Blob([f.image], { type: 'image/png' }), [{ frame: 0, tick: 2 }]),
  ).toThrow();
  for (const p of [{ ...plan }, JSON.parse(JSON.stringify(plan)), plan.snapshot()])
    await expect(async () => renderContinuation(f.provider, p)).rejects.toThrow();
  await expect(async () => renderContinuation(other.provider, plan)).rejects.toThrow();
  await f.provider.render([{ frame: 0, tick: 0 }]);
  expect(() => plan.snapshot()).toThrow(/stale/);
  await expect(async () => renderContinuation(f.provider, plan)).rejects.toThrow(/stale/);
  f.owner.dispose();
  expect(() => continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }])).toThrow();
  other.owner.dispose();
});
it.each(['source', 'reentry', 'growth'] as const)(
  'snapshots getters once and rejects swallowed %s during capture',
  async (fault) => {
    const f = await active();
    let reads = 0;
    const values = [
      {
        get frame() {
          reads++;
          if (fault === 'source') f.source.revision++;
          else if (fault === 'growth') values.push({ frame: 0, tick: 3 });
          else
            try {
              continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }]);
            } catch {}
          return 0;
        },
        tick: 2,
      },
    ];
    expect(() => continueVisual(f.provider, f.image, values)).toThrow();
    expect(reads).toBe(1);
    if (fault === 'source') f.source.revision = 1;
    expect(continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }]).snapshot().tick).toBe(2);
    f.owner.dispose();
  },
);
it('reads finite request getters once and later public edits cannot change a preparation', async () => {
  const f = await active();
  let frames = 0,
    ticks = 0;
  const plan = continueVisual(f.provider, f.image, [
    {
      get frame() {
        frames++;
        return 3;
      },
      get tick() {
        ticks++;
        return 2;
      },
    },
  ]);
  expect([frames, ticks]).toEqual([1, 1]);
  await renderContinuation(f.provider, plan);
  expect([frames, ticks]).toEqual([1, 1]);
  expect(render.mock.calls.at(-1)![1].at(-1)!.frame).toBe(3);
  f.owner.dispose();
});
it.each(['source', 'reentry'] as const)(
  'rejects actual post-library-clone %s before returning a continuation',
  async (fault) => {
    const f = await active(),
      parse = JSON.parse;
    let fired = false;
    const hook = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      const value = parse(text, reviver);
      if (
        !fired &&
        Array.isArray(value) &&
        value[0]?.id === 'local' &&
        value[0]?.timeline?.frameScripts === undefined
      ) {
        fired = true;
        if (fault === 'source') f.source.revision++;
        else
          try {
            continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }]);
          } catch {}
      }
      return value;
    });
    expect(() => continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }])).toThrow();
    hook.mockRestore();
    expect(fired).toBe(true);
    if (fault === 'source') f.source.revision = 1;
    expect(continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }]).snapshot().tick).toBe(2);
    f.owner.dispose();
  },
);
it.each(['source', 'candidate', 'output'] as const)(
  'rejects late %s and preserves original image and valid retry',
  async (fault) => {
    const f = await active(),
      plan = continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }]);
    render.mockImplementationOnce(async (project) => {
      if (fault === 'source') f.source.revision++;
      if (fault === 'candidate') project.width++;
      return fault === 'output'
        ? new Blob(['x'], { type: 'text/plain' })
        : new Blob(['png'], { type: 'image/png' });
    });
    await expect(async () => renderContinuation(f.provider, plan)).rejects.toThrow();
    if (fault === 'source') f.source.revision = 1;
    expect(plan.snapshot().tick).toBe(2);
    expect(
      (await querySymbolScriptArtworkTargets(f.provider, f.image, [{ x: 5, y: 5 }])).tick,
    ).toBe(1);
    await renderContinuation(f.provider, plan);
    f.owner.dispose();
  },
);
it('rejects busy competing work and cancellation without consuming a valid continuation', async () => {
  const f = await active(),
    plan = continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }]);
  render.mockImplementationOnce(
    (_p, _f, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
      ),
  );
  const abort = new AbortController(),
    pending = renderContinuation(f.provider, plan, { signal: abort.signal });
  await expect(async () => renderContinuation(f.provider, plan)).rejects.toThrow(/busy/);
  expect(() => continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }])).toThrow(/busy/);
  abort.abort();
  await expect(pending).rejects.toThrow();
  await renderContinuation(f.provider, plan);
  f.owner.dispose();
});
it('cleans timeout and program disposal, retaining source-valid timeout retry', async () => {
  const f = await active(),
    plan = continueVisual(f.provider, f.image, [{ frame: 0, tick: 2 }]);
  vi.useFakeTimers();
  render.mockImplementation(
    (_p, _f, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
      ),
  );
  const failed = expect(renderContinuation(f.provider, plan, { timeoutMs: 5 })).rejects.toThrow(
    /timed out/,
  );
  await vi.advanceTimersByTimeAsync(6);
  await failed;
  expect(vi.getTimerCount()).toBe(0);
  expect(plan.snapshot().tick).toBe(2);
  const closed = expect(renderContinuation(f.provider, plan)).rejects.toThrow(/closed|disposed/);
  f.owner.dispose();
  await closed;
  expect(vi.getTimerCount()).toBe(0);
});
it('admits exactly the remaining 10001-pose capacity with an intact tail and rejects excess before writes', async () => {
  const f = await active(),
    next = Array.from({ length: 9999 }, (_, i) => ({ frame: i % 6, tick: i + 2 }));
  expect(() => continueVisual(f.provider, f.image, [...next, { frame: 0, tick: 10001 }])).toThrow();
  const plan = continueVisual(f.provider, f.image, next);
  expect(plan.snapshot()).toMatchObject({ poseCount: 10001, tick: 10000 });
  const image = await renderContinuation(f.provider, plan),
    frames = render.mock.calls.at(-1)![1];
  expect(frames).toHaveLength(10001);
  expect(frames.at(-1)).toMatchObject({ frame: 2, tick: 10000, buttonState: { state: 'over' } });
  expect(() => continueVisual(f.provider, image, [{ frame: 0, tick: 10001 }])).toThrow();
  f.owner.dispose();
});

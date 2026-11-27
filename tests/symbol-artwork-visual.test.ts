import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { newProject, clone, type Vector } from '../packages/document/src';
import { captureSymbolLocalProgram } from '../packages/scripting/src/symbol-program';
import {
  createSymbolScriptArtworkProvider,
  querySymbolScriptArtworkTargets,
  prepareSymbolScriptArtworkVisual as prepare,
  renderSymbolScriptArtworkVisual as renderVisual,
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
  vi.resetAllMocks();
  vi.useRealTimers();
});
it.each(['source', 'query'])(
  'rejects actual %s edits after the detached source-free library clone',
  async (fault) => {
    const f = await ready(),
      parse = JSON.parse;
    let fired = false,
      error: unknown;
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
        else f.proof.targets[0]!.name = 'Changed';
      }
      return value;
    });
    try {
      prepare(f.provider, f.image, f.proof, 0, 'over', { frame: 0, tick: 1 });
    } catch (cause) {
      error = cause;
    } finally {
      hook.mockRestore();
    }
    expect(fired).toBe(true);
    expect(String(error)).toMatch(/changed/);
    if (fault === 'source') f.source.revision = 1;
    else f.proof.targets[0]!.name = 'Button';
    expect(
      prepare(f.provider, f.image, f.proof, 0, 'over', { frame: 0, tick: 1 }).snapshot().tick,
    ).toBe(1);
    f.owner.dispose();
  },
);
it('prepares detached current-query visual capabilities using private raw identity and keeps full history', async () => {
  const f = await ready(),
    before = clone(f.source.project),
    plan = prepare(f.provider, f.image, f.proof, 0, 'over', { frame: 2, tick: 1 }),
    view = plan.snapshot();
  expect(view).toMatchObject({
    namespace: f.proof.namespace,
    fromImageId: f.proof.imageId,
    state: 'over',
    frame: 2,
    tick: 1,
    poseCount: 2,
  });
  expect(JSON.stringify(view)).not.toContain('raw/instance');
  view.frame = 5;
  const over = await renderVisual(f.provider, plan);
  expect(render.mock.calls.at(-1)![1]).toEqual([
    { frame: 0, tick: 0 },
    {
      frame: 2,
      tick: 1,
      buttonState: {
        instanceId: raw.instanceId,
        symbolId: raw.symbolId,
        lifetime: 1,
        state: 'over',
      },
    },
  ]);
  const proof = await querySymbolScriptArtworkTargets(f.provider, over, [
    { x: 5, y: 5 },
    { x: -1, y: 0 },
  ]);
  expect(query.mock.calls.at(-1)![1][1].buttonState?.state).toBe('over');
  const down = await renderVisual(
      f.provider,
      prepare(f.provider, over, proof, 0, 'down', { frame: 2, tick: 2 }),
    ),
    next = await querySymbolScriptArtworkTargets(f.provider, down, [{ x: -1, y: 0 }]);
  await renderVisual(f.provider, prepare(f.provider, down, next, 0, 'up', { frame: 2, tick: 3 }));
  expect(render.mock.calls.at(-1)![1].map((p) => p.buttonState?.state)).toEqual([
    undefined,
    'over',
    'down',
    undefined,
  ]);
  expect(f.source.project).toEqual(before);
  f.owner.dispose();
});
it('retains exact plain Up-only rendering and rejects public visual pose injection', async () => {
  const f = await ready();
  await renderVisual(
    f.provider,
    prepare(f.provider, f.image, f.proof, 0, 'down', { frame: 0, tick: 1 }),
  );
  await f.provider.render([
    { frame: 0, tick: 0 },
    { frame: 0, tick: 1 },
  ]);
  expect(render.mock.calls.at(-1)![1].every((p) => p.buttonState === undefined)).toBe(true);
  await expect(
    // @ts-expect-error Plain public frames still cannot own visual states.
    f.provider.render([{ frame: 0, tick: 0, buttonState: { ...raw, state: 'down' } }]),
  ).rejects.toThrow(/Up/);
  f.owner.dispose();
});
it('rejects copied/foreign providers, queries, images and prepared capabilities', async () => {
  const a = await ready(),
    b = await ready();
  for (const proof of [{ ...a.proof }, Object.create(a.proof), b.proof])
    expect(() => prepare(a.provider, a.image, proof, 0, 'over', { frame: 0, tick: 1 })).toThrow(
      /qualified/,
    );
  expect(() =>
    prepare({ ...a.provider }, a.image, a.proof, 0, 'over', { frame: 0, tick: 1 }),
  ).toThrow(/qualified/);
  expect(() =>
    prepare(a.provider, new Blob([a.image]), a.proof, 0, 'over', { frame: 0, tick: 1 }),
  ).toThrow(/foreign/);
  const plan = prepare(a.provider, a.image, a.proof, 0, 'over', { frame: 0, tick: 1 });
  for (const fake of [{ ...plan }, Object.create(plan), plan.snapshot()])
    expect(() => renderVisual(a.provider, fake)).toThrow(/qualified/);
  expect(() => renderVisual(b.provider, plan)).toThrow(/qualified/);
  a.owner.dispose();
  b.owner.dispose();
});
it.each(['target', 'frame', 'array', 'accessor', 'serializer'])(
  'rejects altered public query %s without interpreting public identity',
  async (fault) => {
    const f = await ready();
    let calls = 0;
    if (fault === 'target') f.proof.targets[0]!.instanceId = 'another';
    if (fault === 'frame') f.proof.frame = 4;
    if (fault === 'array') f.proof.targets.length = 1000000;
    if (fault === 'accessor')
      Object.defineProperty(f.proof.targets[0], 'name', {
        get() {
          calls++;
          return 'Forged';
        },
      });
    if (fault === 'serializer')
      Object.assign(f.proof, {
        toJSON() {
          calls++;
          return {};
        },
      });
    expect(() => prepare(f.provider, f.image, f.proof, 0, 'down', { frame: 0, tick: 1 })).toThrow();
    expect(calls).toBe(0);
    f.owner.dispose();
  },
);
it.each([
  [-1, 'over', 0, 1],
  [2, 'over', 0, 1],
  [0.5, 'over', 0, 1],
  [0, 'other', 0, 1],
  [0, 'over', NaN, 1],
  [0, 'over', 6, 1],
  [0, 'over', 0, 0],
  [0, 'over', 0, 2],
  [1, 'down', 0, 1],
])('rejects raw target/state/frame/tick request %j', async (index, state, frame, tick) => {
  const f = await ready();
  expect(() =>
    prepare(f.provider, f.image, f.proof, index, state as 'over', { frame, tick }),
  ).toThrow();
  expect(
    prepare(f.provider, f.image, f.proof, 0, 'over', { frame: 0, tick: 1 }).snapshot().tick,
  ).toBe(1);
  f.owner.dispose();
});
it('snapshots next-pose getters once and rejects source mutation and swallowed preparation reentry', async () => {
  const f = await ready();
  let frame = 0,
    tick = 0;
  prepare(f.provider, f.image, f.proof, 0, 'over', {
    get frame() {
      frame++;
      return 0;
    },
    get tick() {
      tick++;
      return 1;
    },
  });
  expect([frame, tick]).toEqual([1, 1]);
  expect(() =>
    prepare(f.provider, f.image, f.proof, 0, 'over', {
      get frame() {
        try {
          prepare(f.provider, f.image, f.proof, 0, 'over', { frame: 0, tick: 1 });
        } catch {}
        return 0;
      },
      tick: 1,
    }),
  ).toThrow(/reentered/);
  expect(() =>
    prepare(f.provider, f.image, f.proof, 0, 'over', {
      get frame() {
        f.source.revision++;
        return 0;
      },
      tick: 1,
    }),
  ).toThrow(/changed/);
  f.owner.dispose();
});
it('expires plans/queries on successful new images but permits retry after failed rendering', async () => {
  const f = await ready(),
    plan = prepare(f.provider, f.image, f.proof, 0, 'over', { frame: 0, tick: 1 });
  render.mockRejectedValueOnce(Error('render failed'));
  await expect(renderVisual(f.provider, plan)).rejects.toThrow(/failed/);
  expect(
    (await querySymbolScriptArtworkTargets(f.provider, f.image, [{ x: 5, y: 5 }])).imageId,
  ).toBe(f.proof.imageId);
  await renderVisual(f.provider, plan);
  expect(() => plan.snapshot()).toThrow(/stale/);
  expect(() => renderVisual(f.provider, plan)).toThrow(/stale/);
  expect(() => prepare(f.provider, f.image, f.proof, 0, 'over', { frame: 0, tick: 1 })).toThrow(
    /stale/,
  );
  f.owner.dispose();
});
it.each(['candidate', 'source', 'output'])(
  'rejects late visual %s changes without publication',
  async (fault) => {
    const f = await ready(),
      plan = prepare(f.provider, f.image, f.proof, 0, 'down', { frame: 0, tick: 1 });
    render.mockImplementationOnce(async (project, poses) => {
      if (fault === 'source') f.source.revision++;
      if (fault === 'candidate') poses[1].buttonState!.instanceId = 'forged';
      return new Blob(['x'], { type: fault === 'output' ? 'text/plain' : 'image/png' });
    });
    await expect(renderVisual(f.provider, plan)).rejects.toThrow();
    if (fault === 'source') f.source.revision = 1;
    expect(
      (await querySymbolScriptArtworkTargets(f.provider, f.image, [{ x: 5, y: 5 }])).imageId,
    ).toBe(f.proof.imageId);
    f.owner.dispose();
  },
);
it('shares exact 10001-pose admission without resetting or truncating visual history', async () => {
  const f = fixture(),
    poses = Array.from({ length: 10000 }, (_, tick) => ({ frame: 0, tick })),
    image = await f.provider.render(poses),
    proof = await querySymbolScriptArtworkTargets(f.provider, image, [{ x: 5, y: 5 }]),
    plan = prepare(f.provider, image, proof, 0, 'over', { frame: 0, tick: 10000 });
  expect(plan.snapshot().poseCount).toBe(10001);
  const next = await renderVisual(f.provider, plan),
    nextProof = await querySymbolScriptArtworkTargets(f.provider, next, [{ x: 5, y: 5 }]);
  expect(() => prepare(f.provider, next, nextProof, 0, 'over', { frame: 0, tick: 10001 })).toThrow(
    /10001/,
  );
  f.owner.dispose();
});
it('owns visual render busy/abort/deadline/disposal without consuming valid plans', async () => {
  vi.useFakeTimers();
  const f = await ready(),
    plan = prepare(f.provider, f.image, f.proof, 0, 'over', { frame: 0, tick: 1 });
  render.mockImplementation(
    (_project, _poses, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason)),
      ),
  );
  const pending = renderVisual(f.provider, plan, { timeoutMs: 20 }),
    expired = expect(pending).rejects.toThrow(/timed out/);
  expect(() => renderVisual(f.provider, plan)).toThrow(/busy/);
  await vi.advanceTimersByTimeAsync(20);
  await expired;
  const controller = new AbortController(),
    cancelled = renderVisual(f.provider, plan, { signal: controller.signal }),
    cancel = expect(cancelled).rejects.toThrow();
  controller.abort();
  await cancel;
  const last = renderVisual(f.provider, plan),
    closed = expect(last).rejects.toThrow(/closed/);
  f.owner.dispose();
  await closed;
  expect(vi.getTimerCount()).toBe(0);
});

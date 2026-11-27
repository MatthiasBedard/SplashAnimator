import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { newProject, clone, type Vector } from '../packages/document/src';
import { captureSymbolLocalProgram } from '../packages/scripting/src/symbol-program';
import {
  createSymbolScriptArtworkProvider,
  querySymbolScriptArtworkTargets,
} from '../apps/editor/src/symbol-script-artwork';
import { renderScriptArtwork, queryScriptArtworkTargets } from '../apps/editor/src/script-artwork';
vi.mock('../apps/editor/src/script-artwork', () => ({
  renderScriptArtwork: vi.fn(),
  queryScriptArtworkTargets: vi.fn(),
}));
const render = vi.mocked(renderScriptArtwork),
  query = vi.mocked(queryScriptArtworkTargets),
  poses = [
    { frame: 0, tick: 0 },
    { frame: 2, tick: 1 },
  ],
  point = { x: 15, y: 5 },
  hit = {
    token: 'root/button',
    instanceId: 'button',
    symbolId: 'button-def',
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
      shapes: [{ ...art, kind: 'symbol', symbolId: 'button-def' }],
      timeline: {
        duration: 3,
        keys: [],
        frameScripts: [{ frame: 0, source: 'throw new Error("inert")' }],
      },
    },
    {
      id: 'button-def',
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
      frame: 1,
      revision: 1,
      validateEnclosing: () => {},
    },
    owner = captureSymbolLocalProgram(() => source),
    provider = createSymbolScriptArtworkProvider(owner);
  return { source, owner, provider };
}
beforeEach(() => {
  render.mockImplementation(async () => new Blob(['png'], { type: 'image/png' }));
  query.mockImplementation(async (_project, trajectory, points) => ({
    frame: trajectory.at(-1)!.frame,
    tick: trajectory.at(-1)!.tick,
    points: points.map((p) => ({ ...p })),
    targets: points.map((p) => (p.x < 0 ? null : { ...hit })),
  }));
});
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});
it('counts namespaced metadata in the exact existing target-byte limit', async () => {
  const f = fixture(),
    image = await f.provider.render(poses),
    namespace = f.provider.metadata().namespace;
  const target = {
      ...hit,
      name: '',
      token: JSON.stringify([namespace, hit.token]),
      instanceId: JSON.stringify([namespace, hit.instanceId]),
    },
    remaining = 256 * 1024 - new TextEncoder().encode(JSON.stringify(target)).byteLength;
  for (const extra of [0, 1]) {
    query.mockImplementationOnce(async (_project, trajectory, points) => ({
      frame: trajectory.at(-1)!.frame,
      tick: trajectory.at(-1)!.tick,
      points: points.map((p) => ({ ...p })),
      targets: [{ ...hit, name: 'x'.repeat(remaining + extra) }],
    }));
    const result = querySymbolScriptArtworkTargets(f.provider, image, [point]);
    if (extra) await expect(result).rejects.toThrow(/256 KiB/);
    else expect((await result).targets[0]!.name.length).toBe(remaining);
  }
  f.owner.dispose();
});
it('rejects mutation of captured query locations and late target getter source changes', async () => {
  const f = fixture(),
    image = await f.provider.render(poses);
  query.mockImplementationOnce(async (_project, trajectory, points) => {
    points[0].x++;
    return {
      frame: trajectory.at(-1)!.frame,
      tick: trajectory.at(-1)!.tick,
      points: [...points],
      targets: [{ ...hit }],
    };
  });
  await expect(querySymbolScriptArtworkTargets(f.provider, image, [point])).rejects.toThrow(
    /coordinates changed/,
  );
  query.mockImplementationOnce(async (_project, trajectory, points) => ({
    frame: trajectory.at(-1)!.frame,
    tick: trajectory.at(-1)!.tick,
    points: [...points],
    targets: [
      {
        ...hit,
        get name() {
          f.source.revision++;
          return 'Late';
        },
      },
    ],
  }));
  await expect(querySymbolScriptArtworkTargets(f.provider, image, [point])).rejects.toThrow(
    /changed/,
  );
  f.owner.dispose();
});
it('pre-aborted queries dispatch nothing and preserve the valid current image', async () => {
  const f = fixture(),
    image = await f.provider.render(poses);
  await expect(
    querySymbolScriptArtworkTargets(f.provider, image, [point], { signal: AbortSignal.abort() }),
  ).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
  expect((await querySymbolScriptArtworkTargets(f.provider, image, [point])).targets).toHaveLength(
    1,
  );
  f.owner.dispose();
});
it('queries exact private current images using source-free trajectories and namespaced detached targets', async () => {
  const f = fixture(),
    before = clone(f.source.project),
    image = await f.provider.render(poses),
    points = [point, { x: -1, y: 5 }],
    result = await querySymbolScriptArtworkTargets(f.provider, image, points);
  expect(result).toMatchObject({
    ...f.provider.metadata(),
    frame: 2,
    tick: 1,
    points,
    targets: [
      {
        ...hit,
        token: JSON.stringify([f.provider.metadata().namespace, hit.token]),
        instanceId: JSON.stringify([f.provider.metadata().namespace, hit.instanceId]),
      },
      null,
    ],
  });
  expect(result.imageId).toBeTypeOf('string');
  expect(query.mock.calls[0][0].frameScripts).toBeUndefined();
  expect(query.mock.calls[0][0].symbols!.every((s) => s.timeline?.frameScripts === undefined)).toBe(
    true,
  );
  expect(query.mock.calls[0][1]).toEqual(poses);
  result.targets[0]!.name = 'forged';
  result.points[0].x = 900;
  expect((await querySymbolScriptArtworkTargets(f.provider, image, points)).targets[0]!.name).toBe(
    'Button',
  );
  expect(f.source.project).toEqual(before);
  f.owner.dispose();
});
it('rejects copied providers, blob copies, foreign provider images and images superseded by a successful render', async () => {
  const a = fixture(),
    b = fixture(),
    image = await a.provider.render(poses),
    other = await b.provider.render(poses);
  for (const fake of [{ ...a.provider }, Object.create(a.provider), {}])
    expect(() => querySymbolScriptArtworkTargets(fake, image, [point])).toThrow(/qualified/);
  for (const blob of [other, new Blob([image], { type: 'image/png' })])
    await expect(querySymbolScriptArtworkTargets(a.provider, blob, [point])).rejects.toThrow(
      /foreign/,
    );
  const next = await a.provider.render(poses);
  await expect(querySymbolScriptArtworkTargets(a.provider, image, [point])).rejects.toThrow(
    /stale/,
  );
  expect(
    (await querySymbolScriptArtworkTargets(a.provider, next, [point])).targets[0],
  ).not.toBeNull();
  a.owner.dispose();
  b.owner.dispose();
});
it.each([
  [],
  Array(2),
  [{ x: NaN, y: 0 }],
  [{ x: 0, y: Infinity }],
  [{ x: '2', y: 0 }],
  [null],
  Array.from({ length: 65 }, () => point),
])(
  'rejects malformed and oversized original query locations %j before rendering',
  async (points) => {
    const f = fixture(),
      image = await f.provider.render(poses);
    await expect(querySymbolScriptArtworkTargets(f.provider, image, points)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    f.owner.dispose();
  },
);
it('admits exactly 64 finite off-view points, snapshots getters once and rejects getter-driven growth', async () => {
  const f = fixture(),
    image = await f.provider.render(poses);
  let x = 0,
    y = 0;
  await querySymbolScriptArtworkTargets(f.provider, image, [
    {
      get x() {
        x++;
        return 15;
      },
      get y() {
        y++;
        return 5;
      },
    },
  ]);
  expect([x, y]).toEqual([1, 1]);
  expect(
    (
      await querySymbolScriptArtworkTargets(
        f.provider,
        image,
        Array.from({ length: 64 }, () => ({ x: -1e100, y: 1e100 })),
      )
    ).targets,
  ).toHaveLength(64);
  const points = [
    {
      get x() {
        points.push({ x: 0, y: 0 });
        return 1;
      },
      y: 0,
    },
  ];
  await expect(querySymbolScriptArtworkTargets(f.provider, image, points)).rejects.toThrow(
    /changed/,
  );
  f.owner.dispose();
});
it.each(['frame', 'tick', 'points', 'count', 'lifetime', 'name', 'candidate', 'source', 'bytes'])(
  'rejects late or malformed %s query responses without invalidating a source-valid image',
  async (fault) => {
    const f = fixture(),
      image = await f.provider.render(poses);
    query.mockImplementationOnce(async (project, trajectory, points) => {
      const result = {
        frame: trajectory.at(-1)!.frame,
        tick: trajectory.at(-1)!.tick,
        points: points.map((p) => ({ ...p })),
        targets: [{ ...hit }],
      };
      if (fault === 'frame') result.frame = 1;
      if (fault === 'tick') result.tick = 9;
      if (fault === 'points') result.points[0].x++;
      if (fault === 'count') result.targets = [];
      if (fault === 'lifetime') result.targets[0].lifetime = Infinity;
      if (fault === 'name') Object.assign(result.targets[0], { name: 5 });
      if (fault === 'candidate') project.layers[0].keys[0].shapes[0].x++;
      if (fault === 'source') f.source.revision++;
      if (fault === 'bytes') result.targets[0].name = 'x'.repeat(256 * 1024);
      return result;
    });
    await expect(querySymbolScriptArtworkTargets(f.provider, image, [point])).rejects.toThrow();
    if (fault === 'source') f.source.revision = 1;
    expect(
      (await querySymbolScriptArtworkTargets(f.provider, image, [point])).targets,
    ).toHaveLength(1);
    f.owner.dispose();
  },
);
it('retains last successful image after a failed render and never accepts stale original source', async () => {
  const f = fixture(),
    image = await f.provider.render(poses),
    first = await querySymbolScriptArtworkTargets(f.provider, image, [point]);
  render.mockRejectedValueOnce(Error('encode failed'));
  await expect(f.provider.render(poses)).rejects.toThrow(/failed/);
  expect((await querySymbolScriptArtworkTargets(f.provider, image, [point])).imageId).toBe(
    first.imageId,
  );
  await expect(
    querySymbolScriptArtworkTargets(f.provider, image, [
      {
        get x() {
          f.source.revision++;
          return 1;
        },
        y: 0,
      },
    ]),
  ).rejects.toThrow(/changed/);
  f.owner.dispose();
});
it('owns query busy/deadline/external cancellation/disposal and permits source-valid retries', async () => {
  vi.useFakeTimers();
  const f = fixture(),
    image = await f.provider.render(poses);
  query.mockImplementation(
    (_project, _poses, _points, options) =>
      new Promise((_resolve, reject) =>
        options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason)),
      ),
  );
  const pending = querySymbolScriptArtworkTargets(f.provider, image, [point], { timeoutMs: 20 }),
    check = expect(pending).rejects.toThrow(/timed out/);
  await expect(f.provider.render(poses)).rejects.toThrow(/busy/);
  await expect(querySymbolScriptArtworkTargets(f.provider, image, [point])).rejects.toThrow(/busy/);
  await vi.advanceTimersByTimeAsync(20);
  await check;
  const controller = new AbortController(),
    cancelled = querySymbolScriptArtworkTargets(f.provider, image, [point], {
      signal: controller.signal,
    }),
    cancel = expect(cancelled).rejects.toThrow();
  controller.abort();
  await cancel;
  const last = querySymbolScriptArtworkTargets(f.provider, image, [point]),
    closed = expect(last).rejects.toThrow(/closed/);
  f.owner.dispose();
  await closed;
  expect(vi.getTimerCount()).toBe(0);
});
it.each([0, 0.5, Infinity, 60001])(
  'rejects query deadline %s before dispatch',
  async (timeoutMs) => {
    const f = fixture(),
      image = await f.provider.render(poses);
    await expect(
      querySymbolScriptArtworkTargets(f.provider, image, [point], { timeoutMs }),
    ).rejects.toThrow(/deadline/);
    expect(query).not.toHaveBeenCalled();
    f.owner.dispose();
  },
);

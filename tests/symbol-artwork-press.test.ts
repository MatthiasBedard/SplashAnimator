import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { newProject, clone, type Vector } from '../packages/document/src';
import { captureSymbolLocalProgram } from '../packages/scripting/src/symbol-program';
import {
  createSymbolScriptArtworkProvider,
  querySymbolScriptArtworkTargets,
  prepareSymbolScriptArtworkVisual as prepare,
  renderSymbolScriptArtworkVisual as renderVisual,
  prepareSymbolScriptArtworkPress as preparePress,
  renderSymbolScriptArtworkPress as renderPress,
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

async function event(
  f: Awaited<ReturnType<typeof ready>>,
  image: Blob,
  type: 'pointerdown' | 'pointerup' | 'pointercancel' | 'pointermove' | 'pointerleave',
  pointerId = 1,
  button = 0,
  index = 0,
) {
  const proof = await querySymbolScriptArtworkTargets(f.provider, image, [
    { x: 5, y: 5 },
    { x: -1, y: 0 },
  ]);
  const plan = preparePress(
    f.provider,
    image,
    proof,
    index,
    { type, pointerId, button },
    { frame: 0, tick: proof.tick + 1 },
  );
  const metadata = plan.snapshot();
  image = await renderPress(f.provider, plan);
  return { image, metadata };
}
it('owns primary Down privately, continues it, restores its pointer ownership and returns Over on matching release', async () => {
  const f = await ready(),
    before = clone(f.source.project);
  let step = await event(f, f.image, 'pointerdown');
  expect(step.metadata).toMatchObject({ pressed: true, hovered: true, state: 'down' });
  expect(JSON.stringify(step.metadata)).not.toContain(raw.instanceId);
  const saved = captureHistory(f.provider, step.image);
  let image = await renderContinuation(
    f.provider,
    continueVisual(f.provider, step.image, [
      { frame: 2, tick: 2 },
      { frame: 2, tick: 3 },
    ]),
  );
  expect(
    render.mock.calls
      .at(-1)![1]
      .slice(1)
      .map((p) => p.buttonState?.state),
  ).toEqual(['down', 'down', 'down']);
  step = await event(f, image, 'pointerup');
  expect(step.metadata).toMatchObject({ pressed: false, state: 'over' });
  image = await restoreHistory(f.provider, saved);
  step = await event(f, image, 'pointerup', 2);
  expect(step.metadata).toMatchObject({ pressed: true, state: 'down' });
  step = await event(f, step.image, 'pointerup', 1);
  expect(step.metadata).toMatchObject({ pressed: false, state: 'over' });
  expect(f.source.project).toEqual(before);
  f.owner.dispose();
});
it.each(['pointercancel', 'pointerup'] as const)(
  'outside %s clears the owned press without activation output',
  async (type) => {
    const f = await ready(),
      down = await event(f, f.image, 'pointerdown'),
      done = await event(f, down.image, type, 1, type === 'pointercancel' ? -1 : 0, 1);
    expect(done.metadata).toMatchObject({ pressed: false, hovered: false, state: 'up' });
    expect(done.metadata).not.toHaveProperty('activation');
    expect(render.mock.calls.at(-1)![1].at(-1)!.buttonState).toBeUndefined();
    f.owner.dispose();
  },
);
it.each([
  ['pointerdown', 2, 0],
  ['pointerup', 2, 0],
  ['pointercancel', 2, -1],
  ['pointermove', 2, -1],
  ['pointerleave', 2, -1],
  ['pointerdown', 1, 2],
  ['pointerup', 1, 2],
] as const)(
  'foreign/secondary %s pointer %s button %s cannot steal an owned gesture',
  async (type, pointer, button) => {
    const f = await ready(),
      down = await event(f, f.image, 'pointerdown'),
      foreign = await event(f, down.image, type, pointer, button, 1);
    expect(foreign.metadata).toMatchObject({ pressed: true, state: 'down' });
    const up = await event(f, foreign.image, 'pointerup');
    expect(up.metadata.pressed).toBe(false);
    f.owner.dispose();
  },
);
it('leaving retains the accepted press but clears hover; reentering restores Down and changed lifetime cannot activate', async () => {
  const f = await ready(),
    down = await event(f, f.image, 'pointerdown');
  let step = await event(f, down.image, 'pointerleave', 1, -1, 1);
  expect(step.metadata).toMatchObject({ pressed: true, hovered: false, state: 'up' });
  step = await event(f, step.image, 'pointermove', 1, -1);
  expect(step.metadata).toMatchObject({ pressed: true, state: 'down' });
  raw.lifetime = 2;
  try {
    step = await event(f, step.image, 'pointerup');
    expect(step.metadata).toMatchObject({ pressed: false, state: 'over' });
  } finally {
    raw.lifetime = 1;
  }
  f.owner.dispose();
});
it('plain rendering and independent explicit visual preparation reset pointer ownership', async () => {
  const f = await ready(),
    down = await event(f, f.image, 'pointerdown');
  let image = await f.provider.render([{ frame: 0, tick: 0 }]);
  let step = await event(f, image, 'pointerup', 2);
  expect(step.metadata.pressed).toBe(false);
  const proof = await querySymbolScriptArtworkTargets(f.provider, step.image, [{ x: 5, y: 5 }]);
  image = await renderVisual(
    f.provider,
    prepare(f.provider, step.image, proof, 0, 'over', { frame: 0, tick: 2 }),
  );
  step = await event(f, image, 'pointerdown', 2);
  expect(step.metadata.state).toBe('down');
  expect(down.image).not.toBe(image);
  f.owner.dispose();
});
it.each([
  { type: 'click', pointerId: 1, button: 0 },
  { type: 'pointerdown', pointerId: -1, button: 0 },
  { type: 'pointerdown', pointerId: NaN, button: 0 },
  { type: 'pointerdown', pointerId: 1.5, button: 0 },
  { type: 'pointerdown', pointerId: 1, button: 32 },
  { type: 'pointerdown', pointerId: 1, button: NaN },
  { type: 'pointerdown', pointerId: 1, button: 0, target: raw },
])('rejects raw malformed press input %j without writes', async (input) => {
  const f = await ready();
  expect(() =>
    preparePress(f.provider, f.image, f.proof, 0, input as never, { frame: 0, tick: 1 }),
  ).toThrow();
  expect(
    preparePress(
      f.provider,
      f.image,
      f.proof,
      0,
      { type: 'pointerdown', pointerId: 1, button: 0 },
      { frame: 0, tick: 1 },
    ).snapshot().state,
  ).toBe('down');
  f.owner.dispose();
});
it.each([
  { frame: 0, tick: 0 },
  { frame: 0, tick: 2 },
  { frame: Infinity, tick: 1 },
  { frame: 6, tick: 1 },
  { frame: -1, tick: 1 },
  { frame: 0.5, tick: 1 },
  { frame: 0, tick: 1, buttonState: {} },
])('rejects invalid complete next pose %j atomically', async (next) => {
  const f = await ready();
  expect(() =>
    preparePress(
      f.provider,
      f.image,
      f.proof,
      0,
      { type: 'pointerdown', pointerId: 1, button: 0 },
      next,
    ),
  ).toThrow();
  expect((await event(f, f.image, 'pointerdown')).metadata.state).toBe('down');
  f.owner.dispose();
});
it('requires original provider/image/query/preparation identity rather than snapshots or public target metadata', async () => {
  const f = await ready(),
    other = await ready(),
    input = { type: 'pointerdown' as const, pointerId: 1, button: 0 },
    next = { frame: 0, tick: 1 };
  for (const q of [{ ...f.proof }, other.proof])
    expect(() => preparePress(f.provider, f.image, q, 0, input, next)).toThrow();
  expect(() => preparePress({ ...f.provider }, f.image, f.proof, 0, input, next)).toThrow();
  expect(() => preparePress(f.provider, new Blob([f.image]), f.proof, 0, input, next)).toThrow();
  const plan = preparePress(f.provider, f.image, f.proof, 0, input, next);
  for (const p of [{ ...plan }, plan.snapshot(), JSON.parse(JSON.stringify(plan))])
    await expect(async () => renderPress(f.provider, p)).rejects.toThrow();
  await expect(async () => renderPress(other.provider, plan)).rejects.toThrow();
  f.proof.targets[0]!.instanceId = 'forged';
  expect(() => preparePress(f.provider, f.image, f.proof, 0, input, next)).toThrow();
  await renderPress(f.provider, plan);
  expect(() => plan.snapshot()).toThrow(/stale/);
  f.owner.dispose();
  other.owner.dispose();
});
it.each(['source', 'reentry', 'query'] as const)(
  'rejects swallowed %s from one-shot pointer getters',
  async (fault) => {
    const f = await ready();
    let reads = 0;
    const input = {
      get type() {
        reads++;
        if (fault === 'source') f.source.revision++;
        else if (fault === 'query') f.proof.targets[0]!.name = 'Changed';
        else
          try {
            preparePress(
              f.provider,
              f.image,
              f.proof,
              0,
              { type: 'pointerdown', pointerId: 2, button: 0 },
              { frame: 0, tick: 1 },
            );
          } catch {}
        return 'pointerdown' as const;
      },
      pointerId: 1,
      button: 0,
    };
    expect(() =>
      preparePress(f.provider, f.image, f.proof, 0, input, { frame: 0, tick: 1 }),
    ).toThrow();
    expect(reads).toBe(1);
    f.owner.dispose();
  },
);
it.each(['source', 'reentry'] as const)(
  'rejects actual detached library clone %s before press publication',
  async (fault) => {
    const f = await ready(),
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
            preparePress(
              f.provider,
              f.image,
              f.proof,
              0,
              { type: 'pointerdown', pointerId: 2, button: 0 },
              { frame: 0, tick: 1 },
            );
          } catch {}
      }
      return value;
    });
    expect(() =>
      preparePress(
        f.provider,
        f.image,
        f.proof,
        0,
        { type: 'pointerdown', pointerId: 1, button: 0 },
        { frame: 0, tick: 1 },
      ),
    ).toThrow();
    hook.mockRestore();
    expect(fired).toBe(true);
    f.owner.dispose();
  },
);
it.each(['source', 'candidate', 'output'] as const)(
  'late %s rejection preserves current image and uncommitted pointer ownership',
  async (fault) => {
    const f = await ready(),
      plan = preparePress(
        f.provider,
        f.image,
        f.proof,
        0,
        { type: 'pointerdown', pointerId: 1, button: 0 },
        { frame: 0, tick: 1 },
      );
    render.mockImplementationOnce(async (project) => {
      if (fault === 'source') f.source.revision++;
      if (fault === 'candidate') project.width++;
      return new Blob(['png'], { type: fault === 'output' ? 'text/plain' : 'image/png' });
    });
    await expect(renderPress(f.provider, plan)).rejects.toThrow();
    if (fault === 'source') f.source.revision = 1;
    expect(
      (await querySymbolScriptArtworkTargets(f.provider, f.image, [{ x: 5, y: 5 }])).tick,
    ).toBe(0);
    const other = await event(f, f.image, 'pointerdown', 2),
      foreign = await event(f, other.image, 'pointerup', 1);
    expect(foreign.metadata.pressed).toBe(true);
    f.owner.dispose();
  },
);
it('busy/cancelled press rendering retains original ownership and allows the same preparation retry', async () => {
  const f = await ready(),
    plan = preparePress(
      f.provider,
      f.image,
      f.proof,
      0,
      { type: 'pointerdown', pointerId: 1, button: 0 },
      { frame: 0, tick: 1 },
    );
  render.mockImplementationOnce(
    (_p, _f, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
      ),
  );
  const controller = new AbortController(),
    pending = renderPress(f.provider, plan, { signal: controller.signal });
  await expect(async () => renderPress(f.provider, plan)).rejects.toThrow(/busy/);
  controller.abort();
  await expect(pending).rejects.toThrow();
  await renderPress(f.provider, plan);
  f.owner.dispose();
});
it('admits an exact last host pose and rejects excess without changing complete private press history', async () => {
  const f = await ready();
  const image = await f.provider.render(
      Array.from({ length: 10000 }, (_, tick) => ({ frame: 0, tick })),
    ),
    proof = await querySymbolScriptArtworkTargets(f.provider, image, [{ x: 5, y: 5 }]),
    plan = preparePress(
      f.provider,
      image,
      proof,
      0,
      { type: 'pointerdown', pointerId: 1, button: 0 },
      { frame: 0, tick: 10000 },
    );
  expect(plan.snapshot()).toMatchObject({ poseCount: 10001, pressed: true });
  const last = await renderPress(f.provider, plan);
  await expect(event(f, last, 'pointerup')).rejects.toThrow();
  expect(render.mock.calls.at(-1)![1].at(-1)!.tick).toBe(10000);
  f.owner.dispose();
});

it.each(['source', 'cancel'] as const)(
  'rechecks %s after the completed detached press state clone before publishing output',
  async (fault) => {
    const f = await ready(),
      plan = preparePress(
        f.provider,
        f.image,
        f.proof,
        0,
        { type: 'pointerdown', pointerId: 1, button: 0 },
        { frame: 0, tick: 1 },
      ),
      stringify = JSON.stringify,
      controller = new AbortController();
    let armed = false,
      fired = false;
    render.mockImplementationOnce(async () => {
      armed = true;
      return new Blob(['png'], { type: 'image/png' });
    });
    const hook = vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
      if (
        armed &&
        !fired &&
        (value as { version?: number })?.version === 1 &&
        (value as { press?: { pressed?: { pointerId: number } } })?.press?.pressed?.pointerId === 1
      ) {
        fired = true;
        if (fault === 'source') f.source.revision++;
        else controller.abort();
      }
      return stringify(value, replacer as never, space);
    });
    await expect(renderPress(f.provider, plan, { signal: controller.signal })).rejects.toThrow(
      /changed|abort/i,
    );
    hook.mockRestore();
    expect(fired).toBe(true);
    f.source.revision = 1;
    expect(plan.snapshot().pressed).toBe(true);
    await renderPress(f.provider, plan);
    f.owner.dispose();
  },
);
it('snapshots original finite pointer and pose getter fields once', async () => {
  const f = await ready();
  const count = [0, 0, 0, 0, 0],
    plan = preparePress(
      f.provider,
      f.image,
      f.proof,
      0,
      {
        get type() {
          count[0]++;
          return 'pointerdown' as const;
        },
        get pointerId() {
          count[1]++;
          return 1;
        },
        get button() {
          count[2]++;
          return 0;
        },
      },
      {
        get frame() {
          count[3]++;
          return 2;
        },
        get tick() {
          count[4]++;
          return 1;
        },
      },
    );
  expect(count).toEqual([1, 1, 1, 1, 1]);
  await renderPress(f.provider, plan);
  expect(count).toEqual([1, 1, 1, 1, 1]);
  f.owner.dispose();
});

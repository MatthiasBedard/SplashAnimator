import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { newProject, clone, type Vector } from '../packages/document/src';
import { captureSymbolLocalProgram } from '../packages/scripting/src/symbol-program';
import {
  createSymbolScriptArtworkProvider,
  querySymbolScriptArtworkTargets,
  prepareSymbolScriptArtworkPress as preparePress,
  renderSymbolScriptArtworkPress as renderPress,
  prepareSymbolScriptArtworkDelivery as qualify,
  renderSymbolScriptArtworkDelivery as publish,
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

const pointer = { type: 'pointerup' as const, pointerId: 1, button: 0 };
async function down() {
  const f = await ready(),
    step = await event(f, f.image, 'pointerdown');
  const proof = await querySymbolScriptArtworkTargets(f.provider, step.image, [
    { x: 5, y: 5 },
    { x: -1, y: 0 },
  ]);
  return { ...f, image: step.image, proof };
}
it('qualifies matching activation before execution then publishes a separately chosen valid next frame', async () => {
  const f = await down(),
    before = clone(f.source.project),
    delivery = qualify(f.provider, f.image, f.proof, 0, pointer),
    input = delivery.input();
  expect(input).toMatchObject({
    type: 'pointerup',
    pointerId: 1,
    button: 0,
    buttonTarget: f.proof.targets[0],
    buttonActivation: f.proof.targets[0],
    targetFrame: 0,
    targetTick: 1,
    targetScope: 'symbol-local',
    targetNamespace: f.proof.namespace,
    targetImageId: f.proof.imageId,
  });
  expect(input.buttonActivation).not.toEqual(raw);
  expect(delivery.snapshot()).toMatchObject({ activates: true, pressed: false, state: 'over' });
  (input.buttonActivation as { instanceId: string }).instanceId = 'forged';
  input.type = 'pointercancel';
  expect(delivery.input().buttonActivation).toEqual(f.proof.targets[0]);
  expect((await querySymbolScriptArtworkTargets(f.provider, f.image, [{ x: 5, y: 5 }])).tick).toBe(
    1,
  );
  await publish(f.provider, delivery, { frame: 4, tick: 2 });
  expect(render.mock.calls.at(-1)![1].at(-1)).toMatchObject({
    frame: 4,
    tick: 2,
    buttonState: { instanceId: raw.instanceId, state: 'over' },
  });
  expect(f.source.project).toEqual(before);
  expect(() => delivery.input()).toThrow(/stale/);
  f.owner.dispose();
});
it.each([
  ['pointerup', 2, 0, 0],
  ['pointerup', 1, 2, 0],
  ['pointerup', 1, 0, 1],
  ['pointercancel', 1, -1, 0],
  ['pointerdown', 2, 0, 0],
  ['pointermove', 1, -1, 0],
  ['pointerleave', 1, -1, 1],
] as const)(
  'qualification %s pointer %s button %s hit %s cannot synthesize activation',
  async (type, pointerId, button, index) => {
    const f = await down(),
      delivery = qualify(f.provider, f.image, f.proof, index, { type, pointerId, button });
    expect(delivery.input().buttonActivation).toBeNull();
    await publish(f.provider, delivery, { frame: 0, tick: 2 });
    f.owner.dispose();
  },
);
it('requires an accepted original primary press and matching current lifetime', async () => {
  const f = await ready();
  expect(qualify(f.provider, f.image, f.proof, 0, pointer).input().buttonActivation).toBeNull();
  f.owner.dispose();
  const d = await down();
  raw.lifetime = 2;
  try {
    const proof = await querySymbolScriptArtworkTargets(d.provider, d.image, [{ x: 5, y: 5 }]);
    expect(qualify(d.provider, d.image, proof, 0, pointer).input().buttonActivation).toBeNull();
  } finally {
    raw.lifetime = 1;
    d.owner.dispose();
  }
});
it('unpublished/script-failed deliveries cannot reserve or release ownership and can be retried', async () => {
  const f = await down(),
    first = qualify(f.provider, f.image, f.proof, 0, pointer),
    again = qualify(f.provider, f.image, f.proof, 0, pointer);
  expect(first.input()).toEqual(again.input());
  expect(first.snapshot().activates).toBe(true);
  const foreign = qualify(f.provider, f.image, f.proof, 0, { ...pointer, pointerId: 2 });
  expect(foreign.snapshot().pressed).toBe(true);
  await publish(f.provider, first, { frame: 0, tick: 2 });
  await expect(async () => publish(f.provider, again, { frame: 0, tick: 2 })).rejects.toThrow(
    /stale/,
  );
  f.owner.dispose();
});
it('capture/restore of private history reconstructs qualification without borrowing old image authority', async () => {
  const f = await down(),
    history = captureHistory(f.provider, f.image),
    delivery = qualify(f.provider, f.image, f.proof, 0, pointer);
  await publish(f.provider, delivery, { frame: 0, tick: 2 });
  const image = await restoreHistory(f.provider, history),
    proof = await querySymbolScriptArtworkTargets(f.provider, image, [{ x: 5, y: 5 }]);
  expect(() => delivery.input()).toThrow(/stale/);
  expect(qualify(f.provider, image, proof, 0, pointer).snapshot().activates).toBe(true);
  f.owner.dispose();
});
it('requires exact provider query image and capability identity rather than copies or serialized input', async () => {
  const f = await down(),
    other = await down();
  for (const q of [{ ...f.proof }, other.proof])
    expect(() => qualify(f.provider, f.image, q, 0, pointer)).toThrow();
  expect(() => qualify({ ...f.provider }, f.image, f.proof, 0, pointer)).toThrow();
  expect(() => qualify(f.provider, new Blob([f.image]), f.proof, 0, pointer)).toThrow();
  const delivery = qualify(f.provider, f.image, f.proof, 0, pointer);
  for (const value of [
    { ...delivery },
    delivery.input(),
    delivery.snapshot(),
    JSON.parse(JSON.stringify(delivery)),
  ])
    await expect(async () => publish(f.provider, value, { frame: 0, tick: 2 })).rejects.toThrow();
  await expect(async () =>
    publish(other.provider, delivery, { frame: 0, tick: 2 }),
  ).rejects.toThrow();
  f.owner.dispose();
  expect(() => delivery.input()).toThrow();
  other.owner.dispose();
});
it.each([-1, 0.5, 2, NaN, Infinity])(
  'rejects raw invalid target index %s before qualification',
  async (index) => {
    const f = await down();
    expect(() => qualify(f.provider, f.image, f.proof, index, pointer)).toThrow();
    expect(qualify(f.provider, f.image, f.proof, 0, pointer).snapshot().activates).toBe(true);
    f.owner.dispose();
  },
);
it.each([
  { type: 'click', pointerId: 1, button: 0 },
  { type: 'pointerup', pointerId: NaN, button: 0 },
  { type: 'pointerup', pointerId: -1, button: 0 },
  { type: 'pointerup', pointerId: 1, button: 32 },
  { type: 'pointerup', pointerId: 1, button: 0, target: raw },
])('rejects malformed original delivery %j', async (input) => {
  const f = await down();
  expect(() => qualify(f.provider, f.image, f.proof, 0, input as never)).toThrow();
  f.owner.dispose();
});
it.each([
  { frame: NaN, tick: 2 },
  { frame: -1, tick: 2 },
  { frame: 6, tick: 2 },
  { frame: 0.5, tick: 2 },
  { frame: 0, tick: 1 },
  { frame: 0, tick: 3 },
  { frame: 0, tick: 2, buttonState: {} },
])('rejects invalid body result %j without consuming a qualified delivery', async (next) => {
  const f = await down(),
    delivery = qualify(f.provider, f.image, f.proof, 0, pointer);
  await expect(async () => publish(f.provider, delivery, next)).rejects.toThrow();
  expect(delivery.input().buttonActivation).not.toBeNull();
  await publish(f.provider, delivery, { frame: 0, tick: 2 });
  f.owner.dispose();
});
it.each(['source', 'query', 'reentry'] as const)(
  'rejects original %s changes from one-shot request getters',
  async (fault) => {
    const f = await down();
    let reads = 0;
    const input = {
      get type() {
        reads++;
        if (fault === 'source') f.source.revision++;
        else if (fault === 'query') f.proof.targets[0]!.name = 'Changed';
        else
          try {
            qualify(f.provider, f.image, f.proof, 0, pointer);
          } catch {}
        return 'pointerup' as const;
      },
      pointerId: 1,
      button: 0,
    };
    expect(() => qualify(f.provider, f.image, f.proof, 0, input)).toThrow();
    expect(reads).toBe(1);
    f.owner.dispose();
  },
);
it.each(['source', 'query', 'reentry'] as const)(
  'rejects actual detached library clone %s before returning input authority',
  async (fault) => {
    const f = await down(),
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
        else if (fault === 'query') f.proof.targets[0]!.name = 'Changed';
        else
          try {
            qualify(f.provider, f.image, f.proof, 0, pointer);
          } catch {}
      }
      return value;
    });
    expect(() => qualify(f.provider, f.image, f.proof, 0, pointer)).toThrow();
    hook.mockRestore();
    expect(fired).toBe(true);
    f.owner.dispose();
  },
);
it.each(['source', 'query', 'reentry'] as const)(
  'rechecks %s while cloning detached readonly input',
  async (fault) => {
    const f = await down(),
      delivery = qualify(f.provider, f.image, f.proof, 0, pointer),
      stringify = JSON.stringify;
    let fired = false;
    const hook = vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
      if (!fired && (value as { targetScope?: string })?.targetScope === 'symbol-local') {
        fired = true;
        if (fault === 'source') f.source.revision++;
        else if (fault === 'query') f.proof.targets[0]!.name = 'Changed';
        else
          try {
            delivery.input();
          } catch {}
      }
      return stringify(value, replacer as never, space);
    });
    expect(() => delivery.input()).toThrow();
    hook.mockRestore();
    expect(fired).toBe(true);
    f.owner.dispose();
  },
);
it.each(['source', 'query', 'reentry'] as const)(
  'rejects %s from separately captured body-result getters',
  async (fault) => {
    const f = await down(),
      delivery = qualify(f.provider, f.image, f.proof, 0, pointer);
    let reads = 0;
    const next = {
      get frame() {
        reads++;
        if (fault === 'source') f.source.revision++;
        else if (fault === 'query') f.proof.targets[0]!.name = 'Changed';
        else
          try {
            delivery.input();
          } catch {}
        return 0;
      },
      tick: 2,
    };
    await expect(async () => publish(f.provider, delivery, next)).rejects.toThrow();
    expect(reads).toBe(1);
    f.owner.dispose();
  },
);
it.each(['source', 'query', 'candidate', 'output'] as const)(
  'late %s rejects publication without consuming original press/image/queue authority',
  async (fault) => {
    const f = await down(),
      delivery = qualify(f.provider, f.image, f.proof, 0, pointer);
    render.mockImplementationOnce(async (project) => {
      if (fault === 'source') f.source.revision++;
      if (fault === 'query') f.proof.targets[0]!.name = 'Changed';
      if (fault === 'candidate') project.width++;
      return new Blob(['png'], { type: fault === 'output' ? 'text/plain' : 'image/png' });
    });
    await expect(publish(f.provider, delivery, { frame: 0, tick: 2 })).rejects.toThrow();
    if (fault === 'source') f.source.revision = 1;
    if (fault === 'query') f.proof.targets[0]!.name = 'Button';
    expect(delivery.snapshot().activates).toBe(true);
    await publish(f.provider, delivery, { frame: 0, tick: 2 });
    f.owner.dispose();
  },
);
it('busy and cancelled body-result rendering preserve qualified retry and private press ownership', async () => {
  const f = await down(),
    delivery = qualify(f.provider, f.image, f.proof, 0, pointer);
  render.mockImplementationOnce(
    (_p, _f, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
      ),
  );
  const controller = new AbortController(),
    pending = publish(f.provider, delivery, { frame: 0, tick: 2 }, { signal: controller.signal });
  await expect(async () => publish(f.provider, delivery, { frame: 0, tick: 2 })).rejects.toThrow(
    /busy/,
  );
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(delivery.input().buttonActivation).not.toBeNull();
  await publish(f.provider, delivery, { frame: 0, tick: 2 });
  f.owner.dispose();
});
it('admits exact final complete history capacity but cannot qualify a further tick', async () => {
  const f = await ready(),
    image = await f.provider.render(
      Array.from({ length: 10000 }, (_, tick) => ({ frame: 0, tick })),
    ),
    proof = await querySymbolScriptArtworkTargets(f.provider, image, [{ x: 5, y: 5 }]),
    delivery = qualify(f.provider, image, proof, 0, {
      type: 'pointerdown',
      pointerId: 1,
      button: 0,
    }),
    last = await publish(f.provider, delivery, { frame: 0, tick: 10000 }),
    q = await querySymbolScriptArtworkTargets(f.provider, last, [{ x: 5, y: 5 }]);
  expect(render.mock.calls.at(-1)![1]).toHaveLength(10001);
  expect(() => qualify(f.provider, last, q, 0, pointer)).toThrow();
  f.owner.dispose();
});

it('snapshots one synchronous input-admission callback and rejects a real late input change without consuming delivery', async () => {
  const f = await down(),
    delivery = qualify(f.provider, f.image, f.proof, 0, pointer);
  let reads = 0,
    checks = 0,
    changed = false;
  const options = {
    get validateInput() {
      reads++;
      return () => {
        checks++;
        if (changed) throw new Error('Original input changed');
      };
    },
  };
  render.mockImplementationOnce(async () => {
    changed = true;
    return new Blob(['png'], { type: 'image/png' });
  });
  await expect(publish(f.provider, delivery, { frame: 0, tick: 2 }, options)).rejects.toThrow(
    'Original input changed',
  );
  expect(reads).toBe(1);
  expect(checks).toBeGreaterThan(1);
  expect(delivery.input().buttonActivation).not.toBeNull();
  changed = false;
  await publish(f.provider, delivery, { frame: 0, tick: 2 }, options);
  expect(reads).toBe(2);
  f.owner.dispose();
});
it.each(['async', 'invalid', 'reentry'] as const)(
  'rejects %s input admission while retaining original image and retry',
  async (fault) => {
    const f = await down(),
      delivery = qualify(f.provider, f.image, f.proof, 0, pointer);
    const validateInput =
      fault === 'invalid'
        ? 3
        : fault === 'async'
          ? () => Promise.resolve()
          : () => {
              try {
                delivery.input();
              } catch {}
            };
    await expect(async () =>
      publish(
        f.provider,
        delivery,
        { frame: 0, tick: 2 },
        { validateInput: validateInput as never },
      ),
    ).rejects.toThrow();
    expect(delivery.input().buttonActivation).not.toBeNull();
    await publish(f.provider, delivery, { frame: 0, tick: 2 });
    f.owner.dispose();
  },
);

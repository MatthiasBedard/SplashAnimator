import { afterEach, expect, it, vi } from 'vitest';
import { encodeAvcMp4 } from '../packages/export-video/src/avc-mp4';
import * as encoder from '../packages/export-video/src/avc-encoder';
import * as muxer from '../packages/export-video/src/mp4-avc';
import {
  prepareAvcSamples,
  readPreparedAvcSample,
  type PreparedAvcSamples,
} from '../packages/export-video/src/avc-samples';
const settings = {
  width: 2,
  height: 2,
  frameCount: 3,
  rate: 30000,
  scale: 1001,
  bitrate: 100000,
  keyFrameInterval: 2,
};
const description = new Uint8Array([
  1, 66, 0xe0, 31, 0xff, 0xe1, 0, 5, 0x67, 66, 0xe0, 31, 0x80, 1, 0, 2, 0x68, 0x80,
]);
const rgba = () => new Uint8Array(16).fill(255);
function setup() {
  const state: {
    seen: number[];
    frames: Uint8Array[];
    disposed: number;
    gate?: () => Promise<void>;
    appendGate?: () => Promise<void>;
    capture?: PreparedAvcSamples;
    native?: encoder.AvcNative;
    failure?: string;
  } = { seen: [], frames: [], disposed: 0 };
  vi.spyOn(encoder, 'openAvcEncoder').mockImplementation(async (s, o = {}, native) => {
    state.native = native;
    await state.gate?.();
    o.signal?.throwIfAborted();
    o.validate?.();
    return Object.freeze({
      async append(bytes: Uint8Array) {
        o.validate?.();
        o.signal?.throwIfAborted();
        if (
          !(bytes instanceof Uint8Array) ||
          bytes.length !== 16 ||
          bytes.some((v, i) => i % 4 === 3 && v !== 255)
        )
          throw Error('invalid frame');
        state.frames.push(bytes.slice());
        await state.appendGate?.();
        o.signal?.throwIfAborted();
        o.validate?.();
        if (state.failure === 'append') throw Error('native append failed');
      },
      finish() {
        o.validate?.();
        if (state.failure === 'finish') throw Error('native finish failed');
        const result = prepareAvcSamples(
          s,
          description,
          Array.from({ length: s.frameCount }, (_, i) => ({
            bytes: new Uint8Array([0, 0, 0, 2, i ? 0x41 : 0x65, 0xaa]),
            keyFrame: i === 0,
          })),
          o,
        );
        state.capture = result;
        return result;
      },
      dispose() {
        state.disposed++;
      },
    });
  });
  return state;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('captures settings/options/native getters once, serializes provider frames and publishes only complete detached bytes', async () => {
  const state = setup();
  let release!: () => void;
  state.gate = () =>
    new Promise<void>((r) => {
      release = r;
    });
  let nativeReads = 0;
  const E = class {} as unknown as typeof VideoEncoder,
    F = class {} as unknown as typeof VideoFrame,
    native = {
      get Encoder() {
        nativeReads++;
        return E;
      },
      get Frame() {
        nativeReads++;
        return F;
      },
    };
  const s = { ...settings },
    o = { maxBytes: 10000 },
    calls: number[] = [],
    input = rgba();
  const job = encodeAvcMp4(
    s,
    (i, signal) => {
      signal.throwIfAborted();
      calls.push(i);
      return i === 1 ? Promise.resolve(input) : input;
    },
    o,
    native,
  );
  s.frameCount = 1;
  s.rate = 1;
  o.maxBytes = 1;
  expect(calls).toEqual([]);
  release();
  const result = await job;
  input.fill(0);
  expect(calls).toEqual([0, 1, 2]);
  expect(state.frames).toEqual([rgba(), rgba(), rgba()]);
  expect(nativeReads).toBe(2);
  expect(state.native).toMatchObject({ Encoder: E, Frame: F });
  expect(result).toMatchObject({
    frameCount: 3,
    rate: 30000,
    scale: 1001,
    durationTicks: 3003,
    timescale: 30000,
    codec: 'avc1.42e01f',
  });
  expect(result.bytes.length).toBe(result.byteLength);
  expect(Object.isFrozen(result)).toBe(true);
  expect(() => readPreparedAvcSample(state.capture!, 0)).toThrow(/disposed/);
  expect(state.disposed).toBe(1);
});
it('snapshots synchronous provider output before microtasks can mutate its storage', async () => {
  const state = setup(),
    input = rgba();
  await encodeAvcMp4({ ...settings, frameCount: 1 }, () => {
    queueMicrotask(() => input.fill(0));
    return input;
  });
  expect(input[0]).toBe(0);
  expect(state.frames).toEqual([rgba()]);
});
it.each(['provider', 'append', 'finish'] as const)(
  'cleans native/capture resources after %s failure without output',
  async (fault) => {
    const state = setup();
    state.failure = fault;
    await expect(
      encodeAvcMp4(settings, (i) => {
        if (fault === 'provider' && i === 1) throw Error('provider failed');
        return rgba();
      }),
    ).rejects.toThrow(/failed/);
    expect(state.disposed).toBe(1);
  },
);
it.each([undefined, null, {}, new Uint8Array(4), new Uint8Array(16)] as const)(
  'rejects malformed provider output atomically',
  async (value) => {
    const state = setup();
    await expect(encodeAvcMp4(settings, () => value as Uint8Array)).rejects.toThrow();
    expect(state.disposed).toBe(1);
  },
);
it('rejects raw settings/options before native work or caller source callbacks', async () => {
  setup();
  const validate = vi.fn(),
    read = vi.fn(rgba);
  for (const bad of [
    { width: NaN },
    { rate: Infinity },
    { scale: 0 },
    { frameCount: 10002 },
    { width: 65535, height: 65535 },
    { bitrate: 0 },
  ])
    await expect(encodeAvcMp4({ ...settings, ...bad }, read, { validate })).rejects.toThrow();
  for (const o of [
    { maxBytes: 0 },
    { maxBytes: Infinity },
    { timeoutMs: 0 },
    { signal: {} as AbortSignal },
  ])
    await expect(encodeAvcMp4(settings, read, { ...o, validate })).rejects.toThrow();
  expect(encoder.openAvcEncoder).not.toHaveBeenCalled();
  expect(validate).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
it('rejects async validation and original source changes during provider delivery', async () => {
  let state = setup();
  await expect(
    encodeAvcMp4(settings, rgba, { validate: (() => Promise.resolve()) as never }),
  ).rejects.toThrow(/synchronous/);
  expect(state.disposed).toBe(0);
  vi.restoreAllMocks();
  state = setup();
  let changed = false;
  await expect(
    encodeAvcMp4(
      settings,
      () => {
        changed = true;
        return rgba();
      },
      {
        validate() {
          if (changed) throw Error('source changed');
        },
      },
    ),
  ).rejects.toThrow(/source/);
  expect(state.disposed).toBe(1);
  expect(state.frames).toHaveLength(0);
});
it.each(['support', 'provider', 'flush'] as const)(
  'cancels held %s work and rejects late completion without additional frames',
  async (stage) => {
    const state = setup();
    let release!: () => void, arrived!: () => void;
    const reached = new Promise<void>((r) => {
        arrived = r;
      }),
      gate = () =>
        new Promise<void>((r) => {
          release = r;
          arrived();
        });
    if (stage === 'support') state.gate = gate;
    if (stage === 'flush') state.appendGate = gate;
    const c = new AbortController(),
      calls: number[] = [],
      job = encodeAvcMp4(
        settings,
        async (i) => {
          calls.push(i);
          if (stage === 'provider') await gate();
          return rgba();
        },
        { signal: c.signal },
      );
    await reached;
    c.abort(Error('cancel ' + stage));
    await expect(job).rejects.toThrow('cancel ' + stage);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.length).toBeLessThanOrEqual(1);
    if (stage !== 'support') expect(state.disposed).toBe(1);
  },
);
it.each(['support', 'provider', 'flush'] as const)(
  'applies one overall deadline to held %s and clears timers',
  async (stage) => {
    const state = setup();
    vi.useFakeTimers();
    const gate = () => new Promise<void>(() => {});
    if (stage === 'support') state.gate = gate;
    if (stage === 'flush') state.appendGate = gate;
    const job = encodeAvcMp4(
        settings,
        async () => {
          if (stage === 'provider') await gate();
          return rgba();
        },
        { timeoutMs: 5 },
      ),
      rejected = expect(job).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  },
);
it.each(['source', 'cancel'] as const)(
  'rejects late %s after complete MP4 bytes exist and cleans all private storage',
  async (fault) => {
    const state = setup(),
      original = muxer.prepareAvcMp4,
      c = new AbortController();
    let changed = false,
      fired = false;
    vi.spyOn(muxer, 'prepareAvcMp4').mockImplementation((...args) => {
      const result = original(...args);
      return {
        ...result,
        bytes(signal) {
          const complete = result.bytes(signal);
          expect(complete.length).toBeGreaterThan(700);
          fired = true;
          if (fault === 'source') changed = true;
          else c.abort(Error('late cancel'));
          return complete;
        },
      };
    });
    await expect(
      encodeAvcMp4(settings, rgba, {
        signal: c.signal,
        validate() {
          if (changed) throw Error('late source');
        },
      }),
    ).rejects.toThrow(/late/);
    expect(fired).toBe(true);
    expect(() => readPreparedAvcSample(state.capture!, 0)).toThrow(/disposed/);
    expect(state.disposed).toBe(1);
  },
);
it('admits exact encoded reservation and rejects one less without a partial receipt', async () => {
  const state = setup(),
    exact = 1024 + 256 * 3 + description.length + 18;
  await expect(encodeAvcMp4(settings, rgba, { maxBytes: exact - 1 })).rejects.toThrow(/budget/);
  const result = await encodeAvcMp4(settings, rgba, { maxBytes: exact });
  expect(result.byteLength).toBeLessThanOrEqual(exact);
  expect(state.disposed).toBe(2);
});
it('captures the original support method before source callbacks can replace it', async () => {
  const state = setup(),
    Support = vi.fn(),
    replacement = vi.fn(),
    E = class {
      static isConfigSupported = Support;
    } as unknown as typeof VideoEncoder;
  await encodeAvcMp4(
    settings,
    rgba,
    {
      validate() {
        E.isConfigSupported = replacement;
      },
    },
    { Encoder: E, Frame: class {} as unknown as typeof VideoFrame },
  );
  expect(state.native?.Support).toBe(Support);
  expect(E.isConfigSupported).toBe(replacement);
});
it('disposes an asynchronously late successful host after cancellation won opening', async () => {
  setup();
  let resolve!: (host: Awaited<ReturnType<typeof encoder.openAvcEncoder>>) => void;
  vi.mocked(encoder.openAvcEncoder).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const c = new AbortController(),
    read = vi.fn(rgba),
    job = encodeAvcMp4(settings, read, { signal: c.signal });
  c.abort(Error('cancel opening'));
  await expect(job).rejects.toThrow('cancel opening');
  const dispose = vi.fn();
  resolve({ append: vi.fn(), finish: vi.fn(), dispose });
  await Promise.resolve();
  await Promise.resolve();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
});
it('preaborted jobs start no encoder/provider and callback aborts remain authoritative', async () => {
  const state = setup(),
    c = new AbortController();
  c.abort(Error('already cancelled'));
  const read = vi.fn(rgba);
  await expect(encodeAvcMp4(settings, read, { signal: c.signal })).rejects.toThrow(
    'already cancelled',
  );
  expect(encoder.openAvcEncoder).not.toHaveBeenCalled();
  const next = new AbortController();
  await expect(
    encodeAvcMp4(
      settings,
      () => {
        next.abort(Error('source cancelled'));
        return rgba();
      },
      { signal: next.signal },
    ),
  ).rejects.toThrow('source cancelled');
  expect(state.frames).toHaveLength(0);
  expect(state.disposed).toBe(1);
});

import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { newProject, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
const state = vi.hoisted(() => ({
  frames: [] as number[],
  projects: [] as unknown[],
  signals: [] as AbortSignal[],
  disposed: 0,
  stall: false,
  gate: undefined as undefined | (() => Promise<void>),
  realm: undefined as undefined | Uint8ClampedArray,
  late: undefined as undefined | (() => void),
}));
vi.mock('../apps/editor/src/frame-replay', () => ({
  createFrameReplay: vi.fn((project, options) => {
    state.projects.push(structuredClone(project));
    state.signals.push(options.signal);
    return {
      dispose() {
        state.disposed++;
      },
      async seek(frame: number) {
        state.frames.push(frame);
        await state.gate?.();
        return { data: state.realm ?? new Uint8ClampedArray(16).fill(255) } as ImageData;
      },
    };
  }),
}));
vi.mock('../packages/export-video/src/avc-mp4', () => ({
  encodeAvcMp4: vi.fn(async (settings, source, options, native) => {
    if (state.stall) return new Promise(() => {});
    for (let i = 0; i < settings.frameCount; i++) {
      options.signal.throwIfAborted();
      options.validate();
      const rgba = await source(i, options.signal);
      expect(rgba.buffer).toBeInstanceOf(ArrayBuffer);
    }
    const result = {
      bytes: new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112]),
      byteLength: 8,
      frameCount: settings.frameCount,
      width: settings.width,
      height: settings.height,
      rate: settings.rate,
      scale: settings.scale,
      durationTicks: settings.frameCount * settings.scale,
      timescale: settings.rate,
      codec: 'avc1.42c014',
      native: native.Encoder,
    };
    state.late?.();
    return result;
  }),
}));
import { encodeAvcMp4 } from '../packages/export-video/src/avc-mp4';
import { createFrameReplay } from '../apps/editor/src/frame-replay';
import { exportProjectMp4 } from '../apps/editor/src/export-mp4';
function setup() {
  state.frames = [];
  state.projects = [];
  state.signals = [];
  state.disposed = 0;
  state.stall = false;
  state.gate = undefined;
  state.realm = undefined;
  state.late = undefined;
  vi.mocked(encodeAvcMp4).mockClear();
  vi.mocked(createFrameReplay).mockClear();
  vi.stubGlobal(
    'VideoEncoder',
    class {
      static isConfigSupported = vi.fn();
    },
  );
  vi.stubGlobal('VideoFrame', class {});
}
function fixture() {
  const p = newProject();
  p.width = p.height = 2;
  p.duration = 4;
  p.fps = 30000 / 1001;
  return p;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('detaches original project/range/options/native references and retains exact selected rational timing', async () => {
  setup();
  const p = fixture(),
    original = structuredClone(p),
    E = VideoEncoder,
    F = VideoFrame,
    Support = E.isConfigSupported,
    range = { start: 1, end: 2 },
    progress = vi.fn(),
    options = { range, progress };
  let release!: () => void;
  state.gate = () =>
    new Promise<void>((r) => {
      release = r;
    });
  const job = exportProjectMp4(p, new AbortController().signal, options);
  // Replay is asynchronous; wait until the original detached first seek is held.
  await Promise.resolve();
  p.duration = 1;
  p.fps = 1;
  range.start = 0;
  range.end = 0;
  options.progress = vi.fn();
  E.isConfigSupported = vi.fn();
  vi.stubGlobal('VideoEncoder', undefined);
  vi.stubGlobal('VideoFrame', undefined);
  state.gate = undefined;
  release();
  const result = await job;
  expect(result).toMatchObject({
    start: 1,
    end: 2,
    frameCount: 2,
    rate: 30000,
    scale: 1001,
    durationTicks: 2002,
    remembered: false,
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(state.projects[0]).toEqual(original);
  expect(state.frames).toEqual([1, 2]);
  expect(progress.mock.calls).toEqual([
    [1, 2],
    [2, 2],
  ]);
  expect(options.progress).not.toHaveBeenCalled();
  expect(vi.mocked(encodeAvcMp4).mock.calls[0][3]).toEqual({ Encoder: E, Frame: F, Support });
  expect(state.disposed).toBe(1);
  expect(state.signals[0].aborted).toBe(true);
});
for (const remembered of [false, true])
  it('keeps evaluated remembered geometry explicit ' + remembered, async () => {
    setup();
    const p = fixture();
    p.duration = 3;
    const s: Vector = {
      id: 'ink',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    p.layers[0].keys = [
      { frame: 0, shapes: [s] },
      { frame: 2, shapes: [{ ...s, x: 20 }] },
    ];
    createBasicMotionSpan(p, [p.layers[0].id], 0, 2, 'linear');
    p.layers[0].keys[2].shapes[0].x = 40;
    const before = structuredClone(p);
    await exportProjectMp4(p, new AbortController().signal, { remembered });
    const captured = state.projects[0] as typeof p;
    expect(captured.layers[0].keys[1].shapes[0].x).toBe(remembered ? 20 : 10);
    expect(p).toEqual(before);
  });
it('copies cross-realm iframe pixels and preserves source/history/settings', async () => {
  setup();
  state.realm = runInNewContext('new Uint8ClampedArray(16).fill(255)');
  const p = fixture(),
    before = structuredClone(p);
  expect((await exportProjectMp4(p, new AbortController().signal)).frameCount).toBe(4);
  expect(p).toEqual(before);
  expect(state.frames).toEqual([0, 1, 2, 3]);
});
for (const options of [
  { remembered: null },
  { range: null },
  { range: [] },
  { range: { start: 2, end: 1 } },
  { range: { start: NaN, end: 2 } },
  { bitrate: 0 },
  { keyFrameInterval: 301 },
  { timeoutMs: 0 },
  { maxBytes: 0 },
  { progress: 1 },
  { validate: 1 },
])
  it(
    'rejects original MP4 options ' + JSON.stringify(options) + ' before replay/encoding',
    async () => {
      setup();
      await expect(
        exportProjectMp4(
          fixture(),
          new AbortController().signal,
          options as Parameters<typeof exportProjectMp4>[2],
        ),
      ).rejects.toThrow();
      expect(createFrameReplay).not.toHaveBeenCalled();
      expect(encodeAvcMp4).not.toHaveBeenCalled();
    },
  );
it('rejects invalid original data, unavailable codec and async source validation without silent fallback', async () => {
  setup();
  const p = fixture();
  p.layers[0].keys[0].shapes = [
    {
      id: 'bad',
      kind: 'rectangle',
      x: NaN,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  await expect(exportProjectMp4(p, new AbortController().signal)).rejects.toThrow();
  vi.stubGlobal('VideoEncoder', undefined);
  await expect(exportProjectMp4(fixture(), new AbortController().signal)).rejects.toThrow(
    /unavailable/,
  );
  setup();
  await expect(
    exportProjectMp4(fixture(), new AbortController().signal, {
      validate: (() => Promise.resolve()) as never,
    }),
  ).rejects.toThrow(/synchronous/);
  expect(encodeAvcMp4).not.toHaveBeenCalled();
});
it.each(['source', 'async', 'throw'] as const)(
  'rejects %s progress without publishing the current frame',
  async (fault) => {
    setup();
    let valid = true;
    const options = {
      validate() {
        if (!valid) throw Error('source changed');
      },
      progress() {
        if (fault === 'source') {
          valid = false;
          options.validate = () => {};
        } else if (fault === 'async') return Promise.resolve() as never;
        else throw Error('progress failed');
      },
    };
    await expect(
      exportProjectMp4(fixture(), new AbortController().signal, options),
    ).rejects.toThrow();
    expect(state.disposed).toBe(1);
    expect(state.frames).toEqual([0]);
  },
);
it.each(['source', 'cancel'] as const)(
  'rejects actual late %s after complete encoded bytes exist',
  async (fault) => {
    setup();
    let valid = true;
    const c = new AbortController();
    state.late = () => {
      if (fault === 'source') valid = false;
      else c.abort(Error('late cancelled'));
    };
    await expect(
      exportProjectMp4(fixture(), c.signal, {
        validate() {
          if (!valid) throw Error('late source');
        },
      }),
    ).rejects.toThrow(/late/);
    expect(state.disposed).toBe(1);
    expect(state.frames).toEqual([0, 1, 2, 3]);
  },
);
it('cancels held readiness and ignores its late pixels, then retries independently', async () => {
  setup();
  let release!: () => void;
  state.gate = () =>
    new Promise<void>((r) => {
      release = r;
    });
  const c = new AbortController(),
    job = exportProjectMp4(fixture(), c.signal);
  await Promise.resolve();
  c.abort(Error('replay cancelled'));
  await expect(job).rejects.toThrow('replay cancelled');
  release();
  await Promise.resolve();
  state.gate = undefined;
  expect(state.disposed).toBe(1);
  expect((await exportProjectMp4(fixture(), new AbortController().signal)).frameCount).toBe(4);
  expect(state.disposed).toBe(2);
});
it.each(['readiness', 'encoding'] as const)(
  'applies one overall deadline during held %s and clears resources',
  async (stage) => {
    setup();
    vi.useFakeTimers();
    if (stage === 'readiness') state.gate = () => new Promise<void>(() => {});
    else state.stall = true;
    const job = exportProjectMp4(fixture(), new AbortController().signal, { timeoutMs: 5 }),
      rejected = expect(job).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5);
    await rejected;
    expect(state.disposed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(state.signals[0].aborted).toBe(true);
  },
);
it('preaborted capture starts no replay or encoder', async () => {
  setup();
  const c = new AbortController();
  c.abort(Error('preabort'));
  await expect(exportProjectMp4(fixture(), c.signal)).rejects.toThrow('preabort');
  expect(createFrameReplay).not.toHaveBeenCalled();
  expect(encodeAvcMp4).not.toHaveBeenCalled();
});

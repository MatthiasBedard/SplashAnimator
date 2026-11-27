import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newProject } from '../packages/document/src';
import { encodePcm16Wav } from '../packages/audio/src/wav-encode';
import { audioSampleRange } from '../packages/audio/src/pcm';
import { ffmpegFrameRate, ffmpegBundlePlan } from '../apps/editor/src/ffmpeg-bundle-plan';
const deps = vi.hoisted(() => ({
  frames: vi.fn(),
  audio: vi.fn(),
  wav: vi.fn(),
  remembered: vi.fn(),
}));
vi.mock('../apps/editor/src/export-png', () => ({ capturePNGSequenceFrames: deps.frames }));
vi.mock('../apps/editor/src/remembered-png', () => ({
  prepareRememberedPNGProject: deps.remembered,
}));
vi.mock('../packages/audio/src/project-preview', () => ({ prepareProjectAudio: deps.audio }));
vi.mock('../packages/audio/src/wav-encode-async', () => ({ encodePcm16WavAsync: deps.wav }));
import {
  exportFFmpegBundle,
  exportFFmpegBundleToSink,
  type FFmpegBundleSink,
  type FFmpegBundleOptions,
} from '../apps/editor/src/export-ffmpeg';
function fixture(audio = false) {
  const p = newProject();
  p.width = 32;
  p.height = 24;
  p.duration = 3;
  p.fps = 20;
  if (audio) {
    p.assets = [
      {
        id: 'a',
        path: 'assets/audio/a.wav',
        audio: { name: 'A', format: 'pcm16-wav', sampleRate: 48000, channels: 1, frames: 7200 },
      },
    ];
    p.audioClips = [{ id: 'clip', assetId: 'a', startFrame: 0, offsetSamples: 0, gain: 1 }];
  }
  return p;
}
function frame(width: number, height: number, index: number) {
  const b = new Uint8Array(33),
    v = new DataView(b.buffer);
  b.set([137, 80, 78, 71, 13, 10, 26, 10]);
  v.setUint32(8, 13);
  v.setUint32(12, 0x49484452);
  v.setUint32(16, width);
  v.setUint32(20, height);
  b[24] = 8;
  b[32] = index;
  return new Blob([b], { type: 'image/png' });
}
async function entries(blob: Blob) {
  const bytes = await blob.arrayBuffer(),
    v = new DataView(bytes),
    out = new Map<string, Uint8Array>();
  let at = v.getUint32(bytes.byteLength - 6, true);
  const count = v.getUint16(bytes.byteLength - 12, true);
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const n = v.getUint16(at + 28, true),
      size = v.getUint32(at + 24, true),
      local = v.getUint32(at + 42, true),
      name = new TextDecoder().decode(new Uint8Array(bytes, at + 46, n)),
      start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.set(name, new Uint8Array(bytes.slice(start, start + size)));
    at += 46 + n + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}
beforeEach(() => {
  deps.frames
    .mockReset()
    .mockImplementation(async (p, consume, signal, range, _transparent, scale) => {
      for (let i = range?.start ?? 0; i <= (range?.end ?? p.duration - 1); i++) {
        signal.throwIfAborted();
        await consume(i, frame(p.width * scale, p.height * scale, i));
      }
    });
  deps.remembered.mockReset().mockImplementation(async (p) => structuredClone(p));
  deps.audio.mockReset().mockImplementation(async (p, load, job) => {
    await load(p.assets[0].path, job.signal);
    const r = audioSampleRange(job.startFrame, job.endFrame, p.fps, 48000);
    return {
      channels: [new Float32Array(r.end - r.start).fill(0.25)],
      sampleRate: 48000,
      startSample: r.start,
      endSample: r.end,
      clippedSamples: 0,
      resampling: { assets: 0 },
    };
  });
  deps.wav.mockReset().mockImplementation(async (c, r, o) => encodePcm16Wav(c, r, o));
});
afterEach(() => vi.restoreAllMocks());
for (const [fps, n, d] of [
  [24, 24, 1],
  [29.97, 2997, 100],
  [23.976, 2997, 125],
  [59.94, 2997, 50],
  [1.25, 5, 4],
  [120, 120, 1],
])
  it('keeps exact decimal frame rate ' + fps, () =>
    expect(ffmpegFrameRate(fps)).toEqual({ numerator: n, denominator: d }),
  );
for (const fps of [NaN, Infinity, 0, -1, 1.0000000000000002, Number.MIN_VALUE])
  it('rejects unrepresentable/raw rate ' + fps, () => expect(() => ffmpegFrameRate(fps)).toThrow());
it('plans fixed sequence paths, exact selected numbering and data-only mapped arguments', () => {
  const p = fixture();
  p.fps = 29.97;
  p.name = '$(hostile) %PATH%';
  const plan = ffmpegBundlePlan(p, { start: 1, end: 2 }, 2, true, true);
  expect(plan.video).toMatchObject({
    firstNumber: 2,
    frameCount: 2,
    width: 64,
    height: 48,
    frameRate: { numerator: 2997, denominator: 100 },
    sourceStartFrame: 1,
    sourceEndFrameExclusive: 3,
  });
  expect(plan.inputArguments).toEqual([
    '-framerate',
    '2997/100',
    '-pattern_type',
    'sequence',
    '-start_number',
    '2',
    '-start_number_range',
    '1',
    '-i',
    'frame-%06d.png',
    '-i',
    'audio.wav',
  ]);
  expect(plan.suggestedArguments).toContain('1:a:0');
  expect(JSON.stringify(plan)).not.toContain('hostile');
});
for (const range of [
  { start: -1, end: 1 },
  { start: 1, end: 0 },
  { start: 0, end: 3 },
  { start: NaN, end: 1 },
  { start: 0.5, end: 1 },
])
  it('rejects raw range ' + JSON.stringify(range), () =>
    expect(() => ffmpegBundlePlan(fixture(), range, 1, false, false)).toThrow(),
  );
it('packages sequential detached frame header fixtures without audio or executable scripts', async () => {
  const p = fixture(),
    before = structuredClone(p),
    r = await exportFFmpegBundle(p, undefined, new AbortController().signal);
  expect(p).toEqual(before);
  expect(deps.audio).not.toHaveBeenCalled();
  expect(deps.frames.mock.calls[0][0]).not.toBe(p);
  const files = await entries(r.blob);
  expect([...files.keys()]).toEqual([
    'frame-000001.png',
    'frame-000002.png',
    'frame-000003.png',
    'ffmpeg.json',
    'README.txt',
  ]);
  expect([...files.values()].slice(0, 3).map((v) => v[32])).toEqual([0, 1, 2]);
  expect(r.manifest.audio).toBeNull();
  const original = files.get('ffmpeg.json')!.slice();
  r.manifest.video.frameCount = 100;
  expect((await entries(r.blob)).get('ffmpeg.json')).toEqual(original);
});
it('keeps original absolute sample boundaries and exact encoded selected WAV bytes', async () => {
  const p = fixture(true),
    load = vi.fn(async () => new Blob(['owned'])),
    r = await exportFFmpegBundle(p, load, new AbortController().signal, {
      includeAudio: true,
      range: { start: 1, end: 2 },
    }),
    files = await entries(r.blob);
  expect(load).toHaveBeenCalledWith('assets/audio/a.wav', expect.any(AbortSignal));
  expect(r.manifest.audio).toMatchObject({
    start: 2400,
    end: 7200,
    frames: 4800,
    sampleRate: 48000,
    channels: 1,
  });
  expect(files.get('audio.wav')).toEqual(
    encodePcm16Wav([new Float32Array(4800).fill(0.25)], 48000),
  );
  expect([...files.keys()]).toContain('frame-000002.png');
  expect([...files.keys()]).not.toContain('frame-000001.png');
});
it('admits exact archive capacity and rejects one byte less without a complete result', async () => {
  const p = fixture(),
    first = await exportFFmpegBundle(p, undefined, new AbortController().signal),
    size = first.blob.size;
  const exact = await exportFFmpegBundle(p, undefined, new AbortController().signal, {
    maxBytes: size,
  });
  expect(await exact.blob.arrayBuffer()).toEqual(await first.blob.arrayBuffer());
  await expect(
    exportFFmpegBundle(p, undefined, new AbortController().signal, { maxBytes: size - 1 }),
  ).rejects.toThrow(/limit/);
});
it('routes remembered capture through detached original input and the same frame consumer', async () => {
  const p = fixture(),
    r = await exportFFmpegBundle(p, undefined, new AbortController().signal, { remembered: true });
  expect(deps.remembered).toHaveBeenCalledTimes(1);
  expect(deps.remembered.mock.calls[0][0]).not.toBe(p);
  expect(r.manifest.remembered).toBe(true);
});
for (const options of [
  { includeAudio: 1 },
  { transparent: 'false' },
  { remembered: 1 },
  { scale: NaN },
  { maxBytes: Infinity },
  { maxBytes: 21 },
  { timeoutMs: 0 },
  { audioChannels: 3 },
  { codec: 'unsafe' },
  { range: { start: 0, end: 1, other: 1 } },
])
  it('rejects malformed settings ' + JSON.stringify(options), async () => {
    await expect(
      exportFFmpegBundle(
        fixture(),
        undefined,
        new AbortController().signal,
        options as FFmpegBundleOptions,
      ),
    ).rejects.toThrow();
    expect(deps.frames).not.toHaveBeenCalled();
  });
it('rejects missing audio rather than silently dropping requested sound', async () => {
  await expect(
    exportFFmpegBundle(fixture(true), undefined, new AbortController().signal, {
      includeAudio: true,
    }),
  ).rejects.toThrow();
  await expect(
    exportFFmpegBundle(fixture(), async () => new Blob([]), new AbortController().signal, {
      includeAudio: true,
    }),
  ).rejects.toThrow(/no audio/);
  expect(deps.frames).not.toHaveBeenCalled();
});
it('rejects original nonfinite geometry before JSON cloning could normalize it', async () => {
  const p = fixture();
  p.width = NaN;
  await expect(exportFFmpegBundle(p, undefined, new AbortController().signal)).rejects.toThrow();
  expect(deps.frames).not.toHaveBeenCalled();
});
for (const mode of ['order', 'dimensions', 'header', 'incomplete'])
  it('rejects invalid frame delivery ' + mode, async () => {
    deps.frames.mockImplementation(async (_p, consume) => {
      if (mode === 'incomplete') return;
      await consume(
        mode === 'order' ? 1 : 0,
        mode === 'header'
          ? new Blob([new Uint8Array(33)])
          : frame(mode === 'dimensions' ? 30 : 32, 24, 0),
      );
    });
    await expect(
      exportFFmpegBundle(fixture(), undefined, new AbortController().signal),
    ).rejects.toThrow();
  });
for (const mode of ['cancel', 'source', 'async-progress'])
  it('rejects late ' + mode + ' and permits a fresh retry', async () => {
    const c = new AbortController();
    let valid = true;
    await expect(
      exportFFmpegBundle(fixture(), undefined, c.signal, {
        validate: () => {
          if (!valid) throw Error('source changed');
        },
        progress: () => {
          if (mode === 'cancel') c.abort(Error('stopped'));
          else if (mode === 'source') valid = false;
          else return Promise.resolve() as never;
        },
      }),
    ).rejects.toThrow();
    const result = await exportFFmpegBundle(fixture(), undefined, new AbortController().signal);
    expect(result.manifest.video.frameCount).toBe(3);
  });
it('rejects asynchronous validation before capture', async () => {
  await expect(
    exportFFmpegBundle(fixture(), undefined, new AbortController().signal, {
      validate: () => Promise.resolve() as never,
    }),
  ).rejects.toThrow(/synchronous/);
  expect(deps.frames).not.toHaveBeenCalled();
});
it('times out an uncooperative audio load and ignores its late completion', async () => {
  let late: (b: Blob) => void = () => {};
  const load = vi.fn(() => new Promise<Blob>((resolve) => (late = resolve)));
  await expect(
    exportFFmpegBundle(fixture(true), load, new AbortController().signal, {
      includeAudio: true,
      timeoutMs: 20,
    }),
  ).rejects.toThrow(/timed out/);
  late(new Blob(['late']));
  expect(deps.frames).not.toHaveBeenCalled();
});
it('rechecks deadline after synchronous final admission callbacks', async () => {
  const now = Date.now();
  let n = 0;
  await expect(
    exportFFmpegBundle(fixture(), undefined, new AbortController().signal, {
      timeoutMs: 100,
      validate: () => {
        if (++n === 2) vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
      },
    }),
  ).rejects.toThrow(/timed out/);
  expect(deps.frames).not.toHaveBeenCalled();
});

for (const audio of [false, true])
  it('uses the exact ZIP entry capacity audio ' + audio, () => {
    const p = fixture();
    p.duration = audio ? 65531 : 65532;
    expect(ffmpegBundlePlan(p, undefined, 1, false, audio).video.frameCount).toBe(p.duration);
    p.duration++;
    expect(() => ffmpegBundlePlan(p, undefined, 1, false, audio)).toThrow(/entry limit/);
  });
it('rejects an infeasible image2 start number without rounding', () => {
  const p = fixture();
  p.duration = 2147483647;
  expect(
    ffmpegBundlePlan(p, { start: 2147483646, end: 2147483646 }, 1, false, false).video.firstNumber,
  ).toBe(2147483647);
  p.duration++;
  expect(() =>
    ffmpegBundlePlan(p, { start: 2147483647, end: 2147483647 }, 1, false, false),
  ).toThrow();
});
it('snapshots each raw option and range field once before asynchronous work', async () => {
  const p = fixture();
  let scales = 0,
    starts = 0,
    ends = 0;
  const range = {
    get start() {
      starts++;
      return 0;
    },
    get end() {
      ends++;
      return 2;
    },
  };
  await exportFFmpegBundle(p, undefined, new AbortController().signal, {
    get scale() {
      scales++;
      return 1;
    },
    range,
  });
  expect([scales, starts, ends]).toEqual([1, 1, 1]);
});
it('rechecks source after original option getters', async () => {
  const p = fixture();
  await expect(
    exportFFmpegBundle(p, undefined, new AbortController().signal, {
      get scale() {
        p.width = 64;
        return 1;
      },
      validate: () => {
        if (p.width !== 32) throw Error('getter source changed');
      },
    }),
  ).rejects.toThrow(/getter source changed/);
  expect(deps.frames).not.toHaveBeenCalled();
});
it('shared deadline ends an uncooperative frame delivery without a receipt', async () => {
  let scope: AbortSignal | undefined;
  deps.frames.mockImplementation(async (_p, _consume, signal) => {
    scope = signal;
    return new Promise(() => {});
  });
  await expect(
    exportFFmpegBundle(fixture(), undefined, new AbortController().signal, { timeoutMs: 20 }),
  ).rejects.toThrow(/timed out/);
  expect(scope?.aborted).toBe(true);
});

it('archives the admitted immutable PNG bytes without invoking caller Blob methods', async () => {
  const original = frame(32, 24, 0),
    expected = new Uint8Array(await original.arrayBuffer());
  const overridden = vi.fn(() => new Blob(['forged slice']));
  Object.defineProperty(original, 'slice', { value: overridden });
  deps.frames.mockImplementation(async (_p, consume) => {
    await consume(0, original);
  });
  const p = fixture();
  p.duration = 1;
  const result = await exportFFmpegBundle(p, undefined, new AbortController().signal);
  expect((await entries(result.blob)).get('frame-000001.png')).toEqual(expected);
  expect(overridden).not.toHaveBeenCalled();
});

for (const audio of [false, true])
  for (const selected of [false, true])
    it(`streams exact downloadable ZIP bytes with audio ${audio} selected ${selected}`, async () => {
      const p = fixture(audio),
        source = structuredClone(p),
        options = {
          includeAudio: audio,
          range: selected ? { start: 1, end: 2 } : undefined,
          remembered: selected,
        };
      const load = async () => new Blob(['wav']);
      const full = await exportFFmpegBundle(p, load, new AbortController().signal, options);
      const chunks: Uint8Array[] = [],
        abort = vi.fn(),
        finish = vi
          .spyOn((await import('../apps/editor/src/png-archive')).PNGArchive.prototype, 'finish')
          .mockImplementation(() => {
            throw Error('joined archive');
          });
      const sink: FFmpegBundleSink = {
        write(chunk, signal) {
          expect(this).toBe(sink);
          expect(signal.aborted).toBe(false);
          expect(chunk.length).toBeGreaterThan(0);
          expect(chunk.length).toBeLessThanOrEqual(65536);
          chunks.push(chunk.slice());
        },
        abort,
      };
      const result = await exportFFmpegBundleToSink(
        p,
        load,
        new AbortController().signal,
        sink,
        options,
      );
      expect(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer()).toEqual(
        await full.blob.arrayBuffer(),
      );
      expect(result.manifest).toEqual(full.manifest);
      expect(result.bytesWritten).toBe(full.blob.size);
      expect(result.chunkCount).toBe(chunks.length);
      expect('blob' in result).toBe(false);
      expect(finish).not.toHaveBeenCalled();
      expect(abort).not.toHaveBeenCalled();
      expect(p).toEqual(source);
    });
it('awaits bounded sequential writes and captures lengths before transferring chunks', async () => {
  const p = fixture();
  p.duration = 1;
  const large = new Blob([frame(32, 24, 0), new Uint8Array(200000)]);
  deps.frames.mockImplementation(async (_p, consume) => consume(0, large));
  let release: () => void = () => {},
    entered = false,
    active = 0,
    maximum = 0;
  const chunks: Uint8Array[] = [],
    sink: FFmpegBundleSink = {
      async write(chunk) {
        active++;
        maximum = Math.max(maximum, active);
        chunks.push(structuredClone(chunk, { transfer: [chunk.buffer] }));
        expect(chunk.byteLength).toBe(0);
        if (!entered) {
          entered = true;
          await new Promise<void>((r) => {
            release = r;
          });
        }
        active--;
      },
      abort: vi.fn(),
    };
  const job = exportFFmpegBundleToSink(p, undefined, new AbortController().signal, sink);
  await vi.waitFor(() => expect(entered).toBe(true));
  expect(chunks).toHaveLength(1);
  await new Promise((r) => setTimeout(r, 5));
  expect(chunks).toHaveLength(1);
  release();
  const result = await job;
  expect(maximum).toBe(1);
  expect(Math.max(...chunks.map((c) => c.length))).toBe(65536);
  expect(result.bytesWritten).toBe(chunks.reduce((n, c) => n + c.length, 0));
  expect(
    (await entries(new Blob(chunks as Uint8Array<ArrayBuffer>[]))).get('frame-000001.png'),
  ).toEqual(new Uint8Array(await large.arrayBuffer()));
});
it('streams the exact byte capacity and aborts one byte below it', async () => {
  const p = fixture(),
    full = await exportFFmpegBundle(p, undefined, new AbortController().signal);
  const good = { write: vi.fn(), abort: vi.fn() },
    bad = { write: vi.fn(), abort: vi.fn() };
  expect(
    (
      await exportFFmpegBundleToSink(p, undefined, new AbortController().signal, good, {
        maxBytes: full.blob.size,
      })
    ).bytesWritten,
  ).toBe(full.blob.size);
  await expect(
    exportFFmpegBundleToSink(p, undefined, new AbortController().signal, bad, {
      maxBytes: full.blob.size - 1,
    }),
  ).rejects.toThrow(/limit/);
  expect(bad.abort).toHaveBeenCalledOnce();
  expect(good.abort).not.toHaveBeenCalled();
});
for (const mode of [
  'preabort',
  'numeric',
  'options',
  'no audio',
  'source',
  'async validation',
  'write getter',
])
  it('aborts provisional storage before output on ' + mode, async () => {
    const p = fixture(),
      c = new AbortController(),
      write = vi.fn(),
      abort = vi.fn(),
      sink = { write, abort },
      options: FFmpegBundleOptions = {};
    if (mode === 'preabort') c.abort(Error('preabort'));
    if (mode === 'numeric') p.width = NaN;
    if (mode === 'options') options.scale = NaN;
    if (mode === 'no audio') options.includeAudio = true;
    if (mode === 'source')
      options.validate = () => {
        throw Error('source');
      };
    if (mode === 'async validation') options.validate = async () => {};
    if (mode === 'write getter')
      Object.defineProperty(sink, 'write', {
        get() {
          throw Error('write getter');
        },
      });
    await expect(
      exportFFmpegBundleToSink(p, async () => new Blob([]), c.signal, sink, options),
    ).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
  });
it('snapshots original sink methods before options and asynchronous asset reads', async () => {
  const p = fixture(true),
    write = vi.fn(),
    abort = vi.fn(),
    sink: FFmpegBundleSink = { write, abort };
  let release: (b: Blob) => void = () => {};
  const job = exportFFmpegBundleToSink(
    p,
    () =>
      new Promise<Blob>((r) => {
        release = r;
      }),
    new AbortController().signal,
    sink,
    {
      includeAudio: true,
      get scale() {
        sink.write = () => {
          throw Error('replaced write');
        };
        sink.abort = () => {
          throw Error('replaced abort');
        };
        return 1;
      },
    },
  );
  release(new Blob(['wav']));
  await job;
  expect(write).toHaveBeenCalled();
  expect(abort).not.toHaveBeenCalled();
});
for (const mode of ['source', 'cancel', 'throw'])
  it('rejects ' + mode + ' at a real awaited write boundary', async () => {
    const c = new AbortController(),
      abort = vi.fn();
    let valid = true;
    const chunks: Uint8Array[] = [];
    await expect(
      exportFFmpegBundleToSink(
        fixture(),
        undefined,
        c.signal,
        {
          async write(chunk, signal) {
            chunks.push(chunk.slice());
            await Promise.resolve();
            if (mode === 'source') valid = false;
            if (mode === 'cancel') c.abort(Error('cancel'));
            if (mode === 'throw') throw Error('write rejected');
            expect(signal.aborted).toBe(mode === 'cancel');
          },
          abort,
        },
        {
          validate: () => {
            if (!valid) throw Error('source');
          },
        },
      ),
    ).rejects.toThrow();
    expect(chunks).toHaveLength(1);
    expect(abort).toHaveBeenCalledOnce();
  });
it('awaits captured abort and retains both delivery and cleanup errors', async () => {
  const writeError = Error('write failed'),
    cleanupError = Error('cleanup failed');
  let release: () => void = () => {},
    done = false;
  const abort = vi.fn(
    () =>
      new Promise<void>((_r, reject) => {
        release = () => reject(cleanupError);
      }),
  );
  const outcome = exportFFmpegBundleToSink(fixture(), undefined, new AbortController().signal, {
    write() {
      throw writeError;
    },
    abort,
  }).catch((e) => {
    done = true;
    return e;
  });
  await vi.waitFor(() => expect(abort).toHaveBeenCalledOnce());
  expect(done).toBe(false);
  release();
  const result = await outcome;
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toEqual([writeError, cleanupError]);
});
it('ends a stalled sink write at the shared deadline and rejects its late completion', async () => {
  let release: () => void = () => {},
    scope: AbortSignal | undefined;
  const abort = vi.fn();
  const result = exportFFmpegBundleToSink(
    fixture(),
    undefined,
    new AbortController().signal,
    {
      write(_chunk, signal) {
        scope = signal;
        return new Promise<void>((r) => {
          release = r;
        });
      },
      abort,
    },
    { timeoutMs: 40 },
  );
  await expect(result).rejects.toThrow(/timed out/);
  expect(scope?.aborted).toBe(true);
  expect(abort).toHaveBeenCalledOnce();
  release();
});
it('checks source after the final ZIP directory write before returning a receipt', async () => {
  let valid = true;
  const abort = vi.fn();
  await expect(
    exportFFmpegBundleToSink(
      fixture(),
      undefined,
      new AbortController().signal,
      {
        write(chunk) {
          if (
            new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(0, true) ===
            0x02014b50
          )
            valid = false;
        },
        abort,
      },
      {
        validate() {
          if (!valid) throw Error('final source');
        },
      },
    ),
  ).rejects.toThrow(/final source/);
  expect(abort).toHaveBeenCalledOnce();
});

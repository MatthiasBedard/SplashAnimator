import { afterEach, expect, it, vi } from 'vitest';
import { openAvcEncoder } from '../packages/export-video/src/avc-encoder';
import {
  readPreparedAvcDescription,
  readPreparedAvcSample,
} from '../packages/export-video/src/avc-samples';
import { prepareAvcMp4 } from '../packages/export-video/src/mp4-avc';
import * as captures from '../packages/export-video/src/avc-samples';
const settings = {
  width: 2,
  height: 2,
  frameCount: 3,
  rate: 30000,
  scale: 1001,
  bitrate: 100000,
  keyFrameInterval: 2,
};
const config = () =>
  new Uint8Array([
    1, 66, 0xe0, 31, 0xff, 0xe1, 0, 5, 0x67, 66, 0xe0, 31, 0x80, 1, 0, 2, 0x68, 0x80,
  ]);
class Frame {
  static seen: Frame[] = [];
  static closed = 0;
  bytes: Uint8Array;
  constructor(
    data: Uint8Array,
    public init: VideoFrameBufferInit,
  ) {
    this.bytes = data.slice();
    Frame.seen.push(this);
  }
  close() {
    Frame.closed++;
  }
}
class Encoder {
  static seen: Encoder[] = [];
  static bad = '';
  static stall = false;
  static supported = true;
  static copyHook: (() => void) | undefined;
  static supportHook: (() => Promise<void>) | undefined;
  static async isConfigSupported(c: VideoEncoderConfig) {
    await Encoder.supportHook?.();
    return { supported: Encoder.supported, config: c };
  }
  state = 'configured';
  pending: { frame: Frame; key: boolean }[] = [];
  config?: VideoEncoderConfig;
  constructor(public init: VideoEncoderInit) {
    Encoder.seen.push(this);
    if (Encoder.bad === 'constructor') init.error(new DOMException('constructor'));
  }
  configure(config: VideoEncoderConfig) {
    this.config = config;
    if (Encoder.bad === 'configure') throw Error('configure');
  }
  encode(frame: Frame, options: VideoEncoderEncodeOptions) {
    this.pending.push({ frame, key: !!options.keyFrame });
  }
  async flush() {
    if (Encoder.stall) return new Promise<void>(() => {});
    await Promise.resolve();
    for (const { frame, key } of this.pending.splice(0)) {
      if (Encoder.bad === 'omit') continue;
      const bytes = new Uint8Array([0, 0, 0, 2, key ? 0x65 : 0x41, 0xaa]);
      const chunk = {
        timestamp: frame.init.timestamp + (Encoder.bad === 'order' ? 1 : 0),
        duration: Encoder.bad === 'duration' ? 1 : frame.init.duration,
        type: Encoder.bad === 'key' ? 'delta' : key ? 'key' : 'delta',
        byteLength: Encoder.bad === 'budget' ? 129 * 1024 * 1024 : bytes.length,
        copyTo: (destination: Uint8Array) => {
          destination.set(bytes);
          Encoder.copyHook?.();
          if (Encoder.bad === 'copy') throw Error('copy');
          if (Encoder.bad === 'reentry') this.init.output({} as EncodedVideoChunk, {});
        },
      } as EncodedVideoChunk;
      const description = config();
      if (Encoder.bad === 'malformed') description[0] = 0;
      if (Encoder.bad === 'lower') {
        description[2] = description[10] = 0xc0;
        description[3] = description[11] = 20;
      }
      if (Encoder.bad === 'higher') description[3] = description[11] = 32;
      if (Encoder.bad === 'changed' && Frame.seen.indexOf(frame)) description[12]++;
      const dc = {
        codec: Encoder.bad === 'codec' ? 'vp8' : 'avc1.42e01f',
        codedWidth: Encoder.bad === 'dimensions' ? 3 : 2,
        codedHeight: 2,
        description,
      };
      this.init.output(chunk, Encoder.bad === 'missing' ? {} : { decoderConfig: dc });
      if (Encoder.bad === 'extra') this.init.output(chunk, {});
    }
  }
  close() {
    this.state = 'closed';
  }
}
function setup() {
  Encoder.seen = [];
  Encoder.bad = '';
  Encoder.stall = false;
  Encoder.supported = true;
  Encoder.copyHook = undefined;
  Encoder.supportHook = undefined;
  Frame.seen = [];
  Frame.closed = 0;
  vi.stubGlobal('VideoEncoder', Encoder);
  vi.stubGlobal('VideoFrame', Frame);
}
const rgba = () => new Uint8Array(16).fill(255);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('captures dependencies/settings before support work, detaches input and returns only complete owned AVC/MP4', async () => {
  setup();
  let release!: () => void;
  Encoder.supportHook = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const s = { ...settings },
    o = { maxBytes: 10000 },
    pending = openAvcEncoder(s, o);
  s.rate = 1;
  o.maxBytes = 1;
  vi.stubGlobal('VideoEncoder', undefined);
  vi.stubGlobal('VideoFrame', undefined);
  release();
  const host = await pending,
    input = rgba(),
    job = host.append(input);
  input.fill(0);
  await job;
  expect(Frame.seen[0].bytes).toEqual(rgba());
  expect(() => host.finish()).toThrow(/incomplete/);
  await host.append(rgba());
  await host.append(rgba());
  const capture = host.finish();
  expect(capture.metadata()).toMatchObject({ rate: 30000, frameCount: 3, codec: 'avc1.42e01f' });
  expect(readPreparedAvcDescription(capture)).toEqual(config());
  expect(readPreparedAvcSample(capture, 1)).toMatchObject({
    keyFrame: false,
    timestampUs: 33367,
    durationUs: 33366,
  });
  expect(readPreparedAvcSample(capture, 2).keyFrame).toBe(true);
  expect(prepareAvcMp4(capture).metadata().frameCount).toBe(3);
  expect(Frame.closed).toBe(3);
  expect(Encoder.seen[0].state).toBe('closed');
  expect(Encoder.seen[0].config).toMatchObject({
    codec: 'avc1.42e01f',
    avc: { format: 'avc' },
    latencyMode: 'realtime',
  });
  expect(() => host.finish()).toThrow(/closed/);
});
for (const bad of [
  'order',
  'duration',
  'key',
  'codec',
  'dimensions',
  'missing',
  'budget',
  'copy',
  'reentry',
  'extra',
  'omit',
])
  it('rejects native ' + bad + ' without partial capture and closes resources', async () => {
    setup();
    const host = await openAvcEncoder(settings);
    Encoder.bad = bad;
    await expect(host.append(rgba())).rejects.toThrow();
    expect(() => host.finish()).toThrow();
    expect(Encoder.seen[0].state).toBe('closed');
    expect(Frame.closed).toBe(1);
  });
it.each(['malformed', 'changed'] as const)(
  'rejects %s original decoder data without publishing a capture',
  async (bad) => {
    setup();
    const host = await openAvcEncoder(settings);
    Encoder.bad = bad;
    if (bad === 'changed') {
      await host.append(rgba());
      await expect(host.append(rgba())).rejects.toThrow(/changed/);
    } else {
      for (let i = 0; i < 3; i++) await host.append(rgba());
      expect(() => host.finish()).toThrow(/configuration/);
    }
    expect(Encoder.seen[0].state).toBe('closed');
  },
);
it.each(['constructor', 'configure'] as const)('cleans %s failures at open', async (bad) => {
  setup();
  Encoder.bad = bad;
  await expect(openAvcEncoder(settings)).rejects.toThrow(bad);
  expect(Encoder.seen[0].state).toBe('closed');
});
it('rejects unsupported/missing dependencies and validates before allocation', async () => {
  setup();
  Encoder.supported = false;
  await expect(openAvcEncoder(settings)).rejects.toThrow(/unsupported/);
  expect(Encoder.seen).toHaveLength(0);
  vi.stubGlobal('VideoEncoder', undefined);
  await expect(openAvcEncoder(settings)).rejects.toThrow(/unavailable/);
});
for (const bad of [
  { width: 0 },
  { height: NaN },
  { frameCount: 10002 },
  { rate: Infinity },
  { scale: 0 },
  { bitrate: 0 },
  { keyFrameInterval: 301 },
  { width: 65535, height: 65535 },
])
  it('rejects original numeric settings ' + JSON.stringify(bad), async () => {
    setup();
    await expect(openAvcEncoder({ ...settings, ...bad })).rejects.toThrow();
    expect(Encoder.seen).toHaveLength(0);
  });
it('invalid shared/short/transparent input does not consume a valid frame', async () => {
  setup();
  const host = await openAvcEncoder({ ...settings, frameCount: 1 });
  for (const input of [
    new Uint8Array(4),
    new Uint8Array(16),
    new Uint8Array(new SharedArrayBuffer(16)),
  ])
    await expect(host.append(input)).rejects.toThrow();
  expect(Frame.seen).toHaveLength(0);
  await host.append(rgba());
  expect(host.finish().metadata().frameCount).toBe(1);
});
it('checks source before/after support, native copies and complete capture preparation', async () => {
  setup();
  let changed = false;
  Encoder.supportHook = async () => {
    changed = true;
  };
  await expect(
    openAvcEncoder(settings, {
      validate() {
        if (changed) throw Error('source changed');
      },
    }),
  ).rejects.toThrow(/source/);
  expect(Encoder.seen).toHaveLength(0);
  Encoder.supportHook = undefined;
  changed = false;
  const host = await openAvcEncoder(settings, {
    validate() {
      if (changed) throw Error('source changed');
    },
  });
  Encoder.copyHook = () => {
    changed = true;
  };
  await expect(host.append(rgba())).rejects.toThrow(/source/);
  expect(Encoder.seen[0].state).toBe('closed');
});
it('cancels support/flush and ignores late output, disposing idempotently', async () => {
  setup();
  Encoder.supportHook = () => new Promise<void>(() => {});
  const c = new AbortController(),
    opening = openAvcEncoder(settings, { signal: c.signal });
  c.abort(Error('cancel support'));
  await expect(opening).rejects.toThrow('cancel support');
  expect(Encoder.seen).toHaveLength(0);
  Encoder.supportHook = undefined;
  Encoder.stall = true;
  const controller = new AbortController(),
    host = await openAvcEncoder(settings, { signal: controller.signal }),
    job = host.append(rgba());
  controller.abort(Error('cancel flush'));
  await expect(job).rejects.toThrow('cancel flush');
  expect(() => Encoder.seen[0].init.output({} as EncodedVideoChunk, {})).not.toThrow();
  host.dispose();
  host.dispose();
});
it('uses one deadline through support/flush and cleans timers on success/failure', async () => {
  setup();
  vi.useFakeTimers();
  Encoder.stall = true;
  const host = await openAvcEncoder(settings, { timeoutMs: 5 }),
    job = host.append(rgba()),
    rejected = expect(job).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(5);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
  Encoder.stall = false;
  const next = await openAvcEncoder({ ...settings, frameCount: 1 });
  await next.append(rgba());
  next.finish();
  expect(vi.getTimerCount()).toBe(0);
});
it('retains source ownership on finished captures and rejects async/reentrant validation', async () => {
  setup();
  await expect(
    openAvcEncoder(settings, { validate: (() => Promise.resolve()) as never }),
  ).rejects.toThrow(/synchronous/);
  let changed = false,
    reenter = false;
  const host = await openAvcEncoder(
    { ...settings, frameCount: 1 },
    {
      validate() {
        if (changed) throw Error('source');
        if (reenter)
          try {
            host.finish();
          } catch {}
      },
    },
  );
  await host.append(rgba());
  reenter = true;
  expect(() => host.finish()).toThrow(/reentered/);
  reenter = false;
  const second = await openAvcEncoder(
    { ...settings, frameCount: 1 },
    {
      validate() {
        if (changed) throw Error('source');
      },
    },
  );
  await second.append(rgba());
  const capture = second.finish();
  changed = true;
  expect(() => capture.metadata()).toThrow(/source/);
});
it('uses original lower-level Baseline record identity and rejects levels above the requested ceiling', async () => {
  setup();
  Encoder.bad = 'lower';
  const host = await openAvcEncoder({ ...settings, frameCount: 1 });
  await host.append(rgba());
  expect(host.finish().metadata().codec).toBe('avc1.42c014');
  Encoder.bad = 'higher';
  const higher = await openAvcEncoder({ ...settings, frameCount: 1 });
  await higher.append(rgba());
  expect(() => higher.finish()).toThrow(/identity/);
  expect(Encoder.seen.at(-1)!.state).toBe('closed');
});
it('enforces exact configuration/payload budget and preserves recovery before native submission', async () => {
  setup();
  const s = { ...settings, frameCount: 1 },
    exact = 1280 + config().length + 6;
  const small = await openAvcEncoder(s, { maxBytes: exact - 1 });
  await expect(small.append(rgba())).rejects.toThrow(/budget/);
  const host = await openAvcEncoder(s, { maxBytes: exact });
  await host.append(rgba());
  expect(host.finish().metadata().reservedByteLength).toBe(exact);
});
it('concurrent input cannot publish a capture from a pending native flush', async () => {
  setup();
  Encoder.stall = true;
  const host = await openAvcEncoder(settings),
    job = host.append(rgba());
  const rejected = expect(job).rejects.toThrow(/pending/);
  await expect(host.append(rgba())).rejects.toThrow(/pending/);
  await rejected;
  expect(() => host.finish()).toThrow();
  expect(Encoder.seen[0].state).toBe('closed');
});
it('rechecks source after a complete detached encoded capture exists', async () => {
  setup();
  let changed = false;
  const host = await openAvcEncoder(
    { ...settings, frameCount: 1 },
    {
      validate() {
        if (changed) throw Error('late source');
      },
    },
  );
  await host.append(rgba());
  const original = captures.prepareAvcSamples;
  let fired = false;
  vi.spyOn(captures, 'prepareAvcSamples').mockImplementation((...args) => {
    const complete = original(...args);
    expect(complete.metadata().frameCount).toBe(1);
    fired = true;
    changed = true;
    return complete;
  });
  expect(() => host.finish()).toThrow(/source/);
  expect(fired).toBe(true);
  expect(Encoder.seen[0].state).toBe('closed');
});

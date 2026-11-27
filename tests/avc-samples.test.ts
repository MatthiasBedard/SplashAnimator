import { afterEach, expect, it, vi } from 'vitest';
import {
  prepareAvcSamples,
  readPreparedAvcDescription as description,
  readPreparedAvcSample as sample,
  type AvcEncodedSample,
} from '../packages/export-video/src/avc-samples';
const settings = { width: 16, height: 12, frameCount: 3, rate: 30000, scale: 1001 };
const config = () =>
  new Uint8Array([
    1, 66, 0xe0, 30, 0xff, 0xe1, 0, 5, 0x67, 66, 0xe0, 30, 0x80, 1, 0, 2, 0x68, 0x80,
  ]);
function packets(n = 3, size = 4): AvcEncodedSample[] {
  return Array.from({ length: n }, (_, i) => {
    const bytes = new Uint8Array(size + 2);
    bytes[size - 1] = 2;
    bytes[size] = i ? 0x41 : 0x65;
    bytes[size + 1] = 0xaa;
    return { bytes, keyFrame: i === 0 };
  });
}
afterEach(() => vi.restoreAllMocks());
it('captures detached configuration and every opaque sample with independently computed exact rational timing', () => {
  const s = { ...settings },
    c = config(),
    p = packets(),
    original = p.map((p) => p.bytes.slice()),
    plan = prepareAvcSamples(s, c, p);
  s.rate = 1;
  c.fill(0);
  p[0].bytes.fill(0);
  p.length = 0;
  const metadata = plan.metadata();
  expect(metadata).toMatchObject({
    ...settings,
    codec: 'avc1.42e01e',
    nalLengthSize: 4,
    timescale: 30000,
    durationTicks: 3003,
    sampleDurationTicks: 1001,
    descriptionBytes: 18,
    packetBytes: 18,
    reservedByteLength: 1828,
  });
  metadata.rate = 1;
  expect(plan.metadata().rate).toBe(30000);
  for (let i = 0; i < 3; i++) {
    const value = sample(plan, i);
    expect(value.bytes).toEqual(original[i]);
    expect(value).toMatchObject({
      keyFrame: i === 0,
      decodeTimeTicks: i * 1001,
      durationTicks: 1001,
      compositionOffsetTicks: 0,
      timestampUs: Math.round(((i * 1001) / 30000) * 1e6),
      durationUs:
        Math.round((((i + 1) * 1001) / 30000) * 1e6) - Math.round(((i * 1001) / 30000) * 1e6),
    });
    value.bytes.fill(0);
    expect(sample(plan, i).bytes).toEqual(original[i]);
  }
  const d = description(plan);
  d.fill(0);
  expect(description(plan)).toEqual(config());
  plan.dispose();
  expect(() => plan.metadata()).toThrow(/disposed/);
  expect(() => sample(plan, 0)).toThrow(/disposed/);
});
it.each([1, 2, 4] as const)(
  'supports %s-byte AVC lengths and multiple NAL units without changing packet bytes',
  (size) => {
    const c = config();
    c[4] = 0xfc + (size - 1);
    const p = packets(3, size);
    p[1].bytes = new Uint8Array([...p[1].bytes, ...p[1].bytes]);
    const plan = prepareAvcSamples(settings, c, p);
    expect(plan.metadata().nalLengthSize).toBe(size);
    expect(sample(plan, 1).bytes).toEqual(p[1].bytes);
  },
);
it.each([
  { width: NaN },
  { height: Infinity },
  { width: 0 },
  { height: 65536 },
  { frameCount: 0 },
  { frameCount: 10002 },
  { rate: 0 },
  { scale: 0 },
  { rate: 4294967296 },
  { rate: 1, scale: 2 },
  { rate: 241, scale: 1 },
  { frameCount: 1.5 },
])('rejects original numeric settings %j', (bad) =>
  expect(() => prepareAvcSamples({ ...settings, ...bad }, config(), packets())).toThrow(),
);
it.each([
  'version',
  'profile',
  'length-reserved',
  'three-byte',
  'sps-reserved',
  'no-sps',
  'sps-size',
  'sps-type',
  'sps-identity',
  'no-pps',
  'pps-size',
  'pps-type',
  'trailing',
  'truncated',
] as const)('rejects malformed/unsupported original configuration %s', (fault) => {
  let c = config();
  if (fault === 'version') c[0] = 0;
  if (fault === 'profile') c[1] = 100;
  if (fault === 'length-reserved') c[4] = 3;
  if (fault === 'three-byte') c[4] = 0xfe;
  if (fault === 'sps-reserved') c[5] = 1;
  if (fault === 'no-sps') c[5] = 0xe0;
  if (fault === 'sps-size') c[7] = 0xff;
  if (fault === 'sps-type') c[8] = 0x68;
  if (fault === 'sps-identity') c[9] = 77;
  if (fault === 'no-pps') c[13] = 0;
  if (fault === 'pps-size') c[15] = 0xff;
  if (fault === 'pps-type') c[16] = 0x67;
  if (fault === 'trailing') c = new Uint8Array([...c, 0]);
  if (fault === 'truncated') c = c.slice(0, 16);
  expect(() => prepareAvcSamples(settings, c, packets())).toThrow();
});
it.each([
  'missing',
  'empty',
  'truncated',
  'zero',
  'overrun',
  'forbidden',
  'type-zero',
  'first-delta',
  'flag',
  'timestamp',
] as const)('rejects late %s sample without returning any partial capture', (fault) => {
  const p = packets();
  if (fault === 'missing') p[2] = undefined as never;
  if (fault === 'empty') p[2].bytes = new Uint8Array();
  if (fault === 'truncated') p[2].bytes = new Uint8Array([0, 0, 0]);
  if (fault === 'zero') p[2].bytes = new Uint8Array([0, 0, 0, 0]);
  if (fault === 'overrun') p[2].bytes[3] = 3;
  if (fault === 'forbidden') p[2].bytes[4] = 0x80;
  if (fault === 'type-zero') p[2].bytes[4] = 0;
  if (fault === 'first-delta') p[0].keyFrame = false;
  if (fault === 'flag') p[2].keyFrame = 1 as never;
  if (fault === 'timestamp') Reflect.set(p[2], 'compositionOffsetTicks', 1);
  expect(() => prepareAvcSamples(settings, config(), p)).toThrow();
  expect(prepareAvcSamples(settings, config(), packets()).metadata().frameCount).toBe(3);
});
it('shares the original 128MiB ceiling and admits exactly the counted reservation boundary', () => {
  const minimum = 1024 + 256 * 3 + 18 + 18;
  expect(() => prepareAvcSamples(settings, config(), packets(), { maxBytes: minimum - 1 })).toThrow(
    /budget/,
  );
  expect(
    prepareAvcSamples(settings, config(), packets(), { maxBytes: minimum }).metadata()
      .reservedByteLength,
  ).toBe(minimum);
  for (const maxBytes of [0, NaN, Infinity, 128 * 1024 * 1024 + 1])
    expect(() => prepareAvcSamples(settings, config(), packets(), { maxBytes })).toThrow();
});
it('retains all10001samples and exact final timestamp/duration without a lower frame cap', () => {
  const p = packets(10001),
    plan = prepareAvcSamples({ ...settings, frameCount: 10001 }, config(), p);
  expect(plan.metadata().frameCount).toBe(10001);
  expect(sample(plan, 10000)).toMatchObject({
    decodeTimeTicks: 10010000,
    timestampUs: 333666667,
    durationUs: 33366,
  });
  expect(sample(plan, 10000).bytes).toEqual(p[10000].bytes);
});
it('uses actual typed-array storage rather than subclass getters/slice and preserves view offsets', () => {
  class Hostile extends Uint8Array {
    override get byteLength(): number {
      throw Error('getter');
    }
    override get buffer(): ArrayBuffer {
      throw Error('getter');
    }
    override slice(): Uint8Array<ArrayBuffer> {
      throw Error('slice');
    }
  }
  const c = new Hostile(config()),
    p = packets().map((v) => ({ ...v, bytes: new Hostile(v.bytes) }));
  expect(prepareAvcSamples(settings, c, p).metadata().descriptionBytes).toBe(18);
  const bytes = new Uint8Array([255, ...packets()[0].bytes, 255]);
  p[0].bytes = new Uint8Array(bytes.buffer, 1, 6);
  expect(sample(prepareAvcSamples(settings, c, p), 0).bytes).toEqual(packets()[0].bytes);
});
it('rejects shared/detached storage, incomplete arrays and copied/serialized capabilities', () => {
  const p = packets();
  p[2].bytes = new Uint8Array(new SharedArrayBuffer(6));
  expect(() => prepareAvcSamples(settings, config(), p)).toThrow();
  const c = config();
  structuredClone(c, { transfer: [c.buffer] });
  expect(() => prepareAvcSamples(settings, c, packets())).toThrow();
  expect(() => prepareAvcSamples(settings, config(), packets(2))).toThrow();
  const plan = prepareAvcSamples(settings, config(), packets());
  for (const copy of [{ ...plan }, plan.metadata(), JSON.parse(JSON.stringify(plan))]) {
    expect(() => sample(copy, 0)).toThrow();
    expect(() => description(copy)).toThrow();
  }
});
it('snapshots getters/settings/options once before source validation callbacks can replace input', () => {
  let reads = 0;
  const c = config(),
    p = packets(),
    options = {
      get maxBytes() {
        reads++;
        return 10000;
      },
      validate() {
        c.fill(0);
        p.length = 0;
      },
    };
  const plan = prepareAvcSamples(settings, c, p, options);
  expect(reads).toBe(1);
  expect(description(plan)).toEqual(config());
  expect(sample(plan, 2).bytes).toEqual(packets()[2].bytes);
});
it.each(['source', 'async', 'reentry', 'growth'] as const)(
  'rejects %s capture admission atomically',
  (fault) => {
    const p = packets();
    let captured = false;
    const validate =
      fault === 'source'
        ? () => {
            throw Error('source changed');
          }
        : fault === 'async'
          ? async () => {
              throw Error('async source');
            }
          : fault === 'reentry'
            ? () => {
                try {
                  prepareAvcSamples(settings, config(), packets());
                } catch {}
              }
            : () => {};
    if (fault === 'growth')
      Object.defineProperty(p[2], 'keyFrame', {
        get() {
          p.push(packets()[0]);
          return false;
        },
      });
    try {
      prepareAvcSamples(settings, config(), p, { validate });
      captured = true;
    } catch {}
    expect(captured).toBe(false);
    expect(prepareAvcSamples(settings, config(), packets()).metadata().frameCount).toBe(3);
  },
);
it('rejects invalid indices and cancelled/reentrant access without consuming a valid prepared capture', () => {
  let changed = false,
    reenter = false;
  const plan: ReturnType<typeof prepareAvcSamples> = prepareAvcSamples(
    settings,
    config(),
    packets(),
    {
      validate() {
        if (changed) throw Error('source changed');
        if (reenter)
          try {
            sample(plan, 0);
          } catch {}
      },
    },
  );
  for (const i of [-1, 0.5, 3, NaN, Infinity]) expect(() => sample(plan, i)).toThrow();
  const controller = new AbortController();
  controller.abort();
  expect(() => sample(plan, 0, controller.signal)).toThrow();
  expect(() => description(plan, controller.signal)).toThrow();
  expect(sample(plan, 0).bytes).toEqual(packets()[0].bytes);
  changed = true;
  expect(() => sample(plan, 0)).toThrow('source changed');
  changed = false;
  reenter = true;
  expect(() => sample(plan, 0)).toThrow(/reentered/);
  reenter = false;
  expect(sample(plan, 0).bytes).toEqual(packets()[0].bytes);
});
it('rejects cancellation while privately copying without returning bytes or disposing prepared storage', () => {
  const controller = new AbortController();
  let armed = false;
  const plan = prepareAvcSamples(settings, config(), packets(), {
    validate() {
      if (armed) controller.abort();
    },
  });
  armed = true;
  expect(() => sample(plan, 0, controller.signal)).toThrow();
  armed = false;
  expect(sample(plan, 0).bytes).toEqual(packets()[0].bytes);
});

it('snapshots original raw setting getters once and rejects swallowed reentry from a later sample getter', () => {
  let reads = 0;
  const input = {
      ...settings,
      get frameCount() {
        reads++;
        return 3;
      },
    },
    p = packets();
  Object.defineProperty(p[2], 'bytes', {
    get() {
      try {
        prepareAvcSamples(settings, config(), packets());
      } catch {}
      return packets()[2].bytes;
    },
  });
  expect(() => prepareAvcSamples(input, config(), p)).toThrow(/reentered/);
  expect(reads).toBe(1);
  expect(prepareAvcSamples(settings, config(), packets()).metadata().frameCount).toBe(3);
});

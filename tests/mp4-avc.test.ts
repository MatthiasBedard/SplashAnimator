import { afterEach, expect, it, vi } from 'vitest';
import * as avc from '../packages/export-video/src/avc-samples';
import { prepareAvcMp4 } from '../packages/export-video/src/mp4-avc';
const settings = { width: 16, height: 12, frameCount: 3, rate: 30000, scale: 1001 };
const configuration = () =>
  new Uint8Array([
    1, 66, 0xe0, 30, 0xff, 0xe1, 0, 5, 0x67, 66, 0xe0, 30, 0x80, 1, 0, 2, 0x68, 0x80,
  ]);
const packets = (n = 3, size = 4) =>
  Array.from({ length: n }, (_, i) => {
    const bytes = new Uint8Array(size + 2);
    bytes[size - 1] = 2;
    bytes[size] = i ? 0x41 : 0x65;
    bytes[size + 1] = 0xaa;
    return { bytes, keyFrame: i === 0 };
  });
function capture(options: Parameters<typeof avc.prepareAvcSamples>[3] = {}) {
  return avc.prepareAvcSamples(settings, configuration(), packets(), options);
}
interface Box {
  type: string;
  start: number;
  data: number;
  end: number;
  size: number;
}
function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    result: Box[] = [];
  let at = start;
  while (at < end) {
    expect(at + 8).toBeLessThanOrEqual(end);
    const size = view.getUint32(at);
    expect(size).toBeGreaterThanOrEqual(8);
    expect(at + size).toBeLessThanOrEqual(end);
    result.push({
      start: at,
      data: at + 8,
      end: at + size,
      size,
      type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
    });
    at += size;
  }
  expect(at).toBe(end);
  return result;
}
const child = (bytes: Uint8Array, parent: Box, type: string, skip = 0) => {
  const found = boxes(bytes, parent.data + skip, parent.end).filter((b) => b.type === type);
  expect(found).toHaveLength(1);
  return found[0];
};
const u32 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
const u16 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(at);
const u64 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(at);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('writes independent initialization box, exact original AVC data and empty fragmented sample-table oracles', () => {
  const source = capture(),
    prepared = prepareAvcMp4(source),
    bytes = prepared.bytes(),
    top = boxes(bytes);
  expect(top.map((b) => b.type)).toEqual([
    'ftyp',
    'moov',
    'moof',
    'mdat',
    'moof',
    'mdat',
    'moof',
    'mdat',
  ]);
  expect(new TextDecoder().decode(bytes.subarray(top[0].data, top[0].data + 4))).toBe('iso6');
  const moov = top[1],
    mvhd = child(bytes, moov, 'mvhd'),
    trak = child(bytes, moov, 'trak'),
    tkhd = child(bytes, trak, 'tkhd'),
    mdia = child(bytes, trak, 'mdia'),
    mdhd = child(bytes, mdia, 'mdhd'),
    hdlr = child(bytes, mdia, 'hdlr'),
    minf = child(bytes, mdia, 'minf'),
    stbl = child(bytes, minf, 'stbl');
  expect(mvhd.size).toBe(120);
  expect(bytes[mvhd.data]).toBe(1);
  expect(u32(bytes, mvhd.data + 20)).toBe(30000);
  expect(u64(bytes, mvhd.data + 24)).toBe(3003n);
  expect(tkhd.size).toBe(104);
  expect(u32(bytes, tkhd.data) & 0xffffff).toBe(7);
  expect(u32(bytes, tkhd.data + 20)).toBe(1);
  expect(u64(bytes, tkhd.data + 28)).toBe(3003n);
  expect(u32(bytes, tkhd.data + 88)).toBe(16 * 65536);
  expect(u32(bytes, tkhd.data + 92)).toBe(12 * 65536);
  expect(u32(bytes, tkhd.data + 52)).toBe(65536);
  expect(u32(bytes, tkhd.data + 84)).toBe(0x40000000);
  expect(bytes[mdhd.data]).toBe(1);
  expect(u32(bytes, mdhd.data + 20)).toBe(30000);
  expect(u64(bytes, mdhd.data + 24)).toBe(3003n);
  expect(u16(bytes, mdhd.data + 32)).toBe(0x55c4);
  expect(new TextDecoder().decode(bytes.subarray(hdlr.data + 8, hdlr.data + 12))).toBe('vide');
  for (const type of ['stts', 'stsc', 'stco'])
    expect(u32(bytes, child(bytes, stbl, type).data + 4)).toBe(0);
  const stsz = child(bytes, stbl, 'stsz');
  expect(u32(bytes, stsz.data + 4)).toBe(0);
  expect(u32(bytes, stsz.data + 8)).toBe(0);
  const stsd = child(bytes, stbl, 'stsd');
  expect(u32(bytes, stsd.data + 4)).toBe(1);
  const entry = child(bytes, stsd, 'avc1', 8);
  expect(u16(bytes, entry.data + 24)).toBe(16);
  expect(u16(bytes, entry.data + 26)).toBe(12);
  const config = child(bytes, entry, 'avcC', 78);
  expect(bytes.slice(config.data, config.end)).toEqual(configuration());
  const trex = child(bytes, child(bytes, moov, 'mvex'), 'trex');
  expect(u32(bytes, trex.data + 4)).toBe(1);
  expect(u32(bytes, trex.data + 8)).toBe(1);
  const url = child(bytes, child(bytes, child(bytes, minf, 'dinf'), 'dref'), 'url ', 8);
  expect(u32(bytes, url.data)).toBe(1);
  expect(prepared.metadata()).toMatchObject({
    ...settings,
    timescale: 30000,
    durationTicks: 3003,
    codec: 'avc1.42e01e',
    byteLength: bytes.length,
  });
});
it('writes exact sequence, uint64 DTS, relative data offset, duration, size, flags and original opaque sample bytes', () => {
  const bytes = prepareAvcMp4(capture()).bytes(),
    top = boxes(bytes),
    original = packets();
  for (let i = 0; i < 3; i++) {
    const moof = top[2 + i * 2],
      mdat = top[3 + i * 2],
      mfhd = child(bytes, moof, 'mfhd'),
      traf = child(bytes, moof, 'traf'),
      tfhd = child(bytes, traf, 'tfhd'),
      tfdt = child(bytes, traf, 'tfdt'),
      trun = child(bytes, traf, 'trun');
    expect(moof.size).toBe(100);
    expect(u32(bytes, mfhd.data + 4)).toBe(i + 1);
    expect(u32(bytes, tfhd.data) & 0xffffff).toBe(0x020000);
    expect(u32(bytes, tfhd.data + 4)).toBe(1);
    expect(bytes[tfdt.data]).toBe(1);
    expect(u64(bytes, tfdt.data + 4)).toBe(BigInt(i * 1001));
    expect(u32(bytes, trun.data) & 0xffffff).toBe(0x701);
    expect(u32(bytes, trun.data + 4)).toBe(1);
    expect(moof.start + u32(bytes, trun.data + 8)).toBe(mdat.data);
    expect(u32(bytes, trun.data + 12)).toBe(1001);
    expect(u32(bytes, trun.data + 16)).toBe(6);
    expect(u32(bytes, trun.data + 20)).toBe(i ? 0x01010000 : 0x02000000);
    expect(bytes.slice(mdat.data, mdat.end)).toEqual(original[i].bytes);
  }
});
it.each([1, 2, 4] as const)(
  'preserves %s-byte NAL framing and multiple original NAL units exactly',
  (size) => {
    const c = configuration();
    c[4] = 0xfc + size - 1;
    const p = packets(3, size);
    p[1].bytes = new Uint8Array([...p[1].bytes, ...p[1].bytes]);
    const bytes = prepareAvcMp4(avc.prepareAvcSamples(settings, c, p)).bytes(),
      top = boxes(bytes);
    for (let i = 0; i < 3; i++)
      expect(bytes.slice(top[3 + i * 2].data, top[3 + i * 2].end)).toEqual(p[i].bytes);
  },
);
it('computes actual output byte budget before reading configuration or packets and leaves the original capture usable', () => {
  const source = capture(),
    minimum = prepareAvcMp4(source).metadata().byteLength,
    config = vi.spyOn(avc, 'readPreparedAvcDescription'),
    sample = vi.spyOn(avc, 'readPreparedAvcSample');
  expect(() => prepareAvcMp4(source, { maxBytes: minimum - 1 })).toThrow(/budget/);
  expect(config).not.toHaveBeenCalled();
  expect(sample).not.toHaveBeenCalled();
  expect(prepareAvcMp4(source, { maxBytes: minimum }).bytes()).toHaveLength(minimum);
  expect(avc.readPreparedAvcSample(source, 2).bytes).toEqual(packets()[2].bytes);
});
it('captures original budgets and does not treat mutable snapshots/reservations as file sizes', () => {
  const source = capture({ maxBytes: 2000 }),
    metadata = source.metadata();
  expect(metadata.maxBytes).toBe(2000);
  metadata.maxBytes = 1;
  metadata.reservedByteLength = 1;
  let reads = 0;
  const opts = {
    get maxBytes() {
      reads++;
      return 2000;
    },
  };
  const mux = prepareAvcMp4(source, opts);
  expect(reads).toBe(1);
  expect(mux.metadata().byteLength).toBeLessThan(source.metadata().reservedByteLength);
  expect(mux.metadata().byteLength).toBeGreaterThan(0);
});
it.each([0, NaN, Infinity, 128 * 1024 * 1024 + 1, -1, 1.5])(
  'rejects original raw byte budget %s without consuming capture',
  (maxBytes) => {
    const source = capture();
    expect(() => prepareAvcMp4(source, { maxBytes })).toThrow();
    expect(prepareAvcMp4(source).metadata().frameCount).toBe(3);
  },
);
it('requires the original branded capture before invoking any caller public metadata or methods', () => {
  const source = capture(),
    metadata = vi.fn(() => source.metadata());
  for (const fake of [
    { ...source, metadata },
    { metadata },
    source.metadata(),
    JSON.parse(JSON.stringify(source)),
    new Proxy(source, {}),
  ])
    expect(() => prepareAvcMp4(fake)).toThrow(/original/);
  expect(metadata).not.toHaveBeenCalled();
  source.dispose();
  expect(() => prepareAvcMp4(source)).toThrow(/disposed/);
});
it('returns detached bytes/metadata and retains source ownership through disposal', () => {
  const source = capture(),
    mux = prepareAvcMp4(source),
    original = mux.bytes();
  mux.bytes().fill(0);
  mux.metadata().byteLength = 1;
  expect(mux.bytes()).toEqual(original);
  source.dispose();
  expect(() => mux.bytes()).toThrow(/disposed/);
  mux.dispose();
  expect(() => mux.metadata()).toThrow(/disposed/);
});
it.each(['source', 'reentry', 'async'] as const)(
  'rejects %s original source admission before output and allows valid retry',
  (fault) => {
    let armed = false;
    const source = capture({
      validate() {
        if (!armed) return;
        if (fault === 'source') throw Error('source changed');
        if (fault === 'async') return Promise.resolve() as never;
        try {
          prepareAvcMp4(source);
        } catch {}
      },
    });
    armed = true;
    expect(() => prepareAvcMp4(source)).toThrow();
    armed = false;
    expect(prepareAvcMp4(source).metadata().frameCount).toBe(3);
  },
);
it.each(['source', 'cancel'] as const)(
  'rejects actual late %s at complete container allocation before returning output',
  (fault) => {
    let changed = false;
    const source = capture({
        validate() {
          if (changed) throw Error('late source');
        },
      }),
      size = prepareAvcMp4(source).metadata().byteLength,
      Original = Uint8Array,
      controller = new AbortController();
    let fired = false;
    vi.stubGlobal(
      'Uint8Array',
      new Proxy(Original, {
        construct(target, args) {
          if (!fired && args[0] === size) {
            fired = true;
            if (fault === 'source') changed = true;
            else controller.abort();
          }
          return Reflect.construct(target, args, target);
        },
      }),
    );
    expect(() => prepareAvcMp4(source, { signal: controller.signal })).toThrow();
    expect(fired).toBe(true);
    vi.unstubAllGlobals();
    changed = false;
    expect(prepareAvcMp4(source).metadata().byteLength).toBe(size);
  },
);
it('cancelled/invalid/reentrant reads do not consume prepared bytes and metadata', () => {
  let armed = false;
  const source = capture({
      validate() {
        if (armed)
          try {
            mux.bytes();
          } catch {}
      },
    }),
    mux = prepareAvcMp4(source),
    original = mux.bytes(),
    controller = new AbortController();
  controller.abort();
  expect(() => mux.bytes(controller.signal)).toThrow();
  expect(() => mux.bytes({} as AbortSignal)).toThrow();
  expect(mux.bytes()).toEqual(original);
  armed = true;
  expect(() => mux.bytes()).toThrow(/reentered/);
  armed = false;
  expect(mux.bytes()).toEqual(original);
});
it('rejects preaborted requests and swallowed option-getter reentry without consuming capture', () => {
  const source = capture(),
    controller = new AbortController();
  controller.abort();
  expect(() => prepareAvcMp4(source, { signal: controller.signal })).toThrow();
  expect(() =>
    prepareAvcMp4(source, {
      get maxBytes() {
        try {
          prepareAvcMp4(source);
        } catch {}
        return 128 * 1024 * 1024;
      },
    }),
  ).toThrow(/reentered/);
  expect(prepareAvcMp4(source).metadata().frameCount).toBe(3);
});
it.each(['source', 'cancel'] as const)(
  'rejects late %s after detached output copying and preserves a valid read retry',
  (fault) => {
    let changed = false;
    const source = capture({
        validate() {
          if (changed) throw Error('late source');
        },
      }),
      mux = prepareAvcMp4(source),
      original = mux.bytes(),
      controller = new AbortController(),
      slice = Uint8Array.prototype.slice;
    let fired = false;
    vi.spyOn(Uint8Array.prototype, 'slice').mockImplementation(function (
      this: Uint8Array,
      ...args
    ) {
      const output = slice.apply(this, args);
      if (this.length === original.length) {
        fired = true;
        if (fault === 'source') changed = true;
        else controller.abort();
      }
      return output;
    });
    expect(() => mux.bytes(controller.signal)).toThrow();
    expect(fired).toBe(true);
    vi.restoreAllMocks();
    changed = false;
    expect(mux.bytes()).toEqual(original);
  },
);
it('uses 64bit movie/media/decode durations and retains all10001fragments without a lower frame cap', () => {
  const n = 10001,
    scale = 0xffffffff,
    source = avc.prepareAvcSamples(
      { ...settings, width: 65535, height: 65535, rate: scale, scale, frameCount: n },
      configuration(),
      packets(n),
    ),
    mux = prepareAvcMp4(source),
    bytes = mux.bytes(),
    top = boxes(bytes),
    mvhd = child(bytes, top[1], 'mvhd'),
    last = top[top.length - 2],
    tfdt = child(bytes, child(bytes, last, 'traf'), 'tfdt');
  expect(top).toHaveLength(2 + 2 * n);
  expect(u64(bytes, mvhd.data + 24)).toBe(BigInt(n) * BigInt(scale));
  expect(u64(bytes, tfdt.data + 4)).toBe(BigInt(n - 1) * BigInt(scale));
  expect(bytes.slice(top.at(-1)!.data)).toEqual(
    packets(1)[0].bytes.map((v, i) => (i === 4 ? 0x41 : v)),
  );
  expect(mux.metadata().frameCount).toBe(n);
});

import {
  readPreparedAvcDescription,
  readPreparedAvcSample,
  readPreparedAvcMetadata,
  type AvcSampleMetadata,
} from './avc-samples';

const maximum = 128 * 1024 * 1024;
const valid = (n: number, min: number, max: number) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
const zeros = (n: number) => new Uint8Array(n);
const text = (s: string) => new TextEncoder().encode(s);
function join(parts: Uint8Array[]) {
  const size = parts.reduce((n, p) => n + p.length, 0);
  if (!valid(size, 0, maximum)) throw Error('MP4 byte budget exceeded.');
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes;
}
function number(n: number, size: number) {
  if (!valid(n, 0, size === 8 ? Number.MAX_SAFE_INTEGER : 2 ** (8 * size) - 1))
    throw Error('MP4 integer overflow.');
  const bytes = zeros(size),
    view = new DataView(bytes.buffer);
  if (size === 8) view.setBigUint64(0, BigInt(n));
  else if (size === 4) view.setUint32(0, n);
  else if (size === 2) view.setUint16(0, n);
  else bytes[0] = n;
  return bytes;
}
const u16 = (n: number) => number(n, 2),
  u32 = (n: number) => number(n, 4),
  u64 = (n: number) => number(n, 8);
function box(type: string, ...parts: Uint8Array[]) {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  if (type.length !== 4 || !valid(size, 8, Math.min(maximum, 0xffffffff)))
    throw Error('MP4 box size overflow.');
  return join([u32(size), text(type), ...parts]);
}
const full = (type: string, version: number, flags: number, ...parts: Uint8Array[]) =>
  box(
    type,
    new Uint8Array([version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]),
    ...parts,
  );
const matrix = () =>
  join([u32(65536), u32(0), u32(0), u32(0), u32(65536), u32(0), u32(0), u32(0), u32(1073741824)]);
function initialization(meta: AvcSampleMetadata, description: Uint8Array) {
  const { width, height, rate, durationTicks } = meta;
  const mvhd = full(
    'mvhd',
    1,
    0,
    zeros(16),
    u32(rate),
    u64(durationTicks),
    u32(65536),
    u16(256),
    zeros(10),
    matrix(),
    zeros(24),
    u32(2),
  );
  const tkhd = full(
    'tkhd',
    1,
    7,
    zeros(16),
    u32(1),
    zeros(4),
    u64(durationTicks),
    zeros(16),
    matrix(),
    u32(width * 65536),
    u32(height * 65536),
  );
  const mdhd = full('mdhd', 1, 0, zeros(16), u32(rate), u64(durationTicks), u16(0x55c4), u16(0));
  const hdlr = full('hdlr', 0, 0, u32(0), text('vide'), zeros(12), text('Splash video\0'));
  const visual = box(
    'avc1',
    zeros(6),
    u16(1),
    zeros(16),
    u16(width),
    u16(height),
    u32(0x00480000),
    u32(0x00480000),
    zeros(4),
    u16(1),
    zeros(32),
    u16(24),
    u16(65535),
    box('avcC', description),
  );
  const stbl = box(
    'stbl',
    full('stsd', 0, 0, u32(1), visual),
    full('stts', 0, 0, u32(0)),
    full('stsc', 0, 0, u32(0)),
    full('stsz', 0, 0, u32(0), u32(0)),
    full('stco', 0, 0, u32(0)),
  );
  const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
  const minf = box('minf', full('vmhd', 0, 1, zeros(8)), dinf, stbl);
  const trak = box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
  const mvex = box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0)));
  return join([
    box('ftyp', text('iso6'), u32(1), text('isomiso6avc1mp41')),
    box('moov', mvhd, trak, mvex),
  ]);
}
export interface PreparedAvcMp4 {
  metadata: () => {
    byteLength: number;
    frameCount: number;
    width: number;
    height: number;
    rate: number;
    scale: number;
    durationTicks: number;
    timescale: number;
    codec: string;
  };
  bytes: (signal?: AbortSignal) => Uint8Array;
  dispose: () => void;
}
let preparing = false,
  reentered = false;
/** Complete-only one-track fragmented MP4. No encoder, audio, reordered frames,
 * external data references, sink writes or editor integration. Codec payloads
 * and caller keyframe flags remain opaque. See W3C ISO BMFF byte-stream format.
 */
export function prepareAvcMp4(
  capture: object,
  options: { maxBytes?: number; signal?: AbortSignal } = {},
): PreparedAvcMp4 {
  if (preparing) {
    reentered = true;
    throw Error('MP4 preparation reentered.');
  }
  preparing = true;
  reentered = false;
  try {
    const { maxBytes = maximum, signal } = options;
    if (!valid(maxBytes, 1, maximum) || (signal !== undefined && !(signal instanceof AbortSignal)))
      throw Error('Invalid MP4 byte budget or cancellation.');
    signal?.throwIfAborted();
    // Check the original WeakMap brand before invoking any public capture method.
    const meta = readPreparedAvcMetadata(capture),
      limit = Math.min(maxBytes, meta.maxBytes);
    const check = () => {
      signal?.throwIfAborted();
      readPreparedAvcMetadata(capture);
      signal?.throwIfAborted();
      if (reentered) throw Error('MP4 preparation reentered.');
    };
    const { width, height, frameCount, rate, scale, durationTicks, codec } = meta;
    const fixedInitBytes = initialization(meta, zeros(0)).length;
    const moofBytes = 100; // Fixed one-sample mfhd/traf(tfhd,tfdt-v1,trun) layout.
    const plannedBytes =
      fixedInitBytes + meta.descriptionBytes + frameCount * (moofBytes + 8) + meta.packetBytes;
    if (!valid(plannedBytes, 1, limit)) throw Error('MP4 byte budget exceeded.');
    check();
    const description = readPreparedAvcDescription(capture, signal),
      init = initialization(meta, description);
    let byteLength = init.length;
    const parts: Uint8Array[] = [init];
    if (byteLength > limit) throw Error('MP4 byte budget exceeded.');
    for (let index = 0; index < frameCount; index++) {
      check();
      const sample = readPreparedAvcSample(capture, index, signal);
      // One original access unit per fragment. DTS=PTS is explicit capture scope.
      const fragment = (offset: number) =>
        box(
          'moof',
          full('mfhd', 0, 0, u32(index + 1)),
          box(
            'traf',
            full('tfhd', 0, 0x020000, u32(1)),
            full('tfdt', 1, 0, u64(sample.decodeTimeTicks)),
            full(
              'trun',
              0,
              0x701,
              u32(1),
              u32(offset),
              u32(sample.durationTicks),
              u32(sample.bytes.length),
              u32(sample.keyFrame ? 0x02000000 : 0x01010000),
            ),
          ),
        );
      const prefix = fragment(0),
        moof = fragment(prefix.length + 8),
        mdatHeader = join([u32(sample.bytes.length + 8), text('mdat')]);
      byteLength += moof.length + mdatHeader.length + sample.bytes.length;
      if (!valid(byteLength, 1, limit)) throw Error('MP4 byte budget exceeded.');
      parts.push(moof, mdatHeader, sample.bytes);
    }
    check();
    if (byteLength !== plannedBytes) throw Error('MP4 layout byte accounting changed.');
    let bytes: Uint8Array | undefined = join(parts);
    parts.length = 0;
    check();
    const metadata = {
      byteLength,
      frameCount,
      width,
      height,
      rate,
      scale,
      durationTicks,
      timescale: rate,
      codec,
    };
    let disposed = false,
      reading = false,
      readReentered = false;
    const admitted = () => {
      if (disposed) throw Error('Prepared MP4 disposed.');
      readPreparedAvcMetadata(capture);
    };
    function read<T>(requestSignal: AbortSignal | undefined, fn: () => T): T {
      if (reading) {
        readReentered = true;
        throw Error('MP4 access reentered.');
      }
      reading = true;
      readReentered = false;
      try {
        if (requestSignal !== undefined && !(requestSignal instanceof AbortSignal))
          throw Error('Invalid MP4 read cancellation.');
        requestSignal?.throwIfAborted();
        admitted();
        const result = fn();
        admitted();
        requestSignal?.throwIfAborted();
        if (readReentered) throw Error('MP4 access reentered.');
        return result;
      } finally {
        reading = false;
      }
    }
    return Object.freeze({
      metadata: () => read(undefined, () => ({ ...metadata })),
      bytes: (scope?: AbortSignal) => read(scope, () => bytes!.slice()),
      dispose() {
        if (reading) {
          readReentered = true;
          throw Error('MP4 disposal reentered.');
        }
        disposed = true;
        bytes = undefined;
      },
    });
  } finally {
    preparing = false;
  }
}

import type { IvfSettings } from './ivf';

export type AvcSampleSettings = Omit<IvfSettings, 'codec'>;
export interface AvcEncodedSample {
  bytes: Uint8Array;
  keyFrame: boolean;
}
export interface AvcSampleMetadata extends AvcSampleSettings {
  codec: string;
  nalLengthSize: 1 | 2 | 4;
  descriptionBytes: number;
  packetBytes: number;
  reservedByteLength: number;
  maxBytes: number;
  timescale: number;
  durationTicks: number;
  sampleDurationTicks: number;
}
export interface PreparedAvcSamples {
  metadata: () => AvcSampleMetadata;
  dispose: () => void;
}
export interface PreparedAvcSample {
  bytes: Uint8Array;
  keyFrame: boolean;
  decodeTimeTicks: number;
  durationTicks: number;
  compositionOffsetTicks: 0;
  timestampUs: number;
  durationUs: number;
}
type Options = { maxBytes?: number; signal?: AbortSignal; validate?: () => void };
const maximum = 128 * 1024 * 1024;
const Bytes = Uint8Array,
  typed = Object.getPrototypeOf(Bytes.prototype) as object;
const size = Object.getOwnPropertyDescriptor(typed, 'byteLength')!.get!,
  buffer = Object.getOwnPropertyDescriptor(typed, 'buffer')!.get!,
  offset = Object.getOwnPropertyDescriptor(typed, 'byteOffset')!.get!,
  set = Bytes.prototype.set;
const valid = (n: number, min: number, max: number) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
function owned(value: Uint8Array, limit: number) {
  if (!(value instanceof Bytes)) throw Error('AVC requires encoded byte arrays.');
  const length = size.call(value) as number,
    storage = buffer.call(value) as ArrayBuffer;
  if (!(storage instanceof ArrayBuffer) || !length || length > limit)
    throw Error('Invalid AVC unshared byte storage or budget.');
  const view = new Bytes(storage, offset.call(value), length),
    copy = new Bytes(length);
  set.call(copy, view);
  return copy;
}
function configuration(bytes: Uint8Array) {
  // Explicit initial Baseline AVC subset. Extended-profile records remain unsupported.
  if (
    bytes.length < 7 ||
    bytes[0] !== 1 ||
    bytes[1] !== 66 ||
    (bytes[4] & 0xfc) !== 0xfc ||
    (bytes[5] & 0xe0) !== 0xe0
  )
    throw Error('Unsupported or malformed Baseline AVC configuration.');
  const lengthSize = (bytes[4] & 3) + 1;
  if (lengthSize === 3) throw Error('AVC NAL lengths must use one, two or four bytes.');
  let at = 6;
  const count = bytes[5] & 31;
  if (!count) throw Error('AVC requires original SPS and PPS data.');
  const parameters = (count: number, type: number) => {
    for (let i = 0; i < count; i++) {
      if (at + 2 > bytes.length) throw Error('Truncated AVC parameter length.');
      const n = bytes[at] * 256 + bytes[at + 1];
      at += 2;
      if (
        n < (type === 7 ? 5 : 2) ||
        at + n > bytes.length ||
        (bytes[at] & 0x80) !== 0 ||
        (bytes[at] & 31) !== type
      )
        throw Error('Invalid AVC parameter set.');
      if (
        type === 7 &&
        (bytes[at + 1] !== bytes[1] || bytes[at + 2] !== bytes[2] || bytes[at + 3] !== bytes[3])
      )
        throw Error('AVC SPS configuration identity changed.');
      at += n;
    }
  };
  parameters(count, 7);
  if (at >= bytes.length) throw Error('Missing AVC PPS count.');
  const pps = bytes[at++];
  if (!pps) throw Error('AVC requires PPS data.');
  parameters(pps, 8);
  if (at !== bytes.length) throw Error('Unexpected AVC configuration extension.');
  return {
    nalLengthSize: lengthSize as 1 | 2 | 4,
    codec: 'avc1.' + Array.from(bytes.slice(1, 4), (b) => b.toString(16).padStart(2, '0')).join(''),
  };
}
function packet(bytes: Uint8Array, lengthSize: number) {
  let at = 0;
  while (at < bytes.length) {
    if (at + lengthSize > bytes.length) throw Error('Truncated AVC NAL length.');
    let n = 0;
    for (let i = 0; i < lengthSize; i++) n = n * 256 + bytes[at++];
    if (!n || at + n > bytes.length || (bytes[at] & 0x80) !== 0 || (bytes[at] & 31) === 0)
      throw Error('Malformed length-prefixed AVC packet.');
    at += n;
  }
}
interface Owner {
  metadata: () => AvcSampleMetadata;
  description: (signal?: AbortSignal) => Uint8Array;
  sample: (index: number, signal?: AbortSignal) => PreparedAvcSample;
}
const owners = new WeakMap<object, Owner>();
let preparing = false,
  reentered = false;
export function readPreparedAvcMetadata(plan: object) {
  const owner = owners.get(plan);
  if (!owner) throw Error('An original prepared AVC capture is required.');
  return owner.metadata();
}
export function readPreparedAvcDescription(plan: object, signal?: AbortSignal) {
  const owner = owners.get(plan);
  if (!owner) throw Error('An original prepared AVC capture is required.');
  return owner.description(signal);
}
export function readPreparedAvcSample(plan: object, index: number, signal?: AbortSignal) {
  const owner = owners.get(plan);
  if (!owner) throw Error('An original prepared AVC capture is required.');
  return owner.sample(index, signal);
}
/** Encoded AVC preparation only: no encoder, MP4/container output, sink or UI.
 * Decode order equals presentation order; B-frame/reordered samples unsupported.
 * NAL framing and configuration are admitted, not slice syntax/codec playback.
 * Preparation cancellation guards capture; per-read cancellation never consumes it.
 * References: https://www.w3.org/TR/webcodecs-avc-codec-registration/
 * and Chromium media/formats/mp4/box_definitions.cc (AVC configuration parser).
 */
export function prepareAvcSamples(
  settings: AvcSampleSettings,
  description: Uint8Array,
  samples: readonly AvcEncodedSample[],
  options: Options = {},
): PreparedAvcSamples {
  if (preparing) {
    reentered = true;
    throw Error('AVC preparation reentered.');
  }
  preparing = true;
  reentered = false;
  try {
    const { width, height, frameCount, rate, scale } = settings,
      { maxBytes = maximum, signal, validate } = options;
    if (
      !valid(width, 1, 65535) ||
      !valid(height, 1, 65535) ||
      !valid(frameCount, 1, 10001) ||
      !valid(rate, 1, 0xffffffff) ||
      !valid(scale, 1, 0xffffffff) ||
      rate / scale < 1 ||
      rate / scale > 240 ||
      !valid(maxBytes, 1, maximum) ||
      (signal !== undefined && !(signal instanceof AbortSignal)) ||
      (validate !== undefined && typeof validate !== 'function')
    )
      throw Error('Invalid AVC capture settings or options.');
    const reserve = 1024 + 256 * frameCount;
    if (reserve >= maxBytes) throw Error('AVC capture exceeds byte budget.');
    signal?.throwIfAborted();
    let config: Uint8Array | undefined = owned(description, maxBytes - reserve);
    const format = configuration(config);
    if (!Array.isArray(samples) || samples.length !== frameCount)
      throw Error('Incomplete AVC encoded sample capture.');
    let retained: AvcEncodedSample[] = [];
    let packetBytes = 0;
    for (let index = 0; index < frameCount; index++) {
      signal?.throwIfAborted();
      const value = samples[index];
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Missing AVC encoded sample.');
      if (Reflect.ownKeys(value).some((k) => k !== 'bytes' && k !== 'keyFrame'))
        throw Error('Unsupported AVC sample fields or reordered timing.');
      const { bytes, keyFrame } = value;
      if (typeof keyFrame !== 'boolean' || (!index && !keyFrame))
        throw Error('AVC requires an initial caller-declared keyframe.');
      const data = owned(bytes, maxBytes - reserve - config.length - packetBytes);
      packet(data, format.nalLengthSize);
      packetBytes += data.length;
      retained.push({ bytes: data, keyFrame });
    }
    if (samples.length !== frameCount) throw Error('AVC sample count changed during capture.');
    const metadata: AvcSampleMetadata = {
      width,
      height,
      frameCount,
      rate,
      scale,
      ...format,
      descriptionBytes: config.length,
      packetBytes,
      reservedByteLength: reserve + config.length + packetBytes,
      maxBytes,
      timescale: rate,
      durationTicks: frameCount * scale,
      sampleDurationTicks: scale,
    };
    const admission = () => {
      const result = validate?.() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('AVC source admission must be synchronous.');
      }
    };
    admission();
    signal?.throwIfAborted();
    if (reentered) throw Error('AVC capture changed or reentered.');
    let disposed = false,
      reading = false,
      readReentered = false;
    function read<T>(requestSignal: AbortSignal | undefined, fn: () => T): T {
      if (reading) {
        readReentered = true;
        throw Error('AVC capture access reentered.');
      }
      reading = true;
      readReentered = false;
      const check = () => {
        if (disposed) throw Error('Prepared AVC capture disposed.');
        requestSignal?.throwIfAborted();
        admission();
        requestSignal?.throwIfAborted();
      };
      try {
        if (requestSignal !== undefined && !(requestSignal instanceof AbortSignal))
          throw Error('Invalid AVC read cancellation.');
        check();
        const output = fn();
        check();
        if (readReentered) throw Error('AVC capture access reentered.');
        return output;
      } finally {
        reading = false;
      }
    }
    const stamp = (index: number) =>
      Number((BigInt(index) * BigInt(scale) * 2000000n + BigInt(rate)) / (2n * BigInt(rate)));
    const owner: Owner = {
      metadata: () => read(undefined, () => ({ ...metadata })),
      description: (scope) => read(scope, () => owned(config!, config!.length)),
      sample: (index, scope) =>
        read(scope, () => {
          if (!valid(index, 0, frameCount - 1)) throw Error('Invalid prepared AVC sample index.');
          const source = retained[index];
          return {
            bytes: owned(source.bytes, source.bytes.length),
            keyFrame: source.keyFrame,
            decodeTimeTicks: index * scale,
            durationTicks: scale,
            compositionOffsetTicks: 0,
            timestampUs: stamp(index),
            durationUs: stamp(index + 1) - stamp(index),
          };
        }),
    };
    const plan = Object.freeze({
      metadata: owner.metadata,
      dispose() {
        if (reading) {
          readReentered = true;
          throw Error('AVC disposal reentered.');
        }
        disposed = true;
        retained = [];
        config = undefined;
      },
    });
    owners.set(plan, owner);
    return plan;
  } finally {
    preparing = false;
  }
}

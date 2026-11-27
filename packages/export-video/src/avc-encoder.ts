import { prepareAvcSamples, type AvcSampleSettings, type AvcEncodedSample } from './avc-samples';

export interface AvcEncoderSettings extends AvcSampleSettings {
  bitrate: number;
  keyFrameInterval?: number;
}
export interface AvcEncoderOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  validate?: () => void;
}
export interface AvcNative {
  Encoder: typeof VideoEncoder;
  Frame: typeof VideoFrame;
  Support?: typeof VideoEncoder.isConfigSupported;
}
const maximum = 128 * 1024 * 1024,
  codec = 'avc1.42e01f';
const valid = (n: number, min: number, max: number) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
const Bytes = Uint8Array,
  typed = Object.getPrototypeOf(Bytes.prototype);
const length = Object.getOwnPropertyDescriptor(typed, 'byteLength')!.get!,
  buffer = Object.getOwnPropertyDescriptor(typed, 'buffer')!.get!,
  offset = Object.getOwnPropertyDescriptor(typed, 'byteOffset')!.get!,
  set = Bytes.prototype.set;
function copy(value: AllowSharedBufferSource, limit: number) {
  let storage: ArrayBuffer, at: number, size: number;
  if (value instanceof ArrayBuffer) {
    storage = value;
    at = 0;
    size = value.byteLength;
  } else if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    storage = buffer.call(value);
    at = offset.call(value);
    size = length.call(value);
  } else throw Error('Expected unshared AVC bytes.');
  if (!(storage instanceof ArrayBuffer) || !valid(size, 1, limit))
    throw Error('Invalid AVC byte storage or budget.');
  const result = new Bytes(size);
  set.call(result, new Bytes(storage, at, size));
  return result;
}
/** Shared original-value admission before starting an asynchronous capture job. */
export function prepareAvcEncoderSettings(settings: AvcEncoderSettings, maxBytes = maximum) {
  const { width, height, frameCount, rate, scale, bitrate, keyFrameInterval = 1 } = settings;
  if (
    !valid(width, 1, 65535) ||
    !valid(height, 1, 65535) ||
    !valid(frameCount, 1, 10001) ||
    !valid(rate, 1, 0xffffffff) ||
    !valid(scale, 1, 0xffffffff) ||
    rate / scale < 1 ||
    rate / scale > 240 ||
    !valid(bitrate, 1, 100000000) ||
    !valid(keyFrameInterval, 1, 300) ||
    !valid(maxBytes, 1, maximum) ||
    width * height * 4 * frameCount > maximum ||
    1024 + 257 * frameCount + 1 > maxBytes
  )
    throw Error('Invalid AVC settings or work/byte budget.');
  return { width, height, frameCount, rate, scale, bitrate, keyFrameInterval };
}
/** Separate explicitly supported Baseline AVC host. Serial flush bounds the input
 * queue; only a complete source-owned sample capture publishes at finish. Native
 * codec availability/fidelity and peak memory remain platform-specific. */
export async function openAvcEncoder(
  settings: AvcEncoderSettings,
  options: AvcEncoderOptions = {},
  native?: AvcNative,
) {
  const { signal, timeoutMs = 10000, maxBytes = maximum, validate } = options;
  const { width, height, frameCount, rate, scale, bitrate, keyFrameInterval } =
    prepareAvcEncoderSettings(settings, maxBytes);
  const {
    Encoder: Native,
    Frame,
    Support,
  } = native ?? {
    Encoder: globalThis.VideoEncoder,
    Frame: globalThis.VideoFrame,
  };
  const started = performance.now(),
    frameBytes = width * height * 4,
    reserve = 1024 + 256 * frameCount;
  if (
    !valid(timeoutMs, 1, 60000) ||
    (signal !== undefined && !(signal instanceof AbortSignal)) ||
    (validate !== undefined && typeof validate !== 'function')
  )
    throw Error('Invalid AVC settings, deadline or work/byte budget.');
  signal?.throwIfAborted();
  if (typeof Native !== 'function' || typeof Frame !== 'function')
    throw Error('WebCodecs AVC encoding is unavailable.');
  const support = Support ?? Native.isConfigSupported;
  if (typeof support !== 'function') throw Error('WebCodecs AVC support checking is unavailable.');
  const config = (): VideoEncoderConfig => ({
    codec,
    width,
    height,
    bitrate,
    framerate: rate / scale,
    latencyMode: 'realtime',
    alpha: 'discard',
    avc: { format: 'avc' },
  });
  const samples: AvcEncodedSample[] = [];
  let encoder: VideoEncoder | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    failure: unknown,
    closed = false,
    busy = false,
    outputting = false,
    checking = false,
    submitted = 0,
    received = 0,
    packetBytes = 0,
    description: Uint8Array | undefined;
  let rejectFailure: (error: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  void failed.catch(() => {});
  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    try {
      if (encoder?.state !== 'closed') encoder?.close();
    } catch {
      /* Native resource may already be reclaimed. */
    }
  };
  const fail = (error: unknown) => {
    if (closed) return;
    failure = error ?? Error('AVC encoding failed.');
    closed = true;
    samples.length = 0;
    description = undefined;
    cleanup();
    rejectFailure(failure);
  };
  const abort = () => fail(signal?.reason ?? Error('AVC encoding cancelled.'));
  const check = () => {
    if (checking) {
      fail(Error('AVC source admission reentered.'));
      throw failure;
    }
    if (!closed && performance.now() - started >= timeoutMs) fail(Error('AVC encoding timed out.'));
    if (closed) throw failure ?? Error('AVC encoder is closed.');
    signal?.throwIfAborted();
    checking = true;
    try {
      const result = validate?.() as unknown;
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('AVC source validation must be synchronous.');
      }
    } finally {
      checking = false;
    }
    signal?.throwIfAborted();
    if (closed) throw failure ?? Error('AVC encoder is closed.');
  };
  const stamp = (i: number) =>
    Number((BigInt(i) * BigInt(scale) * 2000000n + BigInt(rate)) / (2n * BigInt(rate)));
  try {
    check();
    timer = setTimeout(
      () => fail(Error('AVC encoding timed out.')),
      Math.max(1, timeoutMs - (performance.now() - started)),
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    check();
    const supported = await Promise.race([support.call(Native, config()), failed]);
    check();
    if (supported.supported !== true) throw Error('Baseline AVC encoding is unsupported.');
    check();
    encoder = new Native({
      error: fail,
      output(chunk, metadata) {
        if (closed) return;
        if (outputting) {
          fail(Error('AVC output reentered.'));
          return;
        }
        outputting = true;
        try {
          check();
          const { timestamp, duration, type, byteLength: size, copyTo } = chunk;
          const dc = metadata?.decoderConfig;
          if (dc) {
            const { codec: outputCodec, codedWidth, codedHeight, description: data } = dc;
            if (
              outputCodec.toLowerCase() !== codec ||
              (codedWidth !== undefined && codedWidth !== width) ||
              (codedHeight !== undefined && codedHeight !== height) ||
              data === undefined
            )
              throw Error('Unexpected AVC decoder configuration.');
            const available = maxBytes - reserve - packetBytes - (frameCount - received);
            const next = copy(data, available);
            if (
              description &&
              (next.length !== description.length || next.some((b, i) => b !== description![i]))
            )
              throw Error('AVC decoder configuration changed.');
            description = next;
          }
          check();
          if (
            !description ||
            received >= submitted ||
            timestamp !== stamp(received) ||
            (duration !== undefined &&
              duration !== null &&
              duration !== stamp(received + 1) - stamp(received)) ||
            (type !== 'key' && type !== 'delta') ||
            (received % keyFrameInterval === 0 && type !== 'key')
          )
            throw Error('Unexpected AVC packet order, duration, configuration or type.');
          if (
            !valid(size, 1, maxBytes) ||
            reserve + description.length + packetBytes + size + frameCount - received - 1 >
              maxBytes ||
            typeof copyTo !== 'function'
          )
            throw Error('AVC output exceeds byte budget.');
          const bytes = new Bytes(size);
          copyTo.call(chunk, bytes);
          check();
          samples.push({ bytes, keyFrame: type === 'key' });
          packetBytes += size;
          received++;
        } catch (error) {
          fail(error);
        } finally {
          outputting = false;
        }
      },
    });
    check();
    encoder.configure(config());
    check();
  } catch (error) {
    fail(error);
    cleanup();
    throw failure ?? error;
  }
  return Object.freeze({
    async append(rgba: Uint8Array) {
      check();
      if (busy || outputting) {
        fail(Error('AVC encoder has a pending frame.'));
        throw failure;
      }
      if (submitted >= frameCount) throw Error('AVC frame count exceeded.');
      busy = true;
      let entered = false;
      try {
        const owned = copy(rgba, frameBytes);
        if (owned.length !== frameBytes) throw Error('Expected one complete RGBA frame.');
        for (let i = 3; i < owned.length; i += 4)
          if (owned[i] !== 255) throw Error('AVC input must be opaque; composite a matte first.');
        check();
        entered = true;
        const frame = new Frame(owned, {
          format: 'RGBA',
          codedWidth: width,
          codedHeight: height,
          timestamp: stamp(submitted),
          duration: stamp(submitted + 1) - stamp(submitted),
        });
        try {
          check();
          const keyFrame = submitted % keyFrameInterval === 0;
          submitted++;
          encoder!.encode(frame, { keyFrame });
        } finally {
          frame.close();
        }
        await Promise.race([encoder!.flush(), failed]);
        check();
        if (received !== submitted) throw Error('AVC encoder omitted a frame.');
      } catch (error) {
        if (entered) fail(error);
        throw failure ?? error;
      } finally {
        busy = false;
      }
    },
    finish() {
      check();
      if (busy || outputting) {
        fail(Error('AVC encoder has a pending frame.'));
        throw failure;
      }
      if (submitted !== frameCount || received !== frameCount || !description)
        throw Error('AVC frame count is incomplete.');
      busy = true;
      try {
        const result = prepareAvcSamples(
          { width, height, frameCount, rate, scale },
          description,
          samples,
          { maxBytes, signal, validate },
        );
        const actualCodec = result.metadata().codec;
        // Native encoders can emit a lower level/constraint set than requested.
        // The original avcC/SPS record, not the requested decoder codec string,
        // owns the exact output identity. Keep this host within Baseline/level31.
        if (
          !/^avc1\.42[0-9a-f]{4}$/.test(actualCodec) ||
          parseInt(actualCodec.slice(-2), 16) > 31
        ) {
          result.dispose();
          throw Error(`AVC configuration identity changed: ${actualCodec} versus ${codec}.`);
        }
        check();
        closed = true;
        cleanup();
        samples.length = 0;
        description = undefined;
        return result;
      } catch (error) {
        fail(error);
        throw failure ?? error;
      } finally {
        busy = false;
      }
    },
    dispose() {
      fail(Error('AVC encoder disposed.'));
    },
  });
}

import {
  openAvcEncoder,
  prepareAvcEncoderSettings,
  type AvcEncoderSettings,
  type AvcEncoderOptions,
  type AvcNative,
} from './avc-encoder';
import { prepareAvcMp4, type PreparedAvcMp4 } from './mp4-avc';
import type { PreparedAvcSamples } from './avc-samples';

export type AvcFrameSource = (
  index: number,
  signal: AbortSignal,
) => Uint8Array | Promise<Uint8Array>;
export interface AvcMp4Result extends ReturnType<PreparedAvcMp4['metadata']> {
  bytes: Uint8Array;
}
/** Source-owned complete-only native AVC -> fragmented MP4 coordination.
 * The caller provides already composited, opaque integer-frame RGBA artwork.
 * One deadline/cancellation scope includes support, capture, flush and mux.
 * No editor, sink, audio, renderer or external publication is performed here.
 */
export async function encodeAvcMp4(
  settings: AvcEncoderSettings,
  readFrame: AvcFrameSource,
  options: AvcEncoderOptions = {},
  native?: AvcNative,
): Promise<AvcMp4Result> {
  const started = performance.now();
  const { signal, timeoutMs = 10000, maxBytes = 128 * 1024 * 1024, validate } = options;
  const { width, height, frameCount, rate, scale, bitrate, keyFrameInterval } =
    prepareAvcEncoderSettings(settings, maxBytes);
  if (
    typeof readFrame !== 'function' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60000 ||
    (signal !== undefined && !(signal instanceof AbortSignal)) ||
    (validate !== undefined && typeof validate !== 'function')
  )
    throw Error('Invalid AVC MP4 frame source, deadline or cancellation.');
  // Resolve constructor getters once before any source callbacks or asynchronous work.
  const { Encoder, Frame, Support } = native ?? {
    Encoder: globalThis.VideoEncoder,
    Frame: globalThis.VideoFrame,
  };
  const capturedNative = { Encoder, Frame, Support: Support ?? Encoder?.isConfigSupported },
    scope = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined,
    checking = false,
    stopped = false;
  let host: Awaited<ReturnType<typeof openAvcEncoder>> | undefined,
    capture: PreparedAvcSamples | undefined,
    mux: PreparedAvcMp4 | undefined;
  let rejectFailure: (error: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  void failed.catch(() => {});
  const stop = (error: unknown) => {
    if (stopped) return;
    stopped = true;
    scope.abort(error ?? Error('AVC MP4 encoding cancelled.'));
    rejectFailure(scope.signal.reason);
  };
  const abort = () => stop(signal?.reason ?? Error('AVC MP4 encoding cancelled.'));
  const check = () => {
    if (checking) {
      stop(Error('AVC MP4 source admission reentered.'));
      throw scope.signal.reason;
    }
    if (performance.now() - started >= timeoutMs) stop(Error('AVC MP4 encoding timed out.'));
    scope.signal.throwIfAborted();
    checking = true;
    try {
      const result = validate?.() as unknown;
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('AVC MP4 source validation must be synchronous.');
      }
    } finally {
      checking = false;
    }
    if (performance.now() - started >= timeoutMs) stop(Error('AVC MP4 encoding timed out.'));
    scope.signal.throwIfAborted();
  };
  const remaining = () => {
    check();
    return Math.max(1, Math.ceil(timeoutMs - (performance.now() - started)));
  };
  try {
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    check();
    timer = setTimeout(() => stop(Error('AVC MP4 encoding timed out.')), remaining());
    // open snapshots settings and its native support method synchronously before awaiting.
    const opening = openAvcEncoder(
      { width, height, frameCount, rate, scale, bitrate, keyFrameInterval },
      { signal: scope.signal, timeoutMs: remaining(), maxBytes, validate: check },
      capturedNative,
    );
    // If cancellation wins the race, reclaim any late successful native host too.
    void opening.then(
      (value) => {
        if (scope.signal.aborted) value.dispose();
      },
      () => {},
    );
    host = await Promise.race([opening, failed]);
    check();
    for (let index = 0; index < frameCount; index++) {
      check();
      const value = readFrame(index, scope.signal);
      check();
      if (value instanceof Uint8Array) {
        // append snapshots the buffer before yielding; synchronous provider output
        // must not be deferred behind a promise resolution/microtask boundary.
        await Promise.race([host.append(value), failed]);
      } else {
        const appending = Promise.resolve(value).then((rgba) => {
          check();
          return host!.append(rgba);
        });
        await Promise.race([appending, failed]);
      }
      check();
    }
    capture = host.finish();
    check();
    mux = prepareAvcMp4(capture, { maxBytes, signal: scope.signal });
    check();
    const metadata = mux.metadata(),
      bytes = mux.bytes(scope.signal);
    check();
    const result = Object.freeze({ ...metadata, bytes });
    check();
    return result;
  } catch (error) {
    stop(error);
    throw scope.signal.reason ?? error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    mux?.dispose();
    capture?.dispose();
    host?.dispose();
  }
}

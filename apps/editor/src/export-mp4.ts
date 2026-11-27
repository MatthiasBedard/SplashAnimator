import { validateProject, type Project } from '../../../packages/document/src';
import { encodeAvcMp4 } from '../../../packages/export-video/src/avc-mp4';
import { createVideoFrameReplay } from './video-frame-replay';
import { prepareRememberedVideoProject } from './remembered-video';
import { videoCaptureSettings, type VideoCaptureOptions } from './video-settings';

export interface Mp4CaptureOptions extends VideoCaptureOptions {
  remembered?: boolean;
  validate?: () => void;
}
/** Detached script-free silent MP4 capture. Integer replay starts at frame zero
 * even for selected ranges, retaining nested clocks and default button Up.
 * No authoring/history writes, downloads, sinks or silent codec fallback. */
export async function exportProjectMp4(
  project: Project,
  signal: AbortSignal,
  options: Mp4CaptureOptions = {},
) {
  const begun = performance.now();
  const {
    range,
    bitrate,
    keyFrameInterval,
    timeoutMs,
    maxBytes,
    progress,
    remembered = false,
    validate,
  } = options;
  if (
    !(signal instanceof AbortSignal) ||
    typeof remembered !== 'boolean' ||
    (range !== undefined && (!range || typeof range !== 'object' || Array.isArray(range))) ||
    (progress !== undefined && typeof progress !== 'function') ||
    (validate !== undefined && typeof validate !== 'function')
  )
    throw Error('Invalid project MP4 capture options.');
  signal.throwIfAborted();
  const capturedRange = range === undefined ? undefined : { start: range.start, end: range.end };
  // Original-value validation precedes detached project/configuration preparation.
  const snapshot = validateProject(project),
    capture = videoCaptureSettings(snapshot, 'mp4', {
      range: capturedRange,
      bitrate,
      keyFrameInterval,
      timeoutMs,
      maxBytes,
    });
  const Encoder = globalThis.VideoEncoder,
    Frame = globalThis.VideoFrame,
    Support = Encoder?.isConfigSupported;
  if (typeof Encoder !== 'function' || typeof Frame !== 'function' || typeof Support !== 'function')
    throw Error('WebCodecs AVC encoding is unavailable.');
  const native = { Encoder, Frame, Support },
    controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined,
    replay: Awaited<ReturnType<typeof createVideoFrameReplay>> | undefined,
    checking = false;
  let rejectWait: (error: unknown) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectWait = reject;
  });
  void stopped.catch(() => {});
  const abort = () => controller.abort(signal.reason ?? Error('Project MP4 capture cancelled.'));
  const reject = () => rejectWait(controller.signal.reason);
  const active = () => {
    if (checking) {
      controller.abort(Error('Project MP4 source admission reentered.'));
      throw controller.signal.reason;
    }
    if (performance.now() - begun >= capture.timeoutMs)
      controller.abort(Error('Project MP4 capture timed out.'));
    controller.signal.throwIfAborted();
    checking = true;
    try {
      const result = validate?.() as unknown;
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw Error('Project MP4 validation must be synchronous.');
      }
    } finally {
      checking = false;
    }
    if (performance.now() - begun >= capture.timeoutMs)
      controller.abort(Error('Project MP4 capture timed out.'));
    controller.signal.throwIfAborted();
  };
  const remaining = () => {
    active();
    return Math.max(1, Math.ceil(capture.timeoutMs - (performance.now() - begun)));
  };
  try {
    signal.addEventListener('abort', abort, { once: true });
    controller.signal.addEventListener('abort', reject, { once: true });
    if (signal.aborted) abort();
    active();
    timer = setTimeout(
      () => controller.abort(Error('Project MP4 capture timed out.')),
      remaining(),
    );
    const frames = remembered
      ? await Promise.race([
          prepareRememberedVideoProject(
            snapshot,
            'mp4',
            {
              range: capturedRange,
              bitrate: capture.bitrate,
              keyFrameInterval: capture.keyFrameInterval,
              maxBytes: capture.maxBytes,
            },
            { signal: controller.signal, validate: active },
          ),
          stopped,
        ])
      : snapshot;
    active();
    replay = await createVideoFrameReplay(
      frames,
      { start: capture.start, end: capture.end },
      { signal: controller.signal, timeoutMs: remaining(), validate: active },
    );
    active();
    const encoding = encodeAvcMp4(
      {
        width: capture.width,
        height: capture.height,
        frameCount: capture.count,
        rate: capture.rate,
        scale: capture.scale,
        bitrate: capture.bitrate,
        keyFrameInterval: capture.keyFrameInterval,
      },
      async (index) => {
        active();
        const image = await replay!.seek(capture.start + index);
        active();
        const result = progress?.(index + 1, capture.count) as unknown;
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          void Promise.resolve(result).catch(() => {});
          throw Error('Project MP4 progress must be synchronous.');
        }
        active();
        return new Uint8Array(image.data); // Cross-realm pixels become parent-owned bytes.
      },
      {
        signal: controller.signal,
        timeoutMs: remaining(),
        maxBytes: capture.maxBytes,
        validate: active,
      },
      native,
    );
    const complete = await Promise.race([encoding, stopped]);
    active();
    const result = Object.freeze({
      ...complete,
      start: capture.start,
      end: capture.end,
      remembered,
    });
    active();
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', reject);
    controller.abort();
    await replay?.dispose();
  }
}

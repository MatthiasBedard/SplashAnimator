import { validateProject, type Project } from '../../../packages/document/src';
import { prepareProjectAudio } from '../../../packages/audio/src/project-preview';
import { encodePcm16WavAsync } from '../../../packages/audio/src/wav-encode-async';
import { capturePNGSequenceFrames, type PNGFrameRange } from './export-png';
import { prepareRememberedPNGProject } from './remembered-png';
import { PNGArchive } from './png-archive';
import { ffmpegBundlePlan } from './ffmpeg-bundle-plan';

export interface FFmpegBundleOptions {
  range?: PNGFrameRange;
  scale?: number;
  transparent?: boolean;
  includeAudio?: boolean;
  remembered?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  audioChannels?: 1 | 2;
  validate?: () => void;
  progress?: (completed: number, total: number) => void;
}
export interface FFmpegBundleSink {
  write(chunk: Uint8Array, signal: AbortSignal): void | Promise<void>;
  abort(reason: unknown): void | Promise<void>;
}
/** Complete detached PNG/WAV input archive only. No subprocess or authored scripts execute. */
export async function exportFFmpegBundle(
  project: Project,
  load: ((path: string, signal: AbortSignal) => Promise<Blob>) | undefined,
  signal: AbortSignal,
  options: FFmpegBundleOptions = {},
) {
  const result = await prepareFFmpegBundle(project, load, signal, options);
  return { blob: result.blob!, manifest: result.manifest };
}
/** Serial bounded provisional bytes, never a joined archive. Success does not close
 * storage. Captured sink.abort is awaited on every failure; a sink must discard
 * provisional output and reject late writes after abort. Uncooperative cleanup
 * can delay rejection beyond the shared preparation/writing deadline. */
export async function exportFFmpegBundleToSink(
  project: Project,
  load: ((path: string, signal: AbortSignal) => Promise<Blob>) | undefined,
  signal: AbortSignal,
  sink: FFmpegBundleSink,
  options: FFmpegBundleOptions = {},
) {
  const abort = sink?.abort;
  if (typeof abort !== 'function') throw Error('Invalid FFmpeg bundle sink.');
  try {
    const write = sink.write;
    if (typeof write !== 'function') throw Error('Invalid FFmpeg bundle sink.');
    const result = await prepareFFmpegBundle(project, load, signal, options, (chunk, scope) =>
      Reflect.apply(write, sink, [chunk, scope]),
    );
    return Object.freeze({ ...result.receipt!, manifest: result.manifest });
  } catch (error) {
    try {
      await Reflect.apply(abort, sink, [error]);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'FFmpeg delivery and destination abort failed.');
    }
    throw error;
  }
}
async function prepareFFmpegBundle(
  project: Project,
  load: ((path: string, signal: AbortSignal) => Promise<Blob>) | undefined,
  signal: AbortSignal,
  options: FFmpegBundleOptions,
  write?: FFmpegBundleSink['write'],
) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Reflect.ownKeys(options).some(
      (key) =>
        ![
          'range',
          'scale',
          'transparent',
          'includeAudio',
          'remembered',
          'timeoutMs',
          'maxBytes',
          'audioChannels',
          'validate',
          'progress',
        ].includes(key as string),
    )
  )
    throw Error('Invalid FFmpeg bundle options.');
  const {
    range,
    scale = 1,
    transparent = false,
    includeAudio = false,
    remembered = false,
    timeoutMs = 60000,
    maxBytes = 512 * 1024 * 1024,
    audioChannels,
    validate,
    progress,
  } = options;
  const selected = range === undefined ? undefined : { start: range?.start, end: range?.end };
  if (
    (range !== undefined &&
      (!range ||
        typeof range !== 'object' ||
        Array.isArray(range) ||
        Reflect.ownKeys(range).some((key) => key !== 'start' && key !== 'end'))) ||
    typeof includeAudio !== 'boolean' ||
    typeof transparent !== 'boolean' ||
    typeof remembered !== 'boolean' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 22 ||
    maxBytes > 512 * 1024 * 1024 ||
    (audioChannels !== undefined && audioChannels !== 1 && audioChannels !== 2) ||
    (includeAudio && typeof load !== 'function') ||
    (load !== undefined && typeof load !== 'function') ||
    (validate !== undefined && typeof validate !== 'function') ||
    (progress !== undefined && typeof progress !== 'function')
  )
    throw Error('Invalid FFmpeg bundle options.');
  const controller = new AbortController(),
    begun = Date.now();
  const abort = () => controller.abort(signal.reason ?? Error('FFmpeg bundle cancelled.'));
  const active = () => {
    controller.signal.throwIfAborted();
    if (Date.now() - begun >= timeoutMs) controller.abort(Error('FFmpeg bundle timed out.'));
    controller.signal.throwIfAborted();
    const result = validate?.() as unknown;
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw Error('FFmpeg bundle validation must be synchronous.');
    }
    if (Date.now() - begun >= timeoutMs) controller.abort(Error('FFmpeg bundle timed out.'));
    controller.signal.throwIfAborted();
  };
  signal.throwIfAborted();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(Error('FFmpeg bundle timed out.')), timeoutMs);
  const wait = <T>(promise: Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const stop = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', stop, { once: true });
      promise.then(
        (value) => {
          controller.signal.removeEventListener('abort', stop);
          if (controller.signal.aborted) reject(controller.signal.reason);
          else resolve(value);
        },
        (error) => {
          controller.signal.removeEventListener('abort', stop);
          reject(error);
        },
      );
      if (controller.signal.aborted) stop();
    });
  const remaining = () => {
    active();
    return Math.max(1, timeoutMs - (Date.now() - begun));
  };
  try {
    if (signal.aborted) abort();
    active();
    const snapshot = validateProject(project);
    active();
    const plan = ffmpegBundlePlan(snapshot, selected, scale, transparent, includeAudio);
    active();
    if (includeAudio && !snapshot.audioClips?.length)
      throw Error('Project has no audio clips for this bundle.');
    let bytesWritten = 0,
      chunkCount = 0,
      expectedBytes = 0;
    const archive = new PNGArchive(
      maxBytes,
      write
        ? async (part) => {
            active();
            const size = part.size;
            if (!Number.isSafeInteger(size) || size < 1 || expectedBytes + size > maxBytes)
              throw Error('Invalid FFmpeg archive part receipt.');
            expectedBytes += size;
            for (let offset = 0; offset < size; offset += 65536) {
              active();
              const chunk = new Uint8Array(
                await wait(part.slice(offset, offset + 65536).arrayBuffer()),
              );
              active();
              const length = chunk.byteLength;
              if (length !== Math.min(65536, size - offset))
                throw Error('Incomplete FFmpeg archive part.');
              await wait(Promise.resolve(write(chunk, controller.signal)));
              active();
              bytesWritten += length;
              chunkCount++;
            }
          }
        : undefined,
    );
    let audio:
      | (NonNullable<typeof plan.audio> & {
          channels?: number;
          frames?: number;
          clippedSamples?: number;
          resampledAssets?: number;
        })
      | null = plan.audio;
    if (includeAudio) {
      const prepared = await wait(
        prepareProjectAudio(
          snapshot,
          async (path, jobSignal) => {
            active();
            const result = await load!(path, jobSignal);
            active();
            return result;
          },
          {
            signal: controller.signal,
            timeoutMs: remaining(),
            startFrame: plan.video.sourceStartFrame,
            endFrame: plan.video.sourceEndFrameExclusive,
            sampleRate: 48000,
            channelCount: audioChannels,
          },
        ),
      );
      active();
      if (
        prepared.startSample !== plan.audio!.start ||
        prepared.endSample !== plan.audio!.end ||
        prepared.channels.some((c) => c.length !== plan.audio!.end - plan.audio!.start)
      )
        throw Error('Prepared WAV timing changed.');
      const bytes = await wait(
        encodePcm16WavAsync(prepared.channels, 48000, {
          signal: controller.signal,
          timeoutMs: remaining(),
          maxBytes: Math.min(64 * 1024 * 1024, maxBytes),
        }),
      );
      active();
      await wait(
        archive.add(
          'audio.wav',
          new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }),
          controller.signal,
        ),
      );
      active();
      audio = {
        ...plan.audio!,
        channels: prepared.channels.length,
        frames: prepared.endSample - prepared.startSample,
        clippedSamples: prepared.clippedSamples,
        resampledAssets: prepared.resampling.assets,
      };
    }
    const capture = remembered
      ? await wait(
          prepareRememberedPNGProject(
            snapshot,
            { frame: 'sequence', range: selected, scale, sheet: false, padding: 0 },
            { signal: controller.signal, validate: active },
          ),
        )
      : snapshot;
    active();
    let next = plan.video.sourceStartFrame;
    await wait(
      capturePNGSequenceFrames(
        capture,
        async (frame, blob) => {
          active();
          if (
            frame !== next ||
            frame >= plan.video.sourceEndFrameExclusive ||
            !(blob instanceof Blob) ||
            !Number.isSafeInteger(blob.size) ||
            blob.size < 33 ||
            blob.size > maxBytes
          )
            throw Error('Invalid FFmpeg PNG frame.');
          const owned = Blob.prototype.slice.call(blob, 0, undefined, 'image/png');
          if (owned.size !== blob.size) throw Error('PNG frame metadata changed.');
          const header = new Uint8Array(await wait(owned.slice(0, 33).arrayBuffer()));
          active();
          const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
          if (
            header.length !== 33 ||
            ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => header[i] === v) ||
            view.getUint32(8) !== 13 ||
            view.getUint32(12) !== 0x49484452 ||
            view.getUint32(16) !== plan.video.width ||
            view.getUint32(20) !== plan.video.height
          )
            throw Error('FFmpeg PNG dimensions or header changed.');
          await wait(
            archive.add(
              `frame-${String(frame + 1).padStart(6, '0')}.png`,
              owned,
              controller.signal,
            ),
          );
          active();
          next++;
          const result = progress?.(
            next - plan.video.sourceStartFrame,
            plan.video.frameCount,
          ) as unknown;
          if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
            void Promise.resolve(result).catch(() => {});
            throw Error('FFmpeg bundle progress must be synchronous.');
          }
          active();
        },
        controller.signal,
        selected,
        transparent,
        scale,
        active,
      ),
    );
    active();
    if (next !== plan.video.sourceEndFrameExclusive)
      throw Error('Incomplete FFmpeg frame sequence.');
    const manifest = { ...plan, audio, remembered };
    await wait(
      archive.add(
        'ffmpeg.json',
        new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
        controller.signal,
      ),
    );
    active();
    const instructions =
      'Splash Animator FFmpeg input bundle\n\n' +
      plan.notice +
      '\n\nRun from the extracted folder with FFmpeg installed. ffmpeg.json lists separate argument tokens for an encoder integration.\n\nExample (interactive terminal, not a batch file):\nffmpeg ' +
      plan.suggestedArguments
        .map((v) => (/^[a-zA-Z0-9_./:%=-]+$/.test(v) ? v : JSON.stringify(v)))
        .join(' ') +
      '\n\nPNG files are exact integer timeline samples. Audio starts at the nearest absolute 48 kHz sample boundary for the first selected frame; ffmpeg.json records original start/end samples. No authored script source is included or executed.\n';
    await wait(
      archive.add(
        'README.txt',
        new Blob([instructions], { type: 'text/plain' }),
        controller.signal,
      ),
    );
    active();
    if (write) {
      await wait(archive.finishToSink(controller.signal));
      active();
      if (bytesWritten !== expectedBytes || bytesWritten < 22)
        throw Error('Incomplete FFmpeg sink receipt.');
      return { receipt: Object.freeze({ bytesWritten, chunkCount }), manifest, blob: undefined };
    }
    const blob = archive.finish();
    active();
    return { blob, manifest, receipt: undefined };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}

import { compressedImportSampleRate, type CompressedAudioAdmission } from './compressed-audio-admission';
import type { CompressedAudioFormat } from './import-formats';
import { encodePcm16WavAsync } from './wav-encode-async';

function preflight(buffer: ArrayBuffer, format: CompressedAudioFormat, maxPcmBytes: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const size = buffer.byteLength;
  return new Promise<{ buffer: ArrayBuffer; admission: CompressedAudioAdmission }>((resolve, reject) => {
    let worker: Worker | undefined;
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      worker?.terminate();
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const abort = () => fail(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    try {
      worker = new Worker(new URL('./compressed-audio-worker.ts', import.meta.url), {
        type: 'module', name: 'Splash compressed audio preflight',
      });
      worker.onerror = event => { event.preventDefault(); fail(Error('Audio import preflight failed.')); };
      worker.onmessageerror = () => fail(Error('Unreadable audio import preflight response.'));
      worker.onmessage = event => {
        try {
          signal.throwIfAborted();
          const response = event.data, result = response?.admission as CompressedAudioAdmission | undefined;
          if (typeof response?.error === 'string') throw Error(response.error);
          if (!(response?.buffer instanceof ArrayBuffer) || response.buffer.byteLength !== size ||
              !result || (result.channels !== 1 && result.channels !== 2) ||
              !Number.isSafeInteger(result.maxFrames) || result.maxFrames < 1 ||
              result.maxFrames * result.channels * 4 > maxPcmBytes ||
              result.maxFrames * result.channels * 2 + 44 > 64 * 1024 * 1024 ||
              (format === 'opus' && result.exactFrames !== result.maxFrames))
            throw Error('Invalid audio import preflight response.');
          cleanup();
          resolve({ buffer: response.buffer, admission: result });
        } catch (error) { fail(error); }
      };
      signal.throwIfAborted();
      worker.postMessage({ buffer, format, maxPcmBytes }, [buffer]);
    } catch (error) { fail(error); }
  });
}

// Web Audio owns an asynchronous native decode. It has no cancellation API.
// Retain a single slot until it settles even if the import is already cancelled.
let nativeDecodePending = false;
async function decodeAudio(buffer: ArrayBuffer, format: CompressedAudioFormat) {
  if (nativeDecodePending) throw Error('An audio decode is still finishing. Try again shortly.');
  if (typeof OfflineAudioContext !== 'function') throw Error('This editor does not provide a compressed audio decoder.');
  nativeDecodePending = true;
  try {
    return await new OfflineAudioContext(1, 1, compressedImportSampleRate).decodeAudioData(buffer);
  } catch (cause) {
    throw Error(`The editor could not decode this ${format === 'mp3' ? 'MP3' : 'Ogg Opus'} file.`, { cause });
  } finally { nativeDecodePending = false; }
}

/** A worker admits the encoded envelope before the native decoder can allocate PCM. */
export async function transcodeCompressedAudio(
  input: ArrayBuffer,
  format: CompressedAudioFormat,
  maxPcmBytes: number,
  deadline: number,
  signal: AbortSignal,
) {
  const { buffer, admission } = await preflight(input, format, maxPcmBytes, signal);
  signal.throwIfAborted();
  const audio = await decodeAudio(buffer, format);
  signal.throwIfAborted();
  const { numberOfChannels, sampleRate, length: frames } = audio;
  if (numberOfChannels !== admission.channels || sampleRate !== compressedImportSampleRate ||
      !Number.isSafeInteger(frames) || frames < 1 || frames > admission.maxFrames ||
      (admission.exactFrames !== undefined && frames !== admission.exactFrames))
    throw Error('Decoded audio does not match the admitted channel count or sample range.');
  const timeoutMs = deadline - Date.now();
  if (timeoutMs < 1) throw Error('Audio import timed out.');
  const channels = Array.from({ length: numberOfChannels }, (_, index) => audio.getChannelData(index));
  const wav = await encodePcm16WavAsync(channels, sampleRate, { signal, timeoutMs, clampDecoded: true });
  return { payload: new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), sampleRate, channels: admission.channels, frames };
}

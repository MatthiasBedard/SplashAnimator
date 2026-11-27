import { inspectCompressedAudio } from './compressed-audio-admission';
import type { CompressedAudioFormat } from './import-formats';

self.onmessage = event => {
  self.onmessage = null;
  try {
    const { buffer, format, maxPcmBytes } = event.data as {
      buffer: ArrayBuffer; format: CompressedAudioFormat; maxPcmBytes: number;
    };
    const admission = inspectCompressedAudio(new Uint8Array(buffer), format, maxPcmBytes);
    self.postMessage({ admission, buffer }, { transfer: [buffer] });
  } catch (error) { self.postMessage({ error: String(error).slice(0, 2000) }); }
};

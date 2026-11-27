import { prepareProjectAudio } from '../../../packages/audio/src/project-preview';
import { encodePcm16WavAsync } from '../../../packages/audio/src/wav-encode-async';
import type { Project } from '../../../packages/document/src';
import { encodeOggOpus } from '../../../packages/export-video/src/ogg-opus';
import { replayWaveByteLimit } from '../../../packages/export-web/src/replay-wave';
import type { HTMLSoundtrack } from '../../../packages/export-web/src/html-soundtrack';

export async function prepareHTMLSoundtrack(
  project: Project,
  format: HTMLSoundtrack['format'],
  load: (path: string, signal: AbortSignal) => Promise<Blob>,
  signal: AbortSignal,
): Promise<HTMLSoundtrack> {
  if (format !== 'wav' && format !== 'opus') throw Error('Invalid HTML audio format.');
  const deadline = Date.now() + 60_000;
  const referenced = new Set(project.audioClips?.map(clip => clip.assetId));
  const channelCount = project.assets.some(asset => referenced.has(asset.id) && asset.audio?.channels === 2) ? 2 : 1;
  const mixed = await prepareProjectAudio(project, load, {
    signal, timeoutMs: 60_000, sampleRate: 48_000, channelCount,
  });
  signal.throwIfAborted();
  const timeoutMs = deadline - Date.now();
  if (timeoutMs < 1) throw Error('HTML audio export timed out.');
  const options = { signal, timeoutMs, maxBytes: replayWaveByteLimit };
  const bytes = format === 'wav'
    ? await encodePcm16WavAsync(mixed.channels, mixed.sampleRate, options)
    : await encodeOggOpus(mixed.channels, options);
  signal.throwIfAborted();
  return { format, bytes };
}

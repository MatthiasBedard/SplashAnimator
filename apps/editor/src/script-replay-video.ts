import type { Project } from '@splash/document';
import type { PresentationPose } from '../../../packages/export-web/src';
import type { ReplayTextChange } from '../../../packages/export-web/src/replay-text';
import { audioSampleRange } from '../../../packages/audio/src/pcm';
import { decodePcm16Wav } from '../../../packages/audio/src/wav';
import { encodeAvWebm } from '../../../packages/export-video/src/av-webm';
import { openVp8Encoder } from '../../../packages/export-video/src/vp8';
import { withScriptReplayFrames } from './script-artwork';
import { compileScriptArtwork } from './script-artwork-compile';
import { videoCaptureSettings } from './video-settings';

export async function encodeScriptReplayVideo(
  project: Project,
  poses: readonly PresentationPose[],
  replayText: readonly ReplayTextChange[],
  wave: Uint8Array | undefined,
  signal: AbortSignal,
  validate: () => void,
) {
  const settings = videoCaptureSettings({ ...project, duration: poses.length }, 'webm');
  const active = () => { signal.throwIfAborted(); validate(); signal.throwIfAborted(); };
  active();
  const sound = wave && decodePcm16Wav(wave);
  const expected = audioSampleRange(0, settings.count, project.fps, 48000).end;
  if (sound && (sound.sampleRate !== 48000 || sound.frames !== expected))
    throw Error('Recorded video sound does not match the replay tick range.');

  const html = await compileScriptArtwork(project, poses, { signal, replayCapture: true, replayText });
  active();
  const bytes = await withScriptReplayFrames(html, signal, async canvas => {
    const { width, height, count: frameCount, rate, scale, bitrate } = settings;
    const context = canvas.getContext('2d');
    if (!context || canvas.width !== width || canvas.height !== height || canvas.dataset.capture !== 'waiting')
      throw Error('Recorded video renderer is unavailable.');
    const frame = (index: number) => {
      active();
      canvas.dispatchEvent(new Event('capture-next'));
      const expectedState = index === frameCount - 1 ? 'ready' : 'playing';
      if (canvas.dataset.tick !== String(index) || canvas.dataset.capture !== expectedState)
        throw Error('Recorded video tick was not rendered.');
      const pixels = context.getImageData(0, 0, width, height);
      active();
      // The renderer is in a different realm. The encoder owns a local buffer.
      return new Uint8Array(pixels.data);
    };
    const timing = { width, height, frameCount, rate, scale, bitrate };
    if (sound) {
      const receipt = await encodeAvWebm(timing, sound.channels, 128000, frame, { signal, timeoutMs: 60000 });
      return receipt.bytes;
    }
    const encoder = openVp8Encoder({ ...timing, container: 'webm' }, { signal, timeoutMs: 60000 });
    try {
      for (let index = 0; index < frameCount; index++) await encoder.append(frame(index));
      active();
      return encoder.finish().bytes;
    } finally { encoder.dispose(); }
  });
  active();
  if (!(bytes.buffer instanceof ArrayBuffer)) throw Error('Recorded video bytes are unavailable.');
  return new Blob([new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)], { type: 'video/webm' });
}

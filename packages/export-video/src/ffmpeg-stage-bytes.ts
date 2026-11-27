import { audioSampleRange } from '../../audio/src/pcm';
import type { FFmpegProcessSettings } from './ffmpeg-process';
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** Structural still-PNG admission. Compressed pixels/color fidelity are not decoded. */
export function inspectFFmpegPNG(bytes: Uint8Array, width: number, height: number) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 57 || signature.some((b, i) => bytes[i] !== b))
    throw Error('Invalid staged PNG signature.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8,
    header = false,
    palette = false,
    data = 0,
    seenData = false,
    endedData = false,
    ended = false,
    color = 0,
    depth = 0;
  while (at < bytes.length) {
    if (at + 12 > bytes.length) throw Error('Truncated staged PNG chunk.');
    const n = view.getUint32(at),
      end = at + 12 + n,
      type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (
      n > 0x7fffffff ||
      end > bytes.length ||
      !/^\w{4}$/.test(type) ||
      !/[A-Z]/.test(type[2]) ||
      !/^[A-Za-z]{4}$/.test(type)
    )
      throw Error('Invalid staged PNG chunk.');
    let crc = 0xffffffff;
    for (let i = at + 4; i < end - 4; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(end - 4))
      throw Error('Staged PNG CRC changed.');
    if (!header && type !== 'IHDR') throw Error('Staged PNG requires its original IHDR first.');
    if (type === 'IHDR') {
      if (
        header ||
        n !== 13 ||
        view.getUint32(at + 8) !== width ||
        view.getUint32(at + 12) !== height
      )
        throw Error('Staged PNG dimensions/header changed.');
      depth = bytes[at + 16];
      color = bytes[at + 17];
      const allowed: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !allowed[color]?.includes(depth) ||
        bytes[at + 18] !== 0 ||
        bytes[at + 19] !== 0 ||
        bytes[at + 20] > 1
      )
        throw Error('Unsupported staged PNG IHDR.');
      header = true;
    } else if (type === 'PLTE') {
      if (
        palette ||
        seenData ||
        n === 0 ||
        n % 3 ||
        n > 768 ||
        color === 0 ||
        color === 4 ||
        (color === 3 && n / 3 > 2 ** depth)
      )
        throw Error('Invalid staged PNG palette.');
      palette = true;
    } else if (type === 'IDAT') {
      if (endedData || (color === 3 && !palette))
        throw Error('Invalid staged PNG image-data ordering.');
      data += n;
      seenData = true;
    } else if (type === 'IEND') {
      if (n !== 0 || data === 0 || end !== bytes.length) throw Error('Incomplete staged PNG tail.');
      ended = true;
    } else {
      if (['acTL', 'fcTL', 'fdAT'].includes(type))
        throw Error('Staging requires still PNG frames, not APNG.');
      if (type[0] === type[0].toUpperCase()) throw Error('Unknown staged PNG critical chunk.');
      if (seenData) endedData = true;
    }
    at = end;
    if (ended) break;
  }
  if (!header || !ended) throw Error('Incomplete staged PNG input.');
}
/** Exact canonical PCM16 output of the existing WAV encoder, not a WAV importer.
 * Unknown chunks/encodings reject explicitly; no planar PCM allocation is needed. */
export function inspectFFmpegWAV(bytes: Uint8Array, settings: FFmpegProcessSettings) {
  if (bytes.length < 44) throw Error('Incomplete prepared WAV.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  const channels = view.getUint16(22, true),
    frames = (bytes.length - 44) / (channels * 2),
    range = audioSampleRange(
      settings.firstNumber - 1,
      settings.firstNumber - 1 + settings.frameCount,
      settings.rate / settings.scale,
      48000,
    );
  if (
    text(0) !== 'RIFF' ||
    view.getUint32(4, true) !== bytes.length - 8 ||
    text(8) !== 'WAVE' ||
    text(12) !== 'fmt ' ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    (channels !== 1 && channels !== 2) ||
    view.getUint32(24, true) !== 48000 ||
    view.getUint32(28, true) !== 48000 * channels * 2 ||
    view.getUint16(32, true) !== channels * 2 ||
    view.getUint16(34, true) !== 16 ||
    text(36) !== 'data' ||
    view.getUint32(40, true) !== bytes.length - 44 ||
    !Number.isSafeInteger(frames) ||
    frames !== range.end - range.start ||
    frames * channels * 4 > 128 * 1024 * 1024
  )
    throw Error('Prepared WAV format, original sample range or PCM budget changed.');
  return { channels, frames, startSample: range.start, endSample: range.end };
}

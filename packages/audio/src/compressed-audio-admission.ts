import type { CompressedAudioFormat } from './import-formats';

export const compressedImportSampleRate = 48_000;
export interface CompressedAudioAdmission {
  channels: 1 | 2;
  maxFrames: number;
  exactFrames?: number;
}

const wavByteLimit = 64 * 1024 * 1024;
const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const matches = (bytes: Uint8Array, at: number, text: string) =>
  at >= 0 && at + text.length <= bytes.length && [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));

function frameBudget(frames: number, channels: number, maxPcmBytes: number) {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames * channels * 4 > maxPcmBytes ||
      frames * channels * 2 + 44 > wavByteLimit) throw Error('Decoded audio exceeds the project PCM or WAV byte budget.');
}

function inspectMp3(bytes: Uint8Array, maxPcmBytes: number): CompressedAudioAdmission {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0, end = bytes.length;
  if (matches(bytes, end - 128, 'TAG')) end -= 128;
  if (matches(bytes, at, 'ID3')) {
    if (end < 10 || bytes[3] < 2 || bytes[3] > 4 || bytes.subarray(6, 10).some(n => n >= 128))
      throw Error('Invalid MP3 ID3 header.');
    at = 10 + (((bytes[6] * 128 + bytes[7]) * 128 + bytes[8]) * 128 + bytes[9]);
    if (bytes[3] === 4 && bytes[5] & 16) at += 10;
  }
  let channels: 1 | 2 = 1, sampleRate = 0, frames = 0, packets = 0, declared = 0;
  while (at + 4 <= end) {
    const header = view.getUint32(at);
    const version = (header >>> 19) & 3, rateIndex = (header >>> 10) & 3;
    const bitrateIndex = (header >>> 12) & 15, mpeg1 = version === 3;
    if (header >>> 21 !== 0x7ff || ((header >>> 17) & 3) !== 1 ||
        version === 1 || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15)
      throw Error('Invalid or unsupported MP3 frame header.');
    const rate = [44100, 48000, 32000][rateIndex] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
    const count = ((header >>> 6) & 3) === 3 ? 1 : 2;
    const bitrate = (mpeg1 ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex];
    const length = Math.floor((mpeg1 ? 144000 : 72000) * bitrate / rate) + ((header >>> 9) & 1);
    if (at + length > end) throw Error('Truncated MP3 frame.');
    if (!packets) {
      channels = count;
      sampleRate = rate;
      const info = at + 4 + ((header >>> 16) & 1 ? 0 : 2) + (mpeg1 ? count === 1 ? 17 : 32 : count === 1 ? 9 : 17);
      if (info + 12 <= at + length && (matches(bytes, info, 'Xing') || matches(bytes, info, 'Info')) &&
          view.getUint32(info + 4) & 1) declared = view.getUint32(info + 8);
      const vbri = at + 36;
      if (vbri + 18 <= at + length && matches(bytes, vbri, 'VBRI')) declared = Math.max(declared, view.getUint32(vbri + 14));
    } else if (sampleRate !== rate || channels !== count) {
      throw Error('MP3 sample rate or channel count changes within the file.');
    }
    frames += mpeg1 ? 1152 : 576;
    packets++;
    at += length;
  }
  if (!packets || at !== end || declared > packets) throw Error('Invalid or incomplete MP3 stream.');
  const maxFrames = Math.ceil(frames * compressedImportSampleRate / sampleRate);
  frameBudget(maxFrames, channels, maxPcmBytes);
  return { channels, maxFrames };
}

function opusDuration(first: number, second: number, size: number) {
  const config = first >> 3, code = first & 3;
  const frame = config < 12 ? [480, 960, 1920, 2880][config & 3]
    : config < 16 ? [480, 960][config & 1] : [120, 240, 480, 960][config & 3];
  const count = code === 0 ? 1 : code < 3 ? 2 : size >= 2 ? second & 63 : 0;
  if (!size || !count || count * frame > 5760) throw Error('Invalid Opus packet duration.');
  return count * frame;
}

function inspectOpus(bytes: Uint8Array, maxPcmBytes: number): CompressedAudioAdmission {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0, serial = 0, page = 0, ended = false, packet = 0, size = 0;
  // Only the identification bytes and packet TOC are needed for preflight.
  const prefix = new Uint8Array(19);
  let channels: 1 | 2 = 1, preSkip = 0, total = 0, granule = 0, lastPacket = 0;
  while (at < bytes.length) {
    if (ended || at + 27 > bytes.length || !matches(bytes, at, 'OggS') || bytes[at + 4] !== 0)
      throw Error('Invalid Ogg Opus stream.');
    const flags = bytes[at + 5], laces = bytes[at + 26], first = at + 27;
    const nextGranule = view.getBigInt64(at + 6, true);
    const stream = view.getUint32(at + 14, true);
    if (page === 0) serial = stream;
    if (first + laces > bytes.length || stream !== serial || view.getUint32(at + 18, true) !== page ||
        flags > 7 || !!(flags & 2) !== (page === 0) || !!(flags & 1) !== (size > 0))
      throw Error('Invalid, chained, or multiplexed Ogg Opus stream.');
    ended = !!(flags & 4);
    let body = first + laces;
    const firstPacket = packet;
    for (let i = 0; i < laces; i++) {
      const length = bytes[first + i];
      if (body + length > bytes.length) throw Error('Truncated Ogg Opus page.');
      if (size < prefix.length) prefix.set(bytes.subarray(body, body + Math.min(length, prefix.length - size)), size);
      size += length;
      body += length;
      if (length === 255) continue;
      if (packet === 0) {
        if (size !== 19 || !matches(prefix, 0, 'OpusHead') || prefix[8] !== 1 ||
            (prefix[9] !== 1 && prefix[9] !== 2) || prefix[18] !== 0)
          throw Error('Ogg import requires mono or stereo Opus audio.');
        channels = prefix[9];
        preSkip = prefix[10] + 256 * prefix[11];
      } else if (packet === 1) {
        if (size < 16 || !matches(prefix, 0, 'OpusTags')) throw Error('Missing Ogg Opus tags.');
      } else {
        lastPacket = opusDuration(prefix[0], prefix[1], size);
        total += lastPacket;
        // Bound decoding of all packets, including priming and padding.
        if ((total - preSkip - 5760) * channels * 4 > maxPcmBytes)
          throw Error('Decoded Opus exceeds the project PCM budget.');
      }
      packet++;
      size = 0;
    }
    const completedAudio = packet > Math.max(firstPacket, 2);
    if (completedAudio) {
      if (nextGranule < BigInt(granule) || nextGranule > BigInt(total) ||
          nextGranule !== BigInt(total) && (!ended || nextGranule <= BigInt(total - lastPacket)))
        throw Error('Invalid Opus sample positions or end trim.');
      granule = Number(nextGranule);
    } else if (nextGranule !== BigInt(packet > firstPacket ? 0 : -1)) {
      throw Error('Invalid Ogg Opus header or continuation position.');
    }
    if (page === 0 && (packet !== 1 || size || ended)) throw Error('Invalid Ogg Opus identification page.');
    page++;
    at = body;
  }
  if (!ended || size || packet < 3 || granule <= preSkip) throw Error('Incomplete Ogg Opus stream.');
  const exactFrames = granule - preSkip;
  frameBudget(exactFrames, channels, maxPcmBytes);
  return { channels, maxFrames: exactFrames, exactFrames };
}

export function inspectCompressedAudio(bytes: Uint8Array, format: CompressedAudioFormat, maxPcmBytes: number) {
  if (bytes.length < 12 || bytes.length > wavByteLimit) throw Error('Compressed audio exceeds the input byte limit.');
  return format === 'mp3' ? inspectMp3(bytes, maxPcmBytes) : inspectOpus(bytes, maxPcmBytes);
}

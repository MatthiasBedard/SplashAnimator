import { expect, it } from 'vitest';
import {
  inspectFFmpegPNG,
  inspectFFmpegWAV,
} from '../packages/export-video/src/ffmpeg-stage-bytes';
import { pcm16WavFixture } from './wav-fixture';
import { joinBytes, png, pngChunk, pngHeader, pngSignature } from './ffmpeg-stage-fixture';
const settings = {
  width: 2,
  height: 2,
  firstNumber: 2,
  frameCount: 3,
  rate: 30000,
  scale: 1001,
  audio: true,
};
const idat = () => pngChunk('IDAT', new Uint8Array([1]));
it('admits native-CRC still PNG bytes without changing them', () => {
  const bytes = png(),
    before = bytes.slice();
  inspectFFmpegPNG(bytes, 2, 2);
  expect(bytes).toEqual(before);
  inspectFFmpegPNG(
    joinBytes(
      pngSignature,
      pngHeader(),
      pngChunk('tEXt', Buffer.from('key\0value')),
      idat(),
      pngChunk('IDAT'),
      pngChunk('IEND'),
    ),
    2,
    2,
  );
});
for (const [name, bytes] of [
  ['signature', new Uint8Array(70)],
  ['truncated', png().slice(0, -1)],
  ['trailing', joinBytes(png(), new Uint8Array([0]))],
  ['missing header', joinBytes(pngSignature, idat(), pngChunk('IEND'))],
  ['duplicate header', joinBytes(pngSignature, pngHeader(), pngHeader(), idat(), pngChunk('IEND'))],
  ['wrong dimensions', joinBytes(pngSignature, pngHeader(3), idat(), pngChunk('IEND'))],
  ['illegal color depth', joinBytes(pngSignature, pngHeader(2, 2, 6, 1), idat(), pngChunk('IEND'))],
  [
    'illegal interlace',
    joinBytes(pngSignature, pngHeader(2, 2, 6, 8, 2), idat(), pngChunk('IEND')),
  ],
  [
    'unknown critical',
    joinBytes(pngSignature, pngHeader(), pngChunk('ABCD'), idat(), pngChunk('IEND')),
  ],
  [
    'reserved bit',
    joinBytes(pngSignature, pngHeader(), pngChunk('abcd'), idat(), pngChunk('IEND')),
  ],
  ['empty data', joinBytes(pngSignature, pngHeader(), pngChunk('IDAT'), pngChunk('IEND'))],
  [
    'split data',
    joinBytes(pngSignature, pngHeader(), idat(), pngChunk('tEXt'), idat(), pngChunk('IEND')),
  ],
  [
    'empty data still owns ordering',
    joinBytes(
      pngSignature,
      pngHeader(),
      pngChunk('IDAT'),
      pngChunk('tEXt'),
      idat(),
      pngChunk('IEND'),
    ),
  ],
  [
    'tail body',
    joinBytes(pngSignature, pngHeader(), idat(), pngChunk('IEND', new Uint8Array([1]))),
  ],
  [
    'indexed missing palette',
    joinBytes(pngSignature, pngHeader(2, 2, 3), idat(), pngChunk('IEND')),
  ],
  [
    'late palette',
    joinBytes(
      pngSignature,
      pngHeader(),
      pngChunk('IDAT'),
      pngChunk('PLTE', new Uint8Array(3)),
      idat(),
      pngChunk('IEND'),
    ),
  ],
  [
    'gray palette',
    joinBytes(
      pngSignature,
      pngHeader(2, 2, 0),
      pngChunk('PLTE', new Uint8Array(3)),
      idat(),
      pngChunk('IEND'),
    ),
  ],
  [
    'oversized indexed palette',
    joinBytes(
      pngSignature,
      pngHeader(2, 2, 3, 1),
      pngChunk('PLTE', new Uint8Array(9)),
      idat(),
      pngChunk('IEND'),
    ),
  ],
  ...['acTL', 'fcTL', 'fdAT'].map(
    (type) =>
      [
        type,
        joinBytes(pngSignature, pngHeader(), pngChunk(type), idat(), pngChunk('IEND')),
      ] as const,
  ),
] as const)
  it(`rejects malformed/unsupported PNG ${name}`, () =>
    expect(() => inspectFFmpegPNG(bytes, 2, 2)).toThrow());
it('rejects CRC corruption and oversized/truncated chunk lengths', () => {
  const bytes = png();
  bytes[45] ^= 1;
  expect(() => inspectFFmpegPNG(bytes, 2, 2)).toThrow(/CRC/);
  for (const n of [0x7fffffff, 0x80000000, 0xffffffff]) {
    const bytes = png();
    new DataView(bytes.buffer).setUint32(33, n);
    expect(() => inspectFFmpegPNG(bytes, 2, 2)).toThrow();
  }
});
it('admits legal indexed palette and structural interlace without claiming decoding', () => {
  inspectFFmpegPNG(
    joinBytes(
      pngSignature,
      pngHeader(2, 2, 3, 1),
      pngChunk('PLTE', new Uint8Array(6)),
      idat(),
      pngChunk('IEND'),
    ),
    2,
    2,
  );
  inspectFFmpegPNG(
    joinBytes(pngSignature, pngHeader(2, 2, 6, 8, 1), idat(), pngChunk('IEND')),
    2,
    2,
  );
});
for (const channels of [1, 2])
  it(`admits exact ${channels}-channel rational-range canonical WAV`, () => {
    // Absolute rational endpoints: round(4*48000*1001/30000)-round(48000*1001/30000)=4804.
    const bytes = pcm16WavFixture(
        Array.from({ length: channels }, () => Array(4804).fill(123)),
        48000,
      ),
      before = bytes.slice();
    expect(inspectFFmpegWAV(bytes, settings)).toEqual({
      channels,
      frames: 4804,
      startSample: 1602,
      endSample: 6406,
    });
    expect(bytes).toEqual(before);
  });
for (const at of [0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40])
  it(`rejects changed canonical WAV field ${at}`, () => {
    const bytes = pcm16WavFixture([Array(4804).fill(0)], 48000);
    bytes[at] ^= 1;
    expect(() => inspectFFmpegWAV(bytes, settings)).toThrow();
  });
for (const [name, bytes] of [
  ['short', new Uint8Array(43)],
  ['short range', pcm16WavFixture([Array(4803).fill(0)], 48000)],
  ['long range', pcm16WavFixture([Array(4805).fill(0)], 48000)],
  ['wrong rate', pcm16WavFixture([Array(4804).fill(0)], 44100)],
  ['unknown chunk', pcm16WavFixture([Array(4804).fill(0)], 48000, true)],
  ['data first', pcm16WavFixture([Array(4804).fill(0)], 48000, false, true)],
] as const)
  it(`rejects ${name} prepared WAV`, () =>
    expect(() => inspectFFmpegWAV(bytes, settings)).toThrow());

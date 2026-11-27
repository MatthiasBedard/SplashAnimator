import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectCompressedAudio } from '../packages/audio/src/compressed-audio-admission';
import { audioImportFormat } from '../packages/audio/src/import-formats';

const budget = 128 * 1024 * 1024;
const mp3 = Uint8Array.from(readFileSync(new URL('./fixtures/import-tone.mp3', import.meta.url)));
const opus = Uint8Array.from(readFileSync(new URL('./fixtures/import-tone.opus', import.meta.url)));

describe('compressed audio admission', () => {
  it('routes extensions without treating arbitrary Ogg data as Opus', () => {
    expect(['test.WAV', 'test.MP3', 'test.Opus', 'test.ogg', 'test.oga', 'test.png'].map(audioImportFormat))
      .toEqual(['wav', 'mp3', 'opus', 'opus', 'opus', undefined]);
    const wrongCodec = opus.slice();
    wrongCodec[28] = 0;
    expect(() => inspectCompressedAudio(wrongCodec, 'opus', budget)).toThrow(/Opus audio/);
  });
  it('bounds variable bitrate MP3 and rejects truncated or mismatched files', () => {
    const result = inspectCompressedAudio(mp3, 'mp3', budget);
    expect(result.channels).toBe(1);
    expect(result.maxFrames).toBeGreaterThan(11520);
    expect(() => inspectCompressedAudio(mp3, 'mp3', result.maxFrames * 4 - 1)).toThrow(/budget/);
    expect(() => inspectCompressedAudio(mp3.subarray(0, mp3.length - 1), 'mp3', budget)).toThrow(/Truncated/);
    expect(() => inspectCompressedAudio(opus, 'mp3', budget)).toThrow(/MP3/);
  });
  it('admits exact Opus granule timing and rejects truncated or chained streams', () => {
    expect(inspectCompressedAudio(opus, 'opus', budget)).toEqual({ channels: 2, maxFrames: 11520, exactFrames: 11520 });
    expect(() => inspectCompressedAudio(opus, 'opus', 11520 * 8 - 1)).toThrow(/budget/);
    expect(() => inspectCompressedAudio(opus.subarray(0, opus.length - 1), 'opus', budget)).toThrow(/Truncated/);
    const chained = new Uint8Array(opus.length * 2);
    chained.set(opus); chained.set(opus, opus.length);
    expect(() => inspectCompressedAudio(chained, 'opus', budget)).toThrow(/Ogg Opus/);
    expect(() => inspectCompressedAudio(mp3, 'opus', budget)).toThrow(/Ogg Opus/);
  });
});

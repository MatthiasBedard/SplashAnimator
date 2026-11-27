export type CompressedAudioFormat = 'mp3' | 'opus';
export const audioImportAccept = '.wav,.mp3,.opus,.ogg,.oga,audio/wav,audio/mpeg,audio/opus,audio/ogg';

export function audioImportFormat(name: string): 'wav' | CompressedAudioFormat | undefined {
  if (/\.wav$/i.test(name)) return 'wav';
  if (/\.mp3$/i.test(name)) return 'mp3';
  if (/\.(?:opus|ogg|oga)$/i.test(name)) return 'opus';
  return undefined;
}

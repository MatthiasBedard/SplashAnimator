declare module 'bidi-js' {
  export type BidiLevels = {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  };
  export default function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): BidiLevels;
    getReorderedIndices(text: string, levels: BidiLevels, start?: number, end?: number): number[];
    getBidiCharTypeName(char: string): string;
  };
}

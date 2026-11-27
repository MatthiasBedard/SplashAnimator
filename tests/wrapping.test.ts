import { describe, it, expect } from 'vitest';
import { wrapText } from '../packages/geometry/src/text-layout';
describe('shared text wrapping', () => {
  it('wraps words while retaining explicit blank lines and original content', () => {
    const text = 'one two three\n\nfour';
    expect(wrapText(text, 7, (s) => s.length)).toEqual(['one two', 'three', '', 'four']);
    expect(wrapText(text, 0, (s) => s.length)).toEqual(text.split('\n'));
    expect(wrapText('one ', 3, (s) => s.length)).toEqual(['one']);
  });
  it('splits oversized words at grapheme boundaries, even for narrow boxes', () => {
    expect(wrapText('abcdef', 2, (s) => s.length)).toEqual(['ab', 'cd', 'ef']);
    expect(wrapText('a\u0301😀', 1, (s) => s.length)).toEqual(['a\u0301', '😀']);
  });
  it('uses measured letter spacing instead of a fixed character count', () => {
    expect(wrapText('a a a', 5, (s) => s.length * 2)).toEqual(['a', 'a', 'a']);
  });
});

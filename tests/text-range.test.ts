import { it, expect } from 'vitest';
import { textRange, editTextRange } from '../packages/geometry/src/text-range';
it('expands DOM selections across emoji and combining graphemes', () => {
  const value = 'A👩‍👩‍👧‍👦e\u0301Z';
  expect(textRange(value, 2, 4)).toEqual({ start: 1, end: 12 });
  expect(editTextRange(value, 13, 14, 'delete').content).toBe('A👩‍👩‍👧‍👦Z');
  expect(textRange(value, 2, 2)).toEqual({ start: 2, end: 2 });
});
it('tracks length-changing case mappings and retains untouched text', () => {
  expect(editTextRange('A straße Z', 2, 8, 'uppercase')).toEqual({
    content: 'A STRASSE Z',
    start: 2,
    end: 9,
  });
  expect(editTextRange('A XYZ Z', 2, 5, 'lowercase').content).toBe('A xyz Z');
  expect(editTextRange('A xyz Z', 2, 5, 'duplicate')).toEqual({
    content: 'A xyzxyz Z',
    start: 2,
    end: 8,
  });
});
it('rejects invalid offsets and oversized edits atomically', () => {
  expect(() => textRange('abc', -1, 2)).toThrow();
  expect(() => textRange('abc', 2, 1)).toThrow();
  expect(() => textRange('abc', 1.5, 2)).toThrow();
  expect(() => editTextRange('x'.repeat(6000), 0, 6000, 'duplicate')).toThrow('10,000');
});

import { expect, test } from 'vitest';
import { catalogFontFamilies, describeFontStack } from '../apps/editor/src/font-catalog';
import { fontFamilyForRendering } from '../packages/geometry/src/font-family';

test('deduplicates faces by family and lists only valid saved choices', () => {
  expect(catalogFontFamilies([
    { family: 'Open Sans' }, { family: 'open sans' }, { family: ' Arial ' },
    { family: 'monospace' }, { family: 'bad/font' }, { family: '   ' },
  ])).toEqual(['Arial', 'Open Sans']);
});

test('quotes named families and supplies a default without changing the authored stack', () => {
  const stack = ' Missing Font 123, , Open Sans ,, ';
  expect(fontFamilyForRendering(stack)).toBe('"Missing Font 123", "Open Sans", sans-serif');
  expect(fontFamilyForRendering('Missing Font 123, MONOSPACE')).toBe('"Missing Font 123", monospace');
  expect(fontFamilyForRendering(',, ')).toBe('sans-serif');
});

test('reports missing families and the first matching fallback without changing the stack', () => {
  const stack = ' Missing Example, aRiAl, monospace ';
  expect(describeFontStack(stack, ['Arial'])).toEqual({ missing: ['Missing Example'], matched: 'aRiAl' });
  expect(describeFontStack('Missing Example, monospace', [])).toEqual({
    missing: ['Missing Example'], matched: 'monospace',
  });
  expect(describeFontStack('Missing Example', [])).toEqual({ missing: ['Missing Example'], matched: undefined });
});

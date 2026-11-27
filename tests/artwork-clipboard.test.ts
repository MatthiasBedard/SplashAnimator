import { expect, it } from 'vitest';
import type { Vector } from '../packages/document/src';
import { decodeClipboardArtwork, encodeClipboardArtwork, MAX_ARTWORK_CLIPBOARD_CHARS } from '../apps/editor/src/artwork-clipboard';

const rectangle: Vector = {
  id: 'source', kind: 'rectangle', x: 15, y: 20, width: 80, height: 45, rotation: 10,
  fill: '#b00000', stroke: '#000000', strokeWidth: 1,
  points: [], groups: ['unit'], transform: [-1, 0.25, 0.5, 1], opacity: 0.7,
  gradient: { kind: 'linear', from: { x: 0, y: 0 }, to: { x: 80, y: 0 },
    stops: [{ offset: 0, color: '#b00000' }, { offset: 1, color: '#0000b0' }] },
};

it('roundtrips portable artwork as detached editable geometry and paint', () => {
  const input = [rectangle, { ...rectangle, id: 'sibling', x: 100 }];
  const text = encodeClipboardArtwork(input);
  expect(JSON.parse(text).format).toBe('splash-artwork-1');
  const result = decodeClipboardArtwork(text);
  expect(result).toEqual(input);
  result[0].gradient!.stops[0].color = '#ffffff';
  expect(input[0].gradient!.stops[0].color).toBe('#b00000');
});

it('rejects resources, incompatible versions, malformed numeric data and unknown fields', () => {
  const text = encodeClipboardArtwork([rectangle]);
  expect(() => decodeClipboardArtwork(text.replace('splash-artwork-1', 'splash-artwork-2'))).toThrow('version 1');
  expect(() => decodeClipboardArtwork(text.replace('"x":15', '"x":1e999'))).toThrow();
  expect(() => decodeClipboardArtwork(text.replace('"x":15', '"x":15,"__proto__":{}'))).toThrow('Unsupported');
  expect(() => decodeClipboardArtwork(text.replace('"color":"#b00000"', '"color":"#b00000","foreign":1'))).toThrow('Unsupported');
  expect(() => decodeClipboardArtwork('<svg></svg>')).toThrow('valid Splash Artwork');
  expect(() => decodeClipboardArtwork(' '.repeat(MAX_ARTWORK_CLIPBOARD_CHARS + 1))).toThrow('size limit');
  expect(() => encodeClipboardArtwork([{ ...rectangle, x: NaN }])).toThrow();
  expect(() => encodeClipboardArtwork([{ ...rectangle, kind: 'symbol', symbolId: 'external' }])).toThrow('without bitmaps');
  expect(() => encodeClipboardArtwork([rectangle, rectangle])).toThrow('shape identity');
});

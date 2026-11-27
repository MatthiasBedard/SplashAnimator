import {
  transformBitmap,
  resizeBitmap,
  bitmapHandle,
  moveBitmapHandle,
} from '../packages/geometry/src/bitmap';
import { normalizeVector, scaleVector, worldPoint } from '../packages/geometry/src';
import { exportHTML } from '../packages/export-web/src';
import { bitmapDimensions } from '../apps/editor/src/bitmap';
import { it, expect } from 'vitest';
import { newProject, validateProject, clone } from '../packages/document/src';
const dataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=';
it('validates bitmap payload format, dimensions, identities and metadata', () => {
  const p = newProject();
  p.assets = [
    {
      id: 'a',
      path: 'assets/bitmaps/a.json',
      bitmap: { name: 'Pixel', width: 1, height: 1, dataUrl },
    },
  ];
  expect(validateProject(p)).toEqual(p);
  const bad = clone(p);
  bad.assets[0].bitmap!.width = 2;
  expect(() => validateProject(bad)).toThrow('dimensions');
  bad.assets[0].bitmap!.width = 1;
  bad.assets[0].bitmap!.dataUrl = 'data:image/svg+xml,<svg/>';
  expect(() => validateProject(bad)).toThrow('PNG payload');
  p.assets.push(clone(p.assets[0]));
  expect(() => validateProject(p)).toThrow('duplicate asset');
});

it('preflights declared dimensions before image decoding', () => {
  const bytes = new Uint8Array(Buffer.from(dataUrl.split(',')[1], 'base64'));
  expect(bitmapDimensions(bytes)).toEqual({ width: 1, height: 1 });
  expect(bitmapDimensions(bytes, 'png')).toEqual({ width: 1, height: 1 });
  const jpeg = new Uint8Array([255,216,255,192,0,7,8,0,1,0,2,255,217]);
  expect(bitmapDimensions(jpeg)).toEqual({ width: 2, height: 1 });
  expect(() => bitmapDimensions(jpeg, 'png')).toThrow('not a PNG');
  new DataView(bytes.buffer).setUint32(16, 50000);
  expect(() => bitmapDimensions(bytes)).toThrow('4096');
  expect(() => bitmapDimensions(new Uint8Array([255, 216, 255]))).toThrow();
});

it('bitmap paint mapping survives normalization/resize and missing assets block export', () => {
  const p = newProject();
  p.assets = [
    {
      id: 'a',
      path: 'assets/bitmaps/a.json',
      bitmap: { name: 'Pixel', width: 1, height: 1, dataUrl },
    },
  ];
  const s = {
    id: 's',
    kind: 'polygon' as const,
    x: 10,
    y: 20,
    width: 100,
    height: 100,
    rotation: 20,
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 0,
    points: [
      { x: 20, y: 20 },
      { x: 100, y: 20 },
      { x: 100, y: 100 },
    ],
    closed: true,
    bitmap: { assetId: 'a', x: 0, y: 0, width: 100, height: 100 },
  };
  const origin = worldPoint(s, { x: s.bitmap.x, y: s.bitmap.y });
  normalizeVector(s);
  expect(worldPoint(s, { x: s.bitmap.x, y: s.bitmap.y }).x).toBeCloseTo(origin.x);
  scaleVector(s, 2, 3);
  expect(s.bitmap.width).toBe(200);
  expect(s.bitmap.height).toBe(300);
  p.layers[0].keys[0].shapes = [s];
  Object.assign(s.bitmap, { transform: [1, 0.5, -0.2, 1] });
  expect(validateProject(p)).toEqual(p);
  const invalid = clone(p);
  invalid.layers[0].keys[0].shapes[0].bitmap!.transform = [1, 1, 1, 1];
  expect(() => validateProject(invalid)).toThrow();
  expect(exportHTML(p)).toContain('data:image/png');
  delete p.assets[0].bitmap!.dataUrl;
  expect(() => exportHTML(p)).toThrow('missing');
  s.bitmap.assetId = 'missing';
  expect(() => validateProject(p)).toThrow('reference');
});

it('composes bitmap rotation, skew and reflection without changing the source', () => {
  const p = { assetId: 'a', x: 3, y: 4, width: 20, height: 10 };
  const options = { dx: 7, dy: -2, rotation: 90, scaleX: -2, scaleY: 3, skewX: 0, skewY: 0 };
  const out = transformBitmap(p, options);
  expect(out.x).toBe(10);
  expect(out.y).toBe(2);
  expect(out.transform![1]).toBeCloseTo(-2);
  expect(out.transform![2]).toBeCloseTo(-3);
  expect(p).toEqual({ assetId: 'a', x: 3, y: 4, width: 20, height: 10 });
  expect(() => transformBitmap(p, { ...options, scaleX: 0 })).toThrow('invertibility');
  expect(() => transformBitmap(p, { ...options, skewX: 90 })).toThrow('skew');
  expect(() => transformBitmap(p, { ...options, dx: Infinity })).toThrow('finite');
});

it('preserves the complete bitmap sample map under nonuniform resize', () => {
  const p = {
    assetId: 'a',
    x: 12,
    y: -6,
    width: 80,
    height: 40,
    transform: [1, 0.5, -0.3, 2] as [number, number, number, number],
  };
  const out = resizeBitmap(p, 3, 0.5);
  const sample = (b: typeof p, u: number, v: number) => ({
    x: b.x + b.transform[0] * b.width * u + b.transform[2] * b.height * v,
    y: b.y + b.transform[1] * b.width * u + b.transform[3] * b.height * v,
  });
  for (const [u, v] of [
    [0, 0],
    [0.2, 0.8],
    [1, 1],
  ]) {
    expect(sample(out as typeof p, u, v).x).toBeCloseTo(sample(p, u, v).x * 3);
    expect(sample(out as typeof p, u, v).y).toBeCloseTo(sample(p, u, v).y * 0.5);
  }
  expect(() => resizeBitmap(p, 100000, 1)).toThrow();
  expect(p.width).toBe(80);
});

it('moves bitmap handles independently and rejects collapsed axes without mutation', () => {
  const paint = { assetId: 'a', x: 10, y: 20, width: 80, height: 40 };
  const next = moveBitmapHandle(paint, 'x', { x: 90, y: 60 });
  expect(bitmapHandle(next, 'x')).toEqual({ x: 90, y: 60 });
  expect(bitmapHandle(next, 'y')).toEqual({ x: 10, y: 60 });
  expect(bitmapHandle(moveBitmapHandle(next, 'origin', { x: 0, y: 0 }), 'x')).toEqual({
    x: 80,
    y: 40,
  });
  expect(() => moveBitmapHandle(next, 'y', { x: 50, y: 40 })).toThrow();
  expect(bitmapHandle(next, 'y')).toEqual({ x: 10, y: 60 });
});

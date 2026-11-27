import { id, type Asset } from '../../../packages/document/src';
/** Browser codecs decode raster formats; re-encode to a bounded, script-free PNG. */
export async function decodeBitmap(file: File, format?: 'png'): Promise<Asset> {
  if (!file.size || file.size > 4000000) throw new Error('Choose an image smaller than 4 MB.');
  bitmapDimensions(new Uint8Array(await file.arrayBuffer()), format);
  const image = await createImageBitmap(file);
  try {
    if (image.width > 4096 || image.height > 4096 || image.width * image.height > 16000000)
      throw new Error('Bitmap exceeds 4096 pixels per side or 16 megapixels.');
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > 2800000) throw new Error('Decoded PNG exceeds the 2 MB asset budget.');
    const assetId = id();
    return {
      id: assetId,
      path: `assets/bitmaps/${assetId}.json`,
      bitmap: {
        name: file.name.slice(0, 200) || 'Bitmap',
        width: image.width,
        height: image.height,
        dataUrl,
      },
    };
  } finally {
    image.close();
  }
}

/** Check declared dimensions before invoking a browser decoder. */
export function bitmapDimensions(bytes: Uint8Array, format?: 'png'): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  let width = 0,
    height = 0;
  const png = bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  if (format === 'png' && !png) throw new Error('The clipboard image is not a PNG.');
  if (png) {
    if (text(12, 16) !== 'IHDR') throw new Error('Invalid PNG header.');
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 7
      ) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (bytes.length >= 25 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') {
    const chunk = text(12, 16);
    if (chunk === 'VP8X' && bytes.length >= 30) {
      if (bytes[20] & 2) throw new Error('Animated WebP is not supported.');
      width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536;
      height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536;
    } else if (
      chunk === 'VP8 ' &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    ) {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else throw new Error('Only PNG, JPEG and WebP bitmap files are supported.');
  if (!width || !height) throw new Error('Invalid bitmap dimensions/header.');
  if (width > 4096 || height > 4096 || width * height > 16000000)
    throw new Error('Bitmap exceeds 4096 pixels per side or 16 megapixels.');
  return { width, height };
}
